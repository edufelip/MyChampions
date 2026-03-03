/**
 * Water tracking Data Connect source — log intake, set goals.
 * Uses Firebase Data Connect generated SDK (D-114, D-126).
 * Auth handled internally by SDK via Firebase Auth current user.
 * No business logic; normalization delegates to water-tracking.logic.
 * Refs: D-078–D-081, FR-218–FR-222, BR-276–BR-280
 */

import { type DataConnect } from 'firebase/data-connect';

import { getDataConnectInstance as _getDataConnectInstance } from '../dataconnect';
import {
  getMyWaterLogs as _getMyWaterLogs,
  getMyWaterGoalContext as _getMyWaterGoalContext,
  logWaterIntake as _logWaterIntake,
  setStudentWaterGoal as _setStudentWaterGoal,
  setNutritionistWaterGoalForStudent as _setNutritionistWaterGoalForStudent,
  type GetMyWaterLogsData,
  type GetMyWaterGoalContextData,
  type LogWaterIntakeData,
  type LogWaterIntakeVariables,
  type SetStudentWaterGoalData,
  type SetStudentWaterGoalVariables,
  type SetNutritionistWaterGoalForStudentData,
  type SetNutritionistWaterGoalForStudentVariables,
} from '@mychampions/dataconnect-generated';

import type { WaterIntakeLog } from './water-tracking.logic';

// ─── Error class ──────────────────────────────────────────────────────────────

type WaterSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class WaterTrackingSourceError extends Error {
  code: WaterSourceErrorCode;

  constructor(code: WaterSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WaterTrackingSourceError';
  }
}

// ─── Injectable deps (D-114 pattern) ─────────────────────────────────────────

export type WaterTrackingSourceDeps = {
  getDataConnectInstance: () => DataConnect;
  getMyWaterLogs: (dc: DataConnect) => Promise<{ data: GetMyWaterLogsData }>;
  getMyWaterGoalContext: (dc: DataConnect) => Promise<{ data: GetMyWaterGoalContextData }>;
  logWaterIntake: (
    dc: DataConnect,
    vars: LogWaterIntakeVariables
  ) => Promise<{ data: LogWaterIntakeData }>;
  setStudentWaterGoal: (
    dc: DataConnect,
    vars: SetStudentWaterGoalVariables
  ) => Promise<{ data: SetStudentWaterGoalData }>;
  setNutritionistWaterGoalForStudent: (
    dc: DataConnect,
    vars: SetNutritionistWaterGoalForStudentVariables
  ) => Promise<{ data: SetNutritionistWaterGoalForStudentData }>;
};

const defaultDeps: WaterTrackingSourceDeps = {
  getDataConnectInstance: _getDataConnectInstance,
  getMyWaterLogs: _getMyWaterLogs,
  getMyWaterGoalContext: _getMyWaterGoalContext,
  logWaterIntake: _logWaterIntake,
  setStudentWaterGoal: _setStudentWaterGoal,
  setNutritionistWaterGoalForStudent: _setNutritionistWaterGoalForStudent,
};

// ─── Intake log operations ────────────────────────────────────────────────────

/**
 * Returns all daily water intake logs for the current user.
 * Sorted descending by dateKey on the server.
 * Refs: FR-218, BR-276
 */
export async function getMyWaterLogs(deps = defaultDeps): Promise<WaterIntakeLog[]> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getMyWaterLogs(dc);

  return data.waterLogs.map((raw) => ({
    id: raw.id,
    dateKey: raw.dateKey,
    totalMl: raw.totalMl,
    loggedAt: raw.loggedAt,
  }));
}

/**
 * Logs a water intake amount for the current day.
 * Server accumulates into the daily total for dateKey (today).
 * SDK returns only the inserted WaterLog_Key; returns the key id.
 * Ref: FR-218, BR-276
 */
export async function logWaterIntake(amountMl: number, deps = defaultDeps): Promise<string> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.logWaterIntake(dc, { amount_ml: amountMl });
  return data.waterLog_insert.id;
}

// ─── Goal operations ──────────────────────────────────────────────────────────

/**
 * Sets the student's personal daily water goal in ml.
 * SDK returns WaterGoal_Key only; returns key id.
 * Ref: D-079, FR-221, BR-278
 */
export async function setStudentWaterGoal(dailyMl: number, deps = defaultDeps): Promise<string> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.setStudentWaterGoal(dc, { daily_ml: dailyMl });
  return data.waterGoal_upsert.id;
}

/**
 * Sets a nutritionist override water goal for an assigned student.
 * Only callable by a nutritionist actively assigned to the student.
 * SDK returns WaterGoal_Key only; returns key id.
 * Ref: D-079, D-081, FR-222, BR-279
 */
export async function setNutritionistWaterGoalForStudent(
  studentUid: string,
  dailyMl: number,
  deps = defaultDeps
): Promise<string> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.setNutritionistWaterGoalForStudent(dc, {
    student_uid: studentUid,
    daily_ml: dailyMl,
  });
  return data.waterGoal_upsert.id;
}

/**
 * Returns the current water goal context for the authenticated user.
 * Includes both student goal and active nutritionist override if present.
 * hasActiveNutritionistAssignment derived from nutritionistAuthUid != null.
 * Ref: D-081, BR-279
 */
export async function getMyWaterGoalContext(deps = defaultDeps): Promise<{
  studentGoalMl: number | null;
  nutritionistGoalMl: number | null;
  hasActiveNutritionistAssignment: boolean;
}> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getMyWaterGoalContext(dc);

  const raw = data.waterGoals[0] ?? null;

  return {
    studentGoalMl: raw?.personalDailyMl ?? null,
    nutritionistGoalMl: raw?.nutritionistDailyMl ?? null,
    hasActiveNutritionistAssignment: raw?.nutritionistAuthUid != null,
  };
}

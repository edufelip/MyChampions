/**
 * Plan Data Connect source — plan CRUD, predefined library, bulk assign.
 * Uses Firebase Data Connect generated SDK (D-114 injectable deps pattern).
 * No business logic; normalization delegates to plan-change-request.logic.
 * Refs: D-072, D-080, D-082, FR-211–FR-214, BR-269–BR-272
 *
 * SDK shape notes (breaking from old GraphQL stub):
 * - GetMyPlansData returns nutritionPlans[] (camelCase, nutrition only).
 * - GetMyPredefinedPlansData returns nutritionPlans[] (camelCase).
 * - SubmitPlanChangeRequest takes {planId, planType, requestText}; returns key only.
 * - ReviewPlanChangeRequest takes {requestId, status}; returns key only. Re-fetch not needed.
 * - BulkAssignNutritionPlan takes one {planId, studentUid} at a time.
 */

import type { DataConnect } from 'firebase/data-connect';

import { getDataConnectInstance as _getDataConnectInstance } from '../dataconnect';
import {
  getMyPlans as _getMyPlans,
  getMyPredefinedPlans as _getMyPredefinedPlans,
  submitPlanChangeRequest as _submitPlanChangeRequest,
  getStudentPlanChangeRequests as _getStudentPlanChangeRequests,
  reviewPlanChangeRequest as _reviewPlanChangeRequest,
  bulkAssignNutritionPlan as _bulkAssignNutritionPlan,
  type GetMyPlansData,
  type GetMyPredefinedPlansData,
  type SubmitPlanChangeRequestData,
  type SubmitPlanChangeRequestVariables,
  type GetStudentPlanChangeRequestsData,
  type GetStudentPlanChangeRequestsVariables,
  type ReviewPlanChangeRequestData,
  type ReviewPlanChangeRequestVariables,
  type BulkAssignNutritionPlanData,
  type BulkAssignNutritionPlanVariables,
} from '@mychampions/dataconnect-generated';

import {
  normalizePlanChangeRequestStatus,
  normalizePlanType,
  type PlanType,
  type PlanChangeRequest,
  type PlanChangeRequestStatus,
} from './plan-change-request.logic';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanSourceKind = 'predefined' | 'assigned' | 'self_managed';

/**
 * Domain plan type. Used by logic, hooks, and screens.
 * SDK only returns nutrition plans; planType is therefore always 'nutrition'
 * for SDK-sourced plans. isArchived is derived from isDraft flag.
 * sourceKind, ownerProfessionalUid, and studentUid are not in the SDK response
 * for GetMyPlans — defaults are applied.
 */
export type Plan = {
  id: string;
  planType: PlanType;
  sourceKind: PlanSourceKind;
  ownerProfessionalUid: string | null;
  studentUid: string;
  isArchived: boolean;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PredefinedPlan = {
  id: string;
  planType: PlanType;
  name: string;
  ownerProfessionalUid: string;
  createdAt: string;
  updatedAt: string;
};

/** Extended nutrition plan shape with SDK-specific fields. */
export type NutritionPlan = Plan & {
  isDraft: boolean;
  caloriesTarget: number | null;
  carbsTarget: number | null;
  proteinsTarget: number | null;
  fatsTarget: number | null;
};

// ─── Error class ──────────────────────────────────────────────────────────────

type PlanSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class PlanSourceError extends Error {
  code: PlanSourceErrorCode;

  constructor(code: PlanSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PlanSourceError';
  }
}

// ─── Injectable deps (D-114 pattern) ─────────────────────────────────────────

export type PlanSourceDeps = {
  getMyPlans: (dc: DataConnect) => Promise<{ data: GetMyPlansData }>;
  getMyPredefinedPlans: (dc: DataConnect) => Promise<{ data: GetMyPredefinedPlansData }>;
  submitPlanChangeRequest: (
    dc: DataConnect,
    vars: SubmitPlanChangeRequestVariables
  ) => Promise<{ data: SubmitPlanChangeRequestData }>;
  getStudentPlanChangeRequests: (
    dc: DataConnect,
    vars: GetStudentPlanChangeRequestsVariables
  ) => Promise<{ data: GetStudentPlanChangeRequestsData }>;
  reviewPlanChangeRequest: (
    dc: DataConnect,
    vars: ReviewPlanChangeRequestVariables
  ) => Promise<{ data: ReviewPlanChangeRequestData }>;
  bulkAssignNutritionPlan: (
    dc: DataConnect,
    vars: BulkAssignNutritionPlanVariables
  ) => Promise<{ data: BulkAssignNutritionPlanData }>;
  getDataConnectInstance: () => DataConnect;
};

const defaultDeps: PlanSourceDeps = {
  getMyPlans: _getMyPlans,
  getMyPredefinedPlans: _getMyPredefinedPlans,
  submitPlanChangeRequest: _submitPlanChangeRequest,
  getStudentPlanChangeRequests: _getStudentPlanChangeRequests,
  reviewPlanChangeRequest: _reviewPlanChangeRequest,
  bulkAssignNutritionPlan: _bulkAssignNutritionPlan,
  getDataConnectInstance: _getDataConnectInstance,
};

// ─── Plan CRUD ────────────────────────────────────────────────────────────────

/** Returns all nutrition plans for the current user. */
export async function getMyPlans(deps = defaultDeps): Promise<NutritionPlan[]> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getMyPlans(dc);

  return (data.nutritionPlans ?? []).map((raw) => ({
    id: raw.id,
    name: raw.name,
    planType: 'nutrition' as PlanType,
    sourceKind: 'assigned' as PlanSourceKind,
    ownerProfessionalUid: null,
    studentUid: '',
    isArchived: false,
    isDraft: raw.isDraft,
    caloriesTarget: raw.caloriesTarget ?? null,
    carbsTarget: raw.carbsTarget ?? null,
    proteinsTarget: raw.proteinsTarget ?? null,
    fatsTarget: raw.fatsTarget ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }));
}

// ─── Predefined plan library ──────────────────────────────────────────────────

/**
 * Returns all predefined (non-draft) nutrition plans for the current professional.
 * Ref: D-072, D-080
 */
export async function getMyPredefinedPlans(deps = defaultDeps): Promise<PredefinedPlan[]> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getMyPredefinedPlans(dc);

  return (data.nutritionPlans ?? []).map((raw) => ({
    id: raw.id,
    name: raw.name,
    planType: 'nutrition' as PlanType,
    ownerProfessionalUid: '',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }));
}

/**
 * Assigns a predefined nutrition plan to students.
 * SDK takes one student at a time — calls are serialized per studentUid.
 * Ref: D-080, D-082, FR-214
 */
export async function bulkAssignPredefinedPlan(
  predefinedPlanId: string,
  studentUids: string[],
  deps = defaultDeps
): Promise<{ assignedCount: number }> {
  const dc = deps.getDataConnectInstance();

  let assignedCount = 0;
  for (const studentUid of studentUids) {
    await deps.bulkAssignNutritionPlan(dc, {
      planId: predefinedPlanId,
      studentUid,
    });
    assignedCount++;
  }

  return { assignedCount };
}

// ─── Plan change requests ─────────────────────────────────────────────────────

/**
 * Student submits an advisory plan change request on their assigned plan.
 * Does not mutate the plan (D-071).
 * Ref: FR-211, BR-269, AC-255
 *
 * SDK note: returns planChangeRequest_insert key only — no full data back.
 * Returns a constructed PlanChangeRequest using caller inputs + returned id.
 */
export async function submitPlanChangeRequest(
  planId: string,
  planType: PlanType,
  requestText: string,
  deps = defaultDeps
): Promise<PlanChangeRequest> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.submitPlanChangeRequest(dc, {
    planId: planId,
    planType: planType,
    requestText: requestText,
  });

  const id = data.planChangeRequest_insert?.id;
  if (!id) {
    throw new PlanSourceError(
      'invalid_response',
      'submitPlanChangeRequest returned no id.'
    );
  }

  return {
    id,
    planId,
    planType,
    studentUid: '',          // not returned by SDK — caller context knows the uid
    requestText,
    status: 'pending',       // newly submitted requests are always pending
    createdAt: new Date().toISOString(),
  };
}

/**
 * Returns all plan change requests submitted by a given student.
 * Called from professional context to triage requests in SC-206.
 * Advisory only — does not grant plan-edit rights (D-071, BR-269).
 */
export async function getStudentPlanChangeRequests(
  studentUid: string,
  deps = defaultDeps
): Promise<PlanChangeRequest[]> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getStudentPlanChangeRequests(dc, { studentUid: studentUid });

  return (data.planChangeRequests ?? []).flatMap((raw) => {
    const planType = normalizePlanType(raw.planType);
    const status = normalizePlanChangeRequestStatus(raw.status);
    if (!raw.id || !raw.planId || !planType || !raw.studentAuthUid || !raw.requestText || !status || !raw.createdAt) {
      return [];
    }
    return [
      {
        id: raw.id,
        planId: raw.planId,
        planType,
        studentUid: raw.studentAuthUid,
        requestText: raw.requestText,
        status,
        createdAt: raw.createdAt,
      } satisfies PlanChangeRequest,
    ];
  });
}

/**
 * Professional reviews (or dismisses) a plan change request.
 * Advisory only — does not modify the plan (D-071).
 *
 * SDK note: takes status: string (not action); returns key only.
 * Returns the input status echoed back since SDK does not return full data.
 */
export async function reviewPlanChangeRequest(
  requestId: string,
  status: 'reviewed' | 'dismissed',
  deps = defaultDeps
): Promise<{ id: string; status: PlanChangeRequestStatus }> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.reviewPlanChangeRequest(dc, {
    requestId: requestId,
    status,
  });

  const id = data.planChangeRequest_update?.id;
  if (!id) {
    throw new PlanSourceError(
      'invalid_response',
      'reviewPlanChangeRequest returned no id.'
    );
  }

  return { id, status };
}

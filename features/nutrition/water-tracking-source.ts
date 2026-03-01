/**
 * Water tracking Data Connect source — log intake, set goals.
 * All calls use Firebase Auth ID token in Authorization header.
 * No business logic; normalization delegates to water-tracking.logic.
 * Refs: D-078–D-081, FR-218–FR-222, BR-276–BR-280
 */

import Constants from 'expo-constants';
import type { User } from 'firebase/auth';

import type { WaterIntakeLog } from './water-tracking.logic';

// ─── Transport helpers ────────────────────────────────────────────────────────

type DataConnectExtraConfig = {
  graphqlEndpoint?: string;
  apiKey?: string;
};

type DataConnectGraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type WaterSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class WaterTrackingSourceError extends Error {
  code: WaterSourceErrorCode;

  constructor(code: WaterSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WaterTrackingSourceError';
  }
}

function resolveConfig(): DataConnectExtraConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    dataConnect?: DataConnectExtraConfig;
  };
  return extra.dataConnect ?? {};
}

async function gql<T>(
  user: User,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { graphqlEndpoint, apiKey } = resolveConfig();
  if (!graphqlEndpoint) {
    throw new WaterTrackingSourceError(
      'configuration',
      'Data Connect endpoint is not configured. Set EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT.'
    );
  }

  const idToken = await user.getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
  if (apiKey) headers['x-goog-api-key'] = apiKey;

  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new WaterTrackingSourceError(
      'network',
      `Data Connect request failed with status ${response.status}.`
    );
  }

  const payload = (await response.json()) as DataConnectGraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new WaterTrackingSourceError(
      'graphql',
      payload.errors[0]?.message ?? 'Data Connect operation failed.'
    );
  }

  if (!payload.data) {
    throw new WaterTrackingSourceError(
      'invalid_response',
      'Data Connect operation returned no data payload.'
    );
  }

  return payload.data;
}

// ─── Intake log operations ────────────────────────────────────────────────────

/**
 * Returns all daily water intake logs for the current user.
 * Sorted descending by dateKey on the server.
 */
export async function getMyWaterLogs(user: User): Promise<WaterIntakeLog[]> {
  const query = `
    query GetMyWaterLogs {
      getMyWaterLogs {
        id
        date_key
        total_ml
        logged_at
      }
    }
  `;

  const data = await gql<{
    getMyWaterLogs?: Array<{
      id?: string | null;
      date_key?: string | null;
      total_ml?: number | null;
      logged_at?: string | null;
    }> | null;
  }>(user, query);

  return (data.getMyWaterLogs ?? []).flatMap((raw) => {
    if (!raw.id || !raw.date_key || raw.total_ml == null || !raw.logged_at) return [];
    return [
      {
        id: raw.id,
        dateKey: raw.date_key,
        totalMl: raw.total_ml,
        loggedAt: raw.logged_at,
      } satisfies WaterIntakeLog,
    ];
  });
}

/**
 * Logs a water intake amount for the current day.
 * Server accumulates into the daily total for dateKey (today).
 * Ref: FR-218, BR-276
 */
export async function logWaterIntake(
  user: User,
  amountMl: number
): Promise<WaterIntakeLog> {
  const mutation = `
    mutation LogWaterIntake($amount_ml: Float!) {
      logWaterIntake(amount_ml: $amount_ml) {
        id
        date_key
        total_ml
        logged_at
      }
    }
  `;

  const data = await gql<{
    logWaterIntake?: {
      id?: string | null;
      date_key?: string | null;
      total_ml?: number | null;
      logged_at?: string | null;
    } | null;
  }>(user, mutation, { amount_ml: amountMl });

  const raw = data.logWaterIntake;
  if (!raw?.id || !raw.date_key || raw.total_ml == null || !raw.logged_at) {
    throw new WaterTrackingSourceError('invalid_response', 'logWaterIntake returned no log.');
  }

  return {
    id: raw.id,
    dateKey: raw.date_key,
    totalMl: raw.total_ml,
    loggedAt: raw.logged_at,
  };
}

// ─── Goal operations ──────────────────────────────────────────────────────────

/**
 * Sets the student's personal daily water goal in ml.
 * Ref: D-079, FR-221, BR-278
 */
export async function setStudentWaterGoal(
  user: User,
  dailyMl: number
): Promise<{ dailyMl: number }> {
  const mutation = `
    mutation SetStudentWaterGoal($daily_ml: Float!) {
      setStudentWaterGoal(daily_ml: $daily_ml) {
        daily_ml
      }
    }
  `;

  const data = await gql<{
    setStudentWaterGoal?: { daily_ml?: number | null } | null;
  }>(user, mutation, { daily_ml: dailyMl });

  const result = data.setStudentWaterGoal?.daily_ml;
  if (result == null) {
    throw new WaterTrackingSourceError(
      'invalid_response',
      'setStudentWaterGoal returned no goal value.'
    );
  }

  return { dailyMl: result };
}

/**
 * Sets a nutritionist override water goal for an assigned student.
 * Only callable by nutritionist for a student they are actively assigned to.
 * Ref: D-079, D-081, FR-222, BR-279
 */
export async function setNutritionistWaterGoalForStudent(
  user: User,
  studentUid: string,
  dailyMl: number
): Promise<{ dailyMl: number }> {
  const mutation = `
    mutation SetNutritionistWaterGoalForStudent($student_uid: String!, $daily_ml: Float!) {
      setNutritionistWaterGoalForStudent(student_uid: $student_uid, daily_ml: $daily_ml) {
        daily_ml
      }
    }
  `;

  const data = await gql<{
    setNutritionistWaterGoalForStudent?: { daily_ml?: number | null } | null;
  }>(user, mutation, { student_uid: studentUid, daily_ml: dailyMl });

  const result = data.setNutritionistWaterGoalForStudent?.daily_ml;
  if (result == null) {
    throw new WaterTrackingSourceError(
      'invalid_response',
      'setNutritionistWaterGoalForStudent returned no goal value.'
    );
  }

  return { dailyMl: result };
}

/**
 * Returns the current water goal context for the authenticated user.
 * Includes both student goal and active nutritionist override if present.
 * Ref: D-081, BR-279
 */
export async function getMyWaterGoalContext(user: User): Promise<{
  studentGoalMl: number | null;
  nutritionistGoalMl: number | null;
  hasActiveNutritionistAssignment: boolean;
}> {
  const query = `
    query GetMyWaterGoalContext {
      getMyWaterGoalContext {
        student_goal_ml
        nutritionist_goal_ml
        has_active_nutritionist_assignment
      }
    }
  `;

  const data = await gql<{
    getMyWaterGoalContext?: {
      student_goal_ml?: number | null;
      nutritionist_goal_ml?: number | null;
      has_active_nutritionist_assignment?: boolean | null;
    } | null;
  }>(user, query);

  const raw = data.getMyWaterGoalContext;

  return {
    studentGoalMl: raw?.student_goal_ml ?? null,
    nutritionistGoalMl: raw?.nutritionist_goal_ml ?? null,
    hasActiveNutritionistAssignment: raw?.has_active_nutritionist_assignment ?? false,
  };
}

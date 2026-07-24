import { getValidServerAccessToken } from '../auth/server-auth-source';
import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import type { PortionLog } from '../nutrition/custom-meal-source';
import type { WaterIntakeLog } from '../nutrition/water-tracking.logic';

import { buildStudentTrackingReview, type StudentTrackingReview } from './student-tracking-review.logic';

export type { StudentTrackingReview };

export type StudentTrackingReviewSourceErrorCode = 'configuration' | 'network' | 'permission' | 'invalid_response';

export class StudentTrackingReviewSourceError extends Error {
  code: StudentTrackingReviewSourceErrorCode;

  constructor(code: StudentTrackingReviewSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'StudentTrackingReviewSourceError';
  }
}

export type StudentTrackingReviewSourceDeps = {
  getCurrentAccessToken?: () => Promise<string | null>;
  getServerBaseUrl?: () => string | undefined;
  fetchFn?: AppFetch;
};

const defaultDeps: StudentTrackingReviewSourceDeps = {
  getCurrentAccessToken: () => getValidServerAccessToken(),
  getServerBaseUrl: resolveServerBaseUrl,
  fetchFn: fetch,
};

function resolveServerBaseUrl(): string | undefined {
  let expoExtra: unknown;
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: unknown } };
      expoConfig?: { extra?: unknown };
    };
    expoExtra = (Constants.default ?? Constants).expoConfig?.extra;
  } catch {
    expoExtra = undefined;
  }

  const extra = (expoExtra ?? {}) as {
    server?: {
      baseUrl?: string;
    };
  };
  return extra.server?.baseUrl?.trim() || process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL?.trim();
}

function getE2EStudentTrackingReviewFixture(
  studentUid: string,
  input: { todayKey: string; waterGoalMl?: number | null }
): StudentTrackingReview | null {
  const override = resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
  if (!override) return null;

  if (studentUid !== 'e2e-dual-student') {
    return buildStudentTrackingReview({
      todayKey: input.todayKey,
      waterGoalMl: input.waterGoalMl ?? null,
      waterLogs: [],
      portionLogs: [],
    });
  }

  const today = new Date(`${input.todayKey}T00:00:00.000Z`);
  const previousDay = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(today.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const waterLogs: WaterIntakeLog[] = [
    { id: 'e2e-water-today', dateKey: input.todayKey, totalMl: 1500, loggedAt: `${input.todayKey}T12:00:00.000Z` },
    { id: 'e2e-water-yesterday', dateKey: previousDay, totalMl: 2200, loggedAt: `${previousDay}T12:00:00.000Z` },
  ];
  const portionLogs: PortionLog[] = [
    {
      id: 'e2e-portion-today',
      ownerUid: studentUid,
      mealId: 'breakfast',
      consumedGrams: 0,
      snapshot: { calories: 300, carbs: 32, proteins: 20, fats: 8 },
      loggedAt: `${input.todayKey}T08:00:00.000Z`,
      planId: 'e2e-assigned-nutrition-plan',
      planType: 'nutrition',
      sourceKind: 'assigned',
      ownerProfessionalUid: override.uid,
      connectionId: 'e2e-connection-e2e-dual-student-nutritionist',
    },
    {
      id: 'e2e-portion-recent',
      ownerUid: studentUid,
      mealId: 'dinner',
      consumedGrams: 0,
      snapshot: { calories: 520, carbs: 48, proteins: 36, fats: 14 },
      loggedAt: `${twoDaysAgo}T18:00:00.000Z`,
      planId: 'e2e-assigned-nutrition-plan',
      planType: 'nutrition',
      sourceKind: 'assigned',
      ownerProfessionalUid: override.uid,
      connectionId: 'e2e-connection-e2e-dual-student-nutritionist',
    },
  ];

  return buildStudentTrackingReview({
    todayKey: input.todayKey,
    waterGoalMl: input.waterGoalMl ?? null,
    waterLogs,
    portionLogs,
  });
}

export function buildStudentTrackingReviewDateWindow(todayKey: string): {
  startDateKey: string;
  endDateKey: string;
  startLoggedAtIso: string;
} {
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const start = new Date(today.getTime() - 6 * 86_400_000);
  const startDateKey = start.toISOString().slice(0, 10);
  return {
    startDateKey,
    endDateKey: todayKey,
    startLoggedAtIso: `${startDateKey}T00:00:00.000Z`,
  };
}

export function normalizeStudentTrackingReviewError(error: unknown): StudentTrackingReviewSourceError {
  if (error instanceof StudentTrackingReviewSourceError) return error;

  return new StudentTrackingReviewSourceError(
    'invalid_response',
    (error as Error)?.message ?? 'Unexpected student tracking review source error.'
  );
}

type ServerWaterLog = Partial<WaterIntakeLog>;
type ServerPortionLog = Partial<PortionLog>;

function normalizeServerWaterLog(input: ServerWaterLog): WaterIntakeLog | null {
  const id = typeof input.id === 'string' ? input.id : '';
  const dateKey = typeof input.dateKey === 'string' ? input.dateKey : '';
  const totalMl = typeof input.totalMl === 'number' ? input.totalMl : Number.NaN;
  const loggedAt = typeof input.loggedAt === 'string' ? input.loggedAt : '';

  if (!id || !dateKey || !Number.isFinite(totalMl) || !loggedAt) return null;
  return { id, dateKey, totalMl, loggedAt };
}

function normalizeServerPortionLog(input: ServerPortionLog): PortionLog | null {
  const id = typeof input.id === 'string' ? input.id : '';
  const ownerUid = typeof input.ownerUid === 'string' ? input.ownerUid : '';
  const mealId = typeof input.mealId === 'string' ? input.mealId : '';
  const consumedGrams = typeof input.consumedGrams === 'number' ? input.consumedGrams : Number.NaN;
  const snapshot = input.snapshot;
  const loggedAt = typeof input.loggedAt === 'string' ? input.loggedAt : '';

  if (
    !id ||
    !ownerUid ||
    !mealId ||
    !Number.isFinite(consumedGrams) ||
    !snapshot ||
    typeof snapshot.calories !== 'number' ||
    typeof snapshot.carbs !== 'number' ||
    typeof snapshot.proteins !== 'number' ||
    typeof snapshot.fats !== 'number' ||
    !loggedAt
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    mealId,
    consumedGrams,
    snapshot,
    loggedAt,
    planId: typeof input.planId === 'string' ? input.planId : null,
    planType: input.planType === 'nutrition' ? input.planType : null,
    sourceKind:
      input.sourceKind === 'assigned' ||
      input.sourceKind === 'predefined' ||
      input.sourceKind === 'self_managed'
        ? input.sourceKind
        : null,
    ownerProfessionalUid: typeof input.ownerProfessionalUid === 'string' ? input.ownerProfessionalUid : null,
    connectionId: typeof input.connectionId === 'string' ? input.connectionId : null,
  };
}

function normalizeServerStatus(status: number): StudentTrackingReviewSourceError {
  if (status === 401 || status === 403) {
    return new StudentTrackingReviewSourceError('permission', 'Tracking review read is not authorized.');
  }
  if (status >= 500) {
    return new StudentTrackingReviewSourceError('network', `Tracking review request failed with status ${status}.`);
  }
  return new StudentTrackingReviewSourceError('invalid_response', `Unexpected tracking review response: ${status}.`);
}

function requireServerBaseUrl(deps: StudentTrackingReviewSourceDeps): string {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new StudentTrackingReviewSourceError(
      'configuration',
      'MyChampions server URL is not configured for student tracking review.'
    );
  }
  return baseUrl;
}

async function requireAccessToken(deps: StudentTrackingReviewSourceDeps): Promise<string> {
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!accessToken) {
    throw new StudentTrackingReviewSourceError(
      'permission',
      'No authenticated server token found for student tracking review.'
    );
  }
  return accessToken;
}

async function getStudentTrackingReviewFromServer(
  studentUid: string,
  input: { todayKey: string; waterGoalMl?: number | null },
  deps: StudentTrackingReviewSourceDeps
): Promise<{ waterGoalMl: number | null; waterLogs: WaterIntakeLog[]; portionLogs: PortionLog[] }> {
  const baseUrl = requireServerBaseUrl(deps);
  const accessToken = await requireAccessToken(deps);

  const params = new URLSearchParams({ todayKey: input.todayKey });

  let response: Response;
  try {
    response = await (deps.fetchFn ?? fetch)(
      `${baseUrl}/professional/students/${encodeURIComponent(studentUid)}/tracking-review?${params.toString()}`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
      }
    );
  } catch {
    throw new StudentTrackingReviewSourceError('network', 'Network request to read tracking review failed.');
  }

  let payload: {
    waterGoalMl?: unknown;
    waterLogs?: ServerWaterLog[];
    portionLogs?: ServerPortionLog[];
  } | null = null;
  try {
    payload = (await response.json()) as {
      waterGoalMl?: unknown;
      waterLogs?: ServerWaterLog[];
      portionLogs?: ServerPortionLog[];
    };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw normalizeServerStatus(response.status);
  }
  if (!Array.isArray(payload?.waterLogs) || !Array.isArray(payload?.portionLogs)) {
    throw new StudentTrackingReviewSourceError('invalid_response', 'Tracking review response is missing logs.');
  }

  return {
    waterGoalMl:
      typeof payload.waterGoalMl === 'number' && Number.isFinite(payload.waterGoalMl)
        ? payload.waterGoalMl
        : null,
    waterLogs: payload.waterLogs
      .map(normalizeServerWaterLog)
      .filter((log): log is WaterIntakeLog => log !== null),
    portionLogs: payload.portionLogs
      .map(normalizeServerPortionLog)
      .filter((log): log is PortionLog => log !== null),
  };
}

export async function getStudentTrackingReview(
  studentUid: string,
  input: { todayKey: string; waterGoalMl?: number | null },
  deps = defaultDeps
): Promise<StudentTrackingReview> {
  if (deps === defaultDeps) {
    const fixture = getE2EStudentTrackingReviewFixture(studentUid, input);
    if (fixture) return fixture;
  }

  try {
    const serverLogs = await getStudentTrackingReviewFromServer(studentUid, input, deps);
    return buildStudentTrackingReview({
      todayKey: input.todayKey,
      waterGoalMl: serverLogs.waterGoalMl,
      waterLogs: serverLogs.waterLogs,
      portionLogs: serverLogs.portionLogs,
    });
  } catch (error) {
    throw normalizeStudentTrackingReviewError(error);
  }
}

/**
 * Plan source — server-first plan CRUD, predefined library, bulk assign,
 * and plan-change request operations.
 */

import {
  normalizePlanChangeRequestStatus,
  normalizePlanType,
  type PlanType,
  type PlanChangeRequest,
  type PlanChangeRequestStatus,
} from './plan-change-request.logic';
import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getValidServerAccessToken } from '../auth/server-auth-source';

export type PlanSourceKind = 'predefined' | 'assigned' | 'self_managed';

export type Plan = {
  id: string;
  planType: PlanType;
  sourceKind: PlanSourceKind;
  ownerProfessionalUid: string | null;
  studentUid: string;
  isArchived: boolean;
  isDraft?: boolean;
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

export type AssignmentRequiredSpecialty = 'nutritionist' | 'fitness_coach';

export type PlanAssignmentTargetValidation = {
  isValid: boolean;
  requiredSpecialty: AssignmentRequiredSpecialty;
  invalidStudentUids: string[];
};

export type NutritionPlan = Plan & {
  isDraft: boolean;
  hydrationGoalMl: number | null;
  caloriesTarget: number | null;
  carbsTarget: number | null;
  proteinsTarget: number | null;
  fatsTarget: number | null;
};

type PlanVisibilityInput = {
  planType: PlanType;
  sourceKind: PlanSourceKind;
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  isDraft?: boolean;
};

type PlanSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

// ─── Global Cache (Optimistic UI) ──────────────────────────────────────────

let globalPlansCache: Plan[] | null = null;
let globalPredefinedPlansCache: PredefinedPlan[] | null = null;
let globalPlansCacheOwnerUid: string | null = null;
let globalPlansCacheSyncedAtIso: string | null = null;

export function getCachedPlans(): Plan[] | null {
  return globalPlansCache;
}

export function getCachedPredefinedPlans(): PredefinedPlan[] | null {
  return globalPredefinedPlansCache;
}

export function setCachedPlans(plans: Plan[]) {
  globalPlansCache = plans;
  globalPlansCacheOwnerUid = plans[0]?.studentUid ?? null;
  globalPlansCacheSyncedAtIso = nowIso();
}

export function setCachedPredefinedPlans(plans: PredefinedPlan[]) {
  globalPredefinedPlansCache = plans;
}

export function getCachedPlansOwnerUid(): string | null {
  return globalPlansCacheOwnerUid;
}

export function getCachedPlansSyncedAtIso(): string | null {
  return globalPlansCacheSyncedAtIso;
}

export function clearPlanCaches() {
  globalPlansCache = null;
  globalPredefinedPlansCache = null;
  globalPlansCacheOwnerUid = null;
  globalPlansCacheSyncedAtIso = null;
}

/**
 * Optimistically adds or updates a predefined plan in the global cache.
 * Useful for seamless transitions after a builder save before the next fetch.
 */
export function optimisticUpdatePredefinedPlan(plan: PredefinedPlan) {
  if (!globalPredefinedPlansCache) {
    globalPredefinedPlansCache = [plan];
    return;
  }

  const index = globalPredefinedPlansCache.findIndex((p) => p.id === plan.id);
  if (index >= 0) {
    const next = [...globalPredefinedPlansCache];
    next[index] = plan;
    globalPredefinedPlansCache = next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } else {
    globalPredefinedPlansCache = [plan, ...globalPredefinedPlansCache].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
}

/**
 * Optimistically removes a predefined plan from the global cache.
 */
export function optimisticDeletePredefinedPlan(planId: string) {
  if (!globalPredefinedPlansCache) return;
  globalPredefinedPlansCache = globalPredefinedPlansCache.filter((p) => p.id !== planId);
}

export class PlanSourceError extends Error {
  code: PlanSourceErrorCode;

  constructor(code: PlanSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PlanSourceError';
  }
}

export function getRequiredAssignmentSpecialty(planType: PlanType): AssignmentRequiredSpecialty {
  return planType === 'nutrition' ? 'nutritionist' : 'fitness_coach';
}

export function validatePlanAssignmentTargets({
  planType,
  targetStudentUids,
  activeStudentUids,
}: {
  planType: PlanType;
  targetStudentUids: string[];
  activeStudentUids: string[];
}): PlanAssignmentTargetValidation {
  const requiredSpecialty = getRequiredAssignmentSpecialty(planType);
  const activeTargets = new Set(activeStudentUids.filter(Boolean));
  const invalidStudentUids = [...new Set(targetStudentUids.filter(Boolean))].filter(
    (uid) => !activeTargets.has(uid),
  );

  return {
    isValid: invalidStudentUids.length === 0,
    requiredSpecialty,
    invalidStudentUids,
  };
}

export type PlanSourceDeps = {
  getServerBaseUrl?: () => string | undefined;
  getCurrentAccessToken?: () => Promise<string | null>;
  fetchFn?: AppFetch;
};

function nowIso(): string {
  return new Date().toISOString();
}

const defaultDeps: PlanSourceDeps = {
  getServerBaseUrl: defaultGetServerBaseUrl,
  getCurrentAccessToken: () => getValidServerAccessToken(),
  fetchFn: fetch,
};

function defaultGetServerBaseUrl(): string | undefined {
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

let e2eAssignedPlanSequence = 0;
let e2ePlanChangeRequestStatus: PlanChangeRequestStatus = 'pending';
const e2eAssignedPlans: Plan[] = [];
const e2ePredefinedPlanFixtures: PredefinedPlan[] = [];
const E2E_ASSIGNED_NUTRITION_PLAN: Plan = {
  id: 'e2e-assigned-nutrition-plan',
  planType: 'nutrition',
  sourceKind: 'assigned',
  ownerProfessionalUid: 'e2e-nutritionist',
  studentUid: 'e2e-auth-session-user',
  isArchived: false,
  isDraft: false,
  name: 'Assigned Nutrition Plan',
  createdAt: '2026-06-22T10:00:00.000Z',
  updatedAt: '2026-06-22T10:00:00.000Z',
};
const E2E_ASSIGNED_TRAINING_PLAN: Plan = {
  id: 'e2e-assigned-training-plan',
  planType: 'training',
  sourceKind: 'assigned',
  ownerProfessionalUid: 'e2e-fitness-coach',
  studentUid: 'e2e-auth-session-user',
  isArchived: false,
  isDraft: false,
  name: 'Assigned Training Plan',
  createdAt: '2026-06-22T10:00:00.000Z',
  updatedAt: '2026-06-22T10:00:00.000Z',
};

function getE2EPlanSourceOverride() {
  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

function getE2EPredefinedPlans(): PredefinedPlan[] | null {
  const override = getE2EPlanSourceOverride();
  if (!override) return null;
  if (process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE !== 'basic') return [];

  return [
    {
      id: 'e2e-nutrition-predefined-plan',
      name: 'Balanced Nutrition Template',
      planType: 'nutrition',
      ownerProfessionalUid: override.uid,
      createdAt: '2026-06-22T12:00:00.000Z',
      updatedAt: '2026-06-22T12:00:00.000Z',
    },
    {
      id: 'e2e-training-predefined-plan',
      name: 'Strength Training Template',
      planType: 'training',
      ownerProfessionalUid: override.uid,
      createdAt: '2026-06-22T11:00:00.000Z',
      updatedAt: '2026-06-22T11:00:00.000Z',
    },
    ...e2ePredefinedPlanFixtures.map(cloneE2EPredefinedPlan),
  ];
}

function getE2EAssignedPlanFixtures(): Plan[] | null {
  const override = getE2EPlanSourceOverride();
  if (!override) return null;
  const assignedPlans =
    process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE === 'basic'
      ? e2eAssignedPlans.map(cloneE2EPlan)
      : [];
  const fixturePlans: Plan[] = [];

  if (process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE === 'assigned') {
    fixturePlans.push({ ...E2E_ASSIGNED_NUTRITION_PLAN, studentUid: override.uid });
  }

  if (process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE === 'assigned') {
    fixturePlans.push({ ...E2E_ASSIGNED_TRAINING_PLAN, studentUid: override.uid });
  }

  return [...fixturePlans, ...assignedPlans];
}

function getE2EActiveStudentUidsForPlanType(planType: PlanType): string[] {
  if (planType === 'nutrition') {
    return ['e2e-active-student', 'e2e-dual-student'];
  }

  return ['e2e-dual-student'];
}

function cloneE2EPlan(plan: Plan): Plan {
  return { ...plan };
}

function cloneE2EPredefinedPlan(plan: PredefinedPlan): PredefinedPlan {
  return { ...plan };
}

function getE2EPlanChangeRequests(studentUid: string): PlanChangeRequest[] | null {
  if (!getE2EPlanSourceOverride()) return null;
  if (studentUid !== 'e2e-dual-student') return [];

  return [
    {
      id: 'e2e-plan-change-request-nutrition',
      planId: 'e2e-assigned-nutrition-plan',
      planType: 'nutrition',
      studentUid,
      requestText: 'Please add one more high-protein breakfast option.',
      status: e2ePlanChangeRequestStatus,
      createdAt: '2026-06-22T09:00:00.000Z',
    },
  ];
}

export function getE2EAssignedPlanFixture(
  planId: string,
  planType: PlanType,
): Plan | null | undefined {
  const plans = getE2EAssignedPlanFixtures();
  if (!plans) return undefined;
  const plan = plans.find(
    (candidate) => candidate.id === planId && candidate.planType === planType,
  );
  return plan ? cloneE2EPlan(plan) : null;
}

export function updateE2EAssignedPlanFixture(
  planId: string,
  planType: PlanType,
  updates: { name?: string; isDraft?: boolean; updatedAt?: string },
): boolean | undefined {
  if (!getE2EPredefinedPlans()) return undefined;
  const planIndex = e2eAssignedPlans.findIndex(
    (candidate) => candidate.id === planId && candidate.planType === planType,
  );
  if (planIndex < 0) return false;

  e2eAssignedPlans[planIndex] = {
    ...e2eAssignedPlans[planIndex],
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.isDraft !== undefined ? { isDraft: updates.isDraft } : {}),
    updatedAt: updates.updatedAt ?? nowIso(),
  };
  return true;
}

export function removeE2EAssignedPlanFixture(
  planId: string,
  planType: PlanType,
): boolean | undefined {
  if (!getE2EPredefinedPlans()) return undefined;
  const planIndex = e2eAssignedPlans.findIndex(
    (candidate) => candidate.id === planId && candidate.planType === planType,
  );
  if (planIndex < 0) return false;

  e2eAssignedPlans.splice(planIndex, 1);
  return true;
}

export function upsertE2EPredefinedPlanFixture(plan: PredefinedPlan): boolean | undefined {
  if (!getE2EPredefinedPlans()) return undefined;
  const existingIndex = e2ePredefinedPlanFixtures.findIndex(
    (candidate) => candidate.id === plan.id && candidate.planType === plan.planType,
  );
  if (existingIndex >= 0) {
    e2ePredefinedPlanFixtures[existingIndex] = cloneE2EPredefinedPlan(plan);
  } else {
    e2ePredefinedPlanFixtures.push(cloneE2EPredefinedPlan(plan));
  }
  return true;
}

export function removeE2EPredefinedPlanFixture(
  planId: string,
  planType: PlanType,
): boolean | undefined {
  if (!getE2EPredefinedPlans()) return undefined;
  const existingIndex = e2ePredefinedPlanFixtures.findIndex(
    (candidate) => candidate.id === planId && candidate.planType === planType,
  );
  if (existingIndex < 0) return false;
  e2ePredefinedPlanFixtures.splice(existingIndex, 1);
  return true;
}

export function upsertE2EMyPlanFixture(plan: Plan): boolean | undefined {
  if (!getE2EPredefinedPlans()) return undefined;
  const existingIndex = e2eAssignedPlans.findIndex(
    (candidate) => candidate.id === plan.id && candidate.planType === plan.planType,
  );
  if (existingIndex >= 0) {
    e2eAssignedPlans[existingIndex] = cloneE2EPlan(plan);
  } else {
    e2eAssignedPlans.push(cloneE2EPlan(plan));
  }
  return true;
}

function normalizePlanSourceError(error: unknown): PlanSourceError {
  if (error instanceof PlanSourceError) return error;

  return new PlanSourceError(
    'invalid_response',
    (error as Error)?.message ?? 'Unexpected plan source error.',
  );
}

function requireServerResult<T>(result: T | null, operation: string): T {
  if (result !== null) return result;
  throw new PlanSourceError(
    'configuration',
    `${operation} requires local MyChampions server URL and auth.`,
  );
}

function resolveServerPlanSource(deps: PlanSourceDeps): {
  baseUrl: string;
  token: string;
  fetchFn: AppFetch;
} | null {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const sourceFetch = deps.fetchFn ?? fetch;
  if (!baseUrl || !sourceFetch) return null;

  // Browser fetch is a host function and must retain the global receiver. Calling it
  // later as `source.fetchFn(...)` otherwise supplies the source object as `this`,
  // which Firefox rejects with "Illegal invocation".
  const fetchFn: AppFetch = (input, init) => Reflect.apply(sourceFetch, globalThis, [input, init]);

  return {
    baseUrl,
    token: '',
    fetchFn,
  };
}

async function getServerPlanSource(deps: PlanSourceDeps): Promise<{
  baseUrl: string;
  token: string;
  fetchFn: AppFetch;
} | null> {
  const source = resolveServerPlanSource(deps);
  if (!source) return null;
  const token = await (deps.getCurrentAccessToken?.() ?? Promise.resolve(null));
  if (!token) return null;
  return { ...source, token };
}

function parseServerPlanChangeRequest(raw: unknown): PlanChangeRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<PlanChangeRequest>;
  const planType = normalizePlanType(value.planType);
  const status = normalizePlanChangeRequestStatus(value.status);

  if (
    typeof value.id !== 'string' ||
    typeof value.planId !== 'string' ||
    !planType ||
    typeof value.studentUid !== 'string' ||
    typeof value.requestText !== 'string' ||
    !status ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    planId: value.planId,
    planType,
    studentUid: value.studentUid,
    requestText: value.requestText,
    status,
    createdAt: value.createdAt,
  };
}

function normalizePlanSourceKind(value: unknown): PlanSourceKind | null {
  return value === 'predefined' || value === 'assigned' || value === 'self_managed' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseServerPlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<NutritionPlan>;
  const planType = normalizePlanType(value.planType);
  const sourceKind = normalizePlanSourceKind(value.sourceKind);

  if (
    typeof value.id !== 'string' ||
    !planType ||
    !sourceKind ||
    !('ownerProfessionalUid' in value) ||
    (value.ownerProfessionalUid !== null && typeof value.ownerProfessionalUid !== 'string') ||
    typeof value.studentUid !== 'string' ||
    typeof value.isArchived !== 'boolean' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  const basePlan: Plan = {
    id: value.id,
    planType,
    sourceKind,
    ownerProfessionalUid: value.ownerProfessionalUid ?? null,
    studentUid: value.studentUid,
    isArchived: value.isArchived,
    isDraft: typeof value.isDraft === 'boolean' ? value.isDraft : false,
    name: typeof value.name === 'string' ? value.name : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };

  if (planType !== 'nutrition') return basePlan;

  const nutritionPlan: NutritionPlan = {
    ...basePlan,
    planType: 'nutrition',
    isDraft: basePlan.isDraft ?? false,
    hydrationGoalMl: optionalNumber(value.hydrationGoalMl),
    caloriesTarget: optionalNumber(value.caloriesTarget),
    carbsTarget: optionalNumber(value.carbsTarget),
    proteinsTarget: optionalNumber(value.proteinsTarget),
    fatsTarget: optionalNumber(value.fatsTarget),
  };
  return nutritionPlan;
}

function parseServerPredefinedPlan(raw: unknown): PredefinedPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<PredefinedPlan>;
  const planType = normalizePlanType(value.planType);

  if (
    typeof value.id !== 'string' ||
    !planType ||
    typeof value.name !== 'string' ||
    typeof value.ownerProfessionalUid !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    planType,
    name: value.name,
    ownerProfessionalUid: value.ownerProfessionalUid,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

async function readServerJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PlanSourceError('invalid_response', 'Plan server returned a non-JSON response.');
  }
}

function planServerError(status: number, payload: unknown): PlanSourceError {
  const nestedError =
    payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : null;
  const nestedCode =
    nestedError &&
    typeof nestedError === 'object' &&
    typeof (nestedError as { code?: unknown }).code === 'string'
      ? (nestedError as { code: string }).code
      : typeof nestedError === 'string'
        ? nestedError
        : null;
  const nestedMessage =
    nestedError &&
    typeof nestedError === 'object' &&
    typeof (nestedError as { message?: unknown }).message === 'string'
      ? (nestedError as { message: string }).message
      : null;
  const message =
    nestedMessage ??
    (payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof (payload as { message?: unknown }).message === 'string'
      ? (payload as { message: string }).message
      : `Plan server returned status ${status}.`);

  if (status === 401 || status === 403) {
    return new PlanSourceError('configuration', message);
  }
  if (status === 404 || (status === 402 && nestedCode === 'professional_subscription_required')) {
    return new PlanSourceError('graphql', message);
  }
  if (status >= 500) {
    return new PlanSourceError('network', message);
  }
  return new PlanSourceError('invalid_response', message);
}

async function submitPlanChangeRequestToServer(
  planId: string,
  planType: PlanType,
  requestText: string,
  deps: PlanSourceDeps,
): Promise<PlanChangeRequest | null> {
  const source = await getServerPlanSource(deps);
  if (!source) return null;

  let response: Response;
  try {
    response = await source.fetchFn(`${source.baseUrl}/plans/change-requests`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${source.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ planId, planType, requestText }),
    });
  } catch (error) {
    throw new PlanSourceError(
      'network',
      (error as Error)?.message ?? 'Plan server request failed.',
    );
  }

  const payload = await readServerJson(response);
  if (!response.ok) throw planServerError(response.status, payload);

  const request = parseServerPlanChangeRequest((payload as { request?: unknown }).request);
  if (!request) {
    throw new PlanSourceError(
      'invalid_response',
      'Plan server returned an invalid change request.',
    );
  }
  return request;
}

async function getStudentPlanChangeRequestsFromServer(
  studentUid: string,
  deps: PlanSourceDeps,
): Promise<PlanChangeRequest[] | null> {
  const source = await getServerPlanSource(deps);
  if (!source) return null;

  let response: Response;
  try {
    response = await source.fetchFn(
      `${source.baseUrl}/professional/students/${encodeURIComponent(studentUid)}/plan-change-requests`,
      {
        headers: {
          Authorization: `Bearer ${source.token}`,
        },
      },
    );
  } catch (error) {
    throw new PlanSourceError(
      'network',
      (error as Error)?.message ?? 'Plan server request failed.',
    );
  }

  const payload = await readServerJson(response);
  if (!response.ok) throw planServerError(response.status, payload);

  const rawRequests = (payload as { requests?: unknown }).requests;
  if (!Array.isArray(rawRequests)) {
    throw new PlanSourceError(
      'invalid_response',
      'Plan server returned invalid change request list.',
    );
  }
  return rawRequests
    .map(parseServerPlanChangeRequest)
    .filter((request): request is PlanChangeRequest => request !== null);
}

async function getProfessionalPlanChangeRequestsFromServer(
  deps: PlanSourceDeps,
): Promise<PlanChangeRequest[] | null> {
  const source = await getServerPlanSource(deps);
  if (!source) return null;

  let response: Response;
  try {
    response = await source.fetchFn(
      `${source.baseUrl}/professional/plan-change-requests?status=pending`,
      {
        headers: {
          Authorization: `Bearer ${source.token}`,
        },
      },
    );
  } catch (error) {
    throw new PlanSourceError(
      'network',
      (error as Error)?.message ?? 'Plan server request failed.',
    );
  }

  const payload = await readServerJson(response);
  if (!response.ok) throw planServerError(response.status, payload);

  const rawRequests = (payload as { requests?: unknown }).requests;
  if (!Array.isArray(rawRequests)) {
    throw new PlanSourceError(
      'invalid_response',
      'Plan server returned invalid professional change request list.',
    );
  }
  return rawRequests
    .map(parseServerPlanChangeRequest)
    .filter((request): request is PlanChangeRequest => request !== null);
}

async function reviewPlanChangeRequestOnServer(
  requestId: string,
  status: 'reviewed' | 'dismissed',
  deps: PlanSourceDeps,
): Promise<{ id: string; status: PlanChangeRequestStatus } | null> {
  const source = await getServerPlanSource(deps);
  if (!source) return null;

  let response: Response;
  try {
    response = await source.fetchFn(
      `${source.baseUrl}/plans/change-requests/${encodeURIComponent(requestId)}/review`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${source.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      },
    );
  } catch (error) {
    throw new PlanSourceError(
      'network',
      (error as Error)?.message ?? 'Plan server request failed.',
    );
  }

  const payload = await readServerJson(response);
  if (!response.ok) throw planServerError(response.status, payload);

  const nextStatus = normalizePlanChangeRequestStatus((payload as { status?: unknown }).status);
  if (typeof (payload as { id?: unknown }).id !== 'string' || !nextStatus) {
    throw new PlanSourceError(
      'invalid_response',
      'Plan server returned an invalid review response.',
    );
  }

  return {
    id: (payload as { id: string }).id,
    status: nextStatus,
  };
}

async function getMyPlansFromServer(deps: PlanSourceDeps): Promise<Plan[] | null> {
  const source = await getServerPlanSource(deps);
  if (!source) return null;

  let response: Response;
  try {
    response = await source.fetchFn(`${source.baseUrl}/plans/my`, {
      headers: {
        Authorization: `Bearer ${source.token}`,
      },
    });
  } catch (error) {
    throw new PlanSourceError(
      'network',
      (error as Error)?.message ?? 'Plan server request failed.',
    );
  }

  const payload = await readServerJson(response);
  if (!response.ok) throw planServerError(response.status, payload);

  const rawPlans = (payload as { plans?: unknown }).plans;
  if (!Array.isArray(rawPlans)) {
    throw new PlanSourceError('invalid_response', 'Plan server returned invalid plan list.');
  }

  return rawPlans.map(parseServerPlan).filter((plan): plan is Plan => plan !== null);
}

async function getMyPredefinedPlansFromServer(
  deps: PlanSourceDeps,
): Promise<PredefinedPlan[] | null> {
  const source = await getServerPlanSource(deps);
  if (!source) return null;

  let response: Response;
  try {
    response = await source.fetchFn(`${source.baseUrl}/plans/predefined`, {
      headers: {
        Authorization: `Bearer ${source.token}`,
      },
    });
  } catch (error) {
    throw new PlanSourceError(
      'network',
      (error as Error)?.message ?? 'Plan server request failed.',
    );
  }

  const payload = await readServerJson(response);
  if (!response.ok) throw planServerError(response.status, payload);

  const rawPlans = (payload as { plans?: unknown }).plans;
  if (!Array.isArray(rawPlans)) {
    throw new PlanSourceError(
      'invalid_response',
      'Plan server returned invalid predefined plan list.',
    );
  }

  return rawPlans
    .map(parseServerPredefinedPlan)
    .filter((plan): plan is PredefinedPlan => plan !== null);
}

async function bulkAssignPredefinedPlanOnServer(
  predefinedPlanId: string,
  studentUids: string[],
  deps: PlanSourceDeps,
): Promise<{ assignedCount: number } | null> {
  const source = await getServerPlanSource(deps);
  if (!source) return null;

  let response: Response;
  try {
    response = await source.fetchFn(
      `${source.baseUrl}/plans/predefined/${encodeURIComponent(predefinedPlanId)}/bulk-assign`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${source.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ studentUids }),
      },
    );
  } catch (error) {
    throw new PlanSourceError(
      'network',
      (error as Error)?.message ?? 'Plan server request failed.',
    );
  }

  const payload = await readServerJson(response);
  if (!response.ok) throw planServerError(response.status, payload);

  const assignedCount = (payload as { assignedCount?: unknown }).assignedCount;
  if (typeof assignedCount !== 'number' || !Number.isFinite(assignedCount)) {
    throw new PlanSourceError(
      'invalid_response',
      'Plan server returned invalid assignment result.',
    );
  }
  return { assignedCount };
}

async function createDraftAssignedPlanOnServer(
  predefinedPlanId: string,
  studentUid: string,
  deps: PlanSourceDeps,
): Promise<{ id: string } | null> {
  const source = await getServerPlanSource(deps);
  if (!source) return null;

  let response: Response;
  try {
    response = await source.fetchFn(
      `${source.baseUrl}/plans/predefined/${encodeURIComponent(predefinedPlanId)}/draft-assignments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${source.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ studentUid }),
      },
    );
  } catch (error) {
    throw new PlanSourceError(
      'network',
      (error as Error)?.message ?? 'Plan server request failed.',
    );
  }

  const payload = await readServerJson(response);
  if (!response.ok) throw planServerError(response.status, payload);

  const plan = parseServerPlan((payload as { plan?: unknown }).plan);
  if (!plan || !plan.isDraft || plan.sourceKind !== 'assigned') {
    throw new PlanSourceError(
      'invalid_response',
      'Plan server returned an invalid draft assignment.',
    );
  }

  return { id: plan.id };
}

export function shouldExposePlanInMyPlans(raw: PlanVisibilityInput, currentUid: string): boolean {
  return !(
    raw.planType === 'nutrition' &&
    raw.studentAuthUid === currentUid &&
    raw.ownerProfessionalUid !== currentUid &&
    raw.sourceKind === 'assigned' &&
    raw.isDraft === true
  );
}

export async function getMyPlans(deps = defaultDeps): Promise<Plan[]> {
  if (deps === defaultDeps) {
    if (
      getE2EPlanSourceOverride() &&
      process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE === 'error'
    ) {
      throw new PlanSourceError('network', 'E2E fixture: forced plan list read failure.');
    }

    const e2ePlans = getE2EAssignedPlanFixtures();
    if (e2ePlans) return e2ePlans;
  }

  try {
    const serverPlans = requireServerResult(await getMyPlansFromServer(deps), 'Plan list reads');
    setCachedPlans(serverPlans);
    return serverPlans;
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function getMyPredefinedPlans(deps = defaultDeps): Promise<PredefinedPlan[]> {
  if (deps === defaultDeps) {
    const e2ePlans = getE2EPredefinedPlans();
    if (e2ePlans) {
      const result = e2ePlans.map(cloneE2EPredefinedPlan);
      setCachedPredefinedPlans(result);
      return result;
    }
  }

  try {
    const serverPlans = requireServerResult(
      await getMyPredefinedPlansFromServer(deps),
      'Predefined plan reads',
    );
    const result = [...serverPlans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setCachedPredefinedPlans(result);
    return result;
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function bulkAssignPredefinedPlan(
  predefinedPlanId: string,
  studentUids: string[],
  deps = defaultDeps,
): Promise<{ assignedCount: number }> {
  if (deps === defaultDeps) {
    const e2ePlans = getE2EPredefinedPlans();
    if (e2ePlans) {
      const source = e2ePlans.find((plan) => plan.id === predefinedPlanId);
      if (!source) {
        throw new PlanSourceError('graphql', 'Predefined plan not found.');
      }

      const uniqueStudentUids = [...new Set(studentUids)].filter(Boolean);
      const validation = validatePlanAssignmentTargets({
        planType: source.planType,
        targetStudentUids: uniqueStudentUids,
        activeStudentUids: getE2EActiveStudentUidsForPlanType(source.planType),
      });
      if (!validation.isValid) {
        throw new PlanSourceError(
          'configuration',
          `No active assignment for ${validation.requiredSpecialty}: ${validation.invalidStudentUids.join(', ')}`,
        );
      }

      const timestamp = nowIso();
      for (const studentUid of uniqueStudentUids) {
        e2eAssignedPlanSequence += 1;
        e2eAssignedPlans.push({
          id: `${source.id}-assigned-${e2eAssignedPlanSequence}`,
          planType: source.planType,
          sourceKind: 'assigned',
          ownerProfessionalUid: source.ownerProfessionalUid,
          studentUid,
          isArchived: false,
          isDraft: false,
          name: source.name,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      return { assignedCount: uniqueStudentUids.length };
    }
  }

  try {
    return requireServerResult(
      await bulkAssignPredefinedPlanOnServer(predefinedPlanId, studentUids, deps),
      'Predefined bulk assignment',
    );
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function createDraftAssignedPlan(
  predefinedPlanId: string,
  studentUid: string,
  deps = defaultDeps,
): Promise<{ id: string }> {
  if (deps === defaultDeps) {
    const e2ePlans = getE2EPredefinedPlans();
    if (e2ePlans) {
      const source = e2ePlans.find((plan) => plan.id === predefinedPlanId);
      if (!source) {
        throw new PlanSourceError('graphql', 'Predefined plan not found.');
      }

      const validation = validatePlanAssignmentTargets({
        planType: source.planType,
        targetStudentUids: [studentUid],
        activeStudentUids: getE2EActiveStudentUidsForPlanType(source.planType),
      });
      if (!validation.isValid) {
        throw new PlanSourceError(
          'configuration',
          `No active assignment for ${validation.requiredSpecialty}: ${validation.invalidStudentUids.join(', ')}`,
        );
      }

      const timestamp = nowIso();
      e2eAssignedPlanSequence += 1;
      const id = `${source.id}-draft-${e2eAssignedPlanSequence}`;
      e2eAssignedPlans.push({
        id,
        planType: source.planType,
        sourceKind: 'assigned',
        ownerProfessionalUid: source.ownerProfessionalUid,
        studentUid,
        isArchived: false,
        isDraft: true,
        name: source.name,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return { id };
    }
  }

  try {
    return requireServerResult(
      await createDraftAssignedPlanOnServer(predefinedPlanId, studentUid, deps),
      'Predefined draft assignment',
    );
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function submitPlanChangeRequest(
  planId: string,
  planType: PlanType,
  requestText: string,
  deps = defaultDeps,
): Promise<PlanChangeRequest> {
  if (deps === defaultDeps && getE2EPlanSourceOverride()) {
    const studentUid = getE2EPlanSourceOverride()?.uid ?? 'e2e-auth-session-user';
    return {
      id: `e2e-plan-change-request-${Date.now()}`,
      planId,
      planType,
      studentUid,
      requestText,
      status: 'pending',
      createdAt: nowIso(),
    };
  }

  try {
    return requireServerResult(
      await submitPlanChangeRequestToServer(planId, planType, requestText, deps),
      'Plan change request submission',
    );
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function getStudentPlanChangeRequests(
  studentUid: string,
  deps = defaultDeps,
): Promise<PlanChangeRequest[]> {
  if (deps === defaultDeps) {
    const e2eRequests = getE2EPlanChangeRequests(studentUid);
    if (e2eRequests) return e2eRequests;
  }

  try {
    return requireServerResult(
      await getStudentPlanChangeRequestsFromServer(studentUid, deps),
      'Plan change request reads',
    );
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function getProfessionalPlanChangeRequests(
  deps = defaultDeps,
): Promise<PlanChangeRequest[]> {
  if (deps === defaultDeps) {
    const e2eRequests = getE2EPlanChangeRequests('e2e-dual-student');
    if (e2eRequests) return e2eRequests;
  }

  try {
    return requireServerResult(
      await getProfessionalPlanChangeRequestsFromServer(deps),
      'Professional plan change request reads',
    );
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

export async function reviewPlanChangeRequest(
  requestId: string,
  status: 'reviewed' | 'dismissed',
  deps = defaultDeps,
): Promise<{ id: string; status: PlanChangeRequestStatus }> {
  if (deps === defaultDeps && getE2EPlanSourceOverride()) {
    if (requestId !== 'e2e-plan-change-request-nutrition') {
      throw new PlanSourceError('graphql', 'Plan change request not found.');
    }
    e2ePlanChangeRequestStatus = status;
    return { id: requestId, status };
  }

  try {
    return requireServerResult(
      await reviewPlanChangeRequestOnServer(requestId, status, deps),
      'Plan change request review',
    );
  } catch (error) {
    throw normalizePlanSourceError(error);
  }
}

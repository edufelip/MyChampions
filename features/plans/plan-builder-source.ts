/**
 * Plan builder server source — nutrition/training CRUD,
 * starter templates, and food search service integration.
 */

import { readE2EPlanFixtureList, writeE2EPlanFixtureList } from './e2e-plan-fixture-storage';
import {
  deriveStarterTemplatePlanType,
  coalesceTemplateDescription,
  calculateTotalsFromMeals,
  resolveNutritionPlanCreationMetadata,
  resolveTrainingPlanCreationMetadata,
} from './plan-builder.logic';
import {
  getE2EAssignedPlanFixture,
  removeE2EPredefinedPlanFixture,
  removeE2EAssignedPlanFixture,
  updateE2EAssignedPlanFixture,
  upsertE2EMyPlanFixture,
  upsertE2EPredefinedPlanFixture,
} from './plan-source';
import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getValidServerAccessToken } from '../auth/server-auth-source';
import { searchFoodsFromSource } from '../nutrition/food-search-source';
import type {
  NutritionPlanInput,
  NutritionPlanCreationMode,
  NutritionMeal,
  NutritionMealInput,
  NutritionMealItem,
  NutritionMealItemInput,
  TrainingPlanInput,
  TrainingPlanCreationMode,
  TrainingSession,
  TrainingSessionInput,
  TrainingSessionItem,
  TrainingSessionItemInput,
  StarterTemplate,
  FoodSearchResult,
} from './plan-builder.logic';
import type { PlanType } from './plan-change-request.logic';

// ─── Error types ──────────────────────────────────────────────────────────────

type PlanBuilderSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class PlanBuilderSourceError extends Error {
  code: PlanBuilderSourceErrorCode;

  constructor(code: PlanBuilderSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PlanBuilderSourceError';
  }
}

export type NutritionPlanDetail = {
  id: string;
  name: string;
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  hydrationGoalMl: number | null;
  caloriesTarget: number;
  carbsTarget: number;
  proteinsTarget: number;
  fatsTarget: number;
  meals: NutritionMeal[];
  isDraft?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TrainingPlanDetail = {
  id: string;
  name: string;
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  sessions: TrainingSession[];
  isDraft?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type { FoodSearchResult } from './plan-builder.logic';

export type PlanBuilderSourceDeps = {
  getServerBaseUrl?: () => string | undefined;
  getCurrentAccessToken?: () => Promise<string | null>;
  fetchFn?: AppFetch;
};

export type StarterTemplateDeps = PlanBuilderSourceDeps;

const defaultDeps: PlanBuilderSourceDeps = {
  getServerBaseUrl: defaultGetServerBaseUrl,
  getCurrentAccessToken: () => getValidServerAccessToken(),
  fetchFn: globalThis.fetch.bind(globalThis),
};

function nowIso(): string {
  return new Date().toISOString();
}

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

function normalizePlanBuilderSourceError(error: unknown): PlanBuilderSourceError {
  if (error instanceof PlanBuilderSourceError) return error;

  return new PlanBuilderSourceError(
    'invalid_response',
    (error as Error)?.message ?? 'Unexpected plan builder source error.',
  );
}

function resolveServerPlanBuilderSource(deps: PlanBuilderSourceDeps): {
  baseUrl: string;
  fetchFn: AppFetch;
} | null {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const sourceFetch = deps.fetchFn ?? globalThis.fetch;
  if (!baseUrl || !sourceFetch) return null;

  // Browser fetch is a host function and must retain the global receiver. Calling it
  // later as `source.fetchFn(...)` otherwise supplies the source object as `this`,
  // which Firefox rejects with "Illegal invocation".
  const fetchFn: AppFetch = (input, init) => Reflect.apply(sourceFetch, globalThis, [input, init]);

  return { baseUrl, fetchFn };
}

async function getServerPlanBuilderSource(deps: PlanBuilderSourceDeps): Promise<{
  baseUrl: string;
  token: string;
  fetchFn: AppFetch;
} | null> {
  const source = resolveServerPlanBuilderSource(deps);
  if (!source) return null;
  const token = await (deps.getCurrentAccessToken?.() ?? Promise.resolve(null));
  if (!token) return null;
  return { ...source, token };
}

function requireServerResult<T>(value: T | null, operation: string): T {
  if (value === null) {
    throw new PlanBuilderSourceError(
      'configuration',
      `${operation} requires the local MyChampions server URL and bearer token.`,
    );
  }
  return value;
}

function requireServerSuccess(value: boolean, operation: string): void {
  if (!value) {
    throw new PlanBuilderSourceError(
      'configuration',
      `${operation} requires the local MyChampions server URL and bearer token.`,
    );
  }
}

function parseServerNutritionPlanDetail(raw: unknown): NutritionPlanDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<NutritionPlanDetail>;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    (value.sourceKind !== 'predefined' &&
      value.sourceKind !== 'assigned' &&
      value.sourceKind !== 'self_managed') ||
    typeof value.studentAuthUid !== 'string' ||
    !Array.isArray(value.meals) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    sourceKind: value.sourceKind,
    ownerProfessionalUid:
      typeof value.ownerProfessionalUid === 'string' ? value.ownerProfessionalUid : null,
    studentAuthUid: value.studentAuthUid,
    hydrationGoalMl: typeof value.hydrationGoalMl === 'number' ? value.hydrationGoalMl : null,
    caloriesTarget: typeof value.caloriesTarget === 'number' ? value.caloriesTarget : 0,
    carbsTarget: typeof value.carbsTarget === 'number' ? value.carbsTarget : 0,
    proteinsTarget: typeof value.proteinsTarget === 'number' ? value.proteinsTarget : 0,
    fatsTarget: typeof value.fatsTarget === 'number' ? value.fatsTarget : 0,
    meals: value.meals,
    isDraft: value.isDraft || undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseServerTrainingPlanDetail(raw: unknown): TrainingPlanDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<TrainingPlanDetail>;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    (value.sourceKind !== 'predefined' &&
      value.sourceKind !== 'assigned' &&
      value.sourceKind !== 'self_managed') ||
    typeof value.studentAuthUid !== 'string' ||
    !Array.isArray(value.sessions) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    sourceKind: value.sourceKind,
    ownerProfessionalUid:
      typeof value.ownerProfessionalUid === 'string' ? value.ownerProfessionalUid : null,
    studentAuthUid: value.studentAuthUid,
    sessions: value.sessions,
    isDraft: value.isDraft || undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseServerStarterTemplate(raw: unknown): StarterTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<StarterTemplate>;
  if (
    typeof value.id !== 'string' ||
    (value.planType !== 'nutrition' && value.planType !== 'training') ||
    typeof value.name !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    planType: value.planType,
    name: value.name,
    description: coalesceTemplateDescription(value.description),
  };
}

async function readServerErrorPayload(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function extractServerError(payload: unknown): { code: string | null; message: string | null } {
  const error =
    payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : null;
  if (typeof error === 'string') {
    return { code: error, message: null };
  }
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown };
    return {
      code: typeof value.code === 'string' ? value.code : null,
      message: typeof value.message === 'string' ? value.message : null,
    };
  }
  return { code: null, message: null };
}

async function throwPlanBuilderServerError(
  response: Response,
  fallbackMessage: string,
  notFoundMessage: string,
): Promise<never> {
  if (response.status === 404) {
    throw new PlanBuilderSourceError('graphql', notFoundMessage);
  }

  const serverError = extractServerError(await readServerErrorPayload(response));
  if (response.status === 402 && serverError.code === 'professional_subscription_required') {
    throw new PlanBuilderSourceError(
      'graphql',
      serverError.message ?? 'Professional subscription required.',
    );
  }

  throw new PlanBuilderSourceError('network', fallbackMessage);
}

function parseServerNutritionMeal(raw: unknown): NutritionMeal | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<NutritionMeal>;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    items: value.items,
  };
}

function parseServerNutritionMealItem(raw: unknown): NutritionMealItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<NutritionMealItem>;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.quantity !== 'string' ||
    typeof value.notes !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    quantity: value.quantity,
    notes: value.notes,
    ...(typeof value.calories === 'number' ? { calories: value.calories } : {}),
    ...(typeof value.carbs === 'number' ? { carbs: value.carbs } : {}),
    ...(typeof value.proteins === 'number' ? { proteins: value.proteins } : {}),
    ...(typeof value.fats === 'number' ? { fats: value.fats } : {}),
    ...(value.sourceKind ? { sourceKind: value.sourceKind } : {}),
    ...(value.customMealSnapshot !== undefined
      ? { customMealSnapshot: value.customMealSnapshot }
      : {}),
  };
}

function parseServerTrainingSession(raw: unknown): TrainingSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<TrainingSession>;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.notes !== 'string' ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    notes: value.notes,
    items: value.items,
  };
}

function parseServerTrainingSessionItem(raw: unknown): TrainingSessionItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<TrainingSessionItem>;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.quantity !== 'string' ||
    typeof value.notes !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    quantity: value.quantity,
    notes: value.notes,
    ...(value.exerciseId ? { exerciseId: value.exerciseId } : {}),
    ...(value.ymoveId ? { ymoveId: value.ymoveId } : {}),
  };
}

async function getNutritionPlanDetailFromServer(
  planId: string,
  deps: PlanBuilderSourceDeps,
): Promise<NutritionPlanDetail | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${source.token}`,
      },
    },
  );
  if (response.status === 404) {
    throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
  }
  if (!response.ok) {
    throw new PlanBuilderSourceError(
      'network',
      `Server nutrition plan detail failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as { plan?: unknown };
  const plan = parseServerNutritionPlanDetail(payload.plan);
  if (!plan) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid nutrition plan detail.',
    );
  }
  return plan;
}

async function updateNutritionPlanOnServer(
  planId: string,
  input: NutritionPlanInput,
  publish: boolean | undefined,
  deps: PlanBuilderSourceDeps,
): Promise<NutritionPlanDetail | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const hydrationGoalMl = parseInt(input.hydrationGoalMl.trim(), 10);
  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name.trim(),
        hydrationGoalMl:
          Number.isFinite(hydrationGoalMl) && hydrationGoalMl > 0 ? hydrationGoalMl : null,
        publish,
      }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition plan update failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }

  const payload = (await response.json()) as { plan?: unknown };
  const plan = parseServerNutritionPlanDetail(payload.plan);
  if (!plan) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid nutrition plan detail.',
    );
  }
  return plan;
}

async function createNutritionPlanOnServer(
  input: NutritionPlanInput,
  mode: NutritionPlanCreationMode,
  deps: PlanBuilderSourceDeps,
): Promise<NutritionPlanDetail | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const hydrationGoalMl = parseInt(input.hydrationGoalMl.trim(), 10);
  const response = await source.fetchFn(`${source.baseUrl}/plans/nutrition`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${source.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name.trim(),
      hydrationGoalMl:
        Number.isFinite(hydrationGoalMl) && hydrationGoalMl > 0 ? hydrationGoalMl : null,
      mode,
    }),
  });
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition plan creation failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }

  const payload = (await response.json()) as { plan?: unknown };
  const plan = parseServerNutritionPlanDetail(payload.plan);
  if (!plan) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid nutrition plan detail.',
    );
  }
  return plan;
}

async function deleteNutritionPlanOnServer(
  planId: string,
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${source.token}`,
      },
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition plan delete failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }
  return true;
}

async function addNutritionMealOnServer(
  planId: string,
  meal: NutritionMealInput,
  deps: PlanBuilderSourceDeps,
): Promise<NutritionMeal | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}/meals`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: meal.name.trim() }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition meal creation failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }

  const payload = (await response.json()) as { meal?: unknown };
  const serverMeal = parseServerNutritionMeal(payload.meal);
  if (!serverMeal) {
    throw new PlanBuilderSourceError('invalid_response', 'Server returned invalid nutrition meal.');
  }
  return serverMeal;
}

async function removeNutritionMealOnServer(
  planId: string,
  mealId: string,
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}/meals/${encodeURIComponent(mealId)}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${source.token}` },
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition meal removal failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }
  return true;
}

async function reorderNutritionMealsOnServer(
  planId: string,
  mealIds: string[],
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}/meals/reorder`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mealIds }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition meal reorder failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }
  return true;
}

async function addNutritionMealItemOnServer(
  planId: string,
  mealId: string,
  item: NutritionMealItemInput,
  deps: PlanBuilderSourceDeps,
): Promise<NutritionMealItem | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}/meals/${encodeURIComponent(mealId)}/items`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: item.name.trim(),
        quantity: item.quantity,
        notes: item.notes,
        ...(typeof item.calories === 'number' ? { calories: item.calories } : {}),
        ...(typeof item.carbs === 'number' ? { carbs: item.carbs } : {}),
        ...(typeof item.proteins === 'number' ? { proteins: item.proteins } : {}),
        ...(typeof item.fats === 'number' ? { fats: item.fats } : {}),
        ...(item.sourceKind ? { sourceKind: item.sourceKind } : {}),
        ...(item.customMealSnapshot !== undefined
          ? { customMealSnapshot: item.customMealSnapshot }
          : {}),
      }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition meal item creation failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }

  const payload = (await response.json()) as { item?: unknown };
  const serverItem = parseServerNutritionMealItem(payload.item);
  if (!serverItem) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid nutrition meal item.',
    );
  }
  return serverItem;
}

async function removeNutritionMealItemOnServer(
  planId: string,
  mealId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}/meals/${encodeURIComponent(mealId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${source.token}` },
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition meal item removal failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }
  return true;
}

async function reorderNutritionMealItemsOnServer(
  planId: string,
  mealId: string,
  itemIds: string[],
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/nutrition/${encodeURIComponent(planId)}/meals/${encodeURIComponent(mealId)}/items/reorder`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ itemIds }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server nutrition meal item reorder failed with status ${response.status}.`,
      'Nutrition plan not found.',
    );
  }
  return true;
}

async function getTrainingPlanDetailFromServer(
  planId: string,
  deps: PlanBuilderSourceDeps,
): Promise<TrainingPlanDetail | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${source.token}`,
      },
    },
  );
  if (response.status === 404) {
    throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
  }
  if (!response.ok) {
    throw new PlanBuilderSourceError(
      'network',
      `Server training plan detail failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as { plan?: unknown };
  const plan = parseServerTrainingPlanDetail(payload.plan);
  if (!plan) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid training plan detail.',
    );
  }
  return plan;
}

async function createTrainingPlanOnServer(
  input: TrainingPlanInput,
  mode: TrainingPlanCreationMode,
  deps: PlanBuilderSourceDeps,
): Promise<TrainingPlanDetail | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(`${source.baseUrl}/plans/training`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${source.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name.trim(),
      mode,
    }),
  });
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training plan creation failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }

  const payload = (await response.json()) as { plan?: unknown };
  const plan = parseServerTrainingPlanDetail(payload.plan);
  if (!plan) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid training plan detail.',
    );
  }
  return plan;
}

async function deleteTrainingPlanOnServer(
  planId: string,
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${source.token}`,
      },
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training plan delete failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }
  return true;
}

async function addTrainingSessionOnServer(
  planId: string,
  session: TrainingSessionInput,
  deps: PlanBuilderSourceDeps,
): Promise<TrainingSession | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}/sessions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: session.name.trim(),
        notes: session.notes.trim(),
      }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training session creation failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }

  const payload = (await response.json()) as { session?: unknown };
  const serverSession = parseServerTrainingSession(payload.session);
  if (!serverSession) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid training session.',
    );
  }
  return serverSession;
}

async function removeTrainingSessionOnServer(
  planId: string,
  sessionId: string,
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${source.token}` },
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training session removal failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }
  return true;
}

async function reorderTrainingSessionsOnServer(
  planId: string,
  sessionIds: string[],
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}/sessions/reorder`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sessionIds }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training session reorder failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }
  return true;
}

async function addTrainingSessionItemOnServer(
  planId: string,
  sessionId: string,
  item: TrainingSessionItemInput,
  deps: PlanBuilderSourceDeps,
): Promise<TrainingSessionItem | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}/sessions/${encodeURIComponent(sessionId)}/items`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: item.name.trim(),
        quantity: item.quantity ?? '',
        notes: item.notes ?? '',
        ...(item.exerciseId ? { exerciseId: item.exerciseId } : {}),
        ...(item.ymoveId ? { ymoveId: item.ymoveId } : {}),
      }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training session item creation failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }

  const payload = (await response.json()) as { item?: unknown };
  const serverItem = parseServerTrainingSessionItem(payload.item);
  if (!serverItem) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid training session item.',
    );
  }
  return serverItem;
}

async function removeTrainingSessionItemOnServer(
  planId: string,
  sessionId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${source.token}` },
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training session item removal failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }
  return true;
}

async function reorderTrainingSessionItemsOnServer(
  planId: string,
  sessionId: string,
  itemIds: string[],
  deps: PlanBuilderSourceDeps,
): Promise<boolean> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return false;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}/sessions/${encodeURIComponent(sessionId)}/items/reorder`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ itemIds }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training session item reorder failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }
  return true;
}

async function getStarterTemplatesFromServer(
  planType: PlanType,
  deps: PlanBuilderSourceDeps,
): Promise<StarterTemplate[] | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/starter-templates?planType=${planType}`,
    {
      headers: {
        authorization: `Bearer ${source.token}`,
      },
    },
  );

  if (response.status === 401) {
    throw new PlanBuilderSourceError('graphql', 'Starter templates require authentication.');
  }
  if (!response.ok) {
    throw new PlanBuilderSourceError(
      'network',
      `Server starter template list failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as { templates?: unknown[] };
  if (!Array.isArray(payload.templates)) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid starter template list.',
    );
  }

  const templates = payload.templates.map(parseServerStarterTemplate);
  if (templates.some((template) => template === null)) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid starter template.',
    );
  }

  return templates as StarterTemplate[];
}

async function cloneStarterTemplateOnServer(
  templateId: string,
  name: string,
  deps: PlanBuilderSourceDeps,
): Promise<NutritionPlanDetail | TrainingPlanDetail | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/starter-templates/${encodeURIComponent(templateId)}/clone`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: name.trim() }),
    },
  );

  if (response.status === 401) {
    throw new PlanBuilderSourceError('graphql', 'Starter template clone requires authentication.');
  }
  if (response.status === 404) {
    throw new PlanBuilderSourceError('graphql', 'Starter template not found.');
  }
  if (!response.ok) {
    throw new PlanBuilderSourceError(
      'network',
      `Server starter template clone failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as { plan?: unknown };
  const planType = deriveStarterTemplatePlanType(templateId);
  const plan =
    planType === 'nutrition'
      ? parseServerNutritionPlanDetail(payload.plan)
      : planType === 'training'
        ? parseServerTrainingPlanDetail(payload.plan)
        : null;

  if (!plan) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid cloned starter template plan.',
    );
  }

  return plan;
}

async function updateTrainingPlanOnServer(
  planId: string,
  input: TrainingPlanInput,
  sessions: TrainingSession[] | undefined,
  publish: boolean | undefined,
  deps: PlanBuilderSourceDeps,
): Promise<TrainingPlanDetail | null> {
  const source = await getServerPlanBuilderSource(deps);
  if (!source) return null;

  const response = await source.fetchFn(
    `${source.baseUrl}/plans/training/${encodeURIComponent(planId)}`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${source.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name.trim(),
        publish,
        ...(sessions ? { sessions } : {}),
      }),
    },
  );
  if (!response.ok) {
    await throwPlanBuilderServerError(
      response,
      `Server training plan update failed with status ${response.status}.`,
      'Training plan not found.',
    );
  }

  const payload = (await response.json()) as { plan?: unknown };
  const plan = parseServerTrainingPlanDetail(payload.plan);
  if (!plan) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Server returned invalid training plan detail.',
    );
  }
  return plan;
}

let e2eNutritionPlanSequence = 0;
let e2eNutritionMealSequence = 0;
let e2eNutritionItemSequence = 0;
const e2eNutritionPlanDetails: NutritionPlanDetail[] = [];
let e2eTrainingPlanSequence = 0;
const e2eTrainingPlanDetails: TrainingPlanDetail[] = [];
let hydratedE2EPlanBuilderScope: string | null = null;

function hydrateE2EPlanBuilderFixtures(scope: string): void {
  if (hydratedE2EPlanBuilderScope === scope) return;

  e2eNutritionPlanDetails.length = 0;
  e2eTrainingPlanDetails.length = 0;
  e2eNutritionPlanSequence = 0;
  e2eNutritionMealSequence = 0;
  e2eNutritionItemSequence = 0;
  e2eTrainingPlanSequence = 0;

  e2eNutritionPlanDetails.push(
    ...readE2EPlanFixtureList<NutritionPlanDetail>(scope, 'nutrition-details'),
  );
  e2eTrainingPlanDetails.push(
    ...readE2EPlanFixtureList<TrainingPlanDetail>(scope, 'training-details'),
  );

  e2eNutritionPlanSequence = Math.max(
    e2eNutritionPlanSequence,
    ...e2eNutritionPlanDetails.map((plan) =>
      extractE2ESequence(plan.id, 'e2e-nutrition-builder-plan-'),
    ),
  );
  e2eNutritionMealSequence = Math.max(
    e2eNutritionMealSequence,
    ...e2eNutritionPlanDetails.flatMap((plan) =>
      plan.meals.map((meal) => extractE2ESequence(meal.id, 'e2e-nutrition-meal-')),
    ),
  );
  e2eNutritionItemSequence = Math.max(
    e2eNutritionItemSequence,
    ...e2eNutritionPlanDetails.flatMap((plan) =>
      plan.meals.flatMap((meal) =>
        meal.items.map((item) => extractE2ESequence(item.id, 'e2e-nutrition-item-')),
      ),
    ),
  );
  e2eTrainingPlanSequence = Math.max(
    e2eTrainingPlanSequence,
    ...e2eTrainingPlanDetails.map((plan) =>
      extractE2ESequence(plan.id, 'e2e-training-builder-plan-'),
    ),
  );
  hydratedE2EPlanBuilderScope = scope;
}

function extractE2ESequence(id: string, prefix: string): number {
  if (!id.startsWith(prefix)) return 0;
  const sequence = Number(id.slice(prefix.length));
  return Number.isFinite(sequence) ? sequence : 0;
}

function persistE2EPlanBuilderFixtures(scope: string): void {
  writeE2EPlanFixtureList(scope, 'nutrition-details', e2eNutritionPlanDetails);
  writeE2EPlanFixtureList(scope, 'training-details', e2eTrainingPlanDetails);
}

function getE2EPlanBuilderOverride() {
  if (process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE !== 'basic') return null;
  const override = resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
  if (override) hydrateE2EPlanBuilderFixtures(override.uid);
  return override;
}

function getE2EAssignedNutritionPlanBuilderOverride() {
  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

function getE2EAssignedTrainingPlanBuilderOverride() {
  if (process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE !== 'assigned') return null;

  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

function cloneNutritionPlanDetail(plan: NutritionPlanDetail): NutritionPlanDetail {
  return {
    ...plan,
    meals: plan.meals.map((meal) => ({
      ...meal,
      items: meal.items.map((item) => ({
        ...item,
        customMealSnapshot: item.customMealSnapshot ? { ...item.customMealSnapshot } : undefined,
      })),
    })),
  };
}

function cloneTrainingPlanDetail(plan: TrainingPlanDetail): TrainingPlanDetail {
  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({
      ...session,
      items: session.items.map((item) => ({ ...item })),
    })),
  };
}

function findE2ENutritionPlanDetail(planId: string): NutritionPlanDetail | null | undefined {
  if (!getE2EPlanBuilderOverride()) return undefined;
  const plan = e2eNutritionPlanDetails.find((candidate) => candidate.id === planId);
  return plan ? cloneNutritionPlanDetail(plan) : null;
}

function findE2ETrainingPlanDetail(planId: string): TrainingPlanDetail | null | undefined {
  if (!getE2EPlanBuilderOverride()) return undefined;
  const plan = e2eTrainingPlanDetails.find((candidate) => candidate.id === planId);
  return plan ? cloneTrainingPlanDetail(plan) : null;
}

function updateE2ENutritionPlanDetail(
  planId: string,
  updater: (plan: NutritionPlanDetail) => NutritionPlanDetail,
): NutritionPlanDetail | null | undefined {
  const override = getE2EPlanBuilderOverride();
  if (!override) return undefined;
  const index = e2eNutritionPlanDetails.findIndex((candidate) => candidate.id === planId);
  if (index < 0) return null;

  const updated = updater(cloneNutritionPlanDetail(e2eNutritionPlanDetails[index]));
  const totals = calculateTotalsFromMeals(updated.meals);
  e2eNutritionPlanDetails[index] = {
    ...updated,
    caloriesTarget: totals.calories,
    carbsTarget: totals.carbs,
    proteinsTarget: totals.proteins,
    fatsTarget: totals.fats,
    updatedAt: nowIso(),
  };

  if (e2eNutritionPlanDetails[index].sourceKind === 'predefined') {
    upsertE2EPredefinedPlanFixture({
      id: e2eNutritionPlanDetails[index].id,
      name: e2eNutritionPlanDetails[index].name,
      planType: 'nutrition',
      ownerProfessionalUid: e2eNutritionPlanDetails[index].ownerProfessionalUid ?? '',
      createdAt: e2eNutritionPlanDetails[index].createdAt,
      updatedAt: e2eNutritionPlanDetails[index].updatedAt,
    });
  } else if (e2eNutritionPlanDetails[index].sourceKind === 'self_managed') {
    upsertE2EMyPlanFixture({
      id: e2eNutritionPlanDetails[index].id,
      name: e2eNutritionPlanDetails[index].name,
      planType: 'nutrition',
      sourceKind: 'self_managed',
      ownerProfessionalUid: e2eNutritionPlanDetails[index].ownerProfessionalUid,
      studentUid: e2eNutritionPlanDetails[index].studentAuthUid,
      isArchived: false,
      isDraft: false,
      createdAt: e2eNutritionPlanDetails[index].createdAt,
      updatedAt: e2eNutritionPlanDetails[index].updatedAt,
    });
  }

  persistE2EPlanBuilderFixtures(override.uid);

  return cloneNutritionPlanDetail(e2eNutritionPlanDetails[index]);
}

function updateE2ETrainingPlanDetail(
  planId: string,
  updater: (plan: TrainingPlanDetail) => TrainingPlanDetail,
): TrainingPlanDetail | null | undefined {
  const override = getE2EPlanBuilderOverride();
  if (!override) return undefined;
  const index = e2eTrainingPlanDetails.findIndex((candidate) => candidate.id === planId);
  if (index < 0) return null;

  const updated = updater(cloneTrainingPlanDetail(e2eTrainingPlanDetails[index]));
  e2eTrainingPlanDetails[index] = {
    ...updated,
    updatedAt: nowIso(),
  };

  if (e2eTrainingPlanDetails[index].sourceKind === 'predefined') {
    upsertE2EPredefinedPlanFixture({
      id: e2eTrainingPlanDetails[index].id,
      name: e2eTrainingPlanDetails[index].name,
      planType: 'training',
      ownerProfessionalUid: e2eTrainingPlanDetails[index].ownerProfessionalUid ?? '',
      createdAt: e2eTrainingPlanDetails[index].createdAt,
      updatedAt: e2eTrainingPlanDetails[index].updatedAt,
    });
  } else if (e2eTrainingPlanDetails[index].sourceKind === 'self_managed') {
    upsertE2EMyPlanFixture({
      id: e2eTrainingPlanDetails[index].id,
      name: e2eTrainingPlanDetails[index].name,
      planType: 'training',
      sourceKind: 'self_managed',
      ownerProfessionalUid: e2eTrainingPlanDetails[index].ownerProfessionalUid,
      studentUid: e2eTrainingPlanDetails[index].studentAuthUid,
      isArchived: false,
      isDraft: false,
      createdAt: e2eTrainingPlanDetails[index].createdAt,
      updatedAt: e2eTrainingPlanDetails[index].updatedAt,
    });
  }

  persistE2EPlanBuilderFixtures(override.uid);

  return cloneTrainingPlanDetail(e2eTrainingPlanDetails[index]);
}

function createE2ENutritionPlanDetail(
  input: NutritionPlanInput,
  mode: NutritionPlanCreationMode,
): NutritionPlanDetail | null {
  const override = getE2EPlanBuilderOverride();
  if (!override) return null;

  const timestamp = nowIso();
  const metadata = resolveNutritionPlanCreationMetadata(override.uid, mode);
  const hydrationGoalMl = parseInt(input.hydrationGoalMl.trim(), 10);
  const plan: NutritionPlanDetail = {
    id: `e2e-nutrition-builder-plan-${++e2eNutritionPlanSequence}`,
    name: input.name.trim(),
    sourceKind: metadata.sourceKind,
    ownerProfessionalUid: metadata.ownerProfessionalUid,
    studentAuthUid: metadata.studentAuthUid,
    hydrationGoalMl:
      Number.isFinite(hydrationGoalMl) && hydrationGoalMl > 0 ? hydrationGoalMl : null,
    caloriesTarget: 0,
    carbsTarget: 0,
    proteinsTarget: 0,
    fatsTarget: 0,
    meals: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  e2eNutritionPlanDetails.push(cloneNutritionPlanDetail(plan));
  if (plan.sourceKind === 'predefined') {
    upsertE2EPredefinedPlanFixture({
      id: plan.id,
      name: plan.name,
      planType: 'nutrition',
      ownerProfessionalUid: plan.ownerProfessionalUid ?? '',
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    });
  } else if (plan.sourceKind === 'self_managed') {
    upsertE2EMyPlanFixture({
      id: plan.id,
      name: plan.name,
      planType: 'nutrition',
      sourceKind: 'self_managed',
      ownerProfessionalUid: plan.ownerProfessionalUid,
      studentUid: plan.studentAuthUid,
      isArchived: false,
      isDraft: false,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    });
  }

  persistE2EPlanBuilderFixtures(override.uid);

  return cloneNutritionPlanDetail(plan);
}

function createE2ETrainingPlanDetail(
  input: TrainingPlanInput,
  mode: TrainingPlanCreationMode,
): TrainingPlanDetail | null {
  const override = getE2EPlanBuilderOverride();
  if (!override) return null;

  const timestamp = nowIso();
  const metadata = resolveTrainingPlanCreationMetadata(override.uid, mode);
  const plan: TrainingPlanDetail = {
    id: `e2e-training-builder-plan-${++e2eTrainingPlanSequence}`,
    name: input.name.trim(),
    sourceKind: metadata.sourceKind,
    ownerProfessionalUid: metadata.ownerProfessionalUid,
    studentAuthUid: metadata.studentAuthUid,
    sessions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  e2eTrainingPlanDetails.push(cloneTrainingPlanDetail(plan));
  if (plan.sourceKind === 'predefined') {
    upsertE2EPredefinedPlanFixture({
      id: plan.id,
      name: plan.name,
      planType: 'training',
      ownerProfessionalUid: plan.ownerProfessionalUid ?? '',
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    });
  } else if (plan.sourceKind === 'self_managed') {
    upsertE2EMyPlanFixture({
      id: plan.id,
      name: plan.name,
      planType: 'training',
      sourceKind: 'self_managed',
      ownerProfessionalUid: plan.ownerProfessionalUid,
      studentUid: plan.studentAuthUid,
      isArchived: false,
      isDraft: false,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    });
  }

  persistE2EPlanBuilderFixtures(override.uid);

  return cloneTrainingPlanDetail(plan);
}

function mapE2ENutritionPlanDetail(planId: string): NutritionPlanDetail | undefined {
  const assignedNutritionOverride = getE2EAssignedNutritionPlanBuilderOverride();
  if (assignedNutritionOverride && planId === 'e2e-assigned-nutrition-plan') {
    return {
      id: 'e2e-assigned-nutrition-plan',
      name: 'Assigned Nutrition Plan',
      sourceKind: 'assigned',
      ownerProfessionalUid: 'e2e-nutritionist',
      studentAuthUid: assignedNutritionOverride.uid,
      hydrationGoalMl: 2800,
      caloriesTarget: 2100,
      carbsTarget: 230,
      proteinsTarget: 150,
      fatsTarget: 70,
      meals: [
        {
          id: 'e2e-assigned-meal',
          name: 'Assigned Recovery Breakfast',
          items: [
            {
              id: 'e2e-assigned-meal-item-1',
              name: 'Greek yogurt bowl',
              quantity: '1 bowl',
              notes: 'High-protein option',
              calories: 320,
              carbs: 42,
              proteins: 28,
              fats: 8,
              sourceKind: 'manual',
            },
            {
              id: 'e2e-assigned-meal-item-2',
              name: 'Banana',
              quantity: '1 medium',
              notes: 'Pre-workout carbs',
              calories: 105,
              carbs: 27,
              proteins: 1,
              fats: 0,
              sourceKind: 'manual',
            },
          ],
        },
      ],
      isDraft: false,
      createdAt: '2026-06-22T10:00:00.000Z',
      updatedAt: '2026-06-22T10:00:00.000Z',
    };
  }

  const builderFixture = findE2ENutritionPlanDetail(planId);
  if (builderFixture) return builderFixture;

  const fixture = getE2EAssignedPlanFixture(planId, 'nutrition');
  if (fixture === undefined) {
    if (builderFixture === null) {
      throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
    }
    return undefined;
  }
  if (!fixture) {
    throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
  }

  if (fixture.id === 'e2e-assigned-nutrition-plan') {
    return {
      id: fixture.id,
      name: fixture.name ?? 'Assigned Nutrition Plan',
      sourceKind: 'assigned',
      ownerProfessionalUid: fixture.ownerProfessionalUid,
      studentAuthUid: fixture.studentUid,
      hydrationGoalMl: 2800,
      caloriesTarget: 2100,
      carbsTarget: 230,
      proteinsTarget: 150,
      fatsTarget: 70,
      meals: [
        {
          id: 'e2e-assigned-meal',
          name: 'Assigned Recovery Breakfast',
          items: [
            {
              id: 'e2e-assigned-meal-item-1',
              name: 'Greek yogurt bowl',
              quantity: '1 bowl',
              notes: 'High-protein option',
              calories: 320,
              carbs: 42,
              proteins: 28,
              fats: 8,
              sourceKind: 'manual',
            },
            {
              id: 'e2e-assigned-meal-item-2',
              name: 'Banana',
              quantity: '1 medium',
              notes: 'Pre-workout carbs',
              calories: 105,
              carbs: 27,
              proteins: 1,
              fats: 0,
              sourceKind: 'manual',
            },
          ],
        },
      ],
      isDraft: false,
      createdAt: fixture.createdAt,
      updatedAt: fixture.updatedAt,
    };
  }

  return {
    id: fixture.id,
    name: fixture.name ?? 'Nutrition Plan',
    sourceKind: fixture.sourceKind,
    ownerProfessionalUid: fixture.ownerProfessionalUid,
    studentAuthUid: fixture.studentUid,
    hydrationGoalMl: null,
    caloriesTarget: 0,
    carbsTarget: 0,
    proteinsTarget: 0,
    fatsTarget: 0,
    meals: [],
    isDraft: fixture.isDraft || undefined,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  };
}

function mapE2ETrainingPlanDetail(planId: string): TrainingPlanDetail | undefined {
  const assignedTrainingOverride = getE2EAssignedTrainingPlanBuilderOverride();
  if (assignedTrainingOverride && planId === 'e2e-assigned-training-plan') {
    return {
      id: 'e2e-assigned-training-plan',
      name: 'Assigned Training Plan',
      sourceKind: 'assigned',
      ownerProfessionalUid: 'e2e-fitness-coach',
      studentAuthUid: assignedTrainingOverride.uid,
      sessions: [
        {
          id: 'e2e-assigned-session',
          name: 'Assigned Strength Session',
          notes: 'Coach-assigned full-body session',
          items: [
            {
              id: 'e2e-assigned-training-item-1',
              name: 'Goblet squat',
              quantity: '3 x 10',
              notes: 'Controlled tempo',
            },
            {
              id: 'e2e-assigned-training-item-2',
              name: 'Push-up',
              quantity: '3 x 12',
              notes: 'Elevate hands if needed',
            },
          ],
        },
      ],
      isDraft: false,
      createdAt: '2026-06-22T10:00:00.000Z',
      updatedAt: '2026-06-22T10:00:00.000Z',
    };
  }

  const builderFixture = findE2ETrainingPlanDetail(planId);
  if (builderFixture) return builderFixture;

  const fixture = getE2EAssignedPlanFixture(planId, 'training');
  if (fixture === undefined) {
    if (builderFixture === null) {
      throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
    }
    return undefined;
  }
  if (!fixture) {
    throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
  }

  return {
    id: fixture.id,
    name: fixture.name ?? 'Training Plan',
    sourceKind: fixture.sourceKind,
    ownerProfessionalUid: fixture.ownerProfessionalUid,
    studentAuthUid: fixture.studentUid,
    sessions: [],
    isDraft: fixture.isDraft || undefined,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  };
}

export async function createNutritionPlan(
  input: NutritionPlanInput,
  mode: NutritionPlanCreationMode = 'professional_library',
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<NutritionPlanDetail> {
  if (deps === defaultDeps) {
    const fixture = createE2ENutritionPlanDetail(input, mode);
    if (fixture) return fixture;
  }

  try {
    const serverPlan = await createNutritionPlanOnServer(input, mode, deps);
    return requireServerResult(serverPlan, 'createNutritionPlan');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function updateNutritionPlan(
  planId: string,
  input: NutritionPlanInput,
  publish?: boolean,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const fixture = updateE2ENutritionPlanDetail(planId, (plan) => {
      const hydrationGoalMl = parseInt(input.hydrationGoalMl.trim(), 10);
      return {
        ...plan,
        name: input.name.trim(),
        hydrationGoalMl:
          Number.isFinite(hydrationGoalMl) && hydrationGoalMl > 0 ? hydrationGoalMl : null,
        isDraft: publish ? undefined : plan.isDraft,
      };
    });
    if (fixture) return;

    const updated = updateE2EAssignedPlanFixture(planId, 'nutrition', {
      name: input.name.trim(),
      isDraft: publish ? false : undefined,
    });
    if (updated === true) return;
    if (updated === false || fixture === null) {
      throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
    }
  }

  try {
    const serverPlan = await updateNutritionPlanOnServer(planId, input, publish, deps);
    requireServerResult(serverPlan, 'updateNutritionPlan');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function getNutritionPlanDetail(
  planId: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<NutritionPlanDetail> {
  if (deps === defaultDeps) {
    const fixture = mapE2ENutritionPlanDetail(planId);
    if (fixture) return fixture;
  }

  try {
    const serverPlan = await getNutritionPlanDetailFromServer(planId, deps);
    return requireServerResult(serverPlan, 'getNutritionPlanDetail');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function addNutritionMeal(
  planId: string,
  meal: NutritionMealInput,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<NutritionMeal> {
  if (deps === defaultDeps) {
    const insertedId = `e2e-nutrition-meal-${++e2eNutritionMealSequence}`;
    const updated = updateE2ENutritionPlanDetail(planId, (plan) => ({
      ...plan,
      meals: [
        ...plan.meals,
        {
          id: insertedId,
          name: meal.name.trim(),
          items: [],
        },
      ],
    }));
    if (updated) {
      return { id: insertedId, name: meal.name.trim(), items: [] };
    }
    if (updated === null) throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
  }

  try {
    const serverMeal = await addNutritionMealOnServer(planId, meal, deps);
    return requireServerResult(serverMeal, 'addNutritionMeal');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeNutritionMeal(
  planId: string,
  mealId: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const updated = updateE2ENutritionPlanDetail(planId, (plan) => ({
      ...plan,
      meals: plan.meals.filter((meal) => meal.id !== mealId),
    }));
    if (updated) return;
    if (updated === null) throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
  }

  try {
    const removedOnServer = await removeNutritionMealOnServer(planId, mealId, deps);
    requireServerSuccess(removedOnServer, 'removeNutritionMeal');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function reorderNutritionMeals(
  planId: string,
  mealIds: string[],
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const updated = updateE2ENutritionPlanDetail(planId, (plan) => ({
      ...plan,
      meals: mealIds
        .map((id) => plan.meals.find((meal) => meal.id === id))
        .filter((meal): meal is NutritionMeal => Boolean(meal)),
    }));
    if (updated) return;
    if (updated === null) throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
  }

  try {
    const reorderedOnServer = await reorderNutritionMealsOnServer(planId, mealIds, deps);
    requireServerSuccess(reorderedOnServer, 'reorderNutritionMeals');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function addNutritionMealItem(
  planId: string,
  mealId: string,
  item: NutritionMealItemInput,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<NutritionMealItem> {
  if (deps === defaultDeps) {
    const insertedId = `e2e-nutrition-item-${++e2eNutritionItemSequence}`;
    const insertedItem: NutritionMealItem = {
      id: insertedId,
      name: item.name.trim(),
      quantity: item.quantity,
      notes: item.notes,
      calories: item.calories,
      carbs: item.carbs,
      proteins: item.proteins,
      fats: item.fats,
      sourceKind: item.sourceKind,
      customMealSnapshot: item.customMealSnapshot,
    };
    const updated = updateE2ENutritionPlanDetail(planId, (plan) => {
      let didAdd = false;
      const meals = plan.meals.map((meal) => {
        if (meal.id !== mealId) return meal;
        didAdd = true;
        return { ...meal, items: [...meal.items, insertedItem] };
      });
      if (!didAdd) {
        throw new PlanBuilderSourceError(
          'graphql',
          `Meal with ID ${mealId} not found in this plan.`,
        );
      }
      return { ...plan, meals };
    });
    if (updated) return insertedItem;
    if (updated === null) throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
  }

  try {
    const serverItem = await addNutritionMealItemOnServer(planId, mealId, item, deps);
    return requireServerResult(serverItem, 'addNutritionMealItem');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeNutritionMealItem(
  planId: string,
  mealId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const updated = updateE2ENutritionPlanDetail(planId, (plan) => ({
      ...plan,
      meals: plan.meals.map((meal) =>
        meal.id === mealId
          ? { ...meal, items: meal.items.filter((item) => item.id !== itemId) }
          : meal,
      ),
    }));
    if (updated) return;
    if (updated === null) throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
  }

  try {
    const removedOnServer = await removeNutritionMealItemOnServer(planId, mealId, itemId, deps);
    requireServerSuccess(removedOnServer, 'removeNutritionMealItem');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function reorderNutritionMealItems(
  planId: string,
  mealId: string,
  itemIds: string[],
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const updated = updateE2ENutritionPlanDetail(planId, (plan) => ({
      ...plan,
      meals: plan.meals.map((meal) =>
        meal.id === mealId
          ? {
              ...meal,
              items: itemIds
                .map((id) => meal.items.find((item) => item.id === id))
                .filter((item): item is NutritionMealItem => Boolean(item)),
            }
          : meal,
      ),
    }));
    if (updated) return;
    if (updated === null) throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
  }

  try {
    const reorderedOnServer = await reorderNutritionMealItemsOnServer(
      planId,
      mealId,
      itemIds,
      deps,
    );
    requireServerSuccess(reorderedOnServer, 'reorderNutritionMealItems');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function deleteNutritionPlan(
  planId: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const override = getE2EPlanBuilderOverride();
    const fixture = findE2ENutritionPlanDetail(planId);
    if (fixture) {
      const planIndex = e2eNutritionPlanDetails.findIndex((candidate) => candidate.id === planId);
      if (planIndex >= 0) e2eNutritionPlanDetails.splice(planIndex, 1);
      removeE2EPredefinedPlanFixture(planId, 'nutrition');
      if (override) persistE2EPlanBuilderFixtures(override.uid);
      return;
    }

    const removed = removeE2EAssignedPlanFixture(planId, 'nutrition');
    if (removed === true) return;
    if (removed === false || fixture === null) {
      throw new PlanBuilderSourceError('graphql', 'Nutrition plan not found.');
    }
  }

  try {
    const deletedOnServer = await deleteNutritionPlanOnServer(planId, deps);
    requireServerSuccess(deletedOnServer, 'deleteNutritionPlan');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function deleteTrainingPlan(
  planId: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const override = getE2EPlanBuilderOverride();
    const fixture = findE2ETrainingPlanDetail(planId);
    if (fixture) {
      const index = e2eTrainingPlanDetails.findIndex((candidate) => candidate.id === planId);
      if (index >= 0) {
        e2eTrainingPlanDetails.splice(index, 1);
      }
      removeE2EPredefinedPlanFixture(planId, 'training');
      if (override) persistE2EPlanBuilderFixtures(override.uid);
      return;
    }

    const removed = removeE2EAssignedPlanFixture(planId, 'training');
    if (removed === true) return;
    if (removed === false) {
      throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
    }
  }

  try {
    const deletedOnServer = await deleteTrainingPlanOnServer(planId, deps);
    requireServerSuccess(deletedOnServer, 'deleteTrainingPlan');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function createTrainingPlan(
  input: TrainingPlanInput,
  mode: TrainingPlanCreationMode = 'professional_library',
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<TrainingPlanDetail> {
  if (deps === defaultDeps) {
    const fixture = createE2ETrainingPlanDetail(input, mode);
    if (fixture) return fixture;
  }

  try {
    const serverPlan = await createTrainingPlanOnServer(input, mode, deps);
    return requireServerResult(serverPlan, 'createTrainingPlan');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function updateTrainingPlan(
  planId: string,
  input: TrainingPlanInput,
  publish?: boolean,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const fixture = updateE2ETrainingPlanDetail(planId, (plan) => ({
      ...plan,
      name: input.name.trim(),
      isDraft: publish ? false : plan.isDraft,
    }));
    if (fixture) return;

    const updated = updateE2EAssignedPlanFixture(planId, 'training', {
      name: input.name.trim(),
      isDraft: publish ? false : undefined,
    });
    if (updated === true) return;
    if (updated === false) {
      throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
    }
  }

  try {
    const serverPlan = await updateTrainingPlanOnServer(planId, input, undefined, publish, deps);
    requireServerResult(serverPlan, 'updateTrainingPlan');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function updateTrainingPlanWithSessions(
  planId: string,
  input: TrainingPlanInput,
  sessions: TrainingSession[],
  publish?: boolean,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const fixture = updateE2ETrainingPlanDetail(planId, (plan) => ({
      ...plan,
      name: input.name.trim(),
      sessions,
      isDraft: publish ? false : plan.isDraft,
    }));
    if (fixture) return;

    const assigned = updateE2EAssignedPlanFixture(planId, 'training', {
      name: input.name.trim(),
      isDraft: publish ? false : undefined,
    });
    if (assigned === true) return;
    if (assigned === false) {
      throw new PlanBuilderSourceError('graphql', 'Training plan not found.');
    }
  }

  try {
    const serverPlan = await updateTrainingPlanOnServer(planId, input, sessions, publish, deps);
    requireServerResult(serverPlan, 'updateTrainingPlanWithSessions');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function getTrainingPlanDetail(
  planId: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<TrainingPlanDetail> {
  if (deps === defaultDeps) {
    const fixture = mapE2ETrainingPlanDetail(planId);
    if (fixture) return fixture;
  }

  try {
    const serverPlan = await getTrainingPlanDetailFromServer(planId, deps);
    return requireServerResult(serverPlan, 'getTrainingPlanDetail');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function addTrainingSession(
  planId: string,
  session: TrainingSessionInput,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<TrainingSession> {
  try {
    const serverSession = await addTrainingSessionOnServer(planId, session, deps);
    return requireServerResult(serverSession, 'addTrainingSession');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeTrainingSession(
  planId: string,
  sessionId: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  try {
    const removedOnServer = await removeTrainingSessionOnServer(planId, sessionId, deps);
    requireServerSuccess(removedOnServer, 'removeTrainingSession');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function reorderTrainingSessions(
  planId: string,
  sessionIds: string[],
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  try {
    const reorderedOnServer = await reorderTrainingSessionsOnServer(planId, sessionIds, deps);
    requireServerSuccess(reorderedOnServer, 'reorderTrainingSessions');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function addTrainingSessionItem(
  planId: string,
  sessionId: string,
  item: TrainingSessionItemInput,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<TrainingSessionItem> {
  try {
    const serverItem = await addTrainingSessionItemOnServer(planId, sessionId, item, deps);
    return requireServerResult(serverItem, 'addTrainingSessionItem');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function removeTrainingSessionItem(
  planId: string,
  _sessionId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  try {
    const removedOnServer = await removeTrainingSessionItemOnServer(
      planId,
      _sessionId,
      itemId,
      deps,
    );
    requireServerSuccess(removedOnServer, 'removeTrainingSessionItem');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function reorderTrainingSessionItems(
  planId: string,
  sessionId: string,
  itemIds: string[],
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<void> {
  try {
    const reorderedOnServer = await reorderTrainingSessionItemsOnServer(
      planId,
      sessionId,
      itemIds,
      deps,
    );
    requireServerSuccess(reorderedOnServer, 'reorderTrainingSessionItems');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function getStarterTemplates(
  planType: PlanType,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<StarterTemplate[]> {
  try {
    const templates = await getStarterTemplatesFromServer(planType, deps);
    return requireServerResult(templates, 'getStarterTemplates');
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function cloneStarterTemplate(
  _user: { uid: string },
  templateId: string,
  name: string,
  deps: PlanBuilderSourceDeps = defaultDeps,
): Promise<{ id: string; planType: PlanType; name: string }> {
  try {
    const planType = deriveStarterTemplatePlanType(templateId);
    if (!planType) {
      throw new PlanBuilderSourceError(
        'invalid_response',
        `Cannot derive planType from templateId: ${templateId}`,
      );
    }

    const plan = await cloneStarterTemplateOnServer(templateId, name, deps);
    const clonedPlan = requireServerResult(plan, 'cloneStarterTemplate');
    return { id: clonedPlan.id, planType, name: clonedPlan.name };
  } catch (error) {
    throw normalizePlanBuilderSourceError(error);
  }
}

export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  return searchFoodsFromSource(query);
}

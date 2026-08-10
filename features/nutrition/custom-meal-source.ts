/**
 * Custom meal source — server-first CRUD, share link, recipe import, portion log.
 */

import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getValidServerAccessToken } from '../auth/server-auth-source';
import { defaultAppFetch } from '../platform/default-app-fetch';

import type { CustomMeal, SharedMealSnapshot } from './custom-meal.logic';
import { calculatePortionNutrition } from './custom-meal.logic';

function nowIso(): string {
  return new Date().toISOString();
}

type CustomMealSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class CustomMealSourceError extends Error {
  code: CustomMealSourceErrorCode;

  constructor(code: CustomMealSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CustomMealSourceError';
  }
}

export type PortionLog = {
  id: string;
  ownerUid: string;
  mealId: string;
  consumedGrams: number;
  snapshot: {
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
  };
  loggedAt: string;
  planId?: string | null;
  planType?: 'nutrition' | null;
  sourceKind?: 'assigned' | 'predefined' | 'self_managed' | null;
  ownerProfessionalUid?: string | null;
  connectionId?: string | null;
};

export type AssignedMealPortionLogProvenance = {
  planId?: string | null;
  planType?: 'nutrition' | null;
  sourceKind?: 'assigned' | 'predefined' | 'self_managed' | null;
  ownerProfessionalUid?: string | null;
  connectionId?: string | null;
};

export function buildAssignedMealPortionLog(input: {
  id: string;
  ownerUid: string;
  mealId: string;
  snapshot: PortionLog['snapshot'];
  loggedAt: string;
  provenance?: AssignedMealPortionLogProvenance;
}): PortionLog {
  return {
    id: input.id,
    ownerUid: input.ownerUid,
    mealId: input.mealId,
    consumedGrams: 0,
    snapshot: input.snapshot,
    loggedAt: input.loggedAt,
    planId: input.provenance?.planId ?? null,
    planType: input.provenance?.planType ?? null,
    sourceKind: input.provenance?.sourceKind ?? null,
    ownerProfessionalUid: input.provenance?.ownerProfessionalUid ?? null,
    connectionId: input.provenance?.connectionId ?? null,
  };
}

export type CustomMealSourceDeps = {
  getCurrentAccessToken?: () => Promise<string | null>;
  getServerBaseUrl?: () => string | undefined;
  fetchFn?: AppFetch;
};

const defaultDeps: CustomMealSourceDeps = {
  getCurrentAccessToken: () => getValidServerAccessToken(),
  getServerBaseUrl: resolveServerBaseUrl,
  fetchFn: defaultAppFetch,
};

const E2E_SHARED_MEAL_TOKEN = 'e2e-shared-recipe';
const E2E_SHARED_MEAL_SNAPSHOT: SharedMealSnapshot = {
  name: 'E2E Shared Recovery Bowl',
  totalGrams: 300,
  calories: 480,
  carbs: 55,
  proteins: 35,
  fats: 14,
};
const e2eAssignedMealPortionLogs: PortionLog[] = [];
let e2eCustomMealSequence = 0;
let e2eCustomMealShareSequence = 0;
let e2eCustomMealPortionLogSequence = 0;
const E2E_CUSTOM_MEAL_FIXTURE: CustomMeal = {
  id: 'e2e-custom-meal',
  name: 'E2E Recovery Bowl',
  totalGrams: 300,
  calories: 480,
  carbs: 55,
  proteins: 35,
  fats: 14,
  ingredientCost: 8.5,
  imageUrl: null,
  ownerUid: 'e2e-auth-session-user',
  createdAt: '2026-06-22T09:00:00.000Z',
  updatedAt: '2026-06-22T09:00:00.000Z',
};
const e2eCustomMealFixtures = new Map<string, CustomMeal>();
const e2eCustomMealPortionLogs = new Map<string, PortionLog>();

function resolveE2ESourceOverride() {
  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

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

function resolveE2EAssignedNutritionFixture() {
  const override = resolveE2ESourceOverride();
  if (!override || process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE !== 'assigned')
    return null;
  return override;
}

function resolveE2ECustomMealsFixture() {
  const override = resolveE2ESourceOverride();
  if (!override || process.env.EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE !== 'basic') return null;
  return override;
}

function cloneCustomMeal(meal: CustomMeal): CustomMeal {
  return { ...meal };
}

function getE2ECustomMealStore(ownerUid: string): Map<string, CustomMeal> {
  if (!e2eCustomMealFixtures.has(E2E_CUSTOM_MEAL_FIXTURE.id)) {
    e2eCustomMealFixtures.set(E2E_CUSTOM_MEAL_FIXTURE.id, {
      ...E2E_CUSTOM_MEAL_FIXTURE,
      ownerUid,
    });
  }
  return e2eCustomMealFixtures;
}

function sortCustomMeals(meals: CustomMeal[]): CustomMeal[] {
  return [...meals].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function resolveE2ESharedMealFixture(
  shareToken: string,
): { ownerUid: string; snapshot: SharedMealSnapshot } | null {
  const override = resolveE2ESourceOverride();

  if (!override || shareToken !== E2E_SHARED_MEAL_TOKEN) return null;
  return {
    ownerUid: override.uid,
    snapshot: E2E_SHARED_MEAL_SNAPSHOT,
  };
}

function normalizeCustomMealSourceError(error: unknown): CustomMealSourceError {
  if (error instanceof CustomMealSourceError) return error;

  return new CustomMealSourceError(
    'invalid_response',
    (error as Error)?.message ?? 'Unexpected custom meal source error.',
  );
}

function requireServerResult<T>(result: T | null, operation: string): T {
  if (result !== null) return result;
  throw new CustomMealSourceError('configuration', `${operation} requires local server auth.`);
}

function requireServerBoolean(result: boolean, operation: string): void {
  if (result) return;
  throw new CustomMealSourceError('configuration', `${operation} requires local server auth.`);
}

type ServerPortionLog = Partial<PortionLog>;
type ServerCustomMeal = Partial<CustomMeal>;

function normalizeServerCustomMeal(input: ServerCustomMeal): CustomMeal | null {
  const id = typeof input.id === 'string' ? input.id : '';
  const ownerUid = typeof input.ownerUid === 'string' ? input.ownerUid : '';
  const name = typeof input.name === 'string' ? input.name : '';
  const totalGrams = typeof input.totalGrams === 'number' ? input.totalGrams : Number.NaN;
  const calories = typeof input.calories === 'number' ? input.calories : Number.NaN;
  const carbs = typeof input.carbs === 'number' ? input.carbs : Number.NaN;
  const proteins = typeof input.proteins === 'number' ? input.proteins : Number.NaN;
  const fats = typeof input.fats === 'number' ? input.fats : Number.NaN;
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : '';
  const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : '';
  const ingredientCost =
    input.ingredientCost === null || typeof input.ingredientCost === 'number'
      ? input.ingredientCost
      : null;
  const imageUrl =
    input.imageUrl === null || typeof input.imageUrl === 'string' ? input.imageUrl : null;

  if (
    !id ||
    !ownerUid ||
    !name ||
    !Number.isFinite(totalGrams) ||
    !Number.isFinite(calories) ||
    !Number.isFinite(carbs) ||
    !Number.isFinite(proteins) ||
    !Number.isFinite(fats) ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    name,
    totalGrams,
    calories,
    carbs,
    proteins,
    fats,
    ingredientCost,
    imageUrl,
    createdAt,
    updatedAt,
  };
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
    snapshot: {
      calories: snapshot.calories,
      carbs: snapshot.carbs,
      proteins: snapshot.proteins,
      fats: snapshot.fats,
    },
    loggedAt,
    planId: input.planId ?? null,
    planType: input.planType ?? null,
    sourceKind: input.sourceKind ?? null,
    ownerProfessionalUid: input.ownerProfessionalUid ?? null,
    connectionId: input.connectionId ?? null,
  };
}

function normalizeSharedMealSnapshot(
  input: Partial<SharedMealSnapshot> | undefined,
): SharedMealSnapshot | null {
  if (
    !input ||
    typeof input.name !== 'string' ||
    typeof input.totalGrams !== 'number' ||
    typeof input.calories !== 'number' ||
    typeof input.carbs !== 'number' ||
    typeof input.proteins !== 'number' ||
    typeof input.fats !== 'number'
  ) {
    return null;
  }

  return {
    name: input.name,
    totalGrams: input.totalGrams,
    calories: input.calories,
    carbs: input.carbs,
    proteins: input.proteins,
    fats: input.fats,
  };
}

function normalizeServerStatus(
  status: number,
  operation: 'create' | 'list',
): CustomMealSourceError {
  if (status === 401 || status === 403) {
    return new CustomMealSourceError('graphql', `Portion log ${operation} is not authorized.`);
  }
  if (status >= 500) {
    return new CustomMealSourceError(
      'network',
      `Portion log ${operation} failed with status ${status}.`,
    );
  }
  return new CustomMealSourceError(
    'invalid_response',
    `Unexpected portion log ${operation} response: ${status}.`,
  );
}

function normalizeServerMealStatus(
  status: number,
  operation: 'create' | 'read' | 'list' | 'update' | 'delete',
): CustomMealSourceError {
  if (status === 401 || status === 403) {
    return new CustomMealSourceError('graphql', `Custom meal ${operation} is not authorized.`);
  }
  if (status === 404) {
    return new CustomMealSourceError('graphql', 'Custom meal not found.');
  }
  if (status >= 500) {
    return new CustomMealSourceError(
      'network',
      `Custom meal ${operation} failed with status ${status}.`,
    );
  }
  return new CustomMealSourceError(
    'invalid_response',
    `Unexpected custom meal ${operation} response: ${status}.`,
  );
}

function normalizeServerShareStatus(
  status: number,
  operation: 'create' | 'preview' | 'import',
): CustomMealSourceError {
  if (status === 401 || status === 403) {
    return new CustomMealSourceError(
      'graphql',
      `Custom meal share ${operation} is not authorized.`,
    );
  }
  if (status === 404) {
    return new CustomMealSourceError('graphql', 'Shared meal not found.');
  }
  if (status >= 500) {
    return new CustomMealSourceError(
      'network',
      `Custom meal share ${operation} failed with status ${status}.`,
    );
  }
  return new CustomMealSourceError(
    'invalid_response',
    `Unexpected custom meal share ${operation} response: ${status}.`,
  );
}

async function resolveServerAuth(
  deps: CustomMealSourceDeps,
): Promise<{ baseUrl: string; accessToken: string } | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;
  return { baseUrl, accessToken };
}

function resolveServerBase(deps: CustomMealSourceDeps): string | null {
  return deps.getServerBaseUrl?.()?.replace(/\/+$/, '') || null;
}

async function parseJsonPayload<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function createMealShareLinkOnServer(
  mealId: string,
  deps: CustomMealSourceDeps,
): Promise<{ shareLinkId: string } | null> {
  const auth = await resolveServerAuth(deps);
  if (!auth) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${auth.baseUrl}/nutrition/custom-meals/${encodeURIComponent(mealId)}/share-links`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      },
    );
  } catch {
    throw new CustomMealSourceError(
      'network',
      'Network request to create custom meal share link failed.',
    );
  }

  const payload = await parseJsonPayload<{ shareLinkId?: string }>(response);
  if (!response.ok) {
    throw normalizeServerShareStatus(response.status, 'create');
  }
  if (typeof payload?.shareLinkId !== 'string' || !payload.shareLinkId) {
    throw new CustomMealSourceError(
      'invalid_response',
      'Custom meal share create response is missing shareLinkId.',
    );
  }

  return { shareLinkId: payload.shareLinkId };
}

async function previewSharedMealFromServer(
  shareToken: string,
  deps: CustomMealSourceDeps,
): Promise<SharedMealSnapshot | null> {
  const baseUrl = resolveServerBase(deps);
  if (!baseUrl) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${baseUrl}/nutrition/custom-meal-shares/${encodeURIComponent(shareToken)}`,
    );
  } catch {
    throw new CustomMealSourceError('network', 'Network request to preview shared meal failed.');
  }

  const payload = await parseJsonPayload<{ snapshot?: Partial<SharedMealSnapshot> }>(response);
  if (!response.ok) {
    throw normalizeServerShareStatus(response.status, 'preview');
  }

  const snapshot = normalizeSharedMealSnapshot(payload?.snapshot);
  if (!snapshot) {
    throw new CustomMealSourceError(
      'invalid_response',
      'Shared meal preview response is missing snapshot.',
    );
  }

  return snapshot;
}

async function importSharedMealOnServer(
  shareToken: string,
  deps: CustomMealSourceDeps,
): Promise<CustomMeal | null> {
  const auth = await resolveServerAuth(deps);
  if (!auth) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${auth.baseUrl}/nutrition/custom-meal-shares/${encodeURIComponent(shareToken)}/import`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      },
    );
  } catch {
    throw new CustomMealSourceError('network', 'Network request to import shared meal failed.');
  }

  const payload = await parseJsonPayload<{ meal?: ServerCustomMeal }>(response);
  if (!response.ok) {
    throw normalizeServerShareStatus(response.status, 'import');
  }

  const meal = payload?.meal ? normalizeServerCustomMeal(payload.meal) : null;
  if (!meal) {
    throw new CustomMealSourceError(
      'invalid_response',
      'Shared meal import response is missing meal.',
    );
  }

  return meal;
}

async function getCustomMealsFromServer(deps: CustomMealSourceDeps): Promise<CustomMeal[] | null> {
  const auth = await resolveServerAuth(deps);
  if (!auth) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(`${auth.baseUrl}/nutrition/custom-meals`, {
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
  } catch {
    throw new CustomMealSourceError('network', 'Network request to read custom meals failed.');
  }

  const payload = await parseJsonPayload<{ meals?: ServerCustomMeal[] }>(response);
  if (!response.ok) {
    throw normalizeServerMealStatus(response.status, 'list');
  }
  if (!Array.isArray(payload?.meals)) {
    throw new CustomMealSourceError('invalid_response', 'Custom meal response is missing meals.');
  }

  return payload.meals
    .map(normalizeServerCustomMeal)
    .filter((meal): meal is CustomMeal => meal !== null);
}

async function getCustomMealFromServer(
  mealId: string,
  deps: CustomMealSourceDeps,
): Promise<CustomMeal | null> {
  const auth = await resolveServerAuth(deps);
  if (!auth) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${auth.baseUrl}/nutrition/custom-meals/${encodeURIComponent(mealId)}`,
      { headers: { authorization: `Bearer ${auth.accessToken}` } },
    );
  } catch {
    throw new CustomMealSourceError('network', 'Network request to read custom meal failed.');
  }

  const payload = await parseJsonPayload<{ meal?: ServerCustomMeal }>(response);
  if (!response.ok) {
    throw normalizeServerMealStatus(response.status, 'read');
  }

  const meal = payload?.meal ? normalizeServerCustomMeal(payload.meal) : null;
  if (!meal) {
    throw new CustomMealSourceError('invalid_response', 'Custom meal response is missing meal.');
  }

  return meal;
}

async function createCustomMealOnServer(
  input: {
    name: string;
    totalGrams: number;
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
    ingredientCost?: number | null;
    imageUrl?: string | null;
  },
  deps: CustomMealSourceDeps,
): Promise<CustomMeal | null> {
  const auth = await resolveServerAuth(deps);
  if (!auth) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(`${auth.baseUrl}/nutrition/custom-meals`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        totalGrams: input.totalGrams,
        calories: input.calories,
        carbs: input.carbs,
        proteins: input.proteins,
        fats: input.fats,
        ingredientCost: input.ingredientCost ?? null,
        imageUrl: input.imageUrl ?? null,
      }),
    });
  } catch {
    throw new CustomMealSourceError('network', 'Network request to create custom meal failed.');
  }

  const payload = await parseJsonPayload<{ meal?: ServerCustomMeal }>(response);
  if (!response.ok) {
    throw normalizeServerMealStatus(response.status, 'create');
  }

  const meal = payload?.meal ? normalizeServerCustomMeal(payload.meal) : null;
  if (!meal) {
    throw new CustomMealSourceError(
      'invalid_response',
      'Custom meal create response is missing meal.',
    );
  }

  return meal;
}

async function updateCustomMealOnServer(
  id: string,
  input: {
    name: string;
    totalGrams: number;
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
    ingredientCost?: number | null;
    imageUrl?: string | null;
  },
  deps: CustomMealSourceDeps,
): Promise<CustomMeal | null> {
  const auth = await resolveServerAuth(deps);
  if (!auth) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${auth.baseUrl}/nutrition/custom-meals/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: input.name,
          totalGrams: input.totalGrams,
          calories: input.calories,
          carbs: input.carbs,
          proteins: input.proteins,
          fats: input.fats,
          ingredientCost: input.ingredientCost ?? null,
          imageUrl: input.imageUrl ?? null,
        }),
      },
    );
  } catch {
    throw new CustomMealSourceError('network', 'Network request to update custom meal failed.');
  }

  const payload = await parseJsonPayload<{ meal?: ServerCustomMeal }>(response);
  if (!response.ok) {
    throw normalizeServerMealStatus(response.status, 'update');
  }

  const meal = payload?.meal ? normalizeServerCustomMeal(payload.meal) : null;
  if (!meal) {
    throw new CustomMealSourceError(
      'invalid_response',
      'Custom meal update response is missing meal.',
    );
  }

  return meal;
}

async function deleteCustomMealOnServer(id: string, deps: CustomMealSourceDeps): Promise<boolean> {
  const auth = await resolveServerAuth(deps);
  if (!auth) return false;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${auth.baseUrl}/nutrition/custom-meals/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      },
    );
  } catch {
    throw new CustomMealSourceError('network', 'Network request to delete custom meal failed.');
  }

  if (response.status === 204) return true;
  if (!response.ok) {
    throw normalizeServerMealStatus(response.status, 'delete');
  }

  return true;
}

async function createPortionLogOnServer(
  input: {
    mealId: string;
    consumedGrams: number;
    snapshot: PortionLog['snapshot'];
    provenance?: AssignedMealPortionLogProvenance;
  },
  deps: CustomMealSourceDeps,
): Promise<boolean> {
  const auth = await resolveServerAuth(deps);
  if (!auth) return false;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(`${auth.baseUrl}/nutrition/portion-logs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mealId: input.mealId,
        consumedGrams: input.consumedGrams,
        snapshot: input.snapshot,
        planId: input.provenance?.planId ?? null,
        planType: input.provenance?.planType ?? null,
        sourceKind: input.provenance?.sourceKind ?? null,
        ownerProfessionalUid: input.provenance?.ownerProfessionalUid ?? null,
        connectionId: input.provenance?.connectionId ?? null,
      }),
    });
  } catch {
    throw new CustomMealSourceError('network', 'Network request to create portion log failed.');
  }

  let payload: { log?: ServerPortionLog } | null = null;
  try {
    payload = (await response.json()) as { log?: ServerPortionLog };
  } catch {
    payload = null;
  }

  if (response.ok && payload?.log && normalizeServerPortionLog(payload.log)) {
    return true;
  }

  throw normalizeServerStatus(response.status, 'create');
}

async function getPortionLogsFromServer(deps: CustomMealSourceDeps): Promise<PortionLog[] | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${baseUrl}/nutrition/portion-logs?from=${encodeURIComponent(todayStartIso)}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
  } catch {
    throw new CustomMealSourceError('network', 'Network request to read portion logs failed.');
  }

  let payload: { logs?: ServerPortionLog[] } | null = null;
  try {
    payload = (await response.json()) as { logs?: ServerPortionLog[] };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw normalizeServerStatus(response.status, 'list');
  }
  if (!Array.isArray(payload?.logs)) {
    throw new CustomMealSourceError('invalid_response', 'Portion log response is missing logs.');
  }

  return payload.logs
    .map(normalizeServerPortionLog)
    .filter((log): log is PortionLog => log !== null);
}

export async function getMyCustomMeals(deps = defaultDeps): Promise<CustomMeal[]> {
  if (deps === defaultDeps) {
    const e2eFixture = resolveE2ECustomMealsFixture();
    if (e2eFixture) {
      return sortCustomMeals(
        [...getE2ECustomMealStore(e2eFixture.uid).values()].map(cloneCustomMeal),
      );
    }
  }

  try {
    const serverMeals = await getCustomMealsFromServer(deps);
    return requireServerResult(serverMeals, 'Custom meal reads');
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function createCustomMeal(
  input: {
    name: string;
    totalGrams: number;
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
    ingredientCost?: number | null;
    imageUrl?: string | null;
  },
  deps = defaultDeps,
): Promise<CustomMeal> {
  if (deps === defaultDeps) {
    const e2eFixture = resolveE2ECustomMealsFixture();
    if (e2eFixture) {
      const timestamp = nowIso();
      const meal: CustomMeal = {
        id: `e2e-custom-meal-created-${++e2eCustomMealSequence}`,
        name: input.name,
        totalGrams: input.totalGrams,
        calories: input.calories,
        carbs: input.carbs,
        proteins: input.proteins,
        fats: input.fats,
        ingredientCost: input.ingredientCost ?? null,
        imageUrl: input.imageUrl ?? null,
        ownerUid: e2eFixture.uid,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      getE2ECustomMealStore(e2eFixture.uid).set(meal.id, cloneCustomMeal(meal));
      return meal;
    }
  }

  try {
    const serverMeal = await createCustomMealOnServer(input, deps);
    return requireServerResult(serverMeal, 'Custom meal creation');
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function updateCustomMeal(
  id: string,
  input: {
    name: string;
    totalGrams: number;
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
    ingredientCost?: number | null;
    imageUrl?: string | null;
  },
  deps = defaultDeps,
): Promise<CustomMeal> {
  if (deps === defaultDeps) {
    const e2eFixture = resolveE2ECustomMealsFixture();
    if (e2eFixture) {
      const store = getE2ECustomMealStore(e2eFixture.uid);
      const current = store.get(id);
      if (!current) {
        throw new CustomMealSourceError('graphql', 'Custom meal not found.');
      }
      if (current.ownerUid !== e2eFixture.uid) {
        throw new CustomMealSourceError('graphql', 'Permission denied for meal update.');
      }
      const updated: CustomMeal = {
        ...current,
        name: input.name,
        totalGrams: input.totalGrams,
        calories: input.calories,
        carbs: input.carbs,
        proteins: input.proteins,
        fats: input.fats,
        ingredientCost: input.ingredientCost ?? null,
        imageUrl: input.imageUrl ?? null,
        updatedAt: nowIso(),
      };
      store.set(id, cloneCustomMeal(updated));
      return updated;
    }
  }

  try {
    const serverMeal = await updateCustomMealOnServer(id, input, deps);
    return requireServerResult(serverMeal, 'Custom meal update');
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function deleteCustomMeal(id: string, deps = defaultDeps): Promise<void> {
  if (deps === defaultDeps) {
    const e2eFixture = resolveE2ECustomMealsFixture();
    if (e2eFixture) {
      const store = getE2ECustomMealStore(e2eFixture.uid);
      const current = store.get(id);
      if (!current) {
        throw new CustomMealSourceError('graphql', 'Custom meal not found.');
      }
      if (current.ownerUid !== e2eFixture.uid) {
        throw new CustomMealSourceError('graphql', 'Permission denied for meal delete.');
      }
      store.delete(id);
      return;
    }
  }

  try {
    requireServerBoolean(await deleteCustomMealOnServer(id, deps), 'Custom meal deletion');
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function createMealShareLink(
  mealId: string,
  deps = defaultDeps,
): Promise<{ shareLinkId: string }> {
  if (deps === defaultDeps) {
    const e2eFixture = resolveE2ECustomMealsFixture();
    if (e2eFixture) {
      const meal = getE2ECustomMealStore(e2eFixture.uid).get(mealId);
      if (!meal) {
        throw new CustomMealSourceError('graphql', 'Custom meal not found for share link.');
      }
      if (meal.ownerUid !== e2eFixture.uid) {
        throw new CustomMealSourceError('graphql', 'Permission denied for share link generation.');
      }
      const shareLinkId =
        mealId === 'e2e-custom-meal'
          ? 'e2e-share-e2e-custom-meal'
          : `e2e-share-${++e2eCustomMealShareSequence}`;
      return { shareLinkId };
    }
  }

  try {
    const serverShare = await createMealShareLinkOnServer(mealId, deps);
    return requireServerResult(serverShare, 'Custom meal share creation');
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function previewSharedMeal(
  shareToken: string,
  deps = defaultDeps,
): Promise<SharedMealSnapshot> {
  const e2eFixture = resolveE2ESharedMealFixture(shareToken);
  if (e2eFixture) return e2eFixture.snapshot;

  try {
    const serverSnapshot = await previewSharedMealFromServer(shareToken, deps);
    return requireServerResult(serverSnapshot, 'Shared meal preview');
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function importSharedMeal(
  shareToken: string,
  deps = defaultDeps,
): Promise<CustomMeal> {
  const e2eFixture = resolveE2ESharedMealFixture(shareToken);
  if (e2eFixture) {
    const timestamp = nowIso();
    return {
      id: `meal_${shareToken}`,
      ...e2eFixture.snapshot,
      ingredientCost: null,
      imageUrl: null,
      ownerUid: e2eFixture.ownerUid,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  try {
    const serverMeal = await importSharedMealOnServer(shareToken, deps);
    return requireServerResult(serverMeal, 'Shared meal import');
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function logPortionFromSource(
  mealId: string,
  grams: number,
  deps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const e2eFixture = resolveE2ECustomMealsFixture();
    if (e2eFixture) {
      const meal = getE2ECustomMealStore(e2eFixture.uid).get(mealId);
      if (!meal) {
        throw new CustomMealSourceError('graphql', 'logPortion: meal not found.');
      }
      if (meal.ownerUid !== e2eFixture.uid) {
        throw new CustomMealSourceError('graphql', 'Permission denied for portion log.');
      }
      const snapshot = calculatePortionNutrition(meal, grams);
      const id = `e2e-custom-portion-log-${++e2eCustomMealPortionLogSequence}`;
      e2eCustomMealPortionLogs.set(id, {
        id,
        ownerUid: e2eFixture.uid,
        mealId,
        consumedGrams: grams,
        snapshot,
        loggedAt: nowIso(),
      });
      return;
    }
  }

  try {
    const serverMeal = await getCustomMealFromServer(mealId, deps);
    const meal = requireServerResult(serverMeal, 'Custom meal portion logging');
    const snapshot = calculatePortionNutrition(meal, grams);
    requireServerBoolean(
      await createPortionLogOnServer({ mealId, consumedGrams: grams, snapshot }, deps),
      'Custom meal portion logging',
    );
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function logAssignedMealPortion(
  mealId: string,
  snapshot: {
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
  },
  provenance?: AssignedMealPortionLogProvenance,
  deps = defaultDeps,
): Promise<void> {
  if (deps === defaultDeps) {
    const e2eFixture = resolveE2EAssignedNutritionFixture();
    if (e2eFixture) {
      const log = buildAssignedMealPortionLog({
        id: `e2e-portion-log-${e2eAssignedMealPortionLogs.length + 1}`,
        ownerUid: e2eFixture.uid,
        mealId,
        snapshot,
        loggedAt: nowIso(),
        provenance,
      });
      const existingIndex = e2eAssignedMealPortionLogs.findIndex(
        (candidate) => candidate.ownerUid === log.ownerUid && candidate.mealId === log.mealId,
      );
      if (existingIndex >= 0) e2eAssignedMealPortionLogs[existingIndex] = log;
      else e2eAssignedMealPortionLogs.push(log);
      return;
    }
  }

  try {
    requireServerBoolean(
      await createPortionLogOnServer({ mealId, consumedGrams: 0, snapshot, provenance }, deps),
      'Assigned meal portion logging',
    );
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function getTodayPortionLogs(deps = defaultDeps): Promise<PortionLog[]> {
  if (deps === defaultDeps) {
    const e2eFixture = resolveE2EAssignedNutritionFixture();
    if (e2eFixture) {
      return e2eAssignedMealPortionLogs
        .filter((log) => log.ownerUid === e2eFixture.uid)
        .map((log) => ({
          ...log,
          snapshot: { ...log.snapshot },
        }));
    }

    const e2eCustomMealsFixture = resolveE2ECustomMealsFixture();
    if (e2eCustomMealsFixture) {
      return [...e2eCustomMealPortionLogs.values()]
        .filter((log) => log.ownerUid === e2eCustomMealsFixture.uid)
        .map((log) => ({
          ...log,
          snapshot: { ...log.snapshot },
        }));
    }
  }

  try {
    const serverLogs = await getPortionLogsFromServer(deps);
    return requireServerResult(serverLogs, 'Portion log reads');
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

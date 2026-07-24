/**
 * Water tracking source — intake logging + effective goal context.
 */

import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getValidServerAccessToken } from '../auth/server-auth-source';
import type { WaterIntakeLog } from './water-tracking.logic';

type WaterSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class WaterTrackingSourceError extends Error {
  code: WaterSourceErrorCode;

  constructor(code: WaterSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WaterTrackingSourceError';
  }
}

export type WaterTrackingSourceDeps = {
  getCurrentAccessToken?: () => Promise<string | null>;
  getServerBaseUrl?: () => string | undefined;
  fetchFn?: AppFetch;
};

const defaultDeps: WaterTrackingSourceDeps = {
  getCurrentAccessToken: () => getValidServerAccessToken(),
  getServerBaseUrl: resolveServerBaseUrl,
  fetchFn: fetch,
};
const e2eWaterLogs = new Map<string, WaterIntakeLog>();

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

function getE2EWaterTrackingSourceOverride() {
  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

function isE2EAssignedNutritionFixtureEnabled(): boolean {
  return Boolean(getE2EWaterTrackingSourceOverride()) &&
    process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE === 'assigned';
}

function normalizeWaterSourceError(error: unknown): WaterTrackingSourceError {
  if (error instanceof WaterTrackingSourceError) return error;
  return new WaterTrackingSourceError('invalid_response', (error as Error)?.message ?? 'Unexpected water source error.');
}

type ServerWaterLog = Partial<WaterIntakeLog>;

type WaterGoalContext = {
  studentGoalMl: number | null;
  nutritionistGoalMl: number | null;
  hasActiveNutritionistAssignment: boolean;
};

type ServerWaterGoalContext = {
  studentGoalMl?: unknown;
  nutritionistGoalMl?: unknown;
  hasActiveNutritionistAssignment?: unknown;
};

function normalizeServerWaterLog(input: ServerWaterLog): WaterIntakeLog | null {
  const id = typeof input.id === 'string' ? input.id : '';
  const dateKey = typeof input.dateKey === 'string' ? input.dateKey : '';
  const totalMl = typeof input.totalMl === 'number' ? input.totalMl : Number.NaN;
  const loggedAt = typeof input.loggedAt === 'string' ? input.loggedAt : '';

  if (!id || !dateKey || !Number.isFinite(totalMl) || !loggedAt) return null;

  return { id, dateKey, totalMl, loggedAt };
}

function normalizeNullableGoal(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return undefined;
}

function normalizeServerWaterGoalContext(input: ServerWaterGoalContext | null): WaterGoalContext | null {
  if (!input) return null;

  const studentGoalMl = normalizeNullableGoal(input.studentGoalMl);
  const nutritionistGoalMl = normalizeNullableGoal(input.nutritionistGoalMl);
  const hasActiveNutritionistAssignment = input.hasActiveNutritionistAssignment;

  if (
    studentGoalMl === undefined ||
    nutritionistGoalMl === undefined ||
    typeof hasActiveNutritionistAssignment !== 'boolean'
  ) {
    return null;
  }

  return {
    studentGoalMl,
    nutritionistGoalMl,
    hasActiveNutritionistAssignment,
  };
}

function normalizeServerStatus(status: number, operation: 'create' | 'list'): WaterTrackingSourceError {
  if (status === 401 || status === 403) {
    return new WaterTrackingSourceError('graphql', `Water log ${operation} is not authorized.`);
  }
  if (status >= 500) {
    return new WaterTrackingSourceError('network', `Water log ${operation} failed with status ${status}.`);
  }
  return new WaterTrackingSourceError('invalid_response', `Unexpected water log ${operation} response: ${status}.`);
}

function normalizeWaterGoalContextStatus(status: number): WaterTrackingSourceError {
  if (status === 401 || status === 403) {
    return new WaterTrackingSourceError('graphql', 'Water goal context read is not authorized.');
  }
  if (status >= 500) {
    return new WaterTrackingSourceError('network', `Water goal context read failed with status ${status}.`);
  }
  return new WaterTrackingSourceError('invalid_response', `Unexpected water goal context response: ${status}.`);
}

function requireServerBaseUrl(deps: WaterTrackingSourceDeps, operation: string): string {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new WaterTrackingSourceError(
      'configuration',
      `MyChampions server URL is not configured for ${operation}.`
    );
  }
  return baseUrl;
}

async function requireAccessToken(deps: WaterTrackingSourceDeps, operation: string): Promise<string> {
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!accessToken) {
    throw new WaterTrackingSourceError('graphql', `No authenticated server token found for ${operation}.`);
  }
  return accessToken;
}

async function getWaterLogsFromServer(deps: WaterTrackingSourceDeps): Promise<WaterIntakeLog[]> {
  const baseUrl = requireServerBaseUrl(deps, 'water log reads');
  const accessToken = await requireAccessToken(deps, 'water log reads');

  let response: Response;
  try {
    response = await (deps.fetchFn ?? fetch)(`${baseUrl}/nutrition/water-logs`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new WaterTrackingSourceError('network', 'Network request to read water logs failed.');
  }

  let payload: { logs?: ServerWaterLog[] } | null = null;
  try {
    payload = (await response.json()) as { logs?: ServerWaterLog[] };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw normalizeServerStatus(response.status, 'list');
  }
  if (!Array.isArray(payload?.logs)) {
    throw new WaterTrackingSourceError('invalid_response', 'Water log response is missing logs.');
  }

  return payload.logs
    .map(normalizeServerWaterLog)
    .filter((log): log is WaterIntakeLog => log !== null);
}

async function getWaterGoalContextFromServer(deps: WaterTrackingSourceDeps): Promise<WaterGoalContext> {
  const baseUrl = requireServerBaseUrl(deps, 'water goal context reads');
  const accessToken = await requireAccessToken(deps, 'water goal context reads');

  let response: Response;
  try {
    response = await (deps.fetchFn ?? fetch)(`${baseUrl}/nutrition/water-goal-context`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new WaterTrackingSourceError('network', 'Network request to read water goal context failed.');
  }

  let payload: ServerWaterGoalContext | null = null;
  try {
    payload = (await response.json()) as ServerWaterGoalContext;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw normalizeWaterGoalContextStatus(response.status);
  }

  const context = normalizeServerWaterGoalContext(payload);
  if (!context) {
    throw new WaterTrackingSourceError('invalid_response', 'Water goal context response is invalid.');
  }

  return context;
}

async function logWaterIntakeToServer(
  amountMl: number,
  dateKey: string,
  deps: WaterTrackingSourceDeps
): Promise<string> {
  const baseUrl = requireServerBaseUrl(deps, 'water logging');
  const accessToken = await requireAccessToken(deps, 'water logging');

  let response: Response;
  try {
    response = await (deps.fetchFn ?? fetch)(`${baseUrl}/nutrition/water-logs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amountMl, dateKey }),
    });
  } catch {
    throw new WaterTrackingSourceError('network', 'Network request to log water failed.');
  }

  let payload: { log?: ServerWaterLog } | null = null;
  try {
    payload = (await response.json()) as { log?: ServerWaterLog };
  } catch {
    payload = null;
  }

  const log = payload?.log ? normalizeServerWaterLog(payload.log) : null;
  if (response.ok && log) {
    return log.id;
  }

  throw normalizeServerStatus(response.status, 'create');
}

export async function getMyWaterLogs(deps = defaultDeps): Promise<WaterIntakeLog[]> {
  if (deps === defaultDeps && getE2EWaterTrackingSourceOverride()) {
    if (isE2EAssignedNutritionFixtureEnabled()) {
      return [...e2eWaterLogs.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    }
    return [];
  }

  try {
    return await getWaterLogsFromServer(deps);
  } catch (error) {
    throw normalizeWaterSourceError(error);
  }
}

export async function logWaterIntake(
  amountMl: number,
  dateKey: string,
  deps = defaultDeps
): Promise<string> {
  if (deps === defaultDeps && isE2EAssignedNutritionFixtureEnabled()) {
    const uid = getE2EWaterTrackingSourceOverride()?.uid ?? 'e2e-auth-session-user';
    const id = `${uid}_${dateKey}`;
    const existing = e2eWaterLogs.get(id);
    e2eWaterLogs.set(id, {
      id,
      dateKey,
      totalMl: (existing?.totalMl ?? 0) + amountMl,
      loggedAt: '2026-06-22T12:00:00.000Z',
    });
    return id;
  }

  try {
    return await logWaterIntakeToServer(amountMl, dateKey, deps);
  } catch (error) {
    throw normalizeWaterSourceError(error);
  }
}

export async function getMyWaterGoalContext(deps = defaultDeps): Promise<{
  studentGoalMl: number | null;
  nutritionistGoalMl: number | null;
  hasActiveNutritionistAssignment: boolean;
}> {
  if (deps === defaultDeps && getE2EWaterTrackingSourceOverride()) {
    if (isE2EAssignedNutritionFixtureEnabled()) {
      return {
        studentGoalMl: 2500,
        nutritionistGoalMl: 2800,
        hasActiveNutritionistAssignment: true,
      };
    }

    return {
      studentGoalMl: 2500,
      nutritionistGoalMl: null,
      hasActiveNutritionistAssignment: false,
    };
  }

  try {
    return await getWaterGoalContextFromServer(deps);
  } catch (error) {
    throw normalizeWaterSourceError(error);
  }
}

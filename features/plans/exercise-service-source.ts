/**
 * Exercise source - HTTP calls to the MyChampions server exercise catalog routes.
 *
 * Contract:
 *   POST <MyChampions server>/integrations/exercise/search
 *   GET  <MyChampions server>/integrations/exercise/exercises/:id
 *   Authorization: Bearer <MyChampions server access token>
 *
 * The server searches the mirrored local exercise catalog Postgres database.
 */

import { getEffectiveLocale } from '../auth/language-storage';
import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getValidServerAccessToken } from '../auth/server-auth-source';
import { logNetworkDebug } from '../debug/logging';

export type ExerciseVideo = {
  videoUrl?: string;
  videoHlsUrl?: string;
  thumbnailUrl?: string;
  tag?: 'white-background' | 'gym-shot';
  orientation?: 'landscape' | 'portrait';
  isPrimary?: boolean;
};

export type ExerciseItem = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  instructions?: string[] | null;
  importantPoints?: string[] | null;
  muscleGroup: string;
  secondaryMuscles?: string[] | null;
  equipment: string;
  category?: string | null;
  difficulty?: string | null;
  exerciseType?: string[] | null;
  hasVideo: boolean;
  hasVideoWhite: boolean;
  hasVideoGym: boolean;
  videos?: ExerciseVideo[] | null;
  videoUrl?: string | null;
  videoHlsUrl?: string | null;
  thumbnailUrl?: string | null;
  videoDurationSecs?: number | null;
};

export type ExerciseSearchResult = {
  page: number;
  pageSize: number;
  total: number;
  exercises: ExerciseItem[];
  requestId?: string;
};

type CatalogSearchRequestBody = {
  lang: string;
  query: string;
  page: number;
  pageSize: number;
};

type ExerciseServiceDeps = {
  getServerBaseUrl: () => string | undefined;
  getCurrentAccessToken: () => Promise<string | null>;
  getLocale: () => Promise<string>;
  fetchFn: AppFetch;
  createRequestId: () => string;
};

const defaultDeps: ExerciseServiceDeps = {
  getServerBaseUrl: defaultGetServerBaseUrl,
  getCurrentAccessToken: () => getValidServerAccessToken(),
  getLocale: () => getEffectiveLocale(),
  fetchFn: fetch,
  createRequestId: () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  },
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

export type ExerciseServiceErrorCode = 'configuration' | 'network' | 'invalid_response' | 'service' | 'unauthenticated';

export class ExerciseServiceSourceError extends Error {
  code: ExerciseServiceErrorCode;
  status?: number;
  requestId?: string;

  constructor(code: ExerciseServiceErrorCode, message: string, extras?: { status?: number; requestId?: string }) {
    super(message);
    this.code = code;
    this.status = extras?.status;
    this.requestId = extras?.requestId;
    this.name = 'ExerciseServiceSourceError';
  }
}

function normalizeLocaleForService(rawLocale: string): string {
  const trimmed = rawLocale.trim();
  return trimmed.length > 0 ? trimmed : 'en-US';
}

function isExerciseItem(value: unknown): value is ExerciseItem {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<ExerciseItem>;
  return (
    typeof maybe.id === 'string' &&
    typeof maybe.slug === 'string' &&
    typeof maybe.title === 'string' &&
    typeof maybe.muscleGroup === 'string' &&
    typeof maybe.equipment === 'string'
  );
}

function getE2EExerciseSearchFixture(query: string): ExerciseSearchResult | null {
  const override = resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
  if (!override || process.env.EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE !== 'basic') return null;

  const normalized = query.trim().toLowerCase();
  if (!normalized) return { page: 1, pageSize: 20, total: 0, exercises: [], requestId: 'e2e-exercise-fixture' };
  if (!'push'.includes(normalized) && !normalized.includes('push')) {
    return { page: 1, pageSize: 20, total: 0, exercises: [], requestId: 'e2e-exercise-fixture' };
  }

  return {
    page: 1,
    pageSize: 20,
    total: 1,
    requestId: 'e2e-exercise-fixture',
    exercises: [
      {
        id: 'e2e-exercise-push-up',
        slug: 'e2e-push-up',
        title: 'E2E Push-Up',
        description: 'Fixture bodyweight exercise for deterministic E2E builder coverage.',
        instructions: ['Set a straight plank position.', 'Lower under control.', 'Press back to the start.'],
        importantPoints: ['Keep the torso braced.'],
        muscleGroup: 'chest',
        secondaryMuscles: ['triceps', 'shoulders'],
        equipment: 'bodyweight',
        category: 'strength',
        difficulty: 'beginner',
        exerciseType: ['strength'],
        hasVideo: false,
        hasVideoWhite: false,
        hasVideoGym: false,
        videos: [],
        videoUrl: null,
        videoHlsUrl: null,
        thumbnailUrl: null,
        videoDurationSecs: null,
      },
    ],
  };
}

function parseExerciseFromUnknown(payload: unknown): ExerciseItem | null {
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.exercises) && record.exercises.length > 0 && isExerciseItem(record.exercises[0])) {
    return record.exercises[0];
  }

  if (record.data && isExerciseItem(record.data)) {
    return record.data;
  }

  if (isExerciseItem(record)) {
    return record;
  }

  return null;
}

async function resolveServerConnection(deps: ExerciseServiceDeps): Promise<{ baseUrl: string; accessToken: string }> {
  const serverBaseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  if (!serverBaseUrl) {
    throw new ExerciseServiceSourceError(
      'configuration',
      'MyChampions server URL is not configured. Set EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL.'
    );
  }

  const accessToken = await deps.getCurrentAccessToken();
  if (!accessToken) {
    throw new ExerciseServiceSourceError('unauthenticated', 'No authenticated server token found.');
  }

  return { baseUrl: serverBaseUrl, accessToken };
}

async function catalogPost<T>(
  path: string,
  body: CatalogSearchRequestBody,
  deps: ExerciseServiceDeps
): Promise<{ payload: T; requestId?: string; status: number }> {
  const serverConnection = await resolveServerConnection(deps);

  const locale = await deps.getLocale();
  const lang = normalizeLocaleForService(locale);
  const requestId = deps.createRequestId();
  const endpoint = `${serverConnection.baseUrl}/integrations/exercise/search`;
  const requestBody = { ...body, lang };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-request-id': requestId,
    Authorization: `Bearer ${serverConnection.accessToken}`,
  };

  logNetworkDebug(
    'exerciseService.catalogPost',
    'Dispatching catalog request.',
    { path, lang, requestId }
  );
  logNetworkDebug('exerciseService.catalogPost', 'Request endpoint:', endpoint);
  logNetworkDebug('exerciseService.catalogPost', 'Request body:', requestBody);

  let response: Response;
  try {
    response = await deps.fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    console.error('[exerciseService.catalogPost] Network request failed:', {
      path,
      requestId,
      error: (error as Error)?.message ?? String(error),
    });
    throw new ExerciseServiceSourceError(
      'network',
      `Exercise service request failed: ${(error as Error)?.message ?? 'network error'}`
    );
  }

  const responseRequestId = response.headers.get('x-request-id') ?? requestId;
  logNetworkDebug('exerciseService.catalogPost', 'Response status/request-id:', response.status, responseRequestId);

  if (!response.ok) {
    let responseBody = '';
    try {
      responseBody = await response.text();
    } catch {
      responseBody = '';
    }
    console.error('[exerciseService.catalogPost] Service returned non-OK status:', {
      path,
      requestId: responseRequestId,
      status: response.status,
      body: responseBody,
    });

    throw new ExerciseServiceSourceError(
      'service',
      `Exercise service returned ${response.status}${responseBody ? `: ${responseBody}` : ''}`,
      { status: response.status, requestId: responseRequestId }
    );
  }

  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch {
    console.error('[exerciseService.catalogPost] Response JSON parse failed:', {
      path,
      requestId: responseRequestId,
      status: response.status,
    });
    throw new ExerciseServiceSourceError(
      'invalid_response',
      'Exercise service returned a non-JSON response.',
      { status: response.status, requestId: responseRequestId }
    );
  }

  logNetworkDebug('exerciseService.catalogPost', 'Request completed successfully.', {
    path,
    requestId: responseRequestId,
    status: response.status,
  });
  return { payload, requestId: responseRequestId, status: response.status };
}

async function catalogGet<T>(
  path: string,
  deps: ExerciseServiceDeps
): Promise<{ payload: T; requestId?: string; status: number }> {
  const serverConnection = await resolveServerConnection(deps);

  const requestId = deps.createRequestId();
  const endpoint = `${serverConnection.baseUrl}/integrations/exercise${path.replace(/^\/catalog/, '')}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-request-id': requestId,
    Authorization: `Bearer ${serverConnection.accessToken}`,
  };

  let response: Response;
  try {
    response = await deps.fetchFn(endpoint, {
      method: 'GET',
      headers,
    });
  } catch (error) {
    console.error('[exerciseService.catalogGet] Network request failed:', {
      path,
      requestId,
      error: (error as Error)?.message ?? String(error),
    });
    throw new ExerciseServiceSourceError(
      'network',
      `Exercise service request failed: ${(error as Error)?.message ?? 'network error'}`
    );
  }

  const responseRequestId = response.headers.get('x-request-id') ?? requestId;
  if (!response.ok) {
    let responseBody = '';
    try {
      responseBody = await response.text();
    } catch {
      responseBody = '';
    }

    throw new ExerciseServiceSourceError(
      'service',
      `Exercise service returned ${response.status}${responseBody ? `: ${responseBody}` : ''}`,
      { status: response.status, requestId: responseRequestId }
    );
  }

  try {
    return {
      payload: (await response.json()) as T,
      requestId: responseRequestId,
      status: response.status,
    };
  } catch {
    throw new ExerciseServiceSourceError(
      'invalid_response',
      'Exercise service returned a non-JSON response.',
      { status: response.status, requestId: responseRequestId }
    );
  }
}

export async function searchExerciseLibrary(
  query: string,
  pageSize = 20,
  deps: ExerciseServiceDeps = defaultDeps
): Promise<ExerciseSearchResult> {
  const fixture = getE2EExerciseSearchFixture(query);
  if (fixture) {
    return {
      ...fixture,
      pageSize,
    };
  }

  const { payload, requestId } = await catalogPost<{
    page?: number;
    pageSize?: number;
    total?: number;
    exercises?: unknown[];
    results?: unknown[];
    data?: unknown[];
    pagination?: {
      page?: number;
      pageSize?: number;
      total?: number;
    };
  }>('/catalog/search', { query: query.trim(), lang: '', page: 1, pageSize }, deps);

  const rawExercises = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.exercises)
    ? payload.exercises
    : Array.isArray(payload.data)
      ? payload.data
      : [];

  const exercises = Array.isArray(rawExercises)
    ? rawExercises.filter((item): item is ExerciseItem => isExerciseItem(item))
    : [];

  const page = typeof payload.page === 'number'
    ? payload.page
    : typeof payload.pagination?.page === 'number'
      ? payload.pagination.page
      : 1;
  const resolvedPageSize = typeof payload.pageSize === 'number'
    ? payload.pageSize
    : typeof payload.pagination?.pageSize === 'number'
      ? payload.pagination.pageSize
      : pageSize;
  const total = typeof payload.total === 'number'
    ? payload.total
    : typeof payload.pagination?.total === 'number'
      ? payload.pagination.total
      : exercises.length;

  logNetworkDebug('exerciseService.searchExerciseLibrary', 'Search response parsed.', {
    requestId,
    page,
    pageSize: resolvedPageSize,
    total,
    exercisesCount: exercises.length,
  });

  return {
    page,
    pageSize: resolvedPageSize,
    total,
    exercises,
    requestId,
  };
}

/**
 * Fetches one exercise by upstream ID through the proxy service.
 * Returns null for not found or invalid payload.
 */
export async function getExerciseById(
  id: string,
  deps: ExerciseServiceDeps = defaultDeps
): Promise<ExerciseItem | null> {
  if (!id?.trim()) return null;

  try {
    const locale = normalizeLocaleForService(await deps.getLocale());
    const detailPath = `/catalog/exercises/${encodeURIComponent(id.trim())}?lang=${encodeURIComponent(locale)}`;
    const { payload } = await catalogGet<unknown>(detailPath, deps);
    const parsed = parseExerciseFromUnknown(payload);
    logNetworkDebug('exerciseService.getExerciseById', 'Detail response parsed.', {
      found: Boolean(parsed),
    });
    return parsed;
  } catch (error) {
    if (
      error instanceof ExerciseServiceSourceError &&
      error.code === 'service' &&
      error.status === 404
    ) {
      logNetworkDebug('exerciseService.getExerciseById', 'Exercise not found (404).', {
        requestId: error.requestId,
      });
      return null;
    }
    console.error('[exerciseService.getExerciseById] Detail request failed:', {
      error: (error as Error)?.message ?? String(error),
      requestId: error instanceof ExerciseServiceSourceError ? error.requestId : undefined,
      status: error instanceof ExerciseServiceSourceError ? error.status : undefined,
    });
    throw error;
  }
}

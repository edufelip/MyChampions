/**
 * Exercise service source.
 *
 * Mobile calls the proxy service:
 *   POST https://exerciseservice.eduwaldo.com/proxy
 *
 * The service validates URL constraints, injects the upstream YMove API key,
 * translates text fields by language, and returns x-request-id for tracing.
 */

import { getEffectiveLocale } from '../auth/language-storage';
import { logNetworkDebug } from '../debug/logging';

const UPSTREAM_BASE_URL = 'https://exercise-api.ymove.app/api/v2';

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

type ProxyRequestBody = {
  lang: string;
  request: {
    url: string;
    method: 'GET';
    headers: {
      Accept: 'application/json';
    };
  };
};

type ExerciseServiceDeps = {
  getServiceBaseUrl: () => string | undefined;
  getLocale: () => Promise<string>;
  fetchFn: typeof fetch;
  createRequestId: () => string;
};

const defaultDeps: ExerciseServiceDeps = {
  getServiceBaseUrl: () => process.env.EXPO_PUBLIC_EXERCISE_SERVICE_URL?.trim(),
  getLocale: () => getEffectiveLocale(),
  fetchFn: fetch,
  createRequestId: () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  },
};

export type ExerciseServiceErrorCode = 'configuration' | 'network' | 'invalid_response' | 'service';

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

function normalizeLang(rawLocale: string): 'en' | 'pt' | 'es' {
  const lower = rawLocale.trim().toLowerCase();
  if (lower.startsWith('pt')) return 'pt';
  if (lower.startsWith('es')) return 'es';
  return 'en';
}

function buildExerciseSearchUrl(query: string, pageSize: number): string {
  const trimmedQuery = query.trim();
  let url = `${UPSTREAM_BASE_URL}/exercises?pageSize=${pageSize}`;
  if (trimmedQuery) {
    url += `&search=${encodeURIComponent(trimmedQuery)}`;
  }
  return url;
}

function buildExerciseByIdUrl(id: string): string {
  return `${UPSTREAM_BASE_URL}/exercises/${encodeURIComponent(id.trim())}`;
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

async function proxyGet<T>(
  upstreamUrl: string,
  deps: ExerciseServiceDeps
): Promise<{ payload: T; requestId?: string; status: number }> {
  const serviceBaseUrl = deps.getServiceBaseUrl();
  if (!serviceBaseUrl) {
    console.error('[exerciseService.proxyGet] Missing EXPO_PUBLIC_EXERCISE_SERVICE_URL.');
    throw new ExerciseServiceSourceError(
      'configuration',
      'Exercise service URL is missing. Set EXPO_PUBLIC_EXERCISE_SERVICE_URL.'
    );
  }

  const locale = await deps.getLocale();
  const lang = normalizeLang(locale);
  const requestId = deps.createRequestId();
  const endpoint = `${serviceBaseUrl.replace(/\/+$/, '')}/proxy`;

  const body: ProxyRequestBody = {
    lang,
    request: {
      url: upstreamUrl,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  };

  logNetworkDebug(
    'exerciseService.proxyGet',
    'Dispatching proxy request.',
    { upstreamUrl, lang, requestId }
  );
  logNetworkDebug('exerciseService.proxyGet', 'Request endpoint:', endpoint);
  logNetworkDebug('exerciseService.proxyGet', 'Request body:', body);

  let response: Response;
  try {
    response = await deps.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('[exerciseService.proxyGet] Network request failed:', {
      upstreamUrl,
      requestId,
      error: (error as Error)?.message ?? String(error),
    });
    throw new ExerciseServiceSourceError(
      'network',
      `Exercise service request failed: ${(error as Error)?.message ?? 'network error'}`
    );
  }

  const responseRequestId = response.headers.get('x-request-id') ?? requestId;
  logNetworkDebug('exerciseService.proxyGet', 'Response status/request-id:', response.status, responseRequestId);

  if (!response.ok) {
    let responseBody = '';
    try {
      responseBody = await response.text();
    } catch {
      responseBody = '';
    }
    console.error('[exerciseService.proxyGet] Service returned non-OK status:', {
      upstreamUrl,
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
    console.error('[exerciseService.proxyGet] Response JSON parse failed:', {
      upstreamUrl,
      requestId: responseRequestId,
      status: response.status,
    });
    throw new ExerciseServiceSourceError(
      'invalid_response',
      'Exercise service returned a non-JSON response.',
      { status: response.status, requestId: responseRequestId }
    );
  }

  logNetworkDebug('exerciseService.proxyGet', 'Request completed successfully.', {
    upstreamUrl,
    requestId: responseRequestId,
    status: response.status,
  });
  return { payload, requestId: responseRequestId, status: response.status };
}

export async function searchExerciseLibrary(
  query: string,
  pageSize = 20,
  deps: ExerciseServiceDeps = defaultDeps
): Promise<ExerciseSearchResult> {
  const upstreamUrl = buildExerciseSearchUrl(query, pageSize);
  const { payload, requestId } = await proxyGet<{
    page?: number;
    pageSize?: number;
    total?: number;
    exercises?: unknown[];
    data?: unknown[];
    pagination?: {
      page?: number;
      pageSize?: number;
      total?: number;
    };
  }>(upstreamUrl, deps);

  const rawExercises = Array.isArray(payload.exercises)
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
    upstreamUrl,
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

  const upstreamUrl = buildExerciseByIdUrl(id);
  try {
    const { payload } = await proxyGet<unknown>(upstreamUrl, deps);
    const parsed = parseExerciseFromUnknown(payload);
    logNetworkDebug('exerciseService.getExerciseById', 'Detail response parsed.', {
      upstreamUrl,
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
        upstreamUrl,
        requestId: error.requestId,
      });
      return null;
    }
    console.error('[exerciseService.getExerciseById] Detail request failed:', {
      upstreamUrl,
      error: (error as Error)?.message ?? String(error),
      requestId: error instanceof ExerciseServiceSourceError ? error.requestId : undefined,
      status: error instanceof ExerciseServiceSourceError ? error.status : undefined,
    });
    throw error;
  }
}

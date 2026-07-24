/**
 * Workout logging source operations — daily check-off log creation & queries.
 */

import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getValidServerAccessToken } from '../auth/server-auth-source';

export type WorkoutLog = {
  id: string;
  ownerUid: string;
  sessionId: string;
  sessionName: string;
  createdAt: string;
};

type WorkoutLogSourceDeps = {
  getCurrentAccessToken?: () => Promise<string | null>;
  getServerBaseUrl?: () => string | undefined;
  fetchFn?: AppFetch;
};

const defaultDeps: WorkoutLogSourceDeps = {
  getCurrentAccessToken: () => getValidServerAccessToken(),
  getServerBaseUrl: resolveServerBaseUrl,
  fetchFn: fetch,
};
const e2eWorkoutLogs = new Map<string, WorkoutLog>();

type WorkoutLogSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'permission'
  | 'invalid_response'
  | 'unknown';

export class WorkoutLogSourceError extends Error {
  code: WorkoutLogSourceErrorCode;
  constructor(code: WorkoutLogSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WorkoutLogSourceError';
  }
}

function normalizeError(error: any): WorkoutLogSourceError {
  if (error instanceof WorkoutLogSourceError) return error;
  return new WorkoutLogSourceError('unknown', (error as Error)?.message ?? 'Workout log operation failed.');
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

function getE2EWorkoutLogSourceOverride() {
  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

function isE2EAssignedTrainingFixtureEnabled(): boolean {
  return Boolean(getE2EWorkoutLogSourceOverride()) &&
    process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE === 'assigned';
}

type ServerWorkoutLog = Partial<WorkoutLog>;

function normalizeServerWorkoutLog(input: ServerWorkoutLog): WorkoutLog | null {
  const id = typeof input.id === 'string' ? input.id : '';
  const ownerUid = typeof input.ownerUid === 'string' ? input.ownerUid : '';
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
  const sessionName = typeof input.sessionName === 'string' ? input.sessionName : '';
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : '';

  if (!id || !ownerUid || !sessionId || !sessionName || !createdAt) return null;

  return { id, ownerUid, sessionId, sessionName, createdAt };
}

function normalizeServerError(status: number, operation: 'create' | 'list'): WorkoutLogSourceError {
  if (status === 401 || status === 403) {
    return new WorkoutLogSourceError('permission', `Workout log ${operation} is not authorized.`);
  }
  if (status >= 500) {
    return new WorkoutLogSourceError('network', `Workout log ${operation} failed with status ${status}.`);
  }
  return new WorkoutLogSourceError('invalid_response', `Unexpected workout log ${operation} response: ${status}.`);
}

async function logWorkoutSessionToServer(
  sessionId: string,
  sessionName: string,
  deps: WorkoutLogSourceDeps
): Promise<void> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl) {
    throw new WorkoutLogSourceError(
      'configuration',
      'MyChampions server URL is not configured for workout logging.'
    );
  }
  if (!accessToken) {
    throw new WorkoutLogSourceError('permission', 'No authenticated server token found for workout logging.');
  }

  let response: Response;
  try {
    response = await (deps.fetchFn ?? fetch)(`${baseUrl}/training/workout-logs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sessionId, sessionName }),
    });
  } catch {
    throw new WorkoutLogSourceError('network', 'Network request to log workout failed.');
  }

  let payload: { log?: ServerWorkoutLog } | null = null;
  try {
    payload = (await response.json()) as { log?: ServerWorkoutLog };
  } catch {
    payload = null;
  }

  if (response.ok && payload?.log && normalizeServerWorkoutLog(payload.log)) {
    return;
  }

  throw normalizeServerError(response.status, 'create');
}

async function getWorkoutLogsFromServer(
  fromIso: string,
  deps: WorkoutLogSourceDeps
): Promise<WorkoutLog[]> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl) {
    throw new WorkoutLogSourceError(
      'configuration',
      'MyChampions server URL is not configured for workout log reads.'
    );
  }
  if (!accessToken) {
    throw new WorkoutLogSourceError('permission', 'No authenticated server token found for workout log reads.');
  }

  let response: Response;
  try {
    response = await (deps.fetchFn ?? fetch)(`${baseUrl}/training/workout-logs?from=${encodeURIComponent(fromIso)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new WorkoutLogSourceError('network', 'Network request to read workout logs failed.');
  }

  let payload: { logs?: ServerWorkoutLog[] } | null = null;
  try {
    payload = (await response.json()) as { logs?: ServerWorkoutLog[] };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw normalizeServerError(response.status, 'list');
  }

  if (!Array.isArray(payload?.logs)) {
    throw new WorkoutLogSourceError('invalid_response', 'Workout log response is missing logs.');
  }

  return payload.logs
    .map(normalizeServerWorkoutLog)
    .filter((log): log is WorkoutLog => log !== null);
}

export async function logWorkoutSession(
  sessionId: string,
  sessionName: string,
  deps = defaultDeps
): Promise<void> {
  if (deps === defaultDeps && isE2EAssignedTrainingFixtureEnabled()) {
    const ownerUid = getE2EWorkoutLogSourceOverride()?.uid ?? 'e2e-auth-session-user';
    const id = `e2e-workout-log-${sessionId}`;
    e2eWorkoutLogs.set(id, {
      id,
      ownerUid,
      sessionId,
      sessionName,
      createdAt: '2026-06-22T12:00:00.000Z',
    });
    return;
  }

  try {
    await logWorkoutSessionToServer(sessionId, sessionName, deps);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getTodayWorkoutLogs(deps = defaultDeps): Promise<WorkoutLog[]> {
  if (deps === defaultDeps && isE2EAssignedTrainingFixtureEnabled()) {
    return [...e2eWorkoutLogs.values()];
  }

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    return await getWorkoutLogsFromServer(todayStartIso, deps);
  } catch (error) {
    throw normalizeError(error);
  }
}

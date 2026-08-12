/**
 * Connection source — invite submit, confirm, end, list.
 */

import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getValidServerAccessToken } from '../auth/server-auth-source';
import { defaultAppFetch } from '../platform/default-app-fetch';
import {
  normalizeConnectionStatus,
  normalizeCanceledReason,
  normalizeConnectionSpecialty,
  type ConnectionRecord,
  type ConnectionSpecialty,
} from './connection.logic';

// ─── Error type ───────────────────────────────────────────────────────────────

type ConnectionSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class ConnectionSourceError extends Error {
  code: ConnectionSourceErrorCode;

  constructor(code: ConnectionSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ConnectionSourceError';
  }
}

type PendingConnectionFromInvite = {
  id: string;
  status: string;
  canceledReason?: string | null;
  specialty: string;
  professionalAuthUid: string;
  studentAuthUid: string;
  sourceInviteCodeId?: string | null;
  sourceInviteCodeValue?: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt?: string | null;
};

type InviteConnectionInput = {
  professionalAuthUid: string;
  specialty: ConnectionSpecialty;
  codeValue: string;
};

const MAX_PENDING_STUDENTS = 10;

export function buildPendingConnectionFromInvite(input: {
  connectionId: string;
  studentUid: string;
  inviteDocId: string;
  invite: InviteConnectionInput;
  timestamp: string;
}): PendingConnectionFromInvite {
  return {
    id: input.connectionId,
    studentAuthUid: input.studentUid,
    professionalAuthUid: input.invite.professionalAuthUid,
    specialty: input.invite.specialty,
    status: 'pending_confirmation',
    canceledReason: null,
    sourceInviteCodeId: input.inviteDocId,
    sourceInviteCodeValue: input.invite.codeValue,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    endedAt: null,
  };
}

export function isPendingStudentCapReached(
  pendingConnections: Array<{ studentAuthUid?: string | null }>,
  nextStudentUid: string,
  cap = MAX_PENDING_STUDENTS,
): boolean {
  const pendingStudentUids = new Set(
    pendingConnections
      .map((connection) => connection.studentAuthUid)
      .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0),
  );
  pendingStudentUids.add(nextStudentUid);
  return pendingStudentUids.size > cap;
}

export function getExistingInviteConnectionConflict(
  connections: Array<{ status?: string | null }>,
): 'active' | 'pending' | null {
  if (connections.some((connection) => connection.status === 'active')) return 'active';
  if (connections.some((connection) => connection.status === 'pending_confirmation'))
    return 'pending';
  return null;
}

export type ConnectionSourceDeps = {
  getCurrentAccessToken?: () => Promise<string | null>;
  getServerBaseUrl?: () => string | undefined;
  fetchFn?: AppFetch;
};

const defaultConnectionSourceDeps: ConnectionSourceDeps = {
  getCurrentAccessToken: () => getValidServerAccessToken(),
  getServerBaseUrl: resolveServerBaseUrl,
  fetchFn: defaultAppFetch,
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

function getE2EConnectionSourceOverride() {
  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

const e2eEndedConnectionIds = new Set<string>();
const e2eSubmittedInviteConnections = new Map<string, ConnectionRecord>();

type E2EPendingMutationMode = 'delay' | 'failure';

function getE2EPendingMutationMode(): E2EPendingMutationMode | null {
  if (typeof window !== 'undefined') {
    try {
      const value = window.localStorage.getItem('mychampions.e2e.pending-mutation');
      if (value === 'delay' || value === 'failure') return value;
    } catch {
      // Browser storage is optional in native and privacy-restricted contexts.
    }
  }
  return null;
}

function getE2EInviteSubmitFixture() {
  const override = getE2EConnectionSourceOverride();
  if (!override) return null;

  return process.env.EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE === 'success' ? 'success' : null;
}

function buildE2EPendingConnectionFromCode(code: string): ConnectionRecord {
  const normalizedCode = code.trim().toUpperCase();
  const specialty: ConnectionSpecialty = normalizedCode.startsWith('FIT')
    ? 'fitness_coach'
    : 'nutritionist';
  const professionalAuthUid =
    specialty === 'fitness_coach' ? 'e2e-fitness-coach' : 'e2e-nutritionist';
  const id =
    specialty === 'fitness_coach'
      ? 'e2e-pending-fitness-coach-connection'
      : 'e2e-pending-nutritionist-connection';

  return {
    id,
    status: 'pending_confirmation',
    canceledReason: null,
    specialty,
    professionalAuthUid,
  };
}

function getE2EConnectionFixtures(): ConnectionRecord[] | null {
  const override = getE2EConnectionSourceOverride();
  if (!override) return null;

  const connections: ConnectionRecord[] = [];

  if (process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE === 'assigned') {
    connections.push({
      id: 'e2e-active-nutritionist-connection',
      status: e2eEndedConnectionIds.has('e2e-active-nutritionist-connection') ? 'ended' : 'active',
      canceledReason: null,
      specialty: 'nutritionist',
      professionalAuthUid: 'e2e-nutritionist',
    });
  }

  if (process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE === 'assigned') {
    connections.push({
      id: 'e2e-active-fitness-coach-connection',
      status: e2eEndedConnectionIds.has('e2e-active-fitness-coach-connection') ? 'ended' : 'active',
      canceledReason: null,
      specialty: 'fitness_coach',
      professionalAuthUid: 'e2e-fitness-coach',
    });
  }

  if (
    process.env.EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE === 'basic' &&
    isProfessionalE2EFixtureSession() &&
    !e2eEndedConnectionIds.has('e2e-professional-pending-connection')
  ) {
    connections.push({
      id: 'e2e-professional-pending-connection',
      status: 'pending_confirmation',
      canceledReason: null,
      specialty: 'nutritionist',
      professionalAuthUid: 'e2e-nutritionist',
    });
  }

  if (getE2EInviteSubmitFixture() === 'success') {
    connections.push(...e2eSubmittedInviteConnections.values());
  }

  return connections;
}

function isProfessionalE2EFixtureSession(): boolean {
  if (typeof sessionStorage === 'undefined') return true;
  return sessionStorage.getItem('mychampions.e2e.locked-role') === 'professional';
}

function normalizeConnectionSourceError(error: unknown): ConnectionSourceError {
  if (error instanceof ConnectionSourceError) return error;

  return new ConnectionSourceError(
    'invalid_response',
    (error as Error)?.message ?? 'Unexpected connection source error.',
  );
}

function requireServerResult<T>(result: T | null, operation: string): T {
  if (result) return result;
  throw new ConnectionSourceError('configuration', `${operation} requires local server auth.`);
}

type ServerConnectionResponse = {
  connections?: Array<Partial<ConnectionRecord>>;
  error?: {
    code?: string;
    message?: string;
  };
};

type ServerInviteSubmitResponse = {
  connectionId?: unknown;
  status?: unknown;
  error?: unknown;
};

type ServerConnectionActionResponse = {
  connectionId?: unknown;
  status?: unknown;
  error?: unknown;
};

function mapServerConnections(payload: ServerConnectionResponse | null): ConnectionRecord[] {
  const connections = Array.isArray(payload?.connections) ? payload.connections : null;
  if (!connections) {
    throw new ConnectionSourceError('invalid_response', 'Connections response is missing.');
  }

  return connections
    .map((connection) => {
      const id = typeof connection.id === 'string' ? connection.id : '';
      const status = normalizeConnectionStatus(connection.status);
      const specialty = normalizeConnectionSpecialty(connection.specialty);
      const professionalAuthUid =
        typeof connection.professionalAuthUid === 'string' ? connection.professionalAuthUid : '';

      if (!id || !status || !specialty || !professionalAuthUid) return null;

      return {
        id,
        status,
        canceledReason: normalizeCanceledReason(connection.canceledReason ?? null),
        specialty,
        professionalAuthUid,
      };
    })
    .filter((connection): connection is ConnectionRecord => connection !== null);
}

async function readServerJson(response: Response): Promise<ServerConnectionResponse | null> {
  try {
    return (await response.json()) as ServerConnectionResponse;
  } catch {
    return null;
  }
}

async function readServerInviteJson(
  response: Response,
): Promise<ServerInviteSubmitResponse | null> {
  try {
    return (await response.json()) as ServerInviteSubmitResponse;
  } catch {
    return null;
  }
}

async function readServerConnectionActionJson(
  response: Response,
): Promise<ServerConnectionActionResponse | null> {
  try {
    return (await response.json()) as ServerConnectionActionResponse;
  } catch {
    return null;
  }
}

function normalizeServerConnectionError(
  status: number,
  payload: ServerConnectionResponse | null,
): ConnectionSourceError {
  const code = payload?.error?.code;
  const message =
    payload?.error?.message ?? `Connections server request failed with status ${status}.`;

  if (status === 401 || code === 'unauthorized') {
    return new ConnectionSourceError('graphql', message);
  }
  if (status >= 500) {
    return new ConnectionSourceError('network', message);
  }
  return new ConnectionSourceError('invalid_response', message);
}

async function getMyConnectionsFromServer(
  deps: ConnectionSourceDeps,
): Promise<ConnectionRecord[] | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();

  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(`${baseUrl}/connections`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ConnectionSourceError('network', 'Network request to list connections failed.');
  }

  const payload = await readServerJson(response);
  if (!response.ok) {
    throw normalizeServerConnectionError(response.status, payload);
  }

  return mapServerConnections(payload);
}

function normalizeServerInviteSubmitError(
  status: number,
  payload: ServerInviteSubmitResponse | null,
): ConnectionSourceError {
  const error = payload?.error;
  if (error === 'not_found') {
    return new ConnectionSourceError('graphql', 'Invite code not found.');
  }
  if (error === 'already_connected') {
    return new ConnectionSourceError('graphql', 'Already connected.');
  }
  if (error === 'pending_already_exists') {
    return new ConnectionSourceError('graphql', 'Pending request already exists.');
  }
  if (error === 'pending_cap_reached') {
    return new ConnectionSourceError('graphql', 'Pending cap reached.');
  }
  if (status === 401 || status === 403 || error === 'unauthorized' || error === 'forbidden') {
    return new ConnectionSourceError('graphql', 'Invite submission is not authorized.');
  }
  if (status >= 500) {
    return new ConnectionSourceError('network', `Invite submission failed with status ${status}.`);
  }
  return new ConnectionSourceError(
    'invalid_response',
    `Unexpected invite submission response: ${status}.`,
  );
}

async function submitInviteCodeToServer(
  code: string,
  deps: ConnectionSourceDeps,
): Promise<{ connectionId: string; status: 'pending_confirmation' } | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${baseUrl}/connections/invite-submissions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code: code.trim() }),
      },
    );
  } catch {
    throw new ConnectionSourceError('network', 'Network request to submit invite code failed.');
  }

  const payload = await readServerInviteJson(response);
  if (
    (response.status === 200 || response.status === 201) &&
    typeof payload?.connectionId === 'string' &&
    payload.status === 'pending_confirmation'
  ) {
    return { connectionId: payload.connectionId, status: 'pending_confirmation' };
  }

  throw normalizeServerInviteSubmitError(response.status, payload);
}

function normalizeServerConnectionActionError(
  status: number,
  payload: ServerConnectionActionResponse | null,
  action: 'confirm' | 'end',
): ConnectionSourceError {
  const error = payload?.error;
  if (error === 'not_found') {
    return new ConnectionSourceError('graphql', 'Connection not found.');
  }
  if (error === 'invalid_transition') {
    return new ConnectionSourceError('graphql', 'Invalid connection transition.');
  }
  if (error === 'already_connected') {
    return new ConnectionSourceError('graphql', 'Already connected.');
  }
  if (error === 'professional_subscription_required') {
    return new ConnectionSourceError('graphql', 'Professional subscription required.');
  }
  if (status === 401 || status === 403 || error === 'unauthorized' || error === 'forbidden') {
    return new ConnectionSourceError('graphql', `Connection ${action} is not authorized.`);
  }
  if (status >= 500) {
    return new ConnectionSourceError(
      'network',
      `Connection ${action} failed with status ${status}.`,
    );
  }
  return new ConnectionSourceError(
    'invalid_response',
    `Unexpected connection ${action} response: ${status}.`,
  );
}

async function confirmPendingConnectionToServer(
  connectionId: string,
  deps: ConnectionSourceDeps,
): Promise<{ connectionId: string; status: 'active' } | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${baseUrl}/connections/${connectionId}/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      },
    );
  } catch {
    throw new ConnectionSourceError('network', 'Network request to confirm connection failed.');
  }

  const payload = await readServerConnectionActionJson(response);
  if (response.ok && typeof payload?.connectionId === 'string' && payload.status === 'active') {
    return { connectionId: payload.connectionId, status: 'active' };
  }

  throw normalizeServerConnectionActionError(response.status, payload, 'confirm');
}

async function endConnectionToServer(
  connectionId: string,
  deps: ConnectionSourceDeps,
): Promise<boolean> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return false;

  let response: Response;
  try {
    response = await (deps.fetchFn ?? defaultAppFetch)(
      `${baseUrl}/connections/${connectionId}/end`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      },
    );
  } catch {
    throw new ConnectionSourceError('network', 'Network request to end connection failed.');
  }

  const payload = await readServerConnectionActionJson(response);
  if (response.ok && typeof payload?.connectionId === 'string' && payload.status === 'ended') {
    return true;
  }

  throw normalizeServerConnectionActionError(response.status, payload, 'end');
}

export async function submitInviteCode(
  code: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps,
): Promise<{ connectionId: string; status: 'pending_confirmation' }> {
  if (deps === defaultConnectionSourceDeps && getE2EInviteSubmitFixture() === 'success') {
    const connection = buildE2EPendingConnectionFromCode(code);
    e2eSubmittedInviteConnections.set(connection.id, connection);
    return { connectionId: connection.id, status: 'pending_confirmation' };
  }

  try {
    const serverResult = await submitInviteCodeToServer(code, deps);
    if (serverResult) return serverResult;

    throw new ConnectionSourceError(
      'configuration',
      'Invite submission requires local server auth.',
    );
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }
}

export async function confirmPendingConnection(
  connectionId: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps,
): Promise<{ connectionId: string; status: 'active' }> {
  try {
    return requireServerResult(
      await confirmPendingConnectionToServer(connectionId, deps),
      'Connection confirmation',
    );
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }
}

export async function endConnection(
  connectionId: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps,
): Promise<void> {
  if (deps === defaultConnectionSourceDeps) {
    const e2eConnections = getE2EConnectionFixtures();
    if (e2eConnections) {
      const connection = e2eConnections.find((candidate) => candidate.id === connectionId);
      if (!connection) {
        throw new ConnectionSourceError('graphql', 'Connection not found.');
      }
      const mutationMode = getE2EPendingMutationMode();
      if (mutationMode === 'delay') {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (mutationMode === 'failure') {
        throw new ConnectionSourceError('network', 'Deterministic E2E mutation failure.');
      }
      e2eEndedConnectionIds.add(connectionId);
      return;
    }
  }

  try {
    requireServerResult(await endConnectionToServer(connectionId, deps), 'Connection end');
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }
}

export async function getMyConnections(
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps,
): Promise<ConnectionRecord[]> {
  if (deps === defaultConnectionSourceDeps) {
    const e2eConnections = getE2EConnectionFixtures();
    if (e2eConnections) return e2eConnections;
  }

  try {
    return requireServerResult(await getMyConnectionsFromServer(deps), 'Connection reads');
  } catch (error) {
    throw normalizeConnectionSourceError(error);
  }
}

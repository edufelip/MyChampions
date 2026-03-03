/**
 * Connection Data Connect source — invite submit, confirm, end, list.
 * Uses generated SDK (D-114 pattern) instead of raw GraphQL fetch.
 * Refs: D-069, D-072, FR-106–FR-110, BR-220–BR-232
 */

import type { DataConnect } from 'firebase/data-connect';
import {
  getMyConnections as _getMyConnections,
  submitInviteCode as _submitInviteCode,
  confirmPendingConnection as _confirmPendingConnection,
  endConnection as _endConnection,
  type GetMyConnectionsData,
  type SubmitInviteCodeData,
  type SubmitInviteCodeVariables,
  type ConfirmPendingConnectionData,
  type ConfirmPendingConnectionVariables,
  type EndConnectionData,
  type EndConnectionVariables,
} from '@mychampions/dataconnect-generated';
import { getDataConnectInstance as _getDataConnectInstance } from '../dataconnect';

import {
  normalizeConnectionStatus,
  normalizeCanceledReason,
  normalizeConnectionSpecialty,
  type ConnectionRecord,
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

// ─── Injectable deps (D-114 pattern) ─────────────────────────────────────────

export type ConnectionSourceDeps = {
  getMyConnections: (dc: DataConnect) => Promise<{ data: GetMyConnectionsData }>;
  submitInviteCode: (dc: DataConnect, vars: SubmitInviteCodeVariables) => Promise<{ data: SubmitInviteCodeData }>;
  confirmPendingConnection: (dc: DataConnect, vars: ConfirmPendingConnectionVariables) => Promise<{ data: ConfirmPendingConnectionData }>;
  endConnection: (dc: DataConnect, vars: EndConnectionVariables) => Promise<{ data: EndConnectionData }>;
  getDataConnectInstance: () => DataConnect;
};

const defaultConnectionSourceDeps: ConnectionSourceDeps = {
  getMyConnections: _getMyConnections,
  submitInviteCode: _submitInviteCode,
  confirmPendingConnection: _confirmPendingConnection,
  endConnection: _endConnection,
  getDataConnectInstance: _getDataConnectInstance,
};

// ─── Operations ───────────────────────────────────────────────────────────────

/**
 * Submits an invite code, creating a new pending_confirmation connection.
 * Returns the created connection id.
 * Ref: FR-106, BR-220
 */
export async function submitInviteCode(
  code: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps
): Promise<{ connectionId: string; status: 'pending_confirmation' }> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.submitInviteCode(dc, { code });

  const id = data.connection_insert?.id;
  if (!id) {
    throw new ConnectionSourceError(
      'invalid_response',
      'submitInviteCode returned no connection id.'
    );
  }

  return { connectionId: id, status: 'pending_confirmation' };
}

/**
 * Professional confirms a pending connection request.
 * Returns the confirmed connection id.
 * Ref: FR-107, BR-221
 */
export async function confirmPendingConnection(
  connectionId: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps
): Promise<{ connectionId: string; status: 'active' }> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.confirmPendingConnection(dc, { connection_id: connectionId });

  const id = data.connection_update?.id;
  if (!id) {
    throw new ConnectionSourceError(
      'invalid_response',
      'confirmPendingConnection returned no connection id.'
    );
  }

  return { connectionId: id, status: 'active' };
}

/**
 * Ends (cancels/denies) a connection.
 * Ref: FR-108, D-064
 */
export async function endConnection(
  connectionId: string,
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.endConnection(dc, { connection_id: connectionId });
}

/**
 * Returns all connections for the current user (student: their connections;
 * professional: connections where they are the professional).
 * Ref: FR-109
 */
export async function getMyConnections(
  deps: ConnectionSourceDeps = defaultConnectionSourceDeps
): Promise<ConnectionRecord[]> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getMyConnections(dc);

  return data.connections.flatMap((item) => {
    const id = item.id;
    const status = normalizeConnectionStatus(item.status);
    const specialty = normalizeConnectionSpecialty(item.specialty);

    if (!id || !status || !specialty) {
      return [];
    }

    return [
      {
        id,
        status,
        canceledReason: normalizeCanceledReason(item.canceledReason ?? null),
        specialty,
        professionalAuthUid: item.professionalAuthUid ?? '',
      } satisfies ConnectionRecord,
    ];
  });
}

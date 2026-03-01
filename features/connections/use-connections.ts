import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import {
  getMyConnections,
  submitInviteCode,
  confirmPendingConnection,
  endConnection,
  type ConnectionSourceError,
} from './connection-source';
import {
  resolveConnectionDisplayState,
  normalizeInviteSubmitError,
  normalizeConnectionActionError,
  type ConnectionRecord,
  type ConnectionDisplayState,
  type InviteSubmitErrorReason,
  type ConnectionActionErrorReason,
} from './connection.logic';

// ─── State types ────────────────────────────────────────────────────────────

export type ConnectionsLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; connections: ConnectionRecord[]; displayStates: ConnectionDisplayState[] };

// ─── Hook ───────────────────────────────────────────────────────────────────

export type UseConnectionsResult = {
  state: ConnectionsLoadState;
  reload: () => void;
  submitCode: (code: string) => Promise<InviteSubmitErrorReason | null>;
  confirmConnection: (connectionId: string) => Promise<ConnectionActionErrorReason | null>;
  unbindConnection: (connectionId: string) => Promise<ConnectionActionErrorReason | null>;
};

/**
 * Wraps Data Connect connection-source operations for UI consumption.
 * Keeps Firebase / Data Connect concerns out of screen components.
 */
export function useConnections(user: User | null): UseConnectionsResult {
  const [state, setState] = useState<ConnectionsLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!user) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void getMyConnections(user)
      .then((connections) => {
        const displayStates = connections.map(resolveConnectionDisplayState);
        setState({ kind: 'ready', connections, displayStates });
      })
      .catch((err: ConnectionSourceError) => {
        setState({ kind: 'error', message: err.message });
      });
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const submitCode = useCallback(
    async (code: string): Promise<InviteSubmitErrorReason | null> => {
      if (!user) return 'configuration';

      try {
        await submitInviteCode(user, code);
        load();
        return null;
      } catch (err) {
        return normalizeInviteSubmitError(err);
      }
    },
    [user, load]
  );

  const confirmConnection = useCallback(
    async (connectionId: string): Promise<ConnectionActionErrorReason | null> => {
      if (!user) return 'configuration';

      try {
        await confirmPendingConnection(user, connectionId);
        load();
        return null;
      } catch (err) {
        return normalizeConnectionActionError(err);
      }
    },
    [user, load]
  );

  const unbindConnection = useCallback(
    async (connectionId: string): Promise<ConnectionActionErrorReason | null> => {
      if (!user) return 'configuration';

      try {
        await endConnection(user, connectionId);
        load();
        return null;
      } catch (err) {
        return normalizeConnectionActionError(err);
      }
    },
    [user, load]
  );

  return { state, reload: load, submitCode, confirmConnection, unbindConnection };
}

import { useCallback, useEffect, useState } from 'react';

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
  | {
      kind: 'ready';
      connections: ConnectionRecord[];
      displayStates: ConnectionDisplayState[];
      lastSyncedAtIso: string;
    };

// ─── Hook ───────────────────────────────────────────────────────────────────

export type UseConnectionsResult = {
  state: ConnectionsLoadState;
  reload: () => void;
  submitCode: (code: string) => Promise<InviteSubmitErrorReason | null>;
  confirmConnection: (connectionId: string) => Promise<ConnectionActionErrorReason | null>;
  unbindConnection: (connectionId: string) => Promise<ConnectionActionErrorReason | null>;
};

/**
 * Wraps server-backed connection-source operations for UI consumption.
 * Keeps persistence and auth transport concerns out of screen components.
 * Auth user is no longer passed; the source uses the active local server session.
 */
export function useConnections(isAuthenticated: boolean): UseConnectionsResult {
  const [state, setState] = useState<ConnectionsLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!isAuthenticated) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void getMyConnections()
      .then((connections) => {
        const displayStates = connections.map(resolveConnectionDisplayState);
        setState({
          kind: 'ready',
          connections,
          displayStates,
          lastSyncedAtIso: new Date().toISOString(),
        });
      })
      .catch((err: ConnectionSourceError) => {
        setState({ kind: 'error', message: err.message });
      });
  }, [isAuthenticated]);

  useEffect(() => {
    load();
  }, [load]);

  const submitCode = useCallback(
    async (code: string): Promise<InviteSubmitErrorReason | null> => {
      if (!isAuthenticated) return 'configuration';

      try {
        await submitInviteCode(code);
        load();
        return null;
      } catch (err) {
        return normalizeInviteSubmitError(err);
      }
    },
    [isAuthenticated, load]
  );

  const confirmConnection = useCallback(
    async (connectionId: string): Promise<ConnectionActionErrorReason | null> => {
      if (!isAuthenticated) return 'configuration';

      try {
        await confirmPendingConnection(connectionId);
        load();
        return null;
      } catch (err) {
        return normalizeConnectionActionError(err);
      }
    },
    [isAuthenticated, load]
  );

  const unbindConnection = useCallback(
    async (connectionId: string): Promise<ConnectionActionErrorReason | null> => {
      if (!isAuthenticated) return 'configuration';

      try {
        await endConnection(connectionId);
        load();
        return null;
      } catch (err) {
        return normalizeConnectionActionError(err);
      }
    },
    [isAuthenticated, load]
  );

  return { state, reload: load, submitCode, confirmConnection, unbindConnection };
}

import Constants from 'expo-constants';
import type { User } from 'firebase/auth';

import {
  normalizeConnectionStatus,
  normalizeCanceledReason,
  normalizeConnectionSpecialty,
  type ConnectionRecord,
} from './connection.logic';

type DataConnectExtraConfig = {
  graphqlEndpoint?: string;
  apiKey?: string;
};

type DataConnectGraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type ConnectionSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class ConnectionSourceError extends Error {
  code: ConnectionSourceErrorCode;

  constructor(code: ConnectionSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ConnectionSourceError';
  }
}

function resolveDataConnectConfig(): DataConnectExtraConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    dataConnect?: DataConnectExtraConfig;
  };

  return extra.dataConnect ?? {};
}

async function executeDataConnectGraphQL<T>(
  user: User,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { graphqlEndpoint, apiKey } = resolveDataConnectConfig();
  if (!graphqlEndpoint) {
    throw new ConnectionSourceError(
      'configuration',
      'Data Connect endpoint is not configured. Set EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT.'
    );
  }

  const idToken = await user.getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };

  if (apiKey) {
    headers['x-goog-api-key'] = apiKey;
  }

  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new ConnectionSourceError(
      'network',
      `Data Connect request failed with status ${response.status}.`
    );
  }

  const payload = (await response.json()) as DataConnectGraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new ConnectionSourceError(
      'graphql',
      payload.errors[0]?.message ?? 'Data Connect operation failed.'
    );
  }

  if (!payload.data) {
    throw new ConnectionSourceError(
      'invalid_response',
      'Data Connect operation returned no data payload.'
    );
  }

  return payload.data;
}

export async function submitInviteCode(
  user: User,
  code: string
): Promise<{ connectionId: string; status: 'pending_confirmation' }> {
  const mutation = `
    mutation SubmitInviteCode($code: String!) {
      submitInviteCode(code: $code) {
        id
        status
      }
    }
  `;

  const data = await executeDataConnectGraphQL<{
    submitInviteCode?: { id?: string | null; status?: string | null } | null;
  }>(user, mutation, { code });

  const id = data.submitInviteCode?.id;
  const status = data.submitInviteCode?.status;

  if (!id) {
    throw new ConnectionSourceError(
      'invalid_response',
      'submitInviteCode returned no connection id.'
    );
  }

  if (status !== 'pending_confirmation') {
    throw new ConnectionSourceError(
      'invalid_response',
      `submitInviteCode returned unexpected status: ${status}.`
    );
  }

  return { connectionId: id, status: 'pending_confirmation' };
}

export async function confirmPendingConnection(
  user: User,
  connectionId: string
): Promise<{ connectionId: string; status: 'active' }> {
  const mutation = `
    mutation ConfirmPendingConnection($connection_id: UUID!) {
      confirmPendingConnection(connection_id: $connection_id) {
        id
        status
      }
    }
  `;

  const data = await executeDataConnectGraphQL<{
    confirmPendingConnection?: { id?: string | null; status?: string | null } | null;
  }>(user, mutation, { connection_id: connectionId });

  const id = data.confirmPendingConnection?.id;
  const status = data.confirmPendingConnection?.status;

  if (!id) {
    throw new ConnectionSourceError(
      'invalid_response',
      'confirmPendingConnection returned no connection id.'
    );
  }

  if (status !== 'active') {
    throw new ConnectionSourceError(
      'invalid_response',
      `confirmPendingConnection returned unexpected status: ${status}.`
    );
  }

  return { connectionId: id, status: 'active' };
}

export async function endConnection(user: User, connectionId: string): Promise<void> {
  const mutation = `
    mutation EndConnection($connection_id: UUID!) {
      endConnection(connection_id: $connection_id) {
        id
        status
      }
    }
  `;

  await executeDataConnectGraphQL<{
    endConnection?: { id?: string | null; status?: string | null } | null;
  }>(user, mutation, { connection_id: connectionId });
}

export async function getMyConnections(user: User): Promise<ConnectionRecord[]> {
  const query = `
    query GetMyConnections {
      getMyConnections {
        id
        status
        canceled_reason
        specialty
        professional_auth_uid
      }
    }
  `;

  const data = await executeDataConnectGraphQL<{
    getMyConnections?: Array<{
      id?: string | null;
      status?: string | null;
      canceled_reason?: string | null;
      specialty?: string | null;
      professional_auth_uid?: string | null;
    }> | null;
  }>(user, query);

  const raw = data.getMyConnections ?? [];

  return raw.flatMap((item) => {
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
        canceledReason: normalizeCanceledReason(item.canceled_reason),
        specialty,
        professionalAuthUid: item.professional_auth_uid ?? '',
      } satisfies ConnectionRecord,
    ];
  });
}

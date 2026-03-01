import Constants from 'expo-constants';
import type { User } from 'firebase/auth';

import type { RoleIntent } from './role-selection.logic';

type DataConnectExtraConfig = {
  graphqlEndpoint?: string;
  apiKey?: string;
};

type AuthProfile = {
  lockedRole: RoleIntent | null;
};

type DataConnectGraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type ProfileSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class ProfileSourceError extends Error {
  code: ProfileSourceErrorCode;

  constructor(code: ProfileSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProfileSourceError';
  }
}

function normalizeLockedRole(value: unknown): RoleIntent | null {
  return value === 'student' || value === 'professional' ? value : null;
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
    throw new ProfileSourceError(
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
    throw new ProfileSourceError('network', `Data Connect request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as DataConnectGraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new ProfileSourceError('graphql', payload.errors[0]?.message ?? 'Data Connect operation failed.');
  }

  if (!payload.data) {
    throw new ProfileSourceError('invalid_response', 'Data Connect operation returned no data payload.');
  }

  return payload.data;
}

async function upsertRemoteProfile(user: User): Promise<void> {
  const mutation = `
    mutation UpsertUserProfile($input: UpsertUserProfileInput!) {
      upsertUserProfile(input: $input) {
        auth_uid
      }
    }
  `;

  const data = await executeDataConnectGraphQL<{
    upsertUserProfile?: { auth_uid?: string | null } | null;
  }>(user, mutation, {
    input: {
      auth_uid: user.uid,
      display_name: user.displayName ?? '',
      email_normalized: user.email?.toLowerCase() ?? '',
    },
  });

  if (!data.upsertUserProfile?.auth_uid) {
    throw new ProfileSourceError('invalid_response', 'Data Connect did not return upserted profile identity.');
  }
}

async function getRemoteLockedRole(user: User): Promise<RoleIntent | null> {
  const query = `
    query GetMyProfile {
      getMyProfile {
        locked_role
      }
    }
  `;

  const data = await executeDataConnectGraphQL<{
    getMyProfile?: { locked_role?: string | null } | null;
  }>(user, query);

  return normalizeLockedRole(data.getMyProfile?.locked_role);
}

async function setRemoteLockedRole(user: User, role: RoleIntent): Promise<RoleIntent | null> {
  const mutation = `
    mutation SetLockedRole($role: String!) {
      setLockedRole(role: $role) {
        locked_role
      }
    }
  `;

  const data = await executeDataConnectGraphQL<{
    setLockedRole?: { locked_role?: string | null } | null;
  }>(user, mutation, { role });

  return normalizeLockedRole(data.setLockedRole?.locked_role);
}

export async function hydrateProfileFromSource(user: User): Promise<AuthProfile> {
  await upsertRemoteProfile(user);
  return { lockedRole: await getRemoteLockedRole(user) };
}

export async function lockRoleInSource(user: User, role: RoleIntent): Promise<AuthProfile> {
  const remoteRole = await setRemoteLockedRole(user, role);
  if (!remoteRole) {
    throw new ProfileSourceError(
      'invalid_response',
      'Data Connect did not return a locked role after setLockedRole.'
    );
  }

  return { lockedRole: remoteRole };
}

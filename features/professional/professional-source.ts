/**
 * Professional Data Connect source — invite code and specialty operations.
 * All calls use Firebase Auth ID token in Authorization header.
 * No business logic; all normalization delegates to logic modules.
 * Refs: FR-103, FR-174–FR-177, FR-179, FR-180, BR-234–BR-242
 */

import Constants from 'expo-constants';
import type { User } from 'firebase/auth';

import {
  normalizeInviteCodeStatus,
  type InviteCode,
} from './connection-invite.logic';
import {
  normalizeSpecialty,
  type Specialty,
  type SpecialtyRecord,
  type Credential,
} from './specialty.logic';

// ─── Transport helpers (shared with connection-source pattern) ─────────────────

type DataConnectExtraConfig = {
  graphqlEndpoint?: string;
  apiKey?: string;
};

type DataConnectGraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type ProfessionalSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'graphql'
  | 'invalid_response';

export class ProfessionalSourceError extends Error {
  code: ProfessionalSourceErrorCode;

  constructor(code: ProfessionalSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProfessionalSourceError';
  }
}

function resolveConfig(): DataConnectExtraConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    dataConnect?: DataConnectExtraConfig;
  };
  return extra.dataConnect ?? {};
}

async function gql<T>(
  user: User,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { graphqlEndpoint, apiKey } = resolveConfig();
  if (!graphqlEndpoint) {
    throw new ProfessionalSourceError(
      'configuration',
      'Data Connect endpoint is not configured. Set EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT.'
    );
  }

  const idToken = await user.getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
  if (apiKey) headers['x-goog-api-key'] = apiKey;

  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new ProfessionalSourceError(
      'network',
      `Data Connect request failed with status ${response.status}.`
    );
  }

  const payload = (await response.json()) as DataConnectGraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new ProfessionalSourceError(
      'graphql',
      payload.errors[0]?.message ?? 'Data Connect operation failed.'
    );
  }

  if (!payload.data) {
    throw new ProfessionalSourceError(
      'invalid_response',
      'Data Connect operation returned no data payload.'
    );
  }

  return payload.data;
}

// ─── Invite code operations ───────────────────────────────────────────────────

/**
 * Fetches the professional's current active invite code, or creates one if
 * none exists (idempotent). Returns null if the server returns no code.
 * Ref: FR-179, D-037
 */
export async function getOrCreateActiveInviteCode(user: User): Promise<InviteCode | null> {
  const query = `
    query GetOrCreateActiveInviteCode {
      getOrCreateActiveInviteCode {
        id
        code_value
        status
        rotated_at
        expires_at
        created_at
      }
    }
  `;

  const data = await gql<{
    getOrCreateActiveInviteCode?: {
      id?: string | null;
      code_value?: string | null;
      status?: string | null;
      rotated_at?: string | null;
      expires_at?: string | null;
      created_at?: string | null;
    } | null;
  }>(user, query);

  const raw = data.getOrCreateActiveInviteCode;
  if (!raw?.id || !raw.code_value || !raw.created_at) return null;

  const status = normalizeInviteCodeStatus(raw.status);
  if (!status) return null;

  return {
    id: raw.id,
    codeValue: raw.code_value,
    status,
    rotatedAt: raw.rotated_at ?? null,
    expiresAt: raw.expires_at ?? null,
    createdAt: raw.created_at,
  };
}

/**
 * Rotates the professional's active invite code.
 * Auto-cancels pending requests created from the old code (D-064, D-037).
 * Returns the new active invite code.
 */
export async function rotateInviteCode(user: User): Promise<InviteCode> {
  const mutation = `
    mutation RotateInviteCode {
      rotateInviteCode {
        id
        code_value
        status
        rotated_at
        expires_at
        created_at
      }
    }
  `;

  const data = await gql<{
    rotateInviteCode?: {
      id?: string | null;
      code_value?: string | null;
      status?: string | null;
      rotated_at?: string | null;
      expires_at?: string | null;
      created_at?: string | null;
    } | null;
  }>(user, mutation);

  const raw = data.rotateInviteCode;
  if (!raw?.id || !raw.code_value || !raw.created_at) {
    throw new ProfessionalSourceError('invalid_response', 'rotateInviteCode returned no code.');
  }

  const status = normalizeInviteCodeStatus(raw.status);
  if (!status) {
    throw new ProfessionalSourceError(
      'invalid_response',
      `rotateInviteCode returned unrecognized status: ${raw.status}.`
    );
  }

  return {
    id: raw.id,
    codeValue: raw.code_value,
    status,
    rotatedAt: raw.rotated_at ?? null,
    expiresAt: raw.expires_at ?? null,
    createdAt: raw.created_at,
  };
}

// ─── Specialty operations ─────────────────────────────────────────────────────

/**
 * Returns all professional specialties (active and inactive) for the current user.
 * Ref: FR-103, FR-174
 */
export async function getProfessionalSpecialties(user: User): Promise<SpecialtyRecord[]> {
  const query = `
    query GetProfessionalSpecialties {
      getProfessionalSpecialties {
        id
        specialty
        is_active
        credential {
          id
          specialty
          credential_type
          registry_id
          authority
          country
        }
      }
    }
  `;

  const data = await gql<{
    getProfessionalSpecialties?: Array<{
      id?: string | null;
      specialty?: string | null;
      is_active?: boolean | null;
      credential?: {
        id?: string | null;
        specialty?: string | null;
        credential_type?: string | null;
        registry_id?: string | null;
        authority?: string | null;
        country?: string | null;
      } | null;
    }> | null;
  }>(user, query);

  const raw = data.getProfessionalSpecialties ?? [];

  return raw.flatMap((item) => {
    const id = item.id;
    const specialty = normalizeSpecialty(item.specialty);
    if (!id || !specialty) return [];

    let credential: Credential | null = null;
    if (item.credential?.id && item.credential.registry_id) {
      const credSpecialty = normalizeSpecialty(item.credential.specialty);
      if (credSpecialty) {
        credential = {
          id: item.credential.id,
          specialty: credSpecialty,
          credentialType: 'professional_registry',
          registryId: item.credential.registry_id,
          authority: item.credential.authority ?? '',
          country: item.credential.country ?? '',
        };
      }
    }

    return [{ id, specialty, isActive: item.is_active ?? false, credential }];
  });
}

/**
 * Adds a new specialty for the professional.
 * Server blocks duplicates.
 * Ref: FR-175, D-034
 */
export async function addProfessionalSpecialty(
  user: User,
  specialty: Specialty
): Promise<{ id: string; specialty: Specialty }> {
  const mutation = `
    mutation AddProfessionalSpecialty($specialty: String!) {
      addProfessionalSpecialty(specialty: $specialty) {
        id
        specialty
      }
    }
  `;

  const data = await gql<{
    addProfessionalSpecialty?: { id?: string | null; specialty?: string | null } | null;
  }>(user, mutation, { specialty });

  const id = data.addProfessionalSpecialty?.id;
  const returnedSpecialty = normalizeSpecialty(data.addProfessionalSpecialty?.specialty);

  if (!id || !returnedSpecialty) {
    throw new ProfessionalSourceError(
      'invalid_response',
      'addProfessionalSpecialty returned no specialty record.'
    );
  }

  return { id, specialty: returnedSpecialty };
}

/**
 * Removes a specialty.
 * Server enforces removal guard (active/pending students, last specialty).
 * Ref: FR-176, D-034, D-062, BR-234
 */
export async function removeProfessionalSpecialty(
  user: User,
  specialty: Specialty
): Promise<void> {
  const mutation = `
    mutation RemoveProfessionalSpecialty($specialty: String!) {
      removeProfessionalSpecialty(specialty: $specialty) {
        id
      }
    }
  `;

  await gql<{
    removeProfessionalSpecialty?: { id?: string | null } | null;
  }>(user, mutation, { specialty });
}

/**
 * Upserts credential for a specialty (max 1 per specialty in MVP, D-035).
 * Ref: FR-177
 */
export async function upsertProfessionalCredential(
  user: User,
  specialty: Specialty,
  input: { registryId: string; authority: string; country: string }
): Promise<{ id: string }> {
  const mutation = `
    mutation UpsertProfessionalCredential(
      $specialty: String!
      $registry_id: String!
      $authority: String!
      $country: String!
    ) {
      upsertProfessionalCredential(
        specialty: $specialty
        registry_id: $registry_id
        authority: $authority
        country: $country
      ) {
        id
      }
    }
  `;

  const data = await gql<{
    upsertProfessionalCredential?: { id?: string | null } | null;
  }>(user, mutation, {
    specialty,
    registry_id: input.registryId,
    authority: input.authority,
    country: input.country,
  });

  const id = data.upsertProfessionalCredential?.id;
  if (!id) {
    throw new ProfessionalSourceError(
      'invalid_response',
      'upsertProfessionalCredential returned no id.'
    );
  }

  return { id };
}

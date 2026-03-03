/**
 * Professional Data Connect source — invite code and specialty operations.
 * Uses Firebase Data Connect generated SDK (D-114 injectable deps pattern).
 * No business logic; all normalization delegates to logic modules.
 * Refs: FR-103, FR-174–FR-177, FR-179, FR-180, BR-234–BR-242
 */

import type { DataConnect } from 'firebase/data-connect';

import { getDataConnectInstance as _getDataConnectInstance } from '../dataconnect';
import {
  getOrCreateActiveInviteCode as _getOrCreateActiveInviteCode,
  rotateInviteCode as _rotateInviteCode,
  getProfessionalSpecialties as _getProfessionalSpecialties,
  addProfessionalSpecialty as _addProfessionalSpecialty,
  removeProfessionalSpecialty as _removeProfessionalSpecialty,
  upsertProfessionalCredential as _upsertProfessionalCredential,
  type GetOrCreateActiveInviteCodeData,
  type RotateInviteCodeData,
  type GetProfessionalSpecialtiesData,
  type AddProfessionalSpecialtyData,
  type AddProfessionalSpecialtyVariables,
  type RemoveProfessionalSpecialtyData,
  type RemoveProfessionalSpecialtyVariables,
  type UpsertProfessionalCredentialData,
  type UpsertProfessionalCredentialVariables,
} from '@mychampions/dataconnect-generated';

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

// ─── Error class ──────────────────────────────────────────────────────────────

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

// ─── Injectable deps (D-114 pattern) ─────────────────────────────────────────

export type ProfessionalSourceDeps = {
  getOrCreateActiveInviteCode: (dc: DataConnect) => Promise<{ data: GetOrCreateActiveInviteCodeData }>;
  rotateInviteCode: (dc: DataConnect) => Promise<{ data: RotateInviteCodeData }>;
  getProfessionalSpecialties: (dc: DataConnect) => Promise<{ data: GetProfessionalSpecialtiesData }>;
  addProfessionalSpecialty: (
    dc: DataConnect,
    vars: AddProfessionalSpecialtyVariables
  ) => Promise<{ data: AddProfessionalSpecialtyData }>;
  removeProfessionalSpecialty: (
    dc: DataConnect,
    vars: RemoveProfessionalSpecialtyVariables
  ) => Promise<{ data: RemoveProfessionalSpecialtyData }>;
  upsertProfessionalCredential: (
    dc: DataConnect,
    vars: UpsertProfessionalCredentialVariables
  ) => Promise<{ data: UpsertProfessionalCredentialData }>;
  getDataConnectInstance: () => DataConnect;
};

const defaultDeps: ProfessionalSourceDeps = {
  getOrCreateActiveInviteCode: _getOrCreateActiveInviteCode,
  rotateInviteCode: _rotateInviteCode,
  getProfessionalSpecialties: _getProfessionalSpecialties,
  addProfessionalSpecialty: _addProfessionalSpecialty,
  removeProfessionalSpecialty: _removeProfessionalSpecialty,
  upsertProfessionalCredential: _upsertProfessionalCredential,
  getDataConnectInstance: _getDataConnectInstance,
};

// ─── Invite code operations ───────────────────────────────────────────────────

/**
 * Fetches the professional's current active invite code, or creates one if
 * none exists (idempotent). Returns null if the server returns no code.
 * Ref: FR-179, D-037
 *
 * SDK note: returns inviteCodes[] array — use [0].
 */
export async function getOrCreateActiveInviteCode(
  deps = defaultDeps
): Promise<InviteCode | null> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getOrCreateActiveInviteCode(dc);

  const raw = data.inviteCodes[0];
  if (!raw?.id || !raw.codeValue || !raw.createdAt) return null;

  const status = normalizeInviteCodeStatus(raw.status);
  if (!status) return null;

  return {
    id: raw.id,
    codeValue: raw.codeValue,
    status,
    rotatedAt: raw.rotatedAt ?? null,
    expiresAt: raw.expiresAt ?? null,
    createdAt: raw.createdAt,
  };
}

/**
 * Rotates the professional's active invite code.
 * Auto-cancels pending requests created from the old code (D-064, D-037).
 * Returns the new active invite code.
 *
 * SDK note: rotateInviteCode returns just InviteCode_Key (id only).
 * Must re-fetch getOrCreateActiveInviteCode to get full code data.
 */
export async function rotateInviteCode(deps = defaultDeps): Promise<InviteCode> {
  const dc = deps.getDataConnectInstance();
  await deps.rotateInviteCode(dc);

  // Re-fetch to get full code data (SDK only returns the key)
  const code = await getOrCreateActiveInviteCode(deps);
  if (!code) {
    throw new ProfessionalSourceError(
      'invalid_response',
      'rotateInviteCode succeeded but subsequent fetch returned no code.'
    );
  }
  return code;
}

// ─── Specialty operations ─────────────────────────────────────────────────────

/**
 * Returns all professional specialties (active and inactive) for the current user.
 * Ref: FR-103, FR-174
 *
 * SDK note: returns specialties[] with camelCase fields; credential is an array.
 */
export async function getProfessionalSpecialties(deps = defaultDeps): Promise<SpecialtyRecord[]> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getProfessionalSpecialties(dc);

  return (data.specialties ?? []).flatMap((item) => {
    const id = item.id;
    const specialty = normalizeSpecialty(item.specialty);
    if (!id || !specialty) return [];

    // credential is an array in SDK — take first entry
    let credential: Credential | null = null;
    const credRaw = item.credential?.[0];
    if (credRaw?.id && credRaw.registryId) {
      credential = {
        id: credRaw.id,
        specialty,
        credentialType: 'professional_registry',
        registryId: credRaw.registryId,
        authority: credRaw.authority ?? '',
        country: credRaw.country ?? '',
      };
    }

    return [{ id, specialty, isActive: item.isActive ?? false, credential }];
  });
}

/**
 * Adds a new specialty for the professional.
 * Server blocks duplicates.
 * Ref: FR-175, D-034
 *
 * SDK note: addProfessionalSpecialty returns Specialty_Key (id only).
 * Returns {id, specialty} using the caller-supplied specialty value.
 */
export async function addProfessionalSpecialty(
  specialty: Specialty,
  deps = defaultDeps
): Promise<{ id: string; specialty: Specialty }> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.addProfessionalSpecialty(dc, { specialty });

  const id = data.specialty_insert?.id;
  if (!id) {
    throw new ProfessionalSourceError(
      'invalid_response',
      'addProfessionalSpecialty returned no specialty id.'
    );
  }

  return { id, specialty };
}

/**
 * Removes a specialty by its record id.
 * Server enforces removal guard (active/pending students, last specialty).
 * Ref: FR-176, D-034, D-062, BR-234
 *
 * SDK note: removeProfessionalSpecialty takes specialty_id: UUIDString (record id),
 * NOT the specialty string enum. Breaking change from old GraphQL stub.
 */
export async function removeProfessionalSpecialty(
  specialtyId: string,
  deps = defaultDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.removeProfessionalSpecialty(dc, { specialty_id: specialtyId });
}

/**
 * Upserts credential for a specialty (max 1 per specialty in MVP, D-035).
 * Ref: FR-177
 *
 * SDK note: upsertProfessionalCredential takes specialty_id: UUIDString (record id),
 * NOT the specialty string enum. Breaking change from old GraphQL stub.
 */
export async function upsertProfessionalCredential(
  specialtyId: string,
  input: { registryId: string; authority: string; country: string },
  deps = defaultDeps
): Promise<{ id: string }> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.upsertProfessionalCredential(dc, {
    specialty_id: specialtyId,
    registry_id: input.registryId,
    authority: input.authority,
    country: input.country,
  });

  const id = data.credential_upsert?.id;
  if (!id) {
    throw new ProfessionalSourceError(
      'invalid_response',
      'upsertProfessionalCredential returned no credential id.'
    );
  }

  return { id };
}

/**
 * Professional specialty logic — add/remove/credential management.
 * Pure functions, no Firebase dependencies.
 * Refs: D-034, D-035, D-036, D-062, FR-103, FR-174, FR-175, FR-176, FR-177, FR-216
 * BR-234, BR-235, BR-236, BR-237
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type Specialty = 'nutritionist' | 'fitness_coach';

export type CredentialType = 'professional_registry';

export type Credential = {
  id: string;
  specialty: Specialty;
  credentialType: CredentialType;
  registryId: string;
  authority: string;
  country: string;
};

export type SpecialtyRecord = {
  id: string;
  specialty: Specialty;
  isActive: boolean;
  credential: Credential | null;
};

export type SpecialtyRemovalBlockReason = 'has_active_students' | 'has_pending_students' | 'last_specialty';

export type SpecialtyRemovalResult =
  | { allowed: true }
  | { allowed: false; reason: SpecialtyRemovalBlockReason };

export type SpecialtyActionErrorReason =
  | 'already_exists'
  | 'removal_blocked'
  | 'last_specialty'
  | 'network'
  | 'configuration'
  | 'unknown';

export type CredentialInput = {
  registryId: string;
  authority: string;
  country: string;
};

export type CredentialValidationErrors = {
  registryId?: 'required';
  authority?: 'required';
  country?: 'required';
};

// ─── Pure functions ───────────────────────────────────────────────────────────

export function normalizeSpecialty(raw: unknown): Specialty | null {
  if (raw === 'nutritionist' || raw === 'fitness_coach') return raw;
  return null;
}

/**
 * Determines if a specialty can be removed.
 * Block reasons (BR-234, D-062):
 * 1. Active students exist for the specialty.
 * 2. Pending students exist for the specialty.
 * 3. It's the only remaining specialty.
 */
export function checkSpecialtyRemoval(input: {
  specialtyToRemove: Specialty;
  activeStudentCountForSpecialty: number;
  pendingStudentCountForSpecialty: number;
  totalActiveSpecialtyCount: number;
}): SpecialtyRemovalResult {
  if (input.totalActiveSpecialtyCount <= 1) {
    return { allowed: false, reason: 'last_specialty' };
  }
  if (input.activeStudentCountForSpecialty > 0) {
    return { allowed: false, reason: 'has_active_students' };
  }
  if (input.pendingStudentCountForSpecialty > 0) {
    return { allowed: false, reason: 'has_pending_students' };
  }
  return { allowed: true };
}

export function validateCredentialInput(input: CredentialInput): CredentialValidationErrors {
  const errors: CredentialValidationErrors = {};
  if (!input.registryId.trim()) errors.registryId = 'required';
  if (!input.authority.trim()) errors.authority = 'required';
  if (!input.country.trim()) errors.country = 'required';
  return errors;
}

export function normalizeSpecialtyActionError(error: unknown): SpecialtyActionErrorReason {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : null;
    const msg = 'message' in error ? String((error as { message: unknown }).message).toLowerCase() : null;

    if (code === 'ALREADY_EXISTS' || msg?.includes('already exists')) return 'already_exists';
    if (code === 'REMOVAL_BLOCKED' || msg?.includes('removal blocked')) return 'removal_blocked';
    if (code === 'LAST_SPECIALTY' || msg?.includes('last specialty')) return 'last_specialty';
    if (code === 'NETWORK_ERROR' || msg?.includes('network')) return 'network';
    if (msg?.includes('endpoint') || msg?.includes('config')) return 'configuration';
  }
  return 'unknown';
}

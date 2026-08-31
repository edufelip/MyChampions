/**
 * Professional specialty logic — add/remove/credential management.
 * Pure functions, no provider dependencies.
 * Refs: D-034, D-035, D-036, D-062, FR-103, FR-174, FR-175, FR-176, FR-177, FR-216
 * BR-234, BR-235, BR-236, BR-237
 */

import type { RoleIntent } from '../auth/role-selection.logic';

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

export type SpecialtyRemovalBlockReason =
  'has_active_students' | 'has_pending_students' | 'last_specialty';

export type SpecialtyRemovalResult =
  { allowed: true } | { allowed: false; reason: SpecialtyRemovalBlockReason };

export type SpecialtyActionErrorReason =
  'already_exists' | 'removal_blocked' | 'last_specialty' | 'network' | 'configuration' | 'unknown';

export type NutritionSurfaceAccessInput = {
  role: RoleIntent | null;
  specialties: SpecialtyRecord[];
};

export type NutritionSurfaceGateStatus = 'idle' | 'loading' | 'ready' | 'error';

export type NutritionSurfaceGateDecision = 'allow' | 'loading' | 'redirect';

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

export type OptionalCredentialInputDecision = {
  shouldSave: boolean;
  errors: CredentialValidationErrors;
};

// ─── Pure functions ───────────────────────────────────────────────────────────

export function normalizeSpecialty(raw: unknown): Specialty | null {
  if (raw === 'nutritionist' || raw === 'fitness_coach') return raw;
  return null;
}

export function canAccessNutritionSurface(input: NutritionSurfaceAccessInput): boolean {
  if (input.role === 'student') return true;
  if (input.role !== 'professional') return false;

  return input.specialties.some((record) => record.specialty === 'nutritionist' && record.isActive);
}

export function resolveNutritionSurfaceGate(
  input: NutritionSurfaceAccessInput & { specialtiesStatus: NutritionSurfaceGateStatus },
): NutritionSurfaceGateDecision {
  if (
    input.role === 'professional' &&
    (input.specialtiesStatus === 'idle' || input.specialtiesStatus === 'loading')
  ) {
    return 'loading';
  }

  return canAccessNutritionSurface(input) ? 'allow' : 'redirect';
}

export function resolveProfessionalNutritionRouteGate(
  input: NutritionSurfaceAccessInput & { specialtiesStatus: NutritionSurfaceGateStatus },
): NutritionSurfaceGateDecision {
  if (input.role !== 'professional') return 'redirect';
  if (input.specialtiesStatus === 'idle' || input.specialtiesStatus === 'loading') return 'loading';

  return input.specialties.some((record) => record.specialty === 'nutritionist' && record.isActive)
    ? 'allow'
    : 'redirect';
}

/**
 * The nutrition plan builder screen (app/professional/nutrition/plans/[planId].tsx)
 * is mounted for both /student/nutrition/plans/:planId and
 * /professional/nutrition/plans/:planId — the Student route re-exports the
 * same component. Only the professional route needs
 * resolveProfessionalNutritionRouteGate's protection (redirect non-
 * professionals, and professionals without an active nutritionist
 * specialty, off the professional-only surface).
 *
 * usePathname() can transiently report neither prefix (e.g. '/') while
 * expo-router is still settling a deep link or an in-flight navigation —
 * the same flicker PR #45 fixed for the plan builder store's reset/init
 * ordering. That fix didn't cover this gate: naively treating an unsettled
 * pathname as "not the Student route" flips the professional gate on, and
 * since a Student's locked role isn't 'professional',
 * resolveProfessionalNutritionRouteGate immediately returns 'redirect' —
 * firing a real navigation away from the Student's own plan mid-edit. Stay
 * in 'loading' until the pathname settles to one of the two known
 * prefixes instead of guessing.
 */
export function resolveNutritionBuilderRouteGate(
  input: NutritionSurfaceAccessInput & {
    specialtiesStatus: NutritionSurfaceGateStatus;
    pathname: string;
  },
): NutritionSurfaceGateDecision {
  const isStudentBuilder = input.pathname.startsWith('/student/');
  const isProfessionalBuilder = input.pathname.startsWith('/professional/');
  if (!isStudentBuilder && !isProfessionalBuilder) return 'loading';
  if (isStudentBuilder) return 'allow';

  return resolveProfessionalNutritionRouteGate(input);
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

export function resolveOptionalCredentialInput(
  input: CredentialInput,
): OptionalCredentialInputDecision {
  const hasAnyCredentialField =
    Boolean(input.registryId.trim()) ||
    Boolean(input.authority.trim()) ||
    Boolean(input.country.trim());

  if (!hasAnyCredentialField) {
    return { shouldSave: false, errors: {} };
  }

  const errors = validateCredentialInput(input);
  return {
    shouldSave: Object.keys(errors).length === 0,
    errors,
  };
}

export function normalizeSpecialtyActionError(error: unknown): SpecialtyActionErrorReason {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : null;
    const msg =
      'message' in error ? String((error as { message: unknown }).message).toLowerCase() : null;

    if (code === 'ALREADY_EXISTS' || msg?.includes('already exists')) return 'already_exists';
    if (code === 'REMOVAL_BLOCKED' || msg?.includes('removal blocked')) return 'removal_blocked';
    if (code === 'LAST_SPECIALTY' || msg?.includes('last specialty')) return 'last_specialty';
    if (code === 'NETWORK_ERROR' || msg?.includes('network')) return 'network';
    // ProfessionalSourceError sets its own `code` to the lowercase literal
    // 'configuration' (features/professional/professional-source.ts), and its
    // message reads "<operation> requires local server auth." — an internal,
    // developer-facing string that must never reach the UI verbatim (ET-160).
    if (
      code === 'configuration' ||
      msg?.includes('requires local server auth') ||
      msg?.includes('endpoint') ||
      msg?.includes('config')
    )
      return 'configuration';
  }
  return 'unknown';
}

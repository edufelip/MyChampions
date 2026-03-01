/**
 * Plan change request logic — student-originated advisory requests on assigned plans.
 * Pure functions, no Firebase dependencies.
 * Refs: D-071, FR-211, BR-269, AC-255, TC-259
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PlanChangeRequestStatus = 'pending' | 'reviewed' | 'dismissed';

export type PlanType = 'nutrition' | 'training';

export type PlanChangeRequest = {
  id: string;
  planId: string;
  planType: PlanType;
  studentUid: string;
  requestText: string;
  status: PlanChangeRequestStatus;
  createdAt: string;
};

export type PlanChangeRequestInput = {
  requestText: string;
};

export type PlanChangeRequestValidationErrors = {
  requestText?: 'required' | 'too_short';
};

export type PlanChangeRequestErrorReason =
  | 'plan_not_found'
  | 'no_active_assignment'
  | 'validation'
  | 'network'
  | 'configuration'
  | 'unknown';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum character length for a meaningful change request */
const MIN_REQUEST_TEXT_LENGTH = 10;

// ─── Validation ───────────────────────────────────────────────────────────────

export function validatePlanChangeRequestInput(
  input: PlanChangeRequestInput
): PlanChangeRequestValidationErrors {
  const errors: PlanChangeRequestValidationErrors = {};
  if (!input.requestText.trim()) {
    errors.requestText = 'required';
  } else if (input.requestText.trim().length < MIN_REQUEST_TEXT_LENGTH) {
    errors.requestText = 'too_short';
  }
  return errors;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export function normalizePlanChangeRequestStatus(raw: unknown): PlanChangeRequestStatus | null {
  if (raw === 'pending' || raw === 'reviewed' || raw === 'dismissed') return raw;
  return null;
}

export function normalizePlanType(raw: unknown): PlanType | null {
  if (raw === 'nutrition' || raw === 'training') return raw;
  return null;
}

// ─── Error normalization ──────────────────────────────────────────────────────

export function normalizePlanChangeRequestError(error: unknown): PlanChangeRequestErrorReason {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : null;
    const msg = 'message' in error ? String((error as { message: unknown }).message).toLowerCase() : null;

    if (code === 'PLAN_NOT_FOUND' || msg?.includes('plan not found')) return 'plan_not_found';
    if (code === 'NO_ACTIVE_ASSIGNMENT' || msg?.includes('no active assignment')) return 'no_active_assignment';
    if (code === 'VALIDATION' || msg?.includes('validation')) return 'validation';
    if (code === 'NETWORK_ERROR' || msg?.includes('network')) return 'network';
    if (msg?.includes('endpoint') || msg?.includes('config')) return 'configuration';
  }
  return 'unknown';
}

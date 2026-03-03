/**
 * Subscription and entitlement logic — professional cap enforcement and AI paywall.
 * Pure functions, no Firebase/RevenueCat dependencies.
 * Refs: D-009–D-011, D-024, D-043, D-075, D-132
 * FR-126–FR-129, FR-156, FR-185, FR-215
 * BR-218–BR-221, BR-228, BR-247, BR-273
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type EntitlementStatus = 'active' | 'lapsed' | 'unknown';

export type SubscriptionState = {
  entitlementStatus: EntitlementStatus;
  activeStudentCount: number;
  isPreLapseWarningVisible: boolean;
  /** True when lapsed and activeStudentCount > FREE_STUDENT_CAP */
  isAboveCapLocked: boolean;
};

export type CapEnforcementResult =
  | { allowed: true }
  | { allowed: false; reason: 'requires_entitlement' | 'lapsed_above_cap' };

// ─── Constants ───────────────────────────────────────────────────────────────

/** Free tier student cap (D-010, BR-219) */
export const FREE_STUDENT_CAP = 10;

/**
 * RevenueCat entitlement identifier for the student AI features subscription.
 * Grants access to AI meal photo analysis (BL-108) and future AI-powered features.
 * D-132: separate from professional_unlimited; purchasable by any role.
 */
export const AI_ENTITLEMENT_ID = 'premium_student';

// ─── Cap enforcement ──────────────────────────────────────────────────────────

/**
 * Checks whether adding one more active student is allowed.
 * Students are never charged (D-009). Cap applies to professionals.
 * Refs: D-010, D-043, BR-219, BR-220, BR-247
 */
export function checkStudentCapEnforcement(input: {
  activeStudentCount: number;
  entitlementStatus: EntitlementStatus;
}): CapEnforcementResult {
  const { activeStudentCount, entitlementStatus } = input;

  if (activeStudentCount < FREE_STUDENT_CAP) {
    return { allowed: true };
  }

  // At or over cap — requires active entitlement
  if (entitlementStatus === 'active') {
    return { allowed: true };
  }

  if (entitlementStatus === 'lapsed') {
    return { allowed: false, reason: 'lapsed_above_cap' };
  }

  // Status unknown — optimistic allow (do not block on unknown)
  return { allowed: true };
}

/**
 * Resolves the full subscription state for display.
 * Pre-lapse warning visible when above a threshold but not yet lapsed.
 */
export function resolveSubscriptionState(input: {
  activeStudentCount: number;
  entitlementStatus: EntitlementStatus;
  preLapseThreshold?: number;
}): SubscriptionState {
  const threshold = input.preLapseThreshold ?? FREE_STUDENT_CAP;
  const isAboveCapLocked =
    input.entitlementStatus === 'lapsed' && input.activeStudentCount > FREE_STUDENT_CAP;
  const isPreLapseWarningVisible =
    input.entitlementStatus === 'active' && input.activeStudentCount >= threshold;

  return {
    entitlementStatus: input.entitlementStatus,
    activeStudentCount: input.activeStudentCount,
    isPreLapseWarningVisible,
    isAboveCapLocked,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function normalizeEntitlementStatus(raw: unknown): EntitlementStatus {
  if (raw === 'active' || raw === 'lapsed') return raw;
  return 'unknown';
}

/**
 * Whether write actions for student plans are currently locked.
 * Lapsed + over cap blocks new activations and plan updates (D-043, BR-247).
 */
export function isPlanUpdateLocked(state: SubscriptionState): boolean {
  return state.isAboveCapLocked;
}

// ─── AI feature access ────────────────────────────────────────────────────────

/**
 * Returns true when the user has access to AI meal photo analysis (BL-108, D-132).
 *
 * Access is granted when EITHER:
 *   - professionalStatus === 'active'  (professional_unlimited entitlement)
 *   - studentAiStatus   === 'active'   (premium_student entitlement)
 *
 * 'unknown' is treated as locked (strict policy, D-132).
 * Only an explicitly 'active' entitlement on either channel unlocks the feature.
 *
 * @param professionalStatus - EntitlementStatus from professional_unlimited entitlement.
 * @param studentAiStatus    - EntitlementStatus from premium_student entitlement.
 */
export function hasAiAnalysisAccess(
  professionalStatus: EntitlementStatus,
  studentAiStatus: EntitlementStatus,
): boolean {
  return professionalStatus === 'active' || studentAiStatus === 'active';
}

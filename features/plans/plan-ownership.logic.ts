export type PlanOwnershipSnapshot = {
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  ownerProfessionalUid: string | null;
  studentUid: string;
};

export function isSelfGuidedPlan(
  plan: PlanOwnershipSnapshot,
  currentUserUid: string | null | undefined,
): boolean {
  if (!currentUserUid) return false;
  return plan.sourceKind === 'self_managed';
}

/**
 * D-006: a Student may never edit a professionally assigned (or otherwise
 * non-self-managed) plan — the owning Professional is the only writer while
 * the connection is active. This is intentionally fail-closed: any
 * `sourceKind` other than `self_managed`, viewed through a Student route,
 * renders read-only. Only the Student's own self-managed plan (and a brand
 * new draft) stays editable on the Student surface. Professional routes are
 * never affected by this check (`isStudentSurface` is derived from the
 * route/pathname, not from the plan).
 *
 * See ET-107 (assigned student plan routes exposed editable professional
 * builders).
 */
export function isReadOnlyForStudentSurface(
  plan: Pick<PlanOwnershipSnapshot, 'sourceKind'>,
  isStudentSurface: boolean,
): boolean {
  if (!isStudentSurface) return false;
  return plan.sourceKind !== 'self_managed';
}

export type PlanOwnershipSnapshot = {
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  ownerProfessionalUid: string | null;
  studentUid: string;
};

export function isSelfGuidedPlan(
  plan: PlanOwnershipSnapshot,
  currentUserUid: string | null | undefined
): boolean {
  if (!currentUserUid) return false;
  if (plan.sourceKind === 'self_managed') return true;
  return (
    plan.sourceKind === 'predefined' &&
    plan.ownerProfessionalUid === currentUserUid &&
    plan.studentUid === currentUserUid
  );
}

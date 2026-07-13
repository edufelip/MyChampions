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
  return plan.sourceKind === 'self_managed';
}

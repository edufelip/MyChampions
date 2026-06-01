import { isSelfGuidedPlan } from './plan-ownership.logic';
import type { Plan } from './plan-source';

export type StudentNutritionState =
  | { kind: 'assigned'; assignedPlan: Plan }
  | { kind: 'waiting' }
  | { kind: 'self_managed'; selfManagedPlan: Plan }
  | { kind: 'empty' };

export function resolveStudentNutritionState({
  currentUserUid,
  hasActiveNutritionistConnection,
  plans,
}: {
  currentUserUid: string | null;
  hasActiveNutritionistConnection: boolean;
  plans: Plan[];
}): StudentNutritionState {
  const nutritionPlans = plans.filter((plan) => plan.planType === 'nutrition' && !plan.isArchived);
  const assignedPlan = nutritionPlans.find((plan) => plan.sourceKind === 'assigned' && !plan.isDraft) ?? null;

  if (assignedPlan) {
    return { kind: 'assigned', assignedPlan };
  }

  if (hasActiveNutritionistConnection) {
    return { kind: 'waiting' };
  }

  const selfManagedPlan = nutritionPlans.find((plan) => isSelfGuidedPlan(plan, currentUserUid)) ?? null;
  if (selfManagedPlan) {
    return { kind: 'self_managed', selfManagedPlan };
  }

  return { kind: 'empty' };
}

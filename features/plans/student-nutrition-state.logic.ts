import { isSelfGuidedPlan } from './plan-ownership.logic';
import type { Plan } from './plan-source';

export type StudentNutritionState =
  | { kind: 'assigned'; assignedPlan: Plan }
  | { kind: 'waiting' }
  | { kind: 'self_managed'; selfManagedPlan: Plan }
  | { kind: 'empty' };

export type StudentNutritionDisplayState = 'loading' | 'load_error' | 'content';

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

export function resolveStudentNutritionDisplayState({
  hasCurrentUser,
  plansKind,
  connectionsKind,
  nutritionKind,
}: {
  hasCurrentUser: boolean;
  plansKind: 'idle' | 'loading' | 'ready' | 'error';
  connectionsKind: 'idle' | 'loading' | 'ready' | 'error';
  nutritionKind: StudentNutritionState['kind'];
}): StudentNutritionDisplayState {
  if (plansKind === 'idle' || plansKind === 'loading') return 'loading';
  if (plansKind === 'error') return 'load_error';

  if (nutritionKind === 'assigned' || nutritionKind === 'self_managed') return 'content';

  if (hasCurrentUser && (connectionsKind === 'idle' || connectionsKind === 'loading')) return 'loading';
  if (hasCurrentUser && connectionsKind === 'error') return 'load_error';

  return 'content';
}

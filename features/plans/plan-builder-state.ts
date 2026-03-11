import type { PlanBuilderErrorReason } from './plan-builder.logic';
import type {
  FoodSearchResult,
  NutritionPlanDetail,
  TrainingPlanDetail,
} from './plan-builder-source';

export type NutritionBuilderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready';
      plan: NutritionPlanDetail;
      isBackgroundUpdating?: boolean;
      backgroundError?: string;
      isMutating?: boolean;
    }
  | { kind: 'saving' }
  | { kind: 'error'; reason: PlanBuilderErrorReason; message: string };

export type TrainingBuilderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready';
      plan: TrainingPlanDetail;
      isBackgroundUpdating?: boolean;
      backgroundError?: string;
      isMutating?: boolean;
    }
  | { kind: 'saving' }
  | { kind: 'error'; reason: PlanBuilderErrorReason; message: string };

export type FoodSearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'done'; results: FoodSearchResult[] }
  | { kind: 'error'; reason: PlanBuilderErrorReason };

export function markNutritionBuilderMutating(state: NutritionBuilderState): NutritionBuilderState {
  if (state.kind !== 'ready') {
    return state;
  }

  return {
    ...state,
    isMutating: true,
    backgroundError: undefined,
  };
}

export function markTrainingBuilderMutating(state: TrainingBuilderState): TrainingBuilderState {
  if (state.kind !== 'ready') {
    return state;
  }

  return {
    ...state,
    isMutating: true,
    backgroundError: undefined,
  };
}

import type {
  FoodSearchResult,
  NutritionPlanDetail,
  TrainingPlanDetail,
} from './plan-builder-source';
import type { PlanBuilderErrorReason } from './plan-builder.logic';

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
  | { kind: 'error'; reason: PlanBuilderErrorReason; message: string }
  /**
   * Device is offline and no cached copy of this plan exists yet (e.g. first
   * load ever happens while offline). Distinct from `error` so the UI can show
   * explicit offline messaging instead of a generic failure. Refs: ET-171, D-041.
   */
  | { kind: 'offline_empty' };

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

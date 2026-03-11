/**
 * React hook for water tracking operations.
 * Wraps water-tracking-source for UI consumption.
 * No Firebase/Firestore concerns in screen components.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getMyWaterLogs,
  logWaterIntake,
  getMyWaterGoalContext,
} from './water-tracking-source';
import {
  resolveEffectiveWaterGoal,
  resolveWaterDayStatus,
  calculateWaterStreak,
  validateWaterIntakeInput,
  normalizeWaterTrackingError,
  type WaterIntakeLog,
  type EffectiveWaterGoal,
  type WaterDayStatus,
  type WaterIntakeInput,
  type WaterIntakeValidationErrors,
  type WaterTrackingActionErrorReason,
} from './water-tracking.logic';

// ─── State types ──────────────────────────────────────────────────────────────

export type WaterTrackingLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      logs: WaterIntakeLog[];
      effectiveGoal: EffectiveWaterGoal | null;
      todayConsumedMl: number;
      todayStatus: WaterDayStatus | null;
      streak: number;
      isMutating?: boolean;
    };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type UseWaterTrackingResult = {
  state: WaterTrackingLoadState;
  reload: (options?: { silent?: boolean }) => void;
  validateIntake: (input: WaterIntakeInput) => WaterIntakeValidationErrors;
  logIntake: (amountMl: number) => Promise<WaterTrackingActionErrorReason | null>;
};

export function useWaterTracking(isAuthenticated: boolean, todayKey: string): UseWaterTrackingResult {
  const [state, setState] = useState<WaterTrackingLoadState>({ kind: 'idle' });

  const load = useCallback((options?: { silent?: boolean }) => {
    if (!isAuthenticated) {
      setState({ kind: 'idle' });
      return;
    }

    if (!options?.silent) {
      setState({ kind: 'loading' });
    }

    void Promise.all([getMyWaterLogs(), getMyWaterGoalContext()])
      .then(([logs, goalContext]) => {
        const effectiveGoal = resolveEffectiveWaterGoal(goalContext);

        const todayLog = logs.find((l) => l.dateKey === todayKey);
        const todayConsumedMl = todayLog?.totalMl ?? 0;

        const todayStatus =
          effectiveGoal !== null
            ? resolveWaterDayStatus(todayConsumedMl, effectiveGoal.dailyMl)
            : null;

        const streak =
          effectiveGoal !== null
            ? calculateWaterStreak(logs, effectiveGoal.dailyMl, todayKey)
            : 0;

        setState({ kind: 'ready', logs, effectiveGoal, todayConsumedMl, todayStatus, streak, isMutating: false });
      })
      .catch((err: Error) => {
        setState({ kind: 'error', message: err.message });
      });
  }, [isAuthenticated, todayKey]);

  useEffect(() => {
    load();
  }, [load]);

  const validateIntake = useCallback(
    (input: WaterIntakeInput) => validateWaterIntakeInput(input),
    []
  );

  const logIntake = useCallback(
    async (amountMl: number): Promise<WaterTrackingActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      // Optimistic update
      if (state.kind === 'ready') {
        const newConsumed = state.todayConsumedMl + amountMl;
        const newStatus = state.effectiveGoal 
          ? resolveWaterDayStatus(newConsumed, state.effectiveGoal.dailyMl)
          : state.todayStatus;
          
        setState({
          ...state,
          todayConsumedMl: newConsumed,
          todayStatus: newStatus,
          isMutating: true,
        });
      }

      try {
        await logWaterIntake(amountMl, todayKey);
        load({ silent: true });
        return null;
      } catch (err) {
        load();
        return normalizeWaterTrackingError(err);
      }
    },
    [isAuthenticated, load, todayKey, state]
  );

  return { state, reload: load, validateIntake, logIntake };
}

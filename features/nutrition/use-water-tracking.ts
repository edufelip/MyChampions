/**
 * React hook for water tracking operations.
 * Wraps water-tracking-source for UI consumption.
 * No Firebase/Data Connect concerns in screen components.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getMyWaterLogs,
  logWaterIntake,
  setStudentWaterGoal,
  getMyWaterGoalContext,
} from './water-tracking-source';
import {
  resolveEffectiveWaterGoal,
  resolveWaterDayStatus,
  calculateWaterStreak,
  validateWaterGoalInput,
  validateWaterIntakeInput,
  normalizeWaterTrackingError,
  type WaterIntakeLog,
  type EffectiveWaterGoal,
  type WaterDayStatus,
  type WaterGoalInput,
  type WaterGoalValidationErrors,
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
    };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type UseWaterTrackingResult = {
  state: WaterTrackingLoadState;
  reload: () => void;
  validateGoal: (input: WaterGoalInput) => WaterGoalValidationErrors;
  validateIntake: (input: WaterIntakeInput) => WaterIntakeValidationErrors;
  logIntake: (amountMl: number) => Promise<WaterTrackingActionErrorReason | null>;
  setGoal: (dailyMl: number) => Promise<WaterTrackingActionErrorReason | null>;
};

export function useWaterTracking(isAuthenticated: boolean, todayKey: string): UseWaterTrackingResult {
  const [state, setState] = useState<WaterTrackingLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!isAuthenticated) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

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

        setState({ kind: 'ready', logs, effectiveGoal, todayConsumedMl, todayStatus, streak });
      })
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }, [isAuthenticated, todayKey]);

  useEffect(() => {
    load();
  }, [load]);

  const validateGoal = useCallback(
    (input: WaterGoalInput) => validateWaterGoalInput(input),
    []
  );

  const validateIntake = useCallback(
    (input: WaterIntakeInput) => validateWaterIntakeInput(input),
    []
  );

  const logIntake = useCallback(
    async (amountMl: number): Promise<WaterTrackingActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await logWaterIntake(amountMl, todayKey);
        load();
        return null;
      } catch (err) {
        return normalizeWaterTrackingError(err);
      }
    },
    [isAuthenticated, load, todayKey]
  );

  const setGoal = useCallback(
    async (dailyMl: number): Promise<WaterTrackingActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await setStudentWaterGoal(dailyMl);
        load();
        return null;
      } catch (err) {
        return normalizeWaterTrackingError(err);
      }
    },
    [isAuthenticated, load]
  );

  return { state, reload: load, validateGoal, validateIntake, logIntake, setGoal };
}

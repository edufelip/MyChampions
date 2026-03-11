/**
 * Water tracking logic — intake logging, goal precedence, streak calculation.
 * Pure functions, no Firebase dependencies.
 * Refs: D-078, D-079, D-081, FR-218–FR-222, BR-276–BR-280
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type WaterGoalOwner = 'student' | 'nutritionist';

/** Effective goal resolution (D-081, BR-279) */
export type EffectiveWaterGoal = {
  dailyMl: number;
  owner: WaterGoalOwner;
};

export type WaterIntakeLog = {
  id: string;
  dateKey: string; // ISO date string: YYYY-MM-DD
  totalMl: number;
  loggedAt: string;
};

export type PlanHydrationSnapshot = {
  sourceKind: 'predefined' | 'assigned' | 'self_managed';
  ownerProfessionalUid: string | null;
  hydrationGoalMl?: number | null;
  updatedAt?: string;
};

export type WaterDayStatus = 'goal_met' | 'on_track' | 'below_goal';

export type WaterTrackingActionErrorReason =
  | 'invalid_amount'
  | 'network'
  | 'configuration'
  | 'unknown';

// ─── Goal precedence ──────────────────────────────────────────────────────────

/**
 * Resolves effective water goal.
 * Nutritionist override takes precedence over student personal goal.
 * Falls back to student goal when no nutritionist assignment is active.
 * Refs: D-081, BR-279
 */
export function resolveEffectiveWaterGoal(input: {
  studentGoalMl: number | null;
  nutritionistGoalMl: number | null;
  hasActiveNutritionistAssignment: boolean;
}): EffectiveWaterGoal | null {
  if (input.hasActiveNutritionistAssignment && input.nutritionistGoalMl !== null) {
    return { dailyMl: input.nutritionistGoalMl, owner: 'nutritionist' };
  }
  if (input.studentGoalMl !== null) {
    return { dailyMl: input.studentGoalMl, owner: 'student' };
  }
  return null;
}

export function resolvePlanHydrationGoalContext(input: {
  plans: PlanHydrationSnapshot[];
  activeNutritionistUids: Set<string>;
  currentUserUid: string;
}): {
  studentGoalMl: number | null;
  nutritionistGoalMl: number | null;
  hasActiveNutritionistAssignment: boolean;
} | null {
  const plans = input.plans
    .filter((p) => typeof p.hydrationGoalMl === 'number' && Number.isFinite(p.hydrationGoalMl) && p.hydrationGoalMl > 0)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

  const assignedPlanGoal = plans.find(
    (p) =>
      p.sourceKind === 'assigned' &&
      Boolean(p.ownerProfessionalUid) &&
      input.activeNutritionistUids.has(p.ownerProfessionalUid as string)
  )?.hydrationGoalMl ?? null;

  const selfManagedPlanGoal =
    plans.find((p) => p.sourceKind === 'self_managed')?.hydrationGoalMl ??
    plans.find((p) => p.sourceKind === 'predefined' && p.ownerProfessionalUid === input.currentUserUid)
      ?.hydrationGoalMl ??
    null;

  if (assignedPlanGoal !== null) {
    return {
      studentGoalMl: selfManagedPlanGoal,
      nutritionistGoalMl: assignedPlanGoal,
      hasActiveNutritionistAssignment: true,
    };
  }

  if (selfManagedPlanGoal !== null) {
    return {
      studentGoalMl: selfManagedPlanGoal,
      nutritionistGoalMl: null,
      hasActiveNutritionistAssignment: false,
    };
  }

  return null;
}

// ─── Day status ───────────────────────────────────────────────────────────────

export function resolveWaterDayStatus(
  consumedMl: number,
  goalMl: number
): WaterDayStatus {
  if (consumedMl >= goalMl) return 'goal_met';
  if (consumedMl > 0) return 'on_track';
  return 'below_goal';
}

// ─── Streak calculation ───────────────────────────────────────────────────────

/**
 * Calculates current streak from sorted daily intake logs.
 * Streak breaks when any day (going back from today) does not meet goal.
 * Ref: BR-280
 *
 * @param logs Array of daily intake entries with totalMl and dateKey (YYYY-MM-DD), sorted descending.
 * @param goalMl Effective daily goal.
 * @param todayKey Today's date as YYYY-MM-DD.
 */
export function calculateWaterStreak(
  logs: { dateKey: string; totalMl: number }[],
  goalMl: number,
  todayKey: string
): number {
  if (goalMl <= 0) return 0;

  const logMap = new Map<string, number>(logs.map((l) => [l.dateKey, l.totalMl]));

  let streak = 0;
  let cursor = new Date(todayKey + 'T00:00:00Z');

  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    const consumed = logMap.get(key) ?? 0;

    if (consumed < goalMl) break;

    streak++;
    cursor = new Date(cursor.getTime() - 86_400_000); // subtract one day
  }

  return streak;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type WaterGoalInput = {
  dailyMlString: string;
};

export type WaterGoalValidationErrors = {
  dailyMl?: 'required' | 'must_be_positive';
};

export function validateWaterGoalInput(input: WaterGoalInput): WaterGoalValidationErrors {
  const errors: WaterGoalValidationErrors = {};
  if (!input.dailyMlString.trim()) {
    errors.dailyMl = 'required';
  } else {
    const ml = parseInt(input.dailyMlString, 10);
    if (isNaN(ml) || ml <= 0) errors.dailyMl = 'must_be_positive';
  }
  return errors;
}

export type WaterIntakeInput = {
  amountMlString: string;
};

export type WaterIntakeValidationErrors = {
  amountMl?: 'required' | 'must_be_positive';
};

export function validateWaterIntakeInput(input: WaterIntakeInput): WaterIntakeValidationErrors {
  const errors: WaterIntakeValidationErrors = {};
  if (!input.amountMlString.trim()) {
    errors.amountMl = 'required';
  } else {
    const ml = parseInt(input.amountMlString, 10);
    if (isNaN(ml) || ml <= 0) errors.amountMl = 'must_be_positive';
  }
  return errors;
}

// ─── Error normalization ──────────────────────────────────────────────────────

export function normalizeWaterTrackingError(error: unknown): WaterTrackingActionErrorReason {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : null;
    const msg = 'message' in error ? String((error as { message: unknown }).message).toLowerCase() : null;

    if (code === 'INVALID_AMOUNT' || msg?.includes('invalid amount')) return 'invalid_amount';
    if (code === 'NETWORK_ERROR' || msg?.includes('network')) return 'network';
    if (msg?.includes('endpoint') || msg?.includes('config')) return 'configuration';
  }
  return 'unknown';
}

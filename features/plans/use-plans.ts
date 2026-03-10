/**
 * React hook for plan and plan change request operations.
 * Wraps plan-source for UI consumption.
 * No Firebase/Firestore concerns in screen components.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getMyPlans,
  getMyPredefinedPlans,
  bulkAssignPredefinedPlan,
  submitPlanChangeRequest,
  reviewPlanChangeRequest,
  getStudentPlanChangeRequests,
  getCachedPlans,
  getCachedPredefinedPlans,
  type Plan,
  type PredefinedPlan,
} from './plan-source';
import {
  validatePlanChangeRequestInput,
  normalizePlanChangeRequestError,
  type PlanType,
  type PlanChangeRequest,
  type PlanChangeRequestInput,
  type PlanChangeRequestValidationErrors,
  type PlanChangeRequestErrorReason,
} from './plan-change-request.logic';

// ─── State types ──────────────────────────────────────────────────────────────

export type PlansLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; plans: Plan[]; predefinedPlans: PredefinedPlan[] };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type UsePlansResult = {
  state: PlansLoadState;
  reload: () => void;
  validateChangeRequest: (input: PlanChangeRequestInput) => PlanChangeRequestValidationErrors;
  submitChangeRequest: (
    planId: string,
    planType: PlanType,
    requestText: string
  ) => Promise<{ data: PlanChangeRequest } | { error: PlanChangeRequestErrorReason }>;
  reviewChangeRequest: (
    requestId: string,
    action: 'reviewed' | 'dismissed'
  ) => Promise<PlanChangeRequestErrorReason | null>;
  getChangeRequestsForStudent: (
    studentUid: string
  ) => Promise<{ data: PlanChangeRequest[] } | { error: PlanChangeRequestErrorReason }>;
  bulkAssign: (
    predefinedPlanId: string,
    studentUids: string[]
  ) => Promise<{ assignedCount: number } | { error: PlanChangeRequestErrorReason }>;
};

export function usePlans(
  isAuthenticated: boolean,
  options: { fetchOnMount?: boolean } = { fetchOnMount: true }
): UsePlansResult {
  const [state, setState] = useState<PlansLoadState>(() => {
    if (!isAuthenticated) return { kind: 'idle' };
    const plans = getCachedPlans();
    const predefinedPlans = getCachedPredefinedPlans();
    if (plans && predefinedPlans) {
      return { kind: 'ready', plans, predefinedPlans };
    }
    return { kind: 'idle' };
  });

  const load = useCallback(() => {
    if (!isAuthenticated) {
      setState({ kind: 'idle' });
      return;
    }

    // If we have cached data, don't show loading spinner to avoid flicker.
    // The background refetch will update the UI silently.
    if (!getCachedPlans() || !getCachedPredefinedPlans()) {
      setState({ kind: 'loading' });
    }

    void Promise.all([getMyPlans(), getMyPredefinedPlans()])
      .then(([plans, predefinedPlans]) => {
        setState({ kind: 'ready', plans, predefinedPlans });
      })
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }, [isAuthenticated]);

  useEffect(() => {
    if (options.fetchOnMount) {
      load();
    }
  }, [load, options.fetchOnMount]);

  const validateChangeRequest = useCallback(
    (input: PlanChangeRequestInput) => validatePlanChangeRequestInput(input),
    []
  );

  const submitChangeRequest = useCallback(
    async (
      planId: string,
      planType: PlanType,
      requestText: string
    ): Promise<{ data: PlanChangeRequest } | { error: PlanChangeRequestErrorReason }> => {
      if (!isAuthenticated) return { error: 'unknown' };

      const errors = validatePlanChangeRequestInput({ requestText });
      if (Object.keys(errors).length > 0) return { error: 'validation' };

      try {
        const data = await submitPlanChangeRequest(planId, planType, requestText);
        return { data };
      } catch (err) {
        return { error: normalizePlanChangeRequestError(err) };
      }
    },
    [isAuthenticated]
  );

  const reviewChangeRequest = useCallback(
    async (
      requestId: string,
      action: 'reviewed' | 'dismissed'
    ): Promise<PlanChangeRequestErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await reviewPlanChangeRequest(requestId, action);
        return null;
      } catch (err) {
        return normalizePlanChangeRequestError(err);
      }
    },
    [isAuthenticated]
  );

  const getChangeRequestsForStudent = useCallback(
    async (
      studentUid: string
    ): Promise<{ data: PlanChangeRequest[] } | { error: PlanChangeRequestErrorReason }> => {
      if (!isAuthenticated) return { error: 'unknown' };

      try {
        const data = await getStudentPlanChangeRequests(studentUid);
        return { data };
      } catch (err) {
        return { error: normalizePlanChangeRequestError(err) };
      }
    },
    [isAuthenticated]
  );

  const bulkAssign = useCallback(
    async (
      predefinedPlanId: string,
      studentUids: string[]
    ): Promise<{ assignedCount: number } | { error: PlanChangeRequestErrorReason }> => {
      if (!isAuthenticated) return { error: 'unknown' };

      try {
        const result = await bulkAssignPredefinedPlan(predefinedPlanId, studentUids);
        load();
        return result;
      } catch (err) {
        return { error: normalizePlanChangeRequestError(err) };
      }
    },
    [isAuthenticated, load]
  );

  return {
    state,
    reload: load,
    validateChangeRequest,
    submitChangeRequest,
    reviewChangeRequest,
    getChangeRequestsForStudent,
    bulkAssign,
  };
}

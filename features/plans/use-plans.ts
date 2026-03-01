/**
 * React hook for plan and plan change request operations.
 * Wraps plan-source for UI consumption.
 * No Firebase/Data Connect concerns in screen components.
 */

import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import {
  getMyPlans,
  getMyPredefinedPlans,
  bulkAssignPredefinedPlan,
  submitPlanChangeRequest,
  reviewPlanChangeRequest,
  getStudentPlanChangeRequests,
  type Plan,
  type PredefinedPlan,
} from './plan-source';
import {
  validatePlanChangeRequestInput,
  normalizePlanChangeRequestError,
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

export function usePlans(user: User | null): UsePlansResult {
  const [state, setState] = useState<PlansLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!user) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void Promise.all([getMyPlans(user), getMyPredefinedPlans(user)])
      .then(([plans, predefinedPlans]) => {
        setState({ kind: 'ready', plans, predefinedPlans });
      })
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const validateChangeRequest = useCallback(
    (input: PlanChangeRequestInput) => validatePlanChangeRequestInput(input),
    []
  );

  const submitChangeRequest = useCallback(
    async (
      planId: string,
      requestText: string
    ): Promise<{ data: PlanChangeRequest } | { error: PlanChangeRequestErrorReason }> => {
      if (!user) return { error: 'unknown' };

      const errors = validatePlanChangeRequestInput({ requestText });
      if (Object.keys(errors).length > 0) return { error: 'validation' };

      try {
        const data = await submitPlanChangeRequest(user, planId, requestText);
        return { data };
      } catch (err) {
        return { error: normalizePlanChangeRequestError(err) };
      }
    },
    [user]
  );

  const reviewChangeRequest = useCallback(
    async (
      requestId: string,
      action: 'reviewed' | 'dismissed'
    ): Promise<PlanChangeRequestErrorReason | null> => {
      if (!user) return 'unknown';

      try {
        await reviewPlanChangeRequest(user, requestId, action);
        return null;
      } catch (err) {
        return normalizePlanChangeRequestError(err);
      }
    },
    [user]
  );

  const getChangeRequestsForStudent = useCallback(
    async (
      studentUid: string
    ): Promise<{ data: PlanChangeRequest[] } | { error: PlanChangeRequestErrorReason }> => {
      if (!user) return { error: 'unknown' };

      try {
        const data = await getStudentPlanChangeRequests(user, studentUid);
        return { data };
      } catch (err) {
        return { error: normalizePlanChangeRequestError(err) };
      }
    },
    [user]
  );

  const bulkAssign = useCallback(
    async (
      predefinedPlanId: string,
      studentUids: string[]
    ): Promise<{ assignedCount: number } | { error: PlanChangeRequestErrorReason }> => {
      if (!user) return { error: 'unknown' };

      try {
        const result = await bulkAssignPredefinedPlan(user, predefinedPlanId, studentUids);
        load();
        return result;
      } catch (err) {
        return { error: normalizePlanChangeRequestError(err) };
      }
    },
    [user, load]
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

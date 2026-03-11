/**
 * React hook for plan and plan change request operations.
 * Store-backed adapter over the centralized Zustand plans store.
 */

import { useCallback, useEffect } from 'react';
import { shallow } from 'zustand/shallow';

import type {
  PlanType,
  PlanChangeRequest,
  PlanChangeRequestInput,
  PlanChangeRequestValidationErrors,
  PlanChangeRequestErrorReason,
} from './plan-change-request.logic';
import { usePlansStore, type PlansLoadState } from './plans-store';

export type { PlansLoadState };

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
  const {
    state,
    plansInvalidation,
    syncAuthContext,
    loadPlans,
    validateChangeRequest,
    submitChangeRequestFromStore,
    reviewChangeRequestFromStore,
    getChangeRequestsForStudentFromStore,
    bulkAssignFromStore,
  } = usePlansStore(
    (s) => ({
      state: s.plansState,
      plansInvalidation: s.invalidation.plans,
      syncAuthContext: s.syncAuthContext,
      loadPlans: s.loadPlans,
      validateChangeRequest: s.validateChangeRequest,
      submitChangeRequestFromStore: s.submitChangeRequest,
      reviewChangeRequestFromStore: s.reviewChangeRequest,
      getChangeRequestsForStudentFromStore: s.getChangeRequestsForStudent,
      bulkAssignFromStore: s.bulkAssign,
    }),
    shallow
  );

  const reload = useCallback(() => {
    void loadPlans(isAuthenticated);
  }, [isAuthenticated, loadPlans]);

  useEffect(() => {
    syncAuthContext(isAuthenticated);
  }, [isAuthenticated, syncAuthContext]);

  useEffect(() => {
    if (options.fetchOnMount) {
      void loadPlans(isAuthenticated);
    }
  }, [isAuthenticated, loadPlans, options.fetchOnMount]);

  useEffect(() => {
    if (!isAuthenticated || !options.fetchOnMount || plansInvalidation === 0) return;
    void loadPlans(isAuthenticated);
  }, [isAuthenticated, loadPlans, options.fetchOnMount, plansInvalidation]);

  const submitChangeRequest = useCallback(
    (planId: string, planType: PlanType, requestText: string) => {
      return submitChangeRequestFromStore(isAuthenticated, planId, planType, requestText);
    },
    [isAuthenticated, submitChangeRequestFromStore]
  );

  const reviewChangeRequest = useCallback(
    (requestId: string, action: 'reviewed' | 'dismissed') => {
      return reviewChangeRequestFromStore(isAuthenticated, requestId, action);
    },
    [isAuthenticated, reviewChangeRequestFromStore]
  );

  const getChangeRequestsForStudent = useCallback(
    (studentUid: string) => {
      return getChangeRequestsForStudentFromStore(isAuthenticated, studentUid);
    },
    [isAuthenticated, getChangeRequestsForStudentFromStore]
  );

  const bulkAssign = useCallback(
    (predefinedPlanId: string, studentUids: string[]) => {
      return bulkAssignFromStore(isAuthenticated, predefinedPlanId, studentUids);
    },
    [bulkAssignFromStore, isAuthenticated]
  );

  return {
    state,
    reload,
    validateChangeRequest,
    submitChangeRequest,
    reviewChangeRequest,
    getChangeRequestsForStudent,
    bulkAssign,
  };
}

export type ProfessionalHomeSourceState = 'loading' | 'ready' | 'error';

export type ProfessionalHomeAttentionState = {
  hasConnectionRequests: boolean;
  hasPlanChangeRequests: boolean;
  hasAnyAttention: boolean;
  hasLoadError: boolean;
  isLoading: boolean;
  showAllCaughtUp: boolean;
};

export function resolveProfessionalHomeAttention(input: {
  connectionRequestCount: number;
  connectionState: ProfessionalHomeSourceState;
  planChangeRequestCount: number;
  planChangeState: ProfessionalHomeSourceState;
}): ProfessionalHomeAttentionState {
  const hasConnectionRequests =
    input.connectionState === 'ready' && input.connectionRequestCount > 0;
  const hasPlanChangeRequests =
    input.planChangeState === 'ready' && input.planChangeRequestCount > 0;
  const hasAnyAttention = hasConnectionRequests || hasPlanChangeRequests;
  const hasLoadError = input.connectionState === 'error' || input.planChangeState === 'error';
  const isLoading = input.connectionState === 'loading' || input.planChangeState === 'loading';

  return {
    hasConnectionRequests,
    hasPlanChangeRequests,
    hasAnyAttention,
    hasLoadError,
    isLoading,
    showAllCaughtUp:
      input.connectionState === 'ready' && input.planChangeState === 'ready' && !hasAnyAttention,
  };
}

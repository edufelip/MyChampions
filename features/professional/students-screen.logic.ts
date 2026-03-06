export type StudentRosterViewState = 'hero_empty' | 'list_shell';

export type ResolveStudentRosterViewStateInput = {
  hasLoadedOnce: boolean;
  isLoading: boolean;
  hasError: boolean;
  visibleCount: number;
};

/**
 * SC-205 view-state arbitration so loading and empty states do not overlap.
 */
export function resolveStudentRosterViewState(
  input: ResolveStudentRosterViewStateInput
): StudentRosterViewState {
  if (input.hasLoadedOnce && !input.isLoading && !input.hasError && input.visibleCount === 0) {
    return 'hero_empty';
  }

  return 'list_shell';
}

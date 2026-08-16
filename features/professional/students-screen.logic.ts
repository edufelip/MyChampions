export type StudentRosterViewState = 'hero_empty' | 'error' | 'list_shell';

type BulkAssignableStudent = {
  nutritionStatus: 'active' | 'pending' | 'none';
  trainingStatus: 'active' | 'pending' | 'none';
};

type FilterableRosterStudent = {
  assignmentStatus: 'active' | 'pending';
  displayName: string;
};

export type ResolveStudentRosterViewStateInput = {
  hasLoadedOnce: boolean;
  isLoading: boolean;
  hasError: boolean;
  visibleCount: number;
};

/**
 * SC-205 view-state arbitration so loading, error, and empty states do not overlap.
 *
 * A settled roster-read error takes priority over the empty hero state so
 * search/filter/bulk-assign controls stay gated behind Retry instead of
 * silently falling back to "No students yet" copy.
 */
export function resolveStudentRosterViewState(
  input: ResolveStudentRosterViewStateInput,
): StudentRosterViewState {
  if (input.hasLoadedOnce && !input.isLoading && input.hasError) {
    return 'error';
  }

  if (input.hasLoadedOnce && !input.isLoading && !input.hasError && input.visibleCount === 0) {
    return 'hero_empty';
  }

  return 'list_shell';
}

export function filterStudentRosterRows<T extends FilterableRosterStudent>(
  students: T[],
  input: { filter: 'all' | 'active' | 'pending'; search: string },
): T[] {
  const query = input.search.trim().toLowerCase();
  return students.filter((student) => {
    const matchesFilter =
      input.filter === 'all' ||
      (input.filter === 'active' && student.assignmentStatus === 'active') ||
      (input.filter === 'pending' && student.assignmentStatus === 'pending');

    const matchesSearch = !query || student.displayName.toLowerCase().includes(query);

    return matchesFilter && matchesSearch;
  });
}

export function filterBulkAssignmentStudentsByPlanType<T extends BulkAssignableStudent>(
  students: T[],
  planType: 'nutrition' | 'training',
): T[] {
  return students.filter((student) =>
    planType === 'nutrition'
      ? student.nutritionStatus === 'active'
      : student.trainingStatus === 'active',
  );
}

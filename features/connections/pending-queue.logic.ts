/**
 * Pending connection queue search/filter/bulk deny logic (BL-004).
 * Pure functions for filtering, searching, and validating queue operations.
 * Refs: D-070, FR-210, AC-254, BR-268, TC-257, TC-258
 */

import type { ConnectionRecord } from './connection.logic';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueFilterCriteria = {
  searchQuery: string;
  specialty?: 'nutritionist' | 'fitness_coach' | null;
};

export type PendingQueueError = 'no_selections' | 'unknown';

// ─── Search/Filter Logic ──────────────────────────────────────────────────────

/**
 * Filter pending connections by search query and specialty.
 * Search matches against connection ID (student UID).
 */
export function filterPendingQueue(
  connections: ConnectionRecord[],
  criteria: QueueFilterCriteria
): ConnectionRecord[] {
  let filtered = connections.filter((c) => c.status === 'pending_confirmation');

  // Apply search filter (case-insensitive substring match on ID)
  if (criteria.searchQuery.trim()) {
    const q = criteria.searchQuery.trim().toLowerCase();
    filtered = filtered.filter((c) => c.id.toLowerCase().includes(q));
  }

  // Apply specialty filter if specified
  if (criteria.specialty) {
    filtered = filtered.filter((c) => c.specialty === criteria.specialty);
  }

  return filtered;
}

/**
 * Determine if bulk deny can proceed (at least one selection).
 */
export function canBulkDeny(selectedIds: Set<string>): boolean {
  return selectedIds.size > 0;
}

/**
 * Validate bulk deny operation.
 */
export function validateBulkDeny(
  selectedIds: Set<string>
): PendingQueueError | null {
  if (selectedIds.size === 0) {
    return 'no_selections';
  }
  return null;
}

/**
 * Build confirmation message for bulk deny.
 * Shows count and specialty distribution if useful.
 */
export function buildBulkDenyConfirmationMessage(
  selectedCount: number,
  allPending: ConnectionRecord[],
  selectedIds: Set<string>
): {
  title: string;
  body: string;
} {
  const selectedConnections = allPending.filter((c) => selectedIds.has(c.id));
  const nutritionistCount = selectedConnections.filter(
    (c) => c.specialty === 'nutritionist'
  ).length;
  const coachCount = selectedConnections.filter(
    (c) => c.specialty === 'fitness_coach'
  ).length;

  const title = 'Confirm bulk deny';
  let body = `You are about to deny ${selectedCount} pending request${selectedCount !== 1 ? 's' : ''}.`;

  if (nutritionistCount > 0 && coachCount > 0) {
    body += ` ${nutritionistCount} nutrition, ${coachCount} training.`;
  } else if (nutritionistCount > 0) {
    body += ` All ${nutritionistCount} nutrition.`;
  } else if (coachCount > 0) {
    body += ` All ${coachCount} training.`;
  }

  body += ' This action cannot be undone.';

  return { title, body };
}

/**
 * Format search results summary.
 */
export function formatSearchResultsSummary(
  allPending: ConnectionRecord[],
  filtered: ConnectionRecord[],
  criteria: QueueFilterCriteria
): string {
  if (!criteria.searchQuery.trim() && !criteria.specialty) {
    return `${allPending.length} pending request${allPending.length !== 1 ? 's' : ''}`;
  }

  return `${filtered.length} of ${allPending.length} pending request${filtered.length !== 1 ? 's' : ''} match filter`;
}

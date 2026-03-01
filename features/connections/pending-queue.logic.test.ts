/**
 * Unit tests for pending queue search/filter/bulk deny logic (BL-004, TC-257, TC-258).
 * Tests filter criteria, bulk operations validation, and confirmation messaging.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterPendingQueue,
  filterPendingQueueOptimized,
  canBulkDeny,
  validateBulkDeny,
  buildBulkDenyConfirmationMessage,
  formatSearchResultsSummary,
  type QueueFilterCriteria,
} from './pending-queue.logic';
import type { ConnectionRecord } from './connection.logic';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const mockConnections: ConnectionRecord[] = [
  {
    id: 'student-alice-123',
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  },
  {
    id: 'student-bob-456',
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: 'fitness_coach',
    professionalAuthUid: 'prof-1',
  },
  {
    id: 'student-charlie-789',
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  },
  {
    id: 'student-diana-012',
    status: 'active',
    canceledReason: null,
    specialty: 'fitness_coach',
    professionalAuthUid: 'prof-1',
  },
  {
    id: 'student-eve-345',
    status: 'ended',
    canceledReason: null,
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  },
];

// ─── Filter Pending Queue ──────────────────────────────────────────────────────

test('BL-004 Filter: returns only pending_confirmation status', () => {
  const criteria: QueueFilterCriteria = { searchQuery: '' };
  const result = filterPendingQueue(mockConnections, criteria);

  // Should exclude active and ended
  assert.equal(result.length, 3);
  result.forEach((conn) => {
    assert.equal(conn.status, 'pending_confirmation');
  });
});

test('BL-004 Filter: no criteria returns all pending', () => {
  const criteria: QueueFilterCriteria = { searchQuery: '' };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((c) => c.id),
    ['student-alice-123', 'student-bob-456', 'student-charlie-789']
  );
});

test('BL-004 Filter: search by student ID substring (case-insensitive)', () => {
  const criteria: QueueFilterCriteria = { searchQuery: 'alice' };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'student-alice-123');
});

test('BL-004 Filter: search is case-insensitive', () => {
  const criteria: QueueFilterCriteria = { searchQuery: 'ALICE' };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'student-alice-123');
});

test('BL-004 Filter: search with no matches returns empty', () => {
  const criteria: QueueFilterCriteria = { searchQuery: 'nonexistent' };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 0);
});

test('BL-004 Filter: search with whitespace trimming', () => {
  const criteria: QueueFilterCriteria = { searchQuery: '  bob  ' };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'student-bob-456');
});

test('BL-004 Filter: filter by specialty (nutritionist)', () => {
  const criteria: QueueFilterCriteria = {
    searchQuery: '',
    specialty: 'nutritionist',
  };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 2);
  result.forEach((conn) => {
    assert.equal(conn.specialty, 'nutritionist');
  });
});

test('BL-004 Filter: filter by specialty (fitness_coach)', () => {
  const criteria: QueueFilterCriteria = {
    searchQuery: '',
    specialty: 'fitness_coach',
  };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.specialty, 'fitness_coach');
});

test('BL-004 Filter: combine search and specialty filter', () => {
  const criteria: QueueFilterCriteria = {
    searchQuery: 'student',
    specialty: 'nutritionist',
  };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 2);
  result.forEach((conn) => {
    assert.equal(conn.specialty, 'nutritionist');
    assert(conn.id.includes('student'));
  });
});

test('BL-004 Filter: specialty filter with no matches', () => {
  const criteria: QueueFilterCriteria = {
    searchQuery: 'bob',
    specialty: 'nutritionist',
  };
  const result = filterPendingQueue(mockConnections, criteria);

  // bob is fitness_coach, not nutritionist
  assert.equal(result.length, 0);
});

// ─── Bulk Deny Validation ──────────────────────────────────────────────────────

test('BL-004 Bulk deny: canBulkDeny returns true when selections exist', () => {
  const selected = new Set(['id-1', 'id-2']);
  assert.equal(canBulkDeny(selected), true);
});

test('BL-004 Bulk deny: canBulkDeny returns false when empty', () => {
  const selected = new Set<string>();
  assert.equal(canBulkDeny(selected), false);
});

test('BL-004 Bulk deny: validateBulkDeny returns null when valid', () => {
  const selected = new Set(['id-1', 'id-2']);
  const err = validateBulkDeny(selected);
  assert.equal(err, null);
});

test('BL-004 Bulk deny: validateBulkDeny returns error when empty', () => {
  const selected = new Set<string>();
  const err = validateBulkDeny(selected);
  assert.equal(err, 'no_selections');
});

// ─── Bulk Deny Confirmation Message ────────────────────────────────────────────

test('BL-004 Confirmation: builds message for single nutrition request', () => {
  const selected = new Set(['student-alice-123']);
  const pending = mockConnections.filter(
    (c) => c.status === 'pending_confirmation'
  );

  const msg = buildBulkDenyConfirmationMessage(1, pending, selected);

  assert(msg.title.includes('Confirm'));
  assert(msg.body.includes('1 pending request'));
  assert(msg.body.includes('1 nutrition'));
});

test('BL-004 Confirmation: builds message for multiple mixed requests', () => {
  const selected = new Set([
    'student-alice-123',
    'student-bob-456',
    'student-charlie-789',
  ]);
  const pending = mockConnections.filter(
    (c) => c.status === 'pending_confirmation'
  );

  const msg = buildBulkDenyConfirmationMessage(3, pending, selected);

  assert(msg.body.includes('3 pending requests'));
  assert(msg.body.includes('2 nutrition'));
  assert(msg.body.includes('1 training'));
  assert(msg.body.includes('This action cannot be undone'));
});

test('BL-004 Confirmation: message for all same specialty', () => {
  const selected = new Set(['student-alice-123', 'student-charlie-789']);
  const pending = mockConnections.filter(
    (c) => c.status === 'pending_confirmation'
  );

  const msg = buildBulkDenyConfirmationMessage(2, pending, selected);

  assert(msg.body.includes('2 pending requests'));
  assert(msg.body.includes('All 2 nutrition'));
  assert(!msg.body.includes('training'));
});

test('BL-004 Confirmation: message includes singularization for 1 request', () => {
  const selected = new Set(['student-bob-456']);
  const pending = mockConnections.filter(
    (c) => c.status === 'pending_confirmation'
  );

  const msg = buildBulkDenyConfirmationMessage(1, pending, selected);

  assert(msg.body.includes('1 pending request')); // singular
  assert(!msg.body.includes('requests'));
});

// ─── Search Results Summary ────────────────────────────────────────────────────

test('BL-004 Summary: shows total pending count when no filter', () => {
  const all = mockConnections.filter(
    (c) => c.status === 'pending_confirmation'
  );
  const criteria: QueueFilterCriteria = { searchQuery: '' };

  const summary = formatSearchResultsSummary(all, all, criteria);

  assert(summary.includes('3 pending'));
});

test('BL-004 Summary: shows filtered count when criteria applied', () => {
  const all = mockConnections.filter(
    (c) => c.status === 'pending_confirmation'
  );
  const filtered = filterPendingQueue(mockConnections, {
    searchQuery: 'alice',
  });
  const criteria: QueueFilterCriteria = { searchQuery: 'alice' };

  const summary = formatSearchResultsSummary(all, filtered, criteria);

  assert(summary.includes('1 of 3'));
  assert(summary.includes('match filter'));
});

test('BL-004 Summary: singularizes result count', () => {
  const all = mockConnections.filter(
    (c) => c.status === 'pending_confirmation'
  );
  const filtered = [all[0]!];
  const criteria: QueueFilterCriteria = { searchQuery: 'alice' };

  const summary = formatSearchResultsSummary(all, filtered, criteria);

  assert(summary.includes('1 of 3 pending request'));
  assert(!summary.includes('requests')); // singular
});

// ─── Edge Cases ────────────────────────────────────────────────────────────────

test('BL-004 Edge case: empty pending list', () => {
  const criteria: QueueFilterCriteria = { searchQuery: '' };
  const result = filterPendingQueue([], criteria);

  assert.equal(result.length, 0);
});

test('BL-004 Edge case: all connections are non-pending', () => {
  const nonPending = mockConnections.filter(
    (c) => c.status !== 'pending_confirmation'
  );
  const criteria: QueueFilterCriteria = { searchQuery: '' };
  const result = filterPendingQueue(nonPending, criteria);

  assert.equal(result.length, 0);
});

test('BL-004 Edge case: specialty null matches nothing', () => {
  const criteria: QueueFilterCriteria = {
    searchQuery: '',
    specialty: null,
  };
  const result = filterPendingQueue(mockConnections, criteria);

  // null specialty should not filter (return all pending)
  assert.equal(result.length, 3);
});

test('BL-004 Edge case: search with special characters', () => {
  const criteria: QueueFilterCriteria = { searchQuery: '-' };
  const result = filterPendingQueue(mockConnections, criteria);

  // All test IDs contain '-' so all should match
  assert.equal(result.length, 3);
});

test('BL-004 Edge case: numeric search in ID', () => {
  const criteria: QueueFilterCriteria = { searchQuery: '123' };
  const result = filterPendingQueue(mockConnections, criteria);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'student-alice-123');
});

// ─── Optimized Filter for Large Datasets ───────────────────────────────────────

test('BL-004 Optimized: returns same results as standard filter', () => {
  const criteria: QueueFilterCriteria = { searchQuery: 'alice', specialty: 'nutritionist' };
  
  const standardResult = filterPendingQueue(mockConnections, criteria);
  const optimizedResult = filterPendingQueueOptimized(mockConnections, criteria);

  assert.deepEqual(optimizedResult, standardResult);
  assert.equal(optimizedResult.length, 1);
  assert.equal(optimizedResult[0]?.id, 'student-alice-123');
});

test('BL-004 Optimized: single pass filter correctness', () => {
  const criteria: QueueFilterCriteria = { searchQuery: 'student', specialty: 'fitness_coach' };
  const result = filterPendingQueueOptimized(mockConnections, criteria);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.specialty, 'fitness_coach');
  assert(result[0]?.id.includes('student'));
});

test('BL-004 Optimized: handles empty search query', () => {
  const criteria: QueueFilterCriteria = { searchQuery: '   ', specialty: 'nutritionist' };
  const result = filterPendingQueueOptimized(mockConnections, criteria);

  assert.equal(result.length, 2);
  result.forEach((r) => {
    assert.equal(r.specialty, 'nutritionist');
  });
});

test('BL-004 Optimized: case-insensitive search works', () => {
  const criteria: QueueFilterCriteria = { searchQuery: 'CHARLIE' };
  const result = filterPendingQueueOptimized(mockConnections, criteria);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'student-charlie-789');
});

test('BL-004 Optimized: no filters returns all pending', () => {
  const criteria: QueueFilterCriteria = { searchQuery: '' };
  const result = filterPendingQueueOptimized(mockConnections, criteria);

  assert.equal(result.length, 3);
});

test('BL-004 Optimized: empty list returns empty', () => {
  const criteria: QueueFilterCriteria = { searchQuery: 'alice', specialty: 'nutritionist' };
  const result = filterPendingQueueOptimized([], criteria);

  assert.equal(result.length, 0);
});

test('BL-004 Optimized: null specialty means no filter', () => {
  const criteria: QueueFilterCriteria = { searchQuery: 'student', specialty: null };
  const result = filterPendingQueueOptimized(mockConnections, criteria);

  // All have 'student' in ID, so all should match
  assert.equal(result.length, 3);
});

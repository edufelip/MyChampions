/**
 * Unit tests for specialty removal assist logic (BL-011, TC-262, TC-263).
 * Tests blocking conditions, assist actions, and assist state resolution.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveRemovalAssistState,
  buildActionMetadata,
  filterBlockersBySpecialty,
  countBlockers,
  canRemovalProceedNow,
  formatRemovalBlockedMessage,
  getRemovalBlockedMessageKeys,
  shouldShowBlockers,
  type RemovalAssistState,
} from './specialty-removal-assist.logic';
import type { ConnectionRecord } from '@/features/connections/connection.logic';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const mockConnections: ConnectionRecord[] = [
  {
    id: 'student-alice-123',
    status: 'active',
    canceledReason: null,
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  },
  {
    id: 'student-bob-456',
    status: 'active',
    canceledReason: null,
    specialty: 'nutritionist',
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
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: 'fitness_coach',
    professionalAuthUid: 'prof-1',
  },
];

// ─── Removal Assist State Resolution ───────────────────────────────────────────

test('BL-011 Assist: no blockers when zero active/pending and multiple specialties', () => {
  const state = resolveRemovalAssistState({
    specialty: 'nutritionist',
    activeStudentCount: 0,
    pendingStudentCount: 0,
    totalActiveSpecialties: 2,
  });

  assert.equal(state.blocked, false);
  assert.equal(state.blockReason, null);
  assert.equal(state.availableActions.length, 0);
});

test('BL-011 Assist: blocked when active students exist', () => {
  const state = resolveRemovalAssistState({
    specialty: 'nutritionist',
    activeStudentCount: 2,
    pendingStudentCount: 0,
    totalActiveSpecialties: 2,
  });

  assert.equal(state.blocked, true);
  assert.equal(state.blockReason, 'has_active_students');
  assert.equal(state.activeStudentCount, 2);
  assert(state.availableActions.includes('view_active'));
});

test('BL-011 Assist: blocked when pending students exist', () => {
  const state = resolveRemovalAssistState({
    specialty: 'nutritionist',
    activeStudentCount: 0,
    pendingStudentCount: 1,
    totalActiveSpecialties: 2,
  });

  assert.equal(state.blocked, true);
  assert.equal(state.blockReason, 'has_pending_students');
  assert.equal(state.pendingStudentCount, 1);
  assert(state.availableActions.includes('view_pending'));
  assert(state.availableActions.includes('bulk_deny_pending'));
});

test('BL-011 Assist: last specialty priority blocks before active/pending', () => {
  const state = resolveRemovalAssistState({
    specialty: 'nutritionist',
    activeStudentCount: 5,
    pendingStudentCount: 3,
    totalActiveSpecialties: 1,
  });

  assert.equal(state.blocked, true);
  assert.equal(state.blockReason, 'last_specialty');
  assert(state.availableActions.includes('add_specialty'));
});

test('BL-011 Assist: active priority blocks before pending', () => {
  const state = resolveRemovalAssistState({
    specialty: 'nutritionist',
    activeStudentCount: 2,
    pendingStudentCount: 3,
    totalActiveSpecialties: 2,
  });

  assert.equal(state.blockReason, 'has_active_students');
  assert.equal(state.availableActions.length, 1);
  assert.equal(state.availableActions[0], 'view_active');
});

test('BL-011 Assist: pending actions include both view and bulk deny', () => {
  const state = resolveRemovalAssistState({
    specialty: 'fitness_coach',
    activeStudentCount: 0,
    pendingStudentCount: 2,
    totalActiveSpecialties: 2,
  });

  assert.equal(state.availableActions.length, 2);
  assert(state.availableActions.includes('view_pending'));
  assert(state.availableActions.includes('bulk_deny_pending'));
});

test('BL-011 Assist: single specialty block reason', () => {
  const state = resolveRemovalAssistState({
    specialty: 'nutritionist',
    activeStudentCount: 0,
    pendingStudentCount: 0,
    totalActiveSpecialties: 1,
  });

  assert.equal(state.blockReason, 'last_specialty');
});

// ─── Action Metadata ──────────────────────────────────────────────────────────

test('BL-011 Metadata: view_active includes proper navigation target', () => {
  const meta = buildActionMetadata('view_active', 'nutritionist');

  assert.equal(meta.action, 'view_active');
  assert(meta.label.includes('removal_assist'));
  assert(meta.navigationTarget?.includes('nutritionist'));
  assert.equal(meta.priority, 'primary');
});

test('BL-011 Metadata: view_pending targets queue screen', () => {
  const meta = buildActionMetadata('view_pending', 'fitness_coach');

  assert.equal(meta.action, 'view_pending');
  assert(meta.navigationTarget?.includes('pending'));
  assert.equal(meta.priority, 'primary');
});

test('BL-011 Metadata: bulk_deny_pending secondary priority', () => {
  const meta = buildActionMetadata('bulk_deny_pending', 'nutritionist');

  assert.equal(meta.action, 'bulk_deny_pending');
  assert.equal(meta.priority, 'secondary');
});

test('BL-011 Metadata: add_specialty for last specialty block', () => {
  const meta = buildActionMetadata('add_specialty', 'nutritionist');

  assert.equal(meta.action, 'add_specialty');
  assert(meta.navigationTarget?.includes('specialties'));
  assert.equal(meta.priority, 'primary');
});

// ─── Filter Blockers By Specialty ──────────────────────────────────────────────

test('BL-011 Filter: blockers by specialty (active)', () => {
  const blockers = filterBlockersBySpecialty(mockConnections, 'nutritionist', 'active');

  assert.equal(blockers.length, 2);
  blockers.forEach((b) => {
    assert.equal(b.specialty, 'nutritionist');
    assert.equal(b.status, 'active');
  });
});

test('BL-011 Filter: blockers by specialty (pending)', () => {
  const blockers = filterBlockersBySpecialty(mockConnections, 'fitness_coach', 'pending_confirmation');

  assert.equal(blockers.length, 1);
  assert.equal(blockers[0]?.id, 'student-eve-345');
});

test('BL-011 Filter: blockers by specialty nutrition pending', () => {
  const blockers = filterBlockersBySpecialty(mockConnections, 'nutritionist', 'pending_confirmation');

  assert.equal(blockers.length, 1); // charlie
});

test('BL-011 Filter: empty list returns empty', () => {
  const blockers = filterBlockersBySpecialty([], 'nutritionist', 'active');

  assert.equal(blockers.length, 0);
});

// ─── Count Blockers ────────────────────────────────────────────────────────────

test('BL-011 Count: blockers by type for specialty', () => {
  const counts = countBlockers(mockConnections, 'nutritionist');

  assert.equal(counts.activeCount, 2);
  assert.equal(counts.pendingCount, 1);
});

test('BL-011 Count: fitness_coach blockers', () => {
  const counts = countBlockers(mockConnections, 'fitness_coach');

  assert.equal(counts.activeCount, 1);
  assert.equal(counts.pendingCount, 1);
});

test('BL-011 Count: empty connections', () => {
  const counts = countBlockers([], 'nutritionist');

  assert.equal(counts.activeCount, 0);
  assert.equal(counts.pendingCount, 0);
});

// ─── Removal Proceed Check ────────────────────────────────────────────────────

test('BL-011 Proceed: true when all blockers resolved', () => {
  const canProceed = canRemovalProceedNow(0, 0, 2);

  assert.equal(canProceed, true);
});

test('BL-011 Proceed: false when active exists', () => {
  const canProceed = canRemovalProceedNow(1, 0, 2);

  assert.equal(canProceed, false);
});

test('BL-011 Proceed: false when pending exists', () => {
  const canProceed = canRemovalProceedNow(0, 2, 2);

  assert.equal(canProceed, false);
});

test('BL-011 Proceed: false when last specialty', () => {
  const canProceed = canRemovalProceedNow(0, 0, 1);

  assert.equal(canProceed, false);
});

// ─── Format Blocked Message ───────────────────────────────────────────────────

test('BL-011 Message: active students block reason', () => {
  const msg = formatRemovalBlockedMessage('has_active_students', 2, 0);

  assert(msg.title.includes('Cannot remove'));
  assert(msg.body.includes('2 active students'));
  assert(msg.body.includes('Unbind'));
});

test('BL-011 Message: singular active student', () => {
  const msg = formatRemovalBlockedMessage('has_active_students', 1, 0);

  assert(msg.body.includes('1 active student'));
  assert(!msg.body.includes('students'));
});

test('BL-011 Message: pending students block reason', () => {
  const msg = formatRemovalBlockedMessage('has_pending_students', 0, 3);

  assert(msg.body.includes('3 pending students'));
  assert(msg.body.includes('Accept or deny'));
});

test('BL-011 Message: last specialty block reason', () => {
  const msg = formatRemovalBlockedMessage('last_specialty', 0, 0);

  assert(msg.body.includes('at least one specialty'));
  assert(msg.body.includes('Add a new specialty'));
});

// ─── Should Show Blockers ─────────────────────────────────────────────────────

test('BL-011 Show blockers: true for active block', () => {
  assert.equal(shouldShowBlockers('has_active_students'), true);
});

test('BL-011 Show blockers: true for pending block', () => {
  assert.equal(shouldShowBlockers('has_pending_students'), true);
});

test('BL-011 Show blockers: false for last specialty', () => {
  assert.equal(shouldShowBlockers('last_specialty'), false);
});

test('BL-011 Show blockers: false when no block', () => {
  assert.equal(shouldShowBlockers(null), false);
});

// ─── Edge Cases ────────────────────────────────────────────────────────────────

test('BL-011 Edge case: zero total specialties', () => {
  const state = resolveRemovalAssistState({
    specialty: 'nutritionist',
    activeStudentCount: 0,
    pendingStudentCount: 0,
    totalActiveSpecialties: 0,
  });

  assert.equal(state.blocked, true);
  assert.equal(state.blockReason, 'last_specialty');
});

test('BL-011 Edge case: large blocker counts', () => {
  const msg = formatRemovalBlockedMessage('has_active_students', 50, 30);

  assert(msg.body.includes('50 active students'));
});

test('BL-011 Edge case: mixed blocker filtering', () => {
  const allConnections: ConnectionRecord[] = [
    ...mockConnections,
    {
      id: 'student-frank-678',
      status: 'ended',
      canceledReason: null,
      specialty: 'nutritionist',
      professionalAuthUid: 'prof-1',
    },
  ];

  const activeBlockers = filterBlockersBySpecialty(allConnections, 'nutritionist', 'active');
  assert.equal(activeBlockers.length, 2); // Should not include ended
});

test('BL-011 Edge case: empty action list when no blockers', () => {
  const state = resolveRemovalAssistState({
    specialty: 'nutritionist',
    activeStudentCount: 0,
    pendingStudentCount: 0,
    totalActiveSpecialties: 2,
  });

  assert.equal(state.availableActions.length, 0);
});

// ─── Localized Message Keys ────────────────────────────────────────────────────

test('BL-011 Localization: returns message keys for active students block', () => {
  const keys = getRemovalBlockedMessageKeys('has_active_students');

  assert.equal(keys.titleKey, 'pro.specialty.removal_blocked.title');
  assert.equal(keys.bodyKey, 'pro.specialty.removal_blocked.active_students_body');
});

test('BL-011 Localization: returns message keys for pending students block', () => {
  const keys = getRemovalBlockedMessageKeys('has_pending_students');

  assert.equal(keys.titleKey, 'pro.specialty.removal_blocked.title');
  assert.equal(keys.bodyKey, 'pro.specialty.removal_blocked.pending_students_body');
});

test('BL-011 Localization: returns message keys for last specialty block', () => {
  const keys = getRemovalBlockedMessageKeys('last_specialty');

  assert.equal(keys.titleKey, 'pro.specialty.removal_blocked.title');
  assert.equal(keys.bodyKey, 'pro.specialty.removal_blocked.last_specialty_body');
});

test('BL-011 Localization: formatRemovalBlockedMessage still works (backward compatibility)', () => {
  const msg = formatRemovalBlockedMessage('has_active_students', 2, 0);

  assert.equal(msg.title, 'Cannot remove specialty');
  assert(msg.body.includes('2 active students'));
});

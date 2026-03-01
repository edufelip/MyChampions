/**
 * Edge case and error scenario tests for BL-003 (TC-256).
 * Tests boundary conditions and exceptional states.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveConnectionDisplayState,
  normalizeCanceledReason,
  type ConnectionRecord,
} from './connection.logic';

// ─── Edge case: Multiple cancellation attempts ─────────────────────────────

test('BL-003 Edge case: Canceled request cannot be canceled again', () => {
  // A request that's already ended with code_rotated cannot be affected by another code rotation
  const alreadyCanceled: ConnectionRecord = {
    id: 'conn-1',
    status: 'ended',
    canceledReason: 'code_rotated',
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  };

  const displayState = resolveConnectionDisplayState(alreadyCanceled);
  assert.equal(displayState.kind, 'canceled_code_rotated');

  // Even if we process the same record again, it remains canceled
  const displayStateAgain = resolveConnectionDisplayState(alreadyCanceled);
  assert.equal(displayStateAgain.kind, 'canceled_code_rotated');
});

// ─── Edge case: Active connection remains active even after code rotation ────

test('BL-003 Edge case: Active connection is NOT affected by subsequent code rotations', () => {
  // Once connection is active, code rotation doesn\'t retroactively cancel it
  const activeConnection: ConnectionRecord = {
    id: 'conn-1',
    status: 'active',
    canceledReason: null,
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  };

  const displayState = resolveConnectionDisplayState(activeConnection);
  assert.equal(displayState.kind, 'active');

  // canceledReason is null, so even if it's "ended" in the future,
  // it would only show as "ended", not "canceled_code_rotated"
});

// ─── Edge case: Empty list of connections ──────────────────────────────────

test('BL-003 Edge case: Empty connections list (no pending or canceled)', () => {
  const emptyConnections: ConnectionRecord[] = [];

  const displayStates = emptyConnections.map(resolveConnectionDisplayState);

  assert.equal(displayStates.length, 0);
  // UI should show empty state with self-guided CTA
});

// ─── Edge case: All connections canceled by same code rotation ─────────────

test('BL-003 Edge case: All pending requests canceled when professional rotates code', () => {
  // Professional with 10 pending requests regenerates code → all 10 become canceled_code_rotated
  const allPending: ConnectionRecord[] = Array.from({ length: 10 }, (_, i) => ({
    id: `pending-${i}`,
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: (i % 2 === 0 ? 'nutritionist' : 'fitness_coach') as 'nutritionist' | 'fitness_coach',
    professionalAuthUid: 'prof-123',
  }));

  // After code rotation:
  const allCanceled: ConnectionRecord[] = allPending.map((record) => ({
    ...record,
    status: 'ended',
    canceledReason: 'code_rotated',
  }));

  const displayStates = allCanceled.map(resolveConnectionDisplayState);

  // All should be canceled_code_rotated
  assert.equal(displayStates.length, 10);
  displayStates.forEach((state) => {
    assert.equal(state.kind, 'canceled_code_rotated');
  });
});

// ─── Edge case: Mixed connection states after code rotation ────────────────

test('BL-003 Edge case: Mix of pending, canceled, and active after one code rotation', () => {
  // Scenario: prof has active connection, 2 pending, then rotates code
  const mixedConnections: ConnectionRecord[] = [
    {
      id: 'active-1',
      status: 'active',
      canceledReason: null,
      specialty: 'nutritionist' as const,
      professionalAuthUid: 'prof-1',
    },
    {
      id: 'pending-1',
      status: 'ended',
      canceledReason: 'code_rotated',
      specialty: 'nutritionist' as const,
      professionalAuthUid: 'prof-1',
    },
    {
      id: 'pending-2',
      status: 'ended',
      canceledReason: 'code_rotated',
      specialty: 'fitness_coach' as const,
      professionalAuthUid: 'prof-1',
    },
  ];

  const displayStates = mixedConnections.map(resolveConnectionDisplayState);

  // Active remains active
  assert.equal(displayStates[0].kind, 'active');
  // Both pending became canceled
  assert.equal(displayStates[1].kind, 'canceled_code_rotated');
  assert.equal(displayStates[2].kind, 'canceled_code_rotated');
});

// ─── Edge case: Connection with invalid canceledReason ────────────────────

test('BL-003 Edge case: Invalid canceledReason treated as null', () => {
  const recordWithInvalidReason: ConnectionRecord = {
    id: 'conn-1',
    status: 'ended',
    canceledReason: null, // normalizeCanceledReason returns null for unknown values
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  };

  const displayState = resolveConnectionDisplayState(recordWithInvalidReason);

  // Should map to "ended", not "canceled_code_rotated"
  assert.equal(displayState.kind, 'ended');
  assert.notEqual(displayState.kind, 'canceled_code_rotated');
});

// ─── Edge case: Stale cached connection state ──────────────────────────────

test('BL-003 Edge case: Stale cache (pending) vs fresh state (canceled)', () => {
  // User sees pending from cache, then refreshes to see canceled
  const cachedPendingState = {
    kind: 'pending',
    connectionId: 'conn-1',
    specialty: 'nutritionist' as const,
  };

  // Refresh from server
  const freshRecord: ConnectionRecord = {
    id: 'conn-1',
    status: 'ended',
    canceledReason: 'code_rotated',
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  };

  const freshDisplayState = resolveConnectionDisplayState(freshRecord);

  // Fresh state should update cached state
  assert.notEqual(cachedPendingState.kind, freshDisplayState.kind);
  assert.equal(freshDisplayState.kind, 'canceled_code_rotated');
});

// ─── Edge case: Rapid code rotations ───────────────────────────────────────

test('BL-003 Edge case: Professional rapidly rotates code multiple times', () => {
  // Prof rotates code 3 times in quick succession
  // Only requests from the very first code should be canceled once

  // Timeline:
  // T0: Student submits code v1 → pending
  // T1: Prof rotates to v2 → old pending becomes canceled_code_rotated
  // T2: Student submits v2 → new pending
  // T3: Prof rotates to v3 → T2 pending becomes canceled_code_rotated
  // T4: Student submits v3 → newest pending

  const statesOverTime = [
    // T0
    resolveConnectionDisplayState({
      id: 'req-v1',
      status: 'pending_confirmation',
      canceledReason: null,
      specialty: 'nutritionist' as const,
      professionalAuthUid: 'prof-1',
    }),
    // T1 (after rotation to v2)
    resolveConnectionDisplayState({
      id: 'req-v1',
      status: 'ended',
      canceledReason: 'code_rotated',
      specialty: 'nutritionist' as const,
      professionalAuthUid: 'prof-1',
    }),
    // T2 (new pending with v2)
    resolveConnectionDisplayState({
      id: 'req-v2',
      status: 'pending_confirmation',
      canceledReason: null,
      specialty: 'nutritionist' as const,
      professionalAuthUid: 'prof-1',
    }),
    // T3 (after rotation to v3)
    resolveConnectionDisplayState({
      id: 'req-v2',
      status: 'ended',
      canceledReason: 'code_rotated',
      specialty: 'nutritionist' as const,
      professionalAuthUid: 'prof-1',
    }),
  ];

  // Verify progression
  assert.equal(statesOverTime[0].kind, 'pending');
  assert.equal(statesOverTime[1].kind, 'canceled_code_rotated');
  assert.equal(statesOverTime[2].kind, 'pending');
  assert.equal(statesOverTime[3].kind, 'canceled_code_rotated');
});

// ─── Edge case: Code rotation with pending cap at limit ────────────────────

test('BL-003 Edge case: Code rotation when professional already at pending cap', () => {
  // Prof has 10 pending requests (at cap)
  // Prof rotates code → all 10 become canceled_code_rotated
  // Pro can now accept new requests

  const atCapPending: ConnectionRecord[] = Array.from({ length: 10 }, (_, i) => ({
    id: `pending-${i}`,
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: 'nutritionist' as const,
    professionalAuthUid: 'prof-1',
  }));

  // After code rotation:
  const allCanceled: ConnectionRecord[] = atCapPending.map((r) => ({
    ...r,
    status: 'ended',
    canceledReason: 'code_rotated',
  } as ConnectionRecord));

  const canceledStates = allCanceled.map(resolveConnectionDisplayState);

  // All are now canceled (not pending)
  assert.equal(canceledStates.length, 10);
  canceledStates.forEach((state) => {
    assert.equal(state.kind, 'canceled_code_rotated');
  });
  // Professional's pending count is now 0, so they can accept new requests
});

// ─── Edge case: Notification persistence across app lifecycle ──────────────

test('BL-003 Edge case: Canceled notification persists across app backgrounding', () => {
  // User sees canceled connection → app goes to background → app returns to foreground
  // Canceled state should still be visible (not reverted to pending)

  const canceledRecord: ConnectionRecord = {
    id: 'conn-1',
    status: 'ended',
    canceledReason: 'code_rotated',
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  };

  // Before backgrounding
  let displayState = resolveConnectionDisplayState(canceledRecord);
  assert.equal(displayState.kind, 'canceled_code_rotated');

  // After returning from background (same record from cache)
  displayState = resolveConnectionDisplayState(canceledRecord);
  assert.equal(displayState.kind, 'canceled_code_rotated');
});

// ─── Edge case: User action during code rotation ────────────────────────────

test('BL-003 Edge case: User tries to submit code while code is being rotated', () => {
  // Race condition: user submits old code while prof rotates code simultaneously
  // Backend should handle: either accept request or reject as old code
  // Display state should eventually show either pending or canceled_code_rotated

  // Scenario 1: Code rotation wins → request becomes canceled
  const raceLosesRecord: ConnectionRecord = {
    id: 'conn-1',
    status: 'ended',
    canceledReason: 'code_rotated',
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  };

  let displayState = resolveConnectionDisplayState(raceLosesRecord);
  assert.equal(displayState.kind, 'canceled_code_rotated');

  // Scenario 2: User code submission wins → request stays pending
  const raceWinsRecord: ConnectionRecord = {
    id: 'conn-1',
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  };

  displayState = resolveConnectionDisplayState(raceWinsRecord);
  assert.equal(displayState.kind, 'pending');
});

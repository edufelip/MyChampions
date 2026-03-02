import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeConnectionStatus,
  normalizeCanceledReason,
  normalizeConnectionSpecialty,
  resolveConnectionDisplayState,
  normalizeInviteSubmitError,
  normalizeConnectionActionError,
  mapInviteSubmitReasonToMessageKey,
  type ConnectionRecord,
} from './connection.logic';

// --- normalizeConnectionStatus ---

test('normalizeConnectionStatus accepts valid statuses', () => {
  assert.equal(normalizeConnectionStatus('invited'), 'invited');
  assert.equal(normalizeConnectionStatus('pending_confirmation'), 'pending_confirmation');
  assert.equal(normalizeConnectionStatus('active'), 'active');
  assert.equal(normalizeConnectionStatus('ended'), 'ended');
});

test('normalizeConnectionStatus returns null for unknown values', () => {
  assert.equal(normalizeConnectionStatus(null), null);
  assert.equal(normalizeConnectionStatus(undefined), null);
  assert.equal(normalizeConnectionStatus(''), null);
  assert.equal(normalizeConnectionStatus('ACTIVE'), null);
  assert.equal(normalizeConnectionStatus(42), null);
});

// --- normalizeCanceledReason ---

test('normalizeCanceledReason returns code_rotated for matching value', () => {
  assert.equal(normalizeCanceledReason('code_rotated'), 'code_rotated');
});

test('normalizeCanceledReason returns null for any other value', () => {
  assert.equal(normalizeCanceledReason(null), null);
  assert.equal(normalizeCanceledReason(undefined), null);
  assert.equal(normalizeCanceledReason(''), null);
  assert.equal(normalizeCanceledReason('other_reason'), null);
});

// --- normalizeConnectionSpecialty ---

test('normalizeConnectionSpecialty accepts valid specialties', () => {
  assert.equal(normalizeConnectionSpecialty('nutritionist'), 'nutritionist');
  assert.equal(normalizeConnectionSpecialty('fitness_coach'), 'fitness_coach');
});

test('normalizeConnectionSpecialty returns null for unknown values', () => {
  assert.equal(normalizeConnectionSpecialty(null), null);
  assert.equal(normalizeConnectionSpecialty('doctor'), null);
  assert.equal(normalizeConnectionSpecialty('NUTRITIONIST'), null);
});

// --- resolveConnectionDisplayState ---

test('resolveConnectionDisplayState maps pending_confirmation to pending', () => {
  const record: ConnectionRecord = {
    id: 'conn-1',
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: 'nutritionist',
    professionalAuthUid: 'pro-uid',
  };

  const state = resolveConnectionDisplayState(record);
  assert.equal(state.kind, 'pending');
  assert.equal(state.connectionId, 'conn-1');
  assert.equal(state.specialty, 'nutritionist');
});

test('resolveConnectionDisplayState maps invited to pending', () => {
  const record: ConnectionRecord = {
    id: 'conn-2',
    status: 'invited',
    canceledReason: null,
    specialty: 'fitness_coach',
    professionalAuthUid: 'pro-uid',
  };

  const state = resolveConnectionDisplayState(record);
  assert.equal(state.kind, 'pending');
});

test('resolveConnectionDisplayState maps active to active', () => {
  const record: ConnectionRecord = {
    id: 'conn-3',
    status: 'active',
    canceledReason: null,
    specialty: 'nutritionist',
    professionalAuthUid: 'pro-uid',
  };

  const state = resolveConnectionDisplayState(record);
  assert.equal(state.kind, 'active');
  assert.equal(state.connectionId, 'conn-3');
});

test('resolveConnectionDisplayState maps ended with code_rotated to canceled_code_rotated', () => {
  const record: ConnectionRecord = {
    id: 'conn-4',
    status: 'ended',
    canceledReason: 'code_rotated',
    specialty: 'nutritionist',
    professionalAuthUid: 'pro-uid',
  };

  const state = resolveConnectionDisplayState(record);
  assert.equal(state.kind, 'canceled_code_rotated');
  assert.equal(state.connectionId, 'conn-4');
  assert.equal(state.specialty, 'nutritionist');
});

test('resolveConnectionDisplayState maps ended without code_rotated to ended', () => {
  const record: ConnectionRecord = {
    id: 'conn-5',
    status: 'ended',
    canceledReason: null,
    specialty: 'fitness_coach',
    professionalAuthUid: 'pro-uid',
  };

  const state = resolveConnectionDisplayState(record);
  assert.equal(state.kind, 'ended');
});

// ─── BL-003 TC-256: Pending canceled by code rotation ────────────────────────

test('BL-003 TC-256: pending request canceled by code rotation shows canceled_code_rotated state', () => {
  // Scenario: Student had pending_confirmation request, professional regenerated code
  // System marks it as ended with canceledReason='code_rotated'
  const canceledByRotation: ConnectionRecord = {
    id: 'pending-cancelled-conn',
    status: 'ended',
    canceledReason: 'code_rotated',
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-123',
  };

  const displayState = resolveConnectionDisplayState(canceledByRotation);

  // Expected: show canceled_code_rotated with red styling + reconnect CTA
  assert.equal(displayState.kind, 'canceled_code_rotated');
  assert.equal(displayState.connectionId, 'pending-cancelled-conn');
  assert.equal(displayState.specialty, 'nutritionist');
});

test('BL-003 TC-256: only code_rotated reason triggers canceled_code_rotated display', () => {
  // Verify that canceled_code_rotated is only shown for this specific reason
  const endedWithoutReason: ConnectionRecord = {
    id: 'ended-conn-1',
    status: 'ended',
    canceledReason: null,
    specialty: 'fitness_coach',
    professionalAuthUid: 'prof-123',
  };

  const displayState = resolveConnectionDisplayState(endedWithoutReason);
  assert.equal(displayState.kind, 'ended', 'null reason should map to ended, not canceled_code_rotated');
});

test('BL-003 TC-256: canceled_code_rotated preserves specialty for correct messaging', () => {
  // Verify specialty is preserved for UI to show correct professional type
  const nutritionistCanceled: ConnectionRecord = {
    id: 'nutr-canceled',
    status: 'ended',
    canceledReason: 'code_rotated',
    specialty: 'nutritionist',
    professionalAuthUid: 'prof-1',
  };

  const coachCanceled: ConnectionRecord = {
    id: 'coach-canceled',
    status: 'ended',
    canceledReason: 'code_rotated',
    specialty: 'fitness_coach',
    professionalAuthUid: 'prof-2',
  };

  const nutritionDisplay = resolveConnectionDisplayState(nutritionistCanceled);
  const coachDisplay = resolveConnectionDisplayState(coachCanceled);

  assert.equal(nutritionDisplay.specialty, 'nutritionist');
  assert.equal(coachDisplay.specialty, 'fitness_coach');
});

// --- normalizeInviteSubmitError ---

test('normalizeInviteSubmitError maps CODE_NOT_FOUND code', () => {
  assert.equal(
    normalizeInviteSubmitError({ code: 'CODE_NOT_FOUND' }),
    'code_not_found'
  );
});

test('normalizeInviteSubmitError maps message containing invite code not found', () => {
  assert.equal(
    normalizeInviteSubmitError({ message: 'Invite code not found' }),
    'code_not_found'
  );
});

test('normalizeInviteSubmitError maps CODE_EXPIRED code', () => {
  assert.equal(
    normalizeInviteSubmitError({ code: 'CODE_EXPIRED' }),
    'code_expired'
  );
});

test('normalizeInviteSubmitError maps ALREADY_CONNECTED code', () => {
  assert.equal(
    normalizeInviteSubmitError({ code: 'ALREADY_CONNECTED' }),
    'already_connected'
  );
});

test('normalizeInviteSubmitError maps PENDING_CAP_REACHED code', () => {
  assert.equal(
    normalizeInviteSubmitError({ code: 'PENDING_CAP_REACHED' }),
    'pending_cap_reached'
  );
});

test('normalizeInviteSubmitError maps message containing pending cap', () => {
  assert.equal(
    normalizeInviteSubmitError({ message: 'Pending cap reached for this professional' }),
    'pending_cap_reached'
  );
});

test('normalizeInviteSubmitError maps NETWORK_ERROR code to network', () => {
  assert.equal(
    normalizeInviteSubmitError({ code: 'NETWORK_ERROR' }),
    'network'
  );
});

test('normalizeInviteSubmitError maps config message to configuration', () => {
  assert.equal(
    normalizeInviteSubmitError({ message: 'Data Connect endpoint is not configured' }),
    'configuration'
  );
});

test('normalizeInviteSubmitError falls back to unknown', () => {
  assert.equal(normalizeInviteSubmitError({ code: 'UNRECOGNIZED' }), 'unknown');
  assert.equal(normalizeInviteSubmitError(null), 'unknown');
  assert.equal(normalizeInviteSubmitError(undefined), 'unknown');
  assert.equal(normalizeInviteSubmitError('string error'), 'unknown');
});

// --- normalizeConnectionActionError ---

test('normalizeConnectionActionError maps CONNECTION_NOT_FOUND code', () => {
  assert.equal(
    normalizeConnectionActionError({ code: 'CONNECTION_NOT_FOUND' }),
    'connection_not_found'
  );
});

test('normalizeConnectionActionError maps message containing connection not found', () => {
  assert.equal(
    normalizeConnectionActionError({ message: 'Connection not found' }),
    'connection_not_found'
  );
});

test('normalizeConnectionActionError maps INVALID_TRANSITION code', () => {
  assert.equal(
    normalizeConnectionActionError({ code: 'INVALID_TRANSITION' }),
    'invalid_transition'
  );
});

test('normalizeConnectionActionError maps message containing cannot transition', () => {
  assert.equal(
    normalizeConnectionActionError({ message: 'Cannot transition from active to pending_confirmation' }),
    'invalid_transition'
  );
});

test('normalizeConnectionActionError maps NETWORK_ERROR to network', () => {
  assert.equal(
    normalizeConnectionActionError({ code: 'NETWORK_ERROR' }),
    'network'
  );
});

test('normalizeConnectionActionError maps message containing network to network', () => {
  assert.equal(
    normalizeConnectionActionError({ message: 'network timeout occurred' }),
    'network'
  );
});

test('normalizeConnectionActionError maps message containing endpoint to configuration', () => {
  assert.equal(
    normalizeConnectionActionError({ message: 'Data Connect endpoint is not configured' }),
    'configuration'
  );
});

test('normalizeConnectionActionError maps message containing config to configuration', () => {
  assert.equal(
    normalizeConnectionActionError({ message: 'Missing config for remote call' }),
    'configuration'
  );
});

test('normalizeConnectionActionError falls back to unknown', () => {
  assert.equal(normalizeConnectionActionError({ code: 'OTHER' }), 'unknown');
  assert.equal(normalizeConnectionActionError(null), 'unknown');
});

// ─── BL-010: mapInviteSubmitReasonToMessageKey ────────────────────────────────

test('mapInviteSubmitReasonToMessageKey maps code_not_found to invalid_code key', () => {
  assert.equal(
    mapInviteSubmitReasonToMessageKey('code_not_found'),
    'relationship.error.invalid_code'
  );
});

test('mapInviteSubmitReasonToMessageKey maps code_expired to invalid_code key', () => {
  assert.equal(
    mapInviteSubmitReasonToMessageKey('code_expired'),
    'relationship.error.invalid_code'
  );
});

test('mapInviteSubmitReasonToMessageKey maps already_connected', () => {
  assert.equal(
    mapInviteSubmitReasonToMessageKey('already_connected'),
    'relationship.error.already_connected'
  );
});

test('mapInviteSubmitReasonToMessageKey maps pending_cap_reached to pending_cap key', () => {
  assert.equal(
    mapInviteSubmitReasonToMessageKey('pending_cap_reached'),
    'relationship.error.pending_cap'
  );
});

test('mapInviteSubmitReasonToMessageKey maps network', () => {
  assert.equal(
    mapInviteSubmitReasonToMessageKey('network'),
    'relationship.error.network'
  );
});

test('mapInviteSubmitReasonToMessageKey maps configuration to unknown key', () => {
  assert.equal(
    mapInviteSubmitReasonToMessageKey('configuration'),
    'relationship.error.unknown'
  );
});

test('mapInviteSubmitReasonToMessageKey maps unknown to unknown key', () => {
  assert.equal(
    mapInviteSubmitReasonToMessageKey('unknown'),
    'relationship.error.unknown'
  );
});

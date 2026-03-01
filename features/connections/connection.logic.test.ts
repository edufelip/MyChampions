import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeConnectionStatus,
  normalizeCanceledReason,
  normalizeConnectionSpecialty,
  resolveConnectionDisplayState,
  normalizeInviteSubmitError,
  normalizeConnectionActionError,
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

test('normalizeConnectionActionError falls back to unknown', () => {
  assert.equal(normalizeConnectionActionError({ code: 'OTHER' }), 'unknown');
  assert.equal(normalizeConnectionActionError(null), 'unknown');
});

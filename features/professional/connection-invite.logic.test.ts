import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PENDING_REQUESTS,
  normalizeInviteCodeStatus,
  resolveDisplayInviteCode,
  isPendingCapReached,
  normalizeInviteCodeActionError,
  type InviteCode,
} from './connection-invite.logic';

// --- normalizeInviteCodeStatus ---

test('normalizeInviteCodeStatus accepts valid statuses', () => {
  assert.equal(normalizeInviteCodeStatus('active'), 'active');
  assert.equal(normalizeInviteCodeStatus('rotated'), 'rotated');
  assert.equal(normalizeInviteCodeStatus('revoked'), 'revoked');
});

test('normalizeInviteCodeStatus returns null for unknown values', () => {
  assert.equal(normalizeInviteCodeStatus(null), null);
  assert.equal(normalizeInviteCodeStatus(undefined), null);
  assert.equal(normalizeInviteCodeStatus(''), null);
  assert.equal(normalizeInviteCodeStatus('ACTIVE'), null);
  assert.equal(normalizeInviteCodeStatus(42), null);
});

// --- resolveDisplayInviteCode ---

const activeCode: InviteCode = {
  id: 'c1',
  codeValue: 'ABC123',
  status: 'active',
  rotatedAt: null,
  expiresAt: null,
  createdAt: '2024-01-01T00:00:00Z',
};

test('resolveDisplayInviteCode returns active for an active code', () => {
  const result = resolveDisplayInviteCode(activeCode);
  assert.equal(result.kind, 'active');
  if (result.kind === 'active') {
    assert.deepEqual(result.code, activeCode);
  }
});

test('resolveDisplayInviteCode returns none for null', () => {
  assert.deepEqual(resolveDisplayInviteCode(null), { kind: 'none' });
});

test('resolveDisplayInviteCode returns none for rotated code', () => {
  const rotated: InviteCode = { ...activeCode, status: 'rotated' };
  assert.deepEqual(resolveDisplayInviteCode(rotated), { kind: 'none' });
});

test('resolveDisplayInviteCode returns none for revoked code', () => {
  const revoked: InviteCode = { ...activeCode, status: 'revoked' };
  assert.deepEqual(resolveDisplayInviteCode(revoked), { kind: 'none' });
});

// --- isPendingCapReached ---

test('isPendingCapReached returns false below cap', () => {
  assert.equal(isPendingCapReached(0), false);
  assert.equal(isPendingCapReached(MAX_PENDING_REQUESTS - 1), false);
});

test('isPendingCapReached returns true at cap', () => {
  assert.equal(isPendingCapReached(MAX_PENDING_REQUESTS), true);
});

test('isPendingCapReached returns true above cap', () => {
  assert.equal(isPendingCapReached(MAX_PENDING_REQUESTS + 5), true);
});

// --- normalizeInviteCodeActionError ---

test('normalizeInviteCodeActionError maps NOT_FOUND code', () => {
  assert.equal(normalizeInviteCodeActionError({ code: 'NOT_FOUND' }), 'not_found');
});

test('normalizeInviteCodeActionError maps not found message', () => {
  assert.equal(normalizeInviteCodeActionError({ message: 'resource not found' }), 'not_found');
});

test('normalizeInviteCodeActionError maps ALREADY_ROTATED code', () => {
  assert.equal(normalizeInviteCodeActionError({ code: 'ALREADY_ROTATED' }), 'already_rotated');
});

test('normalizeInviteCodeActionError maps already rotated message', () => {
  assert.equal(normalizeInviteCodeActionError({ message: 'already rotated' }), 'already_rotated');
});

test('normalizeInviteCodeActionError maps NETWORK_ERROR', () => {
  assert.equal(normalizeInviteCodeActionError({ code: 'NETWORK_ERROR' }), 'network');
});

test('normalizeInviteCodeActionError maps network message', () => {
  assert.equal(normalizeInviteCodeActionError({ message: 'network timeout' }), 'network');
});

test('normalizeInviteCodeActionError maps config/endpoint message to configuration', () => {
  assert.equal(normalizeInviteCodeActionError({ message: 'endpoint not configured' }), 'configuration');
  assert.equal(normalizeInviteCodeActionError({ message: 'config missing' }), 'configuration');
});

test('normalizeInviteCodeActionError returns unknown for unrecognized error', () => {
  assert.equal(normalizeInviteCodeActionError(null), 'unknown');
  assert.equal(normalizeInviteCodeActionError('boom'), 'unknown');
  assert.equal(normalizeInviteCodeActionError({ message: 'something else' }), 'unknown');
});

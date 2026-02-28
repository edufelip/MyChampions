import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapSignInReasonToMessageKey,
  normalizeSignInReason,
  SignInFailure,
  validateSignInInput,
} from './sign-in.logic';

test('validateSignInInput returns field errors for empty values', () => {
  const result = validateSignInInput({ email: '  ', password: '' });

  assert.equal(result.email, 'auth.validation.email_required');
  assert.equal(result.password, 'auth.validation.password_required');
});

test('validateSignInInput passes when both fields are provided', () => {
  const result = validateSignInInput({ email: 'user@example.com', password: 'secret123' });

  assert.deepEqual(result, {});
});

test('normalizeSignInReason maps SignInFailure directly', () => {
  const reason = normalizeSignInReason(new SignInFailure('invalid_credentials'));

  assert.equal(reason, 'invalid_credentials');
});

test('normalizeSignInReason maps network-like errors', () => {
  const reason = normalizeSignInReason({ code: 'NETWORK_ERROR', message: 'Fetch failed' });

  assert.equal(reason, 'network');
});

test('normalizeSignInReason falls back to unknown', () => {
  const reason = normalizeSignInReason({ code: 'SOMETHING_ELSE' });

  assert.equal(reason, 'unknown');
});

test('mapSignInReasonToMessageKey returns contextual key', () => {
  assert.equal(
    mapSignInReasonToMessageKey('invalid_credentials'),
    'auth.signin.error.invalid_credentials'
  );
  assert.equal(mapSignInReasonToMessageKey('network'), 'auth.signin.error.network');
  assert.equal(mapSignInReasonToMessageKey('unknown'), 'common.error.generic');
});

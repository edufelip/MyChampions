import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CreateAccountFailure,
  hasEmoji,
  isPasswordPolicySatisfied,
  mapCreateAccountReasonToMessageKey,
  normalizeCreateAccountReason,
  validateCreateAccountInput,
} from './create-account.logic';

test('validateCreateAccountInput returns required-field errors', () => {
  const result = validateCreateAccountInput({
    name: '   ',
    email: ' ',
    password: '',
    passwordConfirmation: '',
  });

  assert.equal(result.name, 'auth.validation.name_required');
  assert.equal(result.email, 'auth.validation.email_required');
  assert.equal(result.password, 'auth.validation.password_required');
  assert.equal(result.passwordConfirmation, 'auth.validation.password_confirmation_required');
});

test('validateCreateAccountInput enforces password policy', () => {
  const result = validateCreateAccountInput({
    name: 'Eduardo',
    email: 'edu@example.com',
    password: 'weakpass',
    passwordConfirmation: 'weakpass',
  });

  assert.equal(result.password, 'auth.validation.password_policy');
});

test('validateCreateAccountInput enforces password confirmation match', () => {
  const result = validateCreateAccountInput({
    name: 'Eduardo',
    email: 'edu@example.com',
    password: 'Strong!123',
    passwordConfirmation: 'Strong!124',
  });

  assert.equal(result.passwordConfirmation, 'auth.validation.password_confirmation_mismatch');
});

test('validateCreateAccountInput passes with valid values', () => {
  const result = validateCreateAccountInput({
    name: 'Eduardo',
    email: 'edu@example.com',
    password: 'Strong!123',
    passwordConfirmation: 'Strong!123',
  });

  assert.deepEqual(result, {});
});

test('isPasswordPolicySatisfied requires ASCII punctuation for special character', () => {
  assert.equal(isPasswordPolicySatisfied('Abcdef1¡'), false);
  assert.equal(isPasswordPolicySatisfied('Abcdef1!'), true);
});

test('isPasswordPolicySatisfied rejects emoji in password', () => {
  assert.equal(isPasswordPolicySatisfied('Abcdef1!🙂'), false);
  assert.equal(hasEmoji('Abcdef1!🙂'), true);
});

test('normalizeCreateAccountReason maps CreateAccountFailure directly', () => {
  const reason = normalizeCreateAccountReason(new CreateAccountFailure('duplicate_email'));

  assert.equal(reason, 'duplicate_email');
});

test('normalizeCreateAccountReason maps duplicate-email backend hints', () => {
  const reason = normalizeCreateAccountReason({
    code: 'USER_ALREADY_EXISTS',
    message: 'email already in use',
  });

  assert.equal(reason, 'duplicate_email');
});

test('normalizeCreateAccountReason maps network hints', () => {
  const reason = normalizeCreateAccountReason({ code: 'NETWORK_ERROR', message: 'Fetch failed' });

  assert.equal(reason, 'network');
});

test('normalizeCreateAccountReason maps provider conflict', () => {
  const reason = normalizeCreateAccountReason({
    code: 'auth/account-exists-with-different-credential',
  });

  assert.equal(reason, 'provider_conflict');
});

test('normalizeCreateAccountReason maps missing config to configuration', () => {
  const reason = normalizeCreateAccountReason({
    message: 'Firebase config is missing required keys: projectId',
  });

  assert.equal(reason, 'configuration');
});

test('normalizeCreateAccountReason falls back to unknown', () => {
  const reason = normalizeCreateAccountReason({ code: 'SOMETHING_ELSE' });

  assert.equal(reason, 'unknown');
});

test('mapCreateAccountReasonToMessageKey returns contextual key', () => {
  assert.equal(
    mapCreateAccountReasonToMessageKey('duplicate_email'),
    'auth.signup.error.duplicate_email'
  );
  assert.equal(mapCreateAccountReasonToMessageKey('network'), 'auth.signup.error.network');
  assert.equal(
    mapCreateAccountReasonToMessageKey('provider_conflict'),
    'auth.signup.error.provider_conflict'
  );
  assert.equal(mapCreateAccountReasonToMessageKey('configuration'), 'auth.signup.error.configuration');
  assert.equal(mapCreateAccountReasonToMessageKey('unknown'), 'common.error.generic');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CreateAccountFailure,
  hasEmoji,
  isPasswordPolicySatisfied,
  mapCreateAccountReasonToMessageKey,
  normalizeCreateAccountReason,
  resolveCreateAccountValidationAnalyticsReason,
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

test('resolveCreateAccountValidationAnalyticsReason returns the first validation failure reason', () => {
  assert.equal(
    resolveCreateAccountValidationAnalyticsReason({
      name: 'auth.validation.name_required',
      email: 'auth.validation.email_required',
      password: 'auth.validation.password_required',
      passwordConfirmation: 'auth.validation.password_confirmation_required',
    }),
    'validation_name_required',
  );
  assert.equal(
    resolveCreateAccountValidationAnalyticsReason({
      password: 'auth.validation.password_policy',
    }),
    'validation_password_policy',
  );
  assert.equal(
    resolveCreateAccountValidationAnalyticsReason({
      passwordConfirmation: 'auth.validation.password_confirmation_mismatch',
    }),
    'validation_password_confirmation_mismatch',
  );
});

test('resolveCreateAccountValidationAnalyticsReason returns null when there are no validation errors', () => {
  assert.equal(resolveCreateAccountValidationAnalyticsReason({}), null);
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
  const reason = normalizeCreateAccountReason(new CreateAccountFailure('requires_sign_in'));

  assert.equal(reason, 'requires_sign_in');
});

test('normalizeCreateAccountReason does not infer duplicate-email from backend hints (ET-75)', () => {
  // The server no longer reveals "this email is already registered" in any
  // response shape (ET-75), so generic error payloads that happen to mention
  // "already in use" must not be reinterpreted as a duplicate-email signal —
  // there is no such reason left to map to. They fall through to 'unknown'.
  const reason = normalizeCreateAccountReason({
    code: 'USER_ALREADY_EXISTS',
    message: 'email already in use',
  });

  assert.equal(reason, 'unknown');
});

test('normalizeCreateAccountReason maps network hints', () => {
  const reason = normalizeCreateAccountReason({ code: 'NETWORK_ERROR', message: 'Fetch failed' });

  assert.equal(reason, 'network');
});

test('normalizeCreateAccountReason maps provider conflict', () => {
  const reason = normalizeCreateAccountReason({
    code: 'PROVIDER_CONFLICT',
  });

  assert.equal(reason, 'provider_conflict');
});

test('normalizeCreateAccountReason maps missing config to configuration', () => {
  const reason = normalizeCreateAccountReason({
    message: 'MyChampions server URL is not configured.',
  });

  assert.equal(reason, 'configuration');
});

test('normalizeCreateAccountReason falls back to unknown', () => {
  const reason = normalizeCreateAccountReason({ code: 'SOMETHING_ELSE' });

  assert.equal(reason, 'unknown');
});

test('mapCreateAccountReasonToMessageKey returns contextual key', () => {
  assert.equal(
    mapCreateAccountReasonToMessageKey('requires_sign_in'),
    'auth.signup.error.requires_sign_in',
  );
  assert.equal(mapCreateAccountReasonToMessageKey('network'), 'auth.signup.error.network');
  assert.equal(
    mapCreateAccountReasonToMessageKey('provider_conflict'),
    'auth.signup.error.provider_conflict',
  );
  assert.equal(
    mapCreateAccountReasonToMessageKey('configuration'),
    'auth.signup.error.configuration',
  );
  assert.equal(mapCreateAccountReasonToMessageKey('unknown'), 'common.error.generic');
});

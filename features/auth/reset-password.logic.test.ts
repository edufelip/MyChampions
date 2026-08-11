import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ResetPasswordConfirmFailure,
  mapResetPasswordReasonToMessageKey,
  normalizeResetPasswordReason,
  validateResetPasswordInput,
} from './reset-password.logic';

describe('reset-password.logic', () => {
  describe('validateResetPasswordInput', () => {
    it('requires email, token, and a policy-satisfying password confirmation', () => {
      const errors = validateResetPasswordInput({
        email: '',
        token: '',
        newPassword: '',
        newPasswordConfirmation: '',
      });

      assert.equal(errors.email, 'auth.validation.email_required');
      assert.equal(errors.token, 'auth.reset_password.validation.token_required');
      assert.equal(errors.newPassword, 'auth.validation.password_required');
      assert.equal(
        errors.newPasswordConfirmation,
        'auth.validation.password_confirmation_required',
      );
    });

    it('rejects a new password that fails the policy', () => {
      const errors = validateResetPasswordInput({
        email: 'user@example.test',
        token: 'reset-token',
        newPassword: 'weak',
        newPasswordConfirmation: 'weak',
      });

      assert.equal(errors.newPassword, 'auth.validation.password_policy');
    });

    it('rejects a mismatched confirmation', () => {
      const errors = validateResetPasswordInput({
        email: 'user@example.test',
        token: 'reset-token',
        newPassword: 'Str0ng!Pass',
        newPasswordConfirmation: 'Different1!',
      });

      assert.equal(
        errors.newPasswordConfirmation,
        'auth.validation.password_confirmation_mismatch',
      );
    });

    it('accepts a fully valid submission', () => {
      const errors = validateResetPasswordInput({
        email: 'user@example.test',
        token: 'reset-token',
        newPassword: 'Str0ng!Pass',
        newPasswordConfirmation: 'Str0ng!Pass',
      });

      assert.deepEqual(errors, {});
    });
  });

  describe('normalizeResetPasswordReason', () => {
    it('reads the reason straight off a ResetPasswordConfirmFailure', () => {
      const failure = new ResetPasswordConfirmFailure('invalid_or_expired_token');
      assert.equal(normalizeResetPasswordReason(failure), 'invalid_or_expired_token');
    });

    it('falls back to unknown for an unrecognized error', () => {
      assert.equal(normalizeResetPasswordReason(new Error('boom')), 'unknown');
      assert.equal(normalizeResetPasswordReason('not an error'), 'unknown');
    });
  });

  describe('mapResetPasswordReasonToMessageKey', () => {
    it('maps every known reason to a distinct message key', () => {
      assert.equal(
        mapResetPasswordReasonToMessageKey('invalid_or_expired_token'),
        'auth.reset_password.error.invalid_or_expired_token',
      );
      assert.equal(
        mapResetPasswordReasonToMessageKey('invalid_email'),
        'auth.reset_password.error.invalid_email',
      );
      assert.equal(
        mapResetPasswordReasonToMessageKey('account_not_found'),
        'auth.reset_password.error.account_not_found',
      );
      assert.equal(
        mapResetPasswordReasonToMessageKey('network'),
        'auth.reset_password.error.network',
      );
      assert.equal(
        mapResetPasswordReasonToMessageKey('configuration'),
        'auth.reset_password.error.configuration',
      );
      assert.equal(mapResetPasswordReasonToMessageKey('unknown'), 'common.error.generic');
    });
  });
});

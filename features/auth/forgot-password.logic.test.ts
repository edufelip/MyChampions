import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidEmailFormat, validateForgotPasswordEmail } from './forgot-password.logic';

describe('forgot-password.logic', () => {
  describe('isValidEmailFormat', () => {
    it('accepts a well-formed email', () => {
      assert.equal(isValidEmailFormat('user@example.test'), true);
    });

    it('rejects an address missing a domain', () => {
      assert.equal(isValidEmailFormat('user@'), false);
    });

    it('rejects an address with no @', () => {
      assert.equal(isValidEmailFormat('user.example.test'), false);
    });

    it('rejects an address with whitespace', () => {
      assert.equal(isValidEmailFormat('user @example.test'), false);
    });
  });

  describe('validateForgotPasswordEmail', () => {
    it('flags an empty email as required', () => {
      assert.equal(validateForgotPasswordEmail(''), 'auth.validation.email_required');
      assert.equal(validateForgotPasswordEmail('   '), 'auth.validation.email_required');
    });

    it('flags a malformed email as invalid', () => {
      assert.equal(validateForgotPasswordEmail('user@'), 'auth.validation.email_invalid');
    });

    it('accepts a well-formed email', () => {
      assert.equal(validateForgotPasswordEmail('user@example.test'), null);
    });
  });
});

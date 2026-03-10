import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSupportInput } from './support.logic';

describe('Support Logic', () => {
  it('should return subject_required for empty subject', () => {
    assert.strictEqual(validateSupportInput({ subject: '', body: 'Valid body' }), 'subject_required');
    assert.strictEqual(validateSupportInput({ subject: '   ', body: 'Valid body' }), 'subject_required');
  });

  it('should return subject_too_long for subjects > 50 chars', () => {
    const longSubject = 'a'.repeat(51);
    assert.strictEqual(validateSupportInput({ subject: longSubject, body: 'Valid body' }), 'subject_too_long');
  });

  it('should return body_required for empty body', () => {
    assert.strictEqual(validateSupportInput({ subject: 'Valid subject', body: '' }), 'body_required');
    assert.strictEqual(validateSupportInput({ subject: 'Valid subject', body: '   ' }), 'body_required');
  });

  it('should return body_too_long for bodies > 500 chars', () => {
    const longBody = 'a'.repeat(501);
    assert.strictEqual(validateSupportInput({ subject: 'Valid subject', body: longBody }), 'body_too_long');
  });

  it('should return null for valid input', () => {
    assert.strictEqual(validateSupportInput({ subject: 'Issue with login', body: 'I cannot sign in with Google.' }), null);
  });

  it('should account for trimming in length checks', () => {
    const fiftyChars = 'a'.repeat(50);
    assert.strictEqual(validateSupportInput({ subject: `  ${fiftyChars}  `, body: 'Valid body' }), null);
    
    const fiftyOneChars = 'a'.repeat(51);
    assert.strictEqual(validateSupportInput({ subject: `  ${fiftyOneChars}  `, body: 'Valid body' }), 'subject_too_long');
  });
});

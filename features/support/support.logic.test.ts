import { validateSupportInput } from './support.logic';

describe('Support Logic', () => {
  it('should return subject_required for empty subject', () => {
    expect(validateSupportInput({ subject: '', body: 'Valid body' })).toBe('subject_required');
    expect(validateSupportInput({ subject: '   ', body: 'Valid body' })).toBe('subject_required');
  });

  it('should return subject_too_long for subjects > 50 chars', () => {
    const longSubject = 'a'.repeat(51);
    expect(validateSupportInput({ subject: longSubject, body: 'Valid body' })).toBe('subject_too_long');
  });

  it('should return body_required for empty body', () => {
    expect(validateSupportInput({ subject: 'Valid subject', body: '' })).toBe('body_required');
    expect(validateSupportInput({ subject: 'Valid subject', body: '   ' })).toBe('body_required');
  });

  it('should return body_too_long for bodies > 500 chars', () => {
    const longBody = 'a'.repeat(501);
    expect(validateSupportInput({ subject: 'Valid subject', body: longBody })).toBe('body_too_long');
  });

  it('should return null for valid input', () => {
    expect(validateSupportInput({ subject: 'Issue with login', body: 'I cannot sign in with Google.' })).toBeNull();
  });

  it('should account for trimming in length checks', () => {
    // 50 chars + spaces should still be subject_too_long if the trimmed version is still too long (logic trims first)
    // Wait, the logic currently does: if (input.subject.trim().length > 50) return 'subject_too_long';
    const fiftyChars = 'a'.repeat(50);
    expect(validateSupportInput({ subject: `  ${fiftyChars}  `, body: 'Valid body' })).toBeNull();
    
    const fiftyOneChars = 'a'.repeat(51);
    expect(validateSupportInput({ subject: `  ${fiftyOneChars}  `, body: 'Valid body' })).toBe('subject_too_long');
  });
});

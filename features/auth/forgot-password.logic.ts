const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ForgotPasswordEmailErrorKey =
  'auth.validation.email_required' | 'auth.validation.email_invalid';

/**
 * Minimal shape check shared by any screen that needs to reject an obviously
 * malformed email before hitting the (enumeration-resistant, always-succeeds)
 * password-reset request endpoint.
 */
export function isValidEmailFormat(email: string): boolean {
  return EMAIL_FORMAT_PATTERN.test(email);
}

export function validateForgotPasswordEmail(email: string): ForgotPasswordEmailErrorKey | null {
  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return 'auth.validation.email_required';
  }

  if (!isValidEmailFormat(trimmed)) {
    return 'auth.validation.email_invalid';
  }

  return null;
}

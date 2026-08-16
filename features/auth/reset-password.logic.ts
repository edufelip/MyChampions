import { isPasswordPolicySatisfied } from './create-account.logic';
import { isValidEmailFormat } from './forgot-password.logic';

export type ResetPasswordConfirmErrorReason =
  | 'invalid_or_expired_token'
  | 'invalid_email'
  | 'account_not_found'
  | 'network'
  | 'configuration'
  | 'unknown';

export type ResetPasswordRequest = {
  email: string;
  token: string;
  newPassword: string;
  newPasswordConfirmation: string;
};

export type ResetPasswordValidationErrors = {
  email?: 'auth.validation.email_required' | 'auth.validation.email_invalid';
  token?: 'auth.reset_password.validation.token_required';
  newPassword?: 'auth.validation.password_required' | 'auth.validation.password_policy';
  newPasswordConfirmation?:
    | 'auth.validation.password_confirmation_required'
    | 'auth.validation.password_confirmation_mismatch';
};

export type ResetPasswordErrorMessageKey =
  | 'auth.reset_password.error.invalid_or_expired_token'
  | 'auth.reset_password.error.invalid_email'
  | 'auth.reset_password.error.account_not_found'
  | 'auth.reset_password.error.network'
  | 'auth.reset_password.error.configuration'
  | 'common.error.generic';

export class ResetPasswordConfirmFailure extends Error {
  readonly reason: ResetPasswordConfirmErrorReason;

  constructor(reason: ResetPasswordConfirmErrorReason) {
    super(reason);
    this.name = 'ResetPasswordConfirmFailure';
    this.reason = reason;
  }
}

export function validateResetPasswordInput(
  input: ResetPasswordRequest,
): ResetPasswordValidationErrors {
  const errors: ResetPasswordValidationErrors = {};

  const trimmedEmail = input.email.trim();
  if (trimmedEmail.length === 0) {
    errors.email = 'auth.validation.email_required';
  } else if (!isValidEmailFormat(trimmedEmail)) {
    errors.email = 'auth.validation.email_invalid';
  }

  if (input.token.trim().length === 0) {
    errors.token = 'auth.reset_password.validation.token_required';
  }

  if (input.newPassword.trim().length === 0) {
    errors.newPassword = 'auth.validation.password_required';
  } else if (!isPasswordPolicySatisfied(input.newPassword)) {
    errors.newPassword = 'auth.validation.password_policy';
  }

  if (input.newPasswordConfirmation.trim().length === 0) {
    errors.newPasswordConfirmation = 'auth.validation.password_confirmation_required';
  } else if (input.newPassword !== input.newPasswordConfirmation) {
    errors.newPasswordConfirmation = 'auth.validation.password_confirmation_mismatch';
  }

  return errors;
}

export function normalizeResetPasswordReason(error: unknown): ResetPasswordConfirmErrorReason {
  if (error instanceof ResetPasswordConfirmFailure) {
    return error.reason;
  }

  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }

  const maybeError = error as { code?: unknown; message?: unknown };
  const code = typeof maybeError.code === 'string' ? maybeError.code.toLowerCase() : '';
  const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';

  if (code.includes('invalid_or_expired_token') || message.includes('invalid or expired')) {
    return 'invalid_or_expired_token';
  }

  if (code.includes('invalid_email') || message.includes('email is invalid')) {
    return 'invalid_email';
  }

  if (code.includes('account_not_found') || message.includes('no local email/password account')) {
    return 'account_not_found';
  }

  if (
    code.includes('configuration') ||
    code.includes('missing_config') ||
    code.includes('server_not_configured') ||
    message.includes('not configured') ||
    message.includes('missing config')
  ) {
    return 'configuration';
  }

  if (
    code.includes('network') ||
    code.includes('timeout') ||
    message.includes('network') ||
    message.includes('fetch')
  ) {
    return 'network';
  }

  return 'unknown';
}

export function mapResetPasswordReasonToMessageKey(
  reason: ResetPasswordConfirmErrorReason,
): ResetPasswordErrorMessageKey {
  if (reason === 'invalid_or_expired_token') {
    return 'auth.reset_password.error.invalid_or_expired_token';
  }

  if (reason === 'invalid_email') {
    return 'auth.reset_password.error.invalid_email';
  }

  if (reason === 'account_not_found') {
    return 'auth.reset_password.error.account_not_found';
  }

  if (reason === 'network') {
    return 'auth.reset_password.error.network';
  }

  if (reason === 'configuration') {
    return 'auth.reset_password.error.configuration';
  }

  return 'common.error.generic';
}

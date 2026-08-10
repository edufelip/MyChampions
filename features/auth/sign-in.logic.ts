export type SignInErrorReason =
  'invalid_credentials' | 'network' | 'provider_conflict' | 'configuration' | 'unknown';

export type SignInRequest = {
  email: string;
  password: string;
};

export type SignInValidationErrors = {
  email?: 'auth.validation.email_required';
  password?: 'auth.validation.password_required';
};

export type SignInValidationAnalyticsReason =
  'validation_email_required' | 'validation_password_required';

export type SignInErrorMessageKey =
  | 'auth.signin.error.invalid_credentials'
  | 'auth.signin.error.network'
  | 'auth.signin.error.provider_conflict'
  | 'auth.signin.error.configuration'
  | 'common.error.generic';

export class SignInFailure extends Error {
  readonly reason: SignInErrorReason;

  constructor(reason: SignInErrorReason) {
    super(reason);
    this.name = 'SignInFailure';
    this.reason = reason;
  }
}

export function validateSignInInput(input: SignInRequest): SignInValidationErrors {
  const errors: SignInValidationErrors = {};

  if (input.email.trim().length === 0) {
    errors.email = 'auth.validation.email_required';
  }

  if (input.password.trim().length === 0) {
    errors.password = 'auth.validation.password_required';
  }

  return errors;
}

export function resolveSignInValidationAnalyticsReason(
  errors: SignInValidationErrors,
): SignInValidationAnalyticsReason | null {
  if (errors.email) {
    return 'validation_email_required';
  }

  if (errors.password) {
    return 'validation_password_required';
  }

  return null;
}

export function normalizeSignInReason(error: unknown): SignInErrorReason {
  if (error instanceof SignInFailure) {
    return error.reason;
  }

  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }

  const maybeError = error as { code?: unknown; message?: unknown };
  const code = typeof maybeError.code === 'string' ? maybeError.code.toLowerCase() : '';
  const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';

  if (
    code.includes('invalid_credentials') ||
    code.includes('invalid-login') ||
    code.includes('invalid_login') ||
    message.includes('invalid credentials')
  ) {
    return 'invalid_credentials';
  }

  if (
    code.includes('provider_conflict') ||
    code.includes('provider-conflict') ||
    message.includes('provider conflict') ||
    message.includes('different provider')
  ) {
    return 'provider_conflict';
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

export function mapSignInReasonToMessageKey(reason: SignInErrorReason): SignInErrorMessageKey {
  if (reason === 'invalid_credentials') {
    return 'auth.signin.error.invalid_credentials';
  }

  if (reason === 'network') {
    return 'auth.signin.error.network';
  }

  if (reason === 'provider_conflict') {
    return 'auth.signin.error.provider_conflict';
  }

  if (reason === 'configuration') {
    return 'auth.signin.error.configuration';
  }

  return 'common.error.generic';
}

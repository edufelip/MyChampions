export type SignInErrorReason = 'invalid_credentials' | 'network' | 'unknown';

export type SignInRequest = {
  email: string;
  password: string;
};

export type SignInValidationErrors = {
  email?: 'auth.validation.email_required';
  password?: 'auth.validation.password_required';
};

export type SignInErrorMessageKey =
  | 'auth.signin.error.invalid_credentials'
  | 'auth.signin.error.network'
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
    code.includes('invalid_login') ||
    message.includes('invalid credentials')
  ) {
    return 'invalid_credentials';
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

  return 'common.error.generic';
}

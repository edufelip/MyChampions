const ASCII_PUNCTUATION_REGEX = /[!-/:-@[-`{-~]/;
const UPPERCASE_REGEX = /[A-Z]/;
const NUMBER_REGEX = /[0-9]/;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

export type CreateAccountErrorReason =
  | 'duplicate_email'
  | 'network'
  | 'provider_conflict'
  | 'configuration'
  | 'unknown';

export type CreateAccountRequest = {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
};

export type CreateAccountValidationErrors = {
  name?: 'auth.validation.name_required';
  email?: 'auth.validation.email_required';
  password?: 'auth.validation.password_required' | 'auth.validation.password_policy';
  passwordConfirmation?:
    | 'auth.validation.password_confirmation_required'
    | 'auth.validation.password_confirmation_mismatch';
};

export type CreateAccountErrorMessageKey =
  | 'auth.signup.error.duplicate_email'
  | 'auth.signup.error.network'
  | 'auth.signup.error.provider_conflict'
  | 'auth.signup.error.configuration'
  | 'common.error.generic';

export class CreateAccountFailure extends Error {
  readonly reason: CreateAccountErrorReason;

  constructor(reason: CreateAccountErrorReason) {
    super(reason);
    this.name = 'CreateAccountFailure';
    this.reason = reason;
  }
}

export function hasEmoji(input: string): boolean {
  return EMOJI_REGEX.test(input);
}

export function isPasswordPolicySatisfied(password: string): boolean {
  if (password.length < 8) {
    return false;
  }

  if (!UPPERCASE_REGEX.test(password)) {
    return false;
  }

  if (!NUMBER_REGEX.test(password)) {
    return false;
  }

  if (!ASCII_PUNCTUATION_REGEX.test(password)) {
    return false;
  }

  if (hasEmoji(password)) {
    return false;
  }

  return true;
}

export function validateCreateAccountInput(
  input: CreateAccountRequest
): CreateAccountValidationErrors {
  const errors: CreateAccountValidationErrors = {};

  if (input.name.trim().length === 0) {
    errors.name = 'auth.validation.name_required';
  }

  if (input.email.trim().length === 0) {
    errors.email = 'auth.validation.email_required';
  }

  if (input.password.trim().length === 0) {
    errors.password = 'auth.validation.password_required';
  } else if (!isPasswordPolicySatisfied(input.password)) {
    errors.password = 'auth.validation.password_policy';
  }

  if (input.passwordConfirmation.trim().length === 0) {
    errors.passwordConfirmation = 'auth.validation.password_confirmation_required';
  } else if (input.password !== input.passwordConfirmation) {
    errors.passwordConfirmation = 'auth.validation.password_confirmation_mismatch';
  }

  return errors;
}

export function normalizeCreateAccountReason(error: unknown): CreateAccountErrorReason {
  if (error instanceof CreateAccountFailure) {
    return error.reason;
  }

  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }

  const maybeError = error as { code?: unknown; message?: unknown };
  const code = typeof maybeError.code === 'string' ? maybeError.code.toLowerCase() : '';
  const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';

  if (
    code.includes('duplicate') ||
    code.includes('already-in-use') ||
    code.includes('already_exists') ||
    code.includes('already_registered') ||
    code.includes('email_taken') ||
    message.includes('already registered') ||
    message.includes('already in use')
  ) {
    return 'duplicate_email';
  }

  if (code.includes('account-exists-with-different-credential')) {
    return 'provider_conflict';
  }

  if (
    code.includes('missing required keys') ||
    code.includes('invalid-api-key') ||
    message.includes('missing required keys') ||
    message.includes('invalid api key')
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

export function mapCreateAccountReasonToMessageKey(
  reason: CreateAccountErrorReason
): CreateAccountErrorMessageKey {
  if (reason === 'duplicate_email') {
    return 'auth.signup.error.duplicate_email';
  }

  if (reason === 'network') {
    return 'auth.signup.error.network';
  }

  if (reason === 'provider_conflict') {
    return 'auth.signup.error.provider_conflict';
  }

  if (reason === 'configuration') {
    return 'auth.signup.error.configuration';
  }

  return 'common.error.generic';
}

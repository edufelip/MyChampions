import {
  isSafeInstanceOf,
  readBoundedString,
  readOwnField,
} from '@/features/errors/read-error-fields';

const ASCII_PUNCTUATION_REGEX = /[!-/:-@[-`{-~]/;
const UPPERCASE_REGEX = /[A-Z]/;
const NUMBER_REGEX = /[0-9]/;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

export type CreateAccountErrorReason =
  'requires_sign_in' | 'network' | 'provider_conflict' | 'configuration' | 'unknown';

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

export type CreateAccountValidationAnalyticsReason =
  | 'validation_name_required'
  | 'validation_email_required'
  | 'validation_password_required'
  | 'validation_password_policy'
  | 'validation_password_confirmation_required'
  | 'validation_password_confirmation_mismatch';

export type CreateAccountErrorMessageKey =
  | 'auth.signup.error.requires_sign_in'
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
  input: CreateAccountRequest,
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

export function resolveCreateAccountValidationAnalyticsReason(
  errors: CreateAccountValidationErrors,
): CreateAccountValidationAnalyticsReason | null {
  if (errors.name) {
    return 'validation_name_required';
  }

  if (errors.email) {
    return 'validation_email_required';
  }

  if (errors.password === 'auth.validation.password_required') {
    return 'validation_password_required';
  }

  if (errors.password === 'auth.validation.password_policy') {
    return 'validation_password_policy';
  }

  if (errors.passwordConfirmation === 'auth.validation.password_confirmation_required') {
    return 'validation_password_confirmation_required';
  }

  if (errors.passwordConfirmation === 'auth.validation.password_confirmation_mismatch') {
    return 'validation_password_confirmation_mismatch';
  }

  return null;
}

export function normalizeCreateAccountReason(error: unknown): CreateAccountErrorReason {
  if (isSafeInstanceOf(error, CreateAccountFailure)) {
    return isCreateAccountErrorReason(error.reason) ? error.reason : 'unknown';
  }

  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }

  const codeField = readOwnField(error, 'code');
  if (!codeField.readable) return 'unknown';
  const rawCode = readBoundedString(codeField.value);
  if (rawCode === null) return 'unknown';

  // Only the producer's short ASCII aliases are a machine contract.  This
  // lowercases ASCII A-Z for compatibility with the existing wire adapter;
  // diagnostic prose is deliberately ignored.
  const code = rawCode.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

  // Deliberately no "duplicate email"/"already registered" detection here (ET-75):
  // the server no longer reveals whether an email was already registered, so this
  // reason is only ever produced explicitly by createAccountWithEmailPasswordFromSource
  // (as 'requires_sign_in') when it cannot establish a session after signup.

  if (code === 'provider_conflict' || code === 'provider-conflict') {
    return 'provider_conflict';
  }

  if (code === 'configuration' || code === 'missing_config' || code === 'server_not_configured') {
    return 'configuration';
  }

  if (code === 'network' || code === 'network_error' || code === 'timeout') {
    return 'network';
  }

  return 'unknown';
}

function isCreateAccountErrorReason(value: unknown): value is CreateAccountErrorReason {
  return (
    value === 'requires_sign_in' ||
    value === 'network' ||
    value === 'provider_conflict' ||
    value === 'configuration' ||
    value === 'unknown'
  );
}

export function mapCreateAccountReasonToMessageKey(
  reason: CreateAccountErrorReason,
): CreateAccountErrorMessageKey {
  if (reason === 'requires_sign_in') {
    return 'auth.signup.error.requires_sign_in';
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

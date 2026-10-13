import { readBoundedString, readOwnField, isSafeRecord } from '@/features/errors/read-error-fields';

export type SubscriptionErrorReason =
  | 'configuration'
  | 'network'
  | 'purchase_cancelled'
  | 'payment_pending'
  | 'store_problem'
  | 'unauthenticated'
  | 'unknown';

export function isSubscriptionErrorReason(value: unknown): value is SubscriptionErrorReason {
  return (
    value === 'configuration' ||
    value === 'network' ||
    value === 'purchase_cancelled' ||
    value === 'payment_pending' ||
    value === 'store_problem' ||
    value === 'unauthenticated' ||
    value === 'unknown'
  );
}

/**
 * RevenueCat react-native-purchases 9.15.2 / purchases-typescript-internal
 * 17.55.1 public enum policy.  Keep this table explicit so new SDK values
 * fail closed until they receive a deliberate product classification.
 */
export const REVENUECAT_ERROR_CODE_REASON: Readonly<Record<string, SubscriptionErrorReason>> = {
  '1': 'purchase_cancelled',
  '2': 'store_problem',
  '3': 'store_problem',
  '4': 'store_problem',
  '5': 'store_problem',
  '6': 'store_problem',
  '7': 'store_problem',
  '8': 'store_problem',
  '9': 'store_problem',
  '10': 'network',
  '11': 'configuration',
  '13': 'store_problem',
  '14': 'configuration',
  '17': 'configuration',
  '19': 'unauthenticated',
  '20': 'payment_pending',
  '23': 'configuration',
  '32': 'network',
  '35': 'network',
};

const REVENUECAT_READABLE_ALIAS_REASON: Readonly<Record<string, SubscriptionErrorReason>> = {
  purchase_cancelled: 'purchase_cancelled',
  purchase_canceled: 'purchase_cancelled',
  payment_pending: 'payment_pending',
  network_error: 'network',
  configuration_error: 'configuration',
  invalid_api_key: 'configuration',
  store_problem: 'store_problem',
  store_transaction_unverified: 'store_problem',
  unauthorized: 'unauthenticated',

  // Exact lower-case enum names emitted by readableErrorCode.
  unknown_error: 'unknown',
  purchase_cancelled_error: 'purchase_cancelled',
  store_problem_error: 'store_problem',
  purchase_not_allowed_error: 'store_problem',
  purchase_invalid_error: 'store_problem',
  product_not_available_for_purchase_error: 'store_problem',
  product_already_purchased_error: 'store_problem',
  receipt_already_in_use_error: 'store_problem',
  invalid_receipt_error: 'store_problem',
  missing_receipt_file_error: 'store_problem',
  invalid_credentials_error: 'configuration',
  unexpected_backend_response_error: 'unknown',
  receipt_in_use_by_other_subscriber_error: 'store_problem',
  invalid_app_user_id_error: 'configuration',
  operation_already_in_progress_error: 'unknown',
  unknown_backend_error: 'unknown',
  invalid_apple_subscription_key_error: 'configuration',
  ineligible_error: 'unknown',
  payment_pending_error: 'payment_pending',
  invalid_subscriber_attributes_error: 'unknown',
  log_out_anonymous_user_error: 'unknown',
  unsupported_error: 'unknown',
  empty_subscriber_attributes_error: 'unknown',
  product_discount_missing_identifier_error: 'unknown',
  product_discount_missing_subscription_group_identifier_error: 'unknown',
  customer_info_error: 'unknown',
  system_info_error: 'unknown',
  begin_refund_request_error: 'unknown',
  product_request_timed_out_error: 'network',
  api_endpoint_blocked: 'unknown',
  invalid_promotional_offer_error: 'unknown',
  offline_connection_error: 'network',
  test_store_simulated_purchase_error: 'unknown',
  insufficient_permissions_error: 'unauthenticated',
};

/** Map a public SDK enum value after it has passed strict code-shape checks. */
export function mapRevenueCatCode(value: string | number): SubscriptionErrorReason {
  const code =
    typeof value === 'number'
      ? Number.isFinite(value) && Number.isInteger(value) && value >= 0
        ? String(value)
        : null
      : readBoundedString(value);

  if (code === null) return 'unknown';
  if (Object.prototype.hasOwnProperty.call(REVENUECAT_ERROR_CODE_REASON, code)) {
    return REVENUECAT_ERROR_CODE_REASON[code];
  }
  if (Object.prototype.hasOwnProperty.call(REVENUECAT_READABLE_ALIAS_REASON, code)) {
    return REVENUECAT_READABLE_ALIAS_REASON[code];
  }
  return 'unknown';
}

function mapReadableAlias(value: unknown): SubscriptionErrorReason | null {
  const readable = readBoundedString(value);
  if (readable === null) return null;
  return Object.prototype.hasOwnProperty.call(REVENUECAT_READABLE_ALIAS_REASON, readable)
    ? REVENUECAT_READABLE_ALIAS_REASON[readable]
    : null;
}

/**
 * Maps a raw RevenueCat error without consulting its human-readable message.
 * A present provider code is authoritative, including when it is unknown.
 */
export function normalizeRevenueCatError(error: unknown): SubscriptionErrorReason {
  if (!isSafeRecord(error)) return 'unknown';

  const codeField = readOwnField(error, 'code');
  if (codeField.present) {
    if (!codeField.readable) return 'unknown';
    if (typeof codeField.value === 'string' || typeof codeField.value === 'number') {
      return mapRevenueCatCode(codeField.value);
    }
    return 'unknown';
  }

  const readableFields: Array<SubscriptionErrorReason | 'unknown'> = [];
  const userInfoField = readOwnField(error, 'userInfo');
  if (userInfoField.present && userInfoField.readable) {
    if (!isSafeRecord(userInfoField.value)) return 'unknown';
    const nestedReadable = readOwnField(userInfoField.value, 'readableErrorCode');
    if (nestedReadable.present) {
      if (!nestedReadable.readable) return 'unknown';
      readableFields.push(mapReadableAlias(nestedReadable.value) ?? 'unknown');
    }
  } else if (userInfoField.present) {
    return 'unknown';
  }

  const legacyReadable = readOwnField(error, 'readableErrorCode');
  if (legacyReadable.present) {
    if (!legacyReadable.readable) return 'unknown';
    readableFields.push(mapReadableAlias(legacyReadable.value) ?? 'unknown');
  }

  if (readableFields.length > 0) {
    if (readableFields.includes('unknown')) return 'unknown';
    const first = readableFields[0];
    if (readableFields.some((reason) => reason !== first)) return 'unknown';
    return first;
  }

  const cancelledField = readOwnField(error, 'userCancelled');
  if (cancelledField.present && cancelledField.readable && cancelledField.value === true) {
    return 'purchase_cancelled';
  }

  return 'unknown';
}

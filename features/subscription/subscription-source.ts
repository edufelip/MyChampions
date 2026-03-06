/**
 * RevenueCat subscription source — SDK calls with injectable deps.
 * Wraps react-native-purchases to provide typed entitlement status and
 * purchase/restore actions.
 *
 * Injectable deps pattern mirrors food-search-source.ts and
 * meal-photo-analysis-source.ts for full unit-test coverage without SDK (TC-286).
 *
 * Refs: D-009–D-011, D-024, D-043, D-075, D-128, D-132
 *       FR-126–FR-129, FR-156, FR-185, FR-215, FR-217
 *       BR-218–BR-221, BR-228, BR-247, BR-273, BR-275
 */

import { normalizeEntitlementStatus, type EntitlementStatus } from './subscription.logic';

// ─── Error type ───────────────────────────────────────────────────────────────

export type SubscriptionErrorReason =
  | 'configuration'    // SDK not configured or API key missing
  | 'network'          // Network failure during SDK call
  | 'purchase_cancelled' // User dismissed purchase sheet
  | 'store_problem'    // App Store / Google Play returned an error
  | 'unauthenticated'  // RevenueCat rejected the request (invalid key, etc.)
  | 'unknown';

export class SubscriptionSourceError extends Error {
  code: SubscriptionErrorReason;

  constructor(code: SubscriptionErrorReason, message: string) {
    super(message);
    this.code = code;
    this.name = 'SubscriptionSourceError';
  }
}

// ─── Raw RevenueCat types (minimal surface used here) ────────────────────────

/**
 * Minimal shape of a RevenueCat CustomerInfo object that we depend on.
 * We only read entitlement active status; the full SDK type has many more fields.
 */
export type RawCustomerInfo = {
  entitlements?: {
    active?: Record<string, { isActive?: boolean }>;
  };
};

/**
 * Minimal shape of a RevenueCat Offerings object.
 * We expose it opaquely; callers that need to purchase pass the full package object.
 */
export type RawPurchasesPackage = unknown;

export type RawPurchaseResult = {
  customerInfo?: RawCustomerInfo;
};

// ─── Injectable deps ──────────────────────────────────────────────────────────

export type SubscriptionSourceDeps = {
  /** Configures the RevenueCat SDK. Should be called once at app startup. */
  configure: (apiKey: string) => void;
  /** Fetches current customer info. Returns RawCustomerInfo. */
  getCustomerInfo: () => Promise<RawCustomerInfo>;
  /** Purchases a package. Returns RawPurchaseResult. */
  purchasePackage: (pkg: RawPurchasesPackage) => Promise<RawPurchaseResult>;
  /** Restores purchases. Returns updated RawCustomerInfo. */
  restorePurchases: () => Promise<RawCustomerInfo>;
  /** Returns the RevenueCat API key from app config. */
  getApiKey: () => string;
  /**
   * Presents the RevenueCat native paywall UI (D-132).
   * @param offeringIdentifier - The RevenueCat offering to display. If omitted, shows the default offering.
   */
  presentPaywall: (offeringIdentifier?: string) => Promise<void>;
};

export type RevenueCatPlatform = 'ios' | 'android';

/**
 * Identifies the entitlement key that grants unlimited professional students.
 * D-011, BR-219: more than FREE_STUDENT_CAP active students requires active entitlement.
 *
 * RevenueCat dashboard entitlement identifier: `professional_pro`
 * Products attached: mychampions_professional_anuual, mychampions_professional_monthly.
 */
export const PRO_ENTITLEMENT_ID = 'professional_pro';

/**
 * Identifies the entitlement key that grants access to AI features (BL-108, D-132).
 * Purchasable by any role. Checked alongside PRO_ENTITLEMENT_ID for AI access.
 * Must match the entitlement identifier configured in the RevenueCat dashboard.
 *
 * RevenueCat dashboard entitlement identifier: `student_pro`
 * Products attached: student_annual, student_monthly.
 */
export const AI_FEATURES_ENTITLEMENT_ID = 'student_pro';

/**
 * RevenueCat offering identifier for the professional subscription paywall (D-152).
 * Must be configured in the RevenueCat dashboard under Offerings.
 * Shown when openProPaywall() is triggered from SC-212.
 * Contains professional products: mychampions_professional_anuual, mychampions_professional_monthly.
 */
export const PRO_OFFERING_ID = 'default_professional';

/**
 * RevenueCat offering identifier for the student AI features paywall (D-132, D-152).
 * Must be configured in the RevenueCat dashboard under Offerings.
 * Shown when openAiPaywall() is triggered from SC-214 / SC-215.
 * Contains student products: student_annual, student_monthly.
 */
export const AI_OFFERING_ID = 'default_student';

// ─── API key resolution ───────────────────────────────────────────────────────

/**
 * Resolves the RevenueCat API key from Expo Constants extra block.
 * Must be called at runtime (not module load) because Constants is not
 * available during Node test runs.
 * Throws SubscriptionSourceError('configuration') when key is absent.
 */
function resolvePlatformRevenueCatKey(
  source: Record<string, unknown>,
  platform: RevenueCatPlatform
): string {
  if (platform === 'ios') {
    const key = source['revenueCatApiKeyIos'];
    return typeof key === 'string' ? key : '';
  }
  const key = source['revenueCatApiKeyAndroid'];
  return typeof key === 'string' ? key : '';
}

function isSecretRevenueCatKey(key: string): boolean {
  return key.toLowerCase().startsWith('sk_');
}

function isValidPublicRevenueCatKey(key: string, platform: RevenueCatPlatform): boolean {
  const normalized = key.toLowerCase();
  if (platform === 'ios') return normalized.startsWith('appl_');
  return normalized.startsWith('goog_');
}

export function resolveRevenueCatApiKey(
  platform: RevenueCatPlatform,
  extra?: Record<string, unknown>
): string {
  const source = extra ?? (() => {
    // Lazy import — only at runtime in RN context
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as {
      expoConfig?: { extra?: Record<string, unknown> };
    };
    return Constants.expoConfig?.extra ?? {};
  })();

  const key = resolvePlatformRevenueCatKey(source, platform).trim();
  if (!key) {
    throw new SubscriptionSourceError(
      'configuration',
      `RevenueCat API key is not configured for ${platform}. Set EXPO_PUBLIC_REVENUECAT_API_KEY_${platform.toUpperCase()} in .env and expose via app.config.ts extra.revenueCatApiKey${platform === 'ios' ? 'Ios' : 'Android'}.`
    );
  }
  if (isSecretRevenueCatKey(key)) {
    throw new SubscriptionSourceError(
      'configuration',
      `RevenueCat secret key detected for ${platform}. Do not ship sk_* keys in mobile apps; use public SDK keys (appl_* for iOS, goog_* for Android).`
    );
  }
  if (!isValidPublicRevenueCatKey(key, platform)) {
    throw new SubscriptionSourceError(
      'configuration',
      `RevenueCat API key for ${platform} has an invalid prefix. Expected ${platform === 'ios' ? 'appl_*' : 'goog_*'}.`
    );
  }
  return key;
}

// ─── Entitlement normalization ────────────────────────────────────────────────

/**
 * Maps a RawCustomerInfo object to a typed EntitlementStatus.
 * Checks whether PRO_ENTITLEMENT_ID is in active entitlements.
 * Falls back to 'unknown' on any unexpected shape.
 */
export function mapCustomerInfoToEntitlementStatus(
  customerInfo: RawCustomerInfo
): EntitlementStatus {
  try {
    const active = customerInfo.entitlements?.active ?? {};
    const entitlement = active[PRO_ENTITLEMENT_ID];
    if (!entitlement) {
      // No pro entitlement found — treat as lapsed (not unknown).
      // The user has fetched info successfully; they just don't have the entitlement.
      return 'lapsed';
    }
    return normalizeEntitlementStatus(entitlement.isActive ? 'active' : 'lapsed');
  } catch {
    return 'unknown';
  }
}

/**
 * Maps a RawCustomerInfo object to an EntitlementStatus for the AI features entitlement.
 * Checks whether AI_FEATURES_ENTITLEMENT_ID ('student_pro') is in active entitlements.
 * Falls back to 'unknown' on any unexpected shape. Returns 'lapsed' when info is valid
 * but the entitlement is absent.
 * D-132: used alongside mapCustomerInfoToEntitlementStatus to derive hasAiAccess.
 */
export function mapCustomerInfoToAiEntitlementStatus(
  customerInfo: RawCustomerInfo
): EntitlementStatus {
  try {
    if (customerInfo.entitlements == null) {
      return 'unknown';
    }
    const active = customerInfo.entitlements.active ?? {};
    const entitlement = active[AI_FEATURES_ENTITLEMENT_ID];
    if (!entitlement) {
      return 'lapsed';
    }
    return normalizeEntitlementStatus(entitlement.isActive ? 'active' : 'lapsed');
  } catch {
    return 'unknown';
  }
}

// ─── Error mapping ────────────────────────────────────────────────────────────

/**
 * Maps a caught RevenueCat SDK error to a typed SubscriptionErrorReason.
 * RevenueCat error codes reference: https://errors.rev.cat
 * We inspect the `code` and `message` fields of the thrown error.
 */
export function normalizeSubscriptionError(error: unknown): SubscriptionErrorReason {
  if (typeof error !== 'object' || error === null) return 'unknown';

  const e = error as { code?: unknown; message?: unknown; userCancelled?: unknown };

  // User explicitly cancelled the purchase sheet
  if (e.userCancelled === true) return 'purchase_cancelled';

  const code = typeof e.code === 'string' ? e.code.toLowerCase() : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';

  if (
    code.includes('configuration') ||
    code === 'invalid_api_key' ||
    message.includes('api key') ||
    message.includes('not configured')
  ) {
    return 'configuration';
  }

  if (
    code.includes('network') ||
    code === 'network_error' ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('timed out')
  ) {
    return 'network';
  }

  if (
    code === 'purchase_cancelled' ||
    code === 'payment_pending' ||
    message.includes('cancelled') ||
    message.includes('canceled')
  ) {
    return 'purchase_cancelled';
  }

  if (
    code.includes('store') ||
    code === 'store_problem' ||
    code === 'store_transaction_unverified' ||
    message.includes('store')
  ) {
    return 'store_problem';
  }

  if (
    code.includes('unauthorized') ||
    message.includes('unauthorized') ||
    message.includes('permission')
  ) {
    return 'unauthenticated';
  }

  return 'unknown';
}

// ─── Source operations ────────────────────────────────────────────────────────

/**
 * Configures the RevenueCat SDK. Must be called once at app startup before any
 * other subscription source operations. Safe to call multiple times (SDK guards
 * against double-configuration internally, but callers should avoid it).
 *
 * Throws SubscriptionSourceError('configuration') when API key is absent.
 */
export function configureRevenueCat(deps: SubscriptionSourceDeps): void {
  const apiKey = deps.getApiKey();
  deps.configure(apiKey);
}

/**
 * Fetches the current professional entitlement status from RevenueCat.
 * Returns 'lapsed' when the pro entitlement is absent.
 * Returns 'unknown' on unexpected SDK response shapes.
 *
 * Throws SubscriptionSourceError on all failure paths.
 */
export async function fetchEntitlementStatus(
  deps: SubscriptionSourceDeps
): Promise<EntitlementStatus> {
  let customerInfo: RawCustomerInfo;
  try {
    customerInfo = await deps.getCustomerInfo();
  } catch (err: unknown) {
    if (err instanceof SubscriptionSourceError) throw err;
    const reason = normalizeSubscriptionError(err);
    throw new SubscriptionSourceError(reason, `RevenueCat getCustomerInfo failed: ${String(err)}`);
  }

  return mapCustomerInfoToEntitlementStatus(customerInfo);
}

/**
 * Initiates a purchase for the given package.
 * Returns the updated EntitlementStatus on success.
 *
 * Throws SubscriptionSourceError on cancellation, store error, or network failure.
 * Callers should distinguish 'purchase_cancelled' (user intent) from error.
 */
export async function purchasePackage(
  pkg: RawPurchasesPackage,
  deps: SubscriptionSourceDeps
): Promise<EntitlementStatus> {
  let result: RawPurchaseResult;
  try {
    result = await deps.purchasePackage(pkg);
  } catch (err: unknown) {
    if (err instanceof SubscriptionSourceError) throw err;
    const reason = normalizeSubscriptionError(err);
    throw new SubscriptionSourceError(reason, `RevenueCat purchasePackage failed: ${String(err)}`);
  }

  if (!result.customerInfo) {
    return 'unknown';
  }
  return mapCustomerInfoToEntitlementStatus(result.customerInfo);
}

/**
 * Restores purchases from the App Store / Google Play account.
 * Returns the updated EntitlementStatus.
 *
 * Throws SubscriptionSourceError on network or store failure.
 */
export async function restorePurchases(
  deps: SubscriptionSourceDeps
): Promise<EntitlementStatus> {
  let customerInfo: RawCustomerInfo;
  try {
    customerInfo = await deps.restorePurchases();
  } catch (err: unknown) {
    if (err instanceof SubscriptionSourceError) throw err;
    const reason = normalizeSubscriptionError(err);
    throw new SubscriptionSourceError(reason, `RevenueCat restorePurchases failed: ${String(err)}`);
  }

  return mapCustomerInfoToEntitlementStatus(customerInfo);
}

/**
 * Presents the native RevenueCat paywall for the AI features offering (D-132, D-152).
 * Uses the AI_OFFERING_ID ('default_student') offering configured in the RevenueCat dashboard.
 * The production dep resolves the offering via getOfferings() and passes the full
 * PurchasesOffering object to RevenueCatUI.presentPaywall({ offering }).
 *
 * Throws SubscriptionSourceError on presentation failure.
 */
export async function presentAiPaywall(deps: SubscriptionSourceDeps): Promise<void> {
  try {
    await deps.presentPaywall(AI_OFFERING_ID);
  } catch (err: unknown) {
    if (err instanceof SubscriptionSourceError) throw err;
    const reason = normalizeSubscriptionError(err);
    throw new SubscriptionSourceError(reason, `RevenueCat presentAiPaywall failed: ${String(err)}`);
  }
}

/**
 * Presents the native RevenueCat paywall for the professional subscription (D-152).
 * Uses the PRO_OFFERING_ID ('default_professional') offering configured in the RevenueCat dashboard.
 * The production dep resolves the offering via getOfferings() and passes the full
 * PurchasesOffering object to RevenueCatUI.presentPaywall({ offering }).
 *
 * Throws SubscriptionSourceError on presentation failure.
 */
export async function presentProPaywall(deps: SubscriptionSourceDeps): Promise<void> {
  try {
    await deps.presentPaywall(PRO_OFFERING_ID);
  } catch (err: unknown) {
    if (err instanceof SubscriptionSourceError) throw err;
    const reason = normalizeSubscriptionError(err);
    throw new SubscriptionSourceError(reason, `RevenueCat presentProPaywall failed: ${String(err)}`);
  }
}

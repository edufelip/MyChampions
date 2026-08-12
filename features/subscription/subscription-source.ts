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
import type { RoleIntent } from '@/features/auth/role-selection.logic';

// ─── Error type ───────────────────────────────────────────────────────────────

export type SubscriptionErrorReason =
  | 'configuration' // SDK not configured or API key missing
  | 'network' // Network failure during SDK call
  | 'purchase_cancelled' // User dismissed purchase sheet
  | 'store_problem' // App Store / Google Play returned an error
  | 'unauthenticated' // RevenueCat rejected the request (invalid key, etc.)
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
 * We only read the entitlement fields needed to derive access and authoritative
 * pre-lapse state; the full SDK type has many more fields.
 */
export type RawCustomerInfo = {
  entitlements?: {
    active?: Record<
      string,
      {
        isActive?: boolean;
        willRenew?: boolean;
        expirationDate?: string | null;
        unsubscribeDetectedAt?: string | null;
        billingIssueDetectedAt?: string | null;
      }
    >;
  };
};

export type ProfessionalEntitlementMetadata = {
  expiresAt: string | null;
  renewalRisk: boolean;
};

/**
 * Minimal shape of a RevenueCat Offerings object.
 * We expose it opaquely; callers that need to purchase pass the full package object.
 */
export type RawPurchasesPackage = unknown;

export type RawPurchaseResult = {
  customerInfo?: RawCustomerInfo;
};

export type RawPaywallResult = 'NOT_PRESENTED' | 'ERROR' | 'CANCELLED' | 'PURCHASED' | 'RESTORED';

// ─── Injectable deps ──────────────────────────────────────────────────────────

export type SubscriptionSourceDeps = {
  /** Configures the RevenueCat SDK. Should be called once at app startup. */
  configure: (apiKey: string, appUserId: string) => void;
  /** Switches the configured RevenueCat SDK to a different authenticated user. */
  logIn: (appUserId: string) => Promise<void>;
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
  presentPaywall: (offeringIdentifier?: string) => Promise<RawPaywallResult | void>;
};

export type RevenueCatPlatform = 'ios' | 'android';

/**
 * Identifies the entitlement key that grants unlimited professional students.
 * D-011, BR-219: more than FREE_STUDENT_CAP active students requires active entitlement.
 *
 * RevenueCat dashboard entitlement identifier: `professional_pro`
 * Products attached: professional_annual, professional_monthly, professional_test.
 */
export const PRO_ENTITLEMENT_ID = 'professional_pro';

/**
 * Identifies the entitlement key that grants access to AI features (BL-108, D-132).
 * New purchases are offered only to locked student accounts. Existing valid
 * entitlements remain role-agnostic for backward-compatible AI access.
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
 * Contains the production professional products: professional_annual and
 * professional_monthly. The separate development Test Store surface is
 * exposed through PRO_TEST_OFFERING_ID.
 */
export const PRO_OFFERING_ID = 'default_professional';

/**
 * Development-only professional offering used to validate the separate
 * Professional Paywall v1 Test Store surface.
 */
export const PRO_TEST_OFFERING_ID = 'test_professional';

export type ProfessionalOfferingId = typeof PRO_OFFERING_ID | typeof PRO_TEST_OFFERING_ID;

/**
 * RevenueCat offering identifier for the student AI features paywall (D-132, D-152).
 * Must be configured in the RevenueCat dashboard under Offerings.
 * Shown when openAiPaywall() is triggered from SC-214 / SC-215.
 * Contains student products: student_annual, student_monthly.
 */
export const AI_OFFERING_ID = 'default_student';

/**
 * Temporary development-only offering used to validate Student Paywall v1 with
 * RevenueCat Test Store before a separately approved production promotion.
 */
export const AI_TEST_OFFERING_ID = 'test_student';

export type AiUpgradeOfferingId =
  typeof AI_OFFERING_ID | typeof AI_TEST_OFFERING_ID | typeof PRO_OFFERING_ID;

/**
 * Resolves the student offering exposed through Expo config. The temporary
 * offering is accepted only when both the development variant and Test Store
 * guard are explicit. Missing config safely falls back to default_student.
 */
export function resolveStudentOfferingId(
  extra?: Record<string, unknown>,
): typeof AI_OFFERING_ID | typeof AI_TEST_OFFERING_ID {
  const source = extra ?? {};
  const configured = source['revenueCatStudentOfferingId'];
  const offeringId =
    typeof configured === 'string' && configured.trim() ? configured.trim() : AI_OFFERING_ID;

  if (offeringId !== AI_OFFERING_ID && offeringId !== AI_TEST_OFFERING_ID) {
    throw new SubscriptionSourceError(
      'configuration',
      'RevenueCat student offering must be default_student or test_student.',
    );
  }

  if (
    offeringId === AI_TEST_OFFERING_ID &&
    (source['appVariant'] !== 'dev' || source['revenueCatTestStoreEnabled'] !== true)
  ) {
    throw new SubscriptionSourceError(
      'configuration',
      'RevenueCat test_student offering is allowed only in an explicit development Test Store build.',
    );
  }

  return offeringId;
}

/**
 * Resolves the professional offering exposed through Expo config. The test
 * offering is accepted only when both the development variant and Test Store
 * guard are explicit. Missing config safely falls back to default_professional.
 */
export function resolveProfessionalOfferingId(
  extra?: Record<string, unknown>,
): ProfessionalOfferingId {
  const source = extra ?? {};
  const configured = source['revenueCatProfessionalOfferingId'];
  const offeringId =
    typeof configured === 'string' && configured.trim() ? configured.trim() : PRO_OFFERING_ID;

  if (offeringId !== PRO_OFFERING_ID && offeringId !== PRO_TEST_OFFERING_ID) {
    throw new SubscriptionSourceError(
      'configuration',
      'RevenueCat professional offering must be default_professional or test_professional.',
    );
  }

  if (
    offeringId === PRO_TEST_OFFERING_ID &&
    (source['appVariant'] !== 'dev' || source['revenueCatTestStoreEnabled'] !== true)
  ) {
    throw new SubscriptionSourceError(
      'configuration',
      'RevenueCat test_professional offering is allowed only in an explicit development Test Store build.',
    );
  }

  return offeringId;
}

/**
 * Maps the locked account role to the only offering it may initiate from an AI gate.
 * Missing or malformed roles fail closed without a provider presentation.
 */
export function resolveAiUpgradeOfferingId(
  role: RoleIntent | null | undefined,
  resolveStudentOffering: () => typeof AI_OFFERING_ID | typeof AI_TEST_OFFERING_ID,
): AiUpgradeOfferingId | null {
  if (role === 'professional') return PRO_OFFERING_ID;
  if (role === 'student') return resolveStudentOffering();
  return null;
}

/**
 * Resolves an explicitly requested offering without falling back to RevenueCat's
 * current/default offering. Role-aware paywall routing must fail closed when the
 * configured offering is absent so students and professionals cannot cross into
 * the other plan.
 */
export function resolveRequiredRevenueCatOffering<T>(
  offeringsById: Record<string, T | undefined>,
  offeringId: string,
): T {
  const offering = offeringsById[offeringId];
  if (!offering) {
    throw new SubscriptionSourceError(
      'configuration',
      `RevenueCat offering ${offeringId} is not available for this app configuration.`,
    );
  }
  return offering;
}

// ─── API key resolution ───────────────────────────────────────────────────────

/**
 * Resolves the RevenueCat API key from Expo Constants extra block.
 * Must be called at runtime (not module load) because Constants is not
 * available during Node test runs.
 * Throws SubscriptionSourceError('configuration') when key is absent.
 */
function resolvePlatformRevenueCatKey(
  source: Record<string, unknown>,
  platform: RevenueCatPlatform,
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

function isValidPublicRevenueCatKey(
  key: string,
  platform: RevenueCatPlatform,
  testStoreEnabled: boolean,
): boolean {
  const normalized = key.toLowerCase();
  if (testStoreEnabled) return normalized.startsWith('test_');
  if (platform === 'ios') return normalized.startsWith('appl_');
  return normalized.startsWith('goog_');
}

export function resolveRevenueCatApiKey(
  platform: RevenueCatPlatform,
  extra?: Record<string, unknown>,
): string {
  const source =
    extra ??
    (() => {
      // Lazy import — only at runtime in RN context
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Constants = require('expo-constants').default as {
        expoConfig?: { extra?: Record<string, unknown> };
      };
      return Constants.expoConfig?.extra ?? {};
    })();

  const testStoreEnabled = source['revenueCatTestStoreEnabled'] === true;
  const appVariant = source['appVariant'];
  if (testStoreEnabled && appVariant !== 'dev') {
    throw new SubscriptionSourceError(
      'configuration',
      'RevenueCat Test Store is allowed only for explicit development builds.',
    );
  }

  const key = resolvePlatformRevenueCatKey(source, platform).trim();
  if (!key) {
    throw new SubscriptionSourceError(
      'configuration',
      `RevenueCat API key is not configured for ${platform}. Set EXPO_PUBLIC_REVENUECAT_API_KEY_${platform.toUpperCase()} in .env and expose via app.config.ts extra.revenueCatApiKey${platform === 'ios' ? 'Ios' : 'Android'}.`,
    );
  }
  if (isSecretRevenueCatKey(key)) {
    throw new SubscriptionSourceError(
      'configuration',
      `RevenueCat secret key detected for ${platform}. Do not ship sk_* keys in mobile apps; use public SDK keys (appl_* for iOS, goog_* for Android).`,
    );
  }
  if (!isValidPublicRevenueCatKey(key, platform, testStoreEnabled)) {
    const expectedPrefix = testStoreEnabled ? 'test_*' : platform === 'ios' ? 'appl_*' : 'goog_*';
    throw new SubscriptionSourceError(
      'configuration',
      `RevenueCat API key for ${platform} has an invalid prefix. Expected ${expectedPrefix}.`,
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
  customerInfo: RawCustomerInfo,
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
 * Maps RevenueCat's current professional entitlement to the pre-lapse signal
 * consumed by the professional subscription UI. A warning is only emitted for
 * an active, expiring subscription with explicit cancellation/non-renewal or a
 * billing issue. Missing or malformed provider data fails closed to no warning.
 */
export function mapCustomerInfoToProfessionalEntitlementMetadata(
  customerInfo: RawCustomerInfo,
): ProfessionalEntitlementMetadata {
  try {
    const entitlement = customerInfo.entitlements?.active?.[PRO_ENTITLEMENT_ID];
    if (!entitlement?.isActive) {
      return { expiresAt: null, renewalRisk: false };
    }

    const expirationTimestamp =
      typeof entitlement.expirationDate === 'string'
        ? Date.parse(entitlement.expirationDate)
        : Number.NaN;
    const expiresAt = Number.isFinite(expirationTimestamp)
      ? new Date(expirationTimestamp).toISOString()
      : null;
    const hasCancellationSignal =
      entitlement.willRenew === false ||
      (typeof entitlement.unsubscribeDetectedAt === 'string' &&
        entitlement.unsubscribeDetectedAt.trim().length > 0);
    const hasBillingIssue =
      typeof entitlement.billingIssueDetectedAt === 'string' &&
      entitlement.billingIssueDetectedAt.trim().length > 0;

    return {
      expiresAt,
      renewalRisk: expiresAt !== null && (hasCancellationSignal || hasBillingIssue),
    };
  } catch {
    return { expiresAt: null, renewalRisk: false };
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
  customerInfo: RawCustomerInfo,
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
 * Throws SubscriptionSourceError('configuration') when API key or app user ID is absent.
 */
export function configureRevenueCat(deps: SubscriptionSourceDeps, appUserId: string): void {
  const normalizedAppUserId = appUserId.trim();
  if (!normalizedAppUserId) {
    throw new SubscriptionSourceError(
      'configuration',
      'RevenueCat requires a nonblank self-managed auth UID before SDK configuration.',
    );
  }

  const apiKey = deps.getApiKey();
  deps.configure(apiKey, normalizedAppUserId);
}

type RevenueCatIdentityCoordinator = {
  run<T>(deps: SubscriptionSourceDeps, appUserId: string, operation: () => Promise<T>): Promise<T>;
};

/**
 * Serializes all operations against RevenueCat's process-global SDK. This makes
 * the SDK finish a user switch before another hook reads, restores, buys, or
 * opens a paywall for that user.
 */
export function createRevenueCatIdentityCoordinator(): RevenueCatIdentityCoordinator {
  let configured = false;
  let configuredAppUserId: string | null = null;
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(
      deps: SubscriptionSourceDeps,
      appUserId: string,
      operation: () => Promise<T>,
    ): Promise<T> {
      const queuedOperation = tail.then(async () => {
        const normalizedAppUserId = appUserId.trim();
        if (!normalizedAppUserId) {
          throw new SubscriptionSourceError(
            'configuration',
            'RevenueCat requires a nonblank self-managed auth UID before SDK operations.',
          );
        }

        if (!configured) {
          configureRevenueCat(deps, normalizedAppUserId);
          configured = true;
          configuredAppUserId = normalizedAppUserId;
        } else if (configuredAppUserId !== normalizedAppUserId) {
          try {
            await deps.logIn(normalizedAppUserId);
          } catch (err: unknown) {
            if (err instanceof SubscriptionSourceError) throw err;
            const reason = normalizeSubscriptionError(err);
            throw new SubscriptionSourceError(reason, `RevenueCat logIn failed: ${String(err)}`);
          }
          configuredAppUserId = normalizedAppUserId;
        }

        return operation();
      });

      // A failed operation must not permanently block later retry attempts.
      tail = queuedOperation.then(
        () => undefined,
        () => undefined,
      );
      return queuedOperation;
    },
  };
}

/**
 * Fetches the current professional entitlement status from RevenueCat.
 * Returns 'lapsed' when the pro entitlement is absent.
 * Returns 'unknown' on unexpected SDK response shapes.
 *
 * Throws SubscriptionSourceError on all failure paths.
 */
export async function fetchEntitlementStatus(
  deps: SubscriptionSourceDeps,
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
  deps: SubscriptionSourceDeps,
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
export async function restorePurchases(deps: SubscriptionSourceDeps): Promise<EntitlementStatus> {
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
 * Uses the supplied guarded student offering, defaulting to AI_OFFERING_ID
 * ('default_student') for normal development and production.
 * The production dep resolves the offering via getOfferings() and passes the full
 * PurchasesOffering object to RevenueCatUI.presentPaywall({ offering }).
 *
 * Throws SubscriptionSourceError on presentation failure.
 */
export async function presentAiPaywall(
  deps: SubscriptionSourceDeps,
  offeringId: typeof AI_OFFERING_ID | typeof AI_TEST_OFFERING_ID = AI_OFFERING_ID,
): Promise<RawPaywallResult | void> {
  try {
    return await deps.presentPaywall(offeringId);
  } catch (err: unknown) {
    if (err instanceof SubscriptionSourceError) throw err;
    const reason = normalizeSubscriptionError(err);
    throw new SubscriptionSourceError(reason, `RevenueCat presentAiPaywall failed: ${String(err)}`);
  }
}

/**
 * Presents the native RevenueCat paywall for the professional subscription (D-152).
 * Uses the supplied production or explicit development Test Store offering,
 * defaulting to PRO_OFFERING_ID ('default_professional').
 * The production dep resolves the offering via getOfferings() and passes the full
 * PurchasesOffering object to RevenueCatUI.presentPaywall({ offering }).
 *
 * Throws SubscriptionSourceError on presentation failure.
 */
export async function presentProPaywall(
  deps: SubscriptionSourceDeps,
  offeringId: ProfessionalOfferingId = PRO_OFFERING_ID,
): Promise<RawPaywallResult | void> {
  try {
    return await deps.presentPaywall(offeringId);
  } catch (err: unknown) {
    if (err instanceof SubscriptionSourceError) throw err;
    const reason = normalizeSubscriptionError(err);
    throw new SubscriptionSourceError(
      reason,
      `RevenueCat presentProPaywall failed: ${String(err)}`,
    );
  }
}

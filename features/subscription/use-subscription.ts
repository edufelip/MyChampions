/**
 * React hook for RevenueCat subscription entitlement state.
 * Configures the SDK on first call (if not already configured), fetches the
 * current EntitlementStatus for both professional_unlimited and premium_student
 * entitlements, and exposes purchase/restore/refresh/paywall actions.
 *
 * This hook is the single consumer of subscription-source.ts in the UI layer.
 * Screens should call this once and pass entitlementStatus / hasAiAccess down.
 *
 * Refs: D-009–D-011, D-043, D-128, D-132, FR-126–FR-129, FR-215, BR-219–BR-221
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';
import Constants from 'expo-constants';

import { hasAiAnalysisAccess, type EntitlementStatus } from './subscription.logic';
import {
  configureRevenueCat,
  fetchEntitlementStatus,
  purchasePackage,
  restorePurchases,
  presentAiPaywall,
  resolveRevenueCatApiKey,
  mapCustomerInfoToEntitlementStatus,
  mapCustomerInfoToAiEntitlementStatus,
  SubscriptionSourceError,
  type SubscriptionSourceDeps,
  type RawCustomerInfo,
  type RawPurchasesPackage,
  type SubscriptionErrorReason,
} from './subscription-source';

// ─── SDK configuration guard ──────────────────────────────────────────────────

let sdkConfigured = false;

function getProductionDeps(): SubscriptionSourceDeps {
  return {
    configure: (apiKey: string) => {
      if (__DEV__) {
        Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      }
      Purchases.configure({ apiKey });
    },
    getCustomerInfo: () => Purchases.getCustomerInfo() as Promise<RawCustomerInfo>,
    purchasePackage: (pkg) => Purchases.purchasePackage(pkg as Parameters<typeof Purchases.purchasePackage>[0]) as Promise<import('./subscription-source').RawPurchaseResult>,
    restorePurchases: () => Purchases.restorePurchases() as Promise<RawCustomerInfo>,
    getApiKey: () => {
      const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      return resolveRevenueCatApiKey(platform, extra);
    },
    presentPaywall: async (offeringIdentifier?: string) => {
      // RevenueCatUI PresentPaywallParams requires a full PurchasesOffering object.
      // We use the dashboard default offering here and keep identifier routing in source logic.
      void offeringIdentifier;
      await RevenueCatUI.presentPaywall();
    },
  };
}

// ─── Hook result ──────────────────────────────────────────────────────────────

export type UseSubscriptionResult = {
  /** Live entitlement status from RevenueCat professional_unlimited. 'unknown' while loading or on config error. */
  entitlementStatus: EntitlementStatus;
  /**
   * Live entitlement status from RevenueCat premium_student (AI features).
   * 'unknown' while loading or on config error. (D-132)
   */
  aiEntitlementStatus: EntitlementStatus;
  /**
   * True when the user may use AI meal photo analysis (BL-108, D-132).
   * Derived from hasAiAnalysisAccess(entitlementStatus, aiEntitlementStatus).
   * Only 'active' on either entitlement grants access; 'unknown' is treated as locked.
   */
  hasAiAccess: boolean;
  /**
   * Active student count. Currently stubbed at 0 — will be sourced from
   * Data Connect student roster when that endpoint is wired (pending-wiring-checklist-v1.md).
   */
  activeStudentCount: number;
  /** True while the SDK is fetching initial entitlement status. */
  isLoading: boolean;
  /** Error reason from the last failed operation; null when no error. */
  error: SubscriptionErrorReason | null;
  /** Initiates a purchase for the given RevenueCat package. */
  purchase: (pkg: RawPurchasesPackage) => Promise<void>;
  /** Restores purchases from the store account. */
  restore: () => Promise<void>;
  /** Manually refreshes entitlement status from RevenueCat. */
  refresh: () => Promise<void>;
  /**
   * Presents the native RevenueCat paywall for the AI features offering (D-132).
   * After the paywall is dismissed, both entitlement statuses are refreshed.
   */
  openAiPaywall: () => Promise<void>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param isAuthenticated - Pass Boolean(currentUser) from useAuthSession.
 *   The hook only calls the SDK when the user is authenticated; returns 'unknown' otherwise.
 * @param activeStudentCount - Active student count from Data Connect (still 0 until wired).
 */
export function useSubscription(
  isAuthenticated: boolean,
  activeStudentCount = 0
): UseSubscriptionResult {
  const [entitlementStatus, setEntitlementStatus] = useState<EntitlementStatus>('unknown');
  const [aiEntitlementStatus, setAiEntitlementStatus] = useState<EntitlementStatus>('unknown');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<SubscriptionErrorReason | null>(null);

  const deps = getProductionDeps();

  // Configure SDK once per app session
  useEffect(() => {
    if (sdkConfigured) return;
    try {
      configureRevenueCat(deps);
      sdkConfigured = true;
    } catch (err: unknown) {
      const reason = err instanceof SubscriptionSourceError ? err.code : 'configuration';
      setError(reason);
    }
    // deps is stable per render — intentionally omitting to avoid re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch both entitlements in a single getCustomerInfo call (D-132).
  const fetchStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // Single SDK call — map to both entitlement checks
      const customerInfo = await deps.getCustomerInfo();
      setEntitlementStatus(mapCustomerInfoToEntitlementStatus(customerInfo));
      setAiEntitlementStatus(mapCustomerInfoToAiEntitlementStatus(customerInfo));
    } catch (err: unknown) {
      if (err instanceof SubscriptionSourceError) {
        setError(err.code);
      } else {
        setError('unknown');
      }
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Purchase action
  const purchase = useCallback(
    async (pkg: RawPurchasesPackage) => {
      setIsLoading(true);
      setError(null);
      try {
        const updated = await purchasePackage(pkg, deps);
        setEntitlementStatus(updated);
        // Refresh AI entitlement after purchase in case bundle unlocks both
        await fetchStatus();
      } catch (err: unknown) {
        const reason = err instanceof SubscriptionSourceError ? err.code : 'unknown';
        setError(reason as SubscriptionErrorReason);
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchStatus]
  );

  // Restore action
  const restore = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const updated = await restorePurchases(deps);
      setEntitlementStatus(updated);
      // Also refresh AI entitlement after restore
      await fetchStatus();
    } catch (err: unknown) {
      const reason = err instanceof SubscriptionSourceError ? err.code : 'unknown';
      setError(reason as SubscriptionErrorReason);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatus]);

  // Refresh action (manual)
  const refresh = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  // Open AI paywall action (D-132): present native RevenueCat paywall, then refresh.
  const openAiPaywall = useCallback(async () => {
    try {
      await presentAiPaywall(deps);
    } catch {
      // Paywall dismissal (user cancels) may throw — treat as non-fatal
    }
    // Always refresh entitlements after paywall closes (user may have purchased)
    await fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatus]);

  return {
    entitlementStatus,
    aiEntitlementStatus,
    hasAiAccess: hasAiAnalysisAccess(entitlementStatus, aiEntitlementStatus),
    activeStudentCount,
    isLoading,
    error,
    purchase,
    restore,
    refresh,
    openAiPaywall,
  };
}

/**
 * React hook for RevenueCat subscription entitlement state.
 * Configures the SDK on first call (if not already configured), fetches the
 * current EntitlementStatus for both professional_pro and student_pro
 * entitlements, and exposes purchase/restore/refresh/paywall actions.
 *
 * This hook is the single consumer of subscription-source.ts in the UI layer.
 * Screens should call this once and pass entitlementStatus / hasAiAccess down.
 *
 * Refs: D-009–D-011, D-043, D-128, D-132, FR-126–FR-129, FR-215, BR-219–BR-221
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';
import Constants from 'expo-constants';

import { resolveE2ESubscriptionOverride } from '@/features/auth/e2e-auth-session';
import { getActiveProfessionalStudentCount } from '@/features/professional/professional-source';
import { hasAiAnalysisAccess, type EntitlementStatus } from './subscription.logic';
import {
  createRevenueCatIdentityCoordinator,
  purchasePackage,
  restorePurchases,
  presentAiPaywall,
  presentProPaywall,
  resolveRevenueCatApiKey,
  mapCustomerInfoToEntitlementStatus,
  mapCustomerInfoToAiEntitlementStatus,
  SubscriptionSourceError,
  type SubscriptionSourceDeps,
  type RawCustomerInfo,
  type RawPurchasesPackage,
  type SubscriptionErrorReason,
} from './subscription-source';
import {
  getSubscriptionEntitlementSnapshot,
  syncSubscriptionEntitlementSnapshot,
} from './subscription-server-source';

// ─── SDK identity coordinator ─────────────────────────────────────────────────

const revenueCatIdentityCoordinator = createRevenueCatIdentityCoordinator();

function getE2ESubscriptionOverride() {
  return resolveE2ESubscriptionOverride({
    activeStudentCount: process.env.EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT,
    aiEntitlementStatus: process.env.EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS,
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    entitlementStatus: process.env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

function getProductionDeps(): SubscriptionSourceDeps {
  return {
    configure: (apiKey: string, appUserId: string) => {
      if (__DEV__) {
        Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      }
      Purchases.configure({ apiKey, appUserID: appUserId });
    },
    logIn: async (appUserId: string) => {
      await Purchases.logIn(appUserId);
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
      // RevenueCatUI.presentPaywall requires a full PurchasesOffering object (not a string ID).
      // Both pro (PRO_OFFERING_ID) and AI (AI_OFFERING_ID) paywalls always supply an identifier,
      // so we always resolve via getOfferings() and pass the matching object. (D-152)
      const offerings = await Purchases.getOfferings();
      const offering = offeringIdentifier ? (offerings.all[offeringIdentifier] ?? undefined) : undefined;
      await RevenueCatUI.presentPaywall({ offering });
    },
  };
}

// ─── Hook result ──────────────────────────────────────────────────────────────

export type UseSubscriptionResult = {
  /** Live entitlement status from RevenueCat professional_pro. 'unknown' while loading or on config error. */
  entitlementStatus: EntitlementStatus;
  /**
   * Live entitlement status from RevenueCat student_pro (AI features).
   * 'unknown' while loading or on config error. (D-132)
   */
  aiEntitlementStatus: EntitlementStatus;
  /**
   * True when the user may use AI meal photo analysis (BL-108, D-132).
   * Derived from hasAiAnalysisAccess(entitlementStatus, aiEntitlementStatus).
   * Only 'active' on either entitlement grants access; 'unknown' is treated as locked.
   */
  hasAiAccess: boolean;
  /** Active student count. Professional screens opt into loading unique active student usage. */
  activeStudentCount: number;
  /** True while the SDK is fetching initial entitlement status. */
  isLoading: boolean;
  /** Error reason from the last failed operation; null when no error. */
  error: SubscriptionErrorReason | null;
  /** Timestamp for the latest successful entitlement or active-student count read. */
  lastSyncedAtIso: string | null;
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
  /**
   * Presents the native RevenueCat paywall for the professional subscription (D-152).
   * Uses the dashboard default offering (professional_pro entitlement products).
   * After the paywall is dismissed, both entitlement statuses are refreshed.
   */
  openProPaywall: () => Promise<void>;
};

export type UseSubscriptionOptions = {
  activeStudentCount?: number;
  loadProfessionalActiveStudentCount?: boolean;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param authUid - Pass currentUser?.uid ?? null from useAuthSession.
 *   The hook only calls the SDK after binding it to the self-managed auth UID.
 * @param options - Professional screens can opt into loading the unique active-student count.
 */
export function useSubscription(
  authUid: string | null,
  optionsOrActiveStudentCount: number | UseSubscriptionOptions = 0
): UseSubscriptionResult {
  const activeAuthUid = authUid?.trim() || null;
  const activeStudentCountOverride =
    typeof optionsOrActiveStudentCount === 'number'
      ? optionsOrActiveStudentCount
      : optionsOrActiveStudentCount.activeStudentCount;
  const loadProfessionalActiveStudentCount =
    typeof optionsOrActiveStudentCount === 'object' &&
    optionsOrActiveStudentCount.loadProfessionalActiveStudentCount === true;

  const [entitlementStatus, setEntitlementStatus] = useState<EntitlementStatus>('unknown');
  const [aiEntitlementStatus, setAiEntitlementStatus] = useState<EntitlementStatus>('unknown');
  const [activeStudentCount, setActiveStudentCount] = useState(activeStudentCountOverride ?? 0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<SubscriptionErrorReason | null>(null);
  const [lastSyncedAtIso, setLastSyncedAtIso] = useState<string | null>(null);

  const currentAuthUidRef = useRef<string | null>(activeAuthUid);
  currentAuthUidRef.current = activeAuthUid;
  const deps = useMemo(getProductionDeps, []);

  const runRevenueCatOperation = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      if (!activeAuthUid) {
        return Promise.reject(
          new SubscriptionSourceError(
            'unauthenticated',
            'A self-managed MyChampions auth session is required for RevenueCat operations.'
          )
        );
      }
      return revenueCatIdentityCoordinator.run(deps, activeAuthUid, operation);
    },
    [activeAuthUid, deps]
  );

  const syncSnapshot = useCallback(
    (input: {
      professionalEntitlementStatus: EntitlementStatus;
      aiEntitlementStatus: EntitlementStatus;
    }, expectedAuthUid: string) => {
      if (currentAuthUidRef.current !== expectedAuthUid) return;

      void syncSubscriptionEntitlementSnapshot({
        ...input,
        activeStudentCount,
        observedAt: new Date().toISOString(),
      }, undefined, expectedAuthUid).catch(() => {
        // Local development only; production cap-sensitive writes use signed webhook entitlement snapshots.
      });
    },
    [activeStudentCount]
  );

  const applyE2EProSubscriptionSuccess = useCallback(() => {
    const e2eSubscriptionOverride = getE2ESubscriptionOverride();
    if (!e2eSubscriptionOverride) return false;

    setActiveStudentCount(e2eSubscriptionOverride.activeStudentCount);
    setEntitlementStatus('active');
    setAiEntitlementStatus(e2eSubscriptionOverride.aiEntitlementStatus);
    setError(null);
    setIsLoading(false);
    setLastSyncedAtIso(new Date().toISOString());
    return true;
  }, []);

  const applyE2EAiSubscriptionSuccess = useCallback(() => {
    const e2eSubscriptionOverride = getE2ESubscriptionOverride();
    if (!e2eSubscriptionOverride) return false;

    setActiveStudentCount(e2eSubscriptionOverride.activeStudentCount);
    setEntitlementStatus(e2eSubscriptionOverride.entitlementStatus);
    setAiEntitlementStatus('active');
    setError(null);
    setIsLoading(false);
    setLastSyncedAtIso(new Date().toISOString());
    return true;
  }, []);

  const applyServerSnapshotFallback = useCallback(async (expectedAuthUid: string) => {
    if (currentAuthUidRef.current !== expectedAuthUid) return false;

    try {
      const serverSnapshot = await getSubscriptionEntitlementSnapshot(undefined, expectedAuthUid);
      if (!serverSnapshot) return false;
      if (currentAuthUidRef.current !== expectedAuthUid) return false;

      setEntitlementStatus(serverSnapshot.professionalEntitlementStatus);
      setAiEntitlementStatus(serverSnapshot.aiEntitlementStatus);
      if (serverSnapshot.activeStudentCount !== null) {
        setActiveStudentCount(serverSnapshot.activeStudentCount);
      }
      setError(null);
      setLastSyncedAtIso(serverSnapshot.observedAt || serverSnapshot.updatedAt);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const e2eSubscriptionOverride = getE2ESubscriptionOverride();
    if (e2eSubscriptionOverride) {
      setActiveStudentCount(e2eSubscriptionOverride.activeStudentCount);
      setLastSyncedAtIso(new Date().toISOString());
      return;
    }

    if (typeof activeStudentCountOverride === 'number') {
      setActiveStudentCount(activeStudentCountOverride);
      return;
    }

    if (!activeAuthUid || !loadProfessionalActiveStudentCount) {
      setActiveStudentCount(0);
      return;
    }

    let isCancelled = false;
    void getActiveProfessionalStudentCount()
      .then((count) => {
        if (!isCancelled) {
          setActiveStudentCount(count);
          setLastSyncedAtIso(new Date().toISOString());
        }
      })
      .catch(() => {
        if (!isCancelled) setActiveStudentCount(0);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeAuthUid, activeStudentCountOverride, loadProfessionalActiveStudentCount]);

  // Fetch both entitlements in a single getCustomerInfo call (D-132).
  const fetchStatus = useCallback(async () => {
    const e2eSubscriptionOverride = getE2ESubscriptionOverride();
    if (e2eSubscriptionOverride) {
      setEntitlementStatus(e2eSubscriptionOverride.entitlementStatus);
      setAiEntitlementStatus(e2eSubscriptionOverride.aiEntitlementStatus);
      setError(null);
      setLastSyncedAtIso(new Date().toISOString());
      return;
    }

    if (!activeAuthUid) {
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
      setIsLoading(false);
      setError(null);
      setLastSyncedAtIso(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // Single SDK call — map to both entitlement checks
      const customerInfo = await runRevenueCatOperation(() => deps.getCustomerInfo());
      if (currentAuthUidRef.current !== activeAuthUid) return;

      const professionalEntitlementStatus = mapCustomerInfoToEntitlementStatus(customerInfo);
      const aiEntitlementStatus = mapCustomerInfoToAiEntitlementStatus(customerInfo);
      setEntitlementStatus(professionalEntitlementStatus);
      setAiEntitlementStatus(aiEntitlementStatus);
      syncSnapshot({
        professionalEntitlementStatus,
        aiEntitlementStatus,
      }, activeAuthUid);
      setLastSyncedAtIso(new Date().toISOString());
    } catch (err: unknown) {
      if (currentAuthUidRef.current !== activeAuthUid) return;

      if (await applyServerSnapshotFallback(activeAuthUid)) {
        setIsLoading(false);
        return;
      }

      if (currentAuthUidRef.current !== activeAuthUid) return;

      if (err instanceof SubscriptionSourceError) {
        setError(err.code);
      } else {
        setError('unknown');
      }
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
    } finally {
      if (currentAuthUidRef.current === activeAuthUid) {
        setIsLoading(false);
      }
    }
  }, [activeAuthUid, applyServerSnapshotFallback, deps, runRevenueCatOperation, syncSnapshot]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Purchase action
  const purchase = useCallback(
    async (pkg: RawPurchasesPackage) => {
      if (applyE2EProSubscriptionSuccess()) return;
      if (!activeAuthUid) return;

      setIsLoading(true);
      setError(null);
      try {
        const updated = await runRevenueCatOperation(() => purchasePackage(pkg, deps));
        if (currentAuthUidRef.current !== activeAuthUid) return;
        setEntitlementStatus(updated);
        // Refresh AI entitlement after purchase in case bundle unlocks both
        await fetchStatus();
      } catch (err: unknown) {
        if (currentAuthUidRef.current !== activeAuthUid) return;
        const reason = err instanceof SubscriptionSourceError ? err.code : 'unknown';
        setError(reason as SubscriptionErrorReason);
      } finally {
        if (currentAuthUidRef.current === activeAuthUid) {
          setIsLoading(false);
        }
      }
    },
    [activeAuthUid, applyE2EProSubscriptionSuccess, deps, fetchStatus, runRevenueCatOperation]
  );

  // Restore action
  const restore = useCallback(async () => {
    if (applyE2EProSubscriptionSuccess()) return;
    if (!activeAuthUid) return;

    setIsLoading(true);
    setError(null);
    try {
      const updated = await runRevenueCatOperation(() => restorePurchases(deps));
      if (currentAuthUidRef.current !== activeAuthUid) return;
      setEntitlementStatus(updated);
      // Also refresh AI entitlement after restore
      await fetchStatus();
    } catch (err: unknown) {
      if (currentAuthUidRef.current !== activeAuthUid) return;
      const reason = err instanceof SubscriptionSourceError ? err.code : 'unknown';
      setError(reason as SubscriptionErrorReason);
    } finally {
      if (currentAuthUidRef.current === activeAuthUid) {
        setIsLoading(false);
      }
    }
  }, [activeAuthUid, applyE2EProSubscriptionSuccess, deps, fetchStatus, runRevenueCatOperation]);

  // Refresh action (manual)
  const refresh = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  // Open AI paywall action (D-132): present native RevenueCat paywall, then refresh.
  const openAiPaywall = useCallback(async () => {
    if (applyE2EAiSubscriptionSuccess()) return;
    if (!activeAuthUid) return;

    try {
      await runRevenueCatOperation(() => presentAiPaywall(deps));
    } catch {
      // Paywall dismissal (user cancels) may throw — treat as non-fatal
    }
    if (currentAuthUidRef.current !== activeAuthUid) return;
    // Always refresh entitlements after paywall closes (user may have purchased)
    await fetchStatus();
  }, [activeAuthUid, applyE2EAiSubscriptionSuccess, deps, fetchStatus, runRevenueCatOperation]);

  // Open pro paywall action (D-152): present native RevenueCat paywall for the professional
  // subscription (default offering), then refresh both entitlement statuses.
  const openProPaywall = useCallback(async () => {
    if (applyE2EProSubscriptionSuccess()) return;
    if (!activeAuthUid) return;

    try {
      await runRevenueCatOperation(() => presentProPaywall(deps));
    } catch {
      // Paywall dismissal (user cancels) may throw — treat as non-fatal
    }
    if (currentAuthUidRef.current !== activeAuthUid) return;
    // Always refresh entitlements after paywall closes (user may have purchased)
    await fetchStatus();
  }, [activeAuthUid, applyE2EProSubscriptionSuccess, deps, fetchStatus, runRevenueCatOperation]);

  return {
    entitlementStatus,
    aiEntitlementStatus,
    hasAiAccess: hasAiAnalysisAccess(entitlementStatus, aiEntitlementStatus),
    activeStudentCount,
    isLoading,
    error,
    lastSyncedAtIso,
    purchase,
    restore,
    refresh,
    openAiPaywall,
    openProPaywall,
  };
}

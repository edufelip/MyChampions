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
import type { RoleIntent } from '@/features/auth/role-selection.logic';
import { getActiveProfessionalStudentCount } from '@/features/professional/professional-source';
import { hasAiAnalysisAccess, type EntitlementStatus } from './subscription.logic';
import {
  createRevenueCatIdentityCoordinator,
  purchasePackage,
  restorePurchases,
  presentAiPaywall,
  presentProPaywall,
  PRO_OFFERING_ID,
  resolveAiUpgradeOfferingId,
  resolveProfessionalOfferingId,
  resolveRevenueCatApiKey,
  resolveRequiredRevenueCatOffering,
  resolveStudentOfferingId,
  mapCustomerInfoToEntitlementStatus,
  mapCustomerInfoToAiEntitlementStatus,
  mapCustomerInfoToProfessionalEntitlementMetadata,
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
import { runPaywallPresentation } from './subscription-paywall-outcome';
import type { SubscriptionPurchaseCapability } from './subscription-runtime';

// ─── SDK identity coordinator ─────────────────────────────────────────────────

const revenueCatIdentityCoordinator = createRevenueCatIdentityCoordinator();

function getRevenueCatExtra(): Record<string, unknown> {
  return (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
}

function getE2ESubscriptionOverride() {
  return resolveE2ESubscriptionOverride({
    activeStudentCount: process.env.EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT,
    aiEntitlementStatus: process.env.EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS,
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    entitlementStatus: process.env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS,
    professionalEntitlementRenewalRisk:
      process.env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK,
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
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      return resolveRevenueCatApiKey(platform, getRevenueCatExtra());
    },
    presentPaywall: async (offeringIdentifier?: string) => {
      // RevenueCatUI.presentPaywall requires a full PurchasesOffering object (not a string ID).
      // Both pro (PRO_OFFERING_ID) and AI (AI_OFFERING_ID) paywalls always supply an identifier,
      // so resolve the exact object and fail closed if provider configuration is incomplete. (D-152)
      const offerings = await Purchases.getOfferings();
      if (!offeringIdentifier) {
        throw new SubscriptionSourceError(
          'configuration',
          'RevenueCat paywall presentation requires an explicit offering.'
        );
      }
      const offering = resolveRequiredRevenueCatOffering(
        offerings.all,
        offeringIdentifier
      );
      return RevenueCatUI.presentPaywall({ offering });
    },
  };
}

// ─── Hook result ──────────────────────────────────────────────────────────────

export type UseSubscriptionResult = {
  purchaseCapability: SubscriptionPurchaseCapability;
  /** Live entitlement status from RevenueCat professional_pro. 'unknown' while loading or on config error. */
  entitlementStatus: EntitlementStatus;
  /**
   * Live entitlement status from RevenueCat student_pro (AI features).
   * 'unknown' while loading or on config error. (D-132)
   */
  aiEntitlementStatus: EntitlementStatus;
  /** RevenueCat expiration timestamp for the active professional entitlement, when present. */
  professionalEntitlementExpiresAt: string | null;
  /** Authoritative RevenueCat cancellation/non-renewal or billing-risk signal. */
  professionalEntitlementRenewalRisk: boolean;
  /**
   * True when the user may use AI meal photo analysis (BL-108, D-132).
   * Derived from hasAiAnalysisAccess(entitlementStatus, aiEntitlementStatus).
   * Only 'active' on either entitlement grants access; 'unknown' is treated as locked.
   */
  hasAiAccess: boolean;
  /** Active student count. Professional screens opt into loading unique active student usage. */
  activeStudentCount: number;
  /** True only after the active-student count was supplied or loaded successfully. */
  isActiveStudentCountKnown: boolean;
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
   * Presents the only AI-upgrade offering allowed for the locked account role.
   * Students use the guarded student offering; professionals use the guarded
   * production/Test Store professional offering.
   * Missing roles fail closed without presenting a paywall.
   */
  openAiUpgradePaywall: (role: RoleIntent | null) => Promise<void>;
  /**
   * Presents the native RevenueCat paywall for the professional subscription (D-152).
   * Uses default_professional in production and the explicitly configured
   * test_professional offering only for development Test Store builds.
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
  const [professionalEntitlementExpiresAt, setProfessionalEntitlementExpiresAt] =
    useState<string | null>(null);
  const [professionalEntitlementRenewalRisk, setProfessionalEntitlementRenewalRisk] =
    useState(false);
  const [activeStudentCount, setActiveStudentCount] = useState(activeStudentCountOverride ?? 0);
  const [isActiveStudentCountKnown, setIsActiveStudentCountKnown] = useState(
    typeof activeStudentCountOverride === 'number'
  );
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
      professionalEntitlementExpiresAt: string | null;
      professionalEntitlementRenewalRisk: boolean;
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

  const applyE2EProSubscriptionAction = useCallback(() => {
    const e2eSubscriptionOverride = getE2ESubscriptionOverride();
    if (!e2eSubscriptionOverride) return false;

    const configuredOutcome = process.env.EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME?.trim().toLowerCase();
    if (configuredOutcome === 'cancelled') {
      setError(null);
      setIsLoading(false);
      return true;
    }
    if (configuredOutcome === 'network' || configuredOutcome === 'store_problem') {
      setError(configuredOutcome);
      setIsLoading(false);
      return true;
    }

    setActiveStudentCount(e2eSubscriptionOverride.activeStudentCount);
    setIsActiveStudentCountKnown(true);
    setEntitlementStatus('active');
    setAiEntitlementStatus(e2eSubscriptionOverride.aiEntitlementStatus);
    setProfessionalEntitlementExpiresAt(null);
    setProfessionalEntitlementRenewalRisk(false);
    setError(null);
    setIsLoading(false);
    setLastSyncedAtIso(new Date().toISOString());
    return true;
  }, []);

  const applyE2EAiSubscriptionSuccess = useCallback(() => {
    const e2eSubscriptionOverride = getE2ESubscriptionOverride();
    if (!e2eSubscriptionOverride) return false;

    setActiveStudentCount(e2eSubscriptionOverride.activeStudentCount);
    setIsActiveStudentCountKnown(true);
    setEntitlementStatus(e2eSubscriptionOverride.entitlementStatus);
    setAiEntitlementStatus('active');
    setProfessionalEntitlementExpiresAt(null);
    setProfessionalEntitlementRenewalRisk(
      e2eSubscriptionOverride.professionalEntitlementRenewalRisk
    );
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
      setProfessionalEntitlementExpiresAt(serverSnapshot.professionalEntitlementExpiresAt);
      setProfessionalEntitlementRenewalRisk(
        serverSnapshot.professionalEntitlementRenewalRisk
      );
      if (serverSnapshot.activeStudentCount !== null) {
        setActiveStudentCount(serverSnapshot.activeStudentCount);
        setIsActiveStudentCountKnown(true);
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
      setIsActiveStudentCountKnown(true);
      setLastSyncedAtIso(new Date().toISOString());
      return;
    }

    if (typeof activeStudentCountOverride === 'number') {
      setActiveStudentCount(activeStudentCountOverride);
      setIsActiveStudentCountKnown(true);
      return;
    }

    if (!activeAuthUid || !loadProfessionalActiveStudentCount) {
      setActiveStudentCount(0);
      setIsActiveStudentCountKnown(false);
      return;
    }

    setIsActiveStudentCountKnown(false);
    let isCancelled = false;
    void getActiveProfessionalStudentCount()
      .then((count) => {
        if (!isCancelled) {
          setActiveStudentCount(count);
          setIsActiveStudentCountKnown(true);
          setLastSyncedAtIso(new Date().toISOString());
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setActiveStudentCount(0);
          setIsActiveStudentCountKnown(false);
        }
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
      setProfessionalEntitlementExpiresAt(null);
      setProfessionalEntitlementRenewalRisk(
        e2eSubscriptionOverride.professionalEntitlementRenewalRisk
      );
      setError(null);
      setLastSyncedAtIso(new Date().toISOString());
      return;
    }

    if (!activeAuthUid) {
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
      setProfessionalEntitlementExpiresAt(null);
      setProfessionalEntitlementRenewalRisk(false);
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
      const professionalMetadata =
        mapCustomerInfoToProfessionalEntitlementMetadata(customerInfo);
      setEntitlementStatus(professionalEntitlementStatus);
      setAiEntitlementStatus(aiEntitlementStatus);
      setProfessionalEntitlementExpiresAt(professionalMetadata.expiresAt);
      setProfessionalEntitlementRenewalRisk(professionalMetadata.renewalRisk);
      syncSnapshot({
        professionalEntitlementStatus,
        aiEntitlementStatus,
        professionalEntitlementExpiresAt: professionalMetadata.expiresAt,
        professionalEntitlementRenewalRisk: professionalMetadata.renewalRisk,
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
      setProfessionalEntitlementExpiresAt(null);
      setProfessionalEntitlementRenewalRisk(false);
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
      if (applyE2EProSubscriptionAction()) return;
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
    [activeAuthUid, applyE2EProSubscriptionAction, deps, fetchStatus, runRevenueCatOperation]
  );

  // Restore action
  const restore = useCallback(async () => {
    if (applyE2EProSubscriptionAction()) return;
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
  }, [activeAuthUid, applyE2EProSubscriptionAction, deps, fetchStatus, runRevenueCatOperation]);

  // Refresh action (manual)
  const refresh = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  // Open AI paywall action (D-132): present native RevenueCat paywall, then refresh.
  const openAiPaywall = useCallback(async (
    studentOfferingId: ReturnType<typeof resolveStudentOfferingId>
  ) => {
    if (!activeAuthUid) return;

    if (applyE2EAiSubscriptionSuccess()) return;
    await runPaywallPresentation({
      present: () =>
        runRevenueCatOperation(() => presentAiPaywall(deps, studentOfferingId)),
      refresh: fetchStatus,
      reportError: setError,
      isCurrent: () => currentAuthUidRef.current === activeAuthUid,
    });
  }, [activeAuthUid, applyE2EAiSubscriptionSuccess, deps, fetchStatus, runRevenueCatOperation]);

  // Open pro paywall action (D-152): present the configured production or
  // development Test Store professional offering, then refresh both entitlement statuses.
  const openProPaywall = useCallback(async () => {
    if (applyE2EProSubscriptionAction()) return;
    if (!activeAuthUid) return;

    let professionalOfferingId: ReturnType<typeof resolveProfessionalOfferingId>;
    try {
      professionalOfferingId = resolveProfessionalOfferingId(getRevenueCatExtra());
    } catch (err: unknown) {
      const reason = err instanceof SubscriptionSourceError ? err.code : 'configuration';
      setError(reason);
      return;
    }

    await runPaywallPresentation({
      present: () => runRevenueCatOperation(() => presentProPaywall(deps, professionalOfferingId)),
      refresh: fetchStatus,
      reportError: setError,
      isCurrent: () => currentAuthUidRef.current === activeAuthUid,
    });
  }, [activeAuthUid, applyE2EProSubscriptionAction, deps, fetchStatus, runRevenueCatOperation]);

  const openAiUpgradePaywall = useCallback(
    async (role: RoleIntent | null) => {
      let offeringId: ReturnType<typeof resolveAiUpgradeOfferingId>;
      try {
        offeringId = resolveAiUpgradeOfferingId(
          role,
          () => resolveStudentOfferingId(getRevenueCatExtra())
        );
      } catch (err: unknown) {
        const reason = err instanceof SubscriptionSourceError ? err.code : 'configuration';
        setError(reason);
        return;
      }

      if (!offeringId) {
        setError('configuration');
        return;
      }

      if (offeringId === PRO_OFFERING_ID) {
        await openProPaywall();
        return;
      }
      await openAiPaywall(offeringId);
    },
    [openAiPaywall, openProPaywall]
  );

  return {
    purchaseCapability: 'native_purchase',
    entitlementStatus,
    aiEntitlementStatus,
    professionalEntitlementExpiresAt,
    professionalEntitlementRenewalRisk,
    hasAiAccess: hasAiAnalysisAccess(entitlementStatus, aiEntitlementStatus),
    activeStudentCount,
    isActiveStudentCountKnown,
    isLoading,
    error,
    lastSyncedAtIso,
    purchase,
    restore,
    refresh,
    openAiUpgradePaywall,
    openProPaywall,
  };
}

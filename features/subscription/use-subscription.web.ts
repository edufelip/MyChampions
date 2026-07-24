import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveE2ESubscriptionOverride } from '@/features/auth/e2e-auth-session';
import type { RoleIntent } from '@/features/auth/role-selection.logic';
import { getActiveProfessionalStudentCount } from '@/features/professional/professional-source';
import type { EntitlementStatus } from './subscription.logic';
import { hasAiAnalysisAccess } from './subscription.logic';
import { getSubscriptionEntitlementSnapshot } from './subscription-server-source';
import type { RawPurchasesPackage, SubscriptionErrorReason } from './subscription-source';
import {
  subscriptionRuntime,
  type SubscriptionPurchaseCapability,
} from './subscription-runtime';

export type UseSubscriptionResult = {
  entitlementStatus: EntitlementStatus;
  aiEntitlementStatus: EntitlementStatus;
  professionalEntitlementExpiresAt: string | null;
  professionalEntitlementRenewalRisk: boolean;
  hasAiAccess: boolean;
  activeStudentCount: number;
  isActiveStudentCountKnown: boolean;
  isLoading: boolean;
  error: SubscriptionErrorReason | null;
  lastSyncedAtIso: string | null;
  purchaseCapability: SubscriptionPurchaseCapability;
  purchase: (pkg: RawPurchasesPackage) => Promise<void>;
  restore: () => Promise<void>;
  refresh: () => Promise<void>;
  openAiUpgradePaywall: (role: RoleIntent | null) => Promise<void>;
  openProPaywall: () => Promise<void>;
};

export type UseSubscriptionOptions = {
  activeStudentCount?: number;
  loadProfessionalActiveStudentCount?: boolean;
};

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

export function useSubscription(
  authUid: string | null,
  optionsOrActiveStudentCount: number | UseSubscriptionOptions = 0
): UseSubscriptionResult {
  const activeAuthUid = authUid?.trim() || null;
  const currentAuthUidRef = useRef<string | null>(activeAuthUid);
  currentAuthUidRef.current = activeAuthUid;
  const activeStudentCountOverride =
    typeof optionsOrActiveStudentCount === 'number'
      ? optionsOrActiveStudentCount
      : optionsOrActiveStudentCount.activeStudentCount;
  const e2eSubscriptionOverride = getE2ESubscriptionOverride();
  const resolvedActiveStudentCountOverride =
    activeStudentCountOverride ?? e2eSubscriptionOverride?.activeStudentCount;
  const loadProfessionalActiveStudentCount =
    typeof optionsOrActiveStudentCount === 'object' &&
    optionsOrActiveStudentCount.loadProfessionalActiveStudentCount === true;
  const shouldLoadProfessionalActiveStudentCount =
    Boolean(activeAuthUid) &&
    loadProfessionalActiveStudentCount &&
    typeof resolvedActiveStudentCountOverride !== 'number';
  const [entitlementStatus, setEntitlementStatus] = useState<EntitlementStatus>('unknown');
  const [aiEntitlementStatus, setAiEntitlementStatus] = useState<EntitlementStatus>('unknown');
  const [professionalEntitlementExpiresAt, setProfessionalEntitlementExpiresAt] =
    useState<string | null>(null);
  const [professionalEntitlementRenewalRisk, setProfessionalEntitlementRenewalRisk] =
    useState(false);
  const [activeStudentCount, setActiveStudentCount] = useState(
    resolvedActiveStudentCountOverride ?? 0
  );
  const [isActiveStudentCountKnown, setIsActiveStudentCountKnown] = useState(
    typeof resolvedActiveStudentCountOverride === 'number'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<SubscriptionErrorReason | null>(null);
  const [lastSyncedAtIso, setLastSyncedAtIso] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const expectedAuthUid = activeAuthUid;
    if (!expectedAuthUid) {
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
      setProfessionalEntitlementExpiresAt(null);
      setProfessionalEntitlementRenewalRisk(false);
      setIsActiveStudentCountKnown(typeof resolvedActiveStudentCountOverride === 'number');
      setIsLoading(false);
      setError(null);
      setLastSyncedAtIso(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await getSubscriptionEntitlementSnapshot(undefined, expectedAuthUid);
      if (currentAuthUidRef.current !== expectedAuthUid) return;
      if (!snapshot) {
        setEntitlementStatus('unknown');
        setAiEntitlementStatus('unknown');
        setProfessionalEntitlementExpiresAt(null);
        setProfessionalEntitlementRenewalRisk(false);
        if (typeof resolvedActiveStudentCountOverride === 'number') {
          setActiveStudentCount(resolvedActiveStudentCountOverride);
          setIsActiveStudentCountKnown(true);
        } else if (!shouldLoadProfessionalActiveStudentCount) {
          setActiveStudentCount(0);
          setIsActiveStudentCountKnown(false);
        }
        setLastSyncedAtIso(null);
        return;
      }
      setEntitlementStatus(snapshot.professionalEntitlementStatus);
      setAiEntitlementStatus(snapshot.aiEntitlementStatus);
      setProfessionalEntitlementExpiresAt(snapshot.professionalEntitlementExpiresAt);
      setProfessionalEntitlementRenewalRisk(snapshot.professionalEntitlementRenewalRisk);
      if (typeof resolvedActiveStudentCountOverride === 'number') {
        setActiveStudentCount(resolvedActiveStudentCountOverride);
        setIsActiveStudentCountKnown(true);
      } else if (!shouldLoadProfessionalActiveStudentCount) {
        setActiveStudentCount(snapshot.activeStudentCount ?? 0);
        setIsActiveStudentCountKnown(snapshot.activeStudentCount !== null);
      }
      setLastSyncedAtIso(snapshot.observedAt || snapshot.updatedAt);
    } catch {
      if (currentAuthUidRef.current !== expectedAuthUid) return;
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
      setProfessionalEntitlementExpiresAt(null);
      setProfessionalEntitlementRenewalRisk(false);
      if (typeof resolvedActiveStudentCountOverride === 'number') {
        setActiveStudentCount(resolvedActiveStudentCountOverride);
        setIsActiveStudentCountKnown(true);
      } else if (!shouldLoadProfessionalActiveStudentCount) {
        setActiveStudentCount(0);
        setIsActiveStudentCountKnown(false);
      }
      setError('network');
      setLastSyncedAtIso(null);
    } finally {
      if (currentAuthUidRef.current === expectedAuthUid) {
        setIsLoading(false);
      }
    }
  }, [
    activeAuthUid,
    resolvedActiveStudentCountOverride,
    shouldLoadProfessionalActiveStudentCount,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof resolvedActiveStudentCountOverride === 'number') {
      setActiveStudentCount(resolvedActiveStudentCountOverride);
      setIsActiveStudentCountKnown(true);
      return;
    }

    if (!activeAuthUid || !loadProfessionalActiveStudentCount) {
      setActiveStudentCount(0);
      setIsActiveStudentCountKnown(false);
      return;
    }

    const expectedAuthUid = activeAuthUid;
    let isCancelled = false;
    setActiveStudentCount(0);
    setIsActiveStudentCountKnown(false);
    void getActiveProfessionalStudentCount()
      .then((count) => {
        if (!isCancelled && currentAuthUidRef.current === expectedAuthUid) {
          setActiveStudentCount(count);
          setIsActiveStudentCountKnown(true);
          setLastSyncedAtIso(new Date().toISOString());
        }
      })
      .catch(() => {
        if (!isCancelled && currentAuthUidRef.current === expectedAuthUid) {
          setActiveStudentCount(0);
          setIsActiveStudentCountKnown(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    activeAuthUid,
    loadProfessionalActiveStudentCount,
    resolvedActiveStudentCountOverride,
  ]);

  const openHandoff = useCallback(async () => {
    try {
      await subscriptionRuntime.openSubscriptionHandoff();
      setError(null);
    } catch {
      setError('configuration');
    }
  }, []);

  const openAiUpgradePaywall = useCallback(
    async (role: RoleIntent | null) => {
      if (role !== 'student' && role !== 'professional') {
        setError('configuration');
        return;
      }
      await openHandoff();
    },
    [openHandoff]
  );

  return {
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
    purchaseCapability: subscriptionRuntime.purchaseCapability,
    purchase: openHandoff,
    restore: openHandoff,
    refresh,
    openAiUpgradePaywall,
    openProPaywall: openHandoff,
  };
}

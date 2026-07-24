import { useCallback, useEffect, useRef, useState } from 'react';

import type { RoleIntent } from '@/features/auth/role-selection.logic';
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

  const refresh = useCallback(async () => {
    const expectedAuthUid = activeAuthUid;
    if (!expectedAuthUid) {
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
      setProfessionalEntitlementExpiresAt(null);
      setProfessionalEntitlementRenewalRisk(false);
      setIsActiveStudentCountKnown(typeof activeStudentCountOverride === 'number');
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
        setActiveStudentCount(activeStudentCountOverride ?? 0);
        setIsActiveStudentCountKnown(typeof activeStudentCountOverride === 'number');
        setLastSyncedAtIso(null);
        return;
      }
      setEntitlementStatus(snapshot.professionalEntitlementStatus);
      setAiEntitlementStatus(snapshot.aiEntitlementStatus);
      setProfessionalEntitlementExpiresAt(snapshot.professionalEntitlementExpiresAt);
      setProfessionalEntitlementRenewalRisk(snapshot.professionalEntitlementRenewalRisk);
      setActiveStudentCount(snapshot.activeStudentCount ?? activeStudentCountOverride ?? 0);
      setIsActiveStudentCountKnown(
        snapshot.activeStudentCount !== null || typeof activeStudentCountOverride === 'number'
      );
      setLastSyncedAtIso(snapshot.observedAt || snapshot.updatedAt);
    } catch {
      if (currentAuthUidRef.current !== expectedAuthUid) return;
      setEntitlementStatus('unknown');
      setAiEntitlementStatus('unknown');
      setProfessionalEntitlementExpiresAt(null);
      setProfessionalEntitlementRenewalRisk(false);
      setIsActiveStudentCountKnown(typeof activeStudentCountOverride === 'number');
      setError('network');
      setLastSyncedAtIso(null);
    } finally {
      if (currentAuthUidRef.current === expectedAuthUid) {
        setIsLoading(false);
      }
    }
  }, [activeAuthUid, activeStudentCountOverride]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

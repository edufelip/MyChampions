/**
 * SC-212 Professional Subscription Gate
 * Route: /professional/subscription
 *
 * Shows entitlement status, active-student cap usage, and exposes
 * purchase / restore CTAs.
 *
 * RevenueCat wiring is deferred — subscription state is stubbed as 'unknown'.
 * Purchase / restore actions are no-ops until RevenueCat SDK is connected.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-212-professional-subscription-gate.md
 * Refs: D-009–D-011, D-024, D-043, D-075, FR-126–129, FR-156, FR-185, FR-215, FR-217
 *       BR-218–221, BR-228, BR-247, BR-273, BR-275
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import {
  resolveSubscriptionState,
  isPlanUpdateLocked,
  FREE_STUDENT_CAP,
  type EntitlementStatus,
} from '@/features/subscription/subscription.logic';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfessionalSubscriptionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();

  // Stubbed entitlement — RevenueCat wiring deferred.
  // useState<T> prevents TypeScript from narrowing to a literal type, which
  // would make comparisons to other union members a type error.
  const [stubbedEntitlement] = useState<EntitlementStatus>('unknown');
  const [stubbedActiveStudentCount] = useState<number>(0);

  const subState = resolveSubscriptionState({
    activeStudentCount: stubbedActiveStudentCount,
    entitlementStatus: stubbedEntitlement,
  });

  const isLocked = isPlanUpdateLocked(subState);

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner || isLocked;

  // Loading stub — true while RevenueCat SDK initialises (deferred)
  const isLoading = stubbedEntitlement === 'unknown';

  const statusLabel =
    stubbedEntitlement === 'active'
      ? t('pro.subscription.status.active')
      : stubbedEntitlement === 'lapsed'
        ? t('pro.subscription.status.inactive')
        : t('pro.subscription.status.unknown');

  const statusColor =
    stubbedEntitlement === 'active'
      ? '#16a34a'
      : stubbedEntitlement === 'lapsed'
        ? '#b3261e'
        : palette.icon;

  const capLabel = (t('pro.subscription.cap_usage') as string)
    .replace('{count}', String(stubbedActiveStudentCount))
    .replace('{limit}', String(FREE_STUDENT_CAP));

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="pro.subscription.screen">
      <Stack.Screen options={{ title: t('pro.subscription.title'), headerShown: true }} />

      {/* Offline banner (BL-008) */}
      {offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
          testID="pro.subscription.offlineBanner">
          <Text style={[styles.offlineBannerText, { color: palette.text }]}>
            {t('offline.banner')}
          </Text>
        </View>
      ) : null}

      {/* Status card */}
      <View
        style={[styles.card, { borderColor: palette.tint + '66' }]}
        testID="pro.subscription.statusCard">
        <Text style={[styles.cardTitle, { color: palette.text }]}>
          {t('pro.subscription.title')}
        </Text>

        {isLoading ? (
          <ActivityIndicator
            testID="pro.subscription.loading"
            accessibilityLabel={t('a11y.loading.default') as string}
          />
        ) : (
          <Text
            style={[styles.statusBadge, { color: statusColor }]}
            accessibilityLabel={`${t('pro.subscription.title') as string}: ${statusLabel as string}`}>
            {statusLabel}
          </Text>
        )}

        <Text style={[styles.meta, { color: palette.icon }]}>{capLabel}</Text>
        <Text style={[styles.meta, { color: palette.icon }]}>{t('pro.subscription.free_tier')}</Text>
      </View>

      {/* Pre-lapse warning (BL-009) */}
      {subState.isPreLapseWarningVisible ? (
        <View
          style={[styles.warningBanner, { borderColor: '#f59e0b' }]}
          testID="pro.subscription.warning"
          accessibilityRole="alert">
          <Text style={[styles.warningTitle, { color: palette.text }]}>
            {t('pro.subscription.pre_lapse.title')}
          </Text>
          <Text style={[styles.warningText, { color: palette.text }]}>
            {t('pro.subscription.pre_lapse.body')}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isWriteLocked}
            onPress={() => {
              // RevenueCat renew call deferred (pending-wiring-checklist-v1.md)
            }}
            style={[styles.renewButton, { borderColor: '#f59e0b', opacity: isWriteLocked ? 0.4 : 1 }]}
            testID="pro.subscription.renewCta">
            <Text style={[styles.renewButtonText, { color: '#b45309' }]}>
              {t('pro.subscription.pre_lapse.cta_renew')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Locked notice */}
      {isLocked ? (
        <View
          style={[styles.lockBanner, { borderColor: '#b3261e' }]}
          testID="pro.subscription.locked"
          accessibilityRole="alert">
          <Text style={[styles.errorText, { color: '#b3261e' }]}>
            {t('pro.subscription.locked')}
          </Text>
        </View>
      ) : null}

      {/* Purchase note */}
      <Text style={[styles.purchaseNote, { color: palette.icon }]}>
        {t('pro.subscription.purchase_note')}
      </Text>

      {/* CTAs */}
      <Pressable
        accessibilityRole="button"
        disabled={isWriteLocked}
        onPress={() => {
          // RevenueCat purchase call deferred (pending-wiring-checklist-v1.md)
        }}
        style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isWriteLocked ? 0.4 : 1 }]}
        testID="pro.subscription.purchaseCta">
        <Text style={styles.primaryButtonText}>{t('pro.subscription.cta_purchase')}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={isWriteLocked}
        onPress={() => {
          // RevenueCat restore call deferred (pending-wiring-checklist-v1.md)
        }}
        style={[styles.outlineButton, { borderColor: palette.icon, opacity: isWriteLocked ? 0.4 : 1 }]}
        testID="pro.subscription.restoreCta">
        <Text style={[styles.outlineButtonText, { color: palette.icon }]}>
          {t('pro.subscription.cta_restore')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => {
          // Refresh entitlement from RevenueCat — deferred
        }}
        style={[styles.ghostButton]}
        testID="pro.subscription.refreshCta">
        <Text style={[styles.ghostButtonText, { color: palette.tint }]}>
          {t('pro.subscription.cta_refresh')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 16 },
  card: { borderRadius: 12, borderWidth: 1.5, gap: 8, padding: 16 },
  cardTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  statusBadge: { fontSize: 20, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
  warningBanner: {
    backgroundColor: '#f59e0b22',
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  warningTitle: { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  warningText: { fontSize: 13, lineHeight: 18 },
  renewButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 40,
    marginTop: 4,
  },
  renewButtonText: { fontSize: 14, fontWeight: '700' },
  lockBanner: {
    backgroundColor: '#b3261e11',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  errorText: { fontSize: 13 },
  purchaseNote: { fontSize: 12, textAlign: 'center' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  outlineButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 48,
  },
  outlineButtonText: { fontSize: 15, fontWeight: '600' },
  ghostButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  ghostButtonText: { fontSize: 14, fontWeight: '600' },
  offlineBanner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  offlineBannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
});

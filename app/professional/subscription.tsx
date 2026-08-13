/**
 * SC-212 Professional Subscription Gate
 * Route: /professional/subscription
 *
 * Shows entitlement status, active-student cap usage, and exposes
 * purchase / restore CTAs.
 *
 * RevenueCat SDK and unique active-student usage are wired via useSubscription.
 *
 * Docs: docs/screens/v2/SC-212-professional-subscription-gate.md
 * Refs: D-009–D-011, D-024, D-043, D-075, D-128, D-134, FR-126–129, FR-156, FR-185, FR-215, FR-217
 *       BR-218–221, BR-228, BR-247, BR-273, BR-275
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  type OfflineDisplayState,
  resolveOfflineDisplayState,
} from '@/features/offline/offline.logic';
import { resolveLatestSyncTimestamp } from '@/features/offline/sync-timestamps.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import {
  FREE_STUDENT_CAP,
  isPlanUpdateLocked,
  resolveLockedRecoveryMessageKey,
  resolveSubscriptionState,
  resolveSubscriptionStatusPresentation,
} from '@/features/subscription/subscription.logic';
import { useSubscription } from '@/features/subscription/use-subscription';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function ProfessionalSubscriptionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();

  const {
    entitlementStatus,
    professionalEntitlementRenewalRisk,
    activeStudentCount,
    isActiveStudentCountKnown,
    isLoading,
    error,
    restore,
    refresh,
    openProPaywall,
    purchaseCapability,
    lastSyncedAtIso: subscriptionSyncedAtIso,
  } = useSubscription(currentUser?.uid ?? null, { loadProfessionalActiveStudentCount: true });

  const subState = resolveSubscriptionState({
    activeStudentCount,
    entitlementStatus,
    isExpiringSoon: professionalEntitlementRenewalRisk,
  });
  const isLocked = isPlanUpdateLocked(subState);

  const networkStatus = useNetworkStatus();
  const lastSyncedAtIso = resolveLatestSyncTimestamp([subscriptionSyncedAtIso]);
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso,
  });
  const isSubscriptionActionDisabled = offlineDisplay.showOfflineBanner || isLoading;
  const isPurchaseUnavailable = purchaseCapability === 'unavailable';
  const statusPresentation = resolveSubscriptionStatusPresentation({
    entitlementStatus,
    isLoading,
    hasError: error !== null,
  });

  const statusLabel =
    statusPresentation === 'active'
      ? t('pro.subscription.status.active')
      : statusPresentation === 'inactive'
        ? t('pro.subscription.status.inactive')
        : t('pro.subscription.status.unknown');

  const statusColor =
    statusPresentation === 'active'
      ? theme.color.success
      : statusPresentation === 'inactive'
        ? theme.color.danger
        : theme.color.textSecondary;
  const statusBackground =
    statusPresentation === 'active'
      ? theme.color.successSoft
      : statusPresentation === 'inactive'
        ? theme.color.dangerSoft
        : theme.color.surfaceMuted;
  const statusIcon: keyof typeof MaterialIcons.glyphMap =
    statusPresentation === 'active'
      ? 'check-circle'
      : statusPresentation === 'inactive'
        ? 'error-outline'
        : 'help-outline';
  const statusBody =
    statusPresentation === 'active'
      ? t('pro.subscription.status.active_body')
      : statusPresentation === 'inactive'
        ? t('pro.subscription.status.inactive_body')
        : t('pro.subscription.status.unavailable_body');

  const hasCapacityData = isActiveStudentCountKnown;
  const capLabel = (t('pro.subscription.cap_usage'))
    .replace(
      '{count}',
      hasCapacityData ? String(activeStudentCount) : t('common.value.unavailable'),
    )
    .replace('{limit}', String(FREE_STUDENT_CAP));
  const capProgress = hasCapacityData
    ? Math.min(100, (activeStudentCount / FREE_STUDENT_CAP) * 100)
    : 0;

  return (
    <DsScreen
      scheme={scheme}
      contentWidth="form"
      withBlobs={false}
      testID="pro.subscription.screen"
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: t('pro.subscription.title'), headerShown: false }} />

      <DsBackButton
        scheme={scheme}
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }

          router.replace('/');
        }}
        accessibilityLabel={t('auth.role.cta_back')}
        style={styles.backButton}
        testID="pro.subscription.backButton"
      />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner')}
          testID="pro.subscription.offlineBanner"
        />
      ) : null}

      <View style={styles.pageIntro}>
        <Text
          accessibilityRole="header"
          style={[styles.screenTitle, { color: theme.color.textPrimary }]}
        >
          {t('pro.subscription.title')}
        </Text>
        <Text style={[styles.screenSubtitle, { color: theme.color.textSecondary }]}>
          {t('pro.subscription.subtitle')}
        </Text>
      </View>

      <DsCard scheme={scheme} testID="pro.subscription.statusCard" style={styles.statusCard}>
        <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>
          {t('pro.subscription.current_status')}
        </Text>

        {isLoading ? (
          <View style={styles.loadingRow} testID="pro.subscription.loading">
            <ActivityIndicator
              accessibilityLabel={t('a11y.loading.default')}
              color={theme.color.accentPrimary}
            />
            <Text style={[styles.statusBody, { color: theme.color.textSecondary }]}>
              {t('pro.subscription.status.checking')}
            </Text>
          </View>
        ) : (
          <>
            <View
              accessible
              accessibilityLabel={`${t('pro.subscription.title')}: ${statusLabel}`}
              style={[styles.statusBadge, { backgroundColor: statusBackground }]}
              testID="pro.subscription.statusValue"
            >
              <MaterialIcons color={statusColor} name={statusIcon} size={18} />
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            <Text style={[styles.statusBody, { color: theme.color.textSecondary }]}>
              {statusBody}
            </Text>
          </>
        )}

        <View style={[styles.divider, { backgroundColor: theme.color.border }]} />
        <View style={styles.capacityHeader}>
          <Text style={[styles.capacityTitle, { color: theme.color.textPrimary }]}>
            {t('pro.subscription.capacity_title')}
          </Text>
          <Text
            style={[
              styles.capacityValue,
              { color: isLocked ? theme.color.danger : theme.color.textPrimary },
            ]}
            testID="pro.subscription.capUsage"
          >
            {capLabel}
          </Text>
        </View>
        <View
          accessibilityLabel={t('pro.subscription.capacity_title')}
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: FREE_STUDENT_CAP,
            now: hasCapacityData ? Math.min(activeStudentCount, FREE_STUDENT_CAP) : undefined,
            text: capLabel,
          }}
          style={[styles.capacityTrack, { backgroundColor: theme.color.surfaceMuted }]}
        >
          <View
            style={[
              styles.capacityFill,
              {
                backgroundColor: isLocked ? theme.color.danger : theme.color.accentPrimary,
                width: `${capProgress}%`,
              },
            ]}
          />
        </View>
        <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
          {t('pro.subscription.free_tier')}
        </Text>
      </DsCard>

      {subState.isPreLapseWarningVisible ? (
        <DsCard
          scheme={scheme}
          variant="warning"
          testID="pro.subscription.warning"
          style={styles.warningCard}
        >
          <Text style={[styles.warningTitle, { color: theme.color.textPrimary }]}>
            {t('pro.subscription.pre_lapse.title')}
          </Text>
          <Text style={[styles.warningText, { color: theme.color.textPrimary }]}>
            {t('pro.subscription.pre_lapse.body')}
          </Text>
          <DsPillButton
            scheme={scheme}
            variant="outline"
            disabled={isSubscriptionActionDisabled || isPurchaseUnavailable}
            onPress={() => void openProPaywall()}
            label={t('pro.subscription.pre_lapse.cta_renew')}
            testID="pro.subscription.renewCta"
          />
        </DsCard>
      ) : null}

      {isLocked ? (
        <DsCard scheme={scheme} variant="warning" testID="pro.subscription.locked">
          <Text style={[styles.errorText, { color: theme.color.danger }]}>
            {t(
              resolveLockedRecoveryMessageKey({
                entitlementStatus,
                purchaseCapability,
              }),
            )}
          </Text>
        </DsCard>
      ) : null}

      {isPurchaseUnavailable ? (
        <DsCard
          scheme={scheme}
          variant="muted"
          style={styles.capabilityCard}
          testID="pro.subscription.capabilityUnavailable"
        >
          <MaterialIcons color={theme.color.textSecondary} name="info-outline" size={20} />
          <Text style={[styles.capabilityText, { color: theme.color.textSecondary }]}>
            {t('pro.subscription.unavailable_note')}
          </Text>
        </DsCard>
      ) : (
        <>
          <Text style={[styles.purchaseNote, { color: theme.color.textSecondary }]}>
            {t(
              purchaseCapability === 'native_purchase'
                ? 'pro.subscription.purchase_note'
                : 'pro.subscription.handoff_note',
            )}
          </Text>

          <DsPillButton
            scheme={scheme}
            disabled={isSubscriptionActionDisabled}
            loading={isLoading}
            onPress={() => {
              void openProPaywall();
            }}
            label={
              t(
                purchaseCapability === 'native_purchase'
                  ? 'pro.subscription.cta_purchase'
                  : 'pro.subscription.cta_mobile_handoff',
              )
            }
            testID="pro.subscription.purchaseCta"
          />

          {purchaseCapability === 'native_purchase' ? (
            <DsPillButton
              scheme={scheme}
              variant="secondary"
              disabled={isSubscriptionActionDisabled}
              onPress={() => void restore()}
              label={t('pro.subscription.cta_restore')}
              testID="pro.subscription.restoreCta"
            />
          ) : null}
        </>
      )}

      <DsPillButton
        scheme={scheme}
        variant="ghost"
        disabled={offlineDisplay.showOfflineBanner || isLoading}
        onPress={() => void refresh()}
        label={t('pro.subscription.cta_refresh')}
        testID="pro.subscription.refreshCta"
      />
    </DsScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: DsSpace.lg,
    padding: DsSpace.lg,
    paddingBottom: DsSpace.xxl,
  },
  backButton: { marginBottom: -4 },
  pageIntro: { gap: 4 },
  screenTitle: {
    ...DsTypography.screenTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  screenSubtitle: {
    ...DsTypography.body,
    lineHeight: 21,
  },
  statusCard: {
    gap: DsSpace.sm,
  },
  cardTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  loadingRow: { alignItems: 'center', flexDirection: 'row', gap: DsSpace.sm, minHeight: 34 },
  statusBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusBody: { ...DsTypography.caption, lineHeight: 19 },
  divider: { height: 1, marginVertical: DsSpace.xs },
  capacityHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.sm,
    justifyContent: 'space-between',
  },
  capacityTitle: { ...DsTypography.body, fontWeight: '700' },
  capacityValue: { ...DsTypography.caption, fontWeight: '700' },
  capacityTrack: { borderRadius: 999, height: 8, overflow: 'hidden' },
  capacityFill: { borderRadius: 999, height: '100%' },
  meta: {
    ...DsTypography.caption,
  },
  warningCard: {
    gap: DsSpace.xs,
  },
  warningTitle: {
    ...DsTypography.body,
    fontWeight: '700',
  },
  warningText: {
    ...DsTypography.caption,
  },
  errorText: {
    ...DsTypography.caption,
  },
  capabilityCard: { alignItems: 'center', flexDirection: 'row', gap: DsSpace.sm },
  capabilityText: { ...DsTypography.caption, flex: 1, lineHeight: 19 },
  purchaseNote: {
    ...DsTypography.caption,
    textAlign: 'center',
  },
});

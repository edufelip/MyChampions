/**
 * SC-212 Professional Subscription Gate
 * Route: /professional/subscription
 *
 * Shows entitlement status, active-student cap usage, and exposes
 * purchase / restore CTAs.
 *
 * RevenueCat SDK is now wired via useSubscription (D-128).
 * Active student count is still stubbed at 0 pending Data Connect roster endpoint.
 *
 * Docs: docs/screens/v2/SC-212-professional-subscription-gate.md
 * Refs: D-009–D-011, D-024, D-043, D-075, D-128, D-134, FR-126–129, FR-156, FR-185, FR-215, FR-217
 *       BR-218–221, BR-228, BR-247, BR-273, BR-275
 */
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';

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
import { useNetworkStatus } from '@/features/offline/use-network-status';
import {
  FREE_STUDENT_CAP,
  isPlanUpdateLocked,
  resolveSubscriptionState,
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

  const { entitlementStatus, activeStudentCount, isLoading, purchase, restore, refresh } =
    useSubscription(Boolean(currentUser));

  const subState = resolveSubscriptionState({ activeStudentCount, entitlementStatus });
  const isLocked = isPlanUpdateLocked(subState);

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner || isLocked;

  const statusLabel =
    entitlementStatus === 'active'
      ? t('pro.subscription.status.active')
      : entitlementStatus === 'lapsed'
      ? t('pro.subscription.status.inactive')
      : t('pro.subscription.status.unknown');

  const statusColor =
    entitlementStatus === 'active'
      ? theme.color.success
      : entitlementStatus === 'lapsed'
      ? theme.color.danger
      : theme.color.textSecondary;

  const capLabel = (t('pro.subscription.cap_usage') as string)
    .replace('{count}', String(activeStudentCount))
    .replace('{limit}', String(FREE_STUDENT_CAP));

  return (
    <DsScreen scheme={scheme} testID="pro.subscription.screen" contentContainerStyle={styles.content}>
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
        accessibilityLabel={t('auth.role.cta_back') as string}
        style={styles.backButton}
        testID="pro.subscription.backButton"
      />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner') as string}
          testID="pro.subscription.offlineBanner"
        />
      ) : null}

      <DsCard scheme={scheme} testID="pro.subscription.statusCard" style={styles.statusCard}>
        <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>{t('pro.subscription.title')}</Text>

        {isLoading ? (
          <ActivityIndicator
            testID="pro.subscription.loading"
            accessibilityLabel={t('a11y.loading.default') as string}
            color={theme.color.accentPrimary}
          />
        ) : (
          <Text
            style={[styles.statusBadge, { color: statusColor }]}
            accessibilityLabel={`${t('pro.subscription.title') as string}: ${statusLabel as string}`}>
            {statusLabel}
          </Text>
        )}

        <Text style={[styles.meta, { color: theme.color.textSecondary }]}>{capLabel}</Text>
        <Text style={[styles.meta, { color: theme.color.textSecondary }]}>{t('pro.subscription.free_tier')}</Text>
      </DsCard>

      {subState.isPreLapseWarningVisible ? (
        <DsCard
          scheme={scheme}
          variant="warning"
          testID="pro.subscription.warning"
          style={styles.warningCard}>
          <Text style={[styles.warningTitle, { color: theme.color.textPrimary }]}>
            {t('pro.subscription.pre_lapse.title')}
          </Text>
          <Text style={[styles.warningText, { color: theme.color.textPrimary }]}>
            {t('pro.subscription.pre_lapse.body')}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isWriteLocked}
            onPress={() => void refresh()}
            style={[
              styles.renewButton,
              {
                borderColor: theme.color.warning,
                opacity: isWriteLocked ? 0.4 : 1,
                backgroundColor: theme.color.surface,
              },
            ]}
            testID="pro.subscription.renewCta">
            <Text style={[styles.renewButtonText, { color: theme.color.warning }]}>
              {t('pro.subscription.pre_lapse.cta_renew')}
            </Text>
          </Pressable>
        </DsCard>
      ) : null}

      {isLocked ? (
        <DsCard scheme={scheme} variant="warning" testID="pro.subscription.locked">
          <Text style={[styles.errorText, { color: theme.color.danger }]}>{t('pro.subscription.locked')}</Text>
        </DsCard>
      ) : null}

      <Text style={[styles.purchaseNote, { color: theme.color.textSecondary }]}>
        {t('pro.subscription.purchase_note')}
      </Text>

      <DsPillButton
        scheme={scheme}
        disabled={isWriteLocked}
        onPress={() => {
          void purchase(undefined);
        }}
        label={t('pro.subscription.cta_purchase') as string}
        testID="pro.subscription.purchaseCta"
      />

      <DsPillButton
        scheme={scheme}
        variant="secondary"
        disabled={isWriteLocked}
        onPress={() => void restore()}
        label={t('pro.subscription.cta_restore') as string}
        testID="pro.subscription.restoreCta"
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => void refresh()}
        style={styles.ghostButton}
        testID="pro.subscription.refreshCta">
        <Text style={[styles.ghostButtonText, { color: theme.color.accentPrimary }]}>
          {t('pro.subscription.cta_refresh')}
        </Text>
      </Pressable>
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
  statusCard: {
    gap: DsSpace.xs,
  },
  cardTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  statusBadge: {
    fontSize: 20,
    fontWeight: '700',
  },
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
  renewButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 40,
    marginTop: 4,
  },
  renewButtonText: {
    ...DsTypography.body,
    fontWeight: '700',
  },
  errorText: {
    ...DsTypography.caption,
  },
  purchaseNote: {
    ...DsTypography.caption,
    textAlign: 'center',
  },
  ghostButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  ghostButtonText: {
    ...DsTypography.body,
    fontWeight: '700',
  },
});

/**
 * SC-204 Professional Home Dashboard
 * Route: /professional/home
 *
 * Control center for professionals:
 *  - Invite code display, share, and rotation (with confirmation)
 *  - Active student count + pending request count widgets
 *  - Subscription pre-lapse warning + entitlement lock notice
 *  - CTAs to student roster, pending requests, subscription
 *  - Offline read-only banner + write-lock feedback
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useInviteCode } from '@/features/professional/use-professional';
import {
  resolveSubscriptionState,
  isPlanUpdateLocked,
} from '@/features/subscription/subscription.logic';
import { useSubscription } from '@/features/subscription/use-subscription';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
  type StaleElapsed,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function ProfessionalHomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });

  const { state: codeState, rotate } = useInviteCode(Boolean(currentUser));
  const { entitlementStatus, activeStudentCount } = useSubscription(Boolean(currentUser));
  const subState = resolveSubscriptionState({
    activeStudentCount,
    entitlementStatus,
  });
  const isWriteLocked = isPlanUpdateLocked(subState) || offlineDisplay.showOfflineBanner;

  const [rotateError, setRotateError] = useState<string | null>(null);

  function confirmRotate() {
    Alert.alert(
      t('pro.home.invite_code.rotate_confirm_title') as string,
      t('pro.home.invite_code.rotate_confirm_body') as string,
      [
        {
          text: t('pro.home.invite_code.rotate_confirm_no') as string,
          style: 'cancel',
        },
        {
          text: t('pro.home.invite_code.rotate_confirm_yes') as string,
          onPress: async () => {
            setRotateError(null);
            const err = await rotate();
            if (err) {
              setRotateError(t('pro.home.invite_code.rotate_error') as string);
            }
          },
        },
      ]
    );
  }

  async function handleShareCode(code: string) {
    await Share.share({ message: code });
  }

  const codeValue =
    codeState.kind === 'ready' && codeState.displayCode.kind === 'active'
      ? codeState.displayCode.code.codeValue
      : null;

  return (
    <DsScreen scheme={scheme} testID="pro.home.screen" contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('pro.home.title'), headerShown: true }} />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner scheme={scheme} text={buildOfflineText(offlineDisplay.staleElapsed, t)} testID="pro.home.offlineBanner" />
      ) : null}

      {subState.isPreLapseWarningVisible ? (
        <DsCard
          scheme={scheme}
          variant="warning"
          testID="pro.home.subscriptionWarning"
          style={styles.warningBanner}>
          <Text style={[styles.warningText, { color: theme.color.textPrimary }]}>
            {t('pro.home.subscription.warning')}
          </Text>
          <DsPillButton
            scheme={scheme}
            label={t('pro.home.subscription.cta_renew') as string}
            variant="secondary"
            onPress={() => router.push('/professional/subscription')}
            fullWidth={false}
            style={styles.warningCta}
            testID="pro.home.subscriptionRenewCta"
          />
        </DsCard>
      ) : null}

      {isWriteLocked && !offlineDisplay.showOfflineBanner ? (
        <DsCard scheme={scheme} testID="pro.home.entitlementLock">
          <Text style={[styles.errorText, { color: theme.color.danger }]}>{t('pro.home.entitlement_lock')}</Text>
        </DsCard>
      ) : null}

      <View style={styles.statsRow}>
        <StatCard
          label={t('pro.home.active_students') as string}
          value={String(activeStudentCount)}
          scheme={scheme}
          testID="pro.home.activeStudents"
        />
        <StatCard
          label={t('pro.home.pending_requests') as string}
          value="—"
          scheme={scheme}
          testID="pro.home.pendingRequests"
        />
      </View>

      <DsCard scheme={scheme} testID="pro.home.inviteCodeCard" style={styles.inviteCard}>
        <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>{t('pro.home.invite_code.title')}</Text>

        {codeState.kind === 'loading' ? (
          <ActivityIndicator
            testID="pro.home.inviteCodeLoading"
            accessibilityLabel={t('a11y.loading.invite_code') as string}
            color={theme.color.accentPrimary}
          />
        ) : codeState.kind === 'ready' ? (
          <>
            {codeValue ? (
              <Text
                style={[styles.inviteCode, { color: theme.color.accentPrimary }]}
                testID="pro.home.inviteCodeValue"
                accessibilityLabel={`${t('pro.home.invite_code.title')}: ${codeValue}`}>
                {codeValue}
              </Text>
            ) : (
              <Text style={[styles.meta, { color: theme.color.textSecondary }]}>{t('pro.home.invite_code.empty')}</Text>
            )}

            {rotateError ? (
              <Text style={[styles.errorText, { color: theme.color.danger }]}>{rotateError}</Text>
            ) : null}

            <View style={styles.codeActionsRow}>
              {codeValue ? (
                <DsPillButton
                  scheme={scheme}
                  variant="secondary"
                  label={t('pro.home.invite_code.share') as string}
                  onPress={() => {
                    void handleShareCode(codeValue);
                  }}
                  fullWidth={false}
                  style={styles.outlineButtonCompact}
                  testID="pro.home.shareCodeCta"
                />
              ) : null}

              <DsPillButton
                scheme={scheme}
                variant="secondary"
                label={t('pro.home.invite_code.rotate') as string}
                onPress={confirmRotate}
                fullWidth={false}
                style={styles.outlineButtonCompact}
                testID="pro.home.rotateCodeCta"
              />
            </View>
          </>
        ) : codeState.kind === 'error' ? (
          <Text style={[styles.errorText, { color: theme.color.danger }]}>{t('pro.home.error')}</Text>
        ) : null}
      </DsCard>

      <DsPillButton
        scheme={scheme}
        label={t('pro.home.cta_roster') as string}
        onPress={() => router.push('/professional/students')}
        testID="pro.home.rosterCta"
      />

      <DsPillButton
        scheme={scheme}
        variant="secondary"
        label={t('pro.home.cta_pending') as string}
        onPress={() => router.push('/professional/pending')}
        testID="pro.home.pendingCta"
      />
    </DsScreen>
  );
}

function buildOfflineText(
  staleElapsed: StaleElapsed | null,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!staleElapsed) {
    return t('offline.banner') as string;
  }

  const stalePart =
    staleElapsed.unit === 'minutes'
      ? (t('offline.stale_minutes') as string).replace('{value}', String(staleElapsed.value))
      : staleElapsed.unit === 'hours'
      ? (t('offline.stale_hours') as string).replace('{value}', String(staleElapsed.value))
      : (t('offline.stale_days') as string).replace('{value}', String(staleElapsed.value));

  return `${t('offline.banner')} • ${stalePart}`;
}

function StatCard({
  label,
  value,
  scheme,
  testID,
}: {
  label: string;
  value: string;
  scheme: 'light' | 'dark';
  testID: string;
}) {
  const theme = getDsTheme(scheme);

  return (
    <DsCard scheme={scheme} style={styles.statCard} testID={testID}>
      <Text style={[styles.statValue, { color: theme.color.accentPrimary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.color.textSecondary }]}>{label}</Text>
    </DsCard>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 16 },
  warningBanner: {
    gap: 6,
  },
  warningCta: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  warningText: {
    ...DsTypography.caption,
  },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  statValue: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
  },
  statLabel: { fontSize: 12, textAlign: 'center' },
  inviteCard: { gap: 10 },
  cardTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '700',
  },
  inviteCode: { fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  codeActionsRow: { flexDirection: 'row', gap: 12 },
  outlineButtonCompact: {
    flex: 1,
    minHeight: 48,
  },
  meta: { ...DsTypography.caption },
  errorText: { ...DsTypography.caption },
});

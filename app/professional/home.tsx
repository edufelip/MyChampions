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
import { MaterialIcons } from '@expo/vector-icons';
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
import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
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
      <Stack.Screen options={{ title: t('pro.home.title'), headerShown: false }} />

      <View style={styles.heroWrap}>
        <Text style={[styles.screenTitle, { color: theme.color.textPrimary }]}>{t('pro.home.title')}</Text>
        <View
          style={[
            styles.contextPill,
            {
              backgroundColor: subState.isPreLapseWarningVisible
                ? theme.color.warningSoft
                : theme.color.accentBlueSoft,
              borderColor: subState.isPreLapseWarningVisible
                ? theme.color.warning
                : theme.color.accentBlue,
            },
          ]}>
          <MaterialIcons
            name={subState.isPreLapseWarningVisible ? 'warning-amber' : 'verified-user'}
            size={16}
            color={subState.isPreLapseWarningVisible ? theme.color.warning : theme.color.accentBlue}
          />
          <Text
            style={[
              styles.contextPillText,
              {
                color: subState.isPreLapseWarningVisible
                  ? theme.color.warning
                  : theme.color.accentBlue,
              },
            ]}>
            {subState.isPreLapseWarningVisible
              ? t('pro.subscription.pre_lapse.title')
              : t('pro.subscription.cap_usage')
                  .replace('{count}', String(activeStudentCount))
                  .replace('{limit}', '10')}
          </Text>
        </View>
      </View>

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
            variant="outline"
            size="sm"
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
          iconName="groups"
          testID="pro.home.activeStudents"
        />
        <StatCard
          label={t('pro.home.pending_requests') as string}
          value="—"
          scheme={scheme}
          iconName="schedule-send"
          testID="pro.home.pendingRequests"
        />
      </View>

      <DsCard scheme={scheme} testID="pro.home.inviteCodeCard" style={styles.inviteCard} variant="muted">
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.cardHeaderIconWrap,
              { backgroundColor: theme.color.accentPrimarySoft, borderColor: theme.color.accentPrimary },
            ]}>
            <MaterialIcons name="group-add" size={18} color={theme.color.accentPrimary} />
          </View>
          <View style={styles.cardHeaderCopy}>
            <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>
              {t('pro.home.invite_code.title')}
            </Text>
            <Text style={[styles.cardSubtitle, { color: theme.color.textSecondary }]}>
              {t('pro.home.invite_code.careful_sharing')}
            </Text>
          </View>
        </View>

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
                  variant="primary"
                  size="xs"
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
                variant="primary"
                size="xs"
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

      <View style={styles.footerActions}>
        <DsPillButton
          scheme={scheme}
          variant="outline"
          size="sm"
          label={t('pro.home.cta_pending') as string}
          onPress={() => router.push('/professional/pending')}
          testID="pro.home.pendingCta"
          style={styles.footerAction}
        />
        <DsPillButton
          scheme={scheme}
          variant="outline"
          size="sm"
          label={t('pro.subscription.title') as string}
          onPress={() => router.push('/professional/subscription')}
          testID="pro.home.subscriptionCta"
          style={styles.footerAction}
        />
      </View>
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
  iconName,
  testID,
}: {
  label: string;
  value: string;
  scheme: 'light' | 'dark';
  iconName: keyof typeof MaterialIcons.glyphMap;
  testID: string;
}) {
  const theme = getDsTheme(scheme);

  return (
    <DsCard scheme={scheme} style={styles.statCard} testID={testID}>
      <View style={[styles.statIconWrap, { backgroundColor: theme.color.accentPrimarySoft }]}>
        <MaterialIcons color={theme.color.accentPrimary} name={iconName} size={16} />
      </View>
      <Text style={[styles.statValue, { color: theme.color.accentPrimary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.color.textSecondary }]}>{label}</Text>
    </DsCard>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: DsSpace.md,
    paddingBottom: DsSpace.xxl,
    paddingHorizontal: DsSpace.lg,
    paddingTop: DsSpace.lg,
  },
  heroWrap: {
    gap: DsSpace.xs,
    marginBottom: DsSpace.xs,
  },
  screenTitle: {
    ...DsTypography.title,
    fontFamily: Fonts.rounded,
    fontSize: 30,
    lineHeight: 36,
  },
  screenSubtitle: {
    ...DsTypography.body,
  },
  contextPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
    paddingHorizontal: DsSpace.sm,
    paddingVertical: 6,
  },
  contextPillText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  warningBanner: {
    gap: 6,
    borderRadius: DsRadius.lg,
  },
  warningCta: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  warningText: {
    ...DsTypography.caption,
  },
  statsRow: { flexDirection: 'row', gap: DsSpace.sm },
  statCard: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    flex: 1,
    gap: 6,
    paddingVertical: DsSpace.md,
  },
  statIconWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  statValue: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
  },
  statLabel: { fontSize: 12, textAlign: 'center' },
  inviteCard: {
    borderRadius: DsRadius.xl,
    gap: DsSpace.sm,
    padding: DsSpace.md,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  cardHeaderIconWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  cardHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    ...DsTypography.caption,
  },
  inviteCode: { fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  codeActionsRow: { flexDirection: 'row', gap: DsSpace.sm },
  outlineButtonCompact: {
    flex: 1,
    minHeight: 48,
  },
  meta: { ...DsTypography.caption },
  errorText: { ...DsTypography.caption },
  footerActions: {
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  footerAction: {
    flex: 1,
  },
});

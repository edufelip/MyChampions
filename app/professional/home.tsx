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
 *
 * Docs: docs/screens/v2/SC-204-professional-home-dashboard.md
 * Refs: D-041, D-047, D-074, D-100, FR-105, FR-120, FR-121, FR-127–129, FR-150, FR-179–181,
 *       FR-185, FR-188, FR-204, FR-210, FR-214, FR-215, FR-217
 *       BR-213, BR-219–221, BR-241–243, BR-247, BR-249, BR-263, BR-268, BR-272–273, BR-275
 *
 * Offline wiring: network status stubbed as 'online'.
 * Subscription / RevenueCat wiring deferred.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useInviteCode } from '@/features/professional/use-professional';
import {
  resolveSubscriptionState,
  isPlanUpdateLocked,
  type EntitlementStatus,
} from '@/features/subscription/subscription.logic';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
  type StaleElapsed,
} from '@/features/offline/offline.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfessionalHomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();

  // Offline — stubbed as 'online' until NetInfo is wired
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus: 'online',
    lastSyncedAtIso: null,
  });

  // Invite code
  const { state: codeState, rotate } = useInviteCode(currentUser);

  // Subscription — stubbed until RevenueCat is wired (D-009, D-043)
  // Real entitlement status should come from subscription-source when wired.
  const stubbedEntitlementStatus: EntitlementStatus = 'unknown';
  const stubbedActiveStudentCount = 0;
  const subState = resolveSubscriptionState({
    activeStudentCount: stubbedActiveStudentCount,
    entitlementStatus: stubbedEntitlementStatus,
  });
  const isWriteLocked = isPlanUpdateLocked(subState) || offlineDisplay.showOfflineBanner;

  const [rotateError, setRotateError] = useState<string | null>(null);

  // ── Rotate code ────────────────────────────────────────────────────────────

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

  // ── Share code ─────────────────────────────────────────────────────────────

  async function handleShareCode(code: string) {
    await Share.share({ message: code });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const codeValue =
    codeState.kind === 'ready' && codeState.displayCode.kind === 'active'
      ? codeState.displayCode.code.codeValue
      : null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="pro.home.screen">
      <Stack.Screen options={{ title: t('pro.home.title'), headerShown: true }} />

      {/* Offline banner */}
      {offlineDisplay.showOfflineBanner ? (
        <OfflineBanner palette={palette} staleElapsed={offlineDisplay.staleElapsed} t={t} />
      ) : null}

      {/* Subscription pre-lapse warning */}
      {subState.isPreLapseWarningVisible ? (
        <View
          style={[styles.warningBanner, { borderColor: '#f59e0b' }]}
          testID="pro.home.subscriptionWarning"
          accessibilityRole="alert">
          <Text style={[styles.warningText, { color: palette.text }]}>
            {t('pro.home.subscription.warning')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/professional/subscription')}
            testID="pro.home.subscriptionRenewCta">
            <Text style={[styles.link, { color: palette.tint }]}>
              {t('pro.home.subscription.cta_renew')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Entitlement lock notice */}
      {isWriteLocked && !offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.lockBanner, { borderColor: '#b3261e' }]}
          testID="pro.home.entitlementLock"
          accessibilityRole="alert">
          <Text style={[styles.errorText, { color: '#b3261e' }]}>
            {t('pro.home.entitlement_lock')}
          </Text>
        </View>
      ) : null}

      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatCard
          label={t('pro.home.active_students') as string}
          value={String(stubbedActiveStudentCount)}
          palette={palette}
          testID="pro.home.activeStudents"
        />
        <StatCard
          label={t('pro.home.pending_requests') as string}
          value="—"
          palette={palette}
          testID="pro.home.pendingRequests"
        />
      </View>

      {/* Invite code card */}
      <View
        style={[styles.card, { borderColor: palette.tint + '66' }]}
        testID="pro.home.inviteCodeCard">
        <Text style={[styles.cardTitle, { color: palette.text }]}>
          {t('pro.home.invite_code.title')}
        </Text>

        {codeState.kind === 'loading' ? (
          <ActivityIndicator testID="pro.home.inviteCodeLoading" />
        ) : codeState.kind === 'ready' ? (
          <>
            {codeValue ? (
              <Text
                style={[styles.inviteCode, { color: palette.tint }]}
                testID="pro.home.inviteCodeValue"
                accessibilityLabel={`${t('pro.home.invite_code.title')}: ${codeValue}`}>
                {codeValue}
              </Text>
            ) : (
              <Text style={[styles.meta, { color: palette.icon }]}>
                {t('pro.home.invite_code.empty')}
              </Text>
            )}

            {rotateError ? (
              <Text style={[styles.errorText, { color: '#b3261e' }]}>{rotateError}</Text>
            ) : null}

            <View style={styles.codeActionsRow}>
              {codeValue ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => handleShareCode(codeValue)}
                  style={[styles.outlineButton, { borderColor: palette.tint }]}
                  testID="pro.home.shareCodeCta">
                  <Text style={[styles.outlineButtonText, { color: palette.tint }]}>
                    {t('pro.home.invite_code.share')}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={confirmRotate}
                style={[styles.outlineButton, { borderColor: palette.icon }]}
                testID="pro.home.rotateCodeCta">
                <Text style={[styles.outlineButtonText, { color: palette.icon }]}>
                  {t('pro.home.invite_code.rotate')}
                </Text>
              </Pressable>
            </View>
          </>
        ) : codeState.kind === 'error' ? (
          <Text style={[styles.errorText, { color: '#b3261e' }]}>
            {t('pro.home.error')}
          </Text>
        ) : null}
      </View>

      {/* Navigation CTAs */}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/professional/students')}
        style={[styles.primaryButton, { backgroundColor: palette.tint }]}
        testID="pro.home.rosterCta">
        <Text style={styles.primaryButtonText}>{t('pro.home.cta_roster')}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/professional/pending')}
        style={[styles.outlineButton, { borderColor: palette.tint }]}
        testID="pro.home.pendingCta">
        <Text style={[styles.outlineButtonText, { color: palette.tint }]}>
          {t('pro.home.cta_pending')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Offline Banner ───────────────────────────────────────────────────────────

function OfflineBanner({
  palette,
  staleElapsed,
  t,
}: {
  palette: Palette;
  staleElapsed: StaleElapsed | null;
  t: TFn;
}) {
  const stalePart = staleElapsed
    ? (staleElapsed.unit === 'minutes'
        ? (t('offline.stale_minutes') as string).replace('{value}', String(staleElapsed.value))
        : staleElapsed.unit === 'hours'
          ? (t('offline.stale_hours') as string).replace('{value}', String(staleElapsed.value))
          : (t('offline.stale_days') as string).replace('{value}', String(staleElapsed.value)))
    : null;

  return (
    <View
      style={[styles.offlineBanner, { borderColor: '#b3261e' }]}
      testID="pro.home.offlineBanner"
      accessibilityRole="alert">
      <Text style={[styles.meta, { color: palette.text }]}>{t('offline.banner')}</Text>
      {stalePart ? (
        <Text style={[styles.smallText, { color: palette.icon }]}>{stalePart}</Text>
      ) : null}
    </View>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  palette,
  testID,
}: {
  label: string;
  value: string;
  palette: Palette;
  testID: string;
}) {
  return (
    <View style={[styles.statCard, { borderColor: palette.icon + '44' }]} testID={testID}>
      <Text style={[styles.statValue, { color: palette.tint }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: palette.icon }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 16 },
  offlineBanner: {
    backgroundColor: '#b3261e22',
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  warningBanner: {
    backgroundColor: '#f59e0b22',
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  warningText: { fontSize: 13, lineHeight: 18 },
  lockBanner: {
    backgroundColor: '#b3261e11',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    flex: 1,
    gap: 4,
    padding: 16,
  },
  statValue: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 28,
    fontWeight: '700',
  },
  statLabel: { fontSize: 12, textAlign: 'center' },
  card: { borderRadius: 12, borderWidth: 1.5, gap: 10, padding: 16 },
  cardTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  inviteCode: { fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  codeActionsRow: { flexDirection: 'row', gap: 12 },
  outlineButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  outlineButtonText: { fontSize: 14, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 13, lineHeight: 18 },
  smallText: { fontSize: 12 },
  errorText: { fontSize: 13 },
});

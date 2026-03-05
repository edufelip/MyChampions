/**
 * SC-203 Student Home Dashboard
 * Route: /student/home
 *
 * Dashboard-aligned composition based on the mobile reference:
 * profile header, weekly stats strip, highlighted workout card, and next-meal card.
 * Keeps BL-008 offline/write-lock and D-081 hydration-goal ownership behavior.
 */
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getDsTheme, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import { useWaterTracking } from '@/features/nutrition/use-water-tracking';
import { usePlans } from '@/features/plans/use-plans';
import type { Plan } from '@/features/plans/plan-source';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
  type StaleElapsed,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatStaleElapsed(elapsed: StaleElapsed, t: ReturnType<typeof useTranslation>['t']): string {
  const value = String(elapsed.value);
  if (elapsed.unit === 'minutes') return (t('offline.stale_minutes') as string).replace('{value}', value);
  if (elapsed.unit === 'hours') return (t('offline.stale_hours') as string).replace('{value}', value);
  return (t('offline.stale_days') as string).replace('{value}', value);
}

function hasActivePlanForType(plans: Plan[], planType: string): boolean {
  return plans.some((plan) => plan.planType === planType && !plan.isArchived);
}

export default function StudentHomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuthSession();

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });

  const { state: connectionsState } = useConnections(Boolean(currentUser));
  const { state: waterState } = useWaterTracking(Boolean(currentUser), todayKey());
  const { state: plansState } = usePlans(Boolean(currentUser));

  const isLoading =
    connectionsState.kind === 'loading' ||
    waterState.kind === 'loading' ||
    plansState.kind === 'loading';

  const hasPendingConnection =
    connectionsState.kind === 'ready' &&
    connectionsState.displayStates.some((display) => display.kind === 'pending');

  const hasNutritionPlan =
    plansState.kind === 'ready' && hasActivePlanForType(plansState.plans, 'nutrition');
  const hasTrainingPlan =
    plansState.kind === 'ready' && hasActivePlanForType(plansState.plans, 'training');

  const hydrationGoal = waterState.kind === 'ready' && waterState.effectiveGoal
    ? waterState.effectiveGoal.dailyMl
    : 0;
  const hydrationConsumed = waterState.kind === 'ready' ? waterState.todayConsumedMl : 0;
  const hydrationPercent = hydrationGoal > 0
    ? Math.max(0, Math.min(100, Math.round((hydrationConsumed / hydrationGoal) * 100)))
    : 0;

  const profileInitial = (currentUser?.email?.[0] ?? 'M').toUpperCase();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      contentContainerStyle={styles.content}
      testID="student.home.screen">
      <Stack.Screen options={{ title: t('student.home.title'), headerShown: false }} />

      <View pointerEvents="none" style={[styles.blob, styles.blobTopLeft, { backgroundColor: theme.blob.topLeft }]} />
      <View pointerEvents="none" style={[styles.blob, styles.blobBottomRight, { backgroundColor: theme.blob.bottomRight }]} />

      <View style={[styles.shell, { paddingTop: insets.top + 12 }]}>        
        <View style={styles.headerRow}>
          <View style={styles.profileWrap}>
            <View style={[styles.avatarOuter, { borderColor: theme.color.accentPrimary }]}> 
              <View style={[styles.avatarInner, { backgroundColor: theme.color.surface }]}> 
                <Text style={[styles.avatarInitial, { color: theme.color.textPrimary }]}>{profileInitial}</Text>
              </View>
              <View style={[styles.avatarStatusDot, { backgroundColor: theme.color.accentPrimary }]} />
            </View>
            <View>
              <Text style={[styles.welcomeLine, { color: theme.color.textSecondary }]}>{t('student.home.title')}</Text>
              <Text style={[styles.helloLine, { color: theme.color.textPrimary }]}>{t('student.home.cta_manage_professionals')}</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('shell.tabs.account')}
            onPress={() => router.push('/settings/account')}
            style={[styles.notificationButton, { backgroundColor: theme.color.surface, borderColor: theme.color.border }]}
            testID="student.home.accountButton">
            <MaterialIcons color={theme.color.textPrimary} name="notifications-none" size={22} />
            <View style={[styles.notificationDot, { backgroundColor: theme.color.danger }]} />
          </Pressable>
        </View>

        {offlineDisplay.showOfflineBanner ? (
          <View
            style={[styles.offlineBanner, { backgroundColor: theme.color.dangerSoft, borderColor: theme.color.dangerBorder }]}
            testID="student.home.offlineBanner"
            accessibilityRole="alert">
            <MaterialIcons color={theme.color.danger} name="cloud-off" size={18} />
            <Text style={[styles.offlineModeText, { color: theme.color.danger }]}>{t('student.home.offline.mode')}</Text>
            {offlineDisplay.staleElapsed ? (
              <Text style={[styles.offlineTimeText, { color: theme.color.danger }]}>• {formatStaleElapsed(offlineDisplay.staleElapsed, t)}</Text>
            ) : null}
          </View>
        ) : null}

        {hasPendingConnection ? (
          <View style={[styles.pendingPill, { backgroundColor: theme.color.warningSoft }]} testID="student.home.pendingBadge" accessibilityRole="alert">
            <MaterialIcons color={theme.color.warning} name="hourglass-empty" size={16} />
            <Text style={[styles.pendingText, { color: theme.color.warning }]}>{t('student.home.pending_connection')}</Text>
          </View>
        ) : null}

        {isLoading ? (
          <View testID="student.home.loading" style={styles.loadingWrap}>
            <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color={theme.color.accentPrimary} size="large" />
          </View>
        ) : (
          <>
            <SectionTitle title={t('student.home.title') as string} theme={theme} />
            <View style={styles.statsRow}>
              <StatCard
                theme={theme}
                icon="fitness-center"
                label={t('student.home.training.section') as string}
                value={hasTrainingPlan ? '3/4' : '0/4'}
                progress={hasTrainingPlan ? 75 : 0}
                tint={theme.color.accentPrimary}
              />
              <StatCard
                theme={theme}
                icon="restaurant"
                label={t('student.home.nutrition.section') as string}
                value={hasNutritionPlan ? '85%' : '0%'}
                progress={hasNutritionPlan ? 85 : 0}
                tint={theme.color.accentBlue}
              />
              <StatCard
                theme={theme}
                icon="water-drop"
                label={t('student.home.hydration.title') as string}
                value={hydrationGoal > 0 ? `${(hydrationConsumed / 1000).toFixed(1)}L` : '0.0L'}
                progress={hydrationPercent}
                tint={theme.color.accentCyan}
                testID="student.home.hydrationCard"
              />
            </View>

            <SectionTitle title={t('student.home.training.section') as string} theme={theme} />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/student/training')}
              style={[styles.heroCard, { borderColor: theme.color.border }]}
              testID={hasTrainingPlan ? 'student.home.training.goCta' : 'student.home.training.emptyCta'}>
              <View style={[styles.heroBackdrop, { backgroundColor: theme.color.accentBlue }]} />
              <View style={[styles.heroGradient, { backgroundColor: theme.color.overlaySoft }]} />
              <View style={styles.heroContent}>
                <View style={styles.heroTopRow}>
                  <View style={[styles.heroBadge, { backgroundColor: theme.color.overlaySoft }]}>
                    <Text style={styles.heroBadgeText}>{t('student.home.training.plan_available')}</Text>
                  </View>
                  <View style={[styles.heroArrowCircle, { backgroundColor: theme.color.overlaySoft }]}>
                    <MaterialIcons color="white" name="arrow-forward" size={18} />
                  </View>
                </View>

                <View>
                  <Text style={styles.heroTitle}>{hasTrainingPlan ? t('student.home.cta_training') : t('student.home.no_active_plan')}</Text>
                  <Text style={styles.heroMeta}>{hasTrainingPlan ? t('student.home.training.plan_available') : t('student.home.cta_start_self')}</Text>

                  <View style={[styles.heroCta, { backgroundColor: theme.color.accentPrimary }]}> 
                    <MaterialIcons color={theme.color.onAccent} name="play-arrow" size={20} />
                    <Text style={[styles.heroCtaText, { color: theme.color.onAccent }]}>
                      {hasTrainingPlan ? t('student.home.cta_training') : t('student.home.cta_start_self')}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>

            <SectionTitle title={t('student.home.nutrition.section') as string} theme={theme} />
            <View style={[styles.mealCard, { backgroundColor: theme.color.surface, borderColor: theme.color.border }]}>
              <View style={[styles.mealThumb, { backgroundColor: theme.color.accentBlueSoft }]} />
              <View style={styles.mealBody}>
                <Text style={[styles.mealTitle, { color: theme.color.textPrimary }]}>{t('student.home.nutrition.section')}</Text>
                <Text style={[styles.mealDesc, { color: theme.color.textSecondary }]}>{t('student.home.nutrition.plan_available')}</Text>
                <View style={styles.mealTagsRow}>
                  <View style={[styles.mealTag, { backgroundColor: theme.color.accentBlueSoft }]}>
                    <Text style={[styles.mealTagText, { color: theme.color.accentBlue }]}>{t('student.home.nutrition.plan_available')}</Text>
                  </View>
                  <View style={[styles.mealTag, { backgroundColor: theme.color.warningSoft }]}>
                    <Text style={[styles.mealTagText, { color: theme.color.warning }]}>{t('student.home.cta_nutrition')}</Text>
                  </View>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/student/nutrition')}
                style={[styles.mealAction, { borderColor: theme.color.borderStrong }]}
                testID={hasNutritionPlan ? 'student.home.nutrition.goCta' : 'student.home.nutrition.emptyCta'}>
                <MaterialIcons color={theme.color.textSecondary} name="check" size={20} />
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/student/professionals')}
              style={[styles.manageButton, { borderColor: theme.color.borderStrong }]}
              testID="student.home.manageProfessionalsCta">
              <MaterialIcons color={theme.color.textPrimary} name="manage-accounts" size={20} />
              <Text style={[styles.manageButtonText, { color: theme.color.textPrimary }]}>{t('student.home.cta_manage_professionals')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function SectionTitle({ title, theme }: { title: string; theme: DsTheme }) {
  return <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>{title}</Text>;
}

function StatCard({
  theme,
  icon,
  label,
  value,
  progress,
  tint,
  testID,
}: {
  theme: DsTheme;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
  progress: number;
  tint: string;
  testID?: string;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: theme.color.surface, borderColor: theme.color.border }]} testID={testID}>
      <View style={[styles.statIconBubble, { backgroundColor: theme.color.surfaceMuted }]}>
        <MaterialIcons color={tint} name={icon} size={18} />
      </View>
      <Text style={[styles.statLabel, { color: theme.color.textSecondary }]}>{label}</Text>
      <Text style={[styles.statValue, { color: theme.color.textPrimary }]}>{value}</Text>
      <View style={[styles.statProgressTrack, { backgroundColor: theme.color.surfaceMuted }]}>
        <View style={[styles.statProgressFill, { backgroundColor: tint, width: `${progress}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1 },
  blob: { borderRadius: 999, opacity: 0.5, position: 'absolute' },
  blobTopLeft: { height: 280, left: -120, top: -80, width: 280 },
  blobBottomRight: { bottom: -120, height: 320, right: -120, width: 320 },
  shell: { flex: 1, paddingHorizontal: 20, paddingBottom: 28 },

  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  profileWrap: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  avatarOuter: {
    borderRadius: 26,
    borderWidth: 2,
    padding: 2,
    position: 'relative',
  },
  avatarInner: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  avatarInitial: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
  },
  avatarStatusDot: {
    borderRadius: 5,
    bottom: 0,
    height: 10,
    position: 'absolute',
    right: 0,
    width: 10,
  },
  welcomeLine: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  helloLine: {
    fontFamily: Fonts.rounded,
    fontSize: 17,
    fontWeight: '700',
  },
  notificationButton: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    width: 40,
  },
  notificationDot: {
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 10,
    top: 10,
    width: 8,
  },

  offlineBanner: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  offlineModeText: { fontSize: 12, fontWeight: '600' },
  offlineTimeText: { fontSize: 11, fontWeight: '600' },

  pendingPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pendingText: { fontSize: 12, fontWeight: '600' },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },

  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 6,
  },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard: {
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    minHeight: 128,
    padding: 12,
  },
  statIconBubble: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  statLabel: { fontSize: 11, fontWeight: '500' },
  statValue: { fontFamily: Fonts.rounded, fontSize: 20, fontWeight: '700' },
  statProgressTrack: { borderRadius: 6, height: 6, overflow: 'hidden' },
  statProgressFill: { borderRadius: 6, height: '100%' },

  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 10,
    minHeight: 180,
    overflow: 'hidden',
  },
  heroBackdrop: { ...StyleSheet.absoluteFillObject, opacity: 0.95 },
  heroGradient: { ...StyleSheet.absoluteFillObject, opacity: 0.5 },
  heroContent: { flex: 1, justifyContent: 'space-between', padding: 16 },
  heroTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  heroBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroBadgeText: { color: 'white', fontSize: 11, fontWeight: '600' },
  heroArrowCircle: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  heroTitle: {
    color: 'white',
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 2,
  },
  heroMeta: { color: 'white', fontSize: 12, opacity: 0.85 },
  heroCta: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 42,
  },
  heroCtaText: { fontSize: 14, fontWeight: '600' },

  mealCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 12,
  },
  mealThumb: { borderRadius: 10, height: 72, width: 72 },
  mealBody: { flex: 1, gap: 3 },
  mealTitle: { fontSize: 14, fontWeight: '600' },
  mealDesc: { fontSize: 12 },
  mealTagsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  mealTag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  mealTagText: { fontSize: 11, fontWeight: '600' },
  mealAction: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },

  manageButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 4,
  },
  manageButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

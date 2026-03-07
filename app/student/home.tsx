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
import { ActivityIndicator, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

function countActivePlansForType(plans: Plan[], planType: string): number {
  return plans.filter((plan) => plan.planType === planType && !plan.isArchived).length;
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

  const { state: connectionsState, reload: reloadConnections } = useConnections(Boolean(currentUser));
  const { state: waterState, reload: reloadWater } = useWaterTracking(Boolean(currentUser), todayKey());
  const { state: plansState, reload: reloadPlans } = usePlans(Boolean(currentUser));

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
  const nutritionPlanCount =
    plansState.kind === 'ready' ? countActivePlansForType(plansState.plans, 'nutrition') : 0;
  const trainingPlanCount =
    plansState.kind === 'ready' ? countActivePlansForType(plansState.plans, 'training') : 0;

  const hydrationGoal =
    waterState.kind === 'ready' && waterState.effectiveGoal ? waterState.effectiveGoal.dailyMl : 0;
  const hydrationConsumed = waterState.kind === 'ready' ? waterState.todayConsumedMl : 0;
  const hydrationPercent =
    hydrationGoal > 0
      ? Math.max(0, Math.min(100, Math.round((hydrationConsumed / hydrationGoal) * 100)))
      : 0;
  const hydrationValue =
    hydrationGoal > 0
      ? `${Math.round((hydrationConsumed / 1000) * 10) / 10}L`
      : '0L';

  const isError =
    connectionsState.kind === 'error' ||
    plansState.kind === 'error' ||
    waterState.kind === 'error';

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
            accessibilityLabel={t('student.home.cta_professionals')}
            onPress={() => router.push('/student/professionals')}
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
        ) : isError ? (
          <View style={styles.loadingWrap} testID="student.home.error">
            <Text style={[styles.errorText, { color: theme.color.danger }]}>{t('common.error.generic')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                reloadConnections();
                reloadPlans();
                reloadWater();
              }}
              style={[styles.retryButton, { borderColor: theme.color.borderStrong }]}>
              <Text style={[styles.retryText, { color: theme.color.textPrimary }]}>{t('common.error.retry')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <SectionTitle title={t('student.home.title') as string} theme={theme} />
            <View style={styles.statsRow}>
              <StatCard
                theme={theme}
                icon="fitness-center"
                label={t('student.home.training.section') as string}
                value={String(trainingPlanCount)}
                progress={hasTrainingPlan ? 100 : 0}
                tint={theme.color.accentPrimary}
              />
              <StatCard
                theme={theme}
                icon="restaurant"
                label={t('student.home.nutrition.section') as string}
                value={String(nutritionPlanCount)}
                progress={hasNutritionPlan ? 100 : 0}
                tint={theme.color.accentPrimary}
              />
              <StatCard
                theme={theme}
                icon="water-drop"
                label={t('student.home.hydration.title') as string}
                value={hydrationValue}
                progress={hydrationPercent}
                tint={theme.color.accentCyan}
                testID="student.home.hydrationCard"
              />
            </View>

            <SectionTitle title={t('student.home.training.section') as string} theme={theme} />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/(tabs)/training')}
              style={[styles.heroCard, { borderColor: theme.color.border }]}
              testID={hasTrainingPlan ? 'student.home.training.goCta' : 'student.home.training.emptyCta'}>
              <ImageBackground
                source={require('@/assets/images/hero-workout.jpg')}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
              <View style={styles.heroGradientTop} />
              <View style={styles.heroGradientBottom} />
              <View style={styles.heroContent}>
                <View style={styles.heroTopRow}>
                  <View style={[styles.heroBadge, { backgroundColor: 'rgba(10, 36, 99, 0.52)' }]}>
                    <Text style={styles.heroBadgeText}>
                      {hasTrainingPlan ? t('student.home.training.plan_available') : t('student.home.no_active_plan')}
                    </Text>
                  </View>
                  <View style={[styles.heroArrowCircle, { backgroundColor: 'rgba(10, 36, 99, 0.52)' }]}>
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
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/(tabs)/nutrition')}
              style={[styles.heroCard, { borderColor: theme.color.border }]}
              testID={hasNutritionPlan ? 'student.home.nutrition.goCta' : 'student.home.nutrition.emptyCta'}>
              <ImageBackground
                source={require('@/assets/images/hero-meal.jpg')}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
              <View style={styles.mealGradientTop} />
              <View style={styles.mealGradientBottom} />
              <View style={styles.heroContent}>
                <View style={styles.heroTopRow}>
                  <View style={[styles.heroBadge, { backgroundColor: 'rgba(146, 64, 14, 0.52)' }]}>
                    <Text style={styles.heroBadgeText}>
                      {hasNutritionPlan ? t('student.home.nutrition.plan_available') : t('student.home.no_active_plan')}
                    </Text>
                  </View>
                  <View style={[styles.heroArrowCircle, { backgroundColor: 'rgba(146, 64, 14, 0.52)' }]}>
                    <MaterialIcons color="white" name="arrow-forward" size={18} />
                  </View>
                </View>

                <View>
                  <Text style={styles.heroTitle}>{t('student.home.nutrition.section')}</Text>
                  <Text style={styles.heroMeta}>
                    {hasNutritionPlan ? t('student.home.nutrition.plan_available') : t('student.home.no_active_plan')}
                  </Text>

                  <View style={[styles.heroCta, { backgroundColor: theme.color.accentPrimary }]}>
                    <MaterialIcons color="white" name="restaurant" size={20} />
                    <Text style={[styles.heroCtaText, { color: 'white' }]}>
                      {hasNutritionPlan ? t('student.home.cta_nutrition') : t('student.home.cta_start_nutrition')}
                    </Text>
                  </View>
                </View>
              </View>
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
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  retryButton: {
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
  },
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
  heroGradientTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 36, 99, 0.18)',
  },
  heroGradientBottom: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 36, 99, 0.52)',
  },
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

  mealGradientTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(146, 64, 14, 0.18)',
  },
  mealGradientBottom: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(146, 64, 14, 0.52)',
  },


});

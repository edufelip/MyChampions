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
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { getDsTheme, type DsColorScheme, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import { useWaterTracking } from '@/features/nutrition/use-water-tracking';
import { isSelfGuidedPlan } from '@/features/plans/plan-ownership.logic';
import { usePlans } from '@/features/plans/use-plans';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
  type StaleElapsed,
} from '@/features/offline/offline.logic';
import { resolveLatestSyncTimestamp } from '@/features/offline/sync-timestamps.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { resolveStudentHomeDisplayState } from '@/features/student/student-home.logic';
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

export default function StudentHomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const { currentUser } = useAuthSession();

  const networkStatus = useNetworkStatus();
  const { state: connectionsState, reload: reloadConnections } = useConnections(Boolean(currentUser));
  const { state: waterState, reload: reloadWater } = useWaterTracking(Boolean(currentUser), todayKey());
  const { state: plansState, reload: reloadPlans } = usePlans(Boolean(currentUser));
  const lastSyncedAtIso = resolveLatestSyncTimestamp([
    connectionsState.kind === 'ready' ? connectionsState.lastSyncedAtIso : null,
    waterState.kind === 'ready' ? waterState.lastSyncedAtIso : null,
    plansState.kind === 'ready' ? plansState.lastSyncedAtIso : null,
  ]);
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso,
  });

  const displayState = resolveStudentHomeDisplayState({
    connections: connectionsState.kind,
    plans: plansState.kind,
    water: waterState.kind,
  });

  const hasPendingConnection =
    connectionsState.kind === 'ready' &&
    connectionsState.displayStates.some((display) => display.kind === 'pending');

  const nutritionPlans = plansState.kind === 'ready' ? plansState.plans.filter(p => p.planType === 'nutrition' && !p.isArchived) : [];
  const trainingPlans = plansState.kind === 'ready' ? plansState.plans.filter(p => p.planType === 'training' && !p.isArchived) : [];

  const hasNutritionPlan = nutritionPlans.length > 0;
  const hasTrainingPlan = trainingPlans.length > 0;

  const assignedNutritionPlan = nutritionPlans.find(p => p.sourceKind === 'assigned');
  const selfManagedNutritionPlan = nutritionPlans.find((plan) => isSelfGuidedPlan(plan, currentUser?.uid ?? null));

  const assignedTrainingPlan = trainingPlans.find(p => p.sourceKind === 'assigned');
  const selfManagedTrainingPlan = trainingPlans.find((plan) => isSelfGuidedPlan(plan, currentUser?.uid ?? null));

  const nutritionPlanCount = nutritionPlans.length;
  const trainingPlanCount = trainingPlans.length;

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

  const displayName = currentUser?.displayName?.trim() || currentUser?.email?.split('@')[0] || '';
  const firstName = displayName.split(/\s+/)[0] || t('student.home.title');
  const profileInitial = (displayName[0] ?? 'M').toUpperCase();
  const usesCompactStatsLayout = viewportWidth < 480;
  const usesPlanCardColumns = viewportWidth >= 768;

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
            <View style={styles.profileCopy}>
              <Text style={[styles.welcomeLine, { color: theme.color.textSecondary }]}>
                {t('student.home.welcome')}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.helloLine, { color: theme.color.textPrimary }]}
                testID="student.home.greeting">
                {firstName}
              </Text>
            </View>
          </View>

          <DsPillButton
            scheme={scheme}
            label={t('student.home.professionals_short')}
            onPress={() => router.push('/student/professionals')}
            variant="outline"
            size="sm"
            fullWidth={false}
            leftIcon={<MaterialIcons color={theme.color.accentPrimary} name="group" size={18} />}
            style={styles.professionalsButton}
            testID="student.home.accountButton"
          />
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

        {displayState.isInitialLoading ? (
          <View testID="student.home.loading" style={styles.loadingWrap}>
            <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color={theme.color.accentPrimary} size="large" />
          </View>
        ) : (
          <View testID="student.home.ready">
            <View style={styles.pageIntro}>
              <Text
                accessibilityRole="header"
                style={[styles.pageTitle, { color: theme.color.textPrimary }]}
                testID="student.home.dashboardTitle">
                {t('student.home.your_day')}
              </Text>
              <Text style={[styles.pageSubtitle, { color: theme.color.textSecondary }]}>
                {t('student.home.summary')}
              </Text>
            </View>

            {hasPendingConnection ? (
              <View style={[styles.pendingPill, { backgroundColor: theme.color.warningSoft }]} testID="student.home.pendingBadge" accessibilityRole="alert">
                <MaterialIcons color={theme.color.warning} name="hourglass-empty" size={16} />
                <Text style={[styles.pendingText, { color: theme.color.warning }]}>{t('student.home.pending_connection')}</Text>
              </View>
            ) : null}

            {connectionsState.kind === 'error' ? (
              <DashboardIssue
                label={t('student.home.error.connections')}
                onRetry={reloadConnections}
                retryLabel={t('common.error.retry')}
                scheme={scheme}
                theme={theme}
                testID="student.home.connections.retry"
              />
            ) : null}
            {plansState.kind === 'error' ? (
              <DashboardIssue
                label={t('student.home.error.plans')}
                onRetry={reloadPlans}
                retryLabel={t('common.error.retry')}
                scheme={scheme}
                theme={theme}
                testID="student.home.plans.retry"
              />
            ) : null}
            {waterState.kind === 'error' ? (
              <DashboardIssue
                label={t('student.home.error.hydration')}
                onRetry={reloadWater}
                retryLabel={t('common.error.retry')}
                scheme={scheme}
                theme={theme}
                testID="student.home.hydration.retry"
              />
            ) : null}

            <View style={[styles.statsRow, usesCompactStatsLayout && styles.statsRowCompact]}>
              <StatCard
                theme={theme}
                icon="fitness-center"
                label={t('student.home.training.section') as string}
                value={displayState.canRenderPlans ? String(trainingPlanCount) : '—'}
                progress={hasTrainingPlan ? 100 : 0}
                tint={theme.color.accentPrimary}
                style={usesCompactStatsLayout ? styles.statCardCompact : undefined}
                testID="student.home.trainingStat"
              />
              <StatCard
                theme={theme}
                icon="restaurant"
                label={t('student.home.nutrition.section') as string}
                value={displayState.canRenderPlans ? String(nutritionPlanCount) : '—'}
                progress={hasNutritionPlan ? 100 : 0}
                tint={theme.color.accentPrimary}
                style={usesCompactStatsLayout ? styles.statCardCompact : undefined}
                testID="student.home.nutritionStat"
              />
              <StatCard
                theme={theme}
                icon="water-drop"
                label={t('student.home.hydration.title') as string}
                value={displayState.canRenderWater ? hydrationValue : '—'}
                progress={hydrationPercent}
                tint={theme.color.accentCyan}
                testID="student.home.hydrationCard"
                style={usesCompactStatsLayout ? styles.statCardWide : undefined}
              />
            </View>

            {displayState.canRenderPlans ? (
              <View
                style={[styles.planCards, usesPlanCardColumns && styles.planCardsWide]}
                testID="student.home.planCards">
              <View style={usesPlanCardColumns ? styles.planCardColumn : undefined}>
            <SectionTitle title={t('student.home.training.section') as string} theme={theme} />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (assignedTrainingPlan) {
                  router.navigate('/(tabs)/training');
                } else if (selfManagedTrainingPlan) {
                  router.push(`/student/training/plans/${selfManagedTrainingPlan.id}`);
                } else {
                  router.navigate('/(tabs)/training');
                }
              }}
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
              </View>

              <View style={usesPlanCardColumns ? styles.planCardColumn : undefined}>
            <SectionTitle title={t('student.home.nutrition.section') as string} theme={theme} />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (assignedNutritionPlan) {
                  router.navigate('/(tabs)/nutrition');
                } else if (selfManagedNutritionPlan) {
                  router.push(`/student/nutrition/plans/${selfManagedNutritionPlan.id}`);
                } else {
                  router.navigate('/(tabs)/nutrition');
                }
              }}
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
                    <MaterialIcons color={theme.color.onAccent} name="restaurant" size={20} />
                    <Text style={[styles.heroCtaText, { color: theme.color.onAccent }]}>
                      {hasNutritionPlan ? t('student.home.cta_nutrition') : t('student.home.cta_start_nutrition')}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
              </View>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function SectionTitle({ title, theme }: { title: string; theme: DsTheme }) {
  return <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>{title}</Text>;
}

function DashboardIssue({
  label,
  onRetry,
  retryLabel,
  scheme,
  theme,
  testID,
}: {
  label: string;
  onRetry: () => void;
  retryLabel: string;
  scheme: DsColorScheme;
  theme: DsTheme;
  testID: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.issueCard,
        { backgroundColor: theme.color.dangerSoft, borderColor: theme.color.dangerBorder },
      ]}
      testID="student.home.error">
      <View style={styles.issueCopy}>
        <MaterialIcons color={theme.color.danger} name="error-outline" size={20} />
        <Text style={[styles.issueText, { color: theme.color.textPrimary }]}>{label}</Text>
      </View>
      <DsPillButton
        scheme={scheme}
        label={retryLabel}
        onPress={onRetry}
        variant="outline"
        size="sm"
        fullWidth={false}
        testID={testID}
      />
    </View>
  );
}

function StatCard({
  theme,
  icon,
  label,
  value,
  progress,
  tint,
  testID,
  style,
}: {
  theme: DsTheme;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
  progress: number;
  tint: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.statCard,
        { backgroundColor: theme.color.surface, borderColor: theme.color.border },
        style,
      ]}
      testID={testID}>
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
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  profileWrap: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12, minWidth: 0 },
  profileCopy: { flex: 1, minWidth: 0 },
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
  professionalsButton: { flexShrink: 0, paddingHorizontal: 14 },

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
  pageIntro: { marginBottom: 14, marginTop: 4 },
  pageTitle: { fontFamily: Fonts.rounded, fontSize: 28, fontWeight: '700' },
  pageSubtitle: { fontSize: 14, lineHeight: 20, marginTop: 3 },
  issueCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  issueCopy: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, minWidth: 0 },
  issueText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 6,
  },
  planCards: {},
  planCardsWide: { flexDirection: 'row', gap: 16 },
  planCardColumn: { flex: 1, minWidth: 0 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statsRowCompact: { flexWrap: 'wrap' },
  statCard: {
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    minHeight: 128,
    padding: 12,
  },
  statCardCompact: { flexBasis: '46%' },
  statCardWide: { flexBasis: '100%' },
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

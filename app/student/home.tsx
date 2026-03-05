/**
 * SC-203 Student Home Dashboard
 * Route: /student/home
 *
 * UI refresh (2026-03-04): playful dashboard style aligned with auth family.
 * Keeps BL-008 offline/write-lock and D-081 hydration-goal ownership behavior.
 */
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import { useWaterTracking } from '@/features/nutrition/use-water-tracking';
import type { UseWaterTrackingResult } from '@/features/nutrition/use-water-tracking';
import { usePlans } from '@/features/plans/use-plans';
import type { Plan } from '@/features/plans/plan-source';
import { resolveOfflineDisplayState, type OfflineDisplayState, type StaleElapsed } from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatStaleElapsed(elapsed: StaleElapsed, t: ReturnType<typeof useTranslation>['t']): string {
  const v = String(elapsed.value);
  if (elapsed.unit === 'minutes') {
    return (t('offline.stale_minutes') as string).replace('{value}', v);
  }
  if (elapsed.unit === 'hours') {
    return (t('offline.stale_hours') as string).replace('{value}', v);
  }
  return (t('offline.stale_days') as string).replace('{value}', v);
}

function hasActivePlanForType(plans: Plan[], planType: string): boolean {
  return plans.some((p) => p.planType === planType && !p.isArchived);
}

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

export default function StudentHomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
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

  const hasPendingConnection =
    connectionsState.kind === 'ready' &&
    connectionsState.displayStates.some((ds) => ds.kind === 'pending');

  const isLoading =
    connectionsState.kind === 'loading' ||
    waterState.kind === 'loading' ||
    plansState.kind === 'loading';

  const hasNutritionPlan =
    plansState.kind === 'ready' && hasActivePlanForType(plansState.plans, 'nutrition');

  const hasTrainingPlan =
    plansState.kind === 'ready' && hasActivePlanForType(plansState.plans, 'training');

  const isWriteLocked = offlineDisplay.showOfflineBanner;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#221410' : '#fff5f0' }]}
      contentContainerStyle={styles.content}
      testID="student.home.screen">
      <Stack.Screen options={{ title: t('student.home.title'), headerShown: false }} />

      <View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.blobTopLeft,
          { backgroundColor: isDark ? '#5f4f29' : '#ffeca1' },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.blobBottomRight,
          { backgroundColor: isDark ? '#2e5b4a' : '#a1e8cc' },
        ]}
      />

      <View style={[styles.shell, { paddingTop: insets.top + 12 }]}>
        {offlineDisplay.showOfflineBanner ? (
          <OfflineBanner
            palette={palette}
            staleElapsed={offlineDisplay.staleElapsed}
            t={t}
            testID="student.home.offlineBanner"
          />
        ) : null}

        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('student.home.cta_professionals')}
            onPress={() => router.push('/student/professionals')}
            style={[styles.circleButton, { backgroundColor: isDark ? '#2a1f1b' : '#ffffff' }]}
            testID="student.home.menuButton">
            <MaterialIcons color={palette.text} name="menu" size={22} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('shell.tabs.account')}
            onPress={() => router.push('/settings/account')}
            style={[styles.circleButton, { backgroundColor: isDark ? '#2a1f1b' : '#ffffff' }]}
            testID="student.home.accountButton">
            <MaterialIcons color={palette.text} name="notifications-none" size={22} />
            <View style={styles.notificationDot} />
          </Pressable>
        </View>

        {hasPendingConnection ? (
          <View
            style={[styles.pendingPill, { backgroundColor: isDark ? '#4a2e1f' : '#ffe8d8' }]}
            testID="student.home.pendingBadge"
            accessibilityRole="alert">
            <MaterialIcons color={isDark ? '#fbbf8f' : '#d97706'} name="hourglass-empty" size={18} />
            <Text style={[styles.pendingText, { color: isDark ? '#fbbf8f' : '#b45309' }]}>
              {t('student.home.pending_connection')}
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <LoadingStateCardStack palette={palette} t={t} testID="student.home.loading" />
        ) : (
          <View style={styles.sectionStack}>
            <HydrationCard
              waterState={waterState}
              palette={palette}
              t={t}
              isWriteLocked={isWriteLocked}
            />

            <PlanCard
              palette={palette}
              icon="restaurant"
              title={t('student.home.nutrition.section')}
              hasActivePlan={hasNutritionPlan}
              ctaLabel={hasNutritionPlan ? t('student.home.cta_nutrition') : t('student.home.cta_start_self')}
              availableLabel={t('student.home.nutrition.plan_available')}
              emptyLabel={t('student.home.no_active_plan')}
              onPress={() => router.push('/student/nutrition')}
              isWriteLocked={isWriteLocked}
              testPrefix="student.home.nutrition"
            />

            <PlanCard
              palette={palette}
              icon="fitness-center"
              title={t('student.home.training.section')}
              hasActivePlan={hasTrainingPlan}
              ctaLabel={hasTrainingPlan ? t('student.home.cta_training') : t('student.home.cta_start_self')}
              availableLabel={t('student.home.training.plan_available')}
              emptyLabel={t('student.home.no_active_plan')}
              onPress={() => router.push('/student/training')}
              isWriteLocked={isWriteLocked}
              testPrefix="student.home.training"
            />

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/student/professionals')}
              style={[styles.manageButton, { borderColor: isDark ? '#4b5563' : '#cbd5e1' }]}
              testID="student.home.manageProfessionalsCta">
              <MaterialIcons color={palette.text} name="manage-accounts" size={20} />
              <Text style={[styles.manageButtonText, { color: palette.text }]}>
                {t('student.home.cta_manage_professionals')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function OfflineBanner({
  palette,
  staleElapsed,
  t,
  testID,
}: {
  palette: Palette;
  staleElapsed: StaleElapsed | null;
  t: TFn;
  testID: string;
}) {
  return (
    <View style={styles.offlineBanner} testID={testID} accessibilityRole="alert">
      <MaterialIcons color="#ef4444" name="cloud-off" size={18} />
      <Text style={[styles.offlineModeText, { color: '#b91c1c' }]}>{t('student.home.offline.mode')}</Text>
      {staleElapsed ? (
        <Text style={[styles.offlineTimeText, { color: '#dc2626' }]}>
          {`• ${formatStaleElapsed(staleElapsed, t)}`}
        </Text>
      ) : null}
    </View>
  );
}

function HydrationCard({
  waterState,
  palette,
  t,
  isWriteLocked,
}: {
  waterState: UseWaterTrackingResult['state'];
  palette: Palette;
  t: TFn;
  isWriteLocked: boolean;
}) {
  const goal = waterState.kind === 'ready' && waterState.effectiveGoal ? waterState.effectiveGoal.dailyMl : null;
  const consumed = waterState.kind === 'ready' ? waterState.todayConsumedMl : null;
  const percent = goal && consumed !== null ? Math.max(0, Math.min(100, Math.round((consumed / goal) * 100))) : 0;

  const progressLabel =
    goal && consumed !== null
      ? (t('student.home.hydration.progress') as string)
          .replace('{consumed}', String(consumed))
          .replace('{goal}', String(goal))
      : t('student.home.hydration.no_goal');

  const goalOwnerLabel =
    waterState.kind === 'ready' && waterState.effectiveGoal
      ? waterState.effectiveGoal.owner === 'nutritionist'
        ? t('student.home.hydration.goal_nutritionist')
        : t('student.home.hydration.goal_student')
      : t('student.home.hydration.no_goal');

  return (
    <View style={[styles.card, { backgroundColor: palette.background === '#151718' ? '#1f2937' : '#ffffff' }]} testID="student.home.hydrationCard">
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.iconBubble, { backgroundColor: '#dbeafe' }]}>
            <MaterialIcons color="#3b82f6" name="water-drop" size={20} />
          </View>
          <Text style={[styles.cardTitle, { color: palette.text }]}>{t('student.home.hydration.title')}</Text>
        </View>

        {isWriteLocked ? (
          <View style={[styles.readOnlyBadge, { backgroundColor: palette.background === '#151718' ? '#334155' : '#f1f5f9' }]}>
            <Text style={[styles.readOnlyText, { color: palette.icon }]}>{t('student.home.offline.read_only_badge')}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.hydrationBody}>
        <View style={styles.hydrationTextColumn}>
          <Text
            style={[
              styles.hydrationValue,
              !goal || consumed === null ? styles.hydrationValueNoGoal : null,
              { color: palette.text },
            ]}
            testID="student.home.hydrationCard.progress">
            {progressLabel}
          </Text>
          <Text style={[styles.hydrationMeta, { color: palette.icon }]}>{goalOwnerLabel}</Text>
        </View>

        <View style={[styles.percentRing, { borderColor: '#bfdbfe' }]}>
          <Text style={styles.percentRingText}>{`${percent}%`}</Text>
        </View>
      </View>

      {waterState.kind === 'loading' ? <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} /> : null}
    </View>
  );
}

function PlanCard({
  palette,
  icon,
  title,
  hasActivePlan,
  ctaLabel,
  availableLabel,
  emptyLabel,
  onPress,
  isWriteLocked,
  testPrefix,
}: {
  palette: Palette;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  hasActivePlan: boolean;
  ctaLabel: string;
  availableLabel: string;
  emptyLabel: string;
  onPress: () => void;
  isWriteLocked: boolean;
  testPrefix: string;
}) {
  const disabled = isWriteLocked && !hasActivePlan;

  return (
    <View style={[styles.card, { backgroundColor: palette.background === '#151718' ? '#1f2937' : '#ffffff' }]} testID={`${testPrefix}.card`}>
      <View style={styles.cardHeaderLeft}>
        <View style={[styles.iconBubble, { backgroundColor: '#f1f5f9' }]}>
          <MaterialIcons color={palette.tint} name={icon} size={20} />
        </View>
        <Text style={[styles.cardTitle, { color: palette.text }]}>{title}</Text>
      </View>

      <Text style={[styles.planStatus, { color: palette.icon }]}>
        {hasActivePlan ? availableLabel : emptyLabel}
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          hasActivePlan ? styles.primaryCardCta : styles.outlineCardCta,
          {
            backgroundColor: hasActivePlan
              ? '#ff7b72'
              : palette.background === '#151718'
              ? '#111827'
              : '#ffffff',
            borderColor: hasActivePlan ? '#ff7b72' : palette.background === '#151718' ? '#374151' : '#cbd5e1',
            opacity: disabled ? 0.6 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
        testID={hasActivePlan ? `${testPrefix}.goCta` : `${testPrefix}.emptyCta`}>
        {disabled ? <MaterialIcons color={palette.icon} name="lock" size={18} /> : null}
        <Text style={[styles.cardCtaText, { color: hasActivePlan ? '#ffffff' : palette.text }]}>{ctaLabel}</Text>
        {hasActivePlan ? <MaterialIcons color="#ffffff" name="chevron-right" size={20} /> : null}
      </Pressable>
    </View>
  );
}

function LoadingStateCardStack({
  palette,
  t,
  testID,
}: {
  palette: Palette;
  t: TFn;
  testID: string;
}) {
  return (
    <View testID={testID} style={styles.sectionStack}>
      <View style={styles.loadingIconWrap}>
        <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color="#ff7b72" size="large" />
      </View>

      <View style={[styles.staleBanner, { backgroundColor: '#fef3c7', borderColor: '#fde68a' }]}>
        <MaterialIcons color="#d97706" name="warning-amber" size={18} />
        <View style={styles.staleTextWrap}>
          <Text style={styles.staleTitle}>{t('student.home.loading.stale_title')}</Text>
          <Text style={styles.staleBody}>{t('student.home.loading.stale_body')}</Text>
        </View>
      </View>

      <View style={[styles.card, styles.skeletonCard]}>
        <View style={styles.skeletonLineLg} />
        <View style={styles.skeletonBlock} />
      </View>
      <View style={[styles.card, styles.skeletonCard]}>
        <View style={styles.skeletonLineLg} />
        <View style={styles.skeletonRow}>
          <View style={styles.skeletonSmallBlock} />
          <View style={styles.skeletonSmallBlock} />
          <View style={styles.skeletonSmallBlock} />
        </View>
      </View>
      <View style={[styles.card, styles.skeletonCard]}>
        <View style={styles.skeletonLineLg} />
        <View style={styles.skeletonBlock} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  blob: {
    borderRadius: 999,
    opacity: 0.6,
    position: 'absolute',
  },
  blobTopLeft: {
    height: 300,
    left: -110,
    top: -70,
    width: 300,
  },
  blobBottomRight: {
    bottom: -80,
    height: 340,
    right: -130,
    width: 340,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  circleButton: {
    alignItems: 'center',
    borderRadius: 24,
    elevation: 1,
    height: 48,
    justifyContent: 'center',
    position: 'relative',
    width: 48,
  },
  notificationDot: {
    backgroundColor: '#ff7b72',
    borderRadius: 5,
    height: 10,
    position: 'absolute',
    right: 12,
    top: 12,
    width: 10,
  },
  pendingPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pendingText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sectionStack: {
    gap: 12,
  },
  offlineBanner: {
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
    borderRadius: 0,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
    marginHorizontal: -20,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  offlineModeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  offlineTimeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    borderColor: '#f1f5f9',
    borderRadius: 30,
    borderWidth: 1,
    elevation: 1,
    padding: 16,
  },
  cardHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  iconBubble: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '700',
  },
  readOnlyBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  readOnlyText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  hydrationBody: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hydrationTextColumn: {
    flex: 1,
    marginRight: 10,
  },
  hydrationValue: {
    fontFamily: Fonts.rounded,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 38,
  },
  hydrationValueNoGoal: {
    fontSize: 22,
    lineHeight: 28,
  },
  hydrationMeta: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
    marginTop: 4,
  },
  percentRing: {
    alignItems: 'center',
    borderRadius: 40,
    borderWidth: 6,
    height: 80,
    justifyContent: 'center',
    width: 80,
  },
  percentRingText: {
    color: '#3b82f6',
    fontSize: 16,
    fontWeight: '700',
  },
  planStatus: {
    fontSize: 13,
    marginTop: 8,
    marginBottom: 14,
  },
  primaryCardCta: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  outlineCardCta: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  cardCtaText: {
    fontSize: 15,
    fontWeight: '700',
  },
  manageButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 50,
    marginTop: 2,
  },
  manageButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  loadingIconWrap: {
    alignItems: 'center',
    marginVertical: 8,
  },
  staleBanner: {
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  staleTextWrap: {
    flex: 1,
    gap: 2,
  },
  staleTitle: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: '700',
  },
  staleBody: {
    color: '#b45309',
    fontSize: 12,
  },
  skeletonCard: {
    backgroundColor: '#f8fafc',
    gap: 10,
  },
  skeletonLineLg: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    height: 16,
    width: '45%',
  },
  skeletonBlock: {
    backgroundColor: '#e2e8f0',
    borderRadius: 16,
    height: 84,
    width: '100%',
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  skeletonSmallBlock: {
    backgroundColor: '#e2e8f0',
    borderRadius: 14,
    flex: 1,
    height: 64,
  },
});

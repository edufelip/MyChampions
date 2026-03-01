/**
 * SC-203 Student Home Dashboard
 * Route: /student/home
 *
 * Unified view of:
 *  - Pending professional connection banner (BL-003)
 *  - Hydration summary card with effective water-goal ownership (D-081)
 *  - Nutrition section summary + CTA
 *  - Training section summary + CTA
 *  - Offline banner + stale indicator (D-041, D-047, D-074)
 *
 * Docs: docs/screens/v2/SC-203-student-home-dashboard.md
 * Refs: D-044, D-047, D-074, D-081, FR-214, FR-218, FR-219, FR-220, FR-221, FR-222
 *
 * Offline wiring: network status is currently stubbed as 'online'.
 * Real wiring deferred — tracked in docs/discovery/pending-wiring-checklist-v1.md.
 */
import { Stack, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
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
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import type { UseWaterTrackingResult } from '@/features/nutrition/use-water-tracking';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatStaleElapsed(
  elapsed: StaleElapsed,
  t: ReturnType<typeof useTranslation>['t']
): string {
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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudentHomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();

  // Offline display — network status stubbed as 'online' until NetInfo is wired
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus: 'online',
    lastSyncedAtIso: null,
  });

  // Data hooks
  const { state: connectionsState } = useConnections(currentUser);
  const { state: waterState } = useWaterTracking(currentUser, todayKey());
  const { state: plansState } = usePlans(currentUser);

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
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="student.home.screen">
      <Stack.Screen options={{ title: t('student.home.title'), headerShown: true }} />

      {/* ── Offline banner ─────────────────────────────────── */}
      {offlineDisplay.showOfflineBanner ? (
        <OfflineBanner palette={palette} staleElapsed={offlineDisplay.staleElapsed} t={t} />
      ) : null}

      {/* ── Pending connection notice ─────────────────────── */}
      {hasPendingConnection ? (
        <View
          style={[
            styles.pendingBadge,
            { backgroundColor: palette.icon + '22', borderColor: palette.icon },
          ]}
          testID="student.home.pendingBadge"
          accessibilityRole="alert">
          <Text style={[styles.pendingText, { color: palette.text }]}>
            {t('student.home.pending_connection')}
          </Text>
        </View>
      ) : null}

      {/* ── Global loading indicator ──────────────────────── */}
      {isLoading ? (
        <ActivityIndicator
          accessibilityLabel={t('a11y.loading.default')}
          style={styles.centered}
          testID="student.home.loading"
        />
      ) : null}

      {/* ── Hydration card ───────────────────────────────── */}
      <HydrationCard
        waterState={waterState}
        palette={palette}
        t={t}
        isWriteLocked={isWriteLocked}
      />

      {/* ── Nutrition section ─────────────────────────────── */}
      <SectionCard
        title={t('student.home.nutrition.section')}
        palette={palette}
        hasActivePlan={hasNutritionPlan}
        emptyCtaLabel={t('student.home.cta_start_nutrition')}
        goCtaLabel={t('student.home.cta_nutrition')}
        onGo={() => router.push('/student/nutrition')}
        onEmpty={() => router.push('/student/nutrition')}
        isWriteLocked={isWriteLocked}
        writeLockReason={t('offline.write_lock')}
        testPrefix="student.home.nutrition"
      />

      {/* ── Training section ──────────────────────────────── */}
      <SectionCard
        title={t('student.home.training.section')}
        palette={palette}
        hasActivePlan={hasTrainingPlan}
        emptyCtaLabel={t('student.home.cta_start_training')}
        goCtaLabel={t('student.home.cta_training')}
        onGo={() => router.push('/student/training')}
        onEmpty={() => router.push('/student/training')}
        isWriteLocked={isWriteLocked}
        writeLockReason={t('offline.write_lock')}
        testPrefix="student.home.training"
      />

      {/* ── Manage professionals CTA ──────────────────────── */}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/student/professionals')}
        style={[styles.outlineButton, { borderColor: palette.tint }]}
        testID="student.home.manageProfessionalsCta">
        <Text style={[styles.outlineButtonText, { color: palette.tint }]}>
          {t('student.home.cta_professionals')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Offline Banner ───────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

function OfflineBanner({
  palette,
  staleElapsed,
  t,
}: {
  palette: Palette;
  staleElapsed: StaleElapsed | null;
  t: TFn;
}) {
  return (
    <View
      style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
      testID="student.home.offlineBanner"
      accessibilityRole="alert">
      <Text style={[styles.offlineBannerText, { color: palette.text }]}>
        {t('offline.banner')}
      </Text>
      {staleElapsed ? (
        <Text style={[styles.offlineStaleText, { color: palette.icon }]}>
          {formatStaleElapsed(staleElapsed, t)}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Hydration Card ───────────────────────────────────────────────────────────

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
  const goalOwnerLabel =
    waterState.kind === 'ready' && waterState.effectiveGoal
      ? waterState.effectiveGoal.owner === 'nutritionist'
        ? t('student.home.hydration.goal_nutritionist')
        : t('student.home.hydration.goal_student')
      : t('student.home.hydration.no_goal');

  const progressLabel =
    waterState.kind === 'ready' && waterState.effectiveGoal
      ? (t('student.home.hydration.progress') as string)
          .replace('{consumed}', String(waterState.todayConsumedMl))
          .replace('{goal}', String(waterState.effectiveGoal.dailyMl))
      : null;

  const streakLabel =
    waterState.kind === 'ready' && waterState.streak > 0
      ? (t('student.home.hydration.streak') as string).replace(
          '{days}',
          String(waterState.streak)
        )
      : null;

  return (
    <View
      style={[styles.card, { borderColor: palette.tint + '66' }]}
      testID="student.home.hydrationCard">
      <Text style={[styles.cardTitle, { color: palette.text }]}>
        {t('student.home.hydration.title')}
      </Text>

      {waterState.kind === 'loading' ? (
        <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} />
      ) : waterState.kind === 'ready' ? (
        <>
          {progressLabel ? (
            <Text
              style={[styles.cardValue, { color: palette.tint }]}
              testID="student.home.hydrationCard.progress">
              {progressLabel}
            </Text>
          ) : null}
          {streakLabel ? (
            <Text style={[styles.cardMeta, { color: palette.icon }]}>{streakLabel}</Text>
          ) : null}
          <Text style={[styles.cardMeta, { color: palette.icon }]}>{goalOwnerLabel}</Text>
          {isWriteLocked ? (
            <Text
              style={[styles.writeLock, { color: '#b3261e' }]}
              testID="student.home.hydrationCard.writeLock">
              {t('offline.write_lock')}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({
  title,
  palette,
  hasActivePlan,
  emptyCtaLabel,
  goCtaLabel,
  onGo,
  onEmpty,
  isWriteLocked,
  writeLockReason,
  testPrefix,
}: {
  title: string;
  palette: Palette;
  hasActivePlan: boolean;
  emptyCtaLabel: string;
  goCtaLabel: string;
  onGo: () => void;
  onEmpty: () => void;
  isWriteLocked: boolean;
  writeLockReason: string;
  testPrefix: string;
}) {
  return (
    <View
      style={[styles.card, { borderColor: palette.icon + '44' }]}
      testID={`${testPrefix}.card`}>
      <Text style={[styles.cardTitle, { color: palette.text }]}>{title}</Text>

      {isWriteLocked ? (
        <Text
          style={[styles.writeLock, { color: '#b3261e' }]}
          testID={`${testPrefix}.writeLock`}>
          {writeLockReason}
        </Text>
      ) : hasActivePlan ? (
        <Pressable
          accessibilityRole="button"
          onPress={onGo}
          testID={`${testPrefix}.goCta`}>
          <Text style={[styles.link, { color: palette.tint }]}>{goCtaLabel}</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={onEmpty}
          testID={`${testPrefix}.emptyCta`}>
          <Text style={[styles.link, { color: palette.tint }]}>{emptyCtaLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 16,
  },
  centered: {
    alignSelf: 'center',
    marginVertical: 16,
  },
  offlineBanner: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  offlineBannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
  offlineStaleText: {
    fontSize: 12,
  },
  pendingBadge: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  pendingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
    padding: 16,
  },
  cardTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  cardValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  cardMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  writeLock: {
    fontSize: 13,
  },
  link: {
    fontSize: 15,
    fontWeight: '600',
  },
  outlineButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    minHeight: 48,
    justifyContent: 'center',
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

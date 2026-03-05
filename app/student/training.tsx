/**
 * SC-210 Student Training Tracking
 * Route: /student/training
 *
 * Visual refresh (2026-03-04): playful training dashboard style aligned with auth/home/nutrition family.
 * Keeps BL-008 offline/write-lock and D-071 assigned-plan change-request behavior.
 */
import { Stack } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { HeroEmptyState } from '@/components/ds/patterns/HeroEmptyState';
import { PlanChangeRequestCard } from '@/components/ds/patterns/PlanChangeRequestCard';
import { ReadOnlyNoticeCard } from '@/components/ds/patterns/ReadOnlyNoticeCard';
import { WeekStrip, type WeekStripItem } from '@/components/ds/patterns/WeekStrip';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsIconButton } from '@/components/ds/primitives/DsIconButton';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { resolveOfflineDisplayState } from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { usePlans } from '@/features/plans/use-plans';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

function getWeekStrip(locale: string): WeekStripItem[] {
  const today = new Date();
  const base = new Date(today);
  base.setDate(today.getDate() - 2);

  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(base);
    date.setDate(base.getDate() + index);

    const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'short' })
      .format(date)
      .slice(0, 1)
      .toUpperCase();

    return {
      id: `${dayLabel}-${date.getDate()}`,
      dayLabel,
      dayNumber: String(date.getDate()),
      isActive: date.toDateString() === today.toDateString(),
    };
  });
}

export default function StudentTrainingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t, locale } = useTranslation();
  const { currentUser } = useAuthSession();

  const networkStatus = useNetworkStatus();
  const offlineDisplay = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const { state: plansState, submitChangeRequest, validateChangeRequest } = usePlans(Boolean(currentUser));

  const assignedTrainingPlan =
    plansState.kind === 'ready'
      ? plansState.plans.find(
          (plan) => plan.planType === 'training' && plan.sourceKind === 'assigned' && !plan.isArchived
        ) ?? null
      : null;

  const hasActiveTrainingAssignment = assignedTrainingPlan !== null;
  const weekStrip = useMemo(() => getWeekStrip(locale), [locale]);

  return (
    <DsScreen scheme={scheme} testID="student.training.screen">
      <Stack.Screen options={{ title: t('student.training.title'), headerShown: false }} />

      <View style={[styles.shell, { backgroundColor: theme.color.shell }]}> 
        <View style={styles.headerRow}>
          <Text style={[styles.pageTitle, { color: theme.color.textPrimary }]}>{t('student.training.title')}</Text>

          <DsIconButton
            scheme={scheme}
            icon="calendar-today"
            onPress={() => {
              void 0;
            }}
            accessibilityLabel={t('student.training.calendar.cta')}
            testID="student.training.calendarButton"
            size={40}
          />
        </View>

        {offlineDisplay.showOfflineBanner ? (
          <DsOfflineBanner scheme={scheme} text={t('offline.banner')} testID="student.training.offlineBanner" />
        ) : null}

        <WeekStrip scheme={scheme} items={weekStrip} />

        {plansState.kind === 'loading' ? (
          <DsCard scheme={scheme} style={styles.loadingCard} testID="student.training.plansLoading">
            <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color={theme.color.accentPrimary} />
          </DsCard>
        ) : hasActiveTrainingAssignment ? (
          <View style={styles.sectionStack}>
            <ReadOnlyNoticeCard
              scheme={scheme}
              text={t('student.training.assigned_plan.read_only_notice')}
              testID="student.training.assignedPlanNotice"
            />

            <DsCard scheme={scheme} style={styles.sessionCard} testID="student.training.sessionSummary">
              <View style={[styles.sessionIconBubble, { backgroundColor: theme.color.warningSoft }]}>
                <MaterialIcons color={theme.color.accentPrimary} name="fitness-center" size={34} />
              </View>
              <Text style={[styles.sessionTitle, { color: theme.color.textPrimary }]}>
                {t('student.training.session.title')}
              </Text>
              <Text style={[styles.sessionBody, { color: theme.color.textSecondary }]}>
                {t('student.training.session.body')}
              </Text>
            </DsCard>

            <PlanChangeRequestCard
              scheme={scheme}
              t={t}
              isWriteLocked={isWriteLocked}
              testID="student.training.planChangeForm"
              validate={validateChangeRequest}
              submit={(requestText) => submitChangeRequest(assignedTrainingPlan.id, 'training', requestText)}
              keys={{
                title: 'student.training.plan_change.title',
                label: 'student.training.plan_change.label',
                placeholder: 'student.training.plan_change.placeholder',
                cta: 'student.training.plan_change.cta',
                success: 'student.training.plan_change.success',
                validationRequired: 'student.training.plan_change.validation.required',
                validationTooShort: 'student.training.plan_change.validation.too_short',
                errorPlanNotFound: 'student.training.plan_change.error.plan_not_found',
                errorNoActiveAssignment: 'student.training.plan_change.error.no_active_assignment',
                errorNetwork: 'student.training.plan_change.error.network',
                errorUnknown: 'student.training.plan_change.error.unknown',
              }}
            />
          </View>
        ) : (
          <HeroEmptyState
            scheme={scheme}
            icon="directions-run"
            title={t('student.training.empty.title')}
            body={t('student.training.empty.body')}
            ctaLabel={t('student.training.empty.cta')}
            onPressCta={() => Alert.alert(t('student.training.empty.cta'))}
            ctaTestID="student.training.emptyCta"
            disabled={isWriteLocked}
            testID="student.training.emptyState"
          />
        )}
      </View>
    </DsScreen>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 28,
    flex: 1,
    marginHorizontal: 16,
    marginTop: 18,
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    gap: DsSpace.md,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pageTitle: {
    ...DsTypography.title,
    fontFamily: Fonts.rounded,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
  },
  sectionStack: {
    gap: DsSpace.md,
  },
  sessionCard: {
    alignItems: 'center',
    gap: DsSpace.sm,
    paddingVertical: 22,
  },
  sessionIconBubble: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 38,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  sessionTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts.rounded,
    fontSize: 24,
    textAlign: 'center',
  },
  sessionBody: {
    ...DsTypography.body,
    maxWidth: 300,
    textAlign: 'center',
  },
});

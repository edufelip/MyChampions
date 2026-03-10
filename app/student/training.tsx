/**
 * SC-210 Student Training Tracking
 * Route: /student/training
 *
 * Visual refresh (2026-03-05): empty state matches the acquisition-focused
 * training art direction while keeping BL-008 offline/write-lock and D-071
 * assigned-plan change-request behavior.
 */
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PlanChangeRequestCard } from '@/components/ds/patterns/PlanChangeRequestCard';
import { ReadOnlyNoticeCard } from '@/components/ds/patterns/ReadOnlyNoticeCard';
import { WeekStrip, type WeekStripItem } from '@/components/ds/patterns/WeekStrip';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
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
  const router = useRouter();

  const networkStatus = useNetworkStatus();
  const offlineDisplay = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const { state: plansState, reload, submitChangeRequest, validateChangeRequest } = usePlans(Boolean(currentUser));

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
        

        {offlineDisplay.showOfflineBanner ? (
          <DsOfflineBanner scheme={scheme} text={t('offline.banner')} testID="student.training.offlineBanner" />
        ) : null}

        {hasActiveTrainingAssignment ? <WeekStrip scheme={scheme} items={weekStrip} /> : null}

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
          <View style={styles.emptyStateWrap} testID="student.training.emptyState">
            <View style={styles.emptyHero}>
              <View
                style={[
                  styles.emptyGlow,
                  {
                    backgroundColor:
                      scheme === 'dark' ? 'rgba(30, 169, 90, 0.10)' : 'rgba(19, 236, 73, 0.12)',
                  },
                ]}
              />

              <View
                style={[
                  styles.emptyMainTile,
                  DsShadow.floating,
                  {
                    backgroundColor: theme.color.surface,
                    shadowColor: scheme === 'dark' ? '#000000' : '#1ea95a',
                  },
                ]}>
                <MaterialIcons color="#13ec49" name="fitness-center" size={58} />
              </View>

              <View style={[styles.emptyAccentTile, DsShadow.soft, { backgroundColor: '#13ec49' }]}>
                <MaterialIcons color="#102215" name="assignment" size={34} />
              </View>
            </View>

            <View style={styles.emptyCopyBlock}>
              <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>
                {t('student.training.empty.title')}
              </Text>
              <Text style={[styles.emptyBody, { color: theme.color.textSecondary }]}>
                {t('student.training.empty.body')}
              </Text>
            </View>

            <DsPillButton
              scheme={scheme}
              label={t('student.training.empty.cta')}
              onPress={() => router.push('/student/professionals')}
              disabled={isWriteLocked}
              contentColor="#f8fafc"
              testID="student.training.emptyCta"
              style={styles.emptyPrimaryCta}
              leftIcon={<MaterialIcons color="#f8fafc" name="person-add" size={20} />}
            />

            <Pressable
              accessibilityRole="button"
              disabled={isWriteLocked}
              onPress={() => router.push('/student/training/plans/new' as never)}
              style={({ pressed }) => [
                styles.emptySecondaryCta,
                { opacity: isWriteLocked ? 0.5 : pressed ? 0.7 : 1 },
              ]}
              testID="student.training.emptySelfGuidedCta">
              <Text style={[styles.emptySecondaryCtaText, { color: theme.color.textSecondary }]}> 
                {t('student.training.empty.self_guided_cta')}
              </Text>
            </Pressable>
          </View>
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
  emptyStateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: DsSpace.xxl,
    paddingHorizontal: DsSpace.sm,
    paddingTop: DsSpace.md,
  },
  emptyHero: {
    alignItems: 'center',
    height: 260,
    justifyContent: 'center',
    marginBottom: DsSpace.xl,
    position: 'relative',
    width: 260,
  },
  emptyGlow: {
    borderRadius: 999,
    height: 220,
    position: 'absolute',
    width: 220,
  },
  emptyMainTile: {
    alignItems: 'center',
    borderRadius: 30,
    height: 128,
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
    width: 128,
  },
  emptyAccentTile: {
    alignItems: 'center',
    borderRadius: 22,
    height: 80,
    justifyContent: 'center',
    position: 'absolute',
    right: 24,
    top: 70,
    transform: [{ rotate: '12deg' }],
    width: 80,
  },
  emptyCopyBlock: {
    gap: DsSpace.sm,
    marginBottom: DsSpace.xl,
    maxWidth: 320,
  },
  emptyTitle: {
    ...DsTypography.title,
    fontFamily: Fonts.rounded,
    fontSize: 30,
    textAlign: 'center',
  },
  emptyBody: {
    ...DsTypography.body,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  emptyPrimaryCta: {
    borderRadius: 16,
    maxWidth: 280,
    minHeight: 56,
    width: '100%',
  },
  emptySecondaryCta: {
    marginTop: DsSpace.md,
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.xs,
  },
  emptySecondaryCtaText: {
    ...DsTypography.button,
    fontSize: 14,
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

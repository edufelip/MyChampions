/**
 * SC-209 Student Nutrition Tracking
 * Route: /student/nutrition
 *
 * Visual refresh (2026-03-04): playful nutrition dashboard style aligned with auth/home family.
 * Keeps BL-008 offline/write-lock and D-081 hydration-goal ownership behavior.
 */
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { PlanChangeRequestCard } from '@/components/ds/patterns/PlanChangeRequestCard';
import { ReadOnlyNoticeCard } from '@/components/ds/patterns/ReadOnlyNoticeCard';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { useAuthSession } from '@/features/auth/auth-session';
import { resolveOfflineDisplayState } from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import type { UseWaterTrackingResult } from '@/features/nutrition/use-water-tracking';
import { useWaterTracking } from '@/features/nutrition/use-water-tracking';
import { usePlans } from '@/features/plans/use-plans';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function StudentNutritionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();

  const networkStatus = useNetworkStatus();
  const offlineDisplay = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const waterHook = useWaterTracking(Boolean(currentUser), todayKey());
  const { state: plansState, submitChangeRequest, validateChangeRequest } = usePlans(Boolean(currentUser));

  const assignedNutritionPlan =
    plansState.kind === 'ready'
      ? plansState.plans.find(
          (plan) => plan.planType === 'nutrition' && plan.sourceKind === 'assigned' && !plan.isArchived
        ) ?? null
      : null;

  const hasActiveNutritionAssignment = assignedNutritionPlan !== null;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.push('/student/home');
  };

  return (
    <DsScreen scheme={scheme} testID="student.nutrition.screen">
      <Stack.Screen options={{ title: t('student.nutrition.title'), headerShown: false }} />

      <View style={styles.shell}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('auth.role.cta_back')}
            onPress={handleBack}
            style={({ pressed }) => [
              styles.circleButton,
              {
                backgroundColor: theme.color.surface,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}>
            <MaterialIcons color={theme.color.textPrimary} name="arrow-back" size={22} />
          </Pressable>

          <Text style={[styles.pageTitle, { color: theme.color.textPrimary }]}>{t('student.nutrition.title')}</Text>
          <View style={styles.circleButtonSpacer} />
        </View>

        {offlineDisplay.showOfflineBanner ? (
          <DsOfflineBanner scheme={scheme} text={t('offline.banner')} testID="student.nutrition.offlineBanner" />
        ) : null}

        <View style={styles.sectionStack}>
          <WaterWidget waterHook={waterHook} scheme={scheme} t={t} isWriteLocked={isWriteLocked} />

          {plansState.kind === 'loading' ? (
            <DsCard scheme={scheme} style={styles.loadingCard} testID="student.nutrition.plansLoading">
              <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color={theme.color.accentPrimary} />
            </DsCard>
          ) : hasActiveNutritionAssignment ? (
            <>
              <ReadOnlyNoticeCard
                scheme={scheme}
                testID="student.nutrition.assignedPlanNotice"
                text={t('student.nutrition.assigned_plan.read_only_notice')}
              />

              <PlanChangeRequestCard
                scheme={scheme}
                t={t}
                isWriteLocked={isWriteLocked}
                testID="student.nutrition.planChangeForm"
                validate={validateChangeRequest}
                submit={(requestText) => submitChangeRequest(assignedNutritionPlan.id, 'nutrition', requestText)}
                keys={{
                  title: 'student.nutrition.plan_change.title',
                  label: 'student.nutrition.plan_change.label',
                  placeholder: 'student.nutrition.plan_change.placeholder',
                  cta: 'student.nutrition.plan_change.cta',
                  success: 'student.nutrition.plan_change.success',
                  validationRequired: 'student.nutrition.plan_change.validation.required',
                  validationTooShort: 'student.nutrition.plan_change.validation.too_short',
                  errorPlanNotFound: 'student.nutrition.plan_change.error.plan_not_found',
                  errorNoActiveAssignment: 'student.nutrition.plan_change.error.no_active_assignment',
                  errorNetwork: 'student.nutrition.plan_change.error.network',
                  errorUnknown: 'student.nutrition.plan_change.error.unknown',
                }}
              />
            </>
          ) : (
            <DsCard scheme={scheme} style={styles.emptyCard} testID="student.nutrition.emptyState">
              <View style={styles.emptyIconBlob}>
                <MaterialIcons color={theme.color.textPrimary} name="set-meal" size={42} />
                <View style={[styles.emptyIconDot, { backgroundColor: theme.color.accentYellow }]} />
              </View>

              <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>{t('student.nutrition.empty.title')}</Text>
              <Text style={[styles.emptyBody, { color: theme.color.textSecondary }]}>{t('student.nutrition.empty.body')}</Text>

              <DsPillButton
                scheme={scheme}
                disabled={isWriteLocked}
                label={t('student.nutrition.empty.cta')}
                onPress={() => router.push('/nutrition/custom-meals')}
                testID="student.nutrition.emptyCta"
                rightIcon={<MaterialIcons color="#ffffff" name="restaurant-menu" size={20} />}
              />

              {isWriteLocked ? (
                <Text style={[styles.writeLockText, { color: theme.color.danger }]}>{t('offline.write_lock')}</Text>
              ) : null}
            </DsCard>
          )}
        </View>
      </View>
    </DsScreen>
  );
}

function WaterWidget({
  waterHook,
  scheme,
  t,
  isWriteLocked,
}: {
  waterHook: UseWaterTrackingResult;
  scheme: 'light' | 'dark';
  t: ReturnType<typeof useTranslation>['t'];
  isWriteLocked: boolean;
}) {
  const theme = getDsTheme(scheme);
  const { state, validateIntake, validateGoal, logIntake, setGoal } = waterHook;

  const [intakeRaw, setIntakeRaw] = useState('');
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [isLoggingIntake, setIsLoggingIntake] = useState(false);

  const [goalRaw, setGoalRaw] = useState('');
  const [goalError, setGoalError] = useState<string | null>(null);
  const [isSettingGoal, setIsSettingGoal] = useState(false);

  const goal = state.kind === 'ready' && state.effectiveGoal ? state.effectiveGoal.dailyMl : null;
  const consumed = state.kind === 'ready' ? state.todayConsumedMl : 0;

  const canSetPersonalGoal =
    state.kind === 'ready' &&
    (state.effectiveGoal === null || state.effectiveGoal.owner === 'student') &&
    !isWriteLocked;

  const goalOwnerLabel =
    state.kind === 'ready' && state.effectiveGoal?.owner === 'nutritionist'
      ? t('student.nutrition.water.nutritionist_goal')
      : t('student.nutrition.water.personal_goal');

  const onLogIntake = async () => {
    const errors = validateIntake({ amountMlString: intakeRaw.trim() });
    if (errors.amountMl) {
      setIntakeError(
        errors.amountMl === 'required'
          ? t('student.nutrition.water.log.validation.required')
          : t('student.nutrition.water.log.validation.must_be_positive')
      );
      return;
    }

    setIntakeError(null);
    setIsLoggingIntake(true);
    const err = await logIntake(parseInt(intakeRaw.trim(), 10));
    setIsLoggingIntake(false);

    if (!err) {
      setIntakeRaw('');
      return;
    }

    setIntakeError(t('common.error.generic'));
  };

  const onSetGoal = async () => {
    const errors = validateGoal({ dailyMlString: goalRaw.trim() });
    if (errors.dailyMl) {
      setGoalError(
        errors.dailyMl === 'required'
          ? t('student.nutrition.water.goal.validation.required')
          : t('student.nutrition.water.goal.validation.must_be_positive')
      );
      return;
    }

    setGoalError(null);
    setIsSettingGoal(true);
    const err = await setGoal(parseInt(goalRaw.trim(), 10));
    setIsSettingGoal(false);

    if (!err) {
      setGoalRaw('');
      return;
    }

    setGoalError(t('common.error.generic'));
  };

  return (
    <DsCard scheme={scheme} style={styles.waterCard} testID="student.nutrition.waterWidget">
      {state.kind === 'loading' ? (
        <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color={theme.color.accentPrimary} />
      ) : state.kind === 'error' ? (
        <Text style={[styles.inlineError, { color: theme.color.danger }]}>{t('common.error.generic')}</Text>
      ) : state.kind === 'ready' ? (
        <>
          <View style={styles.waterHeaderRow}>
            <View style={styles.waterHeaderLeft}>
              <View style={styles.waterValueRow}>
                <Text style={[styles.waterValue, { color: theme.color.textPrimary }]}>{String(consumed)}</Text>
                <Text style={[styles.waterGoalValue, { color: theme.color.textSecondary }]}>{`/ ${goal ?? 0} ml`}</Text>
              </View>

              <View style={[styles.goalBadge, { backgroundColor: theme.color.accentPrimarySoft }]}>
                <MaterialIcons color={theme.color.accentPrimary} name="flag" size={14} />
                <Text style={[styles.goalBadgeText, { color: theme.color.accentPrimary }]}>{goalOwnerLabel}</Text>
              </View>
            </View>

            <View style={[styles.waterIconWrap, { backgroundColor: theme.color.accentBlueSoft }]}> 
              <MaterialIcons color="#38bdf8" name="water-drop" size={32} />
            </View>
          </View>

          {!isWriteLocked ? (
            <>
              <View style={styles.inputRow}>
                <TextInput
                  accessibilityLabel={t('student.nutrition.water.log.label')}
                  keyboardType="numeric"
                  onChangeText={(value) => {
                    setIntakeRaw(value);
                    setIntakeError(null);
                  }}
                  placeholder={t('student.nutrition.water.log.placeholder')}
                  placeholderTextColor={theme.color.textSecondary}
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.color.surfaceMuted,
                      color: theme.color.textPrimary,
                      borderColor: intakeError ? theme.color.danger : 'transparent',
                    },
                  ]}
                  testID="student.nutrition.waterWidget.intakeInput"
                  value={intakeRaw}
                />

                <DsPillButton
                  scheme={scheme}
                  label={t('student.nutrition.water.cta_log')}
                  onPress={() => {
                    void onLogIntake();
                  }}
                  loading={isLoggingIntake}
                  fullWidth={false}
                  testID="student.nutrition.waterWidget.logButton"
                  style={styles.compactButton}
                />
              </View>

              {intakeError ? (
                <View accessibilityLiveRegion="polite">
                  <Text style={[styles.inlineError, { color: theme.color.danger }]}>{intakeError}</Text>
                </View>
              ) : null}

              {canSetPersonalGoal ? (
                <View style={styles.inputRow}>
                  <TextInput
                    accessibilityLabel={t('student.nutrition.water.goal.label')}
                    keyboardType="numeric"
                    onChangeText={(value) => {
                      setGoalRaw(value);
                      setGoalError(null);
                    }}
                    placeholder={t('student.nutrition.water.goal.placeholder')}
                    placeholderTextColor={theme.color.textSecondary}
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: theme.color.surfaceMuted,
                        color: theme.color.textPrimary,
                        borderColor: goalError ? theme.color.danger : 'transparent',
                      },
                    ]}
                    testID="student.nutrition.waterWidget.goalInput"
                    value={goalRaw}
                  />

                  <DsPillButton
                    scheme={scheme}
                    label={t('student.nutrition.water.cta_set_goal')}
                    onPress={() => {
                      void onSetGoal();
                    }}
                    loading={isSettingGoal}
                    variant="secondary"
                    fullWidth={false}
                    testID="student.nutrition.waterWidget.setGoalButton"
                    style={styles.compactButton}
                  />
                </View>
              ) : null}

              {goalError ? (
                <View accessibilityLiveRegion="polite">
                  <Text style={[styles.inlineError, { color: theme.color.danger }]}>{goalError}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text
              style={[styles.writeLockText, { color: theme.color.danger }]}
              testID="student.nutrition.waterWidget.writeLock">
              {t('offline.write_lock')}
            </Text>
          )}
        </>
      ) : null}
    </DsCard>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    gap: 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  circleButton: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    elevation: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  circleButtonSpacer: {
    height: 48,
    width: 48,
  },
  pageTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '700',
  },
  sectionStack: {
    gap: DsSpace.md,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  waterCard: {
    gap: 10,
  },
  waterHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  waterHeaderLeft: {
    flex: 1,
    marginRight: 8,
  },
  waterValueRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 6,
  },
  waterValue: {
    fontFamily: Fonts.rounded,
    fontSize: 44,
    fontWeight: '700',
    lineHeight: 48,
  },
  waterGoalValue: {
    fontSize: 19,
    fontWeight: '600',
    marginBottom: 5,
  },
  goalBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: DsRadius.pill,
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  goalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  waterIconWrap: {
    alignItems: 'center',
    borderRadius: 30,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  textInput: {
    borderRadius: DsRadius.lg,
    borderWidth: 2,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  compactButton: {
    minHeight: 48,
    paddingHorizontal: 12,
  },
  inlineError: {
    ...DsTypography.caption,
  },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  emptyIconBlob: {
    alignItems: 'center',
    backgroundColor: '#dbeafe',
    borderRadius: 40,
    height: 112,
    justifyContent: 'center',
    marginBottom: 4,
    position: 'relative',
    width: 112,
  },
  emptyIconDot: {
    borderRadius: 14,
    height: 28,
    position: 'absolute',
    right: -4,
    top: -2,
    width: 28,
  },
  emptyTitle: {
    ...DsTypography.title,
    fontFamily: Fonts.rounded,
    fontSize: 30,
    textAlign: 'center',
  },
  emptyBody: {
    ...DsTypography.body,
    marginBottom: 4,
    maxWidth: 280,
    textAlign: 'center',
  },
  writeLockText: {
    ...DsTypography.caption,
  },
});

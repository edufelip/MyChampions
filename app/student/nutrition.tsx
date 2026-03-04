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
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
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

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

export default function StudentNutritionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
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
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#221410' : '#fff5f0' }]}
      contentContainerStyle={styles.content}
      testID="student.nutrition.screen">
      <Stack.Screen options={{ title: t('student.nutrition.title'), headerShown: false }} />

      <View
        pointerEvents="none"
        style={[styles.blob, styles.blobTopLeft, { backgroundColor: isDark ? '#5f4f29' : '#ffeca1' }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.blobBottomRight,
          { backgroundColor: isDark ? '#2e5b4a' : '#a1e8cc' },
        ]}
      />

      <View style={styles.shell}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('auth.role.cta_back')}
            onPress={handleBack}
            style={({ pressed }) => [
              styles.circleButton,
              { backgroundColor: isDark ? '#2a1f1b' : '#ffffff', transform: [{ scale: pressed ? 0.96 : 1 }] },
            ]}>
            <MaterialIcons color={palette.text} name="arrow-back" size={22} />
          </Pressable>

          <Text style={[styles.pageTitle, { color: palette.text }]}>{t('student.nutrition.title')}</Text>
          <View style={styles.circleButtonSpacer} />
        </View>

        {offlineDisplay.showOfflineBanner ? (
          <View style={styles.offlineBanner} testID="student.nutrition.offlineBanner" accessibilityRole="alert">
            <MaterialIcons color="#ef4444" name="cloud-off" size={18} />
            <Text style={styles.offlineBannerText}>{t('offline.banner')}</Text>
          </View>
        ) : null}

        <View style={styles.sectionStack}>
          <WaterWidget waterHook={waterHook} palette={palette} t={t} isWriteLocked={isWriteLocked} />

          {plansState.kind === 'loading' ? (
            <View style={[styles.card, styles.loadingCard]} testID="student.nutrition.plansLoading">
              <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color="#ff7b72" />
            </View>
          ) : hasActiveNutritionAssignment ? (
            <>
              <View style={styles.readOnlyCard} testID="student.nutrition.assignedPlanNotice">
                <Text style={styles.readOnlyLabel}>{t('student.nutrition.assigned_plan.read_only_notice')}</Text>
              </View>

              <PlanChangeRequestForm
                planId={assignedNutritionPlan.id}
                palette={palette}
                t={t}
                isWriteLocked={isWriteLocked}
                submitChangeRequest={submitChangeRequest}
                validateChangeRequest={validateChangeRequest}
                planType="nutrition"
              />
            </>
          ) : (
            <View style={[styles.card, styles.emptyCard]} testID="student.nutrition.emptyState">
              <View style={styles.emptyIconBlob}>
                <MaterialIcons color="#334155" name="set-meal" size={42} />
                <View style={styles.emptyIconDot} />
              </View>

              <Text style={[styles.emptyTitle, { color: palette.text }]}>{t('student.nutrition.empty.title')}</Text>
              <Text style={[styles.emptyBody, { color: palette.icon }]}>{t('student.nutrition.empty.body')}</Text>

              <Pressable
                accessibilityRole="button"
                disabled={isWriteLocked}
                onPress={() => router.push('/nutrition/custom-meals')}
                style={({ pressed }) => [
                  styles.primaryPillButton,
                  {
                    backgroundColor: '#ff7b72',
                    opacity: isWriteLocked ? 0.6 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
                testID="student.nutrition.emptyCta">
                <Text style={styles.primaryPillButtonText}>{t('student.nutrition.empty.cta')}</Text>
                <MaterialIcons color="#ffffff" name="restaurant-menu" size={20} />
              </Pressable>

              {isWriteLocked ? (
                <Text style={styles.writeLockText}>{t('offline.write_lock')}</Text>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function WaterWidget({
  waterHook,
  palette,
  t,
  isWriteLocked,
}: {
  waterHook: UseWaterTrackingResult;
  palette: Palette;
  t: TFn;
  isWriteLocked: boolean;
}) {
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
    <View style={[styles.card, styles.waterCard]} testID="student.nutrition.waterWidget">
      {state.kind === 'loading' ? (
        <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color="#ff7b72" />
      ) : state.kind === 'error' ? (
        <Text style={styles.inlineError}>{t('common.error.generic')}</Text>
      ) : state.kind === 'ready' ? (
        <>
          <View style={styles.waterHeaderRow}>
            <View style={styles.waterHeaderLeft}>
              <View style={styles.waterValueRow}>
                <Text style={styles.waterValue}>{String(consumed)}</Text>
                <Text style={styles.waterGoalValue}>{`/ ${goal ?? 0} ml`}</Text>
              </View>

              <View style={styles.goalBadge}>
                <MaterialIcons color="#ff7b72" name="flag" size={14} />
                <Text style={styles.goalBadgeText}>{goalOwnerLabel}</Text>
              </View>
            </View>

            <View style={styles.waterIconWrap}>
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
                  placeholderTextColor={palette.icon}
                  style={[styles.textInput, intakeError ? styles.textInputError : null]}
                  testID="student.nutrition.waterWidget.intakeInput"
                  value={intakeRaw}
                />

                <Pressable
                  accessibilityRole="button"
                  disabled={isLoggingIntake}
                  onPress={() => {
                    void onLogIntake();
                  }}
                  style={({ pressed }) => [
                    styles.primaryInputButton,
                    {
                      opacity: isLoggingIntake ? 0.7 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                  ]}
                  testID="student.nutrition.waterWidget.logButton">
                  {isLoggingIntake ? (
                    <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryInputButtonText}>{t('student.nutrition.water.cta_log')}</Text>
                  )}
                </Pressable>
              </View>

              {intakeError ? (
                <View accessibilityLiveRegion="polite">
                  <Text style={styles.inlineError}>{intakeError}</Text>
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
                    placeholderTextColor={palette.icon}
                    style={[styles.textInput, goalError ? styles.textInputError : null]}
                    testID="student.nutrition.waterWidget.goalInput"
                    value={goalRaw}
                  />

                  <Pressable
                    accessibilityRole="button"
                    disabled={isSettingGoal}
                    onPress={() => {
                      void onSetGoal();
                    }}
                    style={({ pressed }) => [
                      styles.secondaryInputButton,
                      {
                        opacity: isSettingGoal ? 0.7 : 1,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      },
                    ]}
                    testID="student.nutrition.waterWidget.setGoalButton">
                    {isSettingGoal ? (
                      <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#ff7b72" />
                    ) : (
                      <Text style={styles.secondaryInputButtonText}>
                        {t('student.nutrition.water.cta_set_goal')}
                      </Text>
                    )}
                  </Pressable>
                </View>
              ) : null}

              {goalError ? (
                <View accessibilityLiveRegion="polite">
                  <Text style={styles.inlineError}>{goalError}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.writeLockText} testID="student.nutrition.waterWidget.writeLock">
              {t('offline.write_lock')}
            </Text>
          )}
        </>
      ) : null}
    </View>
  );
}

function PlanChangeRequestForm({
  planId,
  palette,
  t,
  isWriteLocked,
  submitChangeRequest,
  validateChangeRequest,
  planType,
}: {
  planId: string;
  palette: Palette;
  t: TFn;
  isWriteLocked: boolean;
  submitChangeRequest: ReturnType<typeof usePlans>['submitChangeRequest'];
  validateChangeRequest: ReturnType<typeof usePlans>['validateChangeRequest'];
  planType: 'nutrition' | 'training';
}) {
  const [requestText, setRequestText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const titleKey =
    planType === 'nutrition'
      ? 'student.nutrition.plan_change.title'
      : 'student.training.plan_change.title';
  const labelKey =
    planType === 'nutrition'
      ? 'student.nutrition.plan_change.label'
      : 'student.training.plan_change.label';
  const placeholderKey =
    planType === 'nutrition'
      ? 'student.nutrition.plan_change.placeholder'
      : 'student.training.plan_change.placeholder';
  const ctaKey =
    planType === 'nutrition'
      ? 'student.nutrition.plan_change.cta'
      : 'student.training.plan_change.cta';
  const successKey =
    planType === 'nutrition'
      ? 'student.nutrition.plan_change.success'
      : 'student.training.plan_change.success';

  const onSubmit = async () => {
    const errors = validateChangeRequest({ requestText });
    if (errors.requestText) {
      setFieldError(
        errors.requestText === 'required'
          ? t('student.nutrition.plan_change.validation.required')
          : t('student.nutrition.plan_change.validation.too_short')
      );
      return;
    }

    setIsSubmitting(true);
    setFieldError(null);
    setSuccessMsg(null);

    const result = await submitChangeRequest(planId, planType, requestText);
    setIsSubmitting(false);

    if ('data' in result) {
      setRequestText('');
      setSuccessMsg(t(successKey));
      return;
    }

    switch (result.error) {
      case 'plan_not_found':
        setFieldError(t('student.nutrition.plan_change.error.plan_not_found'));
        break;
      case 'no_active_assignment':
        setFieldError(t('student.nutrition.plan_change.error.no_active_assignment'));
        break;
      case 'network':
        setFieldError(t('student.nutrition.plan_change.error.network'));
        break;
      default:
        setFieldError(t('student.nutrition.plan_change.error.unknown'));
    }
  };

  return (
    <View style={[styles.card, styles.planChangeCard]} testID={`student.${planType}.planChangeForm`}>
      <Text style={[styles.planChangeTitle, { color: palette.text }]}>{t(titleKey)}</Text>

      {isWriteLocked ? (
        <Text style={styles.writeLockText}>{t('offline.write_lock')}</Text>
      ) : (
        <>
          <Text style={[styles.planChangeLabel, { color: palette.text }]}>{t(labelKey)}</Text>

          <TextInput
            accessibilityLabel={t(labelKey)}
            multiline
            numberOfLines={4}
            onChangeText={(value) => {
              setRequestText(value);
              setFieldError(null);
              setSuccessMsg(null);
            }}
            placeholder={t(placeholderKey)}
            placeholderTextColor={palette.icon}
            style={[styles.multilineInput, fieldError ? styles.textInputError : null]}
            testID={`student.${planType}.planChangeForm.input`}
            value={requestText}
          />

          {fieldError ? (
            <View accessibilityLiveRegion="polite">
              <Text style={styles.inlineError} testID={`student.${planType}.planChangeForm.error`}>
                {fieldError}
              </Text>
            </View>
          ) : null}

          {successMsg ? (
            <View accessibilityLiveRegion="polite">
              <Text
                style={styles.successText}
                testID={`student.${planType}.planChangeForm.success`}>
                {successMsg}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => {
              void onSubmit();
            }}
            style={({ pressed }) => [
              styles.primaryPillButton,
              {
                backgroundColor: '#ff7b72',
                opacity: isSubmitting ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
            testID={`student.${planType}.planChangeForm.submitButton`}>
            {isSubmitting ? (
              <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#ffffff" />
            ) : (
              <Text style={styles.primaryPillButtonText}>{t(ctaKey)}</Text>
            )}
          </Pressable>
        </>
      )}
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
    borderRadius: 24,
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
  offlineBanner: {
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  offlineBannerText: {
    color: '#b91c1c',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  sectionStack: {
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffffee',
    borderColor: '#f1f5f9',
    borderRadius: 30,
    borderWidth: 1,
    elevation: 1,
    padding: 16,
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
    color: '#0f172a',
    fontFamily: Fonts.rounded,
    fontSize: 44,
    fontWeight: '700',
    lineHeight: 48,
  },
  waterGoalValue: {
    color: '#64748b',
    fontSize: 19,
    fontWeight: '600',
    marginBottom: 5,
  },
  goalBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#ff7b721a',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  goalBadgeText: {
    color: '#ff7b72',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  waterIconWrap: {
    alignItems: 'center',
    backgroundColor: '#e0f2fe',
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
    backgroundColor: '#f8fafc',
    borderColor: 'transparent',
    borderRadius: 16,
    borderWidth: 2,
    color: '#0f172a',
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  textInputError: {
    borderColor: '#b3261e',
  },
  primaryInputButton: {
    alignItems: 'center',
    backgroundColor: '#ff7b72',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  primaryInputButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryInputButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#ff7b7233',
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  secondaryInputButtonText: {
    color: '#ff7b72',
    fontSize: 13,
    fontWeight: '700',
  },
  inlineError: {
    color: '#b3261e',
    fontSize: 13,
    lineHeight: 18,
  },
  readOnlyCard: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  readOnlyLabel: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  planChangeCard: {
    gap: 10,
  },
  planChangeTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 19,
    fontWeight: '700',
  },
  planChangeLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  multilineInput: {
    backgroundColor: '#f8fafc',
    borderColor: 'transparent',
    borderRadius: 16,
    borderWidth: 2,
    color: '#0f172a',
    fontSize: 14,
    minHeight: 104,
    padding: 12,
    textAlignVertical: 'top',
  },
  successText: {
    color: '#16a34a',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  emptyIconBlob: {
    alignItems: 'center',
    backgroundColor: '#a1e8cc',
    borderRadius: 40,
    height: 112,
    justifyContent: 'center',
    marginBottom: 4,
    position: 'relative',
    width: 112,
  },
  emptyIconDot: {
    backgroundColor: '#ffeca1',
    borderRadius: 14,
    height: 28,
    position: 'absolute',
    right: -4,
    top: -2,
    width: 28,
  },
  emptyTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
    maxWidth: 280,
    textAlign: 'center',
  },
  primaryPillButton: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
    width: '100%',
  },
  primaryPillButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  writeLockText: {
    color: '#b3261e',
    fontSize: 13,
    lineHeight: 18,
  },
});

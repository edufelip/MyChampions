/**
 * SC-209 Student Nutrition Tracking
 * Route: /student/nutrition
 *
 * Surfaces:
 *  - Daily water intake tracking + effective goal (nutritionist override or student personal)
 *  - Plan change request form for assigned nutrition plans (advisory, D-071)
 *  - Offline banner + write-lock (D-041, D-074)
 *  - Empty state with self-guided CTA when no nutritionist assigned
 *
 * Docs: docs/screens/v2/SC-209-student-nutrition-tracking.md
 * Refs: D-041, D-074, D-081, FR-211, FR-214, FR-218, FR-219, FR-220, FR-221, FR-222, BR-269, BR-272, BR-276
 *
 * Meal log wiring (fatsecret) is deferred — tracked in pending-wiring-checklist-v1.md.
 */
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useWaterTracking } from '@/features/nutrition/use-water-tracking';
import type { UseWaterTrackingResult } from '@/features/nutrition/use-water-tracking';
import { usePlans } from '@/features/plans/use-plans';
import { resolveOfflineDisplayState } from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudentNutritionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const { currentUser } = useAuthSession();

  // Real network connectivity via NetInfo (BL-008, FR-214, BR-272)
  const networkStatus = useNetworkStatus();
  const offlineDisplay = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  // Data hooks
  const waterHook = useWaterTracking(currentUser, todayKey());
  const { state: plansState, submitChangeRequest, validateChangeRequest } = usePlans(currentUser);

  // Assigned nutrition plan
  const assignedNutritionPlan =
    plansState.kind === 'ready'
      ? plansState.plans.find(
          (p) => p.planType === 'nutrition' && p.sourceKind === 'assigned' && !p.isArchived
        ) ?? null
      : null;

  const hasActiveNutritionAssignment = assignedNutritionPlan !== null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="student.nutrition.screen">
      <Stack.Screen options={{ title: t('student.nutrition.title'), headerShown: true }} />

      {/* ── Offline banner ─────────────────────────────────── */}
      {offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
          testID="student.nutrition.offlineBanner"
          accessibilityRole="alert">
          <Text style={[styles.offlineBannerText, { color: palette.text }]}>
            {t('offline.banner')}
          </Text>
        </View>
      ) : null}

      {/* ── Hydration widget ──────────────────────────────── */}
      <WaterWidget
        waterHook={waterHook}
        palette={palette}
        t={t}
        isWriteLocked={isWriteLocked}
      />

      {/* ── Nutrition plan area ───────────────────────────── */}
      {plansState.kind === 'loading' ? (
        <ActivityIndicator
          accessibilityLabel={t('a11y.loading.default')}
          style={styles.centered}
          testID="student.nutrition.plansLoading"
        />
      ) : hasActiveNutritionAssignment ? (
        <>
          {/* Assigned plan: read-only notice + change request */}
          <View
            style={[styles.infoBox, { borderColor: palette.tint + '66' }]}
            testID="student.nutrition.assignedPlanNotice">
            <Text style={[styles.infoText, { color: palette.icon }]}>
              {t('student.nutrition.assigned_plan.read_only_notice')}
            </Text>
          </View>
          <PlanChangeRequestForm
            planId={assignedNutritionPlan!.id}
            palette={palette}
            t={t}
            isWriteLocked={isWriteLocked}
            submitChangeRequest={submitChangeRequest}
            validateChangeRequest={validateChangeRequest}
            planType="nutrition"
          />
        </>
      ) : (
        /* Empty state — no nutritionist assigned */
        <View style={styles.emptyState} testID="student.nutrition.emptyState">
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            {t('student.nutrition.empty.title')}
          </Text>
          <Text style={[styles.emptyBody, { color: palette.icon }]}>
            {t('student.nutrition.empty.body')}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isWriteLocked}
            onPress={() => Alert.alert(t('student.nutrition.empty.cta'))}
            style={[
              styles.primaryButton,
              { backgroundColor: isWriteLocked ? palette.icon : palette.tint },
            ]}
            testID="student.nutrition.emptyCta">
            <Text style={styles.primaryButtonText}>{t('student.nutrition.empty.cta')}</Text>
          </Pressable>
          {isWriteLocked ? (
            <Text style={[styles.writeLock, { color: '#b3261e' }]}>
              {t('offline.write_lock')}
            </Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Water Widget ─────────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

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

  const canSetPersonalGoal =
    state.kind === 'ready' &&
    (state.effectiveGoal === null || state.effectiveGoal.owner === 'student');

  const goalOwnerHelper =
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

    const amountMl = parseInt(intakeRaw.trim(), 10);
    setIsLoggingIntake(true);
    setIntakeError(null);
    const err = await logIntake(amountMl);
    setIsLoggingIntake(false);

    if (!err) {
      setIntakeRaw('');
    } else {
      setIntakeError(t('common.error.generic'));
    }
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

    const dailyMl = parseInt(goalRaw.trim(), 10);
    setIsSettingGoal(true);
    setGoalError(null);
    const err = await setGoal(dailyMl);
    setIsSettingGoal(false);

    if (!err) {
      setGoalRaw('');
    } else {
      setGoalError(t('common.error.generic'));
    }
  };

  const progressText =
    state.kind === 'ready' && state.effectiveGoal
      ? (t('student.nutrition.water.title') as string) +
        ': ' +
        String(state.todayConsumedMl) +
        ' / ' +
        String(state.effectiveGoal.dailyMl) +
        ' ml'
      : null;

  return (
    <View
      style={[styles.card, { borderColor: palette.tint + '66' }]}
      testID="student.nutrition.waterWidget">
      <Text style={[styles.cardTitle, { color: palette.text }]}>
        {t('student.nutrition.water.title')}
      </Text>

      {state.kind === 'loading' ? (
        <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} />
      ) : state.kind === 'ready' ? (
        <>
          {progressText ? (
            <Text
              style={[styles.cardValue, { color: palette.tint }]}
              testID="student.nutrition.waterWidget.progress">
              {progressText}
            </Text>
          ) : null}

          <Text style={[styles.cardMeta, { color: palette.icon }]}>{goalOwnerHelper}</Text>

          {/* Log intake row */}
          {!isWriteLocked ? (
            <View style={styles.inputRow}>
              <TextInput
                accessibilityLabel={t('student.nutrition.water.log.label')}
                keyboardType="numeric"
                onChangeText={(v) => {
                  setIntakeRaw(v);
                  setIntakeError(null);
                }}
                placeholder={t('student.nutrition.water.log.placeholder')}
                placeholderTextColor={palette.icon}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: palette.background,
                    borderColor: intakeError ? '#b3261e' : palette.icon,
                    color: palette.text,
                  },
                ]}
                testID="student.nutrition.waterWidget.intakeInput"
                value={intakeRaw}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isLoggingIntake}
                onPress={() => {
                  void onLogIntake();
                }}
                style={[
                  styles.inlineButton,
                  { backgroundColor: isLoggingIntake ? palette.icon : palette.tint },
                ]}
                testID="student.nutrition.waterWidget.logButton">
                {isLoggingIntake ? (
                  <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#fff" />
                ) : (
                  <Text style={styles.inlineButtonText}>
                    {t('student.nutrition.water.cta_log')}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {intakeError ? (
            <View accessibilityLiveRegion="polite">
              <Text style={styles.inlineError}>{intakeError}</Text>
            </View>
          ) : null}

          {/* Set personal goal row — hidden when nutritionist owns goal */}
          {canSetPersonalGoal && !isWriteLocked ? (
            <View style={styles.inputRow}>
              <TextInput
                accessibilityLabel={t('student.nutrition.water.goal.label')}
                keyboardType="numeric"
                onChangeText={(v) => {
                  setGoalRaw(v);
                  setGoalError(null);
                }}
                placeholder={t('student.nutrition.water.goal.placeholder')}
                placeholderTextColor={palette.icon}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: palette.background,
                    borderColor: goalError ? '#b3261e' : palette.icon,
                    color: palette.text,
                  },
                ]}
                testID="student.nutrition.waterWidget.goalInput"
                value={goalRaw}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isSettingGoal}
                onPress={() => {
                  void onSetGoal();
                }}
                style={[
                  styles.inlineButton,
                  { backgroundColor: isSettingGoal ? palette.icon : palette.tint },
                ]}
                testID="student.nutrition.waterWidget.setGoalButton">
                {isSettingGoal ? (
                  <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#fff" />
                ) : (
                  <Text style={styles.inlineButtonText}>
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

          {isWriteLocked ? (
            <Text
              style={[styles.writeLock, { color: '#b3261e' }]}
              testID="student.nutrition.waterWidget.writeLock">
              {t('offline.write_lock')}
            </Text>
          ) : null}
        </>
      ) : state.kind === 'error' ? (
        <Text style={[styles.cardMeta, { color: '#b3261e' }]}>{t('common.error.generic')}</Text>
      ) : null}
    </View>
  );
}

// ─── Plan Change Request Form ─────────────────────────────────────────────────

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

    const result = await submitChangeRequest(planId, requestText);

    setIsSubmitting(false);

    if ('data' in result) {
      setRequestText('');
      setSuccessMsg(t(successKey));
    } else {
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
    }
  };

  return (
    <View
      style={[styles.card, { borderColor: palette.icon + '44' }]}
      testID={`student.${planType}.planChangeForm`}>
      <Text style={[styles.cardTitle, { color: palette.text }]}>{t(titleKey)}</Text>

      {isWriteLocked ? (
        <Text style={[styles.writeLock, { color: '#b3261e' }]}>{t('offline.write_lock')}</Text>
      ) : (
        <>
          <Text style={[styles.fieldLabel, { color: palette.text }]}>{t(labelKey)}</Text>
          <TextInput
            accessibilityLabel={t(labelKey)}
            multiline
            numberOfLines={4}
            onChangeText={(v) => {
              setRequestText(v);
              setFieldError(null);
              setSuccessMsg(null);
            }}
            placeholder={t(placeholderKey)}
            placeholderTextColor={palette.icon}
            style={[
              styles.multilineInput,
              {
                backgroundColor: palette.background,
                borderColor: fieldError ? '#b3261e' : palette.icon,
                color: palette.text,
              },
            ]}
            testID={`student.${planType}.planChangeForm.input`}
            value={requestText}
          />

          {fieldError ? (
            <View accessibilityLiveRegion="polite">
              <Text
                style={styles.inlineError}
                testID={`student.${planType}.planChangeForm.error`}>
                {fieldError}
              </Text>
            </View>
          ) : null}

          {successMsg ? (
            <View accessibilityLiveRegion="polite">
              <Text
                style={[styles.successText, { color: palette.tint }]}
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
            style={[
              styles.primaryButton,
              { backgroundColor: isSubmitting ? palette.icon : palette.tint },
            ]}
            testID={`student.${planType}.planChangeForm.submitButton`}>
            {isSubmitting ? (
              <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>{t(ctaKey)}</Text>
            )}
          </Pressable>
        </>
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
    fontSize: 20,
    fontWeight: '700',
  },
  cardMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  infoBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  textInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    flex: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  inlineButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  inlineButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  inlineError: {
    color: '#b3261e',
    fontSize: 13,
  },
  successText: {
    fontSize: 13,
    fontWeight: '600',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  multilineInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    fontSize: 14,
    minHeight: 96,
    padding: 12,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  emptyTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  writeLock: {
    fontSize: 13,
  },
});

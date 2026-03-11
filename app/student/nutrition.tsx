/**
 * SC-209 Student Nutrition Tracking
 * Route: /student/nutrition
 *
 * Visual refresh (2026-03-05): empty state uses an acquisition-focused nutrition
 * illustration while keeping BL-008 offline/write-lock and D-081 hydration-goal
 * ownership behavior.
 */
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DsRadius, DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
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
import { isSelfGuidedPlan } from '@/features/plans/plan-ownership.logic';
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

  const nutritionPlans = plansState.kind === 'ready' ? plansState.plans.filter(p => p.planType === 'nutrition' && !p.isArchived) : [];

  const assignedNutritionPlan = nutritionPlans.find(plan => plan.sourceKind === 'assigned') ?? null;
  const selfManagedNutritionPlan =
    nutritionPlans.find((plan) => isSelfGuidedPlan(plan, currentUser?.uid ?? null)) ?? null;

  const hasActiveNutritionAssignment = assignedNutritionPlan !== null;
  const hasSelfManagedPlan = selfManagedNutritionPlan !== null;

  return (
    <DsScreen scheme={scheme} testID="student.nutrition.screen">
      <Stack.Screen options={{ title: t('student.nutrition.title'), headerShown: false }} />

      <View style={styles.shell}>
        <View style={styles.headerRow}>
          <Text style={[styles.pageTitle, { color: theme.color.textPrimary }]}>
            {t('student.nutrition.title')}
          </Text>
        </View>

        {offlineDisplay.showOfflineBanner ? (
          <DsOfflineBanner scheme={scheme} text={t('offline.banner')} testID="student.nutrition.offlineBanner" />
        ) : null}

        <View style={styles.sectionStack}>
          {plansState.kind === 'loading' ? (
            <DsCard scheme={scheme} style={styles.loadingCard} testID="student.nutrition.plansLoading">
              <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color={theme.color.accentPrimary} />
            </DsCard>
          ) : hasActiveNutritionAssignment ? (
            <>
              <WaterWidget waterHook={waterHook} scheme={scheme} t={t} isWriteLocked={isWriteLocked} />

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
          ) : hasSelfManagedPlan ? (
             <>
              <WaterWidget waterHook={waterHook} scheme={scheme} t={t} isWriteLocked={isWriteLocked} />

              <DsCard scheme={scheme} testID="student.nutrition.selfManagedPlanCard">
                <View style={styles.selfManagedHeader}>
                  <View style={[styles.selfManagedIconWrap, { backgroundColor: theme.color.accentPrimarySoft }]}>
                    <MaterialIcons color={theme.color.accentPrimary} name="restaurant" size={24} />
                  </View>
                  <View style={styles.selfManagedTextWrap}>
                    <Text style={[styles.selfManagedTitle, { color: theme.color.textPrimary }]}>
                      {selfManagedNutritionPlan.name || t('student.home.nutrition.section')}
                    </Text>
                    <Text style={[styles.selfManagedSubtitle, { color: theme.color.textSecondary }]}>
                      {t('student.plan.nutrition.title.edit')}
                    </Text>
                  </View>
                </View>

                <DsPillButton
                  scheme={scheme}
                  label={t('student.home.cta_nutrition')}
                  onPress={() => router.push(`/student/nutrition/plans/${selfManagedNutritionPlan.id}`)}
                  style={styles.selfManagedCta}
                  testID="student.nutrition.editSelfManagedPlanCta"
                />
              </DsCard>
            </>
          ) : (
            <View style={styles.emptyStateWrap} testID="student.nutrition.emptyState">
              <View style={styles.emptyHero}>
                <View
                  style={[
                    styles.emptyGlow,
                    {
                      backgroundColor:
                        scheme === 'dark' ? 'rgba(30, 169, 90, 0.14)' : 'rgba(19, 236, 73, 0.16)',
                    },
                  ]}
                />

                <View
                  style={[
                    styles.emptyIllustrationCard,
                    DsShadow.floating,
                    {
                      backgroundColor: theme.color.surface,
                      borderColor: scheme === 'dark' ? 'rgba(19, 236, 73, 0.22)' : 'rgba(19, 236, 73, 0.18)',
                      shadowColor: scheme === 'dark' ? '#000000' : '#1ea95a',
                    },
                  ]}>
                  <View
                    style={[
                      styles.emptyPlate,
                      { backgroundColor: scheme === 'dark' ? '#203828' : '#eef8f0', borderColor: '#13ec49' },
                    ]}>
                    <View style={[styles.emptyFoodLeaf, styles.emptyFoodLeafTop, { backgroundColor: '#13ec49' }]} />
                    <View style={[styles.emptyFoodLeaf, styles.emptyFoodLeafLeft, { backgroundColor: '#7ddf75' }]} />
                    <View style={[styles.emptyFoodLeaf, styles.emptyFoodLeafRight, { backgroundColor: '#43c463' }]} />
                    <View style={[styles.emptyFoodSlice, { backgroundColor: '#ff8a65' }]} />
                    <View style={[styles.emptyFoodBean, styles.emptyFoodBeanOne, { backgroundColor: '#ffd54f' }]} />
                    <View style={[styles.emptyFoodBean, styles.emptyFoodBeanTwo, { backgroundColor: '#ffd54f' }]} />
                  </View>

                  <View
                    style={[
                      styles.emptyOverlayPanel,
                      { backgroundColor: scheme === 'dark' ? 'rgba(16, 34, 21, 0.9)' : 'rgba(255,255,255,0.92)' },
                    ]}>
                    <View style={styles.emptyOverlayRow}>
                      <MaterialIcons color="#13ec49" name="restaurant-menu" size={18} />
                      <View
                        style={[
                          styles.emptyProgressTrack,
                          { backgroundColor: scheme === 'dark' ? 'rgba(19, 236, 73, 0.18)' : 'rgba(19, 236, 73, 0.16)' },
                        ]}>
                        <View style={styles.emptyProgressFill} />
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.emptyCopyBlock}>
                <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>
                  {t('student.nutrition.empty.title')}
                </Text>
                <Text style={[styles.emptyBody, { color: theme.color.textSecondary }]}>
                  {t('student.nutrition.empty.body')}
                </Text>
              </View>

              <DsPillButton
                scheme={scheme}
                disabled={isWriteLocked}
                label={t('student.nutrition.empty.cta')}
                onPress={() => router.push('/student/professionals')}
                contentColor="#f8fafc"
                testID="student.nutrition.emptyCta"
                style={styles.emptyPrimaryCta}
                leftIcon={<MaterialIcons color="#f8fafc" name="person-add" size={20} />}
              />

              <Pressable
                accessibilityRole="button"
                disabled={isWriteLocked}
                onPress={() => router.push('/student/nutrition/plans/new' as never)}
                style={({ pressed }) => [
                  styles.emptyTertiaryCta,
                  { opacity: isWriteLocked ? 0.5 : pressed ? 0.7 : 1 },
                ]}
                testID="student.nutrition.emptySelfGuidedCta">
                <Text style={[styles.emptyTertiaryText, { color: theme.color.textSecondary }]}> 
                  {t('student.nutrition.empty.self_guided_cta')}
                </Text>
              </Pressable>

              {isWriteLocked ? (
                <Text style={[styles.writeLockText, { color: theme.color.danger }]}>{t('offline.write_lock')}</Text>
              ) : null}
            </View>
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
  const { state, validateIntake, logIntake } = waterHook;

  const [intakeRaw, setIntakeRaw] = useState('');
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [isLoggingIntake, setIsLoggingIntake] = useState(false);

  const goal = state.kind === 'ready' && state.effectiveGoal ? state.effectiveGoal.dailyMl : null;
  const consumed = state.kind === 'ready' ? state.todayConsumedMl : 0;
  const isMutating = state.kind === 'ready' && Boolean(state.isMutating);

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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.waterValue, { color: theme.color.textPrimary }, isMutating && { opacity: 0.5 }]}>
                    {String(consumed)}
                  </Text>
                  {isMutating && (
                    <ActivityIndicator size="small" color={theme.color.accentCyan} />
                  )}
                </View>
                <Text style={[styles.waterGoalValue, { color: theme.color.textSecondary }]}>{`/ ${goal ?? 0} ml`}</Text>
              </View>

              <View style={[styles.goalBadge, { backgroundColor: theme.color.accentPrimarySoft }]}>
                <MaterialIcons color={theme.color.accentPrimary} name="flag" size={14} />
                <Text style={[styles.goalBadgeText, { color: theme.color.accentPrimary }]}>{goalOwnerLabel}</Text>
              </View>
            </View>

            <View style={[styles.waterIconWrap, { backgroundColor: theme.color.accentPrimarySoft }]}> 
              <MaterialIcons color={theme.color.accentCyan} name="water-drop" size={32} />
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
              <Text style={[styles.writeLockText, { color: theme.color.textSecondary }]}>
                {t('student.nutrition.water.goal_defined_in_plan')}
              </Text>
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
  pageTitle: {
    ...DsTypography.title,
    fontFamily: Fonts.rounded,
  },
  sectionStack: {
    flex: 1,
    gap: DsSpace.md,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
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
    height: 300,
    justifyContent: 'center',
    marginBottom: DsSpace.lg,
    position: 'relative',
    width: 300,
  },
  emptyGlow: {
    borderRadius: 999,
    height: 240,
    position: 'absolute',
    width: 240,
  },
  emptyIllustrationCard: {
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: 1,
    height: 256,
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 24,
    width: 256,
  },
  emptyPlate: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 2,
    height: 154,
    justifyContent: 'center',
    position: 'relative',
    width: 154,
  },
  emptyFoodLeaf: {
    borderRadius: 999,
    height: 44,
    position: 'absolute',
    width: 44,
  },
  emptyFoodLeafTop: {
    top: 28,
    transform: [{ rotate: '-8deg' }],
  },
  emptyFoodLeafLeft: {
    left: 34,
    top: 54,
    transform: [{ rotate: '-28deg' }],
  },
  emptyFoodLeafRight: {
    right: 34,
    top: 58,
    transform: [{ rotate: '24deg' }],
  },
  emptyFoodSlice: {
    borderRadius: 18,
    bottom: 44,
    height: 30,
    position: 'absolute',
    transform: [{ rotate: '-10deg' }],
    width: 54,
  },
  emptyFoodBean: {
    borderRadius: 999,
    height: 18,
    position: 'absolute',
    width: 18,
  },
  emptyFoodBeanOne: {
    bottom: 66,
    left: 54,
  },
  emptyFoodBeanTwo: {
    bottom: 54,
    right: 58,
  },
  emptyOverlayPanel: {
    borderRadius: 16,
    bottom: 18,
    left: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    position: 'absolute',
    right: 18,
  },
  emptyOverlayRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  emptyProgressTrack: {
    borderRadius: 999,
    flex: 1,
    height: 8,
    overflow: 'hidden',
  },
  emptyProgressFill: {
    backgroundColor: '#13ec49',
    height: '100%',
    width: '36%',
  },
  emptyCopyBlock: {
    gap: DsSpace.sm,
    marginBottom: DsSpace.xl,
    maxWidth: 320,
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
  selfManagedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: DsSpace.md,
  },
  selfManagedIconWrap: {
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  selfManagedTextWrap: {
    flex: 1,
    gap: 2,
  },
  selfManagedTitle: {
    ...DsTypography.cardTitle,
  },
  selfManagedSubtitle: {
    ...DsTypography.micro,
  },
  selfManagedCta: {
    marginTop: DsSpace.xs,
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
  emptySecondaryText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  emptyTertiaryCta: {
    marginTop: DsSpace.xs,
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.xs,
  },
  emptyTertiaryText: {
    ...DsTypography.button,
    fontSize: 14,
  },
  writeLockText: {
    ...DsTypography.caption,
    marginTop: DsSpace.sm,
  },
});

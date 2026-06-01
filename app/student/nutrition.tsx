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
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View, type DimensionValue } from 'react-native';

import { useNutritionPlanBuilder } from '@/features/plans/use-plan-builder';
import { logAssignedMealPortion, getTodayPortionLogs, type FirestorePortionLog } from '@/features/nutrition/custom-meal-source';
import { calculateTotalsFromItems, type NutritionMeal } from '@/features/plans/plan-builder.logic';

import { DsRadius, DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { PlanChangeRequestCard } from '@/components/ds/patterns/PlanChangeRequestCard';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import { resolveOfflineDisplayState } from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import type { UseWaterTrackingResult } from '@/features/nutrition/use-water-tracking';
import { useWaterTracking } from '@/features/nutrition/use-water-tracking';
import { resolveStudentNutritionState } from '@/features/plans/student-nutrition-state.logic';
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
  const { state: connectionsState } = useConnections(Boolean(currentUser));

  const hasActiveNutritionistConnection =
    connectionsState.kind === 'ready' &&
    connectionsState.connections.some(
      (connection) => connection.specialty === 'nutritionist' && connection.status === 'active'
    );
  const nutritionState = resolveStudentNutritionState({
    currentUserUid: currentUser?.uid ?? null,
    hasActiveNutritionistConnection,
    plans: plansState.kind === 'ready' ? plansState.plans : [],
  });
  const assignedNutritionPlan = nutritionState.kind === 'assigned' ? nutritionState.assignedPlan : null;
  const selfManagedNutritionPlan = nutritionState.kind === 'self_managed' ? nutritionState.selfManagedPlan : null;
  const isConnectionsPending = Boolean(currentUser) && (connectionsState.kind === 'idle' || connectionsState.kind === 'loading');
  const hasConnectionsError = Boolean(currentUser) && connectionsState.kind === 'error';
  const loadErrorMessage =
    plansState.kind === 'error'
      ? plansState.message
      : connectionsState.kind === 'error'
        ? connectionsState.message
        : null;

  const { state: builderState, loadPlan } = useNutritionPlanBuilder(Boolean(currentUser), 'student-assigned');
  const [todayPortionLogs, setTodayPortionLogs] = useState<FirestorePortionLog[]>([]);
  const [expandedMealIds, setExpandedMealIds] = useState<string[]>([]);
  const [isLoggingMealId, setIsLoggingMealId] = useState<string | null>(null);
  
  const loggingMealsRef = useRef(new Set<string>());
  const loggedMealIds = todayPortionLogs.map((log) => log.mealId);

  const todayConsumed = {
    calories: 0,
    carbs: 0,
    proteins: 0,
    fats: 0,
  };

  for (const log of todayPortionLogs) {
    todayConsumed.calories += Number(log.snapshot?.calories || 0);
    todayConsumed.carbs += Number(log.snapshot?.carbs || 0);
    todayConsumed.proteins += Number(log.snapshot?.proteins || 0);
    todayConsumed.fats += Number(log.snapshot?.fats || 0);
  }

  const getProgressWidth = (consumed: number, target: number): DimensionValue => {
    if (!target) return '0%';
    const pct = Math.min((consumed / target) * 100, 100);
    return `${pct}%` as DimensionValue;
  };

  const assignedNutritionPlanId = assignedNutritionPlan?.id;
  useEffect(() => {
    if (assignedNutritionPlanId) {
      loadPlan(assignedNutritionPlanId);
    }
  }, [assignedNutritionPlanId, loadPlan]);

  useEffect(() => {
    if (currentUser) {
      getTodayPortionLogs()
        .then((logs) => {
          setTodayPortionLogs(logs);
        })
        .catch((err) => {
          console.error('Error loading today portion logs:', err);
        });
    }
  }, [currentUser]);

  const toggleMealExpand = (mealId: string) => {
    setExpandedMealIds((prev) =>
      prev.includes(mealId) ? prev.filter((id) => id !== mealId) : [...prev, mealId]
    );
  };

  const handleLogMeal = async (meal: NutritionMeal) => {
    if (isWriteLocked || loggedMealIds.includes(meal.id) || loggingMealsRef.current.has(meal.id)) return;
    
    loggingMealsRef.current.add(meal.id);
    setIsLoggingMealId(meal.id);
    try {
      const totals = calculateTotalsFromItems(meal.items || []);
      const snapshot = {
        calories: Math.round(totals.calories),
        carbs: Math.round(totals.carbs),
        proteins: Math.round(totals.proteins),
        fats: Math.round(totals.fats),
      };

      await logAssignedMealPortion(meal.id, snapshot);
      
      const newLog: FirestorePortionLog = {
        id: Math.random().toString(),
        ownerUid: currentUser?.uid || '',
        mealId: meal.id,
        consumedGrams: 0,
        snapshot,
        loggedAt: new Date().toISOString(),
      };
      setTodayPortionLogs((prev) => [...prev, newLog]);
    } catch (err) {
      console.error('Failed to log meal portion:', err);
      Alert.alert(t('common.error.generic'), t('student.nutrition.plan_change.error.unknown') || 'Something went wrong. Try again.');
    } finally {
      loggingMealsRef.current.delete(meal.id);
      setIsLoggingMealId(null);
    }
  };

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
          {plansState.kind === 'loading' || isConnectionsPending ? (
            <DsCard scheme={scheme} style={styles.loadingCard} testID="student.nutrition.plansLoading">
              <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color={theme.color.accentPrimary} />
            </DsCard>
          ) : plansState.kind === 'error' || hasConnectionsError ? (
            <DsCard scheme={scheme} style={styles.loadingCard} testID="student.nutrition.loadError">
              <Text style={[styles.loadErrorText, { color: theme.color.danger }]}>{loadErrorMessage ?? t('common.error.generic')}</Text>
            </DsCard>
          ) : nutritionState.kind === 'assigned' && assignedNutritionPlan ? (
            <>
              {builderState.kind === 'loading' ? (
                <DsCard scheme={scheme} style={styles.loadingCard} testID="student.nutrition.planDetailsLoading">
                  <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color={theme.color.accentPrimary} />
                </DsCard>
              ) : builderState.kind === 'ready' ? (
                <>
                  <DsCard scheme={scheme} style={styles.macroCard} testID="student.nutrition.macroCard">
                    <View style={styles.macroHeaderRow}>
                      <View style={[styles.macroIconWrap, { backgroundColor: theme.color.accentPrimarySoft }]}>
                        <MaterialIcons color={theme.color.accentPrimary} name="local-fire-department" size={24} />
                      </View>
                      <View style={styles.macroHeaderTextWrap}>
                        <Text style={[styles.macroHeaderSubtitle, { color: theme.color.textSecondary }]}>
                          {t('student.nutrition.target_dashboard.title')}
                        </Text>
                        <Text style={[styles.macroHeaderTitle, { color: theme.color.textPrimary }]}>
                          {`${Math.round(todayConsumed.calories)} / ${Math.round(builderState.plan.caloriesTarget || 0)} kcal`}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.progressBarTrack, { backgroundColor: theme.color.surfaceMuted }]}>
                      <View style={[styles.progressBarFill, { width: getProgressWidth(todayConsumed.calories, builderState.plan.caloriesTarget), backgroundColor: theme.color.accentPrimary }]} />
                    </View>

                    <View style={styles.macroGrid}>
                      <View style={[styles.macroItem, { backgroundColor: theme.color.surfaceMuted }]}>
                        <Text style={[styles.macroLabel, { color: theme.color.textSecondary }]}>
                          {t('common.nutrition.carbs')}
                        </Text>
                        <Text style={[styles.macroValue, { color: theme.color.textPrimary }]}>
                          {`${Math.round(todayConsumed.carbs)}/${Math.round(builderState.plan.carbsTarget || 0)}g`}
                        </Text>
                        <View style={[styles.progressBarTrack, { backgroundColor: theme.color.border, height: 4, marginTop: 4 }]}>
                          <View style={[styles.progressBarFill, { width: getProgressWidth(todayConsumed.carbs, builderState.plan.carbsTarget), backgroundColor: theme.color.accentPrimary, height: 4 }]} />
                        </View>
                      </View>

                      <View style={[styles.macroItem, { backgroundColor: theme.color.surfaceMuted }]}>
                        <Text style={[styles.macroLabel, { color: theme.color.textSecondary }]}>
                          {t('common.nutrition.proteins')}
                        </Text>
                        <Text style={[styles.macroValue, { color: theme.color.textPrimary }]}>
                          {`${Math.round(todayConsumed.proteins)}/${Math.round(builderState.plan.proteinsTarget || 0)}g`}
                        </Text>
                        <View style={[styles.progressBarTrack, { backgroundColor: theme.color.border, height: 4, marginTop: 4 }]}>
                          <View style={[styles.progressBarFill, { width: getProgressWidth(todayConsumed.proteins, builderState.plan.proteinsTarget), backgroundColor: theme.color.accentPrimary, height: 4 }]} />
                        </View>
                      </View>

                      <View style={[styles.macroItem, { backgroundColor: theme.color.surfaceMuted }]}>
                        <Text style={[styles.macroLabel, { color: theme.color.textSecondary }]}>
                          {t('common.nutrition.fats')}
                        </Text>
                        <Text style={[styles.macroValue, { color: theme.color.textPrimary }]}>
                          {`${Math.round(todayConsumed.fats)}/${Math.round(builderState.plan.fatsTarget || 0)}g`}
                        </Text>
                        <View style={[styles.progressBarTrack, { backgroundColor: theme.color.border, height: 4, marginTop: 4 }]}>
                          <View style={[styles.progressBarFill, { width: getProgressWidth(todayConsumed.fats, builderState.plan.fatsTarget), backgroundColor: theme.color.accentPrimary, height: 4 }]} />
                        </View>
                      </View>
                    </View>
                  </DsCard>

                  <View style={styles.mealsSection} testID="student.nutrition.mealsSection">
                    <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>
                      {t('student.nutrition.meals.title')}
                    </Text>

                    {builderState.plan.meals && builderState.plan.meals.length > 0 ? (
                      builderState.plan.meals.map((meal) => {
                        const isExpanded = expandedMealIds.includes(meal.id);
                        const isLogged = loggedMealIds.includes(meal.id);
                        const isLogging = isLoggingMealId === meal.id;

                        let mealCal = 0;
                        let mealCarbs = 0;
                        let mealProt = 0;
                        let mealFats = 0;
                        for (const item of meal.items || []) {
                          mealCal += Number(item.calories || 0);
                          mealCarbs += Number(item.carbs || 0);
                          mealProt += Number(item.proteins || 0);
                          mealFats += Number(item.fats || 0);
                        }

                        return (
                          <DsCard
                            key={meal.id}
                            scheme={scheme}
                            style={styles.mealCard}
                            testID={`student.nutrition.mealCard.${meal.id}`}
                          >
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => toggleMealExpand(meal.id)}
                              style={styles.mealHeaderPressable}
                            >
                              <View style={styles.mealHeaderLeft}>
                                <Text style={[styles.mealName, { color: theme.color.textPrimary }]}>
                                  {meal.name}
                                </Text>
                                <Text style={[styles.mealSummaryText, { color: theme.color.textSecondary }]}>
                                  {`${Math.round(mealCal)} kcal · ${Math.round(mealCarbs)}g C · ${Math.round(mealProt)}g P · ${Math.round(mealFats)}g F`}
                                </Text>
                              </View>

                              <View style={styles.mealHeaderRight}>
                                {isLogged ? (
                                  <View style={[styles.loggedBadge, { backgroundColor: theme.color.successSoft }]}>
                                    <MaterialIcons color={theme.color.success} name="check-circle" size={16} />
                                    <Text style={[styles.loggedBadgeText, { color: theme.color.success }]}>
                                      {t('student.nutrition.meal.logged_badge')}
                                    </Text>
                                  </View>
                                ) : (
                                  <DsPillButton
                                    scheme={scheme}
                                    disabled={isWriteLocked}
                                    label={t('student.nutrition.meal.log_button')}
                                    loading={isLogging}
                                    onPress={() => handleLogMeal(meal)}
                                    style={styles.logButton}
                                    testID={`student.nutrition.logMealButton.${meal.id}`}
                                  />
                                )}
                                <MaterialIcons
                                  color={theme.color.textSecondary}
                                  name={isExpanded ? 'expand-less' : 'expand-more'}
                                  size={24}
                                  style={styles.expandIcon}
                                />
                              </View>
                            </Pressable>

                            {isExpanded && (
                              <View style={styles.mealDetails} testID={`student.nutrition.mealDetails.${meal.id}`}>
                                <View style={[styles.divider, { backgroundColor: theme.color.border }]} />
                                
                                <Text style={[styles.detailsLabel, { color: theme.color.textSecondary }]}>
                                  {t('student.nutrition.meal.items_label')}
                                </Text>

                                {meal.items && meal.items.length > 0 ? (
                                  <View style={styles.itemsList}>
                                    {meal.items.map((item) => (
                                      <View key={item.id} style={styles.itemRow}>
                                        <View style={[styles.itemDot, { backgroundColor: theme.color.accentPrimary }]} />
                                        <View style={styles.itemInfo}>
                                          <Text style={[styles.itemName, { color: theme.color.textPrimary }]}>
                                            {item.name}
                                          </Text>
                                          {Boolean(item.quantity) && (
                                            <Text style={[styles.itemQuantity, { color: theme.color.textSecondary }]}>
                                              {item.quantity}
                                            </Text>
                                          )}
                                          {Boolean(item.notes) && (
                                            <Text style={[styles.itemNotes, { color: theme.color.textSecondary }]}>
                                              {item.notes}
                                            </Text>
                                          )}
                                        </View>
                                      </View>
                                    ))}
                                  </View>
                                ) : (
                                  <Text style={[styles.noItemsText, { color: theme.color.textTertiary }]}>
                                    No food items.
                                  </Text>
                                )}
                              </View>
                            )}
                          </DsCard>
                        );
                      })
                    ) : (
                      <Text style={[styles.noMealsText, { color: theme.color.textSecondary }]}>
                        No meals planned for today.
                      </Text>
                    )}
                  </View>
                </>
              ) : null}

              <WaterWidget waterHook={waterHook} scheme={scheme} t={t} isWriteLocked={isWriteLocked} />



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
          ) : nutritionState.kind === 'waiting' ? (
            <View style={styles.emptyStateWrap} testID="student.nutrition.waitingForNutritionistPlan">
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
                  <MaterialIcons color="#13ec49" name="hourglass-top" size={58} />
                </View>
              </View>

              <View style={styles.emptyCopyBlock}>
                <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>{t('student.nutrition.waiting.title')}</Text>
                <Text style={[styles.emptyBody, { color: theme.color.textSecondary }]}>{t('student.nutrition.waiting.body')}</Text>
              </View>

              <DsPillButton
                scheme={scheme}
                disabled={isWriteLocked}
                label={t('student.nutrition.waiting.cta')}
                onPress={() => router.push('/student/professionals')}
                contentColor="#f8fafc"
                testID="student.nutrition.waitingCta"
                style={styles.emptyPrimaryCta}
                leftIcon={<MaterialIcons color="#f8fafc" name="person" size={20} />}
              />
            </View>
          ) : nutritionState.kind === 'self_managed' && selfManagedNutritionPlan ? (
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
  loadErrorText: {
    ...DsTypography.caption,
    textAlign: 'center',
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
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  macroCard: {
    gap: 12,
  },
  macroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  macroIconWrap: {
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  macroHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  macroHeaderSubtitle: {
    ...DsTypography.micro,
  },
  macroHeaderTitle: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Fonts.rounded,
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  macroItem: {
    flex: 1,
    borderRadius: DsRadius.md,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 2,
  },
  macroLabel: {
    ...DsTypography.micro,
  },
  macroValue: {
    ...DsTypography.button,
    fontSize: 14,
  },
  mealsSection: {
    gap: 12,
    marginTop: DsSpace.xs,
  },
  sectionTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts.rounded,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  mealCard: {
    padding: DsSpace.sm,
    gap: DsSpace.sm,
  },
  mealHeaderPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mealHeaderLeft: {
    flex: 1,
    gap: 2,
    marginRight: 12,
  },
  mealHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealName: {
    ...DsTypography.button,
    fontSize: 16,
    fontWeight: '600',
  },
  mealSummaryText: {
    ...DsTypography.caption,
  },
  loggedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: DsRadius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  loggedBadgeText: {
    ...DsTypography.micro,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  logButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: DsRadius.pill,
  },
  expandIcon: {
    marginLeft: 4,
  },
  mealDetails: {
    marginTop: DsSpace.xs,
    gap: DsSpace.xs,
  },
  divider: {
    height: 1,
    width: '100%',
    marginBottom: DsSpace.xs,
  },
  detailsLabel: {
    ...DsTypography.micro,
    marginBottom: DsSpace.xxs,
  },
  itemsList: {
    gap: DsSpace.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  itemInfo: {
    flex: 1,
    gap: 1,
  },
  itemName: {
    ...DsTypography.body,
    fontWeight: '500',
  },
  itemQuantity: {
    ...DsTypography.caption,
  },
  itemNotes: {
    ...DsTypography.caption,
    fontStyle: 'italic',
  },
  noItemsText: {
    ...DsTypography.caption,
  },
  noMealsText: {
    ...DsTypography.caption,
    textAlign: 'center',
    marginVertical: DsSpace.md,
  },
});

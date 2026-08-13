/**
 * SC-207 Nutrition Plan Builder
 * Route: /professional/nutrition/plans/:planId
 */
import { useNavigation } from '@react-navigation/native';
import { Redirect, Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { BuilderGuidanceCard } from '@/components/ds/patterns/BuilderGuidanceCard';
import { PlanChangeRequestCard } from '@/components/ds/patterns/PlanChangeRequestCard';
import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DsRadius, DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  createBuilderPalette,
  createBuilderRoleTranslator,
  enableBuilderLayoutAnimations,
} from '@/features/plans/builder-screen';
import { BuilderAlertBanner } from '@/features/plans/components/BuilderAlertBanner';
import { BuilderBackgroundErrorBanner } from '@/features/plans/components/BuilderBackgroundErrorBanner';
import { BuilderLoadingScrim } from '@/features/plans/components/BuilderLoadingScrim';
import { PlanMetadataForm } from '@/features/plans/components/PlanMetadataForm';
import { isStarterTemplate, calculateTotalsFromItems } from '@/features/plans/plan-builder.logic';
import { isReadOnlyForStudentSurface } from '@/features/plans/plan-ownership.logic';
import { useNutritionPlanBuilder } from '@/features/plans/use-plan-builder';
import { usePlanForm } from '@/features/plans/use-plan-form';
import { usePlans } from '@/features/plans/use-plans';
import * as Haptics from '@/features/platform/haptics-adapter';
import { resolveProfessionalNutritionRouteGate } from '@/features/professional/specialty.logic';
import { useSpecialties } from '@/features/professional/use-professional';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePersistentGuidance } from '@/hooks/use-persistent-guidance';
import { useTranslation } from '@/localization';

enableBuilderLayoutAnimations();

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NutritionPlanBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);

  const palette = useMemo(() => createBuilderPalette(theme), [theme]);

  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation<any>();
  const pathname = usePathname();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { currentUser, lockedRole } = useAuthSession();
  const isStudentBuilder = pathname.startsWith('/student/');
  const shouldGateProfessionalNutrition = !isStudentBuilder;
  const { state: specialtiesState } = useSpecialties(
    Boolean(currentUser) && shouldGateProfessionalNutrition && lockedRole === 'professional',
  );
  const nutritionGate = shouldGateProfessionalNutrition
    ? resolveProfessionalNutritionRouteGate({
        role: lockedRole,
        specialties: specialtiesState.kind === 'ready' ? specialtiesState.specialties : [],
        specialtiesStatus: specialtiesState.kind,
      })
    : 'allow';

  const tr = useMemo(() => createBuilderRoleTranslator(isStudentBuilder, t), [isStudentBuilder, t]);

  const {
    state,
    loadPlan,
    createPlan,
    savePlan,
    addMeal,
    removeMeal,
    reorderMeals,
    deletePlan,
    initNewPlan,
    validateInput,
  } = useNutritionPlanBuilder(
    Boolean(currentUser) && nutritionGate === 'allow',
    `${pathname}:plan:${planId ?? 'new'}`,
  );

  const { submitChangeRequest, validateChangeRequest } = usePlans(Boolean(currentUser), {
    fetchOnMount: false,
  });

  // ── Form logic ─────────────────────────────────────────────────────────────
  const isNew = planId === 'new';
  const isStarterClone = typeof planId === 'string' && isStarterTemplate(planId);
  const isDraftAssignment =
    state.kind === 'ready' && state.plan.isDraft && state.plan.sourceKind === 'assigned';
  // D-006 / ET-107: a Student may only view — never edit — a professionally
  // assigned (or otherwise non-self-managed) plan. Fail-closed by source kind,
  // not by a cosmetic path flag.
  const isReadOnlyAssignedPlan =
    state.kind === 'ready' &&
    isReadOnlyForStudentSurface({ sourceKind: state.plan.sourceKind }, isStudentBuilder);
  const creationMode = isStudentBuilder ? 'self_managed' : 'professional_library';

  const initialValues = useMemo(
    () => ({
      name: state.kind === 'ready' ? state.plan.name : '',
      hydrationGoalMl:
        state.kind === 'ready' && state.plan.hydrationGoalMl
          ? String(state.plan.hydrationGoalMl)
          : '',
    }),
    [state],
  );

  const {
    values,
    setFieldValue,
    errors: formErrors,
    isSaving,
    isDirty,
    setIsDirty,
    handleSave,
  } = usePlanForm({
    initialValues,
    validate: (v) => validateInput(v as any),
    t,
    onSave: async (formValues) => {
      if (isNew || isStarterClone) {
        return createPlan(formValues, creationMode);
      }
      return savePlan(planId, formValues, isDraftAssignment);
    },
    onSuccess: (id) => {
      Keyboard.dismiss();
      // After a successful save, we want to go back to the library.
      // We must clear the local dirty state first.
      setIsDirty(false);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigate to the tab route so the bottom nav bar is visible
      router.replace('/nutrition');
    },
  });

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event: any) => {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      Alert.alert(t('pro.plan.discard.title'), t('pro.plan.discard.body'), [
        { text: t('pro.plan.discard.no'), style: 'cancel' },
        {
          text: t('pro.plan.discard.yes'),
          style: 'destructive',
          onPress: async () => {
            setIsDirty(false);
            navigation.dispatch(event.data.action);
          },
        },
      ]);
    });

    return unsubscribe;
  }, [isDirty, navigation, t, setIsDirty]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/nutrition');
    }
  }, [router]);

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [addMealForm, setAddMealForm] = useState<
    { kind: 'closed' } | { kind: 'open'; name: string }
  >({ kind: 'closed' });
  const [isSortMode, setIsSortMode] = useState(false);
  const [showGuidance, hideGuidance] = usePersistentGuidance('guidance.nutrition_builder');
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);
  const [shouldNavigateAfterDelete, setShouldNavigateAfterDelete] = useState(false);
  const isMutating = state.kind === 'ready' && Boolean(state.isMutating);
  const isInitialLoading = state.kind === 'loading';
  const isBusy = isSaving || isMutating || isDeletingPlan;

  useEffect(() => {
    if (!isNew) {
      Keyboard.dismiss();
    }
  }, [isNew, planId]);

  // ── Load existing plan ─────────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (nutritionGate !== 'allow') {
      return;
    }

    if (isNew) {
      initNewPlan();
    } else if (!isStarterClone && planId) {
      loadPlan(planId);
    }
  }, [planId, isNew, isStarterClone, loadPlan, initNewPlan, nutritionGate]);

  useEffect(() => {
    if (!shouldNavigateAfterDelete || isDeletingPlan) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      setShouldNavigateAfterDelete(false);
      router.replace(isStudentBuilder ? '/student/nutrition' : '/professional/nutrition');
    });

    return () => cancelAnimationFrame(frame);
  }, [shouldNavigateAfterDelete, isDeletingPlan, router, isStudentBuilder]);

  // ── Handlers with Animations ───────────────────────────────────────────────
  const handleAddMeal = useCallback(async () => {
    if (isBusy || addMealForm.kind !== 'open' || state.kind !== 'ready') return;
    const { name: mealName } = addMealForm;
    if (!mealName.trim()) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const { planId: realId, error } = await addMeal(
      state.plan.id,
      { name: mealName },
      { name: values.name, hydrationGoalMl: values.hydrationGoalMl },
      creationMode,
    );

    if (error) {
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
    } else {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAddMealForm({ kind: 'closed' });
      setIsDirty(true);

      // If it was a new plan, update the URL to avoid 'new' ID
      if (isNew) {
        router.replace(
          `${isStudentBuilder ? '/student/nutrition/plans' : '/professional/nutrition/plans'}/${realId}` as any,
        );
      }
    }
  }, [
    isBusy,
    addMealForm,
    state,
    addMeal,
    values.name,
    values.hydrationGoalMl,
    creationMode,
    tr,
    setIsDirty,
    isNew,
    isStudentBuilder,
    router,
  ]);

  const handleRemoveMeal = useCallback(
    (mealId: string) => {
      if (isBusy || state.kind !== 'ready') return;

      const meal = state.plan.meals.find((m) => m.id === mealId);
      const mealName = meal?.name || t('pro.plan.section.meals');

      Alert.alert(
        t('common.cta.delete'),
        (t('pro.plan.delete.body')).replace('{name}', mealName),
        [
          { text: t('common.cta.cancel'), style: 'cancel' },
          {
            text: t('common.cta.delete'),
            style: 'destructive',
            onPress: () => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              void removeMeal(state.plan.id, mealId);
              setIsDirty(true);
            },
          },
        ],
      );
    },
    [isBusy, state, removeMeal, setIsDirty, t],
  );

  const handleMoveMeal = useCallback(
    async (index: number, direction: 'up' | 'down') => {
      if (isBusy || state.kind !== 'ready') return;
      const newMeals = [...state.plan.meals];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newMeals.length) return;

      const [moved] = newMeals.splice(index, 1);
      newMeals.splice(targetIndex, 0, moved);

      // Immediate visual update with animation
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Call optimistic reorder
      await reorderMeals(
        state.plan.id,
        newMeals.map((m) => m.id),
      );
    },
    [isBusy, state, reorderMeals],
  );

  const handleFieldChange = useCallback(
    (field: keyof typeof values, v: string) => {
      setFieldValue(field, v);
    },
    [setFieldValue],
  );

  const handleCloseAddMeal = useCallback(() => {
    setAddMealForm({ kind: 'closed' });
  }, []);

  const handleOpenAddMeal = useCallback(() => {
    setAddMealForm({ kind: 'open', name: '' });
  }, []);

  const handleNavigateToMeal = useCallback(
    (mealId: string) => {
      router.push(
        `${isStudentBuilder ? '/student/nutrition/plans' : '/professional/nutrition/plans'}/${planId}/meals/${mealId}` as any,
      );
    },
    [isStudentBuilder, planId, router],
  );

  const handleDeletePlan = useCallback(() => {
    if (isBusy || isNew || !planId) return;

    Alert.alert(
      tr('pro.plan.delete.title', 'student.plan.delete.title'),
      tr('pro.plan.delete.body', 'student.plan.delete.body'),
      [
        { text: t('common.cta.cancel'), style: 'cancel' },
        {
          text: t('common.cta.delete'),
          style: 'destructive',
          onPress: async () => {
            setIsDeletingPlan(true);
            const err = await deletePlan(planId);
            if (!err) {
              setShouldNavigateAfterDelete(true);
              setIsDeletingPlan(false);
            } else {
              setIsDeletingPlan(false);
              Alert.alert(tr('pro.plan.error.delete', 'student.plan.error.delete'));
            }
          },
        },
      ],
    );
  }, [isBusy, isNew, planId, deletePlan, t, tr]);

  if (nutritionGate === 'loading') {
    return (
      <DsScreen
        scheme={scheme}
        contentWidth="content"
        contentContainerStyle={[styles.content, styles.centeredContent]}
      >
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator
          accessibilityLabel={t('a11y.loading.default')}
          color={theme.color.accentPrimary}
        />
      </DsScreen>
    );
  }

  if (nutritionGate === 'redirect') {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <DsScreen
      scheme={scheme}
      contentWidth="content"
      contentContainerStyle={styles.content}
      testID="pro.nutrition_plan.screen"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header Row ──────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <DsBackButton
          scheme={scheme}
          onPress={handleBack}
          accessibilityLabel={t('auth.role.cta_back')}
          style={styles.backButton}
          testID="pro.nutrition_plan.backButton"
        />

        {!isReadOnlyAssignedPlan && (
          <View style={{ flexDirection: 'row', gap: DsSpace.sm, alignItems: 'center' }}>
            <DsPillButton
              scheme={scheme}
              variant="primary"
              size="sm"
              fullWidth={false}
              label={
                isDraftAssignment
                  ? t('pro.plan.cta.assign_and_send')
                  : tr('pro.plan.cta.save', 'student.plan.cta.save')
              }
              onPress={handleSave}
              disabled={!isDirty || isSaving}
              loading={isSaving}
              testID="pro.nutrition_plan.saveButton"
            />

            {!isNew && (
              <Pressable
                onPress={handleDeletePlan}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('common.cta.delete')}
                style={styles.headerActionBtn}
              >
                <IconSymbol name="trash" size={20} color={palette.danger} />
              </Pressable>
            )}
          </View>
        )}
      </View>

      {isDraftAssignment && (
        <BuilderAlertBanner
          message={t('pro.plan.draft_banner.nutrition')}
          backgroundColor={palette.tint}
          textColor={theme.color.surface}
        />
      )}

      {isReadOnlyAssignedPlan && (
        <BuilderAlertBanner
          message={t('student.nutrition.assigned_plan.read_only_notice')}
          backgroundColor={palette.tint}
          textColor={theme.color.surface}
          testID="student.nutrition_plan.readOnlyNotice"
        />
      )}

      <BuilderGuidanceCard
        theme={theme}
        visible={showGuidance}
        onDismiss={hideGuidance}
        title={tr(
          'pro.plan.builder.guidance.nutrition.title',
          'student.plan.builder.guidance.nutrition.title',
        )}
        description={tr(
          'pro.plan.builder.guidance.nutrition.body',
          'student.plan.builder.guidance.nutrition.body',
        )}
      />

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {state.kind === 'error' && (
        <BuilderAlertBanner
          message={tr('pro.plan.error.load', 'student.plan.error.load')}
          backgroundColor={palette.icon}
          textColor={palette.background}
        />
      )}

      {state.kind === 'ready' && state.backgroundError && (
        <BuilderBackgroundErrorBanner
          theme={theme}
          message={`${t('common.error.generic')} • Background update failed`}
        />
      )}

      {/* Plan metadata form ────────────────────────────────────────────── */}
      <PlanMetadataForm
        palette={palette}
        theme={theme}
        t={t}
        tr={tr}
        name={values.name}
        hydrationGoalMl={values.hydrationGoalMl}
        caloriesTarget={state.kind === 'ready' ? String(state.plan.caloriesTarget) : '0'}
        carbsTarget={state.kind === 'ready' ? String(state.plan.carbsTarget) : '0'}
        proteinsTarget={state.kind === 'ready' ? String(state.plan.proteinsTarget) : '0'}
        fatsTarget={state.kind === 'ready' ? String(state.plan.fatsTarget) : '0'}
        errors={formErrors}
        onNameChange={(v) => handleFieldChange('name', v)}
        onHydrationGoalChange={(v) => handleFieldChange('hydrationGoalMl', v)}
        autoFocus={isNew && !values.name}
        readOnly={isReadOnlyAssignedPlan}
        testIDPrefix="pro.plan.metadata"
      />

      {/* ── Food items list ───────────────────────────────────────────────── */}
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionHeader, { color: palette.text }]}>
          {tr('pro.plan.section.meals', 'student.plan.section.meals')}
        </Text>
        <Text style={[styles.supportText, { color: palette.icon, marginTop: 2 }]}>
          {tr('pro.plan.section.meals.support', 'student.plan.section.meals.support')}
        </Text>
      </View>

      {/* ── Add meal form ─────────────────────────────────────────────────── */}
      {!isReadOnlyAssignedPlan &&
        !isSortMode &&
        state.kind === 'ready' &&
        addMealForm.kind === 'open' && (
          <Animated.View
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(200)}
            style={[styles.addMealInline, { backgroundColor: theme.color.surface }]}
          >
            <TextInput
              style={[styles.addMealInput, { color: palette.text }]}
              placeholder={t('pro.plan.meal.name.placeholder')}
              placeholderTextColor={palette.icon}
              value={addMealForm.name}
              onChangeText={(v) => setAddMealForm({ ...addMealForm, name: v })}
              autoFocus
              testID="pro.nutrition_plan.addMeal.input"
            />
            <View style={styles.addMealActions}>
              <DsPillButton
                scheme={scheme}
                variant="ghost"
                size="sm"
                label={t('common.cta.cancel')}
                onPress={handleCloseAddMeal}
                disabled={isBusy}
                fullWidth={false}
                testID="pro.nutrition_plan.addMeal.cancel"
              />
              <DsPillButton
                scheme={scheme}
                variant="ghost"
                size="sm"
                label={t('common.cta.add')}
                onPress={handleAddMeal}
                disabled={isBusy || !addMealForm.name.trim()}
                fullWidth={false}
                testID="pro.nutrition_plan.addMeal.confirm"
              />
            </View>
          </Animated.View>
        )}

      {!isReadOnlyAssignedPlan &&
        !isSortMode &&
        state.kind === 'ready' &&
        addMealForm.kind === 'closed' && (
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('pro.plan.cta.add_meal', 'student.plan.cta.add_meal')}
              disabled={isBusy}
              onPress={handleOpenAddMeal}
              testID="pro.nutrition_plan.addMeal"
              style={({ pressed }) => [
                styles.addMealButton,
                {
                  borderColor: palette.tint,
                  opacity: isBusy ? 0.6 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <IconSymbol name="plus.circle.fill" size={20} color={palette.tint} />
              <Text style={[styles.addMealButtonText, { color: palette.tint }]}>
                {tr('pro.plan.cta.add_meal', 'student.plan.cta.add_meal')}
              </Text>
            </Pressable>

            {state.plan.meals.length > 1 && (
              <DsPillButton
                scheme={scheme}
                variant="outline"
                label={t('pro.plan.cta.sort')}
                onPress={() => {
                  if (isBusy) return;
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setIsSortMode(true);
                }}
                disabled={isBusy}
                fullWidth={false}
                style={styles.sortBtn}
                leftIcon={<IconSymbol name="arrow.up.arrow.down" size={14} color={palette.tint} />}
              />
            )}
          </View>
        )}

      {!isReadOnlyAssignedPlan && isSortMode && state.kind === 'ready' && (
        <View style={styles.sortModeHeader}>
          <DsPillButton
            scheme={scheme}
            variant="primary"
            size="sm"
            label={t('pro.plan.cta.sort_done')}
            onPress={() => {
              if (isBusy) return;
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setIsSortMode(false);
            }}
            disabled={isBusy}
            fullWidth={true}
          />
        </View>
      )}

      {state.kind === 'ready' && state.plan.meals.length === 0 && (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrapper, { backgroundColor: theme.color.surfaceMuted }]}>
            <IconSymbol name="fork.knife" size={40} color={palette.icon} />
          </View>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            {tr('pro.plan.nutrition.empty.title', 'student.plan.nutrition.empty.title')}
          </Text>
          <Text style={[styles.emptyText, { color: palette.icon }]}>
            {tr('pro.plan.nutrition.empty.body', 'student.plan.nutrition.empty.body')}
          </Text>
        </View>
      )}

      {state.kind === 'ready' && state.plan.meals.length > 0 && (
        <View style={styles.itemsInsetWrapper}>
          {state.plan.meals.map((meal, index) => (
            <MealRow
              key={meal.id}
              meal={meal}
              palette={palette}
              theme={theme}
              isLast={index === state.plan.meals.length - 1}
              onRemove={() => handleRemoveMeal(meal.id)}
              onPress={() => handleNavigateToMeal(meal.id)}
              isSortMode={isSortMode}
              onMoveUp={() => handleMoveMeal(index, 'up')}
              onMoveDown={() => handleMoveMeal(index, 'down')}
              isFirstInList={index === 0}
              isLastInList={index === state.plan.meals.length - 1}
              readOnly={isReadOnlyAssignedPlan}
              testID={`pro.nutrition_plan.mealRow.${toTestIDSegment(meal.name)}`}
            />
          ))}
        </View>
      )}

      {/* ── Request plan change (D-006 assigned-plan read-only surface) ────── */}
      {state.kind === 'ready' && isReadOnlyAssignedPlan && (
        <PlanChangeRequestCard
          scheme={scheme}
          t={t}
          isWriteLocked={false}
          testID="student.nutrition_plan.planChangeForm"
          validate={validateChangeRequest}
          submit={(requestText) => submitChangeRequest(state.plan.id, 'nutrition', requestText)}
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
      )}

      {/* ── Footer Actions Removed ──────────────────────────────────────────── */}

      {(isInitialLoading || isBusy) && (
        <BuilderLoadingScrim
          scheme={scheme}
          theme={theme}
          spinnerColor={palette.tint}
          label={t('a11y.loading.default')}
        />
      )}
    </DsScreen>
  );
}

function MealRow({
  meal,
  palette,
  theme,
  isLast,
  onRemove,
  onPress,
  isSortMode,
  onMoveUp,
  onMoveDown,
  isFirstInList,
  isLastInList,
  readOnly,
  testID,
}: {
  meal: any;
  palette: any;
  theme: any;
  isLast: boolean;
  onRemove: () => void;
  onPress: () => void;
  isSortMode: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirstInList: boolean;
  isLastInList: boolean;
  readOnly?: boolean;
  testID: string;
}) {
  const totals = calculateTotalsFromItems(meal.items);

  return (
    <View
      style={[
        styles.itemRowContainer,
        !isLast && { borderBottomWidth: 1, borderBottomColor: theme.color.border },
      ]}
    >
      <Pressable
        onPress={isSortMode ? undefined : onPress}
        style={({ pressed }) => [
          styles.itemRowPressable,
          pressed && !isSortMode && { backgroundColor: theme.color.surfaceMuted },
        ]}
        testID={testID}
      >
        <View style={styles.itemRowMain}>
          <View style={styles.itemRowInfo}>
            <Text style={[styles.itemName, { color: palette.text }]}>{meal.name}</Text>
            <Text style={[styles.itemDetail, { color: palette.icon }]}>
              {meal.items.length} {meal.items.length === 1 ? 'food' : 'foods'} · {totals.calories}{' '}
              kcal
            </Text>
          </View>

          {isSortMode ? (
            <View style={styles.sortActions}>
              <Pressable
                onPress={onMoveUp}
                disabled={isFirstInList}
                style={{ opacity: isFirstInList ? 0.2 : 1 }}
              >
                <IconSymbol name="chevron.up" size={20} color={palette.icon} />
              </Pressable>
              <Pressable
                onPress={onMoveDown}
                disabled={isLastInList}
                style={{ opacity: isLastInList ? 0.2 : 1 }}
              >
                <IconSymbol name="chevron.down" size={20} color={palette.icon} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.rowRight}>
              <IconSymbol name="chevron.right" size={16} color={palette.icon} />
            </View>
          )}
        </View>
      </Pressable>

      {!isSortMode && !readOnly && (
        <Pressable onPress={onRemove} hitSlop={8} style={styles.removeBtn}>
          <IconSymbol name="minus.circle.fill" size={20} color={palette.danger} />
        </Pressable>
      )}
    </View>
  );
}

function toTestIDSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_');
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: DsSpace.md, gap: DsSpace.md, paddingBottom: 60 },
  centeredContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: DsSpace.xs,
  },
  backButton: { marginBottom: 0 },
  itemsInsetWrapper: {
    borderRadius: DsRadius.lg,
    padding: 0,
    overflow: 'hidden',
    ...DsShadow.soft,
    backgroundColor: 'white',
  }, // Explicit fallback for surface
  supportText: {
    ...DsTypography.micro,
    textTransform: 'none',
    opacity: 0.6,
    marginTop: DsSpace.xxs,
  },
  sectionHeaderRow: {
    marginTop: DsSpace.md,
    marginBottom: DsSpace.xs,
    paddingHorizontal: DsSpace.xs,
  },
  sectionHeader: { ...DsTypography.screenTitle, fontFamily: Fonts?.rounded ?? 'normal' },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: DsSpace.xxl,
    gap: DsSpace.xs,
  },
  emptyIconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: DsSpace.xs,
  },
  emptyTitle: { ...DsTypography.cardTitle, fontWeight: '700' },
  emptyText: { ...DsTypography.body, textAlign: 'center', opacity: 0.7 },
  footerActions: { marginTop: DsSpace.xl, paddingBottom: DsSpace.xl },
  itemRowContainer: { flexDirection: 'row', alignItems: 'center' },
  itemRowPressable: { flex: 1, padding: DsSpace.md },
  itemRowMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemRowInfo: { flex: 1, gap: 2 },
  itemName: { ...DsTypography.body, fontWeight: '700' },
  itemDetail: { ...DsTypography.micro, opacity: 0.8 },
  rowRight: { paddingLeft: DsSpace.sm },
  removeBtn: { padding: DsSpace.md },
  sortActions: { flexDirection: 'row', gap: DsSpace.md, alignItems: 'center' },
  addMealInline: {
    padding: DsSpace.md,
    borderRadius: DsRadius.lg,
    ...DsShadow.soft,
    gap: DsSpace.md,
    marginTop: 0,
    marginBottom: DsSpace.sm,
  },
  addMealInput: {
    ...DsTypography.body,
    paddingVertical: DsSpace.xs,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  addMealActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: DsSpace.md,
  },
  addMealButton: {
    minHeight: 46,
    flex: 1,
    borderWidth: 1.5,
    borderRadius: DsRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
  },
  addMealButtonText: { ...DsTypography.button, fontSize: 15, textAlign: 'center' },
  addMealCancel: {
    ...DsTypography.button,
    opacity: 0.6,
    paddingHorizontal: DsSpace.sm,
    paddingVertical: DsSpace.xs,
  },
  headerActionBtn: { padding: DsSpace.xs, justifyContent: 'center', alignItems: 'center' },
  actionRow: { flexDirection: 'row', gap: DsSpace.sm, alignItems: 'center', marginTop: 0 },
  sortBtn: { flex: 0 },
  sortModeHeader: { marginBottom: DsSpace.sm },
});

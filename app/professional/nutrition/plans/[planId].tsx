/**
 * SC-207 Nutrition Plan Builder
 * Route: /professional/nutrition/plans/:planId
 */
import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { BuilderGuidanceCard } from '@/components/ds/patterns/BuilderGuidanceCard';
import { BuilderAlertBanner } from '@/features/plans/components/BuilderAlertBanner';
import { BuilderBackgroundErrorBanner } from '@/features/plans/components/BuilderBackgroundErrorBanner';
import { BuilderLoadingScrim } from '@/features/plans/components/BuilderLoadingScrim';
import { PlanMetadataForm } from '@/features/plans/components/PlanMetadataForm';

import { DsRadius, DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useNutritionPlanBuilder } from '@/features/plans/use-plan-builder';
import {
  createBuilderPalette,
  createBuilderRoleTranslator,
  enableBuilderLayoutAnimations,
} from '@/features/plans/builder-screen';
import {
  isStarterTemplate,
  calculateTotalsFromItems,
} from '@/features/plans/plan-builder.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import { usePlanForm } from '@/features/plans/use-plan-form';
import { usePersistentGuidance } from '@/hooks/use-persistent-guidance';

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
  const { currentUser } = useAuthSession();
  const isStudentBuilder = pathname.startsWith('/student/');

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
  } = useNutritionPlanBuilder(Boolean(currentUser));

  // ── Form logic ─────────────────────────────────────────────────────────────
  const isNew = planId === 'new';
  const isStarterClone = typeof planId === 'string' && isStarterTemplate(planId);

  const initialValues = useMemo(() => ({
    name: state.kind === 'ready' ? state.plan.name : '',
    hydrationGoalMl: state.kind === 'ready' && state.plan.hydrationGoalMl ? String(state.plan.hydrationGoalMl) : '',
  }), [state]);

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
        return createPlan(formValues);
      }
      return savePlan(planId!, formValues);
    },
    onSuccess: (id) => {
      // After a successful save, we want to go back to the library.
      // We must clear the local dirty state first.
      setIsDirty(false);
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigate to the tab route so the bottom nav bar is visible
      router.replace('/nutrition');
    }
  });

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event: any) => {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      Alert.alert(
        t('pro.plan.discard.title'),
        t('pro.plan.discard.body'),
        [
          { text: t('pro.plan.discard.no'), style: 'cancel' },
          {
            text: t('pro.plan.discard.yes'),
            style: 'destructive',
            onPress: async () => {
              setIsDirty(false);
              navigation.dispatch(event.data.action);
            },
          },
        ]
      );
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
  const [addMealForm, setAddMealForm] = useState<{ kind: 'closed' } | { kind: 'open'; name: string }>({ kind: 'closed' });
  const [isSortMode, setIsSortMode] = useState(false);
  const [showGuidance, hideGuidance] = usePersistentGuidance('guidance.nutrition_builder');
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);
  const [shouldNavigateAfterDelete, setShouldNavigateAfterDelete] = useState(false);
  const isMutating = state.kind === 'ready' && Boolean(state.isMutating);
  const isInitialLoading = state.kind === 'loading';
  const isBusy = isSaving || isMutating || isDeletingPlan;

  // ── Load existing plan ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isNew) {
      initNewPlan();
    } else if (!isStarterClone && planId) {
      loadPlan(planId);
    }
  }, [planId, isNew, isStarterClone, loadPlan, initNewPlan]);

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
      { name: values.name, hydrationGoalMl: values.hydrationGoalMl }
    );
    
    if (error) {
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
    } else {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAddMealForm({ kind: 'closed' });
      setIsDirty(true);

      // If it was a new plan, update the URL to avoid 'new' ID
      if (isNew) {
        router.replace(`${isStudentBuilder ? '/student/nutrition/plans' : '/professional/nutrition/plans'}/${realId}` as any);
      }
    }
  }, [isBusy, addMealForm, state, addMeal, values.name, values.hydrationGoalMl, tr, setIsDirty, isNew, isStudentBuilder, router]);

  const handleRemoveMeal = useCallback(
    (mealId: string) => {
      if (isBusy || state.kind !== 'ready') return;
      
      const meal = state.plan.meals.find(m => m.id === mealId);
      const mealName = meal?.name || t('pro.plan.section.meals');

      Alert.alert(
        t('common.cta.delete') as string,
        (t('pro.plan.delete.body') as string).replace('{name}', mealName),
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
        ]
      );
    },
    [isBusy, state, removeMeal, setIsDirty, t]
  );

  const handleMoveMeal = useCallback(async (index: number, direction: 'up' | 'down') => {
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
    await reorderMeals(state.plan.id, newMeals.map(m => m.id));
  }, [isBusy, state, reorderMeals]);

  const handleFieldChange = useCallback((field: keyof typeof values, v: string) => {
    setFieldValue(field, v);
  }, [setFieldValue]);

  const handleCloseAddMeal = useCallback(() => {
    setAddMealForm({ kind: 'closed' });
  }, []);

  const handleOpenAddMeal = useCallback(() => {
    setAddMealForm({ kind: 'open', name: '' });
  }, []);

  const handleNavigateToMeal = useCallback((mealId: string) => {
    router.push(`${isStudentBuilder ? '/student/nutrition/plans' : '/professional/nutrition/plans'}/${planId}/meals/${mealId}` as any);
  }, [isStudentBuilder, planId, router]);

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
      ]
    );
  }, [isBusy, isNew, planId, deletePlan, t, tr]);

  return (
    <DsScreen
      scheme={scheme}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header Row ──────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <DsBackButton
          scheme={scheme}
          onPress={handleBack}
          accessibilityLabel={t('auth.role.cta_back') as string}
          style={styles.backButton}
        />

        <View style={{ flexDirection: 'row', gap: DsSpace.sm, alignItems: 'center' }}>
          <DsPillButton
            scheme={scheme}
            variant="primary"
            size="sm"
            fullWidth={false}
            label={tr('pro.plan.cta.save', 'student.plan.cta.save')}
            onPress={handleSave}
            disabled={!isDirty || isSaving}
            loading={isSaving}
          />

          {!isNew && (
            <Pressable 
              onPress={handleDeletePlan}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.cta.delete') as string}
              style={styles.headerActionBtn}
            >
              <IconSymbol name="trash" size={20} color={palette.danger} />
            </Pressable>
          )}
        </View>
      </View>

      <BuilderGuidanceCard
        theme={theme}
        visible={showGuidance}
        onDismiss={hideGuidance}
        title={tr('pro.plan.builder.guidance.nutrition.title', 'student.plan.builder.guidance.nutrition.title')}
        description={tr('pro.plan.builder.guidance.nutrition.body', 'student.plan.builder.guidance.nutrition.body')}
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
        autoFocus={!values.name}
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
      {!isSortMode && state.kind === 'ready' && addMealForm.kind === 'open' && (
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
          />
          <View style={styles.addMealActions}>
            <DsPillButton
              scheme={scheme}
              variant="ghost"
              size="sm"
              label={t('common.cta.cancel') as string}
              onPress={handleCloseAddMeal}
              disabled={isBusy}
              fullWidth={false}
            />
            <DsPillButton
              scheme={scheme}
              variant="ghost"
              size="sm"
              label={t('common.cta.add') as string}
              onPress={handleAddMeal}
              disabled={isBusy || !addMealForm.name.trim()}
              fullWidth={false}
            />
          </View>
        </Animated.View>
      )}

      {!isSortMode && state.kind === 'ready' && addMealForm.kind === 'closed' && (
        <View style={styles.actionRow}>
          <DsPillButton
            scheme={scheme}
            variant="outline"
            label={tr('pro.plan.cta.add_meal', 'student.plan.cta.add_meal')}
            onPress={handleOpenAddMeal}
            disabled={isBusy}
            fullWidth={false}
            style={{ flex: 1 }}
            leftIcon={<IconSymbol name="plus.circle.fill" size={20} color={palette.tint} />}
          />

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

      {isSortMode && state.kind === 'ready' && (
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
            />
          ))}
        </View>
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
  isLastInList 
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
}) {
  const totals = calculateTotalsFromItems(meal.items);

  return (
    <View style={[styles.itemRowContainer, !isLast && { borderBottomWidth: 1, borderBottomColor: theme.color.border }]}>
      <Pressable 
        onPress={isSortMode ? undefined : onPress}
        style={({ pressed }) => [styles.itemRowPressable, pressed && !isSortMode && { backgroundColor: theme.color.surfaceMuted }]}
      >
        <View style={styles.itemRowMain}>
          <View style={styles.itemRowInfo}>
            <Text style={[styles.itemName, { color: palette.text }]}>{meal.name}</Text>
            <Text style={[styles.itemDetail, { color: palette.icon }]}>
              {meal.items.length} {meal.items.length === 1 ? 'food' : 'foods'} · {totals.calories} kcal
            </Text>
          </View>
          
          {isSortMode ? (
            <View style={styles.sortActions}>
              <Pressable onPress={onMoveUp} disabled={isFirstInList} style={{ opacity: isFirstInList ? 0.2 : 1 }}>
                <IconSymbol name="chevron.up" size={20} color={palette.icon} />
              </Pressable>
              <Pressable onPress={onMoveDown} disabled={isLastInList} style={{ opacity: isLastInList ? 0.2 : 1 }}>
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

      {!isSortMode && (
        <Pressable 
          onPress={onRemove}
          hitSlop={8}
          style={styles.removeBtn}
        >
          <IconSymbol name="minus.circle.fill" size={20} color={palette.danger} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: DsSpace.md, gap: DsSpace.md, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DsSpace.xs },
  backButton: { marginBottom: 0 },
  itemsInsetWrapper: { borderRadius: DsRadius.lg, padding: 0, overflow: 'hidden', ...DsShadow.soft, backgroundColor: 'white' }, // Explicit fallback for surface
  supportText: { ...DsTypography.micro, textTransform: 'none', opacity: 0.6, marginTop: DsSpace.xxs },
  sectionHeaderRow: { marginTop: DsSpace.md, marginBottom: DsSpace.xs, paddingHorizontal: DsSpace.xs },
  sectionHeader: { ...DsTypography.screenTitle, fontFamily: Fonts?.rounded ?? 'normal' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: DsSpace.xxl, gap: DsSpace.xs },
  emptyIconWrapper: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: DsSpace.xs },
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
  addMealInline: { padding: DsSpace.md, borderRadius: DsRadius.lg, ...DsShadow.soft, gap: DsSpace.md, marginTop: 0, marginBottom: DsSpace.sm },
  addMealInput: { ...DsTypography.body, paddingVertical: DsSpace.xs, borderBottomWidth: 1, borderBottomColor: '#eee' },
  addMealActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: DsSpace.md },
  addMealCancel: { ...DsTypography.button, opacity: 0.6, paddingHorizontal: DsSpace.sm, paddingVertical: DsSpace.xs },
  headerActionBtn: { padding: DsSpace.xs, justifyContent: 'center', alignItems: 'center' },
  actionRow: { flexDirection: 'row', gap: DsSpace.sm, alignItems: 'center', marginTop: 0 },
  sortBtn: { flex: 0 },
  sortModeHeader: { marginBottom: DsSpace.sm },
});

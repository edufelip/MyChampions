/**
 * SC-207 Nutrition Meal Builder
 * Route: /professional/nutrition/plans/:planId/meals/:mealId
 */
import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FoodItemRow } from '@/features/plans/components/FoodItemRow';
import { AddItemForm } from '@/features/plans/components/AddItemForm';
import { BuilderLoadingScrim } from '@/features/plans/components/BuilderLoadingScrim';

import { DsRadius, DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNutritionPlanBuilder, type FoodSearchState, type FoodSearchResult } from '@/features/plans/use-plan-builder';
import {
  createBuilderPalette,
  createBuilderRoleTranslator,
  enableBuilderLayoutAnimations,
} from '@/features/plans/builder-screen';
import { calculateTotalsFromItems, sanitizeNutritionMealItemInput } from '@/features/plans/plan-builder.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

enableBuilderLayoutAnimations();

// ─── Types ────────────────────────────────────────────────────────────────────

type AddItemFormState =
  | { kind: 'closed' }
  | {
      kind: 'open';
      name: string;
      quantity: string;
      notes: string;
      foodQuery: string;
      calories?: string;
      carbs?: string;
      proteins?: string;
      fats?: string;
      selectedFood?: FoodSearchResult;
    };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NutritionMealBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const insets = useSafeAreaInsets();
  
  const palette = useMemo(() => createBuilderPalette(theme), [theme]);

  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { planId, mealId } = useLocalSearchParams<{ planId: string, mealId: string }>();
  const { currentUser } = useAuthSession();
  const isStudentBuilder = pathname.startsWith('/student/');

  const tr = useMemo(() => createBuilderRoleTranslator(isStudentBuilder, t), [isStudentBuilder, t]);

  const {
    state,
    loadPlan,
    addItem,
    removeItem,
    reorderItems,
    searchFoods,
    foodSearchState,
    clearFoodSearch,
  } = useNutritionPlanBuilder(Boolean(currentUser));
  const isMutating = state.kind === 'ready' && Boolean(state.isMutating);
  const isInitialLoading = state.kind === 'loading';
  const isBusy = isMutating;

  // ── Load existing plan ─────────────────────────────────────────────────────
  useEffect(() => {
    if (planId) {
      loadPlan(planId);
    }
  }, [planId, loadPlan]);

  const meal = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return state.plan.meals.find(m => m.id === mealId);
  }, [state, mealId]);

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [addItemForm, setAddItemForm] = useState<AddItemFormState>({ kind: 'closed' });
  const [isSortMode, setIsSortMode] = useState(false);

  // ── Handlers with Animations ───────────────────────────────────────────────
  const handleAddItem = useCallback(async () => {
    if (isBusy || addItemForm.kind !== 'open' || state.kind !== 'ready' || !mealId) return;
    const { name, quantity, notes, calories, carbs, proteins, fats } = addItemForm;
    if (!name.trim()) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const sanitized = sanitizeNutritionMealItemInput({
      name,
      quantity,
      notes,
      calories,
      carbs,
      proteins,
      fats,
    });

    const { error } = await addItem(planId!, mealId, sanitized);
    if (error) {
      Alert.alert(
        tr('pro.plan.error.save', 'student.plan.error.save'),
        `Reason: ${error}`
      );
    } else {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAddItemForm({ kind: 'closed' });
      clearFoodSearch();
    }
  }, [isBusy, addItemForm, state, addItem, planId, mealId, tr, clearFoodSearch]);

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      if (isBusy || state.kind !== 'ready' || !meal || !mealId) return;

      const item = meal.items.find(i => i.id === itemId);
      const itemName = item?.name || t('pro.plan.section.meal_items');

      Alert.alert(
        t('common.cta.delete') as string,
        (t('pro.plan.delete.body') as string).replace('{name}', itemName),
        [
          { text: t('common.cta.cancel'), style: 'cancel' },
          {
            text: t('common.cta.delete'),
            style: 'destructive',
            onPress: () => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              void removeItem(planId!, mealId, itemId);
            },
          },
        ]
      );
    },
    [isBusy, state, removeItem, planId, mealId, meal, t]
  );

  const handleMoveItem = useCallback(async (index: number, direction: 'up' | 'down') => {
    if (isBusy || state.kind !== 'ready' || !meal || !mealId) return;
    const newItems = [...meal.items];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newItems.length) return;

    const [moved] = newItems.splice(index, 1);
    newItems.splice(targetIndex, 0, moved);

    // Immediate visual update with animation
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Call optimistic reorder
    await reorderItems(planId!, mealId, newItems.map(i => i.id));
  }, [isBusy, state, reorderItems, meal, planId, mealId]);

  const handleCloseAddItem = useCallback(() => {
    setAddItemForm({ kind: 'closed' });
  }, []);

  const handleOpenAddItem = useCallback(() => {
    setAddItemForm({ kind: 'open', name: '', quantity: '', notes: '', foodQuery: '' });
  }, []);

  if (!meal && state.kind === 'ready') {
    return (
      <DsScreen scheme={scheme} contentContainerStyle={{ justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
        <Text style={{ color: palette.text }}>Meal not found</Text>
        <DsPillButton scheme={scheme} label="Go Back" onPress={() => router.back()} />
      </DsScreen>
    );
  }

  const totals = meal ? calculateTotalsFromItems(meal.items) : { calories: 0, carbs: 0, proteins: 0, fats: 0 };

  return (
    <DsScreen
      scheme={scheme}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 20, 100) }]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header Row ──────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <DsBackButton
          scheme={scheme}
          onPress={() => router.back()}
          accessibilityLabel={t('auth.role.cta_back') as string}
          style={styles.backButton}
        />
        <View style={{ flexDirection: 'row', gap: DsSpace.sm }}>
          {meal && meal.items.length > 1 && (
            <DsPillButton
              scheme={scheme}
              variant="secondary"
              size="sm"
              label={isSortMode ? t('pro.plan.cta.sort_done') : t('pro.plan.cta.sort')}
              contentColor={theme.color.accentPrimary}
              onPress={() => {
                if (isBusy) return;
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsSortMode(!isSortMode);
              }}
              disabled={isBusy}
              fullWidth={false}
              style={styles.templateCta}
              leftIcon={<IconSymbol name={isSortMode ? "checkmark.circle.fill" : "arrow.up.arrow.down"} size={14} color={theme.color.accentPrimary} />}
            />
          )}
        </View>
      </View>

      {/* ── Meal Title & Totals ─────────────────────────────────────────── */}
      <View style={styles.titleSection}>
        <Text style={[styles.screenTitle, { color: palette.text }]}>{meal?.name}</Text>
        <View style={styles.totalsRow}>
          <TotalChip label={t('common.nutrition.calories')} value={`${totals.calories} kcal`} palette={palette} />
          <TotalChip label={t('common.nutrition.carbs')} value={`${totals.carbs}g`} palette={palette} />
          <TotalChip label={t('common.nutrition.proteins')} value={`${totals.proteins}g`} palette={palette} />
          <TotalChip label={t('common.nutrition.fats')} value={`${totals.fats}g`} palette={palette} />
        </View>
      </View>

      {/* ── Food items list ───────────────────────────────────────────────── */}
      <View style={[styles.sectionHeaderRow, { zIndex: 10 }]}>
        <Text style={[styles.sectionHeader, { color: palette.text }]}>
          {tr('pro.plan.section.meal_items', 'student.plan.section.meal_items')}
        </Text>

        {/* ── Add item form (Floating Overlay inside header bounds) ───────── */}
        {!isSortMode && meal && addItemForm.kind === 'open' && (
          <AddItemForm
            palette={palette}
            theme={theme}
            t={t}
            tr={tr}
            name={addItemForm.name}
            quantity={addItemForm.quantity}
            notes={addItemForm.notes}
            carbs={addItemForm.carbs}
            proteins={addItemForm.proteins}
            fats={addItemForm.fats}
            foodQuery={addItemForm.foodQuery}
            foodSearchState={foodSearchState}
            selectedFood={addItemForm.selectedFood}
            isInteractionLocked={isBusy}
            onNameChange={(v) =>
              setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, name: v } : prev))
            }
            onQuantityChange={(v) => {
              setAddItemForm((prev) => {
                if (prev.kind !== 'open') return prev;
                
                // If we have a selected food, calculate macros
                if (prev.selectedFood) {
                  const qty = parseFloat(v);
                  if (!isNaN(qty) && qty > 0) {
                    const ratio = qty / 100;
                    return {
                      ...prev,
                      quantity: v,
                      calories: Number((prev.selectedFood.caloriesPer100g * ratio).toFixed(2)).toString(),
                      carbs: Number((prev.selectedFood.carbsPer100g * ratio).toFixed(2)).toString(),
                      proteins: Number((prev.selectedFood.proteinsPer100g * ratio).toFixed(2)).toString(),
                      fats: Number((prev.selectedFood.fatsPer100g * ratio).toFixed(2)).toString(),
                    };
                  }
                }
                
                return { ...prev, quantity: v };
              });
            }}
            onNotesChange={(v) =>
              setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, notes: v } : prev))
            }
            onCarbsChange={(v) =>
              setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, carbs: v } : prev))
            }
            onProteinsChange={(v) =>
              setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, proteins: v } : prev))
            }
            onFatsChange={(v) =>
              setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, fats: v } : prev))
            }
            onQueryChange={(v) =>
              setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, foodQuery: v } : prev))
            }
            onSearch={() => addItemForm.kind === 'open' && searchFoods(addItemForm.foodQuery)}
            onClearFood={() => 
              setAddItemForm((prev) => 
                prev.kind === 'open' ? { 
                  ...prev, 
                  selectedFood: undefined, 
                  foodQuery: '',
                  name: '',
                  quantity: '',
                  // Keep notes as user might have typed them before selecting a food
                  calories: undefined,
                  carbs: undefined,
                  proteins: undefined,
                  fats: undefined
                } : prev
              )
            }
            onSelectFood={(food) =>
              setAddItemForm((prev) =>
                prev.kind === 'open'
                  ? {
                      ...prev,
                      selectedFood: food,
                      name: food.name,
                      calories: food.caloriesPer100g.toString(),
                      carbs: food.carbsPer100g.toString(),
                      proteins: food.proteinsPer100g.toString(),
                      fats: food.fatsPer100g.toString(),
                      quantity: '100',
                    }
                  : prev
              )
            }
            onAdd={handleAddItem}
            onClose={handleCloseAddItem}
            style={{ top: '100%', left: 0, right: 0, marginTop: 16 }}
          />
        )}
      </View>

      {meal && meal.items.length === 0 && (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrapper, { backgroundColor: theme.color.surfaceMuted }]}>
            <IconSymbol name="fork.knife" size={40} color={palette.icon} />
          </View>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            No foods added yet
          </Text>
          <Text style={[styles.emptyText, { color: palette.icon }]}>
            Search and add foods to this meal to build your plan.
          </Text>
        </View>
      )}

      {meal && meal.items.length > 0 && (
        <View style={styles.itemsInsetWrapper}>
          {meal.items.map((item, index) => (
            <FoodItemRow
              key={item.id}
              name={item.name}
              quantity={item.quantity}
              notes={item.notes}
              calories={item.calories}
              carbs={item.carbs}
              proteins={item.proteins}
              fats={item.fats}
              palette={palette}
              theme={theme}
              t={t}
              isLast={index === meal.items.length - 1}
              onRemove={() => handleRemoveItem(item.id)}
              isSortMode={isSortMode}
              onMoveUp={() => handleMoveItem(index, 'up')}
              onMoveDown={() => handleMoveItem(index, 'down')}
              isFirstInList={index === 0}
              isLastInList={index === meal.items.length - 1}
              isInteractionLocked={isBusy}
            />
          ))}
        </View>
      )}

      {/* ── Add item trigger button (at bottom) ───────────────────────────── */}
      {!isSortMode && meal && addItemForm.kind === 'closed' && (
        <Pressable
          style={[styles.addSessionBtn, { backgroundColor: theme.color.surface }]}
          onPress={isBusy ? undefined : handleOpenAddItem}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel={t('pro.plan.cta.add_food')}
        >
          <IconSymbol name="plus.circle.fill" size={20} color={palette.tint} />
          <Text style={[styles.addSessionBtnText, { color: palette.tint }]}>
            {t('pro.plan.cta.add_food')}
          </Text>
        </Pressable>
      )}

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

function TotalChip({ label, value, palette }: { label: string, value: string, palette: any }) {
  return (
    <View style={styles.totalChip}>
      <Text style={[styles.totalLabel, { color: palette.icon }]}>{label}</Text>
      <Text style={[styles.totalValue, { color: palette.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: DsSpace.md, gap: DsSpace.md, paddingBottom: 100 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DsSpace.xs },
  backButton: { marginBottom: 0 },
  titleSection: { gap: DsSpace.xs, paddingHorizontal: DsSpace.xs, marginBottom: DsSpace.sm },
  screenTitle: { ...DsTypography.screenTitle, fontFamily: Fonts?.rounded ?? 'normal' },
  totalsRow: { flexDirection: 'row', gap: DsSpace.sm, flexWrap: 'wrap' },
  totalChip: { gap: 2 },
  totalLabel: { ...DsTypography.micro, opacity: 0.6 },
  totalValue: { ...DsTypography.caption, fontWeight: '700' },
  itemsInsetWrapper: { borderRadius: DsRadius.lg, padding: 0, overflow: 'hidden', ...DsShadow.soft, backgroundColor: 'white' },
  sectionHeaderRow: { marginBottom: DsSpace.xs, paddingHorizontal: DsSpace.xs },
  sectionHeader: { ...DsTypography.cardTitle, fontFamily: Fonts?.rounded ?? 'normal' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: DsSpace.xxl, gap: DsSpace.xs },
  emptyIconWrapper: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: DsSpace.xs },
  emptyTitle: { ...DsTypography.cardTitle, fontWeight: '700' },
  emptyText: { ...DsTypography.body, textAlign: 'center', opacity: 0.7 },
  addSessionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: DsSpace.xs, padding: DsSpace.md, borderRadius: DsRadius.lg, ...DsShadow.soft, marginTop: DsSpace.sm },
  addSessionBtnText: { ...DsTypography.button },
  templateCta: { paddingHorizontal: DsSpace.sm },
});

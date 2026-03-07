/**
 * SC-207 Nutrition Meal Builder
 * Route: /professional/nutrition/plans/:planId/meals/:mealId
 */
import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
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

import { DsRadius, DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useNutritionPlanBuilder } from '@/features/plans/use-plan-builder';
import { calculateTotalsFromItems } from '@/features/plans/plan-builder.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AddItemFormState =
  | { kind: 'closed' }
  | {
      kind: 'open';
      name: string;
      quantity: string;
      notes: string;
      foodQuery: string;
      calories?: number;
      carbs?: number;
      proteins?: number;
      fats?: number;
    };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NutritionMealBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  
  const palette = useMemo(() => ({
    background: theme.color.canvas,
    text: theme.color.textPrimary,
    tint: theme.color.accentPrimary,
    icon: theme.color.textSecondary,
    danger: theme.color.danger,
  }), [theme]);

  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { planId, mealId } = useLocalSearchParams<{ planId: string, mealId: string }>();
  const { currentUser } = useAuthSession();
  const isStudentBuilder = pathname.startsWith('/student/');

  const tr = useCallback(
    (proKey: string, studentKey: string) =>
      t((isStudentBuilder ? studentKey : proKey) as any),
    [isStudentBuilder, t]
  );

  const {
    state,
    loadPlan,
    addItem,
    removeItem,
    reorderItems,
    searchFoods,
    foodSearchState,
  } = useNutritionPlanBuilder(Boolean(currentUser));

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
    if (addItemForm.kind !== 'open' || state.kind !== 'ready' || !mealId) return;
    const { name: itemName, quantity, notes, calories, carbs, proteins, fats } = addItemForm;
    if (!itemName.trim()) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const { error } = await addItem(planId!, mealId, {
      name: itemName,
      quantity,
      notes,
      calories,
      carbs,
      proteins,
      fats,
    });
    if (error) {
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
    } else {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAddItemForm({ kind: 'closed' });
    }
  }, [addItemForm, state, addItem, planId, mealId, tr]);

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      if (state.kind !== 'ready' || !meal || !mealId) return;

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
    [state, removeItem, planId, mealId, meal, t]
  );

  const handleMoveItem = useCallback(async (index: number, direction: 'up' | 'down') => {
    if (state.kind !== 'ready' || !meal || !mealId) return;
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
  }, [state, reorderItems, meal, planId, mealId]);

  const handleCloseAddItem = useCallback(() => {
    setAddItemForm({ kind: 'closed' });
  }, []);

  const handleOpenAddItem = useCallback(() => {
    setAddItemForm({ kind: 'open', name: '', quantity: '', notes: '', foodQuery: '' });
  }, []);

  if (!meal && state.kind === 'ready') {
    return (
      <DsScreen scheme={scheme} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: palette.text }}>Meal not found</Text>
        <DsPillButton scheme={scheme} label="Go Back" onPress={() => router.back()} />
      </DsScreen>
    );
  }

  const totals = meal ? calculateTotalsFromItems(meal.items) : { calories: 0, carbs: 0, proteins: 0, fats: 0 };

  return (
    <DsScreen
      scheme={scheme}
      headerShown={false}
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
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
              variant="ghost"
              size="sm"
              label={isSortMode ? t('pro.plan.cta.sort_done') : t('pro.plan.cta.sort')}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsSortMode(!isSortMode);
              }}
              fullWidth={false}
              leftIcon={<IconSymbol name={isSortMode ? "checkmark.circle.fill" : "arrow.up.arrow.down"} size={14} color={palette.tint} />}
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

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {state.kind === 'loading' && (
        <ActivityIndicator
          style={styles.loader}
          accessibilityLabel={t('a11y.loading.default')}
        />
      )}

      {/* ── Food items list ───────────────────────────────────────────────── */}
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionHeader, { color: palette.text }]}>
          {tr('pro.plan.section.meal_items', 'student.plan.section.meal_items')}
        </Text>
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
              palette={palette}
              theme={theme}
              isLast={index === meal.items.length - 1}
              onRemove={() => handleRemoveItem(item.id)}
              isSortMode={isSortMode}
              onMoveUp={() => handleMoveItem(index, 'up')}
              onMoveDown={() => handleMoveItem(index, 'down')}
              isFirstInList={index === 0}
              isLastInList={index === meal.items.length - 1}
            />
          ))}
        </View>
      )}

      {/* ── Add item form ─────────────────────────────────────────────────── */}
      {!isSortMode && meal && addItemForm.kind === 'open' && (
        <AddItemForm
          palette={palette}
          theme={theme}
          t={t}
          tr={tr}
          name={addItemForm.name}
          quantity={addItemForm.quantity}
          notes={addItemForm.notes}
          foodQuery={addItemForm.foodQuery}
          foodSearchState={foodSearchState}
          onNameChange={(v) =>
            setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, name: v } : prev))
          }
          onQuantityChange={(v) =>
            setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, quantity: v } : prev))
          }
          onNotesChange={(v) =>
            setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, notes: v } : prev))
          }
          onQueryChange={(v) =>
            setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, foodQuery: v } : prev))
          }
          onSearch={() => addItemForm.kind === 'open' && searchFoods(addItemForm.foodQuery)}
          onSelectFood={(food) =>
            setAddItemForm((prev) =>
              prev.kind === 'open'
                ? {
                    ...prev,
                    name: food.name,
                    calories: food.caloriesPer100g,
                    carbs: food.carbsPer100g,
                    proteins: food.proteinsPer100g,
                    fats: food.fatsPer100g,
                    quantity: '100g',
                  }
                : prev
            )
          }
          onAdd={handleAddItem}
          onClose={handleCloseAddItem}
        />
      )}

      {!isSortMode && meal && addItemForm.kind === 'closed' && (
        <Pressable
          style={[styles.addSessionBtn, { backgroundColor: theme.color.surface }]}
          onPress={handleOpenAddItem}
          accessibilityRole="button"
          accessibilityLabel={t('pro.plan.cta.add_food')}
        >
          <IconSymbol name="plus.circle.fill" size={20} color={palette.tint} />
          <Text style={[styles.addSessionBtnText, { color: palette.tint }]}>
            {t('pro.plan.cta.add_food')}
          </Text>
        </Pressable>
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
  content: { padding: DsSpace.md, gap: DsSpace.md, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DsSpace.xs },
  backButton: { marginBottom: 0 },
  loader: { marginVertical: DsSpace.xl },
  titleSection: { gap: DsSpace.xs, paddingHorizontal: DsSpace.xs, marginBottom: DsSpace.sm },
  screenTitle: { ...DsTypography.screenTitle, fontFamily: Fonts?.rounded ?? 'normal' },
  totalsRow: { flexDirection: 'row', gap: DsSpace.sm, flexWrap: 'wrap' },
  totalChip: { gap: 2 },
  totalLabel: { ...DsTypography.micro, opacity: 0.6 },
  totalValue: { ...DsTypography.caption, fontWeight: '700' },
  itemsInsetWrapper: { borderRadius: DsRadius.lg, padding: 0, overflow: 'hidden', ...DsShadow.soft, backgroundColor: 'white' },
  sectionHeaderRow: { marginTop: DsSpace.md, marginBottom: DsSpace.xs, paddingHorizontal: DsSpace.xs },
  sectionHeader: { ...DsTypography.cardTitle, fontFamily: Fonts?.rounded ?? 'normal' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: DsSpace.xxl, gap: DsSpace.xs },
  emptyIconWrapper: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: DsSpace.xs },
  emptyTitle: { ...DsTypography.cardTitle, fontWeight: '700' },
  emptyText: { ...DsTypography.body, textAlign: 'center', opacity: 0.7 },
  addSessionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: DsSpace.xs, padding: DsSpace.md, borderRadius: DsRadius.lg, ...DsShadow.soft, marginTop: DsSpace.sm },
  addSessionBtnText: { ...DsTypography.button },
});

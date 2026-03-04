/**
 * SC-207 Nutrition Plan Builder
 * Route: /professional/nutrition/plans/:planId
 *
 * Allows nutritionists to create and edit named predefined nutrition plans with
 * calorie/macro targets and food item lists.
 *
 * Food search (fatsecret) is stubbed — returns empty and shows a stub notice.
 * Starter template cloning and Data Connect plan CRUD are stubbed; wiring deferred.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-207-nutrition-plan-builder.md
 * Refs: D-111–D-114, FR-240–FR-243, FR-247–FR-248,
 *       BR-281, BR-291–BR-292, BR-295–BR-296,
 *       AC-207, AC-256, AC-264, AC-265,
 *       TC-275–TC-277, TC-280
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useNutritionPlanBuilder } from '@/features/plans/use-plan-builder';
import {
  validateNutritionPlanInput,
  isStarterTemplate,
} from '@/features/plans/plan-builder.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type TFn = ReturnType<typeof useTranslation>['t'];
type Palette = {
  background: string;
  text: string;
  tint: string;
  icon: string;
};

type AddItemFormState =
  | { kind: 'closed' }
  | { kind: 'open'; name: string; quantity: string; notes: string };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NutritionPlanBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const palette = {
    background: theme.color.canvas,
    text: theme.color.textPrimary,
    tint: theme.color.accentPrimary,
    icon: theme.color.textSecondary,
  };
  const { t } = useTranslation();
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { currentUser } = useAuthSession();

  const {
    state,
    foodSearchState,
    loadPlan,
    createPlan,
    savePlan,
    addItem,
    removeItem,
    searchFoods,
    validateInput,
  } = useNutritionPlanBuilder(Boolean(currentUser));

  // ── Local form state ───────────────────────────────────────────────────────
  const isNew = planId === 'new';
  const isStarterClone = typeof planId === 'string' && isStarterTemplate(planId);

  const [name, setName] = useState('');
  const [caloriesTarget, setCaloriesTarget] = useState('');
  const [carbsTarget, setCarbsTarget] = useState('');
  const [proteinsTarget, setProteinsTarget] = useState('');
  const [fatsTarget, setFatsTarget] = useState('');
  const [addItemForm, setAddItemForm] = useState<AddItemFormState>({ kind: 'closed' });
  const [foodQuery, setFoodQuery] = useState('');
  const [formErrors, setFormErrors] = useState<ReturnType<typeof validateNutritionPlanInput>>({});
  const [isSaving, setIsSaving] = useState(false);

  // ── Load existing plan ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isNew && !isStarterClone && planId) {
      loadPlan(planId);
    }
  }, [planId, isNew, isStarterClone, loadPlan]);

  // ── Populate form from loaded plan ─────────────────────────────────────────
  useEffect(() => {
    if (state.kind === 'ready') {
      setName(state.plan.name);
      setCaloriesTarget(state.plan.caloriesTarget > 0 ? String(state.plan.caloriesTarget) : '');
      setCarbsTarget(state.plan.carbsTarget > 0 ? String(state.plan.carbsTarget) : '');
      setProteinsTarget(state.plan.proteinsTarget > 0 ? String(state.plan.proteinsTarget) : '');
      setFatsTarget(state.plan.fatsTarget > 0 ? String(state.plan.fatsTarget) : '');
    }
  }, [state]);

  // ── Save / Create ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const input = { name, caloriesTarget, carbsTarget, proteinsTarget, fatsTarget };
    const errors = validateInput(input);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setIsSaving(true);

    if (isNew || isStarterClone) {
      const result = await createPlan(input);
      setIsSaving(false);
      if ('error' in result) {
        Alert.alert(t('pro.plan.error.save'));
      } else {
        router.replace(`/professional/nutrition/plans/${result.id}`);
      }
    } else {
      const err = await savePlan(planId!, input);
      setIsSaving(false);
      if (err) Alert.alert(t('pro.plan.error.save'));
    }
  }, [name, caloriesTarget, carbsTarget, proteinsTarget, fatsTarget, validateInput, isNew, isStarterClone, createPlan, savePlan, planId, router, t]);

  // ── Add item ───────────────────────────────────────────────────────────────
  const handleAddItem = useCallback(async () => {
    if (addItemForm.kind !== 'open' || state.kind !== 'ready') return;
    const { name: itemName, quantity, notes } = addItemForm;
    if (!itemName.trim()) return;

    const currentPlanId = state.plan.id;
    const err = await addItem(currentPlanId, { name: itemName, quantity, notes });
    if (err) {
      Alert.alert(t('pro.plan.error.save'));
    } else {
      setAddItemForm({ kind: 'closed' });
    }
  }, [addItemForm, state, addItem, t]);

  // ── Remove item ────────────────────────────────────────────────────────────
  const handleRemoveItem = useCallback(
    (itemId: string) => {
      if (state.kind !== 'ready') return;
      void removeItem(state.plan.id, itemId);
    },
    [state, removeItem]
  );

  // ── Food search ────────────────────────────────────────────────────────────
  const handleFoodSearch = useCallback(() => {
    searchFoods(foodQuery);
  }, [foodQuery, searchFoods]);

  const screenTitle = isNew || isStarterClone
    ? t('pro.plan.nutrition.title.create')
    : t('pro.plan.nutrition.title.edit');

  return (
    <DsScreen
      scheme={scheme}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: screenTitle, headerShown: true }} />

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {state.kind === 'error' && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.errorBanner, { backgroundColor: palette.icon }]}
        >
          <Text style={[styles.errorBannerText, { color: palette.background }]}>
            {t('pro.plan.error.load')}
          </Text>
        </View>
      )}

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {state.kind === 'loading' && (
        <ActivityIndicator
          style={styles.loader}
          accessibilityLabel={t('a11y.loading.default')}
        />
      )}

      {/* ── Plan metadata form ────────────────────────────────────────────── */}
      <PlanMetadataForm
        palette={palette}
        t={t}
        name={name}
        caloriesTarget={caloriesTarget}
        carbsTarget={carbsTarget}
        proteinsTarget={proteinsTarget}
        fatsTarget={fatsTarget}
        errors={formErrors}
        onNameChange={setName}
        onCaloriesChange={setCaloriesTarget}
        onCarbsChange={setCarbsTarget}
        onProteinsChange={setProteinsTarget}
        onFatsChange={setFatsTarget}
      />

      {/* ── Food items list ───────────────────────────────────────────────── */}
      <Text style={[styles.sectionHeader, { color: palette.text }]}>
        {t('pro.plan.section.meals')}
      </Text>

      {state.kind === 'ready' && state.plan.items.length === 0 && (
        <Text style={[styles.emptyText, { color: palette.icon }]}>
          {t('pro.plan.food_search.stub_notice')}
        </Text>
      )}

      {state.kind === 'ready' &&
        state.plan.items.map((item) => (
          <FoodItemRow
            key={item.id}
            name={item.name}
            quantity={item.quantity}
            notes={item.notes}
            palette={palette}
            onRemove={() => handleRemoveItem(item.id)}
            t={t}
          />
        ))}

      {/* ── Add item form ─────────────────────────────────────────────────── */}
      {state.kind === 'ready' && addItemForm.kind === 'open' && (
        <AddItemForm
          palette={palette}
          t={t}
          name={addItemForm.name}
          quantity={addItemForm.quantity}
          notes={addItemForm.notes}
          onNameChange={(v) =>
            setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, name: v } : prev))
          }
          onQuantityChange={(v) =>
            setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, quantity: v } : prev))
          }
          onNotesChange={(v) =>
            setAddItemForm((prev) => (prev.kind === 'open' ? { ...prev, notes: v } : prev))
          }
          onConfirm={handleAddItem}
          onCancel={() => setAddItemForm({ kind: 'closed' })}
        />
      )}

      {state.kind === 'ready' && addItemForm.kind === 'closed' && (
        <Pressable
          style={[styles.secondaryBtn, { borderColor: palette.tint }]}
          onPress={() => setAddItemForm({ kind: 'open', name: '', quantity: '', notes: '' })}
          accessibilityRole="button"
          accessibilityLabel={t('pro.plan.cta.add_meal')}
        >
          <Text style={[styles.secondaryBtnText, { color: palette.tint }]}>
            {t('pro.plan.cta.add_meal')}
          </Text>
        </Pressable>
      )}

      {/* ── Food search (stub) ────────────────────────────────────────────── */}
      {state.kind === 'ready' && (
        <View style={styles.foodSearchRow}>
          <TextInput
            style={[styles.foodSearchInput, { color: palette.text, borderColor: palette.icon }]}
            placeholder={t('pro.plan.food_search.placeholder')}
            placeholderTextColor={palette.icon}
            value={foodQuery}
            onChangeText={setFoodQuery}
            onSubmitEditing={handleFoodSearch}
            returnKeyType="search"
            accessibilityLabel={t('pro.plan.food_search.placeholder')}
          />
        </View>
      )}

      {foodSearchState.kind === 'done' && foodSearchState.results.length === 0 && foodQuery.trim() !== '' && (
        <Text style={[styles.emptyText, { color: palette.icon }]}>
          {t('pro.plan.food_search.empty')}
        </Text>
      )}

      {/* ── Save CTA ──────────────────────────────────────────────────────── */}
      <Pressable
        style={[styles.primaryBtn, { backgroundColor: palette.tint }, isSaving && styles.btnDisabled]}
        onPress={handleSave}
        disabled={isSaving}
        accessibilityRole="button"
        accessibilityLabel={t('pro.plan.cta.save')}
        accessibilityState={{ disabled: isSaving, busy: isSaving }}
      >
        {isSaving ? (
          <ActivityIndicator color={palette.background} accessibilityLabel={t('a11y.loading.saving')} />
        ) : (
          <Text style={[styles.primaryBtnText, { color: palette.background }]}>
            {t('pro.plan.cta.save')}
          </Text>
        )}
      </Pressable>
    </DsScreen>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type PlanMetadataFormProps = {
  palette: Palette;
  t: TFn;
  name: string;
  caloriesTarget: string;
  carbsTarget: string;
  proteinsTarget: string;
  fatsTarget: string;
  errors: ReturnType<typeof validateNutritionPlanInput>;
  onNameChange: (v: string) => void;
  onCaloriesChange: (v: string) => void;
  onCarbsChange: (v: string) => void;
  onProteinsChange: (v: string) => void;
  onFatsChange: (v: string) => void;
};

function PlanMetadataForm({
  palette,
  t,
  name,
  caloriesTarget,
  carbsTarget,
  proteinsTarget,
  fatsTarget,
  errors,
  onNameChange,
  onCaloriesChange,
  onCarbsChange,
  onProteinsChange,
  onFatsChange,
}: PlanMetadataFormProps) {
  return (
    <View style={styles.formSection}>
      {/* Name */}
      <Text style={[styles.fieldLabel, { color: palette.text }]}>
        {t('pro.plan.field.name.label')}
      </Text>
      <TextInput
        style={[styles.textInput, { color: palette.text, borderColor: errors.name ? '#c00' : palette.icon }]}
        placeholder={t('pro.plan.field.name.placeholder')}
        placeholderTextColor={palette.icon}
        value={name}
        onChangeText={onNameChange}
        accessibilityLabel={t('pro.plan.field.name.label')}
      />
      {errors.name && (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.fieldError}>
            {errors.name === 'required'
              ? t('pro.plan.validation.name_required')
              : t('pro.plan.validation.name_too_short')}
          </Text>
        </View>
      )}

      {/* Calorie target */}
      <Text style={[styles.fieldLabel, { color: palette.text }]}>
        {t('pro.plan.field.calories_target.label')}
      </Text>
      <TextInput
        style={[styles.textInput, { color: palette.text, borderColor: errors.caloriesTarget ? '#c00' : palette.icon }]}
        placeholder={t('pro.plan.field.calories_target.placeholder')}
        placeholderTextColor={palette.icon}
        value={caloriesTarget}
        onChangeText={onCaloriesChange}
        keyboardType="decimal-pad"
        accessibilityLabel={t('pro.plan.field.calories_target.label')}
      />
      {errors.caloriesTarget && (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.fieldError}>{t('pro.plan.validation.calories_non_negative')}</Text>
        </View>
      )}

      {/* Macro targets row */}
      <View style={styles.macroRow}>
        <MacroField
          label={t('pro.plan.field.carbs_target.label')}
          value={carbsTarget}
          hasError={!!errors.carbsTarget}
          palette={palette}
          onChange={onCarbsChange}
        />
        <MacroField
          label={t('pro.plan.field.proteins_target.label')}
          value={proteinsTarget}
          hasError={!!errors.proteinsTarget}
          palette={palette}
          onChange={onProteinsChange}
        />
        <MacroField
          label={t('pro.plan.field.fats_target.label')}
          value={fatsTarget}
          hasError={!!errors.fatsTarget}
          palette={palette}
          onChange={onFatsChange}
        />
      </View>
      {(errors.carbsTarget || errors.proteinsTarget || errors.fatsTarget) && (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.fieldError}>{t('pro.plan.validation.macros_non_negative')}</Text>
        </View>
      )}
    </View>
  );
}

type MacroFieldProps = {
  label: string;
  value: string;
  hasError: boolean;
  palette: Palette;
  onChange: (v: string) => void;
};

function MacroField({ label, value, hasError, palette, onChange }: MacroFieldProps) {
  return (
    <View style={styles.macroField}>
      <Text style={[styles.macroLabel, { color: palette.icon }]} numberOfLines={2}>
        {label}
      </Text>
      <TextInput
        style={[
          styles.macroInput,
          { color: palette.text, borderColor: hasError ? '#c00' : palette.icon },
        ]}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={palette.icon}
        accessibilityLabel={label}
      />
    </View>
  );
}

type FoodItemRowProps = {
  name: string;
  quantity: string;
  notes: string;
  palette: Palette;
  t: TFn;
  onRemove: () => void;
};

function FoodItemRow({ name, quantity, notes, palette, t, onRemove }: FoodItemRowProps) {
  return (
    <View style={[styles.itemRow, { borderColor: palette.icon }]}>
      <View style={styles.itemInfo}>
        <Text style={[styles.itemName, { color: palette.text }]}>{name}</Text>
        {quantity ? (
          <Text style={[styles.itemMeta, { color: palette.icon }]}>{quantity}</Text>
        ) : null}
        {notes ? (
          <Text style={[styles.itemMeta, { color: palette.icon }]}>{notes}</Text>
        ) : null}
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
        hitSlop={8}
      >
        <Text style={[styles.removeBtn, { color: palette.tint }]}>✕</Text>
      </Pressable>
    </View>
  );
}

type AddItemFormProps = {
  palette: Palette;
  t: TFn;
  name: string;
  quantity: string;
  notes: string;
  onNameChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function AddItemForm({
  palette,
  t,
  name,
  quantity,
  notes,
  onNameChange,
  onQuantityChange,
  onNotesChange,
  onConfirm,
  onCancel,
}: AddItemFormProps) {
  return (
    <View style={[styles.addItemCard, { borderColor: palette.icon }]}>
      <TextInput
        style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
        placeholder={t('pro.plan.item.field.name.placeholder')}
        placeholderTextColor={palette.icon}
        value={name}
        onChangeText={onNameChange}
        accessibilityLabel={t('pro.plan.item.field.name.label')}
      />
      <TextInput
        style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
        placeholder={t('pro.plan.item.field.quantity.placeholder')}
        placeholderTextColor={palette.icon}
        value={quantity}
        onChangeText={onQuantityChange}
        accessibilityLabel={t('pro.plan.item.field.quantity.label')}
      />
      <TextInput
        style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
        placeholder={t('pro.plan.item.field.notes.label')}
        placeholderTextColor={palette.icon}
        value={notes}
        onChangeText={onNotesChange}
        accessibilityLabel={t('pro.plan.item.field.notes.label')}
      />
      <View style={styles.addItemActions}>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: palette.tint, flex: 1 }]}
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel={t('pro.plan.cta.add_meal')}
        >
          <Text style={[styles.primaryBtnText, { color: palette.background }]}>
            {t('pro.plan.cta.add_meal')}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryBtn, { borderColor: palette.icon, flex: 1 }]}
          onPress={onCancel}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryBtnText, { color: palette.icon }]}>
            {t('meal.library.quick_log.cta_cancel')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  loader: { marginVertical: 24 },
  errorBanner: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  errorBannerText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  formSection: { gap: 8 },
  sectionHeader: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 4,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  fieldError: { color: '#c00', fontSize: 12, marginTop: 2 },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
  },
  macroRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  macroField: { flex: 1 },
  macroLabel: { fontSize: 12, marginBottom: 4 },
  macroInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  emptyText: { fontSize: 14, textAlign: 'center', marginVertical: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemMeta: { fontSize: 12 },
  removeBtn: { fontSize: 16, fontWeight: '700', paddingHorizontal: 4 },
  addItemCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  addItemActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  foodSearchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  foodSearchInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  primaryBtn: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
});

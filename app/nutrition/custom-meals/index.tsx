/**
 * SC-215 Custom Meal Library & Quick Log
 * Route: /nutrition/custom-meals
 *
 * Browse saved custom meals and quickly log consumed grams with proportional
 * nutrition calculation shown before confirmation.
 *
 * Data Connect meal source wiring is deferred — list populated from
 * useCustomMeals hook (stub returns empty until endpoint is live).
 * Portion log persistence is also deferred.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-215-custom-meal-library-and-quick-log.md
 * Refs: D-017, D-021, D-023, FR-139–144, FR-147, FR-150
 *       BR-304–310, BR-313, BR-316
 *       UC-003.2, UC-003.3, UC-003.4, UC-003.6
 *       AC-403–408, AC-411, AC-413
 *       TC-404–409, TC-412, TC-414, TC-415
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useCustomMeals } from '@/features/nutrition/use-custom-meals';
import {
  validatePortionLogInput,
  calculatePortionNutrition,
  type CustomMeal,
} from '@/features/nutrition/custom-meal.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

type QuickLogPanelState =
  | { kind: 'closed' }
  | { kind: 'open'; meal: CustomMeal; grams: string; error: string | null };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CustomMealLibraryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { state, shareLink, remove } = useCustomMeals(currentUser);

  const [quickLog, setQuickLog] = useState<QuickLogPanelState>({ kind: 'closed' });
  const [isLoggingMeal, setIsLoggingMeal] = useState(false);

  // ── Quick log handlers ─────────────────────────────────────────────────────

  function openQuickLog(meal: CustomMeal) {
    setQuickLog({ kind: 'open', meal, grams: '', error: null });
  }

  function closeQuickLog() {
    setQuickLog({ kind: 'closed' });
  }

  function handleGramsChange(value: string) {
    if (quickLog.kind !== 'open') return;
    setQuickLog({ ...quickLog, grams: value, error: null });
  }

  async function handleConfirmLog() {
    if (quickLog.kind !== 'open') return;

    const validationErrors = validatePortionLogInput({ consumedGrams: quickLog.grams });
    if (validationErrors.consumedGrams) {
      const errorKey =
        validationErrors.consumedGrams === 'required'
          ? 'meal.library.quick_log.validation.required'
          : 'meal.library.quick_log.validation.positive';
      setQuickLog({ ...quickLog, error: t(errorKey) as string });
      return;
    }

    setIsLoggingMeal(true);
    // Portion log persistence deferred (pending-wiring-checklist-v1.md)
    await Promise.resolve(); // stub
    setIsLoggingMeal(false);
    closeQuickLog();
  }

  // ── Share handler ──────────────────────────────────────────────────────────

  async function handleShare(meal: CustomMeal) {
    const result = await shareLink(meal.id);
    if (typeof result === 'string') return; // error — silently ignore in library (full error in builder)
    await Share.share({ url: result.shareUrl, message: result.shareUrl });
  }

  // ── Nutrition preview ──────────────────────────────────────────────────────

  const nutritionPreview =
    quickLog.kind === 'open' && quickLog.grams.trim()
      ? (() => {
          const grams = parseFloat(quickLog.grams);
          if (isNaN(grams) || grams <= 0) return null;
          return calculatePortionNutrition(quickLog.meal, grams);
        })()
      : null;

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]} testID="meal.library.screen">
      <Stack.Screen options={{ title: t('meal.library.title'), headerShown: true }} />

      {state.kind === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator testID="meal.library.loading" />
        </View>
      ) : state.kind === 'error' ? (
        <View style={styles.center} testID="meal.library.error">
          <Text style={[styles.meta, { color: palette.icon }]}>{t('meal.library.error')}</Text>
        </View>
      ) : state.kind === 'ready' && state.meals.length === 0 ? (
        <EmptyState palette={palette} t={t} onCreate={() => router.push('/nutrition/custom-meals/new')} />
      ) : state.kind === 'ready' ? (
        <FlatList
          data={state.meals}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <MealRow
              meal={item}
              palette={palette}
              t={t}
              onLog={() => openQuickLog(item)}
              onEdit={() => router.push(`/nutrition/custom-meals/${item.id}`)}
              onShare={() => handleShare(item)}
              onDelete={() => remove(item.id)}
            />
          )}
          ListFooterComponent={
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/nutrition/custom-meals/new')}
              style={[styles.createButton, { borderColor: palette.tint }]}
              testID="meal.library.cta.create">
              <Text style={[styles.createButtonText, { color: palette.tint }]}>
                {t('meal.library.cta_create')}
              </Text>
            </Pressable>
          }
        />
      ) : null}

      {/* Quick log panel */}
      {quickLog.kind === 'open' ? (
        <QuickLogPanel
          meal={quickLog.meal}
          grams={quickLog.grams}
          error={quickLog.error}
          isLogging={isLoggingMeal}
          nutritionPreview={nutritionPreview}
          palette={palette}
          t={t}
          onChangeGrams={handleGramsChange}
          onConfirm={handleConfirmLog}
          onCancel={closeQuickLog}
        />
      ) : null}
    </View>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  palette,
  t,
  onCreate,
}: {
  palette: Palette;
  t: TFn;
  onCreate: () => void;
}) {
  return (
    <View style={[styles.center, styles.emptyContainer]} testID="meal.library.empty">
      <Text style={[styles.emptyTitle, { color: palette.text }]}>
        {t('meal.library.empty.title')}
      </Text>
      <Text style={[styles.meta, { color: palette.icon }]}>
        {t('meal.library.empty.body')}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onCreate}
        style={[styles.primaryButton, { backgroundColor: palette.tint }]}
        testID="meal.library.empty.cta">
        <Text style={styles.primaryButtonText}>{t('meal.library.cta_create')}</Text>
      </Pressable>
    </View>
  );
}

// ─── Meal Row ─────────────────────────────────────────────────────────────────

function MealRow({
  meal,
  palette,
  t,
  onLog,
  onEdit,
  onShare,
}: {
  meal: CustomMeal;
  palette: Palette;
  t: TFn;
  onLog: () => void;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => Promise<unknown>;
}) {
  return (
    <View
      style={[styles.mealRow, { borderColor: palette.icon + '33' }]}
      testID={`meal.library.row.${meal.id}`}>
      <View style={styles.mealInfo}>
        <Text style={[styles.mealName, { color: palette.text }]} numberOfLines={1}>
          {meal.name}
        </Text>
        <Text style={[styles.meta, { color: palette.icon }]}>
          {meal.totalGrams}g · {meal.calories} kcal
        </Text>
      </View>
      <View style={styles.mealActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onLog}
          style={[styles.smallButton, { backgroundColor: palette.tint }]}
          testID={`meal.library.row.${meal.id}.log`}>
          <Text style={styles.smallButtonText}>{t('meal.library.quick_log.cta_log')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onEdit}
          style={[styles.ghostAction]}
          testID={`meal.library.row.${meal.id}.edit`}>
          <Text style={[styles.ghostActionText, { color: palette.icon }]}>
            {t('meal.library.cta_edit')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onShare}
          style={[styles.ghostAction]}
          testID={`meal.library.row.${meal.id}.share`}>
          <Text style={[styles.ghostActionText, { color: palette.tint }]}>
            {t('meal.library.cta_share')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Quick Log Panel ──────────────────────────────────────────────────────────

function QuickLogPanel({
  meal,
  grams,
  error,
  isLogging,
  nutritionPreview,
  palette,
  t,
  onChangeGrams,
  onConfirm,
  onCancel,
}: {
  meal: CustomMeal;
  grams: string;
  error: string | null;
  isLogging: boolean;
  nutritionPreview: { calories: number; carbs: number; proteins: number; fats: number } | null;
  palette: Palette;
  t: TFn;
  onChangeGrams: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const caloriesLabel = nutritionPreview
    ? (t('meal.library.quick_log.preview.calories') as string).replace(
        '{calories}',
        String(nutritionPreview.calories)
      )
    : null;

  const macrosLabel = nutritionPreview
    ? (t('meal.library.quick_log.preview.macros') as string)
        .replace('{carbs}', String(nutritionPreview.carbs))
        .replace('{proteins}', String(nutritionPreview.proteins))
        .replace('{fats}', String(nutritionPreview.fats))
    : null;

  return (
    <View
      style={[styles.quickLogPanel, { backgroundColor: palette.background, borderColor: palette.tint + '66' }]}
      testID="meal.library.quickLog.panel">
      <Text style={[styles.panelTitle, { color: palette.text }]}>
        {t('meal.library.quick_log.title')}
      </Text>
      <Text style={[styles.mealName, { color: palette.text }]} numberOfLines={1}>
        {meal.name}
      </Text>
      <Text style={[styles.meta, { color: palette.icon }]}>
        {t('meal.library.quick_log.helper')}
      </Text>

      <Text style={[styles.fieldLabel, { color: palette.text }]}>
        {t('meal.library.quick_log.field.label')}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: error ? '#b3261e' : palette.icon + '66',
            color: palette.text,
          },
        ]}
        placeholder={t('meal.library.quick_log.field.placeholder') as string}
        placeholderTextColor={palette.icon}
        value={grams}
        onChangeText={onChangeGrams}
        keyboardType="decimal-pad"
        autoFocus
        testID="meal.library.quickLog.input"
      />
      {error ? (
        <Text style={[styles.fieldError, { color: '#b3261e' }]} testID="meal.library.quickLog.error">
          {error}
        </Text>
      ) : null}

      {/* Nutrition preview */}
      {caloriesLabel && macrosLabel ? (
        <View style={[styles.preview, { borderColor: palette.tint + '44' }]} testID="meal.library.quickLog.preview">
          <Text style={[styles.previewCalories, { color: palette.text }]}>{caloriesLabel}</Text>
          <Text style={[styles.meta, { color: palette.icon }]}>{macrosLabel}</Text>
        </View>
      ) : null}

      <View style={styles.panelActions}>
        {isLogging ? (
          <ActivityIndicator />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onConfirm}
            style={[styles.primaryButton, { backgroundColor: palette.tint }]}
            testID="meal.library.quickLog.cta.confirm">
            <Text style={styles.primaryButtonText}>{t('meal.library.quick_log.cta_log')}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.cancelButton}
          testID="meal.library.quickLog.cta.cancel">
          <Text style={[styles.cancelButtonText, { color: palette.icon }]}>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100, gap: 12 },
  emptyContainer: { gap: 12 },
  emptyTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  meta: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  mealRow: {
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    alignItems: 'flex-start',
  },
  mealInfo: { flex: 1, gap: 4 },
  mealName: { fontSize: 15, fontWeight: '600' },
  mealActions: { alignItems: 'flex-end', gap: 6 },
  smallButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  smallButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  ghostAction: { paddingVertical: 2 },
  ghostActionText: { fontSize: 13 },
  createButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    margin: 4,
    minHeight: 48,
    marginTop: 8,
  },
  createButtonText: { fontSize: 15, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  quickLogPanel: {
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1.5,
    gap: 12,
    left: 0,
    padding: 20,
    position: 'absolute',
    right: 0,
  },
  panelTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  fieldError: { fontSize: 12 },
  preview: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  previewCalories: { fontSize: 15, fontWeight: '700' },
  panelActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cancelButton: { paddingVertical: 8, paddingHorizontal: 4 },
  cancelButtonText: { fontSize: 14 },
});

/**
 * SC-214 Custom Meal Builder
 * Route: /nutrition/custom-meals/:mealId
 *        /nutrition/custom-meals/new  (create mode)
 *
 * Create or edit a custom meal with all nutrition fields, optional ingredient
 * cost, image upload (stubbed), and recipe share-link generation.
 *
 * Image upload pipeline is deferred — progress/retry UI is present but wired
 * to a stub (no Firebase Cloud Storage call yet).
 * Share link generation is deferred — source layer is stubbed.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-214-custom-meal-builder.md
 * Refs: D-017, D-023, D-027, D-029, D-073, FR-137, FR-138, FR-142–144, FR-148,
 *       FR-150, FR-155, FR-159, FR-162, FR-197, FR-202, FR-213
 *       BR-257, BR-261, BR-271, BR-301–303, BR-308–310, BR-313, BR-316,
 *       BR-322, BR-324, BR-327
 *       UC-003.1, UC-003.3, UC-003.4, UC-003.8
 *       AC-401, AC-402, AC-406–408, AC-412, AC-413, AC-418, AC-420, AC-423–425
 *       TC-401–403, TC-407–409, TC-412, TC-413, TC-415, TC-420, TC-422, TC-425–427
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useCustomMeals } from '@/features/nutrition/use-custom-meals';
import {
  validateCustomMealInput,
  type CustomMealInput,
  type CustomMealValidationErrors,
  type ImageUploadState,
} from '@/features/nutrition/custom-meal.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CustomMealBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { mealId } = useLocalSearchParams<{ mealId: string }>();

  const isCreateMode = !mealId || mealId === 'new';
  const { create, update, shareLink } = useCustomMeals(currentUser);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState<CustomMealInput>({
    name: '',
    totalGrams: '',
    calories: '',
    carbs: '',
    proteins: '',
    fats: '',
    ingredientCost: '',
  });
  const [errors, setErrors] = useState<CustomMealValidationErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // savedMealId is set after a successful create — enables share CTA
  const [savedMealId, setSavedMealId] = useState<string | null>(
    isCreateMode ? null : (mealId ?? null)
  );

  // ── Image upload stub ──────────────────────────────────────────────────────
  // Real upload wiring deferred (pending-wiring-checklist-v1.md, D-073)
  const [imageUpload] = useState<ImageUploadState>({ kind: 'idle' });

  // ── Field helper ───────────────────────────────────────────────────────────
  function setField(field: keyof CustomMealInput, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaveError(null);
    const validationErrors = validateCustomMealInput(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSaving(true);
    const err = isCreateMode
      ? await create(form)
      : await update(savedMealId ?? mealId ?? '', form);
    setIsSaving(false);

    if (err) {
      setSaveError(t('meal.builder.error.save') as string);
    } else {
      if (isCreateMode) {
        // After create, ID is unknown until source wiring returns it.
        // For now mark as saved so share CTA activates.
        setSavedMealId('__saved__');
      }
      router.back();
    }
  }

  // ── Share ──────────────────────────────────────────────────────────────────
  async function handleShare() {
    if (!savedMealId) {
      Alert.alert('', t('meal.builder.share.error.needs_save') as string);
      return;
    }
    const result = await shareLink(savedMealId);
    if (typeof result === 'string') {
      // MealActionErrorReason
      Alert.alert('', t('meal.builder.share.error.unknown') as string);
      return;
    }
    await Share.share({ url: result.shareUrl, message: result.shareUrl });
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const screenTitle = isCreateMode
    ? t('meal.builder.title.create')
    : t('meal.builder.title.edit');

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="meal.builder.screen">
      <Stack.Screen options={{ title: screenTitle, headerShown: true }} />

      {/* Helper text */}
      <Text style={[styles.helper, { color: palette.icon }]}>
        {t('meal.builder.helper')}
      </Text>

      {/* Image upload stub */}
      <ImageUploadStub
        uploadState={imageUpload}
        palette={palette}
        t={t}
      />

      {/* Required fields */}
      <FormField
        label={t('meal.builder.field.name.label') as string}
        placeholder={t('meal.builder.field.name.placeholder') as string}
        value={form.name}
        onChangeText={(v) => setField('name', v)}
        error={resolveFieldError('name', errors, t)}
        palette={palette}
        testID="meal.builder.field.name"
      />
      <FormField
        label={t('meal.builder.field.grams.label') as string}
        placeholder={t('meal.builder.field.grams.placeholder') as string}
        value={form.totalGrams}
        onChangeText={(v) => setField('totalGrams', v)}
        error={resolveFieldError('totalGrams', errors, t)}
        keyboardType="decimal-pad"
        palette={palette}
        testID="meal.builder.field.grams"
      />
      <FormField
        label={t('meal.builder.field.calories.label') as string}
        placeholder={t('meal.builder.field.calories.placeholder') as string}
        value={form.calories}
        onChangeText={(v) => setField('calories', v)}
        error={resolveFieldError('calories', errors, t)}
        keyboardType="decimal-pad"
        palette={palette}
        testID="meal.builder.field.calories"
      />
      <FormField
        label={t('meal.builder.field.carbs.label') as string}
        placeholder={t('meal.builder.field.carbs.placeholder') as string}
        value={form.carbs}
        onChangeText={(v) => setField('carbs', v)}
        error={resolveFieldError('carbs', errors, t)}
        keyboardType="decimal-pad"
        palette={palette}
        testID="meal.builder.field.carbs"
      />
      <FormField
        label={t('meal.builder.field.proteins.label') as string}
        placeholder={t('meal.builder.field.proteins.placeholder') as string}
        value={form.proteins}
        onChangeText={(v) => setField('proteins', v)}
        error={resolveFieldError('proteins', errors, t)}
        keyboardType="decimal-pad"
        palette={palette}
        testID="meal.builder.field.proteins"
      />
      <FormField
        label={t('meal.builder.field.fats.label') as string}
        placeholder={t('meal.builder.field.fats.placeholder') as string}
        value={form.fats}
        onChangeText={(v) => setField('fats', v)}
        error={resolveFieldError('fats', errors, t)}
        keyboardType="decimal-pad"
        palette={palette}
        testID="meal.builder.field.fats"
      />

      {/* Optional ingredient cost */}
      <FormField
        label={t('meal.builder.field.cost.label') as string}
        placeholder={t('meal.builder.field.cost.placeholder') as string}
        value={form.ingredientCost ?? ''}
        onChangeText={(v) => setField('ingredientCost', v)}
        error={resolveFieldError('ingredientCost', errors, t)}
        keyboardType="decimal-pad"
        palette={palette}
        testID="meal.builder.field.cost"
      />

      {/* Save error */}
      {saveError ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.errorText, { color: '#b3261e' }]} testID="meal.builder.saveError">
            {saveError}
          </Text>
        </View>
      ) : null}

      {/* Save CTA */}
      {isSaving ? (
        <ActivityIndicator
          testID="meal.builder.savingIndicator"
          accessibilityLabel={t('a11y.loading.saving') as string}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={handleSave}
          style={[styles.primaryButton, { backgroundColor: palette.tint }]}
          testID="meal.builder.cta.save">
          <Text style={styles.primaryButtonText}>{t('meal.builder.cta_save')}</Text>
        </Pressable>
      )}

      {/* Share CTA — only available after a meal has been saved */}
      {savedMealId ? (
        <Pressable
          accessibilityRole="button"
          onPress={handleShare}
          style={[styles.outlineButton, { borderColor: palette.tint }]}
          testID="meal.builder.cta.share">
          <Text style={[styles.outlineButtonText, { color: palette.tint }]}>
            {t('meal.builder.cta_share')}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

// ─── Image Upload Stub ────────────────────────────────────────────────────────

function ImageUploadStub({
  uploadState,
  palette,
  t,
}: {
  uploadState: ImageUploadState;
  palette: Palette;
  t: TFn;
}) {
  const label =
    uploadState.kind === 'uploading'
      ? (t('meal.builder.image.uploading') as string).replace(
          '{percent}',
          String(uploadState.progressPercent)
        )
      : uploadState.kind === 'failed'
        ? t('meal.builder.image.upload_failed')
        : uploadState.kind === 'done'
          ? t('meal.builder.image.cta_change')
          : t('meal.builder.image.cta_upload');

  const isRetry = uploadState.kind === 'failed';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('meal.builder.image.cta_upload') as string}
      onPress={() => {
        // Image picker + upload deferred (pending-wiring-checklist-v1.md)
      }}
      style={[styles.imageUploadArea, { borderColor: palette.icon + '55' }]}
      testID="meal.builder.imageUpload">
      <Text style={[styles.imageUploadLabel, { color: isRetry ? '#b3261e' : palette.icon }]}>
        {label}
      </Text>
      {uploadState.kind === 'uploading' ? (
        <ActivityIndicator size="small" style={styles.imageUploadIndicator} />
      ) : null}
    </Pressable>
  );
}

// ─── Form Field ───────────────────────────────────────────────────────────────

function FormField({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  keyboardType = 'default',
  palette,
  testID,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  error: string | null;
  keyboardType?: 'default' | 'decimal-pad';
  palette: Palette;
  testID: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: error ? '#b3261e' : palette.icon + '66',
            color: palette.text,
          },
        ]}
        placeholder={placeholder}
        placeholderTextColor={palette.icon}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        accessibilityLabel={label}
        testID={`${testID}.input`}
      />
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.fieldError, { color: '#b3261e' }]} testID={`${testID}.error`}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Error message resolver ───────────────────────────────────────────────────

function resolveFieldError(
  field: keyof CustomMealValidationErrors,
  errors: CustomMealValidationErrors,
  t: TFn
): string | null {
  const code = errors[field];
  if (!code) return null;

  const map: Record<string, Record<string, string>> = {
    name: { required: 'meal.builder.validation.name_required' },
    totalGrams: {
      required: 'meal.builder.validation.grams_required',
      must_be_positive: 'meal.builder.validation.grams_positive',
    },
    calories: {
      required: 'meal.builder.validation.calories_required',
      must_be_non_negative: 'meal.builder.validation.calories_non_negative',
    },
    carbs: {
      required: 'meal.builder.validation.carbs_required',
      must_be_non_negative: 'meal.builder.validation.carbs_non_negative',
    },
    proteins: {
      required: 'meal.builder.validation.proteins_required',
      must_be_non_negative: 'meal.builder.validation.proteins_non_negative',
    },
    fats: {
      required: 'meal.builder.validation.fats_required',
      must_be_non_negative: 'meal.builder.validation.fats_non_negative',
    },
    ingredientCost: {
      must_be_non_negative: 'meal.builder.validation.cost_non_negative',
    },
  };

  const key = map[field]?.[code];
  return key ? (t(key as Parameters<TFn>[0]) as string) : null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 16 },
  helper: { fontSize: 13, lineHeight: 20 },
  fieldGroup: { gap: 4 },
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
  errorText: { fontSize: 13 },
  imageUploadArea: {
    alignItems: 'center',
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 72,
  },
  imageUploadLabel: { fontSize: 14 },
  imageUploadIndicator: {},
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  outlineButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 48,
  },
  outlineButtonText: { fontSize: 15, fontWeight: '600' },
  sectionTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
});

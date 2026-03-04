/**
 * SC-214 Custom Meal Builder
 * Route: /nutrition/custom-meals/:mealId
 *        /nutrition/custom-meals/new  (create mode)
 *
 * Create or edit a custom meal with all nutrition fields, optional ingredient
 * cost, image upload (Firebase Cloud Storage), and recipe share-link generation.
 *
 * AI meal photo analysis (BL-108): camera CTA pre-fills form fields with
 * AI-estimated macros. Uses expo-image-picker (camera + library) and
 * expo-image-manipulator for client-side JPEG compression (FR-230, BR-287).
 * Image upload pipeline: pick → compress → uploadBytesResumable → getDownloadURL
 * (BL-007, D-053, D-057, D-073, D-130, D-131). Progress/retry UI wired to real
 * upload state machine via useImageUpload hook.
 * Share link generation is deferred — source layer is stubbed.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-214-custom-meal-builder.md
 *       docs/screens/v2/SC-219-ai-meal-photo-analysis.md
 * Refs: D-017, D-023, D-027, D-029, D-073, D-106–D-110, D-130, D-131,
 *       FR-137, FR-138, FR-142–144, FR-148,
 *       FR-150, FR-155, FR-159, FR-162, FR-197, FR-202, FR-213,
 *       FR-229–FR-239
 *       BR-257, BR-261, BR-271, BR-286–290, BR-301–303, BR-308–310, BR-313,
 *       BR-316, BR-322, BR-324, BR-327
 *       UC-003.1, UC-003.3, UC-003.4, UC-003.8, UC-003.9
 *       AC-401, AC-402, AC-406–408, AC-412, AC-413, AC-418, AC-420, AC-423–425,
 *       AC-513–AC-519
 *       TC-401–403, TC-407–409, TC-412, TC-413, TC-415, TC-420, TC-422, TC-425–427,
 *       TC-271–TC-274, TC-286, TC-287
 */
import { useCallback, useEffect, useState } from 'react';
import { useImageUpload } from '@/features/nutrition/use-image-upload';
import { useSubscription } from '@/features/subscription/use-subscription';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useCustomMeals } from '@/features/nutrition/use-custom-meals';
import {
  validateCustomMealInput,
  type CustomMealInput,
  type CustomMealValidationErrors,
} from '@/features/nutrition/custom-meal.logic';
import {
  resolveImageUploadDisplay,
  buildUploadProgressMessage,
  type ImageUploadState,
} from '@/features/nutrition/image-upload.logic';
import { useMealPhotoAnalysis } from '@/features/nutrition/use-meal-photo-analysis';
import type { PhotoAnalysisErrorReason } from '@/features/nutrition/meal-photo-analysis.logic';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type Palette = {
  background: string;
  text: string;
  icon: string;
  tint: string;
};
type TFn = ReturnType<typeof useTranslation>['t'];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CustomMealBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const palette = {
    background: theme.color.canvas,
    text: theme.color.textPrimary,
    icon: theme.color.textSecondary,
    tint: theme.color.accentPrimary,
  };
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { mealId } = useLocalSearchParams<{ mealId: string }>();

  const isCreateMode = !mealId || mealId === 'new';
  const { create, update, shareLink } = useCustomMeals(Boolean(currentUser));

  // ── Subscription / AI paywall (D-132) ─────────────────────────────────────
  const {
    hasAiAccess,
    isLoading: isSubscriptionLoading,
    openAiPaywall,
  } = useSubscription(Boolean(currentUser));

  // ── AI photo analysis ──────────────────────────────────────────────────────
  const analysis = useMealPhotoAnalysis(currentUser);

  // Pre-fill form fields when analysis completes (BR-288, FR-234)
  useEffect(() => {
    if (analysis.state.kind !== 'done') return;
    const prefill = analysis.preFillMealInput();
    if (prefill) {
      setForm((prev) => ({ ...prev, ...prefill }));
    }
  }, [analysis.state.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // startCapture() handles the full pick → compress → analyze pipeline (FR-230, BR-287).
  const handleAnalyzeCta = useCallback(() => {
    analysis.startCapture();
  }, [analysis]);

  // Track attach-photo toggle (optional, shown after analysis completes — D-109)
  const [attachPhoto, setAttachPhoto] = useState(false);

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

  // ── Image upload (BL-007, D-073, D-130, D-131) ────────────────────────────
  // Replaces stub: real Firebase Cloud Storage upload with progress tracking.
  const {
    uploadState: imageUpload,
    pickAndUpload,
    retry: retryUpload,
  } = useImageUpload(currentUser);

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

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
    await Share.share({ message: result.shareLinkId });
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const screenTitle = isCreateMode
    ? t('meal.builder.title.create')
    : t('meal.builder.title.edit');

  return (
    <DsScreen
      scheme={scheme}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="meal.builder.screen">
      <Stack.Screen options={{ title: screenTitle, headerShown: true }} />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner') as string}
          testID="meal.builder.offlineBanner"
        />
      ) : null}

      {/* Helper text */}
      <Text style={[styles.helper, { color: palette.icon }]}>
        {t('meal.builder.helper')}
      </Text>

      {/* AI photo analysis CTA & status (BL-108, FR-229, AC-513, D-132) */}
      <MealPhotoAnalysisSection
        analysisState={analysis.state}
        attachPhoto={attachPhoto}
        onAnalyzeCta={handleAnalyzeCta}
        onReset={analysis.reset}
        onToggleAttach={() => setAttachPhoto((v) => !v)}
        hasAiAccess={hasAiAccess}
        isSubscriptionLoading={isSubscriptionLoading}
        onOpenPaywall={openAiPaywall}
        palette={palette}
        t={t}
      />

      {/* Image upload progress + retry (BL-007, FR-213, AC-424, AC-425) */}
      <ImageUploadSection
        uploadState={imageUpload}
        onPickAndUpload={() => void pickAndUpload(savedMealId ?? 'new')}
        onRetry={() => void retryUpload()}
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
          disabled={isWriteLocked}
          onPress={handleSave}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isWriteLocked ? 0.4 : 1 }]}
          testID="meal.builder.cta.save">
          <Text style={styles.primaryButtonText}>{t('meal.builder.cta_save')}</Text>
        </Pressable>
      )}

      {/* Share CTA — only available after a meal has been saved */}
      {savedMealId ? (
        <Pressable
          accessibilityRole="button"
          disabled={isWriteLocked}
          onPress={handleShare}
          style={[styles.outlineButton, { borderColor: palette.tint, opacity: isWriteLocked ? 0.4 : 1 }]}
          testID="meal.builder.cta.share">
          <Text style={[styles.outlineButtonText, { color: palette.tint }]}>
            {t('meal.builder.cta_share')}
          </Text>
        </Pressable>
      ) : null}
    </DsScreen>
  );
}

// ─── Meal Photo Analysis Section ─────────────────────────────────────────────
// Refs: BL-108, FR-229–FR-239, AC-513–AC-519, BR-286–BR-290, D-132

function MealPhotoAnalysisSection({
  analysisState,
  attachPhoto,
  onAnalyzeCta,
  onReset,
  onToggleAttach,
  hasAiAccess,
  isSubscriptionLoading,
  onOpenPaywall,
  palette,
  t,
}: {
  analysisState: import('@/features/nutrition/use-meal-photo-analysis').PhotoAnalysisState;
  attachPhoto: boolean;
  onAnalyzeCta: () => void;
  onReset: () => void;
  onToggleAttach: () => void;
  /** Whether the current user has an active entitlement for AI features (D-132). */
  hasAiAccess: boolean;
  /** True while entitlement status is being fetched from RevenueCat. */
  isSubscriptionLoading: boolean;
  /** Opens the RevenueCat native paywall for the AI features offering. */
  onOpenPaywall: () => void;
  palette: Palette;
  t: TFn;
}) {
  const isActive =
    analysisState.kind === 'capturing' ||
    analysisState.kind === 'compressing' ||
    analysisState.kind === 'analyzing';

  const errorMessage = analysisState.kind === 'error'
    ? resolveAnalysisError(analysisState.reason, t)
    : null;

  const isLowConfidence =
    analysisState.kind === 'done' && analysisState.estimate.confidence === 'low';

  return (
    <View style={[styles.analysisSection, { borderColor: palette.tint + '44' }]} testID="meal.photoAnalysis.section">
      {/* Paywall gate (D-132): show locked banner when user has no active AI entitlement */}
      {!hasAiAccess && analysisState.kind === 'idle' ? (
        isSubscriptionLoading ? (
          <ActivityIndicator
            size="small"
            color={palette.icon}
            accessibilityLabel={t('meal.photo_analysis.paywall.loading') as string}
            testID="meal.photoAnalysis.paywall.loading"
          />
        ) : (
          <View style={styles.paywallBanner} testID="meal.photoAnalysis.paywall">
            <Text style={[styles.analysisMeta, { color: palette.text }]}>
              {t('meal.photo_analysis.paywall.locked')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenPaywall}
              style={[styles.outlineButton, { borderColor: palette.tint, marginTop: 8 }]}
              testID="meal.photoAnalysis.paywall.cta">
              <Text style={[styles.outlineButtonText, { color: palette.tint }]}>
                {t('meal.photo_analysis.paywall.cta_upgrade')}
              </Text>
            </Pressable>
          </View>
        )
      ) : null}

      {/* Primary CTA — only shown when user has AI access */}
      {hasAiAccess && (analysisState.kind === 'idle' || analysisState.kind === 'error') ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAnalyzeCta}
          style={[styles.outlineButton, { borderColor: palette.tint }]}
          testID="meal.photoAnalysis.cta">
          <Text style={[styles.outlineButtonText, { color: palette.tint }]}>
            {t('meal.photo_analysis.cta')}
          </Text>
        </Pressable>
      ) : null}

      {/* Analyzing indicator */}
      {isActive ? (
        <View style={styles.analysisRow} testID="meal.photoAnalysis.analyzing">
          <ActivityIndicator size="small" color={palette.tint} />
          <Text style={[styles.analysisMeta, { color: palette.icon }]}>
            {t('meal.photo_analysis.analyzing')}
          </Text>
        </View>
      ) : null}

      {/* Error message (AC-516, BR-289) */}
      {errorMessage ? (
        <View accessibilityLiveRegion="polite" testID="meal.photoAnalysis.error">
          <Text style={[styles.analysisMeta, { color: '#b3261e' }]}>{errorMessage}</Text>
        </View>
      ) : null}

      {/* Done — disclaimer + optional low-confidence warning + attach toggle + reset */}
      {analysisState.kind === 'done' ? (
        <View style={styles.analysisDoneBlock}>
          {/* AI disclaimer (BR-290, AC-515) */}
          <View
            style={[styles.disclaimerBanner, { backgroundColor: palette.tint + '18', borderColor: palette.tint + '44' }]}
            testID="meal.photoAnalysis.disclaimer">
            <Text style={[styles.analysisMeta, { color: palette.text }]}>
              {t('meal.photo_analysis.disclaimer')}
            </Text>
          </View>

          {/* Low-confidence warning (BR-289) */}
          {isLowConfidence ? (
            <Text
              style={[styles.analysisMeta, { color: '#b3261e' }]}
              testID="meal.photoAnalysis.lowConfidence">
              {t('meal.photo_analysis.confidence.low')}
            </Text>
          ) : null}

          {/* Attach photo toggle (D-109) */}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: attachPhoto }}
            onPress={onToggleAttach}
            style={styles.attachToggleRow}
            testID="meal.photoAnalysis.attachToggle">
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: palette.tint,
                  backgroundColor: attachPhoto ? palette.tint : 'transparent',
                },
              ]}
            />
            <Text style={[styles.analysisMeta, { color: palette.text }]}>
              {t('meal.photo_analysis.attach_photo.label')}
            </Text>
          </Pressable>

          {/* Try again link */}
          <Pressable
            accessibilityRole="button"
            onPress={onReset}
            testID="meal.photoAnalysis.reset">
            <Text style={[styles.analysisMeta, { color: palette.tint }]}>
              {t('meal.photo_analysis.cta')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function resolveAnalysisError(reason: PhotoAnalysisErrorReason, t: TFn): string {
  switch (reason) {
    case 'unrecognizable_image':
      return t('meal.photo_analysis.error.unrecognizable') as string;
    case 'quota_exceeded':
      return t('meal.photo_analysis.error.quota') as string;
    case 'network':
      return t('meal.photo_analysis.error.network') as string;
    default:
      return t('meal.photo_analysis.error.generic') as string;
  }
}

// ─── Image Upload Section ─────────────────────────────────────────────────────
// BL-007: Renders upload progress bar, error messages, and retry CTA.
// Refs: FR-213, AC-424, AC-425, BR-261, BR-271

function ImageUploadSection({
  uploadState,
  onPickAndUpload,
  onRetry,
  palette,
  t,
}: {
  uploadState: ImageUploadState;
  onPickAndUpload: () => void;
  onRetry: () => void;
  palette: Palette;
  t: TFn;
}) {
  const display = resolveImageUploadDisplay(uploadState);

  // Primary area label
  const areaLabel: string = display.isDone
    ? (t('meal.builder.image.cta_change') as string)
    : (t('meal.builder.image.cta_upload') as string);

  // Progress message when uploading
  const progressMessage: string | null = display.showProgress && display.progressPercent !== null
    ? buildUploadProgressMessage(
        t('custom_meal.image.upload_progress') as string,
        display.progressPercent
      )
    : null;

  // Error message key → localized string
  const errorMessage: string | null = display.errorMessageKey
    ? (t(display.errorMessageKey as Parameters<TFn>[0]) as string)
    : null;

  return (
    <View testID="meal.builder.imageUpload.section">
      {/* Tap area: upload / change photo */}
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t('meal.builder.image.cta_upload') as string}
        onPress={onPickAndUpload}
        style={[styles.imageUploadArea, { borderColor: palette.icon + '55' }]}
        testID="meal.builder.imageUpload">
        <Text style={[styles.imageUploadLabel, { color: palette.icon }]}>
          {areaLabel}
        </Text>
        {display.showProgress ? (
          <ActivityIndicator size="small" style={styles.imageUploadIndicator} />
        ) : null}
      </Pressable>

      {/* Progress message (AC-424) */}
      {progressMessage ? (
        <Text
          style={[styles.imageUploadMeta, { color: palette.icon }]}
          accessibilityLiveRegion="polite"
          testID="meal.builder.imageUpload.progress">
          {progressMessage}
        </Text>
      ) : null}

      {/* Error message (AC-425, BR-271) */}
      {errorMessage ? (
        <View accessibilityLiveRegion="polite">
          <Text
            style={[styles.imageUploadMeta, { color: '#b3261e' }]}
            testID="meal.builder.imageUpload.error">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      {/* Retry CTA — only shown for retryable errors (BR-271) */}
      {display.canRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          testID="meal.builder.imageUpload.retry">
          <Text style={[styles.imageUploadMeta, { color: palette.tint }]}>
            {t('custom_meal.image.retry')}
          </Text>
        </Pressable>
      ) : null}
    </View>
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
  imageUploadMeta: { fontSize: 12, marginTop: 4 },
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
  // AI photo analysis section
  analysisSection: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  paywallBanner: {
    alignItems: 'center',
    gap: 4,
  },
  analysisRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  analysisMeta: { fontSize: 13, lineHeight: 18 },
  analysisDoneBlock: { gap: 8 },
  disclaimerBanner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  attachToggleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  checkbox: {
    borderRadius: 4,
    borderWidth: 1.5,
    height: 18,
    width: 18,
  },
  offlineBanner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  offlineBannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
});

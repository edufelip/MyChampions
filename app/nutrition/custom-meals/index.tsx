/**
 * SC-215 Custom Meal Library & Quick Log
 * Route: /nutrition/custom-meals
 *
 * Browse saved custom meals and quickly log consumed grams with proportional
 * nutrition calculation shown before confirmation.
 *
 * AI meal photo analysis (BL-108): camera CTA in the quick-log panel pre-fills
 * grams from the AI-estimated totalGrams. Uses expo-image-picker (camera + library)
 * and expo-image-manipulator for client-side JPEG compression (FR-230, BR-287).
 * AI CTA is gated by paywall — requires premium_student or professional_unlimited
 * entitlement (D-132). RevenueCat native paywall shown on upgrade tap.
 * Data Connect meal source wiring is complete (D-126).
 * Portion log persistence is wired via logPortion SDK operation.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-215-custom-meal-library-and-quick-log.md
 *       docs/screens/v2/SC-219-ai-meal-photo-analysis.md
 * Refs: D-017, D-021, D-023, D-106–D-110, D-132,
 *       FR-139–144, FR-147, FR-150, FR-229–FR-239
 *       BR-286–290, BR-304–310, BR-313, BR-316
 *       UC-003.2, UC-003.3, UC-003.4, UC-003.6, UC-003.9
 *       AC-403–408, AC-411, AC-413, AC-513–AC-519
 *       TC-271–TC-274, TC-286, TC-404–409, TC-412, TC-414, TC-415
 */
import { useCallback, useEffect, useState } from 'react';
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

import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useCustomMeals } from '@/features/nutrition/use-custom-meals';
import {
  validatePortionLogInput,
  calculatePortionNutrition,
  type CustomMeal,
} from '@/features/nutrition/custom-meal.logic';
import { useMealPhotoAnalysis } from '@/features/nutrition/use-meal-photo-analysis';
import type { PhotoAnalysisErrorReason } from '@/features/nutrition/meal-photo-analysis.logic';
import { useSubscription } from '@/features/subscription/use-subscription';
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
  surface: string;
  text: string;
  icon: string;
  tint: string;
  danger: string;
  success: string;
  onAccent: string;
};
type TFn = ReturnType<typeof useTranslation>['t'];

type QuickLogPanelState =
  | { kind: 'closed' }
  | { kind: 'open'; meal: CustomMeal; grams: string; error: string | null };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CustomMealLibraryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const palette = {
    background: theme.color.canvas,
    surface: theme.color.surface,
    text: theme.color.textPrimary,
    icon: theme.color.textSecondary,
    tint: theme.color.accentPrimary,
    danger: theme.color.danger,
    success: theme.color.success,
    onAccent: theme.color.onAccent,
  };
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { state, shareLink, remove, logPortion } = useCustomMeals(Boolean(currentUser));

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const [quickLog, setQuickLog] = useState<QuickLogPanelState>({ kind: 'closed' });
  const [isLoggingMeal, setIsLoggingMeal] = useState(false);

  // ── Subscription / AI paywall (D-132) ─────────────────────────────────────
  const {
    hasAiAccess,
    isLoading: isSubscriptionLoading,
    openAiPaywall,
  } = useSubscription(Boolean(currentUser));

  // ── AI photo analysis (BL-108) ─────────────────────────────────────────────
  const analysis = useMealPhotoAnalysis(currentUser);

  // When analysis completes, pre-fill quickLog grams with estimated totalGrams (FR-236)
  useEffect(() => {
    if (analysis.state.kind !== 'done') return;
    if (quickLog.kind !== 'open') return;
    const totalGrams = String(analysis.state.estimate.totalGrams);
    setQuickLog((prev) =>
      prev.kind === 'open' ? { ...prev, grams: totalGrams, error: null } : prev
    );
  }, [analysis.state.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // startCapture() handles the full pick → compress → analyze pipeline (FR-230, BR-287).
  const handleAnalyzeCta = useCallback(() => {
    analysis.startCapture();
  }, [analysis]);

  // ── Quick log handlers ─────────────────────────────────────────────────────

  function openQuickLog(meal: CustomMeal) {
    setQuickLog({ kind: 'open', meal, grams: '', error: null });
  }

  function closeQuickLog() {
    setQuickLog({ kind: 'closed' });
    analysis.reset();
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
    const error = await logPortion(quickLog.meal.id, parseFloat(quickLog.grams));
    setIsLoggingMeal(false);
    if (error) {
      setQuickLog({ ...quickLog, error: t('meal.library.quick_log.error') as string });
      return;
    }
    closeQuickLog();
  }

  // ── Share handler ──────────────────────────────────────────────────────────

  async function handleShare(meal: CustomMeal) {
    const result = await shareLink(meal.id);
    if (typeof result === 'string') return; // error — silently ignore in library (full error in builder)
    await Share.share({ message: result.shareLinkId });
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
    <DsScreen scheme={scheme} testID="meal.library.screen">
      <Stack.Screen options={{ title: t('meal.library.title'), headerShown: true }} />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner') as string}
          testID="meal.library.offlineBanner"
        />
      ) : null}

      {state.kind === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator
            testID="meal.library.loading"
            accessibilityLabel={t('a11y.loading.default') as string}
          />
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
              isWriteLocked={isWriteLocked}
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
          isWriteLocked={isWriteLocked}
          nutritionPreview={nutritionPreview}
          analysisState={analysis.state}
          onAnalyzeCta={handleAnalyzeCta}
          onResetAnalysis={analysis.reset}
          hasAiAccess={hasAiAccess}
          isSubscriptionLoading={isSubscriptionLoading}
          onOpenPaywall={openAiPaywall}
          palette={palette}
          t={t}
          onChangeGrams={handleGramsChange}
          onConfirm={handleConfirmLog}
          onCancel={closeQuickLog}
        />
      ) : null}
    </DsScreen>
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
        <Text style={[styles.primaryButtonText, { color: palette.onAccent }]}>{t('meal.library.cta_create')}</Text>
      </Pressable>
    </View>
  );
}

// ─── Meal Row ─────────────────────────────────────────────────────────────────

function MealRow({
  meal,
  palette,
  t,
  isWriteLocked,
  onLog,
  onEdit,
  onShare,
}: {
  meal: CustomMeal;
  palette: Palette;
  t: TFn;
  isWriteLocked: boolean;
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
          accessibilityLabel={`${t('meal.library.quick_log.cta_log') as string} ${meal.name}`}
          disabled={isWriteLocked}
          onPress={onLog}
          style={[styles.smallButton, { backgroundColor: palette.tint, opacity: isWriteLocked ? 0.4 : 1 }]}
          testID={`meal.library.row.${meal.id}.log`}>
          <Text style={[styles.smallButtonText, { color: palette.onAccent }]}>{t('meal.library.quick_log.cta_log')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('meal.library.cta_edit') as string} ${meal.name}`}
          onPress={onEdit}
          style={[styles.ghostAction]}
          testID={`meal.library.row.${meal.id}.edit`}>
          <Text style={[styles.ghostActionText, { color: palette.icon }]}>
            {t('meal.library.cta_edit')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('meal.library.cta_share') as string} ${meal.name}`}
          disabled={isWriteLocked}
          onPress={onShare}
          style={[styles.ghostAction, { opacity: isWriteLocked ? 0.4 : 1 }]}
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
  isWriteLocked,
  nutritionPreview,
  analysisState,
  onAnalyzeCta,
  onResetAnalysis,
  hasAiAccess,
  isSubscriptionLoading,
  onOpenPaywall,
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
  isWriteLocked: boolean;
  nutritionPreview: { calories: number; carbs: number; proteins: number; fats: number } | null;
  analysisState: import('@/features/nutrition/use-meal-photo-analysis').PhotoAnalysisState;
  onAnalyzeCta: () => void;
  onResetAnalysis: () => void;
  hasAiAccess: boolean;
  isSubscriptionLoading: boolean;
  onOpenPaywall: () => void;
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
            borderColor: error ? palette.danger : palette.icon + '66',
            color: palette.text,
          },
        ]}
        placeholder={t('meal.library.quick_log.field.placeholder') as string}
        placeholderTextColor={palette.icon}
        value={grams}
        onChangeText={onChangeGrams}
        keyboardType="decimal-pad"
        autoFocus
        accessibilityLabel={t('meal.library.quick_log.field.label') as string}
        testID="meal.library.quickLog.input"
      />
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.fieldError, { color: palette.danger }]} testID="meal.library.quickLog.error">
            {error}
          </Text>
        </View>
      ) : null}

      {/* Nutrition preview */}
      {caloriesLabel && macrosLabel ? (
        <View style={[styles.preview, { borderColor: palette.tint + '44' }]} testID="meal.library.quickLog.preview">
          <Text style={[styles.previewCalories, { color: palette.text }]}>{caloriesLabel}</Text>
          <Text style={[styles.meta, { color: palette.icon }]}>{macrosLabel}</Text>
        </View>
      ) : null}

      {/* AI photo analysis (BL-108, FR-236, AC-517, D-132) */}
      <QuickLogAnalysisRow
        analysisState={analysisState}
        onAnalyzeCta={onAnalyzeCta}
        onResetAnalysis={onResetAnalysis}
        hasAiAccess={hasAiAccess}
        isSubscriptionLoading={isSubscriptionLoading}
        onOpenPaywall={onOpenPaywall}
        palette={palette}
        t={t}
      />

      <View style={styles.panelActions}>
        {isLogging ? (
          <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting') as string} />
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={isWriteLocked}
            onPress={onConfirm}
            style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isWriteLocked ? 0.4 : 1 }]}
            testID="meal.library.quickLog.cta.confirm">
            <Text style={[styles.primaryButtonText, { color: palette.onAccent }]}>{t('meal.library.quick_log.cta_log')}</Text>
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

// ─── Quick Log Analysis Row ───────────────────────────────────────────────────
// Shown inside the Quick Log panel to trigger/display AI photo analysis.
// Refs: BL-108, FR-236, AC-517, BR-289, BR-290, D-132

function QuickLogAnalysisRow({
  analysisState,
  onAnalyzeCta,
  onResetAnalysis,
  hasAiAccess,
  isSubscriptionLoading,
  onOpenPaywall,
  palette,
  t,
}: {
  analysisState: import('@/features/nutrition/use-meal-photo-analysis').PhotoAnalysisState;
  onAnalyzeCta: () => void;
  onResetAnalysis: () => void;
  hasAiAccess: boolean;
  isSubscriptionLoading: boolean;
  onOpenPaywall: () => void;
  palette: Palette;
  t: TFn;
}) {
  const isActive =
    analysisState.kind === 'capturing' ||
    analysisState.kind === 'compressing' ||
    analysisState.kind === 'analyzing';

  return (
    <View testID="meal.library.quickLog.analysis">
      {/* Paywall gate (D-132) */}
      {!hasAiAccess && analysisState.kind === 'idle' ? (
        isSubscriptionLoading ? (
          <ActivityIndicator
            size="small"
            color={palette.icon}
            accessibilityLabel={t('meal.photo_analysis.paywall.loading') as string}
            testID="meal.library.quickLog.analysis.paywall.loading"
          />
        ) : (
          <View testID="meal.library.quickLog.analysis.paywall">
            <Text style={[styles.analysisMeta, { color: palette.text }]}>
              {t('meal.photo_analysis.paywall.locked')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenPaywall}
              style={[styles.analysisCtaButton, { borderColor: palette.tint, marginTop: 6 }]}
              testID="meal.library.quickLog.analysis.paywall.cta">
              <Text style={[styles.analysisCtaText, { color: palette.tint }]}>
                {t('meal.photo_analysis.paywall.cta_upgrade')}
              </Text>
            </Pressable>
          </View>
        )
      ) : null}

      {/* CTA — only when user has AI access and state is idle or error */}
      {hasAiAccess && (analysisState.kind === 'idle' || analysisState.kind === 'error') ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAnalyzeCta}
          style={[styles.analysisCtaButton, { borderColor: palette.tint }]}
          testID="meal.library.quickLog.analysis.cta">
          <Text style={[styles.analysisCtaText, { color: palette.tint }]}>
            {t('meal.photo_analysis.cta')}
          </Text>
        </Pressable>
      ) : null}

      {/* Analyzing indicator */}
      {isActive ? (
        <View style={styles.analysisInlineRow} testID="meal.library.quickLog.analysis.analyzing">
          <ActivityIndicator size="small" color={palette.tint} />
          <Text style={[styles.analysisMeta, { color: palette.icon }]}>
            {t('meal.photo_analysis.analyzing')}
          </Text>
        </View>
      ) : null}

      {/* Error */}
      {analysisState.kind === 'error' ? (
        <View accessibilityLiveRegion="polite" testID="meal.library.quickLog.analysis.error">
          <Text style={[styles.analysisMeta, { color: palette.danger }]}>
            {resolveQuickLogAnalysisError(analysisState.reason, t)}
          </Text>
        </View>
      ) : null}

      {/* Done — disclaimer + low confidence + reset */}
      {analysisState.kind === 'done' ? (
        <View style={styles.analysisInlineRow} testID="meal.library.quickLog.analysis.done">
          <Text style={[styles.analysisMeta, { color: palette.icon }]}>
            {t('meal.photo_analysis.disclaimer')}
          </Text>
          {analysisState.estimate.confidence === 'low' ? (
            <Text style={[styles.analysisMeta, { color: palette.danger }]}>{t('meal.photo_analysis.confidence.low')}</Text>
          ) : null}
          <Pressable accessibilityRole="button" onPress={onResetAnalysis} testID="meal.library.quickLog.analysis.reset">
            <Text style={[styles.analysisMeta, { color: palette.tint }]}>{t('meal.photo_analysis.cta')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function resolveQuickLogAnalysisError(reason: PhotoAnalysisErrorReason, t: TFn): string {
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
  smallButtonText: { fontSize: 13, fontWeight: '600' },
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
  primaryButtonText: { fontSize: 15, fontWeight: '700' },
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
  // AI photo analysis in quick-log panel
  analysisCtaButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 40,
  },
  analysisCtaText: { fontSize: 13, fontWeight: '600' },
  analysisInlineRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  analysisMeta: { fontSize: 12, lineHeight: 18 },
  offlineBanner: {
    borderRadius: 8,
    borderWidth: 1,
    margin: 16,
    marginBottom: 0,
    padding: 10,
  },
  offlineBannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
});

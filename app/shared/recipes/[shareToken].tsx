/**
 * SC-216 Shared Recipe Save Confirmation
 * Route: /shared/recipes/:shareToken
 *
 * Resolves a share token, shows the immutable nutrition snapshot, and lets the
 * authenticated recipient save a personal copy to their custom meal library.
 *
 * States:
 *   loading  — resolving share token via previewImport
 *   error    — invalid token or network failure
 *   ready    — preview loaded, recipient can confirm or cancel
 *   saved    — import succeeded (idempotent: re-opening resolves to same state)
 *
 * Auth gate: unauthenticated users are redirected to sign-in by the root
 * layout guard; the redirect-back mechanism (deep-link resume) is deferred and
 * tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Import wiring is deferred — importMeal calls the Data Connect endpoint stub.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-216-shared-recipe-save-confirmation.md
 * Refs: FR-145–FR-155, FR-159–FR-162
 *       BR-311–BR-327
 *       UC-003.5, UC-003.6, UC-003.7
 *       AC-409–AC-423
 *       TC-410–TC-425
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useCustomMeals } from '@/features/nutrition/use-custom-meals';
import type { SharedMealSnapshot } from '@/features/nutrition/custom-meal.logic';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; reason: 'invalid_token' | 'network' | 'unknown' }
  | { kind: 'ready'; snapshot: SharedMealSnapshot }
  | { kind: 'saved'; snapshot: SharedMealSnapshot };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SharedRecipeSaveScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const router = useRouter();
  const { shareToken } = useLocalSearchParams<{ shareToken: string }>();
  const { currentUser } = useAuthSession();
  const { previewImport, importMeal } = useCustomMeals(Boolean(currentUser));

  const [screenState, setScreenState] = useState<ScreenState>({ kind: 'loading' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  // ── Resolve share token on mount ───────────────────────────────────────────

  useEffect(() => {
    if (!shareToken) {
      setScreenState({ kind: 'error', reason: 'invalid_token' });
      return;
    }

    setScreenState({ kind: 'loading' });

    void previewImport(shareToken).then((result) => {
      if (typeof result === 'string') {
        // MealActionErrorReason
        const reason =
          result === 'not_found'
            ? 'invalid_token'
            : result === 'network'
              ? 'network'
              : 'unknown';
        setScreenState({ kind: 'error', reason });
      } else {
        setScreenState({ kind: 'ready', snapshot: result });
      }
    });
    // previewImport is stable (useCallback with [user]) — safe dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken]);

  // ── Save handler ───────────────────────────────────────────────────────────

  async function handleSave() {
    if (screenState.kind !== 'ready') return;
    const snapshot = screenState.snapshot;

    setSaveError(null);
    setIsSaving(true);
    const err = await importMeal(shareToken ?? '');
    setIsSaving(false);

    if (err) {
      setSaveError(t('shared_recipe.error.save') as string);
    } else {
      setScreenState({ kind: 'saved', snapshot });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="shared_recipe.screen">
      <Stack.Screen
        options={{ title: t('shared_recipe.title'), headerShown: true }}
      />

      {screenState.kind === 'loading' ? (
        <View style={styles.center} testID="shared_recipe.loading">
          <ActivityIndicator
            size="large"
            accessibilityLabel={t('a11y.loading.default') as string}
          />
        </View>
      ) : screenState.kind === 'error' ? (
        <ErrorView reason={screenState.reason} palette={palette} t={t} />
      ) : screenState.kind === 'saved' ? (
        <SavedView
          snapshot={screenState.snapshot}
          palette={palette}
          t={t}
          onNavigateBack={() => router.back()}
        />
      ) : (
        // ready
        <PreviewView
          snapshot={screenState.snapshot}
          isSaving={isSaving}
          saveError={saveError}
          isWriteLocked={isWriteLocked}
          offlineDisplay={offlineDisplay}
          palette={palette}
          t={t}
          onSave={handleSave}
          onCancel={() => router.back()}
        />
      )}
    </ScrollView>
  );
}

// ─── Error View ───────────────────────────────────────────────────────────────

function ErrorView({
  reason,
  palette,
  t,
}: {
  reason: 'invalid_token' | 'network' | 'unknown';
  palette: Palette;
  t: TFn;
}) {
  const message =
    reason === 'invalid_token'
      ? t('shared_recipe.error.invalid_token')
      : reason === 'network'
        ? t('shared_recipe.error.network')
        : t('shared_recipe.error.unknown');

  return (
    <View style={styles.center} testID="shared_recipe.error" accessibilityRole="alert">
      <Text style={[styles.errorText, { color: '#b3261e' }]}>{message}</Text>
    </View>
  );
}

// ─── Preview View ─────────────────────────────────────────────────────────────

function PreviewView({
  snapshot,
  isSaving,
  saveError,
  isWriteLocked,
  offlineDisplay,
  palette,
  t,
  onSave,
  onCancel,
}: {
  snapshot: SharedMealSnapshot;
  isSaving: boolean;
  saveError: string | null;
  isWriteLocked: boolean;
  offlineDisplay: OfflineDisplayState;
  palette: Palette;
  t: TFn;
  onSave: () => void;
  onCancel: () => void;
}) {
  const caloriesLabel = (t('shared_recipe.nutrition.calories') as string).replace(
    '{calories}',
    String(snapshot.calories)
  );
  const macrosLabel = (t('shared_recipe.nutrition.macros') as string)
    .replace('{carbs}', String(snapshot.carbs))
    .replace('{proteins}', String(snapshot.proteins))
    .replace('{fats}', String(snapshot.fats));
  const weightLabel = (t('shared_recipe.nutrition.weight') as string).replace(
    '{grams}',
    String(snapshot.totalGrams)
  );

  return (
    <View style={styles.previewContainer} testID="shared_recipe.preview">

      {/* Offline banner (BL-008) */}
      {offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
          testID="shared_recipe.offlineBanner">
          <Text style={[styles.offlineBannerText, { color: palette.text }]}>
            {t('offline.banner')}
          </Text>
        </View>
      ) : null}

      {/* Recipe name */}
      <Text
        style={[styles.recipeName, { color: palette.text }]}
        testID="shared_recipe.preview.name">
        {snapshot.name}
      </Text>

      {/* Nutrition card */}
      <View
        style={[styles.nutritionCard, { borderColor: palette.icon + '33' }]}
        testID="shared_recipe.preview.nutrition">
        <Text style={[styles.nutritionCalories, { color: palette.text }]}>
          {caloriesLabel}
        </Text>
        <Text style={[styles.nutritionMacros, { color: palette.icon }]}>{macrosLabel}</Text>
        <Text style={[styles.nutritionWeight, { color: palette.icon }]}>{weightLabel}</Text>
      </View>

      {/* Helper + ownership note */}
      <Text style={[styles.helper, { color: palette.icon }]}>{t('shared_recipe.helper')}</Text>
      <Text style={[styles.ownershipNote, { color: palette.icon }]}>
        {t('shared_recipe.ownership_note')}
      </Text>

      {/* Save error */}
      {saveError ? (
        <View accessibilityLiveRegion="polite">
          <Text
            style={[styles.saveErrorText, { color: '#b3261e' }]}
            testID="shared_recipe.saveError">
            {saveError}
          </Text>
        </View>
      ) : null}

      {/* CTAs */}
      {isSaving ? (
        <ActivityIndicator
          testID="shared_recipe.savingIndicator"
          accessibilityLabel={t('a11y.loading.saving') as string}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={isWriteLocked}
          onPress={onSave}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isWriteLocked ? 0.4 : 1 }]}
          testID="shared_recipe.cta.save">
          <Text style={styles.primaryButtonText}>{t('shared_recipe.cta_save')}</Text>
        </Pressable>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        style={styles.cancelButton}
        testID="shared_recipe.cta.cancel">
        <Text style={[styles.cancelButtonText, { color: palette.icon }]}>
          {t('shared_recipe.cta_cancel')}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Saved View ───────────────────────────────────────────────────────────────

function SavedView({
  snapshot,
  palette,
  t,
  onNavigateBack,
}: {
  snapshot: SharedMealSnapshot;
  palette: Palette;
  t: TFn;
  onNavigateBack: () => void;
}) {
  return (
    <View style={[styles.center, styles.savedContainer]} testID="shared_recipe.saved">
      {/* Success banner */}
      <View
        style={[styles.successBanner, { borderColor: '#16a34a' }]}
        accessibilityRole="alert">
        <Text style={[styles.successText, { color: '#16a34a' }]}>
          {t('shared_recipe.success')}
        </Text>
      </View>

      <Text style={[styles.recipeName, { color: palette.text }]}>{snapshot.name}</Text>

      {/* Existing copy note */}
      <Text style={[styles.helper, { color: palette.icon }]}>
        {t('shared_recipe.existing_copy')}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={onNavigateBack}
        style={[styles.primaryButton, { backgroundColor: palette.tint }]}
        testID="shared_recipe.saved.cta">
        <Text style={styles.primaryButtonText}>{t('shared_recipe.cta_cancel')}</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  previewContainer: { gap: 16 },
  savedContainer: { gap: 16 },

  recipeName: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 20,
    fontWeight: '700',
  },

  nutritionCard: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  nutritionCalories: { fontSize: 22, fontWeight: '700' },
  nutritionMacros: { fontSize: 14, lineHeight: 20 },
  nutritionWeight: { fontSize: 13 },

  helper: { fontSize: 13, lineHeight: 20 },
  ownershipNote: { fontSize: 13, lineHeight: 20, fontStyle: 'italic' },

  errorText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  saveErrorText: { fontSize: 13 },

  successBanner: {
    backgroundColor: '#16a34a11',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    alignSelf: 'stretch',
  },
  successText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },

  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 52,
    alignSelf: 'stretch',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelButtonText: { fontSize: 14 },
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

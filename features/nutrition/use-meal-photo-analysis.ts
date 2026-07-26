/**
 * React hook for AI meal photo macronutrient analysis.
 * Manages the full capture → compress → analyze state machine.
 *
 * Camera/picker wiring: uses expo-image-picker (launchCameraAsync +
 *   launchImageLibraryAsync via ActionSheetIOS-style Alert) with
 *   expo-image-manipulator for client-side JPEG compression.
 *
 * Compression target: ≤ 1.5 MB / ≤ 1600 px longest side (FR-230, BR-287, Q-022).
 * Refs: BL-108, D-106–D-110, FR-229–FR-239
 */

import { useCallback, useMemo, useState } from 'react';

import type { AuthUser } from '@/features/auth/auth-user';
import { resolveE2EAuthSessionSourceOverride } from '@/features/auth/e2e-auth-session';
import { photoPickerAdapter } from '@/features/platform/photo-picker-adapter';
import { useTranslation } from '@/localization';
import { analyzeMealPhoto, PhotoAnalysisSourceError } from './meal-photo-analysis-source';
import {
  mapMacroEstimateToMealInput,
  normalizePhotoAnalysisError,
  type MacroEstimate,
  type PhotoAnalysisErrorReason,
} from './meal-photo-analysis.logic';
import type { CustomMealInput } from './custom-meal.logic';

const E2E_MEAL_ANALYSIS_ESTIMATE: MacroEstimate = {
  calories: 520,
  carbs: 45,
  proteins: 38,
  fats: 16,
  totalGrams: 350,
  confidence: 'high',
};

function getE2EMealAnalysisEstimate(): MacroEstimate | null {
  const override = resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });

  if (!override || process.env.EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE !== 'success') {
    return null;
  }

  return E2E_MEAL_ANALYSIS_ESTIMATE;
}

// ─── State machine ────────────────────────────────────────────────────────────

export type PhotoAnalysisState =
  | { kind: 'idle' }
  | { kind: 'capturing' }                        // native camera/picker is open
  | { kind: 'compressing' }                      // client-side image compression
  | { kind: 'analyzing' }                        // awaiting server analyzer response
  | { kind: 'done'; estimate: MacroEstimate }    // result ready; fields pre-filled
  | { kind: 'error'; reason: PhotoAnalysisErrorReason };

// ─── Hook result ──────────────────────────────────────────────────────────────

export type UseMealPhotoAnalysisResult = {
  /** Current state of the analysis pipeline. */
  state: PhotoAnalysisState;
  /**
   * Initiates the full pipeline: opens an action sheet for camera or library,
   * compresses the selected image, and sends it to the server analyzer.
   * Sets state through capturing → compressing → analyzing → done | error.
   */
  startCapture: () => void;
  /**
   * Sends a base64-encoded JPEG image to the server analyzer for analysis.
   * Sets state to 'compressing' → 'analyzing' → 'done' | 'error'.
   * Exposed for direct injection in integration tests.
   */
  analyze: (base64Image: string) => Promise<void>;
  /**
   * Resets state to 'idle'. Call this to allow a new capture attempt.
   */
  reset: () => void;
  /**
   * Convenience helper: maps the latest MacroEstimate to CustomMealInput string fields.
   * Returns null when state is not 'done'.
   */
  preFillMealInput: () => Partial<CustomMealInput> | null;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMealPhotoAnalysis(user: AuthUser | null): UseMealPhotoAnalysisResult {
  const { t } = useTranslation();
  const [state, setState] = useState<PhotoAnalysisState>({ kind: 'idle' });
  const photoPickerCopy = useMemo(
    () => ({
      title: t('photo_picker.title'),
      body: t('photo_picker.body'),
      takePhoto: t('photo_picker.take_photo'),
      chooseFromLibrary: t('photo_picker.choose_from_library'),
      cancel: t('common.cta.cancel'),
    }),
    [t]
  );

  // ── Core analyze step (exposed for direct injection in tests) ──────────────
  const analyze = useCallback(
    async (base64Image: string): Promise<void> => {
      if (!user) {
        setState({ kind: 'error', reason: 'configuration' });
        return;
      }

      setState({ kind: 'analyzing' });

      try {
        const estimate = await analyzeMealPhoto(user, base64Image);
        setState({ kind: 'done', estimate });
      } catch (err: unknown) {
        // Prefer the strongly-typed code from PhotoAnalysisSourceError directly;
        // fall back to normalizePhotoAnalysisError for unexpected error shapes.
        const reason: PhotoAnalysisErrorReason =
          err instanceof PhotoAnalysisSourceError
            ? err.code
            : normalizePhotoAnalysisError(err);
        setState({ kind: 'error', reason });
      }
    },
    [user]
  );

  // ── Full pipeline: pick → compress → analyze ───────────────────────────────
  const startCapture = useCallback(() => {
    const e2eEstimate = getE2EMealAnalysisEstimate();
    if (e2eEstimate) {
      setState({ kind: 'done', estimate: e2eEstimate });
      return;
    }

    void (async () => {
      setState({ kind: 'capturing' });
      try {
        const photo = await photoPickerAdapter.pickPhoto(photoPickerCopy);
        if (!photo) {
          setState({ kind: 'idle' });
          return;
        }
        setState({ kind: 'compressing' });
        await analyze(await photoPickerAdapter.compressToBase64(photo));
      } catch (err: unknown) {
        setState({ kind: 'error', reason: normalizePhotoAnalysisError(err) });
      }
    })();
  }, [analyze, photoPickerCopy]);

  const reset = useCallback(() => {
    setState({ kind: 'idle' });
  }, []);

  const preFillMealInput = useCallback((): Partial<CustomMealInput> | null => {
    if (state.kind !== 'done') return null;
    return mapMacroEstimateToMealInput(state.estimate);
  }, [state]);

  return { state, startCapture, analyze, reset, preFillMealInput };
}

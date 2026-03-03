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

import { Alert } from 'react-native';
import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import type { User } from 'firebase/auth';

import { analyzeMealPhoto, PhotoAnalysisSourceError } from './meal-photo-analysis-source';
import {
  mapMacroEstimateToMealInput,
  normalizePhotoAnalysisError,
  type MacroEstimate,
  type PhotoAnalysisErrorReason,
} from './meal-photo-analysis.logic';
import type { CustomMealInput } from './custom-meal.logic';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum longest-side pixel dimension before resize (FR-230, BR-287, Q-022). */
const MAX_DIMENSION_PX = 1600;

/** JPEG compression quality (0–1). Targets ≤ 1.5 MB for typical meal photos. */
const JPEG_QUALITY = 0.75;

// ─── State machine ────────────────────────────────────────────────────────────

export type PhotoAnalysisState =
  | { kind: 'idle' }
  | { kind: 'capturing' }                        // native camera/picker is open
  | { kind: 'compressing' }                      // client-side image compression
  | { kind: 'analyzing' }                        // awaiting Cloud Function response
  | { kind: 'done'; estimate: MacroEstimate }    // result ready; fields pre-filled
  | { kind: 'error'; reason: PhotoAnalysisErrorReason };

// ─── Hook result ──────────────────────────────────────────────────────────────

export type UseMealPhotoAnalysisResult = {
  /** Current state of the analysis pipeline. */
  state: PhotoAnalysisState;
  /**
   * Initiates the full pipeline: opens an action sheet for camera or library,
   * compresses the selected image, and sends it to the Cloud Function.
   * Sets state through capturing → compressing → analyzing → done | error.
   */
  startCapture: () => void;
  /**
   * Sends a base64-encoded JPEG image to the Cloud Function proxy for analysis.
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

// ─── Compression helper ───────────────────────────────────────────────────────

/**
 * Resizes and compresses a local image URI to meet upload constraints.
 * Returns a base64-encoded JPEG string (without the data URI prefix).
 * FR-230, BR-287: ≤ 1.5 MB, ≤ 1600 px longest side.
 */
async function compressImageUri(uri: string, width: number, height: number): Promise<string> {
  const longestSide = Math.max(width, height);
  const actions: ImageManipulator.Action[] = [];

  if (longestSide > MAX_DIMENSION_PX) {
    const scale = MAX_DIMENSION_PX / longestSide;
    actions.push({
      resize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });
  }

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  if (!result.base64) {
    throw new Error('Image compression returned no base64 data.');
  }

  return result.base64;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMealPhotoAnalysis(user: User | null): UseMealPhotoAnalysisResult {
  const [state, setState] = useState<PhotoAnalysisState>({ kind: 'idle' });

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
    /**
     * Present an action sheet so the user can choose camera or photo library.
     * The entire async pipeline runs inside the callback — state transitions
     * flow through 'capturing' → 'compressing' → 'analyzing' → 'done' | 'error'.
     */
    Alert.alert(
      'Analyze Meal',
      'Choose a photo source',
      [
        {
          text: 'Take Photo',
          onPress: async () => {
            setState({ kind: 'capturing' });

            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
              setState({ kind: 'error', reason: 'configuration' });
              return;
            }

            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              quality: 1,
              base64: false, // we compress manually to control quality/size
            });

            if (result.canceled || !result.assets[0]) {
              setState({ kind: 'idle' });
              return;
            }

            const asset = result.assets[0];
            setState({ kind: 'compressing' });

            try {
              const base64 = await compressImageUri(
                asset.uri,
                asset.width ?? MAX_DIMENSION_PX,
                asset.height ?? MAX_DIMENSION_PX
              );
              await analyze(base64);
            } catch {
              setState({ kind: 'error', reason: 'unknown' });
            }
          },
        },
        {
          text: 'Choose from Library',
          onPress: async () => {
            setState({ kind: 'capturing' });

            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
              setState({ kind: 'error', reason: 'configuration' });
              return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: 'images',
              quality: 1,
              base64: false,
            });

            if (result.canceled || !result.assets[0]) {
              setState({ kind: 'idle' });
              return;
            }

            const asset = result.assets[0];
            setState({ kind: 'compressing' });

            try {
              const base64 = await compressImageUri(
                asset.uri,
                asset.width ?? MAX_DIMENSION_PX,
                asset.height ?? MAX_DIMENSION_PX
              );
              await analyze(base64);
            } catch {
              setState({ kind: 'error', reason: 'unknown' });
            }
          },
        },
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            // Return to idle without state change if we haven't started yet
            setState((prev) => (prev.kind === 'idle' ? prev : { kind: 'idle' }));
          },
        },
      ],
      { cancelable: true, onDismiss: () => setState((prev) => (prev.kind === 'idle' ? prev : { kind: 'idle' })) }
    );
  }, [analyze]);

  const reset = useCallback(() => {
    setState({ kind: 'idle' });
  }, []);

  const preFillMealInput = useCallback((): Partial<CustomMealInput> | null => {
    if (state.kind !== 'done') return null;
    return mapMacroEstimateToMealInput(state.estimate);
  }, [state]);

  return { state, startCapture, analyze, reset, preFillMealInput };
}

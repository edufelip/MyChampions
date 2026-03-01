/**
 * React hook for AI meal photo macronutrient analysis.
 * Manages the full capture → compress → analyze state machine.
 * Camera capture and image compression are currently stubs — see pending-wiring-checklist-v1.md.
 * Refs: BL-108, D-106–D-110, FR-229–FR-239
 */

import { useCallback, useState } from 'react';
import type { User } from 'firebase/auth';

import { analyzeMealPhoto } from './meal-photo-analysis-source';
import {
  mapMacroEstimateToMealInput,
  normalizePhotoAnalysisError,
  type MacroEstimate,
  type PhotoAnalysisErrorReason,
} from './meal-photo-analysis.logic';
import type { CustomMealInput } from './custom-meal.logic';

// ─── State machine ────────────────────────────────────────────────────────────

export type PhotoAnalysisState =
  | { kind: 'idle' }
  | { kind: 'capturing' }                        // native camera/picker is open (stub)
  | { kind: 'compressing' }                      // client-side image compression (stub)
  | { kind: 'analyzing' }                        // awaiting Cloud Function response
  | { kind: 'done'; estimate: MacroEstimate }    // result ready; fields pre-filled
  | { kind: 'error'; reason: PhotoAnalysisErrorReason };

// ─── Hook result ──────────────────────────────────────────────────────────────

export type UseMealPhotoAnalysisResult = {
  /** Current state of the analysis pipeline. */
  state: PhotoAnalysisState;
  /**
   * Initiates camera capture (stub — sets state to 'capturing').
   * Real camera/picker wiring is deferred per pending-wiring-checklist-v1.md.
   * Call `analyze` directly with a pre-captured base64 image when ready.
   */
  startCapture: () => void;
  /**
   * Sends a base64-encoded JPEG image to the Cloud Function proxy for analysis.
   * Sets state to 'compressing' → 'analyzing' → 'done' | 'error'.
   * Image compression is currently a stub (no-op); real compression wiring is deferred.
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

export function useMealPhotoAnalysis(user: User | null): UseMealPhotoAnalysisResult {
  const [state, setState] = useState<PhotoAnalysisState>({ kind: 'idle' });

  const startCapture = useCallback(() => {
    // Stub: real camera/picker launch is deferred.
    // When the camera package is wired, this will open the native picker,
    // get the base64 result, and call analyze() internally.
    setState({ kind: 'capturing' });
  }, []);

  const analyze = useCallback(
    async (base64Image: string): Promise<void> => {
      if (!user) {
        setState({ kind: 'error', reason: 'configuration' });
        return;
      }

      // Compression step — currently a stub (no-op).
      // Real wiring: apply expo-image-manipulator here to enforce ≤1.5MB / ≤1600px (FR-230, BR-287).
      setState({ kind: 'compressing' });

      setState({ kind: 'analyzing' });

      try {
        const estimate = await analyzeMealPhoto(user, base64Image);
        setState({ kind: 'done', estimate });
      } catch (err: unknown) {
        const reason = normalizePhotoAnalysisError(err);
        setState({ kind: 'error', reason });
      }
    },
    [user]
  );

  const reset = useCallback(() => {
    setState({ kind: 'idle' });
  }, []);

  const preFillMealInput = useCallback((): Partial<CustomMealInput> | null => {
    if (state.kind !== 'done') return null;
    return mapMacroEstimateToMealInput(state.estimate);
  }, [state]);

  return { state, startCapture, analyze, reset, preFillMealInput };
}

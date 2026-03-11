import { useEffect, useState } from 'react';

import { getExerciseById } from './exercise-service-source';
import { logNetworkDebug } from '../debug/logging';

/**
 * Fetches a fresh thumbnail URL for an exercise by its stored ID.
 *
 * Why: upstream pre-signed URLs expire after 48 hours and must never be cached.
 * We store only the stable exercise ID in Firestore and re-fetch at display time.
 *
 * Returns `null` while loading or if no exerciseId is provided.
 * Silently falls back to `null` on API error (caller should show placeholder).
 */
export function useExerciseThumbnail(exerciseId: string | undefined): string | null {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!exerciseId) {
      // No linked exercise — ensure placeholder is shown immediately.
      setThumbnailUrl(null);
      return;
    }

    // Reset to null so the placeholder shows instantly while the fetch is
    // in-flight, rather than lingering with the previous exercise's thumbnail.
    setThumbnailUrl(null);

    let cancelled = false;

    getExerciseById(exerciseId)
      .then((exercise) => {
        if (!cancelled && exercise?.thumbnailUrl) {
          logNetworkDebug('useExerciseThumbnail', 'Thumbnail fetched.', { exerciseId });
          setThumbnailUrl(exercise.thumbnailUrl);
          return;
        }
        logNetworkDebug('useExerciseThumbnail', 'Thumbnail unavailable; using placeholder.', { exerciseId });
      })
      .catch((error) => {
        console.error('[useExerciseThumbnail] Thumbnail fetch failed:', {
          exerciseId,
          message: (error as Error)?.message ?? String(error),
        });
        // Silently degrade — the placeholder icon will be shown.
      });

    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  return thumbnailUrl;
}

import { useEffect, useState } from 'react';

import { getYMoveExerciseById } from './ymove-source';

/**
 * Fetches a fresh thumbnail URL for a YMove exercise by its stored ID.
 *
 * Why: YMove pre-signed URLs expire after 48 hours and must never be cached.
 * We store only the `ymoveId` in Firestore and re-fetch the URL at display time.
 *
 * Returns `null` while loading or if no ymoveId is provided.
 * Silently falls back to `null` on API error (caller should show placeholder).
 */
export function useYMoveThumbnail(ymoveId: string | undefined): string | null {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!ymoveId) {
      // No YMove exercise linked — ensure placeholder is shown immediately.
      setThumbnailUrl(null);
      return;
    }

    // Reset to null so the placeholder shows instantly while the fetch is
    // in-flight, rather than lingering with the previous exercise's thumbnail.
    setThumbnailUrl(null);

    let cancelled = false;

    getYMoveExerciseById(ymoveId)
      .then((exercise) => {
        if (!cancelled && exercise?.thumbnailUrl) {
          setThumbnailUrl(exercise.thumbnailUrl);
        }
      })
      .catch(() => {
        // Silently degrade — the placeholder icon will be shown.
      });

    return () => {
      cancelled = true;
    };
  }, [ymoveId]);

  return thumbnailUrl;
}

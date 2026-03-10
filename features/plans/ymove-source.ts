/**
 * Direct client-side integration with the YMove Exercise API.
 * WARNING: Uses an EXPO_PUBLIC key embedded in the binary.
 *
 * Docs: https://ymove.app/exercise-api/docs
 *
 * IMPORTANT — Video URL caching policy (per API contract):
 *   Video/thumbnail URLs are pre-signed CDN URLs that expire after 48 hours.
 *   They must NEVER be stored in Firestore or any persistent cache.
 *   Always fetch fresh exercise data from the API before displaying videos.
 *   Store only `ymoveId` (UUID) in Firestore; re-fetch URLs on demand.
 */

const API_BASE_URL = 'https://exercise-api.ymove.app/api/v2';

/** A single video variant returned by the API (white-background or gym-shot). */
export type YMoveVideo = {
  videoUrl?: string;
  videoHlsUrl?: string;
  thumbnailUrl?: string;
  tag: 'white-background' | 'gym-shot';
  orientation?: 'landscape' | 'portrait';
  isPrimary: boolean;
};

/**
 * Full exercise object as returned by the YMove v2 API.
 * All URL fields (videoUrl, videoHlsUrl, thumbnailUrl) are pre-signed and expire
 * after 48 hours. Do NOT persist them to Firestore.
 */
export type YMoveExercise = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  /** Step-by-step instructions. The API returns an array of strings. */
  instructions?: string[] | null;
  importantPoints?: string[] | null;
  muscleGroup: string;
  secondaryMuscles?: string[] | null;
  equipment: string;
  category?: string | null;
  difficulty?: string | null;
  /** exerciseType can be multiple values (e.g. ["strength", "core"]). */
  exerciseType?: string[] | null;
  hasVideo: boolean;
  hasVideoWhite: boolean;
  hasVideoGym: boolean;
  /** All video variants for this exercise. */
  videos: YMoveVideo[];
  /** Pre-signed URL for the primary video. Expires after 48 hours. */
  videoUrl?: string | null;
  /** Pre-signed HLS playlist URL. Expires after 48 hours. */
  videoHlsUrl?: string | null;
  /** Pre-signed thumbnail URL. Expires after 48 hours. */
  thumbnailUrl?: string | null;
  videoDurationSecs?: number | null;
};

export type YMoveSearchResponse = {
  data: YMoveExercise[];
  /** v2 pagination shape from the API. */
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  _warning?: {
    reason: 'monthly_exercise_cap';
    message: string;
    monthlyExercisesUsed: number;
    monthlyExerciseLimit: number;
    upgradeUrl: string;
  };
};

export type YMoveSearchResult = {
  exercises: YMoveExercise[];
  /**
   * Present when the monthly exercise cap is exceeded.
   * New exercises in this response have their video/thumbnail URLs stripped.
   * Previously accessed exercises within the 30-day window retain their URLs.
   */
  capWarning?: YMoveSearchResponse['_warning'];
};

export async function searchYMoveExercises(query: string, pageSize = 20): Promise<YMoveSearchResult> {
  const apiKey = process.env.EXPO_PUBLIC_YMOVE_API_KEY;

  if (!apiKey) {
    console.warn('[ymove] EXPO_PUBLIC_YMOVE_API_KEY is missing. Search will fail.');
    return { exercises: [] };
  }

  // Trim once — used in both the guard and the URL.
  const trimmedQuery = query.trim();

  // Build query string — the v2 API uses `pageSize`, not `limit`.
  let url = `${API_BASE_URL}/exercises?pageSize=${pageSize}`;
  if (trimmedQuery) {
    url += `&search=${encodeURIComponent(trimmedQuery)}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[ymove] API error:', response.status, text);
      throw new Error(`YMove API returned ${response.status}`);
    }

    const json = (await response.json()) as YMoveSearchResponse;

    if (json._warning) {
      console.warn(
        '[ymove] Monthly exercise cap reached:',
        `${json._warning.monthlyExercisesUsed}/${json._warning.monthlyExerciseLimit} exercises used.`,
        `Upgrade at: ${json._warning.upgradeUrl}`
      );
    }

    return { exercises: json.data ?? [], capWarning: json._warning };
  } catch (error) {
    console.error('[ymove] Network or parsing error:', error);
    throw error;
  }
}

/**
 * Fetch a single exercise by its YMove UUID.
 * Use this to get fresh pre-signed URLs for display — never cache the returned URLs.
 */
export async function getYMoveExerciseById(id: string): Promise<YMoveExercise | null> {
  if (!id?.trim()) return null;

  const apiKey = process.env.EXPO_PUBLIC_YMOVE_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/exercises/${id}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`YMove API returned ${response.status}`);
    }

    const json = (await response.json()) as { data: YMoveExercise; _warning?: YMoveSearchResponse['_warning'] };
    return json.data;
  } catch (error) {
    console.error(`[ymove] Error fetching exercise ${id}:`, error);
    return null;
  }
}

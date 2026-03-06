/**
 * Direct client-side integration with the YMove Exercise API.
 * WARNING: Uses an EXPO_PUBLIC key embedded in the binary.
 *
 * Docs: https://ymove.app/exercise-api/docs
 */

const API_BASE_URL = 'https://exercise-api.ymove.app/api/v2';

export type YMoveExercise = {
  id: string;
  slug: string;
  title: string;
  instructions: string;
  muscleGroup?: string;
  exerciseType?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  videoDurationSecs?: number;
};

export type YMoveSearchResponse = {
  data: YMoveExercise[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
};

export async function searchYMoveExercises(query: string, limit = 20): Promise<YMoveExercise[]> {
  const apiKey = process.env.EXPO_PUBLIC_YMOVE_API_KEY;

  if (!apiKey) {
    console.warn('[ymove] EXPO_PUBLIC_YMOVE_API_KEY is missing. Search will fail.');
    return [];
  }

  // Build query string.
  let url = `${API_BASE_URL}/exercises?limit=${limit}`;
  if (query.trim()) {
    url += `&search=${encodeURIComponent(query.trim())}`;
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
    return json.data || [];
  } catch (error) {
    console.error('[ymove] Network or parsing error:', error);
    throw error;
  }
}

export async function getYMoveExerciseById(id: string): Promise<YMoveExercise | null> {
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

    const json = (await response.json()) as { data: YMoveExercise };
    return json.data;
  } catch (error) {
    console.error(`[ymove] Error fetching exercise ${id}:`, error);
    return null;
  }
}

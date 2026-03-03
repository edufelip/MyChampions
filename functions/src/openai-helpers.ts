/**
 * Pure OpenAI GPT-4o Vision helpers for meal photo macro analysis.
 * Extracted from analyzeMealPhoto Cloud Function for unit-testability.
 *
 * All functions accept an injectable fetchFn so tests mock network calls
 * without spinning up a real HTTP server.
 * Refs: D-106–D-110, BL-108, FR-229–FR-239, TC-284
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type MacroEstimateConfidence = 'high' | 'medium' | 'low';

export type MacroEstimateResult = {
  calories: number;
  carbs: number;
  proteins: number;
  fats: number;
  totalGrams: number;
  confidence: MacroEstimateConfidence;
};

export type OpenAIErrorKind =
  | 'unrecognizable_image'
  | 'quota_exceeded'
  | 'invalid_response'
  | 'unknown';

export class OpenAIHelperError extends Error {
  kind: OpenAIErrorKind;
  constructor(kind: OpenAIErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'OpenAIHelperError';
  }
}

// ─── Deps injection ───────────────────────────────────────────────────────────

export type OpenAIHelpersDeps = {
  fetchFn: typeof fetch;
};

export const defaultOpenAIDeps: OpenAIHelpersDeps = {
  fetchFn: fetch,
};

// ─── Prompts (mirrors meal-photo-analysis.logic.ts client-side prompts) ───────

export const SYSTEM_PROMPT =
  'You are a professional nutritionist. ' +
  'Given a photo of a meal, estimate the macronutrients with high accuracy. ' +
  'Respond ONLY with valid JSON matching this exact shape: ' +
  '{ "calories": number, "carbs": number, "proteins": number, "fats": number, ' +
  '"totalGrams": number, "confidence": "high" | "medium" | "low" }. ' +
  'All values must be non-negative numbers. totalGrams must be positive. ' +
  'If the image does not contain a recognizable meal, respond: { "error": "unrecognizable_image" }.';

export const USER_PROMPT = 'Analyze this meal photo and estimate its macronutrients.';

// ─── OpenAI call ──────────────────────────────────────────────────────────────

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

/**
 * Calls OpenAI GPT-4o Vision with a base64 JPEG image and returns a
 * MacroEstimateResult on success.
 *
 * Throws OpenAIHelperError with typed kind on all failure paths:
 *  - 'quota_exceeded'       : HTTP 429 or OpenAI quota error
 *  - 'unrecognizable_image' : model responded with { "error": "unrecognizable_image" }
 *  - 'invalid_response'     : model output could not be parsed / failed validation
 *  - 'unknown'              : any other OpenAI API error or non-OK HTTP status
 *
 * @param apiKey      OpenAI API key (from Cloud Function secret)
 * @param base64Image JPEG image encoded as base64 string (no data-URI prefix)
 * @param deps        Injectable deps; omit in production
 */
export async function callOpenAIVision(
  apiKey: string,
  base64Image: string,
  deps: OpenAIHelpersDeps = defaultOpenAIDeps
): Promise<MacroEstimateResult> {
  const requestBody = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: USER_PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' },
          },
        ],
      },
    ],
    max_tokens: 256,
    temperature: 0,
  };

  let response: Response;
  try {
    response = await deps.fetchFn(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new OpenAIHelperError('unknown', `OpenAI request failed: ${String(err)}`);
  }

  // Rate-limit / quota exhausted
  if (response.status === 429) {
    throw new OpenAIHelperError('quota_exceeded', 'OpenAI rate limit or quota exceeded.');
  }

  if (!response.ok) {
    throw new OpenAIHelperError('unknown', `OpenAI API returned HTTP ${response.status}`);
  }

  // Parse OpenAI chat completion envelope
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new OpenAIHelperError('invalid_response', 'OpenAI returned non-JSON body.');
  }

  const content = extractContent(envelope);
  if (!content) {
    throw new OpenAIHelperError('invalid_response', 'OpenAI response had no content.');
  }

  return parseModelContent(content);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Extracts the first choice's message content from an OpenAI chat completion. */
function extractContent(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== 'object') return null;
  const choices = (envelope as Record<string, unknown>)['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as Record<string, unknown>)['message'];
  if (!msg || typeof msg !== 'object') return null;
  const content = (msg as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : null;
}

/**
 * Parses the model's raw text content (expected JSON) into a MacroEstimateResult.
 * Handles markdown code-fence wrapping that the model sometimes adds.
 * Throws OpenAIHelperError on any parse or validation failure.
 */
export function parseModelContent(content: string): MacroEstimateResult {
  // Strip optional markdown code fences: ```json ... ``` or ``` ... ```
  const stripped = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new OpenAIHelperError(
      'invalid_response',
      `Model output was not valid JSON: ${stripped.slice(0, 100)}`
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new OpenAIHelperError('invalid_response', 'Model output was not a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;

  // Model signalled that the image is not a recognisable meal
  if (obj['error'] === 'unrecognizable_image') {
    throw new OpenAIHelperError('unrecognizable_image', 'Image does not contain a recognizable meal.');
  }

  const calories = toNonNegNumber(obj['calories'], 'calories');
  const carbs = toNonNegNumber(obj['carbs'], 'carbs');
  const proteins = toNonNegNumber(obj['proteins'], 'proteins');
  const fats = toNonNegNumber(obj['fats'], 'fats');
  const totalGrams = toPosNumber(obj['totalGrams'], 'totalGrams');
  const confidence = parseConfidence(obj['confidence']);

  return { calories, carbs, proteins, fats, totalGrams, confidence };
}

function toNonNegNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new OpenAIHelperError(
      'invalid_response',
      `Field "${field}" must be a non-negative number, got: ${String(value)}`
    );
  }
  return Math.round(value * 10) / 10;
}

function toPosNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new OpenAIHelperError(
      'invalid_response',
      `Field "${field}" must be a positive number, got: ${String(value)}`
    );
  }
  return Math.round(value * 10) / 10;
}

function parseConfidence(value: unknown): MacroEstimateConfidence {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'low';
}

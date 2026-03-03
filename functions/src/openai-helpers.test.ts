/**
 * Unit tests for openai-helpers.ts
 * Runner: node:test + node:assert/strict
 *   npm test (inside functions/)
 *
 * All OpenAI network calls are mocked via the injectable fetchFn.
 * No real HTTP requests are made.
 * Refs: D-106–D-110, BL-108, TC-284
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  callOpenAIVision,
  parseModelContent,
  OpenAIHelperError,
  SYSTEM_PROMPT,
  USER_PROMPT,
  type OpenAIHelpersDeps,
} from './openai-helpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Builds a minimal OpenAI chat completion envelope wrapping a content string. */
function makeOpenAIEnvelope(content: string): unknown {
  return {
    choices: [{ message: { role: 'assistant', content } }],
  };
}

const VALID_ESTIMATE_JSON = JSON.stringify({
  calories: 450,
  carbs: 55,
  proteins: 30,
  fats: 12,
  totalGrams: 350,
  confidence: 'high',
});

function makeDeps(content: string, status = 200): OpenAIHelpersDeps {
  return {
    fetchFn: async () => makeResponse(status, makeOpenAIEnvelope(content)),
  };
}

// ─── OpenAIHelperError ────────────────────────────────────────────────────────

describe('OpenAIHelperError', () => {
  it('sets kind and name correctly', () => {
    const err = new OpenAIHelperError('quota_exceeded', 'too many');
    assert.equal(err.kind, 'quota_exceeded');
    assert.equal(err.name, 'OpenAIHelperError');
    assert.ok(err instanceof Error);
  });

  it('works for every valid kind', () => {
    const kinds = ['unrecognizable_image', 'quota_exceeded', 'invalid_response', 'unknown'] as const;
    for (const kind of kinds) {
      assert.equal(new OpenAIHelperError(kind, 'x').kind, kind);
    }
  });
});

// ─── parseModelContent ────────────────────────────────────────────────────────

describe('parseModelContent', () => {
  it('parses a clean JSON string into a MacroEstimateResult', () => {
    const result = parseModelContent(VALID_ESTIMATE_JSON);
    assert.equal(result.calories, 450);
    assert.equal(result.carbs, 55);
    assert.equal(result.proteins, 30);
    assert.equal(result.fats, 12);
    assert.equal(result.totalGrams, 350);
    assert.equal(result.confidence, 'high');
  });

  it('strips markdown code fence ```json ... ```', () => {
    const fenced = '```json\n' + VALID_ESTIMATE_JSON + '\n```';
    const result = parseModelContent(fenced);
    assert.equal(result.calories, 450);
  });

  it('strips plain code fence ``` ... ```', () => {
    const fenced = '```\n' + VALID_ESTIMATE_JSON + '\n```';
    const result = parseModelContent(fenced);
    assert.equal(result.calories, 450);
  });

  it('rounds macro values to 1 decimal place', () => {
    const json = JSON.stringify({
      calories: 333.333,
      carbs: 11.11,
      proteins: 22.22,
      fats: 5.55,
      totalGrams: 200.5,
      confidence: 'medium',
    });
    const result = parseModelContent(json);
    assert.equal(result.calories, 333.3);
    assert.equal(result.carbs, 11.1);
    assert.equal(result.proteins, 22.2);
    assert.equal(result.fats, 5.6); // 5.55 rounds to 5.6
    assert.equal(result.totalGrams, 200.5);
  });

  it('defaults confidence to "low" for unknown values', () => {
    const json = JSON.stringify({
      calories: 100, carbs: 10, proteins: 5, fats: 3, totalGrams: 150, confidence: 'very_high',
    });
    const result = parseModelContent(json);
    assert.equal(result.confidence, 'low');
  });

  it('defaults confidence to "low" when confidence field is missing', () => {
    const json = JSON.stringify({
      calories: 100, carbs: 10, proteins: 5, fats: 3, totalGrams: 150,
    });
    const result = parseModelContent(json);
    assert.equal(result.confidence, 'low');
  });

  it('throws unrecognizable_image when model returns error sentinel', () => {
    assert.throws(
      () => parseModelContent(JSON.stringify({ error: 'unrecognizable_image' })),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'unrecognizable_image');
        return true;
      }
    );
  });

  it('throws invalid_response for non-JSON content', () => {
    assert.throws(
      () => parseModelContent('This is not JSON at all.'),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        return true;
      }
    );
  });

  it('throws invalid_response when calories is negative', () => {
    const json = JSON.stringify({
      calories: -10, carbs: 10, proteins: 5, fats: 3, totalGrams: 150, confidence: 'high',
    });
    assert.throws(
      () => parseModelContent(json),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        assert.ok(err.message.includes('calories'));
        return true;
      }
    );
  });

  it('throws invalid_response when totalGrams is 0', () => {
    const json = JSON.stringify({
      calories: 100, carbs: 10, proteins: 5, fats: 3, totalGrams: 0, confidence: 'high',
    });
    assert.throws(
      () => parseModelContent(json),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        assert.ok(err.message.includes('totalGrams'));
        return true;
      }
    );
  });

  it('throws invalid_response when totalGrams is negative', () => {
    const json = JSON.stringify({
      calories: 100, carbs: 10, proteins: 5, fats: 3, totalGrams: -50, confidence: 'high',
    });
    assert.throws(
      () => parseModelContent(json),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        return true;
      }
    );
  });

  it('throws invalid_response when a required field is missing', () => {
    const json = JSON.stringify({ calories: 100, carbs: 10, proteins: 5, totalGrams: 150 }); // fats missing
    assert.throws(
      () => parseModelContent(json),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        return true;
      }
    );
  });

  it('throws invalid_response when content is a JSON array (not object)', () => {
    assert.throws(
      () => parseModelContent('[1, 2, 3]'),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        return true;
      }
    );
  });

  it('accepts zero calories (valid — fasting day edge case)', () => {
    const json = JSON.stringify({
      calories: 0, carbs: 0, proteins: 0, fats: 0, totalGrams: 10, confidence: 'low',
    });
    const result = parseModelContent(json);
    assert.equal(result.calories, 0);
    assert.equal(result.totalGrams, 10);
  });
});

// ─── callOpenAIVision — HTTP error paths ─────────────────────────────────────

describe('callOpenAIVision — HTTP error paths', () => {
  it('throws quota_exceeded on HTTP 429', async () => {
    const deps: OpenAIHelpersDeps = {
      fetchFn: async () => makeResponse(429, {}, false),
    };
    await assert.rejects(
      () => callOpenAIVision('key', 'base64img', deps),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'quota_exceeded');
        return true;
      }
    );
  });

  it('throws unknown on any other non-OK HTTP status (e.g. 500)', async () => {
    const deps: OpenAIHelpersDeps = {
      fetchFn: async () => makeResponse(500, {}, false),
    };
    await assert.rejects(
      () => callOpenAIVision('key', 'base64img', deps),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'unknown');
        assert.ok(err.message.includes('500'));
        return true;
      }
    );
  });

  it('throws unknown when fetch itself rejects (network failure)', async () => {
    const deps: OpenAIHelpersDeps = {
      fetchFn: async () => { throw new Error('no internet'); },
    };
    await assert.rejects(
      () => callOpenAIVision('key', 'base64img', deps),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'unknown');
        return true;
      }
    );
  });

  it('throws invalid_response when response body is not JSON', async () => {
    const deps: OpenAIHelpersDeps = {
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('bad json'); },
      } as unknown as Response),
    };
    await assert.rejects(
      () => callOpenAIVision('key', 'base64img', deps),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        return true;
      }
    );
  });

  it('throws invalid_response when choices array is empty', async () => {
    const deps: OpenAIHelpersDeps = {
      fetchFn: async () => makeResponse(200, { choices: [] }),
    };
    await assert.rejects(
      () => callOpenAIVision('key', 'base64img', deps),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        return true;
      }
    );
  });

  it('throws invalid_response when content is missing from message', async () => {
    const deps: OpenAIHelpersDeps = {
      fetchFn: async () => makeResponse(200, { choices: [{ message: { role: 'assistant' } }] }),
    };
    await assert.rejects(
      () => callOpenAIVision('key', 'base64img', deps),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        return true;
      }
    );
  });
});

// ─── callOpenAIVision — domain error paths ────────────────────────────────────

describe('callOpenAIVision — domain error paths', () => {
  it('throws unrecognizable_image when model returns error sentinel', async () => {
    const deps = makeDeps(JSON.stringify({ error: 'unrecognizable_image' }));
    await assert.rejects(
      () => callOpenAIVision('key', 'base64img', deps),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'unrecognizable_image');
        return true;
      }
    );
  });

  it('throws invalid_response when model output is malformed JSON', async () => {
    const deps = makeDeps('Here are your macros: lots!');
    await assert.rejects(
      () => callOpenAIVision('key', 'base64img', deps),
      (err: OpenAIHelperError) => {
        assert.equal(err.kind, 'invalid_response');
        return true;
      }
    );
  });
});

// ─── callOpenAIVision — happy paths ──────────────────────────────────────────

describe('callOpenAIVision — happy paths', () => {
  it('returns a MacroEstimateResult on success', async () => {
    const deps = makeDeps(VALID_ESTIMATE_JSON);
    const result = await callOpenAIVision('key', 'base64img', deps);
    assert.equal(result.calories, 450);
    assert.equal(result.carbs, 55);
    assert.equal(result.proteins, 30);
    assert.equal(result.fats, 12);
    assert.equal(result.totalGrams, 350);
    assert.equal(result.confidence, 'high');
  });

  it('passes Bearer API key in Authorization header', async () => {
    let capturedAuth = '';
    const deps: OpenAIHelpersDeps = {
      fetchFn: async (_url, init) => {
        capturedAuth = (init?.headers as Record<string, string>)['Authorization'] ?? '';
        return makeResponse(200, makeOpenAIEnvelope(VALID_ESTIMATE_JSON));
      },
    };
    await callOpenAIVision('my-secret-key', 'img', deps);
    assert.equal(capturedAuth, 'Bearer my-secret-key');
  });

  it('embeds the base64 image as a data URI in the request body', async () => {
    let capturedBody: unknown;
    const deps: OpenAIHelpersDeps = {
      fetchFn: async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeResponse(200, makeOpenAIEnvelope(VALID_ESTIMATE_JSON));
      },
    };
    await callOpenAIVision('key', 'abc123base64', deps);
    const messages = (capturedBody as { messages: unknown[] }).messages;
    const userMsg = messages[1] as { content: { type: string; image_url?: { url: string } }[] };
    const imageContent = userMsg.content.find((c) => c.type === 'image_url');
    assert.ok(imageContent?.image_url?.url.includes('abc123base64'));
    assert.ok(imageContent?.image_url?.url.startsWith('data:image/jpeg;base64,'));
  });

  it('parses model content wrapped in markdown code fence', async () => {
    const fenced = '```json\n' + VALID_ESTIMATE_JSON + '\n```';
    const deps = makeDeps(fenced);
    const result = await callOpenAIVision('key', 'img', deps);
    assert.equal(result.calories, 450);
  });
});

// ─── Prompt constants ─────────────────────────────────────────────────────────

describe('Prompt constants', () => {
  it('SYSTEM_PROMPT is non-empty and mentions JSON', () => {
    assert.ok(SYSTEM_PROMPT.length > 0);
    assert.ok(SYSTEM_PROMPT.includes('JSON'));
  });

  it('SYSTEM_PROMPT instructs model to return unrecognizable_image error', () => {
    assert.ok(SYSTEM_PROMPT.includes('unrecognizable_image'));
  });

  it('SYSTEM_PROMPT mentions all macro fields', () => {
    assert.ok(SYSTEM_PROMPT.includes('calories'));
    assert.ok(SYSTEM_PROMPT.includes('carbs'));
    assert.ok(SYSTEM_PROMPT.includes('proteins'));
    assert.ok(SYSTEM_PROMPT.includes('fats'));
    assert.ok(SYSTEM_PROMPT.includes('totalGrams'));
  });

  it('USER_PROMPT is non-empty', () => {
    assert.ok(USER_PROMPT.length > 0);
  });
});

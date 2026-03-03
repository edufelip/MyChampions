/**
 * Unit tests for meal-photo-analysis-source.ts
 * Runner: node:test + node:assert/strict (npm run test:unit)
 *
 * All Firebase and fetch dependencies are injected via MealPhotoAnalysisSourceDeps
 * so no real network calls or Firebase SDK are needed.
 * Refs: BL-108, D-106–D-110, TC-285
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeMealPhoto,
  PhotoAnalysisSourceError,
  type MealPhotoAnalysisSourceDeps,
} from './meal-photo-analysis-source';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal User-shaped object satisfying the type-only import. */
const fakeUser = {} as Parameters<typeof analyzeMealPhoto>[0];

/** Returns a deps object with all fields overridable. Default is a happy-path config. */
function makeDeps(overrides: Partial<MealPhotoAnalysisSourceDeps> = {}): MealPhotoAnalysisSourceDeps {
  return {
    getFunctionUrl: () => 'https://example.com/analyzeMealPhoto',
    getIdToken: async () => 'fake-id-token',
    fetchFn: async () => {
      throw new Error('fetchFn not configured in this test');
    },
    ...overrides,
  };
}

/** Builds a minimal Response-like object with a json() method. */
function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A valid MacroEstimate body returned by the Cloud Function. */
const validBody = {
  calories: 520,
  carbs: 60,
  proteins: 25,
  fats: 18,
  totalGrams: 350,
  confidence: 'high',
};

// ─── PhotoAnalysisSourceError ─────────────────────────────────────────────────

describe('PhotoAnalysisSourceError', () => {
  it('sets code, name, and message correctly', () => {
    const err = new PhotoAnalysisSourceError('network', 'test message');
    assert.equal(err.code, 'network');
    assert.equal(err.name, 'PhotoAnalysisSourceError');
    assert.equal(err.message, 'test message');
    assert.ok(err instanceof Error);
  });

  it('works for every valid PhotoAnalysisErrorReason code', () => {
    const codes = [
      'unrecognizable_image',
      'quota_exceeded',
      'network',
      'invalid_response',
      'configuration',
      'unauthenticated',
      'unknown',
    ] as const;
    for (const code of codes) {
      const err = new PhotoAnalysisSourceError(code, 'msg');
      assert.equal(err.code, code);
    }
  });
});

// ─── analyzeMealPhoto — configuration errors ──────────────────────────────────

describe('analyzeMealPhoto — configuration error', () => {
  it('throws configuration error when getFunctionUrl throws PhotoAnalysisSourceError', async () => {
    const deps = makeDeps({
      getFunctionUrl: () => {
        throw new PhotoAnalysisSourceError('configuration', 'URL not configured.');
      },
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });
});

// ─── analyzeMealPhoto — network errors ───────────────────────────────────────

describe('analyzeMealPhoto — network errors', () => {
  it('throws network error when getIdToken rejects', async () => {
    const deps = makeDeps({
      getIdToken: async () => { throw new Error('token expired'); },
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'network');
        assert.ok(err.message.includes('ID token'));
        return true;
      }
    );
  });

  it('throws network error when fetch itself rejects (no connectivity)', async () => {
    const deps = makeDeps({
      fetchFn: async () => { throw new TypeError('Network request failed'); },
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'network');
        assert.ok(err.message.includes('Network request'));
        return true;
      }
    );
  });

  it('always maps any fetch error to network regardless of error message content', async () => {
    const deps = makeDeps({
      fetchFn: async () => { throw new Error('something completely unrelated'); },
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'network');
        return true;
      }
    );
  });
});

// ─── analyzeMealPhoto — unauthenticated errors ────────────────────────────────

describe('analyzeMealPhoto — unauthenticated errors', () => {
  it('throws unauthenticated error on 401 response', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(401, { error: 'unauthenticated' }),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        return true;
      }
    );
  });

  it('throws unauthenticated error on 403 response (deleted user, etc.)', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(403, { error: 'forbidden' }),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        return true;
      }
    );
  });
});

// ─── analyzeMealPhoto — invalid_response errors ───────────────────────────────

describe('analyzeMealPhoto — invalid_response errors', () => {
  it('throws invalid_response when response body is not JSON', async () => {
    const deps = makeDeps({
      fetchFn: async () => ({
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token'); },
      } as unknown as Response),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'invalid_response');
        assert.ok(err.message.includes('non-JSON'));
        return true;
      }
    );
  });

  it('throws invalid_response when response body does not match MacroEstimate shape', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { something: 'unexpected' }),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'invalid_response');
        assert.ok(err.message.includes('macro estimate shape'));
        return true;
      }
    );
  });

  it('throws invalid_response when body has negative calories (invalid MacroEstimate)', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { ...validBody, calories: -10 }),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'invalid_response');
        return true;
      }
    );
  });
});

// ─── analyzeMealPhoto — domain errors ────────────────────────────────────────

describe('analyzeMealPhoto — domain errors', () => {
  it('throws unrecognizable_image when body.error is unrecognizable_image', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(400, { error: 'unrecognizable_image' }),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'unrecognizable_image');
        return true;
      }
    );
  });

  it('throws quota_exceeded when body.error is quota_exceeded', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(429, { error: 'quota_exceeded' }),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'quota_exceeded');
        return true;
      }
    );
  });

  it('throws quota_exceeded on 429 status even without body.error', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(429, {}),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'quota_exceeded');
        return true;
      }
    );
  });

  it('throws unknown on HTTP 500 with body.error present', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(500, { error: 'internal_error' }),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'unknown');
        assert.ok(err.message.includes('internal_error'));
        return true;
      }
    );
  });

  it('throws unknown on HTTP 503 with empty body', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(503, {}),
    });
    await assert.rejects(
      () => analyzeMealPhoto(fakeUser, 'base64data', deps),
      (err: PhotoAnalysisSourceError) => {
        assert.equal(err.code, 'unknown');
        return true;
      }
    );
  });
});

// ─── analyzeMealPhoto — happy paths ───────────────────────────────────────────

describe('analyzeMealPhoto — happy path', () => {
  it('returns a valid MacroEstimate on 200 success', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, validBody),
    });
    const result = await analyzeMealPhoto(fakeUser, 'base64data', deps);
    assert.equal(result.calories, 520);
    assert.equal(result.carbs, 60);
    assert.equal(result.proteins, 25);
    assert.equal(result.fats, 18);
    assert.equal(result.totalGrams, 350);
    assert.equal(result.confidence, 'high');
  });

  it('defaults confidence to low when Cloud Function omits the field', async () => {
    const { confidence: _omit, ...bodyWithoutConfidence } = validBody;
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, bodyWithoutConfidence),
    });
    const result = await analyzeMealPhoto(fakeUser, 'base64data', deps);
    assert.equal(result.confidence, 'low');
  });

  it('rounds macro values to 1 decimal place', async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        makeResponse(200, { ...validBody, calories: 520.567, carbs: 60.123 }),
    });
    const result = await analyzeMealPhoto(fakeUser, 'base64data', deps);
    assert.equal(result.calories, 520.6);
    assert.equal(result.carbs, 60.1);
  });

  it('sends the base64 image and id token in the request body / headers', async () => {
    let capturedUrl: string | URL | Request = '';
    let capturedInit: RequestInit | undefined;
    const deps = makeDeps({
      getIdToken: async () => 'my-token-xyz',
      fetchFn: async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return makeResponse(200, validBody);
      },
    });
    await analyzeMealPhoto(fakeUser, 'mybase64==', deps);
    assert.equal(capturedUrl, 'https://example.com/analyzeMealPhoto');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)['Authorization'],
      'Bearer my-token-xyz'
    );
    const parsedBody = JSON.parse(capturedInit?.body as string) as {
      image: string;
      mimeType: string;
    };
    assert.equal(parsedBody.image, 'mybase64==');
    assert.equal(parsedBody.mimeType, 'image/jpeg');
  });

  it('calls the configured function URL', async () => {
    let calledUrl: string | URL | Request = '';
    const deps = makeDeps({
      getFunctionUrl: () => 'https://cf2.example.com/analyzeMealPhoto',
      fetchFn: async (url, _init) => {
        calledUrl = url;
        return makeResponse(200, validBody);
      },
    });
    await analyzeMealPhoto(fakeUser, 'data', deps);
    assert.equal(calledUrl, 'https://cf2.example.com/analyzeMealPhoto');
  });
});

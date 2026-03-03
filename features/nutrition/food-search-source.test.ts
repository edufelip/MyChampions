/**
 * Unit tests for food-search-source.ts
 * Runner: node:test + node:assert/strict (npm run test:unit)
 *
 * All Firebase and fetch dependencies are injected via FoodSearchSourceDeps
 * so no real network calls or Firebase SDK are needed.
 * Refs: D-127, FR-243, TC-282
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  searchFoodsFromSource,
  FoodSearchSourceError,
  type FoodSearchSourceDeps,
} from './food-search-source';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal User-shaped object satisfying the type-only import. */
const fakeUser = {} as Parameters<typeof searchFoodsFromSource>[0];

/** Returns a deps object with all fields overridable. */
function makeDeps(overrides: Partial<FoodSearchSourceDeps> = {}): FoodSearchSourceDeps {
  return {
    getFunctionUrl: () => 'https://example.com/searchFoods',
    getIdToken: async () => 'fake-id-token',
    fetchFn: async () => {
      throw new Error('fetchFn not configured in this test');
    },
    ...overrides,
  };
}

/** Builds a minimal Response-like object. */
function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

// ─── FoodSearchSourceError ────────────────────────────────────────────────────

describe('FoodSearchSourceError', () => {
  it('sets code and name correctly', () => {
    const err = new FoodSearchSourceError('configuration', 'test message');
    assert.equal(err.code, 'configuration');
    assert.equal(err.name, 'FoodSearchSourceError');
    assert.equal(err.message, 'test message');
    assert.ok(err instanceof Error);
  });

  it('works for every valid error code', () => {
    const codes = ['configuration', 'network', 'unauthenticated', 'not_found', 'unknown'] as const;
    for (const code of codes) {
      const err = new FoodSearchSourceError(code, 'msg');
      assert.equal(err.code, code);
    }
  });
});

// ─── searchFoodsFromSource — error paths ──────────────────────────────────────

describe('searchFoodsFromSource — configuration error', () => {
  it('throws configuration error when function URL is not set', async () => {
    const deps = makeDeps({ getFunctionUrl: () => undefined });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'configuration');
        assert.ok(err.message.includes('EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL'));
        return true;
      }
    );
  });

  it('throws configuration error when function URL is empty string', async () => {
    const deps = makeDeps({ getFunctionUrl: () => '' });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });
});

describe('searchFoodsFromSource — network errors', () => {
  it('throws network error when getIdToken rejects', async () => {
    const deps = makeDeps({
      getIdToken: async () => { throw new Error('token expired'); },
    });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'network');
        assert.ok(err.message.includes('ID token'));
        return true;
      }
    );
  });

  it('throws network error when fetch itself rejects (no connectivity)', async () => {
    const deps = makeDeps({
      fetchFn: async () => { throw new Error('network unreachable'); },
    });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'network');
        assert.ok(err.message.includes('Network request'));
        return true;
      }
    );
  });
});

describe('searchFoodsFromSource — unauthenticated errors', () => {
  it('throws unauthenticated error on 401 response', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(401, { error: 'unauthenticated' }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        return true;
      }
    );
  });

  it('throws unauthenticated error on 403 response', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(403, { error: 'forbidden' }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        return true;
      }
    );
  });
});

describe('searchFoodsFromSource — unknown errors', () => {
  it('throws unknown error when response body is not JSON', async () => {
    const deps = makeDeps({
      fetchFn: async () => ({
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token'); },
      } as unknown as Response),
    });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unknown');
        assert.ok(err.message.includes('non-JSON'));
        return true;
      }
    );
  });

  it('throws unknown error when body.error is present', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { error: 'service_unavailable' }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unknown');
        assert.ok(err.message.includes('service_unavailable'));
        return true;
      }
    );
  });

  it('throws unknown error on HTTP 500 response', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(500, {}),
    });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unknown');
        assert.ok(err.message.includes('500'));
        return true;
      }
    );
  });

  it('throws unknown error on HTTP 503 response', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(503, {}),
    });
    await assert.rejects(
      () => searchFoodsFromSource(fakeUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unknown');
        return true;
      }
    );
  });
});

// ─── searchFoodsFromSource — happy paths ──────────────────────────────────────

describe('searchFoodsFromSource — happy path', () => {
  const validFood = {
    food_id: '41963',
    food_name: 'Cheeseburger',
    servings: {
      serving: {
        calories: '300',
        carbohydrate: '32.0',
        protein: '15.0',
        fat: '13.0',
        metric_serving_amount: '100.000',
        metric_serving_unit: 'g',
      },
    },
  };

  it('returns normalized FoodSearchResult array on success', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { results: [validFood] }),
    });
    const results = await searchFoodsFromSource(fakeUser, 'cheeseburger', deps);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, '41963');
    assert.equal(results[0]?.name, 'Cheeseburger');
    assert.equal(results[0]?.caloriesPer100g, 300);
  });

  it('returns empty array when results is an empty array', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { results: [] }),
    });
    const results = await searchFoodsFromSource(fakeUser, 'nothing', deps);
    assert.deepEqual(results, []);
  });

  it('returns empty array when results field is missing', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, {}),
    });
    const results = await searchFoodsFromSource(fakeUser, 'nothing', deps);
    assert.deepEqual(results, []);
  });

  it('filters out foods that cannot be normalized (no metric gram serving)', async () => {
    const invalidFood = {
      food_id: '99',
      food_name: 'Mystery',
      servings: {
        serving: {
          calories: '100',
          metric_serving_unit: 'oz', // non-gram — normalizeFoodSearchResult returns null
          metric_serving_amount: '28',
        },
      },
    };
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { results: [validFood, invalidFood] }),
    });
    const results = await searchFoodsFromSource(fakeUser, 'test', deps);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, '41963');
  });

  it('passes the query and idToken correctly in the fetch request', async () => {
    let capturedInit: RequestInit | undefined;
    const deps = makeDeps({
      getIdToken: async () => 'my-token-123',
      fetchFn: async (_url, init) => {
        capturedInit = init;
        return makeResponse(200, { results: [] });
      },
    });
    await searchFoodsFromSource(fakeUser, 'banana', deps);
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)['Authorization'],
      'Bearer my-token-123'
    );
    const parsedBody = JSON.parse(capturedInit?.body as string) as { query: string };
    assert.equal(parsedBody.query, 'banana');
  });

  it('calls the configured function URL', async () => {
    let calledUrl: string | URL | Request = '';
    const deps = makeDeps({
      getFunctionUrl: () => 'https://cf.example.com/searchFoods',
      fetchFn: async (url, _init) => {
        calledUrl = url;
        return makeResponse(200, { results: [] });
      },
    });
    await searchFoodsFromSource(fakeUser, 'rice', deps);
    assert.equal(calledUrl, 'https://cf.example.com/searchFoods');
  });
});

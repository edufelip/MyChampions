/**
 * Unit tests for food-search-source.ts
 * Runner: node:test + node:assert/strict (npm run test:unit)
 *
 * All fatsecret proxy and fetch dependencies are injected via FoodSearchSourceDeps.
 * Refs: D-113, D-127, FR-243, TC-282
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  searchFoodsFromSource,
  FoodSearchSourceError,
  type FoodSearchSourceDeps,
} from './food-search-source';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<FoodSearchSourceDeps> = {}): FoodSearchSourceDeps {
  return {
    getFunctionUrl: () => 'https://fake-proxy-url.com/searchFoods',
    fetchFn: async () => {
      throw new Error('fetchFn not configured');
    },
    ...overrides,
  };
}

function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const mockUser = {
  getIdToken: async () => 'fake-id-token',
};

// ─── FoodSearchSourceError ────────────────────────────────────────────────────

describe('FoodSearchSourceError', () => {
  it('sets code and name correctly', () => {
    const err = new FoodSearchSourceError('configuration', 'test message');
    assert.equal(err.code, 'configuration');
    assert.equal(err.name, 'FoodSearchSourceError');
    assert.equal(err.message, 'test message');
    assert.ok(err instanceof Error);
  });
});

// ─── searchFoodsFromSource — error paths ──────────────────────────────────────

describe('searchFoodsFromSource — configuration error', () => {
  it('throws configuration error when function URL is not set', async () => {
    const deps = makeDeps({ getFunctionUrl: () => undefined });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'configuration');
        assert.ok(err.message.includes('URL is not configured'));
        return true;
      }
    );
  });
});

describe('searchFoodsFromSource — auth errors', () => {
  it('throws unauthenticated error when user is not logged in', async () => {
    const deps = makeDeps();
    await assert.rejects(
      () => searchFoodsFromSource(null, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        assert.ok(err.message.includes('No active user'));
        return true;
      }
    );
  });

  it('throws unauthenticated error when getting ID token fails', async () => {
    const deps = makeDeps();
    const badUser = {
      getIdToken: async () => { throw new Error('token err'); },
    };
    await assert.rejects(
      () => searchFoodsFromSource(badUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        assert.ok(err.message.includes('Failed to retrieve Firebase ID token'));
        return true;
      }
    );
  });
});

describe('searchFoodsFromSource — network errors', () => {
  it('throws network error when fetch rejects', async () => {
    const deps = makeDeps({
      fetchFn: async () => { 
        throw new Error('network unreachable'); 
      },
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'network');
        return true;
      }
    );
  });
});

describe('searchFoodsFromSource — proxy errors', () => {
  it('throws unauthenticated error on 401 response from proxy', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(401, { error: 'unauthorized' }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        return true;
      }
    );
  });

  it('throws quota error on proxy error indicating quota', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { error: 'quota_exceeded' }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'quota');
        return true;
      }
    );
  });

  it('throws unknown error when proxy returns generic error body', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { error: 'something_broke' }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unknown');
        assert.equal(err.message, 'something_broke');
        return true;
      }
    );
  });

  it('throws unknown error when proxy returns non-JSON body', async () => {
    const deps = makeDeps({
      fetchFn: async () => {
        return {
          status: 200,
          ok: true,
          json: async () => { throw new Error('syntax error'); },
        } as unknown as Response;
      },
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unknown');
        assert.ok(err.message.includes('non-JSON'));
        return true;
      }
    );
  });

  it('throws unknown error when proxy returns non-OK status', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(500, {}),
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unknown');
        assert.ok(err.message.includes('error status: 500'));
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
    const results = await searchFoodsFromSource(mockUser, 'cheeseburger', deps);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, '41963');
    assert.equal(results[0]?.name, 'Cheeseburger');
    assert.equal(results[0]?.caloriesPer100g, 300);
  });

  it('handles empty results from Proxy', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { results: [] }),
    });
    const results = await searchFoodsFromSource(mockUser, 'nothing', deps);
    assert.deepEqual(results, []);
  });

  it('handles missing results field gracefully', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, {}), // no results field
    });
    const results = await searchFoodsFromSource(mockUser, 'nothing', deps);
    assert.deepEqual(results, []);
  });
});

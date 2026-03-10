/**
 * Unit tests for food-search-source.ts
 * Runner: node:test + node:assert/strict (npm run test:unit)
 *
 * Food search service and fetch dependencies are injected via FoodSearchSourceDeps.
 * Refs: FR-243, TC-282
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
    getServiceUrl: () => 'https://foodservice.eduwaldo.com/searchFoods',
    getLocale: async () => 'en-US',
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
  it('throws configuration error when service URL is not set', async () => {
    const deps = makeDeps({ getServiceUrl: () => undefined });
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
  it('throws unauthenticated error on 401 response from service', async () => {
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

  it('throws quota error on service body error indicating quota', async () => {
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

  it('throws unknown error when service returns generic error body', async () => {
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

  it('throws unknown error when service returns non-JSON body', async () => {
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

  it('throws unknown error when service returns non-OK status', async () => {
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

  it('throws quota error on 429 status', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(429, { error: 'too_many_requests' }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'quota');
        return true;
      }
    );
  });

  it('throws network error on upstream allowlist failure', async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        makeResponse(502, {
          error: 'upstream_ip_not_allowlisted',
          message: 'Food provider IP allowlist mismatch',
        }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'rice', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'network');
        return true;
      }
    );
  });

  it('throws network error on upstream generic failure', async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        makeResponse(502, {
          error: 'upstream_error',
          message: 'Food provider unavailable',
        }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'rice', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'network');
        return true;
      }
    );
  });

  it('throws unknown error for bad_request response body', async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        makeResponse(400, {
          error: 'bad_request',
          message: 'region and language are required',
        }),
    });
    await assert.rejects(
      () => searchFoodsFromSource(mockUser, 'rice', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unknown');
        assert.equal(err.message, 'region and language are required');
        return true;
      }
    );
  });
});

// ─── searchFoodsFromSource — happy paths ──────────────────────────────────────

describe('searchFoodsFromSource — happy path', () => {
  const microserviceFood = {
    id: '12345',
    name: 'Chicken Breast',
    carbohydrate: 0,
    protein: 31,
    fat: 3.6,
    serving: 100,
  };

  it('returns normalized FoodSearchResult array on microservice success shape', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, { results: [microserviceFood] }),
    });
    const results = await searchFoodsFromSource(mockUser, 'cheeseburger', deps);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, '12345');
    assert.equal(results[0]?.name, 'Chicken Breast');
    assert.equal(results[0]?.caloriesPer100g, 156.4);
  });

  it('maps current service payload fields', async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        makeResponse(200, {
          results: [
            {
              id: '987',
              name: 'Rice',
              carbohydrate: 28,
              protein: 2.71,
              fat: 0.3,
              serving: 100,
            },
          ],
        }),
    });

    const results = await searchFoodsFromSource(mockUser, 'rice', deps);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, '987');
    assert.equal(results[0]?.name, 'Rice');
    assert.equal(results[0]?.carbsPer100g, 28);
    assert.equal(results[0]?.proteinsPer100g, 2.71);
    assert.equal(results[0]?.caloriesPer100g, 125.54);
  });

  it('handles empty results from service', async () => {
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

  it('sends expected request contract to service', async () => {
    let capturedInit: RequestInit | undefined;
    const deps = makeDeps({
      fetchFn: async (_url, init) => {
        capturedInit = init;
        return makeResponse(200, { results: [] });
      },
    });

    await searchFoodsFromSource(mockUser, 'banana', deps);

    assert.equal(capturedInit?.method, 'POST');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)?.Authorization,
      'Bearer fake-id-token'
    );
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      query: 'banana',
      maxResults: 10,
      region: 'us',
      language: 'en',
    });
  });

  it('maps locale pt-BR to region/language', async () => {
    let capturedInit: RequestInit | undefined;
    const deps = makeDeps({
      getLocale: async () => 'pt-BR',
      fetchFn: async (_url, init) => {
        capturedInit = init;
        return makeResponse(200, { results: [] });
      },
    });

    await searchFoodsFromSource(mockUser, 'banana', deps);
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      query: 'banana',
      maxResults: 10,
      region: 'br',
      language: 'pt',
    });
  });

  it('maps locale es-MX to es/es fallback mapping', async () => {
    let capturedInit: RequestInit | undefined;
    const deps = makeDeps({
      getLocale: async () => 'es-MX',
      fetchFn: async (_url, init) => {
        capturedInit = init;
        return makeResponse(200, { results: [] });
      },
    });

    await searchFoodsFromSource(mockUser, 'banana', deps);
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      query: 'banana',
      maxResults: 10,
      region: 'es',
      language: 'es',
    });
  });

  it('filters invalid items that do not contain numeric macros', async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        makeResponse(200, {
          results: [
            {
              id: 'bad-1',
              name: 'Invalid Food',
              carbohydrate: null,
              protein: 2.7,
              fat: 0.3,
              serving: 100,
            },
          ],
        }),
    });

    const results = await searchFoodsFromSource(mockUser, 'rice', deps);
    assert.deepEqual(results, []);
  });

  it('accepts numeric string macros from service payload', async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        makeResponse(200, {
          results: [
            {
              id: 'str-1',
              name: 'String Macro Food',
              carbohydrate: '27.81',
              protein: '2.65',
              fat: '0.28',
              serving: '100',
            },
          ],
        }),
    });

    const results = await searchFoodsFromSource(mockUser, 'rice', deps);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, 'str-1');
    assert.equal(results[0]?.carbsPer100g, 27.81);
    assert.equal(results[0]?.proteinsPer100g, 2.65);
    assert.equal(results[0]?.fatsPer100g, 0.28);
  });

  it('filters items when serving is not 100', async () => {
    const deps = makeDeps({
      fetchFn: async () =>
        makeResponse(200, {
          results: [
            {
              id: 'serving-1',
              name: 'Invalid Serving Food',
              carbohydrate: 20,
              protein: 3,
              fat: 1,
              serving: 90,
            },
          ],
        }),
    });

    const results = await searchFoodsFromSource(mockUser, 'rice', deps);
    assert.deepEqual(results, []);
  });
});

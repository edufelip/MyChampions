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
    getServerBaseUrl: () => 'http://localhost:3400',
    getCurrentAccessToken: async () => 'server-access-token',
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
  it('throws configuration error when server URL is not set', async () => {
    const deps = makeDeps({ getServerBaseUrl: () => undefined });
    await assert.rejects(
      () => searchFoodsFromSource('chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'configuration');
        assert.ok(err.message.includes('URL is not configured'));
        return true;
      }
    );
  });
});

describe('searchFoodsFromSource — auth errors', () => {
  it('throws unauthenticated error when server token is missing', async () => {
    const deps = makeDeps({ getCurrentAccessToken: async () => null });
    await assert.rejects(
      () => searchFoodsFromSource('chicken', deps),
      (err: FoodSearchSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        assert.ok(err.message.includes('No authenticated server token'));
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
      () => searchFoodsFromSource('chicken', deps),
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
      () => searchFoodsFromSource('chicken', deps),
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
      () => searchFoodsFromSource('chicken', deps),
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
      () => searchFoodsFromSource('chicken', deps),
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
      () => searchFoodsFromSource('chicken', deps),
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
      () => searchFoodsFromSource('chicken', deps),
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
      () => searchFoodsFromSource('chicken', deps),
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
      () => searchFoodsFromSource('rice', deps),
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
      () => searchFoodsFromSource('rice', deps),
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
      () => searchFoodsFromSource('rice', deps),
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
    const results = await searchFoodsFromSource('cheeseburger', deps);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, '12345');
    assert.equal(results[0]?.name, 'Chicken Breast');
    assert.equal(results[0]?.caloriesPer100g, 156.4);
  });

  it('uses the MyChampions server bearer token', async () => {
    let capturedUrl: string | URL | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const deps = makeDeps({
      getServerBaseUrl: () => 'http://localhost:3400/',
      getCurrentAccessToken: async () => 'server-access-token',
      fetchFn: async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return makeResponse(200, {
          results: [
            {
              id: 'server-rice',
              name: 'Server Rice',
              carbohydrate: 28,
              protein: 2.7,
              fat: 0.3,
              serving: 100,
            },
          ],
        });
      },
    });

    const results = await searchFoodsFromSource('rice', deps);

    assert.equal(capturedUrl, 'http://localhost:3400/integrations/food/search');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)?.Authorization,
      'Bearer server-access-token'
    );
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      query: 'rice',
      maxResults: 10,
      region: 'us',
      language: 'en',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, 'server-rice');
    assert.equal(results[0]?.caloriesPer100g, 125.5);
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

    const results = await searchFoodsFromSource('rice', deps);
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
    const results = await searchFoodsFromSource('nothing', deps);
    assert.deepEqual(results, []);
  });

  it('handles missing results field gracefully', async () => {
    const deps = makeDeps({
      fetchFn: async () => makeResponse(200, {}), // no results field
    });
    const results = await searchFoodsFromSource('nothing', deps);
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

    await searchFoodsFromSource('banana', deps);

    assert.equal(capturedInit?.method, 'POST');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)?.Authorization,
      'Bearer server-access-token'
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

    await searchFoodsFromSource('banana', deps);
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

    await searchFoodsFromSource('banana', deps);
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

    const results = await searchFoodsFromSource('rice', deps);
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

    const results = await searchFoodsFromSource('rice', deps);
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

    const results = await searchFoodsFromSource('rice', deps);
    assert.deepEqual(results, []);
  });
});

describe('searchFoodsFromSource — E2E auth fixture', () => {
  it('returns deterministic food results without calling the service in dev E2E auth mode', async () => {
    const previousAppVariant = process.env.APP_VARIANT;
    const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    const previousFoodFixture = process.env.EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE;
    const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    let fetchCalls = 0;

    process.env.APP_VARIANT = 'dev';
    process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
    process.env.EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE = 'basic';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

    try {
      const results = await searchFoodsFromSource('rice', {
        ...makeDeps(),
        fetchFn: async () => {
          fetchCalls += 1;
          throw new Error('service should not be called for E2E fixture');
        },
      });

      assert.equal(fetchCalls, 0);
      assert.deepEqual(results, [
        {
          id: 'e2e-food-rice',
          name: 'E2E Brown Rice',
          caloriesPer100g: 111,
          carbsPer100g: 23,
          proteinsPer100g: 2.6,
          fatsPer100g: 0.9,
        },
      ]);
    } finally {
      if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = previousAppVariant;

      if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
      else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

      if (previousFoodFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE;
      else process.env.EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE = previousFoodFixture;

      if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
      else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
    }
  });
});

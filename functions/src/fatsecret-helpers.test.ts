/**
 * Unit tests for fatsecret-helpers.ts
 * Runner: node:test + node:assert/strict
 *   npm run test (inside functions/)  →  node --test src/fatsecret-helpers.test.ts
 *
 * All network calls are mocked via the fetchFn / deps injection points.
 * No real HTTP requests or Firebase Admin calls are made.
 * Refs: D-127, TC-283
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  getFatsecretToken,
  searchFatsecret,
  TOKEN_TTL_MARGIN_MS,
  type TokenCache,
  type FatsecretHelpersDeps,
} from './fatsecret-helpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function freshCache(): { value: TokenCache | null } {
  return { value: null };
}

// ─── getFatsecretToken ────────────────────────────────────────────────────────

describe('getFatsecretToken', () => {
  let cache: { value: TokenCache | null };

  beforeEach(() => {
    cache = freshCache();
  });

  it('fetches a new token when cache is empty', async () => {
    const deps: FatsecretHelpersDeps = {
      fetchFn: async () =>
        makeResponse(200, { access_token: 'token-abc', expires_in: 86400 }),
      now: () => 1_000_000,
    };
    const token = await getFatsecretToken('id', 'secret', cache, deps);
    assert.equal(token, 'token-abc');
  });

  it('populates the cache with correct expiresAt', async () => {
    const nowMs = 1_000_000;
    const expiresIn = 86400; // seconds
    const deps: FatsecretHelpersDeps = {
      fetchFn: async () =>
        makeResponse(200, { access_token: 'token-xyz', expires_in: expiresIn }),
      now: () => nowMs,
    };
    await getFatsecretToken('id', 'secret', cache, deps);
    const expectedExpiry = nowMs + expiresIn * 1000 - TOKEN_TTL_MARGIN_MS;
    assert.equal(cache.value?.expiresAt, expectedExpiry);
    assert.equal(cache.value?.accessToken, 'token-xyz');
  });

  it('returns cached token without fetching when cache is warm', async () => {
    let fetchCalled = false;
    const deps: FatsecretHelpersDeps = {
      fetchFn: async () => {
        fetchCalled = true;
        return makeResponse(200, { access_token: 'new-token', expires_in: 86400 });
      },
      now: () => 5_000,
    };
    cache.value = { accessToken: 'cached-token', expiresAt: 10_000 }; // expires in the future
    const token = await getFatsecretToken('id', 'secret', cache, deps);
    assert.equal(token, 'cached-token');
    assert.equal(fetchCalled, false);
  });

  it('fetches a new token when cache is expired', async () => {
    const deps: FatsecretHelpersDeps = {
      fetchFn: async () =>
        makeResponse(200, { access_token: 'fresh-token', expires_in: 86400 }),
      now: () => 20_000,
    };
    cache.value = { accessToken: 'stale-token', expiresAt: 10_000 }; // already expired
    const token = await getFatsecretToken('id', 'secret', cache, deps);
    assert.equal(token, 'fresh-token');
  });

  it('throws when the token endpoint returns a non-OK status', async () => {
    const deps: FatsecretHelpersDeps = {
      fetchFn: async () => makeResponse(401, {}, false),
      now: () => 0,
    };
    await assert.rejects(
      () => getFatsecretToken('id', 'secret', cache, deps),
      (err: Error) => {
        assert.ok(err.message.includes('token request failed'));
        assert.ok(err.message.includes('401'));
        return true;
      }
    );
  });

  it('sends Basic auth header with base64 credentials', async () => {
    let capturedHeaders: Record<string, string> = {};
    const deps: FatsecretHelpersDeps = {
      fetchFn: async (_url, init) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return makeResponse(200, { access_token: 'tok', expires_in: 86400 });
      },
      now: () => 0,
    };
    await getFatsecretToken('my-id', 'my-secret', cache, deps);
    const expectedB64 = Buffer.from('my-id:my-secret').toString('base64');
    assert.equal(capturedHeaders['Authorization'], `Basic ${expectedB64}`);
  });
});

// ─── searchFatsecret ──────────────────────────────────────────────────────────

describe('searchFatsecret', () => {
  it('returns an array of foods on successful response', async () => {
    const food = { food_id: '1', food_name: 'Apple' };
    const fetchFn = async () =>
      makeResponse(200, {
        foods_search: { results: { food: [food] } },
      });
    const results = await searchFatsecret('my-token', 'apple', 10, fetchFn);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0], food);
  });

  it('wraps a single food object in an array (fatsecret quirk)', async () => {
    const food = { food_id: '2', food_name: 'Banana' };
    const fetchFn = async () =>
      makeResponse(200, {
        foods_search: { results: { food } },
      });
    const results = await searchFatsecret('my-token', 'banana', 10, fetchFn);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0], food);
  });

  it('returns empty array when food field is absent', async () => {
    const fetchFn = async () =>
      makeResponse(200, { foods_search: { results: {} } });
    const results = await searchFatsecret('my-token', 'xyz', 10, fetchFn);
    assert.deepEqual(results, []);
  });

  it('returns empty array when foods_search is absent', async () => {
    const fetchFn = async () => makeResponse(200, {});
    const results = await searchFatsecret('my-token', 'xyz', 10, fetchFn);
    assert.deepEqual(results, []);
  });

  it('throws when the search endpoint returns a non-OK status', async () => {
    const fetchFn = async () => makeResponse(500, {}, false);
    await assert.rejects(
      () => searchFatsecret('my-token', 'apple', 10, fetchFn),
      (err: Error) => {
        assert.ok(err.message.includes('search request failed'));
        assert.ok(err.message.includes('500'));
        return true;
      }
    );
  });

  it('throws when body contains an error field', async () => {
    const fetchFn = async () =>
      makeResponse(200, { error: { message: 'quota exceeded' } });
    await assert.rejects(
      () => searchFatsecret('my-token', 'apple', 10, fetchFn),
      (err: Error) => {
        assert.ok(err.message.includes('fatsecret API error'));
        assert.ok(err.message.includes('quota exceeded'));
        return true;
      }
    );
  });

  it('sends Bearer token in Authorization header', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return makeResponse(200, { foods_search: { results: { food: [] } } });
    };
    await searchFatsecret('bearer-xyz', 'rice', 5, fetchFn as typeof fetch);
    assert.equal(capturedHeaders['Authorization'], 'Bearer bearer-xyz');
  });

  it('includes search_expression and max_results in URL query params', async () => {
    let calledUrl = '';
    const fetchFn = async (url: string | URL | Request) => {
      calledUrl = String(url);
      return makeResponse(200, { foods_search: { results: {} } });
    };
    await searchFatsecret('tok', 'brown rice', 15, fetchFn as typeof fetch);
    assert.ok(calledUrl.includes('search_expression=brown+rice') || calledUrl.includes('search_expression=brown%20rice'));
    assert.ok(calledUrl.includes('max_results=15'));
    assert.ok(calledUrl.includes('method=foods.search'));
  });
});

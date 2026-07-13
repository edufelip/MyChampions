import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ExerciseServiceSourceError,
  getExerciseById,
  searchExerciseLibrary,
} from './exercise-service-source';

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    getServerBaseUrl: () => 'http://localhost:3400',
    getCurrentAccessToken: async () => 'server-access-token',
    getLocale: async () => 'en-US',
    createRequestId: () => 'req-test-1',
    fetchFn: async () => {
      throw new Error('fetchFn not configured');
    },
    ...overrides,
  } as never;
}

function makeResponse(status: number, body: unknown, requestId = 'srv-req-1'): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: (name: string) => (name.toLowerCase() === 'x-request-id' ? requestId : null),
    },
  } as unknown as Response;
}

describe('searchExerciseLibrary', () => {
  it('returns deterministic E2E fixture results without fetch when the dev harness is active', async () => {
    const previousAppVariant = process.env.APP_VARIANT;
    const previousAuthSession = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    const previousExerciseFixture = process.env.EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE;
    const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

    process.env.APP_VARIANT = 'dev';
    process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
    process.env.EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE = 'basic';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

    try {
      const result = await searchExerciseLibrary('push', 20, {
        getServerBaseUrl: () => {
          throw new Error('server URL should not be read for E2E fixture search');
        },
        getCurrentAccessToken: async () => {
          throw new Error('server token should not be read for E2E fixture search');
        },
        getLocale: async () => 'en-US',
        createRequestId: () => 'req-should-not-run',
        fetchFn: async () => {
          throw new Error('fetch should not be called for E2E fixture search');
        },
      });

      assert.equal(result.total, 1);
      assert.equal(result.exercises[0]?.id, 'e2e-exercise-push-up');
      assert.equal(result.exercises[0]?.title, 'E2E Push-Up');
    } finally {
      if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = previousAppVariant;

      if (previousAuthSession === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
      else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousAuthSession;

      if (previousExerciseFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE;
      else process.env.EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE = previousExerciseFixture;

      if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
      else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
    }
  });

  it('calls MyChampions server catalog search endpoint with device locale lang and x-request-id header', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const result = await searchExerciseLibrary('Supino', 20, {
      getServerBaseUrl: () => 'http://localhost:3400',
      getCurrentAccessToken: async () => 'server-access-token',
      getLocale: async () => 'pt-BR',
      createRequestId: () => 'req-pt-1',
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return makeResponse(200, {
          page: 1,
          pageSize: 20,
          total: 1,
          results: [
            {
              id: 'abc123',
              slug: 'bench-press',
              title: 'Supino com barra',
              muscleGroup: 'chest',
              equipment: 'barbell',
              hasVideo: true,
              hasVideoWhite: false,
              hasVideoGym: true,
            },
          ],
        });
      },
    });

    assert.equal(capturedUrl, 'http://localhost:3400/integrations/exercise/search');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal((capturedInit?.headers as Record<string, string>)['x-request-id'], 'req-pt-1');
    assert.equal((capturedInit?.headers as Record<string, string>)?.Authorization, 'Bearer server-access-token');

    const parsedBody = JSON.parse(String(capturedInit?.body)) as {
      lang: string;
      query: string;
      page: number;
      pageSize: number;
    };
    assert.equal(parsedBody.lang, 'pt-BR');
    assert.equal(parsedBody.query, 'Supino');
    assert.equal(parsedBody.page, 1);
    assert.equal(parsedBody.pageSize, 20);
    assert.equal(result.requestId, 'srv-req-1');
    assert.equal(result.exercises.length, 1);
    assert.equal(result.exercises[0]?.id, 'abc123');
  });

  it('uses MyChampions server bearer token for exercise search', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const result = await searchExerciseLibrary('push', 5, makeDeps({
      getServerBaseUrl: () => 'http://localhost:3400/',
      getCurrentAccessToken: async () => 'server-access-token',
      fetchFn: async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return makeResponse(200, {
          page: 1,
          pageSize: 5,
          total: 1,
          results: [
            {
              id: 'server-push-up',
              slug: 'server-push-up',
              title: 'Server Push-Up',
              muscleGroup: 'chest',
              equipment: 'bodyweight',
              hasVideo: false,
              hasVideoWhite: false,
              hasVideoGym: false,
            },
          ],
        });
      },
    }));

    assert.equal(capturedUrl, 'http://localhost:3400/integrations/exercise/search');
    assert.equal((capturedInit?.headers as Record<string, string>)?.Authorization, 'Bearer server-access-token');
    assert.equal((capturedInit?.headers as Record<string, string>)['x-request-id'], 'req-test-1');
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      query: 'push',
      page: 1,
      pageSize: 5,
      lang: 'en-US',
    });
    assert.equal(result.exercises[0]?.id, 'server-push-up');
  });

  it('fails closed when the MyChampions server URL is missing', async () => {
    await assert.rejects(
      () =>
        searchExerciseLibrary('push', 5, makeDeps({
          getServerBaseUrl: () => undefined,
          getCurrentAccessToken: async () => 'server-access-token',
          fetchFn: async () => {
            throw new Error('fetch should not be called without a local server URL');
          },
        })),
      (err: ExerciseServiceSourceError) => {
        assert.equal(err.code, 'configuration');
        assert.ok(err.message.includes('MyChampions server URL'));
        return true;
      }
    );
  });

  it('fails closed when the MyChampions server bearer token is missing', async () => {
    await assert.rejects(
      () =>
        searchExerciseLibrary('push', 5, makeDeps({
          getServerBaseUrl: () => 'http://localhost:3400',
          getCurrentAccessToken: async () => null,
          fetchFn: async () => {
            throw new Error('fetch should not be called without a server token');
          },
        })),
      (err: ExerciseServiceSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        assert.ok(err.message.includes('No authenticated server token'));
        return true;
      }
    );
  });

  it('passes the effective app locale through to the catalog API', async () => {
    let bodyLang = '';
    await searchExerciseLibrary('bench', 20, {
      getServerBaseUrl: () => 'http://localhost:3400',
      getCurrentAccessToken: async () => 'server-access-token',
      getLocale: async () => 'de-DE',
      createRequestId: () => 'req-en-1',
      fetchFn: async (_url, init) => {
        const parsed = JSON.parse(String(init?.body)) as { lang: string };
        bodyLang = parsed.lang;
        return makeResponse(200, { page: 1, pageSize: 20, total: 0, results: [] });
      },
    });

    assert.equal(bodyLang, 'de-DE');
  });

  it('parses catalog results[] response shape', async () => {
    const result = await searchExerciseLibrary('bench', 20, {
      getServerBaseUrl: () => 'http://localhost:3400',
      getCurrentAccessToken: async () => 'server-access-token',
      getLocale: async () => 'en-US',
      createRequestId: () => 'req-data-1',
      fetchFn: async () =>
        makeResponse(200, {
          results: [
            {
              id: 'ex-1',
              slug: 'bench-press',
              title: 'Bench Press',
              muscleGroup: 'chest',
              equipment: 'barbell',
              hasVideo: true,
              hasVideoWhite: false,
              hasVideoGym: true,
            },
          ],
          page: 2,
          pageSize: 20,
          total: 134,
        }),
    });

    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 20);
    assert.equal(result.total, 134);
    assert.equal(result.exercises.length, 1);
    assert.equal(result.exercises[0]?.id, 'ex-1');
  });

  it('throws configuration error when MyChampions server URL is missing', async () => {
    await assert.rejects(
      () =>
        searchExerciseLibrary('bench', 20, {
          getServerBaseUrl: () => undefined,
          getCurrentAccessToken: async () => 'server-access-token',
          getLocale: async () => 'en-US',
          createRequestId: () => 'req-cfg-1',
          fetchFn: async () => makeResponse(200, { page: 1, pageSize: 20, total: 0, results: [] }),
        }),
      (err: ExerciseServiceSourceError) => {
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });
});

describe('getExerciseById', () => {
  it('returns exercise payload from catalog detail response', async () => {
    let capturedUrl = '';
    const exercise = await getExerciseById('abc123', {
      getServerBaseUrl: () => 'http://localhost:3400',
      getCurrentAccessToken: async () => 'server-access-token',
      getLocale: async () => 'en-US',
      createRequestId: () => 'req-id-1',
      fetchFn: async (url) => {
        capturedUrl = String(url);
        return makeResponse(200, {
          id: 'abc123',
          slug: 'bench-press',
          title: 'Bench Press',
          muscleGroup: 'chest',
          equipment: 'barbell',
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: true,
          thumbnailUrl: 'https://cdn/thumb.jpg',
        });
      },
    });

    assert.equal(capturedUrl, 'http://localhost:3400/integrations/exercise/exercises/abc123?lang=en-US');
    assert.equal(exercise?.id, 'abc123');
    assert.equal(exercise?.thumbnailUrl, 'https://cdn/thumb.jpg');
  });

  it('uses MyChampions server bearer token for exercise detail', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const exercise = await getExerciseById('server-push-up', makeDeps({
      getServerBaseUrl: () => 'http://localhost:3400/',
      getCurrentAccessToken: async () => 'server-access-token',
      fetchFn: async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return makeResponse(200, {
          id: 'server-push-up',
          slug: 'server-push-up',
          title: 'Server Push-Up',
          muscleGroup: 'chest',
          equipment: 'bodyweight',
          hasVideo: false,
          hasVideoWhite: false,
          hasVideoGym: false,
        });
      },
    }));

    assert.equal(capturedUrl, 'http://localhost:3400/integrations/exercise/exercises/server-push-up?lang=en-US');
    assert.equal((capturedInit?.headers as Record<string, string>)?.Authorization, 'Bearer server-access-token');
    assert.equal(exercise?.id, 'server-push-up');
  });

  it('fails closed for detail lookup when the MyChampions server URL is missing', async () => {
    await assert.rejects(
      () =>
        getExerciseById('server-push-up', makeDeps({
          getServerBaseUrl: () => undefined,
          getCurrentAccessToken: async () => 'server-access-token',
          fetchFn: async () => {
            throw new Error('fetch should not be called without a local server URL');
          },
        })),
      (err: ExerciseServiceSourceError) => {
        assert.equal(err.code, 'configuration');
        assert.ok(err.message.includes('MyChampions server URL'));
        return true;
      }
    );
  });

  it('fails closed for detail lookup when the MyChampions server bearer token is missing', async () => {
    await assert.rejects(
      () =>
        getExerciseById('server-push-up', makeDeps({
          getServerBaseUrl: () => 'http://localhost:3400',
          getCurrentAccessToken: async () => null,
          fetchFn: async () => {
            throw new Error('fetch should not be called without a server token');
          },
        })),
      (err: ExerciseServiceSourceError) => {
        assert.equal(err.code, 'unauthenticated');
        assert.ok(err.message.includes('No authenticated server token'));
        return true;
      }
    );
  });

  it('returns null on service 404', async () => {
    const exercise = await getExerciseById('missing', {
      getServerBaseUrl: () => 'http://localhost:3400',
      getCurrentAccessToken: async () => 'server-access-token',
      getLocale: async () => 'en-US',
      createRequestId: () => 'req-404-1',
      fetchFn: async () => makeResponse(404, { error: 'not_found' }),
    });

    assert.equal(exercise, null);
  });

  it('throws on non-404 service failure', async () => {
    await assert.rejects(
      () =>
        getExerciseById('abc123', {
          getServerBaseUrl: () => 'http://localhost:3400',
          getCurrentAccessToken: async () => 'server-access-token',
          getLocale: async () => 'en-US',
          createRequestId: () => 'req-500-1',
          fetchFn: async () => makeResponse(500, { error: 'internal' }),
        }),
      (err: ExerciseServiceSourceError) => {
        assert.equal(err.code, 'service');
        assert.equal(err.status, 500);
        return true;
      }
    );
  });
});

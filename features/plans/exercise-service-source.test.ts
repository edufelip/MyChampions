import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ExerciseServiceSourceError,
  getExerciseById,
  searchExerciseLibrary,
} from './exercise-service-source';

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
  it('calls proxy endpoint with normalized pt lang and x-request-id header', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const result = await searchExerciseLibrary('Supino', 20, {
      getServiceBaseUrl: () => 'https://exerciseservice.eduwaldo.com',
      getLocale: async () => 'pt-BR',
      createRequestId: () => 'req-pt-1',
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return makeResponse(200, {
          page: 1,
          pageSize: 20,
          total: 1,
          exercises: [
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

    assert.equal(capturedUrl, 'https://exerciseservice.eduwaldo.com/proxy');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal((capturedInit?.headers as Record<string, string>)['x-request-id'], 'req-pt-1');

    const parsedBody = JSON.parse(String(capturedInit?.body)) as {
      lang: string;
      request: { url: string; method: string };
    };
    assert.equal(parsedBody.lang, 'pt');
    assert.equal(parsedBody.request.method, 'GET');
    assert.equal(
      parsedBody.request.url,
      'https://exercise-api.ymove.app/api/v2/exercises?pageSize=20&search=Supino'
    );
    assert.equal(result.requestId, 'srv-req-1');
    assert.equal(result.exercises.length, 1);
    assert.equal(result.exercises[0]?.id, 'abc123');
  });

  it('falls back to en language when locale is unknown', async () => {
    let bodyLang = '';
    await searchExerciseLibrary('bench', 20, {
      getServiceBaseUrl: () => 'https://exerciseservice.eduwaldo.com',
      getLocale: async () => 'de-DE',
      createRequestId: () => 'req-en-1',
      fetchFn: async (_url, init) => {
        const parsed = JSON.parse(String(init?.body)) as { lang: string };
        bodyLang = parsed.lang;
        return makeResponse(200, { page: 1, pageSize: 20, total: 0, exercises: [] });
      },
    });

    assert.equal(bodyLang, 'en');
  });

  it('parses upstream-compatible data[] + pagination shape', async () => {
    const result = await searchExerciseLibrary('bench', 20, {
      getServiceBaseUrl: () => 'https://exerciseservice.eduwaldo.com',
      getLocale: async () => 'en-US',
      createRequestId: () => 'req-data-1',
      fetchFn: async () =>
        makeResponse(200, {
          data: [
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
          pagination: {
            page: 2,
            pageSize: 20,
            total: 134,
          },
        }),
    });

    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 20);
    assert.equal(result.total, 134);
    assert.equal(result.exercises.length, 1);
    assert.equal(result.exercises[0]?.id, 'ex-1');
  });

  it('throws configuration error when service URL is missing', async () => {
    await assert.rejects(
      () =>
        searchExerciseLibrary('bench', 20, {
          getServiceBaseUrl: () => undefined,
          getLocale: async () => 'en-US',
          createRequestId: () => 'req-cfg-1',
          fetchFn: async () => makeResponse(200, { page: 1, pageSize: 20, total: 0, exercises: [] }),
        }),
      (err: ExerciseServiceSourceError) => {
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });
});

describe('getExerciseById', () => {
  it('returns exercise payload from proxy single-object response', async () => {
    const exercise = await getExerciseById('abc123', {
      getServiceBaseUrl: () => 'https://exerciseservice.eduwaldo.com',
      getLocale: async () => 'en-US',
      createRequestId: () => 'req-id-1',
      fetchFn: async () =>
        makeResponse(200, {
          id: 'abc123',
          slug: 'bench-press',
          title: 'Bench Press',
          muscleGroup: 'chest',
          equipment: 'barbell',
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: true,
          thumbnailUrl: 'https://cdn/thumb.jpg',
        }),
    });

    assert.equal(exercise?.id, 'abc123');
    assert.equal(exercise?.thumbnailUrl, 'https://cdn/thumb.jpg');
  });

  it('returns null on service 404', async () => {
    const exercise = await getExerciseById('missing', {
      getServiceBaseUrl: () => 'https://exerciseservice.eduwaldo.com',
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
          getServiceBaseUrl: () => 'https://exerciseservice.eduwaldo.com',
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

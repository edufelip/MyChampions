import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTodayWorkoutLogs,
  logWorkoutSession,
  WorkoutLogSourceError,
} from './workout-log-source';

test('logWorkoutSession posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  await logWorkoutSession('sess-789', 'Chest Day', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          log: {
            id: 'server-log-1',
            ownerUid: 'server-user-1',
            sessionId: 'sess-789',
            sessionName: 'Chest Day',
            createdAt: '2026-06-28T10:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/training/workout-logs');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
  assert.deepEqual(await (captured as Request).json(), {
    sessionId: 'sess-789',
    sessionName: 'Chest Day',
  });
});

test('logWorkoutSession fails closed when local server auth is missing', async () => {
  await assert.rejects(
    () =>
      logWorkoutSession('sess-789', 'Chest Day', {
        getCurrentAccessToken: async () => null,
        getServerBaseUrl: () => 'http://server.test',
        fetchFn: async () => {
          throw new Error('fetch should not be called without a token');
        },
      }),
    (error: unknown) => error instanceof WorkoutLogSourceError && error.code === 'permission',
  );
});

test('logWorkoutSession fails closed when local server URL is missing', async () => {
  await assert.rejects(
    () =>
      logWorkoutSession('sess-789', 'Chest Day', {
        getCurrentAccessToken: async () => 'server-token',
        getServerBaseUrl: () => undefined,
        fetchFn: async () => {
          throw new Error('fetch should not be called without a server URL');
        },
      }),
    (error: unknown) => error instanceof WorkoutLogSourceError && error.code === 'configuration',
  );
});

test('getTodayWorkoutLogs reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const logs = await getTodayWorkoutLogs({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          logs: [
            {
              id: 'server-log-1',
              ownerUid: 'server-user-1',
              sessionId: 'sess-789',
              sessionName: 'Chest Day',
              createdAt: '2026-06-28T10:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  assert.deepEqual(logs, [
    {
      id: 'server-log-1',
      ownerUid: 'server-user-1',
      sessionId: 'sess-789',
      sessionName: 'Chest Day',
      createdAt: '2026-06-28T10:00:00.000Z',
    },
  ]);
  assert.ok(captured);
  assert.equal(
    (captured as Request).url.startsWith('http://server.test/training/workout-logs?from='),
    true,
  );
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('getTodayWorkoutLogs fails closed when local server auth is missing', async () => {
  await assert.rejects(
    () =>
      getTodayWorkoutLogs({
        getCurrentAccessToken: async () => null,
        getServerBaseUrl: () => 'http://server.test',
        fetchFn: async () => {
          throw new Error('fetch should not be called without a token');
        },
      }),
    (error: unknown) => error instanceof WorkoutLogSourceError && error.code === 'permission',
  );
});

test('assigned training E2E fixture logs today workout sessions without server auth', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousStudentTrainingFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE = 'assigned';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    assert.deepEqual(await getTodayWorkoutLogs(), []);

    await logWorkoutSession('e2e-assigned-session', 'Assigned Strength Session');

    assert.deepEqual(await getTodayWorkoutLogs(), [
      {
        id: 'e2e-workout-log-e2e-assigned-session',
        ownerUid: 'e2e-auth-session-user',
        sessionId: 'e2e-assigned-session',
        sessionName: 'Assigned Strength Session',
        createdAt: '2026-06-22T12:00:00.000Z',
      },
    ]);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousStudentTrainingFixture === undefined)
      delete process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE = previousStudentTrainingFixture;

    if (previousDev === undefined)
      delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

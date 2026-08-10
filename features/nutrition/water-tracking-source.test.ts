import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMyWaterGoalContext,
  getMyWaterLogs,
  logWaterIntake,
  WaterTrackingSourceError,
} from './water-tracking-source';

test('water tracking source uses the dev E2E auth-session fixture through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    await assert.deepEqual(await getMyWaterLogs(), []);
    await assert.deepEqual(await getMyWaterGoalContext(), {
      hasActiveNutritionistAssignment: false,
      nutritionistGoalMl: null,
      studentGoalMl: 2500,
    });
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousDev === undefined)
      delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('assigned nutrition E2E fixture uses nutritionist hydration goal and logs intake through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousStudentNutritionFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = 'assigned';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    assert.deepEqual(await getMyWaterGoalContext(), {
      hasActiveNutritionistAssignment: true,
      nutritionistGoalMl: 2800,
      studentGoalMl: 2500,
    });

    assert.equal(await logWaterIntake(250, '2026-06-22'), 'e2e-auth-session-user_2026-06-22');
    assert.deepEqual(await getMyWaterLogs(), [
      {
        id: 'e2e-auth-session-user_2026-06-22',
        dateKey: '2026-06-22',
        totalMl: 250,
        loggedAt: '2026-06-22T12:00:00.000Z',
      },
    ]);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousStudentNutritionFixture === undefined)
      delete process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = previousStudentNutritionFixture;

    if (previousDev === undefined)
      delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('logWaterIntake posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const id = await logWaterIntake(250, '2026-06-28', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          log: {
            id: 'server-user-1_2026-06-28',
            dateKey: '2026-06-28',
            totalMl: 750,
            loggedAt: '2026-06-28T10:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    },
  } as any);

  assert.equal(id, 'server-user-1_2026-06-28');
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/water-logs');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
  assert.deepEqual(await (captured as Request).json(), {
    amountMl: 250,
    dateKey: '2026-06-28',
  });
});

test('logWaterIntake fails closed when local server auth is missing', async () => {
  await assert.rejects(
    () =>
      logWaterIntake(250, '2026-06-28', {
        getCurrentAccessToken: async () => null,
        getServerBaseUrl: () => 'http://server.test',
        fetchFn: async () => {
          throw new Error('fetch should not be called without a token');
        },
      }),
    (error: unknown) => error instanceof WaterTrackingSourceError && error.code === 'graphql',
  );
});

test('logWaterIntake fails closed when local server URL is missing', async () => {
  await assert.rejects(
    () =>
      logWaterIntake(250, '2026-06-28', {
        getCurrentAccessToken: async () => 'server-token',
        getServerBaseUrl: () => undefined,
        fetchFn: async () => {
          throw new Error('fetch should not be called without a server URL');
        },
      }),
    (error: unknown) => error instanceof WaterTrackingSourceError && error.code === 'configuration',
  );
});

test('getMyWaterLogs reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const logs = await getMyWaterLogs({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          logs: [
            {
              id: 'server-user-1_2026-06-28',
              dateKey: '2026-06-28',
              totalMl: 750,
              loggedAt: '2026-06-28T10:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  } as any);

  assert.deepEqual(logs, [
    {
      id: 'server-user-1_2026-06-28',
      dateKey: '2026-06-28',
      totalMl: 750,
      loggedAt: '2026-06-28T10:00:00.000Z',
    },
  ]);
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/water-logs');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('getMyWaterLogs fails closed when local server auth is missing', async () => {
  await assert.rejects(
    () =>
      getMyWaterLogs({
        getCurrentAccessToken: async () => null,
        getServerBaseUrl: () => 'http://server.test',
        fetchFn: async () => {
          throw new Error('fetch should not be called without a token');
        },
      }),
    (error: unknown) => error instanceof WaterTrackingSourceError && error.code === 'graphql',
  );
});

test('getMyWaterGoalContext reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const context = await getMyWaterGoalContext({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          studentGoalMl: 2500,
          nutritionistGoalMl: 2800,
          hasActiveNutritionistAssignment: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  } as any);

  assert.deepEqual(context, {
    studentGoalMl: 2500,
    nutritionistGoalMl: 2800,
    hasActiveNutritionistAssignment: true,
  });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/water-goal-context');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('getMyWaterGoalContext fails closed when local server auth is missing', async () => {
  await assert.rejects(
    () =>
      getMyWaterGoalContext({
        getCurrentAccessToken: async () => null,
        getServerBaseUrl: () => 'http://server.test',
        fetchFn: async () => {
          throw new Error('fetch should not be called without a token');
        },
      }),
    (error: unknown) => error instanceof WaterTrackingSourceError && error.code === 'graphql',
  );
});

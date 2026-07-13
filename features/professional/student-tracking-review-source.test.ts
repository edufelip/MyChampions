import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStudentTrackingReviewDateWindow,
  getStudentTrackingReview,
  normalizeStudentTrackingReviewError,
  StudentTrackingReviewSourceError,
} from './student-tracking-review-source';

test('buildStudentTrackingReviewDateWindow returns inclusive seven-day date and timestamp boundaries', () => {
  const window = buildStudentTrackingReviewDateWindow('2026-06-01');

  assert.equal(window.startDateKey, '2026-05-26');
  assert.equal(window.endDateKey, '2026-06-01');
  assert.equal(window.startLoggedAtIso, '2026-05-26T00:00:00.000Z');
});

test('normalizeStudentTrackingReviewError maps network and configuration failures', () => {
  assert.equal(
    normalizeStudentTrackingReviewError(
      new StudentTrackingReviewSourceError('network', 'Network request failed.')
    ).code,
    'network'
  );
  assert.equal(
    normalizeStudentTrackingReviewError(
      new StudentTrackingReviewSourceError('configuration', 'Missing server URL.')
    ).code,
    'configuration'
  );
  assert.equal(normalizeStudentTrackingReviewError(new Error('unexpected')).code, 'invalid_response');
});

test('E2E auth source can return a deterministic student tracking review fixture', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const review = await getStudentTrackingReview('e2e-dual-student', {
      todayKey: '2026-06-22',
      waterGoalMl: 2000,
    });

    assert.equal(review.todayWater.totalMl, 1500);
    assert.equal(review.todayWater.progressPercent, 75);
    assert.equal(review.todayMealCheckOffs[0]?.mealId, 'breakfast');
    assert.equal(review.recentPortionLogs[0]?.id, 'e2e-portion-today');
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('getStudentTrackingReview reads from MyChampions server when a bearer token is available', async () => {
  let requestedUrl: string | null = null;
  let requestedInit: RequestInit | undefined;

  const review = await getStudentTrackingReview('student-1', {
    todayKey: '2026-06-28',
  }, {
    getCurrentAccessToken: async () => 'server-token-1',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({
        waterGoalMl: 2000,
        waterLogs: [
          {
            id: 'water-today',
            dateKey: '2026-06-28',
            totalMl: 1500,
            loggedAt: '2026-06-28T12:00:00.000Z',
          },
          {
            id: 'water-yesterday',
            dateKey: '2026-06-27',
            totalMl: 2200,
            loggedAt: '2026-06-27T12:00:00.000Z',
          },
        ],
        portionLogs: [
          {
            id: 'portion-today',
            ownerUid: 'student-1',
            mealId: 'meal-1',
            consumedGrams: 150,
            snapshot: { calories: 240, carbs: 27.5, proteins: 17.5, fats: 7 },
            loggedAt: '2026-06-28T08:00:00.000Z',
            planId: 'plan-1',
            planType: 'nutrition',
            sourceKind: 'assigned',
            ownerProfessionalUid: 'nutritionist-1',
            connectionId: 'connection-1',
          },
        ],
      }), { status: 200 });
    },
  });

  assert.equal(
    requestedUrl,
    'http://server.test/professional/students/student-1/tracking-review?todayKey=2026-06-28'
  );
  assert.equal(requestedInit?.method ?? 'GET', 'GET');
  assert.equal((requestedInit?.headers as Record<string, string>).authorization, 'Bearer server-token-1');
  assert.equal(review.todayWater.totalMl, 1500);
  assert.equal(review.todayWater.progressPercent, 75);
  assert.equal(review.sevenDayHydration[1]?.totalMl, 2200);
  assert.equal(review.todayMealCheckOffs[0]?.mealId, 'meal-1');
  assert.equal(review.todayMealCheckOffs[0]?.calories, 240);
});

test('getStudentTrackingReview fails closed when local server auth is missing', async () => {
  await assert.rejects(
    () => getStudentTrackingReview('student-1', {
      todayKey: '2026-06-28',
      waterGoalMl: 2000,
    }, {
      getCurrentAccessToken: async () => null,
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () => {
        throw new Error('fetch should not run without a token');
      },
    }),
    (error) => error instanceof StudentTrackingReviewSourceError && error.code === 'permission'
  );
});

test('getStudentTrackingReview fails closed when local server URL is missing', async () => {
  await assert.rejects(
    () => getStudentTrackingReview('student-1', {
      todayKey: '2026-06-28',
      waterGoalMl: 2000,
    }, {
      getCurrentAccessToken: async () => 'server-token-1',
      getServerBaseUrl: () => undefined,
      fetchFn: async () => {
        throw new Error('fetch should not run without a server URL');
      },
    }),
    (error) => error instanceof StudentTrackingReviewSourceError && error.code === 'configuration'
  );
});

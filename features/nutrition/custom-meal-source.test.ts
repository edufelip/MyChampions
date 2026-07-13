import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAssignedMealPortionLog,
  createCustomMeal,
  CustomMealSourceError,
  createMealShareLink,
  deleteCustomMeal,
  getMyCustomMeals,
  getTodayPortionLogs,
  importSharedMeal,
  logPortionFromSource,
  logAssignedMealPortion,
  previewSharedMeal,
  updateCustomMeal,
} from './custom-meal-source';

const customMealInput = {
  name: 'Local Server Bowl',
  totalGrams: 300,
  calories: 480,
  carbs: 55,
  proteins: 35,
  fats: 14,
  ingredientCost: null,
  imageUrl: null,
};

async function assertRejectsWithConfiguration(operation: () => Promise<unknown>) {
  await assert.rejects(
    operation,
    (error) => error instanceof CustomMealSourceError && error.code === 'configuration'
  );
}

test('buildAssignedMealPortionLog includes assigned plan and connection provenance when available', () => {
  const log = buildAssignedMealPortionLog({
    id: 'portion-log-1',
    ownerUid: 'student-uid',
    mealId: 'meal-1',
    snapshot: {
      calories: 420,
      carbs: 50,
      proteins: 32,
      fats: 12,
    },
    loggedAt: '2026-06-01T12:00:00.000Z',
    provenance: {
      planId: 'nutrition-plan-1',
      planType: 'nutrition',
      sourceKind: 'assigned',
      ownerProfessionalUid: 'nutritionist-uid',
      connectionId: 'connection-1',
    },
  });

  assert.equal(log.planId, 'nutrition-plan-1');
  assert.equal(log.planType, 'nutrition');
  assert.equal(log.sourceKind, 'assigned');
  assert.equal(log.ownerProfessionalUid, 'nutritionist-uid');
  assert.equal(log.connectionId, 'connection-1');
});

test('buildAssignedMealPortionLog keeps unavailable provenance as null', () => {
  const log = buildAssignedMealPortionLog({
    id: 'portion-log-2',
    ownerUid: 'student-uid',
    mealId: 'meal-2',
    snapshot: {
      calories: 300,
      carbs: 30,
      proteins: 20,
      fats: 10,
    },
    loggedAt: '2026-06-01T13:00:00.000Z',
  });

  assert.equal(log.planId, null);
  assert.equal(log.planType, null);
  assert.equal(log.sourceKind, null);
  assert.equal(log.ownerProfessionalUid, null);
  assert.equal(log.connectionId, null);
});

test('custom meal operations fail closed without local server auth outside E2E fixtures', async () => {
  const noAuthDeps = {
    getCurrentAccessToken: async () => null,
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async () => {
      throw new Error('Server should not be called without local auth.');
    },
  };

  await assertRejectsWithConfiguration(() => getMyCustomMeals(noAuthDeps));
  await assertRejectsWithConfiguration(() => createCustomMeal(customMealInput, noAuthDeps));
  await assertRejectsWithConfiguration(() => updateCustomMeal('meal-1', customMealInput, noAuthDeps));
  await assertRejectsWithConfiguration(() => deleteCustomMeal('meal-1', noAuthDeps));
  await assertRejectsWithConfiguration(() => createMealShareLink('meal-1', noAuthDeps));
  await assertRejectsWithConfiguration(() => importSharedMeal('share-1', noAuthDeps));
  await assertRejectsWithConfiguration(() => logPortionFromSource('meal-1', 150, noAuthDeps));
  await assertRejectsWithConfiguration(() =>
    logAssignedMealPortion(
      'meal-1',
      { calories: 400, carbs: 45, proteins: 30, fats: 12 },
      undefined,
      noAuthDeps
    )
  );
  await assertRejectsWithConfiguration(() => getTodayPortionLogs(noAuthDeps));
  await assertRejectsWithConfiguration(() =>
    previewSharedMeal('share-1', {
      getServerBaseUrl: () => undefined,
      fetchFn: async () => {
        throw new Error('Server should not be called without local server URL.');
      },
    })
  );
});

test('previewSharedMeal returns the dev E2E shared recipe fixture through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const snapshot = await previewSharedMeal('e2e-shared-recipe');

    assert.deepEqual(snapshot, {
      name: 'E2E Shared Recovery Bowl',
      totalGrams: 300,
      calories: 480,
      carbs: 55,
      proteins: 35,
      fats: 14,
    });
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('importSharedMeal returns a personal copy for the dev E2E shared recipe fixture', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const meal = await importSharedMeal('e2e-shared-recipe');

    assert.equal(meal.id, 'meal_e2e-shared-recipe');
    assert.equal(meal.ownerUid, 'e2e-auth-session-user');
    assert.equal(meal.name, 'E2E Shared Recovery Bowl');
    assert.equal(meal.totalGrams, 300);
    assert.equal(meal.ingredientCost, null);
    assert.equal(meal.imageUrl, null);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('assigned nutrition E2E fixture logs assigned meal portions through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousStudentNutritionFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = 'assigned';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    await logAssignedMealPortion(
      'e2e-assigned-meal',
      { calories: 520, carbs: 58, proteins: 36, fats: 16 },
      {
        planId: 'e2e-assigned-nutrition-plan',
        planType: 'nutrition',
        sourceKind: 'assigned',
        ownerProfessionalUid: 'e2e-nutritionist',
        connectionId: 'e2e-active-nutritionist-connection',
      }
    );

    const logs = await getTodayPortionLogs();
    assert.equal(logs.length, 1);
    assert.deepEqual(
      {
        ownerUid: logs[0].ownerUid,
        mealId: logs[0].mealId,
        planId: logs[0].planId,
        sourceKind: logs[0].sourceKind,
        connectionId: logs[0].connectionId,
        calories: logs[0].snapshot.calories,
      },
      {
        ownerUid: 'e2e-auth-session-user',
        mealId: 'e2e-assigned-meal',
        planId: 'e2e-assigned-nutrition-plan',
        sourceKind: 'assigned',
        connectionId: 'e2e-active-nutritionist-connection',
        calories: 520,
      }
    );
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousStudentNutritionFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = previousStudentNutritionFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('logAssignedMealPortion posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  await logAssignedMealPortion(
    'assigned-meal-1',
    { calories: 520, carbs: 58, proteins: 36, fats: 16 },
    {
      planId: 'nutrition-plan-1',
      planType: 'nutrition',
      sourceKind: 'assigned',
      ownerProfessionalUid: 'nutritionist-1',
      connectionId: 'connection-1',
    },
    {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test/',
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = new Request(input, init);
        return new Response(
          JSON.stringify({
            log: {
              id: 'portion-log-1',
              ownerUid: 'server-user-1',
              mealId: 'assigned-meal-1',
              consumedGrams: 0,
              snapshot: { calories: 520, carbs: 58, proteins: 36, fats: 16 },
              loggedAt: '2026-06-28T10:00:00.000Z',
              planId: 'nutrition-plan-1',
              planType: 'nutrition',
              sourceKind: 'assigned',
              ownerProfessionalUid: 'nutritionist-1',
              connectionId: 'connection-1',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      },
    } as any
  );

  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/portion-logs');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
  assert.deepEqual(await (captured as Request).json(), {
    mealId: 'assigned-meal-1',
    consumedGrams: 0,
    snapshot: { calories: 520, carbs: 58, proteins: 36, fats: 16 },
    planId: 'nutrition-plan-1',
    planType: 'nutrition',
    sourceKind: 'assigned',
    ownerProfessionalUid: 'nutritionist-1',
    connectionId: 'connection-1',
  });
});

test('getTodayPortionLogs reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const logs = await getTodayPortionLogs({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          logs: [
            {
              id: 'portion-log-1',
              ownerUid: 'server-user-1',
              mealId: 'assigned-meal-1',
              consumedGrams: 0,
              snapshot: { calories: 520, carbs: 58, proteins: 36, fats: 16 },
              loggedAt: '2026-06-28T10:00:00.000Z',
              planId: 'nutrition-plan-1',
              planType: 'nutrition',
              sourceKind: 'assigned',
              ownerProfessionalUid: 'nutritionist-1',
              connectionId: 'connection-1',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  } as any);

  assert.deepEqual(logs, [
    {
      id: 'portion-log-1',
      ownerUid: 'server-user-1',
      mealId: 'assigned-meal-1',
      consumedGrams: 0,
      snapshot: { calories: 520, carbs: 58, proteins: 36, fats: 16 },
      loggedAt: '2026-06-28T10:00:00.000Z',
      planId: 'nutrition-plan-1',
      planType: 'nutrition',
      sourceKind: 'assigned',
      ownerProfessionalUid: 'nutritionist-1',
      connectionId: 'connection-1',
    },
  ]);
  assert.ok(captured);
  assert.equal((captured as Request).url.startsWith('http://server.test/nutrition/portion-logs?from='), true);
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('getMyCustomMeals reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const meals = await getMyCustomMeals({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          meals: [
            {
              id: 'server-meal-1',
              ownerUid: 'server-user-1',
              name: 'Server Bowl',
              totalGrams: 300,
              calories: 480,
              carbs: 55,
              proteins: 35,
              fats: 14,
              ingredientCost: 8.5,
              imageUrl: null,
              createdAt: '2026-06-28T09:00:00.000Z',
              updatedAt: '2026-06-28T10:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  } as any);

  assert.equal(meals.length, 1);
  assert.deepEqual(meals[0], {
    id: 'server-meal-1',
    ownerUid: 'server-user-1',
    name: 'Server Bowl',
    totalGrams: 300,
    calories: 480,
    carbs: 55,
    proteins: 35,
    fats: 14,
    ingredientCost: 8.5,
    imageUrl: null,
    createdAt: '2026-06-28T09:00:00.000Z',
    updatedAt: '2026-06-28T10:00:00.000Z',
  });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/custom-meals');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('createCustomMeal posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const meal = await createCustomMeal(
    {
      name: 'Created Server Bowl',
      totalGrams: 250,
      calories: 400,
      carbs: 42,
      proteins: 30,
      fats: 12,
      ingredientCost: 7.5,
      imageUrl: 'https://example.test/meal.jpg',
    },
    {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test/',
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = new Request(input, init);
        return new Response(
          JSON.stringify({
            meal: {
              id: 'server-meal-1',
              ownerUid: 'server-user-1',
              name: 'Created Server Bowl',
              totalGrams: 250,
              calories: 400,
              carbs: 42,
              proteins: 30,
              fats: 12,
              ingredientCost: 7.5,
              imageUrl: 'https://example.test/meal.jpg',
              createdAt: '2026-06-28T09:00:00.000Z',
              updatedAt: '2026-06-28T09:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      },
    } as any
  );

  assert.equal(meal.id, 'server-meal-1');
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/custom-meals');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
  assert.deepEqual(await (captured as Request).json(), {
    name: 'Created Server Bowl',
    totalGrams: 250,
    calories: 400,
    carbs: 42,
    proteins: 30,
    fats: 12,
    ingredientCost: 7.5,
    imageUrl: 'https://example.test/meal.jpg',
  });
});

test('updateCustomMeal puts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const meal = await updateCustomMeal(
    'server-meal-1',
    {
      name: 'Updated Server Bowl',
      totalGrams: 275,
      calories: 420,
      carbs: 44,
      proteins: 32,
      fats: 13,
      ingredientCost: null,
      imageUrl: null,
    },
    {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test/',
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = new Request(input, init);
        return new Response(
          JSON.stringify({
            meal: {
              id: 'server-meal-1',
              ownerUid: 'server-user-1',
              name: 'Updated Server Bowl',
              totalGrams: 275,
              calories: 420,
              carbs: 44,
              proteins: 32,
              fats: 13,
              ingredientCost: null,
              imageUrl: null,
              createdAt: '2026-06-28T09:00:00.000Z',
              updatedAt: '2026-06-28T10:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    } as any
  );

  assert.equal(meal.name, 'Updated Server Bowl');
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/custom-meals/server-meal-1');
  assert.equal((captured as Request).method, 'PUT');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('deleteCustomMeal deletes through the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  await deleteCustomMeal('server-meal-1', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(null, { status: 204 });
    },
  } as any);

  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/custom-meals/server-meal-1');
  assert.equal((captured as Request).method, 'DELETE');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('createMealShareLink posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const result = await createMealShareLink('server-meal-1', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({ shareLinkId: 'share-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
  } as any);

  assert.deepEqual(result, { shareLinkId: 'share-1' });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/custom-meals/server-meal-1/share-links');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('previewSharedMeal reads from the MyChampions server', async () => {
  let captured: Request | null = null;

  const snapshot = await previewSharedMeal('share-1', {
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          snapshot: {
            name: 'Shared Server Bowl',
            totalGrams: 300,
            calories: 480,
            carbs: 55,
            proteins: 35,
            fats: 14,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  } as any);

  assert.deepEqual(snapshot, {
    name: 'Shared Server Bowl',
    totalGrams: 300,
    calories: 480,
    carbs: 55,
    proteins: 35,
    fats: 14,
  });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/custom-meal-shares/share-1');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), null);
});

test('importSharedMeal imports through the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const meal = await importSharedMeal('share-1', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          meal: {
            id: 'imported-meal-1',
            ownerUid: 'server-user-1',
            name: 'Shared Server Bowl',
            totalGrams: 300,
            calories: 480,
            carbs: 55,
            proteins: 35,
            fats: 14,
            ingredientCost: null,
            imageUrl: null,
            createdAt: '2026-06-29T09:00:00.000Z',
            updatedAt: '2026-06-29T09:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      );
    },
  } as any);

  assert.equal(meal.id, 'imported-meal-1');
  assert.equal(meal.ownerUid, 'server-user-1');
  assert.equal(meal.name, 'Shared Server Bowl');
  assert.equal(meal.ingredientCost, null);
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/nutrition/custom-meal-shares/share-1/import');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('logPortionFromSource reads the custom meal and writes the portion log through the server when a local bearer token is available', async () => {
  const requests: Request[] = [];

  await logPortionFromSource('server-meal-1', 150, {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);

      if (request.method === 'GET') {
        return new Response(
          JSON.stringify({
            meal: {
              id: 'server-meal-1',
              ownerUid: 'server-user-1',
              name: 'Server Bowl',
              totalGrams: 300,
              calories: 480,
              carbs: 60,
              proteins: 30,
              fats: 12,
              ingredientCost: null,
              imageUrl: null,
              createdAt: '2026-06-28T09:00:00.000Z',
              updatedAt: '2026-06-28T09:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          log: {
            id: 'portion-log-1',
            ownerUid: 'server-user-1',
            mealId: 'server-meal-1',
            consumedGrams: 150,
            snapshot: { calories: 240, carbs: 30, proteins: 15, fats: 6 },
            loggedAt: '2026-06-28T10:00:00.000Z',
            planId: null,
            planType: null,
            sourceKind: null,
            ownerProfessionalUid: null,
            connectionId: null,
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      );
    },
  } as any);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'http://server.test/nutrition/custom-meals/server-meal-1');
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].headers.get('authorization'), 'Bearer server-token');
  assert.equal(requests[1].url, 'http://server.test/nutrition/portion-logs');
  assert.equal(requests[1].method, 'POST');
  assert.deepEqual(await requests[1].json(), {
    mealId: 'server-meal-1',
    consumedGrams: 150,
    snapshot: { calories: 240, carbs: 30, proteins: 15, fats: 6 },
    planId: null,
    planType: null,
    sourceKind: null,
    ownerProfessionalUid: null,
    connectionId: null,
  });
});

test('custom meal E2E fixture exposes library CRUD, share, and portion logging through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousCustomMealFixture = process.env.EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE = 'basic';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const initialMeals = await getMyCustomMeals();
    assert.deepEqual(
      initialMeals.map((meal) => ({
        id: meal.id,
        name: meal.name,
        totalGrams: meal.totalGrams,
        calories: meal.calories,
        ownerUid: meal.ownerUid,
      })),
      [
        {
          id: 'e2e-custom-meal',
          name: 'E2E Recovery Bowl',
          totalGrams: 300,
          calories: 480,
          ownerUid: 'e2e-auth-session-user',
        },
      ]
    );

    const created = await createCustomMeal({
      name: 'E2E Created Meal',
      totalGrams: 250,
      calories: 400,
      carbs: 42,
      proteins: 30,
      fats: 12,
      ingredientCost: 7.5,
      imageUrl: null,
    });
    assert.match(created.id, /^e2e-custom-meal-created-\d+$/);

    const updated = await updateCustomMeal(created.id, {
      name: 'E2E Updated Meal',
      totalGrams: 275,
      calories: 420,
      carbs: 44,
      proteins: 32,
      fats: 13,
      ingredientCost: null,
      imageUrl: 'https://example.test/meal.jpg',
    });
    assert.equal(updated.name, 'E2E Updated Meal');
    assert.equal(updated.imageUrl, 'https://example.test/meal.jpg');

    assert.deepEqual(await createMealShareLink('e2e-custom-meal'), {
      shareLinkId: 'e2e-share-e2e-custom-meal',
    });

    await logPortionFromSource('e2e-custom-meal', 150);
    const logs = await getTodayPortionLogs();
    const customLog = logs.find((log) => log.mealId === 'e2e-custom-meal');
    assert.deepEqual(
      customLog && {
        ownerUid: customLog.ownerUid,
        consumedGrams: customLog.consumedGrams,
        calories: customLog.snapshot.calories,
        carbs: customLog.snapshot.carbs,
      },
      {
        ownerUid: 'e2e-auth-session-user',
        consumedGrams: 150,
        calories: 240,
        carbs: 27.5,
      }
    );

    await deleteCustomMeal(created.id);
    assert.equal((await getMyCustomMeals()).some((meal) => meal.id === created.id), false);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousCustomMealFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE = previousCustomMealFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

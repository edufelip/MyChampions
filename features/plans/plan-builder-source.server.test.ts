import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;

const reactNativePath = require.resolve('react-native');
require.cache[reactNativePath] = {
  id: reactNativePath,
  filename: reactNativePath,
  loaded: true,
  exports: { Platform: { OS: 'web' } },
} as any;

const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
require.cache[asyncStoragePath] = {
  id: asyncStoragePath,
  filename: asyncStoragePath,
  loaded: true,
  exports: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
} as any;

const expoConstantsPath = require.resolve('expo-constants');
require.cache[expoConstantsPath] = {
  id: expoConstantsPath,
  filename: expoConstantsPath,
  loaded: true,
  exports: {
    default: {
      expoConfig: {
        extra: {},
      },
    },
    expoConfig: {
      extra: {},
    },
  },
} as any;

const {
  addNutritionMeal,
  addNutritionMealItem,
  addTrainingSession,
  addTrainingSessionItem,
  createNutritionPlan,
  createTrainingPlan,
  deleteNutritionPlan,
  deleteTrainingPlan,
  getNutritionPlanDetail,
  getStarterTemplates,
  cloneStarterTemplate,
  removeNutritionMeal,
  removeNutritionMealItem,
  removeTrainingSession,
  removeTrainingSessionItem,
  reorderNutritionMealItems,
  reorderNutritionMeals,
  reorderTrainingSessionItems,
  reorderTrainingSessions,
  updateNutritionPlan,
  updateTrainingPlanWithSessions,
} = require('./plan-builder-source') as typeof import('./plan-builder-source');

function makeServerDeps(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): import('./plan-builder-source').PlanBuilderSourceDeps {
  return {
    getServerBaseUrl: () => 'http://server.test/',
    getCurrentAccessToken: async () => 'server-token',
    fetchFn: handler as AppFetch,
  } as import('./plan-builder-source').PlanBuilderSourceDeps;
}

describe('plan-builder server source', () => {
  it('invokes browser fetch dependencies with the global receiver', async () => {
    let requestUrl: string | null = null;
    const receiverAwareFetch = async function (
      this: typeof globalThis,
      input: RequestInfo | URL,
    ): Promise<Response> {
      assert.equal(this, globalThis);
      requestUrl = String(input);
      return new Response(JSON.stringify({ templates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const templates = await getStarterTemplates('nutrition', {
      getServerBaseUrl: () => 'http://server.test',
      getCurrentAccessToken: async () => 'server-token',
      fetchFn: receiverAwareFetch as AppFetch,
    });

    assert.equal(requestUrl, 'http://server.test/plans/starter-templates?planType=nutrition');
    assert.deepEqual(templates, []);
  });

  it('fails closed when no local server source is available outside E2E fixtures', async () => {
    const deps: import('./plan-builder-source').PlanBuilderSourceDeps = {
      getServerBaseUrl: () => undefined,
      getCurrentAccessToken: async () => null,
      fetchFn: (async () => {
        throw new Error('fetch should not run without server config and auth.');
      }) as AppFetch,
    };

    await assert.rejects(
      () => getNutritionPlanDetail('nutrition-plan-1', deps),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'PlanBuilderSourceError' &&
        (error as { code?: string }).code === 'configuration',
    );

    await assert.rejects(
      () =>
        createNutritionPlan(
          { name: 'Plan', hydrationGoalMl: '2000' },
          'professional_library',
          deps,
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'PlanBuilderSourceError' &&
        (error as { code?: string }).code === 'configuration',
    );

    await assert.rejects(
      () => addTrainingSession('training-plan-1', { name: 'Day A', notes: '' }, deps),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'PlanBuilderSourceError' &&
        (error as { code?: string }).code === 'configuration',
    );

    await assert.rejects(
      () => getStarterTemplates('nutrition', deps),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'PlanBuilderSourceError' &&
        (error as { code?: string }).code === 'configuration',
    );
  });

  it('gets starter templates from the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          templates: [
            {
              id: 'starter_nutrition_default_balance',
              planType: 'nutrition',
              name: 'Balanced Starter',
              description: 'Balanced calories and macros for kickoff.',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const templates = await getStarterTemplates('nutrition', deps);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/starter-templates?planType=nutrition');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(templates, [
      {
        id: 'starter_nutrition_default_balance',
        planType: 'nutrition',
        name: 'Balanced Starter',
        description: 'Balanced calories and macros for kickoff.',
      },
    ]);
  });

  it('clones starter templates through the MyChampions server clone endpoint', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          plan: {
            id: 'nutrition-clone-1',
            planType: 'nutrition',
            sourceKind: 'predefined',
            ownerProfessionalUid: 'professional-1',
            studentAuthUid: 'professional-1',
            isArchived: false,
            isDraft: false,
            name: 'Client Balanced Starter',
            hydrationGoalMl: null,
            caloriesTarget: 2000,
            carbsTarget: 220,
            proteinsTarget: 140,
            fatsTarget: 70,
            meals: [
              {
                id: 'meal-1',
                name: 'Breakfast',
                items: [
                  {
                    id: 'item-1',
                    name: 'Oats + banana breakfast',
                    quantity: '1 bowl',
                    notes: 'Morning',
                    sourceKind: 'manual',
                  },
                ],
              },
            ],
            createdAt: '2026-07-03T12:00:00.000Z',
            updatedAt: '2026-07-03T12:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const plan = await cloneStarterTemplate(
      { uid: 'professional-1' },
      'starter_nutrition_default_balance',
      'Client Balanced Starter',
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      'http://server.test/plans/starter-templates/starter_nutrition_default_balance/clone',
    );
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      name: 'Client Balanced Starter',
    });
    assert.deepEqual(plan, {
      id: 'nutrition-clone-1',
      planType: 'nutrition',
      name: 'Client Balanced Starter',
    });
  });

  it('gets nutrition plan detail from the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          plan: {
            id: 'nutrition-plan-1',
            planType: 'nutrition',
            sourceKind: 'assigned',
            ownerProfessionalUid: 'professional-1',
            studentAuthUid: 'student-1',
            isArchived: false,
            isDraft: true,
            name: 'Draft Nutrition',
            hydrationGoalMl: 2800,
            caloriesTarget: 2200,
            carbsTarget: 210,
            proteinsTarget: 160,
            fatsTarget: 70,
            meals: [
              {
                id: 'meal-1',
                name: 'Breakfast',
                items: [
                  {
                    id: 'item-1',
                    name: 'Greek yogurt',
                    quantity: '200 g',
                    notes: 'Add berries',
                    calories: 180,
                    carbs: 18,
                    proteins: 22,
                    fats: 2,
                    sourceKind: 'manual',
                  },
                ],
              },
            ],
            createdAt: '2026-06-29T10:00:00.000Z',
            updatedAt: '2026-06-29T11:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const plan = await getNutritionPlanDetail('nutrition-plan-1', deps);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/nutrition/nutrition-plan-1');
    assert.equal(requests[0].init?.method, 'GET');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(plan, {
      id: 'nutrition-plan-1',
      sourceKind: 'assigned',
      ownerProfessionalUid: 'professional-1',
      studentAuthUid: 'student-1',
      hydrationGoalMl: 2800,
      caloriesTarget: 2200,
      carbsTarget: 210,
      proteinsTarget: 160,
      fatsTarget: 70,
      meals: [
        {
          id: 'meal-1',
          name: 'Breakfast',
          items: [
            {
              id: 'item-1',
              name: 'Greek yogurt',
              quantity: '200 g',
              notes: 'Add berries',
              calories: 180,
              carbs: 18,
              proteins: 22,
              fats: 2,
              sourceKind: 'manual',
            },
          ],
        },
      ],
      isDraft: true,
      name: 'Draft Nutrition',
      createdAt: '2026-06-29T10:00:00.000Z',
      updatedAt: '2026-06-29T11:00:00.000Z',
    });
  });

  it('updates training sessions through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          plan: {
            id: 'training-plan-1',
            planType: 'training',
            sourceKind: 'assigned',
            ownerProfessionalUid: 'professional-1',
            studentAuthUid: 'student-1',
            isArchived: false,
            isDraft: false,
            name: 'Upper A',
            sessions: [
              {
                id: 'session-1',
                name: 'Upper A',
                notes: 'Controlled tempo',
                items: [
                  {
                    id: 'exercise-1',
                    name: 'Bench Press',
                    quantity: '3x8',
                    notes: 'RPE 8',
                    exerciseId: 'exercise-catalog-1',
                  },
                ],
              },
            ],
            createdAt: '2026-06-29T10:00:00.000Z',
            updatedAt: '2026-06-29T11:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const sessions = [
      {
        id: 'session-1',
        name: 'Upper A',
        notes: 'Controlled tempo',
        items: [
          {
            id: 'exercise-1',
            name: 'Bench Press',
            quantity: '3x8',
            notes: 'RPE 8',
            exerciseId: 'exercise-catalog-1',
          },
        ],
      },
    ];

    await updateTrainingPlanWithSessions(
      'training-plan-1',
      { name: ' Upper A ' },
      sessions,
      true,
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/training/training-plan-1');
    assert.equal(requests[0].init?.method, 'PATCH');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      name: 'Upper A',
      publish: true,
      sessions,
    });
  });

  it('maps subscription-required nutrition plan updates to a domain source error', async () => {
    const deps = makeServerDeps(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'professional_subscription_required',
              message: 'Professional subscription required.',
            },
          }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        ),
    );

    await assert.rejects(
      () =>
        updateNutritionPlan(
          'nutrition-plan-1',
          { name: 'Updated Nutrition', hydrationGoalMl: '2600' },
          true,
          deps,
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'PlanBuilderSourceError' &&
        (error as { code?: string }).code === 'graphql' &&
        error.message === 'Professional subscription required.',
    );
  });

  it('maps subscription-required training session mutations to a domain source error', async () => {
    const deps = makeServerDeps(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'professional_subscription_required',
              message: 'Professional subscription required.',
            },
          }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        ),
    );

    await assert.rejects(
      () => addTrainingSession('training-plan-1', { name: 'Upper A', notes: 'Tempo' }, deps),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'PlanBuilderSourceError' &&
        (error as { code?: string }).code === 'graphql' &&
        error.message === 'Professional subscription required.',
    );
  });

  it('creates nutrition plans through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          plan: {
            id: 'nutrition-created-1',
            planType: 'nutrition',
            sourceKind: 'self_managed',
            ownerProfessionalUid: null,
            studentAuthUid: 'student-1',
            isArchived: false,
            isDraft: false,
            name: 'New Nutrition',
            hydrationGoalMl: 2600,
            caloriesTarget: 0,
            carbsTarget: 0,
            proteinsTarget: 0,
            fatsTarget: 0,
            meals: [],
            createdAt: '2026-06-29T10:00:00.000Z',
            updatedAt: '2026-06-29T10:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const plan = await createNutritionPlan(
      { name: ' New Nutrition ', hydrationGoalMl: '2600' },
      'self_managed',
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/nutrition');
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      name: 'New Nutrition',
      hydrationGoalMl: 2600,
      mode: 'self_managed',
    });
    assert.deepEqual(plan, {
      id: 'nutrition-created-1',
      sourceKind: 'self_managed',
      ownerProfessionalUid: null,
      studentAuthUid: 'student-1',
      hydrationGoalMl: 2600,
      caloriesTarget: 0,
      carbsTarget: 0,
      proteinsTarget: 0,
      fatsTarget: 0,
      meals: [],
      isDraft: undefined,
      name: 'New Nutrition',
      createdAt: '2026-06-29T10:00:00.000Z',
      updatedAt: '2026-06-29T10:00:00.000Z',
    });
  });

  it('deletes training plans through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    });

    await deleteTrainingPlan('training-plan-1', deps);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/training/training-plan-1');
    assert.equal(requests[0].init?.method, 'DELETE');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
  });

  it('creates training plans through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          plan: {
            id: 'training-created-1',
            planType: 'training',
            sourceKind: 'predefined',
            ownerProfessionalUid: 'professional-1',
            studentAuthUid: 'professional-1',
            isArchived: false,
            isDraft: false,
            name: 'Strength Template',
            sessions: [],
            createdAt: '2026-06-29T10:00:00.000Z',
            updatedAt: '2026-06-29T10:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const plan = await createTrainingPlan(
      { name: ' Strength Template ' },
      'professional_library',
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/training');
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      name: 'Strength Template',
      mode: 'professional_library',
    });
    assert.equal(plan.id, 'training-created-1');
    assert.equal(plan.sourceKind, 'predefined');
    assert.deepEqual(plan.sessions, []);
  });

  it('deletes nutrition plans through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    });

    await deleteNutritionPlan('nutrition-plan-1', deps);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/nutrition/nutrition-plan-1');
    assert.equal(requests[0].init?.method, 'DELETE');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
  });

  it('adds nutrition meals through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          meal: { id: 'meal-created-1', name: 'Breakfast', items: [] },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const meal = await addNutritionMeal('nutrition-plan-1', { name: ' Breakfast ' }, deps);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/nutrition/nutrition-plan-1/meals');
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { name: 'Breakfast' });
    assert.deepEqual(meal, { id: 'meal-created-1', name: 'Breakfast', items: [] });
  });

  it('adds nutrition meal items through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          item: {
            id: 'item-created-1',
            name: 'Greek Yogurt',
            quantity: '200 g',
            notes: 'Add berries',
            calories: 180,
            carbs: 18,
            proteins: 22,
            fats: 2,
            sourceKind: 'manual',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const item = await addNutritionMealItem(
      'nutrition-plan-1',
      'meal-1',
      {
        name: ' Greek Yogurt ',
        quantity: '200 g',
        notes: 'Add berries',
        calories: 180,
        carbs: 18,
        proteins: 22,
        fats: 2,
        sourceKind: 'manual',
      },
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      'http://server.test/plans/nutrition/nutrition-plan-1/meals/meal-1/items',
    );
    assert.equal(requests[0].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      name: 'Greek Yogurt',
      quantity: '200 g',
      notes: 'Add berries',
      calories: 180,
      carbs: 18,
      proteins: 22,
      fats: 2,
      sourceKind: 'manual',
    });
    assert.deepEqual(item, {
      id: 'item-created-1',
      name: 'Greek Yogurt',
      quantity: '200 g',
      notes: 'Add berries',
      calories: 180,
      carbs: 18,
      proteins: 22,
      fats: 2,
      sourceKind: 'manual',
    });
  });

  it('removes and reorders nutrition meal payloads through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          plan: {
            id: 'nutrition-plan-1',
            planType: 'nutrition',
            sourceKind: 'self_managed',
            ownerProfessionalUid: null,
            studentAuthUid: 'student-1',
            isArchived: false,
            isDraft: false,
            name: 'Nutrition',
            hydrationGoalMl: 2400,
            caloriesTarget: 0,
            carbsTarget: 0,
            proteinsTarget: 0,
            fatsTarget: 0,
            meals: [],
            createdAt: '2026-06-29T10:00:00.000Z',
            updatedAt: '2026-06-29T11:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    await removeNutritionMeal('nutrition-plan-1', 'meal-1', deps);
    await reorderNutritionMeals('nutrition-plan-1', ['meal-2', 'meal-1'], deps);
    await removeNutritionMealItem('nutrition-plan-1', 'meal-1', 'item-1', deps);
    await reorderNutritionMealItems('nutrition-plan-1', 'meal-1', ['item-2', 'item-1'], deps);

    assert.deepEqual(
      requests.map((request) => [request.init?.method, request.url]),
      [
        ['DELETE', 'http://server.test/plans/nutrition/nutrition-plan-1/meals/meal-1'],
        ['PUT', 'http://server.test/plans/nutrition/nutrition-plan-1/meals/reorder'],
        ['DELETE', 'http://server.test/plans/nutrition/nutrition-plan-1/meals/meal-1/items/item-1'],
        ['PUT', 'http://server.test/plans/nutrition/nutrition-plan-1/meals/meal-1/items/reorder'],
      ],
    );
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { mealIds: ['meal-2', 'meal-1'] });
    assert.deepEqual(JSON.parse(String(requests[3].init?.body)), { itemIds: ['item-2', 'item-1'] });
  });

  it('adds training sessions through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          session: {
            id: 'session-created-1',
            name: 'Upper A',
            notes: 'Controlled tempo',
            items: [],
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const session = await addTrainingSession(
      'training-plan-1',
      { name: ' Upper A ', notes: ' Controlled tempo ' },
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://server.test/plans/training/training-plan-1/sessions');
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      name: 'Upper A',
      notes: 'Controlled tempo',
    });
    assert.deepEqual(session, {
      id: 'session-created-1',
      name: 'Upper A',
      notes: 'Controlled tempo',
      items: [],
    });
  });

  it('adds training session items through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          item: {
            id: 'training-item-created-1',
            name: 'Bench Press',
            quantity: '3x8',
            notes: 'RPE 8',
            exerciseId: 'exercise-catalog-1',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const item = await addTrainingSessionItem(
      'training-plan-1',
      'session-1',
      {
        name: ' Bench Press ',
        quantity: '3x8',
        notes: 'RPE 8',
        exerciseId: 'exercise-catalog-1',
      },
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      'http://server.test/plans/training/training-plan-1/sessions/session-1/items',
    );
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).authorization,
      'Bearer server-token',
    );
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      name: 'Bench Press',
      quantity: '3x8',
      notes: 'RPE 8',
      exerciseId: 'exercise-catalog-1',
    });
    assert.deepEqual(item, {
      id: 'training-item-created-1',
      name: 'Bench Press',
      quantity: '3x8',
      notes: 'RPE 8',
      exerciseId: 'exercise-catalog-1',
    });
  });

  it('removes and reorders training session payloads through the MyChampions server', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const deps = makeServerDeps(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          plan: {
            id: 'training-plan-1',
            planType: 'training',
            sourceKind: 'self_managed',
            ownerProfessionalUid: null,
            studentAuthUid: 'student-1',
            isArchived: false,
            isDraft: false,
            name: 'Training',
            sessions: [],
            createdAt: '2026-06-29T10:00:00.000Z',
            updatedAt: '2026-06-29T11:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    await removeTrainingSession('training-plan-1', 'session-1', deps);
    await reorderTrainingSessions('training-plan-1', ['session-2', 'session-1'], deps);
    await removeTrainingSessionItem('training-plan-1', 'session-1', 'item-1', deps);
    await reorderTrainingSessionItems('training-plan-1', 'session-1', ['item-2', 'item-1'], deps);

    assert.deepEqual(
      requests.map((request) => [request.init?.method, request.url]),
      [
        ['DELETE', 'http://server.test/plans/training/training-plan-1/sessions/session-1'],
        ['PUT', 'http://server.test/plans/training/training-plan-1/sessions/reorder'],
        [
          'DELETE',
          'http://server.test/plans/training/training-plan-1/sessions/session-1/items/item-1',
        ],
        [
          'PUT',
          'http://server.test/plans/training/training-plan-1/sessions/session-1/items/reorder',
        ],
      ],
    );
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
      sessionIds: ['session-2', 'session-1'],
    });
    assert.deepEqual(JSON.parse(String(requests[3].init?.body)), { itemIds: ['item-2', 'item-1'] });
  });
});

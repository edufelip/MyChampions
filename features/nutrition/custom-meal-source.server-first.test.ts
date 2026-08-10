import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
type ModuleWithLoad = typeof Module & { _load: ModuleLoad };

test('server-backed custom meal reads do not load Firestore at module import', async () => {
  const sourcePath = require.resolve('./custom-meal-source');
  delete require.cache[sourcePath];

  const moduleWithLoad = Module as ModuleWithLoad;
  const originalLoad = moduleWithLoad._load;
  const blockedLoads: string[] = [];

  moduleWithLoad._load = function patchedLoad(
    this: unknown,
    request: string,
    parent: NodeModule | null,
    isMain: boolean,
  ) {
    if (request === 'firebase/firestore') {
      blockedLoads.push(request);
      throw new Error('firebase/firestore should not load for server-backed custom meal reads');
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { getMyCustomMeals } =
      require('./custom-meal-source') as typeof import('./custom-meal-source');

    let captured: Request | null = null;
    const meals = await getMyCustomMeals({
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
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
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    } as any);

    assert.equal(meals.length, 1);
    assert.ok(captured);
    assert.deepEqual(blockedLoads, []);
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[sourcePath];
  }
});

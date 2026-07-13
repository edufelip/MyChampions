import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
type ModuleWithLoad = typeof Module & { _load: ModuleLoad };

test('server-backed plan reads do not load Firestore at module import', async () => {
  const sourcePath = require.resolve('./plan-source');
  delete require.cache[sourcePath];

  const moduleWithLoad = Module as ModuleWithLoad;
  const originalLoad = moduleWithLoad._load;
  const blockedLoads: string[] = [];

  moduleWithLoad._load = function patchedLoad(
    this: unknown,
    request: string,
    parent: NodeModule | null,
    isMain: boolean
  ) {
    if (request === 'firebase/firestore' || request === '../firestore') {
      blockedLoads.push(request);
      throw new Error(`${request} should not load for server-backed plan reads`);
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { getMyPlans } = require('./plan-source') as typeof import('./plan-source');

    let captured: Request | null = null;
    const plans = await getMyPlans({
      getFirestoreInstance: () => {
        throw new Error('Firestore fallback should not be called');
      },
      getCurrentAuthUid: () => {
        throw new Error('Firebase auth uid fallback should not be called');
      },
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = new Request(input, init);
        return new Response(
          JSON.stringify({
            plans: [
              {
                id: 'nutrition-plan-1',
                planType: 'nutrition',
                sourceKind: 'assigned',
                ownerProfessionalUid: 'professional-1',
                studentUid: 'student-1',
                isArchived: false,
                isDraft: false,
                name: 'Server Nutrition',
                hydrationGoalMl: 2800,
                caloriesTarget: 2200,
                carbsTarget: 210,
                proteinsTarget: 160,
                fatsTarget: 70,
                createdAt: '2026-06-29T10:00:00.000Z',
                updatedAt: '2026-06-29T10:00:00.000Z',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    } as any);

    assert.equal(plans[0]?.id, 'nutrition-plan-1');
    assert.ok(captured);
    assert.deepEqual(blockedLoads, []);
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[sourcePath];
  }
});

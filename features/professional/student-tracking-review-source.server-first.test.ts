import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
type ModuleWithLoad = typeof Module & { _load: ModuleLoad };

test('server-backed student tracking review does not load Firestore at module import', async () => {
  const sourcePath = require.resolve('./student-tracking-review-source');
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
      throw new Error('Firestore should not load for server-backed student tracking review');
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { getStudentTrackingReview } =
      require('./student-tracking-review-source') as typeof import('./student-tracking-review-source');

    const review = await getStudentTrackingReview('student-1', {
      todayKey: '2026-06-28',
      waterGoalMl: 2000,
    }, {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () =>
        new Response(JSON.stringify({
          waterLogs: [
            {
              id: 'water-today',
              dateKey: '2026-06-28',
              totalMl: 1500,
              loggedAt: '2026-06-28T12:00:00.000Z',
            },
          ],
          portionLogs: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    } as any);

    assert.equal(review.todayWater.totalMl, 1500);
    assert.deepEqual(blockedLoads, []);
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[sourcePath];
  }
});

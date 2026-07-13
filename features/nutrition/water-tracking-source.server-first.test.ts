import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
type ModuleWithLoad = typeof Module & { _load: ModuleLoad };

test('server-backed water logging does not load Firestore at module import', async () => {
  const sourcePath = require.resolve('./water-tracking-source');
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
    if (request === 'firebase/firestore') {
      blockedLoads.push(request);
      throw new Error('firebase/firestore should not load for server-backed water logging');
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { logWaterIntake } = require('./water-tracking-source') as typeof import('./water-tracking-source');

    const id = await logWaterIntake(250, '2026-06-28', {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            log: {
              id: 'server-user-1_2026-06-28',
              dateKey: '2026-06-28',
              totalMl: 750,
              loggedAt: '2026-06-28T10:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        ),
    } as any);

    assert.equal(id, 'server-user-1_2026-06-28');
    assert.deepEqual(blockedLoads, []);
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[sourcePath];
  }
});

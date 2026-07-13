import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
type ModuleWithLoad = typeof Module & { _load: ModuleLoad };

test('server-backed workout logging does not load Firestore at module import', async () => {
  const sourcePath = require.resolve('./workout-log-source');
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
      throw new Error('firebase/firestore should not load for server-backed workout logging');
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { logWorkoutSession } = require('./workout-log-source') as typeof import('./workout-log-source');

    let captured: Request | null = null;
    await logWorkoutSession('session-1', 'Server Strength', {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = new Request(input, init);
        return new Response(
          JSON.stringify({
            log: {
              id: 'server-log-1',
              ownerUid: 'server-user-1',
              sessionId: 'session-1',
              sessionName: 'Server Strength',
              createdAt: '2026-06-28T10:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      },
    } as any);

    assert.ok(captured);
    assert.deepEqual(blockedLoads, []);
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[sourcePath];
  }
});

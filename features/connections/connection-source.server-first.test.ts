import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
type ModuleWithLoad = typeof Module & { _load: ModuleLoad };

test('server-backed connection reads do not load Firestore at module import', async () => {
  const sourcePath = require.resolve('./connection-source');
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
      throw new Error('firebase/firestore should not load for server-backed connection reads');
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { getMyConnections } =
      require('./connection-source') as typeof import('./connection-source');

    const connections = await getMyConnections({
      getFirestoreInstance: () => {
        throw new Error('Firestore fallback should not be called');
      },
      getCurrentAuthUid: () => {
        throw new Error('Firebase auth uid fallback should not be called');
      },
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            connections: [
              {
                id: 'connection-1',
                status: 'active',
                canceledReason: null,
                specialty: 'nutritionist',
                professionalAuthUid: 'professional-1',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    } as any);

    assert.equal(connections[0]?.id, 'connection-1');
    assert.deepEqual(blockedLoads, []);
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[sourcePath];
  }
});

test('server connection reads keep a trimmed student display name and drop blank ones', async () => {
  const { getMyConnections } =
    require('./connection-source') as typeof import('./connection-source');
  const row = (id: string, studentDisplayName?: unknown) => ({
    id,
    status: 'pending_confirmation',
    canceledReason: null,
    specialty: 'fitness_coach',
    professionalAuthUid: 'professional-1',
    ...(studentDisplayName === undefined ? {} : { studentDisplayName }),
  });

  const connections = await getMyConnections({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          connections: [
            row('named', '  Pia Pending '),
            row('blank', '   '),
            row('null', null),
            row('absent'),
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  } as any);

  assert.equal(connections.find((c) => c.id === 'named')?.studentDisplayName, 'Pia Pending');
  for (const id of ['blank', 'null', 'absent'])
    assert.equal('studentDisplayName' in (connections.find((c) => c.id === id) ?? {}), false);
});

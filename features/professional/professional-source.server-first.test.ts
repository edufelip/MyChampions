import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
type ModuleWithLoad = typeof Module & { _load: ModuleLoad };

test('server-backed professional specialties do not load Firestore at module import', async () => {
  const sourcePath = require.resolve('./professional-source');
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
    if (request === 'firebase/firestore' || request === '../firestore') {
      blockedLoads.push(request);
      throw new Error(`${request} should not load for server-backed professional reads`);
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { getProfessionalSpecialties } =
      require('./professional-source') as typeof import('./professional-source');

    let captured: Request | null = null;
    const specialties = await getProfessionalSpecialties({
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = new Request(input, init);
        return new Response(
          JSON.stringify({
            specialties: [
              {
                id: 'professional-1_nutritionist',
                specialty: 'nutritionist',
                isActive: true,
                credential: null,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      generateInviteCode: () => {
        throw new Error('Client invite-code generation should not be used with server reads');
      },
    } as any);

    assert.deepEqual(specialties, [
      {
        id: 'professional-1_nutritionist',
        specialty: 'nutritionist',
        isActive: true,
        credential: null,
      },
    ]);
    assert.ok(captured);
    assert.deepEqual(blockedLoads, []);
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[sourcePath];
  }
});

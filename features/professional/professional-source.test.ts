import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearServerAuthSession,
  persistServerAuthSessionFromPayload,
} from '../auth/server-auth-source';
import {
  addProfessionalSpecialty,
  buildInviteCodeLookupPath,
  buildInviteCodePath,
  countUniqueActiveStudents,
  getActiveProfessionalStudentCount,
  getProfessionalSpecialties,
  getProfessionalStudentRoster,
  getProfessionalStudentAssignmentSnapshot,
  getOrCreateActiveInviteCode,
  type ProfessionalSourceDeps,
  ProfessionalSourceError,
  getSpecialtyBlockerCounts,
  removeProfessionalSpecialty,
  rotateInviteCode,
  upsertProfessionalCredential,
} from './professional-source';

test('getOrCreateActiveInviteCode nutritionist path uses professional invite subcollection', () => {
  assert.deepEqual(buildInviteCodePath('professional-uid', 'nutritionist'), [
    'professionals',
    'professional-uid',
    'inviteCodes',
    'nutritionist',
  ]);
});

test('getOrCreateActiveInviteCode fitness_coach path uses professional invite subcollection', () => {
  assert.deepEqual(buildInviteCodePath('professional-uid', 'fitness_coach'), [
    'professionals',
    'professional-uid',
    'inviteCodes',
    'fitness_coach',
  ]);
});

test('invite code lookup path uses code value as direct lookup id', () => {
  assert.deepEqual(buildInviteCodeLookupPath('FIT123'), ['inviteCodeLookups', 'FIT123']);
});

test('countUniqueActiveStudents counts each active student once across specialties', () => {
  assert.equal(
    countUniqueActiveStudents([
      { studentAuthUid: 'student-1', status: 'active' },
      { studentAuthUid: 'student-1', status: 'active' },
      { studentAuthUid: 'student-2', status: 'active' },
      { studentAuthUid: 'student-3', status: 'pending_confirmation' },
      { studentAuthUid: '', status: 'active' },
      { studentAuthUid: null, status: 'active' },
      { studentAuthUid: 'student-4', status: 'ended' },
    ]),
    2
  );
});

test('getOrCreateActiveInviteCode reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const result = await getOrCreateActiveInviteCode('nutritionist', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          inviteCode: {
            id: 'professional-1_nutritionist',
            codeValue: 'NUT123',
            specialty: 'nutritionist',
            status: 'active',
            rotatedAt: null,
            expiresAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with the server.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.deepEqual(result, {
    id: 'professional-1_nutritionist',
    codeValue: 'NUT123',
    specialty: 'nutritionist',
    status: 'active',
    rotatedAt: null,
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/invite-codes/nutritionist');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('rotateInviteCode posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const result = await rotateInviteCode('fitness_coach', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({
          inviteCode: {
            id: 'professional-1_fitness_coach',
            codeValue: 'FIT999',
            specialty: 'fitness_coach',
            status: 'active',
            rotatedAt: '2026-06-28T00:00:00.000Z',
            expiresAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with the server.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.deepEqual(result, {
    id: 'professional-1_fitness_coach',
    codeValue: 'FIT999',
    specialty: 'fitness_coach',
    status: 'active',
    rotatedAt: '2026-06-28T00:00:00.000Z',
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/invite-codes/fitness_coach/rotate');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('getProfessionalStudentRoster reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const roster = await getProfessionalStudentRoster({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({
        students: [
          {
            studentAuthUid: 'student-a',
            displayName: 'Ada Active',
            specialty: 'nutritionist',
            assignmentStatus: 'active',
            nutritionStatus: 'active',
            trainingStatus: 'none',
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with roster reads.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.deepEqual(roster, [
    {
      studentAuthUid: 'student-a',
      displayName: 'Ada Active',
      specialty: 'nutritionist',
      assignmentStatus: 'active',
      nutritionStatus: 'active',
      trainingStatus: 'none',
    },
  ]);
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/students');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('getProfessionalStudentAssignmentSnapshot reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const snapshot = await getProfessionalStudentAssignmentSnapshot('student-a', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({
        snapshot: {
          studentAuthUid: 'student-a',
          displayName: 'Ada Active',
          nutritionStatus: 'active',
          trainingStatus: 'pending',
          activeConnectionIds: ['connection-nutrition'],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with assignment snapshot reads.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.deepEqual(snapshot, {
    studentAuthUid: 'student-a',
    displayName: 'Ada Active',
    nutritionStatus: 'active',
    trainingStatus: 'pending',
    activeConnectionIds: ['connection-nutrition'],
  });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/students/student-a/assignment-snapshot');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('getActiveProfessionalStudentCount counts active students from the MyChampions server roster', async () => {
  let captured: Request | null = null;

  const count = await getActiveProfessionalStudentCount({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async function (this: unknown, input, init) {
      assert.equal(this, undefined);
      captured = new Request(input, init);
      return new Response(JSON.stringify({
        students: [
          {
            studentAuthUid: 'student-a',
            displayName: 'Ada Active',
            specialty: 'nutritionist',
            assignmentStatus: 'active',
            nutritionStatus: 'active',
            trainingStatus: 'none',
          },
          {
            studentAuthUid: 'student-b',
            displayName: 'Ben Pending',
            specialty: 'fitness_coach',
            assignmentStatus: 'pending',
            nutritionStatus: 'none',
            trainingStatus: 'pending',
          },
          {
            studentAuthUid: 'student-c',
            displayName: 'Cam Active',
            specialty: 'fitness_coach',
            assignmentStatus: 'active',
            nutritionStatus: 'none',
            trainingStatus: 'active',
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with active student count.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.equal(count, 2);
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/students');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('default professional roster fetch retains the browser global receiver', async () => {
  const originalFetch = globalThis.fetch;
  const originalServerUrl = process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL;
  let requestUrl: string | null = null;
  const authUid = 'firefox-professional-user';

  try {
    process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL = 'http://server.test';
    const receiverAwareFetch = async function (
      this: typeof globalThis,
      input: string | URL | Request
    ): Promise<Response> {
      assert.equal(this, globalThis);
      requestUrl = String(input);
      return new Response(JSON.stringify({
        students: [
          {
            studentAuthUid: 'student-a',
            displayName: 'Ada Active',
            specialty: 'nutritionist',
            assignmentStatus: 'active',
            nutritionStatus: 'active',
            trainingStatus: 'none',
          },
          {
            studentAuthUid: 'student-b',
            displayName: 'Ben Pending',
            specialty: 'fitness_coach',
            assignmentStatus: 'pending',
            nutritionStatus: 'none',
            trainingStatus: 'pending',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    globalThis.fetch = receiverAwareFetch as typeof globalThis.fetch;

    await persistServerAuthSessionFromPayload({
      accessToken: 'server-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authProviderIds: ['email_password'],
      profile: {
        authUid,
        displayName: 'Firefox Professional User',
        emailNormalized: 'firefox-professional@example.test',
        lockedRole: 'professional',
        acceptedTermsVersion: null,
        createdAt: '2026-07-24T19:00:00.000Z',
        updatedAt: '2026-07-24T19:00:00.000Z',
      },
    });

    const count = await getActiveProfessionalStudentCount();

    assert.equal(requestUrl, 'http://server.test/professional/students');
    assert.equal(count, 1);
  } finally {
    clearServerAuthSession();
    globalThis.fetch = originalFetch;
    if (originalServerUrl === undefined) {
      delete process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL;
    } else {
      process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL = originalServerUrl;
    }
  }
});

test('getProfessionalSpecialties reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const specialties = await getProfessionalSpecialties({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({
        specialties: [
          {
            id: 'professional-1_nutritionist',
            specialty: 'nutritionist',
            isActive: true,
            credential: {
              id: 'professional-1_nutritionist',
              specialty: 'nutritionist',
              credentialType: 'professional_registry',
              registryId: 'CRN-123',
              authority: 'CRN',
              country: 'BR',
            },
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with specialty reads.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.deepEqual(specialties, [
    {
      id: 'professional-1_nutritionist',
      specialty: 'nutritionist',
      isActive: true,
      credential: {
        id: 'professional-1_nutritionist',
        specialty: 'nutritionist',
        credentialType: 'professional_registry',
        registryId: 'CRN-123',
        authority: 'CRN',
        country: 'BR',
      },
    },
  ]);
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/specialties');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('addProfessionalSpecialty posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const result = await addProfessionalSpecialty('fitness_coach', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({
        specialty: {
          id: 'professional-1_fitness_coach',
          specialty: 'fitness_coach',
          isActive: true,
          credential: null,
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with specialty adds.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.deepEqual(result, {
    id: 'professional-1_fitness_coach',
    specialty: 'fitness_coach',
  });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/specialties');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
  assert.equal(await (captured as Request).text(), JSON.stringify({ specialty: 'fitness_coach' }));
});

test('getSpecialtyBlockerCounts reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const counts = await getSpecialtyBlockerCounts('nutritionist', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({ activeCount: 1, pendingCount: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with blocker counts.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.deepEqual(counts, { activeCount: 1, pendingCount: 2 });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/specialties/nutritionist/blockers');
  assert.equal((captured as Request).method, 'GET');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('removeProfessionalSpecialty deletes through the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  await removeProfessionalSpecialty('professional-1_nutritionist', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(null, { status: 204 });
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with specialty removal.');
    },
  } satisfies ProfessionalSourceDeps);

  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/professional/specialties/professional-1_nutritionist');
  assert.equal((captured as Request).method, 'DELETE');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('removeProfessionalSpecialty maps server last-specialty blocker', async () => {
  await assert.rejects(
    () => removeProfessionalSpecialty('professional-1_nutritionist', {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () => new Response(JSON.stringify({
        error: {
          code: 'last_specialty',
          message: 'Cannot remove last active Specialty.',
        },
      }), { status: 409, headers: { 'content-type': 'application/json' } }),
      generateInviteCode: () => {
        throw new Error('Client invite-code generation should not be used with server removal blocker mapping.');
      },
    } satisfies ProfessionalSourceDeps),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'graphql' &&
      error.message.includes('last active Specialty')
  );
});

test('removeProfessionalSpecialty fails closed without local server auth', async () => {
  let providerTokenCalls = 0;
  let functionUrlCalls = 0;
  const providerTokenProperty = ['get', 'Current', 'Id', 'Token'].join('');
  const functionUrlProperty = ['get', 'Remove', 'Specialty', 'Function', 'Url'].join('');

  const deps = new Proxy({
    getCurrentAccessToken: async () => null,
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async () => {
      throw new Error('Network should not be called without local server auth.');
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used with specialty removal.');
    },
  }, {
    get(target, property, receiver) {
      if (property === providerTokenProperty) {
        providerTokenCalls += 1;
        return async () => {
          throw new Error('Provider token fallback should not be used for specialty removal.');
        };
      }
      if (property === functionUrlProperty) {
        functionUrlCalls += 1;
        return () => {
          throw new Error('Function URL fallback should not be used for specialty removal.');
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as ProfessionalSourceDeps;

  await assert.rejects(
    () => removeProfessionalSpecialty('professional-1_nutritionist', deps),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'configuration' &&
      error.message.includes('local server auth')
  );
  assert.equal(providerTokenCalls, 0);
  assert.equal(functionUrlCalls, 0);
});

test('professional server-backed reads fail closed without local server auth', async () => {
  const deps = {
    getCurrentAccessToken: async () => null,
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async () => {
      throw new Error('Network should not be called without local server auth.');
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used without local server auth.');
    },
  } satisfies ProfessionalSourceDeps;

  await assert.rejects(
    () => getProfessionalSpecialties(deps),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Professional specialty reads requires local server auth')
  );
  await assert.rejects(
    () => getProfessionalStudentRoster(deps),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Professional student roster reads requires local server auth')
  );
  await assert.rejects(
    () => getOrCreateActiveInviteCode('nutritionist', deps),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Invite-code reads requires local server auth')
  );
});

test('professional server-backed mutations fail closed without local server auth', async () => {
  const deps = {
    getCurrentAccessToken: async () => null,
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async () => {
      throw new Error('Network should not be called without local server auth.');
    },
    generateInviteCode: () => {
      throw new Error('Client invite-code generation should not be used without local server auth.');
    },
  } satisfies ProfessionalSourceDeps;

  await assert.rejects(
    () => rotateInviteCode('fitness_coach', deps),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Invite-code rotation requires local server auth')
  );
  await assert.rejects(
    () => addProfessionalSpecialty('fitness_coach', deps),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Professional specialty creation requires local server auth')
  );
  await assert.rejects(
    () => upsertProfessionalCredential(
      'professional-1_fitness_coach',
      { registryId: 'CREF-1', authority: 'CREF', country: 'BR' },
      deps
    ),
    (error: unknown) => error instanceof ProfessionalSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Professional credential upsert requires local server auth')
  );
});

test('upsertProfessionalCredential writes through the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const result = await upsertProfessionalCredential(
    'professional-1_nutritionist',
    { registryId: 'CRN-456', authority: 'CRN', country: 'BR' },
    {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async (input, init) => {
        captured = new Request(input, init);
        return new Response(JSON.stringify({
          credential: {
            id: 'professional-1_nutritionist',
            specialty: 'nutritionist',
            credentialType: 'professional_registry',
            registryId: 'CRN-456',
            authority: 'CRN',
            country: 'BR',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
      generateInviteCode: () => {
        throw new Error('Client invite-code generation should not be used with credential upsert.');
      },
    } satisfies ProfessionalSourceDeps
  );

  assert.deepEqual(result, { id: 'professional-1_nutritionist' });
  assert.ok(captured);
  assert.equal(
    (captured as Request).url,
    'http://server.test/professional/specialties/professional-1_nutritionist/credential'
  );
  assert.equal((captured as Request).method, 'PUT');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
  assert.equal(await (captured as Request).text(), JSON.stringify({
    registryId: 'CRN-456',
    authority: 'CRN',
    country: 'BR',
  }));
});

test('E2E auth source keeps invite code create and rotate in memory', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    await addProfessionalSpecialty('nutritionist');
    const initial = await getOrCreateActiveInviteCode('nutritionist');

    assert.equal(initial?.status, 'active');
    assert.equal(initial?.specialty, 'nutritionist');
    assert.match(initial?.codeValue ?? '', /^E2E-[A-Z0-9]+$/);

    const rotated = await rotateInviteCode('nutritionist');

    assert.equal(rotated.status, 'active');
    assert.equal(rotated.specialty, 'nutritionist');
    assert.match(rotated.codeValue, /^E2E-[A-Z0-9]+$/);
    assert.notEqual(rotated.codeValue, initial?.codeValue);
    assert.equal((await getOrCreateActiveInviteCode('nutritionist'))?.codeValue, rotated.codeValue);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('E2E auth source can return a deterministic professional roster fixture', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousRosterFixture = process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE = 'basic';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const roster = await getProfessionalStudentRoster();

    assert.deepEqual(
      roster.map((student) => ({
        uid: student.studentAuthUid,
        name: student.displayName,
        assignmentStatus: student.assignmentStatus,
        nutritionStatus: student.nutritionStatus,
        trainingStatus: student.trainingStatus,
      })),
      [
        {
          uid: 'e2e-active-student',
          name: 'Ada Active',
          assignmentStatus: 'active',
          nutritionStatus: 'active',
          trainingStatus: 'none',
        },
        {
          uid: 'e2e-dual-student',
          name: 'Drew Dual',
          assignmentStatus: 'active',
          nutritionStatus: 'active',
          trainingStatus: 'active',
        },
        {
          uid: 'e2e-pending-student',
          name: 'Pia Pending',
          assignmentStatus: 'pending',
          nutritionStatus: 'none',
          trainingStatus: 'pending',
        },
      ]
    );
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousRosterFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE = previousRosterFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('E2E auth source can return a deterministic student assignment snapshot fixture', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousRosterFixture = process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE = 'basic';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    assert.deepEqual(
      await getProfessionalStudentAssignmentSnapshot('e2e-dual-student'),
      {
        studentAuthUid: 'e2e-dual-student',
        displayName: 'Drew Dual',
        nutritionStatus: 'active',
        trainingStatus: 'active',
        activeConnectionIds: [
          'e2e-connection-e2e-dual-student-nutritionist',
          'e2e-connection-e2e-dual-student-fitness_coach',
        ],
      }
    );
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousRosterFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE = previousRosterFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

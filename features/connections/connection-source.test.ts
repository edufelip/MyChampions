import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPendingConnectionFromInvite,
  confirmPendingConnection,
  ConnectionSourceError,
  type ConnectionSourceDeps,
  endConnection,
  getExistingInviteConnectionConflict,
  getMyConnections,
  isPendingStudentCapReached,
  submitInviteCode,
} from './connection-source';

test('submitInviteCode creates a pending connection with the specialty from the invite code', () => {
  const connection = buildPendingConnectionFromInvite({
    connectionId: 'conn-1',
    studentUid: 'student-uid',
    inviteDocId: 'fitness_coach',
    invite: {
      professionalAuthUid: 'professional-uid',
      codeValue: 'FIT123',
      specialty: 'fitness_coach',
    },
    timestamp: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(connection.specialty, 'fitness_coach');
  assert.equal(connection.sourceInviteCodeId, 'fitness_coach');
  assert.equal(connection.sourceInviteCodeValue, 'FIT123');
  assert.equal(connection.professionalAuthUid, 'professional-uid');
  assert.equal(connection.studentAuthUid, 'student-uid');
  assert.equal(connection.status, 'pending_confirmation');
});

test('pending cap counts unique students, not specialty-scoped request documents', () => {
  const pendingConnections = [
    { studentAuthUid: 'student-1' },
    { studentAuthUid: 'student-1' },
    { studentAuthUid: 'student-2' },
    { studentAuthUid: 'student-3' },
    { studentAuthUid: 'student-4' },
    { studentAuthUid: 'student-5' },
    { studentAuthUid: 'student-6' },
    { studentAuthUid: 'student-7' },
    { studentAuthUid: 'student-8' },
    { studentAuthUid: 'student-9' },
  ];

  assert.equal(isPendingStudentCapReached(pendingConnections, 'student-1'), false);
  assert.equal(isPendingStudentCapReached(pendingConnections, 'student-10'), false);
  assert.equal(isPendingStudentCapReached(pendingConnections, 'student-11', 9), true);
});

test('existing invite connection conflict treats active and pending as blockers', () => {
  assert.equal(getExistingInviteConnectionConflict([{ status: 'pending_confirmation' }]), 'pending');
  assert.equal(getExistingInviteConnectionConflict([{ status: 'active' }]), 'active');
  assert.equal(getExistingInviteConnectionConflict([{ status: 'ended' }]), null);
});

test('submitInviteCode posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const result = await submitInviteCode(' nut123 ', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({ connectionId: 'connection-1', status: 'pending_confirmation' }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      );
    },
  });

  assert.deepEqual(result, { connectionId: 'connection-1', status: 'pending_confirmation' });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/connections/invite-submissions');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
  assert.deepEqual(await (captured as Request).json(), { code: 'nut123' });
});

test('submitInviteCode fails closed without local server auth and never requests a provider token', async () => {
  let providerTokenCalls = 0;
  let functionUrlCalls = 0;
  const legacyTokenProperty = ['get', 'Current', 'Id', 'Token'].join('');
  const legacyFunctionUrlProperty = ['get', 'Submit', 'Invite', 'Function', 'Url'].join('');
  const deps = new Proxy({
    getCurrentAccessToken: async () => null,
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async () => {
      throw new Error('Network should not be called without local server auth.');
    },
  }, {
    get(target, property, receiver) {
      if (property === legacyTokenProperty) {
        providerTokenCalls += 1;
        return async () => {
          throw new Error('provider token fallback should not be used');
        };
      }
      if (property === legacyFunctionUrlProperty) {
        functionUrlCalls += 1;
        return () => {
          throw new Error('function URL fallback should not be used');
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as ConnectionSourceDeps;

  await assert.rejects(
    () => submitInviteCode('NUT123', deps),
    (error: unknown) => error instanceof Error && error.message.includes('local server auth')
  );

  assert.equal(providerTokenCalls, 0);
  assert.equal(functionUrlCalls, 0);
});

test('getMyConnections uses the dev E2E auth-session fixture through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousStudentNutritionFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
  const previousStudentTrainingFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  delete process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
  delete process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const connections = await getMyConnections();
    assert.deepEqual(connections, []);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousStudentNutritionFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = previousStudentNutritionFixture;

    if (previousStudentTrainingFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE = previousStudentTrainingFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('getMyConnections reads from the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const connections = await getMyConnections({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(
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
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  } as Parameters<typeof getMyConnections>[0] & {
    getCurrentAccessToken: () => Promise<string | null>;
    getServerBaseUrl: () => string | undefined;
  });

  assert.deepEqual(connections, [
    {
      id: 'connection-1',
      status: 'active',
      canceledReason: null,
      specialty: 'nutritionist',
      professionalAuthUid: 'professional-1',
    },
  ]);
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/connections');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('getMyConnections fails closed without local server auth', async () => {
  await assert.rejects(
    () => getMyConnections({
      getCurrentAccessToken: async () => null,
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () => {
        throw new Error('Network should not be called without local server auth.');
      },
    }),
    (error: unknown) =>
      error instanceof ConnectionSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Connection reads requires local server auth')
  );
});

test('confirmPendingConnection posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  const result = await confirmPendingConnection('connection-1', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({ connectionId: 'connection-1', status: 'active' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  } satisfies ConnectionSourceDeps);

  assert.deepEqual(result, { connectionId: 'connection-1', status: 'active' });
  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/connections/connection-1/confirm');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('confirmPendingConnection maps server subscription-required cap failures', async () => {
  await assert.rejects(
    () => confirmPendingConnection('connection-1', {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () => new Response(
        JSON.stringify({ error: 'professional_subscription_required' }),
        { status: 402, headers: { 'content-type': 'application/json' } }
      ),
    } satisfies ConnectionSourceDeps),
    (error: unknown) =>
      error instanceof ConnectionSourceError &&
      error.code === 'graphql' &&
      error.message.includes('Professional subscription required')
  );
});

test('confirmPendingConnection fails closed without local server auth', async () => {
  await assert.rejects(
    () => confirmPendingConnection('connection-1', {
      getCurrentAccessToken: async () => null,
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () => {
        throw new Error('Network should not be called without local server auth.');
      },
    }),
    (error: unknown) =>
      error instanceof ConnectionSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Connection confirmation requires local server auth')
  );
});

test('endConnection posts to the MyChampions server when a local bearer token is available', async () => {
  let captured: Request | null = null;

  await endConnection('connection-1', {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://server.test/',
    fetchFn: async (input, init) => {
      captured = new Request(input, init);
      return new Response(
        JSON.stringify({ connectionId: 'connection-1', status: 'ended' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  } satisfies ConnectionSourceDeps);

  assert.ok(captured);
  assert.equal((captured as Request).url, 'http://server.test/connections/connection-1/end');
  assert.equal((captured as Request).method, 'POST');
  assert.equal((captured as Request).headers.get('authorization'), 'Bearer server-token');
});

test('endConnection fails closed without local server auth', async () => {
  await assert.rejects(
    () => endConnection('connection-1', {
      getCurrentAccessToken: async () => null,
      getServerBaseUrl: () => 'http://server.test',
      fetchFn: async () => {
        throw new Error('Network should not be called without local server auth.');
      },
    }),
    (error: unknown) =>
      error instanceof ConnectionSourceError &&
      error.code === 'configuration' &&
      error.message.includes('Connection end requires local server auth')
  );
});

test('submitInviteCode creates a pending dev E2E fixture without backend mutation', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousInviteSubmitFixture = process.env.EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE = 'success';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const result = await submitInviteCode('NUT123');

    assert.deepEqual(result, {
      connectionId: 'e2e-pending-nutritionist-connection',
      status: 'pending_confirmation',
    });
    assert.deepEqual(await getMyConnections(), [
      {
        id: 'e2e-pending-nutritionist-connection',
        status: 'pending_confirmation',
        canceledReason: null,
        specialty: 'nutritionist',
        professionalAuthUid: 'e2e-nutritionist',
      },
    ]);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousInviteSubmitFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE = previousInviteSubmitFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('getMyConnections returns the assigned nutrition dev E2E fixture through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousStudentNutritionFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = 'assigned';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    assert.deepEqual(await getMyConnections(), [
      {
        id: 'e2e-active-nutritionist-connection',
        status: 'active',
        canceledReason: null,
        specialty: 'nutritionist',
        professionalAuthUid: 'e2e-nutritionist',
      },
    ]);
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

test('getMyConnections returns the assigned training dev E2E fixture through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousStudentTrainingFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE = 'assigned';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    assert.deepEqual(await getMyConnections(), [
      {
        id: 'e2e-active-fitness-coach-connection',
        status: 'active',
        canceledReason: null,
        specialty: 'fitness_coach',
        professionalAuthUid: 'e2e-fitness-coach',
      },
    ]);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousStudentTrainingFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE = previousStudentTrainingFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('endConnection marks the assigned nutrition dev E2E fixture ended through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousStudentNutritionFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = 'assigned';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    await endConnection('e2e-active-nutritionist-connection');

    assert.deepEqual(await getMyConnections(), [
      {
        id: 'e2e-active-nutritionist-connection',
        status: 'ended',
        canceledReason: null,
        specialty: 'nutritionist',
        professionalAuthUid: 'e2e-nutritionist',
      },
    ]);
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

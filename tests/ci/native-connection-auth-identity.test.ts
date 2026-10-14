import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import test from 'node:test';
import {
  startOwnedApiProxy,
  type NativeAuthIdentityObservation,
  type ProxyObservation,
} from '../../scripts/testing/owned-api-proxy';

const appOrigin = 'http://127.0.0.1:42001';
const fixtureAuthUids = ['coach', 'student'];
const fixtureAuthUidAllowlistHash = createHash('sha256')
  .update(JSON.stringify([...fixtureAuthUids].sort()))
  .digest('hex');

type ResponseSpec = {
  status: number;
  body: string;
  disconnect?: boolean;
};

type ProxySession = Parameters<typeof startOwnedApiProxy>[0]['session'];

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function createFakeOwnedSessionWithHandler(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(handler);
  const apiOrigin = await listen(server);
  const apiPid = process.pid;
  const session = {
    apiOrigin,
    apiPid,
    manifest: {
      port: 1,
      runId: 'auth-identity-unit',
      fixtureScopes: [],
      processes: [{ role: 'api', pid: apiPid }],
    },
    assertApiOwnership: () => Promise.resolve(apiOrigin),
  } as unknown as ProxySession;
  return { server, session, apiOrigin, apiPid };
}

async function createFakeOwnedSession(spec: ResponseSpec) {
  return createFakeOwnedSessionWithHandler((_request, response) => {
    response.writeHead(spec.status, { 'content-type': 'application/json' });
    if (spec.disconnect) {
      response.write(spec.body);
      response.destroy();
      return;
    }
    response.end(spec.body);
  });
}

async function withProxy(
  spec: ResponseSpec,
  callback: (
    proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>,
    context: Awaited<ReturnType<typeof createFakeOwnedSession>>,
  ) => void | Promise<void>,
  requestProfile: 'browser' | 'native' = 'native',
) {
  const context = await createFakeOwnedSession(spec);
  const proxy = await startOwnedApiProxy({
    session: context.session,
    appOrigin,
    requestProfile,
  });
  try {
    await callback(proxy, context);
  } finally {
    await proxy.stop();
    await close(context.server);
  }
}

async function nativeAuthRequest(
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>,
  route = '/auth/email/sign-in',
  body = JSON.stringify({
    email: 'fixture@example.test',
    password: 'fixture-password',
    sessionMode: 'bearer',
  }),
) {
  const response = await fetch(`${proxy.origin}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  return { response, body: await response.text() };
}

function authBody(authUid = 'coach') {
  return JSON.stringify({
    accessToken: 'access-token-secret',
    refreshToken: 'refresh-token-secret',
    profile: { authUid },
  });
}

function onlyIdentity(proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>) {
  assert.equal(proxy.nativeAuthIdentities.length, 1);
  return proxy.nativeAuthIdentities[0] as NativeAuthIdentityObservation;
}

void test('native auth identity capture binds one valid principal without retaining response secrets', async () => {
  await withProxy({ status: 201, body: authBody() }, async (proxy, context) => {
    proxy.enableNativeAuthIdentityCapture(fixtureAuthUids);
    const result = await nativeAuthRequest(proxy);
    assert.equal(result.response.status, 201);
    assert.equal(result.body, authBody());

    const identity = onlyIdentity(proxy);
    assert.deepEqual(identity, {
      requestId: 1,
      ordinal: 1,
      targetOrigin: context.apiOrigin,
      apiPid: context.apiPid,
      status: 201,
      authUid: 'coach',
      verification: 'verified',
      verificationReason: 'verified',
      fixtureAuthUidAllowlistHash,
    });
    const observation = proxy.observations.find((row) => row.requestId === identity.requestId);
    assert(observation);
    assert.equal(observation.outcome, 'forwarded');
    assert.equal(observation.status, 201);
    assert.equal(JSON.stringify(proxy.nativeAuthIdentities).includes('access-token-secret'), false);
    assert.equal(
      JSON.stringify(proxy.nativeAuthIdentities).includes('refresh-token-secret'),
      false,
    );
    assert.equal(
      JSON.stringify(proxy.nativeAuthIdentities).includes('fixture@example.test'),
      false,
    );
    assert.equal(JSON.stringify(proxy.nativeAuthIdentities).includes('fixture-password'), false);
  });
});

void test('native auth capture rejects malformed, missing, foreign, oversized and non-201 principals', async () => {
  const cases: {
    name: string;
    spec: ResponseSpec;
    expected: NativeAuthIdentityObservation['verificationReason'];
  }[] = [
    {
      name: 'malformed',
      spec: { status: 201, body: 'not-json' },
      expected: 'response-body-invalid-json',
    },
    {
      name: 'missing',
      spec: { status: 201, body: JSON.stringify({ profile: {} }) },
      expected: 'response-principal-missing',
    },
    {
      name: 'foreign',
      spec: { status: 201, body: authBody('foreign') },
      expected: 'response-principal-not-allowed',
    },
    {
      name: 'oversized',
      spec: {
        status: 201,
        body: JSON.stringify({ profile: { authUid: 'coach' }, padding: 'x'.repeat(16 * 1024) }),
      },
      expected: 'response-body-too-large',
    },
    { name: 'non-201', spec: { status: 503, body: authBody() }, expected: 'status-not-201' },
  ];
  for (const current of cases) {
    await withProxy(current.spec, async (proxy) => {
      proxy.enableNativeAuthIdentityCapture(fixtureAuthUids);
      const result = await nativeAuthRequest(proxy);
      assert.equal(result.response.status, current.spec.status, current.name);
      const identity = onlyIdentity(proxy);
      assert.equal(identity.verification, 'unverified', current.name);
      assert.equal(identity.verificationReason, current.expected, current.name);
      assert.equal(identity.authUid, null, current.name);
      assert.equal(JSON.stringify(identity).includes('access-token-secret'), false, current.name);
      assert.equal(JSON.stringify(identity).includes('refresh-token-secret'), false, current.name);
    });
  }
});

void test('native auth capture records ownership and transport failures as unverified evidence', async () => {
  await withProxy({ status: 201, body: authBody() }, async (proxy, context) => {
    proxy.enableNativeAuthIdentityCapture(fixtureAuthUids);
    (context.session as unknown as { apiPid: number }).apiPid += 1;
    const result = await nativeAuthRequest(proxy);
    assert.equal(result.response.status, 403);
    const identity = onlyIdentity(proxy);
    assert.equal(identity.verification, 'unverified');
    assert.equal(identity.verificationReason, 'upstream-identity-mismatch');
    assert.equal(identity.authUid, null);
  });

  await withProxy(
    { status: 201, body: '{"profile":{"authUid":"coach"}}', disconnect: true },
    async (proxy) => {
      proxy.enableNativeAuthIdentityCapture(fixtureAuthUids);
      await nativeAuthRequest(proxy).catch(() => undefined);
      const identity = onlyIdentity(proxy);
      assert.equal(identity.verification, 'unverified');
      assert.match(
        identity.verificationReason,
        /upstream-disconnected|response-body-incomplete|not-forwarded/,
      );
      assert.equal(identity.authUid, null);
    },
  );
});

void test('native auth capture is one-time, bounded, and must precede native authentication', async () => {
  await withProxy({ status: 201, body: authBody() }, (proxy) => {
    assert.throws(() => proxy.enableNativeAuthIdentityCapture([]), /fixture allowlist is invalid/);
    assert.throws(
      () => proxy.enableNativeAuthIdentityCapture(['coach', 'coach']),
      /fixture allowlist is invalid/,
    );
    assert.throws(
      () => proxy.enableNativeAuthIdentityCapture(['bad uid']),
      /fixture allowlist is invalid/,
    );
    assert.throws(
      () =>
        proxy.enableNativeAuthIdentityCapture(
          Array.from({ length: 33 }, (_, index) => `uid-${index}`),
        ),
      /fixture allowlist is invalid/,
    );
    proxy.enableNativeAuthIdentityCapture(fixtureAuthUids);
    assert.throws(
      () => proxy.enableNativeAuthIdentityCapture(fixtureAuthUids),
      /may only be enabled once/,
    );
  });

  await withProxy({ status: 201, body: authBody() }, async (proxy) => {
    const result = await nativeAuthRequest(proxy);
    assert.equal(result.response.status, 201);
    assert.throws(
      () => proxy.enableNativeAuthIdentityCapture(fixtureAuthUids),
      /must precede native authentication/,
    );
    assert.deepEqual(proxy.nativeAuthIdentities, []);
  });

  await withProxy(
    { status: 201, body: authBody() },
    (proxy) => {
      assert.throws(
        () => proxy.enableNativeAuthIdentityCapture(fixtureAuthUids),
        /requires native request profile/,
      );
    },
    'browser',
  );
});

void test('native auth capture requires the exact route and does not alter default transport observations', async () => {
  await withProxy({ status: 201, body: authBody() }, async (proxy) => {
    proxy.enableNativeAuthIdentityCapture(fixtureAuthUids);
    const result = await nativeAuthRequest(proxy, '/auth/email/sign-in?probe=1');
    assert.equal(result.response.status, 201);
    assert.deepEqual(proxy.nativeAuthIdentities, []);
    assert.equal(proxy.observations.length, 1);
    assert.equal(proxy.observations[0].outcome, 'forwarded');
  });

  await withProxy({ status: 201, body: authBody() }, async (proxy) => {
    const result = await nativeAuthRequest(proxy);
    assert.equal(result.response.status, 201);
    assert.deepEqual(proxy.nativeAuthIdentities, []);
    assert.equal(proxy.observations.length, 1);
    assert.equal(proxy.observations[0].outcome, 'forwarded');
  });
});

void test('auth fault injection remains outside the exact native auth capture target', async () => {
  await withProxy({ status: 201, body: authBody() }, async (proxy) => {
    proxy.enableNativeAuthIdentityCapture(fixtureAuthUids);
    await assert.rejects(
      proxy.armFault({
        attemptId: 'auth-injection',
        method: 'POST',
        path: '/auth/email/sign-in',
        accountUid: 'coach',
        accessToken: 'private-token',
      }),
      /exact declared training-plan save/,
    );
    assert.deepEqual(proxy.nativeAuthIdentities, []);
  });
});

void test('proxy observations expose only redacted credential presence', async () => {
  await withProxy({ status: 200, body: JSON.stringify({ ok: true }) }, async (proxy) => {
    const response = await fetch(`${proxy.origin}/me`, {
      headers: {
        authorization: 'Bearer private-token-value',
        cookie: 'session=private-cookie-value',
      },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    const observation = proxy.observations[0];
    assert(observation);
    assert.equal(observation.requestCredentialPresent, true);
    assert.equal(typeof observation.requestCredentialPresent, 'boolean');
    assert.deepEqual(observation.requestCredentialClassification, {
      authorization: 'bearer',
      cookie: 'present',
      knownAccessCookie: 'absent',
      knownRefreshCookie: 'absent',
      otherCookiePresent: true,
      malformedCookiePresent: false,
    });
    assert.equal(JSON.stringify(observation).includes('private-token-value'), false);
    assert.equal(JSON.stringify(observation).includes('private-cookie-value'), false);
  });

  await withProxy({ status: 200, body: JSON.stringify({ ok: true }) }, async (proxy) => {
    const response = await fetch(`${proxy.origin}/signed-out`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    const observation = proxy.observations[0];
    assert(observation);
    assert.equal(observation.requestCredentialPresent, false);
    assert.equal(typeof observation.requestCredentialPresent, 'boolean');
    assert.deepEqual(observation.requestCredentialClassification, {
      authorization: 'absent',
      cookie: 'absent',
      knownAccessCookie: 'absent',
      knownRefreshCookie: 'absent',
      otherCookiePresent: false,
      malformedCookiePresent: false,
    });
  });
});

void test('actual proxy distinguishes cookie-only credentials, empty headers and other auth schemes without values', async () => {
  const cases: {
    headers: Record<string, string>;
    expected: NonNullable<ProxyObservation['requestCredentialClassification']>;
  }[] = [
    {
      headers: { cookie: 'mychampions_access_token=private-access; mychampions_refresh_token=' },
      expected: {
        authorization: 'absent',
        cookie: 'present',
        knownAccessCookie: 'nonempty',
        knownRefreshCookie: 'empty',
        otherCookiePresent: false,
        malformedCookiePresent: false,
      },
    },
    {
      headers: { authorization: '', cookie: '' },
      expected: {
        authorization: 'empty',
        cookie: 'empty',
        knownAccessCookie: 'absent',
        knownRefreshCookie: 'absent',
        otherCookiePresent: false,
        malformedCookiePresent: false,
      },
    },
    {
      headers: {
        authorization: 'Basic private-basic',
        cookie:
          'mychampions_access_token=; mychampions_access_token=private-access; unknown-private-name=private-other; malformed-private',
      },
      expected: {
        authorization: 'other',
        cookie: 'present',
        knownAccessCookie: 'nonempty',
        knownRefreshCookie: 'absent',
        otherCookiePresent: true,
        malformedCookiePresent: true,
      },
    },
  ];
  await withProxy({ status: 200, body: JSON.stringify({ ok: true }) }, async (proxy) => {
    for (const row of cases) {
      const response = await fetch(`${proxy.origin}/analytics/events`, {
        headers: row.headers,
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200);
      const observation = proxy.observations.at(-1);
      assert(observation);
      assert.equal(observation.requestCredentialPresent, true);
      assert.deepEqual(observation.requestCredentialClassification, row.expected);
      assert.equal(
        /private-|unknown-private-name|malformed-private/.test(JSON.stringify(observation)),
        false,
      );
    }
  });
});

void test('requestIdFence tracks started requests when completions arrive out of order', async () => {
  let releaseSlow!: () => void;
  let markSlowSeen!: () => void;
  const slowSeen = new Promise<void>((resolve) => {
    markSlowSeen = resolve;
  });
  const slowRelease = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const context = await createFakeOwnedSessionWithHandler((request, response) => {
    if (request.url === '/slow') {
      markSlowSeen();
      void slowRelease.then(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ route: 'slow' }));
      });
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ route: request.url }));
  });
  const proxy = await startOwnedApiProxy({
    session: context.session,
    appOrigin,
    requestProfile: 'native',
  });
  try {
    const slowRequest = fetch(`${proxy.origin}/slow`, {
      signal: AbortSignal.timeout(5_000),
    });
    await slowSeen;
    const fastResponse = await fetch(`${proxy.origin}/fast`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(fastResponse.status, 200);
    assert.equal(proxy.requestIdFence, 2);
    assert.deepEqual(
      proxy.observations.map((row) => row.requestId),
      [2],
    );

    releaseSlow();
    const slowResponse = await slowRequest;
    assert.equal(slowResponse.status, 200);
    assert.equal(proxy.requestIdFence, 2);
    assert.deepEqual(
      proxy.observations.map((row) => row.requestId),
      [2, 1],
    );
  } finally {
    await proxy.stop();
    await close(context.server);
  }
});

void test('proxy stop drains destroyed in-flight streams before exposing final observations', async () => {
  let markSlowSeen!: () => void;
  let releaseSlow!: () => void;
  const slowSeen = new Promise<void>((resolve) => {
    markSlowSeen = resolve;
  });
  const slowRelease = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const context = await createFakeOwnedSessionWithHandler((request, response) => {
    if (request.url === '/slow') {
      markSlowSeen();
      void slowRelease.then(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ route: 'slow' }));
      });
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ route: request.url }));
  });
  const proxy = await startOwnedApiProxy({
    session: context.session,
    appOrigin,
    requestProfile: 'native',
  });
  try {
    const pending = fetch(`${proxy.origin}/slow`, {
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
    await slowSeen;
    const stopping = proxy.stop();
    releaseSlow();
    await stopping;
    await pending;
    const finalObservations = proxy.observations;
    assert.equal(finalObservations.length, 1);
    assert.equal(finalObservations[0]?.requestId, 1);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(proxy.observations, finalObservations);
  } finally {
    await proxy.stop();
    await close(context.server);
  }
});

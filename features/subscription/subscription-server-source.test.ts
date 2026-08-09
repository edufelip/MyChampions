import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getSubscriptionEntitlementSnapshot,
  syncSubscriptionEntitlementSnapshot,
  SubscriptionServerSourceError,
} from './subscription-server-source';
import {
  clearServerAuthSession,
  persistServerAuthSessionFromPayload,
} from '../auth/server-auth-source';

test('syncSubscriptionEntitlementSnapshot posts RevenueCat-derived statuses to the MyChampions server', async () => {
  const requests: { input: string | URL | Request; init?: RequestInit }[] = [];

  await syncSubscriptionEntitlementSnapshot(
    {
      professionalEntitlementStatus: 'active',
      aiEntitlementStatus: 'lapsed',
      professionalEntitlementExpiresAt: '2026-08-03T16:45:00.000Z',
      professionalEntitlementRenewalRisk: true,
      activeStudentCount: 7,
      observedAt: '2026-07-03T16:45:00.000Z',
    },
    {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://localhost:3400/',
      fetchFn: async function (this: unknown, input, init) {
        assert.equal(this, undefined);
        requests.push({ input, init });
        return new Response(JSON.stringify({ snapshot: { id: 'snapshot-1' } }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(
    String(requests[0].input),
    'http://localhost:3400/subscription/entitlements/snapshot',
  );
  assert.equal(requests[0].init?.method, 'POST');
  assert.deepEqual(requests[0].init?.headers, {
    authorization: 'Bearer server-token',
    'content-type': 'application/json',
  });
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    professionalEntitlementStatus: 'active',
    aiEntitlementStatus: 'lapsed',
    professionalEntitlementExpiresAt: '2026-08-03T16:45:00.000Z',
    professionalEntitlementRenewalRisk: true,
    activeStudentCount: 7,
    observedAt: '2026-07-03T16:45:00.000Z',
  });
});

test('syncSubscriptionEntitlementSnapshot fails closed without local server auth', async () => {
  await assert.rejects(
    () =>
      syncSubscriptionEntitlementSnapshot(
        {
          professionalEntitlementStatus: 'active',
          aiEntitlementStatus: 'active',
        },
        {
          getCurrentAccessToken: async () => null,
          getServerBaseUrl: () => 'http://localhost:3400',
          fetchFn: async () => {
            throw new Error('fetch should not run');
          },
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'unauthenticated');
      return true;
    },
  );
});

test('syncSubscriptionEntitlementSnapshot requires a configured server URL', async () => {
  await assert.rejects(
    () =>
      syncSubscriptionEntitlementSnapshot(
        {
          professionalEntitlementStatus: 'active',
          aiEntitlementStatus: 'lapsed',
        },
        {
          getCurrentAccessToken: async () => 'server-token',
          getServerBaseUrl: () => undefined,
          fetchFn: async () => {
            throw new Error('fetch should not run');
          },
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'configuration');
      return true;
    },
  );
});

test('syncSubscriptionEntitlementSnapshot fills safe optional defaults', async () => {
  let requestBodyJson = '';

  await syncSubscriptionEntitlementSnapshot(
    {
      professionalEntitlementStatus: 'lapsed',
      aiEntitlementStatus: 'unknown',
    },
    {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://localhost:3400',
      fetchFn: async (_input, init) => {
        requestBodyJson = String(init?.body);
        return new Response(null, { status: 202 });
      },
    },
  );

  const requestBody = JSON.parse(requestBodyJson) as Record<string, unknown>;
  assert.equal(requestBody?.professionalEntitlementExpiresAt, null);
  assert.equal(requestBody?.professionalEntitlementRenewalRisk, false);
  assert.equal(requestBody?.activeStudentCount, null);
  assert.equal(typeof requestBody?.observedAt, 'string');
  assert.equal(Number.isFinite(new Date(String(requestBody?.observedAt)).getTime()), true);
});

test('syncSubscriptionEntitlementSnapshot normalizes transport and response failures', async () => {
  const baseDeps = {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://localhost:3400',
  };

  await assert.rejects(
    () =>
      syncSubscriptionEntitlementSnapshot(
        { professionalEntitlementStatus: 'active', aiEntitlementStatus: 'lapsed' },
        {
          ...baseDeps,
          fetchFn: async () => {
            throw new Error('offline');
          },
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'network');
      return true;
    },
  );

  for (const [status, expectedCode] of [
    [401, 'unauthenticated'],
    [503, 'invalid_response'],
  ] as const) {
    await assert.rejects(
      () =>
        syncSubscriptionEntitlementSnapshot(
          { professionalEntitlementStatus: 'active', aiEntitlementStatus: 'lapsed' },
          {
            ...baseDeps,
            fetchFn: async () => new Response(null, { status }),
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionServerSourceError);
        assert.equal(err.code, expectedCode);
        return true;
      },
    );
  }
});

test('syncSubscriptionEntitlementSnapshot rejects when the server session has changed users', async () => {
  let requestCount = 0;

  await assert.rejects(
    () =>
      syncSubscriptionEntitlementSnapshot(
        {
          professionalEntitlementStatus: 'active',
          aiEntitlementStatus: 'active',
        },
        {
          getCurrentAccessToken: async () => 'server-token-for-a-different-user',
          getCurrentAuthUid: () => 'server-user-b',
          getServerBaseUrl: () => 'http://localhost:3400',
          fetchFn: async () => {
            requestCount += 1;
            return new Response(null, { status: 202 });
          },
        },
        'server-user-a',
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'unauthenticated');
      return true;
    },
  );

  assert.equal(requestCount, 0);
});

test('syncSubscriptionEntitlementSnapshot rejects when the server session changes while resolving its token', async () => {
  let currentAuthUid = 'server-user-a';
  let requestCount = 0;

  await assert.rejects(
    () =>
      syncSubscriptionEntitlementSnapshot(
        {
          professionalEntitlementStatus: 'active',
          aiEntitlementStatus: 'active',
        },
        {
          getCurrentAccessToken: async () => {
            currentAuthUid = 'server-user-b';
            return 'server-token-for-a-user-that-has-signed-out';
          },
          getCurrentAuthUid: () => currentAuthUid,
          getServerBaseUrl: () => 'http://localhost:3400',
          fetchFn: async () => {
            requestCount += 1;
            return new Response(null, { status: 202 });
          },
        },
        'server-user-a',
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'unauthenticated');
      return true;
    },
  );

  assert.equal(requestCount, 0);
});

test('getSubscriptionEntitlementSnapshot reads the current local server snapshot', async () => {
  const requests: { input: string | URL | Request; init?: RequestInit }[] = [];
  const snapshot = await getSubscriptionEntitlementSnapshot({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://localhost:3400/',
    fetchFn: async (input, init) => {
      requests.push({ input, init });
      return new Response(
        JSON.stringify({
          snapshot: {
            authUid: 'auth-1',
            professionalEntitlementStatus: 'lapsed',
            aiEntitlementStatus: 'active',
            professionalEntitlementExpiresAt: '2026-08-03T16:45:00.000Z',
            professionalEntitlementRenewalRisk: true,
            activeStudentCount: 9,
            source: 'revenuecat',
            observedAt: '2026-07-03T17:45:00.000Z',
            updatedAt: '2026-07-03T17:46:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(
    String(requests[0].input),
    'http://localhost:3400/subscription/entitlements/snapshot',
  );
  assert.equal(requests[0].init?.method, 'GET');
  assert.deepEqual(requests[0].init?.headers, {
    authorization: 'Bearer server-token',
  });
  assert.deepEqual(snapshot, {
    authUid: 'auth-1',
    professionalEntitlementStatus: 'lapsed',
    aiEntitlementStatus: 'active',
    professionalEntitlementExpiresAt: '2026-08-03T16:45:00.000Z',
    professionalEntitlementRenewalRisk: true,
    activeStudentCount: 9,
    source: 'revenuecat',
    observedAt: '2026-07-03T17:45:00.000Z',
    updatedAt: '2026-07-03T17:46:00.000Z',
  });
});

test('default subscription fetch retains the browser global receiver', async () => {
  const originalFetch = globalThis.fetch;
  const originalServerUrl = process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL;
  const authUid = 'firefox-receiver-user';
  let requestUrl: string | null = null;

  try {
    process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL = 'http://server.test';
    const receiverAwareFetch = async function (
      this: typeof globalThis,
      input: string | URL | Request,
    ): Promise<Response> {
      assert.equal(this, globalThis);
      requestUrl = String(input);
      return new Response(
        JSON.stringify({
          snapshot: {
            authUid,
            professionalEntitlementStatus: 'active',
            aiEntitlementStatus: 'lapsed',
            professionalEntitlementExpiresAt: null,
            professionalEntitlementRenewalRisk: false,
            activeStudentCount: 3,
            source: 'revenuecat',
            observedAt: '2026-07-24T18:30:00.000Z',
            updatedAt: '2026-07-24T18:31:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
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
        displayName: 'Firefox Receiver User',
        emailNormalized: 'firefox-receiver@example.test',
        lockedRole: 'professional',
        acceptedTermsVersion: null,
        createdAt: '2026-07-24T18:00:00.000Z',
        updatedAt: '2026-07-24T18:00:00.000Z',
      },
    });

    const snapshot = await getSubscriptionEntitlementSnapshot(undefined, authUid);

    assert.equal(requestUrl, 'http://server.test/subscription/entitlements/snapshot');
    assert.equal(snapshot?.authUid, authUid);
    assert.equal(snapshot?.professionalEntitlementStatus, 'active');
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

test('getSubscriptionEntitlementSnapshot returns null when the server has no snapshot', async () => {
  const snapshot = await getSubscriptionEntitlementSnapshot({
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://localhost:3400',
    fetchFn: async () =>
      new Response(JSON.stringify({ snapshot: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  assert.equal(snapshot, null);
});

test('getSubscriptionEntitlementSnapshot rejects a stale snapshot for another user', async () => {
  await assert.rejects(
    () =>
      getSubscriptionEntitlementSnapshot(
        {
          getCurrentAccessToken: async () => 'server-token',
          getCurrentAuthUid: () => 'auth-current',
          getServerBaseUrl: () => 'http://localhost:3400',
          fetchFn: async () =>
            new Response(
              JSON.stringify({
                snapshot: {
                  authUid: 'auth-stale',
                  professionalEntitlementStatus: 'active',
                  aiEntitlementStatus: 'active',
                  professionalEntitlementExpiresAt: null,
                  professionalEntitlementRenewalRisk: false,
                  activeStudentCount: 1,
                  source: 'revenuecat',
                  observedAt: '2026-07-03T17:45:00.000Z',
                  updatedAt: '2026-07-03T17:46:00.000Z',
                },
              }),
              { status: 200 },
            ),
        },
        'auth-current',
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'unauthenticated');
      return true;
    },
  );
});

test('getSubscriptionEntitlementSnapshot rejects a session switch during the read', async () => {
  let currentAuthUid = 'auth-current';

  await assert.rejects(
    () =>
      getSubscriptionEntitlementSnapshot(
        {
          getCurrentAccessToken: async () => 'server-token',
          getCurrentAuthUid: () => currentAuthUid,
          getServerBaseUrl: () => 'http://localhost:3400',
          fetchFn: async () => {
            currentAuthUid = 'auth-next';
            return new Response(JSON.stringify({ snapshot: null }), { status: 200 });
          },
        },
        'auth-current',
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'unauthenticated');
      return true;
    },
  );
});

test('getSubscriptionEntitlementSnapshot rejects malformed transport responses', async () => {
  const baseDeps = {
    getCurrentAccessToken: async () => 'server-token',
    getServerBaseUrl: () => 'http://localhost:3400',
  };
  const cases: {
    code: 'network' | 'unauthenticated' | 'invalid_response';
    fetchFn: () => Promise<Response>;
  }[] = [
    {
      code: 'network',
      fetchFn: async () => {
        throw new Error('offline');
      },
    },
    {
      code: 'unauthenticated',
      fetchFn: async () => new Response(null, { status: 401 }),
    },
    {
      code: 'invalid_response',
      fetchFn: async () => new Response(null, { status: 502 }),
    },
    {
      code: 'invalid_response',
      fetchFn: async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    },
    {
      code: 'invalid_response',
      fetchFn: async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(
      () =>
        getSubscriptionEntitlementSnapshot({
          ...baseDeps,
          fetchFn: testCase.fetchFn,
        }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionServerSourceError);
        assert.equal(err.code, testCase.code);
        return true;
      },
    );
  }
});

test('getSubscriptionEntitlementSnapshot validates every snapshot field', async () => {
  const validSnapshot = {
    authUid: 'auth-1',
    professionalEntitlementStatus: 'active',
    aiEntitlementStatus: 'lapsed',
    professionalEntitlementExpiresAt: null,
    professionalEntitlementRenewalRisk: false,
    activeStudentCount: 1,
    source: 'revenuecat',
    observedAt: '2026-07-03T17:45:00.000Z',
    updatedAt: '2026-07-03T17:46:00.000Z',
  };
  const malformedSnapshots = [
    { ...validSnapshot, authUid: '' },
    { ...validSnapshot, professionalEntitlementStatus: 'granted' },
    { ...validSnapshot, aiEntitlementStatus: 'granted' },
    { ...validSnapshot, professionalEntitlementExpiresAt: 'not-a-date' },
    { ...validSnapshot, professionalEntitlementRenewalRisk: 'false' },
    { ...validSnapshot, activeStudentCount: -1 },
    { ...validSnapshot, activeStudentCount: 1.5 },
    { ...validSnapshot, source: 'client' },
    { ...validSnapshot, observedAt: 'not-a-date' },
    { ...validSnapshot, updatedAt: '' },
  ];

  for (const snapshot of malformedSnapshots) {
    await assert.rejects(
      () =>
        getSubscriptionEntitlementSnapshot({
          getCurrentAccessToken: async () => 'server-token',
          getServerBaseUrl: () => 'http://localhost:3400',
          fetchFn: async () =>
            new Response(JSON.stringify({ snapshot }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionServerSourceError);
        assert.equal(err.code, 'invalid_response');
        return true;
      },
    );
  }
});

test('useSubscription syncs entitlement snapshots through the server source boundary', () => {
  const hookSource = readFileSync(join(__dirname, 'use-subscription.ts'), 'utf8');

  assert.match(hookSource, /syncSubscriptionEntitlementSnapshot/);
  assert.match(hookSource, /professionalEntitlementStatus/);
  assert.match(hookSource, /aiEntitlementStatus/);
  assert.equal(
    hookSource.includes('until server-side subscription enforcement replaces mobile-only gates'),
    false,
    'useSubscription still describes server-side subscription enforcement as future work',
  );
  assert.match(
    hookSource,
    /production cap-sensitive writes use signed webhook entitlement snapshots/,
  );
});

test('useSubscription can hydrate from a server-owned snapshot when native entitlement reads fail', () => {
  const hookSource = readFileSync(join(__dirname, 'use-subscription.ts'), 'utf8');

  assert.match(hookSource, /getSubscriptionEntitlementSnapshot/);
  assert.match(hookSource, /applyServerSnapshotFallback/);
  assert.match(hookSource, /serverSnapshot\.professionalEntitlementStatus/);
  assert.match(hookSource, /serverSnapshot\.aiEntitlementStatus/);
});

test('web useSubscription discards stale refresh completions after an account switch', () => {
  const hookSource = readFileSync(join(__dirname, 'use-subscription.web.ts'), 'utf8');

  assert.match(hookSource, /const currentAuthUidRef = useRef<string \| null>\(activeAuthUid\)/);
  assert.match(hookSource, /const expectedAuthUid = activeAuthUid/);
  assert.match(hookSource, /getSubscriptionEntitlementSnapshot\(undefined, expectedAuthUid\)/);
  assert.match(hookSource, /if \(currentAuthUidRef\.current !== expectedAuthUid\) return/);
  assert.match(
    hookSource,
    /if \(currentAuthUidRef\.current === expectedAuthUid\) \{\s*setIsLoading\(false\)/,
  );
});

test('web useSubscription resolves professional counts as explicit, dev E2E, then live', () => {
  const hookSource = readFileSync(join(__dirname, 'use-subscription.web.ts'), 'utf8');

  assert.match(
    hookSource,
    /import \{ resolveE2ESubscriptionOverride \} from '@\/features\/auth\/e2e-auth-session'/,
  );
  assert.match(
    hookSource,
    /import \{ getActiveProfessionalStudentCount \} from '@\/features\/professional\/professional-source'/,
  );
  assert.match(
    hookSource,
    /optionsOrActiveStudentCount\.loadProfessionalActiveStudentCount === true/,
  );
  assert.match(hookSource, /const e2eSubscriptionOverride = getE2ESubscriptionOverride\(\)/);
  assert.match(
    hookSource,
    /activeStudentCountOverride \?\? e2eSubscriptionOverride\?\.activeStudentCount/,
  );
  assert.match(hookSource, /isDev: typeof __DEV__ !== 'undefined' && __DEV__/);

  const countEffectStart = hookSource.indexOf(
    "useEffect(() => {\n    if (typeof resolvedActiveStudentCountOverride === 'number')",
  );
  const countEffectEnd = hookSource.indexOf(
    '\n  }, [activeAuthUid, loadProfessionalActiveStudentCount, resolvedActiveStudentCountOverride]);',
    countEffectStart,
  );
  assert.notEqual(countEffectStart, -1);
  assert.notEqual(countEffectEnd, -1);
  const countEffect = hookSource.slice(countEffectStart, countEffectEnd);

  assert.ok(
    countEffect.indexOf("typeof resolvedActiveStudentCountOverride === 'number'") <
      countEffect.indexOf('getActiveProfessionalStudentCount()'),
    'an explicit or validated dev-E2E count must win before the live loader runs',
  );
  assert.match(countEffect, /if \(!activeAuthUid \|\| !loadProfessionalActiveStudentCount\)/);
  assert.match(countEffect, /setIsActiveStudentCountKnown\(false\)/);
  assert.match(countEffect, /getActiveProfessionalStudentCount\(\)/);
  assert.match(countEffect, /!isCancelled && currentAuthUidRef\.current === expectedAuthUid/);
  assert.match(countEffect, /setActiveStudentCount\(count\)/);
  assert.match(countEffect, /setIsActiveStudentCountKnown\(true\)/);
  assert.match(
    countEffect,
    /\.catch\(\(\) => \{[\s\S]*setActiveStudentCount\(0\);[\s\S]*setIsActiveStudentCountKnown\(false\)/,
  );

  assert.match(
    hookSource,
    /else if \(!shouldLoadProfessionalActiveStudentCount\) \{\s*setActiveStudentCount\(snapshot\.activeStudentCount \?\? 0\)/,
  );
});

test('useSubscription binds native RevenueCat calls to the current self-managed auth UID', () => {
  const hookSource = readFileSync(join(__dirname, 'use-subscription.ts'), 'utf8');

  assert.match(hookSource, /export function useSubscription\(\s*authUid: string \| null/);
  assert.match(hookSource, /Purchases\.configure\(\{ apiKey, appUserID: appUserId \}\)/);
  assert.match(hookSource, /Purchases\.logIn\(appUserId\)/);
  assert.match(hookSource, /revenueCatIdentityCoordinator\.run/);
  assert.doesNotMatch(hookSource, /Purchases\.configure\(\{ apiKey \}\)/);

  const fetchStatusStart = hookSource.indexOf('const fetchStatus');
  const unauthenticatedBranchStart = hookSource.indexOf('if (!activeAuthUid)', fetchStatusStart);
  assert.notEqual(unauthenticatedBranchStart, -1);
  assert.match(
    hookSource.slice(unauthenticatedBranchStart, unauthenticatedBranchStart + 320),
    /setIsLoading\(false\)/,
    'an account switch to signed-out must clear loading state from an in-flight RevenueCat operation',
  );
});

test('subscription call sites pass the server auth UID rather than a boolean session flag', () => {
  const root = join(__dirname, '..', '..');
  const sourcePaths = [
    join(root, 'app', 'professional', 'home.tsx'),
    join(root, 'app', 'professional', 'student-profile.tsx'),
    join(root, 'app', 'professional', 'subscription.tsx'),
    join(root, 'app', '(tabs)', 'nutrition', 'custom-meals', '[mealId].tsx'),
    join(root, 'app', '(tabs)', 'nutrition', 'custom-meals', 'index.tsx'),
  ];

  for (const sourcePath of sourcePaths) {
    const source = readFileSync(sourcePath, 'utf8');
    assert.match(source, /useSubscription\(currentUser\?\.uid \?\? null/);
    assert.doesNotMatch(source, /useSubscription\(Boolean\(currentUser\)/);
  }
});

test('subscription server source can read the current local entitlement snapshot', () => {
  const source = readFileSync(join(__dirname, 'subscription-server-source.ts'), 'utf8');

  assert.match(source, /getSubscriptionEntitlementSnapshot/);
  assert.match(source, /method: 'GET'/);
  assert.match(source, /\/subscription\/entitlements\/snapshot/);
  assert.match(source, /body\.snapshot === null/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  syncSubscriptionEntitlementSnapshot,
  SubscriptionServerSourceError,
} from './subscription-server-source';

test('syncSubscriptionEntitlementSnapshot posts RevenueCat-derived statuses to the MyChampions server', async () => {
  const requests: { input: string | URL | Request; init?: RequestInit }[] = [];

  await syncSubscriptionEntitlementSnapshot(
    {
      professionalEntitlementStatus: 'active',
      aiEntitlementStatus: 'lapsed',
      activeStudentCount: 7,
      observedAt: '2026-07-03T16:45:00.000Z',
    },
    {
      getCurrentAccessToken: async () => 'server-token',
      getServerBaseUrl: () => 'http://localhost:3400/',
      fetchFn: async (input, init) => {
        requests.push({ input, init });
        return new Response(JSON.stringify({ snapshot: { id: 'snapshot-1' } }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      },
    }
  );

  assert.equal(requests.length, 1);
  assert.equal(String(requests[0].input), 'http://localhost:3400/subscription/entitlements/snapshot');
  assert.equal(requests[0].init?.method, 'POST');
  assert.deepEqual(requests[0].init?.headers, {
    authorization: 'Bearer server-token',
    'content-type': 'application/json',
  });
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    professionalEntitlementStatus: 'active',
    aiEntitlementStatus: 'lapsed',
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
        }
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'unauthenticated');
      return true;
    }
  );
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
        'server-user-a'
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'unauthenticated');
      return true;
    }
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
        'server-user-a'
      ),
    (err: unknown) => {
      assert.ok(err instanceof SubscriptionServerSourceError);
      assert.equal(err.code, 'unauthenticated');
      return true;
    }
  );

  assert.equal(requestCount, 0);
});

test('getSubscriptionEntitlementSnapshot reads the current local server snapshot', async () => {
  const requests: { input: string | URL | Request; init?: RequestInit }[] = [];
  const snapshot = await (
    await import('./subscription-server-source')
  ).getSubscriptionEntitlementSnapshot({
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
            activeStudentCount: 9,
            source: 'revenuecat',
            observedAt: '2026-07-03T17:45:00.000Z',
            updatedAt: '2026-07-03T17:46:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(String(requests[0].input), 'http://localhost:3400/subscription/entitlements/snapshot');
  assert.equal(requests[0].init?.method, 'GET');
  assert.deepEqual(requests[0].init?.headers, {
    authorization: 'Bearer server-token',
  });
  assert.deepEqual(snapshot, {
    authUid: 'auth-1',
    professionalEntitlementStatus: 'lapsed',
    aiEntitlementStatus: 'active',
    activeStudentCount: 9,
    source: 'revenuecat',
    observedAt: '2026-07-03T17:45:00.000Z',
    updatedAt: '2026-07-03T17:46:00.000Z',
  });
});

test('getSubscriptionEntitlementSnapshot returns null when the server has no snapshot', async () => {
  const snapshot = await (
    await import('./subscription-server-source')
  ).getSubscriptionEntitlementSnapshot({
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

test('useSubscription syncs entitlement snapshots through the server source boundary', () => {
  const hookSource = readFileSync(join(__dirname, 'use-subscription.ts'), 'utf8');

  assert.match(hookSource, /syncSubscriptionEntitlementSnapshot/);
  assert.match(hookSource, /professionalEntitlementStatus/);
  assert.match(hookSource, /aiEntitlementStatus/);
  assert.equal(
    hookSource.includes('until server-side subscription enforcement replaces mobile-only gates'),
    false,
    'useSubscription still describes server-side subscription enforcement as future work'
  );
  assert.match(hookSource, /production cap-sensitive writes use signed webhook entitlement snapshots/);
});

test('useSubscription can hydrate from a server-owned snapshot when native entitlement reads fail', () => {
  const hookSource = readFileSync(join(__dirname, 'use-subscription.ts'), 'utf8');

  assert.match(hookSource, /getSubscriptionEntitlementSnapshot/);
  assert.match(hookSource, /applyServerSnapshotFallback/);
  assert.match(hookSource, /serverSnapshot\.professionalEntitlementStatus/);
  assert.match(hookSource, /serverSnapshot\.aiEntitlementStatus/);
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
    'an account switch to signed-out must clear loading state from an in-flight RevenueCat operation'
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

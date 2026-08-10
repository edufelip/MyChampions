import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hydrateProfileFromSource,
  lockRoleInSource,
  deleteAccountAndDataFromSource,
  setAcceptedTermsVersionInSource,
  ProfileSourceError,
  type ProfileSourceDeps,
} from './profile-source';

type FakeProfile = {
  authUid: string;
  displayName: string;
  emailNormalized: string;
  lockedRole: 'student' | 'professional' | null;
  acceptedTermsVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

function response(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeDeps(handler: (request: Request) => Promise<Response> | Response): ProfileSourceDeps {
  return {
    fetch: async (input, init) => handler(new Request(input, init)),
    getCurrentAccessToken: async () => 'token-1',
    getServerBaseUrl: () => 'http://server.test',
  };
}

const profile = {
  authUid: 'uid-1',
  displayName: 'A',
  emailNormalized: 'a@a.com',
  lockedRole: 'professional' as const,
  acceptedTermsVersion: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('profile-source server api', () => {
  it('hydrates profile through POST /me/hydrate with bearer token', async () => {
    let captured: Request | null = null;
    const deps = makeDeps((request) => {
      captured = request;
      return response({ profile });
    });
    const result = await hydrateProfileFromSource(
      { uid: 'uid-1', displayName: 'A', email: 'a@a.com' },
      deps,
    );

    assert.equal(result.lockedRole, 'professional');
    assert.equal(result.acceptedTermsVersion, null);
    assert.ok(captured);
    const request = captured as Request;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'http://server.test/me/hydrate');
    assert.equal(request.headers.get('authorization'), 'Bearer token-1');
  });

  it('uses the central server token resolver instead of a user token accessor for hydration', async () => {
    let captured: Request | null = null;
    const deps = makeDeps((request) => {
      captured = request;
      return response({ profile });
    });
    let userTokenAccessorCalled = false;
    const userWithTokenAccessor: {
      uid: string;
      displayName: string | null;
      email: string | null;
    } & {
      getAccessToken: () => Promise<string>;
    } = {
      uid: 'uid-1',
      displayName: 'A',
      email: 'a@a.com',
      getAccessToken: async () => {
        userTokenAccessorCalled = true;
        return 'user-access-token';
      },
    };

    await hydrateProfileFromSource(userWithTokenAccessor, deps);

    assert.equal(userTokenAccessorCalled, false);
    assert.ok(captured);
    assert.equal((captured as Request).headers.get('authorization'), 'Bearer token-1');
  });

  it('maps unauthorized hydration to unauthenticated error', async () => {
    for (const status of [401, 403]) {
      const deps = makeDeps(() => response({ error: { code: 'unauthorized' } }, { status }));
      await assert.rejects(
        () => hydrateProfileFromSource({ uid: 'uid-1', displayName: 'A', email: 'a@a.com' }, deps),
        (error: unknown) => error instanceof ProfileSourceError && error.code === 'unauthenticated',
      );
    }
  });

  it('maps a missing current access token to retryable token_unavailable', async () => {
    const deps: ProfileSourceDeps = {
      fetch: async () => {
        throw new Error('fetch must not run without a token');
      },
      getCurrentAccessToken: async () => null,
      getServerBaseUrl: () => 'http://server.test',
    };

    await assert.rejects(
      () => hydrateProfileFromSource({ uid: 'uid-1', displayName: 'A', email: 'a@a.com' }, deps),
      (error: unknown) => error instanceof ProfileSourceError && error.code === 'token_unavailable',
    );
  });

  it('locks role through PATCH /me/role', async () => {
    let body: { role?: string } | null = null;
    const deps = makeDeps(async (request) => {
      body = await request.json();
      return response({ profile: { ...profile, lockedRole: 'student' } });
    });
    const result = await lockRoleInSource('student', deps);
    assert.equal(result.lockedRole, 'student');
    assert.deepEqual(body, { role: 'student' });
  });

  it('maps role conflicts to graphql source errors', async () => {
    const deps = makeDeps(() =>
      response({ error: { code: 'role_already_locked' } }, { status: 409 }),
    );
    await assert.rejects(
      () => lockRoleInSource('student', deps),
      (error: unknown) => error instanceof ProfileSourceError && error.code === 'graphql',
    );
  });

  it('persists accepted terms through PATCH /me/terms', async () => {
    let body: { acceptedTermsVersion?: string } | null = null;
    const deps = makeDeps(async (request) => {
      body = await request.json();
      return response({ profile: { ...profile, acceptedTermsVersion: 'v2' } });
    });
    await setAcceptedTermsVersionInSource('v2', deps);
    assert.deepEqual(body, { acceptedTermsVersion: 'v2' });
    const result = await hydrateProfileFromSource(
      { uid: 'uid-1', displayName: 'A', email: 'a@a.com' },
      deps,
    );
    assert.equal(result.acceptedTermsVersion, 'v2');
  });

  it('deletes account data through DELETE /me', async () => {
    let method = '';
    const deps = makeDeps((request) => {
      method = request.method;
      return new Response(null, { status: 204 });
    });
    await deleteAccountAndDataFromSource(deps);
    assert.equal(method, 'DELETE');
  });

  it('keeps the explicit dev E2E deletion fixture provider-free', async () => {
    const previousVariant = process.env.APP_VARIANT;
    const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    let injectedFetchCalls = 0;

    process.env.APP_VARIANT = 'dev';
    process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('E2E account deletion must not call the server.');
    };

    try {
      await deleteAccountAndDataFromSource(
        makeDeps((request) => {
          injectedFetchCalls += 1;
          assert.equal(request.method, 'DELETE');
          return new Response(null, { status: 204 });
        }),
      );
      await deleteAccountAndDataFromSource();
      assert.equal(injectedFetchCalls, 1);
      assert.equal(fetchCalls, 0);
    } finally {
      if (previousVariant === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = previousVariant;
      if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
      else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;
      if (previousDev === undefined) {
        delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
      } else {
        (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
      }
      globalThis.fetch = previousFetch;
    }
  });
});

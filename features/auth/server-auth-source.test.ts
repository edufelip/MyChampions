import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearPersistedServerAuthSession,
  clearServerAuthSession,
  getCurrentServerAccessToken,
  getCurrentServerUser,
  restoreServerAuthSession,
  startLocalServerSession,
  startLocalServerSocialSession,
} from './server-auth-source';

function response(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    removeItem: async (key: string) => {
      values.delete(key);
    },
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('server-auth-source', () => {
  it('starts a local server session and exposes a bearer-token user', async () => {
    clearServerAuthSession();
    let captured: Request | null = null;

    const session = await startLocalServerSession(
      { email: ' User@Example.test ', displayName: ' User One ' },
      {
        fetch: async (input, init) => {
          captured = new Request(input, init);
          return response({
            accessToken: 'server-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: 'v1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2999-01-01T00:00:00.000Z',
          });
        },
        getServerBaseUrl: () => 'http://server.test',
      }
    );

    assert.ok(captured);
    const request = captured as Request;
    assert.deepEqual(session !== null, true);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'http://server.test/auth/dev/session');
    assert.deepEqual(await request.json(), {
      email: 'user@example.test',
      displayName: 'User One',
    });
    assert.equal(session?.accessToken, 'server-token-1');
    assert.equal(session?.user.uid, 'local_user');
    assert.equal(session?.user.email, 'user@example.test');
    assert.equal(await session?.user.getAccessToken(), 'server-token-1');
    assert.equal(getCurrentServerAccessToken(), 'server-token-1');
    assert.equal(getCurrentServerUser()?.uid, 'local_user');
  });

  it('starts a local server social session with provider-neutral auth provider ids', async () => {
    clearServerAuthSession();
    let captured: Request | null = null;

    const session = await startLocalServerSocialSession('google', {
      fetch: async (input, init) => {
        captured = new Request(input, init);
        return response({
          accessToken: 'server-google-token',
          tokenType: 'Bearer',
          authProviderIds: ['google'],
          profile: {
            authUid: 'local_google_user',
            displayName: 'Local Google User',
            emailNormalized: 'google.local@example.test',
            lockedRole: null,
            acceptedTermsVersion: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          expiresAt: '2999-01-01T00:00:00.000Z',
        });
      },
      getServerBaseUrl: () => 'http://server.test',
    });

    assert.ok(captured);
    const request = captured as Request;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'http://server.test/auth/dev/session');
    assert.deepEqual(await request.json(), {
      email: 'google.local@example.test',
      displayName: 'Local Google User',
      authProviderId: 'google',
    });
    assert.equal(session?.accessToken, 'server-google-token');
    assert.deepEqual(session?.user.authProviderIds, ['google']);
    assert.equal(getCurrentServerUser()?.authProviderIds[0], 'google');
  });

  it('uses the server-provided email verification state instead of hard-coding it', async () => {
    clearServerAuthSession();

    const session = await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'server-token-1',
            tokenType: 'Bearer',
            emailVerified: false,
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2999-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
      }
    );

    assert.equal(session?.user.emailVerified, false);
    assert.equal(getCurrentServerUser()?.emailVerified, false);
  });

  it('restores a local server session from persisted storage', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'server-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2999-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      }
    );

    clearServerAuthSession();
    assert.equal(getCurrentServerAccessToken(), null);

    const restored = await restoreServerAuthSession({ storage });

    assert.equal(restored?.accessToken, 'server-token-1');
    assert.equal(restored?.profile.lockedRole, 'student');
    assert.equal(restored?.user.uid, 'local_user');
    assert.equal(await restored?.user.getAccessToken(), 'server-token-1');
    assert.equal(getCurrentServerAccessToken(), 'server-token-1');
    assert.equal(getCurrentServerUser()?.email, 'user@example.test');
  });

  it('clears persisted local server session storage', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'server-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2999-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      }
    );

    await clearPersistedServerAuthSession({ storage });

    assert.equal(getCurrentServerAccessToken(), null);
    assert.equal(await restoreServerAuthSession({ storage }), null);
  });

  it('does not restore an expired persisted local server session', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expired-token',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2020-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      }
    );

    clearServerAuthSession();

    const restored = await restoreServerAuthSession({ storage });

    assert.equal(restored, null);
    assert.equal(getCurrentServerAccessToken(), null);
  });

  it('fails closed when corrupted persisted session cleanup storage fails', async () => {
    clearServerAuthSession();

    const restored = await restoreServerAuthSession({
      storage: {
        getItem: async () => '{not-json',
        removeItem: async () => {
          throw new Error('storage cleanup unavailable');
        },
        setItem: async () => {},
      },
    });

    assert.equal(restored, null);
    assert.equal(getCurrentServerAccessToken(), null);
  });

  it('refreshes an expired persisted local server session when a refresh token exists', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();
    const requests: Request[] = [];

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One', authProviderId: 'apple' },
      {
        fetch: async () =>
          response({
            accessToken: 'expired-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            authProviderIds: ['apple'],
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2020-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      }
    );

    clearServerAuthSession();

    const restored = await restoreServerAuthSession({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return response({
          accessToken: 'refreshed-token',
          refreshToken: 'refresh-token-2',
          tokenType: 'Bearer',
          authProviderIds: ['apple'],
          profile: {
            authUid: 'local_user',
            displayName: 'User One',
            emailNormalized: 'user@example.test',
            lockedRole: 'student',
            acceptedTermsVersion: 'v1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
          expiresAt: '2999-01-01T00:00:00.000Z',
        });
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.url, 'http://server.test/auth/dev/refresh');
    assert.deepEqual(await requests[0]?.json(), { refreshToken: 'refresh-token-1' });
    assert.equal(restored?.accessToken, 'refreshed-token');
    assert.equal(restored?.profile.lockedRole, 'student');
    assert.deepEqual(restored?.user.authProviderIds, ['apple']);
    assert.equal(getCurrentServerAccessToken(), 'refreshed-token');
  });

  it('fails closed when persisted-session refresh transport fails', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expired-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2020-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      }
    );

    clearServerAuthSession();

    const restored = await restoreServerAuthSession({
      fetch: async () => {
        throw new Error('refresh network unavailable');
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    assert.equal(restored, null);
    assert.equal(getCurrentServerAccessToken(), null);
  });

  it('fails closed when persisted-session refresh URL resolution fails', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expired-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2020-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      }
    );

    clearServerAuthSession();

    const restored = await restoreServerAuthSession({
      fetch: async () => {
        throw new Error('fetch should not be called');
      },
      getServerBaseUrl: () => {
        throw new Error('refresh server URL unavailable');
      },
      storage,
    });

    assert.equal(restored, null);
    assert.equal(getCurrentServerAccessToken(), null);
  });

  it('fails closed when persisted-session refresh payload is malformed', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expired-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2020-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      }
    );

    clearServerAuthSession();

    const restored = await restoreServerAuthSession({
      fetch: async () =>
        new Response('{not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    assert.equal(restored, null);
    assert.equal(getCurrentServerAccessToken(), null);
  });

  it('returns null instead of calling the network when the server URL is missing', async () => {
    clearServerAuthSession();
    const session = await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () => {
          throw new Error('fetch should not be called');
        },
        getServerBaseUrl: () => undefined,
      }
    );

    assert.equal(session, null);
    assert.equal(getCurrentServerAccessToken(), null);
  });

  it('does not use the local dev-session endpoint for prod app variant', async () => {
    clearServerAuthSession();
    const previousVariant = process.env.APP_VARIANT;
    process.env.APP_VARIANT = 'prod';

    try {
      const session = await startLocalServerSession(
        { email: 'user@example.test', displayName: 'User One' },
        {
          fetch: async () => {
            throw new Error('fetch should not be called');
          },
          getServerBaseUrl: () => 'http://server.test',
        }
      );

      assert.equal(session, null);
    } finally {
      if (previousVariant === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = previousVariant;
    }
  });

  it('does not use deterministic local dev-session endpoints for any non-dev app variant', async () => {
    clearServerAuthSession();
    const previousVariant = process.env.APP_VARIANT;

    try {
      for (const appVariant of ['production', 'staging']) {
        process.env.APP_VARIANT = appVariant;

        const emailSession = await startLocalServerSession(
          { email: 'user@example.test', displayName: 'User One' },
          {
            fetch: async () => {
              throw new Error(`fetch should not be called for ${appVariant}`);
            },
            getServerBaseUrl: () => 'http://server.test',
          }
        );
        const socialSession = await startLocalServerSocialSession('google', {
          fetch: async () => {
            throw new Error(`fetch should not be called for ${appVariant}`);
          },
          getServerBaseUrl: () => 'http://server.test',
        });

        assert.equal(emailSession, null);
        assert.equal(socialSession, null);
      }
    } finally {
      if (previousVariant === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = previousVariant;
    }
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearPersistedServerAuthSession,
  clearServerAuthSession,
  getCurrentServerAccessToken,
  getCurrentServerProfile,
  getCurrentServerUser,
  getValidServerAccessToken,
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

function persistedAccessToken(value: string): string | null {
  try {
    const payload = JSON.parse(value) as { accessToken?: unknown };
    return typeof payload.accessToken === 'string' ? payload.accessToken : null;
  } catch {
    return null;
  }
}

function createBlockedPersistenceStorage(blockedAccessToken: string) {
  const values = new Map<string, string>();
  let releaseBlockedWrite!: () => void;
  let markBlockedWriteStarted!: () => void;
  const blockedWriteStarted = new Promise<void>((resolve) => {
    markBlockedWriteStarted = resolve;
  });
  const blockedWriteRelease = new Promise<void>((resolve) => {
    releaseBlockedWrite = resolve;
  });

  return {
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      removeItem: async (key: string) => {
        values.delete(key);
      },
      setItem: async (key: string, value: string) => {
        if (persistedAccessToken(value) === blockedAccessToken) {
          markBlockedWriteStarted();
          await blockedWriteRelease;
        }
        values.set(key, value);
      },
    },
    blockedWriteStarted,
    releaseBlockedWrite,
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
      },
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
      },
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
      },
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
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2999-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
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
      },
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
      },
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
    assert.equal(requests[0]?.url, 'http://server.test/auth/session/refresh');
    assert.deepEqual(await requests[0]?.json(), {
      refreshToken: 'refresh-token-1',
      sessionMode: 'bearer',
    });
    assert.equal(restored?.accessToken, 'refreshed-token');
    assert.equal(restored?.profile.lockedRole, 'student');
    assert.deepEqual(restored?.user.authProviderIds, ['apple']);
    assert.equal(getCurrentServerAccessToken(), 'refreshed-token');
  });

  it('single-flights concurrent access-token refreshes', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();
    let refreshCalls = 0;

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expiring-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: new Date(Date.now() + 1_000).toISOString(),
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    const deps = {
      fetch: async () => {
        refreshCalls += 1;
        await Promise.resolve();
        return response({
          accessToken: 'refreshed-token',
          refreshToken: 'refresh-token-2',
          tokenType: 'Bearer',
          profile: {
            authUid: 'local_user',
            displayName: 'User One',
            emailNormalized: 'user@example.test',
            lockedRole: 'student',
            acceptedTermsVersion: 'v1',
          },
          expiresAt: '2999-01-01T00:00:00.000Z',
        });
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    };

    const [first, second, third] = await Promise.all([
      getValidServerAccessToken(deps),
      getValidServerAccessToken(deps),
      getValidServerAccessToken(deps),
    ]);

    assert.equal(refreshCalls, 1);
    assert.deepEqual(
      [first, second, third],
      ['refreshed-token', 'refreshed-token', 'refreshed-token'],
    );
  });

  it('does not restore a cleared session when an older refresh finishes after sign-out', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();
    let resolveRefresh!: (value: Response) => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expiring-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: new Date(Date.now() + 1_000).toISOString(),
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    const staleRefresh = getValidServerAccessToken({
      fetch: async () => {
        markRefreshStarted();
        return refreshResponse;
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });
    await refreshStarted;
    clearServerAuthSession();
    resolveRefresh(
      response({
        accessToken: 'stale-refreshed-token',
        refreshToken: 'refresh-token-2',
        tokenType: 'Bearer',
        profile: {
          authUid: 'local_user',
          displayName: 'User One',
          emailNormalized: 'user@example.test',
          lockedRole: 'student',
          acceptedTermsVersion: 'v1',
        },
        expiresAt: '2999-01-01T00:00:00.000Z',
      }),
    );

    assert.equal(await staleRefresh, null);
    assert.equal(getCurrentServerAccessToken(), null);
    assert.equal(getCurrentServerUser(), null);
  });

  it('does not let an older account refresh overwrite a replacement session', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();
    let resolveRefresh!: (value: Response) => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    await startLocalServerSession(
      { email: 'first@example.test', displayName: 'First User' },
      {
        fetch: async () =>
          response({
            accessToken: 'first-expiring-token',
            refreshToken: 'first-refresh-token',
            tokenType: 'Bearer',
            profile: {
              authUid: 'first_user',
              displayName: 'First User',
              emailNormalized: 'first@example.test',
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: new Date(Date.now() + 1_000).toISOString(),
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    const staleRefresh = getValidServerAccessToken({
      fetch: async () => {
        markRefreshStarted();
        return refreshResponse;
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });
    await refreshStarted;

    await startLocalServerSession(
      { email: 'second@example.test', displayName: 'Second User' },
      {
        fetch: async () =>
          response({
            accessToken: 'second-token',
            refreshToken: 'second-refresh-token',
            tokenType: 'Bearer',
            profile: {
              authUid: 'second_user',
              displayName: 'Second User',
              emailNormalized: 'second@example.test',
              lockedRole: 'professional',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: '2999-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    resolveRefresh(
      response({
        accessToken: 'first-stale-refreshed-token',
        refreshToken: 'first-refresh-token-2',
        tokenType: 'Bearer',
        profile: {
          authUid: 'first_user',
          displayName: 'First User',
          emailNormalized: 'first@example.test',
          lockedRole: 'student',
          acceptedTermsVersion: 'v1',
        },
        expiresAt: '2999-01-01T00:00:00.000Z',
      }),
    );

    assert.equal(await staleRefresh, null);
    assert.equal(getCurrentServerAccessToken(), 'second-token');
    assert.equal(getCurrentServerUser()?.uid, 'second_user');
  });

  it('does not return or persist a refreshed token after sign-out races its storage write', async () => {
    clearServerAuthSession();
    const { storage, blockedWriteStarted, releaseBlockedWrite } =
      createBlockedPersistenceStorage('stale-refreshed-token');

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expiring-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: new Date(Date.now() + 1_000).toISOString(),
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    const staleRefresh = getValidServerAccessToken({
      fetch: async () =>
        response({
          accessToken: 'stale-refreshed-token',
          refreshToken: 'refresh-token-2',
          tokenType: 'Bearer',
          profile: {
            authUid: 'local_user',
            displayName: 'User One',
            emailNormalized: 'user@example.test',
            lockedRole: 'student',
            acceptedTermsVersion: 'v1',
          },
          expiresAt: '2999-01-01T00:00:00.000Z',
        }),
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    await blockedWriteStarted;
    assert.equal(getCurrentServerAccessToken(), 'stale-refreshed-token');

    await clearPersistedServerAuthSession({ storage });
    releaseBlockedWrite();

    assert.equal(await staleRefresh, null);
    assert.equal(getCurrentServerAccessToken(), null);
    assert.equal(await storage.getItem('auth.server.session'), null);
    assert.equal(await restoreServerAuthSession({ storage }), null);
  });

  it('repairs persistence and returns no old token when account replacement races refresh storage', async () => {
    clearServerAuthSession();
    const { storage, blockedWriteStarted, releaseBlockedWrite } = createBlockedPersistenceStorage(
      'first-stale-refreshed-token',
    );

    await startLocalServerSession(
      { email: 'first@example.test', displayName: 'First User' },
      {
        fetch: async () =>
          response({
            accessToken: 'first-expiring-token',
            refreshToken: 'first-refresh-token',
            tokenType: 'Bearer',
            profile: {
              authUid: 'first_user',
              displayName: 'First User',
              emailNormalized: 'first@example.test',
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: new Date(Date.now() + 1_000).toISOString(),
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    const staleRefresh = getValidServerAccessToken({
      fetch: async () =>
        response({
          accessToken: 'first-stale-refreshed-token',
          refreshToken: 'first-refresh-token-2',
          tokenType: 'Bearer',
          profile: {
            authUid: 'first_user',
            displayName: 'First User',
            emailNormalized: 'first@example.test',
            lockedRole: 'student',
            acceptedTermsVersion: 'v1',
          },
          expiresAt: '2999-01-01T00:00:00.000Z',
        }),
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    await blockedWriteStarted;

    await startLocalServerSession(
      { email: 'second@example.test', displayName: 'Second User' },
      {
        fetch: async () =>
          response({
            accessToken: 'second-token',
            refreshToken: 'second-refresh-token',
            tokenType: 'Bearer',
            profile: {
              authUid: 'second_user',
              displayName: 'Second User',
              emailNormalized: 'second@example.test',
              lockedRole: 'professional',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: '2999-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    releaseBlockedWrite();

    assert.equal(await staleRefresh, null);
    assert.equal(getCurrentServerAccessToken(), 'second-token');
    assert.equal(getCurrentServerUser()?.uid, 'second_user');

    clearServerAuthSession();
    const restored = await restoreServerAuthSession({ storage });
    assert.equal(restored?.accessToken, 'second-token');
    assert.equal(restored?.user.uid, 'second_user');
  });

  it('keeps a refreshed in-memory session usable when its persistence write fails', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expiring-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: new Date(Date.now() + 1_000).toISOString(),
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    const persistedBeforeRefresh = await storage.getItem('auth.server.session');
    const failingStorage = {
      ...storage,
      setItem: async (key: string, value: string) => {
        if (persistedAccessToken(value) === 'refreshed-token') {
          throw new Error('storage unavailable');
        }
        await storage.setItem(key, value);
      },
    };

    const token = await getValidServerAccessToken({
      fetch: async () =>
        response({
          accessToken: 'refreshed-token',
          refreshToken: 'refresh-token-2',
          tokenType: 'Bearer',
          profile: {
            authUid: 'local_user',
            displayName: 'User One',
            emailNormalized: 'user@example.test',
            lockedRole: 'student',
            acceptedTermsVersion: 'v1',
          },
          expiresAt: '2999-01-01T00:00:00.000Z',
        }),
      getServerBaseUrl: () => 'http://server.test',
      storage: failingStorage,
    });

    assert.equal(token, 'refreshed-token');
    assert.equal(getCurrentServerAccessToken(), 'refreshed-token');
    assert.equal(getCurrentServerUser()?.uid, 'local_user');
    assert.equal(await storage.getItem('auth.server.session'), persistedBeforeRefresh);
  });

  it('clears the active session when token refresh is rejected', async () => {
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
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: '2020-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    const token = await getValidServerAccessToken({
      fetch: async () => response({ error: 'invalid_refresh_token' }, { status: 401 }),
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    assert.equal(token, null);
    assert.equal(getCurrentServerUser(), null);
    assert.equal(await storage.getItem('auth.server.session'), null);
  });

  it('keeps a still-valid session usable when proactive refresh has a transport failure', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();

    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'expiring-token',
            refreshToken: 'refresh-token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'local_user',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: new Date(Date.now() + 10_000).toISOString(),
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );
    const persistedBeforeFailure = await storage.getItem('auth.server.session');

    const token = await getValidServerAccessToken({
      fetch: async () => {
        throw new Error('refresh network unavailable');
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    assert.equal(token, 'expiring-token');
    assert.equal(getCurrentServerUser()?.uid, 'local_user');
    assert.equal(await storage.getItem('auth.server.session'), persistedBeforeFailure);
  });

  it('preserves an expired session and refresh credential across retryable 5xx failures', async () => {
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
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
            },
            expiresAt: '2020-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );
    const persistedBeforeFailure = await storage.getItem('auth.server.session');

    const failedToken = await getValidServerAccessToken({
      fetch: async () => response({ error: 'temporarily_unavailable' }, { status: 503 }),
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    assert.equal(failedToken, null);
    assert.equal(getCurrentServerUser()?.uid, 'local_user');
    assert.equal(await storage.getItem('auth.server.session'), persistedBeforeFailure);

    const recoveredToken = await getValidServerAccessToken({
      fetch: async () =>
        response({
          accessToken: 'refreshed-token',
          refreshToken: 'refresh-token-2',
          tokenType: 'Bearer',
          profile: {
            authUid: 'local_user',
            displayName: 'User One',
            emailNormalized: 'user@example.test',
            lockedRole: 'student',
            acceptedTermsVersion: 'v1',
          },
          expiresAt: '2999-01-01T00:00:00.000Z',
        }),
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    assert.equal(recoveredToken, 'refreshed-token');
    assert.equal(getCurrentServerAccessToken(), 'refreshed-token');
  });

  it('preserves persisted-session refresh credentials when refresh transport fails', async () => {
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
              lockedRole: 'student',
              acceptedTermsVersion: 'v1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            expiresAt: '2020-01-01T00:00:00.000Z',
          }),
        getServerBaseUrl: () => 'http://server.test',
        storage,
      },
    );

    clearServerAuthSession();

    const restored = await restoreServerAuthSession({
      fetch: async () => {
        throw new Error('refresh network unavailable');
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    });

    assert.equal(restored?.refreshToken, 'refresh-token-1');
    assert.equal(restored?.profile.authUid, 'local_user');
    assert.equal(restored?.profile.lockedRole, 'student');
    assert.equal(restored?.profile.acceptedTermsVersion, 'v1');
    assert.equal(getCurrentServerAccessToken(), null);
    assert.equal(getCurrentServerUser()?.uid, 'local_user');
    assert.equal(getCurrentServerProfile()?.lockedRole, 'student');
    assert.equal(getCurrentServerProfile()?.acceptedTermsVersion, 'v1');
    assert.notEqual(await storage.getItem('auth.server.session'), null);
  });

  it('preserves persisted-session refresh credentials when URL resolution fails', async () => {
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
      },
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

    assert.equal(restored?.refreshToken, 'refresh-token-1');
    assert.equal(getCurrentServerAccessToken(), null);
    assert.equal(getCurrentServerUser()?.uid, 'local_user');
    assert.notEqual(await storage.getItem('auth.server.session'), null);
  });

  it('preserves persisted-session refresh credentials when a success payload is malformed', async () => {
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
      },
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

    assert.equal(restored?.refreshToken, 'refresh-token-1');
    assert.equal(getCurrentServerAccessToken(), null);
    assert.equal(getCurrentServerUser()?.uid, 'local_user');
    assert.notEqual(await storage.getItem('auth.server.session'), null);
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
      },
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
        },
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
          },
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

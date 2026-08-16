import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAccountWithEmailPasswordFromSource,
  signInWithEmailPasswordFromSource,
} from './email-auth-source';
import {
  clearPersistedServerAuthSession,
  clearServerAuthSession,
  getCurrentServerAccessToken,
  persistServerAuthSessionFromPayload,
  startLocalServerSession,
} from './server-auth-source';
import { signInWithSocialProviderTokenFromSource } from './social-auth-source';
import type { AuthSessionRuntime } from './auth-session-runtime';

const browserRuntime: AuthSessionRuntime = {
  sessionMode: 'cookie',
  credentials: 'include',
  persistsSession: false,
  refreshPath: '/auth/session/refresh',
  sessionRequestFields: { sessionMode: 'cookie' },
  refreshRequestBody: () => ({ sessionMode: 'cookie' }),
};

function sessionPayload(uid: string, accessToken: string) {
  return {
    accessToken,
    refreshToken: null,
    tokenType: 'Bearer',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authProviderIds: ['email_password'],
    profile: {
      authUid: uid,
      displayName: uid,
      emailNormalized: `${uid}@example.test`,
      lockedRole: null,
      acceptedTermsVersion: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function response(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('browser auth sign-out serialization', () => {
  it('clears local identity immediately but blocks a subsequent email login until cookie sign-out settles', async () => {
    await persistServerAuthSessionFromPayload(sessionPayload('account-a', 'token-a'));

    let resolveSignOut!: (value: Response) => void;
    let markSignOutStarted!: () => void;
    const signOutStarted = new Promise<void>((resolve) => {
      markSignOutStarted = resolve;
    });
    const signOutResponse = new Promise<Response>((resolve) => {
      resolveSignOut = resolve;
    });
    const clearPromise = clearPersistedServerAuthSession({
      fetch: async () => {
        markSignOutStarted();
        return signOutResponse;
      },
      getServerBaseUrl: () => 'http://server.test',
      runtime: browserRuntime,
    });

    await signOutStarted;
    assert.equal(getCurrentServerAccessToken(), null);

    let loginRequestStarted = false;
    const loginPromise = signInWithEmailPasswordFromSource(
      { email: 'account-b@example.test', password: 'Password1!' },
      {
        fetch: async () => {
          loginRequestStarted = true;
          return response(sessionPayload('account-b', 'token-b'));
        },
        getServerBaseUrl: () => 'http://server.test',
      },
    );

    await Promise.resolve();
    assert.equal(loginRequestStarted, false);
    assert.equal(getCurrentServerAccessToken(), null);

    resolveSignOut(response({ status: 'signed_out' }));
    await clearPromise;
    await loginPromise;

    assert.equal(loginRequestStarted, true);
    assert.equal(getCurrentServerAccessToken(), 'token-b');
    clearServerAuthSession();
  });

  it('releases the login barrier after a failed browser sign-out attempt', async () => {
    await persistServerAuthSessionFromPayload(sessionPayload('account-a', 'token-a'));

    await clearPersistedServerAuthSession({
      fetch: async () => {
        throw new Error('network unavailable');
      },
      getServerBaseUrl: () => 'http://server.test',
      runtime: browserRuntime,
    });

    let loginRequestStarted = false;
    await signInWithEmailPasswordFromSource(
      { email: 'account-b@example.test', password: 'Password1!' },
      {
        fetch: async () => {
          loginRequestStarted = true;
          return response(sessionPayload('account-b', 'token-b'));
        },
        getServerBaseUrl: () => 'http://server.test',
      },
    );

    assert.equal(loginRequestStarted, true);
    assert.equal(getCurrentServerAccessToken(), 'token-b');
    clearServerAuthSession();
  });

  it('gates account creation, social auth, and local-development auth behind the same barrier', async () => {
    await persistServerAuthSessionFromPayload(sessionPayload('account-a', 'token-a'));

    let resolveSignOut!: (value: Response) => void;
    let markSignOutStarted!: () => void;
    const signOutStarted = new Promise<void>((resolve) => {
      markSignOutStarted = resolve;
    });
    const signOutResponse = new Promise<Response>((resolve) => {
      resolveSignOut = resolve;
    });
    const clearPromise = clearPersistedServerAuthSession({
      fetch: async () => {
        markSignOutStarted();
        return signOutResponse;
      },
      getServerBaseUrl: () => 'http://server.test',
      runtime: browserRuntime,
    });
    await signOutStarted;

    const started: string[] = [];
    const createPromise = createAccountWithEmailPasswordFromSource(
      {
        email: 'created@example.test',
        name: 'Created User',
        password: 'Password1!',
        passwordConfirmation: 'Password1!',
      },
      {
        fetch: async () => {
          started.push('create');
          return response(sessionPayload('created', 'created-token'));
        },
        getServerBaseUrl: () => 'http://server.test',
      },
    );
    const socialPromise = signInWithSocialProviderTokenFromSource(
      { provider: 'google', idToken: 'provider-token' },
      {
        fetch: async () => {
          started.push('social');
          return response(sessionPayload('social', 'social-token'));
        },
        getServerBaseUrl: () => 'http://server.test',
      },
    );
    const localPromise = startLocalServerSession(
      { email: 'local@example.test', displayName: 'Local User' },
      {
        fetch: async () => {
          started.push('local');
          return response(sessionPayload('local', 'local-token'));
        },
        getServerBaseUrl: () => 'http://server.test',
      },
    );

    await Promise.resolve();
    assert.deepEqual(started, []);

    resolveSignOut(response({ status: 'signed_out' }));
    await clearPromise;
    await Promise.all([createPromise, socialPromise, localPromise]);

    assert.deepEqual(started.sort(), ['create', 'local', 'social']);
    clearServerAuthSession();
  });
});

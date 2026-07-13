import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  signInWithSocialProviderTokenFromSource,
  SocialAuthSourceError,
  type SocialAuthSourceDeps,
} from './social-auth-source';
import { clearServerAuthSession, getCurrentServerAccessToken } from './server-auth-source';

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

function serverSessionPayload(accessToken: string) {
  return {
    accessToken,
    refreshToken: 'refresh-token-1',
    tokenType: 'Bearer',
    authProviderIds: ['apple'],
    expiresAt: '2999-01-01T00:00:00.000Z',
    profile: {
      authUid: 'provider-apple-user',
      displayName: 'Apple User',
      emailNormalized: 'apple-user@example.test',
      lockedRole: null,
      acceptedTermsVersion: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('social-auth-source', () => {
  it('signs in through the MyChampions server social auth route and persists the session', async () => {
    clearServerAuthSession();
    const requests: Request[] = [];
    const deps: SocialAuthSourceDeps = {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return response(serverSessionPayload('server-social-token'), { status: 201 });
      },
      getServerBaseUrl: () => 'http://server.test/',
      storage: createMemoryStorage(),
    };

    await signInWithSocialProviderTokenFromSource(
      {
        provider: 'apple',
        idToken: ' apple-id-token ',
        accessToken: ' apple-access-token ',
        nonce: ' nonce-1 ',
      },
      deps
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.url, 'http://server.test/auth/social/sign-in');
    assert.deepEqual(await requests[0]?.json(), {
      provider: 'apple',
      idToken: 'apple-id-token',
      accessToken: 'apple-access-token',
      nonce: 'nonce-1',
    });
    assert.equal(getCurrentServerAccessToken(), 'server-social-token');
  });

  it('fails closed when the server URL is missing', async () => {
    clearServerAuthSession();

    await assert.rejects(
      () =>
        signInWithSocialProviderTokenFromSource(
          { provider: 'google', idToken: 'google-id-token' },
          {
            fetch: async () => {
              throw new Error('fetch should not run without a server URL');
            },
            getServerBaseUrl: () => undefined,
            storage: createMemoryStorage(),
          }
        ),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'configuration'
    );
  });

  it('maps server URL resolution failures to a configuration error before fetch', async () => {
    clearServerAuthSession();

    await assert.rejects(
      () =>
        signInWithSocialProviderTokenFromSource(
          { provider: 'google', idToken: 'google-id-token' },
          {
            fetch: async () => {
              throw new Error('fetch should not run after server URL failure');
            },
            getServerBaseUrl: () => {
              throw new Error('server URL resolver unavailable');
            },
            storage: createMemoryStorage(),
          }
        ),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'configuration'
    );
  });

  it('maps server social-auth configuration failures', async () => {
    clearServerAuthSession();

    await assert.rejects(
      () =>
        signInWithSocialProviderTokenFromSource(
          { provider: 'google', idToken: 'google-id-token' },
          {
            fetch: async () =>
              response(
                {
                  error: {
                    code: 'configuration',
                    message: 'Social auth provider is not configured for this local server.',
                  },
                },
                { status: 503 }
              ),
            getServerBaseUrl: () => 'http://server.test',
            storage: createMemoryStorage(),
          }
        ),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'configuration'
    );
  });

  it('maps invalid social provider tokens', async () => {
    clearServerAuthSession();

    await assert.rejects(
      () =>
        signInWithSocialProviderTokenFromSource(
          { provider: 'apple', idToken: 'bad-token' },
          {
            fetch: async () =>
              response(
                {
                  error: {
                    code: 'invalid_credentials',
                    message: 'Invalid social auth token.',
                  },
                },
                { status: 401 }
              ),
            getServerBaseUrl: () => 'http://server.test',
            storage: createMemoryStorage(),
          }
        ),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'invalid_credentials'
    );
  });

});

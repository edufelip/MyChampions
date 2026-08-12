import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CreateAccountFailure } from './create-account.logic';
import {
  createAccountWithEmailPasswordFromSource,
  signInWithEmailPasswordFromSource,
  type EmailAuthSourceDeps,
} from './email-auth-source';
import { SignInFailure } from './sign-in.logic';
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
    authProviderIds: ['email_password'],
    expiresAt: '2999-01-01T00:00:00.000Z',
    profile: {
      authUid: 'provider-user-1',
      displayName: 'Provider User',
      emailNormalized: 'user@example.test',
      lockedRole: null,
      acceptedTermsVersion: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('email-auth-source', () => {
  it('signs in through the MyChampions server email auth route and persists the session', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();
    const requests: Request[] = [];

    const deps: EmailAuthSourceDeps = {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return response(serverSessionPayload('server-email-token'), { status: 201 });
      },
      getServerBaseUrl: () => 'http://server.test/',
      storage,
    };

    await signInWithEmailPasswordFromSource(
      { email: ' USER@Example.test ', password: 'Password1!' },
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.url, 'http://server.test/auth/email/sign-in');
    assert.deepEqual(await requests[0]?.json(), {
      email: 'user@example.test',
      password: 'Password1!',
    });
    assert.equal(getCurrentServerAccessToken(), 'server-email-token');
  });

  it('creates an account through the MyChampions server email auth route and persists the session', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();
    const requests: Request[] = [];

    const deps: EmailAuthSourceDeps = {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return response(serverSessionPayload('server-create-token'), { status: 201 });
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    };

    await createAccountWithEmailPasswordFromSource(
      {
        name: ' Provider User ',
        email: ' USER@Example.test ',
        password: 'Password1!',
        passwordConfirmation: 'Password1!',
      },
      deps,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.url, 'http://server.test/auth/email/create-account');
    assert.deepEqual(await requests[0]?.json(), {
      displayName: 'Provider User',
      email: 'user@example.test',
      password: 'Password1!',
    });
    assert.equal(getCurrentServerAccessToken(), 'server-create-token');
  });

  it('signs in after a privacy-safe session-less create-account acknowledgement', async () => {
    clearServerAuthSession();
    const storage = createMemoryStorage();
    const requests: Request[] = [];
    const responses = [
      response({ status: 'accepted' }, { status: 202 }),
      response(serverSessionPayload('server-signin-token'), { status: 201 }),
    ];

    const deps: EmailAuthSourceDeps = {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const next = responses.shift();
        assert.ok(next);
        return next;
      },
      getServerBaseUrl: () => 'http://server.test',
      storage,
    };

    await createAccountWithEmailPasswordFromSource(
      {
        name: ' Provider User ',
        email: ' USER@Example.test ',
        password: 'Password1!',
        passwordConfirmation: 'Password1!',
      },
      deps
    );

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, 'http://server.test/auth/email/create-account');
    assert.deepEqual(await requests[0]?.json(), {
      displayName: 'Provider User',
      email: 'user@example.test',
      password: 'Password1!',
    });
    assert.equal(requests[1]?.url, 'http://server.test/auth/email/sign-in');
    assert.deepEqual(await requests[1]?.json(), {
      email: 'user@example.test',
      password: 'Password1!',
    });
    assert.equal(getCurrentServerAccessToken(), 'server-signin-token');
  });

  it('fails closed for sign-in when E2E and server auth did not establish a session', async () => {
    clearServerAuthSession();
    await assert.rejects(
      () =>
        signInWithEmailPasswordFromSource({
          email: ' USER@Example.test ',
          password: 'secret-password',
        }),
      (error: unknown) => error instanceof SignInFailure && error.reason === 'configuration',
    );
  });

  it('maps sign-in server URL resolution failures to configuration', async () => {
    clearServerAuthSession();

    await assert.rejects(
      () =>
        signInWithEmailPasswordFromSource(
          { email: 'user@example.test', password: 'secret-password' },
          {
            fetch: async () => {
              throw new Error('fetch should not be called');
            },
            getServerBaseUrl: () => {
              throw new Error('server URL unavailable');
            },
          },
        ),
      (error: unknown) => error instanceof SignInFailure && error.reason === 'configuration',
    );
  });

  it('fails closed for account creation when E2E and server auth did not establish a session', async () => {
    clearServerAuthSession();
    await assert.rejects(
      () =>
        createAccountWithEmailPasswordFromSource({
          name: 'User One',
          email: ' NewUser@Example.test ',
          password: 'secret-password',
          passwordConfirmation: 'secret-password',
        }),
      (error: unknown) => error instanceof CreateAccountFailure && error.reason === 'configuration',
    );
  });

  it('maps account-creation server URL resolution failures to configuration', async () => {
    clearServerAuthSession();

    await assert.rejects(
      () =>
        createAccountWithEmailPasswordFromSource(
          {
            name: 'User One',
            email: 'user@example.test',
            password: 'secret-password',
            passwordConfirmation: 'secret-password',
          },
          {
            fetch: async () => {
              throw new Error('fetch should not be called');
            },
            getServerBaseUrl: () => {
              throw new Error('server URL unavailable');
            },
          },
        ),
      (error: unknown) => error instanceof CreateAccountFailure && error.reason === 'configuration',
    );
  });

  it('maps server configuration failures for email sign-in', async () => {
    clearServerAuthSession();

    await assert.rejects(
      () =>
        signInWithEmailPasswordFromSource(
          { email: 'user@example.test', password: 'Password1!' },
          {
            fetch: async () =>
              response(
                {
                  error: {
                    code: 'configuration',
                    message: 'Email auth provider is not configured for this local server.',
                  },
                },
                { status: 503 },
              ),
            getServerBaseUrl: () => 'http://server.test',
            storage: createMemoryStorage(),
          },
        ),
      (error: unknown) => error instanceof SignInFailure && error.reason === 'configuration',
    );
  });

  it('maps server configuration failures for account creation', async () => {
    clearServerAuthSession();

    await assert.rejects(
      () =>
        createAccountWithEmailPasswordFromSource(
          {
            name: 'User One',
            email: 'user@example.test',
            password: 'Password1!',
            passwordConfirmation: 'Password1!',
          },
          {
            fetch: async () =>
              response(
                {
                  error: {
                    code: 'configuration',
                    message: 'Email auth provider is not configured for this local server.',
                  },
                },
                { status: 503 },
              ),
            getServerBaseUrl: () => 'http://server.test',
            storage: createMemoryStorage(),
          },
        ),
      (error: unknown) => error instanceof CreateAccountFailure && error.reason === 'configuration',
    );
  });
});

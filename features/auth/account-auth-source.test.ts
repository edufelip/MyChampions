import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  confirmPasswordResetFromSource,
  requestPasswordResetFromSource,
  signOutFromSource,
} from './account-auth-source';
import { ResetPasswordConfirmFailure } from './reset-password.logic';
import {
  clearServerAuthSession,
  getCurrentServerAccessToken,
  startLocalServerSession,
} from './server-auth-source';

function response(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('account-auth-source', () => {
  it('requests password reset through the MyChampions server', async () => {
    let captured: Request | null = null;

    await requestPasswordResetFromSource(' USER@Example.test ', {
      fetch: async (input, init) => {
        captured = new Request(input, init);
        return response({ status: 'accepted' }, { status: 202 });
      },
      getServerBaseUrl: () => 'http://server.test',
    });

    assert.ok(captured);
    const request = captured as Request;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'http://server.test/auth/password-reset');
    assert.deepEqual(await request.json(), { email: 'user@example.test' });
  });

  it('requires the MyChampions server for password reset', async () => {
    await assert.rejects(
      () =>
        requestPasswordResetFromSource('user@example.test', {
          fetch: async () => {
            throw new Error('fetch should not be called');
          },
          getServerBaseUrl: () => undefined,
        }),
      /server URL is not configured/,
    );
  });

  it('clears a local server session without calling provider sign-out', async () => {
    await startLocalServerSession(
      { email: 'user@example.test', displayName: 'User One' },
      {
        fetch: async () =>
          response({
            accessToken: 'token-1',
            tokenType: 'Bearer',
            profile: {
              authUid: 'uid-1',
              displayName: 'User One',
              emailNormalized: 'user@example.test',
              lockedRole: null,
              acceptedTermsVersion: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        getServerBaseUrl: () => 'http://server.test',
      },
    );
    assert.equal(getCurrentServerAccessToken(), 'token-1');

    await signOutFromSource({
      fetch: async () => response({}),
      getServerBaseUrl: () => 'http://server.test',
    });

    assert.equal(getCurrentServerAccessToken(), null);
    clearServerAuthSession();
  });

  it('clears local session state without provider fallback when no server session is active', async () => {
    clearServerAuthSession();

    await signOutFromSource({
      fetch: async () => response({}),
      getServerBaseUrl: () => 'http://server.test',
    });

    assert.equal(getCurrentServerAccessToken(), null);
  });

  it('confirms a password reset through the MyChampions server', async () => {
    let captured: Request | null = null;

    await confirmPasswordResetFromSource(
      { email: ' USER@Example.test ', token: 'reset-token', newPassword: 'Str0ng!Pass' },
      {
        fetch: async (input, init) => {
          captured = new Request(input, init);
          return response({ status: 'reset' }, { status: 200 });
        },
        getServerBaseUrl: () => 'http://server.test',
      },
    );

    assert.ok(captured);
    const request = captured as Request;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'http://server.test/auth/password-reset/confirm');
    assert.deepEqual(await request.json(), {
      email: 'user@example.test',
      token: 'reset-token',
      newPassword: 'Str0ng!Pass',
    });
  });

  it('throws a ResetPasswordConfirmFailure with the server-reported reason on an invalid token', async () => {
    await assert.rejects(
      () =>
        confirmPasswordResetFromSource(
          { email: 'user@example.test', token: 'garbage', newPassword: 'Str0ng!Pass' },
          {
            fetch: async () =>
              response(
                { error: { code: 'invalid_or_expired_token', message: 'expired' } },
                { status: 400 },
              ),
            getServerBaseUrl: () => 'http://server.test',
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ResetPasswordConfirmFailure);
        assert.equal(error.reason, 'invalid_or_expired_token');
        return true;
      },
    );
  });

  it('requires the MyChampions server for password reset confirmation', async () => {
    await assert.rejects(
      () =>
        confirmPasswordResetFromSource(
          { email: 'user@example.test', token: 'reset-token', newPassword: 'Str0ng!Pass' },
          {
            fetch: async () => {
              throw new Error('fetch should not be called');
            },
            getServerBaseUrl: () => undefined,
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ResetPasswordConfirmFailure);
        assert.equal(error.reason, 'configuration');
        return true;
      },
    );
  });
});

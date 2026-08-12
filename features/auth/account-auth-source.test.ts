import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requestPasswordResetFromSource, signOutFromSource } from './account-auth-source';
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
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSupportInput } from './support.logic';
import { submitSupportMessage } from './support-source';

describe('Support Logic', () => {
  it('should return subject_required for empty subject', () => {
    assert.strictEqual(
      validateSupportInput({ subject: '', body: 'Valid body' }),
      'subject_required',
    );
    assert.strictEqual(
      validateSupportInput({ subject: '   ', body: 'Valid body' }),
      'subject_required',
    );
  });

  it('should return subject_too_long for subjects > 50 chars', () => {
    const longSubject = 'a'.repeat(51);
    assert.strictEqual(
      validateSupportInput({ subject: longSubject, body: 'Valid body' }),
      'subject_too_long',
    );
  });

  it('should return body_required for empty body', () => {
    assert.strictEqual(
      validateSupportInput({ subject: 'Valid subject', body: '' }),
      'body_required',
    );
    assert.strictEqual(
      validateSupportInput({ subject: 'Valid subject', body: '   ' }),
      'body_required',
    );
  });

  it('should return body_too_long for bodies > 500 chars', () => {
    const longBody = 'a'.repeat(501);
    assert.strictEqual(
      validateSupportInput({ subject: 'Valid subject', body: longBody }),
      'body_too_long',
    );
  });

  it('should return null for valid input', () => {
    assert.strictEqual(
      validateSupportInput({ subject: 'Issue with login', body: 'I cannot sign in with Google.' }),
      null,
    );
  });

  it('should account for trimming in length checks', () => {
    const fiftyChars = 'a'.repeat(50);
    assert.strictEqual(
      validateSupportInput({ subject: `  ${fiftyChars}  `, body: 'Valid body' }),
      null,
    );

    const fiftyOneChars = 'a'.repeat(51);
    assert.strictEqual(
      validateSupportInput({ subject: `  ${fiftyOneChars}  `, body: 'Valid body' }),
      'subject_too_long',
    );
  });

  it('uses a dev E2E auth-session fixture for support submit success without provider writes', async () => {
    const previousAppVariant = process.env.APP_VARIANT;
    const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

    process.env.APP_VARIANT = 'dev';
    process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

    try {
      const id = await submitSupportMessage(
        { subject: 'Need help', body: 'The app needs attention.', userRole: 'student' },
        {
          fetch: async () => {
            throw new Error('Server should not be called');
          },
          getCurrentAccessToken: async () => null,
          getServerBaseUrl: () => undefined,
          getAppVersion: () => '1.0.0',
          getPlatform: () => 'ios',
        },
      );

      assert.equal(id, 'support_e2e-auth-session-user');
    } finally {
      if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = previousAppVariant;

      if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
      else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

      if (previousDev === undefined)
        delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
      else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
    }
  });

  it('submits support messages through the MyChampions server with bearer auth', async () => {
    let captured: Request | null = null;

    const id = await submitSupportMessage(
      { subject: ' Need help ', body: ' The app needs attention. ', userRole: 'student' },
      {
        fetch: async (input, init) => {
          captured = new Request(input, init);
          return new Response(JSON.stringify({ id: 'support-1' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        },
        getCurrentAccessToken: async () => 'token-1',
        getServerBaseUrl: () => 'http://server.test',
        getAppVersion: () => '1.0.0',
        getPlatform: () => 'ios',
      },
    );

    assert.equal(id, 'support-1');
    assert.ok(captured);
    const request = captured as Request;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'http://server.test/support/messages');
    assert.equal(request.headers.get('authorization'), 'Bearer token-1');
    assert.deepEqual(await request.json(), {
      subject: 'Need help',
      body: 'The app needs attention.',
      userRole: 'student',
      appVersion: '1.0.0',
      platform: 'ios',
    });
  });
});

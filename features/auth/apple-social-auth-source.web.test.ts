import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { signInWithAppleProviderTokenFromSource } from './apple-social-auth-source.web';
import { SocialAuthSourceError } from './social-auth-source';

describe('Apple web social auth source', () => {
  it('uses cryptographically secure browser randomness for the Apple nonce', () => {
    const source = readFileSync(
      new URL('./apple-social-auth-source.web.ts', import.meta.url).pathname,
      'utf8'
    );
    assert.match(source, /crypto\.getRandomValues/);
    assert.doesNotMatch(source, /Math\.random/);
  });
  it('loads Apple JS and forwards the id token with nonce', async () => {
    let captured: unknown;
    await signInWithAppleProviderTokenFromSource({
      createNonce: () => 'nonce-1',
      getConfig: () => ({ clientId: 'apple.web', redirectUri: 'https://app.example/callback' }),
      loadAppleId: async () => {},
      signIn: async (input) => {
        assert.equal(input.nonce, 'nonce-1');
        return 'apple-id-token';
      },
      signInWithSocialProviderToken: async (input) => {
        captured = input;
      },
    });
    assert.deepEqual(captured, {
      provider: 'apple',
      idToken: 'apple-id-token',
      nonce: 'nonce-1',
    });
  });

  it('fails closed when either browser identifier is missing', async () => {
    await assert.rejects(
      signInWithAppleProviderTokenFromSource({
        createNonce: () => 'nonce',
        getConfig: () => ({ clientId: 'apple.web' }),
        loadAppleId: async () => {},
        signIn: async () => 'unused',
        signInWithSocialProviderToken: async () => {},
      }),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'configuration'
    );
  });

  it('preserves Apple browser cancellation', async () => {
    const cancellation = Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' });
    await assert.rejects(
      signInWithAppleProviderTokenFromSource({
        createNonce: () => 'nonce',
        getConfig: () => ({ clientId: 'apple.web', redirectUri: 'https://app.example/callback' }),
        loadAppleId: async () => {},
        signIn: async () => {
          throw cancellation;
        },
        signInWithSocialProviderToken: async () => {},
      }),
      (error: unknown) => error === cancellation
    );
  });
});

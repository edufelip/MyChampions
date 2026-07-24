import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInWithGoogleProviderTokenFromSource } from './google-social-auth-source.web';
import { SocialAuthSourceError } from './social-auth-source';

describe('Google web social auth source', () => {
  it('loads Google Identity Services and forwards its id token', async () => {
    let captured: unknown;
    await signInWithGoogleProviderTokenFromSource({
      getClientId: () => 'web-client-id',
      loadIdentityServices: async () => {},
      requestCredential: async (clientId) => {
        assert.equal(clientId, 'web-client-id');
        return 'google-id-token';
      },
      signInWithSocialProviderToken: async (input) => {
        captured = input;
      },
    });
    assert.deepEqual(captured, { provider: 'google', idToken: 'google-id-token' });
  });

  it('fails closed when the browser client id is missing', async () => {
    await assert.rejects(
      signInWithGoogleProviderTokenFromSource({
        getClientId: () => undefined,
        loadIdentityServices: async () => {},
        requestCredential: async () => 'unused',
        signInWithSocialProviderToken: async () => {},
      }),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'configuration'
    );
  });

  it('preserves provider cancellation for screen-level handling', async () => {
    const cancellation = Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' });
    await assert.rejects(
      signInWithGoogleProviderTokenFromSource({
        getClientId: () => 'web-client-id',
        loadIdentityServices: async () => {},
        requestCredential: async () => {
          throw cancellation;
        },
        signInWithSocialProviderToken: async () => {},
      }),
      (error: unknown) => error === cancellation
    );
  });
});

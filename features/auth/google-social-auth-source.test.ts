import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  signInWithGoogleProviderTokenFromSource,
  type GoogleSocialAuthSourceDeps,
} from './google-social-auth-source';
import { SocialAuthSourceError, type SocialAuthSourceInput } from './social-auth-source';

function makeDeps(
  overrides: Partial<GoogleSocialAuthSourceDeps> = {}
): GoogleSocialAuthSourceDeps {
  return {
    configure: () => undefined,
    ensurePlayServices: async () => true,
    getClientIds: () => ({
      iosClientId: 'ios-client-id.apps.googleusercontent.com',
      webClientId: 'web-client-id.apps.googleusercontent.com',
    }),
    getPlatform: () => 'android',
    signIn: async () => ({
      type: 'success',
      data: { idToken: 'google-id-token' },
    }),
    signInWithSocialProviderToken: async () => undefined,
    ...overrides,
  };
}

describe('google-social-auth-source', () => {
  it('configures native Google sign-in and forwards the Android id token to the server source', async () => {
    const configurations: unknown[] = [];
    const playServicesChecks: unknown[] = [];
    const socialInputs: SocialAuthSourceInput[] = [];

    await signInWithGoogleProviderTokenFromSource(
      makeDeps({
        configure: (input) => configurations.push(input),
        ensurePlayServices: async (input) => {
          playServicesChecks.push(input);
          return true;
        },
        signIn: async () => ({
          type: 'success',
          data: { idToken: ' google-id-token ' },
        }),
        signInWithSocialProviderToken: async (input) => {
          socialInputs.push(input);
        },
      })
    );

    assert.deepEqual(configurations, [
      {
        offlineAccess: false,
        webClientId: 'web-client-id.apps.googleusercontent.com',
      },
    ]);
    assert.deepEqual(playServicesChecks, [{ showPlayServicesUpdateDialog: true }]);
    assert.deepEqual(socialInputs, [
      {
        provider: 'google',
        idToken: 'google-id-token',
      },
    ]);
  });

  it('configures the iOS client id and skips the Android Play Services check', async () => {
    const configurations: unknown[] = [];
    let playServicesChecks = 0;

    await signInWithGoogleProviderTokenFromSource(
      makeDeps({
        configure: (input) => configurations.push(input),
        ensurePlayServices: async () => {
          playServicesChecks += 1;
          return true;
        },
        getPlatform: () => 'ios',
      })
    );

    assert.deepEqual(configurations, [
      {
        iosClientId: 'ios-client-id.apps.googleusercontent.com',
        offlineAccess: false,
        webClientId: 'web-client-id.apps.googleusercontent.com',
      },
    ]);
    assert.equal(playServicesChecks, 0);
  });

  it('fails closed when the Google web client id is not configured', async () => {
    await assert.rejects(
      () =>
        signInWithGoogleProviderTokenFromSource(
          makeDeps({
            getClientIds: () => ({
              iosClientId: 'ios-client-id.apps.googleusercontent.com',
            }),
            signIn: async () => {
              throw new Error('Google prompt should not run');
            },
          })
        ),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'configuration'
    );
  });

  it('fails closed when the iOS client id is not configured on iOS', async () => {
    await assert.rejects(
      () =>
        signInWithGoogleProviderTokenFromSource(
          makeDeps({
            getClientIds: () => ({
              webClientId: 'web-client-id.apps.googleusercontent.com',
            }),
            getPlatform: () => 'ios',
          })
        ),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'configuration'
    );
  });

  it('treats a native cancelled response as a user cancellation', async () => {
    await assert.rejects(
      () =>
        signInWithGoogleProviderTokenFromSource(
          makeDeps({
            signIn: async () => ({ type: 'cancelled', data: null }),
          })
        ),
      (error: unknown) =>
        error instanceof Error &&
        typeof (error as { code?: unknown }).code === 'string' &&
        String((error as { code?: unknown }).code).includes('ERR_REQUEST_CANCELED')
    );
  });

  it('normalizes native cancellation errors for screen-level cancellation handling', async () => {
    await assert.rejects(
      () =>
        signInWithGoogleProviderTokenFromSource(
          makeDeps({
            signIn: async () => {
              const error = new Error('cancelled') as Error & { code: string };
              error.code = 'SIGN_IN_CANCELLED';
              throw error;
            },
          })
        ),
      (error: unknown) =>
        error instanceof Error &&
        typeof (error as { code?: unknown }).code === 'string' &&
        String((error as { code?: unknown }).code).includes('ERR_REQUEST_CANCELED')
    );
  });

  it('fails closed when native Google sign-in does not return an id token', async () => {
    await assert.rejects(
      () =>
        signInWithGoogleProviderTokenFromSource(
          makeDeps({
            signIn: async () => ({
              type: 'success',
              data: { idToken: null },
            }),
          })
        ),
      (error: unknown) =>
        error instanceof SocialAuthSourceError && error.code === 'invalid_credentials'
    );
  });

  it('maps unavailable Play Services and provider failures to provider-neutral network errors', async () => {
    await assert.rejects(
      () =>
        signInWithGoogleProviderTokenFromSource(
          makeDeps({ ensurePlayServices: async () => false })
        ),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'network'
    );

    await assert.rejects(
      () =>
        signInWithGoogleProviderTokenFromSource(
          makeDeps({
            signIn: async () => {
              throw new Error('native provider unavailable');
            },
          })
        ),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'network'
    );
  });
});

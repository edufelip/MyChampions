import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  signInWithAppleProviderTokenFromSource,
  type AppleSocialAuthSourceDeps,
} from './apple-social-auth-source';
import { SocialAuthSourceError, type SocialAuthSourceInput } from './social-auth-source';

describe('apple-social-auth-source', () => {
  it('captures an Apple identity token and signs in through the MyChampions social auth source', async () => {
    const socialInputs: SocialAuthSourceInput[] = [];
    const signInOptions: unknown[] = [];
    const deps: AppleSocialAuthSourceDeps = {
      createNonce: () => 'nonce-1',
      isAvailableAsync: async () => true,
      scopes: {
        email: 'EMAIL',
        fullName: 'FULL_NAME',
      },
      signInAsync: async (options) => {
        signInOptions.push(options);
        return {
          identityToken: ' apple-id-token ',
        };
      },
      signInWithSocialProviderToken: async (input) => {
        socialInputs.push(input);
      },
    };

    await signInWithAppleProviderTokenFromSource(deps);

    assert.deepEqual(signInOptions, [
      {
        requestedScopes: ['FULL_NAME', 'EMAIL'],
        nonce: 'nonce-1',
      },
    ]);
    assert.deepEqual(socialInputs, [
      {
        provider: 'apple',
        idToken: 'apple-id-token',
        nonce: 'nonce-1',
      },
    ]);
  });

  it('fails closed when native Apple authentication is unavailable', async () => {
    await assert.rejects(
      () =>
        signInWithAppleProviderTokenFromSource({
          createNonce: () => 'nonce-1',
          isAvailableAsync: async () => false,
          scopes: {
            email: 'EMAIL',
            fullName: 'FULL_NAME',
          },
          signInAsync: async () => {
            throw new Error('signInAsync should not run');
          },
          signInWithSocialProviderToken: async () => {
            throw new Error('server sign-in should not run');
          },
        }),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'configuration'
    );
  });

  it('maps native Apple availability check failures to a provider-neutral network error', async () => {
    await assert.rejects(
      () =>
        signInWithAppleProviderTokenFromSource({
          createNonce: () => 'nonce-1',
          isAvailableAsync: async () => {
            throw new Error('apple availability check failed');
          },
          scopes: {
            email: 'EMAIL',
            fullName: 'FULL_NAME',
          },
          signInAsync: async () => {
            throw new Error('signInAsync should not run after availability failure');
          },
          signInWithSocialProviderToken: async () => {
            throw new Error('server sign-in should not run after availability failure');
          },
        }),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'network'
    );
  });

  it('fails closed when Apple does not return an identity token', async () => {
    await assert.rejects(
      () =>
        signInWithAppleProviderTokenFromSource({
          createNonce: () => 'nonce-1',
          isAvailableAsync: async () => true,
          scopes: {
            email: 'EMAIL',
            fullName: 'FULL_NAME',
          },
          signInAsync: async () => ({
            identityToken: null,
          }),
          signInWithSocialProviderToken: async () => {
            throw new Error('server sign-in should not run');
          },
        }),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'invalid_credentials'
    );
  });

  it('maps native Apple sign-in failures to a provider-neutral network error', async () => {
    await assert.rejects(
      () =>
        signInWithAppleProviderTokenFromSource({
          createNonce: () => 'nonce-1',
          isAvailableAsync: async () => true,
          scopes: {
            email: 'EMAIL',
            fullName: 'FULL_NAME',
          },
          signInAsync: async () => {
            throw new Error('apple auth service unavailable');
          },
          signInWithSocialProviderToken: async () => {
            throw new Error('server sign-in should not run after native failure');
          },
        }),
      (error: unknown) => error instanceof SocialAuthSourceError && error.code === 'network'
    );
  });

  it('preserves native Apple cancellation errors for screen-level cancellation handling', async () => {
    await assert.rejects(
      () =>
        signInWithAppleProviderTokenFromSource({
          createNonce: () => 'nonce-1',
          isAvailableAsync: async () => true,
          scopes: {
            email: 'EMAIL',
            fullName: 'FULL_NAME',
          },
          signInAsync: async () => {
            const error = new Error('cancelled') as Error & { code: string };
            error.code = 'ERR_REQUEST_CANCELED';
            throw error;
          },
          signInWithSocialProviderToken: async () => {
            throw new Error('server sign-in should not run after cancellation');
          },
        }),
      (error: unknown) =>
        error instanceof Error &&
        typeof (error as { code?: unknown }).code === 'string' &&
        String((error as { code?: unknown }).code).includes('ERR_REQUEST_CANCELED')
    );
  });
});

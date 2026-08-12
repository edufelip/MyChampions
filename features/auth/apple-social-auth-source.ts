import {
  signInWithSocialProviderTokenFromSource,
  SocialAuthSourceError,
  type SocialAuthSourceInput,
} from './social-auth-source';

type AppleSignInCredential = {
  identityToken: string | null;
};

type AppleSignInOptions = {
  requestedScopes: unknown[];
  nonce: string;
};

export type AppleSocialAuthSourceDeps = {
  createNonce: () => string;
  isAvailableAsync: () => Promise<boolean>;
  scopes: {
    email: unknown;
    fullName: unknown;
  };
  signInAsync: (options: AppleSignInOptions) => Promise<AppleSignInCredential>;
  signInWithSocialProviderToken: (input: SocialAuthSourceInput) => Promise<void>;
};

function createNonce(): string {
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}${random}`;
}

function makeDeps(): AppleSocialAuthSourceDeps {
  const AppleAuthentication = require('expo-apple-authentication') as {
    AppleAuthenticationScope: {
      EMAIL: unknown;
      FULL_NAME: unknown;
    };
    isAvailableAsync: () => Promise<boolean>;
    signInAsync: (options: AppleSignInOptions) => Promise<AppleSignInCredential>;
  };

  return {
    createNonce,
    isAvailableAsync: AppleAuthentication.isAvailableAsync,
    scopes: {
      email: AppleAuthentication.AppleAuthenticationScope.EMAIL,
      fullName: AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
    },
    signInAsync: AppleAuthentication.signInAsync,
    signInWithSocialProviderToken: signInWithSocialProviderTokenFromSource,
  };
}

function isCancellationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    String((error as { code?: unknown }).code).includes('ERR_REQUEST_CANCELED')
  );
}

export async function signInWithAppleProviderTokenFromSource(
  deps: AppleSocialAuthSourceDeps = makeDeps(),
): Promise<void> {
  let isAvailable: boolean;
  try {
    isAvailable = await deps.isAvailableAsync();
  } catch (error: unknown) {
    if (error instanceof SocialAuthSourceError || isCancellationError(error)) {
      throw error;
    }
    throw new SocialAuthSourceError('network', 'Apple authentication availability check failed.');
  }

  if (!isAvailable) {
    throw new SocialAuthSourceError('configuration', 'Apple authentication is not available.');
  }

  const nonce = deps.createNonce();
  let credential: AppleSignInCredential;
  try {
    credential = await deps.signInAsync({
      requestedScopes: [deps.scopes.fullName, deps.scopes.email],
      nonce,
    });
  } catch (error: unknown) {
    if (error instanceof SocialAuthSourceError || isCancellationError(error)) {
      throw error;
    }
    throw new SocialAuthSourceError('network', 'Apple sign-in request failed.');
  }
  const idToken = credential.identityToken?.trim();

  if (!idToken) {
    throw new SocialAuthSourceError(
      'invalid_credentials',
      'Apple did not return an identity token.',
    );
  }

  await deps.signInWithSocialProviderToken({
    provider: 'apple',
    idToken,
    nonce,
  });
}

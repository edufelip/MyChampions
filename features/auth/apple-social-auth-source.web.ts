import {
  signInWithSocialProviderTokenFromSource,
  SocialAuthSourceError,
  type SocialAuthSourceInput,
} from './social-auth-source';
import { loadWebProviderScript } from './web-provider-script-loader';

type AppleWebConfig = { clientId?: string; redirectUri?: string };

export type AppleWebSocialAuthSourceDeps = {
  createNonce: () => string;
  getConfig: () => AppleWebConfig;
  loadAppleId: () => Promise<void>;
  signIn: (input: { clientId: string; redirectUri: string; nonce: string }) => Promise<string>;
  signInWithSocialProviderToken: (input: SocialAuthSourceInput) => Promise<void>;
};

function createCanceledError() {
  const error = new Error('Apple sign-in was canceled.') as Error & { code: string };
  error.code = 'ERR_REQUEST_CANCELED';
  return error;
}

function createSecureNonce(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new SocialAuthSourceError('configuration', 'Secure browser randomness is unavailable.');
  }
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getConfig(): AppleWebConfig {
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: { appleWebAuth?: AppleWebConfig } } };
      expoConfig?: { extra?: { appleWebAuth?: AppleWebConfig } };
    };
    const extra = (Constants.default ?? Constants).expoConfig?.extra?.appleWebAuth;
    return {
      clientId: extra?.clientId?.trim() || process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID?.trim(),
      redirectUri:
        extra?.redirectUri?.trim() || process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI?.trim(),
    };
  } catch {
    return {
      clientId: process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID?.trim(),
      redirectUri: process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI?.trim(),
    };
  }
}

async function signInWithApple(input: {
  clientId: string;
  redirectUri: string;
  nonce: string;
}): Promise<string> {
  const AppleID = (
    globalThis as typeof globalThis & {
      AppleID?: {
        auth?: {
          init: (config: Record<string, unknown>) => void;
          signIn: () => Promise<{ authorization?: { id_token?: string } }>;
        };
      };
    }
  ).AppleID;
  if (!AppleID?.auth) {
    throw new SocialAuthSourceError('configuration', 'Sign in with Apple JS is unavailable.');
  }
  AppleID.auth.init({
    clientId: input.clientId,
    scope: 'name email',
    redirectURI: input.redirectUri,
    nonce: input.nonce,
    usePopup: true,
  });
  try {
    const result = await AppleID.auth.signIn();
    const idToken = result.authorization?.id_token?.trim();
    if (!idToken) {
      throw new SocialAuthSourceError(
        'invalid_credentials',
        'Apple did not return an identity token.',
      );
    }
    return idToken;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'error' in error &&
      String((error as { error?: unknown }).error)
        .toLowerCase()
        .includes('cancel')
    ) {
      throw createCanceledError();
    }
    throw error;
  }
}

function makeDeps(): AppleWebSocialAuthSourceDeps {
  return {
    createNonce: createSecureNonce,
    getConfig,
    loadAppleId: () =>
      loadWebProviderScript(
        'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
        'mychampions-appleid-auth',
      ),
    signIn: signInWithApple,
    signInWithSocialProviderToken: signInWithSocialProviderTokenFromSource,
  };
}

export async function signInWithAppleProviderTokenFromSource(
  deps: AppleWebSocialAuthSourceDeps = makeDeps(),
): Promise<void> {
  const config = deps.getConfig();
  const clientId = config.clientId?.trim();
  const redirectUri = config.redirectUri?.trim();
  if (!clientId || !redirectUri) {
    throw new SocialAuthSourceError(
      'configuration',
      'Apple web client id and redirect URI must be configured.',
    );
  }
  const nonce = deps.createNonce();
  try {
    await deps.loadAppleId();
    const idToken = await deps.signIn({ clientId, redirectUri, nonce });
    await deps.signInWithSocialProviderToken({ provider: 'apple', idToken, nonce });
  } catch (error) {
    if (
      error instanceof SocialAuthSourceError ||
      (typeof error === 'object' && error !== null && 'code' in error)
    ) {
      throw error;
    }
    throw new SocialAuthSourceError('network', 'Apple browser sign-in failed.');
  }
}

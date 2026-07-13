import {
  signInWithSocialProviderTokenFromSource,
  SocialAuthSourceError,
  type SocialAuthSourceInput,
} from './social-auth-source';

type GoogleClientIds = {
  iosClientId?: string;
  webClientId?: string;
};

type GoogleNativeSignInResponse =
  | {
      type: 'success';
      data: { idToken: string | null };
    }
  | {
      type: 'cancelled';
      data: null;
    };

type GoogleNativeConfiguration = {
  iosClientId?: string;
  offlineAccess: false;
  webClientId: string;
};

export type GoogleSocialAuthSourceDeps = {
  configure: (input: GoogleNativeConfiguration) => void;
  ensurePlayServices: (input: { showPlayServicesUpdateDialog: true }) => Promise<boolean>;
  getClientIds: () => GoogleClientIds;
  getPlatform: () => string | undefined;
  signIn: () => Promise<GoogleNativeSignInResponse>;
  signInWithSocialProviderToken: (input: SocialAuthSourceInput) => Promise<void>;
};

class GoogleSocialAuthCanceledError extends Error {
  readonly code = 'ERR_REQUEST_CANCELED';

  constructor() {
    super('Google sign-in was canceled.');
    this.name = 'GoogleSocialAuthCanceledError';
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isCancellationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = String((error as { code?: unknown }).code ?? '');
  return code.includes('ERR_REQUEST_CANCELED') || code.includes('SIGN_IN_CANCELLED');
}

function readExpoExtra(): {
  googleAuth?: {
    iosClientId?: string;
    webClientId?: string;
  };
} {
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: unknown } };
      expoConfig?: { extra?: unknown };
    };
    return (((Constants.default ?? Constants).expoConfig?.extra ?? {}) as {
      googleAuth?: {
        iosClientId?: string;
        webClientId?: string;
      };
    });
  } catch {
    return {};
  }
}

function resolveGoogleClientIds(): GoogleClientIds {
  const googleAuth = readExpoExtra().googleAuth ?? {};
  return {
    iosClientId: trimOptional(
      googleAuth.iosClientId ?? process.env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID
    ),
    webClientId: trimOptional(
      googleAuth.webClientId ?? process.env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID
    ),
  };
}

function resolvePlatform(): string | undefined {
  try {
    const ReactNative = require('react-native') as {
      Platform?: { OS?: string };
    };
    return ReactNative.Platform?.OS;
  } catch {
    return undefined;
  }
}

function makeDeps(): GoogleSocialAuthSourceDeps {
  const { GoogleSignin } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');

  return {
    configure: (input) => GoogleSignin.configure(input),
    ensurePlayServices: (input) => GoogleSignin.hasPlayServices(input),
    getClientIds: resolveGoogleClientIds,
    getPlatform: resolvePlatform,
    signIn: () => GoogleSignin.signIn(),
    signInWithSocialProviderToken: signInWithSocialProviderTokenFromSource,
  };
}

export async function signInWithGoogleProviderTokenFromSource(
  deps: GoogleSocialAuthSourceDeps = makeDeps()
): Promise<void> {
  let clientIds: GoogleClientIds;
  let platform: string | undefined;
  try {
    clientIds = deps.getClientIds();
    platform = deps.getPlatform();
  } catch {
    throw new SocialAuthSourceError('configuration', 'Google OAuth client ids could not be resolved.');
  }

  const webClientId = trimOptional(clientIds.webClientId);
  const iosClientId = trimOptional(clientIds.iosClientId);
  if (!webClientId) {
    throw new SocialAuthSourceError('configuration', 'Google web OAuth client id is not configured.');
  }
  if (platform === 'ios' && !iosClientId) {
    throw new SocialAuthSourceError('configuration', 'Google iOS OAuth client id is not configured.');
  }

  try {
    deps.configure({
      ...(platform === 'ios' && iosClientId ? { iosClientId } : {}),
      offlineAccess: false,
      webClientId,
    });
  } catch {
    throw new SocialAuthSourceError('configuration', 'Native Google Sign-In could not be configured.');
  }

  if (platform === 'android') {
    try {
      const available = await deps.ensurePlayServices({ showPlayServicesUpdateDialog: true });
      if (!available) {
        throw new Error('Google Play Services are unavailable.');
      }
    } catch {
      throw new SocialAuthSourceError('network', 'Google Play Services are unavailable.');
    }
  }

  let result: GoogleNativeSignInResponse;
  try {
    result = await deps.signIn();
  } catch (error: unknown) {
    if (error instanceof SocialAuthSourceError) {
      throw error;
    }
    if (isCancellationError(error)) {
      throw new GoogleSocialAuthCanceledError();
    }
    throw new SocialAuthSourceError('network', 'Native Google sign-in failed.');
  }

  if (result.type === 'cancelled') {
    throw new GoogleSocialAuthCanceledError();
  }

  const idToken = result.data.idToken?.trim();
  if (!idToken) {
    throw new SocialAuthSourceError('invalid_credentials', 'Google did not return an id token.');
  }

  await deps.signInWithSocialProviderToken({
    provider: 'google',
    idToken,
  });
}

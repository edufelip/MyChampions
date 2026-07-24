import {
  signInWithSocialProviderTokenFromSource,
  SocialAuthSourceError,
  type SocialAuthSourceInput,
} from './social-auth-source';
import { loadWebProviderScript } from './web-provider-script-loader';

type GoogleCredentialResponse = { credential?: string };
type GooglePromptMomentNotification = {
  isDismissedMoment: () => boolean;
  isNotDisplayed: () => boolean;
};

export type GoogleWebSocialAuthSourceDeps = {
  getClientId: () => string | undefined;
  loadIdentityServices: () => Promise<void>;
  requestCredential: (clientId: string) => Promise<string>;
  signInWithSocialProviderToken: (input: SocialAuthSourceInput) => Promise<void>;
};

class GoogleWebAuthCanceledError extends Error {
  readonly code = 'ERR_REQUEST_CANCELED';

  constructor() {
    super('Google sign-in was canceled.');
    this.name = 'GoogleWebAuthCanceledError';
  }
}

function isCancellationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code?: unknown }).code).includes('ERR_REQUEST_CANCELED')
  );
}

function readClientId(): string | undefined {
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: { googleAuth?: { webClientId?: string } } } };
      expoConfig?: { extra?: { googleAuth?: { webClientId?: string } } };
    };
    const value = (Constants.default ?? Constants).expoConfig?.extra?.googleAuth?.webClientId;
    return value?.trim() || process.env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID?.trim();
  } catch {
    return process.env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID?.trim();
  }
}

function requestGoogleCredential(clientId: string): Promise<string> {
  const google = (globalThis as typeof globalThis & {
    google?: {
      accounts?: {
        id?: {
          initialize: (input: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            cancel_on_tap_outside: boolean;
          }) => void;
          prompt: (callback: (notification: GooglePromptMomentNotification) => void) => void;
        };
      };
    };
  }).google;
  if (!google?.accounts?.id) {
    return Promise.reject(new SocialAuthSourceError('configuration', 'Google Identity Services is unavailable.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    google.accounts!.id!.initialize({
      client_id: clientId,
      cancel_on_tap_outside: true,
      callback: (response) => {
        if (settled) return;
        settled = true;
        const credential = response.credential?.trim();
        if (credential) resolve(credential);
        else reject(new SocialAuthSourceError('invalid_credentials', 'Google did not return an id token.'));
      },
    });
    google.accounts!.id!.prompt((notification) => {
      if (!settled && (notification.isDismissedMoment() || notification.isNotDisplayed())) {
        settled = true;
        reject(new GoogleWebAuthCanceledError());
      }
    });
  });
}

function makeDeps(): GoogleWebSocialAuthSourceDeps {
  return {
    getClientId: readClientId,
    loadIdentityServices: () =>
      loadWebProviderScript('https://accounts.google.com/gsi/client', 'mychampions-google-identity-services'),
    requestCredential: requestGoogleCredential,
    signInWithSocialProviderToken: signInWithSocialProviderTokenFromSource,
  };
}

export async function signInWithGoogleProviderTokenFromSource(
  deps: GoogleWebSocialAuthSourceDeps = makeDeps()
): Promise<void> {
  const clientId = deps.getClientId()?.trim();
  if (!clientId) {
    throw new SocialAuthSourceError('configuration', 'Google web OAuth client id is not configured.');
  }
  try {
    await deps.loadIdentityServices();
    const idToken = await deps.requestCredential(clientId);
    await deps.signInWithSocialProviderToken({ provider: 'google', idToken });
  } catch (error) {
    if (
      error instanceof SocialAuthSourceError ||
      error instanceof GoogleWebAuthCanceledError ||
      isCancellationError(error)
    ) {
      throw error;
    }
    throw new SocialAuthSourceError('network', 'Google browser sign-in failed.');
  }
}

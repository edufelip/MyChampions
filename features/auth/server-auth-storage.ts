import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ServerAuthStorage } from './server-auth-source';

export type SecureTokenStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

type AsyncKeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type PersistedSessionRecord = Record<string, unknown> & {
  accessToken?: unknown;
  refreshToken?: unknown;
};

const SECURE_KEY_PREFIX = 'secure.';

function secureKeyFor(key: string): string {
  return `${SECURE_KEY_PREFIX}${key}`;
}

function resolveSecureStore(): SecureTokenStore {
  // Lazily required: expo-secure-store wraps the iOS Keychain / Android
  // Keystore native module. Metro bundles it fine for a real app build, but a
  // plain Node/tsx unit-test process cannot load it (it transitively pulls in
  // react-native's Flow-typed entry point). This mirrors the lazy
  // require + try/catch pattern already used for expo-constants and
  // react-native elsewhere in this feature (see google-social-auth-source.ts,
  // server-auth-source.ts's resolveServerBaseUrl/isLocalServerAuthEnabled).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-secure-store') as typeof import('expo-secure-store');
  } catch (error) {
    throw new Error('expo-secure-store is unavailable in this runtime', { cause: error });
  }
}

function extractTokens(record: PersistedSessionRecord): {
  accessToken: string | null;
  refreshToken: string | null;
} {
  return {
    accessToken: typeof record.accessToken === 'string' ? record.accessToken : null,
    refreshToken: typeof record.refreshToken === 'string' ? record.refreshToken : null,
  };
}

function omitTokens(record: PersistedSessionRecord): Record<string, unknown> {
  const { accessToken: _accessToken, refreshToken: _refreshToken, ...rest } = record;
  return rest;
}

/**
 * Splits a persisted server-auth session across two backing stores instead of
 * writing the whole JSON blob to AsyncStorage:
 *
 * - The bearer credentials (access + refresh token — the actual secret that
 *   lets a device act as the user for up to 30 days) go into `secureStore`,
 *   which on native is expo-secure-store (iOS Keychain / Android Keystore).
 * - The remaining session fields (profile, expiry, provider ids) are not
 *   authentication secrets on their own and stay in plain `asyncStorage`.
 *
 * This split also keeps each SecureStore write comfortably under its
 * ~2048-byte platform limit (see node_modules/expo-secure-store's
 * byteCounter.ts): this app's RS256-signed access + refresh tokens alone run
 * close to that ceiling, and folding the full session (profile, timestamps,
 * display name, email) into the same encrypted value would risk tipping over
 * it for longer display names/emails, which today only warns instead of
 * failing loudly. See server-auth-storage.test.ts for the size-margin check.
 *
 * A record written by the pre-fix code (tokens embedded directly in the
 * AsyncStorage blob) is migrated in place the first time it is read: the
 * tokens are copied into SecureStore and stripped out of the AsyncStorage
 * copy, so an already-logged-in user keeps their session instead of being
 * silently signed out by this fix.
 */
export function createServerAuthSecureStorage(
  asyncStorage: AsyncKeyValueStore = AsyncStorage,
  secureStore: SecureTokenStore = resolveSecureStore(),
): ServerAuthStorage {
  return {
    async getItem(key) {
      const rawRest = await asyncStorage.getItem(key);
      if (!rawRest) return null;

      let parsed: PersistedSessionRecord;
      try {
        parsed = JSON.parse(rawRest) as PersistedSessionRecord;
      } catch {
        return null;
      }

      const secureRaw = await secureStore.getItemAsync(secureKeyFor(key));
      if (secureRaw !== null) {
        let secureTokens: PersistedSessionRecord = {};
        try {
          secureTokens = JSON.parse(secureRaw) as PersistedSessionRecord;
        } catch {
          secureTokens = {};
        }
        const tokens = extractTokens(secureTokens);
        return JSON.stringify({
          ...omitTokens(parsed),
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
      }

      // Legacy pre-fix record: tokens are still embedded directly in the
      // AsyncStorage blob (no SecureStore entry exists yet). Migrate them
      // into SecureStore once, then strip them out of the AsyncStorage copy.
      const legacyTokens = extractTokens(parsed);
      if (legacyTokens.accessToken === null) return null;

      try {
        await secureStore.setItemAsync(secureKeyFor(key), JSON.stringify(legacyTokens));
        await asyncStorage.setItem(key, JSON.stringify(omitTokens(parsed)));
      } catch {
        // Migration will be retried on the next read; the legacy blob keeps
        // working in the meantime, so the user is not signed out by this.
      }
      return rawRest;
    },

    async setItem(key, value) {
      const parsed = JSON.parse(value) as PersistedSessionRecord;
      await secureStore.setItemAsync(secureKeyFor(key), JSON.stringify(extractTokens(parsed)));
      await asyncStorage.setItem(key, JSON.stringify(omitTokens(parsed)));
    },

    async removeItem(key) {
      await Promise.all([
        secureStore.deleteItemAsync(secureKeyFor(key)).catch(() => {
          // AsyncStorage removal below is what actually clears the session;
          // a stale SecureStore entry is harmless without its AsyncStorage
          // counterpart and will be overwritten by the next setItem.
        }),
        asyncStorage.removeItem(key),
      ]);
    },
  };
}

export const serverAuthStorage: ServerAuthStorage = {
  getItem: (key) => createServerAuthSecureStorage().getItem(key),
  setItem: (key, value) => createServerAuthSecureStorage().setItem(key, value),
  removeItem: (key) => createServerAuthSecureStorage().removeItem(key),
};

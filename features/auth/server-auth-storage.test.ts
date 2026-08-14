import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServerAuthSecureStorage, type SecureTokenStore } from './server-auth-storage';

type AsyncKeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function createMemoryAsyncStorage(): AsyncKeyValueStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: async (key) => raw.get(key) ?? null,
    setItem: async (key, value) => {
      raw.set(key, value);
    },
    removeItem: async (key) => {
      raw.delete(key);
    },
  };
}

function createMemorySecureStore(): SecureTokenStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItemAsync: async (key) => raw.get(key) ?? null,
    setItemAsync: async (key, value) => {
      raw.set(key, value);
    },
    deleteItemAsync: async (key) => {
      raw.delete(key);
    },
  };
}

const STORAGE_KEY = 'auth.server.session';
const SECURE_STORAGE_KEY = `secure.${STORAGE_KEY}`;

function sampleSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    tokenType: 'Bearer',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    authProviderIds: ['email_password'],
    emailVerified: true,
    profile: {
      authUid: 'user-123',
      displayName: 'Test User',
      emailNormalized: 'test@example.com',
      lockedRole: null,
      acceptedTermsVersion: 'v1',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    ...overrides,
  };
}

// A realistic RS256 JWT-shaped string: header + payload + a 256-byte
// (~342-char base64url) signature, matching the shape of the tokens issued
// by server/src/auth/tokens.ts (SignJWT(...).sign(privateKey) under RS256).
function jwtLike(payloadBytes: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'local-dev-key' })).toString(
    'base64url',
  );
  const payload = Buffer.from('x'.repeat(payloadBytes)).toString('base64url');
  const signature = Buffer.from('s'.repeat(256)).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('server-auth-storage (secure token split)', () => {
  it('setItem never writes the bearer tokens to AsyncStorage', async () => {
    const asyncStorage = createMemoryAsyncStorage();
    const secureStore = createMemorySecureStore();
    const storage = createServerAuthSecureStorage(asyncStorage, secureStore);

    await storage.setItem(STORAGE_KEY, JSON.stringify(sampleSession()));

    const persistedInAsyncStorage = asyncStorage.raw.get(STORAGE_KEY) ?? '';
    assert.equal(persistedInAsyncStorage.includes('access-token-value'), false);
    assert.equal(persistedInAsyncStorage.includes('refresh-token-value'), false);

    const persistedInSecureStore = secureStore.raw.get(SECURE_STORAGE_KEY) ?? '';
    assert.equal(persistedInSecureStore.includes('access-token-value'), true);
    assert.equal(persistedInSecureStore.includes('refresh-token-value'), true);
  });

  it('getItem reconstructs the full session from the split stores', async () => {
    const asyncStorage = createMemoryAsyncStorage();
    const secureStore = createMemorySecureStore();
    const storage = createServerAuthSecureStorage(asyncStorage, secureStore);

    const session = sampleSession();
    await storage.setItem(STORAGE_KEY, JSON.stringify(session));

    const roundTripped = JSON.parse((await storage.getItem(STORAGE_KEY)) ?? 'null');
    assert.deepEqual(roundTripped, session);
  });

  it('migrates a legacy pre-fix record (tokens embedded in AsyncStorage) into SecureStore on first read', async () => {
    const asyncStorage = createMemoryAsyncStorage();
    const secureStore = createMemorySecureStore();
    const storage = createServerAuthSecureStorage(asyncStorage, secureStore);

    const legacySession = sampleSession();
    // Simulate the pre-fix on-disk state: the whole blob, tokens included,
    // written directly to AsyncStorage with no SecureStore entry.
    asyncStorage.raw.set(STORAGE_KEY, JSON.stringify(legacySession));

    const firstRead = JSON.parse((await storage.getItem(STORAGE_KEY)) ?? 'null');
    assert.deepEqual(firstRead, legacySession, 'first read still returns the full session');

    const migratedAsyncValue = asyncStorage.raw.get(STORAGE_KEY) ?? '';
    assert.equal(
      migratedAsyncValue.includes('access-token-value'),
      false,
      'tokens stripped from AsyncStorage after migration',
    );
    assert.equal(migratedAsyncValue.includes('refresh-token-value'), false);

    const migratedSecureValue = secureStore.raw.get(SECURE_STORAGE_KEY) ?? '';
    assert.equal(
      migratedSecureValue.includes('access-token-value'),
      true,
      'tokens present in SecureStore after migration',
    );

    const secondRead = JSON.parse((await storage.getItem(STORAGE_KEY)) ?? 'null');
    assert.deepEqual(secondRead, legacySession, 'session survives across the migration boundary');
  });

  it('removeItem clears both the AsyncStorage and SecureStore entries', async () => {
    const asyncStorage = createMemoryAsyncStorage();
    const secureStore = createMemorySecureStore();
    const storage = createServerAuthSecureStorage(asyncStorage, secureStore);

    await storage.setItem(STORAGE_KEY, JSON.stringify(sampleSession()));
    await storage.removeItem(STORAGE_KEY);

    assert.equal(asyncStorage.raw.has(STORAGE_KEY), false);
    assert.equal(secureStore.raw.has(SECURE_STORAGE_KEY), false);
    assert.equal(await storage.getItem(STORAGE_KEY), null);
  });

  it('keeps the SecureStore token payload under the platform 2048-byte limit with realistic RS256 tokens', async () => {
    const asyncStorage = createMemoryAsyncStorage();
    const secureStore = createMemorySecureStore();
    const storage = createServerAuthSecureStorage(asyncStorage, secureStore);

    // Sized to roughly match server/src/auth/tokens.ts's RS256 access/refresh
    // token claims (email + displayName + provider/session id).
    const accessToken = jwtLike(220);
    const refreshToken = jwtLike(320);
    const session = sampleSession({
      accessToken,
      refreshToken,
      profile: {
        authUid: 'user-123',
        displayName: 'A Reasonably Long Display Name For A User',
        emailNormalized: 'a.reasonably.long.email.address@example.com',
        lockedRole: 'professional',
        acceptedTermsVersion: 'v2.1',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    });

    await storage.setItem(STORAGE_KEY, JSON.stringify(session));

    const securePayload = secureStore.raw.get(SECURE_STORAGE_KEY) ?? '';
    const securePayloadBytes = Buffer.byteLength(securePayload, 'utf8');
    assert.ok(
      securePayloadBytes < 2048,
      `secure payload is ${securePayloadBytes} bytes, expected < 2048 (expo-secure-store's platform limit)`,
    );

    // The alternative design (storing the *whole* session blob in
    // SecureStore, profile included) would push the encrypted value bigger
    // still. Demonstrate that folding the profile back in materially grows
    // the payload, which is why only the tokens are stored securely.
    const wholeBlobBytes = Buffer.byteLength(JSON.stringify(session), 'utf8');
    assert.ok(
      wholeBlobBytes > securePayloadBytes,
      'splitting the profile out of SecureStore meaningfully reduces the encrypted payload size',
    );
  });
});

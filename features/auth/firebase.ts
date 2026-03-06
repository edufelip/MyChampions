import Constants from 'expo-constants';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

type FirebaseExtraConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  iosClientId?: string;
  androidClientId?: string;
  webClientId?: string;
};

function resolveFirebaseConfig(): FirebaseExtraConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as { firebase?: FirebaseExtraConfig };
  return extra.firebase ?? {};
}

function requireFirebaseConfig() {
  const config = resolveFirebaseConfig();

  const requiredKeys: (keyof FirebaseExtraConfig)[] = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ];

  const missing = requiredKeys.filter((key) => !config[key] || String(config[key]).trim().length === 0);
  if (missing.length > 0) {
    throw new Error(`Firebase config is missing required keys: ${missing.join(', ')}`);
  }

  return config as Required<Pick<
    FirebaseExtraConfig,
    'apiKey' | 'authDomain' | 'projectId' | 'storageBucket' | 'messagingSenderId' | 'appId'
  >> &
    FirebaseExtraConfig;
}

let firebaseAuthInstance: Auth | null = null;
let firebaseStorageInstance: FirebaseStorage | null = null;

export function getFirebaseAuth() {
  if (firebaseAuthInstance) {
    return firebaseAuthInstance;
  }

  const firebaseConfig = requireFirebaseConfig();
  const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

  firebaseAuthInstance = getAuth(firebaseApp);

  return firebaseAuthInstance;
}

/**
 * Returns the Firebase Cloud Storage singleton.
 * Shares the same Firebase App instance as getFirebaseAuth().
 * Uses storageBucket from the Firebase config (D-050, D-053).
 */
export function getFirebaseStorage(): FirebaseStorage {
  if (firebaseStorageInstance) {
    return firebaseStorageInstance;
  }

  const firebaseConfig = requireFirebaseConfig();
  const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  firebaseStorageInstance = getStorage(firebaseApp);

  return firebaseStorageInstance;
}

export const firebaseOAuthConfig = {
  iosClientId: resolveFirebaseConfig().iosClientId ?? '',
  androidClientId: resolveFirebaseConfig().androidClientId ?? '',
  webClientId: resolveFirebaseConfig().webClientId ?? '',
} as const;

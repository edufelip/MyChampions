import {
  type AuthCredential,
  linkWithCredential,
  signInWithCredential,
} from 'firebase/auth';

import { getFirebaseAuth } from './firebase';

export async function signInOrLinkWithCredential(credential: AuthCredential): Promise<void> {
  const auth = getFirebaseAuth();

  try {
    await signInWithCredential(auth, credential);
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code.includes('account-exists-with-different-credential') && auth.currentUser) {
      await linkWithCredential(auth.currentUser, credential);
      return;
    }

    throw error;
  }
}

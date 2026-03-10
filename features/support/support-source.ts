/**
 * Firestore source for support messages.
 */

import {
  addDoc,
  collection,
  type Firestore,
} from 'firebase/firestore';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getFirestoreInstance, nowIso } from '@/features/firestore';
import {
  SupportSourceError,
  type SupportMessageInput,
  type SupportMessageStatus,
} from './support.logic';

export interface SupportSourceDeps {
  getFirestore: () => Firestore;
  getCurrentUser: () => { uid: string; email: string | null; displayName: string | null } | null;
  getAppVersion: () => string;
  getPlatform: () => 'ios' | 'android' | 'web';
  now: () => string;
}

export function makeDeps(): SupportSourceDeps {
  return {
    getFirestore: getFirestoreInstance,
    getCurrentUser: () => {
      const { getFirebaseAuth } = require('@/features/auth/firebase');
      const user = getFirebaseAuth().currentUser;
      if (!user) return null;
      return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      };
    },
    getAppVersion: () => (Constants.expoConfig?.version as string) ?? '—',
    getPlatform: () => (Platform.OS as 'ios' | 'android' | 'web') ?? 'web',
    now: nowIso,
  };
}

export async function submitSupportMessage(
  input: SupportMessageInput,
  deps = makeDeps()
): Promise<string> {
  const user = deps.getCurrentUser();
  if (!user) throw new SupportSourceError('unknown');

  const db = deps.getFirestore();
  const status: SupportMessageStatus = 'pending';
  const now = deps.now();

  try {
    const docRef = await addDoc(collection(db, 'supportMessages'), {
      userId: user.uid,
      userEmail: user.email,
      userName: user.displayName,
      subject: input.subject.trim(),
      body: input.body.trim(),
      status,
      createdAt: now,
      updatedAt: now,
      appVersion: deps.getAppVersion(),
      platform: deps.getPlatform(),
    });

    return docRef.id;
  } catch (error) {
    console.error('Error submitting support message:', error);
    throw new SupportSourceError('network');
  }
}

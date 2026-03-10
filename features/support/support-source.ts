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
  getCurrentUserRole: () => string | null;
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
    getCurrentUserRole: () => {
      // We could use useAuthSession but source layers should be pure or use direct SDKs/Storage
      // In this project, AuthSession handles hydration and exposes lockedRole.
      // For the source layer, we'll try to get it from our profile hydration context or similar if available,
      // but since we want to avoid complex circular deps, we can pass it from the hook or just use a simple lookup.
      return null; // Will be passed from the hook/caller if we want it robust
    },
    getAppVersion: () => (Constants.expoConfig?.version as string) ?? '—',
    getPlatform: () => (Platform.OS as 'ios' | 'android' | 'web') ?? 'web',
    now: nowIso,
  };
}

export async function submitSupportMessage(
  input: SupportMessageInput & { userRole?: string | null },
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
      userRole: input.userRole ?? deps.getCurrentUserRole() ?? 'unknown',
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

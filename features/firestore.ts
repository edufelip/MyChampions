import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getFirestore,
  type Firestore,
  Timestamp,
} from 'firebase/firestore';

let firestoreInstance: Firestore | null = null;

export function getFirestoreInstance(): Firestore {
  if (firestoreInstance) return firestoreInstance;

  // Reuse the same initialized Firebase app used by auth when available.
  const app = getApps().length > 0 ? getApp() : initializeApp({});
  firestoreInstance = getFirestore(app);
  return firestoreInstance;
}

export function getCurrentAuthUid(): string {
  // Lazy require keeps this module importable in Node test contexts.
  const { getFirebaseAuth } = require('./auth/firebase') as {
    getFirebaseAuth: () => { currentUser: { uid?: string | null } | null };
  };
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    throw new Error('No authenticated user found.');
  }
  return uid;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function timestampToIso(value: Timestamp | Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return value.toDate().toISOString();
}

export function generateId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${rand}`;
}

import type { FirebaseError } from 'firebase/app';

export type FirestoreErrorKind =
  | 'configuration'
  | 'network'
  | 'permission'
  | 'not_found'
  | 'invalid_response'
  | 'unknown';

function hasCode(error: unknown): error is FirebaseError {
  return Boolean(error) && typeof error === 'object' && 'code' in (error as Record<string, unknown>);
}

export function classifyFirestoreError(error: unknown): FirestoreErrorKind {
  if (hasCode(error)) {
    const code = String(error.code);
    if (code.includes('network') || code.includes('unavailable') || code.includes('deadline-exceeded')) {
      return 'network';
    }
    if (code.includes('permission-denied') || code.includes('unauthenticated')) {
      return 'permission';
    }
    if (code.includes('not-found')) {
      return 'not_found';
    }
    if (code.includes('invalid-argument') || code.includes('failed-precondition')) {
      return 'configuration';
    }
  }

  const message =
    error && typeof error === 'object' && 'message' in (error as Record<string, unknown>)
      ? String((error as { message?: unknown }).message ?? '').toLowerCase()
      : '';

  if (message.includes('network') || message.includes('timeout')) return 'network';
  if (message.includes('permission') || message.includes('unauth')) return 'permission';
  if (message.includes('not found')) return 'not_found';
  if (message.includes('config') || message.includes('missing')) return 'configuration';

  return 'unknown';
}

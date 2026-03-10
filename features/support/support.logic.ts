/**
 * Support feature logic.
 */

export type SupportMessageStatus = 'pending' | 'reviewed' | 'resolved';

export interface SupportMessageInput {
  subject: string;
  body: string;
}

export interface SupportMessage extends SupportMessageInput {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  status: SupportMessageStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  appVersion: string;
  platform: 'ios' | 'android' | 'web';
}

export type SupportErrorReason =
  | 'subject_required'
  | 'body_required'
  | 'subject_too_long'
  | 'body_too_long'
  | 'network'
  | 'unknown';

export class SupportSourceError extends Error {
  constructor(public reason: SupportErrorReason) {
    super(`Support error: ${reason}`);
    this.name = 'SupportSourceError';
  }
}

export function validateSupportInput(input: SupportMessageInput): SupportErrorReason | null {
  if (!input.subject.trim()) return 'subject_required';
  if (input.subject.trim().length > 50) return 'subject_too_long';
  if (!input.body.trim()) return 'body_required';
  if (input.body.trim().length > 500) return 'body_too_long';
  return null;
}

export function normalizeSupportError(error: any): SupportErrorReason {
  if (error instanceof SupportSourceError) return error.reason;
  const msg = error?.message?.toLowerCase() ?? '';
  if (msg.includes('network') || msg.includes('offline')) return 'network';
  return 'unknown';
}

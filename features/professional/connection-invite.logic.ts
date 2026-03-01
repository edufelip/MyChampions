/**
 * Connection invite code logic — professional-side operations.
 * Pure functions, no Firebase dependencies.
 * Refs: D-037, D-064, FR-179, FR-180, BR-241, BR-242
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type InviteCodeStatus = 'active' | 'rotated' | 'revoked';

export type InviteCode = {
  id: string;
  codeValue: string;
  status: InviteCodeStatus;
  rotatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type InviteCodeActionErrorReason =
  | 'not_found'
  | 'already_rotated'
  | 'network'
  | 'configuration'
  | 'unknown';

export type DisplayInviteCode =
  | { kind: 'active'; code: InviteCode }
  | { kind: 'none' };

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max pending connection requests per professional (D-038, BR-242) */
export const MAX_PENDING_REQUESTS = 10;

// ─── Pure functions ───────────────────────────────────────────────────────────

export function normalizeInviteCodeStatus(raw: unknown): InviteCodeStatus | null {
  if (raw === 'active' || raw === 'rotated' || raw === 'revoked') return raw;
  return null;
}

export function resolveDisplayInviteCode(code: InviteCode | null): DisplayInviteCode {
  if (!code || code.status !== 'active') return { kind: 'none' };
  return { kind: 'active', code };
}

export function isPendingCapReached(pendingCount: number): boolean {
  return pendingCount >= MAX_PENDING_REQUESTS;
}

export function normalizeInviteCodeActionError(error: unknown): InviteCodeActionErrorReason {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : null;
    const msg = 'message' in error ? String((error as { message: unknown }).message).toLowerCase() : null;

    if (code === 'NOT_FOUND' || msg?.includes('not found')) return 'not_found';
    if (code === 'ALREADY_ROTATED' || msg?.includes('already rotated')) return 'already_rotated';
    if (code === 'NETWORK_ERROR' || msg?.includes('network')) return 'network';
    if (msg?.includes('endpoint') || msg?.includes('config')) return 'configuration';
  }
  return 'unknown';
}

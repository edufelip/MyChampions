/**
 * QR invite payload parsing — pure, framework-free, fully unit-testable.
 *
 * Invite codes are uppercase alphanumeric strings (A-Z, 0-9).
 * A QR payload may be:
 *   1. A bare code string:          "ABC12345"
 *   2. A custom-scheme deep link:   "mychampions://invite?code=ABC12345"
 *   3. An HTTPS deep link (path):   "https://mychampions.app/invite/ABC12345"
 *   4. An HTTPS deep link (query):  "https://mychampions.app/invite?code=ABC12345"
 *
 * FR-204 / BR-263: parsed code must be fed into the same submitCode pipeline as manual entry.
 */

/** Regex that matches a valid invite code: 1–20 uppercase letters and digits. */
const INVITE_CODE_RE = /^[A-Z0-9]{1,20}$/;

export type QrParseResult =
  | { kind: 'ok'; code: string }
  | { kind: 'error'; reason: 'empty' | 'invalid_payload' };

/**
 * Extracts and validates an invite code from a raw QR scan string.
 *
 * Returns `{ kind: 'ok', code }` when a valid invite code is found,
 * or `{ kind: 'error', reason }` otherwise.
 */
export function parseQrInvitePayload(raw: string | null | undefined): QrParseResult {
  if (raw == null || raw.trim() === '') {
    return { kind: 'error', reason: 'empty' };
  }

  const trimmed = raw.trim();

  // Try URL-based payloads first.
  if (trimmed.includes('://') || trimmed.startsWith('http')) {
    const extracted = extractCodeFromUrl(trimmed);
    if (extracted !== null) {
      return { kind: 'ok', code: extracted };
    }
    return { kind: 'error', reason: 'invalid_payload' };
  }

  // Bare code — normalise to uppercase and validate.
  const upper = trimmed.toUpperCase();
  if (INVITE_CODE_RE.test(upper)) {
    return { kind: 'ok', code: upper };
  }

  return { kind: 'error', reason: 'invalid_payload' };
}

/**
 * Attempts to extract an invite code from a URL string.
 * Handles both query-param and path-segment forms.
 * Returns the code string, or null if not found / invalid.
 */
function extractCodeFromUrl(raw: string): string | null {
  let url: URL;
  try {
    // expo-router custom schemes (e.g. mychampions://) are not standard URLs;
    // replace the scheme to allow the URL constructor to parse them.
    const normalised = raw.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, 'https://');
    url = new URL(normalised);
  } catch {
    return null;
  }

  // Check query param ?code=...
  const queryCode = url.searchParams.get('code');
  if (queryCode) {
    const upper = queryCode.trim().toUpperCase();
    if (INVITE_CODE_RE.test(upper)) return upper;
  }

  // Check path segment immediately after an "invite" segment: /invite/<CODE>
  // This prevents treating generic path segments as invite codes.
  const segments = url.pathname.split('/').filter(Boolean);
  const inviteIdx = segments.findIndex((s) => s.toLowerCase() === 'invite');
  if (inviteIdx !== -1 && inviteIdx + 1 < segments.length) {
    const upper = segments[inviteIdx + 1].toUpperCase();
    if (INVITE_CODE_RE.test(upper)) return upper;
  }

  return null;
}

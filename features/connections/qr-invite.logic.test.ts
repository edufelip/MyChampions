import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseQrInvitePayload } from './qr-invite.logic';

// TC-250: QR Invite Scan Success — same result as manual code entry (pending_confirmation)
// TC-251: QR Invite Scan Invalid Payload — actionable error shown, user can retry or switch

describe('parseQrInvitePayload', () => {
  // ── Null / empty inputs ────────────────────────────────────────────────────

  it('returns empty error for null', () => {
    const result = parseQrInvitePayload(null);
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'empty');
  });

  it('returns empty error for undefined', () => {
    const result = parseQrInvitePayload(undefined);
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'empty');
  });

  it('returns empty error for empty string', () => {
    const result = parseQrInvitePayload('');
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'empty');
  });

  it('returns empty error for whitespace-only string', () => {
    const result = parseQrInvitePayload('   ');
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'empty');
  });

  // ── Bare code inputs ───────────────────────────────────────────────────────

  it('parses an uppercase bare invite code', () => {
    const result = parseQrInvitePayload('ABC12345');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'ABC12345');
  });

  it('normalises lowercase bare code to uppercase', () => {
    const result = parseQrInvitePayload('abc12345');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'ABC12345');
  });

  it('normalises mixed-case bare code to uppercase', () => {
    const result = parseQrInvitePayload('AbCd1234');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'ABCD1234');
  });

  it('trims whitespace around a bare code', () => {
    const result = parseQrInvitePayload('  XYZW9090  ');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'XYZW9090');
  });

  it('rejects a bare code with spaces inside', () => {
    const result = parseQrInvitePayload('ABC 1234');
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'invalid_payload');
  });

  it('rejects a bare code with special characters', () => {
    const result = parseQrInvitePayload('ABC-1234!');
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'invalid_payload');
  });

  // ── Custom-scheme deep link (query param) ──────────────────────────────────

  it('extracts code from mychampions://invite?code=ABC12345', () => {
    const result = parseQrInvitePayload('mychampions://invite?code=ABC12345');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'ABC12345');
  });

  it('normalises lowercase code in custom-scheme URL query param', () => {
    const result = parseQrInvitePayload('mychampions://invite?code=abc12345');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'ABC12345');
  });

  // ── HTTPS deep link (query param) ─────────────────────────────────────────

  it('extracts code from https URL query param', () => {
    const result = parseQrInvitePayload('https://mychampions.app/invite?code=XY12AB34');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'XY12AB34');
  });

  // ── HTTPS deep link (path segment) ────────────────────────────────────────

  it('extracts code from https URL path segment', () => {
    const result = parseQrInvitePayload('https://mychampions.app/invite/ZZZZ1111');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'ZZZZ1111');
  });

  it('normalises lowercase code from path segment', () => {
    const result = parseQrInvitePayload('https://mychampions.app/invite/zzzz1111');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'ZZZZ1111');
  });

  // ── Invalid URL payloads ───────────────────────────────────────────────────

  it('returns invalid_payload for URL with no recognisable code', () => {
    const result = parseQrInvitePayload('https://mychampions.app/invite');
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'invalid_payload');
  });

  it('returns invalid_payload for a completely unrelated URL', () => {
    const result = parseQrInvitePayload('https://example.com/foo/bar');
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'invalid_payload');
  });

  it('returns invalid_payload for malformed URL-like string', () => {
    const result = parseQrInvitePayload('not://a valid url!!!');
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'invalid_payload');
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('accepts a single-character code', () => {
    const result = parseQrInvitePayload('A');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'A');
  });

  it('accepts a 20-character code (max length)', () => {
    const result = parseQrInvitePayload('ABCDEFGHIJ1234567890');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.code, 'ABCDEFGHIJ1234567890');
  });

  it('rejects a 21-character code (exceeds max length)', () => {
    const result = parseQrInvitePayload('ABCDEFGHIJ12345678901');
    assert.equal(result.kind, 'error');
    if (result.kind === 'error') assert.equal(result.reason, 'invalid_payload');
  });
});

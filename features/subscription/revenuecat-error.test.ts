import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  mapRevenueCatCode,
  normalizeRevenueCatError,
  REVENUECAT_ERROR_CODE_REASON,
} from './revenuecat-error';
import { SubscriptionSourceError, normalizeSubscriptionError } from './subscription-source';

test('maps every installed public RevenueCat enum value explicitly or to unknown', () => {
  const declaration = readFileSync(
    `${process.cwd()}/node_modules/@revenuecat/purchases-typescript-internal/dist/errors.d.ts`,
    'utf8',
  );
  const enumEntries = [...declaration.matchAll(/^\s+([A-Z0-9_]+) = "(\d+)"/gm)].map((match) => ({
    name: match[1],
    code: match[2],
  }));

  assert.ok(enumEntries.length > 0);
  for (const { code, name } of enumEntries) {
    const expected = REVENUECAT_ERROR_CODE_REASON[code] ?? 'unknown';
    assert.equal(mapRevenueCatCode(code), expected, `string SDK code ${code}`);
    assert.equal(mapRevenueCatCode(Number(code)), expected, `numeric SDK code ${code}`);
    assert.equal(
      normalizeRevenueCatError({ readableErrorCode: name.toLowerCase() }),
      expected,
      `readable SDK code ${name}`,
    );
  }
});

test('maps payment pending and the other planned provider code groups', () => {
  assert.equal(mapRevenueCatCode('20'), 'payment_pending');
  assert.equal(mapRevenueCatCode(20), 'payment_pending');
  assert.equal(mapRevenueCatCode('1'), 'purchase_cancelled');
  assert.equal(mapRevenueCatCode('10'), 'network');
  assert.equal(mapRevenueCatCode('32'), 'network');
  assert.equal(mapRevenueCatCode('35'), 'network');
  assert.equal(mapRevenueCatCode('19'), 'unauthenticated');
  assert.equal(mapRevenueCatCode('999'), 'unknown');
});

test('accepts only enumerated readable aliases and ignores messages', () => {
  assert.equal(
    normalizeRevenueCatError({ readableErrorCode: 'payment_pending' }),
    'payment_pending',
  );
  assert.equal(
    normalizeRevenueCatError({ userInfo: { readableErrorCode: 'payment_pending_error' } }),
    'payment_pending',
  );
  assert.equal(
    normalizeRevenueCatError({ readableErrorCode: 'purchase_canceled' }),
    'purchase_cancelled',
  );
  assert.equal(normalizeRevenueCatError({ message: 'payment pending' }), 'unknown');
  assert.equal(
    normalizeRevenueCatError({ readableErrorCode: 'future_code', message: 'network' }),
    'unknown',
  );
});

test('a present unknown provider code cannot be rescued by prose or userCancelled', () => {
  assert.equal(
    normalizeRevenueCatError({ code: '999', message: 'cancelled', userCancelled: true }),
    'unknown',
  );
  assert.equal(normalizeRevenueCatError({ code: 20.5, userCancelled: true }), 'unknown');
  assert.equal(normalizeRevenueCatError({ code: Infinity, userCancelled: true }), 'unknown');
  assert.equal(normalizeRevenueCatError({ code: 'constructor', userCancelled: true }), 'unknown');
  assert.equal(normalizeRevenueCatError({ code: '__proto__', userCancelled: true }), 'unknown');
  assert.equal(
    normalizeRevenueCatError({ readableErrorCode: 'toString', userCancelled: true }),
    'unknown',
  );
});

test('survives a revoked proxy supplied as an SDK error', () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(normalizeRevenueCatError(revoked.proxy), 'unknown');
  assert.equal(normalizeSubscriptionError(revoked.proxy), 'unknown');
});

test('payment pending code wins over user cancellation', () => {
  assert.equal(normalizeRevenueCatError({ code: '20', userCancelled: true }), 'payment_pending');
  assert.equal(normalizeRevenueCatError({ code: 20, userCancelled: true }), 'payment_pending');
});

test('uses readable fields in order and rejects conflicting recognized values', () => {
  assert.equal(
    normalizeRevenueCatError({
      userInfo: { readableErrorCode: 'payment_pending_error' },
      readableErrorCode: 'payment_pending',
    }),
    'payment_pending',
  );
  assert.equal(
    normalizeRevenueCatError({
      userInfo: { readableErrorCode: 'payment_pending_error' },
      readableErrorCode: 'purchase_cancelled',
    }),
    'unknown',
  );
});

test('preserves a validated local SubscriptionSourceError before raw mapping', () => {
  assert.equal(
    normalizeSubscriptionError(new SubscriptionSourceError('payment_pending', 'pending')),
    'payment_pending',
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSubscriptionErrorMessageKey,
  SUBSCRIPTION_ERROR_MESSAGE_KEYS,
} from './subscription-error-copy';

test('maps every subscription reason and isolates pending copy', () => {
  assert.equal(Object.keys(SUBSCRIPTION_ERROR_MESSAGE_KEYS).length, 7);
  assert.equal(
    getSubscriptionErrorMessageKey('payment_pending'),
    'subscription.error.payment_pending',
  );
  for (const reason of [
    'configuration',
    'network',
    'purchase_cancelled',
    'store_problem',
    'unauthenticated',
    'unknown',
  ] as const) {
    assert.equal(getSubscriptionErrorMessageKey(reason), 'pro.subscription.error');
  }
});

import type { TranslationKey } from '@/localization';
import type { SubscriptionErrorReason } from './revenuecat-error';

/** Every subscription reason must have a deliberate localized consumer key. */
export const SUBSCRIPTION_ERROR_MESSAGE_KEYS: Record<SubscriptionErrorReason, TranslationKey> = {
  configuration: 'pro.subscription.error',
  network: 'pro.subscription.error',
  purchase_cancelled: 'pro.subscription.error',
  payment_pending: 'subscription.error.payment_pending',
  store_problem: 'pro.subscription.error',
  unauthenticated: 'pro.subscription.error',
  unknown: 'pro.subscription.error',
};

export function getSubscriptionErrorMessageKey(reason: SubscriptionErrorReason): TranslationKey {
  return SUBSCRIPTION_ERROR_MESSAGE_KEYS[reason];
}

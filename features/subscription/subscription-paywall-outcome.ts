import {
  SubscriptionSourceError,
  type RawPaywallResult,
  type SubscriptionErrorReason,
} from './subscription-source';

export function resolvePaywallPresentationError(
  result: RawPaywallResult | void
): SubscriptionErrorReason | null {
  if (result === 'NOT_PRESENTED') return 'configuration';
  if (result === 'ERROR') return 'store_problem';
  return null;
}

type RunPaywallPresentationInput = {
  present: () => Promise<RawPaywallResult | void>;
  refresh: () => Promise<void>;
  reportError: (reason: SubscriptionErrorReason) => void;
  isCurrent: () => boolean;
};

/**
 * Presents a RevenueCat paywall and refreshes entitlement state after it closes.
 *
 * The refresh intentionally runs before a presentation error is reported because
 * RevenueCat may have completed a purchase before closing the paywall. Reapplying
 * the presentation error afterwards prevents the refresh from hiding an explicit
 * NOT_PRESENTED, provider, or configuration failure. Cancellation stays nonfatal.
 */
export async function runPaywallPresentation({
  present,
  refresh,
  reportError,
  isCurrent,
}: RunPaywallPresentationInput): Promise<void> {
  let presentationError: SubscriptionErrorReason | null = null;

  try {
    presentationError = resolvePaywallPresentationError(await present());
  } catch (error: unknown) {
    const reason =
      error instanceof SubscriptionSourceError ? error.code : 'unknown';
    if (reason !== 'purchase_cancelled') {
      presentationError = reason;
    }
  }

  if (!isCurrent()) return;
  await refresh();

  if (presentationError && isCurrent()) {
    reportError(presentationError);
  }
}

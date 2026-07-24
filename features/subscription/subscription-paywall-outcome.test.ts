import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SubscriptionSourceError } from './subscription-source';
import {
  resolvePaywallPresentationError,
  runPaywallPresentation,
} from './subscription-paywall-outcome';

describe('resolvePaywallPresentationError', () => {
  it('maps NOT_PRESENTED to a recoverable configuration failure', () => {
    assert.equal(
      resolvePaywallPresentationError('NOT_PRESENTED'),
      'configuration'
    );
  });

  it('maps ERROR to a recoverable storefront failure', () => {
    assert.equal(resolvePaywallPresentationError('ERROR'), 'store_problem');
  });

  it('keeps cancellation and successful outcomes nonfatal', () => {
    assert.equal(resolvePaywallPresentationError('CANCELLED'), null);
    assert.equal(resolvePaywallPresentationError('PURCHASED'), null);
    assert.equal(resolvePaywallPresentationError('RESTORED'), null);
    assert.equal(resolvePaywallPresentationError(undefined), null);
  });
});

describe('runPaywallPresentation', () => {
  it('reports NOT_PRESENTED after refresh so refresh cannot erase the failure', async () => {
    const events: string[] = [];
    let visibleError: string | null = 'previous_error';

    await runPaywallPresentation({
      present: async () => {
        events.push('present');
        return 'NOT_PRESENTED';
      },
      refresh: async () => {
        events.push('refresh');
        visibleError = null;
      },
      reportError: (reason) => {
        events.push(`error:${reason}`);
        visibleError = reason;
      },
      isCurrent: () => true,
    });

    assert.deepEqual(events, [
      'present',
      'refresh',
      'error:configuration',
    ]);
    assert.equal(visibleError, 'configuration');
  });

  it('reports ERROR after refresh as a storefront failure', async () => {
    let visibleError: string | null = null;

    await runPaywallPresentation({
      present: async () => 'ERROR',
      refresh: async () => {
        visibleError = null;
      },
      reportError: (reason) => {
        visibleError = reason;
      },
      isCurrent: () => true,
    });

    assert.equal(visibleError, 'store_problem');
  });

  it('refreshes after cancellation without reporting a system error', async () => {
    let refreshCount = 0;
    const reportedErrors: string[] = [];

    await runPaywallPresentation({
      present: async () => 'CANCELLED',
      refresh: async () => {
        refreshCount += 1;
      },
      reportError: (reason) => {
        reportedErrors.push(reason);
      },
      isCurrent: () => true,
    });

    assert.equal(refreshCount, 1);
    assert.deepEqual(reportedErrors, []);
  });

  it('keeps a thrown purchase cancellation nonfatal', async () => {
    let refreshCount = 0;
    const reportedErrors: string[] = [];

    await runPaywallPresentation({
      present: async () => {
        throw new SubscriptionSourceError(
          'purchase_cancelled',
          'User cancelled the purchase.'
        );
      },
      refresh: async () => {
        refreshCount += 1;
      },
      reportError: (reason) => {
        reportedErrors.push(reason);
      },
      isCurrent: () => true,
    });

    assert.equal(refreshCount, 1);
    assert.deepEqual(reportedErrors, []);
  });

  it('does not refresh or report a result for a stale account', async () => {
    let refreshCount = 0;
    const reportedErrors: string[] = [];

    await runPaywallPresentation({
      present: async () => 'NOT_PRESENTED',
      refresh: async () => {
        refreshCount += 1;
      },
      reportError: (reason) => {
        reportedErrors.push(reason);
      },
      isCurrent: () => false,
    });

    assert.equal(refreshCount, 0);
    assert.deepEqual(reportedErrors, []);
  });
});

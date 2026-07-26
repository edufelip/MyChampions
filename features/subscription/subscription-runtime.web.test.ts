import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createWebSubscriptionRuntime } from './subscription-runtime.web';

describe('web subscription runtime', () => {
  it('fails closed when the mobile handoff is not configured', async () => {
    const runtime = createWebSubscriptionRuntime(null, {
      openWindow: () => assert.fail('missing configuration must not navigate'),
    });

    assert.equal(runtime.purchaseCapability, 'unavailable');
    await assert.rejects(runtime.openSubscriptionHandoff(), /subscription_handoff_not_configured/);
  });

  it('opens a configured handoff exactly once without inferring popup state', async () => {
    const opened: string[] = [];
    const runtime = createWebSubscriptionRuntime('https://mobile.example.test/subscribe', {
      openWindow: (url) => {
        opened.push(url);
      },
    });

    assert.equal(runtime.purchaseCapability, 'mobile_handoff');
    await runtime.openSubscriptionHandoff();
    assert.deepEqual(opened, ['https://mobile.example.test/subscribe']);
  });

  it('fails closed for an unsafe configured handoff', async () => {
    const runtime = createWebSubscriptionRuntime('javascript:alert(1)', {
      openWindow: () => assert.fail('unsafe URLs must not navigate'),
    });

    assert.equal(runtime.purchaseCapability, 'unavailable');
    await assert.rejects(runtime.openSubscriptionHandoff(), /subscription_handoff_not_configured/);
  });
});

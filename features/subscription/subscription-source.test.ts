/**
 * TC-286: Subscription source unit tests.
 * All RevenueCat SDK calls are replaced with injectable fakes — no native modules needed.
 *
 * Coverage:
 *   - resolveRevenueCatApiKey: missing key, present key
 *   - mapCustomerInfoToEntitlementStatus: active, lapsed (no entitlement), lapsed (isActive false), unknown shape
 *   - mapCustomerInfoToAiEntitlementStatus: active student_pro, lapsed (no entitlement), lapsed (isActive false), unknown shape
 *   - normalizeSubscriptionError: all reason branches
 *   - fetchEntitlementStatus: happy path, getCustomerInfo throws (network, unknown), SDK throws SubscriptionSourceError
 *   - purchasePackage: happy path with customerInfo, no customerInfo, cancellation, store error
 *   - restorePurchases: happy path, network error, SubscriptionSourceError passthrough
 *   - configureRevenueCat: calls configure with key, throws on missing key
 *   - presentAiPaywall: calls presentPaywall with AI_OFFERING_ID ('default_student'), propagates errors, passes through SubscriptionSourceError
 *   - presentProPaywall: calls presentPaywall with PRO_OFFERING_ID ('default_professional'), propagates errors, passes through SubscriptionSourceError
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRevenueCatApiKey,
  mapCustomerInfoToEntitlementStatus,
  mapCustomerInfoToAiEntitlementStatus,
  normalizeSubscriptionError,
  fetchEntitlementStatus,
  purchasePackage,
  restorePurchases,
  configureRevenueCat,
  presentAiPaywall,
  presentProPaywall,
  SubscriptionSourceError,
  PRO_ENTITLEMENT_ID,
  AI_FEATURES_ENTITLEMENT_ID,
  PRO_OFFERING_ID,
  AI_OFFERING_ID,
  type SubscriptionSourceDeps,
  type RawCustomerInfo,
} from './subscription-source';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<SubscriptionSourceDeps> = {}): SubscriptionSourceDeps {
  return {
    presentPaywall: async () => {},
    configure: () => {},
    getCustomerInfo: async () => ({ entitlements: { active: {} } }),
    purchasePackage: async () => ({ customerInfo: { entitlements: { active: {} } } }),
    restorePurchases: async () => ({ entitlements: { active: {} } }),
    getApiKey: () => 'appl_test_key',
    ...overrides,
  };
}

function makeActiveCustomerInfo(): RawCustomerInfo {
  return {
    entitlements: {
      active: {
        [PRO_ENTITLEMENT_ID]: { isActive: true },
      },
    },
  };
}

function makeLapsedCustomerInfo(): RawCustomerInfo {
  return {
    entitlements: {
      active: {},
    },
  };
}

// ─── resolveRevenueCatApiKey ──────────────────────────────────────────────────

describe('resolveRevenueCatApiKey', () => {
  it('throws configuration error when key is absent', () => {
    assert.throws(
      () => resolveRevenueCatApiKey('ios', {}),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });

  it('throws configuration error when key is empty string', () => {
    assert.throws(
      () => resolveRevenueCatApiKey('ios', { revenueCatApiKeyIos: '' }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });

  it('returns iOS public API key when present', () => {
    const key = resolveRevenueCatApiKey('ios', { revenueCatApiKeyIos: 'appl_live_abc123' });
    assert.equal(key, 'appl_live_abc123');
  });

  it('returns Android public API key when present', () => {
    const key = resolveRevenueCatApiKey('android', { revenueCatApiKeyAndroid: 'goog_live_abc123' });
    assert.equal(key, 'goog_live_abc123');
  });

  it('throws configuration error when secret sk_* key is provided', () => {
    assert.throws(
      () => resolveRevenueCatApiKey('ios', { revenueCatApiKeyIos: 'sk_live_abc123' }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });

  it('throws configuration error when key prefix does not match platform', () => {
    assert.throws(
      () => resolveRevenueCatApiKey('android', { revenueCatApiKeyAndroid: 'appl_live_abc123' }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });

  it('ignores non-string values and throws', () => {
    assert.throws(
      () => resolveRevenueCatApiKey('ios', { revenueCatApiKeyIos: 42 }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });
});

// ─── mapCustomerInfoToEntitlementStatus ──────────────────────────────────────

describe('mapCustomerInfoToEntitlementStatus', () => {
  it('returns active when pro entitlement isActive=true', () => {
    const result = mapCustomerInfoToEntitlementStatus(makeActiveCustomerInfo());
    assert.equal(result, 'active');
  });

  it('returns lapsed when pro entitlement isActive=false', () => {
    const info: RawCustomerInfo = {
      entitlements: {
        active: {
          [PRO_ENTITLEMENT_ID]: { isActive: false },
        },
      },
    };
    const result = mapCustomerInfoToEntitlementStatus(info);
    assert.equal(result, 'lapsed');
  });

  it('returns lapsed when active entitlements is empty object', () => {
    const result = mapCustomerInfoToEntitlementStatus(makeLapsedCustomerInfo());
    assert.equal(result, 'lapsed');
  });

  it('returns lapsed when entitlements key is absent', () => {
    const result = mapCustomerInfoToEntitlementStatus({});
    assert.equal(result, 'lapsed');
  });

  it('returns lapsed when entitlements.active is undefined', () => {
    const result = mapCustomerInfoToEntitlementStatus({ entitlements: {} });
    assert.equal(result, 'lapsed');
  });

  it('returns unknown on unexpected shape throw', () => {
    // Simulate a getter that throws on access
    const info = Object.defineProperty({}, 'entitlements', {
      get() { throw new Error('boom'); },
    }) as RawCustomerInfo;
    const result = mapCustomerInfoToEntitlementStatus(info);
    assert.equal(result, 'unknown');
  });

  it('ignores other entitlement keys — only checks PRO_ENTITLEMENT_ID', () => {
    const info: RawCustomerInfo = {
      entitlements: {
        active: {
          some_other_entitlement: { isActive: true },
        },
      },
    };
    const result = mapCustomerInfoToEntitlementStatus(info);
    assert.equal(result, 'lapsed');
  });
});

// ─── normalizeSubscriptionError ──────────────────────────────────────────────

describe('normalizeSubscriptionError', () => {
  it('returns unknown for non-object', () => {
    assert.equal(normalizeSubscriptionError('string error'), 'unknown');
    assert.equal(normalizeSubscriptionError(null), 'unknown');
    assert.equal(normalizeSubscriptionError(42), 'unknown');
  });

  it('returns purchase_cancelled when userCancelled=true', () => {
    assert.equal(normalizeSubscriptionError({ userCancelled: true }), 'purchase_cancelled');
  });

  it('returns purchase_cancelled for code=purchase_cancelled', () => {
    assert.equal(normalizeSubscriptionError({ code: 'purchase_cancelled' }), 'purchase_cancelled');
  });

  it('returns purchase_cancelled for message containing cancelled', () => {
    assert.equal(normalizeSubscriptionError({ message: 'User cancelled the purchase' }), 'purchase_cancelled');
  });

  it('returns configuration for invalid_api_key code', () => {
    assert.equal(normalizeSubscriptionError({ code: 'invalid_api_key' }), 'configuration');
  });

  it('returns configuration for message containing api key', () => {
    assert.equal(normalizeSubscriptionError({ message: 'invalid api key provided' }), 'configuration');
  });

  it('returns network for network_error code', () => {
    assert.equal(normalizeSubscriptionError({ code: 'network_error' }), 'network');
  });

  it('returns network for message containing timeout', () => {
    assert.equal(normalizeSubscriptionError({ message: 'request timeout' }), 'network');
  });

  it('returns store_problem for store_problem code', () => {
    assert.equal(normalizeSubscriptionError({ code: 'store_problem' }), 'store_problem');
  });

  it('returns store_problem for message containing store', () => {
    assert.equal(normalizeSubscriptionError({ message: 'app store error occurred' }), 'store_problem');
  });

  it('returns unauthenticated for unauthorized code', () => {
    assert.equal(normalizeSubscriptionError({ code: 'unauthorized_request' }), 'unauthenticated');
  });

  it('returns unknown for unrecognized error shape', () => {
    assert.equal(normalizeSubscriptionError({ code: 'some_random_code' }), 'unknown');
  });
});

// ─── configureRevenueCat ─────────────────────────────────────────────────────

describe('configureRevenueCat', () => {
  it('calls configure with the API key from getApiKey', () => {
    const calls: string[] = [];
    const deps = makeDeps({
      configure: (key) => { calls.push(key); },
      getApiKey: () => 'appl_live_test',
    });
    configureRevenueCat(deps);
    assert.deepEqual(calls, ['appl_live_test']);
  });

  it('throws configuration error when getApiKey throws', () => {
    const deps = makeDeps({
      getApiKey: () => { throw new SubscriptionSourceError('configuration', 'No key'); },
    });
    assert.throws(
      () => configureRevenueCat(deps),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });
});

// ─── fetchEntitlementStatus ───────────────────────────────────────────────────

describe('fetchEntitlementStatus', () => {
  it('returns active when pro entitlement is active', async () => {
    const deps = makeDeps({ getCustomerInfo: async () => makeActiveCustomerInfo() });
    const result = await fetchEntitlementStatus(deps);
    assert.equal(result, 'active');
  });

  it('returns lapsed when no pro entitlement', async () => {
    const deps = makeDeps({ getCustomerInfo: async () => makeLapsedCustomerInfo() });
    const result = await fetchEntitlementStatus(deps);
    assert.equal(result, 'lapsed');
  });

  it('throws SubscriptionSourceError with network reason on SDK network failure', async () => {
    const deps = makeDeps({
      getCustomerInfo: async () => { throw new Error('network request failed'); },
    });
    await assert.rejects(
      fetchEntitlementStatus(deps),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'network');
        return true;
      }
    );
  });

  it('passes through SubscriptionSourceError thrown by SDK', async () => {
    const original = new SubscriptionSourceError('unauthenticated', 'auth failed');
    const deps = makeDeps({
      getCustomerInfo: async () => { throw original; },
    });
    await assert.rejects(
      fetchEntitlementStatus(deps),
      (err: unknown) => {
        assert.ok(err === original);
        return true;
      }
    );
  });

  it('throws unknown for unrecognized error shapes', async () => {
    const deps = makeDeps({
      getCustomerInfo: async () => { throw { weirdProp: true }; },
    });
    await assert.rejects(
      fetchEntitlementStatus(deps),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'unknown');
        return true;
      }
    );
  });
});

// ─── purchasePackage ──────────────────────────────────────────────────────────

describe('purchasePackage', () => {
  it('returns active when purchase succeeds and customerInfo has pro entitlement', async () => {
    const deps = makeDeps({
      purchasePackage: async () => ({ customerInfo: makeActiveCustomerInfo() }),
    });
    const result = await purchasePackage({}, deps);
    assert.equal(result, 'active');
  });

  it('returns unknown when purchase result has no customerInfo', async () => {
    const deps = makeDeps({
      purchasePackage: async () => ({}),
    });
    const result = await purchasePackage({}, deps);
    assert.equal(result, 'unknown');
  });

  it('throws purchase_cancelled when user cancels', async () => {
    const deps = makeDeps({
      purchasePackage: async () => { throw { userCancelled: true }; },
    });
    await assert.rejects(
      purchasePackage({}, deps),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'purchase_cancelled');
        return true;
      }
    );
  });

  it('throws store_problem on store error', async () => {
    const deps = makeDeps({
      purchasePackage: async () => { throw { code: 'store_problem', message: 'store error' }; },
    });
    await assert.rejects(
      purchasePackage({}, deps),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'store_problem');
        return true;
      }
    );
  });

  it('passes through SubscriptionSourceError directly', async () => {
    const original = new SubscriptionSourceError('network', 'purchase network fail');
    const deps = makeDeps({
      purchasePackage: async () => { throw original; },
    });
    await assert.rejects(
      purchasePackage({}, deps),
      (err: unknown) => {
        assert.ok(err === original);
        return true;
      }
    );
  });
});

// ─── restorePurchases ────────────────────────────────────────────────────────

describe('restorePurchases', () => {
  it('returns active when restored customerInfo has pro entitlement', async () => {
    const deps = makeDeps({ restorePurchases: async () => makeActiveCustomerInfo() });
    const result = await restorePurchases(deps);
    assert.equal(result, 'active');
  });

  it('returns lapsed when restored customerInfo has no pro entitlement', async () => {
    const deps = makeDeps({ restorePurchases: async () => makeLapsedCustomerInfo() });
    const result = await restorePurchases(deps);
    assert.equal(result, 'lapsed');
  });

  it('throws network error on restore network failure', async () => {
    const deps = makeDeps({
      restorePurchases: async () => { throw new Error('request timed out'); },
    });
    await assert.rejects(
      restorePurchases(deps),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'network');
        return true;
      }
    );
  });

  it('passes through SubscriptionSourceError directly', async () => {
    const original = new SubscriptionSourceError('store_problem', 'store failure');
    const deps = makeDeps({
      restorePurchases: async () => { throw original; },
    });
    await assert.rejects(
      restorePurchases(deps),
      (err: unknown) => {
        assert.ok(err === original);
        return true;
      }
    );
  });
});

// ─── mapCustomerInfoToAiEntitlementStatus ─────────────────────────────────────

describe('mapCustomerInfoToAiEntitlementStatus', () => {
  it('AI_FEATURES_ENTITLEMENT_ID is student_pro', () => {
    assert.equal(AI_FEATURES_ENTITLEMENT_ID, 'student_pro');
  });

  it('returns active when student_pro entitlement is active', () => {
    const info: RawCustomerInfo = {
      entitlements: {
        active: {
          [AI_FEATURES_ENTITLEMENT_ID]: { isActive: true },
        },
      },
    };
    assert.equal(mapCustomerInfoToAiEntitlementStatus(info), 'active');
  });

  it('returns lapsed when no student_pro entitlement in active map', () => {
    const info: RawCustomerInfo = {
      entitlements: { active: {} },
    };
    assert.equal(mapCustomerInfoToAiEntitlementStatus(info), 'lapsed');
  });

  it('returns lapsed when student_pro isActive is false', () => {
    const info: RawCustomerInfo = {
      entitlements: {
        active: {
          [AI_FEATURES_ENTITLEMENT_ID]: { isActive: false },
        },
      },
    };
    assert.equal(mapCustomerInfoToAiEntitlementStatus(info), 'lapsed');
  });

  it('returns unknown on malformed shape (null entitlements)', () => {
    // Force a corrupt shape via casting to bypass TS
    const info = { entitlements: null } as unknown as RawCustomerInfo;
    assert.equal(mapCustomerInfoToAiEntitlementStatus(info), 'unknown');
  });

  it('does not return active when only PRO_ENTITLEMENT_ID is active (separate entitlements)', () => {
    const info: RawCustomerInfo = {
      entitlements: {
        active: {
          [PRO_ENTITLEMENT_ID]: { isActive: true },
        },
      },
    };
    assert.equal(mapCustomerInfoToAiEntitlementStatus(info), 'lapsed');
  });
});

// ─── presentAiPaywall ─────────────────────────────────────────────────────────

describe('presentAiPaywall', () => {
  it('AI_OFFERING_ID constant is default_student', () => {
    assert.equal(AI_OFFERING_ID, 'default_student');
  });

  it('calls deps.presentPaywall with AI_OFFERING_ID (default_student) offering identifier', async () => {
    let calledWith: string | undefined;
    const deps = makeDeps({
      presentPaywall: async (id) => { calledWith = id; },
    });
    await presentAiPaywall(deps);
    assert.equal(calledWith, AI_OFFERING_ID);
  });

  it('propagates network-like errors as SubscriptionSourceError', async () => {
    const deps = makeDeps({
      presentPaywall: async () => { throw new Error('network failure'); },
    });
    await assert.rejects(
      presentAiPaywall(deps),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        return true;
      }
    );
  });

  it('passes through SubscriptionSourceError directly', async () => {
    const original = new SubscriptionSourceError('store_problem', 'store failure');
    const deps = makeDeps({
      presentPaywall: async () => { throw original; },
    });
    await assert.rejects(
      presentAiPaywall(deps),
      (err: unknown) => {
        assert.ok(err === original);
        return true;
      }
    );
  });
});

// ─── presentProPaywall ────────────────────────────────────────────────────────

describe('presentProPaywall', () => {
  it('PRO_OFFERING_ID constant is default_professional', () => {
    assert.equal(PRO_OFFERING_ID, 'default_professional');
  });

  it('calls deps.presentPaywall with PRO_OFFERING_ID (default_professional) offering identifier', async () => {
    let calledWith: string | undefined | 'NOT_CALLED' = 'NOT_CALLED';
    const deps = makeDeps({
      presentPaywall: async (id) => { calledWith = id; },
    });
    await presentProPaywall(deps);
    assert.equal(calledWith, PRO_OFFERING_ID);
  });

  it('propagates network-like errors as SubscriptionSourceError', async () => {
    const deps = makeDeps({
      presentPaywall: async () => { throw new Error('network failure'); },
    });
    await assert.rejects(
      presentProPaywall(deps),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        return true;
      }
    );
  });

  it('passes through SubscriptionSourceError directly', async () => {
    const original = new SubscriptionSourceError('store_problem', 'store failure');
    const deps = makeDeps({
      presentPaywall: async () => { throw original; },
    });
    await assert.rejects(
      presentProPaywall(deps),
      (err: unknown) => {
        assert.ok(err === original);
        return true;
      }
    );
  });
});

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
 *   - configureRevenueCat: binds the SDK to a self-managed auth UID and rejects blank IDs
 *   - RevenueCat identity coordinator: serializes account switches before the next SDK operation
 *   - presentAiPaywall: calls presentPaywall with AI_OFFERING_ID ('default_student'), propagates errors, passes through SubscriptionSourceError
 *   - presentProPaywall: calls presentPaywall with PRO_OFFERING_ID ('default_professional'), propagates errors, passes through SubscriptionSourceError
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRevenueCatApiKey,
  mapCustomerInfoToEntitlementStatus,
  mapCustomerInfoToAiEntitlementStatus,
  mapCustomerInfoToProfessionalEntitlementMetadata,
  normalizeSubscriptionError,
  fetchEntitlementStatus,
  purchasePackage,
  restorePurchases,
  configureRevenueCat,
  presentAiPaywall,
  presentProPaywall,
  resolveAiUpgradeOfferingId,
  resolveRequiredRevenueCatOffering,
  SubscriptionSourceError,
  resolveStudentOfferingId,
  PRO_ENTITLEMENT_ID,
  AI_FEATURES_ENTITLEMENT_ID,
  PRO_OFFERING_ID,
  AI_OFFERING_ID,
  AI_TEST_OFFERING_ID,
  type SubscriptionSourceDeps,
  type RawCustomerInfo,
} from './subscription-source';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<SubscriptionSourceDeps> = {}): SubscriptionSourceDeps {
  return {
    presentPaywall: async () => {},
    configure: () => {},
    logIn: async () => {},
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

  it('accepts the Test Store public key for either platform only in an explicit dev build', () => {
    const extra = {
      appVariant: 'dev',
      revenueCatTestStoreEnabled: true,
      revenueCatApiKeyIos: 'test_sandbox_abc123',
      revenueCatApiKeyAndroid: 'test_sandbox_abc123',
    };

    assert.equal(resolveRevenueCatApiKey('ios', extra), 'test_sandbox_abc123');
    assert.equal(resolveRevenueCatApiKey('android', extra), 'test_sandbox_abc123');
  });

  it('rejects Test Store keys without the explicit dev-only gate', () => {
    assert.throws(
      () => resolveRevenueCatApiKey('ios', { revenueCatApiKeyIos: 'test_sandbox_abc123' }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );

    assert.throws(
      () =>
        resolveRevenueCatApiKey('ios', {
          appVariant: 'prod',
          revenueCatTestStoreEnabled: true,
          revenueCatApiKeyIos: 'test_sandbox_abc123',
        }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });

  it('requires the Test Store prefix when its dev-only gate is enabled', () => {
    assert.throws(
      () =>
        resolveRevenueCatApiKey('ios', {
          appVariant: 'dev',
          revenueCatTestStoreEnabled: true,
          revenueCatApiKeyIos: 'appl_live_abc123',
        }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
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

describe('mapCustomerInfoToProfessionalEntitlementMetadata', () => {
  it('maps an active auto-renewing entitlement without warning risk', () => {
    assert.deepEqual(
      mapCustomerInfoToProfessionalEntitlementMetadata({
        entitlements: {
          active: {
            [PRO_ENTITLEMENT_ID]: {
              isActive: true,
              willRenew: true,
              expirationDate: '2026-08-03T16:45:00Z',
            },
          },
        },
      }),
      { expiresAt: '2026-08-03T16:45:00.000Z', renewalRisk: false }
    );
  });

  it('flags explicit cancellation and billing issues only while access is active and expiring', () => {
    for (const riskFields of [
      { willRenew: false },
      { billingIssueDetectedAt: '2026-07-20T12:00:00Z' },
      { unsubscribeDetectedAt: '2026-07-20T12:00:00Z' },
    ]) {
      assert.equal(
        mapCustomerInfoToProfessionalEntitlementMetadata({
          entitlements: {
            active: {
              [PRO_ENTITLEMENT_ID]: {
                isActive: true,
                expirationDate: '2026-08-03T16:45:00Z',
                ...riskFields,
              },
            },
          },
        }).renewalRisk,
        true
      );
    }
  });

  it('fails closed to no warning for absent, inactive, lifetime, or malformed metadata', () => {
    const inputs: RawCustomerInfo[] = [
      { entitlements: { active: {} } },
      {
        entitlements: {
          active: {
            [PRO_ENTITLEMENT_ID]: {
              isActive: false,
              willRenew: false,
              expirationDate: '2026-08-03T16:45:00Z',
            },
          },
        },
      },
      {
        entitlements: {
          active: {
            [PRO_ENTITLEMENT_ID]: {
              isActive: true,
              willRenew: false,
              expirationDate: null,
            },
          },
        },
      },
      {
        entitlements: {
          active: {
            [PRO_ENTITLEMENT_ID]: {
              isActive: true,
              willRenew: false,
              expirationDate: 'not-a-date',
            },
          },
        },
      },
    ];

    for (const input of inputs) {
      assert.deepEqual(mapCustomerInfoToProfessionalEntitlementMetadata(input), {
        expiresAt: null,
        renewalRisk: false,
      });
    }
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
  it('calls configure with the API key and self-managed auth UID', () => {
    const calls: { apiKey: string; appUserId: string | undefined }[] = [];
    const deps = makeDeps({
      configure: (apiKey, appUserId) => { calls.push({ apiKey, appUserId }); },
      getApiKey: () => 'appl_live_test',
    });
    configureRevenueCat(deps, 'server-user-42');
    assert.deepEqual(calls, [{ apiKey: 'appl_live_test', appUserId: 'server-user-42' }]);
  });

  it('rejects a blank auth UID before configuring RevenueCat', () => {
    const calls: string[] = [];
    const deps = makeDeps({
      configure: () => { calls.push('configured'); },
    });

    assert.throws(
      () => configureRevenueCat(deps, '  '),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
    assert.deepEqual(calls, []);
  });

  it('throws configuration error when getApiKey throws', () => {
    const deps = makeDeps({
      getApiKey: () => { throw new SubscriptionSourceError('configuration', 'No key'); },
    });
    assert.throws(
      () => configureRevenueCat(deps, 'server-user-42'),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'configuration');
        return true;
      }
    );
  });
});

// ─── RevenueCat identity coordination ─────────────────────────────────────────

type RevenueCatIdentityCoordinator = {
  run<T>(
    deps: SubscriptionSourceDeps,
    appUserId: string,
    operation: () => Promise<T>
  ): Promise<T>;
};

async function createRevenueCatIdentityCoordinator(): Promise<RevenueCatIdentityCoordinator> {
  const sourceModule = (await import('./subscription-source')) as unknown as {
    createRevenueCatIdentityCoordinator?: () => RevenueCatIdentityCoordinator;
  };

  assert.equal(
    typeof sourceModule.createRevenueCatIdentityCoordinator,
    'function',
    'subscription source must expose an identity coordinator for the singleton RevenueCat SDK'
  );
  return (sourceModule.createRevenueCatIdentityCoordinator as () => RevenueCatIdentityCoordinator)();
}

describe('RevenueCat identity coordinator', () => {
  it('serializes an account switch before the next SDK operation', async () => {
    const calls: string[] = [];
    const coordinator = await createRevenueCatIdentityCoordinator();
    let signalLoginStarted: (() => void) | null = null;
    const loginStarted = new Promise<void>((resolve) => {
      signalLoginStarted = resolve;
    });
    let releaseSecondLogin: () => void = () => {
      throw new Error('RevenueCat account-switch test did not initialize its login release.');
    };
    const waitForSecondLoginRelease = new Promise<void>((resolve) => {
      releaseSecondLogin = resolve;
    });
    const deps = makeDeps({
      configure: (apiKey, appUserId) => { calls.push(`configure:${apiKey}:${appUserId}`); },
      logIn: async (appUserId) => {
        calls.push(`login:${appUserId}`);
        signalLoginStarted?.();
        await waitForSecondLoginRelease;
      },
      getApiKey: () => 'appl_live_test',
    });

    const firstOperation = coordinator.run(deps, 'server-user-a', async () => {
      calls.push('operation:server-user-a');
    });
    const secondOperation = coordinator.run(deps, 'server-user-b', async () => {
      calls.push('operation:server-user-b');
    });

    await firstOperation;
    await loginStarted;
    assert.deepEqual(calls, [
      'configure:appl_live_test:server-user-a',
      'operation:server-user-a',
      'login:server-user-b',
    ]);
    releaseSecondLogin();
    await secondOperation;
    assert.deepEqual(calls, [
      'configure:appl_live_test:server-user-a',
      'operation:server-user-a',
      'login:server-user-b',
      'operation:server-user-b',
    ]);
  });

  it('keeps an account switch retryable when RevenueCat logIn fails', async () => {
    const calls: string[] = [];
    const coordinator = await createRevenueCatIdentityCoordinator();
    let secondUserLoginAttempts = 0;
    const deps = makeDeps({
      configure: (apiKey, appUserId) => { calls.push(`configure:${apiKey}:${appUserId}`); },
      logIn: async (appUserId) => {
        calls.push(`login:${appUserId}`);
        if (appUserId === 'server-user-b' && secondUserLoginAttempts++ === 0) {
          throw { code: 'network_error' };
        }
      },
      getApiKey: () => 'appl_live_test',
    });

    await coordinator.run(deps, 'server-user-a', async () => {
      calls.push('operation:server-user-a');
    });
    await assert.rejects(
      () => coordinator.run(deps, 'server-user-b', async () => {
        calls.push('operation:unexpected');
      }),
      (err: unknown) => {
        assert.ok(err instanceof SubscriptionSourceError);
        assert.equal(err.code, 'network');
        return true;
      }
    );
    await coordinator.run(deps, 'server-user-b', async () => {
      calls.push('operation:server-user-b');
    });

    assert.deepEqual(calls, [
      'configure:appl_live_test:server-user-a',
      'operation:server-user-a',
      'login:server-user-b',
      'login:server-user-b',
      'operation:server-user-b',
    ]);
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
      presentPaywall: async (id) => { calledWith = id; return 'CANCELLED'; },
    });
    const result = await presentAiPaywall(deps);
    assert.equal(calledWith, AI_OFFERING_ID);
    assert.equal(result, 'CANCELLED');
  });

  it('presents the guarded temporary student offering when explicitly supplied', async () => {
    let calledWith: string | undefined;
    const deps = makeDeps({
      presentPaywall: async (id) => { calledWith = id; return 'NOT_PRESENTED'; },
    });

    const result = await presentAiPaywall(deps, AI_TEST_OFFERING_ID);

    assert.equal(calledWith, 'test_student');
    assert.equal(result, 'NOT_PRESENTED');
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

// ─── student offering and role routing ───────────────────────────────────────

describe('resolveStudentOfferingId', () => {
  it('defaults to default_student when configuration is absent', () => {
    assert.equal(resolveStudentOfferingId({}), AI_OFFERING_ID);
  });

  it('accepts default_student in production', () => {
    assert.equal(
      resolveStudentOfferingId({
        appVariant: 'prod',
        revenueCatStudentOfferingId: 'default_student',
        revenueCatTestStoreEnabled: false,
      }),
      AI_OFFERING_ID
    );
  });

  it('accepts test_student only for an explicit dev Test Store config', () => {
    assert.equal(
      resolveStudentOfferingId({
        appVariant: 'dev',
        revenueCatStudentOfferingId: 'test_student',
        revenueCatTestStoreEnabled: true,
      }),
      AI_TEST_OFFERING_ID
    );
  });

  it('rejects test_student in production', () => {
    assert.throws(
      () =>
        resolveStudentOfferingId({
          appVariant: 'prod',
          revenueCatStudentOfferingId: 'test_student',
          revenueCatTestStoreEnabled: true,
        }),
      (err: unknown) =>
        err instanceof SubscriptionSourceError && err.code === 'configuration'
    );
  });

  it('rejects malformed offering configuration', () => {
    assert.throws(
      () => resolveStudentOfferingId({ revenueCatStudentOfferingId: 'student_preview' }),
      (err: unknown) =>
        err instanceof SubscriptionSourceError && err.code === 'configuration'
    );
  });
});

describe('resolveAiUpgradeOfferingId', () => {
  it('routes students to the resolved student offering', () => {
    assert.equal(
      resolveAiUpgradeOfferingId('student', () => AI_TEST_OFFERING_ID),
      AI_TEST_OFFERING_ID
    );
  });

  it('routes professionals without evaluating student-only configuration', () => {
    let studentResolutionCount = 0;
    assert.equal(
      resolveAiUpgradeOfferingId('professional', () => {
        studentResolutionCount += 1;
        throw new Error('malformed student configuration');
      }),
      PRO_OFFERING_ID
    );
    assert.equal(studentResolutionCount, 0);
  });

  it('fails closed for missing or malformed roles', () => {
    assert.equal(resolveAiUpgradeOfferingId(null, () => AI_OFFERING_ID), null);
    assert.equal(
      resolveAiUpgradeOfferingId('coach' as never, () => AI_OFFERING_ID),
      null
    );
  });
});

describe('resolveRequiredRevenueCatOffering', () => {
  it('returns the exact requested offering', () => {
    const studentOffering = { identifier: AI_OFFERING_ID };

    assert.equal(
      resolveRequiredRevenueCatOffering(
        {
          [AI_OFFERING_ID]: studentOffering,
          [PRO_OFFERING_ID]: { identifier: PRO_OFFERING_ID },
        },
        AI_OFFERING_ID
      ),
      studentOffering
    );
  });

  it('fails closed instead of falling back when the requested offering is missing', () => {
    assert.throws(
      () =>
        resolveRequiredRevenueCatOffering(
          {
            [PRO_OFFERING_ID]: { identifier: PRO_OFFERING_ID },
          },
          AI_OFFERING_ID
        ),
      (err: unknown) =>
        err instanceof SubscriptionSourceError &&
        err.code === 'configuration' &&
        err.message.includes(AI_OFFERING_ID)
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
      presentPaywall: async (id) => { calledWith = id; return 'ERROR'; },
    });
    const result = await presentProPaywall(deps);
    assert.equal(calledWith, PRO_OFFERING_ID);
    assert.equal(result, 'ERROR');
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

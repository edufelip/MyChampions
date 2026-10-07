import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireT15DetoxSharedRoute,
  T15_DETOX_SHARED_ROUTE_KEYS,
  type T15DetoxSharedRouteKey,
} from '../../scripts/testing/t15-detox-cold-lifecycle';
import {
  createT15DetoxOwnerPublicComposition,
  requireT15DetoxActualRouteBinding,
  T15_DETOX_ACTUAL_ROUTE_BINDINGS,
  T15_DETOX_OWNER_PUBLIC_REQUIRED_INPUTS,
  t15DetoxOwnerPublicCompositionContract,
  type T15DetoxSharedAdapters,
} from '../../scripts/testing/t15-detox-owner-public-composition';

void test('T15 retains exactly nine current Detox owner/public exports and excludes Android camera', () => {
  assert.deepEqual(
    T15_DETOX_ACTUAL_ROUTE_BINDINGS.map((binding) => binding.key),
    T15_DETOX_SHARED_ROUTE_KEYS,
  );
  assert.equal(T15_DETOX_ACTUAL_ROUTE_BINDINGS.length, 9);
  assert.equal(t15DetoxOwnerPublicCompositionContract.coldAttemptDenominator, 400);
  assert.equal(t15DetoxOwnerPublicCompositionContract.nativePassingCases, 0);
  assert.equal(t15DetoxOwnerPublicCompositionContract.androidCameraIncluded, false);
  assert.deepEqual(t15DetoxOwnerPublicCompositionContract.requiredInputs, [
    'authenticated-owner',
    'backend-identity',
    'fixture-reset-id',
    'target-identity',
    'qualified-build-reuse',
    'absolute-deadline',
    'abort-signal',
    'ownership-windows',
    'cleanup-status',
  ]);
  assert.equal(T15_DETOX_OWNER_PUBLIC_REQUIRED_INPUTS.length, 9);
  for (const binding of T15_DETOX_ACTUAL_ROUTE_BINDINGS) {
    const declared = requireT15DetoxSharedRoute(binding.key);
    assert.equal(binding.ownerModule, declared.ownerModule);
    assert.equal(binding.ownerExport, declared.ownerExport);
    assert.equal(binding.publicModule, declared.publicModule);
    assert.equal(binding.publicExport, declared.publicExport);
    assert.equal(typeof binding.owner, 'function');
    assert.equal(typeof binding.publicConsumer, 'function');
    assert.equal(binding.status, 'normalization-required');
    assert.deepEqual(binding.missingAdapters, [
      'reset-preparation',
      'owner-normalizer',
      'public-normalizer',
      'cleanup-ledger',
    ]);
  }
  const androidCamera = 'camera-denied|android' as T15DetoxSharedRouteKey;
  assert.throws(() => requireT15DetoxActualRouteBinding(androidCamera), /missing/);
});

void test('T15 owner/public composition refuses incomplete adapters and never invents runtime bindings', () => {
  assert.throws(
    () =>
      createT15DetoxOwnerPublicComposition({
        route: 'connection|ios',
        outputRoot: '/private/t15/connection-ios',
        adapters: {} as T15DetoxSharedAdapters,
      }),
    /requires reset-preparation, owner-normalizer, public-normalizer, and cleanup-ledger adapters/,
  );
});

void test('T15 composition attaches caller adapters to the sealed producer without invoking route resources', () => {
  const adapters: T15DetoxSharedAdapters = {
    reset: () =>
      Promise.reject(
        new Error('source-control reset adapter must be supplied by the runtime caller'),
      ),
    owner: () =>
      Promise.reject(
        new Error('source-control owner adapter must be supplied by the runtime caller'),
      ),
    consumePublic: () =>
      Promise.reject(
        new Error('source-control public adapter must be supplied by the runtime caller'),
      ),
    cleanup: () =>
      Promise.reject(
        new Error('source-control cleanup adapter must be supplied by the runtime caller'),
      ),
  };
  const composition = createT15DetoxOwnerPublicComposition({
    route: 'save-retry|android',
    outputRoot: '/private/t15/save-retry-android',
    adapters,
  });
  assert.equal(composition.status, 'wired-with-caller-adapters');
  assert.equal(composition.route.key, 'save-retry|android');
  assert.equal(typeof composition.producer, 'function');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  T15_REGISTERED_MATRIX_ROUTES,
  T15_MATRIX_ATTEMPT_COUNT,
  T15_MATRIX_CELL_COUNT,
} from '../../scripts/testing/t15-cold-matrix-registry';
import {
  T15_ANDROID_DETOX_CAMERA_RESET_DEPENDENCY,
  T15_DETOX_RESET_CALLER_GAPS,
  T15_DETOX_RESET_DEPENDENCIES,
  T15_DETOX_SHARED_RESET_DEPENDENCIES,
  requireT15DetoxResetDependency,
} from '../../scripts/testing/t15-detox-reset-contract';

void test('T15 keeps nine shared Detox reset dependencies and one Android camera adapter gap', () => {
  const cameraDependency = T15_ANDROID_DETOX_CAMERA_RESET_DEPENDENCY;
  assert(cameraDependency);
  assert.equal(T15_DETOX_RESET_DEPENDENCIES.length, 10);
  assert.equal(T15_DETOX_SHARED_RESET_DEPENDENCIES.length, 9);
  assert.equal(cameraDependency.pendingReason, 'android-detox-camera-adapter-missing');
  assert.equal(cameraDependency.family, 'camera-denied');
  assert.equal(cameraDependency.platform, 'android');
  assert.equal(T15_DETOX_RESET_DEPENDENCIES.filter((entry) => entry.module === null).length, 1);
  assert.equal(T15_DETOX_RESET_DEPENDENCIES.filter((entry) => entry.exportName === null).length, 1);
  assert.equal(new Set(T15_DETOX_RESET_DEPENDENCIES.map((entry) => entry.id)).size, 2);
  assert.ok(
    T15_DETOX_SHARED_RESET_DEPENDENCIES.every(
      (entry) =>
        entry.status === 'existing' &&
        entry.module === 'scripts/testing/t15-detox-cold-lifecycle.ts' &&
        entry.exportName === 'createT15DetoxSharedResetProducer' &&
        entry.contract.includes('FreshColdReset') &&
        entry.contract.includes('originalReceiptBinding') &&
        entry.ownershipBoundary.includes('same ownerRunId'),
    ),
  );
  assert.equal(T15_DETOX_RESET_CALLER_GAPS.length, 4);
});

void test('T15 registry exposes the reset contract on every pending Detox route without shrinking 20/400', () => {
  const detoxRoutes = T15_REGISTERED_MATRIX_ROUTES.filter((route) => route.engine === 'detox');
  assert.equal(T15_REGISTERED_MATRIX_ROUTES.length, T15_MATRIX_CELL_COUNT);
  assert.equal(T15_MATRIX_ATTEMPT_COUNT, 400);
  assert.equal(detoxRoutes.length, 10);
  for (const route of detoxRoutes) {
    const declared = requireT15DetoxResetDependency(route.family, route.platform);
    assert.equal(route.status, 'pending');
    assert.equal(route.reset.status, declared.status);
    assert.equal(route.reset.id, declared.id);
    assert.equal(route.reset.module, declared.module);
    assert.equal(route.reset.exportName, declared.exportName);
    assert.equal(route.reset.contract, declared.contract);
    assert.equal(route.fixture.status, declared.status);
    assert.equal(route.binding, null);
    assert.equal(route.pendingReason, declared.pendingReason);
  }
});

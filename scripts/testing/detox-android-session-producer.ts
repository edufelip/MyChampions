import assert from 'node:assert/strict';
import {
  createOwnedAndroidDetoxConnectionProducer,
  requireAndroidDetoxCleanupResult,
} from './detox-android-connection-producer';
import type {
  DetoxAndroidSessionProducerRegistration,
  DetoxBaselineFactories,
  DetoxOwnedTarget,
} from './detox-integrated-session-baseline';

/**
 * The Android session route owns the same emulator/storage target as the
 * already qualified Android Detox connection owner.  This adapter adds the
 * session-specific registration identity required by the baseline before it
 * can acquire any port, backend, proxy, Expo process, or native target.
 */
export type AndroidDetoxSessionProducer = DetoxAndroidSessionProducerRegistration;

/**
 * Private source-only controls may replace the owner implementation with a
 * bounded fixture producer.  The wrapper still enforces the Android target
 * identity and the owned cleanup result before the baseline can qualify.
 */
export type AndroidDetoxSessionProducerOverrides = Readonly<{
  acquireOwnedTarget?: DetoxBaselineFactories['acquireOwnedTarget'];
  verifyOwnedAndroidCleanup?: AndroidDetoxSessionProducer['verifyOwnedAndroidCleanup'];
}>;

function requireAndroidTarget(target: DetoxOwnedTarget): asserts target is DetoxOwnedTarget & {
  platform: 'android';
  androidRuntimeParent: string;
  androidSdkRoot: string;
} {
  assert.equal(
    target.platform,
    'android',
    'Android Detox session cleanup received another platform',
  );
  assert(target.androidRuntimeParent, 'Android Detox session runtime parent is missing');
  assert(target.androidSdkRoot, 'Android Detox session SDK root is missing');
  assert.equal(target.ownership.cleanupAuthorized, true);
  assert.equal(target.ownership.hostLockRequired, true);
}

/**
 * Keep the target acquisition and final census in one capability.  The
 * connection owner remains the only implementation of emulator acquisition;
 * this wrapper does not create a second Android runtime or cleanup policy.
 */
export function createOwnedAndroidDetoxSessionProducer(
  overrides: AndroidDetoxSessionProducerOverrides = {},
): AndroidDetoxSessionProducer {
  const connectionProducer = createOwnedAndroidDetoxConnectionProducer();
  const acquireOwnedTarget: DetoxBaselineFactories['acquireOwnedTarget'] =
    overrides.acquireOwnedTarget ?? connectionProducer.acquireOwnedTarget;
  const verifyOwnedAndroidCleanup =
    overrides.verifyOwnedAndroidCleanup ??
    (async (input) => {
      requireAndroidTarget(input.target);
      return connectionProducer.verifyOwnedAndroidCleanup({
        repositoryRoot: input.repositoryRoot,
        artifactRoot: input.artifactRoot,
        target: {
          platform: 'android',
          deviceId: input.target.deviceId,
          androidRuntimeParent: input.target.androidRuntimeParent,
          androidSdkRoot: input.target.androidSdkRoot,
          ownership: input.target.ownership,
        },
        signal: input.signal,
        deadlineAt: input.deadlineAtMonotonicMs,
      });
    });
  return Object.freeze({
    kind: 'owned-android-detox-session-producer' as const,
    acquireOwnedTarget,
    verifyOwnedAndroidCleanup: async (input) => {
      requireAndroidTarget(input.target);
      const result = await verifyOwnedAndroidCleanup(input);
      return requireAndroidDetoxCleanupResult(result);
    },
  });
}

export function requireAndroidDetoxSessionProducer(value: unknown): AndroidDetoxSessionProducer {
  assert(value && typeof value === 'object', 'Android Detox session producer is missing');
  const producer = value as Partial<AndroidDetoxSessionProducer>;
  assert.equal(
    producer.kind,
    'owned-android-detox-session-producer',
    'Android Detox session producer kind is not owned',
  );
  assert.equal(typeof producer.acquireOwnedTarget, 'function');
  assert.equal(typeof producer.verifyOwnedAndroidCleanup, 'function');
  return producer as AndroidDetoxSessionProducer;
}

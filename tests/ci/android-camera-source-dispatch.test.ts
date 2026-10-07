import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupportedAndroidCameraSourceSelection,
  runAndroidCameraAttemptForSourceDispatch,
} from '../../scripts/testing/run-android-camera-source-dispatch';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type {
  AndroidCameraAttemptOptionsV4,
  AndroidCameraAttemptResultV4,
} from '../../scripts/testing/run-android-camera-attempt';

const selection = (overrides: Partial<NativePilotSelection['arguments']> = {}) =>
  ({
    arguments: {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-android',
      mode: 'integration',
      ...overrides,
    },
  }) as NativePilotSelection;

void test('Android source dispatch admits only the exact Maestro camera selection', () => {
  assert.equal(isSupportedAndroidCameraSourceSelection(selection().arguments), true);
  assert.equal(
    isSupportedAndroidCameraSourceSelection(selection({ platform: 'ios' }).arguments),
    false,
  );
  assert.equal(
    isSupportedAndroidCameraSourceSelection(selection({ engine: 'detox' }).arguments),
    false,
  );
  assert.equal(
    isSupportedAndroidCameraSourceSelection(
      selection({ scenario: 'SCN-camera-denied-ios' }).arguments,
    ),
    false,
  );
  assert.equal(
    isSupportedAndroidCameraSourceSelection(selection({ mode: 'fixture' }).arguments),
    false,
  );
});

void test('Android source dispatch forwards the exact revalidated selection to its runner', async () => {
  const value = selection();
  const options = { selection: value } as AndroidCameraAttemptOptionsV4;
  const expected = {
    kind: 'private-owned-android-camera-v4-attempt',
    status: 'harness-blocked',
    publicPromotionEligible: false,
    runtimeQualification: 'Pending',
  } as AndroidCameraAttemptResultV4;
  let called = false;
  const actual = await runAndroidCameraAttemptForSourceDispatch(options, (received) => {
    called = true;
    assert.equal(received.selection, value);
    return Promise.resolve(expected);
  });
  assert.equal(called, true);
  assert.equal(actual, expected);
});

void test('Android source dispatch rejects a cross-platform or Detox selection before the runner', async () => {
  for (const invalid of [
    selection({ platform: 'ios' }),
    selection({ engine: 'detox' }),
    selection({ scenario: 'SCN-camera-denied-ios' }),
    selection({ mode: 'fixture' }),
  ]) {
    await assert.rejects(
      runAndroidCameraAttemptForSourceDispatch(
        { selection: invalid } as AndroidCameraAttemptOptionsV4,
        () => {
          throw new Error('runner should not be called');
        },
      ),
      /reviewed Maestro integration selection/,
    );
  }
});

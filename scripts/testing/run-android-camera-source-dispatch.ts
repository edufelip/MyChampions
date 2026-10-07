import assert from 'node:assert/strict';
import { ANDROID_CAMERA_SCENARIO } from './native-camera-android-contract';
import {
  runAndroidCameraAttemptV4,
  type AndroidCameraAttemptOptionsV4,
  type AndroidCameraAttemptResultV4,
} from './run-android-camera-attempt';
import type { NativePilotArguments } from './native-pilot-contract';

/** The only Android camera selection this source-only seam may forward. */
export function isSupportedAndroidCameraSourceSelection(args: NativePilotArguments): boolean {
  return (
    args.platform === 'android' &&
    args.engine === 'maestro' &&
    args.scenario === ANDROID_CAMERA_SCENARIO &&
    args.mode === 'integration'
  );
}

/**
 * Source-only Android dispatch. The existing attempt remains responsible for
 * declaration revalidation and returns Pending/blocked without an owned
 * bridge; this helper never changes the public native runner's iOS-only path.
 */
export async function runAndroidCameraAttemptForSourceDispatch(
  options: AndroidCameraAttemptOptionsV4,
  runner: (
    options: AndroidCameraAttemptOptionsV4,
  ) => Promise<AndroidCameraAttemptResultV4> = runAndroidCameraAttemptV4,
): Promise<AndroidCameraAttemptResultV4> {
  assert(
    isSupportedAndroidCameraSourceSelection(options.selection.arguments),
    'The Android camera source runner accepts only the reviewed Maestro integration selection',
  );
  return runner(options);
}

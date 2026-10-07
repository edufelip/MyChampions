import assert from 'node:assert/strict';
import {
  androidSessionPublicSelection,
  requireAndroidSessionSelectionArguments,
} from './native-android-session-public-contract';
import { androidSessionSelectionBinding } from './native-android-session-public-staging';
import {
  runAndroidSessionAttempt,
  type AndroidSessionAttemptResult,
} from './run-android-session-attempt';
import type { NativePilotArguments, NativePilotSelection } from './native-pilot-contract';

export type AndroidSessionPublicExecutionAdapter = 'android-session' | null;

/** The public entry may select this lane only for the exact reviewed cell. */
export function androidSessionExecutionAdapter(
  args: NativePilotArguments,
): AndroidSessionPublicExecutionAdapter {
  return args.platform === 'android' &&
    args.engine === 'maestro' &&
    args.scenario === 'SCN-session-android' &&
    args.mode === 'integration'
    ? 'android-session'
    : null;
}

/** Add the Android lane to the existing runner's adapter map without changing other lanes. */
export function nativePilotExecutionAdapterWithAndroid(
  args: NativePilotArguments,
  existing: string | null,
): string | null {
  return androidSessionExecutionAdapter(args) ?? existing;
}

/**
 * Public-runner handoff seam. The caller remains responsible for host-lock,
 * repository identity, deadlines and final receipt policy; this function only
 * proves that the selected arguments reach the owned six-phase Android runner.
 */
export async function runAndroidSessionAttemptForPublicDispatch(
  options: Parameters<typeof runAndroidSessionAttempt>[0],
  runner: (
    options: Parameters<typeof runAndroidSessionAttempt>[0],
  ) => ReturnType<typeof runAndroidSessionAttempt> = runAndroidSessionAttempt,
): Promise<AndroidSessionAttemptResult> {
  requireAndroidSessionSelectionArguments(options.selection.arguments);
  assert.deepEqual(options.selection.arguments, androidSessionPublicSelection);
  const result = await runner(options);
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
  if (result.staged)
    assert.deepEqual(
      result.staged.selectionBinding,
      androidSessionSelectionBinding(options.selection),
      'Android public dispatch lost the durable selection binding',
    );
  return result;
}

export function requireAndroidSessionDispatchSelection(selection: NativePilotSelection): void {
  requireAndroidSessionSelectionArguments(selection.arguments);
  assert.equal(selection.scenario.id, 'SCN-session-android');
  assert.equal(selection.scenario.platform, 'android');
  assert.equal(selection.scenario.engine, 'maestro');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.equal(selection.scenario.fixtureRef, 'owned-postgres:SCN-session-android:fresh-attempt');
  assert.match(selection.scenarioHash, /^[a-f0-9]{64}$/);
  assert.match(selection.requirementHash, /^[a-f0-9]{64}$/);
}

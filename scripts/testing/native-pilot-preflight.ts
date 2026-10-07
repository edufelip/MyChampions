import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import {
  nativeExecutionDeadlines,
  NativeExecutionDeadlineError,
  parseNativeExecutionDeadlines,
  type NativeExecutionDeadlines,
} from './native-runtime-preflight';

export type NativePilotSignalCode = 130 | 143;

export type NativePilotPreflightLifecycle = {
  controller: AbortController;
  deadlines: NativeExecutionDeadlines;
  deadlineAtMs: number;
  readonly deadlineExpired: boolean;
  dispose(): void;
};

function resolvePreflightDeadlines(
  env: Record<string, string | undefined>,
): NativeExecutionDeadlines {
  try {
    return parseNativeExecutionDeadlines(env);
  } catch {
    // The runner will classify malformed public overrides as invalid
    // environment. Until then, retain the existing protocol cap and keep the
    // lifecycle bounded while it prepares a blocked receipt.
    return nativeExecutionDeadlines();
  }
}

/**
 * Install cancellation and whole-run deadline handling before any awaited
 * root, directory, sidecar or inventory I/O. The caller owns disposal and
 * keeps the handlers live through final receipt publication.
 */
export function installNativePilotPreflightLifecycle(input: {
  startedAtMs: number;
  env?: Record<string, string | undefined>;
  onSignal?: (code: NativePilotSignalCode) => void;
  onDeadline?: () => void;
  deadlines?: NativeExecutionDeadlines;
}): NativePilotPreflightLifecycle {
  const deadlines = input.deadlines ?? resolvePreflightDeadlines(input.env ?? process.env);
  const controller = new AbortController();
  let deadlineExpired = false;
  let disposed = false;
  let signalCode: NativePilotSignalCode | undefined;
  const onInt = () => {
    signalCode ??= 130;
    input.onSignal?.(signalCode);
    controller.abort('SIGINT');
  };
  const onTerm = () => {
    signalCode ??= 143;
    input.onSignal?.(signalCode);
    controller.abort('SIGTERM');
  };
  // Register before the first filesystem await in the caller.
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  const deadlineAtMs = input.startedAtMs + deadlines.wholeRunMs;
  const timeout = setTimeout(
    () => {
      if (disposed || controller.signal.aborted) return;
      deadlineExpired = true;
      input.onDeadline?.();
      controller.abort(new NativeExecutionDeadlineError('whole-run', deadlines.wholeRunMs));
    },
    Math.max(1, deadlineAtMs - performance.now()),
  );
  (timeout as unknown as { unref?: () => void }).unref?.();
  return {
    controller,
    deadlines,
    deadlineAtMs,
    get deadlineExpired() {
      return deadlineExpired;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    },
  };
}

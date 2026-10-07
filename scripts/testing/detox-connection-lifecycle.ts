import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

export const DEFAULT_DETOX_CLEANUP_DEADLINE_MS = 30_000;

export type DetoxCleanupRecoveryStatus = 'verified' | 'not-verified';

/**
 * An owned cleanup operation can discover a recovery boundary even though its
 * promise settled.  Callers use this marker when a pending child or resource
 * must remain owned; the aggregate converts it to not-verified and skips all
 * destructive steps that follow it.
 */
export class DetoxCleanupRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetoxCleanupRecoveryError';
  }
}

export type DetoxCleanupStepResult<T> = Readonly<{
  status: 'settled' | 'failed' | 'not-verified';
  value?: T;
  error?: Error;
  elapsedMs: number;
}>;

export type DetoxCleanupAggregateResult = Readonly<{
  status: 'cleaned' | 'failed';
  recoveryStatus: DetoxCleanupRecoveryStatus;
  failures: readonly string[];
  timedOutLabels: readonly string[];
  skippedLabels: readonly string[];
  stepResults: readonly DetoxCleanupStepObservation[];
  elapsedMs: number;
}>;

export type DetoxCleanupStepObservation = Readonly<{
  label: string;
  status: 'settled' | 'failed' | 'not-verified' | 'skipped';
  elapsedMs: number;
  error: string | null;
}>;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function assertDeadline(deadlineAt: number): void {
  assert(Number.isFinite(deadlineAt), 'Detox cleanup deadline must be finite');
}

/**
 * Run one already-owned cleanup operation only while the aggregate deadline
 * remains available. A late promise remains observed after timeout so it
 * cannot become an unhandled rejection, but it never changes the result back
 * to cleaned or verified.
 */
export async function runDetoxCleanupStep<T>(input: {
  label: string;
  deadlineAt: number;
  signal: AbortSignal;
  operation: (remainingMs: number) => Promise<T>;
  onTimeout?: (label: string) => void;
}): Promise<DetoxCleanupStepResult<T>> {
  assert(input.label.length > 0, 'Detox cleanup step label is required');
  assertDeadline(input.deadlineAt);
  const startedAt = performance.now();
  const remainingMs = input.deadlineAt - startedAt;
  if (input.signal.aborted || remainingMs <= 0) {
    input.onTimeout?.(input.label);
    return {
      status: 'not-verified',
      error: new Error(`${input.label} did not start before the cleanup deadline`),
      elapsedMs: performance.now() - startedAt,
    };
  }

  let operationPromise: Promise<T>;
  try {
    operationPromise = input.operation(Math.max(1, Math.ceil(remainingMs)));
  } catch (error) {
    const normalized = asError(error);
    return {
      status: normalized instanceof DetoxCleanupRecoveryError ? 'not-verified' : 'failed',
      error: normalized,
      elapsedMs: performance.now() - startedAt,
    };
  }
  const remainingAfterStartMs = input.deadlineAt - performance.now();
  if (remainingAfterStartMs <= 0) {
    input.onTimeout?.(input.label);
    void operationPromise.then(
      () => undefined,
      () => undefined,
    );
    return {
      status: 'not-verified',
      error: new Error(`${input.label} exceeded the aggregate cleanup deadline`),
      elapsedMs: performance.now() - startedAt,
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = operationPromise.then(
    (value) => ({ status: 'settled' as const, value }),
    (error: unknown) => {
      const normalized = asError(error);
      return {
        status:
          normalized instanceof DetoxCleanupRecoveryError
            ? ('not-verified' as const)
            : ('failed' as const),
        error: normalized,
      };
    },
  );
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(1, Math.ceil(remainingAfterStartMs)));
  });
  try {
    const result = await Promise.race([settled, timeout]);
    if (result === null) {
      input.onTimeout?.(input.label);
      // `settled` has both fulfillment and rejection handlers attached. Keep
      // observing it after this function returns without changing the result.
      void settled.then(
        () => undefined,
        () => undefined,
      );
      return {
        status: 'not-verified',
        error: new Error(`${input.label} exceeded the aggregate cleanup deadline`),
        elapsedMs: performance.now() - startedAt,
      };
    }
    return {
      ...result,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Apply one monotonic deadline to every owned resource release. Once an
 * operation does not cooperate, remaining releases are deliberately skipped
 * and the caller receives recovery-not-verified rather than a false cleanup
 * success.
 */
export async function runDetoxCleanupAggregate(input: {
  deadlineMs?: number;
  /** Reuse the caller's absolute cleanup deadline when the aggregate is nested
   * under the lifecycle fence. This keeps the driver and outer runner on one
   * monotonic budget instead of creating a second full timeout. */
  deadlineAt?: number;
  signal?: AbortSignal;
  steps: readonly Readonly<{
    label: string;
    operation: (remainingMs: number, signal: AbortSignal) => Promise<unknown>;
  }>[];
}): Promise<DetoxCleanupAggregateResult> {
  assert(
    (input.deadlineMs === undefined) !== (input.deadlineAt === undefined),
    'Detox cleanup requires exactly one deadlineMs or deadlineAt',
  );
  const deadlineMs = input.deadlineMs;
  if (deadlineMs !== undefined)
    assert(Number.isSafeInteger(deadlineMs) && deadlineMs > 0, 'Detox cleanup deadline is invalid');
  const suppliedDeadlineAt = input.deadlineAt;
  if (suppliedDeadlineAt !== undefined) assertDeadline(suppliedDeadlineAt);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) onParentAbort();
  else input.signal?.addEventListener('abort', onParentAbort, { once: true });
  const startedAt = performance.now();
  const deadlineAt = suppliedDeadlineAt ?? startedAt + deadlineMs!;
  const failures: string[] = [];
  const timedOutLabels: string[] = [];
  const skippedLabels: string[] = [];
  const stepResults: DetoxCleanupStepObservation[] = [];
  let recoveryStatus: DetoxCleanupRecoveryStatus = 'verified';
  try {
    for (const step of input.steps) {
      if (recoveryStatus === 'not-verified') {
        skippedLabels.push(step.label);
        failures.push(`${step.label}:not-attempted-after-recovery-timeout`);
        stepResults.push({
          label: step.label,
          status: 'skipped',
          elapsedMs: 0,
          error: 'not-attempted-after-recovery-timeout',
        });
        continue;
      }
      const result = await runDetoxCleanupStep({
        label: step.label,
        deadlineAt,
        signal: controller.signal,
        operation: (remainingMs) => step.operation(remainingMs, controller.signal),
        onTimeout: (label) => {
          if (!timedOutLabels.includes(label)) timedOutLabels.push(label);
          recoveryStatus = 'not-verified';
          controller.abort(new Error(`${label} exceeded the cleanup deadline`));
        },
      });
      if (result.status === 'failed')
        failures.push(`${step.label}:${result.error?.message ?? 'cleanup failed'}`);
      if (result.status === 'not-verified') {
        recoveryStatus = 'not-verified';
        failures.push(`${step.label}:${result.error?.message ?? 'recovery not verified'}`);
      }
      stepResults.push({
        label: step.label,
        status: result.status,
        elapsedMs: result.elapsedMs,
        error: result.error?.message ?? null,
      });
    }
  } finally {
    input.signal?.removeEventListener('abort', onParentAbort);
  }
  return {
    status: failures.length === 0 ? 'cleaned' : 'failed',
    recoveryStatus,
    failures,
    timedOutLabels,
    skippedLabels,
    stepResults,
    elapsedMs: performance.now() - startedAt,
  };
}

export type DetoxConnectionSignalName = 'SIGINT' | 'SIGTERM';

export type DetoxConnectionSignalProcess = Readonly<{
  on(signal: DetoxConnectionSignalName, listener: () => void): unknown;
  removeListener(signal: DetoxConnectionSignalName, listener: () => void): unknown;
}>;

export class DetoxConnectionSignalError extends Error {
  readonly signal: DetoxConnectionSignalName;

  constructor(signal: DetoxConnectionSignalName) {
    super(`Detox connection cancelled by ${signal}`);
    this.name = 'DetoxConnectionSignalError';
    this.signal = signal;
  }
}

/**
 * Install and remove the standalone runner's OS signal listeners. The first
 * signal aborts the owned lifecycle; subsequent signals are recorded but do
 * not turn a cancellation into a passing result or bypass cleanup.
 */
export function createDetoxConnectionSignalController(
  processLike: DetoxConnectionSignalProcess = process,
): Readonly<{
  signal: AbortSignal;
  receivedSignals: readonly DetoxConnectionSignalName[];
  dispose(): void;
}> {
  const controller = new AbortController();
  const receivedSignals: DetoxConnectionSignalName[] = [];
  const listeners = new Map<DetoxConnectionSignalName, () => void>();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const listener = () => {
      receivedSignals.push(signal);
      if (!controller.signal.aborted) controller.abort(new DetoxConnectionSignalError(signal));
    };
    listeners.set(signal, listener);
    processLike.on(signal, listener);
  }
  let disposed = false;
  return {
    signal: controller.signal,
    receivedSignals,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const [signal, listener] of listeners) processLike.removeListener(signal, listener);
    },
  };
}

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const DETOX_MIN_BRIDGE_DEADLINE_MS = 30_000;
const DETOX_MAX_BRIDGE_DEADLINE_MS = 600_000;

export type DetoxDispatchClock = () => number;

export type DetoxDispatchLifecycle = Readonly<{
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  now: DetoxDispatchClock;
}>;

export type DetoxQualifiedBuildReadHooks = Readonly<{
  beforeRead?: () => void;
  afterRead?: () => void;
}>;

function requireDeadlineMs(value: number): number {
  assert(
    Number.isSafeInteger(value) &&
      value >= DETOX_MIN_BRIDGE_DEADLINE_MS &&
      value <= DETOX_MAX_BRIDGE_DEADLINE_MS,
    'Detox dispatch deadline is outside the owned bridge range',
  );
  return value;
}

export function createDetoxDispatchLifecycle(
  deadlineMs: number,
  signal: AbortSignal,
  now: DetoxDispatchClock = () => performance.now(),
): DetoxDispatchLifecycle {
  requireDeadlineMs(deadlineMs);
  assert(signal instanceof AbortSignal, 'Detox dispatch signal is invalid');
  const startedAtMonotonicMs = now();
  signal.throwIfAborted();
  assert(Number.isFinite(startedAtMonotonicMs), 'Detox dispatch clock is invalid');
  return Object.freeze({
    signal,
    deadlineAtMonotonicMs: startedAtMonotonicMs + deadlineMs,
    now,
  });
}

/**
 * Preserve one caller-owned absolute deadline across build, bridge, producer,
 * verifier and staging. A downstream step may shorten its local read bound,
 * but it must never restart the aggregate run budget from its own start time.
 */
export function createDetoxDispatchLifecycleAt(
  deadlineAtMonotonicMs: number,
  signal: AbortSignal,
  now: DetoxDispatchClock = () => performance.now(),
): DetoxDispatchLifecycle {
  assert(signal instanceof AbortSignal, 'Detox dispatch signal is invalid');
  signal.throwIfAborted();
  const currentMonotonicMs = now();
  assert(Number.isFinite(currentMonotonicMs), 'Detox dispatch clock is invalid');
  assert(
    Number.isFinite(deadlineAtMonotonicMs) && deadlineAtMonotonicMs > currentMonotonicMs,
    'Detox dispatch absolute deadline is invalid or elapsed',
  );
  return Object.freeze({
    signal,
    deadlineAtMonotonicMs,
    now,
  });
}

export function remainingDetoxDispatchBudget(lifecycle: DetoxDispatchLifecycle): number {
  lifecycle.signal.throwIfAborted();
  const remaining = Math.floor(lifecycle.deadlineAtMonotonicMs - lifecycle.now());
  lifecycle.signal.throwIfAborted();
  assert(remaining >= DETOX_MIN_BRIDGE_DEADLINE_MS, 'Detox dispatch deadline elapsed');
  return remaining;
}

/**
 * Preserve both caller bounds when forwarding the bridge budget. The caller's
 * step budget is the upper bound for one bridge invocation; the absolute
 * lifecycle deadline is the upper bound for the whole attempt. A long outer
 * deadline must never inflate a single bridge beyond its owned 10-minute cap.
 */
export function boundedDetoxBridgeDeadlineMs(
  lifecycle: DetoxDispatchLifecycle,
  stepDeadlineMs: number,
): number {
  assert(
    Number.isSafeInteger(stepDeadlineMs) &&
      stepDeadlineMs >= DETOX_MIN_BRIDGE_DEADLINE_MS &&
      stepDeadlineMs <= DETOX_MAX_BRIDGE_DEADLINE_MS,
    'Detox bridge step deadline is outside the owned range',
  );
  return Math.min(
    stepDeadlineMs,
    remainingDetoxDispatchBudget(lifecycle),
    DETOX_MAX_BRIDGE_DEADLINE_MS,
  );
}

export function detoxDispatchFence(lifecycle: DetoxDispatchLifecycle, phase: string): void {
  lifecycle.signal.throwIfAborted();
  const now = lifecycle.now();
  lifecycle.signal.throwIfAborted();
  assert(now < lifecycle.deadlineAtMonotonicMs, `Detox dispatch deadline elapsed during ${phase}`);
}

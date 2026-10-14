export type NativeCommandExecution =
  | 'completed'
  | 'child-failed'
  | 'deadline'
  | 'cancelled'
  | 'output-limit'
  | 'output-failed'
  | 'harness-blocked';

export type NativeCommandOutputFailure = {
  reason: 'limit' | 'io';
  stream: 'stdout' | 'stderr';
  bytes: number;
  message: string;
};

/** Short alias retained for adapters that describe this as an output failure. */
export type NativeOutputFailure = NativeCommandOutputFailure;

export type NativeCommandDiagnostic = {
  label: string | null;
  phase: string | null;
  execution: NativeCommandExecution | null;
  cleanup: string | null;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  deadlineMs: number | null;
  censusFailure: unknown;
  outputFailure: NativeCommandOutputFailure | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOutputFailure(value: unknown): NativeCommandOutputFailure | null {
  if (!isRecord(value)) return null;
  if (
    (value.reason !== 'limit' && value.reason !== 'io') ||
    (value.stream !== 'stdout' && value.stream !== 'stderr') ||
    typeof value.bytes !== 'number' ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    typeof value.message !== 'string' ||
    !value.message.trim()
  )
    return null;
  return {
    reason: value.reason,
    stream: value.stream,
    bytes: value.bytes,
    message: value.message,
  };
}

function normalizeCommandExecution(value: unknown): NativeCommandExecution | null {
  return value === 'completed' ||
    value === 'child-failed' ||
    value === 'deadline' ||
    value === 'cancelled' ||
    value === 'output-limit' ||
    value === 'output-failed' ||
    value === 'harness-blocked'
    ? value
    : null;
}

/** Retain only bounded diagnostics that the command owner already typed. */
export function normalizeNativeCommandDiagnostic(value: unknown): NativeCommandDiagnostic {
  const row = isRecord(value) ? value : {};
  const outputFailure = normalizeOutputFailure(row.outputFailure);
  const censusFailure = row.censusFailure ?? null;
  const explicitExecution = normalizeCommandExecution(row.execution);
  const outputExecution: NativeCommandExecution | null = outputFailure
    ? outputFailure.reason === 'limit'
      ? 'output-limit'
      : 'output-failed'
    : null;
  const execution =
    explicitExecution === 'harness-blocked' && outputExecution && censusFailure === null
      ? outputExecution
      : (explicitExecution ?? outputExecution);
  return {
    label: typeof row.label === 'string' ? row.label : null,
    phase: typeof row.phase === 'string' ? row.phase : null,
    execution,
    cleanup: typeof row.cleanup === 'string' ? row.cleanup : null,
    childExitCode: typeof row.childExitCode === 'number' ? row.childExitCode : null,
    childSignal: typeof row.childSignal === 'string' ? (row.childSignal as NodeJS.Signals) : null,
    deadlineMs: typeof row.deadlineMs === 'number' ? row.deadlineMs : null,
    censusFailure,
    outputFailure,
  };
}

/**
 * Require the exact successful command facts before projecting native success.
 * The normalized return keeps the original child exit separate from harness
 * qualification, so a zero child exit never turns a census failure into a pass.
 */
export function requireSuccessfulNativeCommandDiagnostics(
  value: unknown,
): NativeCommandDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('Native command diagnostics must be a non-empty array');
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Malformed native command diagnostic at index ${index}`);
    const row = normalizeNativeCommandDiagnostic(entry);
    if (!Object.hasOwn(entry, 'execution') || row.execution !== 'completed')
      throw new Error(`Native command diagnostic is not completed at index ${index}`);
    if (!Object.hasOwn(entry, 'cleanup') || row.cleanup !== 'cleaned')
      throw new Error(`Native command diagnostic cleanup is not clean at index ${index}`);
    if (
      !Object.hasOwn(entry, 'childExitCode') ||
      typeof entry.childExitCode !== 'number' ||
      !Number.isSafeInteger(entry.childExitCode) ||
      row.childExitCode !== 0
    )
      throw new Error(`Native command diagnostic child exit is not zero at index ${index}`);
    if (!Object.hasOwn(entry, 'childSignal') || entry.childSignal !== null)
      throw new Error(`Native command diagnostic has a child signal at index ${index}`);
    if (!Object.hasOwn(entry, 'censusFailure') || entry.censusFailure !== null)
      throw new Error(`Native command diagnostic has a census failure at index ${index}`);
    if (!Object.hasOwn(entry, 'outputFailure') || entry.outputFailure !== null)
      throw new Error(`Native command diagnostic has an output failure at index ${index}`);
    if (
      typeof entry.label !== 'string' ||
      !entry.label.trim() ||
      typeof entry.phase !== 'string' ||
      (entry.phase !== 'step' && entry.phase !== 'build') ||
      typeof entry.deadlineMs !== 'number' ||
      !Number.isFinite(entry.deadlineMs) ||
      entry.deadlineMs <= 0
    )
      throw new Error(`Malformed native command diagnostic metadata at index ${index}`);
    return row;
  });
}

/** A harness stop has no failing engine child; keep controller and child exits distinct. */
export function trainingAttemptChildExitCode(
  commands: { childExitCode: number | null }[],
  callbackCompleted: boolean,
) {
  const failed = commands.find((row) => row.childExitCode !== null && row.childExitCode !== 0);
  return failed?.childExitCode ?? (callbackCompleted ? 0 : null);
}

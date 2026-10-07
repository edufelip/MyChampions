import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const androidDriverDiagnosticMaxBytes = 1024 * 1024;
export const androidDriverDiagnosticMetadataMaxBytes = 512;
export const androidDriverDiagnosticReceiptMaxBytes = 64 * 1024;
export const androidDriverHostSampleLimit = 20;
export const androidDriverHostSampleIntervalMs = 10_000;

export const androidDriverDiagnosticLabels = [
  'android-driver-instrumentation-response',
  'android-driver-instrumentation-inventory',
  'android-driver-target-verification',
  'android-driver-failed-stdout',
  'android-driver-failed-stderr',
  'android-driver-device-logcat',
  'android-driver-package-state',
  'android-driver-process-state',
  'android-driver-port-state',
  'android-driver-host-sampling',
] as const;

export type AndroidDriverDiagnosticLabel = (typeof androidDriverDiagnosticLabels)[number];
export type AndroidDriverDiagnosticStream = 'stdout' | 'stderr';
export type AndroidDriverDiagnosticStatus = 'passed' | 'failed' | 'unknown' | 'blocked';

export type AndroidDriverDiagnosticTarget = {
  captureRunId: string;
  ownerRunId: string;
  serial: string;
  adbServerPort: number;
};

type ReadErrorFields = {
  name: string | null;
  message: string | null;
  code: string | number | null;
  signal: string | null;
  killed: boolean | null;
  metadata: {
    name: ObservedTextMetadata;
    message: ObservedTextMetadata;
    code: ObservedTextMetadata;
    signal: ObservedTextMetadata;
  };
};

type ObservedTextMetadata = {
  originalBytes: number | null;
  sha256: string | null;
  truncated: boolean;
};

export type AndroidDriverDiagnosticCause = ReadErrorFields & {
  kind: 'read-failed' | 'unknown';
};

export type AndroidDriverDiagnosticOutput = {
  path: string;
  stream: AndroidDriverDiagnosticStream;
  representation: 'utf8-returned-string' | 'buffer-exact' | 'unavailable';
  available: boolean;
  bytes: number | null;
  size: number | null;
  sha256: string | null;
  storedBytes: number;
  storedSha256: string;
  truncated: boolean;
};

export type AndroidReadonlyDiagnosticReceipt = {
  kind: 'android-readonly-driver-diagnostic';
  label: AndroidDriverDiagnosticLabel;
  target: AndroidDriverDiagnosticTarget;
  configuredTimeoutMs: number;
  deadlineMs: null;
  cancellation: null;
  status: AndroidDriverDiagnosticStatus;
  originalCause: AndroidDriverDiagnosticCause | null;
  error: ReadErrorFields;
  observedError: ReadErrorFields;
  stdout: AndroidDriverDiagnosticOutput | null;
  stderr: AndroidDriverDiagnosticOutput | null;
  outputLimitExceeded: boolean;
  outputLimitBytes: number;
  metadataLimitBytes: number;
};

export type AndroidReadonlyDiagnosticResult = {
  receiptPath: string;
  outputPaths: string[];
  receipt: AndroidReadonlyDiagnosticReceipt;
};

export type AndroidDriverProcessIdentity = {
  pid: number;
  started: string;
};

export type AndroidDriverHostSampleInput = {
  sampledAt: string;
  status: Exclude<AndroidDriverDiagnosticStatus, 'blocked'>;
  ownedProcesses: readonly AndroidDriverProcessIdentity[];
  observedProcesses: readonly AndroidDriverProcessIdentity[] | null;
  originalCause?: AndroidDriverDiagnosticCause | null;
};

export type AndroidDriverHostSample = {
  sampledAt: string;
  status: Exclude<AndroidDriverDiagnosticStatus, 'blocked'>;
  observedPidStarts: { pid: number; started: string }[] | null;
  ownedPidStarts: { pid: number; started: string }[];
  unmatchedPidStarts: { pid: number; started: string }[];
  originalCause: AndroidDriverDiagnosticCause | null;
};

export type AndroidDriverHostSamplingReceipt = {
  kind: 'android-driver-host-sampling';
  label: 'android-driver-host-sampling';
  target: AndroidDriverDiagnosticTarget;
  status: Exclude<AndroidDriverDiagnosticStatus, 'blocked'> | 'blocked';
  sampleCount: number;
  maxSamples: number;
  sampleIntervalMs: number;
  firstCause: AndroidDriverDiagnosticCause | null;
  output: {
    path: string;
    bytes: number;
    storedBytes: number;
    sha256: string;
    storedSha256: string;
    truncated: boolean;
  };
  outputLimitExceeded: boolean;
  outputLimitBytes: number;
  metadataLimitBytes: number;
};

export type AndroidDriverHostSamplingResult = {
  outputPath: string;
  receiptPath: string;
  receipt: AndroidDriverHostSamplingReceipt;
};

const diagnosticLabelSet = new Set<string>(androidDriverDiagnosticLabels);
const hostSamplingLabel = 'android-driver-host-sampling' as const;
const maxObservedNumericCode = 255;
const allowedErrorCodes = new Set([
  'EACCES',
  'EADDRINUSE',
  'ECONNREFUSED',
  'ECONNRESET',
  'EEXIST',
  'EIO',
  'ENOENT',
  'EPERM',
  'ESRCH',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
]);
const allowedSignals = new Set([
  'SIGABRT',
  'SIGALRM',
  'SIGBUS',
  'SIGCHLD',
  'SIGCONT',
  'SIGFPE',
  'SIGHUP',
  'SIGILL',
  'SIGINT',
  'SIGIO',
  'SIGIOT',
  'SIGKILL',
  'SIGPIPE',
  'SIGPOLL',
  'SIGPROF',
  'SIGPWR',
  'SIGQUIT',
  'SIGSEGV',
  'SIGSTOP',
  'SIGSYS',
  'SIGTERM',
  'SIGTRAP',
  'SIGTSTP',
  'SIGTTIN',
  'SIGTTOU',
  'SIGURG',
  'SIGUSR1',
  'SIGUSR2',
  'SIGVTALRM',
  'SIGXCPU',
  'SIGXFSZ',
  'SIGWINCH',
]);

function requireLabel(label: string): asserts label is AndroidDriverDiagnosticLabel {
  if (!diagnosticLabelSet.has(label))
    throw new Error('Unsupported Android driver diagnostic label');
}

function requireTimeout(timeoutMs: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5_000)
    throw new Error('Android driver diagnostic timeout must be a safe integer from 1 to 5000ms');
}

function requireTarget(target: AndroidDriverDiagnosticTarget) {
  if (!target || typeof target !== 'object')
    throw new Error('Android driver diagnostic target is required');
  for (const [name, value] of [
    ['captureRunId', target.captureRunId],
    ['ownerRunId', target.ownerRunId],
    ['serial', target.serial],
  ] as const) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256)
      throw new Error(`Invalid Android driver diagnostic target ${name}`);
  }
  if (
    !Number.isSafeInteger(target.adbServerPort) ||
    target.adbServerPort < 1 ||
    target.adbServerPort > 65535
  )
    throw new Error('Invalid Android driver diagnostic ADB port');
}

async function requirePrivateArtifactRoot(artifactRoot: string) {
  if (typeof artifactRoot !== 'string' || artifactRoot.length === 0)
    throw new Error('Android driver diagnostic artifact root is required');
  const resolved = path.resolve(artifactRoot);
  const canonical = await realpath(resolved);
  const metadata = await lstat(resolved);
  if (
    canonical !== resolved ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error('Android driver diagnostic artifacts must be canonical, private and owned');
  return canonical;
}

function streamForLabel(label: AndroidDriverDiagnosticLabel): AndroidDriverDiagnosticStream {
  return label.endsWith('-stderr') ? 'stderr' : 'stdout';
}

export function androidDriverDiagnosticPaths(
  artifactRoot: string,
  label: AndroidDriverDiagnosticLabel,
  stream: AndroidDriverDiagnosticStream = streamForLabel(label),
) {
  requireLabel(label);
  return {
    outputPath: path.join(path.resolve(artifactRoot), `${label}.${stream}.private.log`),
    receiptPath: path.join(path.resolve(artifactRoot), `${label}.receipt.private.json`),
  };
}

function androidDriverHostSamplingPaths(artifactRoot: string) {
  return androidDriverDiagnosticPaths(artifactRoot, hostSamplingLabel, 'stdout');
}

function emptyObservedTextMetadata(): ObservedTextMetadata {
  return { originalBytes: null, sha256: null, truncated: false };
}

function boundedObservedText(value: unknown) {
  if (typeof value !== 'string') return { value: null, metadata: emptyObservedTextMetadata() };
  const bytes = Buffer.from(value, 'utf8');
  const truncated = bytes.byteLength > androidDriverDiagnosticMetadataMaxBytes;
  let bounded = truncated
    ? bytes.subarray(0, androidDriverDiagnosticMetadataMaxBytes).toString('utf8')
    : value;
  while (Buffer.byteLength(bounded, 'utf8') > androidDriverDiagnosticMetadataMaxBytes)
    bounded = bounded.slice(0, -1);
  return {
    value: bounded,
    metadata: {
      originalBytes: bytes.byteLength,
      sha256: sha256(bytes),
      truncated,
    },
  };
}

function normalizeObservedCode(value: unknown): string | number | null {
  if (typeof value === 'string') return allowedErrorCodes.has(value) ? value : null;
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maxObservedNumericCode
  )
    return value;
  return null;
}

function normalizeObservedSignal(value: unknown) {
  return typeof value === 'string' && allowedSignals.has(value) ? value : null;
}

function errorFields(error: unknown): ReadErrorFields {
  const row = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  const name = boundedObservedText(error instanceof Error ? error.name : null);
  const message = boundedObservedText(
    error instanceof Error ? error.message : typeof error === 'string' ? error : null,
  );
  const code = normalizeObservedCode(row?.code);
  const signal = normalizeObservedSignal(row?.signal);
  const codeText = boundedObservedText(code === null ? null : String(code));
  const signalText = boundedObservedText(signal);
  const killed = typeof row?.killed === 'boolean' ? row.killed : null;
  return {
    name: name.value,
    message: message.value,
    code,
    signal,
    killed,
    metadata: {
      name: name.metadata,
      message: message.metadata,
      code: codeText.metadata,
      signal: signalText.metadata,
    },
  };
}

function causeForReadFailure(error: unknown): AndroidDriverDiagnosticCause {
  const fields = errorFields(error);
  const hasObservedCause =
    error !== null &&
    error !== undefined &&
    (fields.name !== null ||
      fields.message !== null ||
      fields.code !== null ||
      fields.signal !== null ||
      fields.killed !== null);
  return { kind: hasObservedCause ? 'read-failed' : 'unknown', ...fields };
}

type RawOutput = {
  bytes: Buffer;
  representation: 'utf8-returned-string' | 'buffer-exact';
};

function rawBytes(value: unknown): RawOutput | null {
  if (typeof value === 'string')
    return { bytes: Buffer.from(value, 'utf8'), representation: 'utf8-returned-string' };
  if (Buffer.isBuffer(value)) return { bytes: value, representation: 'buffer-exact' };
  return null;
}

function streamValue(error: unknown, stream: AndroidDriverDiagnosticStream): RawOutput | null {
  if (!error || typeof error !== 'object') return null;
  return rawBytes((error as Record<string, unknown>)[stream]);
}

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function outputDescriptor(
  outputPath: string,
  stream: AndroidDriverDiagnosticStream,
  value: RawOutput | null,
  storedValue: Buffer | null,
): AndroidDriverDiagnosticOutput {
  if (value === null) {
    return {
      path: outputPath,
      stream,
      representation: 'unavailable',
      available: false,
      bytes: null,
      size: null,
      sha256: null,
      storedBytes: 0,
      storedSha256: sha256(Buffer.alloc(0)),
      truncated: false,
    };
  }
  const stored = storedValue ?? value.bytes.subarray(0, androidDriverDiagnosticMaxBytes);
  return {
    path: outputPath,
    stream,
    representation: value.representation,
    available: true,
    bytes: value.bytes.byteLength,
    size: value.bytes.byteLength,
    sha256: sha256(value.bytes),
    storedBytes: stored.byteLength,
    storedSha256: sha256(stored),
    truncated: stored.byteLength !== value.bytes.byteLength,
  };
}

async function assertArtifactFile(filePath: string) {
  const metadata = await lstat(filePath);
  assert(metadata.isFile() && !metadata.isSymbolicLink());
  assert.equal(metadata.uid, process.getuid?.());
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(await realpath(filePath), filePath);
}

async function requireNoCollision(paths: readonly string[]) {
  for (const filePath of paths) {
    try {
      await lstat(filePath);
      throw new Error(
        `Android driver diagnostic artifact already exists: ${path.basename(filePath)}`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }
}

async function writeExclusive(filePath: string, bytes: Uint8Array) {
  await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  await assertArtifactFile(filePath);
}

function errorOutput(error: unknown, stream: AndroidDriverDiagnosticStream) {
  return streamValue(error, stream);
}

function diagnosticStatus(
  readStatus: 'passed' | 'failed' | 'unknown',
  outputLimitExceeded: boolean,
): AndroidDriverDiagnosticStatus {
  if (outputLimitExceeded) return 'blocked';
  return readStatus;
}

function safeJson(value: unknown) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined)
    throw new Error('Android driver diagnostic receipt is not serializable');
  return Buffer.from(serialized, 'utf8');
}

function safeReceiptJson(value: unknown) {
  const bytes = safeJson(value);
  if (bytes.byteLength > androidDriverDiagnosticReceiptMaxBytes)
    throw new Error('Android driver diagnostic receipt exceeds metadata limit');
  return bytes;
}

function emptyErrorFields(): ReadErrorFields {
  return {
    name: null,
    message: null,
    code: null,
    signal: null,
    killed: null,
    metadata: {
      name: emptyObservedTextMetadata(),
      message: emptyObservedTextMetadata(),
      code: emptyObservedTextMetadata(),
      signal: emptyObservedTextMetadata(),
    },
  };
}

/**
 * Persist one read-only Android driver query. The integration supplies a
 * bounded `read` closure such as `() => target.adbRead(timeoutMs)`; this
 * helper never races or cancels that callback and never infers a deadline.
 */
export async function captureAndroidReadonlyDiagnostic(options: {
  artifactRoot: string;
  label: AndroidDriverDiagnosticLabel;
  read: () => Promise<string | Buffer | undefined>;
  timeoutMs: number;
  target: AndroidDriverDiagnosticTarget;
}): Promise<AndroidReadonlyDiagnosticResult> {
  requireLabel(options.label);
  requireTimeout(options.timeoutMs);
  requireTarget(options.target);
  const artifactRoot = await requirePrivateArtifactRoot(options.artifactRoot);
  const primaryStream = streamForLabel(options.label);
  const primaryPaths = androidDriverDiagnosticPaths(artifactRoot, options.label, primaryStream);
  const allCandidateOutputPaths = [
    androidDriverDiagnosticPaths(artifactRoot, options.label, 'stdout').outputPath,
    androidDriverDiagnosticPaths(artifactRoot, options.label, 'stderr').outputPath,
  ];
  await requireNoCollision([...allCandidateOutputPaths, primaryPaths.receiptPath]);

  let readStatus: 'passed' | 'failed' | 'unknown' = 'unknown';
  let cause: AndroidDriverDiagnosticCause | null = null;
  let observedError: ReadErrorFields = emptyErrorFields();
  let primaryOutput: RawOutput | null = null;
  let stdoutOutput: RawOutput | null = null;
  let stderrOutput: RawOutput | null = null;
  try {
    const value = await options.read();
    primaryOutput = rawBytes(value);
    readStatus = primaryOutput === null ? 'unknown' : 'passed';
    if (primaryOutput === null) cause = { kind: 'unknown', ...emptyErrorFields() };
  } catch (error) {
    const readCause = causeForReadFailure(error);
    readStatus = readCause.kind === 'unknown' ? 'unknown' : 'failed';
    cause = readCause;
    observedError = errorFields(error);
    stdoutOutput = errorOutput(error, 'stdout');
    stderrOutput = errorOutput(error, 'stderr');
    primaryOutput = primaryStream === 'stdout' ? stdoutOutput : stderrOutput;
  }

  const streamPaths = new Map<AndroidDriverDiagnosticStream, string>([
    [primaryStream, primaryPaths.outputPath],
  ]);
  if (stdoutOutput !== null && primaryStream !== 'stdout')
    streamPaths.set(
      'stdout',
      androidDriverDiagnosticPaths(artifactRoot, options.label, 'stdout').outputPath,
    );
  if (stderrOutput !== null && primaryStream !== 'stderr')
    streamPaths.set(
      'stderr',
      androidDriverDiagnosticPaths(artifactRoot, options.label, 'stderr').outputPath,
    );
  const outputValues = new Map<AndroidDriverDiagnosticStream, RawOutput | null>([
    [primaryStream, primaryOutput],
  ]);
  if (stdoutOutput !== null && primaryStream !== 'stdout') outputValues.set('stdout', stdoutOutput);
  if (stderrOutput !== null && primaryStream !== 'stderr') outputValues.set('stderr', stderrOutput);
  if (primaryOutput === null && stderrOutput === null) outputValues.set(primaryStream, null);
  let remainingOutputBytes = androidDriverDiagnosticMaxBytes;
  const storedValues = new Map<AndroidDriverDiagnosticStream, Buffer | null>();
  for (const stream of outputValues.keys()) {
    const value = outputValues.get(stream) ?? null;
    const stored = value === null ? null : value.bytes.subarray(0, remainingOutputBytes);
    if (stored !== null) remainingOutputBytes -= stored.byteLength;
    storedValues.set(stream, stored);
  }
  const outputRecords = new Map<AndroidDriverDiagnosticStream, AndroidDriverDiagnosticOutput>();
  for (const [stream, outputPath] of streamPaths)
    outputRecords.set(
      stream,
      outputDescriptor(
        outputPath,
        stream,
        outputValues.get(stream) ?? null,
        storedValues.get(stream) ?? null,
      ),
    );
  const observedOutputBytes = [...outputValues.values()].reduce(
    (total, value) => total + (value?.bytes.byteLength ?? 0),
    0,
  );
  const outputLimitExceeded = observedOutputBytes > androidDriverDiagnosticMaxBytes;
  const outputPaths = [...streamPaths.values()];
  const receiptPath = primaryPaths.receiptPath;
  await requireNoCollision([...outputPaths, receiptPath]);
  const created: string[] = [];
  try {
    for (const [stream, outputPath] of streamPaths) {
      await writeExclusive(outputPath, storedValues.get(stream) ?? Buffer.alloc(0));
      created.push(outputPath);
    }
    const receipt: AndroidReadonlyDiagnosticReceipt = {
      kind: 'android-readonly-driver-diagnostic',
      label: options.label,
      target: options.target,
      configuredTimeoutMs: options.timeoutMs,
      deadlineMs: null,
      cancellation: null,
      status: diagnosticStatus(readStatus, outputLimitExceeded),
      originalCause: cause,
      error: observedError,
      observedError,
      stdout: outputRecords.get('stdout') ?? null,
      stderr: outputRecords.get('stderr') ?? null,
      outputLimitExceeded,
      outputLimitBytes: androidDriverDiagnosticMaxBytes,
      metadataLimitBytes: androidDriverDiagnosticReceiptMaxBytes,
    };
    await writeExclusive(receiptPath, safeReceiptJson(receipt));
    created.push(receiptPath);
    return { receiptPath, outputPaths, receipt };
  } catch (error) {
    await Promise.all(
      created.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)),
    );
    throw error;
  }
}

function identityKey(row: AndroidDriverProcessIdentity) {
  if (
    !Number.isSafeInteger(row.pid) ||
    row.pid <= 1 ||
    typeof row.started !== 'string' ||
    Number.isNaN(Date.parse(row.started))
  )
    throw new Error('Invalid Android driver process identity');
  return `${row.pid}:${row.started}`;
}

function normalizeCause(
  cause: AndroidDriverDiagnosticCause | null | undefined,
): AndroidDriverDiagnosticCause | null {
  if (cause === null || cause === undefined) return null;
  const name = boundedObservedText(cause.name);
  const message = boundedObservedText(cause.message);
  const code = normalizeObservedCode(cause.code);
  const signal = normalizeObservedSignal(cause.signal);
  const codeText = boundedObservedText(code === null ? null : String(code));
  const signalText = boundedObservedText(signal);
  const incomingMetadata = cause.metadata;
  const metadataFor = (
    key: keyof ReadErrorFields['metadata'],
    fallback: ObservedTextMetadata,
  ): ObservedTextMetadata => {
    const value = incomingMetadata?.[key];
    if (!value || typeof value !== 'object') return fallback;
    const row = value as Partial<ObservedTextMetadata>;
    const originalBytes = row.originalBytes;
    const hash = row.sha256;
    const truncated = row.truncated;
    if (
      (originalBytes !== undefined &&
        originalBytes !== null &&
        (!Number.isSafeInteger(originalBytes) || originalBytes < 0)) ||
      (hash !== undefined &&
        hash !== null &&
        (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))) ||
      typeof truncated !== 'boolean' ||
      (originalBytes === null && (hash !== null || truncated === true)) ||
      (originalBytes !== null &&
        (hash === null ||
          (typeof originalBytes === 'number' &&
            originalBytes > androidDriverDiagnosticMetadataMaxBytes &&
            truncated === false)))
    )
      return fallback;
    return {
      originalBytes: originalBytes ?? null,
      sha256: hash ?? null,
      truncated,
    };
  };
  return {
    kind: cause.kind === 'read-failed' ? 'read-failed' : 'unknown',
    name: name.value,
    message: message.value,
    code,
    signal,
    killed: typeof cause.killed === 'boolean' ? cause.killed : null,
    metadata: {
      name: metadataFor('name', name.metadata),
      message: metadataFor('message', message.metadata),
      code: metadataFor('code', codeText.metadata),
      signal: metadataFor('signal', signalText.metadata),
    },
  };
}

/** Pure classification for one already-collected host census sample. */
export function classifyAndroidDriverHostSample(
  input: AndroidDriverHostSampleInput,
): AndroidDriverHostSample {
  if (input.status !== 'passed' && input.status !== 'failed' && input.status !== 'unknown')
    throw new Error('Invalid Android driver host sample status');
  if (Number.isNaN(Date.parse(input.sampledAt)))
    throw new Error('Invalid Android driver host sample timestamp');
  const ownedIdentityKeys = input.ownedProcesses.map(identityKey);
  if (new Set(ownedIdentityKeys).size !== ownedIdentityKeys.length)
    throw new Error('Duplicate Android driver owned process identity');
  const ownedKeys = new Set(ownedIdentityKeys);
  if (input.status === 'passed' && input.observedProcesses === null)
    throw new Error('Passed Android driver host sample requires observed processes');
  if (input.status !== 'passed' && input.observedProcesses !== null)
    throw new Error('Failed or unknown Android driver host sample cannot claim observed processes');
  const observedPidStarts =
    input.observedProcesses?.map((row) => {
      identityKey(row);
      return { pid: row.pid, started: row.started };
    }) ?? null;
  if (observedPidStarts) {
    const keys = observedPidStarts.map((row) => `${row.pid}:${row.started}`);
    if (new Set(keys).size !== keys.length)
      throw new Error('Duplicate Android driver host process identity');
  }
  const ownedPidStarts =
    observedPidStarts?.filter((row) => ownedKeys.has(`${row.pid}:${row.started}`)) ?? [];
  const unmatchedPidStarts =
    observedPidStarts?.filter((row) => !ownedKeys.has(`${row.pid}:${row.started}`)) ?? [];
  return {
    sampledAt: input.sampledAt,
    status: input.status,
    observedPidStarts,
    ownedPidStarts,
    unmatchedPidStarts,
    originalCause: normalizeCause(input.originalCause),
  };
}

/**
 * Persist bounded, already-collected host samples. This is intentionally a
 * recorder/classifier: it does not inspect the host, signal a process, retry,
 * or extend any deadline.
 */
export async function recordAndroidDriverHostSamples(options: {
  /** A unique 0700 subdirectory owned by the caller for this readiness. */
  readinessArtifactRoot: string;
  target: AndroidDriverDiagnosticTarget;
  samples: readonly AndroidDriverHostSampleInput[];
}): Promise<AndroidDriverHostSamplingResult> {
  requireTarget(options.target);
  if (options.samples.length > androidDriverHostSampleLimit)
    throw new Error('Android driver host sample limit exceeded');
  const artifactRoot = await requirePrivateArtifactRoot(options.readinessArtifactRoot);
  const classified = options.samples.map(classifyAndroidDriverHostSample);
  for (let index = 1; index < classified.length; index++) {
    const previous = Date.parse(classified[index - 1].sampledAt);
    const current = Date.parse(classified[index].sampledAt);
    if (current - previous < androidDriverHostSampleIntervalMs)
      throw new Error('Android driver host samples must be at least 10 seconds apart');
  }
  const firstNonpassed = classified.find((sample) => sample.status !== 'passed');
  const firstCause = firstNonpassed
    ? (firstNonpassed.originalCause ?? {
        kind: 'unknown' as const,
        name: null,
        message: null,
        code: null,
        signal: null,
        killed: null,
        metadata: {
          name: emptyObservedTextMetadata(),
          message: emptyObservedTextMetadata(),
          code: emptyObservedTextMetadata(),
          signal: emptyObservedTextMetadata(),
        },
      })
    : null;
  const status: AndroidDriverHostSamplingReceipt['status'] =
    classified.length === 0
      ? 'unknown'
      : classified.some((sample) => sample.status === 'failed')
        ? 'failed'
        : classified.some((sample) => sample.status === 'unknown')
          ? 'unknown'
          : 'passed';
  const payload = safeJson({
    kind: 'android-driver-host-sampling-output',
    target: options.target,
    samples: classified,
    firstCause,
  });
  const paths = androidDriverHostSamplingPaths(artifactRoot);
  await requireNoCollision([paths.outputPath, paths.receiptPath]);
  const outputLimitExceeded = payload.byteLength > androidDriverDiagnosticMaxBytes;
  const storedPayload = outputLimitExceeded
    ? Buffer.from(
        JSON.stringify({
          kind: 'android-driver-host-sampling-output-blocked',
          outputLimitBytes: androidDriverDiagnosticMaxBytes,
        }),
        'utf8',
      )
    : payload;
  const receipt: AndroidDriverHostSamplingReceipt = {
    kind: 'android-driver-host-sampling',
    label: hostSamplingLabel,
    target: options.target,
    status: outputLimitExceeded ? 'blocked' : status,
    sampleCount: classified.length,
    maxSamples: androidDriverHostSampleLimit,
    sampleIntervalMs: androidDriverHostSampleIntervalMs,
    firstCause,
    output: {
      path: paths.outputPath,
      bytes: payload.byteLength,
      storedBytes: storedPayload.byteLength,
      sha256: sha256(payload),
      storedSha256: sha256(storedPayload),
      truncated: outputLimitExceeded,
    },
    outputLimitExceeded,
    outputLimitBytes: androidDriverDiagnosticMaxBytes,
    metadataLimitBytes: androidDriverDiagnosticReceiptMaxBytes,
  };
  const created: string[] = [];
  try {
    await writeExclusive(paths.outputPath, storedPayload);
    created.push(paths.outputPath);
    await writeExclusive(paths.receiptPath, safeReceiptJson(receipt));
    created.push(paths.receiptPath);
    return { outputPath: paths.outputPath, receiptPath: paths.receiptPath, receipt };
  } catch (error) {
    await Promise.all(
      created.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)),
    );
    throw error;
  }
}

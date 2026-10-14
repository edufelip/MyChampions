import { createHash } from 'node:crypto';
import { mkdir, lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  androidDriverDiagnosticMetadataMaxBytes,
  androidDriverHostSampleIntervalMs,
  androidDriverHostSampleLimit,
  classifyAndroidDriverHostSample,
  recordAndroidDriverHostSamples,
  type AndroidDriverDiagnosticCause,
  type AndroidDriverDiagnosticTarget,
  type AndroidDriverHostSampleInput,
  type AndroidDriverHostSamplingResult,
  type AndroidDriverProcessIdentity,
} from './native-android-driver-diagnostics';
import { inspectNativeHostContention } from './native-host-contention';

export type AndroidDriverHostInspection = {
  status: 'contended' | 'no-known-job';
  knownJobs: readonly { pid: number; started: string }[];
};

export type AndroidDriverStartupSamplingOptions = {
  artifactRoot: string;
  readinessLabel: string;
  target: AndroidDriverDiagnosticTarget;
  ownedProcesses: () => Promise<readonly AndroidDriverProcessIdentity[]>;
  inspectHost?: () => Promise<AndroidDriverHostInspection>;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export type AndroidDriverStartupSamplingResult = AndroidDriverHostSamplingResult & {
  blocked: boolean;
};

export type AndroidDriverStartupSampler = {
  stop: () => Promise<AndroidDriverStartupSamplingResult>;
};

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

function emptyMetadata() {
  return { originalBytes: null, sha256: null, truncated: false };
}

function boundedText(value: unknown) {
  if (typeof value !== 'string') return { value: null, metadata: emptyMetadata() };
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
      sha256: createHash('sha256').update(bytes).digest('hex'),
      truncated,
    },
  };
}

function causeFromError(error: unknown): AndroidDriverDiagnosticCause {
  const row = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  const name = boundedText(error instanceof Error ? error.name : null);
  const message = boundedText(
    error instanceof Error ? error.message : typeof error === 'string' ? error : null,
  );
  const rawCode = row?.code;
  const code =
    typeof rawCode === 'string' && allowedErrorCodes.has(rawCode)
      ? rawCode
      : typeof rawCode === 'number' &&
          Number.isSafeInteger(rawCode) &&
          rawCode >= 0 &&
          rawCode <= 255
        ? rawCode
        : null;
  const rawSignal = row?.signal;
  const signal = typeof rawSignal === 'string' && allowedSignals.has(rawSignal) ? rawSignal : null;
  const codeText = boundedText(code === null ? null : String(code));
  const signalText = boundedText(signal);
  const killed = typeof row?.killed === 'boolean' ? row.killed : null;
  const hasCause =
    name.value !== null ||
    message.value !== null ||
    code !== null ||
    signal !== null ||
    killed !== null;
  return {
    kind: hasCause ? 'read-failed' : 'unknown',
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

function validateReadinessLabel(value: string) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}-readiness$/.test(value))
    throw new Error('Invalid Android driver readiness label');
}

function validateTarget(target: AndroidDriverDiagnosticTarget) {
  if (!target || typeof target !== 'object') throw new Error('Android driver target is required');
  for (const value of [target.captureRunId, target.ownerRunId, target.serial])
    if (typeof value !== 'string' || value.length === 0 || value.length > 256)
      throw new Error('Invalid Android driver target identity');
  if (
    !Number.isSafeInteger(target.adbServerPort) ||
    target.adbServerPort < 1 ||
    target.adbServerPort > 65535
  )
    throw new Error('Invalid Android driver target ADB port');
}

async function requirePrivateDirectory(value: string) {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('Android startup sampling artifact root is required');
  const resolved = path.resolve(value);
  const canonical = await realpath(resolved);
  const metadata = await lstat(resolved);
  if (
    canonical !== resolved ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error('Android startup sampling artifacts must be canonical, private and owned');
  return canonical;
}

async function createReadinessDirectory(artifactRoot: string, readinessLabel: string) {
  const parent = await requirePrivateDirectory(artifactRoot);
  const samplingRoot = path.join(parent, `${readinessLabel}-driver-sampling`);
  await mkdir(samplingRoot, { mode: 0o700 });
  try {
    return await requirePrivateDirectory(samplingRoot);
  } catch (error) {
    await rm(samplingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function processIdentity(value: unknown): AndroidDriverProcessIdentity {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid Android driver process identity');
  const row = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(row.pid) ||
    (row.pid as number) <= 1 ||
    typeof row.started !== 'string' ||
    row.started.length === 0 ||
    row.started.length > 256 ||
    Number.isNaN(Date.parse(row.started))
  )
    throw new Error('Invalid Android driver process identity');
  return { pid: row.pid as number, started: row.started };
}

function inspection(value: unknown): AndroidDriverHostInspection {
  if (!value || typeof value !== 'object') throw new Error('Android host census unavailable');
  const row = value as Record<string, unknown>;
  if (row.status !== 'contended' && row.status !== 'no-known-job')
    throw new Error('Android host census status unavailable');
  if (!Array.isArray(row.knownJobs)) throw new Error('Android host census jobs unavailable');
  const knownJobs = row.knownJobs.map((job) => processIdentity(job));
  if (row.status === 'no-known-job' && knownJobs.length > 0)
    throw new Error('Android host census status contradicts known jobs');
  if (row.status === 'contended' && knownJobs.length === 0)
    throw new Error('Android host census status contradicts known jobs');
  return { status: row.status, knownJobs };
}

const defaultInspectHost = async (): Promise<AndroidDriverHostInspection> => {
  const value = await inspectNativeHostContention();
  return inspection(value);
};

/**
 * Sample the host around one owned Android readiness command. This helper owns
 * no process, device, timer side effect beyond its bounded sampling timer, or
 * signal authority. The caller must stop it before releasing the target.
 */
export async function startAndroidDriverStartupSampling(
  options: AndroidDriverStartupSamplingOptions,
): Promise<AndroidDriverStartupSampler> {
  validateReadinessLabel(options.readinessLabel);
  validateTarget(options.target);
  if (typeof options.ownedProcesses !== 'function')
    throw new Error('Android startup sampling owned process reader is required');
  if (options.inspectHost !== undefined && typeof options.inspectHost !== 'function')
    throw new Error('Android startup sampling host inspector is invalid');
  const artifactRoot = await createReadinessDirectory(options.artifactRoot, options.readinessLabel);
  const inspectHost = options.inspectHost ?? defaultInspectHost;
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  const samples: AndroidDriverHostSampleInput[] = [];
  let lastSampleAtMs: number | null = null;
  let timer: unknown;
  let inFlight: Promise<void> | null = null;
  let stopping = false;
  let stopPromise: Promise<AndroidDriverStartupSamplingResult> | null = null;

  const currentTime = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid Android sampling clock');
    return value;
  };

  const sample = async () => {
    const sampledAtMs = currentTime();
    lastSampleAtMs = sampledAtMs;
    const sampledAt = new Date(sampledAtMs).toISOString();
    let owned: AndroidDriverProcessIdentity[] = [];
    let ownedValid = false;
    try {
      const ownedRows = await options.ownedProcesses();
      if (!Array.isArray(ownedRows)) throw new Error('Owned Android process census unavailable');
      owned = ownedRows.map(processIdentity);
      const host = inspection(await inspectHost());
      const candidate: AndroidDriverHostSampleInput = {
        sampledAt,
        status: 'passed',
        ownedProcesses: owned,
        observedProcesses: host.knownJobs,
      };
      classifyAndroidDriverHostSample(candidate);
      ownedValid = true;
      samples.push(candidate);
    } catch (error) {
      if (!ownedValid && error instanceof Error && error.message.includes('process identity'))
        owned = [];
      const originalCause = causeFromError(error);
      samples.push({
        sampledAt,
        status: originalCause.kind === 'unknown' ? 'unknown' : 'failed',
        ownedProcesses: owned,
        observedProcesses: null,
        originalCause,
      });
    }
  };

  function scheduleNext() {
    if (stopping || samples.length >= androidDriverHostSampleLimit || lastSampleAtMs === null)
      return;
    const delayMs = Math.max(0, lastSampleAtMs + androidDriverHostSampleIntervalMs - currentTime());
    timer = schedule(() => {
      timer = undefined;
      beginSample();
    }, delayMs);
  }

  const beginSample = () => {
    if (stopping || samples.length >= androidDriverHostSampleLimit || inFlight) return;
    if (
      lastSampleAtMs !== null &&
      currentTime() - lastSampleAtMs < androidDriverHostSampleIntervalMs
    ) {
      scheduleNext();
      return;
    }
    const promise = sample();
    const settled = promise.finally(() => {
      if (inFlight === settled) inFlight = null;
      scheduleNext();
    });
    inFlight = settled;
  };

  await sample();
  scheduleNext();

  const stop = () => {
    if (stopPromise) return stopPromise;
    stopping = true;
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    stopPromise = (async () => {
      if (inFlight) await inFlight;
      const recorded = await recordAndroidDriverHostSamples({
        readinessArtifactRoot: artifactRoot,
        target: options.target,
        samples,
      });
      const classified = samples.map(classifyAndroidDriverHostSample);
      const blocked =
        recorded.receipt.status === 'blocked' ||
        classified.some(
          (row) =>
            row.status === 'unknown' ||
            row.status === 'failed' ||
            row.unmatchedPidStarts.length > 0,
        );
      return { ...recorded, blocked };
    })();
    return stopPromise;
  };

  return { stop };
}

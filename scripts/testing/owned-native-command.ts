import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { OwnedProcessCensusQueryError, trackOwnedProcessGroup } from './owned-process-group';
import type {
  OwnedCommandCensusSettleOptions,
  ProcessCensusQueryFailure,
} from './owned-process-group';

export class OwnedNativeCommandError extends Error {
  constructor(
    readonly reason:
      | 'deadline'
      | 'cancelled'
      | 'child-failed'
      | 'census-failed'
      | 'output-limit'
      | 'output-failed',
    message: string,
  ) {
    super(message);
    this.name = 'OwnedNativeCommandError';
  }
}

/**
 * The process can be spawned before the ownership census is accepted.  A
 * caller that only receives the rejected promise must retain this boundary as
 * unknown; it must never report that no native child was acquired.
 */
export class OwnedNativeCommandAcquisitionError extends Error {
  readonly pid: number | null;
  readonly pgid: number | null;
  readonly logPath: string | null;
  readonly stdoutPath: string | null;
  readonly ownershipPath: string | null;
  readonly cleanup: 'cleaned' | 'failed-recovery-ledger-retained' | 'unknown';
  readonly cleanupError?: unknown;
  readonly cleanupMs: number;

  constructor(details: {
    message: string;
    pid: number | null;
    pgid: number | null;
    logPath: string | null;
    stdoutPath: string | null;
    ownershipPath: string | null;
    cleanup?: 'cleaned' | 'failed-recovery-ledger-retained' | 'unknown';
    cleanupError?: unknown;
    cleanupMs?: number;
    cause?: unknown;
  }) {
    super(details.message, { cause: details.cause });
    this.name = 'OwnedNativeCommandAcquisitionError';
    this.pid = details.pid;
    this.pgid = details.pgid;
    this.logPath = details.logPath;
    this.stdoutPath = details.stdoutPath;
    this.ownershipPath = details.ownershipPath;
    this.cleanup = details.cleanup ?? 'failed-recovery-ledger-retained';
    this.cleanupError = details.cleanupError;
    this.cleanupMs = details.cleanupMs ?? 0;
  }
}

type NativeCommandPhase = 'step' | 'build';

/** The historical execFile maxBuffer bound used by native capture steps. */
export const ownedNativeCommandOutputMaxBytes = 16 * 1024 * 1024;

/**
 * A successful command can legitimately emit no stderr. The private command
 * artifact still needs a truthful, non-empty record for downstream ownership
 * and byte-integrity checks; this marker records absence of diagnostics and is
 * never mixed into a command that emitted bytes or failed.
 */
const noDiagnosticOutputMarker = Buffer.from('owned-command: no diagnostic output\n');

const leaderHandshakeRelease = Buffer.from([0x1f]);

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Keep one directly owned POSIX leader alive until the host census observes it.
 * After the release byte the shell uses POSIX exec, so the target inherits the
 * same PID, PGID, start time, stdin, stdout and stderr. The script is private
 * and contains shell-quoted command data instead of exposing target argv in a
 * process-list command line.
 */
export function buildLeaderHandshakeScript(command: string, argv: readonly string[]) {
  const target = [command, ...argv].map(shellQuote).join(' ');
  return `#!/bin/sh
release_hex=$(/bin/dd bs=1 count=1 2>/dev/null | /usr/bin/od -An -t x1 | /usr/bin/tr -d '[:space:]')
if [ "$release_hex" != '1f' ]; then
  exit 125
fi
exec ${target}
`;
}

async function requireObservedLeader(
  child: ReturnType<typeof spawn>,
  group: Awaited<ReturnType<typeof trackOwnedProcessGroup>>,
  settle: OwnedCommandCensusSettleOptions,
) {
  for (;;) {
    settle.signal?.throwIfAborted();
    const observed = await group.capture(true, settle);
    if (observed.some((row) => row.pid === child.pid && row.pgid === child.pid)) return true;
    const remainingMs = Math.floor(settle.untilMonotonicMs - performance.now());
    if (remainingMs <= 0) throw new Error('Owned worker leader handshake was not observed');
    await delay(Math.min(settle.delayMs ?? 25, remainingMs), undefined, {
      signal: settle.signal,
    });
  }
}

async function hasOwnedLeaderProof(ownershipPath: string, pid: number): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(ownershipPath, 'utf8')) as {
      processes?: unknown;
    };
    if (!Array.isArray(parsed.processes)) return false;
    return parsed.processes.some((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const row = value as Record<string, unknown>;
      return (
        row.pid === pid &&
        row.pgid === pid &&
        typeof row.started === 'string' &&
        row.started.length > 0 &&
        typeof row.commandHash === 'string' &&
        /^[a-f0-9]{64}$/.test(row.commandHash)
      );
    });
  } catch {
    return false;
  }
}

function normalizeAcquisitionFailure(
  error: unknown,
  deadlineAtMonotonicMs: number | undefined,
  signal: AbortSignal | undefined,
) {
  if (error instanceof OwnedNativeCommandError) return error;
  if (signal?.aborted)
    return new OwnedNativeCommandError('cancelled', 'Native leader handshake cancelled');
  if (deadlineAtMonotonicMs !== undefined && performance.now() >= deadlineAtMonotonicMs)
    return new OwnedNativeCommandError('deadline', 'Native leader handshake deadline');
  return error;
}

export type NativeCommandOutputFailure = {
  reason: 'limit' | 'io';
  stream: 'stdout' | 'stderr';
  bytes: number;
  message: string;
};

function requireDeadline(deadlineMs: number, phase: NativeCommandPhase = 'step') {
  if (!['step', 'build'].includes(phase)) throw new Error('Invalid native command phase');
  const cap = phase === 'build' ? 900_000 : 600_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > cap)
    throw new Error('Invalid native command deadline');
}

function requirePrivateStdoutPath(
  artifactRoot: string,
  logPath: string,
  requestedPath: string,
): string {
  const stdoutPath = path.resolve(requestedPath);
  if (path.dirname(stdoutPath) !== artifactRoot || stdoutPath === logPath) {
    throw new Error(
      'Native command stdout capture must be a distinct direct child of the private artifact root',
    );
  }
  return stdoutPath;
}

async function openExclusiveStream(filePath: string) {
  const stream = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    stream.once('open', () => resolve());
    stream.once('error', reject);
  });
  return stream;
}

/** A private log plus directly spawned, bounded and census-tracked POSIX group. */
export async function startOwnedNativeCommand(options: {
  command: string;
  argv: string[];
  artifactRoot: string;
  label: string;
  env: NodeJS.ProcessEnv;
  cwd?: string;
  input?: string;
  phase?: NativeCommandPhase;
  /** Keep a bounded launcher alive until its real leader is census-observed. */
  leaderHandshake?: boolean;
  /** The caller's command deadline bounds leader acquisition; direct callers may omit it. */
  deadlineMs?: number;
  /** Absolute monotonic caller deadline for one acquisition/execution budget. */
  deadlineAtMonotonicMs?: number;
  /** Explicit initial ownership-census budget; does not enable a leader handshake. */
  initialOwnershipDeadlineAtMonotonicMs?: number;
  /** Abort the bounded leader acquisition without changing the command contract. */
  signal?: AbortSignal;
  /** Optional direct-child private file for binary stdout capture. */
  stdoutPath?: string;
}) {
  const phase = options.phase ?? 'step';
  const leaderHandshake = options.leaderHandshake ?? false;
  if (!['step', 'build'].includes(phase)) throw new Error('Invalid native command phase');
  if (options.deadlineMs !== undefined) requireDeadline(options.deadlineMs, phase);
  if (
    options.initialOwnershipDeadlineAtMonotonicMs !== undefined &&
    !Number.isFinite(options.initialOwnershipDeadlineAtMonotonicMs)
  )
    throw new Error('Invalid native command initial ownership deadline');
  if (!/^[a-z0-9-]+$/.test(options.label)) throw new Error('Unsafe native command label');
  const acquisitionStartedAtMonotonicMs = performance.now();
  const leaderHandshakeDeadlineAtMonotonicMs = leaderHandshake
    ? (options.deadlineAtMonotonicMs ??
      (options.deadlineMs === undefined
        ? undefined
        : acquisitionStartedAtMonotonicMs + options.deadlineMs))
    : undefined;
  if (
    leaderHandshake &&
    (leaderHandshakeDeadlineAtMonotonicMs === undefined ||
      !Number.isFinite(leaderHandshakeDeadlineAtMonotonicMs))
  )
    throw new Error('Leader handshake requires the caller command deadline');
  const initialOwnershipDeadlineAtMonotonicMs =
    options.initialOwnershipDeadlineAtMonotonicMs ??
    (leaderHandshake ? leaderHandshakeDeadlineAtMonotonicMs : undefined);
  const assertInitialOwnershipBudget = () => {
    options.signal?.throwIfAborted();
    if (
      initialOwnershipDeadlineAtMonotonicMs !== undefined &&
      performance.now() >= initialOwnershipDeadlineAtMonotonicMs
    )
      throw new OwnedNativeCommandError(
        'deadline',
        `Native ${options.label} initial ownership deadline`,
      );
  };
  const root = await realpath(options.artifactRoot);
  const metadata = await lstat(root);
  if (
    root !== path.resolve(options.artifactRoot) ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error('Native command artifacts must be canonical, private and owned');
  const logPath = path.join(root, `${options.label}.private.log`);
  if (
    options.stdoutPath !== undefined &&
    (typeof options.stdoutPath !== 'string' || options.stdoutPath.length === 0)
  )
    throw new Error('Native command stdout capture path must be a non-empty string');
  const stdoutPath =
    options.stdoutPath === undefined
      ? undefined
      : requirePrivateStdoutPath(root, logPath, options.stdoutPath);
  const boundedOutput = stdoutPath !== undefined;
  let stream: ReturnType<typeof createWriteStream> | undefined;
  let stdoutStream: ReturnType<typeof createWriteStream> | undefined;
  let logCreated = false;
  let stdoutCreated = false;
  try {
    assertInitialOwnershipBudget();
    // Open exclusive artifacts before spawning any process. If the optional
    // binary target collides, remove only files created by this acquisition.
    stream = await openExclusiveStream(logPath);
    logCreated = true;
    if (stdoutPath) {
      stdoutStream = await openExclusiveStream(stdoutPath);
      stdoutCreated = true;
    }
    assertInitialOwnershipBudget();
  } catch (error) {
    stream?.destroy();
    stdoutStream?.destroy();
    if (logCreated) await rm(logPath, { force: true }).catch(() => undefined);
    if (stdoutCreated && stdoutPath) await rm(stdoutPath, { force: true }).catch(() => undefined);
    throw error;
  }
  if (!stream) throw new Error('Native command log was not opened');
  const logStream = stream;
  const launcherScriptPath = leaderHandshake
    ? path.join(root, `${options.label}.launcher.private.sh`)
    : undefined;
  let launcherScriptCreated = false;
  try {
    if (launcherScriptPath) {
      await writeFile(
        launcherScriptPath,
        buildLeaderHandshakeScript(options.command, options.argv),
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
      launcherScriptCreated = true;
    }
    // The acquisition budget includes artifact and launcher setup. Check
    // immediately before spawn so an expired budget can never create an
    // untracked native child; the catch below removes only this attempt's
    // private artifacts.
    assertInitialOwnershipBudget();
  } catch (error) {
    if (launcherScriptCreated && launcherScriptPath)
      await rm(launcherScriptPath, { force: true }).catch(() => undefined);
    stream.destroy();
    stdoutStream?.destroy();
    if (logCreated) await rm(logPath, { force: true }).catch(() => undefined);
    if (stdoutCreated && stdoutPath) await rm(stdoutPath, { force: true }).catch(() => undefined);
    throw error;
  }
  const child = leaderHandshake
    ? spawn('/bin/sh', [launcherScriptPath!], {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    : spawn(options.command, options.argv, {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
  child.stdin.on('error', () => undefined);
  const closed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  // A detached command can exit while a descendant outside its process group
  // retains an inherited stdio descriptor. In that case Node never emits
  // `close`, even though the owned process group is already absent. `exit`
  // still reports the command's real status; cleanup later closes our local
  // streams and independently verifies the owned group is gone.
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  void closed.catch(() => undefined);
  let outputFailure: NativeCommandOutputFailure | undefined;
  let successfulWait = false;
  let rejectOutputFailure: (error: OwnedNativeCommandError) => void = () => undefined;
  const outputFailurePromise = new Promise<never>((_, reject) => {
    rejectOutputFailure = reject;
  });
  // A caller may stop a command without waiting; the failure remains available
  // through outputFailure() without producing an unhandled rejection.
  void outputFailurePromise.catch(() => undefined);
  let outputStopped = false;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const failOutput = (failure: NativeCommandOutputFailure) => {
    if (outputFailure) return;
    outputFailure = failure;
    rejectOutputFailure(
      new OwnedNativeCommandError(
        failure.reason === 'limit' ? 'output-limit' : 'output-failed',
        `Native ${options.label} ${failure.stream} output ${failure.reason}: ${failure.message}`,
      ),
    );
    child.stdout.pause();
    child.stderr.pause();
  };
  const attachOutput = (
    source: NodeJS.ReadableStream,
    target: ReturnType<typeof createWriteStream>,
    streamName: 'stdout' | 'stderr',
  ) => {
    let bytes = streamName === 'stdout' ? stdoutBytes : stderrBytes;
    let pausedForBackpressure = false;
    const onDrain = () => {
      pausedForBackpressure = false;
      if (!outputFailure && !outputStopped) source.resume();
    };
    const onData = (chunk: Buffer | string) => {
      if (outputFailure || outputStopped) return;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const nextBytes = bytes + data.byteLength;
      const remaining = Math.max(0, ownedNativeCommandOutputMaxBytes - bytes);
      try {
        if (boundedOutput && data.byteLength > remaining) {
          if (remaining > 0) target.write(data.subarray(0, remaining));
          bytes = nextBytes;
          if (streamName === 'stdout') stdoutBytes = bytes;
          else stderrBytes = bytes;
          failOutput({
            reason: 'limit',
            stream: streamName,
            bytes,
            message: `exceeded ${ownedNativeCommandOutputMaxBytes} bytes`,
          });
          source.pause();
          return;
        }
        bytes = nextBytes;
        if (streamName === 'stdout') stdoutBytes = bytes;
        else stderrBytes = bytes;
        if (!target.write(data)) {
          pausedForBackpressure = true;
          source.pause();
          target.once('drain', onDrain);
        }
      } catch (error) {
        failOutput({
          reason: 'io',
          stream: streamName,
          bytes,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    const onSourceError = (error: Error) => {
      if (!outputStopped)
        failOutput({
          reason: 'io',
          stream: streamName,
          bytes,
          message: error.message,
        });
    };
    const onTargetError = (error: Error) => {
      failOutput({
        reason: 'io',
        stream: streamName,
        bytes,
        message: error.message,
      });
    };
    source.on('data', onData);
    source.on('error', onSourceError);
    target.on('error', onTargetError);
    const stopSource = () => {
      source.removeListener('data', onData);
      source.removeListener('error', onSourceError);
      if (pausedForBackpressure) target.removeListener('drain', onDrain);
    };
    return {
      stopSource,
      detach: () => {
        stopSource();
        target.removeListener('error', onTargetError);
      },
    };
  };
  const stdoutOutput = attachOutput(child.stdout, stdoutStream ?? logStream, 'stdout');
  const stderrOutput = attachOutput(child.stderr, logStream, 'stderr');
  const stopOutput = () => {
    outputStopped = true;
    child.stdout.pause();
    child.stderr.pause();
    stdoutOutput.stopSource();
    stderrOutput.stopSource();
  };
  const finishOutputStream = async (
    target: ReturnType<typeof createWriteStream>,
    streamName: 'stdout' | 'stderr',
    bytes: number,
  ) => {
    if (target.destroyed) {
      if (!target.writableFinished && !outputFailure)
        failOutput({
          reason: 'io',
          stream: streamName,
          bytes,
          message: 'output stream closed before flush completed',
        });
      if (!target.closed)
        await new Promise<void>((resolve) => {
          if (target.closed) resolve();
          else target.once('close', resolve);
        });
      return;
    }
    await new Promise<void>((resolve) => {
      let finished = target.writableFinished;
      let closed = target.closed;
      const cleanup = () => {
        target.removeListener('finish', onFinish);
        target.removeListener('close', onClose);
        target.removeListener('error', onError);
      };
      const settle = () => {
        if (!closed) return;
        if (!finished && !outputFailure)
          failOutput({
            reason: 'io',
            stream: streamName,
            bytes,
            message: 'output stream closed before flush completed',
          });
        cleanup();
        resolve();
      };
      const onFinish = () => {
        finished = true;
        settle();
      };
      const onClose = () => {
        closed = true;
        if (!finished && !outputFailure)
          failOutput({
            reason: 'io',
            stream: streamName,
            bytes,
            message: 'output stream closed before flush completed',
          });
        settle();
      };
      const onError = (error: Error) => {
        failOutput({
          reason: 'io',
          stream: streamName,
          bytes,
          message: error.message,
        });
        closed = target.closed;
        settle();
      };
      target.once('finish', onFinish);
      target.once('close', onClose);
      target.once('error', onError);
      if (finished && closed) settle();
      try {
        target.end();
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        try {
          target.destroy(error instanceof Error ? error : new Error(String(error)));
        } catch {
          // The stream is already terminal; retain the output failure above.
        }
        closed = target.closed;
        settle();
      }
    });
  };
  const finishOutput = async (allowNoDiagnosticMarker = false) => {
    if (
      allowNoDiagnosticMarker &&
      !outputFailure &&
      successfulWait &&
      child.exitCode === 0 &&
      child.signalCode === null &&
      (stdoutStream ? stderrBytes === 0 : stdoutBytes === 0 && stderrBytes === 0)
    ) {
      try {
        logStream.write(noDiagnosticOutputMarker);
      } catch (error) {
        failOutput({
          reason: 'io',
          stream: 'stderr',
          bytes: 0,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const targets = stdoutStream
      ? [
          finishOutputStream(logStream, 'stderr', stderrBytes),
          finishOutputStream(stdoutStream, 'stdout', stdoutBytes),
        ]
      : [finishOutputStream(logStream, 'stderr', stderrBytes)];
    await Promise.all(targets);
    stdoutOutput.detach();
    stderrOutput.detach();
  };
  let group: Awaited<ReturnType<typeof trackOwnedProcessGroup>> | undefined;
  let ownershipEstablished = false;
  const ownershipPath = path.join(root, `${options.label}.ownership.json`);
  try {
    const initialSettle =
      initialOwnershipDeadlineAtMonotonicMs !== undefined
        ? {
            untilMonotonicMs: initialOwnershipDeadlineAtMonotonicMs,
            signal: options.signal,
          }
        : undefined;
    group = await trackOwnedProcessGroup(child, ownershipPath, phase, initialSettle);
    ownershipEstablished = await hasOwnedLeaderProof(ownershipPath, child.pid!);
    if (leaderHandshake) {
      const startupDeadlineAtMonotonicMs = leaderHandshakeDeadlineAtMonotonicMs!;
      if (startupDeadlineAtMonotonicMs <= performance.now())
        throw new OwnedNativeCommandError(
          'deadline',
          'Leader handshake caller deadline elapsed before census',
        );
      await requireObservedLeader(child, group, {
        untilMonotonicMs: startupDeadlineAtMonotonicMs,
        delayMs: 25,
        maxRequeries: 8,
        signal: options.signal,
      });
      ownershipEstablished = true;
      options.signal?.throwIfAborted();
      if (startupDeadlineAtMonotonicMs - performance.now() < 100)
        throw new OwnedNativeCommandError(
          'deadline',
          'Leader handshake caller deadline elapsed before release',
        );
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(leaderHandshakeRelease, (error?: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(launcherScriptPath!, { force: true });
      launcherScriptCreated = false;
    }
    // A census that completes at the edge of the initial budget still owns a
    // live child until this check. Stop it through the owned group instead of
    // allowing a direct caller to run beyond the acquisition deadline.
    assertInitialOwnershipBudget();
  } catch (error) {
    const primaryError = normalizeAcquisitionFailure(
      error,
      leaderHandshakeDeadlineAtMonotonicMs ?? options.initialOwnershipDeadlineAtMonotonicMs,
      options.signal,
    );
    const cleanupStartedAtMonotonicMs = performance.now();
    let cleanupError: unknown;
    if (leaderHandshake && !ownershipEstablished)
      ownershipEstablished = await hasOwnedLeaderProof(ownershipPath, child.pid!);
    if (ownershipEstablished && group) {
      try {
        await group.stop();
      } catch (error) {
        cleanupError = error;
      }
    } else if (child.exitCode === null && child.signalCode === null) {
      // A missing census grants no signal authority for the group. Close the
      // launcher's stdin and retain the running ledger rather than claiming a
      // clean group release from an empty observation.
      child.stdin.end();
      child.kill('SIGTERM');
    }
    if (launcherScriptCreated && launcherScriptPath)
      await rm(launcherScriptPath, { force: true }).catch(() => undefined);
    try {
      stopOutput();
      child.stdout.destroy();
      child.stderr.destroy();
      await finishOutput();
    } catch (finalizeError) {
      cleanupError ??= finalizeError;
    }
    if (!ownershipEstablished || cleanupError !== undefined) child.unref();
    const cleanupMs = performance.now() - cleanupStartedAtMonotonicMs;
    throw new OwnedNativeCommandAcquisitionError({
      message:
        primaryError instanceof Error
          ? primaryError.message
          : 'Owned native command ownership census failed',
      pid: child.pid ?? null,
      pgid: child.pid ?? null,
      logPath,
      stdoutPath: stdoutPath ?? null,
      ownershipPath,
      // Preserve the acquisition failure as the primary cause. Strict cleanup
      // is a separate fact and must never turn a deadline/cancellation into a
      // generic harness block.
      cleanup:
        ownershipEstablished && group
          ? cleanupError === undefined
            ? 'cleaned'
            : 'failed-recovery-ledger-retained'
          : 'failed-recovery-ledger-retained',
      cleanupError,
      cleanupMs,
      cause: primaryError,
    });
  }
  if (!group) throw new Error('Owned native command group was not acquired');
  child.stdin.end(options.input);
  let censusFailure: Error | undefined;
  let censusPublication: Promise<void> | undefined;
  let censusDiagnostic:
    | {
        at: string;
        errorClass: string;
        message: string;
        publication: 'pending' | 'written' | 'failed';
        queryFailure?: ProcessCensusQueryFailure;
      }
    | undefined;
  let captureRunning = false;
  const census = setInterval(() => {
    if (captureRunning || censusFailure) return;
    captureRunning = true;
    // Census gathers identities; permission to signal is checked strictly by
    // stop(). A short-lived descendant may exec and then exit naturally. Do
    // not turn that transient observation into a permanent command failure.
    void group
      .capture()
      .catch((error: unknown) => {
        censusFailure = error instanceof Error ? error : new Error(String(error));
        censusDiagnostic = {
          at: new Date().toISOString(),
          errorClass: censusFailure.name,
          message: censusFailure.message,
          publication: 'pending',
          ...(censusFailure instanceof OwnedProcessCensusQueryError
            ? { queryFailure: structuredClone(censusFailure.queryFailure) }
            : {}),
        };
        censusPublication = writeFile(
          path.join(root, `${options.label}.census-failure.private.json`),
          JSON.stringify({
            kind: 'original native command census failure',
            label: options.label,
            pid: child.pid,
            pgid: group.pgid,
            ...censusDiagnostic,
          }),
          { flag: 'wx', mode: 0o600 },
        ).then(
          () => {
            censusDiagnostic!.publication = 'written';
          },
          () => {
            censusDiagnostic!.publication = 'failed';
          },
        );
      })
      .finally(() => {
        captureRunning = false;
      });
  }, 250);
  let stopping: Promise<void> | undefined;
  const stop = (settle?: OwnedCommandCensusSettleOptions) => {
    stopping ??= (async () => {
      clearInterval(census);
      let releaseFailed = false;
      try {
        await group.stop(settle);
      } catch (error) {
        releaseFailed = true;
        throw error;
      } finally {
        await censusPublication;
        stopOutput();
        child.stdout.destroy();
        child.stderr.destroy();
        await finishOutput(!releaseFailed && !censusFailure);
        // A retained resource must not keep its failed controller alive. Its
        // ownership ledger and failed cleanup remain; no new signal is sent.
        if (releaseFailed) child.unref();
      }
    })();
    return stopping;
  };
  const wait = async (
    deadlineMs: number,
    signal?: AbortSignal,
    phase: NativeCommandPhase = 'step',
  ) => {
    requireDeadline(deadlineMs, phase);
    if (signal?.aborted)
      throw new OwnedNativeCommandError('cancelled', `Native ${options.label} cancelled`);
    let rejectBound: (error: Error) => void = () => undefined;
    const bound = new Promise<never>((_, reject) => {
      rejectBound = reject;
    });
    const timer = setTimeout(
      () =>
        rejectBound(new OwnedNativeCommandError('deadline', `Native ${options.label} deadline`)),
      deadlineMs,
    );
    const abort = () =>
      rejectBound(new OwnedNativeCommandError('cancelled', `Native ${options.label} cancelled`));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await Promise.race([closed, exited, bound, outputFailurePromise]);
      if (censusFailure)
        throw new OwnedNativeCommandError('census-failed', `Native ${options.label} census failed`);
      if (result.code !== 0 || result.signal)
        throw new OwnedNativeCommandError(
          'child-failed',
          `Native ${options.label} failed: ${result.code ?? result.signal}`,
        );
      successfulWait = true;
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
  return {
    pid: child.pid!,
    pgid: group.pgid,
    logPath,
    stdoutPath: stdoutPath ?? null,
    capture: group.capture,
    stop,
    wait,
    closed,
    outcome: () => ({ code: child.exitCode, signal: child.signalCode }),
    censusFailure: () => (censusDiagnostic ? structuredClone(censusDiagnostic) : null),
    outputFailure: () => (outputFailure ? structuredClone(outputFailure) : null),
  };
}

export type NativeCommandExecution = {
  phase: NativeCommandPhase;
  execution: 'completed' | 'child-failed' | 'deadline' | 'cancelled' | 'harness-blocked';
  cleanup: 'not-acquired' | 'cleaned' | 'failed-recovery-ledger-retained' | 'unknown';
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  pid: number | null;
  pgid: number | null;
  logPath: string | null;
  stdoutPath: string | null;
  ownershipPath: string | null;
  elapsedMs: number;
  cleanupMs: number;
  censusFailure?: ReturnType<Awaited<ReturnType<typeof startOwnedNativeCommand>>['censusFailure']>;
  outputFailure?: ReturnType<Awaited<ReturnType<typeof startOwnedNativeCommand>>['outputFailure']>;
};

/** Terminal engine command record only; assertions and scenario completion belong to the caller. */
export async function executeOwnedNativeCommand(
  options: Parameters<typeof startOwnedNativeCommand>[0] & {
    deadlineMs: number;
    phase?: NativeCommandPhase;
    signal?: AbortSignal;
    onStarted?: (child: Awaited<ReturnType<typeof startOwnedNativeCommand>>) => void;
  },
): Promise<NativeCommandExecution> {
  // Reject invalid requests before opening a log or acquiring a process.
  const phase = options.phase ?? 'step';
  requireDeadline(options.deadlineMs, phase);
  const start = performance.now();
  if (
    options.deadlineAtMonotonicMs !== undefined &&
    !Number.isFinite(options.deadlineAtMonotonicMs)
  )
    throw new Error('Invalid native command absolute deadline');
  // A whole-run absolute deadline must never enlarge this command's phase budget.
  // Acquisition and execution share the same anchored, shorter deadline.
  const deadlineAtMonotonicMs = Math.min(
    options.deadlineAtMonotonicMs ?? Infinity,
    start + options.deadlineMs,
  );
  const result: NativeCommandExecution = {
    phase,
    execution: options.signal?.aborted ? 'cancelled' : 'harness-blocked',
    cleanup: 'not-acquired',
    childExitCode: null,
    childSignal: null,
    pid: null,
    pgid: null,
    logPath: null,
    stdoutPath: null,
    ownershipPath: null,
    elapsedMs: 0,
    cleanupMs: 0,
    censusFailure: null,
    outputFailure: null,
  };
  if (options.signal?.aborted) return result;
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>>;
  try {
    // Validate before clamping without changing the existing acquisition-failure contract.
    if (
      options.initialOwnershipDeadlineAtMonotonicMs !== undefined &&
      !Number.isFinite(options.initialOwnershipDeadlineAtMonotonicMs)
    )
      throw new Error('Invalid native command initial ownership deadline');
    child = await startOwnedNativeCommand({
      ...options,
      phase,
      deadlineAtMonotonicMs,
      initialOwnershipDeadlineAtMonotonicMs:
        options.initialOwnershipDeadlineAtMonotonicMs === undefined
          ? undefined
          : Math.min(options.initialOwnershipDeadlineAtMonotonicMs, deadlineAtMonotonicMs),
      // Android capture opts in at its producer boundary. Keep the shared
      // command helper's historical default for iOS and generic callers.
      leaderHandshake: options.leaderHandshake ?? false,
    });
  } catch (error) {
    // The lower-level acquisition may have spawned a process before failing.
    // Without an ownership handle, neither no-acquisition nor cleanup is proven.
    if (error instanceof OwnedNativeCommandAcquisitionError) {
      result.cleanup = error.cleanup;
      result.pid = error.pid;
      result.pgid = error.pgid;
      result.logPath = error.logPath;
      result.stdoutPath = error.stdoutPath;
      result.ownershipPath = error.ownershipPath;
      result.cleanupMs = error.cleanupMs;
    } else {
      result.cleanup = 'unknown';
    }
    const cause = error instanceof OwnedNativeCommandAcquisitionError ? error.cause : error;
    if (cause instanceof OwnedNativeCommandError) {
      result.execution =
        cause.reason === 'deadline' ||
        cause.reason === 'cancelled' ||
        cause.reason === 'child-failed'
          ? cause.reason
          : 'harness-blocked';
    }
    result.elapsedMs = performance.now() - start;
    return result;
  }
  result.pid = child.pid;
  result.pgid = child.pgid;
  result.logPath = child.logPath;
  result.stdoutPath = child.stdoutPath;
  result.ownershipPath = path.join(options.artifactRoot, `${options.label}.ownership.json`);
  try {
    options.onStarted?.(child);
    const remainingDeadlineMs = Math.floor(deadlineAtMonotonicMs - performance.now());
    if (remainingDeadlineMs < 100)
      throw new OwnedNativeCommandError(
        'deadline',
        `Native ${options.label} deadline elapsed before execution wait`,
      );
    await child.wait(remainingDeadlineMs, options.signal, phase);
    result.execution = 'completed';
  } catch (error) {
    if (error instanceof OwnedNativeCommandError) {
      result.execution =
        error.reason === 'deadline' ||
        error.reason === 'cancelled' ||
        error.reason === 'child-failed'
          ? error.reason
          : 'harness-blocked';
    } else {
      result.execution = 'harness-blocked';
    }
  } finally {
    const cleanupStart = performance.now();
    try {
      await child.stop();
      result.cleanup = 'cleaned';
    } catch {
      result.cleanup = 'failed-recovery-ledger-retained';
    }
    result.cleanupMs = performance.now() - cleanupStart;
    result.elapsedMs = performance.now() - start;
    // Never wait unboundedly for a failed-cleanup child. A completed close is
    // independently available even if descendant cleanup failed.
    const outcome = child.outcome();
    result.childExitCode = outcome.code;
    result.childSignal = outcome.signal;
    const diagnostic = child.censusFailure();
    if (diagnostic) result.censusFailure = diagnostic;
    const outputDiagnostic = child.outputFailure();
    if (outputDiagnostic) {
      result.outputFailure = outputDiagnostic;
      // A late artifact I/O failure is a harness block even when the child
      // itself exited zero. Preserve childExitCode/childSignal and cleanup as
      // independent facts for callers.
      result.execution = 'harness-blocked';
    }
  }
  return result;
}

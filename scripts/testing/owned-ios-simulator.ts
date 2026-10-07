import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export type IosDeviceIdentity = {
  udid: string;
  name: string;
  deviceTypeIdentifier: string;
  runtime: string;
};
type Device = IosDeviceIdentity & { state: string; isAvailable: boolean };
type BootstrapPhase = 'create' | 'boot' | 'bootstatus' | 'verify';

/** Overrides may shorten the existing bound; they cannot extend acquisition. */
export function iosSimulatorBootstatusDeadline(value = 180_000) {
  if (!Number.isSafeInteger(value) || value < 1000 || value > 180_000)
    throw new Error('Invalid simulator bootstatus deadline');
  return value;
}

export function parseIosSimulatorBootstatusDeadline(value: string | undefined) {
  if (value === undefined) return iosSimulatorBootstatusDeadline();
  if (!/^[1-9][0-9]{3,5}$/.test(value)) throw new Error('Invalid simulator bootstatus deadline');
  return iosSimulatorBootstatusDeadline(Number(value));
}

/** Private diagnostic fields only; missing exit status is unknown, never successful. */
export function iosSimulatorBootstrapFailure(
  error: unknown,
  options: {
    phase: BootstrapPhase;
    identity: IosDeviceIdentity | undefined;
    elapsedMs: number;
    aborted: boolean;
    deviceState?: string | null;
    bootstatusDeadlineMs?: number;
  },
) {
  const row = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const bounded = (value: unknown) => (typeof value === 'string' ? value.slice(0, 65536) : null);
  const deadlineMs =
    options.phase === 'bootstatus'
      ? iosSimulatorBootstatusDeadline(options.bootstatusDeadlineMs)
      : options.phase === 'verify'
        ? 15_000
        : 30_000;
  const failureReason = options.aborted
    ? 'cancelled'
    : row.killed === true && row.signal === 'SIGTERM' && options.elapsedMs >= deadlineMs
      ? 'deadline'
      : 'bootstrap-failed';
  return {
    kind: 'owned simulator bootstrap failure; not application evidence',
    phase: options.phase,
    identity: options.identity ?? null,
    deviceStateBeforeCleanup: options.deviceState ?? null,
    elapsedMs: options.elapsedMs,
    deadlineMs,
    failureReason,
    aborted: options.aborted,
    exitCode: typeof row.code === 'number' ? row.code : null,
    errorCode: typeof row.code === 'string' ? row.code : null,
    signal: bounded(row.signal),
    killed: typeof row.killed === 'boolean' ? row.killed : null,
    message: bounded(row.message),
    stdout: bounded(row.stdout),
    stderr: bounded(row.stderr),
  };
}

export class IosSimulatorBootstrapError extends Error {
  constructor(
    readonly failure: {
      phase: BootstrapPhase;
      identity: IosDeviceIdentity | null;
      failureReason: string;
      deadlineMs: number;
      elapsedMs: number;
    },
  ) {
    super(`Owned simulator ${failure.phase}: ${failure.failureReason}`);
    this.name = 'IosSimulatorBootstrapError';
  }
}

export function validateIosDeviceOwnership(
  expected: IosDeviceIdentity,
  actual: Device | undefined,
) {
  if (
    !actual ||
    !/^[A-Fa-f0-9-]{36}$/.test(expected.udid) ||
    !/^MyChampions-Pilot-[a-f0-9]{24}$/.test(expected.name) ||
    actual.udid !== expected.udid ||
    actual.name !== expected.name ||
    actual.deviceTypeIdentifier !== expected.deviceTypeIdentifier ||
    actual.runtime !== expected.runtime
  )
    throw new Error('Owned simulator identity changed; recovery retained');
}

async function devices(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { stdout } = await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
    timeout: 15_000,
    signal,
    maxBuffer: 4 * 1024 * 1024,
  });
  const value = JSON.parse(stdout) as { devices: Record<string, Omit<Device, 'runtime'>[]> };
  if (!value.devices || typeof value.devices !== 'object')
    throw new Error('Simulator inventory unavailable');
  return Object.entries(value.devices).flatMap(([runtime, rows]) => {
    if (!Array.isArray(rows)) throw new Error('Invalid simulator inventory');
    return rows.map((row) => ({ ...row, runtime }));
  });
}

/** Action readiness is stricter than cleanup ownership, which permits Shutdown. */
export function validateBootedIosDevice(expected: IosDeviceIdentity, actual: Device | undefined) {
  validateIosDeviceOwnership(expected, actual);
  if (actual?.state !== 'Booted' || actual.isAvailable !== true)
    throw new Error('Owned simulator is not booted and available; no native action permitted');
}

/** Only creates a new simulator; existing/foreign devices are never adopted. */
export async function acquireOwnedIosSimulator(options: {
  artifactRoot: string;
  deviceTypeIdentifier: string;
  runtime: string;
  signal?: AbortSignal;
  bootstatusDeadlineMs?: number;
}) {
  const bootstatusDeadlineMs = iosSimulatorBootstatusDeadline(options.bootstatusDeadlineMs);
  if (process.platform !== 'darwin') throw new Error('iOS simulator requires macOS');
  const root = await realpath(options.artifactRoot);
  const meta = await lstat(root);
  if (
    root !== path.resolve(options.artifactRoot) ||
    (meta.mode & 0o777) !== 0o700 ||
    meta.uid !== process.getuid?.()
  )
    throw new Error('Native artifact root is not private and owned');
  const name = `MyChampions-Pilot-${randomBytes(12).toString('hex')}`;
  const before = await devices(options.signal);
  const ownerFile = path.join(root, 'simulator-owner.private.json');
  let identity: IosDeviceIdentity | undefined;
  let ownerBytes = '';
  let cleanup: Promise<void> | undefined;
  let bootstrapPhase: BootstrapPhase = 'create';
  let phaseStarted = performance.now();
  const intent = {
    artifactRoot: root,
    uid: meta.uid,
    name,
    deviceTypeIdentifier: options.deviceTypeIdentifier,
    runtime: options.runtime,
    previousDevices: before.map((row) => row.udid),
  };
  await writeFile(ownerFile, JSON.stringify({ ...intent, state: 'creating' }), {
    flag: 'wx',
    mode: 0o600,
  });
  const verify = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const currentRoot = await lstat(root);
    if (
      !currentRoot.isDirectory() ||
      currentRoot.isSymbolicLink() ||
      currentRoot.dev !== meta.dev ||
      currentRoot.ino !== meta.ino ||
      currentRoot.uid !== meta.uid ||
      (currentRoot.mode & 0o777) !== 0o700 ||
      (await realpath(root)) !== root
    )
      throw new Error('Simulator artifact root changed; recovery retained');
    const marker = await lstat(ownerFile);
    if (
      marker.isSymbolicLink() ||
      !marker.isFile() ||
      (marker.mode & 0o777) !== 0o600 ||
      marker.uid !== meta.uid ||
      (await realpath(ownerFile)) !== ownerFile ||
      (await readFile(ownerFile, { encoding: 'utf8', signal })) !== ownerBytes ||
      !identity
    )
      throw new Error('Simulator ownership record changed; recovery retained');
    validateIosDeviceOwnership(
      identity,
      (await devices(signal)).find((row) => row.udid === identity!.udid),
    );
    signal?.throwIfAborted();
  };
  const stop = () => {
    cleanup ??= (async () => {
      await verify();
      const current = (await devices()).find((row) => row.udid === identity!.udid)!;
      if (current.state !== 'Shutdown')
        await execute('xcrun', ['simctl', 'shutdown', identity!.udid], { timeout: 30_000 });
      await verify();
      await execute('xcrun', ['simctl', 'delete', identity!.udid], { timeout: 30_000 });
      if ((await devices()).some((row) => row.udid === identity!.udid))
        throw new Error('Owned simulator remains after deletion');
      await writeFile(
        path.join(root, 'simulator-cleanup.json'),
        JSON.stringify({
          status: 'cleaned',
          identity,
          foreignDevicesPreserved: before.map((row) => row.udid),
        }),
        { mode: 0o600 },
      );
    })();
    return cleanup;
  };
  try {
    options.signal?.throwIfAborted();
    const { stdout } = await execute(
      'xcrun',
      ['simctl', 'create', name, options.deviceTypeIdentifier, options.runtime],
      { timeout: 30_000, signal: options.signal },
    );
    const udid = stdout.trim();
    if (!/^[A-Fa-f0-9-]{36}$/.test(udid) || before.some((row) => row.udid === udid))
      throw new Error('New simulator identity unavailable; creation intent retained');
    identity = {
      udid,
      name,
      deviceTypeIdentifier: options.deviceTypeIdentifier,
      runtime: options.runtime,
    };
    ownerBytes = JSON.stringify({ ...intent, identity, state: 'owned' });
    await writeFile(ownerFile, ownerBytes, { mode: 0o600 });
    await verify(options.signal);
    options.signal?.throwIfAborted();
    bootstrapPhase = 'boot';
    phaseStarted = performance.now();
    await execute('xcrun', ['simctl', 'boot', udid], { timeout: 30_000, signal: options.signal });
    bootstrapPhase = 'bootstatus';
    phaseStarted = performance.now();
    await execute('xcrun', ['simctl', 'bootstatus', udid, '-b'], {
      timeout: bootstatusDeadlineMs,
      signal: options.signal,
    });
    bootstrapPhase = 'verify';
    phaseStarted = performance.now();
    await verify(options.signal);
    validateBootedIosDevice(
      identity,
      (await devices(options.signal)).find((row) => row.udid === identity!.udid),
    );
    return {
      ...identity,
      verify,
      inspect: async (signal?: AbortSignal) => {
        await verify(signal);
        const actual = (await devices(signal)).find((row) => row.udid === identity!.udid);
        validateIosDeviceOwnership(identity!, actual);
        return actual!;
      },
      stop,
      foreignBootedDevices: before.filter((row) => row.state === 'Booted').map((row) => row.udid),
    };
  } catch (error) {
    let deviceState: string | null = null;
    if (identity) {
      try {
        deviceState = (await devices()).find((row) => row.udid === identity!.udid)?.state ?? null;
      } catch {
        // An unavailable health observation remains unknown in the private receipt.
      }
    }
    const diagnostic = iosSimulatorBootstrapFailure(error, {
      phase: bootstrapPhase,
      identity,
      elapsedMs: performance.now() - phaseStarted,
      aborted: options.signal?.aborted ?? false,
      deviceState,
      bootstatusDeadlineMs,
    });
    try {
      await writeFile(
        path.join(root, 'simulator-bootstrap-failure.private.json'),
        JSON.stringify(diagnostic, null, 2),
        { flag: 'wx', mode: 0o600 },
      );
    } catch {
      // Missing diagnostic evidence cannot pass qualification; teardown still runs.
    } finally {
      if (identity) await stop();
    }
    throw new IosSimulatorBootstrapError({
      phase: diagnostic.phase,
      identity: diagnostic.identity,
      failureReason: diagnostic.failureReason,
      deadlineMs: diagnostic.deadlineMs,
      elapsedMs: diagnostic.elapsedMs,
    });
  }
}

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { reserveOwnedAndroidPort } from './owned-android-port';
import { startOwnedNativeCommand } from './owned-native-command';
import { androidRunnerSlotEnvironment, parseAndroidRunnerSlot } from '../ci/android-runner-slot';
import type { AndroidRunnerSlot } from '../ci/android-runner-slot';

const execute = promisify(execFile);
type Reservation = Awaited<ReturnType<typeof reserveOwnedAndroidPort>>;
type Command = Awaited<ReturnType<typeof startOwnedNativeCommand>>;
export type AndroidTargetIdentity = {
  avd: string;
  serial: string;
  nonce: string;
};

export const androidEmulatorLifecycleCaps = {
  avdCreationMs: 120_000,
  adbStartupMs: 10_000,
  bootMs: 180_000,
} as const;

/**
 * This is the local macOS image already exercised by the Android Maestro
 * pilot.  A controlled runner may override it, but an unset
 * environment must not turn a supported local Android lane into a manual
 * configuration prerequisite.
 */
export const defaultOwnedAndroidSystemImage =
  'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a';

const ownedAndroidSystemImagePattern =
  /^system-images;android-[0-9]+(?:\.[0-9]+)?;[a-z0-9_]+;arm64-v8a$/;

export function resolveOwnedAndroidSystemImage(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // The older MYCHAMPIONS_DETOX_ name is still read so existing runner hosts keep working.
  const configured = (
    env.MYCHAMPIONS_ANDROID_SYSTEM_IMAGE ?? env.MYCHAMPIONS_DETOX_ANDROID_SYSTEM_IMAGE
  )?.trim();
  const systemImage = configured || defaultOwnedAndroidSystemImage;
  if (!ownedAndroidSystemImagePattern.test(systemImage))
    throw new Error('Unsafe or unsupported local Android image');
  return systemImage;
}

export type AndroidEmulatorLifecycleDeadlines = {
  avdCreationMs: number;
  adbStartupMs: number;
  bootMs: number;
};

export function effectiveAndroidLifecycleDeadline(
  stepDeadlineMs: number | undefined,
  existingCapMs: number,
) {
  if (
    !Number.isSafeInteger(existingCapMs) ||
    existingCapMs < 1000 ||
    (stepDeadlineMs !== undefined &&
      (!Number.isSafeInteger(stepDeadlineMs) || stepDeadlineMs < 1000))
  )
    throw new Error('Invalid Android lifecycle deadline');
  return Math.min(stepDeadlineMs ?? existingCapMs, existingCapMs);
}

export function resolveAndroidEmulatorLifecycleDeadlines(
  stepDeadlineMs?: number,
): AndroidEmulatorLifecycleDeadlines {
  return {
    avdCreationMs: effectiveAndroidLifecycleDeadline(
      stepDeadlineMs,
      androidEmulatorLifecycleCaps.avdCreationMs,
    ),
    adbStartupMs: effectiveAndroidLifecycleDeadline(
      stepDeadlineMs,
      androidEmulatorLifecycleCaps.adbStartupMs,
    ),
    bootMs: effectiveAndroidLifecycleDeadline(stepDeadlineMs, androidEmulatorLifecycleCaps.bootMs),
  };
}

/** Dadb reads user.home/.android/adbkey; SDK ADB must use that same owned key. */
export function localAndroidPilotEnvironment(
  slot: AndroidRunnerSlot,
  sdkRoot: string,
): NodeJS.ProcessEnv {
  if (/\s/.test(slot.userHome)) throw new Error('Local Java home must not contain whitespace');
  const keyRoot = path.join(slot.userHome, '.android');
  return {
    ...process.env,
    ...androidRunnerSlotEnvironment(slot),
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_HOME: sdkRoot,
    ANDROID_USER_HOME: keyRoot,
    ANDROID_EMULATOR_HOME: keyRoot,
    ADB_MDNS_AUTO_CONNECT: '',
    ADB_VENDOR_KEYS: keyRoot,
    JAVA_OPTS: `-Duser.home=${slot.userHome}`,
    MAESTRO_OPTS: '',
  };
}

export function validateAndroidTargetIdentity(
  expected: AndroidTargetIdentity,
  actual: AndroidTargetIdentity,
) {
  if (
    !/^MyChampions-Pilot-[a-f0-9]{24}$/.test(expected.avd) ||
    !/^emulator-55(?:5[468]|[67][02468]|8[024])$/.test(expected.serial) ||
    !/^[a-f0-9]{48}$/.test(expected.nonce) ||
    actual.avd !== expected.avd ||
    actual.serial !== expected.serial ||
    actual.nonce !== expected.nonce
  )
    throw new Error('Owned Android target identity changed; recovery retained');
}

/**
 * The emulator can briefly reset its private ADB transport immediately after
 * reporting boot completion. Retrying the marker is safe only after the
 * still-live target has again proven its AVD and serial identity; this never
 * adopts a foreign device or renews the caller's deadline.
 */
export async function writeOwnedAndroidTargetMarker(options: {
  write: () => Promise<void>;
  verifyPreGuestTarget: () => Promise<void>;
}) {
  let firstFailure: unknown;
  try {
    await options.write();
    return;
  } catch (error) {
    firstFailure = error;
  }
  await options.verifyPreGuestTarget();
  try {
    await options.write();
  } catch (error) {
    throw new Error('Owned Android target marker could not be written after identity recheck', {
      cause: error ?? firstFailure,
    });
  }
}

function androidAdbErrorText(error: unknown) {
  const row = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return [
    error instanceof Error ? error.message : typeof error === 'string' ? error : '',
    typeof row.stderr === 'string' ? row.stderr : '',
    typeof row.stdout === 'string' ? row.stdout : '',
  ].join('\n');
}

/**
 * Only the bounded ADB states that can clear while an owned emulator is
 * starting are retryable. A missing target, identity mismatch, census failure,
 * cancellation or deadline error is deliberately outside this set.
 */
export function isTransientAndroidAdbReadinessError(error: unknown) {
  // adb reports "device still authorizing" while the emulator's adbd key
  // handshake completes during boot; it clears without intervention.
  return /\bdevice(?:\s+'[^'\r\n]{1,128}')?\s+(?:is\s+)?(?:offline|not\s+ready|still\s+authorizing)\b/i.test(
    androidAdbErrorText(error),
  );
}

export class TransientAndroidAdbReadinessError extends Error {
  constructor(cause: unknown) {
    super(androidAdbErrorText(cause), { cause });
    this.name = 'TransientAndroidAdbReadinessError';
  }
}

/**
 * The owned ADB server can be listening before the guest has registered the
 * expected serial. This is retryable only for the boot-state probe, after the
 * owned server/listener checks have completed. Identity and nonce probes never
 * use this error.
 */
export class PreGuestAndroidBootTransportNotFoundError extends Error {
  constructor(cause: unknown) {
    super(androidAdbErrorText(cause), { cause });
    this.name = 'PreGuestAndroidBootTransportNotFoundError';
  }
}

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match only the observed explicit absence of the expected serial. */
export function isExpectedPreGuestAndroidBootTransportNotFound(
  error: unknown,
  expectedSerial: string,
) {
  if (!/^emulator-55(?:5[468]|[67][02468]|8[024])$/.test(expectedSerial)) return false;
  const text = androidAdbErrorText(error);
  const serial = escapedRegExp(expectedSerial);
  const serials = [...text.matchAll(/\bemulator-\d+\b/gi)].map(([value]) => value);
  if (serials.some((value) => value !== expectedSerial)) return false;
  return new RegExp(`(?:device|serial)\\s+['"]?${serial}['"]?\\s+(?:is\\s+)?not found`, 'i').test(
    text,
  );
}

function isScopedTransientAndroidAdbReadinessError(error: unknown) {
  return (
    error instanceof TransientAndroidAdbReadinessError &&
    isTransientAndroidAdbReadinessError(error.cause)
  );
}

export type AndroidAdbReadWithReadinessRetryOptions<T> = {
  deadlineAtMonotonicMs: number;
  signal?: AbortSignal;
  now?: () => number;
  maxReadTimeoutMs?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  read: (timeoutMs: number, deadlineAtMonotonicMs: number) => Promise<T>;
  label: string;
  allowPreGuestBootTransportNotFound?: boolean;
};

/**
 * Run one ADB readiness/identity/nonce probe against the caller's original
 * absolute deadline. Retry is limited to the explicit transient ADB states;
 * no call receives a renewed deadline or a census/identity error retry.
 */
export async function readAndroidAdbWithReadinessRetry<T>(
  options: AndroidAdbReadWithReadinessRetryOptions<T>,
) {
  if (
    !Number.isFinite(options.deadlineAtMonotonicMs) ||
    options.deadlineAtMonotonicMs <= 0 ||
    (options.maxReadTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.maxReadTimeoutMs) || options.maxReadTimeoutMs < 1)) ||
    (options.retryDelayMs !== undefined &&
      (!Number.isSafeInteger(options.retryDelayMs) || options.retryDelayMs < 1))
  )
    throw new Error('Invalid Android readiness deadline');
  const now = options.now ?? (() => performance.now());
  const sleep =
    options.sleep ??
    ((delayMs: number, signal?: AbortSignal) => delay(delayMs, undefined, { signal }));
  const retryDelayMs = options.retryDelayMs ?? 100;
  for (;;) {
    options.signal?.throwIfAborted();
    const remainingMs = Math.floor(options.deadlineAtMonotonicMs - now());
    if (remainingMs <= 0) throw new Error(`Owned Android ${options.label} deadline`);
    try {
      return await options.read(
        Math.min(options.maxReadTimeoutMs ?? remainingMs, remainingMs),
        options.deadlineAtMonotonicMs,
      );
    } catch (error) {
      const retryPreGuestBootTransport =
        options.allowPreGuestBootTransportNotFound === true &&
        error instanceof PreGuestAndroidBootTransportNotFoundError;
      if (!isScopedTransientAndroidAdbReadinessError(error) && !retryPreGuestBootTransport)
        throw error;
      options.signal?.throwIfAborted();
      const afterFailureMs = Math.floor(options.deadlineAtMonotonicMs - now());
      if (afterFailureMs <= 0) throw new Error(`Owned Android ${options.label} deadline`);
      await sleep(Math.min(retryDelayMs, afterFailureMs), options.signal);
    }
  }
}

export type AndroidGroupDeadlineCaptureOptions<T> = {
  deadlineAtMonotonicMs: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  capture: () => Promise<T>;
  label: string;
};

/**
 * Bound one owned census capture without leaving a losing ref'd timer behind.
 * The local timer is cancelled after either side settles; the owned capture is
 * never cancelled by this helper and must still be drained by its owner.
 */
export async function captureAndroidGroupBeforeDeadline<T>(
  options: AndroidGroupDeadlineCaptureOptions<T>,
) {
  if (!Number.isFinite(options.deadlineAtMonotonicMs) || options.deadlineAtMonotonicMs <= 0)
    throw new Error('Invalid Android group deadline');
  const now = options.now ?? (() => performance.now());
  const sleep =
    options.sleep ??
    ((delayMs: number, signal?: AbortSignal) => delay(delayMs, undefined, { signal }));
  options.signal?.throwIfAborted();
  const remainingMs = Math.floor(options.deadlineAtMonotonicMs - now());
  if (remainingMs <= 0) throw new Error(`Owned ${options.label} deadline`);
  const timerController = new AbortController();
  const onAbort = () => timerController.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = Promise.resolve()
    .then(() => sleep(remainingMs, timerController.signal))
    .then(() => {
      throw new Error(`Owned ${options.label} deadline`);
    })
    .catch((error) => {
      if (options.signal?.aborted) options.signal.throwIfAborted();
      throw error;
    });
  try {
    return await Promise.race([Promise.resolve().then(options.capture), timeout]);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    timerController.abort();
    await timeout.catch(() => undefined);
  }
}

export async function executeOwnedAndroidAdbRead<T>(options: {
  timeoutMs: number;
  phaseDeadline?: number;
  signal?: AbortSignal;
  now?: () => number;
  captureGroup: (
    phaseDeadline?: number,
  ) => Promise<readonly { pid: number }[] | undefined> | undefined;
  assertListener: (
    port: number,
    processIds: number[],
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  port: number;
  execute: (timeoutMs: number, signal?: AbortSignal) => Promise<T>;
}) {
  options.signal?.throwIfAborted();
  const now = options.now ?? (() => performance.now());
  const group = await options.captureGroup(options.phaseDeadline);
  options.signal?.throwIfAborted();
  if (!group?.length) throw new Error('Owned Android ADB server is not live');
  const remainingMs =
    options.phaseDeadline === undefined ? undefined : Math.floor(options.phaseDeadline - now());
  if (remainingMs !== undefined && remainingMs <= 0) throw new Error('Owned Android boot deadline');
  const listenerTimeout =
    options.phaseDeadline === undefined ? 5_000 : Math.min(5_000, remainingMs!);
  await options.assertListener(
    options.port,
    group.map((row) => row.pid),
    listenerTimeout,
    options.signal,
  );
  const childRemainingMs =
    options.phaseDeadline === undefined ? undefined : Math.floor(options.phaseDeadline - now());
  if (childRemainingMs !== undefined && childRemainingMs <= 0)
    throw new Error('Owned Android boot deadline');
  const commandTimeout =
    childRemainingMs === undefined
      ? options.timeoutMs
      : Math.min(options.timeoutMs, childRemainingMs);
  return options.execute(commandTimeout, options.signal);
}

export async function inspectPrivateAndroidDirectory(value: string) {
  const metadata = await lstat(value);
  if (
    !path.isAbsolute(value) ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await realpath(value)) !== value ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error('Android directory must be canonical, private and owned');
  return { dev: metadata.dev, ino: metadata.ino, uid: metadata.uid };
}

async function randomSlotPort(excluded: number[]): Promise<Reservation> {
  for (let count = 0; count < 50; count++) {
    const requested = 30_000 + (randomBytes(2).readUInt16BE() % 10_000);
    if (excluded.includes(requested)) continue;
    try {
      return await reserveOwnedAndroidPort(requested);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No private Android slot port available');
}

/** Fresh local macOS target only; preserves the Linux/KVM CI validation contract. */
export async function acquireOwnedAndroidEmulator(options: {
  runtimeParent: string;
  artifactRoot: string;
  sdkRoot: string;
  systemImage: string;
  signal?: AbortSignal;
  stepDeadlineMs?: number;
  deadlineAtMonotonicMs?: number;
}) {
  if (process.platform !== 'darwin') throw new Error('Local Android pilot requires macOS/HVF');
  const outerDeadline = options.deadlineAtMonotonicMs ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(outerDeadline) && outerDeadline !== Number.POSITIVE_INFINITY)
    throw new Error('Invalid Android acquisition deadline');
  const ensureOuterDeadline = (label: string) => {
    options.signal?.throwIfAborted();
    if (performance.now() >= outerDeadline) throw new Error(`Owned Android ${label} deadline`);
  };
  const boundedPhaseDeadline = (configuredMs: number) => {
    ensureOuterDeadline('acquisition');
    return Math.min(performance.now() + configuredMs, outerDeadline);
  };
  ensureOuterDeadline('acquisition');
  const lifecycleDeadlines = resolveAndroidEmulatorLifecycleDeadlines(options.stepDeadlineMs);
  await inspectPrivateAndroidDirectory(options.runtimeParent);
  await inspectPrivateAndroidDirectory(options.artifactRoot);
  const runId = randomBytes(12).toString('hex');
  const slotId = `mychampions-pilot-${runId}`;
  const runtimeRoot = path.join(options.runtimeParent, slotId);
  await writeFile(
    path.join(options.artifactRoot, 'android-acquisition-owner.private.json'),
    JSON.stringify({
      kind: 'owned Android target acquisition intent',
      captureRunId: path.basename(options.artifactRoot),
      runId,
      runtimeParent: options.runtimeParent,
      runtimeRoot,
      lifecycleDeadlines,
    }),
    { flag: 'wx', mode: 0o600 },
  );
  let sdkRoot: string, adb: string, emulator: string, avdmanager: string;
  let acceleration: { stdout: string };
  try {
    if (!ownedAndroidSystemImagePattern.test(options.systemImage))
      throw new Error('Unsafe or unsupported local Android image');
    sdkRoot = await realpath(options.sdkRoot);
    const imagePath = path.join(sdkRoot, ...options.systemImage.split(';'));
    const imageMetadata = await lstat(imagePath);
    if (!imageMetadata.isDirectory() || (await realpath(imagePath)) !== imagePath)
      throw new Error('Installed Android system image unavailable');
    adb = path.join(sdkRoot, 'platform-tools/adb');
    emulator = path.join(sdkRoot, 'emulator/emulator');
    avdmanager = path.join(sdkRoot, 'cmdline-tools/latest/bin/avdmanager');
    acceleration = await execute(emulator, ['-accel-check'], {
      timeout: Math.max(1, Math.min(10_000, Math.floor(outerDeadline - performance.now()))),
      signal: options.signal,
    });
    if (!/\n0\s*\nHypervisor\.Framework/.test(acceleration.stdout))
      throw new Error('Local Android HVF acceleration unavailable');
  } catch (error) {
    await writeFile(
      path.join(options.artifactRoot, 'android-preflight-failure.private.json'),
      JSON.stringify({
        kind: 'original Android preflight failure before target resource creation',
        runId,
        captureRunId: path.basename(options.artifactRoot),
        runtimeRoot,
        at: new Date().toISOString(),
      }),
      { flag: 'wx', mode: 0o600 },
    );
    throw error;
  }
  await mkdir(runtimeRoot, { mode: 0o700 });
  const rootBirth = await inspectPrivateAndroidDirectory(runtimeRoot);
  const marker = path.join(runtimeRoot, 'owner.private.json');
  const identity: AndroidTargetIdentity = {
    avd: `MyChampions-Pilot-${runId}`,
    serial: '',
    nonce: randomBytes(24).toString('hex'),
  };
  const reservations: Reservation[] = [];
  const commands: Command[] = [];
  const directories: {
    value: string;
    birth: Awaited<ReturnType<typeof inspectPrivateAndroidDirectory>>;
  }[] = [];
  let ownerBytes = '';
  let slot: AndroidRunnerSlot | undefined;
  let env: NodeJS.ProcessEnv | undefined;
  let adbGroup: Command | undefined;
  let emulatorGroup: Command | undefined;
  let guestQualified = false;
  let cleanup: Promise<void> | undefined;
  const verifyHost = async () => {
    ensureOuterDeadline('host verification');
    const current = await inspectPrivateAndroidDirectory(runtimeRoot);
    const markerMeta = await lstat(marker);
    if (
      current.dev !== rootBirth.dev ||
      current.ino !== rootBirth.ino ||
      markerMeta.isSymbolicLink() ||
      !markerMeta.isFile() ||
      markerMeta.uid !== current.uid ||
      (markerMeta.mode & 0o777) !== 0o600 ||
      (await readFile(marker, 'utf8')) !== ownerBytes
    )
      throw new Error('Android ownership marker changed; recovery retained');
    for (const row of directories) {
      const metadata = await inspectPrivateAndroidDirectory(row.value);
      if (metadata.dev !== row.birth.dev || metadata.ino !== row.birth.ino)
        throw new Error('Android slot directory changed; recovery retained');
    }
    ensureOuterDeadline('host verification');
  };
  const adbRead = async (
    argv: string[],
    timeoutMs = 10_000,
    phaseDeadline?: number,
    allowPreGuestBootTransportNotFound = false,
  ) => {
    if (!slot || !env) throw new Error('Android slot not acquired');
    options.signal?.throwIfAborted();
    await verifyHost();
    options.signal?.throwIfAborted();
    if (allowPreGuestBootTransportNotFound) {
      if (phaseDeadline === undefined || !emulatorGroup)
        throw new Error('Owned pre-guest Android boot deadline/group is unavailable');
      const emulatorProcesses = await captureBeforeDeadline(
        emulatorGroup,
        phaseDeadline,
        'Android boot',
      );
      options.signal?.throwIfAborted();
      if (!emulatorProcesses.length) throw new Error('Owned emulator exited during boot');
    }
    return executeOwnedAndroidAdbRead<string>({
      timeoutMs,
      phaseDeadline,
      captureGroup: (deadline) =>
        deadline === undefined
          ? adbGroup?.capture(true)
          : captureBeforeDeadline(adbGroup!, deadline, 'Android boot'),
      assertListener: (port, processIds, timeoutMs, signal) =>
        assertOwnedListener(port, processIds, timeoutMs, signal),
      port: slot.adbServerPort,
      signal: options.signal,
      execute: async (commandTimeout, signal) => {
        try {
          const result = await execute(
            adb,
            [
              '-H',
              '127.0.0.1',
              '-P',
              String(slot!.adbServerPort),
              '-s',
              slot!.emulatorSerial,
              ...argv,
            ],
            {
              env: env!,
              timeout: commandTimeout,
              signal,
              maxBuffer: 4 * 1024 * 1024,
            },
          );
          return result.stdout.trim();
        } catch (error) {
          if (
            allowPreGuestBootTransportNotFound &&
            argv.length === 3 &&
            argv[0] === 'shell' &&
            argv[1] === 'getprop' &&
            argv[2] === 'sys.boot_completed' &&
            isExpectedPreGuestAndroidBootTransportNotFound(error, slot!.emulatorSerial)
          )
            throw new PreGuestAndroidBootTransportNotFoundError(error);
          if (isTransientAndroidAdbReadinessError(error))
            throw new TransientAndroidAdbReadinessError(error);
          throw error;
        }
      },
    });
  };
  const adbReadForStartup = async (
    argv: string[],
    timeoutMs: number,
    phaseDeadline: number | undefined,
    label: string,
    allowPreGuestBootTransportNotFound = false,
  ) => {
    if (phaseDeadline === undefined)
      return adbRead(argv, timeoutMs, undefined, allowPreGuestBootTransportNotFound);
    return readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs: phaseDeadline,
      signal: options.signal,
      maxReadTimeoutMs: timeoutMs,
      label,
      allowPreGuestBootTransportNotFound,
      read: (commandTimeout, originalDeadline) =>
        adbRead(argv, commandTimeout, originalDeadline, allowPreGuestBootTransportNotFound),
    });
  };
  const verifyTarget = async (phaseDeadline?: number) => {
    const group =
      phaseDeadline === undefined
        ? await emulatorGroup?.capture(true)
        : await captureBeforeDeadline(emulatorGroup!, phaseDeadline, 'Android boot');
    if (!group?.length) throw new Error('Owned emulator process is not live');
    validateAndroidTargetIdentity(identity, {
      avd: (
        await adbReadForStartup(
          ['emu', 'avd', 'name'],
          10_000,
          phaseDeadline,
          'Android target identity',
        )
      )
        .split('\n')[0]
        .trim(),
      serial: await adbReadForStartup(
        ['get-serialno'],
        10_000,
        phaseDeadline,
        'Android target identity',
      ),
      nonce: await adbReadForStartup(
        ['shell', 'getprop', 'debug.mychampions.owner'],
        10_000,
        phaseDeadline,
        'Android target nonce',
      ),
    });
  };
  const stop = () => {
    cleanup ??= (async () => {
      await verifyHost();
      if (guestQualified) await verifyTarget();
      const errors: string[] = [];
      for (const command of [...commands].reverse()) {
        try {
          await command.stop();
        } catch (error) {
          errors.push((error as Error).message);
        }
      }
      for (const reservation of reservations) await reservation.release();
      if (errors.length) throw new Error(`Android cleanup retained recovery: ${errors.join('; ')}`);
      await verifyHost();
      for (const row of directories) await rm(row.value, { recursive: true });
      await writeFile(
        path.join(options.artifactRoot, 'android-cleanup.private.json'),
        JSON.stringify(
          {
            status: 'cleaned',
            runId,
            identity,
            slot,
            runtimeRoot,
            processGroups: commands.map((row) => row.pgid),
            deletedDirectories: directories.map((row) => row.value),
            reservedPorts: reservations.map((row) => row.port),
            finishedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
    })();
    return cleanup;
  };
  const run = async (
    label: string,
    command: string,
    argv: string[],
    deadlineMs: number,
    input?: string,
  ) => {
    ensureOuterDeadline(label);
    const boundedDeadlineMs = Math.max(
      1,
      Math.min(deadlineMs, Math.floor(outerDeadline - performance.now())),
    );
    const child = await startOwnedNativeCommand({
      command,
      argv,
      artifactRoot: options.artifactRoot,
      label,
      env: env!,
      input,
    });
    commands.push(child);
    let firstError: unknown;
    try {
      await child.wait(boundedDeadlineMs, options.signal);
    } catch (error) {
      firstError = error;
      throw error;
    } finally {
      try {
        await child.stop();
      } catch (error) {
        if (!firstError) throw error;
      }
    }
  };
  const captureBeforeDeadline = async (
    group: Command,
    deadline: number,
    phase: 'ADB startup' | 'Android boot',
  ) => {
    return captureAndroidGroupBeforeDeadline({
      deadlineAtMonotonicMs: deadline,
      signal: options.signal,
      capture: () =>
        group.capture(true, {
          // Android startup may briefly replace a Darwin ps child while the
          // verified launcher remains live. The original boot deadline is the
          // only settling budget; no retry is allowed for query execution,
          // user, group, start-time or identity failures. Only the Darwin
          // argv-unavailable census may settle.
          untilMonotonicMs: deadline,
          signal: options.signal,
          delayMs: 50,
          maxRequeries: 8,
        }),
      label: phase,
    });
  };
  // Persist creation intent before any external acquisition.
  ownerBytes = JSON.stringify({
    runId,
    identity,
    rootBirth,
    state: 'preparing',
  });
  await writeFile(marker, ownerBytes, { flag: 'wx', mode: 0o600 });
  try {
    options.signal?.throwIfAborted();
    for (let consolePort = 5554; consolePort <= 5584; consolePort += 2) {
      let first: Reservation | undefined;
      try {
        first = await reserveOwnedAndroidPort(consolePort);
        const second = await reserveOwnedAndroidPort(consolePort + 1);
        reservations.push(first, second);
        break;
      } catch (error) {
        await first?.release();
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      }
    }
    if (reservations.length !== 2) throw new Error('All local emulator port pairs are occupied');
    reservations.push(await randomSlotPort(reservations.map((row) => row.port)));
    reservations.push(await randomSlotPort(reservations.map((row) => row.port)));
    reservations.push(await randomSlotPort(reservations.map((row) => row.port)));
    const slotEnv: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV,
      MYCHAMPIONS_ANDROID_SLOT_ID: slotId,
      MYCHAMPIONS_ANDROID_AVD: identity.avd,
    };
    for (const [key, suffix] of [
      ['AVD_HOME', 'avd'],
      ['USER_HOME', 'user'],
      ['RECOVERY_ROOT', 'recovery'],
      ['LOG_ROOT', 'logs'],
      ['TEMP_ROOT', 'tmp'],
      ['LOCK_ROOT', 'locks'],
    ] as const) {
      const value = path.join(runtimeRoot, suffix);
      await mkdir(value, { mode: 0o700 });
      directories.push({
        value,
        birth: await inspectPrivateAndroidDirectory(value),
      });
      slotEnv[`MYCHAMPIONS_ANDROID_${key}`] = value;
    }
    slotEnv.MYCHAMPIONS_ANDROID_EMULATOR_PORT = String(reservations[0].port);
    slotEnv.MYCHAMPIONS_ANDROID_EMULATOR_SERIAL = `emulator-${reservations[0].port}`;
    slotEnv.MYCHAMPIONS_ANDROID_ADB_SERVER_PORT = String(reservations[2].port);
    slotEnv.MYCHAMPIONS_ANDROID_METRO_PORT = String(reservations[3].port);
    slot = parseAndroidRunnerSlot(slotEnv);
    identity.serial = slot.emulatorSerial;
    env = localAndroidPilotEnvironment(slot, sdkRoot);
    await mkdir(path.join(slot.userHome, '.android'), { mode: 0o700 });
    await inspectPrivateAndroidDirectory(path.join(slot.userHome, '.android'));
    ownerBytes = JSON.stringify({
      runId,
      identity,
      rootBirth,
      directories,
      slot,
      reservedPorts: reservations.map((row) => row.port),
      state: 'owned',
    });
    await writeFile(marker, ownerBytes, { mode: 0o600 });
    await verifyHost();
    await run(
      'android-create-avd',
      avdmanager,
      [
        'create',
        'avd',
        '-n',
        slot.avd,
        '-k',
        options.systemImage,
        '-p',
        path.join(slot.avdHome, `${slot.avd}.avd`),
      ],
      lifecycleDeadlines.avdCreationMs,
      'no\n',
    );
    await reservations[2].release();
    adbGroup = await startOwnedNativeCommand({
      command: adb,
      argv: [
        '-L',
        `tcp:${slot.adbServerPort}`,
        '--one-device',
        slot.emulatorSerial,
        'server',
        'nodaemon',
      ],
      artifactRoot: options.artifactRoot,
      label: 'android-adb-server',
      env,
    });
    commands.push(adbGroup);
    const serverDeadline = boundedPhaseDeadline(lifecycleDeadlines.adbStartupMs);
    let serverReady = false;
    while (performance.now() < serverDeadline) {
      options.signal?.throwIfAborted();
      const members = await captureBeforeDeadline(adbGroup, serverDeadline, 'ADB startup');
      if (!members.length) throw new Error('Owned ADB server exited during startup');
      try {
        await assertOwnedListener(
          slot.adbServerPort,
          members.map((row) => row.pid),
          Math.max(1, Math.min(5_000, Math.floor(serverDeadline - performance.now()))),
          options.signal,
        );
        serverReady = true;
        break;
      } catch {
        await delay(
          Math.min(100, Math.max(1, Math.floor(serverDeadline - performance.now()))),
          undefined,
          { signal: options.signal },
        );
      }
    }
    if (!serverReady)
      throw new Error(`Owned ADB listener startup deadline (${lifecycleDeadlines.adbStartupMs}ms)`);
    await reservations[0].release();
    await reservations[1].release();
    await reservations[4].release();
    emulatorGroup = await startOwnedNativeCommand({
      command: emulator,
      argv: [
        '-avd',
        slot.avd,
        '-port',
        String(slot.emulatorPort),
        '-grpc',
        String(reservations[4].port),
        '-grpc-use-jwt',
        '-crash-report-mode',
        'disabled',
        '-no-direct-adb',
        '-adb-path',
        adb,
        '-no-window',
        '-no-snapshot',
        '-no-snapshot-save',
        '-no-audio',
        // The default AVD userdata size is much larger than this isolated
        // integration flow needs and can prevent acquisition on a healthy
        // developer host. The app and test APKs fit comfortably in 4 GiB.
        '-partition-size',
        '4096',
        // The camera-denial scenario must reach Android's runtime permission
        // controller. A disabled back camera takes the app's documented
        // unavailable-device branch before it can request permission.
        '-camera-back',
        'virtualscene',
        '-camera-front',
        'none',
      ],
      artifactRoot: options.artifactRoot,
      label: 'android-emulator',
      env,
    });
    commands.push(emulatorGroup);
    const deadline = boundedPhaseDeadline(lifecycleDeadlines.bootMs);
    while (performance.now() < deadline) {
      options.signal?.throwIfAborted();
      if (!(await captureBeforeDeadline(emulatorGroup, deadline, 'Android boot')).length)
        throw new Error('Owned emulator exited during boot');
      const bootState = await adbReadForStartup(
        ['shell', 'getprop', 'sys.boot_completed'],
        10_000,
        deadline,
        'Android boot readiness',
        true,
      );
      if (bootState.trim() === '1') break;
      const remainingMs = Math.floor(deadline - performance.now());
      if (remainingMs <= 0) break;
      await delay(Math.min(500, remainingMs), undefined, {
        signal: options.signal,
      });
    }
    if (performance.now() >= deadline)
      throw new Error(`Owned Android boot deadline (${lifecycleDeadlines.bootMs}ms)`);
    const verifyPreGuestTarget = async () => {
      const actualAvd = (
        await adbReadForStartup(['emu', 'avd', 'name'], 10_000, deadline, 'Android target identity')
      )
        .split('\n')[0]
        .trim();
      if (
        actualAvd !== identity.avd ||
        (await adbReadForStartup(['get-serialno'], 10_000, deadline, 'Android target identity')) !==
          identity.serial
      )
        throw new Error('Unexpected Android target before guest ownership marker');
    };
    await verifyPreGuestTarget();
    await writeOwnedAndroidTargetMarker({
      write: async () =>
        adbReadForStartup(
          ['shell', 'setprop', 'debug.mychampions.owner', identity.nonce],
          10_000,
          deadline,
          'Android target nonce',
        ).then(() => undefined),
      verifyPreGuestTarget,
    });
    guestQualified = true;
    await verifyTarget(deadline);
    const emulatorMembers = (
      await captureBeforeDeadline(emulatorGroup, deadline, 'Android boot')
    ).map((row) => row.pid);
    const listenerTimeout = () => {
      const remainingMs = Math.floor(deadline - performance.now());
      if (remainingMs <= 0) throw new Error('Owned Android boot deadline');
      return Math.max(1, Math.min(5_000, remainingMs));
    };
    await assertOwnedListener(
      slot.emulatorPort,
      emulatorMembers,
      listenerTimeout(),
      options.signal,
    );
    await assertOwnedListener(
      slot.emulatorPort + 1,
      emulatorMembers,
      listenerTimeout(),
      options.signal,
    );
    const osVersion = await adbReadForStartup(
      ['shell', 'getprop', 'ro.build.version.release'],
      10_000,
      deadline,
      'Android target metadata',
    );
    const osFingerprint = await adbReadForStartup(
      ['shell', 'getprop', 'ro.build.fingerprint'],
      10_000,
      deadline,
      'Android target metadata',
    );
    if (performance.now() >= deadline) throw new Error('Owned Android boot deadline');
    await writeFile(
      path.join(options.artifactRoot, 'android-target.private.json'),
      JSON.stringify(
        {
          runId,
          identity,
          slot,
          osVersion,
          osFingerprint,
          systemImage: options.systemImage,
          runtimeRoot,
          rootBirth,
          marker,
          lifecycleDeadlines,
          reservedPorts: reservations.map((row) => row.port),
          acceleration: acceleration.stdout.trim(),
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    return {
      runId,
      identity,
      slot,
      env,
      osVersion,
      runtimeRoot,
      verify: verifyTarget,
      stop,
      adbRead,
      async releaseMetroReservation() {
        await verifyHost();
        await verifyTarget();
        await reservations[3].release();
      },
    };
  } catch (error) {
    let diagnosticFailure: unknown;
    try {
      await writeFile(
        path.join(options.artifactRoot, 'android-acquisition-failure.private.json'),
        JSON.stringify({
          kind: 'original owned Android acquisition failure before cleanup',
          runId,
          identity,
          guestQualified,
          lifecycleDeadlines,
          message: (error as Error).message,
          commands: commands.map((command) => ({
            pid: command.pid,
            pgid: command.pgid,
            originalOutcome: command.outcome(),
            censusFailure: command.censusFailure(),
          })),
          at: new Date().toISOString(),
        }),
        { flag: 'wx', mode: 0o600 },
      );
    } catch (publicationError) {
      diagnosticFailure = publicationError;
    }
    try {
      await stop();
    } catch (cleanupError) {
      await writeFile(
        path.join(options.artifactRoot, 'android-cleanup-failure.private.json'),
        JSON.stringify({
          firstError: (error as Error).message,
          cleanupError: (cleanupError as Error).message,
          runtimeRoot,
        }),
        { mode: 0o600 },
      );
    }
    if (diagnosticFailure)
      throw new AggregateError([error, diagnosticFailure], (error as Error).message);
    throw error;
  }
}

async function assertOwnedListener(
  port: number,
  processIds: number[],
  timeoutMs = 5000,
  signal?: AbortSignal,
) {
  const result = await execute('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
    timeout: timeoutMs,
    signal,
  });
  const pids = [
    ...new Set(
      result.stdout
        .split('\n')
        .filter((row) => /^p[0-9]+$/.test(row))
        .map((row) => Number(row.slice(1))),
    ),
  ];
  if (!pids.length || pids.some((pid) => !processIds.includes(pid)))
    throw new Error('Android listener is absent or foreign');
}

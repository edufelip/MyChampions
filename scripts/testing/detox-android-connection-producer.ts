import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  buildDetoxAndroidStorageCommandHash,
  type DetoxAndroidSessionStorageTarget,
} from './detox-android-session-storage-producer';
import {
  type DetoxBaselineFactories,
  type DetoxOwnedTarget,
} from './detox-integrated-session-baseline';
import {
  createAndroidDetoxSessionOwnedChildDirectory,
  type AndroidDetoxSessionDirectoryIdentity,
} from './native-detox-android-session-public-staging';
import {
  acquireOwnedAndroidEmulator,
  resolveOwnedAndroidSystemImage,
} from './owned-android-emulator';
import { executeOwnedNativeCommand } from './owned-native-command';
import {
  verifyOwnedAndroidDetoxConnectionCleanup,
  type AndroidDetoxConnectionCleanupOptions,
  type AndroidDetoxConnectionCleanupResult,
} from './verify-owned-android-detox-connection-cleanup';
export { requireNativeConnectionEngineForPlatform } from './native-connection-engine-contract';

const ANDROID_APP_ID = 'com.edufelip.mychampions.dev';
const RUN_ID = /^[a-f0-9]{24}$/;

type AcquiredAndroidEmulator = Awaited<ReturnType<typeof acquireOwnedAndroidEmulator>>;

/**
 * The camera owner consumes the actual acquired emulator facts.  Keep these
 * fields as an intersection on the shared target rather than manufacturing a
 * second identity object in the camera route.
 */
export type AndroidDetoxCameraOwnedTarget = DetoxOwnedTarget &
  Readonly<Pick<AcquiredAndroidEmulator, 'runId' | 'identity' | 'osVersion' | 'adbRead'>>;

/**
 * Capability passed by the Android Detox adapter after the owner has selected
 * the exact Android integration cell.  The capability is deliberately
 * structural and contains the real target/cleanup functions; a boolean flag
 * cannot unlock acquisition.
 */
export type AndroidDetoxConnectionProducer = Readonly<{
  kind: 'owned-android-detox-connection-producer';
  acquireOwnedTarget: (
    options: Parameters<DetoxBaselineFactories['acquireOwnedTarget']>[0],
  ) => Promise<AndroidDetoxCameraOwnedTarget>;
  verifyOwnedAndroidCleanup: (
    options: AndroidDetoxConnectionCleanupOptions,
  ) => Promise<AndroidDetoxConnectionCleanupResult>;
}>;

export function requireAndroidDetoxConnectionProducer(
  value: unknown,
): AndroidDetoxConnectionProducer {
  if (!value || typeof value !== 'object')
    throw new Error('Android Detox connection producer is missing before acquisition');
  const producer = value as Partial<AndroidDetoxConnectionProducer>;
  if (producer.kind !== 'owned-android-detox-connection-producer')
    throw new Error('Android Detox connection producer kind is not owned');
  if (typeof producer.acquireOwnedTarget !== 'function')
    throw new Error('Android Detox connection producer has no owned target factory');
  if (typeof producer.verifyOwnedAndroidCleanup !== 'function')
    throw new Error('Android Detox connection producer has no independent cleanup verifier');
  return producer as AndroidDetoxConnectionProducer;
}

/**
 * The shared driver calls this after the owned target-stop step. It accepts
 * only an actual available census and keeps the native pass count at zero;
 * missing or failed independent cleanup cannot be hidden by the child report.
 */
export function requireAndroidDetoxCleanupResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Android independent cleanup result is not an object');
  const result = value as Record<string, unknown>;
  if (result.kind !== 'private-owned-android-detox-connection-cleanup')
    throw new Error('Android independent cleanup result kind is not owned');
  if (result.result !== 'passed')
    throw new Error('Android independent cleanup result did not pass');
  if (result.censusStatus !== 'available')
    throw new Error('Android independent cleanup census is unavailable');
  if (result.nativePassingCases !== 0)
    throw new Error('Android independent cleanup cannot report native passing cases');
  if (result.scope !== 'android-detox-target-only')
    throw new Error('Android independent cleanup scope is not target-bound');
  if (typeof result.runId !== 'string' || !RUN_ID.test(result.runId))
    throw new Error('Android independent cleanup run identity is invalid');
  if (!Array.isArray(result.processSurvivors) || result.processSurvivors.length !== 0)
    throw new Error('Android independent cleanup retained process survivors');
  if (!Array.isArray(result.unavailablePorts) || result.unavailablePorts.length !== 0)
    throw new Error('Android independent cleanup retained listeners');
  if (!Number.isSafeInteger(result.pidStartPairs) || Number(result.pidStartPairs) < 0)
    throw new Error('Android independent cleanup did not retain process census accounting');
  if (!Array.isArray(result.deletedDirectories) || result.deletedDirectories.length !== 6)
    throw new Error('Android independent cleanup did not retain all owned runtime directories');
  return result;
}

/**
 * Build the Android producer from the same owned emulator, command executor and
 * cleanup verifier used by the existing Android session lane. This function is
 * only a source integration seam; callers still need the host lock and an
 * actual native run before any result can be qualified.
 */
export function createOwnedAndroidDetoxConnectionProducer(): AndroidDetoxConnectionProducer {
  const acquireOwnedTarget: AndroidDetoxConnectionProducer['acquireOwnedTarget'] = async (
    options,
  ) => {
    if (options.platform !== 'android')
      throw new Error('Android Detox producer cannot acquire an iOS target');
    const systemImage = resolveOwnedAndroidSystemImage();
    const sdkRoot = process.env.ANDROID_SDK_ROOT ?? '/Users/eduwaldo/Library/Android/sdk';
    const runtimeParent = path.join(options.artifactRoot, 'android-runtime');
    const artifactMetadata = await lstat(options.artifactRoot);
    if (
      !artifactMetadata.isDirectory() ||
      artifactMetadata.isSymbolicLink() ||
      (process.getuid && artifactMetadata.uid !== process.getuid()) ||
      (artifactMetadata.mode & 0o777) !== 0o700 ||
      (await realpath(options.artifactRoot)) !== options.artifactRoot
    )
      throw new Error('Android Detox artifact root is not an owned private directory');
    const artifactIdentity: AndroidDetoxSessionDirectoryIdentity = {
      path: options.artifactRoot,
      dev: artifactMetadata.dev,
      ino: artifactMetadata.ino,
      uid: artifactMetadata.uid,
      gid: artifactMetadata.gid,
      mode: artifactMetadata.mode & 0o777,
      nlink: artifactMetadata.nlink,
    };
    await createAndroidDetoxSessionOwnedChildDirectory({
      parent: options.artifactRoot,
      name: path.basename(runtimeParent),
      expectedParentIdentity: artifactIdentity,
      lifecycle: {
        signal: options.signal ?? new AbortController().signal,
        deadlineAtMonotonicMs: options.deadlineAtMonotonicMs ?? performance.now() + 120_000,
      },
    });
    const device = await acquireOwnedAndroidEmulator({
      runtimeParent,
      artifactRoot: options.artifactRoot,
      sdkRoot,
      systemImage,
      signal: options.signal,
      deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    });
    const androidSessionStorage: DetoxAndroidSessionStorageTarget = {
      appId: ANDROID_APP_ID,
      serial: device.identity.serial,
      adbServerPort: device.slot.adbServerPort,
      verify: device.verify,
      runAdb: async (input) => {
        const command = path.join(sdkRoot, 'platform-tools/adb');
        const argv = [
          '-H',
          '127.0.0.1',
          '-P',
          String(device.slot.adbServerPort),
          '-s',
          device.slot.emulatorSerial,
          ...input.argv,
        ];
        const cwd = process.cwd();
        const execution = await executeOwnedNativeCommand({
          command,
          argv,
          artifactRoot: input.artifactRoot,
          label: input.label,
          env: device.env,
          cwd,
          // Forward stdin (e.g. the Metro preference XML written via `tee`).
          input: input.input,
          deadlineMs: input.deadlineMs,
          phase: 'step',
          signal: input.signal,
          stdoutPath: input.stdoutPath,
        });
        const inputSha256 =
          input.input !== undefined
            ? createHash('sha256').update(input.input).digest('hex')
            : undefined;
        return {
          ...execution,
          command,
          argv,
          cwd,
          deadlineMs: input.deadlineMs,
          ...(inputSha256 ? { inputSha256 } : {}),
          commandHash: buildDetoxAndroidStorageCommandHash({
            command,
            argv,
            cwd,
            deadlineMs: input.deadlineMs,
            ...(inputSha256 ? { inputSha256 } : {}),
            phase: 'step',
            target: input.target,
            binding: input.binding,
          }),
          target: input.target,
          binding: input.binding,
        };
      },
      runHostSqlite: async (input) => {
        const command = '/usr/bin/sqlite3';
        const argv = [...input.argv];
        const cwd = process.cwd();
        const execution = await executeOwnedNativeCommand({
          command,
          argv,
          artifactRoot: input.artifactRoot,
          label: input.label,
          env: { ...process.env },
          cwd,
          // Forward stdin (e.g. the Metro preference XML written via `tee`).
          input: input.input,
          deadlineMs: input.deadlineMs,
          phase: 'step',
          signal: input.signal,
          stdoutPath: input.stdoutPath,
        });
        const inputSha256 =
          input.input !== undefined
            ? createHash('sha256').update(input.input).digest('hex')
            : undefined;
        return {
          ...execution,
          command,
          argv,
          cwd,
          deadlineMs: input.deadlineMs,
          ...(inputSha256 ? { inputSha256 } : {}),
          commandHash: buildDetoxAndroidStorageCommandHash({
            command,
            argv,
            cwd,
            deadlineMs: input.deadlineMs,
            ...(inputSha256 ? { inputSha256 } : {}),
            phase: 'step',
            target: input.target,
            binding: input.binding,
          }),
          target: input.target,
          binding: input.binding,
        };
      },
    };
    return {
      platform: 'android',
      deviceId: device.identity.serial,
      androidRuntimeParent: runtimeParent,
      androidSdkRoot: sdkRoot,
      androidTargetRunId: device.runId,
      androidOsVersion: device.osVersion,
      androidSessionStorage,
      runId: device.runId,
      identity: device.identity,
      osVersion: device.osVersion,
      adbRead: device.adbRead,
      ownership: {
        artifactRoot: options.artifactRoot,
        hostLockRequired: true,
        cleanupAuthorized: true,
      },
      verify: async () => device.verify(),
      stop: device.stop,
    };
  };

  return Object.freeze({
    kind: 'owned-android-detox-connection-producer' as const,
    acquireOwnedTarget,
    verifyOwnedAndroidCleanup: verifyOwnedAndroidDetoxConnectionCleanup,
  });
}

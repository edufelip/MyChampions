import { execFileSync } from 'node:child_process';
import {
  accessSync,
  appendFileSync,
  constants as fsConstants,
  lstatSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const minimumPort = 1024;
const maximumPort = 49151;
const minimumEmulatorPort = 5554;
const maximumEmulatorPort = 5584;

export type AndroidRunnerSlot = {
  slotId: string;
  avd: string;
  avdHome: string;
  userHome: string;
  recoveryRoot: string;
  logRoot: string;
  tempRoot: string;
  lockRoot: string;
  emulatorPort: number;
  emulatorSerial: string;
  adbServerPort: number;
  metroPort: number;
};

export type AndroidRunnerSlotEnvironment = Record<string, string>;

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value?.trim()) throw new Error(`${name} is required for Android runner slot validation`);
  if (/\0|\r|\n/.test(value)) throw new Error(`${name} contains an unsafe control character`);
  return value.trim();
}

function parsePort(name: string, value: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must contain only decimal digits`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < minimumPort || port > maximumPort) {
    throw new Error(`${name} must be between ${minimumPort} and ${maximumPort}`);
  }
  return port;
}

function parseEmulatorPort(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error('MYCHAMPIONS_ANDROID_EMULATOR_PORT must contain only decimal digits');
  }
  const port = Number(value);
  if (
    !Number.isSafeInteger(port) ||
    port < minimumEmulatorPort ||
    port > maximumEmulatorPort ||
    port % 2 !== 0
  ) {
    throw new Error(
      `MYCHAMPIONS_ANDROID_EMULATOR_PORT must be an even console port from ${minimumEmulatorPort} to ${maximumEmulatorPort}`,
    );
  }
  return port;
}

function requiredAbsolutePath(environment: NodeJS.ProcessEnv, name: string): string {
  const value = required(environment, name);
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

function isSameOrNested(first: string, second: string): boolean {
  const relation = relative(first, second);
  return (
    relation === '' ||
    (!relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && relation !== '..')
  );
}

export function parseAndroidRunnerSlot(environment: NodeJS.ProcessEnv): AndroidRunnerSlot {
  const slotId = required(environment, 'MYCHAMPIONS_ANDROID_SLOT_ID');
  if (!/^mychampions-[a-z0-9][a-z0-9._-]*$/.test(slotId)) {
    throw new Error('MYCHAMPIONS_ANDROID_SLOT_ID must identify a mychampions-* runner slot');
  }

  const avd = required(environment, 'MYCHAMPIONS_ANDROID_AVD');
  if (!/^[A-Za-z0-9._-]+$/.test(avd)) {
    throw new Error('MYCHAMPIONS_ANDROID_AVD contains unsafe characters');
  }

  const avdHome = requiredAbsolutePath(environment, 'MYCHAMPIONS_ANDROID_AVD_HOME');
  const userHome = requiredAbsolutePath(environment, 'MYCHAMPIONS_ANDROID_USER_HOME');
  const recoveryRoot = requiredAbsolutePath(environment, 'MYCHAMPIONS_ANDROID_RECOVERY_ROOT');
  const logRoot = requiredAbsolutePath(environment, 'MYCHAMPIONS_ANDROID_LOG_ROOT');
  const tempRoot = requiredAbsolutePath(environment, 'MYCHAMPIONS_ANDROID_TEMP_ROOT');
  const lockRoot = requiredAbsolutePath(environment, 'MYCHAMPIONS_ANDROID_LOCK_ROOT');
  for (const [name, value] of [
    ['MYCHAMPIONS_ANDROID_AVD_HOME', avdHome],
    ['MYCHAMPIONS_ANDROID_USER_HOME', userHome],
    ['MYCHAMPIONS_ANDROID_RECOVERY_ROOT', recoveryRoot],
    ['MYCHAMPIONS_ANDROID_LOG_ROOT', logRoot],
    ['MYCHAMPIONS_ANDROID_TEMP_ROOT', tempRoot],
    ['MYCHAMPIONS_ANDROID_LOCK_ROOT', lockRoot],
  ] as const) {
    if (!value.toLowerCase().includes(slotId.toLowerCase())) {
      throw new Error(`${name} must include the Android slot id (${slotId})`);
    }
  }
  const slotPaths = [
    ['MYCHAMPIONS_ANDROID_AVD_HOME', avdHome],
    ['MYCHAMPIONS_ANDROID_USER_HOME', userHome],
    ['MYCHAMPIONS_ANDROID_RECOVERY_ROOT', recoveryRoot],
    ['MYCHAMPIONS_ANDROID_LOG_ROOT', logRoot],
    ['MYCHAMPIONS_ANDROID_TEMP_ROOT', tempRoot],
    ['MYCHAMPIONS_ANDROID_LOCK_ROOT', lockRoot],
  ] as const;
  for (let index = 0; index < slotPaths.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < slotPaths.length; nextIndex += 1) {
      const [firstName, firstPath] = slotPaths[index];
      const [secondName, secondPath] = slotPaths[nextIndex];
      if (isSameOrNested(firstPath, secondPath) || isSameOrNested(secondPath, firstPath)) {
        throw new Error(`${firstName} and ${secondName} must be separate slot directories`);
      }
    }
  }
  const emulatorPort = parseEmulatorPort(
    required(environment, 'MYCHAMPIONS_ANDROID_EMULATOR_PORT'),
  );
  const emulatorSerial = required(environment, 'MYCHAMPIONS_ANDROID_EMULATOR_SERIAL');
  if (emulatorSerial !== `emulator-${emulatorPort}`) {
    throw new Error('MYCHAMPIONS_ANDROID_EMULATOR_SERIAL must match the configured emulator port');
  }
  const adbServerPort = parsePort(
    'MYCHAMPIONS_ANDROID_ADB_SERVER_PORT',
    required(environment, 'MYCHAMPIONS_ANDROID_ADB_SERVER_PORT'),
  );
  const metroPort = parsePort(
    'MYCHAMPIONS_ANDROID_METRO_PORT',
    required(environment, 'MYCHAMPIONS_ANDROID_METRO_PORT'),
  );
  const emulatorBridgePort = emulatorPort + 1;
  if (new Set([emulatorPort, emulatorBridgePort, adbServerPort, metroPort]).size !== 4) {
    throw new Error('Android emulator, ADB server, and Metro ports must be distinct');
  }

  return {
    slotId,
    avd,
    avdHome,
    userHome,
    recoveryRoot,
    logRoot,
    tempRoot,
    lockRoot,
    emulatorPort,
    emulatorSerial,
    adbServerPort,
    metroPort,
  };
}

export function androidRunnerSlotEnvironment(
  slot: AndroidRunnerSlot,
): AndroidRunnerSlotEnvironment {
  return {
    ANDROID_AVD_HOME: slot.avdHome,
    ANDROID_EMULATOR_HOME: slot.userHome,
    ANDROID_USER_HOME: slot.userHome,
    ADB_SERVER_PORT: String(slot.adbServerPort),
    ANDROID_ADB_SERVER_PORT: String(slot.adbServerPort),
    ANDROID_SERIAL: slot.emulatorSerial,
    ANDROID_TMPDIR: slot.tempRoot,
    TMPDIR: slot.tempRoot,
    DETOX_ANDROID_AVD: slot.avd,
    DETOX_ANDROID_DEVICE: slot.emulatorSerial,
    DETOX_METRO_PORT: String(slot.metroPort),
    MYCHAMPIONS_ANDROID_AVD_HOME: slot.avdHome,
    MYCHAMPIONS_ANDROID_AVD: slot.avd,
    MYCHAMPIONS_ANDROID_ADB_SERVER_PORT: String(slot.adbServerPort),
    MYCHAMPIONS_ANDROID_EMULATOR_PORT: String(slot.emulatorPort),
    MYCHAMPIONS_ANDROID_EMULATOR_SERIAL: slot.emulatorSerial,
    MYCHAMPIONS_ANDROID_LOG_ROOT: slot.logRoot,
    MYCHAMPIONS_ANDROID_LOCK_ROOT: slot.lockRoot,
    MYCHAMPIONS_ANDROID_RECOVERY_ROOT: slot.recoveryRoot,
    MYCHAMPIONS_ANDROID_SLOT_ID: slot.slotId,
    MYCHAMPIONS_ANDROID_TEMP_ROOT: slot.tempRoot,
    MYCHAMPIONS_ANDROID_USER_HOME: slot.userHome,
    MYCHAMPIONS_NATIVE_STATE_ROOT: slot.recoveryRoot,
  };
}

function fail(message: string): never {
  throw new Error(`Android runner slot validation failed: ${message}`);
}

function validatePrivateDirectory(
  name: string,
  value: string,
  workspace: string,
  runnerTemp: string,
): void {
  let metadata: ReturnType<typeof lstatSync>;
  let canonical: string;
  try {
    metadata = lstatSync(value);
    canonical = realpathSync(value);
  } catch {
    fail(`${name} must be an existing directory: ${value}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${name} must be a non-symlink directory: ${value}`);
  }
  if (canonical !== value) fail(`${name} must be canonical and non-symlink: ${value}`);
  if (
    canonical === workspace ||
    canonical.startsWith(`${workspace}/`) ||
    canonical === runnerTemp ||
    canonical.startsWith(`${runnerTemp}/`)
  ) {
    fail(`${name} must remain outside GITHUB_WORKSPACE and RUNNER_TEMP`);
  }
  const canonicalMetadata = statSync(canonical);
  const owner = canonicalMetadata.uid;
  if (typeof process.getuid === 'function' && owner !== process.getuid()) {
    fail(`${name} must be owned by the runner user`);
  }
  if ((canonicalMetadata.mode & 0o777) !== 0o700) {
    fail(`${name} must have mode 0700`);
  }
}

function commandOutput(command: string, args: string[], environment: NodeJS.ProcessEnv): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`${command} ${args.join(' ')} failed: ${detail}`);
  }
}

function validateHost(slot: AndroidRunnerSlot, environment: NodeJS.ProcessEnv): void {
  const workspace = requiredAbsolutePath(environment, 'GITHUB_WORKSPACE');
  const runnerTemp = requiredAbsolutePath(environment, 'RUNNER_TEMP');
  for (const [name, value] of [
    ['MYCHAMPIONS_ANDROID_AVD_HOME', slot.avdHome],
    ['MYCHAMPIONS_ANDROID_USER_HOME', slot.userHome],
    ['MYCHAMPIONS_ANDROID_RECOVERY_ROOT', slot.recoveryRoot],
    ['MYCHAMPIONS_ANDROID_LOG_ROOT', slot.logRoot],
    ['MYCHAMPIONS_ANDROID_TEMP_ROOT', slot.tempRoot],
    ['MYCHAMPIONS_ANDROID_LOCK_ROOT', slot.lockRoot],
  ] as const) {
    validatePrivateDirectory(name, value, workspace, runnerTemp);
  }

  if (process.platform !== 'linux') fail('the Android slot must run on Linux');
  try {
    accessSync('/dev/kvm', fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    fail('/dev/kvm must be readable and writable by the runner user');
  }

  const sdkRoot = environment.ANDROID_SDK_ROOT || environment.ANDROID_HOME;
  if (!sdkRoot) fail('ANDROID_SDK_ROOT or ANDROID_HOME is required');
  if (!isAbsolute(sdkRoot)) fail('ANDROID_SDK_ROOT or ANDROID_HOME must be absolute');
  const emulatorPath = resolve(sdkRoot, 'emulator', 'emulator');
  const emulatorEnvironment = {
    ...environment,
    ANDROID_AVD_HOME: slot.avdHome,
    ANDROID_EMULATOR_HOME: slot.userHome,
    ANDROID_USER_HOME: slot.userHome,
  };
  const availableAvds = commandOutput(emulatorPath, ['-list-avds'], emulatorEnvironment)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!availableAvds.includes(slot.avd)) {
    fail(`configured AVD ${slot.avd} is not available in the slot AVD home`);
  }
  const acceleration = commandOutput(emulatorPath, ['-accel-check'], emulatorEnvironment);
  if (!/kvm.*usable|accel.*usable/i.test(acceleration)) {
    fail('emulator -accel-check did not report usable KVM acceleration');
  }

  for (const port of [
    slot.emulatorPort,
    slot.emulatorPort + 1,
    slot.adbServerPort,
    slot.metroPort,
  ]) {
    const listeners = commandOutput('ss', ['-H', '-ltn', `( sport = :${port} )`], environment);
    if (listeners.trim()) fail(`configured port ${port} is already occupied`);
  }
}

export function writeAndroidRunnerSlotEnvironment(
  environment: NodeJS.ProcessEnv,
  target: string,
): AndroidRunnerSlot {
  const slot = parseAndroidRunnerSlot(environment);
  validateHost(slot, environment);
  const entries = androidRunnerSlotEnvironment(slot);
  appendFileSync(
    target,
    `${Object.entries(entries)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')}\n`,
    { encoding: 'utf8' },
  );
  return slot;
}

function main(): void {
  const githubEnv = requiredAbsolutePath(process.env, 'GITHUB_ENV');
  const slot = writeAndroidRunnerSlotEnvironment(process.env, githubEnv);
  console.log(
    `Validated ${slot.slotId}: AVD ${slot.avd}, emulator ${slot.emulatorSerial}, ADB ${slot.adbServerPort}, Metro ${slot.metroPort}`,
  );
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) main();

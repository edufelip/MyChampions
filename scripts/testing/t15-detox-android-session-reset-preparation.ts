import { createHash } from 'node:crypto';
import { chmod, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { androidMetroPreference, assertAndroidReverseMappings } from './android-build-identity';
import type {
  DetoxAndroidOwnedCommandExecution,
  DetoxAndroidSessionStorageBinding,
} from './detox-android-session-storage-producer';
import type { DetoxOwnedTarget } from './detox-integrated-session-baseline';
import type { ColdResetPreparationExpectation } from './t15-cold-android-reset-producer';

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;

type AndroidTargetWithResetFacts = DetoxOwnedTarget & {
  platform: 'android';
  androidTargetRunId?: string;
  androidOsVersion?: string;
  androidSessionStorage: NonNullable<DetoxOwnedTarget['androidSessionStorage']>;
};

export type T15AndroidSessionResetPreparationInput = Readonly<{
  artifactRoot: string;
  captureRunId: string;
  ownerRunId: string;
  target: AndroidTargetWithResetFacts;
  appId: string;
  binaryPath: string;
  binaryHash: string;
  buildProfile: string;
  metroPort: number;
  apiOrigin: string;
  binding: DetoxAndroidSessionStorageBinding;
  /** Cold-route binding; unused by the preparation steps themselves. */
  expectation?: ColdResetPreparationExpectation;
  /** Detox instrumentation APK; android.attached does not install it. */
  testBinaryPath?: string;
  deadlineMs: number;
  signal: AbortSignal;
}>;

export type T15AndroidSessionResetPreparationResult = Readonly<{
  installedApk: Readonly<{ path: string; sha256: string; sizeBytes: number }>;
  commandExecutions: readonly Readonly<{
    label: string;
    execution: DetoxAndroidOwnedCommandExecution['execution'];
    cleanup: DetoxAndroidOwnedCommandExecution['cleanup'];
    pid: number | null;
    pgid: number | null;
    commandHash?: string | null;
    ownerRunId: string;
    ownershipPath: string | null;
  }>[];
  preference: Readonly<{ relativePath: string; xml: string }>;
}>;

function requireHash(value: string, label: string): void {
  if (!HASH.test(value)) throw new Error(`${label} must be a SHA-256 hash`);
}

function requireRunId(value: string, label: string): void {
  if (!RUN_ID.test(value)) throw new Error(`${label} must be a 24-character run ID`);
}

function requirePrivateDirectChild(root: string, value: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(value);
  if (path.dirname(resolved) !== resolvedRoot || path.basename(resolved).includes('/'))
    throw new Error(`${label} must be a direct child of the capture root`);
  return resolved;
}

function requireCompleted(
  label: string,
  execution: DetoxAndroidOwnedCommandExecution,
): DetoxAndroidOwnedCommandExecution {
  const pid = execution.pid;
  const pgid = execution.pgid;
  if (
    execution.execution !== 'completed' ||
    execution.cleanup !== 'cleaned' ||
    execution.childExitCode !== 0 ||
    execution.childSignal !== null ||
    !Number.isSafeInteger(execution.pid) ||
    !Number.isSafeInteger(execution.pgid) ||
    (pid ?? 0) <= 1 ||
    (pgid ?? 0) <= 1 ||
    execution.censusFailure != null ||
    execution.outputFailure != null
  )
    throw new Error(`Android session reset command ${label} did not complete under owned cleanup`);
  return execution;
}

function commandRow(
  ownerRunId: string,
  label: string,
  execution: DetoxAndroidOwnedCommandExecution,
) {
  return {
    label,
    execution: execution.execution,
    cleanup: execution.cleanup,
    pid: execution.pid,
    pgid: execution.pgid,
    commandHash: execution.commandHash,
    ownerRunId,
    ownershipPath: execution.ownershipPath,
  } as const;
}

async function runAdb(
  input: T15AndroidSessionResetPreparationInput,
  label: string,
  argv: readonly string[],
  stdoutName: string,
  extra: { input?: string } = {},
): Promise<DetoxAndroidOwnedCommandExecution> {
  input.signal.throwIfAborted();
  await input.target.androidSessionStorage.verify();
  const stdoutPath = requirePrivateDirectChild(
    input.artifactRoot,
    path.join(input.artifactRoot, stdoutName),
    `${label} stdout`,
  );
  const execution = await input.target.androidSessionStorage.runAdb({
    label,
    argv,
    artifactRoot: input.artifactRoot,
    deadlineMs: input.deadlineMs,
    signal: input.signal,
    input: extra.input,
    stdoutPath,
    target: {
      serial: input.target.androidSessionStorage.serial,
      adbServerPort: input.target.androidSessionStorage.adbServerPort,
    },
    binding: input.binding,
  });
  return requireCompleted(label, execution);
}

async function stdout(
  execution: DetoxAndroidOwnedCommandExecution,
  label: string,
): Promise<string> {
  if (!execution.stdoutPath) throw new Error(`${label} did not publish stdout`);
  return (await readFile(execution.stdoutPath, 'utf8')).trim();
}

function requireRemoteApkPath(value: string): string {
  const match = /^package:(\/data\/app\/[A-Za-z0-9_~+=/.-]+\/base\.apk)\s*$/mu.exec(value);
  if (!match)
    throw new Error('Android installed APK path is not bound to the package manager result');
  return match[1];
}

/**
 * Performs the Android session install/reverse/preferences preparation through
 * the already acquired target and backend binding. It does not acquire a
 * target, backend, proxy, or port, and it emits no public/native result.
 */
export async function prepareT15AndroidSessionColdReset(
  input: T15AndroidSessionResetPreparationInput,
): Promise<T15AndroidSessionResetPreparationResult> {
  requireRunId(input.captureRunId, 'captureRunId');
  requireRunId(input.ownerRunId, 'ownerRunId');
  requireHash(input.binaryHash, 'binaryHash');
  requireHash(input.binding.manifestSha256, 'backend manifest hash');
  if (
    input.target.platform !== 'android' ||
    input.target.androidSessionStorage.appId !== input.appId ||
    input.target.androidSessionStorage.serial !== input.target.deviceId ||
    !input.target.androidTargetRunId ||
    !input.target.androidOsVersion
  )
    throw new Error('Android reset preparation lacks the current target owner identity');
  if (!path.isAbsolute(input.binaryPath))
    throw new Error('Android reset binary path is not absolute');
  if (!Number.isSafeInteger(input.metroPort) || input.metroPort < 1024 || input.metroPort > 49151)
    throw new Error('Android reset Metro port is invalid');
  input.signal.throwIfAborted();

  const commands: T15AndroidSessionResetPreparationResult['commandExecutions'][number][] = [];
  const execute = async (
    label: string,
    argv: readonly string[],
    stdoutName: string,
    extra: { input?: string } = {},
  ) => {
    const execution = await runAdb(input, label, argv, stdoutName, extra);
    commands.push(commandRow(input.ownerRunId, label, execution));
    return execution;
  };

  const install = await execute(
    'android-install',
    ['install', '-r', '-d', input.binaryPath],
    'android-install.stdout',
  );
  if (!/Success\s*$/u.test(await stdout(install, 'android-install')))
    throw new Error('Android install did not report Success');
  if (input.testBinaryPath !== undefined) {
    if (!path.isAbsolute(input.testBinaryPath))
      throw new Error('Android reset test binary path is not absolute');
    const testInstall = await execute(
      'android-test-install',
      ['install', '-r', '-d', input.testBinaryPath],
      'android-test-install.stdout',
    );
    if (!/Success\s*$/u.test(await stdout(testInstall, 'android-test-install')))
      throw new Error('Android test APK install did not report Success');
  }

  const packagePath = await execute(
    'android-installed-path',
    ['shell', 'pm', 'path', input.appId],
    'android-installed-path.stdout',
  );
  const remoteApkPath = requireRemoteApkPath(await stdout(packagePath, 'android-installed-path'));
  const installedPath = requirePrivateDirectChild(
    input.artifactRoot,
    path.join(input.artifactRoot, 'installed-base.apk'),
    'installed APK',
  );
  const installed = await execute(
    'android-installed-build',
    ['pull', remoteApkPath, installedPath],
    'android-installed-build.stdout',
  );
  // adb reports "1 file pulled" on stderr, not stdout; the byte hash below is
  // the binding proof, so only require the pull to have produced the file.
  await stdout(installed, 'android-installed-build');
  if (!(await stat(installedPath).catch(() => null))?.isFile())
    throw new Error('Android installed APK pull did not report a completed file');
  await chmod(installedPath, 0o600);
  const installedBytes = await readFile(installedPath);
  const installedHash = createHash('sha256').update(installedBytes).digest('hex');
  if (installedHash !== input.binaryHash)
    throw new Error('Android installed APK bytes differ from the qualified build');

  const apiPort = Number(new URL(input.apiOrigin).port);
  if (!Number.isSafeInteger(apiPort) || apiPort < 1024 || apiPort > 49151)
    throw new Error('Android reset API origin has no owned port');
  for (const [label, port] of [
    ['android-reverse-metro', input.metroPort],
    ['android-reverse-api', apiPort],
  ] as const) {
    await execute(
      label,
      ['reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`],
      `${label}.stdout`,
    );
  }
  const reverseList = await execute(
    'android-reverse-list',
    ['reverse', '--list'],
    'android-reverse-list.stdout',
  );
  assertAndroidReverseMappings(
    await stdout(reverseList, 'android-reverse-list'),
    input.target.androidSessionStorage.serial,
    [input.metroPort, apiPort],
  );

  const preference = androidMetroPreference(input.appId, input.metroPort);
  await execute(
    'android-prefs-directory',
    ['shell', 'run-as', input.appId, 'mkdir', '-p', 'shared_prefs'],
    'android-prefs-directory.stdout',
  );
  const preferenceWrite = await execute(
    'android-metro-prefs',
    ['shell', 'run-as', input.appId, 'tee', preference.relativePath],
    'android-metro-prefs.stdout',
    { input: preference.xml },
  );
  const expectedInputHash = createHash('sha256').update(preference.xml).digest('hex');
  if (preferenceWrite.inputSha256 !== expectedInputHash)
    throw new Error('Android Metro preference stdin hash is not bound to the expected XML');
  const preferenceReadback = await execute(
    'android-metro-prefs-readback',
    ['shell', 'run-as', input.appId, 'cat', preference.relativePath],
    'android-metro-prefs-readback.stdout',
  );
  if ((await stdout(preferenceReadback, 'android-metro-prefs-readback')) !== preference.xml.trim())
    throw new Error('Android Metro preference was not persisted exactly');

  input.signal.throwIfAborted();
  return Object.freeze({
    installedApk: Object.freeze({
      path: installedPath,
      sha256: installedHash,
      sizeBytes: installedBytes.byteLength,
    }),
    commandExecutions: Object.freeze(commands),
    preference,
  });
}

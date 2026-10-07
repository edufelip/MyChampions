import { createHash } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  buildDetoxAndroidStorageCommandHash,
  type DetoxAndroidOwnedCommandExecution,
  type DetoxAndroidSessionStorageBinding,
  type DetoxAndroidSessionStorageTarget,
} from './detox-android-session-storage-producer';
import { requireAndroidDetoxCameraIdentityBoundary } from './native-detox-camera-android-identity';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import type {
  ColdResetPreparationExpectation,
  FreshColdResetWithRuntimeBinding,
} from './t15-cold-ios-reset-producer';

export type { ColdResetPreparationExpectation } from './t15-cold-ios-reset-producer';

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const ATTEMPT_ID = /^[a-f0-9]{24}:(?:first|second)$/u;
const RESET_RECEIPT = 'reset-original.private.json';
type Row = Record<string, unknown>;

type AndroidTarget = {
  identity: { serial: string };
  osVersion: string;
  runId: string;
  verify: (phaseDeadline?: number) => Promise<void>;
  androidSessionStorage: DetoxAndroidSessionStorageTarget;
};

type AndroidSession = {
  manifest: {
    runId: string;
    artifactRoot: string;
    composeProject: string;
    processes: readonly Row[];
  };
  apiOrigin: string;
  apiPid: number;
  probeApiLifetime: (signal?: AbortSignal) => Promise<{
    runId: string;
    apiOrigin: string;
    apiPid: number;
    apiStarted: string;
    apiScript: string;
    backendAttemptId: string;
    manifestSha256: string;
  }>;
  snapshotWithEvidence: (
    scope: string,
    signal?: AbortSignal,
  ) => Promise<{ value: unknown; receipt: unknown }>;
};

type AndroidProxy = {
  runId: string;
  origin: string;
  waitForQuiescence: (
    deadlineMs: number,
    signal?: AbortSignal,
  ) => Promise<{ active: number; outbound: number }>;
};

type AndroidProxyProcess = {
  pid: number;
  started: string;
  script: string;
};

type OwnedCommand = {
  label: string;
  execution: string;
  cleanup: string;
  pid: number | null;
  pgid: number | null;
  commandHash?: string | null;
  ownerRunId?: string | null;
  ownershipPath?: string | null;
};

export type AndroidColdResetContext = {
  expectation: ColdResetPreparationExpectation;
  outputRoot: string;
  captureRunId: string;
  ownerRunId: string;
  deadlineAtMonotonicMs?: number;
  resetStartedAt: string;
  target: AndroidTarget;
  session: AndroidSession;
  proxy: AndroidProxy;
  proxyProcess: AndroidProxyProcess;
  fixtures: Row & { runId: string; scope: string; resetId: string };
  build: {
    appId: string;
    buildProfile: string;
    binaryHash: string;
    apiOrigin: string;
  };
  installedApk: { path: string; sha256: string; sizeBytes: number };
  commandExecutions: readonly OwnedCommand[];
  signal: AbortSignal;
  now?: () => string;
};

export type AndroidColdResetOwnership = Readonly<{
  backendProcesses: readonly Row[];
  listeners: readonly Row[];
  proxyProcess: Row;
  commandLabels: readonly string[];
}>;

export type AndroidColdResetResult = FreshColdResetWithRuntimeBinding &
  Readonly<{
    ownership: AndroidColdResetOwnership;
    receiptPath: string;
    receiptHash: string;
    identity: NativeEvidenceIdentity;
  }>;

function row(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Row;
}

function text(value: unknown, label: string, max = 4096): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    /[\0\r\n]/u.test(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
}

function hash(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!HASH.test(result)) throw new Error(`${label} is not a SHA-256 hash`);
  return result;
}

function runId(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!RUN_ID.test(result)) throw new Error(`${label} is not a run ID`);
  return result;
}

function attemptId(value: unknown, label: string): string {
  const result = text(value, label, 80);
  if (!ATTEMPT_ID.test(result)) throw new Error(`${label} is not an attempt ID`);
  return result;
}

function iso(value: unknown, label: string): string {
  const result = text(value, label, 128);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid`);
  return result;
}

function canonical(value: unknown, label: string): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(`${label} is not serializable: ${String(error)}`);
  }
  if (!serialized) throw new Error(`${label} is empty`);
  return serialized;
}

function sha(value: unknown, label: string): string {
  return createHash('sha256').update(canonical(value, label)).digest('hex');
}

function port(origin: string, label: string): number {
  const parsed = new URL(origin);
  const value = Number(parsed.port);
  if (!Number.isInteger(value) || value <= 0 || value >= 65536)
    throw new Error(`${label} has no usable port`);
  return value;
}

function abort(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function requireCommand(
  rows: readonly OwnedCommand[],
  label: string,
  ownerRunId: string,
): OwnedCommand {
  const matches = rows.filter((entry) => entry.label === label);
  if (matches.length !== 1) throw new Error(`Android reset command ${label} is not unique`);
  const command = matches[0];
  if (command.execution !== 'completed' || command.cleanup !== 'cleaned')
    throw new Error(`Android reset command ${label} did not close cleanly`);
  if (!Number.isSafeInteger(command.pid) || (command.pid as number) <= 1)
    throw new Error(`Android reset command ${label} has no owned process`);
  if (command.ownerRunId !== undefined && command.ownerRunId !== null) {
    if (command.ownerRunId !== ownerRunId)
      throw new Error(`Android reset command ${label} owner differs`);
  }
  return command;
}

function buildStorageBinding(
  session: AndroidSession,
  fixtures: Row,
  probe: Awaited<ReturnType<AndroidSession['probeApiLifetime']>>,
  proxy: AndroidProxy,
  signal: AbortSignal,
): DetoxAndroidSessionStorageBinding {
  const accounts = row(fixtures.accounts, 'Android reset fixtures.accounts');
  const authUids = Object.entries(accounts)
    .map(([key, value]) =>
      text(
        row(value, `Android reset fixtures.accounts.${key}`).authUid,
        `Android reset fixtures.accounts.${key}.authUid`,
        512,
      ),
    )
    .sort();
  if (authUids.length === 0) throw new Error('Android reset fixture auth UID allowlist is empty');
  const fixtureAuthUidAllowlistHash = createHash('sha256')
    .update(JSON.stringify(authUids))
    .digest('hex');
  return {
    runId: session.manifest.runId,
    scope: 'native-entry-android',
    apiOrigin: probe.apiOrigin,
    apiPid: probe.apiPid,
    backendAttemptId: probe.backendAttemptId,
    manifestSha256: probe.manifestSha256,
    fixtureAuthUidAllowlistHash,
    waitForQuiescence: async () => {
      signal.throwIfAborted();
      const quiet = await proxy.waitForQuiescence(5_000, signal);
      signal.throwIfAborted();
      if (quiet.active !== 0 || quiet.outbound !== 0)
        throw new Error('Android reset storage binding observed active proxy work');
    },
  };
}

function privateChildPath(value: string | null, outputRoot: string, label: string): string {
  if (!value) throw new Error(`Android reset ${label} receipt is missing`);
  const resolved = path.resolve(value);
  if (
    !path.isAbsolute(value) ||
    path.dirname(resolved) !== outputRoot ||
    path.basename(resolved) !== path.basename(value)
  )
    throw new Error(`Android reset ${label} receipt escaped the capture root`);
  return resolved;
}

function requireResetCommand(
  execution: DetoxAndroidOwnedCommandExecution,
  outputRoot: string,
  appId: string,
  target: DetoxAndroidSessionStorageTarget,
  binding: DetoxAndroidSessionStorageBinding,
): Row {
  const expectedArgv = [
    '-H',
    '127.0.0.1',
    '-P',
    String(target.adbServerPort),
    '-s',
    target.serial,
    'shell',
    'pm',
    'clear',
    appId,
  ];
  if (
    execution.phase !== 'step' ||
    execution.execution !== 'completed' ||
    execution.cleanup !== 'cleaned' ||
    execution.childExitCode !== 0 ||
    execution.childSignal !== null ||
    !Number.isSafeInteger(execution.pid) ||
    !Number.isSafeInteger(execution.pgid) ||
    (execution.pid as number) <= 1 ||
    (execution.pgid as number) <= 1 ||
    !path.isAbsolute(execution.command) ||
    !execution.command.endsWith('/platform-tools/adb') ||
    JSON.stringify(execution.argv) !== JSON.stringify(expectedArgv) ||
    execution.target.serial !== target.serial ||
    execution.target.adbServerPort !== target.adbServerPort ||
    execution.binding.runId !== binding.runId ||
    execution.binding.scope !== binding.scope ||
    execution.binding.apiOrigin !== binding.apiOrigin ||
    execution.binding.apiPid !== binding.apiPid ||
    execution.binding.backendAttemptId !== binding.backendAttemptId ||
    execution.binding.manifestSha256 !== binding.manifestSha256 ||
    execution.binding.fixtureAuthUidAllowlistHash !== binding.fixtureAuthUidAllowlistHash ||
    execution.censusFailure != null ||
    execution.outputFailure != null ||
    !path.isAbsolute(execution.cwd) ||
    !Number.isSafeInteger(execution.deadlineMs) ||
    execution.deadlineMs < 100 ||
    !HASH.test(execution.commandHash) ||
    execution.argv.includes('sh') ||
    execution.argv.includes('-c')
  )
    throw new Error('Android reset app-state command was not the completed owned pm clear action');
  const expectedHash = buildDetoxAndroidStorageCommandHash({
    command: execution.command,
    argv: execution.argv,
    cwd: execution.cwd,
    deadlineMs: execution.deadlineMs,
    phase: execution.phase,
    target: execution.target,
    binding: execution.binding,
  });
  if (execution.commandHash !== expectedHash)
    throw new Error('Android reset app-state command descriptor hash is invalid');
  const stdoutPath = privateChildPath(execution.stdoutPath, outputRoot, 'app-state stdout');
  const logPath = privateChildPath(execution.logPath, outputRoot, 'app-state log');
  const ownershipPath = privateChildPath(
    execution.ownershipPath,
    outputRoot,
    'app-state ownership',
  );
  const stdoutObservation = readNativeEvidenceObservation(
    outputRoot,
    path.basename(stdoutPath),
    true,
  );
  if (stdoutObservation.bytes.toString('utf8').trim() !== 'Success')
    throw new Error('Android reset app-state command did not report pm clear Success');
  const ownershipObservation = readNativeEvidenceObservation(
    outputRoot,
    path.basename(ownershipPath),
    true,
  );
  const ownership = row(
    JSON.parse(ownershipObservation.bytes.toString('utf8')),
    'Android reset app-state ownership receipt',
  );
  const processes = Array.isArray(ownership.processes) ? ownership.processes : [];
  const process = processes.find(
    (value) =>
      value &&
      typeof value === 'object' &&
      (value as Row).pid === execution.pid &&
      (value as Row).pgid === execution.pgid,
  ) as Row | undefined;
  if (
    ownership.kind !== 'private worker process ownership' ||
    ownership.cleanup !== 'cleaned' ||
    ownership.pid !== execution.pgid ||
    ownership.pgid !== execution.pgid ||
    !process ||
    typeof process.commandHash !== 'string' ||
    !HASH.test(process.commandHash) ||
    process.commandHash !== execution.commandHash ||
    typeof process.started !== 'string' ||
    process.started.length === 0
  )
    throw new Error('Android reset app-state ownership receipt is incomplete');
  return {
    label: 'android-reset-app-state',
    phase: execution.phase,
    execution: execution.execution,
    cleanup: execution.cleanup,
    childExitCode: execution.childExitCode,
    childSignal: execution.childSignal,
    pid: execution.pid,
    pgid: execution.pgid,
    command: execution.command,
    argv: [...execution.argv],
    cwd: execution.cwd,
    deadlineMs: execution.deadlineMs,
    commandHash: execution.commandHash,
    processCommandHash: process.commandHash,
    started: process.started,
    stdoutPath,
    stdoutSha256: createHash('sha256').update(stdoutObservation.bytes).digest('hex'),
    stdoutIdentity: stdoutObservation.identity,
    logPath,
    ownershipPath,
    target: { ...execution.target },
    binding: { ...execution.binding },
    outcome: 'Success',
  };
}

function ownedProcesses(rows: readonly Row[], expectedRunId: string): readonly Row[] {
  if (rows.length === 0) throw new Error('Android reset backend process ledger is empty');
  return rows.map((entry, index) => {
    const value = row(entry, `backend.processes[${index}]`);
    const pid = value.pid;
    if (!Number.isSafeInteger(pid) || (pid as number) <= 1)
      throw new Error('Android reset backend process PID is invalid');
    const started = text(value.started ?? value.startedAt, `backend.processes[${index}].started`);
    const script = text(value.script ?? value.command, `backend.processes[${index}].script`);
    const owner = value.ownerRunId;
    if (owner !== undefined && owner !== expectedRunId)
      throw new Error('Android reset backend process owner differs');
    return { ...value, pid, started, script, ownerRunId: expectedRunId };
  });
}

/**
 * Produce the reset checkpoint from the already-owned Android capture. The
 * function consumes the same target/backend/proxy handles that will execute
 * the scenario; it cannot create a second reset namespace or accept a caller
 * shaped reset object as evidence.
 */
export async function produceAndroidColdReset(
  context: AndroidColdResetContext,
): Promise<AndroidColdResetResult> {
  const expectation = context.expectation;
  const ownerRunId = runId(context.ownerRunId, 'Android reset ownerRunId');
  const requestedRunId = runId(expectation.requestedRunId, 'reset requestedRunId');
  if (ownerRunId === requestedRunId)
    throw new Error('Android reset resource owner must be distinct from the outer attempt');
  attemptId(expectation.requestedAttemptId, 'reset requestedAttemptId');
  text(expectation.fixtureResetId, 'reset fixtureResetId', 256);
  hash(expectation.cohortFixtureFingerprint, 'reset cohortFixtureFingerprint');
  hash(expectation.sourceFingerprint, 'reset sourceFingerprint');
  hash(expectation.helperFingerprint, 'reset helperFingerprint');
  const captureRunId = runId(context.captureRunId, 'Android reset captureRunId');
  if (ownerRunId === captureRunId)
    throw new Error('Android reset resource owner must be distinct from the capture run');
  const outputRoot = path.resolve(text(context.outputRoot, 'Android reset outputRoot'));
  if (path.basename(outputRoot) !== captureRunId)
    throw new Error('Android reset output root is not bound to captureRunId');
  const outputInfo = await lstat(outputRoot);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink() || (outputInfo.mode & 0o077) !== 0)
    throw new Error('Android reset output root is not a private directory');
  if (!Number.isSafeInteger(context.proxyProcess.pid) || context.proxyProcess.pid <= 1)
    throw new Error('Android reset capture process PID is invalid');
  text(context.proxyProcess.started, 'Android reset capture process started', 256);
  text(context.proxyProcess.script, 'Android reset capture process script', 2048);
  abort(context.signal);
  const startedAt = iso(context.resetStartedAt, 'Android reset startedAt');
  const target = context.target;
  const targetVerifyBudget =
    context.deadlineAtMonotonicMs === undefined
      ? undefined
      : Math.floor(context.deadlineAtMonotonicMs - performance.now());
  if (targetVerifyBudget !== undefined && targetVerifyBudget <= 0)
    throw new Error('Android reset outer deadline expired before target verification');
  await target.verify(targetVerifyBudget);
  const deviceId = text(target.identity.serial, 'Android reset target deviceId', 256);
  const targetRunId = runId(target.runId, 'Android reset target runId');
  const osVersion = text(target.osVersion, 'Android reset target osVersion', 256);
  const appId = text(context.build.appId, 'Android reset appId', 256);
  const buildProfile = text(context.build.buildProfile, 'Android reset buildProfile', 256);
  const binaryHash = hash(context.build.binaryHash, 'Android reset binaryHash');
  const apiOrigin = text(context.proxy.origin, 'Android reset proxy origin', 512);
  if (context.build.apiOrigin !== apiOrigin)
    throw new Error('Android reset build API origin differs from proxy');
  const storage = context.target.androidSessionStorage;
  if (storage.serial !== deviceId || storage.appId !== appId)
    throw new Error('Android reset storage target differs from the acquired Android target');
  if (context.proxy.runId !== context.session.manifest.runId)
    throw new Error('Android reset proxy is not bound to backend session');
  const backendRunId = runId(context.session.manifest.runId, 'Android reset backend runId');
  if (
    backendRunId === requestedRunId ||
    backendRunId === captureRunId ||
    backendRunId === ownerRunId
  )
    throw new Error(
      'Android reset backend runId must be distinct from outer/capture/resource owners',
    );
  if (
    targetRunId === requestedRunId ||
    targetRunId === captureRunId ||
    targetRunId === ownerRunId ||
    targetRunId === backendRunId
  )
    throw new Error('Android reset target runId must be distinct from all owner lifecycles');
  requireAndroidDetoxCameraIdentityBoundary({
    requestedRunId,
    captureRunId,
    ownerRunId,
    backendRunId,
  });
  if (context.fixtures.scope !== 'native-entry-android')
    throw new Error('Android reset fixture scope is not the owned Android scope');
  if (runId(context.fixtures.runId, 'Android reset fixture runId') !== backendRunId)
    throw new Error('Android reset fixture is not from this backend session');
  if (context.fixtures.resetId !== expectation.fixtureResetId)
    throw new Error('Android reset fixture identity is missing or crossed with the requested slot');
  const backendProbe = await context.session.probeApiLifetime(context.signal);
  abort(context.signal);
  if (
    backendProbe.runId !== context.session.manifest.runId ||
    backendProbe.apiOrigin !== context.session.apiOrigin ||
    backendProbe.apiPid !== context.session.apiPid ||
    backendProbe.backendAttemptId !== `${context.session.manifest.runId}:first`
  )
    throw new Error('Android reset backend probe changed during checkpoint');
  const snapshot = await context.session.snapshotWithEvidence(
    context.fixtures.scope,
    context.signal,
  );
  abort(context.signal);
  const snapshotValue = row(snapshot.value, 'Android reset snapshot');
  const snapshotReceipt = row(snapshot.receipt, 'Android reset snapshot receipt');
  if (
    snapshotValue.runId !== context.session.manifest.runId ||
    snapshotValue.scope !== context.fixtures.scope ||
    snapshotReceipt.runId !== context.session.manifest.runId
  )
    throw new Error('Android reset snapshot is not backend-bound');
  const quiet = await context.proxy.waitForQuiescence(5_000, context.signal);
  abort(context.signal);
  if (quiet.active !== 0 || quiet.outbound !== 0)
    throw new Error('Android reset proxy was not quiescent');
  const requiredCommands = [
    'android-install',
    'android-installed-build',
    'android-reverse-metro',
    'android-reverse-api',
    'android-prefs-directory',
    'android-metro-prefs',
  ];
  for (const label of requiredCommands)
    requireCommand(context.commandExecutions, label, ownerRunId);
  const installed = context.installedApk;
  if (!path.isAbsolute(installed.path) || path.basename(installed.path) !== 'installed-base.apk')
    throw new Error('Android reset installed APK path is not capture-bound');
  if (path.dirname(installed.path) !== outputRoot)
    throw new Error('Android reset installed APK path escaped the capture root');
  if (!HASH.test(installed.sha256) || installed.sha256 !== binaryHash)
    throw new Error('Android reset installed APK bytes differ from build');
  if (!Number.isSafeInteger(installed.sizeBytes) || installed.sizeBytes <= 0)
    throw new Error('Android reset installed APK size is invalid');
  const installedInfo = await lstat(installed.path);
  if (
    installedInfo.isSymbolicLink() ||
    !installedInfo.isFile() ||
    installedInfo.nlink !== 1 ||
    installedInfo.size !== installed.sizeBytes ||
    (installedInfo.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && installedInfo.uid !== process.getuid())
  )
    throw new Error('Android reset installed APK changed or is not a private owned file');
  const backendProcesses = ownedProcesses(
    context.session.manifest.processes,
    context.session.manifest.runId,
  );
  const targetBinding: Row = {
    platform: 'android',
    deviceId,
    osVersion,
    appId,
    buildProfile,
    binaryHash,
    apiOrigin,
    captureRunId,
    ownerRunId,
    phase: 'installed-before-ui',
    targetRunId,
  };
  const backendBinding: Row = {
    runId: context.session.manifest.runId,
    ownerRunId,
    captureRunId,
    composeProject: text(context.session.manifest.composeProject, 'Android reset composeProject'),
    artifactRoot: text(context.session.manifest.artifactRoot, 'Android reset backend artifactRoot'),
    apiOrigin: backendProbe.apiOrigin,
    apiPid: backendProbe.apiPid,
    apiStarted: text(backendProbe.apiStarted, 'Android reset API started'),
    apiScript: text(backendProbe.apiScript, 'Android reset API script'),
    backendAttemptId: backendProbe.backendAttemptId,
    manifestSha256: hash(backendProbe.manifestSha256, 'Android reset backend manifest hash'),
    processes: backendProcesses,
  };
  const fixtureSnapshot = Object.fromEntries(
    Object.entries(context.fixtures).filter(([key]) => key !== 'resetId'),
  );
  const fixture = {
    runId: context.fixtures.runId,
    scope: context.fixtures.scope,
    fixtureSha256: sha(fixtureSnapshot, 'Android reset fixture'),
    snapshotSha256: sha(snapshotValue, 'Android reset snapshot'),
    snapshotReceiptSha256: sha(snapshotReceipt, 'Android reset snapshot receipt'),
  };
  const storageBinding = buildStorageBinding(
    context.session,
    context.fixtures,
    backendProbe,
    context.proxy,
    context.signal,
  );
  await storage.verify();
  await storageBinding.waitForQuiescence();
  const resetDeadlineMs =
    context.deadlineAtMonotonicMs === undefined
      ? 60_000
      : Math.floor(context.deadlineAtMonotonicMs - performance.now());
  if (!Number.isSafeInteger(resetDeadlineMs) || resetDeadlineMs < 100)
    throw new Error('Android reset outer deadline expired before app-state reset');
  const resetStdoutPath = path.join(outputRoot, 'android-reset-app-state.stdout');
  const resetExecution = await storage.runAdb({
    label: 'android-reset-app-state',
    argv: ['shell', 'pm', 'clear', appId],
    artifactRoot: outputRoot,
    deadlineMs: Math.min(resetDeadlineMs, 600_000),
    signal: context.signal,
    stdoutPath: resetStdoutPath,
    target: { serial: storage.serial, adbServerPort: storage.adbServerPort },
    binding: storageBinding,
  });
  const resetAction = requireResetCommand(
    resetExecution,
    outputRoot,
    appId,
    storage,
    storageBinding,
  );
  abort(context.signal);
  const appState = {
    phase: 'installed-before-ui',
    appId,
    buildProfile,
    binaryPath: installed.path,
    binaryHash,
    installedApkSizeBytes: installed.sizeBytes,
    installCommands: requiredCommands,
    resetAction,
    resetOutcome: 'Success',
  };
  const appStateFingerprint = sha(
    { target: targetBinding, build: context.build, appState },
    'Android reset app state',
  );
  const fixtureStateFingerprint = sha(
    { fixture, snapshot: snapshotValue, snapshotReceipt },
    'Android reset fixture state',
  );
  const finishedAt = context.now
    ? iso(context.now(), 'Android reset finishedAt')
    : new Date().toISOString();
  if (Date.parse(finishedAt) < Date.parse(startedAt))
    throw new Error('Android reset finished before start');
  const ownership = {
    backendProcesses,
    listeners: [
      {
        resourceType: 'port',
        resourceId: String(port(backendProbe.apiOrigin, 'Android reset backend origin')),
        ownerRunId,
        state: 'active',
        process: {
          pid: backendProbe.apiPid,
          started: backendProbe.apiStarted,
          script: backendProbe.apiScript,
        },
      },
      {
        resourceType: 'port',
        resourceId: String(port(apiOrigin, 'Android reset proxy origin')),
        ownerRunId,
        state: 'active',
        process: {
          pid: context.proxyProcess.pid,
          started: context.proxyProcess.started,
          script: context.proxyProcess.script,
        },
      },
    ],
    proxyProcess: { ...context.proxyProcess },
    commandLabels: [...requiredCommands, 'android-reset-app-state'],
  };
  const receipt: Row = {
    kind: 'private-t15-cold-reset-original-from-owned-android-session',
    schemaVersion: 1,
    status: 'fresh',
    requestedRunId: expectation.requestedRunId,
    requestedAttemptId: expectation.requestedAttemptId,
    fixtureResetId: expectation.fixtureResetId,
    ownerRunId,
    captureRunId,
    startedAt,
    finishedAt,
    target: targetBinding,
    backend: backendBinding,
    fixture,
    appState,
    appStateFingerprint,
    fixtureStateFingerprint,
    sourceFingerprint: expectation.sourceFingerprint,
    helperFingerprint: expectation.helperFingerprint,
    cohortFixtureFingerprint: expectation.cohortFixtureFingerprint,
    ownership,
    cleanupStatus: 'cleaned',
    resourceCleanupStatus: 'deferred-to-capture-finalizer',
    blocker: null,
  };
  const receiptBytes = Buffer.from(canonical(receipt, 'Android reset receipt') + '\n');
  const receiptPath = path.join(outputRoot, RESET_RECEIPT);
  await writeFile(receiptPath, receiptBytes, { flag: 'wx', mode: 0o600 });
  abort(context.signal);
  const observation = readNativeEvidenceObservation(outputRoot, RESET_RECEIPT, true);
  if (!observation.bytes.equals(receiptBytes))
    throw new Error('Android reset receipt changed during protected readback');
  const receiptHash = createHash('sha256').update(observation.bytes).digest('hex');
  return Object.freeze({
    requestedRunId: expectation.requestedRunId,
    requestedAttemptId: expectation.requestedAttemptId,
    fixtureResetId: expectation.fixtureResetId,
    fixture: structuredClone(fixture),
    ownerRunId,
    cohortFixtureFingerprint: expectation.cohortFixtureFingerprint,
    status: 'fresh' as const,
    startedAt,
    finishedAt,
    appStateFingerprint,
    fixtureStateFingerprint,
    sourceFingerprint: expectation.sourceFingerprint,
    helperFingerprint: expectation.helperFingerprint,
    originalResetBinding: {
      status: 'verified' as const,
      receiptPath,
      artifactRoot: outputRoot,
      receiptHash,
      identity: Object.freeze(observation.identity),
    },
    cleanupStatus: 'cleaned' as const,
    blocker: null,
    ownership: structuredClone(ownership),
    target: structuredClone(targetBinding),
    backend: structuredClone(backendBinding),
    receiptPath,
    receiptHash,
    identity: Object.freeze(observation.identity),
  });
}

export { RESET_RECEIPT as androidColdResetOriginalReceiptName };

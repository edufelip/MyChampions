import { createHash } from 'node:crypto';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';

const SHA256 = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const ATTEMPT_ID = /^[a-f0-9]{24}:(?:first|second)$/u;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const RESET_RECEIPT_NAME = 'reset-original.private.json';

type Row = Record<string, unknown>;

export type ColdResetPreparationExpectation = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  fixtureResetId: string;
  cohortFixtureFingerprint: string;
  sourceFingerprint: string;
  helperFingerprint: string;
}>;

export type OwnedResetProcess = Readonly<{
  pid: number;
  started: string;
  script: string;
}>;

export type OwnedResetProcessRow = OwnedResetProcess &
  Readonly<{
    role: string;
  }>;

export type OwnedResetPathIdentity = Readonly<{
  path: string;
  realpath: string;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
}>;

export type ColdResetRuntimeBinding = Readonly<{
  target: Row;
  backend: Row;
}>;

export type FreshColdResetWithRuntimeBinding = Readonly<{
  requestedRunId: string;
  requestedAttemptId: string;
  fixtureResetId: string;
  fixture: Row;
  ownerRunId: string;
  cohortFixtureFingerprint: string;
  status: 'fresh';
  startedAt: string;
  finishedAt: string;
  appStateFingerprint: string;
  fixtureStateFingerprint: string;
  sourceFingerprint: string;
  helperFingerprint: string;
  originalResetBinding: Readonly<{
    status: 'verified';
    receiptPath: string;
    artifactRoot: string;
    receiptHash: string;
    identity: NativeEvidenceIdentity;
  }>;
  cleanupStatus: 'cleaned';
  blocker: null;
  target: Row;
  backend: Row;
}>;

type OwnedDevice = {
  udid: string;
  name: string;
  runtime: string;
  deviceTypeIdentifier: string;
  verify(signal?: AbortSignal): Promise<void>;
  inspect(signal?: AbortSignal): Promise<{
    udid: string;
    name: string;
    runtime: string;
    deviceTypeIdentifier: string;
    state: string;
    isAvailable: boolean;
  }>;
};

type OwnedSession = {
  manifest: {
    runId: string;
    artifactRoot: string;
    composeProject: string;
    processes: readonly (OwnedResetProcessRow & { role: string })[];
  };
  apiOrigin: string;
  apiPid: number;
  assertApiOwnership(signal?: AbortSignal): Promise<unknown>;
  probeApiLifetime(signal?: AbortSignal): Promise<{
    runId: string;
    apiOrigin: string;
    apiPid: number;
    apiStarted: string;
    apiScript: string;
    backendAttemptId: string;
    manifestSha256: string;
  }>;
  snapshotWithEvidence(
    scope: string,
    signal?: AbortSignal,
  ): Promise<{ value: unknown; receipt: unknown }>;
};

type OwnedProxy = {
  origin: string;
  runId: string;
  waitForQuiescence(
    deadlineMs: number,
    signal?: AbortSignal,
  ): Promise<{ active: number; outbound: number }>;
};

type OwnedBuild = Readonly<{
  appId: string;
  binaryHash: string;
  binaryPath: string;
}>;

type InstalledAppState = Readonly<{
  phase: 'installed-before-ui';
  appId: string;
  installedContainerPath: string;
  installExecution: Readonly<{
    execution: 'completed';
    cleanup: 'cleaned';
    pid: number;
  }>;
}>;

export type OwnedIosColdResetContext = Readonly<{
  outputRoot: string;
  captureRunId: string;
  ownerRunId: string;
  /** Timestamp captured immediately before the same-attempt install/reset work begins. */
  resetStartedAt: string;
  device: OwnedDevice;
  session: OwnedSession;
  proxy: OwnedProxy;
  fixtures: Row & { runId: string; scope: string };
  build: OwnedBuild;
  appState: InstalledAppState;
  proxyProcess: OwnedResetProcess;
  signal?: AbortSignal;
  now?: () => string;
}>;

export type OwnedIosColdResetResult = FreshColdResetWithRuntimeBinding &
  Readonly<{
    receiptPath: string;
    receiptHash: string;
    ownership: Readonly<{
      backendProcess: OwnedResetProcessRow;
      proxyProcess: OwnedResetProcessRow;
      listeners: readonly Row[];
      namespaces: Readonly<{
        capture: OwnedResetPathIdentity;
        backend: OwnedResetPathIdentity;
      }>;
    }>;
  }>;

function asRow(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Row;
}

function boundedString(value: unknown, label: string, max = 1024): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    /[\0\r\n]/u.test(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireRunId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !RUN_ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireAttemptId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ATTEMPT_ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function canonical(value: unknown, label: string): string {
  let result: string;
  try {
    result = JSON.stringify(value, (_key: string, child: unknown): unknown => {
      if (typeof child === 'bigint') throw new Error('bigint is not supported');
      return child;
    });
  } catch (error) {
    throw new Error(
      `${label} is not serializable: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
  if (result === undefined || Buffer.byteLength(result) > MAX_JSON_BYTES)
    throw new Error(`${label} exceeds the bounded evidence size`);
  return result;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function abort(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function portFromOrigin(origin: string, label: string): number {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`${label} is not a valid origin`);
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(`${label} must be a plain loopback origin`);
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error(`${label} has an invalid port`);
  return port;
}

async function canonicalPathIdentity(
  input: string,
  label: string,
): Promise<OwnedResetPathIdentity> {
  boundedString(input, label, 4096);
  if (!path.isAbsolute(input) || path.normalize(input) !== input)
    throw new Error(`${label} must be an absolute normalized path`);
  const entry = await lstat(input);
  const resolved = await realpath(input);
  if (
    entry.isSymbolicLink() ||
    resolved !== input ||
    !entry.isDirectory() ||
    (entry.mode & 0o777) !== 0o700
  )
    throw new Error(`${label} must be a canonical directory`);
  if (typeof process.getuid === 'function' && entry.uid !== process.getuid())
    throw new Error(`${label} is not owned by the current user`);
  return {
    path: input,
    realpath: resolved,
    dev: entry.dev,
    ino: entry.ino,
    uid: entry.uid,
    gid: entry.gid,
    mode: entry.mode & 0o777,
  };
}

async function installedPathIdentity(input: string): Promise<OwnedResetPathIdentity> {
  boundedString(input, 'installedContainerPath', 4096);
  if (!path.isAbsolute(input) || path.normalize(input) !== input)
    throw new Error('installedContainerPath must be absolute and normalized');
  const entry = await lstat(input);
  const resolved = await realpath(input);
  if (entry.isSymbolicLink() || resolved !== input || !entry.isDirectory())
    throw new Error('installed app container must be a canonical directory');
  if (typeof process.getuid === 'function' && entry.uid !== process.getuid())
    throw new Error('installed app container is not user-owned');
  return {
    path: input,
    realpath: resolved,
    dev: entry.dev,
    ino: entry.ino,
    uid: entry.uid,
    gid: entry.gid,
    mode: entry.mode & 0o777,
  };
}

function requireProcess(value: OwnedResetProcess, label: string): OwnedResetProcess {
  if (!Number.isSafeInteger(value.pid) || value.pid <= 1)
    throw new Error(`${label}.pid is invalid`);
  boundedString(value.started, `${label}.started`, 256);
  boundedString(value.script, `${label}.script`, 2048);
  return Object.freeze({
    pid: value.pid,
    started: value.started,
    script: value.script,
  });
}

function disjoint(left: string, right: string): boolean {
  const contains = (root: string, candidate: string) => {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  return left !== right && !contains(left, right) && !contains(right, left);
}

function nondecreasingFinishedAt(startedAt: string, now: () => string): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) throw new Error('reset start time is invalid');
  const candidate = now();
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) throw new Error('reset finish time is invalid');
  return new Date(Math.max(parsed, started + 1)).toISOString();
}

function requireTimestamp(value: unknown, label: string): string {
  const bounded = boundedString(value, label, 128);
  const parsed = Date.parse(bounded);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return new Date(parsed).toISOString();
}

function validateExpectation(
  value: ColdResetPreparationExpectation,
): ColdResetPreparationExpectation {
  const requestedRunId = requireRunId(value.requestedRunId, 'requestedRunId');
  const requestedAttemptId = requireAttemptId(value.requestedAttemptId, 'requestedAttemptId');
  if (!requestedAttemptId.startsWith(`${requestedRunId}:`))
    throw new Error('requestedAttemptId is not bound to requestedRunId');
  return Object.freeze({
    requestedRunId,
    requestedAttemptId,
    fixtureResetId: boundedString(value.fixtureResetId, 'fixtureResetId', 256),
    cohortFixtureFingerprint: requireHash(
      value.cohortFixtureFingerprint,
      'cohortFixtureFingerprint',
    ),
    sourceFingerprint: requireHash(value.sourceFingerprint, 'sourceFingerprint'),
    helperFingerprint: requireHash(value.helperFingerprint, 'helperFingerprint'),
  });
}

/**
 * Produce the cold-reset receipt from the already acquired iOS lifecycle.
 * There is deliberately no target/backend argument: those rows are derived
 * from the simulator, session manifest, API probe, installed app, and proxy
 * handles supplied by capture after acquisition and before app launch.
 */
export async function produceIosColdReset(input: {
  expectation: ColdResetPreparationExpectation;
  context: OwnedIosColdResetContext;
}): Promise<OwnedIosColdResetResult> {
  const expectation = validateExpectation(input.expectation);
  const context = input.context;
  const now = context.now ?? (() => new Date().toISOString());
  abort(context.signal);
  const captureRunId = requireRunId(context.captureRunId, 'captureRunId');
  const ownerRunId = requireRunId(context.ownerRunId, 'ownerRunId');
  const resetStartedAt = requireTimestamp(context.resetStartedAt, 'resetStartedAt');
  if (ownerRunId !== expectation.requestedRunId)
    throw new Error('reset ownerRunId does not match requestedRunId');
  const captureNamespace = await canonicalPathIdentity(context.outputRoot, 'capture output root');
  if (path.basename(captureNamespace.path) !== captureRunId)
    throw new Error('reset output root is not bound to captureRunId');
  const backendNamespace = await canonicalPathIdentity(
    context.session.manifest.artifactRoot,
    'backend artifact root',
  );
  if (!disjoint(captureNamespace.path, backendNamespace.path))
    throw new Error('capture and backend namespaces are not disjoint');

  const device = context.device;
  await device.verify(context.signal);
  const observedDevice = await device.inspect(context.signal);
  abort(context.signal);
  if (
    observedDevice.udid !== device.udid ||
    observedDevice.name !== device.name ||
    observedDevice.runtime !== device.runtime ||
    observedDevice.deviceTypeIdentifier !== device.deviceTypeIdentifier ||
    observedDevice.state !== 'Booted' ||
    observedDevice.isAvailable !== true
  )
    throw new Error('reset simulator identity or boot state changed');

  if (context.fixtures.runId !== context.session.manifest.runId)
    throw new Error('reset fixtures are not from the acquired backend session');
  if (context.fixtures.scope !== 'native-entry-ios')
    throw new Error('reset fixtures use an unsupported scope');
  const fixtureBytes = Buffer.from(canonical(context.fixtures, 'owned fixtures'));
  const fixtureHash = sha256(fixtureBytes);

  await context.session.assertApiOwnership(context.signal);
  const probe = await context.session.probeApiLifetime(context.signal);
  abort(context.signal);
  const manifest = context.session.manifest;
  if (
    probe.runId !== manifest.runId ||
    probe.apiOrigin !== context.session.apiOrigin ||
    probe.apiPid !== context.session.apiPid ||
    context.proxy.runId !== manifest.runId
  )
    throw new Error('reset backend/API provenance is not same-session bound');
  const apiRows = manifest.processes.filter((row) => row.role === 'api');
  if (apiRows.length !== 1) throw new Error('reset backend API process is not unique');
  const apiRow = apiRows[0];
  if (
    apiRow.pid !== probe.apiPid ||
    apiRow.started !== probe.apiStarted ||
    apiRow.script !== probe.apiScript
  )
    throw new Error('reset backend API process row does not match the live probe');
  if (probe.backendAttemptId !== `${manifest.runId}:first` || !SHA256.test(probe.manifestSha256))
    throw new Error('reset backend attempt or manifest identity is invalid');
  const backendOriginPort = portFromOrigin(probe.apiOrigin, 'backend API origin');
  const proxyOriginPort = portFromOrigin(context.proxy.origin, 'owned proxy origin');
  if (probe.apiOrigin === context.proxy.origin || backendOriginPort === proxyOriginPort)
    throw new Error('reset backend and proxy listeners are not distinct');
  const proxyProcess = requireProcess(context.proxyProcess, 'proxy process');
  const proxyResult = await context.proxy.waitForQuiescence(5000, context.signal);
  abort(context.signal);
  if (proxyResult.active !== 0 || proxyResult.outbound !== 0)
    throw new Error('reset proxy is not quiescent');

  const snapshot = await context.session.snapshotWithEvidence(
    context.fixtures.scope,
    context.signal,
  );
  abort(context.signal);
  const snapshotValue = asRow(snapshot.value, 'owned reset snapshot');
  if (snapshotValue.runId !== manifest.runId || snapshotValue.scope !== context.fixtures.scope)
    throw new Error('reset snapshot is not bound to the acquired session/scope');
  const snapshotBytes = Buffer.from(canonical(snapshot.value, 'owned reset snapshot value'));
  const snapshotReceiptBytes = Buffer.from(
    canonical(snapshot.receipt, 'owned reset snapshot receipt'),
  );
  const fixtureStateFingerprint = sha256(
    Buffer.concat([
      fixtureBytes,
      Buffer.from('\n'),
      snapshotBytes,
      Buffer.from('\n'),
      snapshotReceiptBytes,
    ]),
  );

  if (context.build.appId !== context.appState.appId)
    throw new Error('installed app state appId does not match the verified build');
  requireHash(context.build.binaryHash, 'verified build binaryHash');
  if (context.appState.phase !== 'installed-before-ui')
    throw new Error('cold reset must be produced before UI launch');
  if (
    context.appState.installExecution.execution !== 'completed' ||
    context.appState.installExecution.cleanup !== 'cleaned' ||
    !Number.isSafeInteger(context.appState.installExecution.pid) ||
    context.appState.installExecution.pid <= 1
  )
    throw new Error('installed app command is not a completed owned execution');
  const installedContainer = await installedPathIdentity(context.appState.installedContainerPath);

  const target: Row = {
    platform: 'ios',
    deviceId: device.udid,
    deviceName: device.name,
    osVersion: device.runtime,
    deviceTypeIdentifier: device.deviceTypeIdentifier,
    appId: context.build.appId,
    binaryHash: context.build.binaryHash,
    apiOrigin: context.proxy.origin,
    captureRunId,
    ownerRunId,
    phase: 'installed-before-ui',
  };
  const backend: Row = {
    runId: manifest.runId,
    ownerRunId,
    captureRunId,
    composeProject: boundedString(manifest.composeProject, 'backend composeProject', 256),
    artifactRoot: backendNamespace.path,
    apiOrigin: probe.apiOrigin,
    apiPid: probe.apiPid,
    apiStarted: probe.apiStarted,
    apiScript: probe.apiScript,
    backendAttemptId: probe.backendAttemptId,
    manifestSha256: probe.manifestSha256,
    processes: manifest.processes.map((row) => ({ ...row })),
  };
  canonical(target, 'target binding');
  canonical(backend, 'backend binding');

  const appState: Row = {
    phase: context.appState.phase,
    appId: context.appState.appId,
    binaryPath: context.build.binaryPath,
    binaryHash: context.build.binaryHash,
    installedContainer,
    installExecution: { ...context.appState.installExecution },
  };
  const appStateFingerprint = sha256(
    canonical({ target, device: observedDevice, build: context.build, appState }, 'app state'),
  );
  const backendProcess: OwnedResetProcessRow = {
    role: 'backend-api',
    pid: probe.apiPid,
    started: probe.apiStarted,
    script: probe.apiScript,
  };
  const proxyProcessRow: OwnedResetProcessRow = {
    role: 'capture-process-proxy',
    ...proxyProcess,
  };
  const fixture: Row = {
    runId: context.fixtures.runId,
    scope: context.fixtures.scope,
    fixtureSha256: fixtureHash,
    snapshotSha256: sha256(snapshotBytes),
    snapshotReceiptSha256: sha256(snapshotReceiptBytes),
  };
  const listeners = [
    {
      resourceType: 'port',
      resourceId: String(backendOriginPort),
      state: 'active',
      ownerRunId,
      process: backendProcess,
      source: 'owned-session.apiOrigin',
    },
    {
      resourceType: 'port',
      resourceId: String(proxyOriginPort),
      state: 'active',
      ownerRunId,
      process: proxyProcessRow,
      source: 'owned-api-proxy.origin',
    },
  ];
  const ownership = {
    backendProcess,
    proxyProcess: proxyProcessRow,
    listeners,
    namespaces: { capture: captureNamespace, backend: backendNamespace },
  } as const;
  const startedAt = resetStartedAt;
  const finishedAt = nondecreasingFinishedAt(startedAt, now);
  const receipt: Row = {
    kind: 'private-t15-cold-reset-original-from-owned-ios-session',
    schemaVersion: 1,
    status: 'fresh',
    requestedRunId: expectation.requestedRunId,
    requestedAttemptId: expectation.requestedAttemptId,
    fixtureResetId: expectation.fixtureResetId,
    ownerRunId,
    captureRunId,
    startedAt,
    finishedAt,
    target,
    backend,
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
  const receiptBytes = Buffer.from(canonical(receipt, 'reset receipt'));
  if (receiptBytes.length > MAX_RECEIPT_BYTES) throw new Error('reset receipt exceeds size limit');
  const receiptPath = path.join(context.outputRoot, RESET_RECEIPT_NAME);
  abort(context.signal);
  await writeFile(receiptPath, receiptBytes, { flag: 'wx', mode: 0o600 });
  // A late cancellation leaves the child bytes for recovery and blocks parent consumption.
  abort(context.signal);
  const observation = readNativeEvidenceObservation(context.outputRoot, RESET_RECEIPT_NAME, true);
  const persisted = Buffer.from(observation.bytes);
  abort(context.signal);
  if (!persisted.equals(receiptBytes)) throw new Error('reset receipt readback changed bytes');
  const receiptHash = sha256(persisted);
  const originalResetBinding = {
    status: 'verified' as const,
    receiptPath,
    artifactRoot: captureNamespace.path,
    receiptHash,
    identity: Object.freeze(observation.identity),
  };
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
    originalResetBinding,
    cleanupStatus: 'cleaned' as const,
    blocker: null,
    target: structuredClone(target),
    backend: structuredClone(backend),
    receiptPath,
    receiptHash,
    ownership,
  });
}

export { RESET_RECEIPT_NAME as coldResetOriginalReceiptName };

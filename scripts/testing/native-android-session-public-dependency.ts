import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { androidSourceIdentity } from './android-build-identity';
import { androidSessionAssertionSequence } from './android-session-charter';
import {
  requireAndroidCancelledConfirmationAbsent,
  requireAndroidLocalSessionClear,
  readOwnedAndroidBoundedFileSync,
  requireAndroidStorageReceiptSet,
  requireAndroidSessionCheckpointSet,
  requireAndroidSessionTransportSlice,
  androidSessionStorageLimits,
  type AndroidSessionCheckpointReceipt,
  type AndroidSessionStorageObservation,
} from './native-android-session-adapter';
import {
  readAndroidSessionCheckpointArtifacts,
  requireAndroidSessionCheckpointArtifacts,
} from './native-android-session-checkpoint-copy';
import {
  androidSessionPublicAssertionIds,
  androidSessionPublicCommandLabelsByAssertion,
  androidSessionPublicSelection,
  androidSessionPublicUiObservationContract,
  blockedAndroidSessionDependency,
  requireAndroidSessionCaptureShape,
  requireAndroidSessionSelectionArguments,
  type AndroidSessionPublicDependencyResult,
  type AndroidSessionPublicLoad,
} from './native-android-session-public-contract';
import {
  requireNativeConnectionHelperInputs,
  type NativeConnectionHelperInput,
} from './native-connection-public-evidence-core';
import {
  requireConnectionSnapshot,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotSelection,
} from './native-pilot-contract';
import {
  nativeSessionProfileCheckpointIds,
  requireFinalSessionTransport,
  requireSignOutSessionTransport,
  requireSignedOutSessionTransport,
  verifyNativeSessionProfileCheckpoints,
} from './native-session-profile-checkpoints';
import {
  readNativeEvidence,
  validateNativeRuntimeFrameFiles,
  type ViewEvidence,
} from './native-view-evidence';
import { assertTestingDocument } from './schema-validation';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const id = /^[a-f0-9]{24}$/;
const loopbackOrigin = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/;
type Checkpoint = (typeof nativeSessionProfileCheckpointIds)[number];
type JsonRecord = Record<string, unknown>;
type LoadedFile = { path: string; bytes: number; sha256: string; value: unknown };
type LoaderGuard = () => void;

class LoaderStoppedError extends Error {
  constructor(reason: 'aborted' | 'deadline') {
    super(`Android session public dependency loader ${reason}`);
    this.name = 'LoaderStoppedError';
  }
}

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as JsonRecord;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  assert.notEqual(value, '', `${label} is empty`);
  assert.equal(value.trim(), value, `${label} has surrounding whitespace`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  assert(Number.isSafeInteger(value) && (value as number) >= minimum, `${label} is invalid`);
  return value as number;
}

function monotonicNowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function loaderGuard(signal: AbortSignal | undefined, deadlineMs: number | undefined): LoaderGuard {
  const duration = deadlineMs ?? 60_000;
  assert(Number.isSafeInteger(duration) && duration > 0 && duration <= 300_000);
  const deadline = monotonicNowMs() + duration;
  return () => {
    if (signal?.aborted) throw new LoaderStoppedError('aborted');
    if (monotonicNowMs() >= deadline) throw new LoaderStoppedError('deadline');
  };
}

async function privateRoot(value: string, label: string): Promise<string> {
  const resolved = await realpath(value);
  assert.equal(resolved, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a regular directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned by the loader`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return resolved;
}

function relativeEvidencePath(value: unknown, label: string): string {
  const relative = nonempty(value, label);
  assert(!path.isAbsolute(relative), `${label} must be relative`);
  assert(!relative.split(/[\\/]/).includes('..'), `${label} escapes the capture root`);
  assert(!relative.includes('\0'), `${label} contains NUL`);
  return relative;
}

function readJson(
  root: string,
  relative: string,
  missing: string[],
  guard: LoaderGuard,
): LoadedFile | null {
  try {
    guard();
    const bytes = readNativeEvidence(root, relative, true);
    guard();
    return {
      path: relative,
      bytes: bytes.length,
      sha256: hash(bytes),
      value: JSON.parse(bytes.toString('utf8')),
    };
  } catch (error) {
    if (error instanceof LoaderStoppedError) throw error;
    missing.push(`${relative}: ${error instanceof Error ? error.message : 'read failed'}`);
    return null;
  }
}

const androidSessionTransportEvidenceMaxBytes = 1 * 1024 * 1024;

function maxBytesForReceipt(receipt: JsonRecord, override?: number): number {
  if (override !== undefined) return override;
  switch (receipt.kind) {
    case 'database':
      return androidSessionStorageLimits.databaseBytes;
    case 'sidecar':
      return androidSessionStorageLimits.sidecarBytes;
    case 'xml':
      return androidSessionStorageLimits.xmlBytes;
    case 'query':
      return androidSessionStorageLimits.queryBytes;
    case 'transport':
    case 'auth':
      return androidSessionTransportEvidenceMaxBytes;
    case 'listing':
      return androidSessionStorageLimits.listingBytes;
    case 'frame':
      return 16 * 1024 * 1024;
    default:
      throw new Error('Android producer receipt kind is missing or unsupported');
  }
}

/** Read only a producer-owned receipt and compare it with fresh filesystem metadata. */
function readProducedReceipt(
  root: string,
  value: unknown,
  label: string,
  guard: LoaderGuard,
  maxBytesOverride?: number,
) {
  const receipt = record(value, label);
  const relative = relativeEvidencePath(receipt.path, `${label}.path`);
  const file = path.join(root, relative);
  const maxBytes = maxBytesForReceipt(receipt, maxBytesOverride);
  assert(Number.isSafeInteger(receipt.sizeBytes) && Number(receipt.sizeBytes) > 0);
  assert(Number(receipt.sizeBytes) <= maxBytes, `${label} exceeds its kind cap`);
  assert.match(String(receipt.sha256), /^[a-f0-9]{64}$/);
  assert(Number.isSafeInteger(receipt.ownerUid) && Number(receipt.ownerUid) > 0);
  assert(
    typeof receipt.verification === 'string' && receipt.verification.length > 0,
    `${label} producer verification marker is missing`,
  );
  const loaded = readOwnedAndroidBoundedFileSync({
    artifactRoot: root,
    filePath: file,
    label,
    maxBytes,
    guard,
  });
  assert.equal(receipt.ownerUid, loaded.identity.uid, `${label} receipt owner differs from bytes`);
  assert.equal(
    receipt.mode,
    loaded.identity.mode & 0o777,
    `${label} receipt mode differs from bytes`,
  );
  assert.equal(loaded.bytes.length, receipt.sizeBytes, `${label} byte count changed`);
  assert.equal(hash(loaded.bytes), receipt.sha256, `${label} hash changed`);
  return { receipt, relative: loaded.path, bytes: loaded.bytes };
}

type CapturedFrame = {
  relative: string;
  bytes: Buffer;
  receipt: {
    path: string;
    sizeBytes: number;
    sha256: string;
    ownerUid: number;
    mode: number;
    contentKind: 'hierarchy-source' | 'hierarchy-json' | 'png';
    verification: 'owned-stable-reader-v6';
  };
};

/** Read the actual frame/command bytes named by the producer, without inventing a receipt envelope. */
function readOwnedCaptureFile(
  root: string,
  value: unknown,
  label: string,
  contentKind: 'hierarchy-source' | 'hierarchy-json' | 'png',
  guard: LoaderGuard,
  beforeRead?: () => void,
): CapturedFrame {
  const relative = relativeEvidencePath(value, `${label}.path`);
  const file = path.join(root, relative);
  const loaded = readOwnedAndroidBoundedFileSync({
    artifactRoot: root,
    filePath: file,
    label,
    maxBytes: 16 * 1024 * 1024,
    guard,
    beforeRead,
  });
  return {
    relative: loaded.path,
    bytes: loaded.bytes,
    receipt: {
      path: loaded.path,
      sizeBytes: loaded.bytes.length,
      sha256: hash(loaded.bytes),
      ownerUid: loaded.identity.uid,
      mode: loaded.identity.mode & 0o777,
      contentKind,
      verification: 'owned-stable-reader-v6',
    },
  };
}

/** Resource-free filesystem race seam used only by the private v7 candidate tests. */
export function readOwnedCaptureFileForTest(
  root: string,
  value: unknown,
  label: string,
  contentKind: 'hierarchy-source' | 'hierarchy-json' | 'png',
  guard: LoaderGuard,
  beforeRead: () => void,
): CapturedFrame {
  return readOwnedCaptureFile(root, value, label, contentKind, guard, beforeRead);
}

function readOwnedArtifactBytes(
  root: string,
  value: unknown,
  label: string,
  maxBytes: number,
  guard: LoaderGuard,
  beforeRead?: () => void,
): { relative: string; bytes: Buffer; sha256: string } {
  const relative = relativeEvidencePath(value, `${label}.path`);
  const file = path.join(root, relative);
  const loaded = readOwnedAndroidBoundedFileSync({
    artifactRoot: root,
    filePath: file,
    label,
    maxBytes,
    guard,
    beforeRead,
  });
  return { relative: loaded.path, bytes: loaded.bytes, sha256: hash(loaded.bytes) };
}

/** Resource-free command-artifact race seam used only by the private v7 tests. */
export function readOwnedArtifactBytesForTest(
  root: string,
  value: unknown,
  label: string,
  maxBytes: number,
  guard: LoaderGuard,
  beforeRead: () => void,
): { relative: string; bytes: Buffer; sha256: string } {
  return readOwnedArtifactBytes(root, value, label, maxBytes, guard, beforeRead);
}

function readReceipt(
  root: string,
  value: unknown,
  label: string,
  guard: LoaderGuard,
  maxBytesOverride?: number,
) {
  return readProducedReceipt(root, value, label, guard, maxBytesOverride);
}

function checkpointReceipts(capture: JsonRecord): AndroidSessionCheckpointReceipt[] {
  const raw = capture.androidSessionCheckpointReceipts;
  assert(Array.isArray(raw), 'Android checkpoint receipts are missing');
  assert.equal(raw.length, nativeSessionProfileCheckpointIds.length);
  return raw as AndroidSessionCheckpointReceipt[];
}

function requireBackendIdentity(capture: JsonRecord) {
  const backend = record(capture.backend, 'Android backend');
  const runId = nonempty(backend.runId, 'Android backend runId');
  assert.match(runId, id);
  const artifactRoot = nonempty(backend.artifactRoot, 'Android backend artifactRoot');
  assert(path.isAbsolute(artifactRoot));
  const auth = record(capture.androidSessionAuthIdentity, 'Android auth identity');
  const apiPid = integer(auth.apiPid, 'Android API PID', 2);
  const targetOrigin = nonempty(auth.targetOrigin, 'Android API origin');
  assert.match(targetOrigin, loopbackOrigin);
  assert.equal(backend.apiOrigin, targetOrigin, 'Backend and auth origins differ');
  const apiProcess = record(backend.apiProcess, 'Android backend API process');
  assert.equal(apiProcess.pid, apiPid, 'Backend and auth PIDs differ');
  nonempty(apiProcess.started, 'Android API process start');
  nonempty(apiProcess.script, 'Android API process script');
  const backendAttemptId = nonempty(backend.backendAttemptId, 'Android backend attempt');
  assert.equal(
    backendAttemptId,
    `${runId}:first`,
    'Android public source cannot relabel a first attempt',
  );
  return { backend, runId, artifactRoot, apiPid, targetOrigin, backendAttemptId };
}

async function currentSourceAndHelpers(repositoryRoot: string, capture: JsonRecord) {
  const source = await androidSourceIdentity(repositoryRoot);
  const helpers = requireNativeConnectionHelperInputs(capture.helperInputsBefore, 'android');
  const current: NativeConnectionHelperInput[] = [];
  for (const helper of helpers) {
    const target = path.resolve(repositoryRoot, helper.path);
    assert.equal(path.relative(repositoryRoot, target).startsWith('..'), false);
    assert.equal(await realpath(target), target, `Android helper is not canonical: ${helper.path}`);
    const info = await lstat(target);
    assert(
      info.isFile() && !info.isSymbolicLink(),
      `Android helper is not a regular file: ${helper.path}`,
    );
    const bytes = await readFile(target);
    assert.equal(hash(bytes), helper.sha256, `Android helper is stale: ${helper.path}`);
    current.push({ path: helper.path, sha256: helper.sha256 });
  }
  return { source, helpers: current };
}

function requireSourceFreshness(
  capture: JsonRecord,
  current: { source: unknown; helpers: readonly NativeConnectionHelperInput[] },
) {
  assert.deepEqual(capture.source, capture.sourceAfter, 'Android source changed during capture');
  assert.deepEqual(
    capture.helperInputsBefore,
    capture.helperInputsAfter,
    'Android helper inputs changed during capture',
  );
  assert.deepEqual(capture.source, current.source, 'Android source identity is stale');
  assert.deepEqual(capture.helperInputsBefore, current.helpers, 'Android helper identity is stale');
}

/** Signed-in relaunch spans the capture declared; the profile verifier checks each. */
function requireRelaunchWindows(value: unknown) {
  if (value === undefined) return [];
  assert(Array.isArray(value), 'Android relaunch windows are malformed');
  return value.map((raw) => {
    const window = record(raw, 'Android relaunch window');
    return {
      afterRequestId: integer(window.afterRequestId, 'Android relaunch window start', 0),
      throughRequestId: integer(window.throughRequestId, 'Android relaunch window end', 1),
    };
  });
}

/** The independent cleanup proof is keyed by the capture run, not the backend run. */
export function requireAndroidCleanupEvidence(value: unknown, captureRunId: string): void {
  const cleanup = record(value, 'Android external cleanup');
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.runId, captureRunId, 'Android cleanup proof is not bound to the capture');
  assert.equal(cleanup.censusStatus, 'available', 'Android cleanup census is unavailable');
  assert.equal(cleanup.captureResult, 'observed');
  assert.equal(cleanup.captureCleanupClean, true);
  assert.deepEqual(cleanup.survivors, []);
  assert.deepEqual(cleanup.unknownProcessQueries, []);
  assert.deepEqual(cleanup.missingForeignDevices, []);
  assert.equal(cleanup.ownedDeviceAbsent, true);
  assert.equal(cleanup.cacheAbsent, true, 'Android acquired-session cache absence is unknown');
  assert.equal(cleanup.nativePassingCases, 0);
}

/**
 * The raw sqlite output holds unredacted token bytes, so the capture deletes it
 * after hashing (retained: false). Its hash stays bound in the receipt; the
 * redacted query file is what the loader re-reads.
 */
function isDeletedQuerySource(receipt: unknown): boolean {
  const row = record(receipt, 'Android query source receipt');
  if (row.retained !== false) return false;
  assert.match(String(row.sha256), /^[a-f0-9]{64}$/, 'Android query source hash is invalid');
  return true;
}

function requireReceiptSet(
  root: string,
  value: unknown,
  label: string,
  guard: LoaderGuard,
): { paths: string[]; hashes: string[] } {
  const set = requireAndroidStorageReceiptSet(value, label);
  const paths: string[] = [];
  const hashes: string[] = [];
  const read = (key: string, receipt: unknown, maxBytesOverride?: number) => {
    const row = readReceipt(root, receipt, `${label}.${key}`, guard, maxBytesOverride);
    assert.equal(
      row.receipt.kind,
      record(receipt, `${label}.${key}`).kind,
      `${label}.${key} kind changed during read`,
    );
    paths.push(row.relative);
    hashes.push(String(row.receipt.sha256));
  };
  read('database', set.database);
  read('query', set.query);
  if (isDeletedQuerySource(set.querySource))
    hashes.push(String(record(set.querySource, `${label}.querySource`).sha256));
  else read('querySource', set.querySource, androidSessionStorageLimits.queryBytes);
  for (const [index, sidecar] of set.databaseSidecars.entries())
    read(`databaseSidecars[${index}]`, sidecar);
  if (set.secureStore !== null) read('secureStore', set.secureStore);
  read('databaseListing', set.databaseListing);
  read('secureStoreListing', set.secureStoreListing);
  return { paths, hashes };
}

function requireStorageReceiptHashes(
  root: string,
  storage: JsonRecord,
  label: string,
  guard: LoaderGuard,
): string[] {
  const privateArtifacts = record(storage.privateArtifacts, `${label}.privateArtifacts`);
  return ['database', 'query', 'querySource'].map((key) =>
    key === 'querySource' && isDeletedQuerySource(privateArtifacts[key])
      ? String(record(privateArtifacts[key], `${label}.${key}`).sha256)
      : String(
          readReceipt(
            root,
            privateArtifacts[key],
            `${label}.${key}`,
            guard,
            key === 'querySource' ? androidSessionStorageLimits.queryBytes : undefined,
          ).receipt.sha256,
        ),
  );
}

function hasAttribute(value: unknown, attribute: string, expected: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as { attributes?: Record<string, unknown>; children?: unknown[] };
  return (
    row.attributes?.[attribute] === expected ||
    (Array.isArray(row.children) &&
      row.children.some((child) => hasAttribute(child, attribute, expected)))
  );
}

function commandRelativePath(root: string, value: unknown, label: string): string {
  assert(typeof value === 'string' && path.isAbsolute(value), `${label} must be absolute`);
  const relative = path.relative(root, value);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  return relative;
}

function requireOwnedCommandLedger(
  root: string,
  row: JsonRecord,
  expectedLabel: string,
  guard: LoaderGuard,
): { logHash: string; ownershipHash: string; stdoutHash: string | null } {
  const logPath = commandRelativePath(root, row.logPath, `${expectedLabel}.logPath`);
  const ownershipPath = commandRelativePath(
    root,
    row.ownershipPath,
    `${expectedLabel}.ownershipPath`,
  );
  assert.equal(logPath, `${expectedLabel}.private.log`);
  assert.equal(ownershipPath, `${expectedLabel}.ownership.json`);
  const log = readOwnedArtifactBytes(
    root,
    logPath,
    `${expectedLabel} command log`,
    8 * 1024 * 1024,
    guard,
  );
  const ownership = readOwnedArtifactBytes(
    root,
    ownershipPath,
    `${expectedLabel} ownership ledger`,
    8 * 1024 * 1024,
    guard,
  );
  const ledger = record(
    JSON.parse(ownership.bytes.toString('utf8')),
    `${expectedLabel} ownership ledger`,
  );
  assert.equal(ledger.kind, 'private worker process ownership');
  assert.equal(ledger.pid, row.pid, `${expectedLabel} ownership leader PID is not bound`);
  assert.equal(ledger.pgid, row.pgid, `${expectedLabel} ownership group is not bound`);
  assert.equal(ledger.cleanup, 'cleaned', `${expectedLabel} ownership cleanup is not clean`);
  const processes = ledger.processes;
  assert(
    Array.isArray(processes) && processes.length > 0,
    `${expectedLabel} process ledger is empty`,
  );
  const processIds = new Set<string>();
  let leaderCount = 0;
  for (const raw of processes) {
    const process = record(raw, `${expectedLabel} owned process`);
    assert(Number.isSafeInteger(process.pid) && Number(process.pid) > 1);
    assert(Number.isSafeInteger(process.pgid) && Number(process.pgid) > 1);
    assert(nonempty(process.started, `${expectedLabel} process start`));
    assert.match(String(process.commandHash), /^[a-f0-9]{64}$/);
    const identity = `${String(process.pid)}:${String(process.started)}`;
    assert(!processIds.has(identity), `${expectedLabel} process identity is duplicated`);
    processIds.add(identity);
    if (process.pid === row.pid && process.pgid === row.pgid) leaderCount += 1;
  }
  assert.equal(leaderCount, 1, `${expectedLabel} ownership leader identity is missing`);
  const leaderExecutions = ledger.leaderExecutions;
  assert(Array.isArray(leaderExecutions), `${expectedLabel} leader execution ledger is missing`);
  for (const raw of leaderExecutions) {
    const execution = record(raw, `${expectedLabel} leader execution`);
    assert(nonempty(execution.started, `${expectedLabel} leader execution start`));
    assert.match(String(execution.previousCommandHash), /^[a-f0-9]{64}$/);
    assert.match(String(execution.commandHash), /^[a-f0-9]{64}$/);
  }
  const requery = ledger.commandCensusRequeries;
  assert(Array.isArray(requery), `${expectedLabel} census requery ledger is missing`);
  for (const raw of requery) {
    const event = record(raw, `${expectedLabel} census requery`);
    assert(Array.isArray(event.unavailable) && Array.isArray(event.current));
    // macOS can list a just-forked child before its argv is readable. Such a
    // gap is acceptable only inside this step's own process group, whose
    // members must all be gone by the latest census (checked below).
    if (event.result !== 'available')
      assert(
        event.unavailable.length > 0 &&
          event.unavailable.every(
            (unavailable) => record(unavailable, `${expectedLabel} census gap`).pgid === row.pgid,
          ),
        `${expectedLabel} census was unavailable`,
      );
  }
  assert(Array.isArray(ledger.escapedProcesses) && ledger.escapedProcesses.length === 0);
  assert(Array.isArray(ledger.escapedSignals) && ledger.escapedSignals.length === 0);
  const latest = record(ledger.latestCensus, `${expectedLabel} latest census`);
  assert(Array.isArray(latest.groupMembers) && latest.groupMembers.length === 0);
  assert(Array.isArray(latest.escapedCandidates) && latest.escapedCandidates.length === 0);
  assert(ledger.rejectedCensus === undefined || ledger.rejectedCensus === null);
  let stdoutHash: string | null = null;
  if (row.stdoutPath !== null && row.stdoutPath !== undefined) {
    const stdoutPath = commandRelativePath(root, row.stdoutPath, `${expectedLabel}.stdoutPath`);
    const stdout = readOwnedArtifactBytes(
      root,
      stdoutPath,
      `${expectedLabel} stdout`,
      16 * 1024 * 1024,
      guard,
    );
    stdoutHash = stdout.sha256;
  }
  return { logHash: log.sha256, ownershipHash: ownership.sha256, stdoutHash };
}

function requireMaestroCommandEvidence(
  root: string,
  raw: unknown,
  expectedLabel: string,
  guard: LoaderGuard,
): string[] {
  const row = record(raw, `Android Maestro command ${expectedLabel}`);
  assert.equal(row.label, expectedLabel);
  assert.equal(row.execution, 'completed', `${expectedLabel} did not complete`);
  assert.equal(row.cleanup, 'cleaned', `${expectedLabel} command cleanup is not clean`);
  assert.equal(row.childExitCode, 0, `${expectedLabel} child failed`);
  assert.equal(row.childSignal, null, `${expectedLabel} was signalled`);
  assert(Number.isSafeInteger(row.pid) && Number(row.pid) > 1);
  assert(Number.isSafeInteger(row.pgid) && Number(row.pgid) > 1);
  assert.equal(row.phase, 'step', `${expectedLabel} command phase is not a step`);
  assert.equal(row.censusFailure ?? null, null, `${expectedLabel} census failure is present`);
  assert.equal(row.outputFailure ?? null, null, `${expectedLabel} output failure is present`);
  const artifacts = requireOwnedCommandLedger(root, row, expectedLabel, guard);
  const hashes = [
    ['log', artifacts.logHash],
    ['ownership', artifacts.ownershipHash],
    ...(artifacts.stdoutHash ? ([['stdout', artifacts.stdoutHash]] as const) : []),
  ] as const;
  // Keep the original artifact digest inside a label/role-domain-separated
  // binding so repeated synthetic command bytes cannot create duplicate
  // charter receipts while a changed original log still changes the binding.
  return hashes.map(([role, digest]) =>
    hash(
      JSON.stringify({ kind: 'android-command-artifact-v1', label: expectedLabel, role, digest }),
    ),
  );
}

function commandRows(capture: JsonRecord): Map<string, JsonRecord> {
  const executions = capture.commandExecutions;
  assert(Array.isArray(executions), 'Android command executions are missing');
  const byLabel = new Map<string, JsonRecord>();
  for (const raw of executions) {
    const row = record(raw, 'Android command execution');
    assert(typeof row.label === 'string');
    assert(!byLabel.has(row.label), `Android command duplicated: ${row.label}`);
    byLabel.set(row.label, row);
  }
  return byLabel;
}

/** Read every original command artifact and retain its hashes for charter binding. */
export function requireAndroidMaestroCommandHashes(
  root: string,
  capture: JsonRecord,
  guard: LoaderGuard = () => undefined,
): ReadonlyMap<string, readonly string[]> {
  const byLabel = commandRows(capture);
  const commandHashes = new Map<string, readonly string[]>();
  const observedLabels = new Set<string>();
  for (const labels of androidSessionPublicCommandLabelsByAssertion) {
    for (const observationLabel of labels) {
      assert(
        !observedLabels.has(observationLabel),
        `Android command phase label duplicated: ${observationLabel}`,
      );
      observedLabels.add(observationLabel);
      const hashes: string[] = [];
      for (const label of [
        `${observationLabel}-readiness`,
        `${observationLabel}-hierarchy`,
        observationLabel,
      ]) {
        const command = byLabel.get(label);
        assert(command, `Android Maestro command receipt is missing: ${label}`);
        hashes.push(...requireMaestroCommandEvidence(root, command, label, guard));
      }
      commandHashes.set(observationLabel, hashes);
    }
  }
  assert.equal(
    observedLabels.size,
    androidSessionPublicUiObservationContract.length,
    'Android command phase mapping is incomplete',
  );
  // Build, launch and storage-read commands also run as steps. Only Maestro UI
  // commands (always a readiness/hierarchy/observation triple) must be bound.
  const boundLabels = new Set(
    [...observedLabels].flatMap((label) => [`${label}-readiness`, `${label}-hierarchy`, label]),
  );
  for (const label of byLabel.keys()) {
    const uiBase = label.replace(/-(readiness|hierarchy)$/, '');
    const isUiCommand = uiBase !== label || byLabel.has(`${label}-readiness`);
    assert(
      !isUiCommand || boundLabels.has(label),
      'Android command execution set contains an unbound command',
    );
  }
  return commandHashes;
}

const androidMaestroAssertionEvidencePlan = [
  { observations: ['entry'], commands: androidSessionPublicCommandLabelsByAssertion[0] },
  { observations: ['coach-home'], commands: androidSessionPublicCommandLabelsByAssertion[1] },
  {
    observations: ['auth-account'],
    commands: androidSessionPublicCommandLabelsByAssertion[2],
  },
  {
    observations: ['auth-restored-home'],
    commands: androidSessionPublicCommandLabelsByAssertion[3],
  },
  {
    observations: ['auth-signout-open', 'auth-signout-cancelled', 'auth-signout-reopen'],
    commands: androidSessionPublicCommandLabelsByAssertion[4],
  },
  {
    observations: ['auth-signed-out', 'auth-signed-out-relaunch'],
    commands: androidSessionPublicCommandLabelsByAssertion[5],
  },
] as const;

export function requireAndroidSessionAssertionSourceHashes(
  capture: JsonRecord,
  expected: readonly (readonly string[])[],
): void {
  const charter = record(capture.androidSessionCharter, 'Android session charter');
  const assertions = charter.assertions;
  assert(Array.isArray(assertions));
  assert.equal(assertions.length, androidSessionAssertionSequence.length);
  assert.equal(expected.length, androidSessionAssertionSequence.length);
  for (const [index, raw] of assertions.entries()) {
    const assertion = record(raw, `Android charter assertion ${index}`);
    assert.equal(assertion.id, androidSessionAssertionSequence[index]);
    assert.equal(assertion.order, index + 1);
    assert.equal(assertion.status, 'verified');
    assert(Array.isArray(assertion.sourceReceiptHashes));
    assert(
      assertion.sourceReceiptHashes.every((value) => /^[a-f0-9]{64}$/.test(String(value))),
      `Android charter assertion ${index} has a malformed source receipt hash`,
    );
    assert.equal(
      new Set(assertion.sourceReceiptHashes.map(String)).size,
      assertion.sourceReceiptHashes.length,
      `Android charter assertion ${index} repeats a source receipt`,
    );
    assert.deepEqual(
      assertion.sourceReceiptHashes,
      expected[index],
      `Android charter assertion ${index} is not bound to its named source receipts`,
    );
  }
}

/** Bind the six charter assertions to the producer's actual frame and command records. */
export function requireAndroidMaestroEvidence(
  root: string,
  capture: JsonRecord,
  guard: LoaderGuard = () => undefined,
): {
  framePaths: string[];
  commandLabels: string[];
  commandHashes: ReadonlyMap<string, readonly string[]>;
  frameHashes: ReadonlyMap<string, readonly string[]>;
  cancelledConfirmationHash: string;
} {
  const charter = record(capture.androidSessionCharter, 'Android session charter');
  assert.equal(charter.charter, 'session-account');
  assert.equal(charter.status, 'verified');
  assert.equal(charter.restorationCount, 1);
  assert.deepEqual(charter.assertionIds, androidSessionAssertionSequence);
  assert.equal(
    charter.charterSha256,
    hash(JSON.stringify(androidSessionAssertionSequence)),
    'Android session charter hash is not bound to the canonical assertion IDs',
  );
  assert(Array.isArray(charter.assertions));
  assert.equal(charter.assertions.length, androidMaestroAssertionEvidencePlan.length);
  const observations = capture.observations;
  assert(Array.isArray(observations));
  assert.equal(observations.length, androidSessionPublicUiObservationContract.length);
  const commandByLabel = commandRows(capture);
  const byLabel = new Map<string, JsonRecord>();
  const frameHashes = new Map<string, string[]>();
  const framePaths: string[] = [];
  for (const [index, contract] of androidSessionPublicUiObservationContract.entries()) {
    const row = record(observations[index], `Android observation ${index}`);
    assert(!Object.hasOwn(row, 'label'), `${contract.label} uses a synthetic observation envelope`);
    assert(
      !Object.hasOwn(row, 'frameReceipts'),
      `${contract.label} uses an invented frame envelope`,
    );
    assert.equal(row.viewId, contract.viewId);
    assert(!byLabel.has(contract.label), `Android observation duplicated: ${contract.label}`);
    byLabel.set(contract.label, row);
    const hierarchyPath = relativeEvidencePath(
      row.hierarchyPath,
      `${contract.label}.hierarchyPath`,
    );
    const screenshotPath = relativeEvidencePath(
      row.screenshotPath,
      `${contract.label}.screenshotPath`,
    );
    assert.equal(path.basename(hierarchyPath), `${contract.label}-hierarchy.json`);
    assert.equal(path.basename(screenshotPath), `${contract.label}.png`);
    const hierarchyCommand = commandByLabel.get(`${contract.label}-hierarchy`);
    assert(hierarchyCommand, `Android hierarchy command is missing: ${contract.label}`);
    assert.equal(
      commandRelativePath(root, hierarchyCommand.stdoutPath, `${contract.label} hierarchy stdout`),
      `${contract.label}-hierarchy.stdout`,
    );
    const hierarchySource = readOwnedCaptureFile(
      root,
      `${contract.label}-hierarchy.stdout`,
      `${contract.label} hierarchy source`,
      'hierarchy-source',
      guard,
    );
    const hierarchy = readOwnedCaptureFile(
      root,
      hierarchyPath,
      `${contract.label} hierarchy`,
      'hierarchy-json',
      guard,
    );
    const screenshot = readOwnedCaptureFile(
      root,
      screenshotPath,
      `${contract.label} screenshot`,
      'png',
      guard,
    );
    const view: ViewEvidence = {
      viewId: contract.viewId,
      screenshotPath: screenshot.relative,
      screenshotHash: screenshot.receipt.sha256,
      hierarchyPath: hierarchy.relative,
      hierarchyHash: hierarchy.receipt.sha256,
      reviewed: false,
    };
    validateNativeRuntimeFrameFiles(root, [view], [contract.viewId]);
    if (contract.label === 'auth-signout-cancelled') {
      const tree = JSON.parse(hierarchy.bytes.toString('utf8')) as unknown;
      assert.equal(hasAttribute(tree, 'resource-id', 'settings.account.signOutConfirm'), false);
      assert.equal(hasAttribute(tree, 'resource-id', 'settings.account.signOutConfirmCta'), false);
    }
    frameHashes.set(contract.label, [
      hierarchySource.receipt.sha256,
      hierarchy.receipt.sha256,
      screenshot.receipt.sha256,
    ]);
    framePaths.push(hierarchySource.relative, hierarchy.relative, screenshot.relative);
    guard();
  }
  const commandLabels: string[] = [];
  const commandHashes = requireAndroidMaestroCommandHashes(root, capture, guard);
  for (const contract of androidSessionPublicUiObservationContract) {
    const labels = [`${contract.label}-readiness`, `${contract.label}-hierarchy`, contract.label];
    for (const label of labels) {
      const command = commandByLabel.get(label);
      assert(command, `Android Maestro command receipt is missing: ${label}`);
      commandLabels.push(label);
    }
  }
  const cancelledObservation = byLabel.get('auth-signout-cancelled');
  assert(cancelledObservation);
  const cancelledHierarchy = readOwnedCaptureFile(
    root,
    cancelledObservation.hierarchyPath,
    'Android cancelled hierarchy',
    'hierarchy-json',
    guard,
  );
  const cancelledScreenshot = readOwnedCaptureFile(
    root,
    cancelledObservation.screenshotPath,
    'Android cancelled screenshot',
    'png',
    guard,
  );
  const cancelledHierarchySource = readOwnedCaptureFile(
    root,
    'auth-signout-cancelled-hierarchy.stdout',
    'Android cancelled hierarchy source',
    'hierarchy-source',
    guard,
  );
  const cancelledCommand = commandByLabel.get('auth-signout-cancelled-readiness');
  assert(cancelledCommand);
  const cancelledTree = JSON.parse(cancelledHierarchy.bytes.toString('utf8')) as unknown;
  const cancelledModalPresent = hasAttribute(
    cancelledTree,
    'resource-id',
    'settings.account.signOutConfirm',
  );
  const cancelledConfirmPresent = hasAttribute(
    cancelledTree,
    'resource-id',
    'settings.account.signOutConfirmCta',
  );
  assert.equal(cancelledModalPresent, false);
  assert.equal(cancelledConfirmPresent, false);
  const cancelledEvidence = requireAndroidCancelledConfirmationAbsent({
    hierarchyObserved: true,
    hierarchyPath: cancelledHierarchy.relative,
    screenshotPath: cancelledScreenshot.relative,
    hierarchySourcePath: cancelledHierarchySource.relative,
    hierarchySourceReceipt: cancelledHierarchySource.receipt,
    hierarchyReceipt: cancelledHierarchy.receipt,
    screenshotReceipt: cancelledScreenshot.receipt,
    modalPresent: false,
    confirmCtaPresent: false,
    commandExecution: cancelledCommand,
  });
  const cancelledConfirmationHash = hash(JSON.stringify(cancelledEvidence));
  for (const [index, raw] of charter.assertions.entries()) {
    const assertion = record(raw, `Android charter assertion ${index}`);
    assert.equal(assertion.id, androidSessionAssertionSequence[index]);
    assert.equal(assertion.order, index + 1);
    assert.equal(assertion.status, 'verified');
    assert(Array.isArray(assertion.sourceReceiptHashes));
    assert(assertion.sourceReceiptHashes.every((value) => /^[a-f0-9]{64}$/.test(String(value))));
    assert.equal(
      new Set(assertion.sourceReceiptHashes.map(String)).size,
      assertion.sourceReceiptHashes.length,
      `Android charter assertion ${index} repeats a source receipt`,
    );
    assert(typeof assertion.phase === 'string' && assertion.phase.length > 0);
    assert(!Object.hasOwn(assertion, 'observationLabels'));
    assert(!Object.hasOwn(assertion, 'commandLabels'));
    assert(!Object.hasOwn(assertion, 'maestroReceiptHashes'));
  }
  return {
    framePaths,
    commandLabels,
    commandHashes,
    frameHashes,
    cancelledConfirmationHash,
  };
}

function storageObservation(storage: JsonRecord, key: string): AndroidSessionStorageObservation {
  return record(
    storage[key],
    `Android ${key} storage`,
  ) as unknown as AndroidSessionStorageObservation;
}

function requireSignedOutStorage(value: AndroidSessionStorageObservation, label: string): void {
  assert.equal(value.status, 'session-absent', `${label} session was not cleared`);
  assert.equal(value.reason, 'none', `${label} storage is inconsistent`);
  assert.equal(value.asyncStorage.database, 'present', `${label} database probe is missing`);
  assert.equal(value.asyncStorage.recordPresent, false, `${label} session record remains`);
  assert.equal(value.asyncStorage.profilePresent, false, `${label} profile metadata remains`);
  assert.equal(value.asyncStorage.expiryPresent, false, `${label} expiry metadata remains`);
  assert.equal(
    value.asyncStorage.plaintextAccessTokenPresent,
    false,
    `${label} access token leaked`,
  );
  assert.equal(
    value.asyncStorage.plaintextRefreshTokenPresent,
    false,
    `${label} refresh token leaked`,
  );
  assert.equal(value.asyncStorage.recordBytes, null, `${label} session record bytes remain`);
  assert.equal(value.asyncStorage.profileAuthUidHash, null, `${label} profile identity remains`);
  // Deleting the last entry leaves an empty SecureStore preferences file; the
  // entry and key checks below are what prove the credential is gone.
  assert(
    value.secureStore.preferences === 'absent' || value.secureStore.preferences === 'present',
    `${label} SecureStore preferences state is invalid`,
  );
  assert.equal(
    value.secureStore.sessionEntryPresent,
    false,
    `${label} SecureStore session remains`,
  );
  assert.equal(value.secureStore.keyFormat, 'none', `${label} SecureStore key remains`);
}

function requireTransportIdentity(
  capture: JsonRecord,
  backend: ReturnType<typeof requireBackendIdentity>,
) {
  const auth = record(capture.androidSessionAuthIdentity, 'Android auth identity');
  assert.equal(auth.actor, 'coach');
  const restore = record(capture.androidSessionRestoreTransport, 'Android restore transport');
  const signedOut = record(
    capture.androidSessionSignedOutTransport,
    'Android signed-out transport',
  );
  const signedOutLifetime = record(signedOut.apiLifetime, 'Android signed-out API lifetime');
  // The producer publishes the signed-out lifetime on the terminal transport
  // record; restore transport is the exact adapter slice and has no synthetic
  // apiLifetime wrapper.
  const restoreLifetime = record(
    restore.apiLifetime ?? signedOut.apiLifetime,
    'Android restore API lifetime',
  );
  for (const lifetime of [restoreLifetime, signedOutLifetime]) {
    assert.equal(lifetime.runId, backend.runId);
    assert.equal(lifetime.apiPid, backend.apiPid);
    assert.equal(lifetime.apiOrigin, backend.targetOrigin);
    assert.equal(lifetime.backendAttemptId, backend.backendAttemptId);
  }
  const authRequestId = integer(auth.authRequestId, 'Android sign-in request', 1);
  const afterLoginRequestId = integer(auth.afterRequestId, 'Android login fence', authRequestId);
  const restoreBefore = integer(restore.beforeRequestId, 'Android restore fence', 0);
  const restoreAfter = integer(restore.afterRequestId, 'Android restore end', restoreBefore + 1);
  const signedOutBefore = integer(signedOut.beforeRequestId, 'Android signed-out fence', 0);
  const signedOutAfter = integer(
    signedOut.afterRequestId,
    'Android signed-out end',
    signedOutBefore,
  );
  const signedOutRows = signedOut.rows;
  assert(Array.isArray(signedOutRows), 'Android signed-out transport rows are missing');
  const signOut = record(capture.androidSessionSignOutTransport, 'Android sign-out transport');
  assert.equal(signOut.status, 'verified');
  assert.equal(signOut.phase, 'sign-out');
  const signOutBefore = integer(signOut.beforeRequestId, 'Android sign-out fence', 0);
  const signOutAfter = integer(signOut.afterRequestId, 'Android sign-out end', signOutBefore);
  assert.equal(
    signOutAfter,
    signedOutBefore,
    'Android sign-out window does not end at the signed-out relaunch',
  );
  assert(Array.isArray(signOut.rows), 'Android sign-out transport rows are missing');
  return {
    auth,
    restore,
    signOut,
    signedOut,
    restoreLifetime,
    signedOutLifetime,
    authRequestId,
    afterLoginRequestId,
    restoreBefore,
    restoreAfter,
    signOutBefore,
    signOutAfter,
    signedOutBefore,
    signedOutAfter,
    signedOutRows,
  };
}

function requirePersistedIdentity(capture: JsonRecord, coachAuthUid: string): string {
  const coachHash = hash(coachAuthUid);
  const cache = record(capture.androidSessionProfileCache, 'Android profile cache');
  assert.equal(cache.afterLoginAuthUidHash, coachHash);
  assert.equal(cache.afterRestorationAuthUidHash, coachHash);
  const cancelIdentity = record(capture.androidSessionCancelIdentity, 'Android cancel identity');
  assert.equal(cancelIdentity.status, 'verified');
  assert.equal(cancelIdentity.profileAuthUidHash, coachHash);
  const cancelStorage = record(capture.androidSessionCancelStorage, 'Android cancel storage');
  assert.equal(cancelStorage.status, 'session-present');
  assert.equal(
    record(cancelStorage.asyncStorage, 'Android cancel async storage').profileAuthUidHash,
    coachHash,
  );
  const secureStore = record(cancelStorage.secureStore, 'Android cancel SecureStore');
  assert(['current', 'legacy'].includes(String(secureStore.keyFormat)));
  return coachHash;
}

async function requireCheckpointIdentity(
  capture: JsonRecord,
  captureRoot: string,
  backend: ReturnType<typeof requireBackendIdentity>,
  guard: LoaderGuard,
  signal?: AbortSignal,
): Promise<{
  checkpointSet: AndroidSessionCheckpointReceipt[];
  copied: Awaited<ReturnType<typeof requireAndroidSessionCheckpointArtifacts>>;
  profiles: Record<Checkpoint, OwnedConnectionSnapshot>;
  domains: Record<Checkpoint, OwnedDomainSnapshot>;
  fixtureAuthUids: readonly string[];
  target: OwnedConnectionSnapshot['target'];
  profilePaths: string[];
  domainPaths: string[];
}> {
  const auth = record(capture.androidSessionAuthIdentity, 'Android auth identity');
  const receipts = checkpointReceipts(capture);
  const first = receipts[0];
  assert(first);
  const restoreTransport = record(
    capture.androidSessionRestoreTransport,
    'Android restore transport',
  );
  const signedOutTransport = record(
    capture.androidSessionSignedOutTransport,
    'Android signed-out transport',
  );
  // Restore transport is the exact adapter slice without an apiLifetime
  // wrapper; the producer publishes the lifetime on the signed-out record.
  const restoreLifetime = record(
    restoreTransport.apiLifetime ?? signedOutTransport.apiLifetime,
    'Android restore API lifetime',
  );
  const signedOutLifetime = record(
    signedOutTransport.apiLifetime,
    'Android signed-out API lifetime',
  );
  const expectedApiStarted = nonempty(restoreLifetime.apiStarted, 'Android restore API start');
  const expectedApiScript = nonempty(restoreLifetime.apiScript, 'Android restore API script');
  assert.equal(
    signedOutLifetime.apiStarted,
    expectedApiStarted,
    'Android API start changed across session',
  );
  assert.equal(
    signedOutLifetime.apiScript,
    expectedApiScript,
    'Android API script changed across session',
  );
  const apiProcess = record(backend.backend.apiProcess, 'Android backend API process');
  assert.equal(
    apiProcess.started,
    expectedApiStarted,
    'Android checkpoint API start is not backend-bound',
  );
  assert.equal(
    apiProcess.script,
    expectedApiScript,
    'Android checkpoint API script is not backend-bound',
  );
  const checkpointSet = requireAndroidSessionCheckpointSet({
    checkpoints: receipts,
    expectedRunId: backend.runId,
    expectedScope: 'native-entry-android',
    expectedApiOrigin: backend.targetOrigin,
    expectedApiPid: backend.apiPid,
    expectedBackendAttemptId: backend.backendAttemptId,
    expectedManifestSha256: first.manifestSha256,
    expectedFixtureAuthUidAllowlistHash: first.fixtureAuthUidAllowlistHash,
  });
  const copied = requireAndroidSessionCheckpointArtifacts({
    value: capture.androidSessionCheckpointArtifacts,
    checkpoints: checkpointSet,
    expectedRunId: backend.runId,
    expectedScope: 'native-entry-android',
    expectedApiOrigin: backend.targetOrigin,
    expectedApiPid: backend.apiPid,
    expectedBackendAttemptId: backend.backendAttemptId,
    expectedManifestSha256: first.manifestSha256,
    expectedFixtureAuthUidAllowlistHash: first.fixtureAuthUidAllowlistHash,
  });
  const profiles = {} as Record<Checkpoint, OwnedConnectionSnapshot>;
  const domains = {} as Record<Checkpoint, OwnedDomainSnapshot>;
  const profilePaths: string[] = [];
  const domainPaths: string[] = [];
  const documents = await readAndroidSessionCheckpointArtifacts({
    captureRoot,
    artifacts: copied,
    signal,
  });
  const phases: readonly AndroidSessionCheckpointReceipt['phase'][] = [
    'before-login',
    'after-login',
    'after-restoration',
    'after-signed-out-relaunch',
  ];
  for (const [index, checkpoint] of nativeSessionProfileCheckpointIds.entries()) {
    const phase = phases[index];
    const profile = documents.profiles[phase];
    const domain = documents.domains[phase];
    guard();
    profiles[checkpoint] = requireConnectionSnapshot(profile.value);
    domains[checkpoint] = domain.value as OwnedDomainSnapshot;
    assertTestingDocument('domain-snapshot-v1', domains[checkpoint]);
    profilePaths.push(profile.receipt.path);
    domainPaths.push(domain.receipt.path);
  }
  const fixtureAuthUids = profiles.beforeLogin.fixtureAuthUids;
  const target = profiles.beforeLogin.target;
  assert.equal(
    hash(JSON.stringify([...fixtureAuthUids].sort())),
    first.fixtureAuthUidAllowlistHash,
  );
  assert.equal(auth.fixtureAuthUidAllowlistHash, first.fixtureAuthUidAllowlistHash);
  return {
    checkpointSet,
    copied,
    profiles,
    domains,
    fixtureAuthUids,
    target,
    profilePaths,
    domainPaths,
  };
}

export function validateAndroidSessionPublicDependencyInput(input: {
  selection: NativePilotSelection;
  capture: JsonRecord;
  captureRoot: string;
  cleanup: JsonRecord;
  repositoryRoot: string;
  backend: ReturnType<typeof requireBackendIdentity>;
  transportBytes: Buffer;
  transportObservations: readonly ProxyObservation[];
  nativeAuthBytes: Buffer;
  nativeAuthIdentities: readonly NativeAuthIdentityObservation[];
  checkpoint: Awaited<ReturnType<typeof requireCheckpointIdentity>>;
}): AndroidSessionPublicDependencyResult {
  requireAndroidSessionSelectionArguments(input.selection.arguments);
  assert.deepEqual(
    requireNativePilotAssertions(input.selection).map((row) => row.id),
    nativeSessionAssertionIds,
  );
  requireAndroidSessionCaptureShape(input.capture);
  requireAndroidCleanupEvidence(input.cleanup, String(input.capture.captureRunId));
  requireFinalSessionTransport(
    input.transportBytes,
    { bytes: input.transportBytes.length, sha256: hash(input.transportBytes) },
    input.transportObservations,
  );
  requireFinalSessionTransport(
    input.nativeAuthBytes,
    { bytes: input.nativeAuthBytes.length, sha256: hash(input.nativeAuthBytes) },
    input.nativeAuthIdentities,
  );
  const identity = requireTransportIdentity(input.capture, input.backend);
  const coachAuthUid = input.checkpoint.target.professionalAuthUid;
  const studentAuthUid = input.checkpoint.target.studentAuthUid;
  const persistedCoachIdentity = record(
    input.capture.androidSessionProfileCache,
    'Android profile cache',
  ) as {
    afterLoginAuthUidHash: string;
    afterRestorationAuthUidHash: string;
  };
  const relaunchWindows = requireRelaunchWindows(input.capture.androidSessionRelaunchWindows);
  const profileVerification = verifyNativeSessionProfileCheckpoints({
    platform: 'android',
    backendRunId: input.backend.runId,
    fixtureAuthUids: input.checkpoint.fixtureAuthUids,
    coachAuthUid,
    studentAuthUid,
    expectedApiIdentity: { apiPid: input.backend.apiPid, targetOrigin: input.backend.targetOrigin },
    profiles: input.checkpoint.profiles,
    domain: input.checkpoint.domains,
    observations: input.transportObservations,
    authIdentities: input.nativeAuthIdentities,
    loginWindow: { afterRequestId: 0, throughRequestId: identity.afterLoginRequestId },
    restorationWindow: {
      afterRequestId: identity.restoreBefore,
      throughRequestId: identity.restoreAfter,
    },
    relaunchWindows,
    persistedCoachIdentity,
  });
  const restoreLifetime = identity.restoreLifetime;
  const restoreSlice = requireAndroidSessionTransportSlice({
    // The capture sliced the stream as it stood when restoration ended; replay
    // that prefix, since later session requests extend the final stream.
    observations: input.transportObservations.filter(
      (row) => row.requestId <= identity.restoreAfter,
    ),
    beforeRequestId: identity.restoreBefore,
    afterRequestId: identity.restoreAfter,
    phase: 'restore',
    targetOrigin: input.backend.targetOrigin,
    apiLifetime: restoreLifetime as never,
    expectedRunId: input.backend.runId,
    expectedProxyRunId: String(restoreLifetime.proxyRunId),
    expectedProxyOrigin: String(restoreLifetime.proxyOrigin),
  });
  assert.deepEqual(restoreSlice, identity.restore);
  // Sign-out starts where the last signed-in window ended, so no request the
  // app sent between the sign-out confirmation and the relaunch goes unchecked.
  assert.equal(
    identity.signOutBefore,
    relaunchWindows.at(-1)?.throughRequestId ?? identity.restoreAfter,
    'Android sign-out window does not start at the sign-out confirmation',
  );
  const signOutRows = requireSignOutSessionTransport({
    observations: input.transportObservations,
    window: { afterRequestId: identity.signOutBefore, throughRequestId: identity.signOutAfter },
    expectedTargetOrigin: input.backend.targetOrigin,
  });
  assert.deepEqual(
    signOutRows,
    identity.signOut.rows,
    'Android sign-out rows are not the stopped stream rows',
  );
  const signedOutRows = requireSignedOutSessionTransport({
    observations: input.transportObservations,
    window: { afterRequestId: identity.signedOutBefore, throughRequestId: identity.signedOutAfter },
    expectedTargetOrigin: input.backend.targetOrigin,
  });
  assert.deepEqual(signedOutRows, identity.signedOut.rows);
  requirePersistedIdentity(input.capture, coachAuthUid);
  const maestroEvidence = requireAndroidMaestroEvidence(input.captureRoot, input.capture);
  const commandHashesFor = (assertionIndex: number): string[] =>
    androidSessionPublicCommandLabelsByAssertion[assertionIndex].flatMap((label) => {
      const hashes = maestroEvidence.commandHashes.get(label);
      assert(hashes, `Android command hashes are missing: ${label}`);
      return [...hashes];
    });
  const coachIdentityRows = input.nativeAuthIdentities.filter(
    (row) => row.requestId === identity.auth.authRequestId,
  );
  assert.equal(coachIdentityRows.length, 1, 'Android coach identity source is not unique');
  const coachIdentity = coachIdentityRows[0];
  assert.equal(coachIdentity.status, 201);
  assert.equal(coachIdentity.verification, 'verified');
  assert.equal(coachIdentity.verificationReason, 'verified');
  assert.equal(coachIdentity.authUid, coachAuthUid);
  assert.equal(coachIdentity.apiPid, input.backend.apiPid);
  assert.equal(coachIdentity.targetOrigin, input.backend.targetOrigin);
  assert.equal(
    coachIdentity.fixtureAuthUidAllowlistHash,
    input.checkpoint.checkpointSet[0].fixtureAuthUidAllowlistHash,
  );
  const storage = record(input.capture.androidSessionStorage, 'Android session storage');
  const beforeRelaunch = storageObservation(storage, 'auth-before-relaunch');
  const afterRestore = storageObservation(storage, 'auth-after-restore');
  const afterSignOut = storageObservation(storage, 'auth-after-signout');
  const afterSignedOutRelaunch = storageObservation(storage, 'auth-after-signed-out-relaunch');
  const cancelledConfirmationEvidence = {
    status: 'verified' as const,
    modalPresent: false as const,
    confirmCtaPresent: false as const,
  };
  requireAndroidLocalSessionClear({
    beforeRelaunch,
    afterRestore,
    afterSignOut,
    afterSignedOutRelaunch,
    cancelledSessionIdentity: record(
      input.capture.androidSessionCancelIdentity,
      'Android cancel identity',
    ) as unknown as { status: 'verified'; profileAuthUidHash: string },
    cancelledConfirmationEvidence,
  });
  requireSignedOutStorage(afterSignOut, 'Android after sign-out');
  requireSignedOutStorage(afterSignedOutRelaunch, 'Android after signed-out relaunch');
  const domainBinding = record(input.capture.androidSessionDomain, 'Android domain binding');
  const sql = record(domainBinding.sql, 'Android SQL binding');
  const beforeSql = requireReceiptSet(
    input.captureRoot,
    sql.before,
    'Android SQL before',
    () => undefined,
  );
  const afterSql = requireReceiptSet(
    input.captureRoot,
    sql.after,
    'Android SQL after',
    () => undefined,
  );
  const cancelSql = requireReceiptSet(
    input.captureRoot,
    record(input.capture.androidSessionCancelStorage, 'Android cancel storage').privateArtifacts,
    'Android SQL after cancel',
    () => undefined,
  );
  const sqlPaths = [...beforeSql.paths, ...afterSql.paths, ...cancelSql.paths];
  const sourceHashes = [
    [
      input.checkpoint.checkpointSet[0].profile.sha256,
      input.checkpoint.checkpointSet[0].domain.sha256,
      ...commandHashesFor(0),
    ],
    [
      hash(
        JSON.stringify({
          requestId: identity.auth.authRequestId,
          status: coachIdentity.status,
          targetOrigin: identity.auth.targetOrigin,
          runId: input.backend.runId,
          fixtureAuthUidAllowlistHash: identity.auth.fixtureAuthUidAllowlistHash,
        }),
      ),
      ...commandHashesFor(1),
    ],
    [
      input.checkpoint.checkpointSet[1].profile.sha256,
      input.checkpoint.checkpointSet[1].domain.sha256,
      ...requireStorageReceiptHashes(
        input.captureRoot,
        storageObservation(storage, 'auth-before-relaunch'),
        'Android auth before relaunch',
        () => undefined,
      ),
      ...commandHashesFor(2),
    ],
    [
      hash(JSON.stringify(input.capture.androidSessionRestoreTransport)),
      input.checkpoint.checkpointSet[2].profile.sha256,
      input.checkpoint.checkpointSet[2].domain.sha256,
      ...requireStorageReceiptHashes(
        input.captureRoot,
        storageObservation(storage, 'auth-after-restore'),
        'Android auth after restore',
        () => undefined,
      ),
      ...commandHashesFor(3),
    ],
    [
      maestroEvidence.cancelledConfirmationHash,
      ...(maestroEvidence.frameHashes.get('auth-signout-cancelled') ?? []),
      ...requireStorageReceiptHashes(
        input.captureRoot,
        storageObservation(storage, 'auth-after-cancel'),
        'Android auth after cancel',
        () => undefined,
      ),
      hash(JSON.stringify(input.capture.androidSessionCancelIdentity)),
      ...commandHashesFor(4),
    ],
    [
      hash(JSON.stringify(input.capture.androidSessionSignOutTransport)),
      hash(JSON.stringify(input.capture.androidSessionSignedOutTransport)),
      input.checkpoint.checkpointSet[3].profile.sha256,
      input.checkpoint.checkpointSet[3].domain.sha256,
      ...requireStorageReceiptHashes(
        input.captureRoot,
        storageObservation(storage, 'auth-after-signed-out-relaunch'),
        'Android auth after signed-out relaunch',
        () => undefined,
      ),
      ...commandHashesFor(5),
    ],
  ];
  record(input.capture.androidSessionCharter, 'Android session charter');
  requireAndroidSessionAssertionSourceHashes(input.capture, sourceHashes);
  return {
    kind: 'private-android-session-public-dependency-not-public-receipt',
    status: 'validated-source-only',
    platform: 'android',
    engine: 'maestro',
    charter: 'session-account',
    assertionIds: [...androidSessionPublicAssertionIds],
    captureRunId: String(input.capture.captureRunId),
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    serverRevocationQualified: false,
    cleanup: 'cleaned',
    files: {
      framePaths: maestroEvidence.framePaths,
      profilePaths: input.checkpoint.profilePaths,
      domainPaths: input.checkpoint.domainPaths,
      transportPath: String(
        record(input.capture.androidSessionAuthEvidence, 'Android auth evidence').transportPath,
      ),
      nativeAuthIdentitiesPath: String(
        record(input.capture.androidSessionAuthEvidence, 'Android auth evidence')
          .nativeAuthIdentitiesPath,
      ),
      sqlPaths: [...new Set(sqlPaths)],
    },
    verification: {
      profileCheckpointStatus: profileVerification.status,
      signInRequestId: profileVerification.signInRequestId,
      restorationHydrateRequestId: profileVerification.restorationHydrateRequestId,
      signedOutRequestCount: identity.signedOutRows.length,
      coachAuthUidHash: profileVerification.coachAuthUidHash,
      fixtureAuthUidAllowlistHash: hash(
        JSON.stringify([...input.checkpoint.fixtureAuthUids].sort()),
      ),
    },
  };
}

async function currentSelection(
  repositoryRoot: string,
  guard: LoaderGuard,
): Promise<NativePilotSelection> {
  guard();
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  guard();
  const selection = await selectNativePilotScenario(
    androidSessionPublicSelection,
    inventory,
    repositoryRoot,
  );
  requireAndroidSessionSelectionArguments(selection.arguments);
  return selection;
}

async function loadInternal(
  options: {
    repositoryRoot: string;
    captureRoot: string;
    cleanupRoot: string;
    signal?: AbortSignal;
    deadlineMs?: number;
  },
  guard: LoaderGuard,
): Promise<AndroidSessionPublicLoad> {
  const repositoryRoot = await realpath(options.repositoryRoot);
  assert.equal(repositoryRoot, path.resolve(options.repositoryRoot));
  const captureRoot = await privateRoot(options.captureRoot, 'Android capture root');
  const cleanupRoot = await privateRoot(options.cleanupRoot, 'Android cleanup root');
  let selection: NativePilotSelection;
  try {
    selection = await currentSelection(repositoryRoot, guard);
  } catch (error) {
    if (error instanceof LoaderStoppedError) throw error;
    return blockedAndroidSessionDependency('selection-blocked', captureRoot, null, [
      error instanceof Error ? error.message : 'selection failed',
    ]);
  }
  const missing: string[] = [];
  const captureFile = readJson(captureRoot, 'capture.private.json', missing, guard);
  const captureRunId =
    captureFile && typeof record(captureFile.value, 'capture').captureRunId === 'string'
      ? String(record(captureFile.value, 'capture').captureRunId)
      : null;
  if (!captureFile)
    return blockedAndroidSessionDependency('incomplete', captureRoot, captureRunId, missing);
  if (captureRunId && path.basename(captureRoot) !== captureRunId)
    return blockedAndroidSessionDependency('blocked', captureRoot, captureRunId, [
      'captureRunId does not match artifact root basename',
    ]);
  let capture: JsonRecord;
  try {
    capture = requireAndroidSessionCaptureShape(captureFile.value);
  } catch (error) {
    return blockedAndroidSessionDependency('blocked', captureRoot, captureRunId, [
      error instanceof Error ? error.message : 'capture shape rejected',
    ]);
  }
  const backend = requireBackendIdentity(capture);
  const cleanupFile = readJson(cleanupRoot, 'external-cleanup.private.json', missing, guard);
  if (!cleanupFile)
    return blockedAndroidSessionDependency('blocked', captureRoot, captureRunId, missing);
  try {
    const currentBefore = await currentSourceAndHelpers(repositoryRoot, capture);
    requireSourceFreshness(capture, currentBefore);
    const checkpoint = await requireCheckpointIdentity(
      capture,
      captureRoot,
      backend,
      guard,
      options.signal,
    );
    const evidence = record(capture.androidSessionAuthEvidence, 'Android auth evidence');
    const transportFile = readReceipt(
      captureRoot,
      evidence.transportReceipt,
      'Android transport producer receipt',
      guard,
      androidSessionTransportEvidenceMaxBytes,
    );
    const authFile = readReceipt(
      captureRoot,
      evidence.nativeAuthIdentitiesReceipt,
      'Android auth identity producer receipt',
      guard,
      androidSessionTransportEvidenceMaxBytes,
    );
    assert.equal(transportFile.receipt.kind, 'transport', 'Android transport receipt kind changed');
    assert.equal(authFile.receipt.kind, 'auth', 'Android auth receipt kind changed');
    assert.equal(
      transportFile.relative,
      relativeEvidencePath(evidence.transportPath, 'Android transport path'),
    );
    assert.equal(
      authFile.relative,
      relativeEvidencePath(evidence.nativeAuthIdentitiesPath, 'Android native auth path'),
    );
    const transportObservations = JSON.parse(
      transportFile.bytes.toString('utf8'),
    ) as ProxyObservation[];
    const nativeAuthIdentities = JSON.parse(
      authFile.bytes.toString('utf8'),
    ) as NativeAuthIdentityObservation[];
    const result = validateAndroidSessionPublicDependencyInput({
      selection,
      capture,
      captureRoot,
      cleanup: record(cleanupFile.value, 'Android external cleanup'),
      repositoryRoot,
      backend,
      transportBytes: transportFile.bytes,
      transportObservations,
      nativeAuthBytes: authFile.bytes,
      nativeAuthIdentities,
      checkpoint,
    });
    guard();
    const currentAfter = await currentSourceAndHelpers(repositoryRoot, capture);
    assert.deepEqual(
      currentAfter,
      currentBefore,
      'Android source/helper identity changed during loading',
    );
    requireSourceFreshness(capture, currentAfter);
    return { ...result, selection: androidSessionPublicSelection };
  } catch (error) {
    if (error instanceof LoaderStoppedError) throw error;
    return blockedAndroidSessionDependency('blocked', captureRoot, captureRunId, [
      error instanceof Error ? error.message : 'Android dependency validation failed',
    ]);
  }
}

export async function loadAndroidSessionPublicDependency(options: {
  repositoryRoot: string;
  captureRoot: string;
  cleanupRoot: string;
  signal?: AbortSignal;
  deadlineMs?: number;
}): Promise<AndroidSessionPublicLoad> {
  const captureRoot = path.resolve(options.captureRoot);
  try {
    const guard = loaderGuard(options.signal, options.deadlineMs);
    guard();
    return await loadInternal(options, guard);
  } catch (error) {
    if (error instanceof LoaderStoppedError) throw error;
    return blockedAndroidSessionDependency('blocked', captureRoot, null, [
      error instanceof Error ? error.message : 'Android dependency loader failed',
    ]);
  }
}

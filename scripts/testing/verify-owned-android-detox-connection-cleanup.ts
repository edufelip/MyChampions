import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  parseProcesses,
  ownershipProcesses,
  processSurvivors,
  type ProcessIdentity,
} from './native-cleanup-evidence';

const execute = promisify(execFile);
const RUN_ID = /^[a-f0-9]{24}$/;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

export type AndroidDetoxConnectionCleanupTarget = Readonly<{
  platform: 'android';
  deviceId: string;
  androidRuntimeParent: string;
  androidSdkRoot: string;
  ownership: Readonly<{
    artifactRoot: string;
    hostLockRequired: true;
    cleanupAuthorized: true;
  }>;
}>;

export type AndroidDetoxConnectionCleanupOptions = Readonly<{
  repositoryRoot: string;
  artifactRoot: string;
  target: AndroidDetoxConnectionCleanupTarget;
  signal: AbortSignal;
  deadlineAt: number;
}>;

export type AndroidDetoxConnectionCleanupResult = Readonly<{
  kind: 'private-owned-android-detox-connection-cleanup';
  result: 'passed' | 'failed';
  censusStatus: 'available' | 'unavailable';
  nativePassingCases: 0;
  runId: string;
  processSurvivors: readonly number[];
  pidStartPairs: number;
  unavailablePorts: readonly number[];
  deletedDirectories: readonly string[];
  scope: 'android-detox-target-only';
}>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as JsonRecord;
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isAndroidDetoxOwnedReceiptName(name: string): boolean {
  return /^[a-z0-9-]+\.(?:private|ownership)\.json$/.test(name);
}

async function readPrivateJson(root: string, name: string): Promise<JsonRecord> {
  assert(isAndroidDetoxOwnedReceiptName(name), 'Android Detox receipt name is unsafe');
  const file = path.join(root, name);
  assert.equal(await realpath(file), file, `${name} is not canonical`);
  const before = await lstat(file);
  assert(
    before.isFile() && !before.isSymbolicLink() && before.nlink === 1,
    `${name} is not a single-link regular file`,
  );
  assert.equal(before.uid, process.getuid?.(), `${name} owner changed`);
  assert.equal(before.mode & 0o777, 0o600, `${name} mode is not private`);
  assert(before.size > 0 && before.size <= MAX_RECEIPT_BYTES, `${name} exceeds its byte bound`);
  const bytes = await readFile(file);
  const after = await lstat(file);
  assert.equal(bytes.byteLength, before.size, `${name} changed while reading`);
  assert.equal(after.dev, before.dev, `${name} device changed while reading`);
  assert.equal(after.ino, before.ino, `${name} inode changed while reading`);
  assert.equal(after.uid, before.uid, `${name} owner changed while reading`);
  assert.equal(after.mode & 0o777, before.mode & 0o777, `${name} mode changed while reading`);
  assert.equal(after.nlink, 1, `${name} link count changed while reading`);
  assert.equal(after.size, before.size, `${name} size changed while reading`);
  assert.equal(after.mtimeMs, before.mtimeMs, `${name} timestamp changed while reading`);
  assert.equal(after.ctimeMs, before.ctimeMs, `${name} change time changed while reading`);
  const value = JSON.parse(bytes.toString('utf8')) as unknown;
  const parsed = record(value, name);
  // Keep a local digest in the validation path so a future caller cannot
  // mistake a mutable parsed object for the protected receipt bytes.
  assert.match(hash(bytes), /^[a-f0-9]{64}$/);
  return parsed;
}

async function requirePrivateDirectory(directory: string, label: string): Promise<string> {
  const resolved = await realpath(directory);
  assert.equal(resolved, path.resolve(directory), `${label} is not canonical`);
  const metadata = await lstat(resolved);
  assert(
    metadata.isDirectory() && !metadata.isSymbolicLink(),
    `${label} is not a regular directory`,
  );
  assert.equal(metadata.uid, process.getuid?.(), `${label} owner changed`);
  assert.equal(metadata.mode & 0o777, 0o700, `${label} mode is not private`);
  return resolved;
}

function remaining(options: AndroidDetoxConnectionCleanupOptions): number {
  options.signal.throwIfAborted();
  const value = Math.floor(options.deadlineAt - performance.now());
  if (value <= 0) throw new Error('Android Detox cleanup deadline elapsed');
  return value;
}

/**
 * A direct Detox attempt owns one run directory. Camera routes add a distinct
 * capture child beneath their outer attempt so terminal evidence can retain
 * both identities. Both layouts remain inside the same private attempts root.
 */
export function requireAndroidDetoxAttemptArtifactRoot(
  repositoryRoot: string,
  artifactRoot: string,
): string {
  const attemptsRoot = path.join(repositoryRoot, '.qa/artifacts/native-pilot-attempts');
  const relative = path.relative(attemptsRoot, artifactRoot);
  const parts = relative.split(path.sep);
  assert(
    !relative.startsWith('..' + path.sep) && relative !== '..' && [1, 2].includes(parts.length),
    'Android Detox artifact root is outside the owned attempt namespace',
  );
  assert(
    parts.every((part) => RUN_ID.test(part)),
    'Android Detox attempt identity is invalid',
  );
  return parts.at(-1)!;
}

async function processCensus(
  options: AndroidDetoxConnectionCleanupOptions,
): Promise<ProcessIdentity[]> {
  const timeout = Math.min(10_000, remaining(options));
  const result = await execute('ps', ['-axo', 'pid=,lstart='], {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    signal: options.signal,
    env: { ...process.env, LC_ALL: 'C' },
  });
  const live = parseProcesses(result.stdout);
  assert(
    live.some((row) => row.pid === process.pid),
    'Android Detox process census is not current',
  );
  assert.equal(new Set(live.map((row) => row.pid)).size, live.length, 'Duplicate process identity');
  return live;
}

async function unavailablePorts(
  ports: readonly number[],
  options: AndroidDetoxConnectionCleanupOptions,
): Promise<number[]> {
  const result: number[] = [];
  for (const port of [...new Set(ports)]) {
    assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
    const timeout = Math.min(5_000, remaining(options));
    try {
      const value = await execute('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
        timeout,
        signal: options.signal,
      });
      if (value.stdout.trim()) result.push(port);
    } catch (error) {
      const failure = error as { code?: unknown; stdout?: string; stderr?: string };
      if (failure.code !== 1 || failure.stdout?.trim() || failure.stderr?.trim()) throw error;
    }
  }
  return result;
}

export function requireAndroidDetoxCleanupResult(
  value: unknown,
): AndroidDetoxConnectionCleanupResult {
  const result = record(value, 'Android Detox cleanup result');
  assert.equal(result.kind, 'private-owned-android-detox-connection-cleanup');
  assert.equal(result.result, 'passed');
  assert.equal(result.censusStatus, 'available');
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.scope, 'android-detox-target-only');
  assert(typeof result.runId === 'string' && RUN_ID.test(result.runId));
  assert(Array.isArray(result.processSurvivors) && result.processSurvivors.length === 0);
  assert(Array.isArray(result.unavailablePorts) && result.unavailablePorts.length === 0);
  return result as unknown as AndroidDetoxConnectionCleanupResult;
}

/**
 * Verifies the Android Detox target after its real owner stop. This is
 * intentionally separate from verifyOwnedAndroidCleanup: that verifier reads
 * the Maestro capture.private.json contract and cannot consume a Detox
 * connection attempt. No capture ledger is synthesized here.
 */
export async function verifyOwnedAndroidDetoxConnectionCleanup(
  options: AndroidDetoxConnectionCleanupOptions,
): Promise<AndroidDetoxConnectionCleanupResult> {
  const repositoryRoot = await realpath(options.repositoryRoot);
  assert.equal(
    repositoryRoot,
    path.resolve(options.repositoryRoot),
    'repository root is not canonical',
  );
  const artifactRoot = await requirePrivateDirectory(options.artifactRoot, 'artifact root');
  const runId = requireAndroidDetoxAttemptArtifactRoot(repositoryRoot, artifactRoot);
  assert.equal(options.target.platform, 'android');
  assert.equal(options.target.ownership.artifactRoot, artifactRoot);
  assert.equal(options.target.ownership.hostLockRequired, true);
  assert.equal(options.target.ownership.cleanupAuthorized, true);
  const runtimeParent = await requirePrivateDirectory(
    options.target.androidRuntimeParent,
    'Android runtime parent',
  );
  assert.equal(
    runtimeParent,
    path.join(artifactRoot, 'android-runtime'),
    'Android runtime parent is outside the owned attempt namespace',
  );
  const sdkRoot = await realpath(options.target.androidSdkRoot);
  const sdkMeta = await lstat(sdkRoot);
  assert(sdkMeta.isDirectory() && !sdkMeta.isSymbolicLink(), 'Android SDK root is not regular');
  const files = await readdir(artifactRoot);
  const acquisition = await readPrivateJson(artifactRoot, 'android-acquisition-owner.private.json');
  assert.equal(acquisition.kind, 'owned Android target acquisition intent');
  assert.equal(acquisition.captureRunId, runId);
  assert(typeof acquisition.runId === 'string' && RUN_ID.test(acquisition.runId));
  assert.equal(acquisition.runtimeParent, runtimeParent);
  const runtimeRoot = String(acquisition.runtimeRoot);
  assert.equal(path.dirname(runtimeRoot), runtimeParent);
  assert.equal(
    runtimeRoot,
    path.join(runtimeParent, `mychampions-pilot-${String(acquisition.runId)}`),
    'Android runtime root is not the acquired owner directory',
  );
  assert.equal(await realpath(runtimeRoot), runtimeRoot);
  const target = await readPrivateJson(artifactRoot, 'android-target.private.json');
  assert.equal(target.runId, acquisition.runId);
  assert.equal(target.runtimeRoot, runtimeRoot);
  const identity = record(target.identity, 'Android target identity');
  assert.equal(identity.serial, options.target.deviceId);
  assert.equal(target.marker, path.join(runtimeRoot, 'owner.private.json'));
  const cleanup = await readPrivateJson(artifactRoot, 'android-cleanup.private.json');
  assert.equal(cleanup.status, 'cleaned');
  assert.equal(cleanup.runId, acquisition.runId);
  assert.equal(cleanup.runtimeRoot, runtimeRoot);
  assert.deepEqual(cleanup.identity, target.identity);
  assert(!files.includes('android-cleanup-failure.private.json'));
  const deletedDirectories = cleanup.deletedDirectories;
  assert(Array.isArray(deletedDirectories) && deletedDirectories.length === 6);
  assert.deepEqual(
    deletedDirectories,
    ['avd', 'user', 'recovery', 'logs', 'tmp', 'locks'].map((suffix) =>
      path.join(runtimeRoot, suffix),
    ),
    'Android cleanup directory set differs from the acquired owner layout',
  );
  for (const directory of deletedDirectories) {
    assert(typeof directory === 'string' && path.dirname(directory) === runtimeRoot);
    try {
      await lstat(directory);
      throw new Error(`Owned Android runtime directory survived cleanup: ${directory}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const processGroups = cleanup.processGroups;
  assert(Array.isArray(processGroups) && processGroups.length > 0);
  const ownershipFiles = files.filter((name) => /^android-[a-z0-9-]+\.ownership\.json$/.test(name));
  assert(ownershipFiles.length >= 3, 'Android Detox target ownership ledgers are incomplete');
  const ownedProcesses = [] as ProcessIdentity[];
  const ledgerGroups = new Set<number>();
  for (const name of ownershipFiles) {
    const ledger = await readPrivateJson(artifactRoot, name);
    assert.equal(ledger.cleanup, 'cleaned', `${name} cleanup did not pass`);
    if (Number.isSafeInteger(ledger.pgid)) ledgerGroups.add(Number(ledger.pgid));
    ownedProcesses.push(...ownershipProcesses(ledger));
  }
  const groups = new Set(processGroups.map((value) => Number(value)));
  assert([...groups].every((value) => Number.isSafeInteger(value) && value > 1));
  assert(
    [...groups].every((value) => ledgerGroups.has(value)),
    'Target process group lacks ownership ledger',
  );
  const live = await processCensus(options);
  const survivors = processSurvivors(ownedProcesses, live);
  const ports = cleanup.reservedPorts;
  assert(Array.isArray(ports), 'Android Detox cleanup reserved-port receipt is missing');
  const occupied = await unavailablePorts(ports.map(Number), options);
  const result: AndroidDetoxConnectionCleanupResult = {
    kind: 'private-owned-android-detox-connection-cleanup',
    result: survivors.survivors.length === 0 && occupied.length === 0 ? 'passed' : 'failed',
    censusStatus: 'available',
    nativePassingCases: 0,
    runId,
    processSurvivors: [...survivors.survivors],
    pidStartPairs: survivors.pidStartPairs,
    unavailablePorts: occupied,
    deletedDirectories: deletedDirectories.map(String),
    scope: 'android-detox-target-only',
  };
  return requireAndroidDetoxCleanupResult(result);
}

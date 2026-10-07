import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  parseNativePilotInvocationArguments,
  type NativePilotColdResetBinding,
} from './native-pilot-invocation';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import { loadExplorationCharters, type ExplorationCharter } from './prepare-exploration';
import {
  T16B_QA_EXPLORE_ROUTE,
  T16B_SUPPORTED_CHARTER_ID,
  runOwnedT16BFromOwnedIosNativeSession,
  type T16BOwnedIosNativeEntrypointResult,
} from './t16b-owned-ios-native-entrypoint';
import type { IosConnectionRuntimeContext } from './capture-native-testability';
import type { SocketObservation } from './owned-maestro-mcp-stdio';
import type {
  BoundedAction,
  OwnedCleanupAudit,
  OriginalEvidence,
  PreparedExplorationCharter,
  T16BChooser,
  T16BCleanup,
} from './t16b-owned-exploration-controller';

const executeFile = promisify(execFile);
const RUN_ID = /^[a-f0-9]{24}$/u;
const LOCALES = ['en-US', 'pt-BR', 'es-ES'] as const;
const MAX_ARGUMENT_BYTES = 4096;
const MAX_MCP_ARGS = 12;
const MAX_SOCKET_PIDS = 64;
const T16_OWNER_DEADLINE_MS = 30 * 60 * 1000;
const NATIVE_BUILD_DEADLINE_CAP_MS = 15 * 60 * 1000;
const NATIVE_STEP_DEADLINE_CAP_MS = 10 * 60 * 1000;
const NATIVE_WHOLE_RUN_DEADLINE_CAP_MS = 40 * 60 * 1000;

type JsonObject = Record<string, unknown>;

export type T16OwnedExplorationArguments = Readonly<{
  charterId: typeof T16B_SUPPORTED_CHARTER_ID;
  locale: (typeof LOCALES)[number];
  runId: string;
  attemptId: string;
  coldResetBinding: string;
  maestroCommand: string;
  maestroArgs: readonly string[];
  reuseBuildRunId?: string;
  reuseBuildSourceRoot?: string;
}>;

export type T16OwnedExplorationFinalReceipt = Readonly<{
  schema: 't16-owned-exploration-terminal-v1';
  route: typeof T16B_QA_EXPLORE_ROUTE;
  charterId: typeof T16B_SUPPORTED_CHARTER_ID;
  requestedRunId: string;
  requestedAttemptId: string;
  status: 'observed' | 'blocked' | 'not-run';
  publicPublicationEligible: false;
  nativePassingCases: 0;
  terminal: JsonObject | null;
  sourceCommandPath: string;
  sourceCommandBytes: number;
  sourceCommandHash: string;
  sourceCommandIdentity: NativeEvidenceIdentity;
}>;

type PreparedReset = {
  readonly binding: NativePilotColdResetBinding;
  readonly expectation: {
    requestedRunId: string;
    requestedAttemptId: string;
    fixtureResetId: string;
    cohortFixtureFingerprint: string;
    sourceFingerprint: string;
    helperFingerprint: string;
  };
};

export type OwnedMcpCommand = {
  readonly path: string;
  readonly argv: readonly string[];
  readonly commandSha256: string;
  readonly commandBytes: number;
  readonly sourceIdentity: NativeEvidenceIdentity;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safeValue(value: string, label: string, max = MAX_ARGUMENT_BYTES): string {
  assert(value.length > 0 && value.length <= max, `${label} is invalid`);
  assert(!/[\u0000\r\n]/u.test(value), `${label} contains a control character`);
  return value;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashValue(value: unknown): string {
  return hashBytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

function isUnrefTimer(timer: unknown): timer is { unref: () => unknown } {
  return (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  );
}

function unrefTimer(timer: unknown): void {
  if (isUnrefTimer(timer)) timer.unref();
}

function monotonicNowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

export type T16OperationScope = {
  readonly signal: AbortSignal;
  readonly deadlineAtMonotonicMs: number;
  readonly check: (label: string) => void;
  readonly wait: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
  readonly dispose: () => void;
};

export function createT16OperationScope(
  externalSignal: AbortSignal | undefined,
  requestedDeadlineAtMonotonicMs?: number,
): T16OperationScope {
  const startedAt = monotonicNowMs();
  const deadlineAtMonotonicMs = requestedDeadlineAtMonotonicMs ?? startedAt + T16_OWNER_DEADLINE_MS;
  assert(
    Number.isSafeInteger(deadlineAtMonotonicMs) && deadlineAtMonotonicMs > 0,
    'T16 owner deadline is invalid',
  );
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const remainingMs = Math.max(1, deadlineAtMonotonicMs - startedAt);
  if (deadlineAtMonotonicMs <= startedAt)
    controller.abort(new Error('T16 owner deadline reached before preparation'));
  const timer = setNodeTimeout(
    () => controller.abort(new Error('T16 owner deadline reached')),
    remainingMs,
  );
  unrefTimer(timer);
  const check = (label: string): void => {
    controller.signal.throwIfAborted();
    assert(monotonicNowMs() <= deadlineAtMonotonicMs, `T16 owner deadline reached during ${label}`);
  };
  const wait = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
    check(label);
    const value = await operation();
    check(label);
    return value;
  };
  return {
    signal: controller.signal,
    deadlineAtMonotonicMs,
    check,
    wait,
    dispose: () => {
      clearNodeTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
}

function nativeDeadlinesForRemaining(remainingMs: number) {
  assert(remainingMs >= 1_000, 'T16 owner deadline leaves no native execution budget');
  return {
    buildMs: Math.max(1_000, Math.min(NATIVE_BUILD_DEADLINE_CAP_MS, remainingMs)),
    stepMs: Math.max(1_000, Math.min(NATIVE_STEP_DEADLINE_CAP_MS, remainingMs)),
    wholeRunMs: Math.max(1_000, Math.min(NATIVE_WHOLE_RUN_DEADLINE_CAP_MS, remainingMs)),
  };
}

function ownUid(): number {
  assert(typeof process.getuid === 'function', 'Current owner UID is unavailable');
  return process.getuid();
}

function requireRunId(value: string, label: string): string {
  assert(RUN_ID.test(value), `${label} is invalid`);
  return value;
}

function parseFlagValue(argv: readonly string[], index: number, flag: string): string {
  const argument = argv[index];
  const prefix = `${flag}=`;
  if (argument.startsWith(prefix)) return safeValue(argument.slice(prefix.length), flag);
  const next = argv[index + 1];
  assert(next !== undefined && !next.startsWith('--'), `${flag} requires a value`);
  return safeValue(next, flag);
}

export function parseT16OwnedExplorationArguments(
  argv: readonly string[],
): T16OwnedExplorationArguments {
  const values = new Map<string, string>();
  const maestroArgs: string[] = [];
  const allowed = new Set([
    '--charter',
    '--locale',
    '--run-id',
    '--attempt-id',
    '--cold-reset-binding',
    '--maestro-command',
    '--reuse-build-run-id',
    '--reuse-build-source-root',
  ]);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--maestro-arg' || argument.startsWith('--maestro-arg=')) {
      const value = parseFlagValue(argv, index, '--maestro-arg');
      if (!argument.includes('=')) index++;
      assert(maestroArgs.length < MAX_MCP_ARGS, 'Too many Maestro MCP arguments');
      maestroArgs.push(value);
      continue;
    }
    const flag = argument.split('=', 1)[0];
    assert(allowed.has(flag), `Unsupported T16 ${T16B_QA_EXPLORE_ROUTE} argument`);
    assert(!values.has(flag), `Duplicate T16 ${T16B_QA_EXPLORE_ROUTE} argument`);
    const value = parseFlagValue(argv, index, flag);
    if (!argument.includes('=')) index++;
    values.set(flag, value);
  }
  const charterId = values.get('--charter');
  const locale = values.get('--locale');
  const runId = values.get('--run-id');
  const attemptId = values.get('--attempt-id');
  const coldResetBinding = values.get('--cold-reset-binding');
  const maestroCommand = values.get('--maestro-command');
  assert(
    charterId === T16B_SUPPORTED_CHARTER_ID,
    'T16-B qa:explore requires the checked-in two-role charter',
  );
  assert(
    locale !== undefined && (LOCALES as readonly string[]).includes(locale),
    'T16-B locale is invalid',
  );
  assert(runId !== undefined && attemptId !== undefined, 'T16-B run and attempt IDs are required');
  requireRunId(runId, 'T16-B run ID');
  assert(attemptId === `${runId}:first`, 'T16-B attempt must be the first attempt of its run');
  assert(coldResetBinding !== undefined, 'T16-B requires a real cold-reset binding');
  assert(maestroCommand !== undefined, 'T16-B requires an owned Maestro MCP command');
  assert(maestroArgs.includes('mcp'), 'Maestro MCP argv must include the mcp subcommand');
  const reuseBuildRunId = values.get('--reuse-build-run-id');
  if (reuseBuildRunId !== undefined) requireRunId(reuseBuildRunId, 'reuse build run ID');
  const reuseBuildSourceRoot = values.get('--reuse-build-source-root');
  if (reuseBuildSourceRoot !== undefined) {
    assert(path.isAbsolute(reuseBuildSourceRoot), 'reuse build source root must be absolute');
  }
  return Object.freeze({
    charterId: T16B_SUPPORTED_CHARTER_ID,
    locale: locale as (typeof LOCALES)[number],
    runId,
    attemptId,
    coldResetBinding,
    maestroCommand,
    maestroArgs: Object.freeze([...maestroArgs]),
    ...(reuseBuildRunId ? { reuseBuildRunId } : {}),
    ...(reuseBuildSourceRoot ? { reuseBuildSourceRoot } : {}),
  });
}

async function requireCanonicalRepositoryRoot(repositoryRoot: string): Promise<string> {
  assert(path.isAbsolute(repositoryRoot), 'T16 repository root must be absolute');
  const resolved = path.resolve(repositoryRoot);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'T16 repository root is not a directory');
  assert((await realpath(resolved)) === resolved, 'T16 repository root is not canonical');
  return resolved;
}

async function requirePrivateArtifactRoot(root: string, repositoryRoot: string): Promise<string> {
  const resolved = await requireCanonicalRepositoryRoot(root);
  const qaRoot = path.join(repositoryRoot, '.qa', 'artifacts');
  assert(
    resolved.startsWith(qaRoot + path.sep),
    'Cold reset artifact root is outside .qa/artifacts',
  );
  const info = await lstat(resolved);
  assert(
    info.isDirectory() && !info.isSymbolicLink(),
    'Cold reset artifact root is not a directory',
  );
  assert(
    (info.mode & 0o777) === 0o700 && info.uid === ownUid(),
    'Cold reset artifact root ownership is invalid',
  );
  return resolved;
}

function sameIdentity(left: NativeEvidenceIdentity, right: NativeEvidenceIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function object(value: unknown, label: string): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  return value as JsonObject;
}

function exactString(row: JsonObject, key: string, expected: string, label: string): void {
  assert(row[key] === expected, `${label}.${key} differs from the binding`);
}

export async function validateT16ColdResetBindingOnDisk(
  binding: NativePilotColdResetBinding,
  repositoryRoot: string,
): Promise<PreparedReset> {
  const artifactRoot = await requirePrivateArtifactRoot(binding.artifactRoot, repositoryRoot);
  const receiptPath = path.resolve(binding.receiptPath);
  assert(
    receiptPath.startsWith(artifactRoot + path.sep),
    'Cold reset receipt escaped its artifact root',
  );
  const relative = path.relative(artifactRoot, receiptPath);
  assert(
    relative === 'reset-original.private.json' &&
      path.resolve(artifactRoot, relative) === receiptPath,
    'Cold reset receipt path is not canonical',
  );
  assert(
    relative === 'reset-original.private.json',
    'T16 requires the original cold-reset receipt',
  );
  const observation = readNativeEvidenceObservation(artifactRoot, relative, true);
  assert(hashBytes(observation.bytes) === binding.receiptHash, 'Cold reset receipt hash differs');
  assert(
    sameIdentity(observation.identity, binding.sourceIdentity),
    'Cold reset receipt identity changed',
  );
  let parsed: JsonObject;
  try {
    parsed = object(JSON.parse(observation.bytes.toString('utf8')), 'Cold reset receipt');
  } catch {
    throw new Error('Cold reset receipt is not bounded JSON');
  }
  exactString(
    parsed,
    'kind',
    'private-t15-cold-reset-original-from-owned-ios-session',
    'Cold reset receipt',
  );
  exactString(parsed, 'status', 'fresh', 'Cold reset receipt');
  exactString(parsed, 'requestedRunId', binding.ownerRunId, 'Cold reset receipt');
  exactString(parsed, 'requestedAttemptId', binding.attemptId, 'Cold reset receipt');
  exactString(parsed, 'ownerRunId', binding.ownerRunId, 'Cold reset receipt');
  exactString(parsed, 'fixtureResetId', binding.fixtureResetId, 'Cold reset receipt');
  exactString(
    parsed,
    'cohortFixtureFingerprint',
    binding.cohortFixtureFingerprint,
    'Cold reset receipt',
  );
  exactString(parsed, 'appStateFingerprint', binding.appStateFingerprint, 'Cold reset receipt');
  exactString(
    parsed,
    'fixtureStateFingerprint',
    binding.fixtureStateFingerprint,
    'Cold reset receipt',
  );
  exactString(parsed, 'sourceFingerprint', binding.sourceFingerprint, 'Cold reset receipt');
  exactString(parsed, 'helperFingerprint', binding.helperFingerprint, 'Cold reset receipt');
  exactString(parsed, 'cleanupStatus', 'cleaned', 'Cold reset receipt');
  assert(parsed.blocker === null, 'Cold reset receipt contains a blocker');
  assert(
    hashValue(parsed.target) === hashValue(binding.target),
    'Cold reset target binding differs',
  );
  assert(
    hashValue(parsed.backend) === hashValue(binding.backend),
    'Cold reset backend binding differs',
  );
  return {
    binding,
    expectation: {
      requestedRunId: binding.ownerRunId,
      requestedAttemptId: binding.attemptId,
      fixtureResetId: binding.fixtureResetId,
      cohortFixtureFingerprint: binding.cohortFixtureFingerprint,
      sourceFingerprint: binding.sourceFingerprint,
      helperFingerprint: binding.helperFingerprint,
    },
  };
}

function parseResetBinding(value: string, args: T16OwnedExplorationArguments) {
  const invocation = parseNativePilotInvocationArguments([
    '--platform=ios',
    '--engine=maestro',
    '--scenario=SCN-connection-ios',
    '--mode=integration',
    `--run-id=${args.runId}`,
    `--attempt-id=${args.attemptId}`,
    `--cold-reset-binding=${value}`,
  ]);
  assert(invocation.requestedRunId === args.runId, 'Cold reset run binding differs');
  assert(invocation.requestedAttemptId === args.attemptId, 'Cold reset attempt binding differs');
  assert(
    invocation.coldResetBinding !== null && invocation.coldResetBinding !== undefined,
    'Cold reset binding is absent',
  );
  return invocation.coldResetBinding;
}

async function requireOwnedMcpCommand(
  args: T16OwnedExplorationArguments,
  signal: AbortSignal,
  deadlineAtMonotonicMs: number,
): Promise<OwnedMcpCommand> {
  assert(path.isAbsolute(args.maestroCommand), 'Maestro command must be absolute');
  const command = path.resolve(args.maestroCommand);
  const observation = await readOwnedMcpCommandObservation(command, {
    signal,
    deadlineAtMonotonicMs,
  });
  const argv = [command, ...args.maestroArgs];
  return {
    path: command,
    argv,
    commandSha256: hashBytes(observation.bytes),
    commandBytes: observation.bytes.byteLength,
    sourceIdentity: observation.identity,
  };
}

type CommandStats = {
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
};

function commandStatsIdentity(stat: CommandStats): NativeEvidenceIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function assertOwnedMcpCommandStats(
  stat: CommandStats & { isFile(): boolean; isSymbolicLink(): boolean },
  label: string,
): void {
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  assert(
    stat.uid === ownUid() &&
      stat.nlink === 1 &&
      (stat.mode & 0o022) === 0 &&
      (stat.mode & 0o111) !== 0,
    `${label} ownership, link count or mode is unsafe`,
  );
  assert(
    stat.size > 0 && stat.size <= 32 * 1024 * 1024,
    `${label} is empty or exceeds the bounded command size`,
  );
}

/**
 * Reads the executable through an O_NOFOLLOW descriptor and compares the
 * path, descriptor and post-read identities. Executable input intentionally
 * uses its executable mode rather than the private-record 0600 policy.
 */
export async function readOwnedMcpCommandObservation(
  commandPath: string,
  options: {
    readonly signal?: AbortSignal;
    readonly deadlineAtMonotonicMs?: number;
  } = {},
): Promise<{
  readonly bytes: Buffer;
  readonly identity: NativeEvidenceIdentity;
}> {
  const checkBudget = (): void => {
    options.signal?.throwIfAborted();
    if (
      options.deadlineAtMonotonicMs !== undefined &&
      monotonicNowMs() > options.deadlineAtMonotonicMs
    ) {
      throw new Error('MCP command descriptor read deadline reached');
    }
  };
  checkBudget();
  assert(path.isAbsolute(commandPath), 'Maestro command must be absolute');
  const command = path.resolve(commandPath);
  const pathBefore = await lstat(command);
  checkBudget();
  assertOwnedMcpCommandStats(pathBefore, 'Maestro command');
  assert((await realpath(command)) === command, 'Maestro command is not canonical');
  checkBudget();
  assert(
    typeof fsConstants.O_NOFOLLOW === 'number',
    'Maestro command reader cannot enforce no-follow opens',
  );
  const descriptor = await open(command, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = await descriptor.stat();
    checkBudget();
    assertOwnedMcpCommandStats(descriptorBefore, 'Maestro command descriptor');
    assert(
      sameIdentity(commandStatsIdentity(pathBefore), commandStatsIdentity(descriptorBefore)),
      'Maestro command changed before descriptor read',
    );
    const bytes = Buffer.allocUnsafe(descriptorBefore.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      checkBudget();
      const read = await descriptor.read(
        bytes,
        offset,
        Math.min(64 * 1024, bytes.byteLength - offset),
        null,
      );
      checkBudget();
      assert(read.bytesRead > 0, 'Maestro command was truncated during bounded read');
      offset += read.bytesRead;
    }
    checkBudget();
    const extra = Buffer.allocUnsafe(1);
    const extraRead = await descriptor.read(extra, 0, 1, null);
    checkBudget();
    assert(extraRead.bytesRead === 0, 'Maestro command grew during bounded read');
    const descriptorAfter = await descriptor.stat();
    const pathAfter = await lstat(command);
    checkBudget();
    assertOwnedMcpCommandStats(pathAfter, 'Maestro command after read');
    assert(
      sameIdentity(commandStatsIdentity(descriptorBefore), commandStatsIdentity(descriptorAfter)) &&
        sameIdentity(commandStatsIdentity(descriptorBefore), commandStatsIdentity(pathAfter)),
      'Maestro command identity changed during bounded read',
    );
    assert((await realpath(command)) === command, 'Maestro command path changed during read');
    checkBudget();
    return { bytes, identity: commandStatsIdentity(descriptorAfter) };
  } finally {
    await descriptor.close();
  }
}

export async function verifyOwnedMcpCommand(
  command: OwnedMcpCommand,
  signal?: AbortSignal,
  deadlineAtMonotonicMs?: number,
): Promise<void> {
  signal?.throwIfAborted();
  const observation = await readOwnedMcpCommandObservation(command.path, {
    signal,
    deadlineAtMonotonicMs,
  });
  signal?.throwIfAborted();
  assert(observation.bytes.byteLength === command.commandBytes, 'Maestro command size changed');
  assert(hashBytes(observation.bytes) === command.commandSha256, 'Maestro command hash changed');
  assert(
    sameIdentity(observation.identity, command.sourceIdentity),
    'Maestro command identity changed before or after launch',
  );
}

export async function inspectOwnedT16McpSockets(
  pids: readonly number[],
): Promise<readonly SocketObservation[]> {
  assert(pids.length <= MAX_SOCKET_PIDS, 'MCP socket census is unbounded');
  const rows: SocketObservation[] = [];
  for (const pid of pids) {
    assert(Number.isSafeInteger(pid) && pid > 1, 'MCP socket census PID is invalid');
    try {
      const result = await executeFile('lsof', ['-nP', '-a', '-p', String(pid), '-i'], {
        encoding: 'buffer',
        timeout: 5000,
        maxBuffer: 64 * 1024,
      });
      const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
      if (bytes.byteLength > 64 * 1024) throw new Error('MCP socket census output is unbounded');
      if (bytes.toString('utf8').trim()) rows.push({ pid, lineSha256: hashBytes(bytes) });
    } catch (error) {
      const code =
        error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
      if (code === 1) continue;
      throw new Error('Owned MCP socket census is unavailable');
    }
  }
  return rows;
}

function charterForRoute(value: ExplorationCharter): PreparedExplorationCharter {
  assert(value.id === T16B_SUPPORTED_CHARTER_ID, 'T16 qa:explore charter is not supported');
  assert(value.platforms.includes('ios'), 'T16 qa:explore charter does not support iOS');
  assert(
    value.connectorsByPlatform.ios === 'maestro',
    'T16 qa:explore charter does not use Maestro',
  );
  return value as PreparedExplorationCharter;
}

function qualificationAction(charter: PreparedExplorationCharter): BoundedAction {
  const id = charter.allowedActions.find((value) =>
    value.startsWith('Return to the professional UI'),
  );
  assert(id !== undefined, 'T16 charter lacks the documented reversible navigation action');
  return { id, command: 'tapOn', selector: { id: 'tabs.home' } };
}

export function createT16Chooser(): T16BChooser {
  return ({ observation, charter, signal }) => {
    signal.throwIfAborted();
    const raw = Buffer.from(observation.rawBytes).toString('utf8');
    if (!raw.includes('pro.home.screen')) return Promise.resolve(null);
    const id = charter.allowedActions.find((value) =>
      value.startsWith('Check the final relationship'),
    );
    if (!id) return Promise.resolve(null);
    return Promise.resolve({ id, command: 'assertVisible', selector: { id: 'pro.home.screen' } });
  };
}

function makeEvidence(
  context: IosConnectionRuntimeContext,
  expectedRunId: string,
  expectedAttemptId: string,
  locale: (typeof LOCALES)[number],
  relativePath: string,
  bytes: Buffer,
  capturedAtMonotonicMs: number,
  identity: JsonObject,
): OriginalEvidence {
  const observation = readNativeEvidenceObservation(context.output, relativePath, true);
  assert(observation.bytes.equals(bytes), 'T16 cleanup evidence readback changed');
  return {
    kind: 'cleanup',
    runId: expectedRunId,
    attemptId: expectedAttemptId,
    platform: 'ios',
    locale,
    path: relativePath,
    bytes: observation.bytes,
    capturedAtMonotonicMs,
    identity: {
      runId: expectedRunId,
      attemptId: expectedAttemptId,
      capturedAtMonotonicMs,
      ...identity,
    },
    source: {
      artifactRoot: context.output,
      path: relativePath,
      sha256: hashBytes(observation.bytes),
      bytes: observation.bytes.byteLength,
      uid: observation.identity.uid,
      mode: '0600',
      nlink: 1,
      regular: true,
      symlink: false,
    },
  };
}

function boundedRecovery<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, `${label} timeout is invalid`);
  // Recovery may continue after the bounded race settles. Observe the late
  // rejection so a cancelled cleanup cannot become an unhandled process error.
  operation.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${label} recovery signal aborted`));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function createT16CleanupAudit(
  contextRef: () => IosConnectionRuntimeContext | null,
  expectedRunId: string,
  expectedAttemptId: string,
  locale: (typeof LOCALES)[number],
): T16BCleanup {
  return {
    audit: async ({ connectorStartAttempted, signal }): Promise<OwnedCleanupAudit> => {
      const context = contextRef();
      assert(context !== null, 'T16 cleanup context was not retained');
      const now = Number(process.hrtime.bigint() / 1_000_000n);
      const connectorPath = `mcp-t16b/${expectedAttemptId}/connector-cleanup-receipt.private.bin`;
      let cleanupRow: JsonObject | null = null;
      let connectorEvidence: OriginalEvidence | undefined;
      if (connectorStartAttempted) {
        const observation = readNativeEvidenceObservation(context.output, connectorPath, true);
        cleanupRow = object(JSON.parse(observation.bytes.toString('utf8')), 'MCP cleanup receipt');
        connectorEvidence = makeEvidence(
          context,
          expectedRunId,
          expectedAttemptId,
          locale,
          connectorPath,
          observation.bytes,
          now,
          { connectorReceiptSha256: hashBytes(observation.bytes) },
        );
      }
      const mcpNamespaceAbsent =
        connectorStartAttempted &&
        cleanupRow?.status === 'cleaned' &&
        cleanupRow.ownedProcessGroupAbsent === true &&
        cleanupRow.socketResourcesAbsent === true &&
        cleanupRow.cleanupError === null &&
        cleanupRow.protocolFailure === null;
      // The connector receipt is authoritative only for the MCP child it
      // owns. Backend absence and preservation of foreign resources belong to
      // the parent-owned external cleanup receipt and must stay unproven here.
      const outerCleanupStatus = 'unproven' as const;
      const backendResourcesAbsent = false;
      const foreignResourcesPreserved = false;
      const cleaned = mcpNamespaceAbsent;
      const summaryPath = 't16-mcp-cleanup-audit.private.json';
      const summary = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          kind: 't16-mcp-cleanup-audit',
          connectorStartAttempted,
          connectorReceiptPath: connectorEvidence?.path ?? null,
          connectorReceiptSha256: connectorEvidence?.source.sha256 ?? null,
          connectorStatus: cleanupRow?.status ?? 'not-acquired',
          ownedProcessGroupAbsent: mcpNamespaceAbsent,
          socketResourcesAbsent: mcpNamespaceAbsent,
          outerCleanupStatus,
          backendResourcesAbsent,
          foreignResourcesPreserved,
          scope: 't16-owned-mcp-namespace-only',
        }),
        'utf8',
      );
      await boundedRecovery(
        writeFile(path.join(context.output, summaryPath), summary, { flag: 'wx', mode: 0o600 }),
        signal,
        'T16 cleanup summary write',
      );
      await boundedRecovery(
        chmod(path.join(context.output, summaryPath), 0o600),
        signal,
        'T16 cleanup summary mode',
      );
      const source = makeEvidence(
        context,
        expectedRunId,
        expectedAttemptId,
        locale,
        summaryPath,
        summary,
        now,
        {
          connectorStatus: cleanupRow?.status ?? 'not-acquired',
          mcpNamespaceAbsent,
          outerCleanupStatus,
          backendResourcesAbsent,
          foreignResourcesPreserved,
        },
      );
      const status: OwnedCleanupAudit['status'] = cleaned
        ? 'cleaned'
        : connectorStartAttempted
          ? 'failed-recovery-retained'
          : 'not-acquired';
      return {
        kind: 'owned-exploration-cleanup',
        scope: 't16-owned-mcp-namespace-only',
        runId: expectedRunId,
        attemptId: expectedAttemptId,
        status,
        capturedAtMonotonicMs: now,
        ownedProcessGroupAbsent: mcpNamespaceAbsent,
        socketResourcesAbsent: mcpNamespaceAbsent,
        outerCleanupStatus,
        // These are deliberately false until the outer iOS owner supplies its
        // separately bound cleanup receipt. The MCP receipt cannot prove them.
        backendResourcesAbsent,
        foreignResourcesPreserved,
        source,
        ...(connectorEvidence && !cleaned ? { recoverySource: connectorEvidence } : {}),
      };
    },
  };
}

async function writeFinalReceipt(
  result: T16BOwnedIosNativeEntrypointResult,
  args: T16OwnedExplorationArguments,
  command: OwnedMcpCommand,
  scope: T16OperationScope,
): Promise<T16OwnedExplorationFinalReceipt> {
  await scope.wait('final MCP command verification', () =>
    verifyOwnedMcpCommand(command, scope.signal, scope.deadlineAtMonotonicMs),
  );
  scope.check('terminal receipt preparation');
  const terminal = result.connection.t16BTerminal as JsonObject | null;
  const receipt: T16OwnedExplorationFinalReceipt = {
    schema: 't16-owned-exploration-terminal-v1',
    route: T16B_QA_EXPLORE_ROUTE,
    charterId: args.charterId,
    requestedRunId: args.runId,
    requestedAttemptId: args.attemptId,
    status:
      terminal?.status === 'observed'
        ? 'observed'
        : terminal?.status === 'not-requested'
          ? 'not-run'
          : 'blocked',
    publicPublicationEligible: false,
    nativePassingCases: 0,
    terminal,
    sourceCommandPath: command.path,
    sourceCommandBytes: command.commandBytes,
    sourceCommandHash: command.commandSha256,
    sourceCommandIdentity: command.sourceIdentity,
  };
  const artifactRoot = result.connection.artifactRoot;
  const output = path.join(artifactRoot, 't16-owned-terminal.private.json');
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2), 'utf8');
  await scope.wait('terminal receipt write', () =>
    writeFile(output, bytes, { flag: 'wx', mode: 0o600 }),
  );
  await scope.wait('terminal receipt mode', () => chmod(output, 0o600));
  scope.check('terminal receipt readback');
  const observed = readNativeEvidenceObservation(
    artifactRoot,
    't16-owned-terminal.private.json',
    true,
  );
  assert(observed.bytes.equals(bytes), 'T16 terminal receipt readback changed');
  scope.check('terminal receipt completion');
  return receipt;
}

export async function runT16OwnedExploration(input: {
  readonly repositoryRoot: string;
  readonly args: T16OwnedExplorationArguments;
  readonly signal?: AbortSignal;
  readonly deadlineAtMonotonicMs?: number;
}): Promise<{
  readonly result: T16BOwnedIosNativeEntrypointResult;
  readonly terminalReceipt: T16OwnedExplorationFinalReceipt;
}> {
  const scope = createT16OperationScope(input.signal, input.deadlineAtMonotonicMs);
  try {
    const repositoryRoot = await scope.wait('repository-root validation', () =>
      requireCanonicalRepositoryRoot(input.repositoryRoot),
    );
    const charterRows = await scope.wait('charter loading', () =>
      loadExplorationCharters(repositoryRoot),
    );
    const row = charterRows.find((candidate) => candidate.id === input.args.charterId);
    assert(row !== undefined, 'T16 qa:explore charter is unavailable');
    const charter = charterForRoute(row);
    const command = await scope.wait('MCP command preparation', () =>
      requireOwnedMcpCommand(input.args, scope.signal, scope.deadlineAtMonotonicMs),
    );
    scope.check('cold-reset binding preparation');
    const binding = parseResetBinding(input.args.coldResetBinding, input.args);
    const reset = await scope.wait('cold-reset receipt validation', () =>
      validateT16ColdResetBindingOnDisk(binding, repositoryRoot),
    );
    let context: IosConnectionRuntimeContext | null = null;
    const remainingMs = Math.max(1, scope.deadlineAtMonotonicMs - monotonicNowMs());
    const result = await scope.wait('owned iOS and T16 execution', () =>
      runOwnedT16BFromOwnedIosNativeSession({
        repositoryRoot,
        charter,
        requestedRunId: input.args.runId,
        coldReset: reset.expectation,
        locale: input.args.locale,
        signal: scope.signal,
        maxDurationMs: remainingMs,
        deadlineAtMonotonicMs: scope.deadlineAtMonotonicMs,
        deadlines: nativeDeadlinesForRemaining(remainingMs),
        ...(input.args.reuseBuildRunId
          ? {
              reuseBuildRunId: input.args.reuseBuildRunId,
              reuseBuildSourceRoot: input.args.reuseBuildSourceRoot,
            }
          : {}),
        launch: {
          argv: command.argv,
          cwd: repositoryRoot,
          socketInspector: inspectOwnedT16McpSockets,
          beforeSpawn: ({ signal, deadlineAtMonotonicMs }) =>
            verifyOwnedMcpCommand(command, signal, deadlineAtMonotonicMs),
        },
        qualificationAction: qualificationAction(charter),
        chooser: createT16Chooser(),
        cleanup: createT16CleanupAudit(
          () => context,
          input.args.runId,
          input.args.attemptId,
          input.args.locale,
        ),
        onT16Context: (value) => {
          assert(context === null, 'T16 context was published more than once');
          context = value;
        },
      }),
    );
    const terminalReceipt = await writeFinalReceipt(result, input.args, command, scope);
    return { result, terminalReceipt };
  } finally {
    scope.dispose();
  }
}

function repositoryRootFromModule(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const controller = new AbortController();
  const deadlineAtMonotonicMs = monotonicNowMs() + T16_OWNER_DEADLINE_MS;
  const onSignal = (signal: NodeJS.Signals) => controller.abort(signal);
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  const timer = setNodeTimeout(
    () => controller.abort(new Error('T16 owner deadline reached')),
    T16_OWNER_DEADLINE_MS,
  );
  unrefTimer(timer);
  try {
    const args = parseT16OwnedExplorationArguments(argv);
    const binding = parseResetBinding(args.coldResetBinding, args);
    assert(binding, 'T16 cold-reset binding is unavailable');
    const run = await runT16OwnedExploration({
      repositoryRoot: repositoryRootFromModule(),
      args,
      signal: controller.signal,
      deadlineAtMonotonicMs,
    });
    return run.terminalReceipt.status === 'observed' ? 0 : 2;
  } finally {
    clearNodeTimeout(timer);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 2;
    },
  );
}

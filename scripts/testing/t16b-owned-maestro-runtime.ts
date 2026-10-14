import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  OwnedMaestroMcpStdioSession,
  type LaunchOptions,
  type MonotonicClock,
  type OwnedProcessController,
  type RuntimeSpoolWorkerFactory,
  type SocketInspector,
} from './owned-maestro-mcp-stdio';
import {
  createT16BPrivateEvidenceWriter,
  requirePreparedCharter,
  type BoundedAction,
  type OwnedCleanupAudit,
  type PrivateEvidenceWriter,
  type PreparedExplorationCharter,
  type SelectionExpectation,
  type T16BChooser,
  type T16BExecutionResult,
  type T16BSelectionReaders,
  type T16BCleanup,
} from './t16b-owned-exploration-controller';
import {
  executeOwnedMaestroT16B,
  type MaestroTextResolver,
} from './t16b-owned-maestro-mcp-connector';

/**
 * This is a caller seam, not a qualification receipt. It composes the
 * existing owned controller, MCP connector and stdio session only after the
 * caller supplies fresh target/build/role/fixture/API/SQL/ownership receipts.
 */
export const T16B_OWNED_RUNTIME_CALLER_SCHEMA = 't16-b-owned-maestro-runtime-caller-v1';
export const T16B_RUNTIME_MAX_DURATION_MS = 30 * 60 * 1000;
export const T16B_RUNTIME_MAX_PROTOCOL_DEADLINE_MS = 60_000;

type SafeText = string;

export type T16BOwnedTargetBinding = {
  readonly deviceId: SafeText;
  readonly targetId: SafeText;
  readonly platform: SelectionExpectation['platform'];
  readonly selector: SafeText;
  readonly appIdOrOrigin: SafeText;
  readonly apiOrigin: SafeText;
  readonly buildId: SafeText;
  readonly binarySha256: string;
};

export type T16BOwnedMcpLaunch = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly socketInspector: SocketInspector;
  readonly processController?: OwnedProcessController;
  readonly env?: Readonly<Record<string, string>>;
  readonly runtimeSpoolWorkerFactory?: RuntimeSpoolWorkerFactory;
  readonly beforeSpawn?: LaunchOptions['beforeSpawn'];
};

export type T16BOwnedRuntimeInput = {
  readonly repositoryRoot: string;
  readonly charter: PreparedExplorationCharter;
  readonly expectation: SelectionExpectation;
  /** Fresh device and app binding from the owner; never a historical target id. */
  readonly target: T16BOwnedTargetBinding;
  /** Ten original descriptor-backed selection readers plus post-action API/SQL. */
  readonly selection: T16BSelectionReaders;
  readonly launch: T16BOwnedMcpLaunch;
  /** Chooser output is validated by the existing controller before execution. */
  readonly chooser: T16BChooser;
  readonly qualificationAction: BoundedAction;
  readonly cleanup: T16BCleanup;
  readonly resolveTextRef?: MaestroTextResolver;
  readonly protocolDeadlineMs?: number;
  readonly maxDurationMs?: number;
  /** Absolute owner deadline inherited from the outer native runner. */
  readonly deadlineAtMonotonicMs?: number;
  readonly cleanupTimeoutMs?: number;
  readonly now?: MonotonicClock;
  readonly signal?: AbortSignal;
};

export type T16BOwnedRuntimeResult = {
  readonly schema: typeof T16B_OWNED_RUNTIME_CALLER_SCHEMA;
  readonly status: T16BExecutionResult['status'];
  readonly qualification: 'pending';
  readonly runtimePassingCases: 0;
  readonly publicationEligible: false;
  readonly target: T16BOwnedTargetBinding;
  readonly execution: T16BExecutionResult;
  /** The stdio receipt remains in the private controller evidence tree. */
  readonly sessionId: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:/@+?&=%,-]{0,511}$/;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireText(value: unknown, label: string): string {
  assert(typeof value === 'string' && SAFE_TEXT.test(value), `${label} is invalid`);
  return value;
}

function requirePathString(value: unknown, label: string): string {
  assert(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 4096 &&
      !/[\u0000\r\n]/.test(value),
    `${label} is invalid`,
  );
  return value;
}

function requireHash(value: unknown, label: string): string {
  assert(typeof value === 'string' && SHA256.test(value), `${label} is not a SHA-256 hash`);
  return value;
}

async function requireCanonicalDirectory(value: string, label: string): Promise<string> {
  requirePathString(value, label);
  assert(path.isAbsolute(value), `${label} must be absolute`);
  const resolved = path.resolve(value);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a regular directory`);
  const canonical = await realpath(resolved);
  assert(canonical === resolved, `${label} is not canonical`);
  return canonical;
}

function requireSelectionReaders(selection: T16BSelectionReaders): void {
  const names: readonly (keyof T16BSelectionReaders)[] = [
    'readTarget',
    'readBuild',
    'readTool',
    'readLocale',
    'readRoles',
    'readFixture',
    'readReset',
    'readAuthApi',
    'readSql',
    'readOwnership',
    'readPostActionEvidence',
  ];
  for (const name of names)
    assert(typeof selection[name] === 'function', `T16-B selection reader is missing: ${name}`);
}

function requireTargetBinding(
  target: T16BOwnedTargetBinding,
  expected: SelectionExpectation,
): void {
  requireText(target.deviceId, 'target.deviceId');
  requireText(target.targetId, 'target.targetId');
  requireText(target.selector, 'target.selector');
  requireText(target.appIdOrOrigin, 'target.appIdOrOrigin');
  requireText(target.apiOrigin, 'target.apiOrigin');
  requireText(target.buildId, 'target.buildId');
  requireHash(target.binarySha256, 'target.binarySha256');
  assert(target.deviceId === target.targetId, 'deviceId must be the selected target identity');
  assert(target.targetId === expected.targetId, 'owned target differs from selection expectation');
  assert(target.platform === expected.platform, 'owned target platform differs from expectation');
  assert(target.selector === expected.selector, 'owned target selector differs from expectation');
  assert(
    target.appIdOrOrigin === expected.appIdOrOrigin,
    'owned target app/origin differs from expectation',
  );
  assert(target.apiOrigin === expected.apiOrigin, 'owned API origin differs from expectation');
  assert(target.buildId === expected.buildId, 'owned build differs from expectation');
  assert(
    target.binarySha256 === expected.binarySha256,
    'owned binary hash differs from expectation',
  );
}

function requireLaunch(launch: T16BOwnedMcpLaunch): void {
  assert(Array.isArray(launch.argv) && launch.argv.length >= 2, 'MCP launch argv is incomplete');
  for (const [index, argument] of launch.argv.entries())
    assert(
      typeof argument === 'string' && argument.length > 0 && !/[\u0000\r\n]/.test(argument),
      `MCP launch argv[${index}] is invalid`,
    );
  requirePathString(launch.cwd, 'MCP launch cwd');
  assert(typeof launch.socketInspector === 'function', 'MCP socket inspector is missing');
}

function requireDeadline(value: number | undefined, label: string, maximum: number): number {
  const resolved = value ?? maximum;
  assert(
    Number.isSafeInteger(resolved) && resolved > 0 && resolved <= maximum,
    `${label} is invalid`,
  );
  return resolved;
}

export async function validateT16BOwnedRuntimeInput(input: T16BOwnedRuntimeInput): Promise<{
  repositoryRoot: string;
  cwd: string;
  artifactRoot: string;
  maxDurationMs: number;
  protocolDeadlineMs: number;
  deadlineAtMonotonicMs?: number;
}> {
  const repositoryRoot = await requireCanonicalDirectory(input.repositoryRoot, 'repositoryRoot');
  const cwd = await requireCanonicalDirectory(input.launch.cwd, 'MCP launch cwd');
  assert(cwd === repositoryRoot, 'MCP launch cwd must be the selected repository root');
  requireLaunch(input.launch);
  requirePreparedCharter(input.charter);
  assert(
    input.expectation.platform === 'ios' || input.expectation.platform === 'android',
    'Maestro T16-B caller requires an iOS or Android selection',
  );
  assert(
    input.expectation.connector.kind === 'maestro',
    'Maestro T16-B caller requires a Maestro selection',
  );
  assert(
    input.charter.platforms.includes(input.expectation.platform) &&
      input.charter.locales.includes(input.expectation.locale) &&
      input.charter.connectorsByPlatform[input.expectation.platform] === 'maestro',
    'Charter does not support the selected Maestro target',
  );
  requireTargetBinding(input.target, input.expectation);
  requireSelectionReaders(input.selection);
  assert(typeof input.chooser === 'function', 'T16-B chooser is missing');
  assert(typeof input.cleanup?.audit === 'function', 'T16-B cleanup audit is missing');
  assert(
    input.qualificationAction && typeof input.qualificationAction === 'object',
    'T16-B qualification action is missing',
  );
  input.signal?.throwIfAborted();
  const maxDurationMs = requireDeadline(
    input.maxDurationMs,
    'T16-B owner deadline',
    T16B_RUNTIME_MAX_DURATION_MS,
  );
  const protocolDeadlineMs = requireDeadline(
    input.protocolDeadlineMs,
    'MCP protocol deadline',
    T16B_RUNTIME_MAX_PROTOCOL_DEADLINE_MS,
  );
  if (input.deadlineAtMonotonicMs !== undefined) {
    assert(
      Number.isSafeInteger(input.deadlineAtMonotonicMs) && input.deadlineAtMonotonicMs > 0,
      'T16-B absolute owner deadline is invalid',
    );
  }
  const artifactRoot = path.isAbsolute(input.expectation.artifactRoot)
    ? path.resolve(input.expectation.artifactRoot)
    : path.resolve(repositoryRoot, input.expectation.artifactRoot);
  assert(
    artifactRoot.startsWith(path.join(repositoryRoot, '.qa', 'artifacts') + path.sep),
    'T16-B artifact root must be below the repository .qa/artifacts boundary',
  );
  return {
    repositoryRoot,
    cwd,
    artifactRoot,
    maxDurationMs,
    protocolDeadlineMs,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
  };
}

export async function runOwnedT16BMaestroExploration(
  input: T16BOwnedRuntimeInput,
): Promise<T16BOwnedRuntimeResult> {
  const validated = await validateT16BOwnedRuntimeInput(input);
  const writer: PrivateEvidenceWriter = await createT16BPrivateEvidenceWriter({
    repositoryRoot: validated.repositoryRoot,
    artifactRoot: validated.artifactRoot,
    requestedAttemptId: input.expectation.requestedAttemptId,
  });
  let session: OwnedMaestroMcpStdioSession | null = null;
  try {
    session = new OwnedMaestroMcpStdioSession({
      argv: [...input.launch.argv],
      cwd: validated.cwd,
      artifactRoot: validated.artifactRoot,
      repositoryRoot: validated.repositoryRoot,
      processController: input.launch.processController,
      socketInspector: input.launch.socketInspector,
      runtimeSpoolWorkerFactory: input.launch.runtimeSpoolWorkerFactory,
      beforeSpawn: input.launch.beforeSpawn,
      env: input.launch.env,
      now: input.now,
      protocolDeadlineMs: validated.protocolDeadlineMs,
      ownerDeadlineMs: validated.maxDurationMs,
      ownerDeadlineAtMonotonicMs: validated.deadlineAtMonotonicMs,
    } satisfies LaunchOptions);
    const execution = await executeOwnedMaestroT16B({
      repositoryRoot: validated.repositoryRoot,
      charter: input.charter,
      expectation: input.expectation,
      selection: input.selection,
      session,
      chooser: input.chooser,
      qualificationAction: input.qualificationAction,
      writer,
      cleanup: input.cleanup,
      resolveTextRef: input.resolveTextRef,
      protocolDeadlineMs: validated.protocolDeadlineMs,
      maxDurationMs: validated.maxDurationMs,
      deadlineAtMonotonicMs: validated.deadlineAtMonotonicMs,
      cleanupTimeoutMs: input.cleanupTimeoutMs,
      now: input.now,
      signal: input.signal,
    });
    return {
      schema: T16B_OWNED_RUNTIME_CALLER_SCHEMA,
      status: execution.status,
      qualification: execution.qualification,
      runtimePassingCases: 0,
      publicationEligible: false,
      target: input.target,
      execution,
      sessionId: session.sessionId,
    };
  } catch (error) {
    await writer.close().catch(() => undefined);
    throw error;
  }
}

/** Type-only helper for callers that retain the cleanup result privately. */
export type T16BOwnedCleanupResult = OwnedCleanupAudit;

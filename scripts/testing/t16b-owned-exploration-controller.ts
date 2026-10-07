import { createHash } from 'node:crypto';
import { constants as fsConstants, renameSync } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ExplorationBudgetPolicy } from './exploration-budget-policy';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import {
  EXPLORATION_CONNECTORS,
  EXPLORATION_LOCALES,
  EXPLORATION_MAX_DURATION_MINUTES,
  EXPLORATION_MAX_UI_ACTIONS,
  EXPLORATION_PLATFORMS,
  EXPLORATION_UNCHANGED_FAILURE_LIMIT,
} from './prepare-exploration';

export const T16B_OWNED_EXECUTION_SCHEMA = 't16-b-owned-exploration-execution-v1';
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const CLEANUP_TIMEOUT_MS = 30_000;
export const ACTION_COMMANDS = [
  'tapOn',
  'assertVisible',
  'assertNotVisible',
  'scrollUntilVisible',
  'inputText',
  'pressKey',
  'back',
  'waitForAnimationToEnd',
  'click',
  'fill',
  'press',
  'goBack',
] as const;

type JsonRecord = Record<string, unknown>;
type Platform = (typeof EXPLORATION_PLATFORMS)[number];
type Locale = (typeof EXPLORATION_LOCALES)[number];
type ConnectorKind = (typeof EXPLORATION_CONNECTORS)[number];
type ActionCommand = (typeof ACTION_COMMANDS)[number];
type EvidenceKind =
  | 'target'
  | 'build'
  | 'tool'
  | 'locale'
  | 'roles'
  | 'fixture'
  | 'reset'
  | 'auth-api'
  | 'sql'
  | 'ownership'
  | 'target-selection'
  | 'screen'
  | 'action-request'
  | 'action-result'
  | 'action-api'
  | 'action-sql'
  | 'cleanup';

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SAFE_PATH = /^[^\u0000\r\n\\]+$/;
const SECRET_KEY =
  /(password|passcode|token|cookie|authorization|secret|private[_-]?key|api[_-]?key|id[_-]?token)/i;
const SECRET_VALUE =
  /(bearer\s|-----begin|access[_-]?token|refresh[_-]?token|(?:password|passcode|token|cookie|authorization|secret)\s*[:=]\s*\S+)/i;

export type PreparedExplorationCharter = {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  platforms: Platform[];
  connectorsByPlatform: Partial<Record<Platform, ConnectorKind>>;
  locales: Locale[];
  roles: string[];
  dataMode: 'fixture' | 'integration';
  fixture: { id: string; resetStrategy: string };
  allowedActions: string[];
  excludedExternalEffects: string[];
  budget: {
    maxDurationMinutes: 30;
    maxUiActions: 100;
    stopWhen: 'first-limit-reached';
    unchangedFailureLimit: 2;
  };
  artifactPolicy: {
    directoryMode: '0700';
    fileMode: '0600';
    rawEvidence: 'private-only';
    publicSummary: 'redacted-status-only';
    forbiddenFields: string[];
  };
  requirementRefs: string[];
  requirementPaths: string[];
  scenario: {
    id: string;
    title: string;
    sourceRefs: string[];
    preconditions: string[];
    actions: string[];
    expectedObservations: string[];
    risk: 'high' | 'medium' | 'low';
  };
};

export type SelectionExpectation = {
  requestedRunId: string;
  requestedAttemptId: string;
  platform: Platform;
  locale: Locale;
  targetId: string;
  selector: string;
  appIdOrOrigin: string;
  apiOrigin: string;
  buildId: string;
  binarySha256: string;
  connector: { kind: ConnectorKind; id: string; name: string; version: string };
  roleIds: string[];
  fixtureId: string;
  fixtureMode: 'fixture' | 'integration';
  fixtureScope: string;
  resetId: string;
  artifactRoot: string;
};

export type SelectionObservationProvenance = {
  selectionBindingSha256: string;
  selectionReceiptId: string;
  observerPid: number;
  observerUid: number;
  observerStartedAtMonotonicMs: number;
  selectionOrdinal: number;
};

export type OwnedTargetProcess = {
  pid: number;
  startedAtMonotonicMs: number;
  startSha256: string;
};

export type OriginalEvidence = {
  kind: EvidenceKind;
  runId: string;
  attemptId: string;
  platform: Platform;
  locale: Locale;
  path: string;
  bytes: Uint8Array;
  capturedAtMonotonicMs: number;
  identity: JsonRecord;
  source: OwnedEvidenceSource;
};

export type OwnedEvidenceSource = {
  artifactRoot: string;
  path: string;
  sha256: string;
  bytes: number;
  uid: number;
  mode: '0600';
  nlink: 1;
  regular: true;
  symlink: false;
};

export type EvidenceReference = {
  path: string;
  sha256: string;
  bytes: number;
  kind: EvidenceKind;
  /** Descriptor identity captured at selection/publication time. */
  identity: NativeEvidenceIdentity;
};

export type SelectionEvidenceBundle = {
  target: OriginalEvidence;
  build: OriginalEvidence;
  tool: OriginalEvidence;
  locale: OriginalEvidence;
  roles: OriginalEvidence;
  fixture: OriginalEvidence;
  reset: OriginalEvidence;
  authApi: OriginalEvidence;
  sql: OriginalEvidence;
  ownership: OriginalEvidence;
};

export type T16BSelectionReaders = {
  readTarget(signal: AbortSignal): Promise<OriginalEvidence>;
  readBuild(signal: AbortSignal): Promise<OriginalEvidence>;
  readTool(signal: AbortSignal): Promise<OriginalEvidence>;
  readLocale(signal: AbortSignal): Promise<OriginalEvidence>;
  readRoles(signal: AbortSignal): Promise<OriginalEvidence>;
  readFixture(signal: AbortSignal): Promise<OriginalEvidence>;
  readReset(signal: AbortSignal): Promise<OriginalEvidence>;
  readAuthApi(signal: AbortSignal): Promise<OriginalEvidence>;
  readSql(signal: AbortSignal): Promise<OriginalEvidence>;
  readOwnership(signal: AbortSignal): Promise<OriginalEvidence>;
  readPostActionEvidence(input: {
    ordinal: number;
    actionId: string;
    requestId: string;
    signal: AbortSignal;
  }): Promise<{ api: OriginalEvidence; sql: OriginalEvidence }>;
};

export type ConnectorIdentity = {
  kind: ConnectorKind;
  id: string;
  name: string;
  version: string;
  targetSelectionCapability: true;
  sessionId: string;
};

export type ConnectorStartReceipt = {
  kind: 'connector-start';
  runId: string;
  attemptId: string;
  capturedAtMonotonicMs: number;
  identity: ConnectorIdentity;
  source: OriginalEvidence;
};

export type ConnectorTargetSelection = {
  kind: 'target-selection';
  runId: string;
  attemptId: string;
  targetId: string;
  platform: Platform;
  appIdOrOrigin: string;
  binarySha256: string;
  capturedAtMonotonicMs: number;
  source: OriginalEvidence;
};

export type ScreenObservation = {
  kind: 'screen';
  runId: string;
  attemptId: string;
  targetId: string;
  capturedAtMonotonicMs: number;
  requestId: string;
  sourcePath: string;
  rawBytes: Uint8Array;
  source: OwnedEvidenceSource;
  stateSha256: string;
  identity: JsonRecord;
};

export type BoundedAction = {
  id: string;
  command: ActionCommand;
  selector?: { id?: string; text?: string };
  textRef?: string;
  key?: string;
  direction?: 'UP' | 'DOWN';
  waitMs?: number;
};

export type ConnectorActionResult = {
  kind: 'action-result';
  runId: string;
  attemptId: string;
  requestId: string;
  capturedAtMonotonicMs: number;
  status: 'passed' | 'failed' | 'blocked' | 'cancelled';
  requestedUiActionCount: 1;
  appliedUiActionCount: 0 | 1 | null;
  requestBytes: Uint8Array;
  resultBytes: Uint8Array;
  requestSource: OwnedEvidenceSource;
  resultSource: OwnedEvidenceSource;
  sourcePath: string;
  identity: JsonRecord;
};

export type ConnectorShutdownReceipt = {
  kind: 'connector-shutdown';
  runId: string;
  attemptId: string;
  status: 'closed' | 'failed' | 'unknown';
  capturedAtMonotonicMs: number;
  source?: OriginalEvidence;
  errorCode?: string;
};

export type T16BConnector = {
  identity: ConnectorIdentity;
  start(signal: AbortSignal): Promise<ConnectorStartReceipt>;
  selectTarget(input: {
    targetId: string;
    selector: string;
    appIdOrOrigin: string;
    binarySha256: string;
    signal: AbortSignal;
  }): Promise<ConnectorTargetSelection>;
  observe(input: { targetId: string; signal: AbortSignal }): Promise<ScreenObservation>;
  perform(input: {
    targetId: string;
    action: BoundedAction;
    ordinal: number;
    signal: AbortSignal;
  }): Promise<ConnectorActionResult>;
  close(
    signal: AbortSignal,
    options?: {
      readonly deadlineAtMonotonicMs: number;
      readonly recoveryDeadlineAtMonotonicMs: number;
      readonly ownerSignal: AbortSignal;
    },
  ): Promise<ConnectorShutdownReceipt>;
};

export type OwnedCleanupAudit = {
  kind: 'owned-exploration-cleanup';
  /** This audit covers only the T16-owned MCP namespace; outer app/backend cleanup is separate. */
  scope: 't16-owned-mcp-namespace-only';
  runId: string;
  attemptId: string;
  status: 'cleaned' | 'failed-recovery-retained' | 'unknown' | 'not-acquired';
  capturedAtMonotonicMs: number;
  ownedProcessGroupAbsent: boolean;
  socketResourcesAbsent: boolean;
  /**
   * The MCP audit never infers the outer iOS/backend result. The unproven
   * state is expected until the parent-owned external cleanup receipt is
   * bound by the outer terminal.
   */
  outerCleanupStatus: 'unproven' | 'verified' | 'failed';
  backendResourcesAbsent: boolean;
  foreignResourcesPreserved: boolean;
  source: OriginalEvidence;
  recoverySource?: OriginalEvidence;
};

export type T16BCleanup = {
  audit(input: {
    connectorStartAttempted: boolean;
    signal: AbortSignal;
  }): Promise<OwnedCleanupAudit>;
};

export type ActionEvidenceRefs = {
  before: EvidenceReference | null;
  request: EvidenceReference | null;
  result: EvidenceReference | null;
  after: EvidenceReference | null;
  api: EvidenceReference | null;
  sql: EvidenceReference | null;
};

export type ActionAttemptLedgerRow = {
  kind: 'action-attempt';
  ordinal: number;
  branchId: string;
  requestedAtMonotonicMs: number;
  previousObservationSha256: string | null;
  action: BoundedAction | null;
  result: {
    status: 'passed' | 'failed' | 'blocked' | 'cancelled';
    requestId: string | null;
    requestedUiActionCount: 0 | 1;
    appliedUiActionCount: 0 | 1 | null;
    completedAtMonotonicMs: number | null;
    error: string | null;
  };
  evidence: ActionEvidenceRefs;
  policySequence: number | null;
};

export type PrivateEvidenceWriter = {
  kind: 'owned-private-exploration-writer';
  artifactRoot: string;
  executionRoot: string;
  writeEvidence(
    label: string,
    evidence: OriginalEvidence | { kind: EvidenceKind; path: string; bytes: Uint8Array },
  ): Promise<EvidenceReference>;
  appendAttempt(
    row: ActionAttemptLedgerRow,
  ): Promise<{ ordinal: number; sha256: string; bytes: number }>;
  finalize(
    input: {
      receipt: JsonRecord;
      coverage: JsonRecord;
      exploration: string;
      bugs: string;
      docChanges: string;
    },
    signal?: AbortSignal,
  ): Promise<{ receipt: EvidenceReference; ledger: EvidenceReference }>;
  close(): Promise<void>;
  completePublication(signal?: AbortSignal): Promise<EvidenceReference>;
};

export type T16BChooser = (input: {
  observation: ScreenObservation;
  charter: PreparedExplorationCharter;
  history: readonly ActionAttemptLedgerRow[];
  signal: AbortSignal;
}) => Promise<unknown>;

export type T16BExecutionInput = {
  repositoryRoot: string;
  charter: PreparedExplorationCharter;
  expectation: SelectionExpectation;
  selection: T16BSelectionReaders;
  connector: T16BConnector;
  chooser: T16BChooser;
  qualificationAction: BoundedAction;
  writer: PrivateEvidenceWriter;
  cleanup: T16BCleanup;
  now?: () => number;
  maxDurationMs?: number;
  /** Absolute owner deadline inherited from the outer native runner. */
  deadlineAtMonotonicMs?: number;
  cleanupTimeoutMs?: number;
  signal?: AbortSignal;
};

export type T16BExecutionResult = {
  schema: typeof T16B_OWNED_EXECUTION_SCHEMA;
  status: 'explored' | 'failed' | 'blocked' | 'cancelled';
  explorationStatus: 'observed' | 'not-run';
  qualification: 'pending';
  runtimePassingCases: 0;
  requestedRunId: string;
  requestedAttemptId: string;
  actionAttempts: readonly ActionAttemptLedgerRow[];
  selectionEvidence: Readonly<Record<string, EvidenceReference>>;
  connector: ConnectorIdentity | null;
  cleanup: OwnedCleanupAudit | null;
  publicationEligible: false;
  recoveryNotVerified: boolean;
  inFlightOperations: number;
  finalEvidence: {
    receipt: EvidenceReference;
    ledger: EvidenceReference;
    marker: EvidenceReference;
  } | null;
  stopReason: string | null;
  reason: string | null;
  budget: { issuedActions: number; settledActions: number; inFlight: boolean };
  attemptCounts: {
    requested: number;
    started: number;
    passed: number;
    applicationFailed: number;
    blocked: number;
    cancelled: number;
    leaked: number;
  };
};

export type ActionExecutionSummary = {
  continueExploration: boolean;
  completedSuccessfully: boolean;
};

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function selectionBindingHash(expected: SelectionExpectation): string {
  return sha256(
    JSON.stringify({
      requestedRunId: expected.requestedRunId,
      requestedAttemptId: expected.requestedAttemptId,
      platform: expected.platform,
      locale: expected.locale,
      targetId: expected.targetId,
      selector: expected.selector,
      appIdOrOrigin: expected.appIdOrOrigin,
      apiOrigin: expected.apiOrigin,
      buildId: expected.buildId,
      binarySha256: expected.binarySha256,
      connector: expected.connector,
      roleIds: expected.roleIds,
      fixtureId: expected.fixtureId,
      fixtureMode: expected.fixtureMode,
      fixtureScope: expected.fixtureScope,
      resetId: expected.resetId,
      artifactRoot: expected.artifactRoot,
    }),
  );
}

function requireBytes(value: unknown, label: string): Uint8Array {
  assert(
    value instanceof Uint8Array && value.byteLength > 0,
    label + ' must contain non-empty bytes',
  );
  assert(value.byteLength <= MAX_EVIDENCE_BYTES, label + ' exceeds the bounded evidence size');
  return value;
}

function currentUid(): number {
  assert(typeof process.getuid === 'function', 'Owned evidence requires a process owner identity');
  return process.getuid();
}

function sourceStatIdentity(stat: {
  dev: number;
  ino: number;
  uid: number;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
}): string {
  return [
    stat.dev,
    stat.ino,
    stat.uid,
    stat.mode & 0o777,
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
    stat.nlink,
  ].join(':');
}

async function readOwnedEvidenceSource(
  source: OwnedEvidenceSource,
  expectedArtifactRoot: string,
  label: string,
): Promise<Uint8Array> {
  assert(isRecord(source), label + '.source is malformed');
  assert(path.isAbsolute(source.artifactRoot), label + '.source.artifactRoot must be absolute');
  assert(
    path.resolve(source.artifactRoot) === expectedArtifactRoot,
    label + '.source root differs',
  );
  safeRelativePath(source.path, label + '.source.path');
  assert(SHA256.test(source.sha256), label + '.source.sha256 is invalid');
  assert(
    Number.isSafeInteger(source.bytes) && source.bytes > 0 && source.bytes <= MAX_EVIDENCE_BYTES,
    label + '.source.bytes is invalid',
  );
  assert(
    source.mode === '0600' &&
      source.nlink === 1 &&
      source.regular === true &&
      source.symlink === false,
    label + '.source file policy is invalid',
  );
  assert(source.uid === currentUid(), label + '.source uid differs');
  await requirePrivateDirectory(expectedArtifactRoot, label + '.source root');
  const file = path.resolve(expectedArtifactRoot, source.path);
  assert(isUnder(expectedArtifactRoot, file), label + '.source path escapes its root');
  const before = await lstat(file);
  assert(before.isFile() && !before.isSymbolicLink(), label + '.source is not a regular file');
  assert(
    (before.mode & 0o777) === 0o600 &&
      before.uid === currentUid() &&
      before.nlink === 1 &&
      before.size === source.bytes,
    label + '.source ownership/mode/size differs',
  );
  if (typeof fsConstants.O_NOFOLLOW !== 'number')
    throw new Error(label + '.source no-follow is unavailable');
  const descriptor = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = await descriptor.stat();
    assert(
      descriptorBefore.isFile() &&
        sourceStatIdentity(before) === sourceStatIdentity(descriptorBefore),
      label + '.source changed before read',
    );
    const bytes = Buffer.allocUnsafe(descriptorBefore.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await descriptor.read(
        bytes,
        offset,
        Math.min(64 * 1024, bytes.length - offset),
        null,
      );
      if (result.bytesRead <= 0) throw new Error(label + '.source truncated during read');
      offset += result.bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    const extraRead = await descriptor.read(extra, 0, 1, null);
    assert(extraRead.bytesRead === 0, label + '.source grew during read');
    const descriptorAfter = await descriptor.stat();
    const after = await lstat(file);
    assert(
      sourceStatIdentity(descriptorBefore) === sourceStatIdentity(descriptorAfter) &&
        sourceStatIdentity(descriptorBefore) === sourceStatIdentity(after),
      label + '.source changed during read',
    );
    assert((await realpath(file)) === file, label + '.source path became a symlink');
    assert(sha256(bytes) === source.sha256, label + '.source hash differs');
    return bytes;
  } finally {
    await descriptor.close();
  }
}

function safeText(value: unknown, label: string, max = 512): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.length <= max,
    label + ' is invalid',
  );
  assert(!/[\u0000\r\n]/.test(value), label + ' contains a control character');
  assert(!SECRET_VALUE.test(value), label + ' contains a secret-like value');
  return value;
}

function safeOrigin(value: unknown, label: string): string {
  const origin = safeText(value, label, 512);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(label + ' is not a valid URL origin');
  }
  assert(
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === origin &&
      parsed.username === '' &&
      parsed.password === '',
    label + ' must be an origin without credentials or a path',
  );
  return origin;
}

function safeId(value: unknown, label: string): string {
  const result = safeText(value, label, 160);
  assert(SAFE_ID.test(result), label + ' is not a stable identifier');
  return result;
}

function safeRelativePath(value: unknown, label: string): string {
  const result = safeText(value, label, 1024);
  assert(SAFE_PATH.test(result), label + ' contains an unsafe path');
  assert(!path.isAbsolute(result) && !/^[A-Za-z]:/.test(result), label + ' must be relative');
  const parts = result.split('/');
  assert(!parts.includes('..') && !parts.includes('.'), label + ' escapes its source root');
  return result;
}

function assertNoSecrets(value: unknown, label = 'value', depth = 0): void {
  assert(depth <= 8, label + ' is too deeply nested');
  if (typeof value === 'string') {
    assert(value.length <= 4096, label + ' is unbounded');
    assert(!SECRET_VALUE.test(value), label + ' contains a secret-like value');
    return;
  }
  if (Array.isArray(value)) {
    assert(value.length <= 200, label + ' has too many entries');
    value.forEach((entry, index) => assertNoSecrets(entry, label + '[' + index + ']', depth + 1));
    return;
  }
  if (isRecord(value)) {
    assert(Object.keys(value).length <= 200, label + ' has too many fields');
    for (const [key, entry] of Object.entries(value)) {
      assert(!SECRET_KEY.test(key), label + '.' + key + ' is forbidden');
      assertNoSecrets(entry, label + '.' + key, depth + 1);
    }
  }
}

function exactKeys(value: JsonRecord, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value))
    assert(allowedSet.has(key), label + ' contains unknown field ' + key);
}

function monotonic(value: unknown, label: string): number {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, label + ' is invalid');
  return value;
}

function arrayEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function strings(value: unknown, label: string): string[] {
  assert(Array.isArray(value) && value.length > 0, label + ' must be non-empty');
  const result = value.map((entry, index) => safeId(entry, label + '[' + index + ']'));
  assert(new Set(result).size === result.length, label + ' contains duplicates');
  return result;
}

function textList(value: unknown, label: string, max = 2000): string[] {
  assert(Array.isArray(value) && value.length > 0, label + ' must be non-empty');
  const result = value.map((entry, index) => safeText(entry, label + '[' + index + ']', max));
  assert(new Set(result).size === result.length, label + ' contains duplicates');
  return result;
}

export function requirePreparedCharter(value: unknown): PreparedExplorationCharter {
  assert(isRecord(value), 'Prepared charter is malformed');
  exactKeys(
    value,
    [
      'schemaVersion',
      'id',
      'title',
      'summary',
      'platforms',
      'connectorsByPlatform',
      'locales',
      'roles',
      'dataMode',
      'fixture',
      'allowedActions',
      'excludedExternalEffects',
      'budget',
      'artifactPolicy',
      'requirementRefs',
      'requirementPaths',
      'scenario',
    ],
    'Prepared charter',
  );
  assert(value.schemaVersion === 1, 'Prepared charter schema is unsupported');
  const id = safeId(value.id, 'Charter id');
  assert(/^EXP-[A-Z0-9-]+$/.test(id), 'Charter id must use the EXP- format');
  const platforms = strings(value.platforms, 'Charter platforms') as Platform[];
  platforms.forEach((platform) =>
    assert(EXPLORATION_PLATFORMS.includes(platform), 'Unsupported charter platform'),
  );
  const locales = strings(value.locales, 'Charter locales') as Locale[];
  EXPLORATION_LOCALES.forEach((locale) =>
    assert(locales.includes(locale), 'Charter omits a locale'),
  );
  assert(isRecord(value.connectorsByPlatform), 'Charter connector map is malformed');
  const connectorMap = value.connectorsByPlatform;
  exactKeys(connectorMap, platforms, 'Charter connector map');
  const connectorsByPlatform: Partial<Record<Platform, ConnectorKind>> = {};
  platforms.forEach((platform) => {
    const connector = connectorMap[platform];
    assert(
      EXPLORATION_CONNECTORS.includes(connector as ConnectorKind),
      'Charter connector is missing',
    );
    connectorsByPlatform[platform] = connector as ConnectorKind;
  });
  const roles = strings(value.roles, 'Charter roles');
  assert(
    value.dataMode === 'fixture' || value.dataMode === 'integration',
    'Charter data mode is invalid',
  );
  assert(isRecord(value.fixture), 'Charter fixture is malformed');
  exactKeys(value.fixture, ['id', 'resetStrategy'], 'Charter fixture');
  const fixture = {
    id: safeId(value.fixture.id, 'Charter fixture id'),
    resetStrategy: safeText(value.fixture.resetStrategy, 'Charter reset strategy'),
  };
  const allowedActions = textList(value.allowedActions, 'Charter allowed actions');
  const excludedExternalEffects = textList(
    value.excludedExternalEffects,
    'Charter excluded effects',
  );
  assert(isRecord(value.budget), 'Charter budget is malformed');
  exactKeys(
    value.budget,
    ['maxDurationMinutes', 'maxUiActions', 'stopWhen', 'unchangedFailureLimit'],
    'Charter budget',
  );
  assert(value.budget.maxDurationMinutes === EXPLORATION_MAX_DURATION_MINUTES);
  assert(value.budget.maxUiActions === EXPLORATION_MAX_UI_ACTIONS);
  assert(value.budget.stopWhen === 'first-limit-reached');
  assert(value.budget.unchangedFailureLimit === EXPLORATION_UNCHANGED_FAILURE_LIMIT);
  assert(isRecord(value.artifactPolicy), 'Charter artifact policy is malformed');
  exactKeys(
    value.artifactPolicy,
    ['directoryMode', 'fileMode', 'rawEvidence', 'publicSummary', 'forbiddenFields'],
    'Charter artifact policy',
  );
  assert(value.artifactPolicy.directoryMode === '0700' && value.artifactPolicy.fileMode === '0600');
  assert(
    value.artifactPolicy.rawEvidence === 'private-only' &&
      value.artifactPolicy.publicSummary === 'redacted-status-only',
  );
  assert(
    Array.isArray(value.artifactPolicy.forbiddenFields) &&
      value.artifactPolicy.forbiddenFields.length > 0,
  );
  const declaredForbiddenFields = value.artifactPolicy.forbiddenFields.map((entry, index) => {
    assert(
      typeof entry === 'string' && SAFE_LABEL.test(entry),
      `Charter forbidden field[${index}] is invalid`,
    );
    return entry;
  });
  assert(Array.isArray(value.requirementRefs) && value.requirementRefs.length > 0);
  assert(Array.isArray(value.requirementPaths) && value.requirementPaths.length > 0);
  assert(isRecord(value.scenario), 'Charter scenario is malformed');
  exactKeys(
    value.scenario,
    ['id', 'title', 'sourceRefs', 'preconditions', 'actions', 'expectedObservations', 'risk'],
    'Charter scenario',
  );
  const risk = value.scenario.risk;
  assert(risk === 'high' || risk === 'medium' || risk === 'low', 'Scenario risk is invalid');
  const scenario: PreparedExplorationCharter['scenario'] = {
    id: safeId(value.scenario.id, 'Scenario id'),
    title: safeText(value.scenario.title, 'Scenario title'),
    sourceRefs: textList(value.scenario.sourceRefs, 'Scenario source refs'),
    preconditions: textList(value.scenario.preconditions, 'Scenario preconditions'),
    actions: textList(value.scenario.actions, 'Scenario actions'),
    expectedObservations: textList(
      value.scenario.expectedObservations,
      'Scenario expected observations',
    ),
    risk: risk,
  };
  // The forbidden-field list is policy metadata. Its names intentionally include
  // terms such as `accessToken` and `password`; scan the rest of the charter for
  // secret-like values while preserving those declared labels verbatim.
  assertNoSecrets({
    ...value,
    artifactPolicy: {
      ...value.artifactPolicy,
      forbiddenFields: declaredForbiddenFields.map(() => 'declared-policy-field'),
    },
  });
  return {
    schemaVersion: 1,
    id,
    title: safeText(value.title, 'Charter title'),
    summary: safeText(value.summary, 'Charter summary'),
    platforms,
    connectorsByPlatform,
    locales,
    roles,
    dataMode: value.dataMode,
    fixture,
    allowedActions,
    excludedExternalEffects,
    budget: {
      maxDurationMinutes: 30,
      maxUiActions: 100,
      stopWhen: 'first-limit-reached',
      unchangedFailureLimit: 2,
    },
    artifactPolicy: {
      directoryMode: '0700',
      fileMode: '0600',
      rawEvidence: 'private-only',
      publicSummary: 'redacted-status-only',
      forbiddenFields: declaredForbiddenFields,
    },
    requirementRefs: textList(value.requirementRefs, 'Charter requirement refs'),
    requirementPaths: textList(value.requirementPaths, 'Charter requirement paths'),
    scenario,
  };
}

function requireCommonEvidence(
  evidence: OriginalEvidence,
  kind: EvidenceKind,
  expected: SelectionExpectation,
  label: string,
  expectedArtifactRoot?: string,
): OriginalEvidence {
  assert(isRecord(evidence), label + ' is malformed');
  assert(evidence.kind === kind, label + ' kind differs');
  assert(
    evidence.runId === expected.requestedRunId &&
      evidence.attemptId === expected.requestedAttemptId,
    label + ' run identity differs',
  );
  assert(
    evidence.platform === expected.platform && evidence.locale === expected.locale,
    label + ' platform/locale differs',
  );
  safeRelativePath(evidence.path, label + '.path');
  requireBytes(evidence.bytes, label + '.bytes');
  assert(isRecord(evidence.source), label + '.source is missing');
  assertNoSecrets(evidence.source, label + '.source');
  assert(evidence.source.path === evidence.path, label + '.source path differs');
  if (expectedArtifactRoot)
    assert(
      path.resolve(evidence.source.artifactRoot) === expectedArtifactRoot,
      label + '.source root differs',
    );
  monotonic(evidence.capturedAtMonotonicMs, label + '.capturedAtMonotonicMs');
  assert(isRecord(evidence.identity), label + '.identity is missing');
  assertNoSecrets(evidence.identity, label + '.identity');
  return evidence;
}

async function verifyCommonEvidenceSource(
  evidence: OriginalEvidence,
  label: string,
  expectedArtifactRoot: string,
): Promise<void> {
  const bytes = await readOwnedEvidenceSource(evidence.source, expectedArtifactRoot, label);
  assert(
    Buffer.from(bytes).equals(Buffer.from(evidence.bytes)),
    label + ' bytes differ from source',
  );
  assert(evidence.source.bytes === evidence.bytes.byteLength, label + '.source byte count differs');
}

function exact(identity: JsonRecord, key: string, expected: unknown, label: string): void {
  assert(identity[key] === expected, label + '.' + key + ' differs');
}

function requireSelectionIdentityBinding(
  identity: JsonRecord,
  evidence: OriginalEvidence,
  expected: SelectionExpectation,
  label: string,
  expectedOrdinal: number,
): SelectionObservationProvenance {
  assert(isRecord(identity.selectionProvenance), label + '.selectionProvenance is missing');
  const provenance = identity.selectionProvenance;
  exactKeys(
    provenance,
    [
      'selectionBindingSha256',
      'selectionReceiptId',
      'observerPid',
      'observerUid',
      'observerStartedAtMonotonicMs',
      'selectionOrdinal',
    ],
    label + '.selectionProvenance',
  );
  assert(
    provenance.selectionBindingSha256 === selectionBindingHash(expected),
    label + '.selectionProvenance binding differs',
  );
  const selectionReceiptId = safeId(
    provenance.selectionReceiptId,
    label + '.selectionProvenance.selectionReceiptId',
  );
  assert(
    typeof provenance.observerPid === 'number' &&
      Number.isSafeInteger(provenance.observerPid) &&
      provenance.observerPid > 0,
    label + '.selectionProvenance.observerPid is invalid',
  );
  assert(
    provenance.observerUid === currentUid(),
    label + '.selectionProvenance.observerUid differs',
  );
  const observerStartedAtMonotonicMs = monotonic(
    provenance.observerStartedAtMonotonicMs,
    label + '.selectionProvenance.observerStartedAtMonotonicMs',
  );
  assert(
    provenance.selectionOrdinal === expectedOrdinal,
    label + '.selectionProvenance.selectionOrdinal differs',
  );
  assert(
    evidence.capturedAtMonotonicMs === identity.capturedAtMonotonicMs,
    label + '.identity timestamp is not bound to its evidence timestamp',
  );
  return {
    selectionBindingSha256: provenance.selectionBindingSha256,
    selectionReceiptId,
    observerPid: provenance.observerPid,
    observerUid: provenance.observerUid,
    observerStartedAtMonotonicMs,
    selectionOrdinal: expectedOrdinal,
  };
}

function requireOwnedTargetProcess(value: unknown, label: string): OwnedTargetProcess {
  assert(isRecord(value), label + ' is missing');
  exactKeys(value, ['pid', 'startedAtMonotonicMs', 'startSha256'], label);
  assert(
    typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0,
    label + '.pid is invalid',
  );
  const startedAtMonotonicMs = monotonic(
    value.startedAtMonotonicMs,
    label + '.startedAtMonotonicMs',
  );
  assert(SHA256.test(String(value.startSha256)), label + '.startSha256 is invalid');
  return {
    pid: value.pid,
    startedAtMonotonicMs,
    startSha256: value.startSha256 as string,
  };
}

export function requireSelectionBundle(
  bundle: SelectionEvidenceBundle,
  expected: SelectionExpectation,
  expectedArtifactRoot: string,
): SelectionEvidenceBundle {
  assert(path.isAbsolute(expectedArtifactRoot), 'Selection artifact root must be absolute');
  const rows: [EvidenceKind, OriginalEvidence, string][] = [
    ['target', bundle.target, 'target'],
    ['build', bundle.build, 'build'],
    ['tool', bundle.tool, 'tool'],
    ['locale', bundle.locale, 'locale'],
    ['roles', bundle.roles, 'roles'],
    ['fixture', bundle.fixture, 'fixture'],
    ['reset', bundle.reset, 'reset'],
    ['auth-api', bundle.authApi, 'authApi'],
    ['sql', bundle.sql, 'sql'],
    ['ownership', bundle.ownership, 'ownership'],
  ];
  let sharedProvenance: SelectionObservationProvenance | null = null;
  const sourcePaths = new Set<string>();
  rows.forEach(([kind, evidence, label], index) => {
    requireCommonEvidence(evidence, kind, expected, label, expectedArtifactRoot);
    assert(!sourcePaths.has(evidence.path), label + ' reuses another selection source path');
    sourcePaths.add(evidence.path);
    const provenance = requireSelectionIdentityBinding(
      evidence.identity,
      evidence,
      expected,
      label,
      index + 1,
    );
    if (!sharedProvenance) sharedProvenance = provenance;
    else {
      assert(
        JSON.stringify({ ...provenance, selectionOrdinal: 0 }) ===
          JSON.stringify({ ...sharedProvenance, selectionOrdinal: 0 }),
        label + '.selectionProvenance is not shared with the selection receipt',
      );
    }
  });
  const targetProcess = requireOwnedTargetProcess(
    bundle.target.identity.ownedTargetProcess,
    'target.ownedTargetProcess',
  );
  const ownershipProcess = requireOwnedTargetProcess(
    bundle.ownership.identity.ownedTargetProcess,
    'ownership.ownedTargetProcess',
  );
  assert(
    JSON.stringify(targetProcess) === JSON.stringify(ownershipProcess),
    'target and ownership process identities differ',
  );
  assert(bundle.ownership.identity.ownerUid === currentUid(), 'ownership owner uid differs');
  exact(bundle.target.identity, 'targetId', expected.targetId, 'target');
  exact(bundle.target.identity, 'selector', expected.selector, 'target');
  exact(bundle.target.identity, 'appIdOrOrigin', expected.appIdOrOrigin, 'target');
  exact(bundle.target.identity, 'apiOrigin', expected.apiOrigin, 'target');
  exact(bundle.build.identity, 'buildId', expected.buildId, 'build');
  exact(bundle.build.identity, 'binarySha256', expected.binarySha256, 'build');
  exact(bundle.tool.identity, 'connectorId', expected.connector.id, 'tool');
  exact(bundle.tool.identity, 'kind', expected.connector.kind, 'tool');
  exact(bundle.tool.identity, 'name', expected.connector.name, 'tool');
  exact(bundle.tool.identity, 'version', expected.connector.version, 'tool');
  assert(
    bundle.tool.identity.targetSelectionCapability === true &&
      typeof bundle.tool.identity.sessionId === 'string',
    'tool target selection capability is not observed',
  );
  exact(bundle.locale.identity, 'requestedLocale', expected.locale, 'locale');
  exact(bundle.locale.identity, 'effectiveLocale', expected.locale, 'locale');
  exact(bundle.locale.identity, 'observedLocale', expected.locale, 'locale');
  assert(
    arrayEqual(strings(bundle.roles.identity.roleIds, 'roles.roleIds'), expected.roleIds),
    'roles differ from the declared role set',
  );
  assert(
    Array.isArray(bundle.roles.identity.sessionIds) &&
      bundle.roles.identity.sessionIds.length === expected.roleIds.length,
    'roles do not have one session per role',
  );
  assert(
    new Set(bundle.roles.identity.sessionIds).size === expected.roleIds.length &&
      bundle.roles.identity.independentSessions === true,
    'roles are not independently authenticated',
  );
  exact(bundle.fixture.identity, 'fixtureId', expected.fixtureId, 'fixture');
  exact(bundle.fixture.identity, 'mode', expected.fixtureMode, 'fixture');
  exact(bundle.fixture.identity, 'scope', expected.fixtureScope, 'fixture');
  exact(bundle.reset.identity, 'resetId', expected.resetId, 'reset');
  assert(
    bundle.reset.identity.fresh === true && bundle.reset.identity.verified === true,
    'reset is not a verified fresh reset',
  );
  exact(bundle.authApi.identity, 'apiOrigin', expected.apiOrigin, 'auth API');
  exact(bundle.authApi.identity, 'scope', expected.fixtureScope, 'auth API');
  assert(
    bundle.authApi.identity.readOnly === true && bundle.authApi.identity.independent === true,
    'auth API identity is not independent',
  );
  assert(
    arrayEqual(strings(bundle.authApi.identity.roleIds, 'authApi.roleIds'), expected.roleIds),
    'auth API roles differ',
  );
  exact(bundle.sql.identity, 'scope', expected.fixtureScope, 'SQL');
  assert(
    bundle.sql.identity.readOnly === true && bundle.sql.identity.independent === true,
    'SQL identity is not independent',
  );
  exact(bundle.ownership.identity, 'artifactRoot', expected.artifactRoot, 'ownership');
  assert(
    bundle.ownership.identity.current === true &&
      bundle.ownership.identity.foreignResourcesPreserved === true,
    'current ownership is not qualified',
  );
  return bundle;
}

function requireExpected(value: SelectionExpectation): void {
  assertNoSecrets(value, 'selection expectation');
  safeId(value.requestedRunId, 'requestedRunId');
  safeId(value.requestedAttemptId, 'requestedAttemptId');
  assert(
    value.requestedAttemptId.startsWith(value.requestedRunId + ':'),
    'requestedAttemptId is not bound to requestedRunId',
  );
  assert(
    EXPLORATION_PLATFORMS.includes(value.platform) && EXPLORATION_LOCALES.includes(value.locale),
  );
  safeId(value.targetId, 'targetId');
  safeText(value.selector, 'target selector');
  safeText(value.appIdOrOrigin, 'app id/origin');
  safeOrigin(value.apiOrigin, 'api origin');
  safeId(value.buildId, 'buildId');
  assert(SHA256.test(value.binarySha256), 'binarySha256 is invalid');
  safeId(value.connector.id, 'connector id');
  safeText(value.connector.name, 'connector name');
  safeText(value.connector.version, 'connector version');
  assert(EXPLORATION_CONNECTORS.includes(value.connector.kind));
  assert(
    (value.platform === 'web') === (value.connector.kind === 'playwright'),
    'connector/platform pairing is invalid',
  );
  assert(arrayEqual(strings(value.roleIds, 'roleIds'), value.roleIds), 'role IDs are invalid');
  safeId(value.fixtureId, 'fixtureId');
  assert(value.fixtureMode === 'fixture' || value.fixtureMode === 'integration');
  safeId(value.fixtureScope, 'fixtureScope');
  safeId(value.resetId, 'resetId');
  safeRelativePath(value.artifactRoot, 'artifactRoot');
}

function requireConnectorIdentity(
  identity: ConnectorIdentity,
  expected: SelectionExpectation,
): ConnectorIdentity {
  assert(
    identity.kind === expected.connector.kind,
    'Connector kind differs from the selected charter',
  );
  assert(
    identity.id === expected.connector.id &&
      identity.name === expected.connector.name &&
      identity.version === expected.connector.version,
    'Connector identity differs from the qualified tool',
  );
  assert(
    identity.targetSelectionCapability === true,
    'Connector lacks target-selection capability',
  );
  safeId(identity.sessionId, 'connector sessionId');
  return identity;
}

async function requireObservation(
  observation: ScreenObservation,
  expected: SelectionExpectation,
  label: string,
  expectedArtifactRoot: string,
  minimumTimestamp = 0,
): Promise<ScreenObservation> {
  assert(observation.kind === 'screen', label + ' kind differs');
  assert(
    observation.runId === expected.requestedRunId &&
      observation.attemptId === expected.requestedAttemptId,
    label + ' identity differs',
  );
  assert(observation.targetId === expected.targetId, label + ' target differs');
  safeId(observation.requestId, label + '.requestId');
  safeRelativePath(observation.sourcePath, label + '.sourcePath');
  requireBytes(observation.rawBytes, label + '.rawBytes');
  assert(observation.source.path === observation.sourcePath, label + '.source path differs');
  const sourceBytes = await readOwnedEvidenceSource(
    observation.source,
    expectedArtifactRoot,
    label,
  );
  assert(
    Buffer.from(sourceBytes).equals(Buffer.from(observation.rawBytes)),
    label + ' bytes differ from source',
  );
  const timestamp = monotonic(observation.capturedAtMonotonicMs, label + '.timestamp');
  assert(timestamp >= minimumTimestamp, label + ' timestamp precedes the prior owned event');
  assert(
    SHA256.test(observation.stateSha256) &&
      observation.stateSha256 === sha256(observation.rawBytes),
    label + ' hash differs from observed bytes',
  );
  assertNoSecrets(observation.identity, label + '.identity');
  exact(observation.identity, 'runId', observation.runId, label);
  exact(observation.identity, 'attemptId', observation.attemptId, label);
  exact(observation.identity, 'targetId', observation.targetId, label);
  exact(observation.identity, 'requestId', observation.requestId, label);
  exact(observation.identity, 'capturedAtMonotonicMs', observation.capturedAtMonotonicMs, label);
  return observation;
}

export function requireBoundedAction(
  value: unknown,
  connectorKind: ConnectorKind,
  allowedActions: readonly string[],
  label = 'Action',
): BoundedAction {
  assert(isRecord(value), label + ' is malformed');
  assert(
    !('yaml' in value) && !('actions' in value) && !('runFlow' in value) && !('repeat' in value),
    label + ' cannot be a static or nested plan',
  );
  const id = safeText(value.id, label + '.id', 512);
  assert(allowedActions.includes(id), label + ' is outside the declared charter');
  assert(
    typeof value.command === 'string' && ACTION_COMMANDS.includes(value.command as ActionCommand),
    label + '.command is unsupported',
  );
  const command = value.command as ActionCommand;
  const native = new Set([
    'tapOn',
    'assertVisible',
    'assertNotVisible',
    'scrollUntilVisible',
    'inputText',
    'pressKey',
    'back',
    'waitForAnimationToEnd',
  ]);
  const web = new Set(['click', 'fill', 'press', 'goBack']);
  assert(
    (connectorKind === 'maestro' ? native : web).has(command),
    label + '.command does not match connector',
  );
  if (['tapOn', 'assertVisible', 'assertNotVisible', 'click'].includes(command)) {
    assert(isRecord(value.selector), label + '.selector is required');
    const keys = Object.keys(value.selector);
    assert(
      keys.length === 1 && (keys[0] === 'id' || keys[0] === 'text'),
      label + '.selector must have one stable field',
    );
    safeText(value.selector[keys[0]], label + '.selector', 512);
  }
  if (['inputText', 'fill'].includes(command)) {
    assert(value.text === undefined, label + '.text literals are forbidden; use textRef');
    safeId(value.textRef, label + '.textRef');
  } else assert(value.textRef === undefined, label + '.textRef is only valid for text actions');
  if (command === 'pressKey' || command === 'press') safeText(value.key, label + '.key', 64);
  if (command === 'scrollUntilVisible')
    assert(value.direction === 'UP' || value.direction === 'DOWN', label + '.direction is invalid');
  if (value.waitMs !== undefined) {
    assert(
      typeof value.waitMs === 'number' &&
        Number.isSafeInteger(value.waitMs) &&
        value.waitMs >= 0 &&
        value.waitMs <= 10_000,
      label + '.waitMs is invalid',
    );
  }
  assertNoSecrets(value, label);
  return {
    id,
    command,
    ...(value.selector ? { selector: value.selector } : {}),
    ...(value.textRef !== undefined ? { textRef: value.textRef as string } : {}),
    ...(value.key !== undefined ? { key: value.key as string } : {}),
    ...(value.direction !== undefined ? { direction: value.direction as 'UP' | 'DOWN' } : {}),
    ...(value.waitMs !== undefined ? { waitMs: value.waitMs } : {}),
  };
}

async function validateActionResult(
  result: ConnectorActionResult,
  expected: SelectionExpectation,
  label: string,
  ordinal: number,
  expectedArtifactRoot: string,
  minimumTimestamp = 0,
): Promise<void> {
  assert(
    result.kind === 'action-result' &&
      result.runId === expected.requestedRunId &&
      result.attemptId === expected.requestedAttemptId,
    label + ' identity is invalid',
  );
  safeId(result.requestId, label + '.requestId');
  const timestamp = monotonic(result.capturedAtMonotonicMs, label + '.timestamp');
  assert(timestamp >= minimumTimestamp, label + ' timestamp precedes the prior owned event');
  requireBytes(result.requestBytes, label + '.requestBytes');
  requireBytes(result.resultBytes, label + '.resultBytes');
  safeRelativePath(result.sourcePath, label + '.sourcePath');
  const requestSource = await readOwnedEvidenceSource(
    result.requestSource,
    expectedArtifactRoot,
    label + '.request',
  );
  const resultSource = await readOwnedEvidenceSource(
    result.resultSource,
    expectedArtifactRoot,
    label + '.result',
  );
  assert(
    Buffer.from(requestSource).equals(Buffer.from(result.requestBytes)),
    label + ' request bytes differ from source',
  );
  assert(
    Buffer.from(resultSource).equals(Buffer.from(result.resultBytes)),
    label + ' result bytes differ from source',
  );
  assert(
    ['passed', 'failed', 'blocked', 'cancelled'].includes(result.status),
    label + '.status is invalid',
  );
  assert(
    result.requestedUiActionCount === 1 &&
      (result.appliedUiActionCount === null ||
        result.appliedUiActionCount === 0 ||
        result.appliedUiActionCount === 1),
    label + ' action counts are invalid',
  );
  assertNoSecrets(result.identity, label + '.identity');
  exact(result.identity, 'runId', result.runId, label);
  exact(result.identity, 'attemptId', result.attemptId, label);
  exact(result.identity, 'requestId', result.requestId, label);
  exact(result.identity, 'ordinal', ordinal, label);
  exact(result.identity, 'capturedAtMonotonicMs', result.capturedAtMonotonicMs, label);
  exact(result.identity, 'targetId', expected.targetId, label);
}

function requireRunEnvelope(
  value: { runId: string; attemptId: string; capturedAtMonotonicMs: number },
  expected: SelectionExpectation,
  label: string,
  minimumTimestamp = 0,
): number {
  assert(
    value.runId === expected.requestedRunId && value.attemptId === expected.requestedAttemptId,
    label + ' run identity differs',
  );
  const timestamp = monotonic(value.capturedAtMonotonicMs, label + '.capturedAtMonotonicMs');
  assert(timestamp >= minimumTimestamp, label + ' timestamp precedes the owned run start');
  return timestamp;
}

function requireEnvelopeIdentity(
  identity: JsonRecord,
  envelope: { runId: string; attemptId: string; capturedAtMonotonicMs: number },
  label: string,
): void {
  exact(identity, 'runId', envelope.runId, label);
  exact(identity, 'attemptId', envelope.attemptId, label);
  exact(identity, 'capturedAtMonotonicMs', envelope.capturedAtMonotonicMs, label);
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  throw reason instanceof Error ? reason : new Error(label + ' was aborted');
}

async function allSettledOrThrow<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks);
  const failure = settled.find(
    (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
  );
  if (failure) throw failure.reason;
  return settled.map((entry) => (entry as PromiseFulfilledResult<T>).value);
}

class OperationFence {
  private readonly active = new Set<Promise<unknown>>();
  private readonly latchedFailures = new Set<string>();

  track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.then(
      (value) => {
        this.active.delete(tracked);
        return value;
      },
      (error) => {
        this.active.delete(tracked);
        throw error;
      },
    );
    this.active.add(tracked);
    return tracked;
  }

  get size(): number {
    return this.active.size;
  }

  latchFailure(reason: string): void {
    this.latchedFailures.add(errorText(reason));
  }

  get hasLatchedFailure(): boolean {
    return this.latchedFailures.size > 0;
  }

  async drain(timeoutMs: number): Promise<boolean> {
    if (this.active.size === 0) return !this.hasLatchedFailure;
    const pending = Promise.allSettled([...this.active]).then(() => true);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
    const drained = await Promise.race([pending, timeout]);
    return drained && !this.hasLatchedFailure;
  }
}

class ExecutionDeadline {
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly parent?: AbortSignal;
  private readonly fence: OperationFence;
  private readonly onParentAbort: () => void;
  private stopReason: 'duration-limit' | 'cancelled' | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly now: () => number,
    durationMs: number,
    parent?: AbortSignal,
    fence = new OperationFence(),
    requestedDeadlineAtMonotonicMs?: number,
  ) {
    assert(
      Number.isFinite(durationMs) &&
        durationMs > 0 &&
        durationMs <= EXPLORATION_MAX_DURATION_MINUTES * 60_000,
      'Invalid T16-B execution deadline',
    );
    this.startedAt = monotonic(now(), 'execution start');
    const deadlineAt = requestedDeadlineAtMonotonicMs ?? this.startedAt + durationMs;
    assert(
      Number.isSafeInteger(deadlineAt) && deadlineAt > 0,
      'Invalid T16-B absolute execution deadline',
    );
    this.deadlineAt = deadlineAt;
    this.signal = this.controller.signal;
    this.parent = parent;
    this.fence = fence;
    this.onParentAbort = () => {
      this.stopReason = 'cancelled';
      const cancellationReason: unknown = parent?.reason;
      const cancellation =
        cancellationReason instanceof Error ? cancellationReason : new Error('T16-B cancelled');
      this.fence.latchFailure(errorText(cancellation));
      this.controller.abort(cancellation);
    };
    if (parent?.aborted) this.onParentAbort();
    else parent?.addEventListener('abort', this.onParentAbort, { once: true });
    this.timer = setTimeout(
      () => {
        this.stopReason = 'duration-limit';
        const deadlineError = new Error('T16-B deadline reached');
        this.fence.latchFailure(deadlineError.message);
        this.controller.abort(deadlineError);
      },
      Math.max(1, this.deadlineAt - this.startedAt),
    );
  }

  get reason(): 'duration-limit' | 'cancelled' | null {
    this.refresh();
    return this.stopReason;
  }

  refresh(): void {
    if (this.stopReason) return;
    if (this.signal.aborted) {
      this.stopReason = 'cancelled';
      return;
    }
    const current = this.now();
    if (!Number.isFinite(current) || current < this.startedAt || current >= this.deadlineAt) {
      this.stopReason = 'duration-limit';
      const deadlineError = new Error('T16-B deadline or clock failure');
      this.fence.latchFailure(deadlineError.message);
      this.controller.abort(deadlineError);
    }
  }

  throwIfBlocked(stage: string): void {
    this.refresh();
    if (this.stopReason) throw new Error('T16-B ' + this.stopReason + ' during ' + stage);
  }

  async run<T>(stage: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.throwIfBlocked(stage);
    const operationPromise = this.fence.track(Promise.resolve().then(() => operation(this.signal)));
    operationPromise.catch(() => undefined);
    const remaining = this.deadlineAt - this.now();
    if (remaining <= 0) {
      this.stopReason = 'duration-limit';
      const deadlineError = new Error('T16-B deadline reached during ' + stage);
      this.fence.latchFailure(deadlineError.message);
      this.controller.abort(deadlineError);
      throw new Error('T16-B duration-limit during ' + stage);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () =>
        reject(new Error('T16-B ' + (this.stopReason || 'cancelled') + ' during ' + stage));
      this.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(
        () => {
          this.stopReason = 'duration-limit';
          const deadlineError = new Error('T16-B deadline reached during ' + stage);
          this.fence.latchFailure(deadlineError.message);
          this.controller.abort(deadlineError);
        },
        Math.max(1, remaining),
      );
    });
    try {
      const result = await Promise.race([operationPromise, abortPromise]);
      this.refresh();
      if (this.stopReason) throw new Error('T16-B ' + this.stopReason + ' during ' + stage);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) this.signal.removeEventListener('abort', onAbort);
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.parent?.removeEventListener('abort', this.onParentAbort);
  }
}

async function boundedIndependent<T>(
  label: string,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  fence: OperationFence,
  externalSignals: readonly AbortSignal[] = [],
): Promise<{ completed: true; value: T } | { completed: false; error: string }> {
  assert(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= CLEANUP_TIMEOUT_MS,
    label + ' timeout is invalid',
  );
  const controller = new AbortController();
  const externalAbortListeners: { signal: AbortSignal; listener: () => void }[] = [];
  const forwardAbort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of externalSignals) {
    if (signal.aborted) forwardAbort(signal);
    else {
      const listener = () => forwardAbort(signal);
      externalAbortListeners.push({ signal, listener });
      signal.addEventListener('abort', listener, { once: true });
    }
  }
  const operationPromise = fence.track(Promise.resolve().then(() => operation(controller.signal)));
  operationPromise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutError = new Error(label + ' timed out');
      fence.latchFailure(timeoutError.message);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return { completed: true, value: await Promise.race([operationPromise, timeoutPromise]) };
  } catch (error) {
    return { completed: false, error: errorText(error) };
  } finally {
    if (timer) clearTimeout(timer);
    for (const { signal, listener } of externalAbortListeners)
      signal.removeEventListener('abort', listener);
  }
}

async function requirePrivateDirectory(directory: string, label: string): Promise<void> {
  const info = await lstat(directory);
  assert(info.isDirectory() && !info.isSymbolicLink(), label + ' must be a regular directory');
  assert((info.mode & 0o777) === 0o700, label + ' must be mode 0700');
  if (typeof process.getuid === 'function')
    assert(info.uid === process.getuid(), label + ' is not owned by the current user');
  assert((await realpath(directory)) === directory, label + ' must be canonical');
}

async function requirePrivateFile(file: string, label: string): Promise<void> {
  const info = await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink(), label + ' must be a regular file');
  assert((info.mode & 0o777) === 0o600, label + ' must be mode 0600');
  if (typeof process.getuid === 'function')
    assert(info.uid === process.getuid(), label + ' is not owned by the current user');
  assert((await realpath(file)) === file, label + ' must be canonical');
}

function isUnder(root: string, candidate: string): boolean {
  const a = path.resolve(root);
  const b = path.resolve(candidate);
  return b !== a && b.startsWith(a + path.sep);
}

async function writeExclusive(file: string, content: Uint8Array): Promise<void> {
  assert(content.byteLength <= MAX_EVIDENCE_BYTES, 'private output exceeds the evidence bound');
  await writeFile(file, content, { flag: 'wx', mode: 0o600 });
  await chmod(file, 0o600);
  await requirePrivateFile(file, 'private evidence file');
}

export async function createT16BPrivateEvidenceWriter(input: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedAttemptId: string;
}): Promise<PrivateEvidenceWriter> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const artifactRoot = path.isAbsolute(input.artifactRoot)
    ? path.resolve(input.artifactRoot)
    : path.resolve(repositoryRoot, input.artifactRoot);
  safeId(input.requestedAttemptId, 'requestedAttemptId');
  const qaRoot = path.join(repositoryRoot, '.qa', 'artifacts');
  assert(isUnder(qaRoot, artifactRoot), 'Execution artifact root must be below .qa/artifacts');
  await requirePrivateDirectory(artifactRoot, 'artifact root');
  const executionRoot = path.join(artifactRoot, 'execution', input.requestedAttemptId);
  await mkdir(path.dirname(executionRoot), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(executionRoot), 0o700);
  await mkdir(executionRoot, { mode: 0o700 });
  await chmod(executionRoot, 0o700);
  await requirePrivateDirectory(executionRoot, 'execution root');
  const evidenceRoot = path.join(executionRoot, 'evidence');
  await mkdir(evidenceRoot, { mode: 0o700 });
  await chmod(evidenceRoot, 0o700);
  await requirePrivateDirectory(evidenceRoot, 'evidence root');
  const ledgerPath = path.join(executionRoot, 'action-attempt-ledger.private.jsonl');
  const ledger = await open(ledgerPath, 'wx', 0o600);
  await chmod(ledgerPath, 0o600);
  await requirePrivateFile(ledgerPath, 'action ledger');
  let closed = false;
  let closeSucceeded = false;
  let finalizationPrepared = false;
  let finalized = false;
  const ensureOpen = () =>
    assert(!closed && !finalizationPrepared, 'Private exploration writer is closed or finalized');
  const writeEvidence = async (
    label: string,
    evidence: OriginalEvidence | { kind: EvidenceKind; path: string; bytes: Uint8Array },
  ): Promise<EvidenceReference> => {
    ensureOpen();
    assert(SAFE_LABEL.test(label), 'Evidence label is unsafe');
    const captured = requireBytes(evidence.bytes, label + '.bytes');
    safeRelativePath(evidence.path, label + '.sourcePath');
    const file = path.join(evidenceRoot, label + '.bin');
    await writeExclusive(file, captured);
    const stored = await readFile(file);
    assert(
      Buffer.from(stored).equals(Buffer.from(captured)),
      label + ' readback differs from original bytes',
    );
    const relativePath = path.relative(artifactRoot, file);
    const observation = readNativeEvidenceObservation(artifactRoot, relativePath, true);
    assert(
      observation.bytes.equals(Buffer.from(captured)),
      label + ' protected identity readback differs from original bytes',
    );
    return {
      path: relativePath,
      sha256: sha256(captured),
      bytes: captured.byteLength,
      kind: evidence.kind,
      identity: observation.identity,
    };
  };
  const appendAttempt = async (row: ActionAttemptLedgerRow) => {
    ensureOpen();
    assert(row.kind === 'action-attempt', 'Ledger row kind is invalid');
    assertNoSecrets(row);
    const encoded = Buffer.from(JSON.stringify(row) + '\n', 'utf8');
    assert(encoded.byteLength <= MAX_EVIDENCE_BYTES, 'Ledger row exceeds the evidence bound');
    await ledger.write(encoded);
    await ledger.sync();
    const stored = await readFile(ledgerPath);
    assert(stored.byteLength <= MAX_EVIDENCE_BYTES, 'action ledger exceeds the evidence bound');
    return { ordinal: row.ordinal, sha256: sha256(stored), bytes: stored.byteLength };
  };
  const finalize = async (
    value: {
      receipt: JsonRecord;
      coverage: JsonRecord;
      exploration: string;
      bugs: string;
      docChanges: string;
    },
    signal?: AbortSignal,
  ) => {
    ensureOpen();
    throwIfAborted(signal, 'Private exploration finalization');
    assert(
      !finalizationPrepared && !finalized,
      'Private exploration publication already finalized',
    );
    assertNoSecrets(value.receipt, 'receipt');
    assertNoSecrets(value.coverage, 'coverage');
    for (const [label, text] of [
      ['exploration', value.exploration],
      ['bugs', value.bugs],
      ['docChanges', value.docChanges],
    ] as const) {
      assert(text.length <= MAX_EVIDENCE_BYTES, label + ' exceeds the evidence bound');
      assert(!SECRET_VALUE.test(text), label + ' contains a secret-like value');
    }
    const publicationRoot = path.join(executionRoot, 'publication');
    await mkdir(publicationRoot, { mode: 0o700 });
    await chmod(publicationRoot, 0o700);
    await requirePrivateDirectory(publicationRoot, 'publication root');
    const outputs: [string, Uint8Array][] = [
      [
        'execution-receipt.private.json',
        Buffer.from(JSON.stringify(value.receipt, null, 2) + '\n'),
      ],
      ['coverage.json', Buffer.from(JSON.stringify(value.coverage, null, 2) + '\n')],
      ['exploration.md', Buffer.from(value.exploration)],
      ['bugs.md', Buffer.from(value.bugs)],
      ['doc-changes.md', Buffer.from(value.docChanges)],
    ];
    for (const [name, content] of outputs) {
      throwIfAborted(signal, 'Private exploration finalization');
      await writeExclusive(path.join(publicationRoot, name), content);
    }
    throwIfAborted(signal, 'Private exploration finalization');
    const ledgerBytes = await readFile(ledgerPath);
    assert(
      ledgerBytes.byteLength <= MAX_EVIDENCE_BYTES,
      'action ledger exceeds the evidence bound',
    );
    const receiptPath = path.join(publicationRoot, 'execution-receipt.private.json');
    const receiptBytes = await readFile(receiptPath);
    assertNoSecrets(JSON.parse(receiptBytes.toString('utf8')), 'published receipt');
    const ledgerRelativePath = path.relative(artifactRoot, ledgerPath);
    const receiptRelativePath = path.relative(artifactRoot, receiptPath);
    const ledgerObservation = readNativeEvidenceObservation(artifactRoot, ledgerRelativePath, true);
    const receiptObservation = readNativeEvidenceObservation(
      artifactRoot,
      receiptRelativePath,
      true,
    );
    const ledgerReference = {
      path: ledgerRelativePath,
      sha256: sha256(ledgerBytes),
      bytes: ledgerBytes.byteLength,
      kind: 'action-result' as EvidenceKind,
      identity: ledgerObservation.identity,
    };
    const receiptReference = {
      path: receiptRelativePath,
      sha256: sha256(receiptBytes),
      bytes: receiptBytes.byteLength,
      kind: 'cleanup' as EvidenceKind,
      identity: receiptObservation.identity,
    };
    finalizationPrepared = true;
    throwIfAborted(signal, 'Private exploration finalization');
    return {
      receipt: {
        ...receiptReference,
      },
      ledger: {
        ...ledgerReference,
      },
    };
  };
  const completePublication = async (signal?: AbortSignal): Promise<EvidenceReference> => {
    assert(finalizationPrepared, 'Private exploration publication was not finalized');
    assert(closeSucceeded, 'Private exploration ledger was not closed successfully');
    assert(!finalized, 'Private exploration publication already completed');
    throwIfAborted(signal, 'Private exploration completion');
    const publicationRoot = path.join(executionRoot, 'publication');
    const receiptPath = path.join(publicationRoot, 'execution-receipt.private.json');
    const ledgerBytes = await readFile(ledgerPath);
    const receiptBytes = await readFile(receiptPath);
    throwIfAborted(signal, 'Private exploration completion');
    const markerPath = path.join(publicationRoot, 'publication-complete.private.json');
    const markerStagingPath = markerPath + '.pending';
    try {
      await lstat(markerPath);
      throw new Error('publication marker already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const markerBytes = Buffer.from(
      JSON.stringify({
        schema: 't16-b-publication-v1',
        complete: true,
        receipt: {
          path: path.relative(artifactRoot, receiptPath),
          sha256: sha256(receiptBytes),
          bytes: receiptBytes.byteLength,
          kind: 'cleanup' as EvidenceKind,
        },
        ledger: {
          path: path.relative(artifactRoot, ledgerPath),
          sha256: sha256(ledgerBytes),
          bytes: ledgerBytes.byteLength,
          kind: 'action-result' as EvidenceKind,
        },
      }) + '\n',
    );
    try {
      await writeExclusive(markerStagingPath, markerBytes);
      throwIfAborted(signal, 'Private exploration completion');
      // All asynchronous preparation is complete. The synchronous rename is the
      // owned terminal commit: a deadline or parent abort cannot interleave with
      // it and leave a committed marker classified as blocked.
      renameSync(markerStagingPath, markerPath);
    } catch (error) {
      await rm(markerStagingPath, { force: true }).catch(() => undefined);
      throw error;
    }
    // A successful rename is the terminal commit point. No asynchronous operation
    // follows it that could turn a committed marker into a blocked result.
    finalized = true;
    const markerRelativePath = path.relative(artifactRoot, markerPath);
    const markerObservation = readNativeEvidenceObservation(artifactRoot, markerRelativePath, true);
    return {
      path: markerRelativePath,
      sha256: sha256(markerBytes),
      bytes: markerBytes.byteLength,
      kind: 'cleanup',
      identity: markerObservation.identity,
    };
  };
  return {
    kind: 'owned-private-exploration-writer',
    artifactRoot,
    executionRoot,
    writeEvidence,
    appendAttempt,
    finalize,
    completePublication,
    close: async () => {
      if (!closed) {
        try {
          await ledger.close();
          closeSucceeded = true;
        } finally {
          closed = true;
        }
      }
    },
  };
}

function branchId(action: BoundedAction): string {
  return 'branch-' + sha256(JSON.stringify(action)).slice(0, 24);
}

function inputHash(action: BoundedAction): string {
  return sha256(JSON.stringify(action));
}

function requireCleanupAudit(
  audit: OwnedCleanupAudit,
  expected: SelectionExpectation,
): OwnedCleanupAudit {
  assert(audit.kind === 'owned-exploration-cleanup', 'Cleanup audit kind is invalid');
  assert(
    audit.scope === 't16-owned-mcp-namespace-only',
    'Cleanup audit scope is not the owned MCP namespace',
  );
  assert(
    audit.runId === expected.requestedRunId && audit.attemptId === expected.requestedAttemptId,
    'Cleanup audit identity differs',
  );
  monotonic(audit.capturedAtMonotonicMs, 'Cleanup timestamp');
  requireCommonEvidence(audit.source, 'cleanup', expected, 'cleanup source');
  requireEnvelopeIdentity(audit.source.identity, audit, 'cleanup source');
  if (audit.recoverySource) {
    requireCommonEvidence(audit.recoverySource, 'cleanup', expected, 'cleanup recovery source');
    requireEnvelopeIdentity(
      audit.recoverySource.identity,
      audit.recoverySource,
      'cleanup recovery source',
    );
    assert(
      audit.recoverySource.capturedAtMonotonicMs >= audit.capturedAtMonotonicMs,
      'cleanup recovery source precedes cleanup event',
    );
  }
  assert(
    ['cleaned', 'failed-recovery-retained', 'unknown', 'not-acquired'].includes(audit.status),
    'Cleanup status is invalid',
  );
  for (const [label, value] of [
    ['ownedProcessGroupAbsent', audit.ownedProcessGroupAbsent],
    ['socketResourcesAbsent', audit.socketResourcesAbsent],
    ['backendResourcesAbsent', audit.backendResourcesAbsent],
    ['foreignResourcesPreserved', audit.foreignResourcesPreserved],
  ] as const)
    assert(typeof value === 'boolean', 'Cleanup ' + label + ' must be boolean');
  assert(
    audit.outerCleanupStatus === 'unproven' ||
      audit.outerCleanupStatus === 'verified' ||
      audit.outerCleanupStatus === 'failed',
    'Cleanup outer cleanup status is invalid',
  );
  if (audit.status === 'cleaned')
    assert(
      audit.ownedProcessGroupAbsent &&
        audit.socketResourcesAbsent &&
        audit.outerCleanupStatus !== 'failed',
      'Cleaned MCP audit has an unsafe namespace claim',
    );
  if (audit.outerCleanupStatus === 'verified')
    assert(
      audit.backendResourcesAbsent && audit.foreignResourcesPreserved,
      'Verified outer cleanup has incomplete facts',
    );
  if (audit.status !== 'cleaned')
    assert(
      audit.status === 'not-acquired' || audit.recoverySource,
      'Failed cleanup has no recovery evidence',
    );
  return audit;
}

function countAttempts(rows: readonly ActionAttemptLedgerRow[], leaked: boolean) {
  return {
    requested: rows.length,
    started: rows.filter((row) => row.result.requestedUiActionCount === 1).length,
    passed: rows.filter((row) => row.result.status === 'passed').length,
    applicationFailed: rows.filter((row) => row.result.status === 'failed').length,
    blocked: rows.filter((row) => row.result.status === 'blocked').length,
    cancelled: rows.filter((row) => row.result.status === 'cancelled').length,
    leaked: leaked ? 1 : 0,
  };
}

function coverage(charter: PreparedExplorationCharter, result: T16BExecutionResult): JsonRecord {
  return {
    schemaVersion: 1,
    kind: 't16-b-owned-exploration-execution',
    charterId: charter.id,
    scenarioId: charter.scenario.id,
    status: result.status,
    explorationStatus: result.explorationStatus,
    qualification: result.qualification,
    runtimePassingCases: 0,
    publicationEligible: false,
    recoveryNotVerified: result.recoveryNotVerified,
    attemptCounts: result.attemptCounts,
    attempts: result.actionAttempts.map((row) => ({
      ordinal: row.ordinal,
      branchId: row.branchId,
      status: row.result.status,
      requestedUiActionCount: row.result.requestedUiActionCount,
      appliedUiActionCount: row.result.appliedUiActionCount,
      evidence: row.evidence,
    })),
    blockers: result.reason ? [result.reason] : [],
  };
}

function receiptView(
  result: T16BExecutionResult,
  shutdown: ConnectorShutdownReceipt,
  shutdownReference: EvidenceReference | null,
): JsonRecord {
  return {
    schema: result.schema,
    status: result.status,
    explorationStatus: result.explorationStatus,
    qualification: result.qualification,
    runtimePassingCases: 0,
    requestedRunId: result.requestedRunId,
    requestedAttemptId: result.requestedAttemptId,
    actionAttempts: result.actionAttempts,
    selectionEvidence: result.selectionEvidence,
    connector: result.connector,
    cleanup: result.cleanup
      ? {
          kind: result.cleanup.kind,
          runId: result.cleanup.runId,
          attemptId: result.cleanup.attemptId,
          status: result.cleanup.status,
          capturedAtMonotonicMs: result.cleanup.capturedAtMonotonicMs,
          ownedProcessGroupAbsent: result.cleanup.ownedProcessGroupAbsent,
          socketResourcesAbsent: result.cleanup.socketResourcesAbsent,
          outerCleanupStatus: result.cleanup.outerCleanupStatus,
          backendResourcesAbsent: result.cleanup.backendResourcesAbsent,
          foreignResourcesPreserved: result.cleanup.foreignResourcesPreserved,
          sourceReference: result.selectionEvidence.cleanup || null,
          recoverySourceReference: result.selectionEvidence.cleanupRecovery || null,
        }
      : null,
    connectorShutdown: {
      kind: shutdown.kind,
      runId: shutdown.runId,
      attemptId: shutdown.attemptId,
      status: shutdown.status,
      capturedAtMonotonicMs: shutdown.capturedAtMonotonicMs,
      errorCode: shutdown.errorCode || null,
      sourceReference: shutdownReference,
    },
    publicationEligible: false,
    recoveryNotVerified: result.recoveryNotVerified,
    inFlightOperations: result.inFlightOperations,
    stopReason: result.stopReason,
    reason: result.reason,
    budget: result.budget,
    attemptCounts: result.attemptCounts,
    actionOrdinals: result.actionAttempts.map((row) => row.ordinal),
  };
}

export async function executeOwnedExploration(
  input: T16BExecutionInput,
): Promise<T16BExecutionResult> {
  const charter = requirePreparedCharter(input.charter);
  requireExpected(input.expectation);
  assert(
    input.writer.kind === 'owned-private-exploration-writer',
    'Execution requires the owned private writer',
  );
  const expectedArtifactRoot = path.isAbsolute(input.expectation.artifactRoot)
    ? path.resolve(input.expectation.artifactRoot)
    : path.resolve(input.repositoryRoot, input.expectation.artifactRoot);
  assert(
    path.resolve(input.writer.artifactRoot) === expectedArtifactRoot,
    'Writer root differs from immutable selection identity',
  );
  assert(
    charter.platforms.includes(input.expectation.platform) &&
      charter.locales.includes(input.expectation.locale),
    'Charter does not support selection',
  );
  assert(
    charter.connectorsByPlatform[input.expectation.platform] === input.expectation.connector.kind,
    'Charter connector differs from selection',
  );
  const connectorIdentity = requireConnectorIdentity(input.connector.identity, input.expectation);
  const now = input.now || (() => Number(process.hrtime.bigint() / 1_000_000n));
  const fence = new OperationFence();
  const deadline = new ExecutionDeadline(
    now,
    input.maxDurationMs ?? EXPLORATION_MAX_DURATION_MINUTES * 60_000,
    input.signal,
    fence,
    input.deadlineAtMonotonicMs,
  );
  let lastEnvelopeTimestamp = deadline.startedAt;
  const cleanupTimeoutMs = input.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS;
  assert(
    Number.isSafeInteger(cleanupTimeoutMs) &&
      cleanupTimeoutMs > 0 &&
      cleanupTimeoutMs <= CLEANUP_TIMEOUT_MS,
    'Invalid cleanup timeout',
  );
  const policy = new ExplorationBudgetPolicy(now);
  const rows: ActionAttemptLedgerRow[] = [];
  const selectionRefs: Record<string, EvidenceReference> = {};
  let cleanup: OwnedCleanupAudit | null = null;
  let shutdownReference: EvidenceReference | null = null;
  let connectorStartAttempted = false;
  let connectorStarted = false;
  let currentObservation: ScreenObservation | null = null;
  let status: T16BExecutionResult['status'] = 'blocked';
  let explorationStatus: T16BExecutionResult['explorationStatus'] = 'not-run';
  let explorationStarted = false;
  let actionCancelled = false;
  let reason: string | null = null;
  let stopReason: string | null = null;
  let ledgerPublicationFailure = false;
  let cleanupFailureLatched = false;
  let recoveryNotVerified = false;
  let finalEvidence: {
    receipt: EvidenceReference;
    ledger: EvidenceReference;
    marker: EvidenceReference;
  } | null = null;
  let pendingPublication: { receipt: EvidenceReference; ledger: EvidenceReference } | null = null;
  let publicationCommitted = false;

  const writeEvidence = async (
    label: string,
    evidence: OriginalEvidence | { kind: EvidenceKind; path: string; bytes: Uint8Array },
  ): Promise<EvidenceReference> => {
    if ('runId' in evidence) {
      requireCommonEvidence(
        evidence,
        evidence.kind,
        input.expectation,
        label,
        expectedArtifactRoot,
      );
      await verifyCommonEvidenceSource(evidence, label, expectedArtifactRoot);
    } else {
      requireBytes(evidence.bytes, label + '.bytes');
      safeRelativePath(evidence.path, label + '.path');
    }
    const written = await boundedIndependent(
      'evidence write ' + label,
      () => input.writer.writeEvidence(label, evidence),
      cleanupTimeoutMs,
      fence,
    );
    if (!written.completed) {
      recoveryNotVerified = true;
      reason = reason ? reason + '; evidence: ' + written.error : 'evidence: ' + written.error;
      throw new Error(written.error);
    }
    return written.value;
  };
  const readSelection = async () => {
    const values = await deadline.run('selection qualification', (signal) =>
      allSettledOrThrow([
        input.selection.readTarget(signal),
        input.selection.readBuild(signal),
        input.selection.readTool(signal),
        input.selection.readLocale(signal),
        input.selection.readRoles(signal),
        input.selection.readFixture(signal),
        input.selection.readReset(signal),
        input.selection.readAuthApi(signal),
        input.selection.readSql(signal),
        input.selection.readOwnership(signal),
      ]),
    );
    const bundle: SelectionEvidenceBundle = {
      target: values[0],
      build: values[1],
      tool: values[2],
      locale: values[3],
      roles: values[4],
      fixture: values[5],
      reset: values[6],
      authApi: values[7],
      sql: values[8],
      ownership: values[9],
    };
    requireSelectionBundle(bundle, input.expectation, expectedArtifactRoot);
    for (const evidence of Object.values(bundle))
      assert(
        evidence.capturedAtMonotonicMs >= deadline.startedAt,
        'Selection evidence precedes the owned run start',
      );
    for (const [key, evidence] of Object.entries(bundle))
      selectionRefs[key] = await writeEvidence('selection-' + key, evidence);
  };

  const appendAttempt = async (row: ActionAttemptLedgerRow): Promise<boolean> => {
    rows.push(row);
    const appended = await boundedIndependent(
      'action ledger append',
      () => input.writer.appendAttempt(row),
      cleanupTimeoutMs,
      fence,
    );
    if (!appended.completed) {
      ledgerPublicationFailure = true;
      recoveryNotVerified = true;
      reason = reason ? reason + '; ledger: ' + appended.error : 'ledger: ' + appended.error;
      status = 'blocked';
      return false;
    }
    return true;
  };

  const recordBudgetRefusal = async (
    action: BoundedAction,
    before: ScreenObservation,
    ordinal: number,
    stop: string,
  ): Promise<void> => {
    await appendAttempt({
      kind: 'action-attempt',
      ordinal,
      branchId: branchId(action),
      requestedAtMonotonicMs: monotonic(now(), 'blocked action timestamp'),
      previousObservationSha256: before.stateSha256,
      action,
      result: {
        status: 'blocked',
        requestId: null,
        requestedUiActionCount: 0,
        appliedUiActionCount: null,
        completedAtMonotonicMs: null,
        error: stop,
      },
      evidence: { before: null, request: null, result: null, after: null, api: null, sql: null },
      policySequence: null,
    });
  };

  const performAction = async (
    action: BoundedAction,
    before: ScreenObservation,
    ordinal: number,
  ): Promise<ActionExecutionSummary> => {
    const permit = policy.beginAction({
      branchId: branchId(action),
      inputSha256: inputHash(action),
      observationSha256: before.stateSha256,
    });
    if (!permit) {
      stopReason = policy.snapshot().stopReason;
      reason = stopReason || 'exploration budget stopped';
      await recordBudgetRefusal(action, before, ordinal, reason);
      return { continueExploration: false, completedSuccessfully: false };
    }
    const row: ActionAttemptLedgerRow = {
      kind: 'action-attempt',
      ordinal,
      branchId: branchId(action),
      requestedAtMonotonicMs: monotonic(now(), 'action timestamp'),
      previousObservationSha256: before.stateSha256,
      action,
      result: {
        status: 'blocked',
        requestId: null,
        requestedUiActionCount: 1,
        appliedUiActionCount: null,
        completedAtMonotonicMs: null,
        error: null,
      },
      evidence: { before: null, request: null, result: null, after: null, api: null, sql: null },
      policySequence: permit.sequence,
    };
    let result: ConnectorActionResult | null = null;
    let after: ScreenObservation | null = null;
    let outcome: ActionAttemptLedgerRow['result']['status'] = 'blocked';
    let actionError: string | null = null;
    try {
      row.evidence.before = await writeEvidence(ordinal + '-before', {
        kind: 'screen',
        path: before.sourcePath,
        bytes: before.rawBytes,
      });
      result = await deadline.run('UI action ' + ordinal, (signal) =>
        input.connector.perform({ targetId: input.expectation.targetId, action, ordinal, signal }),
      );
      await validateActionResult(
        result,
        input.expectation,
        'UI action ' + ordinal,
        ordinal,
        expectedArtifactRoot,
        lastEnvelopeTimestamp,
      );
      lastEnvelopeTimestamp = result.capturedAtMonotonicMs;
      outcome = result.status;
      if (result.status === 'passed')
        assert(
          result.appliedUiActionCount === 1,
          'Successful action did not report one applied command',
        );
      row.result.requestId = result.requestId;
      row.result.appliedUiActionCount = result.appliedUiActionCount;
      row.result.completedAtMonotonicMs = result.capturedAtMonotonicMs;
      row.evidence.request = await writeEvidence(ordinal + '-request', {
        kind: 'action-request',
        path: result.sourcePath,
        bytes: result.requestBytes,
      });
      row.evidence.result = await writeEvidence(ordinal + '-result', {
        kind: 'action-result',
        path: result.sourcePath,
        bytes: result.resultBytes,
      });
      after = await deadline.run('screen after action ' + ordinal, (signal) =>
        input.connector.observe({ targetId: input.expectation.targetId, signal }),
      );
      await requireObservation(
        after,
        input.expectation,
        'screen after action ' + ordinal,
        expectedArtifactRoot,
        lastEnvelopeTimestamp,
      );
      lastEnvelopeTimestamp = after.capturedAtMonotonicMs;
      row.evidence.after = await writeEvidence(ordinal + '-after', {
        kind: 'screen',
        path: after.sourcePath,
        bytes: after.rawBytes,
      });
      const post = await deadline.run('API and SQL after action ' + ordinal, (signal) =>
        input.selection.readPostActionEvidence({
          ordinal,
          actionId: action.id,
          requestId: result!.requestId,
          signal,
        }),
      );
      requireCommonEvidence(
        post.api,
        'action-api',
        input.expectation,
        'action API',
        expectedArtifactRoot,
      );
      requireEnvelopeIdentity(post.api.identity, post.api, 'action API');
      assert(
        post.api.capturedAtMonotonicMs >= lastEnvelopeTimestamp &&
          post.sql.capturedAtMonotonicMs >= post.api.capturedAtMonotonicMs,
        'post-action evidence timestamps are out of order',
      );
      lastEnvelopeTimestamp = post.sql.capturedAtMonotonicMs;
      requireCommonEvidence(
        post.sql,
        'action-sql',
        input.expectation,
        'action SQL',
        expectedArtifactRoot,
      );
      requireEnvelopeIdentity(post.sql.identity, post.sql, 'action SQL');
      assert(
        post.api.identity.actionOrdinal === ordinal &&
          post.api.identity.requestId === result.requestId,
        'API request binding differs',
      );
      assert(
        post.sql.identity.actionOrdinal === ordinal &&
          post.sql.identity.requestId === result.requestId,
        'SQL request binding differs',
      );
      row.evidence.api = await writeEvidence(ordinal + '-api', post.api);
      row.evidence.sql = await writeEvidence(ordinal + '-sql', post.sql);
    } catch (error) {
      actionError = errorText(error);
      outcome =
        deadline.reason === 'cancelled' || input.signal?.aborted
          ? 'cancelled'
          : result?.status === 'failed'
            ? 'failed'
            : 'blocked';
    } finally {
      try {
        policy.finishAction(permit, outcome);
      } catch (error) {
        actionError = actionError ? actionError + '; ' + errorText(error) : errorText(error);
        outcome = 'blocked';
      }
      row.result.status = outcome;
      row.result.error = actionError;
      await appendAttempt(row);
    }
    if (outcome === 'cancelled') {
      actionCancelled = true;
      status = 'cancelled';
      stopReason = deadline.reason || 'cancelled';
      reason = reason || stopReason;
      return { continueExploration: false, completedSuccessfully: false };
    }
    if (deadline.reason) {
      stopReason = deadline.reason;
      reason = reason || stopReason;
      return { continueExploration: false, completedSuccessfully: false };
    }
    const snapshot = policy.snapshot();
    if (snapshot.stopReason) {
      stopReason = snapshot.stopReason;
      reason = reason || snapshot.stopReason;
      return { continueExploration: false, completedSuccessfully: false };
    }
    if (!after) reason = reason || 'UI action completed without a post-action observation';
    currentObservation = after || before;
    if (ledgerPublicationFailure)
      return { continueExploration: false, completedSuccessfully: false };
    return {
      continueExploration: true,
      completedSuccessfully:
        outcome === 'passed' && row.result.appliedUiActionCount === 1 && after !== null,
    };
  };

  try {
    await readSelection();
    deadline.throwIfBlocked('connector start');
    connectorStartAttempted = true;
    const started = await deadline.run('connector start', (signal) =>
      input.connector.start(signal),
    );
    lastEnvelopeTimestamp = requireRunEnvelope(
      started,
      input.expectation,
      'connector start',
      lastEnvelopeTimestamp,
    );
    requireEnvelopeIdentity(started.identity, started, 'connector start');
    requireConnectorIdentity(started.identity, input.expectation);
    requireCommonEvidence(
      started.source,
      'tool',
      input.expectation,
      'connector start source',
      expectedArtifactRoot,
    );
    requireEnvelopeIdentity(started.source.identity, started, 'connector start source');
    connectorStarted = true;
    selectionRefs.connectorStart = await writeEvidence('connector-start', started.source);
    const selected = await deadline.run('target selection', (signal) =>
      input.connector.selectTarget({
        targetId: input.expectation.targetId,
        selector: input.expectation.selector,
        appIdOrOrigin: input.expectation.appIdOrOrigin,
        binarySha256: input.expectation.binarySha256,
        signal,
      }),
    );
    lastEnvelopeTimestamp = requireRunEnvelope(
      selected,
      input.expectation,
      'target selection',
      lastEnvelopeTimestamp,
    );
    requireEnvelopeIdentity(selected.source.identity, selected, 'target selection source');
    assert(
      selected.kind === 'target-selection' &&
        selected.targetId === input.expectation.targetId &&
        selected.platform === input.expectation.platform &&
        selected.appIdOrOrigin === input.expectation.appIdOrOrigin &&
        selected.binarySha256 === input.expectation.binarySha256,
      'Connector selected a different target/build',
    );
    requireCommonEvidence(
      selected.source,
      'target-selection',
      input.expectation,
      'target selection source',
      expectedArtifactRoot,
    );
    requireEnvelopeIdentity(selected.source.identity, selected, 'target selection source');
    selectionRefs.targetSelection = await writeEvidence('target-selection', selected.source);
    currentObservation = await deadline.run('qualification observation', (signal) =>
      input.connector.observe({ targetId: input.expectation.targetId, signal }),
    );
    await requireObservation(
      currentObservation,
      input.expectation,
      'qualification observation',
      expectedArtifactRoot,
      lastEnvelopeTimestamp,
    );
    lastEnvelopeTimestamp = currentObservation.capturedAtMonotonicMs;
    const qualificationAction = requireBoundedAction(
      input.qualificationAction,
      connectorIdentity.kind,
      charter.allowedActions,
      'Qualification action',
    );
    const qualificationResult = await performAction(qualificationAction, currentObservation, 1);
    if (!qualificationResult.completedSuccessfully || !qualificationResult.continueExploration)
      throw new Error(reason || 'Qualification navigation did not complete successfully');
    const qualificationStopReason = policy.snapshot().stopReason;
    if (qualificationStopReason) throw new Error(qualificationStopReason);
    explorationStarted = true;
    explorationStatus = 'observed';
    let ordinal = 2;
    for (;;) {
      deadline.throwIfBlocked('next exploration action');
      const decision = await deadline.run('choose action ' + ordinal, (signal) =>
        input.chooser({ observation: currentObservation!, charter, history: rows, signal }),
      );
      if (decision === null) {
        status = explorationStarted ? 'explored' : 'blocked';
        break;
      }
      const action = requireBoundedAction(decision, connectorIdentity.kind, charter.allowedActions);
      const before = currentObservation;
      assert(before, 'Current observation is missing');
      const actionResult = await performAction(action, before, ordinal);
      if (!actionResult.continueExploration) break;
      ordinal += 1;
      if (ordinal > EXPLORATION_MAX_UI_ACTIONS + 1) break;
    }
  } catch (error) {
    reason = reason || errorText(error);
    stopReason = stopReason || deadline.reason;
    if (deadline.reason === 'cancelled' || input.signal?.aborted || actionCancelled)
      status = 'cancelled';
    else status = 'blocked';
  } finally {
    const drainedBeforeShutdown = await fence.drain(cleanupTimeoutMs);
    if (!drainedBeforeShutdown) {
      recoveryNotVerified = true;
      status = status === 'cancelled' ? status : 'blocked';
      reason = reason
        ? reason + '; in-flight operation did not settle before shutdown'
        : 'in-flight operation did not settle before shutdown';
    }
    let shutdown: ConnectorShutdownReceipt = {
      kind: 'connector-shutdown',
      runId: input.expectation.requestedRunId,
      attemptId: input.expectation.requestedAttemptId,
      status: connectorStartAttempted ? 'unknown' : 'closed',
      capturedAtMonotonicMs: monotonic(now(), 'shutdown timestamp'),
    };
    if (connectorStartAttempted && drainedBeforeShutdown) {
      const result = await boundedIndependent(
        'connector shutdown',
        (signal) =>
          input.connector.close(signal, {
            deadlineAtMonotonicMs: deadline.deadlineAt,
            recoveryDeadlineAtMonotonicMs: monotonic(
              now() + cleanupTimeoutMs,
              'cleanup recovery deadline',
            ),
            ownerSignal: deadline.signal,
          }),
        cleanupTimeoutMs,
        fence,
      );
      if (result.completed) shutdown = result.value;
      else {
        shutdown = { ...shutdown, status: 'unknown', errorCode: 'shutdown-timeout' };
        reason = reason ? reason + '; ' + result.error : result.error;
      }
      try {
        assert(shutdown.kind === 'connector-shutdown', 'Connector shutdown kind is invalid');
        const shutdownTimestamp = monotonic(
          shutdown.capturedAtMonotonicMs,
          'Connector shutdown timestamp',
        );
        assert(
          shutdownTimestamp >= lastEnvelopeTimestamp,
          'Connector shutdown timestamp precedes the prior owned event',
        );
        lastEnvelopeTimestamp = shutdownTimestamp;
        if (shutdown.errorCode !== undefined)
          safeId(shutdown.errorCode, 'Connector shutdown error code');
        if (!shutdown.source) throw new Error('Connector shutdown source is missing');
        assert(
          shutdown.source.kind === 'cleanup' || shutdown.source.kind === 'tool',
          'Connector shutdown source kind is invalid',
        );
      } catch (error) {
        status = 'blocked';
        reason = reason
          ? reason + '; shutdown receipt: ' + errorText(error)
          : 'shutdown receipt: ' + errorText(error);
      }
      if (shutdown.source) {
        try {
          requireCommonEvidence(
            shutdown.source,
            shutdown.source.kind,
            input.expectation,
            'connector shutdown source',
          );
          requireEnvelopeIdentity(shutdown.source.identity, shutdown, 'connector shutdown source');
          shutdownReference = await writeEvidence('connector-shutdown', shutdown.source);
          selectionRefs.connectorShutdown = shutdownReference;
        } catch (error) {
          status = 'blocked';
          reason = reason
            ? reason + '; shutdown evidence: ' + errorText(error)
            : 'shutdown evidence: ' + errorText(error);
        }
      }
      if (shutdown.status !== 'closed') {
        status = 'blocked';
        reason = reason
          ? reason + '; connector shutdown ' + shutdown.status
          : 'connector shutdown ' + shutdown.status;
      }
    } else if (connectorStartAttempted) {
      shutdown = { ...shutdown, status: 'unknown', errorCode: 'in-flight-before-shutdown' };
      status = status === 'cancelled' ? status : 'blocked';
    }
    const drainedAfterShutdown = await fence.drain(cleanupTimeoutMs);
    if (!drainedAfterShutdown) {
      recoveryNotVerified = true;
      status = status === 'cancelled' ? status : 'blocked';
      reason = reason
        ? reason + '; shutdown operation did not settle'
        : 'shutdown operation did not settle';
    }
    const auditResult = await boundedIndependent(
      'independent cleanup audit',
      (signal) => input.cleanup.audit({ connectorStartAttempted, signal }),
      cleanupTimeoutMs,
      fence,
    );
    if (auditResult.completed) {
      try {
        cleanup = requireCleanupAudit(auditResult.value, input.expectation);
        assert(
          cleanup.capturedAtMonotonicMs >= lastEnvelopeTimestamp,
          'Cleanup timestamp precedes the prior owned event',
        );
        lastEnvelopeTimestamp = cleanup.capturedAtMonotonicMs;
        selectionRefs.cleanup = await writeEvidence('cleanup', cleanup.source);
        if (cleanup.recoverySource)
          selectionRefs.cleanupRecovery = await writeEvidence(
            'cleanup-recovery',
            cleanup.recoverySource,
          );
        if (cleanup.status !== 'cleaned') {
          cleanupFailureLatched = true;
          recoveryNotVerified = true;
          status = 'blocked';
          reason = reason ? reason + '; cleanup ' + cleanup.status : 'cleanup ' + cleanup.status;
        }
      } catch (error) {
        cleanupFailureLatched = true;
        recoveryNotVerified = true;
        status = 'blocked';
        reason = reason
          ? reason + '; cleanup evidence: ' + errorText(error)
          : 'cleanup evidence: ' + errorText(error);
      }
    } else {
      cleanupFailureLatched = true;
      recoveryNotVerified = true;
      status = 'blocked';
      reason = reason ? reason + '; ' + auditResult.error : auditResult.error;
    }
    const drainedAfterCleanup = await fence.drain(cleanupTimeoutMs);
    if (!drainedAfterCleanup || fence.size > 0) {
      recoveryNotVerified = true;
      status = status === 'cancelled' ? status : 'blocked';
      reason = reason
        ? reason + '; cleanup left unsettled owned work'
        : 'cleanup left unsettled owned work';
    }
    if (deadline.reason === 'cancelled' || input.signal?.aborted) {
      status = 'cancelled';
      stopReason = stopReason || 'cancelled';
    } else if (deadline.reason === 'duration-limit') {
      status = 'blocked';
      stopReason = stopReason || 'duration-limit';
    }
    if (!cleanup || cleanup.status !== 'cleaned')
      status = status === 'cancelled' ? status : 'blocked';
    if (rows.length === 0 && status === 'explored') status = 'blocked';
    const snapshot = policy.snapshot();
    const result: T16BExecutionResult = {
      schema: T16B_OWNED_EXECUTION_SCHEMA,
      status,
      explorationStatus: explorationStarted ? explorationStatus : 'not-run',
      qualification: 'pending',
      runtimePassingCases: 0,
      requestedRunId: input.expectation.requestedRunId,
      requestedAttemptId: input.expectation.requestedAttemptId,
      actionAttempts: rows,
      selectionEvidence: selectionRefs,
      connector: connectorStarted ? connectorIdentity : null,
      cleanup,
      publicationEligible: false,
      recoveryNotVerified,
      inFlightOperations: fence.size,
      finalEvidence,
      stopReason: stopReason || snapshot.stopReason,
      reason,
      budget: {
        issuedActions: snapshot.issuedActions,
        settledActions: snapshot.settledActions,
        inFlight: snapshot.inFlight,
      },
      attemptCounts: countAttempts(rows, recoveryNotVerified),
    };
    const readyForPublication = await fence.drain(cleanupTimeoutMs);
    if (
      ledgerPublicationFailure ||
      cleanupFailureLatched ||
      !cleanup ||
      cleanup.status !== 'cleaned' ||
      recoveryNotVerified ||
      fence.hasLatchedFailure ||
      !readyForPublication ||
      fence.size > 0
    ) {
      recoveryNotVerified = true;
      result.status = result.status === 'cancelled' ? result.status : 'blocked';
      result.reason = result.reason
        ? result.reason + '; final publication skipped after an owned publication failure'
        : 'final publication skipped after an owned publication failure';
    } else {
      const publication = await boundedIndependent(
        'final private publication',
        (signal) =>
          input.writer.finalize(
            {
              receipt: {
                ...receiptView(result, shutdown, shutdownReference),
              },
              coverage: coverage(charter, result),
              exploration:
                '# T16-B exploration execution\n\nStatus: ' +
                status +
                '\n\nQualification remains pending; runtimePassingCases is 0.\n',
              bugs: '# Bugs\n\nNo product finding is promoted by this source-only controller.\n',
              docChanges:
                '# Documentation changes\n\nNo product or documentation behavior changed.\n',
            },
            signal,
          ),
        cleanupTimeoutMs,
        fence,
        [deadline.signal],
      );
      if (publication.completed) pendingPublication = publication.value;
      else {
        recoveryNotVerified = true;
        result.status = result.status === 'cancelled' ? result.status : 'blocked';
        result.reason = result.reason
          ? result.reason + '; final artifact: ' + publication.error
          : 'final artifact: ' + publication.error;
      }
    }
    const readyForClose = await fence.drain(cleanupTimeoutMs);
    if (!readyForClose || fence.size > 0) {
      recoveryNotVerified = true;
      result.status = result.status === 'cancelled' ? result.status : 'blocked';
      result.reason = result.reason
        ? result.reason + '; writer close skipped while owned writes were unsettled'
        : 'writer close skipped while owned writes were unsettled';
    } else {
      const closeResult = await boundedIndependent(
        'private writer close',
        () => input.writer.close(),
        cleanupTimeoutMs,
        fence,
      );
      if (!closeResult.completed) {
        recoveryNotVerified = true;
        result.status = result.status === 'cancelled' ? result.status : 'blocked';
        result.reason = result.reason
          ? result.reason + '; writer close: ' + closeResult.error
          : 'writer close: ' + closeResult.error;
      } else if (pendingPublication) {
        const completion = await boundedIndependent(
          'private publication completion',
          (signal) => input.writer.completePublication(signal),
          cleanupTimeoutMs,
          fence,
          [deadline.signal],
        );
        if (completion.completed) {
          publicationCommitted = true;
          finalEvidence = { ...pendingPublication, marker: completion.value };
        } else {
          recoveryNotVerified = true;
          result.status = result.status === 'cancelled' ? result.status : 'blocked';
          result.reason = result.reason
            ? result.reason + '; publication completion: ' + completion.error
            : 'publication completion: ' + completion.error;
        }
      }
    }
    if (!publicationCommitted) {
      const finalDrain = await fence.drain(cleanupTimeoutMs);
      if (!finalDrain || fence.size > 0) {
        recoveryNotVerified = true;
        result.status = result.status === 'cancelled' ? result.status : 'blocked';
        result.reason = result.reason
          ? result.reason + '; finalization left in-flight work'
          : 'finalization left in-flight work';
      }
    }
    result.publicationEligible = false;
    result.recoveryNotVerified = publicationCommitted ? false : recoveryNotVerified;
    result.inFlightOperations = fence.size;
    result.finalEvidence = finalEvidence;
    result.attemptCounts = countAttempts(rows, recoveryNotVerified);
    deadline.dispose();
    return result;
  }
}

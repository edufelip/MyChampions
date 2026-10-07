import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open as openFile, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  readNativeComparisonReceipts,
  validateNativeComparisonSpec,
  type NativeComparisonAttemptExpectation,
  type NativeComparisonColdAttemptIdentity,
  type NativeComparisonOwnershipWindow,
  type NativeComparisonReceiptInput,
  type NativeComparisonSpec,
} from './compare-native-pilot';
import {
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotArguments,
  type NativePilotSelection,
} from './native-pilot-contract';
import {
  formatNativePilotInvocationArguments,
  nativePilotRunIdPattern,
  type NativePilotColdResetBinding,
  type NativePilotInvocation,
} from './native-pilot-invocation';
import {
  readNativeEvidenceObservation,
  type NativeEvidenceObservation,
} from './native-view-evidence';
import { executeOwnedNativeCommand, type NativeCommandExecution } from './owned-native-command';
import { createT15AndroidMaestroFamilyAttemptRunner } from './t15-cold-android-maestro-family-attempt';
import { createT15AndroidMaestroPublicConsumer } from './t15-cold-android-maestro-public-consumer';
import {
  runNativeComparisonCohort,
  type ColdComparisonAttemptInvocation,
  type ColdComparisonAttemptReceipt,
  type ColdComparisonOwnedAttemptInvocation,
  type ColdComparisonResetProducer,
  type CohortBuildReuse,
  type FreshColdReset,
  type NativeComparisonDispatchReport,
} from './t15-cold-dispatcher';
import { createT15IosFamilyAttemptRunner } from './t15-cold-ios-family-attempt';
import {
  createT15PlatformEngineAwareOwnedLifecycleProducer,
  createT15OwnedPublicConsumer,
} from './t15-cold-owned-lifecycle';

const sha256 = /^[a-f0-9]{64}$/;
const attemptId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const maxText = 256;
const maxObservationBytes = 8 * 1024 * 1024;
const runnerScript = 'scripts/testing/run-native-pilot.mjs';
const identityMapFile = 't15-logical-native-identity-map.private.json';
const identityMapSeed = 't15-cold-production-v6';

export type T15ProductionIssue =
  | 'cancelled-before-acquisition'
  | 'cancelled-during-runner'
  | 'cold-reset-driver-unwired'
  | 'cold-reset-rejected'
  | 'android-build-reuse-unqualified'
  | 'unsupported-engine'
  | 'unsupported-mode'
  | 'unsupported-scenario'
  | 'runner-command-rejected'
  | 'runner-identity-incompatible'
  | 'runner-failed'
  | 'runner-receipt-unavailable'
  | 'runner-receipt-unbound'
  | 'runtime-link-unavailable'
  | 'ownership-sidecar-unavailable'
  | 'ownership-sidecar-invalid'
  | 'owned-port-ledger-unavailable'
  | 'cleanup-not-proven'
  | 'terminal-evidence-write-failed'
  | 'reset-manifest-unavailable'
  | 'terminal-receipt-blocked'
  | 'terminal-receipt-mismatch';

export type T15ProductionRunOptions = {
  repositoryRoot: string;
  /** Private 0700 root for this wrapper's sidecars, never a public receipt root. */
  outputRoot: string;
  spec: NativeComparisonSpec;
  buildReuse: CohortBuildReuse;
  signal?: AbortSignal;
  resetDriver?: T15ColdResetDriver;
  /** Keep a production reset driver on the native 24-hex identity. The
   * logical map remains available for legacy protected manifests/tests. */
  resetDriverIdentity?: 'native' | 'logical';
  /** A protected manifest of real reset rows produced by an owned runtime. */
  resetManifestPath?: string;
  attemptDeadlineMs?: number;
  execute?: T15CommandExecutor;
  readOwnershipSidecar?: T15OwnershipSidecarReader;
  /** One owner may provide reset, scenario, original receipt and cleanup. */
  ownedAttempt?: T15OwnedAttemptExecutor;
};

export type T15ColdResetDriver = (input: {
  repositoryRoot: string;
  outputRoot: string;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  cohort: NativeComparisonSpec['cohort'];
  signal: AbortSignal;
  reusableBuild: ColdComparisonAttemptInvocation['reusableBuild'];
  /** One monotonic deadline owned by the outer attempt; drivers must not renew it. */
  deadlineAtMonotonicMs: number;
}) => Promise<FreshColdReset>;

export type T15CommandExecutor = (options: {
  command: string;
  argv: string[];
  artifactRoot: string;
  label: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdoutPath: string;
  deadlineMs: number;
  phase: 'step';
  signal: AbortSignal;
}) => Promise<NativeCommandExecution>;

export type T15OwnershipSidecar = {
  schemaVersion: 1;
  kind: 'private t15 original ownership sidecar';
  ownerRunId: string;
  attemptId: string;
  captureRunId: string;
  runner: {
    pid: number;
    startIdentity: string;
    ownershipPath: string;
    ownershipHash: string;
  };
  process: {
    pid: number;
    startIdentity: string;
    acquiredAt: string;
    releasedAt: string;
  };
  ports: {
    port: number;
    acquiredAt: string;
    releasedAt: string;
  }[];
  cleanup: {
    status: 'cleaned' | 'failed-recovery-ledger-retained' | 'not-acquired';
    receiptPath: string;
    receiptHash: string;
  };
};

export type T15OwnershipSidecarRead = {
  value: T15OwnershipSidecar;
  path: string;
  observation: NativeEvidenceObservation;
};

export type T15OwnershipSidecarReader = (input: {
  artifactRoot: string;
  expected: NativeComparisonAttemptExpectation;
}) => Promise<T15OwnershipSidecarRead | null>;

export type T15RunnerIdentity = {
  pid: number;
  startIdentity: string;
  ownershipPath: string;
  ownershipHash: string;
};

export type T15ProductionAttemptResult = ColdComparisonAttemptReceipt & {
  issue: string | null;
  runtime: T15RuntimeFacts;
  evidencePath: string | null;
};

export type T15RuntimeFacts = {
  outerExecution: NativeCommandExecution;
  runtimeLinkPath: string | null;
  publicReceiptPath: string | null;
  captureRunId: string | null;
  publicRunId: string | null;
  publicAttemptId: string | null;
  sidecarPath: string | null;
  resetReceiptPath: string | null;
};

type T15RuntimeLink = {
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  callbackInvocations: number;
  callbackCompleted: boolean;
};

type T15RuntimeLinkRead = {
  value: T15RuntimeLink;
  path: string;
  observation: NativeEvidenceObservation;
};

export type T15ProductionAttemptExecutor = (
  input: ColdComparisonAttemptInvocation,
) => Promise<T15ProductionAttemptResult>;

export type T15OwnedAttemptExecutor = (
  input: ColdComparisonOwnedAttemptInvocation,
) => Promise<ColdComparisonAttemptReceipt>;

/**
 * The comparison collector keeps the reviewed logical attempt IDs. The native
 * pilot CLI has a narrower 24-lowercase-hex boundary, so this protected map
 * binds both identities before the first child is acquired.
 */
export type T15IdentityMapEntry = {
  logicalCellKey: string;
  logicalRunId: string;
  logicalAttemptId: string;
  nativeRunId: string;
  nativeAttemptId: string;
  scenarioId: string;
  platform: 'ios' | 'android';
  engine: 'maestro' | 'detox';
  mode: NativeComparisonSpec['cells'][number]['mode'];
  locale: 'en-US' | 'pt-BR' | 'es-ES';
  trialOrdinal: number;
  fixtureResetId: string;
};

export type T15IdentityMapDocument = {
  schemaVersion: 1;
  kind: 'private t15 logical-to-native identity map';
  specHash: string;
  mappingHash: string;
  entries: T15IdentityMapEntry[];
};

export type T15IdentityMapHandle = {
  path: string;
  document: T15IdentityMapDocument;
  byLogicalAttemptId: Map<string, T15IdentityMapEntry>;
  byNativeAttemptId: Map<string, T15IdentityMapEntry>;
  byNativeRunId: Map<string, T15IdentityMapEntry>;
};

export type T15MappedDispatchReport = NativeComparisonDispatchReport & {
  t15IdentityMapPath: string;
  t15IdentityMapHash: string;
  logicalAttemptCount: number;
  logicalPhysicalAttemptOrder: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max = maxText): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function iso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function digest(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function identityMapSpecHash(spec: NativeComparisonSpec): string {
  return digest(JSON.stringify(spec));
}

function logicalCellKey(cell: NativeComparisonSpec['cells'][number]): string {
  return JSON.stringify([cell.scenarioId, cell.platform, cell.engine, cell.mode, cell.locale]);
}

function nativeRunIdForLogicalRun(specHash: string, logicalRunId: string): string {
  return digest(`${identityMapSeed}\u0000${specHash}\u0000${logicalRunId}`).slice(0, 24);
}

function identityMapHash(entries: T15IdentityMapEntry[]): string {
  return digest(JSON.stringify(entries));
}

function buildIdentityMapDocument(spec: NativeComparisonSpec): T15IdentityMapDocument {
  const specHash = identityMapSpecHash(spec);
  const entries: T15IdentityMapEntry[] = [];
  const logicalRuns = new Set<string>();
  const nativeRuns = new Set<string>();
  for (const cell of spec.cells) {
    const cellKey = logicalCellKey(cell);
    for (const expected of cell.expectedAttempts) {
      if (logicalRuns.has(expected.runId))
        throw new Error(`T15 logical run ID is duplicated: ${expected.runId}`);
      logicalRuns.add(expected.runId);
      const nativeRunId = nativeRunIdForLogicalRun(specHash, expected.runId);
      if (nativeRuns.has(nativeRunId))
        throw new Error(`T15 logical-to-native run ID collision: ${expected.runId}`);
      nativeRuns.add(nativeRunId);
      entries.push({
        logicalCellKey: cellKey,
        logicalRunId: expected.runId,
        logicalAttemptId: expected.attemptId,
        nativeRunId,
        nativeAttemptId: `${nativeRunId}:first`,
        scenarioId: cell.scenarioId,
        platform: cell.platform,
        engine: cell.engine,
        mode: cell.mode,
        locale: cell.locale,
        trialOrdinal: expected.trialOrdinal,
        fixtureResetId: expected.fixtureResetId,
      });
    }
  }
  return {
    schemaVersion: 1,
    kind: 'private t15 logical-to-native identity map',
    specHash,
    mappingHash: identityMapHash(entries),
    entries,
  };
}

export function buildT15IdentityMap(spec: NativeComparisonSpec): T15IdentityMapDocument {
  return buildIdentityMapDocument(spec);
}

function indexIdentityMap(
  pathName: string,
  document: T15IdentityMapDocument,
): T15IdentityMapHandle {
  const byLogicalAttemptId = new Map<string, T15IdentityMapEntry>();
  const byNativeAttemptId = new Map<string, T15IdentityMapEntry>();
  const byNativeRunId = new Map<string, T15IdentityMapEntry>();
  for (const entry of document.entries) {
    if (
      byLogicalAttemptId.has(entry.logicalAttemptId) ||
      byNativeAttemptId.has(entry.nativeAttemptId) ||
      byNativeRunId.has(entry.nativeRunId)
    )
      throw new Error('T15 identity map contains duplicate identity rows');
    byLogicalAttemptId.set(entry.logicalAttemptId, entry);
    byNativeAttemptId.set(entry.nativeAttemptId, entry);
    byNativeRunId.set(entry.nativeRunId, entry);
  }
  return {
    path: pathName,
    document,
    byLogicalAttemptId,
    byNativeAttemptId,
    byNativeRunId,
  };
}

function requireIdentityMapDocument(
  value: unknown,
  expected: T15IdentityMapDocument,
): T15IdentityMapDocument {
  if (!isRecord(value)) throw new Error('T15 identity map is not an object');
  if (
    value.schemaVersion !== 1 ||
    value.kind !== 'private t15 logical-to-native identity map' ||
    value.specHash !== expected.specHash ||
    value.mappingHash !== expected.mappingHash ||
    !Array.isArray(value.entries) ||
    JSON.stringify(value.entries) !== JSON.stringify(expected.entries)
  )
    throw new Error('T15 identity map does not match the reviewed spec');
  return expected;
}

async function loadOrCreateIdentityMap(
  outputRoot: string,
  spec: NativeComparisonSpec,
): Promise<T15IdentityMapHandle> {
  const pathName = path.join(outputRoot, identityMapFile);
  const expected = buildIdentityMapDocument(spec);
  let exists = false;
  try {
    await lstat(pathName);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (exists) {
    const existing = await readProtectedJsonFile(pathName, 'T15 logical-to-native identity map');
    return indexIdentityMap(pathName, requireIdentityMapDocument(existing, expected));
  }
  try {
    await writeProtectedJsonFile(pathName, expected, 'T15 logical-to-native identity map');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readProtectedJsonFile(pathName, 'T15 logical-to-native identity map');
    return indexIdentityMap(pathName, requireIdentityMapDocument(existing, expected));
  }
  return indexIdentityMap(pathName, expected);
}

export async function ensureT15IdentityMap(
  outputRoot: string,
  spec: NativeComparisonSpec,
): Promise<T15IdentityMapHandle> {
  return loadOrCreateIdentityMap(outputRoot, spec);
}

function logicalExpectationForNative(
  expected: NativeComparisonAttemptExpectation,
  identityMap: T15IdentityMapHandle,
): NativeComparisonAttemptExpectation {
  const entry = identityMap.byNativeAttemptId.get(expected.attemptId);
  if (!entry || entry.nativeRunId !== expected.runId)
    throw new Error('T15 native attempt is absent from the protected identity map');
  return {
    ...expected,
    runId: entry.logicalRunId,
    attemptId: entry.logicalAttemptId,
    coldAttemptIdentity: {
      ...expected.coldAttemptIdentity,
      ownerRunId: entry.logicalRunId,
    },
  };
}

function rebindResetToNative(
  reset: FreshColdReset,
  expected: NativeComparisonAttemptExpectation,
): FreshColdReset {
  return { ...reset, ownerRunId: expected.runId };
}

export function mapT15SpecToNative(
  spec: NativeComparisonSpec,
  identityMap: T15IdentityMapDocument,
): NativeComparisonSpec {
  if (identityMap.specHash !== identityMapSpecHash(spec))
    throw new Error('T15 identity map spec hash does not match the input spec');
  const entries = new Map(identityMap.entries.map((entry) => [entry.logicalAttemptId, entry]));
  const cells = spec.cells.map((cell) => ({
    ...cell,
    expectedAttempts: cell.expectedAttempts.map((expected) => {
      const entry = entries.get(expected.attemptId);
      if (!entry) throw new Error('T15 identity map lacks a logical attempt');
      return {
        ...expected,
        runId: entry.nativeRunId,
        attemptId: entry.nativeAttemptId,
        coldAttemptIdentity: {
          ...expected.coldAttemptIdentity,
          ownerRunId: entry.nativeRunId,
        },
      };
    }),
  }));
  const executionOrder = spec.executionOrder.map((pair) => ({
    ...pair,
    trials: pair.trials.map((trial) => {
      const first = entries.get(trial.firstAttemptId);
      const second = entries.get(trial.secondAttemptId);
      if (!first || !second) throw new Error('T15 identity map lacks an execution-order attempt');
      return {
        ...trial,
        firstAttemptId: first.nativeAttemptId,
        secondAttemptId: second.nativeAttemptId,
      };
    }),
  }));
  return validateNativeComparisonSpec({ ...spec, cells, executionOrder });
}

function blockedIdentity(ownerRunId: string): NativeComparisonColdAttemptIdentity {
  return {
    ownerRunId,
    processPid: null,
    processStartIdentity: null,
    ownedPorts: [],
    ownershipWindows: [],
    originalReceiptBinding: {
      status: 'pending',
      receiptPath: null,
      artifactRoot: null,
      receiptHash: null,
    },
  };
}

function blockedReset(
  expected: NativeComparisonAttemptExpectation,
  blocker: T15ProductionIssue,
): FreshColdReset {
  return {
    fixtureResetId: expected.fixtureResetId,
    ownerRunId: expected.runId,
    cohortFixtureFingerprint: expected.inputs.fixtureHash ?? 'unknown',
    status: 'blocked',
    startedAt: new Date(0).toISOString(),
    finishedAt: null,
    appStateFingerprint: null,
    fixtureStateFingerprint: null,
    sourceFingerprint: null,
    helperFingerprint: null,
    originalResetBinding: {
      status: 'pending',
      receiptPath: null,
      artifactRoot: null,
      receiptHash: null,
    },
    cleanupStatus: 'not-acquired',
    blocker,
  };
}

function blockedAttempt(
  input: ColdComparisonAttemptInvocation,
  issue: string,
  status: 'harness-blocked' | 'cancelled' = 'harness-blocked',
  runtime?: Partial<T15RuntimeFacts>,
  receipt: NativeComparisonReceiptInput | null = null,
): T15ProductionAttemptResult {
  return {
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    status,
    ownerRunId: input.expected.runId,
    coldAttemptIdentity: blockedIdentity(input.expected.runId),
    reset: input.reset,
    receipt,
    issue,
    runtime: {
      outerExecution: {
        phase: 'step',
        execution: status === 'cancelled' ? 'cancelled' : 'harness-blocked',
        cleanup: 'not-acquired',
        childExitCode: null,
        childSignal: null,
        pid: null,
        pgid: null,
        logPath: null,
        stdoutPath: null,
        ownershipPath: null,
        elapsedMs: 0,
        cleanupMs: 0,
      },
      runtimeLinkPath: null,
      publicReceiptPath: null,
      captureRunId: null,
      publicRunId: null,
      publicAttemptId: null,
      sidecarPath: null,
      resetReceiptPath: input.reset.originalResetBinding.receiptPath,
      ...runtime,
    },
    evidencePath: null,
  };
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function requirePrivateDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory)) throw new Error('T15 output root must be absolute');
  const canonical = await realpath(directory);
  const stat = await lstat(canonical);
  if (
    canonical !== path.resolve(directory) ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error('T15 output root must be canonical, owned and 0700');
  return canonical;
}

async function makeAttemptRoot(outputRoot: string, attempt: string): Promise<string> {
  const suffix = `${digest(attempt)}-${randomBytes(8).toString('hex')}`;
  const root = path.join(outputRoot, `attempt-${suffix}`);
  await mkdir(root, { mode: 0o700 });
  const canonical = await realpath(root);
  const stat = await lstat(canonical);
  if (canonical !== root || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700)
    throw new Error('T15 attempt root is not private and canonical');
  return canonical;
}

function validResetForExpected(
  reset: FreshColdReset,
  expected: NativeComparisonAttemptExpectation,
): boolean {
  return (
    reset.fixtureResetId === expected.fixtureResetId &&
    reset.ownerRunId === expected.runId &&
    reset.status === 'fresh' &&
    reset.cleanupStatus === 'cleaned' &&
    reset.blocker === null &&
    reset.finishedAt !== null &&
    iso(reset.startedAt) &&
    iso(reset.finishedAt) &&
    sha256.test(reset.cohortFixtureFingerprint) &&
    sha256.test(reset.appStateFingerprint ?? '') &&
    sha256.test(reset.fixtureStateFingerprint ?? '') &&
    sha256.test(reset.sourceFingerprint ?? '') &&
    sha256.test(reset.helperFingerprint ?? '') &&
    isRecord(reset.target) &&
    isRecord(reset.backend) &&
    reset.originalResetBinding.status === 'verified' &&
    typeof reset.originalResetBinding.receiptPath === 'string' &&
    typeof reset.originalResetBinding.artifactRoot === 'string' &&
    sha256.test(reset.originalResetBinding.receiptHash ?? '')
  );
}

function validBlockedResetForExpected(
  reset: FreshColdReset,
  expected: NativeComparisonAttemptExpectation,
): boolean {
  return (
    reset.fixtureResetId === expected.fixtureResetId &&
    reset.ownerRunId === expected.runId &&
    reset.status === 'blocked' &&
    reset.cleanupStatus === 'not-acquired' &&
    typeof reset.blocker === 'string' &&
    reset.blocker.length > 0 &&
    reset.finishedAt === null &&
    reset.originalResetBinding.status === 'pending' &&
    reset.originalResetBinding.receiptPath === null &&
    reset.originalResetBinding.artifactRoot === null &&
    reset.originalResetBinding.receiptHash === null &&
    reset.target === undefined &&
    reset.backend === undefined
  );
}

function supportedPublicSelection(selection: NativePilotSelection): T15ProductionIssue | null {
  if (!['maestro', 'detox'].includes(selection.arguments.engine)) return 'unsupported-engine';
  if (selection.arguments.mode !== 'integration') return 'unsupported-mode';
  if (selection.scenario.platform !== selection.arguments.platform) return 'unsupported-scenario';
  if (!selection.scenario.id || !selection.scenario.flowId) return 'unsupported-scenario';
  return null;
}

function nativeResetBinding(
  reset: FreshColdReset,
  expected: NativeComparisonAttemptExpectation,
): NativePilotColdResetBinding {
  const binding = reset.originalResetBinding;
  if (
    binding.status !== 'verified' ||
    !binding.receiptPath ||
    !binding.artifactRoot ||
    !binding.receiptHash ||
    !binding.identity ||
    !reset.target ||
    !reset.backend
  )
    throw new Error(`T15 reset ${expected.attemptId} has no complete runner binding`);
  if (
    reset.fixtureResetId !== expected.fixtureResetId ||
    reset.ownerRunId !== expected.runId ||
    reset.cleanupStatus !== 'cleaned' ||
    reset.blocker !== null
  )
    throw new Error(`T15 reset ${expected.attemptId} is not a clean same-attempt binding`);
  return {
    artifactRoot: path.resolve(binding.artifactRoot),
    receiptPath: path.resolve(binding.receiptPath),
    receiptHash: binding.receiptHash,
    fixtureResetId: reset.fixtureResetId,
    ownerRunId: expected.runId,
    attemptId: expected.attemptId,
    cohortFixtureFingerprint: reset.cohortFixtureFingerprint,
    appStateFingerprint: reset.appStateFingerprint!,
    fixtureStateFingerprint: reset.fixtureStateFingerprint!,
    sourceFingerprint: reset.sourceFingerprint!,
    helperFingerprint: reset.helperFingerprint!,
    cleanupStatus: 'cleaned',
    target: { ...reset.target },
    backend: { ...reset.backend },
    sourceIdentity: { ...binding.identity },
  };
}

export function buildNativePilotInvocation(input: {
  repositoryRoot: string;
  selection: NativePilotSelection;
  expected: NativeComparisonAttemptExpectation;
  reset: FreshColdReset;
  outputParent: string;
}): { command: string; argv: string[]; cwd: string; scriptPath: string } {
  const root = path.resolve(input.repositoryRoot);
  const scriptPath = path.join(root, runnerScript);
  const { platform, engine, scenario, mode } = input.selection.arguments;
  if (!['ios', 'android'].includes(platform)) throw new Error('Unsupported public platform');
  if (!['maestro', 'detox'].includes(engine)) throw new Error('Unsupported public engine');
  if (!/^SCN-[A-Za-z0-9._-]+$/.test(scenario)) throw new Error('Unsupported public scenario');
  if (mode !== 'integration') throw new Error('T15 production requires integration mode');
  if (!nativePilotRunIdPattern.test(input.expected.runId))
    throw new Error(
      'T15 expected run ID is incompatible with the native pilot boundary; no identity remapping is permitted',
    );
  if (
    !path.isAbsolute(input.outputParent) ||
    path.normalize(input.outputParent) !== input.outputParent
  )
    throw new Error('T15 runner output parent must be absolute and normalized');
  const invocation: NativePilotInvocation = {
    selection: input.selection.arguments,
    requestedRunId: input.expected.runId,
    requestedAttemptId: input.expected.attemptId,
    outputParent: input.outputParent,
    coldResetBinding: nativeResetBinding(input.reset, input.expected),
  };
  return {
    command: process.execPath,
    argv: [scriptPath, ...formatNativePilotInvocationArguments(invocation)],
    cwd: root,
    scriptPath,
  };
}

function commandExecutor(): T15CommandExecutor {
  return (options) => executeOwnedNativeCommand(options);
}

function validateSidecar(
  sidecar: T15OwnershipSidecar,
  expected: NativeComparisonAttemptExpectation,
  outputRoot: string,
  runner: T15RunnerIdentity,
): T15OwnershipSidecar {
  if (
    sidecar.schemaVersion !== 1 ||
    sidecar.kind !== 'private t15 original ownership sidecar' ||
    sidecar.ownerRunId !== expected.runId ||
    sidecar.attemptId !== expected.attemptId ||
    !text(sidecar.captureRunId, 128) ||
    sidecar.runner.pid !== runner.pid ||
    sidecar.runner.startIdentity !== runner.startIdentity ||
    sidecar.runner.ownershipPath !== runner.ownershipPath ||
    sidecar.runner.ownershipHash !== runner.ownershipHash ||
    !Number.isSafeInteger(sidecar.process.pid) ||
    sidecar.process.pid <= 0 ||
    !text(sidecar.process.startIdentity) ||
    !iso(sidecar.process.acquiredAt) ||
    !iso(sidecar.process.releasedAt) ||
    Date.parse(sidecar.process.releasedAt) <= Date.parse(sidecar.process.acquiredAt) ||
    !Array.isArray(sidecar.ports) ||
    sidecar.ports.length === 0 ||
    sidecar.ports.some(
      (port) =>
        !Number.isSafeInteger(port.port) ||
        port.port <= 0 ||
        !iso(port.acquiredAt) ||
        !iso(port.releasedAt) ||
        Date.parse(port.releasedAt) <= Date.parse(port.acquiredAt),
    ) ||
    sidecar.cleanup.status !== 'cleaned' ||
    !path.isAbsolute(sidecar.cleanup.receiptPath) ||
    !sha256.test(sidecar.cleanup.receiptHash) ||
    !pathInside(outputRoot, path.resolve(sidecar.cleanup.receiptPath))
  )
    throw new Error(
      'T15 ownership sidecar is missing an independently verified process/port/cleanup fact',
    );
  return sidecar;
}

export function validateT15OwnershipSidecar(
  sidecar: T15OwnershipSidecar,
  expected: NativeComparisonAttemptExpectation,
  outputRoot: string,
  runner: T15RunnerIdentity,
): T15OwnershipSidecar {
  return validateSidecar(sidecar, expected, outputRoot, runner);
}

function readRunnerIdentity(execution: NativeCommandExecution): T15RunnerIdentity | null {
  const pid = execution.pid;
  if (
    typeof pid !== 'number' ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !execution.ownershipPath ||
    !path.isAbsolute(execution.ownershipPath)
  )
    return null;
  try {
    const file = path.resolve(execution.ownershipPath);
    const observation = readNativeEvidenceObservation(
      path.dirname(file),
      path.basename(file),
      true,
    );
    const value = JSON.parse(observation.bytes.toString('utf8')) as unknown;
    if (!isRecord(value) || !Array.isArray(value.processes)) return null;
    const processRows = value.processes as unknown[];
    const processRow = processRows.find((row: unknown) => isRecord(row) && row.pid === pid);
    const startIdentity = isRecord(processRow) ? text(processRow.started) : null;
    if (!startIdentity) return null;
    return {
      pid,
      startIdentity,
      ownershipPath: file,
      ownershipHash: digest(observation.bytes),
    };
  } catch {
    return null;
  }
}

function verifyCleanupReceipt(sidecar: T15OwnershipSidecar): void {
  const file = path.resolve(sidecar.cleanup.receiptPath);
  const observation = readNativeEvidenceObservation(path.dirname(file), path.basename(file), true);
  if (digest(observation.bytes) !== sidecar.cleanup.receiptHash)
    throw new Error('ownership sidecar cleanup receipt changed before binding');
}

function windowsFromSidecar(
  sidecar: T15OwnershipSidecar,
  expected: NativeComparisonAttemptExpectation,
): NativeComparisonOwnershipWindow[] {
  return [
    {
      resourceType: 'process',
      resourceId: String(sidecar.process.pid),
      ownerRunId: expected.runId,
      processStartIdentity: sidecar.process.startIdentity,
      acquiredAt: sidecar.process.acquiredAt,
      releasedAt: sidecar.process.releasedAt,
    },
    ...sidecar.ports.map((port) => ({
      resourceType: 'port' as const,
      resourceId: String(port.port),
      ownerRunId: expected.runId,
      processStartIdentity: null,
      acquiredAt: port.acquiredAt,
      releasedAt: port.releasedAt,
    })),
  ];
}

function publicReceiptIdentity(
  receipt: NativeComparisonReceiptInput,
  expected: NativeComparisonAttemptExpectation,
  sidecar: T15OwnershipSidecar,
): NativeComparisonColdAttemptIdentity {
  const process = sidecar.process;
  return {
    ownerRunId: expected.runId,
    processPid: process.pid,
    processStartIdentity: process.startIdentity,
    ownedPorts: sidecar.ports.map((port) => port.port),
    ownershipWindows: windowsFromSidecar(sidecar, expected),
    originalReceiptBinding: {
      status: 'verified',
      receiptPath: receipt.path,
      artifactRoot: receipt.artifactRoot,
      receiptHash: receipt.receiptHash,
    },
  };
}

function readRuntimeLink(artifactRoot: string): T15RuntimeLinkRead | null {
  try {
    const relative = 'runtime-link.private.json';
    const observation = readNativeEvidenceObservation(artifactRoot, relative, true);
    const value = JSON.parse(observation.bytes.toString('utf8')) as unknown;
    if (!isRecord(value)) return null;
    const requestedRunId = text(value.requestedRunId, 128);
    const requestedAttemptId = text(value.requestedAttemptId, 160);
    const captureRunId = text(value.captureRunId, 128);
    const callbackInvocations = value.callbackInvocations;
    const callbackCompleted = value.callbackCompleted;
    if (
      !requestedRunId ||
      !requestedAttemptId ||
      !captureRunId ||
      !Number.isSafeInteger(callbackInvocations) ||
      callbackInvocations !== 1 ||
      callbackCompleted !== true
    )
      return null;
    return {
      value: {
        requestedRunId,
        requestedAttemptId,
        captureRunId,
        callbackInvocations,
        callbackCompleted,
      },
      path: path.join(artifactRoot, relative),
      observation,
    };
  } catch {
    return null;
  }
}

function readDefaultOwnershipSidecar(input: {
  artifactRoot: string;
  expected: NativeComparisonAttemptExpectation;
}): Promise<T15OwnershipSidecarRead | null> {
  const relative = 'original-ownership.private.json';
  try {
    const observation = readNativeEvidenceObservation(input.artifactRoot, relative, true);
    const value = JSON.parse(observation.bytes.toString('utf8')) as unknown;
    if (!isRecord(value)) return Promise.resolve(null);
    return Promise.resolve({
      value: value as T15OwnershipSidecar,
      path: path.join(input.artifactRoot, relative),
      observation,
    });
  } catch {
    return Promise.resolve(null);
  }
}

async function ensurePrivateChildDirectory(root: string, name: string): Promise<string> {
  if (!/^[a-z0-9-]+$/u.test(name)) throw new Error('T15 private child name is unsafe');
  const candidate = path.join(root, name);
  await mkdir(candidate, { mode: 0o700, recursive: true });
  const canonical = await realpath(candidate);
  const stat = await lstat(canonical);
  if (
    canonical !== candidate ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  )
    throw new Error(`T15 private child ${name} is not canonical and owned`);
  return canonical;
}

async function readProtectedJsonFile(filePath: string, label: string): Promise<unknown> {
  const candidate = path.resolve(filePath);
  if (!path.isAbsolute(filePath) || path.normalize(filePath) !== filePath)
    throw new Error(`${label} must be an absolute normalized path`);
  const entry = await lstat(candidate);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1)
    throw new Error(`${label} must be a regular single-link file`);
  const canonical = await realpath(candidate);
  if (canonical !== candidate || (entry.mode & 0o777) !== 0o600)
    throw new Error(`${label} must be a private canonical 0600 file`);
  const observation = readNativeEvidenceObservation(
    path.dirname(candidate),
    path.basename(candidate),
    true,
  );
  if (observation.bytes.byteLength > maxObservationBytes)
    throw new Error(`${label} exceeds the bounded protected read`);
  try {
    return JSON.parse(observation.bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function writeProtectedJsonFile(
  filePath: string,
  value: unknown,
  label: string,
): Promise<void> {
  const candidate = path.resolve(filePath);
  if (!path.isAbsolute(filePath) || path.normalize(filePath) !== filePath)
    throw new Error(`${label} must be an absolute normalized path`);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (bytes.byteLength > maxObservationBytes)
    throw new Error(`${label} exceeds the bounded protected write`);
  let handle: Awaited<ReturnType<typeof openFile>> | undefined;
  try {
    handle = await openFile(candidate, 'wx', 0o600);
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      (typeof process.getuid === 'function' && opened.uid !== process.getuid()) ||
      (opened.mode & 0o777) !== 0o600
    )
      throw new Error(`${label} opened with unsafe ownership or mode`);
    await handle.writeFile(bytes);
    await handle.sync();
    const final = await lstat(candidate);
    if (
      !final.isFile() ||
      final.nlink !== 1 ||
      (typeof process.getuid === 'function' && final.uid !== process.getuid()) ||
      (final.mode & 0o777) !== 0o600 ||
      (await realpath(candidate)) !== candidate
    )
      throw new Error(`${label} changed before durable publication`);
    const readBack = readNativeEvidenceObservation(
      path.dirname(candidate),
      path.basename(candidate),
      true,
    );
    if (digest(readBack.bytes) !== digest(bytes))
      throw new Error(`${label} changed during durable publication`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

type T15ResetManifest = {
  schemaVersion: 1;
  kind: 'private t15 reset manifest';
  attempts: Record<string, FreshColdReset>;
};

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readT15ResetManifest(filePath: string): Promise<T15ResetManifest> {
  const row = await readProtectedJsonFile(filePath, 'T15 reset manifest');
  if (!isRecordValue(row) || row.schemaVersion !== 1 || row.kind !== 'private t15 reset manifest')
    throw new Error('T15 reset manifest has an unsupported schema');
  if (!isRecordValue(row.attempts)) throw new Error('T15 reset manifest attempts are missing');
  return {
    schemaVersion: 1,
    kind: 'private t15 reset manifest',
    attempts: row.attempts as Record<string, FreshColdReset>,
  };
}

/**
 * The default reset path consumes a receipt manifest produced by the owned
 * reset producer. It never manufactures a fresh row: absent, malformed or
 * foreign rows remain blocked before the native child is acquired.
 */
export function createT15ResetManifestProducer(options: {
  manifestPath: string;
}): T15ColdResetDriver {
  let manifestPromise: Promise<T15ResetManifest> | undefined;
  return async (input) => {
    if (input.signal.aborted) return blockedReset(input.expected, 'cancelled-before-acquisition');
    try {
      manifestPromise ??= readT15ResetManifest(options.manifestPath);
      const manifest = await manifestPromise;
      const row = manifest.attempts[input.expected.attemptId];
      if (!row) return blockedReset(input.expected, 'reset-manifest-unavailable');
      if (!validResetForExpected(row, input.expected))
        return blockedReset(input.expected, 'cold-reset-rejected');
      return structuredClone(row);
    } catch {
      return blockedReset(input.expected, 'reset-manifest-unavailable');
    }
  };
}

export function createT15ColdResetProducer(options: {
  repositoryRoot: string;
  outputRoot: string;
  driver?: T15ColdResetDriver;
  manifestPath?: string;
  identityMap?: T15IdentityMapHandle;
  driverIdentity?: 'native' | 'logical';
  attemptDeadlineMs?: number;
}): ColdComparisonResetProducer {
  const driver =
    options.driver ??
    (options.manifestPath
      ? createT15ResetManifestProducer({ manifestPath: options.manifestPath })
      : undefined);
  return async (input) => {
    if (input.signal.aborted) return blockedReset(input.expected, 'cancelled-before-acquisition');
    if (!driver) return blockedReset(input.expected, 'cold-reset-driver-unwired');
    const attemptDeadlineMs = options.attemptDeadlineMs ?? 600_000;
    if (!Number.isSafeInteger(attemptDeadlineMs) || attemptDeadlineMs < 100)
      return blockedReset(input.expected, 'cold-reset-rejected');
    const deadlineAtMonotonicMs = performance.now() + attemptDeadlineMs;
    let driverInput = input;
    if (options.identityMap && options.driverIdentity !== 'native') {
      driverInput = {
        ...input,
        expected: logicalExpectationForNative(input.expected, options.identityMap),
      };
    }
    try {
      const result = await driver({
        repositoryRoot: options.repositoryRoot,
        outputRoot: options.outputRoot,
        expected: driverInput.expected,
        selection: input.selection,
        cohort: input.spec.cohort,
        signal: input.signal,
        reusableBuild: input.reusableBuild,
        deadlineAtMonotonicMs,
      });
      if (
        result.status === 'blocked' &&
        (options.driverIdentity === 'native' || !options.identityMap) &&
        validBlockedResetForExpected(result, input.expected)
      )
        return structuredClone(result);
      if (!validResetForExpected(result, driverInput.expected))
        return blockedReset(input.expected, 'cold-reset-rejected');
      return options.identityMap ? rebindResetToNative(result, input.expected) : result;
    } catch {
      return blockedReset(input.expected, 'cold-reset-rejected');
    }
  };
}

export function createT15SelectionResolver(
  repositoryRoot: string,
  identityMap?: T15IdentityMapHandle,
) {
  return async (expected: NativeComparisonAttemptExpectation): Promise<NativePilotSelection> => {
    if (!attemptId.test(expected.attemptId)) throw new Error('T15 attempt identity is malformed');
    const logical = identityMap?.byNativeRunId.get(expected.runId);
    if (identityMap && (!logical || logical.nativeAttemptId !== expected.attemptId))
      throw new Error('T15 native attempt has no exact logical selection mapping');
    const logicalRunId = logical?.logicalRunId ?? expected.runId;
    const identity = logicalRunId.match(/^run-(.+)-(ios|android)-(maestro|detox)-\d+$/);
    const platform = identity?.[2];
    const engine = identity?.[3];
    const family = identity?.[1];
    if (platform !== 'ios' && platform !== 'android')
      throw new Error('T15 attempt does not expose a canonical platform');
    if (engine !== 'maestro' && engine !== 'detox')
      throw new Error('T15 attempt does not expose a canonical engine');
    if (!family) throw new Error('T15 attempt does not expose a canonical scenario family');
    const args: NativePilotArguments = {
      platform,
      engine,
      scenario: `SCN-${family}-${platform}`,
      mode: 'integration',
    };
    const inventory = JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ) as unknown;
    const selection = await selectNativePilotScenario(args, inventory, repositoryRoot);
    requireNativePilotAssertions(selection);
    if (
      selection.scenarioHash !== expected.inputs.scenarioHash ||
      selection.requirementHash !== expected.inputs.requirementHash
    )
      throw new Error('T15 selection does not match the expected source/requirement fingerprints');
    return selection;
  };
}

type T15ProtectedTerminal = {
  receipt: NativeComparisonReceiptInput | null;
  status: 'received' | 'application-failed' | 'harness-blocked' | 'cancelled';
  issue: T15ProductionIssue | null;
};

export async function readT15ProtectedTerminalReceipt(input: {
  outputParent: string;
  expected: NativeComparisonAttemptExpectation;
}): Promise<T15ProtectedTerminal> {
  if (
    !path.isAbsolute(input.outputParent) ||
    path.normalize(input.outputParent) !== input.outputParent ||
    !nativePilotRunIdPattern.test(input.expected.runId) ||
    input.expected.attemptId !== `${input.expected.runId}:first`
  )
    return {
      receipt: null,
      status: 'harness-blocked',
      issue: 'terminal-receipt-mismatch',
    };
  const outputRoot = path.join(input.outputParent, input.expected.runId);
  const receiptPath = path.join(outputRoot, 'receipt.json');
  let receipt: NativeComparisonReceiptInput;
  try {
    [receipt] = await readNativeComparisonReceipts([receiptPath]);
  } catch {
    return {
      receipt: null,
      status: 'harness-blocked',
      issue: 'runner-receipt-unavailable',
    };
  }
  const row = isRecord(receipt.receipt) ? receipt.receipt : null;
  if (
    row?.runId !== input.expected.runId ||
    row?.attemptId !== input.expected.attemptId ||
    receipt.artifactRoot !== outputRoot ||
    receipt.path !== receiptPath
  )
    return {
      receipt,
      status: 'harness-blocked',
      issue: 'terminal-receipt-mismatch',
    };
  if (row.result === 'passed') return { receipt, status: 'received', issue: null };
  if (row.result === 'application-failed')
    return { receipt, status: 'application-failed', issue: null };
  if (row.result === 'cancelled')
    return { receipt, status: 'cancelled', issue: 'cancelled-during-runner' };
  if (row.result === 'harness-blocked')
    return {
      receipt,
      status: 'harness-blocked',
      issue: 'terminal-receipt-blocked',
    };
  return {
    receipt,
    status: 'harness-blocked',
    issue: 'terminal-receipt-mismatch',
  };
}

function runtimeFor(
  execution: NativeCommandExecution,
  input: ColdComparisonAttemptInvocation,
  terminal: T15ProtectedTerminal,
  sidecarPath: string | null,
): T15RuntimeFacts {
  const row =
    terminal.receipt && isRecord(terminal.receipt.receipt) ? terminal.receipt.receipt : null;
  return {
    outerExecution: execution,
    runtimeLinkPath: terminal.receipt
      ? path.join(terminal.receipt.artifactRoot, 'runtime-link.private.json')
      : null,
    publicReceiptPath: terminal.receipt?.path ?? null,
    captureRunId: text(row?.captureRunId, 128),
    publicRunId: text(row?.runId, 128),
    publicAttemptId: text(row?.attemptId, 160),
    sidecarPath,
    resetReceiptPath: input.reset.originalResetBinding.receiptPath,
  };
}

/**
 * Execute the actual public runner with the reviewed run/attempt/output/reset
 * identities, then read its terminal receipt from the protected file. The
 * stdout stream is diagnostic only; it is never used to discover a receipt.
 */
export function createT15PublicAttemptProducer(options: {
  repositoryRoot: string;
  outputRoot: string;
  attemptDeadlineMs?: number;
  execute?: T15CommandExecutor;
  readOwnershipSidecar?: T15OwnershipSidecarReader;
}): T15ProductionAttemptExecutor {
  const execute = options.execute ?? commandExecutor();
  const readOwnershipSidecar = options.readOwnershipSidecar ?? readDefaultOwnershipSidecar;
  const deadlineMs = options.attemptDeadlineMs ?? 600_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 600_000)
    throw new Error('T15 production attempt deadline is outside the owned step bound');

  return async (input) => {
    if (input.signal.aborted)
      return blockedAttempt(input, 'cancelled-before-acquisition', 'cancelled');
    const unsupported = supportedPublicSelection(input.selection);
    if (unsupported) return blockedAttempt(input, unsupported);
    if (!input.reusableBuild) return blockedAttempt(input, 'android-build-reuse-unqualified');
    if (!validResetForExpected(input.reset, input.expected))
      return blockedAttempt(input, 'cold-reset-rejected');

    let outputRoot: string;
    let attemptRoot: string;
    let runnerOutputParent: string;
    try {
      outputRoot = await requirePrivateDirectory(options.outputRoot);
      runnerOutputParent = await ensurePrivateChildDirectory(outputRoot, 'runner-output');
      attemptRoot = await makeAttemptRoot(outputRoot, input.expected.attemptId);
    } catch {
      return blockedAttempt(input, 'runner-command-rejected');
    }
    let invocation: ReturnType<typeof buildNativePilotInvocation>;
    try {
      invocation = buildNativePilotInvocation({
        repositoryRoot: options.repositoryRoot,
        selection: input.selection,
        expected: input.expected,
        reset: input.reset,
        outputParent: runnerOutputParent,
      });
    } catch (error) {
      return blockedAttempt(
        input,
        error instanceof Error && error.message.includes('run ID')
          ? 'runner-identity-incompatible'
          : 'runner-command-rejected',
      );
    }
    const stdoutPath = path.join(attemptRoot, 'runner.stdout.private.log');
    const environment = {
      ...process.env,
      MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID: input.reusableBuild.buildId,
    };
    const deadlineAt = performance.now() + deadlineMs;
    let execution: NativeCommandExecution;
    try {
      execution = await execute({
        ...invocation,
        artifactRoot: attemptRoot,
        label: 'native-pilot',
        env: environment,
        stdoutPath,
        deadlineMs,
        phase: 'step',
        signal: input.signal,
      });
    } catch {
      return blockedAttempt(input, 'runner-failed');
    }
    const terminal = await readT15ProtectedTerminalReceipt({
      outputParent: runnerOutputParent,
      expected: input.expected,
    });
    const cancelled = input.signal.aborted || execution.execution === 'cancelled';
    if (cancelled || terminal.status === 'cancelled')
      return blockedAttempt(
        input,
        'cancelled-during-runner',
        'cancelled',
        {
          outerExecution: execution,
          publicReceiptPath: terminal.receipt?.path ?? null,
        },
        terminal.receipt,
      );
    if (!terminal.receipt)
      return blockedAttempt(
        input,
        terminal.issue ?? 'runner-receipt-unavailable',
        'harness-blocked',
        { outerExecution: execution },
      );
    if (performance.now() > deadlineAt)
      return blockedAttempt(
        input,
        'runner-failed',
        'harness-blocked',
        runtimeFor(execution, input, terminal, null),
        terminal.receipt,
      );
    const captureRoot = terminal.receipt.artifactRoot;
    const runtimeLink = readRuntimeLink(captureRoot);
    const row = isRecord(terminal.receipt.receipt) ? terminal.receipt.receipt : null;
    if (
      !runtimeLink ||
      runtimeLink.value.requestedRunId !== input.expected.runId ||
      runtimeLink.value.requestedAttemptId !== input.expected.attemptId
    )
      return blockedAttempt(
        input,
        'runner-receipt-unbound',
        'harness-blocked',
        runtimeFor(execution, input, terminal, null),
        terminal.receipt,
      );
    if (input.signal.aborted)
      return blockedAttempt(
        input,
        'cancelled-during-runner',
        'cancelled',
        runtimeFor(execution, input, terminal, null),
        terminal.receipt,
      );
    if (performance.now() > deadlineAt)
      return blockedAttempt(
        input,
        'runner-failed',
        'harness-blocked',
        runtimeFor(execution, input, terminal, null),
        terminal.receipt,
      );
    let sidecar: T15OwnershipSidecarRead | null = null;
    try {
      sidecar = await readOwnershipSidecar({
        artifactRoot: captureRoot,
        expected: input.expected,
      });
    } catch {
      sidecar = null;
    }
    if (!sidecar)
      return blockedAttempt(
        input,
        'ownership-sidecar-unavailable',
        'harness-blocked',
        runtimeFor(execution, input, terminal, null),
        terminal.receipt,
      );
    let validatedSidecar: T15OwnershipSidecar;
    try {
      const runner = readRunnerIdentity(execution);
      if (!runner) throw new Error('outer runner ownership ledger unavailable');
      if (sidecar.value.captureRunId !== runtimeLink.value.captureRunId)
        throw new Error('ownership sidecar capture run differs from terminal receipt');
      verifyCleanupReceipt(sidecar.value);
      validatedSidecar = validateSidecar(sidecar.value, input.expected, outputRoot, runner);
    } catch {
      return blockedAttempt(
        input,
        'ownership-sidecar-invalid',
        'harness-blocked',
        runtimeFor(execution, input, terminal, sidecar.path),
        terminal.receipt,
      );
    }
    if (input.signal.aborted)
      return blockedAttempt(
        input,
        'cancelled-during-runner',
        'cancelled',
        runtimeFor(execution, input, terminal, sidecar.path),
        terminal.receipt,
      );
    if (performance.now() > deadlineAt)
      return blockedAttempt(
        input,
        'runner-failed',
        'harness-blocked',
        runtimeFor(execution, input, terminal, sidecar.path),
        terminal.receipt,
      );
    const executionHealthy =
      execution.execution === 'completed' &&
      execution.cleanup === 'cleaned' &&
      execution.childSignal === null;
    const applicationFailureHealthy =
      execution.cleanup === 'cleaned' &&
      execution.childSignal === null &&
      execution.childExitCode === 1 &&
      (execution.execution === 'completed' || execution.execution === 'child-failed');
    let status = terminal.status;
    let issue = terminal.issue;
    if (status === 'received' && (!executionHealthy || execution.childExitCode !== 0)) {
      status = 'harness-blocked';
      issue = execution.cleanup !== 'cleaned' ? 'cleanup-not-proven' : 'runner-failed';
    } else if (status === 'application-failed' && !applicationFailureHealthy) {
      status = 'harness-blocked';
      issue = execution.cleanup !== 'cleaned' ? 'cleanup-not-proven' : 'runner-failed';
    }
    const identity = publicReceiptIdentity(terminal.receipt, input.expected, validatedSidecar);
    const result: T15ProductionAttemptResult = {
      runId: input.expected.runId,
      attemptId: input.expected.attemptId,
      status,
      ownerRunId: input.expected.runId,
      coldAttemptIdentity: identity,
      reset: input.reset,
      receipt: terminal.receipt,
      issue,
      runtime: {
        ...runtimeFor(execution, input, terminal, sidecar.path),
        captureRunId: runtimeLink.value.captureRunId,
      },
      evidencePath: sidecar.path,
    };
    const evidencePath = path.join(attemptRoot, 'cold-attempt-terminal.private.json');
    try {
      await writeProtectedJsonFile(
        evidencePath,
        {
          kind: 'private t15 production terminal evidence; not a public receipt',
          requestedRunId: input.expected.runId,
          requestedAttemptId: input.expected.attemptId,
          terminalStatus: status,
          terminalResult: row?.result ?? null,
          publicReceiptPath: terminal.receipt.path,
          publicReceiptHash: terminal.receipt.receiptHash,
          ownershipSidecarPath: sidecar.path,
          runtimeLinkPath: runtimeLink.path,
          runner: validatedSidecar.runner,
          process: validatedSidecar.process,
          ports: validatedSidecar.ports,
          cleanup: validatedSidecar.cleanup,
          outerExecution: execution,
          issue,
        },
        'T15 terminal evidence',
      );
      result.evidencePath = evidencePath;
    } catch {
      result.issue = 'terminal-evidence-write-failed';
      result.status = 'harness-blocked';
    }
    if (input.signal.aborted) {
      result.issue = 'cancelled-during-runner';
      result.status = 'cancelled';
    } else if (performance.now() > deadlineAt) {
      result.issue = 'runner-failed';
      result.status = 'harness-blocked';
    }
    return result;
  };
}

export async function runT15ColdProduction(
  options: T15ProductionRunOptions,
): Promise<T15MappedDispatchReport> {
  const repositoryRoot = await realpath(options.repositoryRoot);
  const outputRoot = await requirePrivateDirectory(options.outputRoot);
  const reviewedSpec = validateNativeComparisonSpec(options.spec);
  const identityMap = await loadOrCreateIdentityMap(outputRoot, reviewedSpec);
  const nativeSpec = mapT15SpecToNative(reviewedSpec, identityMap.document);
  const signal = options.signal ?? new AbortController().signal;
  const reset = createT15ColdResetProducer({
    repositoryRoot,
    outputRoot,
    driver: options.resetDriver,
    manifestPath: options.resetManifestPath,
    identityMap,
    driverIdentity: options.resetDriverIdentity,
    attemptDeadlineMs: options.attemptDeadlineMs,
  });
  const produce = createT15PublicAttemptProducer({
    repositoryRoot,
    outputRoot,
    attemptDeadlineMs: options.attemptDeadlineMs,
    execute: options.execute,
    readOwnershipSidecar: options.readOwnershipSidecar,
  });
  const ownedAttempt =
    options.ownedAttempt ??
    createT15PlatformEngineAwareOwnedLifecycleProducer({
      attemptDeadlineMs: options.attemptDeadlineMs,
      ios: {
        repositoryRoot,
        outputRoot,
        familyAttempt: createT15IosFamilyAttemptRunner({ repositoryRoot }),
        consumePublic: createT15OwnedPublicConsumer({ repositoryRoot }),
      },
      androidMaestro: {
        repositoryRoot,
        outputRoot,
        familyAttempt: createT15AndroidMaestroFamilyAttemptRunner({ repositoryRoot }),
        consumePublic: createT15AndroidMaestroPublicConsumer({ repositoryRoot }),
      },
    });
  const report = await runNativeComparisonCohort({
    spec: nativeSpec,
    signal,
    outputRoot,
    buildReuse: options.buildReuse,
    select: createT15SelectionResolver(repositoryRoot, identityMap),
    reset,
    produce,
    ownedAttempt,
    attemptDeadlineMs: options.attemptDeadlineMs,
    preserveFailedResetEvidence: true,
  });
  const logicalPhysicalAttemptOrder = report.physicalAttemptOrder.map((nativeAttemptId) => {
    const entry = identityMap.byNativeAttemptId.get(nativeAttemptId);
    if (!entry) throw new Error('T15 dispatcher returned an attempt absent from the identity map');
    return entry.logicalAttemptId;
  });
  return {
    ...report,
    t15IdentityMapPath: identityMap.path,
    t15IdentityMapHash: identityMap.document.mappingHash,
    logicalAttemptCount: identityMap.document.entries.length,
    logicalPhysicalAttemptOrder,
  };
}

export function summarizeT15Runtime(value: T15ProductionAttemptResult): T15RuntimeFacts {
  return structuredClone(value.runtime);
}

type T15CliOptions = {
  repositoryRoot: string;
  outputRoot: string;
  specPath: string;
  buildReusePath: string;
  resetManifestPath: string;
  attemptDeadlineMs: number;
};

function cliValue(argv: readonly string[], name: string): string {
  const prefix = `${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function parseT15Cli(argv: readonly string[]): T15CliOptions {
  const required = [
    '--repository-root',
    '--output-root',
    '--spec',
    '--build-reuse',
    '--reset-manifest',
  ];
  for (const name of required) cliValue(argv, name);
  const attemptValue = argv.find((value) => value.startsWith('--attempt-deadline-ms='));
  const attemptDeadlineMs = Number(
    attemptValue?.slice('--attempt-deadline-ms='.length) ?? '600000',
  );
  if (
    !Number.isSafeInteger(attemptDeadlineMs) ||
    attemptDeadlineMs < 100 ||
    attemptDeadlineMs > 600_000
  )
    throw new Error('--attempt-deadline-ms must be an integer from 100 through 600000');
  return {
    repositoryRoot: path.resolve(cliValue(argv, '--repository-root')),
    outputRoot: path.resolve(cliValue(argv, '--output-root')),
    specPath: path.resolve(cliValue(argv, '--spec')),
    buildReusePath: path.resolve(cliValue(argv, '--build-reuse')),
    resetManifestPath: path.resolve(cliValue(argv, '--reset-manifest')),
    attemptDeadlineMs,
  };
}

async function readCliJson(filePath: string, label: string): Promise<unknown> {
  const entry = await lstat(filePath);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1)
    throw new Error(`${label} must be a regular single-link file`);
  if ((await realpath(filePath)) !== filePath) throw new Error(`${label} must be canonical`);
  if (entry.size > maxObservationBytes) throw new Error(`${label} exceeds the bounded input size`);
  return JSON.parse((await readFile(filePath)).toString('utf8')) as unknown;
}

function requireCliBuildReuse(value: unknown): CohortBuildReuse {
  if (!isRecordValue(value)) throw new Error('T15 build reuse must be an object');
  return value as CohortBuildReuse;
}

/**
 * Standalone source/runtime caller. A real reset manifest is mandatory; this
 * command never substitutes a synthetic reset or a source-only terminal row.
 */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  process.umask(0o077);
  const options = parseT15Cli(argv);
  const repositoryRoot = await realpath(options.repositoryRoot);
  const outputRoot = await requirePrivateDirectory(options.outputRoot);
  if (!pathInside(outputRoot, options.resetManifestPath))
    throw new Error('T15 reset manifest must remain in the owned output root');
  const spec = validateNativeComparisonSpec(await readCliJson(options.specPath, 'T15 spec'));
  const buildReuse = requireCliBuildReuse(
    await readCliJson(options.buildReusePath, 'T15 build reuse'),
  );
  const controller = new AbortController();
  const onSignal = () => controller.abort('T15 cold CLI interrupted');
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const report = await runT15ColdProduction({
      repositoryRoot,
      outputRoot,
      spec,
      buildReuse,
      resetManifestPath: options.resetManifestPath,
      attemptDeadlineMs: options.attemptDeadlineMs,
      signal: controller.signal,
    });
    const reportPath = path.join(outputRoot, 't15-cold-dispatch-report.private.json');
    await writeProtectedJsonFile(reportPath, report, 'T15 dispatch report');
    const allTerminal =
      report.attempts.length === report.requestedAttempts &&
      report.attempts.every(
        (attempt) => attempt.status === 'received' || attempt.status === 'application-failed',
      );
    process.stdout.write(`T15 cold dispatch ${report.terminalStatus}; report: ${reportPath}\n`);
    return report.terminalStatus === 'complete' && allTerminal && report.issues.length === 0
      ? 0
      : 2;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `T15 cold dispatch blocked: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 2;
    },
  );
}

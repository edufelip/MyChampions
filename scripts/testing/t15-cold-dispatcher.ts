import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  collectNativeComparison,
  readNativeComparisonReceipts,
  validateNativeComparisonSpec,
} from './compare-native-pilot';
import { readNativeEvidenceObservation } from './native-view-evidence';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonColdAttemptIdentity,
  NativeComparisonCell,
  NativeComparisonOriginalReceiptBinding,
  NativeComparisonPlatform,
  NativeComparisonReceiptInput,
  NativeComparisonSpec,
} from './compare-native-pilot';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeEvidenceIdentity } from './native-view-evidence';

const fullFamilies = ['session', 'training', 'connection', 'camera-denied', 'save-retry'] as const;
const fullPlatforms = ['ios', 'android'] as const;
const fullEngines = ['maestro', 'detox'] as const;
const sha256 = /^[a-f0-9]{64}$/;

export type ColdAttemptTerminalStatus =
  'received' | 'harness-blocked' | 'application-failed' | 'cancelled' | 'missing';

export type ColdResetStatus = 'fresh' | 'blocked';

/**
 * The shared comparison schema keeps pending bindings empty. A verified cold
 * producer additionally carries the protected source descriptor identity; the
 * dispatcher must type that field rather than recover it through a cast.
 */
export type ColdResetOriginalReceiptBinding = NativeComparisonOriginalReceiptBinding & {
  identity?: NativeEvidenceIdentity;
};

/**
 * A reset is a receipt of state preparation, not a claim that a device was
 * reset. The caller must provide the observed app/fixture fingerprints when a
 * cold attempt is acquired.
 */
export type FreshColdReset = {
  fixtureResetId: string;
  ownerRunId: string;
  cohortFixtureFingerprint: string;
  status: ColdResetStatus;
  startedAt: string;
  finishedAt: string | null;
  appStateFingerprint: string | null;
  fixtureStateFingerprint: string | null;
  sourceFingerprint: string | null;
  helperFingerprint: string | null;
  originalResetBinding: ColdResetOriginalReceiptBinding;
  /** Same-attempt rows captured from the acquired target/backend handles. */
  target?: Record<string, unknown>;
  backend?: Record<string, unknown>;
  cleanupStatus: 'cleaned' | 'not-acquired' | 'failed-recovery-ledger-retained';
  blocker: string | null;
};

/**
 * Build bytes may be reused for a cohort only after the current-input check
 * has qualified them. This type deliberately does not contain app/fixture
 * state or process/port identities; those are per-attempt facts.
 */
export type QualifiedBuildReuse = {
  platform: NativeComparisonPlatform;
  buildId: string;
  buildProfile: string;
  sourceFingerprint: string;
  helperFingerprint: string;
  flagsFingerprint: string;
  binaryHash: string;
  current: true;
};

export type CohortBuildReuse = {
  sourceFingerprint: string;
  helperFingerprint: string;
  flagsFingerprint: string;
  byPlatform: Record<NativeComparisonPlatform, QualifiedBuildReuse | null>;
};

export type ColdComparisonAttemptReceipt = {
  runId: string;
  attemptId: string;
  status: ColdAttemptTerminalStatus;
  ownerRunId: string;
  coldAttemptIdentity: NativeComparisonColdAttemptIdentity;
  reset: FreshColdReset;
  receipt: NativeComparisonReceiptInput | null;
  issue: string | null;
};

/**
 * A producer may throw this structured error after acquisition if it cannot
 * return a normal result. It may also register the same terminal row through
 * the invocation's terminalize callback before an ordinary throw. The terminal
 * row preserves observed owner, reset cleanup and original-receipt facts
 * instead of being rewritten as a pre-acquisition block.
 */
export class ColdComparisonAttemptError extends Error {
  readonly terminal: ColdComparisonAttemptReceipt;

  constructor(message: string, terminal: ColdComparisonAttemptReceipt) {
    super(message);
    this.name = 'ColdComparisonAttemptError';
    this.terminal = terminal;
  }
}

type DispatchExpected = {
  expected: NativeComparisonAttemptExpectation;
  cell: NativeComparisonCell;
};

export type ColdComparisonAttemptInvocation = {
  spec: NativeComparisonSpec;
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  signal: AbortSignal;
  reusableBuild: QualifiedBuildReuse | null;
  reset: FreshColdReset;
  /** Register post-acquisition terminal evidence before throwing ordinarily. */
  terminalize(terminal: ColdComparisonAttemptReceipt): void;
};

export type ColdComparisonAttemptProducer = (
  input: ColdComparisonAttemptInvocation,
) => Promise<ColdComparisonAttemptReceipt>;

/**
 * A combined producer owns reset, scenario, original receipt and cleanup in
 * one lifecycle. It is intentionally separate from the split reset/public
 * child path: a cleaned reset cannot be handed to a replacement child and
 * still prove the same target/backend state.
 */
export type ColdComparisonOwnedAttemptInvocation = Omit<
  ColdComparisonAttemptInvocation,
  'reset'
> & {
  /** One absolute deadline owned by the outer matrix attempt. */
  deadlineAtMonotonicMs: number;
};

export type ColdComparisonOwnedAttemptProducer = (
  input: ColdComparisonOwnedAttemptInvocation,
) => Promise<ColdComparisonAttemptReceipt>;

export type ColdComparisonSelectionResolver = (
  expected: NativeComparisonAttemptExpectation,
) => Promise<NativePilotSelection>;

export type ColdComparisonResetProducer = (input: {
  spec: NativeComparisonSpec;
  expected: NativeComparisonAttemptExpectation;
  /** The selection resolved for this exact native attempt. Reset production
   * must use the same platform/engine/family/mode/locale tuple as the child. */
  selection: NativePilotSelection;
  signal: AbortSignal;
  reusableBuild: QualifiedBuildReuse | null;
  outputRoot: string;
}) => Promise<FreshColdReset>;

export type NativeComparisonDispatchReport = {
  schemaVersion: 1;
  sourceOnly: true;
  nativeExecution: 'not-run';
  publicPromotionEligible: false;
  nativePassingCases: 0;
  scope: NativeComparisonSpec['scope'];
  requestedCells: number;
  requestedAttempts: number;
  scheduledAttempts: number;
  dispatchedAttempts: number;
  terminalStatus: 'complete' | 'cancelled';
  physicalAttemptOrder: string[];
  attempts: ColdComparisonAttemptReceipt[];
  receipts: NativeComparisonReceiptInput[];
  comparison: ReturnType<typeof collectNativeComparison> | null;
  issues: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isoMilliseconds(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function pendingBinding(): ColdResetOriginalReceiptBinding {
  return {
    status: 'pending',
    receiptPath: null,
    artifactRoot: null,
    receiptHash: null,
  };
}

function blockedIdentity(
  expected: NativeComparisonAttemptExpectation,
): NativeComparisonColdAttemptIdentity {
  return {
    ownerRunId: expected.runId,
    processPid: null,
    processStartIdentity: null,
    ownedPorts: [],
    ownershipWindows: [],
    originalReceiptBinding: pendingBinding(),
  };
}

function blockedReset(
  expected: NativeComparisonAttemptExpectation,
  reason: string,
  cohortFixtureFingerprint = expected.inputs.fixtureHash ?? 'unknown',
): FreshColdReset {
  return {
    fixtureResetId: expected.fixtureResetId,
    ownerRunId: expected.runId,
    cohortFixtureFingerprint,
    status: 'blocked',
    startedAt: new Date(0).toISOString(),
    finishedAt: null,
    appStateFingerprint: null,
    fixtureStateFingerprint: null,
    sourceFingerprint: null,
    helperFingerprint: null,
    originalResetBinding: pendingBinding(),
    cleanupStatus: 'not-acquired',
    blocker: reason,
  };
}

function blockedAttempt(
  expected: NativeComparisonAttemptExpectation,
  status: Extract<ColdAttemptTerminalStatus, 'harness-blocked' | 'cancelled' | 'missing'>,
  issue: string,
  cohortFixtureFingerprint: string,
  reset = blockedReset(expected, issue, cohortFixtureFingerprint),
): ColdComparisonAttemptReceipt {
  return {
    runId: expected.runId,
    attemptId: expected.attemptId,
    status,
    ownerRunId: expected.runId,
    coldAttemptIdentity: blockedIdentity(expected),
    reset,
    receipt: null,
    issue,
  };
}

function expectedByAttemptId(
  spec: NativeComparisonSpec,
): Map<string, NativeComparisonAttemptExpectation> {
  const map = new Map<string, NativeComparisonAttemptExpectation>();
  for (const cell of spec.cells)
    for (const expected of cell.expectedAttempts) map.set(expected.attemptId, expected);
  return map;
}

function validateFullDispatchShape(spec: NativeComparisonSpec): Map<string, DispatchExpected> {
  if (spec.scope !== 'full')
    throw new Error('T15 cold dispatcher requires a full comparison scope');
  if (spec.attemptsPerCell !== 20 || spec.cells.length !== 20)
    throw new Error('T15 cold dispatcher requires exactly 20 cells with 20 attempts each');
  if (new Set(spec.cells.map((cell) => cell.locale)).size !== 1)
    throw new Error('T15 cold dispatcher requires one explicit locale');
  const expectedCellKeys = new Set(
    fullFamilies.flatMap((family) =>
      fullPlatforms.flatMap((platform) =>
        fullEngines.map((engine) =>
          JSON.stringify([
            `SCN-${family}-${platform}`,
            platform,
            engine,
            'integration',
            spec.cells[0].locale,
          ]),
        ),
      ),
    ),
  );
  const actualCellKeys = new Set(
    spec.cells.map((cell) =>
      JSON.stringify([cell.scenarioId, cell.platform, cell.engine, cell.mode, cell.locale]),
    ),
  );
  if (
    actualCellKeys.size !== expectedCellKeys.size ||
    [...expectedCellKeys].some((key) => !actualCellKeys.has(key))
  )
    throw new Error('T15 cold dispatcher matrix omitted, duplicated or swapped a required cell');
  const expected = expectedByAttemptId(spec);
  const dispatchByAttemptId = new Map<string, DispatchExpected>();
  for (const cell of spec.cells)
    for (const attempt of cell.expectedAttempts)
      dispatchByAttemptId.set(attempt.attemptId, { expected: attempt, cell });
  if (expected.size !== 400) throw new Error('T15 cold dispatcher must seal 400 unique attempts');
  const resetIds = new Set<string>();
  for (const cell of spec.cells) {
    if (cell.mode !== 'integration' || cell.locale !== spec.cells[0].locale)
      throw new Error('T15 cold dispatcher requires integration cells in one locale');
    if (cell.expectedAttempts.length !== 20)
      throw new Error(`T15 cell ${cell.scenarioId}/${cell.engine} does not have 20 attempts`);
    for (const attempt of cell.expectedAttempts) {
      if (attempt.trialOrdinal < 1 || attempt.trialOrdinal > 20)
        throw new Error(`T15 attempt ${attempt.attemptId} has an invalid trial ordinal`);
      if (attempt.attemptId !== `${attempt.runId}:first`)
        throw new Error(`T15 attempt ${attempt.attemptId} is not bound to its run ID`);
      if (attempt.coldAttemptIdentity.ownerRunId !== attempt.runId)
        throw new Error(`T15 attempt ${attempt.attemptId} has a foreign expected owner`);
      if (resetIds.has(attempt.fixtureResetId))
        throw new Error(`T15 matrix reuses fixture reset identity ${attempt.fixtureResetId}`);
      resetIds.add(attempt.fixtureResetId);
    }
  }
  if (spec.executionOrder.length !== 10)
    throw new Error('T15 cold dispatcher requires ten reviewed engine pairs');
  const physicalIds = new Set<string>();
  for (const pair of spec.executionOrder) {
    if (
      pair.mode !== 'integration' ||
      pair.locale !== spec.cells[0].locale ||
      pair.trials.length !== 20
    )
      throw new Error(
        `T15 pair ${pair.pairId} does not seal twenty trials in the reviewed mode/locale`,
      );
    for (const [index, trial] of pair.trials.entries()) {
      const expectedOrdinal = index + 1;
      if (trial.trialOrdinal !== expectedOrdinal)
        throw new Error(`T15 pair ${pair.pairId} has an omitted or swapped trial ordinal`);
      for (const attemptId of [trial.firstAttemptId, trial.secondAttemptId]) {
        if (physicalIds.has(attemptId))
          throw new Error(`T15 execution order duplicates attempt ${attemptId}`);
        physicalIds.add(attemptId);
        const dispatch = dispatchByAttemptId.get(attemptId);
        const attempt = dispatch?.expected;
        if (
          !dispatch ||
          attempt?.trialOrdinal !== expectedOrdinal ||
          attempt.locale !== pair.locale
        )
          throw new Error(
            `T15 execution order is not bound to an exact expected attempt ${attemptId}`,
          );
        if (attempt.inputs.scenarioHash === null || attempt.inputs.requirementHash === null)
          throw new Error(
            `T15 attempt ${attemptId} lacks reviewed source/requirement fingerprints`,
          );
      }
      const first = dispatchByAttemptId.get(trial.firstAttemptId)?.expected;
      const second = dispatchByAttemptId.get(trial.secondAttemptId)?.expected;
      const expectedFirstEngine =
        expectedOrdinal % 2 === 1
          ? pair.firstEngine
          : pair.firstEngine === 'maestro'
            ? 'detox'
            : 'maestro';
      const firstEngine = dispatchByAttemptId.get(trial.firstAttemptId)?.cell.engine;
      const secondEngine = dispatchByAttemptId.get(trial.secondAttemptId)?.cell.engine;
      if (!first || !second || firstEngine !== expectedFirstEngine || secondEngine === firstEngine)
        throw new Error(
          `T15 pair ${pair.pairId} has an omitted, swapped or duplicate engine pairing`,
        );
    }
  }
  if (physicalIds.size !== 400)
    throw new Error('T15 execution order does not bind all 400 attempts exactly once');
  return dispatchByAttemptId;
}

function buildFor(
  buildReuse: CohortBuildReuse,
  platform: NativeComparisonPlatform,
  expected: NativeComparisonAttemptExpectation,
): QualifiedBuildReuse | null {
  const build = buildReuse.byPlatform[platform];
  if (build === null) return null;
  if (
    build.platform !== platform ||
    build.current !== true ||
    build.sourceFingerprint !== buildReuse.sourceFingerprint ||
    build.flagsFingerprint !== buildReuse.flagsFingerprint ||
    !sha256.test(build.binaryHash) ||
    build.buildId.length === 0 ||
    !expected.target.binaryHash ||
    !expected.target.buildProfile ||
    build.binaryHash !== expected.target.binaryHash ||
    build.buildProfile !== expected.target.buildProfile
  )
    throw new Error(`T15 reusable build is stale for ${platform}`);
  if (build.helperFingerprint !== buildReuse.helperFingerprint)
    throw new Error(`T15 reusable helper fingerprint is stale for ${platform}`);
  return build;
}

function validateSelection(
  selection: NativePilotSelection,
  expected: NativeComparisonAttemptExpectation,
  cell: NativeComparisonCell,
): void {
  if (
    selection.arguments.platform !== cell.platform ||
    selection.arguments.engine !== cell.engine ||
    selection.arguments.mode !== cell.mode ||
    selection.arguments.scenario !== cell.scenarioId ||
    selection.scenario.id !== cell.scenarioId ||
    selection.scenario.platform !== cell.platform
  )
    throw new Error(`T15 selection is not bound to ${expected.attemptId}`);
  if (cell.mode === 'integration' && selection.scenario.dataMode !== 'postgres')
    throw new Error(`T15 integration selection ${expected.attemptId} is not Postgres-bound`);
  if (
    expected.inputs.scenarioHash === null ||
    expected.inputs.requirementHash === null ||
    selection.scenarioHash !== expected.inputs.scenarioHash ||
    selection.requirementHash !== expected.inputs.requirementHash
  )
    throw new Error(`T15 selection fingerprints are stale for ${expected.attemptId}`);
}

function verifyResetBinding(
  reset: FreshColdReset,
  expected: NativeComparisonAttemptExpectation,
  cohort: NativeComparisonSpec['cohort'],
  outputRoot: string,
): void {
  const binding = reset.originalResetBinding;
  if (
    binding.status !== 'verified' ||
    !binding.receiptPath ||
    !binding.artifactRoot ||
    !binding.receiptHash
  )
    throw new Error('T15 reset ' + expected.attemptId + ' lacks an original reset binding');
  const receiptPath = path.resolve(binding.receiptPath);
  const artifactRoot = path.resolve(binding.artifactRoot);
  const root = path.resolve(outputRoot);
  if (!pathInside(root, artifactRoot) || !pathInside(artifactRoot, receiptPath))
    throw new Error('T15 reset ' + expected.attemptId + ' escapes the owned output root');
  const relativeReceipt = path.relative(artifactRoot, receiptPath);
  let observation;
  try {
    observation = readNativeEvidenceObservation(artifactRoot, relativeReceipt, true);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'protected reader failed';
    throw new Error(
      'T15 reset ' +
        expected.attemptId +
        ' has unowned reset evidence: protected bounded read failed: ' +
        detail,
    );
  }
  const bytes = observation.bytes;
  const receiptHash = createHash('sha256').update(bytes).digest('hex');
  if (receiptHash !== binding.receiptHash) {
    throw new Error('T15 reset ' + expected.attemptId + ' reset evidence changed before binding');
  }
  const boundIdentity = binding.identity;
  if (!isRecord(boundIdentity))
    throw new Error('T15 reset ' + expected.attemptId + ' lacks source descriptor identity');
  for (const field of [
    'dev',
    'ino',
    'uid',
    'gid',
    'mode',
    'nlink',
    'size',
    'mtimeMs',
    'ctimeMs',
  ] as const) {
    if (observation.identity[field] !== boundIdentity[field])
      throw new Error('T15 reset ' + expected.attemptId + ' source descriptor identity changed');
  }
  let row: unknown;
  try {
    row = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('T15 reset ' + expected.attemptId + ' reset evidence is not JSON');
  }
  if (!isRecord(row))
    throw new Error('T15 reset ' + expected.attemptId + ' reset evidence is malformed');
  if (
    row.fixtureResetId !== expected.fixtureResetId ||
    row.ownerRunId !== expected.runId ||
    row.cohortFixtureFingerprint !== cohort.fixtureResetFingerprint ||
    row.appStateFingerprint !== reset.appStateFingerprint ||
    row.fixtureStateFingerprint !== reset.fixtureStateFingerprint ||
    row.sourceFingerprint !== cohort.sourceFingerprint ||
    row.sourceFingerprint !== reset.sourceFingerprint ||
    row.helperFingerprint !== reset.helperFingerprint ||
    row.cleanupStatus !== reset.cleanupStatus
  )
    throw new Error('T15 reset ' + expected.attemptId + ' reset evidence is not identity-bound');
  if (!reset.target || !reset.backend || !isRecord(row.target) || !isRecord(row.backend))
    throw new Error('T15 reset ' + expected.attemptId + ' target/backend rows are missing');
  for (const field of [
    'platform',
    'deviceId',
    'appId',
    'binaryHash',
    'apiOrigin',
    'captureRunId',
    'ownerRunId',
    'phase',
  ]) {
    if (row.target[field] !== reset.target[field])
      throw new Error('T15 reset ' + expected.attemptId + ' target identity is not stable');
  }
  for (const field of [
    'runId',
    'ownerRunId',
    'captureRunId',
    'artifactRoot',
    'apiOrigin',
    'apiPid',
    'apiStarted',
    'apiScript',
    'backendAttemptId',
    'manifestSha256',
  ]) {
    if (row.backend[field] !== reset.backend[field])
      throw new Error('T15 reset ' + expected.attemptId + ' backend identity is not stable');
  }
}

function validateReset(
  reset: FreshColdReset,
  expected: NativeComparisonAttemptExpectation,
  cohort: NativeComparisonSpec['cohort'],
  outputRoot: string,
  reusableBuild: QualifiedBuildReuse | null,
  allowFailedRecovery = false,
): void {
  if (reset.status !== 'fresh' && reset.status !== 'blocked')
    throw new Error(`T15 reset ${expected.attemptId} has an unknown status`);
  if (
    reset.fixtureResetId !== expected.fixtureResetId ||
    reset.ownerRunId !== expected.runId ||
    reset.cohortFixtureFingerprint !== cohort.fixtureResetFingerprint
  )
    throw new Error(`T15 reset is not bound to ${expected.attemptId}`);
  const started = isoMilliseconds(reset.startedAt);
  if (!Number.isFinite(started))
    throw new Error(`T15 reset ${expected.attemptId} has invalid start time`);
  if (reset.status === 'fresh') {
    const finished = reset.finishedAt === null ? NaN : isoMilliseconds(reset.finishedAt);
    if (!Number.isFinite(finished) || finished <= started)
      throw new Error(`T15 fresh reset ${expected.attemptId} is not a closed interval`);
    if (
      !reset.appStateFingerprint ||
      !reset.fixtureStateFingerprint ||
      !sha256.test(reset.appStateFingerprint) ||
      !sha256.test(reset.fixtureStateFingerprint) ||
      reset.sourceFingerprint !== cohort.sourceFingerprint ||
      !reset.helperFingerprint ||
      !sha256.test(reset.helperFingerprint)
    )
      throw new Error(`T15 fresh reset ${expected.attemptId} lacks state fingerprints`);
    if (!reset.target || !reset.backend)
      throw new Error(`T15 fresh reset ${expected.attemptId} lacks acquired target/backend rows`);
    if (
      JSON.stringify(reset.target).length > 8 * 1024 ||
      JSON.stringify(reset.backend).length > 8 * 1024
    )
      throw new Error(`T15 fresh reset ${expected.attemptId} target/backend rows exceed the bound`);
    if (reusableBuild && reset.helperFingerprint !== reusableBuild.helperFingerprint)
      throw new Error(`T15 fresh reset ${expected.attemptId} has stale helper provenance`);
    if (
      reset.cleanupStatus !== 'cleaned' &&
      !(allowFailedRecovery && reset.cleanupStatus === 'failed-recovery-ledger-retained')
    )
      throw new Error(`T15 fresh reset ${expected.attemptId} has non-terminal cleanup`);
    if (reset.cleanupStatus === 'cleaned' && reset.blocker !== null)
      throw new Error(`T15 fresh reset ${expected.attemptId} carries a blocker`);
    if (reset.cleanupStatus === 'failed-recovery-ledger-retained' && !reset.blocker)
      throw new Error(`T15 failed reset ${expected.attemptId} lacks a recovery blocker`);
    verifyResetBinding(reset, expected, cohort, outputRoot);
  } else if (
    reset.finishedAt !== null ||
    reset.appStateFingerprint !== null ||
    reset.fixtureStateFingerprint !== null ||
    reset.sourceFingerprint !== null ||
    reset.helperFingerprint !== null ||
    reset.originalResetBinding.status !== 'pending' ||
    reset.cleanupStatus !== 'not-acquired' ||
    !reset.blocker
  ) {
    throw new Error(`T15 blocked reset ${expected.attemptId} contains acquired-state evidence`);
  }
}

function validateOwnership(
  identity: NativeComparisonColdAttemptIdentity,
  expected: NativeComparisonAttemptExpectation,
  requireAcquired = false,
): void {
  if (identity.ownerRunId !== expected.runId)
    throw new Error(`T15 ownerRunId mismatch for ${expected.attemptId}`);
  if (identity.processPid === null) {
    if (
      identity.processStartIdentity !== null ||
      identity.ownedPorts.length ||
      identity.ownershipWindows.length
    )
      throw new Error(`T15 blocked attempt ${expected.attemptId} has acquired ownership fields`);
    if (requireAcquired)
      throw new Error(`T15 terminal attempt ${expected.attemptId} lacks acquired ownership`);
    return;
  }
  if (
    !Number.isSafeInteger(identity.processPid) ||
    identity.processPid <= 0 ||
    !identity.processStartIdentity
  )
    throw new Error(`T15 acquired attempt ${expected.attemptId} lacks process start identity`);
  if (
    identity.ownershipWindows.some((window) => !['process', 'port'].includes(window.resourceType))
  )
    throw new Error(`T15 ownership window has an unknown resource type for ${expected.attemptId}`);
  if (identity.ownedPorts.some((port) => !Number.isSafeInteger(port) || port <= 0))
    throw new Error(`T15 acquired attempt ${expected.attemptId} has an invalid owned port`);
  const processWindows = identity.ownershipWindows.filter(
    (window) => window.resourceType === 'process',
  );
  const portWindows = identity.ownershipWindows.filter((window) => window.resourceType === 'port');
  if (
    processWindows.length !== 1 ||
    portWindows.length !== identity.ownedPorts.length ||
    identity.ownedPorts.length === 0
  )
    throw new Error(
      `T15 acquired attempt ${expected.attemptId} does not close each process/port window`,
    );
  const expectedPortIds = new Set(identity.ownedPorts.map(String));
  const actualPortIds = new Set(portWindows.map((window) => window.resourceId));
  if (
    expectedPortIds.size !== actualPortIds.size ||
    [...expectedPortIds].some((port) => !actualPortIds.has(port))
  )
    throw new Error(`T15 port ownership is incomplete for ${expected.attemptId}`);
  for (const window of identity.ownershipWindows) {
    if (
      window.ownerRunId !== expected.runId ||
      !window.acquiredAt ||
      !window.releasedAt ||
      !Number.isFinite(isoMilliseconds(window.acquiredAt)) ||
      !Number.isFinite(isoMilliseconds(window.releasedAt)) ||
      isoMilliseconds(window.releasedAt) <= isoMilliseconds(window.acquiredAt)
    )
      throw new Error(
        `T15 ownership window is open, reversed or foreign for ${expected.attemptId}`,
      );
    if (window.resourceType === 'process') {
      if (
        window.resourceId !== String(identity.processPid) ||
        window.processStartIdentity !== identity.processStartIdentity
      )
        throw new Error(`T15 process ownership is not bound for ${expected.attemptId}`);
    } else if (window.processStartIdentity !== null) {
      throw new Error(
        `T15 port ownership carries an invalid process start identity for ${expected.attemptId}`,
      );
    }
  }
}

async function verifyReceipt(
  receipt: NativeComparisonReceiptInput,
  expected: NativeComparisonAttemptExpectation,
  identity: NativeComparisonColdAttemptIdentity,
  receiptStatus: ColdAttemptTerminalStatus,
  outputRoot: string,
): Promise<NativeComparisonReceiptInput> {
  const receiptPath = path.resolve(receipt.path);
  const artifactRoot = path.resolve(receipt.artifactRoot);
  const root = path.resolve(outputRoot);
  if (!pathInside(root, artifactRoot) || !pathInside(artifactRoot, receiptPath))
    throw new Error(`T15 receipt ${expected.attemptId} escapes the owned output root`);
  const [readBack] = await readNativeComparisonReceipts([receiptPath]);
  if (
    readBack.path !== receiptPath ||
    readBack.artifactRoot !== artifactRoot ||
    readBack.receiptHash !== receipt.receiptHash ||
    canonical(readBack.receipt) !== canonical(receipt.receipt)
  )
    throw new Error(`T15 receipt ${expected.attemptId} changed before immutable binding`);
  const binding = identity.originalReceiptBinding;
  if (
    binding.status !== 'verified' ||
    binding.receiptPath !== readBack.path ||
    binding.artifactRoot !== readBack.artifactRoot ||
    binding.receiptHash !== readBack.receiptHash
  )
    throw new Error(`T15 receipt ${expected.attemptId} is not bound to its cold identity`);
  if (
    !isRecord(readBack.receipt) ||
    readBack.receipt.runId !== expected.runId ||
    readBack.receipt.attemptId !== expected.attemptId ||
    !['passed', 'application-failed', 'harness-blocked', 'cancelled'].includes(
      readBack.receipt.result as string,
    )
  )
    throw new Error(`T15 receipt ${expected.attemptId} is not bound to the expected run`);
  if (
    (receiptStatus === 'received' &&
      !['passed', 'application-failed'].includes(readBack.receipt.result as string)) ||
    (receiptStatus === 'application-failed' && readBack.receipt.result !== 'application-failed') ||
    (receiptStatus === 'harness-blocked' && readBack.receipt.result !== 'harness-blocked') ||
    (receiptStatus === 'cancelled' && readBack.receipt.result !== 'cancelled')
  )
    throw new Error(`T15 receipt ${expected.attemptId} result disagrees with its status`);
  return readBack;
}

function replaceIdentity(
  spec: NativeComparisonSpec,
  attempts: readonly ColdComparisonAttemptReceipt[],
): NativeComparisonSpec {
  const byId = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  return {
    ...spec,
    cells: spec.cells.map((cell) => ({
      ...cell,
      expectedAttempts: cell.expectedAttempts.map((expected) => {
        const attempt = byId.get(expected.attemptId);
        // Retain the raw terminal row above for auditability, but do not feed a
        // foreign or otherwise rejected owner identity into the comparator. A
        // failed post-acquisition validation is a blocked requested row, not a
        // malformed comparison matrix that prevents the denominator report.
        const identity =
          attempt &&
          !attempt.issue?.includes('terminal-evidence-blocked:') &&
          attempt.coldAttemptIdentity.ownerRunId === expected.runId
            ? attempt.coldAttemptIdentity
            : blockedIdentity(expected);
        return { ...expected, coldAttemptIdentity: identity };
      }),
    })),
  };
}

function validateDispatchResult(
  result: ColdComparisonAttemptReceipt,
  expected: NativeComparisonAttemptExpectation,
  cohort: NativeComparisonSpec['cohort'],
  outputRoot: string,
  reusableBuild: QualifiedBuildReuse | null,
  allowFailedRecovery = false,
): void {
  if (
    result.runId !== expected.runId ||
    result.attemptId !== expected.attemptId ||
    result.ownerRunId !== expected.runId ||
    result.reset.fixtureResetId !== expected.fixtureResetId
  )
    throw new Error(`T15 producer result ownerRunId/attempt is not bound to ${expected.attemptId}`);
  validateReset(result.reset, expected, cohort, outputRoot, reusableBuild, allowFailedRecovery);
  const requireAcquired =
    result.receipt !== null ||
    result.status === 'received' ||
    result.status === 'application-failed';
  validateOwnership(result.coldAttemptIdentity, expected, requireAcquired);
  if (result.status === 'received' || result.status === 'application-failed') {
    if (!result.receipt)
      throw new Error(`T15 ${result.status} ${expected.attemptId} lacks an original receipt`);
    if (result.coldAttemptIdentity.originalReceiptBinding.status !== 'verified')
      throw new Error(
        `T15 ${expected.attemptId} has a receipt without a verified original binding`,
      );
  } else if (result.receipt !== null) {
    if (result.status === 'missing')
      throw new Error(`T15 missing attempt ${expected.attemptId} returned an original receipt`);
    if (result.coldAttemptIdentity.originalReceiptBinding.status !== 'verified')
      throw new Error(`T15 retained receipt ${expected.attemptId} lacks a verified binding`);
  }
  if (
    result.coldAttemptIdentity.processPid !== null &&
    result.status === 'received' &&
    result.receipt === null
  )
    throw new Error(`T15 received ${expected.attemptId} lacks a retained original receipt`);
}

async function retainAttempt(
  result: ColdComparisonAttemptReceipt,
  expected: NativeComparisonAttemptExpectation,
  cohort: NativeComparisonSpec['cohort'],
  outputRoot: string,
  reusableBuild: QualifiedBuildReuse | null,
): Promise<NativeComparisonReceiptInput | null> {
  try {
    validateDispatchResult(result, expected, cohort, outputRoot, reusableBuild, true);
    if (result.receipt) {
      const readBack = await verifyReceipt(
        result.receipt,
        expected,
        result.coldAttemptIdentity,
        result.status,
        outputRoot,
      );
      result.receipt = readBack;
      if (isRecord(readBack.receipt) && readBack.receipt.result === 'application-failed')
        result.status = 'application-failed';
      return readBack;
    }
    return null;
  } catch (error) {
    const issue = `terminal-evidence-blocked:${error instanceof Error ? error.message : 'unknown'}`;
    result.issue = result.issue ? `${result.issue};${issue}` : issue;
    // A receipt is an observed terminal artifact even when ownership proof is
    // incomplete. Retain that raw row, but retire its received/application
    // status so downstream comparison sees a blocked requested attempt. A
    // completely pre-acquisition row with no receipt remains a normal throw.
    if (result.receipt !== null) {
      result.status = 'harness-blocked';
      return null;
    }
    if (result.coldAttemptIdentity.processPid !== null) {
      result.status = 'harness-blocked';
      return null;
    }
    throw error;
  }
}

function checkBuildReuse(
  buildReuse: CohortBuildReuse,
  cohort: NativeComparisonSpec['cohort'],
): void {
  if (
    buildReuse.sourceFingerprint !== cohort.sourceFingerprint ||
    buildReuse.flagsFingerprint !== cohort.flagsFingerprint ||
    !sha256.test(buildReuse.sourceFingerprint) ||
    !sha256.test(buildReuse.helperFingerprint) ||
    !sha256.test(buildReuse.flagsFingerprint)
  )
    throw new Error('T15 cohort build reuse is stale or missing helper/source fingerprints');
  for (const platform of fullPlatforms) {
    const build = buildReuse.byPlatform[platform];
    if (build !== null && (build.platform !== platform || build.current !== true))
      throw new Error(`T15 build reuse is not current for ${platform}`);
  }
}

/**
 * Dispatch the frozen T15 matrix serially in declared pair/trial order. This
 * function owns scheduling and provenance validation only. It never creates a
 * native process, device, port, backend, or hosted resource itself.
 */
export async function runNativeComparisonCohort(input: {
  spec: NativeComparisonSpec;
  signal: AbortSignal;
  outputRoot: string;
  buildReuse: CohortBuildReuse;
  select: ColdComparisonSelectionResolver;
  reset: ColdComparisonResetProducer;
  produce: ColdComparisonAttemptProducer;
  /** Optional one-owner path; it replaces the split reset/public child. */
  ownedAttempt?: ColdComparisonOwnedAttemptProducer;
  /** Per-attempt budget used to form one absolute owned lifecycle deadline. */
  attemptDeadlineMs?: number;
  /** Preserve an acquired reset row when cleanup leaves a recovery ledger. */
  preserveFailedResetEvidence?: boolean;
}): Promise<NativeComparisonDispatchReport> {
  const spec = validateNativeComparisonSpec(input.spec);
  const expectedById = validateFullDispatchShape(spec);
  checkBuildReuse(input.buildReuse, spec.cohort);
  if (
    input.attemptDeadlineMs !== undefined &&
    (!Number.isSafeInteger(input.attemptDeadlineMs) ||
      input.attemptDeadlineMs < 100 ||
      input.attemptDeadlineMs > 600_000)
  )
    throw new Error('T15 owned attempt deadline is outside the bounded range');
  if (!path.isAbsolute(input.outputRoot)) throw new Error('T15 outputRoot must be absolute');
  if (
    typeof input.select !== 'function' ||
    typeof input.reset !== 'function' ||
    typeof input.produce !== 'function'
  )
    throw new Error('T15 dispatcher requires selection, reset and attempt producers');

  const attempts: ColdComparisonAttemptReceipt[] = [];
  const receipts: NativeComparisonReceiptInput[] = [];
  const physicalAttemptOrder: string[] = [];
  const issues: string[] = [];
  let cancelled = false;
  let producerInvocations = 0;
  const appendBlocked = (
    expected: NativeComparisonAttemptExpectation,
    status: Extract<ColdAttemptTerminalStatus, 'cancelled' | 'harness-blocked' | 'missing'>,
    issue: string,
    reset?: FreshColdReset,
  ) => {
    const row = blockedAttempt(expected, status, issue, spec.cohort.fixtureResetFingerprint, reset);
    attempts.push(row);
    physicalAttemptOrder.push(expected.attemptId);
    issues.push(`${expected.attemptId}:${issue}`);
  };

  for (const pair of spec.executionOrder) {
    for (const trial of pair.trials) {
      for (const attemptId of [trial.firstAttemptId, trial.secondAttemptId]) {
        const dispatchExpected = expectedById.get(attemptId);
        const expected = dispatchExpected?.expected;
        if (!dispatchExpected || !expected)
          throw new Error(`T15 execution order references unknown ${attemptId}`);
        if (cancelled || input.signal.aborted) {
          cancelled = true;
          appendBlocked(expected, 'cancelled', 'dispatcher-aborted-before-acquisition');
          continue;
        }
        physicalAttemptOrder.push(attemptId);
        let selection: NativePilotSelection;
        let producerTerminal: ColdComparisonAttemptReceipt | null = null;
        try {
          selection = await input.select(expected);
          validateSelection(selection, expected, dispatchExpected.cell);
        } catch (error) {
          appendBlocked(
            expected,
            'harness-blocked',
            `selection-blocked:${error instanceof Error ? error.message : 'unknown'}`,
          );
          physicalAttemptOrder.pop();
          continue;
        }
        if (input.signal.aborted) {
          cancelled = true;
          appendBlocked(
            expected,
            'cancelled',
            'dispatcher-aborted-after-selection-before-acquisition',
          );
          physicalAttemptOrder.pop();
          continue;
        }
        let build: QualifiedBuildReuse | null;
        try {
          build = buildFor(input.buildReuse, dispatchExpected.cell.platform, expected);
        } catch (error) {
          appendBlocked(
            expected,
            'harness-blocked',
            `build-blocked:${error instanceof Error ? error.message : 'unknown'}`,
          );
          physicalAttemptOrder.pop();
          continue;
        }
        if (input.ownedAttempt) {
          try {
            producerInvocations += 1;
            const result = await input.ownedAttempt({
              spec,
              expected,
              selection,
              signal: input.signal,
              reusableBuild: build,
              deadlineAtMonotonicMs: performance.now() + (input.attemptDeadlineMs ?? 600_000),
              terminalize: () => {
                throw new Error('T15 owned producer cannot publish a second terminal row');
              },
            });
            const readBack = await retainAttempt(
              result,
              expected,
              spec.cohort,
              input.outputRoot,
              build,
            );
            attempts.push(result);
            if (readBack) receipts.push(readBack);
            if (result.issue) issues.push(`${expected.attemptId}:${result.issue}`);
          } catch (error) {
            appendBlocked(
              expected,
              input.signal.aborted ? 'cancelled' : 'harness-blocked',
              `owned-producer-blocked:${error instanceof Error ? error.message : 'unknown'}`,
            );
            physicalAttemptOrder.pop();
            if (input.signal.aborted) cancelled = true;
          }
          continue;
        }
        let reset: FreshColdReset;
        try {
          reset = await input.reset({
            spec,
            expected,
            selection,
            signal: input.signal,
            reusableBuild: build,
            outputRoot: input.outputRoot,
          });
          validateReset(
            reset,
            expected,
            spec.cohort,
            input.outputRoot,
            build,
            input.preserveFailedResetEvidence === true,
          );
        } catch (error) {
          appendBlocked(
            expected,
            'harness-blocked',
            `reset-blocked:${error instanceof Error ? error.message : 'unknown'}`,
          );
          physicalAttemptOrder.pop();
          continue;
        }
        if (reset.status === 'blocked') {
          appendBlocked(
            expected,
            'harness-blocked',
            `reset-blocked:${reset.blocker ?? 'unknown'}`,
            reset,
          );
          physicalAttemptOrder.pop();
          continue;
        }
        if (reset.status === 'fresh' && reset.cleanupStatus === 'failed-recovery-ledger-retained') {
          appendBlocked(
            expected,
            'harness-blocked',
            `reset-blocked:${reset.blocker ?? 'cleanup-recovery-required'}`,
            reset,
          );
          physicalAttemptOrder.pop();
          continue;
        }
        if (input.signal.aborted) {
          cancelled = true;
          appendBlocked(
            expected,
            'cancelled',
            'dispatcher-aborted-after-reset-before-acquisition',
            reset,
          );
          physicalAttemptOrder.pop();
          continue;
        }
        try {
          producerInvocations += 1;
          const result = await input.produce({
            spec,
            expected,
            selection,
            signal: input.signal,
            reusableBuild: build,
            reset,
            terminalize: (terminal) => {
              if (producerTerminal) throw new Error('T15 producer terminalized more than once');
              producerTerminal = terminal;
            },
          });
          if (producerTerminal)
            throw new Error('T15 producer returned after registering terminal evidence');
          const readBack = await retainAttempt(
            result,
            expected,
            spec.cohort,
            input.outputRoot,
            build,
          );
          attempts.push(result);
          if (readBack) receipts.push(readBack);
          if (result.issue) issues.push(`${expected.attemptId}:${result.issue}`);
        } catch (error) {
          const terminal =
            error instanceof ColdComparisonAttemptError ? error.terminal : producerTerminal;
          if (terminal) {
            if (terminal.runId !== expected.runId || terminal.attemptId !== expected.attemptId) {
              appendBlocked(
                expected,
                'harness-blocked',
                `producer-terminal-mismatch:${error instanceof Error ? error.message : 'unknown'}`,
                reset,
              );
              physicalAttemptOrder.pop();
              continue;
            }
            try {
              const readBack = await retainAttempt(
                terminal,
                expected,
                spec.cohort,
                input.outputRoot,
                build,
              );
              attempts.push(terminal);
              if (readBack) receipts.push(readBack);
              issues.push(
                `${expected.attemptId}:producer-terminal:${error instanceof Error ? error.message : 'unknown'}`,
              );
              if (terminal.issue) issues.push(`${expected.attemptId}:${terminal.issue}`);
              continue;
            } catch (terminalError) {
              if (terminal.coldAttemptIdentity.processPid !== null) {
                terminal.issue = terminal.issue
                  ? `${terminal.issue};terminal-invalid:${terminalError instanceof Error ? terminalError.message : 'unknown'}`
                  : `terminal-invalid:${terminalError instanceof Error ? terminalError.message : 'unknown'}`;
                terminal.status = 'harness-blocked';
                attempts.push(terminal);
                issues.push(`${expected.attemptId}:${terminal.issue}`);
                continue;
              }
            }
          }
          const reason = `producer-blocked:${error instanceof Error ? error.message : 'unknown'}`;
          appendBlocked(expected, 'harness-blocked', reason, reset);
          physicalAttemptOrder.pop();
        }
      }
    }
  }

  const runtimeSpec = replaceIdentity(spec, attempts);
  let comparison: ReturnType<typeof collectNativeComparison> | null = null;
  try {
    comparison = collectNativeComparison(runtimeSpec, receipts);
  } catch (error) {
    issues.push(`collector-blocked:${error instanceof Error ? error.message : 'unknown'}`);
  }
  return {
    schemaVersion: 1,
    sourceOnly: true,
    nativeExecution: 'not-run',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    scope: spec.scope,
    requestedCells: spec.cells.length,
    requestedAttempts: 400,
    scheduledAttempts: attempts.length,
    dispatchedAttempts: producerInvocations,
    terminalStatus: cancelled ? 'cancelled' : 'complete',
    physicalAttemptOrder,
    attempts,
    receipts,
    comparison,
    issues,
  };
}

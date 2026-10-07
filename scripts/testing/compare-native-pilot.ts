import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNativeEvidenceObservation } from './native-view-evidence';
import { assertPublicReceipt } from './schema-validation';
import type { NativeEvidenceIdentity, NativeEvidenceObservation } from './native-view-evidence';

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const hash64 = /^[a-f0-9]{64}$/;
const sha40 = /^[a-f0-9]{40}$/;
const scenarioId = /^SCN-[A-Za-z0-9._-]+$/;
const fullFamilies = ['session', 'training', 'connection', 'camera-denied', 'save-retry'] as const;
const platforms = ['ios', 'android'] as const;
const engines = ['maestro', 'detox'] as const;
const modes = ['fixture', 'integration'] as const;
const locales = ['en-US', 'pt-BR', 'es-ES'] as const;
const timingKeys = ['build', 'install', 'reset', 'scenario', 'verify', 'cleanup'] as const;
const expectedNativePhase = 'P4';
const expectedNativeLayer = 'native';
const iosDetoxTerminalPublicationBinding = 'terminal-publication-binding.private.json';

export type NativeComparisonPlatform = (typeof platforms)[number];
export type NativeComparisonEngine = (typeof engines)[number];
export type NativeComparisonMode = (typeof modes)[number];
export type NativeComparisonLocale = (typeof locales)[number];
export type NativeComparisonResult =
  'passed' | 'application-failed' | 'harness-blocked' | 'cancelled';
export type NativeComparisonDecision = 'eligible' | 'blocked';

/** Reviewed input identity; runtime reset/cleanup proof is intentionally separate. */
export type NativeComparisonCohortExpectation = {
  id: string;
  sourceFingerprint: string;
  fixtureResetFingerprint: string;
  /** Stable flags value; scenario and fixture hashes remain pair-scoped. */
  flagsFingerprint: string;
  /** Binary/build differences require an explicit instrumentation note. */
  instrumentationOnlyDifferences: NativeComparisonInstrumentationDifference[];
};

export type NativeComparisonCellIdentity = {
  scenarioId: string;
  platform: NativeComparisonPlatform;
  engine: NativeComparisonEngine;
  mode: NativeComparisonMode;
  locale: NativeComparisonLocale;
};

export type NativeComparisonRepositoryExpectation = {
  name: string;
  sha: string;
  dirty: boolean;
  workingTreeHash: string | null;
};

export type NativeComparisonAssertionLedgerEntry = {
  id: string;
  requirementRefs: string[];
  requirementPaths: string[];
  evidenceKinds: ('ui' | 'api' | 'sql')[];
  startingState: string;
  action: string;
  expected: string;
  evidencePathTemplates: string[];
};

/** Generated from the canonical native inventory's pilotAssertions contract. */
export type NativeComparisonAssertionLedger = {
  sourcePath: 'docs/qa/native-pilot/inventory.json';
  sourceHash: string;
  dataMode: NativeComparisonMode;
  contractHash: string;
  semanticHash: string | null;
  entries: NativeComparisonAssertionLedgerEntry[];
};

export type NativeComparisonInstrumentationDifference = {
  platform: NativeComparisonPlatform;
  reason: string;
};

export type NativeComparisonTargetExpectation = {
  deviceId: string | null;
  osVersion: string | null;
  appId: string | null;
  buildProfile: string | null;
  binaryHash: string | null;
  apiOrigin: string | null;
};

export type NativeComparisonInputExpectation = {
  scenarioHash: string | null;
  requirementHash: string | null;
  fixtureHash: string | null;
  flagsHash: string | null;
  toolVersions: Record<string, string>;
};

export type NativeComparisonOwnershipWindow = {
  resourceType: 'process' | 'port';
  resourceId: string;
  ownerRunId: string;
  processStartIdentity: string | null;
  acquiredAt: string;
  releasedAt: string;
};

export type NativeComparisonOriginalReceiptBinding = {
  status: 'verified' | 'pending';
  receiptPath: string | null;
  artifactRoot: string | null;
  receiptHash: string | null;
};

export type NativeComparisonColdAttemptIdentity = {
  /** The owned run identity for this resource window; it must equal runId. */
  ownerRunId: string;
  /** Null means the attempt was blocked before acquiring a child process. */
  processPid: number | null;
  /** The OS start identity distinguishes sequential PID reuse. */
  processStartIdentity: string | null;
  ownedPorts: number[];
  /** Closed ownership windows permit sequential reuse after release. */
  ownershipWindows: NativeComparisonOwnershipWindow[];
  /** Pending bindings are retained as blocked rows and can never qualify. */
  originalReceiptBinding: NativeComparisonOriginalReceiptBinding;
};

/**
 * Expected inputs are deliberately attached to each requested attempt. A
 * caller may generate this matrix from a reviewed build/fixture manifest, but
 * this collector never infers that two run-specific fixture hashes are
 * equivalent merely because the receipts look similar.
 */
export type NativeComparisonAttemptExpectation = {
  /** The immutable source run identity. A retry must receive a new pair. */
  runId: string;
  /** Stable ordinal for one of the independent cold trials in this cell. */
  trialOrdinal: number;
  attemptId: string;
  locale: NativeComparisonLocale;
  cohortId: string;
  /** Reviewed reset slot identity; the receipt schema does not claim reset freshness. */
  fixtureResetId: string;
  repositories: NativeComparisonRepositoryExpectation[];
  target: NativeComparisonTargetExpectation;
  inputs: NativeComparisonInputExpectation;
  /** Reviewed freshness slots; runtime capture must bind actual PID/port receipts later. */
  coldAttemptIdentity: NativeComparisonColdAttemptIdentity;
};

export type NativeComparisonCell = NativeComparisonCellIdentity & {
  requiredAssertionIds: string[];
  assertionLedger: NativeComparisonAssertionLedger;
  expectedAttempts: NativeComparisonAttemptExpectation[];
};

/**
 * A reviewed pair identity deliberately excludes engine so the two engine
 * cells cannot be paired accidentally across scenario, platform, mode, or
 * locale. Pair IDs are stable review references, not receipt-derived values.
 */
export type NativeComparisonPairIdentity = {
  pairId: string;
  scenarioId: string;
  platform: NativeComparisonPlatform;
  mode: NativeComparisonMode;
  locale: NativeComparisonLocale;
};

export type NativeComparisonOrderTrial = {
  trialOrdinal: number;
  firstAttemptId: string;
  secondAttemptId: string;
};

export type NativeComparisonExecutionOrder = NativeComparisonPairIdentity & {
  firstEngine: NativeComparisonEngine;
  trials: NativeComparisonOrderTrial[];
};

export type NativeComparisonSpec = {
  schemaVersion: 1;
  cohort: NativeComparisonCohortExpectation;
  /** `full` is the only scope eligible for the declared 400-attempt gate. */
  scope: 'full' | 'partial';
  attemptsPerCell: number;
  minimumFirstAttemptPasses?: number;
  cells: NativeComparisonCell[];
  /** Explicit reviewed order for every pair of engine cells in the matrix. */
  executionOrder: NativeComparisonExecutionOrder[];
};

export type NativeComparisonReceiptInput = {
  path: string;
  artifactRoot: string;
  receipt: unknown;
  /** SHA-256 of the exact receipt bytes read from its canonical file. */
  receiptHash: string;
  /** Required for the public iOS/Detox route; absent for legacy lanes. */
  terminalPublicationBinding?: NativeComparisonTerminalPublicationBinding | null;
};

export type NativeComparisonTerminalPublicationBinding = {
  kind: 'native-detox-ios-terminal-publication-binding-v1';
  status: 'published';
  receiptPath: string;
  receiptHash: string;
  receiptIdentity: NativeEvidenceIdentity;
  outputRoot: string;
  outputIdentity: {
    path: string;
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
  };
  requestedRunId: string;
  requestedAttemptId: string;
  deadlineAtMonotonicMs: number;
  committedAtMonotonicMs: number;
  writer: { kind: 'native-pilot-terminal-receipt'; pid: number };
};

// Only actual protected intake can register an original descriptor identity.
// The WeakMap does not change or trust the public receipt input shape.
const protectedReceiptIdentities = new WeakMap<
  NativeComparisonReceiptInput,
  NativeEvidenceIdentity
>();

export type NativeComparisonAttemptReport = NativeComparisonCellIdentity & {
  cohortId: string;
  fixtureResetId: string;
  trialOrdinal: number;
  expectedRunId: string;
  runId: string | null;
  attemptId: string;
  receiptPath: string | null;
  receiptHash: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  received: boolean;
  receiptValid: boolean;
  /** Public receipt identity/fingerprint is usable for chronology checks. */
  orderCompatible: boolean;
  result: NativeComparisonResult | null;
  childExitCode: number | null;
  cleanupStatus: string | null;
  cleanupFailure: boolean;
  passed: boolean;
  timingMs: Partial<Record<(typeof timingKeys)[number], number>>;
  assertionIds: string[];
  issues: string[];
};

export type NativeComparisonTimingStats = {
  count: number;
  p50: number | null;
  p95: number | null;
};

export type NativeComparisonCellReport = NativeComparisonCellIdentity & {
  cohortId: string;
  key: string;
  requested: number;
  received: number;
  missing: number;
  passed: number;
  firstAttemptPasses: number;
  applicationFailures: number;
  harnessBlocks: number;
  cancellations: number;
  invalidReceipts: number;
  incompatibleReceipts: number;
  cleanupFailures: number;
  requiredAssertionIds: string[];
  completeAssertionPasses: number;
  timingMs: Record<(typeof timingKeys)[number], NativeComparisonTimingStats>;
  decision: NativeComparisonDecision;
  reasons: string[];
};

export type NativeComparisonExecutionOrderTrialReport = NativeComparisonOrderTrial & {
  status: 'verified' | 'blocked';
  issues: string[];
};

export type NativeComparisonExecutionOrderPairReport = NativeComparisonPairIdentity & {
  firstEngine: NativeComparisonEngine;
  expectedTrials: number;
  verifiedTrials: number;
  status: 'verified' | 'blocked';
  issues: string[];
  trials: NativeComparisonExecutionOrderTrialReport[];
};

export type NativeComparisonExecutionOrderReport = {
  required: boolean;
  status: 'not-required' | 'verified' | 'blocked';
  expectedPairs: number;
  verifiedPairs: number;
  expectedTrials: number;
  verifiedTrials: number;
  pairs: NativeComparisonExecutionOrderPairReport[];
};

export type NativeComparisonReport = {
  schemaVersion: 1;
  cohort: NativeComparisonCohortExpectation;
  scope: NativeComparisonSpec['scope'];
  threshold: {
    attemptsPerCell: number;
    minimumFirstAttemptPasses: number;
    requiredCells: number;
    requiredAttempts: number;
  };
  matrix: {
    requestedCells: number;
    completeCells: number;
    requestedAttempts: number;
    receivedAttempts: number;
    missingAttempts: number;
    fullGateShape: boolean;
  };
  allCellsEligible: boolean;
  /** Full reviewed matrix plus every source gate, excluding adoption/T18/T19. */
  comparisonEligible: boolean;
  executionOrder: NativeComparisonExecutionOrderReport;
  adoptionDecision: 'blocked';
  adoptionDecisionReason: string;
  gateLimitations: {
    nonPassingOutcomeEvidence: 'not-modeled';
    controlledRegressionEvidence: 'not-modeled';
    maintenanceEvidence: 'not-modeled';
  };
  cells: NativeComparisonCellReport[];
  attempts: NativeComparisonAttemptReport[];
};

export class NativeComparisonInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeComparisonInputError';
  }
}

export function nativeComparisonCellKey(identity: NativeComparisonCellIdentity): string {
  return JSON.stringify([
    identity.scenarioId,
    identity.platform,
    identity.engine,
    identity.mode,
    identity.locale,
  ]);
}

function nativeComparisonCellBaseKey(identity: NativeComparisonCellIdentity): string {
  return JSON.stringify([identity.scenarioId, identity.platform, identity.engine, identity.mode]);
}

function nativeComparisonPairKey(identity: NativeComparisonPairIdentity): string {
  return JSON.stringify([identity.scenarioId, identity.platform, identity.mode, identity.locale]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new NativeComparisonInputError(message);
  return value;
}

function requireNonemptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value)
    throw new NativeComparisonInputError(message);
  return value;
}

function requireHash(value: unknown, message: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !hash64.test(value))
    throw new NativeComparisonInputError(message);
  return value;
}

function requireRequiredHash(value: unknown, message: string): string {
  if (typeof value !== 'string' || !hash64.test(value))
    throw new NativeComparisonInputError(message);
  return value;
}

function requireNullableString(value: unknown, message: string): string | null {
  if (value === null) return null;
  return requireNonemptyString(value, message);
}

function requireLocale(value: unknown, message: string): NativeComparisonLocale {
  if (!locales.includes(value as NativeComparisonLocale))
    throw new NativeComparisonInputError(message);
  return value as NativeComparisonLocale;
}

function validateCohort(value: unknown, label: string): NativeComparisonCohortExpectation {
  const row = requireRecord(value, `${label} must be an object`);
  const id = requireNonemptyString(row.id, `${label}.id is invalid`);
  if (!identifier.test(id)) throw new NativeComparisonInputError(`${label}.id is invalid`);
  const flagsFingerprint = requireRequiredHash(
    row.flagsFingerprint,
    `${label}.flagsFingerprint is invalid`,
  );
  if (!Array.isArray(row.instrumentationOnlyDifferences))
    throw new NativeComparisonInputError(
      `${label}.instrumentationOnlyDifferences must be an array`,
    );
  const instrumentationOnlyDifferences = row.instrumentationOnlyDifferences.map((value, index) => {
    const difference = requireRecord(
      value,
      `${label}.instrumentationOnlyDifferences[${index}] is invalid`,
    );
    if (!platforms.includes(difference.platform as NativeComparisonPlatform))
      throw new NativeComparisonInputError(
        `${label}.instrumentationOnlyDifferences[${index}].platform is invalid`,
      );
    const reason = requireNonemptyString(
      difference.reason,
      `${label}.instrumentationOnlyDifferences[${index}].reason is invalid`,
    );
    return {
      platform: difference.platform as NativeComparisonPlatform,
      reason,
    };
  });
  if (
    new Set(instrumentationOnlyDifferences.map((difference) => difference.platform)).size !==
    instrumentationOnlyDifferences.length
  )
    throw new NativeComparisonInputError(
      `${label}.instrumentationOnlyDifferences contains duplicate platforms`,
    );
  return {
    id,
    sourceFingerprint: requireRequiredHash(
      row.sourceFingerprint,
      `${label}.sourceFingerprint is invalid`,
    ),
    fixtureResetFingerprint: requireRequiredHash(
      row.fixtureResetFingerprint,
      `${label}.fixtureResetFingerprint is invalid`,
    ),
    flagsFingerprint,
    instrumentationOnlyDifferences,
  };
}

function firstAttemptId(runId: string): string {
  return `${runId}:first`;
}

function requireIdentity(value: unknown, label: string): NativeComparisonCellIdentity {
  const row = requireRecord(value, `${label} must be an object`);
  const scenario = requireNonemptyString(row.scenarioId, `${label}.scenarioId is invalid`);
  if (!scenarioId.test(scenario) || !identifier.test(scenario))
    throw new NativeComparisonInputError(`${label}.scenarioId is invalid`);
  if (!platforms.includes(row.platform as NativeComparisonPlatform))
    throw new NativeComparisonInputError(`${label}.platform is invalid`);
  if (!engines.includes(row.engine as NativeComparisonEngine))
    throw new NativeComparisonInputError(`${label}.engine is invalid`);
  if (!modes.includes(row.mode as NativeComparisonMode))
    throw new NativeComparisonInputError(`${label}.mode is invalid`);
  return {
    scenarioId: scenario,
    platform: row.platform as NativeComparisonPlatform,
    engine: row.engine as NativeComparisonEngine,
    mode: row.mode as NativeComparisonMode,
    locale: requireLocale(row.locale, `${label}.locale is invalid`),
  };
}

function validateRepositories(
  value: unknown,
  label: string,
): NativeComparisonRepositoryExpectation[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new NativeComparisonInputError(`${label} must contain repositories`);
  const names = new Set<string>();
  return value.map((item, index) => {
    const row = requireRecord(item, `${label}[${index}] is invalid`);
    const name = requireNonemptyString(row.name, `${label}[${index}].name is invalid`);
    if (names.has(name)) throw new NativeComparisonInputError(`${label} has duplicate repository`);
    names.add(name);
    if (typeof row.sha !== 'string' || !sha40.test(row.sha))
      throw new NativeComparisonInputError(`${label}[${index}].sha is invalid`);
    if (typeof row.dirty !== 'boolean')
      throw new NativeComparisonInputError(`${label}[${index}].dirty is invalid`);
    const workingTreeHash = row.workingTreeHash;
    if (
      workingTreeHash !== null &&
      (typeof workingTreeHash !== 'string' || !hash64.test(workingTreeHash))
    )
      throw new NativeComparisonInputError(`${label}[${index}].workingTreeHash is invalid`);
    if (row.dirty && workingTreeHash === null)
      throw new NativeComparisonInputError(`${label}[${index}] dirty input lacks workingTreeHash`);
    return {
      name,
      sha: row.sha,
      dirty: row.dirty,
      workingTreeHash: workingTreeHash === null ? null : String(workingTreeHash),
    };
  });
}

function validateTarget(
  value: unknown,
  label: string,
  mode: NativeComparisonMode,
): NativeComparisonTargetExpectation {
  const row = requireRecord(value, `${label} is invalid`);
  const target = {
    deviceId: requireNullableString(row.deviceId, `${label}.deviceId is invalid`),
    osVersion: requireNullableString(row.osVersion, `${label}.osVersion is invalid`),
    appId: requireNullableString(row.appId, `${label}.appId is invalid`),
    buildProfile: requireNullableString(row.buildProfile, `${label}.buildProfile is invalid`),
    binaryHash:
      row.binaryHash === null
        ? null
        : requireHash(row.binaryHash, `${label}.binaryHash is invalid`),
    apiOrigin: requireNullableString(row.apiOrigin, `${label}.apiOrigin is invalid`),
  };
  if (target.apiOrigin !== null && !/^https?:\/\/[^/?#]+$/.test(target.apiOrigin))
    throw new NativeComparisonInputError(`${label}.apiOrigin is invalid`);
  if (mode === 'integration' && target.apiOrigin === null)
    throw new NativeComparisonInputError(`${label}.apiOrigin is required for integration cells`);
  return target;
}

function validateInputs(value: unknown, label: string): NativeComparisonInputExpectation {
  const row = requireRecord(value, `${label} is invalid`);
  const toolVersions = requireRecord(row.toolVersions, `${label}.toolVersions is invalid`);
  const versions = Object.fromEntries(
    Object.entries(toolVersions).map(([name, version]) => [
      requireNonemptyString(name, `${label}.toolVersions key is invalid`),
      requireNonemptyString(version, `${label}.toolVersions.${name} is invalid`),
    ]),
  );
  if (Object.keys(versions).length === 0)
    throw new NativeComparisonInputError(`${label}.toolVersions is empty`);
  return {
    scenarioHash: requireHash(row.scenarioHash, `${label}.scenarioHash is invalid`),
    requirementHash: requireHash(row.requirementHash, `${label}.requirementHash is invalid`),
    fixtureHash: requireHash(row.fixtureHash, `${label}.fixtureHash is invalid`),
    flagsHash: requireHash(row.flagsHash, `${label}.flagsHash is invalid`),
    toolVersions: versions,
  };
}

function validateColdAttemptIdentity(
  value: unknown,
  label: string,
): NativeComparisonColdAttemptIdentity {
  const row = requireRecord(value, `${label} is invalid`);
  const ownerRunId = requireNonemptyString(row.ownerRunId, `${label}.ownerRunId is invalid`);
  if (!identifier.test(ownerRunId))
    throw new NativeComparisonInputError(`${label}.ownerRunId is invalid`);
  const processPid = row.processPid;
  if (processPid !== null && (!Number.isSafeInteger(processPid) || (processPid as number) < 2))
    throw new NativeComparisonInputError(`${label}.processPid is invalid`);
  const processStartIdentity =
    row.processStartIdentity === null
      ? null
      : requireNonemptyString(row.processStartIdentity, `${label}.processStartIdentity is invalid`);
  if (
    processStartIdentity !== null &&
    (processStartIdentity.length > 256 || /[\r\n]/.test(processStartIdentity))
  )
    throw new NativeComparisonInputError(`${label}.processStartIdentity is invalid`);
  if (processPid === null && processStartIdentity !== null)
    throw new NativeComparisonInputError(`${label}.processStartIdentity requires a process PID`);
  if (processPid !== null && processStartIdentity === null)
    throw new NativeComparisonInputError(
      `${label}.processStartIdentity is required with a process PID`,
    );
  const normalizedProcessPid = processPid as number | null;
  if (!Array.isArray(row.ownedPorts))
    throw new NativeComparisonInputError(`${label}.ownedPorts must be an array`);
  const ownedPorts = row.ownedPorts.map((port, index) => {
    if (!Number.isSafeInteger(port) || (port as number) < 1 || (port as number) > 65535)
      throw new NativeComparisonInputError(`${label}.ownedPorts[${index}] is invalid`);
    return port as number;
  });
  if (new Set(ownedPorts).size !== ownedPorts.length)
    throw new NativeComparisonInputError(`${label}.ownedPorts contains duplicates`);
  if (!Array.isArray(row.ownershipWindows))
    throw new NativeComparisonInputError(`${label}.ownershipWindows must be an array`);
  const ownershipWindows = row.ownershipWindows.map((value, index) => {
    const window = requireRecord(value, `${label}.ownershipWindows[${index}] is invalid`);
    const resourceType = window.resourceType as NativeComparisonOwnershipWindow['resourceType'];
    if (resourceType !== 'process' && resourceType !== 'port')
      throw new NativeComparisonInputError(
        `${label}.ownershipWindows[${index}].resourceType is invalid`,
      );
    const resourceId = requireNonemptyString(
      window.resourceId,
      `${label}.ownershipWindows[${index}].resourceId is invalid`,
    );
    if (!identifier.test(resourceId))
      throw new NativeComparisonInputError(
        `${label}.ownershipWindows[${index}].resourceId is invalid`,
      );
    const windowOwnerRunId = requireNonemptyString(
      window.ownerRunId,
      `${label}.ownershipWindows[${index}].ownerRunId is invalid`,
    );
    if (!identifier.test(windowOwnerRunId) || windowOwnerRunId !== ownerRunId)
      throw new NativeComparisonInputError(
        `${label}.ownershipWindows[${index}].ownerRunId is foreign`,
      );
    const windowProcessStartIdentity =
      window.processStartIdentity === null
        ? null
        : requireNonemptyString(
            window.processStartIdentity,
            `${label}.ownershipWindows[${index}].processStartIdentity is invalid`,
          );
    if (
      windowProcessStartIdentity !== null &&
      (windowProcessStartIdentity.length > 256 || /[\r\n]/.test(windowProcessStartIdentity))
    )
      throw new NativeComparisonInputError(
        `${label}.ownershipWindows[${index}].processStartIdentity is invalid`,
      );
    if (
      resourceType === 'process' &&
      (processPid === null ||
        resourceId !== String(normalizedProcessPid) ||
        windowProcessStartIdentity !== processStartIdentity)
    )
      throw new NativeComparisonInputError(
        `${label}.ownershipWindows[${index}] does not bind the process start identity`,
      );
    if (
      resourceType === 'port' &&
      (!ownedPorts.includes(Number(resourceId)) || windowProcessStartIdentity !== null)
    )
      throw new NativeComparisonInputError(
        `${label}.ownershipWindows[${index}] does not bind an owned port`,
      );
    const acquiredAt = requireNonemptyString(
      window.acquiredAt,
      `${label}.ownershipWindows[${index}].acquiredAt is invalid`,
    );
    const releasedAt = requireNonemptyString(
      window.releasedAt,
      `${label}.ownershipWindows[${index}].releasedAt is invalid`,
    );
    const acquiredMs = Date.parse(acquiredAt);
    const releasedMs = Date.parse(releasedAt);
    if (!Number.isFinite(acquiredMs) || !Number.isFinite(releasedMs) || acquiredMs >= releasedMs)
      throw new NativeComparisonInputError(
        `${label}.ownershipWindows[${index}] has an invalid interval`,
      );
    return {
      resourceType,
      resourceId,
      ownerRunId,
      processStartIdentity: windowProcessStartIdentity,
      acquiredAt,
      releasedAt,
    };
  });
  const windowKeys = ownershipWindows.map(
    (window) => `${window.resourceType}:${window.resourceId}`,
  );
  if (new Set(windowKeys).size !== windowKeys.length)
    throw new NativeComparisonInputError(`${label}.ownershipWindows contains duplicates`);
  if (
    (normalizedProcessPid !== null && !windowKeys.includes(`process:${normalizedProcessPid}`)) ||
    ownedPorts.some((port) => !windowKeys.includes(`port:${port}`))
  )
    throw new NativeComparisonInputError(
      `${label}.ownershipWindows does not cover every owned resource`,
    );
  const originalReceiptBinding = requireOriginalReceiptBinding(
    row.originalReceiptBinding,
    `${label}.originalReceiptBinding`,
  );
  return {
    ownerRunId,
    processPid: normalizedProcessPid,
    processStartIdentity,
    ownedPorts,
    ownershipWindows,
    originalReceiptBinding,
  };
}

function requireOriginalReceiptBinding(
  value: unknown,
  label: string,
): NativeComparisonOriginalReceiptBinding {
  const row = requireRecord(value, `${label} is invalid`);
  if (row.status === 'pending') {
    if (row.receiptPath !== null || row.artifactRoot !== null || row.receiptHash !== null)
      throw new NativeComparisonInputError(
        `${label}.pending binding must not contain receipt data`,
      );
    return {
      status: 'pending',
      receiptPath: null,
      artifactRoot: null,
      receiptHash: null,
    };
  }
  if (row.status !== 'verified') throw new NativeComparisonInputError(`${label}.status is invalid`);
  const receiptPath = requireNonemptyString(row.receiptPath, `${label}.receiptPath is invalid`);
  const artifactRoot = requireNonemptyString(row.artifactRoot, `${label}.artifactRoot is invalid`);
  if (!path.isAbsolute(receiptPath) || path.normalize(receiptPath) !== receiptPath)
    throw new NativeComparisonInputError(`${label}.receiptPath must be canonical absolute`);
  if (!path.isAbsolute(artifactRoot) || path.normalize(artifactRoot) !== artifactRoot)
    throw new NativeComparisonInputError(`${label}.artifactRoot must be canonical absolute`);
  return {
    status: 'verified',
    receiptPath,
    artifactRoot,
    receiptHash: requireRequiredHash(row.receiptHash, `${label}.receiptHash is invalid`),
  };
}

function validateAssertionLedger(
  value: unknown,
  label: string,
  mode: NativeComparisonMode,
): NativeComparisonAssertionLedger {
  const row = requireRecord(value, `${label} is invalid`);
  if (row.sourcePath !== 'docs/qa/native-pilot/inventory.json')
    throw new NativeComparisonInputError(`${label}.sourcePath must be the canonical inventory`);
  const sourceHash = requireRequiredHash(row.sourceHash, `${label}.sourceHash is invalid`);
  const dataMode = row.dataMode;
  if (dataMode !== mode)
    throw new NativeComparisonInputError(`${label}.dataMode must match the comparison cell`);
  const contractHash = requireRequiredHash(row.contractHash, `${label}.contractHash is invalid`);
  const semanticHash =
    row.semanticHash === null
      ? null
      : requireRequiredHash(row.semanticHash, `${label}.semanticHash is invalid`);
  if (!Array.isArray(row.entries) || row.entries.length === 0)
    throw new NativeComparisonInputError(`${label}.entries must be nonempty`);
  const entries = row.entries.map((value, index) => {
    const entry = requireRecord(value, `${label}.entries[${index}] is invalid`);
    const id = requireNonemptyString(entry.id, `${label}.entries[${index}].id is invalid`);
    if (!identifier.test(id))
      throw new NativeComparisonInputError(`${label}.entries[${index}].id is invalid`);
    const stringArray = (field: string): string[] => {
      const candidate = entry[field];
      if (!Array.isArray(candidate) || candidate.length === 0)
        throw new NativeComparisonInputError(`${label}.entries[${index}].${field} is invalid`);
      return candidate.map((item, itemIndex) => {
        const text = requireNonemptyString(
          item,
          `${label}.entries[${index}].${field}[${itemIndex}] is invalid`,
        );
        return text;
      });
    };
    const requirementRefs = stringArray('requirementRefs');
    const requirementPaths = stringArray('requirementPaths');
    const evidenceKinds = stringArray('evidenceKinds');
    if (evidenceKinds.some((kind) => !['ui', 'api', 'sql'].includes(kind)))
      throw new NativeComparisonInputError(`${label}.entries[${index}].evidenceKinds is invalid`);
    if (new Set(requirementRefs).size !== requirementRefs.length)
      throw new NativeComparisonInputError(
        `${label}.entries[${index}].requirementRefs contains duplicates`,
      );
    if (new Set(requirementPaths).size !== requirementPaths.length)
      throw new NativeComparisonInputError(
        `${label}.entries[${index}].requirementPaths contains duplicates`,
      );
    if (new Set(evidenceKinds).size !== evidenceKinds.length)
      throw new NativeComparisonInputError(
        `${label}.entries[${index}].evidenceKinds contains duplicates`,
      );
    const startingState = requireNonemptyString(
      entry.startingState,
      `${label}.entries[${index}].startingState is invalid`,
    );
    const action = requireNonemptyString(
      entry.action,
      `${label}.entries[${index}].action is invalid`,
    );
    const expected = requireNonemptyString(
      entry.expected,
      `${label}.entries[${index}].expected is invalid`,
    );
    const evidencePathTemplates = stringArray('evidencePathTemplates');
    if (evidencePathTemplates.length !== evidenceKinds.length)
      throw new NativeComparisonInputError(
        `${label}.entries[${index}].evidencePathTemplates must match evidenceKinds`,
      );
    if (
      evidencePathTemplates.some(
        (template) => !/^assertions\/\{attemptId\}\/[A-Za-z0-9_-]+\.private\.json$/.test(template),
      )
    )
      throw new NativeComparisonInputError(
        `${label}.entries[${index}].evidencePathTemplates is invalid`,
      );
    return {
      id,
      requirementRefs,
      requirementPaths,
      evidenceKinds: evidenceKinds as ('ui' | 'api' | 'sql')[],
      startingState,
      action,
      expected,
      evidencePathTemplates,
    };
  });
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new NativeComparisonInputError(`${label}.entries contains duplicate IDs`);
  if (hashCanonical(entries) !== contractHash)
    throw new NativeComparisonInputError(`${label}.contractHash does not match its entries`);
  const semanticEntries = entries.map(({ id: _id, ...entry }) => entry);
  if (semanticHash !== null && hashCanonical(semanticEntries) !== semanticHash)
    throw new NativeComparisonInputError(`${label}.semanticHash does not match its entries`);
  return {
    sourcePath: 'docs/qa/native-pilot/inventory.json',
    sourceHash,
    dataMode: dataMode as NativeComparisonMode,
    contractHash,
    semanticHash,
    entries,
  };
}

function validateExpectedAttempt(
  value: unknown,
  label: string,
  mode: NativeComparisonMode,
  cohort: NativeComparisonCohortExpectation,
): NativeComparisonAttemptExpectation {
  const row = requireRecord(value, `${label} is invalid`);
  const runId = requireNonemptyString(row.runId, `${label}.runId is invalid`);
  if (!identifier.test(runId)) throw new NativeComparisonInputError(`${label}.runId is invalid`);
  if (
    !Number.isSafeInteger(row.trialOrdinal) ||
    (row.trialOrdinal as number) < 1 ||
    (row.trialOrdinal as number) > 20
  )
    throw new NativeComparisonInputError(`${label}.trialOrdinal is invalid`);
  const attemptId = requireNonemptyString(row.attemptId, `${label}.attemptId is invalid`);
  if (!identifier.test(attemptId))
    throw new NativeComparisonInputError(`${label}.attemptId is invalid`);
  if (attemptId !== firstAttemptId(runId))
    throw new NativeComparisonInputError(
      `${label}.attemptId must encode the first attempt as ${firstAttemptId(runId)}`,
    );
  const cohortId = requireNonemptyString(row.cohortId, `${label}.cohortId is invalid`);
  if (!identifier.test(cohortId))
    throw new NativeComparisonInputError(`${label}.cohortId is invalid`);
  if (cohortId !== cohort.id)
    throw new NativeComparisonInputError(`${label}.cohortId must match the sealed cohort`);
  const fixtureResetId = requireNonemptyString(
    row.fixtureResetId,
    `${label}.fixtureResetId is invalid`,
  );
  if (!identifier.test(fixtureResetId))
    throw new NativeComparisonInputError(`${label}.fixtureResetId is invalid`);
  const repositories = validateRepositories(row.repositories, `${label}.repositories`);
  const target = validateTarget(row.target, `${label}.target`, mode);
  const inputs = validateInputs(row.inputs, `${label}.inputs`);
  if (inputs.flagsHash !== cohort.flagsFingerprint)
    throw new NativeComparisonInputError(`${label}.inputs.flagsHash must match the sealed cohort`);
  const coldAttemptIdentity = validateColdAttemptIdentity(
    row.coldAttemptIdentity,
    `${label}.coldAttemptIdentity`,
  );
  if (coldAttemptIdentity.ownerRunId !== runId)
    throw new NativeComparisonInputError(
      `${label}.coldAttemptIdentity.ownerRunId must match runId`,
    );
  return {
    runId,
    trialOrdinal: row.trialOrdinal as number,
    attemptId,
    locale: requireLocale(row.locale, `${label}.locale is invalid`),
    cohortId,
    fixtureResetId,
    repositories,
    target,
    inputs,
    coldAttemptIdentity,
  };
}

function validateCell(
  value: unknown,
  index: number,
  attemptsPerCell: number,
  cohort: NativeComparisonCohortExpectation,
): NativeComparisonCell {
  const identity = requireIdentity(value, `cells[${index}]`);
  const row = value as Record<string, unknown>;
  const assertionLedger = validateAssertionLedger(
    row.assertionLedger,
    `cells[${index}].assertionLedger`,
    identity.mode,
  );
  if (!Array.isArray(row.requiredAssertionIds) || row.requiredAssertionIds.length === 0)
    throw new NativeComparisonInputError(`cells[${index}].requiredAssertionIds is empty`);
  const requiredAssertionIds = row.requiredAssertionIds.map((id, assertionIndex) => {
    const value = requireNonemptyString(
      id,
      `cells[${index}].requiredAssertionIds[${assertionIndex}] is invalid`,
    );
    if (!identifier.test(value))
      throw new NativeComparisonInputError(
        `cells[${index}].requiredAssertionIds contains an invalid ID`,
      );
    return value;
  });
  if (new Set(requiredAssertionIds).size !== requiredAssertionIds.length)
    throw new NativeComparisonInputError(
      `cells[${index}].requiredAssertionIds contains duplicates`,
    );
  if (
    canonical(requiredAssertionIds) !== canonical(assertionLedger.entries.map((entry) => entry.id))
  )
    throw new NativeComparisonInputError(
      `cells[${index}].requiredAssertionIds must match the canonical assertion ledger`,
    );
  if (!Array.isArray(row.expectedAttempts) || row.expectedAttempts.length !== attemptsPerCell)
    throw new NativeComparisonInputError(
      `cells[${index}].expectedAttempts must contain exactly ${attemptsPerCell} entries`,
    );
  const expectedAttempts = row.expectedAttempts.map((attempt, attemptIndex) =>
    validateExpectedAttempt(
      attempt,
      `cells[${index}].expectedAttempts[${attemptIndex}]`,
      identity.mode,
      cohort,
    ),
  );
  if (expectedAttempts.some((attempt) => attempt.locale !== identity.locale))
    throw new NativeComparisonInputError(
      `cells[${index}].expectedAttempts locale must match the cell locale`,
    );
  if (
    new Set(expectedAttempts.map((attempt) => attempt.attemptId)).size !== expectedAttempts.length
  )
    throw new NativeComparisonInputError(`cells[${index}].expectedAttempts contains duplicates`);
  if (
    new Set(expectedAttempts.map((attempt) => attempt.trialOrdinal)).size !==
    expectedAttempts.length
  )
    throw new NativeComparisonInputError(
      `cells[${index}].expectedAttempts contains duplicate trial ordinals`,
    );
  if (expectedAttempts.some((attempt) => attempt.trialOrdinal > attemptsPerCell))
    throw new NativeComparisonInputError(
      `cells[${index}].expectedAttempts trial ordinals must be within the requested attempt count`,
    );
  return {
    ...identity,
    requiredAssertionIds,
    assertionLedger,
    expectedAttempts,
  };
}

function expectedFullCellBaseKeys(): Set<string> {
  const keys = new Set<string>();
  for (const family of fullFamilies)
    for (const platform of platforms)
      for (const engine of engines)
        keys.add(
          nativeComparisonCellBaseKey({
            scenarioId: `SCN-${family}-${platform}`,
            platform,
            engine,
            mode: 'integration',
            locale: 'en-US',
          }),
        );
  return keys;
}

function validateCohortConsistency(
  cells: NativeComparisonCell[],
  cohort: NativeComparisonCohortExpectation,
): void {
  const allAttempts = cells.flatMap((cell) =>
    cell.expectedAttempts.map((expected) => ({ cell, expected })),
  );
  if (allAttempts.length === 0)
    throw new NativeComparisonInputError('Comparison cohort has no expected attempts');
  const firstRepositories = canonical(allAttempts[0].expected.repositories);
  for (const { expected } of allAttempts) {
    if (canonical(expected.repositories) !== firstRepositories)
      throw new NativeComparisonInputError(
        'Comparison cohort mixes repository/source fingerprints across cold attempts',
      );
  }
  const windowsByResource = new Map<
    string,
    {
      expected: NativeComparisonAttemptExpectation;
      window: NativeComparisonOwnershipWindow;
    }[]
  >();
  for (const { expected } of allAttempts) {
    for (const window of expected.coldAttemptIdentity.ownershipWindows) {
      const key = `${window.resourceType}:${window.resourceId}`;
      const rows = windowsByResource.get(key) ?? [];
      rows.push({ expected, window });
      windowsByResource.set(key, rows);
    }
  }
  for (const [resourceKey, rows] of windowsByResource.entries()) {
    const ordered = [...rows].sort(
      (left, right) => Date.parse(left.window.acquiredAt) - Date.parse(right.window.acquiredAt),
    );
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousReleasedAt = Date.parse(previous.window.releasedAt);
      const currentAcquiredAt = Date.parse(current.window.acquiredAt);
      if (currentAcquiredAt < previousReleasedAt)
        throw new NativeComparisonInputError(
          `Comparison cohort has overlapping ownership windows for ${resourceKey}`,
        );
      if (
        resourceKey.startsWith('process:') &&
        previous.window.processStartIdentity === current.window.processStartIdentity
      )
        throw new NativeComparisonInputError(
          `Comparison cohort reuses process start identity for ${resourceKey}`,
        );
    }
  }

  const pairCells = new Map<string, NativeComparisonCell[]>();
  for (const cell of cells) {
    const key = nativeComparisonPairKey(pairIdentityFromCell(cell));
    const rows = pairCells.get(key) ?? [];
    rows.push(cell);
    pairCells.set(key, rows);
    const first = cell.expectedAttempts[0];
    for (const expected of cell.expectedAttempts.slice(1)) {
      if (canonical(expected.target) !== canonical(first.target))
        throw new NativeComparisonInputError(
          `Cell ${nativeComparisonCellKey(cell)} changes target/build identity across cold attempts`,
        );
      if (
        expected.inputs.scenarioHash !== first.inputs.scenarioHash ||
        expected.inputs.requirementHash !== first.inputs.requirementHash ||
        expected.inputs.fixtureHash !== first.inputs.fixtureHash ||
        canonical(expected.inputs.toolVersions) !== canonical(first.inputs.toolVersions)
      )
        throw new NativeComparisonInputError(
          `Cell ${nativeComparisonCellKey(cell)} changes scenario, requirement, fixture or tool fingerprints across cold attempts`,
        );
    }
  }
  for (const [pairKey, pair] of pairCells.entries()) {
    if (pair.length !== engines.length) continue;
    const first = pair[0];
    const second = pair[1];
    const firstAttempt = first.expectedAttempts[0];
    const secondAttempt = second.expectedAttempts[0];
    if (
      first.assertionLedger.sourceHash !== second.assertionLedger.sourceHash ||
      first.assertionLedger.contractHash !== second.assertionLedger.contractHash ||
      first.assertionLedger.semanticHash !== second.assertionLedger.semanticHash ||
      canonical(first.requiredAssertionIds) !== canonical(second.requiredAssertionIds)
    )
      throw new NativeComparisonInputError(
        `Engine pair ${pairKey} does not bind an equivalent canonical assertion ledger`,
      );
    if (
      firstAttempt.inputs.scenarioHash !== secondAttempt.inputs.scenarioHash ||
      firstAttempt.inputs.requirementHash !== secondAttempt.inputs.requirementHash ||
      firstAttempt.inputs.fixtureHash !== secondAttempt.inputs.fixtureHash
    )
      throw new NativeComparisonInputError(
        `Engine pair ${pairKey} mixes source, requirement or fixture cohort fingerprints`,
      );
    const invariantTargetKeys: (keyof NativeComparisonTargetExpectation)[] = [
      'deviceId',
      'osVersion',
      'appId',
      'apiOrigin',
    ];
    if (invariantTargetKeys.some((key) => firstAttempt.target[key] !== secondAttempt.target[key]))
      throw new NativeComparisonInputError(
        `Engine pair ${pairKey} changes target/API identity outside an instrumentation-only difference`,
      );
    if (
      firstAttempt.target.buildProfile !== secondAttempt.target.buildProfile ||
      firstAttempt.target.binaryHash !== secondAttempt.target.binaryHash
    ) {
      const platform = first.platform;
      if (
        !cohort.instrumentationOnlyDifferences.some(
          (difference) => difference.platform === platform,
        )
      )
        throw new NativeComparisonInputError(
          `Engine pair ${pairKey} has an undocumented instrumentation-only build difference`,
        );
    }
  }
}

function requirePairIdentity(value: unknown, label: string): NativeComparisonPairIdentity {
  const row = requireRecord(value, `${label} must be an object`);
  const scenario = requireNonemptyString(row.scenarioId, `${label}.scenarioId is invalid`);
  if (!scenarioId.test(scenario) || !identifier.test(scenario))
    throw new NativeComparisonInputError(`${label}.scenarioId is invalid`);
  if (!platforms.includes(row.platform as NativeComparisonPlatform))
    throw new NativeComparisonInputError(`${label}.platform is invalid`);
  if (!modes.includes(row.mode as NativeComparisonMode))
    throw new NativeComparisonInputError(`${label}.mode is invalid`);
  const pairId = requireNonemptyString(row.pairId, `${label}.pairId is invalid`);
  if (!identifier.test(pairId)) throw new NativeComparisonInputError(`${label}.pairId is invalid`);
  return {
    pairId,
    scenarioId: scenario,
    platform: row.platform as NativeComparisonPlatform,
    mode: row.mode as NativeComparisonMode,
    locale: requireLocale(row.locale, `${label}.locale is invalid`),
  };
}

function pairIdentityFromCell(cell: NativeComparisonCell): NativeComparisonPairIdentity {
  return {
    pairId: '',
    scenarioId: cell.scenarioId,
    platform: cell.platform,
    mode: cell.mode,
    locale: cell.locale,
  };
}

function oppositeEngine(engine: NativeComparisonEngine): NativeComparisonEngine {
  return engine === 'maestro' ? 'detox' : 'maestro';
}

function validateExecutionOrder(
  value: unknown,
  cells: NativeComparisonCell[],
  attemptsPerCell: number,
  scope: 'full' | 'partial',
): NativeComparisonExecutionOrder[] {
  const cellsByPair = new Map<string, Map<NativeComparisonEngine, NativeComparisonCell>>();
  for (const cell of cells) {
    const key = nativeComparisonPairKey(pairIdentityFromCell(cell));
    const byEngine =
      cellsByPair.get(key) ?? new Map<NativeComparisonEngine, NativeComparisonCell>();
    if (byEngine.has(cell.engine))
      throw new NativeComparisonInputError(`Duplicate engine cell in pair ${key}`);
    byEngine.set(cell.engine, cell);
    cellsByPair.set(key, byEngine);
  }
  const pairedKeys = new Set(
    [...cellsByPair.entries()]
      .filter(([, byEngine]) => byEngine.size === engines.length)
      .map(([key]) => key),
  );
  const rawOrder = value;
  if (rawOrder === undefined) {
    if (pairedKeys.size > 0)
      throw new NativeComparisonInputError(
        'executionOrder is required for every reviewed pair of engine cells',
      );
    return [];
  }
  if (!Array.isArray(rawOrder))
    throw new NativeComparisonInputError('executionOrder must be an array');
  if (rawOrder.length !== pairedKeys.size)
    throw new NativeComparisonInputError(
      `executionOrder must contain exactly ${pairedKeys.size} reviewed pair(s)`,
    );
  if (scope === 'full' && pairedKeys.size !== 10)
    throw new NativeComparisonInputError('Full comparison must contain exactly 10 reviewed pairs');

  const pairIds = new Set<string>();
  const pairKeys = new Set<string>();
  const attemptIds = new Set<string>();
  const order: NativeComparisonExecutionOrder[] = [];
  for (const [index, item] of rawOrder.entries()) {
    const label = `executionOrder[${index}]`;
    const row = requireRecord(item, `${label} is invalid`);
    const identity = requirePairIdentity(row, label);
    if (pairIds.has(identity.pairId))
      throw new NativeComparisonInputError(`${label}.pairId is duplicated`);
    pairIds.add(identity.pairId);
    const pairKey = nativeComparisonPairKey(identity);
    if (pairKeys.has(pairKey))
      throw new NativeComparisonInputError(`${label} duplicates a reviewed pair identity`);
    pairKeys.add(pairKey);
    const byEngine = cellsByPair.get(pairKey);
    if (!byEngine || byEngine.size !== engines.length)
      throw new NativeComparisonInputError(
        `${label} does not match exactly one maestro/detox cell pair`,
      );
    const firstEngine = row.firstEngine;
    if (!engines.includes(firstEngine as NativeComparisonEngine))
      throw new NativeComparisonInputError(`${label}.firstEngine is invalid`);
    if (!Array.isArray(row.trials) || row.trials.length !== attemptsPerCell)
      throw new NativeComparisonInputError(
        `${label}.trials must contain exactly ${attemptsPerCell} entries`,
      );
    const firstCell = byEngine.get(firstEngine as NativeComparisonEngine)!;
    const secondCell = byEngine.get(oppositeEngine(firstEngine as NativeComparisonEngine))!;
    const firstByOrdinal = new Map(
      firstCell.expectedAttempts.map((expected) => [expected.trialOrdinal, expected]),
    );
    const secondByOrdinal = new Map(
      secondCell.expectedAttempts.map((expected) => [expected.trialOrdinal, expected]),
    );
    const trialOrdinals = new Set<number>();
    const trials: NativeComparisonOrderTrial[] = [];
    for (const [trialIndex, trialValue] of row.trials.entries()) {
      const trialLabel = `${label}.trials[${trialIndex}]`;
      const trial = requireRecord(trialValue, `${trialLabel} is invalid`);
      if (
        !Number.isSafeInteger(trial.trialOrdinal) ||
        (trial.trialOrdinal as number) < 1 ||
        (trial.trialOrdinal as number) > attemptsPerCell
      )
        throw new NativeComparisonInputError(`${trialLabel}.trialOrdinal is invalid`);
      const trialOrdinal = trial.trialOrdinal as number;
      if (trialOrdinals.has(trialOrdinal))
        throw new NativeComparisonInputError(`${label} contains duplicate trial ordinals`);
      trialOrdinals.add(trialOrdinal);
      const firstAttemptId = requireNonemptyString(
        trial.firstAttemptId,
        `${trialLabel}.firstAttemptId is invalid`,
      );
      const secondAttemptId = requireNonemptyString(
        trial.secondAttemptId,
        `${trialLabel}.secondAttemptId is invalid`,
      );
      if (!identifier.test(firstAttemptId) || !identifier.test(secondAttemptId))
        throw new NativeComparisonInputError(`${trialLabel} contains an invalid attempt ID`);
      const expectedFirstEngine =
        trialOrdinal % 2 === 1
          ? firstEngine
          : oppositeEngine(firstEngine as NativeComparisonEngine);
      const expectedFirstByOrdinal =
        expectedFirstEngine === firstEngine ? firstByOrdinal : secondByOrdinal;
      const expectedSecondByOrdinal =
        expectedFirstEngine === firstEngine ? secondByOrdinal : firstByOrdinal;
      const expectedFirst = expectedFirstByOrdinal.get(trialOrdinal);
      const expectedSecond = expectedSecondByOrdinal.get(trialOrdinal);
      if (!expectedFirst || !expectedSecond)
        throw new NativeComparisonInputError(
          `${trialLabel} references an ordinal missing from the paired cells`,
        );
      if (
        firstAttemptId !== expectedFirst.attemptId ||
        secondAttemptId !== expectedSecond.attemptId
      )
        throw new NativeComparisonInputError(
          `${trialLabel} does not bind the exact expected attempt IDs for its pair and ordinal`,
        );
      if (attemptIds.has(firstAttemptId) || attemptIds.has(secondAttemptId))
        throw new NativeComparisonInputError(
          `${trialLabel} reuses an attempt ID across reviewed pair trials`,
        );
      attemptIds.add(firstAttemptId);
      attemptIds.add(secondAttemptId);
      trials.push({ trialOrdinal, firstAttemptId, secondAttemptId });
    }
    if (trialOrdinals.size !== attemptsPerCell)
      throw new NativeComparisonInputError(`${label} omits one or more trial ordinals`);
    order.push({
      ...identity,
      firstEngine: firstEngine as NativeComparisonEngine,
      trials,
    });
  }
  if (pairKeys.size !== pairedKeys.size || [...pairedKeys].some((key) => !pairKeys.has(key)))
    throw new NativeComparisonInputError('executionOrder omits or swaps a reviewed pair identity');
  if (attemptIds.size !== pairedKeys.size * attemptsPerCell * engines.length)
    throw new NativeComparisonInputError(
      'executionOrder does not seal every paired expected attempt',
    );
  return order;
}

/** Validate the reviewed request matrix before reading any receipt artifacts. */
export function validateNativeComparisonSpec(value: unknown): NativeComparisonSpec {
  const row = requireRecord(value, 'Native comparison specification must be an object');
  if (row.schemaVersion !== 1)
    throw new NativeComparisonInputError('Unsupported comparison schema');
  if (row.scope !== 'full' && row.scope !== 'partial')
    throw new NativeComparisonInputError('Comparison scope must be full or partial');
  if (
    !Number.isSafeInteger(row.attemptsPerCell) ||
    (row.attemptsPerCell as number) < 1 ||
    (row.attemptsPerCell as number) > 20
  )
    throw new NativeComparisonInputError('attemptsPerCell must be an integer from 1 through 20');
  const attemptsPerCell = row.attemptsPerCell as number;
  const minimumFirstAttemptPasses = row.minimumFirstAttemptPasses;
  if (
    minimumFirstAttemptPasses !== undefined &&
    (typeof minimumFirstAttemptPasses !== 'number' ||
      !Number.isSafeInteger(minimumFirstAttemptPasses) ||
      minimumFirstAttemptPasses < 1 ||
      minimumFirstAttemptPasses > attemptsPerCell)
  )
    throw new NativeComparisonInputError('minimumFirstAttemptPasses is invalid');
  if (
    row.scope === 'full' &&
    typeof minimumFirstAttemptPasses === 'number' &&
    minimumFirstAttemptPasses < 19
  )
    throw new NativeComparisonInputError(
      'Full comparison minimumFirstAttemptPasses must be at least 19 of 20',
    );
  const cohort = validateCohort(row.cohort, 'cohort');
  const cellsValue = row.cells;
  if (!Array.isArray(cellsValue) || cellsValue.length === 0)
    throw new NativeComparisonInputError('Comparison specification has no cells');
  const cells = cellsValue.map((cell, index) => validateCell(cell, index, attemptsPerCell, cohort));
  const cellKeys = cells.map(nativeComparisonCellKey);
  if (new Set(cellKeys).size !== cellKeys.length)
    throw new NativeComparisonInputError('Comparison specification contains duplicate cells');
  validateCohortConsistency(cells, cohort);
  const attemptIds = cells.flatMap((cell) =>
    cell.expectedAttempts.map((attempt) => attempt.attemptId),
  );
  if (new Set(attemptIds).size !== attemptIds.length)
    throw new NativeComparisonInputError('Comparison specification contains duplicate attempt IDs');
  const fixtureResetIds = cells.flatMap((cell) =>
    cell.expectedAttempts.map((attempt) => attempt.fixtureResetId),
  );
  if (new Set(fixtureResetIds).size !== fixtureResetIds.length)
    throw new NativeComparisonInputError(
      'Comparison specification contains duplicate fixture reset identities',
    );
  if (row.scope === 'full') {
    const expected = expectedFullCellBaseKeys();
    const actualBaseKeys = cells.map(nativeComparisonCellBaseKey);
    if (cells.some((cell) => cell.locale !== cells[0].locale))
      throw new NativeComparisonInputError(
        'Full comparison matrix must use one explicit locale; locale variants require a separate cohort',
      );
    if (attemptsPerCell !== 20 || cells.length !== expected.size)
      throw new NativeComparisonInputError(
        'Full comparison must declare 20 cells with 20 attempts each',
      );
    if (
      new Set(actualBaseKeys).size !== expected.size ||
      actualBaseKeys.some((key) => !expected.has(key))
    )
      throw new NativeComparisonInputError(
        'Full comparison matrix does not match the five integrated families',
      );
  }
  const executionOrder = validateExecutionOrder(
    row.executionOrder,
    cells,
    attemptsPerCell,
    row.scope,
  );
  const threshold: number =
    typeof minimumFirstAttemptPasses === 'number'
      ? minimumFirstAttemptPasses
      : row.scope === 'full'
        ? 19
        : attemptsPerCell;
  return {
    schemaVersion: 1,
    cohort,
    scope: row.scope,
    attemptsPerCell,
    minimumFirstAttemptPasses: threshold,
    cells,
    executionOrder,
  };
}

type PublicReceipt = {
  runId: string;
  attemptId: string;
  scenarioId: string;
  phase: string;
  layer: string;
  engine: NativeComparisonEngine;
  platform: NativeComparisonPlatform;
  locale: NativeComparisonLocale;
  dataMode: 'fixture' | 'postgres';
  result: NativeComparisonResult;
  childExitCode: number | null;
  repositories: NativeComparisonRepositoryExpectation[];
  target: NativeComparisonTargetExpectation;
  inputs: NativeComparisonInputExpectation;
  startedAt: string;
  finishedAt: string;
  assertions: {
    id: string;
    requirementRefs: string[];
    outcome: 'passed' | 'failed' | 'not-executed';
    evidencePaths: string[];
  }[];
  timingsMs: Record<(typeof timingKeys)[number], number>;
  cleanup: {
    status: 'cleaned' | 'not-acquired' | 'failed-recovery-ledger-retained';
    ownedResourceIds: string[];
    recoveryRecordPath: string | null;
  };
};

function isReceiptAssertionShape(value: unknown): value is PublicReceipt['assertions'][number] {
  if (!isRecord(value) || typeof value.id !== 'string') return false;
  if (!['passed', 'failed', 'not-executed'].includes(value.outcome as string)) return false;
  return (
    Array.isArray(value.requirementRefs) &&
    value.requirementRefs.every((requirementRef) => typeof requirementRef === 'string') &&
    Array.isArray(value.evidencePaths) &&
    value.evidencePaths.every((evidencePath) => typeof evidencePath === 'string')
  );
}

function readReceiptShape(value: unknown): PublicReceipt | null {
  if (!isRecord(value)) return null;
  const row = value as Partial<PublicReceipt>;
  if (
    typeof row.runId !== 'string' ||
    typeof row.attemptId !== 'string' ||
    typeof row.scenarioId !== 'string' ||
    typeof row.phase !== 'string' ||
    typeof row.layer !== 'string' ||
    !platforms.includes(row.platform as NativeComparisonPlatform) ||
    !engines.includes(row.engine as NativeComparisonEngine) ||
    !locales.includes(row.locale as NativeComparisonLocale) ||
    !['fixture', 'postgres'].includes(row.dataMode as string) ||
    !['passed', 'application-failed', 'harness-blocked', 'cancelled'].includes(
      row.result as string,
    ) ||
    !Array.isArray(row.repositories) ||
    !isRecord(row.target) ||
    !isRecord(row.inputs) ||
    typeof row.startedAt !== 'string' ||
    typeof row.finishedAt !== 'string' ||
    !Array.isArray(row.assertions) ||
    !row.assertions.every(isReceiptAssertionShape) ||
    !isRecord(row.timingsMs) ||
    !isRecord(row.cleanup)
  )
    return null;
  return row as PublicReceipt;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function compareFingerprint(
  expected: NativeComparisonAttemptExpectation,
  receipt: PublicReceipt,
): string[] {
  const issues: string[] = [];
  if (expected.runId !== receipt.runId) issues.push('run-id-mismatch');
  if (expected.locale !== receipt.locale) issues.push('locale-mismatch');
  if (canonical(expected.repositories) !== canonical(receipt.repositories))
    issues.push('repository-fingerprint-mismatch');
  if (canonical(expected.target) !== canonical(receipt.target))
    issues.push('target-fingerprint-mismatch');
  if (
    expected.inputs.scenarioHash !== receipt.inputs.scenarioHash ||
    expected.inputs.requirementHash !== receipt.inputs.requirementHash ||
    expected.inputs.fixtureHash !== receipt.inputs.fixtureHash ||
    expected.inputs.flagsHash !== receipt.inputs.flagsHash
  )
    issues.push('input-fingerprint-mismatch');
  if (canonical(expected.inputs.toolVersions) !== canonical(receipt.inputs.toolVersions))
    issues.push('tool-version-map-mismatch');
  return issues;
}

function timingStats(values: number[]): NativeComparisonTimingStats {
  if (values.length === 0) return { count: 0, p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => {
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95) };
}

function emptyTimingStats(): Record<(typeof timingKeys)[number], NativeComparisonTimingStats> {
  return Object.fromEntries(timingKeys.map((key) => [key, timingStats([])])) as Record<
    (typeof timingKeys)[number],
    NativeComparisonTimingStats
  >;
}

function isValidTiming(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function classifyAttempt(
  cell: NativeComparisonCell,
  expected: NativeComparisonAttemptExpectation,
  input: NativeComparisonReceiptInput | undefined,
): NativeComparisonAttemptReport {
  const base: NativeComparisonAttemptReport = {
    scenarioId: cell.scenarioId,
    platform: cell.platform,
    engine: cell.engine,
    mode: cell.mode,
    locale: expected.locale,
    cohortId: expected.cohortId,
    fixtureResetId: expected.fixtureResetId,
    trialOrdinal: expected.trialOrdinal,
    expectedRunId: expected.runId,
    runId: null,
    attemptId: expected.attemptId,
    receiptPath: input?.path ?? null,
    receiptHash: input?.receiptHash ?? null,
    startedAt: null,
    finishedAt: null,
    received: Boolean(input),
    receiptValid: false,
    orderCompatible: false,
    result: null,
    childExitCode: null,
    cleanupStatus: null,
    cleanupFailure: false,
    passed: false,
    timingMs: {},
    assertionIds: [],
    issues: input ? [] : ['missing-requested-attempt'],
  };
  if (!input) return base;
  const receipt = readReceiptShape(input.receipt);
  if (!receipt) {
    base.issues.push('invalid-receipt-shape');
    return base;
  }
  base.runId = receipt.runId;
  base.startedAt = receipt.startedAt;
  base.finishedAt = receipt.finishedAt;
  if (receipt.attemptId !== firstAttemptId(receipt.runId))
    base.issues.push('receipt-attempt-is-not-first');
  try {
    assertPublicReceipt(input.receipt, input.artifactRoot);
    base.receiptValid = true;
  } catch {
    base.issues.push('invalid-public-receipt');
    return base;
  }
  const receiptBinding = expected.coldAttemptIdentity.originalReceiptBinding;
  if (receiptBinding.status === 'pending') base.issues.push('cold-resource-binding-pending');
  else if (
    input.path !== receiptBinding.receiptPath ||
    input.artifactRoot !== receiptBinding.artifactRoot ||
    input.receiptHash !== receiptBinding.receiptHash
  )
    base.issues.push('cold-resource-binding-mismatch');
  if (
    receipt.scenarioId !== cell.scenarioId ||
    receipt.platform !== cell.platform ||
    receipt.engine !== cell.engine ||
    (cell.mode === 'integration' && receipt.dataMode !== 'postgres') ||
    (cell.mode === 'fixture' && receipt.dataMode !== 'fixture')
  )
    base.issues.push('receipt-cell-mismatch');
  if (receipt.phase !== expectedNativePhase) base.issues.push('receipt-phase-mismatch');
  if (receipt.layer !== expectedNativeLayer) base.issues.push('receipt-layer-mismatch');
  if (cell.mode === 'integration' && typeof receipt.target.apiOrigin !== 'string')
    base.issues.push('integration-api-origin-missing');
  base.result = receipt.result;
  base.childExitCode = receipt.childExitCode;
  base.cleanupStatus = receipt.cleanup.status;
  base.cleanupFailure = receipt.cleanup.status === 'failed-recovery-ledger-retained';
  base.assertionIds = receipt.assertions.map((assertion) => assertion.id);
  const ledgerById = new Map(
    cell.assertionLedger.entries.map((entry) => [entry.id, entry] as const),
  );
  const receiptAssertionIds = new Set<string>();
  for (const assertion of receipt.assertions) {
    if (receiptAssertionIds.has(assertion.id))
      base.issues.push(`duplicate-assertion:${assertion.id}`);
    receiptAssertionIds.add(assertion.id);
    const ledgerEntry = ledgerById.get(assertion.id);
    if (!ledgerEntry) {
      base.issues.push(`unknown-assertion:${assertion.id}`);
      continue;
    }
    if (canonical(assertion.requirementRefs) !== canonical(ledgerEntry.requirementRefs))
      base.issues.push(`assertion-requirement-mismatch:${assertion.id}`);
  }
  for (const key of timingKeys)
    if (isValidTiming(receipt.timingsMs[key])) base.timingMs[key] = receipt.timingsMs[key];
  base.issues.push(...compareFingerprint(expected, receipt));
  base.orderCompatible = base.issues.length === 0;
  if (receipt.result === 'passed') {
    for (const id of cell.requiredAssertionIds) {
      const assertion = receipt.assertions.find((candidate) => candidate.id === id);
      if (!assertion || assertion.outcome !== 'passed' || assertion.evidencePaths.length === 0)
        base.issues.push(`missing-required-assertion:${id}`);
    }
    if (receipt.cleanup.status !== 'cleaned' || receipt.cleanup.recoveryRecordPath !== null)
      base.issues.push('passed-receipt-cleanup-is-not-cleaned');
    if (receipt.childExitCode !== 0) base.issues.push('passed-receipt-child-did-not-exit-zero');
    if (base.issues.length === 0) base.passed = true;
  }
  return base;
}

function requireReceiptAttemptId(input: NativeComparisonReceiptInput): string {
  if (!isRecord(input.receipt) || typeof input.receipt.attemptId !== 'string')
    throw new NativeComparisonInputError(`Receipt ${input.path} lacks a bindable attemptId`);
  if (!identifier.test(input.receipt.attemptId))
    throw new NativeComparisonInputError(`Receipt ${input.path} has an invalid attemptId`);
  return input.receipt.attemptId;
}

function validateReceiptInputMetadata(input: NativeComparisonReceiptInput, index: number): void {
  if (
    typeof input.path !== 'string' ||
    !path.isAbsolute(input.path) ||
    path.normalize(input.path) !== input.path
  )
    throw new NativeComparisonInputError(
      `Receipt ${index} does not have a canonical absolute path`,
    );
  if (
    typeof input.artifactRoot !== 'string' ||
    !path.isAbsolute(input.artifactRoot) ||
    path.normalize(input.artifactRoot) !== input.artifactRoot
  )
    throw new NativeComparisonInputError(`Receipt ${input.path} has an invalid artifact root`);
  if (!hash64.test(input.receiptHash))
    throw new NativeComparisonInputError(`Receipt ${input.path} lacks an immutable receipt hash`);
  let receiptStat;
  let artifactStat;
  let canonicalPath: string;
  let canonicalArtifactRoot: string;
  try {
    receiptStat = lstatSync(input.path);
    artifactStat = lstatSync(input.artifactRoot);
    canonicalPath = realpathSync(input.path);
    canonicalArtifactRoot = realpathSync(input.artifactRoot);
  } catch {
    throw new NativeComparisonInputError(`Receipt ${input.path} is missing or inaccessible`);
  }
  if (receiptStat.isSymbolicLink() || !receiptStat.isFile())
    throw new NativeComparisonInputError(`Receipt ${input.path} must be a canonical regular file`);
  if (artifactStat.isSymbolicLink() || !artifactStat.isDirectory())
    throw new NativeComparisonInputError(`Receipt ${input.path} has an invalid artifact root`);
  if (canonicalPath !== input.path || canonicalArtifactRoot !== input.artifactRoot)
    throw new NativeComparisonInputError(`Receipt ${input.path} must use canonical paths`);
  if (path.dirname(canonicalPath) !== canonicalArtifactRoot)
    throw new NativeComparisonInputError(`Receipt ${input.path} is not bound to its artifact root`);
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (uid !== undefined && (receiptStat.uid !== uid || artifactStat.uid !== uid))
    throw new NativeComparisonInputError(`Receipt ${input.path} is not owned by this process`);
  if ((receiptStat.mode & 0o777) !== 0o600)
    throw new NativeComparisonInputError(`Receipt ${input.path} must have mode 0600`);
  if ((artifactStat.mode & 0o777) !== 0o700)
    throw new NativeComparisonInputError(`Receipt ${input.path} artifact root must have mode 0700`);
  let observation;
  try {
    observation = readNativeEvidenceObservation(
      canonicalArtifactRoot,
      path.basename(canonicalPath),
      true,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'protected reader failed';
    throw new NativeComparisonInputError(
      `Receipt ${input.path} failed protected bounded collection read: ${detail}`,
    );
  }
  const originalIdentity = protectedReceiptIdentities.get(input);
  if (originalIdentity && canonical(originalIdentity) !== canonical(observation.identity))
    throw new NativeComparisonInputError(
      `Receipt ${input.path} descriptor identity changed after protected intake`,
    );
  const bytes = observation.bytes;
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== input.receiptHash)
    throw new NativeComparisonInputError(`Receipt ${input.path} hash does not match current bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new NativeComparisonInputError(`Receipt ${input.path} is not valid JSON`);
  }
  if (canonical(parsed) !== canonical(input.receipt))
    throw new NativeComparisonInputError(
      `Receipt ${input.path} payload does not match current bytes`,
    );
}

function addAttemptIssue(attempt: NativeComparisonAttemptReport, issue: string): void {
  if (!attempt.issues.includes(issue)) attempt.issues.push(issue);
}

function executionOrderTimestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectExecutionOrder(
  spec: NativeComparisonSpec,
  attempts: NativeComparisonAttemptReport[],
): NativeComparisonExecutionOrderReport {
  if (spec.executionOrder.length === 0) {
    return {
      required: false,
      status: 'not-required',
      expectedPairs: 0,
      verifiedPairs: 0,
      expectedTrials: 0,
      verifiedTrials: 0,
      pairs: [],
    };
  }
  const attemptsById = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  const pairs: NativeComparisonExecutionOrderPairReport[] = spec.executionOrder.map((pair) => {
    const trialReports: NativeComparisonExecutionOrderTrialReport[] = [];
    const pairIssues = new Set<string>();
    let previousTrialSeen = false;
    let previousTimingAvailable = false;
    let previousFirstStarted: number | null = null;
    let previousSecondFinished: number | null = null;
    let previousFirst: NativeComparisonAttemptReport | undefined;
    let previousSecond: NativeComparisonAttemptReport | undefined;
    for (const trial of pair.trials) {
      const first = attemptsById.get(trial.firstAttemptId);
      const second = attemptsById.get(trial.secondAttemptId);
      const issues = new Set<string>();
      let currentFirstStarted: number | null = null;
      let currentSecondFinished: number | null = null;
      let currentTimingAvailable = false;
      if (!first || !second || !first.received || !second.received) {
        issues.add('execution-order-missing-attempt');
      } else if (!first.receiptValid || !second.receiptValid) {
        issues.add('execution-order-invalid-receipt');
      } else if (!first.orderCompatible || !second.orderCompatible) {
        issues.add('execution-order-incompatible-receipt');
      } else {
        const firstStarted = executionOrderTimestamp(first.startedAt);
        const firstFinished = executionOrderTimestamp(first.finishedAt);
        const secondStarted = executionOrderTimestamp(second.startedAt);
        const secondFinished = executionOrderTimestamp(second.finishedAt);
        if (
          firstStarted === null ||
          firstFinished === null ||
          secondStarted === null ||
          secondFinished === null
        ) {
          issues.add('execution-order-timestamp-missing');
        } else {
          currentFirstStarted = firstStarted;
          currentSecondFinished = secondFinished;
          if (firstFinished <= firstStarted || secondFinished <= secondStarted)
            issues.add('execution-order-invalid-interval');
          else currentTimingAvailable = true;
          if (firstStarted === secondStarted) issues.add('execution-order-equal-start');
          else if (firstStarted > secondStarted) issues.add('execution-order-reversed');
          else if (firstFinished > secondStarted) issues.add('execution-order-overlap');
        }
      }
      if (previousTrialSeen) {
        if (!previousTimingAvailable) {
          issues.add('execution-order-prior-trial-unproven');
        } else if (currentFirstStarted !== null) {
          if (currentFirstStarted < previousFirstStarted!)
            issues.add('execution-order-cross-trial-reversed');
          if (currentFirstStarted < previousSecondFinished!)
            issues.add('execution-order-cross-trial-overlap');
          else if (currentFirstStarted === previousSecondFinished!)
            issues.add('execution-order-cross-trial-equal-boundary');
        }
      }
      for (const issue of issues) pairIssues.add(issue);
      if (issues.size > 0) {
        if (first) for (const issue of issues) addAttemptIssue(first, issue);
        if (second) for (const issue of issues) addAttemptIssue(second, issue);
        const previousReport = trialReports[trialReports.length - 1];
        if (previousReport) {
          for (const issue of issues) {
            if (!issue.startsWith('execution-order-cross-trial-')) continue;
            if (!previousReport.issues.includes(issue)) previousReport.issues.push(issue);
            previousReport.status = 'blocked';
            if (previousFirst) addAttemptIssue(previousFirst, issue);
            if (previousSecond) addAttemptIssue(previousSecond, issue);
          }
        }
      }
      trialReports.push({
        ...trial,
        status: issues.size === 0 ? 'verified' : 'blocked',
        issues: [...issues],
      });
      previousTrialSeen = true;
      previousTimingAvailable = currentTimingAvailable;
      previousFirstStarted = currentFirstStarted;
      previousSecondFinished = currentSecondFinished;
      previousFirst = first;
      previousSecond = second;
    }
    const verifiedTrials = trialReports.filter((trial) => trial.status === 'verified').length;
    return {
      pairId: pair.pairId,
      scenarioId: pair.scenarioId,
      platform: pair.platform,
      mode: pair.mode,
      locale: pair.locale,
      firstEngine: pair.firstEngine,
      expectedTrials: trialReports.length,
      verifiedTrials,
      status: verifiedTrials === trialReports.length ? 'verified' : 'blocked',
      issues: [...pairIssues],
      trials: trialReports,
    };
  });
  const expectedTrials = pairs.reduce((sum, pair) => sum + pair.expectedTrials, 0);
  const verifiedTrials = pairs.reduce((sum, pair) => sum + pair.verifiedTrials, 0);
  return {
    required: true,
    status: pairs.every((pair) => pair.status === 'verified') ? 'verified' : 'blocked',
    expectedPairs: pairs.length,
    verifiedPairs: pairs.filter((pair) => pair.status === 'verified').length,
    expectedTrials,
    verifiedTrials,
    pairs,
  };
}

/**
 * Collect an immutable requested cohort. Failed, blocked, cancelled and
 * failed-cleanup attempts remain rows in the requested denominator; only
 * malformed request matrices or unbindable/duplicate receipt IDs are rejected.
 */
export function collectNativeComparison(
  value: unknown,
  receipts: readonly NativeComparisonReceiptInput[],
): NativeComparisonReport {
  const spec = validateNativeComparisonSpec(value);
  const expectedByAttempt = new Map<
    string,
    { cell: NativeComparisonCell; expected: NativeComparisonAttemptExpectation }
  >();
  for (const cell of spec.cells)
    for (const expected of cell.expectedAttempts)
      expectedByAttempt.set(expected.attemptId, { cell, expected });
  const provided = new Map<string, NativeComparisonReceiptInput>();
  for (const [index, input] of receipts.entries()) {
    validateReceiptInputMetadata(input, index);
    const attemptId = requireReceiptAttemptId(input);
    if (!expectedByAttempt.has(attemptId))
      throw new NativeComparisonInputError(
        `Receipt ${input.path} is not in the expected request matrix`,
      );
    if (provided.has(attemptId))
      throw new NativeComparisonInputError(`Duplicate receipt attemptId ${attemptId}`);
    provided.set(attemptId, input);
  }
  const attempts: NativeComparisonAttemptReport[] = [];
  const cells: NativeComparisonCellReport[] = [];
  for (const cell of spec.cells) {
    const rows = cell.expectedAttempts.map((expected) => {
      const row = classifyAttempt(cell, expected, provided.get(expected.attemptId));
      attempts.push(row);
      return row;
    });
    const timingMs = emptyTimingStats();
    for (const key of timingKeys)
      timingMs[key] = timingStats(
        rows
          .map((row) => row.timingMs[key])
          .filter((value): value is number => value !== undefined),
      );
    const passed = rows.filter((row) => row.passed).length;
    const applicationFailures = rows.filter((row) => row.result === 'application-failed').length;
    const harnessBlocks = rows.filter((row) => row.result === 'harness-blocked').length;
    const cancellations = rows.filter((row) => row.result === 'cancelled').length;
    const invalidReceipts = rows.filter((row) => row.received && !row.receiptValid).length;
    const incompatibleReceipts = rows.filter((row) =>
      row.issues.some(
        (issue) =>
          issue.includes('mismatch') ||
          issue.startsWith('tool-version-mismatch') ||
          issue === 'receipt-attempt-is-not-first',
      ),
    ).length;
    const cleanupFailures = rows.filter((row) => row.cleanupFailure).length;
    const missing = rows.filter((row) => !row.received).length;
    const completeAssertionPasses = rows.filter(
      (row) => row.passed && cell.requiredAssertionIds.every((id) => row.assertionIds.includes(id)),
    ).length;
    const reasons: string[] = [];
    if (missing) reasons.push(`${missing} requested attempt(s) are missing`);
    if (passed < (spec.minimumFirstAttemptPasses ?? 0))
      reasons.push(`first-attempt pass threshold is ${spec.minimumFirstAttemptPasses}`);
    if (applicationFailures + harnessBlocks + cancellations)
      reasons.push(
        'non-passing attempts remain; failure explanation, controlled-regression and maintenance evidence are not modeled',
      );
    if (invalidReceipts) reasons.push('one or more receipt artifacts are invalid');
    if (incompatibleReceipts)
      reasons.push('one or more receipts do not match explicit cell expectations');
    if (cleanupFailures) reasons.push('cleanup failure/recovery ledgers remain in the cohort');
    if (completeAssertionPasses !== passed)
      reasons.push('passed attempts lack complete required assertion coverage');
    const decision: NativeComparisonDecision = reasons.length === 0 ? 'eligible' : 'blocked';
    cells.push({
      scenarioId: cell.scenarioId,
      platform: cell.platform,
      engine: cell.engine,
      mode: cell.mode,
      locale: cell.locale,
      cohortId: spec.cohort.id,
      key: nativeComparisonCellKey(cell),
      requested: rows.length,
      received: rows.filter((row) => row.received).length,
      missing,
      passed,
      firstAttemptPasses: passed,
      applicationFailures,
      harnessBlocks,
      cancellations,
      invalidReceipts,
      incompatibleReceipts,
      cleanupFailures,
      requiredAssertionIds: [...cell.requiredAssertionIds],
      completeAssertionPasses,
      timingMs,
      decision,
      reasons,
    });
  }
  const executionOrder = collectExecutionOrder(spec, attempts);
  for (const pair of executionOrder.pairs) {
    if (pair.status === 'verified') continue;
    const detail = pair.issues.length > 0 ? ` (${pair.issues.join(', ')})` : '';
    for (const engine of engines) {
      const key = nativeComparisonCellKey({
        scenarioId: pair.scenarioId,
        platform: pair.platform,
        engine,
        mode: pair.mode,
        locale: pair.locale,
      });
      const report = cells.find((cell) => cell.key === key);
      if (!report) continue;
      report.reasons.push(`execution-order gate is blocked for pair ${pair.pairId}${detail}`);
      report.decision = 'blocked';
    }
  }
  const requestedAttempts = cells.reduce((sum, cell) => sum + cell.requested, 0);
  const receivedAttempts = cells.reduce((sum, cell) => sum + cell.received, 0);
  const missingAttempts = requestedAttempts - receivedAttempts;
  const fullGateShape =
    spec.scope === 'full' &&
    spec.attemptsPerCell === 20 &&
    spec.cells.length === 20 &&
    requestedAttempts === 400;
  const allCellsEligible = cells.every((cell) => cell.decision === 'eligible');
  const comparisonEligible =
    spec.scope === 'full' &&
    fullGateShape &&
    allCellsEligible &&
    executionOrder.required &&
    executionOrder.status === 'verified';
  return {
    schemaVersion: 1,
    cohort: spec.cohort,
    scope: spec.scope,
    threshold: {
      attemptsPerCell: spec.attemptsPerCell,
      minimumFirstAttemptPasses: spec.minimumFirstAttemptPasses!,
      requiredCells: spec.scope === 'full' ? 20 : spec.cells.length,
      requiredAttempts: spec.scope === 'full' ? 400 : requestedAttempts,
    },
    matrix: {
      requestedCells: cells.length,
      completeCells: cells.filter((cell) => cell.decision === 'eligible').length,
      requestedAttempts,
      receivedAttempts,
      missingAttempts,
      fullGateShape,
    },
    allCellsEligible,
    comparisonEligible,
    executionOrder,
    adoptionDecision: 'blocked',
    adoptionDecisionReason:
      'The collector reports per-cell and reviewed execution-order eligibility only. Partial scopes remain non-promotable; non-passing outcomes remain blocked because failure explanation, controlled-regression and maintenance evidence are not modeled; migration, retirement and hosted promotion require separate review and T18/T19 evidence.',
    gateLimitations: {
      nonPassingOutcomeEvidence: 'not-modeled',
      controlledRegressionEvidence: 'not-modeled',
      maintenanceEvidence: 'not-modeled',
    },
    cells,
    attempts,
  };
}

function samePublicationIdentity(
  left: NativeEvidenceIdentity,
  right: NativeEvidenceIdentity,
): boolean {
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

function isPublicationBinding(value: unknown): value is NativeComparisonTerminalPublicationBinding {
  if (!isRecord(value)) return false;
  const receiptIdentity = value.receiptIdentity;
  const outputIdentity = value.outputIdentity;
  const writer = value.writer;
  const identityFields = [
    'dev',
    'ino',
    'uid',
    'gid',
    'mode',
    'nlink',
    'size',
    'mtimeMs',
    'ctimeMs',
  ] as const;
  const pathIdentityFields = ['dev', 'ino', 'uid', 'gid', 'mode'] as const;
  return (
    value.kind === 'native-detox-ios-terminal-publication-binding-v1' &&
    value.status === 'published' &&
    typeof value.receiptPath === 'string' &&
    typeof value.receiptHash === 'string' &&
    hash64.test(value.receiptHash) &&
    isRecord(receiptIdentity) &&
    identityFields.every((field) => typeof receiptIdentity[field] === 'number') &&
    isRecord(outputIdentity) &&
    typeof outputIdentity.path === 'string' &&
    pathIdentityFields.every((field) => typeof outputIdentity[field] === 'number') &&
    typeof value.outputRoot === 'string' &&
    typeof value.requestedRunId === 'string' &&
    typeof value.requestedAttemptId === 'string' &&
    typeof value.deadlineAtMonotonicMs === 'number' &&
    Number.isFinite(value.deadlineAtMonotonicMs) &&
    typeof value.committedAtMonotonicMs === 'number' &&
    Number.isFinite(value.committedAtMonotonicMs) &&
    value.committedAtMonotonicMs < value.deadlineAtMonotonicMs &&
    isRecord(writer) &&
    writer.kind === 'native-pilot-terminal-receipt' &&
    typeof writer.pid === 'number' &&
    Number.isInteger(writer.pid) &&
    writer.pid > 0
  );
}

function readIosDetoxPublicationBinding(input: {
  canonicalReceiptPath: string;
  artifactRoot: string;
  receipt: PublicReceipt;
  receiptHash: string;
  receiptObservation: NativeEvidenceObservation;
}): NativeComparisonTerminalPublicationBinding {
  const bindingPath = path.join(input.artifactRoot, iosDetoxTerminalPublicationBinding);
  let bindingObservation: NativeEvidenceObservation;
  try {
    bindingObservation = readNativeEvidenceObservation(
      input.artifactRoot,
      iosDetoxTerminalPublicationBinding,
      true,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'binding protected read failed';
    throw new NativeComparisonInputError(
      'Receipt ' + input.canonicalReceiptPath + ' lacks a terminal publication binding: ' + detail,
    );
  }
  let bindingValue: unknown;
  try {
    bindingValue = JSON.parse(bindingObservation.bytes.toString('utf8')) as unknown;
  } catch {
    throw new NativeComparisonInputError('Terminal publication binding is not valid JSON');
  }
  if (!isPublicationBinding(bindingValue))
    throw new NativeComparisonInputError('Terminal publication binding has an invalid shape');
  if (
    bindingValue.receiptPath !== input.canonicalReceiptPath ||
    bindingValue.receiptHash !== input.receiptHash ||
    bindingValue.outputRoot !== input.artifactRoot ||
    bindingValue.requestedRunId !== input.receipt.runId ||
    bindingValue.requestedAttemptId !== input.receipt.attemptId ||
    !samePublicationIdentity(bindingValue.receiptIdentity, input.receiptObservation.identity)
  )
    throw new NativeComparisonInputError(
      'Terminal publication binding does not match the protected receipt identity',
    );
  let outputStat;
  try {
    outputStat = lstatSync(input.artifactRoot);
    if (realpathSync(input.artifactRoot) !== input.artifactRoot)
      throw new Error('non-canonical root');
  } catch {
    throw new NativeComparisonInputError('Terminal publication binding root is unavailable');
  }
  if (
    !outputStat.isDirectory() ||
    bindingValue.outputIdentity.path !== input.artifactRoot ||
    bindingValue.outputIdentity.dev !== outputStat.dev ||
    bindingValue.outputIdentity.ino !== outputStat.ino ||
    bindingValue.outputIdentity.uid !== outputStat.uid ||
    bindingValue.outputIdentity.gid !== outputStat.gid ||
    bindingValue.outputIdentity.mode !== outputStat.mode
  )
    throw new NativeComparisonInputError('Terminal publication binding root identity changed');
  // Keep this path check explicit: the local variable proves the sidecar was
  // read from the same direct child the contract names.
  if (bindingPath !== path.join(input.artifactRoot, iosDetoxTerminalPublicationBinding))
    throw new NativeComparisonInputError('Terminal publication binding path escaped its root');
  return bindingValue;
}

export async function readNativeComparisonReceipts(
  receiptPaths: readonly string[],
): Promise<NativeComparisonReceiptInput[]> {
  return Promise.all(
    receiptPaths.map(async (receiptPath) => {
      if (typeof receiptPath !== 'string' || receiptPath.length === 0)
        throw new NativeComparisonInputError('Receipt path must be a nonempty string');
      const candidate = path.resolve(receiptPath);
      let candidateStat;
      try {
        candidateStat = await lstat(candidate);
      } catch {
        throw new NativeComparisonInputError(
          'Receipt ' + candidate + ' is missing or inaccessible',
        );
      }
      if (candidateStat.isSymbolicLink())
        throw new NativeComparisonInputError('Receipt ' + candidate + ' must not be a symlink');
      if (!candidateStat.isFile())
        throw new NativeComparisonInputError('Receipt ' + candidate + ' must be a regular file');
      const canonical = await realpath(candidate).catch(() => {
        throw new NativeComparisonInputError('Receipt ' + candidate + ' has no canonical path');
      });
      if (canonical !== candidate)
        throw new NativeComparisonInputError('Receipt ' + candidate + ' must not be a symlink');
      const artifactRoot = path.dirname(canonical);
      let observation;
      try {
        observation = readNativeEvidenceObservation(artifactRoot, path.basename(canonical), true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'protected reader failed';
        throw new NativeComparisonInputError(
          'Receipt ' + canonical + ' failed protected bounded read: ' + detail,
        );
      }
      const bytes = observation.bytes;
      const receiptHash = createHash('sha256').update(bytes).digest('hex');
      let receipt: unknown;
      try {
        receipt = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw new NativeComparisonInputError('Receipt ' + canonical + ' is not valid JSON');
      }
      const receiptShape = readReceiptShape(receipt);
      const terminalPublicationBinding =
        receiptShape?.platform === 'ios' && receiptShape.engine === 'detox'
          ? readIosDetoxPublicationBinding({
              canonicalReceiptPath: canonical,
              artifactRoot,
              receipt: receiptShape,
              receiptHash,
              receiptObservation: observation,
            })
          : null;
      const input: NativeComparisonReceiptInput = {
        path: canonical,
        artifactRoot,
        receipt,
        receiptHash,
        terminalPublicationBinding,
      };
      protectedReceiptIdentities.set(input, { ...observation.identity });
      return input;
    }),
  );
}

function parseCli(argv: readonly string[]): {
  spec: string;
  receipts: string[];
  output?: string;
} {
  let spec: string | undefined;
  let output: string | undefined;
  const receipts: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const [name, inline] = argument.split('=', 2);
    if (name === '--spec' || name === '--output' || name === '--receipt') {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--'))
        throw new NativeComparisonInputError(`${name} requires a value`);
      if (name === '--spec') spec = value;
      else if (name === '--output') output = value;
      else receipts.push(value);
    } else throw new NativeComparisonInputError('Unknown comparison argument');
  }
  if (!spec || receipts.length === 0)
    throw new NativeComparisonInputError('Comparison requires --spec and at least one --receipt');
  return { spec, receipts, output };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseCli(argv);
    const spec = JSON.parse(await readFile(path.resolve(options.spec), 'utf8')) as unknown;
    const receipts = await readNativeComparisonReceipts(options.receipts);
    const report = collectNativeComparison(spec, receipts);
    const serialized = JSON.stringify(report, null, 2) + '\n';
    if (options.output)
      await writeFile(path.resolve(options.output), serialized, {
        flag: 'wx',
        mode: 0o600,
      });
    else process.stdout.write(serialized);
    return report.allCellsEligible ? 0 : 2;
  } catch (error) {
    process.stderr.write(
      `Native comparison blocked: ${error instanceof NativeComparisonInputError ? error.message : 'invalid input or receipt artifact'}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  void main().then((code) => {
    process.exitCode = code;
  });

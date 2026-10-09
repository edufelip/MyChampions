import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readNativeEvidenceObservation,
  type NativeEvidenceIdentity,
} from '../../scripts/testing/native-view-evidence';
import {
  ColdComparisonAttemptError,
  runNativeComparisonCohort,
  type ColdComparisonAttemptReceipt,
  type CohortBuildReuse,
  type FreshColdReset,
} from '../../scripts/testing/t15-cold-dispatcher';
import type {
  NativeComparisonAssertionLedger,
  NativeComparisonAttemptExpectation,
  NativeComparisonCell,
  NativeComparisonCohortExpectation,
  NativeComparisonColdAttemptIdentity,
  NativeComparisonExecutionOrder,
  NativeComparisonInputExpectation,
  NativeComparisonOwnershipWindow,
  NativeComparisonRepositoryExpectation,
  NativeComparisonSpec,
  NativeComparisonTargetExpectation,
} from '../../scripts/testing/compare-native-pilot';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

type SourceControlResetBinding = FreshColdReset['originalResetBinding'] & {
  identity: NativeEvidenceIdentity;
};

const hash = (character: string) => character.repeat(64);
const sha = (character: string) => character.repeat(40);
const iso = (seconds: number): string =>
  new Date(Date.parse('2026-10-01T00:00:00.000Z') + seconds * 1000).toISOString();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

const cohort: NativeComparisonCohortExpectation = {
  id: 't15-source-cohort',
  sourceFingerprint: hash('a'),
  fixtureResetFingerprint: hash('b'),
  flagsFingerprint: hash('c'),
  instrumentationOnlyDifferences: [
    { platform: 'ios', reason: 'Source-only engine instrumentation control' },
    { platform: 'android', reason: 'Source-only engine instrumentation control' },
  ],
};

function repositories(): NativeComparisonRepositoryExpectation[] {
  return [
    { name: 'client', sha: sha('a'), dirty: false, workingTreeHash: null },
    { name: 'server', sha: sha('b'), dirty: false, workingTreeHash: null },
  ];
}

function target(): NativeComparisonTargetExpectation {
  return {
    deviceId: 'source-only-target',
    osVersion: '17',
    appId: 'com.edufelip.mychampions.dev',
    buildProfile: 'source-only',
    binaryHash: hash('b'),
    apiOrigin: 'http://127.0.0.1:41000',
  };
}

function inputs(family: string, engine: 'maestro' | 'detox'): NativeComparisonInputExpectation {
  const familyFingerprint = ['session', 'training', 'connection', 'camera-denied', 'save-retry']
    .indexOf(family)
    .toString(16);
  return {
    scenarioHash: hash(familyFingerprint),
    requirementHash: hash('d'),
    fixtureHash: hash('e'),
    flagsHash: cohort.flagsFingerprint,
    toolVersions: { [engine]: engine === 'maestro' ? '2.6.1' : '20.47.0' },
  };
}

function ledger(family: string): NativeComparisonAssertionLedger {
  const entries = [
    {
      id: `NAT-${family}-source-control`,
      requirementRefs: [`BL-018/P4-${family}`],
      requirementPaths: ['docs/plans/2026-09-29-testing-modernization-start-here.md'],
      evidenceKinds: ['ui'] as ('ui' | 'api' | 'sql')[],
      startingState: 'Owned source-only control state',
      action: 'Invoke the injected attempt boundary',
      expected: 'Retain an immutable row and terminal ownership evidence',
      evidencePathTemplates: [`assertions/{attemptId}/NAT-${family}-source-control.private.json`],
    },
  ];
  return {
    sourcePath: 'docs/qa/native-pilot/inventory.json',
    sourceHash: hash('1'),
    dataMode: 'integration',
    contractHash: digest(entries),
    semanticHash: digest(entries.map(({ id: _id, ...entry }) => entry)),
    entries,
  };
}

function blockedIdentity(runId: string) {
  return {
    ownerRunId: runId,
    processPid: null,
    processStartIdentity: null,
    ownedPorts: [],
    ownershipWindows: [],
    originalReceiptBinding: {
      status: 'pending' as const,
      receiptPath: null,
      artifactRoot: null,
      receiptHash: null,
    },
  };
}

function attemptMeta(expected: NativeComparisonAttemptExpectation): {
  family: string;
  platform: 'ios' | 'android';
  engine: 'maestro' | 'detox';
  scenarioId: string;
} {
  const platform = expected.runId.includes('-ios-') ? 'ios' : 'android';
  const engine = expected.runId.includes('-detox-') ? 'detox' : 'maestro';
  const prefix = 'run-';
  const suffix = `-${platform}-${engine}-${expected.trialOrdinal}`;
  const family = expected.runId.slice(prefix.length, -suffix.length);
  return { family, platform, engine, scenarioId: `SCN-${family}-${platform}` };
}

let expectedAttempts: NativeComparisonAttemptExpectation[] = [];

function makeSpec(): NativeComparisonSpec {
  const cells: NativeComparisonCell[] = [];
  expectedAttempts = [];
  for (const family of [
    'session',
    'training',
    'connection',
    'camera-denied',
    'save-retry',
  ] as const)
    for (const platform of ['ios', 'android'] as const)
      for (const engine of ['maestro', 'detox'] as const) {
        const cellAttempts: NativeComparisonAttemptExpectation[] = [];
        for (let ordinal = 1; ordinal <= 20; ordinal++) {
          const runId = `run-${family}-${platform}-${engine}-${ordinal}`;
          const expected: NativeComparisonAttemptExpectation = {
            runId,
            trialOrdinal: ordinal,
            attemptId: `${runId}:first`,
            locale: 'en-US',
            cohortId: cohort.id,
            fixtureResetId: `reset-${runId}`,
            repositories: repositories(),
            target: target(),
            inputs: inputs(family, engine),
            coldAttemptIdentity: blockedIdentity(runId),
          };
          cellAttempts.push(expected);
          expectedAttempts.push(expected);
        }
        cells.push({
          scenarioId: `SCN-${family}-${platform}`,
          platform,
          engine,
          mode: 'integration',
          locale: 'en-US',
          requiredAssertionIds: [`NAT-${family}-source-control`],
          assertionLedger: ledger(family),
          expectedAttempts: cellAttempts,
        });
      }
  const pairs = new Map<string, { maestro: NativeComparisonCell; detox: NativeComparisonCell }>();
  for (const cell of cells) {
    const key = `${cell.scenarioId}|${cell.platform}`;
    const current =
      pairs.get(key) ?? ({} as { maestro: NativeComparisonCell; detox: NativeComparisonCell });
    current[cell.engine] = cell;
    pairs.set(key, current);
  }
  const executionOrder: NativeComparisonExecutionOrder[] = [...pairs.entries()].map(
    ([key, pair]) => {
      const [scenarioId, platform] = key.split('|') as [string, 'ios' | 'android'];
      return {
        pairId: `pair-${scenarioId}-${platform}`,
        scenarioId,
        platform,
        mode: 'integration',
        locale: 'en-US',
        firstEngine: 'maestro',
        trials: Array.from({ length: 20 }, (_, index) => {
          const ordinal = index + 1;
          const first = ordinal % 2 === 1 ? pair.maestro : pair.detox;
          const second = ordinal % 2 === 1 ? pair.detox : pair.maestro;
          return {
            trialOrdinal: ordinal,
            firstAttemptId: first.expectedAttempts[index].attemptId,
            secondAttemptId: second.expectedAttempts[index].attemptId,
          };
        }),
      };
    },
  );
  return {
    schemaVersion: 1,
    cohort,
    scope: 'full',
    attemptsPerCell: 20,
    minimumFirstAttemptPasses: 19,
    cells,
    executionOrder,
  };
}

function selection(expected: NativeComparisonAttemptExpectation): NativePilotSelection {
  const { platform, engine, scenarioId: scenario } = attemptMeta(expected);
  return {
    // The dispatcher treats the engine as an opaque label of its fixture matrix.
    arguments: { platform, engine: engine as 'maestro', scenario, mode: 'integration' },
    scenario: {
      id: scenario,
      platform,
      flowId: 'source-only-flow',
      transitionIds: [],
      requirementRefs: [],
      dataMode: 'postgres',
      fixtureRef: 'source-only-fixture',
      freshnessInputs: {
        requirementPaths: ['docs/plans/2026-09-29-testing-modernization-start-here.md'],
      },
    },
    scenarioHash: expected.inputs.scenarioHash!,
    requirementHash: expected.inputs.requirementHash!,
  };
}

async function resetFor(
  expected: NativeComparisonAttemptExpectation,
  outputRoot: string,
  cleanupStatus: FreshColdReset['cleanupStatus'] = 'cleaned',
  blocker: string | null = null,
): Promise<FreshColdReset> {
  const artifactRoot = path.join(outputRoot, 'reset-evidence');
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const resetEvidence = {
    fixtureResetId: expected.fixtureResetId,
    ownerRunId: expected.runId,
    cohortFixtureFingerprint: cohort.fixtureResetFingerprint,
    appStateFingerprint: hash('a'),
    fixtureStateFingerprint: hash('b'),
    sourceFingerprint: cohort.sourceFingerprint,
    helperFingerprint: hash('4'),
    cleanupStatus,
    target: {
      platform: attemptMeta(expected).platform,
      deviceId: 'source-only-target',
      appId: 'com.edufelip.mychampions.dev',
      binaryHash: hash('b'),
      apiOrigin: 'http://127.0.0.1:41000',
      captureRunId: expected.runId,
      ownerRunId: expected.runId,
      phase: 'reset-before-launch',
    },
    backend: {
      runId: expected.runId,
      ownerRunId: expected.runId,
      captureRunId: expected.runId,
      artifactRoot,
      apiOrigin: 'http://127.0.0.1:41000',
      apiPid: 41001,
      apiStarted: 'source-only-start',
      apiScript: 'source-only-api',
      backendAttemptId: expected.attemptId,
      manifestSha256: hash('5'),
    },
  };
  const bytes = JSON.stringify(resetEvidence);
  const receiptPath = path.join(artifactRoot, `${expected.attemptId.replaceAll(':', '_')}.json`);
  await writeFile(receiptPath, bytes, { mode: 0o600 });
  return {
    fixtureResetId: expected.fixtureResetId,
    ownerRunId: expected.runId,
    cohortFixtureFingerprint: cohort.fixtureResetFingerprint,
    status: 'fresh',
    startedAt: iso(1),
    finishedAt: iso(2),
    appStateFingerprint: hash('a'),
    fixtureStateFingerprint: hash('b'),
    sourceFingerprint: cohort.sourceFingerprint,
    helperFingerprint: hash('4'),
    originalResetBinding: {
      status: 'verified',
      receiptPath,
      artifactRoot,
      receiptHash: createHash('sha256').update(bytes).digest('hex'),
      identity: readNativeEvidenceObservation(artifactRoot, path.basename(receiptPath), true)
        .identity,
    } as SourceControlResetBinding,
    target: resetEvidence.target,
    backend: resetEvidence.backend,
    cleanupStatus,
    blocker,
  };
}

function positiveIdentity(
  expected: NativeComparisonAttemptExpectation,
): NativeComparisonColdAttemptIdentity {
  const processPid = 41_000 + expectedAttempts.indexOf(expected);
  const port = 51_000 + expectedAttempts.indexOf(expected);
  const acquiredAt = iso(10 + expectedAttempts.indexOf(expected));
  const releasedAt = iso(11 + expectedAttempts.indexOf(expected));
  const windows: NativeComparisonOwnershipWindow[] = [
    {
      resourceType: 'process',
      resourceId: String(processPid),
      ownerRunId: expected.runId,
      processStartIdentity: `start-${processPid}`,
      acquiredAt,
      releasedAt,
    },
    {
      resourceType: 'port',
      resourceId: String(port),
      ownerRunId: expected.runId,
      processStartIdentity: null,
      acquiredAt,
      releasedAt,
    },
  ];
  return {
    ownerRunId: expected.runId,
    processPid,
    processStartIdentity: `start-${processPid}`,
    ownedPorts: [port],
    ownershipWindows: windows,
    originalReceiptBinding: {
      status: 'pending' as const,
      receiptPath: null,
      artifactRoot: null,
      receiptHash: null,
    },
  };
}

async function writePositiveReceipt(
  outputRoot: string,
  expected: NativeComparisonAttemptExpectation,
  reset?: FreshColdReset,
  result: 'passed' | 'application-failed' | 'harness-blocked' = 'passed',
  cleanupStatus: 'cleaned' | 'failed-recovery-ledger-retained' = 'cleaned',
): Promise<ColdComparisonAttemptReceipt> {
  const artifactRoot = path.join(outputRoot, 'positive-attempt');
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const evidencePath = path.join(artifactRoot, 'evidence.json');
  await writeFile(evidencePath, '{}', { mode: 0o600 });
  if (cleanupStatus === 'failed-recovery-ledger-retained')
    await writeFile(path.join(artifactRoot, 'recovery.json'), '{}', { mode: 0o600 });
  const assertionOutcome =
    result === 'passed' ? 'passed' : result === 'application-failed' ? 'failed' : 'not-executed';
  const receipt = {
    schemaVersion: 1,
    runId: expected.runId,
    attemptId: expected.attemptId,
    scenarioId: attemptMeta(expected).scenarioId,
    phase: 'P4',
    layer: 'native',
    engine: 'maestro',
    dataMode: 'postgres',
    platform: expected.runId.includes('-ios-') ? 'ios' : 'android',
    locale: 'en-US',
    repositories: expected.repositories,
    target: expected.target,
    inputs: expected.inputs,
    command: { executable: 'source-only-dispatcher', argv: [expected.attemptId] },
    startedAt: iso(20),
    finishedAt: iso(21),
    result,
    exitCode: result === 'passed' ? 0 : result === 'application-failed' ? 1 : 2,
    childExitCode: result === 'passed' ? 0 : result === 'application-failed' ? 1 : null,
    assertions: [
      {
        id: `NAT-${attemptMeta(expected).family}-source-control`,
        requirementRefs: [`BL-018/P4-${attemptMeta(expected).family}`],
        outcome: assertionOutcome,
        evidencePaths: ['evidence.json'],
      },
    ],
    timingsMs: { build: 1, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 },
    cleanup: {
      status: cleanupStatus,
      ownedResourceIds: ['source-only-target'],
      recoveryRecordPath: cleanupStatus === 'cleaned' ? null : 'recovery.json',
    },
    artifacts: ['evidence.json'],
    blocker:
      result === 'passed'
        ? null
        : {
            code: result,
            detail: 'source-only controlled terminal outcome',
            owner: 'source-only-dispatcher-test',
            nextAction: 'retain row for comparison review',
          },
  };
  const bytes = JSON.stringify(receipt);
  const receiptPath = path.join(artifactRoot, 'receipt.json');
  await writeFile(receiptPath, bytes, { mode: 0o600 });
  const receiptHash = createHash('sha256').update(bytes).digest('hex');
  const identity = positiveIdentity(expected);
  identity.originalReceiptBinding = { status: 'verified', receiptPath, artifactRoot, receiptHash };
  return {
    runId: expected.runId,
    attemptId: expected.attemptId,
    status:
      result === 'application-failed'
        ? 'application-failed'
        : result === 'harness-blocked'
          ? 'harness-blocked'
          : 'received',
    ownerRunId: expected.runId,
    coldAttemptIdentity: identity,
    reset: reset ?? (await resetFor(expected, outputRoot)),
    receipt: { path: receiptPath, artifactRoot, receipt, receiptHash },
    issue: null,
  };
}

function blockedResult(
  expected: NativeComparisonAttemptExpectation,
  reset: FreshColdReset,
  status: 'harness-blocked' | 'cancelled' | 'missing',
  issue: string,
): ColdComparisonAttemptReceipt {
  return {
    runId: expected.runId,
    attemptId: expected.attemptId,
    status,
    ownerRunId: expected.runId,
    coldAttemptIdentity: blockedIdentity(expected.runId),
    reset,
    receipt: null,
    issue,
  };
}

async function outputRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-t15-dispatcher-')));
}

function builds(): CohortBuildReuse {
  return {
    sourceFingerprint: cohort.sourceFingerprint,
    helperFingerprint: hash('4'),
    flagsFingerprint: cohort.flagsFingerprint,
    byPlatform: { ios: null, android: null },
  };
}

function currentBuilds(
  mutate: (
    platform: 'ios' | 'android',
  ) => Partial<NonNullable<CohortBuildReuse['byPlatform']['ios']>> = () => ({}),
): CohortBuildReuse {
  const targetIdentity = target();
  const buildProfile = targetIdentity.buildProfile ?? 'source-only';
  const binaryHash = targetIdentity.binaryHash ?? hash('b');
  return {
    ...builds(),
    byPlatform: {
      ios: {
        platform: 'ios',
        buildId: 'source-only-ios-build',
        buildProfile,
        sourceFingerprint: cohort.sourceFingerprint,
        helperFingerprint: hash('4'),
        flagsFingerprint: cohort.flagsFingerprint,
        binaryHash,
        current: true,
        ...mutate('ios'),
      },
      android: {
        platform: 'android',
        buildId: 'source-only-android-build',
        buildProfile,
        sourceFingerprint: cohort.sourceFingerprint,
        helperFingerprint: hash('4'),
        flagsFingerprint: cohort.flagsFingerprint,
        binaryHash,
        current: true,
        ...mutate('android'),
      },
    },
  };
}

void test('T15 dispatcher seals 400 rows, serial pair order, fresh resets, and blocked denominator', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let calls = 0;
  const invoked: string[] = [];
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
      produce: ({ expected, reset }) => {
        calls += 1;
        invoked.push(expected.attemptId);
        if (expected.attemptId === expectedAttempts[0].attemptId)
          return writePositiveReceipt(root, expected, reset);
        if (attemptMeta(expected).engine === 'detox')
          return Promise.resolve(
            blockedResult(expected, reset, 'harness-blocked', 'detox-caller-pending'),
          );
        if (expected.trialOrdinal === 20)
          return Promise.resolve(
            blockedResult(expected, reset, 'missing', 'source-attempt-not-produced'),
          );
        if (expected.trialOrdinal === 2 && attemptMeta(expected).platform === 'ios')
          return Promise.resolve(
            blockedResult(expected, reset, 'cancelled', 'source-control-cancelled'),
          );
        return Promise.resolve(
          blockedResult(expected, reset, 'harness-blocked', 'maestro-runtime-pending'),
        );
      },
    });
    assert.equal(calls, 400);
    assert.equal(report.attempts.length, 400);
    assert.equal(report.scheduledAttempts, 400);
    assert.equal(report.dispatchedAttempts, 400);
    assert.equal(report.requestedAttempts, 400);
    assert.equal(new Set(report.physicalAttemptOrder).size, 400);
    assert.deepEqual(
      invoked.slice(0, 4).map((attemptId) => attemptId.includes('-maestro-')),
      [true, false, false, true],
    );
    assert.equal(report.sourceOnly, true);
    assert.equal(report.nativeExecution, 'not-run');
    assert.equal(report.publicPromotionEligible, false);
    assert.equal(report.nativePassingCases, 0);
    assert.equal(report.receipts.length, 1);
    assert.equal(report.comparison?.matrix.requestedAttempts, 400);
    assert.equal(report.comparison?.matrix.receivedAttempts, 1);
    assert.equal(report.comparison?.matrix.missingAttempts, 399);
    assert.equal(report.comparison?.comparisonEligible, false);
    assert.ok(report.attempts.some((attempt) => attempt.status === 'cancelled'));
    assert.ok(report.attempts.some((attempt) => attempt.status === 'missing'));
    assert.ok(
      report.attempts
        .filter((attempt) => attempt.status === 'harness-blocked')
        .every((attempt) => attempt.receipt === null),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher retains 400 cancelled rows when aborted before acquisition', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: controller.signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
      produce: () => {
        calls += 1;
        return Promise.reject(new Error('must not acquire after abort'));
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.attempts.length, 400);
    assert.equal(report.scheduledAttempts, 400);
    assert.equal(report.dispatchedAttempts, 0);
    assert.equal(report.attempts.filter((attempt) => attempt.status === 'cancelled').length, 400);
    assert.equal(report.terminalStatus, 'cancelled');
    assert.equal(report.receipts.length, 0);
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
    assert.ok(report.attempts.every((attempt) => attempt.coldAttemptIdentity.processPid === null));
    assert.ok(report.attempts.every((attempt) => attempt.reset.status === 'blocked'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher rejects swapped matrix before any producer call', async () => {
  const spec = makeSpec();
  const swapped = structuredClone(spec);
  const first = swapped.executionOrder[0].trials[0];
  [first.firstAttemptId, first.secondAttemptId] = [first.secondAttemptId, first.firstAttemptId];
  const root = await outputRoot();
  let calls = 0;
  try {
    await assert.rejects(
      runNativeComparisonCohort({
        spec: swapped,
        signal: new AbortController().signal,
        outputRoot: root,
        buildReuse: builds(),
        select: (expected) => Promise.resolve(selection(expected)),
        reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
        produce: () => {
          calls += 1;
          return Promise.reject(new Error('must not run'));
        },
      }),
      /swapped|pair|execution order/i,
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher turns foreign owner receipt into a blocked row and never promotes it', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
      produce: async ({ expected, reset }) => {
        if (expected.attemptId !== expectedAttempts[0].attemptId)
          return blockedResult(expected, reset, 'harness-blocked', 'negative-control');
        const forged = await writePositiveReceipt(root, expected, reset);
        forged.ownerRunId = 'foreign-owner';
        forged.coldAttemptIdentity.ownerRunId = 'foreign-owner';
        return forged;
      },
    });
    assert.equal(report.receipts.length, 0);
    assert.equal(report.attempts.length, 400);
    assert.ok(
      report.issues.some((issue) => issue.includes('foreign') || issue.includes('ownerRunId')),
    );
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
    assert.equal(report.publicPromotionEligible, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher retains a received row but blocks missing acquired ownership', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
      produce: async ({ expected, reset }) => {
        if (expected.attemptId !== expectedAttempts[0].attemptId)
          return blockedResult(expected, reset, 'harness-blocked', 'negative-control');
        const forged = await writePositiveReceipt(root, expected, reset);
        forged.coldAttemptIdentity.processPid = null;
        forged.coldAttemptIdentity.processStartIdentity = null;
        forged.coldAttemptIdentity.ownedPorts = [];
        forged.coldAttemptIdentity.ownershipWindows = [];
        return forged;
      },
    });
    const first = report.attempts[0];
    assert.equal(report.receipts.length, 0);
    assert.equal(first?.status, 'harness-blocked');
    assert.equal(first?.receipt !== null, true);
    assert.equal(first?.coldAttemptIdentity.processPid, null);
    assert.ok(first?.issue?.includes('lacks acquired ownership'));
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
    assert.equal(report.publicPromotionEligible, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher retires received status when acquired ownership has no receipt', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
      produce: ({ expected, reset }) => {
        if (expected.attemptId !== expectedAttempts[0].attemptId)
          return Promise.resolve(
            blockedResult(expected, reset, 'harness-blocked', 'negative-control'),
          );
        const forged = blockedResult(expected, reset, 'harness-blocked', 'missing-receipt');
        forged.status = 'received';
        forged.coldAttemptIdentity = positiveIdentity(expected);
        return Promise.resolve(forged);
      },
    });
    const first = report.attempts[0];
    assert.equal(first?.status, 'harness-blocked');
    assert.equal(first?.receipt, null);
    assert.equal(first?.coldAttemptIdentity.processPid !== null, true);
    assert.ok(first?.issue?.includes('lacks an original receipt'));
    assert.equal(report.receipts.length, 0);
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher preserves an acquired application failure and failed-recovery receipt', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
      produce: async ({ expected, reset }) => {
        if (expected.attemptId !== expectedAttempts[0].attemptId)
          return blockedResult(expected, reset, 'harness-blocked', 'negative-control');
        const terminal = await writePositiveReceipt(root, expected, reset, 'application-failed');
        throw new ColdComparisonAttemptError('application failed after acquisition', {
          ...terminal,
          issue: 'application-failed-after-acquisition',
        });
      },
    });
    const first = report.attempts[0];
    assert.equal(report.scheduledAttempts, 400);
    assert.equal(report.dispatchedAttempts, 400);
    assert.equal(first?.status, 'application-failed');
    assert.equal(first?.reset.cleanupStatus, 'cleaned');
    assert.equal(first?.coldAttemptIdentity.processPid !== null, true);
    assert.equal(
      first?.receipt?.receipt && (first.receipt.receipt as Record<string, unknown>).result,
      'application-failed',
    );
    assert.equal(report.receipts.length, 1);
    assert.equal(report.comparison?.matrix.receivedAttempts, 1);
    assert.equal(report.comparison?.cells[0]?.applicationFailures, 1);
    assert.ok(report.issues.some((issue) => issue.includes('producer-terminal')));
    assert.equal(report.publicPromotionEligible, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher retains terminal evidence from an ordinary post-acquisition throw', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
      produce: async (invocation) => {
        const { expected, reset } = invocation;
        if (expected.attemptId !== expectedAttempts[0].attemptId)
          return blockedResult(expected, reset, 'harness-blocked', 'negative-control');
        const terminal = await writePositiveReceipt(root, expected, reset, 'application-failed');
        invocation.terminalize({ ...terminal, issue: 'ordinary-post-acquisition-throw' });
        throw new Error('ordinary post-acquisition producer failure');
      },
    });
    const first = report.attempts[0];
    assert.equal(first?.status, 'application-failed');
    assert.equal(first?.receipt !== null, true);
    assert.equal(report.receipts.length, 1);
    assert.ok(report.issues.some((issue) => issue.includes('ordinary post-acquisition')));
    assert.equal(report.comparison?.matrix.receivedAttempts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher retains ownership and recovery evidence when cleanup fails after acquisition', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
      produce: async ({ expected, reset }) => {
        if (expected.attemptId !== expectedAttempts[0].attemptId)
          return blockedResult(expected, reset, 'harness-blocked', 'negative-control');
        const recoveryReset = await resetFor(
          expected,
          root,
          'failed-recovery-ledger-retained',
          'engine-cleanup-failed',
        );
        const terminal = await writePositiveReceipt(
          root,
          expected,
          recoveryReset,
          'harness-blocked',
          'failed-recovery-ledger-retained',
        );
        throw new ColdComparisonAttemptError('cleanup failed after acquisition', {
          ...terminal,
          issue: 'cleanup-failed-after-acquisition',
        });
      },
    });
    const first = report.attempts[0];
    assert.equal(first?.status, 'harness-blocked');
    assert.equal(first?.reset.cleanupStatus, 'failed-recovery-ledger-retained');
    assert.equal(first?.coldAttemptIdentity.processPid !== null, true);
    assert.equal(first?.receipt !== null, true);
    assert.equal(report.receipts.length, 1);
    assert.equal(report.comparison?.cells[0]?.cleanupFailures, 1);
    assert.ok(report.issues.some((issue) => issue.includes('cleanup failed after acquisition')));
    assert.equal(report.publicPromotionEligible, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher rejects stale selection fingerprints before reset or acquisition', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let resetCalls = 0;
  let producerCalls = 0;
  let first = true;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => {
        const picked = selection(expected);
        if (first) {
          first = false;
          picked.scenarioHash = hash('f');
        }
        return Promise.resolve(picked);
      },
      reset: async ({ expected, outputRoot }) => {
        resetCalls += 1;
        return resetFor(expected, outputRoot);
      },
      produce: ({ expected, reset }) => {
        producerCalls += 1;
        return Promise.resolve(blockedResult(expected, reset, 'harness-blocked', 'source-control'));
      },
    });
    assert.equal(resetCalls, 399);
    assert.equal(producerCalls, 399);
    assert.equal(report.attempts.length, 400);
    assert.equal(report.attempts[0]?.status, 'harness-blocked');
    assert.ok(report.attempts[0]?.issue?.includes('selection fingerprints'));
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher aborts after awaited selection before reset or acquisition', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  const controller = new AbortController();
  let resetCalls = 0;
  let producerCalls = 0;
  let first = true;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: controller.signal,
      outputRoot: root,
      buildReuse: builds(),
      select: async (expected) => {
        const picked = selection(expected);
        if (first) {
          first = false;
          await Promise.resolve();
          controller.abort();
        }
        return picked;
      },
      reset: async ({ expected, outputRoot }) => {
        resetCalls += 1;
        return resetFor(expected, outputRoot);
      },
      produce: ({ expected, reset }) => {
        producerCalls += 1;
        return Promise.resolve(
          blockedResult(expected, reset, 'harness-blocked', 'must-not-acquire'),
        );
      },
    });
    assert.equal(resetCalls, 0);
    assert.equal(producerCalls, 0);
    assert.equal(report.scheduledAttempts, 400);
    assert.equal(report.dispatchedAttempts, 0);
    assert.equal(report.attempts.filter((attempt) => attempt.status === 'cancelled').length, 400);
    assert.ok(report.attempts[0]?.issue?.includes('after-selection'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher rejects a reused build with the wrong target binary or profile', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let resetCalls = 0;
  let producerCalls = 0;
  try {
    const stale = currentBuilds(() => ({
      binaryHash: hash('f'),
      buildProfile: 'wrong-profile',
    }));
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: stale,
      select: (expected) => Promise.resolve(selection(expected)),
      reset: async ({ expected, outputRoot }) => {
        resetCalls += 1;
        return resetFor(expected, outputRoot);
      },
      produce: ({ expected, reset }) => {
        producerCalls += 1;
        return Promise.resolve(
          blockedResult(expected, reset, 'harness-blocked', 'must-not-acquire'),
        );
      },
    });
    assert.equal(resetCalls, 0);
    assert.equal(producerCalls, 0);
    assert.equal(report.attempts.length, 400);
    assert.equal(
      report.attempts.filter((attempt) => attempt.status === 'harness-blocked').length,
      400,
    );
    assert.ok(report.issues.some((issue) => issue.includes('build-blocked')));
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher blocks reset evidence changed after the reset producer returns', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let resetCalls = 0;
  let producerCalls = 0;
  let first = true;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: async ({ expected, outputRoot }) => {
        resetCalls += 1;
        const reset = await resetFor(expected, outputRoot);
        if (first) {
          first = false;
          await writeFile(reset.originalResetBinding.receiptPath!, '{}', { mode: 0o600 });
        }
        return reset;
      },
      produce: ({ expected, reset }) => {
        producerCalls += 1;
        return Promise.resolve(blockedResult(expected, reset, 'harness-blocked', 'source-control'));
      },
    });
    assert.equal(resetCalls, 400);
    assert.equal(producerCalls, 399);
    assert.equal(report.attempts[0]?.status, 'harness-blocked');
    assert.ok(report.attempts[0]?.issue?.includes('reset evidence changed'));
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher binds app and fixture reset fingerprints to the original receipt', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let resetCalls = 0;
  let producerCalls = 0;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: async ({ expected, outputRoot }) => {
        resetCalls += 1;
        const reset = await resetFor(expected, outputRoot);
        if (resetCalls === 1) reset.appStateFingerprint = hash('f');
        return reset;
      },
      produce: ({ expected, reset }) => {
        producerCalls += 1;
        return Promise.resolve(blockedResult(expected, reset, 'harness-blocked', 'must-not-run'));
      },
    });
    assert.equal(resetCalls, 400);
    assert.equal(producerCalls, 399);
    assert.ok(report.attempts[0]?.issue?.includes('not identity-bound'));
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher rejects forged reset fingerprint bytes even when their new hash is supplied', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let first = true;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: async ({ expected, outputRoot }) => {
        const reset = await resetFor(expected, outputRoot);
        if (first) {
          first = false;
          const receiptPath = reset.originalResetBinding.receiptPath!;
          const forged = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<string, unknown>;
          forged.fixtureStateFingerprint = hash('f');
          const bytes = JSON.stringify(forged);
          await writeFile(receiptPath, bytes, { mode: 0o600 });
          reset.originalResetBinding = {
            ...reset.originalResetBinding,
            receiptHash: createHash('sha256').update(bytes).digest('hex'),
            identity: readNativeEvidenceObservation(
              reset.originalResetBinding.artifactRoot!,
              path.basename(receiptPath),
              true,
            ).identity,
          } as SourceControlResetBinding;
        }
        return reset;
      },
      produce: ({ expected, reset }) =>
        Promise.resolve(blockedResult(expected, reset, 'harness-blocked', 'must-not-run')),
    });
    assert.ok(report.attempts[0]?.issue?.includes('not identity-bound'));
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher rejects hardlinked reset receipts before producer acquisition', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let first = true;
  let producerCalls = 0;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: async ({ expected, outputRoot }) => {
        const reset = await resetFor(expected, outputRoot);
        if (first) {
          first = false;
          await link(
            reset.originalResetBinding.receiptPath!,
            `${reset.originalResetBinding.receiptPath}.hardlink`,
          );
        }
        return reset;
      },
      produce: ({ expected, reset }) => {
        producerCalls += 1;
        return Promise.resolve(blockedResult(expected, reset, 'harness-blocked', 'must-not-run'));
      },
    });
    assert.equal(producerCalls, 399);
    assert.ok(report.attempts[0]?.issue?.includes('unowned reset evidence'));
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher rejects stale build fingerprints before producer calls', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  const stale = builds();
  stale.sourceFingerprint = hash('f');
  let calls = 0;
  try {
    await assert.rejects(
      runNativeComparisonCohort({
        spec,
        signal: new AbortController().signal,
        outputRoot: root,
        buildReuse: stale,
        select: (expected) => Promise.resolve(selection(expected)),
        reset: ({ expected, outputRoot }) => resetFor(expected, outputRoot),
        produce: () => {
          calls += 1;
          return Promise.reject(new Error('must not run'));
        },
      }),
      /build reuse|stale/i,
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher retains a blocked reset without invoking an engine', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let calls = 0;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: async ({ expected, outputRoot }) =>
        Promise.resolve({
          ...(await resetFor(expected, outputRoot)),
          status: 'blocked' as const,
          finishedAt: null,
          appStateFingerprint: null,
          fixtureStateFingerprint: null,
          sourceFingerprint: null,
          helperFingerprint: null,
          originalResetBinding: {
            status: 'pending' as const,
            receiptPath: null,
            artifactRoot: null,
            receiptHash: null,
          },
          cleanupStatus: 'not-acquired' as const,
          blocker: 'target-unavailable',
        }),
      produce: () => {
        calls += 1;
        return Promise.reject(new Error('must not invoke a blocked reset'));
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.attempts.length, 400);
    assert.equal(
      report.attempts.filter((attempt) => attempt.status === 'harness-blocked').length,
      400,
    );
    assert.equal(report.receipts.length, 0);
    assert.ok(report.issues.every((issue) => issue.includes('reset-blocked')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher rejects a blocked reset that falsely reports cleanup complete', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let calls = 0;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: async ({ expected, outputRoot }) => ({
        ...(await resetFor(expected, outputRoot)),
        status: 'blocked' as const,
        finishedAt: null,
        appStateFingerprint: null,
        fixtureStateFingerprint: null,
        sourceFingerprint: null,
        helperFingerprint: null,
        originalResetBinding: {
          status: 'pending' as const,
          receiptPath: null,
          artifactRoot: null,
          receiptHash: null,
        },
        cleanupStatus: 'cleaned' as const,
        blocker: 'target-unavailable',
      }),
      produce: ({ expected, reset }) => {
        calls += 1;
        return Promise.resolve(blockedResult(expected, reset, 'harness-blocked', 'must-not-run'));
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.attempts.length, 400);
    assert.ok(report.issues.every((issue) => issue.includes('reset-blocked')));
    assert.equal(report.comparison?.matrix.missingAttempts, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 source test receipt is byte-bound to its private artifact root', async () => {
  makeSpec();
  const expected = expectedAttempts[0] ?? makeSpec().cells[0].expectedAttempts[0];
  const root = await outputRoot();
  try {
    const result = await writePositiveReceipt(root, expected);
    const bytes = await readFile(result.receipt!.path);
    assert.equal(result.receipt!.receiptHash, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.coldAttemptIdentity.originalReceiptBinding.status, 'verified');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T15 dispatcher routes reset growth and replacement through the protected reader', async () => {
  const runMutation = async (
    mutate: (receiptPath: string) => Promise<void>,
    issuePattern: RegExp,
  ) => {
    const spec = makeSpec();
    const root = await outputRoot();
    let first = true;
    let producerCalls = 0;
    try {
      const report = await runNativeComparisonCohort({
        spec,
        signal: new AbortController().signal,
        outputRoot: root,
        buildReuse: builds(),
        select: (expected) => Promise.resolve(selection(expected)),
        reset: async ({ expected, outputRoot }) => {
          const reset = await resetFor(expected, outputRoot);
          if (first) {
            first = false;
            await mutate(reset.originalResetBinding.receiptPath!);
          }
          return reset;
        },
        produce: ({ expected, reset }) => {
          producerCalls += 1;
          return Promise.resolve(blockedResult(expected, reset, 'harness-blocked', 'must-not-run'));
        },
      });
      assert.equal(producerCalls, 399);
      assert.equal(report.attempts.length, 400);
      assert.ok(report.attempts[0]?.issue?.match(issuePattern));
      assert.equal(report.comparison?.matrix.missingAttempts, 400);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };

  await runMutation(
    async (receiptPath) => truncate(receiptPath, 8 * 1024 * 1024 + 1),
    /reset-blocked:.*bounded/,
  );
  await runMutation(async (receiptPath) => {
    const moved = receiptPath + '.moved';
    await rename(receiptPath, moved);
    await symlink(moved, receiptPath);
  }, /reset-blocked:.*symlink/);
});

void test('T15 final collection rejects a same-byte receipt replacement after verified producer intake', async () => {
  const spec = makeSpec();
  const root = await outputRoot();
  let originalReceiptPath: string | null = null;
  let resetCalls = 0;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      signal: new AbortController().signal,
      outputRoot: root,
      buildReuse: builds(),
      select: (expected) => Promise.resolve(selection(expected)),
      reset: async ({ expected, outputRoot }) => {
        resetCalls += 1;
        if (resetCalls === 2 && originalReceiptPath) {
          const original = await readFile(originalReceiptPath);
          await rename(originalReceiptPath, originalReceiptPath + '.original');
          await writeFile(originalReceiptPath, original, { mode: 0o600 });
        }
        return resetFor(expected, outputRoot);
      },
      produce: async ({ expected, reset }) => {
        if (resetCalls === 1) {
          const result = await writePositiveReceipt(root, expected, reset);
          originalReceiptPath = result.receipt!.path;
          return result;
        }
        return blockedResult(expected, reset, 'harness-blocked', 'source-control');
      },
    });
    assert.equal(report.attempts.length, 400);
    assert.equal(report.attempts[0]?.status, 'received');
    assert.equal(report.comparison, null);
    assert.ok(
      report.issues.some((issue) => /collector-blocked:.*descriptor identity changed/.test(issue)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

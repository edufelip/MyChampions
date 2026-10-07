import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkSync, readFileSync, renameSync, truncateSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  collectNativeComparison,
  nativeComparisonCellKey,
  readNativeComparisonReceipts,
  validateNativeComparisonSpec,
} from '../../scripts/testing/compare-native-pilot';
import type {
  NativeComparisonAssertionLedger,
  NativeComparisonAttemptExpectation,
  NativeComparisonCell,
  NativeComparisonCohortExpectation,
  NativeComparisonExecutionOrder,
  NativeComparisonInputExpectation,
  NativeComparisonLocale,
  NativeComparisonOwnershipWindow,
  NativeComparisonReceiptInput,
  NativeComparisonRepositoryExpectation,
  NativeComparisonSpec,
  NativeComparisonTargetExpectation,
} from '../../scripts/testing/compare-native-pilot';

const hash = (character: string) => character.repeat(64);
const sha = (character: string) => character.repeat(40);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function assertionLedger(
  ids: string[],
  dataMode: 'integration' | 'fixture' = 'integration',
): NativeComparisonAssertionLedger {
  const entries = ids.map((id, index) => ({
    id,
    requirementRefs: [id === 'assertion-one' ? 'BL-018/P4-training' : `BL-018/P4-${index + 1}`],
    requirementPaths: ['docs/plans/2026-09-29-testing-modernization-start-here.md'],
    evidenceKinds: ['ui'] as ('ui' | 'api' | 'sql')[],
    startingState: 'Synthetic reviewed starting state',
    action: `Synthetic reviewed action ${index + 1}`,
    expected: `Synthetic reviewed expectation ${index + 1}`,
    evidencePathTemplates: [`assertions/{attemptId}/${id}.private.json`],
  }));
  return {
    sourcePath: 'docs/qa/native-pilot/inventory.json',
    sourceHash: hash('7'),
    dataMode,
    contractHash: digest(entries),
    semanticHash: digest(entries.map(({ id: _id, ...entry }) => entry)),
    entries,
  };
}

function currentInventoryLedger(scenarioId: string): NativeComparisonAssertionLedger {
  const inventoryPath = path.resolve('docs/qa/native-pilot/inventory.json');
  const bytes = readFileSync(inventoryPath);
  const inventory = JSON.parse(bytes.toString('utf8')) as {
    scenarios: {
      id: string;
      dataMode: 'postgres';
      pilotAssertions: NativeComparisonAssertionLedger['entries'];
      pilotAssertionContract: {
        sha256: string;
        semanticSha256?: string;
      };
    }[];
  };
  const scenario = inventory.scenarios.find((candidate) => candidate.id === scenarioId);
  assert(scenario, `current inventory is missing ${scenarioId}`);
  return {
    sourcePath: 'docs/qa/native-pilot/inventory.json',
    sourceHash: createHash('sha256').update(bytes).digest('hex'),
    dataMode: 'integration',
    contractHash: scenario.pilotAssertionContract.sha256,
    semanticHash: scenario.pilotAssertionContract.semanticSha256 ?? null,
    entries: scenario.pilotAssertions,
  };
}

let nextFreshIdentity = 20_000;
const expectedByAttemptId = new Map<string, NativeComparisonAttemptExpectation>();
const defaultCohort: NativeComparisonCohortExpectation = {
  id: 'cohort-1',
  sourceFingerprint: hash('5'),
  fixtureResetFingerprint: hash('6'),
  flagsFingerprint: hash('4'),
  instrumentationOnlyDifferences: [
    { platform: 'ios' as const, reason: 'Synthetic engine instrumentation binary difference' },
    { platform: 'android' as const, reason: 'Synthetic engine instrumentation binary difference' },
  ],
};

function repositories(client = 'c', server = 'd'): NativeComparisonRepositoryExpectation[] {
  return [
    { name: 'client', sha: sha(client), dirty: false, workingTreeHash: null },
    { name: 'server', sha: sha(server), dirty: false, workingTreeHash: null },
  ];
}

function target(binaryCharacter: string): NativeComparisonTargetExpectation {
  return {
    deviceId: 'owned-device',
    osVersion: '17',
    appId: 'com.edufelip.mychampions.dev',
    buildProfile: 'owned-dev',
    binaryHash: hash(binaryCharacter),
    apiOrigin: 'http://127.0.0.1:41000',
  };
}

function inputs(
  fixtureCharacter: string,
  engine: 'maestro' | 'detox',
  scenarioCharacter = '1',
): NativeComparisonInputExpectation {
  return {
    scenarioHash: hash(scenarioCharacter),
    requirementHash: hash('2'),
    fixtureHash: hash('f'),
    flagsHash: hash('4'),
    toolVersions: { [engine]: engine === 'maestro' ? '2.6.1' : '20.38.0' },
  };
}

function expectedAttempt(
  attemptId: string,
  identity: Pick<NativeComparisonCell, 'engine'>,
  fixtureCharacter: string,
  binaryCharacter: string,
  trialOrdinal = 1,
  locale: NativeComparisonLocale = 'en-US',
  cohortId = defaultCohort.id,
  fixtureResetId = `reset-${attemptId}`,
): NativeComparisonAttemptExpectation {
  const runId = `run-${attemptId}`;
  const processPid = nextFreshIdentity++;
  const ownedPort = 30_000 + nextFreshIdentity;
  const processStartIdentity = `start-${processPid}`;
  const acquiredAt = new Date(Date.parse('2026-10-01T00:00:00.000Z') + processPid * 1000);
  const releasedAt = new Date(acquiredAt.getTime() + 500).toISOString();
  const acquiredAtIso = acquiredAt.toISOString();
  const ownershipWindows: NativeComparisonOwnershipWindow[] = [
    {
      resourceType: 'process',
      resourceId: String(processPid),
      ownerRunId: runId,
      processStartIdentity,
      acquiredAt: acquiredAtIso,
      releasedAt,
    },
    {
      resourceType: 'port',
      resourceId: String(ownedPort),
      ownerRunId: runId,
      processStartIdentity: null,
      acquiredAt: acquiredAtIso,
      releasedAt,
    },
  ];
  const expected = {
    runId,
    trialOrdinal,
    attemptId: `${runId}:first`,
    locale,
    cohortId,
    fixtureResetId,
    repositories: repositories(),
    target: target(binaryCharacter),
    inputs: inputs(fixtureCharacter, identity.engine),
    coldAttemptIdentity: {
      ownerRunId: runId,
      processPid,
      processStartIdentity,
      ownedPorts: [ownedPort],
      ownershipWindows,
      originalReceiptBinding: {
        status: 'pending' as const,
        receiptPath: null,
        artifactRoot: null,
        receiptHash: null,
      },
    },
  };
  expectedByAttemptId.set(expected.attemptId, expected);
  return expected;
}

function setColdResourceIdentity(
  expected: NativeComparisonAttemptExpectation,
  processPid: number,
  processStartIdentity: string,
  port: number,
  acquiredAt: string,
  releasedAt: string,
): void {
  expected.coldAttemptIdentity = {
    ownerRunId: expected.runId,
    processPid,
    processStartIdentity,
    ownedPorts: [port],
    ownershipWindows: [
      {
        resourceType: 'process',
        resourceId: String(processPid),
        ownerRunId: expected.runId,
        processStartIdentity,
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
    ],
    originalReceiptBinding: expected.coldAttemptIdentity.originalReceiptBinding,
  };
}

function cell(
  identity: Pick<NativeComparisonCell, 'scenarioId' | 'platform' | 'engine' | 'mode' | 'locale'>,
  attempts: NativeComparisonAttemptExpectation[],
  requiredAssertionIds = ['assertion-one'],
): NativeComparisonCell {
  return {
    ...identity,
    requiredAssertionIds,
    assertionLedger: assertionLedger(
      requiredAssertionIds,
      identity.mode === 'integration' ? 'integration' : 'fixture',
    ),
    expectedAttempts: attempts,
  };
}

function spec(
  cells: NativeComparisonCell[],
  minimumFirstAttemptPasses = cells[0].expectedAttempts.length,
  executionOrder: NativeComparisonExecutionOrder[] = [],
): NativeComparisonSpec {
  return {
    schemaVersion: 1,
    cohort: defaultCohort,
    scope: 'partial',
    attemptsPerCell: cells[0].expectedAttempts.length,
    minimumFirstAttemptPasses,
    cells,
    executionOrder,
  };
}

function executionOrderForCells(
  cells: NativeComparisonCell[],
  firstEngine: 'maestro' | 'detox' = 'maestro',
): NativeComparisonExecutionOrder[] {
  const pairs = new Map<string, Map<'maestro' | 'detox', NativeComparisonCell>>();
  for (const current of cells) {
    const key = [current.scenarioId, current.platform, current.mode, current.locale].join('|');
    const byEngine = pairs.get(key) ?? new Map<'maestro' | 'detox', NativeComparisonCell>();
    byEngine.set(current.engine, current);
    pairs.set(key, byEngine);
  }
  return [...pairs.entries()]
    .filter(([, byEngine]) => byEngine.size === 2)
    .map(([key, byEngine]) => {
      const first = byEngine.get(firstEngine)!;
      const second = byEngine.get(firstEngine === 'maestro' ? 'detox' : 'maestro')!;
      return {
        pairId: `pair-${key.replaceAll('|', '-')}`,
        scenarioId: first.scenarioId,
        platform: first.platform,
        mode: first.mode,
        locale: first.locale,
        firstEngine,
        trials: Array.from({ length: first.expectedAttempts.length }, (_, index) => {
          const trialOrdinal = index + 1;
          const firstExpected =
            trialOrdinal % 2 === 1 ? first.expectedAttempts[index] : second.expectedAttempts[index];
          const secondExpected =
            trialOrdinal % 2 === 1 ? second.expectedAttempts[index] : first.expectedAttempts[index];
          return {
            trialOrdinal,
            firstAttemptId: firstExpected.attemptId,
            secondAttemptId: secondExpected.attemptId,
          };
        }),
      };
    });
}

function receiptFor(
  expected: NativeComparisonAttemptExpectation,
  identity: Pick<NativeComparisonCell, 'scenarioId' | 'platform' | 'engine' | 'mode' | 'locale'>,
  result: 'passed' | 'application-failed' | 'harness-blocked' | 'cancelled' = 'passed',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const dataMode = identity.mode === 'integration' ? 'postgres' : 'fixture';
  const assertions =
    result === 'passed'
      ? [
          {
            id: 'assertion-one',
            requirementRefs: ['BL-018/P4-training'],
            outcome: 'passed',
            evidencePaths: ['evidence.json'],
          },
        ]
      : result === 'application-failed'
        ? [
            {
              id: 'assertion-one',
              requirementRefs: ['BL-018/P4-training'],
              outcome: 'failed',
              evidencePaths: ['evidence.json'],
            },
          ]
        : [];
  const exitCode =
    result === 'passed'
      ? 0
      : result === 'application-failed'
        ? 1
        : result === 'cancelled'
          ? 130
          : 2;
  const cleanup =
    result === 'cancelled'
      ? {
          status: 'failed-recovery-ledger-retained',
          ownedResourceIds: ['owned-device'],
          recoveryRecordPath: 'recovery.json',
        }
      : {
          status: 'cleaned',
          ownedResourceIds: result === 'harness-blocked' ? [] : ['owned-device'],
          recoveryRecordPath: null,
        };
  return {
    schemaVersion: 1,
    runId: expected.runId,
    attemptId: expected.attemptId,
    scenarioId: identity.scenarioId,
    phase: 'P4',
    layer: 'native',
    engine: identity.engine,
    dataMode,
    platform: identity.platform,
    locale: expected.locale,
    repositories: expected.repositories,
    target: expected.target,
    inputs: expected.inputs,
    command: { executable: 'node', argv: ['synthetic-native-attempt'] },
    startedAt: '2026-09-30T00:00:00.000Z',
    finishedAt: '2026-09-30T00:00:01.000Z',
    result,
    exitCode,
    childExitCode: result === 'harness-blocked' ? null : result === 'cancelled' ? null : exitCode,
    assertions,
    timingsMs: { build: 10, install: 20, reset: 30, scenario: 40, verify: 50, cleanup: 60 },
    cleanup,
    artifacts: ['evidence.json'],
    blocker:
      result === 'passed' || result === 'application-failed'
        ? null
        : {
            code: 'synthetic-block',
            detail: 'Synthetic controlled outcome',
            owner: 'test',
            nextAction: 'Retain it',
          },
    ...overrides,
  };
}

async function artifactRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-comparison-')));
  await writeFile(path.join(root, 'evidence.json'), '{}', { mode: 0o600 });
  await writeFile(path.join(root, 'recovery.json'), '{}', { mode: 0o600 });
  return root;
}

function receiptInput(
  root: string,
  attemptId: string,
  receipt: unknown,
  fileName = `${attemptId}.json`,
): NativeComparisonReceiptInput {
  const bytes = JSON.stringify(receipt);
  const receiptPath = path.join(root, fileName);
  writeFileSync(receiptPath, bytes, { mode: 0o600 });
  const expected = expectedByAttemptId.get(attemptId);
  if (expected) {
    expected.coldAttemptIdentity.originalReceiptBinding = {
      status: 'verified',
      receiptPath,
      artifactRoot: root,
      receiptHash: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  return {
    path: receiptPath,
    artifactRoot: root,
    receipt,
    receiptHash: createHash('sha256').update(bytes).digest('hex'),
  };
}

void test('collector accepts explicit per-attempt fixture expectations and different engine binaries', async () => {
  const root = await artifactRoot();
  try {
    const maestro = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const detox = {
      scenarioId: 'SCN-training-ios' as const,
      platform: 'ios' as const,
      engine: 'detox' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const maestroExpected = [
      expectedAttempt('maestro-a1', maestro, 'a', 'a', 1),
      expectedAttempt('maestro-a2', maestro, 'b', 'a', 2),
    ];
    const detoxExpected = [
      expectedAttempt('detox-i1', detox, 'c', 'b', 1),
      expectedAttempt('detox-i2', detox, 'd', 'b', 2),
    ];
    const cells = [cell(maestro, maestroExpected), cell(detox, detoxExpected)];
    const inputs = [...maestroExpected, ...detoxExpected].map((expected, index) =>
      receiptInput(root, expected.attemptId, receiptFor(expected, index < 2 ? maestro : detox)),
    );
    const report = collectNativeComparison(spec(cells, 2), inputs);
    assert.equal(report.matrix.requestedAttempts, 4);
    assert.equal(report.matrix.receivedAttempts, 4);
    assert.equal(report.matrix.missingAttempts, 0);
    assert.equal(report.allCellsEligible, true);
    assert.equal(report.adoptionDecision, 'blocked');
    assert.deepEqual(report.cohort, defaultCohort);
    assert.equal(report.cells[0].cohortId, defaultCohort.id);
    assert.equal(report.attempts[0].cohortId, defaultCohort.id);
    assert.equal(report.attempts[0].fixtureResetId, 'reset-maestro-a1');
    assert.deepEqual(report.gateLimitations, {
      nonPassingOutcomeEvidence: 'not-modeled',
      controlledRegressionEvidence: 'not-modeled',
      maintenanceEvidence: 'not-modeled',
    });
    assert.deepEqual(
      report.cells.map((row) => row.decision),
      ['eligible', 'eligible'],
    );
    assert.equal(report.cells[0].timingMs.scenario.p50, 40);
    assert.equal(report.cells[0].timingMs.scenario.p95, 40);
    assert.equal(report.cells[0].timingMs.scenario.count, 2);
    assert.equal(nativeComparisonCellKey(maestro), report.cells[0].key);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector verifies an explicit alternating pair order from schema-valid receipt times', async () => {
  const root = await artifactRoot();
  try {
    const maestro = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const detox = { ...maestro, engine: 'detox' as const };
    const maestroExpected = Array.from({ length: 4 }, (_, index) =>
      expectedAttempt(`order-maestro-${index + 1}`, maestro, String(index + 1), 'a', index + 1),
    );
    const detoxExpected = Array.from({ length: 4 }, (_, index) =>
      expectedAttempt(`order-detox-${index + 1}`, detox, String(index + 1), 'b', index + 1),
    );
    const cells = [cell(maestro, maestroExpected), cell(detox, detoxExpected)];
    const executionOrder = executionOrderForCells(cells);
    const iso = (seconds: number) => `2026-09-30T00:00:${String(seconds).padStart(2, '0')}.000Z`;
    const expectedById = new Map(
      [...maestroExpected, ...detoxExpected].map((expected) => [expected.attemptId, expected]),
    );
    const identityByAttemptId = new Map<string, typeof maestro | typeof detox>([
      ...maestroExpected.map((expected) => [expected.attemptId, maestro] as const),
      ...detoxExpected.map((expected) => [expected.attemptId, detox] as const),
    ]);
    const values = executionOrder[0].trials.flatMap((trial, index) => {
      const firstExpected = expectedById.get(trial.firstAttemptId)!;
      const secondExpected = expectedById.get(trial.secondAttemptId)!;
      const firstStarted = index * 10;
      return [
        receiptInput(
          root,
          firstExpected.attemptId,
          receiptFor(firstExpected, identityByAttemptId.get(firstExpected.attemptId)!, 'passed', {
            startedAt: iso(firstStarted),
            finishedAt: iso(firstStarted + 1),
          }),
        ),
        receiptInput(
          root,
          secondExpected.attemptId,
          receiptFor(secondExpected, identityByAttemptId.get(secondExpected.attemptId)!, 'passed', {
            startedAt: iso(firstStarted + 2),
            finishedAt: iso(firstStarted + 3),
          }),
        ),
      ];
    });
    const report = collectNativeComparison(spec(cells, 4, executionOrder), values);
    assert.equal(report.executionOrder.required, true);
    assert.equal(report.executionOrder.status, 'verified');
    assert.equal(report.executionOrder.expectedPairs, 1);
    assert.equal(report.executionOrder.expectedTrials, 4);
    assert.equal(report.executionOrder.verifiedTrials, 4);
    assert.ok(report.executionOrder.pairs[0].trials.every((trial) => trial.status === 'verified'));
    assert.equal(report.allCellsEligible, true);
    assert.equal(report.comparisonEligible, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector rejects grouped odd/even physical execution despite alternating declared pair IDs', async () => {
  const root = await artifactRoot();
  try {
    const maestro = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const detox = { ...maestro, engine: 'detox' as const };
    const maestroExpected = Array.from({ length: 4 }, (_, index) =>
      expectedAttempt(`grouped-maestro-${index + 1}`, maestro, String(index + 1), 'a', index + 1),
    );
    const detoxExpected = Array.from({ length: 4 }, (_, index) =>
      expectedAttempt(`grouped-detox-${index + 1}`, detox, String(index + 1), 'b', index + 1),
    );
    const cells = [cell(maestro, maestroExpected), cell(detox, detoxExpected)];
    const executionOrder = executionOrderForCells(cells);
    const expectedById = new Map(
      [...maestroExpected, ...detoxExpected].map((expected) => [expected.attemptId, expected]),
    );
    const identityByAttemptId = new Map<string, typeof maestro | typeof detox>([
      ...maestroExpected.map((expected) => [expected.attemptId, maestro] as const),
      ...detoxExpected.map((expected) => [expected.attemptId, detox] as const),
    ]);
    const iso = (seconds: number) => `2026-09-30T00:02:${String(seconds).padStart(2, '0')}.000Z`;
    const physicalTrialOrder = [0, 2, 1, 3];
    const ranges = new Map<string, { startedAt: string; finishedAt: string }>();
    let clock = 0;
    for (const trialIndex of physicalTrialOrder) {
      const trial = executionOrder[0].trials[trialIndex];
      ranges.set(trial.firstAttemptId, {
        startedAt: iso(clock),
        finishedAt: iso(clock + 1),
      });
      ranges.set(trial.secondAttemptId, {
        startedAt: iso(clock + 2),
        finishedAt: iso(clock + 3),
      });
      clock += 4;
    }
    const boundaryTrial = executionOrder[0].trials[3];
    ranges.set(boundaryTrial.firstAttemptId, {
      startedAt: iso(7),
      finishedAt: iso(8),
    });
    ranges.set(boundaryTrial.secondAttemptId, {
      startedAt: iso(9),
      finishedAt: iso(10),
    });
    const values = [...expectedById.values()].map((expected) =>
      receiptInput(
        root,
        expected.attemptId,
        receiptFor(expected, identityByAttemptId.get(expected.attemptId)!, 'passed', {
          ...ranges.get(expected.attemptId),
        }),
      ),
    );
    const report = collectNativeComparison(spec(cells, 4, executionOrder), values);
    const pair = report.executionOrder.pairs[0];
    assert.equal(report.matrix.receivedAttempts, 8);
    assert.equal(report.executionOrder.status, 'blocked');
    assert.ok(pair.issues.includes('execution-order-cross-trial-reversed'));
    assert.ok(pair.issues.includes('execution-order-cross-trial-overlap'));
    assert.ok(pair.issues.includes('execution-order-cross-trial-equal-boundary'));
    assert.ok(
      pair.trials.some((trial) => trial.issues.includes('execution-order-cross-trial-reversed')),
    );
    assert.equal(report.allCellsEligible, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector preserves chronology proof for exact failed and cancelled receipts', async () => {
  const root = await artifactRoot();
  try {
    const maestro = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const detox = { ...maestro, engine: 'detox' as const };
    const maestroExpected = Array.from({ length: 2 }, (_, index) =>
      expectedAttempt(`outcome-maestro-${index + 1}`, maestro, String(index + 1), 'a', index + 1),
    );
    const detoxExpected = Array.from({ length: 2 }, (_, index) =>
      expectedAttempt(`outcome-detox-${index + 1}`, detox, String(index + 1), 'b', index + 1),
    );
    const cells = [cell(maestro, maestroExpected), cell(detox, detoxExpected)];
    const executionOrder = executionOrderForCells(cells);
    const expectedById = new Map(
      [...maestroExpected, ...detoxExpected].map((expected) => [expected.attemptId, expected]),
    );
    const identityByAttemptId = new Map<string, typeof maestro | typeof detox>([
      ...maestroExpected.map((expected) => [expected.attemptId, maestro] as const),
      ...detoxExpected.map((expected) => [expected.attemptId, detox] as const),
    ]);
    const resultByAttemptId = new Map([
      [executionOrder[0].trials[0].firstAttemptId, 'application-failed' as const],
      [executionOrder[0].trials[0].secondAttemptId, 'cancelled' as const],
    ]);
    const iso = (seconds: number) => `2026-09-30T00:03:${String(seconds).padStart(2, '0')}.000Z`;
    const values = [...expectedById.values()].map((expected, index) => {
      const trialIndex = expected.trialOrdinal - 1;
      const first = executionOrder[0].trials[trialIndex].firstAttemptId;
      const isFirst = expected.attemptId === first;
      const start = trialIndex * 10 + (isFirst ? 0 : 2);
      return receiptInput(
        root,
        expected.attemptId,
        receiptFor(
          expected,
          identityByAttemptId.get(expected.attemptId)!,
          resultByAttemptId.get(expected.attemptId) ?? 'passed',
          {
            startedAt: iso(start),
            finishedAt: iso(start + 1),
          },
        ),
        `outcome-${index}.json`,
      );
    });
    const report = collectNativeComparison(spec(cells, 2, executionOrder), values);
    assert.equal(report.executionOrder.status, 'verified');
    assert.equal(report.executionOrder.verifiedTrials, 2);
    assert.equal(report.allCellsEligible, false);
    assert.equal(report.attempts.filter((attempt) => attempt.orderCompatible).length, 4);
    assert.equal(
      report.attempts.some((attempt) =>
        attempt.issues.includes('execution-order-incompatible-receipt'),
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector blocks missing, equal, overlapping and reversed receipt chronology without dropping rows', async () => {
  const root = await artifactRoot();
  try {
    const maestro = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const detox = { ...maestro, engine: 'detox' as const };
    const maestroExpected = Array.from({ length: 4 }, (_, index) =>
      expectedAttempt(`block-maestro-${index + 1}`, maestro, String(index + 1), 'a', index + 1),
    );
    const detoxExpected = Array.from({ length: 4 }, (_, index) =>
      expectedAttempt(`block-detox-${index + 1}`, detox, String(index + 1), 'b', index + 1),
    );
    const cells = [cell(maestro, maestroExpected), cell(detox, detoxExpected)];
    const executionOrder = executionOrderForCells(cells);
    const expectedById = new Map(
      [...maestroExpected, ...detoxExpected].map((expected) => [expected.attemptId, expected]),
    );
    const identityByAttemptId = new Map<string, typeof maestro | typeof detox>([
      ...maestroExpected.map((expected) => [expected.attemptId, maestro] as const),
      ...detoxExpected.map((expected) => [expected.attemptId, detox] as const),
    ]);
    const iso = (seconds: number) => `2026-09-30T00:01:${String(seconds).padStart(2, '0')}.000Z`;
    const ranges = [
      [0, 1, 2, 3],
      [10, 11, 10, 12],
      [20, 23, 22, 24],
      [30, 31, 29, 30],
    ];
    const values = executionOrder[0].trials.flatMap((trial, index) => {
      const firstExpected = expectedById.get(trial.firstAttemptId)!;
      const secondExpected = expectedById.get(trial.secondAttemptId)!;
      const [firstStart, firstFinish, secondStart, secondFinish] = ranges[index];
      const rows = [
        receiptInput(
          root,
          firstExpected.attemptId,
          receiptFor(firstExpected, identityByAttemptId.get(firstExpected.attemptId)!, 'passed', {
            startedAt: iso(firstStart),
            finishedAt: iso(firstFinish),
          }),
        ),
      ];
      if (index !== 0)
        rows.push(
          receiptInput(
            root,
            secondExpected.attemptId,
            receiptFor(
              secondExpected,
              identityByAttemptId.get(secondExpected.attemptId)!,
              'passed',
              {
                startedAt: iso(secondStart),
                finishedAt: iso(secondFinish),
              },
            ),
          ),
        );
      return rows;
    });
    const report = collectNativeComparison(spec(cells, 4, executionOrder), values);
    const pair = report.executionOrder.pairs[0];
    assert.equal(report.matrix.requestedAttempts, 8);
    assert.equal(report.matrix.receivedAttempts, 7);
    assert.equal(report.matrix.missingAttempts, 1);
    assert.equal(report.executionOrder.status, 'blocked');
    assert.equal(report.executionOrder.verifiedTrials, 0);
    assert.deepEqual(
      pair.trials.map((trial) => trial.issues[0]),
      [
        'execution-order-missing-attempt',
        'execution-order-equal-start',
        'execution-order-overlap',
        'execution-order-reversed',
      ],
    );
    assert.equal(report.allCellsEligible, false);
    assert.equal(report.attempts.length, 8);
    assert.equal(report.attempts.filter((attempt) => !attempt.received).length, 1);
    assert.ok(
      report.attempts.every((attempt) =>
        attempt.issues.some((issue) => issue.startsWith('execution-order-')),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector retains application, harness, cancellation and cleanup failures in the denominator', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-save-retry-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = [
      expectedAttempt('attempt-pass', identity, 'a', 'a', 1),
      expectedAttempt('attempt-app-failed', identity, 'b', 'a', 2),
      expectedAttempt('attempt-blocked', identity, 'c', 'a', 3),
      expectedAttempt('attempt-cancelled', identity, 'd', 'a', 4),
    ];
    const values = [
      receiptFor(expected[0], identity, 'passed'),
      receiptFor(expected[1], identity, 'application-failed'),
      receiptFor(expected[2], identity, 'harness-blocked'),
      receiptFor(expected[3], identity, 'cancelled'),
    ];
    const report = collectNativeComparison(
      spec([cell(identity, expected)], 3),
      values.map((value, index) => receiptInput(root, expected[index].attemptId, value)),
    );
    const row = report.cells[0];
    assert.equal(row.requested, 4);
    assert.equal(row.received, 4);
    assert.equal(row.missing, 0);
    assert.equal(row.passed, 1);
    assert.equal(row.applicationFailures, 1);
    assert.equal(row.harnessBlocks, 1);
    assert.equal(row.cancellations, 1);
    assert.equal(row.cleanupFailures, 1);
    assert.equal(row.decision, 'blocked');
    assert.ok(
      row.reasons.includes(
        'non-passing attempts remain; failure explanation, controlled-regression and maintenance evidence are not modeled',
      ),
    );
    assert.equal(report.attempts.length, 4);
    assert.equal(report.attempts.filter((attempt) => attempt.received).length, 4);
    assert.equal(report.attempts.filter((attempt) => attempt.cleanupFailure).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector marks missing, incomplete and incompatible attempts blocked without dropping them', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = [
      expectedAttempt('attempt-incomplete', identity, 'a', 'a', 1),
      expectedAttempt('attempt-mismatch', identity, 'b', 'a', 2),
      expectedAttempt('attempt-missing', identity, 'c', 'a', 3),
    ];
    const incomplete = receiptFor(expected[0], identity, 'passed', {
      assertions: [
        {
          id: 'different-assertion',
          requirementRefs: ['BL-018/P4-training'],
          outcome: 'passed',
          evidencePaths: ['evidence.json'],
        },
      ],
    });
    const mismatch = receiptFor(expected[1], identity, 'passed', {
      inputs: { ...expected[1].inputs, fixtureHash: hash('e') },
    });
    const report = collectNativeComparison(spec([cell(identity, expected)], 3), [
      receiptInput(root, expected[0].attemptId, incomplete),
      receiptInput(root, expected[1].attemptId, mismatch),
    ]);
    const row = report.cells[0];
    assert.equal(row.requested, 3);
    assert.equal(row.received, 2);
    assert.equal(row.missing, 1);
    assert.equal(row.passed, 0);
    assert.equal(row.incompatibleReceipts, 1);
    assert.equal(row.decision, 'blocked');
    assert.ok(
      report.attempts.some((attempt) => attempt.issues.includes('missing-requested-attempt')),
    );
    assert.ok(
      report.attempts.some((attempt) =>
        attempt.issues.includes('missing-required-assertion:assertion-one'),
      ),
    );
    assert.ok(
      report.attempts.some((attempt) => attempt.issues.includes('input-fingerprint-mismatch')),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector keeps a malformed but bindable receipt in the requested denominator', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = [expectedAttempt('attempt-malformed', identity, 'a', 'a')];
    const report = collectNativeComparison(spec([cell(identity, expected)]), [
      receiptInput(root, expected[0].attemptId, { attemptId: expected[0].attemptId }),
    ]);
    assert.equal(report.matrix.receivedAttempts, 1);
    assert.equal(report.matrix.missingAttempts, 0);
    assert.equal(report.cells[0].invalidReceipts, 1);
    assert.equal(report.attempts[0].received, true);
    assert.equal(report.attempts[0].receiptValid, false);
    assert.ok(report.attempts[0].issues.includes('invalid-receipt-shape'));
    assert.equal(report.cells[0].decision, 'blocked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector keeps malformed nested assertion and evidence shapes in the denominator', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = [
      expectedAttempt('attempt-null-assertion', identity, 'a', 'a', 1),
      expectedAttempt('attempt-null-evidence', identity, 'b', 'a', 2),
    ];
    const malformed = [
      receiptFor(expected[0], identity, 'passed', { assertions: [null] }),
      receiptFor(expected[1], identity, 'passed', {
        assertions: [
          {
            id: 'assertion-one',
            outcome: 'passed',
            evidencePaths: null,
          },
        ],
      }),
    ];
    const report = collectNativeComparison(
      spec([cell(identity, expected)]),
      malformed.map((receipt, index) =>
        receiptInput(root, expected[index].attemptId, receipt, `malformed-${index}.json`),
      ),
    );
    assert.equal(report.matrix.receivedAttempts, 2);
    assert.equal(report.matrix.missingAttempts, 0);
    assert.equal(report.cells[0].invalidReceipts, 2);
    assert.equal(report.cells[0].passed, 0);
    assert.equal(report.cells[0].decision, 'blocked');
    assert.equal(report.attempts.filter((attempt) => attempt.receiptValid).length, 0);
    assert.equal(
      report.attempts.filter((attempt) => attempt.issues.includes('invalid-receipt-shape')).length,
      2,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector fail-closes schema-invalid nested target data after binding the attempt', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = expectedAttempt('attempt-invalid-target', identity, 'a', 'a');
    const report = collectNativeComparison(spec([cell(identity, [expected])]), [
      receiptInput(
        root,
        expected.attemptId,
        receiptFor(expected, identity, 'passed', {
          target: { ...expected.target, deviceId: 42 },
        }),
      ),
    ]);
    const attempt = report.attempts[0];
    assert.equal(report.matrix.receivedAttempts, 1);
    assert.equal(report.cells[0].invalidReceipts, 1);
    assert.equal(report.cells[0].incompatibleReceipts, 0);
    assert.equal(attempt.runId, expected.runId);
    assert.equal(attempt.receiptValid, false);
    assert.equal(attempt.result, null);
    assert.deepEqual(attempt.assertionIds, []);
    assert.deepEqual(attempt.timingMs, {});
    assert.ok(attempt.issues.includes('invalid-public-receipt'));
    assert.equal(report.cells[0].decision, 'blocked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector requires explicit supported locales and compares the locale fingerprint', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = [
      expectedAttempt('attempt-null-locale', identity, 'a', 'a', 1),
      expectedAttempt('attempt-unknown-locale', identity, 'b', 'a', 2),
      expectedAttempt('attempt-known-mismatch-locale', identity, 'c', 'a', 3),
    ];
    const report = collectNativeComparison(spec([cell(identity, expected)]), [
      receiptInput(
        root,
        expected[0].attemptId,
        receiptFor(expected[0], identity, 'passed', { locale: null }),
      ),
      receiptInput(
        root,
        expected[1].attemptId,
        receiptFor(expected[1], identity, 'passed', { locale: 'fr-FR' }),
      ),
      receiptInput(
        root,
        expected[2].attemptId,
        receiptFor(expected[2], identity, 'passed', { locale: 'pt-BR' }),
      ),
    ]);
    assert.equal(report.matrix.receivedAttempts, 3);
    assert.equal(report.cells[0].invalidReceipts, 2);
    assert.equal(report.cells[0].incompatibleReceipts, 1);
    assert.equal(report.cells[0].passed, 0);
    assert.equal(report.cells[0].decision, 'blocked');
    assert.ok(report.attempts[0].issues.includes('invalid-receipt-shape'));
    assert.ok(report.attempts[1].issues.includes('invalid-receipt-shape'));
    assert.ok(report.attempts[2].issues.includes('locale-mismatch'));
    assert.deepEqual(
      report.attempts.map((attempt) => attempt.locale),
      ['en-US', 'en-US', 'en-US'],
    );
    assert.equal(report.cells[0].locale, 'en-US');
    assert.throws(
      () =>
        validateNativeComparisonSpec(
          spec([cell({ ...identity, locale: 'fr-FR' as never }, [expected[0]])]),
        ),
      /locale is invalid/,
    );
    assert.throws(
      () =>
        validateNativeComparisonSpec(
          spec([cell(identity, [{ ...expected[0], locale: null as never }])]),
        ),
      /expectedAttempts\[0\]\.locale is invalid/,
    );
    assert.throws(
      () =>
        validateNativeComparisonSpec(
          spec([
            cell(identity, [
              expectedAttempt('attempt-locale-drift', identity, 'a', 'a', 1, 'pt-BR'),
            ]),
          ]),
        ),
      /locale must match the cell locale/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector requires native P4 receipts and the exact declared tool map', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = [
      expectedAttempt('attempt-wrong-native-phase', identity, 'a', 'a', 1),
      expectedAttempt('attempt-extra-tool', identity, 'b', 'a', 2),
      expectedAttempt('attempt-missing-tool', identity, 'c', 'a', 3),
    ];
    const report = collectNativeComparison(spec([cell(identity, expected)], 3), [
      receiptInput(
        root,
        expected[0].attemptId,
        receiptFor(expected[0], identity, 'passed', { phase: 'P3', layer: 'postgres-ui' }),
      ),
      receiptInput(
        root,
        expected[1].attemptId,
        receiptFor(expected[1], identity, 'passed', {
          inputs: { ...expected[1].inputs, toolVersions: { maestro: '2.6.1', adb: '1' } },
        }),
      ),
      receiptInput(
        root,
        expected[2].attemptId,
        receiptFor(expected[2], identity, 'passed', {
          inputs: { ...expected[2].inputs, toolVersions: { detox: '20.38.0' } },
        }),
      ),
    ]);
    assert.ok(report.attempts[0].issues.includes('receipt-phase-mismatch'));
    assert.ok(report.attempts[0].issues.includes('receipt-layer-mismatch'));
    assert.ok(report.attempts[1].issues.includes('tool-version-map-mismatch'));
    assert.ok(report.attempts[2].issues.includes('tool-version-map-mismatch'));
    assert.equal(report.cells[0].incompatibleReceipts, 3);
    assert.equal(report.cells[0].decision, 'blocked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector keeps first-attempt identity bound to the expected run and attempt pair', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = [expectedAttempt('attempt-first', identity, 'a', 'a')];
    const report = collectNativeComparison(spec([cell(identity, expected)]), [
      receiptInput(
        root,
        expected[0].attemptId,
        receiptFor(expected[0], identity, 'passed', {
          runId: 'retry-run',
        }),
      ),
    ]);
    assert.equal(report.attempts[0].runId, 'retry-run');
    assert.equal(report.attempts[0].expectedRunId, expected[0].runId);
    assert.ok(report.attempts[0].issues.includes('run-id-mismatch'));
    assert.ok(report.attempts[0].issues.includes('receipt-attempt-is-not-first'));
    assert.equal(report.cells[0].incompatibleReceipts, 1);
    assert.equal(report.attempts[0].passed, false);
    assert.equal(report.cells[0].decision, 'blocked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector rejects a requested retry from the first-attempt matrix', () => {
  const identity = {
    scenarioId: 'SCN-training-android' as const,
    platform: 'android' as const,
    engine: 'maestro' as const,
    mode: 'integration' as const,
    locale: 'en-US' as const,
  };
  const expected = expectedAttempt('attempt-retry-request', identity, 'a', 'a');
  assert.throws(
    () =>
      validateNativeComparisonSpec(
        spec([cell(identity, [{ ...expected, attemptId: `${expected.runId}:retry` }])]),
      ),
    /must encode the first attempt/,
  );
});

void test('comparison matrix seals one cohort and one unique fixture reset per trial', () => {
  const identity = {
    scenarioId: 'SCN-training-android' as const,
    platform: 'android' as const,
    engine: 'maestro' as const,
    mode: 'integration' as const,
    locale: 'en-US' as const,
  };
  const first = expectedAttempt('cohort-first', identity, 'a', 'a', 1);
  const second = expectedAttempt('cohort-second', identity, 'b', 'a', 2);
  assert.throws(
    () =>
      validateNativeComparisonSpec(
        spec([cell(identity, [{ ...first, cohortId: 'other-cohort' }])]),
      ),
    /cohortId must match the sealed cohort/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec(
        spec([cell(identity, [first, { ...second, fixtureResetId: first.fixtureResetId }])]),
      ),
    /duplicate fixture reset identities/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec({
        ...spec([cell(identity, [first])]),
        cohort: { ...defaultCohort, fixtureResetFingerprint: null as never },
      }),
    /cohort\.fixtureResetFingerprint is invalid/,
  );
});

void test('integration expectations and receipts require an API origin', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = expectedAttempt('attempt-api-origin', identity, 'a', 'a');
    assert.throws(
      () =>
        validateNativeComparisonSpec(
          spec([
            cell(identity, [{ ...expected, target: { ...expected.target, apiOrigin: null } }]),
          ]),
        ),
      /apiOrigin is required for integration cells/,
    );
    const report = collectNativeComparison(spec([cell(identity, [expected])]), [
      receiptInput(
        root,
        expected.attemptId,
        receiptFor(expected, identity, 'passed', {
          target: { ...expected.target, apiOrigin: null },
        }),
      ),
    ]);
    assert.ok(report.attempts[0].issues.includes('integration-api-origin-missing'));
    assert.equal(report.attempts[0].passed, false);
    assert.equal(report.cells[0].decision, 'blocked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector revalidates receipt path, artifact binding and original bytes', async () => {
  const root = await artifactRoot();
  const otherRoot = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = expectedAttempt('attempt-tampered', identity, 'a', 'a');
    const receipt = receiptFor(expected, identity);
    const input = receiptInput(root, expected.attemptId, receipt);
    assert.throws(
      () =>
        collectNativeComparison(spec([cell(identity, [expected])]), [
          { ...input, artifactRoot: otherRoot },
        ]),
      /not bound to its artifact root/,
    );
    writeFileSync(input.path, JSON.stringify({ ...receipt, runId: 'tampered' }), { mode: 0o600 });
    assert.throws(
      () => collectNativeComparison(spec([cell(identity, [expected])]), [input]),
      /hash does not match current bytes/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  }
});

void test('collector rejects duplicate or unknown receipt identities before comparison', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = [expectedAttempt('attempt-one', identity, 'a', 'a')];
    const value = receiptFor(expected[0], identity);
    const duplicate = [
      receiptInput(root, expected[0].attemptId, value),
      receiptInput(root, expected[0].attemptId, value),
    ];
    assert.throws(
      () => collectNativeComparison(spec([cell(identity, expected)]), duplicate),
      /Duplicate receipt attemptId/,
    );
    const unknown = receiptFor(expected[0], identity, 'harness-blocked', {
      runId: 'run-unknown',
      attemptId: 'run-unknown:first',
    });
    assert.throws(
      () =>
        collectNativeComparison(spec([cell(identity, expected)]), [
          receiptInput(root, 'unknown', unknown),
        ]),
      /not in the expected request matrix/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('full comparison specification requires the exact 20 integrated cells and 400 requested attempts', () => {
  const cells: NativeComparisonCell[] = [];
  for (const family of ['session', 'training', 'connection', 'camera-denied', 'save-retry'])
    for (const platform of ['ios', 'android'] as const)
      for (const engine of ['maestro', 'detox'] as const) {
        const identity = {
          scenarioId: `SCN-${family}-${platform}`,
          platform,
          engine,
          mode: 'integration' as const,
          locale: 'en-US' as const,
        };
        const attempts = Array.from({ length: 20 }, (_, index) =>
          expectedAttempt(
            `${family}-${platform}-${engine}-${index + 1}`,
            { engine },
            String(index % 10),
            engine === 'maestro' ? 'a' : 'b',
            index + 1,
          ),
        );
        cells.push(cell(identity, attempts));
      }
  const full = validateNativeComparisonSpec({
    schemaVersion: 1,
    cohort: defaultCohort,
    scope: 'full',
    attemptsPerCell: 20,
    cells,
    executionOrder: executionOrderForCells(cells),
  });
  assert.equal(full.cells.length, 20);
  assert.equal(
    full.cells.reduce((sum, row) => sum + row.expectedAttempts.length, 0),
    400,
  );
  assert.equal(full.minimumFirstAttemptPasses, 19);
  assert.equal(full.executionOrder.length, 10);
  assert.equal(
    full.executionOrder.every((pair) => pair.trials.length === 20),
    true,
  );
  assert.throws(
    () => validateNativeComparisonSpec({ ...full, executionOrder: [] }),
    /exactly 10 reviewed pair/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec({
        ...full,
        executionOrder: full.executionOrder.slice(0, -1),
      }),
    /exactly 10 reviewed pair/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec({
        ...full,
        executionOrder: full.executionOrder.map((pair, index) =>
          index === 0
            ? {
                ...pair,
                trials: pair.trials.map((trial, trialIndex) =>
                  trialIndex === 0
                    ? { ...trial, firstAttemptId: pair.trials[1].firstAttemptId }
                    : trial,
                ),
              }
            : pair,
        ),
      }),
    /exact expected attempt IDs/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec({
        ...full,
        executionOrder: full.executionOrder.map((pair, index) =>
          index === 0 ? { ...pair, locale: 'pt-BR' as const } : pair,
        ),
      }),
    /does not match exactly one maestro\/detox cell pair/,
  );
  assert.throws(
    () => validateNativeComparisonSpec({ ...full, scope: 'full', cells: cells.slice(0, 19) }),
    /20 cells/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec({
        ...full,
        scope: 'full',
        minimumFirstAttemptPasses: 18,
      }),
    /at least 19/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec({
        ...full,
        cells: cells.map((row) =>
          row === cells[0]
            ? {
                ...row,
                mode: 'fixture' as const,
                assertionLedger: assertionLedger(row.requiredAssertionIds, 'fixture'),
              }
            : row,
        ),
      }),
    /five integrated families/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec({
        ...full,
        cells: cells.map((row) =>
          row === cells[0]
            ? {
                ...row,
                expectedAttempts: row.expectedAttempts.map((attempt, index) =>
                  index === 1 ? { ...attempt, trialOrdinal: 1 } : attempt,
                ),
              }
            : row,
        ),
      }),
    /duplicate trial ordinals/,
  );
  assert.throws(
    () =>
      validateNativeComparisonSpec({
        ...full,
        cells: cells.map((row, index) =>
          index === 0
            ? {
                ...row,
                locale: 'pt-BR' as const,
                expectedAttempts: row.expectedAttempts.map((attempt) => ({
                  ...attempt,
                  locale: 'pt-BR' as const,
                })),
              }
            : row,
        ),
      }),
    /one explicit locale/,
  );
});

void test('collector collects a complete synthetic 400-receipt matrix without collapsing the denominator', async () => {
  const root = await artifactRoot();
  try {
    const cells: NativeComparisonCell[] = [];
    for (const family of ['session', 'training', 'connection', 'camera-denied', 'save-retry'])
      for (const platform of ['ios', 'android'] as const)
        for (const engine of ['maestro', 'detox'] as const) {
          const identity = {
            scenarioId: `SCN-${family}-${platform}`,
            platform,
            engine,
            mode: 'integration' as const,
            locale: 'en-US' as const,
          };
          const attempts = Array.from({ length: 20 }, (_, index) =>
            expectedAttempt(
              `full-${family}-${platform}-${engine}-${index + 1}`,
              { engine },
              String(index + 1),
              engine === 'maestro' ? 'a' : 'b',
              index + 1,
            ),
          );
          cells.push(cell(identity, attempts));
        }
    const reuseBaseMs = Date.parse('2026-10-01T00:00:00.000Z');
    let reuseIndex = 0;
    for (const expected of cells.flatMap((current) => current.expectedAttempts)) {
      const slot = reuseIndex % 3;
      const acquiredAt = new Date(reuseBaseMs + reuseIndex * 10_000).toISOString();
      const releasedAt = new Date(reuseBaseMs + reuseIndex * 10_000 + 1_000).toISOString();
      setColdResourceIdentity(
        expected,
        7_000 + slot,
        new Date(reuseBaseMs + reuseIndex * 10_000).toUTCString(),
        41_000 + slot,
        acquiredAt,
        releasedAt,
      );
      reuseIndex++;
    }
    const full = {
      schemaVersion: 1 as const,
      cohort: defaultCohort,
      scope: 'full' as const,
      attemptsPerCell: 20,
      minimumFirstAttemptPasses: 19,
      cells,
      executionOrder: executionOrderForCells(cells),
    };
    const expectedById = new Map(
      cells.flatMap((current) =>
        current.expectedAttempts.map((expected) => [expected.attemptId, expected] as const),
      ),
    );
    const identityByAttemptId = new Map(
      cells.flatMap((current) =>
        current.expectedAttempts.map((expected) => [expected.attemptId, current] as const),
      ),
    );
    const baseMs = Date.parse('2026-10-01T00:00:00.000Z');
    const values = full.executionOrder.flatMap((pair, pairIndex) =>
      pair.trials.flatMap((trial, trialIndex) => {
        const firstExpected = expectedById.get(trial.firstAttemptId)!;
        const secondExpected = expectedById.get(trial.secondAttemptId)!;
        const firstOffset = pairIndex * 100_000 + trialIndex * 4_000;
        const timestamp = (offset: number) => new Date(baseMs + offset * 1000).toISOString();
        const firstIdentity = identityByAttemptId.get(firstExpected.attemptId)!;
        const secondIdentity = identityByAttemptId.get(secondExpected.attemptId)!;
        return [
          receiptInput(
            root,
            firstExpected.attemptId,
            receiptFor(firstExpected, firstIdentity, 'passed', {
              startedAt: timestamp(firstOffset),
              finishedAt: timestamp(firstOffset + 1),
            }),
            `full-${pairIndex}-${trialIndex}-first.json`,
          ),
          receiptInput(
            root,
            secondExpected.attemptId,
            receiptFor(secondExpected, secondIdentity, 'passed', {
              startedAt: timestamp(firstOffset + 2),
              finishedAt: timestamp(firstOffset + 3),
            }),
            `full-${pairIndex}-${trialIndex}-second.json`,
          ),
        ];
      }),
    );
    const report = collectNativeComparison(full, values);
    assert.equal(report.matrix.requestedCells, 20);
    assert.equal(report.matrix.requestedAttempts, 400);
    assert.equal(report.matrix.receivedAttempts, 400);
    assert.equal(report.matrix.missingAttempts, 0);
    assert.equal(report.allCellsEligible, true);
    assert.equal(report.comparisonEligible, true);
    assert.equal(report.cells.length, 20);
    assert.equal(report.attempts.length, 400);
    assert.equal(report.attempts.filter((attempt) => attempt.passed).length, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector rejects engine assertion, source, flags and fixture drift before receipt intake', () => {
  const maestro = {
    scenarioId: 'SCN-connection-ios' as const,
    platform: 'ios' as const,
    engine: 'maestro' as const,
    mode: 'integration' as const,
    locale: 'en-US' as const,
  };
  const detox = { ...maestro, engine: 'detox' as const };
  const first = expectedAttempt('ledger-first', maestro, 'a', 'a');
  const second = expectedAttempt('ledger-second', detox, 'b', 'b');

  assert.throws(
    () =>
      validateNativeComparisonSpec(
        spec([cell(maestro, [first]), cell(detox, [second], ['assertion-two'])]),
      ),
    /does not bind an equivalent canonical assertion ledger/,
  );

  assert.throws(
    () =>
      validateNativeComparisonSpec(
        spec([
          cell(maestro, [first]),
          cell(detox, [{ ...second, repositories: repositories('e', 'd') }]),
        ]),
      ),
    /mixes repository\/source fingerprints/,
  );

  assert.throws(
    () =>
      validateNativeComparisonSpec(
        spec([
          cell(maestro, [first]),
          cell(detox, [{ ...second, inputs: { ...second.inputs, flagsHash: hash('9') } }]),
        ]),
      ),
    /inputs\.flagsHash must match the sealed cohort/,
  );

  assert.throws(
    () =>
      validateNativeComparisonSpec(
        spec([
          cell(maestro, [first]),
          cell(detox, [{ ...second, inputs: { ...second.inputs, fixtureHash: hash('9') } }]),
        ]),
      ),
    /mixes source, requirement or fixture cohort fingerprints/,
  );
});

void test('collector permits sequential PID and port reuse but rejects foreign and overlapping ownership', () => {
  const identity = {
    scenarioId: 'SCN-connection-ios' as const,
    platform: 'ios' as const,
    engine: 'maestro' as const,
    mode: 'integration' as const,
    locale: 'en-US' as const,
  };
  const first = expectedAttempt('resource-first', identity, 'a', 'a', 1);
  const sequential = expectedAttempt('resource-sequential', identity, 'b', 'a', 2);
  setColdResourceIdentity(
    first,
    8_000,
    'start-a',
    42_000,
    '2026-10-01T00:00:00.000Z',
    '2026-10-01T00:00:01.000Z',
  );
  setColdResourceIdentity(
    sequential,
    8_000,
    'start-b',
    42_000,
    '2026-10-01T00:00:01.000Z',
    '2026-10-01T00:00:02.000Z',
  );
  assert.doesNotThrow(() =>
    validateNativeComparisonSpec(spec([cell(identity, [first, sequential])])),
  );

  const foreign = expectedAttempt('resource-foreign', identity, 'c', 'a', 2);
  setColdResourceIdentity(
    foreign,
    8_000,
    'start-c',
    42_000,
    '2026-10-01T00:00:02.000Z',
    '2026-10-01T00:00:03.000Z',
  );
  foreign.coldAttemptIdentity.ownershipWindows[0].ownerRunId = 'foreign-owner';
  assert.throws(
    () => validateNativeComparisonSpec(spec([cell(identity, [first, foreign])])),
    /ownerRunId is foreign/,
  );

  const overlap = expectedAttempt('resource-overlap', identity, 'd', 'a', 2);
  setColdResourceIdentity(
    overlap,
    8_000,
    'start-d',
    42_000,
    '2026-10-01T00:00:00.500Z',
    '2026-10-01T00:00:01.500Z',
  );
  assert.throws(
    () => validateNativeComparisonSpec(spec([cell(identity, [first, overlap])])),
    /overlapping ownership windows/,
  );

  const sameStart = expectedAttempt('resource-same-start', identity, 'e', 'a', 2);
  setColdResourceIdentity(
    sameStart,
    8_000,
    'start-a',
    42_000,
    '2026-10-01T00:00:02.000Z',
    '2026-10-01T00:00:03.000Z',
  );
  assert.throws(
    () => validateNativeComparisonSpec(spec([cell(identity, [first, sameStart])])),
    /reuses process start identity/,
  );
});

void test('collector keeps a pending resource receipt binding blocked even with a valid receipt row', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = expectedAttempt('pending-resource-binding', identity, 'a', 'a');
    const receipt = receiptFor(expected, identity);
    const bytes = JSON.stringify(receipt);
    const receiptPath = path.join(root, 'pending-binding.json');
    writeFileSync(receiptPath, bytes, { mode: 0o600 });
    const report = collectNativeComparison(spec([cell(identity, [expected])]), [
      {
        path: receiptPath,
        artifactRoot: root,
        receipt,
        receiptHash: createHash('sha256').update(bytes).digest('hex'),
      },
    ]);
    assert.equal(report.attempts[0].passed, false);
    assert.equal(report.cells[0].decision, 'blocked');
    assert.ok(report.attempts[0].issues.includes('cold-resource-binding-pending'));

    expected.coldAttemptIdentity.originalReceiptBinding = {
      status: 'verified',
      receiptPath,
      artifactRoot: root,
      receiptHash: hash('9'),
    };
    const forgedBindingReport = collectNativeComparison(spec([cell(identity, [expected])]), [
      {
        path: receiptPath,
        artifactRoot: root,
        receipt,
        receiptHash: createHash('sha256').update(bytes).digest('hex'),
      },
    ]);
    assert.equal(forgedBindingReport.cells[0].decision, 'blocked');
    assert.ok(forgedBindingReport.attempts[0].issues.includes('cold-resource-binding-mismatch'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector binds receipt assertion requirement references to the canonical ledger', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = expectedAttempt('requirement-ref-mismatch', identity, 'a', 'a');
    const report = collectNativeComparison(spec([cell(identity, [expected])]), [
      receiptInput(
        root,
        expected.attemptId,
        receiptFor(expected, identity, 'passed', {
          assertions: [
            {
              id: 'assertion-one',
              requirementRefs: ['BL-018/wrong-requirement'],
              outcome: 'passed',
              evidencePaths: ['evidence.json'],
            },
          ],
        }),
      ),
    ]);
    assert.equal(report.cells[0].passed, 0);
    assert.equal(report.cells[0].decision, 'blocked');
    assert.ok(report.attempts[0].issues.includes('assertion-requirement-mismatch:assertion-one'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector accepts the current Expo inventory ledger when its generated contract hashes match', () => {
  const ledger = currentInventoryLedger('SCN-connection-ios');
  const identity = {
    scenarioId: 'SCN-connection-ios' as const,
    platform: 'ios' as const,
    engine: 'maestro' as const,
    mode: 'integration' as const,
    locale: 'en-US' as const,
  };
  const expected = expectedAttempt('current-inventory-ledger', identity, 'a', 'a');
  const validated = validateNativeComparisonSpec({
    ...spec([
      cell(
        identity,
        [expected],
        ledger.entries.map((entry) => entry.id),
      ),
    ]),
    cells: [
      {
        ...cell(
          identity,
          [expected],
          ledger.entries.map((entry) => entry.id),
        ),
        assertionLedger: ledger,
      },
    ],
  });
  assert.deepEqual(validated.cells[0].assertionLedger, ledger);
  assert.deepEqual(
    validated.cells[0].requiredAssertionIds,
    ledger.entries.map((entry) => entry.id),
  );
});

void test('receipt intake requires canonical owned regular files and records original byte hashes', async () => {
  const root = await artifactRoot();
  try {
    const identity = {
      scenarioId: 'SCN-training-android' as const,
      platform: 'android' as const,
      engine: 'maestro' as const,
      mode: 'integration' as const,
      locale: 'en-US' as const,
    };
    const expected = expectedAttempt('file-attempt', identity, 'a', 'a');
    const receipt = receiptFor(expected, identity);
    const bytes = JSON.stringify(receipt);
    const receiptPath = path.join(root, 'receipt.json');
    await writeFile(receiptPath, bytes, { mode: 0o600 });
    const [input] = await readNativeComparisonReceipts([receiptPath]);
    assert.equal(input.path, await realpath(receiptPath));
    assert.equal(input.artifactRoot, await realpath(root));
    assert.equal(input.receiptHash, createHash('sha256').update(bytes).digest('hex'));

    const symlinkPath = path.join(root, 'receipt-link.json');
    await symlink(receiptPath, symlinkPath);
    await assert.rejects(
      () => readNativeComparisonReceipts([symlinkPath]),
      /must not be a symlink/,
    );
    await assert.rejects(() => readNativeComparisonReceipts([root]), /regular file/);
    await assert.rejects(
      () => readNativeComparisonReceipts([path.join(root, 'missing.json')]),
      /missing or inaccessible/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('protected receipt intake rejects growth, hardlinks and replacement through the actual reader', async () => {
  const root = await artifactRoot();
  const bytes = JSON.stringify({ schemaVersion: 1, result: 'source-control' });
  try {
    const grown = path.join(root, 'grown-receipt.json');
    writeFileSync(grown, bytes, { mode: 0o600 });
    truncateSync(grown, 8 * 1024 * 1024 + 1);
    await assert.rejects(
      () => readNativeComparisonReceipts([grown]),
      /protected bounded read|bounded/,
    );

    const hardlinked = path.join(root, 'hardlinked-receipt.json');
    writeFileSync(hardlinked, bytes, { mode: 0o600 });
    linkSync(hardlinked, hardlinked + '.alias');
    await assert.rejects(
      () => readNativeComparisonReceipts([hardlinked]),
      /protected bounded read|bounded|single/,
    );

    const replaced = path.join(root, 'replaced-receipt.json');
    const moved = replaced + '.moved';
    writeFileSync(replaced, bytes, { mode: 0o600 });
    renameSync(replaced, moved);
    await symlink(moved, replaced);
    await assert.rejects(() => readNativeComparisonReceipts([replaced]), /must not be a symlink/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('collector protects the second read and binds post-intake growth, hardlink and same-byte replacement', async () => {
  for (const mutation of ['growth', 'hardlink', 'replacement'] as const) {
    const root = await artifactRoot();
    try {
      const identity = {
        scenarioId: 'SCN-training-android' as const,
        platform: 'android' as const,
        engine: 'maestro' as const,
        mode: 'integration' as const,
        locale: 'en-US' as const,
      };
      const expected = expectedAttempt(`collection-${mutation}`, identity, 'a', 'a');
      const value = spec([cell(identity, [expected])], 1);
      const written = receiptInput(root, expected.attemptId, receiptFor(expected, identity));
      const [input] = await readNativeComparisonReceipts([written.path]);
      if (mutation === 'growth') truncateSync(written.path, 8 * 1024 * 1024 + 1);
      else if (mutation === 'hardlink') linkSync(written.path, written.path + '.alias');
      else {
        const original = readFileSync(written.path);
        renameSync(written.path, written.path + '.original');
        writeFileSync(written.path, original, { mode: 0o600 });
      }
      assert.throws(
        () => collectNativeComparison(value, [input]),
        mutation === 'replacement'
          ? /descriptor identity changed/
          : /protected bounded collection read/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

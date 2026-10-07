import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readNativeEvidenceObservation } from '../../scripts/testing/native-view-evidence';
import {
  runNativeComparisonCohort,
  type CohortBuildReuse,
  type QualifiedBuildReuse,
} from '../../scripts/testing/t15-cold-dispatcher';
import { runT15ColdProduction } from '../../scripts/testing/t15-cold-production-runner';
import type {
  NativeComparisonAssertionLedger,
  NativeComparisonAttemptExpectation,
  NativeComparisonCell,
  NativeComparisonCohortExpectation,
  NativeComparisonExecutionOrder,
  NativeComparisonInputExpectation,
  NativeComparisonRepositoryExpectation,
  NativeComparisonSpec,
  NativeComparisonTargetExpectation,
} from '../../scripts/testing/compare-native-pilot';

const hash = (character: string) => character.repeat(64);
const sha = (character: string) => character.repeat(40);
const iso = (seconds: number): string =>
  new Date(Date.parse('2026-10-03T00:00:00.000Z') + seconds * 1000).toISOString();
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
  id: 't15-production-source-cohort',
  sourceFingerprint: hash('a'),
  fixtureResetFingerprint: hash('b'),
  flagsFingerprint: hash('c'),
  instrumentationOnlyDifferences: [
    { platform: 'ios', reason: 'Reviewed source-only engine boundary' },
    { platform: 'android', reason: 'Reviewed source-only engine boundary' },
  ],
};
const repositories = (): NativeComparisonRepositoryExpectation[] => [
  { name: 'client', sha: sha('a'), dirty: false, workingTreeHash: null },
  { name: 'server', sha: sha('b'), dirty: false, workingTreeHash: null },
];
const target = (): NativeComparisonTargetExpectation => ({
  deviceId: 'source-only-target',
  osVersion: '17',
  appId: 'com.edufelip.mychampions.dev',
  buildProfile: 'source-only',
  binaryHash: hash('b'),
  apiOrigin: 'http://127.0.0.1:41000',
});
const inputs = (family: string, engine: 'maestro' | 'detox'): NativeComparisonInputExpectation => ({
  scenarioHash: hash(
    ['session', 'training', 'connection', 'camera-denied', 'save-retry']
      .indexOf(family)
      .toString(16),
  ),
  requirementHash: hash('d'),
  fixtureHash: hash('e'),
  flagsHash: cohort.flagsFingerprint,
  toolVersions: { [engine]: engine === 'maestro' ? '2.6.1' : '20.47.0' },
});
const ledger = (family: string): NativeComparisonAssertionLedger => {
  const entries = [
    {
      id: `NAT-${family}-source-control`,
      requirementRefs: [`BL-018/P4-${family}`],
      requirementPaths: ['docs/plans/2026-09-29-testing-modernization-start-here.md'],
      evidenceKinds: ['ui' as const],
      startingState: 'Owned source-only control state',
      action: 'Invoke the bounded attempt boundary',
      expected: 'Retain the terminal row and ownership evidence',
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
};
const blockedIdentity = (runId: string) => ({
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
});

function makeSpec(): NativeComparisonSpec {
  const cells: NativeComparisonCell[] = [];
  for (const family of [
    'session',
    'training',
    'connection',
    'camera-denied',
    'save-retry',
  ] as const)
    for (const platform of ['ios', 'android'] as const)
      for (const engine of ['maestro', 'detox'] as const) {
        const expectedAttempts: NativeComparisonAttemptExpectation[] = [];
        for (let ordinal = 1; ordinal <= 20; ordinal++) {
          const runId = `run-${family}-${platform}-${engine}-${ordinal}`;
          expectedAttempts.push({
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
          });
        }
        cells.push({
          scenarioId: `SCN-${family}-${platform}`,
          platform,
          engine,
          mode: 'integration',
          locale: 'en-US',
          requiredAssertionIds: [`NAT-${family}-source-control`],
          assertionLedger: ledger(family),
          expectedAttempts,
        });
      }
  const pairs = new Map<string, { maestro: NativeComparisonCell; detox: NativeComparisonCell }>();
  for (const cell of cells) {
    const key = `${cell.scenarioId}|${cell.platform}`;
    const pair =
      pairs.get(key) ?? ({} as { maestro: NativeComparisonCell; detox: NativeComparisonCell });
    pair[cell.engine] = cell;
    pairs.set(key, pair);
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
          const trialOrdinal = index + 1;
          const first = trialOrdinal % 2 === 1 ? pair.maestro : pair.detox;
          const second = trialOrdinal % 2 === 1 ? pair.detox : pair.maestro;
          return {
            trialOrdinal,
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
const build = (platform: 'ios' | 'android'): QualifiedBuildReuse => ({
  platform,
  buildId: `${platform}-source-build`,
  buildProfile: 'source-only',
  sourceFingerprint: cohort.sourceFingerprint,
  helperFingerprint: hash('4'),
  flagsFingerprint: cohort.flagsFingerprint,
  binaryHash: hash('b'),
  current: true,
});
const buildReuse = (): CohortBuildReuse => ({
  sourceFingerprint: cohort.sourceFingerprint,
  helperFingerprint: hash('4'),
  flagsFingerprint: cohort.flagsFingerprint,
  byPlatform: { ios: build('ios'), android: build('android') },
});

void test('T15 production wiring retains the exact 20x20 matrix when acquisition is cancelled', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 't15-production-matrix-'));
  const outputRoot = await realpath(temporaryRoot);
  await chmod(outputRoot, 0o700);
  const controller = new AbortController();
  controller.abort('source-control-pre-acquisition');
  try {
    const report = await runT15ColdProduction({
      repositoryRoot: '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions',
      outputRoot,
      spec: makeSpec(),
      buildReuse: buildReuse(),
      signal: controller.signal,
      attemptDeadlineMs: 1000,
    });
    assert.equal(report.requestedCells, 20);
    assert.equal(report.requestedAttempts, 400);
    assert.equal(report.scheduledAttempts, 400);
    assert.equal(report.dispatchedAttempts, 0);
    assert.equal(report.nativeExecution, 'not-run');
    assert.equal(report.publicPromotionEligible, false);
    assert.equal(report.nativePassingCases, 0);
    assert.equal(report.terminalStatus, 'cancelled');
    assert.equal(report.attempts.length, 400);
    assert.equal(new Set(report.physicalAttemptOrder).size, 400);
    assert.equal(report.logicalAttemptCount, 400);
    assert.equal(report.logicalPhysicalAttemptOrder.length, 400);
    assert.ok(
      report.attempts.every(
        (attempt) =>
          attempt.status === 'cancelled' &&
          attempt.issue === 'dispatcher-aborted-before-acquisition',
      ),
    );
    assert.equal(report.receipts.length, 0);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

void test('T15 production wiring retains an acquired reset row when cleanup leaves recovery evidence', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 't15-production-recovery-'));
  const outputRoot = await realpath(temporaryRoot);
  await chmod(outputRoot, 0o700);
  const spec = makeSpec();
  let resetCalls = 0;
  let producerCalls = 0;
  try {
    const report = await runNativeComparisonCohort({
      spec,
      outputRoot,
      signal: new AbortController().signal,
      buildReuse: buildReuse(),
      preserveFailedResetEvidence: true,
      select: (expected) => {
        const match = expected.runId.match(/^run-(.*)-(ios|android)-(maestro|detox)-\d+$/u);
        if (!match) throw new Error('unexpected T15 source-control attempt ID');
        const [, family, platform, engine] = match;
        return Promise.resolve({
          arguments: {
            platform: platform as 'ios' | 'android',
            engine: engine as 'maestro' | 'detox',
            scenario: `SCN-${family}-${platform}`,
            mode: 'integration',
          },
          scenario: {
            id: `SCN-${family}-${platform}`,
            platform: platform as 'ios' | 'android',
            flowId: 't15-source-only',
            transitionIds: [],
            requirementRefs: [],
            dataMode: 'postgres',
            fixtureRef: 'source-only-fixture',
            freshnessInputs: { requirementPaths: [] },
          },
          scenarioHash: expected.inputs.scenarioHash!,
          requirementHash: expected.inputs.requirementHash!,
        });
      },
      reset: async ({ expected, outputRoot: resetOutputRoot }) => {
        resetCalls += 1;
        const artifactRoot = path.join(resetOutputRoot, 'recovery-resets');
        await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
        const appStateFingerprint = hash('a');
        const fixtureStateFingerprint = hash('b');
        const helperFingerprint = hash('4');
        const platform = expected.runId.includes('-android-') ? 'android' : 'ios';
        const targetRow = {
          platform,
          deviceId: 'owned-source-target',
          appId: expected.target.appId,
          binaryHash: expected.target.binaryHash,
          apiOrigin: expected.target.apiOrigin,
          captureRunId: expected.runId,
          ownerRunId: expected.runId,
          phase: 'reset-before-launch',
        };
        const backendRow = {
          runId: expected.runId,
          ownerRunId: expected.runId,
          captureRunId: expected.runId,
          artifactRoot,
          apiOrigin: expected.target.apiOrigin,
          apiPid: 41001,
          apiStarted: 'source-only-start',
          apiScript: 'source-only-api',
          backendAttemptId: expected.attemptId,
          manifestSha256: hash('5'),
        };
        const bytes = Buffer.from(
          JSON.stringify({
            fixtureResetId: expected.fixtureResetId,
            ownerRunId: expected.runId,
            cohortFixtureFingerprint: cohort.fixtureResetFingerprint,
            appStateFingerprint,
            fixtureStateFingerprint,
            sourceFingerprint: cohort.sourceFingerprint,
            helperFingerprint,
            cleanupStatus: 'failed-recovery-ledger-retained',
            target: targetRow,
            backend: backendRow,
          }),
        );
        const receiptPath = path.join(artifactRoot, `${expected.attemptId.replace(':', '_')}.json`);
        await writeFile(receiptPath, bytes, { mode: 0o600, flag: 'wx' });
        const observation = readNativeEvidenceObservation(
          artifactRoot,
          path.basename(receiptPath),
          true,
        );
        return {
          fixtureResetId: expected.fixtureResetId,
          ownerRunId: expected.runId,
          cohortFixtureFingerprint: cohort.fixtureResetFingerprint,
          status: 'fresh' as const,
          startedAt: iso(1),
          finishedAt: iso(2),
          appStateFingerprint,
          fixtureStateFingerprint,
          sourceFingerprint: cohort.sourceFingerprint,
          helperFingerprint,
          originalResetBinding: {
            status: 'verified' as const,
            receiptPath,
            artifactRoot,
            receiptHash: createHash('sha256').update(bytes).digest('hex'),
            identity: observation.identity,
          },
          target: targetRow,
          backend: backendRow,
          cleanupStatus: 'failed-recovery-ledger-retained' as const,
          blocker: 'reset-cleanup-failed',
        };
      },
      produce: () => {
        producerCalls += 1;
        throw new Error('must not acquire after reset cleanup failure');
      },
    });
    assert.equal(resetCalls, 400);
    assert.equal(producerCalls, 0);
    assert.equal(report.requestedAttempts, 400);
    assert.equal(report.scheduledAttempts, 400);
    assert.equal(report.dispatchedAttempts, 0);
    assert.equal(report.attempts.length, 400);
    assert.ok(
      report.attempts.every(
        (attempt) =>
          attempt.status === 'harness-blocked' &&
          attempt.issue === 'reset-blocked:reset-cleanup-failed' &&
          attempt.reset.cleanupStatus === 'failed-recovery-ledger-retained' &&
          attempt.reset.originalResetBinding.status === 'verified' &&
          attempt.reset.target !== undefined &&
          attempt.reset.backend !== undefined,
      ),
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

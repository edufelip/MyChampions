import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  DetoxCameraJestListTestsExecutionError,
  parseDetoxCameraJestListTestsOutput,
  projectDetoxCameraJestListTestsFailure,
  runDetoxCameraJestListTests,
  validateDetoxCameraJestListTestsOwnership,
  waitForOwnedDetoxCameraJestSelection,
} from '../../scripts/testing/native-detox-camera-ios-current-owner';
import { executeOwnedNativeCommand } from '../../scripts/testing/owned-native-command';
import {
  evaluateOwnedIosCleanup,
  evaluatePartialDetoxCameraCleanup,
  inspectOwnedIosCleanup,
} from '../../scripts/testing/verify-owned-ios-cleanup';

const repositoryRoot = path.resolve(__dirname, '../..');
const nodeModulesRoot =
  process.env.T15_NODE_MODULES_ROOT ?? path.join(repositoryRoot, 'node_modules');

function listTestsInput(
  overrides: Partial<Parameters<typeof parseDetoxCameraJestListTestsOutput>[0]> = {},
) {
  const cameraTestPath = path.join(
    '/private',
    'camera-root',
    'e2e',
    'detox-ios-camera-route.e2e.test.js',
  );
  return {
    stdout: JSON.stringify([cameraTestPath]),
    stderr: '',
    command: {
      command: process.execPath,
      argv: ['/owned/jest.js', '--listTests', '--runInBand', '--json'],
      cwd: '/private/camera-root',
    },
    runnerInputsSha256: 'a'.repeat(64),
    cameraTestPath,
    cameraTestSha256: 'b'.repeat(64),
    execution: {
      phase: 'step' as const,
      execution: 'completed' as const,
      cleanup: 'cleaned' as const,
      pid: 1234,
      pgid: 1234,
      childExitCode: 0 as const,
      childSignal: null,
      logPath: '/private/camera-root/detox-camera-jest-list-tests.private.log',
      stdoutPath: '/private/camera-root/detox-camera-jest-list-tests.stdout.private',
      ownershipPath: '/private/camera-root/detox-camera-jest-list-tests.ownership.json',
    },
    ownershipEvidence: {
      schema: 'owned-native-command-ledger-v1' as const,
      ownershipPath: '/private/camera-root/detox-camera-jest-list-tests.ownership.json',
      pid: 1234,
      pgid: 1234,
      phase: 'step' as const,
      cleanup: 'cleaned' as const,
      logPath: '/private/camera-root/detox-camera-jest-list-tests.private.log',
      stdoutPath: '/private/camera-root/detox-camera-jest-list-tests.stdout.private',
      finalGroupMemberCount: 0 as const,
      finalEscapedCandidateCount: 0 as const,
    },
    ...overrides,
  } as const;
}

void test('V30 parses exactly one protected Jest selection and rejects missing, mixed, and crossed output', () => {
  const receipt = parseDetoxCameraJestListTestsOutput(listTestsInput());
  assert.equal(receipt.schema, 'detox-ios-camera-jest-list-tests-v1');
  assert.equal(receipt.selectedTestCount, 1);
  assert.equal(receipt.selectedTestPath, receipt.cameraTestPath);

  assert.throws(
    () => parseDetoxCameraJestListTestsOutput(listTestsInput({ stdout: '' })),
    /output is missing/i,
  );
  assert.throws(
    () =>
      parseDetoxCameraJestListTestsOutput(
        listTestsInput({
          stdout:
            'warning from jest\n["/private/camera-root/e2e/detox-ios-camera-route.e2e.test.js"]',
        }),
      ),
    /mixed or invalid JSON/i,
  );
  assert.throws(
    () =>
      parseDetoxCameraJestListTestsOutput(
        listTestsInput({
          stdout: JSON.stringify(['/private/foreign-root/e2e/other.test.js']),
        }),
      ),
    /foreign test path/i,
  );
  assert.throws(
    () => parseDetoxCameraJestListTestsOutput(listTestsInput({ stdout: JSON.stringify([]) })),
    /exactly one test/i,
  );
});

void test('V30 runs installed Jest listTests before Detox globalSetup and records one exact path', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v30-preflight-')),
  );
  await chmod(root, 0o700);
  const cameraTestPath = path.join(root, 'e2e', 'detox-ios-camera-route.e2e.test.js');
  const jestConfigPath = path.join(root, 'jest.config.js');
  const setupPath = path.join(root, 'global-setup.js');
  const markerPath = path.join(root, 'global-setup-ran');
  await mkdir(path.dirname(cameraTestPath), { recursive: true, mode: 0o700 });
  await writeFile(cameraTestPath, "test('camera', () => {});\n", { mode: 0o600 });
  await writeFile(
    setupPath,
    `module.exports = async () => require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran');\n`,
    { mode: 0o600 },
  );
  await writeFile(
    jestConfigPath,
    `module.exports = { rootDir: ${JSON.stringify(root)}, testMatch: [${JSON.stringify(cameraTestPath)}], globalSetup: ${JSON.stringify(setupPath)}, testEnvironment: 'node', maxWorkers: 1 };\n`,
    { mode: 0o600 },
  );
  try {
    const receipt = await runDetoxCameraJestListTests({
      nodeModulesRoot,
      currentRoot: root,
      artifactRoot: root,
      jestConfigPath,
      cameraTestPath,
      runnerInputsSha256: 'c'.repeat(64),
      cameraTestSha256: 'd'.repeat(64),
      env: {
        ...process.env,
        NODE_PATH: nodeModulesRoot,
        CI: '1',
        FORCE_COLOR: '0',
      },
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 30_000,
    });
    assert.equal(receipt.selectedTestCount, 1);
    assert.equal(receipt.selectedTestPath, cameraTestPath);
    assert.equal(receipt.command.argv.includes('--listTests'), true);
    assert.equal(receipt.execution.execution, 'completed');
    assert.equal(receipt.execution.cleanup, 'cleaned');
    assert.equal(receipt.execution.childExitCode, 0);
    assert.equal(receipt.execution.childSignal, null);
    assert.equal(receipt.execution.pid, receipt.execution.pgid);
    assert.equal(receipt.ownershipEvidence.finalGroupMemberCount, 0);
    assert.equal(receipt.ownershipEvidence.finalEscapedCandidateCount, 0);
    await assert.rejects(readFile(markerPath), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V31 descriptor-validates the cleaned ownership ledger and retains failed recovery proof', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v31-ledger-')));
  await chmod(root, 0o700);
  const execution = {
    phase: 'step' as const,
    execution: 'completed' as const,
    cleanup: 'cleaned' as const,
    pid: 4242,
    pgid: 4242,
    childExitCode: 0 as const,
    childSignal: null,
    logPath: path.join(root, 'detox-camera-jest-list-tests.private.log'),
    stdoutPath: path.join(root, 'detox-camera-jest-list-tests.stdout.private'),
    ownershipPath: path.join(root, 'detox-camera-jest-list-tests.ownership.json'),
    elapsedMs: 0,
    cleanupMs: 0,
  };
  const validLedger = {
    kind: 'private worker process ownership',
    pid: execution.pid,
    pgid: execution.pgid,
    processes: [
      {
        pid: execution.pid,
        pgid: execution.pgid,
        started: 'Mon Oct  5 12:00:00 2026',
        commandHash: 'a'.repeat(64),
      },
    ],
    escapedProcesses: [],
    escapedSignals: [],
    cleanupMode: 'step',
    cleanup: 'cleaned',
    latestCensus: {
      observedAt: new Date().toISOString(),
      strict: false,
      groupMembers: [],
      escapedCandidates: [],
    },
  };
  const writeValidArtifacts = async () => {
    await writeFile(execution.ownershipPath, JSON.stringify(validLedger), { mode: 0o600 });
    await writeFile(execution.logPath, 'owned-command: no diagnostic output\n', { mode: 0o600 });
    await writeFile(execution.stdoutPath, '[]\n', { mode: 0o600 });
  };
  try {
    await writeValidArtifacts();
    const evidence = await validateDetoxCameraJestListTestsOwnership({
      artifactRoot: root,
      execution,
    });
    assert.equal(evidence.pid, execution.pid);
    assert.equal(evidence.pgid, execution.pgid);
    assert.equal(evidence.finalGroupMemberCount, 0);

    const cases: { name: string; prepare: () => Promise<void>; pattern: RegExp }[] = [
      {
        name: 'malformed',
        prepare: async () => writeFile(execution.ownershipPath, '{malformed', { mode: 0o600 }),
        pattern: /JSON|unexpected/i,
      },
      {
        name: 'stale',
        prepare: async () =>
          writeFile(
            execution.ownershipPath,
            JSON.stringify({
              ...validLedger,
              pid: 9999,
              pgid: 9999,
              latestCensus: {
                ...validLedger.latestCensus,
                observedAt: '2020-01-01T00:00:00.000Z',
              },
            }),
            { mode: 0o600 },
          ),
        pattern: /does not prove/i,
      },
      {
        name: 'missing',
        prepare: async () => rm(execution.ownershipPath, { force: true }),
        pattern: /ENOENT|no such file/i,
      },
      {
        name: 'symlink',
        prepare: async () => {
          const target = path.join(root, 'ledger-target.private.json');
          await writeFile(target, JSON.stringify(validLedger), { mode: 0o600 });
          await symlink(target, execution.ownershipPath);
        },
        pattern: /bounded private file/i,
      },
      {
        name: 'escaped',
        prepare: async () =>
          writeFile(
            execution.ownershipPath,
            JSON.stringify({
              ...validLedger,
              processes: [
                {
                  ...validLedger.processes[0],
                  pgid: 9999,
                },
              ],
            }),
            { mode: 0o600 },
          ),
        pattern: /escaped its PGID/i,
      },
    ];
    for (const scenario of cases) {
      await rm(execution.ownershipPath, { force: true });
      await writeFile(execution.logPath, 'owned-command: no diagnostic output\n', { mode: 0o600 });
      await writeFile(execution.stdoutPath, '[]\n', { mode: 0o600 });
      await scenario.prepare();
      await assert.rejects(
        validateDetoxCameraJestListTestsOwnership({ artifactRoot: root, execution }),
        scenario.pattern,
        scenario.name,
      );
      const projectedFailure = projectDetoxCameraJestListTestsFailure(
        root,
        new DetoxCameraJestListTestsExecutionError({
          command: {
            command: process.execPath,
            argv: [],
            cwd: root,
          },
          execution: {
            ...execution,
            execution: 'harness-blocked',
            childExitCode: null,
          },
          runnerInputsSha256: 'a'.repeat(64),
          cameraTestPath: path.join(root, 'e2e/detox-ios-camera-route.e2e.test.js'),
          cameraTestSha256: 'b'.repeat(64),
        }),
      );
      assert.equal(projectedFailure.preflight?.ownershipProof, 'unproven', scenario.name);
      assert.equal(projectedFailure.preflight?.cleanupStatus, 'uncertain', scenario.name);
      assert.equal(projectedFailure.unknownHandle, true, scenario.name);
      // The failed recovery proof remains present for post-run inspection;
      // validation never cleans or replaces the helper ledger.
      if (scenario.name !== 'missing') assert.ok((await readFile(execution.ownershipPath)).length);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V32 preserves failed preflight execution and separates clean from uncertain cleanup', () => {
  const artifactRoot = '/private/camera-root';
  const command = {
    command: process.execPath,
    argv: ['/private/node_modules/jest/bin/jest.js', '--listTests', '--runInBand', '--json'],
    cwd: artifactRoot,
  } as const;
  const baseExecution = {
    phase: 'step' as const,
    execution: 'harness-blocked' as const,
    cleanup: 'cleaned' as const,
    childExitCode: null,
    childSignal: null,
    pid: 41651,
    pgid: 41651,
    logPath: path.join(artifactRoot, 'detox-camera-jest-list-tests.private.log'),
    stdoutPath: path.join(artifactRoot, 'detox-camera-jest-list-tests.stdout.private'),
    ownershipPath: path.join(artifactRoot, 'detox-camera-jest-list-tests.ownership.json'),
    elapsedMs: 137,
    cleanupMs: 4,
    censusFailure: null,
    outputFailure: null,
  } as const;
  const createFailure = (
    cleanup: 'cleaned' | 'unknown',
    ownershipProof: 'validated-empty-final-census' | 'unproven' = 'unproven',
  ) =>
    new DetoxCameraJestListTestsExecutionError({
      command,
      execution: { ...baseExecution, cleanup },
      runnerInputsSha256: 'a'.repeat(64),
      cameraTestPath: `${artifactRoot}/e2e/detox-ios-camera-route.e2e.test.js`,
      cameraTestSha256: 'b'.repeat(64),
      ownershipProof,
    });
  const clean = projectDetoxCameraJestListTestsFailure(
    artifactRoot,
    createFailure('cleaned', 'validated-empty-final-census'),
  );
  const unproven = projectDetoxCameraJestListTestsFailure(artifactRoot, createFailure('cleaned'));
  const uncertain = projectDetoxCameraJestListTestsFailure(artifactRoot, createFailure('unknown'));

  assert.equal(clean.cleanup, 'failed-recovery-ledger-retained');
  assert.equal(clean.unknownHandle, false);
  assert.equal(clean.preflight?.cleanupStatus, 'cleaned');
  assert.equal(clean.preflight?.ownershipProof, 'validated-empty-final-census');
  assert.equal(clean.preflight?.execution.execution, 'harness-blocked');
  assert.equal(clean.preflight?.execution.pid, 41651);
  assert.equal(
    clean.preflight?.execution.ownershipPath,
    'detox-camera-jest-list-tests.ownership.json',
  );
  assert.equal(clean.preflight?.artifactPathsLexicallyValidated, true);
  assert.equal(unproven.preflight?.cleanupStatus, 'uncertain');
  assert.equal(unproven.preflight?.ownershipProof, 'unproven');
  assert.equal(unproven.unknownHandle, true);
  assert.equal(uncertain.cleanup, 'failed-recovery-ledger-retained');
  assert.equal(uncertain.unknownHandle, true);
  assert.equal(uncertain.preflight?.cleanupStatus, 'uncertain');
  assert.equal(uncertain.preflight?.execution.cleanup, 'unknown');

  const makeCapture = (failure: typeof clean) => ({
    result: 'harness-blocked',
    acquisitionIntents: ['app-port'],
    acquisitionSequence: [],
    acquisitionFailure: failure,
    preflight: {
      resource: 'detox-jest-list-tests',
      cleanup: failure.preflight?.cleanupStatus,
      execution: failure.preflight?.execution,
    },
    jestListTests: null,
    commandExecutions: [],
    assertionsVerified: false,
    publicPromotionEligible: false,
    cleanup: {
      status: 'failed-recovery-retained',
      resources: [
        {
          resource: 'detox-jest-list-tests',
          acquisition: 'unknown',
          cleanup: failure.preflight?.cleanupStatus === 'cleaned' ? 'cleaned' : 'unknown',
        },
      ],
      aggregate: {},
      unknownResources:
        failure.preflight?.cleanupStatus === 'cleaned' ? [] : ['detox-jest-list-tests'],
    },
    resourceStates: [],
    cleanupAggregate: {},
    postChild: { status: 'unknown', reason: 'no-owned-child-handle' },
  });
  const cleanCapture = makeCapture(clean);
  assert.equal(cleanCapture.jestListTests, null);
  assert.deepEqual(cleanCapture.commandExecutions, []);
  assert.equal(cleanCapture.assertionsVerified, false);
  assert.equal(cleanCapture.publicPromotionEligible, false);
  const cleanProof = evaluatePartialDetoxCameraCleanup({
    runId: '0123456789abcdef01234567',
    capture: cleanCapture,
    files: ['capture.private.json'],
  });
  assert.equal(cleanProof.result, 'failed');
  assert.equal(cleanProof.captureCleanupClean, false);
  assert.equal(cleanProof.preflightCleanup, 'cleaned');
  assert.equal(cleanProof.preflightCleanupClean, true);
  assert(!cleanProof.failureReasons.includes('preflight-cleanup-uncertain'));

  const uncertainProof = evaluatePartialDetoxCameraCleanup({
    runId: '0123456789abcdef01234567',
    capture: makeCapture(uncertain),
    files: ['capture.private.json'],
  });
  assert.equal(uncertainProof.result, 'failed');
  assert.equal(uncertainProof.preflightCleanup, 'uncertain');
  assert.equal(uncertainProof.preflightCleanupClean, false);
  assert(uncertainProof.failureReasons.includes('preflight-cleanup-uncertain'));

  // The owner writes preflight:null on a successful camera capture. The
  // complete cleanup gate must still pass, and the partial evaluator must
  // treat that explicit null as absent optional evidence rather than malformed.
  const successfulCaptureWithNoPreflight = {
    runId: '0123456789abcdef01234567',
    captureResult: 'owner-completed-unverified',
    captureCleanupClean: true,
    ownedProcesses: [
      { pid: 810, started: 'Tue Sep 29 13:00:00 2026' },
      { pid: 811, started: 'Tue Sep 29 13:00:01 2026' },
    ],
    liveProcesses: [{ pid: 810, started: 'Tue Sep 29 15:00:00 2026' }],
    previousDevices: { devices: { ios: [{ udid: 'foreign', state: 'Shutdown' }] } },
    currentDevices: { devices: { ios: [{ udid: 'foreign', state: 'Shutdown' }] } },
    ownedDeviceId: 'owned',
    cacheAbsent: true,
    docker: { container: [], network: [], volume: [] },
    preflight: null,
  };
  const successfulCleanup = evaluateOwnedIosCleanup(successfulCaptureWithNoPreflight);
  assert.equal(successfulCleanup.result, 'passed');
  const noPreflightPartial = evaluatePartialDetoxCameraCleanup({
    runId: successfulCaptureWithNoPreflight.runId,
    capture: {
      ...cleanCapture,
      preflight: null,
    },
    files: ['capture.private.json'],
  });
  assert.equal(noPreflightPartial.preflightCleanup, 'not-present');
  assert.equal(noPreflightPartial.preflightCleanupClean, false);
  assert(!noPreflightPartial.failureReasons.includes('preflight-receipt-invalid'));
});

void test('V32 retains a cleaned command receipt when selection validation fails after execution', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v32-output-')));
  await chmod(root, 0o700);
  const jestCliPath = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
  const cameraTestPath = path.join(root, 'e2e', 'detox-ios-camera-route.e2e.test.js');
  const jestConfigPath = path.join(root, 'jest.config.js');
  await mkdir(path.dirname(jestCliPath), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(cameraTestPath), { recursive: true, mode: 0o700 });
  await writeFile(
    jestCliPath,
    `setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(['/private/foreign.test.js']))}), 100);\n`,
    { mode: 0o600 },
  );
  await writeFile(cameraTestPath, "test('camera', () => {});\n", { mode: 0o600 });
  await writeFile(jestConfigPath, 'module.exports = {};\n', { mode: 0o600 });
  try {
    await assert.rejects(
      runDetoxCameraJestListTests({
        nodeModulesRoot: path.join(root, 'node_modules'),
        currentRoot: root,
        artifactRoot: root,
        jestConfigPath,
        cameraTestPath,
        runnerInputsSha256: '7'.repeat(64),
        cameraTestSha256: '6'.repeat(64),
        env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') },
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() + 30_000,
      }),
      (error: unknown) => {
        assert(error instanceof DetoxCameraJestListTestsExecutionError);
        assert.equal(error.execution.execution, 'completed');
        assert.equal(error.execution.cleanup, 'cleaned');
        assert.equal(error.execution.childExitCode, 0);
        assert.equal(error.ownershipProof, 'validated-empty-final-census');
        assert.equal(error.failure?.name, 'Error');
        assert.match(error.failure?.message ?? '', /foreign test path/i);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V32 production cleanup inspector treats successful preflight:null as absent optional evidence', async () => {
  const repositoryRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v32-null-inspector-')),
  );
  const runId = 'c'.repeat(24);
  const artifactRoot = path.join(repositoryRoot, '.qa/artifacts/native-pilot', runId);
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      path.join(artifactRoot, 'capture.private.json'),
      JSON.stringify({
        result: 'harness-blocked',
        partialAcquisition: true,
        acquisitionIntents: ['app-port'],
        acquisitionSequence: [],
        acquisitionFailure: {
          artifactPathsLexicallyValidated: true,
          logPath: null,
          stdoutPath: null,
          ownershipPath: null,
        },
        preflight: null,
        cleanup: {
          status: 'failed-recovery-retained',
          resources: [],
          aggregate: {},
          unknownResources: [],
        },
        resourceStates: [],
        cleanupAggregate: {},
        postChild: { status: 'unknown', reason: 'no-owned-child-handle' },
      }),
      { mode: 0o600 },
    );
    const inspected = await inspectOwnedIosCleanup({ repositoryRoot, artifactRoot });
    assert('preflightCleanup' in inspected);
    assert('preflightCleanupClean' in inspected);
    assert('failureReasons' in inspected);
    assert.equal(inspected.result, 'failed');
    assert.equal(inspected.preflightCleanup, 'not-present');
    assert.equal(inspected.preflightCleanupClean, false);
    assert(!inspected.failureReasons.includes('preflight-receipt-invalid'));
    assert.equal(inspected.captureCleanupClean, false);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

void test('V31 bounds delayed initial ownership acquisition to the original deadline and cancellation', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v31-budget-')));
  await chmod(root, 0o700);
  const bin = path.join(root, 'bin');
  await mkdir(bin, { mode: 0o700 });
  const delayedPs = path.join(bin, 'ps');
  await writeFile(delayedPs, '#!/bin/sh\n/bin/sleep 2\nexec /bin/ps "$@"\n', { mode: 0o700 });
  const previousPath = process.env.PATH;
  const run = async (label: string, signal?: AbortSignal) => {
    const deadlineAtMonotonicMs = performance.now() + 300;
    const started = performance.now();
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'setTimeout(() => {}, 10_000)'],
      artifactRoot: root,
      label,
      env: { ...process.env, PATH: `${bin}:${previousPath ?? ''}` },
      deadlineMs: 5_000,
      deadlineAtMonotonicMs,
      initialOwnershipDeadlineAtMonotonicMs: deadlineAtMonotonicMs,
      signal,
    });
    return { result, elapsedMs: performance.now() - started };
  };
  try {
    process.env.PATH = `${bin}:${previousPath ?? ''}`;
    const deadlineRun = await run('delayed-deadline');
    assert.equal(deadlineRun.result.execution, 'deadline');
    assert.ok(deadlineRun.result.ownershipPath);
    await readFile(deadlineRun.result.ownershipPath);
    assert.ok(
      deadlineRun.elapsedMs < 1_500,
      `acquisition exceeded original budget: ${deadlineRun.elapsedMs}`,
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 75);
    const cancelledRun = await run('delayed-cancelled', controller.signal);
    assert.equal(cancelledRun.result.execution, 'cancelled');
    assert.ok(cancelledRun.result.ownershipPath);
    await readFile(cancelledRun.result.ownershipPath);
    assert.ok(
      cancelledRun.elapsedMs < 1_500,
      `cancellation exceeded bound: ${cancelledRun.elapsedMs}`,
    );
  } finally {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

void test('V30 preserves abort and original-deadline rejection before any preflight process', async () => {
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    runDetoxCameraJestListTests({
      nodeModulesRoot,
      currentRoot: repositoryRoot,
      artifactRoot: repositoryRoot,
      jestConfigPath: path.join(repositoryRoot, 'jest.detox-camera.private.config.js'),
      cameraTestPath: path.join(repositoryRoot, 'e2e/detox-ios-camera-route.e2e.test.js'),
      runnerInputsSha256: 'e'.repeat(64),
      cameraTestSha256: 'f'.repeat(64),
      env: process.env,
      signal: aborted.signal,
      deadlineAtMonotonicMs: performance.now() + 30_000,
    }),
    /aborted/i,
  );
  await assert.rejects(
    runDetoxCameraJestListTests({
      nodeModulesRoot,
      currentRoot: repositoryRoot,
      artifactRoot: repositoryRoot,
      jestConfigPath: path.join(repositoryRoot, 'jest.detox-camera.private.config.js'),
      cameraTestPath: path.join(repositoryRoot, 'e2e/detox-ios-camera-route.e2e.test.js'),
      runnerInputsSha256: 'e'.repeat(64),
      cameraTestSha256: 'f'.repeat(64),
      env: process.env,
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() - 1,
    }),
    /monotonic deadline exceeded/i,
  );
});

void test('V30 aborts a running listTests process only after owned-group cleanup', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v30-owned-')));
  await chmod(root, 0o700);
  const jestCliPath = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
  const cameraTestPath = path.join(root, 'e2e', 'detox-ios-camera-route.e2e.test.js');
  const jestConfigPath = path.join(root, 'jest.config.js');
  await mkdir(path.dirname(jestCliPath), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(cameraTestPath), { recursive: true, mode: 0o700 });
  await writeFile(jestCliPath, 'setInterval(() => {}, 1000);\n', { mode: 0o600 });
  await writeFile(cameraTestPath, "test('camera', () => {});\n", { mode: 0o600 });
  await writeFile(jestConfigPath, 'module.exports = {};\n', { mode: 0o600 });
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 750);
  try {
    await assert.rejects(
      runDetoxCameraJestListTests({
        nodeModulesRoot: path.join(root, 'node_modules'),
        currentRoot: root,
        artifactRoot: root,
        jestConfigPath,
        cameraTestPath,
        runnerInputsSha256: '9'.repeat(64),
        cameraTestSha256: '8'.repeat(64),
        env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') },
        signal: controller.signal,
        deadlineAtMonotonicMs: performance.now() + 30_000,
      }),
      (error: unknown) => {
        assert(error instanceof DetoxCameraJestListTestsExecutionError);
        assert.equal(error.execution.execution, 'cancelled');
        assert.equal(error.execution.cleanup, 'cleaned');
        assert.equal(error.execution.pid, error.execution.pgid);
        assert.equal(error.command.cwd, root);
        assert.equal(error.command.argv.includes('--listTests'), true);
        return true;
      },
    );
    const ledger = JSON.parse(
      await readFile(path.join(root, 'detox-camera-jest-list-tests.ownership.json'), 'utf8'),
    ) as { cleanup?: unknown; latestCensus?: { groupMembers?: unknown[] } };
    assert.equal(ledger.cleanup, 'cleaned');
    assert.deepEqual(ledger.latestCensus?.groupMembers, []);
  } finally {
    clearTimeout(abortTimer);
    await rm(root, { recursive: true, force: true });
  }
});

void test('V30 validates the module-executed receipt under the caller deadline', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-camera-v30-receipt-')));
  await chmod(root, 0o700);
  const cameraTestPath = path.join(root, 'e2e', 'detox-ios-camera-route.e2e.test.js');
  const runnerInputsSha256 = '1'.repeat(64);
  const cameraTestSha256 = '2'.repeat(64);
  const receiptPath = path.join(root, 'detox-camera-jest-selection.private.json');
  await writeFile(
    receiptPath,
    JSON.stringify({
      schema: 'detox-ios-camera-jest-selection-v1',
      phase: 'module-executed',
      moduleLoaded: true,
      runnerInputsSha256,
      cameraTestPath,
      cameraTestSha256,
      selectedTestCount: 1,
    }),
    { mode: 0o600 },
  );
  const child = {
    outcome: () => ({ code: null, signal: null }),
  } as unknown as Parameters<typeof waitForOwnedDetoxCameraJestSelection>[0]['child'];
  try {
    await waitForOwnedDetoxCameraJestSelection({
      child,
      artifactRoot: root,
      runnerInputsSha256,
      cameraTestPath,
      cameraTestSha256,
      deadlineAtMonotonicMs: performance.now() + 10_000,
      signal: new AbortController().signal,
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      waitForOwnedDetoxCameraJestSelection({
        child,
        artifactRoot: root,
        runnerInputsSha256,
        cameraTestPath,
        cameraTestSha256,
        deadlineAtMonotonicMs: performance.now() + 10_000,
        signal: controller.signal,
      }),
      /aborted/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V30 source controls pin preflight before native launch and installed Detox hook order', async () => {
  const owner = await readFile(
    path.join(repositoryRoot, 'scripts/testing/native-detox-camera-ios-current-owner.ts'),
    'utf8',
  );
  const child = await readFile(
    path.join(repositoryRoot, 'e2e/detox-ios-camera-route.e2e.test.js'),
    'utf8',
  );
  const globalSetup = await readFile(
    path.join(nodeModulesRoot, 'detox/runners/jest/globalSetup.js'),
    'utf8',
  );
  const runJest = await readFile(path.join(nodeModulesRoot, '@jest/core/build/runJest.js'), 'utf8');
  const selectionStart = owner.indexOf(
    'export async function waitForOwnedDetoxCameraJestSelection',
  );
  const startupStart = owner.indexOf('export async function waitForOwnedDetoxChildStartup');
  assert.ok(selectionStart >= 0 && startupStart > selectionStart);
  const selectionSource = owner.slice(selectionStart, startupStart);
  assert.doesNotMatch(selectionSource, /performance\.now\(\) \+ 5_000/);
  assert.match(owner, /--listTests/);
  assert.match(owner, /--runInBand/);
  assert.match(owner, /--json/);
  assert.match(owner, /process\.execPath/);
  assert.match(owner, /executeOwnedNativeCommand/);
  assert.match(owner, /deadlineAtMonotonicMs: input\.deadlineAtMonotonicMs/);
  assert.match(owner, /initialOwnershipDeadlineAtMonotonicMs: input\.deadlineAtMonotonicMs/);
  assert.doesNotMatch(owner, /leaderHandshake\s*:/);
  assert.match(owner, /detox-camera-jest-list-tests\.stdout\.private/);
  assert.match(owner, /validateDetoxCameraJestListTestsOwnership/);
  assert.match(owner, /latestCensus\.groupMembers\.length !== 0/);
  assert.match(owner, /escapedCandidates\.length !== 0/);
  assert.match(owner, /execution\.cleanup !== 'cleaned'/);
  assert.match(owner, /execution\.ownershipPath === null/);
  assert.match(owner, /DetoxCameraJestListTestsExecutionError/);
  assert.match(owner, /projectDetoxCameraJestListTestsFailure/);
  assert.match(owner, /cleanupStatus === 'cleaned'/);
  assert.match(owner, /unknownHandle: cleanupStatus !== 'cleaned'/);
  assert.match(owner, /resource: 'detox-jest-list-tests'/);
  assert.match(owner, /publicPromotionEligible: false/);
  assert.match(owner, /phase: 'step'/);
  assert.match(owner, /parseDetoxCameraJestListTestsOutput/);
  assert.match(owner, /DETOX_CAMERA_JEST_LIST_TESTS_RECEIPT/);
  assert.ok(
    owner.indexOf('jestListTestsReceipt = await runDetoxCameraJestListTests') <
      owner.indexOf("child = await acquireResource('detox', () =>"),
  );
  assert.match(child, /phase: 'module-executed'/);
  assert.match(child, /moduleLoaded: true/);
  assert.match(globalSetup, /require\('\.\.\/\.\.\/internals'\)\.init/);
  assert.ok(
    runJest.indexOf('if (globalConfig.listTests)') < runJest.indexOf("moduleName: 'globalSetup'"),
  );
});

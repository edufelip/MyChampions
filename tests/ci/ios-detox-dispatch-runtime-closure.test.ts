import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  chmod,
  mkdtemp,
  readFile as readFileAsync,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { makeCompleteCapture } from './detox-runtime-dispatch-fixture';
import {
  publishDetoxRuntimeOriginals,
  type DriverReport,
} from '../../scripts/testing/detox-integrated-connection-driver';
import { readActualDetoxRuntimeMetadata } from '../../scripts/testing/detox-runtime-build-metadata';
import {
  DETOX_IOS_CONNECTION_PUBLIC_OWNER,
  type DetoxIosConnectionPublicBridgeResult,
} from '../../scripts/testing/native-detox-connection-public-bridge';
import {
  detoxDispatchRuntimeClosure,
  detoxDispatchRuntimeInputsDigest,
  readDetoxQualifiedBuildInput,
  runIosDetoxConnectionAttemptForNativePilot,
  type DetoxDispatchQualifiedBuild,
} from '../../scripts/testing/native-detox-connection-public-dispatch';
import type { DetoxConnectionAttemptResult } from '../../scripts/testing/detox-integrated-connection-baseline';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

type Inventory = { scenarios: Record<string, unknown>[] };

const REQUESTED_RUN_ID = '0123456789abcdef01234567';

async function privateArtifactRoot(root: string): Promise<{
  parent: string;
  root: string;
}> {
  const parent = await realpath(
    await mkdtemp(path.join(root, '.qa', 'artifacts', 'detox-dispatch-runtime-')),
  );
  await chmod(parent, 0o700);
  return { parent, root: path.join(parent, REQUESTED_RUN_ID) };
}

function loadSelection(root: string): NativePilotSelection {
  const inventory = JSON.parse(
    readFileSync(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as Inventory;
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-connection-ios');
  assert(scenario, 'SCN-connection-ios is required by the dispatch contract');
  return {
    arguments: {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-connection-ios',
      mode: 'integration',
    },
    scenario: structuredClone(scenario) as NativePilotSelection['scenario'],
    scenarioHash: '1'.repeat(64),
    requirementHash: '2'.repeat(64),
  };
}

async function qualifiedBuild(root: string): Promise<DetoxDispatchQualifiedBuild> {
  const paths = [...detoxDispatchRuntimeClosure];
  const observations = paths.map((relative) => readDetoxQualifiedBuildInput(root, relative));
  const runtimeMetadata = await readActualDetoxRuntimeMetadata(root, 'f'.repeat(64));
  return {
    platform: 'ios',
    configuration: 'ios.sim.debug',
    binaryPath: path.join(root, 'ios/build/Debug/mychampions.app'),
    binaryHash: 'a'.repeat(64),
    testBinaryPath: null,
    testBinaryHash: null,
    source: { sha: 'b'.repeat(40), dirty: false, sourceTreeHash: 'c'.repeat(64) },
    helperInputPaths: [],
    helperInputsHash: 'd'.repeat(64),
    detoxConfigPath: path.join(root, '.detoxrc.js'),
    detoxConfigHash: 'e'.repeat(64),
    metroPort: 8081,
    appIdentifier: 'com.edufelip.mychampions.dev',
    embeddedRuntime: {
      variant: 'dev',
      appIdentifier: 'com.edufelip.mychampions.dev',
      apiOrigin: 'http://127.0.0.1:8082',
      configSourcePath: path.join(root, 'app.config.ts'),
      configSourceHash: 'f'.repeat(64),
    },
    ...runtimeMetadata,
    dispatchRuntimeInputPaths: paths,
    dispatchRuntimeInputIdentities: observations.map((observation) => observation.identity),
    dispatchRuntimeInputsHash: detoxDispatchRuntimeInputsDigest(
      paths,
      observations.map((observation) => observation.bytes),
    ),
  };
}

function bridgeResult(
  selection: NativePilotSelection,
  artifactRoot: string,
): DetoxIosConnectionPublicBridgeResult {
  const requestedRunId = '0123456789abcdef01234567';
  const requestedAttemptId = `${requestedRunId}:first`;
  return {
    kind: 'private-detox-ios-connection-public-bridge-result-not-public-receipt',
    owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
    engine: 'detox',
    platform: 'ios',
    requestedRunId,
    requestedAttemptId,
    selection: {
      arguments: selection.arguments,
      scenarioId: selection.scenario.id,
      scenarioHash: selection.scenarioHash,
      requirementHash: selection.requirementHash,
      assertionIds: [],
    },
    declaredBuildIdentity: {
      sourceTreeHash: 'c'.repeat(64),
      helperInputsHash: 'd'.repeat(64),
      binaryHash: 'a'.repeat(64),
      detoxConfigHash: 'e'.repeat(64),
    },
    attempt: {
      kind: 'private-detox-connection-attempt-not-public-receipt',
      status: 'source-only',
      selectionValid: true,
      acquired: false,
      cleanup: 'cleaned',
      report: {
        output: artifactRoot,
        selection,
        reportPath: `${artifactRoot}/bridge-report.private.json`,
        ledgerPath: `${artifactRoot}/connection-ledger.private.json`,
        diagnosticsPath: `${artifactRoot}/diagnostics.private.json`,
        recoveryRecordPath: `${artifactRoot}/recovery.private.json`,
        detoxConnectionCommands: [],
        censusFailures: [],
        outputFailures: [],
        cleanup: { status: 'cleaned', recovery: 'verified' },
      },
      ledger: [],
      failures: [],
      recoveryStatus: 'verified',
      deadlineAccounting: null,
      nativePassingCases: 0,
      publicPromotionEligible: false,
    } satisfies DetoxConnectionAttemptResult,
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
}

async function runDispatch(
  root: string,
  build: DetoxDispatchQualifiedBuild,
  runBridge: (input: { artifactRoot: string }) => Promise<DetoxIosConnectionPublicBridgeResult>,
  options: Readonly<{ signal?: AbortSignal; now?: () => number }> = {},
) {
  const selection = loadSelection(root);
  const artifact = await privateArtifactRoot(root);
  let bridgeCalls = 0;
  try {
    const result = await runIosDetoxConnectionAttemptForNativePilot(
      {
        repositoryRoot: root,
        serverRoot: path.join(root, 'server'),
        artifactRoot: artifact.root,
        requestedRunId: REQUESTED_RUN_ID,
        requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
        selection,
        signal: options.signal ?? new AbortController().signal,
        deadlineMs: 60_000,
        buildRunId: 'fedcba987654321001234567',
      },
      {
        now: options.now,
        loadBuild: () => Promise.resolve(build),
        runBridge: (input) => {
          bridgeCalls += 1;
          return Promise.resolve(runBridge({ artifactRoot: input.artifactRoot }));
        },
      },
    );
    return { result, bridgeCalls };
  } finally {
    await rm(artifact.parent, { recursive: true, force: true });
  }
}

void test('unchanged post-bridge runtime closure remains source-only verified', async () => {
  const root = process.cwd();
  const build = await qualifiedBuild(root);
  const { result, bridgeCalls } = await runDispatch(root, build, async ({ artifactRoot }) => {
    // The positive fixture uses the same owned-driver token and original-file
    // writer as the production path. It must not qualify a bridge-only object
    // that has never emitted protected originals.
    const fixture = await makeCompleteCapture(
      path.dirname(artifactRoot),
      undefined,
      loadSelection(process.cwd()),
      build.dispatchRuntimeInputsHash,
    );
    const report = fixture.bridgeResult.attempt.report as DriverReport;
    for (const name of [
      'detox-source-original.private.json',
      'detox-build-original.private.json',
      'detox-target-original.private.json',
      'detox-transport-original.private.json',
      'detox-api-original.private.json',
      'detox-sql-original.private.json',
      'detox-ui-original.private.json',
    ])
      await rm(path.join(artifactRoot, name));
    delete report.detoxRuntimeOriginalReceiptSet;
    await publishDetoxRuntimeOriginals(report, {
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 600_000,
    });
    return fixture.bridgeResult;
  });
  assert.equal(bridgeCalls, 1);
  assert.equal(result.dispatchRuntimeInputsHash, build.dispatchRuntimeInputsHash);
  assert.equal(result.verificationResult, 'passed');
  assert.equal(result.postCaptureFailure, null);
  assert.equal(result.captureCompleted, true);
  assert.equal(result.nativePassingCases, 0);
});

void test('post-bridge same-run helper mutation is rejected before publication', async () => {
  const root = process.cwd();
  const build = await qualifiedBuild(root);
  const relative = 'scripts/testing/detox-connection-actionability.ts';
  const target = path.join(root, relative);
  const original = await readFileAsync(target);
  const beforeHash = build.dispatchRuntimeInputsHash;
  try {
    const { result, bridgeCalls } = await runDispatch(root, build, async ({ artifactRoot }) => {
      await writeFile(
        target,
        Buffer.concat([original, Buffer.from('\n// private same-run mutation\n')]),
      );
      return Promise.resolve(bridgeResult(loadSelection(root), artifactRoot));
    });
    const afterBytes = detoxDispatchRuntimeClosure.map((input) =>
      readFileSync(path.join(root, input)),
    );
    const afterHash = detoxDispatchRuntimeInputsDigest(detoxDispatchRuntimeClosure, afterBytes);
    assert.notEqual(afterHash, beforeHash);
    assert.equal(bridgeCalls, 1);
    assert.equal(result.dispatchRuntimeInputsHash, beforeHash);
    assert.equal(result.verificationResult, 'not-executed');
    assert.equal(result.captureCompleted, false);
    assert.equal(result.postCaptureFailure?.phase, 'verification');
    assert.match(result.postCaptureFailure?.message ?? '', /identity changed|closure changed/i);
    assert.equal(result.nativePassingCases, 0);
  } finally {
    await writeFile(target, original);
  }
});

void test('post-bridge same-byte inode replacement is rejected despite unchanged bytes', async () => {
  const root = process.cwd();
  const build = await qualifiedBuild(root);
  const relative = 'scripts/testing/detox-connection-actionability.ts';
  const target = path.join(root, relative);
  const replacement = `${target}.private-v4-replacement`;
  const original = readFileSync(target);
  let moved = false;
  try {
    const { result, bridgeCalls } = await runDispatch(root, build, ({ artifactRoot }) => {
      renameSync(target, replacement);
      moved = true;
      writeFileSync(target, original, { mode: 0o600 });
      return Promise.resolve(bridgeResult(loadSelection(root), artifactRoot));
    });
    assert.equal(bridgeCalls, 1);
    assert.equal(result.verificationResult, 'not-executed');
    assert.equal(result.captureCompleted, false);
    assert.equal(result.postCaptureFailure?.phase, 'verification');
    assert.match(result.postCaptureFailure?.message ?? '', /identity changed/i);
    assert.equal(result.nativePassingCases, 0);
  } finally {
    if (moved) {
      if (existsSync(target)) unlinkSync(target);
      renameSync(replacement, target);
    }
  }
});

void test('late abort during closure reread is rejected before projection', async () => {
  const root = process.cwd();
  const build = await qualifiedBuild(root);
  const controller = new AbortController();
  let clockCalls = 0;
  const { result, bridgeCalls } = await runDispatch(
    root,
    build,
    ({ artifactRoot }) => Promise.resolve(bridgeResult(loadSelection(root), artifactRoot)),
    {
      signal: controller.signal,
      now: () => {
        clockCalls += 1;
        if (clockCalls === 7) controller.abort(new Error('late closure reread abort'));
        return 1_000;
      },
    },
  );
  assert.equal(bridgeCalls, 1);
  assert.equal(result.verificationResult, 'not-executed');
  assert.equal(result.captureCompleted, false);
  assert.equal(result.postCaptureFailure?.phase, 'verification');
  assert.match(result.postCaptureFailure?.message ?? '', /late closure reread abort/i);
  assert.equal(result.nativePassingCases, 0);
});

void test('late abort after closure reread is rejected by the post-read fence', async () => {
  const root = process.cwd();
  const build = await qualifiedBuild(root);
  const controller = new AbortController();
  let clockCalls = 0;
  const abortAt = 5 + detoxDispatchRuntimeClosure.length * 2 + 1;
  const { result, bridgeCalls } = await runDispatch(
    root,
    build,
    ({ artifactRoot }) => Promise.resolve(bridgeResult(loadSelection(root), artifactRoot)),
    {
      signal: controller.signal,
      now: () => {
        clockCalls += 1;
        if (clockCalls === abortAt) controller.abort(new Error('late closure post-read abort'));
        return 1_000;
      },
    },
  );
  assert.equal(bridgeCalls, 1);
  assert.equal(result.verificationResult, 'not-executed');
  assert.equal(result.captureCompleted, false);
  assert.equal(result.postCaptureFailure?.phase, 'verification');
  assert.match(result.postCaptureFailure?.message ?? '', /late closure post-read abort/i);
  assert.equal(result.nativePassingCases, 0);
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DetoxConnectionEvidenceRecoveryError } from '../../scripts/testing/detox-connection-evidence';
import { detoxSessionHelperClosure } from '../../scripts/testing/detox-integrated-session-baseline';
import {
  DETOX_IOS_CONNECTION_PUBLIC_OWNER,
  delegateIosDetoxConnectionAsSingleOwner,
  type DetoxIosConnectionPublicBridgeResult,
} from '../../scripts/testing/native-detox-connection-public-bridge';
import {
  createDetoxDispatchLifecycle,
  detoxDispatchRuntimeClosure,
  detoxDispatchRuntimeInputsDigest,
  requireDetoxDispatchRuntimeClosure,
  retainIosDetoxConnectionPartialAttempt,
  readDetoxQualifiedBuildInput,
  readDetoxQualifiedBuildInputForTest,
  remainingDetoxDispatchBudget,
  runIosDetoxConnectionAttemptForNativePilot,
} from '../../scripts/testing/native-detox-connection-public-dispatch';
import type { DetoxConnectionAttemptResult } from '../../scripts/testing/detox-integrated-connection-baseline';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const REQUESTED_RUN_ID = '0123456789abcdef01234567';

function loadSelection(repositoryRoot = process.cwd()): NativePilotSelection {
  const inventory = JSON.parse(
    readFileSync(path.resolve(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { scenarios: Record<string, unknown>[] };
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-connection-ios');
  assert(scenario, 'The current connection scenario is required by the dispatch contract');
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

async function privateArtifactRoot(): Promise<{
  parent: string;
  root: string;
}> {
  const parent = await realpath(
    await mkdtemp(path.join(process.cwd(), '.qa', 'artifacts', 'detox-dispatch-lifecycle-')),
  );
  await chmod(parent, 0o700);
  return { parent, root: path.join(parent, REQUESTED_RUN_ID) };
}

async function withPrivateArtifactRoot<T>(
  callback: (artifactRoot: string) => Promise<T>,
): Promise<T> {
  const artifact = await privateArtifactRoot();
  try {
    return await callback(artifact.root);
  } finally {
    await rm(artifact.parent, { recursive: true, force: true });
  }
}

async function withPrivateNativeAttemptRoot<T>(
  callback: (input: { repositoryRoot: string; artifactRoot: string }) => Promise<T>,
): Promise<T> {
  const parent = path.join(process.cwd(), '.qa', 'artifacts', 'detox-dispatch-test-repositories');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const repositoryRoot = await realpath(await mkdtemp(path.join(parent, 'owned-repository-')));
  await chmod(repositoryRoot, 0o700);
  for (const relative of detoxDispatchRuntimeClosure) {
    const source = path.resolve(process.cwd(), relative);
    const sourceIdentity = await lstat(source);
    assert(sourceIdentity.isFile() && !sourceIdentity.isSymbolicLink());
    const destination = path.join(repositoryRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination);
    await chmod(destination, 0o600);
  }
  const artifactRoot = path.join(
    repositoryRoot,
    '.qa',
    'artifacts',
    'native-pilot-attempts',
    REQUESTED_RUN_ID,
  );
  await mkdir(path.dirname(artifactRoot), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(artifactRoot), 0o700);
  try {
    return await callback({ repositoryRoot, artifactRoot });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

function build(repositoryRoot: string) {
  const dispatchRuntimeInputPaths = [...detoxDispatchRuntimeClosure];
  const dispatchRuntimeObservations = dispatchRuntimeInputPaths.map((relative) =>
    readDetoxQualifiedBuildInput(repositoryRoot, relative),
  );
  return {
    platform: 'ios' as const,
    configuration: 'ios.sim.debug' as const,
    binaryPath: path.join(repositoryRoot, 'ios/build/Debug/mychampions.app'),
    binaryHash: 'a'.repeat(64),
    testBinaryPath: null,
    testBinaryHash: null,
    source: { sha: 'b'.repeat(40), dirty: false, sourceTreeHash: 'c'.repeat(64) },
    helperInputPaths: [...detoxSessionHelperClosure],
    helperInputsHash: 'd'.repeat(64),
    detoxConfigPath: path.join(repositoryRoot, '.detoxrc.js'),
    detoxConfigHash: 'e'.repeat(64),
    metroPort: 8081,
    appIdentifier: 'com.edufelip.mychampions.dev',
    embeddedRuntime: {
      variant: 'dev' as const,
      appIdentifier: 'com.edufelip.mychampions.dev',
      apiOrigin: 'http://127.0.0.1:8082',
      configSourcePath: path.join(repositoryRoot, 'app.config.ts'),
      configSourceHash: 'f'.repeat(64),
    },
    dispatchRuntimeInputPaths,
    dispatchRuntimeInputIdentities: dispatchRuntimeObservations.map(
      (observation) => observation.identity,
    ),
    dispatchRuntimeInputsHash: detoxDispatchRuntimeInputsDigest(
      dispatchRuntimeInputPaths,
      dispatchRuntimeObservations.map((observation) => observation.bytes),
    ),
  };
}

function bridgeResult(
  selection: NativePilotSelection,
  artifactRoot: string,
  overrides: Partial<DetoxConnectionAttemptResult> = {},
): DetoxIosConnectionPublicBridgeResult {
  return {
    kind: 'private-detox-ios-connection-public-bridge-result-not-public-receipt',
    owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
    engine: 'detox',
    platform: 'ios',
    requestedRunId: '0123456789abcdef01234567',
    requestedAttemptId: '0123456789abcdef01234567:first',
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
      status: 'blocked',
      selectionValid: true,
      acquired: false,
      cleanup: 'not-acquired',
      report: {
        output: artifactRoot,
        selection,
        reportPath: `${artifactRoot}/bridge-report.private.json`,
        ledgerPath: `${artifactRoot}/connection-ledger.private.json`,
        diagnosticsPath: `${artifactRoot}/diagnostics.private.json`,
        recoveryRecordPath: `${artifactRoot}/recovery.private.json`,
        detoxConnectionCommands: [{ commandId: 'detox-command-1', status: 'failed' }],
        censusFailures: [{ phase: 'cleanup', reason: 'fixture' }],
        outputFailures: [{ phase: 'bridge', reason: 'fixture' }],
        cleanup: { status: 'failed', recovery: 'retained' },
      },
      ledger: [
        {
          id: 'connection-1',
          actor: 'coach',
          navigation: 'none',
          status: 'failed',
          evidenceKinds: ['ui'],
          targetConnectionId: null,
          bound: false,
          phase: 'connection',
        },
      ],
      failures: [{ phase: 'acquisition', name: 'HarnessBlocked', message: 'fixture' }],
      recoveryStatus: 'not-verified',
      deadlineAccounting: null,
      nativePassingCases: 0,
      publicPromotionEligible: false,
      ...overrides,
    },
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
}

void test('dispatcher gives the bridge only the remaining whole-run budget and keeps late bridge facts', async () => {
  const selection = loadSelection();
  const clockValues = [1_000, 1_001, 1_002, 1_003, 70_000];
  let bridgeDeadlineMs = 0;
  let buildDeadlineAt = 0;
  const result = await withPrivateArtifactRoot((artifactRoot) =>
    runIosDetoxConnectionAttemptForNativePilot(
      {
        repositoryRoot: process.cwd(),
        serverRoot: path.join(process.cwd(), 'server'),
        artifactRoot,
        requestedRunId: REQUESTED_RUN_ID,
        requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
        selection,
        signal: new AbortController().signal,
        deadlineMs: 60_000,
        buildRunId: 'fedcba987654321001234567',
      },
      {
        now: () => clockValues.shift() ?? 70_000,
        loadBuild: async (input) => {
          await Promise.resolve();
          buildDeadlineAt = input.deadlineAtMonotonicMs ?? 0;
          return build(process.cwd());
        },
        runBridge: async (input) => {
          await Promise.resolve();
          bridgeDeadlineMs = input.deadlineMs;
          return bridgeResult(selection, input.artifactRoot);
        },
      },
    ),
  );
  assert.equal(buildDeadlineAt, 61_000);
  assert(bridgeDeadlineMs >= 59_990 && bridgeDeadlineMs <= 60_000);
  assert.equal(result.detoxBridgeResult.attempt.status, 'blocked');
  assert.equal(result.detoxBridgeResult.attempt.cleanup, 'not-acquired');
  assert.equal(result.detoxBridgeResult.attempt.failures[0]?.name, 'HarnessBlocked');
  assert.equal(result.verificationFailure?.name, 'HarnessBlocked');
  assert.equal(result.postCaptureFailure?.phase, 'verification');
  assert.equal(result.verificationResult, 'not-executed');
  assert.equal(result.nativePassingCases, 0);
});

void test('long whole-run deadlines do not inflate the real bridge step budget', async () => {
  let bridgeDeadlineMs = 0;
  let driverReached = false;
  let driverDeadlineMs = 0;
  const sharedParent = path.join(process.cwd(), '.qa', 'artifacts', 'native-pilot-attempts');
  const retainedReceipt = path.join(
    sharedParent,
    `historical-receipt-${randomUUID()}.private.json`,
  );
  await mkdir(sharedParent, { recursive: true, mode: 0o700 });
  await chmod(sharedParent, 0o700);
  await writeFile(retainedReceipt, '{"retained":true}\n', { mode: 0o600, flag: 'wx' });
  let result: Awaited<ReturnType<typeof runIosDetoxConnectionAttemptForNativePilot>>;
  try {
    result = await withPrivateNativeAttemptRoot(({ repositoryRoot, artifactRoot }) => {
      const selection = loadSelection(repositoryRoot);
      return runIosDetoxConnectionAttemptForNativePilot(
        {
          repositoryRoot,
          serverRoot: path.join(repositoryRoot, 'server'),
          artifactRoot,
          requestedRunId: REQUESTED_RUN_ID,
          requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
          selection,
          signal: new AbortController().signal,
          deadlineMs: 600_000,
          deadlineAtMonotonicMs: 2_401_000,
          buildRunId: 'fedcba987654321001234567',
        },
        {
          now: () => 1_000,
          loadBuild: async () => {
            await Promise.resolve();
            return build(repositoryRoot);
          },
          runBridge: async (input) => {
            bridgeDeadlineMs = input.deadlineMs;
            return delegateIosDetoxConnectionAsSingleOwner({
              ...input,
              validateBuild: () => undefined,
              delegate: async (driverInput) => {
                await Promise.resolve();
                driverReached = true;
                assert.equal(typeof driverInput.deadlineMs, 'number');
                assert(driverInput.deadlineMs !== undefined);
                driverDeadlineMs = driverInput.deadlineMs;
                return bridgeResult(selection, driverInput.artifactRoot, {
                  cleanup: 'failed',
                  recoveryStatus: 'not-verified',
                }).attempt;
              },
            });
          },
        },
      );
    });
    assert.equal(await readFile(retainedReceipt, 'utf8'), '{"retained":true}\n');
  } finally {
    await rm(retainedReceipt, { force: true });
  }
  assert.equal(bridgeDeadlineMs, 600_000);
  assert.equal(driverDeadlineMs, 600_000);
  assert.equal(driverReached, true);
  assert.equal(result.detoxBridgeResult.attempt.status, 'blocked');
  assert.equal(result.detoxBridgeResult.attempt.cleanup, 'failed');
  assert.equal(result.nativePassingCases, 0);
});

void test('an earlier absolute deadline shortens the bridge step without renewal', async () => {
  const selection = loadSelection();
  let bridgeDeadlineMs = 0;
  await withPrivateArtifactRoot((artifactRoot) =>
    runIosDetoxConnectionAttemptForNativePilot(
      {
        repositoryRoot: process.cwd(),
        serverRoot: path.join(process.cwd(), 'server'),
        artifactRoot,
        requestedRunId: REQUESTED_RUN_ID,
        requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
        selection,
        signal: new AbortController().signal,
        deadlineMs: 600_000,
        deadlineAtMonotonicMs: 401_000,
        buildRunId: 'fedcba987654321001234567',
      },
      {
        now: () => 1_000,
        loadBuild: async () => {
          await Promise.resolve();
          return build(process.cwd());
        },
        runBridge: async (input) => {
          await Promise.resolve();
          bridgeDeadlineMs = input.deadlineMs;
          return bridgeResult(selection, input.artifactRoot);
        },
      },
    ),
  );
  assert.equal(bridgeDeadlineMs, 400_000);
});

void test('dispatcher does not invoke the bridge after a pre-build deadline fence', async () => {
  const selection = loadSelection();
  let loadCalls = 0;
  let bridgeCalls = 0;
  await withPrivateArtifactRoot((artifactRoot) =>
    assert.rejects(
      () =>
        runIosDetoxConnectionAttemptForNativePilot(
          {
            repositoryRoot: process.cwd(),
            serverRoot: path.join(process.cwd(), 'server'),
            artifactRoot,
            requestedRunId: REQUESTED_RUN_ID,
            requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
            selection,
            signal: new AbortController().signal,
            deadlineMs: 30_000,
            buildRunId: 'fedcba987654321001234567',
          },
          {
            now: (() => {
              const values = [1_000, 31_001];
              return () => values.shift() ?? 31_001;
            })(),
            loadBuild: async () => {
              await Promise.resolve();
              loadCalls += 1;
              return build(process.cwd());
            },
            runBridge: async () => {
              await Promise.resolve();
              bridgeCalls += 1;
              throw new Error('bridge must not be called');
            },
          },
        ),
      /deadline elapsed/i,
    ),
  );
  assert.equal(loadCalls, 0);
  assert.equal(bridgeCalls, 0);
});

void test('qualified source reader rejects a same-size inode replacement after descriptor open', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-dispatch-reader-')));
  try {
    await chmod(root, 0o700);
    const file = path.join(root, 'app.config.ts');
    await writeFile(file, 'abcde', { mode: 0o644 });
    await chmod(file, 0o644);
    assert.throws(
      () =>
        readDetoxQualifiedBuildInputForTest(root, 'app.config.ts', {
          beforeRead: () => {
            renameSync(file, `${file}.old`);
            writeFileSync(file, 'vwxyz', { mode: 0o644 });
            chmodSync(file, 0o644);
          },
        }),
      /changed|identity|immutable|owned/i,
    );
    const bytes = await readFile(`${file}.old`, 'utf8');
    assert.equal(bytes, 'abcde');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('late cancellation is retained as verification failure without erasing bridge cleanup facts', async () => {
  const selection = loadSelection();
  const controller = new AbortController();
  const result = await withPrivateArtifactRoot((artifactRoot) =>
    runIosDetoxConnectionAttemptForNativePilot(
      {
        repositoryRoot: process.cwd(),
        serverRoot: path.join(process.cwd(), 'server'),
        artifactRoot,
        requestedRunId: REQUESTED_RUN_ID,
        requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
        selection,
        signal: controller.signal,
        deadlineMs: 60_000,
        buildRunId: 'fedcba987654321001234567',
      },
      {
        now: (() => {
          const values = [1_000, 1_001, 1_002, 1_003];
          return () => values.shift() ?? 1_003;
        })(),
        loadBuild: async () => {
          await Promise.resolve();
          return build(process.cwd());
        },
        runBridge: async (input) => {
          await Promise.resolve();
          controller.abort(new Error('late-cancel'));
          return bridgeResult(selection, input.artifactRoot);
        },
      },
    ),
  );
  assert.equal(result.detoxBridgeResult.attempt.cleanup, 'not-acquired');
  assert.equal(result.detoxBridgeResult.attempt.failures[0]?.name, 'HarnessBlocked');
  assert.equal(result.verificationFailure?.name, 'HarnessBlocked');
  assert.equal(result.postCaptureFailure?.phase, 'verification');
  assert.equal(result.postCaptureFailure?.name, 'Error');
  assert.equal(result.nativePassingCases, 0);
});

void test('lifecycle helper refuses a restarted bridge budget below the owned minimum', () => {
  const lifecycle = createDetoxDispatchLifecycle(30_000, new AbortController().signal, () => 1_000);
  assert.throws(
    () => remainingDetoxDispatchBudget({ ...lifecycle, now: () => 1_001 + 30_000 }),
    /deadline elapsed/i,
  );
});

void test('runtime closure rejects omitted bridge inputs and fingerprints changed bytes', () => {
  const omitted = detoxDispatchRuntimeClosure.filter(
    (relative) => relative !== 'scripts/testing/native-detox-connection-public-bridge.ts',
  );
  assert.throws(() => requireDetoxDispatchRuntimeClosure(omitted), /manifest-complete|closure/i);
  const contents = detoxDispatchRuntimeClosure.map((relative) => Buffer.from(relative));
  const original = detoxDispatchRuntimeInputsDigest(detoxDispatchRuntimeClosure, contents);
  const changed = [...contents];
  const bridgeIndex = detoxDispatchRuntimeClosure.indexOf(
    'scripts/testing/native-detox-connection-public-bridge.ts',
  );
  assert(bridgeIndex >= 0);
  changed[bridgeIndex] = Buffer.from('changed bridge source');
  assert.notEqual(detoxDispatchRuntimeInputsDigest(detoxDispatchRuntimeClosure, changed), original);
});

void test('partial attempt publication retains bridge refs and rejects an existing destination', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-dispatch-partial-')));
  try {
    await chmod(root, 0o700);
    const failedResult = bridgeResult(loadSelection(), root, {
      cleanup: 'failed',
      recoveryStatus: 'not-verified',
    });
    const destination = path.join(root, 'detox-connection-partial-attempt.private.json');
    const published = await retainIosDetoxConnectionPartialAttempt({
      outputRoot: root,
      result: failedResult,
    });
    assert.equal(published, destination);
    const document = JSON.parse(await readFile(published, 'utf8')) as {
      attempt: {
        bridge: {
          report: { reportPath: string | null };
          ledger: unknown[];
          diagnostics: {
            commands: unknown[];
            censusFailures: unknown[];
            outputFailures: unknown[];
          };
          recovery: { status: string };
        };
      };
    };
    assert.equal(document.attempt.bridge.report.reportPath, `${root}/bridge-report.private.json`);
    assert.equal(document.attempt.bridge.ledger.length, 1);
    assert.equal(document.attempt.bridge.diagnostics.commands.length, 1);
    assert.equal(document.attempt.bridge.diagnostics.censusFailures.length, 1);
    assert.equal(document.attempt.bridge.diagnostics.outputFailures.length, 1);
    assert.equal(document.attempt.bridge.recovery.status, 'not-verified');
    const metadata = await lstat(published);
    assert.equal(metadata.nlink, 1);
    assert.equal(metadata.mode & 0o777, 0o600);
    await assert.rejects(
      () => retainIosDetoxConnectionPartialAttempt({ outputRoot: root, result: failedResult }),
      (error: unknown) =>
        error instanceof DetoxConnectionEvidenceRecoveryError &&
        error.code === 'DETOX_CONNECTION_EVIDENCE_RECOVERY',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('partial attempt publication refuses missing or non-private roots without mutating them', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-dispatch-root-')));
  try {
    const result = bridgeResult(loadSelection(), parent, {
      cleanup: 'failed',
      recoveryStatus: 'not-verified',
    });
    const missing = path.join(parent, 'missing-output-root');
    await assert.rejects(
      () => retainIosDetoxConnectionPartialAttempt({ outputRoot: missing, result }),
      /ENOENT|canonical|private/i,
    );
    await assert.rejects(() => lstat(missing), /ENOENT|no such file/i);

    const wrongMode = await realpath(await mkdtemp(path.join(parent, 'wrong-mode-')));
    await chmod(wrongMode, 0o755);
    await assert.rejects(
      () => retainIosDetoxConnectionPartialAttempt({ outputRoot: wrongMode, result }),
      /private|0700/i,
    );
    assert.equal((await lstat(wrongMode)).mode & 0o777, 0o755);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('deadline upper bound rejects before build reads', async () => {
  const selection = loadSelection();
  let loadCalls = 0;
  await withPrivateArtifactRoot((artifactRoot) =>
    assert.rejects(
      () =>
        runIosDetoxConnectionAttemptForNativePilot(
          {
            repositoryRoot: process.cwd(),
            serverRoot: path.join(process.cwd(), 'server'),
            artifactRoot,
            requestedRunId: REQUESTED_RUN_ID,
            requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
            selection,
            signal: new AbortController().signal,
            deadlineMs: 600_001,
            buildRunId: 'fedcba987654321001234567',
          },
          {
            loadBuild: async () => {
              await Promise.resolve();
              loadCalls += 1;
              return build(process.cwd());
            },
          },
        ),
      /outside the owned bridge range/i,
    ),
  );
  assert.equal(loadCalls, 0);
});

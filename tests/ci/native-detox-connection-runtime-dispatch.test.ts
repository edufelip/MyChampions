import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  makeQualifiedBuildRepository,
  makeCompleteCapture,
  runtimeFactsForFixture,
  selection,
} from './detox-runtime-dispatch-fixture';
import { readNativeComparisonReceipts } from '../../scripts/testing/compare-native-pilot';
import {
  publishVerifiedIosDetoxConnectionRuntimeForOuterTerminal,
  runIosDetoxConnectionRuntimeForCanonicalTerminal,
  shouldUseVerifiedIosDetoxTerminalPublisher,
  type DetoxRuntimeTerminalInput,
} from '../../scripts/testing/native-detox-connection-runtime-dispatch';
import { produceDetoxRuntimeFactsFromActualProducer } from '../../scripts/testing/native-detox-connection-runtime-producer';
import { writeNativePilotTerminalReceipt } from '../../scripts/testing/native-pilot-invocation';
import {
  markNativePilotReceiptBlockedForRepositoryEvidence,
  runIosDetoxConnectionRuntimeForOuterTerminal,
} from '../../scripts/testing/run-native-pilot';
import type {
  DetoxDispatchQualifiedBuild,
  DetoxNativePilotAttemptResult,
} from '../../scripts/testing/native-detox-connection-public-dispatch';
import type { DetoxIosConnectionRuntimeFacts } from '../../scripts/testing/native-detox-connection-runtime-verification';

const RUN_ID = '0123456789abcdef01234567';
const REPOSITORY_ROOT = process.cwd();
const SERVER_ROOT = path.resolve(REPOSITORY_ROOT, '../server');
const validSourceHash = '9'.repeat(64);

function producerLifecycle() {
  return {
    signal: new AbortController().signal,
    deadlineAtMonotonicMs: performance.now() + 600_000,
  };
}
type FixtureBuild = Awaited<ReturnType<typeof makeQualifiedBuildRepository>>['build'];

function asQualifiedBuild(value: FixtureBuild): DetoxDispatchQualifiedBuild {
  return {
    ...value,
    dispatchRuntimeInputPaths: [
      'scripts/testing/native-detox-connection-public-dispatch.ts',
      'scripts/testing/native-detox-connection-runtime-dispatch.ts',
      'scripts/testing/native-detox-connection-runtime-producer.ts',
      'scripts/testing/native-detox-connection-runtime-verification.ts',
    ],
    dispatchRuntimeInputIdentities: [],
    dispatchRuntimeInputsHash: validSourceHash,
  };
}

function attemptForFixture(
  fixture: Awaited<ReturnType<typeof makeCompleteCapture>>,
  overrides: Partial<DetoxNativePilotAttemptResult> = {},
): DetoxNativePilotAttemptResult {
  const build = asQualifiedBuild(fixture.build);
  return {
    kind: 'private-owned-ios-detox-connection-attempt-not-public-receipt',
    requestedRunId: RUN_ID,
    requestedAttemptId: `${RUN_ID}:first`,
    captureRunId: RUN_ID,
    backendRunId: 'fedcba987654321001234567',
    backendAttemptId: null,
    captureExitCode: 0,
    childExitCode: 0,
    childSignal: null,
    childClassification: 'completed',
    captureResult: 'observed',
    captureCleanup: 'cleaned',
    captureTimeout: null,
    cancellation: null,
    callbackInvocations: 1,
    callbackCompleted: true,
    externalCleanupResult: 'passed',
    verificationResult: 'passed',
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure: null,
    postCaptureFailure: null,
    deadline: null,
    commandDiagnostics: [],
    censusFailures: [],
    outputFailures: [],
    assertionBindings: [],
    fixtureRunId: 'fedcba987654321001234567',
    fixtureHash: 'f'.repeat(64),
    flagsHash: 'f'.repeat(64),
    toolVersions: { detox: '20.47.0' },
    timingsMs: {
      build: 1,
      install: 1,
      reset: 1,
      scenario: 1,
      verify: 1,
      cleanup: 1,
    },
    nativePassingCases: 0,
    artifactRoot: fixture.captureRoot,
    publicFinalization: null,
    publicFinalizationInput: null,
    publicDependency: null,
    captureInvocation: { count: 1, returned: true },
    captureCompleted: true,
    censusFailureCount: 0,
    staged: null,
    faultAttemptId: null,
    detoxBridgeResult: fixture.bridgeResult,
    dispatchRuntimeInputPaths: [],
    dispatchRuntimeInputsHash: validSourceHash,
    detoxBuild: build,
    detoxRuntimeFacts: null,
    ...overrides,
  };
}

async function fixtureArtifactParent(parent: string): Promise<string> {
  const qa = path.join(parent, '.qa');
  const artifacts = path.join(qa, 'artifacts');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  await chmod(qa, 0o700);
  await chmod(artifacts, 0o700);
  return artifacts;
}

async function namespaceIdentityForRoot(root: string) {
  const resolved = await realpath(root);
  const rootPath = path.parse(resolved).root;
  const components = resolved.slice(rootPath.length).split(path.sep).filter(Boolean);
  const entries = [];
  let current = rootPath;
  for (const component of ['', ...components]) {
    if (component) current = path.join(current, component);
    const entry = await lstat(current);
    assert(entry.isDirectory());
    entries.push({
      path: current,
      dev: entry.dev,
      ino: entry.ino,
      uid: entry.uid,
      gid: entry.gid,
      mode: entry.mode,
    });
  }
  return {
    parent: {
      path: path.dirname(resolved),
      entries: entries.slice(0, -1),
    },
    output: {
      path: resolved,
      entries,
    },
  };
}

function makeReceipt(input: DetoxRuntimeTerminalInput): Record<string, unknown> {
  const assertionBindings = input.verification.assertionBindings;
  const evidence = input.verification.staged.manifest.files.map((file) => file.name);
  const target = {
    deviceId: input.runtime.target.deviceId,
    osVersion: input.runtime.target.osVersion,
    appId: input.runtime.target.appId,
    buildProfile: input.build.configuration,
    binaryHash: input.build.binaryHash,
    apiOrigin: input.runtime.target.apiOrigin,
  };
  return {
    schemaVersion: 1,
    runId: input.requestedRunId,
    attemptId: input.requestedAttemptId,
    scenarioId: input.selection.scenario.id,
    phase: 'P4',
    layer: 'native',
    engine: 'detox',
    dataMode: 'postgres',
    platform: 'ios',
    locale: 'en-US',
    repositories: [
      {
        name: 'mychampions',
        sha: 'a'.repeat(40),
        dirty: false,
        workingTreeHash: null,
      },
    ],
    target,
    inputs: {
      scenarioHash: input.selection.scenarioHash,
      requirementHash: input.selection.requirementHash,
      fixtureHash: input.attempt.fixtureHash,
      flagsHash: input.attempt.flagsHash,
      toolVersions: input.attempt.toolVersions,
    },
    command: {
      executable: 'node',
      argv: ['scripts/testing/run-native-pilot.ts', '--engine=detox'],
    },
    startedAt: '2026-10-03T00:00:00.000Z',
    finishedAt: '2026-10-03T00:00:01.000Z',
    result: 'passed',
    exitCode: 0,
    childExitCode: 0,
    assertions: assertionBindings.map((binding) => ({
      id: binding.id,
      requirementRefs: binding.requirementRefs,
      outcome: 'passed',
      evidencePaths: binding.evidencePaths,
    })),
    timingsMs: input.runtime.timingsMs,
    cleanup: {
      status: 'cleaned',
      ownedResourceIds: ['fixture-owned-detox-target'],
      recoveryRecordPath: null,
    },
    artifacts: [...evidence, 'detox-connection-evidence-copy.private.json'],
    blocker: null,
  };
}

async function makeOuterPublicationFixture(prefix: string) {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  const qualified = await makeQualifiedBuildRepository(parent);
  const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
  const baseAttempt = attemptForFixture(fixture);
  const runtime = await runtimeFactsForFixture(fixture, parent);
  const dispatch = await runIosDetoxConnectionRuntimeForOuterTerminal({
    attempt: { ...baseAttempt, detoxRuntimeFacts: runtime },
    repositoryRoot: qualified.repositoryRoot,
    serverRoot: SERVER_ROOT,
    outputRoot: fixture.outputRoot,
    requestedRunId: RUN_ID,
    requestedAttemptId: `${RUN_ID}:first`,
    selection,
    signal: new AbortController().signal,
    deadlineMs: 600_000,
    deadlineAtMonotonicMs: performance.now() + 600_000,
    buildRunId: RUN_ID,
  });
  assert.equal(dispatch.status, 'verified-private');
  assert(dispatch.runtime);
  assert(dispatch.verification);
  const signal = new AbortController();
  const receipt = makeReceipt({
    repositoryRoot: qualified.repositoryRoot,
    outputRoot: fixture.outputRoot,
    requestedRunId: RUN_ID,
    requestedAttemptId: `${RUN_ID}:first`,
    selection,
    build: dispatch.attempt.detoxBuild,
    bridgeResult: dispatch.attempt.detoxBridgeResult,
    attempt: dispatch.attempt,
    runtime: dispatch.runtime,
    verification: dispatch.verification,
    lifecycle: {
      signal: signal.signal,
      deadlineAtMonotonicMs: performance.now() + 600_000,
      now: () => performance.now(),
    },
  });
  return {
    parent,
    fixture,
    dispatch,
    receipt,
    signal,
    namespaceIdentity: await namespaceIdentityForRoot(fixture.outputRoot),
  };
}

async function runFixture(
  parent: string,
  options: Readonly<{
    runtime?: DetoxIosConnectionRuntimeFacts | null;
    attempt?: Partial<DetoxNativePilotAttemptResult>;
    publish?: boolean;
    deadlineAtMonotonicMs?: number;
    onAttemptDeadline?: (deadlineAtMonotonicMs: number | undefined) => void;
    onLifecycleDeadline?: (deadlineAtMonotonicMs: number) => void;
    mutatePublishedReceipt?: (receipt: Record<string, unknown>) => unknown;
  }> = {},
) {
  const qualified = await makeQualifiedBuildRepository(parent);
  const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
  const attempt = attemptForFixture(fixture, options.attempt);
  let terminalCalls = 0;
  const result = await runIosDetoxConnectionRuntimeForCanonicalTerminal(
    {
      repositoryRoot: qualified.repositoryRoot,
      serverRoot: SERVER_ROOT,
      artifactRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      signal: new AbortController().signal,
      deadlineMs: 600_000,
      deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
      buildRunId: RUN_ID,
    },
    {
      runAttempt: (input) => {
        options.onAttemptDeadline?.(input.deadlineAtMonotonicMs);
        return Promise.resolve(attempt);
      },
      loadRuntime: async (input) => {
        options.onLifecycleDeadline?.(input.lifecycle.deadlineAtMonotonicMs);
        return options.runtime === undefined
          ? runtimeFactsForFixture(fixture, parent)
          : options.runtime;
      },
      publishTerminal:
        options.publish === false
          ? undefined
          : async (input) => {
              options.onLifecycleDeadline?.(input.lifecycle.deadlineAtMonotonicMs);
              terminalCalls += 1;
              const receipt = makeReceipt(input);
              const receiptPath = path.join(input.outputRoot, 'receipt.json');
              await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
                mode: 0o600,
              });
              await chmod(receiptPath, 0o600);
              return {
                status: 'published',
                receiptPath,
                receipt: options.mutatePublishedReceipt?.(receipt) ?? receipt,
              };
            },
    },
  );
  return { fixture, result, terminalCalls };
}

void test('full producer -> verifier -> canonical terminal path retains all seven bindings', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-positive-')),
  );
  try {
    const { result, terminalCalls } = await runFixture(parent);
    assert.equal(result.status, 'published');
    assert.equal(terminalCalls, 1);
    assert(result.verification);
    assert.equal(result.verification.assertionBindings.length, 7);
    assert(result.terminal);
    assert.deepEqual(
      result.terminal.assertionBindings.map((binding) => binding.id),
      result.verification.assertionBindings.map((binding) => binding.id),
    );
    assert.equal(result.attempt.nativePassingCases, 0);
    assert.equal(result.attempt.detoxBridgeResult.publicPromotionEligible, false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('published terminal rejects a caller receipt that differs from the protected bytes', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-receipt-mismatch-')),
  );
  try {
    const { result, terminalCalls } = await runFixture(parent, {
      mutatePublishedReceipt: (receipt) => ({ ...receipt, result: 'forged' }),
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.blocker?.code, 'terminal-publication-failed');
    assert.match(result.blocker?.message ?? '', /receipt bytes differ/i);
    assert.equal(terminalCalls, 1);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('one absolute deadline reaches attempt, runtime and terminal staging', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-deadline-')),
  );
  try {
    const deadlineAtMonotonicMs = performance.now() + 600_000;
    let attemptDeadline: number | undefined;
    const lifecycleDeadlines: number[] = [];
    const { result } = await runFixture(parent, {
      deadlineAtMonotonicMs,
      onAttemptDeadline: (value) => {
        attemptDeadline = value;
      },
      onLifecycleDeadline: (value) => {
        lifecycleDeadlines.push(value);
      },
    });
    assert.equal(result.status, 'published');
    assert.equal(attemptDeadline, deadlineAtMonotonicMs);
    assert(lifecycleDeadlines.length >= 2);
    assert(lifecycleDeadlines.every((value) => value === deadlineAtMonotonicMs));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('actual producer receipt writer feeds the default verifier path without a loader seam', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-producer-')),
  );
  try {
    const qualified = await makeQualifiedBuildRepository(parent);
    const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
    const baseAttempt = attemptForFixture(fixture);
    const runtime = await produceDetoxRuntimeFactsFromActualProducer({
      repositoryRoot: qualified.repositoryRoot,
      captureRoot: fixture.captureRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      build: baseAttempt.detoxBuild,
      bridgeResult: fixture.bridgeResult,
      attempt: baseAttempt,
      ...producerLifecycle(),
    });
    assert(runtime, 'producer must publish facts only after rereading original receipts');
    let terminalCalls = 0;
    const result = await runIosDetoxConnectionRuntimeForCanonicalTerminal(
      {
        repositoryRoot: qualified.repositoryRoot,
        serverRoot: SERVER_ROOT,
        artifactRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        requestedRunId: RUN_ID,
        requestedAttemptId: `${RUN_ID}:first`,
        selection,
        signal: new AbortController().signal,
        deadlineMs: 600_000,
        buildRunId: RUN_ID,
      },
      {
        runAttempt: () => Promise.resolve({ ...baseAttempt, detoxRuntimeFacts: runtime }),
        publishTerminal: async (input) => {
          terminalCalls += 1;
          const receipt = makeReceipt(input);
          const receiptPath = path.join(input.outputRoot, 'receipt.json');
          await mkdir(input.outputRoot, { recursive: true, mode: 0o700 });
          await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
          await chmod(receiptPath, 0o600);
          return { status: 'published', receiptPath, receipt };
        },
      },
    );
    assert.equal(result.status, 'published');
    assert.equal(terminalCalls, 1);
    assert(result.runtime);
    assert.equal(result.runtime.source.dispatchRuntimeInputsHash, validSourceHash);
    assert.equal(result.runtime.build.environmentHash, baseAttempt.detoxBuild.environmentHash);
    assert.deepEqual(result.runtime.build.toolVersions, baseAttempt.detoxBuild.toolVersions);
    assert.equal(result.runtime.build.toolVersionEvidence.packageName, 'detox');
    assert.match(
      result.runtime.build.toolVersionEvidence.realpath,
      /node_modules\/detox\/package\.json$/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('outer native-pilot route reuses the producer attempt and leaves one terminal writer to the caller', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-outer-route-')),
  );
  try {
    const qualified = await makeQualifiedBuildRepository(parent);
    const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
    const baseAttempt = attemptForFixture(fixture);
    const runtime = await runtimeFactsForFixture(fixture, parent);
    const result = await runIosDetoxConnectionRuntimeForOuterTerminal({
      attempt: { ...baseAttempt, detoxRuntimeFacts: runtime },
      repositoryRoot: qualified.repositoryRoot,
      serverRoot: SERVER_ROOT,
      outputRoot: fixture.outputRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      signal: new AbortController().signal,
      deadlineMs: 600_000,
      deadlineAtMonotonicMs: performance.now() + 600_000,
      buildRunId: RUN_ID,
    });
    assert.equal(result.status, 'verified-private');
    assert.equal(result.terminal, null);
    assert(result.verification);
    assert.equal(result.verification.assertionBindings.length, 7);
    assert.equal(result.attempt.detoxRuntimeFacts, runtime);
    assert.equal(result.attempt.nativePassingCases, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('outer publisher writes one verified Detox terminal and rereads its bytes', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-outer-publish-')),
  );
  try {
    const qualified = await makeQualifiedBuildRepository(parent);
    const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
    const baseAttempt = attemptForFixture(fixture);
    const runtime = await runtimeFactsForFixture(fixture, parent);
    const dispatch = await runIosDetoxConnectionRuntimeForOuterTerminal({
      attempt: { ...baseAttempt, detoxRuntimeFacts: runtime },
      repositoryRoot: qualified.repositoryRoot,
      serverRoot: SERVER_ROOT,
      outputRoot: fixture.outputRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      signal: new AbortController().signal,
      deadlineMs: 600_000,
      deadlineAtMonotonicMs: performance.now() + 600_000,
      buildRunId: RUN_ID,
    });
    assert.equal(dispatch.status, 'verified-private');
    const receipt = makeReceipt({
      repositoryRoot: qualified.repositoryRoot,
      outputRoot: fixture.outputRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      build: dispatch.attempt.detoxBuild,
      bridgeResult: dispatch.attempt.detoxBridgeResult,
      attempt: dispatch.attempt,
      runtime: dispatch.runtime!,
      verification: dispatch.verification!,
      lifecycle: {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() + 600_000,
        now: () => performance.now(),
      },
    });
    let publisherCalls = 0;
    const publication = await publishVerifiedIosDetoxConnectionRuntimeForOuterTerminal({
      dispatch,
      receipt,
      outputRoot: fixture.outputRoot,
      selection,
      namespaceIdentity: await namespaceIdentityForRoot(fixture.outputRoot),
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 600_000,
      publishTerminal: async (input) => {
        publisherCalls += 1;
        const receiptPath = path.join(input.root, 'receipt.json');
        await mkdir(input.root, { recursive: true, mode: 0o700 });
        await writeFile(receiptPath, `${JSON.stringify(input.receipt, null, 2)}\n`, {
          mode: 0o600,
        });
        await chmod(receiptPath, 0o600);
        return {
          status: 'published',
          receiptPath,
          recoveryRecordPath: null,
          error: null,
        };
      },
    });
    assert.equal(publication.status, 'published');
    assert.equal(publisherCalls, 1);
    const collectorInputs = await readNativeComparisonReceipts([
      path.join(fixture.outputRoot, 'receipt.json'),
    ]);
    assert.equal(collectorInputs.length, 1);
    assert.equal(collectorInputs[0]?.terminalPublicationBinding?.status, 'published');
    assert.equal(dispatch.attempt.nativePassingCases, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('outer publisher refuses an expired original deadline before writing', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-outer-publish-expired-')),
  );
  try {
    const qualified = await makeQualifiedBuildRepository(parent);
    const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
    const baseAttempt = attemptForFixture(fixture);
    const runtime = await runtimeFactsForFixture(fixture, parent);
    const dispatch = await runIosDetoxConnectionRuntimeForOuterTerminal({
      attempt: { ...baseAttempt, detoxRuntimeFacts: runtime },
      repositoryRoot: qualified.repositoryRoot,
      serverRoot: SERVER_ROOT,
      outputRoot: fixture.outputRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      signal: new AbortController().signal,
      deadlineMs: 600_000,
      deadlineAtMonotonicMs: performance.now() + 600_000,
      buildRunId: RUN_ID,
    });
    const receipt = makeReceipt({
      repositoryRoot: qualified.repositoryRoot,
      outputRoot: fixture.outputRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      build: dispatch.attempt.detoxBuild,
      bridgeResult: dispatch.attempt.detoxBridgeResult,
      attempt: dispatch.attempt,
      runtime: dispatch.runtime!,
      verification: dispatch.verification!,
      lifecycle: {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() + 600_000,
        now: () => performance.now(),
      },
    });
    let publisherCalls = 0;
    const publication = await publishVerifiedIosDetoxConnectionRuntimeForOuterTerminal({
      dispatch,
      receipt,
      outputRoot: fixture.outputRoot,
      selection,
      namespaceIdentity: await namespaceIdentityForRoot(fixture.outputRoot),
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() - 1,
      publishTerminal: () => {
        publisherCalls += 1;
        return Promise.reject(new Error('publisher must not run after the original deadline'));
      },
    });
    assert.equal(publication.status, 'unverified');
    assert.match(publication.error?.message ?? '', /deadline elapsed/i);
    assert.equal(publisherCalls, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('blocked Detox terminal rows use the generic writer and remain collector-ineligible', async () => {
  const state = await makeOuterPublicationFixture('detox-runtime-outer-publish-blocked-');
  try {
    assert.equal(
      shouldUseVerifiedIosDetoxTerminalPublisher({
        dispatchStatus: state.dispatch.status,
        receiptResult: 'passed',
      }),
      true,
    );
    assert.equal(
      shouldUseVerifiedIosDetoxTerminalPublisher({
        dispatchStatus: state.dispatch.status,
        receiptResult: 'harness-blocked',
      }),
      false,
    );
    const repositoryEvidence = {
      status: 'partial',
      missing: ['server'],
      reason: 'server identity unavailable in this controlled branch',
    } as const;
    const blockedReceipt = {
      ...state.receipt,
      result: state.receipt.result as string,
      exitCode: state.receipt.exitCode as number,
      assertions: state.receipt.assertions as unknown[],
      blocker: state.receipt.blocker,
      repositoryEvidence,
    };
    markNativePilotReceiptBlockedForRepositoryEvidence(blockedReceipt, repositoryEvidence);
    assert.throws(
      () =>
        markNativePilotReceiptBlockedForRepositoryEvidence(blockedReceipt, {
          status: 'observed',
          missing: [],
          reason: null,
        }),
      /Observed repository evidence/,
    );
    const publication = await writeNativePilotTerminalReceipt({
      root: state.fixture.outputRoot,
      receipt: blockedReceipt,
      namespaceIdentity: state.namespaceIdentity,
      callerSignal: state.signal.signal,
      recoveryDeadlineMs: 5_000,
    });
    assert.equal(publication.status, 'published');
    const persisted = JSON.parse(
      await readFile(path.join(state.fixture.outputRoot, 'receipt.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(persisted.result, 'harness-blocked');
    assert.deepEqual(persisted.repositoryEvidence, repositoryEvidence);
    await assert.rejects(
      readNativeComparisonReceipts([path.join(state.fixture.outputRoot, 'receipt.json')]),
      /terminal publication binding/,
    );
  } finally {
    await rm(state.parent, { recursive: true, force: true });
  }
});

void test('outer publisher rejects a late abort after the writer returns published', async () => {
  const state = await makeOuterPublicationFixture('detox-runtime-outer-publish-late-abort-');
  try {
    let publisherCalls = 0;
    const publication = await publishVerifiedIosDetoxConnectionRuntimeForOuterTerminal({
      dispatch: state.dispatch,
      receipt: state.receipt,
      outputRoot: state.fixture.outputRoot,
      selection,
      namespaceIdentity: state.namespaceIdentity,
      signal: state.signal.signal,
      deadlineAtMonotonicMs: performance.now() + 600_000,
      publishTerminal: async (input) => {
        publisherCalls += 1;
        const receiptPath = path.join(input.root, 'receipt.json');
        await mkdir(input.root, { recursive: true, mode: 0o700 });
        await writeFile(receiptPath, `${JSON.stringify(input.receipt, null, 2)}\n`, {
          mode: 0o600,
        });
        await chmod(receiptPath, 0o600);
        await new Promise((resolve) => setTimeout(resolve, 25));
        state.signal.abort(new Error('late outer cancellation'));
        return {
          status: 'published',
          receiptPath,
          recoveryRecordPath: null,
          error: null,
        };
      },
    });
    assert.equal(publication.status, 'unverified');
    assert.match(publication.error?.message ?? '', /cancelled during publisher completion/i);
    assert.equal(publisherCalls, 1);
    await assert.rejects(
      readNativeComparisonReceipts([path.join(state.fixture.outputRoot, 'receipt.json')]),
      /terminal publication binding/i,
    );
  } finally {
    await rm(state.parent, { recursive: true, force: true });
  }
});

void test('outer publisher rejects a deadline crossed by a delayed writer', async () => {
  const state = await makeOuterPublicationFixture('detox-runtime-outer-publish-late-deadline-');
  try {
    const deadlineAtMonotonicMs = performance.now() + 250;
    let publisherCalls = 0;
    const publication = await publishVerifiedIosDetoxConnectionRuntimeForOuterTerminal({
      dispatch: state.dispatch,
      receipt: state.receipt,
      outputRoot: state.fixture.outputRoot,
      selection,
      namespaceIdentity: state.namespaceIdentity,
      signal: state.signal.signal,
      deadlineAtMonotonicMs,
      publishTerminal: async (input) => {
        publisherCalls += 1;
        const receiptPath = path.join(input.root, 'receipt.json');
        await mkdir(input.root, { recursive: true, mode: 0o700 });
        await writeFile(receiptPath, `${JSON.stringify(input.receipt, null, 2)}\n`, {
          mode: 0o600,
        });
        await chmod(receiptPath, 0o600);
        const remainingMs = Math.max(0, deadlineAtMonotonicMs - performance.now() + 25);
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
        return {
          status: 'published',
          receiptPath,
          recoveryRecordPath: null,
          error: null,
        };
      },
    });
    assert.equal(publication.status, 'unverified');
    assert.match(publication.error?.message ?? '', /deadline elapsed during publisher completion/i);
    assert.equal(publisherCalls, 1);
    await assert.rejects(
      readNativeComparisonReceipts([path.join(state.fixture.outputRoot, 'receipt.json')]),
      /terminal publication binding/i,
    );
  } finally {
    await rm(state.parent, { recursive: true, force: true });
  }
});

void test('producer refuses a receipt set with a missing owned reset original', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-reset-negative-')),
  );
  try {
    const qualified = await makeQualifiedBuildRepository(parent);
    const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
    await rm(path.join(fixture.captureRoot, 'detox-reset-original.private.json'));
    const baseAttempt = attemptForFixture(fixture);
    const runtime = await produceDetoxRuntimeFactsFromActualProducer({
      repositoryRoot: qualified.repositoryRoot,
      captureRoot: fixture.captureRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      build: baseAttempt.detoxBuild,
      bridgeResult: fixture.bridgeResult,
      attempt: baseAttempt,
      ...producerLifecycle(),
    });
    assert.equal(runtime, null);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('producer rereads driver-owned originals and never recreates missing originals', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-derived-')),
  );
  try {
    const qualified = await makeQualifiedBuildRepository(parent);
    const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
    const report = fixture.bridgeResult.attempt.report as Record<string, unknown>;
    delete report.detoxRuntimeOriginalReceiptSet;
    const baseAttempt = attemptForFixture(fixture);
    const runtime = await produceDetoxRuntimeFactsFromActualProducer({
      repositoryRoot: qualified.repositoryRoot,
      captureRoot: fixture.captureRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      build: baseAttempt.detoxBuild,
      bridgeResult: fixture.bridgeResult,
      attempt: baseAttempt,
      ...producerLifecycle(),
    });
    assert(runtime, 'driver-shaped report must produce a bound runtime envelope');
    assert.equal(runtime.reset.targetDeviceId, 'fixture-ios-device');
    assert.equal(runtime.target.osVersion, 'iOS fixture');
    assert.equal(runtime.source.dispatchRuntimeInputsHash, validSourceHash);
    const missingOriginal = path.join(fixture.captureRoot, 'detox-source-original.private.json');
    await rm(missingOriginal);
    const missing = await produceDetoxRuntimeFactsFromActualProducer({
      repositoryRoot: qualified.repositoryRoot,
      captureRoot: fixture.captureRoot,
      requestedRunId: RUN_ID,
      requestedAttemptId: `${RUN_ID}:first`,
      selection,
      build: baseAttempt.detoxBuild,
      bridgeResult: fixture.bridgeResult,
      attempt: baseAttempt,
      ...producerLifecycle(),
    });
    assert.equal(missing, null);
    await assert.rejects(readFile(missingOriginal), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('producer rejects a reset receipt that is not bound to the owned target marker', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-reset-binding-negative-')),
  );
  try {
    const qualified = await makeQualifiedBuildRepository(parent);
    const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
    const report = fixture.bridgeResult.attempt.report as Record<string, unknown>;
    delete report.detoxRuntimeOriginalReceiptSet;
    const resetPath = path.join(fixture.captureRoot, 'detox-reset-original.private.json');
    const reset = JSON.parse(await readFile(resetPath, 'utf8')) as Record<string, unknown>;
    reset.ownerSha256 = '0'.repeat(64);
    await writeFile(resetPath, `${JSON.stringify(reset)}\n`, { mode: 0o600 });
    const baseAttempt = attemptForFixture(fixture);
    await assert.rejects(
      produceDetoxRuntimeFactsFromActualProducer({
        repositoryRoot: qualified.repositoryRoot,
        captureRoot: fixture.captureRoot,
        requestedRunId: RUN_ID,
        requestedAttemptId: `${RUN_ID}:first`,
        selection,
        build: baseAttempt.detoxBuild,
        bridgeResult: fixture.bridgeResult,
        attempt: baseAttempt,
        ...producerLifecycle(),
      }),
      /Expected values|owner|reset/i,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('absent runtime envelope stays source-only and never reaches the terminal writer', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-absent-')),
  );
  try {
    const { result, terminalCalls } = await runFixture(parent, {
      runtime: null,
    });
    assert.equal(result.status, 'source-only');
    assert.equal(result.blocker?.code, 'runtime-facts-unavailable');
    assert.equal(result.verification, null);
    assert.equal(terminalCalls, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('verified private runtime remains pending when the canonical terminal boundary is absent', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-dispatch-terminal-')),
  );
  try {
    const { result, terminalCalls } = await runFixture(parent, {
      publish: false,
    });
    assert.equal(result.status, 'verified-private');
    assert.equal(result.blocker?.code, 'terminal-boundary-unavailable');
    assert(result.verification);
    assert.equal(result.verification.assertionBindings.length, 7);
    assert.equal(terminalCalls, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('cancelled, failed-cleanup and retry attempts are rejected before runtime loading', async () => {
  const cases: Partial<DetoxNativePilotAttemptResult>[] = [
    {
      captureResult: 'cancelled',
      captureExitCode: 143,
      childExitCode: null,
      childClassification: 'cancelled',
      captureCleanup: {
        status: 'failed-recovery-retained',
        resources: ['child'],
      },
      externalCleanupResult: 'failed',
      verificationResult: 'not-executed',
      cancellation: 'SIGTERM',
      captureCompleted: false,
      captureInvocation: { count: 1, returned: false },
      detoxBridgeResult: undefined as never,
    },
    {
      externalCleanupResult: 'failed',
      captureCleanup: {
        status: 'failed-recovery-retained',
        resources: ['child'],
      },
      verificationResult: 'not-executed',
      detoxBridgeResult: undefined as never,
    },
    {
      requestedAttemptId: `${RUN_ID}:retry`,
      detoxBridgeResult: undefined as never,
    },
  ];
  for (const [index, override] of cases.entries()) {
    const parent = await realpath(
      await mkdtemp(path.join(os.tmpdir(), `detox-runtime-dispatch-terminal-negative-${index}-`)),
    );
    try {
      const qualified = await makeQualifiedBuildRepository(parent);
      const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
      const patch = {
        ...override,
        detoxBridgeResult:
          override.detoxBridgeResult === undefined
            ? {
                ...fixture.bridgeResult,
                requestedAttemptId:
                  override.requestedAttemptId ?? fixture.bridgeResult.requestedAttemptId,
                attempt: override.requestedAttemptId
                  ? {
                      ...fixture.bridgeResult.attempt,
                      status: 'blocked' as const,
                    }
                  : override.externalCleanupResult === 'failed'
                    ? {
                        ...fixture.bridgeResult.attempt,
                        cleanup: 'failed' as const,
                        recoveryStatus: 'not-verified' as const,
                      }
                    : {
                        ...fixture.bridgeResult.attempt,
                        status: 'cancelled' as const,
                        cleanup: 'failed' as const,
                        recoveryStatus: 'not-verified' as const,
                      },
              }
            : override.detoxBridgeResult,
      } satisfies Partial<DetoxNativePilotAttemptResult>;
      let loaderCalls = 0;
      let terminalCalls = 0;
      const result = await runIosDetoxConnectionRuntimeForCanonicalTerminal(
        {
          repositoryRoot: qualified.repositoryRoot,
          serverRoot: SERVER_ROOT,
          artifactRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: RUN_ID,
          requestedAttemptId: patch.requestedAttemptId ?? `${RUN_ID}:first`,
          selection,
          signal: new AbortController().signal,
          deadlineMs: 600_000,
          buildRunId: RUN_ID,
        },
        {
          runAttempt: () => Promise.resolve(attemptForFixture(fixture, patch)),
          loadRuntime: async () => {
            loaderCalls += 1;
            return runtimeFactsForFixture(fixture, parent);
          },
          publishTerminal: () => {
            terminalCalls += 1;
            return Promise.reject(new Error('must not publish a rejected attempt'));
          },
        },
      );
      assert.equal(result.status, 'blocked');
      assert.equal(loaderCalls, 0);
      assert.equal(terminalCalls, 0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
});

const runtimeMutationCases: {
  name: string;
  mutate: (runtime: DetoxIosConnectionRuntimeFacts) => DetoxIosConnectionRuntimeFacts;
}[] = [
  {
    name: 'source',
    mutate: (runtime) => ({
      ...runtime,
      source: { ...runtime.source, sourceTreeHash: '0'.repeat(64) },
    }),
  },
  {
    name: 'build',
    mutate: (runtime) => ({
      ...runtime,
      build: { ...runtime.build, binaryHash: '0'.repeat(64) },
    }),
  },
  {
    name: 'sql',
    mutate: (runtime) => ({
      ...runtime,
      sql: { ...runtime.sql, isolationUnchanged: false as true },
    }),
  },
  {
    name: 'ui',
    mutate: (runtime) => ({
      ...runtime,
      ui: {
        ...runtime.ui,
        assertions: runtime.ui.assertions.map((row, index) =>
          index === 0 ? { ...row, id: 'NAT-connection-forged' as never } : row,
        ),
      },
    }),
  },
  {
    name: 'transport',
    mutate: (runtime) => ({
      ...runtime,
      transport: {
        ...runtime.transport,
        windows: runtime.transport.windows.map((row, index) =>
          index === 0 ? { ...row, status: 500 } : row,
        ),
      },
    }),
  },
  {
    name: 'cleanup',
    mutate: (runtime) => ({
      ...runtime,
      cleanup: { ...runtime.cleanup, recoveryStatus: 'blocked' },
    }),
  },
];

for (const mutation of runtimeMutationCases) {
  void test(`runtime verifier rejects ${mutation.name} drift before terminal publication`, async () => {
    const parent = await realpath(
      await mkdtemp(path.join(os.tmpdir(), `detox-runtime-dispatch-${mutation.name}-`)),
    );
    try {
      const qualified = await makeQualifiedBuildRepository(parent);
      const fixture = await makeCompleteCapture(await fixtureArtifactParent(parent), qualified);
      const runtime = mutation.mutate(await runtimeFactsForFixture(fixture, parent));
      let terminalCalls = 0;
      const result = await runIosDetoxConnectionRuntimeForCanonicalTerminal(
        {
          repositoryRoot: qualified.repositoryRoot,
          serverRoot: SERVER_ROOT,
          artifactRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: RUN_ID,
          requestedAttemptId: `${RUN_ID}:first`,
          selection,
          signal: new AbortController().signal,
          deadlineMs: 600_000,
          buildRunId: RUN_ID,
        },
        {
          runAttempt: () => Promise.resolve(attemptForFixture(fixture)),
          loadRuntime: () => Promise.resolve(runtime),
          publishTerminal: () => {
            terminalCalls += 1;
            throw new Error('must not publish forged runtime facts');
          },
        },
      );
      assert.equal(result.status, 'blocked');
      assert.equal(result.blocker?.code, 'runtime-verification-failed');
      assert.equal(terminalCalls, 0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}

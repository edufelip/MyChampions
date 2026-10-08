import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  androidSessionPublicAssertionIds,
  androidSessionPublicSelection,
  androidSessionPublicUiObservationContract,
  type AndroidSessionPublicDependencyResult,
} from '../../scripts/testing/native-android-session-public-contract';
import {
  androidSessionCaptureResultConsistent,
  androidSessionAttemptMustRemainBlocked,
  runAndroidSessionAttempt,
  type AndroidSessionRuntimeDependencies,
} from '../../scripts/testing/run-android-session-attempt';
import type { OwnedAndroidNativeSessionResult } from '../../scripts/testing/capture-android-testability';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const repositoryRoot = path.resolve(process.cwd());
const id = (letter: string) => letter.repeat(24);

/**
 * Keep unit fixtures independent from the repository's live inventory. The
 * production selector still validates the declaration and all source hashes;
 * these tests exercise the runner after selection has already been injected.
 */
function selection(): Promise<NativePilotSelection> {
  return Promise.resolve({
    arguments: { ...androidSessionPublicSelection },
    scenario: {
      id: 'SCN-session-android',
      platform: 'android',
      engine: 'maestro',
      flowId: 'FLW-session',
      transitionIds: [],
      requirementRefs: [],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:SCN-session-android:fresh-attempt',
      freshnessInputs: { requirementPaths: [] },
    },
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
  });
}

function successfulCommand() {
  return {
    label: 'android-session-synthetic-command',
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    deadlineMs: 30_000,
    censusFailure: null,
    outputFailure: null,
  };
}

function successfulCleanup() {
  return {
    result: 'passed',
    // Independent cleanup is keyed by the capture run (artifact root id('a')).
    runId: id('a'),
    censusStatus: 'available',
    captureResult: 'observed',
    captureCleanupClean: true,
    cacheAbsent: true,
    survivors: [],
    unknownProcessQueries: [],
    missingForeignDevices: [],
    androidCleanupReceipt: {
      path: 'external-cleanup.private.json',
      sizeBytes: 1,
      sha256: 'f'.repeat(64),
      ownerUid: process.getuid?.() ?? 501,
      mode: 0o600,
      verification: 'owned-stable-reader-v6',
    },
  };
}

const sessionPhases = [
  'before-login',
  'after-login',
  'after-restoration',
  'after-signed-out-relaunch',
] as const;

function completeSessionFileSet() {
  return {
    framePaths: androidSessionPublicUiObservationContract.flatMap(({ label }) => [
      `${label}-hierarchy.stdout`,
      `${label}-hierarchy.json`,
      `${label}.png`,
    ]),
    profilePaths: sessionPhases.map(
      (phase) => `android-session-checkpoints/${phase}/profile.private.json`,
    ),
    domainPaths: sessionPhases.map(
      (phase) => `android-session-checkpoints/${phase}/domain.private.json`,
    ),
    transportPath: 'transport-observations.private.json',
    nativeAuthIdentitiesPath: 'native-auth-identities.private.json',
    sqlPaths: [
      'sql/before/database.private.json',
      'sql/before/query.private.json',
      'sql/before/query-source.private.json',
      'sql/after/database.private.json',
      'sql/after/query.private.json',
      'sql/after/query-source.private.json',
      'sql/cancel/database.private.json',
      'sql/cancel/query.private.json',
      'sql/cancel/query-source.private.json',
    ],
  } as const;
}

function successfulReport(captureRunId: string): Record<string, unknown> {
  const backendRunId = id('b');
  const apiOrigin = 'http://127.0.0.1:41001';
  const proxyOrigin = 'http://127.0.0.1:41003';
  return {
    kind: 'private-owned-native-session-execution-not-public-receipt',
    mode: 'integration',
    platform: 'android',
    charter: 'session-account',
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    captureRunId,
    source: { sourceTreeHash: 'a'.repeat(64) },
    sourceAfter: { sourceTreeHash: 'a'.repeat(64) },
    helperInputsBefore: [
      { path: 'scripts/testing/capture-android-testability.ts', sha256: 'c'.repeat(64) },
    ],
    helperInputsAfter: [
      { path: 'scripts/testing/capture-android-testability.ts', sha256: 'c'.repeat(64) },
    ],
    build: {
      appId: 'com.edufelip.mychampions.dev',
      binaryHash: 'd'.repeat(64),
      environmentHash: 'e'.repeat(64),
      apiOrigin: proxyOrigin,
      profile: 'dev-debug',
    },
    proxyOrigin,
    device: { serial: 'emulator-5554', osVersion: '37', runId: captureRunId },
    backend: {
      runId: backendRunId,
      backendAttemptId: `${backendRunId}:first`,
      apiOrigin,
      apiProcess: {
        pid: 41002,
        started: 'Thu Oct 2 04:00:00 2026',
        script: 'server/scripts/serve.ts',
      },
    },
    fixtureHash: 'f'.repeat(64),
    toolVersions: { node: process.version, maestro: '2.6.1' },
    timingsMs: { build: 1, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 },
    commandExecutions: [successfulCommand()],
    observations: [],
    androidSessionCheckpointReceipts: [],
    androidSessionCheckpointArtifacts: {},
    androidSessionProfileCache: {},
    androidSessionStorage: {},
    androidSessionAuthIdentity: {
      targetOrigin: apiOrigin,
      apiPid: 41002,
      backendAttemptId: `${backendRunId}:first`,
    },
    androidSessionRestoreTransport: {},
    androidSessionSignedOutTransport: {},
    androidSessionCancelStorage: {},
    androidSessionCancelIdentity: {},
    androidSessionDomain: { status: 'verified' },
    androidSessionProfileCheckpoint: { status: 'verified' },
    androidSessionCharter: { status: 'verified' },
    androidSessionAuthEvidence: {
      status: 'available',
      transportReceipt: {},
      nativeAuthIdentitiesReceipt: {},
    },
    androidSessionTerminalQualification: { status: 'verified', blockers: [] },
    nativeSessionContract: { status: 'verified', serverRevocationQualified: false },
  };
}

function captureFixture(
  captureRoot: string,
  report = successfulReport(path.basename(captureRoot)),
): OwnedAndroidNativeSessionResult {
  return { artifactRoot: captureRoot, exitCode: 0, report };
}

function dependencyFixture(
  captureRunId: string,
  _selectionValue: Awaited<ReturnType<typeof selection>>,
): AndroidSessionPublicDependencyResult & { selection: typeof androidSessionPublicSelection } {
  return {
    kind: 'private-android-session-public-dependency-not-public-receipt',
    status: 'validated-source-only',
    platform: 'android',
    engine: 'maestro',
    charter: 'session-account',
    assertionIds: [...androidSessionPublicAssertionIds],
    captureRunId,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    serverRevocationQualified: false,
    cleanup: 'cleaned',
    files: completeSessionFileSet(),
    verification: {
      profileCheckpointStatus: 'verified',
      signInRequestId: 1,
      restorationHydrateRequestId: 2,
      signedOutRequestCount: 1,
      coachAuthUidHash: 'a'.repeat(64),
      fixtureAuthUidAllowlistHash: 'b'.repeat(64),
    },
    selection: androidSessionPublicSelection,
  };
}

async function withRoots<T>(
  callback: (roots: { captureRoot: string; outputRoot: string }) => Promise<T>,
): Promise<T> {
  const parent = await mkdtemp(
    path.join(await realpath(os.tmpdir()), 'android-session-runner-candidate-'),
  );
  const captureRoot = path.join(parent, id('a'));
  const outputRoot = path.join(parent, id('b'));
  await mkdir(captureRoot, { recursive: true, mode: 0o700 });
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  try {
    return await callback({ captureRoot, outputRoot });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

function dependencies(
  capture: OwnedAndroidNativeSessionResult,
  current: Awaited<ReturnType<typeof selection>>,
  overrides: Partial<AndroidSessionRuntimeDependencies> = {},
): AndroidSessionRuntimeDependencies {
  const dependency = dependencyFixture(path.basename(capture.artifactRoot), current);
  return {
    capture: () => Promise.resolve(capture),
    select: (_repositoryRoot, value) => Promise.resolve(value),
    cleanup: () => Promise.resolve(successfulCleanup()),
    load: () => Promise.resolve({ ...dependency }),
    stage: () =>
      Promise.resolve({
        copyManifest: {
          path: `evidence/${id('a')}/copy-manifest.private.json`,
          sha256: 'c'.repeat(64),
        },
        artifacts: [],
        assertionIds: [...androidSessionPublicAssertionIds],
        nativePassingCases: 0 as const,
        publicPassingCases: 0 as const,
        publicPromotionEligible: false as const,
        selectionBinding: {
          arguments: current.arguments,
          scenario: current.scenario,
          scenarioHash: current.scenarioHash,
          requirementHash: current.requirementHash,
          assertionIds: [...androidSessionPublicAssertionIds],
        },
      }),
    verifyStage: () => Promise.resolve(),
    ...overrides,
  };
}

void test('Android session runner performs one capture, strict cleanup, source-only load and optional staging', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot, outputRoot }) => {
    let captures = 0;
    let cleanups = 0;
    let loads = 0;
    let stages = 0;
    let verifies = 0;
    const result = await runAndroidSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: id('d'),
        selection: current,
        signal: new AbortController().signal,
        outputRoot,
      },
      dependencies(captureFixture(captureRoot), current, {
        capture: (input) => {
          captures++;
          return Promise.resolve(captureFixture(captureRoot));
        },
        cleanup: () => {
          cleanups++;
          return Promise.resolve(successfulCleanup());
        },
        load: () => {
          loads++;
          return Promise.resolve(dependencyFixture(path.basename(captureRoot), current));
        },
        stage: () => {
          stages++;
          return Promise.resolve({
            copyManifest: {
              path: `evidence/${path.basename(captureRoot)}/copy-manifest.private.json`,
              sha256: 'c'.repeat(64),
            },
            artifacts: [],
            assertionIds: [...androidSessionPublicAssertionIds],
            nativePassingCases: 0 as const,
            publicPassingCases: 0 as const,
            publicPromotionEligible: false as const,
            selectionBinding: {
              arguments: current.arguments,
              scenario: current.scenario,
              scenarioHash: current.scenarioHash,
              requirementHash: current.requirementHash,
              assertionIds: [...androidSessionPublicAssertionIds],
            },
          });
        },
        verifyStage: () => {
          verifies++;
          return Promise.resolve();
        },
      }),
    );
    assert.equal(captures, 1);
    assert.equal(cleanups, 1);
    assert.equal(loads, 1);
    assert.equal(stages, 1);
    assert.equal(verifies, 1);
    assert.equal(result.captureCompleted, true);
    assert.equal(result.externalCleanupResult, 'passed');
    assert.equal(result.verificationResult, 'source-only');
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.equal(androidSessionAttemptMustRemainBlocked(result), true);
    assert.equal(androidSessionCaptureResultConsistent(result), true);
    await readFile(path.join(captureRoot, 'android-session-runtime-adapter.private.json'));
  });
});

void test('Android session runner blocks before loading when independent cleanup fails', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot }) => {
    let loads = 0;
    const result = await runAndroidSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: id('e'),
        selection: current,
        signal: new AbortController().signal,
      },
      dependencies(captureFixture(captureRoot), current, {
        cleanup: () => Promise.resolve({ result: 'failed', censusStatus: 'recovery-retained' }),
        load: () => {
          loads++;
          return Promise.reject(new Error('loader must not run after cleanup failure'));
        },
      }),
    );
    assert.equal(loads, 0);
    assert.equal(result.externalCleanupResult, 'failed');
    assert.equal(result.verificationResult, 'not-executed');
    assert.equal(result.postCaptureFailure?.phase, 'cleanup');
    assert.equal(result.postCaptureFailure?.artifactPath, 'external-cleanup.private.json');
    assert.equal(result.postCaptureFailure?.cleanupResult, 'failed');
    assert.equal(result.postCaptureFailure?.cleanupCensusStatus, 'recovery-retained');
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('Android session runner blocks when final selection hashes change after capture', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot, outputRoot }) => {
    let selections = 0;
    let stages = 0;
    const result = await runAndroidSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: id('7'),
        selection: current,
        signal: new AbortController().signal,
        outputRoot,
      },
      dependencies(captureFixture(captureRoot), current, {
        select: (_root, value) => {
          selections++;
          return Promise.resolve(
            selections === 3 ? { ...value, scenarioHash: 'c'.repeat(64) } : value,
          );
        },
        stage: () => {
          stages++;
          return Promise.reject(new Error('staging must not run after final selection drift'));
        },
      }),
    );
    assert.equal(selections, 3);
    assert.equal(stages, 0);
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.verificationFailure?.phase, 'verification');
    assert.match(result.verificationFailure?.message ?? '', /selection changed|Expected values/);
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('Android session runner retains cleanup when selection changes after capture', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot }) => {
    let selections = 0;
    let cleanups = 0;
    const result = await runAndroidSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: id('8'),
        selection: current,
        signal: new AbortController().signal,
      },
      dependencies(captureFixture(captureRoot), current, {
        select: (_root, value) => {
          selections++;
          return Promise.resolve(
            selections === 2 ? { ...value, requirementHash: 'd'.repeat(64) } : value,
          );
        },
        cleanup: () => {
          cleanups++;
          return Promise.resolve(successfulCleanup());
        },
        load: () => Promise.reject(new Error('loader must not run after capture selection drift')),
      }),
    );
    assert.equal(selections, 2);
    assert.equal(cleanups, 1);
    assert.equal(result.externalCleanupResult, 'passed');
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.verificationFailure?.phase, 'verification');
    assert.match(result.verificationFailure?.message ?? '', /selection changed|Expected values/);
  });
});

void test('Android session runner rejects stale build identity before consumer loading', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot }) => {
    let loads = 0;
    const report = successfulReport(path.basename(captureRoot));
    (report.build as Record<string, unknown>).binaryHash = 'invalid';
    const result = await runAndroidSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: id('f'),
        selection: current,
        signal: new AbortController().signal,
      },
      dependencies(captureFixture(captureRoot, report), current, {
        load: () => {
          loads++;
          return Promise.reject(new Error('loader must not run after stale build'));
        },
      }),
    );
    assert.equal(loads, 0);
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.verificationFailure?.phase, 'verification');
    assert.match(result.verificationFailure?.message ?? '', /hash|invalid/i);
  });
});

void test('Android session runner preserves stage verification failure as blocked', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot, outputRoot }) => {
    const result = await runAndroidSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: id('1'),
        selection: current,
        signal: new AbortController().signal,
        outputRoot,
      },
      dependencies(captureFixture(captureRoot), current, {
        verifyStage: () => Promise.reject(new Error('staged Android bytes changed')),
      }),
    );
    assert.equal(result.dependencyStatus, 'validated-source-only');
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.postCaptureFailure?.phase, 'verification');
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('Android session runner blocks late selection drift after source staging', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot, outputRoot }) => {
    let selections = 0;
    let stages = 0;
    const result = await runAndroidSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: id('4'),
        selection: current,
        signal: new AbortController().signal,
        outputRoot,
      },
      dependencies(captureFixture(captureRoot), current, {
        select: (_root, value) => {
          selections++;
          return Promise.resolve(
            selections === 4 ? { ...value, scenarioHash: 'e'.repeat(64) } : value,
          );
        },
        stage: () => {
          stages++;
          return Promise.resolve({
            copyManifest: {
              path: `evidence/${id('a')}/copy-manifest.private.json`,
              sha256: 'c'.repeat(64),
            },
            artifacts: [],
            assertionIds: [...androidSessionPublicAssertionIds],
            nativePassingCases: 0 as const,
            publicPassingCases: 0 as const,
            publicPromotionEligible: false as const,
            selectionBinding: {
              arguments: current.arguments,
              scenario: current.scenario,
              scenarioHash: current.scenarioHash,
              requirementHash: current.requirementHash,
              assertionIds: [...androidSessionPublicAssertionIds],
            },
          });
        },
      }),
    );
    assert.equal(selections, 4);
    assert.equal(stages, 1);
    assert.equal(result.staged !== null, true);
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.verificationFailure?.phase, 'verification');
    assert.match(result.verificationFailure?.message ?? '', /source staging|Expected values/);
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('Android session runner blocks a late abort before adapter publication', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot, outputRoot }) => {
    const controller = new AbortController();
    const result = await runAndroidSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: id('5'),
        selection: current,
        signal: controller.signal,
        outputRoot,
      },
      dependencies(captureFixture(captureRoot), current, {
        verifyStage: () => {
          controller.abort('late-stage-abort');
          return Promise.resolve();
        },
      }),
    );
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.postCaptureFailure?.phase, 'verification');
    assert.equal(result.publicPromotionEligible, false);
    await assert.rejects(
      readFile(path.join(captureRoot, 'android-session-runtime-adapter.private.json')),
      /ENOENT/,
    );
  });
});

void test('Android session runner rejects changed selection and pre-acquisition cancellation', async () => {
  const current = await selection();
  await withRoots(async ({ captureRoot }) => {
    let captures = 0;
    const altered = { ...current, scenarioHash: 'f'.repeat(64) };
    await assert.rejects(
      runAndroidSessionAttempt(
        {
          repositoryRoot,
          requestedRunId: id('2'),
          selection: altered,
          signal: new AbortController().signal,
        },
        dependencies(captureFixture(captureRoot), current, {
          select: () => Promise.resolve(current),
          capture: () => {
            captures++;
            return Promise.resolve(captureFixture(captureRoot));
          },
        }),
      ),
      /selection changed|Expected values/,
    );
    assert.equal(captures, 0);
    const controller = new AbortController();
    controller.abort('SIGTERM');
    await assert.rejects(
      runAndroidSessionAttempt(
        { repositoryRoot, requestedRunId: id('3'), selection: current, signal: controller.signal },
        dependencies(captureFixture(captureRoot), current, {
          capture: () => {
            captures++;
            return Promise.resolve(captureFixture(captureRoot));
          },
        }),
      ),
      /aborted|SIGTERM/i,
    );
    assert.equal(captures, 0);
  });
});

void test('Android session capture tuple validator rejects forged completion facts', () => {
  const valid = {
    captureInvocation: { count: 1, returned: true, exitCode: 0, result: 'observed' },
    captureExitCode: 0,
    captureResult: 'observed',
    captureCleanup: 'cleaned',
    captureCompleted: true,
  };
  assert.equal(androidSessionCaptureResultConsistent(valid), true);
  assert.equal(androidSessionCaptureResultConsistent({ ...valid, captureCompleted: false }), false);
  assert.equal(
    androidSessionCaptureResultConsistent({
      ...valid,
      captureInvocation: { ...valid.captureInvocation, exitCode: 2 },
    }),
    false,
  );
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sourceIdentity } from '../../scripts/testing/native-build-identity';
import {
  nativeSessionAssertionIds,
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';
import { readNativeSessionHelperInputs } from '../../scripts/testing/native-session-helper-ledger';
import {
  isIosSessionCaptureResultConsistent,
  runIosSessionAttempt,
  sessionAttemptMustRemainBlocked,
  type SessionRuntimeDependencies,
} from '../../scripts/testing/run-ios-session-attempt';
import type { OwnedIosNativeSessionResult } from '../../scripts/testing/capture-native-testability';
import type { NativeSessionPublicDependencyResult } from '../../scripts/testing/native-session-public-dependency';
import type { NativeSessionStageResult } from '../../scripts/testing/native-session-public-staging';

const repositoryRoot = process.env.MYCHAMPIONS_QUALIFIED_ROOT ?? path.resolve(__dirname, '../..');
const id = (character: string) => character.repeat(24);
const hash = (character: string) => character.repeat(64);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const postTapFlowPath = 'session-signout-post-tap.yaml';
const postTapHierarchyPath = 'session-signout-post-tap-hierarchy.json';
const postTapScreenshotPath = 'session-signout-post-tap.png';
const postTapFlowBytes = Buffer.from(
  'appId: com.example.mychampions\nname: Native inventory session-signout-post-tap\n---\n' +
    '- scrollUntilVisible:\n' +
    '    element:\n' +
    '      id: settings.account.signOutCta\n' +
    '    direction: DOWN\n' +
    '    timeout: 30000\n' +
    '- tapOn:\n' +
    '    id: settings.account.signOutCta\n',
);
const postTapHierarchyBytes = Buffer.from(
  JSON.stringify({
    attributes: { 'resource-id': 'settings.account.screen' },
    children: [
      { attributes: { 'resource-id': 'settings.account.signOutCta' }, children: [] },
      { attributes: { 'resource-id': 'settings.account.signOutConfirm' }, children: [] },
      { attributes: { 'resource-id': 'settings.account.signOutConfirmCta' }, children: [] },
    ],
  }),
);
const postTapScreenshotBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const postTapDiagnostic = {
  label: 'session-signout-post-tap',
  flowPath: postTapFlowPath,
  flowBytes: postTapFlowBytes.length,
  flowHash: sha256(postTapFlowBytes),
  hierarchyPath: postTapHierarchyPath,
  hierarchyBytes: postTapHierarchyBytes.length,
  hierarchyHash: sha256(postTapHierarchyBytes),
  screenshotPath: postTapScreenshotPath,
  screenshotBytes: postTapScreenshotBytes.length,
  screenshotHash: sha256(postTapScreenshotBytes),
  selectorPresence: {
    accountScreen: true,
    signOutCta: true,
    signOutConfirm: true,
    signOutConfirmCta: true,
  },
};

type CommandPatch = Partial<{
  execution:
    | 'completed'
    | 'child-failed'
    | 'deadline'
    | 'cancelled'
    | 'output-limit'
    | 'output-failed'
    | 'harness-blocked';
  cleanup: 'not-acquired' | 'cleaned' | 'failed-recovery-ledger-retained' | 'unknown';
  childExitCode: number | null;
  childSignal: string | null;
}>;

function command(patch: CommandPatch = {}) {
  return {
    label: 'session-step',
    phase: 'step' as const,
    execution: 'completed' as const,
    cleanup: 'cleaned' as const,
    childExitCode: 0,
    childSignal: null,
    deadlineMs: 60_000,
    censusFailure: null,
    outputFailure: null,
    ...patch,
  };
}

function captureFixture(
  artifactRoot: string,
  patch: {
    exitCode?: number;
    result?: string;
    cleanup?: string;
    cancellation?: string;
    command?: CommandPatch;
  } = {},
): OwnedIosNativeSessionResult {
  return {
    artifactRoot,
    exitCode: patch.exitCode ?? 0,
    report: {
      result: patch.result ?? 'observed',
      cleanup: patch.cleanup ?? 'cleaned',
      commandExecutions: [command(patch.command)],
      ...(patch.cancellation ? { cancellation: patch.cancellation } : {}),
      backend: { runId: id('d') },
      build: { environmentHash: hash('e') },
      fixtureHash: hash('f'),
      toolVersions: { node: 'test-fixture' },
      timingsMs: { build: 1, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 },
    },
  };
}

const actualSessionLabels = [
  'entry',
  'password-save-prompt',
  'coach-home',
  'restored-home',
  'account',
  'restored-identity',
  'signout-confirm',
  'cancel-signout',
  'signout-reopen',
  'signout-confirmed',
  'signed-out-relaunch',
] as const;

function actualSessionCaptureFixture(artifactRoot: string): OwnedIosNativeSessionResult {
  const frames = actualSessionLabels.map((label) => ({
    label,
    screenshotPath: label + '.png',
    hierarchyPath: label + '-hierarchy.json',
  }));
  return {
    artifactRoot,
    exitCode: 0,
    report: {
      kind: 'private-native-inventory-observation-not-behavior-attempt',
      mode: 'inventory',
      platform: 'ios',
      charter: 'session',
      result: 'observed',
      cleanup: 'cleaned',
      captureRunId: path.basename(artifactRoot),
      commandExecutions: [command()],
      backend: { runId: id('d') },
      build: {
        bundleId: 'com.example.mychampions',
        profile: 'development',
        binaryHash: hash('b'),
        apiOrigin: 'http://127.0.0.1:43123',
        environmentHash: hash('e'),
      },
      device: { udid: 'ios-device', runtime: 'iOS 18.0' },
      fixtureHash: hash('f'),
      toolVersions: { node: 'test-fixture' },
      timingsMs: { build: 1, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 },
      nativePassingCases: 0,
      sessionEvidencePublication: 'complete',
      sessionAssertionSequence: [...nativeSessionAssertionIds],
      sessionUiObservationOrder: [...actualSessionLabels],
      sessionViewEvidence: frames,
      nativeAuthIdentityEvidence: { path: 'native-auth-identities.private.json' },
      transportEvidence: { path: 'transport-observations.private.json' },
      sessionSqlBefore: { path: 'session-sql-before.private.json' },
      sessionSqlAfterSignedoutRelaunch: {
        path: 'session-sql-after-signed-out-relaunch.private.json',
      },
      sessionProfileSnapshots: {},
      sessionDomainSnapshots: {
        beforeLogin: { path: 'session-domain-before-login.private.json' },
      },
      sessionTerminalTransportDiagnostics: {
        terminalTransport: { path: 'transport-terminal.private.json' },
        terminalAuth: { path: 'native-auth-terminal.private.json' },
      },
      sessionSignOutPostTapDiagnostic: postTapDiagnostic,
      sessionSqlBeforeAfterUnchanged: true,
      nativeLogoutContract: {
        scope: 'local-native-session-clear',
        serverRevocationQualified: false,
      },
    },
  };
}

async function hydrateActualSessionEvidence(
  captureRoot: string,
  capture: OwnedIosNativeSessionResult,
): Promise<void> {
  const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const evidence = Buffer.from('original-evidence');
  const receipt = (filePath: string) => ({
    path: filePath,
    bytes: evidence.length,
    sha256: sha256(evidence),
  });
  const report = capture.report;
  const nativeAuthReceipt = receipt('native-auth-identities.private.json');
  report.nativeAuthIdentityEvidence = nativeAuthReceipt;
  report.transportEvidence = receipt('transport-observations.private.json');
  report.sessionSqlBefore = receipt('session-sql-before.private.json');
  report.sessionSqlAfterSignedoutRelaunch = receipt(
    'session-sql-after-signed-out-relaunch.private.json',
  );
  report.sessionDomainSnapshots = {
    beforeLogin: receipt('session-domain-before-login.private.json'),
  };
  report.sessionTerminalTransportDiagnostics = {
    terminalTransport: receipt('transport-terminal.private.json'),
    terminalAuth: receipt('native-auth-terminal.private.json'),
  };
  report.sessionViewEvidence = (report.sessionViewEvidence as Record<string, unknown>[]).map(
    (frame) => ({
      ...frame,
      screenshotHash: sha256(evidence),
      hierarchyHash: sha256(evidence),
    }),
  );
  // Read back one receipt through the same filesystem path used by the real
  // validator so this fixture cannot pass with a detached in-memory hash.
  assert.equal(
    sha256(await readFile(path.join(captureRoot, 'native-auth-identities.private.json'))),
    nativeAuthReceipt.sha256,
  );
}

function actualSessionDependencyFixture(
  selection: NativePilotSelection,
  captureRunId: string,
): NativeSessionPublicDependencyResult & { selection: NativePilotSelection } {
  return {
    ...dependencyFixture(selection, captureRunId),
    files: {
      framePaths: actualSessionLabels.flatMap((label) => [
        label + '.png',
        label + '-hierarchy.json',
      ]),
      startupDiagnosticFramePath: 'launched.png',
      profilePaths: [],
      domainPaths: ['session-domain-before-login.private.json'],
      transportPath: 'transport-observations.private.json',
      terminalTransportPath: 'transport-terminal.private.json',
      postTapDiagnosticPaths: [postTapFlowPath, postTapHierarchyPath, postTapScreenshotPath],
    },
  };
}

async function writeActualSessionEvidence(captureRoot: string): Promise<void> {
  const paths = [
    ...actualSessionLabels.flatMap((label) => [label + '.png', label + '-hierarchy.json']),
    postTapFlowPath,
    postTapHierarchyPath,
    postTapScreenshotPath,
    'launched.png',
    'session-domain-before-login.private.json',
    'transport-observations.private.json',
    'transport-terminal.private.json',
    'native-auth-terminal.private.json',
    'native-auth-identities.private.json',
    'session-sql-before.private.json',
    'session-sql-after-signed-out-relaunch.private.json',
  ];
  for (const relativePath of paths) {
    const bytes =
      relativePath === postTapFlowPath
        ? postTapFlowBytes
        : relativePath === postTapHierarchyPath
          ? postTapHierarchyBytes
          : relativePath === postTapScreenshotPath
            ? postTapScreenshotBytes
            : Buffer.from('original-evidence');
    await writeFile(path.join(captureRoot, relativePath), bytes, { flag: 'wx', mode: 0o600 });
  }
}

async function writeActualSessionSidecars(
  captureRoot: string,
  capture: OwnedIosNativeSessionResult,
): Promise<void> {
  await writeFile(path.join(captureRoot, 'capture.private.json'), JSON.stringify(capture.report), {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(
    path.join(captureRoot, 'external-cleanup.private.json'),
    JSON.stringify({
      kind: 'private-owned-session-cleanup',
      result: 'passed',
      runId: capture.report.captureRunId,
      captureResult: 'observed',
      captureCleanupClean: true,
      survivors: [],
      unknownProcessQueries: [],
      missingForeignDevices: [],
      ownedDeviceAbsent: true,
      cacheAbsent: true,
    }),
    { flag: 'wx', mode: 0o600 },
  );
}

function dependencyFixture(
  selection: NativePilotSelection,
  captureRunId: string,
): NativeSessionPublicDependencyResult & { selection: NativePilotSelection } {
  return {
    kind: 'private-ios-session-public-dependency-not-public-receipt',
    status: 'validated-source-only',
    charter: 'session',
    assertionIds: [...nativeSessionAssertionIds],
    captureRunId,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    serverRevocationQualified: false,
    cleanup: 'cleaned',
    files: {
      framePaths: [],
      startupDiagnosticFramePath: 'launched.png',
      profilePaths: [],
      domainPaths: [],
      transportPath: 'transport-observations.private.json',
      terminalTransportPath: 'terminal-transport.private.json',
    },
    verification: {
      profileCheckpointStatus: 'verified',
      signInRequestId: 1,
      restorationHydrateRequestId: 2,
      signedOutRequestCount: 1,
      coachAuthUidHash: hash('a'),
    },
    selection,
  };
}

function stageFixture(): NativeSessionStageResult {
  return {
    copyManifest: {
      path: `evidence/${id('a')}/copy-manifest.private.json`,
      sha256: hash('b'),
    },
    artifacts: [`evidence/${id('a')}/copy-manifest.private.json`],
    assertionIds: [...nativeSessionAssertionIds],
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
  };
}

async function sessionSelection(): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  return selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-session-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
}

async function withRoots<T>(
  callback: (roots: { captureRoot: string; outputRoot: string }) => Promise<T>,
) {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ios-session-attempt-v4-')));
  const captureRoot = path.join(parent, id('a'));
  const outputRoot = path.join(parent, id('b'));
  await mkdir(captureRoot, { mode: 0o700 });
  await mkdir(outputRoot, { mode: 0o700 });
  await chmod(captureRoot, 0o700);
  await chmod(outputRoot, 0o700);
  try {
    return await callback({ captureRoot, outputRoot });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

function fakeDependencies(
  capture: OwnedIosNativeSessionResult,
  selection: NativePilotSelection,
  overrides: Partial<SessionRuntimeDependencies> = {},
): SessionRuntimeDependencies {
  const dependency = dependencyFixture(selection, path.basename(capture.artifactRoot));
  const staged = stageFixture();
  return {
    capture: () => Promise.resolve(capture),
    cleanup: () => Promise.resolve({ result: 'passed' }),
    load: () => Promise.resolve(dependency),
    stage: () => Promise.resolve(staged),
    verifyStage: () => Promise.resolve(),
    ...overrides,
  } as unknown as SessionRuntimeDependencies;
}

async function runScenario(
  selection: NativePilotSelection,
  capture: OwnedIosNativeSessionResult,
  overrides: Partial<SessionRuntimeDependencies> = {},
  outputRoot?: string,
) {
  return runIosSessionAttempt(
    {
      repositoryRoot,
      requestedRunId: id('c'),
      selection,
      signal: new AbortController().signal,
      ...(outputRoot ? { outputRoot } : {}),
    },
    fakeDependencies(capture, selection, overrides),
  );
}

void test('session adapter wires a complete producer-shaped capture to finalization input', async () => {
  const selection = await sessionSelection();
  await withRoots(async ({ captureRoot, outputRoot }) => {
    await writeActualSessionEvidence(captureRoot);
    const capture = actualSessionCaptureFixture(captureRoot);
    capture.report.source = await sourceIdentity(repositoryRoot);
    capture.report.sourceAfter = capture.report.source;
    capture.report.helperInputsBefore = await readNativeSessionHelperInputs(repositoryRoot);
    capture.report.helperInputsAfter = capture.report.helperInputsBefore;
    await hydrateActualSessionEvidence(captureRoot, capture);
    await writeActualSessionSidecars(captureRoot, capture);
    const dependency = actualSessionDependencyFixture(selection, path.basename(captureRoot));
    const result = await runIosSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: path.basename(outputRoot),
        selection,
        signal: new AbortController().signal,
        outputRoot,
      },
      fakeDependencies(capture, selection, {
        load: () => Promise.resolve(dependency),
      }),
    );
    assert.equal(result.verificationResult, 'source-only');
    assert.equal(result.publicFinalization?.publicPromotionEligible, true);
    assert.equal(result.publicFinalization?.publicPassingCases, nativeSessionAssertionIds.length);
    assert(result.publicFinalizationInput);
    assert.equal(result.publicFinalizationInput.candidate?.publicPromotionEligible, true);
    assert.equal(result.publicPromotionEligible, false);
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPassingCases, 0);
  });
});

void test('session adapter retires a candidate when its publication sidecar cannot be created', async () => {
  const selection = await sessionSelection();
  await withRoots(async ({ captureRoot, outputRoot }) => {
    await writeActualSessionEvidence(captureRoot);
    await writeFile(path.join(captureRoot, 'session-runtime-adapter.private.json'), 'occupied', {
      flag: 'wx',
      mode: 0o600,
    });
    const capture = actualSessionCaptureFixture(captureRoot);
    capture.report.source = await sourceIdentity(repositoryRoot);
    capture.report.sourceAfter = capture.report.source;
    capture.report.helperInputsBefore = await readNativeSessionHelperInputs(repositoryRoot);
    capture.report.helperInputsAfter = capture.report.helperInputsBefore;
    await hydrateActualSessionEvidence(captureRoot, capture);
    await writeActualSessionSidecars(captureRoot, capture);
    const dependency = actualSessionDependencyFixture(selection, path.basename(captureRoot));
    const result = await runIosSessionAttempt(
      {
        repositoryRoot,
        requestedRunId: path.basename(outputRoot),
        selection,
        signal: new AbortController().signal,
        outputRoot,
      },
      fakeDependencies(capture, selection, {
        load: () => Promise.resolve(dependency),
      }),
    );
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.postCaptureFailure?.phase, 'adapter-write');
    assert.equal(result.publicFinalization, null);
    assert.equal(result.publicFinalizationInput, null);
  });
});

void test('session adapter reports one returned outer capture and no callback on terminal capture failure', async () => {
  const selection = await sessionSelection();
  await withRoots(async ({ captureRoot }) => {
    const result = await runScenario(
      selection,
      captureFixture(captureRoot, {
        exitCode: 2,
        result: 'harness-blocked',
        cleanup: 'not-acquired',
        command: { execution: 'harness-blocked', cleanup: 'not-acquired', childExitCode: null },
      }),
    );
    assert.deepEqual(result.captureInvocation, {
      count: 1,
      returned: true,
      exitCode: 2,
      result: 'harness-blocked',
    });
    assert.equal(result.captureCompleted, false);
    assert.equal('callbackInvocations' in result, false);
    assert.equal('callbackCompleted' in result, false);
    assert.equal(result.verificationResult, 'not-executed');
    assert.equal(result.dependencyStatus, 'not-executed');
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('session adapter preserves cancellation without loading or staging', async () => {
  const selection = await sessionSelection();
  let loadCalls = 0;
  let stageCalls = 0;
  await withRoots(async ({ captureRoot }) => {
    const result = await runScenario(
      selection,
      captureFixture(captureRoot, {
        exitCode: 143,
        result: 'cancelled',
        cleanup: 'cleaned',
        cancellation: 'SIGTERM',
        command: { execution: 'cancelled', childExitCode: null, childSignal: 'SIGTERM' },
      }),
      {
        load: () => {
          loadCalls += 1;
          return Promise.reject(new Error('loader must not run after cancellation'));
        },
        stage: () => {
          stageCalls += 1;
          return Promise.reject(new Error('stage must not run after cancellation'));
        },
      },
    );
    assert.equal(result.captureInvocation.exitCode, 143);
    assert.equal(result.captureInvocation.result, 'cancelled');
    assert.equal(result.captureCompleted, false);
    assert.equal(result.cancellation, 'SIGTERM');
    assert.equal(result.childClassification, 'cancelled');
    assert.equal(result.verificationResult, 'not-executed');
    assert.equal(loadCalls, 0);
    assert.equal(stageCalls, 0);
  });
});

void test('session adapter blocks independently failed cleanup before dependency loading', async () => {
  const selection = await sessionSelection();
  let loadCalls = 0;
  await withRoots(async ({ captureRoot }) => {
    const result = await runScenario(selection, captureFixture(captureRoot), {
      cleanup: () => Promise.reject(new Error('owned cleanup failed')),
      load: () => {
        loadCalls += 1;
        return Promise.reject(new Error('loader must not run after cleanup failure'));
      },
    });
    assert.equal(result.captureCompleted, true);
    assert.equal(result.externalCleanupResult, 'failed');
    assert.equal(result.verificationResult, 'not-executed');
    assert.equal(result.postCaptureFailure?.phase, 'cleanup');
    assert.equal(loadCalls, 0);
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('session adapter retains loader rejection as blocked verification', async () => {
  const selection = await sessionSelection();
  let stageCalls = 0;
  await withRoots(async ({ captureRoot }) => {
    const result = await runScenario(selection, captureFixture(captureRoot), {
      load: () => Promise.reject(new Error('dependency loader rejected capture')),
      stage: () => {
        stageCalls += 1;
        return Promise.reject(new Error('stage must not run after loader rejection'));
      },
    });
    assert.equal(result.captureCompleted, true);
    assert.equal(result.externalCleanupResult, 'passed');
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.dependencyStatus, 'not-executed');
    assert.equal(result.postCaptureFailure?.phase, 'verification');
    assert.equal(stageCalls, 0);
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('session adapter retains a returned blocked loader status as verification failure', async () => {
  const selection = await sessionSelection();
  await withRoots(async ({ captureRoot }) => {
    const result = await runScenario(selection, captureFixture(captureRoot), {
      load: () =>
        Promise.resolve({
          kind: 'private-ios-session-public-dependency-loader' as const,
          status: 'blocked' as const,
          captureRoot,
          captureRunId: path.basename(captureRoot),
          nativePassingCases: 0 as const,
          publicPassingCases: 0 as const,
          publicPromotionEligible: false as const,
          missing: ['tampered source identity'],
          files: [],
        }),
    });
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.dependencyStatus, 'blocked');
    assert.equal(result.verificationFailure?.name, 'Error');
    assert.equal(result.postCaptureFailure?.phase, 'verification');
    assert.match(result.postCaptureFailure?.message ?? '', /returned blocked/);
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('session adapter blocks stage verification tamper after a validated source-only dependency', async () => {
  const selection = await sessionSelection();
  let verifyCalls = 0;
  await withRoots(async ({ captureRoot, outputRoot }) => {
    const result = await runScenario(
      selection,
      captureFixture(captureRoot),
      {
        verifyStage: () => {
          verifyCalls += 1;
          return Promise.reject(new Error('staged byte changed during verification'));
        },
      },
      outputRoot,
    );
    assert.equal(result.captureCompleted, true);
    assert.equal(result.dependencyStatus, 'validated-source-only');
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.postCaptureFailure?.phase, 'verification');
    assert.ok(result.staged);
    assert.equal(verifyCalls, 1);
    assert.equal(sessionAttemptMustRemainBlocked(result), false);
    assert.equal(result.publicPromotionEligible, false);
  });
});

void test('session adapter stages a complete source-only dependency while remaining non-promotable', async () => {
  const selection = await sessionSelection();
  let stageCalls = 0;
  let verifyCalls = 0;
  await withRoots(async ({ captureRoot, outputRoot }) => {
    const result = await runScenario(
      selection,
      captureFixture(captureRoot),
      {
        stage: () => {
          stageCalls += 1;
          return Promise.resolve(stageFixture());
        },
        verifyStage: () => {
          verifyCalls += 1;
          return Promise.resolve();
        },
      },
      outputRoot,
    );
    assert.equal(result.captureInvocation.count, 1);
    assert.equal(result.captureInvocation.returned, true);
    assert.equal(result.captureCompleted, true);
    assert.equal(result.verificationResult, 'source-only');
    assert.equal(result.dependencyStatus, 'validated-source-only');
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.equal(result.publicDependency?.status, 'validated-source-only');
    assert.equal(result.publicFinalization, null);
    assert.equal(sessionAttemptMustRemainBlocked(result), true);
    assert.equal(stageCalls, 1);
    assert.equal(verifyCalls, 1);
  });
});

void test('session outer-capture tuple rejects mismatched return and completion facts', async () => {
  const selection = await sessionSelection();
  await withRoots(async ({ captureRoot, outputRoot }) => {
    const result = await runScenario(selection, captureFixture(captureRoot), {}, outputRoot);
    assert.equal(isIosSessionCaptureResultConsistent(result), true);
    assert.equal(
      isIosSessionCaptureResultConsistent({
        ...result,
        captureInvocation: { ...result.captureInvocation, exitCode: 2 },
      }),
      false,
    );
    assert.equal(
      isIosSessionCaptureResultConsistent({
        ...result,
        captureInvocation: { ...result.captureInvocation, result: 'harness-blocked' },
      }),
      false,
    );
    assert.equal(
      isIosSessionCaptureResultConsistent({
        ...result,
        captureCompleted: !result.captureCompleted,
      }),
      false,
    );
  });
});

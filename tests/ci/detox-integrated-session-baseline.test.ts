import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  requireDetoxBuildInstrumentation,
  requireDetoxIosAuthMetadataBinding,
  requireDetoxPhaseCheckpoints,
  requireDetoxTerminalPhaseWindow,
  requireDetoxTransportEvidence,
  requireSessionStepResult,
  requireUnchangedQualifiedBuild,
  classifyDetoxChildExecution,
  classifyDetoxOperationResult,
  requireDetoxAndroidProducerBeforeAcquisition,
  requireDetoxFinalCaptureQualification,
  runDetoxIntegratedSessionBaseline,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselineFactories,
  detoxSessionHelperClosure,
} from '../../scripts/testing/detox-integrated-session-baseline';
import {
  projectAndroidSessionCacheCheckpoint,
  requireDetoxNativeSessionCache,
} from '../../scripts/testing/detox-session-cache-observation';
import { parseDetoxHierarchyXml } from '../../scripts/testing/detox-session-cancel-evidence';
import { stopAndReadFinalTransport } from '../../scripts/testing/detox-session-final-transport';
import {
  parseAndroidSessionStorageObservation,
  requireAndroidSessionCheckpointSet,
  requireAndroidSessionDomainBinding,
} from '../../scripts/testing/native-android-session-adapter';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../scripts/testing/owned-api-proxy';

const repositoryRoot = path.resolve(process.cwd());
const artifactParent = path.join(repositoryRoot, '.qa/artifacts/native-pilot');
const serverRoot = path.join(repositoryRoot, '..', 'server');
const apiOrigin = 'http://127.0.0.1:41001';
const appOrigin = 'http://127.0.0.1:41002';
const runId = '0123456789abcdef01234567';
const cancelHierarchy =
  '<ViewHierarchy><Node resource-id="settings.account.screen" /></ViewHierarchy>';
const cancelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const androidSessionKeyHash = 'a'.repeat(64);
const androidPresentQuery = JSON.stringify([
  {
    jsonValid: 1,
    profileType: 'object',
    profileAuthUid: 'coach-1',
    expiryType: 'text',
    accessTokenType: null,
    refreshTokenType: null,
    recordBytes: 192,
  },
]);
const androidPresentXml =
  '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n' +
  '<map><string name="key_v1-secure.auth.server.session">encrypted-value</string></map>';

const androidFileReceipt = (
  filePath: string,
  kind: 'database' | 'sidecar' | 'query' | 'xml' | 'listing',
  sizeBytes: number,
  sha256: string,
) => ({
  path: filePath,
  kind,
  sizeBytes,
  sha256,
  ownerUid: 501,
  mode: 0o600,
  verification: 'owned-stable-reader-v6' as const,
});

function androidStorageCheckpoint() {
  const observation = parseAndroidSessionStorageObservation({
    database: 'present',
    sqliteJson: androidPresentQuery,
    securePreferences: 'present',
    secureStoreXml: androidPresentXml,
    sessionKeyHash: androidSessionKeyHash,
  });
  return {
    ...observation,
    coherence: {
      basePresent: true,
      sidecars: [] as const,
      orphanSidecars: [] as const,
      rollbackJournals: [] as const,
    },
    privateArtifacts: {
      database: androidFileReceipt(
        'auth-before-relaunch-async-storage.db',
        'database',
        128,
        'b'.repeat(64),
      ),
      databaseSidecars: [],
      query: androidFileReceipt(
        'auth-before-relaunch-async-storage-query.json',
        'query',
        32,
        'c'.repeat(64),
      ),
      querySource: {
        path: 'auth-before-relaunch-async-storage-query.raw.private',
        kind: 'query' as const,
        sizeBytes: 48,
        sha256: 'a'.repeat(64),
        ownerUid: 501,
        mode: 0o600,
        retained: false as const,
        databaseSha256: 'b'.repeat(64),
        databaseSidecarSha256: [],
        verification: 'owned-query-source-v6' as const,
      },
      secureStore: androidFileReceipt(
        'auth-before-relaunch-secure-store.xml',
        'xml',
        64,
        'f'.repeat(64),
      ),
      databaseListing: androidFileReceipt(
        'auth-before-relaunch-async-directory.stdout',
        'listing',
        10,
        'd'.repeat(64),
      ),
      secureStoreListing: androidFileReceipt(
        'auth-before-relaunch-secure-presence.stdout',
        'listing',
        10,
        'e'.repeat(64),
      ),
    },
  };
}

function androidDomainSnapshot() {
  return {
    schemaVersion: 1 as const,
    runId: runId,
    scope: 'native-entry-android',
    readOnly: true as const,
    trainingPlans: [{ id: 'plan-1' }],
    connections: [{ id: 'connection-1' }],
  };
}

function build(platform: 'ios' | 'android' = 'ios'): DetoxBaselineBuildInstrumentation {
  return {
    platform,
    configuration: platform === 'ios' ? 'ios.sim.debug' : 'android.emu.debug',
    binaryPath:
      platform === 'ios'
        ? path.join(
            repositoryRoot,
            'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app',
          )
        : path.join(repositoryRoot, 'android/app/build/outputs/apk/dev/debug/app-dev-debug.apk'),
    binaryHash: 'a'.repeat(64),
    testBinaryPath:
      platform === 'android'
        ? path.join(
            repositoryRoot,
            'android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
          )
        : null,
    testBinaryHash: platform === 'android' ? 'f'.repeat(64) : null,
    source: { sha: 'b'.repeat(40), dirty: true, sourceTreeHash: 'c'.repeat(64) },
    helperInputPaths: [...detoxSessionHelperClosure],
    helperInputsHash: 'd'.repeat(64),
    detoxConfigPath: path.join(repositoryRoot, '.detoxrc.js'),
    detoxConfigHash: 'e'.repeat(64),
    metroPort: 41003,
    appIdentifier: 'com.edufelip.mychampions.dev',
    embeddedRuntime: {
      variant: 'dev',
      appIdentifier: 'com.edufelip.mychampions.dev',
      apiOrigin,
      configSourcePath: path.join(repositoryRoot, 'app.config.ts'),
      configSourceHash: '1'.repeat(64),
    },
  };
}

function fixtures() {
  const account = (name: string, role: 'student' | 'professional') => ({
    email: `${name}@example.test`,
    password: `${name}-secret`,
    authUid: `uid-${name}`,
    role,
  });
  return {
    runId,
    scope: 'native-entry-ios',
    accounts: {
      new: { ...account('new', 'student'), role: null },
      student: account('student', 'student'),
      coach: account('coach', 'professional'),
      'unrelated-student': account('other-student', 'student'),
      'unrelated-coach': account('other-coach', 'professional'),
      'pending-student': account('pending', 'student'),
      'active-student': account('active', 'student'),
    },
    pendingConnectionId: 'pending-connection',
    activeConnectionId: 'active-connection',
    savedPlanId: 'saved-plan',
    draft: { name: 'draft', sessions: [] },
  };
}

function snapshot() {
  return {
    schemaVersion: 1 as const,
    runId,
    scope: 'native-entry-ios',
    readOnly: true as const,
    trainingPlans: [],
    connections: [],
  };
}

function connectionSnapshot(coachTime = '2026-10-01T00:00:00.000Z') {
  const accounts = Object.values(fixtures().accounts).sort((left, right) =>
    left.authUid.localeCompare(right.authUid),
  );
  const rows = {
    userProfiles: accounts.map((account) => ({
      authUid: account.authUid,
      lockedRole: account.role,
      acceptedTermsVersion: 'v1',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: account.authUid === 'uid-coach' ? coachTime : '2026-10-01T00:00:00.000Z',
    })),
    professionalSpecialties: [],
    inviteCodes: [],
    connections: [],
    connectionInviteGuards: [],
    pendingStudents: [],
    pendingStudentSlots: [],
    trackingAccess: [],
    activeSpecialties: [],
  };
  return {
    schemaVersion: 1 as const,
    kind: 'connection-snapshot-v1' as const,
    runId,
    scope: 'native-entry-ios',
    readOnly: true as const,
    fixtureAuthUids: accounts.map((account) => account.authUid),
    target: {
      professionalAuthUid: 'uid-coach',
      studentAuthUid: 'uid-student',
      specialty: 'fitness_coach' as const,
    },
    rowCounts: Object.fromEntries(
      Object.entries(rows).map(([name, values]) => [name, values.length]),
    ),
    rows,
  };
}

function allowlistHash() {
  const values = Object.values(fixtures().accounts)
    .map((account) => account.authUid)
    .sort();
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function authObservation() {
  return {
    requestId: 1,
    method: 'POST',
    pathHash: createHash('sha256').update('/auth/email/sign-in').digest('hex'),
    requestOrigin: null,
    requestProfile: 'native' as const,
    targetOrigin: apiOrigin,
    status: 201,
    outcome: 'forwarded' as const,
    requestCredentialPresent: false,
    faultAttemptId: null,
    elapsedMs: 10,
  };
}

function hydrateObservation() {
  return {
    ...authObservation(),
    requestId: 2,
    method: 'POST',
    pathHash: createHash('sha256').update('/me/hydrate').digest('hex'),
    status: 200,
    requestCredentialPresent: true,
  };
}

function authIdentity() {
  return {
    requestId: 1,
    ordinal: 1,
    targetOrigin: apiOrigin,
    apiPid: 9001,
    status: 201,
    authUid: 'uid-coach',
    verification: 'verified' as const,
    verificationReason: 'verified' as const,
    fixtureAuthUidAllowlistHash: allowlistHash(),
  };
}

async function privateArtifact(id: string) {
  const root = path.join(artifactParent, id);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  return root;
}

async function privateRunnerPaths(artifactRoot: string) {
  const root = path.join(artifactRoot, 'runner');
  const entryPath = path.join(root, 'scripts/run-detox-integrated-session-baseline.ts');
  const jestConfigPath = path.join(root, 'e2e/jest.detox-integrated-session-baseline.config.js');
  const testPath = path.join(root, 'e2e/detox-integrated-session-baseline.e2e.test.js');
  await mkdir(path.dirname(entryPath), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(jestConfigPath), { recursive: true, mode: 0o700 });
  await writeFile(
    entryPath,
    'runDetoxIntegratedSessionBaseline SIGINT SIGTERM removeListener DETOX_BASELINE_JEST_CONFIG DETOX_BASELINE_DEADLINE_MS',
    { mode: 0o600 },
  );
  await writeFile(
    jestConfigPath,
    'detox/runners/jest/globalSetup detox/runners/jest/testEnvironment DETOX_BASELINE_TEST_PATH',
    { mode: 0o600 },
  );
  await writeFile(testPath, 'detox-session-progress.private.json confirmationAfterCancel', {
    mode: 0o600,
  });
  return { entryPath, jestConfigPath, testPath, privateCandidate: true as const };
}

async function preparePartialAcquisitionArtifact(id: string) {
  const artifactRoot = await privateArtifact(id);
  const stateRoot = path.join(artifactRoot, 'host-state');
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  await chmod(stateRoot, 0o700);
  await writeFile(path.join(stateRoot, 'mychampions-native-host.lock'), '', { mode: 0o600 });
  return { artifactRoot, stateRoot };
}

function partialAcquisitionFactories(input: {
  artifactRoot: string;
  targetStops: string[];
  releaseCalls: { value: number };
  writer?: (filePath: string, bytes: Buffer) => Promise<void>;
}): DetoxBaselineFactories {
  return {
    reserveOwnedAppPort: () =>
      Promise.resolve({
        port: 41003,
        origin: appOrigin,
        release: () => {
          input.releaseCalls.value += 1;
          return Promise.resolve();
        },
      }),
    startOwnedSession: () => Promise.reject(new Error('session-start-failed')),
    startOwnedApiProxy: () => Promise.reject(new Error('must not start proxy')),
    startOwnedExpo: () => Promise.reject(new Error('must not start Expo')),
    acquireOwnedTarget: () =>
      Promise.resolve({
        platform: 'ios' as const,
        deviceId: 'owned-simulator-1',
        ownership: {
          artifactRoot: input.artifactRoot,
          hostLockRequired: true as const,
          cleanupAuthorized: true as const,
        },
        verify: () => Promise.resolve(),
        stop: () => {
          input.targetStops.push('owned-simulator-1');
          return Promise.resolve();
        },
      }),
    capturePreviousIosDevices: () => Promise.resolve(),
    requireNativeHostAvailability: () => Promise.resolve({ status: 'no-known-job' }),
    verifyIosSimulatorApp: () =>
      Promise.resolve({
        binaryPath: build().binaryPath,
        signingProfile: 'test-seam',
        localApplicationId: 'test-seam',
      }),
    inspectDetoxBuildInstrumentation: ({
      build: observed,
    }: {
      build: DetoxBaselineBuildInstrumentation;
    }) => Promise.resolve(observed),
    verifyAndroidBuild: () => Promise.resolve(),
    verifyOwnedIosCleanup: () => Promise.resolve({ result: 'passed' as const }),
    executeOwnedNativeCommand: () => Promise.reject(new Error('must not execute Detox')),
    ...(input.writer ? { writeTerminalEvidence: input.writer } : {}),
  } as unknown as DetoxBaselineFactories;
}

function stepDocument(platform: 'ios' | 'android' = 'ios') {
  const steps = Object.fromEntries(
    [
      'NAT-session-login',
      'NAT-session-restore',
      'NAT-session-account',
      'NAT-session-signout',
      'NAT-session-signed-out-relaunch',
    ].map((id) => [id, true]),
  );
  return {
    schemaVersion: 2 as const,
    kind: 'private-detox-session-steps' as const,
    platform,
    role: 'professional' as const,
    steps,
    launchCount: 3,
    synchronizationDisabled: true as const,
    events: [
      { stepId: 'NAT-session-login', ordinal: 1, monotonicMs: 1 },
      { stepId: 'NAT-session-restore', ordinal: 2, monotonicMs: 2 },
      { stepId: 'NAT-session-account', ordinal: 3, monotonicMs: 3 },
      {
        stepId: 'NAT-session-signout',
        ordinal: 4,
        monotonicMs: 4,
        confirmationAfterCancel: 'not-visible',
        cancelEvidence: {
          hierarchyFile: 'detox-cancel-after-cancel.private.xml',
          hierarchySha256: createHash('sha256').update(cancelHierarchy).digest('hex'),
          screenshotFile: 'detox-cancel-after-cancel.private.png',
          screenshotSha256: createHash('sha256').update(cancelPng).digest('hex'),
          modalPresent: false,
          accountScreenPresent: true,
        },
      },
      { stepId: 'NAT-session-signed-out-relaunch', ordinal: 5, monotonicMs: 5 },
    ],
  };
}

void test('uses the dev bundle identifier and never treats the iOS scheme as an app identifier', () => {
  const value = build();
  assert.equal(requireDetoxBuildInstrumentation(value, repositoryRoot), value);
  assert.throws(
    () =>
      requireDetoxBuildInstrumentation({ ...value, appIdentifier: 'mychampions' }, repositoryRoot),
    /app identifier/,
  );
  assert.throws(
    () =>
      requireDetoxBuildInstrumentation(
        { ...value, embeddedRuntime: { ...value.embeddedRuntime, appIdentifier: 'mychampions' } },
        repositoryRoot,
      ),
    /app identifier/,
  );
});

void test('requires Android application and instrumentation APK identity separately', () => {
  const value = build('android');
  assert.equal(requireDetoxBuildInstrumentation(value, repositoryRoot), value);
  assert.throws(
    () => requireDetoxBuildInstrumentation({ ...value, testBinaryHash: null }, repositoryRoot),
    /test APK hash/,
  );
  assert.throws(
    () =>
      requireDetoxBuildInstrumentation(
        { ...value, testBinaryPath: value.binaryPath },
        repositoryRoot,
      ),
    /test APK path/,
  );
});

void test('rejects fresh build observations that overwrite a qualified descriptor', () => {
  const value = build();
  assert.equal(requireUnchangedQualifiedBuild(value, value), value);
  assert.throws(
    () => requireUnchangedQualifiedBuild(value, { ...value, binaryHash: '9'.repeat(64) }),
    /binaryHash/,
  );
  assert.throws(
    () =>
      requireUnchangedQualifiedBuild(value, {
        ...value,
        source: { ...value.source, sourceTreeHash: '8'.repeat(64) },
      }),
    /source/,
  );
});

void test('accepts only the complete ordered UI result and cancel evidence', () => {
  assert.equal(requireSessionStepResult(stepDocument()).launchCount, 3);
  assert.throws(
    () =>
      requireSessionStepResult({
        ...stepDocument(),
        steps: { ...stepDocument().steps, extra: true },
      }),
    /assertions are incomplete/,
  );
  assert.throws(
    () => requireSessionStepResult({ ...stepDocument(), launchCount: 4 }),
    /metadata is incomplete/,
  );
});

void test('binds transport to monotonic UI phase windows and rejects missing restore or signed-out boundaries', () => {
  const checkpoints = [
    {
      stepId: 'NAT-session-login',
      ordinal: 1,
      childMonotonicMs: 1,
      parentMonotonicMs: 1,
      requestIdFence: 1,
      observedRequestIds: [1],
    },
    {
      stepId: 'NAT-session-restore',
      ordinal: 2,
      childMonotonicMs: 2,
      parentMonotonicMs: 2,
      requestIdFence: 2,
      observedRequestIds: [2],
    },
    {
      stepId: 'NAT-session-account',
      ordinal: 3,
      childMonotonicMs: 3,
      parentMonotonicMs: 3,
      requestIdFence: 2,
      observedRequestIds: [],
    },
    {
      stepId: 'NAT-session-signout',
      ordinal: 4,
      childMonotonicMs: 4,
      parentMonotonicMs: 4,
      requestIdFence: 2,
      observedRequestIds: [],
    },
    {
      stepId: 'NAT-session-signed-out-relaunch',
      ordinal: 5,
      childMonotonicMs: 5,
      parentMonotonicMs: 5,
      requestIdFence: 2,
      observedRequestIds: [],
    },
  ] as const;
  assert.equal(
    requireDetoxPhaseCheckpoints({
      checkpoints,
      observations: [authObservation(), hydrateObservation()] as never,
    }).length,
    5,
  );
  assert.doesNotThrow(() =>
    requireDetoxTerminalPhaseWindow({
      checkpoints,
      observations: [authObservation(), hydrateObservation()] as never,
    }),
  );
  assert.throws(
    () =>
      requireDetoxPhaseCheckpoints({
        checkpoints: checkpoints.map((checkpoint, index) =>
          index === 1 ? { ...checkpoint, observedRequestIds: [1] } : checkpoint,
        ),
        observations: [authObservation(), hydrateObservation()] as never,
      }),
    /started-request window/,
  );
  assert.throws(
    () =>
      requireDetoxPhaseCheckpoints({
        checkpoints: checkpoints.map((checkpoint, index) =>
          index === 4 ? { ...checkpoint, observedRequestIds: [1, 2, 3] } : checkpoint,
        ),
        observations: [authObservation(), hydrateObservation()] as never,
      }),
    /started-request window/,
  );
  assert.throws(
    () =>
      requireDetoxTerminalPhaseWindow({
        checkpoints,
        observations: [
          authObservation(),
          hydrateObservation(),
          { ...hydrateObservation(), requestId: 3 },
        ] as never,
      }),
    /late transport request/,
  );
});

void test('classifies cancellation and failed cleanup as harness outcomes', () => {
  assert.equal(
    classifyDetoxChildExecution({
      execution: 'cancelled',
      cleanup: 'cleaned',
      childExitCode: null,
      childSignal: null,
    }),
    'harness-blocked',
  );
  assert.equal(
    classifyDetoxChildExecution({
      execution: 'child-failed',
      cleanup: 'cleaned',
      childExitCode: 1,
      childSignal: null,
    }),
    'application-failed',
  );
  assert.equal(
    classifyDetoxChildExecution({
      execution: 'completed',
      cleanup: 'failed-recovery-ledger-retained',
      childExitCode: 0,
      childSignal: null,
    }),
    'harness-blocked',
  );
  assert.equal(
    classifyDetoxOperationResult(
      new Error('checkpoint mismatch'),
      { execution: 'completed', cleanup: 'cleaned', childExitCode: 0, childSignal: null } as never,
      null,
    ),
    'verification-failed',
  );
});

void test('requires the final report and independent cleanup before capture qualification', () => {
  const capture = {
    kind: 'private Detox owned-session capture ledger; not a public receipt',
    fileName: 'capture-final.private.json',
    phase: 'final',
    finalized: true,
    result: 'passed',
    cleanup: 'cleaned',
    independentCleanup: 'passed',
    cleanupFinalLedger: 'cleanup-final.private.json',
  };
  const cleanupFinal = {
    kind: 'private Detox cleanup ledger after stopped-resource drain',
    finalized: true,
    independent: 'passed',
    failures: [],
  };
  const report = {
    kind: 'private-detox-integrated-session-baseline-not-public-receipt',
    result: 'passed',
    failure: null,
    cleanup: { independent: 'passed', failures: [] },
  };
  assert.doesNotThrow(() =>
    requireDetoxFinalCaptureQualification({ capture, cleanupFinal, report }),
  );
  assert.throws(
    () =>
      requireDetoxFinalCaptureQualification({
        capture: { ...capture, phase: 'partial', finalized: false },
        cleanupFinal,
        report,
      }),
    /final independently-cleaned ledger/,
  );
  assert.throws(
    () =>
      requireDetoxFinalCaptureQualification({
        capture,
        cleanupFinal: { ...cleanupFinal, independent: 'failed' },
        report,
      }),
    /cleanup-final ledger is not independently clean/,
  );
});

void test('blocks Android dispatch before any host or resource acquisition', async () => {
  assert.throws(
    () => requireDetoxAndroidProducerBeforeAcquisition('android'),
    (error: unknown) =>
      error instanceof Error &&
      /before acquisition/.test(error.message) &&
      /owned Android session producer/.test(error.message),
  );
  assert.doesNotThrow(() => requireDetoxAndroidProducerBeforeAcquisition('ios'));
  const artifactRoot = await privateArtifact('0123456789abcdef01234574');
  const testRunnerPaths = await privateRunnerPaths(artifactRoot);
  const calls: string[] = [];
  const factories = {
    requireNativeHostAvailability: () => {
      calls.push('host');
      return Promise.reject(new Error('must not acquire host lock'));
    },
    reserveOwnedAppPort: () => {
      calls.push('app-port');
      return Promise.reject(new Error('must not reserve app port'));
    },
    acquireOwnedTarget: () => {
      calls.push('target');
      return Promise.reject(new Error('must not acquire target'));
    },
  } as unknown as DetoxBaselineFactories;
  try {
    await assert.rejects(
      runDetoxIntegratedSessionBaseline({
        repositoryRoot,
        serverRoot,
        artifactRoot,
        platform: 'android',
        configuration: 'android.emu.debug',
        role: 'professional',
        build: build('android'),
        runnerPaths: testRunnerPaths,
        parentEnv: {
          APP_VARIANT: 'dev',
          MYCHAMPIONS_DETOX_ANDROID_SYSTEM_IMAGE: '/should-not-be-read',
        },
        factories,
      }),
      (error: unknown) =>
        error instanceof Error &&
        /before acquisition/.test(error.message) &&
        /owned Android session producer/.test(error.message),
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('rejects cache identity substitution and unparsed cancellation hierarchy evidence', () => {
  const source = {
    kind: 'ios-rct-async-storage' as const,
    path: 'cache-afterLogin.private.json',
    bytes: 1,
    sha256: 'a'.repeat(64),
  };
  const valid = {
    checkpoint: 'afterLogin' as const,
    status: 'session-present' as const,
    sessionPresent: true,
    profileAuthUidHash: createHash('sha256').update('uid-coach').digest('hex'),
    source,
    receipts: [source],
  };
  assert.equal(
    requireDetoxNativeSessionCache(valid, {
      checkpoint: 'afterLogin',
      status: 'session-present',
      actorAuthUid: 'uid-coach',
      sourceKind: 'ios-rct-async-storage',
    }).profileAuthUidHash,
    valid.profileAuthUidHash,
  );
  const cache = requireDetoxNativeSessionCache(valid, {
    checkpoint: 'afterLogin',
    status: 'session-present',
    actorAuthUid: 'uid-coach',
    sourceKind: 'ios-rct-async-storage',
  });
  assert.equal(
    requireDetoxIosAuthMetadataBinding(
      {
        status: 'session-present',
        sessionPresent: true,
        profilePresent: true,
        expiryPresent: true,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
        profileAuthUidHash: cache.profileAuthUidHash!,
      },
      cache,
    ).authUidHash,
    cache.profileAuthUidHash,
  );
  assert.throws(
    () =>
      requireDetoxIosAuthMetadataBinding(
        {
          status: 'session-present',
          sessionPresent: true,
          profilePresent: true,
          expiryPresent: true,
          plaintextAccessTokenPresent: false,
          plaintextRefreshTokenPresent: false,
          profileAuthUidHash: createHash('sha256').update('uid-student').digest('hex'),
        },
        cache,
      ),
    /not bound to the native cache identity/,
  );
  assert.throws(
    () =>
      requireDetoxNativeSessionCache(
        { ...valid, profileAuthUidHash: createHash('sha256').update('uid-student').digest('hex') },
        {
          checkpoint: 'afterLogin',
          status: 'session-present',
          actorAuthUid: 'uid-coach',
          sourceKind: 'ios-rct-async-storage',
        },
      ),
    /not bound to the actor/,
  );
  assert.deepEqual(
    parseDetoxHierarchyXml(cancelHierarchy)[1]?.attributes['resource-id'],
    'settings.account.screen',
  );
  assert.throws(
    () =>
      parseDetoxHierarchyXml(
        '<ViewHierarchy><Node resource-id="settings.account.screen"></ViewHierarchy>',
      ),
    /invalid closing tag/,
  );
});

void test('reconciles the Android cache projector with the current parser and actor gate', () => {
  const checkpoint = androidStorageCheckpoint();
  const projected = projectAndroidSessionCacheCheckpoint(checkpoint, 'afterLogin', 'coach-1');
  assert.equal(projected.status, 'session-present');
  assert.equal(projected.profileAuthUidHash, createHash('sha256').update('coach-1').digest('hex'));
  assert.throws(
    () => projectAndroidSessionCacheCheckpoint(checkpoint, 'afterLogin', 'student-1'),
    /not bound to the actor/,
  );
  assert.throws(
    () => projectAndroidSessionCacheCheckpoint(undefined as never, 'afterLogin', 'coach-1'),
    /checkpoint is incomplete/,
  );
  const altered = structuredClone(checkpoint);
  altered.privateArtifacts.querySource.databaseSha256 = '9'.repeat(64);
  assert.throws(
    () => projectAndroidSessionCacheCheckpoint(altered, 'afterLogin', 'coach-1'),
    /query source receipt is malformed or unbound/,
  );
  const originalArtifacts = checkpoint.privateArtifacts;
  const originalQueryHash = originalArtifacts.query.sha256;
  let artifactReads = 0;
  Object.defineProperty(checkpoint, 'privateArtifacts', {
    configurable: true,
    get: () => {
      artifactReads += 1;
      return artifactReads === 1
        ? originalArtifacts
        : {
            ...originalArtifacts,
            query: { ...originalArtifacts.query, sha256: '9'.repeat(64) },
          };
    },
  });
  const forgedFactoryResult = projectAndroidSessionCacheCheckpoint(
    checkpoint,
    'afterLogin',
    'coach-1',
  );
  assert.equal(artifactReads, 1);
  assert.equal(forgedFactoryResult.source.sha256, originalQueryHash);
});

void test('retains the current Android four-phase checkpoint and unchanged-domain gates', () => {
  const base = androidStorageCheckpoint();
  const receipt = (name: string, sizeBytes: number) => ({
    path: `${name}.json`,
    sizeBytes,
    sha256: createHash('sha256').update(name).digest('hex'),
    ownerUid: 501,
    mode: 0o600,
    verification: 'owned-runtime-document-v6' as const,
  });
  const phases = [
    'before-login',
    'after-login',
    'after-restoration',
    'after-signed-out-relaunch',
  ] as const;
  const checkpoints = phases.map((phase, index) => ({
    phase,
    runId,
    scope: 'native-entry-android',
    apiOrigin,
    apiPid: 9001,
    backendAttemptId: `${runId}:first`,
    manifestSha256: '1'.repeat(64),
    fixtureAuthUidAllowlistHash: '2'.repeat(64),
    profile: receipt(`profile-${index}`, 100 + index),
    domain: receipt(`domain-${index}`, 200 + index),
  }));
  assert.equal(
    requireAndroidSessionCheckpointSet({
      checkpoints,
      expectedRunId: runId,
      expectedScope: 'native-entry-android',
      expectedApiOrigin: apiOrigin,
      expectedApiPid: 9001,
      expectedBackendAttemptId: `${runId}:first`,
      expectedManifestSha256: '1'.repeat(64),
      expectedFixtureAuthUidAllowlistHash: '2'.repeat(64),
    }).length,
    4,
  );
  assert.throws(
    () =>
      requireAndroidSessionCheckpointSet({
        checkpoints: checkpoints.slice(0, 3),
        expectedRunId: runId,
        expectedScope: 'native-entry-android',
        expectedApiOrigin: apiOrigin,
        expectedApiPid: 9001,
        expectedBackendAttemptId: `${runId}:first`,
        expectedManifestSha256: '1'.repeat(64),
        expectedFixtureAuthUidAllowlistHash: '2'.repeat(64),
      }),
    /four phases/,
  );
  const before = androidDomainSnapshot();
  const after = structuredClone(before);
  assert.equal(
    requireAndroidSessionDomainBinding({
      before,
      after,
      beforeStorage: base,
      afterStorage: structuredClone(base),
    }).status,
    'verified',
  );
  const changed = structuredClone(after);
  changed.connections[0] = { id: 'changed-connection' };
  assert.throws(
    () =>
      requireAndroidSessionDomainBinding({
        before,
        after: changed,
        beforeStorage: base,
        afterStorage: structuredClone(base),
      }),
    /unrelated connections/,
  );
});

void test('rejects duplicate native sign-in attempts even when one later attempt succeeds', () => {
  assert.throws(
    () =>
      requireDetoxTransportEvidence({
        observations: [
          { ...authObservation(), requestId: 1, outcome: 'rejected' as const, status: 400 },
          { ...authObservation(), requestId: 2 },
        ] as never,
        identities: [authIdentity()] as never,
        actorAuthUid: 'uid-student',
        apiOrigin,
        apiPid: 9001,
        fixtureAuthUids: Object.values(fixtures().accounts).map((account) => account.authUid),
      }),
    /exactly one native sign-in attempt/,
  );
});

void test('executes the owned lifecycle through a real child-command seam without role-selection or caller-device termination', async () => {
  const artifactRoot = await privateArtifact('0123456789abcdef01234568');
  const testRunnerPaths = await privateRunnerPaths(artifactRoot);
  const stateRoot = path.join(artifactRoot, 'host-state');
  const sessionArtifactRoot = path.join(artifactRoot, 'owned-session');
  await mkdir(sessionArtifactRoot, { mode: 0o700 });
  await chmod(sessionArtifactRoot, 0o700);
  await mkdir(stateRoot, { mode: 0o700 });
  await chmod(stateRoot, 0o700);
  await writeFile(path.join(stateRoot, 'mychampions-native-host.lock'), '', { mode: 0o600 });
  const observations: ProxyObservation[] = [authObservation()];
  const identities: NativeAuthIdentityObservation[] = [authIdentity()];
  const targetStops: string[] = [];
  let commandEnvironment: NodeJS.ProcessEnv | undefined;
  let snapshotCounter = 0;
  let authMetadataReads = 0;
  let loginCacheObserved = false;
  let releaseLoginAuthMetadata: (() => void) | undefined;
  const loginAuthMetadataGate = new Promise<void>((resolve) => {
    releaseLoginAuthMetadata = resolve;
  });
  const session = {
    manifest: {
      runId,
      composeProject: `mc_test_${runId}`,
      artifactRoot: sessionArtifactRoot,
      processes: [],
    },
    apiOrigin,
    apiPid: 9001,
    fixtures: () => Promise.resolve(fixtures()),
    snapshot: async () => {
      const value = snapshot();
      const file = path.join(
        sessionArtifactRoot,
        `snapshot-native-entry-ios-${++snapshotCounter}.private.json`,
      );
      await writeFile(file, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      return value;
    },
    connectionSnapshot: async () => {
      const value = connectionSnapshot();
      const file = path.join(
        sessionArtifactRoot,
        `connection-snapshot-native-entry-ios-${++snapshotCounter}.private.json`,
      );
      await writeFile(file, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      return value;
    },
    stop: () => Promise.resolve(),
  };
  const proxy = {
    origin: apiOrigin,
    observations,
    nativeAuthIdentities: identities,
    get requestIdFence() {
      return Math.max(0, ...observations.map((row) => row.requestId));
    },
    enableNativeAuthIdentityCapture: () => undefined,
    stop: () => Promise.resolve(),
  };
  const factories = {
    reserveOwnedAppPort: () =>
      Promise.resolve({ port: 41003, origin: appOrigin, release: () => Promise.resolve() }),
    startOwnedSession: () => Promise.resolve(session),
    startOwnedApiProxy: () => Promise.resolve(proxy),
    startOwnedExpo: () => Promise.resolve({ stop: () => Promise.resolve(), configExtra: {} }),
    acquireOwnedTarget: () =>
      Promise.resolve({
        platform: 'ios' as const,
        deviceId: 'owned-simulator-1',
        ownership: {
          artifactRoot,
          hostLockRequired: true as const,
          cleanupAuthorized: true as const,
        },
        verify: () => Promise.resolve(),
        stop: () => {
          targetStops.push('owned-simulator-1');
          return Promise.resolve();
        },
      }),
    capturePreviousIosDevices: () => Promise.resolve(),
    requireNativeHostAvailability: () => Promise.resolve({ status: 'no-known-job' }),
    verifyIosSimulatorApp: () =>
      Promise.resolve({
        binaryPath: build().binaryPath,
        signingProfile: 'test-seam',
        localApplicationId: 'test-seam',
      }),
    inspectDetoxBuildInstrumentation: ({
      build: observed,
    }: {
      build: DetoxBaselineBuildInstrumentation;
    }) => Promise.resolve(observed),
    verifyAndroidBuild: () => Promise.resolve(),
    verifyOwnedIosCleanup: () => Promise.resolve({ result: 'passed' as const }),
    resolveIosDataContainer: () => Promise.resolve(path.join(artifactRoot, 'data-container')),
    observeNativeSessionCache: ({
      checkpoint,
      actorAuthUid,
    }: {
      checkpoint:
        | 'afterLogin'
        | 'afterRestoration'
        | 'afterCancel'
        | 'afterSignout'
        | 'afterSignedOutRelaunch';
      actorAuthUid: string;
    }) => {
      const present =
        checkpoint === 'afterLogin' ||
        checkpoint === 'afterRestoration' ||
        checkpoint === 'afterCancel';
      if (checkpoint === 'afterLogin') loginCacheObserved = true;
      const sourcePath = `cache-${checkpoint}.private.json`;
      const sourceHash = 'a'.repeat(64);
      return Promise.resolve({
        checkpoint,
        status: present ? ('session-present' as const) : ('session-absent' as const),
        sessionPresent: present,
        profileAuthUidHash: present
          ? createHash('sha256').update(actorAuthUid).digest('hex')
          : null,
        source: {
          kind: 'ios-rct-async-storage' as const,
          path: sourcePath,
          bytes: 1,
          sha256: sourceHash,
        },
        receipts: [{ path: sourcePath, bytes: 1, sha256: sourceHash }],
      });
    },
    observeIosAuthMetadata: async () => {
      authMetadataReads += 1;
      if (authMetadataReads === 1) await loginAuthMetadataGate;
      if (authMetadataReads <= 2)
        return Promise.resolve({
          status: 'session-present' as const,
          sessionPresent: true as const,
          profilePresent: true,
          expiryPresent: true,
          plaintextAccessTokenPresent: false,
          plaintextRefreshTokenPresent: false,
          profileAuthUidHash: createHash('sha256').update('uid-coach').digest('hex'),
        });
      return Promise.resolve({ status: 'session-absent' as const, sessionPresent: false as const });
    },
    executeOwnedNativeCommand: async (input: { env: NodeJS.ProcessEnv }) => {
      commandEnvironment = input.env;
      const events = [
        { stepId: 'NAT-session-login', ordinal: 1, monotonicMs: 1 },
        { stepId: 'NAT-session-restore', ordinal: 2, monotonicMs: 2 },
        { stepId: 'NAT-session-account', ordinal: 3, monotonicMs: 3 },
        {
          stepId: 'NAT-session-signout',
          ordinal: 4,
          monotonicMs: 4,
          confirmationAfterCancel: 'not-visible',
          cancelEvidence: {
            hierarchyFile: 'detox-cancel-after-cancel.private.xml',
            hierarchySha256: createHash('sha256').update(cancelHierarchy).digest('hex'),
            screenshotFile: 'detox-cancel-after-cancel.private.png',
            screenshotSha256: createHash('sha256').update(cancelPng).digest('hex'),
            modalPresent: false,
            accountScreenPresent: true,
          },
        },
        { stepId: 'NAT-session-signed-out-relaunch', ordinal: 5, monotonicMs: 5 },
      ];
      const writeProgress = async (visibleEvents: unknown[], cancelCheckpoint?: unknown) => {
        const file = path.join(artifactRoot, 'detox-session-progress.private.json');
        const temporary = `${file}.tmp`;
        await writeFile(
          temporary,
          JSON.stringify({
            schemaVersion: 2,
            kind: 'private-detox-session-progress',
            platform: 'ios',
            role: 'professional',
            completedSteps: visibleEvents.map((event) => (event as { stepId: string }).stepId),
            events: visibleEvents,
            launchCount: 3,
            synchronizationDisabled: true,
            ...(cancelCheckpoint ? { cancelCheckpoint } : {}),
          }),
          { mode: 0o600, flag: 'w' },
        );
        await rename(temporary, file);
      };
      await writeProgress([events[0]]);
      const waitForLoginObservation = async () => {
        const deadline = performance.now() + 5_000;
        while (!loginCacheObserved) {
          if (performance.now() >= deadline)
            throw new Error('Synthetic progress fixture did not observe the login event');
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      };
      await waitForLoginObservation();
      observations.push(hydrateObservation());
      await writeProgress(events.slice(0, 2));
      if (!releaseLoginAuthMetadata)
        throw new Error('Synthetic progress fixture login gate was not initialized');
      releaseLoginAuthMetadata();
      await writeProgress(events.slice(0, 3));
      await new Promise((resolve) => setTimeout(resolve, 40));
      const cancelCheckpoint = {
        monotonicMs: 3.5,
        cancelEvidence: {
          hierarchyFile: 'detox-cancel-after-cancel.private.xml',
          hierarchySha256: createHash('sha256').update(cancelHierarchy).digest('hex'),
          screenshotFile: 'detox-cancel-after-cancel.private.png',
          screenshotSha256: createHash('sha256').update(cancelPng).digest('hex'),
          modalPresent: false,
          accountScreenPresent: true,
        },
      };
      await writeFile(
        path.join(artifactRoot, 'detox-cancel-after-cancel.private.xml'),
        cancelHierarchy,
        { mode: 0o600, flag: 'wx' },
      );
      await writeFile(path.join(artifactRoot, 'detox-cancel-after-cancel.private.png'), cancelPng, {
        mode: 0o600,
        flag: 'wx',
      });
      await writeProgress(events.slice(0, 3), cancelCheckpoint);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await writeProgress(events.slice(0, 4), cancelCheckpoint);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await writeProgress(events, cancelCheckpoint);
      await writeFile(
        path.join(artifactRoot, 'detox-session-result.private.json'),
        JSON.stringify(stepDocument()) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      return {
        phase: 'step' as const,
        execution: 'completed' as const,
        cleanup: 'cleaned' as const,
        childExitCode: 0,
        childSignal: null,
        pid: 9010,
        pgid: 9010,
        logPath: null,
        stdoutPath: null,
        ownershipPath: null,
        elapsedMs: 20,
        cleanupMs: 2,
      };
    },
  } as unknown as DetoxBaselineFactories;
  try {
    const result = await runDetoxIntegratedSessionBaseline({
      repositoryRoot,
      serverRoot,
      artifactRoot,
      platform: 'ios',
      configuration: 'ios.sim.debug',
      role: 'professional',
      build: build(),
      runnerPaths: testRunnerPaths,
      parentEnv: {
        APP_VARIANT: 'dev',
        MYCHAMPIONS_NATIVE_STATE_ROOT: stateRoot,
        MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
      },
      factories,
    });
    assert.equal(result.report.result, 'passed');
    assert.equal(result.report.publicNativePassingCases, 0);
    assert.equal(result.report.childExecution?.command, 'yarn');
    assert.equal(result.report.childExecution?.pgid, 9010);
    assert.equal(result.report.childExecution?.cleanupMs, 2);
    assert.equal(authMetadataReads, 4);
    assert.equal(result.report.authMetadata?.beforeRelaunch.profilePresent, true);
    assert.equal(result.report.authMetadata?.afterRelaunch.expiryPresent, true);
    assert.equal(result.report.authMetadata?.afterSignout.sessionPresent, false);
    const captureLedger = JSON.parse(
      await readFile(path.join(artifactRoot, 'capture.private.json'), 'utf8'),
    ) as {
      phase?: string;
      finalized?: boolean;
      result?: string;
      command?: { pgid?: number; command?: string; cleanupMs?: number };
      acquisitionIntents?: string[];
      acquisitionSequence?: string[];
      backendCleanup?: { result?: string };
    };
    const finalCaptureLedger = JSON.parse(
      await readFile(path.join(artifactRoot, 'capture-final.private.json'), 'utf8'),
    ) as {
      fileName?: string;
      phase?: string;
      finalized?: boolean;
      result?: string;
      cleanup?: string;
      independentCleanup?: string;
      cleanupFinalLedger?: string | null;
    };
    const cleanupFinalLedger = JSON.parse(
      await readFile(path.join(artifactRoot, 'cleanup-final.private.json'), 'utf8'),
    ) as unknown;
    assert.equal(captureLedger.phase, 'partial');
    assert.equal(captureLedger.finalized, false);
    assert.equal(captureLedger.result, 'harness-blocked');
    assert.equal(finalCaptureLedger.fileName, 'capture-final.private.json');
    assert.equal(finalCaptureLedger.phase, 'final');
    assert.equal(finalCaptureLedger.finalized, true);
    assert.equal(finalCaptureLedger.result, 'passed');
    assert.equal(finalCaptureLedger.cleanup, 'cleaned');
    assert.equal(finalCaptureLedger.independentCleanup, 'passed');
    assert.equal(finalCaptureLedger.cleanupFinalLedger, 'cleanup-final.private.json');
    requireDetoxFinalCaptureQualification({
      capture: finalCaptureLedger,
      cleanupFinal: cleanupFinalLedger,
      report: result.report,
    });
    assert.equal(captureLedger.command?.pgid, 9010);
    assert.equal(captureLedger.command?.command, 'yarn');
    assert.equal(captureLedger.command?.cleanupMs, 2);
    assert.deepEqual(captureLedger.acquisitionIntents, [
      'app-port',
      'target',
      'backend',
      'proxy',
      'expo',
      'detox',
    ]);
    assert.deepEqual(captureLedger.acquisitionSequence, captureLedger.acquisitionIntents);
    assert.equal(captureLedger.backendCleanup?.result, 'passed');
    const evidenceNames = new Set(result.report.evidenceFiles.map((file) => file.name));
    for (const name of [
      'detox-auth-metadata.private.json',
      'detox-domain-before.private.json',
      'detox-domain-after-signed-out-relaunch.private.json',
      'detox-profile-beforeLogin.private.json',
      'detox-profile-afterSignedOutRelaunch.private.json',
      'detox-cancel-after-cancel.private.xml',
      'detox-cancel-after-cancel.private.png',
      'detox-phase-checkpoints.private.json',
      'detox-transport-observations.private.json',
    ])
      assert.equal(evidenceNames.has(name), true, `missing evidence ${name}`);
    for (const name of [
      'capture.private.json',
      'cleanup-final.private.json',
      'capture-final.private.json',
    ]) {
      const receipt = result.report.evidenceFiles.find((file) => file.name === name);
      assert(receipt, `missing publication receipt ${name}`);
      const bytes = await readFile(path.join(artifactRoot, name));
      assert.equal(receipt.bytes, bytes.byteLength);
      assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
    }
    assert.equal(result.report.snapshots?.checkpoints.length, 4);
    assert.equal(result.report.childExecution?.pgid, 9010);
    assert.equal(result.report.result, 'passed');
    assert.deepEqual(targetStops, ['owned-simulator-1']);
    assert.equal(commandEnvironment?.DETOX_IOS_SIMULATOR_UDID, 'owned-simulator-1');
    assert.equal(commandEnvironment?.DETOX_BASELINE_ROLE, 'professional');
    assert.match(
      commandEnvironment?.DETOX_JEST_CONFIG ?? '',
      /jest\.detox-integrated-session-baseline/,
    );
    const e2e = await readFile(testRunnerPaths.testPath, 'utf8');
    assert.equal(e2e.includes('auth.roleSelection.title'), false);
    assert.equal(e2e.includes('device.terminateApp'), false);
    assert.equal(e2e.includes("NAT-session-unrelated-state', ordinal"), false);
    assert.match(e2e, /detox-session-progress\.private\.json/);
    assert.match(e2e, /confirmationAfterCancel/);
    const config = await readFile(testRunnerPaths.jestConfigPath, 'utf8');
    assert.match(config, /detox\/runners\/jest\/globalSetup/);
    assert.match(config, /detox\/runners\/jest\/testEnvironment/);
    assert.match(config, /DETOX_BASELINE_TEST_PATH/);
    const entry = await readFile(testRunnerPaths.entryPath, 'utf8');
    assert.match(entry, /runDetoxIntegratedSessionBaseline/);
    assert.match(entry, /SIGINT/);
    assert.match(entry, /SIGTERM/);
    assert.match(entry, /removeListener/);
    assert.match(entry, /DETOX_BASELINE_JEST_CONFIG/);
    assert.match(entry, /DETOX_BASELINE_DEADLINE_MS/);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('blocks before acquisition when the shared native host lock is absent', async () => {
  const artifactRoot = await privateArtifact('0123456789abcdef01234569');
  const testRunnerPaths = await privateRunnerPaths(artifactRoot);
  let acquired = false;
  const factories = {
    acquireOwnedTarget: () => {
      acquired = true;
      return Promise.reject(new Error('must not acquire'));
    },
  } as unknown as DetoxBaselineFactories;
  try {
    await assert.rejects(
      runDetoxIntegratedSessionBaseline({
        repositoryRoot,
        serverRoot,
        artifactRoot,
        platform: 'ios',
        configuration: 'ios.sim.debug',
        role: 'professional',
        build: build(),
        runnerPaths: testRunnerPaths,
        parentEnv: { APP_VARIANT: 'dev' },
        factories,
      }),
      (error: unknown) => {
        assert.match(String((error as { cause?: unknown }).cause), /host-lock wrapper/);
        return true;
      },
    );
    assert.equal(acquired, false);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('rejects the unsupported student actor before any owned acquisition', async () => {
  const artifactRoot = await privateArtifact('0123456789abcdef01234571');
  const testRunnerPaths = await privateRunnerPaths(artifactRoot);
  const calls: string[] = [];
  const factories = {
    requireNativeHostAvailability: () => {
      calls.push('host');
      return Promise.reject(new Error('must not acquire host lock'));
    },
    reserveOwnedAppPort: () => {
      calls.push('app-port');
      return Promise.reject(new Error('must not reserve app port'));
    },
    acquireOwnedTarget: () => {
      calls.push('target');
      return Promise.reject(new Error('must not acquire target'));
    },
  } as unknown as DetoxBaselineFactories;
  try {
    await assert.rejects(
      runDetoxIntegratedSessionBaseline({
        repositoryRoot,
        serverRoot,
        artifactRoot,
        platform: 'ios',
        configuration: 'ios.sim.debug',
        role: 'student',
        build: build(),
        runnerPaths: testRunnerPaths,
        parentEnv: { APP_VARIANT: 'dev' },
        factories,
      }),
      /student actor branch remains Pending/,
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('retains a target-only partial ledger when backend session acquisition fails', async () => {
  const { artifactRoot, stateRoot } = await preparePartialAcquisitionArtifact(
    '0123456789abcdef01234572',
  );
  const testRunnerPaths = await privateRunnerPaths(artifactRoot);
  const targetStops: string[] = [];
  const releaseCalls = { value: 0 };
  try {
    let thrown: unknown;
    await assert.rejects(
      runDetoxIntegratedSessionBaseline({
        repositoryRoot,
        serverRoot,
        artifactRoot,
        platform: 'ios',
        configuration: 'ios.sim.debug',
        role: 'professional',
        build: build(),
        runnerPaths: testRunnerPaths,
        parentEnv: {
          APP_VARIANT: 'dev',
          MYCHAMPIONS_NATIVE_STATE_ROOT: stateRoot,
          MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
        },
        factories: partialAcquisitionFactories({ artifactRoot, targetStops, releaseCalls }),
      }),
      (error: unknown) => {
        thrown = error;
        return true;
      },
    );
    const errorReport = (thrown as { report?: { result?: string } }).report;
    assert.equal(errorReport?.result, 'harness-blocked');
    assert.match(String((thrown as { cause?: unknown }).cause), /session-start-failed/);
    const capture = JSON.parse(
      await readFile(path.join(artifactRoot, 'capture-final.private.json'), 'utf8'),
    ) as {
      fileName?: string;
      phase?: string;
      finalized?: boolean;
      result?: string;
      cleanup?: string;
      device?: { udid?: string } | null;
      backend?: unknown;
      backendCleanup?: { status?: string; result?: string; attempted?: boolean };
      acquisitionIntents?: string[];
      acquisitionSequence?: string[];
    };
    const partialCapture = JSON.parse(
      await readFile(path.join(artifactRoot, 'capture.private.json'), 'utf8'),
    ) as { phase?: string; finalized?: boolean; result?: string; cleanup?: string };
    assert.equal(partialCapture.phase, 'partial');
    assert.equal(partialCapture.finalized, false);
    assert.equal(partialCapture.result, 'harness-blocked');
    assert.equal(partialCapture.cleanup, 'partial-acquisition-blocked');
    assert.equal(capture.fileName, 'capture-final.private.json');
    assert.equal(capture.phase, 'final');
    assert.equal(capture.finalized, true);
    assert.equal(capture.result, 'harness-blocked');
    assert.equal(capture.cleanup, 'partial-acquisition-blocked');
    assert.equal(capture.device?.udid, 'owned-simulator-1');
    assert.equal(capture.backend, null);
    assert.deepEqual(capture.acquisitionIntents, ['app-port', 'target', 'backend']);
    assert.deepEqual(capture.acquisitionSequence, ['app-port', 'target']);
    assert.deepEqual(capture.backendCleanup, {
      status: 'unknown',
      attempted: false,
      result: 'unknown',
      reason: 'Owned backend session was not acquired',
    });
    const cleanup = JSON.parse(
      await readFile(path.join(artifactRoot, 'cleanup-final.private.json'), 'utf8'),
    ) as { independent?: string; cleaned?: string[]; backendCleanup?: { result?: string } };
    assert.equal(cleanup.independent, 'not-executed');
    assert.equal(cleanup.backendCleanup?.result, 'unknown');
    assert.deepEqual(cleanup.cleaned, ['target', 'app-port']);
    assert.deepEqual(targetStops, ['owned-simulator-1']);
    assert.equal(releaseCalls.value, 1);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('keeps the original failure when capture-ledger publication is injected to fail', async () => {
  const { artifactRoot, stateRoot } = await preparePartialAcquisitionArtifact(
    '0123456789abcdef01234573',
  );
  const testRunnerPaths = await privateRunnerPaths(artifactRoot);
  const targetStops: string[] = [];
  const releaseCalls = { value: 0 };
  const writer = async (filePath: string, bytes: Buffer) => {
    if (path.basename(filePath) === 'capture-final.private.json')
      throw new Error('injected-capture-writer-failure');
    await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  };
  try {
    let thrown: unknown;
    await assert.rejects(
      runDetoxIntegratedSessionBaseline({
        repositoryRoot,
        serverRoot,
        artifactRoot,
        platform: 'ios',
        configuration: 'ios.sim.debug',
        role: 'professional',
        build: build(),
        runnerPaths: testRunnerPaths,
        parentEnv: {
          APP_VARIANT: 'dev',
          MYCHAMPIONS_NATIVE_STATE_ROOT: stateRoot,
          MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
        },
        factories: partialAcquisitionFactories({
          artifactRoot,
          targetStops,
          releaseCalls,
          writer,
        }),
      }),
      (error: unknown) => {
        thrown = error;
        return true;
      },
    );
    assert.match(String((thrown as { cause?: unknown }).cause), /session-start-failed/);
    assert.equal((thrown as { report?: { result?: string } }).report?.result, 'cleanup-failed');
    const fallback = JSON.parse(
      await readFile(path.join(artifactRoot, 'detox-capture-fallback.private.json'), 'utf8'),
    ) as { phase?: string; originalFailure?: { phase?: string } };
    assert.equal(fallback.phase, 'publication:capture-final-ledger');
    assert.equal(fallback.originalFailure?.phase, 'execution');
    await readFile(path.join(artifactRoot, 'capture.private.json'), 'utf8');
    await assert.rejects(readFile(path.join(artifactRoot, 'capture-final.private.json'), 'utf8'));
    await readFile(path.join(artifactRoot, 'cleanup-final.private.json'), 'utf8');
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('rejects a no-op terminal evidence writer instead of returning a passing report', async () => {
  const { artifactRoot, stateRoot } = await preparePartialAcquisitionArtifact(
    '0123456789abcdef01234576',
  );
  const testRunnerPaths = await privateRunnerPaths(artifactRoot);
  const targetStops: string[] = [];
  const releaseCalls = { value: 0 };
  const writer = async () => {};
  try {
    let thrown: unknown;
    await assert.rejects(
      runDetoxIntegratedSessionBaseline({
        repositoryRoot,
        serverRoot,
        artifactRoot,
        platform: 'ios',
        configuration: 'ios.sim.debug',
        role: 'professional',
        build: build(),
        runnerPaths: testRunnerPaths,
        parentEnv: {
          APP_VARIANT: 'dev',
          MYCHAMPIONS_NATIVE_STATE_ROOT: stateRoot,
          MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
        },
        factories: partialAcquisitionFactories({
          artifactRoot,
          targetStops,
          releaseCalls,
          writer,
        }),
      }),
      (error: unknown) => {
        thrown = error;
        return true;
      },
    );
    assert.equal((thrown as { report?: { result?: string } }).report?.result, 'cleanup-failed');
    await readFile(path.join(artifactRoot, 'detox-capture-partial-fallback.private.json'));
    await readFile(path.join(artifactRoot, 'detox-cleanup-fallback.private.json'));
    await readFile(path.join(artifactRoot, 'detox-capture-fallback.private.json'));
    await assert.rejects(readFile(path.join(artifactRoot, 'capture-final.private.json')));
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('retains stopped proxy transport for a failed or cancelled child boundary', async () => {
  const artifactRoot = await privateArtifact('0123456789abcdef01234570');
  let stopCalls = 0;
  const proxy = {
    requestIdFence: 1,
    observations: [authObservation()],
    nativeAuthIdentities: [authIdentity()],
    stop: () => {
      stopCalls += 1;
      return Promise.resolve();
    },
  };
  try {
    const retained = await stopAndReadFinalTransport({ proxy, artifactRoot });
    assert.equal(stopCalls, 1);
    assert.equal(retained.stopped, true);
    assert.deepEqual(JSON.parse(await readFile(retained.file, 'utf8')), {
      stopped: true,
      requestIdFence: 1,
      observations: proxy.observations,
      identities: proxy.nativeAuthIdentities,
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

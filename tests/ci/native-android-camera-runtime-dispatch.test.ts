import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  dispatchAndroidCameraRuntime,
  type AndroidCameraRuntimeDispatchInput,
} from '../../scripts/testing/native-android-camera-runtime-dispatch';
import { writeAndroidCameraNativeRuntimeReceipt } from '../../scripts/testing/native-android-camera-runtime-receipt';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  ANDROID_CAMERA_SCENARIO,
  androidCameraSelectionHash,
} from '../../scripts/testing/native-camera-android-contract';
import {
  androidCameraPublicRequiredSourcePaths,
  runAndroidCameraPublicAttempt,
  type AndroidCameraPublicAttemptResult,
} from '../../scripts/testing/run-android-camera-public-attempt';
import { createAndroidCameraEligibilityFixture } from '../dependencies/android-camera-runtime-eligibility-fixture';
import type { NativeLocaleEvidence } from '../../scripts/testing/locale-native-observation';
import type { AndroidCameraPublicStageResult } from '../../scripts/testing/native-android-camera-public-staging';
import type { AndroidCameraNativeRuntimeDriverResult } from '../../scripts/testing/native-android-camera-runtime-driver';
import type {
  AndroidCameraRuntimeEligibilityResult,
  AndroidCameraRuntimeEligibilityInput,
} from '../../scripts/testing/native-android-camera-runtime-eligibility';
import type {
  AndroidCameraSqlReceiptPhase,
  AndroidCameraSqlSourceReceipt,
} from '../../scripts/testing/native-camera-android-observation';
import type {
  AndroidCameraFrameSummary,
  AndroidCameraProducerReceipts,
} from '../../scripts/testing/native-camera-android-producer';
import type {
  NativePilotSelection,
  NativePilotTarget,
} from '../../scripts/testing/native-pilot-contract';

const RUN_ID = '0123456789abcdef01234567';
const REQUESTED_ID = 'cccccccccccccccccccccccc';
const FIXTURE_RUN_ID = 'fedcba987654321001234567';
const OWNER_RUN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET = {
  deviceId: 'emulator-5554',
  osVersion: '37',
  appId: 'com.edufelip.mychampions.dev',
  buildProfile: 'dev-debug-arm64',
  binaryHash: 'c'.repeat(64),
  apiOrigin: 'http://127.0.0.1:1234',
} as const satisfies NativePilotTarget;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const PRIMARY_FIXTURE_AUTH_UIDS = ['coach', 'student'] as const;
async function requestedOutputRoot(
  value: Awaited<ReturnType<typeof createAndroidCameraEligibilityFixture>>,
): Promise<string> {
  const root = path.join(value.outputParent, REQUESTED_ID);
  if (root !== value.outputRoot) await mkdir(root, { mode: 0o700 });
  return root;
}

const ISOLATION_FIXTURE_AUTH_UIDS = [
  'isolation-active-student',
  'isolation-coach',
  'isolation-new',
  'isolation-pending-student',
  'isolation-student',
  'isolation-unrelated-coach',
  'isolation-unrelated-student',
] as const;
const PRIMARY_EXPECTED = {
  runId: FIXTURE_RUN_ID,
  scope: 'native-entry-android',
  fixtureAuthUids: [...PRIMARY_FIXTURE_AUTH_UIDS],
  target: {
    professionalAuthUid: 'coach',
    studentAuthUid: 'student',
    specialty: 'fitness_coach' as const,
  },
};
const ISOLATION_EXPECTED = {
  runId: FIXTURE_RUN_ID,
  scope: 'native-conn-isolation-android',
  fixtureAuthUids: [...ISOLATION_FIXTURE_AUTH_UIDS],
  target: {
    professionalAuthUid: 'isolation-coach',
    studentAuthUid: 'isolation-student',
    specialty: 'fitness_coach' as const,
  },
};

function selection(): NativePilotSelection {
  const pilotAssertions = ANDROID_CAMERA_ASSERTION_IDS.map((id) => ({
    id,
    requirementRefs: ['TC-camera-runtime'],
    evidenceKinds:
      id === 'NAT-camera-denial-guidance'
        ? (['ui'] as ('ui' | 'api' | 'sql')[])
        : (['ui', 'api', 'sql'] as ('ui' | 'api' | 'sql')[]),
  }));
  return {
    arguments: {
      platform: 'android',
      engine: 'maestro',
      scenario: ANDROID_CAMERA_SCENARIO,
      mode: 'integration',
    },
    scenario: {
      id: ANDROID_CAMERA_SCENARIO,
      platform: 'android',
      engine: 'maestro',
      flowId: 'FLW-camera-denied',
      transitionIds: ['TRN-camera-request', 'TRN-camera-deny'],
      requirementRefs: ['TC-camera-runtime'],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:SCN-camera-denied-android',
      freshnessInputs: { requirementPaths: ['tests/ci'] },
      pilotAssertions,
      pilotAssertionContract: {
        count: pilotAssertions.length,
        sha256: digest('pilot-assertions'),
        dataMode: 'postgres',
      },
    },
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
  };
}

function producer(current: NativePilotSelection): AndroidCameraProducerReceipts {
  const codeHash = digest('redacted-code');
  const frameHash = digest('frame');
  const syntheticParentRoot = path.resolve(process.cwd(), '.qa/private-dispatch-parent');
  const syntheticOwnerUid = process.getuid?.() ?? -1;
  const locale: NativeLocaleEvidence = {
    schemaVersion: 1,
    requestedLocale: 'en-US',
    observedOsLocale: {
      status: 'observed',
      source: 'android-getprop',
      raw: 'en-US',
      resolved: 'en-US',
      normalization: 'exact',
    },
    effectiveAppLocale: {
      hydration: 'hydrated',
      source: 'LocaleContext',
      value: 'en-US',
    },
    override: { status: 'absent', source: 'language-storage', value: null },
    binding: {
      captureRunId: RUN_ID,
      sourceTreeHash: digest('source'),
      helperInputsHash: digest('helpers'),
      target: { platform: 'android', ...TARGET },
    },
  };
  const identity = {
    captureRunId: RUN_ID,
    ownerRunId: OWNER_RUN_ID,
    backendRunId: FIXTURE_RUN_ID,
    backendAttemptId: `${FIXTURE_RUN_ID}:first`,
    serial: TARGET.deviceId,
    appId: TARGET.appId,
    apiOrigin: TARGET.apiOrigin,
    apiPid: 4321,
    apiStarted: '2026-10-03T00:00:00.000Z',
    apiScript: 'scripts/testing/owned-session.ts',
    target: TARGET,
    locale,
  };
  const frames: AndroidCameraFrameSummary[] = (
    ['entry', 'prompt', 'denied', 'manual', 'pending'] as const
  ).map((label, ordinal) => ({
    label,
    path: `${label}.png`,
    sizeBytes: 5,
    sha256: frameHash,
    contentKind: 'png' as const,
    action: {
      label,
      invocationId: `${RUN_ID}:camera:${label}`,
      ordinal,
      actionsSha256: digest(`actions-${label}`),
      viewId: `STATE-camera-${label}`,
      selectorKind: 'id',
      selectors: [`student.camera.${label}`],
      commandLabel: `camera-${label}`,
      commandOrdinal: ordinal,
    },
  }));
  const sqlPhases = [
    'before',
    'pending',
    'isolation-before',
    'isolation-after',
    'training-before',
    'training-after',
  ] as const satisfies readonly AndroidCameraSqlReceiptPhase[];
  const sqlReceipts: AndroidCameraSqlSourceReceipt[] = sqlPhases.map((phase) => ({
    phase,
    scope: 'native-entry-android',
    table: 'connections',
    queryId: `dispatch-${phase}`,
    mode: 0o600,
    ownerUid: syntheticOwnerUid,
    kind: 'query',
    verification: 'owned-stable-reader-v6',
    path: `sql-${phase}.json`,
    sizeBytes: 1,
    sha256: digest(`sql-${phase}`),
    parentSnapshotPath: `snapshot-${phase}.json`,
    parentSnapshotRoot: syntheticParentRoot,
    parentSnapshotRetainedPath: `retained-snapshot-${phase}.json`,
    parentSnapshotRetainedKind: 'sidecar',
    parentSnapshotRetainedSha256: digest(`snapshot-${phase}`),
    parentSnapshotRetainedSizeBytes: 1,
    parentSnapshotRetainedOwnerUid: syntheticOwnerUid,
    parentSnapshotRetainedMode: 0o600,
    parentSnapshotRetainedVerification: 'owned-stable-reader-v6',
    parentSnapshotSha256: digest(`snapshot-${phase}`),
    parentSnapshotSchema: 'connection-snapshot-v1',
    parentSnapshotKind: 'connection',
    parentSnapshotSizeBytes: 1,
    parentSnapshotOwnerUid: syntheticOwnerUid,
    parentSnapshotMode: 0o600,
    parentSnapshotVerification: 'owned-runtime-document-v6',
    parentRunId: FIXTURE_RUN_ID,
    parentScope: 'native-entry-android',
    parentBackendAttemptId: `${FIXTURE_RUN_ID}:first`,
    parentApiOrigin: TARGET.apiOrigin,
    parentApiPid: 4321,
    parentApiStarted: '2026-10-03T00:00:00.000Z',
    parentApiScript: 'scripts/testing/owned-session.ts',
    parentManifestPath: 'manifest.json',
    parentManifestSha256: digest('manifest'),
    parentManifestRetainedPath: 'retained-manifest.json',
    parentManifestRetainedKind: 'sidecar',
    parentManifestRetainedSha256: digest('manifest'),
    parentManifestRetainedSizeBytes: 1,
    parentManifestRetainedOwnerUid: syntheticOwnerUid,
    parentManifestRetainedMode: 0o600,
    parentManifestRetainedVerification: 'owned-stable-reader-v6',
    parentManifestSizeBytes: 1,
    parentApiLedgerPath: 'api-session-start.json',
    parentApiLedgerSha256: digest('api-ledger'),
    parentApiLedgerRetainedPath: 'retained-api-ledger.json',
    parentApiLedgerRetainedKind: 'sidecar',
    parentApiLedgerRetainedSha256: digest('api-ledger'),
    parentApiLedgerRetainedSizeBytes: 1,
    parentApiLedgerRetainedOwnerUid: syntheticOwnerUid,
    parentApiLedgerRetainedMode: 0o600,
    parentApiLedgerRetainedVerification: 'owned-stable-reader-v6',
    parentApiLedgerSizeBytes: 1,
    parentApiAttempt: 'session-start',
    parentFixtureAuthUidAllowlistHash: digest('allowlist'),
    sourceProjection: 'owned-session.connection-snapshot-v1.rows',
  }));
  const producer: AndroidCameraProducerReceipts = {
    captureRunId: RUN_ID,
    identity,
    producerStatus: 'receipts-bound',
    sourceSelectionHash: androidCameraSelectionHash(current),
    localeStatus: 'qualified',
    permission: {
      status: 'denied',
      before: { status: 'denied', decisionFlags: [] },
      after: { status: 'denied', decisionFlags: [] },
    },
    frames,
    pendingConnectionId: 'pending-1',
    submissionRequestId: 2,
    transportRequestWindow: {
      beforeRequestId: 0,
      throughRequestId: 2,
      requestId: 2,
    },
    manualCodeSha256: codeHash,
    manualCodeSource: {
      source: 'owned-android-coach-hierarchy',
      frameLabel: 'coach-home',
      sourcePath: 'coach-home.json',
      sourceSha256: frameHash,
      sourceSizeBytes: 5,
      sourceOwnerUid: process.getuid?.() ?? -1,
      sourceMode: 0o600,
      sourceVerification: 'owned-stable-reader-v6',
      commandLabel: 'coach-home-hierarchy',
      commandOrdinal: 1,
      commandPid: 4321,
      commandPgid: 4321,
      commandExecution: 'completed',
      commandCleanup: 'cleaned',
      commandArgvSha256: digest('argv'),
      captureRunId: RUN_ID,
      ownerRunId: OWNER_RUN_ID,
      actor: 'coach',
      actorAuthUidSha256: digest('actor'),
      codeSha256: codeHash,
    },
    submission: {
      requestId: 2,
      bodyHash: frameHash,
      recorderBodyHash: frameHash,
      manualCodeSha256: codeHash,
      actionSha256: digest('action'),
      sourcePath: 'submission.body.json',
      sourceSha256: frameHash,
      descriptorPath: 'submission.descriptor.json',
      backendAttemptId: `${FIXTURE_RUN_ID}:first`,
      apiPid: 4321,
      apiOrigin: TARGET.apiOrigin,
    },
    primaryFixtureAuthUids: [...PRIMARY_FIXTURE_AUTH_UIDS],
    primaryExpected: structuredClone(PRIMARY_EXPECTED),
    isolationExpected: structuredClone(ISOLATION_EXPECTED),
    isolationFixture: {
      path: 'fixtures-native-connection-isolation-android.private.json',
      sizeBytes: 1,
      sha256: digest('isolation-fixture'),
      ownerUid: process.getuid?.() ?? -1,
      mode: 0o600,
      kind: 'sidecar',
      verification: 'owned-stable-reader-v6',
      source: 'owned-session.fixtures',
      runId: FIXTURE_RUN_ID,
      scope: ISOLATION_EXPECTED.scope,
      fixtureAuthUids: [...ISOLATION_FIXTURE_AUTH_UIDS],
      target: { ...ISOLATION_EXPECTED.target },
    },
    sqlReceipts,
    permissionCommandLabels: [
      'camera-permission-clear',
      'camera-permission-revoke',
      'camera-permission-before-check',
      'camera-permission-after-check',
    ],
  };
  return producer;
}

function runtime(
  currentProducer: AndroidCameraProducerReceipts,
  captureRoot: string,
): AndroidCameraPublicAttemptResult {
  return {
    kind: 'private-owned-android-camera-public-attempt-not-public-receipt',
    requestedRunId: REQUESTED_ID,
    requestedAttemptId: `${REQUESTED_ID}:first`,
    captureRunId: RUN_ID,
    backendRunId: currentProducer.identity.backendRunId,
    backendAttemptId: currentProducer.identity.backendAttemptId,
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
    captureInvocation: {
      count: 1,
      returned: true,
      exitCode: 0,
      result: 'observed',
    },
    captureCompleted: true,
    externalCleanupResult: 'passed',
    verificationResult: 'source-only',
    verificationFailure: null,
    postCaptureFailure: null,
    deadline: null,
    commandDiagnostics: [
      {
        label: 'dispatch-fixture',
        phase: 'step',
        execution: 'completed',
        cleanup: 'cleaned',
        childExitCode: 0,
        childSignal: null,
        deadlineMs: null,
        censusFailure: null,
        outputFailure: null,
      },
    ],
    censusFailures: [],
    outputFailures: [],
    assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
    assertionContractSha256: null,
    fixtureRunId: currentProducer.identity.backendRunId,
    fixtureHash: digest('fixture'),
    flagsHash: digest('flags'),
    toolVersions: { maestro: '2.6.1' },
    timingsMs: {
      build: 1,
      install: 1,
      reset: 1,
      scenario: 1,
      verify: 1,
      cleanup: 1,
    },
    stagedManifestPath: null,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    artifactRoot: captureRoot,
    cameraProducer: currentProducer,
    nativeRuntime: null,
    nativeRuntimeFailure: null,
    nativeRuntimeEligibility: null,
    nativeRuntimeFinalizerReceipt: null,
  };
}

async function writeNativeRuntimeProvenance(
  fixture: Awaited<ReturnType<typeof createAndroidCameraEligibilityFixture>>,
  deadlineAt: number,
): Promise<{
  provenance: {
    mode: 'native-runtime';
    receiptPath: string;
    receiptSha256: string;
  };
  driver: AndroidCameraNativeRuntimeDriverResult;
}> {
  const reportBytes = await readFile(path.join(fixture.captureRoot, 'capture.private.json'));
  const report = JSON.parse(reportBytes.toString('utf8')) as Record<string, unknown>;
  const source = report.source as Record<string, unknown>;
  const helperInputs = report.helperInputsBefore as readonly {
    path: string;
    sha256: string;
  }[];
  const driver: AndroidCameraNativeRuntimeDriverResult = {
    kind: 'private-owned-android-camera-native-runtime-driver-result-not-public-receipt',
    status: 'native-observed',
    platform: 'android',
    engine: 'maestro',
    requestedRunId: REQUESTED_ID,
    requestedAttemptId: `${REQUESTED_ID}:first`,
    captureRunId: RUN_ID,
    fixtureRunId: fixture.producer.identity.backendRunId,
    ownerRunId: fixture.producer.identity.ownerRunId,
    target: fixture.target,
    process: {
      apiPid: fixture.producer.identity.apiPid,
      pgid: fixture.producer.identity.apiPid,
      apiStarted: fixture.producer.identity.apiStarted,
      apiOrigin: fixture.producer.identity.apiOrigin,
      ownerRunId: fixture.producer.identity.ownerRunId,
      targetDeviceId: fixture.producer.identity.serial,
    },
    acquisition: {
      status: 'acquired',
      result: 'observed',
      cleanup: 'cleaned',
      externalCleanup: 'passed',
      commandDiagnostics: [
        {
          label: 'android-camera-native-session',
          pid: fixture.producer.identity.apiPid,
          pgid: fixture.producer.identity.apiPid,
          startedAt: fixture.producer.identity.apiStarted,
          execution: 'completed',
          cleanup: 'cleaned',
        },
      ],
    },
    sourceTreeHash: source.sourceTreeHash as string,
    helperInputs,
    captureReport: {
      path: 'capture.private.json',
      sha256: digest(reportBytes),
    },
    frames: fixture.producer.frames.map((frame) => ({
      label: frame.label,
      path: frame.path,
      sha256: frame.sha256,
      sizeBytes: frame.sizeBytes,
      invocationId: frame.action.invocationId,
      ordinal: frame.action.ordinal,
      commandOrdinal: frame.action.commandOrdinal,
      commandLabel: frame.action.commandLabel,
    })),
    sqlParents: fixture.producer.sqlReceipts.map((row) => ({
      parentRoot: row.parentSnapshotRoot,
      parentManifestPath: row.parentManifestPath,
      parentManifestRetainedPath: row.parentManifestRetainedPath,
      parentManifestRetainedKind: row.parentManifestRetainedKind,
      parentManifestRetainedSha256: row.parentManifestRetainedSha256,
      parentManifestRetainedSizeBytes: row.parentManifestRetainedSizeBytes,
      parentManifestRetainedOwnerUid: row.parentManifestRetainedOwnerUid,
      parentManifestRetainedMode: row.parentManifestRetainedMode,
      parentManifestRetainedVerification: row.parentManifestRetainedVerification,
      parentManifestSizeBytes: row.parentManifestSizeBytes,
      retainedPath: row.parentSnapshotRetainedPath,
      retainedKind: row.parentSnapshotRetainedKind,
      retainedSha256: row.parentSnapshotRetainedSha256,
      retainedSizeBytes: row.parentSnapshotRetainedSizeBytes,
      retainedOwnerUid: row.parentSnapshotRetainedOwnerUid,
      retainedMode: row.parentSnapshotRetainedMode,
      retainedVerification: row.parentSnapshotRetainedVerification,
      parentApiLedgerPath: row.parentApiLedgerPath,
      parentApiLedgerRetainedPath: row.parentApiLedgerRetainedPath,
      parentApiLedgerRetainedKind: row.parentApiLedgerRetainedKind,
      parentApiLedgerRetainedSha256: row.parentApiLedgerRetainedSha256,
      parentApiLedgerRetainedSizeBytes: row.parentApiLedgerRetainedSizeBytes,
      parentApiLedgerRetainedOwnerUid: row.parentApiLedgerRetainedOwnerUid,
      parentApiLedgerRetainedMode: row.parentApiLedgerRetainedMode,
      parentApiLedgerRetainedVerification: row.parentApiLedgerRetainedVerification,
      parentApiLedgerSizeBytes: row.parentApiLedgerSizeBytes,
      path: row.parentSnapshotPath,
      sha256: row.parentSnapshotSha256,
      runId: row.parentRunId,
      attemptId: row.parentBackendAttemptId,
      apiOrigin: row.parentApiOrigin,
      apiPid: row.parentApiPid,
      apiStarted: row.parentApiStarted,
      apiScript: row.parentApiScript,
      manifestSha256: row.parentManifestSha256,
      apiAttempt: row.parentApiAttempt,
      apiLedgerSha256: row.parentApiLedgerSha256,
    })),
    deadlineAt,
  };
  const provenance = await writeAndroidCameraNativeRuntimeReceipt({
    artifactRoot: fixture.captureRoot,
    driver,
    producer: fixture.producer,
    selection: fixture.selection,
    deadlineAt,
  });
  return { provenance, driver };
}

function eligibility(
  input: AndroidCameraRuntimeEligibilityInput,
): AndroidCameraRuntimeEligibilityResult {
  const sourceOnly = input.sourceOnlyTestLabel !== undefined;
  const bindings = ANDROID_CAMERA_ASSERTION_IDS.map((id) => ({
    id,
    requirementRefs: ['TC-camera-runtime'],
    evidenceKinds: ['ui', 'api', 'sql'] as const,
    evidencePaths: [`staged/${id}.private.json`],
  }));
  const stage = {
    copyManifest: {
      path: 'android-camera-public-manifest.private.json',
      sha256: 'd'.repeat(64),
    },
    artifacts: ['android-camera-public-manifest.private.json'],
    assertions: [] as const,
    status: 'validated-source-only' as const,
    assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
    nativePassingCases: 0 as const,
    publicPassingCases: 0 as const,
    publicPromotionEligible: false as const,
    selectionBinding: {
      arguments: input.selection.arguments,
      scenario: input.selection.scenario,
      scenarioHash: input.selection.scenarioHash,
      requirementHash: input.selection.requirementHash,
      assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
    },
  } satisfies AndroidCameraPublicStageResult;
  return {
    kind: 'private-android-camera-runtime-eligibility-not-public-receipt',
    status: sourceOnly ? 'validated-source-only' : 'verified-native-private',
    verificationMode: sourceOnly ? 'source-only-control' : 'native-runtime',
    captureRunId: input.captureRunId,
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    fixtureRunId: input.fixtureRunId,
    evidenceProof: {
      kind: 'private-android-camera-runtime-evidence-proof',
      status: 'verified-owned-receipts',
      captureRunId: input.captureRunId,
      fixtureRunId: input.fixtureRunId,
      source: {
        sha: digest('source').slice(0, 40),
        dirty: true,
        sourceTreeHash: digest('source-tree'),
      },
      helperInputs: [{ path: 'fixture-helper', sha256: digest('helper') }],
      savedFlow: {
        path: '.maestro/flows/camera-denied-android.yaml',
        sha256: digest('saved-flow'),
        scenarioId: 'SCN-camera-denied-android',
        flowId: 'FLW-camera-denied',
        fixtureRef: 'owned-postgres:SCN-camera-denied-android:fresh-attempt',
        runtimeFixtureRef: `owned-postgres:native-entry-android:${input.fixtureRunId}`,
        runtimeFixtureRunId: input.fixtureRunId,
        runtimeFixtureScope: 'native-entry-android',
      },
      target: input.target,
      build: {
        path: 'build.apk',
        sha256: digest('build'),
        sizeBytes: 1,
        identity: {
          dev: 1,
          ino: 1,
          uid: process.getuid?.() ?? -1,
          gid: process.getgid?.() ?? -1,
          mode: 0o600,
          size: 1,
          mtimeMs: 0,
          ctimeMs: 0,
          nlink: 1,
        },
      },
      localeBinding: input.producer.identity.locale.binding,
      assertionBindings: bindings,
      sqlParents: input.producer.sqlReceipts,
      stage,
      nativeDriver: input.nativeDriver,
      runtimeProvenance: input.sourceOnlyTestLabel
        ? { mode: 'source-only-control', label: input.sourceOnlyTestLabel }
        : input.runtimeProvenance!,
    },
    assertionBindings: bindings,
    stage,
    nativePassingCases: sourceOnly ? 0 : 4,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    sourceOnlyTestLabel: input.sourceOnlyTestLabel ?? null,
    runtimeProvenance: input.sourceOnlyTestLabel
      ? { mode: 'source-only-control', label: input.sourceOnlyTestLabel }
      : input.runtimeProvenance!,
  };
}

async function fixture(): Promise<{
  input: AndroidCameraRuntimeDispatchInput & {
    runtime: AndroidCameraPublicAttemptResult;
  };
  producer: AndroidCameraProducerReceipts;
  cleanup: () => Promise<void>;
}> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'mc-camera-dispatch-')));
  const captureRoot = path.join(parent, 'capture');
  const outputRoot = path.join(parent, REQUESTED_ID);
  await mkdir(captureRoot, { mode: 0o700 });
  await mkdir(outputRoot, { mode: 0o700 });
  await chmod(captureRoot, 0o700);
  await chmod(outputRoot, 0o700);
  await writeFile(
    path.join(captureRoot, 'capture.private.json'),
    JSON.stringify({
      kind: 'private-owned-native-camera-denied-execution-not-public-receipt',
      captureRunId: RUN_ID,
      device: { runId: OWNER_RUN_ID },
    }),
    { mode: 0o600 },
  );
  const current = selection();
  const currentProducer = producer(current);
  const currentRuntime = runtime(currentProducer, captureRoot);
  const input: AndroidCameraRuntimeDispatchInput = {
    repositoryRoot: process.cwd(),
    captureRoot,
    outputRoot,
    requestedRunId: REQUESTED_ID,
    requestedAttemptId: `${REQUESTED_ID}:first`,
    captureRunId: RUN_ID,
    fixtureRunId: FIXTURE_RUN_ID,
    selection: current,
    target: TARGET,
    expectedLocale: 'en-US',
    producer: currentProducer,
    runtime: currentRuntime,
    signal: new AbortController().signal,
    deadlineAt: performance.now() + 30_000,
    sourceOnlyTestLabel: 'sealed-source-control:dispatch-positive',
    verifier: (candidate) => Promise.resolve(eligibility(candidate)),
  };
  return {
    input: input as AndroidCameraRuntimeDispatchInput & {
      runtime: AndroidCameraPublicAttemptResult;
    },
    producer: currentProducer,
    cleanup: () => rm(parent, { recursive: true, force: true }),
  };
}

void test('dispatch runs the sealed verifier against the complete original camera receipt fixture', async () => {
  const value = await createAndroidCameraEligibilityFixture();
  try {
    const currentRuntime = runtime(value.producer, value.captureRoot);
    const result = await dispatchAndroidCameraRuntime({
      repositoryRoot: process.cwd(),
      captureRoot: value.captureRoot,
      outputRoot: await requestedOutputRoot(value),
      requestedRunId: REQUESTED_ID,
      requestedAttemptId: `${REQUESTED_ID}:first`,
      captureRunId: RUN_ID,
      fixtureRunId: value.producer.identity.backendRunId,
      selection: value.selection,
      target: value.target,
      expectedLocale: 'en-US',
      producer: value.producer,
      runtime: currentRuntime,
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 120_000,
      sourceOnlyTestLabel: 'sealed-source-control:actual-receipt-graph',
    });
    assert.equal(result.status, 'validated-source-only');
    assert.equal(result.publicPromotionEligible, false);
    assert.deepEqual(
      result.assertionBindings.map((row) => row.id),
      [...ANDROID_CAMERA_ASSERTION_IDS],
    );
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
  }
});

void test('dispatch reaches native runtime eligibility only through the original producer provenance receipt', async () => {
  const value = await createAndroidCameraEligibilityFixture();
  try {
    const deadlineAt = performance.now() + 120_000;
    const { provenance: runtimeProvenance, driver } = await writeNativeRuntimeProvenance(
      value,
      deadlineAt,
    );
    const result = await dispatchAndroidCameraRuntime({
      repositoryRoot: process.cwd(),
      captureRoot: value.captureRoot,
      outputRoot: await requestedOutputRoot(value),
      requestedRunId: REQUESTED_ID,
      requestedAttemptId: `${REQUESTED_ID}:first`,
      captureRunId: RUN_ID,
      fixtureRunId: value.producer.identity.backendRunId,
      selection: value.selection,
      target: value.target,
      expectedLocale: 'en-US',
      producer: value.producer,
      runtime: null,
      nativeDriver: driver,
      signal: new AbortController().signal,
      deadlineAt,
      runtimeProvenance,
    });
    assert.equal(result.status, 'verified-native-private');
    assert.equal(result.verificationMode, 'native-runtime');
    assert.equal(result.nativePassingCases, 4);
    assert.equal(result.publicPassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.deepEqual(result.runtimeProvenance, runtimeProvenance);
    assert.deepEqual(
      result.assertionBindings.map((row) => row.id),
      [...ANDROID_CAMERA_ASSERTION_IDS],
    );
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
  }
});

void test('dispatch delegates original producer to sealed source-only verifier and returns zero-pass finalization', async () => {
  const current = await fixture();
  try {
    let observed: AndroidCameraRuntimeEligibilityInput | undefined;
    const result = await dispatchAndroidCameraRuntime({
      ...current.input,
      verifier: (candidate) => {
        observed = candidate;
        return Promise.resolve(eligibility(candidate));
      },
    });
    assert.ok(observed);
    assert.equal(observed.producer, current.producer);
    assert(observed.runtime);
    assert.equal(observed.runtime.cameraProducer, current.producer);
    assert.equal(result.status, 'validated-source-only');
    assert.equal(result.publicPromotionEligible, false);
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPassingCases, 0);
    assert.equal(result.stageManifestPath, result.eligibility.stage.copyManifest.path);
  } finally {
    await current.cleanup();
  }
});

void test('dispatch rejects missing, foreign, cancelled, or incomplete terminal cleanup before verifier', async () => {
  const cases: [
    string,
    (
      input: AndroidCameraRuntimeDispatchInput & {
        runtime: AndroidCameraPublicAttemptResult;
      },
    ) => AndroidCameraRuntimeDispatchInput,
  ][] = [
    [
      'missing producer',
      (input) => ({
        ...input,
        runtime: { ...input.runtime, cameraProducer: null },
      }),
    ],
    [
      'foreign capture',
      (input) => ({
        ...input,
        runtime: { ...input.runtime, captureRunId: FIXTURE_RUN_ID },
      }),
    ],
    ['wrong first attempt', (input) => ({ ...input, requestedAttemptId: `${REQUESTED_ID}:retry` })],
    [
      'cancelled',
      (input) => ({
        ...input,
        runtime: { ...input.runtime, cancellation: 'SIGTERM' },
      }),
    ],
    [
      'deadline',
      (input) => ({
        ...input,
        runtime: {
          ...input.runtime,
          deadline: { step: 'scenario', deadlineMs: 1 },
        },
      }),
    ],
    [
      'cleanup failed',
      (input) => ({
        ...input,
        runtime: { ...input.runtime, externalCleanupResult: 'failed' },
      }),
    ],
    [
      'child failed',
      (input) => ({
        ...input,
        runtime: {
          ...input.runtime,
          childExitCode: 1,
          childClassification: 'child-failed',
        },
      }),
    ],
    [
      'output failure',
      (input) => ({
        ...input,
        runtime: { ...input.runtime, outputFailures: [{ label: 'tampered' }] },
      }),
    ],
  ];
  for (const [label, alter] of cases) {
    const current = await fixture();
    try {
      let called = false;
      await assert.rejects(
        dispatchAndroidCameraRuntime({
          ...alter(current.input),
          verifier: (candidate) => {
            called = true;
            return Promise.resolve(eligibility(candidate));
          },
        }),
        /Android|camera|attempt|producer|cleanup|child|output|deadline|invalid|missing|Expected values/i,
        label,
      );
      assert.equal(called, false, `${label} reached eligibility verifier`);
    } finally {
      await current.cleanup();
    }
  }
});

void test('dispatch keeps source, build, UI, SQL, transport and locale failures from being bypassed', async () => {
  const labels = ['source', 'build', 'ui', 'sql', 'transport', 'locale'] as const;
  for (const label of labels) {
    const current = await fixture();
    try {
      await assert.rejects(
        dispatchAndroidCameraRuntime({
          ...current.input,
          verifier: () => Promise.reject(new Error(`sealed-verifier-${label}-mismatch`)),
        }),
        new RegExp(`sealed-verifier-${label}-mismatch`),
        `${label} verifier failure was bypassed`,
      );
    } finally {
      await current.cleanup();
    }
  }
});

void test('dispatch rejects invalid selection, label, deadline, and producer envelope before staging', async () => {
  const current = await fixture();
  try {
    Object.assign(current.input, { sourceOnlyTestLabel: 'source-only' });
    await assert.rejects(
      dispatchAndroidCameraRuntime(current.input),
      /source-only label is invalid/,
    );
    Object.assign(current.input, {
      sourceOnlyTestLabel: 'sealed-source-control:dispatch-positive',
    });
    await assert.rejects(
      dispatchAndroidCameraRuntime({
        ...current.input,
        sourceOnlyTestLabel: undefined,
        runtimeProvenance: undefined,
      }),
      /requires native provenance/,
    );
    await assert.rejects(
      dispatchAndroidCameraRuntime({
        ...current.input,
        deadlineAt: performance.now() - 1,
      }),
      /deadline has expired/,
    );
    await assert.rejects(
      dispatchAndroidCameraRuntime({
        ...current.input,
        selection: {
          ...current.input.selection,
          arguments: { ...current.input.selection.arguments, engine: 'detox' as never },
        },
      }),
      /Android camera selection|maestro/,
    );
    await assert.rejects(
      dispatchAndroidCameraRuntime({
        ...current.input,
        runtime: {
          ...current.input.runtime,
          cameraProducer: {
            ...current.producer,
            sourceSelectionHash: 'e'.repeat(64),
          },
        },
      }),
      /source selection hash|Android camera producer|Expected values/,
    );
  } finally {
    await current.cleanup();
  }
});

void test('dispatch rejects producer action, SQL parent, locale, target and owner provenance drift', async () => {
  const cases: [
    string,
    (producer: AndroidCameraProducerReceipts) => AndroidCameraProducerReceipts,
  ][] = [
    [
      'frame action',
      (value) => ({
        ...value,
        frames: value.frames.map((frame, index) =>
          index === 0 ? { ...frame, action: { ...frame.action, commandLabel: '' } } : frame,
        ),
      }),
    ],
    [
      'SQL parent',
      (value) => ({
        ...value,
        sqlReceipts: value.sqlReceipts.map((receipt, index) =>
          index === 0 ? { ...receipt, parentSnapshotSha256: 'f'.repeat(63) } : receipt,
        ),
      }),
    ],
    [
      'locale',
      (value) => ({
        ...value,
        identity: {
          ...value.identity,
          locale: { ...value.identity.locale, requestedLocale: 'pt-BR' },
        },
      }),
    ],
    [
      'target',
      (value) => ({
        ...value,
        identity: {
          ...value.identity,
          target: { ...value.identity.target, deviceId: 'emulator-9999' },
        },
      }),
    ],
  ];
  for (const [label, alter] of cases) {
    const current = await fixture();
    try {
      let called = false;
      await assert.rejects(
        dispatchAndroidCameraRuntime({
          ...current.input,
          runtime: {
            ...current.input.runtime,
            cameraProducer: alter(current.producer),
          },
          verifier: (candidate) => {
            called = true;
            return Promise.resolve(eligibility(candidate));
          },
        }),
        /Android camera|invalid|duplicated|Expected values|missing|expression/i,
        label,
      );
      assert.equal(called, false, `${label} reached eligibility verifier`);
    } finally {
      await current.cleanup();
    }
  }
});

void test('dispatch rejects crossed primary and isolation fixture identities before staging', async () => {
  const cases: [
    string,
    (producer: AndroidCameraProducerReceipts) => AndroidCameraProducerReceipts,
  ][] = [
    [
      'primary allowlist includes isolation actor',
      (value) => ({
        ...value,
        primaryFixtureAuthUids: [...value.primaryFixtureAuthUids, 'isolation-coach'],
      }),
    ],
    [
      'isolation expected scope crosses primary scope',
      (value) => ({
        ...value,
        isolationExpected: {
          ...value.isolationExpected,
          scope: 'native-entry-android',
        },
      }),
    ],
  ];
  for (const [label, alter] of cases) {
    const current = await fixture();
    try {
      const crossed = alter(current.producer);
      let called = false;
      await assert.rejects(
        dispatchAndroidCameraRuntime({
          ...current.input,
          producer: crossed,
          runtime: { ...current.input.runtime, cameraProducer: crossed },
          verifier: (candidate) => {
            called = true;
            return Promise.resolve(eligibility(candidate));
          },
        }),
        /Android camera|fixture|isolation|primary|scope|Expected values/i,
        label,
      );
      assert.equal(called, false, `${label} reached eligibility verifier`);
    } finally {
      await current.cleanup();
    }
  }
});

void test('Android camera runtime closure is declared and the deadline is fixed before reads', async () => {
  const runtimePaths: readonly (typeof androidCameraPublicRequiredSourcePaths)[number][] = [
    'scripts/testing/native-android-camera-runtime-driver.ts',
    'scripts/testing/native-android-camera-runtime-collector.ts',
    'scripts/testing/native-android-camera-runtime-dispatch.ts',
    'scripts/testing/native-android-camera-runtime-eligibility.ts',
    'scripts/testing/native-android-camera-runtime-receipt.ts',
    'scripts/testing/native-android-camera-runtime-finalizer.ts',
  ];
  for (const runtimePath of runtimePaths)
    assert(androidCameraPublicRequiredSourcePaths.includes(runtimePath));
  const generator = await readFile(
    path.join(process.cwd(), 'scripts/testing/generate-native-declaration.py'),
    'utf8',
  );
  for (const runtimePath of runtimePaths)
    assert.match(generator, new RegExp(`"[^"]*runtime-[^"]*source"\\s*:\\s*"${runtimePath}"`));

  let attemptCalled = false;
  await assert.rejects(
    runAndroidCameraPublicAttempt({
      repositoryRoot: process.cwd(),
      outputRoot: process.cwd(),
      requestedRunId: REQUESTED_ID,
      selection: selection(),
      signal: new AbortController().signal,
      deadlineAt: performance.now() - 1,
      attemptRunner: () => {
        attemptCalled = true;
        throw new Error('attempt runner must not run after an expired entry deadline');
      },
    }),
    /deadline expired before entry/,
  );
  assert.equal(attemptCalled, false);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { androidSourceIdentity } from '../../scripts/testing/android-build-identity';
import {
  ANDROID_CAMERA_APK_MAX_BYTES,
  ANDROID_CAMERA_DETOX_RUNTIME_HELPER_PATHS,
  readAndroidCameraBuildArtifact,
  verifyAndroidCameraRuntimeEligibility,
} from '../../scripts/testing/native-android-camera-runtime-eligibility';
import {
  finalizeAndroidCameraNativeRuntime,
  publishAndroidCameraNativeRuntimeFinalizerReceipt,
} from '../../scripts/testing/native-android-camera-runtime-finalizer';
import { writeAndroidCameraNativeRuntimeReceipt } from '../../scripts/testing/native-android-camera-runtime-receipt';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  androidCameraSelectionHash,
} from '../../scripts/testing/native-camera-android-contract';
import { buildNativeLocaleBinding } from '../../scripts/testing/native-locale-capture-seam';
import {
  type NativePilotSelection,
  type NativePilotTarget,
} from '../../scripts/testing/native-pilot-contract';
import type { NativeLocaleEvidence } from '../../scripts/testing/locale-native-observation';
import type { AndroidCameraNativeRuntimeDriverResult } from '../../scripts/testing/native-android-camera-runtime-driver';
import type {
  AndroidCameraSqlReceiptPhase,
  AndroidCameraSqlSourceReceipt,
} from '../../scripts/testing/native-camera-android-observation';
import type {
  AndroidCameraFrameSummary,
  AndroidCameraProducerReceipts,
} from '../../scripts/testing/native-camera-android-producer';
import type { AndroidCameraPublicAttemptResult } from '../../scripts/testing/run-android-camera-public-attempt';

const ROOT = process.cwd();
const RUN_ID = '0123456789abcdef01234567';
const REQUESTED_ID = 'cccccccccccccccccccccccc';
const BACKEND_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const OWNER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BINARY = 'c7810662d924b9e1458b161344f18b944971ed7a42ab054e3d078af207af8eb5';
const CAMERA_BUILD_PROFILE =
  'Metro-attached devDebug arm64; no app-domain instrumentation; optional separately bound read-only input reader; not bundled release qualification';
const API_ORIGIN = 'http://127.0.0.1:1234';
const API_PID = 4321;
const API_STARTED = '2026-10-02T00:00:00.000Z';
const API_SCRIPT = path.join(ROOT, 'scripts/testing/owned-session.ts');
const OWNER_UID = process.getuid?.() ?? -1;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value) + '\n');
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

function isolationFixtureDocument(runId: string) {
  const account = (authUid: string, role: string | null) => ({
    email: `${authUid}@example.test`,
    password: 'isolation-password',
    authUid,
    role,
  });
  return {
    schemaVersion: 1 as const,
    runId,
    scope: 'native-conn-isolation-android',
    accounts: {
      new: account('isolation-new', null),
      student: account('isolation-student', 'student'),
      coach: account('isolation-coach', 'professional'),
      'unrelated-student': account('isolation-unrelated-student', 'student'),
      'unrelated-coach': account('isolation-unrelated-coach', 'professional'),
      'pending-student': account('isolation-pending-student', 'student'),
      'active-student': account('isolation-active-student', 'student'),
    },
    pendingConnectionId: '01234567-89ab-cdef-0123-456789abcdef',
    activeConnectionId: '11234567-89ab-cdef-0123-456789abcdef',
    savedPlanId: 'training_plan_01234567-89ab-cdef-0123-456789abcdef',
    draft: {
      name: 'Isolation plan',
      sessions: [
        {
          id: 'isolation-session',
          name: 'Isolation session',
          notes: '',
          items: [
            {
              id: 'isolation-item',
              name: 'Isolation exercise',
              quantity: '1',
              notes: '',
              exerciseId: '01234567-89ab-cdef-0123-456789abcdef',
            },
          ],
        },
      ],
    },
  };
}

async function writePrivate(
  root: string,
  relative: string,
  bytes: Buffer,
): Promise<{
  path: string;
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
  verification: 'owned-stable-reader-v6';
}> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  return {
    path: relative,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    ownerUid: OWNER_UID,
    mode: 0o600,
    verification: 'owned-stable-reader-v6',
  };
}

const REAL_ANDROID_APK_BYTES = 82_175_004;

async function apkReaderFixture(
  sizeBytes: number,
  initialBytes = Buffer.from([0]),
): Promise<{
  parent: string;
  root: string;
  apkPath: string;
}> {
  const parent = await mkdtemp(path.join(tmpdir(), 'android-camera-apk-reader-'));
  const rootPath = path.join(parent, 'capture');
  await mkdir(rootPath, { mode: 0o700 });
  const root = await realpath(rootPath);
  const apkPath = path.join(root, 'app.apk');
  await writeFile(apkPath, initialBytes, { mode: 0o600 });
  await truncate(apkPath, sizeBytes);
  return { parent, root, apkPath };
}

async function hashFileWithoutBuffering(filePath: string): Promise<string> {
  const descriptor = await open(filePath, 'r');
  try {
    const digest = createHash('sha256');
    const chunk = Buffer.alloc(64 * 1024);
    let remaining = (await descriptor.stat()).size;
    while (remaining > 0) {
      const result = await descriptor.read(chunk, 0, Math.min(chunk.length, remaining), null);
      assert(result.bytesRead > 0, 'APK test hash reader made no progress');
      digest.update(chunk.subarray(0, result.bytesRead));
      remaining -= result.bytesRead;
    }
    return digest.digest('hex');
  } finally {
    await descriptor.close();
  }
}

function cameraSelection(): NativePilotSelection {
  const rows: NonNullable<NativePilotSelection['scenario']['pilotAssertions']> = [
    {
      id: 'NAT-camera-normal-entry',
      requirementRefs: ['SC-211', 'UC-002.9', 'BL-018/P4-camera-denied'],
      requirementPaths: ['docs/plans/2026-09-28-testing-structure-and-maestro-plan.md'],
      evidenceKinds: ['ui', 'api', 'sql'],
      startingState: 'Fresh student camera entry',
      action: 'Open the camera entry and inspect the prompt',
      expected: 'The owned student camera entry is visible',
      evidencePathTemplates: [
        'assertions/{attemptId}/normal-entry-ui.private.json',
        'assertions/{attemptId}/normal-entry-api.private.json',
        'assertions/{attemptId}/normal-entry-sql.private.json',
      ],
    },
    {
      id: 'NAT-camera-denial-guidance',
      requirementRefs: ['SC-211', 'UC-002.9', 'BL-018/P4-camera-denied'],
      requirementPaths: ['docs/plans/2026-09-28-testing-structure-and-maestro-plan.md'],
      evidenceKinds: ['ui'],
      startingState: 'Camera permission prompt',
      action: 'Deny the platform permission once',
      expected: 'Manual guidance is visible',
      evidencePathTemplates: ['assertions/{attemptId}/denial-guidance-ui.private.json'],
    },
    {
      id: 'NAT-camera-manual-submit',
      requirementRefs: ['SC-211', 'UC-002.9', 'BL-018/P4-camera-denied'],
      requirementPaths: ['docs/plans/2026-09-28-testing-structure-and-maestro-plan.md'],
      evidenceKinds: ['ui', 'api', 'sql'],
      startingState: 'Manual camera guidance',
      action: 'Enter the owned invite code and submit once',
      expected: 'The owned pending connection is visible',
      evidencePathTemplates: [
        'assertions/{attemptId}/manual-submit-ui.private.json',
        'assertions/{attemptId}/manual-submit-api.private.json',
        'assertions/{attemptId}/manual-submit-sql.private.json',
      ],
    },
    {
      id: 'NAT-camera-unrelated-state',
      requirementRefs: ['SC-211', 'UC-002.9', 'BL-018/P4-camera-denied'],
      requirementPaths: ['docs/plans/2026-09-28-testing-structure-and-maestro-plan.md'],
      evidenceKinds: ['sql'],
      startingState: 'Scoped connection and training baseline',
      action: 'Compare all unrelated snapshots after the submission',
      expected: 'Unrelated rows are unchanged',
      evidencePathTemplates: ['assertions/{attemptId}/unrelated-state-sql.private.json'],
    },
  ];
  return {
    arguments: {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-android',
      mode: 'integration',
    },
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
    scenario: {
      id: 'SCN-camera-denied-android',
      flowId: 'FLW-camera-denied',
      maestroFlow: '.maestro/flows/camera-denied-android.yaml',
      maestroFlowSha256: '47c06ed1bfab1245f0a042433e4bdf6f74697af0a2c674f13f523bc744515e78',
      platform: 'android',
      engine: 'maestro',
      transitionIds: [
        'TRN-student-login',
        'TRN-camera-request',
        'TRN-camera-deny',
        'TRN-camera-manual',
      ],
      requirementRefs: ['SC-211', 'UC-002.9', 'BL-018/P4-camera-denied'],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:SCN-camera-denied-android:fresh-attempt',
      freshnessInputs: {
        requirementPaths: ['docs/plans/2026-09-28-testing-structure-and-maestro-plan.md'],
      },
      pilotAssertions: rows,
      pilotAssertionContract: {
        count: rows.length,
        sha256: sha256(canonical(rows)),
        dataMode: 'postgres',
      },
    },
  };
}

type FixtureTarget = NativePilotTarget & {
  deviceId: string;
  osVersion: string;
  appId: string;
  buildProfile: string;
  binaryHash: string;
  apiOrigin: string;
};

function target(): FixtureTarget {
  return {
    deviceId: 'emulator-5554',
    osVersion: '37',
    appId: 'com.edufelip.mychampions.dev',
    buildProfile: 'dev-debug-arm64',
    binaryHash: BINARY,
    apiOrigin: API_ORIGIN,
  };
}

function runtime(producer: AndroidCameraProducerReceipts): AndroidCameraPublicAttemptResult {
  return {
    kind: 'private-owned-android-camera-public-attempt-not-public-receipt',
    requestedRunId: REQUESTED_ID,
    requestedAttemptId: `${REQUESTED_ID}:first`,
    captureRunId: RUN_ID,
    backendRunId: BACKEND_ID,
    backendAttemptId: `${BACKEND_ID}:first`,
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
    commandDiagnostics: [],
    censusFailures: [],
    outputFailures: [],
    assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
    assertionContractSha256: null,
    fixtureRunId: BACKEND_ID,
    fixtureHash: null,
    flagsHash: null,
    toolVersions: { node: process.version, maestro: '2.6.1' },
    timingsMs: {
      build: 0,
      install: 0,
      reset: 0,
      scenario: 0,
      verify: 0,
      cleanup: 0,
    },
    stagedManifestPath: null,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    artifactRoot: '/private/capture',
    cameraProducer: producer,
    nativeRuntime: null,
    nativeRuntimeFailure: null,
    nativeRuntimeEligibility: null,
    nativeRuntimeFinalizerReceipt: null,
  };
}

function localeEvidence(
  binding: ReturnType<typeof buildNativeLocaleBinding>,
): NativeLocaleEvidence {
  return {
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
    binding,
  };
}

async function writeNativeRuntimeProvenance(
  fixture: {
    captureRoot: string;
    producer: AndroidCameraProducerReceipts;
    target: NativePilotTarget;
    selection: NativePilotSelection;
  },
  deadlineAt: number,
): Promise<{
  provenance: {
    mode: 'native-runtime';
    receiptPath: string;
    receiptSha256: string;
  };
  driver: AndroidCameraNativeRuntimeDriverResult;
}> {
  const reportPath = path.join(fixture.captureRoot, 'capture.private.json');
  const reportBytes = await readFile(reportPath);
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
    fixtureRunId: BACKEND_ID,
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
      sha256: sha256(reportBytes),
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

type Fixture = {
  captureParent: string;
  captureRoot: string;
  parentParent: string;
  parentRoot: string;
  outputParent: string;
  outputRoot: string;
  selection: NativePilotSelection;
  producer: AndroidCameraProducerReceipts;
  target: NativePilotTarget;
};

async function fixture(): Promise<Fixture> {
  const selection = cameraSelection();
  const captureParent = await realpath(
    await mkdtemp(path.join(tmpdir(), 'mc-camera-runtime-capture-')),
  );
  const outputParent = await realpath(
    await mkdtemp(path.join(tmpdir(), 'mc-camera-runtime-output-')),
  );
  const parentParent = await realpath(
    await mkdtemp(path.join(tmpdir(), 'mc-camera-runtime-parent-')),
  );
  const captureRoot = path.join(captureParent, RUN_ID);
  const parentRoot = path.join(parentParent, 'owned-server-runtime');
  const outputRoot = path.join(outputParent, REQUESTED_ID);
  await mkdir(captureRoot, { mode: 0o700 });
  await mkdir(parentRoot, { mode: 0o700 });
  await mkdir(outputRoot, { mode: 0o700 });
  const frameLabels = ['entry', 'prompt', 'denied', 'manual', 'pending'] as const;
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const producerFrames: AndroidCameraFrameSummary[] = [];
  const observations = [] as Record<string, unknown>[];
  for (const [index, label] of frameLabels.entries()) {
    const rawPath = `camera-${label}-hierarchy.stdout`;
    const hierarchyPath = `camera-${label}-hierarchy.json`;
    const screenshotPath = `camera-${label}.png`;
    const raw = await writePrivate(
      captureRoot,
      rawPath,
      Buffer.from(JSON.stringify({ label }) + '\n'),
    );
    await writePrivate(
      captureRoot,
      hierarchyPath,
      Buffer.from(JSON.stringify({ label, visible: true }) + '\n'),
    );
    await writePrivate(captureRoot, screenshotPath, png);
    producerFrames.push({
      label,
      path: rawPath,
      sizeBytes: raw.sizeBytes,
      sha256: raw.sha256,
      contentKind: 'hierarchy-source',
      action: {
        label,
        invocationId: `${RUN_ID}:camera:${index + 1}`,
        ordinal: index + 1,
        actionsSha256: 'd'.repeat(64),
        viewId: `STATE-camera-${label}`,
        selectorKind: 'id',
        selectors: [`student.camera.${label}`],
        commandLabel: `camera-${label}-hierarchy`,
        commandOrdinal: index,
      },
    });
    observations.push({
      viewId: `STATE-camera-${label}`,
      hierarchyPath,
      screenshotPath,
    });
  }
  const coachHome = await writePrivate(
    captureRoot,
    'coach-home-hierarchy.json',
    Buffer.from('{}\n'),
  );
  const body = await writePrivate(
    captureRoot,
    'submission.body.json',
    Buffer.from('{"code":"redacted-code"}\n'),
  );
  const manualCodeHash = sha256('redacted-code');
  const descriptor = await writePrivate(
    captureRoot,
    'submission.descriptor.json',
    json({
      kind: 'owned-native-request-body-receipt-v1',
      producer: 'owned-api-proxy-native-request-body-v1',
      bodyPath: body.path,
      bodySha256: body.sha256,
      bodySizeBytes: body.sizeBytes,
      requestId: 2,
      method: 'POST',
      route: '/connections/invite-submissions',
      status: 201,
      requestProfile: 'native',
      requestOrigin: null,
      targetOrigin: API_ORIGIN,
      backendAttemptId: `${BACKEND_ID}:first`,
      apiPid: API_PID,
      manualCodeSha256: manualCodeHash,
      actionSha256: 'f'.repeat(64),
      captureRunId: RUN_ID,
      sessionRunId: BACKEND_ID,
      actorAuthUidHash: 'e'.repeat(64),
    }),
  );
  const parentMetaBase = {
    parentSnapshotRoot: parentRoot,
    parentSnapshotOwnerUid: OWNER_UID,
    parentSnapshotMode: 0o600,
    parentSnapshotVerification: 'owned-runtime-document-v6' as const,
    parentApiOrigin: API_ORIGIN,
    parentApiPid: API_PID,
    parentApiStarted: API_STARTED,
    parentApiScript: API_SCRIPT,
    parentBackendAttemptId: `${BACKEND_ID}:first`,
    parentManifestPath: 'manifest.json',
    parentApiLedgerPath: 'api-session-start.json',
    parentApiAttempt: 'session-start',
    parentFixtureAuthUidAllowlistHash: '3'.repeat(64),
  } as const;
  const parentManifest = {
    schemaVersion: 1,
    runId: BACKEND_ID,
    composeProject: `mc_test_${BACKEND_ID}`,
    containerId: 'a'.repeat(64),
    ownerTokenHash: 'b'.repeat(64),
    port: 4123,
    targets: {
      DATABASE_URL: `mc_test_${BACKEND_ID}`,
      FOOD_CATALOG_DATABASE_URL: `mc_test_${BACKEND_ID}_food`,
      EXERCISE_CATALOG_DATABASE_URL: `mc_test_${BACKEND_ID}_exercise`,
    },
    repoRoot: '/private/server',
    runtimeRoot: parentRoot,
    artifactRoot: parentRoot,
    createdAt: API_STARTED,
    repositories: {
      server: {
        sha: 'c'.repeat(40),
        dirty: false,
        workingTreeHash: 'd'.repeat(64),
      },
      client: {
        sha: 'e'.repeat(40),
        dirty: false,
        workingTreeHash: 'f'.repeat(64),
      },
    },
    orchestratorPid: process.pid,
    testChildPid: null,
    phase: 'tests',
    fixtureScopes: [
      'native-entry-android',
      'native-conn-isolation-android',
      'native-training-android',
    ],
    processes: [{ role: 'api', pid: API_PID, started: API_STARTED, script: API_SCRIPT }],
  };
  const parentManifestBytes = json(parentManifest);
  const parentManifestFile = await writePrivate(parentRoot, 'manifest.json', parentManifestBytes);
  const parentApiLedgerBytes = json({
    schemaVersion: 1,
    runId: BACKEND_ID,
    ownerTokenHash: parentManifest.ownerTokenHash,
    pid: API_PID,
    started: API_STARTED,
    script: API_SCRIPT,
    attempt: 'session-start',
    origin: API_ORIGIN,
  });
  const parentApiLedgerFile = await writePrivate(
    parentRoot,
    'api-session-start.json',
    parentApiLedgerBytes,
  );
  const retainedManifestPath = `camera-sql-parent-manifest-${sha256(parentRoot)}.private.json`;
  const retainedApiLedgerPath = `camera-sql-parent-api-${sha256(parentRoot)}.private.json`;
  await writePrivate(captureRoot, retainedManifestPath, parentManifestBytes);
  await writePrivate(captureRoot, retainedApiLedgerPath, parentApiLedgerBytes);
  const parentMeta = {
    ...parentMetaBase,
    parentManifestSha256: parentManifestFile.sha256,
    parentApiLedgerSha256: parentApiLedgerFile.sha256,
    parentManifestRetainedPath: retainedManifestPath,
    parentManifestRetainedKind: 'sidecar' as const,
    parentManifestRetainedSha256: parentManifestFile.sha256,
    parentManifestRetainedSizeBytes: parentManifestFile.sizeBytes,
    parentManifestRetainedOwnerUid: OWNER_UID,
    parentManifestRetainedMode: 0o600,
    parentManifestRetainedVerification: 'owned-stable-reader-v6' as const,
    parentManifestSizeBytes: parentManifestFile.sizeBytes,
    parentApiLedgerRetainedPath: retainedApiLedgerPath,
    parentApiLedgerRetainedKind: 'sidecar' as const,
    parentApiLedgerRetainedSha256: parentApiLedgerFile.sha256,
    parentApiLedgerRetainedSizeBytes: parentApiLedgerFile.sizeBytes,
    parentApiLedgerRetainedOwnerUid: OWNER_UID,
    parentApiLedgerRetainedMode: 0o600,
    parentApiLedgerRetainedVerification: 'owned-stable-reader-v6' as const,
    parentApiLedgerSizeBytes: parentApiLedgerFile.sizeBytes,
  };
  const tableNames = [
    'userProfiles',
    'professionalSpecialties',
    'inviteCodes',
    'connections',
    'connectionInviteGuards',
    'pendingStudents',
    'pendingStudentSlots',
    'trackingAccess',
    'activeSpecialties',
  ] as const;
  const sqlReceipts: AndroidCameraSqlSourceReceipt[] = [];
  const addSnapshot = async (
    phase: string,
    scope: string,
    kind: 'connection' | 'domain',
  ): Promise<{
    path: string;
    hash: string;
    size: number;
    retainedPath: string;
    retainedHash: string;
    retainedSize: number;
  }> => {
    const rows = Object.fromEntries(tableNames.map((name) => [name, []]));
    const isolation = scope === 'native-conn-isolation-android';
    const snapshotFixtureAuthUids = isolation
      ? [...ISOLATION_FIXTURE_AUTH_UIDS]
      : ['coach', 'student'];
    const professionalAuthUid = isolation ? 'isolation-coach' : 'coach';
    const studentAuthUid = isolation ? 'isolation-student' : 'student';
    const value =
      kind === 'connection'
        ? {
            schemaVersion: 1,
            kind: 'connection-snapshot-v1',
            runId: BACKEND_ID,
            scope,
            readOnly: true,
            fixtureAuthUids: snapshotFixtureAuthUids,
            target: {
              professionalAuthUid,
              studentAuthUid,
              specialty: 'fitness_coach',
            },
            rowCounts: Object.fromEntries(tableNames.map((name) => [name, 0])),
            rows,
          }
        : {
            schemaVersion: 1,
            runId: BACKEND_ID,
            scope,
            readOnly: true,
            trainingPlans: [],
            connections: [],
          };
    const pathName = `snapshot-${phase}.json`;
    const bytes = json(value);
    const receipt = await writePrivate(parentRoot, pathName, bytes);
    const retainedPath = `camera-sql-parent-${sha256(`${parentRoot}\0${pathName}\0${receipt.sha256}`)}.private.json`;
    const retained = await writePrivate(captureRoot, retainedPath, bytes);
    return {
      path: pathName,
      hash: receipt.sha256,
      size: receipt.sizeBytes,
      retainedPath: retained.path,
      retainedHash: retained.sha256,
      retainedSize: retained.sizeBytes,
    };
  };
  const addPhase = async (
    phase: AndroidCameraSqlReceiptPhase,
    scope: string,
    kind: 'connection' | 'domain',
  ) => {
    const parent = await addSnapshot(phase, scope, kind);
    const tables = kind === 'connection' ? tableNames : (['domain'] as const);
    for (const [index, table] of tables.entries()) {
      const sourceProjection =
        kind === 'domain'
          ? 'owned-session.domain-snapshot-v1.document'
          : 'owned-session.connection-snapshot-v1.rows';
      const parentValue = JSON.parse(
        await readFile(path.join(parentRoot, parent.path), 'utf8'),
      ) as Record<string, unknown>;
      const projection =
        kind === 'domain' ? parentValue : (parentValue.rows as Record<string, unknown>)[table];
      const childPath = `sql-${phase}-${table}.json`;
      const child = await writePrivate(
        captureRoot,
        childPath,
        Buffer.from(JSON.stringify(projection)),
      );
      sqlReceipts.push({
        ...child,
        kind: 'query',
        verification: 'owned-stable-reader-v6',
        phase,
        scope,
        table,
        queryId: `${phase}-${table}-${index}`,
        parentSnapshotPath: parent.path,
        parentSnapshotRetainedPath: parent.retainedPath,
        parentSnapshotRetainedKind: 'sidecar',
        parentSnapshotRetainedSha256: parent.retainedHash,
        parentSnapshotRetainedSizeBytes: parent.retainedSize,
        parentSnapshotRetainedOwnerUid: OWNER_UID,
        parentSnapshotRetainedMode: 0o600,
        parentSnapshotRetainedVerification: 'owned-stable-reader-v6',
        parentSnapshotSha256: parent.hash,
        parentSnapshotSchema:
          kind === 'connection' ? 'connection-snapshot-v1' : 'domain-snapshot-v1',
        parentSnapshotKind: kind,
        parentSnapshotSizeBytes: parent.size,
        ...parentMeta,
        parentRunId: BACKEND_ID,
        parentScope: scope,
        sourceProjection,
      });
    }
  };
  await addPhase('before', 'native-entry-android', 'connection');
  await addPhase('pending', 'native-entry-android', 'connection');
  await addPhase('isolation-before', 'native-conn-isolation-android', 'connection');
  await addPhase('isolation-after', 'native-conn-isolation-android', 'connection');
  await addPhase('training-before', 'native-entry-android', 'domain');
  await addPhase('training-after', 'native-entry-android', 'domain');
  const transportRows = [
    {
      requestId: 1,
      method: 'GET',
      pathHash: sha256('/connections'),
      requestOrigin: null,
      requestProfile: 'native',
      requestCredentialPresent: false,
      requestCredentialClassification: {
        authorization: 'absent',
        cookie: 'absent',
        knownAccessCookie: 'absent',
        knownRefreshCookie: 'absent',
        otherCookiePresent: false,
        malformedCookiePresent: false,
      },
      targetOrigin: API_ORIGIN,
      status: 200,
      outcome: 'forwarded',
      faultAttemptId: null,
      elapsedMs: 1,
    },
    {
      requestId: 2,
      method: 'POST',
      pathHash: sha256('/connections/invite-submissions'),
      requestOrigin: null,
      requestProfile: 'native',
      requestCredentialPresent: false,
      requestCredentialClassification: {
        authorization: 'absent',
        cookie: 'absent',
        knownAccessCookie: 'absent',
        knownRefreshCookie: 'absent',
        otherCookiePresent: false,
        malformedCookiePresent: false,
      },
      targetOrigin: API_ORIGIN,
      status: 201,
      outcome: 'forwarded',
      faultAttemptId: null,
      elapsedMs: 2,
    },
  ];
  await writePrivate(captureRoot, 'transport-observations.private.json', json(transportRows));
  const isolationFixtureBytes = json(isolationFixtureDocument(BACKEND_ID));
  const isolationFixtureFile = await writePrivate(
    captureRoot,
    'fixtures-native-connection-isolation-android.private.json',
    isolationFixtureBytes,
  );
  const isolationFixture = {
    ...isolationFixtureFile,
    kind: 'sidecar' as const,
    verification: 'owned-stable-reader-v6' as const,
    source: 'owned-session.fixtures' as const,
    runId: BACKEND_ID,
    scope: 'native-conn-isolation-android',
    fixtureAuthUids: [...ISOLATION_FIXTURE_AUTH_UIDS],
    target: {
      professionalAuthUid: 'isolation-coach',
      studentAuthUid: 'isolation-student',
      specialty: 'fitness_coach' as const,
    },
  };
  const isolationExpected = {
    runId: BACKEND_ID,
    scope: 'native-conn-isolation-android',
    fixtureAuthUids: [...ISOLATION_FIXTURE_AUTH_UIDS],
    target: { ...isolationFixture.target },
  };
  const primaryFixtureAuthUids = ['coach', 'student'];
  const primaryExpected = {
    runId: BACKEND_ID,
    scope: 'native-entry-android',
    fixtureAuthUids: [...primaryFixtureAuthUids],
    target: {
      professionalAuthUid: 'coach',
      studentAuthUid: 'student',
      specialty: 'fitness_coach' as const,
    },
  };
  const helperInputs: { path: string; sha256: string }[] = [];
  for (const relativePath of [
    'scripts/testing/native-android-camera-public-staging.ts',
    'scripts/testing/native-camera-android-saved-flow.ts',
    '.maestro/flows/camera-denied-android.yaml',
    ...ANDROID_CAMERA_DETOX_RUNTIME_HELPER_PATHS,
  ])
    helperInputs.push({
      path: relativePath,
      sha256: sha256(await readFile(path.join(ROOT, relativePath))),
    });
  const source = await androidSourceIdentity(ROOT);
  const targetIdentity = target();
  const localeBinding = buildNativeLocaleBinding({
    captureRunId: RUN_ID,
    sourceTreeHash: source.sourceTreeHash,
    helperInputs,
    target: { platform: 'android', ...targetIdentity },
  });
  const producer: AndroidCameraProducerReceipts = {
    captureRunId: RUN_ID,
    identity: {
      captureRunId: RUN_ID,
      ownerRunId: OWNER_ID,
      backendRunId: BACKEND_ID,
      backendAttemptId: `${BACKEND_ID}:first`,
      serial: targetIdentity.deviceId,
      appId: targetIdentity.appId,
      apiOrigin: API_ORIGIN,
      apiPid: API_PID,
      apiStarted: API_STARTED,
      apiScript: API_SCRIPT,
      target: targetIdentity,
      locale: localeEvidence(localeBinding),
    },
    producerStatus: 'receipts-bound',
    sourceSelectionHash: androidCameraSelectionHash(selection),
    localeStatus: 'qualified',
    permission: {
      status: 'denied',
      before: { status: 'denied', decisionFlags: [] },
      after: { status: 'denied', decisionFlags: [] },
    },
    frames: producerFrames,
    pendingConnectionId: 'pending-1',
    submissionRequestId: 2,
    transportRequestWindow: {
      beforeRequestId: 0,
      throughRequestId: 2,
      requestId: 2,
    },
    manualCodeSha256: manualCodeHash,
    manualCodeSource: {
      source: 'owned-android-coach-hierarchy',
      frameLabel: 'coach-home',
      sourcePath: coachHome.path,
      sourceSha256: coachHome.sha256,
      sourceSizeBytes: coachHome.sizeBytes,
      sourceOwnerUid: OWNER_UID,
      sourceMode: 0o600,
      sourceVerification: 'owned-stable-reader-v6',
      commandLabel: 'coach-home-hierarchy',
      commandOrdinal: 0,
      commandPid: API_PID,
      commandPgid: API_PID,
      commandExecution: 'completed',
      commandCleanup: 'cleaned',
      commandArgvSha256: 'd'.repeat(64),
      captureRunId: RUN_ID,
      ownerRunId: OWNER_ID,
      actor: 'coach',
      actorAuthUidSha256: 'e'.repeat(64),
      codeSha256: manualCodeHash,
    },
    submission: {
      requestId: 2,
      bodyHash: body.sha256,
      recorderBodyHash: body.sha256,
      manualCodeSha256: manualCodeHash,
      actionSha256: 'f'.repeat(64),
      sourcePath: body.path,
      sourceSha256: body.sha256,
      descriptorPath: descriptor.path,
      backendAttemptId: `${BACKEND_ID}:first`,
      apiPid: API_PID,
      apiOrigin: API_ORIGIN,
    },
    primaryFixtureAuthUids,
    primaryExpected,
    isolationExpected,
    isolationFixture,
    sqlReceipts,
    permissionCommandLabels: [
      'camera-permission-clear',
      'camera-permission-revoke',
      'camera-permission-before-check',
      'camera-permission-after-check',
    ],
  };
  const cleanup = {
    kind: 'independent android native cleanup proof',
    result: 'passed',
    runId: RUN_ID,
    captureResult: 'observed',
    captureCleanupClean: true,
    nativePassingCases: 0,
    acquisitions: [],
    pidStartPairs: 1,
    survivors: [],
    unknownProcessQueries: [],
    missingForeignDevices: [],
    addedForeignDevices: [],
    recordedForeignDeviceChanges: { missingOrChanged: [], added: [] },
    ownedDeviceAbsent: true,
    cacheAbsent: true,
    defaultAdbPreserved: true,
    foreignAvdsPreserved: true,
    unavailablePorts: [],
    docker: null,
    censusStatus: 'available',
    originalCaptureCleanup: 'cleaned',
    originalCaptureCleanupFailures: [],
    deletedOwnedDirectories: 1,
    scope: 'private sealed Android camera eligibility fixture',
    finishedAt: new Date().toISOString(),
  };
  const cleanupFile = await writePrivate(
    captureRoot,
    'external-cleanup.private.json',
    json(cleanup),
  );
  const cleanupReceipt = {
    ...cleanupFile,
    kind: 'sidecar',
    verification: 'owned-stable-reader-v6',
  };
  await writePrivate(
    captureRoot,
    'external-cleanup-receipt.private.json',
    json({
      kind: 'private-owned-android-cleanup-receipt',
      runId: RUN_ID,
      receipt: cleanupReceipt,
    }),
  );
  await writePrivate(
    captureRoot,
    'camera-independent-cleanup-link.private.json',
    json({
      kind: 'private-owned-android-camera-independent-cleanup-link',
      captureRunId: RUN_ID,
      result: 'passed',
      censusStatus: 'available',
      cleanupReceipt,
    }),
  );
  const buildBytes = Buffer.from('sealed-apk-bytes');
  const buildFile = await writePrivate(captureRoot, 'build.apk', buildBytes);
  const report = {
    kind: 'private-owned-native-camera-denied-execution-not-public-receipt',
    platform: 'android',
    charter: 'camera-denied',
    mode: 'integration',
    captureRunId: RUN_ID,
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 0,
    androidCameraCallbackInvocations: 1,
    androidCameraCallbackCompleted: true,
    backend: {
      runId: BACKEND_ID,
      backendAttemptId: `${BACKEND_ID}:first`,
      apiOrigin: API_ORIGIN,
      apiProcess: {
        pid: API_PID,
        started: API_STARTED,
        script: API_SCRIPT,
      },
    },
    device: {
      runId: OWNER_ID,
      serial: targetIdentity.deviceId,
      osVersion: targetIdentity.osVersion,
    },
    build: {
      appId: targetIdentity.appId,
      binaryHash: sha256(buildBytes),
      profile: CAMERA_BUILD_PROFILE,
      launcher: 'com.edufelip.mychampions.MainActivity',
      debuggable: true,
      signingCertificateHash: 'a'.repeat(64),
      environmentHash: 'b'.repeat(64),
      apiOrigin: API_ORIGIN,
      binaryPath: path.join(captureRoot, buildFile.path),
    },
    source,
    sourceAfter: source,
    helperInputsBefore: helperInputs,
    helperInputsAfter: helperInputs,
    fixtureHash: '4'.repeat(64),
    fixtureRef: `owned-postgres:native-entry-android:${BACKEND_ID}`,
    androidCameraSavedFlow: {
      path: '.maestro/flows/camera-denied-android.yaml',
      sha256: sha256(await readFile(path.join(ROOT, '.maestro/flows/camera-denied-android.yaml'))),
      scenarioId: 'SCN-camera-denied-android',
      flowId: 'FLW-camera-denied',
      fixtureRef: 'owned-postgres:SCN-camera-denied-android:fresh-attempt',
      runtimeFixtureRef: `owned-postgres:native-entry-android:${BACKEND_ID}`,
      runtimeFixtureRunId: BACKEND_ID,
      runtimeFixtureScope: 'native-entry-android',
    },
    androidCameraIndependentCleanup: {
      captureRunId: RUN_ID,
      result: 'passed',
      censusStatus: 'available',
      cleanupReceipt,
    },
    androidCameraProducer: {
      producerStatus: 'receipts-bound',
      captureRunId: RUN_ID,
      sourceSelectionHash: androidCameraSelectionHash(selection),
      localeStatus: 'qualified',
      frames: producerFrames.map((row) => ({ label: row.label })),
      primaryFixtureAuthUids,
      primaryExpected,
      isolationExpected,
      isolationFixture,
    },
    connectionIsolationFixtureEvidence: isolationFixture,
    observations,
  };
  const reportFile = await writePrivate(captureRoot, 'capture.private.json', json(report));
  await writePrivate(
    captureRoot,
    'capture-receipt.private.json',
    json({
      kind: 'private-owned-android-capture-receipt',
      captureRunId: RUN_ID,
      receipt: {
        ...reportFile,
        kind: 'sidecar',
        verification: 'owned-stable-reader-v6',
      },
    }),
  );
  return {
    captureParent,
    captureRoot,
    parentParent,
    parentRoot,
    outputParent,
    outputRoot,
    selection,
    producer,
    target: targetIdentity,
  };
}

async function runFixture(): Promise<{
  fixture: Fixture;
  result: Awaited<ReturnType<typeof verifyAndroidCameraRuntimeEligibility>>;
}> {
  const value = await fixture();
  const result = await verifyAndroidCameraRuntimeEligibility({
    repositoryRoot: ROOT,
    captureRoot: value.captureRoot,
    outputRoot: value.outputRoot,
    requestedRunId: REQUESTED_ID,
    requestedAttemptId: `${REQUESTED_ID}:first`,
    captureRunId: RUN_ID,
    fixtureRunId: BACKEND_ID,
    selection: value.selection,
    target: value.target,
    expectedLocale: 'en-US',
    runtime: runtime(value.producer),
    producer: value.producer,
    deadlineAt: performance.now() + 120_000,
    sourceOnlyTestLabel: 'sealed-source-control:android-camera-positive',
  });
  return { fixture: value, result };
}

void test('Android camera eligibility verifies the full descriptor-bound receipt graph but remains source-only in fixtures', async () => {
  const { fixture: value, result } = await runFixture();
  try {
    assert.equal(result.status, 'validated-source-only');
    assert.equal(result.verificationMode, 'source-only-control');
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.equal(result.evidenceProof.status, 'verified-owned-receipts');
    assert.equal(result.evidenceProof.build.sha256, BINARY);
    assert.equal(result.evidenceProof.localeBinding.target.deviceId, value.target.deviceId);
    assert.deepEqual(
      result.assertionBindings.map((row) => row.id),
      [...ANDROID_CAMERA_ASSERTION_IDS],
    );
    assert(result.assertionBindings.every((row) => row.evidencePaths.length > 0));
    assert(
      result.assertionBindings.every((row) =>
        row.evidencePaths.every((entry) => entry.startsWith('evidence/')),
      ),
    );
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera finalizer rejects source-only evidence before any native/public count', async () => {
  const { fixture: value, result } = await runFixture();
  try {
    await assert.rejects(
      finalizeAndroidCameraNativeRuntime({
        repositoryRoot: ROOT,
        eligibility: result,
        captureRoot: value.captureRoot,
        outputRoot: value.outputRoot,
        deadlineAt: performance.now() + 120_000,
      }),
      /source-only eligibility cannot enter native finalization/,
    );
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera eligibility accepts native runtime mode only with the producer-written provenance receipt', async () => {
  const value = await fixture();
  try {
    const deadlineAt = performance.now() + 300_000;
    const { provenance: runtimeProvenance, driver } = await writeNativeRuntimeProvenance(
      value,
      deadlineAt,
    );
    // Simulate backend teardown: the authenticated parent snapshot, manifest,
    // and API ledger disappear from the original runtime root. Public runtime
    // verification must consume the receipt-bound capture sidecars instead.
    await rm(value.parentParent, { recursive: true, force: true });
    const result = await verifyAndroidCameraRuntimeEligibility({
      repositoryRoot: ROOT,
      captureRoot: value.captureRoot,
      outputRoot: value.outputRoot,
      requestedRunId: REQUESTED_ID,
      requestedAttemptId: `${REQUESTED_ID}:first`,
      captureRunId: RUN_ID,
      fixtureRunId: BACKEND_ID,
      selection: value.selection,
      target: value.target,
      expectedLocale: 'en-US',
      runtime: null,
      nativeDriver: driver,
      producer: value.producer,
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
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android native finalizer rejects a staged original-byte mutation at the terminal reread', async () => {
  const value = await fixture();
  try {
    const deadlineAt = performance.now() + 300_000;
    const { provenance: runtimeProvenance, driver } = await writeNativeRuntimeProvenance(
      value,
      deadlineAt,
    );
    const eligibility = await verifyAndroidCameraRuntimeEligibility({
      repositoryRoot: ROOT,
      captureRoot: value.captureRoot,
      outputRoot: value.outputRoot,
      requestedRunId: REQUESTED_ID,
      requestedAttemptId: `${REQUESTED_ID}:first`,
      captureRunId: RUN_ID,
      fixtureRunId: BACKEND_ID,
      selection: value.selection,
      target: value.target,
      expectedLocale: 'en-US',
      runtime: null,
      nativeDriver: driver,
      producer: value.producer,
      deadlineAt,
      runtimeProvenance,
    });
    await publishAndroidCameraNativeRuntimeFinalizerReceipt({
      repositoryRoot: ROOT,
      eligibility,
      captureRoot: value.captureRoot,
      outputRoot: value.outputRoot,
      deadlineAt,
    });
    const first = await finalizeAndroidCameraNativeRuntime({
      repositoryRoot: ROOT,
      eligibility,
      captureRoot: value.captureRoot,
      outputRoot: value.outputRoot,
      deadlineAt,
    });
    assert.equal(first.publicPassingCases, 4);
    const helper = eligibility.evidenceProof.helperInputs[0];
    assert(helper, 'native finalizer source guard lacks a helper input');
    const helperPath = path.join(ROOT, helper.path);
    const helperBytes = await readFile(helperPath);
    await appendFile(helperPath, '\n');
    try {
      await assert.rejects(
        finalizeAndroidCameraNativeRuntime({
          repositoryRoot: ROOT,
          eligibility,
          captureRoot: value.captureRoot,
          outputRoot: value.outputRoot,
          deadlineAt,
        }),
        /Android helper .* stale/,
      );
    } finally {
      await writeFile(helperPath, helperBytes);
    }
    const manifestPath = path.join(value.outputRoot, eligibility.stage.copyManifest.path);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      files: readonly { path: string; kind: string }[];
    };
    const targetFile = manifest.files.find(
      (row) => row.kind === 'sidecar' && row.path !== 'capture.private.json',
    );
    assert(targetFile, 'native finalizer mutation control lacks a staged sidecar');
    await appendFile(
      path.join(
        value.outputRoot,
        path.dirname(eligibility.stage.copyManifest.path),
        targetFile.path,
      ),
      '\n',
    );
    await assert.rejects(
      finalizeAndroidCameraNativeRuntime({
        repositoryRoot: ROOT,
        eligibility,
        captureRoot: value.captureRoot,
        outputRoot: value.outputRoot,
        deadlineAt,
      }),
      /staged (bytes|size) changed/,
    );
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera eligibility rejects a missing runtime provenance receipt instead of promoting an unlabeled source fixture', async () => {
  const value = await fixture();
  try {
    await assert.rejects(
      verifyAndroidCameraRuntimeEligibility({
        repositoryRoot: ROOT,
        captureRoot: value.captureRoot,
        outputRoot: value.outputRoot,
        requestedRunId: REQUESTED_ID,
        requestedAttemptId: `${REQUESTED_ID}:first`,
        captureRunId: RUN_ID,
        fixtureRunId: BACKEND_ID,
        selection: value.selection,
        target: value.target,
        expectedLocale: 'en-US',
        runtime: runtime(value.producer),
        producer: value.producer,
        deadlineAt: performance.now() + 120_000,
      }),
      /exactly one source-only label or native runtime provenance receipt/,
    );
    await assert.rejects(lstat(path.join(value.outputRoot, 'evidence')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera eligibility rejects forged owner, target, frame-action, SQL-parent, and deadline provenance', async () => {
  const value = await fixture();
  try {
    const deadlineAt = performance.now() + 120_000;
    const { provenance: runtimeProvenance, driver } = await writeNativeRuntimeProvenance(
      value,
      deadlineAt,
    );
    const receiptPath = path.join(value.captureRoot, runtimeProvenance.receiptPath);
    const originalBytes = await readFile(receiptPath);
    type MutableRuntimeReceipt = Record<string, unknown> & {
      ownerRunId: string;
      target: Record<string, unknown>;
      frameActions: Record<string, unknown>[];
      sqlParents: Record<string, unknown>[];
      deadlineAt: number;
    };
    const original = JSON.parse(originalBytes.toString('utf8')) as MutableRuntimeReceipt;
    const cases: readonly [string, (receipt: MutableRuntimeReceipt) => void, RegExp][] = [
      ['owner', (receipt) => (receipt.ownerRunId = 'f'.repeat(24)), /owner run/],
      [
        'target',
        (receipt) => (receipt.target = { ...receipt.target, deviceId: 'emulator-9999' }),
        /target provenance/,
      ],
      [
        'frame action',
        (receipt) => (receipt.frameActions[0].commandLabel = 'foreign-command'),
        /frame-action provenance/,
      ],
      ['SQL parent', (receipt) => (receipt.sqlParents[0].sha256 = 'f'.repeat(64)), /SQL parents/],
      [
        'SQL parent root',
        (receipt) => (receipt.sqlParents[0].parentRoot = value.captureRoot),
        /SQL parents/,
      ],
      [
        'retained manifest',
        (receipt) => (receipt.sqlParents[0].parentManifestRetainedSha256 = 'f'.repeat(64)),
        /SQL parents/,
      ],
      [
        'retained API ledger',
        (receipt) => (receipt.sqlParents[0].parentApiLedgerRetainedSha256 = 'f'.repeat(64)),
        /SQL parents/,
      ],
      ['deadline', (receipt) => (receipt.deadlineAt += 1), /deadline/],
    ];
    for (const [label, mutate, expected] of cases) {
      const candidate = JSON.parse(JSON.stringify(original)) as MutableRuntimeReceipt;
      mutate(candidate);
      const bytes = json(candidate);
      await writeFile(receiptPath, bytes);
      await assert.rejects(
        verifyAndroidCameraRuntimeEligibility({
          repositoryRoot: ROOT,
          captureRoot: value.captureRoot,
          outputRoot: value.outputRoot,
          requestedRunId: REQUESTED_ID,
          requestedAttemptId: `${REQUESTED_ID}:first`,
          captureRunId: RUN_ID,
          fixtureRunId: BACKEND_ID,
          selection: value.selection,
          target: value.target,
          expectedLocale: 'en-US',
          runtime: null,
          nativeDriver: driver,
          producer: value.producer,
          deadlineAt,
          runtimeProvenance: {
            ...runtimeProvenance,
            receiptSha256: sha256(bytes),
          },
        }),
        expected,
        label,
      );
    }
    await writeFile(receiptPath, originalBytes);
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera eligibility rejects a source identity changed after capture', async () => {
  const value = await fixture();
  try {
    const reportPath = path.join(value.captureRoot, 'capture.private.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    report.sourceAfter = {
      ...(report.sourceAfter as Record<string, unknown>),
      sourceTreeHash: 'e'.repeat(64),
    };
    await writeFile(reportPath, JSON.stringify(report) + '\n');
    await assert.rejects(
      verifyAndroidCameraRuntimeEligibility({
        repositoryRoot: ROOT,
        captureRoot: value.captureRoot,
        outputRoot: value.outputRoot,
        requestedRunId: REQUESTED_ID,
        requestedAttemptId: `${REQUESTED_ID}:first`,
        captureRunId: RUN_ID,
        fixtureRunId: BACKEND_ID,
        selection: value.selection,
        target: value.target,
        expectedLocale: 'en-US',
        runtime: runtime(value.producer),
        producer: value.producer,
        sourceOnlyTestLabel: 'sealed-source-control:source-drift',
      }),
      /source after is stale/,
    );
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android public SQL eligibility rejects tampered retained provenance and foreign links after backend teardown', async () => {
  const value = await fixture();
  try {
    const deadlineAt = performance.now() + 300_000;
    const { provenance: runtimeProvenance, driver } = await writeNativeRuntimeProvenance(
      value,
      deadlineAt,
    );
    const receiptPath = path.join(value.captureRoot, runtimeProvenance.receiptPath);
    const originalReceiptBytes = await readFile(receiptPath);
    const originalReceipt = JSON.parse(originalReceiptBytes.toString('utf8')) as {
      sqlParents: readonly Record<string, unknown>[];
    };
    const firstSqlParent = originalReceipt.sqlParents[0];
    assert(firstSqlParent, 'retained SQL parent receipt is missing');
    const manifestPath = String(firstSqlParent.parentManifestRetainedPath);
    const ledgerPath = String(firstSqlParent.parentApiLedgerRetainedPath);
    const snapshotPath = String(firstSqlParent.retainedPath);
    const read = async (relative: string): Promise<Buffer> =>
      readFile(path.join(value.captureRoot, relative));
    const verify = async (receiptSha256 = runtimeProvenance.receiptSha256) =>
      verifyAndroidCameraRuntimeEligibility({
        repositoryRoot: ROOT,
        captureRoot: value.captureRoot,
        outputRoot: value.outputRoot,
        requestedRunId: REQUESTED_ID,
        requestedAttemptId: `${REQUESTED_ID}:first`,
        captureRunId: RUN_ID,
        fixtureRunId: BACKEND_ID,
        selection: value.selection,
        target: value.target,
        expectedLocale: 'en-US',
        runtime: null,
        nativeDriver: driver,
        producer: value.producer,
        deadlineAt,
        runtimeProvenance: { ...runtimeProvenance, receiptSha256 },
      });

    await rm(value.parentParent, { recursive: true, force: true });
    for (const relative of [manifestPath, ledgerPath] as const) {
      const originalBytes = await read(relative);
      await writeFile(
        path.join(value.captureRoot, relative),
        Buffer.concat([originalBytes, Buffer.from(' ')]),
        {
          mode: 0o600,
        },
      );
      await assert.rejects(verify(), relative);
      await writeFile(path.join(value.captureRoot, relative), originalBytes, {
        mode: 0o600,
      });
    }

    const foreignPath = path.join(value.captureParent, 'foreign-sql-parent.json');
    await writeFile(foreignPath, await read(snapshotPath), { mode: 0o600 });
    const retainedSnapshotPath = path.join(value.captureRoot, snapshotPath);
    await rm(retainedSnapshotPath, { force: true });
    await symlink(foreignPath, retainedSnapshotPath);
    await assert.rejects(verify(), /canonical|symbolic|SQL|link/u);
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera eligibility rejects a capture ledger missing the loaded evidence reader', async () => {
  const value = await fixture();
  try {
    const reportPath = path.join(value.captureRoot, 'capture.private.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    for (const key of ['helperInputsBefore', 'helperInputsAfter']) {
      const rows = report[key] as readonly { path: string; sha256: string }[];
      report[key] = rows.filter(
        (row) => row.path !== 'scripts/testing/detox-connection-evidence.ts',
      );
    }
    await writeFile(reportPath, JSON.stringify(report) + '\n');
    await assert.rejects(
      verifyAndroidCameraRuntimeEligibility({
        repositoryRoot: ROOT,
        captureRoot: value.captureRoot,
        outputRoot: value.outputRoot,
        requestedRunId: REQUESTED_ID,
        requestedAttemptId: `${REQUESTED_ID}:first`,
        captureRunId: RUN_ID,
        fixtureRunId: BACKEND_ID,
        selection: value.selection,
        target: value.target,
        expectedLocale: 'en-US',
        runtime: runtime(value.producer),
        producer: value.producer,
        sourceOnlyTestLabel: 'sealed-source-control:missing-detox-helper',
      }),
      /Android camera helper inputs omit scripts\/testing\/detox-connection-evidence\.ts/,
    );
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera eligibility rejects tampered SQL child bytes before exposing bindings', async () => {
  const value = await fixture();
  try {
    const receipt = value.producer.sqlReceipts[0] as { path: string };
    await writeFile(path.join(value.captureRoot, receipt.path), Buffer.from('{"tampered":true}'));
    await assert.rejects(
      verifyAndroidCameraRuntimeEligibility({
        repositoryRoot: ROOT,
        captureRoot: value.captureRoot,
        outputRoot: value.outputRoot,
        requestedRunId: REQUESTED_ID,
        requestedAttemptId: `${REQUESTED_ID}:first`,
        captureRunId: RUN_ID,
        fixtureRunId: BACKEND_ID,
        selection: value.selection,
        target: value.target,
        expectedLocale: 'en-US',
        runtime: runtime(value.producer),
        producer: value.producer,
        sourceOnlyTestLabel: 'sealed-source-control:sql-tamper',
      }),
      /hash|projection|byte count/,
    );
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera eligibility rejects a cleanup receipt that is not independently passed', async () => {
  const value = await fixture();
  try {
    const cleanupPath = path.join(value.captureRoot, 'external-cleanup.private.json');
    const cleanup = JSON.parse(await readFile(cleanupPath, 'utf8')) as Record<string, unknown>;
    cleanup.result = 'failed';
    await writeFile(cleanupPath, JSON.stringify(cleanup) + '\n');
    await assert.rejects(
      verifyAndroidCameraRuntimeEligibility({
        repositoryRoot: ROOT,
        captureRoot: value.captureRoot,
        outputRoot: value.outputRoot,
        requestedRunId: REQUESTED_ID,
        requestedAttemptId: `${REQUESTED_ID}:first`,
        captureRunId: RUN_ID,
        fixtureRunId: BACKEND_ID,
        selection: value.selection,
        target: value.target,
        expectedLocale: 'en-US',
        runtime: runtime(value.producer),
        producer: value.producer,
        sourceOnlyTestLabel: 'sealed-source-control:cleanup-failure',
      }),
      /cleanup|passed/,
    );
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android camera eligibility rejects an invalid source-only label before staging', async () => {
  const value = await fixture();
  try {
    const invalidInput: Parameters<typeof verifyAndroidCameraRuntimeEligibility>[0] = {
      repositoryRoot: ROOT,
      captureRoot: value.captureRoot,
      outputRoot: value.outputRoot,
      requestedRunId: REQUESTED_ID,
      requestedAttemptId: `${REQUESTED_ID}:first`,
      captureRunId: RUN_ID,
      fixtureRunId: BACKEND_ID,
      selection: value.selection,
      target: value.target,
      expectedLocale: 'en-US',
      runtime: runtime(value.producer),
      producer: value.producer,
      sourceOnlyTestLabel: 'sealed-source-control:invalid',
    };
    Object.assign(invalidInput, { sourceOnlyTestLabel: 'invalid' });
    await assert.rejects(verifyAndroidCameraRuntimeEligibility(invalidInput), /source-only label/);
    await assert.rejects(lstat(path.join(value.outputRoot, 'evidence')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(value.captureParent, { recursive: true, force: true });
    await rm(value.outputParent, { recursive: true, force: true });
    await rm(value.parentParent, { recursive: true, force: true });
  }
});

void test('Android APK eligibility streams an actual-sized build under the shared bounded contract', async () => {
  const value = await apkReaderFixture(REAL_ANDROID_APK_BYTES);
  try {
    const expectedHash = await hashFileWithoutBuffering(value.apkPath);
    const result = await readAndroidCameraBuildArtifact(
      value.root,
      value.apkPath,
      expectedHash,
      performance.now() + 300_000,
    );
    assert.equal(ANDROID_CAMERA_APK_MAX_BYTES, 256 * 1024 * 1024);
    assert.equal(result.sizeBytes, REAL_ANDROID_APK_BYTES);
    assert.equal(result.sha256, expectedHash);
    assert.equal(result.identity.size, REAL_ANDROID_APK_BYTES);
    assert.equal(result.identity.nlink, 1);
  } finally {
    await rm(value.parent, { recursive: true, force: true });
  }
});

void test('Android APK eligibility rejects an artifact over the finite shared build bound', async () => {
  const value = await apkReaderFixture(ANDROID_CAMERA_APK_MAX_BYTES + 1);
  try {
    await assert.rejects(
      readAndroidCameraBuildArtifact(
        value.root,
        value.apkPath,
        '0'.repeat(64),
        performance.now() + 300_000,
      ),
      /invalid or exceeds its bounded build limit/u,
    );
  } finally {
    await rm(value.parent, { recursive: true, force: true });
  }
});

void test('Android APK eligibility rejects a truncated artifact through the bound receipt hash', async () => {
  const complete = Buffer.from('complete-apk-receipt-bytes');
  const value = await apkReaderFixture(complete.length, complete);
  try {
    const expectedHash = sha256(complete);
    await truncate(value.apkPath, complete.length - 3);
    await assert.rejects(
      readAndroidCameraBuildArtifact(
        value.root,
        value.apkPath,
        expectedHash,
        performance.now() + 300_000,
      ),
      /hash differs from build receipt/u,
    );
  } finally {
    await rm(value.parent, { recursive: true, force: true });
  }
});

void test('Android APK eligibility rejects symlink and hardlink identity substitutions', async () => {
  const symlinkValue = await apkReaderFixture(16, Buffer.from('owned-apk-bytes'));
  try {
    const outsidePath = path.join(symlinkValue.parent, 'outside.apk');
    await writeFile(outsidePath, Buffer.from('owned-apk-bytes'), { mode: 0o600 });
    await rm(symlinkValue.apkPath, { force: true });
    await symlink(outsidePath, symlinkValue.apkPath);
    await assert.rejects(
      readAndroidCameraBuildArtifact(
        symlinkValue.root,
        symlinkValue.apkPath,
        sha256('owned-apk-bytes'),
        performance.now() + 300_000,
      ),
      /path is not canonical/u,
    );
  } finally {
    await rm(symlinkValue.parent, { recursive: true, force: true });
  }

  const hardlinkValue = await apkReaderFixture(16, Buffer.from('owned-apk-bytes'));
  try {
    const aliasPath = path.join(hardlinkValue.root, 'alias.apk');
    await link(hardlinkValue.apkPath, aliasPath);
    await assert.rejects(
      readAndroidCameraBuildArtifact(
        hardlinkValue.root,
        aliasPath,
        sha256('owned-apk-bytes'),
        performance.now() + 300_000,
      ),
      /must have one link/u,
    );
  } finally {
    await rm(hardlinkValue.parent, { recursive: true, force: true });
  }
});

void test('Android APK eligibility aborts deterministically during streaming', async () => {
  const value = await apkReaderFixture(256 * 1024);
  try {
    const controller = new AbortController();
    let checks = 0;
    const signal = new Proxy(controller.signal, {
      get(target, property, receiver) {
        if (property === 'throwIfAborted') {
          return () => {
            checks += 1;
            if (checks === 3) controller.abort();
            target.throwIfAborted();
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    await assert.rejects(
      readAndroidCameraBuildArtifact(
        value.root,
        value.apkPath,
        '0'.repeat(64),
        performance.now() + 300_000,
        signal,
      ),
      /aborted/u,
    );
    assert.equal(checks, 3);
  } finally {
    await rm(value.parent, { recursive: true, force: true });
  }
});

void test('Android APK eligibility fails closed for cancellation and expired deadlines before reading', async () => {
  const value = await apkReaderFixture(16, Buffer.from('owned-apk-bytes'));
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      readAndroidCameraBuildArtifact(
        value.root,
        value.apkPath,
        sha256('owned-apk-bytes'),
        performance.now() + 300_000,
        controller.signal,
      ),
      /aborted/u,
    );
    await assert.rejects(
      readAndroidCameraBuildArtifact(
        value.root,
        value.apkPath,
        sha256('owned-apk-bytes'),
        performance.now() - 1,
      ),
      /deadline expired/u,
    );
    const info = await lstat(value.apkPath);
    assert.equal(info.size, 16);
  } finally {
    await rm(value.parent, { recursive: true, force: true });
  }
});

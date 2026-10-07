import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readAndroidCameraHelperInputs } from '../../scripts/testing/capture-android-testability';
import {
  androidCameraSelectionHash,
  type AndroidCameraCommandReceipt,
  type AndroidCameraFrameSource,
} from '../../scripts/testing/native-camera-android-contract';
import {
  requireAndroidCameraProducerOutput,
  type AndroidCameraCommandRunner,
  type AndroidCameraManualCodeInput,
  type AndroidCameraProducerReceipts,
  type AndroidCameraSnapshotSource,
} from '../../scripts/testing/native-camera-android-producer';
import {
  loadAndroidCameraSavedFlow,
  type AndroidCameraSavedFlow,
} from '../../scripts/testing/native-camera-android-saved-flow';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import { runAndroidCameraAttemptV4 } from '../../scripts/testing/run-android-camera-attempt';
import {
  androidCameraPublicRequiredDeclarationPath,
  createAndroidCameraOwnedSessionBridge,
} from '../../scripts/testing/run-android-camera-public-attempt';
import { createT15PlatformEngineAwareOwnedLifecycleProducer } from '../../scripts/testing/t15-cold-owned-lifecycle';
import type {
  AndroidCapturedFrameReceipt,
  AndroidStorageFileReceipt,
} from '../../scripts/testing/native-android-session-adapter';
import type { AndroidCameraCaptureBoundary } from '../../scripts/testing/native-camera-android-capture-adapter';
import type { AndroidCameraManualRequestBinding } from '../../scripts/testing/native-camera-android-observation';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';
import type { AndroidLocalePropertyRead } from '../../scripts/testing/native-locale-capture-seam';
import type {
  NativeRequestBodyCaptureReceipt,
  ProxyObservation,
} from '../../scripts/testing/owned-api-proxy';
import type { NativeCommandExecution } from '../../scripts/testing/owned-native-command';
import type {
  OwnedApiLifetimeProbe,
  OwnedDomainSnapshot,
  OwnedFixtures,
  OwnedSnapshotReceipt,
  OwnedSnapshotEvidence,
} from '../../scripts/testing/owned-session';
import type { createAndroidCameraEligibilityFixture } from '../dependencies/android-camera-runtime-eligibility-fixture';

const runId = 'a'.repeat(24);
const fixtureHash = 'b'.repeat(64);
const sourceDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/testing',
);
const repositoryRoot = path.resolve(sourceDirectory, '..', '..');

function input(options: {
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
  platform?: 'ios' | 'android';
  engine?: 'maestro' | 'detox';
}) {
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  return {
    spec: { cohort: { fixtureResetFingerprint: fixtureHash } },
    expected: {
      runId,
      attemptId: `${runId}:first`,
      fixtureResetId: 'fixture-reset-1',
      inputs: { fixtureHash },
      target: {
        deviceId: null,
        osVersion: null,
        appId: null,
        buildProfile: null,
        binaryHash: null,
        apiOrigin: null,
      },
    },
    selection: {
      arguments: {
        platform: options.platform ?? 'android',
        engine: options.engine ?? 'detox',
        mode: 'integration',
        scenario: 'SCN-training-android',
      },
      scenario: {
        id: 'SCN-training-android',
        platform: options.platform ?? 'android',
        flowId: 'FLW-training',
        dataMode: 'postgres',
      },
    },
    signal,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    reusableBuild: null,
    terminalize: () => {
      throw new Error('terminalize must not be called by pre-acquisition controls');
    },
  } as never;
}

function owner() {
  return createT15PlatformEngineAwareOwnedLifecycleProducer({
    ios: { repositoryRoot: '/private/ios', outputRoot: '/private/out' },
    attemptDeadlineMs: 600_000,
  });
}

const CAMERA_APP_ID = 'com.edufelip.mychampions.dev';
const CAMERA_API_ORIGIN = 'http://127.0.0.1:1234';
const CAMERA_APP_ORIGIN = 'http://app-facing.test:8081';
const CAMERA_BOUNDS = '[0,0][100,100]';

type AndroidCameraEligibilityFixture = Awaited<
  ReturnType<typeof createAndroidCameraEligibilityFixture>
>;

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

async function writeTestArtifact(
  root: string,
  relativePath: string,
  bytes: Buffer,
): Promise<AndroidStorageFileReceipt> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  await writeFile(absolute, bytes, { mode: 0o600 });
  const metadata = await lstat(absolute);
  return {
    path: relativePath,
    kind: 'sidecar',
    sizeBytes: bytes.byteLength,
    sha256: digest(bytes),
    ownerUid: metadata.uid,
    mode: metadata.mode & 0o777,
    verification: 'owned-stable-reader-v6',
  };
}

function ownedFixtures(runId: string): OwnedFixtures {
  const account = (authUid: string, role: string | null) => ({
    email: `${authUid}@example.test`,
    password: 'camera-password',
    authUid,
    role,
  });
  return {
    runId,
    scope: 'native-entry-android',
    accounts: {
      new: account('new', null),
      student: account('student', 'student'),
      coach: account('coach', 'professional'),
      'unrelated-student': account('unrelated-student', 'student'),
      'unrelated-coach': account('unrelated-coach', 'professional'),
      'pending-student': account('pending-student', 'student'),
      'active-student': account('active-student', 'student'),
    },
    pendingConnectionId: 'pending-1',
    activeConnectionId: 'active-1',
    savedPlanId: 'plan-1',
    draft: {
      name: 'Camera test plan',
      sessions: [
        {
          id: 'session-1',
          name: 'Camera session',
          notes: '',
          items: [
            {
              id: 'item-1',
              name: 'Camera exercise',
              quantity: '1',
              notes: '',
              exerciseId: 'exercise-1',
            },
          ],
        },
      ],
    },
  };
}

function emptyConnectionRows(): ConnectionSnapshotRows {
  return {
    userProfiles: [],
    professionalSpecialties: [],
    inviteCodes: [],
    connections: [],
    connectionInviteGuards: [],
    pendingStudents: [],
    pendingStudentSlots: [],
    trackingAccess: [],
    activeSpecialties: [],
  };
}

function cameraConnectionSnapshot(input: {
  runId: string;
  scope: string;
  fixtureAuthUids: readonly string[];
  pending: boolean;
  target?: { professionalAuthUid: string; studentAuthUid: string };
}): OwnedConnectionSnapshot {
  const professionalAuthUid = input.target?.professionalAuthUid ?? 'coach';
  const studentAuthUid = input.target?.studentAuthUid ?? 'student';
  const rows = emptyConnectionRows();
  const now = '2026-10-02T00:00:00.000Z';
  rows.userProfiles = input.fixtureAuthUids
    .slice()
    .sort()
    .map((authUid) => ({
      authUid,
      lockedRole:
        authUid === professionalAuthUid || authUid.endsWith('coach')
          ? ('professional' as const)
          : authUid === 'new'
            ? null
            : ('student' as const),
      acceptedTermsVersion: 'v1',
      createdAt: now,
      updatedAt: now,
    }));
  rows.professionalSpecialties = [
    {
      id: 'specialty-1',
      professionalAuthUid,
      specialty: 'fitness_coach',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  rows.inviteCodes = [
    {
      id: 'invite-1',
      professionalAuthUid,
      specialty: 'fitness_coach',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      rotatedAt: null,
    },
  ];
  rows.pendingStudentSlots = [
    {
      id: 'slot-1',
      professionalAuthUid,
      slotId: 'slot-1',
      studentAuthUid: input.pending ? studentAuthUid : null,
      updatedAt: now,
    },
  ];
  if (input.pending) {
    rows.connections = [
      {
        id: 'pending-1',
        professionalAuthUid,
        studentAuthUid,
        status: 'pending_confirmation',
        specialty: 'fitness_coach',
        canceledReason: null,
        sourceInviteCodeId: 'invite-1',
        createdAt: now,
        updatedAt: now,
        endedAt: null,
      },
    ];
    rows.connectionInviteGuards = [
      {
        id: 'guard-1',
        connectionId: 'pending-1',
        professionalAuthUid,
        studentAuthUid,
        specialty: 'fitness_coach',
        status: 'pending_confirmation',
        createdAt: now,
        updatedAt: now,
      },
    ];
    rows.pendingStudents = [
      {
        id: 'pending-student-1',
        professionalAuthUid,
        studentAuthUid,
        slotId: 'slot-1',
        nutritionistConnectionId: null,
        fitnessCoachConnectionId: 'pending-1',
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
  const rowCounts = Object.fromEntries(
    Object.entries(rows).map(([name, values]) => [name, values.length]),
  ) as OwnedConnectionSnapshot['rowCounts'];
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId: input.runId,
    scope: input.scope,
    readOnly: true,
    fixtureAuthUids: input.fixtureAuthUids.slice().sort(),
    target: {
      professionalAuthUid,
      studentAuthUid,
      specialty: 'fitness_coach',
    },
    rowCounts,
    rows,
  };
}

function cameraDomainSnapshot(
  snapshot: OwnedConnectionSnapshot,
  sourceInviteCodeValue: string | null,
): OwnedDomainSnapshot {
  return {
    schemaVersion: 1,
    runId: snapshot.runId,
    scope: snapshot.scope,
    readOnly: true,
    trainingPlans: [],
    connections: snapshot.rows.connections.map((row) => ({
      ...row,
      sourceInviteCodeValue,
    })),
  };
}

function isolationSnapshot(
  runId: string,
  fixtureAuthUids: readonly string[],
): OwnedConnectionSnapshot {
  return cameraConnectionSnapshot({
    runId,
    scope: 'native-conn-isolation-android',
    fixtureAuthUids,
    pending: false,
    target: {
      professionalAuthUid: 'isolation-coach',
      studentAuthUid: 'isolation-student',
    },
  });
}

async function replaceSnapshotEvidence<T extends OwnedConnectionSnapshot | OwnedDomainSnapshot>(
  fixture: {
    captureRoot: string;
    parentRoot: string;
    producer: AndroidCameraProducerReceipts;
  },
  phase: AndroidCameraProducerReceipts['sqlReceipts'][number]['phase'],
  value: T,
): Promise<OwnedSnapshotEvidence<T>> {
  const source = fixture.producer.sqlReceipts.find((row) => row.phase === phase);
  assert(source, `fixture SQL receipt missing ${phase}`);
  const bytes = jsonBytes(value);
  const parentPath = path.join(fixture.parentRoot, source.parentSnapshotPath);
  await writeFile(parentPath, bytes, { mode: 0o600 });
  const metadata = await lstat(parentPath);
  const receipt: OwnedSnapshotReceipt = {
    path: source.parentSnapshotPath,
    schema: source.parentSnapshotSchema,
    sizeBytes: bytes.byteLength,
    sha256: digest(bytes),
    ownerUid: metadata.uid,
    mode: metadata.mode & 0o777,
    verification: 'owned-runtime-document-v6',
    parentRoot: source.parentSnapshotRoot,
    kind: source.parentSnapshotKind,
    runId: source.parentRunId,
    scope: source.parentScope,
    snapshotId: `${phase}-snapshot`,
    apiOrigin: source.parentApiOrigin,
    apiPid: source.parentApiPid,
    apiStarted: source.parentApiStarted,
    apiScript: source.parentApiScript,
    backendAttemptId: source.parentBackendAttemptId,
    manifestSha256: source.parentManifestSha256,
    apiAttempt: source.parentApiAttempt,
    apiLedgerSha256: source.parentApiLedgerSha256,
    fixtureAuthUidAllowlistHash: source.parentFixtureAuthUidAllowlistHash,
  };
  return { value, receipt };
}

function apiProbe(
  source: AndroidCameraProducerReceipts['sqlReceipts'][number],
): OwnedApiLifetimeProbe {
  return {
    runId: source.parentRunId,
    apiOrigin: source.parentApiOrigin,
    apiPid: source.parentApiPid,
    apiStarted: source.parentApiStarted,
    apiScript: source.parentApiScript,
    backendAttemptId: source.parentBackendAttemptId,
    manifestSha256: source.parentManifestSha256,
    apiAttempt: source.parentApiAttempt,
    apiLedgerSha256: source.parentApiLedgerSha256,
  };
}

function hierarchyNode(
  attributes: Record<string, unknown>,
  children: unknown[] = [],
): Record<string, unknown> {
  return { attributes: { bounds: CAMERA_BOUNDS, ...attributes }, children };
}

function cameraAppTree(children: unknown[] = []): Record<string, unknown> {
  return hierarchyNode(
    {
      'resource-id': `${CAMERA_APP_ID}:id/action_bar_root`,
      package: CAMERA_APP_ID,
      visible: true,
      enabled: true,
    },
    children,
  );
}

function actualCameraTrees(
  code: string,
): Record<AndroidCameraFrameSource['label'], Record<string, unknown>> {
  const systemPackage = 'com.android.permissioncontroller';
  return {
    entry: cameraAppTree([
      hierarchyNode({
        'resource-id': 'student.professionals.screen',
        package: CAMERA_APP_ID,
        visible: true,
        enabled: true,
      }),
      hierarchyNode({
        'resource-id': 'student.professionals.scanQrButton',
        package: CAMERA_APP_ID,
        visible: true,
        enabled: true,
        clickable: true,
      }),
    ]),
    prompt: hierarchyNode({ package: systemPackage, visible: true, enabled: true }, [
      hierarchyNode({
        package: systemPackage,
        'resource-id': `${systemPackage}:id/permission_message`,
        text: 'Allow MyChampions Dev to take pictures and record video?',
        visible: true,
        enabled: true,
      }),
      hierarchyNode({
        package: systemPackage,
        'resource-id': `${systemPackage}:id/permission_deny_button`,
        text: "Don't allow",
        visible: true,
        enabled: true,
        clickable: true,
      }),
    ]),
    denied: cameraAppTree([
      hierarchyNode({
        'resource-id': 'student.professionals.submitError',
        package: CAMERA_APP_ID,
        text: 'Camera access is required to scan a QR code. Grant permission in your device settings, or type the code manually.',
        visible: true,
        enabled: true,
      }),
      hierarchyNode({
        'resource-id': 'student.professionals.codeInput',
        package: CAMERA_APP_ID,
        text: code,
        visible: true,
        enabled: true,
      }),
    ]),
    manual: cameraAppTree([
      hierarchyNode({
        'resource-id': 'student.professionals.codeInput',
        package: CAMERA_APP_ID,
        text: code,
        visible: true,
        enabled: true,
      }),
      hierarchyNode({
        'resource-id': 'student.professionals.connectButton',
        package: CAMERA_APP_ID,
        visible: true,
        enabled: true,
        clickable: true,
      }),
    ]),
    pending: cameraAppTree([
      hierarchyNode(
        {
          'resource-id': 'student.professionals.connectionPending.pending-1',
          package: CAMERA_APP_ID,
          visible: true,
          enabled: true,
        },
        [
          hierarchyNode({
            package: CAMERA_APP_ID,
            text: 'Waiting for professional confirmation to activate this connection.',
            visible: true,
            enabled: true,
          }),
        ],
      ),
    ]),
  };
}

function cameraTreeForLabel(
  trees: ReturnType<typeof actualCameraTrees>,
  label: AndroidCameraFrameSource['label'],
): Record<string, unknown> {
  switch (label) {
    case 'entry':
      return trees.entry;
    case 'prompt':
      return trees.prompt;
    case 'denied':
      return trees.denied;
    case 'manual':
      return trees.manual;
    case 'pending':
      return trees.pending;
  }
}

function localeHierarchy(): unknown {
  return hierarchyNode({ 'resource-id': 'app.root' }, [
    hierarchyNode({ 'resource-id': 'testing.locale.diagnostic' }, [
      hierarchyNode({ 'resource-id': 'testing.locale.hydration.hydrated' }),
      hierarchyNode({ 'resource-id': 'testing.locale.effective.en-US' }),
      hierarchyNode({ 'resource-id': 'testing.locale.override.absent' }),
    ]),
  ]);
}

function commandExecution(pid: number, stdoutPath: string | null): NativeCommandExecution {
  return {
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    pid,
    pgid: pid,
    logPath: `commands/${pid}.log`,
    stdoutPath,
    ownershipPath: `commands/${pid}.ownership.json`,
    elapsedMs: 1,
    cleanupMs: 1,
    censusFailure: null,
    outputFailure: null,
  };
}

function localeProperty(): AndroidLocalePropertyRead {
  return {
    status: 'completed',
    value: 'en-US',
    execution: 'completed',
    cleanup: 'cleaned',
    attempted: true,
    stdoutText: 'en-US\n',
    childExitCode: 0,
    childSignal: null,
    pid: 4500,
    pgid: 4500,
    logPath: 'locale.log',
    stdoutPath: null,
  };
}

async function actualCameraBoundary(
  fixture: AndroidCameraEligibilityFixture,
  signal: AbortSignal,
  deadlineAtMonotonicMs: number,
  inviteState: { environment: Record<string, string>; assignments: number },
): Promise<AndroidCameraCaptureBoundary> {
  const code = 'redacted-code';
  const savedFlow: AndroidCameraSavedFlow = await loadAndroidCameraSavedFlow({
    repositoryRoot,
    selection: fixture.selection,
    signal,
    deadlineAtMonotonicMs,
  });
  assert.equal(savedFlow.binding.path, fixture.selection.scenario.maestroFlow);
  assert.equal(savedFlow.binding.scenarioId, fixture.selection.scenario.id);
  assert.equal(savedFlow.binding.flowId, fixture.selection.scenario.flowId);
  assert.equal(savedFlow.binding.fixtureRef, fixture.selection.scenario.fixtureRef);
  assert.equal(savedFlow.binding.sha256, fixture.selection.scenario.maestroFlowSha256);
  const fixtures = ownedFixtures(fixture.producer.identity.backendRunId);
  const fixtureAuthUids = Object.values(fixtures.accounts).map((account) => account.authUid);
  const beforeValue = cameraConnectionSnapshot({
    runId: fixture.producer.identity.backendRunId,
    scope: 'native-entry-android',
    fixtureAuthUids,
    pending: false,
  });
  const pendingValue = cameraConnectionSnapshot({
    runId: fixture.producer.identity.backendRunId,
    scope: 'native-entry-android',
    fixtureAuthUids,
    pending: true,
  });
  const isolationValue = isolationSnapshot(
    fixture.producer.identity.backendRunId,
    fixture.producer.isolationFixture.fixtureAuthUids,
  );
  const trainingBeforeValue = cameraDomainSnapshot(beforeValue, null);
  const trainingAfterValue = cameraDomainSnapshot(pendingValue, code);
  const [
    beforeEvidence,
    pendingEvidence,
    isolationEvidence,
    trainingBeforeEvidence,
    trainingAfterEvidence,
  ] = await Promise.all([
    replaceSnapshotEvidence(fixture, 'before', beforeValue),
    replaceSnapshotEvidence(fixture, 'pending', pendingValue),
    replaceSnapshotEvidence(fixture, 'isolation-before', isolationValue),
    replaceSnapshotEvidence(fixture, 'training-before', trainingBeforeValue),
    replaceSnapshotEvidence(fixture, 'training-after', trainingAfterValue),
  ]);
  const isolationAfterEvidence = await replaceSnapshotEvidence(
    fixture,
    'isolation-after',
    isolationValue,
  );
  for (const source of fixture.producer.sqlReceipts) {
    await rm(path.join(fixture.captureRoot, source.parentSnapshotRetainedPath), {
      force: true,
    });
    await rm(path.join(fixture.captureRoot, source.parentManifestRetainedPath), {
      force: true,
    });
    await rm(path.join(fixture.captureRoot, source.parentApiLedgerRetainedPath), {
      force: true,
    });
  }
  const apiSource = fixture.producer.sqlReceipts[0];
  const bodySource = fixture.producer.submission;
  const submitActions = ['- hideKeyboard', savedFlow.renderSubmit()]
    .filter((value) => value.length > 0)
    .join('\n');
  const actionSha256 = digest(submitActions);
  const bodyMetadata = await lstat(path.join(fixture.captureRoot, bodySource.sourcePath));
  await writeFile(
    path.join(fixture.captureRoot, bodySource.descriptorPath),
    JSON.stringify({
      kind: 'owned-native-request-body-receipt-v1',
      producer: 'owned-api-proxy-native-request-body-v1',
      bodyPath: bodySource.sourcePath,
      bodySha256: bodySource.sourceSha256,
      bodySizeBytes: bodyMetadata.size,
      requestId: bodySource.requestId,
      method: 'POST',
      route: '/connections/invite-submissions',
      status: 201,
      requestProfile: 'native',
      requestOrigin: null,
      targetOrigin: CAMERA_API_ORIGIN,
      backendAttemptId: fixture.producer.identity.backendAttemptId,
      apiPid: fixture.producer.identity.apiPid,
      manualCodeSha256: fixture.producer.manualCodeSha256,
      actionSha256,
      captureRunId: fixture.producer.captureRunId,
      sessionRunId: fixture.producer.identity.backendRunId,
      actorAuthUidHash: digest(fixtures.accounts.student.authUid),
    }) + '\n',
    { mode: 0o600 },
  );
  const capture: NativeRequestBodyCaptureReceipt = {
    kind: 'owned-native-request-body-receipt-v1',
    producer: 'owned-api-proxy-native-request-body-v1',
    requestId: bodySource.requestId,
    method: 'POST',
    pathHash: digest('/connections/invite-submissions'),
    status: 201,
    outcome: 'forwarded',
    targetOrigin: CAMERA_API_ORIGIN,
    apiPid: fixture.producer.identity.apiPid,
    backendAttemptId: fixture.producer.identity.backendAttemptId,
    actorAuthUidSha256: digest(fixtures.accounts.student.authUid),
    manualCodeSha256: fixture.producer.manualCodeSha256,
    actionSha256,
    bodyPath: bodySource.sourcePath,
    bodySha256: bodySource.sourceSha256,
    bodySizeBytes: bodyMetadata.size,
    route: '/connections/invite-submissions',
    requestProfile: 'native',
    requestOrigin: null,
    captureRunId: fixture.producer.captureRunId,
    sessionRunId: fixture.producer.identity.backendRunId,
    actorAuthUidHash: digest(fixtures.accounts.student.authUid),
    sourcePath: bodySource.sourcePath,
    sourceSha256: bodySource.sourceSha256,
    sizeBytes: bodyMetadata.size,
    descriptorPath: bodySource.descriptorPath,
    schema: 'json-code',
    source: 'owned-api-proxy-native-request-body',
  };
  const permissionDump = (flags: string): Buffer =>
    Buffer.from(
      `Package [${CAMERA_APP_ID}] (camera):\n  User 0:\n    runtime permissions:\n      android.permission.CAMERA: granted=false, flags=[${flags}]\n`,
      'utf8',
    );
  const stdout = {
    before: await writeTestArtifact(
      fixture.captureRoot,
      'permission-before.stdout',
      permissionDump(''),
    ),
    after: await writeTestArtifact(
      fixture.captureRoot,
      'permission-after.stdout',
      permissionDump('USER_SET'),
    ),
    beforeFlags: await writeTestArtifact(
      fixture.captureRoot,
      'permission-before-flags.stdout',
      permissionDump(''),
    ),
    afterFlags: await writeTestArtifact(
      fixture.captureRoot,
      'permission-after-flags.stdout',
      permissionDump('USER_SET'),
    ),
  };
  let nextPid = 5000;
  const command = (
    label: string,
    argv: readonly string[],
    receipt: AndroidStorageFileReceipt | null,
  ) => ({
    label,
    captureRunId: fixture.producer.captureRunId,
    ownerRunId: fixture.producer.identity.ownerRunId,
    serial: fixture.producer.identity.serial,
    appId: fixture.producer.identity.appId,
    attemptId: fixture.producer.identity.backendAttemptId,
    argv: [...argv],
    execution: commandExecution(nextPid++, receipt?.path ?? null),
    stdout: receipt,
  });
  const commands: AndroidCameraCommandRunner = {
    run: (label, argv) => Promise.resolve(command(label, argv, null)),
    check: (label, argv) => {
      const after = label.includes('after');
      const statusReceipt = after ? stdout.after : stdout.before;
      const flagsReceipt = after ? stdout.afterFlags : stdout.beforeFlags;
      const main = command(label, argv, statusReceipt);
      const flags = command(`${label}-flags`, argv, flagsReceipt);
      return Promise.resolve({
        ...main,
        state: {
          status: 'denied' as const,
          decisionFlags: after ? (['USER_SET'] as const) : ([] as const),
        },
        flagsCommand: flags,
      });
    },
    readLocaleProperty: () => Promise.resolve(localeProperty()),
  };
  await writeTestArtifact(
    fixture.captureRoot,
    'entry-hierarchy.json',
    jsonBytes(localeHierarchy()),
  );
  const trees = actualCameraTrees(code);
  const frameDescriptors = new Map<
    AndroidCameraFrameSource['label'],
    { source: AndroidCameraFrameSource; tree: unknown }
  >();
  for (const [index, label] of (
    ['entry', 'prompt', 'denied', 'manual', 'pending'] as const
  ).entries()) {
    const relativePath = `actual-camera-${label}.stdout`;
    const bytes = jsonBytes(trees[label]);
    const receipt = await writeTestArtifact(fixture.captureRoot, relativePath, bytes);
    const execution = commandExecution(nextPid++, relativePath);
    const commandRecord: AndroidCameraCommandReceipt = {
      label: `camera-${label}-hierarchy`,
      captureRunId: fixture.producer.captureRunId,
      ownerRunId: fixture.producer.identity.ownerRunId,
      serial: fixture.producer.identity.serial,
      appId: fixture.producer.identity.appId,
      attemptId: fixture.producer.identity.backendAttemptId,
      argv: ['shell', 'uiautomator', 'dump', relativePath],
      execution,
      stdout: receipt,
    };
    const source = {
      label,
      captureRunId: fixture.producer.captureRunId,
      ownerRunId: fixture.producer.identity.ownerRunId,
      serial: fixture.producer.identity.serial,
      appId: fixture.producer.identity.appId,
      attemptId: fixture.producer.identity.backendAttemptId,
      command: commandRecord,
      receipt: {
        path: receipt.path,
        sizeBytes: receipt.sizeBytes,
        sha256: receipt.sha256,
        ownerUid: receipt.ownerUid,
        mode: receipt.mode,
        contentKind: 'hierarchy-source',
        verification: 'owned-stable-reader-v6',
      } satisfies AndroidCapturedFrameReceipt,
      action: {
        invocationId: `${fixture.producer.captureRunId}:camera:${index + 1}`,
        ordinal: index + 1,
        label,
        actionsSha256: digest(label),
        viewId: `STATE-camera-${label}`,
        selectorKind: 'id',
        selectors: [`student.camera.${label}`],
        commandLabel: commandRecord.label,
        commandOrdinal: index,
      },
    } satisfies AndroidCameraFrameSource;
    const tree = cameraTreeForLabel(trees, label);
    frameDescriptors.set(label, { source, tree });
  }
  const primaryExpected = {
    runId: fixture.producer.identity.backendRunId,
    scope: 'native-entry-android',
    fixtureAuthUids,
    target: {
      professionalAuthUid: fixtures.accounts.coach.authUid,
      studentAuthUid: fixtures.accounts.student.authUid,
      specialty: 'fitness_coach' as const,
    },
  };
  const isolationExpected = {
    runId: fixture.producer.identity.backendRunId,
    scope: 'native-conn-isolation-android',
    fixtureAuthUids: [...fixture.producer.isolationFixture.fixtureAuthUids],
    target: { ...fixture.producer.isolationFixture.target },
  };
  let submitted = false;
  const snapshotSource: AndroidCameraSnapshotSource = {
    before: beforeEvidence.value,
    beforeEvidence,
    read: () => Promise.resolve(submitted ? pendingEvidence.value : beforeEvidence.value),
    readEvidence: () => Promise.resolve(submitted ? pendingEvidence : beforeEvidence),
    expected: primaryExpected,
    isolationExpected,
    isolationFixture: fixture.producer.isolationFixture,
    isolationBefore: isolationEvidence.value,
    isolationBeforeEvidence: isolationEvidence,
    readIsolationAfter: () => Promise.resolve(isolationEvidence.value),
    readIsolationAfterEvidence: () => Promise.resolve(isolationAfterEvidence),
    trainingBefore: trainingBeforeEvidence.value,
    trainingBeforeEvidence,
    readTrainingAfter: () => Promise.resolve(trainingAfterEvidence.value),
    readTrainingAfterEvidence: () => Promise.resolve(trainingAfterEvidence),
    isolationScope: 'native-conn-isolation-android',
    trainingScope: 'native-entry-android',
  };
  const observations = JSON.parse(
    await readFile(path.join(fixture.captureRoot, 'transport-observations.private.json'), 'utf8'),
  ) as ProxyObservation[];
  const manualCodeReceipt = {
    ...structuredClone(fixture.producer.manualCodeSource),
    actorAuthUidSha256: digest(fixtures.accounts.coach.authUid),
    codeSha256: digest(code),
  };
  const proxy = {
    observations,
    requestIdFence: 0,
    targetOrigin: CAMERA_API_ORIGIN,
    waitForQuiescence: () => Promise.resolve(),
    enableNativeRequestBodyCapture: () => undefined,
    nativeRequestBodyCapture: capture,
  };
  const requestBinding: AndroidCameraManualRequestBinding = {
    requestId: capture.requestId,
    bodyHash: capture.bodySha256,
    recorderBodyHash: capture.bodySha256,
    manualCodeSha256: capture.manualCodeSha256,
    actionSha256: capture.actionSha256,
    sourcePath: capture.sourcePath,
    sourceSha256: capture.sourceSha256,
    descriptorPath: capture.descriptorPath,
    backendAttemptId: capture.backendAttemptId,
    apiPid: capture.apiPid,
    apiOrigin: capture.targetOrigin,
  };
  return {
    output: fixture.captureRoot,
    fixtures,
    selection: fixture.selection,
    selectionHash: fixture.producer.sourceSelectionHash,
    captureRunId: fixture.producer.captureRunId,
    ownerRunId: fixture.producer.identity.ownerRunId,
    backendRunId: fixture.producer.identity.backendRunId,
    backendAttemptId: fixture.producer.identity.backendAttemptId,
    target: { ...fixture.target, apiOrigin: CAMERA_APP_ORIGIN },
    serial: fixture.producer.identity.serial,
    appId: fixture.producer.identity.appId,
    expectedAppLabel: 'MyChampions Dev',
    binaryHash: fixture.target.binaryHash ?? 'c'.repeat(64),
    buildProfile: fixture.target.buildProfile ?? 'dev-debug-arm64',
    apiOrigin: fixture.producer.identity.apiOrigin,
    apiPid: fixture.producer.identity.apiPid,
    apiStarted: fixture.producer.identity.apiStarted,
    apiScript: fixture.producer.identity.apiScript,
    expectedLocale: 'en-US',
    expectedLocaleBinding: fixture.producer.identity.locale.binding,
    localeProperties: {
      persisted: localeProperty(),
      productDefault: null,
      selected: localeProperty(),
      selectedProperty: 'persist.sys.locale',
    },
    signal,
    commands,
    observe: () => Promise.resolve(),
    execute: () => {
      submitted = true;
      proxy.requestIdFence = 2;
      return Promise.resolve();
    },
    frameDescriptors,
    proxy,
    snapshots: snapshotSource,
    probeApiLifetime: () => Promise.resolve(apiProbe(apiSource)),
    readManualCodeReceipt: (): Promise<AndroidCameraManualCodeInput> =>
      Promise.resolve({
        value: code,
        receipt: manualCodeReceipt,
      }),
    readSubmissionBinding: () => Promise.resolve(requestBinding),
    prepareStudent: () => Promise.resolve(),
    savedFlow,
    setInviteCode: (value: string) => {
      inviteState.assignments += 1;
      assert.equal(inviteState.assignments, 1);
      assert.equal(inviteState.environment.MAESTRO_CAMERA_INVITE_CODE, undefined);
      inviteState.environment.MAESTRO_CAMERA_INVITE_CODE = value;
    },
  };
}

void test('Android/Detox route validates temporal gates before route rejection', async () => {
  const result = await owner()(input({ deadlineAtMonotonicMs: Number.POSITIVE_INFINITY }));
  assert.equal(result.status, 'harness-blocked');
  assert.equal(result.failure, 'deadline-before-acquisition');
  assert.equal(result.issue, 'deadline-invalid');
});

void test('expired route blocks before unsupported owner selection', async () => {
  const result = await owner()(input({ deadlineAtMonotonicMs: performance.now() - 1 }));
  assert.equal(result.failure, 'deadline-before-acquisition');
  assert.equal(result.issue, 'deadline-before-acquisition');
});

void test('over-bound route blocks before unsupported owner selection', async () => {
  const result = await owner()(input({ deadlineAtMonotonicMs: performance.now() + 600_001 }));
  assert.equal(result.failure, 'deadline-before-acquisition');
  assert.equal(result.issue, 'deadline-exceeds-bound');
});

void test('abort wins over invalid deadline and unsupported route', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const result = await owner()(
    input({ signal: controller.signal, deadlineAtMonotonicMs: Number.POSITIVE_INFINITY }),
  );
  assert.equal(result.status, 'cancelled');
  assert.equal(result.failure, 'cancelled-before-acquisition');
});

void test('finite Android/Detox route remains explicit unavailable after temporal gates', async () => {
  const result = await owner()(
    input({
      platform: 'android',
      engine: 'detox',
      deadlineAtMonotonicMs: performance.now() + 1_000,
    }),
  );
  assert.equal(result.failure, 'owner-route-unavailable');
  assert.equal(result.issue, 'owner-route-unavailable:android/detox');
});

void test('Android capture helper ledger closes the owner and finalizer dependency graph', async () => {
  const source = await readFile(
    path.join(sourceDirectory, 'capture-android-testability.ts'),
    'utf8',
  );
  for (const helper of [
    't15-cold-android-maestro-family-attempt.ts',
    't15-cold-android-maestro-public-finalizer.ts',
    't15-cold-android-maestro-public-consumer.ts',
    't15-cold-android-reset-producer.ts',
    'run-android-camera-public-attempt.ts',
    'native-android-camera-runtime-finalizer.ts',
    'native-android-camera-runtime-eligibility.ts',
    'native-android-camera-runtime-driver.ts',
    'native-android-camera-public-staging.ts',
    'scripts/testing/t15-cold-owned-lifecycle.ts',
  ])
    assert.match(source, new RegExp(`['"]${helper.replaceAll('.', '\\.')}['"]`));
  assert.match(
    source,
    /helperInputsHash = createHash\('sha256'\)\.update\(JSON\.stringify\(beforeHelpers\)\)/,
  );
});

void test('Android camera owner happy path invokes the real production bridge and receipt validator', async () => {
  const outerRunId = 'c'.repeat(24);
  const previousWorkingDirectory = process.cwd();
  process.chdir(repositoryRoot);
  const { createAndroidCameraEligibilityFixture } =
    await import('../dependencies/android-camera-runtime-eligibility-fixture');
  const fixture = await createAndroidCameraEligibilityFixture();
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const selected = await selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-android',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
  assert.equal(selected.scenario.maestroFlow, '.maestro/flows/camera-denied-android.yaml');
  assert.equal(
    selected.scenario.maestroFlowSha256,
    '47c06ed1bfab1245f0a042433e4bdf6f74697af0a2c674f13f523bc744515e78',
  );
  fixture.selection = selected;
  fixture.producer.sourceSelectionHash = androidCameraSelectionHash(selected);
  let callbackInvocations = 0;
  let onProducerInvocations = 0;
  let returnedProducer: AndroidCameraProducerReceipts | null = null;
  try {
    const bridge = createAndroidCameraOwnedSessionBridge({
      expectedLocale: 'en-US',
      deadlineAtMonotonicMs: performance.now() + 30_000,
      sessionRunner: async (options) => {
        callbackInvocations += 1;
        assert(options.executeCamera);
        assert(options.signal);
        assert(options.deadlineAtMonotonicMs);
        const inviteState = {
          environment: {} as Record<string, string>,
          assignments: 0,
        };
        const boundary = await actualCameraBoundary(
          fixture,
          options.signal,
          options.deadlineAtMonotonicMs,
          inviteState,
        );
        const executedProducer = await options.executeCamera(boundary);
        returnedProducer = executedProducer;
        assert.equal(executedProducer.producerStatus, 'receipts-bound');
        assert.equal(onProducerInvocations, 1);
        assert(returnedProducer);
        assert.equal(inviteState.assignments, 1);
        assert.equal(inviteState.environment.MAESTRO_CAMERA_INVITE_CODE, 'redacted-code');
        const report = JSON.parse(
          await readFile(path.join(fixture.captureRoot, 'capture.private.json'), 'utf8'),
        ) as Record<string, unknown>;
        return { artifactRoot: fixture.captureRoot, exitCode: 0, report };
      },
      onProducer: (value) => {
        onProducerInvocations += 1;
        assert(value);
      },
    });
    const attempt = await runAndroidCameraAttemptV4({
      repositoryRoot: process.cwd(),
      inventory,
      requestedRunId: outerRunId,
      selection: fixture.selection,
      requiredSourcePaths: [],
      requiredDeclarationPath: androidCameraPublicRequiredDeclarationPath,
      signal: new AbortController().signal,
      bridge,
    });
    assert.equal(callbackInvocations, 1);
    assert(returnedProducer);
    assert.equal(onProducerInvocations, 1);
    assert.equal(attempt.status, 'source-only');
    assert.equal(attempt.selectionRevalidated, true);
    assert.equal(attempt.bridgeInvoked, true);
    assert.equal(attempt.producerOutput, 'receipts-bound');
    assert.equal(attempt.callbackInvocations, 1);
    const validated = requireAndroidCameraProducerOutput(returnedProducer, {
      selectionHash: fixture.producer.sourceSelectionHash,
      runId: fixture.producer.captureRunId,
    });
    assert.equal(validated.identity.captureRunId, fixture.producer.captureRunId);
    assert.equal(validated.identity.ownerRunId, fixture.producer.identity.ownerRunId);
    assert.equal(validated.identity.backendRunId, fixture.producer.identity.backendRunId);
    assert.equal(validated.frames.length, 5);
    assert.equal(
      fixture.selection.scenario.maestroFlow,
      '.maestro/flows/camera-denied-android.yaml',
    );
    assert.equal(
      fixture.selection.scenario.maestroFlowSha256,
      '47c06ed1bfab1245f0a042433e4bdf6f74697af0a2c674f13f523bc744515e78',
    );
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.parentParent, { recursive: true, force: true });
    await rm(fixture.outputParent, { recursive: true, force: true });
    process.chdir(previousWorkingDirectory);
  }
});

void test('Android helper closure is bounded and fails closed on abort, expiry, symlink, and hardlink inputs', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'mc-camera-helper-reader-'));
  const rootPath = path.join(parent, 'repo');
  await mkdir(path.join(rootPath, 'scripts/testing'), { recursive: true, mode: 0o700 });
  const root = await realpath(rootPath);
  await writeFile(path.join(root, 'package.json'), '{"private":true}\n', { mode: 0o600 });
  await writeFile(path.join(root, 'scripts/testing/owner.ts'), 'export const owner = true;\n', {
    mode: 0o600,
  });
  try {
    const rows = await readAndroidCameraHelperInputs({
      repositoryRoot: root,
      helperPaths: ['package.json', 'owner.ts'],
      deadlineAtMonotonicMs: performance.now() + 30_000,
    });
    assert.deepEqual(
      rows.map((row) => row.path),
      ['package.json', 'scripts/testing/owner.ts'],
    );

    const aborted = new AbortController();
    aborted.abort(new Error('helper closure cancelled'));
    await assert.rejects(
      readAndroidCameraHelperInputs({
        repositoryRoot: root,
        helperPaths: ['package.json'],
        signal: aborted.signal,
        deadlineAtMonotonicMs: performance.now() + 30_000,
      }),
      /helper closure cancelled/,
    );
    await assert.rejects(
      readAndroidCameraHelperInputs({
        repositoryRoot: root,
        helperPaths: ['package.json'],
        deadlineAtMonotonicMs: performance.now() - 1,
      }),
      /deadline/u,
    );

    await symlink('owner.ts', path.join(root, 'scripts/testing/owner-link.ts'));
    await assert.rejects(
      readAndroidCameraHelperInputs({
        repositoryRoot: root,
        helperPaths: ['owner-link.ts'],
        deadlineAtMonotonicMs: performance.now() + 30_000,
      }),
      /bounded owned regular file|stable/u,
    );
    await link(
      path.join(root, 'scripts/testing/owner.ts'),
      path.join(root, 'scripts/testing/owner-hardlink.ts'),
    );
    await assert.rejects(
      readAndroidCameraHelperInputs({
        repositoryRoot: root,
        helperPaths: ['owner-hardlink.ts'],
        deadlineAtMonotonicMs: performance.now() + 30_000,
      }),
      /bounded owned regular file/u,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('Android finalizer source cannot promote source-only evidence', async () => {
  const source = await readFile(
    path.join(sourceDirectory, 't15-cold-android-maestro-public-finalizer.ts'),
    'utf8',
  );
  assert.match(source, /android-maestro-source-only-native-proof-unavailable/);
  assert.match(source, /android-maestro-validated-source-only-native-proof-unavailable/);
  assert.match(source, /nativeEngineProof/);
  assert.match(source, /finalizerReceiptBinding/);
  assert.match(source, /expectedIdentity/);
  assert.match(source, /Android Maestro terminal finalizer/);
});

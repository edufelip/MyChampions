import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  runAndroidCameraCaptureCallback,
  type AndroidCameraCaptureBoundary,
  type AndroidCameraSavedFlow,
} from '../../scripts/testing/native-camera-android-capture-adapter';
import {
  androidCameraSelectionHash,
  buildAndroidCameraPermissionCommands,
  type AndroidCameraCommandReceipt,
  type AndroidCameraFrameSource,
  type AndroidCameraPermissionCheck,
} from '../../scripts/testing/native-camera-android-contract';
import { loadAndroidCameraSavedFlow } from '../../scripts/testing/native-camera-android-saved-flow';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';
import type { NativeLocaleBinding } from '../../scripts/testing/locale-native-observation';
import type {
  AndroidCameraManualCodeInput,
  AndroidCameraProducerReceipts,
  AndroidCameraProxy,
  AndroidCameraSnapshotSource,
} from '../../scripts/testing/native-camera-android-producer';
import type {
  ConnectionSnapshotExpectedIdentity,
  OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';
import type {
  AndroidLocalePropertyRead,
  readAndroidNativeLocaleProperties,
} from '../../scripts/testing/native-locale-capture-seam';
import type {
  NativeRequestBodyCaptureReceipt,
  ProxyObservation,
} from '../../scripts/testing/owned-api-proxy';
import type { NativeCommandExecution } from '../../scripts/testing/owned-native-command';
import type {
  OwnedApiLifetimeProbe,
  OwnedDomainSnapshot,
  OwnedFixtures,
  OwnedSnapshotEvidence,
  OwnedSnapshotReceipt,
} from '../../scripts/testing/owned-session';

const repositoryRoot = path.resolve(__dirname, '../..');
const HASH = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const CAPTURE_RUN_ID = 'b'.repeat(24);
const OWNER_RUN_ID = 'c'.repeat(24);
const BACKEND_RUN_ID = 'd'.repeat(24);
const API_ORIGIN = 'http://127.0.0.1:4310';
const API_PID = 4311;
const API_STARTED = '2026-10-06T00:00:00.000Z';
const API_SCRIPT = '/private/callback-control/server/src/index.ts';
const APP_ID = 'com.edufelip.mychampions.dev';
const SERIAL = 'emulator-5554';
const MANUAL_CODE = 'LIVE-CODE-123';
const PENDING_CONNECTION_ID = '01234567-89ab-cdef-0123-456789abcdef';

function privateRoot(): string {
  const value = mkdtempSync(path.join(os.tmpdir(), 'android-camera-callback-'));
  chmodSync(value, 0o700);
  return realpathSync(value);
}

function account(authUid: string, role: string | null) {
  return {
    email: `${authUid}@example.test`,
    password: 'callback-control-password',
    authUid,
    role,
  };
}

function fixtures(scope: string, prefix: string): OwnedFixtures & { schemaVersion: 1 } {
  return {
    schemaVersion: 1,
    runId: BACKEND_RUN_ID,
    scope,
    accounts: {
      new: account(`${prefix}-new`, null),
      student: account(`${prefix}-student`, 'student'),
      coach: account(`${prefix}-coach`, 'professional'),
      'unrelated-student': account(`${prefix}-unrelated-student`, 'student'),
      'unrelated-coach': account(`${prefix}-unrelated-coach`, 'professional'),
      'pending-student': account(`${prefix}-pending-student`, 'student'),
      'active-student': account(`${prefix}-active-student`, 'student'),
    },
    pendingConnectionId: PENDING_CONNECTION_ID,
    activeConnectionId: '11234567-89ab-cdef-0123-456789abcdef',
    savedPlanId: 'training_plan_01234567-89ab-cdef-0123-456789abcdef',
    draft: {
      name: 'Callback control plan',
      sessions: [
        {
          id: 'callback-session',
          name: 'Callback session',
          notes: '',
          items: [
            {
              id: 'callback-item',
              name: 'Callback exercise',
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

function profileRows(value: OwnedFixtures): OwnedConnectionSnapshot['rows']['userProfiles'] {
  return Object.values(value.accounts)
    .map((item) => ({
      authUid: item.authUid,
      lockedRole: item.role as 'student' | 'professional' | null,
      acceptedTermsVersion: 'v1',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    }))
    .sort((left, right) => left.authUid.localeCompare(right.authUid));
}

function emptyRows(value: OwnedFixtures): OwnedConnectionSnapshot['rows'] {
  const coach = value.accounts.coach.authUid;
  return {
    userProfiles: profileRows(value),
    professionalSpecialties: [
      {
        id: 'specialty-callback',
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        isActive: true,
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z',
      },
    ],
    inviteCodes: [
      {
        id: 'invite-callback',
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        status: 'active',
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z',
        rotatedAt: null,
      },
    ],
    connections: [],
    connectionInviteGuards: [],
    pendingStudents: [],
    pendingStudentSlots: [
      {
        id: 'slot-callback',
        professionalAuthUid: coach,
        slotId: 'slot-callback',
        studentAuthUid: null,
        updatedAt: '2026-10-06T00:00:00.000Z',
      },
    ],
    trackingAccess: [],
    activeSpecialties: [],
  };
}

function connectionSnapshot(
  value: OwnedFixtures,
  scope: string,
  pending: boolean,
): OwnedConnectionSnapshot {
  const rows = emptyRows(value);
  if (pending) {
    const coach = value.accounts.coach.authUid;
    const student = value.accounts.student.authUid;
    rows.connections = [
      {
        id: PENDING_CONNECTION_ID,
        professionalAuthUid: coach,
        studentAuthUid: student,
        status: 'pending_confirmation',
        specialty: 'fitness_coach',
        canceledReason: null,
        sourceInviteCodeId: 'invite-callback',
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z',
        endedAt: null,
      },
    ];
    rows.connectionInviteGuards = [
      {
        id: 'guard-callback',
        connectionId: PENDING_CONNECTION_ID,
        professionalAuthUid: coach,
        studentAuthUid: student,
        specialty: 'fitness_coach',
        status: 'pending_confirmation',
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z',
      },
    ];
    rows.pendingStudents = [
      {
        id: 'pending-callback',
        professionalAuthUid: coach,
        studentAuthUid: student,
        slotId: 'slot-callback',
        nutritionistConnectionId: null,
        fitnessCoachConnectionId: PENDING_CONNECTION_ID,
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z',
      },
    ];
    rows.pendingStudentSlots = [
      {
        id: 'slot-callback',
        professionalAuthUid: coach,
        slotId: 'slot-callback',
        studentAuthUid: student,
        updatedAt: '2026-10-06T00:00:00.000Z',
      },
    ];
  }
  const rowCounts = Object.fromEntries(
    Object.entries(rows).map(([key, current]) => [key, current.length]),
  ) as OwnedConnectionSnapshot['rowCounts'];
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId: BACKEND_RUN_ID,
    scope,
    readOnly: true,
    fixtureAuthUids: Object.values(value.accounts)
      .map((item) => item.authUid)
      .sort(),
    target: {
      professionalAuthUid: value.accounts.coach.authUid,
      studentAuthUid: value.accounts.student.authUid,
      specialty: 'fitness_coach',
    },
    rowCounts,
    rows,
  };
}

function domainSnapshot(
  scope: string,
  connections: OwnedConnectionSnapshot['rows']['connections'],
): OwnedDomainSnapshot {
  return {
    schemaVersion: 1,
    runId: BACKEND_RUN_ID,
    scope,
    readOnly: true,
    trainingPlans: [],
    connections: connections.map((row) => ({
      ...row,
      sourceInviteCodeValue: row.id === PENDING_CONNECTION_ID ? MANUAL_CODE : null,
    })),
  };
}

type ParentContext = {
  parentRoot: string;
  manifestSha256: string;
  ledgerSha256: string;
  manifestSizeBytes: number;
  ledgerSizeBytes: number;
};

function parentContext(captureRoot: string): ParentContext {
  const parentRoot = path.join(captureRoot, 'owned-server-runtime');
  mkdirSync(parentRoot, { recursive: true, mode: 0o700 });
  chmodSync(parentRoot, 0o700);
  const manifest = {
    schemaVersion: 1,
    phase: 'tests' as const,
    runId: BACKEND_RUN_ID,
    composeProject: `mc_test_${BACKEND_RUN_ID}`,
    containerId: 'a'.repeat(64),
    ownerTokenHash: 'b'.repeat(64),
    port: 4310,
    targets: {
      DATABASE_URL: `mc_test_${BACKEND_RUN_ID}`,
      FOOD_CATALOG_DATABASE_URL: `mc_test_${BACKEND_RUN_ID}_food`,
      EXERCISE_CATALOG_DATABASE_URL: `mc_test_${BACKEND_RUN_ID}_exercise`,
    },
    repoRoot: path.join(captureRoot, 'server'),
    runtimeRoot: parentRoot,
    artifactRoot: parentRoot,
    createdAt: API_STARTED,
    repositories: {
      server: { sha: 'c'.repeat(40), dirty: false, workingTreeHash: 'd'.repeat(64) },
      client: { sha: 'e'.repeat(40), dirty: false, workingTreeHash: 'f'.repeat(64) },
    },
    orchestratorPid: process.pid,
    testChildPid: null,
    fixtureScopes: [
      'native-entry-android',
      'native-conn-isolation-android',
      'native-training-android',
    ],
    processes: [{ role: 'api', pid: API_PID, started: API_STARTED, script: API_SCRIPT }],
  };
  const ledger = {
    schemaVersion: 1,
    runId: BACKEND_RUN_ID,
    ownerTokenHash: manifest.ownerTokenHash,
    pid: API_PID,
    started: API_STARTED,
    script: API_SCRIPT,
    attempt: 'session-start',
    origin: API_ORIGIN,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const ledgerBytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
  writeFileSync(path.join(parentRoot, 'manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 });
  writeFileSync(path.join(parentRoot, 'api-session-start.json'), ledgerBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  return {
    parentRoot,
    manifestSha256: HASH(manifestBytes),
    ledgerSha256: HASH(ledgerBytes),
    manifestSizeBytes: manifestBytes.byteLength,
    ledgerSizeBytes: ledgerBytes.byteLength,
  };
}

function parentReceipt(
  context: ParentContext,
  parentPath: string,
  schema: 'connection-snapshot-v1' | 'domain-snapshot-v1',
  bytes: Buffer,
): OwnedSnapshotReceipt {
  const scope = parentPath.includes('isolation')
    ? 'native-conn-isolation-android'
    : parentPath.includes('training')
      ? 'native-training-android'
      : 'native-entry-android';
  return {
    path: parentPath,
    parentRoot: context.parentRoot,
    schema,
    runId: BACKEND_RUN_ID,
    scope,
    snapshotId: `snapshot-${parentPath.replace(/[^a-z0-9]+/gu, '-')}`,
    sizeBytes: bytes.byteLength,
    sha256: HASH(bytes),
    ownerUid: process.getuid?.() ?? 0,
    mode: 0o600,
    verification: 'owned-runtime-document-v6',
    kind: schema === 'connection-snapshot-v1' ? 'connection' : 'domain',
    apiOrigin: API_ORIGIN,
    apiPid: API_PID,
    apiStarted: API_STARTED,
    apiScript: API_SCRIPT,
    backendAttemptId: `${BACKEND_RUN_ID}:first`,
    manifestSha256: context.manifestSha256,
    apiAttempt: 'session-start',
    apiLedgerSha256: context.ledgerSha256,
    fixtureAuthUidAllowlistHash: HASH('fixture-allowlist'),
  };
}

function writeParent<T>(
  context: ParentContext,
  label: string,
  schema: 'connection-snapshot-v1' | 'domain-snapshot-v1',
  value: T,
): OwnedSnapshotEvidence<T> {
  const parentPath = `${label}.private.json`;
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  writeFileSync(path.join(context.parentRoot, parentPath), bytes, { flag: 'wx', mode: 0o600 });
  return { value, receipt: parentReceipt(context, parentPath, schema, bytes) };
}

function localeBinding(): NativeLocaleBinding {
  return {
    captureRunId: CAPTURE_RUN_ID,
    sourceTreeHash: HASH('callback-source-tree'),
    helperInputsHash: HASH('callback-helper-inputs'),
    target: {
      platform: 'android',
      deviceId: SERIAL,
      osVersion: '35',
      appId: APP_ID,
      binaryHash: HASH('callback-binary'),
      apiOrigin: API_ORIGIN,
    },
  };
}

function localeProperties(): Awaited<ReturnType<typeof readAndroidNativeLocaleProperties>> {
  const selected: AndroidLocalePropertyRead = {
    execution: 'completed',
    cleanup: 'cleaned',
    attempted: true,
    stdoutText: 'en-US\n',
    status: 'completed',
    value: 'en-US',
    pid: 77,
    pgid: 77,
  };
  return {
    persisted: selected,
    productDefault: null,
    selected,
    selectedProperty: 'persist.sys.locale',
  };
}

function terminalExecution(stdoutPath: string | null, pid: number): NativeCommandExecution {
  return {
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    pid,
    pgid: pid,
    logPath: `logs/${pid}.log`,
    stdoutPath,
    ownershipPath: `ownership/${pid}.json`,
    elapsedMs: 1,
    cleanupMs: 1,
    censusFailure: undefined,
    outputFailure: undefined,
  };
}

function stdoutReceipt(relativePath: string, bytes: Buffer) {
  return {
    path: relativePath,
    kind: 'sidecar' as const,
    sizeBytes: bytes.byteLength,
    sha256: HASH(bytes),
    ownerUid: process.getuid?.() ?? 0,
    mode: 0o600,
    verification: 'owned-stable-reader-v6' as const,
  };
}

function commandReceipt(input: {
  artifactRoot: string;
  output: string;
  label: string;
  argv: readonly string[];
  pid: number;
  stdoutPath: string | null;
}): AndroidCameraCommandReceipt {
  const bytes = Buffer.from(input.output);
  if (input.stdoutPath)
    writeFileSync(path.join(input.artifactRoot, input.stdoutPath), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
  return {
    label: input.label,
    captureRunId: CAPTURE_RUN_ID,
    ownerRunId: OWNER_RUN_ID,
    serial: SERIAL,
    appId: APP_ID,
    attemptId: `${BACKEND_RUN_ID}:first`,
    argv: [...input.argv],
    execution: terminalExecution(input.stdoutPath, input.pid),
    stdout: input.stdoutPath ? stdoutReceipt(input.stdoutPath, bytes) : null,
  };
}

function permissionOutput(flags: string): string {
  return `Package [${APP_ID}] (callback-control):\n  User 0:\n    runtime permissions:\n      android.permission.CAMERA: granted=false, flags=[ ${flags} ]\n`;
}

function frameDescriptor(
  artifactRoot: string,
  label: AndroidCameraFrameSource['label'],
  tree: unknown,
  ordinal: number,
): { source: AndroidCameraFrameSource; tree: unknown } {
  const relativePath = `${label}-hierarchy.json`;
  const bytes = Buffer.from(`${JSON.stringify(tree)}\n`);
  writeFileSync(path.join(artifactRoot, relativePath), bytes, { flag: 'wx', mode: 0o600 });
  const command: AndroidCameraCommandReceipt = {
    label: `camera-${label}`,
    captureRunId: CAPTURE_RUN_ID,
    ownerRunId: OWNER_RUN_ID,
    serial: SERIAL,
    appId: APP_ID,
    attemptId: `${BACKEND_RUN_ID}:first`,
    argv: ['maestro', 'test', `--${label}`],
    execution: terminalExecution(relativePath, 200 + ordinal),
    stdout: null,
  };
  return {
    tree,
    source: {
      label,
      captureRunId: CAPTURE_RUN_ID,
      ownerRunId: OWNER_RUN_ID,
      serial: SERIAL,
      appId: APP_ID,
      attemptId: `${BACKEND_RUN_ID}:first`,
      command,
      receipt: {
        path: relativePath,
        sizeBytes: bytes.byteLength,
        sha256: HASH(bytes),
        ownerUid: process.getuid?.() ?? 0,
        mode: 0o600,
        contentKind: 'hierarchy-json',
        verification: 'owned-stable-reader-v6',
      },
      action: {
        invocationId: `${CAPTURE_RUN_ID}:camera:${ordinal}`,
        ordinal,
        label,
        actionsSha256: HASH(`${label}-actions`),
        viewId: label === 'prompt' ? 'STATE-camera-prompt' : 'SCR-student-professionals',
        selectorKind: 'id',
        selectors: ['student.professionals.screen'],
        commandLabel: command.label,
        commandOrdinal: ordinal,
      },
    },
  };
}

function appTree(children: unknown[]): unknown {
  return {
    attributes: {
      package: APP_ID,
      'resource-id': `${APP_ID}:id/action_bar_root`,
      enabled: true,
      bounds: '[0,0][1080,2400]',
    },
    children,
  };
}

function buildSnapshots(
  artifactRoot: string,
  primary: OwnedFixtures,
  isolation: OwnedFixtures,
): {
  source: AndroidCameraSnapshotSource;
  parent: ParentContext;
  expected: ConnectionSnapshotExpectedIdentity;
  isolationExpected: ConnectionSnapshotExpectedIdentity;
} {
  const parent = parentContext(artifactRoot);
  const before = connectionSnapshot(primary, 'native-entry-android', false);
  const pending = connectionSnapshot(primary, 'native-entry-android', true);
  const isolationBefore = connectionSnapshot(isolation, 'native-conn-isolation-android', false);
  const isolationAfter = connectionSnapshot(isolation, 'native-conn-isolation-android', false);
  const trainingBefore = domainSnapshot('native-training-android', before.rows.connections);
  const trainingAfter = domainSnapshot('native-training-android', pending.rows.connections);
  const beforeEvidence = writeParent(parent, 'before', 'connection-snapshot-v1', before);
  const pendingEvidence = writeParent(parent, 'pending', 'connection-snapshot-v1', pending);
  const isolationBeforeEvidence = writeParent(
    parent,
    'isolation-before',
    'connection-snapshot-v1',
    isolationBefore,
  );
  const isolationAfterEvidence = writeParent(
    parent,
    'isolation-after',
    'connection-snapshot-v1',
    isolationAfter,
  );
  const trainingBeforeEvidence = writeParent(
    parent,
    'training-before',
    'domain-snapshot-v1',
    trainingBefore,
  );
  const trainingAfterEvidence = writeParent(
    parent,
    'training-after',
    'domain-snapshot-v1',
    trainingAfter,
  );
  const expected: ConnectionSnapshotExpectedIdentity = {
    runId: BACKEND_RUN_ID,
    scope: 'native-entry-android',
    fixtureAuthUids: before.fixtureAuthUids,
    target: before.target,
  };
  const isolationExpected: ConnectionSnapshotExpectedIdentity = {
    runId: BACKEND_RUN_ID,
    scope: 'native-conn-isolation-android',
    fixtureAuthUids: isolationBefore.fixtureAuthUids,
    target: isolationBefore.target,
  };
  const isolationFixturePath = 'fixtures-native-connection-isolation-android.private.json';
  const isolationFixtureBytes = Buffer.from(`${JSON.stringify(isolation)}\n`);
  writeFileSync(path.join(artifactRoot, isolationFixturePath), isolationFixtureBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  const isolationFixture = {
    path: isolationFixturePath,
    kind: 'sidecar' as const,
    sizeBytes: isolationFixtureBytes.byteLength,
    sha256: HASH(isolationFixtureBytes),
    ownerUid: process.getuid?.() ?? 0,
    mode: 0o600,
    verification: 'owned-stable-reader-v6' as const,
    source: 'owned-session.fixtures' as const,
    runId: BACKEND_RUN_ID,
    scope: 'native-conn-isolation-android',
    fixtureAuthUids: isolationBefore.fixtureAuthUids,
    target: {
      professionalAuthUid: isolation.accounts.coach.authUid,
      studentAuthUid: isolation.accounts.student.authUid,
      specialty: 'fitness_coach' as const,
    },
  };
  let primaryReads = 0;
  const source: AndroidCameraSnapshotSource = {
    before,
    beforeEvidence,
    read: () => Promise.resolve(pending),
    readEvidence: () => {
      primaryReads += 1;
      return Promise.resolve(primaryReads === 1 ? beforeEvidence : pendingEvidence);
    },
    expected,
    isolationExpected,
    isolationFixture,
    isolationBefore,
    isolationBeforeEvidence,
    readIsolationAfter: () => Promise.resolve(isolationAfter),
    readIsolationAfterEvidence: () => Promise.resolve(isolationAfterEvidence),
    trainingBefore,
    trainingBeforeEvidence,
    readTrainingAfter: () => Promise.resolve(trainingAfter),
    readTrainingAfterEvidence: () => Promise.resolve(trainingAfterEvidence),
    isolationScope: 'native-conn-isolation-android',
    trainingScope: 'native-training-android',
  };
  return { source, parent, expected, isolationExpected };
}

function makeProxy(artifactRoot: string): {
  proxy: AndroidCameraProxy;
  getRequest: () => {
    requestId: number;
    bodyHash: string;
    manualCodeSha256: string;
    actionSha256: string;
  };
} {
  let requestIdFence = 0;
  let capture: NativeRequestBodyCaptureReceipt | null = null;
  let request: {
    requestId: number;
    bodyHash: string;
    manualCodeSha256: string;
    actionSha256: string;
  } | null = null;
  const observations: ProxyObservation[] = [];
  const proxy: AndroidCameraProxy = {
    observations,
    get requestIdFence() {
      return requestIdFence;
    },
    targetOrigin: API_ORIGIN,
    waitForQuiescence: () => Promise.resolve(),
    enableNativeRequestBodyCapture: (input) => {
      const body = Buffer.from(`${JSON.stringify({ code: MANUAL_CODE })}\n`);
      const bodyPath = 'camera-manual-submit-body.private.bin';
      const descriptorPath = 'camera-manual-submit-receipt.private.json';
      const bodySha256 = HASH(body);
      writeFileSync(path.join(artifactRoot, bodyPath), body, { flag: 'wx', mode: 0o600 });
      const next: NativeRequestBodyCaptureReceipt = {
        kind: 'owned-native-request-body-receipt-v1',
        producer: 'owned-api-proxy-native-request-body-v1',
        requestId: 2,
        method: 'POST',
        pathHash: HASH('/connections/invite-submissions'),
        status: 201,
        outcome: 'forwarded',
        targetOrigin: input.targetOrigin,
        apiPid: input.apiPid,
        backendAttemptId: input.backendAttemptId,
        actorAuthUidSha256: input.actorAuthUidSha256,
        manualCodeSha256: input.manualCodeSha256,
        actionSha256: input.actionSha256,
        bodyPath,
        bodySha256,
        bodySizeBytes: body.byteLength,
        route: '/connections/invite-submissions',
        requestProfile: 'native',
        requestOrigin: null,
        captureRunId: input.captureRunId,
        sessionRunId: input.sessionRunId,
        actorAuthUidHash: input.actorAuthUidSha256,
        sourcePath: bodyPath,
        sourceSha256: bodySha256,
        sizeBytes: body.byteLength,
        descriptorPath,
        schema: 'json-code',
        source: 'owned-api-proxy-native-request-body',
      };
      writeFileSync(path.join(artifactRoot, descriptorPath), `${JSON.stringify(next)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      capture = next;
      request = {
        requestId: 2,
        bodyHash: bodySha256,
        manualCodeSha256: input.manualCodeSha256,
        actionSha256: input.actionSha256,
      };
      observations.push(
        {
          requestId: 1,
          method: 'GET',
          pathHash: HASH('/connections'),
          requestOrigin: null,
          requestProfile: 'native',
          targetOrigin: input.targetOrigin,
          status: 200,
          outcome: 'forwarded',
          faultAttemptId: null,
          elapsedMs: 1,
        },
        {
          requestId: 2,
          method: 'POST',
          pathHash: HASH('/connections/invite-submissions'),
          requestOrigin: null,
          requestProfile: 'native',
          targetOrigin: input.targetOrigin,
          status: 201,
          outcome: 'forwarded',
          faultAttemptId: null,
          elapsedMs: 1,
        },
      );
      requestIdFence = 2;
    },
    get nativeRequestBodyCapture() {
      return capture;
    },
  };
  return {
    proxy,
    getRequest: () => {
      if (!request) throw new Error('callback control did not bind its request');
      return request;
    },
  };
}

void test('production Android callback consumes the loaded saved flow through all six stages with typed source-only seams', async () => {
  const artifactRoot = privateRoot();
  try {
    const inventory = JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ) as { scenarios: NativePilotSelection['scenario'][] };
    const selection = await selectNativePilotScenario(
      {
        platform: 'android',
        engine: 'maestro',
        scenario: 'SCN-camera-denied-android',
        mode: 'integration',
      },
      inventory,
      repositoryRoot,
    );
    const loaded = await loadAndroidCameraSavedFlow({
      repositoryRoot,
      selection,
      deadlineAtMonotonicMs: performance.now() + 30_000,
    });
    const stages: string[] = [];
    const savedFlow: AndroidCameraSavedFlow = {
      ...loaded,
      renderEntry: () => {
        stages.push('entry');
        return loaded.renderEntry();
      },
      renderPrompt: () => {
        stages.push('prompt');
        return loaded.renderPrompt();
      },
      renderDenied: (selector) => {
        stages.push('denied');
        return loaded.renderDenied(selector);
      },
      renderManual: () => {
        stages.push('manual');
        return loaded.renderManual();
      },
      renderSubmit: () => {
        stages.push('submit');
        return loaded.renderSubmit();
      },
      renderPending: (connectionId) => {
        stages.push('pending');
        return loaded.renderPending(connectionId);
      },
    };
    const primary = fixtures('native-entry-android', 'primary');
    const isolation = fixtures('native-conn-isolation-android', 'isolation');
    const snapshots = buildSnapshots(artifactRoot, primary, isolation);
    const locale = localeBinding();
    const trees = {
      entry: {
        attributes: { testID: 'testing.locale.diagnostic' },
        children: [
          { attributes: { testID: 'testing.locale.hydration.hydrated' }, children: [] },
          { attributes: { testID: 'testing.locale.effective.en-US' }, children: [] },
          { attributes: { testID: 'testing.locale.override.absent' }, children: [] },
        ],
      },
      prompt: JSON.parse(
        readFileSync(
          path.join(repositoryRoot, 'tests/fixtures/native-camera-android-prompt-v18.json'),
          'utf8',
        ),
      ) as unknown,
      denied: appTree([
        {
          attributes: {
            package: APP_ID,
            'resource-id': 'student.professionals.submitError',
            text: 'Camera access is required to scan a QR code. Grant permission in your device settings, or type the code manually.',
            enabled: true,
            bounds: '[32,1200][1048,1410]',
          },
          children: [],
        },
      ]),
      manual: appTree([
        {
          attributes: {
            package: APP_ID,
            'resource-id': 'student.professionals.codeInput',
            text: MANUAL_CODE,
            enabled: true,
            bounds: '[48,900][1032,1030]',
          },
          children: [],
        },
        {
          attributes: {
            package: APP_ID,
            'resource-id': 'student.professionals.connectButton',
            text: 'Connect',
            enabled: true,
            clickable: true,
            bounds: '[48,1080][1032,1200]',
          },
          children: [],
        },
      ]),
      pending: appTree([
        {
          attributes: {
            package: APP_ID,
            'resource-id': `student.professionals.connectionPending.${PENDING_CONNECTION_ID}`,
            enabled: true,
            bounds: '[32,1200][1048,1550]',
          },
          children: [
            {
              attributes: {
                package: APP_ID,
                text: 'Waiting for professional confirmation to activate this connection.',
                enabled: true,
                bounds: '[64,1300][1016,1400]',
              },
              children: [],
            },
          ],
        },
      ]),
    };
    const descriptors = new Map<
      AndroidCameraFrameSource['label'],
      { source: AndroidCameraFrameSource; tree: unknown }
    >();
    (['entry', 'prompt', 'denied', 'manual', 'pending'] as const).forEach((label, index) => {
      descriptors.set(label, frameDescriptor(artifactRoot, label, trees[label], index + 1));
    });
    const permissionCommands = buildAndroidCameraPermissionCommands(APP_ID);
    let commandPid = 500;
    const commands = {
      run: (label: string, argv: readonly string[]) =>
        Promise.resolve(
          commandReceipt({
            artifactRoot,
            output: '',
            label,
            argv,
            pid: commandPid++,
            stdoutPath: null,
          }),
        ),
      check: (label: string, argv: readonly string[]): Promise<AndroidCameraPermissionCheck> => {
        const flags = label.includes('before') ? 'USER_SENSITIVE_WHEN_DENIED' : 'USER_SET';
        const output = permissionOutput(flags);
        const mainPid = commandPid++;
        const flagsPid = commandPid++;
        const main = commandReceipt({
          artifactRoot,
          output,
          label,
          argv,
          pid: mainPid,
          stdoutPath: `${label}-${mainPid}.stdout`,
        });
        const flagsCommand = commandReceipt({
          artifactRoot,
          output,
          label: `${label}-flags`,
          argv: permissionCommands.checkFlags,
          pid: flagsPid,
          stdoutPath: `${label}-flags-${flagsPid}.stdout`,
        });
        return Promise.resolve({
          ...main,
          state: { status: 'denied', decisionFlags: flags.split(' ') },
          flagsCommand,
        });
      },
      readLocaleProperty: (_property: string): Promise<AndroidLocalePropertyRead> =>
        Promise.resolve({
          execution: 'completed',
          cleanup: 'cleaned',
          attempted: true,
          stdoutText: 'en-US\n',
          status: 'completed',
          value: 'en-US',
          pid: 700,
          pgid: 700,
        }),
    };
    const executeCalls: { label: string; actions: string }[] = [];
    const observeCalls: { label: string; actions: string }[] = [];
    const observe = (label: string, actions: string) => {
      observeCalls.push({ label, actions });
      return Promise.resolve();
    };
    const execute = (label: string, actions: string) => {
      executeCalls.push({ label, actions });
      return Promise.resolve();
    };
    const proxy = makeProxy(artifactRoot);
    const environment: Record<string, string> = {};
    let inviteAssignments = 0;
    const manualSource = 'coach-home-hierarchy.json';
    writeFileSync(path.join(artifactRoot, manualSource), MANUAL_CODE, { flag: 'wx', mode: 0o600 });
    const manualReceipt: AndroidCameraManualCodeInput = {
      value: MANUAL_CODE,
      receipt: {
        source: 'owned-android-coach-hierarchy',
        frameLabel: 'coach-home',
        sourcePath: manualSource,
        sourceSha256: HASH(MANUAL_CODE),
        sourceSizeBytes: Buffer.byteLength(MANUAL_CODE),
        sourceOwnerUid: process.getuid?.() ?? 0,
        sourceMode: 0o600,
        sourceVerification: 'owned-stable-reader-v6',
        commandLabel: 'coach-home-hierarchy',
        commandOrdinal: 1,
        commandPid: 800,
        commandPgid: 800,
        commandExecution: 'completed',
        commandCleanup: 'cleaned',
        commandArgvSha256: HASH('coach-home-command'),
        captureRunId: CAPTURE_RUN_ID,
        ownerRunId: OWNER_RUN_ID,
        actor: 'coach',
        actorAuthUidSha256: HASH(primary.accounts.coach.authUid),
        codeSha256: HASH(MANUAL_CODE),
      },
    };
    const target = {
      deviceId: SERIAL,
      osVersion: '35',
      appId: APP_ID,
      buildProfile: 'dev-debug-arm64',
      binaryHash: HASH('callback-binary'),
      apiOrigin: API_ORIGIN,
    };
    const boundary: AndroidCameraCaptureBoundary = {
      output: artifactRoot,
      fixtures: primary,
      selection,
      selectionHash: androidCameraSelectionHash(selection),
      captureRunId: CAPTURE_RUN_ID,
      ownerRunId: OWNER_RUN_ID,
      backendRunId: BACKEND_RUN_ID,
      backendAttemptId: `${BACKEND_RUN_ID}:first`,
      target,
      serial: SERIAL,
      appId: APP_ID,
      expectedAppLabel: 'MyChampions Dev',
      binaryHash: target.binaryHash,
      buildProfile: target.buildProfile,
      apiOrigin: API_ORIGIN,
      apiPid: API_PID,
      apiStarted: API_STARTED,
      apiScript: API_SCRIPT,
      expectedLocale: 'en-US',
      expectedLocaleBinding: locale,
      localeProperties: localeProperties(),
      signal: new AbortController().signal,
      commands,
      observe,
      execute,
      frameDescriptors: descriptors,
      proxy: proxy.proxy,
      snapshots: snapshots.source,
      probeApiLifetime: (): Promise<OwnedApiLifetimeProbe> =>
        Promise.resolve({
          runId: BACKEND_RUN_ID,
          apiOrigin: API_ORIGIN,
          apiPid: API_PID,
          apiStarted: API_STARTED,
          apiScript: API_SCRIPT,
          backendAttemptId: `${BACKEND_RUN_ID}:first`,
          manifestSha256: snapshots.parent.manifestSha256,
          apiAttempt: 'session-start',
          apiLedgerSha256: snapshots.parent.ledgerSha256,
        }),
      readManualCodeReceipt: () => Promise.resolve(manualReceipt),
      readSubmissionBinding: () => {
        const request = proxy.getRequest();
        const capture = proxy.proxy.nativeRequestBodyCapture;
        if (!capture) throw new Error('request capture receipt was not created');
        return Promise.resolve({
          requestId: request.requestId,
          bodyHash: request.bodyHash,
          recorderBodyHash: request.bodyHash,
          manualCodeSha256: request.manualCodeSha256,
          actionSha256: request.actionSha256,
          sourcePath: capture.sourcePath,
          sourceSha256: capture.sourceSha256,
          descriptorPath: capture.descriptorPath,
          backendAttemptId: capture.backendAttemptId,
          apiPid: capture.apiPid,
          apiOrigin: capture.targetOrigin,
        });
      },
      prepareStudent: () => Promise.resolve(),
      savedFlow,
      setInviteCode: (value: string) => {
        inviteAssignments += 1;
        assert.equal(environment.MAESTRO_CAMERA_INVITE_CODE, undefined);
        environment.MAESTRO_CAMERA_INVITE_CODE = value;
      },
    };
    const result: AndroidCameraProducerReceipts = await runAndroidCameraCaptureCallback(boundary);
    assert.equal(result.producerStatus, 'receipts-bound');
    assert.equal(result.identity.captureRunId, CAPTURE_RUN_ID);
    assert.equal(result.identity.target.deviceId, SERIAL);
    assert.equal(result.pendingConnectionId, PENDING_CONNECTION_ID);
    assert.equal(result.submission.requestId, result.submissionRequestId);
    assert.equal(inviteAssignments, 1);
    assert.equal(environment.MAESTRO_CAMERA_INVITE_CODE, MANUAL_CODE);
    assert.deepEqual(stages, ['entry', 'prompt', 'denied', 'manual', 'submit', 'pending']);
    assert.deepEqual(
      observeCalls.map((item) => item.label),
      ['entry', 'prompt', 'denied', 'manual', 'pending'],
    );
    const entryActions = observeCalls[0].actions;
    assert.match(entryActions, /student\.home\.accountButton/u);
    assert.match(entryActions, /student\.professionals\.screen/u);
    assert.match(entryActions, /student\.professionals\.scanQrButton/u);
    assert(
      entryActions.indexOf('student.home.accountButton') <
        entryActions.indexOf('student.professionals.screen'),
    );
    assert.match(observeCalls[2].actions, /permission_deny_button/u);
    assert.match(observeCalls[4].actions, new RegExp(PENDING_CONNECTION_ID, 'u'));
    assert.equal(executeCalls.length, 1);
    assert.equal(executeCalls[0].label, 'pending-submit');
    assert.match(executeCalls[0].actions, /student\.professionals\.connectButton/u);
    assert.deepEqual(
      result.frames.map((frame) => frame.label),
      ['entry', 'prompt', 'denied', 'manual', 'pending'],
    );
    assert(result.sqlReceipts.length > 0);
    assert.equal(result.submission.manualCodeSha256, HASH(MANUAL_CODE));
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { androidSourceIdentity } from '../../scripts/testing/android-build-identity';
import { ANDROID_CAMERA_DETOX_RUNTIME_HELPER_PATHS } from '../../scripts/testing/native-android-camera-runtime-eligibility';
import { androidCameraSelectionHash } from '../../scripts/testing/native-camera-android-contract';
import { buildNativeLocaleBinding } from '../../scripts/testing/native-locale-capture-seam';
import {
  type NativePilotSelection,
  type NativePilotTarget,
} from '../../scripts/testing/native-pilot-contract';
import type { NativeLocaleEvidence } from '../../scripts/testing/locale-native-observation';
import type {
  AndroidCameraSqlReceiptPhase,
  AndroidCameraSqlSourceReceipt,
} from '../../scripts/testing/native-camera-android-observation';
import type {
  AndroidCameraFrameSummary,
  AndroidCameraProducerReceipts,
} from '../../scripts/testing/native-camera-android-producer';

const ROOT = process.cwd();
const RUN_ID = '0123456789abcdef01234567';
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

export function cameraSelection(): NativePilotSelection {
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
      maestroFlow: '.maestro/flows/camera-denied-android.yaml',
      maestroFlowSha256: '47c06ed1bfab1245f0a042433e4bdf6f74697af0a2c674f13f523bc744515e78',
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

export function target(): FixtureTarget {
  return {
    deviceId: 'emulator-5554',
    osVersion: '37',
    appId: 'com.edufelip.mychampions.dev',
    buildProfile: 'dev-debug-arm64',
    binaryHash: BINARY,
    apiOrigin: API_ORIGIN,
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

export async function createAndroidCameraEligibilityFixture(): Promise<Fixture> {
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
  const outputRoot = path.join(outputParent, RUN_ID);
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
  const parentManifest = {
    schemaVersion: 1,
    phase: 'tests' as const,
    runId: BACKEND_ID,
    repoRoot: '/private/server',
    runtimeRoot: parentRoot,
    artifactRoot: parentRoot,
    ownerTokenHash: 'b'.repeat(64),
    containerId: 'a'.repeat(64),
    orchestratorPid: process.pid,
    composeProject: `mc_test_${BACKEND_ID}`,
    port: 4123,
    targets: {
      DATABASE_URL: `mc_test_${BACKEND_ID}`,
      FOOD_CATALOG_DATABASE_URL: `mc_test_${BACKEND_ID}_food`,
      EXERCISE_CATALOG_DATABASE_URL: `mc_test_${BACKEND_ID}_exercise`,
    },
    createdAt: API_STARTED,
    testChildPid: null,
    fixtureScopes: [
      'native-entry-android',
      'native-conn-isolation-android',
      'native-training-android',
    ],
    processes: [{ role: 'api', pid: API_PID, started: API_STARTED, script: API_SCRIPT }],
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
  const retainedManifest = await writePrivate(
    captureRoot,
    `camera-sql-manifest-${sha256(parentRoot)}.private.json`,
    parentManifestBytes,
  );
  const retainedApiLedger = await writePrivate(
    captureRoot,
    `camera-sql-api-ledger-${sha256(parentRoot)}.private.json`,
    parentApiLedgerBytes,
  );
  const parentMeta = {
    parentSnapshotRoot: parentRoot,
    parentSnapshotOwnerUid: OWNER_UID,
    parentSnapshotMode: 0o600,
    parentSnapshotVerification: 'owned-runtime-document-v6' as const,
    parentApiOrigin: API_ORIGIN,
    parentApiPid: API_PID,
    parentApiStarted: API_STARTED,
    parentApiScript: API_SCRIPT,
    parentBackendAttemptId: `${BACKEND_ID}:first`,
    parentManifestPath: 'manifest.json' as const,
    parentManifestSha256: parentManifestFile.sha256,
    parentManifestRetainedPath: retainedManifest.path,
    parentManifestRetainedKind: 'sidecar' as const,
    parentManifestRetainedSha256: retainedManifest.sha256,
    parentManifestRetainedSizeBytes: retainedManifest.sizeBytes,
    parentManifestRetainedOwnerUid: retainedManifest.ownerUid,
    parentManifestRetainedMode: retainedManifest.mode,
    parentManifestRetainedVerification: retainedManifest.verification,
    parentManifestSizeBytes: parentManifestFile.sizeBytes,
    parentApiAttempt: 'session-start',
    parentApiLedgerPath: 'api-session-start.json',
    parentApiLedgerSha256: parentApiLedgerFile.sha256,
    parentApiLedgerRetainedPath: retainedApiLedger.path,
    parentApiLedgerRetainedKind: 'sidecar' as const,
    parentApiLedgerRetainedSha256: retainedApiLedger.sha256,
    parentApiLedgerRetainedSizeBytes: retainedApiLedger.sizeBytes,
    parentApiLedgerRetainedOwnerUid: retainedApiLedger.ownerUid,
    parentApiLedgerRetainedMode: retainedApiLedger.mode,
    parentApiLedgerRetainedVerification: retainedApiLedger.verification,
    parentApiLedgerSizeBytes: parentApiLedgerFile.sizeBytes,
    parentFixtureAuthUidAllowlistHash: '3'.repeat(64),
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
    phase: AndroidCameraSqlReceiptPhase,
    scope: string,
    kind: 'connection' | 'domain',
  ): Promise<{
    path: string;
    hash: string;
    size: number;
    retainedPath: string;
    retainedHash: string;
    retainedSize: number;
    retainedOwnerUid: number;
    retainedMode: number;
    retainedVerification: 'owned-stable-reader-v6';
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
    const snapshotBytes = json(value);
    const receipt = await writePrivate(parentRoot, pathName, snapshotBytes);
    const retained = await writePrivate(
      captureRoot,
      `camera-sql-parent-${sha256(`${parentRoot}\0${pathName}\0${receipt.sha256}`)}.private.json`,
      snapshotBytes,
    );
    return {
      path: pathName,
      hash: receipt.sha256,
      size: receipt.sizeBytes,
      retainedPath: retained.path,
      retainedHash: retained.sha256,
      retainedSize: retained.sizeBytes,
      retainedOwnerUid: retained.ownerUid,
      retainedMode: retained.mode,
      retainedVerification: retained.verification,
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
        parentSnapshotRetainedOwnerUid: parent.retainedOwnerUid,
        parentSnapshotRetainedMode: parent.retainedMode,
        parentSnapshotRetainedVerification: parent.retainedVerification,
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
  const helperInputs = [] as { path: string; sha256: string }[];
  for (const helperPath of [
    'scripts/testing/native-camera-android-saved-flow.ts',
    '.maestro/flows/camera-denied-android.yaml',
    ...ANDROID_CAMERA_DETOX_RUNTIME_HELPER_PATHS,
  ])
    helperInputs.push({
      path: helperPath,
      sha256: sha256(await readFile(path.join(ROOT, helperPath))),
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

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  DETOX_CAMERA_SELECTION,
  createDetoxCameraAuthObservationReceipt,
  requireDetoxCameraAuthObservationReceipt,
  requireDetoxCameraBootstrapEvidence,
  requireDetoxCameraFrames,
  requireDetoxCameraSelection,
  requireDetoxCameraSqlIsolation,
  requireDetoxCameraTransport,
} from '../scripts/testing/native-detox-camera-ios-contract';
import { prepareDetoxCameraStageDirectory } from '../scripts/testing/native-detox-camera-ios-current-owner';
import { runOwnedDetoxIosCameraAttempt } from '../scripts/testing/native-detox-camera-ios-owner';
import { stageDetoxIosCameraPrivateEvidence } from '../scripts/testing/native-detox-camera-ios-stage';
import { verifyDetoxIosCameraPrivateEvidence } from '../scripts/testing/native-detox-camera-ios-verifier';
import type {
  DetoxCameraFrame,
  DetoxCameraAuthObservation,
  DetoxCameraBootstrapEvidence,
  DetoxCameraOwnerIdentity,
  DetoxCameraCleanup,
  DetoxCameraSqlProjection,
} from '../scripts/testing/native-detox-camera-ios-contract';
import type { DetoxCameraEvidenceLifecycle } from '../scripts/testing/native-detox-camera-ios-evidence';
import type {
  DetoxCameraCommandInput,
  DetoxCameraResponse,
} from '../scripts/testing/native-detox-camera-ios-ipc';
import type {
  DetoxCameraAcquiredRuntime,
  DetoxCameraOwner,
} from '../scripts/testing/native-detox-camera-ios-owner';
import type { DetoxCameraProducerContext } from '../scripts/testing/native-detox-camera-ios-producer';

const CHILD = {
  pid: 321,
  pgid: 321,
  startedAt: '2026-10-03T00:00:00.000Z',
} as const;

const BOOTSTRAP_PENDING = {
  commandId: 'test-bootstrap-pending-command',
  commandHash: 'a'.repeat(64),
  child: CHILD,
  readiness: {
    schema: 'detox-ios-camera-bootstrap-pending-v1',
    actor: 'student',
    landingId: 'student.home.screen',
    launch: 'fresh',
    authenticated: true,
    cameraReady: false,
    landingObservation: {
      id: 'student.home.screen',
      source: 'detox-child',
      phase: 'bootstrap-pending',
    },
    passwordSavePrompt: {
      status: 'pending',
      stage: 'owner-remote-service-helper',
      stageToken: 'a'.repeat(64),
    },
  },
} as const;

const BOOTSTRAP_RECEIPT = {
  commandId: 'test-bootstrap-complete-command',
  commandHash: 'b'.repeat(64),
  child: CHILD,
  readiness: {
    schema: 'detox-ios-camera-bootstrap-ready-v1',
    actor: 'student',
    landingId: 'student.home.screen',
    launch: 'fresh',
    authenticated: true,
    cameraReady: true,
    landingObservation: {
      id: 'student.home.screen',
      source: 'detox-child',
      phase: 'bootstrap-complete',
    },
    passwordSavePrompt: {
      status: 'dismissed',
      source: 'owner-remote-service-helper',
      targetBundleIdentifier: 'com.apple.SafariViewService',
      promptLabel: 'Save Password?',
      dismissLabel: 'Not Now',
      stageToken: 'a'.repeat(64),
      receiptSha256: 'c'.repeat(64),
      commandReceiptSha256: 'd'.repeat(64),
    },
  },
} as const;

const BOOTSTRAP_EVIDENCE: DetoxCameraBootstrapEvidence = {
  schema: 'detox-ios-camera-bootstrap-evidence-v1',
  ownerBinding: {
    deviceUdid: 'owned-sim-1',
    appBundleIdentifier: 'com.edufelip.mychampions.dev',
    binarySha256: 'a'.repeat(64),
    child: CHILD,
  },
  pending: BOOTSTRAP_PENDING,
  final: BOOTSTRAP_RECEIPT,
};

const INSTALLED_APP = {
  source: 'owned-simulator-installed-app',
  deviceUdid: 'owned-sim-1',
  bundleId: 'com.edufelip.mychampions.dev',
  appContainerPath:
    '/private/owned-simulator/Devices/owned-sim-1/Containers/Bundle/Application/mychampions.app',
  binaryHash: 'a'.repeat(64),
} as const;

function cameraLifecycle(): DetoxCameraEvidenceLifecycle {
  return {
    signal: new AbortController().signal,
    deadlineAtMonotonicMs: performance.now() + 60_000,
  };
}

function response(
  extra: Partial<Pick<DetoxCameraResponse, 'frame' | 'permission' | 'transportRequestIds'>> = {},
): DetoxCameraResponse {
  return {
    schema: 'detox-ios-camera-response-v1',
    commandId: 'test-command',
    commandHash: 'test-command-hash',
    child: CHILD,
    ok: true,
    ...extra,
  };
}

function cleanup(overrides: Partial<DetoxCameraCleanup> = {}): DetoxCameraCleanup {
  return {
    captureCleanup: 'cleaned',
    independentCleanup: 'cleaned',
    ownedProcessPairs: [{ pid: CHILD.pid, startedAt: CHILD.startedAt }],
    foreignResourcesPreserved: true,
    terminal: 'complete',
    error: null,
    ...overrides,
  };
}

async function privateFile(
  root: string,
  name: string,
  value: string,
): Promise<{
  path: string;
  sha256: string;
  bytes: number;
  mode: number;
  sourceKind: 'owned-detox-flow';
}> {
  const path = join(root, name);
  const bytes = Buffer.from(value);
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  await chmod(path, 0o600);
  const { createHash } = await import('node:crypto');
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    mode: 0o600,
    sourceKind: 'owned-detox-flow',
  };
}

function ownerIdentity(): DetoxCameraOwnerIdentity {
  return {
    runId: 'detox-camera-test-run',
    attemptId: 'detox-camera-test-run:first',
    target: {
      platform: 'ios',
      deviceId: 'owned-sim-1',
      osVersion: 'iOS-18.6',
      startedAt: '2026-10-03T00:00:00.000Z',
    },
    build: {
      appIdentifier: 'com.edufelip.mychampions.dev',
      binaryPath: '/owned/app',
      binarySha256: 'a'.repeat(64),
      configuration: 'Debug',
      toolchain: { detox: '20.47.0' },
    },
    backend: {
      runId: 'detox-camera-test-run',
      apiOrigin: 'http://127.0.0.1:3100',
      apiPid: 321,
      apiStartedAt: '2026-10-03T00:00:00.000Z',
      apiAttemptId: 'detox-camera-test-run:first',
      manifestSha256: 'a'.repeat(64),
    },
    fixture: {
      runId: 'detox-camera-test-run',
      studentAuthUid: 'student-uid',
      coachAuthUid: 'coach-uid',
      fixtureHash: 'b'.repeat(64),
    },
  };
}

function authObservation(
  owner: DetoxCameraOwnerIdentity,
  phase: DetoxCameraAuthObservation['phase'],
  actor: DetoxCameraAuthObservation['actor'],
  ordinal: number,
  requestId: number,
): DetoxCameraAuthObservation {
  const authUid = actor === 'student' ? owner.fixture.studentAuthUid : owner.fixture.coachAuthUid;
  return {
    phase,
    actor,
    ordinal,
    requestId,
    targetOrigin: owner.backend.apiOrigin,
    apiPid: owner.backend.apiPid,
    status: 201,
    authUidSha256: createHash('sha256').update(authUid).digest('hex'),
    verification: 'verified',
    verificationReason: 'verified',
    fixtureAuthUidAllowlistHash: createHash('sha256')
      .update(JSON.stringify([owner.fixture.studentAuthUid, owner.fixture.coachAuthUid].sort()))
      .digest('hex'),
  };
}

async function frame(
  root: string,
  index: number,
  state: DetoxCameraFrame['semanticState'],
  actor: 'student' | 'coach',
): Promise<DetoxCameraFrame> {
  const hierarchy = await privateFile(
    root,
    `${index}-hierarchy.xml`,
    `<hierarchy state="${state}"/>`,
  );
  const screenshot = await privateFile(root, `${index}-screenshot.png`, `png-${state}`);
  const command = await privateFile(
    root,
    `${index}-command.json`,
    JSON.stringify({ index, state }),
  );
  return {
    label: `detox-${state}`,
    actor,
    viewId: `${state}.screen`,
    hierarchy: { ...hierarchy, sourceKind: 'owned-detox-hierarchy' },
    screenshot: { ...screenshot, sourceKind: 'owned-detox-screenshot' },
    command: { ...command, sourceKind: 'owned-detox-command' },
    semanticState: state,
    ...(state === 'camera-prompt'
      ? { systemPrompt: { visible: true, action: 'request-camera' as const } }
      : {}),
    ...(state === 'coach-invite' ? { inviteCodeSha256: '9'.repeat(64) } : {}),
  };
}

void test('private Detox iOS producer reaches all four camera assertions through one owner', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-route-')));
  await chmod(root, 0o700);
  const lifecycle = cameraLifecycle();
  await mkdir(join(root, 'stage'), { mode: 0o700 });
  await chmod(join(root, 'stage'), 0o700);
  const owner = ownerIdentity();
  const frames = [
    await frame(root, 0, 'camera-entry', 'student'),
    await frame(root, 1, 'camera-prompt', 'student'),
    await frame(root, 2, 'camera-guidance', 'student'),
    await frame(root, 3, 'coach-invite', 'coach'),
    await frame(root, 4, 'student-entry', 'student'),
    await frame(root, 5, 'pending', 'student'),
  ];
  const responses = new Map<string, DetoxCameraFrame>();
  const requestedKinds: DetoxCameraCommandInput['kind'][] = [];
  const authSequence = [
    authObservation(owner, 'bootstrap-student', 'student', 11, 101),
    authObservation(owner, 'coach-transition', 'coach', 22, 202),
    authObservation(owner, 'student-transition', 'student', 33, 303),
  ];
  let authSequenceIndex = 0;
  const ipc = {
    request(command: DetoxCameraCommandInput): Promise<DetoxCameraResponse> {
      requestedKinds.push(command.kind);
      if (
        command.kind === 'bootstrap' ||
        command.kind === 'switch-account' ||
        command.kind === 'deny-camera' ||
        command.kind === 'submit-manual' ||
        command.kind === 'shutdown'
      ) {
        if (command.kind === 'deny-camera')
          return Promise.resolve(response({ permission: 'denied' }));
        if (command.kind === 'submit-manual')
          return Promise.resolve(response({ transportRequestIds: [42] }));
        return Promise.resolve(response());
      }
      if (command.kind !== 'observe') return Promise.resolve(response());
      const next = frames.find((candidate) => candidate.semanticState === command.semanticState);
      if (!next) throw new Error(`missing frame ${command.semanticState}`);
      responses.set(command.semanticState, next);
      return Promise.resolve(response({ frame: next }));
    },
    seal() {},
  };
  const context: DetoxCameraProducerContext = {
    owner,
    ipc,
    bootstrapReceipt: BOOTSTRAP_RECEIPT,
    bootstrapEvidence: BOOTSTRAP_EVIDENCE,
    installedApp: INSTALLED_APP,
    source: {
      repositoryRoot: '/owned/repository',
      sourceRevision: 'c'.repeat(40),
      helperInputsHash: 'd'.repeat(64),
      childSourceHash: 'e'.repeat(64),
      declarationHash: 'f'.repeat(64),
      publicBindingsHash: '0'.repeat(64),
    },
    permissionBefore: 'not-determined' as const,
    verifyAuthActor(actor: 'student' | 'coach') {
      const observation = authSequence[authSequenceIndex++];
      assert.ok(observation);
      assert.equal(observation.actor, actor);
      return Promise.resolve(observation);
    },
    readCameraPermission() {
      return Promise.resolve('denied' as const);
    },
    async snapshot(phase: 'before' | 'after') {
      const source = await privateFile(root, `${phase}.snapshot.json`, `snapshot-${phase}`);
      return {
        phase,
        scope: 'connection-snapshot',
        apiOrigin: owner.backend.apiOrigin,
        runId: owner.runId,
        snapshotPath: source.path,
        snapshotSha256: source.sha256,
        snapshotSource: {
          ...source,
          sourceKind: 'owned-detox-snapshot' as const,
        },
        tableRows: {
          connections: {
            rowCount: phase === 'before' ? 0 : 1,
            rowsSha256: 'same',
          },
          pendingStudents: {
            rowCount: phase === 'before' ? 0 : 1,
            rowsSha256: phase === 'before' ? 'empty' : 'pending',
          },
        },
      };
    },
    async isolationSnapshot(phase: 'before' | 'after') {
      const source = await privateFile(
        root,
        `isolation-${phase}.snapshot.json`,
        `isolation-${phase}`,
      );
      return {
        phase,
        scope: 'native-connection-isolation-ios',
        apiOrigin: owner.backend.apiOrigin,
        runId: owner.runId,
        snapshotPath: source.path,
        snapshotSha256: source.sha256,
        snapshotSource: {
          ...source,
          sourceKind: 'owned-detox-snapshot' as const,
        },
        tableRows: {
          connections: { rowCount: 0, rowsSha256: 'unchanged' },
          pendingStudents: { rowCount: 0, rowsSha256: 'unchanged' },
        },
      };
    },
    verifyIsolationUnchanged(before: DetoxCameraSqlProjection, after: DetoxCameraSqlProjection) {
      return JSON.stringify(before.tableRows) === JSON.stringify(after.tableRows);
    },
    readSubmission(requestId: number) {
      return Promise.resolve({
        connectionId: 'connection-42',
        specialty: 'fitness' as const,
        sourceInviteCodeId: 'invite-42',
        requestId,
        status: 201 as const,
        studentAuthUid: owner.fixture.studentAuthUid,
        coachAuthUid: owner.fixture.coachAuthUid,
        unchangedOtherScope: true,
      });
    },
    armSubmissionCapture(_inviteCodeSha256: string) {
      return Promise.resolve();
    },
    transportObservations() {
      return [
        {
          requestId: 42,
          method: 'POST',
          route: '/connections',
          status: 201,
          responsePrincipalUid: owner.fixture.studentAuthUid,
          requestCredentialPresent: false as const,
          afterRequestId: 42,
          source: 'owned-detox-api-proxy' as const,
        },
      ];
    },
    waitForSubmitTransport() {
      return Promise.resolve(this.transportObservations());
    },
    shutdown() {
      return Promise.resolve();
    },
    deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
    deadlineAt: Date.now() + 60_000,
  };
  const acquired: DetoxCameraAcquiredRuntime = {
    artifactRoot: root,
    stageRoot: join(root, 'stage'),
    producer: context,
    runtimeFacts: {
      childExitCode: 0,
      childSignal: null,
      childClassification: 'completed',
      flagsHash: '1'.repeat(64),
      timingsMs: {
        build: 2.5,
        install: 3.5,
        reset: 4.5,
        scenario: 0,
        verify: 1.5,
        cleanup: 0,
      },
    },
    cleanup() {
      return Promise.resolve(
        cleanup({
          ownedProcessPairs: [{ pid: 321, startedAt: owner.backend.apiStartedAt }],
        }),
      );
    },
  };
  const result = await runOwnedDetoxIosCameraAttempt({
    lifecycle,
    acquire: (): Promise<DetoxCameraAcquiredRuntime> => Promise.resolve(acquired),
  } satisfies DetoxCameraOwner);
  assert.equal(result.error, null);
  assert.equal(result.stage?.assertionIds.length, 4);
  assert.equal(result.terminal?.result, 'verified-private');
  assert.equal(result.publicPromotionEligible, false);
  assert.ok(result.report);
  assert.ok(result.runtimeFacts);
  assert.deepEqual(
    result.report.authObservationReceipt.observations.map((observation) => observation.phase),
    ['bootstrap-student', 'coach-transition', 'student-transition'],
  );
  assert.deepEqual(
    result.report.authObservationReceipt.observations.map((observation) => observation.actor),
    ['student', 'coach', 'student'],
  );
  assert.equal(
    requestedKinds.includes('bootstrap'),
    false,
    'the producer must consume the owner readiness receipt without bootstrapping again',
  );
  const outerVerification = await verifyDetoxIosCameraPrivateEvidence({
    result,
    runtimeFacts: result.runtimeFacts,
    artifactRoot: root,
    outputRoot: root,
    requestedRunId: owner.runId,
    requestedAttemptId: owner.attemptId,
    lifecycle,
  });
  assert.deepEqual(
    outerVerification.assertionBindings.map((binding) => binding.id),
    result.stage?.assertionIds,
  );
  const cancelledVerifier = new AbortController();
  cancelledVerifier.abort(new Error('verifier pre-aborted'));
  await assert.rejects(
    verifyDetoxIosCameraPrivateEvidence({
      result,
      runtimeFacts: result.runtimeFacts,
      artifactRoot: root,
      outputRoot: root,
      requestedRunId: owner.runId,
      requestedAttemptId: owner.attemptId,
      lifecycle: {
        signal: cancelledVerifier.signal,
        deadlineAtMonotonicMs: performance.now() + 60_000,
      },
    }),
    /aborted|cancel/i,
  );
  await assert.rejects(
    verifyDetoxIosCameraPrivateEvidence({
      result,
      runtimeFacts: result.runtimeFacts,
      artifactRoot: root,
      outputRoot: root,
      requestedRunId: owner.runId,
      requestedAttemptId: owner.attemptId,
      lifecycle: {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() - 1,
      },
    }),
    /deadline/i,
  );
  const cancelledStageRoot = join(root, 'stage-pre-aborted');
  await mkdir(cancelledStageRoot, { mode: 0o700 });
  await chmod(cancelledStageRoot, 0o700);
  const cancelledStage = new AbortController();
  cancelledStage.abort(new Error('stage pre-aborted'));
  await assert.rejects(
    stageDetoxIosCameraPrivateEvidence({
      report: result.report,
      outputRoot: cancelledStageRoot,
      reportPath: join(root, 'detox-camera-report.private.json'),
      cleanup: result.cleanup,
      lifecycle: {
        signal: cancelledStage.signal,
        deadlineAtMonotonicMs: performance.now() + 60_000,
      },
    }),
    /aborted|cancel/i,
  );
  const expiredStageRoot = join(root, 'stage-expired');
  await mkdir(expiredStageRoot, { mode: 0o700 });
  await chmod(expiredStageRoot, 0o700);
  await assert.rejects(
    stageDetoxIosCameraPrivateEvidence({
      report: result.report,
      outputRoot: expiredStageRoot,
      reportPath: join(root, 'detox-camera-report.private.json'),
      cleanup: result.cleanup,
      lifecycle: {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() - 1,
      },
    }),
    /deadline/i,
  );
  const publicationStageRoot = join(root, 'stage-publication-abort');
  await mkdir(publicationStageRoot, { mode: 0o700 });
  await chmod(publicationStageRoot, 0o700);
  const publicationAbort = new AbortController();
  await assert.rejects(
    stageDetoxIosCameraPrivateEvidence({
      report: result.report,
      outputRoot: publicationStageRoot,
      reportPath: join(root, 'detox-camera-report.private.json'),
      cleanup: result.cleanup,
      lifecycle: {
        signal: publicationAbort.signal,
        deadlineAtMonotonicMs: performance.now() + 60_000,
        beforePublish: () => publicationAbort.abort(new Error('abort at publication')),
      },
    }),
    /aborted|cancel|publication|deadline/i,
  );
  assert.equal(publicationAbort.signal.aborted, true);
  await assert.rejects(lstat(join(publicationStageRoot, 'detox-camera-stage.private.json')), {
    code: 'ENOENT',
  });
  const distinctStageRoot = join(root, 'stage-distinct');
  await mkdir(distinctStageRoot, { mode: 0o700 });
  const distinctStage = await stageDetoxIosCameraPrivateEvidence({
    report: result.report,
    outputRoot: distinctStageRoot,
    reportPath: join(root, 'detox-camera-report.private.json'),
    cleanup: result.cleanup,
    lifecycle,
  });
  const stagedPaths = new Set(distinctStage.files.map((file) => file.path));
  for (const evidencePaths of Object.values(distinctStage.evidence)) {
    for (const evidencePath of evidencePaths) assert.ok(stagedPaths.has(evidencePath));
  }
  await rm(root, { recursive: true, force: true });
});

void test('stage directory binding accepts a clean child and rejects an ancestor swap', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-stage-root-')));
  await chmod(root, 0o700);
  const lifecycle = cameraLifecycle();
  const stage = join(root, 'stage');
  const bound = await prepareDetoxCameraStageDirectory({
    artifactRoot: root,
    stageRoot: stage,
    signal: lifecycle.signal,
    deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
  });
  const stageMetadata = await lstat(bound.stageRoot);
  assert.equal(stageMetadata.mode & 0o777, 0o700);
  const unsafeStage = join(root, 'unsafe-stage');
  await mkdir(unsafeStage, { mode: 0o755 });
  await chmod(unsafeStage, 0o755);
  await assert.rejects(
    prepareDetoxCameraStageDirectory({
      artifactRoot: root,
      stageRoot: unsafeStage,
      signal: lifecycle.signal,
      deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
    }),
    /private 0700/i,
  );
  assert.equal((await lstat(unsafeStage)).mode & 0o777, 0o755);

  const raceRoot = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-stage-race-')));
  await chmod(raceRoot, 0o700);
  const foreign = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-stage-foreign-')));
  await chmod(foreign, 0o700);
  const movedRoot = `${raceRoot}.original`;
  let swapped = false;
  try {
    await assert.rejects(
      prepareDetoxCameraStageDirectory({
        artifactRoot: raceRoot,
        stageRoot: join(raceRoot, 'stage'),
        signal: lifecycle.signal,
        deadlineAtMonotonicMs: lifecycle.deadlineAtMonotonicMs,
        afterStageDirectoryCreate: async () => {
          await rename(raceRoot, movedRoot);
          await symlink(foreign, raceRoot);
          swapped = true;
        },
      }),
      /artifact root changed/i,
    );
    assert.deepEqual(await readdir(foreign), []);
  } finally {
    if (swapped) {
      await unlink(raceRoot);
      await rename(movedRoot, raceRoot);
    }
    await rm(root, { recursive: true, force: true });
    await rm(raceRoot, { recursive: true, force: true });
    await rm(foreign, { recursive: true, force: true });
  }
});

void test('camera selection and transport guards reject foreign engines and unbound submissions', () => {
  assert.throws(() =>
    requireDetoxCameraSelection({
      ...DETOX_CAMERA_SELECTION,
      engine: 'maestro',
    }),
  );
  assert.throws(() =>
    requireDetoxCameraTransport([], ownerIdentity(), {
      connectionId: 'x',
      specialty: 'fitness',
      sourceInviteCodeId: 'i',
      requestId: 1,
      status: 201,
      studentAuthUid: ownerIdentity().fixture.studentAuthUid,
      coachAuthUid: ownerIdentity().fixture.coachAuthUid,
      unchangedOtherScope: true,
    }),
  );
});

void test('bootstrap proof rejects missing or crossed helper evidence', () => {
  const owner = ownerIdentity();
  assert.deepEqual(
    requireDetoxCameraBootstrapEvidence(BOOTSTRAP_EVIDENCE, owner).final.readiness.cameraReady,
    true,
  );
  assert.throws(
    () =>
      requireDetoxCameraBootstrapEvidence(
        {
          ...BOOTSTRAP_EVIDENCE,
          final: {
            ...BOOTSTRAP_EVIDENCE.final,
            child: { ...CHILD, pid: CHILD.pid + 1 },
          },
        },
        owner,
      ),
    /child identity crossed/i,
  );
  assert.throws(
    () => requireDetoxCameraBootstrapEvidence({ ...BOOTSTRAP_EVIDENCE, final: undefined }, owner),
    /phases are missing/i,
  );
});

void test('native auth receipt requires real ordered student-coach-student observations', () => {
  const owner = ownerIdentity();
  const observations = [
    authObservation(owner, 'bootstrap-student', 'student', 11, 101),
    authObservation(owner, 'coach-transition', 'coach', 22, 202),
    authObservation(owner, 'student-transition', 'student', 33, 303),
  ];
  const receipt = createDetoxCameraAuthObservationReceipt(owner, observations);
  assert.deepEqual(requireDetoxCameraAuthObservationReceipt(receipt, owner), receipt);
  assert.throws(
    () =>
      requireDetoxCameraAuthObservationReceipt(
        { ...receipt, observations: receipt.observations.slice(0, 2) },
        owner,
      ),
    /missing phases|observation is missing/i,
  );
  assert.throws(
    () =>
      requireDetoxCameraAuthObservationReceipt(
        {
          ...receipt,
          observations: [receipt.observations[0], receipt.observations[2], receipt.observations[1]],
        },
        owner,
      ),
    /not bound|reordered|phase/i,
  );
  assert.throws(
    () =>
      requireDetoxCameraAuthObservationReceipt(
        {
          ...receipt,
          observations: [
            receipt.observations[0],
            { ...receipt.observations[1], actor: 'student' },
            receipt.observations[2],
          ],
        },
        owner,
      ),
    /not bound|phase/i,
  );
  assert.throws(
    () =>
      requireDetoxCameraAuthObservationReceipt(
        {
          ...receipt,
          observations: [
            receipt.observations[0],
            receipt.observations[1],
            {
              ...receipt.observations[2],
              ordinal: receipt.observations[0].ordinal,
              requestId: receipt.observations[0].requestId,
            },
          ],
        },
        owner,
      ),
    /not bound|reordered/i,
  );
  assert.throws(
    () =>
      requireDetoxCameraAuthObservationReceipt(
        {
          ...receipt,
          observations: [
            receipt.observations[0],
            receipt.observations[1],
            { ...receipt.observations[2], requestId: 150 },
          ],
        },
        owner,
      ),
    /not bound|reordered/i,
  );
  const foreignAllowlistHash = createHash('sha256')
    .update(JSON.stringify(['foreign-auth-uid']))
    .digest('hex');
  const foreignObservations = receipt.observations.map((observation) => ({
    ...observation,
    fixtureAuthUidAllowlistHash: foreignAllowlistHash,
  }));
  const foreignPayload = {
    schema: receipt.schema,
    source: receipt.source,
    ownerBinding: receipt.ownerBinding,
    observations: foreignObservations,
  };
  assert.throws(
    () =>
      requireDetoxCameraAuthObservationReceipt(
        {
          ...receipt,
          observations: foreignObservations,
          observationsSha256: createHash('sha256')
            .update(JSON.stringify(foreignPayload))
            .digest('hex'),
        },
        owner,
      ),
    /not bound/i,
  );
  assert.throws(
    () =>
      requireDetoxCameraAuthObservationReceipt(
        { ...receipt, observationsSha256: '0'.repeat(64) },
        owner,
      ),
    /hash is invalid/i,
  );
});

void test('owner identity rejects an inferred backend attempt equal to the run', () => {
  const owner = ownerIdentity();
  const snapshot: DetoxCameraSqlProjection = {
    phase: 'before',
    scope: 'native-entry-ios',
    apiOrigin: owner.backend.apiOrigin,
    runId: owner.runId,
    snapshotPath: '/owned/snapshot',
    snapshotSha256: 'a'.repeat(64),
    snapshotSource: {
      path: '/owned/snapshot',
      sha256: 'a'.repeat(64),
      bytes: 1,
      mode: 0o600,
      sourceKind: 'owned-detox-snapshot',
    },
    tableRows: { connections: { rowCount: 0, rowsSha256: 'b'.repeat(64) } },
  };
  const after = { ...snapshot, phase: 'after' as const };
  assert.throws(
    () =>
      requireDetoxCameraSqlIsolation(snapshot, after, {
        ...owner,
        backend: { ...owner.backend, apiAttemptId: owner.backend.runId },
      }),
    /identities/i,
  );
});

void test('owner keeps a cancelled child failure blocked and preserves cleanup truth', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-cancel-')));
  await chmod(root, 0o700);
  const owner = ownerIdentity();
  const cancelledContext: DetoxCameraProducerContext = {
    owner,
    ipc: {
      request(_command: DetoxCameraCommandInput): Promise<DetoxCameraResponse> {
        throw new Error('camera child cancelled before bootstrap');
      },
      seal() {},
    },
    bootstrapReceipt: BOOTSTRAP_RECEIPT,
    bootstrapEvidence: BOOTSTRAP_EVIDENCE,
    installedApp: INSTALLED_APP,
    source: {
      repositoryRoot: '/owned/repository',
      sourceRevision: 'c'.repeat(40),
      helperInputsHash: 'd'.repeat(64),
      childSourceHash: 'e'.repeat(64),
      declarationHash: 'f'.repeat(64),
      publicBindingsHash: '0'.repeat(64),
    },
    permissionBefore: 'not-determined',
    verifyAuthActor(_actor: 'student' | 'coach') {
      return Promise.reject(new Error('cancelled before auth observation'));
    },
    readCameraPermission() {
      return Promise.resolve('denied' as const);
    },
    snapshot(_phase: 'before' | 'after') {
      return Promise.reject(new Error('cancelled before snapshot'));
    },
    isolationSnapshot(_phase: 'before' | 'after') {
      return Promise.reject(new Error('cancelled before isolation snapshot'));
    },
    verifyIsolationUnchanged(_before: DetoxCameraSqlProjection, _after: DetoxCameraSqlProjection) {
      return false;
    },
    readSubmission(_requestId: number) {
      throw new Error('cancelled before submission');
    },
    armSubmissionCapture(_inviteCodeSha256: string) {
      return Promise.resolve();
    },
    transportObservations() {
      return [];
    },
    waitForSubmitTransport() {
      return Promise.resolve([]);
    },
    shutdown() {
      return Promise.resolve();
    },
    deadlineAtMonotonicMs: performance.now() + 60_000,
    deadlineAt: Date.now() + 60_000,
  };
  const lifecycle = cameraLifecycle();
  const result = await runOwnedDetoxIosCameraAttempt({
    lifecycle,
    acquire(): Promise<DetoxCameraAcquiredRuntime> {
      return Promise.resolve({
        artifactRoot: root,
        stageRoot: join(root, 'stage'),
        producer: cancelledContext,
        cleanup() {
          return Promise.resolve(
            cleanup({
              captureCleanup: 'failed',
              independentCleanup: 'failed',
              ownedProcessPairs: [],
              terminal: 'aborted',
              error: 'child',
            }),
          );
        },
      });
    },
  } satisfies DetoxCameraOwner);
  assert.equal(result.stage, null);
  assert.equal(result.terminal, null);
  assert.equal(result.cleanup.captureCleanup, 'failed');
  assert.equal(result.publicPromotionEligible, false);
});

void test('frame contract rejects an unobserved camera prompt and foreign actor frame', () => {
  const source = {
    path: '/owned/private',
    sha256: 'a'.repeat(64),
    bytes: 1,
    mode: 0o600,
    sourceKind: 'owned-detox-flow' as const,
  };
  const invalid: DetoxCameraFrame[] = [
    {
      label: 'entry',
      actor: 'student',
      viewId: 'entry',
      hierarchy: { ...source, sourceKind: 'owned-detox-hierarchy' },
      screenshot: { ...source, sourceKind: 'owned-detox-screenshot' },
      command: { ...source, sourceKind: 'owned-detox-command' },
      semanticState: 'camera-entry',
    },
    {
      label: 'prompt',
      actor: 'student',
      viewId: 'prompt',
      hierarchy: { ...source, sourceKind: 'owned-detox-hierarchy' },
      screenshot: { ...source, sourceKind: 'owned-detox-screenshot' },
      command: { ...source, sourceKind: 'owned-detox-command' },
      semanticState: 'camera-prompt',
      systemPrompt: { visible: false, action: 'request-camera' },
    },
    {
      label: 'guidance',
      actor: 'student',
      viewId: 'guidance',
      hierarchy: { ...source, sourceKind: 'owned-detox-hierarchy' },
      screenshot: { ...source, sourceKind: 'owned-detox-screenshot' },
      command: { ...source, sourceKind: 'owned-detox-command' },
      semanticState: 'camera-guidance',
    },
    {
      label: 'invite',
      actor: 'student',
      viewId: 'invite',
      hierarchy: { ...source, sourceKind: 'owned-detox-hierarchy' },
      screenshot: { ...source, sourceKind: 'owned-detox-screenshot' },
      command: { ...source, sourceKind: 'owned-detox-command' },
      semanticState: 'coach-invite',
    },
    {
      label: 'student',
      actor: 'student',
      viewId: 'student',
      hierarchy: { ...source, sourceKind: 'owned-detox-hierarchy' },
      screenshot: { ...source, sourceKind: 'owned-detox-screenshot' },
      command: { ...source, sourceKind: 'owned-detox-command' },
      semanticState: 'student-entry',
    },
    {
      label: 'pending',
      actor: 'student',
      viewId: 'pending',
      hierarchy: { ...source, sourceKind: 'owned-detox-hierarchy' },
      screenshot: { ...source, sourceKind: 'owned-detox-screenshot' },
      command: { ...source, sourceKind: 'owned-detox-command' },
      semanticState: 'pending',
    },
  ];
  assert.throws(() => requireDetoxCameraFrames(invalid));
});

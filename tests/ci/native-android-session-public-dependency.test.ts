import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, renameSync } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { androidSessionAssertionSequence } from '../../scripts/testing/android-session-charter';
import { persistAndroidConnectionEvidence } from '../../scripts/testing/capture-android-testability';
import {
  androidSessionStorageLimits,
  requireAndroidCancelledConfirmationAbsent,
  readOwnedAndroidStableFile,
  readOwnedAndroidStableFileForTest,
  writeOwnedAndroidPrivateFile,
  type AndroidSessionCheckpointPhase,
  type AndroidSessionCheckpointReceipt,
  type AndroidStorageFileReceipt,
} from '../../scripts/testing/native-android-session-adapter';
import {
  persistAndroidSessionCheckpointArtifacts,
  readAndroidSessionCheckpointArtifacts,
  requireAndroidSessionCheckpointArtifacts,
  type AndroidSessionCheckpointApiLifetime,
  type AndroidSessionCheckpointArtifacts,
} from '../../scripts/testing/native-android-session-checkpoint-copy';
import {
  androidSessionPublicCommandLabelsByAssertion,
  androidSessionPublicSelection,
  androidSessionPublicUiObservationContract,
} from '../../scripts/testing/native-android-session-public-contract';
import {
  requireAndroidCleanupEvidence,
  requireAndroidMaestroEvidence,
  requireAndroidSessionAssertionSourceHashes,
  readOwnedArtifactBytesForTest,
  readOwnedCaptureFileForTest,
  validateAndroidSessionPublicDependencyInput,
} from '../../scripts/testing/native-android-session-public-dependency';
import {
  collectAndroidSessionProducerReceipts,
  requiredAndroidSessionBundlePaths,
  stageAndroidSessionPublicDependency,
  verifyStagedAndroidSessionDependency,
} from '../../scripts/testing/native-android-session-public-staging';
import type { OwnedConnectionSnapshot } from '../../scripts/testing/native-connection-snapshot';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

const phases: readonly AndroidSessionCheckpointPhase[] = [
  'before-login',
  'after-login',
  'after-restoration',
  'after-signed-out-relaunch',
];
const runId = '0123456789abcdef01234567';
const scope = 'native-entry-android';
const apiOrigin = 'http://127.0.0.1:41001';
const apiPid = 41001;
const apiStarted = 'Thu Oct  2 04:00:00 2026';
const apiScript = '/server/scripts/testing/serve.ts';
const backendAttemptId = `${runId}:first`;
const manifestSha256 = 'a'.repeat(64);
const uid = process.getuid?.() ?? 501;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fixtureAuthUidAllowlistHash = sha256(
  Buffer.from(JSON.stringify(['coach-auth', 'student-auth'])),
);
const childTempRootEnvironmentKey = 'MYCHAMPIONS_ANDROID_SESSION_CHILD_TEMP_ROOT';

async function mkdtempForTest(prefix: string): Promise<string> {
  const assignedRoot = process.env.MYCHAMPIONS_ANDROID_SESSION_CHILD_TEMP_ROOT;
  if (assignedRoot !== undefined) {
    if (!path.isAbsolute(assignedRoot))
      throw new Error(`${childTempRootEnvironmentKey} must be absolute`);
    await mkdir(assignedRoot, { recursive: true, mode: 0o700 });
    return mkdtemp(path.join(assignedRoot, prefix));
  }
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

type Fixture = {
  root: string;
  sourceRoot: string;
  captureRoot: string;
  checkpoints: AndroidSessionCheckpointReceipt[];
  api: AndroidSessionCheckpointApiLifetime;
};

type FixtureSetupOptions = {
  onRootCreated?: (root: string) => void | Promise<void>;
};

type FullSessionFixtureOptions = {
  maestro?: FixtureSetupOptions;
  checkpoint?: FixtureSetupOptions;
};

async function cleanupSetupRoot(label: string, root: string, error: unknown): Promise<never> {
  try {
    await rm(root, { recursive: true, force: true });
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], `${label} setup and cleanup both failed`);
  }
  throw error;
}

async function cleanupSetupRoots(
  label: string,
  roots: readonly (string | undefined)[],
  error: unknown,
): Promise<never> {
  const failures: unknown[] = [error];
  for (const root of new Set(roots.filter((value): value is string => value !== undefined))) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
  }
  if (failures.length > 1)
    throw new AggregateError(failures, `${label} setup and cleanup both failed`);
  throw error;
}

function profile(phase: AndroidSessionCheckpointPhase, index: number) {
  void phase;
  const coachUpdatedAt =
    index === 0
      ? '2026-10-02T04:00:00.000Z'
      : index === 1
        ? '2026-10-02T04:00:01.000Z'
        : '2026-10-02T04:00:02.000Z';
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope,
    readOnly: true,
    fixtureAuthUids: ['coach-auth', 'student-auth'],
    target: {
      professionalAuthUid: 'coach-auth',
      studentAuthUid: 'student-auth',
      specialty: 'fitness_coach',
    },
    rowCounts: {
      userProfiles: 2,
      professionalSpecialties: 0,
      inviteCodes: 0,
      connections: 0,
      connectionInviteGuards: 0,
      pendingStudents: 0,
      pendingStudentSlots: 0,
      trackingAccess: 0,
      activeSpecialties: 0,
    },
    rows: {
      userProfiles: [
        {
          authUid: 'coach-auth',
          lockedRole: 'professional',
          acceptedTermsVersion: 'v1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: coachUpdatedAt,
        },
        {
          authUid: 'student-auth',
          lockedRole: 'student',
          acceptedTermsVersion: 'v1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      professionalSpecialties: [],
      inviteCodes: [],
      connections: [],
      connectionInviteGuards: [],
      pendingStudents: [],
      pendingStudentSlots: [],
      trackingAccess: [],
      activeSpecialties: [],
    },
  };
}

function domain(phase: AndroidSessionCheckpointPhase, index: number) {
  void phase;
  void index;
  return {
    schemaVersion: 1,
    runId,
    scope,
    readOnly: true,
    trainingPlans: [
      {
        id: 'plan-1',
        studentAuthUid: 'student-auth',
        ownerProfessionalUid: 'coach-auth',
        sourceKind: 'assigned',
        name: null,
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        sessions: [],
      },
    ],
    connections: [],
  };
}

async function writePrivateJson(root: string, relative: string, value: unknown): Promise<Buffer> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(JSON.stringify(value));
  await writeFile(file, bytes, { mode: 0o600 });
  return bytes;
}

async function fixture(options: FixtureSetupOptions = {}): Promise<Fixture> {
  const temporaryRoot = await mkdtempForTest('android-session-public-');
  let root = temporaryRoot;
  try {
    root = await realpath(temporaryRoot);
    await options.onRootCreated?.(root);
    const sourceRoot = path.join(root, 'owned-artifacts');
    const captureRoot = path.join(root, 'capture');
    await mkdir(sourceRoot, { mode: 0o700 });
    await mkdir(captureRoot, { mode: 0o700 });
    const checkpoints: AndroidSessionCheckpointReceipt[] = [];
    for (const [index, phase] of phases.entries()) {
      const profilePath = `checkpoints/${phase}/profile.private.json`;
      const domainPath = `checkpoints/${phase}/domain.private.json`;
      const profileBytes = await writePrivateJson(sourceRoot, profilePath, profile(phase, index));
      const domainBytes = await writePrivateJson(sourceRoot, domainPath, domain(phase, index));
      checkpoints.push({
        phase,
        runId,
        scope,
        apiOrigin,
        apiPid,
        backendAttemptId,
        manifestSha256,
        fixtureAuthUidAllowlistHash,
        profile: {
          path: profilePath,
          sizeBytes: profileBytes.length,
          sha256: sha256(profileBytes),
          ownerUid: uid,
          mode: 0o600,
          verification: 'owned-runtime-document-v6',
        },
        domain: {
          path: domainPath,
          sizeBytes: domainBytes.length,
          sha256: sha256(domainBytes),
          ownerUid: uid,
          mode: 0o600,
          verification: 'owned-runtime-document-v6',
        },
      });
    }
    // The parsed snapshots are intentionally stable across phases, but the
    // producer still seals eight independent owned source byte streams. Give
    // each stream a distinct harmless trailing newline and refresh its receipt
    // before the copy helper validates the source set.
    for (const [index, checkpoint] of checkpoints.entries()) {
      for (const key of ['profile', 'domain'] as const) {
        const sourcePath = path.join(sourceRoot, checkpoint[key].path);
        const value = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown;
        const bytes = Buffer.from(
          `${JSON.stringify(value)}${'\n'.repeat(index + (key === 'domain' ? 5 : 1))}`,
        );
        await writeFile(sourcePath, bytes, { mode: 0o600 });
        checkpoint[key].sizeBytes = bytes.length;
        checkpoint[key].sha256 = sha256(bytes);
      }
    }
    return {
      root,
      sourceRoot,
      captureRoot,
      checkpoints,
      api: {
        runId,
        apiOrigin,
        apiPid,
        apiStarted,
        apiScript,
        backendAttemptId,
        manifestSha256,
      },
    };
  } catch (error) {
    return cleanupSetupRoot('checkpoint fixture', root, error);
  }
}

function copyOptions(value: Fixture, probe: () => Promise<AndroidSessionCheckpointApiLifetime>) {
  return {
    outputRoot: value.captureRoot,
    sourceRoot: value.sourceRoot,
    checkpoints: value.checkpoints,
    expectedRunId: runId,
    expectedScope: scope,
    expectedApiOrigin: apiOrigin,
    expectedApiPid: apiPid,
    expectedApiStarted: apiStarted,
    expectedApiScript: apiScript,
    expectedBackendAttemptId: backendAttemptId,
    expectedManifestSha256: manifestSha256,
    expectedFixtureAuthUidAllowlistHash: fixtureAuthUidAllowlistHash,
    probeApiLifetime: probe,
  };
}

function validate(value: Fixture, artifacts: AndroidSessionCheckpointArtifacts) {
  return requireAndroidSessionCheckpointArtifacts({
    value: artifacts,
    checkpoints: value.checkpoints,
    expectedRunId: runId,
    expectedScope: scope,
    expectedApiOrigin: apiOrigin,
    expectedApiPid: apiPid,
    expectedBackendAttemptId: backendAttemptId,
    expectedManifestSha256: manifestSha256,
    expectedFixtureAuthUidAllowlistHash: fixtureAuthUidAllowlistHash,
  });
}

async function copied(value: Fixture): Promise<AndroidSessionCheckpointArtifacts> {
  const artifacts = await persistAndroidSessionCheckpointArtifacts(
    copyOptions(value, () => Promise.resolve(value.api)),
  );
  return validate(value, artifacts);
}

async function dispose(value: Fixture): Promise<void> {
  await rm(value.root, { recursive: true, force: true });
}

void test('Android consumer reads all eight owned copies after source cleanup', async () => {
  const value = await fixture();
  try {
    const artifacts = await copied(value);
    const documents = await readAndroidSessionCheckpointArtifacts({
      captureRoot: value.captureRoot,
      artifacts,
    });
    assert.equal(Object.keys(documents.profiles).length, 4);
    assert.equal(Object.keys(documents.domains).length, 4);
    for (const phase of phases) {
      assert.equal(documents.profiles[phase].receipt.schema, 'connection-snapshot-v1');
      assert.equal(documents.domains[phase].receipt.schema, 'domain-snapshot-v1');
      assert.equal(documents.profiles[phase].receipt.verification, 'owned-runtime-document-v6');
      assert.equal(documents.domains[phase].receipt.verification, 'owned-runtime-document-v6');
    }
    await rm(value.sourceRoot, { recursive: true, force: true });
    const afterCleanup = await readAndroidSessionCheckpointArtifacts({
      captureRoot: value.captureRoot,
      artifacts,
    });
    assert.equal(
      afterCleanup.profiles['after-restoration'].receipt.sha256,
      artifacts.checkpoints[2].profile.sha256,
    );
    assert.equal(
      afterCleanup.domains['after-restoration'].receipt.sha256,
      artifacts.checkpoints[2].domain.sha256,
    );
  } finally {
    await dispose(value);
  }
});

void test('Android consumer rejects a missing or partial copied bundle file', async () => {
  const value = await fixture();
  try {
    const artifacts = await copied(value);
    await unlink(path.join(value.captureRoot, artifacts.checkpoints[1].domain.path));
    await assert.rejects(
      readAndroidSessionCheckpointArtifacts({ captureRoot: value.captureRoot, artifacts }),
      /ENOENT|no such file|must be private|runtime document/,
    );
  } finally {
    await dispose(value);
  }
});

void test('Android consumer rejects forged metadata and forged copied bytes', async () => {
  const value = await fixture();
  try {
    const artifacts = await copied(value);
    const forgedMetadata = structuredClone(artifacts);
    forgedMetadata.checkpoints[0].profile.sha256 = 'c'.repeat(64);
    assert.throws(() => validate(value, forgedMetadata), /hash differs|source receipt|forged/);

    const copiedPath = path.join(value.captureRoot, artifacts.checkpoints[0].profile.path);
    await chmod(copiedPath, 0o600);
    await writeFile(copiedPath, Buffer.from(JSON.stringify(profile('before-login', 99))), {
      mode: 0o600,
    });
    await assert.rejects(
      readAndroidSessionCheckpointArtifacts({ captureRoot: value.captureRoot, artifacts }),
      /Expected values|size|hash|changed|Invalid connection-snapshot-v1/,
    );
  } finally {
    await dispose(value);
  }
});

void test('Android consumer rejects backend-path-only and duplicate-path bundles', async () => {
  const value = await fixture();
  try {
    const artifacts = await copied(value);
    const originalPathOnly = structuredClone(artifacts);
    originalPathOnly.checkpoints[0].profile.path = value.checkpoints[0].profile.path;
    assert.throws(
      () => validate(value, originalPathOnly),
      /Expected values|fixed|path|profile copy/,
    );

    const duplicatePath = structuredClone(artifacts);
    duplicatePath.checkpoints[1].domain.path = duplicatePath.checkpoints[0].domain.path;
    assert.throws(() => validate(value, duplicatePath), /Expected values|duplicated|path/);
  } finally {
    await dispose(value);
  }
});

void test('Android consumer rejects absolute original source receipt paths', async () => {
  const value = await fixture();
  try {
    const forgedReceipts = structuredClone(value.checkpoints);
    forgedReceipts[0].profile.path = '/server/.qa/runtime/old/profile.private.json';
    const artifacts = await copied(value);
    const forgedBundle = structuredClone(artifacts);
    forgedBundle.checkpoints[0].profile.source = forgedReceipts[0].profile;
    assert.throws(
      () =>
        requireAndroidSessionCheckpointArtifacts({
          value: forgedBundle,
          checkpoints: forgedReceipts,
          expectedRunId: runId,
          expectedScope: scope,
          expectedApiOrigin: apiOrigin,
          expectedApiPid: apiPid,
          expectedBackendAttemptId: backendAttemptId,
          expectedManifestSha256: manifestSha256,
          expectedFixtureAuthUidAllowlistHash: fixtureAuthUidAllowlistHash,
        }),
      /relative|absolute|path/,
    );
  } finally {
    await dispose(value);
  }
});

void test('Android consumer binds copied identity to the protected API lifetime and run', async () => {
  const value = await fixture();
  try {
    const artifacts = await copied(value);
    const forgedRun = structuredClone(artifacts);
    forgedRun.runId = 'fedcba9876543210fedcba98';
    assert.throws(() => validate(value, forgedRun), /Expected values|run identity|identity/);

    const forgedApi = structuredClone(artifacts);
    forgedApi.apiPid += 1;
    assert.throws(() => validate(value, forgedApi), /Expected values|API PID|identity/);

    const forgedManifest = structuredClone(artifacts);
    forgedManifest.manifestSha256 = 'd'.repeat(64);
    assert.throws(() => validate(value, forgedManifest), /Expected values|manifest|identity/);
  } finally {
    await dispose(value);
  }
});

async function writeArtifact(root: string, relative: string, bytes: Buffer): Promise<string> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, relative), bytes, { flag: 'wx', mode: 0o600 });
  return relative;
}

const maestroPlan = [
  { observations: ['entry'], commands: ['entry'] },
  { observations: ['coach-home'], commands: ['coach-home'] },
  { observations: ['auth-account'], commands: ['auth-account'] },
  { observations: ['auth-restored-home'], commands: ['auth-restored-home'] },
  {
    observations: ['auth-signout-open', 'auth-signout-cancelled', 'auth-signout-reopen'],
    commands: ['auth-signout-open', 'auth-signout-cancelled', 'auth-signout-reopen'],
  },
  {
    observations: ['auth-signed-out', 'auth-signed-out-relaunch'],
    commands: ['auth-signed-out', 'auth-signed-out-relaunch'],
  },
] as const;

async function writeOwnedCommand(
  root: string,
  label: string,
  index: number,
  stdoutPath: string | null,
): Promise<Record<string, unknown>> {
  const pid = 4000 + index;
  const logPath = `${label}.private.log`;
  const ownershipPath = `${label}.ownership.json`;
  await writeArtifact(root, logPath, Buffer.from(`${label}\n`));
  const ownership = {
    kind: 'private worker process ownership',
    pid,
    pgid: pid,
    processes: [
      {
        pid,
        pgid: pid,
        started: `Thu Oct  2 04:00:${String(index).padStart(2, '0')} 2026`,
        commandHash: 'a'.repeat(64),
      },
    ],
    leaderExecutions: [],
    commandCensusRequeries: [],
    escapedProcesses: [],
    escapedSignals: [],
    cleanupMode: 'step',
    naturalExitGraceMs: 1000,
    cleanup: 'cleaned',
    latestCensus: {
      observedAt: '2026-10-02T04:01:00.000Z',
      strict: false,
      groupMembers: [],
      escapedCandidates: [],
    },
    rejectedCensus: null,
  };
  await writeArtifact(root, ownershipPath, Buffer.from(JSON.stringify(ownership)));
  return {
    label,
    deadlineMs: 120000,
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    pid,
    pgid: pid,
    logPath: path.join(root, logPath),
    ownershipPath: path.join(root, ownershipPath),
    stdoutPath: stdoutPath ? path.join(root, stdoutPath) : null,
    elapsedMs: 1,
    cleanupMs: 1,
  };
}

async function maestroFixture(options: FixtureSetupOptions = {}) {
  const temporaryRoot = await mkdtempForTest('android-maestro-evidence-');
  let root = temporaryRoot;
  try {
    root = await realpath(temporaryRoot);
    await options.onRootCreated?.(root);
    const observations: Record<string, unknown>[] = [];
    const commandExecutions: Record<string, unknown>[] = [];
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    let commandIndex = 0;
    for (const contract of androidSessionPublicUiObservationContract) {
      const selector =
        contract.viewId === 'SCR-sign-in'
          ? { 'resource-id': 'auth.signIn.emailInput' }
          : contract.viewId === 'SCR-pro-home'
            ? { 'resource-id': 'pro.home.screen' }
            : contract.viewId === 'SCR-account'
              ? { 'resource-id': 'settings.account.screen' }
              : { 'resource-id': 'settings.account.signOutConfirm' };
      const hierarchy = Buffer.from(JSON.stringify({ attributes: selector, children: [] }));
      const hierarchySource = Buffer.from(`<hierarchy label="${contract.label}" />`);
      const hierarchySourcePath = `${contract.label}-hierarchy.stdout`;
      const hierarchyPath = `${contract.label}-hierarchy.json`;
      const screenshotPath = `${contract.label}.png`;
      await writeArtifact(root, hierarchySourcePath, hierarchySource);
      await writeArtifact(root, hierarchyPath, hierarchy);
      await writeArtifact(root, screenshotPath, png);
      observations.push({
        viewId: contract.viewId,
        hierarchyPath,
        screenshotPath,
      });
      for (const label of [
        `${contract.label}-readiness`,
        `${contract.label}-hierarchy`,
        contract.label,
      ]) {
        const stdout = label.endsWith('-hierarchy') ? hierarchySourcePath : null;
        commandExecutions.push(await writeOwnedCommand(root, label, commandIndex++, stdout));
      }
    }
    const assertions = androidSessionAssertionSequence.map((id, index) => ({
      id,
      order: index + 1,
      status: 'verified',
      phase: `phase-${index + 1}`,
      sourceReceiptHashes: [String.fromCharCode(97 + index).repeat(64)],
    }));
    const capture = {
      androidSessionCharter: {
        charter: 'session-account',
        status: 'verified',
        restorationCount: 1,
        assertionIds: [...androidSessionAssertionSequence],
        assertions,
        charterSha256: sha256(Buffer.from(JSON.stringify(androidSessionAssertionSequence))),
      },
      observations,
      commandExecutions,
    };
    return { root, capture, commandExecutions };
  } catch (error) {
    return cleanupSetupRoot('Maestro fixture', root, error);
  }
}

async function frameReceipt(
  root: string,
  relative: string,
  contentKind: 'hierarchy-source' | 'hierarchy-json' | 'png',
) {
  const bytes = await readFile(path.join(root, relative));
  const metadata = await lstat(path.join(root, relative));
  return {
    path: relative,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    ownerUid: metadata.uid,
    mode: metadata.mode & 0o777,
    contentKind,
    verification: 'owned-stable-reader-v6' as const,
  };
}

void test('Android source-only loader binds current observation rows and ownership ledgers', async () => {
  const value = await maestroFixture();
  try {
    const result = requireAndroidMaestroEvidence(value.root, value.capture);
    assert.equal(result.framePaths.length, 30);
    assert.equal(result.commandLabels.length, 30);
    assert.equal(result.frameHashes.size, 10);
    const expectedCancellation = requireAndroidCancelledConfirmationAbsent({
      hierarchyObserved: true,
      hierarchyPath: 'auth-signout-cancelled-hierarchy.json',
      screenshotPath: 'auth-signout-cancelled.png',
      hierarchySourcePath: 'auth-signout-cancelled-hierarchy.stdout',
      hierarchySourceReceipt: await frameReceipt(
        value.root,
        'auth-signout-cancelled-hierarchy.stdout',
        'hierarchy-source',
      ),
      hierarchyReceipt: await frameReceipt(
        value.root,
        'auth-signout-cancelled-hierarchy.json',
        'hierarchy-json',
      ),
      screenshotReceipt: await frameReceipt(value.root, 'auth-signout-cancelled.png', 'png'),
      modalPresent: false,
      confirmCtaPresent: false,
      commandExecution: value.commandExecutions.find(
        (row) => row.label === 'auth-signout-cancelled-readiness',
      ),
    });
    assert.equal(
      result.cancelledConfirmationHash,
      sha256(Buffer.from(JSON.stringify(expectedCancellation))),
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

void test('Android source-only loader rejects each failed current command row', async () => {
  for (const plan of maestroPlan) {
    const value = await maestroFixture();
    try {
      const label = `${plan.commands[0]}-readiness`;
      const command = value.commandExecutions.find((row) => row.label === label);
      assert(command);
      command.execution = 'child-failed';
      assert.throws(
        () => requireAndroidMaestroEvidence(value.root, value.capture),
        /did not complete|child failed|command cleanup/,
      );
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  }
});

void test('Android source-only loader rejects charter tamper and a valid foreign frame path', async () => {
  const charter = await maestroFixture();
  try {
    charter.capture.androidSessionCharter.charterSha256 = 'f'.repeat(64);
    assert.throws(
      () => requireAndroidMaestroEvidence(charter.root, charter.capture),
      /charter hash/,
    );
  } finally {
    await rm(charter.root, { recursive: true, force: true });
  }

  const foreign = await maestroFixture();
  try {
    const cancelled = foreign.capture.observations[6];
    cancelled.screenshotPath = 'entry.png';
    assert.throws(
      () => requireAndroidMaestroEvidence(foreign.root, foreign.capture),
      /auth-signout-cancelled.*png|Android observation/,
    );
  } finally {
    await rm(foreign.root, { recursive: true, force: true });
  }
});

void test('Android source-only loader rejects a valid but foreign assertion receipt hash', async () => {
  const value = await maestroFixture();
  try {
    const expected = value.capture.androidSessionCharter.assertions.map(
      (row) => [...row.sourceReceiptHashes] as string[],
    );
    requireAndroidSessionAssertionSourceHashes(value.capture, expected);
    const foreign = expected.map((row) => [...row]);
    foreign[0][0] = 'f'.repeat(64);
    assert.throws(
      () => requireAndroidSessionAssertionSourceHashes(value.capture, foreign),
      /not bound to its named source receipts/,
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

void test('Android source-only loader rejects ledger identity, owner/mode, and unavailable census', async () => {
  const value = await maestroFixture();
  try {
    const first = value.commandExecutions[0];
    const ownershipPath = String(first.ownershipPath);
    const ledger = JSON.parse(await readFile(ownershipPath, 'utf8')) as Record<string, unknown>;
    ledger.pid = Number(ledger.pid) + 1;
    await writeFile(ownershipPath, JSON.stringify(ledger), { mode: 0o600 });
    assert.throws(
      () => requireAndroidMaestroEvidence(value.root, value.capture),
      /ownership leader PID/,
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }

  const mode = await maestroFixture();
  try {
    await chmod(path.join(mode.root, 'entry.png'), 0o644);
    assert.throws(() => requireAndroidMaestroEvidence(mode.root, mode.capture), /mode/);
  } finally {
    await rm(mode.root, { recursive: true, force: true });
  }

  const hardlink = await maestroFixture();
  try {
    await link(path.join(hardlink.root, 'entry.png'), path.join(hardlink.root, 'entry-alias.png'));
    assert.throws(
      () => requireAndroidMaestroEvidence(hardlink.root, hardlink.capture),
      /one link|single-link/,
    );
  } finally {
    await rm(hardlink.root, { recursive: true, force: true });
  }

  const census = await maestroFixture();
  try {
    const ownershipPath = String(census.commandExecutions[0].ownershipPath);
    const ledger = JSON.parse(await readFile(ownershipPath, 'utf8')) as Record<string, unknown>;
    ledger.commandCensusRequeries = [{ result: 'unavailable', unavailable: [], current: [] }];
    await writeFile(ownershipPath, JSON.stringify(ledger), { mode: 0o600 });
    assert.throws(
      () => requireAndroidMaestroEvidence(census.root, census.capture),
      /census was unavailable/,
    );
    const gap = (pgid: unknown) => ({
      result: 'unavailable',
      unavailable: [{ pid: 999_999, pgid, started: 'now', commandHash: 'a'.repeat(64) }],
      current: [],
    });
    ledger.commandCensusRequeries = [gap(ledger.pgid)];
    await writeFile(ownershipPath, JSON.stringify(ledger), { mode: 0o600 });
    requireAndroidMaestroEvidence(census.root, census.capture);
    ledger.commandCensusRequeries = [gap(Number(ledger.pgid) + 1)];
    await writeFile(ownershipPath, JSON.stringify(ledger), { mode: 0o600 });
    assert.throws(
      () => requireAndroidMaestroEvidence(census.root, census.capture),
      /census was unavailable/,
    );
  } finally {
    await rm(census.root, { recursive: true, force: true });
  }

  const extra = await maestroFixture();
  try {
    // Setup and storage commands are steps too; only UI commands must be bound.
    extra.commandExecutions.push(
      await writeOwnedCommand(extra.root, 'android-launch', extra.commandExecutions.length, null),
    );
    requireAndroidMaestroEvidence(extra.root, extra.capture);
    extra.commandExecutions.push(
      await writeOwnedCommand(extra.root, 'rogue-readiness', extra.commandExecutions.length, null),
    );
    assert.throws(
      () => requireAndroidMaestroEvidence(extra.root, extra.capture),
      /unbound command/,
    );
  } finally {
    await rm(extra.root, { recursive: true, force: true });
  }

  assert.throws(
    () =>
      requireAndroidCleanupEvidence(
        {
          result: 'passed',
          runId,
          censusStatus: 'unavailable',
          captureResult: 'observed',
          captureCleanupClean: true,
          survivors: [],
          unknownProcessQueries: [],
          missingForeignDevices: [],
          ownedDeviceAbsent: true,
          cacheAbsent: true,
          nativePassingCases: 0,
        },
        runId,
      ),
    /census/,
  );
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function fullSelection() {
  const requirementRefs = ['REQ-session-android'];
  const requirementPaths = ['docs/qa/native-pilot/inventory.json'];
  const rows = [
    [
      'NAT-session-login',
      ['ui', 'api'],
      'Fresh synthetic sign-in fixture',
      'Submit the coach email/password body once',
      'The coach enters the native session and the API accepts the request.',
    ],
    [
      'NAT-session-restore',
      ['ui', 'api'],
      'Persisted coach session after sign-in',
      'Relaunch and hydrate the persisted native session',
      'The same coach session restores through one bounded hydrate request.',
    ],
    [
      'NAT-session-account',
      ['ui'],
      'Restored coach home',
      'Open the account screen',
      'The account screen is visible for the authenticated coach.',
    ],
    [
      'NAT-session-signout',
      ['ui', 'api'],
      'Authenticated account screen',
      'Open and cancel then confirm local sign-out',
      'The local session is cleared only after the confirmed sign-out action.',
    ],
    [
      'NAT-session-signed-out-relaunch',
      ['ui', 'api'],
      'Signed-out app state',
      'Relaunch after sign-out',
      'The signed-out relaunch has no credential-bearing auth request.',
    ],
    [
      'NAT-session-unrelated-state',
      ['sql'],
      'Synthetic domain baseline',
      'Compare the four profile/domain checkpoints',
      'Only the bounded coach updatedAt exception is allowed; domain rows stay unchanged.',
    ],
  ] as const;
  const assertionRows = rows.map(([id, evidenceKinds, startingState, action, expected]) => ({
    id,
    requirementRefs,
    requirementPaths,
    evidenceKinds,
    startingState,
    action,
    expected,
    evidencePathTemplates: evidenceKinds.map(
      (kind) =>
        `assertions/{attemptId}/${String(id).replace('NAT-session-', '')}-${String(kind)}.private.json`,
    ),
  }));
  return {
    arguments: { ...androidSessionPublicSelection },
    scenarioHash: 'c'.repeat(64),
    requirementHash: 'd'.repeat(64),
    scenario: {
      id: 'SCN-session-android',
      platform: 'android',
      engine: 'maestro',
      flowId: 'FLW-session',
      transitionIds: ['TRN-session'],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:SCN-session-android:fresh-attempt',
      requirementRefs,
      freshnessInputs: { requirementPaths },
      pilotAssertions: assertionRows,
      pilotAssertionContract: {
        count: assertionRows.length,
        sha256: sha256(Buffer.from(canonical(assertionRows))),
        dataMode: 'postgres',
      },
    },
  } as const;
}

type FullStorageSet = {
  observation: Record<string, unknown>;
  privateArtifacts: Record<string, unknown>;
};

async function fullStorageSet(
  root: string,
  label: string,
  present: boolean,
  coachHash: string,
): Promise<FullStorageSet> {
  const database = await writeOwnedAndroidPrivateFile({
    artifactRoot: root,
    relativePath: `${label}-async-storage.db`,
    bytes: Buffer.from(`database-${label}`),
    kind: 'database',
  });
  const query = await writeOwnedAndroidPrivateFile({
    artifactRoot: root,
    relativePath: `${label}-async-storage-query.json`,
    bytes: Buffer.from('[]'),
    kind: 'query',
  });
  const querySourceStable = await writeOwnedAndroidPrivateFile({
    artifactRoot: root,
    relativePath: `${label}-async-storage-query.raw.private`,
    bytes: Buffer.from(`[{"label":"${label}"}]`),
    kind: 'query',
  });
  const querySource = {
    ...querySourceStable,
    kind: 'query' as const,
    retained: false as const,
    databaseSha256: database.sha256,
    databaseSidecarSha256: [],
    verification: 'owned-query-source-v6' as const,
  };
  const databaseListing = await writeOwnedAndroidPrivateFile({
    artifactRoot: root,
    relativePath: `${label}-async-directory.stdout`,
    bytes: Buffer.from('RKStorage\n'),
    kind: 'listing',
  });
  const secureStoreListing = await writeOwnedAndroidPrivateFile({
    artifactRoot: root,
    relativePath: `${label}-secure-presence.stdout`,
    bytes: Buffer.from(present ? 'SecureStore.xml\n' : 'absent\n'),
    kind: 'listing',
  });
  const secureStore = present
    ? await writeOwnedAndroidPrivateFile({
        artifactRoot: root,
        relativePath: `${label}-secure-store.xml`,
        bytes: Buffer.from('<map><string name="session">present</string></map>'),
        kind: 'xml',
      })
    : null;
  const privateArtifacts = {
    database,
    databaseSidecars: [],
    query,
    querySource,
    secureStore,
    databaseListing,
    secureStoreListing,
  };
  const observation = {
    status: present ? 'session-present' : 'session-absent',
    reason: 'none',
    asyncStorage: {
      database: 'present',
      recordPresent: present,
      profilePresent: present,
      expiryPresent: present,
      plaintextAccessTokenPresent: false,
      plaintextRefreshTokenPresent: false,
      recordBytes: present ? 10 : null,
      profileAuthUidHash: present ? coachHash : null,
    },
    secureStore: {
      preferences: present ? 'present' : 'absent',
      sessionEntryPresent: present,
      keyFormat: present ? 'current' : 'none',
    },
    source: {
      asyncStorage: 'android-async-storage-rkstorage-sqlite',
      secureStore: 'expo-secure-store-shared-preferences-presence-only',
      sessionKeyHash: sha256(Buffer.from('auth.server.session')),
    },
    privateArtifacts,
  };
  return { observation, privateArtifacts };
}

function fullProxyObservation(
  requestId: number,
  method: string,
  pathname: string,
  status: number,
  requestCredentialPresent: boolean,
  targetOrigin: string,
): ProxyObservation {
  return {
    requestId,
    method,
    pathHash: sha256(Buffer.from(pathname)),
    requestOrigin: null,
    requestProfile: 'native',
    requestCredentialPresent,
    requestCredentialClassification: {
      authorization: requestCredentialPresent ? 'bearer' : 'absent',
      cookie: 'absent',
      knownAccessCookie: 'absent',
      knownRefreshCookie: 'absent',
      otherCookiePresent: false,
      malformedCookiePresent: false,
    },
    targetOrigin,
    status,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 1,
  };
}

async function fullSessionFixture(options: FullSessionFixtureOptions = {}) {
  let maestroRoot: string | undefined;
  let checkpointSourceRoot: string | undefined;
  try {
    const maestro = await maestroFixture(options.maestro);
    maestroRoot = maestro.root;
    const checkpointSource = await fixture(options.checkpoint);
    checkpointSourceRoot = checkpointSource.root;
    const checkpointRoot = path.join(maestro.root, 'android-session-checkpoints');
    await mkdir(checkpointRoot, { mode: 0o700 });
    const copied = await persistAndroidSessionCheckpointArtifacts({
      ...copyOptions(checkpointSource, () => Promise.resolve(checkpointSource.api)),
      outputRoot: checkpointRoot,
    });
    const documents = await readAndroidSessionCheckpointArtifacts({
      captureRoot: checkpointRoot,
      artifacts: copied,
    });
    const coachHash = sha256(Buffer.from('coach-auth'));
    const storage: Record<string, FullStorageSet> = {};
    for (const [label, present] of [
      ['auth-before-relaunch', true],
      ['auth-after-restore', true],
      ['auth-after-cancel', true],
      ['auth-after-signout', false],
      ['auth-after-signed-out-relaunch', false],
    ] as const)
      storage[label] = await fullStorageSet(maestro.root, label, present, coachHash);

    const observations = [
      fullProxyObservation(1, 'POST', '/auth/email/sign-in', 201, false, apiOrigin),
      fullProxyObservation(2, 'POST', '/me/hydrate', 200, true, apiOrigin),
    ];
    const nativeAuthIdentities: NativeAuthIdentityObservation[] = [
      {
        requestId: 1,
        ordinal: 1,
        targetOrigin: apiOrigin,
        apiPid,
        status: 201,
        authUid: 'coach-auth',
        verification: 'verified',
        verificationReason: 'verified',
        fixtureAuthUidAllowlistHash,
      },
    ];
    const evidenceReceipts = await persistAndroidConnectionEvidence(maestro.root, {
      observations,
      nativeAuthIdentities,
    });
    const restoreLifetime = {
      runId,
      proxyRunId: runId,
      proxyOrigin: 'http://127.0.0.1:41000',
      apiOrigin,
      apiPid,
      apiStarted,
      apiScript,
      backendAttemptId,
      manifestSha256,
    };
    const restore = {
      status: 'verified',
      phase: 'restore',
      beforeRequestId: 1,
      afterRequestId: 2,
      rows: [
        {
          requestId: 2,
          ordinal: 1,
          method: 'POST',
          pathHash: sha256(Buffer.from('/me/hydrate')),
          status: 200,
          outcome: 'forwarded',
          requestProfile: 'native',
          requestOrigin: null,
          targetOrigin: apiOrigin,
          faultAttemptId: null,
          requestCredentialPresent: true,
        },
      ],
      hydrationRequestIds: [2],
      signInRequestIds: [],
    };
    const signedOut = {
      status: 'verified',
      phase: 'signed-out-relaunch',
      beforeRequestId: 2,
      afterRequestId: 2,
      rows: [],
      apiLifetime: restoreLifetime,
    };
    const cancelIdentity = { status: 'verified', profileAuthUidHash: coachHash };
    const checkpoint = {
      checkpointSet: checkpointSource.checkpoints,
      copied,
      profiles: {
        beforeLogin: documents.profiles['before-login'].value as OwnedConnectionSnapshot,
        afterLogin: documents.profiles['after-login'].value as OwnedConnectionSnapshot,
        afterRestoration: documents.profiles['after-restoration'].value as OwnedConnectionSnapshot,
        afterSignedOutRelaunch: documents.profiles['after-signed-out-relaunch']
          .value as OwnedConnectionSnapshot,
      },
      domains: {
        beforeLogin: documents.domains['before-login'].value as OwnedDomainSnapshot,
        afterLogin: documents.domains['after-login'].value as OwnedDomainSnapshot,
        afterRestoration: documents.domains['after-restoration'].value as OwnedDomainSnapshot,
        afterSignedOutRelaunch: documents.domains['after-signed-out-relaunch']
          .value as OwnedDomainSnapshot,
      },
      fixtureAuthUids: ['coach-auth', 'student-auth'],
      target: {
        professionalAuthUid: 'coach-auth',
        studentAuthUid: 'student-auth',
        specialty: 'fitness_coach',
      },
      profilePaths: copied.checkpoints.map((row) => row.profile.path),
      domainPaths: copied.checkpoints.map((row) => row.domain.path),
    };
    const maestroEvidence = requireAndroidMaestroEvidence(maestro.root, maestro.capture);
    const commandHashesFor = (assertionIndex: number) =>
      androidSessionPublicCommandLabelsByAssertion[assertionIndex].flatMap((label) => [
        ...(maestroEvidence.commandHashes.get(label) ?? []),
      ]);
    const storageHashes = (label: string) => {
      const artifacts = storage[label].privateArtifacts;
      return [artifacts.database, artifacts.query, artifacts.querySource].map((receipt) =>
        String((receipt as AndroidStorageFileReceipt).sha256),
      );
    };
    const charterAssertions = [
      [
        copied.checkpoints[0].profile.sha256,
        copied.checkpoints[0].domain.sha256,
        ...commandHashesFor(0),
      ],
      [
        sha256(
          Buffer.from(
            JSON.stringify({
              requestId: 1,
              status: 201,
              targetOrigin: apiOrigin,
              runId,
              fixtureAuthUidAllowlistHash,
            }),
          ),
        ),
        ...commandHashesFor(1),
      ],
      [
        copied.checkpoints[1].profile.sha256,
        copied.checkpoints[1].domain.sha256,
        ...storageHashes('auth-before-relaunch'),
        ...commandHashesFor(2),
      ],
      [
        sha256(Buffer.from(JSON.stringify(restore))),
        copied.checkpoints[2].profile.sha256,
        copied.checkpoints[2].domain.sha256,
        ...storageHashes('auth-after-restore'),
        ...commandHashesFor(3),
      ],
      [
        maestroEvidence.cancelledConfirmationHash,
        ...(maestroEvidence.frameHashes.get('auth-signout-cancelled') ?? []),
        ...storageHashes('auth-after-cancel'),
        sha256(Buffer.from(JSON.stringify(cancelIdentity))),
        ...commandHashesFor(4),
      ],
      [
        sha256(Buffer.from(JSON.stringify(signedOut))),
        copied.checkpoints[3].profile.sha256,
        copied.checkpoints[3].domain.sha256,
        ...storageHashes('auth-after-signed-out-relaunch'),
        ...commandHashesFor(5),
      ],
    ];
    maestro.capture.androidSessionCharter = {
      charter: 'session-account',
      status: 'verified',
      restorationCount: 1,
      assertionIds: [...androidSessionAssertionSequence],
      assertions: androidSessionAssertionSequence.map((id, index) => ({
        id,
        order: index + 1,
        status: 'verified',
        phase: `phase-${index + 1}`,
        sourceReceiptHashes: charterAssertions[index],
      })),
      charterSha256: sha256(Buffer.from(JSON.stringify(androidSessionAssertionSequence))),
    };
    const capture = {
      ...maestro.capture,
      kind: 'private-owned-native-session-execution-not-public-receipt',
      mode: 'integration',
      platform: 'android',
      charter: 'session-account',
      result: 'observed',
      cleanup: 'cleaned',
      nativePassingCases: 0,
      captureRunId: runId,
      source: { revision: 'a'.repeat(64) },
      sourceAfter: { revision: 'a'.repeat(64) },
      helperInputsBefore: [],
      helperInputsAfter: [],
      backend: {
        runId,
        artifactRoot: '/private/backend',
        apiOrigin,
        apiProcess: { pid: apiPid, started: apiStarted, script: apiScript },
        backendAttemptId,
      },
      observations: maestro.capture.observations,
      commandExecutions: maestro.capture.commandExecutions,
      androidSessionCheckpointReceipts: checkpointSource.checkpoints,
      androidSessionCheckpointArtifacts: copied,
      androidSessionProfileCache: {
        afterLoginAuthUidHash: coachHash,
        afterRestorationAuthUidHash: coachHash,
      },
      androidSessionStorage: Object.fromEntries(
        Object.entries(storage).map(([label, value]) => [label, value.observation]),
      ),
      androidSessionAuthIdentity: {
        actor: 'coach',
        actorAuthUid: 'coach-auth',
        authRequestId: 1,
        afterRequestId: 1,
        apiPid,
        targetOrigin: apiOrigin,
        fixtureAuthUidAllowlistHash,
      },
      androidSessionRestoreTransport: restore,
      androidSessionSignedOutTransport: signedOut,
      androidSessionCancelStorage: storage['auth-after-cancel'].observation,
      androidSessionCancelIdentity: cancelIdentity,
      androidSessionDomain: {
        status: 'verified',
        sql: {
          before: storage['auth-before-relaunch'].observation.privateArtifacts,
          after: storage['auth-after-restore'].observation.privateArtifacts,
        },
      },
      androidSessionProfileCheckpoint: { status: 'verified' },
      androidSessionCharter: maestro.capture.androidSessionCharter,
      androidSessionAuthEvidence: {
        status: 'available',
        transportPath: evidenceReceipts.transportReceipt.path,
        nativeAuthIdentitiesPath: evidenceReceipts.nativeAuthIdentitiesReceipt.path,
        transportReceipt: evidenceReceipts.transportReceipt,
        nativeAuthIdentitiesReceipt: evidenceReceipts.nativeAuthIdentitiesReceipt,
      },
      androidSessionTerminalQualification: { status: 'verified', blockers: [] },
      nativeSessionContract: { status: 'verified', serverRevocationQualified: false },
    } as Record<string, unknown>;
    const cleanup = {
      result: 'passed',
      runId,
      censusStatus: 'available',
      captureResult: 'observed',
      captureCleanupClean: true,
      survivors: [],
      unknownProcessQueries: [],
      missingForeignDevices: [],
      ownedDeviceAbsent: true,
      cacheAbsent: true,
      nativePassingCases: 0,
    };
    const backend = {
      runId,
      targetOrigin: apiOrigin,
      apiPid,
      backendAttemptId,
      backend: {
        runId,
        artifactRoot: '/private/backend',
        apiOrigin,
        apiProcess: { pid: apiPid, started: apiStarted, script: apiScript },
        backendAttemptId,
      },
    };
    return {
      maestro,
      checkpointSource,
      captureRoot: maestro.root,
      capture,
      cleanup,
      backend,
      transportBytes: Buffer.from(JSON.stringify(observations)),
      transportObservations: observations,
      nativeAuthBytes: Buffer.from(JSON.stringify(nativeAuthIdentities)),
      nativeAuthIdentities,
      checkpoint,
      selection: fullSelection(),
    };
  } catch (error) {
    return cleanupSetupRoots('full session fixture', [maestroRoot, checkpointSourceRoot], error);
  }
}

void test('Android full source validator accepts a real-shaped six-purpose session with valid PNG bytes', async () => {
  const value = await fullSessionFixture();
  try {
    const result = validateAndroidSessionPublicDependencyInput(value as never);
    assert.equal(result.status, 'validated-source-only');
    assert.deepEqual(result.assertionIds, [
      'NAT-session-login',
      'NAT-session-restore',
      'NAT-session-account',
      'NAT-session-signout',
      'NAT-session-signed-out-relaunch',
      'NAT-session-unrelated-state',
    ]);
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
  } finally {
    await rm(value.maestro.root, { recursive: true, force: true });
    await rm(value.checkpointSource.root, { recursive: true, force: true });
  }
});

void test('Android full source validator rejects unknown cleanup cache absence and over-limit query-source receipts', async () => {
  const value = await fullSessionFixture();
  try {
    assert.throws(
      () => requireAndroidCleanupEvidence({ ...value.cleanup, cacheAbsent: null }, runId),
      /cache absence is unknown/,
    );
    const querySource = value.capture.androidSessionStorage as Record<
      string,
      Record<string, unknown>
    >;
    const before = querySource['auth-before-relaunch'].privateArtifacts as Record<string, unknown>;
    const receipt = before.querySource as Record<string, unknown>;
    delete receipt.kind;
    assert.throws(
      () => validateAndroidSessionPublicDependencyInput(value as never),
      /querySource kind is not query|kind is missing or unsupported|query source receipt is malformed/,
    );
    receipt.kind = 'query';
    receipt.sizeBytes = androidSessionStorageLimits.queryBytes + 1;
    assert.throws(
      () => validateAndroidSessionPublicDependencyInput(value as never),
      /exceeds its kind cap|byte count changed|hash changed|query source receipt is malformed/,
    );
  } finally {
    await rm(value.maestro.root, { recursive: true, force: true });
    await rm(value.checkpointSource.root, { recursive: true, force: true });
  }
});

void test('Android receipt reader rejects actual oversized bytes before trusting a forged small receipt', async () => {
  const value = await fullSessionFixture();
  try {
    const storage = value.capture.androidSessionStorage as Record<string, Record<string, unknown>>;
    const before = storage['auth-before-relaunch'].privateArtifacts as Record<string, unknown>;
    const receipt = before.querySource as Record<string, unknown>;
    const file = path.join(value.maestro.root, String(receipt.path));
    await writeFile(file, Buffer.alloc(androidSessionStorageLimits.queryBytes + 1, 0x61), {
      mode: 0o600,
    });
    receipt.sizeBytes = 1;
    assert.throws(
      () => validateAndroidSessionPublicDependencyInput(value as never),
      /actual kind cap|exceeds its bounded size/,
    );
  } finally {
    await rm(value.maestro.root, { recursive: true, force: true });
    await rm(value.checkpointSource.root, { recursive: true, force: true });
  }
});

void test('Android receipt reader rejects a hardlink alias and storage role/path substitutions', async () => {
  const value = await fullSessionFixture();
  try {
    const storage = value.capture.androidSessionStorage as Record<string, Record<string, unknown>>;
    const before = storage['auth-before-relaunch'].privateArtifacts as Record<string, unknown>;
    const sourceReceipt = before.querySource as Record<string, unknown>;
    const source = path.join(value.maestro.root, String(sourceReceipt.path));
    const alias = path.join(value.maestro.root, 'foreign-async-storage-query.raw.private');
    await link(source, alias);
    sourceReceipt.path = path.basename(alias);
    assert.throws(
      () => validateAndroidSessionPublicDependencyInput(value as never),
      /single-link regular file|must have one link/,
    );
    await unlink(alias);

    sourceReceipt.path = path.relative(value.maestro.root, source);
    const query = before.query as Record<string, unknown>;
    query.kind = 'transport';
    assert.throws(
      () => validateAndroidSessionPublicDependencyInput(value as never),
      /SQL file receipt is malformed/,
    );
    query.kind = 'query';
    query.path = String((before.database as Record<string, unknown>).path);
    assert.throws(
      () => validateAndroidSessionPublicDependencyInput(value as never),
      /SQL file receipt is not bound/,
    );
  } finally {
    await rm(value.maestro.root, { recursive: true, force: true });
    await rm(value.checkpointSource.root, { recursive: true, force: true });
  }
});

void test('Android descriptor reader rejects a path renamed after open before returning bytes', async () => {
  const root = await mkdtempForTest('android-session-v7-race-');
  await chmod(root, 0o700);
  const file = path.join(root, 'rename-during-read.private.json');
  const moved = path.join(root, 'rename-during-read.moved.private.json');
  try {
    await writeFile(file, Buffer.from('{"owned":true}'), { mode: 0o600 });
    await assert.rejects(
      readOwnedAndroidStableFileForTest(
        {
          artifactRoot: root,
          filePath: file,
          kind: 'transport',
          maxBytes: 1 * 1024 * 1024,
        },
        async () => rename(file, moved),
      ),
      /changed|canonical|ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android charter rejects a tampered original command log hash', async () => {
  const value = await fullSessionFixture();
  try {
    const firstCommand = (value.capture.commandExecutions as Record<string, unknown>[])[0];
    const logPath = String(firstCommand.logPath);
    const original = await readFile(logPath);
    await writeFile(logPath, Buffer.concat([original, Buffer.from('\ncommand-log-tamper')]), {
      mode: 0o600,
    });
    assert.throws(
      () => validateAndroidSessionPublicDependencyInput(value as never),
      /source receipt|charter assertion/,
    );
  } finally {
    await rm(value.maestro.root, { recursive: true, force: true });
    await rm(value.checkpointSource.root, { recursive: true, force: true });
  }
});

void test('Android v7 shared readers reject growth, mode changes, and undeclared oversize', async () => {
  const root = await realpath(await mkdtempForTest('android-session-v7-bounds-'));
  await chmod(root, 0o700);
  const frame = path.join(root, 'frame.png');
  try {
    await writeFile(frame, Buffer.from('tiny'), { mode: 0o600 });
    assert.throws(
      () =>
        readOwnedCaptureFileForTest(
          root,
          'frame.png',
          'growing frame',
          'png',
          () => undefined,
          () => appendFileSync(frame, Buffer.alloc(128, 0x61)),
        ),
      /changed while reading|byte count changed|path identity changed/,
    );

    await writeFile(frame, Buffer.from('tiny'), { mode: 0o600 });
    await chmod(frame, 0o640);
    assert.throws(
      () =>
        readOwnedArtifactBytesForTest(
          root,
          'frame.png',
          'wrong mode artifact',
          1024,
          () => undefined,
          () => undefined,
        ),
      /mode is not private/,
    );

    await chmod(frame, 0o600);
    await writeFile(frame, Buffer.alloc(1025, 0x62), { mode: 0o600 });
    await assert.rejects(
      readOwnedAndroidStableFileForTest(
        {
          artifactRoot: root,
          filePath: frame,
          kind: 'transport',
          maxBytes: 1024,
        },
        () => undefined,
      ),
      /bounded size/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android v7 command reader rejects inode replacement after descriptor open', async () => {
  const root = await realpath(await mkdtempForTest('android-session-v7-command-race-'));
  await chmod(root, 0o700);
  const command = path.join(root, 'command.private.log');
  const moved = path.join(root, 'command.moved.private.log');
  try {
    await writeFile(command, Buffer.from('owned command\n'), { mode: 0o600 });
    assert.throws(
      () =>
        readOwnedArtifactBytesForTest(
          root,
          'command.private.log',
          'command log',
          1024,
          () => undefined,
          () => renameSync(command, moved),
        ),
      /changed while reading|path identity changed|canonical|ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android producer, v7 consumer, stager and verifier share one real-shaped source path', async () => {
  const value = await fullSessionFixture();
  const requestedRunId = 'fedcba987654321001234567';
  const originalRoot = value.maestro.root;
  let runParent: string | null = null;
  let captureRoot: string | null = null;
  let outputRoot: string | null = null;
  try {
    runParent = await realpath(await mkdtempForTest('android-session-v7-owned-run-'));
    await chmod(runParent, 0o700);
    captureRoot = path.join(runParent, runId);
    outputRoot = path.join(runParent, requestedRunId);
    assert(captureRoot && outputRoot);
    await rename(originalRoot, captureRoot);
    value.maestro.root = captureRoot;
    const nestedCheckpointRoot = path.join(
      captureRoot,
      'android-session-checkpoints',
      'android-session-checkpoints',
    );
    for (const phase of phases)
      await rename(
        path.join(nestedCheckpointRoot, phase),
        path.join(captureRoot, 'android-session-checkpoints', phase),
      );
    await rm(path.join(captureRoot, 'android-session-checkpoints', 'android-session-checkpoints'), {
      recursive: true,
      force: true,
    });
    for (const raw of value.capture.commandExecutions as Record<string, unknown>[]) {
      for (const key of ['logPath', 'ownershipPath', 'stdoutPath']) {
        if (typeof raw[key] === 'string' && raw[key].startsWith(`${originalRoot}/`))
          raw[key] = `${captureRoot}/${raw[key].slice(originalRoot.length + 1)}`;
      }
    }
    const frameReceipts: Record<string, unknown> = {};
    for (const observation of value.capture.observations as Record<string, unknown>[]) {
      for (const [key, contentKind] of [
        ['hierarchyPath', 'hierarchy-json'],
        ['screenshotPath', 'png'],
      ] as const) {
        const relative = String(observation[key]);
        const frame = await readOwnedAndroidStableFile({
          artifactRoot: captureRoot,
          filePath: path.join(captureRoot, relative),
          kind: 'frame',
          maxBytes: 16 * 1024 * 1024,
        });
        frameReceipts[relative] = { ...frame.receipt, contentKind };
      }
      const observationLabel = String(
        path.basename(String(observation.hierarchyPath)).replace('-hierarchy.json', ''),
      );
      const hierarchySource = await readOwnedAndroidStableFile({
        artifactRoot: captureRoot,
        filePath: path.join(captureRoot, `${observationLabel}-hierarchy.stdout`),
        kind: 'frame',
        maxBytes: 16 * 1024 * 1024,
      });
      frameReceipts[`${observationLabel}-hierarchy.stdout`] = {
        ...hierarchySource.receipt,
        contentKind: 'hierarchy-source',
      };
    }
    value.capture.androidSessionFrameReceipts = frameReceipts;
    const captureBytes = Buffer.from(JSON.stringify(value.capture, null, 2) + '\n');
    const cleanupBytes = Buffer.from(JSON.stringify(value.cleanup, null, 2) + '\n');
    await writeFile(path.join(captureRoot, 'capture.private.json'), captureBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(path.join(captureRoot, 'external-cleanup.private.json'), cleanupBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    const captureFile = await readOwnedAndroidStableFile({
      artifactRoot: captureRoot,
      filePath: path.join(captureRoot, 'capture.private.json'),
      kind: 'sidecar',
      maxBytes: 32 * 1024 * 1024,
    });
    const cleanupFile = await readOwnedAndroidStableFile({
      artifactRoot: captureRoot,
      filePath: path.join(captureRoot, 'external-cleanup.private.json'),
      kind: 'sidecar',
      maxBytes: 32 * 1024 * 1024,
    });
    assert.equal(captureFile.bytes.toString('utf8'), captureBytes.toString('utf8'));
    assert.equal(cleanupFile.bytes.toString('utf8'), cleanupBytes.toString('utf8'));

    const dependency = validateAndroidSessionPublicDependencyInput({
      ...value,
      captureRoot,
      capture: value.capture,
      cleanup: value.cleanup,
    } as never);
    const requiredPaths = requiredAndroidSessionBundlePaths(dependency);
    assert.equal(requiredPaths.length, new Set(requiredPaths).size);
    assert.equal(requiredPaths.includes('capture.private.json'), true);
    assert.equal(requiredPaths.includes('external-cleanup.private.json'), true);
    const producerReceipts = collectAndroidSessionProducerReceipts(value.capture, [
      value.cleanup,
      captureFile.receipt,
      cleanupFile.receipt,
    ]);
    await mkdir(outputRoot, { mode: 0o700 });
    const staged = await stageAndroidSessionPublicDependency({
      dependency,
      captureRoot,
      outputRoot,
      requestedRunId,
      selection: value.selection as unknown as NativePilotSelection,
      producerReceipts,
    });
    await verifyStagedAndroidSessionDependency({
      outputRoot,
      copyManifest: staged.copyManifest,
      requestedRunId,
      captureRunId: runId,
      captureRoot,
      dependency,
      selection: value.selection as unknown as NativePilotSelection,
      producerReceipts,
    });
    assert.equal(dependency.nativePassingCases, 0);
    assert.equal(dependency.publicPromotionEligible, false);
    assert.equal(staged.publicPassingCases, 0);
    assert.equal(staged.publicPromotionEligible, false);
  } finally {
    // The parent is the only disposable namespace this test owns. The original
    // fixture roots are also unique and are removed when a rename fails before
    // the parent can contain them.
    if (runParent) await rm(runParent, { recursive: true, force: true });
    await rm(originalRoot, { recursive: true, force: true });
    await rm(value.checkpointSource.root, { recursive: true, force: true });
  }
});

const realShapedChildTestName =
  'Android producer, v7 consumer, stager and verifier share one real-shaped source path';
const childDefaultDeadlineMs = 10_000;
const childKillGraceMs = 250;
const childTempRootPrefix = 'android-session-child-';

type ChildTempCleanup = {
  status: 'cleaned' | 'failed';
  error: string | null;
};

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function cleanupChildTempRoot(root: string): Promise<ChildTempCleanup> {
  let cleanupError: string | null = null;
  try {
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    cleanupError = `child temp namespace removal failed: ${describeError(error)}`;
  }
  try {
    await stat(root);
    cleanupError ??= `child temp namespace remained after cleanup: ${root}`;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT')
      cleanupError ??= `child temp namespace recheck failed: ${describeError(error)}`;
  }
  return cleanupError === null
    ? { status: 'cleaned', error: null }
    : { status: 'failed', error: cleanupError };
}

type RealShapedChildOptions = {
  args?: readonly string[];
  cleanupRoot?: (root: string) => Promise<ChildTempCleanup>;
  deadlineMs?: number;
  signal?: AbortSignal;
};

type RealShapedChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  tests: number | null;
  passed: number | null;
  testNames: string[];
  terminationReason: 'deadline' | 'aborted' | null;
  spawnError: string | null;
  reaped: boolean;
  timedOut: boolean;
  aborted: boolean;
  cleanupStatus: 'not-run' | 'cleaned' | 'failed';
  cleanupError: string | null;
  childTempRoot: string | null;
  spawned: boolean;
  positive: boolean;
};

async function runRealShapedChild(
  testFile: string,
  options: RealShapedChildOptions = {},
): Promise<RealShapedChildResult> {
  if (options.signal?.aborted)
    return {
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      tests: null,
      passed: null,
      testNames: [],
      terminationReason: 'aborted',
      spawnError: null,
      reaped: false,
      timedOut: false,
      aborted: true,
      cleanupStatus: 'not-run',
      cleanupError: null,
      childTempRoot: null,
      spawned: false,
      positive: false,
    };

  let childTempRoot: string;
  try {
    childTempRoot = await mkdtemp(path.join(os.tmpdir(), childTempRootPrefix));
  } catch (error) {
    return {
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      tests: null,
      passed: null,
      testNames: [],
      terminationReason: null,
      spawnError: `child temp namespace creation failed: ${describeError(error)}`,
      reaped: false,
      timedOut: false,
      aborted: false,
      cleanupStatus: 'not-run',
      cleanupError: null,
      childTempRoot: null,
      spawned: false,
      positive: false,
    };
  }

  if (options.signal?.aborted) {
    const cleanup = await cleanupChildTempRoot(childTempRoot);
    return {
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      tests: null,
      passed: null,
      testNames: [],
      terminationReason: 'aborted',
      spawnError: null,
      reaped: false,
      timedOut: false,
      aborted: true,
      cleanupStatus: cleanup.status,
      cleanupError: cleanup.error,
      childTempRoot,
      spawned: false,
      positive: false,
    };
  }

  const args = options.args
    ? [...options.args]
    : ['--test', `--test-name-pattern=${realShapedChildTestName}`, testFile];
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    [childTempRootEnvironmentKey]: childTempRoot,
  };
  delete childEnvironment.NODE_TEST_CONTEXT;
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', ...args], {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const cleanup = await cleanupChildTempRoot(childTempRoot);
    return {
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      tests: null,
      passed: null,
      testNames: [],
      terminationReason: 'aborted',
      spawnError: describeError(error),
      reaped: false,
      timedOut: false,
      aborted: true,
      cleanupStatus: cleanup.status,
      cleanupError: cleanup.error,
      childTempRoot,
      spawned: false,
      positive: false,
    };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let terminationReason: 'deadline' | 'aborted' | null = null;
    let spawnError: string | null = null;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const onAbort = () => {
      requestTermination('aborted');
    };
    const requestTermination = (reason: 'deadline' | 'aborted') => {
      if (terminationReason) return;
      terminationReason = reason;
      try {
        child.kill('SIGTERM');
      } catch (error) {
        spawnError ??= String(error);
      }
      killTimer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        try {
          child.kill('SIGKILL');
        } catch (error) {
          spawnError ??= String(error);
        }
      }, childKillGraceMs);
    };
    const finalize = async (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      let cleanup: ChildTempCleanup;
      try {
        cleanup = await (options.cleanupRoot ?? cleanupChildTempRoot)(childTempRoot);
      } catch (error) {
        cleanup = { status: 'failed', error: describeError(error) };
      }
      const testsMatch = stdout.match(/^ℹ tests (\d+)$/m);
      const passedMatch = stdout.match(/^ℹ pass (\d+)$/m);
      const testNames = [...stdout.matchAll(/^✔ (.+?) \(/gm)].map((match) => match[1]);
      const tests = testsMatch ? Number(testsMatch[1]) : null;
      const passed = passedMatch ? Number(passedMatch[1]) : null;
      const positive =
        code === 0 &&
        signal === null &&
        terminationReason === null &&
        spawnError === null &&
        tests === 1 &&
        passed === 1 &&
        testNames.length === 1 &&
        testNames[0] === realShapedChildTestName &&
        cleanup.status === 'cleaned';
      resolve({
        code,
        signal,
        stdout,
        stderr,
        tests,
        passed,
        testNames,
        terminationReason,
        spawnError,
        reaped: true,
        timedOut: terminationReason === 'deadline',
        aborted: terminationReason === 'aborted',
        cleanupStatus: cleanup.status,
        cleanupError: cleanup.error,
        childTempRoot,
        spawned: true,
        positive,
      });
    };
    child.stdout!.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr!.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      spawnError = String(error);
      if (!terminationReason) requestTermination('aborted');
    });
    child.once('close', (code, signal) => {
      void finalize(code, signal);
    });
    const deadlineMs = options.deadlineMs ?? childDefaultDeadlineMs;
    const deadlineTimer = setTimeout(() => requestTermination('deadline'), deadlineMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}

void test('Android real-shaped source path isolates two concurrent child runs', async () => {
  const testFile = path.resolve(
    process.cwd(),
    'tests/ci/native-android-session-public-dependency.test.ts',
  );
  const results = await Promise.all([runRealShapedChild(testFile), runRealShapedChild(testFile)]);
  for (const result of results) {
    assert.equal(
      result.code,
      0,
      `concurrent child failed (signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.equal(result.tests, 1, `child selected an unexpected test count: ${result.stdout}`);
    assert.equal(result.passed, 1, `child did not report one passing test: ${result.stdout}`);
    assert.deepEqual(result.testNames, [realShapedChildTestName]);
    assert.equal(result.reaped, true);
    assert.equal(result.terminationReason, null);
    assert.equal(result.cleanupStatus, 'cleaned');
    assert.equal(result.cleanupError, null);
    assert.equal(result.positive, true);
    assert.ok(result.childTempRoot);
    await assert.rejects(stat(result.childTempRoot), /ENOENT/);
  }
});

void test('Android fixture constructors remove owned roots after injected setup failures', async () => {
  let fixtureRoot: string | null = null;
  await assert.rejects(
    fixture({
      onRootCreated: (root) => {
        fixtureRoot = root;
        throw new Error('intentional checkpoint fixture setup failure');
      },
    }),
    /intentional checkpoint fixture setup failure/,
  );
  assert.ok(fixtureRoot);
  await assert.rejects(stat(fixtureRoot), /ENOENT/);

  let maestroRoot: string | null = null;
  await assert.rejects(
    maestroFixture({
      onRootCreated: (root) => {
        maestroRoot = root;
        throw new Error('intentional Maestro fixture setup failure');
      },
    }),
    /intentional Maestro fixture setup failure/,
  );
  assert.ok(maestroRoot);
  await assert.rejects(stat(maestroRoot), /ENOENT/);

  let fullMaestroRoot: string | null = null;
  let fullCheckpointRoot: string | null = null;
  await assert.rejects(
    fullSessionFixture({
      maestro: {
        onRootCreated: (root) => {
          fullMaestroRoot = root;
        },
      },
      checkpoint: {
        onRootCreated: (root) => {
          fullCheckpointRoot = root;
          throw new Error('intentional full-session checkpoint setup failure');
        },
      },
    }),
    /intentional full-session checkpoint setup failure/,
  );
  assert.ok(fullMaestroRoot);
  assert.ok(fullCheckpointRoot);
  await assert.rejects(stat(fullMaestroRoot), /ENOENT/);
  await assert.rejects(stat(fullCheckpointRoot), /ENOENT/);
});

const hungChildScript = `
const { mkdtemp, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const root = process.env.${childTempRootEnvironmentKey};
if (!root) throw new Error('missing assigned child temp root');
(async () => {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const fixtureRoot = await mkdtemp(path.join(root, 'hung-fixture-'));
  await writeFile(path.join(fixtureRoot, 'owned.private.json'), 'owned\\n', { mode: 0o600 });
  process.stdout.write('hung-child-stdout:' + fixtureRoot + '\\n');
  process.stderr.write('hung-child-stderr:' + fixtureRoot + '\\n');
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 60_000);
})().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});
`;

void test('Android pre-aborted child does not spawn or acquire a temp namespace', async () => {
  const testFile = path.resolve(
    process.cwd(),
    'tests/ci/native-android-session-public-dependency.test.ts',
  );
  const controller = new AbortController();
  controller.abort(new Error('intentional pre-abort'));
  const result = await runRealShapedChild(testFile, { signal: controller.signal });
  assert.equal(result.spawned, false);
  assert.equal(result.childTempRoot, null);
  assert.equal(result.cleanupStatus, 'not-run');
  assert.equal(result.cleanupError, null);
  assert.equal(result.terminationReason, 'aborted');
  assert.equal(result.aborted, true);
  assert.equal(result.positive, false);
});

void test('Android child cleanup failure remains diagnostic and cannot be positive', async () => {
  const testFile = path.resolve(
    process.cwd(),
    'tests/ci/native-android-session-public-dependency.test.ts',
  );
  const result = await runRealShapedChild(testFile, {
    cleanupRoot: () => Promise.resolve({ status: 'failed', error: 'injected cleanup failure' }),
  });
  try {
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.cleanupStatus, 'failed');
    assert.equal(result.cleanupError, 'injected cleanup failure');
    assert.equal(result.positive, false);
    assert.ok(result.childTempRoot);
    await assert.doesNotReject(stat(result.childTempRoot));
  } finally {
    if (result.childTempRoot) {
      await rm(result.childTempRoot, { recursive: true, force: true });
      await assert.rejects(stat(result.childTempRoot), /ENOENT/);
    }
  }
});

void test('Android child deadline terminates and reaps a hung owned child with diagnostics', async () => {
  const testFile = path.resolve(
    process.cwd(),
    'tests/ci/native-android-session-public-dependency.test.ts',
  );
  const result = await runRealShapedChild(testFile, {
    args: ['-e', hungChildScript],
    deadlineMs: 1_500,
  });
  assert.equal(result.code, null);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.terminationReason, 'deadline');
  assert.equal(result.timedOut, true);
  assert.equal(result.aborted, false);
  assert.equal(result.reaped, true);
  assert.equal(result.cleanupStatus, 'cleaned');
  assert.equal(result.cleanupError, null);
  assert.equal(result.positive, false);
  assert.match(result.stdout, /hung-child-stdout:.*hung-fixture-/);
  assert.match(result.stderr, /hung-child-stderr:.*hung-fixture-/);
  assert.ok(result.childTempRoot);
  await assert.rejects(stat(result.childTempRoot), /ENOENT/);
});

void test('Android child abort terminates and reaps a hung owned child with diagnostics', async () => {
  const testFile = path.resolve(
    process.cwd(),
    'tests/ci/native-android-session-public-dependency.test.ts',
  );
  const controller = new AbortController();
  const childPromise = runRealShapedChild(testFile, {
    args: ['-e', hungChildScript],
    deadlineMs: 10_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(new Error('intentional child cancellation')), 500);
  const result = await childPromise;
  assert.equal(result.code, null);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.terminationReason, 'aborted');
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, true);
  assert.equal(result.reaped, true);
  assert.equal(result.cleanupStatus, 'cleaned');
  assert.equal(result.cleanupError, null);
  assert.equal(result.positive, false);
  assert.match(result.stdout, /hung-child-stdout:.*hung-fixture-/);
  assert.match(result.stderr, /hung-child-stderr:.*hung-fixture-/);
  assert.ok(result.childTempRoot);
  await assert.rejects(stat(result.childTempRoot), /ENOENT/);
});

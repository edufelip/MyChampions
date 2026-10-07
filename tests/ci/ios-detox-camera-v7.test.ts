import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { readOwnedDetoxConnectionEvidence } from '../../scripts/testing/detox-connection-evidence';
import { writeOwnedExclusive } from '../../scripts/testing/native-detox-camera-ios-evidence';
import {
  requireDetoxCameraRuntimeFacts,
  requireDetoxCameraTerminalCleanup,
} from '../../scripts/testing/native-detox-camera-ios-verifier';
import {
  requireCameraSelection,
  type CameraDispatchOptions,
} from '../../scripts/testing/run-ios-detox-camera-attempt';
import type { DetoxCameraCleanup } from '../../scripts/testing/native-detox-camera-ios-contract';
import type { DetoxCameraRuntimeFacts } from '../../scripts/testing/native-detox-camera-ios-owner';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const PAYLOAD = Buffer.from('{"kind":"detox-camera-v7-control"}\n');

function completedRuntimeFacts(): DetoxCameraRuntimeFacts {
  return {
    childExitCode: 0,
    childSignal: null,
    childClassification: 'completed',
    flagsHash: 'a'.repeat(64),
    timingsMs: {
      build: 1,
      install: 1,
      reset: 1,
      scenario: 1,
      verify: 1,
      cleanup: 1,
    },
  };
}

function completedCleanup(): DetoxCameraCleanup {
  return {
    captureCleanup: 'cleaned',
    independentCleanup: 'cleaned',
    ownedProcessPairs: [],
    foreignResourcesPreserved: true,
    terminal: 'complete',
    error: null,
  };
}

const CAMERA_SELECTION: NativePilotSelection = {
  arguments: {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-camera-denied-ios',
    mode: 'integration',
  },
  scenarioHash: 'a'.repeat(64),
  requirementHash: 'b'.repeat(64),
  scenario: {
    id: 'SCN-camera-denied-ios',
    platform: 'ios',
    flowId: 'FLW-camera-denied',
    transitionIds: [],
    requirementRefs: [],
    dataMode: 'postgres',
    fixtureRef: 'fixture',
    freshnessInputs: { requirementPaths: [] },
  },
};

function cameraDispatch(deadlineAtMonotonicMs: number): CameraDispatchOptions {
  const requestedRunId = 'c'.repeat(24);
  return {
    repositoryRoot: '/owned/repository',
    serverRoot: '/owned/server',
    artifactRoot: '/owned/artifacts/' + requestedRunId,
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    selection: CAMERA_SELECTION,
    signal: new AbortController().signal,
    deadlineAtMonotonicMs,
    buildRunId: 'd'.repeat(24),
  };
}

async function privateDirectory(parent: string, name: string): Promise<string> {
  const value = join(parent, name);
  await mkdir(value, { mode: 0o700 });
  await chmod(value, 0o700);
  return value;
}

void test('camera dispatch accepts the fractional default absolute deadline', () => {
  const runStarted = Math.trunc(performance.now()) + 0.25;
  const fractionalFuture = runStarted + 60_000;
  assert.notEqual(Number.isSafeInteger(fractionalFuture), true);
  assert.doesNotThrow(() => requireCameraSelection(cameraDispatch(fractionalFuture)));

  assert.throws(() => requireCameraSelection(cameraDispatch(performance.now() - 0.5)), /future/i);
  assert.throws(() => requireCameraSelection(cameraDispatch(Number.NaN)), /finite|future/i);
});

void test('outer verification requires real positive phase timings including build', () => {
  const facts = completedRuntimeFacts();
  assert.doesNotThrow(() => requireDetoxCameraRuntimeFacts(facts));
  assert.throws(
    () =>
      requireDetoxCameraRuntimeFacts({
        ...facts,
        timingsMs: { ...facts.timingsMs, build: 0 },
      }),
    /build timing/i,
  );
});

void test('outer verification rejects forged or mismatched terminal cleanup', () => {
  const clean = completedCleanup();
  assert.doesNotThrow(() => requireDetoxCameraTerminalCleanup(clean, clean));
  assert.throws(
    () => requireDetoxCameraTerminalCleanup({ ...clean, terminal: 'blocked' }, clean),
    /cleanup/i,
  );
  assert.throws(
    () =>
      requireDetoxCameraTerminalCleanup(clean, {
        ...clean,
        foreignResourcesPreserved: false,
      }),
    /does not equal/i,
  );
});

void test('current-Q camera composition binds producer, protected stage and outer terminal', async () => {
  const source = (relative: string): Promise<string> =>
    readFile(join(process.cwd(), relative), 'utf8');
  const [owner, route, outer, verifier, runner, stage, evidence, currentOwner] = await Promise.all([
    source('scripts/testing/native-detox-camera-ios-current-owner.ts'),
    source('scripts/testing/native-detox-camera-ios-owner.ts'),
    source('scripts/testing/run-native-pilot.ts'),
    source('scripts/testing/native-detox-camera-ios-verifier.ts'),
    source('scripts/testing/run-ios-detox-camera-attempt.ts'),
    source('scripts/testing/native-detox-camera-ios-stage.ts'),
    source('scripts/testing/native-detox-camera-ios-evidence.ts'),
    source('scripts/testing/native-detox-camera-ios-current-owner.ts'),
  ]);
  assert.match(owner, /ownedDetoxBaselineFactories/);
  assert.match(owner, /startOwnedNativeCommand/);
  assert.match(owner, /session!?\.fixtures\(['"]native-entry-ios['"]\)/);
  assert.match(owner, /session!?\.probeApiLifetime\(options\.signal\)/);
  assert.match(owner, /build: options\.buildElapsedMs/);
  assert.match(runner, /buildElapsedMs,/);
  assert.match(runner, /deadlineAtMonotonicMs: input\.deadlineAtMonotonicMs/);
  assert.match(route, /runDetoxIosCameraProducer/);
  assert.match(route, /stageDetoxIosCameraPrivateEvidence/);
  assert.match(route, /writeDetoxIosCameraTerminal/);
  assert.match(route, /lifecycle/);
  assert.match(outer, /IOS_DETOX_CAMERA_PUBLIC_DISPATCH/);
  assert.match(outer, /verifyDetoxIosCameraPrivateEvidence/);
  assert.match(outer, /cameraVerification\.assertionBindings\.map/);
  assert.match(outer, /detox-camera-staging-link\.private\.json/);
  assert.doesNotMatch(outer, /iosDetoxCameraSourceOnly = true;\s*\/\/ unconditional/);
  assert.match(verifier, /O_NOFOLLOW/);
  assert.match(verifier, /requireDetoxCameraRuntimeFacts/);
  assert.match(verifier, /requireDetoxCameraEvidenceLive/);
  assert.match(verifier, /lifecycle: DetoxCameraEvidenceLifecycle/);
  assert.match(stage, /requireDetoxCameraEvidenceLive/);
  assert.match(stage, /lifecycle: DetoxCameraEvidenceLifecycle/);
  assert.match(evidence, /ensureDetoxConnectionArtifactRoot\(resolvedRoot, lifecycle\)/);
  assert.match(evidence, /deadlineAtMonotonicMs/);
  assert.match(currentOwner, /deadlineAtMonotonicMs/);
  assert.match(currentOwner, /deadlineAt: options\.deadlineAt/);
  for (const assertionId of [
    'NAT-camera-normal-entry',
    'NAT-camera-denial-guidance',
    'NAT-camera-manual-submit',
    'NAT-camera-unrelated-state',
  ]) {
    assert.match(outer, new RegExp(assertionId));
  }
});

void test('ancestor replacement after root open is rejected without foreign proof', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-v7-race-')));
  const root = await privateDirectory(parent, 'owned');
  const original = join(parent, 'owned-original');
  const foreign = await privateDirectory(parent, 'foreign');
  const controller = new AbortController();
  let swapped = false;
  try {
    await assert.rejects(
      writeOwnedExclusive(root, 'race.private.json', PAYLOAD, {
        signal: controller.signal,
        deadlineAtMonotonicMs: performance.now() + 5_000,
        afterDirectoryOpen: async () => {
          await rename(root, original);
          await symlink(foreign, root);
          swapped = true;
        },
      }),
      /root identity|canonical|publication failed|changed|owned 0700/i,
    );
    assert.equal(swapped, true, 'the race must occur after descriptor open');
    await assert.rejects(lstat(join(foreign, 'race.private.json')), {
      code: 'ENOENT',
    });
    await assert.rejects(lstat(join(original, 'race.private.json')), {
      code: 'ENOENT',
    });
  } finally {
    await unlink(root).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});

void test('clean owned root publishes one private proof with exact bytes and mode', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-v7-clean-')));
  const root = await privateDirectory(parent, 'owned');
  try {
    const written = await writeOwnedExclusive(root, 'clean.private.json', PAYLOAD, {
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 5_000,
    });
    assert.equal(written.bytes, PAYLOAD.length);
    assert.equal(written.mode, 0o600);
    const read = await readOwnedDetoxConnectionEvidence(
      root,
      'clean.private.json',
      8 * 1024 * 1024,
      { deadlineAt: performance.now() + 5_000 },
    );
    assert.deepEqual(read.bytes, PAYLOAD);
    assert.equal(read.metadata.mode & 0o777, 0o600);
    assert.equal(read.metadata.nlink, 1);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('protected evidence rejects pre-abort, expiry and abort at publication', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-v10-lifecycle-')));
  const preAbortedRoot = await privateDirectory(parent, 'pre-aborted');
  const expiredRoot = await privateDirectory(parent, 'expired');
  const publicationRoot = await privateDirectory(parent, 'publication-abort');
  try {
    const preAborted = new AbortController();
    preAborted.abort(new Error('pre-aborted lifecycle control'));
    await assert.rejects(
      writeOwnedExclusive(preAbortedRoot, 'pre-aborted.private.json', PAYLOAD, {
        signal: preAborted.signal,
        deadlineAtMonotonicMs: performance.now() + 5_000,
      }),
      /abort|cancel/i,
    );
    assert.deepEqual(await readdir(preAbortedRoot), []);

    await assert.rejects(
      writeOwnedExclusive(expiredRoot, 'expired.private.json', PAYLOAD, {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() - 1,
      }),
      /deadline/i,
    );
    assert.deepEqual(await readdir(expiredRoot), []);

    const publicationAbort = new AbortController();
    await assert.rejects(
      writeOwnedExclusive(publicationRoot, 'publication-abort.private.json', PAYLOAD, {
        signal: publicationAbort.signal,
        deadlineAtMonotonicMs: performance.now() + 5_000,
        beforePublish: () => publicationAbort.abort(new Error('abort at publication fence')),
      }),
      /abort|cancel|publication|deadline/i,
    );
    assert.equal(publicationAbort.signal.aborted, true);
    await assert.rejects(lstat(join(publicationRoot, 'publication-abort.private.json')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

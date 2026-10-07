import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ownershipProcesses,
  parseProcesses,
  processSurvivors,
} from '../../scripts/testing/native-cleanup-evidence';
import {
  evaluateOwnedAndroidCleanup,
  requireAndroidCaptureCleanupStatus,
  requireAndroidCleanupAcquisition,
  verifyOwnedAndroidCleanup,
} from '../../scripts/testing/verify-owned-android-cleanup';

const resources = ['adb', 'emulator', 'backend', 'proxy', 'expo'] as const;
const base = () => ({
  runId: 'a'.repeat(24),
  captureResult: 'observed',
  captureCleanupClean: true,
  acquisitions: [...resources],
  ownedProcesses: [
    { pid: 810, started: 'Tue Sep 29 13:00:00 2026' },
    { pid: 811, started: 'Tue Sep 29 13:00:01 2026' },
  ],
  liveProcesses: [{ pid: 810, started: 'Tue Sep 29 15:00:00 2026' }],
  previousDevices: { devices: { ios: [{ udid: 'foreign', state: 'Shutdown' }] } },
  recordedDevices: { devices: { ios: [{ udid: 'foreign', state: 'Shutdown' }] } },
  currentDevices: { devices: { ios: [{ udid: 'foreign', state: 'Shutdown' }] } },
  directoriesAbsent: true,
  cacheAbsent: true,
  defaultAdbPreserved: true,
  foreignAvdsPreserved: true,
  unavailablePorts: [] as number[],
  docker: { container: [] as string[], network: [] as string[], volume: [] as string[] },
});

void test('cleanup includes diagnostic-only pairs, escaped/rejected censuses and reused PID starts without granting ownership', () => {
  const acquired = { pid: 810, started: 'Tue Sep 29 13:00:00 2026' };
  const diagnostic = { pid: 811, started: 'Tue Sep 29 13:00:01 2026' };
  const reused = { ...diagnostic, started: 'Tue Sep 29 13:00:02 2026' };
  const rejected = { pid: 812, started: 'Tue Sep 29 13:00:03 2026' };
  const escaped = { pid: 813, started: 'Tue Sep 29 13:00:04 2026' };
  const ledger = {
    processes: [acquired],
    escapedProcesses: [escaped],
    latestCensus: { groupMembers: [acquired], escapedCandidates: [escaped] },
    rejectedCensus: { census: { groupMembers: [rejected], escapedCandidates: [] } },
    commandCensusRequeries: [
      {
        observedAt: '2026-09-30T13:07:04.670Z',
        result: 'available',
        unavailable: [diagnostic],
        current: [acquired, reused],
      },
    ],
  };
  const bytes = JSON.stringify(ledger);
  const pairs = ownershipProcesses(ledger);
  assert.equal(pairs.length, 5);
  assert.deepEqual(processSurvivors(pairs, [diagnostic]), { pidStartPairs: 5, survivors: [811] });
  assert.equal(
    evaluateOwnedAndroidCleanup({ ...base(), ownedProcesses: pairs, liveProcesses: [diagnostic] })
      .result,
    'failed',
  );
  assert.deepEqual(processSurvivors(pairs, [reused]).survivors, [811]);
  assert.deepEqual(
    processSurvivors(pairs, [{ ...diagnostic, started: 'Tue Sep 29 15:00:00 2026' }]).survivors,
    [],
  );
  assert.equal(JSON.stringify(ledger), bytes);
  assert.deepEqual(ownershipProcesses({ processes: [acquired, acquired] }), [acquired]);
  for (const patch of [
    { commandCensusRequeries: null },
    { commandCensusRequeries: [{}] },
    { commandCensusRequeries: [{ ...ledger.commandCensusRequeries[0], result: 'cleaned' }] },
    {
      commandCensusRequeries: [
        { ...ledger.commandCensusRequeries[0], unavailable: [{ ...diagnostic, pid: NaN }] },
      ],
    },
    {
      commandCensusRequeries: [
        { ...ledger.commandCensusRequeries[0], current: [{ ...reused, started: 'unknown' }] },
      ],
    },
    { latestCensus: { groupMembers: [] } },
    { rejectedCensus: { census: null } },
  ])
    assert.throws(() => ownershipProcesses({ ...ledger, ...patch }));
});

void test('Android external cleanup rejects original failure, retained resources, changed foreign state and PID/start survivors', () => {
  const input = base(),
    clean = evaluateOwnedAndroidCleanup(input);
  assert.equal(clean.result, 'passed');
  assert.equal(clean.pidStartPairs, 2);
  assert.equal(clean.nativePassingCases, 0);
  for (const captureResult of ['cancelled', 'harness-blocked']) {
    const result = evaluateOwnedAndroidCleanup({ ...input, captureResult });
    assert.equal(result.result, 'passed');
    assert.equal(result.captureResult, captureResult);
  }
  for (const patch of [
    { captureCleanupClean: false },
    { directoriesAbsent: false },
    { cacheAbsent: false },
    { defaultAdbPreserved: false },
    { foreignAvdsPreserved: false },
    { unavailablePorts: [5554] },
    { liveProcesses: input.ownedProcesses },
    { docker: { ...input.docker, volume: ['retained'] } },
    { currentDevices: { devices: { ios: [{ udid: 'foreign', state: 'Booted' }] } } },
  ])
    assert.equal(evaluateOwnedAndroidCleanup({ ...input, ...patch }).result, 'failed');
  assert.throws(() => evaluateOwnedAndroidCleanup({ ...input, ownedProcesses: [] }));
  assert.throws(() => evaluateOwnedAndroidCleanup({ ...input, unavailablePorts: [NaN] }));
  assert.throws(() =>
    evaluateOwnedAndroidCleanup({
      ...input,
      currentDevices: {
        devices: {
          ios: [...input.currentDevices.devices.ios, ...input.currentDevices.devices.ios],
        },
      },
    }),
  );
});

void test('original Android cleanup status retains failure diagnostics and rejects contradictory release reports', () => {
  const capture = {
    cleanup: 'cleaned',
    cleanupFailures: [] as unknown[],
    acquisitionIntents: [...resources],
  };
  assert.equal(requireAndroidCaptureCleanupStatus(capture), true);
  assert.equal(
    requireAndroidCaptureCleanupStatus({
      ...capture,
      cleanup: 'failed-recovery-retained',
      cleanupFailures: ['Previous iOS device IDs or states changed'],
    }),
    false,
  );
  assert.equal(
    requireAndroidCaptureCleanupStatus({
      ...capture,
      cleanup: 'not-acquired',
      acquisitionIntents: [],
    }),
    false,
  );
  for (const patch of [
    { cleanup: 'unknown' },
    { cleanup: 'failed-recovery-retained' },
    { cleanup: 'cleaned', cleanupFailures: ['known failure'] },
    { cleanup: 'not-acquired' },
    { cleanupFailures: null },
    { cleanup: 'failed-recovery-retained', cleanupFailures: [''] },
    { cleanup: 'failed-recovery-retained', cleanupFailures: [123] },
  ])
    assert.throws(() =>
      requireAndroidCaptureCleanupStatus({ ...capture, ...patch } as typeof capture),
    );
});

void test('Android cleanup preserves recorded foreign changes after restoration and rejects newly added devices', () => {
  const input = base();
  const recordedDevices = { devices: { ios: [{ udid: 'foreign', state: 'Booted' }] } };
  for (const captureCleanupClean of [true, false]) {
    const result = evaluateOwnedAndroidCleanup({ ...input, captureCleanupClean, recordedDevices });
    assert.equal(result.result, 'failed');
    assert.deepEqual(result.missingForeignDevices, []);
    assert.deepEqual(result.recordedForeignDeviceChanges, {
      missingOrChanged: ['foreign'],
      added: [],
    });
    assert.deepEqual(result.survivors, []);
    assert.equal(result.nativePassingCases, 0);
  }
  const extra = {
    devices: { ios: [...input.previousDevices.devices.ios, { udid: 'added', state: 'Shutdown' }] },
  };
  const currentAdded = evaluateOwnedAndroidCleanup({ ...input, currentDevices: extra });
  assert.equal(currentAdded.result, 'failed');
  assert.deepEqual(currentAdded.addedForeignDevices, ['added']);
  const recordedAdded = evaluateOwnedAndroidCleanup({ ...input, recordedDevices: extra });
  assert.equal(recordedAdded.result, 'failed');
  assert.deepEqual(recordedAdded.addedForeignDevices, []);
  assert.deepEqual(recordedAdded.recordedForeignDeviceChanges.added, ['added']);
  for (const recordedDevices of [
    { devices: { ios: [{ udid: 'foreign', state: '' }] } },
    {
      devices: {
        ios: [...input.previousDevices.devices.ios, ...input.previousDevices.devices.ios],
      },
    },
  ])
    assert.throws(() => evaluateOwnedAndroidCleanup({ ...input, recordedDevices }));
  for (const recordedDevices of [
    [],
    { devices: [] },
    { devices: null },
    { devices: { ios: null } },
  ])
    assert.throws(() =>
      evaluateOwnedAndroidCleanup({ ...input, recordedDevices: recordedDevices as never }),
    );
});

void test('Android early scope can prove zero owned processes only from explicit dispatch and cannot fabricate Docker/Expo absence', () => {
  const input = {
    ...base(),
    acquisitions: [],
    ownedProcesses: [],
    liveProcesses: [],
    captureResult: 'harness-blocked',
    cacheAbsent: null,
    docker: null,
  };
  const clean = evaluateOwnedAndroidCleanup(input);
  assert.equal(clean.result, 'passed');
  assert.equal(clean.pidStartPairs, 0);
  assert.equal(clean.docker, null);
  assert.equal(clean.cacheAbsent, null);
  assert.throws(() => evaluateOwnedAndroidCleanup({ ...input, docker: base().docker }));
  assert.throws(() => evaluateOwnedAndroidCleanup({ ...input, cacheAbsent: true }));
  assert.equal(
    evaluateOwnedAndroidCleanup({
      ...input,
      ownedProcesses: base().ownedProcesses,
      liveProcesses: base().ownedProcesses,
    }).result,
    'failed',
  );
  assert.equal(
    evaluateOwnedAndroidCleanup({ ...input, defaultAdbPreserved: false }).result,
    'failed',
  );
});

void test('Android acquisition proof rejects missing, duplicate, crossed, legacy, reordered and undispatched resource evidence', () => {
  const runId = 'a'.repeat(24);
  for (let length = 0; length <= resources.length; length++) {
    const prefix = resources.slice(0, length);
    const capture = { acquisitionIntents: [...prefix], commandExecutions: [] };
    const files = prefix.map((x) => `acquisition-${x}.private.json`);
    const intents = prefix.map((resource) => ({
      kind: 'owned android capture acquisition intent',
      captureRunId: runId,
      resource,
    }));
    assert.deepEqual(requireAndroidCleanupAcquisition(capture, files, intents, runId), prefix);
    assert.throws(() =>
      requireAndroidCleanupAcquisition(
        { ...capture, acquisitionIntents: undefined as never },
        files,
        intents,
        runId,
      ),
    );
    if (length) {
      assert.throws(() =>
        requireAndroidCleanupAcquisition(capture, files.slice(1), intents, runId),
      );
      assert.throws(() =>
        requireAndroidCleanupAcquisition(
          capture,
          files,
          intents.map((x, i) => (i ? x : { ...x, captureRunId: 'b'.repeat(24) })),
          runId,
        ),
      );
      assert.throws(() =>
        requireAndroidCleanupAcquisition(
          capture,
          files,
          intents.map((x) => ({ ...x, extra: 'unexpected' })),
          runId,
        ),
      );
      assert.throws(() =>
        requireAndroidCleanupAcquisition(
          { ...capture, acquisitionIntents: [...prefix, prefix[0]] },
          files,
          intents,
          runId,
        ),
      );
    }
    assert.throws(() =>
      requireAndroidCleanupAcquisition(
        capture,
        [...files, 'acquisition-foreign.private.json'],
        intents,
        runId,
      ),
    );
    if (length < 5)
      for (const extra of [
        'journey-readiness.ownership.json',
        'expo-cache-owner.private.json',
        'android-app-build',
      ])
        assert.throws(() =>
          requireAndroidCleanupAcquisition(capture, [...files, extra], intents, runId),
        );
  }
  assert.throws(() =>
    requireAndroidCleanupAcquisition(
      { acquisitionIntents: ['emulator'], commandExecutions: [] },
      ['acquisition-emulator.private.json'],
      [],
      runId,
    ),
  );
  assert.throws(() =>
    requireAndroidCleanupAcquisition(
      { acquisitionIntents: ['adb', 'backend'], commandExecutions: [] },
      [],
      [],
      runId,
    ),
  );
});

void test('shared absence census retains every PID/start pair and rejects malformed process output', () => {
  const owned = base().ownedProcesses;
  assert.deepEqual(processSurvivors([...owned, owned[0]], owned), {
    pidStartPairs: 2,
    survivors: [810, 811],
  });
  assert.deepEqual(processSurvivors(owned, base().liveProcesses).survivors, []);
  assert.deepEqual(parseProcesses('  810 Tue Sep 29 13:00:00 2026\n'), [owned[0]]);
  for (const stdout of ['unknown row', '810 bad date', '810 Tue Sep 29 13:00:00 2026 unknown'])
    assert.throws(() => parseProcesses(stdout));
  assert.throws(() => processSurvivors([{ pid: 810, started: 'unknown' }], []));
});

void test('Android unavailable inspection writes one private failed receipt and cannot overwrite or escape its run', async () => {
  const repositoryRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-android-cleanup-')),
  );
  const artifactRoot = path.join(repositoryRoot, '.qa/artifacts/native-pilot', 'a'.repeat(24));
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const options = {
    repositoryRoot,
    artifactRoot,
    androidRuntimeParent: repositoryRoot,
    sdkRoot: repositoryRoot,
  };
  try {
    const result = await verifyOwnedAndroidCleanup(options);
    assert.equal(result.result, 'failed');
    assert.equal('censusStatus' in result && result.censusStatus, 'unavailable');
    const file = path.join(artifactRoot, 'external-cleanup.private.json'),
      bytes = await readFile(file);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await assert.rejects(verifyOwnedAndroidCleanup(options), /EEXIST/);
    assert.deepEqual(await readFile(file), bytes);
    const wrong = path.join(repositoryRoot, 'b'.repeat(24));
    await mkdir(wrong, { mode: 0o700 });
    await assert.rejects(
      verifyOwnedAndroidCleanup({ ...options, artifactRoot: wrong }),
      /captured|native-pilot|strictEqual/,
    );
    await assert.rejects(readFile(path.join(wrong, 'external-cleanup.private.json')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

void test('Android partial cleanup retains one owned final-state diagnostic but rejects scenario commands', async () => {
  const runId = 'a'.repeat(24);
  const prefix = ['adb', 'emulator', 'backend', 'proxy'] as const;
  const intents = prefix.map((resource) => ({
    kind: 'owned android capture acquisition intent',
    captureRunId: runId,
    resource,
  }));
  const command = {
    label: 'final-state',
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    pid: 810,
    pgid: 810,
    logPath: '',
    stdoutPath: '',
    ownershipPath: '',
    elapsedMs: 10,
    cleanupMs: 2,
    deadlineMs: 30_000,
    censusFailure: null,
    outputFailure: null,
  };
  const artifactRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-android-final-state-')),
  );
  try {
    await chmod(artifactRoot, 0o700);
    const expected = {
      logPath: path.join(artifactRoot, 'final-state.private.log'),
      stdoutPath: path.join(artifactRoot, 'final-state.png'),
      ownershipPath: path.join(artifactRoot, 'final-state.ownership.json'),
    };
    Object.assign(command, expected);
    const ledger = {
      kind: 'private worker process ownership',
      cleanup: 'cleaned',
      pid: command.pid,
      pgid: command.pgid,
      processes: [{ pid: command.pid, pgid: command.pgid, started: 'Tue Sep 29 13:00:00 2026' }],
    };
    for (const [name, contents] of [
      ['final-state.private.log', 'owned final-state\n'],
      ['final-state.png', 'PNG'],
      ['final-state.ownership.json', JSON.stringify(ledger)],
    ] as const) {
      const file = path.join(artifactRoot, name);
      await writeFile(file, contents);
      await chmod(file, 0o600);
    }
    const files = [
      ...prefix.map((resource) => `acquisition-${resource}.private.json`),
      'final-state.private.log',
      'final-state.png',
      'final-state.ownership.json',
    ];
    const capture = { acquisitionIntents: [...prefix], commandExecutions: [command] };
    assert.deepEqual(
      requireAndroidCleanupAcquisition(capture, files, intents, runId, artifactRoot),
      [...prefix],
    );
    assert.throws(() => requireAndroidCleanupAcquisition(capture, files, intents, runId));
    for (const invalid of [
      { ...command, label: 'android-launch' },
      { ...command, cleanup: 'unknown' },
      {
        ...command,
        logPath: path.join(path.dirname(artifactRoot), 'foreign', 'final-state.private.log'),
      },
      { ...command, pid: null },
      { ...command, pgid: 811 },
      [command, { ...command, label: 'second-final-state' }],
    ]) {
      assert.throws(() =>
        requireAndroidCleanupAcquisition(
          { ...capture, commandExecutions: Array.isArray(invalid) ? invalid : [invalid] },
          files,
          intents,
          runId,
          artifactRoot,
        ),
      );
    }
    await writeFile(
      expected.ownershipPath,
      JSON.stringify({
        ...ledger,
        pid: 811,
        pgid: 811,
        processes: [{ ...ledger.processes[0], pid: 811, pgid: 811 }],
      }),
    );
    await chmod(expected.ownershipPath, 0o600);
    assert.throws(() =>
      requireAndroidCleanupAcquisition(capture, files, intents, runId, artifactRoot),
    );
    assert.throws(() =>
      requireAndroidCleanupAcquisition(
        capture,
        files.filter((name) => name !== 'final-state.ownership.json'),
        intents,
        runId,
        artifactRoot,
      ),
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

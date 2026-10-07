import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  evaluateOwnedIosCleanup,
  evaluateZeroAcquisitionIosCleanup,
  requireZeroAcquisitionIosPreflight,
  verifyOwnedIosCleanup,
} from '../../scripts/testing/verify-owned-ios-cleanup';

const base = () => ({
  runId: 'a'.repeat(24),
  captureResult: 'observed',
  captureCleanupClean: true,
  ownedProcesses: [
    { pid: 810, started: 'Tue Sep 29 13:00:00 2026' },
    { pid: 811, started: 'Tue Sep 29 13:00:01 2026' },
  ],
  liveProcesses: [{ pid: 810, started: 'Tue Sep 29 15:00:00 2026' }],
  previousDevices: {
    devices: { ios: [{ udid: 'foreign', state: 'Shutdown' }] },
  },
  currentDevices: {
    devices: { ios: [{ udid: 'foreign', state: 'Shutdown' }] },
  },
  ownedDeviceId: 'owned',
  cacheAbsent: true,
  docker: { container: [], network: [], volume: [] },
});

void test('independent cleanup requires exact PID/start absence and unchanged foreign state', () => {
  const input = base();
  const clean = evaluateOwnedIosCleanup(input);
  assert.equal(clean.result, 'passed');
  assert.equal(clean.pidStartPairs, 2);
  assert.deepEqual(clean.survivors, []);
  assert.deepEqual(clean.missingForeignDevices, []);
  const interrupted = evaluateOwnedIosCleanup({ ...input, captureResult: 'harness-blocked' });
  assert.equal(interrupted.result, 'passed');
  assert.equal(interrupted.captureResult, 'harness-blocked');
  assert.equal(
    evaluateOwnedIosCleanup({
      ...input,
      liveProcesses: [{ pid: 810, started: input.ownedProcesses[0].started }],
    }).result,
    'failed',
  );
  assert.deepEqual(
    evaluateOwnedIosCleanup({
      ...input,
      currentDevices: { devices: { ios: [{ udid: 'foreign', state: 'Booted' }] } },
    }).missingForeignDevices,
    ['foreign'],
  );
  for (const changed of [
    { captureCleanupClean: false },
    {
      currentDevices: {
        devices: {
          ios: [
            { udid: 'foreign', state: 'Shutdown' },
            { udid: 'owned', state: 'Shutdown' },
          ],
        },
      },
    },
    { cacheAbsent: false },
    { docker: { container: ['retained'], network: [], volume: [] } },
  ])
    assert.equal(evaluateOwnedIosCleanup({ ...input, ...changed }).result, 'failed');
  assert.throws(() => evaluateOwnedIosCleanup({ ...input, ownedProcesses: [] }));
  assert.throws(() =>
    evaluateOwnedIosCleanup({
      ...input,
      previousDevices: { devices: { ios: [{ udid: 'owned', state: 'Shutdown' }] } },
    }),
  );
});

void test('unavailable independent census writes one private failed receipt and cannot overwrite it', async () => {
  const repositoryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-cleanup-')));
  const artifactRoot = path.join(repositoryRoot, '.qa/artifacts/native-pilot', 'a'.repeat(24));
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  try {
    const result = await verifyOwnedIosCleanup({ repositoryRoot, artifactRoot });
    assert.equal(result.result, 'failed');
    assert.equal('censusStatus' in result && result.censusStatus, 'unavailable');
    const file = path.join(artifactRoot, 'external-cleanup.private.json');
    const bytes = await readFile(file, 'utf8');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await assert.rejects(verifyOwnedIosCleanup({ repositoryRoot, artifactRoot }), /EEXIST/);
    assert.equal(await readFile(file, 'utf8'), bytes);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

void test('zero-acquisition preflight requires an exact empty dispatch boundary', () => {
  const runId = 'a'.repeat(24);
  const capture = {
    result: 'harness-blocked',
    cleanup: 'not-acquired',
    acquisitionIntents: [],
    commandExecutions: [],
  };
  const files = [
    'capture.private.json',
    'native-host-census.private.json',
    'previous-ios-devices.private.json',
    'after-ios-devices.private.json',
  ];
  assert.doesNotThrow(() => requireZeroAcquisitionIosPreflight(capture, files, runId));
  for (const changed of [
    { ...capture, acquisitionIntents: ['adb'] },
    { ...capture, backend: {} },
    { ...capture, device: {} },
    { ...capture, reservedPorts: [] },
    { ...capture, commandExecutions: [{ childExitCode: 0 }] },
    { ...capture, cleanup: 'cleaned' },
  ])
    assert.throws(() => requireZeroAcquisitionIosPreflight(changed, files, runId));
  for (const extra of [
    'acquisition-adb.private.json',
    'adb-server.ownership.json',
    'backend-manifest.json',
    'build.private.log',
    'expo-ownership.json',
    'ios-build',
    'simulator-owner.private.json',
  ])
    assert.throws(() => requireZeroAcquisitionIosPreflight(capture, [...files, extra], runId));
});

void test('zero-acquisition cleanup passes only with observed after-state and clear host census', () => {
  const input = {
    runId: 'a'.repeat(24),
    captureResult: 'harness-blocked',
    captureCleanup: 'not-acquired',
    afterStateStatus: 'observed' as const,
    hostCensusStatus: 'available' as const,
    noResourceEvidence: true,
    sourceStable: true,
    helperStable: true,
    devicesStable: true,
    foreignDeviceChanges: [] as string[],
  };
  const clean = evaluateZeroAcquisitionIosCleanup(input);
  assert.equal(clean.result, 'passed');
  assert.equal(clean.captureCleanup, 'not-acquired');
  assert.equal(clean.captureCleanupClean, false);
  assert.deepEqual(clean.acquisitionIntents, []);
  for (const patch of [
    { afterStateStatus: 'unknown' as const },
    { hostCensusStatus: 'unknown' as const },
    { noResourceEvidence: false },
    { sourceStable: false },
    { helperStable: false },
    { devicesStable: false, foreignDeviceChanges: ['foreign'] },
    { captureCleanup: 'cleaned' },
  ]) {
    const result = evaluateZeroAcquisitionIosCleanup({ ...input, ...patch });
    assert.equal(result.result, 'failed');
    assert(result.failureReasons.length > 0);
  }
});

void test('historical zero-acquisition capture without after-state stays specifically blocked', async () => {
  const repositoryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-ios-zero-')));
  const artifactRoot = path.join(repositoryRoot, '.qa/artifacts/native-pilot', 'a'.repeat(24));
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      path.join(artifactRoot, 'capture.private.json'),
      JSON.stringify({
        kind: 'private-owned-native-training-execution-not-public-receipt',
        mode: 'integration',
        platform: 'ios',
        result: 'harness-blocked',
        cleanup: 'not-acquired',
        acquisitionIntents: [],
        commandExecutions: [],
      }),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(artifactRoot, 'previous-ios-devices.private.json'),
      JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [] } }),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(artifactRoot, 'native-host-census.private.json'),
      JSON.stringify({
        kind: 'native-host-known-job-census',
        status: 'no-known-job',
        knownJobs: [],
      }),
      { mode: 0o600 },
    );
    const result = await verifyOwnedIosCleanup({ repositoryRoot, artifactRoot });
    assert(result.kind === 'independent ios zero-acquisition cleanup proof');
    assert('captureCleanup' in result && 'failureReasons' in result);
    assert.equal(result.result, 'failed');
    assert.equal(result.captureCleanup, 'not-acquired');
    assert(result.failureReasons.includes('after-state-unknown'));
    assert(result.failureReasons.includes('source-after-mismatch-or-unknown'));
    assert(result.failureReasons.includes('helper-after-mismatch-or-unknown'));
    assert(result.failureReasons.includes('ios-device-after-mismatch-or-unknown'));
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

void test('early cleanup requires an exact dispatch prefix and rejects later acquisition evidence', async () => {
  const { requireBeforeBackendIosAcquisition } =
    await import('../../scripts/testing/verify-owned-ios-cleanup');
  const runId = 'a'.repeat(24);
  const capture = { acquisitionIntents: ['adb', 'simulator'], commandExecutions: [] };
  const files = ['acquisition-adb.private.json', 'acquisition-simulator.private.json'];
  const intents = ['adb', 'simulator'].map((resource, index) => ({
    schemaVersion: 1,
    kind: 'owned iOS acquisition intent',
    runId,
    resource,
    previous: index ? ['adb'] : [],
    startedAt: '2026-09-29T18:00:00.000Z',
  }));
  assert.doesNotThrow(() => requireBeforeBackendIosAcquisition(capture, files, intents, runId));
  for (const changed of [
    {},
    { ...capture, acquisitionIntents: ['adb'] },
    { ...capture, acquisitionIntents: ['adb', 'simulator', 'backend'] },
    { ...capture, backend: null },
    { ...capture, backend: { runId } },
    { ...capture, commandExecutions: [{ childExitCode: 0 }] },
  ])
    assert.throws(() => requireBeforeBackendIosAcquisition(changed, files, intents, runId));
  for (const extra of [
    'acquisition-backend.private.json',
    'acquisition-proxy.private.json',
    'expo-cache-owner.private.json',
    'build.private.log',
    'ios-build',
    'entry.ownership.json',
  ])
    assert.throws(() =>
      requireBeforeBackendIosAcquisition(capture, [...files, extra], intents, runId),
    );
  assert.throws(() => requireBeforeBackendIosAcquisition(capture, files.slice(1), intents, runId));
  const tampered = structuredClone(intents);
  tampered[1].runId = 'b'.repeat(24);
  assert.throws(() => requireBeforeBackendIosAcquisition(capture, files, tampered, runId));
});

void test('partial cleanup permits a proven zero owned-process scope but cannot waive survivors, foreign state or borrowed resources', async () => {
  const { evaluateBeforeBackendIosCleanup } =
    await import('../../scripts/testing/verify-owned-ios-cleanup');
  const input = {
    runId: 'a'.repeat(24),
    captureResult: 'harness-blocked',
    captureCleanupClean: true,
    ownedProcesses: [],
    liveProcesses: [],
    previousDevices: base().previousDevices,
    currentDevices: base().currentDevices,
    ownedDeviceId: 'owned',
    adbPreserved: true,
    unavailablePorts: [] as number[],
  };
  const clean = evaluateBeforeBackendIosCleanup(input);
  assert.equal(clean.result, 'passed');
  assert.equal(clean.pidStartPairs, 0);
  assert.equal(
    'docker' in clean,
    false,
    'unacquired backend is not fabricated as empty Docker proof',
  );
  assert.equal(
    evaluateBeforeBackendIosCleanup({ ...input, captureResult: 'cancelled' }).result,
    'passed',
  );
  for (const patch of [
    { captureCleanupClean: false },
    { adbPreserved: false },
    { unavailablePorts: [42001] },
    { currentDevices: { devices: { ios: [{ udid: 'foreign', state: 'Booted' }] } } },
    {
      currentDevices: {
        devices: {
          ios: [...base().currentDevices.devices.ios, { udid: 'owned', state: 'Shutdown' }],
        },
      },
    },
    { ownedProcesses: base().ownedProcesses, liveProcesses: base().ownedProcesses },
  ])
    assert.equal(evaluateBeforeBackendIosCleanup({ ...input, ...patch }).result, 'failed');
  assert.equal(
    evaluateBeforeBackendIosCleanup({
      ...input,
      ownedProcesses: base().ownedProcesses,
      liveProcesses: base().liveProcesses,
    }).result,
    'passed',
    'reused PID with a different start is not an owned survivor',
  );
  assert.throws(
    () => evaluateOwnedIosCleanup({ ...base(), ownedProcesses: [] }),
    'the full-session gate still requires its owned process census',
  );
});

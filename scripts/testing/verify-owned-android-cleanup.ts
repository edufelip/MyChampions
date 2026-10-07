import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  devices,
  ownershipProcesses,
  parseProcesses,
  processSurvivors,
} from './native-cleanup-evidence';
import { readNativeEvidence } from './native-view-evidence';
import { inspectAdbServer, requireAdbServerPreserved } from './owned-adb-server';
import { readOwnedRuntimeDocument, validateOwnedManifest } from './owned-session';
import type { ProcessIdentity, SimDeviceList } from './native-cleanup-evidence';
import type { AdbServerIdentity } from './owned-adb-server';
import type { OwnedManifest } from './owned-session';
import type { AndroidRunnerSlot } from '../ci/android-runner-slot';

const execute = promisify(execFile);
const id = /^[a-f0-9]{24}$/;
const resources = ['adb', 'emulator', 'backend', 'proxy', 'expo'] as const;
type Resource = (typeof resources)[number];
type Capture = {
  platform: string;
  captureRunId: string;
  result: string;
  cleanup: string;
  cleanupFailures: unknown[];
  acquisitionIntents: Resource[];
  commandExecutions: unknown[];
  source: unknown;
  sourceAfter: unknown;
  helperInputsBefore: unknown[];
  helperInputsAfter: unknown[];
  originalAvds: string[];
  avdsAfter: string[];
  workspaceApkBefore: unknown;
  workspaceApkAfter: unknown;
  device?: {
    runId: string;
    avd: string;
    serial: string;
    slot: AndroidRunnerSlot;
  };
  backend?: {
    runId: string;
    composeProject: string;
    artifactRoot: string;
    processes: ProcessIdentity[];
  };
  backendAcquisitionFailure?: {
    cleanup: string;
    manifest: OwnedManifest | null;
    pid: number | null;
  };
  network?: { apiOrigin: string; metroOrigin: string };
  reservedAppPort?: number;
  proxyOrigin?: string;
};
export type AndroidCleanupOptions = {
  repositoryRoot: string;
  artifactRoot: string;
  androidRuntimeParent: string;
  sdkRoot: string;
};
export type AndroidCleanupCapturePublication =
  'published-capture-file' | 'provisional-before-capture-publication';
/**
 * Only the camera producer's prepublication path may inspect an in-memory capture.
 * The public cleanup inspector deliberately has no capture override, so every ordinary
 * caller must reread the existing same-attempt capture.private.json receipt.
 */
export type AndroidCleanupProvisionalOptions = AndroidCleanupOptions & {
  capture: {
    document: Record<string, unknown>;
    publication: AndroidCleanupCapturePublication;
  };
};
const json = (root: string, relative: string): unknown =>
  JSON.parse(readNativeEvidence(root, relative, true).toString());
const record = (value: unknown): Record<string, unknown> => {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
};

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

/**
 * A target can be acquired before Expo/build startup fails. In that partial
 * state the capture finally block may emit one owned final-state screenshot.
 * Retain that diagnostic, but reject every scenario/build command and require
 * the complete descriptor/ownership set before cleanup can call it bounded.
 */
function requireOwnedFinalStateDiagnostic(
  commandExecutions: unknown[],
  files: readonly string[],
  artifactRoot: string,
): void {
  assert.equal(
    path.resolve(artifactRoot),
    artifactRoot,
    'Final-state artifact root is not canonical',
  );
  assert.equal(commandExecutions.length, 1, 'Partial Android cleanup has unexpected commands');
  const row = record(commandExecutions[0]);
  assert.equal(row.label, 'final-state', 'Partial Android cleanup command is not final-state');
  assert.equal(row.phase, 'step', 'Partial Android cleanup diagnostic phase is invalid');
  assert.equal(row.execution, 'completed', 'Partial Android cleanup diagnostic did not complete');
  assert.equal(row.cleanup, 'cleaned', 'Partial Android cleanup diagnostic was not cleaned');
  assert.equal(row.childExitCode, 0, 'Partial Android cleanup diagnostic child failed');
  assert.equal(row.childSignal, null, 'Partial Android cleanup diagnostic was signaled');
  assert(Number.isSafeInteger(row.pid) && Number(row.pid) > 1, 'Partial diagnostic PID is invalid');
  assert(
    Number.isSafeInteger(row.pgid) && Number(row.pgid) > 1,
    'Partial diagnostic PGID is invalid',
  );
  assert(
    Number.isSafeInteger(row.deadlineMs) && Number(row.deadlineMs) > 0,
    'Partial diagnostic deadline is invalid',
  );
  assert.equal(row.censusFailure, null, 'Partial diagnostic census is not clean');
  assert.equal(row.outputFailure, null, 'Partial diagnostic output is not clean');
  for (const [key, basename] of [
    ['logPath', 'final-state.private.log'],
    ['stdoutPath', 'final-state.png'],
    ['ownershipPath', 'final-state.ownership.json'],
  ] as const) {
    const value = row[key];
    assert(typeof value === 'string' && path.isAbsolute(value), `${key} is not absolute`);
    assert.equal(value, path.join(artifactRoot, basename), `${key} is outside artifact root`);
    assert(files.includes(basename), `Partial diagnostic file is missing: ${basename}`);
    readNativeEvidence(artifactRoot, basename, true);
  }
  const ledger = record(json(artifactRoot, 'final-state.ownership.json'));
  assert.equal(ledger.kind, 'private worker process ownership');
  assert.equal(ledger.cleanup, 'cleaned');
  assert.equal(ledger.pid, row.pid, 'Final-state PID is not bound to its local ledger');
  assert.equal(ledger.pgid, row.pgid, 'Final-state PGID is not bound to its local ledger');
  ownershipProcesses(ledger);
  assert(
    Array.isArray(ledger.processes) &&
      ledger.processes.some((value) => {
        const process = record(value);
        return process.pid === row.pid && process.pgid === row.pgid;
      }),
    'Final-state PID/PGID is absent from its local ownership process ledger',
  );
}

/** Strict current acquisition order; absent owner files never erase a dispatched resource. */
export function requireAndroidCleanupAcquisition(
  capture: Pick<
    Capture,
    | 'acquisitionIntents'
    | 'backend'
    | 'backendAcquisitionFailure'
    | 'device'
    | 'commandExecutions'
    | 'reservedAppPort'
    | 'proxyOrigin'
  >,
  files: readonly string[],
  intents: unknown[],
  runId: string,
  artifactRoot?: string,
) {
  assert.match(runId, id);
  assert(Array.isArray(capture.acquisitionIntents));
  const prefix = resources.slice(0, capture.acquisitionIntents.length);
  assert.deepEqual(
    capture.acquisitionIntents,
    prefix,
    'Android acquisition scope is not the current ordered prefix',
  );
  assert.equal(intents.length, prefix.length);
  assert.deepEqual(
    files.filter((name) => /^acquisition-.*\.private\.json$/.test(name)).sort(),
    prefix.map((x) => `acquisition-${x}.private.json`).sort(),
  );
  for (const [index, resource] of prefix.entries()) {
    const intent = record(intents[index]);
    assert.deepEqual(Object.keys(intent).sort(), ['captureRunId', 'kind', 'resource']);
    assert.equal(intent.kind, 'owned android capture acquisition intent');
    assert.equal(intent.captureRunId, runId);
    assert.equal(intent.resource, resource);
  }
  for (const [resource, pattern] of [
    ['adb', /^adb-server(?:[.-]|$)/],
    [
      'emulator',
      /^android-(?:target|cleanup|acquisition|preflight|create-avd|adb-server|emulator)(?:[.-]|$)/,
    ],
    ['expo', /^expo-/],
  ] as const)
    if (!prefix.includes(resource))
      assert(
        !files.some((name) => pattern.test(name)),
        `Undispatched ${resource} has ownership evidence`,
      );
  if (!prefix.includes('emulator')) {
    assert.equal(capture.device, undefined);
    assert.equal(capture.reservedAppPort, undefined);
  }
  if (!prefix.includes('proxy')) assert.equal(capture.proxyOrigin, undefined);
  if (!prefix.includes('backend')) {
    assert.equal(capture.backend, undefined);
    assert.equal(capture.backendAcquisitionFailure, undefined);
  }
  if (!prefix.includes('expo')) {
    if (prefix.includes('emulator') && capture.commandExecutions.length > 0)
      requireOwnedFinalStateDiagnostic(capture.commandExecutions, files, artifactRoot ?? '');
    else assert.deepEqual(capture.commandExecutions, []);
    const allowed = prefix.includes('adb') ? ['adb-server.ownership.json'] : [];
    if (prefix.includes('emulator') && capture.commandExecutions.length > 0)
      allowed.push('final-state.ownership.json');
    if (prefix.includes('emulator'))
      allowed.push(
        'android-create-avd.ownership.json',
        'android-adb-server.ownership.json',
        'android-emulator.ownership.json',
      );
    assert(
      !files.some((name) => name.endsWith('.ownership.json') && !allowed.includes(name)),
      'Undispatched engine has ownership evidence',
    );
    assert(
      !files.some((name) =>
        /^(?:android-app-build|android-build(?:[.-]|$)|android-install(?:[.-]|$))/.test(name),
      ),
      'Undispatched build has evidence',
    );
  }
  return [...prefix];
}

/** Pure comparison includes all historical PID/start pairs, including zombies and reused PIDs. */
/** Validate the original release report without converting a reported failure into success. */
export function requireAndroidCaptureCleanupStatus(
  capture: Pick<Capture, 'cleanup' | 'cleanupFailures' | 'acquisitionIntents'>,
) {
  assert(['cleaned', 'failed-recovery-retained', 'not-acquired'].includes(capture.cleanup));
  assert(Array.isArray(capture.cleanupFailures));
  assert(
    capture.cleanupFailures.every((failure) => typeof failure === 'string' && failure.trim()),
    'Original cleanup failure diagnostics are malformed',
  );
  if (capture.cleanup === 'failed-recovery-retained')
    assert(capture.cleanupFailures.length > 0, 'Original failed cleanup lacks its diagnostics');
  else
    assert.deepEqual(capture.cleanupFailures, [], 'Original cleanup status contradicts failures');
  if (capture.cleanup === 'not-acquired')
    assert.deepEqual(capture.acquisitionIntents, [], 'Unacquired cleanup declares resources');
  return capture.cleanup === 'cleaned';
}

function foreignDeviceChanges(previous: SimDeviceList, observed: SimDeviceList) {
  for (const value of [previous, observed])
    assert(
      value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        value.devices &&
        typeof value.devices === 'object' &&
        !Array.isArray(value.devices),
      'Foreign device snapshot is malformed',
    );
  const before = devices(previous),
    after = devices(observed);
  for (const [udid, state] of [...before, ...after])
    assert(
      udid && state && udid.trim() === udid && state.trim() === state,
      'Foreign device snapshot has an invalid identity or state',
    );
  return {
    missingOrChanged: [...before]
      .filter(([udid, state]) => after.get(udid) !== state)
      .map(([udid]) => udid)
      .sort(),
    added: [...after.keys()].filter((udid) => !before.has(udid)).sort(),
  };
}

export function evaluateOwnedAndroidCleanup(input: {
  runId: string;
  captureResult: string;
  captureCleanupClean: boolean;
  acquisitions: Resource[];
  ownedProcesses: ProcessIdentity[];
  liveProcesses: ProcessIdentity[];
  previousDevices: SimDeviceList;
  recordedDevices: SimDeviceList;
  currentDevices: SimDeviceList;
  directoriesAbsent: boolean;
  cacheAbsent: boolean | null;
  defaultAdbPreserved: boolean;
  foreignAvdsPreserved: boolean;
  unavailablePorts: number[];
  docker: Record<'container' | 'network' | 'volume', string[]> | null;
}) {
  assert.match(input.runId, id);
  assert(typeof input.captureResult === 'string' && input.captureResult.length > 0);
  assert.equal(typeof input.captureCleanupClean, 'boolean');
  assert.deepEqual(input.acquisitions, resources.slice(0, input.acquisitions.length));
  for (const flag of [
    input.directoriesAbsent,
    input.defaultAdbPreserved,
    input.foreignAvdsPreserved,
  ])
    assert.equal(typeof flag, 'boolean');
  if (input.acquisitions.includes('expo')) assert.equal(typeof input.cacheAbsent, 'boolean');
  else assert.equal(input.cacheAbsent, null, 'Undispatched Expo cannot claim empty-cache proof');
  if (input.acquisitions.includes('backend')) {
    assert(input.docker);
    for (const kind of ['container', 'network', 'volume'] as const)
      assert(Array.isArray(input.docker[kind]));
  } else assert.equal(input.docker, null, 'Undispatched backend cannot claim empty Docker proof');
  if (input.acquisitions.length === resources.length)
    assert(input.ownedProcesses.length > 0, 'Owned process census is absent');
  assert(
    input.unavailablePorts.every(
      (port) => Number.isSafeInteger(port) && port >= 1024 && port <= 65535,
    ),
  );
  const census = processSurvivors(input.ownedProcesses, input.liveProcesses);
  const recordedForeignDeviceChanges = foreignDeviceChanges(
    input.previousDevices,
    input.recordedDevices,
  );
  const currentChanges = foreignDeviceChanges(input.previousDevices, input.currentDevices);
  const missingForeignDevices = currentChanges.missingOrChanged;
  const addedForeignDevices = currentChanges.added;
  const result =
    input.captureCleanupClean &&
    census.survivors.length === 0 &&
    missingForeignDevices.length === 0 &&
    addedForeignDevices.length === 0 &&
    recordedForeignDeviceChanges.missingOrChanged.length === 0 &&
    recordedForeignDeviceChanges.added.length === 0 &&
    input.directoriesAbsent &&
    input.cacheAbsent !== false &&
    input.defaultAdbPreserved &&
    input.foreignAvdsPreserved &&
    input.unavailablePorts.length === 0 &&
    (input.docker === null || Object.values(input.docker).every((rows) => rows.length === 0))
      ? 'passed'
      : 'failed';
  return {
    kind: 'independent android native cleanup proof',
    result,
    runId: input.runId,
    captureResult: input.captureResult,
    captureCleanupClean: input.captureCleanupClean,
    acquisitions: input.acquisitions,
    ...census,
    unknownProcessQueries: [] as number[],
    missingForeignDevices,
    addedForeignDevices,
    recordedForeignDeviceChanges,
    ownedDeviceAbsent: input.directoriesAbsent,
    cacheAbsent: input.cacheAbsent,
    defaultAdbPreserved: input.defaultAdbPreserved,
    foreignAvdsPreserved: input.foreignAvdsPreserved,
    unavailablePorts: input.unavailablePorts,
    docker: input.docker,
    nativePassingCases: 0,
  };
}

async function absent(file: string) {
  try {
    await lstat(file);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return true;
  }
}
async function privateDirectory(directory: string) {
  assert.equal(await realpath(directory), directory);
  const meta = await lstat(directory);
  assert(meta.isDirectory() && !meta.isSymbolicLink() && meta.uid === process.getuid?.());
  assert.equal(meta.mode & 0o777, 0o700);
  return meta;
}
async function rootIdentity(options: AndroidCleanupOptions) {
  const repositoryRoot = await realpath(options.repositoryRoot),
    artifactRoot = await realpath(options.artifactRoot),
    runId = path.basename(artifactRoot);
  assert.match(runId, id);
  assert.equal(artifactRoot, path.join(repositoryRoot, '.qa/artifacts/native-pilot', runId));
  await privateDirectory(artifactRoot);
  return { repositoryRoot, artifactRoot, runId };
}
async function unusedPorts(ports: number[]) {
  const unavailable: number[] = [];
  for (const port of [...new Set(ports)]) {
    assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
    try {
      const response = await execute('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
        timeout: 5000,
      });
      assert(response.stdout.trim(), 'Ambiguous port census');
      unavailable.push(port);
    } catch (error) {
      const e = error as { code: unknown; stdout?: string; stderr?: string };
      if (e.code !== 1 || e.stdout?.trim() || e.stderr?.trim()) throw error;
    }
  }
  return unavailable;
}
function originPort(origin: string) {
  const url = new URL(origin);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  const port = Number(url.port);
  assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
  return port;
}

async function inspectDefaultAdb(root: string, files: string[], ownedProcesses: ProcessIdentity[]) {
  const before = record(json(root, 'adb-server-before.private.json'));
  const current = await inspectAdbServer();
  if (!files.includes('adb-server-reference.private.json')) {
    // An unreturned reference still needs its recorded baseline and any published worker ledger.
    if (before.identity) requireAdbServerPreserved(before.identity as AdbServerIdentity, current);
    else assert.equal(current, null, 'Unreturned ADB reference has a survivor/replacement');
    if (files.includes('adb-server.ownership.json')) {
      const ledger = record(json(root, 'adb-server.ownership.json'));
      assert.equal(ledger.cleanup, 'cleaned');
      ownedProcesses.push(...ownershipProcesses(ledger));
    }
    assert(!files.includes('adb-server-cleanup.private.json'), 'ADB release without a reference');
    return true;
  }
  const reference = record(json(root, 'adb-server-reference.private.json'));
  const release = record(json(root, 'adb-server-cleanup.private.json'));
  assert.equal(reference.kind, 'session-wide default-port ADB reference');
  assert.equal(release.kind, reference.kind);
  assert.equal(release.mode, reference.mode);
  assert.deepEqual(release.identity, reference.identity);
  if (reference.mode === 'borrowed') {
    assert(!files.includes('adb-server.ownership.json'), 'Borrowed ADB cannot be counted as owned');
    assert.deepEqual(before.identity, reference.identity);
    assert.equal(release.cleanup, 'borrowed-preserved');
    requireAdbServerPreserved(reference.identity as AdbServerIdentity, current);
  } else {
    assert.equal(reference.mode, 'owned');
    assert.equal(before.identity, null);
    assert.equal(release.cleanup, 'owned-released');
    assert.equal(current, null, 'Owned ADB listener was replaced after release');
    const ledger = record(json(root, 'adb-server.ownership.json'));
    assert.equal(ledger.cleanup, 'cleaned');
    const rows = ownershipProcesses(ledger),
      identity = record(reference.identity);
    assert(rows.some((row) => row.pid === identity.pid && row.started === identity.started));
    ownedProcesses.push(...rows);
  }
  return true;
}

/** Read-only inspection. Missing or contradictory acquisition evidence never becomes resource absence. */
async function inspectOwnedAndroidCleanupInternal(
  options: AndroidCleanupOptions,
  provisionalCapture?: AndroidCleanupProvisionalOptions['capture'],
) {
  const { repositoryRoot, artifactRoot, runId } = await rootIdentity(options);
  const capturePublication: AndroidCleanupCapturePublication =
    provisionalCapture?.publication ?? 'published-capture-file';
  const capture = (provisionalCapture?.document ??
    json(artifactRoot, 'capture.private.json')) as Capture;
  assert.equal(
    capture.captureRunId,
    runId,
    'Android cleanup capture does not belong to the inspected attempt',
  );
  assert.equal(capture.platform, 'android');
  assert(capture.result);
  assert.equal(typeof capture.cleanup, 'string');
  const files = await readdir(artifactRoot);
  const acquisitions = requireAndroidCleanupAcquisition(
    capture,
    files,
    capture.acquisitionIntents?.map((resource) =>
      json(artifactRoot, `acquisition-${resource}.private.json`),
    ),
    runId,
    artifactRoot,
  );
  assert(capture.source && capture.sourceAfter);
  assert.deepEqual(capture.source, capture.sourceAfter);
  assert(Array.isArray(capture.helperInputsBefore) && capture.helperInputsBefore.length > 0);
  assert.deepEqual(capture.helperInputsBefore, capture.helperInputsAfter);
  assert(
    Object.hasOwn(capture, 'workspaceApkBefore') && Object.hasOwn(capture, 'workspaceApkAfter'),
  );
  assert.deepEqual(capture.workspaceApkBefore, capture.workspaceApkAfter);
  assert.deepEqual(capture.originalAvds, capture.avdsAfter);
  const captureCleanupClean = requireAndroidCaptureCleanupStatus(capture);
  const previousDevices = json(artifactRoot, 'previous-ios-devices.private.json') as SimDeviceList;
  const recordedAfter = json(artifactRoot, 'after-ios-devices.private.json') as SimDeviceList;
  // Recorded changes remain failures even when later foreign work restores the device.
  foreignDeviceChanges(previousDevices, recordedAfter);
  const ownedProcesses: ProcessIdentity[] = [],
    ports: number[] = [];
  for (const name of files.filter(
    (name) => name.endsWith('.ownership.json') || name === 'expo-ownership.json',
  )) {
    const ledger = record(json(artifactRoot, name));
    assert.equal(ledger.cleanup, 'cleaned', `Original ${name} cleanup did not pass`);
    ownedProcesses.push(...ownershipProcesses(ledger));
  }
  let directoriesAbsent = true,
    deletedOwnedDirectories = 0;
  if (acquisitions.includes('emulator')) {
    assert(
      !files.includes('android-cleanup-failure.private.json'),
      'Original Android target cleanup requires recovery',
    );
    const runtimeParent = await realpath(options.androidRuntimeParent);
    assert.equal(runtimeParent, path.resolve(options.androidRuntimeParent));
    await privateDirectory(runtimeParent);
    if (!files.includes('android-cleanup.private.json')) {
      const intent = record(json(artifactRoot, 'android-acquisition-owner.private.json'));
      assert.equal(intent.kind, 'owned Android target acquisition intent');
      assert.equal(intent.captureRunId, runId);
      assert.match(String(intent.runId), id);
      const runtimeRoot = path.join(runtimeParent, `mychampions-pilot-${String(intent.runId)}`);
      assert.equal(intent.runtimeParent, runtimeParent);
      assert.equal(intent.runtimeRoot, runtimeRoot);
      const failure = record(json(artifactRoot, 'android-preflight-failure.private.json'));
      assert.equal(
        failure.kind,
        'original Android preflight failure before target resource creation',
      );
      assert.equal(failure.runId, intent.runId);
      assert.equal(failure.captureRunId, runId);
      assert.equal(failure.runtimeRoot, runtimeRoot);
      assert.equal(capture.device, undefined);
      assert(!acquisitions.includes('backend'));
      assert(
        !files.some((name) =>
          /^android-(?:target|acquisition-failure|create-avd|emulator|adb-server)/.test(name),
        ),
      );
      directoriesAbsent = await absent(runtimeRoot);
    } else {
      const cleanup = record(json(artifactRoot, 'android-cleanup.private.json'));
      assert.equal(cleanup.status, 'cleaned');
      assert.match(String(cleanup.runId), id);
      const runtimeRoot = path.join(runtimeParent, `mychampions-pilot-${String(cleanup.runId)}`);
      assert.equal(cleanup.runtimeRoot, runtimeRoot);
      const birth = await privateDirectory(runtimeRoot),
        owner = record(json(runtimeRoot, 'owner.private.json'));
      assert.equal(owner.runId, cleanup.runId);
      assert(['owned', 'preparing'].includes(String(owner.state)));
      const rootBirth = record(owner.rootBirth);
      assert.equal(rootBirth.dev, birth.dev);
      assert.equal(rootBirth.ino, birth.ino);
      assert.equal(rootBirth.uid, birth.uid);
      assert.deepEqual(owner.identity, cleanup.identity);
      const identity = record(cleanup.identity);
      assert.equal(identity.avd, `MyChampions-Pilot-${String(cleanup.runId)}`);
      assert.match(String(identity.nonce), /^[a-f0-9]{48}$/);
      const suffixes = ['avd', 'user', 'recovery', 'logs', 'tmp', 'locks'];
      const declared = owner.directories as { value: string }[] | undefined;
      const expected = declared ? declared.map((row) => row.value) : [];
      assert.deepEqual(cleanup.deletedDirectories, expected);
      assert(expected.length <= 6);
      assert.equal(new Set(expected).size, expected.length);
      assert.deepEqual(
        expected,
        suffixes.slice(0, expected.length).map((suffix) => path.join(runtimeRoot, suffix)),
      );
      if (files.includes('android-target.private.json')) {
        const target = record(json(artifactRoot, 'android-target.private.json'));
        assert.equal(target.runId, cleanup.runId);
        assert.equal(target.runtimeRoot, runtimeRoot);
        assert.deepEqual(target.rootBirth, rootBirth);
        assert.equal(target.marker, path.join(runtimeRoot, 'owner.private.json'));
        assert.deepEqual(target.identity, cleanup.identity);
        assert.deepEqual(target.slot, cleanup.slot);
        assert.equal(expected.length, 6);
        assert(capture.device);
        assert.equal(capture.device.runId, cleanup.runId);
        assert.equal(capture.device.serial, identity.serial);
        assert.equal(capture.device.avd, identity.avd);
        assert.deepEqual(capture.device.slot, cleanup.slot);
      } else {
        assert.equal(capture.device, undefined);
        assert(!acquisitions.includes('backend'), 'Backend dispatched without an acquired target');
        const failure = record(json(artifactRoot, 'android-acquisition-failure.private.json'));
        assert.equal(failure.kind, 'original owned Android acquisition failure before cleanup');
        assert.equal(failure.runId, cleanup.runId);
        assert.deepEqual(failure.identity, cleanup.identity);
      }
      if (cleanup.slot) {
        assert.deepEqual(owner.slot, cleanup.slot);
        const slot = cleanup.slot as AndroidRunnerSlot;
        assert.equal(slot.slotId, `mychampions-pilot-${String(cleanup.runId)}`);
        assert.equal(slot.avd, identity.avd);
        for (const [field, suffix] of [
          ['avdHome', 'avd'],
          ['userHome', 'user'],
          ['recoveryRoot', 'recovery'],
          ['logRoot', 'logs'],
          ['tempRoot', 'tmp'],
          ['lockRoot', 'locks'],
        ] as const)
          assert.equal(slot[field], path.join(runtimeRoot, suffix));
        assert(
          Number.isSafeInteger(slot.emulatorPort) &&
            slot.emulatorPort >= 5554 &&
            slot.emulatorPort <= 5584 &&
            slot.emulatorPort % 2 === 0,
        );
        assert.equal(slot.emulatorSerial, `emulator-${slot.emulatorPort}`);
        assert.equal(identity.serial, slot.emulatorSerial);
        assert.equal(
          new Set([slot.emulatorPort, slot.emulatorPort + 1, slot.adbServerPort, slot.metroPort])
            .size,
          4,
        );
        ports.push(slot.emulatorPort, slot.emulatorPort + 1, slot.adbServerPort, slot.metroPort);
      }
      assert(Array.isArray(cleanup.processGroups));
      for (const pgid of cleanup.processGroups)
        assert(
          files.some(
            (name) =>
              name.endsWith('.ownership.json') && record(json(artifactRoot, name)).pgid === pgid,
          ),
          'Target group lacks original ownership ledger',
        );
      if (cleanup.reservedPorts !== undefined) {
        assert.deepEqual(owner.reservedPorts, cleanup.reservedPorts);
        const reservations = cleanup.reservedPorts as number[];
        assert(
          Array.isArray(reservations) &&
            reservations.length === 5 &&
            new Set(reservations).size === 5,
        );
        assert(
          reservations.every((port) => Number.isSafeInteger(port) && port >= 1024 && port <= 49151),
        );
        const slot = cleanup.slot as AndroidRunnerSlot;
        assert(slot);
        assert.deepEqual(reservations.slice(0, 4), [
          slot.emulatorPort,
          slot.emulatorPort + 1,
          slot.adbServerPort,
          slot.metroPort,
        ]);
        if (files.includes('android-target.private.json'))
          assert.deepEqual(
            record(json(artifactRoot, 'android-target.private.json')).reservedPorts,
            reservations,
          );
        ports.push(...reservations);
      }
      directoriesAbsent = (await Promise.all(expected.map((directory) => absent(directory)))).every(
        Boolean,
      );
      deletedOwnedDirectories = expected.length;
    }
  }
  let docker: Record<'container' | 'network' | 'volume', string[]> | null = null;
  if (acquisitions.includes('backend')) {
    const serverRoot = await realpath(path.resolve(repositoryRoot, '../server'));
    const startup = capture.backend ?? capture.backendAcquisitionFailure?.manifest;
    assert(startup, 'Dispatched backend has no acquisition manifest');
    if (!capture.backend) assert.equal(capture.backendAcquisitionFailure?.cleanup, 'cleaned');
    assert.match(startup.runId, id);
    assert.equal(startup.composeProject, `mc_test_${startup.runId}`);
    assert.equal(startup.artifactRoot, path.join(serverRoot, '.qa/runtime', startup.runId));
    const owners = record(startup).processes as (ProcessIdentity & {
      role: string;
    })[];
    const owner = owners.filter((row) => row.role === 'orchestrator');
    assert.equal(owner.length, 1);
    const manifest = validateOwnedManifest(
      await readOwnedRuntimeDocument(
        path.join(startup.artifactRoot, 'manifest.json'),
        startup.artifactRoot,
        'manifest.json',
        'resource-manifest-v1',
      ),
      {
        serverRoot,
        runId: startup.runId,
        pid: owner[0].pid,
        started: owner[0].started,
        acquiring: !capture.backend,
      },
    );
    assert.equal(manifest.phase, 'cleanup');
    ownedProcesses.push(...ownershipProcesses(startup), ...ownershipProcesses(manifest));
    if (manifest.port) ports.push(manifest.port);
    const project = `label=com.docker.compose.project=${manifest.composeProject}`;
    docker = { container: [], network: [], volume: [] };
    for (const [kind, argv] of [
      ['container', ['ps', '-aq']],
      ['network', ['network', 'ls', '-q']],
      ['volume', ['volume', 'ls', '-q']],
    ] as const)
      docker[kind] = (
        await execute('docker', [...argv, '--filter', project], {
          timeout: 10000,
        })
      ).stdout
        .trim()
        .split(/\s+/)
        .filter(Boolean);
  }
  if (acquisitions.includes('proxy'))
    ports.push(originPort(capture.proxyOrigin ?? capture.network?.apiOrigin ?? ''));
  if (capture.reservedAppPort !== undefined) ports.push(capture.reservedAppPort);
  let cacheAbsent: boolean | null = null;
  if (acquisitions.includes('expo')) {
    const cache = record(json(artifactRoot, 'expo-cache-owner.private.json'));
    assert.equal(cache.artifactRoot, artifactRoot);
    assert.equal(path.dirname(String(cache.temporaryRoot)), artifactRoot);
    assert(path.basename(String(cache.temporaryRoot)).startsWith('expo-tmp-'));
    cacheAbsent = await absent(String(cache.temporaryRoot));
    const expo = record(json(artifactRoot, 'expo-ownership.json'));
    ports.push(originPort(String(expo.appOrigin)));
  }
  const defaultAdbPreserved = acquisitions.includes('adb')
    ? await inspectDefaultAdb(artifactRoot, files, ownedProcesses)
    : true;
  const sdkRoot = await realpath(options.sdkRoot);
  assert.equal(sdkRoot, path.resolve(options.sdkRoot));
  const currentAvds = (
    await execute(path.join(sdkRoot, 'emulator/emulator'), ['-list-avds'], {
      timeout: 10000,
    })
  ).stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
  assert(
    Array.isArray(capture.originalAvds) &&
      capture.originalAvds.every((row) => typeof row === 'string'),
  );
  const foreignAvdsPreserved = JSON.stringify(capture.originalAvds) === JSON.stringify(currentAvds);
  const currentDevices = JSON.parse(
    (
      await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
        timeout: 15000,
      })
    ).stdout,
  ) as SimDeviceList;
  const ps = await execute('ps', ['-axo', 'pid=,lstart='], {
    timeout: 10000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  const liveProcesses = parseProcesses(ps.stdout);
  assert(liveProcesses.some((row) => row.pid === process.pid));
  assert.equal(
    new Set(liveProcesses.map((row) => row.pid)).size,
    liveProcesses.length,
    'Duplicate live process identity',
  );
  const evaluated = evaluateOwnedAndroidCleanup({
    runId,
    captureResult: capture.result,
    captureCleanupClean,
    acquisitions,
    ownedProcesses,
    liveProcesses,
    previousDevices,
    recordedDevices: recordedAfter,
    currentDevices,
    directoriesAbsent,
    cacheAbsent,
    defaultAdbPreserved,
    foreignAvdsPreserved,
    unavailablePorts: await unusedPorts(ports),
    docker,
  });
  return {
    ...evaluated,
    censusStatus: 'available' as const,
    originalCaptureCleanup: capture.cleanup,
    originalCaptureCleanupFailures: [...capture.cleanupFailures],
    capturePublication,
    deletedOwnedDirectories,
    scope:
      'capture-owned resources only; source/build freshness and outer controller terminal audit are separate',
    finishedAt: new Date().toISOString(),
  };
}

export async function inspectOwnedAndroidCleanup(options: AndroidCleanupOptions) {
  return inspectOwnedAndroidCleanupInternal(options);
}

/** One private receipt, including unavailable census. It never repairs or overwrites original outcomes. */
async function verifyOwnedAndroidCleanupInternal(
  options: AndroidCleanupOptions,
  provisionalCapture?: AndroidCleanupProvisionalOptions['capture'],
) {
  const { artifactRoot, runId } = await rootIdentity(options);
  let result:
    | Awaited<ReturnType<typeof inspectOwnedAndroidCleanupInternal>>
    | {
        kind: string;
        result: 'failed';
        runId: string;
        censusStatus: 'unavailable';
        nativePassingCases: 0;
        capturePublication: AndroidCleanupCapturePublication;
        finishedAt: string;
      };
  try {
    result = await inspectOwnedAndroidCleanupInternal(options, provisionalCapture);
  } catch {
    result = {
      kind: 'independent android native cleanup proof',
      result: 'failed',
      runId,
      censusStatus: 'unavailable',
      nativePassingCases: 0,
      capturePublication: provisionalCapture?.publication ?? 'published-capture-file',
      finishedAt: new Date().toISOString(),
    };
  }
  const verifyOwnedWrite = async (
    target: string,
    expected: Buffer,
    label: string,
    maxBytes: number,
  ): Promise<Buffer> => {
    assert.equal(await realpath(target), target, `${label} is not canonical`);
    const before = await lstat(target);
    assert(
      before.isFile() && !before.isSymbolicLink() && before.nlink === 1,
      `${label} is not a single-link regular file`,
    );
    assert.equal(before.uid, process.getuid?.(), `${label} owner changed`);
    assert.equal(before.mode & 0o777, 0o600, `${label} mode is not private`);
    assert(before.size > 0 && before.size <= maxBytes, `${label} exceeds its byte cap`);
    const bytes = await readFile(target);
    const after = await lstat(target);
    assert.equal(bytes.byteLength, expected.byteLength, `${label} changed while reading`);
    assert.equal(bytes.byteLength, before.size, `${label} stat size changed`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      createHash('sha256').update(expected).digest('hex'),
      `${label} bytes changed`,
    );
    assert.equal(after.dev, before.dev, `${label} device changed while reading`);
    assert.equal(after.ino, before.ino, `${label} inode changed while reading`);
    assert.equal(await realpath(target), target, `${label} path changed while reading`);
    assert.equal(after.uid, before.uid, `${label} owner changed while reading`);
    assert.equal(after.mode & 0o777, before.mode & 0o777, `${label} mode changed while reading`);
    assert.equal(after.size, before.size, `${label} size changed while reading`);
    assert.equal(after.mtimeMs, before.mtimeMs, `${label} timestamp changed while reading`);
    assert.equal(after.nlink, 1, `${label} link count changed while reading`);
    return bytes;
  };
  const cleanupPath = path.join(artifactRoot, 'external-cleanup.private.json');
  const cleanupBytes = Buffer.from(JSON.stringify(result, null, 2));
  await writeFile(cleanupPath, cleanupBytes, { flag: 'wx', mode: 0o600 });
  await verifyOwnedWrite(cleanupPath, cleanupBytes, 'Android cleanup receipt', 32 * 1024 * 1024);
  const cleanupMetadata = await lstat(cleanupPath);
  const cleanupReceipt = {
    path: 'external-cleanup.private.json',
    kind: 'sidecar' as const,
    sizeBytes: cleanupBytes.byteLength,
    sha256: createHash('sha256').update(cleanupBytes).digest('hex'),
    ownerUid: cleanupMetadata.uid,
    mode: cleanupMetadata.mode & 0o777,
    verification: 'owned-stable-reader-v6' as const,
  };
  const receiptEnvelope = {
    kind: 'private-owned-android-cleanup-receipt',
    runId,
    receipt: cleanupReceipt,
  };
  const receiptSidecarPath = path.join(artifactRoot, 'external-cleanup-receipt.private.json');
  const receiptSidecarBytes = Buffer.from(JSON.stringify(receiptEnvelope, null, 2));
  await writeFile(receiptSidecarPath, receiptSidecarBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  const receiptSidecarRead = await verifyOwnedWrite(
    receiptSidecarPath,
    receiptSidecarBytes,
    'Android cleanup receipt sidecar',
    1024 * 1024,
  );
  const receiptSidecarValue = JSON.parse(receiptSidecarRead.toString('utf8')) as Record<
    string,
    unknown
  >;
  assert.equal(receiptSidecarValue.kind, receiptEnvelope.kind);
  assert.equal(receiptSidecarValue.runId, runId);
  assert.deepEqual(receiptSidecarValue.receipt, cleanupReceipt);
  return { ...result, androidCleanupReceipt: cleanupReceipt };
}

export async function verifyOwnedAndroidCleanup(options: AndroidCleanupOptions) {
  return verifyOwnedAndroidCleanupInternal(options);
}

export async function verifyOwnedAndroidCleanupBeforeCapturePublication(
  options: AndroidCleanupProvisionalOptions,
) {
  assert.equal(
    options.capture?.publication,
    'provisional-before-capture-publication',
    'Android cleanup publication must be provisional before capture publication',
  );
  const { artifactRoot, runId } = await rootIdentity(options);
  const captureDocument = record(options.capture?.document);
  assert.equal(
    captureDocument.captureRunId,
    runId,
    'Provisional cleanup capture does not belong to the inspected attempt',
  );
  const capturePath = path.join(artifactRoot, 'capture.private.json');
  try {
    await lstat(capturePath);
    throw new Error('Android camera cleanup provisional view requires an unpublished capture');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const provisionalCapture = {
    document: deepFreeze(record(structuredClone(captureDocument))),
    publication: 'provisional-before-capture-publication' as const,
  };
  return verifyOwnedAndroidCleanupInternal(options, provisionalCapture);
}

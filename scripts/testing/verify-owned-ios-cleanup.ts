import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import {
  devices,
  processSurvivors,
  parseProcesses,
  ownershipProcesses,
} from './native-cleanup-evidence';
import { readNativeEvidence } from './native-view-evidence';
import { inspectAdbServer, requireAdbServerPreserved } from './owned-adb-server';
import {
  evaluatePartialBackendIosCleanup,
  processCensusFailureReason,
  requirePartialBackendIosAcquisition,
  requireNotAcquiredBackendIosAcquisition,
} from './partial-backend-boundary';
import type { ProcessIdentity, SimDeviceList } from './native-cleanup-evidence';
import type { AdbServerIdentity } from './owned-adb-server';
import type { PartialBackendProcessCensus } from './partial-backend-boundary';

const execute = promisify(execFile);
const id = /^[a-f0-9]{24}$/;

function isSafePrivateArtifactRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 160 &&
    value !== '.' &&
    value !== '..' &&
    !value.startsWith('../') &&
    !path.isAbsolute(value) &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  );
}

function assertCleanupLifecycleFence(
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number | undefined,
  label: string,
): void {
  signal?.throwIfAborted();
  if (deadlineAtMonotonicMs !== undefined && performance.now() >= deadlineAtMonotonicMs)
    throw new Error(`T16 outer cleanup deadline reached during ${label}`);
}

type CleanupLifecycleOptions = {
  signal?: AbortSignal;
  deadlineAtMonotonicMs?: number;
};
type CleanupInput = {
  runId: string;
  captureResult: string;
  captureCleanupClean: boolean;
  ownedProcesses: ProcessIdentity[];
  liveProcesses: ProcessIdentity[];
  previousDevices: SimDeviceList;
  currentDevices: SimDeviceList;
  ownedDeviceId: string;
  cacheAbsent: boolean;
  docker: Record<'container' | 'network' | 'volume', string[]>;
};

/** An explicit prefix plus exclusive intent files proves these later acquisitions were never dispatched. */
export function requireBeforeBackendIosAcquisition(
  capture: {
    acquisitionIntents?: unknown;
    backend?: unknown;
    commandExecutions?: unknown;
  },
  files: readonly string[],
  intents: unknown[],
  runId: string,
) {
  assert.match(runId, id);
  assert.deepEqual(capture.acquisitionIntents, ['adb', 'simulator']);
  assert.equal(capture.backend, undefined);
  assert.deepEqual(capture.commandExecutions, []);
  assert.equal(intents.length, 2);
  for (const [index, resource] of ['adb', 'simulator'].entries()) {
    assert(files.includes(`acquisition-${resource}.private.json`));
    const row = intents[index] as Record<string, unknown>;
    assert.equal(row.schemaVersion, 1);
    assert.equal(row.kind, 'owned iOS acquisition intent');
    assert.equal(row.runId, runId);
    assert.equal(row.resource, resource);
    assert.deepEqual(row.previous, index === 0 ? [] : ['adb']);
    assert(typeof row.startedAt === 'string' && !Number.isNaN(Date.parse(row.startedAt)));
  }
  assert(
    !files.some((name) =>
      /^(?:acquisition-(?:backend|proxy|expo)\.private\.json|expo-|build\.)/.test(name),
    ),
    'Later native resource evidence contradicts the early acquisition boundary',
  );
  assert(
    !files.some(
      (name) =>
        name === 'ios-build' ||
        (name.endsWith('.ownership.json') && name !== 'adb-server.ownership.json'),
    ),
    'An engine process was recorded outside the early acquisition boundary',
  );
}

/** Exact evidence boundary for a capture that dispatched no native resource. */
export function requireZeroAcquisitionIosPreflight(
  capture: {
    result?: unknown;
    cleanup?: unknown;
    acquisitionIntents?: unknown;
    backend?: unknown;
    device?: unknown;
    reservedPorts?: unknown;
    proxyOrigin?: unknown;
    commandExecutions?: unknown;
  },
  files: readonly string[],
  runId: string,
) {
  assert.match(runId, id);
  assert.equal(capture.result === 'harness-blocked' || capture.result === 'cancelled', true);
  assert.deepEqual(capture.acquisitionIntents, []);
  assert.equal(capture.cleanup, 'not-acquired');
  assert.equal(capture.backend, undefined);
  assert.equal(capture.device, undefined);
  assert.equal(capture.reservedPorts, undefined);
  assert.equal(capture.proxyOrigin, undefined);
  if (capture.commandExecutions !== undefined) assert.deepEqual(capture.commandExecutions, []);
  assert(
    !files.some(
      (name) =>
        name.startsWith('acquisition-') ||
        name.endsWith('.ownership.json') ||
        /^(?:adb-server(?:[.-]|$)|backend(?:[.-]|$)|build(?:[.-]|$)|expo-|ios-build(?:[.-]|$)|proxy(?:[.-]|$)|simulator-owner(?:[.-]|$)|simulator-cleanup(?:[.-]|$))/.test(
          name,
        ),
    ),
    'Zero-acquisition capture contains later resource evidence',
  );
}

export function evaluateZeroAcquisitionIosCleanup(input: {
  runId: string;
  captureResult: string;
  captureCleanup: string;
  afterStateStatus: 'observed' | 'unknown';
  hostCensusStatus: 'available' | 'unknown';
  noResourceEvidence: boolean;
  sourceStable: boolean;
  helperStable: boolean;
  devicesStable: boolean;
  foreignDeviceChanges: string[];
}) {
  assert.match(input.runId, id);
  assert(typeof input.captureResult === 'string' && input.captureResult.length > 0);
  const failureReasons: string[] = [];
  if (input.captureCleanup !== 'not-acquired') failureReasons.push('capture-cleanup-not-acquired');
  if (input.afterStateStatus !== 'observed') failureReasons.push('after-state-unknown');
  if (input.hostCensusStatus !== 'available') failureReasons.push('host-census-unknown');
  if (!input.noResourceEvidence) failureReasons.push('resource-evidence-present');
  if (!input.sourceStable) failureReasons.push('source-after-mismatch-or-unknown');
  if (!input.helperStable) failureReasons.push('helper-after-mismatch-or-unknown');
  if (!input.devicesStable) failureReasons.push('ios-device-after-mismatch-or-unknown');
  return {
    kind: 'independent ios zero-acquisition cleanup proof',
    scope: 'zero acquisition; no native/backend resource cleanup was required',
    runId: input.runId,
    captureResult: input.captureResult,
    captureCleanup: input.captureCleanup,
    captureCleanupClean: false,
    acquisitionIntents: [],
    pidStartPairs: 0,
    survivors: [] as number[],
    unknownProcessQueries: [] as number[],
    foreignDeviceChanges: [...input.foreignDeviceChanges].sort(),
    missingForeignDevices: [...input.foreignDeviceChanges].sort(),
    ownedDeviceAbsent: null,
    cacheAbsent: null,
    docker: null,
    censusStatus: input.hostCensusStatus,
    hostCensusStatus: input.hostCensusStatus,
    failureReasons,
    result: failureReasons.length === 0 ? ('passed' as const) : ('failed' as const),
  };
}

/**
 * A camera acquisition can fail after a resource was returned or after a
 * lower-level helper spawned a process but before it returned an owner
 * handle. This boundary consumes the durable partial ledger and deliberately
 * stays failed: an incomplete acquisition is not a cleanup pass, even when a
 * subset of known handles reported stopped.
 */
export function evaluatePartialDetoxCameraCleanup(input: {
  runId: string;
  capture: {
    result?: unknown;
    acquisitionIntents?: unknown;
    acquisitionSequence?: unknown;
    acquisitionFailure?: unknown;
    backendAcquisitionFailure?: unknown;
    cleanup?: unknown;
    preflight?: unknown;
    resourceStates?: unknown;
    cleanupAggregate?: unknown;
    postChild?: unknown;
  };
  files: readonly string[];
}) {
  const failureReasons: string[] = [];
  if (!id.test(input.runId)) failureReasons.push('run-id-invalid');
  if (input.capture.result !== 'harness-blocked' && input.capture.result !== 'cancelled')
    failureReasons.push('partial-result-invalid');
  const intents = input.capture.acquisitionIntents;
  if (
    !Array.isArray(intents) ||
    intents.length === 0 ||
    intents.some((resource) => typeof resource !== 'string' || resource.length === 0)
  )
    failureReasons.push('acquisition-intents-invalid');
  const sequence = input.capture.acquisitionSequence;
  const intentList = Array.isArray(intents) ? intents : [];
  if (
    !Array.isArray(sequence) ||
    sequence.some((resource) => !intentList.includes(resource)) ||
    sequence.length > intentList.length ||
    sequence.some((resource, index) => intentList[index] !== resource) ||
    new Set(sequence).size !== sequence.length
  )
    failureReasons.push('acquisition-sequence-invalid');
  const cleanup = input.capture.cleanup;
  if (!cleanup || typeof cleanup !== 'object' || Array.isArray(cleanup)) {
    failureReasons.push('partial-cleanup-object-missing');
  } else {
    const row = cleanup as Record<string, unknown>;
    if (row.status !== 'failed-recovery-retained')
      failureReasons.push('partial-cleanup-not-recovery-retained');
    if (!Array.isArray(row.resources)) failureReasons.push('partial-cleanup-resources-missing');
    if (!row.aggregate || typeof row.aggregate !== 'object' || Array.isArray(row.aggregate))
      failureReasons.push('partial-cleanup-aggregate-missing');
    if (!Array.isArray(row.unknownResources))
      failureReasons.push('partial-cleanup-unknown-resources-missing');
  }
  let preflightCleanup: 'not-present' | 'cleaned' | 'uncertain' = 'not-present';
  // Successful camera captures serialize the optional failed-preflight row as null. Treat both null and omitted as no preflight evidence; only an object is validated here.
  if (input.capture.preflight !== undefined && input.capture.preflight !== null) {
    if (
      !input.capture.preflight ||
      typeof input.capture.preflight !== 'object' ||
      Array.isArray(input.capture.preflight)
    ) {
      failureReasons.push('preflight-receipt-invalid');
    } else {
      const preflight = input.capture.preflight as Record<string, unknown>;
      if (preflight.resource !== 'detox-jest-list-tests')
        failureReasons.push('preflight-resource-invalid');
      if (preflight.cleanup === 'cleaned') preflightCleanup = 'cleaned';
      else if (preflight.cleanup === 'uncertain') {
        preflightCleanup = 'uncertain';
        failureReasons.push('preflight-cleanup-uncertain');
      } else failureReasons.push('preflight-cleanup-state-invalid');
      if (
        !preflight.execution ||
        typeof preflight.execution !== 'object' ||
        Array.isArray(preflight.execution)
      )
        failureReasons.push('preflight-execution-missing');
    }
  }
  if (!input.capture.acquisitionFailure || typeof input.capture.acquisitionFailure !== 'object')
    failureReasons.push('acquisition-failure-missing');
  else {
    const acquisitionFailure = input.capture.acquisitionFailure as Record<string, unknown>;
    if (acquisitionFailure.artifactPathsLexicallyValidated !== true)
      failureReasons.push('native-artifact-path-lexical-validation-missing');
    for (const field of ['logPath', 'stdoutPath', 'ownershipPath'] as const) {
      const value = acquisitionFailure[field];
      if (value !== null && !isSafePrivateArtifactRelativePath(value))
        failureReasons.push(`native-artifact-${field}-invalid`);
    }
  }
  if (!Array.isArray(input.capture.resourceStates)) failureReasons.push('resource-states-missing');
  if (
    !input.capture.cleanupAggregate ||
    typeof input.capture.cleanupAggregate !== 'object' ||
    Array.isArray(input.capture.cleanupAggregate)
  )
    failureReasons.push('cleanup-aggregate-missing');
  if (!input.capture.postChild || typeof input.capture.postChild !== 'object')
    failureReasons.push('post-child-outcome-missing');
  if (!input.files.includes('capture.private.json')) failureReasons.push('capture-ledger-missing');
  const captureResult = typeof input.capture.result === 'string' ? input.capture.result : 'unknown';
  const captureCleanup =
    cleanup && typeof cleanup === 'object' && !Array.isArray(cleanup)
      ? typeof (cleanup as Record<string, unknown>).status === 'string'
        ? (cleanup as Record<string, unknown>).status
        : 'unknown'
      : typeof cleanup === 'string'
        ? cleanup
        : 'unknown';
  const resourceStates = Array.isArray(input.capture.resourceStates)
    ? (input.capture.resourceStates as unknown[])
    : [];
  const acquisitionIntents = Array.isArray(intents)
    ? intents.filter((resource): resource is string => typeof resource === 'string')
    : [];
  const acquisitionSequence = Array.isArray(sequence)
    ? sequence.filter((resource): resource is string => typeof resource === 'string')
    : [];
  return {
    kind: 'independent ios partial Detox camera acquisition recovery proof',
    scope: 'partial owned camera acquisition; no cleanup promotion',
    runId: input.runId,
    captureResult,
    captureCleanup,
    captureCleanupClean: false,
    preflightCleanup,
    preflightCleanupClean: preflightCleanup === 'cleaned',
    recoveryVerified: false,
    acquisitionIntents,
    acquisitionSequence,
    resourceStates,
    unknownProcessQueries:
      input.capture.acquisitionFailure &&
      typeof input.capture.acquisitionFailure === 'object' &&
      Number.isSafeInteger((input.capture.acquisitionFailure as { pid?: unknown }).pid)
        ? [(input.capture.acquisitionFailure as { pid: number }).pid]
        : [],
    failureReasons,
    result: 'failed' as const,
    reason:
      'A complete owner proof is required before partial camera acquisition cleanup can be classified as cleaned',
  };
}

export function evaluateBeforeBackendIosCleanup(input: {
  runId: string;
  captureResult: string;
  captureCleanupClean: boolean;
  ownedProcesses: ProcessIdentity[];
  liveProcesses: ProcessIdentity[];
  previousDevices: SimDeviceList;
  currentDevices: SimDeviceList;
  ownedDeviceId: string;
  adbPreserved: boolean;
  unavailablePorts: number[];
}) {
  assert.match(input.runId, id);
  assert(input.captureResult && typeof input.captureResult === 'string');
  assert.equal(typeof input.captureCleanupClean, 'boolean');
  assert.equal(typeof input.adbPreserved, 'boolean');
  assert(
    input.unavailablePorts.every(
      (port) => Number.isSafeInteger(port) && port >= 1024 && port <= 65535,
    ),
  );
  const census = processSurvivors(input.ownedProcesses, input.liveProcesses);
  const before = devices(input.previousDevices);
  const after = devices(input.currentDevices);
  assert(!before.has(input.ownedDeviceId));
  const missingForeignDevices = [...before]
    .filter(([key, state]) => after.get(key) !== state)
    .map(([key]) => key);
  const ownedDeviceAbsent = !after.has(input.ownedDeviceId);
  return {
    kind: 'independent ios before-backend cleanup proof',
    scope: 'adb-and-simulator-only; backend/proxy/expo/build were not dispatched',
    runId: input.runId,
    captureResult: input.captureResult,
    captureCleanupClean: input.captureCleanupClean,
    ...census,
    unknownProcessQueries: [] as number[],
    missingForeignDevices,
    ownedDeviceAbsent,
    adbPreserved: input.adbPreserved,
    unavailablePorts: input.unavailablePorts,
    result:
      input.captureCleanupClean &&
      census.survivors.length === 0 &&
      missingForeignDevices.length === 0 &&
      ownedDeviceAbsent &&
      input.adbPreserved &&
      input.unavailablePorts.length === 0
        ? 'passed'
        : 'failed',
  };
}

/** Pure fail-closed comparison; a current PID alone never proves an owned survivor. */
export function evaluateOwnedIosCleanup(input: CleanupInput) {
  assert.match(input.runId, id);
  assert(typeof input.captureResult === 'string' && input.captureResult.length > 0);
  assert.equal(typeof input.captureCleanupClean, 'boolean');
  assert(input.ownedProcesses.length > 0, 'Owned process census is absent');
  for (const row of input.ownedProcesses) {
    assert(Number.isSafeInteger(row.pid) && row.pid > 1);
    assert(typeof row.started === 'string' && !Number.isNaN(Date.parse(row.started)));
  }
  for (const row of input.liveProcesses) {
    assert(Number.isSafeInteger(row.pid) && row.pid > 0);
    assert(typeof row.started === 'string' && !Number.isNaN(Date.parse(row.started)));
  }
  const expected = new Map(
    input.ownedProcesses.map((row) => [`${row.pid}:${row.started}`, row] as const),
  );
  const live = new Set(input.liveProcesses.map((row) => `${row.pid}:${row.started}`));
  const survivors = [...expected.values()]
    .filter((row) => live.has(`${row.pid}:${row.started}`))
    .map((row) => row.pid)
    .sort((a, b) => a - b);
  const before = devices(input.previousDevices);
  const after = devices(input.currentDevices);
  assert(!before.has(input.ownedDeviceId), 'Owned simulator existed before acquisition');
  const missingForeignDevices = [...before]
    .filter(([udid, state]) => after.get(udid) !== state)
    .map(([udid]) => udid)
    .sort();
  for (const kind of ['container', 'network', 'volume'] as const)
    assert(Array.isArray(input.docker[kind]));
  const ownedDeviceAbsent = !after.has(input.ownedDeviceId);
  const result =
    input.captureCleanupClean &&
    survivors.length === 0 &&
    missingForeignDevices.length === 0 &&
    ownedDeviceAbsent &&
    input.cacheAbsent &&
    Object.values(input.docker).every((rows) => rows.length === 0)
      ? 'passed'
      : 'failed';
  return {
    kind: 'independent ios native inventory cleanup proof',
    result,
    runId: input.runId,
    captureResult: input.captureResult,
    captureCleanupClean: input.captureCleanupClean,
    pidStartPairs: expected.size,
    survivors,
    unknownProcessQueries: [] as number[],
    missingForeignDevices,
    ownedDeviceAbsent,
    cacheAbsent: input.cacheAbsent,
    docker: input.docker,
  };
}

function json(root: string, relative: string): unknown {
  return JSON.parse(readNativeEvidence(root, relative, true).toString());
}

async function inspectZeroAcquisitionIosCleanup(
  artifactRoot: string,
  runId: string,
  capture: {
    result: string;
    cleanup: unknown;
    acquisitionIntents?: unknown;
    backend?: unknown;
    device?: unknown;
    reservedPorts?: unknown;
    proxyOrigin?: unknown;
    commandExecutions?: unknown;
    preflightAfterState?: unknown;
    source?: unknown;
    sourceAfter?: unknown;
    helperInputsBefore?: unknown;
    helperInputsAfter?: unknown;
  },
) {
  const files = await readdir(artifactRoot);
  let noResourceEvidence = true;
  try {
    requireZeroAcquisitionIosPreflight(capture, files, runId);
  } catch {
    noResourceEvidence = false;
  }
  const sourceStable =
    capture.source !== undefined &&
    capture.sourceAfter !== undefined &&
    capture.sourceAfter !== null &&
    (() => {
      try {
        assert.deepEqual(capture.source, capture.sourceAfter);
        return true;
      } catch {
        return false;
      }
    })();
  const helperStable =
    Array.isArray(capture.helperInputsBefore) &&
    capture.helperInputsBefore.length > 0 &&
    Array.isArray(capture.helperInputsAfter) &&
    (() => {
      try {
        assert.deepEqual(capture.helperInputsBefore, capture.helperInputsAfter);
        return true;
      } catch {
        return false;
      }
    })();
  let devicesStable = false;
  let foreignDeviceChanges: string[] = [];
  try {
    const previous = devices(
      json(artifactRoot, 'previous-ios-devices.private.json') as SimDeviceList,
    );
    const current = devices(json(artifactRoot, 'after-ios-devices.private.json') as SimDeviceList);
    const all = new Set([...previous.keys(), ...current.keys()]);
    foreignDeviceChanges = [...all]
      .filter((udid) => previous.get(udid) !== current.get(udid))
      .sort();
    devicesStable = foreignDeviceChanges.length === 0;
  } catch {
    devicesStable = false;
  }
  let hostCensusStatus: 'available' | 'unknown' = 'unknown';
  try {
    const census = json(artifactRoot, 'native-host-census.private.json') as {
      kind?: unknown;
      status?: unknown;
      knownJobs?: unknown;
    };
    assert.equal(census.kind, 'native-host-known-job-census');
    assert.equal(census.status, 'no-known-job');
    assert(Array.isArray(census.knownJobs) && census.knownJobs.length === 0);
    hostCensusStatus = 'available';
  } catch {
    hostCensusStatus = 'unknown';
  }
  return {
    ...evaluateZeroAcquisitionIosCleanup({
      runId,
      captureResult: capture.result,
      captureCleanup: String(capture.cleanup),
      afterStateStatus: capture.preflightAfterState === 'observed' ? 'observed' : 'unknown',
      hostCensusStatus,
      noResourceEvidence,
      sourceStable,
      helperStable,
      devicesStable,
      foreignDeviceChanges,
    }),
    finishedAt: new Date().toISOString(),
  };
}

export async function inspectPartialDetoxCameraCleanup(
  artifactRoot: string,
  runId: string,
  capture: Parameters<typeof evaluatePartialDetoxCameraCleanup>[0]['capture'],
  lifecycle: CleanupLifecycleOptions = {},
) {
  assertCleanupLifecycleFence(
    lifecycle.signal,
    lifecycle.deadlineAtMonotonicMs,
    'partial cleanup file census start',
  );
  const files = await readdir(artifactRoot);
  assertCleanupLifecycleFence(
    lifecycle.signal,
    lifecycle.deadlineAtMonotonicMs,
    'partial cleanup file census complete',
  );
  return {
    ...evaluatePartialDetoxCameraCleanup({ runId, capture, files }),
    finishedAt: new Date().toISOString(),
  };
}

async function inspectBeforeBackendIosCleanup(
  artifactRoot: string,
  runId: string,
  capture: {
    result: string;
    cleanup: unknown;
    acquisitionIntents?: unknown;
    backend?: unknown;
    backendAcquisitionFailure?: unknown;
    commandExecutions?: unknown;
    reservedPorts?: number[];
  },
  serverRoot: string,
  lifecycle: CleanupLifecycleOptions,
) {
  const checkedAwait = async <T>(operation: () => Promise<T>, label: string): Promise<T> => {
    assertCleanupLifecycleFence(lifecycle.signal, lifecycle.deadlineAtMonotonicMs, label);
    const value = await operation();
    assertCleanupLifecycleFence(lifecycle.signal, lifecycle.deadlineAtMonotonicMs, label);
    return value;
  };
  const checkedExecute = async (
    file: string,
    args: readonly string[],
    options: Parameters<typeof execute>[2],
    label: string,
  ) => {
    assertCleanupLifecycleFence(lifecycle.signal, lifecycle.deadlineAtMonotonicMs, label);
    const value = await execute(file, [...args], {
      ...options,
      ...(lifecycle.signal ? { signal: lifecycle.signal } : {}),
    });
    assertCleanupLifecycleFence(lifecycle.signal, lifecycle.deadlineAtMonotonicMs, label);
    return value;
  };
  const files = await checkedAwait(() => readdir(artifactRoot), 'before-backend file census');
  const acquisitionFailure =
    capture.backendAcquisitionFailure && typeof capture.backendAcquisitionFailure === 'object'
      ? (capture.backendAcquisitionFailure as Record<string, unknown>)
      : undefined;
  const partial =
    acquisitionFailure?.acquisitionPhase === 'spawned' &&
    acquisitionFailure.orchestrator &&
    typeof acquisitionFailure.orchestrator === 'object' &&
    (acquisitionFailure.orchestrator as Record<string, unknown>).status === 'verified' &&
    Number.isSafeInteger(acquisitionFailure.pid) &&
    acquisitionFailure.cleanup === 'failed-recovery-ledger-retained';
  const preSpawn = acquisitionFailure?.acquisitionPhase === 'pre-spawn';
  if (acquisitionFailure && !partial && !preSpawn)
    throw new Error('Backend acquisition failure lacks a verified phase boundary');
  const intentNames = partial || preSpawn ? ['adb', 'simulator', 'backend'] : ['adb', 'simulator'];
  const intents = intentNames.map((resource) =>
    json(artifactRoot, `acquisition-${resource}.private.json`),
  );
  const partialOwner = partial
    ? requirePartialBackendIosAcquisition(capture, files, intents, runId, serverRoot)
    : undefined;
  if (preSpawn) requireNotAcquiredBackendIosAcquisition(capture, files, intents, runId);
  else if (!partial) requireBeforeBackendIosAcquisition(capture, files, intents, runId);
  const original = json(artifactRoot, 'capture.private.json') as {
    source: unknown;
    sourceAfter: unknown;
    helperInputsBefore: unknown[];
    helperInputsAfter: unknown[];
  };
  assert(original.source && original.sourceAfter);
  assert.deepEqual(original.source, original.sourceAfter);
  assert(original.helperInputsBefore.length > 0);
  assert.deepEqual(original.helperInputsBefore, original.helperInputsAfter);
  const previousDevices = json(artifactRoot, 'previous-ios-devices.private.json') as SimDeviceList;
  const owner = json(artifactRoot, 'simulator-owner.private.json') as {
    artifactRoot: string;
    uid: number;
    state: string;
    previousDevices: string[];
    name: string;
    runtime: string;
    deviceTypeIdentifier: string;
    identity: {
      udid: string;
      name: string;
      runtime: string;
      deviceTypeIdentifier: string;
    };
  };
  const simulatorCleanup = json(artifactRoot, 'simulator-cleanup.json') as {
    status: string;
    identity: unknown;
    foreignDevicesPreserved: string[];
  };
  assert.equal(owner.artifactRoot, artifactRoot);
  assert.equal(owner.uid, process.getuid?.());
  assert.equal(owner.state, 'owned');
  assert.match(owner.identity.udid, /^[A-Fa-f0-9-]{36}$/);
  assert.match(owner.identity.name, /^MyChampions-Pilot-[a-f0-9]{24}$/);
  assert.equal(owner.identity.name, owner.name);
  assert.equal(owner.identity.runtime, owner.runtime);
  assert.equal(owner.identity.deviceTypeIdentifier, owner.deviceTypeIdentifier);
  assert.deepEqual([...owner.previousDevices].sort(), [...devices(previousDevices).keys()].sort());
  assert.equal(simulatorCleanup.status, 'cleaned');
  assert.deepEqual(simulatorCleanup.identity, owner.identity);
  assert.deepEqual(simulatorCleanup.foreignDevicesPreserved, owner.previousDevices);
  const before = json(artifactRoot, 'adb-server-before.private.json') as {
    identity: AdbServerIdentity | null;
  };
  const reference = json(artifactRoot, 'adb-server-reference.private.json') as {
    mode: string;
    identity: AdbServerIdentity;
  };
  const release = json(artifactRoot, 'adb-server-cleanup.private.json') as {
    mode: string;
    identity: AdbServerIdentity;
    cleanup: string;
  };
  assert.deepEqual(release.identity, reference.identity);
  assert.equal(release.mode, reference.mode);
  const currentAdb = await checkedAwait(() => inspectAdbServer(), 'ADB cleanup census');
  const ownedProcesses = files.includes('adb-server.ownership.json')
    ? ownershipProcesses(json(artifactRoot, 'adb-server.ownership.json'))
    : [];
  if (reference.mode === 'borrowed') {
    assert.equal(ownedProcesses.length, 0, 'Borrowed ADB cannot be counted as owned');
    assert.deepEqual(before.identity, reference.identity);
    assert.equal(release.cleanup, 'borrowed-preserved');
    requireAdbServerPreserved(reference.identity, currentAdb);
  } else {
    assert.equal(reference.mode, 'owned');
    assert.equal(before.identity, null);
    assert.equal(release.cleanup, 'owned-released');
    assert.equal(currentAdb, null, 'ADB was replaced after owned release');
    assert(
      ownedProcesses.some(
        (row) => row.pid === reference.identity.pid && row.started === reference.identity.started,
      ),
    );
  }
  assert(
    Array.isArray(capture.reservedPorts) &&
      capture.reservedPorts.length >= 1 &&
      capture.reservedPorts.length <= 2,
  );
  assert.equal(new Set(capture.reservedPorts).size, capture.reservedPorts.length);
  const unavailablePorts: number[] = [];
  for (const port of capture.reservedPorts) {
    assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
    try {
      const listeners = await checkedExecute(
        'lsof',
        ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'],
        { timeout: 5000 },
        `before-backend port census ${port}`,
      );
      assert(String(listeners.stdout).trim(), 'Port census returned an ambiguous result');
      unavailablePorts.push(port);
    } catch (error) {
      const row = error as { code?: unknown; stdout?: string; stderr?: string };
      if (row.code !== 1 || row.stdout?.trim() || row.stderr?.trim()) throw error;
    }
  }
  let processCensus: PartialBackendProcessCensus | undefined;
  let liveProcesses: ProcessIdentity[] = [];
  try {
    const ps = await checkedExecute(
      'ps',
      ['-axo', 'pid=,lstart='],
      {
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, LC_ALL: 'C' },
      },
      'before-backend process census',
    );
    liveProcesses = parseProcesses(String(ps.stdout));
    processCensus = { status: 'observed', liveProcesses };
  } catch (error) {
    if (!partial) throw error;
    processCensus = {
      status: 'unknown',
      reason: processCensusFailureReason(error),
    };
  }
  const currentDevices = JSON.parse(
    String(
      (
        await checkedExecute(
          'xcrun',
          ['simctl', 'list', 'devices', '--json'],
          { timeout: 15_000 },
          'before-backend simulator census',
        )
      ).stdout,
    ),
  ) as SimDeviceList;
  assertCleanupLifecycleFence(
    lifecycle.signal,
    lifecycle.deadlineAtMonotonicMs,
    'before-backend cleanup completion',
  );
  return {
    ...(partial
      ? evaluatePartialBackendIosCleanup({
          runId,
          captureResult: capture.result,
          captureCleanup:
            capture.cleanup && typeof capture.cleanup === 'object'
              ? String((capture.cleanup as { status?: unknown }).status)
              : String(capture.cleanup),
          owner: partialOwner!,
          processCensus: processCensus,
          previousDevices,
          currentDevices,
          ownedDeviceId: owner.identity.udid,
          adbPreserved: true,
          unavailablePorts,
        })
      : evaluateBeforeBackendIosCleanup({
          runId,
          captureResult: capture.result,
          captureCleanupClean: capture.cleanup === 'cleaned',
          ownedProcesses,
          liveProcesses,
          previousDevices,
          currentDevices,
          ownedDeviceId: owner.identity.udid,
          adbPreserved: true,
          unavailablePorts,
        })),
    finishedAt: new Date().toISOString(),
  };
}

/** Read-only external census after the owned session has completed its teardown. */
export async function inspectOwnedIosCleanup(options: {
  repositoryRoot: string;
  artifactRoot: string;
  signal?: AbortSignal;
  deadlineAtMonotonicMs?: number;
}) {
  const checkedExecute = async (
    file: string,
    args: readonly string[],
    execOptions: Parameters<typeof execute>[2],
    label: string,
  ) => {
    assertCleanupLifecycleFence(options.signal, options.deadlineAtMonotonicMs, label);
    const result = await execute(file, [...args], {
      ...execOptions,
      encoding: 'utf8',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    assertCleanupLifecycleFence(options.signal, options.deadlineAtMonotonicMs, label);
    return result;
  };
  assertCleanupLifecycleFence(options.signal, options.deadlineAtMonotonicMs, 'cleanup start');
  const repositoryRoot = await realpath(options.repositoryRoot);
  const artifactRoot = await realpath(options.artifactRoot);
  const runId = requireOwnedIosCleanupNamespace(repositoryRoot, artifactRoot);
  const rootStat = await lstat(artifactRoot);
  assert(rootStat.isDirectory() && rootStat.uid === process.getuid?.());
  assert.equal(rootStat.mode & 0o777, 0o700);
  assertCleanupLifecycleFence(options.signal, options.deadlineAtMonotonicMs, 'capture ledger read');
  const capture = json(artifactRoot, 'capture.private.json') as {
    result: string;
    cleanup: unknown;
    preflight?: unknown;
    partialAcquisition?: unknown;
    acquisitionIntents?: string[];
    acquisitionSequence?: unknown;
    acquisitionFailure?: unknown;
    resourceStates?: unknown;
    cleanupAggregate?: unknown;
    postChild?: unknown;
    commandExecutions?: unknown[];
    reservedPorts?: number[];
    device?: { udid: string };
    backend?: {
      runId: string;
      composeProject: string;
      artifactRoot: string;
      processes: ProcessIdentity[];
    };
    backendAcquisitionFailure?: unknown;
    proxyOrigin?: unknown;
    preflightAfterState?: unknown;
    source?: unknown;
    sourceAfter?: unknown;
    helperInputsBefore?: unknown;
    helperInputsAfter?: unknown;
  };
  assertCleanupLifecycleFence(
    options.signal,
    options.deadlineAtMonotonicMs,
    'capture ledger read complete',
  );
  if (Array.isArray(capture.acquisitionIntents) && capture.acquisitionIntents.length === 0)
    return inspectZeroAcquisitionIosCleanup(artifactRoot, runId, capture);
  if (capture.partialAcquisition === true)
    return inspectPartialDetoxCameraCleanup(artifactRoot, runId, capture, options);
  const serverRoot = await realpath(path.resolve(repositoryRoot, '../server'));
  if (!capture.backend)
    return inspectBeforeBackendIosCleanup(artifactRoot, runId, capture, serverRoot, options);
  assert(capture.device);
  assert.match(capture.backend.runId, id);
  assert.equal(capture.backend.composeProject, `mc_test_${capture.backend.runId}`);
  assert.equal(
    await realpath(capture.backend.artifactRoot),
    path.join(serverRoot, '.qa/runtime', capture.backend.runId),
  );
  const backendManifest = JSON.parse(
    await readFile(path.join(capture.backend.artifactRoot, 'manifest.json'), 'utf8'),
  ) as unknown;
  const ownedProcesses = [
    ...capture.backend.processes,
    ...ownershipProcesses(backendManifest),
    ...ownershipProcesses(json(artifactRoot, 'expo-ownership.json')),
  ];
  for (const name of await readdir(artifactRoot))
    if (name.endsWith('.ownership.json'))
      ownedProcesses.push(...ownershipProcesses(json(artifactRoot, name)));
  const cache = json(artifactRoot, 'expo-cache-owner.private.json') as {
    temporaryRoot: string;
  };
  assert.equal(path.dirname(cache.temporaryRoot), artifactRoot);
  const cacheAbsent = await lstat(cache.temporaryRoot).then(
    () => false,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return true;
    },
  );
  const ps = await checkedExecute(
    'ps',
    ['-axo', 'pid=,lstart='],
    {
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    },
    'outer process census',
  );
  const currentDevices = JSON.parse(
    String(
      (
        await checkedExecute(
          'xcrun',
          ['simctl', 'list', 'devices', '--json'],
          { timeout: 15_000 },
          'outer simulator census',
        )
      ).stdout,
    ),
  ) as SimDeviceList;
  const project = `label=com.docker.compose.project=${capture.backend.composeProject}`;
  const docker = {
    container: String(
      (
        await checkedExecute(
          'docker',
          ['ps', '-aq', '--filter', project],
          { timeout: 10_000 },
          'outer docker container census',
        )
      ).stdout,
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean),
    network: String(
      (
        await checkedExecute(
          'docker',
          ['network', 'ls', '-q', '--filter', project],
          { timeout: 10_000 },
          'outer docker network census',
        )
      ).stdout,
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean),
    volume: String(
      (
        await checkedExecute(
          'docker',
          ['volume', 'ls', '-q', '--filter', project],
          { timeout: 10_000 },
          'outer docker volume census',
        )
      ).stdout,
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  };
  const evaluated = evaluateOwnedIosCleanup({
    runId,
    captureResult: capture.result,
    captureCleanupClean: capture.cleanup === 'cleaned',
    ownedProcesses,
    liveProcesses: parseProcesses(String(ps.stdout)),
    previousDevices: json(artifactRoot, 'previous-ios-devices.private.json') as SimDeviceList,
    currentDevices,
    ownedDeviceId: capture.device.udid,
    cacheAbsent,
    docker,
  });
  assertCleanupLifecycleFence(options.signal, options.deadlineAtMonotonicMs, 'cleanup completion');
  return { ...evaluated, finishedAt: new Date().toISOString() };
}

/** Exclusive receipt write; callers must not silently replace a prior failed attempt. */
export async function verifyOwnedIosCleanup(options: {
  repositoryRoot: string;
  artifactRoot: string;
  signal?: AbortSignal;
  deadlineAtMonotonicMs?: number;
}) {
  assertCleanupLifecycleFence(options.signal, options.deadlineAtMonotonicMs, 'cleanup start');
  const repositoryRoot = await realpath(options.repositoryRoot);
  const artifactRoot = await realpath(options.artifactRoot);
  const runId = requireOwnedIosCleanupNamespace(repositoryRoot, artifactRoot);
  const rootStat = await lstat(artifactRoot);
  assert(rootStat.isDirectory() && rootStat.uid === process.getuid?.());
  assert.equal(rootStat.mode & 0o777, 0o700);
  let result:
    | Awaited<ReturnType<typeof inspectOwnedIosCleanup>>
    | {
        kind: 'independent ios native inventory cleanup proof';
        result: 'failed';
        runId: string;
        censusStatus: 'unavailable';
        finishedAt: string;
      };
  try {
    result = await inspectOwnedIosCleanup(options);
    assertCleanupLifecycleFence(options.signal, options.deadlineAtMonotonicMs, 'cleanup receipt');
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (
      options.deadlineAtMonotonicMs !== undefined &&
      performance.now() >= options.deadlineAtMonotonicMs
    )
      throw error;
    result = {
      kind: 'independent ios native inventory cleanup proof',
      result: 'failed',
      runId,
      censusStatus: 'unavailable',
      finishedAt: new Date().toISOString(),
    };
  }
  assertCleanupLifecycleFence(
    options.signal,
    options.deadlineAtMonotonicMs,
    'cleanup receipt write',
  );
  await writeFile(
    path.join(artifactRoot, 'external-cleanup.private.json'),
    JSON.stringify(result, null, 2),
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  assertCleanupLifecycleFence(
    options.signal,
    options.deadlineAtMonotonicMs,
    'cleanup receipt close',
  );
  return result;
}

/**
 * Keep the external cleanup inspector bound to the camera owner's canonical
 * namespace. Attempt receipts under native-pilot-attempts are foreign even
 * when they carry the same run ID and must fail closed.
 */
export function requireOwnedIosCleanupNamespace(
  repositoryRoot: string,
  artifactRoot: string,
): string {
  const runId = path.basename(artifactRoot);
  assert.match(runId, id);
  assert.equal(
    artifactRoot,
    path.join(repositoryRoot, '.qa/artifacts/native-pilot', runId),
    'Independent cleanup root differs from the captured run',
  );
  return runId;
}

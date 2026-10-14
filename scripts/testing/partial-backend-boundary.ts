import assert from 'node:assert/strict';
import path from 'node:path';
import { devices, processSurvivors } from './native-cleanup-evidence';
import type { ProcessIdentity, SimDeviceList } from './native-cleanup-evidence';

type PartialOwnerIdentity = ProcessIdentity & { script: string };

export type PartialBackendProcessCensus =
  { status: 'observed'; liveProcesses: ProcessIdentity[] } | { status: 'unknown'; reason: string };

/** Keep a census failure private, bounded, and explicit. An empty query list is not evidence. */
export function processCensusFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Independent process census unavailable';
  const reason = message.slice(0, 256);
  assert(reason.length > 0);
  return reason;
}

/** Validate an acquisition rejected before the owned backend child was spawned. */
export function requireNotAcquiredBackendIosAcquisition(
  capture: {
    acquisitionIntents?: unknown;
    backend?: unknown;
    backendAcquisitionFailure?: unknown;
    commandExecutions?: unknown;
    cleanup?: unknown;
  },
  files: readonly string[],
  intents: unknown[],
  runId: string,
) {
  assert.match(runId, id);
  // capture declares the backend intent immediately before startOwnedSession. A
  // prepareOwnedSession rejection therefore has three real intent files, but no
  // child identity. Do not synthesize the older two-intent boundary here.
  assert.deepEqual(capture.acquisitionIntents, ['adb', 'simulator', 'backend']);
  assert.equal(capture.backend, undefined);
  assert.deepEqual(capture.commandExecutions, []);
  assert.equal(intents.length, 3);
  for (const [index, resource] of ['adb', 'simulator', 'backend'].entries()) {
    assert(files.includes(`acquisition-${resource}.private.json`));
    const row = intents[index] as Record<string, unknown>;
    assert.equal(row.schemaVersion, 1);
    assert.equal(row.kind, 'owned iOS acquisition intent');
    assert.equal(row.runId, runId);
    assert.equal(row.resource, resource);
    assert.deepEqual(row.previous, ['adb', 'simulator'].slice(0, index));
    assert(typeof row.startedAt === 'string' && !Number.isNaN(Date.parse(row.startedAt)));
  }
  assert(files.includes('backend-acquisition.private.log'));
  const failure = capture.backendAcquisitionFailure;
  assert(failure && typeof failure === 'object' && !Array.isArray(failure));
  const row = failure as Record<string, unknown>;
  assert.equal(row.acquisitionPhase, 'pre-spawn');
  assert.equal(row.cleanup, 'not-acquired');
  assert.equal(row.childExitCode, null);
  assert.equal(row.pid, null);
  assert.equal(row.orchestrator, null);
  assert.equal(row.manifest, null);
  assert.equal(row.closed, null);
  assert(
    capture.cleanup === 'cleaned' ||
      (capture.cleanup &&
        typeof capture.cleanup === 'object' &&
        (capture.cleanup as { status?: unknown }).status === 'failed-recovery-retained'),
  );
  assert(
    !files.some((name) => /^(?:proxy|expo|build\.|ios-build|backend-manifest)/.test(name)),
    'Pre-spawn backend rejection contains later runtime evidence',
  );
  assert(
    !files.some((name) => name.endsWith('.ownership.json') && name !== 'adb-server.ownership.json'),
    'Pre-spawn backend rejection contains unvalidated downstream ownership evidence',
  );
}

const id = /^[a-f0-9]{24}$/;

/**
 * Validate the distinct partial-backend boundary. The backend child was
 * spawned, but no manifest or closed receipt was published. This is always a
 * recovery-retained outcome; the recorded PID/start/script identity is used
 * only for an independent census and is never enough to claim cleanup.
 */
export function requirePartialBackendIosAcquisition(
  capture: {
    acquisitionIntents?: unknown;
    backend?: unknown;
    backendAcquisitionFailure?: unknown;
    commandExecutions?: unknown;
    cleanup?: unknown;
  },
  files: readonly string[],
  intents: unknown[],
  runId: string,
  serverRoot: string,
) {
  assert.match(runId, id);
  assert.deepEqual(capture.acquisitionIntents, ['adb', 'simulator', 'backend']);
  assert.equal(capture.backend, undefined);
  assert.deepEqual(capture.commandExecutions, []);
  assert(capture.cleanup && typeof capture.cleanup === 'object');
  const cleanup = capture.cleanup as { status?: unknown; resources?: unknown };
  assert.equal(cleanup.status, 'failed-recovery-retained');
  assert(Array.isArray(cleanup.resources) && cleanup.resources.includes('backend-acquisition'));
  assert.equal(intents.length, 3);
  for (const [index, resource] of ['adb', 'simulator', 'backend'].entries()) {
    assert(files.includes(`acquisition-${resource}.private.json`));
    const row = intents[index] as Record<string, unknown>;
    assert.equal(row.schemaVersion, 1);
    assert.equal(row.kind, 'owned iOS acquisition intent');
    assert.equal(row.runId, runId);
    assert.equal(row.resource, resource);
    assert.deepEqual(row.previous, ['adb', 'simulator'].slice(0, index));
    assert(typeof row.startedAt === 'string' && !Number.isNaN(Date.parse(row.startedAt)));
  }
  const failure = capture.backendAcquisitionFailure;
  assert(failure && typeof failure === 'object' && !Array.isArray(failure));
  const row = failure as Record<string, unknown>;
  assert.equal(row.acquisitionPhase, 'spawned');
  assert.equal(row.cleanup, 'failed-recovery-ledger-retained');
  assert.equal(row.manifest, null);
  assert.equal(row.closed, null);
  assert(Number.isSafeInteger(row.pid) && (row.pid as number) > 1);
  const orchestrator = row.orchestrator;
  assert(orchestrator && typeof orchestrator === 'object' && !Array.isArray(orchestrator));
  const owner = orchestrator as Record<string, unknown>;
  assert.equal(owner.status, 'verified');
  assert.equal(owner.pid, row.pid);
  assert(Number.isSafeInteger(owner.pid) && (owner.pid as number) > 1);
  assert(typeof owner.started === 'string' && !Number.isNaN(Date.parse(owner.started)));
  assert.equal(owner.script, path.join(serverRoot, 'scripts/testing/session.ts'));
  assert.equal(files.includes('backend-acquisition.private.log'), true);
  assert(
    !files.some((name) => /^(?:proxy|expo|build\.|ios-build|backend-manifest)/.test(name)),
    'Partial backend acquisition contains later runtime evidence',
  );
  assert(
    !files.some((name) => name.endsWith('.ownership.json') && name !== 'adb-server.ownership.json'),
    'Partial backend acquisition contains unvalidated downstream ownership evidence',
  );
  return {
    pid: owner.pid as number,
    started: owner.started,
    script: owner.script,
  };
}

/** A partial child is never a clean result; exact start identity only supports census. */
export function evaluatePartialBackendIosCleanup(input: {
  runId: string;
  captureResult: string;
  captureCleanup: string;
  owner: PartialOwnerIdentity;
  processCensus: PartialBackendProcessCensus;
  previousDevices: SimDeviceList;
  currentDevices: SimDeviceList;
  ownedDeviceId: string;
  adbPreserved: boolean;
  unavailablePorts: number[];
}) {
  assert.match(input.runId, id);
  assert(input.captureResult && typeof input.captureResult === 'string');
  assert.equal(input.captureCleanup, 'failed-recovery-retained');
  const census =
    input.processCensus.status === 'observed'
      ? processSurvivors([input.owner], input.processCensus.liveProcesses)
      : { pidStartPairs: 0, survivors: [] as number[] };
  const samePidDifferentStart =
    input.processCensus.status === 'observed'
      ? input.processCensus.liveProcesses
          .filter((row) => row.pid === input.owner.pid && row.started !== input.owner.started)
          .map((row) => row.pid)
          .sort((a, b) => a - b)
      : [];
  const before = devices(input.previousDevices);
  const after = devices(input.currentDevices);
  assert(!before.has(input.ownedDeviceId));
  const missingForeignDevices = [...before]
    .filter(([key, state]) => after.get(key) !== state)
    .map(([key]) => key)
    .sort();
  const ownedDeviceAbsent = !after.has(input.ownedDeviceId);
  return {
    kind: 'independent ios partial-backend acquisition recovery proof',
    scope:
      'adb-and-simulator acquired; backend child started without a validated manifest or close receipt',
    runId: input.runId,
    captureResult: input.captureResult,
    captureCleanup: input.captureCleanup,
    captureCleanupClean: false,
    recoveryVerified: false,
    ownerProcess: { ...input.owner },
    ...census,
    samePidDifferentStart,
    processCensusStatus: input.processCensus.status,
    processCensusError:
      input.processCensus.status === 'unknown' ? input.processCensus.reason : null,
    unknownProcessQueries:
      input.processCensus.status === 'unknown' ? [input.owner.pid] : ([] as number[]),
    missingForeignDevices,
    ownedDeviceAbsent,
    adbPreserved: input.adbPreserved,
    unavailablePorts: input.unavailablePorts,
    result: 'failed' as const,
    reason:
      'A matching closed session receipt is required before cleanup can be classified as cleaned',
  };
}

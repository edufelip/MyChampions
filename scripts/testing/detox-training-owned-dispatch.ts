import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  readOwnedTrainingPath,
  writeAtomicTrainingJson,
} from './detox-training-child-protocol.mjs';
import {
  runDetoxTrainingJourney,
  type DetoxTrainingBoundEvidence,
  type DetoxTrainingUiBridge,
} from './detox-training-journey';
import type { NativePilotSelection } from './native-pilot-contract';
import type { startOwnedApiProxy } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures, startOwnedSession } from './owned-session';

type OwnedSession = Awaited<ReturnType<typeof startOwnedSession>>;
type OwnedProxy = Awaited<ReturnType<typeof startOwnedApiProxy>>;

const RUN_ID = /^[a-f0-9]{24}$/;
const TRAINING_SCOPE = Object.freeze({
  ios: 'native-entry-ios',
  android: 'native-entry-android',
});

export type DetoxTrainingOwnedDispatchOptions = Readonly<{
  repositoryRoot: string;
  output: string;
  selection: NativePilotSelection;
  fixtures: OwnedFixtures;
  session: OwnedSession;
  proxy: OwnedProxy;
  child: DetoxTrainingUiBridge;
  childIdentity: Readonly<{ pid: number; pgid: number; started: string }>;
  signal: AbortSignal;
  deadlineAt: number;
  report: Record<string, unknown>;
}>;

type SourceReceipt = DetoxTrainingBoundEvidence['api']['source'] & {
  processPid: number;
  processPgid: number;
  processStarted: string;
};

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

async function writeSource(
  root: string,
  name: string,
  value: unknown,
  maxBytes: number,
  options: {
    signal: AbortSignal;
    deadlineAt: number;
    childIdentity: Readonly<{ pid: number; pgid: number; started: string }>;
  },
): Promise<SourceReceipt> {
  assert(/^detox-training-[a-z0-9-]+\.private\.json$/.test(name));
  const file = path.join(root, name);
  assert(path.dirname(file) === path.resolve(root));
  const bytes = canonicalJson(value);
  assert(bytes.byteLength > 0 && bytes.byteLength <= maxBytes);
  await writeAtomicTrainingJson(root, name, value, options);
  const source = await readOwnedTrainingPath(file, maxBytes, options);
  const readback = source.bytes;
  const resolved = source.realpath;
  const metadata = source.metadata;
  assert.deepEqual(readback, bytes, `${name} changed during publication`);
  return {
    fileName: name,
    sourcePath: file,
    sourceRealpath: resolved,
    sourceBytes: readback.byteLength,
    sourceSha256: hash(readback),
    sourceMode: metadata.mode & 0o777,
    sourceUid: metadata.uid,
    sourceNlink: metadata.nlink,
    sourceDev: metadata.dev,
    sourceIno: metadata.ino,
    processPid: options.childIdentity.pid,
    processPgid: options.childIdentity.pgid,
    processStarted: options.childIdentity.started,
  };
}

function snapshotRows(snapshot: OwnedDomainSnapshot) {
  return snapshot.trainingPlans.map((row) => structuredClone(row));
}

function stableUnrelatedRows(
  baseline: OwnedDomainSnapshot | undefined,
  latest: OwnedDomainSnapshot | undefined,
  _planId: string | undefined,
) {
  assert(baseline && latest, 'Training evidence requires baseline and final SQL snapshots');
  const before = snapshotRows(baseline);
  const baselineIds = new Set(before.map((row) => row.id));
  const after = snapshotRows(latest).filter((row) => baselineIds.has(row.id));
  assert.deepEqual(after, before, 'Owned unrelated SQL state changed during training');
  return { before, after } as const;
}

function requireChildIdentity(value: Readonly<{ pid: number; pgid: number; started: string }>) {
  assert(Number.isSafeInteger(value.pid) && value.pid > 1);
  assert(Number.isSafeInteger(value.pgid) && value.pgid > 1);
  assert(typeof value.started === 'string' && value.started.length > 0);
}

/**
 * Dispatches T14-B through the already acquired connection owner. This function
 * never starts a child, API session, proxy, target or port. It is deliberately
 * a private source adapter until the parent driver exposes this branch in its
 * public selection/receipt contract.
 */
export async function runDetoxTrainingOnExistingOwner(input: DetoxTrainingOwnedDispatchOptions) {
  const output = await realpath(input.output);
  assert(input.session.manifest.runId === input.fixtures.runId);
  assert(
    input.fixtures.scope === TRAINING_SCOPE.ios || input.fixtures.scope === TRAINING_SCOPE.android,
  );
  const platform = input.fixtures.scope.endsWith('ios') ? 'ios' : 'android';
  assert(input.selection.arguments.platform === platform);
  assert(input.selection.arguments.engine === 'detox');
  assert(RUN_ID.test(input.fixtures.runId));
  requireChildIdentity(input.childIdentity);
  const exercise = input.fixtures.draft.sessions[0]?.items[0];
  assert(exercise, 'Owned training fixture has no exercise');
  const attemptId = `${input.fixtures.runId}:first`;
  const journeyInput = {
    runId: input.fixtures.runId,
    attemptId,
    platform,
    accountUid: input.fixtures.accounts.coach.authUid,
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.name,
  } as const;

  const snapshots: OwnedDomainSnapshot[] = [];
  const snapshotReceipts: {
    apiOrigin: string;
    apiPid: number;
    apiStarted: string;
    backendAttemptId: string;
    manifestSha256: string;
    apiLedgerSha256: string;
    fixtureAuthUidAllowlistHash: string;
  }[] = [];
  const apiReads: Record<string, unknown>[] = [];
  let stagedSourceReceipts:
    { api: SourceReceipt; sql: SourceReceipt; transport: SourceReceipt } | undefined;
  const observeSnapshots = async () => {
    const observed = await input.session.snapshotWithEvidence(
      `native-entry-${platform}`,
      input.signal,
    );
    snapshots.push(structuredClone(observed.value));
    snapshotReceipts.push({
      apiOrigin: observed.receipt.apiOrigin,
      apiPid: observed.receipt.apiPid,
      apiStarted: observed.receipt.apiStarted,
      backendAttemptId: observed.receipt.backendAttemptId,
      manifestSha256: observed.receipt.manifestSha256,
      apiLedgerSha256: observed.receipt.apiLedgerSha256,
      fixtureAuthUidAllowlistHash: observed.receipt.fixtureAuthUidAllowlistHash,
    });
    return observed.value;
  };
  const readPlan = async (planId: string) => {
    const value = await input.proxy.readObservedNativeTrainingPlan({
      fixtureScope: `native-entry-${platform}`,
      accountUid: journeyInput.accountUid,
      planId,
    });
    apiReads.push(structuredClone(value));
    return { status: value.status, plan: value.plan };
  };
  const evidence = async ({
    signal,
    deadlineAt,
  }: {
    signal: AbortSignal;
    deadlineAt: number;
  }): Promise<DetoxTrainingBoundEvidence> => {
    const latest = snapshots.at(-1);
    const { before, after } = stableUnrelatedRows(snapshots[0], latest, undefined);
    const api = await input.session.probeCurrentApiLifetime(signal);
    assert.equal(api.runId, journeyInput.runId);
    assert.equal(api.apiOrigin, input.session.apiOrigin);
    assert.equal(api.apiPid, input.session.apiPid);
    const latestReceipt = snapshotReceipts.at(-1);
    assert(latestReceipt, 'Training evidence requires a final owned SQL receipt');
    assert.equal(latestReceipt.apiOrigin, api.apiOrigin);
    assert.equal(latestReceipt.apiPid, api.apiPid);
    assert.equal(latestReceipt.apiStarted, api.apiStarted);
    const nativeAuthIdentities = input.proxy.nativeAuthIdentities;
    assert(
      nativeAuthIdentities.some(
        (row) =>
          row.verification === 'verified' &&
          row.authUid === journeyInput.accountUid &&
          row.apiPid === api.apiPid &&
          row.targetOrigin === api.apiOrigin,
      ),
      'Training evidence requires a verified native auth identity from the owned proxy',
    );
    const transport = input.proxy.observations;
    assert(transport.length > 0, 'Owned training proxy produced no observations');
    const apiSource = await writeSource(
      output,
      'detox-training-api.private.json',
      {
        schemaVersion: 1,
        kind: 'private-detox-training-api-source',
        runId: journeyInput.runId,
        attemptId,
        targetOrigin: input.session.apiOrigin,
        apiPid: api.apiPid,
        apiStarted: api.apiStarted,
        backendAttemptId: api.backendAttemptId,
        manifestSha256: api.manifestSha256,
        apiLedgerSha256: api.apiLedgerSha256,
        apiOrigin: api.apiOrigin,
        authUid: journeyInput.accountUid,
        fixtureAuthUidAllowlistHash: latestReceipt.fixtureAuthUidAllowlistHash,
        reads: apiReads,
      },
      2 * 1024 * 1024,
      { signal, deadlineAt, childIdentity: input.childIdentity },
    );
    const sqlSource = await writeSource(
      output,
      'detox-training-sql.private.json',
      {
        schemaVersion: 1,
        kind: 'private-detox-training-sql-source',
        runId: journeyInput.runId,
        attemptId,
        scope: `native-entry-${platform}`,
        apiOrigin: api.apiOrigin,
        apiPid: api.apiPid,
        apiStarted: api.apiStarted,
        backendAttemptId: api.backendAttemptId,
        manifestSha256: api.manifestSha256,
        apiLedgerSha256: api.apiLedgerSha256,
        authUid: journeyInput.accountUid,
        unrelatedBefore: before,
        unrelatedAfter: after,
        unrelatedStateUnchanged: true,
      },
      2 * 1024 * 1024,
      { signal, deadlineAt, childIdentity: input.childIdentity },
    );
    const transportSource = await writeSource(
      output,
      'detox-training-transport.private.json',
      {
        schemaVersion: 1,
        kind: 'private-detox-training-proxy-source',
        runId: journeyInput.runId,
        attemptId,
        targetOrigin: input.session.apiOrigin,
        apiOrigin: api.apiOrigin,
        apiPid: api.apiPid,
        apiStarted: api.apiStarted,
        authUid: journeyInput.accountUid,
        nativeAuthIdentities,
        observations: transport,
      },
      2 * 1024 * 1024,
      { signal, deadlineAt, childIdentity: input.childIdentity },
    );
    stagedSourceReceipts = {
      api: apiSource,
      sql: sqlSource,
      transport: transportSource,
    };
    return {
      runId: journeyInput.runId,
      attemptId,
      targetOrigin: input.session.apiOrigin,
      api: {
        apiOrigin: api.apiOrigin,
        apiPid: api.apiPid,
        apiStarted: api.apiStarted,
        backendAttemptId: api.backendAttemptId,
        manifestSha256: api.manifestSha256,
        apiLedgerSha256: api.apiLedgerSha256,
        authUid: journeyInput.accountUid,
        fixtureAuthUidAllowlistHash: latestReceipt.fixtureAuthUidAllowlistHash,
        source: apiSource,
      },
      sql: {
        scope: `native-entry-${platform}`,
        apiOrigin: api.apiOrigin,
        apiPid: api.apiPid,
        apiStarted: api.apiStarted,
        backendAttemptId: api.backendAttemptId,
        manifestSha256: api.manifestSha256,
        apiLedgerSha256: api.apiLedgerSha256,
        authUid: journeyInput.accountUid,
        source: sqlSource,
        unrelatedBefore: before,
        unrelatedAfter: after,
      },
      transport: {
        apiOrigin: api.apiOrigin,
        apiPid: api.apiPid,
        apiStarted: api.apiStarted,
        authUid: journeyInput.accountUid,
        nativeAuthIdentities,
        source: transportSource,
      },
    };
  };

  const result = await runDetoxTrainingJourney({
    repositoryRoot: input.repositoryRoot,
    output,
    selection: input.selection,
    input: journeyInput,
    bridge: input.child,
    snapshot: observeSnapshots,
    readPlan,
    transport: () => input.proxy.observations,
    targetOrigin: input.session.apiOrigin,
    signal: input.signal,
    evidence,
    deadlineAt: input.deadlineAt,
  });
  assert(stagedSourceReceipts, 'Training owner did not retain source receipts');
  input.report.detoxTraining = {
    kind: 'private-detox-training-owned-dispatch',
    runId: journeyInput.runId,
    attemptId,
    platform,
    input: journeyInput,
    planId: result.planId,
    sixSqlCheckpoints: true,
    threeAuthenticatedApiReads: apiReads.length === 3,
    savedPlanDurableAfterRestart: true,
    childIdentity: input.childIdentity,
    apiIdentity: {
      apiOrigin: input.session.apiOrigin,
      apiPid: input.session.apiPid,
    },
    snapshotCount: snapshots.length,
    apiReadCount: apiReads.length,
    proxyObservationCount: input.proxy.observations.length,
    sourceReceipts: stagedSourceReceipts,
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
  return result;
}

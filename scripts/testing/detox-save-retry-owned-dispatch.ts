import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  readOwnedDetoxConnectionFile,
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceLifecycle,
} from './detox-connection-evidence';
import {
  runDetoxSaveRetryJourney,
  type DetoxSaveRetryChild,
  type DetoxSaveRetrySnapshot,
} from './detox-save-retry-driver';
import { createDetoxSaveRetryOwnerRuntimeSource } from './detox-save-retry-runtime-finalizer';
import {
  nativeSaveRetryAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotSelection,
} from './native-pilot-contract';
import {
  requireNativeRetryDraft,
  validateNativeRetrySnapshots,
} from './native-save-retry-observation';
import { enUS } from '../../localization/en-US';
import type { DetoxSaveRetryTerminalState } from './detox-save-retry-child-client';
import type { startOwnedApiProxy } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures, startOwnedSession } from './owned-session';

type OwnedSession = Awaited<ReturnType<typeof startOwnedSession>>;
type OwnedProxy = Awaited<ReturnType<typeof startOwnedApiProxy>>;
const RUN_ID = /^[a-f0-9]{24}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
  return hashBytes(Buffer.from(JSON.stringify(value)));
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && SHA256.test(value), `${label} must be a SHA-256 hash`);
}

/** Validate the canonical integrated save/retry selection before owner acquisition. */
export function requireDetoxSaveRetrySelection(value: unknown): NativePilotSelection {
  const selection = record(value, 'Detox save/retry selection') as unknown as NativePilotSelection;
  const args = record(selection.arguments, 'Detox save/retry arguments');
  const platform = args.platform;
  assert(platform === 'ios' || platform === 'android', 'Detox save/retry platform is unsupported');
  assert.equal(args.engine, 'detox', 'Detox save/retry selection must use Detox');
  assert.equal(args.scenario, `SCN-save-retry-${platform}`);
  assert.equal(args.mode, 'integration');
  const scenario = record(selection.scenario, 'Detox save/retry scenario');
  assert.equal(scenario.id, args.scenario);
  assert.equal(scenario.platform, platform);
  assert.equal(scenario.flowId, 'FLW-save-retry');
  assert.equal(scenario.dataMode, 'postgres');
  assert.equal(scenario.fixtureRef, `owned-postgres:${scenario.id}:fresh-attempt`);
  if (scenario.engine !== undefined) assert.equal(scenario.engine, 'detox');
  assert.deepEqual(scenario.roles, ['coach']);
  requireHash(selection.scenarioHash, 'Detox save/retry scenario hash');
  requireHash(selection.requirementHash, 'Detox save/retry requirement hash');
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...nativeSaveRetryAssertionIds],
    'Detox save/retry assertion IDs changed from the shared contract',
  );
  return selection;
}

export type DetoxSaveRetryCoachAuthTransition = Readonly<{
  actor: 'coach';
  beforeRequestId: number;
  authRequestId: number;
  afterRequestId: number;
  actorAuthUid: string;
}>;

export type DetoxSaveRetryFaultIdentity = Readonly<{
  requestedRunId: string;
  captureRunId: string;
  backendRunId: string;
  requestedAttemptId: string;
  backendAttemptId: string;
  faultAttemptId: `native-save-${string}`;
}>;

export type DetoxSaveRetryOwnedDispatchOptions = Readonly<{
  repositoryRoot: string;
  output: string;
  selection: NativePilotSelection;
  fixtures: OwnedFixtures;
  session: OwnedSession;
  proxy: OwnedProxy;
  child: DetoxSaveRetryChild & {
    terminalState?: () => readonly DetoxSaveRetryTerminalState[];
  };
  childIdentity: Readonly<{ pid: number; pgid: number; started: string }>;
  coachAuthTransition: DetoxSaveRetryCoachAuthTransition;
  signal: AbortSignal;
  deadlineAt: number;
  report: Record<string, unknown>;
  producerContext: Readonly<{
    build: unknown;
    runtimeMetadata: unknown;
  }>;
}>;

export type DetoxSaveRetryTerminalFailure = Readonly<{
  kind: 'private-detox-save-retry-terminal-failure';
  status: 'failed' | 'cancelled' | 'deadline';
  error: { name: string; message: string };
  faultIdentity: DetoxSaveRetryFaultIdentity;
  coachAuthTransition: DetoxSaveRetryCoachAuthTransition | null;
  childIdentity: Readonly<{ pid: number; pgid: number; started: string }>;
  childTerminalState: readonly DetoxSaveRetryTerminalState[];
  faultState: unknown;
  proxyObservationRefs: readonly number[];
  evidenceRefs: readonly string[];
  cleanup: {
    owner: 'existing-detox-connection-driver-aggregate';
    status: 'pending' | 'not-verified';
  };
  nativePassingCases: 0;
  publicPromotionEligible: false;
}>;

function requireChildIdentity(
  value: Readonly<{ pid: number; pgid: number; started: string }>,
): void {
  assert(Number.isSafeInteger(value.pid) && value.pid > 1);
  assert(Number.isSafeInteger(value.pgid) && value.pgid > 1);
  assert(typeof value.started === 'string' && value.started.length > 0);
}

export function requireMatchingDetoxSaveRetrySelection(
  current: NativePilotSelection,
  expected: NativePilotSelection,
): NativePilotSelection {
  assert.deepEqual(
    current,
    expected,
    'Detox Save/retry selection is stale or was produced from a different source root',
  );
  return current;
}

export async function requireFreshDetoxSaveRetrySelection(
  repositoryRoot: string,
  selection: NativePilotSelection,
): Promise<NativePilotSelection> {
  const root = await realpath(repositoryRoot);
  const inventoryPath = path.join(root, 'docs/qa/native-pilot/inventory.json');
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as unknown;
  const current = selectNativePilotScenario(
    {
      platform: selection.arguments.platform,
      engine: 'detox',
      scenario: selection.arguments.scenario,
      mode: 'integration',
    },
    inventory,
    root,
  );
  return requireMatchingDetoxSaveRetrySelection(await current, selection);
}

export function requireCoachAuthTransition(
  transition: DetoxSaveRetryCoachAuthTransition,
  fixtures: OwnedFixtures,
  apiOrigin: string,
): DetoxSaveRetryCoachAuthTransition {
  assert.equal(transition.actor, 'coach');
  assert.equal(transition.actorAuthUid, fixtures.accounts.coach.authUid);
  assert(Number.isSafeInteger(transition.beforeRequestId) && transition.beforeRequestId >= 0);
  assert(
    Number.isSafeInteger(transition.authRequestId) &&
      transition.authRequestId > transition.beforeRequestId,
  );
  assert(
    Number.isSafeInteger(transition.afterRequestId) &&
      transition.afterRequestId >= transition.authRequestId,
  );
  assert(apiOrigin.startsWith('http://') || apiOrigin.startsWith('https://'));
  return { ...transition };
}

export function requireFaultIdentity(
  fixtures: OwnedFixtures,
  captureRunId: string,
  requestedRunId: string,
): DetoxSaveRetryFaultIdentity {
  const backendRunId = fixtures.runId;
  assert.match(backendRunId, RUN_ID);
  assert.match(captureRunId, RUN_ID);
  assert.match(requestedRunId, RUN_ID);
  const requestedAttemptId = `${requestedRunId}:first`;
  const backendAttemptId = `${backendRunId}:first`;
  const faultAttemptId = `native-save-${backendRunId}` as const;
  assert(!faultAttemptId.startsWith('detox-save-'));
  return {
    requestedRunId,
    captureRunId,
    backendRunId,
    requestedAttemptId,
    backendAttemptId,
    faultAttemptId,
  };
}

function classifySaveFailure(
  error: unknown,
  signal: AbortSignal,
  deadlineAt: number,
): DetoxSaveRetryTerminalFailure['status'] {
  if (signal.aborted) return 'cancelled';
  if (
    performance.now() >= deadlineAt ||
    /deadline|elapsed/i.test(error instanceof Error ? error.message : String(error))
  )
    return 'deadline';
  return 'failed';
}

export function createDetoxSaveRetryTerminalFailure(input: {
  error: unknown;
  signal: AbortSignal;
  deadlineAt: number;
  faultIdentity: DetoxSaveRetryFaultIdentity;
  coachAuthTransition?: DetoxSaveRetryCoachAuthTransition;
  childIdentity: Readonly<{ pid: number; pgid: number; started: string }>;
  childTerminalState?: readonly DetoxSaveRetryTerminalState[];
  faultState: unknown;
  proxyObservations: readonly { requestId: number }[];
  evidenceRefs?: readonly string[];
}): DetoxSaveRetryTerminalFailure {
  const error = input.error instanceof Error ? input.error : new Error(String(input.error));
  return {
    kind: 'private-detox-save-retry-terminal-failure',
    status: classifySaveFailure(input.error, input.signal, input.deadlineAt),
    error: { name: error.name, message: error.message.slice(0, 1_000) },
    faultIdentity: input.faultIdentity,
    coachAuthTransition: input.coachAuthTransition ?? null,
    childIdentity: input.childIdentity,
    childTerminalState: [...(input.childTerminalState ?? [])],
    faultState: input.faultState,
    proxyObservationRefs: input.proxyObservations.map((row) => row.requestId),
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    cleanup: {
      owner: 'existing-detox-connection-driver-aggregate',
      status: 'pending',
    },
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
}

/**
 * Builds the outer-driver fallback after the coach switch. The caller passes
 * the transition it just observed; the report copy is a second owned source
 * of the same fact for the narrow window where the fallback runs after the
 * inner Save dispatcher has not published a terminal record yet.
 */
export function createDetoxSaveRetryOuterFailureTerminal(input: {
  error: unknown;
  signal: AbortSignal;
  deadlineAt: number;
  report: Record<string, unknown>;
  faultIdentity: DetoxSaveRetryFaultIdentity;
  coachAuthTransition?: DetoxSaveRetryCoachAuthTransition;
  childIdentity: Readonly<{ pid: number; pgid: number; started: string }>;
  childTerminalState?: readonly DetoxSaveRetryTerminalState[];
  faultState: unknown;
  proxyObservations: readonly { requestId: number }[];
  evidenceRefs?: readonly string[];
}): DetoxSaveRetryTerminalFailure {
  const reportTransition = input.report.detoxSaveRetryCoachAuth;
  const coachAuthTransition = input.coachAuthTransition
    ? requireSavedCoachAuthTransition(input.coachAuthTransition)
    : reportTransition
      ? requireSavedCoachAuthTransition(reportTransition)
      : undefined;
  return createDetoxSaveRetryTerminalFailure({
    ...input,
    coachAuthTransition,
  });
}

function requireSavedCoachAuthTransition(value: unknown): DetoxSaveRetryCoachAuthTransition {
  const transition = record(value, 'Saved Detox save/retry coach transition');
  const beforeRequestId = transition.beforeRequestId;
  const authRequestId = transition.authRequestId;
  const afterRequestId = transition.afterRequestId;
  assert.equal(transition.actor, 'coach');
  assert(
    typeof beforeRequestId === 'number' &&
      Number.isSafeInteger(beforeRequestId) &&
      beforeRequestId >= 0,
  );
  assert(
    typeof authRequestId === 'number' &&
      Number.isSafeInteger(authRequestId) &&
      authRequestId > beforeRequestId,
  );
  assert(
    typeof afterRequestId === 'number' &&
      Number.isSafeInteger(afterRequestId) &&
      afterRequestId >= authRequestId,
  );
  assert(typeof transition.actorAuthUid === 'string' && transition.actorAuthUid.length > 0);
  return {
    actor: 'coach',
    beforeRequestId,
    authRequestId,
    afterRequestId,
    actorAuthUid: transition.actorAuthUid,
  };
}

function requireSavedFaultIdentity(value: unknown): DetoxSaveRetryFaultIdentity {
  const identity = record(value, 'Saved Detox save/retry fault identity');
  assert(typeof identity.requestedRunId === 'string' && RUN_ID.test(identity.requestedRunId));
  assert(typeof identity.captureRunId === 'string' && RUN_ID.test(identity.captureRunId));
  assert(typeof identity.backendRunId === 'string' && RUN_ID.test(identity.backendRunId));
  assert(
    identity.requestedAttemptId === `${identity.requestedRunId}:first`,
    'Saved Detox save/retry requested attempt is not the original attempt',
  );
  assert(
    identity.backendAttemptId === `${identity.backendRunId}:first`,
    'Saved Detox save/retry backend attempt is not the original attempt',
  );
  assert(
    typeof identity.faultAttemptId === 'string' &&
      identity.faultAttemptId === `native-save-${identity.backendRunId}`,
    'Saved Detox save/retry fault identity is not bound to the backend run',
  );
  return {
    requestedRunId: identity.requestedRunId,
    captureRunId: identity.captureRunId,
    backendRunId: identity.backendRunId,
    requestedAttemptId: identity.requestedAttemptId,
    backendAttemptId: identity.backendAttemptId,
    faultAttemptId: identity.faultAttemptId as `native-save-${string}`,
  };
}

function requireSavedChildIdentity(
  value: unknown,
): Readonly<{ pid: number; pgid: number; started: string }> {
  const child = record(value, 'Saved Detox save/retry child identity') as {
    pid: number;
    pgid: number;
    started: string;
  };
  requireChildIdentity(child);
  return { pid: child.pid, pgid: child.pgid, started: child.started };
}

function saveRetryEvidenceRefs(
  report: Record<string, unknown>,
  childTerminalState: readonly DetoxSaveRetryTerminalState[],
): readonly string[] {
  const refs = childTerminalState.flatMap((row) => [
    ...row.evidenceRefs,
    row.responsePath,
    row.cancelPath,
  ]);
  const transport = report.detoxTransportSourceReceipt;
  if (transport && typeof transport === 'object' && !Array.isArray(transport)) {
    const pathValue = (transport as Record<string, unknown>).path;
    if (typeof pathValue === 'string') refs.push(pathValue);
  }
  return refs;
}

/**
 * Converts a post-success aggregate cleanup failure into a complete terminal
 * record. The saved dispatch report is the authority for the original fault,
 * coach transition, child identity, and successful Save facts; this function
 * refuses to construct a terminal from empty cleanup metadata.
 */
export function createDetoxSaveRetryCleanupFailureTerminal(input: {
  error: unknown;
  signal: AbortSignal;
  deadlineAt: number;
  report: Record<string, unknown>;
  ownedChild?: Readonly<{ pid: number; pgid: number }>;
  childTerminalState?: readonly DetoxSaveRetryTerminalState[];
  faultState: unknown;
  proxyObservations: readonly { requestId: number }[];
  drain: unknown;
}): DetoxSaveRetryTerminalFailure & { drain: unknown } {
  const saved = record(input.report.detoxSaveRetry, 'Saved Detox save/retry dispatch report');
  assert.equal(saved.kind, 'private-detox-save-retry-owned-dispatch');
  assert.equal(saved.nativePassingCases, 0);
  assert.equal(saved.publicPromotionEligible, false);
  const result = record(saved.result, 'Saved Detox save/retry result');
  assert.equal(result.kind, 'private-detox-save-retry-capture-not-public-receipt');
  assert.equal(result.runId, saved.runId);
  assert.equal(result.attemptId, saved.attemptId);
  const faultIdentity = requireSavedFaultIdentity(saved.faultIdentity);
  assert.equal(result.faultAttemptId, faultIdentity.faultAttemptId);
  const childIdentity = requireSavedChildIdentity(saved.childIdentity);
  if (input.ownedChild) {
    assert.equal(childIdentity.pid, input.ownedChild.pid);
    assert.equal(childIdentity.pgid, input.ownedChild.pgid);
  }
  if (input.report.detoxChildIdentity)
    assert.deepEqual(childIdentity, input.report.detoxChildIdentity);
  const coachAuthTransition = requireSavedCoachAuthTransition(saved.coachAuthTransition);
  if (input.report.detoxSaveRetryCoachAuth)
    assert.deepEqual(coachAuthTransition, input.report.detoxSaveRetryCoachAuth);
  const childTerminalState = [...(input.childTerminalState ?? [])];
  const terminal = createDetoxSaveRetryTerminalFailure({
    error: input.error,
    signal: input.signal,
    deadlineAt: input.deadlineAt,
    faultIdentity,
    coachAuthTransition,
    childIdentity,
    childTerminalState,
    faultState: input.faultState,
    proxyObservations: input.proxyObservations,
    evidenceRefs: saveRetryEvidenceRefs(input.report, childTerminalState),
  });
  return {
    ...terminal,
    cleanup: {
      owner: 'existing-detox-connection-driver-aggregate',
      status: 'not-verified',
    },
    drain: input.drain,
  };
}

function requireOwnedSnapshotPath(root: string, value: unknown): string {
  assert(typeof value === 'string' && path.isAbsolute(value));
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(value);
  assert(
    resolved.startsWith(`${resolvedRoot}${path.sep}`),
    'Save/retry screenshot escaped owner root',
  );
  assert(
    path.dirname(resolved) === resolvedRoot,
    'Save/retry screenshot is not a direct owner file',
  );
  return path.basename(resolved);
}

function asOwnedDomainSnapshot(value: DetoxSaveRetrySnapshot): OwnedDomainSnapshot {
  assert.equal(value.schemaVersion, 1);
  assert(typeof value.runId === 'string' && value.runId.length > 0);
  assert(value.readOnly === true);
  assert(Array.isArray(value.trainingPlans));
  assert(Array.isArray(value.connections));
  return value as unknown as OwnedDomainSnapshot;
}

/**
 * Runs T14-E through the already acquired Detox owner. This adapter does not
 * start a process, proxy, session, target or port; cleanup remains the parent
 * driver's aggregate owner and the child client only closes its IPC view.
 */
export async function runDetoxSaveRetryOnExistingOwner(input: DetoxSaveRetryOwnedDispatchOptions) {
  assert(
    input.producerContext,
    'Detox save/retry producer context is unavailable at the owner boundary',
  );
  const selection = requireDetoxSaveRetrySelection(input.selection);
  const freshSelection = await requireFreshDetoxSaveRetrySelection(input.repositoryRoot, selection);
  const platform = freshSelection.arguments.platform;
  assert(input.fixtures.scope === `native-entry-${platform}`);
  assert(freshSelection.arguments.engine === 'detox');
  assert(RUN_ID.test(input.fixtures.runId));
  requireChildIdentity(input.childIdentity);
  const accountUid = input.fixtures.accounts.coach.authUid;
  assert(typeof accountUid === 'string' && accountUid.length > 0);
  const coachAuthTransition = requireCoachAuthTransition(
    input.coachAuthTransition,
    input.fixtures,
    input.session.apiOrigin,
  );
  const captureRunId = path.basename(input.output);
  const requestedRunId = captureRunId;
  const faultIdentity = requireFaultIdentity(input.fixtures, captureRunId, requestedRunId);
  const scope = `native-entry-${platform}` as const;
  const output = await realpath(input.output);
  const snapshotPhases = ['before', 'draft', 'failed', 'after', 'reopened'] as const;
  let snapshotIndex = 0;
  const snapshots: {
    phase: (typeof snapshotPhases)[number];
    snapshot: Record<string, unknown>;
  }[] = [];
  const apiReads: {
    phase: 'after' | 'reopened';
    status: number;
    plan: unknown;
    verification: unknown;
  }[] = [];
  const snapshot = async (): Promise<DetoxSaveRetrySnapshot> => {
    const value = await input.session.snapshot(scope, input.signal);
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.runId, input.fixtures.runId);
    assert.equal(value.scope, scope);
    assert.equal(value.readOnly, true);
    const snapshot = {
      schemaVersion: 1,
      runId: value.runId,
      scope,
      readOnly: true as const,
      trainingPlans: value.trainingPlans.map((row) => record(row, 'Detox save/retry plan')),
      connections: value.connections.map((row) => record(row, 'Detox save/retry connection')),
    };
    const phase = snapshotPhases[snapshotIndex++];
    assert(phase, 'Detox save/retry snapshot count exceeded the owner contract');
    snapshots.push({ phase, snapshot });
    return snapshot;
  };
  const readPlan = async (planId: string) => {
    const value = await input.proxy.readObservedNativeTrainingPlan({
      fixtureScope: scope,
      accountUid,
      planId,
    });
    const phase = apiReads.length === 0 ? 'after' : 'reopened';
    apiReads.push({
      phase,
      status: value.status,
      plan: value.plan,
      verification: value.verification,
    });
    return {
      status: value.status,
      plan: value.plan,
      verification: value.verification,
    };
  };
  const verifyScreenshot = async (
    receipt: unknown,
    options: { signal?: AbortSignal; deadlineAt: number },
  ): Promise<Buffer> => {
    const row = record(receipt, 'Save/retry screenshot receipt');
    assert.equal(row.artifactRoot, output);
    const name = requireOwnedSnapshotPath(output, row.snapshotPath);
    const lifecycle: DetoxConnectionEvidenceLifecycle = {
      signal: options.signal,
      deadlineAt: options.deadlineAt,
    };
    return readOwnedDetoxConnectionFile(output, name, 16 * 1024 * 1024, lifecycle);
  };
  let result: Awaited<ReturnType<typeof runDetoxSaveRetryJourney>>;
  try {
    result = await runDetoxSaveRetryJourney({
      runId: input.fixtures.runId,
      attemptId: `${input.fixtures.runId}:first`,
      platform,
      accountUid,
      targetOrigin: input.session.apiOrigin,
      requestIdFence: coachAuthTransition.beforeRequestId,
      child: input.child,
      proxy: input.proxy,
      snapshot,
      readPlan,
      validators: {
        requireDraft: requireNativeRetryDraft,
        validateSnapshots: (
          before: DetoxSaveRetrySnapshot,
          failed: DetoxSaveRetrySnapshot,
          after: DetoxSaveRetrySnapshot,
          accountUid: string,
          currentPlatform: 'ios' | 'android',
        ) =>
          validateNativeRetrySnapshots(
            asOwnedDomainSnapshot(before),
            asOwnedDomainSnapshot(failed),
            asOwnedDomainSnapshot(after),
            accountUid,
            currentPlatform,
          ),
      },
      verifyScreenshot,
      signal: input.signal,
      deadlineAtMonotonicMs: input.deadlineAt,
      deadlineMs: Math.ceil(input.deadlineAt - performance.now()),
      errorText: enUS['pro.plan.error.save'],
      faultAttemptId: faultIdentity.faultAttemptId,
    });
  } catch (error) {
    input.report.detoxSaveRetrySnapshots = snapshots;
    input.report.detoxSaveRetryApiReads = apiReads;
    input.report.detoxSaveRetryTerminal = createDetoxSaveRetryTerminalFailure({
      error,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      faultIdentity,
      coachAuthTransition,
      childIdentity: input.childIdentity,
      childTerminalState: input.child.terminalState?.(),
      faultState: input.proxy.faultState,
      proxyObservations: input.proxy.observations,
      evidenceRefs: [
        ...(input.child.terminalState?.() ?? []).flatMap((row) => [
          ...row.evidenceRefs,
          row.responsePath,
          row.cancelPath,
        ]),
        ...(typeof input.report.detoxTransportSourceReceipt === 'object' &&
        input.report.detoxTransportSourceReceipt &&
        typeof (input.report.detoxTransportSourceReceipt as Record<string, unknown>).path ===
          'string'
          ? [(input.report.detoxTransportSourceReceipt as Record<string, unknown>).path as string]
          : []),
      ],
    });
    throw error;
  }
  assert.equal(
    snapshotIndex,
    snapshotPhases.length,
    'Detox save/retry snapshot contract is incomplete',
  );
  assert.equal(apiReads.length, 2, 'Detox save/retry API readback contract is incomplete');
  input.report.detoxSaveRetrySnapshots = snapshots;
  input.report.detoxSaveRetryApiReads = apiReads;
  const actionEvidence: Record<string, { sha256: string }> = {};
  for (const commandId of [1, 2, 3, 4]) {
    const name = `detox-save-retry-response-${commandId}.private.json`;
    const bytes = await readOwnedDetoxConnectionFile(input.output, name, 2 * 1024 * 1024, {
      signal: input.signal,
      deadlineAt: input.deadlineAt,
    });
    actionEvidence[name] = { sha256: hashBytes(bytes) };
  }
  const unrelatedValue = {
    kind: 'private-detox-save-retry-unrelated-state',
    name: 'detox-save-retry-unrelated-state.private.json',
    source: 'existing-owner-session-snapshot',
    runId: input.fixtures.runId,
    scope,
    phase: 'before',
    snapshot: snapshots[0].snapshot,
    semanticSha256: hashJson(snapshots[0].snapshot.connections),
  };
  const unrelatedBytes = Buffer.from(`${JSON.stringify(unrelatedValue)}\n`);
  await writeAtomicDetoxConnectionBytes(
    input.output,
    unrelatedValue.name,
    unrelatedBytes,
    2 * 1024 * 1024,
    { signal: input.signal, deadlineAt: input.deadlineAt },
  );
  input.report.detoxSaveRetryActionEvidence = actionEvidence;
  input.report.detoxSaveRetryUnrelatedState = {
    name: unrelatedValue.name,
    sha256: hashBytes(unrelatedBytes),
  };
  const captureStat = await lstat(input.output);
  assert(captureStat.isDirectory() && !captureStat.isSymbolicLink());
  input.report.detoxSaveRetryCaptureRootIdentity = {
    realpath: await realpath(input.output),
    dev: captureStat.dev,
    ino: captureStat.ino,
    uid: captureStat.uid,
    gid: captureStat.gid,
    mode: captureStat.mode,
    nlink: captureStat.nlink,
  };
  input.report.detoxSaveRetry = {
    kind: 'private-detox-save-retry-owned-dispatch',
    selection: freshSelection,
    coachAuthTransition,
    faultIdentity,
    runId: input.fixtures.runId,
    attemptId: `${input.fixtures.runId}:first`,
    platform,
    accountUid,
    targetOrigin: input.session.apiOrigin,
    apiPid: input.session.apiPid,
    childIdentity: input.childIdentity,
    result,
    nativePassingCases: 0,
    publicPromotionEligible: false,
    cleanupOwner: 'existing-detox-connection-driver-aggregate',
  };
  const producerToken = randomBytes(32).toString('hex');
  input.report.detoxSaveRetryOwnerInvocation = 'owned-detox-save-retry-producer-v2';
  input.report.detoxSaveRetryProducerToken = producerToken;
  input.report.detoxSaveRetryRuntimeSource = await createDetoxSaveRetryOwnerRuntimeSource({
    repositoryRoot: input.repositoryRoot,
    captureRoot: input.output,
    report: input.report,
    build: input.producerContext.build,
    runtimeMetadata: input.producerContext.runtimeMetadata,
    producerToken,
    lifecycle: {
      signal: input.signal,
      deadlineAtMonotonicMs: input.deadlineAt,
    },
  });
  return result;
}

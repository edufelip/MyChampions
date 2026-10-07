import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_DETOX_CLEANUP_DEADLINE_MS,
  runDetoxCleanupStep,
  type DetoxCleanupRecoveryStatus,
} from './detox-connection-lifecycle';
import {
  applyDetoxElementAttributeEvidence,
  normalizeDetoxElementAttributes,
  parseDetoxViewHierarchyXml,
  type DetoxElementAttributesResult,
} from './detox-native-hierarchy';
import {
  ANDROID_CONNECTION_PLATFORM,
  CONNECTION_SNAPSHOT_KEYS,
  CONNECTION_PURPOSE_PLANS,
  IOS_CONNECTION_PLATFORM,
  type ConnectionActor,
  type ConnectionNavigation,
  type ConnectionPlatformProfile,
} from './native-connection-platform-contract';
import {
  nativeConnectionAssertionIds,
  nativeConnectionAssertionSemanticSha256,
  requireNativePilotAssertions,
  type NativePilotSelection,
} from './native-pilot-contract';
import { assertArtifactPath } from './schema-validation';
import type { SharedConnectionRuntimeContext } from './native-connection-journey-core';

const RUN_ID = /^[a-f0-9]{24}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_NON_COOPERATIVE_DRAIN_MS = 30_000;

/** The adapter is intentionally source-only until a real Detox caller is wired. */
export const DETOX_CONNECTION_ADAPTER_STATUS = 'candidate-only' as const;

export const DETOX_CONNECTION_FIXTURE_OVERRIDE_KEYS = Object.freeze([
  'EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE',
  'EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD',
  'EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE',
  'EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE',
  'EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE',
] as const);

type DetoxPlatform = 'ios' | 'android';
type SharedAccountSwitchResult = Awaited<
  ReturnType<SharedConnectionRuntimeContext['switchAccount']>
>;

export type DetoxConnectionFixtureEnvironment = Readonly<
  Record<(typeof DETOX_CONNECTION_FIXTURE_OVERRIDE_KEYS)[number], string | undefined>
>;

export type DetoxConnectionSelection = NativePilotSelection;

export type DetoxConnectionSourceIdentity = Readonly<{
  sourceTreeHash: string;
  helperInputsHash: string;
}>;

export type DetoxConnectionSessionBinding = Readonly<{
  captureRunId: string;
  backendRunId: string;
  sourceIdentity: DetoxConnectionSourceIdentity;
}>;

export type DetoxConnectionCleanupReason =
  | 'completed'
  | 'selection-rejected'
  | 'acquisition-failed'
  | 'journey-failed'
  | 'cancelled'
  | 'deadline';

export type DetoxConnectionCleanupResult = Readonly<{
  status: 'cleaned' | 'failed';
  recoveryStatus: DetoxCleanupRecoveryStatus;
  failures: readonly string[];
  recoveryRecordPath?: string | null;
}>;

export type DetoxConnectionDrainEvent = Readonly<{
  label: string;
  configuredMs: number;
  usedMs: number;
  settledAfterCancellation: boolean;
}>;

export type DetoxConnectionDeadlineAccounting = Readonly<{
  configuredMs: number;
  drainGraceMs: number;
  drainGraceUsedMs: number;
  deadlineReached: boolean;
  elapsedMs: number;
  status: 'within-budget' | 'deadline-reached' | 'drain-grace-used' | 'recovery-not-verified';
  drainEvents: readonly DetoxConnectionDrainEvent[];
}>;

export type DetoxConnectionObservedHierarchy = Readonly<{
  xml: string;
  elementAttributes?: DetoxElementAttributesResult | readonly DetoxElementAttributesResult[];
}>;

/**
 * The UI bridge is the only place where a future Detox test may touch Detox.
 * `semanticActions` are retained for source binding; the caller must execute
 * equivalent Detox actions and return the actual XML/getAttributes bytes.
 */
export type DetoxConnectionUiBridge = Readonly<{
  observeStep(input: {
    label: string;
    semanticActions: string;
    viewId: string;
    selectors: string | string[];
    kind?: 'id' | 'text';
    signal: AbortSignal;
  }): Promise<DetoxConnectionObservedHierarchy>;
  switchAccount(
    actor: ConnectionActor,
    navigation: ConnectionNavigation,
    signal: AbortSignal,
  ): Promise<SharedAccountSwitchResult>;
}>;

export type DetoxConnectionContextBase = Omit<
  SharedConnectionRuntimeContext,
  'observe' | 'switchAccount'
>;

export type DetoxConnectionLedgerStatus = 'passed' | 'failed' | 'blocked';

export type DetoxConnectionLedgerRow = Readonly<{
  id: string;
  actor: ConnectionActor;
  navigation: ConnectionNavigation;
  status: DetoxConnectionLedgerStatus;
  evidenceKinds: readonly ('ui' | 'api' | 'sql')[];
  targetConnectionId: string | null;
  bound: boolean;
  phase: string;
  failure?: Readonly<{ name: string; message: string }>;
}>;

export type DetoxConnectionJourneyReport = Record<string, unknown> & {
  connectionJourneyPreparation: Record<string, unknown>;
  detoxConnectionLedger: readonly DetoxConnectionLedgerRow[];
  nativePassingCases?: 0;
  publicPromotionEligible?: false;
};

export type DetoxConnectionAcquiredSession = Readonly<{
  context: SharedConnectionRuntimeContext;
  binding: DetoxConnectionSessionBinding;
  cleanup(input: {
    reason: DetoxConnectionCleanupReason;
    signal: AbortSignal;
    /** Absolute monotonic deadline shared with the outer cleanup fence. */
    deadlineAt?: number;
  }): Promise<DetoxConnectionCleanupResult>;
}>;

export type DetoxConnectionLifecycle = Readonly<{
  acquire(input: {
    selection: DetoxConnectionSelection;
    signal: AbortSignal;
  }): Promise<DetoxConnectionAcquiredSession>;
}>;

export type DetoxConnectionJourneyExecutor = (input: {
  context: SharedConnectionRuntimeContext;
  selection: DetoxConnectionSelection;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  onDrain?: (event: DetoxConnectionDrainEvent) => void;
}) => Promise<void>;

export type DetoxConnectionRuntimeContextOptions = Readonly<{
  /**
   * Maximum time to wait for an SDK operation to settle after cancellation.
   * This bounds the orchestration fence; it is not an OS hard real-time claim.
   */
  nonCooperativeDrainMs?: number;
  onDrain?: (event: DetoxConnectionDrainEvent) => void;
}>;

export type DetoxConnectionJourneyObserver = (
  context: SharedConnectionRuntimeContext,
  options: {
    repositoryRoot: string;
    requestedRunId: string;
    selection: DetoxConnectionSelection;
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
  },
) => Promise<void>;

export type DetoxConnectionFailure = Readonly<{
  phase: 'selection' | 'fixture' | 'acquisition' | 'journey' | 'ledger' | 'cleanup';
  name: string;
  message: string;
}>;

export type DetoxConnectionAttemptResult = Readonly<{
  kind: 'private-detox-connection-attempt-not-public-receipt';
  status: 'source-only' | 'blocked' | 'cancelled' | 'deadline';
  selectionValid: boolean;
  acquired: boolean;
  cleanup: 'not-acquired' | 'cleaned' | 'failed';
  report: Record<string, unknown> | null;
  ledger: readonly DetoxConnectionLedgerRow[];
  failures: readonly DetoxConnectionFailure[];
  recoveryStatus: DetoxCleanupRecoveryStatus | 'not-applicable';
  deadlineAccounting: DetoxConnectionDeadlineAccounting | null;
  nativePassingCases: 0;
  publicPromotionEligible: false;
}>;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function failure(phase: DetoxConnectionFailure['phase'], error: unknown): DetoxConnectionFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
  };
}

function partialCleanupStatus(error: unknown): DetoxConnectionAttemptResult['cleanup'] | null {
  if (!error || typeof error !== 'object' || !('detoxCleanupStatus' in error)) return null;
  const value = (error as Record<string, unknown>).detoxCleanupStatus;
  return value === 'cleaned' || value === 'failed' ? value : null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('Detox connection operation was cancelled');
}

type DetoxConnectionSettled<T> = { ok: true; value: T } | { ok: false; error: Error };

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Detox connection operation was cancelled');
}

function nonCooperativeError(label: string, drainMs: number, signal: AbortSignal): Error {
  const reason = signal.reason instanceof Error ? `: ${signal.reason.message}` : '';
  const error = new Error(
    `${label} did not settle within ${drainMs}ms after cancellation${reason}`,
  );
  error.name = 'DetoxConnectionNonCooperativeError';
  return error;
}

async function waitForSettled<T>(
  settled: Promise<DetoxConnectionSettled<T>>,
  timeoutMs: number,
): Promise<DetoxConnectionSettled<T> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Keep the v2 lifetime fence while bounding a non-cooperative SDK operation.
 * The operation is observed until it settles, but cancellation cannot leave
 * the orchestration promise pending forever. The caller still owns cleanup;
 * this helper only reports the bounded fence failure.
 */
async function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  options: Readonly<{
    label: string;
    nonCooperativeDrainMs?: number;
    onDrain?: (event: DetoxConnectionDrainEvent) => void;
  }>,
): Promise<T> {
  const drainMs = options.nonCooperativeDrainMs ?? DEFAULT_NON_COOPERATIVE_DRAIN_MS;
  assert(Number.isSafeInteger(drainMs) && drainMs > 0, 'Detox operation drain bound is invalid');
  const settled: Promise<DetoxConnectionSettled<T>> = operation.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error : new Error(String(error)),
    }),
  );
  const drain = async (): Promise<DetoxConnectionSettled<T> | null> => {
    const startedAt = performance.now();
    const drained = await waitForSettled(settled, drainMs);
    options.onDrain?.({
      label: options.label,
      configuredMs: drainMs,
      usedMs: performance.now() - startedAt,
      settledAfterCancellation: drained !== null,
    });
    return drained;
  };
  let removeAbortListener = () => {};
  const abort = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError(signal));
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    let first: DetoxConnectionSettled<T>;
    try {
      first = await Promise.race([settled, abort]);
    } catch (error) {
      if (!signal.aborted) throw error;
      const drained = await drain();
      if (drained === null) throw nonCooperativeError(options.label, drainMs, signal);
      throw abortError(signal);
    }
    if (signal.aborted) {
      const drained = await drain();
      if (drained === null) throw nonCooperativeError(options.label, drainMs, signal);
      throw abortError(signal);
    }
    if (first.ok) return first.value;
    throw first.error;
  } finally {
    removeAbortListener();
  }
}

function platformProfile(platform: DetoxPlatform): ConnectionPlatformProfile {
  return platform === 'ios' ? IOS_CONNECTION_PLATFORM : ANDROID_CONNECTION_PLATFORM;
}

function expectedConnectionIdForPurpose(id: string): boolean {
  return id !== 'NAT-connection-normal-entry';
}

function assertHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && SHA256.test(value), `${label} must be a SHA-256 hash`);
}

function assertSelectionShape(selection: DetoxConnectionSelection): void {
  const args = asRecord(selection.arguments, 'Detox connection selection arguments');
  const platform = args.platform;
  assert(platform === 'ios' || platform === 'android', 'Detox connection platform is unsupported');
  assert.equal(args.engine, 'detox', 'Detox connection selection must use the Detox engine');
  assert.equal(args.scenario, `SCN-connection-${platform}`);
  assert.equal(args.mode, 'integration');
  const scenario = asRecord(selection.scenario, 'Detox connection scenario');
  assert.equal(scenario.id, args.scenario);
  assert.equal(scenario.platform, platform);
  assert.equal(scenario.flowId, 'FLW-connection');
  assert.equal(scenario.dataMode, 'postgres');
  assert.equal(scenario.fixtureRef, `owned-postgres:${scenario.id}:fresh-attempt`);
  if (scenario.engine !== undefined) assert.equal(scenario.engine, 'detox');
  assert.deepEqual(scenario.roles, ['student', 'coach']);
  const contract = asRecord(scenario.pilotAssertionContract, 'Detox connection assertion contract');
  assert.equal(contract.count, nativeConnectionAssertionIds.length);
  assert.equal(contract.dataMode, 'postgres');
  assert.equal(contract.semanticSha256, nativeConnectionAssertionSemanticSha256);
  assertHash(selection.scenarioHash, 'Detox connection scenario hash');
  assertHash(selection.requirementHash, 'Detox connection requirement hash');
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...nativeConnectionAssertionIds],
    'Detox connection assertion IDs changed from the shared contract',
  );
}

/** Validate the Detox selection before any lock, target, child, or API acquisition. */
export function requireDetoxConnectionSelection(value: unknown): DetoxConnectionSelection {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assertSelectionShape(value as DetoxConnectionSelection);
  return value as DetoxConnectionSelection;
}

/** Reject fixture profiles that can make a Detox run synthetic or seeded. */
export function requireNoDetoxFixtureOverrides(
  environment: DetoxConnectionFixtureEnvironment,
): void {
  for (const key of DETOX_CONNECTION_FIXTURE_OVERRIDE_KEYS)
    assert(
      environment[key] === undefined || environment[key] === '',
      `Detox integrated connection cannot use fixture override ${key}`,
    );
}

function requireSessionBinding(value: unknown): DetoxConnectionSessionBinding {
  const row = asRecord(value, 'Detox connection session binding');
  assert(typeof row.captureRunId === 'string' && RUN_ID.test(row.captureRunId));
  assert(typeof row.backendRunId === 'string' && RUN_ID.test(row.backendRunId));
  assert.notEqual(row.captureRunId, row.backendRunId);
  const sourceIdentity = asRecord(row.sourceIdentity, 'Detox connection source identity');
  assertHash(sourceIdentity.sourceTreeHash, 'Detox source tree identity');
  assertHash(sourceIdentity.helperInputsHash, 'Detox helper input identity');
  return row as unknown as DetoxConnectionSessionBinding;
}

function requireRuntimeContext(
  context: SharedConnectionRuntimeContext,
  platform: DetoxPlatform,
): void {
  assert(typeof context.output === 'string' && context.output.length > 0);
  assert.equal(context.fixtures.scope, `native-entry-${platform}`);
  const fixtures = asRecord(context.fixtures, 'Detox connection fixtures');
  const accounts = asRecord(fixtures.accounts, 'Detox connection accounts');
  for (const actor of ['coach', 'student'] as const) {
    const account = asRecord(accounts[actor], `Detox ${actor} account`);
    assert(typeof account.authUid === 'string' && account.authUid.length > 0);
  }
  assert(Number.isSafeInteger(context.apiIdentity.apiPid) && context.apiIdentity.apiPid > 1);
  assert.match(context.apiIdentity.targetOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert(Array.isArray(context.proxy.observations));
  assert(Array.isArray(context.proxy.nativeAuthIdentities));
}

function requireLedger(
  report: Record<string, unknown>,
  selection: DetoxConnectionSelection,
): { rows: readonly DetoxConnectionLedgerRow[]; complete: boolean; connectionId: string } {
  const preparation = asRecord(
    report.connectionJourneyPreparation,
    'Detox connection preparation report',
  );
  assert.equal(preparation.nativePassingCases, 0);
  const binding = asRecord(preparation.binding, 'Detox connection binding');
  assert.deepEqual(binding.assertionIds, [...nativeConnectionAssertionIds]);
  const boundSelection = asRecord(binding.selection, 'Detox connection bound selection');
  assert.deepEqual(boundSelection.arguments, selection.arguments);
  assert.equal(boundSelection.scenarioHash, selection.scenarioHash);
  assert.equal(boundSelection.requirementHash, selection.requirementHash);
  const snapshots = asRecord(preparation.snapshots, 'Detox connection snapshots');
  assert.deepEqual(Object.keys(snapshots).sort(), [...CONNECTION_SNAPSHOT_KEYS].sort());
  assert.equal(preparation.isolationUnchanged, true);
  assert.equal(preparation.trainingPlansUnchanged, true);
  const transportWindows = preparation.transportWindows;
  assert(Array.isArray(transportWindows), 'Detox connection transport windows are missing');
  const transport = transportWindows.map((value) => asRecord(value, 'Detox transport window'));
  assert(
    transport.some(
      (row) =>
        row.method === 'POST' &&
        row.route === '/connections/invite-submissions' &&
        row.status === 201 &&
        row.unique === true,
    ),
    'Detox connection 201 submission window is missing',
  );
  const dynamicConnectionId = preparation.connectionId;
  assert(
    typeof dynamicConnectionId === 'string' &&
      dynamicConnectionId.length > 0 &&
      !/(?:NUT123|e2e-|seed|fixture)/i.test(dynamicConnectionId),
    'Detox connection ID is missing or synthetic',
  );
  assert(
    transport.some(
      (row) =>
        row.method === 'POST' &&
        row.route === `/connections/${dynamicConnectionId}/confirm` &&
        row.status === 200 &&
        row.unique === true,
    ),
    'Detox connection 200 confirmation window is missing',
  );
  assert(transport.some((row) => row.method === 'GET' && row.route === '/connections'));
  assert(transport.some((row) => row.method === 'GET' && row.route === '/professional/students'));
  const rawLedger = report.detoxConnectionLedger;
  assert(Array.isArray(rawLedger), 'Detox connection seven-row ledger is missing');
  assert.equal(rawLedger.length, nativeConnectionAssertionIds.length);
  assert.equal(
    new Set(rawLedger.map((row) => asRecord(row, 'Detox connection ledger row').id)).size,
    rawLedger.length,
    'Detox connection ledger contains duplicate purposes',
  );
  const profile = platformProfile(selection.arguments.platform);
  const purposePlan = buildPurposePlan(profile);
  const rows = rawLedger.map((raw, index) => {
    const row = asRecord(raw, 'Detox connection ledger row');
    const expected = purposePlan[index];
    assert.equal(row.id, expected.id, 'Detox connection ledger purpose order changed');
    assert.equal(row.actor, expected.actor);
    assert.equal(row.navigation, expected.navigation);
    assert.equal(row.phase && typeof row.phase === 'string', true);
    assert(row.status === 'passed' || row.status === 'failed' || row.status === 'blocked');
    assert.deepEqual(row.evidenceKinds, expected.requiredEvidence);
    assert.equal(row.bound, true);
    const targetConnectionId = row.targetConnectionId;
    assert(
      targetConnectionId === null ||
        (typeof targetConnectionId === 'string' && targetConnectionId === dynamicConnectionId),
      `Detox connection ledger ${expected.id} has an unbound target ID`,
    );
    if (expectedConnectionIdForPurpose(expected.id))
      assert.equal(targetConnectionId, dynamicConnectionId);
    if (row.status !== 'passed') {
      const error = asRecord(row.failure, `Detox ${expected.id} failure`);
      assert(typeof error.name === 'string' && error.name.length > 0);
      assert(typeof error.message === 'string' && error.message.length > 0);
    }
    return row as unknown as DetoxConnectionLedgerRow;
  });
  return {
    rows,
    complete: rows.every((row) => row.status === 'passed'),
    connectionId: dynamicConnectionId,
  };
}

function buildPurposePlan(profile: ConnectionPlatformProfile) {
  const plan = CONNECTION_PURPOSE_PLANS;
  assert.equal(profile.scenarioId, `SCN-connection-${profile.platform}`);
  assert.equal(plan.length, nativeConnectionAssertionIds.length);
  return plan;
}

/**
 * Wrap the owned session context with the actual Detox XML/actionability seam.
 * This function contains no Detox globals and cannot run a target by itself.
 */
export function createDetoxConnectionRuntimeContext(
  base: DetoxConnectionContextBase,
  ui: DetoxConnectionUiBridge,
  signal: AbortSignal,
  options: DetoxConnectionRuntimeContextOptions = {},
): SharedConnectionRuntimeContext {
  assert(typeof base.output === 'string' && base.output.length > 0);
  assert(
    base.fixtures.scope === 'native-entry-ios' || base.fixtures.scope === 'native-entry-android',
    'Detox connection context scope is unsupported',
  );
  const platform = base.fixtures.scope === 'native-entry-ios' ? 'ios' : 'android';
  return {
    ...base,
    observe: async (label, actions, viewId, selectors, kind = 'id') => {
      throwIfAborted(signal);
      assert.match(label, /^[a-z0-9-]+$/);
      assert(typeof actions === 'string' && actions.length > 0);
      assert(typeof viewId === 'string' && viewId.length > 0);
      const observed = await raceWithAbort(
        ui.observeStep({
          label,
          semanticActions: actions,
          viewId,
          selectors,
          kind,
          signal,
        }),
        signal,
        {
          label: `Detox observe step ${label}`,
          nonCooperativeDrainMs: options.nonCooperativeDrainMs,
          onDrain: options.onDrain,
        },
      );
      throwIfAborted(signal);
      assert(typeof observed.xml === 'string' && observed.xml.length > 0);
      const tree = parseDetoxViewHierarchyXml(observed.xml, platform);
      if (observed.elementAttributes !== undefined)
        applyDetoxElementAttributeEvidence(tree, observed.elementAttributes);
      await writeFile(
        assertArtifactPath(base.output, `${label}-hierarchy.json`),
        JSON.stringify(tree),
        { flag: 'wx', mode: 0o600 },
      );
    },
    switchAccount: async (actor, navigation = 'none') => {
      throwIfAborted(signal);
      const result = await raceWithAbort(ui.switchAccount(actor, navigation, signal), signal, {
        label: `Detox account switch ${actor}`,
        nonCooperativeDrainMs: options.nonCooperativeDrainMs,
        onDrain: options.onDrain,
      });
      throwIfAborted(signal);
      return result;
    },
  };
}

function composeDeadlineSignal(
  parent: AbortSignal,
  deadlineMs: number,
  requestedDeadlineAtMonotonicMs?: number,
): {
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
  dispose(): void;
  deadlineReached: () => boolean;
  parentCancelled: () => boolean;
  accounting: (input: {
    drainGraceMs: number;
    drainEvents: readonly DetoxConnectionDrainEvent[];
    recoveryStatus: DetoxCleanupRecoveryStatus | 'not-applicable';
  }) => DetoxConnectionDeadlineAccounting;
} {
  assert(
    Number.isSafeInteger(deadlineMs) && deadlineMs > 0,
    'Detox connection deadline is invalid',
  );
  const controller = new AbortController();
  const startedAt = performance.now();
  const deadlineAtMonotonicMs = requestedDeadlineAtMonotonicMs ?? startedAt + deadlineMs;
  assert(
    Number.isFinite(deadlineAtMonotonicMs) && deadlineAtMonotonicMs > startedAt,
    'Detox connection absolute deadline is invalid or elapsed',
  );
  let deadlineReached = false;
  let parentCancelled = false;
  const timer = setTimeout(
    () => {
      deadlineReached = true;
      controller.abort(new Error('Detox connection deadline elapsed'));
    },
    Math.max(1, Math.ceil(deadlineAtMonotonicMs - performance.now())),
  );
  const onAbort = () => {
    parentCancelled = true;
    controller.abort(parent.reason);
  };
  if (parent.aborted) onAbort();
  else parent.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    deadlineAtMonotonicMs,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
    deadlineReached: () => deadlineReached,
    parentCancelled: () => parentCancelled,
    accounting: ({ drainGraceMs, drainEvents, recoveryStatus }) => {
      const drainGraceUsedMs = drainEvents.reduce((total, event) => total + event.usedMs, 0);
      const status =
        recoveryStatus === 'not-verified'
          ? 'recovery-not-verified'
          : drainGraceUsedMs > 0
            ? 'drain-grace-used'
            : deadlineReached
              ? 'deadline-reached'
              : 'within-budget';
      return {
        configuredMs: deadlineMs,
        drainGraceMs,
        drainGraceUsedMs,
        deadlineReached,
        elapsedMs: performance.now() - startedAt,
        status,
        drainEvents: [...drainEvents],
      };
    },
  };
}

function throwIfDeadline(
  deadline: Readonly<{ signal: AbortSignal; deadlineAtMonotonicMs: number }>,
  phase: string,
): void {
  throwIfAborted(deadline.signal);
  if (performance.now() >= deadline.deadlineAtMonotonicMs)
    throw new Error(`Detox connection deadline elapsed during ${phase}`);
  throwIfAborted(deadline.signal);
}

function emptyResult(
  status: DetoxConnectionAttemptResult['status'],
  selectionValid: boolean,
  failures: readonly DetoxConnectionFailure[],
): DetoxConnectionAttemptResult {
  return {
    kind: 'private-detox-connection-attempt-not-public-receipt',
    status,
    selectionValid,
    acquired: false,
    cleanup: 'not-acquired',
    report: null,
    ledger: [],
    failures,
    recoveryStatus: 'not-applicable',
    deadlineAccounting: null,
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
}

/**
 * Source-side lifecycle around a future owned Detox connection caller.
 * Acquisition, UI action execution and cleanup remain injected so this
 * candidate cannot accidentally claim an unowned native resource.
 */
export async function runDetoxIntegratedConnectionBaseline(options: {
  repositoryRoot: string;
  selection: DetoxConnectionSelection;
  environment: DetoxConnectionFixtureEnvironment;
  signal: AbortSignal;
  deadlineMs?: number;
  deadlineAtMonotonicMs?: number;
  nonCooperativeDrainMs?: number;
  cleanupDeadlineMs?: number;
  lifecycle: DetoxConnectionLifecycle;
  executeJourney: DetoxConnectionJourneyExecutor;
}): Promise<DetoxConnectionAttemptResult> {
  let selection: DetoxConnectionSelection;
  try {
    assert(typeof options.repositoryRoot === 'string' && options.repositoryRoot.length > 0);
    selection = requireDetoxConnectionSelection(options.selection);
  } catch (error) {
    return emptyResult('blocked', false, [failure('selection', error)]);
  }
  try {
    requireNoDetoxFixtureOverrides(options.environment);
  } catch (error) {
    return {
      ...emptyResult('blocked', true, [failure('fixture', error)]),
    };
  }
  const parentSignal = options.signal;
  if (parentSignal.aborted)
    return emptyResult('cancelled', true, [failure('selection', parentSignal.reason)]);
  const configuredDeadlineMs = options.deadlineMs ?? 300_000;
  const requestedDeadlineAt =
    options.deadlineAtMonotonicMs ?? performance.now() + configuredDeadlineMs;
  if (!Number.isFinite(requestedDeadlineAt) || requestedDeadlineAt <= performance.now())
    return emptyResult('deadline', true, [
      failure('selection', new Error('Detox connection absolute deadline is invalid or elapsed')),
    ]);
  const deadline = composeDeadlineSignal(parentSignal, configuredDeadlineMs, requestedDeadlineAt);
  const drainEvents: DetoxConnectionDrainEvent[] = [];
  let recoveryStatus: DetoxConnectionAttemptResult['recoveryStatus'] = 'not-applicable';
  const onDrain = (event: DetoxConnectionDrainEvent) => {
    drainEvents.push(event);
    if (!event.settledAfterCancellation) recoveryStatus = 'not-verified';
  };
  let acquired: DetoxConnectionAcquiredSession | null = null;
  let report: Record<string, unknown> | null = null;
  let ledger: readonly DetoxConnectionLedgerRow[] = [];
  const failures: DetoxConnectionFailure[] = [];
  let cleanupStatus: DetoxConnectionAttemptResult['cleanup'] = 'not-acquired';
  let executionStatus: DetoxConnectionAttemptResult['status'] = 'source-only';
  let cleanupReason: DetoxConnectionCleanupReason = 'completed';
  try {
    throwIfAborted(deadline.signal);
    acquired = await raceWithAbort(
      options.lifecycle.acquire({ selection, signal: deadline.signal }),
      deadline.signal,
      {
        label: 'Detox connection acquisition',
        nonCooperativeDrainMs: options.nonCooperativeDrainMs,
        onDrain,
      },
    );
    requireSessionBinding(acquired.binding);
    requireRuntimeContext(acquired.context, selection.arguments.platform);
    throwIfAborted(deadline.signal);
    try {
      await raceWithAbort(
        options.executeJourney({
          context: acquired.context,
          selection,
          signal: deadline.signal,
          deadlineAtMonotonicMs: deadline.deadlineAtMonotonicMs,
          onDrain,
        }),
        deadline.signal,
        {
          label: 'Detox connection journey',
          nonCooperativeDrainMs: options.nonCooperativeDrainMs,
          onDrain,
        },
      );
      throwIfDeadline(deadline, 'journey publication');
      report = acquired.context.report;
      try {
        const validated = requireLedger(report, selection);
        ledger = validated.rows;
        if (!validated.complete) {
          failures.push(
            failure('ledger', new Error('Detox connection ledger contains failed or blocked rows')),
          );
          executionStatus = 'blocked';
          cleanupReason = 'journey-failed';
        }
      } catch (error) {
        failures.push(failure('ledger', error));
        executionStatus = 'blocked';
        cleanupReason = 'journey-failed';
      }
    } catch (error) {
      report = acquired.context.report;
      const rawLedger = report.detoxConnectionLedger;
      if (Array.isArray(rawLedger)) ledger = rawLedger as readonly DetoxConnectionLedgerRow[];
      if (deadline.deadlineReached()) {
        executionStatus = 'deadline';
        cleanupReason = 'deadline';
      } else if (deadline.parentCancelled()) {
        executionStatus = 'cancelled';
        cleanupReason = 'cancelled';
      } else {
        executionStatus = 'blocked';
        cleanupReason = 'journey-failed';
      }
      failures.push(failure('journey', error));
    }
  } catch (error) {
    report = acquired?.context.report ?? null;
    const partialCleanup = partialCleanupStatus(error);
    if (partialCleanup) {
      cleanupStatus = partialCleanup;
      if (partialCleanup === 'failed') {
        executionStatus = 'blocked';
        failures.push(failure('cleanup', new Error('Partial Detox acquisition cleanup failed')));
      }
    }
    if (deadline.deadlineReached()) {
      if (partialCleanup !== 'failed') executionStatus = 'deadline';
      cleanupReason = 'deadline';
    } else if (deadline.parentCancelled()) {
      if (partialCleanup !== 'failed') executionStatus = 'cancelled';
      cleanupReason = 'cancelled';
    } else {
      if (partialCleanup !== 'failed') executionStatus = 'blocked';
      cleanupReason = 'acquisition-failed';
    }
    failures.push(failure('acquisition', error));
  } finally {
    if (acquired) {
      const cleanupController = new AbortController();
      const cleanupDeadlineMs = options.cleanupDeadlineMs ?? DEFAULT_DETOX_CLEANUP_DEADLINE_MS;
      assert(
        Number.isSafeInteger(cleanupDeadlineMs) && cleanupDeadlineMs > 0,
        'Detox cleanup deadline is invalid',
      );
      const cleanupDeadlineAt = performance.now() + cleanupDeadlineMs;
      try {
        const bounded = await runDetoxCleanupStep({
          label: 'Detox connection aggregate cleanup',
          deadlineAt: cleanupDeadlineAt,
          signal: cleanupController.signal,
          operation: () =>
            acquired?.cleanup({
              reason: cleanupReason,
              signal: cleanupController.signal,
              deadlineAt: cleanupDeadlineAt,
            }) ?? Promise.reject(new Error('Detox acquired session disappeared before cleanup')),
          onTimeout: () =>
            cleanupController.abort(new Error('Detox aggregate cleanup deadline elapsed')),
        });
        if (bounded.status === 'settled') {
          assert(bounded.value !== undefined, 'Detox cleanup settled without a result');
          const result = bounded.value;
          assert(result.status === 'cleaned' || result.status === 'failed');
          assert(Array.isArray(result.failures));
          cleanupStatus = result.status;
          recoveryStatus =
            (recoveryStatus as DetoxCleanupRecoveryStatus | 'not-applicable') === 'not-verified'
              ? 'not-verified'
              : result.recoveryStatus;
          if (result.status === 'failed') {
            executionStatus = 'blocked';
            failures.push(
              failure('cleanup', new Error(result.failures.join('; ') || 'Detox cleanup failed')),
            );
          }
        } else {
          cleanupStatus = 'failed';
          recoveryStatus = 'not-verified';
          executionStatus = 'blocked';
          failures.push(failure('cleanup', bounded.error));
        }
      } catch (error) {
        cleanupStatus = 'failed';
        recoveryStatus = 'not-verified';
        executionStatus = 'blocked';
        failures.push(failure('cleanup', error));
      }
    }
    deadline.dispose();
  }
  // Cleanup implementations may still settle a resource promise on the same
  // monotonic deadline tick after the outer fence returns. Freeze the report
  // handed to the caller so late cleanup publication cannot mutate a result
  // that has already been classified as blocked or unverified.
  const stableReport = report === null ? null : structuredClone(report);
  return {
    kind: 'private-detox-connection-attempt-not-public-receipt',
    status: executionStatus,
    selectionValid: true,
    acquired: acquired !== null,
    cleanup: cleanupStatus,
    recoveryStatus,
    deadlineAccounting: deadline.accounting({
      drainGraceMs: options.nonCooperativeDrainMs ?? DEFAULT_NON_COOPERATIVE_DRAIN_MS,
      drainEvents,
      recoveryStatus,
    }),
    report: stableReport,
    ledger,
    failures,
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
}

/**
 * Bind the lifecycle runner to the existing connection controller once its
 * engine-neutral selection contract is integrated. The observer is selected
 * by the caller (`observeIosConnectionJourney` or
 * `observeAndroidConnectionJourney`) so this candidate does not duplicate the
 * seven-step actor/transport/SQL controller.
 */
export function createDetoxConnectionJourneyExecutor(input: {
  repositoryRoot: string;
  requestedRunId: string;
  observeConnectionJourney: DetoxConnectionJourneyObserver;
}): DetoxConnectionJourneyExecutor {
  assert(typeof input.repositoryRoot === 'string' && input.repositoryRoot.length > 0);
  assert.match(input.requestedRunId, RUN_ID);
  return async ({ context, selection, signal, deadlineAtMonotonicMs, onDrain }) => {
    const lifecycle = { signal, deadlineAtMonotonicMs };
    throwIfDeadline(lifecycle, 'journey observer start');
    await raceWithAbort(
      input.observeConnectionJourney(context, {
        repositoryRoot: input.repositoryRoot,
        requestedRunId: input.requestedRunId,
        selection,
        signal,
        deadlineAtMonotonicMs,
      }),
      signal,
      { label: 'Detox connection journey observer', onDrain },
    );
    throwIfDeadline(lifecycle, 'journey observer completion');
  };
}

/** Kept public for callers/tests that need to bind the actionability shape. */
export function requireDetoxActionabilityEvidence(value: unknown) {
  return normalizeDetoxElementAttributes(value as DetoxElementAttributesResult);
}

/** Prevent accidental mutation of the shared assertion contract by callers. */
export function requireDetoxConnectionAssertionIds(value: unknown): readonly string[] {
  assert.deepEqual(value, [...nativeConnectionAssertionIds]);
  return [...nativeConnectionAssertionIds];
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  readOwnedTrainingFile,
  writeAtomicTrainingJson,
} from './detox-training-child-protocol.mjs';
import { requireNativePilotAssertions } from './native-pilot-contract';
import {
  runNativeTrainingJourney,
  type NativeTrainingApiRead,
  type NativeTrainingJourneyDriver,
  type NativeTrainingJourneyInput,
} from './native-training-journey';
import { enUS } from '../../localization/en-US';
import type {
  DetoxConnectionOwnedProcessIdentity,
  DetoxConnectionSourceReceipt,
} from './detox-connection-ipc';
import type { DetoxTrainingChildClient } from './detox-training-child-client';
import type { NativePilotSelection } from './native-pilot-contract';
import type { ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[a-f0-9]{24}$/;
const PLAN_ID = /^training_plan_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.length > 0) return new Error(value);
  return new Error(fallback);
}

export const DETOX_TRAINING_ASSERTION_IDS = Object.freeze([
  'NAT-training-normal-entry',
  'NAT-training-local-draft',
  'NAT-training-first-save',
  'NAT-training-edit-draft',
  'NAT-training-edited-save',
  'NAT-training-relaunch-read',
  'NAT-training-unrelated-state',
] as const);

type SelectorKind = 'id' | 'text';
type DetoxTrainingAction =
  | Readonly<{
      kind: 'wait-visible' | 'tap' | 'assert-visible' | 'assert-not-visible';
      selector: string;
      selectorKind?: SelectorKind;
    }>
  | Readonly<{ kind: 'replace-text'; selector: string; value: string }>
  | Readonly<{ kind: 'scroll'; container: string; selector: string; direction: 'up' | 'down' }>
  | Readonly<{ kind: 'dismiss-keyboard' }>;

export type DetoxTrainingStep = Readonly<{
  id: string;
  assertionId: (typeof DETOX_TRAINING_ASSERTION_IDS)[number];
  platform: 'ios' | 'android';
  viewId: string;
  selectors: readonly string[];
  actions: readonly DetoxTrainingAction[];
  expectedRendered: Readonly<Record<string, string>>;
}>;

export type DetoxTrainingStepReceipt = Readonly<{
  schemaVersion: 1;
  kind: 'private-detox-training-step-receipt';
  stepId: string;
  assertionId: (typeof DETOX_TRAINING_ASSERTION_IDS)[number];
  runId: string;
  attemptId: string;
  commandId: number;
  commandHash: string;
  platform: 'ios' | 'android';
  viewId: string;
  childIdentity: DetoxConnectionOwnedProcessIdentity;
  selectors: readonly string[];
  rendered: Readonly<Record<string, string>>;
  sourceReceipts: Readonly<{
    xml: DetoxConnectionSourceReceipt;
    screenshot: DetoxConnectionSourceReceipt;
    attributesBefore?: DetoxConnectionSourceReceipt;
    attributesAfter?: DetoxConnectionSourceReceipt;
  }>;
  sourceFiles?: Readonly<{
    xml: string;
    screenshot: string;
    attributesBefore: string;
    attributesAfter: string;
  }>;
  selectorEvidence?: readonly Readonly<{
    selector: string;
    before: unknown;
    after: unknown;
    frameStable: true;
  }>[];
  startedMonotonicMs: number;
  finishedMonotonicMs: number;
  status: 'completed' | 'failed' | 'cancelled';
  actionCompleted: boolean;
  hierarchyCaptured: boolean;
  screenshotCaptured: boolean;
}>;

export type DetoxTrainingRestartReceipt = Readonly<{
  schemaVersion: 1;
  kind: 'private-detox-training-restart-receipt';
  commandId: number;
  commandHash: string;
  status: 'completed' | 'failed' | 'cancelled';
  runId: string;
  attemptId: string;
  platform: 'ios' | 'android';
  appIdentifier: string;
  launchCount: number;
  synchronizationDisabled: true;
  childIdentity: DetoxConnectionOwnedProcessIdentity;
  launchArgsHash: string;
  startedMonotonicMs: number;
  finishedMonotonicMs: number;
  cleanupFence: 'required-before-return';
}>;

/**
 * The connection bridge remains the single owner of the Detox child and its
 * target. Training adds only the typed child step/restart/shutdown protocol; it never
 * accepts a device, backend, proxy, port or process handle.
 */
/** The actual child protocol client; no metadata-only callback bridge is accepted. */
export type DetoxTrainingUiBridge = Pick<
  DetoxTrainingChildClient,
  'runTrainingStep' | 'restartApp' | 'shutdown'
>;

export type DetoxTrainingSourceFileReceipt = Readonly<{
  fileName: string;
  sourcePath: string;
  sourceRealpath: string;
  sourceBytes: number;
  sourceSha256: string;
  sourceMode: number;
  sourceUid?: number;
  sourceNlink?: number;
  sourceDev?: number;
  sourceIno?: number;
  producerPath?: string;
  producerRealpath?: string;
  producerBytes?: number;
  producerSha256?: string;
  producerMode?: number;
  producerUid?: number;
  producerNlink?: number;
  producerDev?: number;
  producerIno?: number;
  producerRetention?: 'owned-snapshot';
  producerSnapshotPath?: string;
  producerSnapshotRealpath?: string;
  producerSnapshotBytes?: number;
  producerSnapshotSha256?: string;
  producerSnapshotMode?: number;
  producerSnapshotUid?: number;
  producerSnapshotNlink?: number;
  producerSnapshotDev?: number;
  producerSnapshotIno?: number;
}>;

export type DetoxTrainingBoundEvidence = Readonly<{
  runId: string;
  attemptId: string;
  targetOrigin: string;
  api: Readonly<{
    apiOrigin: string;
    apiPid: number;
    apiStarted: string;
    backendAttemptId: string;
    manifestSha256: string;
    apiLedgerSha256: string;
    authUid: string;
    fixtureAuthUidAllowlistHash: string;
    source: DetoxTrainingSourceFileReceipt;
  }>;
  sql: Readonly<{
    scope: string;
    apiOrigin: string;
    apiPid: number;
    apiStarted: string;
    backendAttemptId: string;
    manifestSha256: string;
    apiLedgerSha256: string;
    authUid: string;
    source: DetoxTrainingSourceFileReceipt;
    unrelatedBefore: readonly unknown[];
    unrelatedAfter: readonly unknown[];
  }>;
  transport: Readonly<{
    apiOrigin: string;
    apiPid: number;
    apiStarted: string;
    authUid: string;
    nativeAuthIdentities: readonly unknown[];
    source: DetoxTrainingSourceFileReceipt;
  }>;
}>;

export type DetoxTrainingCleanupResult = Readonly<{
  status: 'cleaned' | 'failed';
  failures: readonly string[];
  recoveryRecordPath?: string | null;
}>;

export type DetoxTrainingJourneyOptions = Readonly<{
  repositoryRoot: string;
  output: string;
  selection: NativePilotSelection;
  input: NativeTrainingJourneyInput;
  bridge: DetoxTrainingUiBridge;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  readPlan: (planId: string) => Promise<NativeTrainingApiRead>;
  transport: () => readonly ProxyObservation[];
  targetOrigin: string;
  signal: AbortSignal;
  /** Resolve only after final owned SQL/API/proxy reads have settled. */
  evidence:
    | DetoxTrainingBoundEvidence
    | ((input: {
        signal: AbortSignal;
        deadlineAt: number;
      }) => Promise<DetoxTrainingBoundEvidence> | DetoxTrainingBoundEvidence);
  /**
   * Standalone callers may supply a cleanup owner for focused source tests.
   * The integrated connection path deliberately leaves this unset: the outer
   * connection baseline is the sole aggregate stop/wait/reap owner and folds
   * its result into the terminal attempt record.
   */
  cleanup?(input: {
    reason: 'completed' | 'journey-failed' | 'cancelled' | 'deadline';
    signal: AbortSignal;
    deadlineAt: number;
  }): Promise<DetoxTrainingCleanupResult>;
  deadlineAt?: number;
}>;

function assertHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && SHA256.test(value), `${label} must be a SHA-256 hash`);
}

function assertRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} must be a run ID`);
}

function selectorId(exerciseName: string): string {
  const normalized = exerciseName.trim().replace(/[^A-Za-z0-9_-]+/g, '_');
  assert(normalized.length > 0, 'Training exercise selector is empty');
  return `pro.training_plan.itemRow.${normalized}`;
}

function quantitySelector(exerciseName: string): string {
  return `${selectorId(exerciseName)}.quantity`;
}

function planRowSelector(planId: string): string {
  assert(PLAN_ID.test(planId), 'Training plan selector is not an owned plan ID');
  return `pro.library.training.row.${planId}`;
}

function action(
  kind: DetoxTrainingAction['kind'],
  selector?: string,
  selectorKind: SelectorKind = 'id',
): DetoxTrainingAction {
  if (kind === 'dismiss-keyboard') return { kind };
  assert(selector, `Detox training ${kind} selector is required`);
  return selectorKind === 'id'
    ? ({ kind, selector } as DetoxTrainingAction)
    : ({ kind, selector, selectorKind } as DetoxTrainingAction);
}

function scroll(
  container: string,
  selector: string,
  direction: 'up' | 'down' = 'down',
): DetoxTrainingAction {
  return { kind: 'scroll', container, selector, direction };
}

function replaceText(selector: string, value: string): DetoxTrainingAction {
  assert(value.length > 0 && !/[\r\n]/.test(value), 'Detox training text value is invalid');
  return { kind: 'replace-text', selector, value };
}

function step(
  platform: 'ios' | 'android',
  id: string,
  assertionId: (typeof DETOX_TRAINING_ASSERTION_IDS)[number],
  viewId: string,
  selectors: readonly string[],
  actions: readonly DetoxTrainingAction[],
  expectedRendered: Readonly<Record<string, string>> = {},
): DetoxTrainingStep {
  assert(selectors.length > 0, `${id} must bind at least one selector`);
  assert(new Set(selectors).size === selectors.length, `${id} has duplicate selectors`);
  return { id, assertionId, platform, viewId, selectors, actions, expectedRendered };
}

/**
 * The exact T14-B UI action plan. It is consumed by a future owned Detox child;
 * this module never translates it into standalone Detox/device calls.
 */
export function buildDetoxTrainingStepPlan(input: {
  platform: 'ios' | 'android';
  title: string;
  exerciseId: string;
  exerciseName: string;
  planId?: string;
}): readonly DetoxTrainingStep[] {
  assert(input.exerciseId.length > 0 && !/[\r\n]/.test(input.exerciseId));
  assert(input.exerciseName.trim() === input.exerciseName && input.exerciseName.length > 0);
  assert(input.title.length > 0 && !/[\r\n]/.test(input.title));
  const item = selectorId(input.exerciseName);
  const quantity = quantitySelector(input.exerciseName);
  const plan = input.planId ? planRowSelector(input.planId) : undefined;
  const titleUpdated = `${input.title} updated`;
  const steps: DetoxTrainingStep[] = [
    step(
      input.platform,
      'training-normal-entry',
      'NAT-training-normal-entry',
      'SCR-training-builder',
      ['pro.training_plan.name'],
      [
        action('wait-visible', 'pro.home.screen'),
        scroll('pro.home.screen', 'pro.home.trainingCta'),
        action('tap', 'pro.home.trainingCta'),
        action('wait-visible', 'pro.library.training.create'),
        action('tap', 'pro.library.training.create'),
        action('wait-visible', 'pro.training_plan.name'),
      ],
    ),
    step(
      input.platform,
      'training-local-draft',
      'NAT-training-local-draft',
      'SCR-training-builder',
      ['pro.training_plan.name', quantity],
      [
        action('tap', 'pro.training_plan.name'),
        replaceText('pro.training_plan.name', input.title),
        action('dismiss-keyboard'),
        scroll('pro.training_plan.screen', 'pro.training_plan.addSession'),
        action('tap', 'pro.training_plan.addSession'),
        replaceText('pro.training_plan.addSession.name', 'Strength'),
        action('tap', 'pro.training_plan.addSession.confirm'),
        action('tap', 'pro.training_plan.sessionRow.Strength.addItem'),
        action('tap', 'exerciseSearch.input'),
        replaceText('exerciseSearch.input', 'QA Exercise'),
        action('tap', `exerciseSearch.result.${input.exerciseId}`),
        action('tap', 'exerciseSearch.quantity'),
        replaceText('exerciseSearch.quantity', '3x8'),
        action('tap', 'exerciseSearch.confirm'),
        action('assert-visible', quantity),
      ],
      { 'pro.training_plan.name': input.title, [quantity]: '3x8' },
    ),
    step(
      input.platform,
      'training-first-save',
      'NAT-training-first-save',
      'SCR-training-library',
      ['pro.library.training.create'],
      [
        scroll('pro.training_plan.screen', 'pro.training_plan.saveButton'),
        action('tap', 'pro.training_plan.saveButton'),
        action('wait-visible', 'pro.library.training.create'),
      ],
    ),
    ...(plan
      ? [
          step(
            input.platform,
            'training-first-reopen',
            'NAT-training-first-save',
            'SCR-training-builder',
            [plan, 'pro.training_plan.name', quantity],
            [
              scroll('pro.library.training.create', plan),
              action('tap', plan),
              action('wait-visible', quantity),
              action('assert-visible', quantity),
            ],
            { 'pro.training_plan.name': input.title, [quantity]: '3x8' },
          ),
        ]
      : []),
    step(
      input.platform,
      'training-edit-draft',
      'NAT-training-edit-draft',
      'STATE-item-removal-confirm',
      ['pro.training_plan.name', item, `${item}.remove`, 'exerciseSearch.input', quantity],
      [
        scroll('pro.training_plan.screen', 'pro.training_plan.name', 'up'),
        action('tap', 'pro.training_plan.name'),
        replaceText('pro.training_plan.name', titleUpdated),
        action('tap', `${item}.remove`),
        action(
          'tap',
          input.platform === 'android' ? 'android:id/button1' : enUS['common.cta.delete'],
          input.platform === 'android' ? 'id' : 'text',
        ),
        action('assert-not-visible', item),
        action('tap', 'pro.training_plan.sessionRow.Strength.addItem'),
        action('tap', 'exerciseSearch.input'),
        replaceText('exerciseSearch.input', 'QA Exercise'),
        action('tap', `exerciseSearch.result.${input.exerciseId}`),
        action('tap', 'exerciseSearch.quantity'),
        replaceText('exerciseSearch.quantity', '4x10'),
        action('tap', 'exerciseSearch.confirm'),
        action('assert-visible', quantity),
      ],
      { 'pro.training_plan.name': titleUpdated, [quantity]: '4x10' },
    ),
    step(
      input.platform,
      'training-edited-save',
      'NAT-training-edited-save',
      'SCR-training-library',
      ['pro.library.training.create'],
      [
        scroll('pro.training_plan.screen', 'pro.training_plan.saveButton'),
        action('tap', 'pro.training_plan.saveButton'),
        action('wait-visible', 'pro.library.training.create'),
      ],
    ),
    ...(plan
      ? [
          step(
            input.platform,
            'training-edited-reopen',
            'NAT-training-edited-save',
            'SCR-training-builder',
            [plan, 'pro.training_plan.name', quantity],
            [
              scroll('pro.library.training.create', plan),
              action('tap', plan),
              action('wait-visible', quantity),
              action('assert-visible', quantity),
            ],
            { 'pro.training_plan.name': titleUpdated, [quantity]: '4x10' },
          ),
        ]
      : []),
    ...(plan
      ? [
          step(
            input.platform,
            'training-relaunch-read',
            'NAT-training-relaunch-read',
            'SCR-training-builder',
            [plan, 'pro.training_plan.name', quantity],
            [
              action('wait-visible', 'pro.home.screen'),
              scroll('pro.home.screen', 'pro.home.trainingCta'),
              action('tap', 'pro.home.trainingCta'),
              scroll('pro.library.training.create', plan),
              action('tap', plan),
              action('wait-visible', quantity),
              action('assert-visible', quantity),
            ],
            { 'pro.training_plan.name': titleUpdated, [quantity]: '4x10' },
          ),
        ]
      : []),
  ];
  assert(steps.some((row) => row.assertionId === 'NAT-training-normal-entry'));
  assert(steps.some((row) => row.assertionId === 'NAT-training-local-draft'));
  assert(steps.some((row) => row.assertionId === 'NAT-training-first-save'));
  assert(steps.some((row) => row.assertionId === 'NAT-training-edit-draft'));
  assert(steps.some((row) => row.assertionId === 'NAT-training-edited-save'));
  if (plan) assert(steps.some((row) => row.assertionId === 'NAT-training-relaunch-read'));
  return steps;
}

export function requireDetoxTrainingSelection(selection: NativePilotSelection): void {
  const platform = selection.arguments.platform;
  assert(selection.arguments.engine === 'detox', 'Training selection is not Detox');
  assert.equal(selection.arguments.mode, 'integration');
  assert.equal(selection.arguments.scenario, `SCN-training-${platform}`);
  assert.equal(selection.scenario.id, `SCN-training-${platform}`);
  assert.equal(selection.scenario.flowId, 'FLW-training');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...DETOX_TRAINING_ASSERTION_IDS],
    'Detox training assertion order differs from the shared T14-B ledger',
  );
  assertHash(selection.scenarioHash, 'Training scenario hash');
  assertHash(selection.requirementHash, 'Training requirement hash');
}

function requireBridge(bridge: DetoxTrainingUiBridge): void {
  assert(bridge && typeof bridge === 'object', 'Detox training bridge is missing');
  assert.equal(typeof bridge.runTrainingStep, 'function', 'Detox training step runner is missing');
  assert.equal(typeof bridge.restartApp, 'function', 'Detox training restart boundary is missing');
  assert.equal(typeof bridge.shutdown, 'function', 'Detox training shutdown boundary is missing');
}

function requireSourceFileReceipt(
  root: string,
  value: DetoxTrainingSourceFileReceipt,
  label: string,
): DetoxTrainingSourceFileReceipt {
  assert(value && typeof value === 'object', `${label} source receipt is missing`);
  assert(
    typeof value.fileName === 'string' &&
      /^detox-training-[A-Za-z0-9._-]+\.(?:json|xml|png)$/.test(value.fileName),
  );
  assert(path.isAbsolute(value.sourcePath));
  assert.equal(value.sourceRealpath, value.sourcePath);
  assert.equal(path.resolve(value.sourcePath), path.join(path.resolve(root), value.fileName));
  assert(Number.isSafeInteger(value.sourceBytes) && value.sourceBytes > 0);
  assertHash(value.sourceSha256, `${label} source`);
  assert.equal(value.sourceMode, 0o600);
  if (typeof process.getuid === 'function') assert.equal(value.sourceUid, process.getuid());
  if (label === 'screenshot') {
    assert(typeof value.producerPath === 'string' && path.isAbsolute(value.producerPath));
    assert(typeof value.producerRealpath === 'string');
    assert.equal(value.producerRealpath, value.producerPath);
    assert(Number.isSafeInteger(value.producerBytes) && value.producerBytes === value.sourceBytes);
    assertHash(value.producerSha256, 'screenshot producer');
    assert(Number.isSafeInteger(value.producerMode) && (Number(value.producerMode) & 0o022) === 0);
    assert(Number.isSafeInteger(value.producerNlink) && value.producerNlink === 1);
    assert(Number.isSafeInteger(value.producerDev));
    assert(Number.isSafeInteger(value.producerIno));
  }
  return value;
}

async function readEvidenceDocument(
  root: string,
  receipt: DetoxTrainingSourceFileReceipt,
  label: string,
): Promise<Record<string, unknown>> {
  const bytes = await readOwnedTrainingFile(root, receipt.fileName, 2 * 1024 * 1024);
  assert.equal(bytes.byteLength, receipt.sourceBytes, `${label} receipt byte count changed`);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    receipt.sourceSha256,
    `${label} receipt hash changed`,
  );
  const value = JSON.parse(bytes.toString('utf8')) as unknown;
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    `${label} receipt is not an object`,
  );
  return value as Record<string, unknown>;
}

/** Re-reads API, SQL and owned-proxy source files and binds them to one attempt. */
async function resolveBoundEvidence(
  options: DetoxTrainingJourneyOptions,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<DetoxTrainingBoundEvidence> {
  return typeof options.evidence === 'function'
    ? await options.evidence({ signal, deadlineAt })
    : options.evidence;
}

async function requireBoundEvidence(
  options: DetoxTrainingJourneyOptions,
  evidence: DetoxTrainingBoundEvidence,
): Promise<void> {
  assert(evidence.runId === options.input.runId);
  assert(evidence.attemptId === options.input.attemptId);
  assert(evidence.targetOrigin === options.targetOrigin);
  assert(evidence.api.apiOrigin === options.targetOrigin);
  assert(Number.isSafeInteger(evidence.api.apiPid) && evidence.api.apiPid > 1);
  assert(evidence.api.apiStarted.length > 0);
  assert(evidence.api.authUid === options.input.accountUid);
  assertHash(evidence.api.manifestSha256, 'API manifest');
  assertHash(evidence.api.apiLedgerSha256, 'API ledger');
  assert(evidence.api.backendAttemptId.length > 0);
  assert(evidence.api.fixtureAuthUidAllowlistHash.length > 0);
  const apiReceipt = requireSourceFileReceipt(options.output, evidence.api.source, 'API');
  const api = await readEvidenceDocument(options.output, apiReceipt, 'API');
  assert.equal(api.runId, options.input.runId);
  assert.equal(api.attemptId, options.input.attemptId);
  assert.equal(api.targetOrigin, options.targetOrigin);
  assert.equal(api.apiPid, evidence.api.apiPid);
  assert.equal(api.apiStarted, evidence.api.apiStarted);
  assert.equal(api.apiOrigin, evidence.api.apiOrigin);
  assert.equal(api.backendAttemptId, evidence.api.backendAttemptId);
  assert.equal(api.manifestSha256, evidence.api.manifestSha256);
  assert.equal(api.apiLedgerSha256, evidence.api.apiLedgerSha256);
  assert.equal(api.authUid, evidence.api.authUid);
  assert(Array.isArray(api.reads), 'API source omitted bound read ledger');

  const sqlReceipt = requireSourceFileReceipt(options.output, evidence.sql.source, 'SQL');
  const sql = await readEvidenceDocument(options.output, sqlReceipt, 'SQL');
  assert.equal(sql.runId, options.input.runId);
  assert.equal(sql.attemptId, options.input.attemptId);
  assert.equal(sql.scope, evidence.sql.scope);
  assert.equal(sql.apiOrigin, evidence.sql.apiOrigin);
  assert.equal(sql.apiPid, evidence.sql.apiPid);
  assert.equal(sql.apiStarted, evidence.sql.apiStarted);
  assert.equal(sql.backendAttemptId, evidence.sql.backendAttemptId);
  assert.equal(sql.manifestSha256, evidence.sql.manifestSha256);
  assert.equal(sql.apiLedgerSha256, evidence.sql.apiLedgerSha256);
  assert.equal(sql.authUid, evidence.sql.authUid);
  assert.deepEqual(sql.unrelatedBefore, evidence.sql.unrelatedBefore);
  assert.deepEqual(sql.unrelatedAfter, evidence.sql.unrelatedAfter);
  assert.deepEqual(
    evidence.sql.unrelatedAfter,
    evidence.sql.unrelatedBefore,
    'Unrelated SQL state changed',
  );
  assert.equal(
    sql.unrelatedStateUnchanged,
    true,
    'SQL source did not prove unrelated-state preservation',
  );

  const transportReceipt = requireSourceFileReceipt(
    options.output,
    evidence.transport.source,
    'transport',
  );
  const transport = await readEvidenceDocument(options.output, transportReceipt, 'transport');
  assert.equal(transport.runId, options.input.runId);
  assert.equal(transport.attemptId, options.input.attemptId);
  assert.equal(transport.targetOrigin, options.targetOrigin);
  assert.equal(transport.apiOrigin, evidence.transport.apiOrigin);
  assert.equal(transport.apiPid, evidence.transport.apiPid);
  assert.equal(transport.apiStarted, evidence.transport.apiStarted);
  assert.equal(transport.authUid, options.input.accountUid);
  assert.deepEqual(transport.nativeAuthIdentities, evidence.transport.nativeAuthIdentities);
  assert(
    evidence.transport.nativeAuthIdentities.some(
      (row) =>
        row &&
        typeof row === 'object' &&
        (row as Record<string, unknown>).verification === 'verified' &&
        (row as Record<string, unknown>).authUid === options.input.accountUid &&
        (row as Record<string, unknown>).apiPid === evidence.transport.apiPid &&
        (row as Record<string, unknown>).targetOrigin === options.targetOrigin,
    ),
    'Transport source lacks a verified owned auth identity',
  );
  assert.deepEqual(
    transport.observations,
    options.transport(),
    'Transport source was not the observed proxy ledger',
  );
}

function requireChildIdentity(
  value: unknown,
): asserts value is DetoxConnectionOwnedProcessIdentity {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  assert(Number.isSafeInteger(row.pid) && Number(row.pid) > 1);
  assert(Number.isSafeInteger(row.pgid) && Number(row.pgid) > 1);
  assert(typeof row.started === 'string' && row.started.length > 0);
}

function requireSource(
  value: unknown,
  expected: DetoxConnectionSourceReceipt['producer'],
  child: DetoxConnectionOwnedProcessIdentity,
): DetoxConnectionSourceReceipt {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  assert.equal(row.producer, expected);
  assert.equal(row.sourceKind, 'file', `${expected} must retain an owned raw file`);
  assert.equal(row.processPid, child.pid);
  assert.equal(row.processPgid, child.pgid);
  assert.equal(row.processStarted, child.started);
  assert(Number.isSafeInteger(row.sourceBytes) && Number(row.sourceBytes) > 0);
  const maxBytes = expected === 'detox.device.takeScreenshot' ? 16 * 1024 * 1024 : 4 * 1024 * 1024;
  assert(
    Number(row.sourceBytes) <= maxBytes,
    `${expected} source exceeds the bounded capture size`,
  );
  assertHash(row.sourceSha256, `${expected} source`);
  if (row.sourceKind === 'file') {
    assert(typeof row.sourcePath === 'string' && path.isAbsolute(row.sourcePath));
    assert(typeof row.sourceRealpath === 'string' && row.sourceRealpath === row.sourcePath);
    assert(Number.isSafeInteger(row.sourceMode) && Number(row.sourceMode) === 0o600);
    assert(Number.isSafeInteger(row.sourceUid) && Number(row.sourceUid) >= 0);
    if (row.sourceNlink !== undefined) {
      assert.equal(row.sourceNlink, 1);
      assert(Number.isSafeInteger(row.sourceDev));
      assert(Number.isSafeInteger(row.sourceIno));
    }
  }
  if (expected === 'detox.device.takeScreenshot') {
    assert(typeof row.producerPath === 'string' && path.isAbsolute(row.producerPath));
    assert.equal(row.producerRealpath, row.producerPath);
    assert(Number.isSafeInteger(row.producerBytes) && row.producerBytes === row.sourceBytes);
    assertHash(row.producerSha256, `${expected} producer`);
    assert(Number.isSafeInteger(row.producerMode) && (Number(row.producerMode) & 0o022) === 0);
    assert(Number.isSafeInteger(row.producerNlink) && row.producerNlink === 1);
    assert(Number.isSafeInteger(row.producerDev));
    assert(Number.isSafeInteger(row.producerIno));
    assert.equal(row.producerRetention, 'owned-snapshot');
    assert(
      typeof row.producerSnapshotPath === 'string' && path.isAbsolute(row.producerSnapshotPath),
    );
    assert.equal(row.producerSnapshotRealpath, row.producerSnapshotPath);
    assert(
      Number.isSafeInteger(Number(row.producerSnapshotBytes)) &&
        Number(row.producerSnapshotBytes) > 0,
    );
    assertHash(row.producerSnapshotSha256, `${expected} retained snapshot`);
    assert.equal(row.producerSnapshotMode, 0o600);
    assert(Number.isSafeInteger(row.producerSnapshotNlink) && row.producerSnapshotNlink === 1);
    assert(Number.isSafeInteger(row.producerSnapshotDev));
    assert(Number.isSafeInteger(row.producerSnapshotIno));
  }
  return row as unknown as DetoxConnectionSourceReceipt;
}

export function requireDetoxTrainingStepReceipt(
  receipt: DetoxTrainingStepReceipt,
  stepDefinition: DetoxTrainingStep,
): DetoxTrainingStepReceipt {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, 'private-detox-training-step-receipt');
  assert.equal(receipt.stepId, stepDefinition.id);
  assert.equal(receipt.assertionId, stepDefinition.assertionId);
  assert(Number.isSafeInteger(receipt.commandId) && receipt.commandId > 0);
  assertHash(receipt.commandHash, 'Training command');
  assert.equal(receipt.platform, stepDefinition.platform);
  assert.equal(receipt.viewId, stepDefinition.viewId);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.actionCompleted, true);
  assert.equal(receipt.hierarchyCaptured, true);
  assert.equal(receipt.screenshotCaptured, true);
  assert(Number.isFinite(receipt.startedMonotonicMs));
  assert(Number.isFinite(receipt.finishedMonotonicMs));
  assert(receipt.finishedMonotonicMs >= receipt.startedMonotonicMs);
  requireChildIdentity(receipt.childIdentity);
  assert.deepEqual(receipt.selectors, stepDefinition.selectors);
  for (const [selector, expected] of Object.entries(stepDefinition.expectedRendered))
    assert.equal(receipt.rendered[selector], expected, `Rendered value differs for ${selector}`);
  requireSource(
    receipt.sourceReceipts.xml,
    'detox.device.generateViewHierarchyXml',
    receipt.childIdentity,
  );
  requireSource(
    receipt.sourceReceipts.screenshot,
    'detox.device.takeScreenshot',
    receipt.childIdentity,
  );
  assert(receipt.sourceFiles, 'Detox training receipt omitted original source file names');
  assert.equal(path.basename(receipt.sourceReceipts.xml.sourcePath ?? ''), receipt.sourceFiles.xml);
  assert.equal(
    path.basename(receipt.sourceReceipts.screenshot.sourcePath ?? ''),
    receipt.sourceFiles.screenshot,
  );
  assert(
    receipt.sourceReceipts.attributesBefore,
    'Detox training receipt omitted getAttributes before source',
  );
  assert(
    receipt.sourceReceipts.attributesAfter,
    'Detox training receipt omitted getAttributes after source',
  );
  assert.equal(
    path.basename(receipt.sourceReceipts.attributesBefore.sourcePath ?? ''),
    receipt.sourceFiles.attributesBefore,
  );
  assert.equal(
    path.basename(receipt.sourceReceipts.attributesAfter.sourcePath ?? ''),
    receipt.sourceFiles.attributesAfter,
  );
  assert(receipt.selectorEvidence?.length === stepDefinition.selectors.length);
  return receipt;
}

async function persistReceipt(
  output: string,
  receipt: DetoxTrainingStepReceipt,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<void> {
  signal.throwIfAborted();
  assert(performance.now() < deadlineAt, 'Detox training receipt deadline elapsed');
  const fileName = `detox-training-${receipt.stepId}.private.json`;
  const expected = Buffer.from(`${JSON.stringify(receipt)}\n`);
  await writeAtomicTrainingJson(output, fileName, receipt, { signal, deadlineAt });
  const readback = await readOwnedTrainingFile(output, fileName, 2 * 1024 * 1024, {
    signal,
    deadlineAt,
  });
  assert.deepEqual(readback, expected, 'Detox training receipt changed during publication');
  signal.throwIfAborted();
  assert(performance.now() < deadlineAt, 'Detox training receipt deadline elapsed');
}

function findCreatedPlanId(
  baseline: OwnedDomainSnapshot,
  current: OwnedDomainSnapshot,
  accountUid: string,
): string {
  const added = current.trainingPlans.filter(
    (row) =>
      !baseline.trainingPlans.some((old) => old.id === row.id) &&
      row.ownerProfessionalUid === accountUid,
  );
  assert.equal(added.length, 1, 'Detox training save did not create exactly one owned plan');
  assert(PLAN_ID.test(added[0].id));
  return added[0].id;
}

function requireTransportRow(
  row: ProxyObservation,
  method: string,
  route: string,
  status: number,
  targetOrigin: string,
): void {
  assert.equal(row.method, method);
  assert.equal(row.pathHash, createHash('sha256').update(route).digest('hex'));
  assert.equal(row.status, status);
  assert.equal(row.outcome, 'forwarded');
  assert.equal(row.requestProfile, 'native');
  assert.equal(row.requestOrigin, null);
  assert.equal(row.targetOrigin, targetOrigin);
  assert.equal(row.requestCredentialPresent, true, 'Training transport row lacks auth evidence');
  assert(
    row.requestCredentialClassification?.authorization === 'bearer' ||
      row.requestCredentialClassification?.knownAccessCookie === 'nonempty' ||
      row.requestCredentialClassification?.knownRefreshCookie === 'nonempty',
    'Training transport row lacks a verified credential classification',
  );
  assert.equal(row.faultAttemptId, null);
}

/** Bind UI writes and reads to the existing owned native proxy; no fake route list is accepted. */
export function requireDetoxTrainingTransport(input: {
  observations: readonly ProxyObservation[];
  planId: string;
  exerciseId: string;
  targetOrigin: string;
}) {
  assert(PLAN_ID.test(input.planId));
  assert(input.exerciseId.length > 0 && !/[\r\n]/.test(input.exerciseId));
  assert(input.targetOrigin.length > 0);
  const ids = new Set<number>();
  for (const row of input.observations) {
    assert(Number.isSafeInteger(row.requestId) && row.requestId > 0 && !ids.has(row.requestId));
    ids.add(row.requestId);
  }
  const route = (value: string) =>
    input.observations.filter(
      (row) => row.pathHash === createHash('sha256').update(value).digest('hex'),
    );
  const created = route('/plans/training').filter(
    (row) => row.method === 'POST' && row.status === 201,
  );
  assert.equal(created.length, 1, 'Detox training must create one plan');
  requireTransportRow(created[0], 'POST', '/plans/training', 201, input.targetOrigin);
  const editedRoute = `/plans/training/${input.planId}`;
  const edited = route(editedRoute).filter((row) => row.method === 'PATCH' && row.status === 200);
  assert.equal(edited.length, 1, 'Detox training must issue one edited-plan write');
  requireTransportRow(edited[0], 'PATCH', editedRoute, 200, input.targetOrigin);
  const reads = route(editedRoute).filter((row) => row.method === 'GET' && row.status === 200);
  assert(
    reads.length >= 3,
    'Detox training requires created, edited and durable authenticated reads',
  );
  for (const row of reads) requireTransportRow(row, 'GET', editedRoute, 200, input.targetOrigin);
  for (const [method, routeValue] of [
    ['GET', '/plans/predefined'],
    ['POST', '/integrations/exercise/search'],
    ['GET', `/integrations/exercise/exercises/${input.exerciseId}`],
  ] as const) {
    const rows = route(routeValue).filter((row) => row.method === method && row.status === 200);
    assert(rows.length > 0, `Detox training catalog operation is missing: ${method} ${routeValue}`);
    for (const row of rows) requireTransportRow(row, method, routeValue, 200, input.targetOrigin);
  }
  return {
    createdRequests: created.length,
    editedRequests: edited.length,
    durableReads: reads.length,
    catalogReads: route('/plans/predefined').length,
  } as const;
}

/**
 * Bind the existing engine-independent state/API/SQL controller to one future
 * Detox child. The bridge is deliberately explicit: without an owned child,
 * source re-read and real proxy observations, this function rejects rather
 * than turning a synthetic callback into a native result.
 */
export async function runDetoxTrainingJourney(options: DetoxTrainingJourneyOptions) {
  requireDetoxTrainingSelection(options.selection);
  assertRunId(options.input.runId, 'Training run ID');
  assert.equal(options.input.attemptId, `${options.input.runId}:first`);
  assert.equal(options.input.platform, options.selection.arguments.platform);
  assert(options.input.accountUid.length > 0);
  requireBridge(options.bridge);
  assert(options.signal instanceof AbortSignal);
  assert(options.repositoryRoot.length > 0 && options.output.length > 0);
  const deadlineAt = options.deadlineAt ?? performance.now() + 600_000;
  assert(
    Number.isFinite(deadlineAt) && deadlineAt > performance.now(),
    'Detox training deadline is invalid',
  );
  const fence = () => {
    if (options.signal.aborted)
      throw options.signal.reason ?? new Error('Detox training journey cancelled');
    if (performance.now() >= deadlineAt) throw new Error('Detox training journey deadline elapsed');
  };
  const title = `QA training ${options.input.attemptId}`;
  let latest: OwnedDomainSnapshot | undefined;
  let planId: string | undefined;
  let saves = 0;
  let primaryError: unknown;
  let shutdownError: unknown;
  let cleanupError: unknown;
  let result: Record<string, unknown> | undefined;
  let childStarted = false;
  const execute = async (stepId: string, plan?: string) => {
    fence();
    const definitions = buildDetoxTrainingStepPlan({
      platform: options.input.platform,
      title,
      exerciseId: options.input.exerciseId,
      exerciseName: options.input.exerciseName,
      planId: plan,
    });
    const definition = definitions.find((row) => row.id === stepId);
    assert(definition, `Detox training step is not declared: ${stepId}`);
    childStarted = true;
    const receipt = await options.bridge.runTrainingStep(definition, {
      signal: options.signal,
      deadlineAt,
    });
    fence();
    requireDetoxTrainingStepReceipt(receipt, definition);
    assert.equal(receipt.runId, options.input.runId);
    assert.equal(receipt.attemptId, options.input.attemptId);
    await persistReceipt(options.output, receipt, options.signal, deadlineAt);
    fence();
  };
  try {
    const driver: NativeTrainingJourneyDriver = {
      normalEntry: () => execute('training-normal-entry'),
      createDraft: async (values) => {
        assert.equal(values.title, title);
        assert.equal(values.exerciseId, options.input.exerciseId);
        assert.equal(values.exerciseName, options.input.exerciseName);
        assert.equal(values.quantity, '3x8');
        await execute('training-local-draft');
      },
      saveAndReopen: async (expectedPlanId) => {
        fence();
        saves += 1;
        assert(saves <= 2, 'Detox training attempted more than two Saves');
        await execute(saves === 1 ? 'training-first-save' : 'training-edited-save', expectedPlanId);
        const current = await options.snapshot();
        fence();
        assert(latest, 'Detox training Save ran before its baseline snapshot');
        if (saves === 1) planId = findCreatedPlanId(latest, current, options.input.accountUid);
        else assert.equal(planId, expectedPlanId);
        latest = current;
        await execute(saves === 1 ? 'training-first-reopen' : 'training-edited-reopen', planId);
      },
      editDraft: async (values) => {
        fence();
        assert.equal(values.planId, planId);
        assert(planId, 'Detox training edit ran before the first saved plan was bound');
        assert.equal(values.quantity, '4x10');
        assert.equal(values.method, 'remove-confirm-readd');
        await execute('training-edit-draft', planId);
      },
      restartAndReopen: async (expectedPlanId) => {
        fence();
        assert.equal(expectedPlanId, planId);
        childStarted = true;
        const restart = await options.bridge.restartApp({
          appIdentifier: 'com.edufelip.mychampions.dev',
          launchCount: 2,
          signal: options.signal,
          deadlineAt,
        });
        fence();
        assert.equal(restart.kind, 'private-detox-training-restart-receipt');
        assert.equal(restart.status, 'completed');
        assert.equal(restart.runId, options.input.runId);
        assert.equal(restart.attemptId, options.input.attemptId);
        assert.equal(restart.platform, options.input.platform);
        assert.equal(restart.appIdentifier, 'com.edufelip.mychampions.dev');
        assert.equal(restart.synchronizationDisabled, true);
        assert(Number.isSafeInteger(restart.launchCount) && restart.launchCount >= 2);
        requireChildIdentity(restart.childIdentity);
        await execute('training-relaunch-read', planId);
      },
      snapshot: async () => {
        fence();
        const value = await options.snapshot();
        fence();
        latest = value;
        return value;
      },
      readPlan: async (id) => {
        fence();
        const value = await options.readPlan(id);
        fence();
        return value;
      },
    };
    const journey = await runNativeTrainingJourney(options.input, driver);
    fence();
    const evidence = await resolveBoundEvidence(options, options.signal, deadlineAt);
    await requireBoundEvidence(options, evidence);
    fence();
    const transport = requireDetoxTrainingTransport({
      observations: options.transport(),
      planId: journey.planId,
      exerciseId: options.input.exerciseId,
      targetOrigin: options.targetOrigin,
    });
    const unrelatedProof = {
      schemaVersion: 1,
      kind: 'private-detox-training-unrelated-state-proof',
      assertionId: 'NAT-training-unrelated-state',
      runId: options.input.runId,
      attemptId: options.input.attemptId,
      sqlSourceFile: evidence.sql.source.fileName,
      unrelatedBefore: evidence.sql.unrelatedBefore,
      unrelatedAfter: evidence.sql.unrelatedAfter,
      unchanged: true,
      publicPromotionEligible: false,
    } as const;
    const unrelatedName = 'detox-training-unrelated-state.private.json';
    const unrelatedBytes = Buffer.from(`${JSON.stringify(unrelatedProof)}\n`);
    await writeAtomicTrainingJson(options.output, unrelatedName, unrelatedProof, {
      signal: options.signal,
      deadlineAt,
    });
    const unrelatedReadback = await readOwnedTrainingFile(
      options.output,
      unrelatedName,
      2 * 1024 * 1024,
      { signal: options.signal, deadlineAt },
    );
    assert.deepEqual(
      unrelatedReadback,
      unrelatedBytes,
      'Detox unrelated-state proof changed during publication',
    );
    fence();
    result = {
      ...journey,
      transport,
      unrelatedState: unrelatedProof,
      nativePassingCases: 0 as const,
      publicPromotionEligible: false as const,
      scope: 'private Detox training source boundary; no native/public qualification',
    };
  } catch (error) {
    primaryError = error;
  } finally {
    const reason = primaryError
      ? options.signal.aborted
        ? 'cancelled'
        : performance.now() >= deadlineAt
          ? 'deadline'
          : 'journey-failed'
      : 'completed';
    if (childStarted) {
      try {
        await options.bridge.shutdown({
          signal: new AbortController().signal,
          deadlineAt,
        });
      } catch (error) {
        shutdownError = error;
      }
    }
    if (options.cleanup) {
      try {
        const cleanup = await options.cleanup({ reason, signal: options.signal, deadlineAt });
        if (cleanup.status !== 'cleaned' || cleanup.failures.length > 0) {
          cleanupError = new Error('Detox training cleanup did not reach a clean terminal state');
          (cleanupError as Error & { cleanup?: DetoxTrainingCleanupResult }).cleanup = cleanup;
        }
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  if (shutdownError && cleanupError)
    cleanupError = new AggregateError(
      [shutdownError, cleanupError],
      'Detox training shutdown and owner cleanup were not verified',
    );
  else if (shutdownError) cleanupError = shutdownError;
  if (primaryError && cleanupError)
    throw new AggregateError(
      [primaryError, cleanupError],
      'Detox training failed and cleanup was not verified',
    );
  if (primaryError) throw asError(primaryError, 'Detox training journey failed');
  if (cleanupError) throw asError(cleanupError, 'Detox training cleanup failed');
  assert(result, 'Detox training result missing');
  return result;
}

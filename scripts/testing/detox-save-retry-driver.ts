import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  assertDetoxSaveRetryResponse,
  buildDetoxSaveRetryCommand,
  DETOX_SAVE_RETRY_DRAFT,
  type DetoxSaveRetryPlatform,
  type DetoxSaveRetryCommand,
} from './detox-save-retry-child-protocol.mjs';

export type { DetoxSaveRetryPlatform } from './detox-save-retry-child-protocol.mjs';

const RUN_ID = /^[a-f0-9]{24}$/;
const ATTEMPT_ID = /^([a-f0-9]{24}):first$/;
const PLAN_ID = /^training_plan_[a-f0-9-]{36}$/;
const SAVE_PATH_HASH = createHash('sha256').update('/plans/training').digest('hex');
const SIGN_IN_PATH_HASH = createHash('sha256').update('/auth/email/sign-in').digest('hex');
const PREDEFINED_PATH_HASH = createHash('sha256').update('/plans/predefined').digest('hex');
const EXERCISE_SEARCH_PATH_HASH = createHash('sha256')
  .update('/integrations/exercise/search')
  .digest('hex');
const EXERCISE_DETAIL_PATH_HASH = createHash('sha256')
  .update(`/integrations/exercise/exercises/${DETOX_SAVE_RETRY_DRAFT.exerciseId}`)
  .digest('hex');
const CHILD_DEADLINE_MS = 120_000;

export type DetoxSaveRetrySnapshot = Readonly<{
  schemaVersion: number;
  runId: string;
  scope: `native-entry-${DetoxSaveRetryPlatform}`;
  readOnly: true;
  trainingPlans: readonly Record<string, unknown>[];
  connections: readonly Record<string, unknown>[];
}>;

export type DetoxSaveRetryPlanRead = Readonly<{
  status: number;
  plan: unknown;
  verification?: unknown;
}>;

export type DetoxSaveRetryProxyObservation = Readonly<{
  requestId: number;
  method: string;
  pathHash: string;
  requestOrigin: string | null;
  requestProfile: 'browser' | 'native';
  requestCredentialPresent?: boolean;
  requestCredentialClassification?: {
    authorization: 'absent' | 'empty' | 'bearer' | 'other';
    cookie: 'absent' | 'empty' | 'present';
    knownAccessCookie: 'absent' | 'empty' | 'nonempty';
    knownRefreshCookie: 'absent' | 'empty' | 'nonempty';
    otherCookiePresent: boolean;
    malformedCookiePresent: boolean;
  };
  targetOrigin: string;
  status: number;
  outcome: 'forwarded' | 'injected' | 'rejected' | 'upstream-failed';
  faultAttemptId?: string | null;
}>;

export type DetoxSaveRetryProxy = Readonly<{
  readonly requestIdFence: number;
  waitForQuiescence(deadlineMs?: number): Promise<{ active: number; outbound: number }>;
  armObservedNativeSaveFault(input: {
    attemptId: string;
    method: 'POST';
    path: '/plans/training';
    accountUid: string;
  }): void | PromiseLike<void>;
  clearFault(attemptId: string): { attemptId: string; injectedCount: number };
  readonly faultState: { attemptId: string; injectedCount: number } | null;
  readonly observations: readonly DetoxSaveRetryProxyObservation[];
}>;

export type DetoxSaveRetryChild = Readonly<{
  identity: { pid: number; pgid: number; started: string };
  request(
    command: DetoxSaveRetryCommand,
    options?: { signal?: AbortSignal; deadlineAt?: number },
  ): Promise<unknown>;
  close?: () => void;
}>;

export type DetoxSaveRetryValidators = Readonly<{
  requireDraft(platform: DetoxSaveRetryPlatform, hierarchy: unknown, saveEnabled: boolean): void;
  validateSnapshots(
    before: DetoxSaveRetrySnapshot,
    failed: DetoxSaveRetrySnapshot,
    after: DetoxSaveRetrySnapshot,
    accountUid: string,
    platform: DetoxSaveRetryPlatform,
  ): string;
}>;

export type DetoxSaveRetryDriverInput = Readonly<{
  runId: string;
  attemptId: string;
  platform: DetoxSaveRetryPlatform;
  accountUid: string;
  targetOrigin: string;
  requestIdFence: number;
  child: DetoxSaveRetryChild;
  proxy: DetoxSaveRetryProxy;
  snapshot: () => Promise<DetoxSaveRetrySnapshot>;
  readPlan: (planId: string) => Promise<DetoxSaveRetryPlanRead>;
  validators: DetoxSaveRetryValidators;
  verifyScreenshot: (
    receipt: unknown,
    options: { signal?: AbortSignal; deadlineAt: number },
  ) => Promise<Buffer>;
  signal?: AbortSignal;
  /** Caller-owned absolute monotonic deadline; prevents budget renewal. */
  deadlineAtMonotonicMs?: number;
  deadlineMs?: number;
  errorText: string;
  /** Shared native-save identity supplied by the owner, never inferred from the Detox run ID. */
  faultAttemptId: string;
}>;

export type DetoxSaveRetryDriverReceipt = Readonly<{
  kind: 'private-detox-save-retry-capture-not-public-receipt';
  runId: string;
  attemptId: string;
  platform: DetoxSaveRetryPlatform;
  faultAttemptId: string;
  planId: string;
  injectedWrites: 1;
  forwardedWrites: 1;
  apiReads: 2;
  snapshots: readonly ['before', 'failed', 'after', 'reopened'];
  assertionIds: readonly [
    'NAT-save-retry-error',
    'NAT-save-retry-retained-draft',
    'NAT-save-retry-final-save',
    'NAT-save-retry-reopen',
    'NAT-save-retry-unrelated-state',
  ];
  nativePassingCases: 0;
  publicPromotionEligible: false;
  cleanupOwner: 'existing-detox-integrated-connection-driver';
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireLive(signal: AbortSignal | undefined, deadlineAt: number): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Detox save/retry attempt cancelled');
  if (performance.now() >= deadlineAt) throw new Error('Detox save/retry attempt deadline elapsed');
}

async function boundedRead<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  deadlineAt: number,
): Promise<T> {
  requireLive(signal, deadlineAt);
  const remaining = deadlineAt - performance.now();
  if (remaining <= 0) throw new Error('Detox save/retry attempt deadline elapsed');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Detox save/retry attempt deadline elapsed')),
      Math.max(1, remaining),
    );
    onAbort = () =>
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error('Detox save/retry attempt cancelled'),
      );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([Promise.resolve().then(operation), cancellation]);
    requireLive(signal, deadlineAt);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

function requirePngBytes(value: Buffer): Buffer {
  assert(Buffer.isBuffer(value), 'Detox screenshot verifier must return bytes');
  assert(
    value.length >= 33 && value.length <= 16 * 1024 * 1024,
    'Detox screenshot bytes are unbounded',
  );
  assert(
    value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'Detox screenshot is not a PNG',
  );
  let offset = 8;
  let header = false;
  let idat = false;
  let end = false;
  let idatClosed = false;
  const crc32 = (bytes: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  let chunkIndex = 0;
  while (offset < value.length) {
    assert(offset + 12 <= value.length, 'Detox screenshot PNG chunk is truncated');
    const size = value.readUInt32BE(offset);
    const typeBytes = value.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const next = offset + 12 + size;
    assert(next <= value.length, 'Detox screenshot PNG chunk is truncated');
    const data = value.subarray(offset + 8, offset + 8 + size);
    const expectedCrc = value.readUInt32BE(offset + 8 + size);
    assert.equal(
      crc32(Buffer.concat([typeBytes, data])),
      expectedCrc,
      `Detox screenshot PNG ${type} chunk CRC is invalid`,
    );
    if (chunkIndex === 0) assert.equal(type, 'IHDR', 'Detox screenshot PNG must start with IHDR');
    if (type === 'IHDR') {
      assert(size === 13 && !header, 'Detox screenshot PNG header is invalid');
      assert(value.readUInt32BE(offset + 8) > 0 && value.readUInt32BE(offset + 12) > 0);
      header = true;
    }
    if (type === 'IDAT') {
      assert(header && !end && !idatClosed, 'Detox screenshot PNG IDAT order is invalid');
      assert(size > 0, 'Detox screenshot PNG IDAT is empty');
      idat = true;
    } else if (idat) {
      idatClosed = true;
    }
    if (type === 'IEND') {
      assert(idat, 'Detox screenshot PNG has no IDAT chunk');
      assert(size === 0 && !end && next === value.length, 'Detox screenshot PNG end is invalid');
      end = true;
    }
    offset = next;
    chunkIndex += 1;
  }
  assert(header && idat && end && offset === value.length, 'Detox screenshot PNG is incomplete');
  return value;
}

function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function screenshotRecord(response: Record<string, unknown>, command: DetoxSaveRetryCommand) {
  const receipt = actionReceipt(response, command.commandKind);
  return record(receipt.screenshot, `${command.commandKind} Detox screenshot`);
}

async function verifyActionScreenshot(
  response: Record<string, unknown>,
  command: DetoxSaveRetryCommand,
  input: DetoxSaveRetryDriverInput,
  deadlineAt: number,
): Promise<void> {
  const screenshot = screenshotRecord(response, command);
  const bytes = requirePngBytes(
    await boundedRead(
      () => input.verifyScreenshot(screenshot, { signal: input.signal, deadlineAt }),
      input.signal,
      deadlineAt,
    ),
  );
  assert.equal(bytes.byteLength, screenshot.bytes, 'Detox screenshot length changed after staging');
  assert.equal(hashBytes(bytes), screenshot.sha256, 'Detox screenshot bytes changed after staging');
  assert.equal(screenshot.producerSha256, screenshot.sha256);
}

function actionReceipt(response: Record<string, unknown>, phase: string): Record<string, unknown> {
  const receipt = record(response.actionReceipt, `${phase} Detox action receipt`);
  assert.equal(receipt.phase, phase);
  assert.equal(receipt.kind, 'private-detox-save-retry-action');
  return receipt;
}

function requireCompletedResponse(
  value: unknown,
  command: DetoxSaveRetryCommand,
  childIdentity: { pid: number; pgid: number; started: string },
  deadlineAt: number,
): Record<string, unknown> {
  const response = assertDetoxSaveRetryResponse(value, command, childIdentity, deadlineAt);
  assert.equal(response.status, 'completed');
  return response;
}

async function requestStep(
  input: DetoxSaveRetryDriverInput,
  command: DetoxSaveRetryCommand,
  childIdentity: { pid: number; pgid: number; started: string },
  deadlineAt: number,
): Promise<Record<string, unknown>> {
  requireLive(input.signal, deadlineAt);
  const response = await boundedRead(
    () => input.child.request(command, { signal: input.signal, deadlineAt }),
    input.signal,
    deadlineAt,
  );
  requireLive(input.signal, deadlineAt);
  const completed = requireCompletedResponse(response, command, childIdentity, deadlineAt);
  if (command.commandKind !== 'shutdown')
    await verifyActionScreenshot(completed, command, input, deadlineAt);
  return completed;
}

function requireRunInput(input: DetoxSaveRetryDriverInput): void {
  assert.match(input.runId, RUN_ID);
  assert.match(input.attemptId, ATTEMPT_ID);
  assert.equal(input.attemptId.slice(0, 24), input.runId);
  assert(input.accountUid.length > 0 && !/[\r\n]/.test(input.accountUid));
  assert.match(input.targetOrigin, /^https?:\/\/[^\s/]+(?::\d+)?$/);
  assert(Number.isSafeInteger(input.requestIdFence) && input.requestIdFence >= 0);
  assert(input.platform === 'ios' || input.platform === 'android');
  assert(input.errorText.length > 0);
  assert.match(input.faultAttemptId, /^native-save-[a-f0-9]{24}$/);
  assert(
    !input.faultAttemptId.startsWith('detox-save-'),
    'Detox-private fault IDs cannot cross the shared Save contract',
  );
  assert(input.validators !== undefined);
  assert(typeof input.verifyScreenshot === 'function');
  assert.deepEqual(DETOX_SAVE_RETRY_DRAFT, {
    title: 'Native QA Draft',
    sessionName: 'Strength',
    exerciseId: '00000000-0000-4000-8000-000000000001',
    exerciseName: 'en QA Exercise 1',
    quantity: '3x8',
    notes: '',
  });
}

function requireProxyWrites(
  observations: readonly DetoxSaveRetryProxyObservation[],
  faultAttemptId: string,
  planId: string,
  targetOrigin: string,
  requestIdFence: number,
  baseline: DetoxSaveRetrySnapshot,
): void {
  assert(targetOrigin.startsWith('http://') || targetOrigin.startsWith('https://'));
  assert(baseline.trainingPlans.length === 0, 'Detox save/retry baseline already contains a plan');
  const scopedObservations = observations.filter((row) => row.requestId > requestIdFence);
  assert(scopedObservations.length > 0, 'Detox save/retry transport window is empty');
  const requestIds = scopedObservations.map((row) => row.requestId);
  assert.equal(
    new Set(requestIds).size,
    requestIds.length,
    'Detox transport request IDs are duplicated',
  );
  for (let index = 1; index < requestIds.length; index += 1)
    assert(
      requestIds[index] > requestIds[index - 1],
      'Detox transport request IDs are out of order',
    );
  assert(
    requestIds.every((requestId) => requestId > requestIdFence),
    'Detox transport observation escaped the request ID fence',
  );
  const requireNativeRow = (
    row: DetoxSaveRetryProxyObservation,
    label: string,
    credentialRequired = true,
  ): void => {
    assert(
      Number.isSafeInteger(row.requestId) && row.requestId > 0,
      `${label} request ID is invalid`,
    );
    assert.equal(row.requestProfile, 'native', `${label} was not native-bound`);
    assert.equal(row.requestOrigin, null, `${label} origin was not native-bound`);
    assert.equal(row.targetOrigin, targetOrigin, `${label} target origin changed`);
    if (credentialRequired) {
      assert.equal(row.requestCredentialPresent, true, `${label} credential was not present`);
      const credentials = row.requestCredentialClassification;
      assert(credentials, `${label} credential classification is missing`);
      assert(
        credentials.authorization === 'bearer' ||
          credentials.knownAccessCookie === 'nonempty' ||
          credentials.knownRefreshCookie === 'nonempty',
        `${label} credential is not an authenticated session`,
      );
    }
  };
  const signInRows = scopedObservations.filter(
    (row) =>
      row.method === 'POST' &&
      row.pathHash === SIGN_IN_PATH_HASH &&
      row.status === 201 &&
      row.outcome === 'forwarded',
  );
  assert.equal(signInRows.length, 1, 'Detox save/retry must have one forwarded sign-in');
  const signIn = signInRows[0];
  requireNativeRow(signIn, 'Detox save/retry sign-in', false);
  assert.equal(
    signIn.requestCredentialPresent,
    false,
    'Detox save/retry sign-in carried credentials',
  );
  const firstWriteIndex = scopedObservations.findIndex(
    (row) => row.method === 'POST' && row.pathHash === SAVE_PATH_HASH,
  );
  assert(firstWriteIndex >= 0, 'Detox save/retry write transport receipt is missing');
  for (const route of [
    ['predefined plans', 'GET', PREDEFINED_PATH_HASH],
    ['exercise search', 'POST', EXERCISE_SEARCH_PATH_HASH],
    ['exercise detail', 'GET', EXERCISE_DETAIL_PATH_HASH],
  ] as const) {
    const routeRows = scopedObservations.filter(
      (row) => row.method === route[1] && row.pathHash === route[2] && row.status === 200,
    );
    assert.equal(routeRows.length, 1, `Detox ${route[0]} transport receipt count changed`);
    const index = scopedObservations.indexOf(routeRows[0]);
    assert(index >= 0 && index < firstWriteIndex, `Detox ${route[0]} was not read before Save`);
    const row = routeRows[0];
    assert.equal(row.outcome, 'forwarded', `Detox ${route[0]} was not forwarded`);
    requireNativeRow(row, `Detox ${route[0]}`);
  }
  const writes = scopedObservations.filter(
    (row) => row.method === 'POST' && row.pathHash === SAVE_PATH_HASH,
  );
  assert.equal(
    writes.length,
    2,
    'Detox save/retry must issue one injected and one forwarded write',
  );
  assert.deepEqual(
    writes.map((row) => [row.outcome, row.status, row.faultAttemptId]),
    [
      ['injected', 503, faultAttemptId],
      ['forwarded', 201, null],
    ],
  );
  for (const row of writes) requireNativeRow(row, 'Detox save/retry write');
  assert.equal(writes[0].requestCredentialPresent, true);
  assert.equal(writes[1].requestCredentialPresent, true);
  const planPathHash = createHash('sha256').update(`/plans/training/${planId}`).digest('hex');
  const detailWrites = scopedObservations.filter(
    (row) => row.method === 'PATCH' && row.pathHash === planPathHash,
  );
  assert.equal(detailWrites.length, 1, 'Detox save/retry must issue one durable detail mutation');
  const detailWrite = detailWrites[0];
  assert.equal(detailWrite.status, 200);
  assert.equal(detailWrite.outcome, 'forwarded');
  assert.equal(detailWrite.faultAttemptId, null);
  requireNativeRow(detailWrite, 'Detox save/retry durable detail mutation');
  const reads = scopedObservations.filter(
    (row) =>
      row.method === 'GET' &&
      row.pathHash === planPathHash &&
      row.status === 200 &&
      row.outcome === 'forwarded' &&
      row.requestProfile === 'native',
  );
  assert.equal(reads.length, 2, 'Detox save/retry must retain both authenticated API reads');
  for (const row of reads) requireNativeRow(row, 'Detox save/retry durable plan read');
  assert(scopedObservations.indexOf(detailWrite) < scopedObservations.indexOf(reads[0]));
  assert(scopedObservations.indexOf(writes[1]) < scopedObservations.indexOf(detailWrite));
}

/**
 * Ordered Detox save/retry source seam. The existing owner supplies the
 * authenticated child, owned proxy and scoped SQL/API readers. This function
 * owns no native process or cleanup aggregate and always returns a source-only
 * result, even when all injected controls pass.
 */
export async function runDetoxSaveRetryJourney(
  input: DetoxSaveRetryDriverInput,
): Promise<DetoxSaveRetryDriverReceipt> {
  requireRunInput(input);
  const deadlineAt =
    input.deadlineAtMonotonicMs ?? performance.now() + (input.deadlineMs ?? CHILD_DEADLINE_MS);
  assert(Number.isFinite(deadlineAt));
  const childIdentity = record(input.child.identity, 'Detox save/retry child identity') as {
    pid: number;
    pgid: number;
    started: string;
  };
  assert(Number.isSafeInteger(childIdentity.pid) && childIdentity.pid > 1);
  assert(Number.isSafeInteger(childIdentity.pgid) && childIdentity.pgid > 1);
  assert(typeof childIdentity.started === 'string' && childIdentity.started.length > 0);

  requireLive(input.signal, deadlineAt);
  const baseline = await boundedRead(input.snapshot, input.signal, deadlineAt);
  requireLive(input.signal, deadlineAt);
  const prepare = buildDetoxSaveRetryCommand({
    commandId: 1,
    runId: input.runId,
    attemptId: input.attemptId,
    platform: input.platform,
    commandKind: 'prepare-draft',
  });
  const prepared = await requestStep(input, prepare, childIdentity, deadlineAt);
  input.validators.requireDraft(
    input.platform,
    actionReceipt(prepared, 'prepare-draft').hierarchy,
    true,
  );
  const draft = await boundedRead(input.snapshot, input.signal, deadlineAt);
  assert.deepEqual(draft, baseline, 'Detox draft changed owned SQL before Save');

  const faultAttemptId = input.faultAttemptId;
  let faultArmed = false;
  let primaryError: unknown;
  try {
    requireLive(input.signal, deadlineAt);
    const armResult = input.proxy.armObservedNativeSaveFault({
      attemptId: faultAttemptId,
      method: 'POST',
      path: '/plans/training',
      accountUid: input.accountUid,
    });
    if (armResult && typeof armResult.then === 'function') await armResult;
    faultArmed = true;
    // Ownership is recorded immediately after the arm completes, before the
    // cancellation/deadline fence can reject and enter cleanup.
    requireLive(input.signal, deadlineAt);

    const failedCommand = buildDetoxSaveRetryCommand({
      commandId: 2,
      runId: input.runId,
      attemptId: input.attemptId,
      platform: input.platform,
      commandKind: 'failed-save',
      errorText: input.errorText,
    });
    const failedResponse = await requestStep(input, failedCommand, childIdentity, deadlineAt);
    input.validators.requireDraft(
      input.platform,
      actionReceipt(failedResponse, 'failed-save').hierarchy,
      true,
    );
    const failed = await boundedRead(input.snapshot, input.signal, deadlineAt);
    assert.deepEqual(failed, baseline, 'Injected Detox save changed owned SQL');
    assert.deepEqual(input.proxy.faultState, { attemptId: faultAttemptId, injectedCount: 1 });

    assert.deepEqual(input.proxy.clearFault(faultAttemptId), {
      attemptId: faultAttemptId,
      injectedCount: 1,
    });
    faultArmed = false;

    const retryCommand = buildDetoxSaveRetryCommand({
      commandId: 3,
      runId: input.runId,
      attemptId: input.attemptId,
      platform: input.platform,
      commandKind: 'retry-save',
    });
    await requestStep(input, retryCommand, childIdentity, deadlineAt);
    const after = await boundedRead(input.snapshot, input.signal, deadlineAt);
    const planId = input.validators.validateSnapshots(
      baseline,
      failed,
      after,
      input.accountUid,
      input.platform,
    );
    assert.match(planId, PLAN_ID);
    const createdRead = await boundedRead(() => input.readPlan(planId), input.signal, deadlineAt);
    assert.equal(createdRead.status, 200);
    assert.equal(record(createdRead.plan, 'Detox created API plan').id, planId);

    const reopenCommand = buildDetoxSaveRetryCommand({
      commandId: 4,
      runId: input.runId,
      attemptId: input.attemptId,
      platform: input.platform,
      commandKind: 'reopen',
      planId,
    });
    const reopenedResponse = await requestStep(input, reopenCommand, childIdentity, deadlineAt);
    input.validators.requireDraft(
      input.platform,
      actionReceipt(reopenedResponse, 'reopen').hierarchy,
      false,
    );
    const reopened = await boundedRead(input.snapshot, input.signal, deadlineAt);
    assert.deepEqual(reopened, after, 'Detox reopen changed the durable plan');
    const reopenedRead = await boundedRead(() => input.readPlan(planId), input.signal, deadlineAt);
    assert.equal(reopenedRead.status, 200);
    assert.deepEqual(
      record(reopenedRead.plan, 'Detox reopened API plan'),
      record(createdRead.plan, 'Detox created API plan'),
      'Detox API read changed between retry and reopen',
    );
    await boundedRead(
      () =>
        input.proxy.waitForQuiescence(
          Math.min(30_000, Math.max(1, Math.floor(deadlineAt - performance.now()))),
        ),
      input.signal,
      deadlineAt,
    );
    requireProxyWrites(
      input.proxy.observations,
      faultAttemptId,
      planId,
      input.targetOrigin,
      input.requestIdFence,
      baseline,
    );
    return {
      kind: 'private-detox-save-retry-capture-not-public-receipt',
      runId: input.runId,
      attemptId: input.attemptId,
      platform: input.platform,
      faultAttemptId,
      planId,
      injectedWrites: 1,
      forwardedWrites: 1,
      apiReads: 2,
      snapshots: ['before', 'failed', 'after', 'reopened'],
      assertionIds: [
        'NAT-save-retry-error',
        'NAT-save-retry-retained-draft',
        'NAT-save-retry-final-save',
        'NAT-save-retry-reopen',
        'NAT-save-retry-unrelated-state',
      ],
      nativePassingCases: 0,
      publicPromotionEligible: false,
      cleanupOwner: 'existing-detox-integrated-connection-driver',
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (faultArmed) {
      try {
        input.proxy.clearFault(faultAttemptId);
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        if (primaryError instanceof Error)
          throw new Error(`${primaryError.message}; save/retry fault cleanup failed: ${message}`, {
            cause: primaryError,
          });
        throw cleanupError;
      }
    }
  }
}

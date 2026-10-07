import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  requireStableDetoxElementAttributes,
  type DetoxConnectionOwnedProcessIdentity,
  type DetoxConnectionPlatform,
  type DetoxConnectionSourceReceipt,
} from './detox-connection-ipc';
import {
  applyDetoxElementAttributeEvidence,
  parseDetoxViewHierarchyXml,
  type DetoxElementAttributesResult,
} from './detox-native-hierarchy';
import {
  assertTrainingCommand,
  assertTrainingResponse,
  hashBytes,
  hashJson,
  publishTrainingCancellation,
  readOwnedTrainingFile,
  readOwnedTrainingPath,
  writeAtomicTrainingJson,
} from './detox-training-child-protocol.mjs';
import type { TrainingCommand } from './detox-training-child-protocol.mjs';
import type { DetoxTrainingStep, DetoxTrainingStepReceipt } from './detox-training-journey';

const COMMAND_SCHEMA = 1 as const;
const RUN_ID = /^[a-f0-9]{24}$/;
const PLAN_ATTEMPT = /^[a-f0-9]{24}:first$/;
const COMMAND_TIMEOUT_MIN_MS = 1_000;
const COMMAND_TIMEOUT_MAX_MS = 600_000;
const CANCELLATION_DRAIN_MS = 2_000;

export type DetoxTrainingSourceReceipt = DetoxConnectionSourceReceipt &
  Readonly<{
    fileName: string;
    producerPath?: string;
    producerRealpath?: string;
    producerBytes?: number;
    producerSha256?: string;
    producerMode?: number;
    producerUid?: number;
    producerNlink?: number;
    producerDev?: number;
    producerIno?: number;
    sourceNlink?: number;
    sourceDev?: number;
    sourceIno?: number;
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

export type DetoxTrainingStepSourceFiles = Readonly<{
  xml: string;
  screenshot: string;
  attributesBefore: string;
  attributesAfter: string;
}>;

export type DetoxTrainingStepEvidence = Readonly<{
  selector: string;
  before: unknown;
  after: unknown;
  frameStable: true;
}>;

export type VerifiedDetoxTrainingStepReceipt = DetoxTrainingStepReceipt &
  Readonly<{
    sourceFiles: DetoxTrainingStepSourceFiles;
    sourceReceipts: Readonly<{
      xml: DetoxTrainingSourceReceipt;
      screenshot: DetoxTrainingSourceReceipt;
      attributesBefore: DetoxTrainingSourceReceipt;
      attributesAfter: DetoxTrainingSourceReceipt;
    }>;
    selectorEvidence: readonly DetoxTrainingStepEvidence[];
  }>;

export type DetoxTrainingRestartReceipt = Readonly<{
  schemaVersion: 1;
  kind: 'private-detox-training-restart-receipt';
  commandId: number;
  commandHash: string;
  status: 'completed' | 'failed' | 'cancelled';
  runId: string;
  attemptId: string;
  platform: DetoxConnectionPlatform;
  appIdentifier: string;
  launchCount: number;
  synchronizationDisabled: true;
  launchArgsHash: string;
  childIdentity: DetoxConnectionOwnedProcessIdentity;
  startedMonotonicMs: number;
  finishedMonotonicMs: number;
  cleanupFence: 'required-before-return';
}>;

type TrainingResponse = Readonly<{
  schemaVersion: typeof COMMAND_SCHEMA;
  kind: 'private-detox-training-response';
  commandId: number;
  commandHash: string;
  commandKind: 'training-step' | 'restart-app' | 'shutdown';
  runId: string;
  attemptId: string;
  platform: DetoxConnectionPlatform;
  status: 'completed' | 'failed' | 'cancelled';
  childIdentity: DetoxConnectionOwnedProcessIdentity;
  startedMonotonicMs: number;
  finishedMonotonicMs: number;
  stepReceipt?: VerifiedDetoxTrainingStepReceipt;
  restartReceipt?: DetoxTrainingRestartReceipt;
  error?: { name: string; message: string };
}>;

type TrainingCommandInput = Readonly<{
  commandKind: 'training-step' | 'restart-app' | 'shutdown';
  step?: DetoxTrainingStep;
  appIdentifier?: string;
  launchCount?: number;
}>;

/**
 * The initial command envelope is a protected evidence write. Keeping this
 * seam explicit lets source controls model cancellation during that write
 * without replacing the real writer or changing the caller-owned deadline.
 */
export type DetoxTrainingEvidenceWriter = (
  root: string,
  name: string,
  value: unknown,
  options: { signal?: AbortSignal; deadlineAt?: number },
) => Promise<void>;

export type DetoxTrainingCancellationWriter = (
  root: string,
  command: TrainingCommand,
  options: { signal?: AbortSignal; deadlineAt?: number },
) => Promise<void>;

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireIdentity(value: unknown, label: string): DetoxConnectionOwnedProcessIdentity {
  const row = record(value, label);
  assert(Number.isSafeInteger(row.pid) && Number(row.pid) > 1, `${label} pid is invalid`);
  assert(Number.isSafeInteger(row.pgid) && Number(row.pgid) > 1, `${label} pgid is invalid`);
  assert(typeof row.started === 'string' && row.started.length > 0, `${label} started is invalid`);
  return row as unknown as DetoxConnectionOwnedProcessIdentity;
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), `${label} hash is invalid`);
}

function requireSourceReceipt(
  value: unknown,
  producer: DetoxConnectionSourceReceipt['producer'],
  fileName: string,
  artifactRoot: string,
  child: DetoxConnectionOwnedProcessIdentity,
  maxBytes: number,
  requireProducerPath = false,
): DetoxTrainingSourceReceipt {
  const row = record(value, `${producer} source receipt`);
  assert.equal(row.producer, producer);
  assert.equal(row.sourceKind, 'file');
  assert.equal(row.fileName, fileName);
  assert.equal(row.processPid, child.pid);
  assert.equal(row.processPgid, child.pgid);
  assert.equal(row.processStarted, child.started);
  assert(Number.isSafeInteger(row.sourceBytes) && Number(row.sourceBytes) > 0);
  assert(Number(row.sourceBytes) <= maxBytes, `${producer} source exceeds its bound`);
  requireHash(row.sourceSha256, `${producer} source`);
  assert(typeof row.sourcePath === 'string' && path.isAbsolute(row.sourcePath));
  assert(typeof row.sourceRealpath === 'string' && row.sourceRealpath === row.sourcePath);
  const expectedPath = path.join(path.resolve(artifactRoot), fileName);
  assert.equal(
    path.resolve(row.sourcePath),
    expectedPath,
    `${producer} source escaped artifact root`,
  );
  assert(Number.isSafeInteger(row.sourceMode) && Number(row.sourceMode) === 0o600);
  if (typeof process.getuid === 'function') assert.equal(row.sourceUid, process.getuid());
  if (row.sourceNlink !== undefined) {
    assert.equal(row.sourceNlink, 1);
    assert(Number.isSafeInteger(row.sourceDev));
    assert(Number.isSafeInteger(row.sourceIno));
  }
  if (requireProducerPath || row.producerPath !== undefined) {
    assert(typeof row.producerPath === 'string' && path.isAbsolute(row.producerPath));
    assert(typeof row.producerRealpath === 'string' && row.producerRealpath === row.producerPath);
    assert(Number.isSafeInteger(row.producerBytes) && Number(row.producerBytes) > 0);
    assert(Number(row.producerBytes) <= maxBytes);
    requireHash(row.producerSha256, `${producer} producer`);
    assert(Number.isSafeInteger(row.producerMode) && (Number(row.producerMode) & 0o022) === 0);
    if (typeof process.getuid === 'function') assert.equal(row.producerUid, process.getuid());
    assert.equal(row.producerNlink, 1);
    assert(Number.isSafeInteger(row.producerDev));
    assert(Number.isSafeInteger(row.producerIno));
    assert.equal(row.producerRetention, 'owned-snapshot');
    assert(
      typeof row.producerSnapshotPath === 'string' && path.isAbsolute(row.producerSnapshotPath),
    );
    assert.equal(row.producerSnapshotRealpath, row.producerSnapshotPath);
    assert(
      Number.isSafeInteger(row.producerSnapshotBytes) && Number(row.producerSnapshotBytes) > 0,
    );
    assert(Number(row.producerSnapshotBytes) <= maxBytes);
    requireHash(row.producerSnapshotSha256, `${producer} retained snapshot`);
    assert.equal(row.producerSnapshotMode, 0o600);
    if (typeof process.getuid === 'function')
      assert.equal(row.producerSnapshotUid, process.getuid());
    assert.equal(row.producerSnapshotNlink, 1);
    assert(Number.isSafeInteger(row.producerSnapshotDev));
    assert(Number.isSafeInteger(row.producerSnapshotIno));
    assert.equal(
      row.producerSha256,
      row.sourceSha256,
      `${producer} producer bytes changed before ownership copy`,
    );
  }
  return row as unknown as DetoxTrainingSourceReceipt;
}

async function readAndVerifySource(
  root: string,
  receipt: DetoxTrainingSourceReceipt,
  maxBytes: number,
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
): Promise<Buffer> {
  const bytes = await readOwnedTrainingFile(root, receipt.fileName, maxBytes, options);
  assert.equal(bytes.byteLength, receipt.sourceBytes);
  assert.equal(hashBytes(bytes), receipt.sourceSha256);
  if (receipt.producerPath) {
    const canonicalRoot = await realpath(path.resolve(root));
    const snapshotParent = path.dirname(receipt.producerSnapshotPath!);
    const canonicalSnapshotParent = await realpath(snapshotParent).catch(() => undefined);
    assert.equal(
      canonicalSnapshotParent,
      canonicalRoot,
      'retained producer snapshot escaped artifact root',
    );
    assert.equal(
      path.resolve(receipt.producerSnapshotPath!),
      receipt.producerSnapshotPath,
      'retained producer snapshot path is not normalized',
    );
    const snapshot = await readOwnedTrainingPath(receipt.producerSnapshotPath!, maxBytes, options);
    assert.equal(snapshot.realpath, receipt.producerSnapshotRealpath);
    assert.equal(snapshot.bytes.byteLength, receipt.producerSnapshotBytes);
    assert.equal(hashBytes(snapshot.bytes), receipt.producerSnapshotSha256);
    assert.equal(snapshot.metadata.nlink, receipt.producerSnapshotNlink);
    assert.equal(snapshot.metadata.dev, receipt.producerSnapshotDev);
    assert.equal(snapshot.metadata.ino, receipt.producerSnapshotIno);
    assert.deepEqual(
      snapshot.bytes,
      bytes,
      'staged screenshot differs from retained producer bytes',
    );
    assert.equal(receipt.producerBytes, snapshot.bytes.byteLength);
    assert.equal(receipt.producerSha256, hashBytes(snapshot.bytes));
  }
  return bytes;
}

function jsonBytes(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`${label} is not JSON`, { cause: error });
  }
}

function valueForRendered(value: unknown): string | undefined {
  const row =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  for (const key of ['text', 'label', 'value', 'identifier'])
    if (typeof row?.[key] === 'string') return row[key];
  return undefined;
}

/** Re-reads every original XML/PNG/getAttributes file before accepting a step. */
export async function verifyDetoxTrainingStepReceipt(input: {
  artifactRoot: string;
  step: DetoxTrainingStep;
  receipt: VerifiedDetoxTrainingStepReceipt;
  expectedRunId?: string;
  expectedAttemptId?: string;
  expectedChild?: DetoxConnectionOwnedProcessIdentity;
  expectedCommandId?: number;
  expectedCommandHash?: string;
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<VerifiedDetoxTrainingStepReceipt> {
  const {
    artifactRoot,
    step,
    receipt,
    expectedRunId,
    expectedAttemptId,
    expectedChild,
    expectedCommandId,
    expectedCommandHash,
    signal,
    deadlineAt = Infinity,
  } = input;
  const fence = () => {
    if (signal?.aborted)
      throw signal.reason ?? new Error('Detox training receipt verification cancelled');
    if (performance.now() >= deadlineAt)
      throw new Error('Detox training receipt verification deadline elapsed');
  };
  fence();
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, 'private-detox-training-step-receipt');
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.stepId, step.id);
  assert.equal(receipt.assertionId, step.assertionId);
  if (expectedRunId !== undefined) assert.equal(receipt.runId, expectedRunId);
  if (expectedAttemptId !== undefined) assert.equal(receipt.attemptId, expectedAttemptId);
  if (expectedCommandId !== undefined) assert.equal(receipt.commandId, expectedCommandId);
  if (expectedCommandHash !== undefined) assert.equal(receipt.commandHash, expectedCommandHash);
  assert.equal(receipt.platform, step.platform);
  assert.equal(receipt.viewId, step.viewId);
  assert.equal(receipt.actionCompleted, true);
  assert.equal(receipt.hierarchyCaptured, true);
  assert.equal(receipt.screenshotCaptured, true);
  assert.deepEqual(receipt.selectors, step.selectors);
  const child = requireIdentity(receipt.childIdentity, 'training step child identity');
  if (expectedChild) {
    assert.equal(child.pid, expectedChild.pid);
    assert.equal(child.pgid, expectedChild.pgid);
    assert.equal(child.started, expectedChild.started);
  }
  const files = record(
    receipt.sourceFiles,
    'training step source files',
  ) as DetoxTrainingStepSourceFiles;
  for (const name of Object.values(files))
    assert(
      typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:json|xml|png)$/.test(name),
    );
  const sourceReceipts = record(receipt.sourceReceipts, 'training step source receipts');
  const xmlReceipt = requireSourceReceipt(
    sourceReceipts.xml,
    'detox.device.generateViewHierarchyXml',
    files.xml,
    artifactRoot,
    child,
    4 * 1024 * 1024,
  );
  const screenshotReceipt = requireSourceReceipt(
    sourceReceipts.screenshot,
    'detox.device.takeScreenshot',
    files.screenshot,
    artifactRoot,
    child,
    16 * 1024 * 1024,
    true,
  );
  const beforeReceipt = requireSourceReceipt(
    sourceReceipts.attributesBefore,
    'detox.element.getAttributes',
    files.attributesBefore,
    artifactRoot,
    child,
    256 * 1024,
  );
  const afterReceipt = requireSourceReceipt(
    sourceReceipts.attributesAfter,
    'detox.element.getAttributes',
    files.attributesAfter,
    artifactRoot,
    child,
    256 * 1024,
  );
  const [xmlBytes, screenshotBytes, beforeBytes, afterBytes] = await Promise.all([
    readAndVerifySource(artifactRoot, xmlReceipt, 4 * 1024 * 1024, {
      signal,
      deadlineAt,
    }),
    readAndVerifySource(artifactRoot, screenshotReceipt, 16 * 1024 * 1024, {
      signal,
      deadlineAt,
    }),
    readAndVerifySource(artifactRoot, beforeReceipt, 256 * 1024, {
      signal,
      deadlineAt,
    }),
    readAndVerifySource(artifactRoot, afterReceipt, 256 * 1024, {
      signal,
      deadlineAt,
    }),
  ]);
  fence();
  assert(xmlBytes.byteLength > 0 && screenshotBytes.byteLength > 0);
  assert(
    screenshotBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'training screenshot is not a PNG',
  );
  const before = jsonBytes(beforeBytes, 'training attributes before');
  const after = jsonBytes(afterBytes, 'training attributes after');
  assert(
    Array.isArray(before) && Array.isArray(after),
    'training attributes must preserve selector result arrays',
  );
  const beforeRows = before as DetoxElementAttributesResult[];
  const afterRows = after as DetoxElementAttributesResult[];
  assert.equal(beforeRows.length, step.selectors.length);
  assert.equal(afterRows.length, step.selectors.length);
  const tree = parseDetoxViewHierarchyXml(xmlBytes.toString('utf8'), step.platform);
  applyDetoxElementAttributeEvidence(tree, beforeRows);
  const selectorEvidence = step.selectors.map((selector, index) => {
    const stable = requireStableDetoxElementAttributes({
      platform: step.platform,
      selector,
      before: beforeRows[index],
      after: afterRows[index],
    });
    return {
      selector,
      before: beforeRows[index],
      after: afterRows[index],
      frameStable: stable.frameStable,
    } as const;
  });
  const rendered = record(receipt.rendered, 'training rendered evidence');
  for (const [selector, expected] of Object.entries(step.expectedRendered)) {
    assert.equal(rendered[selector], expected, `Rendered value differs for ${selector}`);
    const index = step.selectors.indexOf(selector);
    assert.notEqual(index, -1);
    const actualValue = valueForRendered(afterRows[index]);
    if (actualValue !== undefined)
      assert.equal(actualValue, expected, `getAttributes value differs for ${selector}`);
  }
  assert.equal(hashBytes(xmlBytes), xmlReceipt.sourceSha256);
  fence();
  return {
    ...receipt,
    selectorEvidence,
    sourceFiles: files,
    sourceReceipts: {
      xml: xmlReceipt,
      screenshot: screenshotReceipt,
      attributesBefore: beforeReceipt,
      attributesAfter: afterReceipt,
    },
  };
}

export class DetoxTrainingChildClient {
  #counter = 0;
  #closed = false;
  #cancelPublished = new Set<number>();
  readonly #root: string;
  readonly #platform: DetoxConnectionPlatform;
  readonly #runId: string;
  readonly #attemptId: string;
  readonly #signal: AbortSignal;
  readonly #deadlineAt: number;
  readonly #expectedChild: DetoxConnectionOwnedProcessIdentity;
  readonly #writeEvidence: DetoxTrainingEvidenceWriter;
  readonly #publishCancellation: DetoxTrainingCancellationWriter;

  constructor(input: {
    artifactRoot: string;
    platform: DetoxConnectionPlatform;
    runId: string;
    attemptId: string;
    signal: AbortSignal;
    /** Caller-owned monotonic deadline when available. */
    deadlineAt?: number;
    /** Backward-compatible current-Q budget input. */
    deadlineMs?: number;
    expectedChild: DetoxConnectionOwnedProcessIdentity;
    writeEvidence?: DetoxTrainingEvidenceWriter;
    publishCancellation?: DetoxTrainingCancellationWriter;
  }) {
    this.#root = path.resolve(input.artifactRoot);
    this.#platform = input.platform;
    this.#runId = input.runId;
    this.#attemptId = input.attemptId;
    this.#signal = input.signal;
    this.#expectedChild = requireIdentity(input.expectedChild, 'expected training child identity');
    this.#writeEvidence =
      input.writeEvidence ??
      ((root, name, value, options) => writeAtomicTrainingJson(root, name, value, options));
    this.#publishCancellation =
      input.publishCancellation ??
      ((root, command, options) => publishTrainingCancellation(root, command, options));
    assert(RUN_ID.test(input.runId));
    assert(PLAN_ATTEMPT.test(input.attemptId));
    assert.equal(input.attemptId, `${input.runId}:first`);
    const budgetMs = input.deadlineMs;
    const deadlineAt =
      input.deadlineAt ??
      (typeof budgetMs === 'number' &&
      Number.isSafeInteger(budgetMs) &&
      budgetMs >= COMMAND_TIMEOUT_MIN_MS &&
      budgetMs <= COMMAND_TIMEOUT_MAX_MS
        ? performance.now() + budgetMs
        : Number.NaN);
    assert(
      Number.isFinite(deadlineAt) && deadlineAt > 0,
      'Detox training child deadline is invalid or elapsed',
    );
    this.#deadlineAt = deadlineAt;
  }

  #fence(signal: AbortSignal, deadlineAt: number): void {
    if (signal.aborted) throw signal.reason ?? new Error('Detox training child request cancelled');
    if (performance.now() >= deadlineAt)
      throw new Error('Detox training child request deadline elapsed');
    if (this.#closed) throw new Error('Detox training child client is closed');
  }

  /**
   * Cancellation is terminal for the caller, but the child still needs a
   * bounded independent fence to publish its cancel record and let a late
   * response become observable. The caller's aborted signal must not cancel
   * those two evidence operations before they start.
   */
  async #cancelAndReadLateResponse(
    command: TrainingCommand,
    responseName: string,
    terminalReason: unknown,
  ): Promise<never> {
    const drain = new AbortController();
    const deadlineAt = performance.now() + CANCELLATION_DRAIN_MS;
    const timer = setTimeout(
      () => drain.abort(new Error('Detox training cancellation evidence drain elapsed')),
      CANCELLATION_DRAIN_MS,
    );
    const failures: unknown[] = [];
    const terminal =
      terminalReason instanceof Error
        ? terminalReason
        : new Error('Detox training child request cancelled', {
            cause: terminalReason,
          });
    try {
      if (!this.#cancelPublished.has(command.commandId)) {
        this.#cancelPublished.add(command.commandId);
        try {
          await this.#publishCancellation(this.#root, command, {
            signal: drain.signal,
            deadlineAt,
          });
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        const bytes = await readOwnedTrainingFile(this.#root, responseName, 2 * 1024 * 1024, {
          signal: drain.signal,
          deadlineAt,
        });
        const response = assertTrainingResponse(
          JSON.parse(bytes.toString('utf8')),
          command,
          this.#expectedChild,
          deadlineAt,
        );
        if (response.status !== 'cancelled')
          failures.push(
            new Error('late successful Detox training response arrived after cancellation'),
          );
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && !(error instanceof SyntaxError)) failures.push(error);
      }
    } finally {
      clearTimeout(timer);
    }
    if (failures.length)
      throw new AggregateError(
        [terminal, ...failures],
        'Detox training cancellation evidence was not fully verified',
      );
    throw terminal;
  }

  async #request(
    input: TrainingCommandInput,
    options: { signal?: AbortSignal; deadlineAt?: number } = {},
  ): Promise<TrainingResponse> {
    const signal = options.signal ?? this.#signal;
    const deadlineAt = options.deadlineAt ?? this.#deadlineAt;
    this.#fence(signal, deadlineAt);
    const timeoutMs = Math.ceil(deadlineAt - performance.now());
    assert(timeoutMs >= COMMAND_TIMEOUT_MIN_MS, 'Detox training child command budget is too small');
    const commandWithoutHash = {
      schemaVersion: COMMAND_SCHEMA,
      kind: 'private-detox-training-command',
      commandId: ++this.#counter,
      runId: this.#runId,
      attemptId: this.#attemptId,
      platform: this.#platform,
      timeoutMs,
      ...input,
      commandHash: undefined,
    };
    const command = assertTrainingCommand({
      ...commandWithoutHash,
      commandHash: hashJson(commandWithoutHash),
    });
    const commandName = `detox-training-command-${command.commandId}.private.json`;
    const responseName = `detox-training-response-${command.commandId}.private.json`;
    try {
      await this.#writeEvidence(this.#root, commandName, command, {
        signal,
        deadlineAt,
      });
    } catch (error) {
      // The child may close its stdin or the caller may abort while the first
      // command is being published. Preserve the original deadline and enter
      // the same bounded cancellation drain used after a published command.
      if (signal.aborted || performance.now() >= deadlineAt)
        return this.#cancelAndReadLateResponse(command, responseName, signal.reason ?? error);
      throw error;
    }
    for (;;) {
      if (signal.aborted) {
        return this.#cancelAndReadLateResponse(
          command,
          responseName,
          signal.reason ?? new Error('Detox training child request cancelled'),
        );
      }
      if (performance.now() >= deadlineAt) {
        return this.#cancelAndReadLateResponse(
          command,
          responseName,
          new Error('Detox training child response deadline elapsed'),
        );
      }
      try {
        const bytes = await readOwnedTrainingFile(this.#root, responseName, 2 * 1024 * 1024, {
          signal,
          deadlineAt,
        });
        const response = assertTrainingResponse(
          JSON.parse(bytes.toString('utf8')),
          command,
          this.#expectedChild,
        );
        this.#fence(signal, deadlineAt);
        return response as TrainingResponse;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (signal.aborted)
          return this.#cancelAndReadLateResponse(
            command,
            responseName,
            signal.reason ?? new Error('Detox training child request cancelled'),
          );
        if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(25, Math.max(1, deadlineAt - performance.now()))),
      );
    }
  }

  async runTrainingStep(
    step: DetoxTrainingStep,
    options: { signal?: AbortSignal; deadlineAt?: number } = {},
  ) {
    const response = await this.#request({ commandKind: 'training-step', step }, options);
    assert.equal(response.status, 'completed');
    assert(response.stepReceipt, 'Detox training child omitted completed step receipt');
    return verifyDetoxTrainingStepReceipt({
      artifactRoot: this.#root,
      step,
      receipt: response.stepReceipt,
      expectedRunId: this.#runId,
      expectedAttemptId: this.#attemptId,
      expectedChild: this.#expectedChild,
      expectedCommandId: response.commandId,
      expectedCommandHash: response.commandHash,
      signal: options.signal ?? this.#signal,
      deadlineAt: options.deadlineAt ?? this.#deadlineAt,
    });
  }

  async restartApp(options: {
    appIdentifier: string;
    launchCount: number;
    signal?: AbortSignal;
    deadlineAt?: number;
  }) {
    assert(options.appIdentifier.length > 0);
    assert(Number.isSafeInteger(options.launchCount) && options.launchCount > 0);
    const response = await this.#request(
      {
        commandKind: 'restart-app',
        appIdentifier: options.appIdentifier,
        launchCount: options.launchCount,
      },
      options,
    );
    assert.equal(response.status, 'completed');
    const receipt = response.restartReceipt;
    assert(receipt, 'Detox training child omitted restart receipt');
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.kind, 'private-detox-training-restart-receipt');
    assert.equal(receipt.commandId, response.commandId);
    assert.equal(receipt.commandHash, response.commandHash);
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.appIdentifier, options.appIdentifier);
    assert.equal(receipt.launchCount, options.launchCount);
    assert.equal(receipt.runId, this.#runId);
    assert.equal(receipt.attemptId, this.#attemptId);
    assert.equal(receipt.platform, this.#platform);
    assert.equal(receipt.childIdentity.pid, this.#expectedChild.pid);
    assert.equal(receipt.childIdentity.pgid, this.#expectedChild.pgid);
    assert.equal(receipt.childIdentity.started, this.#expectedChild.started);
    assert(Number.isFinite(receipt.startedMonotonicMs));
    assert(Number.isFinite(receipt.finishedMonotonicMs));
    assert(receipt.finishedMonotonicMs >= receipt.startedMonotonicMs);
    assert.equal(receipt.synchronizationDisabled, true);
    assert.equal(receipt.cleanupFence, 'required-before-return');
    requireHash(receipt.launchArgsHash, 'Detox launch arguments');
    return receipt;
  }

  async shutdown(options: { signal?: AbortSignal; deadlineAt?: number } = {}) {
    if (this.#closed) return;
    const response = await this.#request({ commandKind: 'shutdown' }, options);
    assert.equal(response.status, 'completed');
    this.#closed = true;
  }

  close(): void {
    this.#closed = true;
  }
}

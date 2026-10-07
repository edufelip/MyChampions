import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  requireAndroidDetoxCameraQualification,
  type AndroidDetoxCameraBridgeRead,
  type AndroidDetoxCameraFrameHostPair,
  type AndroidDetoxCameraLocale,
} from './native-detox-camera-android-contract';
import { requireAndroidDetoxCameraIdentityBoundary } from './native-detox-camera-android-identity';
import type {
  AndroidCameraSqlSourceReceipt,
  NativeRequestBodyCaptureReceipt,
  ProxyObservation,
} from './native-detox-camera-android-q-adapter';

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export type AndroidDetoxCameraFlowReceipt = Readonly<{
  schemaVersion: 1;
  kind: 'private-owned-android-detox-camera-flow';
  status: 'observed';
  captureRunId: string;
  ownerRunId: string;
  attemptId: string;
  serial: string;
  appId: 'com.edufelip.mychampions.dev';
  actorRoles: readonly ['coach', 'student'];
  inviteCodeSha256: string;
  pendingConnectionId: string;
  pendingConnectionIdSha256: string;
  source: 'owned-detox-child-native-hierarchy';
  childPid: number;
  commandHash: string;
  originalActionReceipts: readonly AndroidDetoxCameraActionReceipt[];
}>;

export type AndroidDetoxCameraActionReceipt = Readonly<{
  kind: 'sign-in' | 'camera-denial' | 'manual-submit';
  actor?: 'coach' | 'student';
  selector: string;
  action: 'tap';
  command: Readonly<{ commandId: number; pid: number; argvSha256: string }>;
  frame: Readonly<{
    label: string;
    selector: string;
    hierarchyPath: string;
    hierarchySha256: string;
    attributesPath: string;
    attributesSha256: string;
    screenshotPath: string;
    screenshotSha256: string;
    originalScreenshotPath: string;
    originalScreenshotSha256: string;
  }>;
}>;

export type AndroidDetoxCameraFrame = Readonly<{
  label: 'entry' | 'prompt' | 'denied' | 'manual';
  hierarchy: AndroidDetoxCameraFrameHostPair;
  screenshot: AndroidDetoxCameraFrameHostPair['screenshot'];
}>;

export type AndroidDetoxCameraProducerReceipts = Readonly<{
  captureRunId: string;
  ownerRunId: string;
  targetRunId: string;
  backendRunId: string;
  producerStatus: 'receipts-bound';
  sourceSelectionHash: string;
  locale: AndroidDetoxCameraLocale;
  localeReceiptPath: string;
  localeReceiptSha256: string;
  permission: Readonly<{
    before: 'denied';
    after: 'denied';
    receiptPath: string;
    receiptSha256: string;
    executionCount: number;
  }>;
  bridge: Readonly<{
    receiptPath: string;
    receiptSha256: string;
    receiptHost: AndroidDetoxCameraBridgeRead['receiptHost'];
    receipt: AndroidDetoxCameraBridgeRead['receipt'];
    frames: readonly AndroidDetoxCameraFrame[];
    executionCount: number;
  }>;
  flow: AndroidDetoxCameraFlowReceipt;
  pendingConnectionId: string;
  inviteCodeSha256: string;
  studentAuthUidSha256: string;
  submission: NativeRequestBodyCaptureReceipt;
  sqlReceipts: readonly AndroidCameraSqlSourceReceipt[];
  transport: readonly ProxyObservation[];
  sourceTreeHash: string;
  helperInputsHash: string;
  buildHash: string;
}>;

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}

function requireRelative(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' &&
      value.length > 0 &&
      !path.isAbsolute(value) &&
      !value.split(/[\\/]/u).includes('..'),
    `${label} must be an owned relative path`,
  );
}

function requireFlow(
  value: AndroidDetoxCameraFlowReceipt,
  expected: { runId: string; ownerRunId: string; serial: string },
): void {
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.kind, 'private-owned-android-detox-camera-flow');
  assert.equal(value.status, 'observed');
  requireRunId(value.captureRunId, 'camera flow capture run');
  requireRunId(value.ownerRunId, 'camera flow owner run');
  assert.equal(value.captureRunId, expected.runId);
  assert.equal(value.ownerRunId, expected.ownerRunId);
  assert.equal(value.attemptId, `${value.ownerRunId}:first`);
  assert.equal(value.serial, expected.serial);
  assert.equal(value.appId, 'com.edufelip.mychampions.dev');
  assert.deepEqual(value.actorRoles, ['coach', 'student']);
  requireHash(value.inviteCodeSha256, 'camera flow invite hash');
  assert(typeof value.pendingConnectionId === 'string' && SAFE_ID.test(value.pendingConnectionId));
  assert.equal(value.pendingConnectionIdSha256, hashText(value.pendingConnectionId));
  assert.equal(value.source, 'owned-detox-child-native-hierarchy');
  assert(Number.isSafeInteger(value.childPid) && value.childPid > 0, 'camera child PID is invalid');
  requireHash(value.commandHash, 'camera child command hash');
  assert.equal(value.originalActionReceipts.length, 4);
  for (const row of value.originalActionReceipts) {
    assert(
      row.kind === 'sign-in' || row.kind === 'camera-denial' || row.kind === 'manual-submit',
      'camera action kind is invalid',
    );
    assert(typeof row.selector === 'string' && row.selector.length > 0);
    assert.equal(row.action, 'tap');
    assert(Number.isSafeInteger(row.command.commandId) && row.command.commandId > 0);
    assert.equal(row.command.pid, value.childPid);
    assert.equal(row.command.argvSha256, value.commandHash);
    assert(
      row.frame && typeof row.frame.label === 'string' && row.frame.label.length > 0,
      'camera action frame label is invalid',
    );
    assert(
      typeof row.frame.selector === 'string' && row.frame.selector.length > 0,
      'camera action frame selector is invalid',
    );
    for (const key of ['hierarchyPath', 'attributesPath', 'screenshotPath'] as const)
      requireRelative(row.frame[key], `camera action ${key}`);
    // device.takeScreenshot() returns Detox's temp file
    // "detox-<worker pid>-<random>.detox.png"; bind it to this child's PID.
    const originalName = path.basename(row.frame.originalScreenshotPath);
    assert(
      path.isAbsolute(row.frame.originalScreenshotPath) &&
        (/^(?:detox-training-)?camera-[A-Za-z0-9._-]+\.png$/u.test(originalName) ||
          (/^detox-\d+-[A-Za-z0-9]+\.detox\.png$/u.test(originalName) &&
            originalName.startsWith(`detox-${value.childPid}-`))),
      'camera original screenshot path is not an owned Detox capture',
    );
    for (const key of [
      'hierarchySha256',
      'attributesSha256',
      'screenshotSha256',
      'originalScreenshotSha256',
    ] as const)
      requireHash(row.frame[key], `camera action ${key} hash`);
    assert.equal(row.frame.screenshotSha256, row.frame.originalScreenshotSha256);
  }
  const expectedActions = [
    { kind: 'sign-in', actor: 'coach' },
    { kind: 'sign-in', actor: 'student' },
    { kind: 'camera-denial', actor: undefined },
    { kind: 'manual-submit', actor: undefined },
  ] as const;
  const frameLabels = new Set<string>();
  for (const [index, expectedAction] of expectedActions.entries()) {
    const actual = value.originalActionReceipts[index];
    assert.equal(actual.kind, expectedAction.kind);
    assert.equal(actual.actor, expectedAction.actor);
    assert(!frameLabels.has(actual.frame.label), 'camera action frame is reused');
    frameLabels.add(actual.frame.label);
  }
}

function requireFrame(value: AndroidDetoxCameraFrame, label: string): void {
  assert.equal(value.label, label);
  assert(value.hierarchy && value.screenshot);
  requireRelative(value.hierarchy.hierarchy.path, `${label} hierarchy path`);
  requireRelative(value.hierarchy.screenshot.path, `${label} frame screenshot path`);
  requireRelative(value.screenshot.path, `${label} screenshot path`);
  requireHash(value.hierarchy.hierarchy.sha256, `${label} hierarchy hash`);
  requireHash(value.hierarchy.screenshot.sha256, `${label} frame screenshot hash`);
  assert.equal(value.hierarchy.hierarchy.mode, 0o600);
  assert.equal(value.hierarchy.screenshot.mode, 0o600);
}

/**
 * Validates the Detox-specific producer shape. The Maestro producer has a
 * different command/frame contract, so this adapter keeps the actual Detox
 * UiAutomator receipts distinct instead of projecting them into Maestro rows.
 */
export function requireAndroidDetoxCameraProducerOutput(
  value: AndroidDetoxCameraProducerReceipts,
  expected: {
    selectionHash: string;
    requestedRunId: string;
    runId: string;
    ownerRunId: string;
    targetRunId: string;
    serial: string;
    expectedLocale: AndroidDetoxCameraLocale;
  },
): AndroidDetoxCameraProducerReceipts {
  assert.equal(value.captureRunId, expected.runId);
  assert.equal(value.ownerRunId, expected.ownerRunId);
  requireRunId(value.targetRunId, 'camera target owner run');
  assert.equal(value.targetRunId, expected.targetRunId);
  requireAndroidDetoxCameraIdentityBoundary({
    requestedRunId: expected.requestedRunId,
    captureRunId: value.captureRunId,
    ownerRunId: value.ownerRunId,
    backendRunId: value.backendRunId,
  });
  assert.notEqual(value.targetRunId, expected.requestedRunId);
  assert.notEqual(value.targetRunId, expected.runId);
  assert.notEqual(value.targetRunId, value.captureRunId);
  assert.notEqual(value.targetRunId, value.ownerRunId);
  assert.notEqual(value.targetRunId, value.backendRunId);
  assert.equal(value.producerStatus, 'receipts-bound');
  assert.equal(value.sourceSelectionHash, expected.selectionHash);
  assert.equal(value.locale, expected.expectedLocale);
  requireHash(value.sourceTreeHash, 'camera source tree hash');
  requireHash(value.helperInputsHash, 'camera helper inputs hash');
  requireHash(value.buildHash, 'camera build hash');
  requireRelative(value.localeReceiptPath, 'camera locale receipt path');
  requireHash(value.localeReceiptSha256, 'camera locale receipt hash');
  requireFlow(value.flow, {
    runId: expected.runId,
    ownerRunId: expected.ownerRunId,
    serial: expected.serial,
  });
  assert.equal(value.pendingConnectionId, value.flow.pendingConnectionId);
  assert.equal(value.inviteCodeSha256, value.flow.inviteCodeSha256);
  requireHash(value.studentAuthUidSha256, 'camera student actor hash');
  assert.equal(value.submission.actorAuthUidHash, value.studentAuthUidSha256);
  const bridge = requireAndroidDetoxCameraQualification(value.bridge.receipt);
  assert.equal(bridge.locale, expected.expectedLocale);
  assert.equal(bridge.permissionBefore, 'denied');
  assert.equal(bridge.permissionAfter, 'denied');
  assert.equal(value.bridge.receiptPath, value.bridge.receiptHost.path);
  assert.equal(value.bridge.frames.length, 4);
  for (const [index, label] of ['entry', 'prompt', 'denied', 'manual'].entries())
    requireFrame(value.bridge.frames[index], label);
  assert(Number.isSafeInteger(value.bridge.executionCount) && value.bridge.executionCount >= 9);
  assert.equal(value.permission.before, 'denied');
  assert.equal(value.permission.after, 'denied');
  requireRelative(value.permission.receiptPath, 'permission receipt path');
  requireHash(value.permission.receiptSha256, 'permission receipt hash');
  assert(
    Number.isSafeInteger(value.permission.executionCount) && value.permission.executionCount >= 4,
  );
  assert.equal(value.submission.kind, 'owned-native-request-body-receipt-v1');
  assert.equal(value.submission.method, 'POST');
  assert.equal(value.submission.route, '/connections/invite-submissions');
  assert.equal(value.submission.status, 201);
  assert.equal(value.submission.outcome, 'forwarded');
  requireHash(value.submission.manualCodeSha256, 'camera submitted code hash');
  requireHash(value.submission.actionSha256, 'camera action hash');
  requireRelative(value.submission.sourcePath, 'camera submitted body path');
  requireRelative(value.submission.descriptorPath, 'camera submitted descriptor path');
  assert(value.sqlReceipts.length > 0, 'camera SQL receipts are missing');
  const phases = [...new Set(value.sqlReceipts.map((row) => row.phase))].sort();
  assert.deepEqual(phases, [
    'before',
    'isolation-after',
    'isolation-before',
    'pending',
    'training-after',
    'training-before',
  ]);
  assert(value.sqlReceipts.every((row) => row.mode === 0o600));
  assert(value.transport.length > 0, 'camera transport observations are missing');
  const post = value.transport.filter(
    (row) => row.method === 'POST' && row.pathHash === hashText('/connections/invite-submissions'),
  );
  assert.equal(post.length, 1);
  assert.equal(post[0].status, 201);
  return structuredClone(value);
}

export type AndroidDetoxCameraProducerContext = Readonly<{
  requestedRunId: string;
  captureRunId: string;
  backendRunId: string;
  ownerRunId: string;
  targetRunId: string;
  serial: string;
  expectedLocale: AndroidDetoxCameraLocale;
  selectionHash: string;
  bridge: AndroidDetoxCameraBridgeRead;
  flow: AndroidDetoxCameraFlowReceipt;
  permission: AndroidDetoxCameraProducerReceipts['permission'];
  localeReceiptPath: string;
  localeReceiptSha256: string;
  studentAuthUidSha256: string;
  submission: NativeRequestBodyCaptureReceipt;
  sqlReceipts: readonly AndroidCameraSqlSourceReceipt[];
  transport: readonly ProxyObservation[];
  sourceTreeHash: string;
  helperInputsHash: string;
  buildHash: string;
}>;

export function buildAndroidDetoxCameraProducer(
  context: AndroidDetoxCameraProducerContext,
): AndroidDetoxCameraProducerReceipts {
  const bridgeFrames = (['entry', 'prompt', 'denied', 'manual'] as const).map((label) => {
    const pair = context.bridge.frames[label];
    assert(pair, `Android Detox camera ${label} frame is missing`);
    return { label, hierarchy: pair, screenshot: pair.screenshot };
  });
  const result: AndroidDetoxCameraProducerReceipts = {
    captureRunId: context.captureRunId,
    ownerRunId: context.ownerRunId,
    targetRunId: context.targetRunId,
    backendRunId: context.backendRunId,
    producerStatus: 'receipts-bound',
    sourceSelectionHash: context.selectionHash,
    locale: context.expectedLocale,
    localeReceiptPath: context.localeReceiptPath,
    localeReceiptSha256: context.localeReceiptSha256,
    permission: context.permission,
    bridge: {
      receiptPath: context.bridge.receiptHost.path,
      receiptSha256: context.bridge.receiptHost.sha256,
      receiptHost: context.bridge.receiptHost,
      receipt: context.bridge.receipt,
      frames: bridgeFrames,
      executionCount: context.bridge.executions.length,
    },
    flow: context.flow,
    pendingConnectionId: context.flow.pendingConnectionId,
    inviteCodeSha256: context.flow.inviteCodeSha256,
    studentAuthUidSha256: context.studentAuthUidSha256,
    submission: context.submission,
    sqlReceipts: context.sqlReceipts,
    transport: context.transport,
    sourceTreeHash: context.sourceTreeHash,
    helperInputsHash: context.helperInputsHash,
    buildHash: context.buildHash,
  };
  return requireAndroidDetoxCameraProducerOutput(result, {
    selectionHash: context.selectionHash,
    requestedRunId: context.requestedRunId,
    runId: context.captureRunId,
    ownerRunId: context.ownerRunId,
    targetRunId: context.targetRunId,
    serial: context.serial,
    expectedLocale: context.expectedLocale,
  });
}

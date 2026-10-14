import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  readOwnedAndroidBoundedFile,
  type AndroidCapturedFrameReceipt,
  type AndroidStorageFileReceipt,
} from './native-android-session-adapter';
import type { NativeLocaleEvidence } from './locale-native-observation';
import type { NativePilotSelection, NativePilotTarget } from './native-pilot-contract';
import type { NativeCommandExecution } from './owned-native-command';

export const ANDROID_CAMERA_APP_ID = 'com.edufelip.mychampions.dev' as const;
export const ANDROID_CAMERA_PERMISSION = 'android.permission.CAMERA' as const;
export const ANDROID_CAMERA_SCENARIO = 'SCN-camera-denied-android' as const;
export const ANDROID_CAMERA_ASSERTION_IDS = Object.freeze([
  'NAT-camera-normal-entry',
  'NAT-camera-denial-guidance',
  'NAT-camera-manual-submit',
  'NAT-camera-unrelated-state',
] as const);

export type AndroidCameraFrameLabel = 'entry' | 'prompt' | 'denied' | 'manual' | 'pending';

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const SERIAL = /^emulator-[0-9]+$/u;
const APP_ID = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/u;
const MAX_COMMAND_STDOUT = 1024 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * Android ships the permission UI under one of these two package names. The
 * package is evidence from the captured resource ID; it is never inferred
 * from a caller supplied label or from an arbitrary text row.
 */
export const ANDROID_CAMERA_SYSTEM_PACKAGES = Object.freeze([
  'com.android.permissioncontroller',
  'com.google.android.permissioncontroller',
] as const);
export type AndroidCameraSystemPackage = (typeof ANDROID_CAMERA_SYSTEM_PACKAGES)[number];

export const ANDROID_CAMERA_PERMISSION_MESSAGE_RESOURCE = 'permission_message' as const;
export const ANDROID_CAMERA_PERMISSION_DENY_RESOURCE = 'permission_deny_button' as const;

export function isAndroidCameraSystemPackage(value: unknown): value is AndroidCameraSystemPackage {
  return (
    typeof value === 'string' &&
    (ANDROID_CAMERA_SYSTEM_PACKAGES as readonly string[]).includes(value)
  );
}

export function androidCameraPermissionResourceId(
  systemPackage: AndroidCameraSystemPackage,
  resource:
    | typeof ANDROID_CAMERA_PERMISSION_MESSAGE_RESOURCE
    | typeof ANDROID_CAMERA_PERMISSION_DENY_RESOURCE,
): string {
  return `${systemPackage}:id/${resource}`;
}

/** A bounded union is used only for Maestro readiness; the captured tree binds the concrete package. */
export const ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS = Object.freeze([
  '^com\\.(?:android\\.permissioncontroller|google\\.android\\.permissioncontroller):id/permission_message$',
  '^com\\.(?:android\\.permissioncontroller|google\\.android\\.permissioncontroller):id/permission_deny_button$',
] as const);

/** Build metadata supplies the app label expected in the system prompt. */
export const ANDROID_CAMERA_EXPECTED_APP_LABELS = Object.freeze({
  [ANDROID_CAMERA_APP_ID]: 'MyChampions Dev',
  'com.edufelip.mychampions': 'MyChampions',
} as const);

export function androidCameraExpectedAppLabel(appId: string): string {
  const label = (ANDROID_CAMERA_EXPECTED_APP_LABELS as Record<string, string | undefined>)[appId];
  assert(label, `Android camera app label is not declared for ${appId}`);
  return label;
}

export type AndroidCameraPermissionCommands = {
  clearUserDecision: readonly string[];
  revoke: readonly string[];
  check: readonly string[];
  checkFlags: readonly string[];
};

export type AndroidCameraPermissionState = {
  status: 'granted' | 'denied';
  decisionFlags: readonly string[];
};

export type AndroidCameraPermissionCheck = AndroidCameraCommandReceipt & {
  state: AndroidCameraPermissionState;
  flagsCommand: AndroidCameraCommandReceipt;
};

/** The command field is the existing owned-native-command terminal record. */
export type AndroidCameraCommandReceipt = {
  label: string;
  captureRunId: string;
  ownerRunId: string;
  serial: string;
  appId: string;
  attemptId: string;
  argv: readonly string[];
  execution: NativeCommandExecution;
  stdout: AndroidStorageFileReceipt | null;
};

/** This is the existing Android frame receipt, with a producer binding around it. */
export type AndroidCameraFrameSource = {
  label: AndroidCameraFrameLabel;
  captureRunId: string;
  ownerRunId: string;
  serial: string;
  appId: string;
  attemptId: string;
  command: AndroidCameraCommandReceipt;
  receipt: AndroidCapturedFrameReceipt;
  /**
   * Action provenance for the observation that produced this frame. The
   * action text itself is never retained; only its digest and safe selectors
   * are bound to the current capture/command ordinal.
   */
  action: {
    invocationId: string;
    ordinal: number;
    label: AndroidCameraFrameLabel;
    actionsSha256: string;
    viewId: string;
    selectorKind: 'id' | 'text';
    selectors: readonly string[];
    commandLabel: string;
    commandOrdinal: number;
  };
};

export type AndroidCameraRuntimeIdentity = {
  captureRunId: string;
  ownerRunId: string;
  backendRunId: string;
  backendAttemptId: string;
  serial: string;
  appId: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  target: NativePilotTarget;
  locale: NativeLocaleEvidence;
};

/**
 * Bind the public caller, capture artifact, owned target, and backend session
 * as four independently produced identities.  The public attempt is the
 * only source of requestedRunId; neither the target owner nor the producer may
 * manufacture or alias that boundary ID.
 */
export function requireAndroidCameraIdentityBoundary(input: {
  requestedRunId: string;
  captureRunId: string;
  ownerRunId: string;
  backendRunId: string;
}): void {
  const rows = [
    ['requested outer attempt', input.requestedRunId],
    ['capture artifact', input.captureRunId],
    ['owned target', input.ownerRunId],
    ['backend session', input.backendRunId],
  ] as const;
  for (const [label, value] of rows) {
    assert(
      typeof value === 'string' && RUN_ID.test(value),
      `Android camera ${label} run ID is invalid`,
    );
  }
  assert.equal(
    new Set(rows.map(([, value]) => value)).size,
    rows.length,
    'Android camera outer, capture, target-owner, and backend identities must remain distinct',
  );
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Stable binding for the exact current inventory selection passed to a producer. */
export function androidCameraSelectionHash(selection: NativePilotSelection): string {
  return sha256(
    JSON.stringify({
      arguments: selection.arguments,
      scenarioHash: selection.scenarioHash,
      requirementHash: selection.requirementHash,
    }),
  );
}

function requireString(value: unknown, label: string, pattern?: RegExp): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    `${label} is invalid`,
  );
  if (pattern) assert(pattern.test(value), `${label} is invalid`);
  return value;
}

export function buildAndroidCameraPermissionCommands(
  appId: string,
): AndroidCameraPermissionCommands {
  requireString(appId, 'Android app ID', APP_ID);
  return {
    clearUserDecision: [
      'shell',
      'pm',
      'clear-permission-flags',
      '--user',
      '0',
      appId,
      ANDROID_CAMERA_PERMISSION,
      'user-set',
      'user-fixed',
    ],
    revoke: ['shell', 'pm', 'revoke', '--user', '0', appId, ANDROID_CAMERA_PERMISSION],
    check: ['shell', 'dumpsys', 'package', appId],
    checkFlags: ['shell', 'dumpsys', 'package', appId],
  };
}

type ParsedAndroidCameraPermission = {
  status: 'granted' | 'denied';
  decisionFlags: readonly string[];
};

type AndroidPackageHeader = {
  line: number;
  indent: number;
  appId: string;
};

type AndroidRuntimePermissionSection = {
  line: number;
  indent: number;
};

type AndroidPackageUserSection = {
  line: number;
  indent: number;
  userId: string;
};

function leadingAndroidIndent(line: string): number {
  return line.match(/^[ \t]*/u)?.[0].length ?? 0;
}

function parseAndroidCameraPermissionRow(
  stdout: string,
  expectedAppId: string,
): ParsedAndroidCameraPermission {
  assert(typeof stdout === 'string', 'Android permission output is not text');
  requireString(expectedAppId, 'Expected Android app ID', APP_ID);
  const trimmed = stdout.trim();
  assert(
    trimmed !== 'granted' && trimmed !== 'denied',
    'legacy Android scalar permission output is not accepted',
  );
  assert(trimmed.length > 0, 'Android package dump is empty');

  const lines = stdout.split(/\r?\n/u);
  const packageHeaders: AndroidPackageHeader[] = [];
  const userSections: AndroidPackageUserSection[] = [];
  const runtimeSections: AndroidRuntimePermissionSection[] = [];
  lines.forEach((line, index) => {
    const packageHeader = line.match(/^\s*Package\s+\[([^\]\r\n]+)\]\s+\([^\)\r\n]*\)\s*:?\s*$/u);
    if (packageHeader)
      packageHeaders.push({
        line: index,
        indent: leadingAndroidIndent(line),
        appId: packageHeader[1],
      });
    const userHeader = line.match(/^(\s*)User\s+([0-9]+):(?:\s.*)?$/u);
    if (userHeader)
      userSections.push({
        line: index,
        indent: userHeader[1].length,
        userId: userHeader[2],
      });
    const runtimeHeader = line.match(/^(\s*)runtime permissions:\s*$/iu);
    if (runtimeHeader) runtimeSections.push({ line: index, indent: runtimeHeader[1].length });
  });
  assert.equal(packageHeaders.length, 1, 'Android package dump header is missing or ambiguous');
  assert.equal(
    packageHeaders[0].appId,
    expectedAppId,
    'Android package dump crossed package identity',
  );
  const packageHeader = packageHeaders[0];
  const packageEndOffset = lines
    .slice(packageHeader.line + 1)
    .findIndex(
      (line) => line.trim().length > 0 && leadingAndroidIndent(line) <= packageHeader.indent,
    );
  const packageEnd =
    packageEndOffset < 0 ? lines.length : packageHeader.line + 1 + packageEndOffset;
  const userZeroSections = userSections.filter(
    (section) =>
      section.userId === '0' &&
      section.line > packageHeader.line &&
      section.line < packageEnd &&
      section.indent > packageHeader.indent,
  );
  assert.equal(
    userZeroSections.length,
    1,
    'Android User 0 permission section is missing or ambiguous',
  );
  assert(
    userZeroSections[0].line > packageHeaders[0].line,
    'Android User 0 permission section is outside the targeted package',
  );
  const userZero = userZeroSections[0];
  const userEndOffset = lines
    .slice(userZero.line + 1, packageEnd)
    .findIndex((line) => line.trim().length > 0 && leadingAndroidIndent(line) <= userZero.indent);
  const userZeroEnd = userEndOffset < 0 ? packageEnd : userZero.line + 1 + userEndOffset;
  const userZeroRuntimeSections = runtimeSections.filter(
    (section) =>
      section.line > userZero.line &&
      section.line < userZeroEnd &&
      section.indent > userZero.indent,
  );
  assert.equal(
    userZeroRuntimeSections.length,
    1,
    'Android User 0 runtime permission section is missing or ambiguous',
  );
  assert(
    userZeroRuntimeSections[0].line > packageHeaders[0].line,
    'Android User 0 runtime permission section is outside the targeted package',
  );

  const sectionLines: string[] = [];
  for (let index = userZeroRuntimeSections[0].line + 1; index < userZeroEnd; index += 1) {
    const line = lines[index];
    if (line.trim().length > 0 && leadingAndroidIndent(line) <= userZeroRuntimeSections[0].indent)
      break;
    sectionLines.push(line);
  }
  const cameraRows = sectionLines.filter((line) =>
    /^\s*android\.permission\.CAMERA\s*:/u.test(line),
  );
  assert.equal(cameraRows.length, 1, 'Android camera permission row is missing or ambiguous');
  const cameraRow = cameraRows[0].match(
    /^\s*android\.permission\.CAMERA\s*:\s*granted=(true|false)\s*,\s*flags=\[([^\]\r\n]*)\]\s*$/u,
  );
  assert(cameraRow, 'Android camera permission row is missing or ambiguous');
  const decisionFlags = cameraRow[2]
    .trim()
    .split(/[|\s]+/u)
    .filter(Boolean)
    .map((flag) => flag.toUpperCase());
  // PackageManager.permissionFlagToString names; unknown flags cannot prove a reset.
  const knownFlags = new Set([
    'GRANTED_BY_DEFAULT',
    'POLICY_FIXED',
    'SYSTEM_FIXED',
    'USER_SET',
    'USER_FIXED',
    'REVIEW_REQUIRED',
    'REVOKE_WHEN_REQUESTED',
    'USER_SENSITIVE_WHEN_GRANTED',
    'USER_SENSITIVE_WHEN_DENIED',
    'RESTRICTION_INSTALLER_EXEMPT',
    'RESTRICTION_SYSTEM_EXEMPT',
    'RESTRICTION_UPGRADE_EXEMPT',
    'APPLY_RESTRICTION',
    'GRANTED_BY_ROLE',
    'REVOKED_COMPAT',
    'ONE_TIME',
    'AUTO_REVOKED',
  ]);
  assert(
    decisionFlags.every((flag) => knownFlags.has(flag)),
    'Android camera permission flags are malformed',
  );
  assert.equal(
    new Set(decisionFlags).size,
    decisionFlags.length,
    'Android camera permission flags are ambiguous',
  );
  return {
    status: cameraRow[1] === 'true' ? 'granted' : 'denied',
    decisionFlags,
  };
}

export function parseAndroidCameraPermissionStatus(
  stdout: string,
  expectedAppId: string,
): 'granted' | 'denied' {
  return parseAndroidCameraPermissionRow(stdout, expectedAppId).status;
}

/** Parse the unique package-manager runtime permission row for the expected app. */
export function parseAndroidCameraPermissionFlags(
  stdout: string,
  expectedAppId: string,
): readonly string[] {
  return parseAndroidCameraPermissionRow(stdout, expectedAppId).decisionFlags;
}

function requireIdentity(
  input: Pick<
    AndroidCameraRuntimeIdentity,
    | 'captureRunId'
    | 'ownerRunId'
    | 'backendRunId'
    | 'backendAttemptId'
    | 'serial'
    | 'appId'
    | 'target'
  >,
) {
  requireString(input.captureRunId, 'captureRunId', RUN_ID);
  requireString(input.ownerRunId, 'ownerRunId', RUN_ID);
  requireString(input.backendRunId, 'backendRunId', RUN_ID);
  assert(
    input.backendAttemptId === `${input.backendRunId}:first`,
    'backend attempt is not the first owned attempt',
  );
  requireString(input.serial, 'Android serial', SERIAL);
  requireString(input.appId, 'Android app ID', APP_ID);
  assert(input.target && typeof input.target === 'object', 'Android target identity is missing');
  assert.equal(input.target.deviceId, input.serial);
  assert.equal(input.target.appId, input.appId);
  requireString(input.target.osVersion, 'Android target OS version');
  requireString(input.target.buildProfile, 'Android target build profile');
  requireString(input.target.apiOrigin, 'Android app-facing build origin');
  assert.match(input.target.binaryHash ?? '', HASH, 'Android target binary hash is missing');
}

function requireCommandTerminal(
  command: AndroidCameraCommandReceipt,
  expected: AndroidCameraRuntimeIdentity,
): void {
  requireString(command.label, 'Android command label', /^[a-z0-9-]+$/u);
  requireIdentity({ ...expected, backendAttemptId: expected.backendAttemptId });
  assert.equal(command.captureRunId, expected.captureRunId);
  assert.equal(command.ownerRunId, expected.ownerRunId);
  assert.equal(command.serial, expected.serial);
  assert.equal(command.appId, expected.appId);
  assert.equal(command.attemptId, expected.backendAttemptId);
  const execution = command.execution;
  assert.equal(execution.phase, 'step');
  assert.equal(execution.execution, 'completed');
  assert.equal(execution.cleanup, 'cleaned');
  assert.equal(execution.childExitCode, 0);
  assert.equal(execution.childSignal, null);
  const pid = execution.pid;
  const pgid = execution.pgid;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('Android command PID is missing');
  if (typeof pgid !== 'number' || !Number.isSafeInteger(pgid) || pgid <= 0)
    throw new Error('Android command PGID is missing');
  assert.equal(execution.censusFailure ?? null, null);
  assert.equal(execution.outputFailure ?? null, null);
  assert(typeof execution.logPath === 'string' && typeof execution.ownershipPath === 'string');
  assert(Array.isArray(command.argv) && command.argv.length > 0);
}

function requireFrameReceipt(
  receipt: AndroidCapturedFrameReceipt,
  expectedKind: AndroidCapturedFrameReceipt['contentKind'],
): void {
  requireString(receipt.path, 'Android frame receipt path');
  assert(
    !path.isAbsolute(receipt.path) && !receipt.path.split(/[\\/]/u).includes('..'),
    'Android frame path must be relative and contained',
  );
  assert(
    Number.isSafeInteger(receipt.sizeBytes) &&
      receipt.sizeBytes > 0 &&
      receipt.sizeBytes <= MAX_FRAME_BYTES,
  );
  assert.match(receipt.sha256, HASH);
  assert(Number.isSafeInteger(receipt.ownerUid) && receipt.ownerUid === process.getuid?.());
  assert.equal(receipt.mode, 0o600);
  assert.equal(receipt.contentKind, expectedKind);
  assert.equal(receipt.verification, 'owned-stable-reader-v6');
}

function requireStdoutReceipt(receipt: AndroidStorageFileReceipt): void {
  requireString(receipt.path, 'Android command stdout receipt path');
  assert(
    !path.isAbsolute(receipt.path) && !receipt.path.split(/[\\/]/u).includes('..'),
    'Android command stdout path must be relative',
  );
  assert.equal(receipt.kind, 'sidecar');
  assert(
    Number.isSafeInteger(receipt.sizeBytes) &&
      receipt.sizeBytes > 0 &&
      receipt.sizeBytes <= MAX_COMMAND_STDOUT,
  );
  assert.match(receipt.sha256, HASH);
  assert(Number.isSafeInteger(receipt.ownerUid) && receipt.ownerUid === process.getuid?.());
  assert.equal(receipt.mode, 0o600);
  assert.equal(receipt.verification, 'owned-stable-reader-v6');
}
function requireBoundStdoutReceipt(input: {
  artifactRoot: string;
  receipt: AndroidStorageFileReceipt;
  execution: AndroidCameraCommandReceipt['execution'];
  label: string;
}): string {
  requireStdoutReceipt(input.receipt);
  const receiptPath = commandPath(input.artifactRoot, input.receipt.path);
  const executionPath = commandPath(input.artifactRoot, input.execution.stdoutPath);
  assert(
    receiptPath && executionPath && receiptPath === executionPath,
    `${input.label} stdout receipt is not bound to its command output`,
  );
  return executionPath;
}

function requireLoadedStdoutReceipt(
  receipt: AndroidStorageFileReceipt,
  loaded: {
    bytes: Buffer;
    path: string;
    identity: { uid: number; mode: number };
  },
  label: string,
): void {
  assert.equal(loaded.path, receipt.path, `${label} path changed`);
  assert.equal(loaded.bytes.byteLength, receipt.sizeBytes, `${label} size changed`);
  assert.equal(loaded.identity.uid, receipt.ownerUid, `${label} owner changed`);
  assert.equal(loaded.identity.mode & 0o777, receipt.mode, `${label} mode changed`);
}

function commandPath(root: string, value: string | null): string | null {
  if (value === null) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(resolvedRoot, value);
  return resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : null;
}

/** Read and re-hash the actual producer file through the existing stable reader. */
export async function readAndroidCameraFrameSource(input: {
  artifactRoot: string;
  source: AndroidCameraFrameSource;
  expected: AndroidCameraRuntimeIdentity;
  signal?: AbortSignal;
}): Promise<{
  bytes: Buffer;
  receipt: AndroidCapturedFrameReceipt;
  tree?: unknown;
}> {
  const source = input.source;
  requireIdentity({
    ...input.expected,
    backendAttemptId: input.expected.backendAttemptId,
  });
  assert.equal(source.captureRunId, input.expected.captureRunId);
  assert.equal(source.ownerRunId, input.expected.ownerRunId);
  assert.equal(source.serial, input.expected.serial);
  assert.equal(source.appId, input.expected.appId);
  assert.equal(source.attemptId, input.expected.backendAttemptId);
  requireCommandTerminal(source.command, input.expected);
  assert.equal(source.action.label, source.label);
  assert.equal(source.action.commandLabel, source.command.label);
  assert.equal(
    source.action.invocationId,
    `${source.captureRunId}:camera:${source.action.ordinal}`,
  );
  assert(Number.isSafeInteger(source.action.ordinal) && source.action.ordinal > 0);
  assert(Number.isSafeInteger(source.action.commandOrdinal) && source.action.commandOrdinal >= 0);
  assert.match(source.action.actionsSha256, HASH);
  assert(typeof source.action.viewId === 'string' && source.action.viewId.length > 0);
  assert(source.action.selectors.length > 0);
  assert(source.action.selectors.every((value) => typeof value === 'string' && value.length > 0));
  requireFrameReceipt(source.receipt, source.receipt.contentKind);
  const absolute = commandPath(input.artifactRoot, source.receipt.path);
  assert(absolute, 'Android frame receipt escaped its artifact root');
  const commandOutput = commandPath(input.artifactRoot, source.command.execution.stdoutPath);
  assert(
    commandOutput === absolute,
    'Android frame receipt is not bound to its producer stdout path',
  );
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: input.artifactRoot,
    filePath: absolute,
    label: `Android camera ${source.label} ${source.receipt.contentKind}`,
    maxBytes: MAX_FRAME_BYTES,
    signal: input.signal,
  });
  assert.equal(loaded.path, source.receipt.path);
  assert.equal(
    loaded.bytes.byteLength,
    source.receipt.sizeBytes,
    'Android camera frame size does not match the owned receipt',
  );
  assert.equal(
    sha256(loaded.bytes),
    source.receipt.sha256,
    'Android camera frame hash does not match the owned receipt',
  );
  assert.equal(loaded.identity.uid, source.receipt.ownerUid);
  assert.equal(loaded.identity.mode & 0o777, source.receipt.mode);
  if (source.receipt.contentKind === 'png') {
    assert(
      loaded.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      'Android camera screenshot is not PNG',
    );
  }
  let tree: unknown;
  if (source.receipt.contentKind !== 'png') {
    try {
      tree =
        source.receipt.contentKind === 'hierarchy-source'
          ? JSON.parse(
              loaded.bytes.toString('utf8').slice(loaded.bytes.toString('utf8').search(/\{/u)),
            )
          : JSON.parse(loaded.bytes.toString('utf8'));
    } catch (error) {
      throw new Error(`Android camera ${source.label} hierarchy is invalid`, {
        cause: error,
      });
    }
  }
  return {
    bytes: loaded.bytes,
    receipt: structuredClone(source.receipt),
    tree,
  };
}

/** Bind the clear/revoke/check command records and all four real stdout files. */
export async function requireAndroidCameraPermissionEvidence(input: {
  artifactRoot: string;
  identity: AndroidCameraRuntimeIdentity;
  clearUserDecision: AndroidCameraCommandReceipt;
  revoke: AndroidCameraCommandReceipt;
  beforeCheck: AndroidCameraPermissionCheck;
  afterCheck: AndroidCameraPermissionCheck;
  signal?: AbortSignal;
}): Promise<{
  status: 'denied';
  before: AndroidCameraPermissionState;
  after: AndroidCameraPermissionState;
}> {
  const commands = buildAndroidCameraPermissionCommands(input.identity.appId);
  requireCommandTerminal(input.clearUserDecision, input.identity);
  requireCommandTerminal(input.revoke, input.identity);
  requireCommandTerminal(input.beforeCheck, input.identity);
  requireCommandTerminal(input.afterCheck, input.identity);
  assert.deepEqual(input.clearUserDecision.argv, commands.clearUserDecision);
  assert.deepEqual(input.revoke.argv, commands.revoke);
  assert.deepEqual(input.beforeCheck.argv, commands.check);
  assert.deepEqual(input.afterCheck.argv, commands.check);
  requireCommandTerminal(input.beforeCheck.flagsCommand, input.identity);
  requireCommandTerminal(input.afterCheck.flagsCommand, input.identity);
  assert.deepEqual(input.beforeCheck.flagsCommand.argv, commands.checkFlags);
  assert.deepEqual(input.afterCheck.flagsCommand.argv, commands.checkFlags);
  assert.notEqual(
    input.beforeCheck.execution.pid,
    input.afterCheck.execution.pid,
    'permission reads must be separate command executions',
  );
  const beforeStdout = input.beforeCheck.stdout;
  const afterStdout = input.afterCheck.stdout;
  assert(beforeStdout && afterStdout, 'permission check stdout receipts are required');
  const beforeFlagsStdout = input.beforeCheck.flagsCommand.stdout;
  const afterFlagsStdout = input.afterCheck.flagsCommand.stdout;
  assert(beforeFlagsStdout && afterFlagsStdout, 'permission flag stdout receipts are required');
  const beforeAbsolute = requireBoundStdoutReceipt({
    artifactRoot: input.artifactRoot,
    receipt: beforeStdout,
    execution: input.beforeCheck.execution,
    label: 'Android camera pre-reset permission',
  });
  const afterAbsolute = requireBoundStdoutReceipt({
    artifactRoot: input.artifactRoot,
    receipt: afterStdout,
    execution: input.afterCheck.execution,
    label: 'Android camera post-denial permission',
  });
  const beforeFlagsAbsolute = requireBoundStdoutReceipt({
    artifactRoot: input.artifactRoot,
    receipt: beforeFlagsStdout,
    execution: input.beforeCheck.flagsCommand.execution,
    label: 'Android camera pre-reset permission flags',
  });
  const afterFlagsAbsolute = requireBoundStdoutReceipt({
    artifactRoot: input.artifactRoot,
    receipt: afterFlagsStdout,
    execution: input.afterCheck.flagsCommand.execution,
    label: 'Android camera post-denial permission flags',
  });
  assert(
    beforeAbsolute && afterAbsolute && beforeAbsolute !== afterAbsolute,
    'permission stdout paths are not distinct',
  );
  assert(
    beforeFlagsAbsolute && afterFlagsAbsolute && beforeFlagsAbsolute !== afterFlagsAbsolute,
    'permission flag stdout paths are not distinct',
  );
  assert.equal(
    new Set([beforeAbsolute, afterAbsolute, beforeFlagsAbsolute, afterFlagsAbsolute]).size,
    4,
    'permission status and flag stdout paths are not distinct',
  );
  const [beforeBytes, afterBytes, beforeFlagsBytes, afterFlagsBytes] = await Promise.all([
    readOwnedAndroidBoundedFile({
      artifactRoot: input.artifactRoot,
      filePath: beforeAbsolute,
      label: 'Android camera pre-reset permission stdout',
      maxBytes: MAX_COMMAND_STDOUT,
      signal: input.signal,
    }),
    readOwnedAndroidBoundedFile({
      artifactRoot: input.artifactRoot,
      filePath: afterAbsolute,
      label: 'Android camera post-denial permission stdout',
      maxBytes: MAX_COMMAND_STDOUT,
      signal: input.signal,
    }),
    readOwnedAndroidBoundedFile({
      artifactRoot: input.artifactRoot,
      filePath: beforeFlagsAbsolute,
      label: 'Android camera pre-reset permission flags stdout',
      maxBytes: MAX_COMMAND_STDOUT,
      signal: input.signal,
    }),
    readOwnedAndroidBoundedFile({
      artifactRoot: input.artifactRoot,
      filePath: afterFlagsAbsolute,
      label: 'Android camera post-denial permission flags stdout',
      maxBytes: MAX_COMMAND_STDOUT,
      signal: input.signal,
    }),
  ]);
  requireLoadedStdoutReceipt(beforeStdout, beforeBytes, 'Android camera pre-reset permission');
  requireLoadedStdoutReceipt(afterStdout, afterBytes, 'Android camera post-denial permission');
  requireLoadedStdoutReceipt(
    beforeFlagsStdout,
    beforeFlagsBytes,
    'Android camera pre-reset permission flags',
  );
  requireLoadedStdoutReceipt(
    afterFlagsStdout,
    afterFlagsBytes,
    'Android camera post-denial permission flags',
  );
  assert.equal(sha256(beforeBytes.bytes), beforeStdout.sha256);
  assert.equal(sha256(afterBytes.bytes), afterStdout.sha256);
  assert.equal(sha256(beforeFlagsBytes.bytes), beforeFlagsStdout.sha256);
  assert.equal(sha256(afterFlagsBytes.bytes), afterFlagsStdout.sha256);
  assert.equal(
    parseAndroidCameraPermissionStatus(beforeBytes.bytes.toString('utf8'), input.identity.appId),
    input.beforeCheck.state.status,
  );
  assert.equal(
    parseAndroidCameraPermissionStatus(afterBytes.bytes.toString('utf8'), input.identity.appId),
    input.afterCheck.state.status,
  );
  assert.equal(input.afterCheck.state.status, 'denied');
  const beforeFlags = parseAndroidCameraPermissionFlags(
    beforeFlagsBytes.bytes.toString('utf8'),
    input.identity.appId,
  );
  const afterFlags = parseAndroidCameraPermissionFlags(
    afterFlagsBytes.bytes.toString('utf8'),
    input.identity.appId,
  );
  assert.deepEqual(beforeFlags, input.beforeCheck.state.decisionFlags);
  assert.deepEqual(afterFlags, input.afterCheck.state.decisionFlags);
  assert(
    !beforeFlags.includes('USER_SET') && !beforeFlags.includes('USER_FIXED'),
    'pre-reset permission retained a user decision',
  );
  assert(
    afterFlags.includes('USER_SET') && !afterFlags.includes('USER_FIXED'),
    'post-denial permission flags do not prove one-time denial',
  );
  return {
    status: 'denied',
    before: structuredClone(input.beforeCheck.state),
    after: structuredClone(input.afterCheck.state),
  };
}

export type AndroidCameraBlockedGate = {
  gate: string;
  status: 'blocked';
  reason: string;
};

export function blockedCameraGate(gate: string, reason: string): AndroidCameraBlockedGate {
  return { gate, status: 'blocked', reason };
}

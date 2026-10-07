import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const ANDROID_DETOX_CAMERA_APP_ID = 'com.edufelip.mychampions.dev' as const;
export const ANDROID_DETOX_CAMERA_PERMISSION = 'android.permission.CAMERA' as const;
export const ANDROID_DETOX_CAMERA_BRIDGE_APP_ID = 'com.edufelip.mychampions.dev.test' as const;
export const ANDROID_DETOX_CAMERA_SYSTEM_PACKAGES = Object.freeze([
  'com.android.permissioncontroller',
  'com.google.android.permissioncontroller',
] as const);
export type AndroidDetoxCameraSystemPackage = (typeof ANDROID_DETOX_CAMERA_SYSTEM_PACKAGES)[number];
export const ANDROID_DETOX_CAMERA_RECEIPT_KIND =
  'private-detox-android-camera-prompt-receipt' as const;
export const ANDROID_DETOX_CAMERA_ASSERTION_IDS = Object.freeze([
  'NAT-camera-normal-entry',
  'NAT-camera-denial-guidance',
  'NAT-camera-manual-submit',
  'NAT-camera-unrelated-state',
] as const);

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SERIAL = /^(?:emulator-[0-9]+|[A-Za-z0-9._:-]{1,127})$/u;
const LOCALES = ['en-US', 'pt-BR', 'es-ES'] as const;
const MAX_RECEIPT_BYTES = 256 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export type AndroidDetoxCameraLocale = (typeof LOCALES)[number];
export type AndroidDetoxCameraBridgeStatus = 'observed' | 'blocked' | 'cancelled' | 'deadline';
export type AndroidDetoxCameraFrameKind = 'hierarchy' | 'screenshot';

export type AndroidDetoxCameraDeviceFileReceipt = Readonly<{
  path: string;
  kind: AndroidDetoxCameraFrameKind;
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
  dev: number;
  ino: number;
  nlink: number;
  mtime: number;
  ctime: number;
  verification: 'android-detox-uiautomator-owned-stable-reader-v1';
}>;

export type AndroidDetoxCameraHostFileReceipt = Readonly<{
  path: string;
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
  verification: 'owned-stable-reader-v6';
}>;

export type AndroidDetoxCameraFramePair = Readonly<{
  hierarchy: AndroidDetoxCameraDeviceFileReceipt;
  screenshot: AndroidDetoxCameraDeviceFileReceipt;
}>;

export type AndroidDetoxCameraFrameEvidence = Readonly<{
  entry: AndroidDetoxCameraFramePair | null;
  prompt: AndroidDetoxCameraFramePair | null;
  denied: AndroidDetoxCameraFramePair | null;
  manual: AndroidDetoxCameraFramePair | null;
}>;

export type AndroidDetoxCameraPromptEvidence = Readonly<{
  titleSelectorKind: 'text-pattern';
  titlePatternId: 'camera-permission-title-v1';
  titleTextSha256: string;
  denySelectorKind: 'text';
  denySelectorValue: string;
  denyResourceName: string;
  denyTextSha256: string;
  appLabelSha256: string;
}>;

export type AndroidDetoxCameraPromptReceipt = Readonly<{
  kind: typeof ANDROID_DETOX_CAMERA_RECEIPT_KIND;
  schemaVersion: 1;
  status: AndroidDetoxCameraBridgeStatus;
  captureRunId: string;
  ownerRunId: string;
  attemptId: string;
  serial: string;
  appId: typeof ANDROID_DETOX_CAMERA_APP_ID;
  permission: typeof ANDROID_DETOX_CAMERA_PERMISSION;
  locale: AndroidDetoxCameraLocale;
  systemPackage: AndroidDetoxCameraSystemPackage;
  permissionBefore: 'denied' | 'granted' | 'unknown';
  permissionAfter: 'denied' | 'granted' | 'unknown';
  failureCode:
    | 'none'
    | 'child-failed'
    | 'permission-precondition'
    | 'permission-outcome'
    | 'prompt-not-dismissed'
    | 'bridge-error'
    | 'receipt-write-failure'
    | 'cancelled'
    | 'deadline';
  prompt: AndroidDetoxCameraPromptEvidence | null;
  frames: AndroidDetoxCameraFrameEvidence;
  targetApiLevel: number;
  deviceSerial: string;
  childResult: 'completed' | 'failed';
  childFailureClass: string;
  startedAtEpochMs: number;
  observedAtEpochMs: number;
  completedAtEpochMs: number;
}>;

export type AndroidDetoxCameraInstrumentationBinding = Readonly<{
  captureRunId: string;
  ownerRunId: string;
  serial: string;
  locale: AndroidDetoxCameraLocale;
  deadlineAtEpochMs: number;
  appId?: string;
  cancelRelativePath?: string;
}>;

export type AndroidDetoxCameraCommandExecution = Readonly<{
  execution: Readonly<{
    phase: 'step';
    execution: 'completed';
    cleanup: 'cleaned';
    childExitCode: 0;
    childSignal: null;
    pid: number;
    pgid: number;
  }>;
  stdoutPath: string | null;
  command: string;
  argv: readonly string[];
}>;

export type AndroidDetoxCameraAdbTarget = Readonly<{
  appId: typeof ANDROID_DETOX_CAMERA_APP_ID;
  serial: string;
  adbServerPort: number;
  verify: () => Promise<void>;
  runAdb: (input: {
    label: string;
    argv: readonly string[];
    artifactRoot: string;
    stdoutPath: string;
    deadlineMs: number;
    signal: AbortSignal;
  }) => Promise<AndroidDetoxCameraCommandExecution>;
}>;

export type AndroidDetoxCameraBridgeRead = Readonly<{
  receipt: AndroidDetoxCameraPromptReceipt;
  receiptHost: AndroidDetoxCameraHostFileReceipt;
  executions: readonly AndroidDetoxCameraCommandExecution[];
  frames: Readonly<{
    entry: AndroidDetoxCameraFrameHostPair | null;
    prompt: AndroidDetoxCameraFrameHostPair | null;
    denied: AndroidDetoxCameraFrameHostPair | null;
    manual: AndroidDetoxCameraFrameHostPair | null;
  }>;
}>;

export type AndroidDetoxCameraFrameHostPair = Readonly<{
  hierarchy: AndroidDetoxCameraHostFileReceipt;
  screenshot: AndroidDetoxCameraHostFileReceipt;
}>;

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
}

function requireNonEmpty(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    `${label} is invalid`,
  );
}

function requireFiniteEpoch(value: unknown, label: string): asserts value is number {
  assert(Number.isSafeInteger(value) && Number(value) > 0, `${label} is invalid`);
}

function requireDeviceReceipt(value: unknown, label: string): AndroidDetoxCameraDeviceFileReceipt {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  const row = value as Record<string, unknown>;
  requireNonEmpty(row.path, `${label}.path`);
  assert(
    !row.path.startsWith('/') && !row.path.split(/[\\/]/u).includes('..'),
    `${label}.path escaped`,
  );
  assert(row.kind === 'hierarchy' || row.kind === 'screenshot', `${label}.kind is invalid`);
  assert(
    Number.isSafeInteger(row.sizeBytes) &&
      Number(row.sizeBytes) > 0 &&
      Number(row.sizeBytes) <= MAX_FRAME_BYTES,
    `${label}.sizeBytes is invalid`,
  );
  requireHash(row.sha256, `${label}.sha256`);
  assert(
    Number.isSafeInteger(row.ownerUid) && Number(row.ownerUid) >= 0,
    `${label}.ownerUid is invalid`,
  );
  assert(Number(row.mode) === 0o600, `${label}.mode is not private`);
  for (const key of ['dev', 'ino', 'nlink', 'mtime', 'ctime'])
    assert(Number.isSafeInteger(row[key]) && Number(row[key]) >= 0, `${label}.${key} is invalid`);
  assert(row.nlink === 1, `${label}.nlink is not one`);
  assert(
    row.verification === 'android-detox-uiautomator-owned-stable-reader-v1',
    `${label}.verification is invalid`,
  );
  return row as unknown as AndroidDetoxCameraDeviceFileReceipt;
}

function requireFrame(value: unknown, label: string): AndroidDetoxCameraFramePair {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  const frame = value as Record<string, unknown>;
  const hierarchy = requireDeviceReceipt(frame.hierarchy, `${label}.hierarchy`);
  const screenshot = requireDeviceReceipt(frame.screenshot, `${label}.screenshot`);
  assert(hierarchy.kind === 'hierarchy', `${label}.hierarchy kind is invalid`);
  assert(screenshot.kind === 'screenshot', `${label}.screenshot kind is invalid`);
  return { hierarchy, screenshot };
}

function requireOptionalFrame(value: unknown, label: string): AndroidDetoxCameraFramePair | null {
  if (value === null || value === undefined) return null;
  return requireFrame(value, label);
}

export function requireAndroidDetoxCameraPromptReceipt(
  value: unknown,
): AndroidDetoxCameraPromptReceipt {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Android Detox camera receipt is missing',
  );
  const row = value as Record<string, unknown>;
  assert(
    row.kind === ANDROID_DETOX_CAMERA_RECEIPT_KIND,
    'Android Detox camera receipt kind is invalid',
  );
  assert(row.schemaVersion === 1, 'Android Detox camera receipt schema version is invalid');
  assert(
    ['observed', 'blocked', 'cancelled', 'deadline'].includes(String(row.status)),
    'Android Detox camera receipt status is invalid',
  );
  requireRunId(row.captureRunId, 'captureRunId');
  requireRunId(row.ownerRunId, 'ownerRunId');
  assert(
    row.attemptId === `${row.ownerRunId}:first`,
    'Android Detox camera attempt is not the first owned attempt',
  );
  assert(
    typeof row.serial === 'string' && SERIAL.test(row.serial),
    'Android Detox camera serial is invalid',
  );
  assert(row.appId === ANDROID_DETOX_CAMERA_APP_ID, 'Android Detox camera app ID is invalid');
  assert(
    row.permission === ANDROID_DETOX_CAMERA_PERMISSION,
    'Android Detox camera permission is invalid',
  );
  assert(
    (LOCALES as readonly string[]).includes(String(row.locale)),
    'Android Detox camera locale is invalid',
  );
  assert(
    (ANDROID_DETOX_CAMERA_SYSTEM_PACKAGES as readonly string[]).includes(String(row.systemPackage)),
    'Android Detox camera system package is invalid',
  );
  assert(
    ['denied', 'granted', 'unknown'].includes(String(row.permissionBefore)),
    'Android camera before permission is invalid',
  );
  assert(
    ['denied', 'granted', 'unknown'].includes(String(row.permissionAfter)),
    'Android camera after permission is invalid',
  );
  assert(
    [
      'none',
      'child-failed',
      'permission-precondition',
      'permission-outcome',
      'prompt-not-dismissed',
      'bridge-error',
      'receipt-write-failure',
      'cancelled',
      'deadline',
    ].includes(String(row.failureCode)),
    'Android camera failure code is invalid',
  );
  const promptValue = row.prompt;
  let prompt: AndroidDetoxCameraPromptEvidence | null = null;
  if (promptValue && typeof promptValue === 'object' && !Array.isArray(promptValue)) {
    const promptRow = promptValue as Record<string, unknown>;
    if (Object.keys(promptRow).length > 0) {
      assert(
        promptRow.titleSelectorKind === 'text-pattern',
        'Android camera title selector is not semantic',
      );
      assert(
        promptRow.titlePatternId === 'camera-permission-title-v1',
        'Android camera title pattern is unknown',
      );
      requireHash(promptRow.titleTextSha256, 'Android camera title text hash');
      assert(
        promptRow.denySelectorKind === 'text',
        'Android camera deny selector is not text-bound',
      );
      requireNonEmpty(promptRow.denySelectorValue, 'Android camera deny selector value');
      requireHash(promptRow.denyTextSha256, 'Android camera deny text hash');
      requireHash(promptRow.appLabelSha256, 'Android camera app label hash');
      assert(
        typeof promptRow.denyResourceName === 'string',
        'Android camera deny resource name is invalid',
      );
      prompt = promptRow as unknown as AndroidDetoxCameraPromptEvidence;
    }
  }
  if (row.status === 'observed')
    assert(prompt, 'Observed Android camera proof lacks prompt evidence');
  const frameRows = row.frames;
  assert(
    frameRows && typeof frameRows === 'object' && !Array.isArray(frameRows),
    'Android camera frame evidence is missing',
  );
  const frames = frameRows as Record<string, unknown>;
  const entry = requireOptionalFrame(frames.entry, 'Android camera entry frame');
  const promptFrame = requireOptionalFrame(frames.prompt, 'Android camera prompt frame');
  const denied = requireOptionalFrame(frames.denied, 'Android camera denied frame');
  const manual = requireOptionalFrame(frames.manual, 'Android camera manual frame');
  assert(
    Number.isSafeInteger(row.targetApiLevel) && Number(row.targetApiLevel) >= 23,
    'Android target API level is invalid',
  );
  assert(
    typeof row.deviceSerial === 'string' && row.deviceSerial.length > 0,
    'Android device serial observation is missing',
  );
  assert(
    row.childResult === 'completed' || row.childResult === 'failed',
    'Android child result is invalid',
  );
  assert(
    typeof row.childFailureClass === 'string' &&
      /^[A-Za-z0-9_$]{1,128}$/u.test(row.childFailureClass),
    'Android child failure class is invalid',
  );
  assert(
    (row.childResult === 'completed' && row.childFailureClass === 'none') ||
      (row.childResult === 'failed' && row.childFailureClass !== 'none'),
    'Android child result and failure class disagree',
  );
  requireFiniteEpoch(row.startedAtEpochMs, 'Android camera start time');
  assert(
    Number.isSafeInteger(row.observedAtEpochMs) && Number(row.observedAtEpochMs) >= 0,
    'Android camera observed time is invalid',
  );
  requireFiniteEpoch(row.completedAtEpochMs, 'Android camera completion time');
  assert(
    row.completedAtEpochMs >= row.startedAtEpochMs,
    'Android camera completion precedes start',
  );
  if (row.status === 'observed') {
    assert(
      Number(row.observedAtEpochMs) >= Number(row.startedAtEpochMs) &&
        Number(row.completedAtEpochMs) >= Number(row.observedAtEpochMs),
      'Android camera observation timestamps are invalid',
    );
    assert(
      row.permissionBefore === 'denied',
      'Observed Android camera proof lacks denied precondition',
    );
    assert(row.permissionAfter === 'denied', 'Observed Android camera proof lacks denied outcome');
    assert(row.failureCode === 'none', 'Observed Android camera proof retains a failure');
    assert(
      entry && promptFrame && denied && manual,
      'Observed Android camera proof lacks complete frames',
    );
  } else {
    assert(row.status !== 'observed', 'Android camera blocked result was relabeled observed');
  }
  return {
    ...row,
    prompt,
    frames: { entry, prompt: promptFrame, denied, manual },
  } as AndroidDetoxCameraPromptReceipt;
}

export function requireAndroidDetoxCameraQualification(
  value: unknown,
): AndroidDetoxCameraPromptReceipt {
  const receipt = requireAndroidDetoxCameraPromptReceipt(value);
  assert(receipt.status === 'observed', 'Android Detox camera prompt proof is not observed');
  assert(receipt.childResult === 'completed', 'Android Detox camera proof has a failed child');
  const { entry, prompt, denied, manual } = receipt.frames;
  assert(entry && prompt && denied && manual, 'Android camera proof is missing a required frame');
  assert(entry.hierarchy.sizeBytes > 0, 'Android camera entry hierarchy is empty');
  assert(prompt.hierarchy.sizeBytes > 0, 'Android camera prompt hierarchy is empty');
  assert(denied.hierarchy.sizeBytes > 0, 'Android camera denied hierarchy is empty');
  assert(manual.hierarchy.sizeBytes > 0, 'Android camera manual hierarchy is empty');
  assert(receipt.prompt, 'Android camera proof is missing prompt evidence');
  return receipt;
}

export function buildAndroidDetoxCameraInstrumentationArguments(
  input: AndroidDetoxCameraInstrumentationBinding,
): Readonly<Record<string, string>> {
  requireRunId(input.captureRunId, 'captureRunId');
  requireRunId(input.ownerRunId, 'ownerRunId');
  assert(
    typeof input.serial === 'string' && SERIAL.test(input.serial),
    'Android camera serial is invalid',
  );
  assert((LOCALES as readonly string[]).includes(input.locale), 'Android camera locale is invalid');
  requireFiniteEpoch(input.deadlineAtEpochMs, 'Android camera deadline');
  assert(input.deadlineAtEpochMs > Date.now(), 'Android camera deadline has elapsed');
  assert(
    input.deadlineAtEpochMs - Date.now() <= 600_000,
    'Android camera deadline exceeds owner budget',
  );
  const cancelRelativePath = input.cancelRelativePath ?? 'cancel.signal';
  assert(
    cancelRelativePath.length > 0 &&
      !cancelRelativePath.startsWith('/') &&
      !cancelRelativePath.includes('..') &&
      !cancelRelativePath.includes('\\'),
    'Android camera cancellation path is unsafe',
  );
  const appId = input.appId ?? ANDROID_DETOX_CAMERA_APP_ID;
  assert(
    appId === ANDROID_DETOX_CAMERA_APP_ID,
    'Android camera instrumentation app ID is not the owned dev app',
  );
  return Object.freeze({
    detoxCameraBridge: 'enabled',
    detoxCameraCaptureRunId: input.captureRunId,
    detoxCameraOwnerRunId: input.ownerRunId,
    detoxCameraAttemptId: `${input.ownerRunId}:first`,
    detoxCameraSerial: input.serial,
    detoxCameraAppId: appId,
    detoxCameraLocale: input.locale,
    detoxCameraDeadlineAtEpochMs: String(input.deadlineAtEpochMs),
    detoxCameraCancelRelativePath: cancelRelativePath,
  });
}

export function requireAndroidDetoxCameraInstrumentationArguments(
  value: unknown,
  now = Date.now(),
): AndroidDetoxCameraInstrumentationBinding {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Android camera instrumentation arguments are missing',
  );
  const args = value as Record<string, unknown>;
  assert(args.detoxCameraBridge === 'enabled', 'Android camera bridge is not explicitly enabled');
  requireRunId(args.detoxCameraCaptureRunId, 'detoxCameraCaptureRunId');
  requireRunId(args.detoxCameraOwnerRunId, 'detoxCameraOwnerRunId');
  assert(
    args.detoxCameraAttemptId === `${args.detoxCameraOwnerRunId}:first`,
    'Android camera attempt argument is not first',
  );
  assert(
    typeof args.detoxCameraSerial === 'string' && SERIAL.test(args.detoxCameraSerial),
    'Android camera serial argument is invalid',
  );
  assert(
    (LOCALES as readonly string[]).includes(String(args.detoxCameraLocale)),
    'Android camera locale argument is invalid',
  );
  const deadlineAtEpochMs = Number(args.detoxCameraDeadlineAtEpochMs);
  assert(
    Number.isSafeInteger(deadlineAtEpochMs) &&
      deadlineAtEpochMs > now &&
      deadlineAtEpochMs - now <= 600_000,
    'Android camera deadline argument is invalid',
  );
  assert(
    args.detoxCameraAppId === ANDROID_DETOX_CAMERA_APP_ID,
    'Android camera app ID argument is invalid',
  );
  assert(
    args.detoxCameraCancelRelativePath === undefined ||
      typeof args.detoxCameraCancelRelativePath === 'string',
    'Android camera cancel argument must be a string',
  );
  const cancelRelativePath = args.detoxCameraCancelRelativePath ?? 'cancel.signal';
  assert(
    cancelRelativePath.length > 0 &&
      !cancelRelativePath.startsWith('/') &&
      !cancelRelativePath.includes('..') &&
      !cancelRelativePath.includes('\\'),
    'Android camera cancel argument is unsafe',
  );
  return {
    captureRunId: args.detoxCameraCaptureRunId,
    ownerRunId: args.detoxCameraOwnerRunId,
    serial: args.detoxCameraSerial,
    locale: args.detoxCameraLocale as AndroidDetoxCameraLocale,
    deadlineAtEpochMs,
    appId: ANDROID_DETOX_CAMERA_APP_ID,
    cancelRelativePath,
  };
}

export function requireAndroidDetoxCameraReceiptIdentity(
  receipt: AndroidDetoxCameraPromptReceipt,
  binding: Pick<
    AndroidDetoxCameraInstrumentationBinding,
    'captureRunId' | 'ownerRunId' | 'serial' | 'locale'
  >,
): void {
  assert.equal(receipt.captureRunId, binding.captureRunId);
  assert.equal(receipt.ownerRunId, binding.ownerRunId);
  assert.equal(receipt.attemptId, `${binding.ownerRunId}:first`);
  assert.equal(receipt.serial, binding.serial);
  assert.equal(receipt.deviceSerial, binding.serial);
  assert.equal(receipt.locale, binding.locale);
}

export const ANDROID_DETOX_CAMERA_MAX_RECEIPT_BYTES = MAX_RECEIPT_BYTES;
export const ANDROID_DETOX_CAMERA_MAX_FRAME_BYTES = MAX_FRAME_BYTES;

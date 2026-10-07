import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  readOwnedAndroidStableFile,
  type AndroidCapturedFrameReceipt,
  type AndroidStorageFileReceipt,
} from './native-android-session-adapter';
import {
  ANDROID_CAMERA_APP_ID,
  ANDROID_CAMERA_ASSERTION_IDS,
  ANDROID_CAMERA_SCENARIO,
  ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS,
  buildAndroidCameraPermissionCommands,
  readAndroidCameraFrameSource,
  requireAndroidCameraPermissionEvidence,
  type AndroidCameraCommandReceipt,
  type AndroidCameraFrameSource,
  type AndroidCameraPermissionCheck,
  type AndroidCameraRuntimeIdentity,
} from './native-camera-android-contract';
import {
  qualifyAndroidCameraPrompt,
  requireAndroidCameraLocale,
  requireAndroidCameraManualEntry,
  requireAndroidCameraPendingGuidance,
  requireAndroidCameraPromptDismissed,
  requireAndroidCameraSqlEvidence,
  requireAndroidCameraTransport,
  type AndroidCameraApiIdentity,
  type AndroidCameraSqlSourceReceipt,
  type AndroidCameraManualRequestBinding,
  type AndroidCameraPromptQualification,
  type AndroidCameraPromptSelector,
} from './native-camera-android-observation';
import { writeAndroidCameraSqlSourceReceipts } from './native-camera-android-sql-source';
import {
  readAndroidNativeLocaleProperties,
  type AndroidLocalePropertyRead,
} from './native-locale-capture-seam';
import { assertTestingDocument } from './schema-validation';
import type { NativeLocaleBinding } from './locale-native-observation';
import type { AndroidCameraSavedFlow } from './native-camera-android-capture-adapter';
import type {
  OwnedConnectionSnapshot,
  ConnectionSnapshotExpectedIdentity,
} from './native-connection-snapshot';
import type { NativePilotSelection, NativePilotTarget } from './native-pilot-contract';
import type { NativeTrainingObserve } from './native-training-maestro-driver';
import type { NativeRequestBodyCaptureReceipt, ProxyObservation } from './owned-api-proxy';
import type {
  OwnedApiLifetimeProbe,
  OwnedDomainSnapshot,
  OwnedFixtures,
  OwnedSnapshotEvidence,
} from './owned-session';

export const ANDROID_CAMERA_UI = Object.freeze({
  accountButton: 'student.home.accountButton',
  professionalsScreen: 'student.professionals.screen',
  scanQrButton: 'student.professionals.scanQrButton',
  qrModal: 'student.professionals.qrModal',
  denialGuidance: 'student.professionals.submitError',
  codeInput: 'student.professionals.codeInput',
  connectButton: 'student.professionals.connectButton',
  pendingCardPrefix: 'student.professionals.connectionPending.',
} as const);

/** Readiness is bound to the two exact Android PermissionController resources. */
export const ANDROID_CAMERA_PROMPT_READINESS_SELECTORS =
  ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS;

const HASH = /^[a-f0-9]{64}$/u;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_CONNECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export type AndroidCameraPromptSpec = {
  appPackageName: string;
  appLabel: string;
  systemPackage: 'com.android.permissioncontroller' | 'com.google.android.permissioncontroller';
  serial: string;
  apiLevel: number;
  locale: string;
  promptRootPath: string;
  title: AndroidCameraPromptSelector;
  deny: AndroidCameraPromptSelector;
};

/**
 * The only command boundary accepted by the producer. The implementation is
 * supplied by the existing Android `run`/`adb` closure so every command keeps
 * its owned PID/PGID, stdout receipt, cancellation and census record.
 */
export type AndroidCameraCommandRunner = {
  run: (label: string, argv: readonly string[]) => Promise<AndroidCameraCommandReceipt>;
  check: (label: string, argv: readonly string[]) => Promise<AndroidCameraPermissionCheck>;
  readLocaleProperty: (property: string) => Promise<AndroidLocalePropertyRead>;
};

export type AndroidCameraFrameCapture = {
  /** Existing Maestro observation callback; it writes the real flow/tree/PNG. */
  observe: NativeTrainingObserve;
  /** Existing owned Maestro action callback; it executes actions and readiness without fabricating a frame. */
  execute: NativeTrainingObserve;
  /** Checked-in route source; each stage is rendered through the owned callback. */
  savedFlow: AndroidCameraSavedFlow;
  /** Injects the live invite only into the owned child environment. */
  setInviteCode: (value: string) => void;
  /** Returns the descriptor-backed frame produced by the just-finished observe. */
  frameSource: (label: AndroidCameraFrameSource['label']) => Promise<AndroidCameraFrameSource>;
  /** Returns selector paths discovered from the actual permission-controller tree. */
  promptSpec: (input: {
    source: AndroidCameraFrameSource;
    tree: unknown;
  }) => Promise<AndroidCameraPromptSpec>;
};

export type AndroidCameraLocaleObserver = {
  expectedLocale: 'en-US' | 'pt-BR' | 'es-ES';
  expectedBinding: NativeLocaleBinding;
  /** Must read the app file adapter result from the same capture artifact root. */
  readEvidence: (input: {
    properties: Awaited<ReturnType<typeof readAndroidNativeLocaleProperties>>;
    signal: AbortSignal;
  }) => Promise<unknown>;
};

export type AndroidCameraProxy = {
  observations: readonly ProxyObservation[];
  requestIdFence: number;
  targetOrigin: string;
  waitForQuiescence: () => Promise<void>;
  enableNativeRequestBodyCapture: (input: {
    artifactRoot: string;
    captureRunId: string;
    sessionRunId: string;
    backendAttemptId: string;
    actorAuthUidSha256: string;
    targetOrigin: string;
    apiPid: number;
    manualCodeSha256: string;
    actionSha256: string;
  }) => void;
  nativeRequestBodyCapture: NativeRequestBodyCaptureReceipt | null;
};

export type AndroidCameraSnapshotSource = {
  before: OwnedConnectionSnapshot;
  beforeEvidence: OwnedSnapshotEvidence<OwnedConnectionSnapshot>;
  read: () => Promise<OwnedConnectionSnapshot>;
  readEvidence: () => Promise<OwnedSnapshotEvidence<OwnedConnectionSnapshot>>;
  expected: ConnectionSnapshotExpectedIdentity;
  /** Independent fixture and target identity for the unrelated connection scope. */
  isolationExpected: ConnectionSnapshotExpectedIdentity;
  /** Protected fixture bytes/receipt used to seed and validate that scope. */
  isolationFixture: AndroidCameraIsolationFixtureBinding;
  isolationBefore: unknown;
  isolationBeforeEvidence:
    OwnedSnapshotEvidence<OwnedDomainSnapshot> | OwnedSnapshotEvidence<OwnedConnectionSnapshot>;
  readIsolationAfter: () => Promise<unknown>;
  readIsolationAfterEvidence: () => Promise<
    OwnedSnapshotEvidence<OwnedDomainSnapshot> | OwnedSnapshotEvidence<OwnedConnectionSnapshot>
  >;
  trainingBefore: unknown;
  trainingBeforeEvidence:
    OwnedSnapshotEvidence<OwnedDomainSnapshot> | OwnedSnapshotEvidence<OwnedConnectionSnapshot>;
  readTrainingAfter: () => Promise<unknown>;
  readTrainingAfterEvidence: () => Promise<
    OwnedSnapshotEvidence<OwnedDomainSnapshot> | OwnedSnapshotEvidence<OwnedConnectionSnapshot>
  >;
  isolationScope: string;
  trainingScope: string;
};

export type AndroidCameraIsolationFixtureBinding = AndroidStorageFileReceipt & {
  source: 'owned-session.fixtures';
  runId: string;
  scope: string;
  fixtureAuthUids: readonly string[];
  target: {
    professionalAuthUid: string;
    studentAuthUid: string;
    specialty: 'fitness_coach';
  };
};

export type AndroidCameraRuntimeIdentityInput = Omit<AndroidCameraRuntimeIdentity, 'locale'> & {
  target: NativePilotTarget;
};

export type AndroidCameraProducerContext = {
  output: string;
  fixtures: OwnedFixtures;
  identity: AndroidCameraRuntimeIdentityInput;
  selectionHash: string;
  signal: AbortSignal;
  commands: AndroidCameraCommandRunner;
  capture: AndroidCameraFrameCapture;
  locale: AndroidCameraLocaleObserver;
  proxy: AndroidCameraProxy;
  snapshots: AndroidCameraSnapshotSource;
  /** Probes the same owned API process whose manifest backs every SQL parent. */
  probeApiLifetime: (signal?: AbortSignal) => Promise<OwnedApiLifetimeProbe>;
  /** Reads the owned coach hierarchy and returns only a redacted provenance receipt. */
  readManualCodeReceipt: () => Promise<AndroidCameraManualCodeInput>;
  /** Independent recorder binding for the exact forwarded submission. */
  readSubmissionBinding: () => Promise<AndroidCameraManualRequestBinding>;
};

export type AndroidCameraFrameSummary = {
  label: AndroidCameraFrameSource['label'];
  path: string;
  sizeBytes: number;
  sha256: string;
  contentKind: AndroidCapturedFrameReceipt['contentKind'];
  action: AndroidCameraFrameSource['action'];
};

export type AndroidCameraManualCodeReceipt = {
  source: 'owned-android-coach-hierarchy';
  frameLabel: 'coach-home';
  sourcePath: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  sourceOwnerUid: number;
  sourceMode: number;
  sourceVerification: 'owned-stable-reader-v6';
  commandLabel: 'coach-home-hierarchy';
  commandOrdinal: number;
  commandPid: number;
  commandPgid: number;
  commandExecution: 'completed';
  commandCleanup: 'cleaned';
  commandArgvSha256: string;
  captureRunId: string;
  ownerRunId: string;
  actor: 'coach';
  actorAuthUidSha256: string;
  codeSha256: string;
};

export type AndroidCameraManualCodeInput = {
  value: string;
  receipt: AndroidCameraManualCodeReceipt;
};

export type AndroidCameraProducerReceipts = {
  captureRunId: string;
  identity: AndroidCameraRuntimeIdentity;
  producerStatus: 'receipts-bound';
  sourceSelectionHash: string;
  localeStatus: 'qualified';
  permission: Awaited<ReturnType<typeof requireAndroidCameraPermissionEvidence>>;
  frames: readonly AndroidCameraFrameSummary[];
  pendingConnectionId: string;
  submissionRequestId: number;
  transportRequestWindow: {
    beforeRequestId: number;
    throughRequestId: number;
    requestId: number;
  };
  manualCodeSha256: string;
  manualCodeSource: AndroidCameraManualCodeReceipt;
  submission: AndroidCameraManualRequestBinding;
  /** Primary fixture identities are retained so outer consumers can reject crossed scopes. */
  primaryFixtureAuthUids: readonly string[];
  /** Full primary connection snapshot identity, including target and run binding. */
  primaryExpected: ConnectionSnapshotExpectedIdentity;
  isolationExpected: ConnectionSnapshotExpectedIdentity;
  isolationFixture: AndroidCameraIsolationFixtureBinding;
  sqlReceipts: readonly AndroidCameraSqlSourceReceipt[];
  permissionCommandLabels: readonly string[];
};

export class AndroidCameraProducerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AndroidCameraProducerUnavailable';
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is not a SHA-256`);
}

function requireManualCode(value: unknown): string {
  assert(typeof value === 'string' && SAFE_CODE.test(value), 'manual invite code is invalid');
  assert(!/[\r\n\0]/u.test(value), 'manual invite code contains unsafe control characters');
  return value;
}

export async function requireAndroidCameraIsolationFixtureBinding(
  value: AndroidCameraIsolationFixtureBinding,
  input: {
    artifactRoot: string;
    backendRunId: string;
    primaryFixtureAuthUids: readonly string[];
    isolationExpected: ConnectionSnapshotExpectedIdentity;
    signal?: AbortSignal;
  },
): Promise<AndroidCameraIsolationFixtureBinding> {
  assert(
    value.source === 'owned-session.fixtures',
    'Android camera isolation fixture source is not the owned session',
  );
  assert.equal(value.kind, 'sidecar');
  assert.equal(value.verification, 'owned-stable-reader-v6');
  assert.equal(value.runId, input.backendRunId);
  assert.equal(value.scope, input.isolationExpected.scope);
  assert(
    value.path === 'fixtures-native-connection-isolation-android.private.json',
    'Android camera isolation fixture path is not canonical',
  );
  assert(Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0);
  assert(Number.isSafeInteger(value.ownerUid) && value.ownerUid === process.getuid?.());
  assert.equal(value.mode, 0o600);
  assert(/^[a-f0-9]{64}$/u.test(value.sha256), 'Android camera isolation fixture hash is invalid');
  const fixtureAuthUids = [...value.fixtureAuthUids];
  assert(
    fixtureAuthUids.length > 0 &&
      fixtureAuthUids.every((uid) => typeof uid === 'string' && uid.length > 0) &&
      new Set(fixtureAuthUids).size === fixtureAuthUids.length,
    'Android camera isolation fixture identities are invalid',
  );
  assert.deepEqual(
    [...(input.isolationExpected.fixtureAuthUids ?? [])].sort(),
    [...fixtureAuthUids].sort(),
    'Android camera isolation expected fixture identities differ from the protected fixture',
  );
  assert.equal(
    input.isolationExpected.target?.professionalAuthUid,
    value.target.professionalAuthUid,
  );
  assert.equal(input.isolationExpected.target?.studentAuthUid, value.target.studentAuthUid);
  assert.equal(input.isolationExpected.runId, value.runId);
  assert.equal(input.isolationExpected.scope, value.scope);
  assert(
    !fixtureAuthUids.some((uid) => input.primaryFixtureAuthUids.includes(uid)),
    'Android camera isolation fixture overlaps the primary fixture identities',
  );
  assert(
    value.target.professionalAuthUid !== value.target.studentAuthUid &&
      fixtureAuthUids.includes(value.target.professionalAuthUid) &&
      fixtureAuthUids.includes(value.target.studentAuthUid),
    'Android camera isolation target is outside its protected fixture identities',
  );
  return readOwnedAndroidStableFile({
    artifactRoot: input.artifactRoot,
    filePath: path.join(input.artifactRoot, value.path),
    kind: 'sidecar',
    maxBytes: 1 * 1024 * 1024,
    signal: input.signal,
  }).then((loaded) => {
    assert.deepEqual(loaded.receipt, {
      path: value.path,
      kind: value.kind,
      sizeBytes: value.sizeBytes,
      sha256: value.sha256,
      ownerUid: value.ownerUid,
      mode: value.mode,
      verification: value.verification,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(loaded.bytes.toString('utf8')) as unknown;
    } catch (error) {
      throw new Error('Android camera isolation fixture bytes are not JSON', {
        cause: error,
      });
    }
    assertTestingDocument('application-fixtures-v1', parsed);
    const fixtures = parsed as OwnedFixtures;
    assert.equal(fixtures.runId, value.runId);
    assert.equal(fixtures.scope, value.scope);
    const actualFixtureAuthUids = Object.values(fixtures.accounts)
      .map((account) => account.authUid)
      .sort();
    assert.deepEqual(actualFixtureAuthUids, [...fixtureAuthUids].sort());
    assert.equal(fixtures.accounts.coach.authUid, value.target.professionalAuthUid);
    assert.equal(fixtures.accounts.student.authUid, value.target.studentAuthUid);
    assert.equal(fixtures.accounts.coach.role, 'professional');
    assert.equal(fixtures.accounts.student.role, 'student');
    return structuredClone(value);
  });
}

function requireManualCodeReceipt(
  value: unknown,
  input: {
    identity: AndroidCameraRuntimeIdentity;
    expectedCodeSha256: string;
    expectedActorAuthUidSha256: string;
  },
): asserts value is AndroidCameraManualCodeReceipt {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const receipt = value as Partial<AndroidCameraManualCodeReceipt>;
  assert.equal(receipt.source, 'owned-android-coach-hierarchy');
  assert.equal(receipt.frameLabel, 'coach-home');
  assert.equal(receipt.commandLabel, 'coach-home-hierarchy');
  assert.equal(receipt.captureRunId, input.identity.captureRunId);
  assert.equal(receipt.ownerRunId, input.identity.ownerRunId);
  assert.equal(receipt.actor, 'coach');
  assert.equal(receipt.sourceVerification, 'owned-stable-reader-v6');
  assert.equal(receipt.commandExecution, 'completed');
  assert.equal(receipt.commandCleanup, 'cleaned');
  assert(
    typeof receipt.sourcePath === 'string' &&
      !path.isAbsolute(receipt.sourcePath) &&
      !receipt.sourcePath.split(/[\\/]/u).includes('..'),
    'Android manual code source path is not a private child',
  );
  assert(typeof receipt.sourceSizeBytes === 'number' && receipt.sourceSizeBytes > 0);
  assert.equal(receipt.sourceMode, 0o600);
  assert(
    Number.isSafeInteger(receipt.sourceOwnerUid) && receipt.sourceOwnerUid === process.getuid?.(),
  );
  const requireInteger = (candidate: unknown, label: string, minimum: number): number => {
    if (!Number.isSafeInteger(candidate) || (candidate as number) < minimum)
      throw new Error(`${label} is invalid`);
    return candidate as number;
  };
  requireInteger(receipt.commandOrdinal, 'Android manual code command ordinal', 0);
  requireInteger(receipt.commandPid, 'Android manual code command PID', 2);
  requireInteger(receipt.commandPgid, 'Android manual code command PGID', 2);
  requireHash(receipt.sourceSha256, 'Android manual code source hash');
  requireHash(receipt.commandArgvSha256, 'Android manual code command hash');
  requireHash(receipt.actorAuthUidSha256, 'Android manual code actor hash');
  requireHash(receipt.codeSha256, 'Android manual code hash');
  assert.equal(receipt.actorAuthUidSha256, input.expectedActorAuthUidSha256);
  assert.equal(receipt.codeSha256, input.expectedCodeSha256);
}

function requireConnectionId(value: unknown): string {
  assert(
    typeof value === 'string' && SAFE_CONNECTION_ID.test(value),
    'pending connection ID is invalid',
  );
  return value;
}

function matchingTargetConnections(snapshot: OwnedConnectionSnapshot) {
  const target = snapshot.target;
  return snapshot.rows.connections.filter(
    (row) =>
      row.professionalAuthUid === target.professionalAuthUid &&
      row.studentAuthUid === target.studentAuthUid &&
      row.specialty === target.specialty,
  );
}

function requireNoTargetConnection(snapshot: OwnedConnectionSnapshot): void {
  assert.equal(
    matchingTargetConnections(snapshot).length,
    0,
    'Android camera pre-submit target connection must be absent',
  );
}

/** Every async native/backend seam is fenced before its result is consumed. */
async function settle<T>(signal: AbortSignal, pending: Promise<T>): Promise<T> {
  const value = await pending;
  signal.throwIfAborted();
  return value;
}

function tap(id: string): string {
  return `- tapOn:\n    id: ${JSON.stringify(id)}`;
}

function scrollTo(id: string): string {
  return [
    '- scrollUntilVisible:',
    '    element:',
    `      id: ${JSON.stringify(id)}`,
    '    direction: DOWN',
    '    timeout: 30000',
    '    centerElement: true',
  ].join('\n');
}

export function buildAndroidCameraEntryActions(): string {
  return tap(ANDROID_CAMERA_UI.accountButton);
}

export function buildAndroidCameraPromptActions(): string {
  return tap(ANDROID_CAMERA_UI.scanQrButton);
}

export function buildAndroidCameraManualEntryActions(code: string): string {
  const safeCode = requireManualCode(code);
  return [tap(ANDROID_CAMERA_UI.codeInput), `- inputText: ${JSON.stringify(safeCode)}`].join('\n');
}

export function buildAndroidCameraSubmitActions(): string {
  return [
    '- hideKeyboard',
    tap(ANDROID_CAMERA_UI.connectButton),
    scrollTo(ANDROID_CAMERA_PENDING_CARD_ID_PATTERN),
  ].join('\n');
}

/**
 * The submit flow dismisses the keyboard before tapping exactly once, then
 * uses a bounded real scroll to bring
 * one pending-card resource prefix into view. The exact connection ID is read
 * from the post-submit owned snapshot before the final pending frame scroll is
 * built.
 */
export const ANDROID_CAMERA_PENDING_CARD_ID_PATTERN =
  'student\\.professionals\\.connectionPending\\.[A-Za-z0-9][A-Za-z0-9._:-]{0,159}';

export function buildAndroidCameraPendingActions(connectionId: string): string {
  const safeId = requireConnectionId(connectionId);
  return scrollTo(`${ANDROID_CAMERA_UI.pendingCardPrefix}${safeId}`);
}

function requireIdentityInput(input: AndroidCameraRuntimeIdentityInput): void {
  assert(input.captureRunId.length > 0, 'Android camera capture run is missing');
  assert(input.ownerRunId.length > 0, 'Android camera owner run is missing');
  assert(input.backendRunId.length > 0, 'Android camera backend run is missing');
  assert.equal(input.backendAttemptId, `${input.backendRunId}:first`);
  assert.equal(input.appId, ANDROID_CAMERA_APP_ID);
  assert.equal(input.serial, input.target.deviceId);
  assert.equal(input.appId, input.target.appId);
  assert(typeof input.apiOrigin === 'string' && input.apiOrigin.length > 0);
  assert(Number.isSafeInteger(input.apiPid) && input.apiPid > 1);
  assert(typeof input.apiStarted === 'string' && input.apiStarted.length > 0);
  assert(typeof input.apiScript === 'string' && input.apiScript.length > 0);
  assert.match(input.target.binaryHash ?? '', HASH, 'Android binary hash is missing');
}

async function observeFrame(
  context: AndroidCameraProducerContext,
  identity: AndroidCameraRuntimeIdentity,
  label: AndroidCameraFrameSource['label'],
  actions: string,
  viewId: string,
  selectors: readonly string[],
): Promise<{ source: AndroidCameraFrameSource; tree: unknown }> {
  context.signal.throwIfAborted();
  await settle(context.signal, context.capture.observe(label, actions, viewId, [...selectors]));
  const source = await settle(context.signal, context.capture.frameSource(label));
  const loaded = await settle(
    context.signal,
    readAndroidCameraFrameSource({
      artifactRoot: context.output,
      source,
      expected: identity,
      signal: context.signal,
    }),
  );
  assert(loaded.tree !== undefined, `Android camera ${label} frame has no hierarchy tree`);
  return { source, tree: loaded.tree };
}

export async function submitAndroidCameraPending(
  input: {
    signal: AbortSignal;
    capture: Pick<AndroidCameraFrameCapture, 'execute'>;
    snapshots: Pick<AndroidCameraSnapshotSource, 'readEvidence'>;
  },
  submitActions: string,
): Promise<{
  preSubmitEvidence: OwnedSnapshotEvidence<OwnedConnectionSnapshot>;
  pendingConnectionId: string;
  pendingSnapshotEvidence: OwnedSnapshotEvidence<OwnedConnectionSnapshot>;
}> {
  const preSubmitEvidence = await settle(input.signal, input.snapshots.readEvidence());
  requireNoTargetConnection(preSubmitEvidence.value);
  await settle(
    input.signal,
    input.capture.execute('pending-submit', submitActions, 'SCR-student-professionals', [
      ANDROID_CAMERA_UI.professionalsScreen,
    ]),
  );
  const pendingSnapshotEvidence = await settle(input.signal, input.snapshots.readEvidence());
  return {
    preSubmitEvidence,
    pendingConnectionId: targetConnectionId(pendingSnapshotEvidence.value),
    pendingSnapshotEvidence,
  };
}

function frameSummary(frame: AndroidCameraFrameSource): AndroidCameraFrameSummary {
  requireHash(frame.receipt.sha256, `Android camera ${frame.label} frame hash`);
  return {
    label: frame.label,
    path: frame.receipt.path,
    sizeBytes: frame.receipt.sizeBytes,
    sha256: frame.receipt.sha256,
    contentKind: frame.receipt.contentKind,
    action: structuredClone(frame.action),
  };
}

function targetConnectionId(snapshot: OwnedConnectionSnapshot): string {
  const matches = matchingTargetConnections(snapshot);
  assert.equal(matches.length, 1, 'Android camera pending target connection is not unique');
  return requireConnectionId(matches[0].id);
}

/**
 * Runs the camera denial/manual-submit path inside an already-owned Android
 * session. The outer capture owns acquisition and cleanup; this function only
 * consumes real command, Maestro, proxy and snapshot seams and returns
 * descriptor/hash references. It never turns missing seams into a pass.
 */
export async function runAndroidCameraDeniedProducer(
  context: AndroidCameraProducerContext,
): Promise<AndroidCameraProducerReceipts> {
  if (!context || typeof context !== 'object')
    throw new AndroidCameraProducerUnavailable('Android camera context is missing');
  requireIdentityInput(context.identity);
  context.signal.throwIfAborted();
  const localeProperties = await settle(
    context.signal,
    readAndroidNativeLocaleProperties(context.commands.readLocaleProperty),
  );
  const localeRaw = await settle(
    context.signal,
    context.locale.readEvidence({
      properties: localeProperties,
      signal: context.signal,
    }),
  );
  const qualifiedLocale = requireAndroidCameraLocale({
    evidence: localeRaw,
    expectedLocale: context.locale.expectedLocale,
    expectedBinding: context.locale.expectedBinding,
  });
  requireIdentityInput(context.identity);
  const runtimeIdentity = {
    ...context.identity,
    locale: qualifiedLocale.evidence,
  };
  const isolationFixture = await requireAndroidCameraIsolationFixtureBinding(
    context.snapshots.isolationFixture,
    {
      artifactRoot: context.output,
      backendRunId: runtimeIdentity.backendRunId,
      primaryFixtureAuthUids: Object.values(context.fixtures.accounts).map(
        (account) => account.authUid,
      ),
      isolationExpected: context.snapshots.isolationExpected,
      signal: context.signal,
    },
  );

  const commands = buildAndroidCameraPermissionCommands(runtimeIdentity.appId);
  const clear = await settle(
    context.signal,
    context.commands.run('camera-permission-clear', commands.clearUserDecision),
  );
  const revoke = await settle(
    context.signal,
    context.commands.run('camera-permission-revoke', commands.revoke),
  );
  const beforeCheck = await settle(
    context.signal,
    context.commands.check('camera-permission-before-check', commands.check),
  );

  const entry = await observeFrame(
    context,
    runtimeIdentity,
    'entry',
    context.capture.savedFlow.renderEntry(),
    'SCR-student-professionals',
    [ANDROID_CAMERA_UI.professionalsScreen, ANDROID_CAMERA_UI.scanQrButton],
  );
  const prompt = await observeFrame(
    context,
    runtimeIdentity,
    'prompt',
    context.capture.savedFlow.renderPrompt(),
    'STATE-camera-prompt',
    [...ANDROID_CAMERA_PROMPT_READINESS_SELECTORS],
  );
  const promptSpec = await settle(
    context.signal,
    context.capture.promptSpec({
      source: prompt.source,
      tree: prompt.tree,
    }),
  );
  assert.equal(promptSpec.appPackageName, runtimeIdentity.appId);
  assert.equal(promptSpec.serial, runtimeIdentity.serial);
  assert.equal(promptSpec.locale, context.locale.expectedLocale);
  const qualifiedPrompt: AndroidCameraPromptQualification = qualifyAndroidCameraPrompt({
    tree: prompt.tree,
    hierarchySha256: prompt.source.receipt.sha256,
    promptRootPath: promptSpec.promptRootPath,
    appId: promptSpec.appPackageName,
    appLabel: promptSpec.appLabel,
    expectedLocale: context.locale.expectedLocale,
    systemPackage: promptSpec.systemPackage,
    title: promptSpec.title,
    deny: promptSpec.deny,
  });
  const denied = await observeFrame(
    context,
    runtimeIdentity,
    'denied',
    context.capture.savedFlow.renderDenied(qualifiedPrompt.deny.value),
    'STATE-camera-guidance',
    [ANDROID_CAMERA_UI.denialGuidance, ANDROID_CAMERA_UI.codeInput],
  );
  requireAndroidCameraPromptDismissed({
    treeAfterDenial: denied.tree,
    appId: runtimeIdentity.appId,
    guidanceResourceId: ANDROID_CAMERA_UI.denialGuidance,
    expectedLocale: context.locale.expectedLocale,
  });
  const afterCheck = await settle(
    context.signal,
    context.commands.check('camera-permission-after-check', commands.check),
  );
  const permission = await settle(
    context.signal,
    requireAndroidCameraPermissionEvidence({
      artifactRoot: context.output,
      identity: runtimeIdentity,
      clearUserDecision: clear,
      revoke,
      beforeCheck,
      afterCheck,
      signal: context.signal,
    }),
  );

  const manualInput = await settle(context.signal, context.readManualCodeReceipt());
  const manualCode = requireManualCode(manualInput.value);
  const manualCodeSha256 = sha256(manualCode);
  requireManualCodeReceipt(manualInput.receipt, {
    identity: runtimeIdentity,
    expectedCodeSha256: manualCodeSha256,
    expectedActorAuthUidSha256: sha256(context.fixtures.accounts.coach.authUid),
  });
  const manual = await observeFrame(
    context,
    runtimeIdentity,
    'manual',
    context.capture.savedFlow.renderManual(),
    'SCR-student-professionals',
    [ANDROID_CAMERA_UI.codeInput, ANDROID_CAMERA_UI.connectButton],
  );
  requireAndroidCameraManualEntry({
    tree: manual.tree,
    appId: runtimeIdentity.appId,
    manualCodeSha256,
    codeInputId: ANDROID_CAMERA_UI.codeInput,
    connectButtonId: ANDROID_CAMERA_UI.connectButton,
    qrModalId: ANDROID_CAMERA_UI.qrModal,
  });
  context.capture.setInviteCode(manualCode);
  const beforeRequestId = context.proxy.requestIdFence;
  const submitActions = ['- hideKeyboard', context.capture.savedFlow.renderSubmit()]
    .filter((value) => value.length > 0)
    .join('\n');
  context.proxy.enableNativeRequestBodyCapture({
    artifactRoot: context.output,
    captureRunId: runtimeIdentity.captureRunId,
    sessionRunId: runtimeIdentity.backendRunId,
    backendAttemptId: runtimeIdentity.backendAttemptId,
    actorAuthUidSha256: sha256(context.fixtures.accounts.student.authUid),
    targetOrigin: runtimeIdentity.apiOrigin,
    apiPid: runtimeIdentity.apiPid,
    manualCodeSha256,
    actionSha256: sha256(submitActions),
  });
  const { preSubmitEvidence, pendingConnectionId, pendingSnapshotEvidence } =
    await submitAndroidCameraPending(context, submitActions);
  const pending = await observeFrame(
    context,
    runtimeIdentity,
    'pending',
    context.capture.savedFlow.renderPending(pendingConnectionId),
    'STATE-connection-pending',
    [
      ANDROID_CAMERA_UI.professionalsScreen,
      `${ANDROID_CAMERA_UI.pendingCardPrefix}${pendingConnectionId}`,
    ],
  );
  const pendingSnapshot = pendingSnapshotEvidence.value;
  const observedPendingConnectionId = targetConnectionId(pendingSnapshot);
  assert.equal(observedPendingConnectionId, pendingConnectionId);
  requireAndroidCameraPendingGuidance({
    tree: pending.tree,
    appId: runtimeIdentity.appId,
    connectionId: pendingConnectionId,
    expectedLocale: context.locale.expectedLocale,
  });
  const isolationAfterEvidence = await settle(
    context.signal,
    context.snapshots.readIsolationAfterEvidence(),
  );
  const isolationAfter = isolationAfterEvidence.value;
  const trainingAfterEvidence = await settle(
    context.signal,
    context.snapshots.readTrainingAfterEvidence(),
  );
  const trainingAfter = trainingAfterEvidence.value;
  await settle(context.signal, context.proxy.waitForQuiescence());
  const throughRequestId = context.proxy.requestIdFence;
  const request = await settle(context.signal, context.readSubmissionBinding());
  assert.equal(request.manualCodeSha256, manualCodeSha256);
  assert.equal(request.actionSha256, sha256(submitActions));
  const apiIdentity: AndroidCameraApiIdentity = {
    runId: runtimeIdentity.backendRunId,
    attemptId: runtimeIdentity.backendAttemptId,
    apiOrigin: runtimeIdentity.apiOrigin,
    apiPid: runtimeIdentity.apiPid,
    apiStarted: runtimeIdentity.apiStarted,
    apiScript: runtimeIdentity.apiScript,
    backendAttemptId: runtimeIdentity.backendAttemptId,
  };
  const transport = await settle(
    context.signal,
    requireAndroidCameraTransport({
      artifactRoot: context.output,
      observations: context.proxy.observations,
      beforeRequestId,
      throughRequestId,
      allowedRoutes: ['/connections', '/connections/invite-submissions', '/analytics/events'],
      targetOrigin: context.proxy.targetOrigin,
      identity: apiIdentity,
      request,
    }),
  );
  const sourceReceipts = await settle(
    context.signal,
    writeAndroidCameraSqlSourceReceipts({
      artifactRoot: context.output,
      before: preSubmitEvidence,
      pending: pendingSnapshotEvidence,
      isolationBefore: context.snapshots.isolationBeforeEvidence,
      isolationAfter: isolationAfterEvidence,
      trainingBefore: context.snapshots.trainingBeforeEvidence,
      trainingAfter: trainingAfterEvidence,
      probeApiLifetime: context.probeApiLifetime,
      signal: context.signal,
    }),
  );
  const sourceEvidence = {
    before: preSubmitEvidence.receipt,
    pending: pendingSnapshotEvidence.receipt,
    'isolation-before': context.snapshots.isolationBeforeEvidence.receipt,
    'isolation-after': isolationAfterEvidence.receipt,
    'training-before': context.snapshots.trainingBeforeEvidence.receipt,
    'training-after': trainingAfterEvidence.receipt,
  } as const;
  const parentEvidence = {
    before: preSubmitEvidence,
    pending: pendingSnapshotEvidence,
    'isolation-before': context.snapshots.isolationBeforeEvidence,
    'isolation-after': isolationAfterEvidence,
    'training-before': context.snapshots.trainingBeforeEvidence,
    'training-after': trainingAfterEvidence,
  } as const;
  const sqlEvidence = await settle(
    context.signal,
    requireAndroidCameraSqlEvidence({
      artifactRoot: context.output,
      before: preSubmitEvidence.value,
      pending: pendingSnapshot,
      fixtures: context.fixtures,
      expected: context.snapshots.expected,
      isolationExpected: context.snapshots.isolationExpected,
      isolationBefore: context.snapshots.isolationBefore,
      isolationAfter,
      trainingBefore: context.snapshots.trainingBefore,
      trainingAfter,
      inviteCode: manualCode,
      isolationScope: context.snapshots.isolationScope,
      trainingScope: context.snapshots.trainingScope,
      sourceReceipts,
      sourceEvidence,
      parentEvidence,
      signal: context.signal,
    }),
  );
  assert.equal(sqlEvidence.sourceReceiptCount, sourceReceipts.length);
  context.signal.throwIfAborted();
  const primaryFixtureAuthUids = Object.values(context.fixtures.accounts).map(
    (account) => account.authUid,
  );
  return {
    captureRunId: runtimeIdentity.captureRunId,
    identity: runtimeIdentity,
    producerStatus: 'receipts-bound',
    sourceSelectionHash: context.selectionHash,
    localeStatus: 'qualified',
    permission,
    frames: [entry, prompt, denied, manual, pending].map(({ source }) => frameSummary(source)),
    pendingConnectionId,
    submissionRequestId: transport.requestId,
    transportRequestWindow: {
      beforeRequestId,
      throughRequestId,
      requestId: transport.requestId,
    },
    manualCodeSha256,
    manualCodeSource: structuredClone(manualInput.receipt),
    submission: structuredClone(request),
    primaryFixtureAuthUids: [...primaryFixtureAuthUids].sort(),
    primaryExpected: structuredClone(context.snapshots.expected),
    isolationExpected: structuredClone(context.snapshots.isolationExpected),
    isolationFixture,
    sqlReceipts: sourceReceipts.map((receipt) => structuredClone(receipt)),
    permissionCommandLabels: [clear.label, revoke.label, beforeCheck.label, afterCheck.label],
  };
}

export function requireAndroidCameraProducerOutput(
  value: AndroidCameraProducerReceipts,
  expected: { selectionHash: string; runId: string },
): AndroidCameraProducerReceipts {
  assert.equal(value.captureRunId, expected.runId);
  assert.equal(value.sourceSelectionHash, expected.selectionHash);
  assert.equal(value.producerStatus, 'receipts-bound');
  assert.equal(value.localeStatus, 'qualified');
  assert(
    Array.isArray(value.primaryFixtureAuthUids) &&
      value.primaryFixtureAuthUids.length > 0 &&
      value.primaryFixtureAuthUids.every((uid) => typeof uid === 'string' && uid.length > 0) &&
      new Set(value.primaryFixtureAuthUids).size === value.primaryFixtureAuthUids.length,
    'Android camera primary fixture identities are invalid',
  );
  assert(value.primaryExpected, 'Android camera primary expected identity is missing');
  assert.equal(value.primaryExpected.runId, value.identity.backendRunId);
  assert.equal(value.primaryExpected.scope, 'native-entry-android');
  assert.deepEqual(
    [...(value.primaryExpected.fixtureAuthUids ?? [])].sort(),
    value.primaryFixtureAuthUids.slice().sort(),
    'Android camera primary expected fixture identities differ from the primary fixture allowlist',
  );
  assert(
    value.primaryExpected.target &&
      value.primaryFixtureAuthUids.includes(value.primaryExpected.target.professionalAuthUid) &&
      value.primaryFixtureAuthUids.includes(value.primaryExpected.target.studentAuthUid) &&
      value.primaryExpected.target.professionalAuthUid !==
        value.primaryExpected.target.studentAuthUid,
    'Android camera primary expected target is outside its fixture identities',
  );
  assert.deepEqual(value.permissionCommandLabels, [
    'camera-permission-clear',
    'camera-permission-revoke',
    'camera-permission-before-check',
    'camera-permission-after-check',
  ]);
  assert.equal(value.frames.length, 5);
  assert.deepEqual(
    value.frames.map((frame) => frame.label),
    ['entry', 'prompt', 'denied', 'manual', 'pending'],
  );
  assert.deepEqual(
    value.frames.map((frame) => frame.action.label),
    ['entry', 'prompt', 'denied', 'manual', 'pending'],
  );
  assert.equal(new Set(value.frames.map((frame) => frame.action.invocationId)).size, 5);
  assert.match(value.manualCodeSha256, HASH);
  assert(Number.isSafeInteger(value.submissionRequestId) && value.submissionRequestId > 0);
  assert(value.transportRequestWindow);
  assert(
    Number.isSafeInteger(value.transportRequestWindow.beforeRequestId) &&
      value.transportRequestWindow.beforeRequestId >= 0,
  );
  assert(
    Number.isSafeInteger(value.transportRequestWindow.throughRequestId) &&
      value.transportRequestWindow.throughRequestId > value.transportRequestWindow.beforeRequestId,
  );
  assert.equal(value.transportRequestWindow.requestId, value.submissionRequestId);
  requireManualCodeReceipt(value.manualCodeSource, {
    identity: value.identity,
    expectedCodeSha256: value.manualCodeSha256,
    expectedActorAuthUidSha256: value.manualCodeSource.actorAuthUidSha256,
  });
  assert.equal(value.manualCodeSource.codeSha256, value.manualCodeSha256);
  assert.equal(value.submission.requestId, value.submissionRequestId);
  assert.equal(value.submission.manualCodeSha256, value.manualCodeSha256);
  assert.equal(value.submission.bodyHash, value.submission.recorderBodyHash);
  assert(value.isolationExpected, 'Android camera isolation expected identity is missing');
  assert(value.isolationFixture, 'Android camera isolation fixture binding is missing');
  assert.equal(value.isolationExpected.runId, value.identity.backendRunId);
  assert.equal(value.isolationExpected.scope, value.isolationFixture.scope);
  assert.equal(value.isolationFixture.runId, value.identity.backendRunId);
  assert.equal(value.isolationFixture.source, 'owned-session.fixtures');
  assert.equal(
    value.isolationFixture.path,
    'fixtures-native-connection-isolation-android.private.json',
  );
  assert.equal(value.isolationFixture.kind, 'sidecar');
  assert.equal(value.isolationFixture.verification, 'owned-stable-reader-v6');
  assert.equal(value.isolationFixture.mode, 0o600);
  assert.deepEqual(
    [...(value.isolationExpected.fixtureAuthUids ?? [])].sort(),
    [...value.isolationFixture.fixtureAuthUids].sort(),
  );
  assert.equal(
    value.isolationExpected.target?.professionalAuthUid,
    value.isolationFixture.target.professionalAuthUid,
  );
  assert.equal(
    value.isolationExpected.target?.studentAuthUid,
    value.isolationFixture.target.studentAuthUid,
  );
  assert(
    !value.isolationFixture.fixtureAuthUids.some((uid) =>
      value.primaryFixtureAuthUids.includes(uid),
    ),
    'Android camera isolation fixture overlaps the primary fixture identities',
  );
  assert(value.sqlReceipts.length > 0, 'Android camera SQL source receipts are missing');
  assert.deepEqual(
    [...new Set(value.sqlReceipts.map((receipt) => receipt.phase))].sort(),
    [
      'before',
      'isolation-after',
      'isolation-before',
      'pending',
      'training-after',
      'training-before',
    ],
    'Android camera SQL source receipt phases are incomplete',
  );
  assert(value.sqlReceipts.every((receipt) => receipt.mode === 0o600));
  return structuredClone(value);
}

export function requireAndroidCameraSelectionShape(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'android',
    engine: 'maestro',
    scenario: ANDROID_CAMERA_SCENARIO,
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, ANDROID_CAMERA_SCENARIO);
  assert.deepEqual(
    selection.scenario.pilotAssertions?.map((row) => row.id),
    [...ANDROID_CAMERA_ASSERTION_IDS],
  );
}

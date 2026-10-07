import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { androidSourceIdentity, inspectOwnedAndroidApk } from './android-build-identity';
import {
  androidInputReaderPackage,
  parseAndroidNativeInputObservation,
} from './android-native-input-reader';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import { sourceIdentity } from './native-build-identity';
import { loadReusableIosBuild } from './native-build-reuse';
import { assertNativeBootstrapHealthy } from './native-runtime-preflight';
import {
  requireNativeRetryDraft,
  validateNativeRetrySnapshots,
} from './native-save-retry-observation';
import { requireIosItemRemovalPrompt } from './native-training-edit-observation';
import { requireNativeTrainingJourneyState } from './native-training-journey';
import {
  nativeLoadSnapshotPaths,
  requireNativeLoadObservation,
  requireNativeRecoveredQuantityFrame,
} from './native-training-load-observation';
import {
  requireAndroidClearedTrainingTitle,
  requireAndroidItemRemovalPrompt,
  requireAndroidSelectAllMenu,
  requireAndroidTrainingTitle,
  requireNativeTrainingPreview,
  requireIosClearedTrainingTitle,
  requireIosTrainingPreview,
  requireIosTrainingTitleKeyboard,
} from './native-training-maestro-driver';
import { assertTestingDocument } from './schema-validation';
import { enUS } from '../../localization/en-US';
import type {
  NativeTrainingJourneyInput,
  NativeTrainingJourneyState,
} from './native-training-journey';
import type { ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';
import type { Stats } from 'node:fs';

export const nativeObservedSelectors: Record<string, { attribute: string; value: string }> = {
  'SCR-sign-in': { attribute: 'resource-id', value: 'auth.signIn.emailInput' },
  'SCR-pro-home': { attribute: 'resource-id', value: 'pro.home.screen' },
  'SCR-account': { attribute: 'resource-id', value: 'settings.account.screen' },
  'STATE-signout-confirm': { attribute: 'resource-id', value: 'settings.account.signOutConfirm' },
  'STATE-password-save': { attribute: 'accessibilityText', value: 'Save Password?' },
  'SCR-training-library': { attribute: 'resource-id', value: 'pro.library.training.create' },
  'SCR-training-builder': { attribute: 'resource-id', value: 'pro.training_plan.screen' },
  'STATE-training-save-error': {
    attribute: 'accessibilityText',
    value: enUS['pro.plan.error.save'],
  },
  'STATE-training-load-error': { attribute: 'resource-id', value: 'pro.training_plan.error' },
  'STATE-session-editor': { attribute: 'resource-id', value: 'pro.training_plan.addSession.name' },
  'STATE-exercise-search': { attribute: 'resource-id', value: 'exerciseSearch.input' },
  'STATE-exercise-detail': { attribute: 'resource-id', value: 'exerciseSearch.detail' },
  'SCR-pro-pending': { attribute: 'resource-id', value: 'pro.pending.screen' },
  'SCR-pro-roster': { attribute: 'resource-id', value: 'pro.students.screen' },
  'SCR-student-home': { attribute: 'resource-id', value: 'student.home.screen' },
  'SCR-student-professionals': { attribute: 'resource-id', value: 'student.professionals.screen' },
  // Exact seeded state identity is additionally checked by the connection preparation guard.
  'STATE-connection-pending': { attribute: 'resource-id', value: 'student.professionals.screen' },
  'STATE-connection-active': { attribute: 'resource-id', value: 'student.professionals.screen' },
  'STATE-camera-prompt': { attribute: 'accessibilityText', value: 'Allow' },
  'STATE-camera-guidance': { attribute: 'resource-id', value: 'student.professionals.submitError' },
  'STATE-native-text-edit-menu': { attribute: 'accessibilityText', value: 'Select All' },
  'STATE-item-removal-confirm': {
    attribute: 'accessibilityText',
    value: enUS['pro.plan.delete.body'],
  },
  'STATE-discard-confirm': {
    attribute: 'accessibilityText',
    value: enUS['pro.plan.discard.title'],
  },
};
export const nativeTrainingEvidencePaths = [
  'draft-before.private.json',
  'draft-after.private.json',
];
export const nativeConnectionEvidencePaths = [
  'connection-before.private.json',
  'connection-after.private.json',
];
export const nativeCameraEvidencePaths = [
  'camera-before.private.json',
  'camera-after.private.json',
  'camera-permission-before.private.json',
  'camera-permission-after.private.json',
];
export function nativeAuxiliaryEvidencePaths(platform: string, charter: string) {
  return [
    'bootstrap.private.log',
    'native-host-census.private.json',
    ...(platform === 'android' ||
    [
      'training-draft',
      'training-discard',
      'training-load',
      'training-journey',
      'save-retry',
      'connection-states',
      'camera-denied',
    ].includes(charter)
      ? ['transport-observations.private.json']
      : []),
    ...(platform === 'android'
      ? ['android-apk-identity.private.json', 'android-reverse.private.log']
      : []),
    ...(['training-draft', 'training-discard', 'save-retry'].includes(charter)
      ? nativeTrainingEvidencePaths
      : []),
    ...(charter === 'training-discard' ? nativeDiscardEvidencePaths : []),
    ...(charter === 'training-load' ? nativeLoadSnapshotPaths : []),
    ...(charter === 'training-load' && platform === 'android'
      ? [
          'load-recovered-quantity-reviewed.private.json',
          'load-recovered-quantity.png',
          'load-recovered-quantity-hierarchy.json',
        ]
      : []),
    ...(charter === 'training-journey'
      ? [
          ...[
            'baseline',
            'draft',
            'created',
            'edited-draft',
            'edited',
            'durable',
            'created-api',
            'edited-api',
            'durable-api',
            'state',
          ].map((label) => `training-journey-${label}.private.json`),
          'training-journey-reviewed-frames.private.json',
        ]
      : []),
    ...(charter === 'save-retry' ? nativeSaveRetryEvidencePaths : []),
    ...(charter === 'connection-states' ? nativeConnectionEvidencePaths : []),
    ...(charter === 'camera-denied' ? nativeCameraEvidencePaths : []),
  ];
}
export const nativeSaveRetryAuxiliaryFrames = [
  ['save-retained', 'SCR-training-builder'],
  ['save-retry-library', 'SCR-training-library'],
  ['save-retry-reopened', 'SCR-training-builder'],
] as const;
export const nativeSaveRetryRuntimeFrames = [
  ['save-error', 'STATE-training-save-error'],
  ...nativeSaveRetryAuxiliaryFrames,
] as const;
export type NativeSaveRetryFrameMode = 'reviewed-inventory' | 'runtime-captured';
export const nativeSaveRetryReviewedFramesPath = 'save-retry-reviewed-frames.private.json';
export const nativeSaveRetryRuntimeFramesPath = 'save-retry-runtime-frames.private.json';
export const nativeSaveRetrySnapshotPaths = [
  'save-retry-before.private.json',
  'save-retry-after-failure.private.json',
  'save-retry-after-success.private.json',
  'save-retry-after-reopen.private.json',
];
export const nativeSaveRetryEvidencePaths = [
  ...nativeSaveRetrySnapshotPaths,
  nativeSaveRetryReviewedFramesPath,
  ...nativeSaveRetryAuxiliaryFrames.flatMap(([label]) => [
    `${label}-hierarchy.json`,
    `${label}.png`,
  ]),
];
export const nativeDiscardAuxiliaryFrames = [
  ['discard-kept', 'SCR-training-builder'],
  ['discard-reopened', 'STATE-discard-confirm'],
  ['discard-library', 'SCR-training-library'],
  ['discard-fresh-builder', 'SCR-training-builder'],
] as const;
export const nativeDiscardEvidencePaths = [
  'discard-before.private.json',
  'discard-after.private.json',
  'discard-reviewed-frames.private.json',
  ...nativeDiscardAuxiliaryFrames.flatMap(([label]) => [`${label}-hierarchy.json`, `${label}.png`]),
];
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export type ViewEvidence = {
  viewId: string;
  screenshotPath: string;
  screenshotHash: string;
  hierarchyPath: string;
  hierarchyHash: string;
  reviewed: boolean;
};
export type NativeViewDeclaration = {
  sources: { id: string; paths: string[]; revision: string }[];
  views: { id: string; sourceRefs: string[] }[];
};
export type NativeViewReceipt = {
  id: string;
  timestamp: string;
  commit: string;
  result: string;
  platform: string;
  build: string;
  device: string;
  fixtureRef: string;
  artifactRoot: string;
  evidencePaths: string[];
  inputFingerprint: string;
  viewEvidence: ViewEvidence[];
  captureHash: string;
  cleanupHash: string;
  auxiliaryEvidence?: { path: string; sha256: string }[];
};

/** Android scrolled quantity frame is additional to the full original recovery proof. */
export function validateAndroidRecoveredQuantityPreparation(
  root: string,
  preparation: unknown,
  captured: { viewId: string; screenshotPath: string; hierarchyPath: string }[],
) {
  if (
    (preparation as { quantityFrame?: string } | null)?.quantityFrame !== 'load-recovered-quantity'
  )
    throw new Error('Android recovered quantity frame metadata is missing');
  const quantityFrame = JSON.parse(
    readNativeEvidence(root, 'load-recovered-quantity-reviewed.private.json', true).toString(),
  ) as ViewEvidence[];
  if (
    !Array.isArray(quantityFrame) ||
    quantityFrame.length !== 1 ||
    quantityFrame[0].viewId !== 'SCR-training-builder' ||
    quantityFrame[0].screenshotPath !== 'load-recovered-quantity.png' ||
    quantityFrame[0].hierarchyPath !== 'load-recovered-quantity-hierarchy.json' ||
    !captured.some(
      (row) =>
        row.viewId === quantityFrame[0].viewId &&
        row.screenshotPath === quantityFrame[0].screenshotPath &&
        row.hierarchyPath === quantityFrame[0].hierarchyPath,
    )
  )
    throw new Error('Android lacks the exact captured/reviewed recovered quantity frame');
  validateNativeViewFiles(root, quantityFrame, ['SCR-training-builder']);
  requireNativeRecoveredQuantityFrame(
    'android',
    JSON.parse(readNativeEvidence(root, quantityFrame[0].hierarchyPath, true).toString()),
  );
}

const nativeEvidenceMaxBytes = 8 * 1024 * 1024;
const nativeEvidenceReadChunkBytes = 64 * 1024;
const nativeEvidenceIdentityFields = [
  'dev',
  'ino',
  'uid',
  'gid',
  'mode',
  'nlink',
  'size',
  'mtimeMs',
  'ctimeMs',
] as const;
type NativeEvidenceStat = Stats;
export type NativeEvidenceIdentity = {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};
export type NativeEvidenceObservation = {
  bytes: Buffer;
  identity: NativeEvidenceIdentity;
};
export type NativeEvidenceRootPolicy = 'private-artifact' | 'owned-source';
type NativeEvidenceReadHooks = {
  beforeRead?: () => void;
  afterRead?: () => void;
};

function nativeEvidenceIdentity(stat: NativeEvidenceStat): string {
  return nativeEvidenceIdentityFields.map((field) => String(stat[field])).join(':');
}

function nativeEvidenceIdentitySnapshot(stat: NativeEvidenceStat): NativeEvidenceIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function assertNativeEvidenceFileStat(
  stat: NativeEvidenceStat,
  ownerUid: number | undefined,
  privateRecord: boolean,
  label: string,
): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== ownerUid ||
    stat.size === 0 ||
    stat.size > nativeEvidenceMaxBytes ||
    (stat.mode & 0o022) !== 0 ||
    (privateRecord && (stat.mode & 0o777) !== 0o600)
  )
    throw new Error(label);
}

function readNativeEvidenceInternal(
  root: string,
  relative: string,
  privateRecord: boolean,
  hooks?: NativeEvidenceReadHooks,
  rootPolicy: NativeEvidenceRootPolicy = 'private-artifact',
): NativeEvidenceObservation {
  const parent = lstatSync(root);
  if (
    realpathSync(root) !== root ||
    !parent.isDirectory() ||
    parent.uid !== process.getuid?.() ||
    (rootPolicy === 'private-artifact'
      ? (parent.mode & 0o777) !== 0o700
      : (parent.mode & 0o022) !== 0)
  )
    throw new Error('Native evidence root is not canonical, private and owned');
  if (!relative || path.isAbsolute(relative))
    throw new Error('Native evidence path must be relative');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || realpathSync(file) !== file)
    throw new Error('Native evidence path escaped or contains a symlink');
  const pathBefore = lstatSync(file);
  assertNativeEvidenceFileStat(
    pathBefore,
    parent.uid,
    privateRecord,
    'Native evidence file is not an owned bounded immutable input',
  );
  if (typeof fsConstants.O_NOFOLLOW !== 'number')
    throw new Error('Native evidence reader cannot enforce no-follow opens');
  const descriptor = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = fstatSync(descriptor);
    assertNativeEvidenceFileStat(
      descriptorBefore,
      parent.uid,
      privateRecord,
      'Native evidence descriptor is not an owned bounded immutable input',
    );
    if (nativeEvidenceIdentity(pathBefore) !== nativeEvidenceIdentity(descriptorBefore))
      throw new Error('Native evidence path changed before descriptor read');
    hooks?.beforeRead?.();
    const bytes = Buffer.allocUnsafe(descriptorBefore.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        Math.min(nativeEvidenceReadChunkBytes, bytes.length - offset),
        null,
      );
      if (count <= 0) throw new Error('Native evidence file truncated during bounded read');
      offset += count;
    }
    const extra = Buffer.allocUnsafe(1);
    if (readSync(descriptor, extra, 0, 1, null) !== 0)
      throw new Error('Native evidence file grew during bounded read');
    hooks?.afterRead?.();
    const descriptorAfter = fstatSync(descriptor);
    const pathAfter = lstatSync(file);
    if (nativeEvidenceIdentity(descriptorBefore) !== nativeEvidenceIdentity(descriptorAfter))
      throw new Error('Native evidence descriptor changed during read');
    if (nativeEvidenceIdentity(descriptorBefore) !== nativeEvidenceIdentity(pathAfter))
      throw new Error('Native evidence path changed during read');
    if (realpathSync(file) !== file) throw new Error('Native evidence path changed during read');
    return { bytes, identity: nativeEvidenceIdentitySnapshot(descriptorAfter) };
  } finally {
    closeSync(descriptor);
  }
}

/** Private parent directory protects screenshots written by simctl as 0644. */
export function readNativeEvidence(root: string, relative: string, privateRecord = false) {
  return readNativeEvidenceInternal(root, relative, privateRecord).bytes;
}

/** Returns bytes and the descriptor/path identity verified by the bounded reader. */
export function readNativeEvidenceObservation(
  root: string,
  relative: string,
  privateRecord = false,
  rootPolicy: NativeEvidenceRootPolicy = 'private-artifact',
): NativeEvidenceObservation {
  return readNativeEvidenceInternal(root, relative, privateRecord, undefined, rootPolicy);
}

/** Resource-free filesystem race seam used only by private reader controls. */
export function readNativeEvidenceForTest(
  root: string,
  relative: string,
  privateRecord = false,
  hooks: NativeEvidenceReadHooks = {},
) {
  return readNativeEvidenceInternal(root, relative, privateRecord, hooks).bytes;
}

/** Resource-free identity projection seam for consumers that must bind metadata. */
export function readNativeEvidenceObservationForTest(
  root: string,
  relative: string,
  privateRecord = false,
  hooks: NativeEvidenceReadHooks = {},
  rootPolicy: NativeEvidenceRootPolicy = 'private-artifact',
): NativeEvidenceObservation {
  return readNativeEvidenceInternal(root, relative, privateRecord, hooks, rootPolicy);
}

function treeHasSelector(value: unknown, selector: { attribute: string; value: string }): boolean {
  return treeHasAttributes(
    value,
    (attributes) => attributes[selector.attribute] === selector.value,
  );
}

function treeHasAttributes(
  value: unknown,
  matches: (attributes: Record<string, unknown>) => boolean,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const node = value as { attributes?: Record<string, unknown>; children?: unknown[] };
  return (
    Boolean(node.attributes && matches(node.attributes)) ||
    Boolean(
      Array.isArray(node.children) &&
      node.children.some((child) => treeHasAttributes(child, matches)),
    )
  );
}

export function validateIosCameraPreparation(
  root: string,
  backendRunId: string,
  deviceUdid: string,
  preparation: unknown,
  transport: unknown,
) {
  const row = preparation as {
    requirementRefs?: string[];
    studentAuthUid?: string;
    displayName?: string;
    promptTitle?: string;
    denialControl?: string;
    manualCode?: string;
    snapshotPaths?: string[];
    permissionPaths?: string[];
    ownedSqlBeforeAfterUnchanged?: boolean;
    scope?: string;
  } | null;
  if (
    !row ||
    typeof row.studentAuthUid !== 'string' ||
    !row.studentAuthUid ||
    typeof row.displayName !== 'string' ||
    !row.displayName ||
    ![
      `“${row.displayName}” would like to access the Camera.`,
      `"${row.displayName}" would like to access the Camera.`,
    ].includes(row.promptTitle ?? '') ||
    !["Don't Allow", 'Don’t Allow'].includes(row.denialControl ?? '') ||
    row.manualCode !== 'QA-MANUAL-ONLY' ||
    row.scope !== 'os-denial-and-manual-entry-views-only; no invite submission pass' ||
    row.ownedSqlBeforeAfterUnchanged !== true ||
    !Array.isArray(row.requirementRefs) ||
    !['SC-211', 'UC-002.9', 'AC-249', 'BL-018/P4-camera-denied'].every((id) =>
      row.requirementRefs!.includes(id),
    ) ||
    JSON.stringify(row.snapshotPaths) !== JSON.stringify(nativeCameraEvidencePaths.slice(0, 2)) ||
    JSON.stringify(row.permissionPaths) !== JSON.stringify(nativeCameraEvidencePaths.slice(2))
  )
    throw new Error('Native camera observation lacks its bounded denial preparation');
  const snapshots = nativeCameraEvidencePaths.slice(0, 2).map((file) => {
    const value = JSON.parse(readNativeEvidence(root, file, true).toString()) as {
      runId: string;
      scope: string;
      connections: { studentAuthUid: string }[];
    };
    assertTestingDocument('domain-snapshot-v1', value);
    if (
      value.runId !== backendRunId ||
      value.scope !== 'native-entry-ios' ||
      value.connections.some((connection) => connection.studentAuthUid === row.studentAuthUid)
    )
      throw new Error('Native camera observation lacks an owned unlinked student snapshot');
    return value;
  });
  if (JSON.stringify(snapshots[0]) !== JSON.stringify(snapshots[1]))
    throw new Error('Native camera inventory changed owned SQL');
  const permissions = nativeCameraEvidencePaths.slice(2).map((file) => {
    const value = JSON.parse(readNativeEvidence(root, file, true).toString()) as {
      source: string;
      deviceUdid: string;
      bundleId: string;
      rows: {
        service: string;
        client: string;
        client_type: number;
        auth_value: number;
        auth_reason: number;
      }[];
    };
    if (
      value.source !== 'owned-simulator-tcc-read-only' ||
      value.deviceUdid !== deviceUdid ||
      value.bundleId !== 'com.edufelip.mychampions.dev' ||
      !Array.isArray(value.rows)
    )
      throw new Error('Camera permission evidence belongs to a different source, app or device');
    return value;
  });
  const denied = permissions[1].rows[0];
  if (
    permissions[0].rows.length !== 0 ||
    permissions[1].rows.length !== 1 ||
    !denied ||
    denied.service !== 'kTCCServiceCamera' ||
    denied.client !== permissions[1].bundleId ||
    denied.client_type !== 0 ||
    denied.auth_value !== 0 ||
    !Number.isInteger(denied.auth_reason) ||
    denied.auth_reason < 0
  )
    throw new Error(
      'Native camera evidence does not establish fresh permission followed by denial',
    );
  const tree = (label: string): unknown =>
    JSON.parse(readNativeEvidence(root, `${label}-hierarchy.json`, true).toString());
  const prompt = tree('camera-prompt');
  const text = (value: unknown, label: string) =>
    treeHasSelector(value, { attribute: 'accessibilityText', value: label });
  if (
    !text(prompt, row.promptTitle!) ||
    !text(prompt, row.denialControl!) ||
    !text(prompt, 'Allow')
  )
    throw new Error('Native camera prompt is missing its app title or OS permission controls');
  const guidance = tree('camera-guidance');
  if (
    !treeHasAttributes(
      guidance,
      (attributes) =>
        attributes['resource-id'] === 'student.professionals.submitError' &&
        attributes.accessibilityText === enUS['relationship.qr.permission_denied'],
    ) ||
    !treeHasSelector(guidance, {
      attribute: 'resource-id',
      value: 'student.professionals.codeInput',
    }) ||
    treeHasSelector(guidance, { attribute: 'resource-id', value: 'student.professionals.qrModal' })
  )
    throw new Error('Native camera denial lacks exact inline guidance with manual fallback');
  const manual = tree('camera-manual');
  if (
    !treeHasAttributes(
      manual,
      (attributes) =>
        attributes['resource-id'] === 'student.professionals.codeInput' &&
        attributes.text === row.manualCode &&
        attributes.enabled === 'true',
    ) ||
    !treeHasAttributes(
      manual,
      (attributes) =>
        attributes['resource-id'] === 'student.professionals.connectButton' &&
        attributes.enabled === 'true',
    ) ||
    treeHasSelector(manual, { attribute: 'resource-id', value: 'student.professionals.qrModal' })
  )
    throw new Error('Native camera fallback lacks the populated input and enabled Connect action');
  const records = transport as {
    method: string;
    pathHash: string;
    status: number;
    outcome: string;
    requestProfile: string;
  }[];
  if (
    !Array.isArray(records) ||
    ![
      ['POST', '/auth/email/sign-in', 201],
      ['GET', '/connections', 200],
    ].every(([method, route, status]) =>
      records.some(
        (record) =>
          record.method === method &&
          record.pathHash === sha(String(route)) &&
          record.status === status &&
          record.outcome === 'forwarded' &&
          record.requestProfile === 'native',
      ),
    ) ||
    records.some(
      (record) =>
        record.method === 'POST' &&
        ['/connections', '/connections/invite-submissions'].some(
          (route) => record.pathHash === sha(route),
        ),
    )
  )
    throw new Error('Native camera inventory lacks normal read transport or submits an invite');
}

/** Save/retry state observation, not engine comparison or behavioral promotion. */
export function validateNativeSaveRetryPreparation(
  root: string,
  platform: 'ios' | 'android',
  backendRunId: string,
  preparation: unknown,
  transport: unknown,
  frameMode: NativeSaveRetryFrameMode = 'reviewed-inventory',
) {
  if (frameMode !== 'reviewed-inventory' && frameMode !== 'runtime-captured')
    throw new Error('Unsupported native save/retry frame evidence mode');
  const row = preparation as {
    requirementRefs?: string[];
    createdId?: string;
    accountUid?: string;
    attemptId?: string;
    injectedCount?: number;
    snapshotPaths?: string[];
    scope?: string;
  } | null;
  if (
    !row ||
    !row.accountUid ||
    !row.createdId ||
    row.attemptId !== `native-save-${backendRunId}` ||
    row.injectedCount !== 1 ||
    row.scope !==
      'raw-native-save-error-retained-draft-and-retry-observation; no qualified behavior pass' ||
    JSON.stringify(row.snapshotPaths) !== JSON.stringify(nativeSaveRetrySnapshotPaths) ||
    !Array.isArray(row.requirementRefs) ||
    !['SC-208', 'TC-278', 'BR-293', 'BR-294', 'UC-002.7', 'BL-018/P4-save-retry'].every((id) =>
      row.requirementRefs!.includes(id),
    )
  )
    throw new Error('Native save/retry preparation identity or scope is missing');
  const snapshots = nativeSaveRetrySnapshotPaths.map((relative) => {
    const value = JSON.parse(
      readNativeEvidence(root, relative, true).toString(),
    ) as OwnedDomainSnapshot;
    assertTestingDocument('domain-snapshot-v1', value);
    if (
      value.runId !== backendRunId ||
      value.scope !== `native-entry-${platform}` ||
      value.readOnly !== true
    )
      throw new Error('Native save/retry snapshot belongs to a foreign scope');
    return value;
  });
  if (!snapshots[0].trainingPlans.some((plan) => plan.ownerProfessionalUid === row.accountUid))
    throw new Error('Native save/retry account is absent from the owned baseline');
  if (
    validateNativeRetrySnapshots(
      snapshots[0],
      snapshots[1],
      snapshots[2],
      row.accountUid,
      platform,
    ) !== row.createdId ||
    JSON.stringify(snapshots[2]) !== JSON.stringify(snapshots[3])
  )
    throw new Error('Native save/retry created identity or reopened SQL changed');
  const load = (label: string): unknown =>
    JSON.parse(readNativeEvidence(root, `${label}-hierarchy.json`, true).toString());
  const errorTitle = enUS['pro.plan.error.save'];
  const nativeText = (attributes: Record<string, unknown>, expected: string): boolean =>
    attributes.accessibilityText === expected ||
    (platform === 'android' && attributes.text === expected);
  const nativeResource = (value: unknown, expected: string): boolean =>
    treeHasSelector(value, { attribute: 'resource-id', value: expected }) ||
    (platform === 'android' &&
      treeHasSelector(value, {
        attribute: 'resource-id',
        value: `com.edufelip.mychampions.dev:id/${expected}`,
      }));
  const boundError = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const node = value as { attributes?: Record<string, unknown>; children?: unknown[] };
    return (
      (node.attributes &&
        nativeText(node.attributes, errorTitle) &&
        treeHasAttributes(node, (a) => nativeText(a, 'OK') && a.enabled === 'true')) ||
      Boolean(node.children?.some(boundError))
    );
  };
  if (!boundError(load('save-error')))
    throw new Error('Native save error lacks its bound visible title and enabled OS dismissal');
  for (const [label, enabled] of [
    ['save-retained', true],
    ['save-retry-reopened', false],
  ] as const) {
    const tree = load(label);
    requireNativeRetryDraft(platform, tree, enabled);
    if (
      treeHasAttributes(tree, (a) => nativeText(a, errorTitle)) ||
      treeHasAttributes(tree, (a) => nativeText(a, enUS['pro.plan.discard.title']))
    )
      throw new Error('Native save/retry draft is blocked by an error or discard dialog');
  }
  const library = load('save-retry-library');
  if (
    !nativeResource(library, 'pro.library.training.create') ||
    !nativeResource(library, `pro.library.training.row.${row.createdId}`) ||
    nativeResource(library, 'pro.training_plan.screen') ||
    treeHasAttributes(library, (a) => nativeText(a, enUS['pro.plan.discard.title']))
  )
    throw new Error('Native successful retry does not reach the expected owned library');
  const reviews = JSON.parse(
    readNativeEvidence(
      root,
      frameMode === 'reviewed-inventory'
        ? nativeSaveRetryReviewedFramesPath
        : nativeSaveRetryRuntimeFramesPath,
      true,
    ).toString(),
  ) as ViewEvidence[];
  const expectedFrames =
    frameMode === 'runtime-captured'
      ? nativeSaveRetryRuntimeFrames
      : nativeSaveRetryAuxiliaryFrames;
  if (
    !Array.isArray(reviews) ||
    reviews.length !== expectedFrames.length ||
    !expectedFrames.every(
      ([label, id], index) =>
        reviews[index]?.viewId === id &&
        reviews[index].hierarchyPath === `${label}-hierarchy.json` &&
        reviews[index].screenshotPath === `${label}.png`,
    )
  )
    throw new Error('Native save/retry lacks its exact auxiliary frame reviews');
  for (const frame of reviews) {
    if (frameMode === 'reviewed-inventory') validateNativeViewFiles(root, [frame], [frame.viewId]);
    else validateNativeRuntimeFrameFiles(root, [frame], [frame.viewId], platform);
  }
  const records = transport as {
    requestId: number;
    method: string;
    pathHash: string;
    status: number;
    outcome: string;
    requestProfile: string;
    requestOrigin: string | null;
    faultAttemptId: string | null;
    targetOrigin: string;
  }[];
  if (
    !Array.isArray(records) ||
    records.some((r) => !Number.isSafeInteger(r.requestId) || r.requestId < 1) ||
    new Set(records.map((r) => r.requestId)).size !== records.length
  )
    throw new Error('Native save/retry transport is absent or request identities are invalid');
  const writes = records.filter(
    (r) => r.method === 'POST' && r.pathHash === sha('/plans/training'),
  );
  if (
    writes.length !== 2 ||
    writes[0].outcome !== 'injected' ||
    writes[0].status !== 503 ||
    writes[0].faultAttemptId !== row.attemptId ||
    writes[1].outcome !== 'forwarded' ||
    writes[1].status !== 201 ||
    writes[1].faultAttemptId !== null ||
    !(
      Number.isSafeInteger(writes[0].requestId) &&
      writes[0].requestId > 0 &&
      writes[1].requestId > writes[0].requestId
    )
  )
    throw new Error('Native save/retry lacks its exact one-failure and one-real-save transport');
  const signIn = records.find(
    (r) =>
      r.method === 'POST' &&
      r.pathHash === sha('/auth/email/sign-in') &&
      r.status === 201 &&
      r.outcome === 'forwarded' &&
      r.requestProfile === 'native' &&
      r.requestOrigin === null,
  );
  if (
    !signIn ||
    signIn.requestId >= writes[0].requestId ||
    ![...writes].every(
      (r) =>
        r.requestProfile === 'native' &&
        r.requestOrigin === null &&
        r.targetOrigin === signIn.targetOrigin,
    )
  )
    throw new Error('Native save/retry transport profile or target is inconsistent');
  const requiredReads = [
    ['GET', '/plans/predefined', 200, 0],
    ['POST', '/integrations/exercise/search', 200, 0],
    ['GET', '/integrations/exercise/exercises/00000000-0000-4000-8000-000000000001', 200, 0],
    ['GET', `/plans/training/${row.createdId}`, 200, writes[1].requestId],
  ] as const;
  for (const [method, route, status, afterId] of requiredReads)
    if (
      !records.some(
        (r) =>
          r.method === method &&
          r.pathHash === sha(route) &&
          r.status === status &&
          r.outcome === 'forwarded' &&
          r.requestProfile === 'native' &&
          r.requestOrigin === null &&
          r.targetOrigin === signIn.targetOrigin &&
          r.requestId > (afterId || signIn.requestId) &&
          (afterId > 0 || r.requestId < writes[0].requestId),
      )
    )
      throw new Error('Native save/retry lacks normal catalog or reopened owned API reads');
  const detailPaths = [
    ...snapshots[0].trainingPlans.map((plan) => `/plans/training/${plan.id}`),
    `/plans/training/${row.createdId}`,
  ].map(sha);
  const detailMutations = records.filter(
    (r) => ['POST', 'PATCH', 'DELETE'].includes(r.method) && detailPaths.includes(r.pathHash),
  );
  const patch = detailMutations[0];
  const firstDetailRead = records
    .filter((r) => r.method === 'GET' && r.pathHash === sha(`/plans/training/${row.createdId}`))
    .sort((a, b) => a.requestId - b.requestId)[0];
  if (
    detailMutations.length !== 1 ||
    patch.method !== 'PATCH' ||
    patch.pathHash !== sha(`/plans/training/${row.createdId}`) ||
    patch.status !== 200 ||
    patch.outcome !== 'forwarded' ||
    patch.requestProfile !== 'native' ||
    patch.requestOrigin !== null ||
    patch.targetOrigin !== signIn.targetOrigin ||
    patch.faultAttemptId !== null ||
    patch.requestId <= writes[1].requestId ||
    !firstDetailRead ||
    patch.requestId >= firstDetailRead.requestId
  )
    throw new Error(
      'Native save/retry lacks its exact normal session PATCH or includes an extra mutation',
    );
}

/** Existing iOS callers retain their original platform-specific entry point. */
export function validateIosSaveRetryPreparation(
  root: string,
  backendRunId: string,
  preparation: unknown,
  transport: unknown,
  frameMode: NativeSaveRetryFrameMode = 'reviewed-inventory',
) {
  return validateNativeSaveRetryPreparation(
    root,
    'ios',
    backendRunId,
    preparation,
    transport,
    frameMode,
  );
}

/** Auxiliary draft frames validate preparation without adding duplicate views. */
export function validateIosTrainingDiscardPreparation(
  root: string,
  backendRunId: string,
  preparation: unknown,
  transport: unknown,
) {
  const row = preparation as {
    requirementRefs?: string[];
    savedPlanId?: string;
    draftName?: string;
    sessionName?: string;
    exerciseId?: string;
    exerciseName?: string;
    quantity?: string;
    snapshotPaths?: string[];
    ownedSqlBeforeAfterUnchanged?: boolean;
    scope?: string;
  } | null;
  if (
    !row ||
    !row.savedPlanId ||
    row.scope !== 'native-discard-dialog-and-local-draft-views-only; no saved-plan behavior pass' ||
    row.draftName !== 'Native QA Draft' ||
    row.sessionName !== 'Strength' ||
    row.exerciseId !== '00000000-0000-4000-8000-000000000001' ||
    row.exerciseName !== 'en QA Exercise 1' ||
    row.quantity !== '3x8' ||
    row.ownedSqlBeforeAfterUnchanged !== true ||
    !Array.isArray(row.requirementRefs) ||
    !['SC-208', 'TC-304', 'UC-002.7'].every((id) => row.requirementRefs!.includes(id)) ||
    JSON.stringify(row.snapshotPaths) !== JSON.stringify(nativeDiscardEvidencePaths.slice(0, 2))
  )
    throw new Error('Native discard observation lacks its bounded local-draft preparation');
  const snapshots = nativeDiscardEvidencePaths.slice(0, 2).map((file) => {
    const value = JSON.parse(readNativeEvidence(root, file, true).toString()) as {
      runId: string;
      scope: string;
      trainingPlans: { id: string }[];
    };
    assertTestingDocument('domain-snapshot-v1', value);
    if (
      value.runId !== backendRunId ||
      value.scope !== 'native-entry-ios' ||
      !value.trainingPlans.some((plan) => plan.id === row.savedPlanId)
    )
      throw new Error('Native discard observation lacks exact owned scope and seeded plan');
    return value;
  });
  if (JSON.stringify(snapshots[0]) !== JSON.stringify(snapshots[1]))
    throw new Error('Native discard inventory changed owned SQL');
  const load = (label: string): unknown =>
    JSON.parse(readNativeEvidence(root, `${label}-hierarchy.json`, true).toString());
  const text = (value: unknown, label: string) =>
    treeHasSelector(value, { attribute: 'accessibilityText', value: label });
  const title = enUS['pro.plan.discard.title'];
  const dialog = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const node = value as { attributes?: Record<string, unknown>; children?: unknown[] };
    return (
      (node.attributes?.accessibilityText === title &&
        [
          enUS['pro.plan.discard.body'],
          enUS['pro.plan.discard.no'],
          enUS['pro.plan.discard.yes'],
        ].every((label) => text(node, label))) ||
      Boolean(Array.isArray(node.children) && node.children.some(dialog))
    );
  };
  for (const label of ['discard-prompt', 'discard-reopened'])
    if (!dialog(load(label)))
      throw new Error('Native discard prompt lacks its bound title, body and both decisions');
  const kept = load('discard-kept');
  const retainedSession = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const node = value as { attributes?: Record<string, unknown>; children?: unknown[] };
    return (
      (node.attributes?.['resource-id'] === 'pro.training_plan.sessionRow.Strength' &&
        treeHasAttributes(
          node,
          (a) =>
            a['resource-id'] === 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity' &&
            a.accessibilityText === row.quantity,
        )) ||
      Boolean(Array.isArray(node.children) && node.children.some(retainedSession))
    );
  };
  if (
    text(kept, title) ||
    !treeHasAttributes(
      kept,
      (a) =>
        a['resource-id'] === 'pro.training_plan.name' &&
        a.text === row.draftName &&
        a.enabled === 'true',
    ) ||
    !retainedSession(kept) ||
    !treeHasAttributes(
      kept,
      (a) => a['resource-id'] === 'pro.training_plan.saveButton' && a.enabled === 'true',
    )
  )
    throw new Error('Native Keep editing frame loses the editable prepared draft');
  const library = load('discard-library');
  if (
    !treeHasSelector(library, { attribute: 'resource-id', value: 'pro.library.training.create' }) ||
    !treeHasSelector(library, {
      attribute: 'resource-id',
      value: `pro.library.training.row.${row.savedPlanId}`,
    }) ||
    treeHasSelector(library, { attribute: 'resource-id', value: 'pro.training_plan.screen' })
  )
    throw new Error('Native confirmed discard does not reach the expected owned library');
  const fresh = load('discard-fresh-builder');
  if (
    !treeHasAttributes(
      fresh,
      (a) =>
        a['resource-id'] === 'pro.training_plan.name' &&
        a.text === '' &&
        a.value === '' &&
        a.enabled === 'true',
    ) ||
    !treeHasAttributes(
      fresh,
      (a) => a['resource-id'] === 'pro.training_plan.saveButton' && a.enabled === 'false',
    ) ||
    treeHasAttributes(
      fresh,
      (a) =>
        typeof a['resource-id'] === 'string' &&
        (a['resource-id'].startsWith('pro.training_plan.sessionRow.') ||
          a['resource-id'].startsWith('pro.training_plan.itemRow.')),
    )
  )
    throw new Error('Native fresh builder retained discarded edits or allows an empty save');
  const reviews = JSON.parse(
    readNativeEvidence(root, 'discard-reviewed-frames.private.json', true).toString(),
  ) as ViewEvidence[];
  if (
    !Array.isArray(reviews) ||
    reviews.length !== nativeDiscardAuxiliaryFrames.length ||
    !nativeDiscardAuxiliaryFrames.every(
      ([label, id], index) =>
        reviews[index]?.viewId === id &&
        reviews[index].hierarchyPath === `${label}-hierarchy.json` &&
        reviews[index].screenshotPath === `${label}.png`,
    )
  )
    throw new Error('Native discard observation lacks its exact auxiliary frame reviews');
  for (const frame of reviews) validateNativeViewFiles(root, [frame], [frame.viewId]);
  const records = transport as {
    method: string;
    pathHash: string;
    status: number;
    outcome: string;
    requestProfile: string;
  }[];
  const mutationPaths = [
    '/plans/training',
    ...snapshots[0].trainingPlans.map((plan) => `/plans/training/${plan.id}`),
  ].map(sha);
  if (
    !Array.isArray(records) ||
    records.some(
      (r) => ['POST', 'PATCH', 'DELETE'].includes(r.method) && mutationPaths.includes(r.pathHash),
    ) ||
    ![
      ['POST', '/auth/email/sign-in', 201],
      ['GET', '/plans/predefined', 200],
    ].every(([method, route, status]) =>
      records.some(
        (r) =>
          r.method === method &&
          r.pathHash === sha(String(route)) &&
          r.status === status &&
          r.outcome === 'forwarded' &&
          r.requestProfile === 'native',
      ),
    )
  )
    throw new Error('Native discard observation lacks normal reads or attempts a plan write');
}

/** Separate seeded-state views, never an invite/confirmation journey receipt. */
export function validateNativeConnectionStatePreparation(
  root: string,
  platform: 'ios' | 'android',
  backendRunId: string,
  preparation: unknown,
  transport: unknown,
) {
  const row = preparation as {
    requirementRefs?: string[];
    coachAuthUid?: string;
    seededStates?: { id: string; studentAuthUid: string; status: string }[];
    ownedSqlBeforeAfterUnchanged?: boolean;
    snapshotPaths?: string[];
    scope?: string;
  } | null;
  if (
    !['ios', 'android'].includes(platform) ||
    !row ||
    typeof row.coachAuthUid !== 'string' ||
    !row.coachAuthUid ||
    row.scope !== 'separate-seeded-state-views-only; no invite submission or approval pass' ||
    row.ownedSqlBeforeAfterUnchanged !== true ||
    JSON.stringify(row.snapshotPaths) !== JSON.stringify(nativeConnectionEvidencePaths) ||
    !Array.isArray(row.requirementRefs) ||
    !['SC-211', 'UC-002.3', 'AC-214', 'BR-213', 'TC-213', 'TC-214'].every((id) =>
      row.requirementRefs!.includes(id),
    ) ||
    !Array.isArray(row.seededStates) ||
    row.seededStates.length !== 2 ||
    !row.seededStates.every(
      (value) =>
        value &&
        typeof value === 'object' &&
        typeof value.studentAuthUid === 'string' &&
        value.studentAuthUid &&
        typeof value.id === 'string' &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id),
    ) ||
    row.seededStates[0].status !== 'pending_confirmation' ||
    row.seededStates[1].status !== 'active' ||
    row.seededStates[0].id === row.seededStates[1].id ||
    new Set([row.coachAuthUid, ...row.seededStates.map((value) => value.studentAuthUid)]).size !== 3
  )
    throw new Error('Native connection preparation lacks separate seeded state scope');
  const snapshots = nativeConnectionEvidencePaths.map((relative) => {
    const value = JSON.parse(readNativeEvidence(root, relative, true).toString()) as {
      runId: string;
      scope: string;
      connections: {
        id: string;
        studentAuthUid: string;
        professionalAuthUid: string;
        specialty: string;
        status: string;
      }[];
    };
    assertTestingDocument('domain-snapshot-v1', value);
    if (
      value.runId !== backendRunId ||
      value.scope !== `native-entry-${platform}` ||
      !row.seededStates!.every((expected) =>
        value.connections.some(
          (actual) =>
            actual.id === expected.id &&
            actual.studentAuthUid === expected.studentAuthUid &&
            actual.professionalAuthUid === row.coachAuthUid &&
            actual.specialty === 'fitness_coach' &&
            actual.status === expected.status,
        ),
      )
    )
      throw new Error('Native connection snapshot lacks exact owned seeded identities and states');
    return value;
  });
  if (JSON.stringify(snapshots[0]) !== JSON.stringify(snapshots[1]))
    throw new Error('Native connection observations changed owned SQL');
  const trees = Object.fromEntries(
    ['coach-pending', 'coach-roster', 'student-pending', 'student-active'].map((label) => [
      label,
      JSON.parse(readNativeEvidence(root, `${label}-hierarchy.json`, true).toString()) as unknown,
    ]),
  );
  const attribute = platform === 'ios' ? 'accessibilityText' : 'text';
  if (
    !treeHasSelector(trees['coach-pending'], { attribute, value: row.seededStates[0].id }) ||
    !row.seededStates.every((value) =>
      treeHasSelector(trees['coach-roster'], {
        attribute: 'resource-id',
        value: `pro.students.row.${value.studentAuthUid}`,
      }),
    ) ||
    !treeHasAttributes(
      trees['student-pending'],
      (attributes) =>
        attributes['resource-id'] ===
          `student.professionals.connectionPending.${row.seededStates![0].id}` &&
        attributes[attribute] ===
          'Waiting for professional confirmation to activate this connection.',
    ) ||
    treeHasSelector(trees['student-pending'], { attribute, value: 'End connection' }) ||
    !treeHasAttributes(
      trees['student-active'],
      (attributes) =>
        typeof attributes['resource-id'] === 'string' &&
        attributes['resource-id'].startsWith('student.professionals.unbindButton.') &&
        attributes[attribute] === 'End connection',
    ) ||
    treeHasAttributes(
      trees['student-active'],
      (attributes) =>
        typeof attributes['resource-id'] === 'string' &&
        attributes['resource-id'].startsWith('student.professionals.connectionPending.'),
    )
  )
    throw new Error('Native connection exact seeded state is absent from its actual hierarchy');
  for (const [method, route, status, count] of [
    ['POST', '/auth/email/sign-in', 201, 3],
    ['GET', '/connections', 200, 3],
    ['GET', '/professional/students', 200, 1],
  ] as const) {
    if (
      !Array.isArray(transport) ||
      transport.filter(
        (value: Record<string, unknown>) =>
          value &&
          typeof value === 'object' &&
          value.method === method &&
          value.pathHash === sha(route) &&
          value.status === status &&
          value.outcome === 'forwarded' &&
          value.requestProfile === 'native',
      ).length < count
    )
      throw new Error('Native connection observations lack normal owned multi-account transport');
  }
}

/** Inventory preparation proof only: no saved-plan or behavior qualification. */
export function validateNativeTrainingPreparation(
  root: string,
  platform: 'ios' | 'android',
  backendRunId: string,
  preparation: unknown,
  transport: unknown,
) {
  const row = preparation as {
    requirementRefs?: string[];
    catalogExerciseId?: string;
    quantityObserved?: boolean;
    ownedSqlBeforeAfterUnchanged?: boolean;
    snapshotPaths?: string[];
  } | null;
  const exerciseId = '00000000-0000-4000-8000-000000000001';
  if (
    !['ios', 'android'].includes(platform) ||
    !row ||
    row.catalogExerciseId !== exerciseId ||
    row.quantityObserved !== true ||
    row.ownedSqlBeforeAfterUnchanged !== true ||
    JSON.stringify(row.snapshotPaths) !== JSON.stringify(nativeTrainingEvidencePaths) ||
    !Array.isArray(row.requirementRefs) ||
    !['SC-208', 'TC-303', 'BR-293', 'BR-294', 'UC-002.7'].every((id) =>
      row.requirementRefs!.includes(id),
    )
  )
    throw new Error('Native training preparation scope is missing or inconsistent');
  const snapshots = nativeTrainingEvidencePaths.map((relative) => {
    const value = JSON.parse(readNativeEvidence(root, relative, true).toString()) as {
      runId: string;
      scope: string;
      trainingPlans: unknown[];
    };
    assertTestingDocument('domain-snapshot-v1', value);
    if (
      value.runId !== backendRunId ||
      value.scope !== `native-entry-${platform}` ||
      !value.trainingPlans.length
    )
      throw new Error('Native training snapshot does not belong to the seeded owned scope');
    return value;
  });
  if (JSON.stringify(snapshots[0]) !== JSON.stringify(snapshots[1]))
    throw new Error('Native training changed owned SQL before Save');
  const quantityTree = JSON.parse(
    readNativeEvidence(root, 'draft-preview-hierarchy.json', true).toString(),
  ) as unknown;
  const hasQuantity = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const node = value as { attributes?: Record<string, unknown>; children?: unknown[] };
    return (
      (node.attributes?.['resource-id'] === 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity' &&
        node.attributes[platform === 'ios' ? 'accessibilityText' : 'text'] === '3x8') ||
      Boolean(node.children?.some(hasQuantity))
    );
  };
  if (!hasQuantity(quantityTree))
    throw new Error('Native training quantity is absent from its exact item');
  for (const [method, route] of [
    ['POST', '/integrations/exercise/search'],
    ['GET', `/integrations/exercise/exercises/${exerciseId}`],
  ]) {
    if (
      !Array.isArray(transport) ||
      !transport.some(
        (value: Record<string, unknown>) =>
          value.method === method &&
          value.pathHash === sha(route) &&
          value.status === 200 &&
          value.outcome === 'forwarded' &&
          value.requestProfile === 'native',
      )
    )
      throw new Error('Native training lacks owned normal catalog transport');
  }
}

/** Exact per-platform checkpoints; these descriptors confer no passing or visual-review claim. */
export function nativeSavedTrainingFrameCheckpoints(platform: 'ios' | 'android') {
  assert(platform === 'ios' || platform === 'android');
  return [
    'journey-draft-preview',
    'journey-first-save-reopened',
    'journey-edit-preview',
    'journey-edited-save-reopened',
    'journey-durable-reopened',
    'journey-edit-title',
    'journey-edit-title-keyboard',
    platform === 'ios'
      ? 'journey-edit-title-paragraph-selection'
      : 'journey-edit-title-selection-menu',
    'journey-edit-title-cleared',
  ].map((label) => ({
    label,
    viewId:
      label === 'journey-edit-title'
        ? 'STATE-item-removal-confirm'
        : label === 'journey-edit-title-selection-menu'
          ? 'STATE-native-text-edit-menu'
          : 'SCR-training-builder',
  }));
}

/** Original OS result and reader bytes only; caller separately verifies source freshness and cleanup. */
export function validateAndroidSavedTrainingTitleEvidence(root: string, tree: unknown) {
  const captureRunId = path.basename(root);
  assert.match(captureRunId, /^[a-f0-9]{24}$/);
  const label = 'journey-edit-title-cleared';
  const read = (relative: string): unknown =>
    JSON.parse(readNativeEvidence(root, relative, true).toString());
  const identity = read('android-input-reader-identity.private.json') as {
    kind: string;
    captureRunId: string;
    packageName: string;
    binaryPath: string;
    binaryHash: string;
    installedBinaryHash: string;
    installedPath: string;
    disposableSigningKeyDeleted: boolean;
    setupElapsedMs: number;
    sources: { path: string; sha256: string }[];
  };
  assert.equal(identity.kind, 'read-only auxiliary Android input reader identity');
  assert.equal(identity.captureRunId, captureRunId);
  assert.equal(identity.packageName, androidInputReaderPackage);
  assert.match(identity.binaryHash, /^[a-f0-9]{64}$/);
  assert.equal(identity.installedBinaryHash, identity.binaryHash);
  assert.equal(identity.binaryPath, path.join(root, 'android-input-reader/input-reader.apk'));
  assert.equal(
    sha(readNativeEvidence(root, 'android-input-reader/input-reader.apk', true)),
    identity.binaryHash,
  );
  assert.match(identity.installedPath, /^\/data\/app\/[A-Za-z0-9_~+=/.-]+\/base\.apk$/);
  assert.equal(identity.disposableSigningKeyDeleted, true);
  assert(Number.isFinite(identity.setupElapsedMs) && identity.setupElapsedMs > 0);
  assert(Array.isArray(identity.sources) && identity.sources.length === 10);
  assert.equal(new Set(identity.sources.map((row) => row.path)).size, identity.sources.length);
  for (const row of identity.sources) {
    assert(path.isAbsolute(row.path));
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
  }
  // A missing key must be ENOENT; an inaccessible or symlinked retained key is not absence.
  assert.throws(() => lstatSync(path.join(root, 'android-input-reader/disposable-signing.p12')), {
    code: 'ENOENT',
  });
  const bindingPath = `${label}-native-input.private.json`;
  const binding = read(bindingPath) as {
    kind: string;
    readerBinaryHash: string;
    originalLogPath: string;
    observation: unknown;
  };
  assert.equal(binding.kind, 'private original Android raw input observation binding');
  assert.equal(binding.readerBinaryHash, identity.binaryHash);
  assert.equal(binding.originalLogPath, `android-input-reader-${label}-read.private.log`);
  const raw = parseAndroidNativeInputObservation(
    readNativeEvidence(root, binding.originalLogPath, true).toString(),
    captureRunId,
    label,
  );
  assert.deepEqual(
    raw,
    binding.observation,
    'Generated Android title differs from original OS result',
  );
  requireAndroidClearedTrainingTitle(tree, raw, captureRunId);
  return [
    'android-input-reader-identity.private.json',
    'android-input-reader/input-reader.apk',
    bindingPath,
    binding.originalLogPath,
  ];
}

export function validateAndroidSavedTrainingJourneyPreparation(
  root: string,
  backendRunId: string,
  metadata: unknown,
  captured: { viewId: string; screenshotPath: string; hierarchyPath: string }[],
  transport: ProxyObservation[],
) {
  return validateSavedTrainingJourneyPreparation(
    'android',
    root,
    backendRunId,
    metadata,
    captured,
    transport,
    'runtime-captured',
  );
}

/** Independent saved-journey artifact checks; caller owns behavioral/public finalization. */
export function validateIosSavedTrainingJourneyPreparation(
  root: string,
  backendRunId: string,
  metadata: unknown,
  captured: { viewId: string; screenshotPath: string; hierarchyPath: string }[],
  transport: ProxyObservation[],
  frameMode: 'reviewed-inventory' | 'runtime-captured' = 'reviewed-inventory',
) {
  return validateSavedTrainingJourneyPreparation(
    'ios',
    root,
    backendRunId,
    metadata,
    captured,
    transport,
    frameMode,
  );
}
function validateSavedTrainingJourneyPreparation(
  platform: 'ios' | 'android',
  root: string,
  backendRunId: string,
  metadata: unknown,
  captured: { viewId: string; screenshotPath: string; hierarchyPath: string }[],
  transport: ProxyObservation[],
  frameMode: 'reviewed-inventory' | 'runtime-captured',
) {
  if (!['reviewed-inventory', 'runtime-captured'].includes(frameMode))
    throw new Error('Unsupported native frame evidence mode');
  const prep = metadata as {
    input?: NativeTrainingJourneyInput;
    planId?: string;
    sixSqlCheckpoints?: boolean;
    threeAuthenticatedApiReads?: boolean;
    savedPlanDurableAfterRestart?: boolean;
    publicNativePassingCases?: number;
  } | null;
  if (
    !prep?.input ||
    prep.input.platform !== platform ||
    prep.input.runId !== backendRunId ||
    prep.sixSqlCheckpoints !== true ||
    prep.threeAuthenticatedApiReads !== true ||
    prep.savedPlanDurableAfterRestart !== true ||
    prep.publicNativePassingCases !== 0
  )
    throw new Error('Saved native journey metadata is incomplete');
  const read = (label: string): unknown =>
    JSON.parse(readNativeEvidence(root, `training-journey-${label}.private.json`, true).toString());
  const state = read('state') as NativeTrainingJourneyState;
  const result = requireNativeTrainingJourneyState(prep.input, state);
  if (result.planId !== prep.planId) throw new Error('Saved native journey identity disagrees');
  for (const [label, key] of [
    ['baseline', 'baseline'],
    ['draft', 'draft'],
    ['created', 'created'],
    ['edited-draft', 'editedDraft'],
    ['edited', 'edited'],
    ['durable', 'durable'],
  ] as const)
    if (JSON.stringify(read(label)) !== JSON.stringify(state[key]))
      throw new Error('Saved native journey checkpoint disagrees with state ledger');
  for (const key of ['created', 'edited', 'durable'] as const) {
    const api = read(`${key}-api`) as {
      verification?: {
        runId: string;
        fixtureScope: string;
        accountUid: string;
        planId: string;
        apiOrigin: string;
        apiPid: number;
      };
    };
    const binding = api.verification;
    if (
      JSON.stringify(api) !== JSON.stringify(state.apiReads[key]) ||
      !binding ||
      binding.runId !== backendRunId ||
      binding.fixtureScope !== `native-entry-${platform}` ||
      binding.accountUid !== prep.input.accountUid ||
      binding.planId !== result.planId ||
      !Number.isSafeInteger(binding.apiPid) ||
      binding.apiPid <= 0
    )
      throw new Error('Saved native API checkpoint binding disagrees');
    requireIntegratedLoopbackOrigin(binding.apiOrigin);
  }
  const frames = JSON.parse(
    readNativeEvidence(
      root,
      frameMode === 'reviewed-inventory'
        ? 'training-journey-reviewed-frames.private.json'
        : 'training-journey-runtime-frames.private.json',
      true,
    ).toString(),
  ) as ViewEvidence[];
  const title = `QA training ${prep.input.attemptId}`;
  const required = [
    ['journey-draft-preview', title, '3x8'],
    ['journey-first-save-reopened', title, '3x8'],
    ['journey-edit-preview', `${title} updated`, '4x10'],
    ['journey-edited-save-reopened', `${title} updated`, '4x10'],
    ['journey-durable-reopened', `${title} updated`, '4x10'],
    ['journey-edit-title', '', ''],
    ['journey-edit-title-keyboard', title, ''],
    [
      platform === 'ios'
        ? 'journey-edit-title-paragraph-selection'
        : 'journey-edit-title-selection-menu',
      title,
      '',
    ],
    ['journey-edit-title-cleared', '', ''],
  ];
  if (!Array.isArray(frames) || frames.length !== required.length)
    throw new Error('Saved native checkpoints are incomplete');
  for (const [label, expectedTitle, quantity] of required) {
    const viewId =
      label === 'journey-edit-title'
        ? 'STATE-item-removal-confirm'
        : label === 'journey-edit-title-selection-menu'
          ? 'STATE-native-text-edit-menu'
          : 'SCR-training-builder';
    const frame = frames.filter(
      (row) =>
        row.viewId === viewId &&
        row.screenshotPath === `${label}.png` &&
        row.hierarchyPath === `${label}-hierarchy.json`,
    );
    if (
      frame.length !== 1 ||
      !captured.some(
        (row) =>
          row.viewId === viewId &&
          row.screenshotPath === frame[0].screenshotPath &&
          row.hierarchyPath === frame[0].hierarchyPath,
      )
    )
      throw new Error('Saved native checkpoint was not actually captured');
    if (frameMode === 'reviewed-inventory') validateNativeViewFiles(root, frame, [viewId]);
    else if (platform === 'android')
      validateAndroidTrainingRuntimeFrameFiles(root, frame, [viewId]);
    else validateNativeRuntimeFrameFiles(root, frame, [viewId]);
    const tree: unknown = JSON.parse(
      readNativeEvidence(root, frame[0].hierarchyPath, true).toString(),
    );
    if (platform === 'android') {
      if (label === 'journey-edit-title') requireAndroidItemRemovalPrompt(tree);
      else if (label === 'journey-edit-title-keyboard')
        requireAndroidTrainingTitle(tree, expectedTitle);
      else if (label === 'journey-edit-title-selection-menu') requireAndroidSelectAllMenu(tree);
      else if (label === 'journey-edit-title-cleared')
        validateAndroidSavedTrainingTitleEvidence(root, tree);
      else
        requireNativeTrainingPreview(
          'android',
          tree,
          expectedTitle,
          prep.input.exerciseName,
          quantity,
        );
    } else if (label === 'journey-edit-title') requireIosItemRemovalPrompt(tree);
    else if (label === 'journey-edit-title-keyboard')
      requireIosTrainingTitleKeyboard(tree, expectedTitle);
    else if (label === 'journey-edit-title-paragraph-selection')
      requireIosTrainingTitleKeyboard(tree, expectedTitle);
    else if (label === 'journey-edit-title-cleared') requireIosClearedTrainingTitle(tree);
    else requireIosTrainingPreview(tree, expectedTitle, prep.input.exerciseName, quantity);
  }
  const plan = sha(`/plans/training/${result.planId}`);
  if (
    transport.filter(
      (row) =>
        row.pathHash === sha('/plans/training') &&
        row.method === 'POST' &&
        row.status === 201 &&
        row.outcome === 'forwarded',
    ).length !== 1 ||
    !transport.some(
      (row) =>
        row.pathHash === plan &&
        row.method === 'PATCH' &&
        row.status === 200 &&
        row.outcome === 'forwarded',
    ) ||
    transport.filter(
      (row) =>
        row.pathHash === plan &&
        row.method === 'GET' &&
        row.status === 200 &&
        row.outcome === 'forwarded',
    ).length < 3
  )
    throw new Error('Saved native app write/reopen transport is incomplete');
  if (
    transport
      .filter((row) => [plan, sha('/plans/training')].includes(row.pathHash))
      .some(
        (row) =>
          row.requestProfile !== 'native' ||
          row.requestOrigin !== null ||
          row.outcome !== 'forwarded',
      )
  )
    throw new Error('Saved native app traffic profile differs');
}

export function validateNativeViewFiles(
  root: string,
  views: ViewEvidence[],
  declaredViewIds: string[],
) {
  if (!Array.isArray(views) || views.some((row) => row.reviewed !== true))
    throw new Error('Native screenshot lacks normal-screen review');
  return validateCapturedFrameBytes(root, views, declaredViewIds);
}

/** Runtime byte/state validation confers no visual approval or inventory qualification. */
export function validateNativeRuntimeFrameFiles(
  root: string,
  views: ViewEvidence[],
  declaredViewIds: string[],
  platform: 'ios' | 'android' = 'ios',
) {
  if (!Array.isArray(views) || views.some((row) => row.reviewed !== false))
    throw new Error('Runtime frame must not claim visual review');
  return validateCapturedFrameBytes(root, views, declaredViewIds, platform);
}

/** Android training runtime frames require its observed OS caption, without granting visual review. */
export function validateAndroidTrainingRuntimeFrameFiles(
  root: string,
  views: ViewEvidence[],
  declaredViewIds: string[],
) {
  if (!Array.isArray(views) || views.some((row) => row.reviewed !== false))
    throw new Error('Runtime frame must not claim visual review');
  return validateCapturedFrameBytes(root, views, declaredViewIds, 'android');
}

function validateCapturedFrameBytes(
  root: string,
  views: ViewEvidence[],
  declaredViewIds: string[],
  platform: 'ios' | 'android' = 'ios',
) {
  if (!Array.isArray(views) || !views.length) throw new Error('Native observation has no views');
  const seen = new Set<string>();
  for (const row of views) {
    const androidTrainingSelectors: Record<string, { attribute: string; value: string }> = {
      'STATE-native-text-edit-menu': { attribute: 'text', value: 'Select all' },
      'STATE-item-removal-confirm': { attribute: 'text', value: enUS['pro.plan.delete.body'] },
    };
    const selector =
      platform === 'android'
        ? (androidTrainingSelectors[row.viewId] ?? nativeObservedSelectors[row.viewId])
        : nativeObservedSelectors[row.viewId];
    if (!declaredViewIds.includes(row.viewId) || !selector || seen.has(row.viewId))
      throw new Error('Native observation has an unmapped or duplicate view');
    seen.add(row.viewId);
    const screenshot = readNativeEvidence(root, row.screenshotPath);
    const hierarchy = readNativeEvidence(root, row.hierarchyPath, true);
    if (sha(screenshot) !== row.screenshotHash || sha(hierarchy) !== row.hierarchyHash)
      throw new Error('Native observation evidence bytes changed');
    if (
      screenshot.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      !treeHasPlatformSelector(JSON.parse(hierarchy.toString()) as unknown, selector, platform)
    )
      throw new Error('Native observation lacks PNG or exact actual-tree selector');
  }
  return [...seen];
}

function treeHasPlatformSelector(
  value: unknown,
  selector: { attribute: string; value: string },
  platform: 'ios' | 'android',
): boolean {
  return (
    treeHasSelector(value, selector) ||
    (platform === 'android' &&
      selector.attribute === 'resource-id' &&
      treeHasSelector(value, {
        attribute: 'resource-id',
        value: `com.edufelip.mychampions.dev:id/${selector.value}`,
      }))
  );
}

export function nativeViewFingerprint(
  receipt: NativeViewReceipt,
  declaration: NativeViewDeclaration,
) {
  return sha(
    JSON.stringify({
      validatorHash: sha(readFileSync(__filename)),
      androidBuildGuardHash:
        receipt.platform === 'android'
          ? sha(readFileSync(path.join(__dirname, 'android-build-identity.ts')))
          : null,
      captureHash: receipt.captureHash,
      cleanupHash: receipt.cleanupHash,
      auxiliaryEvidence: receipt.auxiliaryEvidence ?? [],
      commit: receipt.commit,
      platform: receipt.platform,
      build: receipt.build,
      device: receipt.device,
      fixtureRef: receipt.fixtureRef,
      views: receipt.viewEvidence,
      // Receipt validation checks every declared source, including sources of
      // uncaptured views. Bind that same boundary to immutable output names.
      sources: declaration.sources,
      declaredViewSources: declaration.views.map(({ id, sourceRefs }) => ({ id, sourceRefs })),
    }),
  );
}

/** Only qualifies captured views. It never produces behavioral or transition passes. */
export async function validateNativeViewReceipt(
  receipt: NativeViewReceipt,
  repositoryRoot: string,
  declaration: NativeViewDeclaration,
  reuseBuildSourceRoot?: string,
) {
  if (
    receipt.result !== 'observed' ||
    !['ios', 'android'].includes(receipt.platform) ||
    !/^[a-f0-9]{64}$/.test(receipt.build ?? '') ||
    !/^[a-f0-9]{40}$/.test(receipt.commit ?? '') ||
    !/^[a-f0-9]{64}$/.test(receipt.inputFingerprint ?? '') ||
    !receipt.device ||
    receipt.device === 'unknown' ||
    !/^\.qa\/artifacts\/native-pilot\/[a-f0-9]{24}$/.test(receipt.artifactRoot ?? '')
  )
    throw new Error('Native observation lacks exact target/artifact identity');
  const root = path.join(repositoryRoot, receipt.artifactRoot);
  const hostCensus = JSON.parse(
    readNativeEvidence(root, 'native-host-census.private.json', true).toString(),
  ) as {
    kind?: string;
    status?: string;
    callerPid?: number;
    inspectedAt?: string;
    knownJobs?: unknown[];
  };
  if (
    hostCensus.kind !== 'native-host-known-job-census' ||
    hostCensus.status !== 'no-known-job' ||
    !Number.isSafeInteger(hostCensus.callerPid) ||
    !(hostCensus.callerPid! > 1) ||
    !hostCensus.inspectedAt ||
    !Number.isFinite(Date.parse(hostCensus.inspectedAt)) ||
    !Array.isArray(hostCensus.knownJobs) ||
    hostCensus.knownJobs.length
  )
    throw new Error('Native observation lacks its pre-acquisition uncontended known-job census');
  const captureBytes = readNativeEvidence(root, 'capture.private.json', true);
  const cleanupBytes = readNativeEvidence(root, 'external-cleanup.private.json', true);
  if (sha(captureBytes) !== receipt.captureHash || sha(cleanupBytes) !== receipt.cleanupHash)
    throw new Error('Native observation capture/cleanup bytes changed');
  const capture = JSON.parse(captureBytes.toString()) as {
    kind: string;
    mode: string;
    platform: string;
    result: string;
    cleanup: string;
    startedAt: string;
    finishedAt: string;
    hostPreflight: unknown;
    charter: string;
    draftPreparation?: unknown;
    trainingJourney?: unknown;
    connectionStatePreparation?: unknown;
    cameraPreparation?: unknown;
    discardPreparation?: unknown;
    saveRetryPreparation?: unknown;
    loadPreparation?: {
      savedPlanId: string;
      accountUid: string;
      attemptId: string;
      snapshotPaths: string[];
      requirementRefs: string[];
      ownedSqlBeforeFailureRetryUnchanged: boolean;
      scope: string;
    };
    nativePassingCases: number;
    viewIds: string[];
    runtimeQualificationRejected?: boolean;
    source: Awaited<ReturnType<typeof sourceIdentity>>;
    sourceAfter: Awaited<ReturnType<typeof sourceIdentity>>;
    build: {
      binaryHash: string;
      reusedFrom: string | null;
      apiOrigin: string;
      environmentHash: string;
      binaryPath: string;
      signingCertificateHash: string;
      profile: string;
      metroOrigin: string;
    };
    device: { udid: string; serial: string };
    backend: { runId: string };
    helperInputsBefore?: unknown[];
    helperInputsAfter?: unknown[];
    observations: { viewId: string; screenshotPath: string; hierarchyPath: string }[];
  };
  if (
    JSON.stringify(capture.hostPreflight) !== JSON.stringify(hostCensus) ||
    !Number.isFinite(Date.parse(capture.startedAt)) ||
    Date.parse(hostCensus.inspectedAt) < Date.parse(capture.startedAt) ||
    Date.parse(hostCensus.inspectedAt) > Date.parse(capture.finishedAt)
  )
    throw new Error('Native host census is not bound to the capture preflight');
  if (
    !capture.helperInputsBefore?.some((value) => {
      const input = value as { path?: string; sha256?: string } | null;
      return (
        input?.path === 'scripts/testing/native-host-contention.ts' &&
        input.sha256 === sha(readFileSync(path.join(repositoryRoot, input.path)))
      );
    })
  )
    throw new Error('Native host preflight helper changed since capture');
  const cleanup = JSON.parse(cleanupBytes.toString()) as {
    result: string;
    runId: string;
    pidStartPairs: number;
    survivors: unknown[];
    unknownProcessQueries: unknown[];
    missingForeignDevices: unknown[];
    ownedDeviceAbsent: boolean;
    cacheAbsent: boolean;
    docker: Record<string, unknown[]>;
  };
  if (
    capture.kind !== 'private-native-inventory-observation-not-behavior-attempt' ||
    capture.mode !== 'inventory' ||
    capture.platform !== receipt.platform ||
    !(
      receipt.platform === 'ios'
        ? [
            'auth-account',
            'training-draft',
            'training-discard',
            'training-load',
            'training-journey',
            'save-retry',
            'connection-states',
            'camera-denied',
          ]
        : ['entry-and-login', 'training-draft', 'training-load', 'connection-states']
    ).includes(capture.charter) ||
    capture.result !== 'observed' ||
    capture.cleanup !== 'cleaned' ||
    capture.nativePassingCases !== 0 ||
    capture.runtimeQualificationRejected ||
    (receipt.platform === 'ios' ? capture.device.udid : capture.device.serial) !== receipt.device ||
    capture.build.binaryHash !== receipt.build ||
    capture.source.sha !== receipt.commit ||
    receipt.timestamp !== capture.finishedAt ||
    receipt.fixtureRef !==
      `owned-postgres:native-entry-${receipt.platform}:${capture.backend.runId}` ||
    cleanup.result !== 'passed' ||
    cleanup.runId !== path.basename(root) ||
    !(cleanup.pidStartPairs > 0) ||
    cleanup.survivors.length ||
    cleanup.unknownProcessQueries.length ||
    cleanup.missingForeignDevices.length ||
    !cleanup.ownedDeviceAbsent ||
    !cleanup.cacheAbsent ||
    !['container', 'network', 'volume'].every(
      (key) => Array.isArray(cleanup.docker[key]) && cleanup.docker[key].length === 0,
    )
  )
    throw new Error('Native observation capture scope or verified cleanup disagrees');
  const current = await (receipt.platform === 'ios' ? sourceIdentity : androidSourceIdentity)(
    repositoryRoot,
  );
  if (
    JSON.stringify(capture.source) !== JSON.stringify(current) ||
    JSON.stringify(capture.sourceAfter) !== JSON.stringify(current)
  )
    throw new Error('Native observation source identity is stale');
  if (receipt.platform === 'ios') {
    const effectiveReuseBuildSourceRoot =
      reuseBuildSourceRoot ??
      (typeof process.env.MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT === 'string'
        ? process.env.MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT
        : undefined);
    if (
      effectiveReuseBuildSourceRoot !== undefined &&
      (!path.isAbsolute(effectiveReuseBuildSourceRoot) ||
        effectiveReuseBuildSourceRoot.includes('\0'))
    )
      throw new Error('Native reuse source root must be an absolute path');
    const reused = await loadReusableIosBuild(
      repositoryRoot,
      capture.build.reusedFrom === null ? path.basename(root) : capture.build.reusedFrom,
      current,
      {
        sourceRoot: effectiveReuseBuildSourceRoot,
      },
    );
    if (
      reused.binaryHash !== capture.build.binaryHash ||
      reused.apiOrigin !== capture.build.apiOrigin ||
      reused.environmentHash !== capture.build.environmentHash
    )
      throw new Error('Native capture build/environment differs from qualified immutable bytes');
  } else {
    if (
      !/^emulator-\d+$/.test(receipt.device) ||
      capture.build.profile !==
        'Metro-attached devDebug arm64; no instrumentation; not bundled release qualification' ||
      !Array.isArray(capture.helperInputsBefore) ||
      !capture.helperInputsBefore.length ||
      JSON.stringify(capture.helperInputsBefore) !== JSON.stringify(capture.helperInputsAfter)
    )
      throw new Error('Android observation lacks a consistent captured build/runner boundary');
    const expectedBinary = path.join(
      root,
      'android-app-build/outputs/apk/dev/debug/app-dev-debug.apk',
    );
    if (capture.build.binaryPath !== expectedBinary)
      throw new Error('Android observation references an unexpected APK');
    const inspected = await inspectOwnedAndroidApk({
      binaryPath: expectedBinary,
      artifactRoot: root,
      sdkRoot: '/Users/eduwaldo/Library/Android/sdk',
      apiOrigin: capture.build.apiOrigin,
      writeReceipt: false,
    });
    const installedPath = path.join(root, 'installed-base.apk');
    const installedMeta = lstatSync(installedPath);
    if (
      !installedMeta.isFile() ||
      realpathSync(installedPath) !== installedPath ||
      installedMeta.uid !== process.getuid?.() ||
      (installedMeta.mode & 0o777) !== 0o600 ||
      sha(readFileSync(installedPath)) !== inspected.binaryHash ||
      inspected.binaryHash !== capture.build.binaryHash ||
      inspected.environmentHash !== capture.build.environmentHash ||
      inspected.signingCertificateHash !== capture.build.signingCertificateHash
    )
      throw new Error('Android observation build, installed bytes or environment changed');
  }
  if (
    receipt.platform === 'android' ||
    [
      'training-draft',
      'training-discard',
      'training-load',
      'training-journey',
      'save-retry',
      'connection-states',
      'camera-denied',
    ].includes(capture.charter)
  ) {
    const transport = JSON.parse(
      readNativeEvidence(root, 'transport-observations.private.json', true).toString(),
    ) as ProxyObservation[];
    if (
      !Array.isArray(transport) ||
      !transport.some(
        (row) =>
          row.method === 'POST' &&
          row.pathHash === sha('/auth/email/sign-in') &&
          row.status === 201 &&
          row.outcome === 'forwarded' &&
          row.requestProfile === 'native',
      )
    )
      throw new Error('Native observation lacks owned normal sign-in transport');
    if (
      [
        'training-draft',
        'training-discard',
        'training-load',
        'training-journey',
        'save-retry',
        'connection-states',
        'camera-denied',
      ].includes(capture.charter)
    ) {
      if (
        !Array.isArray(capture.helperInputsBefore) ||
        !capture.helperInputsBefore.length ||
        JSON.stringify(capture.helperInputsBefore) !== JSON.stringify(capture.helperInputsAfter)
      )
        throw new Error('Native preparation observation lacks unchanged helper inputs');
    }
    if (capture.charter === 'camera-denied') {
      if (receipt.platform !== 'ios')
        throw new Error('Android camera observation is not qualified');
      if (
        !capture.helperInputsBefore?.some((value) => {
          const input = value as { path?: string; sha256?: string } | null;
          return (
            input?.path === 'scripts/testing/native-camera-observation.ts' &&
            input.sha256 === sha(readFileSync(path.join(repositoryRoot, input.path)))
          );
        })
      )
        throw new Error('Camera observation helper changed since the capture');
      validateIosCameraPreparation(
        root,
        capture.backend.runId,
        capture.device.udid,
        capture.cameraPreparation,
        transport,
      );
      if (
        ![
          ['entry', 'SCR-sign-in'],
          ['password-save-prompt', 'STATE-password-save'],
          ['camera-student-home', 'SCR-student-home'],
          ['camera-prompt', 'STATE-camera-prompt'],
          ['camera-guidance', 'STATE-camera-guidance'],
          ['camera-manual', 'SCR-student-professionals'],
        ].every(([label, viewId]) =>
          receipt.viewEvidence.some(
            (view) =>
              view.viewId === viewId &&
              view.hierarchyPath ===
                (label === 'entry' ? 'entry-hierarchy.json' : `${label}-hierarchy.json`) &&
              view.screenshotPath === `${label}.png`,
          ),
        )
      )
        throw new Error(
          'Native camera observation lacks reviewed prompt, denial and manual frames',
        );
    }
    if (capture.charter === 'connection-states') {
      validateNativeConnectionStatePreparation(
        root,
        receipt.platform as 'ios' | 'android',
        capture.backend.runId,
        capture.connectionStatePreparation,
        transport,
      );
      const requiredViews = [
        'SCR-sign-in',
        'SCR-pro-home',
        'SCR-pro-pending',
        'SCR-pro-roster',
        'SCR-student-home',
        'SCR-student-professionals',
        'STATE-connection-pending',
        'STATE-connection-active',
      ];
      if (
        !requiredViews.every((id) => receipt.viewEvidence.some((view) => view.viewId === id)) ||
        ![
          ['coach-pending', 'SCR-pro-pending'],
          ['coach-roster', 'SCR-pro-roster'],
          ['student-pending', 'STATE-connection-pending'],
          ['student-active', 'STATE-connection-active'],
        ].every(([label, viewId]) =>
          receipt.viewEvidence.some(
            (view) =>
              view.viewId === viewId &&
              view.hierarchyPath === `${label}-hierarchy.json` &&
              view.screenshotPath === `${label}.png`,
          ),
        )
      )
        throw new Error('Native connection observation lacks required reviewed state views');
    }
    if (['training-draft', 'training-discard', 'save-retry'].includes(capture.charter)) {
      validateNativeTrainingPreparation(
        root,
        receipt.platform as 'ios' | 'android',
        capture.backend.runId,
        capture.draftPreparation,
        transport,
      );
      const requiredViews = [
        'SCR-sign-in',
        'SCR-pro-home',
        'SCR-training-library',
        'SCR-training-builder',
        'STATE-session-editor',
        'STATE-exercise-search',
        'STATE-exercise-detail',
      ];
      if (
        !requiredViews.every((id) => receipt.viewEvidence.some((view) => view.viewId === id)) ||
        !receipt.viewEvidence.some(
          (view) =>
            view.viewId === 'SCR-training-builder' &&
            view.hierarchyPath === 'draft-preview-hierarchy.json' &&
            view.screenshotPath === 'draft-preview.png',
        )
      )
        throw new Error('Native training observation lacks its reviewed draft and required views');
    }
    if (capture.charter === 'save-retry') {
      if (
        !capture.helperInputsBefore?.some((value) => {
          const input = value as { path?: string; sha256?: string } | null;
          return (
            input?.path === 'scripts/testing/native-save-retry-observation.ts' &&
            input.sha256 === sha(readFileSync(path.join(repositoryRoot, input.path)))
          );
        })
      )
        throw new Error('Native save/retry helper changed since capture');
      validateNativeSaveRetryPreparation(
        root,
        receipt.platform as 'ios' | 'android',
        capture.backend.runId,
        capture.saveRetryPreparation,
        transport,
      );
      if (
        !receipt.viewEvidence.some(
          (view) =>
            view.viewId === 'STATE-training-save-error' &&
            view.screenshotPath === 'save-error.png' &&
            view.hierarchyPath === 'save-error-hierarchy.json',
        )
      )
        throw new Error('Native save/retry observation lacks its reviewed error frame');
      const extra = JSON.parse(
        readNativeEvidence(root, 'save-retry-reviewed-frames.private.json', true).toString(),
      ) as ViewEvidence[];
      if (
        !extra.every((row) =>
          capture.observations.some(
            (frame) =>
              frame.viewId === row.viewId &&
              frame.hierarchyPath === row.hierarchyPath &&
              frame.screenshotPath === row.screenshotPath,
          ),
        )
      )
        throw new Error('Native save/retry auxiliary frame was not captured');
    }
    if (capture.charter === 'training-journey') {
      if (receipt.platform !== 'ios')
        throw new Error('Saved native journey has no Android binding');
      for (const file of [
        'native-training-maestro-driver.ts',
        'native-training-journey.ts',
        'native-training-edit-observation.ts',
        'owned-api-proxy.ts',
      ]) {
        if (
          !capture.helperInputsBefore?.some((value) => {
            const input = value as { path?: string; sha256?: string };
            const wanted = `scripts/testing/${file}`;
            return (
              input.path === wanted &&
              input.sha256 === sha(readFileSync(path.join(repositoryRoot, wanted)))
            );
          })
        )
          throw new Error('Saved native journey helper changed since capture');
      }
      validateIosSavedTrainingJourneyPreparation(
        root,
        capture.backend.runId,
        capture.trainingJourney,
        capture.observations,
        transport,
      );
    }
    if (capture.charter === 'training-load') {
      const prep = capture.loadPreparation;
      if (
        !prep ||
        prep.scope !== 'native-initial-load-error-and-retry-views-only; no behavior pass' ||
        prep.ownedSqlBeforeFailureRetryUnchanged !== true ||
        JSON.stringify(prep.snapshotPaths) !== JSON.stringify(nativeLoadSnapshotPaths) ||
        !prep.requirementRefs.includes('SC-208')
      )
        throw new Error('Native initial-load preparation is absent or invalid');
      if (
        !capture.helperInputsBefore?.some((value) => {
          const input = value as { path?: string; sha256?: string } | null;
          return (
            input?.path === 'scripts/testing/native-training-load-observation.ts' &&
            input.sha256 === sha(readFileSync(path.join(repositoryRoot, input.path)))
          );
        })
      )
        throw new Error('Native initial-load helper changed since capture');
      requireNativeLoadObservation({
        platform: receipt.platform === 'ios' ? 'ios' : 'android',
        backendRunId: capture.backend.runId,
        savedPlanId: prep.savedPlanId,
        accountUid: prep.accountUid,
        attemptId: prep.attemptId,
        snapshots: nativeLoadSnapshotPaths.map(
          (file) =>
            JSON.parse(readNativeEvidence(root, file, true).toString()) as OwnedDomainSnapshot,
        ),
        errorTree: JSON.parse(
          readNativeEvidence(root, 'load-error-hierarchy.json', true).toString(),
        ),
        recoveredTree: JSON.parse(
          readNativeEvidence(root, 'load-recovered-hierarchy.json', true).toString(),
        ),
        transport,
      });
      if (receipt.platform === 'android') {
        validateAndroidRecoveredQuantityPreparation(root, prep, capture.observations);
      }
      for (const [viewId, label] of [
        ['STATE-training-load-error', 'load-error'],
        ['SCR-training-builder', 'load-recovered'],
      ])
        if (
          !receipt.viewEvidence.some(
            (row) =>
              row.viewId === viewId &&
              row.screenshotPath === `${label}.png` &&
              row.hierarchyPath === `${label}-hierarchy.json`,
          ) ||
          !capture.observations.some(
            (row) =>
              row.viewId === viewId &&
              row.screenshotPath === `${label}.png` &&
              row.hierarchyPath === `${label}-hierarchy.json`,
          )
        )
          throw new Error(
            'Native initial-load observation lacks its reviewed error/recovered frames',
          );
    }
    if (capture.charter === 'training-discard') {
      if (receipt.platform !== 'ios')
        throw new Error('Android discard observation is not qualified');
      if (
        !capture.helperInputsBefore?.some((value) => {
          const input = value as { path?: string; sha256?: string } | null;
          return (
            input?.path === 'scripts/testing/native-training-discard-observation.ts' &&
            input.sha256 === sha(readFileSync(path.join(repositoryRoot, input.path)))
          );
        })
      )
        throw new Error('Native discard helper changed since capture');
      validateIosTrainingDiscardPreparation(
        root,
        capture.backend.runId,
        capture.discardPreparation,
        transport,
      );
      if (
        !receipt.viewEvidence.some(
          (view) =>
            view.viewId === 'STATE-discard-confirm' &&
            view.screenshotPath === 'discard-prompt.png' &&
            view.hierarchyPath === 'discard-prompt-hierarchy.json',
        )
      )
        throw new Error('Native discard observation lacks its reviewed native prompt');
      const extra = JSON.parse(
        readNativeEvidence(root, 'discard-reviewed-frames.private.json', true).toString(),
      ) as ViewEvidence[];
      if (
        !extra.every((row) =>
          capture.observations.some(
            (frame) =>
              frame.viewId === row.viewId &&
              frame.hierarchyPath === row.hierarchyPath &&
              frame.screenshotPath === row.screenshotPath,
          ),
        )
      )
        throw new Error('Native discard auxiliary frame was not captured');
    }
  }
  if (
    capture.charter !== 'training-load' &&
    receipt.viewEvidence.some((row) => row.viewId === 'STATE-training-load-error')
  )
    throw new Error('Native load error requires its preparation charter');
  if (
    capture.charter !== 'connection-states' &&
    receipt.viewEvidence.some((view) =>
      ['STATE-connection-pending', 'STATE-connection-active'].includes(view.viewId),
    )
  )
    throw new Error('Native connection state view requires its preparation charter');
  if (
    capture.charter !== 'camera-denied' &&
    receipt.viewEvidence.some((view) =>
      ['STATE-camera-prompt', 'STATE-camera-guidance'].includes(view.viewId),
    )
  )
    throw new Error('Native camera state view requires its OS-denial preparation charter');
  if (
    capture.charter !== 'save-retry' &&
    receipt.viewEvidence.some((view) => view.viewId === 'STATE-training-save-error')
  )
    throw new Error('Native save error view requires its preparation charter');
  assertNativeBootstrapHealthy(readNativeEvidence(root, 'bootstrap.private.log', true).toString());
  if (
    capture.charter !== 'training-discard' &&
    receipt.viewEvidence.some((row) => row.viewId === 'STATE-discard-confirm')
  )
    throw new Error('Native discard view requires its preparation charter');
  const requiredAuxiliary = nativeAuxiliaryEvidencePaths(receipt.platform, capture.charter);
  if (
    JSON.stringify(receipt.auxiliaryEvidence?.map((row) => row.path).sort()) !==
      JSON.stringify([...requiredAuxiliary].sort()) ||
    !receipt.auxiliaryEvidence?.every(
      (row) => sha(readNativeEvidence(root, row.path, !row.path.endsWith('.png'))) === row.sha256,
    )
  )
    throw new Error('Native observation auxiliary evidence changed or is missing');
  const views = validateNativeViewFiles(
    root,
    receipt.viewEvidence,
    declaration.views.map((row) => row.id),
  );
  for (const row of receipt.viewEvidence) {
    const recorded =
      row.viewId === 'SCR-sign-in' &&
      row.screenshotPath === 'entry.png' &&
      row.hierarchyPath === 'entry-hierarchy.private.log'
        ? capture.viewIds.includes(row.viewId)
        : capture.observations.some(
            (frame) =>
              frame.viewId === row.viewId &&
              frame.screenshotPath === row.screenshotPath &&
              frame.hierarchyPath === row.hierarchyPath,
          );
    if (!recorded) throw new Error('Native view evidence was not recorded by the capture');
  }
  for (const source of declaration.sources) {
    if (
      source.paths.length !== 1 ||
      sha(readFileSync(path.join(repositoryRoot, source.paths[0]))) !== source.revision
    )
      throw new Error('Native declaration source revisions are stale');
  }
  const expectedPaths = [
    'capture.private.json',
    'external-cleanup.private.json',
    'bootstrap.private.log',
    ...requiredAuxiliary.filter((name) => name !== 'bootstrap.private.log'),
    ...receipt.viewEvidence.flatMap((row) => [row.screenshotPath, row.hierarchyPath]),
  ];
  if (
    JSON.stringify([...receipt.evidencePaths].sort()) !==
      JSON.stringify([...expectedPaths].sort()) ||
    nativeViewFingerprint(receipt, declaration) !== receipt.inputFingerprint
  )
    throw new Error('Native observation evidence index or input fingerprint disagrees');
  return views;
}

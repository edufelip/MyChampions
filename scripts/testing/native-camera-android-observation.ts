import assert from 'node:assert/strict';
import path from 'node:path';
import {
  parseNativeLocaleEvidence,
  qualifyNativeLocaleEvidence,
} from './locale-native-observation';
import {
  readOwnedAndroidBoundedFile,
  type AndroidStorageFileReceipt,
} from './native-android-session-adapter';
import {
  ANDROID_CAMERA_APP_ID,
  ANDROID_CAMERA_ASSERTION_IDS,
  ANDROID_CAMERA_SCENARIO,
  ANDROID_CAMERA_PERMISSION_DENY_RESOURCE,
  ANDROID_CAMERA_PERMISSION_MESSAGE_RESOURCE,
  ANDROID_CAMERA_SYSTEM_PACKAGES,
  type AndroidCameraSystemPackage,
  androidCameraPermissionResourceId,
  isAndroidCameraSystemPackage,
  type AndroidCameraFrameSource,
  type AndroidCameraRuntimeIdentity,
  blockedCameraGate,
  sha256,
} from './native-camera-android-contract';
import {
  readVerifiedAndroidCameraSqlParent,
  type RetainedParentEvidence,
  type SourceEvidence,
  type VerifiedParent,
} from './native-camera-android-sql-source';
import {
  assertCameraDomainConnectionBindings,
  assertCameraNonConnectionStateUnchanged,
} from './native-camera-submission-evidence';
import {
  requireConnectionSnapshot,
  verifyConnectionSnapshotPhaseTransition,
  type ConnectionSnapshotExpectedIdentity,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import {
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotArguments,
  type NativePilotSelection,
} from './native-pilot-contract';
import type { NativeLocaleBinding, NativeLocaleEvidence } from './locale-native-observation';
import type { NativeRequestBodyCaptureReceipt, ProxyObservation } from './owned-api-proxy';
import type { OwnedFixtures, OwnedSnapshotReceipt } from './owned-session';

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const SERIAL = /^emulator-[0-9]+$/u;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;
const POST_PATH = '/connections/invite-submissions';
const ANALYTICS_PATH = '/analytics/events';

type AndroidCameraDomainSnapshot = Record<string, unknown> & {
  connections: unknown;
};

function requireAndroidCameraDomainSnapshot(
  value: unknown,
  label: string,
): AndroidCameraDomainSnapshot {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    `${label} is not a domain snapshot object`,
  );
  const snapshot = value as Record<string, unknown>;
  assert(
    Array.isArray(snapshot.connections),
    `${label} lacks its complete embedded connection projection`,
  );
  return snapshot as AndroidCameraDomainSnapshot;
}

/**
 * Keep the expected target connection transition separate from the complete
 * unrelated-state comparison. The shared camera oracle binds every embedded
 * domain connection to the SQL before/pending snapshots, so a foreign row can
 * never be hidden by projecting the connection array away.
 */
export function requireAndroidCameraTrainingTransition(input: {
  beforeDomain: unknown;
  afterDomain: unknown;
  beforeConnection: OwnedConnectionSnapshot;
  pendingConnection: OwnedConnectionSnapshot;
  inviteCode: string;
}): void {
  assert(
    typeof input.inviteCode === 'string' && input.inviteCode.length > 0,
    'Android camera live invite code is missing',
  );
  const beforeDomain = requireAndroidCameraDomainSnapshot(
    input.beforeDomain,
    'Android camera training-before domain snapshot',
  );
  const afterDomain = requireAndroidCameraDomainSnapshot(
    input.afterDomain,
    'Android camera training-after domain snapshot',
  );
  assertCameraDomainConnectionBindings({
    beforeDomain,
    afterDomain,
    beforeConnection: input.beforeConnection,
    afterConnection: input.pendingConnection,
    target: input.pendingConnection.target,
    inviteCode: input.inviteCode,
  });
  assertCameraNonConnectionStateUnchanged(
    beforeDomain,
    afterDomain,
    'Android camera changed unrelated training state',
  );
}

export const ANDROID_CAMERA_SQL_TABLES = [
  'userProfiles',
  'professionalSpecialties',
  'inviteCodes',
  'connections',
  'connectionInviteGuards',
  'pendingStudents',
  'pendingStudentSlots',
  'trackingAccess',
  'activeSpecialties',
] as const;

export type AndroidCameraSqlReceiptPhase =
  | 'before'
  | 'pending'
  | 'isolation-before'
  | 'isolation-after'
  | 'training-before'
  | 'training-after';

export type AndroidCameraSqlSourceReceipt = AndroidStorageFileReceipt & {
  phase: AndroidCameraSqlReceiptPhase;
  scope: string;
  table: (typeof ANDROID_CAMERA_SQL_TABLES)[number] | 'domain';
  queryId: string;
  parentSnapshotRoot: string;
  parentManifestPath: 'manifest.json';
  parentManifestRetainedPath: string;
  parentManifestRetainedKind: 'sidecar';
  parentManifestRetainedSha256: string;
  parentManifestRetainedSizeBytes: number;
  parentManifestRetainedOwnerUid: number;
  parentManifestRetainedMode: number;
  parentManifestRetainedVerification: 'owned-stable-reader-v6';
  parentManifestSizeBytes: number;
  parentSnapshotPath: string;
  parentSnapshotSha256: string;
  parentSnapshotRetainedPath: string;
  parentSnapshotRetainedKind: 'sidecar';
  parentSnapshotRetainedSha256: string;
  parentSnapshotRetainedSizeBytes: number;
  parentSnapshotRetainedOwnerUid: number;
  parentSnapshotRetainedMode: number;
  parentSnapshotRetainedVerification: 'owned-stable-reader-v6';
  parentSnapshotSchema: 'connection-snapshot-v1' | 'domain-snapshot-v1';
  parentSnapshotKind: 'connection' | 'domain';
  parentSnapshotSizeBytes: number;
  parentSnapshotOwnerUid: number;
  parentSnapshotMode: number;
  parentSnapshotVerification: 'owned-runtime-document-v6';
  parentRunId: string;
  parentScope: string;
  parentApiOrigin: string;
  parentApiPid: number;
  parentApiStarted: string;
  parentApiScript: string;
  parentBackendAttemptId: string;
  parentManifestSha256: string;
  parentApiAttempt: string;
  parentApiLedgerSha256: string;
  parentApiLedgerPath: string;
  parentApiLedgerRetainedPath: string;
  parentApiLedgerRetainedKind: 'sidecar';
  parentApiLedgerRetainedSha256: string;
  parentApiLedgerRetainedSizeBytes: number;
  parentApiLedgerRetainedOwnerUid: number;
  parentApiLedgerRetainedMode: number;
  parentApiLedgerRetainedVerification: 'owned-stable-reader-v6';
  parentApiLedgerSizeBytes: number;
  parentFixtureAuthUidAllowlistHash: string;
  sourceProjection:
    'owned-session.connection-snapshot-v1.rows' | 'owned-session.domain-snapshot-v1.document';
};

const CAMERA_DENIAL_GUIDANCE = Object.freeze({
  'en-US':
    'Camera access is required to scan a QR code. Grant permission in your device settings, or type the code manually.',
  'pt-BR':
    'O acesso à câmera é necessário para escanear um QR code. Conceda a permissão nas configurações do dispositivo ou insira o código manualmente.',
  'es-ES':
    'Se necesita acceso a la cámara para escanear un código QR. Concede el permiso en los ajustes del dispositivo o introduce el código manualmente.',
} as const);

const PENDING_GUIDANCE = Object.freeze({
  'en-US': 'Waiting for professional confirmation to activate this connection.',
  'pt-BR': 'Aguardando a confirmação do profissional para ativar esta conexão.',
  'es-ES': 'Esperando la confirmación del profesional para activar esta conexión.',
} as const);

type AndroidCameraLocale = keyof typeof CAMERA_DENIAL_GUIDANCE;

type NodeRecord = { attributes: Record<string, unknown>; children: unknown[] };

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function node(value: unknown, label: string): NodeRecord {
  const row = record(value, label);
  const attributes = record(row.attributes, `${label}.attributes`);
  const children = row.children === undefined ? [] : row.children;
  assert(Array.isArray(children), `${label}.children must be an array`);
  return { attributes, children };
}

function walk(value: unknown, path = 'root'): { path: string; node: NodeRecord }[] {
  const current = node(value, `hierarchy ${path}`);
  const rows = [{ path, node: current }];
  current.children.forEach((child, index) => rows.push(...walk(child, `${path}/${index}`)));
  return rows;
}

function atPath(value: unknown, expectedPath: string): NodeRecord {
  let current: unknown = value;
  if (expectedPath !== 'root') {
    const parts = expectedPath.split('/');
    assert.equal(parts.shift(), 'root');
    for (const part of parts) {
      assert(current && typeof current === 'object' && !Array.isArray(current));
      const children = (current as Record<string, unknown>).children;
      assert(Array.isArray(children), `hierarchy ${expectedPath} children are missing`);
      current = children[Number(part)];
      assert(current !== undefined, `hierarchy path ${expectedPath} is absent`);
    }
  }
  return node(current, `hierarchy ${expectedPath}`);
}

function descendants(value: unknown): { path: string; node: NodeRecord }[] {
  return walk(value).slice(1);
}

function requireHash(value: unknown, label: string): string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is invalid`);
  return value;
}

function requireRun(value: unknown, label: string): string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
  return value;
}

function attrText(value: NodeRecord): string[] {
  return ['text', 'accessibilityText', 'content-desc']
    .map((key) => value.attributes[key])
    .filter((item): item is string => typeof item === 'string');
}

function hasAttr(value: NodeRecord, key: string, expected: string): boolean {
  return value.attributes[key] === expected;
}

function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

function hasPositiveBounds(value: NodeRecord): boolean {
  const bounds = value.attributes.bounds;
  const match =
    typeof bounds === 'string' && /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/u.exec(bounds);
  if (!match) return false;
  const coordinates = match.slice(1).map(Number);
  return (
    coordinates.every(Number.isSafeInteger) &&
    coordinates[2] > coordinates[0] &&
    coordinates[3] > coordinates[1]
  );
}

function isVisibleAndEnabled(value: NodeRecord): boolean {
  const visible =
    value.attributes.visible === undefined
      ? hasPositiveBounds(value)
      : isTrue(value.attributes.visible);
  return visible && isTrue(value.attributes.enabled) && hasPositiveBounds(value);
}

function packageRows(tree: unknown, packageName: string): { path: string; node: NodeRecord }[] {
  return walk(tree).filter(({ node: current }) =>
    isAndroidCameraSystemPackage(packageName)
      ? permissionControllerPackage(current) === packageName
      : current.attributes.package === packageName,
  );
}

export type AndroidCameraAppRoot = { path: string; node: NodeRecord };

function appScopedRows(
  tree: unknown,
  appId: string,
): { root: AndroidCameraAppRoot; rows: { path: string; node: NodeRecord }[] } {
  assert.equal(appId, ANDROID_CAMERA_APP_ID, 'Android camera app identity is not build-bound');
  const resourceId = `${appId}:id/action_bar_root`;
  const roots = walk(tree).filter(
    ({ node: current }) => current.attributes['resource-id'] === resourceId,
  );
  assert.equal(roots.length, 1, 'Android camera app-qualified root is missing or duplicated');
  const root = roots[0];
  const declaredPackage = root.node.attributes.package;
  assert(
    declaredPackage === undefined || declaredPackage === appId,
    'Android camera app-qualified root belongs to a foreign package',
  );
  assert(
    isVisibleAndEnabled(root.node),
    'Android camera app-qualified root is not visible and enabled',
  );
  const rows = [
    root,
    ...descendants(root.node).map(({ path: childPath, node: child }) => ({
      path: `${root.path}/${childPath.slice('root/'.length)}`,
      node: child,
    })),
  ];
  assert(
    rows.every(({ node: current }) => {
      const declaredPackage = current.attributes.package;
      return declaredPackage === undefined || declaredPackage === appId;
    }),
    'Android camera app subtree contains a foreign package node',
  );
  return { root, rows };
}

export function requireAndroidCameraAppRoot(input: {
  tree: unknown;
  appId: string;
}): AndroidCameraAppRoot {
  return appScopedRows(input.tree, input.appId).root;
}

export type AndroidCameraPromptSelector = {
  attribute: 'text' | 'resource-id' | 'accessibilityText' | 'content-desc';
  value: string;
  path: string;
};

export type AndroidCameraPromptQualification = {
  systemPackage: AndroidCameraSystemPackage;
  appId: string;
  appLabelSha256: string;
  hierarchySha256: string;
  promptRootPath: string;
  title: AndroidCameraPromptSelector;
  deny: AndroidCameraPromptSelector;
  actionability: 'supported-maestro-selector' | 'blocked-observed-accessibility-selector';
};

const CAMERA_PROMPT_TITLE_BY_LOCALE = {
  'en-US': /^Allow\s+(.+?)\s+to take pictures and record video\?$/u,
  'pt-BR': /^Permitir que o app\s+(.+?)\s+tire fotos e grave vídeos\?$/u,
  'es-ES': /^¿Permitir que\s+(.+?)\s+haga fotos y grabe vídeos\?$/u,
} as const;
const CAMERA_DENY_TEXT_BY_LOCALE = {
  'en-US': /^(?:Don't allow|Don’t allow)$/u,
  'pt-BR': /^Não permitir$/u,
  'es-ES': /^No permitir$/u,
} as const;

function permissionControllerPackage(value: NodeRecord): AndroidCameraSystemPackage | null {
  const resource = value.attributes['resource-id'];
  const resourcePackage =
    typeof resource === 'string'
      ? /^(com\.android\.permissioncontroller|com\.google\.android\.permissioncontroller):id\//u.exec(
          resource,
        )?.[1]
      : undefined;
  const declared = value.attributes.package;
  if (declared !== undefined && !isAndroidCameraSystemPackage(declared)) return null;
  if (resourcePackage && declared !== undefined && declared !== resourcePackage) return null;
  if (resourcePackage && isAndroidCameraSystemPackage(resourcePackage)) return resourcePackage;
  return isAndroidCameraSystemPackage(declared) ? declared : null;
}

function hasPromptBounds(value: NodeRecord): boolean {
  const bounds = value.attributes.bounds;
  const match =
    typeof bounds === 'string' && /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/u.exec(bounds);
  return Boolean(
    match && Number(match[3]) > Number(match[1]) && Number(match[4]) > Number(match[2]),
  );
}

function isPromptVisibleAndEnabled(value: NodeRecord, requireClickable = false): boolean {
  const visible =
    value.attributes.visible === undefined
      ? hasPromptBounds(value)
      : isTrue(value.attributes.visible);
  const enabled = isTrue(value.attributes.enabled);
  const clickable = isTrue(value.attributes.clickable);
  return visible && enabled && (!requireClickable || clickable);
}

function parsePromptAppLabel(value: string, locale: string): string | null {
  const pattern =
    CAMERA_PROMPT_TITLE_BY_LOCALE[locale as keyof typeof CAMERA_PROMPT_TITLE_BY_LOCALE];
  if (!pattern) return null;
  const match = pattern.exec(value);
  const label = match?.[1]?.replace(/\s+/gu, ' ').trim();
  return label && label.length <= 128 ? label : null;
}

/** Qualify the actual permission-controller subtree, not arbitrary text anywhere in the tree. */
export function qualifyAndroidCameraPrompt(input: {
  tree: unknown;
  hierarchySha256: string;
  promptRootPath: string;
  appId: string;
  appLabel: string;
  expectedLocale: 'en-US' | 'pt-BR' | 'es-ES';
  systemPackage: AndroidCameraSystemPackage;
  title: AndroidCameraPromptSelector;
  deny: AndroidCameraPromptSelector;
}): AndroidCameraPromptQualification {
  const root = atPath(input.tree, input.promptRootPath);
  assert.equal(
    permissionControllerPackage(root),
    input.systemPackage,
    'camera prompt root is not the declared permission controller',
  );
  assert(
    isPromptVisibleAndEnabled(root),
    'camera permission controller subtree is not visible and enabled',
  );
  const rootDescendants = [
    { path: input.promptRootPath, node: root },
    ...descendants(root).map(({ path: childPath, node: child }) => ({
      path: `${input.promptRootPath}/${childPath.slice('root/'.length)}`,
      node: child,
    })),
  ];
  const expectedTitleResource = androidCameraPermissionResourceId(
    input.systemPackage,
    ANDROID_CAMERA_PERMISSION_MESSAGE_RESOURCE,
  );
  const expectedDenyResource = androidCameraPermissionResourceId(
    input.systemPackage,
    ANDROID_CAMERA_PERMISSION_DENY_RESOURCE,
  );
  assert.equal(input.title.attribute, 'resource-id');
  assert.equal(input.title.value, expectedTitleResource);
  assert.equal(input.deny.attribute, 'resource-id');
  assert.equal(input.deny.value, expectedDenyResource);
  const titleRows = rootDescendants.filter(
    ({ node: current }) =>
      permissionControllerPackage(current) === input.systemPackage &&
      hasAttr(current, 'resource-id', expectedTitleResource),
  );
  const denyRows = rootDescendants.filter(
    ({ node: current }) =>
      permissionControllerPackage(current) === input.systemPackage &&
      hasAttr(current, 'resource-id', expectedDenyResource),
  );
  assert.equal(titleRows.length, 1, 'camera prompt title is missing or duplicated');
  assert.equal(denyRows.length, 1, 'camera deny control is missing or duplicated');
  const title = titleRows[0];
  const deny = denyRows[0];
  assert.equal(title.path, input.title.path);
  assert.equal(deny.path, input.deny.path);
  assert(isPromptVisibleAndEnabled(title.node), 'camera prompt title is not visible and enabled');
  assert(
    isPromptVisibleAndEnabled(deny.node, true),
    'camera deny control is not visible, enabled, and clickable',
  );
  const titlePattern = CAMERA_PROMPT_TITLE_BY_LOCALE[input.expectedLocale];
  const titleText = attrText(title.node).find((value) => titlePattern.test(value));
  assert(titleText, 'camera prompt title text is not the supported Android locale contract');
  assert.equal(
    parsePromptAppLabel(titleText, input.expectedLocale),
    input.appLabel,
    'camera prompt app label does not match the build-bound label',
  );
  const denyPattern = CAMERA_DENY_TEXT_BY_LOCALE[input.expectedLocale];
  assert(
    attrText(deny.node).some((value) => denyPattern.test(value)),
    'camera denial text is not the supported Android locale contract',
  );
  const actionability = 'supported-maestro-selector' as const;
  return {
    systemPackage: input.systemPackage,
    appId: input.appId,
    appLabelSha256: sha256(input.appLabel),
    hierarchySha256: requireHash(input.hierarchySha256, 'camera prompt hierarchy hash'),
    promptRootPath: input.promptRootPath,
    title: structuredClone(input.title),
    deny: structuredClone(input.deny),
    actionability,
  };
}

/** The observed selector attribute is preserved; unsupported accessibility selectors block. */
export function buildAndroidCameraPermissionDenyAction(
  prompt: AndroidCameraPromptQualification,
): string {
  if (prompt.actionability !== 'supported-maestro-selector')
    throw new Error(
      'Observed Android camera deny selector is not supported by the pinned Maestro schema',
    );
  const key = prompt.deny.attribute === 'resource-id' ? 'id' : 'text';
  return `- tapOn:\n    ${key}: ${JSON.stringify(prompt.deny.value)}\n`;
}

export function requireAndroidCameraPromptDismissed(input: {
  treeAfterDenial: unknown;
  appId: string;
  guidanceResourceId: string;
  expectedLocale: AndroidCameraLocale;
}): { guidancePath: string } {
  assert(
    ANDROID_CAMERA_SYSTEM_PACKAGES.every(
      (systemPackage) => packageRows(input.treeAfterDenial, systemPackage).length === 0,
    ),
    'camera permission prompt remains after denial',
  );
  const { rows: appRows } = appScopedRows(input.treeAfterDenial, input.appId);
  const rows = appRows.filter(
    ({ node: current }) =>
      current.attributes['resource-id'] === input.guidanceResourceId &&
      attrText(current).includes(CAMERA_DENIAL_GUIDANCE[input.expectedLocale]) &&
      isVisibleAndEnabled(current),
  );
  assert.equal(rows.length, 1, 'Android camera denial guidance is absent or duplicated');
  return { guidancePath: rows[0].path };
}

export function requireAndroidCameraManualEntry(input: {
  tree: unknown;
  appId: string;
  manualCodeSha256: string;
  codeInputId: string;
  connectButtonId: string;
  qrModalId: string;
}): { codeInputPath: string; connectButtonPath: string } {
  const { rows: appRows } = appScopedRows(input.tree, input.appId);
  const inputRows = appRows.filter(
    ({ node: current }) =>
      current.attributes['resource-id'] === input.codeInputId && isVisibleAndEnabled(current),
  );
  assert.equal(inputRows.length, 1, 'Android manual code input is absent or duplicated');
  const value = attrText(inputRows[0].node).find((item) => item.length > 0);
  assert(value, 'Android manual code input has no retained value');
  assert.equal(sha256(value), requireHash(input.manualCodeSha256, 'manual code hash'));
  const connectRows = appRows.filter(
    ({ node: current }) =>
      current.attributes['resource-id'] === input.connectButtonId && isVisibleAndEnabled(current),
  );
  assert.equal(connectRows.length, 1, 'Android manual connect control is absent or duplicated');
  assert.equal(
    appRows.filter(({ node: current }) => current.attributes['resource-id'] === input.qrModalId)
      .length,
    0,
    'camera QR modal remains visible during manual entry',
  );
  return {
    codeInputPath: inputRows[0].path,
    connectButtonPath: connectRows[0].path,
  };
}

export function requireAndroidCameraPendingGuidance(input: {
  tree: unknown;
  appId: string;
  connectionId: string;
  expectedLocale: AndroidCameraLocale;
}): { cardPath: string; guidancePath: string } {
  const cardId = `student.professionals.connectionPending.${input.connectionId}`;
  const { rows: appRows } = appScopedRows(input.tree, input.appId);
  const cards = appRows.filter(
    ({ node: current }) =>
      current.attributes['resource-id'] === cardId && isVisibleAndEnabled(current),
  );
  assert.equal(cards.length, 1, 'Android pending connection card is absent or duplicated');
  const withinCard = [{ node: cards[0].node, path: 'root' }, ...descendants(cards[0].node)].filter(
    ({ node: current }) =>
      attrText(current).includes(PENDING_GUIDANCE[input.expectedLocale]) &&
      isVisibleAndEnabled(current),
  );
  assert.equal(
    withinCard.length,
    1,
    'Pending guidance is absent or duplicated on the exact pending node or its descendants',
  );
  return {
    cardPath: cards[0].path,
    guidancePath:
      withinCard[0].node === cards[0].node
        ? cards[0].path
        : `${cards[0].path}/${withinCard[0].path.slice('root/'.length)}`,
  };
}

export function requireAndroidCameraLocale(input: {
  evidence: unknown;
  expectedLocale: 'en-US' | 'pt-BR' | 'es-ES';
  expectedBinding: NativeLocaleBinding;
}): { locale: 'en-US' | 'pt-BR' | 'es-ES'; evidence: NativeLocaleEvidence } {
  const evidence = parseNativeLocaleEvidence(input.evidence);
  const qualification = qualifyNativeLocaleEvidence(
    input.evidence,
    input.expectedLocale,
    input.expectedBinding,
  );
  if (!qualification.eligible) {
    const reason = 'reason' in qualification ? qualification.reason : 'unknown';
    throw new Error(`Android locale is not qualified: ${reason}`);
  }
  assert.equal(evidence.binding.target.platform, 'android');
  assert.equal(evidence.effectiveAppLocale.value, input.expectedLocale);
  return { locale: input.expectedLocale, evidence };
}

export type AndroidCameraApiIdentity = {
  runId: string;
  attemptId: string;
  /** Raw backend API origin bound to the API process and SQL/request receipts. */
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  backendAttemptId: string;
};

export type AndroidCameraManualRequestBinding = {
  requestId: number;
  bodyHash: string;
  recorderBodyHash: string;
  manualCodeSha256: string;
  actionSha256: string;
  sourcePath: string;
  sourceSha256: string;
  descriptorPath: string;
  backendAttemptId: string;
  apiPid: number;
  /** Raw upstream origin recorded by the request receipt; proxy rows use targetOrigin. */
  apiOrigin: string;
};

/**
 * Read the actual proxy body and descriptor before the producer consumes the
 * capture getter.  The later transport verifier repeats these checks across
 * the complete request window; this early read prevents a metadata-only
 * getter from being accepted as the submission source.
 */
export async function readAndroidCameraManualRequestBinding(input: {
  artifactRoot: string;
  capture: NativeRequestBodyCaptureReceipt;
  targetOrigin: string;
  apiPid: number;
  sessionRunId: string;
  backendAttemptId: string;
  signal?: AbortSignal;
}): Promise<AndroidCameraManualRequestBinding> {
  const capture = input.capture;
  assert.equal(capture.kind, 'owned-native-request-body-receipt-v1');
  assert.equal(capture.producer, 'owned-api-proxy-native-request-body-v1');
  assert.equal(capture.method, 'POST');
  assert.equal(capture.route, POST_PATH);
  assert.equal(capture.requestProfile, 'native');
  assert.equal(capture.requestOrigin, null);
  assert.equal(capture.status, 201);
  assert.equal(capture.outcome, 'forwarded');
  assert.equal(capture.targetOrigin, input.targetOrigin);
  assert.equal(capture.apiPid, input.apiPid);
  assert.equal(capture.sessionRunId, input.sessionRunId);
  assert.equal(capture.backendAttemptId, input.backendAttemptId);
  assert.match(capture.actorAuthUidHash, HASH);
  assert.equal(capture.actorAuthUidHash, capture.actorAuthUidSha256);
  assert.match(capture.manualCodeSha256, HASH);
  assert.match(capture.actionSha256, HASH);
  assert.match(capture.sourceSha256, HASH);
  assert.equal(capture.bodyPath, capture.sourcePath);
  assert.equal(capture.bodySha256, capture.sourceSha256);
  assert.equal(capture.bodySizeBytes, capture.sizeBytes);
  const root = path.resolve(input.artifactRoot);
  const child = (value: string, label: string): string => {
    assert(
      typeof value === 'string' && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes('..'),
      `${label} must be a relative private artifact child`,
    );
    const absolute = path.resolve(root, value);
    assert(absolute.startsWith(`${root}${path.sep}`), `${label} escaped the owned artifact root`);
    return absolute;
  };
  const source = await readOwnedAndroidBoundedFile({
    artifactRoot: input.artifactRoot,
    filePath: child(capture.sourcePath, 'Android camera manual request source path'),
    label: 'Android camera manual request source',
    maxBytes: MAX_REQUEST_BODY_BYTES,
    signal: input.signal,
  });
  assert.equal(source.path, capture.sourcePath);
  assert.equal(source.bytes.byteLength, capture.bodySizeBytes);
  assert.equal(sha256(source.bytes), capture.bodySha256);
  let body: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(source.bytes.toString('utf8'));
    assert(value && typeof value === 'object' && !Array.isArray(value));
    body = value as Record<string, unknown>;
  } catch (error) {
    throw new Error('Android camera manual request body is invalid JSON', {
      cause: error,
    });
  }
  assert(typeof body.code === 'string' && body.code.length > 0);
  assert.equal(sha256(body.code), capture.manualCodeSha256);

  const descriptor = await readOwnedAndroidBoundedFile({
    artifactRoot: input.artifactRoot,
    filePath: child(capture.descriptorPath, 'Android camera manual request descriptor path'),
    label: 'Android camera manual request descriptor',
    maxBytes: 16 * 1024,
    signal: input.signal,
  });
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(descriptor.bytes.toString('utf8'));
    assert(value && typeof value === 'object' && !Array.isArray(value));
    parsed = value as Record<string, unknown>;
  } catch (error) {
    throw new Error('Android camera manual request descriptor is invalid JSON', { cause: error });
  }
  assert.equal(parsed.kind, 'owned-native-request-body-receipt-v1');
  assert.equal(parsed.producer, 'owned-api-proxy-native-request-body-v1');
  assert.equal(parsed.bodyPath, capture.sourcePath);
  assert.equal(parsed.bodySha256, capture.sourceSha256);
  assert.equal(parsed.bodySizeBytes, capture.sizeBytes);
  assert.equal(parsed.requestId, capture.requestId);
  assert.equal(parsed.method, 'POST');
  assert.equal(parsed.route, POST_PATH);
  assert.equal(parsed.status, capture.status);
  assert.equal(parsed.requestProfile, 'native');
  assert.equal(parsed.requestOrigin, null);
  assert.equal(parsed.targetOrigin, input.targetOrigin);
  assert.equal(parsed.backendAttemptId, input.backendAttemptId);
  assert.equal(parsed.apiPid, input.apiPid);
  assert.equal(parsed.manualCodeSha256, capture.manualCodeSha256);
  assert.equal(parsed.actionSha256, capture.actionSha256);
  assert.equal(parsed.captureRunId, capture.captureRunId);
  assert.equal(parsed.sessionRunId, input.sessionRunId);
  assert.equal(parsed.actorAuthUidHash, capture.actorAuthUidHash);
  return {
    requestId: capture.requestId,
    bodyHash: capture.bodySha256,
    recorderBodyHash: sha256(source.bytes),
    manualCodeSha256: capture.manualCodeSha256,
    actionSha256: capture.actionSha256,
    sourcePath: capture.sourcePath,
    sourceSha256: capture.sourceSha256,
    descriptorPath: capture.descriptorPath,
    backendAttemptId: capture.backendAttemptId,
    apiPid: capture.apiPid,
    apiOrigin: capture.targetOrigin,
  };
}

const pathHash = (route: string) => sha256(route);

/** Validate every post-fence row; filtering a matching POST is deliberately insufficient. */
export async function requireAndroidCameraTransport(input: {
  artifactRoot: string;
  observations: readonly ProxyObservation[];
  beforeRequestId: number;
  throughRequestId: number;
  allowedRoutes: readonly string[];
  /** Owned proxy upstream origin observed on every transport row. */
  targetOrigin: string;
  identity: AndroidCameraApiIdentity;
  request: AndroidCameraManualRequestBinding;
}): Promise<{ requestId: number; postRows: readonly ProxyObservation[] }> {
  assert(Number.isSafeInteger(input.beforeRequestId) && input.beforeRequestId >= 0);
  assert(
    Number.isSafeInteger(input.throughRequestId) && input.throughRequestId > input.beforeRequestId,
  );
  // Both the proxy rows and the request body receipt bind the raw backend
  // upstream. The app-facing proxy listener remains producer.identity.target.apiOrigin.
  assert.equal(input.identity.apiOrigin, input.targetOrigin);
  assert.equal(input.request.apiOrigin, input.identity.apiOrigin);
  assert(Number.isSafeInteger(input.identity.apiPid) && input.identity.apiPid > 0);
  assert.equal(input.identity.backendAttemptId, `${input.identity.runId}:first`);
  assert.equal(input.identity.attemptId, input.identity.backendAttemptId);
  assert(typeof input.identity.apiStarted === 'string' && input.identity.apiStarted.length > 0);
  assert(typeof input.identity.apiScript === 'string' && input.identity.apiScript.length > 0);
  const all = [...input.observations];
  const sorted = [...all].sort((left, right) => left.requestId - right.requestId);
  assert(sorted.length > 0, 'Android camera transport history is empty');
  assert(
    sorted.every((row) => Number.isSafeInteger(row.requestId) && row.requestId > 0),
    'Android camera request ID is invalid',
  );
  assert.equal(
    new Set(sorted.map((row) => row.requestId)).size,
    sorted.length,
    'Android camera request IDs are duplicated',
  );
  const postRows = sorted.filter(
    (row) => row.requestId > input.beforeRequestId && row.requestId <= input.throughRequestId,
  );
  assert.equal(
    postRows.length,
    input.throughRequestId - input.beforeRequestId,
    'Android camera request window is not contiguous',
  );
  assert.equal(
    sorted[sorted.length - 1].requestId,
    input.throughRequestId,
    'Android camera fence does not cover the complete history',
  );
  const allowed = new Set(input.allowedRoutes.map(pathHash));
  assert(
    allowed.has(pathHash(POST_PATH)),
    'Android camera allowed route set omits invite submission',
  );
  for (const row of postRows) {
    assert.equal(row.requestProfile, 'native');
    assert.equal(row.requestOrigin, null);
    assert.equal(row.targetOrigin, input.targetOrigin);
    assert.equal(row.outcome, 'forwarded');
    assert.equal(row.faultAttemptId, null);
    assert(
      allowed.has(row.pathHash),
      'Android camera post-fence history contains an undeclared route',
    );
    assert(
      row.method === 'GET' || row.method === 'POST',
      'Android camera history contains an unsupported method',
    );
    if (row.pathHash === pathHash(ANALYTICS_PATH)) {
      assert.equal(row.method, 'POST');
      assert.equal(
        row.status,
        202,
        'Android camera analytics event must be accepted with HTTP 202',
      );
    } else {
      assert(
        row.status === 200 || row.status === 201,
        'Android camera history contains a failed response',
      );
    }
  }
  const submits = postRows.filter(
    (row) => row.method === 'POST' && row.pathHash === pathHash(POST_PATH),
  );
  assert.equal(
    submits.length,
    1,
    'Android camera manual submission must contain exactly one POST 201',
  );
  const submit = submits[0];
  assert.equal(submit.status, 201);
  assert.equal(input.request.requestId, submit.requestId);
  assert.equal(
    input.request.bodyHash,
    input.request.recorderBodyHash,
    'Android request body hash lacks independent recorder agreement',
  );
  assert.match(input.request.bodyHash, HASH);
  assert.match(input.request.manualCodeSha256, HASH);
  assert.match(input.request.actionSha256, HASH);
  assert.match(input.request.sourceSha256, HASH);
  assert(
    !path.isAbsolute(input.request.sourcePath) &&
      !input.request.sourcePath.split(/[\\/]/u).includes('..'),
    'Android request source path must be a relative private artifact child',
  );
  const sourceAbsolute = path.resolve(input.artifactRoot, input.request.sourcePath);
  assert(
    sourceAbsolute.startsWith(`${path.resolve(input.artifactRoot)}${path.sep}`),
    'Android request source path escaped the owned artifact root',
  );
  const source = await readOwnedAndroidBoundedFile({
    artifactRoot: input.artifactRoot,
    filePath: sourceAbsolute,
    label: 'Android camera manual request body source',
    maxBytes: MAX_REQUEST_BODY_BYTES,
  });
  assert.equal(source.path, input.request.sourcePath);
  assert.equal(source.bytes.byteLength, source.identity.size);
  assert.equal(sha256(source.bytes), input.request.sourceSha256);
  assert.equal(
    input.request.sourceSha256,
    input.request.bodyHash,
    'Android request source does not bind the submitted body hash',
  );
  assert(
    typeof input.request.descriptorPath === 'string' &&
      !path.isAbsolute(input.request.descriptorPath) &&
      !input.request.descriptorPath.split(/[\\/]/u).includes('..'),
    'Android request descriptor path must be a relative private artifact child',
  );
  const descriptorAbsolute = path.resolve(input.artifactRoot, input.request.descriptorPath);
  assert(
    descriptorAbsolute.startsWith(`${path.resolve(input.artifactRoot)}${path.sep}`),
    'Android request descriptor path escaped the owned artifact root',
  );
  const descriptor = await readOwnedAndroidBoundedFile({
    artifactRoot: input.artifactRoot,
    filePath: descriptorAbsolute,
    label: 'Android camera manual request descriptor',
    maxBytes: 16 * 1024,
  });
  let parsedDescriptor: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(descriptor.bytes.toString('utf8'));
    assert(value && typeof value === 'object' && !Array.isArray(value));
    parsedDescriptor = value as Record<string, unknown>;
  } catch (error) {
    throw new Error('Android camera manual request descriptor is invalid JSON', { cause: error });
  }
  assert.equal(parsedDescriptor.kind, 'owned-native-request-body-receipt-v1');
  assert.equal(parsedDescriptor.producer, 'owned-api-proxy-native-request-body-v1');
  assert.equal(parsedDescriptor.bodyPath, input.request.sourcePath);
  assert.equal(
    parsedDescriptor.bodySha256,
    input.request.sourceSha256,
    'Android request descriptor body hash mismatch',
  );
  assert.equal(
    parsedDescriptor.bodySizeBytes,
    source.bytes.byteLength,
    'Android request descriptor body size mismatch',
  );
  assert.equal(
    parsedDescriptor.requestId,
    input.request.requestId,
    'Android request descriptor request ID mismatch',
  );
  assert.equal(parsedDescriptor.method, 'POST');
  assert.equal(parsedDescriptor.route, POST_PATH);
  assert.equal(parsedDescriptor.status, submit.status);
  assert.equal(parsedDescriptor.requestProfile, 'native');
  assert.equal(parsedDescriptor.requestOrigin, null);
  assert.equal(parsedDescriptor.targetOrigin, input.request.apiOrigin);
  assert.equal(parsedDescriptor.backendAttemptId, input.request.backendAttemptId);
  assert.equal(parsedDescriptor.apiPid, input.request.apiPid);
  assert.equal(parsedDescriptor.manualCodeSha256, input.request.manualCodeSha256);
  assert.equal(parsedDescriptor.actionSha256, input.request.actionSha256);
  assert.equal(input.request.backendAttemptId, input.identity.backendAttemptId);
  assert.equal(input.request.apiPid, input.identity.apiPid);
  assert.equal(input.request.apiOrigin, input.identity.apiOrigin);
  return { requestId: submit.requestId, postRows };
}

function requireSnapshotSourceReceipt(value: AndroidCameraSqlSourceReceipt): void {
  assert(
    value.kind === 'query' || value.kind === 'transport',
    'Android camera SQL source receipt has wrong kind',
  );
  assert(
    Number.isSafeInteger(value.sizeBytes) &&
      value.sizeBytes > 0 &&
      value.sizeBytes <= MAX_SNAPSHOT_BYTES,
  );
  assert.match(value.sha256, HASH);
  assert.equal(value.mode, 0o600);
  assert.equal(value.ownerUid, process.getuid?.());
  assert.equal(value.verification, 'owned-stable-reader-v6');
  assert(typeof value.phase === 'string' && value.phase.length > 0);
  assert(typeof value.scope === 'string' && value.scope.length > 0);
  assert(
    value.table === 'domain' ||
      (ANDROID_CAMERA_SQL_TABLES as readonly string[]).includes(value.table),
    'Android camera SQL source receipt table is not in the closed projection',
  );
  assert(/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(value.queryId));
  assert(
    typeof value.parentSnapshotRoot === 'string' &&
      value.parentSnapshotRoot.length > 0 &&
      path.isAbsolute(value.parentSnapshotRoot) &&
      path.resolve(value.parentSnapshotRoot) === value.parentSnapshotRoot,
    'Android camera SQL source parent root is invalid',
  );
  assert.equal(value.parentManifestPath, 'manifest.json');
  assert(
    typeof value.parentManifestRetainedPath === 'string' &&
      value.parentManifestRetainedPath.length > 0 &&
      !path.isAbsolute(value.parentManifestRetainedPath) &&
      !value.parentManifestRetainedPath.split(/[\\/]/u).includes('..') &&
      value.parentManifestRetainedPath !== value.parentManifestPath,
    'Android camera SQL retained manifest path is invalid',
  );
  assert.equal(value.parentManifestRetainedKind, 'sidecar');
  assert.match(value.parentManifestRetainedSha256, HASH);
  assert(Number.isSafeInteger(value.parentManifestRetainedSizeBytes));
  assert(Number.isSafeInteger(value.parentManifestSizeBytes));
  assert.equal(
    value.parentManifestRetainedSizeBytes,
    value.parentManifestSizeBytes,
    'Android camera SQL retained manifest size is not source-bound',
  );
  assert(Number.isSafeInteger(value.parentManifestRetainedOwnerUid));
  assert.equal(value.parentManifestRetainedMode, 0o600);
  assert.equal(value.parentManifestRetainedVerification, 'owned-stable-reader-v6');
  assert(
    typeof value.parentSnapshotPath === 'string' &&
      value.parentSnapshotPath.length > 0 &&
      !path.isAbsolute(value.parentSnapshotPath) &&
      !value.parentSnapshotPath.split(/[\\/]/u).includes('..'),
    'Android camera SQL source parent path is invalid',
  );
  assert(
    typeof value.parentSnapshotRetainedPath === 'string' &&
      value.parentSnapshotRetainedPath.length > 0 &&
      !path.isAbsolute(value.parentSnapshotRetainedPath) &&
      !value.parentSnapshotRetainedPath.split(/[\\/]/u).includes('..') &&
      value.parentSnapshotRetainedPath !== value.parentSnapshotPath,
    'Android camera SQL retained parent path is invalid',
  );
  assert.equal(value.parentSnapshotRetainedKind, 'sidecar');
  assert.match(value.parentSnapshotRetainedSha256, HASH);
  assert.equal(value.parentSnapshotRetainedSizeBytes, value.parentSnapshotSizeBytes);
  assert(Number.isSafeInteger(value.parentSnapshotRetainedOwnerUid));
  assert.equal(value.parentSnapshotRetainedMode, 0o600);
  assert.equal(value.parentSnapshotRetainedVerification, 'owned-stable-reader-v6');
  assert.match(value.parentSnapshotSha256, HASH);
  assert(
    value.parentSnapshotSchema === 'connection-snapshot-v1' ||
      value.parentSnapshotSchema === 'domain-snapshot-v1',
  );
  assert(value.parentSnapshotKind === 'connection' || value.parentSnapshotKind === 'domain');
  assert(Number.isSafeInteger(value.parentSnapshotSizeBytes) && value.parentSnapshotSizeBytes > 0);
  assert(value.parentSnapshotSizeBytes <= 1 * 1024 * 1024);
  assert(Number.isSafeInteger(value.parentSnapshotOwnerUid));
  assert.equal(value.parentSnapshotMode, 0o600);
  assert.equal(value.parentSnapshotVerification, 'owned-runtime-document-v6');
  assert(typeof value.parentRunId === 'string' && value.parentRunId.length > 0);
  assert(typeof value.parentScope === 'string' && value.parentScope.length > 0);
  assert(typeof value.parentApiOrigin === 'string' && value.parentApiOrigin.length > 0);
  assert(Number.isSafeInteger(value.parentApiPid) && value.parentApiPid > 0);
  assert(typeof value.parentApiStarted === 'string' && value.parentApiStarted.length > 0);
  assert(typeof value.parentApiScript === 'string' && value.parentApiScript.length > 0);
  assert(
    typeof value.parentBackendAttemptId === 'string' && value.parentBackendAttemptId.length > 0,
  );
  assert.match(value.parentManifestSha256, HASH);
  assert(
    typeof value.parentApiAttempt === 'string' && /^[a-z0-9-]{1,48}$/u.test(value.parentApiAttempt),
  );
  assert.match(value.parentApiLedgerSha256, HASH);
  const expectedApiLedgerPath =
    value.parentApiAttempt === 'session-start'
      ? 'api-session-start.json'
      : `api-${value.parentApiAttempt}.json`;
  assert(
    typeof value.parentApiLedgerPath === 'string' &&
      value.parentApiLedgerPath.length > 0 &&
      !path.isAbsolute(value.parentApiLedgerPath) &&
      !value.parentApiLedgerPath.split(/[\\/]/u).includes('..') &&
      /^api-[a-z0-9-]+\.json$/u.test(value.parentApiLedgerPath),
    'Android camera SQL API ledger path is invalid',
  );
  assert(
    typeof value.parentApiLedgerRetainedPath === 'string' &&
      value.parentApiLedgerRetainedPath.length > 0 &&
      !path.isAbsolute(value.parentApiLedgerRetainedPath) &&
      !value.parentApiLedgerRetainedPath.split(/[\\/]/u).includes('..') &&
      value.parentApiLedgerRetainedPath !== value.parentApiLedgerPath,
    'Android camera SQL retained API ledger path is invalid',
  );
  assert.equal(value.parentApiLedgerRetainedKind, 'sidecar');
  assert.match(value.parentApiLedgerRetainedSha256, HASH);
  assert(Number.isSafeInteger(value.parentApiLedgerRetainedSizeBytes));
  assert(Number.isSafeInteger(value.parentApiLedgerSizeBytes));
  assert.equal(
    value.parentApiLedgerRetainedSizeBytes,
    value.parentApiLedgerSizeBytes,
    'Android camera SQL retained API ledger size is not source-bound',
  );
  assert(Number.isSafeInteger(value.parentApiLedgerRetainedOwnerUid));
  assert.equal(value.parentApiLedgerRetainedMode, 0o600);
  assert.equal(value.parentApiLedgerRetainedVerification, 'owned-stable-reader-v6');
  assert.equal(value.parentApiLedgerPath, expectedApiLedgerPath);
  assert.match(value.parentFixtureAuthUidAllowlistHash, HASH);
  assert(
    value.table === 'domain'
      ? value.sourceProjection === 'owned-session.domain-snapshot-v1.document'
      : value.sourceProjection === 'owned-session.connection-snapshot-v1.rows',
    'Android camera SQL source projection is invalid',
  );
}

async function readSnapshotSources(
  root: string,
  receipts: readonly AndroidCameraSqlSourceReceipt[],
  expected: ConnectionSnapshotExpectedIdentity,
  isolationExpected: ConnectionSnapshotExpectedIdentity,
  isolationScope: string,
  trainingScope: string,
  parentEvidence: Readonly<Record<AndroidCameraSqlReceiptPhase, SourceEvidence>>,
  signal?: AbortSignal,
): Promise<void> {
  assert(receipts.length > 0, 'Android camera SQL source receipts are missing');
  const paths = new Set<string>();
  const queryIds = new Set<string>();
  const phaseTables = new Map<AndroidCameraSqlReceiptPhase, Set<string>>();
  const expectedScopes: Record<AndroidCameraSqlReceiptPhase, string | undefined> = {
    before: expected.scope,
    pending: expected.scope,
    'isolation-before': isolationScope,
    'isolation-after': isolationScope,
    'training-before': trainingScope,
    'training-after': trainingScope,
  };
  const expectedParentKinds: Record<AndroidCameraSqlReceiptPhase, 'connection' | 'domain'> = {
    before: parentEvidence.before.receipt.kind,
    pending: parentEvidence.pending.receipt.kind,
    'isolation-before': parentEvidence['isolation-before'].receipt.kind,
    'isolation-after': parentEvidence['isolation-after'].receipt.kind,
    'training-before': parentEvidence['training-before'].receipt.kind,
    'training-after': parentEvidence['training-after'].receipt.kind,
  };
  assert.equal(expectedParentKinds.before, 'connection');
  assert.equal(expectedParentKinds.pending, 'connection');
  assert.equal(
    expectedParentKinds['isolation-before'],
    'connection',
    'Android camera isolation-before SQL parent must be a connection snapshot',
  );
  assert.equal(
    expectedParentKinds['isolation-after'],
    'connection',
    'Android camera isolation-after SQL parent must be a connection snapshot',
  );
  const parents: Partial<Record<AndroidCameraSqlReceiptPhase, VerifiedParent>> = {};
  const retainedByPhase: Partial<Record<AndroidCameraSqlReceiptPhase, RetainedParentEvidence>> = {};
  for (const receipt of receipts) {
    requireSnapshotSourceReceipt(receipt);
    const retained = {
      snapshot: {
        path: receipt.parentSnapshotRetainedPath,
        kind: receipt.parentSnapshotRetainedKind,
        sizeBytes: receipt.parentSnapshotRetainedSizeBytes,
        sha256: receipt.parentSnapshotRetainedSha256,
        ownerUid: receipt.parentSnapshotRetainedOwnerUid,
        mode: receipt.parentSnapshotRetainedMode,
        verification: receipt.parentSnapshotRetainedVerification,
      },
      manifest: {
        path: receipt.parentManifestRetainedPath,
        kind: receipt.parentManifestRetainedKind,
        sizeBytes: receipt.parentManifestRetainedSizeBytes,
        sha256: receipt.parentManifestRetainedSha256,
        ownerUid: receipt.parentManifestRetainedOwnerUid,
        mode: receipt.parentManifestRetainedMode,
        verification: receipt.parentManifestRetainedVerification,
      },
      apiLedger: {
        path: receipt.parentApiLedgerRetainedPath,
        kind: receipt.parentApiLedgerRetainedKind,
        sizeBytes: receipt.parentApiLedgerRetainedSizeBytes,
        sha256: receipt.parentApiLedgerRetainedSha256,
        ownerUid: receipt.parentApiLedgerRetainedOwnerUid,
        mode: receipt.parentApiLedgerRetainedMode,
        verification: receipt.parentApiLedgerRetainedVerification,
      },
    } satisfies RetainedParentEvidence;
    const prior = retainedByPhase[receipt.phase];
    if (prior) assert.deepEqual(prior, retained);
    else retainedByPhase[receipt.phase] = retained;
  }
  for (const phase of Object.keys(expectedParentKinds) as AndroidCameraSqlReceiptPhase[]) {
    parents[phase] = await readVerifiedAndroidCameraSqlParent({
      artifactRoot: root,
      evidence: parentEvidence[phase],
      expectedKind: expectedParentKinds[phase],
      retained: retainedByPhase[phase],
      retainedOnly: true,
      signal,
    });
  }
  assert.equal(
    new Set(
      Object.values(parents).map((parent) => {
        assert(parent);
        return parent.receipt.parentRoot;
      }),
    ).size,
    1,
    'Android camera SQL parents must share one authenticated runtime root',
  );
  for (const receipt of receipts) {
    requireSnapshotSourceReceipt(receipt);
    assert.equal(receipt.scope, expectedScopes[receipt.phase]);
    const parent = parents[receipt.phase];
    assert(parent, `Android camera SQL parent is missing for ${receipt.phase}`);
    const parentReceipt = parent.receipt;
    if (
      parentReceipt.kind === 'connection' &&
      (receipt.phase === 'isolation-before' || receipt.phase === 'isolation-after')
    ) {
      requireConnectionSnapshot(parent.evidence.value, isolationExpected);
    }
    if (
      parentReceipt.kind === 'connection' &&
      (receipt.phase === 'before' || receipt.phase === 'pending')
    ) {
      requireConnectionSnapshot(parent.evidence.value, {
        ...expected,
        runId: parentReceipt.runId,
        scope: parentReceipt.scope,
      });
    }
    assert.equal(receipt.parentSnapshotPath, parentReceipt.path);
    assert.equal(receipt.parentSnapshotRoot, parentReceipt.parentRoot);
    assert.equal(receipt.parentManifestPath, parent.provenance.manifestPath);
    assert.equal(receipt.parentManifestSizeBytes, parent.provenance.manifest.receipt.sizeBytes);
    assert.equal(receipt.parentManifestSha256, parent.provenance.manifest.receipt.sha256);
    assert.equal(receipt.parentManifestRetainedPath, parent.retained?.manifest.path);
    assert.equal(receipt.parentManifestRetainedSha256, parent.retained?.manifest.sha256);
    assert.equal(receipt.parentManifestRetainedSizeBytes, parent.retained?.manifest.sizeBytes);
    assert.equal(receipt.parentSnapshotSha256, parentReceipt.sha256);
    assert.equal(receipt.parentSnapshotSchema, parentReceipt.schema);
    assert.equal(receipt.parentSnapshotKind, parentReceipt.kind);
    assert.equal(receipt.parentSnapshotSizeBytes, parentReceipt.sizeBytes);
    assert.equal(receipt.parentSnapshotOwnerUid, parentReceipt.ownerUid);
    assert.equal(receipt.parentSnapshotMode, parentReceipt.mode);
    assert.equal(receipt.parentSnapshotVerification, parentReceipt.verification);
    assert.equal(receipt.parentRunId, parentReceipt.runId);
    assert.equal(receipt.parentScope, parentReceipt.scope);
    assert.equal(receipt.parentApiOrigin, parentReceipt.apiOrigin);
    assert.equal(receipt.parentApiPid, parentReceipt.apiPid);
    assert.equal(receipt.parentApiStarted, parentReceipt.apiStarted);
    assert.equal(receipt.parentApiScript, parentReceipt.apiScript);
    assert.equal(receipt.parentBackendAttemptId, parentReceipt.backendAttemptId);
    assert.equal(receipt.parentManifestSha256, parentReceipt.manifestSha256);
    assert.equal(receipt.parentApiAttempt, parentReceipt.apiAttempt);
    assert.equal(receipt.parentApiLedgerSha256, parentReceipt.apiLedgerSha256);
    assert.equal(receipt.parentApiLedgerPath, parent.provenance.apiLedgerPath);
    assert.equal(receipt.parentApiLedgerSizeBytes, parent.provenance.apiLedger.receipt.sizeBytes);
    assert.equal(receipt.parentApiLedgerRetainedPath, parent.retained?.apiLedger.path);
    assert.equal(receipt.parentApiLedgerRetainedSha256, parent.retained?.apiLedger.sha256);
    assert.equal(receipt.parentApiLedgerRetainedSizeBytes, parent.retained?.apiLedger.sizeBytes);
    assert.equal(
      receipt.parentFixtureAuthUidAllowlistHash,
      parentReceipt.fixtureAuthUidAllowlistHash,
    );
    assert(
      receipt.sourceProjection ===
        (receipt.table === 'domain'
          ? 'owned-session.domain-snapshot-v1.document'
          : 'owned-session.connection-snapshot-v1.rows'),
      'Android camera SQL source projection is not bound to its table kind',
    );
    assert(!paths.has(receipt.path), 'Android camera SQL source receipt path is duplicated');
    assert(!queryIds.has(receipt.queryId), 'Android camera SQL source query ID is duplicated');
    paths.add(receipt.path);
    queryIds.add(receipt.queryId);
    const tables = phaseTables.get(receipt.phase) ?? new Set<string>();
    tables.add(receipt.table);
    phaseTables.set(receipt.phase, tables);
    const loaded = await readOwnedAndroidBoundedFile({
      artifactRoot: root,
      filePath: path.resolve(root, receipt.path),
      label: 'Android camera SQL snapshot source',
      maxBytes: MAX_SNAPSHOT_BYTES,
      signal,
    });
    assert.equal(loaded.bytes.byteLength, receipt.sizeBytes);
    assert.equal(sha256(loaded.bytes), receipt.sha256);
    const parentValue = parent.evidence.value as Record<string, unknown>;
    const expectedProjection =
      receipt.table === 'domain'
        ? parentValue
        : (parentValue.rows as Record<string, unknown>)[receipt.table];
    assert.notEqual(expectedProjection, undefined, 'Android camera parent projection is missing');
    assert.deepEqual(
      loaded.bytes,
      Buffer.from(JSON.stringify(expectedProjection), 'utf8'),
      'Android camera SQL child bytes do not equal the protected parent projection',
    );
  }
  for (const phase of ['before', 'pending'] as const) {
    assert.deepEqual(
      phaseTables.get(phase),
      new Set(ANDROID_CAMERA_SQL_TABLES),
      `Android camera ${phase} SQL receipt inventory is incomplete`,
    );
  }
  for (const phase of [
    'isolation-before',
    'isolation-after',
    'training-before',
    'training-after',
  ] as const) {
    if (expectedParentKinds[phase] === 'connection') {
      assert.deepEqual(
        phaseTables.get(phase),
        new Set(ANDROID_CAMERA_SQL_TABLES),
        `Android camera ${phase} connection SQL receipt inventory is incomplete`,
      );
    } else {
      assert.equal(phaseTables.get(phase)?.size, 1);
      assert(phaseTables.get(phase)?.has('domain'));
    }
  }
}

/**
 * Verify the complete SQL projection inventory against the original snapshot
 * documents. This narrow seam is useful before the larger connection-phase
 * verifier runs: it proves parent bytes, descriptor identity, run/scope/API
 * metadata and every child projection without accepting supplied hash labels.
 */
export async function requireAndroidCameraSqlSourceProjections(input: {
  artifactRoot: string;
  connectionScope: string;
  /** Full primary snapshot identity; scope alone is insufficient authority. */
  expected: ConnectionSnapshotExpectedIdentity;
  isolationScope: string;
  isolationExpected: ConnectionSnapshotExpectedIdentity;
  trainingScope: string;
  sourceReceipts: readonly AndroidCameraSqlSourceReceipt[];
  parentEvidence: Readonly<Record<AndroidCameraSqlReceiptPhase, SourceEvidence>>;
  signal?: AbortSignal;
}): Promise<void> {
  if (input.expected.scope !== undefined)
    assert.equal(
      input.expected.scope,
      input.connectionScope,
      'Android camera primary expected scope differs from the SQL connection scope',
    );
  await readSnapshotSources(
    input.artifactRoot,
    input.sourceReceipts,
    {
      ...input.expected,
      scope: input.connectionScope,
    },
    input.isolationExpected,
    input.isolationScope,
    input.trainingScope,
    input.parentEvidence,
    input.signal,
  );
}

/** Use the canonical nine-table connection snapshot validator and causal transition. */
export async function requireAndroidCameraSqlEvidence(input: {
  artifactRoot: string;
  before: OwnedConnectionSnapshot;
  pending: OwnedConnectionSnapshot;
  fixtures: Pick<OwnedFixtures, 'accounts'>;
  expected: ConnectionSnapshotExpectedIdentity;
  isolationExpected: ConnectionSnapshotExpectedIdentity;
  isolationBefore: unknown;
  isolationAfter: unknown;
  trainingBefore: unknown;
  trainingAfter: unknown;
  /** Code read from the authenticated coach hierarchy for target binding. */
  inviteCode: string;
  isolationScope: string;
  trainingScope: string;
  sourceReceipts: readonly AndroidCameraSqlSourceReceipt[];
  sourceEvidence: Readonly<Record<AndroidCameraSqlReceiptPhase, OwnedSnapshotReceipt>>;
  parentEvidence: Readonly<Record<AndroidCameraSqlReceiptPhase, SourceEvidence>>;
  signal?: AbortSignal;
}): Promise<{ connectionId: string; sourceReceiptCount: number }> {
  requireConnectionSnapshot(input.before, input.expected);
  requireConnectionSnapshot(input.pending, {
    ...input.expected,
    runId: input.before.runId,
    scope: input.before.scope,
  });
  assert.equal(
    input.isolationExpected.scope,
    input.isolationScope,
    'Android camera isolation expected scope differs from the SQL isolation scope',
  );
  requireConnectionSnapshot(input.isolationBefore, input.isolationExpected);
  requireConnectionSnapshot(input.isolationAfter, input.isolationExpected);
  assert.equal(input.before.readOnly, true);
  assert.equal(input.pending.readOnly, true);
  assert.deepEqual(
    input.isolationAfter,
    input.isolationBefore,
    'Android camera changed unrelated connection state',
  );
  requireAndroidCameraTrainingTransition({
    beforeDomain: input.trainingBefore,
    afterDomain: input.trainingAfter,
    beforeConnection: input.before,
    pendingConnection: input.pending,
    inviteCode: input.inviteCode,
  });
  assert.deepEqual(input.parentEvidence.before.value, input.before);
  assert.deepEqual(input.parentEvidence.pending.value, input.pending);
  assert.deepEqual(input.sourceEvidence.before, input.parentEvidence.before.receipt);
  assert.deepEqual(input.sourceEvidence.pending, input.parentEvidence.pending.receipt);
  assert.deepEqual(input.parentEvidence['isolation-before'].value, input.isolationBefore);
  assert.deepEqual(input.parentEvidence['isolation-after'].value, input.isolationAfter);
  assert.deepEqual(input.parentEvidence['training-before'].value, input.trainingBefore);
  assert.deepEqual(input.parentEvidence['training-after'].value, input.trainingAfter);
  for (const phase of [
    'isolation-before',
    'isolation-after',
    'training-before',
    'training-after',
  ] as const)
    assert.deepEqual(input.sourceEvidence[phase], input.parentEvidence[phase].receipt);
  await readSnapshotSources(
    input.artifactRoot,
    input.sourceReceipts,
    input.expected,
    input.isolationExpected,
    input.isolationScope,
    input.trainingScope,
    input.parentEvidence,
    input.signal,
  );
  verifyConnectionSnapshotPhaseTransition({
    before: input.before,
    after: input.pending,
    beforeCheckpoint: 'unlinked',
    afterCheckpoint: 'pending',
    requirePreexistingSlot: false,
    fixtures: input.fixtures,
  });
  const connection = input.pending.rows.connections.find(
    (row) =>
      row.professionalAuthUid === input.pending.target.professionalAuthUid &&
      row.studentAuthUid === input.pending.target.studentAuthUid &&
      row.specialty === input.pending.target.specialty,
  );
  assert(
    connection,
    'Android camera pending connection is missing after canonical transition validation',
  );
  return {
    connectionId: connection.id,
    sourceReceiptCount: input.sourceReceipts.length,
  };
}

/** Reselect from the current canonical inventory before any future Android acquisition. */
export async function reselectAndroidCameraScenario(input: {
  repositoryRoot: string;
  inventory: unknown;
  arguments: NativePilotArguments;
  expectedSelection: NativePilotSelection;
  requiredSourcePaths: readonly string[];
  requiredDeclarationPath: string;
}): Promise<NativePilotSelection> {
  assert.equal(input.arguments.platform, 'android');
  assert.equal(input.arguments.engine, 'maestro');
  assert.equal(input.arguments.scenario, ANDROID_CAMERA_SCENARIO);
  assert.equal(input.arguments.mode, 'integration');
  const current = await selectNativePilotScenario(
    input.arguments,
    input.inventory,
    input.repositoryRoot,
  );
  assert.deepEqual(
    current,
    input.expectedSelection,
    'Android camera selection changed before acquisition',
  );
  const ledger = requireNativePilotAssertions(current);
  assert.deepEqual(
    ledger.map((row) => row.id),
    ANDROID_CAMERA_ASSERTION_IDS,
  );
  const sourcePaths =
    (
      current.scenario.freshnessInputs as {
        requirementPaths: string[];
        ownerPaths?: string[];
      }
    ).ownerPaths ?? [];
  for (const required of input.requiredSourcePaths)
    assert(
      sourcePaths.includes(required),
      `Android camera declaration is missing source ${required}`,
    );
  assert(
    sourcePaths.includes(input.requiredDeclarationPath),
    'Android camera declaration path is missing',
  );
  return current;
}

export function androidCameraBlockedGates(): readonly {
  gate: string;
  status: 'blocked';
  reason: string;
}[] {
  return [
    blockedCameraGate(
      'android-producer',
      'The private camera callback candidate has not emitted native frame or permission receipts',
    ),
    blockedCameraGate(
      'android-locale',
      'No observed Android OS/app locale is bound to the camera capture',
    ),
    blockedCameraGate(
      'android-runner',
      'No canonical Android camera runner/stager/dispatch branch exists',
    ),
    blockedCameraGate(
      'android-cleanup',
      'The candidate cleanup inspector has no independent native cleanup receipt in this source-only packet',
    ),
  ];
}

export function requireAndroidCameraRuntimeIdentity(
  value: AndroidCameraRuntimeIdentity,
): AndroidCameraRuntimeIdentity {
  requireRun(value.captureRunId, 'camera capture run ID');
  requireRun(value.ownerRunId, 'camera owner run ID');
  requireRun(value.backendRunId, 'camera backend run ID');
  assert.equal(value.backendAttemptId, `${value.backendRunId}:first`);
  assert.match(value.serial, SERIAL);
  assert.equal(value.appId, ANDROID_CAMERA_APP_ID);
  assert.equal(value.target.deviceId, value.serial);
  assert.equal(value.target.appId, value.appId);
  assert(typeof value.target.osVersion === 'string' && value.target.osVersion.length > 0);
  assert(typeof value.target.buildProfile === 'string' && value.target.buildProfile.length > 0);
  assert.match(value.target.binaryHash ?? '', HASH);
  assert(typeof value.target.apiOrigin === 'string' && value.target.apiOrigin.length > 0);
  assert(typeof value.apiOrigin === 'string' && value.apiOrigin.length > 0);
  assert.notEqual(
    value.apiOrigin,
    value.target.apiOrigin,
    'Android backend API origin must remain distinct from the app-facing build origin',
  );
  assert(Number.isSafeInteger(value.apiPid) && value.apiPid > 0);
  assert(typeof value.apiStarted === 'string' && value.apiStarted.length > 0);
  assert(typeof value.apiScript === 'string' && value.apiScript.length > 0);
  assert(value.locale && typeof value.locale === 'object', 'Android locale evidence is missing');
  const binding = value.locale.binding;
  assert(binding && typeof binding === 'object', 'Android locale binding is missing');
  assert.equal(binding.target.platform, 'android');
  return structuredClone(value);
}

export function requireFrameSourceDescriptor(
  source: AndroidCameraFrameSource,
): AndroidCameraFrameSource {
  assert(
    !('receipt' in source.command),
    'Frame source command must remain the owned command record',
  );
  assert(source.receipt.verification === 'owned-stable-reader-v6');
  return structuredClone(source);
}

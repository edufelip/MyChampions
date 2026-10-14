import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import YAML from 'yaml';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import { verifyConnectionSubmissionSnapshotTransition } from './native-connection-checkpoints';
import {
  resolvePendingStudentConnectionCard,
  type NativeConnectionTargetScope,
} from './native-connection-hierarchy';
import { buildNativeConnectionSubmissionActions } from './native-connection-journey-core';
import { IOS_CONNECTION_PLATFORM } from './native-connection-platform-contract';
import {
  requireConnectionSnapshot,
  verifyConnectionSnapshotCheckpoint,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import { parseNativeHierarchy, nativeHierarchyHasAttribute } from './native-hierarchy';
import { readNativeEvidence, validateIosCameraPreparation } from './native-view-evidence';
import { assertTestingDocument } from './schema-validation';
import { enUS } from '../../localization/en-US';
import type { ProxyObservation } from './owned-api-proxy';
import type { OwnedFixtures } from './owned-session';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

type NativePublicEvidenceLifecycle = {
  signal: AbortSignal;
  deadlineAtMs: number;
};

function stageFence(lifecycle: NativePublicEvidenceLifecycle | undefined, label: string): void {
  if (!lifecycle) return;
  lifecycle.signal.throwIfAborted();
  if (!Number.isFinite(lifecycle.deadlineAtMs) || performance.now() >= lifecycle.deadlineAtMs)
    throw new Error(`Native camera staging deadline expired: ${label}`);
}

/**
 * Project an owned domain snapshot for the camera's unrelated-state check.
 * The connection transition is validated separately; every other top-level
 * field, including identity metadata and the complete training projection,
 * remains part of this comparison. The raw snapshots are never mutated.
 */
export function projectCameraNonConnectionState<T extends { connections: unknown }>(
  snapshot: T,
  baseline: T,
): T {
  return {
    ...snapshot,
    connections: structuredClone(baseline.connections),
  };
}

export function assertCameraNonConnectionStateUnchanged<T extends { connections: unknown }>(
  before: T,
  after: T,
  message: string,
): void {
  assert.deepEqual(projectCameraNonConnectionState(after, before), before, message);
}

type CameraDomainSnapshotRecord = Record<string, unknown> & {
  connections: unknown;
};

type CameraDomainConnectionTarget = {
  professionalAuthUid: string;
  studentAuthUid: string;
  specialty: 'fitness_coach';
};

function cameraDomainConnectionRows(
  value: CameraDomainSnapshotRecord,
  label: string,
): Record<string, unknown>[] {
  if (!Array.isArray(value.connections))
    throw new Error(`${label} lacks its complete embedded connection projection`);
  const rows = value.connections.map((candidate, index) => {
    const row = record(candidate, `${label} connection row ${index}`);
    const sourceInviteCodeValue = row.sourceInviteCodeValue;
    if (
      !Object.prototype.hasOwnProperty.call(row, 'sourceInviteCodeValue') ||
      (sourceInviteCodeValue !== null && typeof sourceInviteCodeValue !== 'string')
    )
      throw new Error(`${label} connection source invite value is not explicit`);
    return row;
  });
  const ids = rows.map((row) => row.id);
  if (
    ids.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set(ids).size !== ids.length
  )
    throw new Error(`${label} embedded connection identities are not unique`);
  return rows;
}

function comparableCameraDomainConnections(
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows
    .map((row) => {
      const { sourceInviteCodeValue: _sourceInviteCodeValue, ...shared } = row;
      return shared;
    })
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function comparableCameraSqlConnections(
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows
    .map((row) => ({ ...row }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

/**
 * Bind the complete domain connection rows to the corresponding SQL
 * connection snapshots. Only the domain's sourceInviteCodeValue is normalized
 * because the SQL snapshot intentionally redacts that field; all shared row
 * fields and deterministic identities remain strict. Existing source values
 * must survive the submit, while the new target row must equal the code read
 * from the authenticated coach UI.
 */
export function assertCameraDomainConnectionBindings({
  beforeDomain,
  afterDomain,
  beforeConnection,
  afterConnection,
  target,
  inviteCode,
}: {
  beforeDomain: CameraDomainSnapshotRecord;
  afterDomain: CameraDomainSnapshotRecord;
  beforeConnection: OwnedConnectionSnapshot;
  afterConnection: OwnedConnectionSnapshot;
  target: CameraDomainConnectionTarget;
  inviteCode: string;
}): void {
  const beforeRows = cameraDomainConnectionRows(beforeDomain, 'camera training before');
  const afterRows = cameraDomainConnectionRows(afterDomain, 'camera training after');
  assert.deepEqual(
    comparableCameraDomainConnections(beforeRows),
    comparableCameraSqlConnections(beforeConnection.rows.connections),
    'camera training before connections are not bound to the before SQL snapshot',
  );
  assert.deepEqual(
    comparableCameraDomainConnections(afterRows),
    comparableCameraSqlConnections(afterConnection.rows.connections),
    'camera training after connections are not bound to the pending SQL snapshot',
  );

  const beforeById = new Map(beforeRows.map((row) => [String(row.id), row]));
  const afterById = new Map(afterRows.map((row) => [String(row.id), row]));
  for (const [id, beforeRow] of beforeById) {
    const afterRow = afterById.get(id);
    if (afterRow && afterRow.sourceInviteCodeValue !== beforeRow.sourceInviteCodeValue)
      throw new Error('camera submit changed a preexisting connection source invite value');
  }
  const targetRow = afterRows.find(
    (row) =>
      row.professionalAuthUid === target.professionalAuthUid &&
      row.studentAuthUid === target.studentAuthUid &&
      row.specialty === target.specialty,
  );
  if (!targetRow || targetRow.sourceInviteCodeValue !== inviteCode)
    throw new Error('camera pending connection source invite value is not bound to the live code');
}

const frozenNativeCameraSubmissionEvidencePaths = Object.freeze([
  'camera-connection-before.private.json',
  'camera-connection-pending.private.json',
  'camera-pending-card.private.json',
  'camera-isolation-before.private.json',
  'camera-isolation-after.private.json',
  'camera-training-before.private.json',
  'camera-training-after.private.json',
]);
export const nativeCameraSubmissionEvidencePaths = frozenNativeCameraSubmissionEvidencePaths;

const frozenNativeCameraInventoryEvidencePaths = Object.freeze([
  'camera-before.private.json',
  'camera-after.private.json',
  'camera-permission-before.private.json',
  'camera-permission-after.private.json',
]);
const frozenNativeCameraDenialFrameLabels = Object.freeze([
  'camera-prompt',
  'camera-guidance',
  'camera-manual',
]);
const frozenNativeCameraStagingFiles = Object.freeze([
  'fixtures.private.json',
  'fixtures-native-connection-isolation-ios.private.json',
  ...frozenNativeCameraInventoryEvidencePaths,
  'camera-prompt.png',
  'camera-guidance.png',
  'camera-manual.png',
  'camera-pending.png',
  'camera-prompt-hierarchy.json',
  'camera-guidance-hierarchy.json',
  'camera-manual-hierarchy.json',
  'camera-pending-hierarchy.json',
  'camera-coach-invite.png',
  'camera-coach-invite-hierarchy.json',
  'camera-coach-invite-code.private.json',
  'camera-prompt.yaml',
  'camera-guidance.yaml',
  'camera-manual.yaml',
  'camera-coach-invite.yaml',
  'camera-pending.yaml',
  'camera-live-manual-submit.yaml',
  ...frozenNativeCameraSubmissionEvidencePaths,
  'capture.private.json',
  'transport-observations.private.json',
  'native-auth-identities.private.json',
  'camera-runtime-metadata.private.json',
  'camera-runtime-adapter.private.json',
  'external-cleanup.private.json',
]);

export const nativeCameraRuntimeSidecarPaths = Object.freeze([
  'camera-runtime-metadata.private.json',
  'camera-runtime-adapter.private.json',
  'external-cleanup.private.json',
]);

const cameraRequirementRefs = ['SC-211', 'UC-002.9', 'AC-249', 'BL-018/P4-camera-denied'] as const;

type CameraSubmissionPreparation = {
  requirementRefs?: unknown;
  fixtureScope?: unknown;
  target?: unknown;
  coachCodeSource?: unknown;
  submissionRoute?: unknown;
  submissionStatus?: unknown;
  submissionRequestIds?: unknown;
  snapshotPaths?: unknown;
  unrelatedConnectionStateUnchanged?: unknown;
  unrelatedTrainingStateUnchanged?: unknown;
  nativePassingCases?: unknown;
  scope?: unknown;
  transportPreludeRequestIdFence?: unknown;
  transportPreludeObservationCount?: unknown;
  transportPreludeObservationPrefixSha256?: unknown;
  transportPreludeMarkerSource?: unknown;
  transportEndObservationCount?: unknown;
  transportEndObservationPrefixSha256?: unknown;
  transportEndMarkerSource?: unknown;
  transportStartRequestId?: unknown;
  transportEndRequestId?: unknown;
  transportRequestIds?: unknown;
  denialFrames?: unknown;
  fixtureEvidencePath?: unknown;
  fixtureHash?: unknown;
  isolationFixtureEvidencePath?: unknown;
  isolationFixtureHash?: unknown;
  isolationTarget?: unknown;
  studentAuthUid?: unknown;
  snapshotReferences?: unknown;
  domainSnapshotReferences?: unknown;
  trainingSnapshotReferences?: unknown;
  pendingFrame?: unknown;
  coachInviteEvidencePath?: unknown;
  coachInviteFrame?: unknown;
  coachInviteActionExecution?: unknown;
  submissionFlowReference?: unknown;
  submissionRequestBinding?: unknown;
};

type CameraSubmissionValidationInput = {
  root: string;
  backendRunId: string;
  targetOrigin: string;
  preparation: unknown;
  transport: readonly ProxyObservation[];
  captureKind?: string;
  captureMode?: string;
};

const nativeConnectionActionSourcePath = 'scripts/testing/native-connection-journey-core.ts';

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function currentNativeConnectionActionSourceSha256(): string {
  const sourcePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'native-connection-journey-core.ts',
  );
  return sha(readFileSync(sourcePath));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512)
    throw new Error(`${label} must be a bounded non-empty string`);
  return value;
}

function readJson(root: string, relative: string): unknown {
  try {
    return JSON.parse(readNativeEvidence(root, relative, true).toString('utf8'));
  } catch (error) {
    throw new Error(`Camera submission evidence ${relative} is unreadable`, {
      cause: error,
    });
  }
}

type OwnedEvidenceReference = {
  path: string;
  bytes: number;
  sha256: string;
  source?: string;
  runId?: string;
  scope?: string;
};

function requireEvidenceReference(
  root: string,
  value: unknown,
  expectedPath: string,
  label: string,
  privateRecord: boolean,
): { bytes: Buffer; reference: OwnedEvidenceReference } {
  const reference = record(value, `${label} reference`);
  if (
    reference.path !== expectedPath ||
    typeof reference.bytes !== 'number' ||
    !Number.isSafeInteger(reference.bytes) ||
    reference.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(String(reference.sha256))
  )
    throw new Error(`${label} reference is incomplete or points at an unexpected path`);
  const bytes = readNativeEvidence(root, expectedPath, privateRecord);
  if (reference.bytes !== bytes.length || reference.sha256 !== sha(bytes))
    throw new Error(`${label} reference does not match its owned bytes`);
  return {
    bytes,
    reference: reference as unknown as OwnedEvidenceReference,
  };
}

function pngCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function requirePng(bytes: Buffer, label: string): void {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (
    bytes.length < 33 ||
    bytes.length > 8 * 1024 * 1024 ||
    !bytes.subarray(0, 8).equals(signature)
  )
    throw new Error(`${label} is not a bounded PNG`);
  let offset = 8;
  let ihdr = false;
  let idat = false;
  let iend = false;
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const dataStart = offset + 8;
    const crcStart = dataStart + length;
    const end = crcStart + 4;
    if (
      end > bytes.length ||
      !/^[A-Za-z]{4}$/.test(type) ||
      type.charCodeAt(2) >= 97 ||
      bytes.readUInt32BE(crcStart) !== pngCrc32(bytes.subarray(offset + 4, crcStart))
    )
      throw new Error(`${label} has malformed PNG chunks`);
    const data = bytes.subarray(dataStart, crcStart);
    if (type === 'IHDR') {
      if (
        ihdr ||
        offset !== 8 ||
        length !== 13 ||
        data.readUInt32BE(0) === 0 ||
        data.readUInt32BE(4) === 0
      )
        throw new Error(`${label} has an invalid PNG header`);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024)
        throw new Error(`${label} dimensions are unbounded`);
      ihdr = true;
    } else if (type === 'IDAT') {
      if (!ihdr || iend) throw new Error(`${label} has an out-of-order IDAT`);
      idat = true;
      compressed.push(data);
    } else if (type === 'IEND') {
      if (!ihdr || !idat || length !== 0 || end !== bytes.length)
        throw new Error(`${label} has an invalid PNG end`);
      iend = true;
      break;
    } else if (type[0] === type[0].toUpperCase()) {
      throw new Error(`${label} has an unknown critical PNG chunk`);
    }
    offset = end;
  }
  if (!ihdr || !idat || !iend) throw new Error(`${label} is not a complete PNG`);
  try {
    const inflated = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: 32 * 1024 * 1024,
    });
    if (inflated.length === 0) throw new Error('empty image data');
  } catch (error) {
    throw new Error(`${label} has undecodable PNG image data`, {
      cause: error,
    });
  }
}

function requireHierarchy(bytes: Buffer, label: string): unknown {
  try {
    return parseNativeHierarchy(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not a valid native hierarchy`, {
      cause: error,
    });
  }
}

function requireDomainSnapshot(
  root: string,
  relative: string,
  backendRunId: string,
  scope: string,
  fixtureAuthUids: readonly string[],
  label: string,
): {
  value: CameraDomainSnapshotRecord;
  bytes: Buffer;
  reference: OwnedEvidenceReference;
} {
  const { bytes, reference } = requireEvidenceReference(
    root,
    {
      path: relative,
      bytes: readNativeEvidence(root, relative, true).length,
      sha256: sha(readNativeEvidence(root, relative, true)),
    },
    relative,
    label,
    true,
  );
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not JSON`, { cause: error });
  }
  assertTestingDocument('domain-snapshot-v1', value);
  const snapshot = record(value, label) as CameraDomainSnapshotRecord;
  if (snapshot.runId !== backendRunId || snapshot.scope !== scope || snapshot.readOnly !== true)
    throw new Error(`${label} is not bound to the owned read-only scope`);
  const ids = new Set(fixtureAuthUids);
  const training = snapshot.trainingPlans;
  const connections = snapshot.connections;
  if (!Array.isArray(training) || !Array.isArray(connections))
    throw new Error(`${label} lacks its complete domain projection`);
  for (const row of training) {
    const value = record(row, `${label} training row`);
    if (typeof value.studentAuthUid !== 'string' || !ids.has(value.studentAuthUid))
      throw new Error(`${label} training row is outside the owned fixture scope`);
    if (value.ownerProfessionalUid !== null && !ids.has(value.ownerProfessionalUid as string))
      throw new Error(`${label} training owner is outside the owned fixture scope`);
  }
  for (const row of connections) {
    const value = record(row, `${label} connection row`);
    if (!ids.has(value.studentAuthUid as string) || !ids.has(value.professionalAuthUid as string))
      throw new Error(`${label} connection row is outside the owned fixture scope`);
  }
  return { value: snapshot, bytes, reference };
}

function requireFixtureEvidence(
  root: string,
  capture: Record<string, unknown>,
  backendRunId: string,
): {
  fixtures: OwnedFixtures;
  fixtureAuthUids: string[];
  reference: OwnedEvidenceReference;
} {
  const evidence = record(capture.fixtureEvidence, 'camera fixture evidence');
  if (evidence.path !== 'fixtures.private.json' || capture.fixtureHash !== evidence.sha256)
    throw new Error('Camera capture is not bound to its owned fixture file');
  const { bytes, reference } = requireEvidenceReference(
    root,
    evidence,
    'fixtures.private.json',
    'camera fixture evidence',
    true,
  );
  assertTestingDocument('application-fixtures-v1', JSON.parse(bytes.toString('utf8')));
  const fixtures = JSON.parse(bytes.toString('utf8')) as OwnedFixtures;
  if (fixtures.runId !== backendRunId || fixtures.scope !== 'native-entry-ios')
    throw new Error('Camera fixture file belongs to a different owned session or scope');
  const accounts = Object.values(fixtures.accounts) as {
    authUid: string;
  }[];
  const fixtureAuthUids = accounts.map((account) => account.authUid).sort();
  if (
    new Set(fixtureAuthUids).size !== fixtureAuthUids.length ||
    fixtures.accounts.coach.role !== 'professional' ||
    fixtures.accounts.student.role !== 'student' ||
    fixtures.accounts.coach.authUid === fixtures.accounts.student.authUid
  )
    throw new Error('Camera fixture role identities are invalid or ambiguous');
  return { fixtures, fixtureAuthUids, reference };
}

function requireIsolationFixtureEvidence(
  root: string,
  capture: Record<string, unknown>,
  backendRunId: string,
  primaryFixtureAuthUids: readonly string[],
): {
  fixtures: OwnedFixtures;
  fixtureAuthUids: string[];
  reference: OwnedEvidenceReference;
  target: ReturnType<typeof requireTarget>;
} {
  const evidence = record(
    capture.connectionIsolationFixtureEvidence,
    'camera connection isolation fixture evidence',
  );
  const expectedPath = 'fixtures-native-connection-isolation-ios.private.json';
  if (
    evidence.path !== expectedPath ||
    evidence.source !== 'owned-session.fixtures' ||
    evidence.runId !== backendRunId ||
    evidence.scope !== 'native-connection-isolation-ios'
  )
    throw new Error('Camera isolation fixture evidence is not bound to the owned isolation scope');
  const { bytes, reference } = requireEvidenceReference(
    root,
    evidence,
    expectedPath,
    'camera isolation fixture evidence',
    true,
  );
  assertTestingDocument('application-fixtures-v1', JSON.parse(bytes.toString('utf8')));
  const fixtures = JSON.parse(bytes.toString('utf8')) as OwnedFixtures;
  if (fixtures.runId !== backendRunId || fixtures.scope !== 'native-connection-isolation-ios')
    throw new Error('Camera isolation fixture file belongs to a different owned scope');
  const accounts = Object.values(fixtures.accounts) as { authUid: string; role: string | null }[];
  const fixtureAuthUids = accounts.map((account) => account.authUid).sort();
  if (
    new Set(fixtureAuthUids).size !== fixtureAuthUids.length ||
    fixtures.accounts.coach.role !== 'professional' ||
    fixtures.accounts.student.role !== 'student' ||
    fixtures.accounts.coach.authUid === fixtures.accounts.student.authUid ||
    fixtureAuthUids.some((authUid) => primaryFixtureAuthUids.includes(authUid))
  )
    throw new Error('Camera isolation fixture role identities overlap or are ambiguous');
  return {
    fixtures,
    fixtureAuthUids,
    reference,
    target: {
      professionalAuthUid: fixtures.accounts.coach.authUid,
      studentAuthUid: fixtures.accounts.student.authUid,
      specialty: 'fitness_coach',
    },
  };
}

function requireCapturedSidecar(
  root: string,
  capture: Record<string, unknown>,
  field: 'transportEvidence' | 'nativeAuthIdentityEvidence',
  expectedPath: string,
  backendRunId: string,
  label: string,
): Buffer {
  const reference = record(capture[field], `${label} reference`);
  const expectedSource =
    field === 'transportEvidence'
      ? 'owned-api-proxy.observations'
      : 'owned-api-proxy.nativeAuthIdentities';
  if (
    reference.path !== expectedPath ||
    reference.source !== expectedSource ||
    reference.runId !== backendRunId ||
    reference.scope !== 'native-entry-ios'
  )
    throw new Error(`${label} is not bound to the owned capture run`);
  return requireEvidenceReference(root, reference, expectedPath, label, true).bytes;
}

type CoachInviteHierarchyNode = {
  attributes?: Record<string, unknown>;
  children?: unknown[];
};

type CoachInviteHierarchyLocation = {
  node: CoachInviteHierarchyNode;
  path: number[];
  ancestors: CoachInviteHierarchyNode[];
};

function coachInviteBounds(
  node: CoachInviteHierarchyNode,
): readonly [number, number, number, number] {
  const raw = node.attributes?.bounds;
  const match = typeof raw === 'string' && /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(raw);
  if (!match) throw new Error('Camera coach invite bounds are absent or malformed');
  const values = match.slice(1).map(Number);
  if (
    values.some((value) => !Number.isSafeInteger(value)) ||
    values[2] <= values[0] ||
    values[3] <= values[1]
  )
    throw new Error('Camera coach invite bounds have no positive area');
  return values as unknown as readonly [number, number, number, number];
}

function requireCoachInviteVisibility(
  node: CoachInviteHierarchyNode,
  hasValidatedVisibilityWitness: boolean,
): void {
  const attributes = node.attributes ?? {};
  const values = ['visible', 'visible-to-user']
    .filter((key) => Object.hasOwn(attributes, key))
    .map((key) => attributes[key]);
  if (values.length === 0) {
    if (!hasValidatedVisibilityWitness)
      throw new Error('Camera coach invite visibility lacks an owned command witness');
    return;
  }
  if (values.some((value) => value !== true && value !== 'true'))
    throw new Error('Camera coach invite visibility is false or ambiguous');
}

/**
 * Normalize the coach hierarchy only after the completed owned Maestro
 * witness has been validated. Missing visibility remains unknown without
 * that witness; it is never coerced to true.
 */
export function normalizeCoachInviteHierarchy(
  tree: unknown,
  hasValidatedVisibilityWitness: boolean,
): { inviteCode: string; screenPath: number[]; invitePath: number[] } {
  const screens: CoachInviteHierarchyLocation[] = [];
  const invites: CoachInviteHierarchyLocation[] = [];
  const seen = new WeakSet<object>();
  let count = 0;
  const visit = (value: unknown, path: number[], ancestors: CoachInviteHierarchyNode[]): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || path.length > 100)
      throw new Error('Camera coach invite hierarchy is malformed or unbounded');
    const object = value as CoachInviteHierarchyNode;
    if (seen.has(object) || ++count > 5000)
      throw new Error('Camera coach invite hierarchy contains a cycle or is unbounded');
    seen.add(object);
    const located = { node: object, path, ancestors };
    if (object.attributes?.['resource-id'] === 'pro.home.screen') screens.push(located);
    if (object.attributes?.['resource-id'] === 'pro.home.inviteCodeValue') invites.push(located);
    if (object.children !== undefined) {
      if (!Array.isArray(object.children))
        throw new Error('Camera coach invite hierarchy children are malformed');
      object.children.forEach((child, index) =>
        visit(child, [...path, index], [...ancestors, object]),
      );
    }
  };
  visit(tree, [], []);
  if (screens.length !== 1 || invites.length !== 1)
    throw new Error('Camera coach invite screen or control is absent or duplicated');
  const screen = screens[0];
  const invite = invites[0];
  const screenAncestor = invite.ancestors.indexOf(screen.node);
  if (screenAncestor < 0)
    throw new Error('Camera coach invite control is outside the authenticated coach home');
  for (const node of [screen.node, invite.node]) {
    if (node.attributes?.enabled !== true && node.attributes?.enabled !== 'true')
      throw new Error('Camera coach invite screen or control is not enabled');
    requireCoachInviteVisibility(node, hasValidatedVisibilityWitness);
  }
  for (const ancestor of invite.ancestors.slice(screenAncestor + 1)) {
    const attributes = ancestor.attributes ?? {};
    if (attributes.enabled === false || attributes.enabled === 'false')
      throw new Error('Camera coach invite control has a disabled ancestor');
    for (const key of ['visible', 'visible-to-user'])
      if (Object.hasOwn(attributes, key) && attributes[key] !== true && attributes[key] !== 'true')
        throw new Error('Camera coach invite control has a hidden or ambiguous ancestor');
  }
  const screenBounds = coachInviteBounds(screen.node);
  const inviteBounds = coachInviteBounds(invite.node);
  if (
    inviteBounds[0] < screenBounds[0] ||
    inviteBounds[1] < screenBounds[1] ||
    inviteBounds[2] > screenBounds[2] ||
    inviteBounds[3] > screenBounds[3]
  )
    throw new Error('Camera coach invite control bounds are outside the coach home');
  const text = invite.node.attributes?.accessibilityText;
  const match = typeof text === 'string' && /^(?:[^\r\n:]+: )?([A-F0-9]{8})$/.exec(text.trim());
  if (!match) throw new Error('Camera coach invite value has the wrong format');
  return {
    inviteCode: match[1],
    screenPath: screen.path,
    invitePath: invite.path,
  };
}

function requireTarget(value: unknown) {
  const target = record(value, 'camera submission target');
  const professionalAuthUid = nonEmptyString(
    target.professionalAuthUid,
    'camera submission professionalAuthUid',
  );
  const studentAuthUid = nonEmptyString(target.studentAuthUid, 'camera submission studentAuthUid');
  if (target.specialty !== 'fitness_coach')
    throw new Error('Camera submission target specialty is not fitness_coach');
  return {
    professionalAuthUid,
    studentAuthUid,
    specialty: 'fitness_coach' as const,
  };
}

function requireTransport(
  transport: readonly ProxyObservation[],
  targetOrigin: string,
  requestIds: readonly number[],
) {
  const routeHash = sha('/connections/invite-submissions');
  const allMatches = transport.filter((row) => row.method === 'POST' && row.pathHash === routeHash);
  if (allMatches.length !== 1)
    throw new Error('Camera submission requires exactly one native invite POST in the full stream');
  const matches = allMatches.filter(
    (row) => row.requestId >= requestIds[0] && row.requestId <= requestIds[requestIds.length - 1],
  );
  if (matches.length !== 1)
    throw new Error('Camera submission invite POST is outside the closed request window');
  const row = matches[0];
  if (
    row.status !== 201 ||
    row.outcome !== 'forwarded' ||
    row.requestProfile !== 'native' ||
    row.requestOrigin !== null ||
    row.targetOrigin !== targetOrigin ||
    row.faultAttemptId !== null ||
    row.requestId !== requestIds[0]
  )
    throw new Error('Camera invite POST is not an owned native forward');
}

function requireBackendProvenance(
  capture: Record<string, unknown>,
  backendRunId: string,
  targetOrigin: string,
): { apiPid: number; apiStarted: string; apiScript: string } {
  const backend = record(capture.backend, 'camera backend provenance');
  if (backend.runId !== backendRunId)
    throw new Error('Camera backend provenance run identity differs from snapshots');
  if (backend.backendAttemptId !== `${backendRunId}:first`)
    throw new Error('Camera backend provenance first attempt is not bound');
  if (backend.apiOrigin !== targetOrigin)
    throw new Error('Camera backend provenance origin differs from owned target');
  const apiProcess = record(backend.apiProcess, 'camera backend API process');
  const apiPid = apiProcess.pid;
  const apiStarted = nonEmptyString(apiProcess.started, 'camera backend API start identity');
  const apiScript = nonEmptyString(apiProcess.script, 'camera backend API script identity');
  if (typeof apiPid !== 'number' || !Number.isSafeInteger(apiPid) || apiPid <= 1)
    throw new Error('Camera backend API PID identity is invalid');
  const processes = backend.processes;
  if (!Array.isArray(processes)) throw new Error('Camera backend process ledger is missing');
  const apiRows = processes.filter(
    (value) => record(value, 'camera backend process').role === 'api',
  );
  if (apiRows.length !== 1) throw new Error('Camera backend API process is not unique');
  const ledgerApi = record(apiRows[0], 'camera backend API process ledger row');
  if (
    ledgerApi.pid !== apiPid ||
    ledgerApi.started !== apiStarted ||
    ledgerApi.script !== apiScript
  )
    throw new Error('Camera backend API process provenance is inconsistent');
  const connectionApi = record(capture.connectionApiIdentity, 'camera connection API identity');
  if (connectionApi.apiPid !== apiPid || connectionApi.targetOrigin !== targetOrigin)
    throw new Error('Camera connection API identity is not bound to backend provenance');
  return { apiPid, apiStarted, apiScript };
}

function requireCapturedFrameSources(
  root: string,
  capture: Record<string, unknown>,
  frame: Record<string, unknown>,
  label: string,
): void {
  const observations = capture.observations;
  if (!Array.isArray(observations)) throw new Error('Camera capture frame source list is missing');
  const matching = observations.filter((value) => {
    const row = record(value, 'camera capture frame source row');
    return (
      row.label === label &&
      row.hierarchyPath === frame.hierarchyPath &&
      row.screenshotPath === frame.screenshotPath
    );
  });
  if (matching.length !== 1)
    throw new Error(`Camera ${label} frame is not uniquely bound to an owned capture command`);
  const row = record(matching[0], 'camera capture frame source row');
  const device = record(capture.device, 'camera capture device');
  const deviceUdid = nonEmptyString(device.udid, 'camera capture device UDID');
  const backendRunId = record(capture.backend, 'camera backend provenance').runId;
  const expectedActor = label === 'camera-coach-invite' ? 'coach' : 'student';
  const initialAuth = record(capture.cameraInitialAuth, 'camera initial auth boundary');
  const switches = Array.isArray(capture.connectionAccountSwitches)
    ? capture.connectionAccountSwitches.map((value) => record(value, 'camera account switch'))
    : [];
  const actorBoundary =
    label === 'camera-coach-invite'
      ? switches.find((value) => value.actor === 'coach')
      : label === 'camera-pending'
        ? [...switches].reverse().find((value) => value.actor === 'student')
        : initialAuth;
  if (
    row.actor !== expectedActor ||
    typeof row.actorAuthUid !== 'string' ||
    !actorBoundary ||
    row.authRequestId !== actorBoundary.authRequestId ||
    row.actorAuthUid !== actorBoundary.actorAuthUid
  )
    throw new Error(`Camera ${label} actor/auth boundary is not bound to the selected frame`);
  const flow = record(row.flowReference, `Camera ${label} flow reference`);
  if (
    flow.path !== `${label}.yaml` ||
    flow.source !== 'owned-maestro-flow' ||
    flow.runId !== backendRunId ||
    flow.scope !== 'native-entry-ios'
  )
    throw new Error(`Camera ${label} flow source identity is incomplete`);
  requireEvidenceReference(root, flow, `${label}.yaml`, `Camera ${label} flow`, true);
  const hierarchy = record(row.hierarchyReference, `Camera ${label} hierarchy reference`);
  if (
    hierarchy.path !== frame.hierarchyPath ||
    hierarchy.source !== 'owned-maestro-hierarchy' ||
    hierarchy.runId !== backendRunId ||
    hierarchy.scope !== 'native-entry-ios'
  )
    throw new Error(`Camera ${label} hierarchy source identity is incomplete`);
  requireEvidenceReference(
    root,
    hierarchy,
    String(frame.hierarchyPath),
    `Camera ${label} hierarchy`,
    true,
  );
  const screenshot = record(row.screenshotReference, `Camera ${label} screenshot reference`);
  if (
    screenshot.path !== frame.screenshotPath ||
    screenshot.source !== 'owned-xcrun-simctl-screenshot' ||
    screenshot.runId !== backendRunId ||
    screenshot.scope !== 'native-entry-ios' ||
    screenshot.deviceUdid !== deviceUdid ||
    screenshot.commandLabel !== `${label}-screenshot`
  )
    throw new Error(`Camera ${label} screenshot source identity is incomplete`);
  requireEvidenceReference(
    root,
    screenshot,
    String(frame.screenshotPath),
    `Camera ${label} screenshot`,
    false,
  );
  const commandExecutions = capture.commandExecutions;
  if (!Array.isArray(commandExecutions))
    throw new Error(`Camera ${label} command execution ledger is missing`);
  const commandRows = commandExecutions
    .map((value) => record(value, 'camera command execution'))
    .filter((value) => value.label === `${label}-screenshot`);
  if (commandRows.length !== 1)
    throw new Error(`Camera ${label} screenshot command execution is not unique`);
  const commandRow = commandRows[0];
  const captureRoot = nonEmptyString(capture.captureRoot, 'camera capture artifact root');
  if (!path.isAbsolute(captureRoot) || path.resolve(captureRoot) !== captureRoot)
    throw new Error('Camera capture artifact root must be absolute and normalized');
  const expectedArgv = [
    'simctl',
    'io',
    deviceUdid,
    'screenshot',
    path.join(captureRoot, String(frame.screenshotPath)),
  ];
  if (
    commandRow.command !== 'xcrun' ||
    JSON.stringify(commandRow.argv) !== JSON.stringify(expectedArgv) ||
    commandRow.phase !== 'step' ||
    commandRow.execution !== 'completed' ||
    commandRow.cleanup !== 'cleaned' ||
    commandRow.childExitCode !== 0 ||
    commandRow.childSignal !== null ||
    typeof commandRow.deadlineMs !== 'number' ||
    !Number.isSafeInteger(commandRow.deadlineMs) ||
    commandRow.deadlineMs <= 0 ||
    typeof commandRow.logPath !== 'string' ||
    typeof commandRow.ownershipPath !== 'string'
  )
    throw new Error(`Camera ${label} screenshot command is not an owned completed step`);
  const commandReference = record(screenshot.commandExecution, `Camera ${label} command reference`);
  for (const key of [
    'label',
    'command',
    'phase',
    'execution',
    'cleanup',
    'childExitCode',
    'childSignal',
    'deadlineMs',
    'logPath',
    'ownershipPath',
  ])
    if (commandReference[key] !== commandRow[key])
      throw new Error(`Camera ${label} screenshot command reference is stale`);
  if (JSON.stringify(commandReference.argv) !== JSON.stringify(commandRow.argv))
    throw new Error(`Camera ${label} screenshot command argv reference is stale`);
}

function requireAuthIdentityProvenance(input: {
  root: string;
  capture: Record<string, unknown>;
  captureBackendRunId: string;
  fixtureAuthUids: readonly string[];
  targetOrigin: string;
  apiPid: number;
  target: ReturnType<typeof requireTarget>;
  transport: readonly ProxyObservation[];
}): {
  initialRequestId: number;
  coachRequestId: number;
  finalStudentRequestId: number;
} {
  const initial = record(input.capture.cameraInitialAuth, 'camera initial auth boundary');
  const switches = input.capture.connectionAccountSwitches;
  const initialBeforeRequestId = initial.beforeRequestId;
  const initialAfterRequestId = initial.afterRequestId;
  if (
    initial.actor !== 'student' ||
    initial.actorAuthUid !== input.target.studentAuthUid ||
    typeof initial.authRequestId !== 'number' ||
    !Number.isSafeInteger(initial.authRequestId) ||
    typeof initialBeforeRequestId !== 'number' ||
    !Number.isSafeInteger(initialBeforeRequestId) ||
    initialBeforeRequestId < 0 ||
    initial.authRequestId <= initialBeforeRequestId ||
    typeof initialAfterRequestId !== 'number' ||
    !Number.isSafeInteger(initialAfterRequestId) ||
    initialAfterRequestId < initial.authRequestId ||
    !isUnknownArray(switches) ||
    switches.length !== 2
  )
    throw new Error('Camera integrated capture lacks the initial and two switch boundaries');
  const switchRows = switches.map((value) => record(value, 'camera switch auth boundary'));
  const expected = [
    {
      actor: 'student',
      authUid: input.target.studentAuthUid,
      requestId: initial.authRequestId,
    },
    {
      actor: 'coach',
      authUid: input.target.professionalAuthUid,
      value: switchRows[0],
    },
    {
      actor: 'student',
      authUid: input.target.studentAuthUid,
      value: switchRows[1],
    },
  ].map((entry) => {
    if ('value' in entry) {
      const boundary = record(entry.value, 'camera switch auth boundary');
      const beforeRequestId = boundary.beforeRequestId;
      const afterRequestId = boundary.afterRequestId;
      if (
        boundary.actor !== entry.actor ||
        boundary.actorAuthUid !== entry.authUid ||
        typeof boundary.authRequestId !== 'number' ||
        !Number.isSafeInteger(boundary.authRequestId) ||
        typeof beforeRequestId !== 'number' ||
        !Number.isSafeInteger(beforeRequestId) ||
        typeof afterRequestId !== 'number' ||
        !Number.isSafeInteger(afterRequestId)
      )
        throw new Error('Camera switch auth boundary has the wrong actor or request');
      const previousAuthRequestId =
        entry.actor === 'coach' ? initial.authRequestId : switchRows[0].authRequestId;
      if (
        typeof previousAuthRequestId !== 'number' ||
        beforeRequestId < previousAuthRequestId ||
        boundary.authRequestId <= beforeRequestId ||
        afterRequestId < boundary.authRequestId
      )
        throw new Error('Camera switch auth boundary range is invalid');
      return {
        actor: entry.actor,
        authUid: entry.authUid,
        requestId: boundary.authRequestId,
      };
    }
    return entry;
  });
  const expectedRequestIds = expected.map((entry) => entry.requestId);
  if (
    new Set(expectedRequestIds).size !== expectedRequestIds.length ||
    expectedRequestIds.some(
      (requestId, index) => index > 0 && requestId <= expectedRequestIds[index - 1],
    )
  )
    throw new Error('Camera auth boundaries are not strictly ordered');
  const identityBytes = requireCapturedSidecar(
    input.root,
    input.capture,
    'nativeAuthIdentityEvidence',
    'native-auth-identities.private.json',
    input.captureBackendRunId,
    'Camera native auth identity evidence',
  );
  const identities = JSON.parse(identityBytes.toString('utf8')) as unknown;
  if (!Array.isArray(identities) || identities.length !== expected.length)
    throw new Error('Camera integrated capture has extra or missing auth identities');
  const authRows = input.transport.filter((row) => row.pathHash === sha('/auth/email/sign-in'));
  if (
    authRows.length !== expected.length ||
    authRows.some((row) => !expectedRequestIds.includes(row.requestId))
  )
    throw new Error('Camera integrated capture has an extra or unbound sign-in request');
  const allowlist = [...input.fixtureAuthUids].sort();
  const allowlistHash = sha(JSON.stringify(allowlist));
  let previousOrdinal = 0;
  for (const [index, value] of identities.entries()) {
    const identity = record(value, 'camera native auth identity');
    const requestId = identity.requestId;
    const ordinal = identity.ordinal;
    const expectedAuth = expected[index];
    const transport = input.transport.find((row) => row.requestId === expectedAuth.requestId);
    if (
      typeof requestId !== 'number' ||
      !Number.isSafeInteger(requestId) ||
      requestId < 1 ||
      requestId !== expectedAuth.requestId ||
      typeof ordinal !== 'number' ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 1 ||
      ordinal <= previousOrdinal ||
      identity.targetOrigin !== input.targetOrigin ||
      identity.apiPid !== input.apiPid ||
      identity.status !== 201 ||
      identity.verification !== 'verified' ||
      identity.verificationReason !== 'verified' ||
      typeof identity.authUid !== 'string' ||
      identity.authUid !== expectedAuth.authUid ||
      !allowlist.includes(identity.authUid) ||
      !transport ||
      transport.method !== 'POST' ||
      transport.pathHash !== sha('/auth/email/sign-in') ||
      transport.status !== 201 ||
      transport.outcome !== 'forwarded' ||
      transport.requestProfile !== 'native' ||
      transport.requestOrigin !== null ||
      transport.targetOrigin !== input.targetOrigin ||
      transport.faultAttemptId !== null ||
      identity.fixtureAuthUidAllowlistHash !== allowlistHash
    )
      throw new Error('Camera native auth identity provenance is invalid');
    previousOrdinal = ordinal;
  }
  return {
    initialRequestId: expected[0].requestId,
    coachRequestId: expected[1].requestId,
    finalStudentRequestId: expected[2].requestId,
  };
}

function requireTransportFile(
  root: string,
  capture: Record<string, unknown>,
  backendRunId: string,
  callerTransport: readonly ProxyObservation[],
  targetOrigin: string,
): readonly ProxyObservation[] {
  if (!Array.isArray(callerTransport)) throw new Error('Camera caller transport is not an array');
  const transportBytes = requireCapturedSidecar(
    root,
    capture,
    'transportEvidence',
    'transport-observations.private.json',
    backendRunId,
    'Camera transport evidence',
  );
  const fileTransport = JSON.parse(transportBytes.toString('utf8')) as unknown;
  if (!Array.isArray(fileTransport)) throw new Error('Camera transport file is not an array');
  assert.deepEqual(
    fileTransport,
    callerTransport,
    'Camera caller transport differs from raw bytes',
  );
  const rows = fileTransport.map((value) => record(value, 'camera transport row'));
  const ids = rows.map((row) => row.requestId);
  if (
    ids.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('Camera transport request identities are not unique and bounded');
  for (const value of callerTransport) {
    const row = record(value, 'camera transport row');
    const mutation = row.method !== 'GET' && row.method !== 'HEAD';
    if (
      mutation &&
      (row.requestProfile !== 'native' ||
        row.requestOrigin !== null ||
        row.targetOrigin !== targetOrigin ||
        row.faultAttemptId !== null)
    )
      throw new Error('Camera transport contains an unowned or faulted mutation');
  }
  return fileTransport as unknown as readonly ProxyObservation[];
}

function requireDenialPreparation(input: {
  root: string;
  backendRunId: string;
  capture: Record<string, unknown>;
  preparation: CameraSubmissionPreparation;
  transport: readonly ProxyObservation[];
  fixtureAuthUids: readonly string[];
  fixtureStudentAuthUid: string;
}): void {
  const device = record(input.capture.device, 'camera capture device');
  const deviceUdid = nonEmptyString(device.udid, 'camera capture device UDID');
  const initialAuth = record(input.capture.cameraInitialAuth, 'camera initial auth boundary');
  const initialAuthAfterRequestId = initialAuth.afterRequestId;
  const preludeFence = input.preparation.transportPreludeRequestIdFence;
  const preludeObservationCount = input.preparation.transportPreludeObservationCount;
  const preludeObservationPrefixSha256 = input.preparation.transportPreludeObservationPrefixSha256;
  const preludeMarkerSource = input.preparation.transportPreludeMarkerSource;
  const endObservationCount = input.preparation.transportEndObservationCount;
  const endObservationPrefixSha256 = input.preparation.transportEndObservationPrefixSha256;
  const endMarkerSource = input.preparation.transportEndMarkerSource;
  const start = input.preparation.transportStartRequestId;
  const end = input.preparation.transportEndRequestId;
  const requestIds = input.preparation.transportRequestIds;
  if (
    typeof preludeFence !== 'number' ||
    !Number.isSafeInteger(preludeFence) ||
    preludeFence < 0 ||
    typeof preludeObservationCount !== 'number' ||
    !Number.isSafeInteger(preludeObservationCount) ||
    preludeObservationCount < 0 ||
    typeof preludeObservationPrefixSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(preludeObservationPrefixSha256) ||
    preludeMarkerSource !== 'owned-api-proxy.requestIdFence+observations' ||
    typeof endObservationCount !== 'number' ||
    !Number.isSafeInteger(endObservationCount) ||
    endObservationCount < 0 ||
    typeof endObservationPrefixSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(endObservationPrefixSha256) ||
    endMarkerSource !== 'owned-api-proxy.waitForQuiescence+requestIdFence+observations' ||
    typeof initialAuthAfterRequestId !== 'number' ||
    !Number.isSafeInteger(initialAuthAfterRequestId) ||
    initialAuthAfterRequestId < 0 ||
    typeof start !== 'number' ||
    !Number.isSafeInteger(start) ||
    start !== preludeFence + 1 ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(end) ||
    end < start ||
    !Array.isArray(requestIds) ||
    requestIds.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value))
  )
    throw new Error('Camera denial transport boundary metadata is missing');
  if (preludeFence < initialAuthAfterRequestId)
    throw new Error('Camera denial prelude is not bound to the authenticated student');
  const prelude = input.transport.filter((row) => row.requestId <= preludeFence);
  if (
    preludeObservationCount !== preludeFence ||
    prelude.length !== preludeObservationCount ||
    sha(JSON.stringify(prelude)) !== preludeObservationPrefixSha256 ||
    [...new Set(prelude.map((row) => row.requestId))].length !== prelude.length ||
    [...prelude.map((row) => row.requestId)]
      .sort((left, right) => left - right)
      .some((requestId, index) => requestId !== index + 1)
  )
    throw new Error('Camera denial prelude marker is not bound to the complete raw prefix');
  const endPrefix = input.transport.filter((row) => row.requestId <= end);
  if (
    endObservationCount !== end ||
    endPrefix.length !== endObservationCount ||
    sha(JSON.stringify(endPrefix)) !== endObservationPrefixSha256 ||
    [...new Set(endPrefix.map((row) => row.requestId))].length !== endPrefix.length ||
    [...endPrefix]
      .map((row) => row.requestId)
      .sort((left, right) => left - right)
      .some((requestId, index) => requestId !== index + 1)
  )
    throw new Error('Camera denial end marker is not bound to a complete quiesced raw snapshot');
  const preSubmit = endPrefix.filter((row) => row.requestId >= start && row.requestId <= end);
  if (
    preSubmit.length === 0 ||
    preSubmit.length !== end - preludeFence ||
    [...preSubmit]
      .map((row) => row.requestId)
      .sort((left, right) => left - right)
      .some((requestId, index) => requestId !== start + index) ||
    JSON.stringify(preSubmit.map((row) => row.requestId)) !== JSON.stringify(requestIds)
  )
    throw new Error('Camera denial transport boundary is not bound to raw observations');
  if (preSubmit.some((row) => row.method !== 'GET' && row.method !== 'HEAD'))
    throw new Error('Camera denial transport window contains an undeclared mutation');
  const initialAuthRows = input.transport.filter(
    (row) => row.requestId === initialAuth.authRequestId,
  );
  if (initialAuthRows.length !== 1)
    throw new Error('Camera initial auth request is not bound to the raw transport');
  validateIosCameraPreparation(input.root, input.backendRunId, deviceUdid, input.preparation, [
    ...initialAuthRows,
    ...preSubmit,
  ]);
  if (input.preparation.studentAuthUid !== input.fixtureStudentAuthUid)
    throw new Error('Camera denial student differs from the owned integrated student');
  const snapshotReferences = input.preparation.snapshotReferences;
  if (!Array.isArray(snapshotReferences) || snapshotReferences.length !== 2)
    throw new Error('Camera denial snapshots lack source-byte references');
  const expectedSnapshotPaths = ['camera-before.private.json', 'camera-after.private.json'];
  for (const [index, value] of snapshotReferences.entries()) {
    const reference = record(value, 'camera denial snapshot reference');
    if (
      reference.path !== expectedSnapshotPaths[index] ||
      reference.source !== 'owned-session.snapshot' ||
      reference.runId !== input.backendRunId ||
      reference.scope !== 'native-entry-ios'
    )
      throw new Error('Camera denial snapshot source identity is incomplete');
    requireEvidenceReference(
      input.root,
      reference,
      expectedSnapshotPaths[index],
      'camera denial snapshot',
      true,
    );
  }
  const denialBefore = requireDomainSnapshot(
    input.root,
    'camera-before.private.json',
    input.backendRunId,
    'native-entry-ios',
    input.fixtureAuthUids,
    'camera denial before snapshot',
  );
  const denialAfter = requireDomainSnapshot(
    input.root,
    'camera-after.private.json',
    input.backendRunId,
    'native-entry-ios',
    input.fixtureAuthUids,
    'camera denial after snapshot',
  );
  assert.deepEqual(
    denialAfter.value,
    denialBefore.value,
    'Camera denial changed the complete owned domain projection',
  );
  const frames = input.preparation.denialFrames;
  if (!Array.isArray(frames) || frames.length !== frozenNativeCameraDenialFrameLabels.length)
    throw new Error('Camera denial screenshots and hierarchies are not recorded');
  const observations = input.capture.observations;
  if (!Array.isArray(observations)) throw new Error('Camera capture frames are missing');
  for (const [index, value] of frames.entries()) {
    const frame = record(value, 'camera denial frame');
    const label = frozenNativeCameraDenialFrameLabels[index];
    const expectedViewId =
      label === 'camera-prompt'
        ? 'STATE-camera-prompt'
        : label === 'camera-guidance'
          ? 'STATE-camera-guidance'
          : 'SCR-student-professionals';
    if (
      frame.label !== label ||
      frame.viewId !== expectedViewId ||
      frame.hierarchyPath !== `${label}-hierarchy.json` ||
      frame.screenshotPath !== `${label}.png` ||
      typeof frame.hierarchyBytes !== 'number' ||
      typeof frame.screenshotBytes !== 'number' ||
      !/^[a-f0-9]{64}$/.test(String(frame.hierarchySha256)) ||
      !/^[a-f0-9]{64}$/.test(String(frame.screenshotSha256))
    )
      throw new Error('Camera denial frame metadata is incomplete or mislabeled');
    const hierarchy = readNativeEvidence(input.root, frame.hierarchyPath, true);
    const screenshot = readNativeEvidence(input.root, frame.screenshotPath, false);
    const tree = requireHierarchy(hierarchy, `${label} hierarchy`);
    requirePng(screenshot, `${label} screenshot`);
    if (
      label === 'camera-prompt' &&
      (!nativeHierarchyHasAttribute(tree, 'accessibilityText', 'Allow') ||
        !["Don't Allow", 'Don’t Allow'].some((control) =>
          nativeHierarchyHasAttribute(tree, 'accessibilityText', control),
        ))
    )
      throw new Error('Camera prompt hierarchy lacks both platform permission controls');
    if (
      label === 'camera-guidance' &&
      (!nativeHierarchyHasAttribute(tree, 'resource-id', 'student.professionals.submitError') ||
        !nativeHierarchyHasAttribute(tree, 'resource-id', 'student.professionals.codeInput'))
    )
      throw new Error('Camera guidance hierarchy lacks the documented manual fallback');
    if (
      label === 'camera-manual' &&
      (!nativeHierarchyHasAttribute(tree, 'resource-id', 'student.professionals.codeInput') ||
        !nativeHierarchyHasAttribute(tree, 'resource-id', 'student.professionals.connectButton'))
    )
      throw new Error('Camera manual hierarchy lacks its populated input and submit control');
    if (
      frame.hierarchyBytes !== hierarchy.length ||
      frame.screenshotBytes !== screenshot.length ||
      frame.hierarchySha256 !== sha(hierarchy) ||
      frame.screenshotSha256 !== sha(screenshot)
    )
      throw new Error('Camera denial frame hash or size does not match owned bytes');
    const matching = observations.filter((candidate) => {
      const row = record(candidate, 'camera capture frame');
      return (
        row.viewId === expectedViewId &&
        row.hierarchyPath === frame.hierarchyPath &&
        row.screenshotPath === frame.screenshotPath
      );
    });
    if (matching.length !== 1)
      throw new Error('Camera denial frame is not uniquely captured by the owned report');
    requireCapturedFrameSources(input.root, input.capture, frame, label);
  }
}

function requireSnapshotIdentity(
  value: unknown,
  backendRunId: string,
  scope: string,
  fixtureAuthUids: readonly string[] | undefined,
  target: ReturnType<typeof requireTarget>,
): OwnedConnectionSnapshot {
  const snapshot = value as OwnedConnectionSnapshot;
  const expected: Parameters<typeof requireConnectionSnapshot>[1] = {
    runId: backendRunId,
    scope,
    target,
  };
  if (fixtureAuthUids !== undefined) expected.fixtureAuthUids = fixtureAuthUids;
  requireConnectionSnapshot(snapshot, expected);
  return snapshot;
}

function requirePendingCard(
  value: unknown,
  pending: OwnedConnectionSnapshot,
  root: string,
  backendRunId: string,
  fixtureAuthUids: readonly string[],
  target: ReturnType<typeof requireTarget>,
) {
  const card = record(value, 'camera pending card');
  const connection = pending.rows.connections.filter(
    (row) =>
      row.professionalAuthUid === target.professionalAuthUid &&
      row.studentAuthUid === target.studentAuthUid &&
      row.specialty === target.specialty,
  );
  if (connection.length !== 1) throw new Error('Camera pending connection identity is ambiguous');
  const id = connection[0].id;
  if (
    typeof card.cardSelector !== 'string' ||
    !/^student\.professionals\.connectionCard\.\d+$/.test(card.cardSelector) ||
    card.pendingMarkerSelector !== `student.professionals.connectionPending.${id}`
  )
    throw new Error('Camera pending card is not bound to the SQL connection identity');
  const provenance = record(card.provenance, 'camera pending card provenance');
  if (
    provenance.checkpoint !== 'pending' ||
    provenance.runId !== backendRunId ||
    provenance.scope !== 'native-entry-ios' ||
    JSON.stringify(provenance.fixtureAuthUids) !== JSON.stringify([...fixtureAuthUids].sort()) ||
    JSON.stringify(provenance.target) !== JSON.stringify(target)
  )
    throw new Error('Camera pending card provenance is stale or mismatched');
  const pendingText = record(card.pendingText, 'camera pending text');
  if (
    typeof pendingText.selector !== 'string' ||
    !/^[a-f0-9]{64}$/.test(String(pendingText.sha256)) ||
    !Array.isArray(pendingText.path)
  )
    throw new Error('Camera pending card guidance evidence is incomplete');
  if (
    card.hierarchyPath !== 'camera-pending-hierarchy.json' ||
    card.hierarchySha256 !== sha(readNativeEvidence(root, 'camera-pending-hierarchy.json', true))
  )
    throw new Error('Camera pending card is not hash-bound to the captured hierarchy');
  const pendingTree = requireHierarchy(
    readNativeEvidence(root, 'camera-pending-hierarchy.json', true),
    'camera pending hierarchy',
  );
  const expectedScope: NativeConnectionTargetScope = {
    runId: backendRunId,
    scope: 'native-entry-ios',
    fixtureAuthUids,
    professionalAuthUid: target.professionalAuthUid,
    studentAuthUid: target.studentAuthUid,
  };
  const actual = resolvePendingStudentConnectionCard({
    tree: pendingTree,
    snapshot: pending,
    target: expectedScope,
    expectedPendingGuidance: enUS['relationship.pending.helper'],
  });
  assert.deepEqual(card.pendingText, actual.pendingText, 'Pending card guidance is not tree-bound');
  assert.deepEqual(card.pendingMarkerPath, actual.pendingMarkerPath);
  assert.deepEqual(card.cardPath, actual.cardPath);
}

function requirePendingFrame(
  root: string,
  capture: Record<string, unknown>,
  preparation: CameraSubmissionPreparation,
): void {
  const frame = record(preparation.pendingFrame, 'camera pending frame');
  if (
    frame.viewId !== 'STATE-connection-pending' ||
    frame.hierarchyPath !== 'camera-pending-hierarchy.json' ||
    frame.screenshotPath !== 'camera-pending.png' ||
    typeof frame.hierarchyBytes !== 'number' ||
    typeof frame.screenshotBytes !== 'number' ||
    !/^[a-f0-9]{64}$/.test(String(frame.hierarchySha256)) ||
    !/^[a-f0-9]{64}$/.test(String(frame.screenshotSha256))
  )
    throw new Error('Camera pending frame metadata is incomplete or mislabeled');
  const hierarchy = readNativeEvidence(root, 'camera-pending-hierarchy.json', true);
  const screenshot = readNativeEvidence(root, 'camera-pending.png', false);
  const tree = requireHierarchy(hierarchy, 'camera pending hierarchy');
  requirePng(screenshot, 'camera pending screenshot');
  if (
    frame.hierarchyBytes !== hierarchy.length ||
    frame.hierarchySha256 !== sha(hierarchy) ||
    frame.screenshotBytes !== screenshot.length ||
    frame.screenshotSha256 !== sha(screenshot)
  )
    throw new Error('Camera pending frame hash or size does not match owned bytes');
  const observations = capture.observations;
  if (
    !Array.isArray(observations) ||
    observations.filter((value) => {
      const row = record(value, 'camera pending capture frame');
      return (
        row.viewId === frame.viewId &&
        row.hierarchyPath === frame.hierarchyPath &&
        row.screenshotPath === frame.screenshotPath
      );
    }).length !== 1
  )
    throw new Error('Camera pending frame is not uniquely captured by the owned report');
  requireCapturedFrameSources(root, capture, frame, 'camera-pending');
  if (!tree || typeof tree !== 'object') throw new Error('Camera pending hierarchy is empty');
}

export function requireCoachInviteActionExecution(
  root: string,
  capture: Record<string, unknown>,
  digest: Record<string, unknown>,
): void {
  const flowBytes = readNativeEvidence(root, 'camera-coach-invite.yaml', true);
  const flowText = flowBytes.toString('utf8');
  const documents = YAML.parseAllDocuments(flowText);
  if (
    documents.length !== 2 ||
    documents.some((document) => document.errors.length > 0) ||
    !documents[0].toJS() ||
    typeof documents[0].toJS() !== 'object' ||
    !Array.isArray(documents[1].toJS())
  )
    throw new Error('Camera coach invite flow is not a complete two-document Maestro flow');
  const header = documents[0].toJS() as Record<string, unknown>;
  if (
    header.appId !== 'com.edufelip.mychampions.dev' ||
    header.name !== 'Native inventory camera-coach-invite'
  )
    throw new Error('Camera coach invite flow header is not bound to the owned app and label');
  const commands = documents[1].toJS() as unknown[];
  const boundedScrolls = commands.filter(
    (command) =>
      command &&
      typeof command === 'object' &&
      !Array.isArray(command) &&
      Object.keys(command as Record<string, unknown>).length === 1 &&
      Object.prototype.hasOwnProperty.call(command, 'scrollUntilVisible'),
  );
  if (boundedScrolls.length !== 1)
    throw new Error('Camera coach invite flow must contain one bounded visibility scroll');
  const scroll = (boundedScrolls[0] as { scrollUntilVisible?: unknown }).scrollUntilVisible;
  if (
    !scroll ||
    typeof scroll !== 'object' ||
    Array.isArray(scroll) ||
    !('element' in scroll) ||
    !scroll.element ||
    typeof scroll.element !== 'object' ||
    Array.isArray(scroll.element) ||
    (scroll.element as { id?: unknown }).id !== 'pro.home.inviteCodeValue' ||
    (scroll as { direction?: unknown }).direction !== 'DOWN' ||
    (scroll as { timeout?: unknown }).timeout !== 30000 ||
    (scroll as { centerElement?: unknown }).centerElement !== true
  )
    throw new Error('Camera coach invite flow has an unbounded or foreign visibility action');
  const flowHasForbiddenAction = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(flowHasForbiddenAction);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) =>
        ['runFlow', 'runScript', 'point', 'index'].includes(key) || flowHasForbiddenAction(nested),
    );
  };
  if (flowHasForbiddenAction(commands))
    throw new Error('Camera coach invite flow contains an unsupported action escape');
  const commandExecutions = capture.commandExecutions;
  if (!Array.isArray(commandExecutions))
    throw new Error('Camera coach invite command execution ledger is missing');
  const commandRows = commandExecutions
    .map((value) => record(value, 'camera coach invite command execution'))
    .filter((value) => value.label === 'camera-coach-invite');
  if (commandRows.length !== 1)
    throw new Error('Camera coach invite command execution is not unique');
  const commandRow = commandRows[0];
  const captureRoot = nonEmptyString(capture.captureRoot, 'camera capture artifact root');
  const device = record(capture.device, 'camera capture device');
  const deviceUdid = nonEmptyString(device.udid, 'camera capture device udid');
  const expectedCommandArgv = [
    '--no-ansi',
    '--udid',
    deviceUdid,
    'test',
    '--debug-output',
    path.join(captureRoot, 'camera-coach-invite-debug'),
    '--test-output-dir',
    path.join(captureRoot, 'camera-coach-invite-artifacts'),
    path.join(captureRoot, 'camera-coach-invite.yaml'),
  ];
  if (
    !path.isAbsolute(captureRoot) ||
    path.resolve(captureRoot) !== captureRoot ||
    commandRow.command !== 'maestro' ||
    commandRow.phase !== 'step' ||
    commandRow.execution !== 'completed' ||
    commandRow.cleanup !== 'cleaned' ||
    commandRow.childExitCode !== 0 ||
    commandRow.childSignal !== null ||
    typeof commandRow.deadlineMs !== 'number' ||
    !Number.isSafeInteger(commandRow.deadlineMs) ||
    commandRow.deadlineMs <= 0 ||
    typeof commandRow.logPath !== 'string' ||
    typeof commandRow.ownershipPath !== 'string'
  )
    throw new Error('Camera coach invite command is not an owned completed step');
  const commandArgv = commandRow.argv;
  if (
    !Array.isArray(commandArgv) ||
    JSON.stringify(commandArgv) !== JSON.stringify(expectedCommandArgv)
  )
    throw new Error(
      'Camera coach invite command is not bound to the full owned Maestro invocation',
    );
  const actionExecution = record(digest.actionExecution, 'camera coach invite action execution');
  assert.deepEqual(
    actionExecution,
    {
      label: commandRow.label,
      command: commandRow.command,
      argv: commandArgv,
      phase: commandRow.phase,
      execution: commandRow.execution,
      cleanup: commandRow.cleanup,
      childExitCode: commandRow.childExitCode,
      childSignal: commandRow.childSignal,
      deadlineMs: commandRow.deadlineMs,
      logPath: commandRow.logPath,
      ownershipPath: commandRow.ownershipPath,
    },
    'Camera coach invite action is not bound to the actual command ledger row',
  );
}

function requireCoachInviteEvidence(input: {
  root: string;
  capture: Record<string, unknown>;
  preparation: CameraSubmissionPreparation;
  target: ReturnType<typeof requireTarget>;
  backendRunId: string;
  coachAuthRequestId: number;
  submissionRequestIds: readonly number[];
  transport: readonly ProxyObservation[];
}): string {
  if (input.preparation.coachCodeSource !== 'authenticated-coach-home-ui')
    throw new Error('Camera coach invite source is not the authenticated coach UI');
  if (input.preparation.coachInviteEvidencePath !== 'camera-coach-invite-code.private.json')
    throw new Error('Camera coach invite digest path is not fixed');
  const frame = record(input.preparation.coachInviteFrame, 'camera coach invite frame');
  if (
    frame.actor !== 'coach' ||
    frame.actorAuthUid !== input.target.professionalAuthUid ||
    frame.authRequestId !== input.coachAuthRequestId ||
    frame.viewId !== 'SCR-pro-home' ||
    frame.hierarchyPath !== 'camera-coach-invite-hierarchy.json' ||
    frame.screenshotPath !== 'camera-coach-invite.png' ||
    !Array.isArray(frame.screenNodePath) ||
    !Array.isArray(frame.inviteNodePath) ||
    !/^[a-f0-9]{64}$/.test(String(frame.hierarchySha256)) ||
    !/^[a-f0-9]{64}$/.test(String(frame.screenshotSha256)) ||
    frame.submissionRequestIds === undefined
  )
    throw new Error('Camera coach invite frame metadata is incomplete');
  assert.deepEqual(frame.submissionRequestIds, input.submissionRequestIds);
  requireCapturedFrameSources(input.root, input.capture, frame, 'camera-coach-invite');
  const hierarchy = readNativeEvidence(input.root, 'camera-coach-invite-hierarchy.json', true);
  const screenshot = readNativeEvidence(input.root, 'camera-coach-invite.png', false);
  requirePng(screenshot, 'camera coach invite screenshot');
  if (
    frame.hierarchyBytes !== hierarchy.length ||
    frame.hierarchySha256 !== sha(hierarchy) ||
    frame.screenshotBytes !== screenshot.length ||
    frame.screenshotSha256 !== sha(screenshot)
  )
    throw new Error('Camera coach invite frame hash or size does not match owned bytes');
  const tree = requireHierarchy(hierarchy, 'camera coach invite hierarchy');
  const digest = record(
    readJson(input.root, 'camera-coach-invite-code.private.json'),
    'camera coach invite digest',
  );
  if (
    digest.schemaVersion !== 1 ||
    digest.source !== 'authenticated-coach-home-ui' ||
    digest.actor !== 'coach' ||
    digest.actorAuthUid !== input.target.professionalAuthUid ||
    digest.authRequestId !== input.coachAuthRequestId ||
    digest.inviteCodeSha256 !== frame.inviteCodeSha256 ||
    digest.inviteCodeBytes !== frame.inviteCodeBytes ||
    digest.submissionRequestIds === undefined
  )
    throw new Error('Camera coach invite digest file is not bound to the UI and auth boundary');
  // The witness must be bound before a hierarchy with missing visibility
  // attributes can be normalized. Missing visibility remains unknown without
  // this completed, full-argv Maestro command.
  requireCoachInviteActionExecution(input.root, input.capture, digest);
  const normalized = normalizeCoachInviteHierarchy(tree, true);
  assert.deepEqual(normalized.screenPath, frame.screenNodePath);
  assert.deepEqual(normalized.invitePath, frame.inviteNodePath);
  const inviteCode = normalized.inviteCode;
  if (
    frame.inviteCodeSha256 !== sha(inviteCode) ||
    frame.inviteCodeBytes !== Buffer.byteLength(inviteCode)
  )
    throw new Error('Camera coach invite digest does not match the captured UI code');
  const observations = input.capture.observations;
  if (
    !Array.isArray(observations) ||
    observations.filter((value) => {
      const row = record(value, 'camera observation');
      return (
        row.viewId === 'SCR-pro-home' &&
        row.hierarchyPath === frame.hierarchyPath &&
        row.screenshotPath === frame.screenshotPath
      );
    }).length !== 1
  )
    throw new Error('Camera coach invite frame is not uniquely present in the capture');
  requireCapturedFrameSources(input.root, input.capture, frame, 'camera-coach-invite');
  assert.deepEqual(digest.submissionRequestIds, input.submissionRequestIds);

  const flowReference = record(
    input.preparation.submissionFlowReference,
    'camera submission flow reference',
  );
  if (
    flowReference.path !== 'camera-live-manual-submit.yaml' ||
    flowReference.source !== 'owned-maestro-flow' ||
    flowReference.runId !== input.backendRunId ||
    flowReference.scope !== 'native-entry-ios' ||
    flowReference.sourcePath !== nativeConnectionActionSourcePath ||
    flowReference.sourceSha256 !== currentNativeConnectionActionSourceSha256() ||
    flowReference.actionSha256 !==
      sha(buildNativeConnectionSubmissionActions(IOS_CONNECTION_PLATFORM, inviteCode))
  )
    throw new Error('Camera submission flow source identity is not current and owned');
  const flowBytes = requireEvidenceReference(
    input.root,
    flowReference,
    'camera-live-manual-submit.yaml',
    'Camera submission flow',
    true,
  ).bytes;
  const expectedActions = buildNativeConnectionSubmissionActions(
    IOS_CONNECTION_PLATFORM,
    inviteCode,
  );
  const flowText = flowBytes.toString('utf8');
  if (
    flowText.split(expectedActions).length !== 2 ||
    /(?:runFlow|runScript|point:|index:)/.test(flowText)
  )
    throw new Error('Camera submission flow is not the exact bounded native action');

  const submitted = input.transport.find((row) => row.requestId === input.submissionRequestIds[0]);
  const requestBinding = record(
    input.preparation.submissionRequestBinding,
    'camera submission request binding',
  );
  if (!submitted)
    throw new Error('Camera submission flow is not bound to its exact native request');
  assert.deepEqual(requestBinding, {
    requestId: submitted.requestId,
    method: submitted.method,
    pathHash: submitted.pathHash,
    requestOrigin: submitted.requestOrigin,
    requestProfile: submitted.requestProfile,
    targetOrigin: submitted.targetOrigin,
    status: submitted.status,
    outcome: submitted.outcome,
    faultAttemptId: submitted.faultAttemptId,
  });
  return inviteCode;
}

/**
 * Validates the camera-integrated manual submission only. This is intentionally
 * separate from validateIosCameraPreparation: the old inventory observer may
 * never acquire or submit a relationship invite.
 */
export function validateIosCameraSubmissionPreparation(
  input: CameraSubmissionValidationInput,
): void {
  if (
    input.captureKind !== undefined &&
    input.captureKind !== 'private-owned-native-camera-execution-not-public-receipt'
  )
    throw new Error('Camera submission validator received a non-camera capture kind');
  if (input.captureMode !== undefined && input.captureMode !== 'integration')
    throw new Error('Camera submission validator received a non-integration capture mode');
  requireIntegratedLoopbackOrigin(input.targetOrigin);
  const capture = record(readJson(input.root, 'capture.private.json'), 'camera capture report');
  const build = record(capture.build, 'camera capture build provenance');
  const buildApiOrigin = nonEmptyString(build.apiOrigin, 'camera capture app origin');
  const buildMetroOrigin = nonEmptyString(build.metroOrigin, 'camera capture Metro origin');
  if (input.targetOrigin === buildApiOrigin || input.targetOrigin === buildMetroOrigin)
    throw new Error('Camera API target origin must be distinct from app and Metro origins');
  if (
    capture.kind !== 'private-owned-native-camera-execution-not-public-receipt' ||
    capture.mode !== 'integration' ||
    capture.platform !== 'ios' ||
    capture.charter !== 'camera-denied' ||
    capture.result !== 'observed' ||
    capture.cleanup !== 'cleaned' ||
    capture.nativePassingCases !== 0
  )
    throw new Error('Camera submission capture report is not an observed private integration');
  const backend = requireBackendProvenance(capture, input.backendRunId, input.targetOrigin);
  const transport = requireTransportFile(
    input.root,
    capture,
    input.backendRunId,
    input.transport,
    input.targetOrigin,
  );
  const fixtureEvidence = requireFixtureEvidence(input.root, capture, input.backendRunId);
  const isolationFixtureEvidence = requireIsolationFixtureEvidence(
    input.root,
    capture,
    input.backendRunId,
    fixtureEvidence.fixtureAuthUids,
  );
  const observations = capture.observations;
  if (
    !Array.isArray(observations) ||
    !observations.some((frame) => {
      const row = record(frame, 'camera capture frame');
      return (
        row.viewId === 'STATE-connection-pending' &&
        row.hierarchyPath === 'camera-pending-hierarchy.json' &&
        row.screenshotPath === 'camera-pending.png'
      );
    })
  )
    throw new Error('Camera submission pending UI is not recorded by the owned capture');
  const capturedPreparation = record(
    capture.cameraSubmissionPreparation,
    'camera capture submission preparation',
  );
  assert.deepEqual(
    input.preparation,
    capturedPreparation,
    'Camera caller preparation differs from the owned capture report',
  );
  const row = capturedPreparation as CameraSubmissionPreparation;
  if (!isUnknownArray(row.requirementRefs))
    throw new Error('Camera submission preparation metadata is missing');
  const denialPreparation = record(
    capture.cameraPreparation,
    'camera denial preparation',
  ) as CameraSubmissionPreparation;
  requireDenialPreparation({
    root: input.root,
    backendRunId: input.backendRunId,
    capture,
    preparation: denialPreparation,
    transport,
    fixtureAuthUids: fixtureEvidence.fixtureAuthUids,
    fixtureStudentAuthUid: fixtureEvidence.fixtures.accounts.student.authUid,
  });
  assert.deepEqual([...row.requirementRefs].sort(), [...cameraRequirementRefs].sort());
  if (
    row.fixtureScope !== 'native-entry-ios' ||
    row.coachCodeSource !== 'authenticated-coach-home-ui' ||
    row.submissionRoute !== '/connections/invite-submissions' ||
    row.submissionStatus !== 201 ||
    row.unrelatedConnectionStateUnchanged !== true ||
    row.unrelatedTrainingStateUnchanged !== true ||
    row.nativePassingCases !== 0 ||
    row.scope !==
      'actual-camera-denial-plus-live-manual-submit-pending-ui-api-sql; no confirmation pass' ||
    row.fixtureEvidencePath !== fixtureEvidence.reference.path ||
    row.fixtureHash !== fixtureEvidence.reference.sha256 ||
    row.isolationFixtureEvidencePath !== isolationFixtureEvidence.reference.path ||
    row.isolationFixtureHash !== isolationFixtureEvidence.reference.sha256 ||
    row.coachInviteEvidencePath !== 'camera-coach-invite-code.private.json'
  )
    throw new Error('Camera submission preparation metadata is not the bounded pending contract');
  const target = requireTarget(row.target);
  const isolationTarget = requireTarget(row.isolationTarget);
  assert.deepEqual(
    isolationTarget,
    isolationFixtureEvidence.target,
    'Camera isolation target is not bound to its persisted fixture scope',
  );
  if (
    target.professionalAuthUid !== fixtureEvidence.fixtures.accounts.coach.authUid ||
    target.studentAuthUid !== fixtureEvidence.fixtures.accounts.student.authUid ||
    denialPreparation.studentAuthUid !== fixtureEvidence.fixtures.accounts.student.authUid
  )
    throw new Error('Camera denial, auth and submission do not share the owned fixture accounts');
  if (!Array.isArray(row.submissionRequestIds))
    throw new Error('Camera submission request IDs must be an array');
  const requestIds = row.submissionRequestIds.map((value) =>
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN,
  );
  if (requestIds.length !== 1 || !Number.isSafeInteger(requestIds[0]) || requestIds[0] <= 0)
    throw new Error('Camera submission request identity is invalid');
  if (JSON.stringify(row.snapshotPaths) !== JSON.stringify(nativeCameraSubmissionEvidencePaths))
    throw new Error('Camera submission snapshot paths are incomplete or reordered');
  requireTransport(transport, input.targetOrigin, requestIds);

  const before = requireSnapshotIdentity(
    readJson(input.root, nativeCameraSubmissionEvidencePaths[0]),
    input.backendRunId,
    'native-entry-ios',
    fixtureEvidence.fixtureAuthUids,
    target,
  );
  const fixtureAuthUids = fixtureEvidence.fixtureAuthUids;
  if (
    JSON.stringify(before.fixtureAuthUids) !== JSON.stringify(fixtureAuthUids) ||
    !fixtureAuthUids.includes(target.professionalAuthUid) ||
    !fixtureAuthUids.includes(target.studentAuthUid)
  )
    throw new Error('Camera submission snapshot is not bound to the owned fixture file');
  requireConnectionSnapshot(before, {
    fixtureAuthUids,
    target,
  });
  const authBoundaries = requireAuthIdentityProvenance({
    root: input.root,
    capture,
    captureBackendRunId: input.backendRunId,
    fixtureAuthUids,
    targetOrigin: input.targetOrigin,
    apiPid: backend.apiPid,
    target,
    transport,
  });
  if (requestIds[0] <= authBoundaries.finalStudentRequestId)
    throw new Error('Camera invite submission precedes the final student principal boundary');
  const inviteCode = requireCoachInviteEvidence({
    root: input.root,
    capture,
    preparation: row,
    target,
    backendRunId: input.backendRunId,
    coachAuthRequestId: authBoundaries.coachRequestId,
    submissionRequestIds: requestIds,
    transport,
  });
  verifyConnectionSnapshotCheckpoint({
    snapshot: before,
    checkpoint: 'unlinked',
    expected: { fixtureAuthUids, target },
  });

  const pending = requireSnapshotIdentity(
    readJson(input.root, nativeCameraSubmissionEvidencePaths[1]),
    input.backendRunId,
    'native-entry-ios',
    fixtureAuthUids,
    target,
  );
  verifyConnectionSubmissionSnapshotTransition({
    before,
    pending,
    fixtures: fixtureEvidence.fixtures,
  });
  requirePendingCard(
    readJson(input.root, nativeCameraSubmissionEvidencePaths[2]),
    pending,
    input.root,
    input.backendRunId,
    fixtureAuthUids,
    target,
  );
  requirePendingFrame(input.root, capture, row);

  const isolationBefore = requireSnapshotIdentity(
    readJson(input.root, nativeCameraSubmissionEvidencePaths[3]),
    input.backendRunId,
    'native-connection-isolation-ios',
    isolationFixtureEvidence.fixtureAuthUids,
    isolationTarget,
  );
  const isolationAfter = requireSnapshotIdentity(
    readJson(input.root, nativeCameraSubmissionEvidencePaths[4]),
    input.backendRunId,
    'native-connection-isolation-ios',
    isolationFixtureEvidence.fixtureAuthUids,
    isolationTarget,
  );
  verifyConnectionSnapshotCheckpoint({
    snapshot: isolationBefore,
    checkpoint: 'unlinked',
    expected: {
      fixtureAuthUids: isolationFixtureEvidence.fixtureAuthUids,
      target: isolationTarget,
    },
  });
  verifyConnectionSnapshotCheckpoint({
    snapshot: isolationAfter,
    checkpoint: 'unlinked',
    expected: {
      fixtureAuthUids: isolationFixtureEvidence.fixtureAuthUids,
      target: isolationTarget,
    },
  });
  assert.deepEqual(
    isolationAfter,
    isolationBefore,
    'Camera submit changed isolated connection state',
  );
  const domainReferences = row.domainSnapshotReferences;
  const expectedDomainReferences = [
    ['camera-connection-before.private.json', 'native-entry-ios'],
    ['camera-connection-pending.private.json', 'native-entry-ios'],
    ['camera-isolation-before.private.json', 'native-connection-isolation-ios'],
    ['camera-isolation-after.private.json', 'native-connection-isolation-ios'],
  ] as const;
  if (
    !Array.isArray(domainReferences) ||
    domainReferences.length !== expectedDomainReferences.length
  )
    throw new Error('Camera domain snapshots lack complete source references');
  for (const [index, value] of domainReferences.entries()) {
    const reference = record(value, 'camera domain snapshot reference');
    const [expectedPath, expectedScope] = expectedDomainReferences[index];
    if (
      reference.path !== expectedPath ||
      reference.source !== 'owned-session.snapshot' ||
      reference.runId !== input.backendRunId ||
      reference.scope !== expectedScope
    )
      throw new Error('Camera domain snapshot source identity is incomplete');
    requireEvidenceReference(input.root, reference, expectedPath, 'camera domain snapshot', true);
  }
  const trainingReferences = row.trainingSnapshotReferences;
  if (!Array.isArray(trainingReferences) || trainingReferences.length !== 2)
    throw new Error('Camera training preservation lacks complete source references');
  const trainingSnapshots = trainingReferences.map((value, index) => {
    const reference = record(value, 'camera training snapshot reference');
    const expectedPath = frozenNativeCameraSubmissionEvidencePaths[index + 5];
    if (
      reference.path !== expectedPath ||
      reference.source !== 'owned-session.snapshot' ||
      reference.runId !== input.backendRunId ||
      reference.scope !== 'native-entry-ios'
    )
      throw new Error('Camera training snapshot source identity is incomplete');
    requireEvidenceReference(input.root, reference, expectedPath, 'camera training snapshot', true);
    return requireDomainSnapshot(
      input.root,
      expectedPath,
      input.backendRunId,
      'native-entry-ios',
      fixtureAuthUids,
      'camera training snapshot',
    );
  });
  assertCameraDomainConnectionBindings({
    beforeDomain: trainingSnapshots[0].value,
    afterDomain: trainingSnapshots[1].value,
    beforeConnection: before,
    afterConnection: pending,
    target,
    inviteCode,
  });
  assertCameraNonConnectionStateUnchanged(
    trainingSnapshots[0].value,
    trainingSnapshots[1].value,
    'Camera submit changed the complete unrelated training projection',
  );
}

async function privateRoot(value: string): Promise<string> {
  const canonical = await realpath(value);
  if (canonical !== path.resolve(value)) throw new Error('Camera stage root is not canonical');
  const metadata = await lstat(canonical);
  if (
    !metadata.isDirectory() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error('Camera stage root must be owned and private');
  return canonical;
}

async function requirePrivateDirectory(value: string, label: string): Promise<string> {
  const canonical = await privateRoot(value);
  if (canonical !== path.resolve(value)) throw new Error(`${label} is not canonical`);
  return canonical;
}

async function createPrivateDestination(parent: string, relative: string): Promise<string> {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.split('/').some((part) => !/^[a-z0-9-]+$/.test(part))
  )
    throw new Error('Camera stage destination path is invalid');
  let current = parent;
  for (const part of relative.split('/')) {
    const next = path.join(current, part);
    try {
      const metadata = await lstat(next);
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new Error('Camera stage destination contains a symlink or non-directory');
      if (
        metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o777) !== 0o700 ||
        (await realpath(next)) !== next
      )
        throw new Error('Camera stage destination directory is not private and owned');
      throw new Error('Camera stage destination already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(next, { mode: 0o700 });
      await chmod(next, 0o700);
      const metadata = await lstat(next);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o777) !== 0o700 ||
        (await realpath(next)) !== next
      )
        throw new Error('Camera stage destination directory failed ownership validation');
    }
    current = next;
  }
  return current;
}

async function verifyPrivateStagedFile(
  value: string,
  expectedBytes: number,
  label: string,
): Promise<void> {
  const metadata = await lstat(value);
  if (
    !metadata.isFile() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size !== expectedBytes ||
    (await realpath(value)) !== value
  )
    throw new Error(`${label} is not an owned immutable private file`);
}

export type CameraSourceFileIdentity = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  mode: number;
  uid: number;
}>;

function cameraSourceIsPrivateRecord(relative: string): boolean {
  return !relative.endsWith('.png');
}

async function cameraSourceIdentity(
  root: string,
  relative: string,
): Promise<CameraSourceFileIdentity> {
  const bytes = readNativeEvidence(root, relative, cameraSourceIsPrivateRecord(relative));
  const file = path.join(root, relative);
  const metadata = await lstat(file);
  const canonical = await realpath(file);
  if (canonical !== file)
    throw new Error(`Camera source ${relative} is not a canonical owned file`);
  return {
    path: relative,
    bytes: bytes.length,
    sha256: sha(bytes),
    mode: metadata.mode & 0o777,
    uid: metadata.uid,
  };
}

export async function captureCameraSourceIdentities(
  root: string,
): Promise<readonly CameraSourceFileIdentity[]> {
  await requirePrivateDirectory(root, 'Camera source root');
  return Promise.all(
    frozenNativeCameraStagingFiles.map((relative) => cameraSourceIdentity(root, relative)),
  );
}

export async function verifyCameraSourceIdentities(
  root: string,
  expected: readonly CameraSourceFileIdentity[],
): Promise<void> {
  const actual = await captureCameraSourceIdentities(root);
  assert.deepEqual(actual, expected, 'Camera source bytes or ownership changed during staging');
}

/** Copy only validated private camera preparation; never creates a receipt or pass. */
export async function stageIosCameraSubmissionEvidence(options: {
  captureRoot: string;
  outputRoot: string;
  captureRunId: string;
  requestedRunId: string;
  fixtureRunId: string;
  targetOrigin: string;
  preparation: unknown;
  transport: readonly ProxyObservation[];
  lifecycle?: NativePublicEvidenceLifecycle;
}): Promise<{ manifestPath: string; nativePassingCases: 0 }> {
  stageFence(options.lifecycle, 'camera-root:before');
  const captureRoot = await requirePrivateDirectory(options.captureRoot, 'Camera capture root');
  const outputRoot = await requirePrivateDirectory(options.outputRoot, 'Camera output root');
  stageFence(options.lifecycle, 'camera-root:after');
  if (
    captureRoot === outputRoot ||
    captureRoot.startsWith(`${outputRoot}${path.sep}`) ||
    outputRoot.startsWith(`${captureRoot}${path.sep}`)
  )
    throw new Error('Camera capture and output roots must be separate');
  assert.match(options.captureRunId, /^[a-f0-9]{24}$/);
  assert.match(options.requestedRunId, /^[a-f0-9]{24}$/);
  assert.match(options.fixtureRunId, /^[a-f0-9]{24}$/);
  assert.equal(path.basename(captureRoot), options.captureRunId);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  validateIosCameraSubmissionPreparation({
    root: captureRoot,
    backendRunId: options.fixtureRunId,
    targetOrigin: options.targetOrigin,
    preparation: options.preparation,
    transport: options.transport,
  });
  stageFence(options.lifecycle, 'camera-preparation:after');
  const prefix = `evidence/${options.captureRunId}`;
  const staging = await createPrivateDestination(
    outputRoot,
    `camera-staging-${options.captureRunId}`,
  );
  const sourceBefore = await captureCameraSourceIdentities(captureRoot);
  let evidenceParent: string | undefined;
  let finalized = false;
  try {
    const files = frozenNativeCameraStagingFiles.map((relative) => ({
      relative,
      privateRecord: !relative.endsWith('.png'),
    }));
    const manifestFiles: { path: string; sizeBytes: number; sha256: string }[] = [];
    for (const file of files) {
      stageFence(options.lifecycle, `camera-copy:${file.relative}:before`);
      const expected = sourceBefore.find((row) => row.path === file.relative);
      if (!expected) throw new Error(`Camera source identity is missing for ${file.relative}`);
      const bytes = readNativeEvidence(captureRoot, file.relative, file.privateRecord);
      const metadata = await lstat(path.join(captureRoot, file.relative));
      if (
        bytes.length !== expected.bytes ||
        sha(bytes) !== expected.sha256 ||
        (metadata.mode & 0o777) !== expected.mode ||
        metadata.uid !== expected.uid
      )
        throw new Error(`Camera source ${file.relative} changed before staging`);
      const targetPath = path.join(staging, file.relative);
      await writeFile(targetPath, bytes, { flag: 'wx', mode: 0o600 });
      await verifyPrivateStagedFile(
        targetPath,
        bytes.length,
        `Staged camera file ${file.relative}`,
      );
      stageFence(options.lifecycle, `camera-copy:${file.relative}:after`);
      manifestFiles.push({
        path: file.relative,
        sizeBytes: bytes.length,
        sha256: sha(bytes),
      });
    }
    const manifest = Buffer.from(
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'private camera submission evidence copy, not public outcome',
          requestedRunId: options.requestedRunId,
          captureRunId: options.captureRunId,
          fixtureRunId: options.fixtureRunId,
          nativePassingCases: 0,
          files: manifestFiles,
        },
        null,
        2,
      ) + '\n',
    );
    const manifestPath = `${prefix}/copy-manifest.private.json`;
    const stagedManifestFile = path.join(staging, 'copy-manifest.private.json');
    await verifyCameraSourceIdentities(captureRoot, sourceBefore);
    stageFence(options.lifecycle, 'camera-manifest:before');
    validateIosCameraSubmissionPreparation({
      root: staging,
      backendRunId: options.fixtureRunId,
      targetOrigin: options.targetOrigin,
      preparation: options.preparation,
      transport: options.transport,
    });
    await writeFile(stagedManifestFile, manifest, {
      flag: 'wx',
      mode: 0o600,
    });
    stageFence(options.lifecycle, 'camera-manifest:after');
    await verifyPrivateStagedFile(stagedManifestFile, manifest.length, 'Camera copy manifest');
    evidenceParent = await createPrivateDestination(outputRoot, 'evidence');
    const destination = path.join(evidenceParent, options.captureRunId);
    try {
      await lstat(destination);
      throw new Error('Camera final staging destination already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(staging, destination);
    finalized = true;
    stageFence(options.lifecycle, 'camera-publication:after');
    await requirePrivateDirectory(destination, 'Camera finalized evidence');
    validateIosCameraSubmissionPreparation({
      root: destination,
      backendRunId: options.fixtureRunId,
      targetOrigin: options.targetOrigin,
      preparation: options.preparation,
      transport: options.transport,
    });
    const manifestFile = path.join(destination, 'copy-manifest.private.json');
    await verifyPrivateStagedFile(manifestFile, manifest.length, 'Camera copy manifest');
    return { manifestPath, nativePassingCases: 0 };
  } catch (error) {
    if (!finalized) await rm(staging, { recursive: true, force: true });
    if (evidenceParent && !finalized) await rm(evidenceParent, { recursive: true, force: true });
    throw error;
  }
}

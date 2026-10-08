import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { androidSourceIdentity } from './android-build-identity';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import { sourceIdentity, treeHash } from './native-build-identity';
import {
  readNativeConnectionAttemptBinding,
  connectionAttemptBindingPath,
  type NativeConnectionAttemptBinding,
} from './native-connection-attempt-binding';
import { verifyNativeConnectionJourney } from './native-connection-checkpoints';
import {
  resolveActiveConnectionCard,
  resolvePendingConnectionTarget,
  resolvePendingStudentConnectionCard,
  resolveProfessionalRosterTarget,
  type NativeConnectionTargetScope,
} from './native-connection-hierarchy';
import { resolveAndroidProfessionalRosterTarget } from './native-connection-hierarchy-android';
import { requireNativeConnectionTransport } from './native-connection-journey';
import { requireNativeConnectionPasswordOfferWitnesses } from './native-connection-password-offer-witness';
import {
  requireConnectionSnapshot,
  verifyConnectionSnapshotCheckpoint,
} from './native-connection-snapshot';
import {
  nativeConnectionAssertionIds,
  nativeConnectionAssertionSemanticSha256,
  requireNativePilotAssertions,
  selectNativePilotScenario,
  canonicalNativeRepoRelativePath,
} from './native-pilot-contract';
import { requireSuccessfulNativeCommandDiagnostics } from './native-training-attempt-outcome';
import { validateNativeRuntimeFrameFiles, readNativeEvidence } from './native-view-evidence';
import { assertArtifactPath, assertTestingDocument } from './schema-validation';
import { enUS } from '../../localization/en-US';
import type { NativePilotSelection } from './native-pilot-contract';
import type { ProxyObservation, NativeAuthIdentityObservation } from './owned-api-proxy';
import type { OwnedFixtures } from './owned-session';

const runIdPattern = /^[a-f0-9]{24}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export type NativeConnectionEvidencePlatform = 'ios' | 'android';

type NativePublicEvidenceLifecycle = {
  signal: AbortSignal;
  deadlineAtMs: number;
};

function stageFence(lifecycle: NativePublicEvidenceLifecycle | undefined, label: string): void {
  if (!lifecycle) return;
  lifecycle.signal.throwIfAborted();
  if (!Number.isFinite(lifecycle.deadlineAtMs) || performance.now() >= lifecycle.deadlineAtMs)
    throw new Error(`Native connection staging deadline expired: ${label}`);
}

export const nativeConnectionAssertionEvidenceKind =
  'native-connection-assertion-evidence-preparation';
export const nativeConnectionJourneyPreparationPath = 'connection-journey-preparation.private.json';
export const nativeConnectionAuthIdentitiesPath = 'native-auth-identities.private.json';
export const nativeConnectionTransportPath = 'transport-observations.private.json';
export const nativeConnectionCleanupPath = 'external-cleanup.private.json';

/** These frames contain the invite or credential-entry surface and remain private-only. */
export const redactedNativeConnectionFrameLabels = Object.freeze([
  'coach-home',
  'connection-coach-invite',
  'connection-coach-return-home',
  'connection-student-entry',
  'connection-student-pending',
  'connection-submit',
] as const);

const connectionFrameViews = Object.freeze([
  ['coach-home', 'SCR-pro-home'],
  ['connection-coach-invite', 'SCR-pro-home'],
  ['connection-normal-coach-pending', 'SCR-pro-pending'],
  ['connection-normal-coach-roster', 'SCR-pro-roster'],
  ['connection-student-entry', 'SCR-student-professionals'],
  ['connection-submit', 'STATE-connection-pending'],
  ['connection-student-pending', 'STATE-connection-pending'],
  ['connection-coach-pending-roster', 'SCR-pro-roster'],
  ['connection-coach-no-active-roster', 'SCR-pro-roster'],
  ['connection-coach-return-home', 'SCR-pro-home'],
  ['connection-coach-pending', 'SCR-pro-pending'],
  ['connection-confirm', 'SCR-pro-pending'],
  ['connection-coach-roster', 'SCR-pro-roster'],
  ['connection-student-active', 'STATE-connection-active'],
] as const);

type EvidenceKind = 'ui' | 'api' | 'sql';
export type NativeConnectionAssertionBinding = {
  id: string;
  requirementRefs: string[];
  evidencePaths: string[];
};
export type NativeConnectionHelperInput = {
  path: string;
  sha256: string;
};
type EvidenceReference = { path: string; sha256: string; redacted?: boolean };
type PrivateFileMetadata = Awaited<ReturnType<typeof lstat>>;
type NativeCommandLogArtifact = {
  kind: 'command-log';
  root: string;
  relative: string;
  sizeBytes: number;
  sha256: string;
  identity: string;
};
type CollectedFile = Buffer | NativeCommandLogArtifact;
type Capture = {
  kind: string;
  mode: string;
  platform: string;
  charter: string;
  result: string;
  cleanup: string;
  nativePassingCases: number;
  source: unknown;
  sourceAfter: unknown;
  helperInputsBefore: unknown;
  helperInputsAfter: unknown;
  build: Record<string, unknown>;
  device: Record<string, unknown>;
  backend: {
    runId: string;
    apiOrigin: unknown;
    apiProcess: unknown;
    backendAttemptId: unknown;
    processes?: unknown;
  };
  commandExecutions: unknown;
  observations: unknown;
  connectionJourneyPreparation: unknown;
  connectionApiIdentity: unknown;
  connectionInitialAuth: unknown;
  connectionAccountSwitches: unknown;
  fixtureHash: unknown;
  connectionPasswordOfferWitnesses?: unknown;
};

type JourneyReport = {
  kind: 'private-native-connection-journey-not-public-receipt';
  binding: NativeConnectionAttemptBinding;
  connectionId: string;
  requirementRefs: string[];
  target: {
    runId: string;
    scope: string;
    fixtureAuthUids: string[];
    professionalAuthUid: string;
    studentAuthUid: string;
  };
  initialAuth: {
    actor: 'coach';
    actorAuthUid: string;
    authRequestId: number;
    afterRequestId: number;
  };
  initialStudent: AccountSwitch;
  coachSwitch: AccountSwitch;
  studentSwitch: AccountSwitch;
  checkpoints: unknown;
  snapshots: Record<string, { path: string; sha256: string }>;
  pendingMatch: Record<string, unknown>;
  rosterMatch: Record<string, unknown>;
  activeMatch: Record<string, unknown>;
  transportWindows: {
    method: 'POST' | 'GET';
    route: string;
    status: number;
    afterRequestId: number;
    throughRequestId: number;
    unique: boolean;
  }[];
  inviteReads: ProxyObservation[];
  normalCoachPendingReads: ProxyObservation[];
  normalCoachRosterReads: ProxyObservation[];
  pendingStudentMatch: Record<string, unknown>;
  pendingRosterMatch: Record<string, unknown>;
  pendingRosterReads: ProxyObservation[];
  submission: ProxyObservation[];
  confirmation: ProxyObservation[];
  initialRelationshipReads: ProxyObservation[];
  pendingRelationshipReads: ProxyObservation[];
  coachPendingReads: ProxyObservation[];
  rosterReads: ProxyObservation[];
  relationshipReads: ProxyObservation[];
  isolationUnchanged: true;
  trainingPlansUnchanged: true;
  nativePassingCases: 0;
  scope: string;
  fixtureEvidence: { path: string; sha256: string };
};

type AccountSwitch = {
  actor: 'coach' | 'student';
  beforeRequestId: number;
  authRequestId: number;
  afterRequestId: number;
  actorAuthUid: string;
};

type LoadedEvidence = {
  repositoryRoot: string;
  captureRoot: string;
  selection: NativePilotSelection;
  binding: NativeConnectionAttemptBinding;
  fixture: Pick<OwnedFixtures, 'accounts' | 'runId' | 'scope'>;
  capture: Capture;
  journey: JourneyReport;
  transport: ProxyObservation[];
  authIdentities: NativeAuthIdentityObservation[];
  snapshots: Record<string, unknown>;
  bindings: NativeConnectionAssertionBinding[];
  commandArtifacts: CommandArtifactPaths;
};

type CommandArtifactPaths = {
  paths: string[];
  logPaths: Set<string>;
};

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

function json(root: string, relative: string): unknown {
  return JSON.parse(readNativeEvidence(root, relative, true).toString()) as unknown;
}

async function privateRoot(value: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), 'Native connection evidence root is not canonical');
  const info = await lstat(canonical);
  assert(
    info.isDirectory() && !info.isSymbolicLink(),
    'Native connection evidence root is not a directory',
  );
  assert.equal(info.uid, process.getuid?.(), 'Native connection evidence root is not owned');
  assert.equal(info.mode & 0o777, 0o700, 'Native connection evidence root is not private');
  return canonical;
}

function privateFileIdentity(metadata: PrivateFileMetadata): string {
  return [
    metadata.dev,
    metadata.ino,
    metadata.uid,
    metadata.gid,
    metadata.mode,
    metadata.size,
    metadata.mtimeMs,
    metadata.ctimeMs,
  ]
    .map(String)
    .join(':');
}

async function inspectPrivateCommandLog(
  root: string,
  relative: string,
): Promise<{ file: string; metadata: PrivateFileMetadata; identity: string }> {
  const canonicalRoot = await privateRoot(root);
  assert(
    relative && !path.isAbsolute(relative),
    'Native connection command log path must be relative',
  );
  const file = path.resolve(canonicalRoot, relative);
  assert(
    file.startsWith(canonicalRoot + path.sep) && (await realpath(file)) === file,
    'Native connection command log path escaped or contains a symlink',
  );
  const metadata = await lstat(file);
  assert(
    metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.() &&
      (metadata.mode & 0o777) === 0o600 &&
      metadata.nlink === 1 &&
      metadata.size > 0,
    'Native connection command log must be a non-empty owned private regular file',
  );
  assert(Number.isSafeInteger(metadata.size), 'Native connection command log size is unsafe');
  return { file, metadata, identity: privateFileIdentity(metadata) };
}

async function streamHash(file: string): Promise<{ sizeBytes: number; sha256: string }> {
  const digest = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(file)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += bytes.byteLength;
    digest.update(bytes);
  }
  return { sizeBytes, sha256: digest.digest('hex') };
}

async function readNativeCommandLog(
  root: string,
  relative: string,
): Promise<NativeCommandLogArtifact> {
  const before = await inspectPrivateCommandLog(root, relative);
  const digest = await streamHash(before.file);
  const after = await inspectPrivateCommandLog(root, relative);
  assert.equal(
    after.identity,
    before.identity,
    `Native connection command log changed: ${relative}`,
  );
  assert.equal(
    digest.sizeBytes,
    before.metadata.size,
    `Native connection command log size changed: ${relative}`,
  );
  return {
    kind: 'command-log',
    root: path.resolve(root),
    relative,
    sizeBytes: digest.sizeBytes,
    sha256: digest.sha256,
    identity: before.identity,
  };
}

function fileSha256(file: CollectedFile): string {
  return Buffer.isBuffer(file) ? sha256(file) : file.sha256;
}

function fileSizeBytes(file: CollectedFile): number {
  return Buffer.isBuffer(file) ? file.byteLength : file.sizeBytes;
}

function assertSameCollectedFile(
  left: CollectedFile,
  right: CollectedFile,
  relative: string,
): void {
  assert.equal(fileSha256(left), fileSha256(right), `Connection evidence changed: ${relative}`);
  assert.equal(
    fileSizeBytes(left),
    fileSizeBytes(right),
    `Connection evidence size changed: ${relative}`,
  );
  if (!Buffer.isBuffer(left) && !Buffer.isBuffer(right))
    assert.equal(
      left.identity,
      right.identity,
      `Connection evidence identity changed: ${relative}`,
    );
  else if (Buffer.isBuffer(left) && Buffer.isBuffer(right))
    assert.deepEqual(left, right, `Connection evidence bytes changed: ${relative}`);
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && runIdPattern.test(value),
    `${label} must be a 24-character run ID`,
  );
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    `${label} must be a SHA-256 hash`,
  );
}

function requiredNativeConnectionHelperPaths(platform: NativeConnectionEvidencePlatform): string[] {
  const required = [
    platform === 'ios'
      ? 'scripts/testing/capture-native-testability.ts'
      : 'scripts/testing/capture-android-testability.ts',
    platform === 'ios'
      ? 'scripts/testing/run-ios-connection-attempt.ts'
      : 'scripts/testing/run-android-connection-attempt.ts',
    'scripts/testing/native-connection-observation.ts',
    'scripts/testing/native-connection-snapshot.ts',
    'scripts/testing/native-connection-platform-contract.ts',
    'scripts/testing/native-connection-journey.ts',
    'scripts/testing/native-connection-journey-core.ts',
    'scripts/testing/native-connection-checkpoints.ts',
    'scripts/testing/native-connection-hierarchy.ts',
    'scripts/testing/native-connection-attempt-binding.ts',
    'scripts/testing/native-connection-public-evidence.ts',
    'scripts/testing/native-connection-public-evidence-core.ts',
    'scripts/testing/native-view-evidence.ts',
    'scripts/testing/validate-native-inventory.mjs',
    'scripts/testing/schemas/connection-snapshot-v1.schema.json',
  ];
  if (platform === 'ios')
    required.push('scripts/testing/native-connection-password-offer-witness.ts');
  if (platform === 'android')
    required.push(
      'scripts/testing/native-connection-public-evidence-android.ts',
      'scripts/testing/native-connection-hierarchy-android.ts',
      'scripts/testing/android-build-identity.ts',
      'scripts/testing/verify-owned-android-cleanup.ts',
      'scripts/testing/android-native-input-reader.ts',
      'scripts/testing/android-input-reader/InputReader.java',
      'scripts/testing/android-input-reader/AndroidManifest.xml',
      'scripts/testing/run-ios-training-attempt.ts',
      'scripts/ci/android-runner-slot.ts',
    );
  return required;
}

export function requireNativeConnectionHelperInputs(
  value: unknown,
  platform: NativeConnectionEvidencePlatform,
): NativeConnectionHelperInput[] {
  const helpers = array(value, 'native connection helper inputs').map((raw) => {
    const helper = record(raw, 'native connection helper');
    assert(typeof helper.path === 'string');
    const helperPath = canonicalNativeRepoRelativePath(
      helper.path,
      'Native connection helper path',
    );
    assert(
      helperPath === 'package.json' ||
        /^scripts\/testing\/[a-z0-9._/-]+\.ts$/.test(helperPath) ||
        helperPath === 'scripts/testing/validate-native-inventory.mjs' ||
        helperPath === '.maestro/flows/camera-denied-android.yaml' ||
        helperPath === 'scripts/testing/detox-save-retry-child-protocol.mjs' ||
        helperPath === 'scripts/testing/detox-training-child-protocol.mjs' ||
        helperPath === 'scripts/testing/schemas/connection-snapshot-v1.schema.json' ||
        helperPath === 'scripts/testing/detox-connection-ancestor-safe.py' ||
        helperPath === 'scripts/testing/android-input-reader/InputReader.java' ||
        helperPath === 'scripts/testing/android-input-reader/AndroidManifest.xml' ||
        helperPath === 'scripts/ci/android-runner-slot.ts',
      `Native connection helper path is outside the declared source boundary: ${helperPath}`,
    );
    requireHash(helper.sha256, `Native connection helper ${helperPath}`);
    return { path: helperPath, sha256: helper.sha256 };
  });
  assert.equal(
    new Set(helpers.map((helper) => helper.path)).size,
    helpers.length,
    'Native connection helpers duplicated',
  );
  for (const required of requiredNativeConnectionHelperPaths(platform))
    assert(
      helpers.some((helper) => helper.path === required),
      `Native connection helper identity is absent: ${required}`,
    );
  return helpers;
}

async function freshSelection(
  repositoryRoot: string,
  selection: NativePilotSelection,
  platform: NativeConnectionEvidencePlatform = 'ios',
): Promise<{ repositoryRoot: string; selection: NativePilotSelection }> {
  const root = await realpath(repositoryRoot);
  const inventory = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const current = await selectNativePilotScenario(selection.arguments, inventory, root);
  assert.deepEqual(selection, current, 'Native connection selection is stale or altered');
  const scenarioId = `SCN-connection-${platform}` as const;
  assert.deepEqual(current.arguments, {
    platform,
    engine: 'maestro',
    scenario: scenarioId,
    mode: 'integration',
  });
  assert.equal(current.scenario.id, scenarioId);
  assert.equal(current.scenario.platform, platform);
  assert.equal(current.scenario.flowId, 'FLW-connection');
  assert.equal(current.scenario.dataMode, 'postgres');
  assert.equal(current.scenario.fixtureRef, `owned-postgres:${scenarioId}:fresh-attempt`);
  const rows = requireNativePilotAssertions(current);
  assert.deepEqual(
    rows.map((row) => row.id),
    [...nativeConnectionAssertionIds],
  );
  assert.equal(
    current.scenario.pilotAssertionContract?.semanticSha256,
    nativeConnectionAssertionSemanticSha256,
  );
  return { repositoryRoot: root, selection: current };
}

function expectedBindings(
  selection: NativePilotSelection,
  attemptId: string,
): NativeConnectionAssertionBinding[] {
  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    [...nativeConnectionAssertionIds],
  );
  return rows.map((row) => ({
    id: row.id,
    requirementRefs: [...row.requirementRefs],
    evidencePaths: row.evidencePathTemplates!.map((template) =>
      template.replace('{attemptId}', attemptId),
    ),
  }));
}

/** Public for resource-free contract tests; this does not read or create artifacts. */
export function buildNativeConnectionAssertionBindings(
  selection: NativePilotSelection,
  attemptId: string,
): NativeConnectionAssertionBinding[] {
  assert.match(attemptId, /^[a-f0-9]{24}:first$/);
  return expectedBindings(selection, attemptId);
}

function framePath(label: string, suffix: 'png' | 'hierarchy.json'): string {
  assert.match(label, /^[a-z0-9-]+$/);
  return suffix === 'png' ? `${label}.png` : `${label}-${suffix}`;
}

/** Shared filename projection used by required-frame validation and staging. */
export function nativeConnectionFrameLabelFromReference(relative: string): string {
  assert.match(relative, /(?:\.png|-hierarchy\.json)$/);
  return relative.replace(/(?:\.png|-hierarchy\.json)$/, '');
}

const redactedFramePaths: ReadonlySet<string> = new Set(
  redactedNativeConnectionFrameLabels.flatMap((label) => [
    framePath(label, 'png'),
    framePath(label, 'hierarchy.json'),
  ]),
);

function isRedactedFrameLabel(label: string): boolean {
  return (redactedNativeConnectionFrameLabels as readonly string[]).includes(label);
}

function uiReferences(labels: readonly string[]): EvidenceReference[] {
  return labels
    .map((label) => ({
      path: framePath(label, 'png'),
      sha256: '',
      ...(isRedactedFrameLabel(label) ? { redacted: true } : {}),
    }))
    .concat(
      labels.map((label) => ({
        path: framePath(label, 'hierarchy.json'),
        sha256: '',
        ...(isRedactedFrameLabel(label) ? { redacted: true } : {}),
      })),
    );
}

function referencesFor(
  assertionId: string,
  kind: EvidenceKind,
  platform: NativeConnectionEvidencePlatform = 'ios',
): EvidenceReference[] {
  assert(platform === 'ios' || platform === 'android');
  const ui: Record<string, string[]> = {
    'NAT-connection-normal-entry': [
      'coach-home',
      'connection-coach-invite',
      'connection-normal-coach-pending',
      'connection-normal-coach-roster',
      'connection-student-entry',
    ],
    'NAT-connection-submit-pending': ['connection-submit'],
    'NAT-connection-pending-state': [
      'connection-student-pending',
      'connection-coach-pending-roster',
      'connection-coach-no-active-roster',
      'connection-coach-pending',
    ],
    'NAT-connection-confirm-active': ['connection-confirm'],
    'NAT-connection-active-student': ['connection-student-active'],
    'NAT-connection-active-roster': ['connection-coach-roster'],
  };
  if (kind === 'ui') return uiReferences(ui[assertionId] ?? []);
  if (kind === 'api')
    return [
      nativeConnectionTransportPath,
      nativeConnectionAuthIdentitiesPath,
      nativeConnectionJourneyPreparationPath,
    ].map((path) => ({ path, sha256: '' }));
  const sql: Record<string, string[]> = {
    'NAT-connection-normal-entry': [
      'connection-normal-coach-before.private.json',
      'connection-normal-coach-after.private.json',
      'connection-before.private.json',
    ],
    'NAT-connection-submit-pending': [
      'connection-before.private.json',
      'connection-pending.private.json',
    ],
    'NAT-connection-pending-state': [
      'connection-pending.private.json',
      'connection-pending-after-coach-auth.private.json',
    ],
    'NAT-connection-confirm-active': [
      'connection-pending-after-coach-auth.private.json',
      'connection-active.private.json',
    ],
    'NAT-connection-active-student': [
      'connection-active.private.json',
      'connection-active-after-student-auth.private.json',
    ],
    'NAT-connection-active-roster': [
      'connection-active.private.json',
      'connection-final.private.json',
    ],
    'NAT-connection-unrelated-state': [
      'connection-isolation-before.private.json',
      'connection-isolation-after.private.json',
      'connection-training-before.private.json',
      'connection-training-after.private.json',
      'connection-before.private.json',
      'connection-final.private.json',
    ],
  };
  return (sql[assertionId] ?? []).map((path) => ({ path, sha256: '' }));
}

/** Pure recipe projection for contract tests; hashes are filled only from owned runtime bytes. */
export function nativeConnectionEvidenceReferences(
  assertionId: string,
  kind: EvidenceKind,
  platform: NativeConnectionEvidencePlatform = 'ios',
): { path: string; redacted: boolean }[] {
  return referencesFor(assertionId, kind, platform).map((reference) => ({
    path: reference.path,
    redacted: reference.redacted === true,
  }));
}

function requiredFrameLabels(selection: NativePilotSelection): Set<string> {
  const labels = new Set<string>();
  for (const row of requireNativePilotAssertions(selection))
    for (const reference of referencesFor(row.id, 'ui', selection.arguments.platform))
      labels.add(nativeConnectionFrameLabelFromReference(reference.path));
  return labels;
}

function requireFrameObservation(
  capture: Capture,
  captureRoot: string,
  label: string,
  viewId: string,
) {
  const observations = array(capture.observations, 'native connection observations').map((raw) => {
    const row = record(raw, 'native connection observation');
    assert(
      typeof row.viewId === 'string' &&
        typeof row.screenshotPath === 'string' &&
        typeof row.hierarchyPath === 'string',
    );
    return row;
  });
  const matches = observations.filter(
    (row) =>
      row.viewId === viewId &&
      row.screenshotPath === `${label}.png` &&
      row.hierarchyPath === `${label}-hierarchy.json`,
  );
  assert.equal(matches.length, 1, `Native connection frame ${label} was not captured exactly once`);
  const frame = {
    viewId,
    screenshotPath: `${label}.png`,
    hierarchyPath: `${label}-hierarchy.json`,
    screenshotHash: sha256(readNativeEvidence(captureRoot, `${label}.png`)),
    hierarchyHash: sha256(readNativeEvidence(captureRoot, `${label}-hierarchy.json`, true)),
    reviewed: false,
  } as const;
  validateNativeRuntimeFrameFiles(captureRoot, [frame], [viewId]);
  return frame;
}

function requireBuildMetadata(
  build: Record<string, unknown>,
  platform: NativeConnectionEvidencePlatform,
): Promise<void> {
  if (platform === 'ios') assert.equal(build.bundleId, 'com.edufelip.mychampions.dev');
  else assert.equal(build.appId, 'com.edufelip.mychampions.dev');
  assert.equal(
    build.profile,
    platform === 'ios'
      ? 'Metro-attached Debug; not bundled release qualification'
      : 'Metro-attached devDebug arm64; no app-domain instrumentation; optional separately bound read-only input reader; not bundled release qualification',
  );
  assert(typeof build.binaryPath === 'string' && path.isAbsolute(build.binaryPath));
  requireIntegratedLoopbackOrigin(String(build.apiOrigin));
  requireIntegratedLoopbackOrigin(String(build.metroOrigin));
  assert.notEqual(build.apiOrigin, build.metroOrigin);
  assert(typeof build.node === 'string' && build.node.length > 0);
  requireHash(build.binaryHash, 'Native connection binary hash');
  requireHash(build.environmentHash, 'Native connection environment hash');
  return realpath(build.binaryPath).then(async (binaryPath) => {
    assert.equal(binaryPath, path.resolve(build.binaryPath as string));
    const info = await lstat(binaryPath);
    if (platform === 'ios') {
      assert(
        info.isDirectory() && !info.isSymbolicLink(),
        'Native connection binary is not a bundle directory',
      );
      assert.equal(
        await treeHash(binaryPath),
        build.binaryHash,
        'Native connection binary changed',
      );
    } else {
      assert(
        info.isFile() && !info.isSymbolicLink(),
        'Native connection APK is not a regular file',
      );
      assert.equal(
        sha256(await readFile(binaryPath)),
        build.binaryHash,
        'Native connection APK changed',
      );
    }
  });
}

async function requireSourceAndHelpers(
  repositoryRoot: string,
  capture: Capture,
  platform: NativeConnectionEvidencePlatform,
): Promise<void> {
  assert.deepEqual(
    capture.source,
    capture.sourceAfter,
    'Native connection source changed during execution',
  );
  assert.deepEqual(
    capture.source,
    await (platform === 'android'
      ? androidSourceIdentity(repositoryRoot)
      : sourceIdentity(repositoryRoot)),
    'Native connection source identity is stale',
  );
  assert(Array.isArray(capture.helperInputsBefore) && Array.isArray(capture.helperInputsAfter));
  assert.deepEqual(
    capture.helperInputsBefore,
    capture.helperInputsAfter,
    'Native connection helper inputs changed',
  );
  const helpers = requireNativeConnectionHelperInputs(capture.helperInputsBefore, platform).map(
    (helper) => ({ ...helper, target: assertArtifactPath(repositoryRoot, helper.path) }),
  );
  for (const helper of helpers) {
    assert.equal(
      await realpath(helper.target),
      helper.target,
      'Native connection helper is not canonical',
    );
    const info = await lstat(helper.target);
    assert(info.isFile() && !info.isSymbolicLink());
    assert.equal(
      sha256(await readFile(helper.target)),
      helper.sha256,
      `Native connection helper changed: ${helper.path}`,
    );
  }
}

function requireCommandDiagnostics(value: unknown): void {
  const diagnostics = requireSuccessfulNativeCommandDiagnostics(value);
  const labels = diagnostics.map((row) => row.label);
  assert.equal(
    new Set(labels).size,
    diagnostics.length,
    'Native connection command labels are duplicated',
  );
}

function commandArtifactPaths(
  capture: Capture,
  captureRoot: string,
  sourceRoot = captureRoot,
): CommandArtifactPaths {
  const paths: string[] = [];
  const logPaths = new Set<string>();
  const roles = new Map<string, { role: 'log' | 'ownership' | 'stdout'; commandIndex: number }>();
  const source = path.resolve(sourceRoot);
  const register = (
    relative: string,
    role: 'log' | 'ownership' | 'stdout',
    commandIndex: number,
  ) => {
    const prior = roles.get(relative);
    assert(
      prior === undefined,
      `Native connection command artifact path ${relative} is duplicated or aliases ${prior?.role ?? role}`,
    );
    roles.set(relative, { role, commandIndex });
    paths.push(relative);
    if (role === 'log') logPaths.add(relative);
  };
  for (const [commandIndex, raw] of array(
    capture.commandExecutions,
    'capture command executions',
  ).entries()) {
    const row = record(raw, 'capture command execution');
    const label = row.label;
    assert(
      typeof label === 'string' && /^[a-z0-9-]+$/.test(label),
      'Native connection command label is missing or unsafe',
    );
    for (const [key, role] of [
      ['logPath', 'log'],
      ['ownershipPath', 'ownership'],
    ] as const) {
      const value = row[key];
      assert(typeof value === 'string' && path.isAbsolute(value), `Command ${key} is invalid`);
      const relative = path.relative(source, value);
      assert(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
        `Command ${key} escaped its private artifact root`,
      );
      if (key === 'logPath')
        assert.equal(
          path.resolve(value),
          path.join(source, `${label}.private.log`),
          'Command logPath does not match its producer label',
        );
      register(relative, role, commandIndex);
    }
    if (row.stdoutPath !== null && row.stdoutPath !== undefined) {
      assert(typeof row.stdoutPath === 'string' && path.isAbsolute(row.stdoutPath));
      const relative = path.relative(source, row.stdoutPath);
      assert(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
        'Command stdout path escaped its private artifact root',
      );
      // A screenshot/hierarchy command's stdout can be a redacted invite frame;
      // those stay private and are never copied or required in a staged copy.
      if (!redactedFramePaths.has(relative)) register(relative, 'stdout', commandIndex);
    }
  }
  assert(paths.length > 0, 'Native connection command artifacts are missing');
  return { paths: [...new Set(paths)], logPaths };
}

function commandArtifactSourceRoot(capture: Capture, captureRunId: string): string {
  const roots = new Set<string>();
  for (const raw of array(capture.commandExecutions, 'capture command executions')) {
    const row = record(raw, 'capture command execution');
    for (const key of ['logPath', 'ownershipPath']) {
      const value = row[key];
      assert(typeof value === 'string' && path.isAbsolute(value));
      roots.add(path.dirname(path.resolve(value)));
    }
    if (row.stdoutPath !== null && row.stdoutPath !== undefined) {
      assert(typeof row.stdoutPath === 'string' && path.isAbsolute(row.stdoutPath));
      roots.add(path.dirname(path.resolve(row.stdoutPath)));
    }
  }
  assert.equal(roots.size, 1, 'Native connection command artifacts do not share one root');
  const root = [...roots][0];
  assert.equal(
    path.basename(root),
    captureRunId,
    'Native connection command artifact root changed',
  );
  return root;
}

async function addCaptureFile(
  files: Map<string, CollectedFile>,
  captureRoot: string,
  relative: string,
  expectedHash?: string,
  commandLog = false,
): Promise<void> {
  const file: CollectedFile = commandLog
    ? await readNativeCommandLog(captureRoot, relative)
    : readNativeEvidence(captureRoot, relative, !relative.endsWith('.png'));
  if (expectedHash)
    assert.equal(fileSha256(file), expectedHash, `Connection evidence changed: ${relative}`);
  const prior = files.get(relative);
  if (prior) assertSameCollectedFile(prior, file, relative);
  files.set(relative, file);
}

function requireCleanupEvidence(
  value: unknown,
  captureRunId: string,
  platform: NativeConnectionEvidencePlatform,
): void {
  const cleanup = record(value, 'native connection cleanup');
  assert.equal(
    cleanup.kind,
    platform === 'ios'
      ? 'independent ios native inventory cleanup proof'
      : 'independent android native cleanup proof',
  );
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.runId, captureRunId);
  assert.equal(cleanup.captureResult, 'observed');
  assert.equal(cleanup.captureCleanupClean, true);
  if (platform === 'ios')
    assert(Number.isSafeInteger(cleanup.pidStartPairs) && Number(cleanup.pidStartPairs) > 0);
  else assert.equal(cleanup.censusStatus, 'available');
  for (const key of ['survivors', 'unknownProcessQueries', 'missingForeignDevices'])
    assert.deepEqual(cleanup[key], [], `Native connection cleanup has ${key}`);
  assert.equal(cleanup.ownedDeviceAbsent, true);
  assert.notEqual(cleanup.cacheAbsent, false);
  const docker = record(cleanup.docker, 'native connection cleanup docker');
  for (const key of ['container', 'network', 'volume'])
    assert.deepEqual(docker[key], [], `Native connection cleanup has Docker ${key}`);
}

function requireTransport(value: unknown, apiOrigin: string): ProxyObservation[] {
  requireIntegratedLoopbackOrigin(apiOrigin);
  const rows = array(value, 'native connection transport').map((raw) => {
    const row = record(raw, 'native connection transport row');
    assert(Number.isSafeInteger(row.requestId) && Number(row.requestId) > 0);
    assert(
      typeof row.method === 'string' &&
        typeof row.pathHash === 'string' &&
        /^[a-f0-9]{64}$/.test(row.pathHash),
    );
    assert(typeof row.targetOrigin === 'string' && row.targetOrigin === apiOrigin);
    assert(
      row.requestOrigin === null && row.requestProfile === 'native' && row.outcome === 'forwarded',
    );
    assert(
      Number.isSafeInteger(row.status) && Number(row.status) >= 100 && Number(row.status) <= 599,
    );
    assert(row.faultAttemptId === null);
    return row as unknown as ProxyObservation;
  });
  assert(rows.length > 0);
  assert.equal(
    new Set(rows.map((row) => row.requestId)).size,
    rows.length,
    'Native connection request IDs are duplicated',
  );
  return rows;
}

function requireAuthIdentities(
  value: unknown,
  apiOrigin: string,
  apiPid: number,
): NativeAuthIdentityObservation[] {
  requireIntegratedLoopbackOrigin(apiOrigin);
  const rows = array(value, 'native connection auth identities').map((raw) => {
    const row = record(raw, 'native connection auth identity');
    assert(Number.isSafeInteger(row.requestId) && Number(row.requestId) > 0);
    assert(Number.isSafeInteger(row.ordinal) && Number(row.ordinal) > 0);
    assert(typeof row.targetOrigin === 'string' && row.targetOrigin === apiOrigin);
    assert.equal(row.apiPid, apiPid);
    assert(Number.isSafeInteger(row.status));
    assert(row.authUid === null || (typeof row.authUid === 'string' && row.authUid.length > 0));
    assert(row.verification === 'verified' || row.verification === 'unverified');
    assert(typeof row.verificationReason === 'string' && row.verificationReason.length > 0);
    requireHash(row.fixtureAuthUidAllowlistHash, 'Native connection auth allowlist hash');
    return row as unknown as NativeAuthIdentityObservation;
  });
  assert.equal(
    new Set(rows.map((row) => row.requestId)).size,
    rows.length,
    'Native auth request IDs are duplicated',
  );
  assert.equal(
    new Set(rows.map((row) => row.ordinal)).size,
    rows.length,
    'Native auth ordinals are duplicated',
  );
  return rows;
}

function requireCaptureIdentity(
  capture: Capture,
  captureRunId: string,
  fixtureRunId: string,
  platform: NativeConnectionEvidencePlatform,
): void {
  assert.equal(capture.kind, 'private-owned-native-connection-execution-not-public-receipt');
  assert.equal(capture.mode, 'integration');
  assert.equal(capture.platform, platform);
  assert.equal(capture.charter, 'connection-journey');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  requireHash(capture.fixtureHash, 'Native connection fixture hash');
  requireRunId(captureRunId, 'Capture run');
  assert.equal(capture.backend?.runId, fixtureRunId);
  if (platform === 'ios') {
    const udid = capture.device?.udid;
    assert(
      typeof udid === 'string' && /^[A-Fa-f0-9-]{36}$/.test(udid),
      'Native connection device identity is invalid',
    );
  } else {
    const serial = capture.device?.serial;
    const avd = capture.device?.avd;
    assert(typeof serial === 'string' && serial.length > 0, 'Android device serial is invalid');
    assert(typeof avd === 'string' && avd.length > 0, 'Android AVD identity is invalid');
  }
}

type ApiProcessIdentity = { pid: number; started: string; script: string };

export function assertNativeConnectionBackendProvenance(
  backendValue: unknown,
  apiIdentityValue: unknown,
  expectedRunId: string,
  expectedAttemptId: string,
): ApiProcessIdentity {
  const backend = record(backendValue, 'Native connection backend provenance');
  const apiIdentity = record(apiIdentityValue, 'Native connection API identity');
  requireRunId(expectedRunId, 'Native connection backend run');
  assert.equal(backend.backendAttemptId, `${expectedRunId}:first`);
  assert.equal(backend.backendAttemptId, expectedAttemptId);
  assert(typeof backend.apiOrigin === 'string');
  requireIntegratedLoopbackOrigin(backend.apiOrigin);
  assert.equal(apiIdentity.targetOrigin, backend.apiOrigin);
  assert(Number.isSafeInteger(apiIdentity.apiPid) && Number(apiIdentity.apiPid) > 1);
  const identity = record(backend.apiProcess, 'Native connection API process identity');
  assert(Number.isSafeInteger(identity.pid) && Number(identity.pid) > 1);
  assert(typeof identity.started === 'string' && identity.started.length > 0);
  assert(typeof identity.script === 'string' && identity.script.length > 0);
  assert.equal(identity.pid, apiIdentity.apiPid);
  const processes = array(backend.processes, 'Native connection backend processes').map((raw) =>
    record(raw, 'Native connection backend process'),
  );
  assert(processes.length > 0, 'Native connection backend process list is empty');
  const pids = processes.map((process) => process.pid);
  assert(
    pids.every((pid) => Number.isSafeInteger(pid) && Number(pid) > 1),
    'Native connection backend process identity is incomplete',
  );
  assert.equal(
    new Set(pids).size,
    pids.length,
    'Native connection backend process identity is duplicated',
  );
  const apiRows = processes.filter((row) => row.role === 'api');
  assert.equal(apiRows.length, 1, 'Native connection backend API process identity is not unique');
  assert.equal(apiRows[0].pid, identity.pid);
  assert.equal(apiRows[0].started, identity.started);
  assert.equal(apiRows[0].script, identity.script);
  return {
    pid: Number(identity.pid),
    started: identity.started,
    script: identity.script,
  };
}

function requireApiProcessBinding(
  capture: Capture,
  apiIdentity: Record<string, unknown>,
  expectedAttemptId: string,
): ApiProcessIdentity {
  return assertNativeConnectionBackendProvenance(
    capture.backend,
    apiIdentity,
    capture.backend.runId,
    expectedAttemptId,
  );
}

function requireObservationRows(
  value: unknown,
  expected: ProxyObservation[],
  route: string,
  method: string,
  status: number,
  unique: boolean,
): void {
  const rows = array(value, `native connection ${route} observations`).map(
    (raw) => record(raw, 'native connection observation row') as unknown as ProxyObservation,
  );
  assert(rows.length > 0);
  if (unique) assert.equal(rows.length, 1);
  const expectedById = new Map(expected.map((row) => [row.requestId, row]));
  const routeHash = sha256(route);
  for (const row of rows) {
    assert(
      expectedById.has(row.requestId),
      `Native connection ${route} observation is not in transport history`,
    );
    assert.equal(row.pathHash, routeHash);
    assert.equal(row.method, method);
    assert.equal(row.status, status);
    assert.equal(row.outcome, 'forwarded');
    assert.equal(row.requestProfile, 'native');
    assert.equal(row.requestOrigin, null);
    assert.equal(row.faultAttemptId, null);
    assert.deepEqual(row, expectedById.get(row.requestId));
  }
}

/** Public contract hook for resource-free route/field pairing checks. */
export function assertNativeConnectionObservationRoute(
  value: unknown,
  expected: ProxyObservation[],
  route: string,
  method: string,
  status: number,
  unique: boolean,
): void {
  requireObservationRows(value, expected, route, method, status, unique);
}

function requireCanonicalProofs(
  captureRoot: string,
  selection: NativePilotSelection,
  binding: NativeConnectionAttemptBinding,
): void {
  const rows = requireNativePilotAssertions(selection);
  const bindings = expectedBindings(selection, binding.backendAttemptId);
  assert.equal(bindings.length, rows.length);
  for (const [index, row] of rows.entries()) {
    const bindingRow = bindings[index];
    assert.equal(bindingRow.id, row.id);
    assert.deepEqual(bindingRow.requirementRefs, row.requirementRefs);
    for (const [kindIndex, evidencePath] of bindingRow.evidencePaths.entries()) {
      const evidenceKind = row.evidenceKinds[kindIndex];
      const references = referencesFor(row.id, evidenceKind, selection.arguments.platform);
      assert(references.length > 0, `Connection proof recipe is empty: ${row.id}/${evidenceKind}`);
      const resolved = references.map((reference) => ({
        ...reference,
        sha256: sha256(
          readNativeEvidence(captureRoot, reference.path, !reference.path.endsWith('.png')),
        ),
      }));
      const expected = {
        schemaVersion: 1,
        kind: nativeConnectionAssertionEvidenceKind,
        purpose: 'runtime',
        assertionId: row.id,
        evidenceKind,
        requirementRefs: row.requirementRefs,
        fixtureRunId: binding.backendRunId,
        attemptId: binding.backendAttemptId,
        scenarioHash: selection.scenarioHash,
        requirementHash: selection.requirementHash,
        references: resolved,
        nativePassingCases: 0,
        scope:
          'prepared runtime connection proof; public receipt/finalization and engine qualification are separate',
      } as const;
      const actual = json(captureRoot, evidencePath);
      assertNativeConnectionProofExact(actual, expected, evidencePath);
    }
  }
}

/** Exact proof-body guard used before any reference can enter the staged copy. */
export function assertNativeConnectionProofExact(
  actual: unknown,
  expected: {
    schemaVersion: 1;
    kind: typeof nativeConnectionAssertionEvidenceKind;
    purpose: 'runtime';
    assertionId: string;
    evidenceKind: EvidenceKind;
    requirementRefs: readonly string[];
    fixtureRunId: string;
    attemptId: string;
    scenarioHash: string;
    requirementHash: string;
    references: readonly EvidenceReference[];
    nativePassingCases: 0;
    scope: string;
  },
  label = 'native connection assertion proof',
): void {
  assert(expected.references.length > 0, `${label} has no canonical references`);
  assert.equal(
    new Set(expected.references.map((reference) => reference.path)).size,
    expected.references.length,
    `${label} has duplicate canonical references`,
  );
  assert.deepEqual(
    actual,
    expected,
    `Connection proof is not the canonical frozen recipe: ${label}`,
  );
}

function requireTransportWindows(
  value: unknown,
  observations: ProxyObservation[],
  targetOrigin: string,
): void {
  const windows = array(value, 'native connection transport windows').map((raw) => {
    const row = record(raw, 'native connection transport window');
    assert(row.method === 'GET' || row.method === 'POST');
    assert(typeof row.route === 'string' && row.route.startsWith('/'));
    assert(Number.isSafeInteger(row.status) && Number(row.status) >= 100);
    const afterRequestId = row.afterRequestId;
    assert(Number.isSafeInteger(afterRequestId) && Number(afterRequestId) >= 0);
    const throughRequestId = row.throughRequestId;
    assert(
      Number.isSafeInteger(throughRequestId) && Number(throughRequestId) > Number(afterRequestId),
    );
    assert(typeof row.unique === 'boolean');
    return row as unknown as {
      method: 'GET' | 'POST';
      route: string;
      status: number;
      afterRequestId: number;
      throughRequestId: number;
      unique: boolean;
    };
  });
  assert(windows.length > 0);
  for (const window of windows)
    requireNativeConnectionTransport({ observations, targetOrigin, ...window });
}

function requireFixtureEvidence(
  captureRoot: string,
  capture: Capture,
  journey: JourneyReport,
  fixtureRunId: string,
  platform: NativeConnectionEvidencePlatform,
): Pick<OwnedFixtures, 'accounts' | 'runId' | 'scope'> {
  const evidence = record(journey.fixtureEvidence, 'connection fixture evidence');
  assert.equal(evidence.path, 'connection-fixtures.private.json');
  requireHash(evidence.sha256, 'Connection fixture evidence hash');
  const bytes = readNativeEvidence(captureRoot, evidence.path, true);
  assert.equal(sha256(bytes), evidence.sha256, 'Connection fixture evidence changed');
  assert.equal(
    evidence.sha256,
    capture.fixtureHash,
    'Connection fixture hash is not bound to capture',
  );
  const value = JSON.parse(bytes.toString()) as unknown;
  assertTestingDocument('application-fixtures-v1', value);
  const fixtures = value as OwnedFixtures;
  assert.equal(fixtures.runId, fixtureRunId);
  assert.equal(fixtures.scope, `native-entry-${platform}`);
  const fixtureAuthUids = Object.values(fixtures.accounts)
    .map((account) => account.authUid)
    .sort();
  assert.deepEqual(fixtureAuthUids, journey.target.fixtureAuthUids);
  assert.equal(fixtures.accounts.coach.authUid, journey.target.professionalAuthUid);
  assert.equal(fixtures.accounts.student.authUid, journey.target.studentAuthUid);
  assert.equal(fixtures.accounts.coach.role, 'professional');
  assert.equal(fixtures.accounts.student.role, 'student');
  return fixtures;
}

function snapshotPathLabel(label: string): string {
  return `connection-${label.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}.private.json`;
}

function loadJourneySnapshots(
  captureRoot: string,
  journey: JourneyReport,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [label, ref] of Object.entries(journey.snapshots)) {
    assert(ref && typeof ref.path === 'string' && typeof ref.sha256 === 'string');
    assert.equal(
      ref.path,
      snapshotPathLabel(label),
      `Connection snapshot path is not canonical: ${label}`,
    );
    requireHash(ref.sha256, `Connection snapshot ${label}`);
    const bytes = readNativeEvidence(captureRoot, ref.path, true);
    assert.equal(sha256(bytes), ref.sha256, `Connection snapshot ${label} changed`);
    result[label] = JSON.parse(bytes.toString()) as unknown;
  }
  for (const required of [
    'normalCoachBefore',
    'normalCoachAfter',
    'before',
    'pending',
    'pendingAfterCoachAuth',
    'active',
    'activeAfterStudentAuth',
    'final',
    'isolationBefore',
    'isolationAfter',
    'trainingBefore',
    'trainingAfter',
  ])
    assert(Object.hasOwn(result, required), `Connection snapshot ${required} is missing`);
  return result;
}

export function requireNativeConnectionInitialAuthBinding(input: {
  initialAuth: unknown;
  target: unknown;
  authIdentities: readonly NativeAuthIdentityObservation[];
  transport: readonly ProxyObservation[];
  apiOrigin: string;
}): void {
  const initialAuth = record(input.initialAuth, 'initial coach auth');
  const target = record(input.target, 'connection target');
  assert.equal(initialAuth.actor, 'coach');
  assert.equal(initialAuth.actorAuthUid, target.professionalAuthUid);
  assert(
    Number.isSafeInteger(initialAuth.authRequestId) && Number(initialAuth.authRequestId) > 0,
    'Initial coach auth request ID is invalid',
  );
  assert(
    Number.isSafeInteger(initialAuth.afterRequestId) &&
      Number(initialAuth.afterRequestId) >= Number(initialAuth.authRequestId),
    'Initial coach auth window is invalid',
  );
  const fixtureAuthUids = array(
    target.fixtureAuthUids,
    'Initial coach auth fixture identities',
  ).map((value) => {
    assert(typeof value === 'string' && value.length > 0);
    return value;
  });
  assert.deepEqual(
    fixtureAuthUids,
    [...fixtureAuthUids].sort(),
    'Initial coach auth fixture identities are not canonical',
  );
  assert.equal(
    new Set(fixtureAuthUids).size,
    fixtureAuthUids.length,
    'Initial coach auth fixture identities are duplicated',
  );
  assert(fixtureAuthUids.includes(String(target.professionalAuthUid)));
  assert(fixtureAuthUids.includes(String(target.studentAuthUid)));
  const expectedAllowlistHash = sha256(JSON.stringify(fixtureAuthUids));
  const authRequestId = Number(initialAuth.authRequestId);
  const afterRequestId = Number(initialAuth.afterRequestId);
  const initialMatches = input.authIdentities.filter(
    (identity) => identity.requestId >= authRequestId && identity.requestId <= afterRequestId,
  );
  assert.equal(
    initialMatches.length,
    1,
    'Initial coach auth window must contain exactly one principal identity',
  );
  const initialIdentity = initialMatches[0];
  assert.equal(initialIdentity.requestId, authRequestId);
  assert.equal(initialIdentity.authUid, target.professionalAuthUid);
  assert.equal(initialIdentity.status, 201);
  assert.equal(initialIdentity.verification, 'verified');
  assert.equal(initialIdentity.verificationReason, 'verified');
  assert.equal(initialIdentity.fixtureAuthUidAllowlistHash, expectedAllowlistHash);
  assert.equal(initialIdentity.targetOrigin, input.apiOrigin);
  const signInPathHash = sha256('/auth/email/sign-in');
  const initialSignIns = input.transport.filter(
    (row) =>
      row.requestId >= authRequestId &&
      row.requestId <= afterRequestId &&
      row.method === 'POST' &&
      row.pathHash === signInPathHash,
  );
  assert.equal(
    initialSignIns.length,
    1,
    'Initial coach auth window must contain exactly one native sign-in transport',
  );
  const initialTransport = initialSignIns[0];
  assert.equal(initialTransport.requestId, authRequestId);
  assert.equal(initialTransport.status, 201);
  assert.equal(initialTransport.requestProfile, 'native');
  assert.equal(initialTransport.requestOrigin, null);
  assert.equal(initialTransport.targetOrigin, input.apiOrigin);
  assert.equal(initialTransport.outcome, 'forwarded');
  assert.equal(initialTransport.faultAttemptId, null);
}

function validateJourney(
  captureRoot: string,
  capture: Capture,
  binding: NativeConnectionAttemptBinding,
  fixtures: Pick<OwnedFixtures, 'accounts' | 'runId' | 'scope'>,
  transport: ProxyObservation[],
  authIdentities: NativeAuthIdentityObservation[],
  platform: NativeConnectionEvidencePlatform,
): { journey: JourneyReport; snapshots: Record<string, unknown> } {
  const journey = record(
    capture.connectionJourneyPreparation,
    'connection journey preparation',
  ) as unknown as JourneyReport;
  assert.equal(journey.kind, 'private-native-connection-journey-not-public-receipt');
  assert.deepEqual(journey.binding, binding);
  assert.equal(journey.nativePassingCases, 0);
  assert.deepEqual(capture.connectionInitialAuth, journey.initialAuth);
  assert(Array.isArray(capture.connectionAccountSwitches));
  assert(
    (capture.connectionAccountSwitches as unknown[]).some(
      (row) => JSON.stringify(row) === JSON.stringify(journey.initialStudent),
    ),
  );
  assert(
    (capture.connectionAccountSwitches as unknown[]).some(
      (row) => JSON.stringify(row) === JSON.stringify(journey.coachSwitch),
    ),
  );
  assert(
    (capture.connectionAccountSwitches as unknown[]).some(
      (row) => JSON.stringify(row) === JSON.stringify(journey.studentSwitch),
    ),
  );
  assert.equal(
    journey.scope,
    'private UI/owned-transport/projected-SQL preparation; public staging and cleanup remain separate',
  );
  assert.deepEqual(journey.requirementRefs, [
    'SC-211',
    'UC-002.3',
    'AC-214',
    'BR-213',
    'TC-213',
    'TC-214',
  ]);
  const target = record(journey.target, 'connection journey target');
  assert.equal(target.runId, binding.backendRunId);
  assert.equal(target.scope, `native-entry-${platform}`);
  assert.equal(target.professionalAuthUid !== target.studentAuthUid, true);
  const fixtureAuthUids = array(target.fixtureAuthUids, 'Connection target fixture identities').map(
    (value) => {
      assert(typeof value === 'string' && value.length > 0);
      return value;
    },
  );
  assert.deepEqual(fixtureAuthUids, [...fixtureAuthUids].sort());
  assert.equal(new Set(fixtureAuthUids).size, fixtureAuthUids.length);
  assert(fixtureAuthUids.includes(target.professionalAuthUid as string));
  assert(fixtureAuthUids.includes(target.studentAuthUid as string));
  assert(
    typeof journey.connectionId === 'string' && uuidPattern.test(journey.connectionId),
    'Native connection ID is invalid',
  );
  assert.equal(fixtures.runId, binding.backendRunId);
  assert.equal(fixtures.scope, `native-entry-${platform}`);
  const snapshots = loadJourneySnapshots(captureRoot, journey);
  const expected = {
    runId: binding.backendRunId,
    scope: `native-entry-${platform}`,
    fixtureAuthUids: journey.target.fixtureAuthUids,
    target: {
      professionalAuthUid: journey.target.professionalAuthUid,
      studentAuthUid: journey.target.studentAuthUid,
      specialty: 'fitness_coach' as const,
    },
  };
  const before = requireConnectionSnapshot(snapshots.before, expected);
  const normalCoachBefore = requireConnectionSnapshot(snapshots.normalCoachBefore, expected);
  const normalCoachAfter = requireConnectionSnapshot(snapshots.normalCoachAfter, expected);
  verifyConnectionSnapshotCheckpoint({
    snapshot: normalCoachBefore,
    checkpoint: 'unlinked',
    expected,
  });
  verifyConnectionSnapshotCheckpoint({
    snapshot: normalCoachAfter,
    checkpoint: 'unlinked',
    expected,
  });
  assert.deepEqual(normalCoachAfter, normalCoachBefore, 'Normal coach entry changed SQL');
  const pending = requireConnectionSnapshot(snapshots.pending, expected);
  const pendingAfterCoachAuth = requireConnectionSnapshot(
    snapshots.pendingAfterCoachAuth,
    expected,
  );
  const active = requireConnectionSnapshot(snapshots.active, expected);
  const activeAfterStudentAuth = requireConnectionSnapshot(
    snapshots.activeAfterStudentAuth,
    expected,
  );
  const final = requireConnectionSnapshot(snapshots.final, expected);
  assert.deepEqual(
    final,
    activeAfterStudentAuth,
    'Connection final snapshot differs from active student checkpoint',
  );
  assert.deepEqual(
    snapshots.isolationBefore,
    snapshots.isolationAfter,
    'Connection isolation scope changed',
  );
  assert.deepEqual(
    snapshots.trainingBefore,
    snapshots.trainingAfter,
    'Training plans changed during connection journey',
  );
  verifyConnectionSnapshotCheckpoint({ snapshot: before, checkpoint: 'unlinked', expected });
  verifyConnectionSnapshotCheckpoint({ snapshot: pending, checkpoint: 'pending', expected });
  verifyConnectionSnapshotCheckpoint({ snapshot: active, checkpoint: 'active', expected });
  const hierarchyTarget: NativeConnectionTargetScope = {
    runId: journey.target.runId,
    scope: journey.target.scope,
    fixtureAuthUids: [...journey.target.fixtureAuthUids],
    professionalAuthUid: journey.target.professionalAuthUid,
    studentAuthUid: journey.target.studentAuthUid,
  };
  const pendingStudentMatch = resolvePendingStudentConnectionCard({
    tree: json(captureRoot, framePath('connection-student-pending', 'hierarchy.json')),
    snapshot: pending,
    target: hierarchyTarget,
    expectedPendingGuidance: enUS['relationship.pending.helper'],
  });
  assert.deepEqual(
    journey.pendingStudentMatch,
    pendingStudentMatch,
    'Pending student hierarchy match differs from the captured controller report',
  );
  const pendingRosterMatch =
    platform === 'android'
      ? resolveAndroidProfessionalRosterTarget({
          tree: json(captureRoot, framePath('connection-coach-pending-roster', 'hierarchy.json')),
          targetStudentAuthUid: hierarchyTarget.studentAuthUid,
          assignmentState: 'pending',
        })
      : resolveProfessionalRosterTarget({
          tree: json(captureRoot, framePath('connection-coach-pending-roster', 'hierarchy.json')),
          targetStudentAuthUid: hierarchyTarget.studentAuthUid,
          assignmentState: 'pending',
        });
  assert.deepEqual(
    journey.pendingRosterMatch,
    pendingRosterMatch,
    'Pending professional roster match differs from the captured controller report',
  );
  const rosterMatch =
    platform === 'android'
      ? resolveAndroidProfessionalRosterTarget({
          tree: json(captureRoot, framePath('connection-coach-roster', 'hierarchy.json')),
          targetStudentAuthUid: hierarchyTarget.studentAuthUid,
          assignmentState: 'active',
        })
      : resolveProfessionalRosterTarget({
          tree: json(captureRoot, framePath('connection-coach-roster', 'hierarchy.json')),
          targetStudentAuthUid: hierarchyTarget.studentAuthUid,
          assignmentState: 'active',
        });
  if (platform === 'android') {
    const frameQualification = record(
      (journey as unknown as Record<string, unknown>).frameQualification,
      'Android connection frame qualification',
    );
    assert.equal(frameQualification.platform, 'android');
    assert.equal(frameQualification.frameTextAttribute, 'accessibilityText');
    assert.equal(frameQualification.status, 'qualified');
    assert.equal(
      (pendingRosterMatch.assignmentStateEvidence as { attribute: string }).attribute,
      'accessibilityText',
    );
    assert.equal(
      (rosterMatch.assignmentStateEvidence as { attribute: string }).attribute,
      'accessibilityText',
    );
  }
  assert.deepEqual(
    journey.rosterMatch,
    rosterMatch,
    'Active professional roster match differs from the captured controller report',
  );
  const pendingMatch = resolvePendingConnectionTarget({
    tree: json(captureRoot, framePath('connection-coach-pending', 'hierarchy.json')),
    snapshot: pendingAfterCoachAuth,
    target: hierarchyTarget,
  });
  assert.deepEqual(
    journey.pendingMatch,
    pendingMatch,
    'Pending coach queue match differs from the captured controller report',
  );
  const activeMatch = resolveActiveConnectionCard({
    tree: json(captureRoot, framePath('connection-student-active', 'hierarchy.json')),
    snapshot: activeAfterStudentAuth,
    target: hierarchyTarget,
  });
  assert.deepEqual(
    journey.activeMatch,
    activeMatch,
    'Active student hierarchy match differs from the captured controller report',
  );
  const targetApi = record(capture.connectionApiIdentity, 'connection API identity');
  const apiOrigin = String(targetApi.targetOrigin);
  const apiPid = Number(targetApi.apiPid);
  requireTransportWindows(journey.transportWindows, transport, apiOrigin);
  const checkpoints = verifyNativeConnectionJourney({
    before,
    pending,
    pendingAfterCoachAuth,
    active,
    activeAfterStudentAuth,
    fixtures,
    observations: transport,
    authIdentities,
    expectedApiIdentity: { targetOrigin: apiOrigin, apiPid },
    coachAuth: {
      afterRequestId: journey.coachSwitch.beforeRequestId,
      throughRequestId: journey.coachSwitch.afterRequestId,
    },
    studentAuth: {
      afterRequestId: journey.studentSwitch.beforeRequestId,
      throughRequestId: journey.studentSwitch.afterRequestId,
    },
  });
  assert.deepEqual(
    journey.checkpoints,
    checkpoints,
    'Connection checkpoint report is stale or incomplete',
  );
  requireNativeConnectionInitialAuthBinding({
    initialAuth: journey.initialAuth,
    target: journey.target,
    authIdentities,
    transport,
    apiOrigin,
  });
  for (const [field, actor] of [
    ['initialStudent', 'student'],
    ['coachSwitch', 'coach'],
    ['studentSwitch', 'student'],
  ] as const) {
    const value = record(journey[field], `${field} switch`) as unknown as AccountSwitch;
    assert.equal(value.actor, actor);
    assert.equal(
      value.actorAuthUid,
      actor === 'coach' ? journey.target.professionalAuthUid : journey.target.studentAuthUid,
    );
    assert(
      Number.isSafeInteger(value.authRequestId) &&
        Number.isSafeInteger(value.beforeRequestId) &&
        Number.isSafeInteger(value.afterRequestId),
    );
    assert(
      value.beforeRequestId < value.authRequestId && value.authRequestId <= value.afterRequestId,
    );
  }
  requireObservationRows(
    journey.submission,
    transport,
    '/connections/invite-submissions',
    'POST',
    201,
    true,
  );
  requireObservationRows(
    journey.inviteReads,
    transport,
    '/professional/invite-codes/fitness_coach',
    'GET',
    200,
    false,
  );
  requireObservationRows(
    journey.normalCoachPendingReads,
    transport,
    '/connections',
    'GET',
    200,
    false,
  );
  requireObservationRows(
    journey.normalCoachRosterReads,
    transport,
    '/professional/students',
    'GET',
    200,
    false,
  );
  requireObservationRows(
    journey.pendingRosterReads,
    transport,
    '/professional/students',
    'GET',
    200,
    false,
  );
  requireObservationRows(
    journey.confirmation,
    transport,
    `/connections/${journey.connectionId}/confirm`,
    'POST',
    200,
    true,
  );
  requireObservationRows(
    journey.initialRelationshipReads,
    transport,
    '/connections',
    'GET',
    200,
    false,
  );
  requireObservationRows(
    journey.pendingRelationshipReads,
    transport,
    '/connections',
    'GET',
    200,
    false,
  );
  requireObservationRows(journey.coachPendingReads, transport, '/connections', 'GET', 200, false);
  requireObservationRows(
    journey.rosterReads,
    transport,
    '/professional/students',
    'GET',
    200,
    false,
  );
  requireObservationRows(journey.relationshipReads, transport, '/connections', 'GET', 200, false);
  assert.equal(journey.isolationUnchanged, true);
  assert.equal(journey.trainingPlansUnchanged, true);
  for (const [label, value] of [
    ['pendingStudentMatch', journey.pendingStudentMatch],
    ['pendingMatch', journey.pendingMatch],
    ['pendingRosterMatch', journey.pendingRosterMatch],
    ['rosterMatch', journey.rosterMatch],
    ['activeMatch', journey.activeMatch],
  ] as const)
    record(value, `connection ${label}`);
  return { journey, snapshots };
}

function validateFrames(
  captureRoot: string,
  capture: Capture,
  selection: NativePilotSelection,
): void {
  for (const [label, viewId] of connectionFrameViews)
    if (requiredFrameLabels(selection).has(label))
      requireFrameObservation(capture, captureRoot, label, viewId);
}

function evidenceReferences(
  captureRoot: string,
  selection: NativePilotSelection,
  binding: NativeConnectionAttemptBinding,
): NativeConnectionAssertionBinding[] {
  const bindings = expectedBindings(selection, binding.backendAttemptId);
  const ledger = requireNativePilotAssertions(selection);
  assert.equal(bindings.length, ledger.length);
  return bindings;
}

async function loadAndValidate(options: {
  repositoryRoot: string;
  captureRoot: string;
  requestedRunId: string;
  fixtureRunId?: string;
  selection: NativePilotSelection;
  requireProofs: boolean;
  platform: NativeConnectionEvidencePlatform;
}): Promise<LoadedEvidence> {
  const { repositoryRoot, selection } = await freshSelection(
    options.repositoryRoot,
    options.selection,
    options.platform,
  );
  const captureRoot = await privateRoot(options.captureRoot);
  requireRunId(options.requestedRunId, 'Requested run');
  assert.equal(path.basename(captureRoot).length, 24);
  const capture = json(captureRoot, 'capture.private.json') as Capture;
  const captureRunId = path.basename(captureRoot);
  requireRunId(captureRunId, 'Capture run');
  const fixtureRunId = options.fixtureRunId ?? capture.backend?.runId;
  requireRunId(fixtureRunId, 'Fixture run');
  requireCaptureIdentity(capture, captureRunId, fixtureRunId, options.platform);
  await requireBuildMetadata(capture.build, options.platform);
  await requireSourceAndHelpers(repositoryRoot, capture, options.platform);
  requireCommandDiagnostics(capture.commandExecutions);
  const commandArtifacts = commandArtifactPaths(capture, captureRoot);
  for (const relative of commandArtifacts.paths)
    if (commandArtifacts.logPaths.has(relative)) await readNativeCommandLog(captureRoot, relative);
    else readNativeEvidence(captureRoot, relative, true);
  const cleanup = json(captureRoot, nativeConnectionCleanupPath);
  requireCleanupEvidence(cleanup, captureRunId, options.platform);
  const binding = await readNativeConnectionAttemptBinding({
    repositoryRoot,
    artifactRoot: captureRoot,
    requestedRunId: options.requestedRunId,
    backendRunId: fixtureRunId,
    selection,
  });
  assert.equal(binding.captureRunId, captureRunId);
  assert.equal(binding.backendRunId, fixtureRunId);
  const apiIdentity = record(capture.connectionApiIdentity, 'connection API identity');
  requireApiProcessBinding(capture, apiIdentity, binding.backendAttemptId);
  const apiOrigin = String(apiIdentity.targetOrigin);
  requireIntegratedLoopbackOrigin(apiOrigin);
  assert.notEqual(
    apiOrigin,
    capture.build.apiOrigin,
    'Proxy target must be distinct from app origin',
  );
  assert.notEqual(
    apiOrigin,
    capture.build.metroOrigin,
    'Proxy target must be distinct from Metro origin',
  );
  assert(Number.isSafeInteger(apiIdentity.apiPid) && Number(apiIdentity.apiPid) > 1);
  const transport = requireTransport(json(captureRoot, nativeConnectionTransportPath), apiOrigin);
  const authIdentities = requireAuthIdentities(
    json(captureRoot, nativeConnectionAuthIdentitiesPath),
    apiOrigin,
    Number(apiIdentity.apiPid),
  );
  const journey = record(
    capture.connectionJourneyPreparation,
    'connection journey preparation',
  ) as unknown as JourneyReport;
  const fixture = requireFixtureEvidence(
    captureRoot,
    capture,
    journey,
    fixtureRunId,
    options.platform,
  );
  if (options.platform === 'ios') {
    await requireNativeConnectionPasswordOfferWitnesses(capture.connectionPasswordOfferWitnesses, {
      artifactRoot: captureRoot,
      expected: [
        {
          actor: 'coach',
          flowLabel: 'coach-home',
          actorAuthUid: fixture.accounts.coach.authUid,
          signInRequestOrdinal: 1,
          authRequestId: journey.initialAuth.authRequestId,
          homeSelector: 'pro.home.screen',
        },
        {
          actor: 'student',
          flowLabel: 'connection-switch-1-student-home',
          actorAuthUid: fixture.accounts.student.authUid,
          signInRequestOrdinal: 2,
          authRequestId: journey.initialStudent.authRequestId,
          homeSelector: 'student.home.screen',
        },
        {
          actor: 'coach',
          flowLabel: 'connection-switch-2-coach-home',
          actorAuthUid: fixture.accounts.coach.authUid,
          signInRequestOrdinal: 3,
          authRequestId: journey.coachSwitch.authRequestId,
          homeSelector: 'pro.home.screen',
        },
        {
          actor: 'student',
          flowLabel: 'connection-switch-3-student-home',
          actorAuthUid: fixture.accounts.student.authUid,
          signInRequestOrdinal: 4,
          authRequestId: journey.studentSwitch.authRequestId,
          homeSelector: 'student.home.screen',
        },
      ],
    });
  }
  const validated = validateJourney(
    captureRoot,
    capture,
    binding,
    fixture,
    transport,
    authIdentities,
    options.platform,
  );
  validateFrames(captureRoot, capture, selection);
  const bindings = evidenceReferences(captureRoot, selection, binding);
  if (options.requireProofs) requireCanonicalProofs(captureRoot, selection, binding);
  return {
    repositoryRoot,
    captureRoot,
    selection,
    binding,
    fixture,
    capture,
    journey: validated.journey,
    transport,
    authIdentities,
    snapshots: validated.snapshots,
    bindings,
    commandArtifacts,
  };
}

function readReference(captureRoot: string, reference: EvidenceReference): EvidenceReference {
  assert(!path.isAbsolute(reference.path));
  if (reference.redacted) {
    requireHash(reference.sha256, `Redacted reference ${reference.path}`);
    return { ...reference };
  }
  const bytes = readNativeEvidence(captureRoot, reference.path, !reference.path.endsWith('.png'));
  const digest = sha256(bytes);
  assert.equal(
    reference.sha256,
    digest,
    `Connection evidence reference changed: ${reference.path}`,
  );
  return { ...reference };
}

async function writeProofs(loaded: LoadedEvidence): Promise<void> {
  const controllerBytes = Buffer.from(JSON.stringify(loaded.journey, null, 2) + '\n');
  await writeFile(
    assertArtifactPath(loaded.captureRoot, nativeConnectionJourneyPreparationPath),
    controllerBytes,
    { flag: 'wx', mode: 0o600 },
  );
  const ledger = requireNativePilotAssertions(loaded.selection);
  for (const [index, row] of ledger.entries()) {
    const binding = loaded.bindings[index];
    for (const [kindIndex, evidencePath] of binding.evidencePaths.entries()) {
      const kind = row.evidenceKinds[kindIndex];
      const references = referencesFor(row.id, kind, loaded.selection.arguments.platform);
      assert(references.length > 0, `Native connection proof recipe is empty: ${row.id}/${kind}`);
      const resolved: EvidenceReference[] = [];
      for (const reference of references) {
        const bytes = readNativeEvidence(
          loaded.captureRoot,
          reference.path,
          !reference.path.endsWith('.png'),
        );
        resolved.push({
          ...reference,
          sha256: sha256(bytes),
        });
      }
      const proofFile = assertArtifactPath(loaded.captureRoot, evidencePath);
      // The per-attempt assertions directory is created here, privately.
      await mkdir(path.dirname(proofFile), { recursive: true, mode: 0o700 });
      await writeFile(
        proofFile,
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: nativeConnectionAssertionEvidenceKind,
            purpose: 'runtime',
            assertionId: row.id,
            evidenceKind: kind,
            requirementRefs: row.requirementRefs,
            fixtureRunId: loaded.binding.backendRunId,
            attemptId: loaded.binding.backendAttemptId,
            scenarioHash: loaded.selection.scenarioHash,
            requirementHash: loaded.selection.requirementHash,
            references: resolved,
            nativePassingCases: 0,
            scope:
              'prepared runtime connection proof; public receipt/finalization and engine qualification are separate',
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    }
  }
}

/** Validate an actual capture and generate private seven-row proof templates only. */
export async function prepareConnectionPilotEvidence(options: {
  repositoryRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  requestedRunId: string;
  platform: NativeConnectionEvidencePlatform;
}): Promise<{
  fixtureRunId: string;
  attemptId: string;
  bindings: NativeConnectionAssertionBinding[];
  controllerReportPath: string;
  nativePassingCases: 0;
}> {
  const loaded = await loadAndValidate({
    repositoryRoot: options.repositoryRoot,
    captureRoot: options.artifactRoot,
    requestedRunId: options.requestedRunId,
    selection: options.selection,
    requireProofs: false,
    platform: options.platform,
  });
  await writeProofs(loaded);
  return {
    fixtureRunId: loaded.binding.backendRunId,
    attemptId: loaded.binding.backendAttemptId,
    bindings: loaded.bindings,
    controllerReportPath: nativeConnectionJourneyPreparationPath,
    nativePassingCases: 0,
  };
}

export async function prepareIosConnectionPilotEvidence(options: {
  repositoryRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  requestedRunId: string;
}) {
  return prepareConnectionPilotEvidence({ ...options, platform: 'ios' });
}

export async function prepareAndroidConnectionPilotEvidence(options: {
  repositoryRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  requestedRunId: string;
}) {
  return prepareConnectionPilotEvidence({ ...options, platform: 'android' });
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    assert.equal(
      await realpath(absolute),
      absolute,
      'Staged connection evidence contains a symlink',
    );
    if (entry.isDirectory()) {
      const info = await lstat(absolute);
      assert.equal(info.mode & 0o777, 0o700, 'Staged connection evidence directory is not private');
      result.push(...(await listFiles(absolute, relative)));
    } else {
      assert(entry.isFile(), 'Staged connection evidence contains a non-regular entry');
      const info = await lstat(absolute);
      assert.equal(info.mode & 0o777, 0o600, 'Staged connection evidence file is not private');
      result.push(relative);
    }
  }
  return result.sort();
}

async function copyNativeCommandLog(
  artifact: NativeCommandLogArtifact,
  destination: string,
  outputRoot: string,
  destinationRelative: string,
): Promise<void> {
  const before = await inspectPrivateCommandLog(artifact.root, artifact.relative);
  assert.equal(
    before.identity,
    artifact.identity,
    `Native connection command log changed: ${artifact.relative}`,
  );
  assert.equal(
    before.metadata.size,
    artifact.sizeBytes,
    `Native connection command log size changed: ${artifact.relative}`,
  );
  const digest = createHash('sha256');
  let sizeBytes = 0;
  const hashing = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      digest.update(bytes);
      callback(null, bytes);
    },
  });
  await pipeline(
    createReadStream(before.file),
    hashing,
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
  const after = await inspectPrivateCommandLog(artifact.root, artifact.relative);
  assert.equal(
    after.identity,
    artifact.identity,
    `Native connection command log changed during copy: ${artifact.relative}`,
  );
  assert.equal(
    after.metadata.size,
    artifact.sizeBytes,
    `Native connection command log size changed during copy: ${artifact.relative}`,
  );
  assert.equal(
    sizeBytes,
    artifact.sizeBytes,
    `Copied native connection command log size changed: ${artifact.relative}`,
  );
  assert.equal(
    digest.digest('hex'),
    artifact.sha256,
    `Copied native connection command log hash changed: ${artifact.relative}`,
  );
  const copied = await readNativeCommandLog(outputRoot, destinationRelative);
  assert.equal(
    copied.sizeBytes,
    artifact.sizeBytes,
    `Staged native connection command log size changed: ${artifact.relative}`,
  );
  assert.equal(
    copied.sha256,
    artifact.sha256,
    `Staged native connection command log hash changed: ${artifact.relative}`,
  );
}

function fileRedactionMap(loaded: LoadedEvidence): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const binding of loaded.bindings)
    for (const evidencePath of binding.evidencePaths) {
      const proof = record(json(loaded.captureRoot, evidencePath), 'native connection proof');
      assert.equal(proof.kind, nativeConnectionAssertionEvidenceKind);
      for (const raw of array(proof.references, 'native connection references')) {
        const reference = record(raw, 'native connection reference');
        assert(typeof reference.path === 'string' && reference.path.length > 0);
        requireHash(reference.sha256, 'Native connection reference hash');
        const redacted = reference.redacted === true;
        const prior = result.get(reference.path);
        if (prior !== undefined)
          assert.equal(
            prior,
            redacted,
            `Connection reference redaction differs: ${reference.path}`,
          );
        result.set(reference.path, redacted);
      }
    }
  return result;
}

/** Stage private non-secret references; staging remains preparation and keeps pass count zero. */
export async function stageNativeConnectionPublicEvidence(options: {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  bindings: NativeConnectionAssertionBinding[];
  platform?: NativeConnectionEvidencePlatform;
  lifecycle?: NativePublicEvidenceLifecycle;
}) {
  const platform = options.platform ?? 'ios';
  stageFence(options.lifecycle, 'load-and-validate:before');
  const loaded = await loadAndValidate({
    repositoryRoot: options.repositoryRoot,
    captureRoot: options.captureRoot,
    requestedRunId: options.requestedRunId,
    fixtureRunId: options.fixtureRunId,
    selection: options.selection,
    requireProofs: true,
    platform,
  });
  stageFence(options.lifecycle, 'load-and-validate:after');
  assert.deepEqual(options.bindings, loaded.bindings);
  const outputRoot = await privateRoot(options.outputRoot);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.notEqual(outputRoot, loaded.captureRoot);
  const redactions = fileRedactionMap(loaded);
  const files = new Map<string, CollectedFile>();
  const add = async (relative: string, commandLog = false) => {
    stageFence(options.lifecycle, `copy:${relative}:before`);
    assert(!redactions.get(relative), `Redacted connection evidence cannot be staged: ${relative}`);
    await addCaptureFile(files, loaded.captureRoot, relative, undefined, commandLog);
    stageFence(options.lifecycle, `copy:${relative}:after`);
  };
  for (const required of [
    connectionAttemptBindingPath,
    'capture.private.json',
    nativeConnectionTransportPath,
    nativeConnectionAuthIdentitiesPath,
    nativeConnectionCleanupPath,
    nativeConnectionJourneyPreparationPath,
  ])
    await add(required);
  for (const relative of loaded.commandArtifacts.paths)
    await add(relative, loaded.commandArtifacts.logPaths.has(relative));
  for (const binding of loaded.bindings) {
    for (const evidencePath of binding.evidencePaths) {
      await add(evidencePath);
      const proof = record(json(loaded.captureRoot, evidencePath), 'native connection proof');
      for (const raw of array(proof.references, 'native connection references')) {
        const reference = record(raw, 'native connection reference');
        readReference(loaded.captureRoot, reference as unknown as EvidenceReference);
        if (reference.redacted !== true) await add(reference.path as string);
      }
    }
  }
  const prefix = `evidence/${loaded.binding.captureRunId}`;
  stageFence(options.lifecycle, 'write-staged-evidence:before');
  const directory = assertArtifactPath(outputRoot, prefix);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await privateRoot(path.dirname(directory));
  for (const [relative, file] of files) {
    stageFence(options.lifecycle, `write-staged-file:${relative}:before`);
    const destination = assertArtifactPath(outputRoot, `${prefix}/${relative}`);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (Buffer.isBuffer(file)) {
      await writeFile(destination, file, { flag: 'wx', mode: 0o600 });
      assert.equal(sha256(await readFile(destination)), sha256(file));
    } else {
      await copyNativeCommandLog(
        file,
        destination,
        outputRoot,
        path.relative(outputRoot, destination),
      );
    }
    stageFence(options.lifecycle, `write-staged-file:${relative}:after`);
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'private native connection evidence copy, not public outcome',
    requestedRunId: loaded.binding.requestedRunId,
    captureRunId: loaded.binding.captureRunId,
    fixtureRunId: loaded.binding.backendRunId,
    nativePassingCases: 0,
    files: [...files].map(([relative, file]) => ({
      path: relative,
      sizeBytes: fileSizeBytes(file),
      sha256: fileSha256(file),
    })),
  };
  const manifestPath = `${prefix}/copy-manifest.private.json`;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(assertArtifactPath(outputRoot, manifestPath), manifestBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  stageFence(options.lifecycle, 'write-staged-manifest:after');
  return {
    copyManifest: { path: manifestPath, sha256: sha256(manifestBytes) },
    assertions: loaded.bindings.map((binding) => ({
      id: binding.id,
      requirementRefs: binding.requirementRefs,
      outcome: 'passed' as const,
      evidencePaths: binding.evidencePaths.map((relative) => `${prefix}/${relative}`),
    })),
    artifacts: [
      manifestPath,
      `${prefix}/${connectionAttemptBindingPath}`,
      `${prefix}/${nativeConnectionJourneyPreparationPath}`,
    ],
    nativePassingCases: 0 as const,
  };
}

export async function stageAndroidConnectionPublicEvidence(options: {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  bindings: NativeConnectionAssertionBinding[];
}) {
  return stageNativeConnectionPublicEvidence({ ...options, platform: 'android' });
}

function stagedProofs(
  outputRoot: string,
  prefix: string,
  bindings: NativeConnectionAssertionBinding[],
): Map<string, boolean> {
  const redacted = new Map<string, boolean>();
  for (const binding of bindings)
    for (const relative of binding.evidencePaths) {
      const proof = record(
        json(path.join(outputRoot, prefix), relative),
        'staged native connection proof',
      );
      assert.equal(proof.nativePassingCases, 0);
      for (const raw of array(proof.references, 'staged native connection references')) {
        const reference = record(raw, 'staged native connection reference');
        requireHash(reference.sha256, 'Staged native connection reference hash');
        const value = reference.redacted === true;
        if (redacted.has(reference.path as string))
          assert.equal(redacted.get(reference.path as string), value);
        redacted.set(reference.path as string, value);
      }
    }
  return redacted;
}

/** Recheck the exclusive staged copy and original hashes without issuing a native action. */
export async function verifyStagedNativeConnectionEvidence(options: {
  repositoryRoot: string;
  selection: NativePilotSelection;
  outputRoot: string;
  copyManifest: { path: string; sha256: string };
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  bindings: NativeConnectionAssertionBinding[];
  captureRoot?: string;
  platform?: NativeConnectionEvidencePlatform;
}): Promise<void> {
  const platform = options.platform ?? 'ios';
  const { selection } = await freshSelection(options.repositoryRoot, options.selection, platform);
  const outputRoot = await privateRoot(options.outputRoot);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  const prefix = `evidence/${options.captureRunId}`;
  assert.equal(options.copyManifest.path, `${prefix}/copy-manifest.private.json`);
  const manifestBytes = readNativeEvidence(outputRoot, options.copyManifest.path, true);
  assert.equal(
    sha256(manifestBytes),
    options.copyManifest.sha256,
    'Staged connection manifest changed',
  );
  const manifest = record(JSON.parse(manifestBytes.toString()), 'staged connection manifest');
  assert.equal(manifest.kind, 'private native connection evidence copy, not public outcome');
  assert.equal(manifest.requestedRunId, options.requestedRunId);
  assert.equal(manifest.captureRunId, options.captureRunId);
  assert.equal(manifest.fixtureRunId, options.fixtureRunId);
  assert.equal(manifest.nativePassingCases, 0);
  const rows = array(manifest.files, 'staged connection files').map((raw) => {
    const row = record(raw, 'staged connection file');
    const filePath = row.path;
    const sizeBytes = row.sizeBytes;
    const hash = row.sha256;
    assert(typeof filePath === 'string' && filePath.length > 0);
    assert(Number.isSafeInteger(sizeBytes) && Number(sizeBytes) > 0);
    requireHash(hash, 'Staged connection file hash');
    return { path: filePath, sizeBytes: Number(sizeBytes), sha256: hash };
  });
  assert.equal(new Set(rows.map((row) => row.path)).size, rows.length);
  const stagedRoot = path.join(outputRoot, prefix);
  const actual = await listFiles(stagedRoot);
  assert.deepEqual(actual, [...rows.map((row) => row.path), 'copy-manifest.private.json'].sort());
  const stagedCapture = json(stagedRoot, 'capture.private.json') as Capture;
  requireCaptureIdentity(stagedCapture, options.captureRunId, options.fixtureRunId, platform);
  await requireBuildMetadata(stagedCapture.build, platform);
  requireCommandDiagnostics(stagedCapture.commandExecutions);
  const stagedCommandArtifacts = commandArtifactPaths(
    stagedCapture,
    stagedRoot,
    commandArtifactSourceRoot(stagedCapture, options.captureRunId),
  );
  for (const relative of stagedCommandArtifacts.paths)
    if (stagedCommandArtifacts.logPaths.has(relative))
      await readNativeCommandLog(stagedRoot, relative);
    else readNativeEvidence(stagedRoot, relative, true);
  const stagedBinding = await readNativeConnectionAttemptBinding({
    repositoryRoot: options.repositoryRoot,
    artifactRoot: stagedRoot,
    requestedRunId: options.requestedRunId,
    backendRunId: options.fixtureRunId,
    selection,
  });
  assert.equal(stagedBinding.captureRunId, options.captureRunId);
  requireCleanupEvidence(
    json(stagedRoot, nativeConnectionCleanupPath),
    options.captureRunId,
    platform,
  );
  const apiIdentity = record(stagedCapture.connectionApiIdentity, 'staged connection API identity');
  requireApiProcessBinding(stagedCapture, apiIdentity, stagedBinding.backendAttemptId);
  const stagedApiOrigin = String(apiIdentity.targetOrigin);
  requireIntegratedLoopbackOrigin(stagedApiOrigin);
  assert.notEqual(stagedApiOrigin, stagedCapture.build.apiOrigin);
  assert.notEqual(stagedApiOrigin, stagedCapture.build.metroOrigin);
  assert(Number.isSafeInteger(apiIdentity.apiPid) && Number(apiIdentity.apiPid) > 1);
  const stagedTransport = requireTransport(
    json(stagedRoot, nativeConnectionTransportPath),
    stagedApiOrigin,
  );
  const stagedAuth = requireAuthIdentities(
    json(stagedRoot, nativeConnectionAuthIdentitiesPath),
    stagedApiOrigin,
    Number(apiIdentity.apiPid),
  );
  assert(stagedAuth.length > 0);
  const redactions = stagedProofs(stagedRoot, '.', options.bindings);
  for (const row of rows) {
    const file = stagedCommandArtifacts.logPaths.has(row.path)
      ? await readNativeCommandLog(stagedRoot, row.path)
      : readNativeEvidence(stagedRoot, row.path, !row.path.endsWith('.png'));
    assert.equal(fileSizeBytes(file), row.sizeBytes);
    assert.equal(fileSha256(file), row.sha256, `Staged connection evidence changed: ${row.path}`);
  }
  for (const [relative, isRedacted] of redactions) {
    const target = assertArtifactPath(stagedRoot, relative);
    if (isRedacted) await assert.rejects(readFile(target));
    else assert(await realpath(target));
  }
  assert(
    options.captureRoot !== undefined,
    'Staged connection verification requires the immutable original fixture provenance root',
  );
  if (options.captureRoot !== undefined) {
    const original = await loadAndValidate({
      repositoryRoot: options.repositoryRoot,
      captureRoot: options.captureRoot,
      requestedRunId: options.requestedRunId,
      fixtureRunId: options.fixtureRunId,
      selection,
      requireProofs: true,
      platform,
    });
    assert.deepEqual(options.bindings, original.bindings);
    assert.deepEqual(
      stagedCapture.connectionJourneyPreparation,
      original.capture.connectionJourneyPreparation,
      'Staged connection controller report differs from original',
    );
    if (platform === 'ios')
      assert.deepEqual(
        stagedCapture.connectionPasswordOfferWitnesses,
        original.capture.connectionPasswordOfferWitnesses,
        'Staged iOS connection password-offer witnesses differ from original',
      );
    for (const row of rows) {
      const originalFile = original.commandArtifacts.logPaths.has(row.path)
        ? await readNativeCommandLog(original.captureRoot, row.path)
        : readNativeEvidence(original.captureRoot, row.path, !row.path.endsWith('.png'));
      assert.equal(
        fileSha256(originalFile),
        row.sha256,
        `Staged connection file differs from original: ${row.path}`,
      );
    }
    // A redacted invite/credential frame may be hash-bound, but it is never copied.
    for (const label of redactedNativeConnectionFrameLabels)
      for (const suffix of ['png', 'hierarchy.json'] as const) {
        const relative = framePath(label, suffix);
        if (redactions.has(relative)) {
          assert.equal(redactions.get(relative), true);
          assert(await realpath(path.join(original.captureRoot, relative)));
        }
      }
    assert.equal(stagedTransport.length, original.transport.length);
    assert.equal(stagedAuth.length, original.authIdentities.length);
  }
}

export async function verifyStagedAndroidConnectionEvidence(options: {
  repositoryRoot: string;
  selection: NativePilotSelection;
  outputRoot: string;
  copyManifest: { path: string; sha256: string };
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  bindings: NativeConnectionAssertionBinding[];
  captureRoot?: string;
}): Promise<void> {
  return verifyStagedNativeConnectionEvidence({ ...options, platform: 'android' });
}

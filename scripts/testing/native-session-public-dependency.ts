import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sourceIdentity, type NativeSourceIdentity } from './native-build-identity';
import {
  requireNativeConnectionHelperInputs,
  type NativeConnectionHelperInput,
} from './native-connection-public-evidence-core';
import {
  requireConnectionSnapshot,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotSelection,
} from './native-pilot-contract';
import { nativeSessionHelperInputPaths } from './native-session-helper-ledger';
import {
  nativeSessionProfileCheckpointIds,
  requireFinalSessionTransport,
  requireSignedOutSessionTransport,
  verifyNativeSessionProfileCheckpoints,
} from './native-session-profile-checkpoints';
import {
  readNativeEvidence,
  validateNativeRuntimeFrameFiles,
  type ViewEvidence,
} from './native-view-evidence';
import { assertTestingDocument } from './schema-validation';
import type { SessionPostTapDiagnosticResult } from './ios-session-post-tap-diagnostic';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

/**
 * Private dependency validator for the v7 iOS session capture. This module is
 * intentionally unable to return a public/native pass. It consumes already
 * stopped, owner-checked bytes and preserves a harness-blocked capture as
 * blocked when any publication or provenance field is absent.
 */

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const signInPathHash = sha256('/auth/email/sign-in');
const hydratePathHash = sha256('/me/hydrate');
const sessionScope = 'native-entry-ios';
const loopbackOrigin = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/;
const defaultLoaderDeadlineMs = 60_000;
const maxLoaderDeadlineMs = 300_000;

type LoaderGuard = () => void;

type CurrentSourceAndHelpers = {
  source: NativeSourceIdentity;
  helpers: NativeConnectionHelperInput[];
};

class LoaderStoppedError extends Error {
  constructor(reason: 'aborted' | 'deadline') {
    super(`iOS session public dependency loader ${reason}`);
    this.name = 'LoaderStoppedError';
  }
}

function monotonicNowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function loaderGuard(signal: AbortSignal | undefined, deadlineMs: number | undefined): LoaderGuard {
  const duration = deadlineMs ?? defaultLoaderDeadlineMs;
  assert(
    Number.isFinite(duration) &&
      Number.isSafeInteger(duration) &&
      duration > 0 &&
      duration <= maxLoaderDeadlineMs,
    `loader deadline must be an integer in (0, ${maxLoaderDeadlineMs}] ms`,
  );
  const deadline = monotonicNowMs() + duration;
  return () => {
    if (signal?.aborted) throw new LoaderStoppedError('aborted');
    if (monotonicNowMs() >= deadline) throw new LoaderStoppedError('deadline');
  };
}

const requiredSessionHelperPaths = nativeSessionHelperInputPaths;

const requiredUiLabels = Object.freeze([
  'entry',
  'password-save-prompt',
  'coach-home',
  'restored-home',
  'account',
  'restored-identity',
  'signout-confirm',
  'cancel-signout',
  'signout-reopen',
  'signout-confirmed',
  'signed-out-relaunch',
] as const);

const requiredUiPaths = Object.freeze([
  'entry-hierarchy.json',
  'password-save-prompt-hierarchy.json',
  'coach-home-hierarchy.json',
  'restored-home-hierarchy.json',
  'account-hierarchy.json',
  'restored-identity-hierarchy.json',
  'signout-confirm-hierarchy.json',
  'cancel-signout-hierarchy.json',
  'signout-reopen-hierarchy.json',
  'signout-confirmed-hierarchy.json',
  'signed-out-relaunch-hierarchy.json',
] as const);

const requiredUiViews = Object.freeze([
  'SCR-sign-in',
  'STATE-password-save',
  'SCR-pro-home',
  'SCR-pro-home',
  'SCR-account',
  'SCR-account',
  'STATE-signout-confirm',
  'SCR-account',
  'STATE-signout-confirm',
  'SCR-sign-in',
  'SCR-sign-in',
] as const);

type Checkpoint = (typeof nativeSessionProfileCheckpointIds)[number];
type SessionWindow = { afterRequestId: number; throughRequestId: number };
type OrdinalRange = {
  startOrdinal: number;
  endOrdinalExclusive: number;
  firstRequestId: number | null;
  lastRequestId: number | null;
};

export type SessionEvidenceReceiptCandidate = {
  path: string;
  sha256: string;
  bytes: number;
  runId: string;
  scope: string;
  ownedRunId: string;
  fixtureScope: string;
  artifactRoot: string;
  apiPid: number;
  targetOrigin: string;
  fixtureAuthUidAllowlistHash: string;
};

export type SessionFrameCandidate = ViewEvidence & {
  label?: string;
  notVisibleSelectors?: readonly string[];
};

export type SessionCaptureCandidate = {
  kind: 'private-native-inventory-observation-not-behavior-attempt';
  mode: 'inventory';
  platform: 'ios';
  charter: 'session';
  result: 'observed';
  cleanup: 'cleaned';
  nativePassingCases: 0;
  captureRunId: string;
  source: Record<string, unknown>;
  sourceAfter: Record<string, unknown>;
  helperInputsBefore: unknown;
  helperInputsAfter: unknown;
  build: Record<string, unknown>;
  device: Record<string, unknown>;
  observations: readonly SessionFrameCandidate[];
  sessionViewEvidence: readonly SessionFrameCandidate[];
  sessionUiObservationOrder: readonly string[];
  sessionAssertionSequence: readonly string[];
  sessionSignOutPostTapDiagnostic?: SessionPostTapDiagnosticResult;
  sessionInitialAuth: {
    actor: 'coach';
    actorAuthUid: string;
    apiPid: number;
    targetOrigin: string;
    authRequestId: number;
    afterRequestId: number;
  };
  nativeAuthIdentityEvidence: SessionEvidenceReceiptCandidate;
  sessionProfileSnapshots: Record<Checkpoint, SessionEvidenceReceiptCandidate>;
  sessionDomainSnapshots: Record<Checkpoint, SessionEvidenceReceiptCandidate>;
  sessionProfileLoginWindow: SessionWindow;
  sessionProfileRestorationWindow: SessionWindow;
  persistedCoachIdentity: {
    afterLoginAuthUidHash: string;
    afterRestorationAuthUidHash: string;
  };
  relaunchTransport: readonly ProxyObservation[];
  relaunchTransportRange: OrdinalRange;
  signedOutRelaunchTransport: readonly ProxyObservation[];
  signedOutRelaunchTransportRange: SessionWindow;
  transportEvidence: SessionEvidenceReceiptCandidate;
  sessionTerminalTransportDiagnostics: Record<
    string,
    { path: string; bytes: number; sha256: string }
  >;
  sessionSqlBefore: SessionEvidenceReceiptCandidate;
  sessionSqlAfterSignedoutRelaunch: SessionEvidenceReceiptCandidate;
  sessionSqlBeforeAfterUnchanged: true;
  sessionEvidencePublication: 'complete';
  authMetadataBeforeRelaunch: Record<string, unknown>;
  authMetadataAfterRelaunch: Record<string, unknown>;
  authMetadataAfterCancel: Record<string, unknown>;
  authMetadataAfterSignout: Record<string, unknown>;
  authMetadataAfterSignedoutRelaunch: Record<string, unknown>;
  cancelSignoutCheckpoint: {
    observationLabel: 'cancel-signout';
    hierarchyPath: 'cancel-signout-hierarchy.json';
    sessionPresent: true;
  };
  nativeLogoutContract: {
    requirementRefs: readonly string[];
    scope: 'local-native-session-clear';
    serverRevocationQualified: false;
  };
};

export type SessionCleanupCandidate = {
  kind?: string;
  result: 'passed';
  runId: string;
  captureResult: 'observed';
  captureCleanupClean: true;
  survivors: readonly unknown[];
  unknownProcessQueries: readonly unknown[];
  missingForeignDevices: readonly unknown[];
  ownedDeviceAbsent: true;
  cacheAbsent: true;
};

export type NativeSessionPublicDependencyInput = {
  selection: NativePilotSelection;
  capture: SessionCaptureCandidate;
  evidenceRoot: string;
  cleanup: SessionCleanupCandidate;
  fixtureAuthUids: readonly string[];
  coachAuthUid: string;
  studentAuthUid: string;
  backendRunId: string;
  backendArtifactRoot: string;
  apiIdentity: { apiPid: number; targetOrigin: string };
  profiles: Record<Checkpoint, OwnedConnectionSnapshot>;
  domain: Record<Checkpoint, OwnedDomainSnapshot>;
  sessionSqlBefore: OwnedDomainSnapshot;
  sessionSqlAfterSignedoutRelaunch: OwnedDomainSnapshot;
  transportObservations: readonly ProxyObservation[];
  terminalTransportBytes: Buffer;
  nativeAuthIdentities: readonly NativeAuthIdentityObservation[];
  nativeAuthTerminalBytes: Buffer;
};

export type NativeSessionPublicDependencyResult = {
  kind: 'private-ios-session-public-dependency-not-public-receipt';
  status: 'validated-source-only';
  charter: 'session';
  assertionIds: readonly string[];
  captureRunId: string;
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  serverRevocationQualified: false;
  cleanup: 'cleaned';
  files: {
    framePaths: readonly string[];
    startupDiagnosticFramePath: 'launched.png';
    profilePaths: readonly string[];
    domainPaths: readonly string[];
    transportPath: string;
    terminalTransportPath: string;
    postTapDiagnosticPaths?: readonly string[];
  };
  verification: {
    profileCheckpointStatus: 'verified';
    signInRequestId: number;
    restorationHydrateRequestId: number;
    signedOutRequestCount: number;
    coachAuthUidHash: string;
  };
};

type BlockedLoad = {
  kind: 'private-ios-session-public-dependency-loader';
  status: 'blocked' | 'incomplete' | 'selection-blocked';
  captureRoot: string;
  captureRunId: string | null;
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  missing: readonly string[];
  files: readonly { path: string; bytes: number; sha256: string }[];
};

export type NativeSessionPublicDependencyLoad =
  BlockedLoad | (NativeSessionPublicDependencyResult & { selection: NativePilotSelection });

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (value.length === 0) throw new Error(`${label} is empty`);
  assert.equal(value.trim(), value, `${label} has surrounding whitespace`);
  return value;
}

function requireLoopback(value: unknown, label: string): string {
  const origin = nonemptyString(value, label);
  assert.match(origin, loopbackOrigin, `${label} is not loopback`);
  return origin;
}

function fixtureAllowlistHash(fixtureAuthUids: readonly string[]): string {
  const sorted = [...fixtureAuthUids].sort();
  assert.ok(sorted.length >= 2, 'Fixture actor allowlist is too small');
  assert.equal(new Set(sorted).size, sorted.length, 'Fixture actor allowlist is duplicated');
  assert.ok(sorted.every((value) => typeof value === 'string' && value.length > 0));
  return sha256(JSON.stringify(sorted));
}

function requireFileReceipt(
  root: string,
  receipt: SessionEvidenceReceiptCandidate,
  expected: {
    label: string;
    runId: string;
    scope: string;
    artifactRoot: string;
    apiPid: number;
    targetOrigin: string;
    allowlistHash: string;
  },
): Buffer {
  requireReceiptMetadata(receipt, expected);
  const bytes = readNativeEvidence(root, receipt.path, true);
  assert.equal(receipt.bytes, bytes.length, `${expected.label} byte count changed`);
  assert.equal(receipt.sha256, sha256(bytes), `${expected.label} hash does not match bytes`);
  return bytes;
}

function requireReceiptMetadata(
  receipt: SessionEvidenceReceiptCandidate,
  expected: {
    label: string;
    runId: string;
    scope: string;
    artifactRoot: string;
    apiPid: number;
    targetOrigin: string;
    allowlistHash: string;
  },
) {
  assert.equal(
    receipt.path,
    path.basename(receipt.path),
    `${expected.label} path is not a basename`,
  );
  assert.equal(receipt.runId, expected.runId, `${expected.label} run identity changed`);
  assert.equal(receipt.ownedRunId, expected.runId, `${expected.label} owned run changed`);
  assert.equal(receipt.scope, expected.scope, `${expected.label} scope changed`);
  assert.equal(receipt.fixtureScope, expected.scope, `${expected.label} fixture scope changed`);
  assert.equal(
    receipt.artifactRoot,
    expected.artifactRoot,
    `${expected.label} artifact root changed`,
  );
  assert.equal(receipt.apiPid, expected.apiPid, `${expected.label} API PID changed`);
  assert.equal(receipt.targetOrigin, expected.targetOrigin, `${expected.label} API origin changed`);
  assert.equal(
    receipt.fixtureAuthUidAllowlistHash,
    expected.allowlistHash,
    `${expected.label} fixture allowlist changed`,
  );
  assert.ok(Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
}

function requireTerminalReceipt(
  root: string,
  receipt: { path: string; bytes: number; sha256: string },
  label: string,
) {
  assert.equal(receipt.path, path.basename(receipt.path), `${label} path is not a basename`);
  assert.ok(Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  const bytes = readNativeEvidence(root, receipt.path, true);
  assert.equal(receipt.bytes, bytes.length, `${label} byte count changed`);
  assert.equal(receipt.sha256, sha256(bytes), `${label} hash does not match bytes`);
  return bytes;
}

function requireSourceAndHelperIdentity(
  capture: Pick<
    SessionCaptureCandidate,
    'source' | 'sourceAfter' | 'helperInputsBefore' | 'helperInputsAfter'
  >,
  current?: CurrentSourceAndHelpers,
) {
  const source = objectRecord(capture.source, 'capture.source');
  const sourceAfter = objectRecord(capture.sourceAfter, 'capture.sourceAfter');
  assert.match(
    nonemptyString(source.sourceTreeHash, 'capture.source.sourceTreeHash'),
    /^[a-f0-9]{64}$/,
  );
  assert.deepEqual(sourceAfter, source, 'Source identity changed during capture');
  assert.deepEqual(
    capture.helperInputsAfter,
    capture.helperInputsBefore,
    'Helper inputs changed during capture',
  );
  if (current) {
    assert.deepEqual(source, current.source, 'Capture source identity is stale');
    assert.deepEqual(sourceAfter, current.source, 'Capture source-after identity is stale');
    assert.deepEqual(
      capture.helperInputsBefore,
      current.helpers,
      'Capture helper identity is stale',
    );
    assert.deepEqual(
      capture.helperInputsAfter,
      current.helpers,
      'Capture helper-after identity is stale',
    );
  }
}

function requireSourceBuildIdentity(
  capture: SessionCaptureCandidate,
  current?: CurrentSourceAndHelpers,
) {
  requireSourceAndHelperIdentity(capture, current);
  const build = objectRecord(capture.build, 'capture.build');
  assert.match(nonemptyString(build.binaryHash, 'capture.build.binaryHash'), /^[a-f0-9]{64}$/);
  nonemptyString(build.bundleId, 'capture.build.bundleId');
  requireLoopback(build.apiOrigin, 'capture.build.apiOrigin');
  const device = objectRecord(capture.device, 'capture.device');
  nonemptyString(device.udid, 'capture.device.udid');
  nonemptyString(device.runtime, 'capture.device.runtime');
}

function requireCaptureIdentity(capture: SessionCaptureCandidate) {
  assert.equal(capture.kind, 'private-native-inventory-observation-not-behavior-attempt');
  assert.equal(capture.mode, 'inventory');
  assert.equal(capture.platform, 'ios');
  assert.equal(capture.charter, 'session');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  assert.match(capture.captureRunId, /^[a-f0-9]{24}$/);
  requireSourceBuildIdentity(capture);
  assert.equal(capture.sessionEvidencePublication, 'complete');
}

function requireCleanupEvidence(cleanup: SessionCleanupCandidate, runId: string) {
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.runId, runId);
  assert.equal(cleanup.captureResult, 'observed');
  assert.equal(cleanup.captureCleanupClean, true);
  assert.deepEqual(cleanup.survivors, []);
  assert.deepEqual(cleanup.unknownProcessQueries, []);
  assert.deepEqual(cleanup.missingForeignDevices, []);
  assert.equal(cleanup.ownedDeviceAbsent, true);
  assert.equal(cleanup.cacheAbsent, true);
}

function hierarchyHasResourceId(value: unknown, resourceId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const node = value as {
    attributes?: Record<string, unknown>;
    children?: unknown[];
  };
  return (
    node.attributes?.['resource-id'] === resourceId ||
    (Array.isArray(node.children) &&
      node.children.some((child) => hierarchyHasResourceId(child, resourceId)))
  );
}

function requireSessionPostTapDiagnostic(
  root: string,
  capture: Pick<SessionCaptureCandidate, 'sessionSignOutPostTapDiagnostic'>,
): readonly string[] {
  const diagnostic = objectRecord(
    capture.sessionSignOutPostTapDiagnostic,
    'capture.sessionSignOutPostTapDiagnostic',
  ) as unknown as SessionPostTapDiagnosticResult;
  assert.equal(diagnostic.label, 'session-signout-post-tap');
  const paths = [diagnostic.flowPath, diagnostic.hierarchyPath, diagnostic.screenshotPath];
  assert.equal(new Set(paths).size, paths.length, 'Session post-tap diagnostic paths overlap');
  for (const [index, value] of paths.entries()) {
    assert.equal(typeof value, 'string', `Session post-tap path ${index} is invalid`);
    assert.equal(value, path.basename(value), `Session post-tap path ${index} is not a basename`);
    assert(!value.includes('..'), `Session post-tap path ${index} escapes its root`);
  }
  const flow = readNativeEvidence(root, diagnostic.flowPath, true);
  const hierarchyBytes = readNativeEvidence(root, diagnostic.hierarchyPath, true);
  const screenshot = readNativeEvidence(root, diagnostic.screenshotPath, false);
  assert.equal(flow.length, diagnostic.flowBytes, 'Session post-tap flow byte count changed');
  assert.equal(
    sha256(flow),
    diagnostic.flowHash,
    'Session post-tap flow hash does not match bytes',
  );
  assert.equal(
    hierarchyBytes.length,
    diagnostic.hierarchyBytes,
    'Session post-tap hierarchy byte count changed',
  );
  assert.equal(
    sha256(hierarchyBytes),
    diagnostic.hierarchyHash,
    'Session post-tap hierarchy hash does not match bytes',
  );
  assert.equal(
    screenshot.length,
    diagnostic.screenshotBytes,
    'Session post-tap screenshot byte count changed',
  );
  assert.equal(
    sha256(screenshot),
    diagnostic.screenshotHash,
    'Session post-tap screenshot hash does not match bytes',
  );
  assert.equal(
    screenshot.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    'Session post-tap screenshot is not a PNG',
  );
  const hierarchy = JSON.parse(hierarchyBytes.toString('utf8')) as unknown;
  assert(
    hierarchy && typeof hierarchy === 'object' && !Array.isArray(hierarchy),
    'Session post-tap hierarchy is not a structured object',
  );
  const selectorPresence = objectRecord(
    diagnostic.selectorPresence,
    'Session post-tap selector presence',
  );
  const selectorFields = {
    accountScreen: 'settings.account.screen',
    signOutCta: 'settings.account.signOutCta',
    signOutConfirm: 'settings.account.signOutConfirm',
    signOutConfirmCta: 'settings.account.signOutConfirmCta',
  } as const;
  for (const [field, selector] of Object.entries(selectorFields)) {
    assert.equal(
      typeof selectorPresence[field],
      'boolean',
      `Session post-tap selector ${field} is not a boolean observation`,
    );
    assert.equal(
      selectorPresence[field],
      hierarchyHasResourceId(hierarchy, selector),
      `Session post-tap selector ${field} does not match the retained hierarchy`,
    );
  }
  return paths;
}

function requireUiEvidence(root: string, capture: SessionCaptureCandidate): string[] {
  assert.deepEqual(capture.sessionUiObservationOrder, requiredUiLabels);
  assert.deepEqual(
    capture.observations,
    capture.sessionViewEvidence,
    'Published UI evidence differs from observations',
  );
  assert.equal(capture.sessionViewEvidence.length, requiredUiPaths.length);
  for (const [index, requiredPath] of requiredUiPaths.entries()) {
    const row = capture.sessionViewEvidence[index];
    assert(row, `Missing UI evidence at ${requiredPath}`);
    assert.equal(row.hierarchyPath, requiredPath, `UI evidence ordinal changed at ${requiredPath}`);
    assert.equal(row.viewId, requiredUiViews[index], `UI selector view changed at ${requiredPath}`);
    assert.equal(row.screenshotPath, requiredPath.replace('-hierarchy.json', '.png'));
    assert.equal(row.reviewed, false, `UI evidence ${requiredPath} claimed visual review`);
    validateNativeRuntimeFrameFiles(root, [row], [row.viewId]);
    if (requiredPath === 'cancel-signout-hierarchy.json') {
      assert.deepEqual(row.notVisibleSelectors, ['settings.account.signOutConfirm']);
      const hierarchy = JSON.parse(
        readNativeEvidence(root, row.hierarchyPath, true).toString('utf8'),
      ) as unknown;
      assert.equal(hierarchyHasResourceId(hierarchy, 'settings.account.signOutConfirm'), false);
    } else assert.deepEqual(row.notVisibleSelectors ?? [], []);
  }
  const launched = readNativeEvidence(root, 'launched.png', true);
  assert.ok(
    launched.length > 8 &&
      launched.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary')),
  );
  return capture.sessionViewEvidence.map((row) => row.hierarchyPath);
}

function requireTransportSlice(
  all: readonly ProxyObservation[],
  slice: readonly ProxyObservation[],
  range: OrdinalRange,
  label: string,
) {
  assert.ok(Number.isSafeInteger(range.startOrdinal) && range.startOrdinal >= 0);
  assert.ok(
    Number.isSafeInteger(range.endOrdinalExclusive) &&
      range.endOrdinalExclusive >= range.startOrdinal,
  );
  assert.ok(range.endOrdinalExclusive <= all.length);
  assert.deepEqual(
    all.slice(range.startOrdinal, range.endOrdinalExclusive),
    slice,
    `${label} is not linked to stopped stream`,
  );
  assert.equal(range.endOrdinalExclusive - range.startOrdinal, slice.length);
  assert.equal(range.firstRequestId, slice[0]?.requestId ?? null);
  assert.equal(range.lastRequestId, slice[slice.length - 1]?.requestId ?? null);
}

function requireNativeRows(rows: readonly ProxyObservation[], targetOrigin: string, label: string) {
  const ids = new Set<number>();
  for (const [index, row] of rows.entries()) {
    assert.equal(row.requestProfile, 'native', `${label}[${index}] request profile changed`);
    assert.equal(row.requestOrigin, null, `${label}[${index}] request origin changed`);
    assert.equal(row.outcome, 'forwarded', `${label}[${index}] request was not forwarded`);
    assert.equal(row.faultAttemptId, null, `${label}[${index}] fault was armed`);
    assert.equal(row.targetOrigin, targetOrigin, `${label}[${index}] target origin changed`);
    assert.ok(Number.isSafeInteger(row.requestId) && row.requestId > 0);
    assert.equal(ids.has(row.requestId), false, `${label} request IDs are duplicated`);
    ids.add(row.requestId);
  }
}

function requireMetadata(
  metadata: Record<string, unknown>,
  expectedPresent: boolean,
  label: string,
) {
  assert.equal(metadata.sessionPresent, expectedPresent, `${label} session presence changed`);
  if (expectedPresent) {
    assert.equal(metadata.status, 'session-present', `${label} status changed`);
    assert.equal(metadata.profilePresent, true, `${label} profile metadata absent`);
    assert.equal(metadata.expiryPresent, true, `${label} expiry metadata absent`);
    assert.equal(metadata.plaintextAccessTokenPresent, false, `${label} access token exposed`);
    assert.equal(metadata.plaintextRefreshTokenPresent, false, `${label} refresh token exposed`);
  } else {
    assert.equal(metadata.status, 'session-absent', `${label} status changed`);
    assert.notEqual(metadata.profilePresent, true, `${label} profile metadata exposed`);
    assert.notEqual(metadata.expiryPresent, true, `${label} expiry metadata exposed`);
    assert.notEqual(metadata.plaintextAccessTokenPresent, true, `${label} access token exposed`);
    assert.notEqual(metadata.plaintextRefreshTokenPresent, true, `${label} refresh token exposed`);
  }
}

function requireSessionLedger(capture: SessionCaptureCandidate) {
  assert.deepEqual(capture.sessionAssertionSequence, nativeSessionAssertionIds);
  assert.equal(capture.sessionSqlBeforeAfterUnchanged, true);
  assert.deepEqual(capture.cancelSignoutCheckpoint, {
    observationLabel: 'cancel-signout',
    hierarchyPath: 'cancel-signout-hierarchy.json',
    sessionPresent: true,
  });
  assert.deepEqual(capture.nativeLogoutContract.requirementRefs, ['FR-270', 'BR-342']);
  assert.equal(capture.nativeLogoutContract.scope, 'local-native-session-clear');
  assert.equal(capture.nativeLogoutContract.serverRevocationQualified, false);
  requireMetadata(capture.authMetadataBeforeRelaunch, true, 'before relaunch');
  requireMetadata(capture.authMetadataAfterRelaunch, true, 'after restoration');
  requireMetadata(capture.authMetadataAfterCancel, true, 'after cancel');
  requireMetadata(capture.authMetadataAfterSignout, false, 'after signout');
  requireMetadata(capture.authMetadataAfterSignedoutRelaunch, false, 'after signed-out relaunch');
}

function requireSelection(selection: NativePilotSelection) {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-session-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.flowId, 'FLW-session');
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    nativeSessionAssertionIds,
  );
}

function requireTerminalTransport(
  input: NativeSessionPublicDependencyInput,
  allowlistHash: string,
) {
  const terminalTransportReceipt =
    input.capture.sessionTerminalTransportDiagnostics['transport-terminal.private.json'];
  const terminalAuthReceipt =
    input.capture.sessionTerminalTransportDiagnostics['native-auth-terminal.private.json'];
  assert(terminalTransportReceipt, 'Stopped transport diagnostic receipt is missing');
  assert(terminalAuthReceipt, 'Stopped auth diagnostic receipt is missing');
  assert.equal(terminalTransportReceipt.bytes, input.terminalTransportBytes.length);
  assert.equal(terminalTransportReceipt.sha256, sha256(input.terminalTransportBytes));
  assert.equal(terminalAuthReceipt.bytes, input.nativeAuthTerminalBytes.length);
  assert.equal(terminalAuthReceipt.sha256, sha256(input.nativeAuthTerminalBytes));
  assert.equal(input.capture.transportEvidence.bytes, input.terminalTransportBytes.length);
  assert.equal(input.capture.transportEvidence.sha256, sha256(input.terminalTransportBytes));
  assert.equal(
    input.capture.nativeAuthIdentityEvidence.bytes,
    input.nativeAuthTerminalBytes.length,
  );
  assert.equal(
    input.capture.nativeAuthIdentityEvidence.sha256,
    sha256(input.nativeAuthTerminalBytes),
  );
  requireNativeRows(
    input.transportObservations,
    input.apiIdentity.targetOrigin,
    'stopped transport',
  );
  requireFinalSessionTransport(
    input.terminalTransportBytes,
    input.capture.transportEvidence,
    input.transportObservations,
  );
  requireFinalSessionTransport(
    input.nativeAuthTerminalBytes,
    input.capture.nativeAuthIdentityEvidence,
    input.nativeAuthIdentities,
  );
  assert.deepEqual(
    JSON.parse(input.terminalTransportBytes.toString()),
    input.transportObservations,
  );
  assert.deepEqual(
    JSON.parse(input.nativeAuthTerminalBytes.toString()),
    input.nativeAuthIdentities,
  );
  requireTransportSlice(
    input.transportObservations,
    input.capture.relaunchTransport,
    input.capture.relaunchTransportRange,
    'restoration transport',
  );
  assert.deepEqual(
    input.capture.signedOutRelaunchTransport,
    requireSignedOutSessionTransport({
      observations: input.transportObservations,
      window: input.capture.signedOutRelaunchTransportRange,
      expectedTargetOrigin: input.apiIdentity.targetOrigin,
    }),
    'signed-out transport range is not linked to stopped stream',
  );
  const signIns = input.transportObservations.filter((row) => row.pathHash === signInPathHash);
  assert.equal(signIns.length, 1, 'Native sign-in route must be observed exactly once');
  assert.equal(signIns[0].status, 201);
  assert.equal(signIns[0].requestId, input.capture.sessionInitialAuth.authRequestId);
  const hydrates = input.capture.relaunchTransport.filter(
    (row) => row.pathHash === hydratePathHash && row.status === 200,
  );
  assert.equal(hydrates.length, 1, 'Restoration hydrate must be observed exactly once');
  assert.equal(
    input.capture.relaunchTransport.some((row) => row.pathHash === signInPathHash),
    false,
  );
  assert.equal(
    input.capture.sessionInitialAuth.afterRequestId,
    input.capture.sessionProfileLoginWindow.throughRequestId,
  );
  assert.equal(
    input.capture.signedOutRelaunchTransportRange.throughRequestId,
    input.transportObservations.length,
  );
  assert.equal(allowlistHash, input.capture.nativeAuthIdentityEvidence.fixtureAuthUidAllowlistHash);
  return {
    signInRequestId: signIns[0].requestId,
    restorationHydrateRequestId: hydrates[0].requestId,
  };
}

function requireAuthIdentityEvidence(
  input: NativeSessionPublicDependencyInput,
  allowlistHash: string,
) {
  assert.deepEqual(
    JSON.parse(input.nativeAuthTerminalBytes.toString()),
    input.nativeAuthIdentities,
  );
  assert.equal(input.nativeAuthIdentities.length, 1, 'Native auth identity must be unique');
  const identity = input.nativeAuthIdentities[0];
  assert.equal(identity.requestId, input.capture.sessionInitialAuth.authRequestId);
  assert.equal(identity.status, 201);
  assert.equal(identity.verification, 'verified');
  assert.equal(identity.verificationReason, 'verified');
  assert.equal(identity.authUid, input.coachAuthUid);
  assert.equal(identity.apiPid, input.apiIdentity.apiPid);
  assert.equal(identity.targetOrigin, input.apiIdentity.targetOrigin);
  assert.equal(identity.fixtureAuthUidAllowlistHash, allowlistHash);
  assert.equal(input.capture.sessionInitialAuth.actor, 'coach');
  assert.equal(input.capture.sessionInitialAuth.actorAuthUid, input.coachAuthUid);
  assert.ok(
    Number.isSafeInteger(input.capture.sessionInitialAuth.authRequestId) &&
      input.capture.sessionInitialAuth.authRequestId > 0,
  );
  assert.ok(
    Number.isSafeInteger(input.capture.sessionInitialAuth.afterRequestId) &&
      input.capture.sessionInitialAuth.afterRequestId >=
        input.capture.sessionInitialAuth.authRequestId,
  );
  assert.equal(input.capture.sessionInitialAuth.apiPid, input.apiIdentity.apiPid);
  assert.equal(input.capture.sessionInitialAuth.targetOrigin, input.apiIdentity.targetOrigin);
}

/**
 * Validates a complete stopped private session ledger. The result remains
 * source-only with zero native/public passing cases by design.
 */
export function validateNativeSessionPublicDependency(
  input: NativeSessionPublicDependencyInput,
): NativeSessionPublicDependencyResult {
  requireSelection(input.selection);
  requireCaptureIdentity(input.capture);
  requireCleanupEvidence(input.cleanup, input.capture.captureRunId);
  assert.match(input.backendRunId, /^[a-f0-9]{24}$/);
  assert.match(input.backendArtifactRoot, /^\//);
  assert.equal(input.apiIdentity.apiPid, input.capture.sessionInitialAuth.apiPid);
  requireLoopback(input.apiIdentity.targetOrigin, 'API target origin');
  const allowlistHash = fixtureAllowlistHash(input.fixtureAuthUids);
  const receiptExpected = {
    runId: input.backendRunId,
    scope: sessionScope,
    artifactRoot: input.backendArtifactRoot,
    apiPid: input.apiIdentity.apiPid,
    targetOrigin: input.apiIdentity.targetOrigin,
    allowlistHash,
  };
  for (const checkpoint of nativeSessionProfileCheckpointIds) {
    requireReceiptMetadata(input.capture.sessionProfileSnapshots[checkpoint], {
      ...receiptExpected,
      label: `profile ${checkpoint}`,
    });
    requireReceiptMetadata(input.capture.sessionDomainSnapshots[checkpoint], {
      ...receiptExpected,
      label: `domain ${checkpoint}`,
    });
  }
  requireReceiptMetadata(input.capture.nativeAuthIdentityEvidence, {
    ...receiptExpected,
    label: 'native auth identity',
  });
  requireReceiptMetadata(input.capture.transportEvidence, {
    ...receiptExpected,
    label: 'stopped transport',
  });
  requireReceiptMetadata(input.capture.sessionSqlBefore, {
    ...receiptExpected,
    label: 'SQL before',
  });
  requireReceiptMetadata(input.capture.sessionSqlAfterSignedoutRelaunch, {
    ...receiptExpected,
    label: 'SQL after signed-out relaunch',
  });
  requireSessionLedger(input.capture);
  const coachAuthUidHash = sha256(input.coachAuthUid);
  for (const [label, metadata] of [
    ['before relaunch', input.capture.authMetadataBeforeRelaunch],
    ['after restoration', input.capture.authMetadataAfterRelaunch],
    ['after cancel', input.capture.authMetadataAfterCancel],
  ] as const)
    assert.equal(
      metadata.profileAuthUidHash,
      coachAuthUidHash,
      `${label} actor cache hash changed`,
    );
  const framePaths = requireUiEvidence(input.evidenceRoot, input.capture);
  const profileCheckpoint = verifyNativeSessionProfileCheckpoints({
    platform: 'ios',
    backendRunId: input.backendRunId,
    fixtureAuthUids: input.fixtureAuthUids,
    coachAuthUid: input.coachAuthUid,
    studentAuthUid: input.studentAuthUid,
    expectedApiIdentity: input.apiIdentity,
    profiles: input.profiles,
    domain: input.domain,
    observations: input.transportObservations,
    authIdentities: input.nativeAuthIdentities,
    loginWindow: input.capture.sessionProfileLoginWindow,
    restorationWindow: input.capture.sessionProfileRestorationWindow,
    persistedCoachIdentity: input.capture.persistedCoachIdentity,
  });
  requireAuthIdentityEvidence(input, allowlistHash);
  const api = requireTerminalTransport(input, allowlistHash);
  const profilePaths = nativeSessionProfileCheckpointIds.map(
    (checkpoint) => input.capture.sessionProfileSnapshots[checkpoint].path,
  );
  const domainPaths = nativeSessionProfileCheckpointIds.map(
    (checkpoint) => input.capture.sessionDomainSnapshots[checkpoint].path,
  );
  for (const checkpoint of nativeSessionProfileCheckpointIds) {
    assert.equal(input.profiles[checkpoint].runId, input.backendRunId);
    assert.equal(input.domain[checkpoint].runId, input.backendRunId);
  }
  assertTestingDocument('domain-snapshot-v1', input.sessionSqlBefore);
  assertTestingDocument('domain-snapshot-v1', input.sessionSqlAfterSignedoutRelaunch);
  assert.deepEqual(input.sessionSqlBefore, input.domain.beforeLogin);
  assert.deepEqual(input.sessionSqlAfterSignedoutRelaunch, input.domain.afterSignedOutRelaunch);
  const validatedPostTapDiagnosticPaths = input.capture.sessionSignOutPostTapDiagnostic
    ? requireSessionPostTapDiagnostic(input.evidenceRoot, input.capture)
    : [];
  return {
    kind: 'private-ios-session-public-dependency-not-public-receipt',
    status: 'validated-source-only',
    charter: 'session',
    assertionIds: [...nativeSessionAssertionIds],
    captureRunId: input.capture.captureRunId,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    serverRevocationQualified: false,
    cleanup: 'cleaned',
    files: {
      framePaths,
      startupDiagnosticFramePath: 'launched.png',
      profilePaths,
      domainPaths,
      transportPath: input.capture.transportEvidence.path,
      terminalTransportPath:
        input.capture.sessionTerminalTransportDiagnostics['transport-terminal.private.json'].path,
      postTapDiagnosticPaths: validatedPostTapDiagnosticPaths,
    },
    verification: {
      profileCheckpointStatus: profileCheckpoint.status,
      signInRequestId: api.signInRequestId,
      restorationHydrateRequestId: api.restorationHydrateRequestId,
      signedOutRequestCount: input.capture.signedOutRelaunchTransport.length,
      coachAuthUidHash,
    },
  };
}

type LoadedFile = {
  path: string;
  bytes: number;
  sha256: string;
  value: unknown;
};
type JsonRecord = Record<string, unknown>;

async function canonicalRepositoryRoot(value: string): Promise<string> {
  const canonical = await realpath(value);
  const info = await lstat(canonical);
  assert.equal(canonical, path.resolve(value), 'Repository root is not canonical');
  assert(
    info.isDirectory() && !info.isSymbolicLink(),
    'Repository root is not a regular directory',
  );
  assert.equal(info.uid, process.getuid?.(), 'Repository root is not owned');
  return canonical;
}

async function privateRoot(value: string, label: string): Promise<string> {
  const canonical = await realpath(value);
  const info = await lstat(canonical);
  assert.equal(canonical, path.resolve(value), `${label} is not canonical`);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return canonical;
}

async function currentSourceAndHelpers(
  repositoryRoot: string,
  capture: Pick<SessionCaptureCandidate, 'helperInputsBefore'>,
  guard?: LoaderGuard,
): Promise<CurrentSourceAndHelpers> {
  guard?.();
  const currentSource = await sourceIdentity(repositoryRoot);
  guard?.();
  const helpers = requireNativeConnectionHelperInputs(capture.helperInputsBefore, 'ios');
  for (const required of requiredSessionHelperPaths)
    assert(
      helpers.some((helper) => helper.path === required),
      `Session helper identity is absent: ${required}`,
    );
  assert.deepEqual(
    helpers.map((helper) => helper.path),
    [...requiredSessionHelperPaths],
    'Session helper identity does not match the canonical closure',
  );
  const currentHelpers: NativeConnectionHelperInput[] = [];
  for (const helper of helpers) {
    guard?.();
    const target = path.resolve(repositoryRoot, helper.path);
    assert.equal(
      path.relative(repositoryRoot, target).startsWith('..'),
      false,
      `Helper escapes repository root: ${helper.path}`,
    );
    assert.equal(await realpath(target), target, `Session helper is not canonical: ${helper.path}`);
    const info = await lstat(target);
    assert(
      info.isFile() && !info.isSymbolicLink(),
      `Session helper is not a regular file: ${helper.path}`,
    );
    const bytes = await readFile(target);
    assert.equal(sha256(bytes), helper.sha256, `Session helper identity is stale: ${helper.path}`);
    currentHelpers.push({ path: helper.path, sha256: sha256(bytes) });
    guard?.();
  }
  assert.deepEqual(currentHelpers, helpers, 'Session helper identity changed during verification');
  return { source: currentSource, helpers: currentHelpers };
}

/** Resource-free source/helper provenance check used by the loader and focused controls. */
export async function verifyNativeSessionPublicDependencySourceIdentity(
  repositoryRoot: string,
  capture: Pick<
    SessionCaptureCandidate,
    'source' | 'sourceAfter' | 'helperInputsBefore' | 'helperInputsAfter'
  >,
): Promise<void> {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const current = await currentSourceAndHelpers(root, capture);
  requireSourceAndHelperIdentity(capture, current);
}

function readJson(
  root: string,
  relative: string,
  missing: string[],
  guard?: LoaderGuard,
): LoadedFile | null {
  try {
    guard?.();
    const bytes = readNativeEvidence(root, relative, true);
    guard?.();
    return {
      path: relative,
      bytes: bytes.length,
      sha256: sha256(bytes),
      value: JSON.parse(bytes.toString('utf8')),
    };
  } catch (error) {
    if (error instanceof LoaderStoppedError) throw error;
    missing.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function readRawEvidence(
  root: string,
  relative: string,
  missing: string[],
  guard?: LoaderGuard,
  privateRecord = true,
): LoadedFile | null {
  try {
    guard?.();
    const bytes = readNativeEvidence(root, relative, privateRecord);
    guard?.();
    return {
      path: relative,
      bytes: bytes.length,
      sha256: sha256(bytes),
      value: undefined,
    };
  } catch (error) {
    if (error instanceof LoaderStoppedError) throw error;
    missing.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function receiptPath(capture: JsonRecord, key: string, missing: string[]): string | null {
  const value = capture[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    missing.push(`capture.${key}`);
    return null;
  }
  const relative = (value as JsonRecord).path;
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    missing.push(`capture.${key}.path`);
    return null;
  }
  return relative;
}

function diagnosticPaths(capture: JsonRecord, missing: string[]): string[] | null {
  const value = capture.sessionSignOutPostTapDiagnostic;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const record = value as JsonRecord;
  const paths = ['flowPath', 'hierarchyPath', 'screenshotPath'].map((field) => record[field]);
  if (paths.some((value) => typeof value !== 'string' || !value || path.isAbsolute(value))) {
    missing.push('capture.sessionSignOutPostTapDiagnostic.paths');
    return null;
  }
  const normalized = paths as string[];
  if (
    new Set(normalized).size !== normalized.length ||
    normalized.some((value) => value !== path.basename(value) || value.includes('..'))
  ) {
    missing.push('capture.sessionSignOutPostTapDiagnostic.paths are unsafe or duplicated');
    return null;
  }
  return normalized;
}

function checkpointReceipts(
  capture: JsonRecord,
  field: 'sessionProfileSnapshots' | 'sessionDomainSnapshots',
  missing: string[],
) {
  const value = capture[field];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    missing.push(`capture.${field}`);
    return null;
  }
  const record = value as JsonRecord;
  const result = {} as Record<Checkpoint, string>;
  for (const checkpoint of nativeSessionProfileCheckpointIds) {
    const row = record[checkpoint];
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      typeof (row as JsonRecord).path !== 'string'
    ) {
      missing.push(`capture.${field}.${checkpoint}`);
      continue;
    }
    result[checkpoint] = (row as JsonRecord).path as string;
  }
  return Object.keys(result).length === nativeSessionProfileCheckpointIds.length ? result : null;
}

async function currentSelection(
  repositoryRoot: string,
  guard?: LoaderGuard,
): Promise<NativePilotSelection> {
  guard?.();
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  guard?.();
  return selectNativePilotScenario(
    {
      platform: 'ios',
      engine: 'maestro',
      scenario: 'SCN-session-ios',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
}

function blocked(
  status: BlockedLoad['status'],
  captureRoot: string,
  captureRunId: string | null,
  missing: readonly string[],
  files: readonly LoadedFile[],
): BlockedLoad {
  return {
    kind: 'private-ios-session-public-dependency-loader',
    status,
    captureRoot,
    captureRunId,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    missing: [...new Set(missing)],
    files: files.map(({ path: filePath, bytes, sha256: fileHash }) => ({
      path: filePath,
      bytes,
      sha256: fileHash,
    })),
  };
}

/**
 * Reads a current capture only through the owner-checked private reader. The
 * v7 sealed capture is expected to return `blocked`; no missing field is
 * synthesized and no public receipt is staged.
 */
async function loadNativeSessionPublicDependencyInternal(
  options: {
    repositoryRoot: string;
    captureRoot: string;
    cleanupRoot: string;
    cleanupPath: string;
  },
  guard: LoaderGuard,
): Promise<NativeSessionPublicDependencyLoad> {
  guard();
  const repositoryRoot = await canonicalRepositoryRoot(options.repositoryRoot);
  guard();
  const captureRoot = await privateRoot(options.captureRoot, 'Capture root');
  guard();
  const cleanupRoot = await privateRoot(options.cleanupRoot, 'Cleanup evidence root');
  guard();
  const missing: string[] = [];
  const files: LoadedFile[] = [];
  let selection: NativePilotSelection;
  try {
    selection = await currentSelection(repositoryRoot, guard);
  } catch (error) {
    if (error instanceof LoaderStoppedError) throw error;
    return blocked(
      'selection-blocked',
      captureRoot,
      null,
      [error instanceof Error ? error.message : String(error)],
      files,
    );
  }
  const captureFile = readJson(captureRoot, 'capture.private.json', missing, guard);
  if (captureFile) files.push(captureFile);
  const capture = captureFile?.value as JsonRecord | undefined;
  const captureRunId = typeof capture?.captureRunId === 'string' ? capture.captureRunId : null;
  if (!capture) return blocked('incomplete', captureRoot, captureRunId, missing, files);
  if (captureRunId && path.basename(captureRoot) !== captureRunId)
    missing.push('capture.captureRunId does not match the artifact root basename');
  for (const required of [
    'captureRunId',
    'source',
    'sourceAfter',
    'helperInputsBefore',
    'helperInputsAfter',
    'build',
    'device',
    'observations',
    'sessionViewEvidence',
    'sessionUiObservationOrder',
    'sessionAssertionSequence',
    'sessionInitialAuth',
    'persistedCoachIdentity',
    'sessionProfileLoginWindow',
    'sessionProfileRestorationWindow',
    'sessionEvidencePublication',
    'transportEvidence',
    'sessionTerminalTransportDiagnostics',
    'sessionProfileSnapshots',
    'sessionDomainSnapshots',
    'sessionSqlBefore',
    'sessionSqlAfterSignedoutRelaunch',
    'signedOutRelaunchTransport',
    'signedOutRelaunchTransportRange',
  ])
    if (!Object.hasOwn(capture, required)) missing.push(`capture.${required}`);
  if (capture.result !== 'observed') missing.push(`capture.result=${String(capture.result)}`);
  if (capture.cleanup !== 'cleaned') missing.push(`capture.cleanup=${String(capture.cleanup)}`);
  if (capture.sessionEvidencePublication !== 'complete')
    missing.push(
      `capture.sessionEvidencePublication=${String(capture.sessionEvidencePublication)}`,
    );

  const backend = capture.backend;
  const backendRecord =
    backend && typeof backend === 'object' && !Array.isArray(backend)
      ? (backend as JsonRecord)
      : null;
  if (!backendRecord) missing.push('capture.backend');
  const backendRunId =
    backendRecord && typeof backendRecord.runId === 'string' ? backendRecord.runId : null;
  const backendArtifactRoot =
    backendRecord && typeof backendRecord.artifactRoot === 'string'
      ? backendRecord.artifactRoot
      : null;
  if (!backendRunId) missing.push('capture.backend.runId');
  if (!backendArtifactRoot) missing.push('capture.backend.artifactRoot');
  const cleanupFile = readJson(cleanupRoot, options.cleanupPath, missing, guard);
  if (cleanupFile) files.push(cleanupFile);

  const transportPath = receiptPath(capture, 'transportEvidence', missing);
  const authPath = receiptPath(capture, 'nativeAuthIdentityEvidence', missing);
  const beforeSqlPath = receiptPath(capture, 'sessionSqlBefore', missing);
  const afterSqlPath = receiptPath(capture, 'sessionSqlAfterSignedoutRelaunch', missing);
  const profilePaths = checkpointReceipts(capture, 'sessionProfileSnapshots', missing);
  const domainPaths = checkpointReceipts(capture, 'sessionDomainSnapshots', missing);
  const postTapDiagnosticPaths = diagnosticPaths(capture, missing);
  const diagnosticRecord = capture.sessionTerminalTransportDiagnostics;
  const diagnostics =
    diagnosticRecord && typeof diagnosticRecord === 'object' && !Array.isArray(diagnosticRecord)
      ? (diagnosticRecord as JsonRecord)
      : null;
  const terminalTransport = diagnostics?.['transport-terminal.private.json'];
  const terminalAuth = diagnostics?.['native-auth-terminal.private.json'];
  if (!terminalTransport)
    missing.push('capture.sessionTerminalTransportDiagnostics.transport-terminal.private.json');
  if (!terminalAuth)
    missing.push('capture.sessionTerminalTransportDiagnostics.native-auth-terminal.private.json');
  const referenced = [
    transportPath,
    authPath,
    beforeSqlPath,
    afterSqlPath,
    ...(profilePaths ? Object.values(profilePaths) : []),
    ...(domainPaths ? Object.values(domainPaths) : []),
  ];
  for (const relative of referenced) {
    if (!relative) continue;
    const file = readJson(captureRoot, relative, missing, guard);
    if (file) files.push(file);
  }
  const terminalTransportFile =
    terminalTransport && typeof terminalTransport === 'object'
      ? readJson(captureRoot, (terminalTransport as JsonRecord).path as string, missing, guard)
      : null;
  const terminalAuthFile =
    terminalAuth && typeof terminalAuth === 'object'
      ? readJson(captureRoot, (terminalAuth as JsonRecord).path as string, missing, guard)
      : null;
  if (terminalTransportFile) files.push(terminalTransportFile);
  if (terminalAuthFile) files.push(terminalAuthFile);
  for (const relative of postTapDiagnosticPaths ?? []) {
    const file = readRawEvidence(captureRoot, relative, missing, guard, !relative.endsWith('.png'));
    if (file) files.push(file);
  }
  const captureWasHarnessBlocked =
    capture.result === 'harness-blocked' || capture.result === 'cancelled';
  if (missing.length > 0 || !backendRunId || !backendArtifactRoot || !cleanupFile || !captureRunId)
    return blocked(
      captureWasHarnessBlocked ? 'blocked' : 'incomplete',
      captureRoot,
      captureRunId,
      missing,
      files,
    );

  try {
    const captureTyped = capture as unknown as SessionCaptureCandidate;
    const cleanup = cleanupFile.value as SessionCleanupCandidate;
    const currentIdentityBeforeReads = await currentSourceAndHelpers(
      repositoryRoot,
      captureTyped,
      guard,
    );
    requireSourceBuildIdentity(captureTyped, currentIdentityBeforeReads);
    if (captureTyped.sessionSignOutPostTapDiagnostic)
      requireSessionPostTapDiagnostic(captureRoot, captureTyped);
    guard();
    const captureBackend = backendRecord!;
    const backendProcesses = Array.isArray(captureBackend.processes)
      ? captureBackend.processes
      : [];
    const apiProcess = backendProcesses.find(
      (row) => row && typeof row === 'object' && (row as JsonRecord).role === 'api',
    ) as JsonRecord | undefined;
    const apiPid = Number((captureTyped.nativeAuthIdentityEvidence as JsonRecord).apiPid);
    const targetOrigin = String(
      (captureTyped.nativeAuthIdentityEvidence as JsonRecord).targetOrigin,
    );
    if (!apiProcess || apiProcess.pid !== apiPid)
      throw new Error('API process identity is not bound to auth receipt');
    const allProfileValues = Object.fromEntries(
      nativeSessionProfileCheckpointIds.map((checkpoint) => {
        const receipt = captureTyped.sessionProfileSnapshots[checkpoint];
        guard();
        const bytes = readNativeEvidence(captureRoot, receipt.path, true);
        guard();
        const value = requireConnectionSnapshot(JSON.parse(bytes.toString('utf8')));
        return [checkpoint, value];
      }),
    ) as Record<Checkpoint, OwnedConnectionSnapshot>;
    const allDomainValues = Object.fromEntries(
      nativeSessionProfileCheckpointIds.map((checkpoint) => {
        const receipt = captureTyped.sessionDomainSnapshots[checkpoint];
        guard();
        const bytes = readNativeEvidence(captureRoot, receipt.path, true);
        guard();
        const value = JSON.parse(bytes.toString('utf8')) as OwnedDomainSnapshot;
        assertTestingDocument('domain-snapshot-v1', value);
        return [checkpoint, value];
      }),
    ) as Record<Checkpoint, OwnedDomainSnapshot>;
    const fixtureAuthUids = allProfileValues.beforeLogin.fixtureAuthUids;
    const target = allProfileValues.beforeLogin.target;
    const allowlistHash = fixtureAllowlistHash(fixtureAuthUids);
    const expectedReceipt = {
      runId: backendRunId,
      scope: sessionScope,
      artifactRoot: backendArtifactRoot,
      apiPid,
      targetOrigin,
      allowlistHash,
    };
    for (const checkpoint of nativeSessionProfileCheckpointIds) {
      guard();
      requireFileReceipt(captureRoot, captureTyped.sessionProfileSnapshots[checkpoint], {
        ...expectedReceipt,
        label: `profile ${checkpoint}`,
      });
      requireFileReceipt(captureRoot, captureTyped.sessionDomainSnapshots[checkpoint], {
        ...expectedReceipt,
        label: `domain ${checkpoint}`,
      });
    }
    guard();
    requireFileReceipt(captureRoot, captureTyped.nativeAuthIdentityEvidence, {
      ...expectedReceipt,
      label: 'native auth identity',
    });
    guard();
    requireFileReceipt(captureRoot, captureTyped.transportEvidence, {
      ...expectedReceipt,
      label: 'stopped transport',
    });
    const sqlBeforeBytes = requireFileReceipt(captureRoot, captureTyped.sessionSqlBefore, {
      ...expectedReceipt,
      label: 'SQL before',
    });
    const sqlAfterBytes = requireFileReceipt(
      captureRoot,
      captureTyped.sessionSqlAfterSignedoutRelaunch,
      {
        ...expectedReceipt,
        label: 'SQL after signed-out relaunch',
      },
    );
    const sqlBefore = JSON.parse(sqlBeforeBytes.toString('utf8')) as OwnedDomainSnapshot;
    const sqlAfter = JSON.parse(sqlAfterBytes.toString('utf8')) as OwnedDomainSnapshot;
    guard();
    const transportBytes = readNativeEvidence(
      captureRoot,
      captureTyped.transportEvidence.path,
      true,
    );
    guard();
    const terminalTransportBytes = requireTerminalReceipt(
      captureRoot,
      terminalTransport as { path: string; bytes: number; sha256: string },
      'terminal transport',
    );
    const authBytes = readNativeEvidence(
      captureRoot,
      captureTyped.nativeAuthIdentityEvidence.path,
      true,
    );
    guard();
    const terminalAuthBytes = requireTerminalReceipt(
      captureRoot,
      terminalAuth as { path: string; bytes: number; sha256: string },
      'terminal auth',
    );
    const nativeAuthIdentities = JSON.parse(
      authBytes.toString('utf8'),
    ) as NativeAuthIdentityObservation[];
    const transportObservations = JSON.parse(transportBytes.toString('utf8')) as ProxyObservation[];
    const result = validateNativeSessionPublicDependency({
      selection,
      capture: captureTyped,
      evidenceRoot: captureRoot,
      cleanup,
      fixtureAuthUids,
      coachAuthUid: target.professionalAuthUid,
      studentAuthUid: target.studentAuthUid,
      backendRunId,
      backendArtifactRoot,
      apiIdentity: { apiPid, targetOrigin },
      profiles: allProfileValues,
      domain: allDomainValues,
      sessionSqlBefore: sqlBefore,
      sessionSqlAfterSignedoutRelaunch: sqlAfter,
      transportObservations,
      terminalTransportBytes,
      nativeAuthIdentities,
      nativeAuthTerminalBytes: terminalAuthBytes,
    });
    guard();
    const currentIdentityAfterReads = await currentSourceAndHelpers(
      repositoryRoot,
      captureTyped,
      guard,
    );
    assert.deepEqual(
      currentIdentityAfterReads,
      currentIdentityBeforeReads,
      'Source/helper identity changed while loading',
    );
    requireSourceBuildIdentity(captureTyped, currentIdentityAfterReads);
    guard();
    return { ...result, selection };
  } catch (error) {
    if (error instanceof LoaderStoppedError) throw error;
    return blocked(
      'blocked',
      captureRoot,
      captureRunId,
      [error instanceof Error ? error.message : String(error)],
      files,
    );
  }
}

/**
 * Loads a stopped private capture under a finite monotonic budget. This loader
 * deliberately does not qualify the reviewed public selection or reusable build;
 * that binding belongs to the outer public caller. Every returned shape remains
 * `publicPromotionEligible: false`.
 */
export async function loadNativeSessionPublicDependency(options: {
  repositoryRoot: string;
  captureRoot: string;
  cleanupRoot: string;
  cleanupPath: string;
  signal?: AbortSignal;
  deadlineMs?: number;
}): Promise<NativeSessionPublicDependencyLoad> {
  const captureRootHint = path.resolve(options.captureRoot);
  try {
    const guard = loaderGuard(options.signal, options.deadlineMs);
    guard();
    return await loadNativeSessionPublicDependencyInternal(options, guard);
  } catch (error) {
    return blocked(
      'blocked',
      captureRootHint,
      null,
      [error instanceof Error ? error.message : String(error)],
      [],
    );
  }
}

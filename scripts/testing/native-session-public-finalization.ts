import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
  type NativePilotSelection,
  type NativePilotTarget,
} from './native-pilot-contract';
import { nativeSessionHelperInputPaths } from './native-session-helper-ledger';
import {
  readNativeEvidenceObservation,
  type NativeEvidenceIdentity,
  type NativeEvidenceRootPolicy,
} from './native-view-evidence';
import { assertArtifactPath } from './schema-validation';
import type { NativeSourceIdentity } from './native-build-identity';
import type { NativeSessionPublicDependencyResult } from './native-session-public-dependency';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const runId = /^[a-f0-9]{24}$/;
const digest = /^[a-f0-9]{64}$/;
const loopback = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/;
const requiredSessionHelperPaths = nativeSessionHelperInputPaths;
const sessionPythonHelperPath = 'scripts/testing/detox-connection-ancestor-safe.py';

type JsonRecord = Record<string, unknown>;
export type NativeSessionPublicEvidenceKind = 'ui' | 'api' | 'sql';
export type NativeSessionPublicFinalizationLifecycle = {
  signal: AbortSignal;
  deadlineAtMs: number;
};
export type NativeSessionPublicAssertionBinding = {
  id: string;
  requirementRefs: readonly string[];
  evidenceKinds: readonly NativeSessionPublicEvidenceKind[];
  evidencePaths: readonly string[];
};

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), label + ' must be an object');
  return value as JsonRecord;
}

function stringValue(value: unknown, label: string): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    label + ' is invalid',
  );
  return value;
}

function relative(value: unknown, label: string): string {
  const candidate = stringValue(value, label);
  assert(!path.isAbsolute(candidate), label + ' must be relative');
  assert(!candidate.includes('\\'), label + ' contains a backslash');
  assert(!candidate.split('/').includes('..'), label + ' escapes its root');
  assert(candidate !== 'receipt.json', label + ' cannot be a public receipt');
  return candidate;
}

function requireHash(value: unknown, label: string): string {
  const candidate = stringValue(value, label);
  assert.match(candidate, digest, label + ' is not a SHA-256');
  return candidate;
}

function positive(value: unknown, label: string): number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value > 0,
    label + ' is not positive',
  );
  return value;
}

function nativeEvidenceIdentity(value: unknown, label: string): NativeEvidenceIdentity {
  const row = record(value, label);
  const fields = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size'] as const;
  for (const field of fields)
    assert(
      typeof row[field] === 'number' && Number.isSafeInteger(row[field]),
      label + '.' + field + ' is invalid',
    );
  for (const field of ['mtimeMs', 'ctimeMs'] as const)
    assert(
      typeof row[field] === 'number' && Number.isFinite(row[field]),
      label + '.' + field + ' is invalid',
    );
  assert.equal(row.nlink, 1, label + '.nlink is invalid');
  assert((row.size as number) > 0, label + '.size is invalid');
  return {
    dev: row.dev as number,
    ino: row.ino as number,
    uid: row.uid as number,
    gid: row.gid as number,
    mode: row.mode as number,
    nlink: row.nlink,
    size: row.size as number,
    mtimeMs: row.mtimeMs as number,
    ctimeMs: row.ctimeMs as number,
  };
}

async function privateRoot(value: string, label: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), label + ' is not canonical');
  const info = await lstat(canonical);
  assert(info.isDirectory() && !info.isSymbolicLink(), label + ' is not a regular directory');
  assert.equal(info.uid, process.getuid?.(), label + ' is not owned');
  assert.equal(info.mode & 0o777, 0o700, label + ' is not private');
  return canonical;
}

type RegularFileObservation = {
  bytes: Buffer;
  stat: NativeEvidenceIdentity;
  mode: number;
  uid: number;
  nlink: number;
};

type FileObservationReceipt = {
  path: string;
  sha256: string;
  bytes: number;
  mode: number;
  uid: number;
  nlink: number;
  stat: NativeEvidenceIdentity;
};

function finalizationFence(
  lifecycle: NativeSessionPublicFinalizationLifecycle,
  label: string,
): void {
  lifecycle.signal.throwIfAborted();
  assert(
    Number.isFinite(lifecycle.deadlineAtMs),
    'Session finalization deadline is invalid: ' + label,
  );
  if (performance.now() >= lifecycle.deadlineAtMs)
    throw new Error('Session finalization deadline expired: ' + label);
}

async function finalizationAwait<T>(
  lifecycle: NativeSessionPublicFinalizationLifecycle,
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  finalizationFence(lifecycle, label + ':before');
  const value = await operation();
  finalizationFence(lifecycle, label + ':after');
  return value;
}

function assertObservationMatchesReceipt(
  expected: FileObservationReceipt,
  observed: RegularFileObservation,
  label: string,
): void {
  assert.equal(hash(observed.bytes), expected.sha256, label + ' hash changed');
  assert.equal(observed.bytes.length, expected.bytes, label + ' byte count changed');
  assert.equal(observed.mode, expected.mode, label + ' mode changed');
  assert.equal(observed.uid, expected.uid, label + ' owner changed');
  assert.equal(observed.nlink, expected.nlink, label + ' link count changed');
  assert.deepEqual(observed.stat, expected.stat, label + ' descriptor/path identity changed');
}

async function observeRegularFile(
  root: string,
  relativePath: string,
  label: string,
  privateRecord = !relativePath.endsWith('.png'),
  rootPolicy: NativeEvidenceRootPolicy = 'private-artifact',
): Promise<RegularFileObservation> {
  assertArtifactPath(root, relativePath);
  try {
    const observed = await Promise.resolve(
      readNativeEvidenceObservation(root, relativePath, privateRecord, rootPolicy),
    );
    return {
      bytes: observed.bytes,
      stat: observed.identity,
      mode: observed.identity.mode & 0o777,
      uid: observed.identity.uid,
      nlink: observed.identity.nlink,
    };
  } catch (error) {
    throw new Error(label + ': ' + (error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  }
}

async function regularFile(root: string, relativePath: string, label: string): Promise<Buffer> {
  return (await observeRegularFile(root, relativePath, label)).bytes;
}

function assertSessionSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-session-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-session-ios');
  assert.equal(selection.scenario.platform, 'ios');
  assert.equal(selection.scenario.flowId, 'FLW-session');
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    nativeSessionAssertionIds,
  );
}

function assertTarget(target: NativePilotTarget, capture: JsonRecord): void {
  const device = record(capture.device, 'session capture device');
  const build = record(capture.build, 'session capture build');
  assert.equal(target.deviceId, stringValue(device.udid, 'iOS device UDID'));
  assert.equal(target.osVersion, stringValue(device.runtime, 'iOS runtime'));
  assert.equal(target.appId, stringValue(build.bundleId, 'iOS bundle ID'));
  assert.equal(target.buildProfile, stringValue(build.profile, 'iOS build profile'));
  assert.equal(target.binaryHash, requireHash(build.binaryHash, 'iOS binary hash'));
  assert.equal(target.apiOrigin, stringValue(build.apiOrigin, 'iOS API origin'));
  assert.match(target.apiOrigin, loopback, 'iOS API origin is not loopback');
}

function assertRuntimeControls(
  input: Pick<
    NativeSessionPublicFinalizationInput,
    'runtime' | 'captureRunId' | 'fixtureRunId' | 'fixtureHash' | 'flagsHash'
  >,
): void {
  const runtime = input.runtime;
  assert.equal(runtime.captureRunId, input.captureRunId);
  assert.equal(runtime.captureExitCode, 0);
  assert.equal(runtime.childExitCode, 0);
  assert.equal(runtime.childSignal, null);
  assert.equal(runtime.captureResult, 'observed');
  assert.equal(runtime.captureCleanup, 'cleaned');
  assert.equal(runtime.captureCompleted, true);
  assert.equal(runtime.externalCleanupResult, 'passed');
  assert.equal(runtime.captureTimeout, null);
  assert.equal(runtime.cancellation, null);
  assert.equal(runtime.postCaptureFailure, null);
  assert.deepEqual(runtime.censusFailures, []);
  assert.deepEqual(runtime.outputFailures, []);
  assert.equal(runtime.fixtureRunId, input.fixtureRunId);
  assert.match(input.fixtureRunId, runId);
  assert.match(input.fixtureHash, digest);
  assert.match(input.flagsHash, digest);
  for (const [name, value] of Object.entries(runtime.timingsMs))
    positive(value, 'runtime timing ' + name);
}

async function readCurrentHelpers(
  repositoryRoot: string,
  capture: JsonRecord,
): Promise<FileObservationReceipt[]> {
  const helperRows = (value: unknown, label: string): { path: string; sha256: string }[] => {
    assert(Array.isArray(value), label + ' must be an array');
    const rows = value.map((raw, index) => {
      const helper = record(raw, label + '[' + index + ']');
      const helperPath = relative(helper.path, label + '[' + index + '].path');
      assert(
        helperPath === 'package.json' ||
          helperPath.startsWith('scripts/testing/') ||
          helperPath.startsWith('scripts/ci/') ||
          // The session helper ledger binds the Maestro flows it executes.
          /^\.maestro\/flows\/[a-z0-9-]+\.yaml$/.test(helperPath),
        label + '[' + index + '] is outside the source boundary',
      );
      assert(
        sessionPythonHelperPath === helperPath ||
          /\.(?:ts|mjs|json|java|xml)$/.test(helperPath) ||
          helperPath.startsWith('.maestro/flows/'),
        label + '[' + index + '] has an unsupported extension',
      );
      return {
        path: helperPath,
        sha256: requireHash(helper.sha256, label + '[' + index + '].sha256'),
      };
    });
    assert.equal(new Set(rows.map((row) => row.path)).size, rows.length, label + ' is duplicated');
    return rows;
  };
  const helpersBefore = helperRows(capture.helperInputsBefore, 'session helper inputs');
  const helpersAfter = helperRows(capture.helperInputsAfter, 'session helper inputs after');
  assert.deepEqual(helpersBefore, helpersAfter, 'Helper source identity changed during capture');
  assert.deepEqual(
    helpersBefore.map((helper) => helper.path),
    [...requiredSessionHelperPaths],
    'Session helper identity does not match the canonical closure',
  );
  for (const required of requiredSessionHelperPaths)
    assert(
      helpersBefore.some((helper) => helper.path === required),
      'Session helper identity is absent: ' + required,
    );
  const result: FileObservationReceipt[] = [];
  const seen = new Set<string>();
  for (const helper of helpersBefore) {
    assert(!seen.has(helper.path), 'Helper source is duplicated: ' + helper.path);
    seen.add(helper.path);
    const observed = await observeRegularFile(
      repositoryRoot,
      helper.path,
      'Helper source ' + helper.path,
      false,
      'owned-source',
    );
    assert.equal(hash(observed.bytes), helper.sha256, 'Helper source changed: ' + helper.path);
    result.push({
      path: helper.path,
      sha256: helper.sha256,
      bytes: observed.bytes.length,
      mode: observed.mode,
      uid: observed.uid,
      nlink: observed.nlink,
      stat: observed.stat,
    });
  }
  return result;
}

function receiptCandidates(capture: JsonRecord): JsonRecord[] {
  const candidates: JsonRecord[] = [];
  for (const field of [
    'nativeAuthIdentityEvidence',
    'transportEvidence',
    'sessionSqlBefore',
    'sessionSqlAfterSignedoutRelaunch',
  ]) {
    const value = capture[field];
    if (value !== undefined) candidates.push(record(value, 'capture ' + field));
  }
  for (const field of ['sessionProfileSnapshots', 'sessionDomainSnapshots']) {
    const values = record(capture[field], 'capture ' + field);
    for (const value of Object.values(values))
      candidates.push(record(value, 'capture ' + field + ' receipt'));
  }
  const terminal = record(
    capture.sessionTerminalTransportDiagnostics,
    'terminal transport diagnostics',
  );
  for (const value of Object.values(terminal))
    candidates.push(record(value, 'terminal transport receipt'));
  return candidates;
}

async function readOriginalEvidence(
  captureRoot: string,
  capture: JsonRecord,
  dependency: NativeSessionPublicDependencyResult,
  candidate: NativeSessionPublicFinalizationCandidate | null,
  protectedFiles: ReadonlyMap<string, RegularFileObservation>,
): Promise<{
  files: Map<string, Buffer>;
  receipts: readonly FileObservationReceipt[];
}> {
  const paths = new Set<string>([
    'capture.private.json',
    'external-cleanup.private.json',
    ...dependency.files.framePaths,
    dependency.files.startupDiagnosticFramePath,
    ...dependency.files.profilePaths,
    ...dependency.files.domainPaths,
    dependency.files.transportPath,
    dependency.files.terminalTransportPath,
    ...(dependency.files.postTapDiagnosticPaths ?? []),
  ]);
  const frameRows = Array.isArray(capture.sessionViewEvidence)
    ? capture.sessionViewEvidence.map((value) => record(value, 'session frame'))
    : [];
  assert(frameRows.length > 0, 'Session frame ledger is empty');
  for (const frame of frameRows) {
    paths.add(relative(frame.screenshotPath, 'session screenshot path'));
    paths.add(relative(frame.hierarchyPath, 'session hierarchy path'));
  }
  for (const receipt of receiptCandidates(capture))
    paths.add(relative(receipt.path, 'session receipt path'));
  if (candidate)
    for (const row of candidate.assertionBindings)
      for (const evidencePath of row.evidencePaths)
        paths.add(relative(evidencePath, 'assertion evidence path'));
  const expected = new Map<string, { sha256: string; bytes: number }>();
  for (const receipt of receiptCandidates(capture)) {
    const receiptPath = relative(receipt.path, 'session receipt path');
    expected.set(receiptPath, {
      sha256: requireHash(receipt.sha256, 'receipt ' + receiptPath + ' hash'),
      bytes: positive(receipt.bytes, 'receipt ' + receiptPath + ' bytes'),
    });
  }
  for (const frame of frameRows) {
    expected.set(relative(frame.screenshotPath, 'frame screenshot path'), {
      sha256: requireHash(frame.screenshotHash, 'frame screenshot hash'),
      bytes: 0,
    });
    expected.set(relative(frame.hierarchyPath, 'frame hierarchy path'), {
      sha256: requireHash(frame.hierarchyHash, 'frame hierarchy hash'),
      bytes: 0,
    });
  }
  if (capture.sessionSignOutPostTapDiagnostic) {
    const diagnostic = record(
      capture.sessionSignOutPostTapDiagnostic,
      'session post-tap diagnostic',
    );
    for (const [pathKey, hashKey, bytesKey] of [
      ['flowPath', 'flowHash', 'flowBytes'],
      ['hierarchyPath', 'hierarchyHash', 'hierarchyBytes'],
      ['screenshotPath', 'screenshotHash', 'screenshotBytes'],
    ] as const)
      expected.set(relative(diagnostic[pathKey], 'session post-tap ' + pathKey), {
        sha256: requireHash(diagnostic[hashKey], 'session post-tap ' + hashKey),
        bytes: positive(diagnostic[bytesKey], 'session post-tap ' + bytesKey),
      });
  }
  const files = new Map<string, Buffer>();
  const receipts: FileObservationReceipt[] = [];
  for (const filePath of [...paths].sort()) {
    const observed =
      protectedFiles.get(filePath) ??
      (await observeRegularFile(captureRoot, filePath, 'Session evidence ' + filePath));
    const bytes = observed.bytes;
    assert(bytes.length > 0, 'Session evidence is empty: ' + filePath);
    const known = expected.get(filePath);
    if (known) {
      assert.equal(hash(bytes), known.sha256, 'Original session evidence changed: ' + filePath);
      if (known.bytes > 0)
        assert.equal(
          bytes.length,
          known.bytes,
          'Original session evidence size changed: ' + filePath,
        );
    }
    files.set(filePath, bytes);
    receipts.push({
      path: filePath,
      sha256: hash(bytes),
      bytes: bytes.length,
      mode: observed.mode,
      uid: observed.uid,
      nlink: observed.nlink,
      stat: observed.stat,
    });
  }
  return { files, receipts };
}

function assertCaptureLedger(
  capture: JsonRecord,
  dependency: NativeSessionPublicDependencyResult,
  fixtureRunId: string,
  fixtureHash: string,
  flagsHash: string,
): void {
  assert.equal(capture.kind, 'private-native-inventory-observation-not-behavior-attempt');
  assert.equal(capture.mode, 'inventory');
  assert.equal(capture.platform, 'ios');
  assert.equal(capture.charter, 'session');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  assert.equal(capture.captureRunId, dependency.captureRunId);
  assert.deepEqual(capture.sessionAssertionSequence, nativeSessionAssertionIds);
  assert.deepEqual(capture.sessionUiObservationOrder, [
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
  ]);
  assert.equal(capture.sessionEvidencePublication, 'complete');
  const postTapDiagnostic = record(
    capture.sessionSignOutPostTapDiagnostic,
    'session post-tap diagnostic',
  );
  for (const [pathKey, hashKey, bytesKey] of [
    ['flowPath', 'flowHash', 'flowBytes'],
    ['hierarchyPath', 'hierarchyHash', 'hierarchyBytes'],
    ['screenshotPath', 'screenshotHash', 'screenshotBytes'],
  ] as const) {
    relative(postTapDiagnostic[pathKey], 'session post-tap ' + pathKey);
    requireHash(postTapDiagnostic[hashKey], 'session post-tap ' + hashKey);
    positive(postTapDiagnostic[bytesKey], 'session post-tap ' + bytesKey);
  }
  const authContract = record(capture.nativeLogoutContract, 'native logout contract');
  assert.equal(authContract.scope, 'local-native-session-clear');
  assert.equal(authContract.serverRevocationQualified, false);
  const backend = record(capture.backend, 'session capture backend');
  assert.equal(backend.runId, fixtureRunId);
  assert.equal(capture.sessionSqlBeforeAfterUnchanged, true);
  assertTargetFields(capture);
  if (capture.fixtureHash !== undefined)
    assert.equal(capture.fixtureHash, fixtureHash, 'Capture fixture binding changed');
  if (capture.flagsHash !== undefined)
    assert.equal(capture.flagsHash, flagsHash, 'Capture flags binding changed');
  assert.equal(dependency.status, 'validated-source-only');
  assert.equal(dependency.nativePassingCases, 0);
  assert.equal(dependency.publicPassingCases, 0);
  assert.equal(dependency.publicPromotionEligible, false);
}

function assertTargetFields(capture: JsonRecord): void {
  const device = record(capture.device, 'session device');
  const build = record(capture.build, 'session build');
  stringValue(device.udid, 'session device UDID');
  stringValue(device.runtime, 'session device runtime');
  stringValue(build.bundleId, 'session bundle ID');
  stringValue(build.profile, 'session build profile');
  requireHash(build.binaryHash, 'session binary hash');
  const apiOrigin = stringValue(build.apiOrigin, 'session API origin');
  assert.match(apiOrigin, loopback, 'session API origin is not loopback');
}

function assertCandidate(
  candidate: NativeSessionPublicFinalizationCandidate,
  selection: NativePilotSelection,
  fixtureRunId: string,
  captureRunId: string,
  capture: JsonRecord,
  dependency: NativeSessionPublicDependencyResult,
): void {
  assert.equal(candidate.kind, 'private-ios-session-public-finalization-candidate');
  assert.equal(candidate.status, 'eligible');
  assert.equal(candidate.captureRunId, captureRunId);
  assert.equal(candidate.fixtureRunId, fixtureRunId);
  assert.equal(candidate.nativePassingCases, nativeSessionAssertionIds.length);
  assert.equal(candidate.publicPassingCases, nativeSessionAssertionIds.length);
  assert.equal(candidate.publicPromotionEligible, true);
  validateNativeSessionPublicAssertionLedger(selection, candidate.assertionBindings);
  const frameRows = Array.isArray(capture.sessionViewEvidence)
    ? capture.sessionViewEvidence.map((value) => record(value, 'session frame'))
    : [];
  const uiPaths = new Set<string>();
  for (const frame of frameRows) {
    uiPaths.add(relative(frame.screenshotPath, 'session screenshot path'));
    uiPaths.add(relative(frame.hierarchyPath, 'session hierarchy path'));
  }
  const apiPaths = new Set<string>([
    dependency.files.transportPath,
    dependency.files.terminalTransportPath,
    relative(
      record(capture.nativeAuthIdentityEvidence, 'native auth identity').path,
      'native auth identity path',
    ),
  ]);
  const sqlPaths = new Set<string>([
    ...dependency.files.domainPaths,
    relative(record(capture.sessionSqlBefore, 'SQL before').path, 'SQL before path'),
    relative(
      record(capture.sessionSqlAfterSignedoutRelaunch, 'SQL after signed-out relaunch').path,
      'SQL after signed-out relaunch path',
    ),
  ]);
  const ledger = requireNativePilotAssertions(selection);
  for (const required of ledger) {
    const row = candidate.assertionBindings.find((value) => value.id === required.id);
    assert(row, 'Public session assertion is missing: ' + required.id);
    assert.deepEqual(row.evidenceKinds, required.evidenceKinds);
    for (const evidenceKind of required.evidenceKinds)
      assert(
        row.evidencePaths.some((evidencePath) =>
          (evidenceKind === 'ui' ? uiPaths : evidenceKind === 'api' ? apiPaths : sqlPaths).has(
            evidencePath,
          ),
        ),
        'Public session assertion lacks original ' + evidenceKind + ' evidence: ' + required.id,
      );
  }
}

function framePathsByLabel(capture: JsonRecord): Map<string, string[]> {
  const rows = Array.isArray(capture.sessionViewEvidence)
    ? capture.sessionViewEvidence.map((value) => record(value, 'session frame'))
    : [];
  const result = new Map<string, string[]>();
  for (const frame of rows) {
    // The capture ledger names each frame by its files (`<label>.png` and
    // `<label>-hierarchy.json`) and carries no separate label field.
    const screenshotPath = relative(frame.screenshotPath, 'session screenshot path');
    const hierarchyPath = relative(frame.hierarchyPath, 'session hierarchy path');
    const label = stringValue(
      /^([a-z0-9-]+)\.png$/u.exec(screenshotPath)?.[1],
      'session frame label',
    );
    assert.equal(
      hierarchyPath,
      label + '-hierarchy.json',
      'session frame hierarchy path is invalid',
    );
    if (frame.label !== undefined)
      assert.equal(frame.label, label, 'session frame label is invalid');
    assert(!result.has(label), 'session frame label is duplicated: ' + label);
    result.set(label, [screenshotPath, hierarchyPath]);
  }
  return result;
}

/**
 * Bind the real stopped iOS capture ledger to original files written by the
 * owned capture. Missing frames, transport or SQL receipts fail closed.
 */
export async function buildNativeSessionPublicFinalizationCandidate(input: {
  selection: NativePilotSelection;
  captureRoot: string;
  capture: JsonRecord;
  dependency: NativeSessionPublicDependencyResult & { selection: NativePilotSelection };
  fixtureRunId: string;
}): Promise<NativeSessionPublicFinalizationCandidate> {
  assertSessionSelection(input.selection);
  assert.equal(input.dependency.status, 'validated-source-only');
  assert.deepEqual(input.dependency.selection, input.selection);
  assert.match(input.fixtureRunId, runId);
  assert.equal(input.capture.captureRunId, input.dependency.captureRunId);
  assert.equal(input.capture.sessionEvidencePublication, 'complete');
  assert.deepEqual(input.capture.sessionAssertionSequence, nativeSessionAssertionIds);
  const framePaths = framePathsByLabel(input.capture);
  const apiPaths = [
    input.dependency.files.transportPath,
    relative(
      record(input.capture.nativeAuthIdentityEvidence, 'native auth identity').path,
      'native auth identity path',
    ),
  ];
  const sqlPaths = [
    ...input.dependency.files.domainPaths,
    relative(record(input.capture.sessionSqlBefore, 'SQL before').path, 'SQL before path'),
    relative(
      record(input.capture.sessionSqlAfterSignedoutRelaunch, 'SQL after signed-out relaunch').path,
      'SQL after signed-out relaunch path',
    ),
  ];
  const frames = (...labels: string[]) =>
    labels.flatMap((label) => {
      const paths = framePaths.get(label);
      assert(paths, 'Required session frame is absent: ' + label);
      return paths;
    });
  const pathsByAssertion: Record<string, string[]> = {
    'NAT-session-login': [...frames('entry', 'password-save-prompt', 'coach-home'), ...apiPaths],
    'NAT-session-restore': [...frames('restored-home', 'restored-identity'), ...apiPaths],
    'NAT-session-account': frames('account', 'restored-identity'),
    'NAT-session-signout': [
      ...frames('signout-confirm', 'cancel-signout', 'signout-reopen', 'signout-confirmed'),
      ...apiPaths,
    ],
    'NAT-session-signed-out-relaunch': [...frames('signed-out-relaunch'), ...apiPaths],
    'NAT-session-unrelated-state': sqlPaths,
  };
  const ledger = requireNativePilotAssertions(input.selection);
  const assertionBindings: NativeSessionPublicAssertionBinding[] = [];
  for (const row of ledger) {
    const evidencePaths = [...new Set(pathsByAssertion[row.id] ?? [])];
    assert(evidencePaths.length > 0, 'Session assertion has no bound original evidence: ' + row.id);
    for (const evidencePath of evidencePaths)
      await regularFile(
        input.captureRoot,
        evidencePath,
        'Original session evidence ' + evidencePath,
      );
    assertionBindings.push({
      id: row.id,
      requirementRefs: [...row.requirementRefs],
      evidenceKinds: [...row.evidenceKinds],
      evidencePaths,
    });
  }
  return {
    kind: 'private-ios-session-public-finalization-candidate',
    status: 'eligible',
    captureRunId: input.dependency.captureRunId,
    fixtureRunId: input.fixtureRunId,
    assertionBindings,
    nativePassingCases: nativeSessionAssertionIds.length,
    publicPassingCases: nativeSessionAssertionIds.length,
    publicPromotionEligible: true,
  };
}

export function validateNativeSessionPublicAssertionLedger(
  selection: NativePilotSelection,
  rows: readonly NativeSessionPublicAssertionBinding[],
): void {
  const ledger = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    nativeSessionAssertionIds,
  );
  assert.equal(new Set(rows.map((row) => row.id)).size, ledger.length);
  for (const required of ledger) {
    const row = rows.find((value) => value.id === required.id);
    assert(row, 'Public session assertion is missing: ' + required.id);
    assert.deepEqual(row.requirementRefs, required.requirementRefs);
    assert.deepEqual(row.evidenceKinds, required.evidenceKinds);
    assert(
      row.evidencePaths.length > 0,
      'Public session assertion has no evidence: ' + required.id,
    );
    assert.equal(new Set(row.evidencePaths).size, row.evidencePaths.length);
  }
}

export function validateNativeSessionPublicSourceIdentity(input: {
  captureSource: NativeSourceIdentity;
  captureSourceAfter: NativeSourceIdentity;
  sourceBefore: NativeSourceIdentity;
  sourceAfter: NativeSourceIdentity;
}): void {
  assert.deepEqual(
    input.captureSource,
    input.sourceBefore,
    'Captured source identity differs before finalization',
  );
  assert.deepEqual(
    input.captureSourceAfter,
    input.sourceAfter,
    'Captured source identity differs after finalization',
  );
  assert.deepEqual(
    input.sourceBefore,
    input.sourceAfter,
    'Source identity changed during finalization',
  );
}

export type NativeSessionPublicFinalizationRuntime = {
  captureRunId: string;
  captureExitCode: number;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  captureResult: string;
  captureCleanup: string;
  captureCompleted: boolean;
  externalCleanupResult: string;
  captureTimeout: string | null;
  cancellation: string | null;
  postCaptureFailure: unknown;
  censusFailures: readonly unknown[];
  outputFailures: readonly unknown[];
  fixtureRunId: string;
  fixtureHash: string;
  flagsHash: string;
  timingsMs: Record<string, number>;
};

export type NativeSessionPublicFinalizationCandidate = {
  kind: 'private-ios-session-public-finalization-candidate';
  status: 'eligible';
  captureRunId: string;
  fixtureRunId: string;
  assertionBindings: readonly NativeSessionPublicAssertionBinding[];
  nativePassingCases: 6;
  publicPassingCases: 6;
  publicPromotionEligible: true;
};

export type NativeSessionPublicFinalizationInput = {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  fixtureRunId: string;
  fixtureHash: string;
  flagsHash: string;
  selection: NativePilotSelection;
  target: NativePilotTarget;
  sourceBefore: NativeSourceIdentity;
  sourceAfter: NativeSourceIdentity;
  dependency: NativeSessionPublicDependencyResult & { selection: NativePilotSelection };
  runtime: NativeSessionPublicFinalizationRuntime;
  candidate: NativeSessionPublicFinalizationCandidate | null;
  /** Captured by the adapter before staging; binds sidecars across the handoff. */
  protectedControls?: NativeSessionPublicFinalizationControls;
};

export type NativeSessionPublicFinalizationControls = {
  kind: 'private-ios-session-public-finalization-controls';
  status: 'source-only' | 'candidate-ready';
  controlsVerified: true;
  captureRunId: string;
  assertionIds: readonly string[];
  originalFiles: readonly FileObservationReceipt[];
  helperFiles: readonly FileObservationReceipt[];
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
};

export type NativeSessionPublicStageResult = {
  copyManifest: { path: string; sha256: string };
  assertions: readonly {
    id: string;
    requirementRefs: string[];
    outcome: 'passed';
    evidencePaths: string[];
  }[];
  artifacts: readonly string[];
};

export function validateNativeSessionPublicLifecycle(
  input: Pick<
    NativeSessionPublicFinalizationInput,
    'selection' | 'target' | 'runtime' | 'fixtureRunId' | 'fixtureHash' | 'flagsHash'
  >,
): void {
  assertSessionSelection(input.selection);
  assertRuntimeControls({
    captureRunId: input.runtime.captureRunId,
    fixtureRunId: input.fixtureRunId,
    fixtureHash: input.fixtureHash,
    flagsHash: input.flagsHash,
    runtime: input.runtime,
  });
  const targetValues = [
    input.target.deviceId,
    input.target.osVersion,
    input.target.appId,
    input.target.buildProfile,
    input.target.binaryHash,
    input.target.apiOrigin,
  ];
  assert(
    targetValues.every((value) => typeof value === 'string' && value.length > 0),
    'Native target is incomplete',
  );
  assert.match(input.target.binaryHash!, digest);
  assert.match(input.target.apiOrigin!, loopback);
}

export async function validateNativeSessionPublicFinalizationControls(
  input: NativeSessionPublicFinalizationInput,
): Promise<NativeSessionPublicFinalizationControls> {
  validateNativeSessionPublicLifecycle(input);
  const captureRoot = await privateRoot(input.captureRoot, 'Session capture root');
  const outputRoot = await privateRoot(input.outputRoot, 'Session output root');
  assert.match(input.requestedRunId, runId);
  assert.match(input.requestedAttemptId, /^[a-f0-9]{24}:first$/);
  assert.equal(path.basename(outputRoot), input.requestedRunId);
  assert.equal(path.basename(captureRoot), input.captureRunId);
  assert.notEqual(captureRoot, outputRoot);
  assertSessionSelection(input.selection);
  const dependency = input.dependency;
  assert.equal(dependency.status, 'validated-source-only');
  assert.equal(dependency.captureRunId, input.captureRunId);
  assert.deepEqual(dependency.assertionIds, nativeSessionAssertionIds);
  assert.equal(dependency.nativePassingCases, 0);
  assert.equal(dependency.publicPassingCases, 0);
  assert.equal(dependency.publicPromotionEligible, false);
  assert.equal(dependency.selection.arguments.platform, 'ios');
  assert.deepEqual(dependency.selection, input.selection, 'Session dependency selection changed');
  assert.match(input.fixtureRunId, runId);
  assertRuntimeControls(input);
  const protectedSidecars = new Map<string, RegularFileObservation>();
  for (const [relativePath, label] of [
    ['capture.private.json', 'session capture'],
    ['external-cleanup.private.json', 'session cleanup'],
  ] as const) {
    protectedSidecars.set(
      relativePath,
      await observeRegularFile(captureRoot, relativePath, label, true, 'private-artifact'),
    );
  }
  const capture = record(
    JSON.parse(protectedSidecars.get('capture.private.json')!.bytes.toString()),
    'session capture',
  );
  const cleanup = record(
    JSON.parse(protectedSidecars.get('external-cleanup.private.json')!.bytes.toString()),
    'session cleanup',
  );
  validateNativeSessionPublicSourceIdentity({
    captureSource: capture.source as NativeSourceIdentity,
    captureSourceAfter: capture.sourceAfter as NativeSourceIdentity,
    sourceBefore: input.sourceBefore,
    sourceAfter: input.sourceAfter,
  });
  assertCaptureLedger(capture, dependency, input.fixtureRunId, input.fixtureHash, input.flagsHash);
  assertTarget(input.target, capture);
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.runId, input.captureRunId);
  assert.equal(cleanup.captureResult, 'observed');
  assert.equal(cleanup.captureCleanupClean, true);
  assert.deepEqual(cleanup.survivors, []);
  assert.deepEqual(cleanup.unknownProcessQueries, []);
  assert.deepEqual(cleanup.missingForeignDevices, []);
  assert.equal(cleanup.ownedDeviceAbsent, true);
  assert.equal(cleanup.cacheAbsent, true);
  const helperFiles = await readCurrentHelpers(input.repositoryRoot, capture);
  const evidence = await readOriginalEvidence(
    captureRoot,
    capture,
    dependency,
    input.candidate,
    protectedSidecars,
  );
  if (input.candidate) {
    assertCandidate(
      input.candidate,
      input.selection,
      input.fixtureRunId,
      input.captureRunId,
      capture,
      dependency,
    );
    for (const row of input.candidate.assertionBindings)
      for (const evidencePath of row.evidencePaths)
        assert(
          evidence.files.has(evidencePath),
          'Public assertion evidence is not original: ' + evidencePath,
        );
  }
  return {
    kind: 'private-ios-session-public-finalization-controls',
    status: input.candidate ? 'candidate-ready' : 'source-only',
    controlsVerified: true,
    captureRunId: input.captureRunId,
    assertionIds: [...nativeSessionAssertionIds],
    originalFiles: evidence.receipts,
    helperFiles,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
  };
}

export async function stageNativeSessionPublicEvidence(
  input: NativeSessionPublicFinalizationInput,
  lifecycle: NativeSessionPublicFinalizationLifecycle,
): Promise<NativeSessionPublicStageResult> {
  let outputRoot: string | undefined;
  let prefix: string | undefined;
  try {
    const controls = input.protectedControls
      ? input.protectedControls
      : await finalizationAwait(
          lifecycle,
          () => validateNativeSessionPublicFinalizationControls(input),
          'validate controls',
        );
    assert.equal(controls.captureRunId, input.captureRunId);
    assert.deepEqual(controls.assertionIds, nativeSessionAssertionIds);
    assert(
      input.candidate,
      'Public session candidate is absent; source-only capture cannot be promoted',
    );
    assert.equal(controls.status, 'candidate-ready');
    const captureRoot = await finalizationAwait(
      lifecycle,
      () => privateRoot(input.captureRoot, 'Session capture root'),
      'capture root',
    );
    outputRoot = await finalizationAwait(
      lifecycle,
      () => privateRoot(input.outputRoot, 'Session output root'),
      'output root',
    );
    const original = new Map<string, RegularFileObservation>();
    for (const row of controls.originalFiles) {
      const observed = await finalizationAwait(
        lifecycle,
        () => observeRegularFile(captureRoot, row.path, 'Session evidence ' + row.path),
        'revalidate evidence ' + row.path,
      );
      assertObservationMatchesReceipt(row, observed, 'Session evidence ' + row.path);
      original.set(row.path, observed);
    }
    const helperRoot = new Map<string, RegularFileObservation>();
    for (const row of controls.helperFiles) {
      const observed = await finalizationAwait(
        lifecycle,
        () =>
          observeRegularFile(
            input.repositoryRoot,
            row.path,
            'Helper source ' + row.path,
            false,
            'owned-source',
          ),
        'revalidate helper ' + row.path,
      );
      assertObservationMatchesReceipt(row, observed, 'Helper source ' + row.path);
      helperRoot.set('source-helpers/' + row.path, observed);
    }
    prefix = 'evidence/' + input.captureRunId + '/session-public';
    const files = new Map<string, RegularFileObservation>([...original, ...helperRoot]);
    await finalizationAwait(
      lifecycle,
      () => mkdir(assertArtifactPath(outputRoot!, prefix!), { recursive: true, mode: 0o700 }),
      'create stage root',
    );
    const staged: {
      path: string;
      sha256: string;
      bytes: number;
      originalMode: number;
      originalUid: number;
      originalNlink: number;
      originalStat: NativeEvidenceIdentity;
    }[] = [];
    for (const [relativePath, observed] of files) {
      finalizationFence(lifecycle, 'copy ' + relativePath + ':before');
      const destination = assertArtifactPath(outputRoot, prefix + '/' + relativePath);
      await finalizationAwait(
        lifecycle,
        () => mkdir(path.dirname(destination), { recursive: true, mode: 0o700 }),
        'create parent ' + relativePath,
      );
      await finalizationAwait(
        lifecycle,
        () => writeFile(destination, observed.bytes, { flag: 'wx', mode: 0o600 }),
        'copy ' + relativePath,
      );
      const copied = await finalizationAwait(
        lifecycle,
        () =>
          regularFile(
            outputRoot!,
            prefix! + '/' + relativePath,
            'Staged session evidence ' + relativePath,
          ),
        'verify copy ' + relativePath,
      );
      assert.deepEqual(copied, observed.bytes, 'Staged session evidence changed: ' + relativePath);
      staged.push({
        path: relativePath,
        sha256: hash(observed.bytes),
        bytes: observed.bytes.length,
        originalMode: observed.mode,
        originalUid: observed.uid,
        originalNlink: observed.nlink,
        originalStat: observed.stat,
      });
    }
    const manifestPath = prefix + '/copy-manifest.private.json';
    const manifest = {
      kind: 'private-ios-session-public-finalization-copy-not-public-receipt',
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      captureRunId: input.captureRunId,
      fixtureRunId: input.fixtureRunId,
      assertionIds: [...nativeSessionAssertionIds],
      nativePassingCases: input.candidate.nativePassingCases,
      publicPassingCases: input.candidate.publicPassingCases,
      publicPromotionEligible: input.candidate.publicPromotionEligible,
      files: staged,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    await finalizationAwait(
      lifecycle,
      () =>
        writeFile(assertArtifactPath(outputRoot!, manifestPath), manifestBytes, {
          flag: 'wx',
          mode: 0o600,
        }),
      'write copy manifest',
    );
    const controlPath = prefix + '/public-finalization-controls.private.json';
    const controlBytes = Buffer.from(JSON.stringify(controls, null, 2) + '\n');
    await finalizationAwait(
      lifecycle,
      () =>
        writeFile(assertArtifactPath(outputRoot!, controlPath), controlBytes, {
          flag: 'wx',
          mode: 0o600,
        }),
      'write controls',
    );
    await verifyNativeSessionPublicEvidence(
      {
        outputRoot,
        copyManifest: { path: manifestPath, sha256: hash(manifestBytes) },
        requestedRunId: input.requestedRunId,
        captureRunId: input.captureRunId,
        fixtureRunId: input.fixtureRunId,
        captureRoot,
        repositoryRoot: input.repositoryRoot,
      },
      lifecycle,
    );
    finalizationFence(lifecycle, 'publish stage result');
    const ledger = requireNativePilotAssertions(input.selection);
    return {
      copyManifest: { path: manifestPath, sha256: hash(manifestBytes) },
      assertions: input.candidate.assertionBindings.map((row) => {
        const required = ledger.find((value) => value.id === row.id);
        assert(required, 'Public session assertion is not in the canonical ledger: ' + row.id);
        return {
          id: row.id,
          requirementRefs: [...required.requirementRefs],
          outcome: 'passed' as const,
          evidencePaths: row.evidencePaths.map((value) => prefix! + '/' + value),
        };
      }),
      artifacts: [manifestPath, controlPath, ...staged.map((row) => prefix! + '/' + row.path)],
    };
  } catch (error) {
    if (outputRoot && prefix) {
      try {
        await rm(assertArtifactPath(outputRoot, prefix), { recursive: true, force: true });
      } catch {
        // The caller retains the outer blocked receipt when cleanup cannot remove a partial stage.
      }
    }
    throw error;
  }
}

export async function removeNativeSessionPublicEvidenceStage(options: {
  outputRoot: string;
  captureRunId: string;
}): Promise<void> {
  const outputRoot = await privateRoot(options.outputRoot, 'Session output root');
  await rm(assertArtifactPath(outputRoot, 'evidence/' + options.captureRunId + '/session-public'), {
    recursive: true,
    force: true,
  });
}

export async function verifyNativeSessionPublicEvidence(
  options: {
    outputRoot: string;
    copyManifest: { path: string; sha256: string };
    requestedRunId: string;
    captureRunId: string;
    fixtureRunId: string;
    captureRoot?: string;
    repositoryRoot?: string;
  },
  lifecycle: NativeSessionPublicFinalizationLifecycle,
): Promise<void> {
  finalizationFence(lifecycle, 'verify:start');
  const outputRoot = await finalizationAwait(
    lifecycle,
    () => privateRoot(options.outputRoot, 'Session output root'),
    'verify output root',
  );
  const captureRoot =
    options.captureRoot === undefined
      ? null
      : await finalizationAwait(
          lifecycle,
          () => privateRoot(options.captureRoot!, 'Session capture root'),
          'verify capture root',
        );
  const repositoryRoot =
    options.repositoryRoot === undefined
      ? null
      : await finalizationAwait(
          lifecycle,
          () => realpath(options.repositoryRoot!),
          'verify repository root',
        );
  finalizationFence(lifecycle, 'verify identity');
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  const prefix = 'evidence/' + options.captureRunId + '/session-public';
  assert.equal(options.copyManifest.path, prefix + '/copy-manifest.private.json');
  const manifestBytes = await finalizationAwait(
    lifecycle,
    () => regularFile(outputRoot, options.copyManifest.path, 'Session public manifest'),
    'read staged manifest',
  );
  assert.equal(hash(manifestBytes), options.copyManifest.sha256, 'Session public manifest changed');
  const manifest = record(JSON.parse(manifestBytes.toString()), 'Session public manifest');
  assert.equal(manifest.kind, 'private-ios-session-public-finalization-copy-not-public-receipt');
  assert.equal(manifest.requestedRunId, options.requestedRunId);
  assert.equal(manifest.captureRunId, options.captureRunId);
  assert.equal(manifest.fixtureRunId, options.fixtureRunId);
  assert.deepEqual(manifest.assertionIds, nativeSessionAssertionIds);
  assert.equal(manifest.nativePassingCases, nativeSessionAssertionIds.length);
  assert.equal(manifest.publicPassingCases, nativeSessionAssertionIds.length);
  assert.equal(manifest.publicPromotionEligible, true);
  const files = manifest.files;
  assert(Array.isArray(files) && files.length > 0, 'Session public manifest has no files');
  const seen = new Set<string>();
  for (const value of files) {
    const row = record(value, 'Session public manifest file');
    const filePath = relative(row.path, 'Session public manifest path');
    assert(!seen.has(filePath), 'Session public manifest duplicate: ' + filePath);
    seen.add(filePath);
    const expectedHash = requireHash(row.sha256, 'Session public manifest ' + filePath + ' hash');
    const expectedBytes = positive(row.bytes, 'Session public manifest ' + filePath + ' bytes');
    assert(
      Number.isSafeInteger(row.originalMode) && Number.isSafeInteger(row.originalUid),
      'Session public manifest original ownership metadata is invalid',
    );
    assert.equal(row.originalNlink, 1, 'Session public manifest original link count is invalid');
    const originalStat = nativeEvidenceIdentity(
      row.originalStat,
      'Session public manifest ' + filePath + ' original stat',
    );
    assert.equal(originalStat.mode & 0o777, row.originalMode, 'Session public manifest mode drift');
    assert.equal(originalStat.uid, row.originalUid, 'Session public manifest owner drift');
    assert.equal(originalStat.nlink, row.originalNlink, 'Session public manifest link-count drift');
    const bytes = await finalizationAwait(
      lifecycle,
      () => regularFile(outputRoot, prefix + '/' + filePath, 'Staged session evidence ' + filePath),
      'read staged evidence ' + filePath,
    );
    assert.equal(bytes.length, expectedBytes, 'Staged session evidence size changed: ' + filePath);
    assert.equal(hash(bytes), expectedHash, 'Staged session evidence changed: ' + filePath);
    if (captureRoot) {
      const original =
        filePath.startsWith('source-helpers/') && repositoryRoot
          ? await finalizationAwait(
              lifecycle,
              () =>
                observeRegularFile(
                  repositoryRoot,
                  filePath.slice('source-helpers/'.length),
                  'Original helper source',
                  false,
                  'owned-source',
                ),
              'read original helper ' + filePath,
            )
          : await finalizationAwait(
              lifecycle,
              () => observeRegularFile(captureRoot, filePath, 'Original session evidence'),
              'read original evidence ' + filePath,
            );
      assert.equal(
        hash(original.bytes),
        expectedHash,
        'Original session evidence changed after staging: ' + filePath,
      );
      assert.equal(
        original.bytes.length,
        expectedBytes,
        'Original session evidence size changed after staging: ' + filePath,
      );
      assert.equal(
        original.mode,
        row.originalMode,
        'Original session evidence mode changed after staging: ' + filePath,
      );
      assert.equal(
        original.uid,
        row.originalUid,
        'Original session evidence owner changed after staging: ' + filePath,
      );
      assert.equal(
        original.nlink,
        row.originalNlink,
        'Original session evidence link count changed after staging: ' + filePath,
      );
      assert.deepEqual(
        original.stat,
        originalStat,
        'Original session evidence descriptor/path identity changed after staging: ' + filePath,
      );
    }
  }
  const names = await finalizationAwait(lifecycle, () => readdir(outputRoot), 'read output census');
  assert(
    !names.some((name) => name.endsWith('.census-failure.private.json')),
    'Output census failure prevents finalization',
  );
  const directoryNames = await finalizationAwait(
    lifecycle,
    () => readdir(assertArtifactPath(outputRoot, prefix)),
    'read staged census',
  );
  assert(
    !directoryNames.some((name) => name.endsWith('.census-failure.private.json')),
    'Session public census failure retained',
  );
  finalizationFence(lifecycle, 'verify:complete');
}

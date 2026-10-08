import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { androidSourceIdentity } from './android-build-identity';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import { nativeSaveRetryAssertionIds, requireNativePilotAssertions } from './native-pilot-contract';
import {
  readNativeSaveRetryAttemptBinding,
  requireNativeSaveRetryAssertionContract,
  saveRetryAttemptBindingPath,
  type NativeSaveRetryAttemptBinding,
} from './native-save-retry-attempt-binding';
import { requireSuccessfulNativeCommandDiagnostics } from './native-training-attempt-outcome';
import { requireFullAndroidTrainingCleanupEvidence } from './native-training-pilot-evidence';
import {
  nativeSaveRetryRuntimeFrames,
  nativeSaveRetryRuntimeFramesPath,
  nativeSaveRetrySnapshotPaths,
  readNativeEvidence,
  readNativeEvidenceObservation,
  validateNativeRuntimeFrameFiles,
  validateNativeSaveRetryPreparation,
  type NativeEvidenceIdentity,
  type ViewEvidence,
} from './native-view-evidence';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';

const runId = /^[a-f0-9]{24}$/;
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const runtimeMetadataPath = 'save-retry-runtime-metadata.private.json';
const evidenceKind = 'native-save-retry-assertion-evidence-preparation';

type CollectedFile = {
  bytes: Buffer;
  mode: number;
  originalIdentity: NativeEvidenceIdentity | null;
};

export type AndroidSaveRetryAssertionBinding = {
  id: string;
  requirementRefs: string[];
  evidencePaths: string[];
};

type Capture = {
  kind: string;
  mode: string;
  platform: string;
  charter: string;
  result: string;
  cleanup: unknown;
  nativePassingCases: number;
  source: unknown;
  sourceAfter: unknown;
  helperInputsBefore: unknown;
  helperInputsAfter: unknown;
  build: Record<string, unknown>;
  device: Record<string, unknown>;
  backend: { runId: string };
  commandExecutions: unknown;
  observations: unknown;
  saveRetryPreparation: unknown;
};

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

function fileBytes(value: CollectedFile): Buffer {
  return value.bytes;
}

function assertSameCollectedFile(
  left: CollectedFile,
  right: CollectedFile,
  relative: string,
): void {
  assert.deepEqual(left.bytes, right.bytes, `Android evidence changed: ${relative}`);
  assert.equal(left.mode, right.mode, `Android evidence mode changed: ${relative}`);
  assert.deepEqual(
    left.originalIdentity,
    right.originalIdentity,
    `Android evidence identity changed: ${relative}`,
  );
}

function parseOriginalIdentity(value: unknown, label: string): NativeEvidenceIdentity | null {
  if (value === null) return null;
  const row = record(value, label);
  assert(
    typeof row.dev === 'number' &&
      Number.isSafeInteger(row.dev) &&
      typeof row.ino === 'number' &&
      Number.isSafeInteger(row.ino) &&
      typeof row.uid === 'number' &&
      Number.isSafeInteger(row.uid) &&
      typeof row.gid === 'number' &&
      Number.isSafeInteger(row.gid) &&
      typeof row.mode === 'number' &&
      Number.isSafeInteger(row.mode) &&
      typeof row.nlink === 'number' &&
      Number.isSafeInteger(row.nlink) &&
      typeof row.size === 'number' &&
      Number.isSafeInteger(row.size) &&
      typeof row.mtimeMs === 'number' &&
      Number.isFinite(row.mtimeMs) &&
      typeof row.ctimeMs === 'number' &&
      Number.isFinite(row.ctimeMs),
    `${label} is incomplete`,
  );
  return {
    dev: row.dev,
    ino: row.ino,
    uid: row.uid,
    gid: row.gid,
    mode: row.mode,
    nlink: row.nlink,
    size: row.size,
    mtimeMs: row.mtimeMs,
    ctimeMs: row.ctimeMs,
  };
}

function expectedMode(relative: string): 0o600 | 0o644 {
  return relative.endsWith('.png') ? 0o644 : 0o600;
}

async function privateRoot(value: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), 'Android evidence root is not canonical');
  const info = await lstat(canonical);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Android evidence root is not a directory');
  assert.equal(info.uid, process.getuid?.(), 'Android evidence root is not owned');
  assert.equal(info.mode & 0o777, 0o700, 'Android evidence root is not private');
  return canonical;
}

function json(root: string, relative: string): unknown {
  return JSON.parse(readNativeEvidence(root, relative, true).toString());
}

function requireNoCensusFailure(root: string): Promise<void> {
  return readdir(root, { withFileTypes: true }).then(async (entries) => {
    for (const entry of entries) {
      assert(!entry.name.endsWith('.census-failure.private.json'));
      if (entry.isDirectory()) await requireNoCensusFailure(path.join(root, entry.name));
    }
  });
}

function runtimeFrameEntries(value: unknown) {
  return array(value, 'Android save/retry observations').map((raw) => {
    const row = record(raw, 'Android save/retry observation');
    assert(typeof row.viewId === 'string' && row.viewId.length > 0);
    assert(typeof row.screenshotPath === 'string' && row.screenshotPath.length > 0);
    assert(typeof row.hierarchyPath === 'string' && row.hierarchyPath.length > 0);
    return {
      viewId: row.viewId,
      screenshotPath: row.screenshotPath,
      hierarchyPath: row.hierarchyPath,
    };
  });
}

function requireCaptureIdentity(capture: Capture, captureRunId: string): void {
  assert.equal(capture.kind, 'private-owned-native-save-retry-execution-not-public-receipt');
  assert.equal(capture.mode, 'integration');
  assert.equal(capture.platform, 'android');
  assert.equal(capture.charter, 'save-retry');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  assert.match(captureRunId, runId);
  assert.match(capture.backend?.runId ?? '', runId);
  assert(
    typeof capture.device?.serial === 'string' && /^emulator-\d+$/.test(capture.device.serial),
    'Android save/retry capture lacks its owned emulator identity',
  );
}

async function requireBuildMetadata(
  root: string,
  build: Record<string, unknown>,
  allowExternalBinaryPath = false,
): Promise<void> {
  assert.equal(build.appId, 'com.edufelip.mychampions.dev');
  assert(typeof build.binaryPath === 'string' && path.isAbsolute(build.binaryPath));
  assert.equal(
    build.profile,
    'Metro-attached devDebug arm64; no app-domain instrumentation; optional separately bound read-only input reader; not bundled release qualification',
  );
  assert(typeof build.apiOrigin === 'string' && typeof build.metroOrigin === 'string');
  requireIntegratedLoopbackOrigin(build.apiOrigin);
  requireIntegratedLoopbackOrigin(build.metroOrigin);
  assert.notEqual(build.apiOrigin, build.metroOrigin, 'Native Android endpoints collide');
  assert(typeof build.binaryHash === 'string' && /^[a-f0-9]{64}$/.test(build.binaryHash));
  const binaryPath = await realpath(build.binaryPath);
  assert.equal(binaryPath, path.resolve(build.binaryPath));
  if (!allowExternalBinaryPath)
    assert(
      binaryPath.startsWith(root + path.sep),
      'Android build escaped its private capture root',
    );
  const bytes = await readFile(binaryPath);
  assert.equal(sha256(bytes), build.binaryHash, 'Android runtime binary changed');
}

async function requireSourceAndHelpers(repositoryRoot: string, capture: Capture): Promise<void> {
  assert.deepEqual(capture.source, capture.sourceAfter, 'Android capture source changed');
  assert.deepEqual(
    capture.source,
    await androidSourceIdentity(repositoryRoot),
    'Android save/retry source identity is stale',
  );
  assert(Array.isArray(capture.helperInputsBefore) && capture.helperInputsBefore.length > 0);
  assert.deepEqual(capture.helperInputsBefore, capture.helperInputsAfter);
  const required = new Set([
    'scripts/testing/capture-android-testability.ts',
    'scripts/testing/native-save-retry-observation.ts',
    'scripts/testing/native-save-retry-attempt-binding.ts',
    'scripts/testing/native-view-evidence.ts',
    'scripts/testing/run-android-save-retry-attempt.ts',
    'scripts/testing/native-android-save-retry-public-evidence.ts',
  ]);
  for (const raw of capture.helperInputsBefore) {
    const helper = record(raw, 'Android helper input');
    assert(typeof helper.path === 'string' && typeof helper.sha256 === 'string');
    required.delete(helper.path);
    const source = assertArtifactPath(repositoryRoot, helper.path);
    assert.equal(await realpath(source), source);
    const info = await lstat(source);
    assert(info.isFile() && !info.isSymbolicLink());
    assert.equal(sha256(await readFile(source)), helper.sha256);
  }
  assert.equal(
    required.size,
    0,
    `Android save/retry helper closure is incomplete: ${[...required].join(',')}`,
  );
}

function requireRuntimeMetadata(
  value: unknown,
  binding: NativeSaveRetryAttemptBinding,
  capture: Capture,
) {
  const metadata = record(value, 'Android save/retry runtime metadata');
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.kind, 'private-android-save-retry-runtime-metadata-not-public-receipt');
  assert.equal(metadata.requestedRunId, binding.requestedRunId);
  assert.equal(metadata.requestedAttemptId, binding.requestedAttemptId);
  assert.equal(metadata.captureRunId, binding.captureRunId);
  assert.equal(metadata.backendRunId, binding.backendRunId);
  assert.equal(metadata.backendAttemptId, binding.backendAttemptId);
  assert.equal(metadata.faultAttemptId, binding.faultAttemptId);
  assert.deepEqual(metadata.selection, binding.selection);
  assert.deepEqual(metadata.assertionContract, binding.assertionContract);
  assert.deepEqual(metadata.preparation, capture.saveRetryPreparation);
  assert.equal(metadata.publicNativePassingCases, 0);
}

function parseBindings(value: unknown): AndroidSaveRetryAssertionBinding[] {
  return array(value, 'Android save/retry assertion bindings').map((raw) => {
    const row = record(raw, 'Android save/retry assertion binding');
    assert(typeof row.id === 'string' && Array.isArray(row.requirementRefs));
    assert(Array.isArray(row.evidencePaths));
    return {
      id: row.id,
      requirementRefs: row.requirementRefs as string[],
      evidencePaths: row.evidencePaths as string[],
    };
  });
}

function originalReferences(assertionId: string, kind: 'ui' | 'api' | 'sql'): string[] {
  const ui: Record<string, string[]> = {
    'NAT-save-retry-error': ['save-error.png', 'save-error-hierarchy.json'],
    'NAT-save-retry-retained-draft': ['save-retained.png', 'save-retained-hierarchy.json'],
    'NAT-save-retry-final-save': ['save-retry-library.png', 'save-retry-library-hierarchy.json'],
    'NAT-save-retry-reopen': ['save-retry-reopened.png', 'save-retry-reopened-hierarchy.json'],
  };
  const sql: Record<string, string[]> = {
    'NAT-save-retry-retained-draft': [
      'save-retry-before.private.json',
      'save-retry-after-failure.private.json',
    ],
    'NAT-save-retry-final-save': [
      'save-retry-before.private.json',
      'save-retry-after-success.private.json',
    ],
    'NAT-save-retry-reopen': [
      'save-retry-after-success.private.json',
      'save-retry-after-reopen.private.json',
    ],
    'NAT-save-retry-unrelated-state': [...nativeSaveRetrySnapshotPaths],
  };
  return kind === 'ui'
    ? (ui[assertionId] ?? [])
    : kind === 'sql'
      ? (sql[assertionId] ?? [])
      : kind === 'api'
        ? ['transport-observations.private.json']
        : [];
}

function expectedBindings(selection: NativePilotSelection, attemptId: string) {
  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    nativeSaveRetryAssertionIds,
  );
  return rows.map((row) => ({
    id: row.id,
    requirementRefs: [...row.requirementRefs],
    evidencePaths: row.evidencePathTemplates!.map((template) =>
      template.replace('{attemptId}', attemptId),
    ),
  }));
}

async function writeRuntimeProofs(options: {
  repositoryRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  requestedRunId: string;
}): Promise<{ bindings: AndroidSaveRetryAssertionBinding[] }> {
  const root = await privateRoot(options.artifactRoot);
  const capture = json(root, 'capture.private.json') as Capture;
  requireCaptureIdentity(capture, path.basename(root));
  await requireBuildMetadata(root, capture.build);
  const fixtureRunId = capture.backend.runId;
  const binding = await readNativeSaveRetryAttemptBinding({
    repositoryRoot: options.repositoryRoot,
    artifactRoot: root,
    requestedRunId: options.requestedRunId,
    backendRunId: fixtureRunId,
    selection: options.selection,
  });
  const transport = json(root, 'transport-observations.private.json');
  validateNativeSaveRetryPreparation(
    root,
    'android',
    fixtureRunId,
    capture.saveRetryPreparation,
    transport,
    'runtime-captured',
  );
  const prep = record(capture.saveRetryPreparation, 'Android save/retry preparation');
  assert.equal(prep.faultAttemptId, binding.faultAttemptId);
  assert.equal(prep.attemptId, binding.faultAttemptId);
  await requireSourceAndHelpers(options.repositoryRoot, capture);
  requireFullAndroidTrainingCleanupEvidence(root, json(root, 'external-cleanup.private.json'));
  const rows = expectedBindings(options.selection, binding.backendAttemptId);
  const parent = assertArtifactPath(root, 'assertions');
  await mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const directory = assertArtifactPath(root, `assertions/${binding.backendAttemptId}`);
  await mkdir(directory, { mode: 0o700 });
  for (const [index, row] of rows.entries()) {
    const required = requireNativePilotAssertions(options.selection)[index];
    for (const [kindIndex, evidencePath] of row.evidencePaths.entries()) {
      const refs = originalReferences(row.id, required.evidenceKinds[kindIndex]);
      assert(refs.length > 0);
      const references = refs.map((relative) => ({
        path: relative,
        sha256: sha256(readNativeEvidence(root, relative, !relative.endsWith('.png'))),
      }));
      await writeFile(
        assertArtifactPath(root, evidencePath),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: evidenceKind,
            purpose: 'runtime',
            assertionId: row.id,
            evidenceKind: required.evidenceKinds[kindIndex],
            requirementRefs: row.requirementRefs,
            fixtureRunId,
            attemptId: binding.backendAttemptId,
            scenarioHash: options.selection.scenarioHash,
            requirementHash: options.selection.requirementHash,
            references,
            nativePassingCases: 0,
            scope:
              'prepared Android runtime save/retry proof; public receipt/finalization and engine qualification are separate',
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
    }
  }
  await requireNoCensusFailure(root);
  return { bindings: rows };
}

/** Bind exact runtime frame files to the original Android Maestro observations. */
export async function writeAndroidSaveRetryRuntimeFrames(artifactRoot: string): Promise<void> {
  const root = await privateRoot(artifactRoot);
  const capture = json(root, 'capture.private.json') as Capture;
  requireCaptureIdentity(capture, path.basename(root));
  const observations = runtimeFrameEntries(capture.observations);
  const frames: ViewEvidence[] = nativeSaveRetryRuntimeFrames.map(([label, viewId]) => {
    const matches = observations.filter(
      (row) =>
        row.viewId === viewId &&
        row.screenshotPath === `${label}.png` &&
        row.hierarchyPath === `${label}-hierarchy.json`,
    );
    assert.equal(matches.length, 1, `Android runtime frame ${label} was not captured exactly once`);
    const screenshot = readNativeEvidence(root, `${label}.png`);
    const hierarchy = readNativeEvidence(root, `${label}-hierarchy.json`, true);
    const frame = {
      viewId,
      screenshotPath: `${label}.png`,
      hierarchyPath: `${label}-hierarchy.json`,
      screenshotHash: sha256(screenshot),
      hierarchyHash: sha256(hierarchy),
      reviewed: false,
    };
    validateNativeRuntimeFrameFiles(root, [frame], [frame.viewId], 'android');
    return frame;
  });
  await writeFile(
    assertArtifactPath(root, nativeSaveRetryRuntimeFramesPath),
    JSON.stringify(frames, null, 2),
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
}

async function collectFiles(
  repositoryRoot: string,
  captureRoot: string,
  selection: NativePilotSelection,
  requestedRunId: string,
  fixtureRunId: string,
): Promise<{
  binding: NativeSaveRetryAttemptBinding;
  capture: Capture;
  bindings: AndroidSaveRetryAssertionBinding[];
  files: Map<string, CollectedFile>;
}> {
  const root = await privateRoot(captureRoot);
  const capture = json(root, 'capture.private.json') as Capture;
  requireCaptureIdentity(capture, path.basename(root));
  assert.equal(capture.backend.runId, fixtureRunId);
  await requireBuildMetadata(root, capture.build);
  await requireSourceAndHelpers(repositoryRoot, capture);
  validateNativeSaveRetryPreparation(
    root,
    'android',
    fixtureRunId,
    capture.saveRetryPreparation,
    json(root, 'transport-observations.private.json'),
    'runtime-captured',
  );
  await requireNoCensusFailure(root);
  const binding = await readNativeSaveRetryAttemptBinding({
    repositoryRoot,
    artifactRoot: root,
    requestedRunId,
    backendRunId: fixtureRunId,
    selection,
  });
  const bindings = parseBindings(
    record(json(root, 'runtime-adapter.private.json'), 'Android adapter').assertionBindings,
  );
  assert.deepEqual(bindings, expectedBindings(selection, binding.backendAttemptId));
  const adapter = record(json(root, 'runtime-adapter.private.json'), 'Android adapter');
  assert.equal(adapter.kind, 'private-owned-android-save-retry-attempt-not-public-receipt');
  assert.equal(adapter.requestedRunId, binding.requestedRunId);
  assert.equal(adapter.requestedAttemptId, binding.requestedAttemptId);
  assert.equal(adapter.captureRunId, binding.captureRunId);
  assert.equal(adapter.backendRunId, binding.backendRunId);
  assert.equal(adapter.backendAttemptId, binding.backendAttemptId);
  assert.equal(adapter.faultAttemptId, binding.faultAttemptId);
  assert.equal(adapter.captureExitCode, 0);
  assert.equal(adapter.childExitCode, 0);
  assert.equal(adapter.childSignal, null);
  assert.equal(adapter.childClassification, 'completed');
  assert.equal(adapter.captureResult, 'observed');
  assert.equal(adapter.captureCleanup, 'cleaned');
  assert.equal(adapter.callbackInvocations, 1);
  assert.equal(adapter.callbackCompleted, true);
  assert.equal(adapter.assertionBindingsRetired, false);
  assert.equal(adapter.externalCleanupResult, 'passed');
  assert.equal(adapter.verificationResult, 'passed');
  assert.equal(adapter.nativePassingCases, 0);
  assert.deepEqual(adapter.censusFailures, []);
  assert.deepEqual(adapter.outputFailures, []);
  assert.deepEqual(
    requireSuccessfulNativeCommandDiagnostics(adapter.commandDiagnostics),
    requireSuccessfulNativeCommandDiagnostics(capture.commandExecutions),
  );
  requireRuntimeMetadata(json(root, runtimeMetadataPath), binding, capture);
  requireFullAndroidTrainingCleanupEvidence(root, json(root, 'external-cleanup.private.json'));
  const files = new Map<string, CollectedFile>();
  const add = (relative: string) => {
    const observation = readNativeEvidenceObservation(root, relative, !relative.endsWith('.png'));
    const file: CollectedFile = {
      bytes: observation.bytes,
      mode: observation.identity.mode & 0o777,
      originalIdentity: observation.identity,
    };
    const prior = files.get(relative);
    if (prior) assertSameCollectedFile(prior, file, relative);
    files.set(relative, file);
  };
  for (const relative of [
    saveRetryAttemptBindingPath,
    runtimeMetadataPath,
    'capture.private.json',
    'runtime-adapter.private.json',
    'external-cleanup.private.json',
    'transport-observations.private.json',
    ...nativeSaveRetrySnapshotPaths,
    nativeSaveRetryRuntimeFramesPath,
    ...nativeSaveRetryRuntimeFrames.flatMap(([label]) => [
      `${label}.png`,
      `${label}-hierarchy.json`,
    ]),
  ])
    add(relative);
  for (const row of bindings)
    for (const relative of row.evidencePaths) {
      add(relative);
      const proof = record(
        JSON.parse(fileBytes(files.get(relative)!).toString()),
        'Android assertion proof',
      );
      assert.equal(proof.kind, evidenceKind);
      assert.equal(proof.nativePassingCases, 0);
      for (const reference of array(proof.references, 'Android assertion references')) {
        const ref = record(reference, 'Android assertion reference');
        assert(typeof ref.path === 'string' && typeof ref.sha256 === 'string');
        add(ref.path);
        assert.equal(sha256(fileBytes(files.get(ref.path)!)), ref.sha256);
      }
    }
  // Original command paths remain part of the private receipt. Copy them only
  // after checking their producer root and private regular-file metadata.
  for (const raw of array(capture.commandExecutions, 'Android command executions')) {
    const command = record(raw, 'Android command execution');
    for (const key of ['logPath', 'ownershipPath', 'stdoutPath']) {
      const value = command[key];
      if (value === null || value === undefined) continue;
      assert(typeof value === 'string' && path.isAbsolute(value));
      const relative = path.relative(root, value);
      assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      const info = await lstat(value);
      assert(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid?.());
      assert.equal(info.mode & 0o777, 0o600);
      assert.equal(info.nlink, 1);
      add(relative);
    }
  }
  // Source files are copied as source provenance, never as an assertion result.
  for (const raw of array(capture.helperInputsBefore, 'Android helper inputs')) {
    const helper = record(raw, 'Android helper input');
    const relative = helper.path as string;
    const bytes = await readFile(assertArtifactPath(repositoryRoot, relative));
    assert.equal(sha256(bytes), helper.sha256);
    const staged = `source/${relative}`;
    const sourceFile: CollectedFile = { bytes, mode: 0o600, originalIdentity: null };
    const prior = files.get(staged);
    if (prior) assertSameCollectedFile(prior, sourceFile, staged);
    files.set(staged, sourceFile);
  }
  await requireNoCensusFailure(root);
  return { binding, capture, bindings, files };
}

async function writeTree(
  outputRoot: string,
  prefix: string,
  files: Map<string, CollectedFile>,
  binding: NativeSaveRetryAttemptBinding,
) {
  const parent = assertArtifactPath(outputRoot, 'evidence');
  await mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const directory = assertArtifactPath(outputRoot, prefix);
  await mkdir(directory, { mode: 0o700 });
  for (const [relative, file] of files) {
    const destination = assertArtifactPath(directory, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, file.bytes, { flag: 'wx', mode: file.mode });
    // The native entrypoints run with umask 077. Establish the reviewed public
    // PNG mode explicitly after exclusive creation; private JSON stays 0600.
    if (file.mode === 0o644) await chmod(destination, 0o644);
    const info = await lstat(destination);
    assert.equal(info.mode & 0o777, file.mode, `Copied mode changed: ${relative}`);
    assert.equal(sha256(await readFile(destination)), sha256(file.bytes));
  }
  const manifestPath = `${prefix}/copy-manifest.private.json`;
  const manifest = Buffer.from(
    JSON.stringify(
      {
        schemaVersion: 2,
        kind: 'private Android native save/retry evidence copy, not public outcome',
        requestedRunId: binding.requestedRunId,
        captureRunId: binding.captureRunId,
        fixtureRunId: binding.backendRunId,
        nativePassingCases: 0,
        files: [...files].map(([file, value]) => ({
          path: file,
          sizeBytes: value.bytes.length,
          sha256: sha256(value.bytes),
          mode: value.mode,
          originalIdentity: value.originalIdentity,
        })),
      },
      null,
      2,
    ),
  );
  await writeFile(assertArtifactPath(outputRoot, manifestPath), manifest, {
    flag: 'wx',
    mode: 0o600,
  });
  return { path: manifestPath, sha256: sha256(manifest) };
}

export async function prepareAndroidSaveRetryPilotEvidence(options: {
  repositoryRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  requestedRunId: string;
}) {
  const root = await privateRoot(options.artifactRoot);
  const capture = json(root, 'capture.private.json') as Capture;
  requireCaptureIdentity(capture, path.basename(root));
  const fixtureRunId = capture.backend.runId;
  const binding = await readNativeSaveRetryAttemptBinding({
    repositoryRoot: options.repositoryRoot,
    artifactRoot: root,
    requestedRunId: options.requestedRunId,
    backendRunId: fixtureRunId,
    selection: options.selection,
  });
  const result = await writeRuntimeProofs(options);
  assert.deepEqual(result.bindings, expectedBindings(options.selection, binding.backendAttemptId));
  return result;
}

export async function stageNativeAndroidSaveRetryPublicEvidence(options: {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  bindings: AndroidSaveRetryAssertionBinding[];
}) {
  const captureRoot = await privateRoot(options.captureRoot);
  const outputRoot = await privateRoot(options.outputRoot);
  assert.match(options.requestedRunId, runId);
  assert.match(options.fixtureRunId, runId);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.notEqual(captureRoot, outputRoot);
  requireNativeSaveRetryAssertionContract(options.selection);
  const original = await collectFiles(
    options.repositoryRoot,
    captureRoot,
    options.selection,
    options.requestedRunId,
    options.fixtureRunId,
  );
  assert.deepEqual(original.bindings, options.bindings);
  const manifest = await writeTree(
    outputRoot,
    `evidence/${original.binding.captureRunId}`,
    original.files,
    original.binding,
  );
  const stagedRoot = path.join(outputRoot, `evidence/${original.binding.captureRunId}`);
  await readNativeSaveRetryAttemptBinding({
    repositoryRoot: options.repositoryRoot,
    artifactRoot: stagedRoot,
    requestedRunId: options.requestedRunId,
    backendRunId: options.fixtureRunId,
    selection: options.selection,
  });
  return {
    copyManifest: manifest,
    assertions: original.bindings.map((row) => ({
      id: row.id,
      requirementRefs: row.requirementRefs,
      outcome: 'passed' as const,
      evidencePaths: row.evidencePaths.map(
        (relative) => `evidence/${original.binding.captureRunId}/${relative}`,
      ),
    })),
    artifacts: [
      manifest.path,
      ...[
        saveRetryAttemptBindingPath,
        runtimeMetadataPath,
        'capture.private.json',
        'runtime-adapter.private.json',
        'external-cleanup.private.json',
        'transport-observations.private.json',
        nativeSaveRetryRuntimeFramesPath,
      ].map((relative) => `evidence/${original.binding.captureRunId}/${relative}`),
    ],
    nativePassingCases: 0 as const,
  };
}

export async function verifyStagedNativeAndroidSaveRetryEvidence(options: {
  repositoryRoot: string;
  selection: NativePilotSelection;
  outputRoot: string;
  copyManifest: { path: string; sha256: string };
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  captureRoot?: string;
}) {
  const outputRoot = await privateRoot(options.outputRoot);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  const prefix = `evidence/${options.captureRunId}`;
  assert.equal(options.copyManifest.path, `${prefix}/copy-manifest.private.json`);
  const manifestBytes = readNativeEvidence(outputRoot, options.copyManifest.path, true);
  assert.equal(sha256(manifestBytes), options.copyManifest.sha256);
  const manifest = record(JSON.parse(manifestBytes.toString()), 'Android save/retry copy manifest');
  assert.equal(
    manifest.kind,
    'private Android native save/retry evidence copy, not public outcome',
  );
  assert.equal(manifest.requestedRunId, options.requestedRunId);
  assert.equal(manifest.captureRunId, options.captureRunId);
  assert.equal(manifest.fixtureRunId, options.fixtureRunId);
  assert.equal(manifest.nativePassingCases, 0);
  assert.equal(manifest.schemaVersion, 2);
  const rows = array(manifest.files, 'Android staged files').map((raw) => {
    const row = record(raw, 'Android staged file');
    assert(
      typeof row.path === 'string' &&
        !path.isAbsolute(row.path) &&
        !row.path.split('/').includes('..') &&
        typeof row.sizeBytes === 'number' &&
        Number.isSafeInteger(row.sizeBytes) &&
        row.sizeBytes > 0 &&
        typeof row.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(row.sha256) &&
        typeof row.mode === 'number' &&
        Number.isSafeInteger(row.mode) &&
        (row.mode === 0o600 || row.mode === 0o644) &&
        (row.mode === expectedMode(row.path) ||
          // Owned Android screenshots are written private (0600); stricter is fine.
          (row.path.endsWith('.png') && row.mode === 0o600) ||
          row.path.startsWith('source/')),
    );
    const originalIdentity = parseOriginalIdentity(
      row.originalIdentity,
      `Android original identity for ${row.path}`,
    );
    if (!row.path.startsWith('source/'))
      assert(originalIdentity, `Android original identity is missing for ${row.path}`);
    const rowPath = row.path;
    const rowSizeBytes = row.sizeBytes;
    const rowSha256 = row.sha256;
    const rowMode = row.mode;
    if (originalIdentity) {
      assert.equal(originalIdentity.nlink, 1, `Android original link count changed: ${rowPath}`);
      assert.equal(
        originalIdentity.size,
        rowSizeBytes,
        `Android original size changed: ${rowPath}`,
      );
      assert.equal(
        originalIdentity.mode & 0o777,
        rowMode,
        `Android original mode changed: ${rowPath}`,
      );
      assert.equal(
        originalIdentity.uid,
        process.getuid?.(),
        `Android original owner changed: ${rowPath}`,
      );
    }
    return {
      path: rowPath,
      sizeBytes: rowSizeBytes,
      sha256: rowSha256,
      mode: rowMode,
      originalIdentity,
    };
  });
  assert.equal(new Set(rows.map((row) => row.path)).size, rows.length);
  const requiredFiles = [
    saveRetryAttemptBindingPath,
    runtimeMetadataPath,
    'capture.private.json',
    'runtime-adapter.private.json',
    'external-cleanup.private.json',
    'transport-observations.private.json',
    ...nativeSaveRetrySnapshotPaths,
    nativeSaveRetryRuntimeFramesPath,
    ...nativeSaveRetryRuntimeFrames.flatMap(([label]) => [
      `${label}.png`,
      `${label}-hierarchy.json`,
    ]),
  ];
  for (const required of requiredFiles)
    assert(
      rows.some((row) => row.path === required),
      `Android staged evidence omits ${required}`,
    );
  const stagedRoot = path.join(outputRoot, prefix);
  await privateRoot(stagedRoot);
  const rowByPath = new Map(rows.map((row) => [row.path, row]));
  const listFiles = async (root: string, prefix = ''): Promise<string[]> => {
    const result: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(root, entry.name);
      assert.equal(await realpath(absolute), absolute, 'Staged evidence contains a symlink');
      const info = await lstat(absolute);
      if (entry.isDirectory()) {
        assert.equal(info.mode & 0o777, 0o700, 'Staged evidence directory is not private');
        result.push(...(await listFiles(absolute, relative)));
      } else {
        assert(entry.isFile(), 'Staged evidence contains a non-regular entry');
        assert.equal(
          info.mode & 0o777,
          rowByPath.get(relative)?.mode ?? 0o600,
          'Staged evidence file mode differs from its original contract',
        );
        result.push(relative);
      }
    }
    return result.sort();
  };
  assert.deepEqual(
    await listFiles(stagedRoot),
    [...rows.map((row) => row.path), 'copy-manifest.private.json'].sort(),
  );
  for (const row of rows) {
    const info = await lstat(path.join(stagedRoot, row.path));
    assert.equal(info.mode & 0o777, row.mode);
    const bytes = readNativeEvidence(stagedRoot, row.path, row.mode === 0o600);
    assert.equal(bytes.length, row.sizeBytes);
    assert.equal(sha256(bytes), row.sha256);
  }
  const capture = json(stagedRoot, 'capture.private.json') as Capture;
  requireCaptureIdentity(capture, options.captureRunId);
  assert.equal(capture.backend.runId, options.fixtureRunId);
  const stagedAdapter = record(json(stagedRoot, 'runtime-adapter.private.json'), 'Android adapter');
  assert.equal(stagedAdapter.kind, 'private-owned-android-save-retry-attempt-not-public-receipt');
  assert.equal(stagedAdapter.requestedRunId, options.requestedRunId);
  assert.equal(stagedAdapter.captureRunId, options.captureRunId);
  assert.equal(stagedAdapter.backendRunId, options.fixtureRunId);
  assert.equal(stagedAdapter.callbackInvocations, 1);
  assert.equal(stagedAdapter.callbackCompleted, true);
  assert.equal(stagedAdapter.assertionBindingsRetired, false);
  assert.equal(stagedAdapter.externalCleanupResult, 'passed');
  assert.equal(stagedAdapter.verificationResult, 'passed');
  assert.equal(stagedAdapter.nativePassingCases, 0);
  assert.deepEqual(stagedAdapter.censusFailures, []);
  assert.deepEqual(stagedAdapter.outputFailures, []);
  assert.deepEqual(
    requireSuccessfulNativeCommandDiagnostics(stagedAdapter.commandDiagnostics),
    requireSuccessfulNativeCommandDiagnostics(capture.commandExecutions),
  );
  const binding = await readNativeSaveRetryAttemptBinding({
    repositoryRoot: options.repositoryRoot,
    artifactRoot: stagedRoot,
    requestedRunId: options.requestedRunId,
    backendRunId: options.fixtureRunId,
    selection: options.selection,
  });
  assert.equal(binding.captureRunId, options.captureRunId);
  await requireBuildMetadata(stagedRoot, capture.build, true);
  requireRuntimeMetadata(json(stagedRoot, runtimeMetadataPath), binding, capture);
  requireFullAndroidTrainingCleanupEvidence(
    stagedRoot,
    json(stagedRoot, 'external-cleanup.private.json'),
  );
  validateNativeSaveRetryPreparation(
    stagedRoot,
    'android',
    options.fixtureRunId,
    capture.saveRetryPreparation,
    json(stagedRoot, 'transport-observations.private.json'),
    'runtime-captured',
  );
  if (options.captureRoot !== undefined) {
    const original = await collectFiles(
      options.repositoryRoot,
      options.captureRoot,
      options.selection,
      options.requestedRunId,
      options.fixtureRunId,
    );
    for (const row of rows) {
      const originalFile = original.files.get(row.path);
      assert(originalFile, `Android staged file has no original: ${row.path}`);
      assert.equal(originalFile.mode, row.mode, `Android original mode changed: ${row.path}`);
      assert.equal(
        sha256(fileBytes(originalFile)),
        row.sha256,
        `Android staged file differs from original: ${row.path}`,
      );
      assert.deepEqual(
        originalFile.originalIdentity,
        row.originalIdentity,
        `Android original identity changed before final verification: ${row.path}`,
      );
    }
  }
  await requireNoCensusFailure(outputRoot);
}

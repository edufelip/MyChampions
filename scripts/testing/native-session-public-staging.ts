import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeSessionAssertionIds, requireNativePilotAssertions } from './native-pilot-contract';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeSessionPublicDependencyResult } from './native-session-public-dependency';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseStagedManifest(bytes: Buffer): NativeSessionStagedManifest {
  const value: unknown = JSON.parse(bytes.toString());
  assert(isRecord(value));
  assert(value.kind === 'private-ios-session-dependency-copy-not-public-outcome');
  assert(typeof value.requestedRunId === 'string');
  assert(typeof value.captureRunId === 'string');
  assert(value.status === 'validated-source-only');
  assert(value.nativePassingCases === 0);
  assert(value.publicPassingCases === 0);
  assert(value.publicPromotionEligible === false);
  const rawAssertionIds: unknown = value.assertionIds;
  assert(Array.isArray(rawAssertionIds));
  const assertionIds = rawAssertionIds.filter(
    (row: unknown): row is string => typeof row === 'string',
  );
  assert.equal(assertionIds.length, rawAssertionIds.length);
  const rawFilesValue: unknown = value.files;
  assert(Array.isArray(rawFilesValue));
  const rawFiles: unknown[] = rawFilesValue as unknown[];
  const files = rawFiles.map((row: unknown) => {
    assert(isRecord(row));
    assert(typeof row.path === 'string');
    assert(typeof row.sha256 === 'string');
    assert(typeof row.bytes === 'number');
    return { path: row.path, sha256: row.sha256, bytes: row.bytes };
  });
  return {
    kind: value.kind,
    requestedRunId: value.requestedRunId,
    captureRunId: value.captureRunId,
    assertionIds,
    status: value.status,
    nativePassingCases: value.nativePassingCases,
    publicPassingCases: value.publicPassingCases,
    publicPromotionEligible: value.publicPromotionEligible,
    files,
  };
}

export type NativeSessionStagedManifest = {
  kind: 'private-ios-session-dependency-copy-not-public-outcome';
  requestedRunId: string;
  captureRunId: string;
  assertionIds: readonly string[];
  status: 'validated-source-only';
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  files: readonly { path: string; sha256: string; bytes: number }[];
};

export type NativeSessionStageResult = {
  copyManifest: { path: string; sha256: string };
  artifacts: readonly string[];
  assertionIds: readonly string[];
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
};

async function privateRoot(value: string, label: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(canonical);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return canonical;
}

function relativeFile(value: string, label: string): string {
  assert(value.length > 0, `${label} is empty`);
  assert(!path.isAbsolute(value), `${label} must be relative`);
  assert(!value.includes('\\'), `${label} contains a backslash`);
  assert(!value.split('/').includes('..'), `${label} escapes its root`);
  return value;
}

function expectedPaths(dependency: NativeSessionPublicDependencyResult): string[] {
  return [
    ...dependency.files.framePaths,
    dependency.files.startupDiagnosticFramePath,
    ...dependency.files.profilePaths,
    ...dependency.files.domainPaths,
    dependency.files.transportPath,
    dependency.files.terminalTransportPath,
    ...(dependency.files.postTapDiagnosticPaths ?? []),
    'capture.private.json',
    'external-cleanup.private.json',
  ].map((value, index) => relativeFile(value, `session evidence path ${index}`));
}

function assertSessionSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-session-ios',
    mode: 'integration',
  });
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    nativeSessionAssertionIds,
  );
}

/** Copy validated private session proof while preserving the source-only boundary. */
export async function stageNativeSessionPublicDependency(options: {
  dependency: NativeSessionPublicDependencyResult;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
}): Promise<NativeSessionStageResult> {
  const captureRoot = await privateRoot(options.captureRoot, 'Session capture root');
  const outputRoot = await privateRoot(options.outputRoot, 'Session output root');
  assert.match(options.requestedRunId, /^[a-f0-9]{24}$/);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.notEqual(captureRoot, outputRoot);
  assertSessionSelection(options.selection);
  assert.equal(options.dependency.status, 'validated-source-only');
  assert.equal(options.dependency.nativePassingCases, 0);
  assert.equal(options.dependency.publicPassingCases, 0);
  assert.equal(options.dependency.publicPromotionEligible, false);
  assert.deepEqual(options.dependency.assertionIds, nativeSessionAssertionIds);
  assert.equal(
    options.dependency.files.postTapDiagnosticPaths?.length,
    3,
    'Session post-tap diagnostic evidence is required before staging',
  );
  const captureRunId = options.dependency.captureRunId;
  assert.match(captureRunId, /^[a-f0-9]{24}$/);
  const sourcePaths = [...new Set(expectedPaths(options.dependency))].sort();
  const files = new Map<string, Buffer>();
  for (const relative of sourcePaths) {
    const bytes = await readFile(assertArtifactPath(captureRoot, relative));
    files.set(relative, bytes);
  }
  const prefix = `evidence/${captureRunId}`;
  await mkdir(assertArtifactPath(outputRoot, prefix), { recursive: true, mode: 0o700 });
  const staged = [] as { path: string; sha256: string; bytes: number }[];
  for (const [relative, bytes] of files) {
    const destination = assertArtifactPath(outputRoot, `${prefix}/${relative}`);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    const copied = await readFile(destination);
    assert.deepEqual(copied, bytes, `Staged session evidence changed: ${relative}`);
    staged.push({ path: relative, sha256: hash(bytes), bytes: bytes.length });
  }
  const manifest: NativeSessionStagedManifest = {
    kind: 'private-ios-session-dependency-copy-not-public-outcome',
    requestedRunId: options.requestedRunId,
    captureRunId,
    assertionIds: [...nativeSessionAssertionIds],
    status: 'validated-source-only',
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    files: staged,
  };
  const manifestPath = `${prefix}/copy-manifest.private.json`;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(assertArtifactPath(outputRoot, manifestPath), manifestBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  const manifestRead = await readFile(assertArtifactPath(outputRoot, manifestPath));
  assert.deepEqual(manifestRead, manifestBytes, 'Session staging manifest changed during write');
  return {
    copyManifest: { path: manifestPath, sha256: hash(manifestBytes) },
    artifacts: [manifestPath, ...staged.map((row) => `${prefix}/${row.path}`)],
    assertionIds: [...nativeSessionAssertionIds],
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
  };
}

/** Re-read every staged byte before the outer runner writes its blocked receipt. */
export async function verifyStagedNativeSessionDependency(options: {
  outputRoot: string;
  copyManifest: { path: string; sha256: string };
  requestedRunId: string;
  captureRunId: string;
}): Promise<void> {
  const outputRoot = await privateRoot(options.outputRoot, 'Session output root');
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  const prefix = `evidence/${options.captureRunId}`;
  assert.equal(options.copyManifest.path, `${prefix}/copy-manifest.private.json`);
  const manifestPath = assertArtifactPath(outputRoot, options.copyManifest.path);
  const manifestBytes = await readFile(manifestPath);
  assert.equal(
    hash(manifestBytes),
    options.copyManifest.sha256,
    'Session staging manifest changed',
  );
  const manifest = parseStagedManifest(manifestBytes);
  assert.equal(manifest.kind, 'private-ios-session-dependency-copy-not-public-outcome');
  assert.equal(manifest.requestedRunId, options.requestedRunId);
  assert.equal(manifest.captureRunId, options.captureRunId);
  assert.deepEqual(manifest.assertionIds, nativeSessionAssertionIds);
  assert.equal(manifest.status, 'validated-source-only');
  assert.equal(manifest.nativePassingCases, 0);
  assert.equal(manifest.publicPassingCases, 0);
  assert.equal(manifest.publicPromotionEligible, false);
  const stagedFiles = manifest.files as readonly {
    path: string;
    sha256: string;
    bytes: number;
  }[];
  assert(stagedFiles.length > 0);
  assert.equal(new Set(stagedFiles.map((row) => row.path)).size, stagedFiles.length);
  for (const row of stagedFiles) {
    relativeFile(row.path, 'staged session path');
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(row.bytes) && row.bytes > 0);
    const bytes = await readFile(assertArtifactPath(outputRoot, `${prefix}/${row.path}`));
    assert.equal(bytes.length, row.bytes, `Staged session byte count changed: ${row.path}`);
    assert.equal(hash(bytes), row.sha256, `Staged session hash changed: ${row.path}`);
  }
  let publicReceiptPresent = true;
  try {
    await readFile(path.join(outputRoot, 'receipt.json'));
  } catch (error) {
    publicReceiptPresent = (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  assert.equal(publicReceiptPresent, false, 'Source-only staging cannot coexist with receipt.json');
}

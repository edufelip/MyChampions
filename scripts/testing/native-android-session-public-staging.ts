import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  androidSessionPublicAssertionIds,
  androidSessionPublicSelection,
  type AndroidSessionPublicDependencyResult,
} from './native-android-session-public-contract';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const id = /^[a-f0-9]{24}$/;

export type AndroidSessionStagedManifest = {
  kind: 'private-android-session-dependency-copy-not-public-outcome';
  platform: 'android';
  engine: 'maestro';
  requestedRunId: string;
  captureRunId: string;
  assertionIds: readonly string[];
  status: 'validated-source-only';
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  selectionBinding: AndroidSessionSelectionBinding;
  selectionBindingSha256: string;
  files: readonly AndroidSessionStagedFile[];
};

export type AndroidSessionStageResult = {
  copyManifest: { path: string; sha256: string };
  artifacts: readonly string[];
  assertionIds: readonly string[];
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
  selectionBinding: AndroidSessionSelectionBinding;
};

export type AndroidSessionSelectionBinding = {
  arguments: NativePilotSelection['arguments'];
  scenario: NativePilotSelection['scenario'];
  scenarioHash: string;
  requirementHash: string;
  assertionIds: readonly string[];
};

/** Exact producer stable-reader receipt fields required for every staged file. */
export type AndroidSessionProducerReceipt = {
  path: string;
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: number;
  verification: string;
  /** Preserved when the accepted producer stable reader emitted it. */
  kind?: string;
  /** Preserved for frame receipts so a path cannot change evidence meaning. */
  contentKind?: string;
};

export type AndroidSessionStagedFile = {
  path: string;
  sha256: string;
  bytes: number;
  sourceReceipt: AndroidSessionProducerReceipt;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function privateRoot(value: string, label: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(canonical);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return canonical;
}

async function privateDirectory(value: string, label: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(canonical);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return canonical;
}

function relativeFile(value: string, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is empty`);
  assert(!path.isAbsolute(value), `${label} must be relative`);
  assert(!value.includes('\\'), `${label} contains a backslash`);
  assert(!value.split('/').includes('..'), `${label} escapes its root`);
  assert(!value.includes('\0'), `${label} contains NUL`);
  return value;
}

export function requiredAndroidSessionBundlePaths(
  dependency: AndroidSessionPublicDependencyResult,
): readonly string[] {
  assert.equal(dependency.assertionIds.length, androidSessionPublicAssertionIds.length);
  assert.deepEqual(dependency.assertionIds, androidSessionPublicAssertionIds);
  assert.equal(
    dependency.files.framePaths.length,
    30,
    'Android session frame bundle is incomplete',
  );
  assert.equal(
    dependency.files.profilePaths.length,
    4,
    'Android session profile checkpoint bundle is incomplete',
  );
  assert.equal(
    dependency.files.domainPaths.length,
    4,
    'Android session domain checkpoint bundle is incomplete',
  );
  assert(dependency.files.transportPath.length > 0, 'Android transport path is missing');
  assert(
    dependency.files.nativeAuthIdentitiesPath.length > 0,
    'Android native auth path is missing',
  );
  assert(dependency.files.sqlPaths.length > 0, 'Android SQL bundle is empty');
  const values = [
    ...dependency.files.framePaths,
    ...dependency.files.profilePaths,
    ...dependency.files.domainPaths,
    dependency.files.transportPath,
    dependency.files.nativeAuthIdentitiesPath,
    ...dependency.files.sqlPaths,
    'capture.private.json',
    'external-cleanup.private.json',
  ].map((value, index) => relativeFile(value, `Android session evidence path ${index}`));
  assert.equal(new Set(values).size, values.length, 'Android session bundle paths are duplicated');
  return values.sort();
}

function requireSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, androidSessionPublicSelection);
  assert.equal(selection.scenario.id, 'SCN-session-android');
  assert.equal(selection.scenario.platform, 'android');
  assert.equal(selection.scenario.flowId, 'FLW-session');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.equal(selection.scenario.fixtureRef, 'owned-postgres:SCN-session-android:fresh-attempt');
  assert.match(selection.scenarioHash, /^[a-f0-9]{64}$/);
  assert.match(selection.requirementHash, /^[a-f0-9]{64}$/);
}

export function androidSessionSelectionBinding(
  selection: NativePilotSelection,
): AndroidSessionSelectionBinding {
  requireSelection(selection);
  return {
    arguments: structuredClone(selection.arguments),
    scenario: structuredClone(selection.scenario),
    scenarioHash: selection.scenarioHash,
    requirementHash: selection.requirementHash,
    assertionIds: [...androidSessionPublicAssertionIds],
  };
}

function selectionBindingSha256(binding: AndroidSessionSelectionBinding): string {
  return digest(Buffer.from(JSON.stringify(binding)));
}

function maxStagedBytes(relative: string): number {
  if (
    relative.startsWith('frames/') ||
    relative.endsWith('.png') ||
    relative.endsWith('-hierarchy.json') ||
    relative.endsWith('-hierarchy.stdout')
  )
    return 16 * 1024 * 1024;
  if (relative.endsWith('.stdout')) return 64 * 1024;
  if (relative.endsWith('.xml')) return 256 * 1024;
  if (relative.includes('async-storage-query')) return 256 * 1024;
  if (relative.endsWith('.db')) return 32 * 1024 * 1024;
  if (relative.startsWith('android-session-checkpoints/')) return 1 * 1024 * 1024;
  if (relative === 'transport-observations.private.json') return 1 * 1024 * 1024;
  if (relative === 'native-auth-identities.private.json') return 1 * 1024 * 1024;
  if (relative.startsWith('sql/')) return 32 * 1024 * 1024;
  if (relative === 'capture.private.json' || relative === 'external-cleanup.private.json')
    return 32 * 1024 * 1024;
  throw new Error(`Android staged path has no bounded size policy: ${relative}`);
}

function requireSelectionBinding(
  value: unknown,
  selection: NativePilotSelection,
  label = 'Android selection binding',
): AndroidSessionSelectionBinding {
  const expected = androidSessionSelectionBinding(selection);
  assert.deepEqual(value, expected, `${label} does not preserve the selected scenario`);
  return expected;
}

function receipt(value: unknown, label: string): AndroidSessionProducerReceipt {
  assert(isRecord(value), `${label} is not a producer receipt`);
  assert(typeof value.path === 'string');
  assert(Number.isSafeInteger(value.sizeBytes) && Number(value.sizeBytes) > 0);
  assert.match(String(value.sha256), /^[a-f0-9]{64}$/);
  assert(Number.isSafeInteger(value.ownerUid) && Number(value.ownerUid) > 0);
  assert.equal(value.mode, 0o600);
  assert(typeof value.verification === 'string' && value.verification.length > 0);
  return {
    path: value.path,
    sizeBytes: value.sizeBytes as number,
    sha256: value.sha256 as string,
    ownerUid: value.ownerUid as number,
    mode: value.mode,
    verification: value.verification,
    ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
    ...(typeof value.contentKind === 'string' ? { contentKind: value.contentKind } : {}),
  };
}

/** Collect only producer-emitted stable-reader receipts; never synthesize them from bytes. */
export function collectAndroidSessionProducerReceipts(
  report: Record<string, unknown>,
  additional: readonly unknown[] = [],
): readonly AndroidSessionProducerReceipt[] {
  const found = new Map<string, AndroidSessionProducerReceipt>();
  const visit = (value: unknown, label: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${label}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    if (
      typeof value.path === 'string' &&
      Object.hasOwn(value, 'sizeBytes') &&
      Object.hasOwn(value, 'sha256') &&
      Object.hasOwn(value, 'ownerUid') &&
      Object.hasOwn(value, 'mode') &&
      Object.hasOwn(value, 'verification')
    ) {
      const current = receipt(value, label);
      const prior = found.get(current.path);
      if (prior) assert.deepEqual(prior, current, `Producer receipt changed: ${current.path}`);
      else found.set(current.path, current);
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${label}.${key}`);
  };
  visit(report, 'Android capture report');
  additional.forEach((value, index) => visit(value, `Android producer receipt ${index}`));
  return [...found.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function readStableSource(
  captureRoot: string,
  expected: AndroidSessionProducerReceipt,
  afterRead?: () => void | Promise<void>,
): Promise<Buffer> {
  const relative = relativeFile(expected.path, 'Android producer receipt path');
  const target = assertArtifactPath(captureRoot, relative);
  assert.equal(await realpath(target), target, `Android source is not canonical: ${relative}`);
  const before = await lstat(target);
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1);
  assert.equal(before.uid, process.getuid?.());
  assert.equal(before.mode & 0o777, 0o600, `${relative} is not private 0600`);
  const maxBytes =
    expected.contentKind || relative.startsWith('frames/')
      ? 16 * 1024 * 1024
      : relative.startsWith('android-session-checkpoints/')
        ? 1 * 1024 * 1024
        : expected.kind === 'transport' || expected.kind === 'auth'
          ? 1 * 1024 * 1024
          : expected.kind === 'query'
            ? 256 * 1024
            : expected.kind === 'xml'
              ? 256 * 1024
              : expected.kind === 'listing'
                ? 64 * 1024
                : expected.kind === 'database' || expected.kind === 'sidecar'
                  ? 32 * 1024 * 1024
                  : 0;
  assert(maxBytes > 0, `${relative} has no supported producer receipt kind`);
  assert(before.size > 0 && before.size <= maxBytes, `${relative} exceeds its bounded source cap`);
  assert.equal(before.size, expected.sizeBytes, `${relative} source byte count changed`);
  assert.equal(expected.ownerUid, before.uid);
  assert.equal(expected.mode, before.mode & 0o777);
  const identity = (value: Awaited<ReturnType<typeof lstat>>) =>
    [
      value.dev,
      value.ino,
      value.uid,
      value.mode,
      value.size,
      value.mtimeMs,
      value.ctimeMs,
      value.nlink,
    ]
      .map(String)
      .join(':');
  const handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = await handle.stat();
    assert.equal(
      identity(descriptorBefore),
      identity(before),
      `Android source changed before descriptor read: ${relative}`,
    );
    const buffer = Buffer.alloc(descriptorBefore.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, null);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const bytes = buffer.subarray(0, offset);
    await afterRead?.();
    const descriptorAfter = await handle.stat();
    const after = await lstat(target);
    assert.equal(
      identity(descriptorAfter),
      identity(descriptorBefore),
      `Android source changed: ${relative}`,
    );
    assert.equal(
      identity(after),
      identity(descriptorBefore),
      `Android source path changed: ${relative}`,
    );
    assert.equal(await realpath(target), target, `Android source path changed: ${relative}`);
    assert.equal(bytes.length, expected.sizeBytes, `Android source changed: ${relative}`);
    assert(bytes.length <= maxBytes, `Android source exceeds its bounded cap: ${relative}`);
    assert.equal(digest(bytes), expected.sha256, `Android source hash changed: ${relative}`);
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readAndroidStagedSourceForTest(options: {
  captureRoot: string;
  receipt: AndroidSessionProducerReceipt;
  afterRead?: () => void | Promise<void>;
}): Promise<Buffer> {
  return readStableSource(options.captureRoot, options.receipt, options.afterRead);
}

async function verifyStagedFile(
  outputRoot: string,
  prefix: string,
  file: AndroidSessionStagedFile,
  afterRead?: () => void | Promise<void>,
): Promise<void> {
  const target = assertArtifactPath(
    outputRoot,
    `${prefix}/${relativeFile(file.path, 'staged path')}`,
  );
  assert.equal(
    await realpath(target),
    target,
    `Android staged file is not canonical: ${file.path}`,
  );
  const metadata = await lstat(target);
  assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1);
  assert.equal(metadata.uid, process.getuid?.());
  assert.equal(metadata.mode & 0o777, 0o600);
  assert(file.bytes <= maxStagedBytes(file.path), `Android staged file exceeds cap: ${file.path}`);
  assert.equal(metadata.size, file.bytes);
  const identity = (value: Awaited<ReturnType<typeof lstat>>) =>
    [
      value.dev,
      value.ino,
      value.uid,
      value.mode,
      value.size,
      value.mtimeMs,
      value.ctimeMs,
      value.nlink,
    ]
      .map(String)
      .join(':');
  const handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = await handle.stat();
    assert.equal(
      identity(descriptorBefore),
      identity(metadata),
      `Android staged file changed before descriptor read: ${file.path}`,
    );
    const buffer = Buffer.alloc(file.bytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, null);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const bytes = buffer.subarray(0, offset);
    assert.equal(bytes.length, file.bytes);
    assert.equal(digest(bytes), file.sha256, `Android staged hash changed: ${file.path}`);
    await afterRead?.();
    const descriptorAfter = await handle.stat();
    const after = await lstat(target);
    assert.equal(
      identity(descriptorAfter),
      identity(descriptorBefore),
      `Android staged file changed during read: ${file.path}`,
    );
    assert(after.isFile() && !after.isSymbolicLink() && after.nlink === 1);
    assert.equal(await realpath(target), target, `Android staged path changed: ${file.path}`);
    assert.equal(identity(after), identity(metadata), `Android staged path changed: ${file.path}`);
    assert.equal(
      file.sourceReceipt.sha256,
      file.sha256,
      `Android source/staged hash differs: ${file.path}`,
    );
    assert.equal(
      file.sourceReceipt.sizeBytes,
      file.bytes,
      `Android source/staged size differs: ${file.path}`,
    );
  } finally {
    await handle.close();
  }
}

export async function verifyAndroidStagedFileForTest(options: {
  outputRoot: string;
  prefix: string;
  file: AndroidSessionStagedFile;
  afterRead?: () => void | Promise<void>;
}): Promise<void> {
  await verifyStagedFile(options.outputRoot, options.prefix, options.file, options.afterRead);
}

function producerReceiptMap(
  expectedPaths: readonly string[],
  producerReceipts: readonly AndroidSessionProducerReceipt[],
): Map<string, AndroidSessionProducerReceipt> {
  const expected = new Set(expectedPaths);
  const result = new Map<string, AndroidSessionProducerReceipt>();
  for (const raw of producerReceipts) {
    const current = receipt(raw, 'Android producer receipt');
    // A capture report may carry receipts for diagnostics outside the six
    // assertion bundle. Those receipts are not copied or trusted here.
    if (!expected.has(current.path)) continue;
    assert(!result.has(current.path), `Android producer receipt is duplicated: ${current.path}`);
    result.set(current.path, current);
  }
  assert.deepEqual(
    [...result.keys()].sort(),
    [...expected].sort(),
    'Android producer receipt set does not exactly cover the required bundle',
  );
  for (const [relative, current] of result) {
    if (relative.endsWith('.png')) assert.equal(current.contentKind, 'png');
    if (relative.endsWith('-hierarchy.json')) assert.equal(current.contentKind, 'hierarchy-json');
    if (relative.endsWith('-hierarchy.stdout'))
      assert.equal(current.contentKind, 'hierarchy-source');
    if (relative === 'transport-observations.private.json') assert.equal(current.kind, 'transport');
    if (relative === 'native-auth-identities.private.json') assert.equal(current.kind, 'auth');
  }
  return result;
}

function parseManifest(
  bytes: Buffer,
  dependency: AndroidSessionPublicDependencyResult,
  selection: NativePilotSelection,
): AndroidSessionStagedManifest {
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  assert(isRecord(value), 'Android staging manifest is malformed');
  assert.equal(value.kind, 'private-android-session-dependency-copy-not-public-outcome');
  assert.equal(value.platform, 'android');
  assert.equal(value.engine, 'maestro');
  assert(typeof value.requestedRunId === 'string' && id.test(value.requestedRunId));
  assert(typeof value.captureRunId === 'string' && id.test(value.captureRunId));
  assert.equal(value.status, 'validated-source-only');
  assert.equal(value.nativePassingCases, 0);
  assert.equal(value.publicPassingCases, 0);
  assert.equal(value.publicPromotionEligible, false);
  const selectionBinding = requireSelectionBinding(value.selectionBinding, selection);
  assert.equal(
    value.selectionBindingSha256,
    selectionBindingSha256(selectionBinding),
    'Android staging selection binding hash changed',
  );
  assert(Array.isArray(value.assertionIds));
  assert.deepEqual(value.assertionIds, androidSessionPublicAssertionIds);
  assert(Array.isArray(value.files) && value.files.length > 0);
  const files = value.files.map((row: unknown) => {
    assert(isRecord(row), 'Android staging file row is malformed');
    assert(typeof row.path === 'string');
    assert(/^[a-f0-9]{64}$/.test(String(row.sha256)));
    assert(Number.isSafeInteger(row.bytes) && Number(row.bytes) > 0);
    assert(
      Number(row.bytes) <= maxStagedBytes(row.path),
      `Android staged file exceeds cap: ${row.path}`,
    );
    return {
      path: row.path,
      sha256: row.sha256 as string,
      bytes: row.bytes as number,
      sourceReceipt: receipt(row.sourceReceipt, `staged source receipt ${row.path}`),
    };
  });
  const expected = requiredAndroidSessionBundlePaths(dependency);
  assert.equal(files.length, expected.length, 'Android staging bundle is incomplete');
  assert.deepEqual(
    files.map((file) => file.path).sort(),
    expected,
    'Android staging bundle path set is not exact',
  );
  return {
    kind: value.kind,
    platform: 'android',
    engine: 'maestro',
    requestedRunId: value.requestedRunId,
    captureRunId: value.captureRunId,
    assertionIds: [...androidSessionPublicAssertionIds],
    status: 'validated-source-only',
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    selectionBinding,
    selectionBindingSha256: selectionBindingSha256(selectionBinding),
    files,
  };
}

/** Copy the validated Android bundle while preserving the source-only boundary. */
export async function stageAndroidSessionPublicDependency(options: {
  dependency: AndroidSessionPublicDependencyResult;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  producerReceipts: readonly AndroidSessionProducerReceipt[];
}): Promise<AndroidSessionStageResult> {
  const captureRoot = await privateRoot(options.captureRoot, 'Android session capture root');
  const outputRoot = await privateRoot(options.outputRoot, 'Android session output root');
  assert.match(options.requestedRunId, id);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.notEqual(captureRoot, outputRoot);
  assert.equal(path.basename(captureRoot), options.dependency.captureRunId);
  requireSelection(options.selection);
  const selectionBinding = androidSessionSelectionBinding(options.selection);
  assert.equal(options.dependency.status, 'validated-source-only');
  assert.deepEqual(options.dependency.assertionIds, androidSessionPublicAssertionIds);
  assert.equal(options.dependency.nativePassingCases, 0);
  assert.equal(options.dependency.publicPassingCases, 0);
  assert.equal(options.dependency.publicPromotionEligible, false);
  assert.match(options.dependency.captureRunId, id);

  const sourcePaths = requiredAndroidSessionBundlePaths(options.dependency);
  const producerByPath = producerReceiptMap(sourcePaths, options.producerReceipts);
  const sourceBytes = new Map<string, Buffer>();
  for (const relative of sourcePaths) {
    const expected = producerByPath.get(relative);
    assert(expected, `Android producer receipt is missing: ${relative}`);
    const bytes = await readStableSource(captureRoot, expected);
    assert(bytes.length > 0, `Android session evidence is empty: ${relative}`);
    sourceBytes.set(relative, bytes);
  }

  const prefix = `evidence/${options.dependency.captureRunId}`;
  await mkdir(assertArtifactPath(outputRoot, prefix), { recursive: true, mode: 0o700 });
  await privateDirectory(
    assertArtifactPath(outputRoot, prefix),
    'Android evidence output directory',
  );
  const staged: AndroidSessionStagedFile[] = [];
  for (const [relative, bytes] of sourceBytes) {
    const destination = assertArtifactPath(outputRoot, `${prefix}/${relative}`);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await privateDirectory(path.dirname(destination), 'Android staged evidence directory');
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    const expected = producerByPath.get(relative);
    assert(expected);
    await verifyStagedFile(outputRoot, prefix, {
      path: relative,
      sha256: expected.sha256,
      bytes: expected.sizeBytes,
      sourceReceipt: expected,
    });
    await readStableSource(captureRoot, expected);
    staged.push({
      path: relative,
      sha256: expected.sha256,
      bytes: expected.sizeBytes,
      sourceReceipt: expected,
    });
  }

  const manifest: AndroidSessionStagedManifest = {
    kind: 'private-android-session-dependency-copy-not-public-outcome',
    platform: 'android',
    engine: 'maestro',
    requestedRunId: options.requestedRunId,
    captureRunId: options.dependency.captureRunId,
    assertionIds: [...androidSessionPublicAssertionIds],
    status: 'validated-source-only',
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    selectionBinding,
    selectionBindingSha256: selectionBindingSha256(selectionBinding),
    files: staged,
  };
  const manifestPath = `${prefix}/copy-manifest.private.json`;
  await privateDirectory(
    path.dirname(assertArtifactPath(outputRoot, manifestPath)),
    'Android manifest directory',
  );
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(assertArtifactPath(outputRoot, manifestPath), manifestBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  assert.deepEqual(
    await readFile(assertArtifactPath(outputRoot, manifestPath)),
    manifestBytes,
    'Android staging manifest changed during write',
  );
  return {
    copyManifest: { path: manifestPath, sha256: digest(manifestBytes) },
    artifacts: [manifestPath, ...staged.map((row) => `${prefix}/${row.path}`)],
    assertionIds: [...androidSessionPublicAssertionIds],
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    selectionBinding,
  };
}

/** Re-read every staged byte before any outer public receipt could be written. */
export async function verifyStagedAndroidSessionDependency(options: {
  outputRoot: string;
  copyManifest: { path: string; sha256: string };
  requestedRunId: string;
  captureRunId: string;
  captureRoot: string;
  dependency: AndroidSessionPublicDependencyResult;
  selection: NativePilotSelection;
  producerReceipts: readonly AndroidSessionProducerReceipt[];
}): Promise<void> {
  const captureRoot = await privateRoot(options.captureRoot, 'Android session capture root');
  const outputRoot = await privateRoot(options.outputRoot, 'Android session output root');
  assert.equal(path.basename(captureRoot), options.captureRunId);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.equal(options.dependency.captureRunId, options.captureRunId);
  assert.match(options.requestedRunId, id);
  assert.match(options.captureRunId, id);
  const prefix = `evidence/${options.captureRunId}`;
  assert.equal(options.copyManifest.path, `${prefix}/copy-manifest.private.json`);
  const manifestPath = assertArtifactPath(outputRoot, options.copyManifest.path);
  const manifestBytes = await readFile(manifestPath);
  assert.equal(
    digest(manifestBytes),
    options.copyManifest.sha256,
    'Android staging manifest changed',
  );
  const manifest = parseManifest(manifestBytes, options.dependency, options.selection);
  assert.equal(manifest.requestedRunId, options.requestedRunId);
  assert.equal(manifest.captureRunId, options.captureRunId);
  const expected = requiredAndroidSessionBundlePaths(options.dependency);
  const producerByPath = producerReceiptMap(expected, options.producerReceipts);
  const paths = new Set<string>();
  for (const file of manifest.files) {
    const relative = relativeFile(file.path, 'staged Android session path');
    assert(!paths.has(relative), `Android staged path is duplicated: ${relative}`);
    paths.add(relative);
    const expectedReceipt = producerByPath.get(relative);
    assert(expectedReceipt, `Android producer receipt is missing: ${relative}`);
    assert.deepEqual(
      file.sourceReceipt,
      expectedReceipt,
      `Android producer receipt changed: ${relative}`,
    );
    await readStableSource(captureRoot, expectedReceipt);
    await verifyStagedFile(outputRoot, prefix, file);
  }
  assert.deepEqual([...paths].sort(), expected, 'Android staged path set is incomplete');
  try {
    await readFile(path.join(outputRoot, 'receipt.json'));
    throw new Error('Android source-only staging cannot coexist with receipt.json');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

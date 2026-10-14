import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  assertResolvedIntegratedExpoConfig,
  requireIntegratedLoopbackOrigin,
} from './integration-preflight';
import { treeHash } from './native-build-identity';
import { assertNativeBootstrapHealthy } from './native-runtime-preflight';
import type { NativeSourceIdentity } from './native-build-identity';
import type { Stats } from 'node:fs';

export type ReusableIosBuild = {
  bundleId: string;
  binaryPath: string;
  binaryHash: string;
  profile: string;
  apiOrigin: string;
  metroOrigin: string;
  environmentHash: string;
  /** Captured root-app identity of the qualified binary. */
  binaryIdentity?: ReusableIosBuildIdentity;
};
export type ReusableIosBuildIdentity = Readonly<{
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}>;
type Capture = {
  result: string;
  cleanup: string;
  runtimeQualificationRejected?: boolean;
  viewIds?: string[];
  charter?: string;
  source: NativeSourceIdentity;
  sourceAfter: NativeSourceIdentity;
  build: ReusableIosBuild;
};
type Qualification = {
  result: string;
  sourceTreeHash: string;
  binaryHash: string;
  cleanupVerified: boolean;
  screenshotReviewed: boolean;
  scope?: string;
  entryEvidence?: EntryEvidence;
};

type EntryEvidence = {
  screenshotHash: string;
  hierarchyHash: string;
  /** Optional on legacy receipts; when present it must be the producer path. */
  screenshotPath?: string;
  /** Optional on legacy receipts; when present it must be the producer path. */
  hierarchyPath?: string;
};

type ResolvedEntryEvidencePaths = Readonly<{
  screenshotPath: 'entry.png';
  hierarchyPath: 'entry-hierarchy.json' | 'entry-hierarchy.private.log';
}>;

/**
 * Bind a qualified receipt to the evidence path emitted by its capture charter.
 * The old auth-account partial capture used the private log name; the current
 * entry capture writes JSON. A receipt cannot select the other charter's path.
 */
export function resolveReusableIosEntryEvidencePaths(
  capture: Capture,
  evidence: EntryEvidence,
): ResolvedEntryEvidencePaths {
  const legacyAuthAccount =
    capture.result === 'harness-blocked' &&
    capture.charter === 'auth-account' &&
    capture.viewIds?.includes('SCR-sign-in');
  const currentEntry = capture.result === 'observed' && capture.charter === 'entry';
  if (!legacyAuthAccount && !currentEntry)
    throw new Error('Entry evidence capture charter is unsupported');
  const expectedHierarchyPath = legacyAuthAccount
    ? 'entry-hierarchy.private.log'
    : 'entry-hierarchy.json';
  if (evidence.screenshotPath !== undefined && evidence.screenshotPath !== 'entry.png')
    throw new Error('Entry evidence screenshot path is unsupported');
  if (evidence.hierarchyPath !== undefined && evidence.hierarchyPath !== expectedHierarchyPath)
    throw new Error('Entry evidence hierarchy path does not match its capture charter');
  return {
    screenshotPath: 'entry.png',
    hierarchyPath: evidence.hierarchyPath ?? expectedHierarchyPath,
  };
}

function binaryIdentity(stat: Stats): ReusableIosBuildIdentity {
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

async function readStableBinaryIdentity(
  binaryPath: string,
  ownerUid: number,
): Promise<ReusableIosBuildIdentity> {
  const before = await lstat(binaryPath);
  if (
    before.isSymbolicLink() ||
    (!before.isDirectory() && !before.isFile()) ||
    before.uid !== ownerUid ||
    (await realpath(binaryPath)) !== binaryPath
  )
    throw new Error('Native build binary is not a canonical owned file or app bundle');
  const beforeIdentity = binaryIdentity(before);
  const after = await lstat(binaryPath);
  if (
    after.isSymbolicLink() ||
    JSON.stringify(binaryIdentity(after)) !== JSON.stringify(beforeIdentity) ||
    (await realpath(binaryPath)) !== binaryPath
  )
    throw new Error('Native build binary identity changed during qualification');
  return beforeIdentity;
}

export function validateReusableIosBuild(
  capture: Capture,
  qualification: Qualification,
  current: NativeSourceIdentity,
) {
  const reviewedPartialEntry =
    capture.result === 'harness-blocked' &&
    capture.charter === 'auth-account' &&
    capture.viewIds?.includes('SCR-sign-in') &&
    qualification.scope === 'entry-only' &&
    /^[a-f0-9]{64}$/.test(qualification.entryEvidence?.screenshotHash ?? '') &&
    /^[a-f0-9]{64}$/.test(qualification.entryEvidence?.hierarchyHash ?? '');
  if (
    (capture.result !== 'observed' && !reviewedPartialEntry) ||
    capture.cleanup !== 'cleaned' ||
    capture.runtimeQualificationRejected ||
    qualification.result !== 'qualified-entry-observation' ||
    !qualification.cleanupVerified ||
    !qualification.screenshotReviewed
  )
    throw new Error('Native build has no qualified clean entry observation');
  if (qualification.entryEvidence)
    resolveReusableIosEntryEvidencePaths(capture, qualification.entryEvidence);
  if (
    !/^[a-f0-9]{40}$/.test(current.sha) ||
    !/^[a-f0-9]{64}$/.test(current.sourceTreeHash) ||
    JSON.stringify(capture.source) !== JSON.stringify(current) ||
    JSON.stringify(capture.sourceAfter) !== JSON.stringify(current) ||
    qualification.sourceTreeHash !== current.sourceTreeHash
  )
    throw new Error('Native build source identity is stale or unknown');
  const build = capture.build;
  if (
    build.bundleId !== 'com.edufelip.mychampions.dev' ||
    build.profile !== 'Metro-attached Debug; not bundled release qualification' ||
    !/^[a-f0-9]{64}$/.test(build.binaryHash) ||
    qualification.binaryHash !== build.binaryHash ||
    !/^[a-f0-9]{64}$/.test(build.environmentHash)
  )
    throw new Error('Native build identity/profile is unqualified');
  requireIntegratedLoopbackOrigin(build.apiOrigin);
  requireIntegratedLoopbackOrigin(build.metroOrigin);
  if (build.apiOrigin === build.metroOrigin) throw new Error('Native reuse endpoints collide');
  return build;
}

/** Reuses bytes only, never the old simulator/API/session/processes. */
async function loadReusableIosBuildAtRoot(
  root: string,
  runId: string,
  current: NativeSourceIdentity,
) {
  if (!/^[a-f0-9]{24}$/.test(runId)) throw new Error('Invalid native build run ID');
  const directory = path.join(root, '.qa/artifacts/native-pilot', runId);
  const meta = await lstat(directory);
  if (
    (await realpath(directory)) !== directory ||
    !meta.isDirectory() ||
    (meta.mode & 0o777) !== 0o700 ||
    meta.uid !== process.getuid?.()
  )
    throw new Error('Native build artifact root is not private and owned');
  const privateJson = async (name: string) => {
    const file = path.join(directory, name);
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o777) !== 0o600 ||
      info.uid !== meta.uid ||
      (await realpath(file)) !== file
    )
      throw new Error('Native build record is not private and owned');
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  };
  const capture = (await privateJson('capture.private.json')) as Capture;
  const qualification = (await privateJson('entry-qualification.private.json')) as Qualification;
  const build = validateReusableIosBuild(capture, qualification, current);
  const expectedPath = path.join(
    directory,
    'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app',
  );
  if (build.binaryPath !== expectedPath || (await realpath(expectedPath)) !== expectedPath)
    throw new Error('Native build path/bytes changed');
  const binaryIdentityBefore = await readStableBinaryIdentity(expectedPath, meta.uid);
  if ((await treeHash(expectedPath)) !== build.binaryHash)
    throw new Error('Native build path/bytes changed');
  const binaryIdentityAfter = await readStableBinaryIdentity(expectedPath, meta.uid);
  if (JSON.stringify(binaryIdentityAfter) !== JSON.stringify(binaryIdentityBefore))
    throw new Error('Native build binary identity changed after hashing');
  const embedded = JSON.parse(
    await readFile(path.join(expectedPath, 'EXConstants.bundle/app.config'), 'utf8'),
  ) as { extra: Record<string, unknown> };
  assertResolvedIntegratedExpoConfig(embedded.extra, build.apiOrigin);
  assertNativeBootstrapHealthy(
    await readFile(path.join(directory, 'bootstrap.private.log'), 'utf8'),
  );
  if (capture.result === 'harness-blocked' || qualification.entryEvidence) {
    if (!qualification.entryEvidence)
      throw new Error('Entry evidence hashes are required for a partial capture');
    const evidencePaths = resolveReusableIosEntryEvidencePaths(
      capture,
      qualification.entryEvidence,
    );
    for (const [name, expected] of [
      [evidencePaths.screenshotPath, qualification.entryEvidence.screenshotHash],
      [evidencePaths.hierarchyPath, qualification.entryEvidence.hierarchyHash],
    ] as const) {
      const file = path.join(directory, name);
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== meta.uid ||
        (await realpath(file)) !== file ||
        info.size > 8 * 1024 * 1024
      )
        throw new Error('Partial entry evidence is not an owned bounded file');
      const bytes = await readFile(file);
      if (createHash('sha256').update(bytes).digest('hex') !== expected)
        throw new Error('Partial entry evidence bytes changed');
      if (
        name === evidencePaths.screenshotPath &&
        bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      )
        throw new Error('Partial entry screenshot is not PNG');
      if (
        name === evidencePaths.hierarchyPath &&
        !['auth.signIn.emailInput', 'auth.signIn.passwordInput', 'auth.signIn.submitButton'].every(
          (id) => bytes.includes(id),
        )
      )
        throw new Error('Partial entry hierarchy lacks required sign-in selectors');
    }
  }
  return {
    ...build,
    binaryIdentity: binaryIdentityAfter,
    sourceRunId: runId,
    apiPort: Number(new URL(build.apiOrigin).port),
    metroPort: Number(new URL(build.metroOrigin).port),
  };
}

/**
 * The protected manual workflow may restore a qualified run into a clean
 * checkout.  The receipts deliberately retain the original cache absolute
 * path, so callers must use this loader with an explicit sourceRoot instead
 * of rebinding a record in memory.  The source loader remains the first
 * validation boundary; relocation then validates the copied run through the
 * same semantic validator and all protected bytes.
 */
export type NativeBuildReuseOptions = Readonly<{
  sourceRoot?: string;
}>;

type StableRelocationFile = Readonly<{ bytes: Buffer; identity: string }>;

const REUSABLE_BINARY_RELATIVE = 'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app';

function relocationIdentity(value: Stats): string {
  return JSON.stringify({
    dev: value.dev,
    ino: value.ino,
    uid: value.uid,
    gid: value.gid,
    mode: value.mode & 0o777,
    nlink: value.nlink,
    size: value.size,
    mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs,
  });
}

async function readStableRelocationFile(
  file: string,
  maxBytes: number,
): Promise<StableRelocationFile> {
  const ownerUid = process.getuid?.();
  if (ownerUid === undefined) throw new Error('Native build relocation requires a local owner UID');
  const parent = path.dirname(file);
  const parentBefore = await lstat(parent);
  if (
    !parentBefore.isDirectory() ||
    parentBefore.isSymbolicLink() ||
    (await realpath(parent)) !== parent
  )
    throw new Error('Native build relocation record parent is not a canonical directory');
  const before = await lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.uid !== ownerUid ||
    (before.mode & 0o777) !== 0o600 ||
    before.size > maxBytes ||
    (await realpath(file)) !== file
  )
    throw new Error('Native build relocation record is not a bounded private owned file');
  const identity = relocationIdentity(before);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.uid !== ownerUid ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.size > maxBytes ||
      relocationIdentity(opened) !== identity
    )
      throw new Error('Native build relocation record changed before descriptor read');
    const buffer = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    bytes = buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
  const after = await lstat(file);
  const parentAfter = await lstat(parent);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.nlink !== 1 ||
    after.uid !== ownerUid ||
    relocationIdentity(after) !== identity ||
    (await realpath(file)) !== file ||
    bytes.length !== before.size ||
    !parentAfter.isDirectory() ||
    parentAfter.isSymbolicLink() ||
    relocationIdentity(parentAfter) !== relocationIdentity(parentBefore) ||
    (await realpath(parent)) !== parent
  )
    throw new Error('Native build relocation record changed during read');
  return { bytes, identity };
}

async function relocationRunDirectory(root: string, runId: string): Promise<string> {
  const directory = path.join(root, '.qa/artifacts/native-pilot', runId);
  const ownerUid = process.getuid?.();
  if (ownerUid === undefined) throw new Error('Native build relocation requires a local owner UID');
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o777) !== 0o700 ||
    info.uid !== ownerUid ||
    (await realpath(directory)) !== directory
  )
    throw new Error('Native build relocation run directory is not private and owned');
  return directory;
}

async function equalRelocationBytes(left: string, right: string, maxBytes: number, label: string) {
  const leftRead = await readStableRelocationFile(left, maxBytes);
  const rightRead = await readStableRelocationFile(right, maxBytes);
  if (!leftRead.bytes.equals(rightRead.bytes))
    throw new Error(`Native build relocation ${label} bytes changed`);
  return leftRead.bytes;
}

/**
 * Load a reusable build for a destination checkout.  With no sourceRoot this
 * is exactly the historical same-root loader.  With a sourceRoot it validates
 * the original cache first, then validates a byte-preserving copied run and
 * returns the destination binary path only after the production validator has
 * accepted an in-memory path rebind.
 */
export async function loadReusableIosBuild(
  root: string,
  runId: string,
  current: NativeSourceIdentity,
  options: NativeBuildReuseOptions = {},
) {
  if (
    options.sourceRoot !== undefined &&
    (!path.isAbsolute(options.sourceRoot) || options.sourceRoot.includes('\0'))
  )
    throw new Error('Native build relocation source root must be an absolute path');
  const destinationRoot = await realpath(root);
  const sourceRoot = await realpath(options.sourceRoot ?? root);
  if (sourceRoot === destinationRoot)
    return loadReusableIosBuildAtRoot(destinationRoot, runId, current);

  const sourceDirectory = await relocationRunDirectory(sourceRoot, runId);
  const destinationDirectory = await relocationRunDirectory(destinationRoot, runId);
  const sourceCapturePath = path.join(sourceDirectory, 'capture.private.json');
  const sourceQualificationPath = path.join(sourceDirectory, 'entry-qualification.private.json');
  const sourceCaptureBefore = await readStableRelocationFile(sourceCapturePath, 256 * 1024);
  const sourceQualificationBefore = await readStableRelocationFile(
    sourceQualificationPath,
    256 * 1024,
  );
  const sourceBuild = await loadReusableIosBuildAtRoot(sourceRoot, runId, current);
  const sourceCaptureAfter = await readStableRelocationFile(sourceCapturePath, 256 * 1024);
  const sourceQualificationAfter = await readStableRelocationFile(
    sourceQualificationPath,
    256 * 1024,
  );
  if (
    !sourceCaptureBefore.bytes.equals(sourceCaptureAfter.bytes) ||
    !sourceQualificationBefore.bytes.equals(sourceQualificationAfter.bytes)
  )
    throw new Error('Native build relocation source receipt changed during validation');

  await equalRelocationBytes(
    sourceCapturePath,
    path.join(destinationDirectory, 'capture.private.json'),
    256 * 1024,
    'capture receipt',
  );
  const destinationQualification = await equalRelocationBytes(
    sourceQualificationPath,
    path.join(destinationDirectory, 'entry-qualification.private.json'),
    256 * 1024,
    'entry qualification receipt',
  );
  const sourceCapture = JSON.parse(sourceCaptureBefore.bytes.toString('utf8')) as Capture;
  const qualification = JSON.parse(destinationQualification.toString('utf8')) as Qualification;
  const sourceBuildRecord = sourceCapture.build;
  const expectedSourceBinary = path.join(sourceDirectory, REUSABLE_BINARY_RELATIVE);
  const destinationBinary = path.join(destinationDirectory, REUSABLE_BINARY_RELATIVE);
  if (sourceBuildRecord.binaryPath !== expectedSourceBinary)
    throw new Error('Native build relocation source receipt is not cache-root bound');
  const reboundCapture = structuredClone(sourceCapture);
  reboundCapture.build = { ...sourceBuildRecord, binaryPath: destinationBinary };
  const reboundBuild = validateReusableIosBuild(reboundCapture, qualification, current);
  if (
    reboundBuild.binaryPath !== destinationBinary ||
    reboundBuild.binaryHash !== sourceBuild.binaryHash
  )
    throw new Error('Native build relocation changed the qualified build identity');

  const sourceTree = await treeHash(expectedSourceBinary);
  const destinationTree = await treeHash(destinationBinary);
  if (sourceTree !== sourceBuild.binaryHash || destinationTree !== sourceTree)
    throw new Error('Native build relocation bundle bytes changed');
  const sourceConfig = await readStableRelocationFile(
    path.join(expectedSourceBinary, 'EXConstants.bundle/app.config'),
    256 * 1024,
  );
  const destinationConfig = await readStableRelocationFile(
    path.join(destinationBinary, 'EXConstants.bundle/app.config'),
    256 * 1024,
  );
  if (!sourceConfig.bytes.equals(destinationConfig.bytes))
    throw new Error('Native build relocation Expo config bytes changed');
  const embedded = JSON.parse(destinationConfig.bytes.toString('utf8')) as {
    extra: Record<string, unknown>;
  };
  assertResolvedIntegratedExpoConfig(embedded.extra, reboundBuild.apiOrigin);
  const sourceBootstrap = await readStableRelocationFile(
    path.join(sourceDirectory, 'bootstrap.private.log'),
    1024 * 1024,
  );
  const destinationBootstrap = await readStableRelocationFile(
    path.join(destinationDirectory, 'bootstrap.private.log'),
    1024 * 1024,
  );
  if (!sourceBootstrap.bytes.equals(destinationBootstrap.bytes))
    throw new Error('Native build relocation bootstrap bytes changed');
  assertNativeBootstrapHealthy(destinationBootstrap.bytes.toString('utf8'));

  if (sourceCapture.result === 'harness-blocked' || qualification.entryEvidence) {
    if (!qualification.entryEvidence)
      throw new Error('Native build relocation entry evidence hashes are missing');
    const evidencePaths = resolveReusableIosEntryEvidencePaths(
      sourceCapture,
      qualification.entryEvidence,
    );
    for (const [name, maxBytes] of [
      [evidencePaths.screenshotPath, 8 * 1024 * 1024],
      [evidencePaths.hierarchyPath, 8 * 1024 * 1024],
    ] as const) {
      const sourceEvidence = await readStableRelocationFile(
        path.join(sourceDirectory, name),
        maxBytes,
      );
      const destinationEvidence = await readStableRelocationFile(
        path.join(destinationDirectory, name),
        maxBytes,
      );
      if (!sourceEvidence.bytes.equals(destinationEvidence.bytes))
        throw new Error(`Native build relocation ${name} bytes changed`);
    }
  }
  const binaryIdentity = await readStableBinaryIdentity(
    destinationBinary,
    process.getuid?.() ?? -1,
  );
  return {
    ...reboundBuild,
    binaryIdentity,
    sourceRunId: runId,
    sourceRoot,
    destinationRoot,
    apiPort: Number(new URL(reboundBuild.apiOrigin).port),
    metroPort: Number(new URL(reboundBuild.metroOrigin).port),
  };
}

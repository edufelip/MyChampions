import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { androidSourceIdentity } from './android-build-identity';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import type { NativeSourceIdentity } from './native-build-identity';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_DESCRIPTOR_BYTES = 256 * 1024;
const MAX_APK_BYTES = 256 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

export type AndroidMaestroQualifiedBuildDescriptor = Readonly<{
  kind: 'private-qualified-android-maestro-build-v1';
  runId: string;
  platform: 'android';
  engine: 'maestro';
  buildProfile: string;
  binaryPath: string;
  binaryHash: string;
  binarySizeBytes: number;
  binaryIdentity: AndroidMaestroBinaryIdentity;
  appId: string;
  launcher: string;
  source: NativeSourceIdentity;
  sourceAfter: NativeSourceIdentity;
  sourceFingerprint: string;
  helperFingerprint: string;
  flagsFingerprint: string;
  environmentHash: string;
  originalPorts: {
    api: number;
    metro: number;
    proxy: number;
  };
  originalOrigins: {
    api: string;
    metro: string;
    proxy: string;
  };
  qualification: {
    status: 'qualified';
    cleanup: 'cleaned';
    sourceStable: true;
    helperStable: true;
  };
}>;

export type AndroidMaestroBinaryIdentity = Readonly<{
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

export type AndroidMaestroQualifiedBuildReuse = Readonly<{
  kind: 'qualified-android-maestro-build-reuse';
  buildId: string;
  buildProfile: string;
  sourceFingerprint: string;
  helperFingerprint: string;
  flagsFingerprint: string;
  binaryHash: string;
  binaryPath: string;
  binarySizeBytes: number;
  binaryIdentity: AndroidMaestroBinaryIdentity;
  artifactRoot: string;
  appId: string;
  launcher: string;
  environmentHash: string;
  originalPorts: AndroidMaestroQualifiedBuildDescriptor['originalPorts'];
  originalOrigins: AndroidMaestroQualifiedBuildDescriptor['originalOrigins'];
  sourceRunId: string;
  current: true;
}>;

type ExpectedReuse = Readonly<{
  platform: 'android';
  buildId: string;
  buildProfile: string;
  sourceFingerprint: string;
  helperFingerprint: string;
  flagsFingerprint: string;
  binaryHash: string;
  current: true;
}>;

type StableRead = Readonly<{
  bytes: Buffer;
  identity: AndroidMaestroBinaryIdentity;
}>;

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as JsonRecord;
}

function text(value: unknown, label: string, max = 4096): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.length <= max,
    `${label} is invalid`,
  );
  assert(value.trim() === value && !value.includes('\0'), `${label} is not normalized`);
  return value;
}

function hash(value: unknown, label: string): string {
  const result = text(value, label, 64);
  assert(HASH.test(result), `${label} is not a SHA-256 digest`);
  return result;
}

function runId(value: unknown, label: string): string {
  const result = text(value, label, 64);
  assert(RUN_ID.test(result), `${label} is not a run ID`);
  return result;
}

function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  assert(
    Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max,
    `${label} is invalid`,
  );
  return Number(value);
}

function origin(value: unknown, label: string): string {
  const result = text(value, label, 256);
  requireIntegratedLoopbackOrigin(result);
  return result;
}

function port(value: unknown, label: string): number {
  return integer(value, label, 1024, 65535);
}

function identity(stat: Awaited<ReturnType<typeof lstat>>): AndroidMaestroBinaryIdentity {
  return {
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    mode: Number(stat.mode) & 0o777,
    nlink: Number(stat.nlink),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
  };
}

function sameIdentity(
  left: AndroidMaestroBinaryIdentity,
  right: AndroidMaestroBinaryIdentity,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function guard(signal: AbortSignal | undefined, deadlineAtMonotonicMs: number): void {
  signal?.throwIfAborted();
  assert(Number.isFinite(deadlineAtMonotonicMs), 'Android qualified build deadline is invalid');
  assert(performance.now() < deadlineAtMonotonicMs, 'Android qualified build deadline expired');
}

async function privateRoot(root: string, label: string, requirePrivate = true): Promise<string> {
  assert(path.isAbsolute(root) && path.normalize(root) === root, `${label} is not canonical`);
  const canonical = await realpath(root);
  assert.equal(canonical, root, `${label} resolves elsewhere`);
  const stat = await lstat(canonical);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(stat.uid, process.getuid?.(), `${label} is not owned`);
  if (requirePrivate) assert.equal(stat.mode & 0o777, 0o700, `${label} is not private`);
  return canonical;
}

async function stablePrivateRead(
  root: string,
  file: string,
  maxBytes: number,
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
): Promise<StableRead> {
  guard(signal, deadlineAtMonotonicMs);
  const canonical = path.resolve(file);
  assert(canonical.startsWith(`${root}${path.sep}`), 'Qualified build file escaped its root');
  const before = await lstat(canonical);
  assert(
    before.isFile() && !before.isSymbolicLink() && before.nlink === 1,
    'Qualified build file is not a single-link regular file',
  );
  assert.equal(before.uid, process.getuid?.(), 'Qualified build file is not owned');
  assert.equal(before.mode & 0o777, 0o600, 'Qualified build file is not private');
  assert(before.size <= maxBytes, 'Qualified build file exceeds its bounded size');
  assert.equal(await realpath(canonical), canonical, 'Qualified build file is not canonical');
  const beforeIdentity = identity(before);
  const handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  try {
    const opened = await handle.stat();
    assert(
      opened.isFile() &&
        !opened.isSymbolicLink() &&
        opened.nlink === 1 &&
        opened.uid === process.getuid?.(),
      'Qualified build file changed before read',
    );
    assert.equal(opened.mode & 0o777, 0o600, 'Qualified build file mode changed before read');
    assert.equal(opened.size, before.size, 'Qualified build file size changed before read');
    assert(
      sameIdentity(identity(opened), beforeIdentity),
      'Qualified build file identity changed before read',
    );
    while (bytesRead < maxBytes) {
      guard(signal, deadlineAtMonotonicMs);
      const chunk = Buffer.alloc(Math.min(1024 * 1024, maxBytes - bytesRead));
      const result = await handle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) break;
      chunks.push(chunk.subarray(0, result.bytesRead));
      bytesRead += result.bytesRead;
      if (bytesRead > before.size) throw new Error('Qualified build file grew during read');
    }
  } finally {
    await handle.close();
  }
  guard(signal, deadlineAtMonotonicMs);
  const after = await lstat(canonical);
  assert(sameIdentity(identity(after), beforeIdentity), 'Qualified build file changed during read');
  assert.equal(bytesRead, before.size, 'Qualified build file was truncated during read');
  return { bytes: Buffer.concat(chunks), identity: beforeIdentity };
}

function parseIdentity(value: unknown, label: string): AndroidMaestroBinaryIdentity {
  const row = record(value, label);
  return {
    dev: integer(row.dev, `${label}.dev`),
    ino: integer(row.ino, `${label}.ino`),
    uid: integer(row.uid, `${label}.uid`),
    gid: integer(row.gid, `${label}.gid`),
    mode: integer(row.mode, `${label}.mode`),
    nlink: integer(row.nlink, `${label}.nlink`, 1),
    size: integer(row.size, `${label}.size`, 1),
    mtimeMs: integer(row.mtimeMs, `${label}.mtimeMs`),
    ctimeMs: integer(row.ctimeMs, `${label}.ctimeMs`),
  };
}

function parseDescriptor(value: unknown): AndroidMaestroQualifiedBuildDescriptor {
  const row = record(value, 'Android qualified build descriptor');
  assert.equal(row.kind, 'private-qualified-android-maestro-build-v1');
  const run = runId(row.runId, 'qualified build runId');
  assert.equal(row.platform, 'android');
  assert.equal(row.engine, 'maestro');
  const source = record(row.source, 'qualified build source');
  const sourceAfter = record(row.sourceAfter, 'qualified build sourceAfter');
  const nativeSource = (input: JsonRecord, label: string): NativeSourceIdentity => ({
    sha: text(input.sha, `${label}.sha`, 64),
    dirty: input.dirty === true,
    sourceTreeHash: hash(input.sourceTreeHash, `${label}.sourceTreeHash`),
  });
  const originalPorts = record(row.originalPorts, 'qualified build originalPorts');
  const originalOrigins = record(row.originalOrigins, 'qualified build originalOrigins');
  const ports = {
    api: port(originalPorts.api, 'qualified build api port'),
    metro: port(originalPorts.metro, 'qualified build metro port'),
    proxy: port(originalPorts.proxy, 'qualified build proxy port'),
  };
  assert(new Set(Object.values(ports)).size === 3, 'Qualified build ports are not distinct');
  const origins = {
    api: origin(originalOrigins.api, 'qualified build api origin'),
    metro: origin(originalOrigins.metro, 'qualified build metro origin'),
    proxy: origin(originalOrigins.proxy, 'qualified build proxy origin'),
  };
  assert(new Set(Object.values(origins)).size === 3, 'Qualified build origins are not distinct');
  for (const key of ['api', 'metro', 'proxy'] as const)
    assert.equal(
      Number(new URL(origins[key]).port),
      ports[key],
      `Qualified build ${key} origin/port identity differs`,
    );
  const qualification = record(row.qualification, 'qualified build qualification');
  assert.equal(qualification.status, 'qualified');
  assert.equal(qualification.cleanup, 'cleaned');
  assert.equal(qualification.sourceStable, true);
  assert.equal(qualification.helperStable, true);
  return {
    kind: 'private-qualified-android-maestro-build-v1',
    runId: run,
    platform: 'android',
    engine: 'maestro',
    buildProfile: text(row.buildProfile, 'qualified build profile', 256),
    binaryPath: text(row.binaryPath, 'qualified build binaryPath', 1024),
    binaryHash: hash(row.binaryHash, 'qualified build binaryHash'),
    binarySizeBytes: integer(
      row.binarySizeBytes,
      'qualified build binarySizeBytes',
      1,
      MAX_APK_BYTES,
    ),
    binaryIdentity: parseIdentity(row.binaryIdentity, 'qualified build binaryIdentity'),
    appId: text(row.appId, 'qualified build appId', 256),
    launcher: text(row.launcher, 'qualified build launcher', 512),
    source: nativeSource(source, 'qualified build source'),
    sourceAfter: nativeSource(sourceAfter, 'qualified build sourceAfter'),
    sourceFingerprint: hash(row.sourceFingerprint, 'qualified build sourceFingerprint'),
    helperFingerprint: hash(row.helperFingerprint, 'qualified build helperFingerprint'),
    flagsFingerprint: hash(row.flagsFingerprint, 'qualified build flagsFingerprint'),
    environmentHash: hash(row.environmentHash, 'qualified build environmentHash'),
    originalPorts: ports,
    originalOrigins: origins,
    qualification: {
      status: 'qualified',
      cleanup: 'cleaned',
      sourceStable: true,
      helperStable: true,
    },
  };
}

function descriptorRoot(repositoryRoot: string, buildId: string): string {
  assert(RUN_ID.test(buildId), 'Android qualified build ID is invalid');
  return path.join(repositoryRoot, '.qa/artifacts/native-pilot', buildId);
}

export async function loadQualifiedAndroidMaestroBuild(options: {
  repositoryRoot: string;
  expected: ExpectedReuse;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<AndroidMaestroQualifiedBuildReuse> {
  guard(options.signal, options.deadlineAtMonotonicMs);
  assert.equal(options.expected.platform, 'android');
  assert.equal(options.expected.current, true);
  const repositoryRoot = await privateRoot(
    options.repositoryRoot,
    'Android repository root',
    false,
  );
  const runRoot = await privateRoot(
    descriptorRoot(repositoryRoot, options.expected.buildId),
    'Android qualified build root',
  );
  const descriptorPath = path.join(runRoot, 'android-maestro-build.private.json');
  const descriptorRead = await stablePrivateRead(
    runRoot,
    descriptorPath,
    MAX_DESCRIPTOR_BYTES,
    options.signal,
    options.deadlineAtMonotonicMs,
  );
  const descriptor = parseDescriptor(JSON.parse(descriptorRead.bytes.toString('utf8')) as unknown);
  assert.equal(descriptor.runId, options.expected.buildId);
  assert.equal(descriptor.sourceFingerprint, options.expected.sourceFingerprint);
  assert.equal(descriptor.helperFingerprint, options.expected.helperFingerprint);
  assert.equal(descriptor.flagsFingerprint, options.expected.flagsFingerprint);
  assert.equal(descriptor.binaryHash, options.expected.binaryHash);
  assert.equal(descriptor.buildProfile, options.expected.buildProfile);
  assert.equal(descriptor.source.sourceTreeHash, descriptor.sourceFingerprint);
  assert.deepEqual(descriptor.sourceAfter, descriptor.source);
  const currentSource = await androidSourceIdentity(repositoryRoot);
  assert.equal(
    currentSource.sourceTreeHash,
    descriptor.sourceFingerprint,
    'Android qualified build source is stale',
  );
  const relativeBinary = descriptor.binaryPath;
  assert(!path.isAbsolute(relativeBinary), 'Android qualified build binaryPath must be relative');
  assert(!relativeBinary.includes('\\'), 'Android qualified build binaryPath contains a backslash');
  assert(relativeBinary.length > 0, 'Android qualified build binaryPath is empty');
  assert(
    path.posix.normalize(relativeBinary) === relativeBinary,
    'Android qualified build binaryPath is not normalized',
  );
  assert(
    !relativeBinary.split('/').includes('..'),
    'Android qualified build binaryPath escaped its root',
  );
  const binaryPath = path.resolve(runRoot, relativeBinary);
  const binary = await stablePrivateRead(
    runRoot,
    binaryPath,
    MAX_APK_BYTES,
    options.signal,
    options.deadlineAtMonotonicMs,
  );
  assert.equal(binary.bytes.length, descriptor.binarySizeBytes);
  assert.equal(createHash('sha256').update(binary.bytes).digest('hex'), descriptor.binaryHash);
  assert.deepEqual(binary.identity, descriptor.binaryIdentity);
  return {
    kind: 'qualified-android-maestro-build-reuse',
    buildId: descriptor.runId,
    buildProfile: descriptor.buildProfile,
    sourceFingerprint: descriptor.sourceFingerprint,
    helperFingerprint: descriptor.helperFingerprint,
    flagsFingerprint: descriptor.flagsFingerprint,
    binaryHash: descriptor.binaryHash,
    binaryPath,
    binarySizeBytes: descriptor.binarySizeBytes,
    binaryIdentity: descriptor.binaryIdentity,
    artifactRoot: runRoot,
    appId: descriptor.appId,
    launcher: descriptor.launcher,
    environmentHash: descriptor.environmentHash,
    originalPorts: descriptor.originalPorts,
    originalOrigins: descriptor.originalOrigins,
    sourceRunId: descriptor.runId,
    current: true,
  };
}

export async function copyQualifiedAndroidMaestroApk(options: {
  reuse: AndroidMaestroQualifiedBuildReuse;
  destination: string;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<{
  path: string;
  sha256: string;
  sizeBytes: number;
  identity: AndroidMaestroBinaryIdentity;
}> {
  const sourceRoot = await privateRoot(
    options.reuse.artifactRoot,
    'Android qualified build artifact root',
  );
  const source = await stablePrivateRead(
    sourceRoot,
    options.reuse.binaryPath,
    MAX_APK_BYTES,
    options.signal,
    options.deadlineAtMonotonicMs,
  );
  assert.deepEqual(
    source.identity,
    options.reuse.binaryIdentity,
    'Qualified Android APK source identity differs from the qualified reuse descriptor',
  );
  assert.equal(source.bytes.length, options.reuse.binarySizeBytes);
  assert.equal(createHash('sha256').update(source.bytes).digest('hex'), options.reuse.binaryHash);
  const destination = path.resolve(options.destination);
  assert(path.isAbsolute(destination));
  await privateRoot(path.dirname(destination), 'Android copied APK parent');
  await writeFile(destination, source.bytes, { flag: 'wx', mode: 0o600 });
  const copied = await lstat(destination);
  assert(copied.isFile() && !copied.isSymbolicLink() && copied.nlink === 1);
  assert.equal(copied.uid, process.getuid?.());
  assert.equal(copied.mode & 0o777, 0o600);
  const copiedBytes = await stablePrivateRead(
    path.dirname(destination),
    destination,
    MAX_APK_BYTES,
    options.signal,
    options.deadlineAtMonotonicMs,
  );
  assert.equal(
    createHash('sha256').update(copiedBytes.bytes).digest('hex'),
    options.reuse.binaryHash,
  );
  assert(
    !sameIdentity(copiedBytes.identity, options.reuse.binaryIdentity),
    'Copied Android APK unexpectedly reuses the qualified source identity',
  );
  return {
    path: destination,
    sha256: options.reuse.binaryHash,
    sizeBytes: copiedBytes.bytes.length,
    identity: copiedBytes.identity,
  };
}

export const t15AndroidMaestroBuildReuseContract = {
  bytesOnly: true,
  reusesPorts: false,
  reusesProcesses: false,
  maxApkBytes: MAX_APK_BYTES,
  descriptorMode: 0o600,
  binaryMode: 0o600,
};

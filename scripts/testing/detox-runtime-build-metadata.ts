import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const HASH = /^[a-f0-9]{64}$/;
const NODE_VERSION = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DETOX_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DETOX_PACKAGE_RELATIVE = 'node_modules/detox/package.json' as const;
const MAX_TOOL_PACKAGE_BYTES = 256 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export type DetoxRuntimeFileIdentity = Readonly<{
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

export type DetoxRuntimeToolVersionEvidence = Readonly<{
  path: typeof DETOX_PACKAGE_RELATIVE;
  realpath: string;
  bytes: number;
  sha256: string;
  packageName: 'detox';
  packageVersion: string;
  identity: DetoxRuntimeFileIdentity;
}>;

export type DetoxRuntimeBuildMetadata = Readonly<{
  /** The actual app configuration/feature profile hash used by the reusable build. */
  environmentHash: string;
  /** Versions observed from the running Node process and installed Detox package. */
  toolVersions: Readonly<{ node: string; detox: string }>;
  /** Descriptor-backed evidence for the installed Detox package version. */
  toolVersionEvidence: DetoxRuntimeToolVersionEvidence;
}>;

type Fence = () => void;

type FileStatLike = {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

function identity(stat: FileStatLike): DetoxRuntimeFileIdentity {
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

function identityKey(value: DetoxRuntimeFileIdentity): string {
  return [
    value.dev,
    value.ino,
    value.uid,
    value.gid,
    value.mode,
    value.nlink,
    value.size,
    value.mtimeMs,
    value.ctimeMs,
  ].join(':');
}

function assertHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} must be a SHA-256 hash`);
}

function assertIdentity(value: unknown, label: string): asserts value is DetoxRuntimeFileIdentity {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  const row = value as Record<string, unknown>;
  for (const key of ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'])
    assert(typeof row[key] === 'number' && Number.isFinite(row[key]), `${label}.${key} is invalid`);
}

function assertOwnedToolFile(stat: FileStatLike, label: string): void {
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} is not a regular file`);
  assert(stat.nlink === 1, `${label} must have one link`);
  assert(
    typeof process.getuid !== 'function' || stat.uid === process.getuid(),
    `${label} has a foreign owner`,
  );
  assert((stat.mode & 0o022) === 0, `${label} is writable by group or other`);
  assert(stat.size > 0 && stat.size <= MAX_TOOL_PACKAGE_BYTES, `${label} size is out of bounds`);
}

async function readToolPackage(
  repositoryRoot: string,
  fence?: Fence,
): Promise<Readonly<{ bytes: Buffer; realpath: string; identity: DetoxRuntimeFileIdentity }>> {
  fence?.();
  const root = path.resolve(repositoryRoot);
  const file = path.resolve(root, DETOX_PACKAGE_RELATIVE);
  assert(file.startsWith(root + path.sep), 'Detox package path escaped repository root');
  const before = await lstat(file);
  assertOwnedToolFile(before, 'Detox package metadata');
  const resolved = await realpath(file);
  const descriptor = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = await descriptor.stat();
    assertOwnedToolFile(descriptorBefore, 'Detox package descriptor');
    assert(
      identityKey(identity(before)) === identityKey(identity(descriptorBefore)),
      'Detox package changed before read',
    );
    const bytes = Buffer.allocUnsafe(descriptorBefore.size);
    let offset = 0;
    while (offset < bytes.length) {
      fence?.();
      const { bytesRead } = await descriptor.read(
        bytes,
        offset,
        Math.min(READ_CHUNK_BYTES, bytes.length - offset),
        null,
      );
      assert(bytesRead > 0, 'Detox package was truncated during read');
      offset += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    const extraRead = await descriptor.read(extra, 0, 1, null);
    assert(extraRead.bytesRead === 0, 'Detox package grew during bounded read');
    fence?.();
    const descriptorAfter = await descriptor.stat();
    const after = await lstat(file);
    assert(
      identityKey(identity(descriptorBefore)) === identityKey(identity(descriptorAfter)),
      'Detox package descriptor changed during read',
    );
    assert(
      identityKey(identity(descriptorBefore)) === identityKey(identity(after)),
      'Detox package path changed during read',
    );
    assert((await realpath(file)) === resolved, 'Detox package realpath changed during read');
    return { bytes, realpath: resolved, identity: identity(descriptorAfter) };
  } finally {
    await descriptor.close();
  }
}

function parseDetoxPackage(bytes: Buffer): Readonly<{ name: 'detox'; version: string }> {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Installed Detox package metadata is not valid JSON', { cause: error });
  }
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Installed Detox package metadata is not an object',
  );
  const record = value as Record<string, unknown>;
  assert(record.name === 'detox', 'Installed Detox package metadata has the wrong package name');
  assert(
    typeof record.version === 'string' && DETOX_VERSION.test(record.version),
    'Installed Detox package version is invalid',
  );
  return { name: 'detox', version: record.version };
}

export async function readActualDetoxRuntimeMetadata(
  repositoryRoot: string,
  environmentHash: string,
  fence?: Fence,
): Promise<DetoxRuntimeBuildMetadata> {
  assertHash(environmentHash, 'Detox environment hash');
  const observed = await readToolPackage(repositoryRoot, fence);
  const packageInfo = parseDetoxPackage(observed.bytes);
  const toolVersionEvidence: DetoxRuntimeToolVersionEvidence = {
    path: DETOX_PACKAGE_RELATIVE,
    realpath: observed.realpath,
    bytes: observed.bytes.byteLength,
    sha256: createHash('sha256').update(observed.bytes).digest('hex'),
    packageName: packageInfo.name,
    packageVersion: packageInfo.version,
    identity: observed.identity,
  };
  const node = process.version;
  assert(NODE_VERSION.test(node), 'Running Node version is invalid');
  return Object.freeze({
    environmentHash,
    toolVersions: Object.freeze({ node, detox: packageInfo.version }),
    toolVersionEvidence,
  });
}

export function requireDetoxRuntimeBuildMetadata(
  value: unknown,
  label = 'Detox runtime build metadata',
): asserts value is DetoxRuntimeBuildMetadata {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  const row = value as Record<string, unknown>;
  assertHash(row.environmentHash, `${label}.environmentHash`);
  assert(
    row.toolVersions && typeof row.toolVersions === 'object' && !Array.isArray(row.toolVersions),
    `${label}.toolVersions is missing`,
  );
  const versions = row.toolVersions as Record<string, unknown>;
  assert(
    typeof versions.node === 'string' && NODE_VERSION.test(versions.node),
    `${label}.toolVersions.node is invalid`,
  );
  assert(
    typeof versions.detox === 'string' && DETOX_VERSION.test(versions.detox),
    `${label}.toolVersions.detox is invalid`,
  );
  assertIdentity(
    row.toolVersionEvidence && (row.toolVersionEvidence as Record<string, unknown>).identity,
    `${label}.toolVersionEvidence.identity`,
  );
  const evidence = row.toolVersionEvidence as Record<string, unknown>;
  assert(evidence.path === DETOX_PACKAGE_RELATIVE, `${label}.toolVersionEvidence.path is invalid`);
  assert(
    typeof evidence.realpath === 'string' && path.isAbsolute(evidence.realpath),
    `${label}.toolVersionEvidence.realpath is invalid`,
  );
  assert(
    Number.isSafeInteger(evidence.bytes) &&
      Number(evidence.bytes) > 0 &&
      Number(evidence.bytes) <= MAX_TOOL_PACKAGE_BYTES,
    `${label}.toolVersionEvidence.bytes is invalid`,
  );
  assertHash(evidence.sha256, `${label}.toolVersionEvidence.sha256`);
  assert(evidence.packageName === 'detox', `${label}.toolVersionEvidence.packageName is invalid`);
  assert(
    evidence.packageVersion === versions.detox,
    `${label}.toolVersionEvidence.packageVersion does not match toolVersions.detox`,
  );
  assert(
    typeof evidence.identity === 'object' && evidence.identity !== null,
    `${label}.toolVersionEvidence.identity is invalid`,
  );
}

export async function revalidateDetoxRuntimeBuildMetadata(
  repositoryRoot: string,
  expected: DetoxRuntimeBuildMetadata,
  fence?: Fence,
): Promise<void> {
  requireDetoxRuntimeBuildMetadata(expected);
  const actual = await readActualDetoxRuntimeMetadata(
    repositoryRoot,
    expected.environmentHash,
    fence,
  );
  assert.deepEqual(
    actual.toolVersions,
    expected.toolVersions,
    'Detox tool versions changed after qualification',
  );
  assert.deepEqual(
    actual.toolVersionEvidence,
    expected.toolVersionEvidence,
    'Detox tool version evidence changed after qualification',
  );
}

export const detoxRuntimeToolPackagePath = DETOX_PACKAGE_RELATIVE;

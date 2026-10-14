import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  readOwnedAndroidBoundedFile,
  requireAndroidSessionCheckpointSet,
  type AndroidSessionCheckpointPhase,
  type AndroidSessionCheckpointReceipt,
} from './native-android-session-adapter';
import { assertTestingDocument } from './schema-validation';

export type AndroidSessionCheckpointCopyReceipt = {
  path: string;
  schema: 'connection-snapshot-v1' | 'domain-snapshot-v1';
  sizeBytes: number;
  sha256: string;
  ownerUid: number;
  mode: 0o600;
  verification: 'owned-capture-checkpoint-copy-v1';
  source: AndroidSessionCheckpointReceipt['profile'] | AndroidSessionCheckpointReceipt['domain'];
};

export type AndroidSessionCheckpointArtifact = {
  phase: AndroidSessionCheckpointPhase;
  profile: AndroidSessionCheckpointCopyReceipt;
  domain: AndroidSessionCheckpointCopyReceipt;
};

export type AndroidSessionCheckpointArtifacts = {
  status: 'verified-before-cleanup';
  root: 'android-session-checkpoints';
  runId: string;
  scope: string;
  apiOrigin: string;
  apiPid: number;
  backendAttemptId: string;
  manifestSha256: string;
  fixtureAuthUidAllowlistHash: string;
  checkpoints: readonly AndroidSessionCheckpointArtifact[];
};

export type AndroidSessionCheckpointApiLifetime = {
  runId: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  backendAttemptId: string;
  manifestSha256: string;
};

const phases: readonly AndroidSessionCheckpointPhase[] = [
  'before-login',
  'after-login',
  'after-restoration',
  'after-signed-out-relaunch',
];

const schemas = {
  profile: 'connection-snapshot-v1',
  domain: 'domain-snapshot-v1',
} as const;

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function readCheckpointDocument(
  file: string,
  runRoot: string,
  basename: string,
  schema: string,
  signal?: AbortSignal,
): Promise<{
  value: unknown;
  bytes: Buffer;
  receipt: {
    path: string;
    schema: string;
    sizeBytes: number;
    sha256: string;
    ownerUid: number;
    mode: number;
    verification: 'owned-runtime-document-v6';
  };
}> {
  const normalizedBasename = path.normalize(basename);
  assert(
    typeof basename === 'string' &&
      basename.length > 0 &&
      !basename.includes('\0') &&
      !path.isAbsolute(basename) &&
      normalizedBasename === basename &&
      normalizedBasename !== '..' &&
      !normalizedBasename.startsWith(`..${path.sep}`),
    'Owned runtime document path escapes the artifact root',
  );
  const loaded = await readOwnedAndroidBoundedFile({
    artifactRoot: runRoot,
    filePath: file,
    label: `Owned runtime document ${basename}`,
    maxBytes: 1_048_576,
    signal,
  });
  assert.equal(loaded.path, basename, 'Owned runtime document path mismatch');
  let value: unknown;
  try {
    value = JSON.parse(loaded.bytes.toString('utf8'));
  } catch {
    throw new Error('Owned runtime document contains invalid JSON');
  }
  assertTestingDocument(schema, value);
  return {
    value,
    bytes: loaded.bytes,
    receipt: {
      path: loaded.path,
      schema,
      sizeBytes: loaded.bytes.byteLength,
      sha256: digest(loaded.bytes),
      ownerUid: loaded.identity.uid,
      mode: loaded.identity.mode & 0o777,
      verification: 'owned-runtime-document-v6',
    },
  };
}

async function requirePrivateDirectory(value: string, label: string): Promise<string> {
  const resolved = await realpath(value);
  assert.equal(resolved, path.resolve(value), `${label} is not canonical`);
  const info = await lstat(resolved);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a regular directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned by this process`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return resolved;
}

function sameSourceReceipt(
  actual: { path: string; sizeBytes: number; sha256: string; ownerUid: number; mode: number },
  expected: { path: string; sizeBytes: number; sha256: string; ownerUid: number; mode: number },
): void {
  assert.equal(actual.path, expected.path, 'checkpoint source path changed');
  assert.equal(actual.sizeBytes, expected.sizeBytes, 'checkpoint source size changed');
  assert.equal(actual.sha256, expected.sha256, 'checkpoint source hash changed');
  assert.equal(actual.ownerUid, expected.ownerUid, 'checkpoint source owner changed');
  assert.equal(actual.mode, expected.mode, 'checkpoint source mode changed');
}

async function copyOne(input: {
  sourceRoot: string;
  captureRoot: string;
  source: AndroidSessionCheckpointCopyReceipt['source'];
  schema: AndroidSessionCheckpointCopyReceipt['schema'];
  destination: string;
  signal?: AbortSignal;
}): Promise<AndroidSessionCheckpointCopyReceipt> {
  input.signal?.throwIfAborted();
  const sourceFile = path.join(input.sourceRoot, input.source.path);
  const first = await readCheckpointDocument(
    sourceFile,
    input.sourceRoot,
    input.source.path,
    input.schema,
    input.signal,
  );
  sameSourceReceipt(first.receipt, input.source);
  const second = await readCheckpointDocument(
    sourceFile,
    input.sourceRoot,
    input.source.path,
    input.schema,
    input.signal,
  );
  sameSourceReceipt(second.receipt, input.source);
  const sourceBytes = second.bytes;
  assert.equal(
    sourceBytes.byteLength,
    input.source.sizeBytes,
    'Checkpoint source size changed while copying',
  );
  assert.equal(
    digest(sourceBytes),
    input.source.sha256,
    'Checkpoint source hash changed while copying',
  );

  const destinationPath = path.join(input.captureRoot, input.destination);
  await writeFile(destinationPath, sourceBytes, { flag: 'wx', mode: 0o600 });
  const copied = await readCheckpointDocument(
    destinationPath,
    input.captureRoot,
    input.destination,
    input.schema,
    input.signal,
  );
  assert.deepEqual(copied.value, first.value, 'Checkpoint copy value changed');
  assert.equal(copied.receipt.sizeBytes, input.source.sizeBytes);
  assert.equal(copied.receipt.sha256, input.source.sha256);
  assert.equal(copied.receipt.mode, 0o600);
  return {
    path: input.destination,
    schema: input.schema,
    sizeBytes: copied.receipt.sizeBytes,
    sha256: copied.receipt.sha256,
    ownerUid: copied.receipt.ownerUid,
    mode: 0o600,
    verification: 'owned-capture-checkpoint-copy-v1',
    source: input.source,
  };
}

function requireApiLifetime(
  actual: AndroidSessionCheckpointApiLifetime,
  expected: {
    runId: string;
    apiOrigin: string;
    apiPid: number;
    apiStarted: string;
    apiScript: string;
    backendAttemptId: string;
    manifestSha256: string;
  },
  label: string,
): void {
  assert.equal(actual.runId, expected.runId, `${label} run changed`);
  assert.equal(actual.apiOrigin, expected.apiOrigin, `${label} origin changed`);
  assert.equal(actual.apiPid, expected.apiPid, `${label} PID changed`);
  assert.equal(actual.apiStarted, expected.apiStarted, `${label} process start changed`);
  assert.equal(actual.apiScript, expected.apiScript, `${label} process script changed`);
  assert.equal(actual.backendAttemptId, expected.backendAttemptId, `${label} attempt changed`);
  assert.equal(actual.manifestSha256, expected.manifestSha256, `${label} manifest changed`);
}

async function revalidateSources(input: {
  sourceRoot: string;
  checkpoints: readonly AndroidSessionCheckpointReceipt[];
  signal?: AbortSignal;
}): Promise<void> {
  for (const checkpoint of input.checkpoints) {
    for (const [source, schema] of [
      [checkpoint.profile, schemas.profile],
      [checkpoint.domain, schemas.domain],
    ] as const) {
      const current = await readCheckpointDocument(
        path.join(input.sourceRoot, source.path),
        input.sourceRoot,
        source.path,
        schema,
        input.signal,
      );
      sameSourceReceipt(current.receipt, source);
    }
  }
}

/**
 * Copy the actual owned profile/domain bytes before owned-session cleanup.
 * The public loader consumes only these capture-root copies; it never reaches
 * back into the backend artifact root after cleanup or substitutes SQL rows.
 */
export async function persistAndroidSessionCheckpointArtifacts(input: {
  outputRoot: string;
  sourceRoot: string;
  checkpoints: readonly AndroidSessionCheckpointReceipt[];
  expectedRunId: string;
  expectedScope: string;
  expectedApiOrigin: string;
  expectedApiPid: number;
  expectedBackendAttemptId: string;
  expectedManifestSha256: string;
  expectedFixtureAuthUidAllowlistHash: string;
  expectedApiStarted: string;
  expectedApiScript: string;
  probeApiLifetime: () => Promise<AndroidSessionCheckpointApiLifetime>;
  signal?: AbortSignal;
}): Promise<AndroidSessionCheckpointArtifacts> {
  const outputRoot = await requirePrivateDirectory(input.outputRoot, 'Android capture root');
  const sourceRoot = await requirePrivateDirectory(input.sourceRoot, 'Android owned artifact root');
  assert.notEqual(outputRoot, sourceRoot, 'Android capture and owned roots must differ');
  const checkpoints = requireAndroidSessionCheckpointSet({
    checkpoints: input.checkpoints,
    expectedRunId: input.expectedRunId,
    expectedScope: input.expectedScope,
    expectedApiOrigin: input.expectedApiOrigin,
    expectedApiPid: input.expectedApiPid,
    expectedBackendAttemptId: input.expectedBackendAttemptId,
    expectedManifestSha256: input.expectedManifestSha256,
    expectedFixtureAuthUidAllowlistHash: input.expectedFixtureAuthUidAllowlistHash,
  });
  const expectedApi = {
    runId: input.expectedRunId,
    apiOrigin: input.expectedApiOrigin,
    apiPid: input.expectedApiPid,
    apiStarted: input.expectedApiStarted,
    apiScript: input.expectedApiScript,
    backendAttemptId: input.expectedBackendAttemptId,
    manifestSha256: input.expectedManifestSha256,
  };
  input.signal?.throwIfAborted();
  requireApiLifetime(await input.probeApiLifetime(), expectedApi, 'Android checkpoint copy start');
  const copyRoot = path.join(outputRoot, 'android-session-checkpoints');
  await mkdir(copyRoot, { mode: 0o700 });
  const copyRootInfo = await stat(copyRoot);
  assert(copyRootInfo.isDirectory());
  assert.equal(copyRootInfo.uid, process.getuid?.());
  assert.equal(copyRootInfo.mode & 0o777, 0o700);

  const copied = [] as AndroidSessionCheckpointArtifact[];
  for (const checkpoint of checkpoints) {
    const directory = path.join('android-session-checkpoints', checkpoint.phase);
    await mkdir(path.join(outputRoot, directory), { mode: 0o700 });
    copied.push({
      phase: checkpoint.phase,
      profile: await copyOne({
        sourceRoot,
        captureRoot: outputRoot,
        source: checkpoint.profile,
        schema: schemas.profile,
        destination: path.join(directory, 'profile.private.json'),
        signal: input.signal,
      }),
      domain: await copyOne({
        sourceRoot,
        captureRoot: outputRoot,
        source: checkpoint.domain,
        schema: schemas.domain,
        destination: path.join(directory, 'domain.private.json'),
        signal: input.signal,
      }),
    });
  }
  input.signal?.throwIfAborted();
  requireApiLifetime(await input.probeApiLifetime(), expectedApi, 'Android checkpoint copy end');
  await revalidateSources({ sourceRoot, checkpoints, signal: input.signal });
  input.signal?.throwIfAborted();
  const finalApiLifetime = await input.probeApiLifetime();
  input.signal?.throwIfAborted();
  requireApiLifetime(finalApiLifetime, expectedApi, 'Android checkpoint copy final');
  return {
    status: 'verified-before-cleanup',
    root: 'android-session-checkpoints',
    runId: input.expectedRunId,
    scope: input.expectedScope,
    apiOrigin: input.expectedApiOrigin,
    apiPid: input.expectedApiPid,
    backendAttemptId: input.expectedBackendAttemptId,
    manifestSha256: input.expectedManifestSha256,
    fixtureAuthUidAllowlistHash: input.expectedFixtureAuthUidAllowlistHash,
    checkpoints: copied,
  };
}

function relativeCopyPath(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  const relative = value as string;
  assert.notEqual(relative, '', `${label} is empty`);
  assert(!path.isAbsolute(relative), `${label} must be relative`);
  assert(!relative.split(/[\\/]/).includes('..'), `${label} escapes the capture root`);
  assert(!relative.includes('\0'), `${label} contains NUL`);
  return relative;
}

function requireCopyReceipt(
  value: unknown,
  source: AndroidSessionCheckpointCopyReceipt['source'],
  schema: AndroidSessionCheckpointCopyReceipt['schema'],
  label: string,
): AndroidSessionCheckpointCopyReceipt {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  const receipt = value as Partial<AndroidSessionCheckpointCopyReceipt>;
  assert.equal(receipt.schema, schema, `${label} schema is wrong`);
  assert.equal(receipt.verification, 'owned-capture-checkpoint-copy-v1');
  const relative = relativeCopyPath(receipt.path, `${label}.path`);
  const sizeBytes = receipt.sizeBytes;
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0)
    throw new Error(`${label}.sizeBytes is invalid`);
  const sha256 = receipt.sha256;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))
    throw new Error(`${label}.sha256 is invalid`);
  const ownerUid = receipt.ownerUid;
  if (typeof ownerUid !== 'number' || !Number.isSafeInteger(ownerUid) || ownerUid <= 0)
    throw new Error(`${label}.ownerUid is invalid`);
  assert.equal(receipt.mode, 0o600);
  assert.deepEqual(receipt.source, source, `${label} is not bound to the original receipt`);
  assert.equal(sizeBytes, source.sizeBytes, `${label} size differs from its source`);
  assert.equal(sha256, source.sha256, `${label} hash differs from its source`);
  return {
    path: relative,
    schema,
    sizeBytes,
    sha256,
    ownerUid,
    mode: 0o600,
    verification: 'owned-capture-checkpoint-copy-v1',
    source,
  };
}

function requireRelativeSourcePath(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  const relative = value as string;
  const normalized = path.normalize(relative);
  assert.notEqual(relative, '', `${label} is empty`);
  assert(!path.isAbsolute(relative), `${label} must be relative`);
  assert.equal(normalized, relative, `${label} is not normalized`);
  assert.notEqual(normalized, '..', `${label} escapes the source root`);
  assert(!normalized.startsWith(`..${path.sep}`), `${label} escapes the source root`);
  assert(!relative.includes('\0'), `${label} contains NUL`);
  return relative;
}

/** Validate the producer-side copy bundle before any copied bytes are parsed. */
export function requireAndroidSessionCheckpointArtifacts(input: {
  value: unknown;
  checkpoints: readonly AndroidSessionCheckpointReceipt[];
  expectedRunId: string;
  expectedScope: string;
  expectedApiOrigin: string;
  expectedApiPid: number;
  expectedBackendAttemptId: string;
  expectedManifestSha256: string;
  expectedFixtureAuthUidAllowlistHash: string;
}): AndroidSessionCheckpointArtifacts {
  const value = input.value;
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Android checkpoint copies are missing',
  );
  const bundle = value as Partial<AndroidSessionCheckpointArtifacts>;
  assert.equal(bundle.status, 'verified-before-cleanup');
  assert.equal(bundle.root, 'android-session-checkpoints');
  assert.equal(bundle.runId, input.expectedRunId);
  assert.equal(bundle.scope, input.expectedScope);
  assert.equal(bundle.apiOrigin, input.expectedApiOrigin);
  assert.equal(bundle.apiPid, input.expectedApiPid);
  assert.equal(bundle.backendAttemptId, input.expectedBackendAttemptId);
  assert.equal(bundle.manifestSha256, input.expectedManifestSha256);
  assert.equal(bundle.fixtureAuthUidAllowlistHash, input.expectedFixtureAuthUidAllowlistHash);
  const originals = requireAndroidSessionCheckpointSet({
    checkpoints: input.checkpoints,
    expectedRunId: input.expectedRunId,
    expectedScope: input.expectedScope,
    expectedApiOrigin: input.expectedApiOrigin,
    expectedApiPid: input.expectedApiPid,
    expectedBackendAttemptId: input.expectedBackendAttemptId,
    expectedManifestSha256: input.expectedManifestSha256,
    expectedFixtureAuthUidAllowlistHash: input.expectedFixtureAuthUidAllowlistHash,
  });
  for (const [index, original] of originals.entries()) {
    requireRelativeSourcePath(
      original.profile.path,
      `Android ${phases[index]} source profile path`,
    );
    requireRelativeSourcePath(original.domain.path, `Android ${phases[index]} source domain path`);
  }
  assert(Array.isArray(bundle.checkpoints));
  assert.equal(bundle.checkpoints.length, phases.length);
  const paths = new Set<string>();
  const copied = bundle.checkpoints.map((row, index) => {
    assert(row && typeof row === 'object' && !Array.isArray(row));
    const item = row as Partial<AndroidSessionCheckpointArtifact>;
    const original = originals[index];
    assert.equal(item.phase, phases[index]);
    const profile = requireCopyReceipt(
      item.profile,
      original.profile,
      schemas.profile,
      `Android ${phases[index]} profile copy`,
    );
    const domain = requireCopyReceipt(
      item.domain,
      original.domain,
      schemas.domain,
      `Android ${phases[index]} domain copy`,
    );
    assert.equal(
      profile.path,
      `android-session-checkpoints/${phases[index]}/profile.private.json`,
      `Android ${phases[index]} profile copy path is outside the producer seam`,
    );
    assert.equal(
      domain.path,
      `android-session-checkpoints/${phases[index]}/domain.private.json`,
      `Android ${phases[index]} domain copy path is outside the producer seam`,
    );
    for (const receipt of [profile, domain]) {
      assert(
        !paths.has(receipt.path),
        `Android checkpoint copy path is duplicated: ${receipt.path}`,
      );
      paths.add(receipt.path);
    }
    return { phase: phases[index], profile, domain };
  });
  return {
    status: 'verified-before-cleanup',
    root: 'android-session-checkpoints',
    runId: input.expectedRunId,
    scope: input.expectedScope,
    apiOrigin: input.expectedApiOrigin,
    apiPid: input.expectedApiPid,
    backendAttemptId: input.expectedBackendAttemptId,
    manifestSha256: input.expectedManifestSha256,
    fixtureAuthUidAllowlistHash: input.expectedFixtureAuthUidAllowlistHash,
    checkpoints: copied,
  };
}

export type AndroidSessionCheckpointDocument = {
  value: unknown;
  receipt: {
    path: string;
    schema: string;
    sizeBytes: number;
    sha256: string;
    ownerUid: number;
    mode: number;
    verification: 'owned-runtime-document-v6';
  };
};

/**
 * Read every copied checkpoint through the owned runtime reader. The metadata
 * validator above deliberately does not make JSON metadata itself evidence;
 * this second step binds each of the eight fixed files to its bytes, schema,
 * owner and private mode after the backend artifact root may be gone.
 */
export async function readAndroidSessionCheckpointArtifacts(input: {
  captureRoot: string;
  artifacts: AndroidSessionCheckpointArtifacts;
  signal?: AbortSignal;
}): Promise<{
  profiles: Readonly<Record<AndroidSessionCheckpointPhase, AndroidSessionCheckpointDocument>>;
  domains: Readonly<Record<AndroidSessionCheckpointPhase, AndroidSessionCheckpointDocument>>;
}> {
  const captureRoot = await requirePrivateDirectory(input.captureRoot, 'Android capture root');
  const profiles = {} as Record<AndroidSessionCheckpointPhase, AndroidSessionCheckpointDocument>;
  const domains = {} as Record<AndroidSessionCheckpointPhase, AndroidSessionCheckpointDocument>;
  for (const checkpoint of input.artifacts.checkpoints) {
    input.signal?.throwIfAborted();
    for (const [kind, schema, target] of [
      ['profile', schemas.profile, profiles],
      ['domain', schemas.domain, domains],
    ] as const) {
      const copy = checkpoint[kind];
      const file = path.join(captureRoot, copy.path);
      const document = await readCheckpointDocument(
        file,
        captureRoot,
        copy.path,
        schema,
        input.signal,
      );
      sameSourceReceipt(document.receipt, {
        path: copy.path,
        sizeBytes: copy.sizeBytes,
        sha256: copy.sha256,
        ownerUid: copy.ownerUid,
        mode: copy.mode,
      });
      assert.equal(
        document.receipt.schema,
        copy.schema,
        `${checkpoint.phase} ${kind} schema changed`,
      );
      target[checkpoint.phase] = document;
    }
  }
  assert.equal(Object.keys(profiles).length, phases.length);
  assert.equal(Object.keys(domains).length, phases.length);
  return { profiles, domains };
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceDirectoryIdentity,
} from './detox-connection-evidence';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
  type NativePilotSelection,
} from './native-pilot-contract';
import { readNativeEvidenceObservation } from './native-view-evidence';
import type { DetoxBaselineReport } from './detox-integrated-session-baseline';
import type { IosDetoxSessionPublicAdapterResult } from './native-detox-session-public-adapter';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const PRIVATE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.json$/u;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export type DetoxSessionAssertionBinding = Readonly<{
  id: string;
  requirementRefs: readonly string[];
  evidencePaths: readonly string[];
}>;

export type DetoxSessionStagingLifecycle = Readonly<{
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}>;

export type DetoxSessionStagedManifest = Readonly<{
  schemaVersion: 1;
  kind: 'private-detox-ios-session-evidence-copy-not-public-receipt';
  status: 'validated';
  owner: 'detox-driver';
  platform: 'ios';
  engine: 'detox';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  sourceRoot: string;
  outputRoot: string;
  scenarioHash: string;
  requirementHash: string;
  fixtureHash: string;
  flagsHash: string;
  toolVersions: Readonly<Record<string, string>>;
  assertionBindings: readonly DetoxSessionAssertionBinding[];
  files: readonly {
    sourcePath: string;
    stagedPath: string;
    bytes: number;
    sha256: string;
  }[];
  nativePassingCases: 0;
  publicPassingCases: 0;
  publicPromotionEligible: false;
}>;

export type DetoxSessionStageResult = Readonly<{
  outputRoot: string;
  manifestPath: string;
  manifest: DetoxSessionStagedManifest;
  copyManifest: { path: string; sha256: string };
  assertions: readonly {
    id: string;
    requirementRefs: readonly string[];
    outcome: 'passed';
    evidencePaths: readonly string[];
  }[];
  artifacts: readonly string[];
}>;

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is malformed`);
  return value as Record<string, unknown>;
}

function fence(lifecycle: DetoxSessionStagingLifecycle, label: string): void {
  lifecycle.signal.throwIfAborted();
  assert(
    Number.isFinite(lifecycle.deadlineAtMonotonicMs),
    'Detox session staging deadline is invalid',
  );
  if (performance.now() >= lifecycle.deadlineAtMonotonicMs)
    throw new Error(`Detox session staging deadline expired: ${label}`);
}

function boundedRead(
  root: string,
  relative: string,
  lifecycle: DetoxSessionStagingLifecycle,
): Promise<Buffer> {
  fence(lifecycle, `read ${relative}:before`);
  assert(
    PRIVATE_NAME.test(path.basename(relative)),
    `Unsafe Detox session evidence name: ${relative}`,
  );
  assert(
    !path.isAbsolute(relative) && !relative.split('/').includes('..'),
    `Detox session evidence escaped its root: ${relative}`,
  );
  const observation = readNativeEvidenceObservation(root, relative, true, 'private-artifact');
  assert(observation.bytes.byteLength > 0 && observation.bytes.byteLength <= MAX_FILE_BYTES);
  fence(lifecycle, `read ${relative}:after`);
  return Promise.resolve(observation.bytes);
}

function sameDirectoryIdentity(
  metadata: { dev: number; ino: number; uid: number; gid: number; mode: number },
  expected: DetoxConnectionEvidenceDirectoryIdentity,
): boolean {
  return (
    metadata.dev === expected.dev &&
    metadata.ino === expected.ino &&
    metadata.uid === expected.uid &&
    metadata.gid === expected.gid &&
    (metadata.mode & 0o777) === (expected.mode & 0o777)
  );
}

async function ensureOutput(
  outputRoot: string,
  expected: DetoxConnectionEvidenceDirectoryIdentity,
): Promise<string> {
  const resolved = path.resolve(outputRoot);
  assert.equal(await realpath(resolved), resolved, 'Detox session output root is not canonical');
  const metadata = await lstat(resolved);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink());
  assert.equal(metadata.mode & 0o777, 0o700);
  if (process.getuid) assert.equal(metadata.uid, process.getuid());
  assert(sameDirectoryIdentity(metadata, expected), 'Detox session output root identity changed');
  return resolved;
}

async function writeNewFile(
  root: string,
  name: string,
  bytes: Buffer,
  lifecycle: DetoxSessionStagingLifecycle,
  expectedRootIdentity: DetoxConnectionEvidenceDirectoryIdentity,
) {
  fence(lifecycle, `write ${name}:before`);
  assert(PRIVATE_NAME.test(name), `Unsafe staged Detox evidence: ${name}`);
  const observed = await writeAtomicDetoxConnectionBytes(root, name, bytes, MAX_FILE_BYTES, {
    signal: lifecycle.signal,
    deadlineAt: lifecycle.deadlineAtMonotonicMs,
    expectedRootIdentity,
  });
  fence(lifecycle, `write ${name}:after`);
  const destination = path.join(root, name);
  const metadata = await lstat(destination);
  assert(metadata.isFile() && !metadata.isSymbolicLink());
  assert.equal(metadata.mode & 0o777, 0o600);
  assert(sameDirectoryIdentity(await lstat(root), expectedRootIdentity));
  assert.deepEqual(observed.bytes, bytes, `Trusted Detox writer changed bytes: ${name}`);
  return destination;
}

function evidenceNames(report: DetoxBaselineReport): readonly string[] {
  assert(Array.isArray(report.evidenceFiles) && report.evidenceFiles.length > 0);
  const rawFiles: unknown = report.evidenceFiles;
  assert(Array.isArray(rawFiles));
  const files = rawFiles as readonly unknown[];
  const names: string[] = [];
  for (const file of files) {
    assert(
      file && typeof file === 'object' && 'name' in file && typeof file.name === 'string',
      'Detox evidence file name is malformed',
    );
    names.push(file.name);
  }
  assert.equal(new Set(names).size, names.length, 'Detox evidence names are duplicated');
  for (const name of names)
    assert(PRIVATE_NAME.test(name), `Detox evidence name is unsafe: ${name}`);
  return names;
}

function sessionEvidenceNames(report: DetoxBaselineReport): readonly string[] {
  const names = new Set(evidenceNames(report));
  names.add('detox-integrated-session-baseline.private.json');
  names.add('detox-session-public-adapter.private.json');
  return [...names].sort();
}

export function buildDetoxSessionAssertionBindings(
  selection: NativePilotSelection,
  report: DetoxBaselineReport,
): readonly DetoxSessionAssertionBinding[] {
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...nativeSessionAssertionIds],
  );
  const names = sessionEvidenceNames(report).map(
    (name) => `evidence/${report.captureRunId}/${name}`,
  );
  assert(names.length > 0, 'Detox session has no retained evidence paths');
  const ledger = requireNativePilotAssertions(selection);
  return ledger.map((row) => ({
    id: row.id,
    requirementRefs: [...row.requirementRefs],
    evidencePaths: [...names],
  }));
}

function parseManifest(value: unknown): DetoxSessionStagedManifest {
  const row = record(value, 'Detox staged session manifest');
  assert.equal(row.kind, 'private-detox-ios-session-evidence-copy-not-public-receipt');
  assert.equal(row.status, 'validated');
  assert.equal(row.nativePassingCases, 0);
  assert.equal(row.publicPassingCases, 0);
  assert.equal(row.publicPromotionEligible, false);
  assert(typeof row.requestedRunId === 'string' && RUN_ID.test(row.requestedRunId));
  assert(typeof row.requestedAttemptId === 'string');
  assert(Array.isArray(row.files));
  assert(Array.isArray(row.assertionBindings));
  return row as unknown as DetoxSessionStagedManifest;
}

export async function stageDetoxSessionPublicEvidence(
  input: Readonly<{
    captureRoot: string;
    outputRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    report: DetoxBaselineReport;
    adapter: IosDetoxSessionPublicAdapterResult;
    expectedOutputRootIdentity: DetoxConnectionEvidenceDirectoryIdentity;
    lifecycle: DetoxSessionStagingLifecycle;
  }>,
): Promise<DetoxSessionStageResult> {
  fence(input.lifecycle, 'stage start');
  assert.match(input.requestedRunId, RUN_ID);
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(input.report.captureRunId, input.requestedRunId);
  assert.equal(input.adapter.terminal, 'private-verified');
  assert.equal(input.adapter.terminalReceiptBound, true);
  assert.equal(input.adapter.verificationResult, 'passed');
  assert(input.adapter.fixtureHash && HASH.test(input.adapter.fixtureHash));
  assert(input.adapter.flagsHash && HASH.test(input.adapter.flagsHash));
  assert.equal(input.report.kind, 'private-detox-integrated-session-baseline-not-public-receipt');
  assert.equal(input.report.result, 'passed');
  assert.deepEqual(input.adapter.evidenceFiles, input.report.evidenceFiles);
  const sourceRoot = path.resolve(input.captureRoot);
  const outputRoot = await ensureOutput(input.outputRoot, input.expectedOutputRootIdentity);
  assert.notEqual(sourceRoot, outputRoot);
  const names = sessionEvidenceNames(input.report);
  const assertionBindings = buildDetoxSessionAssertionBindings(input.selection, input.report);
  const files: DetoxSessionStagedManifest['files'][number][] = [];
  const expectedByName = new Map(input.report.evidenceFiles.map((file) => [file.name, file]));
  for (const name of names) {
    const bytes = await boundedRead(sourceRoot, name, input.lifecycle);
    const expected = expectedByName.get(name);
    if (expected) {
      assert.equal(
        bytes.byteLength,
        expected.bytes,
        `Detox evidence size changed before staging: ${name}`,
      );
      assert.equal(
        hash(bytes),
        expected.sha256,
        `Detox evidence hash changed before staging: ${name}`,
      );
    }
    const stagedPath = `detox-session-${input.report.captureRunId}-${name}`;
    await writeNewFile(
      outputRoot,
      stagedPath,
      bytes,
      input.lifecycle,
      input.expectedOutputRootIdentity,
    );
    const reread = await boundedRead(outputRoot, stagedPath, input.lifecycle);
    assert.deepEqual(reread, bytes, `Staged Detox session evidence changed: ${name}`);
    files.push({ sourcePath: name, stagedPath, bytes: bytes.byteLength, sha256: hash(bytes) });
  }
  const manifest: DetoxSessionStagedManifest = {
    schemaVersion: 1,
    kind: 'private-detox-ios-session-evidence-copy-not-public-receipt',
    status: 'validated',
    owner: 'detox-driver',
    platform: 'ios',
    engine: 'detox',
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRunId: input.report.captureRunId,
    sourceRoot,
    outputRoot,
    scenarioHash: input.adapter.scenarioHash,
    requirementHash: input.adapter.requirementHash,
    fixtureHash: input.adapter.fixtureHash,
    flagsHash: input.adapter.flagsHash,
    toolVersions: input.adapter.toolVersions,
    assertionBindings,
    files,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
  };
  const manifestPath = `detox-session-${input.report.captureRunId}-copy-manifest.private.json`;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await writeNewFile(
    outputRoot,
    manifestPath,
    manifestBytes,
    input.lifecycle,
    input.expectedOutputRootIdentity,
  );
  const manifestRead = await boundedRead(outputRoot, manifestPath, input.lifecycle);
  assert.deepEqual(manifestRead, manifestBytes);
  const assertions = assertionBindings.map((row) => ({
    id: row.id,
    requirementRefs: row.requirementRefs,
    outcome: 'passed' as const,
    evidencePaths: row.evidencePaths,
  }));
  const artifacts = [manifestPath, ...files.map((file) => file.stagedPath)];
  return {
    outputRoot,
    manifestPath,
    manifest,
    copyManifest: { path: manifestPath, sha256: hash(manifestBytes) },
    assertions,
    artifacts,
  };
}

export async function verifyStagedDetoxSessionEvidence(
  input: Readonly<{
    outputRoot: string;
    copyManifest: { path: string; sha256: string };
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    expectedOutputRootIdentity: DetoxConnectionEvidenceDirectoryIdentity;
    lifecycle: DetoxSessionStagingLifecycle;
  }>,
): Promise<DetoxSessionStagedManifest> {
  fence(input.lifecycle, 'verify start');
  const outputRoot = await ensureOutput(input.outputRoot, input.expectedOutputRootIdentity);
  const manifestBytes = await boundedRead(outputRoot, input.copyManifest.path, input.lifecycle);
  assert.equal(
    hash(manifestBytes),
    input.copyManifest.sha256,
    'Detox session copy manifest changed',
  );
  const manifest = parseManifest(JSON.parse(manifestBytes.toString('utf8')));
  assert.equal(manifest.requestedRunId, input.requestedRunId);
  assert.equal(manifest.requestedAttemptId, input.requestedAttemptId);
  assert.deepEqual(
    manifest.assertionBindings.map((row) => row.id),
    [...nativeSessionAssertionIds],
  );
  assert.deepEqual(
    manifest.assertionBindings,
    buildDetoxSessionAssertionBindings(input.selection, {
      captureRunId: manifest.captureRunId,
      evidenceFiles: manifest.files.map((file) => ({
        name: file.sourcePath,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
    } as unknown as DetoxBaselineReport),
  );
  for (const file of manifest.files) {
    const bytes = await boundedRead(outputRoot, file.stagedPath, input.lifecycle);
    assert.equal(
      bytes.byteLength,
      file.bytes,
      `Detox staged evidence size changed: ${file.stagedPath}`,
    );
    assert.equal(
      hash(bytes),
      file.sha256,
      `Detox staged evidence hash changed: ${file.stagedPath}`,
    );
  }
  return manifest;
}

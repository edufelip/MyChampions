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
  createAndroidDetoxSessionOwnedChildDirectory,
  prepareAndroidDetoxSessionPublicOutputRoot,
  type AndroidDetoxSessionDirectoryIdentity,
  type AndroidDetoxSessionStagingLifecycle,
  type AndroidDetoxSessionStagingOutput,
} from './native-detox-android-session-public-staging';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
  type NativePilotSelection,
} from './native-pilot-contract';
import { readNativeEvidenceObservation } from './native-view-evidence';
import type { DetoxBaselineReport } from './detox-integrated-session-baseline';
import type { AndroidDetoxSessionPublicAdapterResult } from './native-detox-android-session-public-adapter';

const RUN_ID = /^[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const PRIVATE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.(?:json|xml|png)$/u;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const androidDetoxSessionVerifiedTerminalEvidenceName =
  'detox-android-session-verified-terminal.private.json';
const expectedSessionUiStepIds = [
  'NAT-session-login',
  'NAT-session-restore',
  'NAT-session-account',
  'NAT-session-signout',
  'NAT-session-signed-out-relaunch',
] as const;

type AndroidDetoxSessionEvidenceReport = Pick<
  DetoxBaselineReport,
  'captureRunId' | 'evidenceFiles'
>;

export type AndroidDetoxSessionAssertionBinding = Readonly<{
  id: string;
  requirementRefs: readonly string[];
  evidencePaths: readonly string[];
}>;

export type AndroidDetoxSessionStagedManifest = Readonly<{
  schemaVersion: 1;
  kind: 'private-detox-android-session-evidence-copy-not-public-receipt';
  status: 'validated';
  owner: 'detox-driver';
  platform: 'android';
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
  ownedProducerKind: 'owned-android-detox-session-producer';
  independentCleanup: 'passed';
  serverRevocation: 'decision-needed';
  assertionBindings: readonly AndroidDetoxSessionAssertionBinding[];
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

export type AndroidDetoxSessionStageResult = Readonly<{
  outputRoot: string;
  outputIdentity: AndroidDetoxSessionDirectoryIdentity;
  manifestPath: string;
  manifest: AndroidDetoxSessionStagedManifest;
  copyManifest: { path: string; sha256: string };
  assertions: readonly {
    id: string;
    requirementRefs: readonly string[];
    outcome: 'passed';
    evidencePaths: readonly string[];
  }[];
  artifacts: readonly string[];
}>;

export type AndroidDetoxSessionFinalizationLifecycle = AndroidDetoxSessionStagingLifecycle;

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is malformed`);
  return value as Record<string, unknown>;
}

function fence(lifecycle: AndroidDetoxSessionStagingLifecycle, label: string): void {
  lifecycle.signal.throwIfAborted();
  assert(
    Number.isFinite(lifecycle.deadlineAtMonotonicMs),
    'Android Detox finalization deadline is invalid',
  );
  if (performance.now() >= lifecycle.deadlineAtMonotonicMs)
    throw new Error(`Android Detox finalization deadline expired: ${label}`);
}

function writerIdentity(
  identity: AndroidDetoxSessionDirectoryIdentity,
): DetoxConnectionEvidenceDirectoryIdentity {
  return {
    dev: identity.dev,
    ino: identity.ino,
    uid: identity.uid,
    gid: identity.gid,
    mode: identity.mode,
  };
}

async function ensureOutput(
  outputRoot: string,
  expected: DetoxConnectionEvidenceDirectoryIdentity,
): Promise<string> {
  const resolved = path.resolve(outputRoot);
  assert.equal(await realpath(resolved), resolved, 'Android Detox final output is not canonical');
  const metadata = await lstat(resolved);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink());
  assert.equal(metadata.mode & 0o777, 0o700);
  if (process.getuid) assert.equal(metadata.uid, process.getuid());
  assert.equal(metadata.dev, expected.dev);
  assert.equal(metadata.ino, expected.ino);
  assert.equal(metadata.uid, expected.uid);
  assert.equal(metadata.gid, expected.gid);
  assert.equal(metadata.mode & 0o777, expected.mode & 0o777);
  return resolved;
}

function boundedRead(
  root: string,
  relative: string,
  lifecycle: AndroidDetoxSessionStagingLifecycle,
): Buffer {
  fence(lifecycle, `read ${relative}:before`);
  assert(
    PRIVATE_NAME.test(path.basename(relative)),
    `Unsafe Android Detox evidence name: ${relative}`,
  );
  assert(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
  const observation = readNativeEvidenceObservation(root, relative, true, 'private-artifact');
  assert(observation.bytes.byteLength > 0 && observation.bytes.byteLength <= MAX_FILE_BYTES);
  fence(lifecycle, `read ${relative}:after`);
  return observation.bytes;
}

async function writeNewFile(
  root: string,
  name: string,
  bytes: Buffer,
  lifecycle: AndroidDetoxSessionStagingLifecycle,
  expected: DetoxConnectionEvidenceDirectoryIdentity,
): Promise<string> {
  fence(lifecycle, `write ${name}:before`);
  assert(PRIVATE_NAME.test(name), `Unsafe staged Android Detox evidence: ${name}`);
  const observed = await writeAtomicDetoxConnectionBytes(root, name, bytes, MAX_FILE_BYTES, {
    signal: lifecycle.signal,
    deadlineAt: lifecycle.deadlineAtMonotonicMs,
    expectedRootIdentity: expected,
    checkLive: () => fence(lifecycle, `write ${name}:publication`),
  });
  fence(lifecycle, `write ${name}:after`);
  const destination = path.join(root, name);
  const metadata = await lstat(destination);
  assert(metadata.isFile() && !metadata.isSymbolicLink());
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.deepEqual(observed.bytes, bytes, `Android Detox writer changed bytes: ${name}`);
  return destination;
}

function evidenceNames(report: AndroidDetoxSessionEvidenceReport): readonly string[] {
  const evidenceFiles = report.evidenceFiles;
  assert(evidenceFiles.length > 0, 'Android Detox evidence files are missing');
  const names: string[] = evidenceFiles.map((file) => file.name);
  assert.equal(new Set(names).size, names.length, 'Android Detox evidence names are duplicated');
  for (const name of names)
    assert(PRIVATE_NAME.test(name), `Android Detox evidence name is unsafe: ${name}`);
  return names;
}

function sessionEvidenceNames(report: AndroidDetoxSessionEvidenceReport): readonly string[] {
  const names = new Set(evidenceNames(report));
  names.add('detox-integrated-session-baseline.private.json');
  names.add('detox-android-session-public-adapter.private.json');
  return [...names].sort();
}

export function buildAndroidDetoxSessionAssertionBindings(
  selection: NativePilotSelection,
  report: AndroidDetoxSessionEvidenceReport,
): readonly AndroidDetoxSessionAssertionBinding[] {
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...nativeSessionAssertionIds],
  );
  const evidencePaths = [
    ...new Set(
      sessionEvidenceNames(report).map((name) => `evidence/${report.captureRunId}/${name}`),
    ),
  ];
  const ledger = requireNativePilotAssertions(selection);
  return ledger.map((row) => ({
    id: row.id,
    requirementRefs: [...row.requirementRefs],
    evidencePaths,
  }));
}

function parseManifest(value: unknown): AndroidDetoxSessionStagedManifest {
  const row = record(value, 'Android Detox staged session manifest');
  assert.equal(row.kind, 'private-detox-android-session-evidence-copy-not-public-receipt');
  assert.equal(row.status, 'validated');
  assert.equal(row.platform, 'android');
  assert.equal(row.engine, 'detox');
  assert.equal(row.ownedProducerKind, 'owned-android-detox-session-producer');
  assert.equal(row.independentCleanup, 'passed');
  assert.equal(row.serverRevocation, 'decision-needed');
  assert.equal(row.nativePassingCases, 0);
  assert.equal(row.publicPassingCases, 0);
  assert.equal(row.publicPromotionEligible, false);
  assert(typeof row.requestedRunId === 'string' && RUN_ID.test(row.requestedRunId));
  assert(Array.isArray(row.files));
  assert(Array.isArray(row.assertionBindings));
  return row as unknown as AndroidDetoxSessionStagedManifest;
}

async function prepareFreshOutput(
  input: Readonly<{
    captureRoot: string;
    outputRoot: string;
    lifecycle: AndroidDetoxSessionFinalizationLifecycle;
  }>,
): Promise<AndroidDetoxSessionStagingOutput> {
  // This is the only output-root creation path. V6 opens and rechecks the
  // parent descriptor and retains a recovery ledger on an ancestor exchange.
  return prepareAndroidDetoxSessionPublicOutputRoot(input);
}

export async function stageAndroidDetoxSessionPublicEvidence(
  input: Readonly<{
    captureRoot: string;
    outputRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    report: DetoxBaselineReport;
    adapter: AndroidDetoxSessionPublicAdapterResult;
    lifecycle: AndroidDetoxSessionFinalizationLifecycle;
  }>,
): Promise<AndroidDetoxSessionStageResult> {
  fence(input.lifecycle, 'stage start');
  assert(RUN_ID.test(input.requestedRunId));
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(input.adapter.requestedRunId, input.requestedRunId);
  assert.equal(input.adapter.requestedAttemptId, input.requestedAttemptId);
  assert.equal(input.report.captureRunId, input.adapter.captureRunId);
  assert.equal(input.report.platform, 'android');
  assert.equal(input.adapter.platform, 'android');
  assert.equal(input.adapter.terminal, 'private-verified');
  assert.equal(input.adapter.terminalReceiptBound, true);
  assert.equal(input.adapter.verificationResult, 'passed');
  assert.equal(input.adapter.ownedProducerKind, 'owned-android-detox-session-producer');
  assert.equal(input.adapter.independentCleanup, 'passed');
  assert.equal(input.adapter.serverRevocation, 'decision-needed');
  assert(input.adapter.fixtureHash && HASH.test(input.adapter.fixtureHash));
  assert(input.adapter.flagsHash && HASH.test(input.adapter.flagsHash));
  assert.equal(input.report.result, 'passed');
  assert.deepEqual(input.adapter.evidenceFiles, input.report.evidenceFiles);
  const sourceRoot = path.resolve(input.captureRoot);
  const prepared = await prepareFreshOutput(input);
  const outputRoot = await ensureOutput(prepared.outputRoot, writerIdentity(prepared.identity));
  assert.notEqual(sourceRoot, outputRoot);
  const names = sessionEvidenceNames(input.report);
  const assertionBindings = buildAndroidDetoxSessionAssertionBindings(
    input.selection,
    input.report,
  );
  const files: AndroidDetoxSessionStagedManifest['files'][number][] = [];
  const expectedByName = new Map(input.report.evidenceFiles.map((file) => [file.name, file]));
  for (const name of names) {
    const bytes = boundedRead(sourceRoot, name, input.lifecycle);
    const expected = expectedByName.get(name);
    if (expected) {
      assert.equal(
        bytes.byteLength,
        expected.bytes,
        `Android Detox evidence size changed: ${name}`,
      );
      assert.equal(hash(bytes), expected.sha256, `Android Detox evidence hash changed: ${name}`);
    }
    const stagedPath = `detox-android-session-${input.report.captureRunId}-${name}`;
    await writeNewFile(
      outputRoot,
      stagedPath,
      bytes,
      input.lifecycle,
      writerIdentity(prepared.identity),
    );
    assert.deepEqual(boundedRead(outputRoot, stagedPath, input.lifecycle), bytes);
    files.push({
      sourcePath: name,
      stagedPath,
      bytes: bytes.byteLength,
      sha256: hash(bytes),
    });
  }
  const manifest: AndroidDetoxSessionStagedManifest = {
    schemaVersion: 1,
    kind: 'private-detox-android-session-evidence-copy-not-public-receipt',
    status: 'validated',
    owner: 'detox-driver',
    platform: 'android',
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
    ownedProducerKind: input.adapter.ownedProducerKind,
    independentCleanup: input.adapter.independentCleanup,
    serverRevocation: input.adapter.serverRevocation,
    assertionBindings,
    files,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
  };
  const manifestPath = `detox-android-session-${input.report.captureRunId}-copy-manifest.private.json`;
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeNewFile(
    outputRoot,
    manifestPath,
    manifestBytes,
    input.lifecycle,
    writerIdentity(prepared.identity),
  );
  assert.deepEqual(boundedRead(outputRoot, manifestPath, input.lifecycle), manifestBytes);
  return {
    outputRoot,
    outputIdentity: prepared.identity,
    manifestPath,
    manifest,
    copyManifest: { path: manifestPath, sha256: hash(manifestBytes) },
    assertions: assertionBindings.map((row) => ({
      ...row,
      outcome: 'passed' as const,
    })),
    artifacts: [manifestPath, ...files.map((file) => file.stagedPath)],
  };
}

export async function verifyStagedAndroidDetoxSessionEvidence(
  input: Readonly<{
    outputRoot: string;
    outputIdentity: AndroidDetoxSessionDirectoryIdentity;
    copyManifest: { path: string; sha256: string };
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    lifecycle: AndroidDetoxSessionFinalizationLifecycle;
  }>,
): Promise<AndroidDetoxSessionStagedManifest> {
  fence(input.lifecycle, 'verify start');
  const outputRoot = await ensureOutput(input.outputRoot, writerIdentity(input.outputIdentity));
  const manifestBytes = boundedRead(outputRoot, input.copyManifest.path, input.lifecycle);
  assert.equal(
    hash(manifestBytes),
    input.copyManifest.sha256,
    'Android Detox copy manifest changed',
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
    buildAndroidDetoxSessionAssertionBindings(input.selection, {
      captureRunId: manifest.captureRunId,
      evidenceFiles: manifest.files.map((file) => ({
        name: file.sourcePath,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
    }),
  );
  for (const file of manifest.files) {
    const bytes = boundedRead(outputRoot, file.stagedPath, input.lifecycle);
    assert.equal(
      bytes.byteLength,
      file.bytes,
      `Android Detox staged size changed: ${file.stagedPath}`,
    );
    assert.equal(hash(bytes), file.sha256, `Android Detox staged hash changed: ${file.stagedPath}`);
  }
  return manifest;
}

export function buildAndroidDetoxSessionVerifiedTerminalProof(
  input: Readonly<{
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    report: DetoxBaselineReport;
    adapter: AndroidDetoxSessionPublicAdapterResult;
    staged: AndroidDetoxSessionStageResult;
    verifiedManifest: AndroidDetoxSessionStagedManifest;
  }>,
): string {
  assert.match(input.requestedRunId, RUN_ID);
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(input.adapter.terminal, 'private-verified');
  assert.equal(input.adapter.terminalReceiptBound, true);
  assert.equal(input.adapter.verificationResult, 'passed');
  assert.equal(input.adapter.ownedProducerKind, 'owned-android-detox-session-producer');
  assert.equal(input.adapter.independentCleanup, 'passed');
  assert.equal(input.adapter.serverRevocation, 'decision-needed');
  assert.equal(input.report.result, 'passed');
  assert(input.report.snapshots, 'Android session snapshot checkpoints are missing');
  assert.deepEqual(input.report.snapshots.checkpointIds, [
    'beforeLogin',
    'afterLogin',
    'afterRestoration',
    'afterSignedOutRelaunch',
  ]);
  assert(input.report.sessionCache, 'Android session cache checkpoints are missing');
  assert.equal(input.report.sessionCache.afterSignout.status, 'session-absent');
  assert.equal(input.report.sessionCache.afterSignedOutRelaunch.status, 'session-absent');
  assert(input.report.ui, 'Android protected UI assertions are missing');
  assert.equal(input.report.ui.launchCount, 3);
  assert.deepEqual(input.report.ui.assertionIds, [...nativeSessionAssertionIds]);
  assert.deepEqual(input.staged.manifest, input.verifiedManifest);
  assert.equal(input.verifiedManifest.requestedRunId, input.requestedRunId);
  assert.equal(input.verifiedManifest.requestedAttemptId, input.requestedAttemptId);
  assert.deepEqual(
    input.verifiedManifest.assertionBindings.map((row) => row.id),
    [...nativeSessionAssertionIds],
  );
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: 'private-android-detox-session-verified-terminal-facts-not-public-receipt',
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      captureRunId: input.verifiedManifest.captureRunId,
      selection: input.selection.arguments,
      scenarioHash: input.verifiedManifest.scenarioHash,
      requirementHash: input.verifiedManifest.requirementHash,
      fixtureHash: input.verifiedManifest.fixtureHash,
      flagsHash: input.verifiedManifest.flagsHash,
      toolVersions: input.verifiedManifest.toolVersions,
      ownedProducerKind: input.verifiedManifest.ownedProducerKind,
      independentCleanup: input.verifiedManifest.independentCleanup,
      serverRevocation: input.verifiedManifest.serverRevocation,
      storageCheckpoints: input.report.snapshots.checkpointIds,
      localSessionCache: {
        afterSignout: input.report.sessionCache.afterSignout.status,
        afterSignedOutRelaunch: input.report.sessionCache.afterSignedOutRelaunch.status,
      },
      protectedUi: {
        launchCount: input.report.ui.launchCount,
        assertionIds: expectedSessionUiStepIds,
      },
      copyManifest: input.staged.copyManifest,
      stagingOutputRoot: input.verifiedManifest.outputRoot,
      assertions: input.verifiedManifest.assertionBindings,
      files: input.verifiedManifest.files,
      nativePassingCases: 0,
      publicPassingCases: 0,
      publicPromotionEligible: false,
    },
    null,
    2,
  )}\n`;
}

export function mapAndroidDetoxSessionAssertionsToOuterTerminal(
  input: Readonly<{
    assertions: readonly {
      id: string;
      requirementRefs: readonly string[];
      outcome: 'passed';
      evidencePaths: readonly string[];
    }[];
    terminalEvidencePath: string;
  }>,
): {
  id: string;
  requirementRefs: string[];
  outcome: 'passed';
  evidencePaths: string[];
}[] {
  assert(PRIVATE_NAME.test(path.basename(input.terminalEvidencePath)));
  return input.assertions.map((assertion) => ({
    id: assertion.id,
    requirementRefs: [...assertion.requirementRefs],
    outcome: assertion.outcome,
    // Public receipt schema requires unique evidence paths per assertion. The
    // runner writes these bounded aliases as byte-identical copies of the
    // independently verified terminal proof; no alias is a new runtime fact.
    evidencePaths: Array.from(
      { length: Math.max(1, Math.min(assertion.evidencePaths.length, 2)) },
      (_, index) =>
        index === 0
          ? input.terminalEvidencePath
          : `${path.basename(input.terminalEvidencePath, '.private.json')}-${assertion.id}-${index}.private.json`,
    ),
  }));
}

export { createAndroidDetoxSessionOwnedChildDirectory, prepareAndroidDetoxSessionPublicOutputRoot };

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  DETOX_CAMERA_ASSERTIONS,
  requireDetoxCameraAuthObservationReceipt,
  requireDetoxCameraBootstrapEvidence,
  requireDetoxCameraCleanup,
  type DetoxCameraCleanup,
  type DetoxCameraAttemptReport,
  type DetoxCameraTerminal,
} from './native-detox-camera-ios-contract';
import {
  requireDetoxCameraEvidenceLive,
  type DetoxCameraEvidenceLifecycle,
} from './native-detox-camera-ios-evidence';
import type {
  DetoxCameraOwnerResult,
  DetoxCameraRuntimeFacts,
} from './native-detox-camera-ios-owner';
import type { DetoxCameraStageResult } from './native-detox-camera-ios-stage';

type PrivateJsonRead = {
  value: unknown;
  path: string;
  sha256: string;
  bytes: number;
  mode: number;
};

export type DetoxCameraOuterVerification = Readonly<{
  kind: 'detox-ios-camera-outer-verification';
  reportPath: string;
  stagePath: string;
  terminalPath: string;
  ownerRunId: string;
  ownerAttemptId: string;
  assertionBindings: readonly {
    id: string;
    evidencePaths: string[];
  }[];
  artifacts: string[];
}>;

function descendant(root: string, candidate: string): string {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const child = relative(rootPath, candidatePath);
  assert(child.length > 0, 'Detox camera verifier path must be below its output root');
  assert(!child.startsWith('..') && !child.startsWith('/'), 'Detox camera verifier path escaped');
  return candidatePath;
}

async function readPrivateBytes(
  filePath: string,
  label: string,
  lifecycle: DetoxCameraEvidenceLifecycle,
): Promise<PrivateJsonRead> {
  await requireDetoxCameraEvidenceLive(lifecycle);
  const before = await lstat(filePath);
  assert(before.isFile() && !before.isSymbolicLink(), `${label} is not a regular file`);
  assert.equal(before.nlink, 1, `${label} has multiple links`);
  assert.equal(before.mode & 0o777, 0o600, `${label} is not private`);
  assert(before.size <= 8 * 1024 * 1024, `${label} exceeds the verifier bound`);
  await requireDetoxCameraEvidenceLive(lifecycle);
  const fd = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await fd.stat();
    await requireDetoxCameraEvidenceLive(lifecycle);
    assert.equal(opened.dev, before.dev, `${label} device changed`);
    assert.equal(opened.ino, before.ino, `${label} inode changed`);
    assert.equal(opened.uid, before.uid, `${label} owner changed`);
    assert.equal(opened.gid, before.gid, `${label} group changed`);
    assert.equal(opened.mode, before.mode, `${label} mode changed`);
    assert.equal(opened.nlink, before.nlink, `${label} link count changed`);
    assert.equal(opened.size, before.size, `${label} size changed`);
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      await requireDetoxCameraEvidenceLive(lifecycle);
      const read = await fd.read(bytes, offset, bytes.length - offset, offset);
      assert(read.bytesRead > 0, `${label} ended early`);
      offset += read.bytesRead;
    }
    const after = await fd.stat();
    await requireDetoxCameraEvidenceLive(lifecycle);
    assert.equal(after.dev, opened.dev, `${label} device changed while reading`);
    assert.equal(after.ino, opened.ino, `${label} inode changed while reading`);
    assert.equal(after.size, opened.size, `${label} size changed while reading`);
    assert.equal(after.mtimeMs, opened.mtimeMs, `${label} mtime changed while reading`);
    assert.equal(after.ctimeMs, opened.ctimeMs, `${label} ctime changed while reading`);
    return {
      value: bytes,
      path: resolve(filePath),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      mode: before.mode & 0o777,
    };
  } finally {
    await fd.close();
  }
}

async function readPrivateJson(
  filePath: string,
  label: string,
  lifecycle: DetoxCameraEvidenceLifecycle,
): Promise<PrivateJsonRead> {
  const read = await readPrivateBytes(filePath, label, lifecycle);
  return {
    ...read,
    value: JSON.parse((read.value as Buffer).toString('utf8')) as unknown,
  };
}

function parseTerminal(value: unknown): DetoxCameraTerminal {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Camera terminal is malformed',
  );
  return value as DetoxCameraTerminal;
}

function parseReport(value: unknown): DetoxCameraAttemptReport {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Camera report is malformed');
  return value as DetoxCameraAttemptReport;
}

function parseStage(value: unknown): DetoxCameraStageResult {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Camera stage is malformed');
  return value as DetoxCameraStageResult;
}

function relativeArtifact(outputRoot: string, absolutePath: string): string {
  const path = descendant(outputRoot, absolutePath);
  const value = relative(resolve(outputRoot), path);
  assert(value.length > 0 && !value.startsWith('..') && !value.startsWith('/'));
  return value;
}

export function requireDetoxCameraRuntimeFacts(facts: DetoxCameraRuntimeFacts | null): void {
  assert(facts, 'Detox camera runtime facts are unavailable');
  assert.equal(facts.childClassification, 'completed');
  assert.equal(facts.childExitCode, 0);
  assert.equal(facts.childSignal, null);
  assert.match(facts.flagsHash ?? '', /^[a-f0-9]{64}$/);
  for (const [name, value] of Object.entries(facts.timingsMs)) {
    assert(Number.isFinite(value) && value > 0, `Detox camera ${name} timing is unavailable`);
  }
}

export function requireDetoxCameraTerminalCleanup(
  terminalCleanup: DetoxCameraCleanup,
  reportCleanup: DetoxCameraCleanup,
): void {
  requireDetoxCameraCleanup(terminalCleanup);
  assert.deepEqual(
    terminalCleanup,
    reportCleanup,
    'Detox camera terminal cleanup does not equal the original cleanup receipt',
  );
}

function requireSourceRef(
  root: string,
  ref: { path: string; sha256: string; bytes: number; mode: number },
  lifecycle: DetoxCameraEvidenceLifecycle,
): Promise<PrivateJsonRead> {
  const path = descendant(root, ref.path);
  return readPrivateBytes(path, `Detox camera staged source ${ref.path}`, lifecycle).then(
    (read) => {
      assert.equal(read.sha256, ref.sha256, `Detox camera staged source hash changed: ${ref.path}`);
      assert.equal(read.bytes, ref.bytes, `Detox camera staged source size changed: ${ref.path}`);
      assert.equal(read.mode, ref.mode, `Detox camera staged source mode changed: ${ref.path}`);
      return read;
    },
  );
}

export async function verifyDetoxIosCameraPrivateEvidence(options: {
  result: DetoxCameraOwnerResult;
  runtimeFacts: DetoxCameraRuntimeFacts | null;
  artifactRoot: string;
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  lifecycle: DetoxCameraEvidenceLifecycle;
}): Promise<DetoxCameraOuterVerification> {
  await requireDetoxCameraEvidenceLive(options.lifecycle);
  requireDetoxCameraRuntimeFacts(options.runtimeFacts);
  assert.equal(options.result.runtimeFacts, options.runtimeFacts);
  const outputRoot = resolve(options.outputRoot);
  const artifactRoot = resolve(options.artifactRoot);
  const terminalPath = descendant(
    artifactRoot,
    `${artifactRoot}/detox-camera-terminal.private.json`,
  );
  const terminalRead = await readPrivateJson(
    terminalPath,
    'Detox camera terminal',
    options.lifecycle,
  );
  const terminal = parseTerminal(terminalRead.value);
  assert.equal(terminal.kind, 'detox-ios-camera-terminal');
  assert.equal(terminal.result, 'verified-private');
  assert.deepEqual(terminal.assertionIds, DETOX_CAMERA_ASSERTIONS);
  assert.equal(terminal.publicPromotionEligible, false);

  const reportPath = descendant(artifactRoot, terminal.reportPath);
  const reportRead = await readPrivateJson(reportPath, 'Detox camera report', options.lifecycle);
  assert.equal(reportRead.sha256, terminal.reportSha256, 'Detox camera report hash changed');
  const report = parseReport(reportRead.value);
  const reportBootstrapEvidence = requireDetoxCameraBootstrapEvidence(
    report.bootstrapEvidence,
    report.owner,
  );
  const reportAuthObservationReceipt = requireDetoxCameraAuthObservationReceipt(
    report.authObservationReceipt,
    report.owner,
  );
  assert.deepEqual(
    requireDetoxCameraBootstrapEvidence(terminal.bootstrapEvidence, report.owner),
    reportBootstrapEvidence,
    'Detox camera terminal lost protected bootstrap evidence',
  );
  assert.deepEqual(
    requireDetoxCameraAuthObservationReceipt(terminal.authObservationReceipt, report.owner),
    reportAuthObservationReceipt,
    'Detox camera terminal lost protected native auth observations',
  );
  assert.deepEqual(report.selection, {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-camera-denied-ios',
    mode: 'integration',
  });
  assert(
    typeof report.owner.target.osVersion === 'string' && report.owner.target.osVersion.length > 0,
    'Detox camera owner lacks the observed simulator runtime',
  );
  requireDetoxCameraCleanup(report.cleanup);
  requireDetoxCameraTerminalCleanup(terminal.cleanup, report.cleanup);
  assert.equal(report.publicPromotionEligible, false);
  assert.equal(terminal.runId, report.owner.runId);
  assert.equal(terminal.attemptId, report.owner.attemptId);
  assert.equal(options.result.report?.owner.runId, report.owner.runId);
  assert.equal(options.result.report?.owner.attemptId, report.owner.attemptId);

  assert(terminal.stagePath, 'Verified Detox camera terminal has no stage path');
  const stagePath = descendant(artifactRoot, terminal.stagePath);
  const stageRead = await readPrivateJson(stagePath, 'Detox camera stage', options.lifecycle);
  const stage = parseStage(stageRead.value);
  assert.deepEqual(stage.assertionIds, DETOX_CAMERA_ASSERTIONS);
  assert.equal(stage.publicPromotionEligible, false);
  assert.deepEqual(
    requireDetoxCameraBootstrapEvidence(stage.bootstrapEvidence, report.owner),
    reportBootstrapEvidence,
    'Detox camera stage lost protected bootstrap evidence',
  );
  assert.deepEqual(
    requireDetoxCameraAuthObservationReceipt(stage.authObservationReceipt, report.owner),
    reportAuthObservationReceipt,
    'Detox camera stage lost protected native auth observations',
  );
  assert.equal(stage.owner.runId, report.owner.runId);
  assert.equal(stage.owner.attemptId, report.owner.attemptId);
  assert.equal(options.result.stage?.owner.runId, stage.owner.runId);
  assert.equal(options.result.terminal?.reportSha256, terminal.reportSha256);
  assert.deepEqual(stage.cleanup, report.cleanup);
  assert.equal(stage.files.length, new Set(stage.files.map((file) => file.path)).size);

  const stagedFiles = new Set<string>();
  for (const file of stage.files) {
    const path = descendant(outputRoot, file.path);
    stagedFiles.add(resolve(path));
    await requireSourceRef(outputRoot, file, options.lifecycle);
  }
  const assertionBindings = DETOX_CAMERA_ASSERTIONS.map((id) => {
    const evidence = stage.evidence[id];
    assert(
      Array.isArray(evidence) && evidence.length > 0,
      `Camera assertion ${id} has no evidence`,
    );
    const evidencePaths = evidence.map((path) => {
      const absolute = descendant(outputRoot, path);
      assert(stagedFiles.has(absolute), `Camera assertion ${id} references unstaged evidence`);
      return relativeArtifact(outputRoot, absolute);
    });
    assert.equal(new Set(evidencePaths).size, evidencePaths.length);
    return { id, evidencePaths };
  });

  const artifacts = [
    relativeArtifact(outputRoot, reportPath),
    relativeArtifact(outputRoot, stagePath),
    relativeArtifact(outputRoot, terminalPath),
    ...stage.files.map((file) => relativeArtifact(outputRoot, file.path)),
  ];
  assert.equal(new Set(artifacts).size, artifacts.length);
  assert.equal(options.requestedAttemptId, `${options.requestedRunId}:first`);
  await requireDetoxCameraEvidenceLive(options.lifecycle);
  return {
    kind: 'detox-ios-camera-outer-verification',
    reportPath,
    stagePath,
    terminalPath,
    ownerRunId: report.owner.runId,
    ownerAttemptId: report.owner.attemptId,
    assertionBindings,
    artifacts,
  };
}

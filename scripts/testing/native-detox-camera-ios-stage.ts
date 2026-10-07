import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  DETOX_CAMERA_ASSERTIONS,
  requireDetoxCameraBootstrapEvidence,
  requireDetoxCameraAuthObservationReceipt,
  type DetoxCameraAttemptReport,
  type DetoxCameraBootstrapEvidence,
  type DetoxCameraCleanup,
  type DetoxCameraSelection,
  type DetoxCameraSourceRef,
  type DetoxCameraTerminal,
  requireDetoxCameraCleanup,
  requireDetoxCameraFrames,
  requireDetoxCameraSelection,
  requireDetoxCameraSqlIsolation,
  requireDetoxCameraTransport,
} from './native-detox-camera-ios-contract';
import {
  requireDetoxCameraEvidenceLive,
  writeOwnedExclusive,
  type DetoxCameraEvidenceLifecycle,
} from './native-detox-camera-ios-evidence';

const MAX_JSON_BYTES = 1024 * 1024;

function assertDescendant(root: string, candidate: string): void {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel.startsWith('..') || rel.includes('/..'))
    throw new Error(`Detox camera stage path escapes root: ${candidate}`);
}

async function requirePrivateRegular(
  path: string,
  lifecycle: DetoxCameraEvidenceLifecycle,
  expected?: DetoxCameraSourceRef,
): Promise<{ bytes: Buffer; sha256: string; mode: number }> {
  await requireDetoxCameraEvidenceLive(lifecycle);
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    (before.mode & 0o777) !== 0o600
  ) {
    throw new Error(`Detox camera stage source is not a private single-link file: ${path}`);
  }
  if (before.size > 8 * 1024 * 1024)
    throw new Error(`Detox camera stage source exceeds 8 MiB: ${path}`);
  await requireDetoxCameraEvidenceLive(lifecycle);
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await fd.stat();
    await requireDetoxCameraEvidenceLive(lifecycle);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.uid !== before.uid ||
      opened.gid !== before.gid ||
      opened.mode !== before.mode ||
      opened.nlink !== before.nlink ||
      opened.size !== before.size
    ) {
      throw new Error(`Detox camera stage source changed before reading: ${path}`);
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      await requireDetoxCameraEvidenceLive(lifecycle);
      const read = await fd.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) throw new Error(`Detox camera stage source ended early: ${path}`);
      offset += read.bytesRead;
    }
    const after = await fd.stat();
    await requireDetoxCameraEvidenceLive(lifecycle);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`Detox camera stage source changed while reading: ${path}`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      expected &&
      (expected.path !== path ||
        expected.bytes !== bytes.length ||
        expected.sha256 !== sha256 ||
        expected.mode !== (before.mode & 0o777))
    ) {
      throw new Error(`Detox camera stage source receipt mismatch: ${path}`);
    }
    return { bytes, sha256, mode: before.mode & 0o777 };
  } finally {
    await fd.close();
  }
}

async function writePrivateJson(
  path: string,
  value: unknown,
  lifecycle: DetoxCameraEvidenceLifecycle,
): Promise<{ sha256: string; bytes: number }> {
  await requireDetoxCameraEvidenceLive(lifecycle);
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_JSON_BYTES)
    throw new Error(`Detox camera stage JSON exceeds 1 MiB: ${path}`);
  const root = dirname(path);
  const name = path.slice(root.length + 1);
  if (!name || name.includes('/'))
    throw new Error(`Detox camera stage JSON must be a direct child: ${path}`);
  const written = await writeOwnedExclusive(root, name, bytes, lifecycle);
  await requireDetoxCameraEvidenceLive(lifecycle);
  return { sha256: written.sha256, bytes: written.bytes };
}

async function copyPrivateSource(
  source: DetoxCameraSourceRef,
  destinationRoot: string,
  name: string,
  lifecycle: DetoxCameraEvidenceLifecycle,
): Promise<DetoxCameraSourceRef> {
  await requireDetoxCameraEvidenceLive(lifecycle);
  const sourcePath = resolve(source.path);
  const root = resolve(destinationRoot);
  assertDescendant(root, join(root, name));
  const sourceRoot = await realpath(dirname(sourcePath));
  if (sourceRoot !== dirname(sourcePath))
    throw new Error(`Detox camera source parent is a symlink: ${sourcePath}`);
  const read = await requirePrivateRegular(sourcePath, lifecycle, source);
  const destination = join(root, name);
  const published = await writeOwnedExclusive(root, name, read.bytes, lifecycle);
  const verified = await requirePrivateRegular(destination, lifecycle);
  await requireDetoxCameraEvidenceLive(lifecycle);
  if (published.sha256 !== read.sha256 || verified.bytes.length !== read.bytes.length)
    throw new Error(
      `Detox camera stage copy changed bytes: ${sourcePath} (${read.sha256}/${read.bytes.length} -> ${published.sha256}/${published.bytes})`,
    );
  return {
    ...source,
    path: destination,
    sha256: verified.sha256,
    bytes: verified.bytes.length,
    mode: verified.mode,
  };
}

export type DetoxCameraStageResult = {
  kind: 'detox-ios-camera-private-stage';
  selection: DetoxCameraSelection;
  owner: DetoxCameraAttemptReport['owner'];
  bootstrapEvidence: DetoxCameraBootstrapEvidence;
  authObservationReceipt: DetoxCameraAttemptReport['authObservationReceipt'];
  assertionIds: Readonly<typeof DETOX_CAMERA_ASSERTIONS>;
  evidence: Record<string, string[]>;
  files: DetoxCameraSourceRef[];
  cleanup: DetoxCameraCleanup;
  publicPromotionEligible: false;
};

export async function stageDetoxIosCameraPrivateEvidence(options: {
  report: DetoxCameraAttemptReport;
  outputRoot: string;
  reportPath: string;
  cleanup: DetoxCameraCleanup;
  lifecycle: DetoxCameraEvidenceLifecycle;
}): Promise<DetoxCameraStageResult> {
  const { report, outputRoot, reportPath, cleanup, lifecycle } = options;
  await requireDetoxCameraEvidenceLive(lifecycle);
  requireDetoxCameraSelection(report.selection);
  const bootstrapEvidence = requireDetoxCameraBootstrapEvidence(
    report.bootstrapEvidence,
    report.owner,
  );
  const authObservationReceipt = requireDetoxCameraAuthObservationReceipt(
    report.authObservationReceipt,
    report.owner,
  );
  if (!/^[a-f0-9]{64}$/.test(report.source.publicBindingsHash))
    throw new Error('Detox camera report lacks the existing public binding contract hash');
  requireDetoxCameraFrames(report.frames);
  requireDetoxCameraTransport(report.transport, report.owner, report.submission);
  requireDetoxCameraSqlIsolation(report.sql.before, report.sql.after, report.owner);
  requireDetoxCameraCleanup(cleanup);
  if (report.cleanup !== cleanup)
    throw new Error('Detox camera report cleanup does not equal terminal cleanup');
  const expectedRoot = resolve(outputRoot);
  const files: DetoxCameraSourceRef[] = [];
  const stagedScreenshotPaths = new Map<string, string>();
  for (const [index, frame] of report.frames.entries()) {
    files.push(
      await copyPrivateSource(
        frame.hierarchy,
        expectedRoot,
        `frame-${index}-hierarchy.xml`,
        lifecycle,
      ),
    );
    const stagedScreenshot = await copyPrivateSource(
      frame.screenshot,
      expectedRoot,
      `frame-${index}-screenshot.png`,
      lifecycle,
    );
    files.push(stagedScreenshot);
    stagedScreenshotPaths.set(frame.screenshot.path, stagedScreenshot.path);
    files.push(
      await copyPrivateSource(
        frame.command,
        expectedRoot,
        `frame-${index}-command.json`,
        lifecycle,
      ),
    );
  }
  const beforeSql = await copyPrivateSource(
    report.sql.before.snapshotSource,
    expectedRoot,
    'sql-before.snapshot.json',
    lifecycle,
  );
  const afterSql = await copyPrivateSource(
    report.sql.after.snapshotSource,
    expectedRoot,
    'sql-after.snapshot.json',
    lifecycle,
  );
  const beforeIsolationSql = await copyPrivateSource(
    report.sql.isolationBefore.snapshotSource,
    expectedRoot,
    'sql-isolation-before.snapshot.json',
    lifecycle,
  );
  const afterIsolationSql = await copyPrivateSource(
    report.sql.isolationAfter.snapshotSource,
    expectedRoot,
    'sql-isolation-after.snapshot.json',
    lifecycle,
  );
  files.push(beforeSql, afterSql, beforeIsolationSql, afterIsolationSql);
  const transportPath = join(expectedRoot, 'detox-camera-transport.private.json');
  await writePrivateJson(transportPath, report.transport, lifecycle);
  const transportBytes = await requirePrivateRegular(transportPath, lifecycle);
  files.push({
    path: transportPath,
    sha256: transportBytes.sha256,
    bytes: transportBytes.bytes.length,
    mode: transportBytes.mode,
    sourceKind: 'owned-detox-command',
  });
  const reportRead = await requirePrivateRegular(resolve(reportPath), lifecycle);
  if (reportRead.sha256 !== createHash('sha256').update(reportRead.bytes).digest('hex'))
    throw new Error('Detox camera report hash mismatch');
  const stagedScreenshotsFor = (
    semanticState: DetoxCameraAttemptReport['frames'][number]['semanticState'],
  ): string[] =>
    report.frames
      .filter((frame) => frame.semanticState === semanticState)
      .map((frame) => {
        const stagedPath = stagedScreenshotPaths.get(frame.screenshot.path);
        if (!stagedPath)
          throw new Error(
            `Detox camera screenshot was not copied into the private stage: ${frame.label}`,
          );
        return stagedPath;
      });
  const stage = {
    kind: 'detox-ios-camera-private-stage' as const,
    selection: report.selection,
    owner: report.owner,
    bootstrapEvidence,
    authObservationReceipt,
    assertionIds: DETOX_CAMERA_ASSERTIONS,
    evidence: {
      'NAT-camera-normal-entry': [...stagedScreenshotsFor('camera-entry'), transportPath],
      'NAT-camera-denial-guidance': stagedScreenshotsFor('camera-guidance'),
      'NAT-camera-manual-submit': [
        ...stagedScreenshotsFor('pending'),
        transportPath,
        afterSql.path,
      ],
      'NAT-camera-unrelated-state': [beforeIsolationSql.path, afterIsolationSql.path],
    },
    files,
    cleanup,
    publicPromotionEligible: false as const,
  };
  await requireDetoxCameraEvidenceLive(lifecycle);
  const stageReceipt = await writePrivateJson(
    join(expectedRoot, 'detox-camera-stage.private.json'),
    stage,
    lifecycle,
  );
  await writePrivateJson(
    join(expectedRoot, 'detox-camera-stage-hash.private.json'),
    stageReceipt,
    lifecycle,
  );
  await requireDetoxCameraEvidenceLive(lifecycle);
  return stage;
}

export async function writeDetoxIosCameraTerminal(options: {
  outputRoot: string;
  reportPath: string;
  report: DetoxCameraAttemptReport;
  cleanup: DetoxCameraCleanup;
  stagePath: string | null;
  result: DetoxCameraTerminal['result'];
  lifecycle: DetoxCameraEvidenceLifecycle;
}): Promise<DetoxCameraTerminal> {
  await requireDetoxCameraEvidenceLive(options.lifecycle);
  const bootstrapEvidence = requireDetoxCameraBootstrapEvidence(
    options.report.bootstrapEvidence,
    options.report.owner,
  );
  const authObservationReceipt = requireDetoxCameraAuthObservationReceipt(
    options.report.authObservationReceipt,
    options.report.owner,
  );
  const reportRead = await requirePrivateRegular(resolve(options.reportPath), options.lifecycle);
  const terminal: DetoxCameraTerminal = {
    kind: 'detox-ios-camera-terminal',
    contractVersion: options.report.contractVersion,
    runId: options.report.owner.runId,
    attemptId: options.report.owner.attemptId,
    result: options.result,
    assertionIds: DETOX_CAMERA_ASSERTIONS,
    reportPath: resolve(options.reportPath),
    reportSha256: reportRead.sha256,
    bootstrapEvidence,
    authObservationReceipt,
    stagePath: options.stagePath,
    cleanup: options.cleanup,
    publicPromotionEligible: false,
  };
  await writePrivateJson(
    join(resolve(options.outputRoot), 'detox-camera-terminal.private.json'),
    terminal,
    options.lifecycle,
  );
  await requireDetoxCameraEvidenceLive(options.lifecycle);
  return terminal;
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import { sourceIdentity, treeHash } from './native-build-identity';
import {
  nativeSaveRetryAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from './native-pilot-contract';
import {
  readNativeSaveRetryAttemptBinding,
  requireNativeSaveRetryAssertionContract,
  saveRetryAttemptBindingPath,
} from './native-save-retry-attempt-binding';
import {
  nativeSaveRetryRuntimeFrames,
  nativeSaveRetryRuntimeFramesPath,
  type NativeSaveRetryFrameMode,
  nativeSaveRetrySnapshotPaths,
  readNativeEvidence,
  validateIosSaveRetryPreparation,
  validateNativeRuntimeFrameFiles,
} from './native-view-evidence';
import {
  projectIosTrainingAttemptTerminalFacts,
  requireIosSuccessfulTrainingCommandDiagnostics,
} from './run-ios-training-attempt';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeSaveRetryAttemptBinding } from './native-save-retry-attempt-binding';

const runId = /^[a-f0-9]{24}$/;
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

type NativePublicEvidenceLifecycle = {
  signal: AbortSignal;
  deadlineAtMs: number;
};

function stageFence(lifecycle: NativePublicEvidenceLifecycle | undefined, label: string): void {
  if (!lifecycle) return;
  lifecycle.signal.throwIfAborted();
  if (!Number.isFinite(lifecycle.deadlineAtMs) || performance.now() >= lifecycle.deadlineAtMs)
    throw new Error(`Native save/retry staging deadline expired: ${label}`);
}

/** Runtime frame metadata is distinct from the reviewed inventory and includes the error frame. */
export const nativeSaveRetryRuntimeFramePath = nativeSaveRetryRuntimeFramesPath;
export const nativeSaveRetryRuntimeMetadataPath = 'save-retry-runtime-metadata.private.json';
export const nativeSaveRetryAssertionEvidenceKind =
  'native-save-retry-assertion-evidence-preparation';

type AssertionBinding = {
  id: string;
  requirementRefs: string[];
  evidencePaths: string[];
};

type EvidenceReference = { path: string; sha256: string };

type NativeCommandLogArtifact = {
  kind: 'command-log';
  root: string;
  relative: string;
  sizeBytes: number;
  sha256: string;
  identity: string;
};

type CollectedFile = Buffer | NativeCommandLogArtifact;

type SaveRetryCapture = {
  kind: string;
  mode: string;
  platform: string;
  charter: string;
  result: string;
  cleanup: unknown;
  nativePassingCases: number;
  source: unknown;
  sourceAfter: unknown;
  helperInputsBefore: unknown;
  helperInputsAfter: unknown;
  build: Record<string, unknown>;
  device: Record<string, unknown>;
  backend: { runId: string };
  commandExecutions: unknown;
  observations: unknown;
  saveRetryPreparation: unknown;
  acquisitionIntents?: unknown;
};

type SaveRetryRuntimeAdapter = {
  kind: string;
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string | null;
  backendAttemptId: string | null;
  faultAttemptId: string | null;
  captureExitCode: number;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification: string | null;
  captureResult: string;
  captureCleanup: unknown;
  captureTimeout: unknown;
  cancellation: unknown;
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: string;
  verificationResult: string;
  assertionBindings: AssertionBinding[];
  fixtureRunId: string | null;
  commandDiagnostics: unknown;
  censusFailures: unknown[];
  outputFailures?: unknown[];
  applicationFailure: null;
  applicationFailureCandidate: null;
  verificationFailure: unknown;
  postCaptureFailure: unknown;
  deadline: unknown;
  nativePassingCases: number;
};

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

function json(root: string, relative: string, privateRecord = true): unknown {
  return JSON.parse(readNativeEvidence(root, relative, privateRecord).toString());
}

async function privateRoot(value: string): Promise<string> {
  const canonical = await realpath(value);
  assert.equal(canonical, path.resolve(value), 'Native evidence root is not canonical');
  const info = await lstat(canonical);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Native evidence root is not a directory');
  assert.equal(info.uid, process.getuid?.(), 'Native evidence root is not owned');
  assert.equal(info.mode & 0o777, 0o700, 'Native evidence root is not private');
  return canonical;
}

type PrivateFileMetadata = Awaited<ReturnType<typeof lstat>>;

function privateFileIdentity(metadata: PrivateFileMetadata): string {
  return [
    metadata.dev,
    metadata.ino,
    metadata.uid,
    metadata.gid,
    metadata.mode,
    metadata.size,
    metadata.mtimeMs,
    metadata.ctimeMs,
  ]
    .map(String)
    .join(':');
}

async function inspectPrivateCommandLog(
  root: string,
  relative: string,
): Promise<{ file: string; metadata: PrivateFileMetadata; identity: string }> {
  const canonicalRoot = await privateRoot(root);
  assert(relative && !path.isAbsolute(relative), 'Native command log path must be relative');
  const file = path.resolve(canonicalRoot, relative);
  assert(
    file.startsWith(canonicalRoot + path.sep) && (await realpath(file)) === file,
    'Native command log path escaped or contains a symlink',
  );
  const metadata = await lstat(file);
  assert(
    metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.() &&
      (metadata.mode & 0o777) === 0o600 &&
      metadata.nlink === 1 &&
      metadata.size > 0,
    'Native command log must be a non-empty owned private regular file',
  );
  assert(
    Number.isSafeInteger(metadata.size),
    'Native command log size is not safely representable',
  );
  return { file, metadata, identity: privateFileIdentity(metadata) };
}

async function streamHash(file: string): Promise<{ sizeBytes: number; sha256: string }> {
  const digest = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(file)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += bytes.byteLength;
    digest.update(bytes);
  }
  return { sizeBytes, sha256: digest.digest('hex') };
}

async function readNativeCommandLog(
  root: string,
  relative: string,
): Promise<NativeCommandLogArtifact> {
  const before = await inspectPrivateCommandLog(root, relative);
  const digest = await streamHash(before.file);
  const after = await inspectPrivateCommandLog(root, relative);
  assert.equal(
    after.identity,
    before.identity,
    `Native command log changed while reading: ${relative}`,
  );
  assert.equal(
    digest.sizeBytes,
    before.metadata.size,
    `Native command log size changed while reading: ${relative}`,
  );
  return {
    kind: 'command-log',
    root: path.resolve(root),
    relative,
    sizeBytes: digest.sizeBytes,
    sha256: digest.sha256,
    identity: before.identity,
  };
}

function fileSha256(file: CollectedFile): string {
  return Buffer.isBuffer(file) ? sha256(file) : file.sha256;
}

function fileSizeBytes(file: CollectedFile): number {
  return Buffer.isBuffer(file) ? file.byteLength : file.sizeBytes;
}

function assertSameCollectedFile(
  left: CollectedFile,
  right: CollectedFile,
  relative: string,
): void {
  if (Buffer.isBuffer(left) && Buffer.isBuffer(right)) {
    assert.deepEqual(left, right, `Evidence read twice changed: ${relative}`);
    return;
  }
  assert.equal(fileSha256(left), fileSha256(right), `Evidence read twice changed: ${relative}`);
  if (!Buffer.isBuffer(left) && !Buffer.isBuffer(right)) {
    assert.equal(left.sizeBytes, right.sizeBytes, `Evidence size changed: ${relative}`);
    assert.equal(left.identity, right.identity, `Evidence identity changed: ${relative}`);
  }
}

async function requireNoNativeCensusFailure(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert(
      !entry.name.endsWith('.census-failure.private.json'),
      'Native census failure diagnostic prevents save/retry evidence finalization',
    );
    if (entry.isDirectory()) await requireNoNativeCensusFailure(path.join(root, entry.name));
  }
}

async function freshSelection(
  repositoryRoot: string,
  selection: NativePilotSelection,
): Promise<{ repositoryRoot: string; selection: NativePilotSelection }> {
  const root = await realpath(repositoryRoot);
  const inventory = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const current = await selectNativePilotScenario(selection.arguments, inventory, root);
  assert.deepEqual(selection, current, 'Native save/retry selection is stale or altered');
  requireNativeSaveRetryAssertionContract(current);
  requireIosSaveRetryArguments(current);
  return { repositoryRoot: root, selection: current };
}

function requireIosSaveRetryArguments(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-save-retry-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-save-retry-ios');
  assert.equal(selection.scenario.platform, 'ios');
  assert.equal(selection.scenario.flowId, 'FLW-save-retry');
  assert.equal(selection.scenarioHash.length, 64);
  assert.equal(selection.requirementHash.length, 64);
}

function runtimeFrameEntries(
  value: unknown,
): { viewId: string; screenshotPath: string; hierarchyPath: string }[] {
  return array(value, 'capture observations').map((raw) => {
    const row = record(raw, 'capture observation');
    assert(typeof row.viewId === 'string' && row.viewId.length > 0);
    assert(typeof row.screenshotPath === 'string' && row.screenshotPath.length > 0);
    assert(typeof row.hierarchyPath === 'string' && row.hierarchyPath.length > 0);
    return {
      viewId: row.viewId,
      screenshotPath: row.screenshotPath,
      hierarchyPath: row.hierarchyPath,
    };
  });
}

function requireSaveRetryCaptureIdentity(capture: SaveRetryCapture, captureRunId: string): void {
  assert.equal(capture.kind, 'private-owned-native-save-retry-execution-not-public-receipt');
  assert.equal(capture.mode, 'integration');
  assert.equal(capture.platform, 'ios');
  assert.equal(capture.charter, 'save-retry');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  assert.match(captureRunId, runId);
  assert.match(capture.backend?.runId ?? '', runId);
  assert(
    capture.device &&
      typeof capture.device.udid === 'string' &&
      /^[A-Fa-f0-9-]{36}$/.test(capture.device.udid),
    'iOS save/retry capture lacks an owned device identity',
  );
}

async function requireBuildMetadata(build: Record<string, unknown>): Promise<void> {
  assert(typeof build.bundleId === 'string' && build.bundleId === 'com.edufelip.mychampions.dev');
  assert(typeof build.binaryPath === 'string' && path.isAbsolute(build.binaryPath));
  assert.equal(build.profile, 'Metro-attached Debug; not bundled release qualification');
  assert(typeof build.apiOrigin === 'string');
  assert(typeof build.metroOrigin === 'string');
  requireIntegratedLoopbackOrigin(build.apiOrigin);
  requireIntegratedLoopbackOrigin(build.metroOrigin);
  assert.notEqual(build.apiOrigin, build.metroOrigin, 'Native iOS endpoints collide');
  assert(typeof build.node === 'string' && build.node.length > 0);
  assert(typeof build.binaryHash === 'string' && /^[a-f0-9]{64}$/.test(build.binaryHash));
  assert(typeof build.environmentHash === 'string' && /^[a-f0-9]{64}$/.test(build.environmentHash));
  const binaryPath = await realpath(build.binaryPath);
  assert.equal(binaryPath, path.resolve(build.binaryPath), 'Native binary path is not canonical');
  const info = await lstat(binaryPath);
  assert(
    info.isDirectory() && !info.isSymbolicLink(),
    'Native iOS binary bundle is not a directory',
  );
  assert.equal(await treeHash(binaryPath), build.binaryHash, 'Runtime binary changed');
}

async function requireSourceAndHelpers(
  repositoryRoot: string,
  capture: SaveRetryCapture,
): Promise<void> {
  assert.deepEqual(capture.source, capture.sourceAfter, 'Capture source changed during execution');
  const currentSource = await sourceIdentity(repositoryRoot);
  assert.deepEqual(capture.source, currentSource, 'Native save/retry source identity is stale');
  assert(Array.isArray(capture.helperInputsBefore) && capture.helperInputsBefore.length > 0);
  assert.deepEqual(
    capture.helperInputsBefore,
    capture.helperInputsAfter,
    'Native save/retry helper inputs changed during execution',
  );
  for (const raw of capture.helperInputsBefore) {
    const helper = record(raw, 'helper input');
    assert(
      typeof helper.path === 'string' &&
        /^scripts\/testing\/[A-Za-z0-9._/-]+\.ts$/.test(helper.path),
    );
    assert(typeof helper.sha256 === 'string' && /^[a-f0-9]{64}$/.test(helper.sha256));
    const target = assertArtifactPath(repositoryRoot, helper.path);
    assert.equal(await realpath(target), target, 'Native helper path is not canonical');
    const info = await lstat(target);
    assert(info.isFile() && !info.isSymbolicLink(), 'Native helper is not a regular file');
    assert.equal(
      sha256(await readFile(target)),
      helper.sha256,
      'Native helper changed after capture',
    );
  }
  const helperPaths = capture.helperInputsBefore.map((raw) => record(raw, 'helper input').path);
  assert.equal(
    new Set(helperPaths).size,
    helperPaths.length,
    'Native helper inputs are duplicated',
  );
  for (const required of [
    'capture-native-testability.ts',
    'native-training-observation.ts',
    'native-save-retry-observation.ts',
    'native-save-retry-attempt-binding.ts',
    'native-view-evidence.ts',
    'run-ios-save-retry-attempt.ts',
    'native-save-retry-public-evidence.ts',
  ])
    assert(
      helperPaths.includes(`scripts/testing/${required}`),
      `Native save/retry helper identity is absent: ${required}`,
    );
}

function requireCleanupEvidence(value: unknown, captureRunId: string): void {
  const cleanup = record(value, 'external cleanup');
  assert.equal(cleanup.kind, 'independent ios native inventory cleanup proof');
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.runId, captureRunId);
  assert.equal(cleanup.captureResult, 'observed');
  assert.equal(cleanup.captureCleanupClean, true);
  assert(Number.isSafeInteger(cleanup.pidStartPairs) && Number(cleanup.pidStartPairs) > 0);
  for (const key of ['survivors', 'unknownProcessQueries', 'missingForeignDevices'])
    assert.deepEqual(cleanup[key], [], `iOS cleanup has ${key}`);
  assert.equal(cleanup.ownedDeviceAbsent, true);
  assert.equal(cleanup.cacheAbsent, true);
  const docker = record(cleanup.docker, 'cleanup docker');
  for (const key of ['container', 'network', 'volume']) assert.deepEqual(docker[key], []);
}

function requireRuntimeMetadata(
  value: unknown,
  binding: NativeSaveRetryAttemptBinding,
  capture: SaveRetryCapture,
): void {
  const metadata = record(value, 'save/retry runtime metadata');
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.kind, 'private-ios-save-retry-runtime-metadata-not-public-receipt');
  assert.equal(metadata.requestedRunId, binding.requestedRunId);
  assert.equal(metadata.requestedAttemptId, binding.requestedAttemptId);
  assert.equal(metadata.captureRunId, binding.captureRunId);
  assert.equal(metadata.backendRunId, binding.backendRunId);
  assert.equal(metadata.backendAttemptId, binding.backendAttemptId);
  assert.equal(metadata.faultAttemptId, binding.faultAttemptId);
  assert.deepEqual(metadata.selection, binding.selection);
  assert.deepEqual(metadata.assertionContract, binding.assertionContract);
  assert.deepEqual(metadata.preparation, capture.saveRetryPreparation);
  assert.equal(metadata.publicNativePassingCases, 0);
}

function requirePreparationAttemptIdentity(
  preparation: unknown,
  binding: NativeSaveRetryAttemptBinding,
): void {
  const row = record(preparation, 'save/retry preparation');
  assert.equal(row.faultAttemptId, binding.faultAttemptId);
  assert.equal(row.attemptId, binding.faultAttemptId);
}

function requireAdapter(
  value: unknown,
  binding: NativeSaveRetryAttemptBinding,
  capture: SaveRetryCapture,
  bindings: AssertionBinding[],
): SaveRetryRuntimeAdapter {
  const adapter = record(
    value,
    'iOS save/retry runtime adapter',
  ) as unknown as SaveRetryRuntimeAdapter;
  assert.equal(adapter.kind, 'private-owned-ios-save-retry-attempt-not-public-receipt');
  assert.equal(adapter.requestedRunId, binding.requestedRunId);
  assert.equal(adapter.requestedAttemptId, binding.requestedAttemptId);
  assert.equal(adapter.captureRunId, binding.captureRunId);
  assert.equal(adapter.backendRunId, binding.backendRunId);
  assert.equal(adapter.backendAttemptId, binding.backendAttemptId);
  assert.equal(adapter.faultAttemptId, binding.faultAttemptId);
  assert.equal(adapter.captureExitCode, 0);
  assert.equal(adapter.childExitCode, 0);
  assert.equal(adapter.childSignal, null);
  assert.equal(adapter.childClassification, 'completed');
  assert.equal(adapter.captureResult, 'observed');
  assert.equal(adapter.captureCleanup, 'cleaned');
  assert.equal(adapter.captureTimeout, null);
  assert.equal(adapter.cancellation, null);
  assert.equal(adapter.callbackInvocations, 1);
  assert.equal(adapter.callbackCompleted, true);
  assert.equal(adapter.externalCleanupResult, 'passed');
  assert.equal(adapter.verificationResult, 'passed');
  assert.equal(adapter.applicationFailure, null);
  assert.equal(adapter.applicationFailureCandidate, null);
  assert.equal(adapter.verificationFailure, null);
  assert.equal(adapter.postCaptureFailure, null);
  assert.equal(adapter.deadline, null);
  assert.deepEqual(adapter.assertionBindings, bindings);
  assert.equal(adapter.fixtureRunId, binding.backendRunId);
  assert.deepEqual(adapter.censusFailures, []);
  assert.deepEqual(adapter.outputFailures, []);
  assert.equal(adapter.nativePassingCases, 0);
  assert.deepEqual(
    requireIosSuccessfulTrainingCommandDiagnostics(adapter.commandDiagnostics),
    requireIosSuccessfulTrainingCommandDiagnostics(capture.commandExecutions),
    'iOS adapter command projection differs from the original capture',
  );
  const terminal = projectIosTrainingAttemptTerminalFacts({
    commandExecutions: capture.commandExecutions,
    callbackCompleted: true,
    captureResult: capture.result,
    captureExitCode: 0,
    captureCleanup: capture.cleanup,
  });
  assert.equal(adapter.childClassification, terminal.childClassification);
  assert.equal(adapter.childExitCode, terminal.childExitCode);
  assert.equal(adapter.childSignal, terminal.childSignal);
  assert.equal(adapter.captureResult, terminal.captureResult);
  assert.deepEqual(adapter.captureCleanup, terminal.captureCleanup);
  return adapter;
}

function validateRuntimePreparation(
  root: string,
  backendRunId: string,
  preparation: unknown,
  transport: unknown,
): void {
  const frameMode: NativeSaveRetryFrameMode = 'runtime-captured';
  validateIosSaveRetryPreparation(root, backendRunId, preparation, transport, frameMode);
}

function expectedEvidencePaths(
  selection: NativePilotSelection,
  attemptId: string,
): Map<string, { row: (typeof nativeSaveRetryAssertionIds)[number]; evidencePaths: string[] }> {
  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    nativeSaveRetryAssertionIds,
    'Save/retry ledger order changed during evidence preparation',
  );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        row: row.id as (typeof nativeSaveRetryAssertionIds)[number],
        evidencePaths: row.evidencePathTemplates!.map((template) =>
          template.replace('{attemptId}', attemptId),
        ),
      },
    ]),
  );
}

function originalReferencesFor(assertionId: string, evidenceKind: 'ui' | 'api' | 'sql'): string[] {
  const ui: Record<string, string[]> = {
    'NAT-save-retry-error': ['save-error.png', 'save-error-hierarchy.json'],
    'NAT-save-retry-retained-draft': ['save-retained.png', 'save-retained-hierarchy.json'],
    'NAT-save-retry-final-save': ['save-retry-library.png', 'save-retry-library-hierarchy.json'],
    'NAT-save-retry-reopen': ['save-retry-reopened.png', 'save-retry-reopened-hierarchy.json'],
  };
  const sql: Record<string, string[]> = {
    'NAT-save-retry-retained-draft': [
      'save-retry-before.private.json',
      'save-retry-after-failure.private.json',
    ],
    'NAT-save-retry-final-save': [
      'save-retry-before.private.json',
      'save-retry-after-success.private.json',
    ],
    'NAT-save-retry-reopen': [
      'save-retry-after-success.private.json',
      'save-retry-after-reopen.private.json',
    ],
    'NAT-save-retry-unrelated-state': [...nativeSaveRetrySnapshotPaths],
  };
  if (evidenceKind === 'ui') return ui[assertionId] ?? [];
  if (evidenceKind === 'sql') return sql[assertionId] ?? [];
  if (evidenceKind === 'api') return ['transport-observations.private.json'];
  return [];
}

function runtimeFramePaths(): string[] {
  return [
    nativeSaveRetryRuntimeFramePath,
    ...nativeSaveRetryRuntimeFrames.flatMap(([label]) => [
      `${label}.png`,
      `${label}-hierarchy.json`,
    ]),
  ];
}

type CommandArtifactPaths = { paths: string[]; logPaths: Set<string> };

type CommandArtifactRole = 'log' | 'ownership' | 'stdout';

function commandArtifactPaths(
  capture: SaveRetryCapture,
  captureRoot: string,
  sourceRoot = captureRoot,
): CommandArtifactPaths {
  const paths: string[] = [];
  const logPaths = new Set<string>();
  const roles = new Map<string, { role: CommandArtifactRole; commandIndex: number }>();
  const source = path.resolve(sourceRoot);
  const commands = array(capture.commandExecutions, 'capture command executions');
  const register = (relative: string, role: CommandArtifactRole, commandIndex: number): void => {
    const prior = roles.get(relative);
    if (prior?.role === role)
      throw new Error(
        `Native command artifact path ${relative} is duplicated for ${role} (commands ${prior.commandIndex} and ${commandIndex})`,
      );
    if (prior)
      throw new Error(
        `Native command artifact path ${relative} aliases ${prior.role} (command ${prior.commandIndex}) and ${role} (command ${commandIndex})`,
      );
    roles.set(relative, { role, commandIndex });
    paths.push(relative);
    if (role === 'log') logPaths.add(relative);
  };
  for (const [commandIndex, raw] of commands.entries()) {
    const row = record(raw, 'capture command execution');
    const label = row.label;
    assert(
      typeof label === 'string' && /^[a-z0-9-]+$/.test(label),
      'Native command label is missing or unsafe for log binding',
    );
    for (const [key, role] of [
      ['logPath', 'log'],
      ['ownershipPath', 'ownership'],
    ] as const) {
      const value = row[key];
      assert(typeof value === 'string' && value.length > 0, `Command ${key} is missing`);
      assert(path.isAbsolute(value), `Command ${key} must be absolute`);
      const relative = path.relative(source, value);
      assert(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
        `Command ${key} escaped its private artifact root`,
      );
      if (key === 'logPath')
        assert.equal(
          path.resolve(value),
          path.join(source, `${label}.private.log`),
          'Command logPath does not match its producer label',
        );
      register(relative, role, commandIndex);
    }
    if (row.stdoutPath !== null && row.stdoutPath !== undefined) {
      assert(typeof row.stdoutPath === 'string' && row.stdoutPath.length > 0);
      assert(path.isAbsolute(row.stdoutPath), 'Command stdout path must be absolute');
      const relative = path.relative(source, row.stdoutPath);
      assert(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
        'Command stdout path escaped its private artifact root',
      );
      register(relative, 'stdout', commandIndex);
    }
  }
  return { paths: [...new Set(paths)], logPaths };
}

function commandArtifactSourceRoot(capture: SaveRetryCapture, captureRunId: string): string {
  const roots = new Set<string>();
  for (const raw of array(capture.commandExecutions, 'capture command executions')) {
    const row = record(raw, 'capture command execution');
    for (const key of ['logPath', 'ownershipPath']) {
      const value = row[key];
      assert(
        typeof value === 'string' && path.isAbsolute(value),
        `Command ${key} must be absolute`,
      );
      roots.add(path.dirname(path.resolve(value)));
    }
    if (row.stdoutPath !== null && row.stdoutPath !== undefined) {
      assert(typeof row.stdoutPath === 'string' && path.isAbsolute(row.stdoutPath));
      roots.add(path.dirname(path.resolve(row.stdoutPath)));
    }
  }
  assert.equal(roots.size, 1, 'Native command artifacts do not share one private root');
  const root = [...roots][0];
  assert.equal(path.basename(root), captureRunId, 'Native command artifact root identity changed');
  return root;
}

async function addCaptureFile(
  files: Map<string, CollectedFile>,
  captureRoot: string,
  relative: string,
  expectedHash?: string,
  commandLog = false,
): Promise<void> {
  const file: CollectedFile = commandLog
    ? await readNativeCommandLog(captureRoot, relative)
    : readNativeEvidence(captureRoot, relative, !relative.endsWith('.png'));
  if (expectedHash) assert.equal(fileSha256(file), expectedHash, `Evidence changed: ${relative}`);
  const prior = files.get(relative);
  if (prior) assertSameCollectedFile(prior, file, relative);
  files.set(relative, file);
}

function proofReferences(value: unknown): EvidenceReference[] {
  const proof = record(value, 'save/retry assertion proof');
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.kind, nativeSaveRetryAssertionEvidenceKind);
  assert.equal(proof.purpose, 'runtime');
  assert.equal(proof.nativePassingCases, 0);
  const references = array(proof.references, 'save/retry assertion references').map((raw) => {
    const ref = record(raw, 'save/retry assertion reference');
    assert(typeof ref.path === 'string' && ref.path.length > 0);
    assert(typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256));
    return { path: ref.path, sha256: ref.sha256 };
  });
  assert(references.length > 0);
  assert.equal(new Set(references.map((row) => row.path)).size, references.length);
  return references;
}

function parseAssertionBindings(value: unknown): AssertionBinding[] {
  return array(value, 'adapter assertion bindings').map((raw) => {
    const row = record(raw, 'adapter assertion binding');
    assert(typeof row.id === 'string' && row.id.length > 0);
    assert(Array.isArray(row.requirementRefs));
    assert(row.requirementRefs.every((ref) => typeof ref === 'string' && ref.length > 0));
    assert(Array.isArray(row.evidencePaths));
    assert(row.evidencePaths.every((file) => typeof file === 'string' && file.length > 0));
    return {
      id: row.id,
      requirementRefs: row.requirementRefs as string[],
      evidencePaths: row.evidencePaths as string[],
    };
  });
}

async function requireProofs(
  captureRoot: string,
  selection: NativePilotSelection,
  binding: NativeSaveRetryAttemptBinding,
  bindings: AssertionBinding[],
  files?: Map<string, CollectedFile>,
): Promise<void> {
  const checkedFiles = files ?? new Map<string, CollectedFile>();
  const recipes = expectedEvidencePaths(selection, binding.backendAttemptId);
  const ledger = requireNativePilotAssertions(selection);
  assert.equal(bindings.length, ledger.length);
  assert.deepEqual(
    bindings.map((row) => row.id),
    nativeSaveRetryAssertionIds,
    'Save/retry assertion binding order is not canonical',
  );
  for (const [index, required] of ledger.entries()) {
    const bindingRow = bindings[index];
    assert.equal(bindingRow.id, required.id);
    assert.deepEqual(bindingRow.requirementRefs, required.requirementRefs);
    assert.deepEqual(bindingRow.evidencePaths, recipes.get(required.id)!.evidencePaths);
    for (const [kindIndex, evidencePath] of bindingRow.evidencePaths.entries()) {
      const proofValue = json(captureRoot, evidencePath);
      await addCaptureFile(checkedFiles, captureRoot, evidencePath);
      const proof = record(proofValue, 'save/retry assertion proof');
      assert.equal(proof.assertionId, required.id);
      assert.equal(proof.evidenceKind, required.evidenceKinds[kindIndex]);
      assert.deepEqual(proof.requirementRefs, required.requirementRefs);
      assert.equal(proof.fixtureRunId, binding.backendRunId);
      assert.equal(proof.attemptId, binding.backendAttemptId);
      assert.equal(proof.scenarioHash, selection.scenarioHash);
      assert.equal(proof.requirementHash, selection.requirementHash);
      const references = proofReferences(proofValue);
      const expectedReferences = originalReferencesFor(
        required.id,
        required.evidenceKinds[kindIndex],
      );
      for (const expected of expectedReferences)
        assert(
          references.some((reference) => reference.path === expected),
          `Missing proof reference ${expected}`,
        );
      for (const reference of references)
        await addCaptureFile(checkedFiles, captureRoot, reference.path, reference.sha256);
    }
  }
}

async function validateCapture(
  repositoryRoot: string,
  captureRoot: string,
  selection: NativePilotSelection,
  requestedRunId: string,
  fixtureRunId: string,
  checkSource: boolean,
): Promise<{
  binding: NativeSaveRetryAttemptBinding;
  capture: SaveRetryCapture;
  adapter: SaveRetryRuntimeAdapter;
  bindings: AssertionBinding[];
  metadata: Record<string, unknown>;
  files: Map<string, CollectedFile>;
}> {
  const captureRunId = path.basename(captureRoot);
  const capture = json(captureRoot, 'capture.private.json') as SaveRetryCapture;
  requireSaveRetryCaptureIdentity(capture, captureRunId);
  assert.equal(capture.backend.runId, fixtureRunId);
  await requireBuildMetadata(capture.build);
  if (checkSource) await requireSourceAndHelpers(repositoryRoot, capture);
  await requireNoNativeCensusFailure(captureRoot);
  const binding = await readNativeSaveRetryAttemptBinding({
    repositoryRoot,
    artifactRoot: captureRoot,
    requestedRunId,
    backendRunId: fixtureRunId,
    selection,
  });
  assert.equal(binding.captureRunId, captureRunId);
  assert.equal(binding.backendRunId, fixtureRunId);
  requireIosSaveRetryArguments(selection);
  const transport = json(captureRoot, 'transport-observations.private.json');
  validateRuntimePreparation(captureRoot, fixtureRunId, capture.saveRetryPreparation, transport);
  requirePreparationAttemptIdentity(capture.saveRetryPreparation, binding);
  requireCleanupEvidence(json(captureRoot, 'external-cleanup.private.json'), captureRunId);
  const adapterValue = json(captureRoot, 'runtime-adapter.private.json');
  const adapterBindings = parseAssertionBindings(
    record(adapterValue, 'iOS save/retry runtime adapter').assertionBindings,
  );
  const adapter = requireAdapter(adapterValue, binding, capture, adapterBindings);
  const metadata = record(
    json(captureRoot, nativeSaveRetryRuntimeMetadataPath),
    'runtime metadata',
  );
  requireRuntimeMetadata(metadata, binding, capture);
  const files = new Map<string, CollectedFile>();
  const commandArtifacts = commandArtifactPaths(capture, captureRoot);
  for (const relative of [
    saveRetryAttemptBindingPath,
    nativeSaveRetryRuntimeMetadataPath,
    'capture.private.json',
    'runtime-adapter.private.json',
    'external-cleanup.private.json',
    'transport-observations.private.json',
    ...nativeSaveRetrySnapshotPaths,
    ...runtimeFramePaths(),
    ...commandArtifacts.paths,
  ]) {
    await addCaptureFile(
      files,
      captureRoot,
      relative,
      undefined,
      commandArtifacts.logPaths.has(relative),
    );
  }
  return { binding, capture, adapter, bindings: adapterBindings, metadata, files };
}

function sourceStagingPath(relative: string): string {
  return `source/${relative}`;
}

async function addHelperSources(
  files: Map<string, CollectedFile>,
  repositoryRoot: string,
  capture: SaveRetryCapture,
): Promise<void> {
  for (const raw of array(capture.helperInputsBefore, 'helper inputs')) {
    const helper = record(raw, 'helper input');
    const relative = helper.path as string;
    const sourcePath = assertArtifactPath(repositoryRoot, relative);
    const bytes = await readFile(sourcePath);
    assert.equal(sha256(bytes), helper.sha256, `Helper source changed: ${relative}`);
    const staged = sourceStagingPath(relative);
    const prior = files.get(staged);
    if (prior) assertSameCollectedFile(prior, bytes, staged);
    files.set(staged, bytes);
  }
}

async function addOptionalCaptureFiles(
  files: Map<string, CollectedFile>,
  captureRoot: string,
): Promise<void> {
  const names = await readdir(captureRoot);
  for (const name of names) {
    if (
      name === 'bootstrap.private.log' ||
      name === 'native-host-census.private.json' ||
      name === 'previous-ios-devices.private.json' ||
      name === 'simulator-owner.private.json' ||
      name === 'simulator-cleanup.json' ||
      name.startsWith('adb-server-')
    ) {
      const info = await lstat(path.join(captureRoot, name));
      if (info.isFile()) await addCaptureFile(files, captureRoot, name);
    }
    assert.notEqual(
      name,
      'save-retry-reviewed-frames.private.json',
      'Runtime capture cannot promote reviewed frames',
    );
  }
}

/** Write exact runtime frame hashes without ever creating reviewed:true evidence. */
export async function writeIosSaveRetryRuntimeFrames(artifactRoot: string): Promise<void> {
  const root = await privateRoot(artifactRoot);
  const capture = record(json(root, 'capture.private.json'), 'save/retry capture');
  assert.equal(capture.kind, 'private-owned-native-save-retry-execution-not-public-receipt');
  assert.equal(capture.mode, 'integration');
  assert.equal(capture.platform, 'ios');
  assert.equal(capture.charter, 'save-retry');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  const observations = runtimeFrameEntries(capture.observations);
  const frames = nativeSaveRetryRuntimeFrames.map(([label, viewId]) => {
    const matching = observations.filter(
      (row) =>
        row.viewId === viewId &&
        row.screenshotPath === `${label}.png` &&
        row.hierarchyPath === `${label}-hierarchy.json`,
    );
    assert.equal(
      matching.length,
      1,
      `Runtime save/retry frame ${label} was not captured exactly once`,
    );
    const screenshot = readNativeEvidence(root, `${label}.png`);
    const hierarchy = readNativeEvidence(root, `${label}-hierarchy.json`, true);
    return {
      viewId,
      screenshotPath: `${label}.png`,
      hierarchyPath: `${label}-hierarchy.json`,
      screenshotHash: sha256(screenshot),
      hierarchyHash: sha256(hierarchy),
      reviewed: false,
    };
  });
  for (const frame of frames) validateNativeRuntimeFrameFiles(root, [frame], [frame.viewId]);
  await writeFile(
    assertArtifactPath(root, nativeSaveRetryRuntimeFramePath),
    JSON.stringify(frames, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
}

/** Prepare five runtime-bound assertion proofs; no native outcome is emitted. */
export async function prepareIosSaveRetryPilotEvidence(options: {
  repositoryRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  requestedRunId: string;
}): Promise<{ bindings: AssertionBinding[] }> {
  const { repositoryRoot, selection } = await freshSelection(
    options.repositoryRoot,
    options.selection,
  );
  const captureRoot = await privateRoot(options.artifactRoot);
  const capture = json(captureRoot, 'capture.private.json') as SaveRetryCapture;
  requireSaveRetryCaptureIdentity(capture, path.basename(captureRoot));
  await requireBuildMetadata(capture.build);
  const fixtureRunId = capture.backend.runId;
  const binding = await readNativeSaveRetryAttemptBinding({
    repositoryRoot,
    artifactRoot: captureRoot,
    requestedRunId: options.requestedRunId,
    backendRunId: fixtureRunId,
    selection,
  });
  const transport = json(captureRoot, 'transport-observations.private.json');
  validateRuntimePreparation(captureRoot, fixtureRunId, capture.saveRetryPreparation, transport);
  requirePreparationAttemptIdentity(capture.saveRetryPreparation, binding);
  requireCleanupEvidence(json(captureRoot, 'external-cleanup.private.json'), binding.captureRunId);
  await requireSourceAndHelpers(repositoryRoot, capture);
  const rows = requireNativePilotAssertions(selection);
  const recipes = expectedEvidencePaths(selection, binding.backendAttemptId);
  const bindings: AssertionBinding[] = rows.map((row) => ({
    id: row.id,
    requirementRefs: [...row.requirementRefs],
    evidencePaths: recipes.get(row.id)!.evidencePaths,
  }));
  const parent = assertArtifactPath(captureRoot, 'assertions');
  await mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await privateRoot(parent);
  const directory = assertArtifactPath(captureRoot, `assertions/${binding.backendAttemptId}`);
  await mkdir(directory, { mode: 0o700 });
  for (const [index, row] of rows.entries()) {
    const bindingRow = bindings[index];
    for (const [kindIndex, evidencePath] of bindingRow.evidencePaths.entries()) {
      const references = originalReferencesFor(row.id, row.evidenceKinds[kindIndex]);
      assert(
        references.length > 0,
        `No runtime recipe for ${row.id}/${row.evidenceKinds[kindIndex]}`,
      );
      const referenceRows: EvidenceReference[] = [];
      for (const reference of references) {
        const bytes = readNativeEvidence(captureRoot, reference, !reference.endsWith('.png'));
        referenceRows.push({ path: reference, sha256: sha256(bytes) });
      }
      await writeFile(
        assertArtifactPath(captureRoot, evidencePath),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: nativeSaveRetryAssertionEvidenceKind,
            purpose: 'runtime',
            assertionId: row.id,
            evidenceKind: row.evidenceKinds[kindIndex],
            requirementRefs: row.requirementRefs,
            fixtureRunId,
            attemptId: binding.backendAttemptId,
            scenarioHash: selection.scenarioHash,
            requirementHash: selection.requirementHash,
            references: referenceRows,
            nativePassingCases: 0,
            scope:
              'prepared runtime save/retry proof; public receipt/finalization and engine qualification are separate',
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
    }
  }
  await requireNoNativeCensusFailure(captureRoot);
  return { bindings };
}

async function collectOriginalFiles(
  repositoryRoot: string,
  captureRoot: string,
  selection: NativePilotSelection,
  requestedRunId: string,
  fixtureRunId: string,
): Promise<{
  binding: NativeSaveRetryAttemptBinding;
  capture: SaveRetryCapture;
  bindings: AssertionBinding[];
  files: Map<string, CollectedFile>;
}> {
  const validated = await validateCapture(
    repositoryRoot,
    captureRoot,
    selection,
    requestedRunId,
    fixtureRunId,
    true,
  );
  const bindings = validated.bindings;
  await requireProofs(captureRoot, selection, validated.binding, bindings, validated.files);
  await addOptionalCaptureFiles(validated.files, captureRoot);
  await addHelperSources(validated.files, repositoryRoot, validated.capture);
  await requireNoNativeCensusFailure(captureRoot);
  return {
    binding: validated.binding,
    capture: validated.capture,
    bindings,
    files: validated.files,
  };
}

async function copyNativeCommandLog(
  artifact: NativeCommandLogArtifact,
  destination: string,
  outputRoot: string,
  destinationRelative: string,
): Promise<void> {
  const before = await inspectPrivateCommandLog(artifact.root, artifact.relative);
  assert.equal(
    before.identity,
    artifact.identity,
    `Native command log changed before copy: ${artifact.relative}`,
  );
  assert.equal(
    before.metadata.size,
    artifact.sizeBytes,
    `Native command log size changed before copy: ${artifact.relative}`,
  );
  const digest = createHash('sha256');
  let sizeBytes = 0;
  const hashing = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      digest.update(bytes);
      callback(null, bytes);
    },
  });
  await pipeline(
    createReadStream(before.file),
    hashing,
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
  const after = await inspectPrivateCommandLog(artifact.root, artifact.relative);
  assert.equal(
    after.identity,
    artifact.identity,
    `Native command log changed during copy: ${artifact.relative}`,
  );
  assert.equal(
    after.metadata.size,
    artifact.sizeBytes,
    `Native command log size changed during copy: ${artifact.relative}`,
  );
  assert.equal(
    sizeBytes,
    artifact.sizeBytes,
    `Copied native command log size changed: ${artifact.relative}`,
  );
  assert.equal(
    digest.digest('hex'),
    artifact.sha256,
    `Copied native command log hash changed: ${artifact.relative}`,
  );
  const copied = await readNativeCommandLog(outputRoot, destinationRelative);
  assert.equal(
    copied.sizeBytes,
    artifact.sizeBytes,
    `Staged native command log size changed: ${artifact.relative}`,
  );
  assert.equal(
    copied.sha256,
    artifact.sha256,
    `Staged native command log hash changed: ${artifact.relative}`,
  );
}

async function writeExclusiveTree(
  outputRoot: string,
  prefix: string,
  binding: NativeSaveRetryAttemptBinding,
  files: Map<string, CollectedFile>,
): Promise<{ path: string; sha256: string }> {
  const parent = assertArtifactPath(outputRoot, 'evidence');
  await mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await privateRoot(parent);
  const directory = assertArtifactPath(outputRoot, prefix);
  await mkdir(directory, { mode: 0o700 });
  for (const [relative, file] of files) {
    const destination = assertArtifactPath(directory, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const destinationRelative = path.relative(outputRoot, destination);
    if (Buffer.isBuffer(file)) {
      await writeFile(destination, file, { flag: 'wx', mode: 0o600 });
      assert.equal(
        sha256(await readFile(destination)),
        sha256(file),
        `Copied bytes differ: ${relative}`,
      );
    } else {
      await copyNativeCommandLog(file, destination, outputRoot, destinationRelative);
    }
  }
  const manifestPath = `${prefix}/copy-manifest.private.json`;
  const manifestBytes = Buffer.from(
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'private native save/retry evidence copy, not public outcome',
        requestedRunId: binding.requestedRunId,
        captureRunId: binding.captureRunId,
        fixtureRunId: binding.backendRunId,
        nativePassingCases: 0,
        files: [...files].map(([file, value]) => ({
          path: file,
          sizeBytes: fileSizeBytes(value),
          sha256: fileSha256(value),
        })),
      },
      null,
      2,
    ),
  );
  await writeFile(assertArtifactPath(outputRoot, manifestPath), manifestBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  return { path: manifestPath, sha256: sha256(manifestBytes) };
}

/** Stage private iOS proof only after every original gate passes; nativePassingCases stays zero. */
export async function stageNativeSaveRetryPublicEvidence(options: {
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
  bindings: AssertionBinding[];
  lifecycle?: NativePublicEvidenceLifecycle;
}) {
  stageFence(options.lifecycle, 'selection:before');
  const { repositoryRoot, selection } = await freshSelection(
    options.repositoryRoot,
    options.selection,
  );
  stageFence(options.lifecycle, 'selection:after');
  const captureRoot = await privateRoot(options.captureRoot);
  const outputRoot = await privateRoot(options.outputRoot);
  assert.match(options.requestedRunId, runId);
  assert.match(options.fixtureRunId, runId);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.notEqual(captureRoot, outputRoot);
  await requireNoNativeCensusFailure(captureRoot);
  await requireNoNativeCensusFailure(outputRoot);
  stageFence(options.lifecycle, 'collect-original:before');
  const original = await collectOriginalFiles(
    repositoryRoot,
    captureRoot,
    selection,
    options.requestedRunId,
    options.fixtureRunId,
  );
  stageFence(options.lifecycle, 'collect-original:after');
  assert.deepEqual(original.bindings, options.bindings);
  const manifest = await writeExclusiveTree(
    outputRoot,
    `evidence/${original.binding.captureRunId}`,
    original.binding,
    original.files,
  );
  stageFence(options.lifecycle, 'write-staged-tree:after');
  await requireNoNativeCensusFailure(captureRoot);
  await requireNoNativeCensusFailure(outputRoot);
  const stagedPrefix = `evidence/${original.binding.captureRunId}`;
  const stagedRoot = path.join(outputRoot, stagedPrefix);
  await readNativeSaveRetryAttemptBinding({
    repositoryRoot,
    artifactRoot: stagedRoot,
    requestedRunId: options.requestedRunId,
    backendRunId: options.fixtureRunId,
    selection,
  });
  stageFence(options.lifecycle, 'reread-staged-binding:after');
  const final = await freshSelection(repositoryRoot, selection);
  assert.deepEqual(final.selection, selection, 'Selection changed during save/retry staging');
  stageFence(options.lifecycle, 'final-selection:after');
  return {
    copyManifest: manifest,
    assertions: original.bindings.map((row) => ({
      id: row.id,
      requirementRefs: row.requirementRefs,
      outcome: 'passed' as const,
      evidencePaths: row.evidencePaths.map((relative) => `${stagedPrefix}/${relative}`),
    })),
    artifacts: [
      manifest.path,
      ...[
        saveRetryAttemptBindingPath,
        nativeSaveRetryRuntimeMetadataPath,
        'capture.private.json',
        'runtime-adapter.private.json',
        'external-cleanup.private.json',
        'transport-observations.private.json',
        nativeSaveRetryRuntimeFramePath,
      ].map((relative) => `${stagedPrefix}/${relative}`),
    ],
    nativePassingCases: 0,
  };
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    assert.equal(await realpath(absolute), absolute, 'Staged evidence contains a symlink');
    if (entry.isDirectory()) {
      const info = await lstat(absolute);
      assert.equal(info.mode & 0o777, 0o700, 'Staged evidence directory is not private');
      result.push(...(await listFiles(absolute, relative)));
    } else {
      assert(entry.isFile(), 'Staged evidence contains a non-regular entry');
      result.push(relative);
    }
  }
  return result.sort();
}

/** Verify the private copy against its manifest and, when present, the immutable original root. */
export async function verifyStagedNativeSaveRetryEvidence(options: {
  repositoryRoot: string;
  selection: NativePilotSelection;
  outputRoot: string;
  copyManifest: { path: string; sha256: string };
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  captureRoot?: string;
}): Promise<void> {
  const { repositoryRoot, selection } = await freshSelection(
    options.repositoryRoot,
    options.selection,
  );
  const outputRoot = await privateRoot(options.outputRoot);
  assert.equal(path.basename(outputRoot), options.requestedRunId);
  assert.match(options.captureRunId, runId);
  assert.match(options.fixtureRunId, runId);
  const prefix = `evidence/${options.captureRunId}`;
  assert.equal(options.copyManifest.path, `${prefix}/copy-manifest.private.json`);
  const manifestBytes = readNativeEvidence(outputRoot, options.copyManifest.path, true);
  assert.equal(
    sha256(manifestBytes),
    options.copyManifest.sha256,
    'Staged native save/retry copy manifest changed',
  );
  const manifest = record(JSON.parse(manifestBytes.toString()), 'save/retry copy manifest');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'private native save/retry evidence copy, not public outcome');
  assert.equal(manifest.requestedRunId, options.requestedRunId);
  assert.equal(manifest.captureRunId, options.captureRunId);
  assert.equal(manifest.fixtureRunId, options.fixtureRunId);
  assert.equal(manifest.nativePassingCases, 0);
  const rows = array(manifest.files, 'save/retry copy files').map((raw) => {
    const row = record(raw, 'save/retry copied file');
    assert(typeof row.path === 'string' && row.path.length > 0);
    assert(
      typeof row.sizeBytes === 'number' && Number.isSafeInteger(row.sizeBytes) && row.sizeBytes > 0,
    );
    assert(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256));
    return { path: row.path, sizeBytes: row.sizeBytes, sha256: row.sha256 };
  });
  assert.equal(new Set(rows.map((row) => row.path)).size, rows.length);
  const stagedRoot = path.join(outputRoot, prefix);
  await privateRoot(stagedRoot);
  const actual = await listFiles(stagedRoot);
  assert.deepEqual(actual, [...rows.map((row) => row.path), 'copy-manifest.private.json'].sort());
  const stagedCapture = json(stagedRoot, 'capture.private.json') as SaveRetryCapture;
  requireSaveRetryCaptureIdentity(stagedCapture, options.captureRunId);
  assert.equal(stagedCapture.backend.runId, options.fixtureRunId);
  const stagedCommandLogs = commandArtifactPaths(
    stagedCapture,
    stagedRoot,
    commandArtifactSourceRoot(stagedCapture, options.captureRunId),
  ).logPaths;
  const stagedFiles = new Map<string, CollectedFile>();
  for (const row of rows) {
    assert.notEqual(row.path, 'copy-manifest.private.json');
    const file = stagedCommandLogs.has(row.path)
      ? await readNativeCommandLog(stagedRoot, row.path)
      : readNativeEvidence(stagedRoot, row.path, !row.path.endsWith('.png'));
    assert.equal(
      fileSizeBytes(file),
      row.sizeBytes,
      `Staged save/retry file size changed: ${row.path}`,
    );
    assert.equal(fileSha256(file), row.sha256, `Staged save/retry evidence changed: ${row.path}`);
    stagedFiles.set(row.path, file);
  }
  const binding = await readNativeSaveRetryAttemptBinding({
    repositoryRoot,
    artifactRoot: stagedRoot,
    requestedRunId: options.requestedRunId,
    backendRunId: options.fixtureRunId,
    selection,
  });
  assert.equal(binding.captureRunId, options.captureRunId);
  assert.equal(binding.backendRunId, options.fixtureRunId);
  await requireBuildMetadata(stagedCapture.build);
  await requireSourceAndHelpers(repositoryRoot, stagedCapture);
  requireRuntimeMetadata(
    json(stagedRoot, nativeSaveRetryRuntimeMetadataPath),
    binding,
    stagedCapture,
  );
  requireCleanupEvidence(json(stagedRoot, 'external-cleanup.private.json'), options.captureRunId);
  const stagedAdapterValue = json(stagedRoot, 'runtime-adapter.private.json');
  const stagedBindings = parseAssertionBindings(
    record(stagedAdapterValue, 'iOS save/retry runtime adapter').assertionBindings,
  );
  requireAdapter(stagedAdapterValue, binding, stagedCapture, stagedBindings);
  validateRuntimePreparation(
    stagedRoot,
    options.fixtureRunId,
    stagedCapture.saveRetryPreparation,
    json(stagedRoot, 'transport-observations.private.json'),
  );
  requirePreparationAttemptIdentity(stagedCapture.saveRetryPreparation, binding);
  await requireProofs(stagedRoot, selection, binding, stagedBindings, stagedFiles);
  if (options.captureRoot !== undefined) {
    const captureRoot = await privateRoot(options.captureRoot);
    const original = await collectOriginalFiles(
      repositoryRoot,
      captureRoot,
      selection,
      options.requestedRunId,
      options.fixtureRunId,
    );
    for (const row of rows) {
      const originalFile = original.files.get(row.path);
      assert(originalFile, `Staged file has no immutable original: ${row.path}`);
      assert.equal(
        fileSha256(originalFile),
        row.sha256,
        `Staged file differs from original: ${row.path}`,
      );
    }
    const after = await freshSelection(repositoryRoot, selection);
    assert.deepEqual(
      after.selection,
      selection,
      'Selection changed while verifying staged evidence',
    );
  }
  await requireNoNativeCensusFailure(outputRoot);
  await requireNoNativeCensusFailure(stagedRoot);
}

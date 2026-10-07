import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeAtomicDetoxConnectionBytes } from './detox-connection-evidence';
import {
  DetoxIntegratedSessionBaselineError,
  expectedSessionStepIds,
  requireDetoxFinalCaptureQualification,
  runDetoxIntegratedSessionBaseline,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselineReport,
  type DetoxBaselineRunnerPaths,
  type DetoxIntegratedSessionBaselineOptions,
} from './detox-integrated-session-baseline';
import {
  revalidateDetoxRuntimeBuildMetadata,
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from './detox-runtime-build-metadata';
import {
  buildDetoxSessionAssertionBindings,
  type DetoxSessionAssertionBinding,
} from './native-detox-session-public-staging';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
  type NativePilotSelection,
} from './native-pilot-contract';
import { readNativeEvidenceObservation } from './native-view-evidence';

const runIdPattern = /^[a-f0-9]{24}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const maxPrivateJsonBytes = 8 * 1024 * 1024;
const adapterReceiptName = 'detox-session-public-adapter.private.json';
const finalCaptureName = 'capture-final.private.json';
const finalCleanupName = 'cleanup-final.private.json';
const requiredEvidenceNames = [
  'detox-session-result.private.json',
  'detox-session-progress.private.json',
  'detox-auth-metadata.private.json',
  'detox-session-cache-observations.private.json',
  'detox-phase-checkpoints.private.json',
  finalCaptureName,
  finalCleanupName,
] as const;

type BaselineRun = Awaited<ReturnType<typeof runDetoxIntegratedSessionBaseline>>;
type BaselineRunner = (options: DetoxIntegratedSessionBaselineOptions) => Promise<BaselineRun>;
type QualifiedDetoxBuild = DetoxBaselineBuildInstrumentation & DetoxRuntimeBuildMetadata;

export type IosDetoxSessionPublicAdapterOptions = Readonly<{
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  build: QualifiedDetoxBuild;
  runnerPaths: DetoxBaselineRunnerPaths;
  signal?: AbortSignal;
  deadlineMs?: number;
  /** Caller-owned absolute monotonic deadline; downstream work may not restart it. */
  deadlineAtMonotonicMs?: number;
  /** Relocated qualified-build source root carried for provenance. */
  reuseBuildSourceRoot?: string;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  /** Private control seam; production defaults to the retained owned baseline. */
  runBaseline?: BaselineRunner;
}>;

export type IosDetoxSessionPublicAdapterResult = Readonly<{
  schemaVersion: 1;
  kind: 'private-ios-detox-session-public-adapter-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  platform: 'ios';
  engine: 'detox';
  scenario: 'SCN-session-ios';
  mode: 'integration';
  scenarioHash: string;
  requirementHash: string;
  baselineResult: DetoxBaselineReport['result'];
  baselineError: { name: string; message: string } | null;
  terminal: 'private-verified' | 'blocked';
  terminalReceiptBound: boolean;
  verificationResult: 'passed' | 'blocked';
  localClear: 'observed' | 'not-observed';
  localClearAfterSignout: 'absent' | 'unknown';
  localClearAfterSignedOutRelaunch: 'absent' | 'unknown';
  serverRevocation: 'decision-needed';
  publicPromotionEligible: false;
  nativePassingCases: 0;
  publicPassingCases: 0;
  assertionBindings: readonly DetoxSessionAssertionBinding[];
  evidenceFiles: readonly { name: string; bytes: number; sha256: string }[];
  buildFingerprint: Readonly<{
    binaryHash: string;
    sourceTreeHash: string;
    helperInputsHash: string;
    detoxConfigHash: string;
    embeddedRuntimeConfigHash: string;
  }> | null;
  runtimeBuildMetadata: DetoxRuntimeBuildMetadata | null;
  fixtureHash: string | null;
  flagsHash: string | null;
  toolVersions: Readonly<Record<string, string>>;
  timingsMs: Readonly<{
    build: number;
    install: number;
    reset: number;
    scenario: number;
    verify: number;
    cleanup: number;
  }>;
  reportPath: string;
  reportSha256: string;
  receiptPath: string;
}>;

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function boundedError(error: unknown): { name: string; message: string } {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const message = error instanceof Error ? error.message : String(error);
  return { name, message: message.slice(0, 256) };
}

function requirePrivateHash(value: string, label: string): void {
  assert.match(value, hashPattern, `${label} must be a SHA-256 hash`);
}

function buildFingerprint(
  report: DetoxBaselineReport,
): IosDetoxSessionPublicAdapterResult['buildFingerprint'] {
  return {
    binaryHash: report.build.binaryHash,
    sourceTreeHash: report.build.source.sourceTreeHash,
    helperInputsHash: report.build.helperInputsHash,
    detoxConfigHash: report.build.detoxConfigHash,
    embeddedRuntimeConfigHash: report.build.embeddedRuntime.configSourceHash,
  };
}

function runtimeMetadataFromReport(report: DetoxBaselineReport): DetoxRuntimeBuildMetadata {
  const build = report.build as unknown as Record<string, unknown>;
  const metadata: unknown = {
    environmentHash: build.environmentHash,
    toolVersions: build.toolVersions,
    toolVersionEvidence: build.toolVersionEvidence,
  };
  requireDetoxRuntimeBuildMetadata(metadata, 'Detox baseline runtime metadata');
  return metadata;
}

/**
 * Bind the producer's original feature/profile and tool observations to the
 * qualified reusable build.  The comparator's flagsHash is the sealed
 * environmentHash; it is never recomputed from the per-build diagnostic hash
 * tuple.
 */
export function requireDetoxSessionRuntimeMetadataMatch(
  qualified: unknown,
  reported: unknown,
): DetoxRuntimeBuildMetadata {
  requireDetoxRuntimeBuildMetadata(qualified, 'Qualified Detox runtime metadata');
  requireDetoxRuntimeBuildMetadata(reported, 'Detox baseline runtime metadata');
  assert.equal(
    reported.environmentHash,
    qualified.environmentHash,
    'Detox baseline flags profile differs from the qualified build',
  );
  assert.deepEqual(
    reported.toolVersions,
    qualified.toolVersions,
    'Detox baseline tool versions differ from the qualified build',
  );
  assert.deepEqual(
    reported.toolVersionEvidence,
    qualified.toolVersionEvidence,
    'Detox baseline tool evidence differs from the qualified build',
  );
  return reported;
}

function reportTimings(
  report: DetoxBaselineReport,
): IosDetoxSessionPublicAdapterResult['timingsMs'] {
  const raw = (report as unknown as Record<string, unknown>).timingsMs;
  assert(
    raw && typeof raw === 'object' && !Array.isArray(raw),
    'Detox baseline phase timings are missing',
  );
  const result = {} as Record<string, number>;
  for (const key of ['build', 'install', 'reset', 'scenario', 'verify', 'cleanup'] as const) {
    const value: unknown = (raw as Record<string, unknown>)[key];
    assert(
      typeof value === 'number' && Number.isFinite(value) && value > 0,
      `Detox ${key} timing is missing`,
    );
    result[key] = value;
  }
  return result as IosDetoxSessionPublicAdapterResult['timingsMs'];
}

/** Require the one documented iOS/Detox session cell before any owned acquisition. */
export function requireIosDetoxSessionSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-session-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-session-ios');
  assert.equal(selection.scenario.platform, 'ios');
  assert(
    selection.scenario.engine === undefined || selection.scenario.engine === 'detox',
    'Session scenario engine is not compatible with Detox',
  );
  assert.equal(selection.scenario.flowId, 'FLW-session');
  requirePrivateHash(selection.scenarioHash, 'Session scenario hash');
  requirePrivateHash(selection.requirementHash, 'Session requirement hash');
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...nativeSessionAssertionIds],
    'Session assertion order changed before Detox acquisition',
  );
}

/** Validate immutable request/build/runner identity without touching a resource. */
export function requireIosDetoxSessionRequest(input: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  build: DetoxBaselineBuildInstrumentation;
  runnerPaths: DetoxBaselineRunnerPaths;
}): void {
  assert.match(input.requestedRunId, runIdPattern, 'Requested run ID is invalid');
  requireIosDetoxSessionSelection(input.selection);
  const root = path.resolve(input.repositoryRoot);
  const expectedArtifact = path.join(root, '.qa/artifacts/native-pilot', input.requestedRunId);
  assert.equal(
    path.resolve(input.artifactRoot),
    expectedArtifact,
    'Detox session artifact root is not bound to the requested run ID',
  );
  assert.equal(
    input.build.platform,
    'ios',
    'The iOS Detox session adapter cannot consume another platform build',
  );
  assert.equal(input.build.configuration, 'ios.sim.debug');
  assert.equal(input.build.appIdentifier, 'com.edufelip.mychampions.dev');
  requireDetoxRuntimeBuildMetadata(input.build, 'Qualified Detox session build');
  assert.equal(input.build.embeddedRuntime.variant, 'dev');
  assert.equal(input.build.embeddedRuntime.appIdentifier, input.build.appIdentifier);
  assert.equal(input.runnerPaths.privateCandidate, undefined);
  assert.deepEqual(input.runnerPaths, {
    entryPath: path.join(root, 'scripts/run-detox-integrated-session-baseline.ts'),
    jestConfigPath: path.join(root, 'e2e/jest.detox-integrated-session-baseline.config.js'),
    testPath: path.join(root, 'e2e/detox-integrated-session-baseline.e2e.test.js'),
  });
}

/** Select the current inventory cell; callers cannot supply a second scenario list. */
export async function selectCurrentIosDetoxSession(
  repositoryRoot: string,
): Promise<NativePilotSelection> {
  const root = await realpath(repositoryRoot);
  const inventory: unknown = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  );
  const selection = await selectNativePilotScenario(
    {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-session-ios',
      mode: 'integration',
    },
    inventory,
    root,
  );
  requireIosDetoxSessionSelection(selection);
  return selection;
}

type PrivateJson = Readonly<{ value: unknown; bytes: Buffer; sha256: string }>;
type AdapterLifecycle = Readonly<{
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}>;

function adapterFence(lifecycle: AdapterLifecycle, phase: string): void {
  lifecycle.signal?.throwIfAborted();
  const now = performance.now();
  assert(
    Number.isFinite(now) && now < lifecycle.deadlineAtMonotonicMs,
    `Detox session adapter deadline elapsed during ${phase}`,
  );
  lifecycle.signal?.throwIfAborted();
}

function readOwnedPrivateJson(
  artifactRoot: string,
  file: string,
  label: string,
  lifecycle: AdapterLifecycle,
): PrivateJson {
  const root = path.resolve(artifactRoot);
  const resolved = path.resolve(file);
  const relative = path.relative(root, resolved);
  assert(
    relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `${label} escaped the owned artifact root`,
  );
  adapterFence(lifecycle, `${label}:before-read`);
  const observation = readNativeEvidenceObservation(root, relative, true, 'private-artifact');
  adapterFence(lifecycle, `${label}:after-read`);
  assert(
    observation.bytes.byteLength > 0 && observation.bytes.byteLength <= maxPrivateJsonBytes,
    `${label} is not an owned bounded private file`,
  );
  return {
    value: JSON.parse(observation.bytes.toString('utf8')) as unknown,
    bytes: observation.bytes,
    sha256: hashBytes(observation.bytes),
  };
}

async function requireAdapterArtifactRoot(
  repositoryRoot: string,
  artifactRoot: string,
  requestedRunId: string,
): Promise<void> {
  const root = await realpath(repositoryRoot);
  const artifact = path.resolve(artifactRoot);
  assert.equal(
    artifact,
    path.join(root, '.qa/artifacts/native-pilot', requestedRunId),
    'Detox session artifact root changed after request validation',
  );
  assert.equal(await realpath(artifact), artifact, 'Detox session artifact root is not canonical');
  const metadata = await lstat(artifact);
  assert(
    metadata.isDirectory() &&
      !metadata.isSymbolicLink() &&
      (process.getuid === undefined || metadata.uid === process.getuid()) &&
      (metadata.mode & 0o777) === 0o700,
    'Detox session artifact root is not an owned private directory',
  );
}

function requireLocalClearEvidence(report: DetoxBaselineReport): {
  afterSignout: 'absent';
  afterSignedOutRelaunch: 'absent';
} {
  const cache = report.sessionCache;
  assert(cache, 'Detox session cache checkpoints are missing');
  assert.equal(cache.afterSignout.status, 'session-absent');
  assert.equal(cache.afterSignedOutRelaunch.status, 'session-absent');
  const auth = report.authMetadata;
  assert(auth, 'Detox iOS auth metadata checkpoints are missing');
  assert.equal(auth.afterSignout.sessionPresent, false);
  assert.equal(auth.afterSignedOutRelaunch.sessionPresent, false);
  assert(report.snapshots, 'Detox SQL/profile snapshots are missing');
  assert.deepEqual(report.snapshots.checkpointIds, [
    'beforeLogin',
    'afterLogin',
    'afterRestoration',
    'afterSignedOutRelaunch',
  ]);
  assert(report.transport, 'Detox initial auth transport is missing');
  assert(report.finalTransport, 'Detox final transport is missing');
  assert(report.ui, 'Detox UI assertion metadata is missing');
  assert.equal(report.ui.launchCount, 3);
  assert.deepEqual(report.ui.assertionIds, [...expectedSessionStepIds]);
  return { afterSignout: 'absent', afterSignedOutRelaunch: 'absent' };
}

function requireBaselineReportIdentity(report: DetoxBaselineReport, requestedRunId: string): void {
  assert.equal(report.kind, 'private-detox-integrated-session-baseline-not-public-receipt');
  assert.equal(report.captureRunId, requestedRunId);
  assert.equal(report.platform, 'ios');
  assert.equal(report.role, 'professional');
  assert.equal(report.publicNativePassingCases, 0);
  assert(Array.isArray(report.evidenceFiles), 'Detox baseline evidence file list is missing');
  if (report.result === 'passed') {
    const rawFiles: unknown = report.evidenceFiles;
    assert(Array.isArray(rawFiles));
    const files = rawFiles as readonly unknown[];
    const names = new Set<string>();
    for (const file of files) {
      assert(
        file && typeof file === 'object' && 'name' in file && typeof file.name === 'string',
        'Detox baseline evidence file name is malformed',
      );
      names.add(file.name);
    }
    for (const name of requiredEvidenceNames)
      assert(names.has(name), `Detox baseline evidence is missing ${name}`);
  }
}

async function publishAdapterReceipt(
  artifactRoot: string,
  result: Omit<IosDetoxSessionPublicAdapterResult, 'receiptPath'>,
  lifecycle: AdapterLifecycle,
): Promise<string> {
  const root = path.resolve(artifactRoot);
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  assert(bytes.byteLength <= 64 * 1024, 'Detox session adapter receipt exceeds its bound');
  adapterFence(lifecycle, 'adapter receipt:before-publication');
  await writeAtomicDetoxConnectionBytes(root, adapterReceiptName, bytes, 64 * 1024, {
    signal: lifecycle.signal,
    deadlineAt: lifecycle.deadlineAtMonotonicMs,
    checkLive: () => adapterFence(lifecycle, 'adapter receipt:publication'),
  });
  adapterFence(lifecycle, 'adapter receipt:after-publication');
  return path.join(root, adapterReceiptName);
}

/**
 * Run the retained Detox session baseline through its real owned lifecycle.
 * This adapter emits a private, terminal-bound candidate for the outer
 * native-pilot finalizer; server revocation remains unresolved and no
 * public/native count is promoted here.
 */
export async function runIosDetoxSessionPublicAdapter(
  options: IosDetoxSessionPublicAdapterOptions,
): Promise<IosDetoxSessionPublicAdapterResult> {
  const startedAt = performance.now();
  const deadlineAtMonotonicMs =
    options.deadlineAtMonotonicMs ?? startedAt + (options.deadlineMs ?? 600_000);
  const lifecycle: AdapterLifecycle = {
    signal: options.signal,
    deadlineAtMonotonicMs,
  };
  adapterFence(lifecycle, 'request');
  const root = await realpath(options.repositoryRoot);
  adapterFence(lifecycle, 'repository root');
  requireIosDetoxSessionRequest({ ...options, repositoryRoot: root });
  await requireAdapterArtifactRoot(root, options.artifactRoot, options.requestedRunId);
  adapterFence(lifecycle, 'artifact root');
  const current = await selectCurrentIosDetoxSession(root);
  adapterFence(lifecycle, 'selection');
  assert.equal(
    canonicalJson(current),
    canonicalJson(options.selection),
    'Detox session selection changed before owned baseline acquisition',
  );
  requireIosDetoxSessionSelection(current);
  adapterFence(lifecycle, 'selection validation');

  const runner = options.runBaseline ?? runDetoxIntegratedSessionBaseline;
  await revalidateDetoxRuntimeBuildMetadata(root, options.build, () =>
    adapterFence(lifecycle, 'runtime metadata'),
  );
  adapterFence(lifecycle, 'runtime metadata validation');
  let baseline: BaselineRun | null = null;
  let baselineError: { name: string; message: string } | null = null;
  try {
    baseline = await runner({
      repositoryRoot: root,
      serverRoot: path.resolve(options.serverRoot),
      artifactRoot: path.resolve(options.artifactRoot),
      platform: 'ios',
      configuration: 'ios.sim.debug',
      role: 'professional',
      build: options.build,
      signal: options.signal,
      deadlineMs: options.deadlineMs,
      deadlineAtMonotonicMs,
      parentEnv: options.parentEnv,
      runnerPaths: options.runnerPaths,
    });
  } catch (error) {
    if (!(error instanceof DetoxIntegratedSessionBaselineError) || !error.report) throw error;
    baselineError = boundedError(error);
    baseline = {
      report: error.report,
      reportPath: path.join(options.artifactRoot, 'detox-integrated-session-baseline.private.json'),
    };
  }

  assert(baseline, 'Detox baseline did not return a terminal report');
  adapterFence(lifecycle, 'baseline terminal report');
  const reportFile = path.resolve(baseline.reportPath);
  const expectedReportFile = path.join(
    path.resolve(options.artifactRoot),
    'detox-integrated-session-baseline.private.json',
  );
  assert.equal(
    reportFile,
    expectedReportFile,
    'Detox report path is not the owned terminal report',
  );
  const reportJson = readOwnedPrivateJson(
    options.artifactRoot,
    reportFile,
    'Detox baseline report',
    lifecycle,
  );
  const report = reportJson.value as DetoxBaselineReport;
  assert.equal(
    canonicalJson(report),
    canonicalJson(baseline.report),
    'Detox returned report differs from its persisted terminal report',
  );
  requireBaselineReportIdentity(report, options.requestedRunId);
  adapterFence(lifecycle, 'baseline report validation');

  let terminalReceiptBound = false;
  let localClear: IosDetoxSessionPublicAdapterResult['localClear'] = 'not-observed';
  let localClearAfterSignout: IosDetoxSessionPublicAdapterResult['localClearAfterSignout'] =
    'unknown';
  let localClearAfterSignedOutRelaunch: IosDetoxSessionPublicAdapterResult['localClearAfterSignedOutRelaunch'] =
    'unknown';
  let assertionBindings: readonly DetoxSessionAssertionBinding[] = [];
  let evidenceFiles: readonly { name: string; bytes: number; sha256: string }[] = [];
  let buildFingerprintValue: IosDetoxSessionPublicAdapterResult['buildFingerprint'] = null;
  let runtimeBuildMetadata: DetoxRuntimeBuildMetadata | null = null;
  let fixtureHash: string | null = null;
  let flagsHash: string | null = null;
  let toolVersions: Readonly<Record<string, string>> = {};
  let timingsMs: IosDetoxSessionPublicAdapterResult['timingsMs'] = {
    build: 0,
    install: 0,
    reset: 0,
    scenario: 0,
    verify: 0,
    cleanup: 0,
  };
  if (!baselineError && report.result === 'passed') {
    try {
      const captureJson = readOwnedPrivateJson(
        options.artifactRoot,
        path.join(options.artifactRoot, finalCaptureName),
        'Detox final capture ledger',
        lifecycle,
      );
      const cleanupJson = readOwnedPrivateJson(
        options.artifactRoot,
        path.join(options.artifactRoot, finalCleanupName),
        'Detox final cleanup ledger',
        lifecycle,
      );
      requireDetoxFinalCaptureQualification({
        capture: captureJson.value,
        cleanupFinal: cleanupJson.value,
        report,
      });
      const clear = requireLocalClearEvidence(report);
      const fingerprint = buildFingerprint(report);
      const reportedRuntimeMetadata = runtimeMetadataFromReport(report);
      requireDetoxSessionRuntimeMetadataMatch(options.build, reportedRuntimeMetadata);
      await revalidateDetoxRuntimeBuildMetadata(root, options.build, () =>
        adapterFence(lifecycle, 'runtime metadata revalidation'),
      );
      adapterFence(lifecycle, 'terminal evidence validation');
      buildFingerprintValue = fingerprint;
      runtimeBuildMetadata = reportedRuntimeMetadata;
      // T15/Maestro and the native comparator use the reusable build's
      // environmentHash as the sealed cohort flagsFingerprint.  The five
      // build hashes above remain diagnostic identity, but must not be
      // rehashed into a per-run value here.
      flagsHash = reportedRuntimeMetadata.environmentHash;
      toolVersions = { ...reportedRuntimeMetadata.toolVersions };
      timingsMs = reportTimings(report);
      assertionBindings = buildDetoxSessionAssertionBindings(current, report);
      evidenceFiles = report.evidenceFiles.map((file) => ({ ...file }));
      fixtureHash = report.fixture?.fixtureHash ?? null;
      assert(fixtureHash && hashPattern.test(fixtureHash), 'Detox fixture hash is missing');
      adapterFence(lifecycle, 'terminal receipt binding');
      terminalReceiptBound = true;
      localClear = 'observed';
      localClearAfterSignout = clear.afterSignout;
      localClearAfterSignedOutRelaunch = clear.afterSignedOutRelaunch;
    } catch (error) {
      // Keep the baseline report and publish a bounded blocked receipt when
      // terminal evidence is missing or malformed; never promote a report
      // merely because its operation result says "passed".
      baselineError = boundedError(error);
    }
  }

  const resultWithoutReceipt: Omit<IosDetoxSessionPublicAdapterResult, 'receiptPath'> = {
    schemaVersion: 1,
    kind: 'private-ios-detox-session-public-adapter-not-public-receipt',
    requestedRunId: options.requestedRunId,
    requestedAttemptId: `${options.requestedRunId}:first`,
    captureRunId: report.captureRunId,
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-session-ios',
    mode: 'integration',
    scenarioHash: current.scenarioHash,
    requirementHash: current.requirementHash,
    baselineResult: report.result,
    baselineError,
    terminal: terminalReceiptBound ? 'private-verified' : 'blocked',
    terminalReceiptBound,
    verificationResult: terminalReceiptBound ? 'passed' : 'blocked',
    localClear,
    localClearAfterSignout,
    localClearAfterSignedOutRelaunch,
    serverRevocation: 'decision-needed',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    publicPassingCases: 0,
    assertionBindings,
    evidenceFiles,
    buildFingerprint: buildFingerprintValue,
    runtimeBuildMetadata,
    fixtureHash,
    flagsHash,
    toolVersions,
    timingsMs,
    reportPath: reportFile,
    reportSha256: reportJson.sha256,
  };
  adapterFence(lifecycle, 'final adapter result');
  const receiptPath = await publishAdapterReceipt(
    options.artifactRoot,
    resultWithoutReceipt,
    lifecycle,
  );
  return { ...resultWithoutReceipt, receiptPath };
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const compositionRoot = path.resolve(process.env.V7_COMPOSITION_ROOT ?? process.cwd());
const repositoryRoot = path.resolve(process.env.V7_Q_ROOT ?? compositionRoot);

const runId = '0123456789abcdef01234567';
const hash = 'a'.repeat(64);
const evidenceNames = [
  'detox-session-result.private.json',
  'detox-session-progress.private.json',
  'detox-android-session-checkpoints.private.json',
  'detox-session-cache-observations.private.json',
  'detox-phase-checkpoints.private.json',
  'capture-final.private.json',
  'cleanup-final.private.json',
] as const;

type AndroidSelection = Readonly<{
  scenarioHash: string;
  requirementHash: string;
  arguments: Readonly<Record<string, string>>;
}>;

type AndroidSessionAssertion = Readonly<{
  id: string;
  requirementRefs: readonly string[];
  outcome: 'passed';
  evidencePaths: readonly string[];
}>;

type AndroidStageResult = Readonly<{
  outputRoot: string;
  outputIdentity: unknown;
  copyManifest: { path: string; sha256: string };
  manifest: unknown;
  assertions: readonly AndroidSessionAssertion[];
}>;

type AndroidFinalizationApi = Readonly<{
  stageAndroidDetoxSessionPublicEvidence: (
    input: Record<string, unknown>,
  ) => Promise<AndroidStageResult>;
  verifyStagedAndroidDetoxSessionEvidence: (input: Record<string, unknown>) => Promise<unknown>;
  buildAndroidDetoxSessionVerifiedTerminalProof: (input: Record<string, unknown>) => string;
  mapAndroidDetoxSessionAssertionsToOuterTerminal: (
    input: Readonly<{
      assertions: readonly AndroidSessionAssertion[];
      terminalEvidencePath: string;
    }>,
  ) => AndroidSessionAssertion[];
  androidDetoxSessionVerifiedTerminalEvidenceName: string;
}>;

type AndroidContractApi = Readonly<{
  selectNativePilotScenario: (
    args: Readonly<Record<string, string>>,
    inventory: unknown,
    repositoryRoot: string,
  ) => Promise<AndroidSelection>;
  assertNativePilotCompletion: (
    receipt: unknown,
    selection: AndroidSelection,
    expected: Readonly<{
      runId: string;
      attemptId: string;
      target: Record<string, unknown>;
      inputs: Record<string, unknown>;
    }>,
    executedAttemptIds: readonly string[],
    artifactRoot: string,
  ) => void;
}>;

type AndroidSessionAttemptRecord = Record<string, unknown> & {
  adapterReceiptPath: string;
  captureCleanup: unknown;
  nativeExecution: unknown;
  verificationResult: unknown;
  recoveryLedgerReadFailures: readonly {
    ledger: 'capture-final' | 'cleanup-final';
    name: string;
    message: string;
  }[];
};

type AndroidProductionApi = Readonly<{
  runAndroidDetoxSessionPublicAdapter: (
    options: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  runAndroidDetoxSessionAttemptForNativePilot: (
    input: Record<string, unknown>,
    dependencies: Record<string, unknown>,
  ) => Promise<AndroidSessionAttemptRecord>;
  readActualDetoxRuntimeMetadata: (
    repositoryRoot: string,
    environmentHash: string,
  ) => Promise<Record<string, unknown>>;
  captureExactOwnedSnapshotForTest: (
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  writeTerminalFallbackForTest: (
    artifactRoot: string,
    name: string,
    input: Record<string, unknown>,
    publication: Record<string, unknown>,
  ) => Promise<string | null>;
  detoxSessionHelperClosure: readonly string[];
  hasAndroidDetoxSessionNativeExecution: (report: Readonly<{ childExecution: unknown }>) => boolean;
}>;

type AndroidRunnerApi = Readonly<{
  attachAndroidDetoxSessionStagingRecovery: (
    receipt: {
      artifacts: string[];
      cleanup: { status: string; recoveryRecordPath: string | null };
    },
    outputRoot: string,
    error: Readonly<{
      recoveryStatus: 'cleaned' | 'failed-recovery-ledger-retained';
      recoveryRecordPath: string | null;
    }>,
  ) => Promise<readonly string[]>;
  shouldBlockAndroidDetoxSessionOuterTerminal: (input: {
    nativeExecution: boolean;
    lifecycleNormalization: { status: string };
    publicReceiptBound: boolean;
    sharedLifecycleStatus: string;
  }) => boolean;
}>;

async function loadModules(): Promise<{
  finalization: AndroidFinalizationApi;
  contract: AndroidContractApi;
  production: AndroidProductionApi;
  runner: AndroidRunnerApi;
}> {
  const load = (relative: string): Promise<unknown> =>
    import(pathToFileURL(path.join(compositionRoot, relative)).href) as Promise<unknown>;
  const loadRecord = (relative: string): Promise<Record<string, unknown>> =>
    load(relative) as Promise<Record<string, unknown>>;
  return {
    finalization: (await load(
      'scripts/testing/native-detox-android-session-public-finalization.ts',
    )) as AndroidFinalizationApi,
    contract: (await load('scripts/testing/native-pilot-contract.ts')) as AndroidContractApi,
    production: {
      ...(await loadRecord('scripts/testing/native-detox-android-session-public-adapter.ts')),
      ...(await loadRecord('scripts/testing/native-detox-android-session-native-pilot-route.ts')),
      ...(await loadRecord('scripts/testing/detox-runtime-build-metadata.ts')),
      ...(await loadRecord('scripts/testing/detox-integrated-session-baseline.ts')),
    } as AndroidProductionApi,
    runner: (await loadRecord('scripts/testing/run-native-pilot.ts')) as AndroidRunnerApi,
  };
}

async function selectAndroidSession(contract: AndroidContractApi): Promise<AndroidSelection> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  return contract.selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'detox',
      scenario: 'SCN-session-android',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
}

async function writePrivateJson(root: string, name: string, value: unknown) {
  await writeFile(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function makeSnapshotRaceInput(
  production: AndroidProductionApi,
  artifactRoot: string,
  sessionRoot: string,
): Promise<{
  input: Record<string, unknown>;
  value: Record<string, unknown>;
  sourceName: string;
  stagedName: string;
  readCalls: () => number;
}> {
  const artifactMetadata = await lstat(artifactRoot);
  const sessionMetadata = await lstat(sessionRoot);
  const value = {
    schemaVersion: 1,
    runId: '0123456789abcdef01234567',
    scope: 'native-entry-android',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
  const sourceName = 'connection-snapshot-native-entry-android-beforeLogin.private.json';
  const stagedName = 'detox-profile-beforeLogin.private.json';
  let reads = 0;
  const sourceBytes = () => `${JSON.stringify(value)}\n`;
  const input: Record<string, unknown> = {
    session: { manifest: { artifactRoot: sessionRoot } },
    scope: 'native-entry-android',
    prefix: 'connection-snapshot',
    artifactRoot,
    stagedName,
    read: async () => {
      reads += 1;
      await writeFile(path.join(sessionRoot, sourceName), sourceBytes(), { mode: 0o600 });
      return value;
    },
    validate: (candidate: unknown) => candidate,
    signal: new AbortController().signal,
    deadlineAtMonotonicMs: performance.now() + 60_000,
    sessionArtifactRoot: sessionRoot,
    sessionArtifactRootIdentity: {
      dev: sessionMetadata.dev,
      ino: sessionMetadata.ino,
      uid: sessionMetadata.uid,
      gid: sessionMetadata.gid,
      mode: sessionMetadata.mode & 0o777,
    },
    artifactRootIdentity: {
      dev: artifactMetadata.dev,
      ino: artifactMetadata.ino,
      uid: artifactMetadata.uid,
      gid: artifactMetadata.gid,
      mode: artifactMetadata.mode & 0o777,
    },
  };
  assert.equal(typeof production.captureExactOwnedSnapshotForTest, 'function');
  return { input, value, sourceName, stagedName, readCalls: () => reads };
}

async function exchangeSnapshotRoot(
  sessionRoot: string,
  moved: string,
  foreign: string,
): Promise<void> {
  await rename(sessionRoot, moved);
  await symlink(foreign, sessionRoot);
}

async function restoreExchangedSnapshotRoot(sessionRoot: string, moved: string): Promise<void> {
  await unlink(sessionRoot);
  await rename(moved, sessionRoot);
}

void test('V11 snapshot capture keeps a clean owned root bound through descriptor staging', async () => {
  const { production } = await loadModules();
  const parent = await mkdtemp('/private/tmp/android-detox-session-snapshot-v11-positive-');
  const artifactRoot = path.join(parent, 'artifact');
  const sessionRoot = path.join(parent, 'session');
  await mkdir(artifactRoot, { mode: 0o700 });
  await mkdir(sessionRoot, { mode: 0o700 });
  await chmod(artifactRoot, 0o700);
  await chmod(sessionRoot, 0o700);
  try {
    const control = await makeSnapshotRaceInput(production, artifactRoot, sessionRoot);
    const result = await production.captureExactOwnedSnapshotForTest(control.input);
    assert.equal(control.readCalls(), 1);
    assert.equal(result.stagedFile, path.join(artifactRoot, control.stagedName));
    assert.equal(
      await readFile(path.join(artifactRoot, control.stagedName), 'utf8'),
      `${JSON.stringify(control.value)}\n`,
    );
    assert.equal(result.sourceFile, path.join(sessionRoot, control.sourceName));
    process.stdout.write(
      JSON.stringify({
        snapshot: 'clean-positive',
        sourceRootIdentity: 'stored-and-rechecked',
        stagedRootIdentity: 'stored-and-rechecked',
        stagedBy: 'descriptor-bound-owned-writer',
      }) + '\n',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V11 snapshot capture rejects an exchanged parent before discovery and never writes foreign output', async () => {
  const { production } = await loadModules();
  const parent = await mkdtemp('/private/tmp/android-detox-session-snapshot-v11-before-');
  const artifactRoot = path.join(parent, 'artifact');
  const sessionRoot = path.join(parent, 'session');
  const moved = path.join(parent, 'session-moved');
  const foreign = path.join(parent, 'foreign');
  await mkdir(artifactRoot, { mode: 0o700 });
  await mkdir(sessionRoot, { mode: 0o700 });
  await mkdir(foreign, { mode: 0o700 });
  await chmod(artifactRoot, 0o700);
  await chmod(sessionRoot, 0o700);
  await chmod(foreign, 0o700);
  try {
    const control = await makeSnapshotRaceInput(production, artifactRoot, sessionRoot);
    await writeFile(path.join(foreign, control.sourceName), `${JSON.stringify(control.value)}\n`, {
      mode: 0o600,
    });
    control.input.onBeforeSourceDiscovery = async () =>
      exchangeSnapshotRoot(sessionRoot, moved, foreign);
    await assert.rejects(
      production.captureExactOwnedSnapshotForTest(control.input),
      /artifact root identity changed|session artifact root changed/,
    );
    assert.equal(control.readCalls(), 0);
    await assert.rejects(lstat(path.join(foreign, control.stagedName)));
    await assert.rejects(lstat(path.join(artifactRoot, control.stagedName)));
    assert.equal((await lstat(moved)).isDirectory(), true);
    await restoreExchangedSnapshotRoot(sessionRoot, moved);
    process.stdout.write(
      JSON.stringify({
        snapshot: 'negative-parent-exchange-before-discovery',
        foreignWriteObserved: false,
      }) + '\n',
    );
  } finally {
    const sessionStat = await lstat(sessionRoot).catch(() => null);
    if (sessionStat?.isSymbolicLink()) await restoreExchangedSnapshotRoot(sessionRoot, moved);
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V11 snapshot capture rejects a foreign source root after discovery and after source read', async () => {
  const { production } = await loadModules();
  for (const hook of ['onAfterSourceDiscovery', 'onAfterSourceRead'] as const) {
    const parent = await mkdtemp(`/private/tmp/android-detox-session-snapshot-v11-${hook}-`);
    const artifactRoot = path.join(parent, 'artifact');
    const sessionRoot = path.join(parent, 'session');
    const moved = path.join(parent, 'session-moved');
    const foreign = path.join(parent, 'foreign');
    await mkdir(artifactRoot, { mode: 0o700 });
    await mkdir(sessionRoot, { mode: 0o700 });
    await mkdir(foreign, { mode: 0o700 });
    await chmod(artifactRoot, 0o700);
    await chmod(sessionRoot, 0o700);
    await chmod(foreign, 0o700);
    try {
      const control = await makeSnapshotRaceInput(production, artifactRoot, sessionRoot);
      await writeFile(
        path.join(foreign, control.sourceName),
        `${JSON.stringify(control.value)}\n`,
        { mode: 0o600 },
      );
      control.input[hook] = async () => exchangeSnapshotRoot(sessionRoot, moved, foreign);
      await assert.rejects(
        production.captureExactOwnedSnapshotForTest(control.input),
        /artifact root identity changed|session artifact root changed/,
      );
      assert.equal(control.readCalls(), hook === 'onAfterSourceRead' ? 1 : 0);
      await assert.rejects(lstat(path.join(foreign, control.stagedName)));
      await assert.rejects(lstat(path.join(artifactRoot, control.stagedName)));
      assert.equal((await lstat(moved)).isDirectory(), true);
      await restoreExchangedSnapshotRoot(sessionRoot, moved);
      process.stdout.write(JSON.stringify({ snapshot: hook, foreignWriteObserved: false }) + '\n');
    } finally {
      const sessionStat = await lstat(sessionRoot).catch(() => null);
      if (sessionStat?.isSymbolicLink()) await restoreExchangedSnapshotRoot(sessionRoot, moved);
      await rm(parent, { recursive: true, force: true });
    }
  }
});

function fallbackInput(): Record<string, unknown> {
  return {
    phase: 'publication:cleanup-ledger',
    error: new Error('private fallback control'),
    originalFailure: { phase: 'cleanup-final-ledger', name: 'Error' },
    cleanupFailures: ['cleanup-final-ledger'],
    acquisitionIntents: ['target', 'backend'],
    acquisitionSequence: ['target', 'backend'],
    backendCleanup: {
      status: 'unknown',
      attempted: false,
      result: 'unknown',
      reason: 'fallback control',
    },
  };
}

async function fallbackRoot(parent: string, name: string) {
  const root = path.join(parent, name);
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  const metadata = await lstat(root);
  return {
    root,
    identity: {
      dev: metadata.dev,
      ino: metadata.ino,
      uid: metadata.uid,
      gid: metadata.gid,
      mode: metadata.mode & 0o777,
    },
  };
}

void test('V12 terminal fallback uses a protected writer for clean publication', async () => {
  const { production } = await loadModules();
  const parent = await mkdtemp('/private/tmp/android-detox-session-fallback-v12-positive-');
  try {
    const owned = await fallbackRoot(parent, 'owned');
    const signal = new AbortController().signal;
    const file = await production.writeTerminalFallbackForTest(
      owned.root,
      'detox-fallback-positive.private.json',
      fallbackInput(),
      {
        signal,
        deadlineAt: performance.now() + 60_000,
        expectedRootIdentity: owned.identity,
      },
    );
    assert.equal(file, path.join(owned.root, 'detox-fallback-positive.private.json'));
    if (file === null) throw new Error('expected the fallback to publish');
    const metadata = await lstat(file);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.mode & 0o777, 0o600);
    const payload = JSON.parse(await readFile(file, 'utf8')) as { kind?: unknown };
    assert.equal(payload.kind, 'private Detox terminal publication fallback; not a public receipt');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V12 terminal fallback rejects expired and cancelled publication before creating evidence', async () => {
  const { production } = await loadModules();
  for (const mode of ['expired', 'cancelled'] as const) {
    const parent = await mkdtemp(`/private/tmp/android-detox-session-fallback-v12-${mode}-`);
    try {
      const owned = await fallbackRoot(parent, 'owned');
      const controller = new AbortController();
      if (mode === 'cancelled') controller.abort(new Error('fallback control cancelled'));
      const fileName = `detox-fallback-${mode}.private.json`;
      const file = await production.writeTerminalFallbackForTest(
        owned.root,
        fileName,
        fallbackInput(),
        {
          signal: controller.signal,
          deadlineAt: mode === 'expired' ? performance.now() - 1 : performance.now() + 60_000,
          expectedRootIdentity: owned.identity,
        },
      );
      assert.equal(file, null);
      await assert.rejects(lstat(path.join(owned.root, fileName)));
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
});

void test('V12 terminal fallback rejects a parent exchange before descriptor publication', async () => {
  const { production } = await loadModules();
  const parent = await mkdtemp('/private/tmp/android-detox-session-fallback-v12-exchange-');
  const moved = path.join(parent, 'owned-moved');
  const foreign = await fallbackRoot(parent, 'foreign');
  const owned = await fallbackRoot(parent, 'owned');
  try {
    let exchanged = false;
    const fileName = 'detox-fallback-exchange.private.json';
    const file = await production.writeTerminalFallbackForTest(
      owned.root,
      fileName,
      fallbackInput(),
      {
        signal: new AbortController().signal,
        deadlineAt: performance.now() + 60_000,
        expectedRootIdentity: owned.identity,
        beforePublish: async () => {
          await rename(owned.root, moved);
          await symlink(foreign.root, owned.root);
          exchanged = true;
        },
      },
    );
    assert.equal(exchanged, true);
    assert.equal(file, null);
    await assert.rejects(lstat(path.join(foreign.root, fileName)));
    await assert.rejects(lstat(path.join(owned.root, fileName)));
  } finally {
    const current = await lstat(owned.root).catch(() => null);
    if (current?.isSymbolicLink()) await unlink(owned.root);
    const movedStat = await lstat(moved).catch(() => null);
    if (movedStat?.isDirectory()) await rename(moved, owned.root);
    await rm(parent, { recursive: true, force: true });
  }
});

async function makeSourceEvidence(root: string) {
  const files = evidenceNames.map((name) => {
    const bytes = Buffer.from(
      JSON.stringify({
        kind: 'source-only-qualified-private-evidence',
        name,
        runId,
      }) + '\n',
    );
    return {
      name,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytesValue: bytes,
    };
  });
  for (const file of files)
    await writeFile(path.join(root, file.name), file.bytesValue, {
      mode: 0o600,
    });
  return files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }));
}

function buildQualifiedReport(
  evidenceFiles: readonly { name: string; bytes: number; sha256: string }[],
) {
  return {
    schemaVersion: 5,
    kind: 'private-detox-integrated-session-baseline-not-public-receipt',
    result: 'passed',
    publicNativePassingCases: 0,
    platform: 'android',
    configuration: 'android.emu.debug',
    role: 'professional',
    captureRunId: runId,
    snapshots: {
      checkpointIds: ['beforeLogin', 'afterLogin', 'afterRestoration', 'afterSignedOutRelaunch'],
    },
    sessionCache: {
      afterSignout: { status: 'session-absent' },
      afterSignedOutRelaunch: { status: 'session-absent' },
    },
    ui: {
      launchCount: 3,
      assertionIds: [
        'NAT-session-login',
        'NAT-session-restore',
        'NAT-session-account',
        'NAT-session-signout',
        'NAT-session-signed-out-relaunch',
        'NAT-session-unrelated-state',
      ],
    },
    evidenceFiles,
  };
}

function buildAdapter(
  selection: {
    scenarioHash: string;
    requirementHash: string;
  },
  evidenceFiles: readonly { name: string; bytes: number; sha256: string }[],
) {
  return {
    schemaVersion: 1,
    kind: 'private-android-detox-session-public-adapter-not-public-receipt',
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    captureRunId: runId,
    platform: 'android',
    engine: 'detox',
    scenario: 'SCN-session-android',
    mode: 'integration',
    scenarioHash: selection.scenarioHash,
    requirementHash: selection.requirementHash,
    baselineResult: 'passed',
    baselineError: null,
    terminal: 'private-verified',
    terminalReceiptBound: true,
    verificationResult: 'passed',
    localClear: 'observed',
    localClearAfterSignout: 'absent',
    localClearAfterSignedOutRelaunch: 'absent',
    ownedProducerKind: 'owned-android-detox-session-producer',
    independentCleanup: 'passed',
    serverRevocation: 'decision-needed',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    publicPassingCases: 0,
    assertionBindings: [],
    evidenceFiles,
    fixtureHash: hash,
    flagsHash: hash,
    toolVersions: { node: process.version, detox: '1.0.0' },
  };
}

function buildCanonicalTerminalReceipt(
  selection: AndroidSelection,
  assertions: readonly AndroidSessionAssertion[],
  proofName: string,
  receiptRunId = runId,
) {
  const startedAt = new Date().toISOString();
  const target = {
    deviceId: 'android-v7-source-control',
    osVersion: '35',
    appId: 'com.edufelip.mychampions.dev',
    buildProfile: 'android.emu.debug',
    binaryHash: hash,
    apiOrigin: 'http://127.0.0.1:43127',
  };
  const inputs = {
    scenarioHash: selection.scenarioHash,
    requirementHash: selection.requirementHash,
    fixtureHash: hash,
    flagsHash: hash,
    toolVersions: { node: process.version, detox: '1.0.0' },
  };
  return {
    schemaVersion: 1,
    runId: receiptRunId,
    attemptId: `${receiptRunId}:first`,
    scenarioId: 'SCN-session-android',
    phase: 'P4',
    layer: 'native',
    engine: 'detox',
    dataMode: 'postgres',
    platform: 'android',
    locale: null,
    repositories: [
      {
        name: 'mychampions',
        sha: 'a'.repeat(40),
        dirty: false,
        workingTreeHash: null,
      },
    ],
    target,
    inputs,
    command: {
      executable: 'node',
      argv: ['scripts/testing/run-native-pilot.ts'],
    },
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 1).toISOString(),
    result: 'passed',
    exitCode: 0,
    childExitCode: 0,
    assertions,
    timingsMs: {
      build: 1,
      install: 1,
      reset: 1,
      scenario: 1,
      verify: 1,
      cleanup: 1,
    },
    cleanup: {
      status: 'cleaned',
      ownedResourceIds: [target.deviceId],
      recoveryRecordPath: null,
    },
    artifacts: [proofName],
    blocker: null,
  };
}

async function copyPrivateRepositoryInputs(
  sourceRoot: string,
  destinationRoot: string,
  inventory: Record<string, unknown>,
): Promise<void> {
  const paths = new Set<string>([
    'docs/qa/native-pilot/inventory.json',
    '.detoxrc.js',
    'app.config.ts',
    'scripts/run-detox-integrated-session-baseline.ts',
    'e2e/jest.detox-integrated-session-baseline.config.js',
    'e2e/detox-integrated-session-baseline.e2e.test.js',
    'node_modules/detox/package.json',
  ]);
  for (const key of ['sources', 'views', 'transitions', 'scenarios']) {
    const rows = inventory[key];
    if (!Array.isArray(rows)) throw new Error(`Inventory ${key} is malformed`);
    for (const row of rows) {
      assert(row && typeof row === 'object' && !Array.isArray(row));
      const value = row as Record<string, unknown>;
      for (const field of ['paths', 'ownerPaths']) {
        const entries = value[field];
        if (Array.isArray(entries))
          for (const relative of entries) {
            assert(typeof relative === 'string');
            paths.add(relative);
          }
      }
      const freshness = value.freshnessInputs;
      if (freshness && typeof freshness === 'object' && !Array.isArray(freshness)) {
        const requirements = (freshness as Record<string, unknown>).requirementPaths;
        if (Array.isArray(requirements))
          for (const relative of requirements) {
            assert(typeof relative === 'string');
            paths.add(relative);
          }
      }
      if (typeof value.maestroFlow === 'string') paths.add(value.maestroFlow);
    }
  }
  for (const relative of paths) {
    const source = path.join(sourceRoot, relative);
    const destination = path.join(destinationRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination);
  }
}

async function buildSyntheticQualifiedAndroidBuild(
  repositoryRoot: string,
  sourceRoot: string,
  production: AndroidProductionApi,
): Promise<Record<string, unknown>> {
  const metadata = await production.readActualDetoxRuntimeMetadata(repositoryRoot, hash);
  const binaryBytes = Buffer.from('source-only-qualified-android-apk\n');
  const testBinaryBytes = Buffer.from('source-only-qualified-android-test-apk\n');
  const configBytes = Buffer.from('module.exports = {};\n');
  const runtimeConfigBytes = Buffer.from('export default {};\n');
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const binaryPath = path.join(
    repositoryRoot,
    'android/app/build/outputs/apk/dev/debug/app-dev-debug.apk',
  );
  const testBinaryPath = path.join(
    repositoryRoot,
    'android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
  );
  const detoxConfigPath = path.join(repositoryRoot, '.detoxrc.js');
  const runtimeConfigPath = path.join(repositoryRoot, 'app.config.ts');
  await mkdir(path.dirname(binaryPath), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(testBinaryPath), { recursive: true, mode: 0o700 });
  await writeFile(binaryPath, binaryBytes, { mode: 0o600 });
  await writeFile(testBinaryPath, testBinaryBytes, { mode: 0o600 });
  await writeFile(detoxConfigPath, configBytes, { mode: 0o600 });
  await writeFile(runtimeConfigPath, runtimeConfigBytes, { mode: 0o600 });
  return {
    platform: 'android',
    configuration: 'android.emu.debug',
    binaryPath,
    binaryHash: digest(binaryBytes),
    testBinaryPath,
    testBinaryHash: digest(testBinaryBytes),
    source: {
      sha: 'a'.repeat(40),
      dirty: false,
      sourceTreeHash: hash,
    },
    helperInputPaths: [...production.detoxSessionHelperClosure],
    helperInputsHash: hash,
    detoxConfigPath,
    detoxConfigHash: digest(configBytes),
    metroPort: 19001,
    appIdentifier: 'com.edufelip.mychampions.dev',
    embeddedRuntime: {
      variant: 'dev',
      appIdentifier: 'com.edufelip.mychampions.dev',
      apiOrigin: 'http://127.0.0.1:43127',
      configSourcePath: runtimeConfigPath,
      configSourceHash: digest(runtimeConfigBytes),
    },
    ...metadata,
  };
}

async function writeProductionQualifiedEvidence(
  artifactRoot: string,
  runIdValue: string,
  build: Record<string, unknown>,
  runnerPaths: Record<string, string>,
  selection: AndroidSelection,
): Promise<{ report: Record<string, unknown>; reportPath: string }> {
  const evidence = await makeSourceEvidence(artifactRoot);
  const runtimeMetadata = build;
  const report = {
    schemaVersion: 5,
    kind: 'private-detox-integrated-session-baseline-not-public-receipt',
    result: 'passed',
    publicNativePassingCases: 0,
    platform: 'android',
    configuration: 'android.emu.debug',
    role: 'professional',
    captureRunId: runIdValue,
    backendRunId: `${runIdValue}:backend`,
    backendAttemptId: `${runIdValue}:backend:first`,
    appOrigin: 'http://127.0.0.1:43126',
    apiOrigin: 'http://127.0.0.1:43127',
    apiPid: 43127,
    target: { platform: 'android', deviceId: 'android-v7-production-seam' },
    fixture: {
      runId: `${runIdValue}:fixture`,
      scope: 'native-entry-android',
      fixtureHash: hash,
      actorRole: 'professional',
      actorAuthUid: 'auth-v7',
      fixtureAuthUids: ['auth-v7'],
    },
    transport: {
      requestId: 1,
      targetOrigin: 'http://127.0.0.1:43127',
      status: 201,
      outcome: 'forwarded',
      requestProfile: 'native',
      requestOrigin: null,
      authUid: 'auth-v7',
      apiPid: 43127,
    },
    finalTransport: {
      requestId: 2,
      targetOrigin: 'http://127.0.0.1:43127',
      status: 200,
      outcome: 'forwarded',
      requestProfile: 'native',
      requestOrigin: null,
      authUid: 'auth-v7',
      apiPid: 43127,
    },
    sessionCache: {
      afterLogin: { status: 'session-present' },
      afterRestoration: { status: 'session-present' },
      afterCancel: { status: 'session-present' },
      afterSignout: { status: 'session-absent' },
      afterSignedOutRelaunch: { status: 'session-absent' },
    },
    snapshots: {
      checkpointIds: ['beforeLogin', 'afterLogin', 'afterRestoration', 'afterSignedOutRelaunch'],
    },
    build,
    runnerPaths,
    timingsMs: {
      build: 1,
      install: 1,
      reset: 1,
      scenario: 1,
      verify: 1,
      cleanup: 1,
    },
    toolVersions: runtimeMetadata.toolVersions,
    childExecution: null,
    cancellation: null,
    phaseCheckpoints: [],
    authMetadata: null,
    evidenceFiles: evidence.map(({ name, bytes, sha256 }) => ({
      name,
      bytes,
      sha256,
    })),
    ui: {
      launchCount: 3,
      synchronizationDisabled: true,
      signInMarker: 'auth.signIn.title',
      landingMarker: 'coach.home',
      assertionIds: [
        'NAT-session-login',
        'NAT-session-restore',
        'NAT-session-account',
        'NAT-session-signout',
        'NAT-session-signed-out-relaunch',
        'NAT-session-unrelated-state',
      ],
    },
    cleanup: {
      attempted: ['android-v7-production-seam'],
      cleaned: ['android-v7-production-seam'],
      failures: [],
      independent: 'passed',
    },
    failure: null,
  };
  const capture = {
    kind: 'private Detox owned-session capture ledger; not a public receipt',
    fileName: 'capture-final.private.json',
    phase: 'final',
    finalized: true,
    result: 'passed',
    cleanup: 'cleaned',
    independentCleanup: 'passed',
    cleanupFinalLedger: 'cleanup-final.private.json',
    command: {
      execution: 'completed',
      cleanup: 'cleaned',
      childExitCode: 0,
      childSignal: null,
      censusFailure: null,
      outputFailure: null,
    },
  };
  const cleanup = {
    kind: 'private Detox cleanup ledger after stopped-resource drain',
    finalized: true,
    independent: 'passed',
    failures: [],
  };
  await writePrivateJson(artifactRoot, 'capture-final.private.json', capture);
  await writePrivateJson(artifactRoot, 'cleanup-final.private.json', cleanup);
  report.evidenceFiles = await Promise.all(
    evidenceNames.map(async (name) => {
      const bytes = await readFile(path.join(artifactRoot, name));
      return {
        name,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  );
  const reportPath = path.join(artifactRoot, 'detox-integrated-session-baseline.private.json');
  await writePrivateJson(artifactRoot, path.basename(reportPath), report);
  assert.equal(selection.scenarioHash.length, 64);
  return { report, reportPath };
}

void test('V7 qualified Android session facts reach an independently reread outer terminal', async () => {
  const { finalization, contract } = await loadModules();
  const selection = await selectAndroidSession(contract);
  const parent = await mkdtemp('/private/tmp/android-detox-session-terminal-v7-');
  const captureRoot = path.join(parent, 'capture');
  const outerRoot = path.join(parent, 'outer');
  await mkdir(captureRoot, { mode: 0o700 });
  await chmod(captureRoot, 0o700);
  await chmod(parent, 0o700);
  try {
    const evidenceFiles = await makeSourceEvidence(captureRoot);
    const report = buildQualifiedReport(evidenceFiles);
    const adapter = buildAdapter(selection, evidenceFiles);
    await writePrivateJson(captureRoot, 'detox-integrated-session-baseline.private.json', report);
    await writePrivateJson(
      captureRoot,
      'detox-android-session-public-adapter.private.json',
      adapter,
    );
    const lifecycle = {
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 60_000,
    };
    const staged = await finalization.stageAndroidDetoxSessionPublicEvidence({
      captureRoot,
      outputRoot: outerRoot,
      requestedRunId: runId,
      requestedAttemptId: `${runId}:first`,
      selection,
      report: report as never,
      adapter: adapter as never,
      lifecycle,
    });
    const verifiedManifest = await finalization.verifyStagedAndroidDetoxSessionEvidence({
      outputRoot: staged.outputRoot,
      outputIdentity: staged.outputIdentity,
      copyManifest: staged.copyManifest,
      requestedRunId: runId,
      requestedAttemptId: `${runId}:first`,
      selection,
      lifecycle,
    });
    const proof = finalization.buildAndroidDetoxSessionVerifiedTerminalProof({
      requestedRunId: runId,
      requestedAttemptId: `${runId}:first`,
      selection,
      report: report as never,
      adapter: adapter as never,
      staged,
      verifiedManifest,
    });
    const proofName = finalization.androidDetoxSessionVerifiedTerminalEvidenceName;
    await mkdir(path.join(parent, 'terminal'), { mode: 0o700 });
    await writeFile(path.join(parent, 'terminal', proofName), proof, {
      mode: 0o600,
    });
    const outerAssertions = finalization.mapAndroidDetoxSessionAssertionsToOuterTerminal({
      assertions: staged.assertions,
      terminalEvidencePath: proofName,
    });
    const terminalRoot = path.join(parent, 'terminal');
    for (const relative of [
      ...new Set(
        outerAssertions
          .flatMap((assertion) => assertion.evidencePaths)
          .filter((relative) => relative !== proofName),
      ),
    ])
      await writeFile(path.join(terminalRoot, relative), proof, {
        mode: 0o600,
      });
    assert.deepEqual(
      outerAssertions.map((row) => row.id),
      [
        'NAT-session-login',
        'NAT-session-restore',
        'NAT-session-account',
        'NAT-session-signout',
        'NAT-session-signed-out-relaunch',
        'NAT-session-unrelated-state',
      ],
    );
    assert(outerAssertions.every((row) => row.outcome === 'passed'));
    assert(
      outerAssertions.every(
        (row) =>
          row.evidencePaths[0] === proofName &&
          new Set(row.evidencePaths).size === row.evidencePaths.length,
      ),
    );
    const proofValue = JSON.parse(
      await readFile(path.join(parent, 'terminal', proofName), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(proofValue.ownedProducerKind, 'owned-android-detox-session-producer');
    assert.equal(proofValue.independentCleanup, 'passed');
    assert.deepEqual(proofValue.storageCheckpoints, [
      'beforeLogin',
      'afterLogin',
      'afterRestoration',
      'afterSignedOutRelaunch',
    ]);
    assert.deepEqual(proofValue.localSessionCache, {
      afterSignout: 'session-absent',
      afterSignedOutRelaunch: 'session-absent',
    });
    const protectedUi = proofValue.protectedUi as Record<string, unknown>;
    assert.equal(protectedUi.launchCount, 3);
    assert((await lstat(path.join(parent, 'terminal', proofName))).isFile());
    const canonicalReceipt = buildCanonicalTerminalReceipt(selection, outerAssertions, proofName);
    contract.assertNativePilotCompletion(
      canonicalReceipt,
      selection,
      {
        runId,
        attemptId: `${runId}:first`,
        target: canonicalReceipt.target,
        inputs: canonicalReceipt.inputs,
      },
      [`${runId}:first`],
      terminalRoot,
    );
    assert(performance.now() < lifecycle.deadlineAtMonotonicMs);
    process.stdout.write(
      JSON.stringify({
        nativeExecution: false,
        ownerKind: proofValue.ownedProducerKind,
        independentCleanup: proofValue.independentCleanup,
        assertionCount: outerAssertions.length,
        storageCheckpointCount: (proofValue.storageCheckpoints as unknown[]).length,
        signedOutRelaunch: proofValue.localSessionCache,
        protectedUi: proofValue.protectedUi,
        outerTerminalProof: true,
        canonicalOuterCompletion: true,
      }) + '\n',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V7 production route registers the default owner before complete private terminal staging', async () => {
  const { finalization, contract, production } = await loadModules();
  const selection = await selectAndroidSession(contract);
  const sourceRoot = repositoryRoot;
  const parent = await mkdtemp('/private/tmp/android-detox-session-production-v7-');
  const privateRepository = path.join(parent, 'repository');
  const runStarted = performance.now();
  const productionRunId = 'fedcba987654321001234567';
  const artifactRoot = path.join(privateRepository, '.qa/artifacts/native-pilot', productionRunId);
  let defaultOwnerRegistered = false;
  await mkdir(privateRepository, { mode: 0o700 });
  await chmod(privateRepository, 0o700);
  try {
    const inventory = JSON.parse(
      await readFile(path.join(sourceRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ) as Record<string, unknown>;
    await copyPrivateRepositoryInputs(sourceRoot, privateRepository, inventory);
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await chmod(artifactRoot, 0o700);
    const build = await buildSyntheticQualifiedAndroidBuild(
      privateRepository,
      sourceRoot,
      production,
    );
    const runAdapter = async (options: Record<string, unknown>) =>
      production.runAndroidDetoxSessionPublicAdapter({
        ...options,
        runBaseline: async (baselineOptions: Record<string, unknown>) => {
          const producer = baselineOptions.androidProducer as Record<string, unknown>;
          assert.equal(producer.kind, 'owned-android-detox-session-producer');
          assert.equal(typeof producer.acquireOwnedTarget, 'function');
          assert.equal(typeof producer.verifyOwnedAndroidCleanup, 'function');
          defaultOwnerRegistered = true;
          return writeProductionQualifiedEvidence(
            baselineOptions.artifactRoot as string,
            productionRunId,
            baselineOptions.build as Record<string, unknown>,
            baselineOptions.runnerPaths as Record<string, string>,
            selection,
          );
        },
      });
    const attempt = await production.runAndroidDetoxSessionAttemptForNativePilot(
      {
        repositoryRoot: privateRepository,
        serverRoot: privateRepository,
        artifactRoot,
        requestedRunId: productionRunId,
        requestedAttemptId: `${productionRunId}:first`,
        selection,
        signal: new AbortController().signal,
        deadlineMs: 60_000,
        deadlineAtMonotonicMs: runStarted + 60_000,
        buildRunId: productionRunId,
        parentEnv: {},
      },
      {
        loadBuild: () => build,
        runAdapter,
      },
    );
    assert.equal(defaultOwnerRegistered, true);
    assert.equal(attempt.verificationResult, 'passed');
    assert.equal(attempt.externalCleanupResult, 'passed');
    const report = JSON.parse(
      await readFile(
        path.join(attempt.artifactRoot as string, 'detox-integrated-session-baseline.private.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const adapter = JSON.parse(await readFile(attempt.adapterReceiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const terminalRoot = path.join(parent, 'terminal');
    const lifecycle = {
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: runStarted + 60_000,
    };
    const staged = await finalization.stageAndroidDetoxSessionPublicEvidence({
      captureRoot: attempt.artifactRoot,
      outputRoot: terminalRoot,
      requestedRunId: productionRunId,
      requestedAttemptId: `${productionRunId}:first`,
      selection: selection as never,
      report: report as never,
      adapter: adapter as never,
      lifecycle,
    });
    const verifiedManifest = await finalization.verifyStagedAndroidDetoxSessionEvidence({
      outputRoot: staged.outputRoot,
      outputIdentity: staged.outputIdentity,
      copyManifest: staged.copyManifest,
      requestedRunId: productionRunId,
      requestedAttemptId: `${productionRunId}:first`,
      selection: selection as never,
      lifecycle,
    });
    const proof = finalization.buildAndroidDetoxSessionVerifiedTerminalProof({
      requestedRunId: productionRunId,
      requestedAttemptId: `${productionRunId}:first`,
      selection: selection as never,
      report: report as never,
      adapter: adapter as never,
      staged,
      verifiedManifest,
    });
    const proofName = finalization.androidDetoxSessionVerifiedTerminalEvidenceName;
    await writeFile(path.join(terminalRoot, proofName), proof, { mode: 0o600 });
    const assertions = finalization.mapAndroidDetoxSessionAssertionsToOuterTerminal({
      assertions: staged.assertions,
      terminalEvidencePath: proofName,
    });
    for (const relative of [
      ...new Set(
        assertions
          .flatMap((assertion) => assertion.evidencePaths)
          .filter((relative) => relative !== proofName),
      ),
    ])
      await writeFile(path.join(terminalRoot, relative), proof, {
        mode: 0o600,
      });
    const receipt = buildCanonicalTerminalReceipt(
      selection,
      assertions,
      proofName,
      productionRunId,
    );
    contract.assertNativePilotCompletion(
      receipt,
      selection,
      {
        runId: productionRunId,
        attemptId: `${productionRunId}:first`,
        target: receipt.target,
        inputs: receipt.inputs,
      },
      [`${productionRunId}:first`],
      terminalRoot,
    );
    assert.equal(report.ui && (report.ui as Record<string, unknown>).launchCount, 3);
    assert.deepEqual((report.snapshots as Record<string, unknown>).checkpointIds, [
      'beforeLogin',
      'afterLogin',
      'afterRestoration',
      'afterSignedOutRelaunch',
    ]);
    assert.equal(
      (
        (report.sessionCache as Record<string, unknown>).afterSignedOutRelaunch as Record<
          string,
          unknown
        >
      ).status,
      'session-absent',
    );
    assert(performance.now() < lifecycle.deadlineAtMonotonicMs);
    process.stdout.write(
      JSON.stringify({
        nativeExecution: false,
        defaultOwnerRegistered,
        routeVerification: attempt.verificationResult,
        independentCleanup: attempt.externalCleanupResult,
        assertionCount: assertions.length,
        storageCheckpointCount: 4,
        signedOutRelaunch: 'session-absent',
        protectedUiLaunchCount: 3,
        canonicalOuterCompletion: true,
      }) + '\n',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V10 default owner reaches the real baseline boundary and preserves blocked ledger provenance', async () => {
  const { contract, production } = await loadModules();
  const selection = await selectAndroidSession(contract);
  const parent = await mkdtemp('/private/tmp/android-detox-session-default-boundary-v10-');
  const privateRepository = path.join(parent, 'repository');
  const runStarted = performance.now();
  const runIdValue = 'fedcba987654321001234568';
  const artifactRoot = path.join(privateRepository, '.qa/artifacts/native-pilot', runIdValue);
  await mkdir(privateRepository, { mode: 0o700 });
  await chmod(privateRepository, 0o700);
  try {
    const inventory = JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ) as Record<string, unknown>;
    await copyPrivateRepositoryInputs(repositoryRoot, privateRepository, inventory);
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await chmod(artifactRoot, 0o700);
    const build = await buildSyntheticQualifiedAndroidBuild(
      privateRepository,
      repositoryRoot,
      production,
    );
    const sourceStateRoot = path.join(parent, 'state');
    await mkdir(sourceStateRoot, { mode: 0o700 });
    await writeFile(path.join(sourceStateRoot, 'mychampions-native-host.lock'), '', {
      mode: 0o600,
    });
    // No runAdapter, baselineFactories, source-only override, or synthetic
    // report is injected here: this reaches the production adapter's default
    // runDetoxIntegratedSessionBaseline boundary. The intentionally invalid
    // source-only APK makes the owned preflight block before acquisition, so
    // the control proves blocked provenance rather than native qualification.
    const attempt = await production.runAndroidDetoxSessionAttemptForNativePilot(
      {
        repositoryRoot: privateRepository,
        serverRoot: privateRepository,
        artifactRoot,
        requestedRunId: runIdValue,
        requestedAttemptId: `${runIdValue}:first`,
        selection,
        signal: new AbortController().signal,
        deadlineMs: 60_000,
        deadlineAtMonotonicMs: runStarted + 60_000,
        buildRunId: runIdValue,
        parentEnv: {
          MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
          MYCHAMPIONS_NATIVE_STATE_ROOT: sourceStateRoot,
        },
      },
      { loadBuild: () => build },
    );
    assert.equal(attempt.nativeExecution, false);
    assert.equal(attempt.verificationResult, 'blocked');
    assert.equal(attempt.recoveryLedgerReadFailures.length, 1);
    assert.equal(attempt.recoveryLedgerReadFailures[0]?.ledger, 'capture-final');
    assert(attempt.recoveryLedgerReadFailures[0]?.name);
    assert.match(attempt.recoveryLedgerReadFailures[0]?.message ?? '', /capture-final|ENOENT/u);
    assert.equal(attempt.captureCleanup, null);
    const report = JSON.parse(
      await readFile(
        path.join(artifactRoot, 'detox-integrated-session-baseline.private.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const adapter = JSON.parse(await readFile(attempt.adapterReceiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.equal(report.result, 'harness-blocked');
    assert.equal(adapter.terminal, 'blocked');
    process.stdout.write(
      JSON.stringify({
        defaultOwnerInvoked: true,
        defaultBaselineBoundary: 'reached',
        preflightBlockedBeforeNativeAcquisition: true,
        typedLedgerReadFailure: attempt.recoveryLedgerReadFailures[0],
        nativeExecution: false,
        publicPromotion: 'blocked',
      }) + '\n',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V10 cleanup-ledger read failure remains typed and blocks terminal projection', async () => {
  const { contract, production } = await loadModules();
  const selection = await selectAndroidSession(contract);
  const parent = await mkdtemp('/private/tmp/android-detox-session-cleanup-ledger-v10-');
  const privateRepository = path.join(parent, 'repository');
  const runStarted = performance.now();
  const runIdValue = 'fedcba987654321001234569';
  const artifactRoot = path.join(privateRepository, '.qa/artifacts/native-pilot', runIdValue);
  await mkdir(privateRepository, { mode: 0o700 });
  await chmod(privateRepository, 0o700);
  try {
    const inventory = JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ) as Record<string, unknown>;
    await copyPrivateRepositoryInputs(repositoryRoot, privateRepository, inventory);
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await chmod(artifactRoot, 0o700);
    const build = await buildSyntheticQualifiedAndroidBuild(
      privateRepository,
      repositoryRoot,
      production,
    );
    const runAdapter = async (options: Record<string, unknown>) => {
      const adapter = await production.runAndroidDetoxSessionPublicAdapter({
        ...options,
        runBaseline: async (baselineOptions: Record<string, unknown>) =>
          writeProductionQualifiedEvidence(
            baselineOptions.artifactRoot as string,
            runIdValue,
            baselineOptions.build as Record<string, unknown>,
            baselineOptions.runnerPaths as Record<string, string>,
            selection,
          ),
      });
      await rm(path.join(options.artifactRoot as string, 'cleanup-final.private.json'));
      return adapter;
    };
    const attempt = await production.runAndroidDetoxSessionAttemptForNativePilot(
      {
        repositoryRoot: privateRepository,
        serverRoot: privateRepository,
        artifactRoot,
        requestedRunId: runIdValue,
        requestedAttemptId: `${runIdValue}:first`,
        selection,
        signal: new AbortController().signal,
        deadlineMs: 60_000,
        deadlineAtMonotonicMs: runStarted + 60_000,
        buildRunId: runIdValue,
        parentEnv: {},
      },
      { loadBuild: () => build, runAdapter },
    );
    assert.equal(attempt.recoveryLedgerReadFailures.length, 1);
    assert.equal(attempt.recoveryLedgerReadFailures[0]?.ledger, 'cleanup-final');
    assert(attempt.recoveryLedgerReadFailures[0]?.name);
    assert.match(attempt.recoveryLedgerReadFailures[0]?.message ?? '', /cleanup-final|ENOENT/u);
    assert.equal(attempt.verificationResult, 'blocked');
    assert.equal(attempt.nativeExecution, false);
    process.stdout.write(
      JSON.stringify({
        cleanupLedgerReadFailure: attempt.recoveryLedgerReadFailures[0],
        captureRetained: attempt.captureCleanup === 'cleaned',
        terminalBlocked: attempt.verificationResult === 'blocked',
        nativeExecution: false,
      }) + '\n',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

/**
 * Source-only controls for the default baseline.  These factories exercise
 * every owned baseline phase and publish the same bounded artifacts as the
 * native command, but the route marks them source-only so they can never
 * become a native outer receipt.
 */
async function createSourceOnlyAndroidControls(input: {
  parent: string;
  artifactRoot: string;
  runId: string;
}) {
  const { parent, artifactRoot, runId: runIdValue } = input;
  const apiOrigin = 'http://127.0.0.1:43127';
  const appOrigin = 'http://127.0.0.1:43126';
  const apiPid = 43127;
  const sourceStateRoot = path.join(parent, 'source-state');
  const runtimeParent = path.join(parent, 'android-runtime');
  const sdkRoot = path.join(parent, 'android-sdk');
  await mkdir(sourceStateRoot, { mode: 0o700 });
  await mkdir(runtimeParent, { mode: 0o700 });
  await mkdir(sdkRoot, { mode: 0o700 });
  await writeFile(path.join(sourceStateRoot, 'mychampions-native-host.lock'), '', {
    mode: 0o600,
  });

  const account = (name: string, role: 'student' | 'professional') => ({
    email: `${name}@example.test`,
    password: `${name}-secret`,
    authUid: `uid-${name}`,
    role,
  });
  const fixtures = {
    runId: runIdValue,
    scope: 'native-entry-android',
    accounts: {
      new: { ...account('new', 'student'), role: null },
      student: account('student', 'student'),
      coach: account('coach', 'professional'),
      'unrelated-student': account('other-student', 'student'),
      'unrelated-coach': account('other-coach', 'professional'),
      'pending-student': account('pending', 'student'),
      'active-student': account('active', 'student'),
    },
    pendingConnectionId: 'pending-connection',
    activeConnectionId: 'active-connection',
    savedPlanId: 'saved-plan',
    draft: { name: 'draft', sessions: [] },
  };
  const fixtureAccounts = Object.values(fixtures.accounts).sort((left, right) =>
    left.authUid.localeCompare(right.authUid),
  );
  const fixtureAuthUids = fixtureAccounts.map((account) => account.authUid);
  const fixtureAuthUidAllowlistHash = createHash('sha256')
    .update(JSON.stringify(fixtureAuthUids))
    .digest('hex');
  const manifestSha256 = createHash('sha256')
    .update(JSON.stringify({ runId: runIdValue, artifactRoot }))
    .digest('hex');
  const backendAttemptId = `${runIdValue}:first`;
  const started = '2026-10-04T00:00:00.000Z';
  const now = '2026-10-04T00:00:01.000Z';

  const connectionSnapshot = () => {
    const rows = {
      userProfiles: fixtureAccounts.map((account) => ({
        authUid: account.authUid,
        lockedRole: account.role,
        acceptedTermsVersion: 'v1',
        createdAt: started,
        updatedAt: now,
      })),
      professionalSpecialties: [],
      inviteCodes: [],
      connections: [],
      connectionInviteGuards: [],
      pendingStudents: [],
      pendingStudentSlots: [],
      trackingAccess: [],
      activeSpecialties: [],
    };
    return {
      schemaVersion: 1 as const,
      kind: 'connection-snapshot-v1' as const,
      runId: runIdValue,
      scope: 'native-entry-android',
      readOnly: true as const,
      fixtureAuthUids,
      target: {
        professionalAuthUid: 'uid-coach',
        studentAuthUid: 'uid-student',
        specialty: 'fitness_coach' as const,
      },
      rowCounts: Object.fromEntries(
        Object.entries(rows).map(([name, values]) => [name, values.length]),
      ),
      rows,
    };
  };
  const domainSnapshot = () => ({
    schemaVersion: 1 as const,
    runId: runIdValue,
    scope: 'native-entry-android',
    readOnly: true as const,
    trainingPlans: [
      {
        id: 'plan-1',
        studentAuthUid: 'uid-student',
        ownerProfessionalUid: 'uid-coach',
        sourceKind: 'assigned' as const,
        name: 'Source-only plan',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: 'connection-1',
        createdAt: started,
        updatedAt: now,
        sessions: [],
      },
    ],
    connections: [
      {
        id: 'connection-1',
        professionalAuthUid: 'uid-coach',
        studentAuthUid: 'uid-student',
        status: 'active' as const,
        specialty: 'fitness_coach' as const,
        canceledReason: null,
        sourceInviteCodeId: null,
        sourceInviteCodeValue: null,
        createdAt: started,
        updatedAt: now,
        endedAt: null,
      },
    ],
  });

  const fileReceipt = (
    phase: string,
    kind: 'database' | 'query' | 'xml' | 'listing',
    suffix: string,
    digest: string,
  ) => ({
    path: `android-${phase}-${suffix}`,
    kind,
    sizeBytes: 32,
    sha256: digest,
    ownerUid: process.getuid?.() ?? 501,
    mode: 0o600,
    verification: 'owned-stable-reader-v6' as const,
  });
  const storageCheckpoint = (phase: string, present: boolean, actorAuthUid?: string) => {
    const profileAuthUidHash =
      present && actorAuthUid ? createHash('sha256').update(actorAuthUid).digest('hex') : null;
    const databaseHash = createHash('sha256')
      .update(`${runIdValue}:${phase}:database`)
      .digest('hex');
    const queryHash = createHash('sha256').update(`${runIdValue}:${phase}:query`).digest('hex');
    const xmlHash = createHash('sha256').update(`${runIdValue}:${phase}:xml`).digest('hex');
    const listingHash = createHash('sha256').update(`${runIdValue}:${phase}:listing`).digest('hex');
    const database = fileReceipt(phase, 'database', 'async-storage.db', databaseHash);
    const query = fileReceipt(phase, 'query', 'async-storage-query.json', queryHash);
    const secureStore = present ? fileReceipt(phase, 'xml', 'secure-store.xml', xmlHash) : null;
    return {
      status: present ? ('session-present' as const) : ('session-absent' as const),
      reason: 'none' as const,
      asyncStorage: {
        database: 'present' as const,
        recordPresent: present,
        profilePresent: present,
        expiryPresent: present,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
        recordBytes: present ? 192 : null,
        profileAuthUidHash,
      },
      secureStore: {
        preferences: present ? ('present' as const) : ('absent' as const),
        sessionEntryPresent: present,
        keyFormat: present ? ('current' as const) : ('none' as const),
      },
      source: {
        asyncStorage: 'android-async-storage-rkstorage-sqlite' as const,
        secureStore: 'expo-secure-store-shared-preferences-presence-only' as const,
        sessionKeyHash: 'a'.repeat(64),
      },
      coherence: {
        basePresent: true,
        sidecars: [] as const,
        orphanSidecars: [] as const,
        rollbackJournals: [] as const,
      },
      privateArtifacts: {
        database,
        databaseSidecars: [],
        query,
        querySource: {
          path: `android-${phase}-async-storage-query.raw.private`,
          kind: 'query' as const,
          sizeBytes: 32,
          sha256: createHash('sha256').update(`${runIdValue}:${phase}:query-source`).digest('hex'),
          ownerUid: process.getuid?.() ?? 501,
          mode: 0o600,
          retained: false as const,
          databaseSha256: databaseHash,
          databaseSidecarSha256: [],
          verification: 'owned-query-source-v6' as const,
        },
        secureStore,
        databaseListing: fileReceipt(phase, 'listing', 'async-directory.stdout', listingHash),
        secureStoreListing: fileReceipt(
          phase,
          'listing',
          'secure-presence.stdout',
          createHash('sha256').update(`${runIdValue}:${phase}:secure-listing`).digest('hex'),
        ),
      },
    };
  };

  let snapshotCounter = 0;
  let loginStorageObserved = false;
  const session = {
    manifest: {
      runId: runIdValue,
      artifactRoot,
      repoRoot: path.dirname(parent),
      runtimeRoot: path.join(parent, 'runtime'),
      ownerTokenHash: 'b'.repeat(64),
      orchestratorPid: process.pid,
      composeProject: `mc_test_${runIdValue}`,
      port: 43127,
      targets: {},
      fixtureScopes: ['native-entry-android'],
      processes: [],
      repositories: {},
    },
    apiOrigin,
    apiPid,
    fixtures: async () => await Promise.resolve(fixtures),
    connectionSnapshot: async () => {
      const value = connectionSnapshot();
      const file = path.join(
        artifactRoot,
        `connection-snapshot-native-entry-android-${++snapshotCounter}.private.json`,
      );
      await writeFile(file, `${JSON.stringify(value)}\n${' '.repeat(snapshotCounter)}`, {
        flag: 'wx',
        mode: 0o600,
      });
      return value;
    },
    snapshot: async () => {
      const value = domainSnapshot();
      const file = path.join(
        artifactRoot,
        `snapshot-native-entry-android-${++snapshotCounter}.private.json`,
      );
      await writeFile(file, `${JSON.stringify(value)}\n${' '.repeat(snapshotCounter)}`, {
        flag: 'wx',
        mode: 0o600,
      });
      return value;
    },
    probeApiLifetime: async () =>
      await Promise.resolve({
        runId: runIdValue,
        apiOrigin,
        apiPid,
        apiStarted: started,
        apiScript: 'server/src/index.ts',
        backendAttemptId,
        manifestSha256,
      }),
    stop: async () => {
      await Promise.resolve();
    },
  };
  const signInPathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');
  const hydratePathHash = createHash('sha256').update('/me/hydrate').digest('hex');
  const observations: Record<string, unknown>[] = [
    {
      requestId: 1,
      method: 'POST',
      pathHash: signInPathHash,
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin: apiOrigin,
      status: 201,
      outcome: 'forwarded',
      requestCredentialPresent: false,
      faultAttemptId: null,
      elapsedMs: 10,
    },
  ];
  const identities = [
    {
      requestId: 1,
      ordinal: 1,
      targetOrigin: apiOrigin,
      apiPid,
      status: 201,
      authUid: 'uid-coach',
      verification: 'verified',
      verificationReason: 'verified',
      fixtureAuthUidAllowlistHash,
    },
  ];
  const proxy = {
    runId: runIdValue,
    origin: apiOrigin,
    observations,
    nativeAuthIdentities: identities,
    get requestIdFence() {
      return Math.max(0, ...observations.map((row) => Number(row.requestId)));
    },
    enableNativeAuthIdentityCapture: () => undefined,
    waitForQuiescence: async () => {
      await Promise.resolve();
    },
    stop: async () => {
      await Promise.resolve();
    },
  };
  const target = {
    platform: 'android' as const,
    deviceId: 'android-source-only-default-owner',
    androidRuntimeParent: runtimeParent,
    androidSdkRoot: sdkRoot,
    ownership: {
      artifactRoot,
      hostLockRequired: true as const,
      cleanupAuthorized: true as const,
    },
    verify: async () => {
      await Promise.resolve();
    },
    stop: async () => {
      await Promise.resolve();
    },
  };
  const writeProgress = async (events: readonly unknown[], cancelCheckpoint?: unknown) => {
    const file = path.join(artifactRoot, 'detox-session-progress.private.json');
    const temporary = `${file}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({
        schemaVersion: 2,
        kind: 'private-detox-session-progress',
        platform: 'android',
        role: 'professional',
        completedSteps: events.map((event) => (event as { stepId: string }).stepId),
        events,
        launchCount: 3,
        synchronizationDisabled: true,
        ...(cancelCheckpoint ? { cancelCheckpoint } : {}),
      })}\n`,
      { mode: 0o600 },
    );
    await rename(temporary, file);
  };
  const cancelHierarchy =
    '<ViewHierarchy><Node resource-id="settings.account.screen" /></ViewHierarchy>';
  const cancelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const events = [
    { stepId: 'NAT-session-login', ordinal: 1, monotonicMs: 1 },
    { stepId: 'NAT-session-restore', ordinal: 2, monotonicMs: 2 },
    { stepId: 'NAT-session-account', ordinal: 3, monotonicMs: 3 },
    {
      stepId: 'NAT-session-signout',
      ordinal: 4,
      monotonicMs: 4,
      confirmationAfterCancel: 'not-visible',
      cancelEvidence: {
        hierarchyFile: 'detox-cancel-after-cancel.private.xml',
        hierarchySha256: createHash('sha256').update(cancelHierarchy).digest('hex'),
        screenshotFile: 'detox-cancel-after-cancel.private.png',
        screenshotSha256: createHash('sha256').update(cancelPng).digest('hex'),
        modalPresent: false,
        accountScreenPresent: true,
      },
    },
    { stepId: 'NAT-session-signed-out-relaunch', ordinal: 5, monotonicMs: 5 },
  ];
  const factories = {
    reserveOwnedAppPort: async () =>
      await Promise.resolve({
        port: 43126,
        origin: appOrigin,
        release: async () => {
          await Promise.resolve();
        },
      }),
    startOwnedSession: async () => await Promise.resolve(session),
    startOwnedApiProxy: async () => await Promise.resolve(proxy),
    startOwnedExpo: async () =>
      await Promise.resolve({
        stop: async () => {
          await Promise.resolve();
        },
        configExtra: {},
      }),
    acquireOwnedTarget: async () => await Promise.resolve(target),
    capturePreviousIosDevices: async () => {
      await Promise.resolve();
    },
    verifyAndroidBuild: async () => {
      await Promise.resolve();
    },
    executeOwnedNativeCommand: async (commandInput: { artifactRoot: string }) => {
      await writeProgress([events[0]]);
      const loginDeadline = performance.now() + 5_000;
      while (!loginStorageObserved) {
        if (performance.now() >= loginDeadline)
          throw new Error('Source-only Android control did not observe login');
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      observations.push({
        requestId: 2,
        method: 'POST',
        pathHash: hydratePathHash,
        requestOrigin: null,
        requestProfile: 'native',
        targetOrigin: apiOrigin,
        status: 200,
        outcome: 'forwarded',
        requestCredentialPresent: true,
        faultAttemptId: null,
        elapsedMs: 10,
      });
      await writeProgress(events.slice(0, 2));
      await new Promise((resolve) => setTimeout(resolve, 40));
      const cancelCheckpoint = {
        monotonicMs: 3.5,
        cancelEvidence: events[3].cancelEvidence,
      };
      await writeFile(
        path.join(commandInput.artifactRoot, 'detox-cancel-after-cancel.private.xml'),
        cancelHierarchy,
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
      await writeFile(
        path.join(commandInput.artifactRoot, 'detox-cancel-after-cancel.private.png'),
        cancelPng,
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
      await writeProgress(events.slice(0, 3), cancelCheckpoint);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await writeProgress(events.slice(0, 4), cancelCheckpoint);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await writeProgress(events, cancelCheckpoint);
      await writeFile(
        path.join(commandInput.artifactRoot, 'detox-session-result.private.json'),
        `${JSON.stringify({
          schemaVersion: 2,
          kind: 'private-detox-session-steps',
          platform: 'android',
          role: 'professional',
          steps: Object.fromEntries(events.slice(0, 5).map((event) => [event.stepId, true])),
          launchCount: 3,
          synchronizationDisabled: true,
          events,
        })}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      return {
        phase: 'step',
        execution: 'completed',
        cleanup: 'cleaned',
        childExitCode: 0,
        childSignal: null,
        pid: 43130,
        pgid: 43130,
        command: 'yarn',
        argv: [],
        cwd: parent,
        deadlineMs: 60_000,
        logPath: null,
        stdoutPath: null,
        ownershipPath: null,
        cleanupMs: 2,
        censusFailure: null,
        outputFailure: null,
        elapsedMs: 20,
      };
    },
    requireNativeHostAvailability: async () =>
      await Promise.resolve({ status: 'no-known-job' as const }),
    verifyIosSimulatorApp: async () =>
      await Promise.resolve({
        binaryPath: 'unused',
        signingProfile: 'source-only',
        localApplicationId: 'unused',
      }),
    verifyOwnedIosCleanup: async () => await Promise.resolve({ result: 'passed' as const }),
    inspectDetoxBuildInstrumentation: async ({ build }: { build: unknown }) =>
      await Promise.resolve(build),
    readAndroidSessionStorageCheckpoint: async (storageInput: {
      checkpoint: string;
      phase?: string;
      actorAuthUid?: string;
    }) => {
      const present =
        storageInput.checkpoint === 'afterLogin' ||
        storageInput.checkpoint === 'afterRestoration' ||
        storageInput.checkpoint === 'afterCancel';
      if (storageInput.checkpoint === 'afterLogin') loginStorageObserved = true;
      return await Promise.resolve(
        storageCheckpoint(
          storageInput.phase ?? storageInput.checkpoint,
          present,
          storageInput.actorAuthUid,
        ),
      );
    },
  };
  const cleanup = {
    kind: 'private-owned-android-detox-connection-cleanup',
    result: 'passed',
    censusStatus: 'available',
    nativePassingCases: 0,
    scope: 'android-detox-target-only',
    runId: runIdValue,
    processSurvivors: [],
    unavailablePorts: [],
    pidStartPairs: 0,
    deletedDirectories: ['a', 'b', 'c', 'd', 'e', 'f'],
  };
  return {
    parentEnv: {
      APP_VARIANT: 'dev',
      MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
      MYCHAMPIONS_NATIVE_STATE_ROOT: sourceStateRoot,
    },
    factories,
    sourceOnlyProducerOverrides: {
      acquireOwnedTarget: async () => await Promise.resolve(target),
      verifyOwnedAndroidCleanup: async () => await Promise.resolve(cleanup),
    },
  };
}

void test('V8 default owner runs the Android lifecycle through staging and independent verification, then blocks source-only outer promotion', async () => {
  const { finalization, contract, production, runner } = await loadModules();
  const selection = await selectAndroidSession(contract);
  const parent = await mkdtemp('/private/tmp/android-detox-session-default-owner-v8-');
  const privateRepository = path.join(parent, 'repository');
  const runStarted = performance.now();
  const sourceOnlyRunId = 'abcdef0123456789abcdef01';
  const artifactRoot = path.join(privateRepository, '.qa/artifacts/native-pilot', sourceOnlyRunId);
  await mkdir(privateRepository, { mode: 0o700 });
  await chmod(privateRepository, 0o700);
  try {
    const inventory = JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ) as Record<string, unknown>;
    await copyPrivateRepositoryInputs(repositoryRoot, privateRepository, inventory);
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await chmod(artifactRoot, 0o700);
    const build = await buildSyntheticQualifiedAndroidBuild(
      privateRepository,
      repositoryRoot,
      production,
    );
    const controls = await createSourceOnlyAndroidControls({
      parent,
      artifactRoot,
      runId: sourceOnlyRunId,
    });
    const attempt = await production.runAndroidDetoxSessionAttemptForNativePilot(
      {
        repositoryRoot: privateRepository,
        serverRoot: privateRepository,
        artifactRoot,
        requestedRunId: sourceOnlyRunId,
        requestedAttemptId: `${sourceOnlyRunId}:first`,
        selection,
        signal: new AbortController().signal,
        deadlineMs: 60_000,
        deadlineAtMonotonicMs: runStarted + 60_000,
        buildRunId: sourceOnlyRunId,
        parentEnv: controls.parentEnv,
        baselineFactories: controls.factories as never,
        sourceOnlyProducerOverrides: controls.sourceOnlyProducerOverrides,
        sourceOnlyControl: true,
      },
      { loadBuild: () => build },
    );
    assert.equal(attempt.verificationResult, 'passed');
    assert.equal(attempt.externalCleanupResult, 'passed');
    assert.equal(attempt.nativeExecution, false);
    const report = JSON.parse(
      await readFile(
        path.join(artifactRoot, 'detox-integrated-session-baseline.private.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const adapter = JSON.parse(
      await readFile(
        path.join(artifactRoot, 'detox-android-session-public-adapter.private.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(adapter.executionProvenance, 'source-only-control');
    assert.deepEqual((report.ui as Record<string, unknown>).assertionIds, [
      'NAT-session-login',
      'NAT-session-restore',
      'NAT-session-account',
      'NAT-session-signout',
      'NAT-session-signed-out-relaunch',
      'NAT-session-unrelated-state',
    ]);
    assert.deepEqual((report.snapshots as Record<string, unknown>).checkpointIds, [
      'beforeLogin',
      'afterLogin',
      'afterRestoration',
      'afterSignedOutRelaunch',
    ]);
    assert.deepEqual(
      ((report.sessionCache as Record<string, unknown>).afterSignout as Record<string, unknown>)
        .status,
      'session-absent',
    );
    assert.deepEqual(
      (
        (report.sessionCache as Record<string, unknown>).afterSignedOutRelaunch as Record<
          string,
          unknown
        >
      ).status,
      'session-absent',
    );
    const terminalRoot = path.join(parent, 'outer');
    const lifecycle = {
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: runStarted + 60_000,
    };
    const staged = await finalization.stageAndroidDetoxSessionPublicEvidence({
      captureRoot: artifactRoot,
      outputRoot: terminalRoot,
      requestedRunId: sourceOnlyRunId,
      requestedAttemptId: `${sourceOnlyRunId}:first`,
      selection: selection as never,
      report: report as never,
      adapter: adapter as never,
      lifecycle,
    });
    const verifiedManifest = await finalization.verifyStagedAndroidDetoxSessionEvidence({
      outputRoot: staged.outputRoot,
      outputIdentity: staged.outputIdentity,
      copyManifest: staged.copyManifest,
      requestedRunId: sourceOnlyRunId,
      requestedAttemptId: `${sourceOnlyRunId}:first`,
      selection: selection as never,
      lifecycle,
    });
    const proof = finalization.buildAndroidDetoxSessionVerifiedTerminalProof({
      requestedRunId: sourceOnlyRunId,
      requestedAttemptId: `${sourceOnlyRunId}:first`,
      selection: selection as never,
      report: report as never,
      adapter: adapter as never,
      staged,
      verifiedManifest,
    });
    const proofRecord = JSON.parse(proof) as {
      nativePassingCases?: unknown;
    };
    assert.equal(proofRecord.nativePassingCases, 0);
    assert.equal(
      runner.shouldBlockAndroidDetoxSessionOuterTerminal({
        nativeExecution: attempt.nativeExecution,
        lifecycleNormalization: (attempt.lifecycleNormalization ?? {}) as { status: string },
        publicReceiptBound: false,
        sharedLifecycleStatus: 'blocked',
      }),
      true,
    );
    process.stdout.write(
      JSON.stringify({
        defaultOwnerInvoked: true,
        defaultBaselineLifecycle: 'completed',
        staging: 'verified',
        independentCleanup: attempt.externalCleanupResult,
        assertionCount: staged.assertions.length,
        storageCheckpointCount: 4,
        localClear: {
          afterSignout: 'session-absent',
          afterSignedOutRelaunch: 'session-absent',
        },
        sourceOnlyNativeExecution: false,
        outerTerminalBlocked: true,
      }) + '\n',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V8 default-owner provenance blocks source-only outer promotion but permits actual execution', async () => {
  const { production, runner } = await loadModules();
  assert.equal(production.hasAndroidDetoxSessionNativeExecution({ childExecution: null }), false);
  assert.equal(
    production.hasAndroidDetoxSessionNativeExecution({
      childExecution: {
        execution: 'completed',
        cleanup: 'cleaned',
        childExitCode: 0,
        childSignal: null,
        censusFailure: null,
        outputFailure: null,
      },
    }),
    true,
  );
  assert.equal(
    runner.shouldBlockAndroidDetoxSessionOuterTerminal({
      nativeExecution: false,
      lifecycleNormalization: { status: 'blocked' },
      publicReceiptBound: false,
      sharedLifecycleStatus: 'blocked',
    }),
    true,
  );
  assert.equal(
    runner.shouldBlockAndroidDetoxSessionOuterTerminal({
      nativeExecution: true,
      lifecycleNormalization: { status: 'private-candidate' },
      publicReceiptBound: true,
      sharedLifecycleStatus: 'sealed-contract-compatible',
    }),
    false,
  );
  process.stdout.write(
    JSON.stringify({
      sourceOnlyNativeExecution: false,
      sourceOnlyOuterBlocked: true,
      actualNativeExecution: true,
      actualOuterBlocked: false,
      nativeExecution: false,
    }) + '\n',
  );
});

void test('V8 attaches the Android staging recovery ledger to the outer receipt', async () => {
  const { runner } = await loadModules();
  const parent = await mkdtemp('/private/tmp/android-detox-session-recovery-v8-');
  await chmod(parent, 0o700);
  const recoveryRecordPath = 'android-detox-session-staging-recovery-source-only.private.json';
  try {
    await writePrivateJson(parent, recoveryRecordPath, {
      kind: 'private-android-detox-session-staging-recovery-not-public-receipt',
      status: 'blocked-recovery-ledger-retained',
      retainedPaths: ['/private/tmp/owned-stage-retained'],
      nativePassingCases: 0,
      publicPassingCases: 0,
      foreignWriteObserved: false,
    });
    const receipt = {
      artifacts: [],
      cleanup: { status: 'cleaned', recoveryRecordPath: null },
    };
    const rejected = await runner.attachAndroidDetoxSessionStagingRecovery(receipt, parent, {
      recoveryStatus: 'failed-recovery-ledger-retained',
      recoveryRecordPath,
    });
    assert.deepEqual(rejected, []);
    assert.equal(receipt.cleanup.status, 'failed-recovery-ledger-retained');
    assert.equal(receipt.cleanup.recoveryRecordPath, recoveryRecordPath);
    assert.deepEqual(receipt.artifacts, [recoveryRecordPath]);
    assert(
      (await lstat(path.join(parent, recoveryRecordPath))).isFile(),
      'recovery ledger was not retained',
    );
    process.stdout.write(
      JSON.stringify({
        recoveryLedgerAttached: true,
        cleanupStatus: receipt.cleanup.status,
        recoveryRecordPath,
        retainedPathsRemainInLedger: true,
        nativeExecution: false,
      }) + '\n',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('V7 rejects foreign producer provenance and failed independent cleanup before staging', async () => {
  const { finalization, contract } = await loadModules();
  const selection = await selectAndroidSession(contract);
  const parent = await mkdtemp('/private/tmp/android-detox-session-negative-v7-');
  const captureRoot = path.join(parent, 'capture');
  await mkdir(captureRoot, { mode: 0o700 });
  try {
    const evidenceFiles = await makeSourceEvidence(captureRoot);
    const report = buildQualifiedReport(evidenceFiles);
    const adapter = buildAdapter(selection, evidenceFiles);
    const lifecycle = {
      signal: new AbortController().signal,
      deadlineAtMonotonicMs: performance.now() + 60_000,
    };
    await assert.rejects(
      finalization.stageAndroidDetoxSessionPublicEvidence({
        captureRoot,
        outputRoot: path.join(parent, 'foreign-producer'),
        requestedRunId: runId,
        requestedAttemptId: `${runId}:first`,
        selection,
        report: report as never,
        adapter: { ...adapter, ownedProducerKind: 'foreign-producer' } as never,
        lifecycle,
      }),
      /owned-android-detox-session-producer/,
    );
    await assert.rejects(
      finalization.stageAndroidDetoxSessionPublicEvidence({
        captureRoot,
        outputRoot: path.join(parent, 'failed-cleanup'),
        requestedRunId: runId,
        requestedAttemptId: `${runId}:first`,
        selection,
        report: report as never,
        adapter: { ...adapter, independentCleanup: 'failed' } as never,
        lifecycle,
      }),
      /passed/,
    );
    assert.equal(await lstat(path.join(parent, 'foreign-producer')).catch(() => null), null);
    assert.equal(await lstat(path.join(parent, 'failed-cleanup')).catch(() => null), null);
    process.stdout.write(
      JSON.stringify({
        nativeExecution: false,
        foreignProducerRejected: true,
        failedCleanupRejected: true,
        noStageRootCreated: true,
      }) + '\n',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

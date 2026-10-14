import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdtempSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  makeProtectedPreflightFailureReceipt,
  PROTECTED_MANUAL_ASSERTIONS,
  PROTECTED_MANUAL_SELECTION,
  readProtectedNativeReceipt,
  restoreProtectedReusableBuild,
  validateProtectedBuildCacheRoot,
  type ProtectedManualPilotContext,
  validateProtectedManualPilotContext,
  validateProtectedNativeReceipt,
} from '../../scripts/ci/protected-native-pilot';

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(candidateRoot, '.github/workflows/protected-manual-ios-maestro.yml');
const temporaryRoots: string[] = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function context(): ProtectedManualPilotContext {
  const nativeStateRoot = mkdtempSync(path.join(os.tmpdir(), 'protected-manual-native-state-'));
  chmodSync(nativeStateRoot, 0o700);
  temporaryRoots.push(nativeStateRoot);
  return {
    environment: {
      eventName: 'workflow_dispatch',
      repository: 'edufelip/MyChampions',
      refProtected: 'true',
      clientSha: '9d0c3f4862e6c8b8004fd3378f9d6897ae46493e',
      serverSha: 'c7b5191352109f9ce2829b2b8fafcc8f554cf8a7',
      buildRunId: 'dd133cabd89a894e451c0f80',
      buildSource: 'private-restoration',
      nativeHostLockHeld: '1',
      nativeStateRoot,
      receiptRoot: '/runner/temp/protected-receipt',
      outputParent: '/workspace/client/.qa/artifacts/native-pilot-attempts',
      requestedRunId: '0123456789abcdef01234567',
      workspaceRoot: '/workspace',
      clientRoot: '/workspace/client',
      serverRoot: '/workspace/server',
      buildCacheRoot: '/runner/state/qualified-build-cache',
    },
    client: {
      name: 'client',
      repository: 'edufelip/MyChampions',
      root: '/workspace/client',
      sha: '9d0c3f4862e6c8b8004fd3378f9d6897ae46493e',
      dirty: false,
      remote: 'https://github.com/edufelip/MyChampions',
    },
    server: {
      name: 'server',
      repository: 'edufelip/mychampions-api',
      root: '/workspace/server',
      sha: 'c7b5191352109f9ce2829b2b8fafcc8f554cf8a7',
      dirty: false,
      remote: 'https://github.com/edufelip/mychampions-api',
    },
    tools: {
      node: 'v24.15.0',
      yarn: '1.22.22',
      maestro: '2.6.1',
      xcodebuild: 'Xcode 26.1\nBuild version 17A999',
      simulatorSdk: '26.0',
      java: 'openjdk version "17.0.15" 2025-04-15',
    },
  };
}

function nativeReceipt(contextValue: ProtectedManualPilotContext): Record<string, unknown> {
  return {
    runId: contextValue.environment.requestedRunId,
    attemptId: `${contextValue.environment.requestedRunId}:first`,
    scenarioId: PROTECTED_MANUAL_SELECTION.scenario,
    layer: 'native',
    engine: 'maestro',
    dataMode: 'postgres',
    platform: 'ios',
    repositories: [
      { name: 'client', sha: contextValue.client.sha, dirty: false },
      { name: 'server', sha: contextValue.server.sha, dirty: false },
    ],
    inputs: {
      toolVersions: { node: 'v24.15.0', maestro: '2.6.1' },
    },
    target: {
      buildProfile: 'Metro-attached Debug; not bundled release qualification',
    },
    result: 'passed',
    exitCode: 0,
    childExitCode: 0,
    childSignal: null,
    assertions: PROTECTED_MANUAL_ASSERTIONS.map((id) => ({
      id,
      outcome: 'passed',
    })),
    cleanup: { status: 'cleaned', recoveryRecordPath: null },
  };
}

void describe('protected manual native pilot source contract', () => {
  void it('accepts only the protected exact client/server/tool/lock contract', () => {
    const value = context();
    assert.doesNotThrow(() => validateProtectedManualPilotContext(value));

    for (const mutation of [
      (candidate: ProtectedManualPilotContext) => (candidate.environment.refProtected = 'false'),
      (candidate: ProtectedManualPilotContext) => (candidate.server.sha = candidate.client.sha),
      (candidate: ProtectedManualPilotContext) =>
        (candidate.server.root = '/workspace/other-server'),
      (candidate: ProtectedManualPilotContext) => (candidate.server.dirty = true),
      (candidate: ProtectedManualPilotContext) => (candidate.tools.maestro = '2.6.0'),
      (candidate: ProtectedManualPilotContext) =>
        (candidate.environment.buildSource = 'historical-id-only'),
    ]) {
      const invalid = context();
      mutation(invalid);
      assert.throws(() => validateProtectedManualPilotContext(invalid));
    }
  });

  void it('requires an existing private build cache outside the checkout workspace', async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'protected-manual-workspace-'));
    chmodSync(workspace, 0o700);
    const cacheParent = mkdtempSync(path.join(os.tmpdir(), 'protected-manual-build-cache-parent-'));
    const cache = path.join(cacheParent, 'cache');
    mkdirSync(cache, { mode: 0o700 });
    chmodSync(cache, 0o700);
    temporaryRoots.push(workspace, cacheParent);
    assert.equal(await validateProtectedBuildCacheRoot(cache, workspace), realpathSync(cache));
    const inside = path.join(workspace, 'cache');
    mkdirSync(inside, { mode: 0o700 });
    chmodSync(inside, 0o700);
    await assert.rejects(() => validateProtectedBuildCacheRoot(inside, workspace));
    const link = path.join(workspace, 'cache-link');
    symlinkSync(cache, link);
    await assert.rejects(() => validateProtectedBuildCacheRoot(link, workspace));
  });

  void it('restores a verified cache run into a clean checkout without overwriting it', async () => {
    const workspace = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-restore-workspace-')),
    );
    const client = path.join(workspace, 'client');
    const cacheParent = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-restore-cache-')),
    );
    const cache = path.join(cacheParent, 'cache');
    const runId = 'fedcba987654321001234567';
    const cacheRun = path.join(cache, '.qa/artifacts/native-pilot', runId);
    mkdirSync(path.join(client, 'scripts/testing'), {
      recursive: true,
      mode: 0o700,
    });
    mkdirSync(cacheRun, { recursive: true, mode: 0o700 });
    for (const directory of [workspace, client, cacheParent, cache, cacheRun])
      chmodSync(directory, 0o700);
    const sourceIdentity = {
      sha: 'a'.repeat(40),
      dirty: true,
      sourceTreeHash: 'b'.repeat(64),
    };
    const binaryRelative = 'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app';
    const binaryPath = path.join(cacheRun, binaryRelative);
    mkdirSync(path.join(binaryPath, 'EXConstants.bundle'), {
      recursive: true,
      mode: 0o700,
    });
    const entryScreenshot = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.from('fixture-png'),
    ]);
    const entryHierarchy = Buffer.from(
      'auth.signIn.emailInput auth.signIn.passwordInput auth.signIn.submitButton',
    );
    writeFileSync(path.join(binaryPath, 'EXConstants.bundle/app.config'), '{"extra":{}}\n', {
      mode: 0o600,
      flag: 'wx',
    });
    writeFileSync(path.join(cacheRun, 'bootstrap.private.log'), 'bootstrap healthy\n', {
      mode: 0o600,
      flag: 'wx',
    });
    writeFileSync(path.join(cacheRun, 'entry.png'), entryScreenshot, {
      mode: 0o600,
      flag: 'wx',
    });
    writeFileSync(path.join(cacheRun, 'entry-hierarchy.json'), entryHierarchy, {
      mode: 0o600,
      flag: 'wx',
    });
    writeFileSync(
      path.join(cacheRun, 'capture.private.json'),
      JSON.stringify({
        result: 'observed',
        cleanup: 'cleaned',
        charter: 'entry',
        source: sourceIdentity,
        sourceAfter: sourceIdentity,
        build: {
          bundleId: 'com.edufelip.mychampions.dev',
          binaryPath,
          binaryHash: 'c'.repeat(64),
          profile: 'Metro-attached Debug; not bundled release qualification',
          apiOrigin: 'http://127.0.0.1:4100',
          metroOrigin: 'http://127.0.0.1:4101',
          environmentHash: 'd'.repeat(64),
        },
      }),
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(
      path.join(cacheRun, 'entry-qualification.private.json'),
      JSON.stringify({
        result: 'qualified-entry-observation',
        sourceTreeHash: 'b'.repeat(64),
        binaryHash: 'c'.repeat(64),
        cleanupVerified: true,
        screenshotReviewed: true,
        entryEvidence: {
          screenshotHash: createHash('sha256').update(entryScreenshot).digest('hex'),
          hierarchyHash: createHash('sha256').update(entryHierarchy).digest('hex'),
          screenshotPath: 'entry.png',
          hierarchyPath: 'entry-hierarchy.json',
        },
      }),
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(
      path.join(client, 'scripts/testing/native-build-identity.ts'),
      "export async function sourceIdentity() { return { sha: 'a'.repeat(40), dirty: true, sourceTreeHash: 'b'.repeat(64) }; }\nexport async function treeHash() { return 'c'.repeat(64); }\n",
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(
      path.join(client, 'scripts/testing/native-build-reuse.ts'),
      "import { lstat } from 'node:fs/promises'; export function resolveReusableIosEntryEvidencePaths(capture, evidence) { if (capture?.result === 'observed' && capture?.charter === 'entry') return { screenshotPath: 'entry.png', hierarchyPath: evidence?.hierarchyPath ?? 'entry-hierarchy.json' }; if (capture?.result === 'harness-blocked' && capture?.charter === 'auth-account' && capture?.viewIds?.includes('SCR-sign-in')) return { screenshotPath: 'entry.png', hierarchyPath: evidence?.hierarchyPath ?? 'entry-hierarchy.private.log' }; throw new Error('unsupported entry evidence capture'); } export async function loadReusableIosBuild(root, id, current, options) { const file = `${root}/.qa/artifacts/native-pilot/${id}/verified.private.json`; const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('unverified cache'); const relative = `ios-build/Build/Products/Debug-iphonesimulator/mychampions.app`; if (options?.sourceRoot && options.sourceRoot === root) throw new Error('relocation source and destination must differ'); return { binaryHash: 'c'.repeat(64), binaryPath: `${root}/.qa/artifacts/native-pilot/${id}/${relative}` }; } export function validateReusableIosBuild(capture) { return capture.build; }\n",
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(
      path.join(client, 'scripts/testing/integration-preflight.ts'),
      'export function assertResolvedIntegratedExpoConfig() {}\n',
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(
      path.join(client, 'scripts/testing/native-runtime-preflight.ts'),
      'export function assertNativeBootstrapHealthy() {}\n',
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(path.join(cacheRun, 'verified.private.json'), 'verified\n', {
      mode: 0o600,
      flag: 'wx',
    });
    temporaryRoots.push(workspace, cacheParent);
    const value = context();
    value.environment.workspaceRoot = workspace;
    value.environment.clientRoot = client;
    value.environment.serverRoot = path.join(workspace, 'server');
    value.environment.buildCacheRoot = cache;
    value.environment.buildRunId = runId;
    value.client.root = client;
    const capturePath = path.join(cacheRun, 'capture.private.json');
    const originalCaptureBytes = readFileSync(capturePath);
    const invalidCapture = JSON.parse(originalCaptureBytes.toString('utf8')) as {
      build: { binaryPath: string };
    };
    invalidCapture.build.binaryPath = path.join(
      client,
      '.qa/artifacts/native-pilot',
      runId,
      binaryRelative,
    );
    writeFileSync(capturePath, JSON.stringify(invalidCapture), { mode: 0o600 });
    await assert.rejects(
      () => restoreProtectedReusableBuild(value),
      /source capture receipt is not bound/u,
    );
    rmSync(path.join(client, '.qa'), { recursive: true, force: true });
    writeFileSync(capturePath, originalCaptureBytes, { mode: 0o600 });
    const relocation = await restoreProtectedReusableBuild(value);
    const originalSourceRunDirectory = relocation.sourceRunDirectory;
    assert.equal(
      Reflect.set(relocation, 'sourceRunDirectory', '/tmp/forged-source'),
      false,
      'validated relocation metadata is immutable after publication qualification',
    );
    assert.equal(relocation.sourceRunDirectory, originalSourceRunDirectory);
    assert.equal(relocation.sourceRunId, runId);
    assert.equal(
      relocation.destinationRunDirectory,
      path.join(client, '.qa/artifacts/native-pilot', runId),
    );
    assert.equal(relocation.sourceCaptureSha256, relocation.destinationCaptureSha256);
    assert.equal(relocation.sourceQualificationSha256, relocation.destinationQualificationSha256);
    assert.equal(relocation.sourceConfigSha256, relocation.destinationConfigSha256);
    assert.equal(relocation.sourceBootstrapSha256, relocation.destinationBootstrapSha256);
    assert.equal(
      relocation.sourceEntryScreenshotSha256,
      relocation.destinationEntryScreenshotSha256,
    );
    assert.equal(relocation.sourceEntryHierarchySha256, relocation.destinationEntryHierarchySha256);
    assert.equal(
      readFileSync(
        path.join(client, '.qa/artifacts/native-pilot', runId, 'verified.private.json'),
        'utf8',
      ),
      'verified\n',
    );
    const sourceReceipt = JSON.parse(readFileSync(capturePath, 'utf8')) as {
      build: { binaryPath: string };
    };
    assert.deepEqual(
      sourceReceipt.build.binaryPath,
      binaryPath,
      'the original source receipt retains its source-root path',
    );
    assert.deepEqual(
      readFileSync(path.join(cacheRun, 'capture.private.json')),
      readFileSync(path.join(client, '.qa/artifacts/native-pilot', runId, 'capture.private.json')),
      'the relocated receipt bytes are copied without rewriting the source binding',
    );
    assert.equal(
      realpathSync(path.join(client, '.qa/artifacts/native-pilot', runId, binaryRelative)),
      path.join(client, '.qa/artifacts/native-pilot', runId, binaryRelative),
    );
    await assert.rejects(() => restoreProtectedReusableBuild(value), /already exists/u);

    rmSync(path.join(client, '.qa'), { recursive: true, force: true });
    const legacyCapture = JSON.parse(readFileSync(capturePath, 'utf8')) as {
      result: string;
      charter: string;
      viewIds?: string[];
    };
    legacyCapture.result = 'harness-blocked';
    legacyCapture.charter = 'auth-account';
    legacyCapture.viewIds = ['SCR-sign-in'];
    writeFileSync(capturePath, JSON.stringify(legacyCapture), { mode: 0o600 });
    const qualificationPath = path.join(cacheRun, 'entry-qualification.private.json');
    const legacyQualification = JSON.parse(readFileSync(qualificationPath, 'utf8')) as {
      entryEvidence: { screenshotPath?: string; hierarchyPath?: string };
    };
    delete legacyQualification.entryEvidence.screenshotPath;
    delete legacyQualification.entryEvidence.hierarchyPath;
    writeFileSync(qualificationPath, JSON.stringify(legacyQualification), { mode: 0o600 });
    rmSync(path.join(cacheRun, 'entry-hierarchy.json'));
    writeFileSync(path.join(cacheRun, 'entry-hierarchy.private.log'), entryHierarchy, {
      mode: 0o600,
      flag: 'wx',
    });
    const legacyRelocation = await restoreProtectedReusableBuild(value);
    assert.equal(
      legacyRelocation.sourceEntryHierarchySha256,
      relocation.sourceEntryHierarchySha256,
      'legacy auth-account evidence uses the resolver-selected private hierarchy path',
    );
  });

  void it('requires all seven native assertions and the clean first-attempt receipt', () => {
    const value = context();
    const receipt = nativeReceipt(value);
    assert.deepEqual(validateProtectedNativeReceipt(receipt, value), [
      ...PROTECTED_MANUAL_ASSERTIONS,
    ]);

    const missing = nativeReceipt(value);
    (missing.assertions as unknown[]).pop();
    assert.throws(() => validateProtectedNativeReceipt(missing, value));

    const foreign = nativeReceipt(value);
    (foreign.repositories as Record<string, unknown>[])[1].sha = value.client.sha;
    assert.throws(() => validateProtectedNativeReceipt(foreign, value));

    const unclean = nativeReceipt(value);
    (unclean.cleanup as Record<string, unknown>).status = 'blocked';
    assert.throws(() => validateProtectedNativeReceipt(unclean, value));
  });

  void it('reads only a private single-link receipt and rejects a symlink', async () => {
    const value = context();
    const receiptRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-native-receipt-')),
    );
    chmodSync(receiptRoot, 0o700);
    temporaryRoots.push(receiptRoot);
    const receiptPath = path.join(receiptRoot, 'receipt.json');
    writeFileSync(receiptPath, JSON.stringify(nativeReceipt(value)), {
      mode: 0o600,
      flag: 'wx',
    });
    const read = await readProtectedNativeReceipt(receiptPath);
    assert.equal(read.value.result, 'passed');
    assert.equal(read.bytes.length > 0, true);
    const linkPath = path.join(receiptRoot, 'receipt-link.json');
    symlinkSync(receiptPath, linkPath);
    await assert.rejects(() => readProtectedNativeReceipt(linkPath));
    const oversizedPath = path.join(receiptRoot, 'oversized.json');
    writeFileSync(oversizedPath, Buffer.alloc(256 * 1024 + 1), {
      mode: 0o600,
      flag: 'wx',
    });
    await assert.rejects(() => readProtectedNativeReceipt(oversizedPath));
  });

  void it('rejects synthetic relocation metadata and publishes honest preflight failures', () => {
    const value = context();
    const compact = makeProtectedPreflightFailureReceipt({
      environment: value.environment,
      commandExitCode: 2,
      failureReason: 'protected preflight exited with 2',
      phase: 'preflight',
    });
    assert.equal(compact.status, 'failed');
    assert.equal(compact.hostedPromotion, false);
    assert.equal(compact.successArtifactUpload, false);
    assert.equal(compact.qualifiedBuildSource, 'unverified');
    assert.equal(compact.nativeResult, 'unknown');
    assert.equal(compact.cleanupStatus, null);
    assert.equal(compact.buildRelocation, null);
    assert.deepEqual(compact.assertionIds, []);
    assert.deepEqual(compact.contextValidation, {
      status: 'untrusted',
      phase: 'preflight',
      detail: 'protected preflight exited with 2',
    });
    const attackerEnvironment = {
      ...value.environment,
      clientSha: 'ATTACKER_CLIENT',
      serverSha: 'ATTACKER_SERVER',
      buildRunId: 'ATTACKER_BUILD',
      requestedRunId: 'ATTACKER_RUN',
    };
    const attackerReceipt = makeProtectedPreflightFailureReceipt({
      environment: attackerEnvironment,
      commandExitCode: 2,
      failureReason: 'untrusted context',
      phase: 'context',
    });
    assert.equal(attackerReceipt.client.sha, 'unknown');
    assert.equal(attackerReceipt.server.sha, 'unknown');
    assert.equal(attackerReceipt.buildRunId, 'unknown');
    assert.equal(attackerReceipt.requestedRunId, 'unknown');
    assert.equal(attackerReceipt.attemptId, 'unknown');
    assert.equal(attackerReceipt.observedEnvironment.clientSha, 'ATTACKER_CLIENT');
    assert.equal(attackerReceipt.observedEnvironment.serverSha, 'ATTACKER_SERVER');
    assert.equal(attackerReceipt.contextValidation.status, 'untrusted');
  });

  void it('finalizes a real context-collection failure into both compact receipt locations', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'protected-manual-finalizer-workspace-'));
    const receiptParent = mkdtempSync(
      path.join(os.tmpdir(), 'protected-manual-finalizer-receipt-'),
    );
    const failureParent = mkdtempSync(
      path.join(os.tmpdir(), 'protected-manual-finalizer-failure-'),
    );
    const stateRoot = mkdtempSync(path.join(os.tmpdir(), 'protected-manual-finalizer-state-'));
    const outputParent = path.join(workspace, 'output');
    const receiptRoot = path.join(receiptParent, 'receipt');
    const failurePath = path.join(failureParent, 'failure-receipt.private.json');
    const missingClient = path.join(workspace, 'missing-client');
    for (const directory of [workspace, receiptParent, failureParent, stateRoot])
      chmodSync(directory, 0o700);
    temporaryRoots.push(workspace, receiptParent, failureParent, stateRoot);
    const runner = path.join(candidateRoot, 'scripts/ci/protected-native-pilot.ts');
    const result = spawnSync(
      process.env.MYCHAMPIONS_TEST_TSX ?? path.resolve(process.cwd(), 'node_modules/.bin/tsx'),
      [runner, 'finalize', '--exit-code=2', '--preflight-failure=restoration failed'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REPOSITORY: 'edufelip/MyChampions',
          GITHUB_REF_PROTECTED: 'true',
          GITHUB_SHA: '9d0c3f4862e6c8b8004fd3378f9d6897ae46493e',
          MYCHAMPIONS_SERVER_SHA: 'c7b5191352109f9ce2829b2b8fafcc8f554cf8a7',
          MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID: 'dd133cabd89a894e451c0f80',
          MYCHAMPIONS_NATIVE_BUILD_SOURCE: 'private-restoration',
          MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
          MYCHAMPIONS_NATIVE_STATE_ROOT: stateRoot,
          MYCHAMPIONS_PRIVATE_RECEIPT_ROOT: receiptRoot,
          MYCHAMPIONS_NATIVE_OUTPUT_PARENT: outputParent,
          MYCHAMPIONS_FAILURE_RECEIPT_PATH: failurePath,
          MYCHAMPIONS_NATIVE_REQUESTED_RUN_ID: '0123456789abcdef01234567',
          GITHUB_WORKSPACE: workspace,
          MYCHAMPIONS_CLIENT_ROOT: missingClient,
          MYCHAMPIONS_SERVER_ROOT: path.join(workspace, 'server'),
          MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT: path.join(workspace, 'cache'),
        },
      },
    );
    assert.equal(result.status, 2, result.stderr);
    const compact = JSON.parse(
      readFileSync(path.join(receiptRoot, 'failure-receipt.private.json'), 'utf8'),
    ) as {
      status: string;
      nativeResult: string;
      nativeExitCode: number | null;
      cleanupStatus: string | null;
      buildRelocation: unknown;
      contextValidation: {
        status: string;
        phase: string;
        detail: string | null;
      };
    };
    const uploaded = JSON.parse(readFileSync(failurePath, 'utf8')) as typeof compact;
    assert.deepEqual(uploaded, compact);
    assert.equal(compact.status, 'failed');
    assert.equal(compact.nativeResult, 'unknown');
    assert.equal(compact.nativeExitCode, null);
    assert.equal(compact.cleanupStatus, null);
    assert.equal(compact.buildRelocation, null);
    assert.equal(compact.contextValidation.status, 'untrusted');
    assert.equal(compact.contextValidation.phase, 'context');
    assert.match(compact.contextValidation.detail ?? '', /restoration failed/u);
  });

  void it('finalizes a trusted preflight failure without native or cleanup proof', () => {
    const workspace = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-trusted-workspace-')),
    );
    const client = path.join(workspace, 'client');
    const server = path.join(workspace, 'server');
    const cacheParent = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-trusted-cache-')),
    );
    const cache = path.join(cacheParent, 'cache');
    const receiptParent = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-trusted-receipt-')),
    );
    const failureParent = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-trusted-failure-')),
    );
    const stateRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-trusted-state-')),
    );
    const fakeBin = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'protected-manual-trusted-bin-')),
    );
    const receiptRoot = path.join(receiptParent, 'receipt');
    const failurePath = path.join(failureParent, 'failure-receipt.private.json');
    const outputParent = path.join(workspace, 'output');
    mkdirSync(client, { mode: 0o700 });
    mkdirSync(server, { mode: 0o700 });
    mkdirSync(cache, { mode: 0o700 });
    for (const directory of [
      workspace,
      client,
      server,
      cacheParent,
      cache,
      receiptParent,
      failureParent,
      stateRoot,
      fakeBin,
    ])
      chmodSync(directory, 0o700);
    const fakeGit = path.join(fakeBin, 'git');
    writeFileSync(
      fakeGit,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const root = args[1] ?? '';
if (args.includes('rev-parse')) process.stdout.write(root.endsWith('/server') ? 'c7b5191352109f9ce2829b2b8fafcc8f554cf8a7\\n' : '9d0c3f4862e6c8b8004fd3378f9d6897ae46493e\\n');
else if (args.includes('get-url')) process.stdout.write(root.endsWith('/server') ? 'https://github.com/edufelip/mychampions-api\\n' : 'https://github.com/edufelip/MyChampions\\n');
else process.stdout.write('');
`,
      { mode: 0o700, flag: 'wx' },
    );
    const toolVersions: Record<string, string> = {
      yarn: '1.22.22',
      maestro: '2.6.1',
      xcodebuild: 'Xcode 26.1\\nBuild version 17A999',
      xcrun: '26.0',
    };
    for (const [name, version] of Object.entries(toolVersions)) {
      writeFileSync(path.join(fakeBin, name), `#!/bin/sh\nprintf '%b\\n' '${version}'\n`, {
        mode: 0o700,
        flag: 'wx',
      });
    }
    const java = path.join(fakeBin, 'java');
    writeFileSync(java, '#!/bin/sh\nprintf \'openjdk version "17.0.15" 2025-04-15\\n\' >&2\n', {
      mode: 0o700,
      flag: 'wx',
    });
    temporaryRoots.push(workspace, cacheParent, receiptParent, failureParent, stateRoot, fakeBin);
    const result = spawnSync(
      process.env.MYCHAMPIONS_TEST_TSX ?? path.resolve(process.cwd(), 'node_modules/.bin/tsx'),
      [
        path.join(candidateRoot, 'scripts/ci/protected-native-pilot.ts'),
        'finalize',
        '--exit-code=2',
        '--preflight-failure=qualified restoration unavailable',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REPOSITORY: 'edufelip/MyChampions',
          GITHUB_REF_PROTECTED: 'true',
          GITHUB_SHA: '9d0c3f4862e6c8b8004fd3378f9d6897ae46493e',
          MYCHAMPIONS_SERVER_SHA: 'c7b5191352109f9ce2829b2b8fafcc8f554cf8a7',
          MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID: 'dd133cabd89a894e451c0f80',
          MYCHAMPIONS_NATIVE_BUILD_SOURCE: 'private-restoration',
          MYCHAMPIONS_NATIVE_HOST_LOCK_HELD: '1',
          MYCHAMPIONS_NATIVE_STATE_ROOT: stateRoot,
          MYCHAMPIONS_PRIVATE_RECEIPT_ROOT: receiptRoot,
          MYCHAMPIONS_NATIVE_OUTPUT_PARENT: outputParent,
          MYCHAMPIONS_FAILURE_RECEIPT_PATH: failurePath,
          MYCHAMPIONS_NATIVE_REQUESTED_RUN_ID: '0123456789abcdef01234567',
          GITHUB_WORKSPACE: workspace,
          MYCHAMPIONS_CLIENT_ROOT: client,
          MYCHAMPIONS_SERVER_ROOT: server,
          MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT: cache,
        },
      },
    );
    assert.equal(result.status, 2, result.stderr);
    const compact = JSON.parse(readFileSync(failurePath, 'utf8')) as {
      qualifiedBuildSource: string;
      nativeResult: string;
      nativeExitCode: number | null;
      cleanupStatus: string | null;
      buildRelocation: unknown;
      contextValidation: {
        status: string;
        phase: string;
        detail: string | null;
      };
    };
    assert.equal(compact.qualifiedBuildSource, 'private-restoration');
    assert.equal(compact.nativeResult, 'unknown');
    assert.equal(compact.nativeExitCode, null);
    assert.equal(compact.cleanupStatus, null);
    assert.equal(compact.buildRelocation, null);
    assert.equal(compact.contextValidation.status, 'trusted');
    assert.equal(compact.contextValidation.phase, 'preflight');
    assert.equal(compact.contextValidation.detail, 'qualified restoration unavailable');
  });

  void it('keeps this lane manual, pinned, server-bound, and failure-only for hosted artifacts', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const runner = readFileSync(
      path.join(candidateRoot, 'scripts/ci/protected-native-pilot.ts'),
      'utf8',
    );
    assert.match(workflow, /^name: Protected manual iOS Maestro pilot$/mu);
    assert.match(workflow, /^\s+name: Protected manual iOS Maestro training$/mu);
    assert.doesNotMatch(workflow, /publish-selective-status|trusted-selective-tests/u);
    assert.match(workflow, /workflow_dispatch:/u);
    assert.doesNotMatch(workflow, /^\s*(?:push|release|schedule):/mu);
    assert.match(workflow, /github\.ref_protected == true/u);
    assert.match(workflow, /repository: edufelip\/mychampions-api/u);
    assert.match(workflow, /ref: \$\{\{ inputs\.server_sha \}\}/u);
    assert.match(workflow, /path: client/u);
    assert.match(workflow, /path: server/u);
    assert.doesNotMatch(workflow, /path: \.\.\/server/u);
    assert.match(workflow, /working-directory: client/u);
    // The job default `client` only exists after checkout, so the pre-checkout
    // step must run from the workspace root.
    const preCheckout = workflow.slice(
      workflow.indexOf('- name: Validate exact manual inputs before checkout'),
      workflow.indexOf('- name: Checkout exact client revision'),
    );
    assert.match(preCheckout, /^\s+working-directory: \$\{\{ github\.workspace \}\}$/mu);
    assert.match(workflow, /MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT/u);
    assert.match(workflow, /build_source:/u);
    assert.match(workflow, /private-restoration/u);
    assert.match(workflow, /MYCHAMPIONS_NATIVE_BUILD_SOURCE/u);
    assert.match(workflow, /BUILD_SOURCE.*private-restoration/u);
    assert.match(workflow, /MYCHAMPIONS_CLIENT_ROOT=%q/u);
    assert.match(workflow, /MYCHAMPIONS_SERVER_ROOT=%q/u);
    assert.match(workflow, /GITHUB_WORKSPACE\/client/u);
    assert.match(workflow, /GITHUB_WORKSPACE\/server/u);
    assert.match(
      workflow,
      /output_parent="\$GITHUB_WORKSPACE\/client\/\.qa\/artifacts\/native-pilot-attempts"/u,
    );
    assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
    assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/u);
    assert.match(workflow, /actions\/setup-java@c1e323688fd81a25caa38c78aa6df2d33d3e20d9/u);
    assert.match(workflow, /oven-sh\/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6/u);
    assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
    assert.match(workflow, /if: failure\(\)/u);
    assert.doesNotMatch(workflow, /\.png|screenshot|success-artifact/u);
    assert.match(workflow, /--platform=ios/u);
    assert.match(workflow, /--engine=maestro/u);
    assert.match(workflow, /--scenario=SCN-training-ios/u);
    assert.match(workflow, /--attempt-id=/u);
    assert.match(workflow, /--output-parent=/u);
    assert.match(workflow, /run-with-native-host-lock\.sh/u);
    assert.match(
      workflow,
      /set \+e\n\s+node --import tsx scripts\/ci\/protected-native-pilot\.ts preflight/u,
    );
    assert.match(workflow, /preflight_status=\$\?/u);
    assert.match(workflow, /--preflight-failure=/u);
    assert.match(workflow, /if \[\[ "\$preflight_status" -ne 0 \]\]/u);
    assert.match(workflow, /did not publish a failure receipt/u);
    assert.match(workflow, /private_root="\$recovery_root\/mychampions-protected-manual-/u);
    assert.match(workflow, /failure_root="\$RUNNER_TEMP\/mychampions-protected-manual-failure-/u);
    assert.match(workflow, /MYCHAMPIONS_FAILURE_RECEIPT_PATH=/u);
    assert.match(workflow, /if-no-files-found: error/u);
    assert.doesNotMatch(runner, /export function makeCompactProtectedReceipt/u);
    assert.match(runner, /validateProtectedNativeReceipt\(read\.value, context\)/u);
    const nativeValidationOffset = runner.indexOf(
      'validateProtectedNativeReceipt(read.value, context);',
    );
    const nativeReceiptAssignmentOffset = runner.indexOf('receipt = read.value;');
    assert.ok(
      nativeValidationOffset >= 0 && nativeReceiptAssignmentOffset > nativeValidationOffset,
      'invalid native receipts must be rejected before they enter the compact publisher',
    );
    assert.match(runner, /const receipt = successful \? input\.nativeReceipt : null/u);
    assert.match(runner, /nativeReceiptSha256: successful \? input\.nativeReceiptSha256 : null/u);
    assert.match(
      runner,
      /nativeExitCode: successful && typeof receipt\?\.exitCode === 'number' \? receipt\.exitCode : null/u,
    );
    assert.match(
      runner,
      /cleanupStatus: typeof cleanup\?\.status === 'string' \? cleanup\.status : null/u,
    );
    assert.match(runner, /const relocation: ProtectedReusableBuildRelocation = Object\.freeze\(/u);
  });
});

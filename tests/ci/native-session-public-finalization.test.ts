import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  nativeSessionAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from '../../scripts/testing/native-pilot-contract';
import {
  validateNativeSessionPublicAssertionLedger,
  validateNativeSessionPublicLifecycle,
  validateNativeSessionPublicSourceIdentity,
  buildNativeSessionPublicFinalizationCandidate,
  verifyNativeSessionPublicEvidence,
  type NativeSessionPublicFinalizationRuntime,
} from '../../scripts/testing/native-session-public-finalization';
import { readNativeEvidenceObservation } from '../../scripts/testing/native-view-evidence';
import type { NativePilotTarget } from '../../scripts/testing/native-pilot-contract';

const repositoryRoot = process.env.MYCHAMPIONS_QUALIFIED_ROOT ?? path.resolve(__dirname, '../..');
const id = 'a'.repeat(24);
const digest = 'b'.repeat(64);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const postTapFlowPath = 'session-signout-post-tap.yaml';
const postTapHierarchyPath = 'session-signout-post-tap-hierarchy.json';
const postTapScreenshotPath = 'session-signout-post-tap.png';
const postTapFlowBytes = Buffer.from(
  'appId: com.example.mychampions\nname: Native inventory session-signout-post-tap\n---\n' +
    '- scrollUntilVisible:\n' +
    '    element:\n' +
    '      id: settings.account.signOutCta\n' +
    '    direction: DOWN\n' +
    '    timeout: 30000\n' +
    '- tapOn:\n' +
    '    id: settings.account.signOutCta\n',
);
const postTapHierarchyBytes = Buffer.from(
  JSON.stringify({
    attributes: { 'resource-id': 'settings.account.screen' },
    children: [
      { attributes: { 'resource-id': 'settings.account.signOutCta' }, children: [] },
      { attributes: { 'resource-id': 'settings.account.signOutConfirm' }, children: [] },
      { attributes: { 'resource-id': 'settings.account.signOutConfirmCta' }, children: [] },
    ],
  }),
);
const postTapScreenshotBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const postTapDiagnostic = {
  label: 'session-signout-post-tap',
  flowPath: postTapFlowPath,
  flowBytes: postTapFlowBytes.length,
  flowHash: createHash('sha256').update(postTapFlowBytes).digest('hex'),
  hierarchyPath: postTapHierarchyPath,
  hierarchyBytes: postTapHierarchyBytes.length,
  hierarchyHash: createHash('sha256').update(postTapHierarchyBytes).digest('hex'),
  screenshotPath: postTapScreenshotPath,
  screenshotBytes: postTapScreenshotBytes.length,
  screenshotHash: createHash('sha256').update(postTapScreenshotBytes).digest('hex'),
  selectorPresence: {
    accountScreen: true,
    signOutCta: true,
    signOutConfirm: true,
    signOutConfirmCta: true,
  },
};
const lifecycle = () => ({
  signal: new AbortController().signal,
  deadlineAtMs: performance.now() + 60_000,
});

async function selection() {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  return selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-session-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
}

function runtime(patch: Partial<NativeSessionPublicFinalizationRuntime> = {}) {
  return {
    captureRunId: id,
    captureExitCode: 0,
    childExitCode: 0,
    childSignal: null,
    captureResult: 'observed',
    captureCleanup: 'cleaned',
    captureCompleted: true,
    externalCleanupResult: 'passed',
    captureTimeout: null,
    cancellation: null,
    postCaptureFailure: null,
    censusFailures: [],
    outputFailures: [],
    fixtureRunId: id,
    fixtureHash: digest,
    flagsHash: digest,
    timingsMs: { build: 1, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 },
    ...patch,
  } satisfies NativeSessionPublicFinalizationRuntime;
}

function target(): NativePilotTarget {
  return {
    deviceId: 'ios-device',
    osVersion: 'iOS 18.0',
    appId: 'com.example.mychampions',
    buildProfile: 'development',
    binaryHash: digest,
    apiOrigin: 'http://127.0.0.1:43123',
  };
}

void test('session finalization lifecycle gate accepts complete controls without claiming a native pass', async () => {
  const current = await selection();
  validateNativeSessionPublicLifecycle({
    selection: current,
    target: target(),
    runtime: runtime(),
    fixtureRunId: id,
    fixtureHash: digest,
    flagsHash: digest,
  });
  const rows = requireNativePilotAssertions(current).map((row) => ({
    id: row.id,
    requirementRefs: row.requirementRefs,
    evidenceKinds: row.evidenceKinds,
    evidencePaths: ['original/' + row.id + '.private.json'],
  }));
  validateNativeSessionPublicAssertionLedger(current, rows);
  assert.deepEqual(
    rows.map((row) => row.id),
    nativeSessionAssertionIds,
  );
});

void test('session finalization rejects a partial assertion ledger before any staging', async () => {
  const current = await selection();
  const rows = requireNativePilotAssertions(current)
    .slice(0, -1)
    .map((row) => ({
      id: row.id,
      requirementRefs: row.requirementRefs,
      evidenceKinds: row.evidenceKinds,
      evidencePaths: ['original/' + row.id + '.private.json'],
    }));
  assert.throws(() => validateNativeSessionPublicAssertionLedger(current, rows));
});

void test('session finalization rejects duplicate original evidence paths', async () => {
  const current = await selection();
  const rows = requireNativePilotAssertions(current).map((row) => ({
    id: row.id,
    requirementRefs: row.requirementRefs,
    evidenceKinds: row.evidenceKinds,
    evidencePaths: ['original/' + row.id + '.private.json'],
  }));
  rows[0].evidencePaths = ['same.private.json', 'same.private.json'];
  assert.throws(() => validateNativeSessionPublicAssertionLedger(current, rows));
});

void test('session finalization rejects nonzero child, cleanup failure, census evidence and zero timing', async () => {
  const current = await selection();
  for (const patch of [
    { childExitCode: 1 },
    { externalCleanupResult: 'failed' },
    { censusFailures: [{ path: 'failure.private.json' }] },
    { timingsMs: { build: 0, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 } },
  ])
    assert.throws(() =>
      validateNativeSessionPublicLifecycle({
        selection: current,
        target: target(),
        runtime: runtime(patch),
        fixtureRunId: id,
        fixtureHash: digest,
        flagsHash: digest,
      }),
    );
});

void test('session finalization rejects target identity and API origin drift', async () => {
  const current = await selection();
  assert.throws(() =>
    validateNativeSessionPublicLifecycle({
      selection: current,
      target: { ...target(), binaryHash: 'not-a-hash' },
      runtime: runtime(),
      fixtureRunId: id,
      fixtureHash: digest,
      flagsHash: digest,
    }),
  );
  assert.throws(() =>
    validateNativeSessionPublicLifecycle({
      selection: current,
      target: { ...target(), apiOrigin: 'https://public.example.invalid' },
      runtime: runtime(),
      fixtureRunId: id,
      fixtureHash: digest,
      flagsHash: digest,
    }),
  );
});

void test('session finalization rejects stale current source identity', () => {
  const source = { sha: 'a'.repeat(40), dirty: true, sourceTreeHash: digest };
  assert.throws(() =>
    validateNativeSessionPublicSourceIdentity({
      captureSource: source,
      captureSourceAfter: source,
      sourceBefore: { ...source, sourceTreeHash: 'c'.repeat(64) },
      sourceAfter: { ...source, sourceTreeHash: 'c'.repeat(64) },
    }),
  );
  assert.throws(() =>
    validateNativeSessionPublicSourceIdentity({
      captureSource: source,
      captureSourceAfter: { ...source, sha: 'd'.repeat(40) },
      sourceBefore: source,
      sourceAfter: { ...source, sha: 'd'.repeat(40) },
    }),
  );
});

void test('actual-shaped session capture constructs six bindings from original producer files', async () => {
  const current = await selection();
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'session-public-candidate-')));
  const captureRunId = 'c'.repeat(24);
  const labels = [
    'entry',
    'password-save-prompt',
    'coach-home',
    'restored-home',
    'account',
    'restored-identity',
    'signout-confirm',
    'cancel-signout',
    'signout-reopen',
    'signout-confirmed',
    'signed-out-relaunch',
  ];
  const frameEvidence = Buffer.from('original-evidence');
  const frameHash = sha256(frameEvidence);
  const frameRows = labels.map((label) => ({
    label,
    screenshotPath: label + '.png',
    screenshotHash: frameHash,
    hierarchyPath: label + '-hierarchy.json',
    hierarchyHash: frameHash,
  }));
  const domainPaths = ['session-domain-before-login.private.json'];
  const capture = {
    captureRunId,
    sessionEvidencePublication: 'complete',
    sessionAssertionSequence: [...nativeSessionAssertionIds],
    sessionViewEvidence: frameRows,
    sessionSignOutPostTapDiagnostic: postTapDiagnostic,
    nativeAuthIdentityEvidence: { path: 'native-auth-identities.private.json' },
    sessionSqlBefore: { path: 'session-sql-before.private.json' },
    sessionSqlAfterSignedoutRelaunch: {
      path: 'session-sql-after-signed-out-relaunch.private.json',
    },
  };
  const dependency = {
    status: 'validated-source-only' as const,
    selection: current,
    captureRunId,
    files: {
      framePaths: frameRows.map((row) => row.screenshotPath),
      startupDiagnosticFramePath: 'launched.png',
      profilePaths: [],
      domainPaths,
      transportPath: 'transport-observations.private.json',
      terminalTransportPath: 'transport-terminal.private.json',
      postTapDiagnosticPaths: [postTapFlowPath, postTapHierarchyPath, postTapScreenshotPath],
    },
  } as unknown as Parameters<typeof buildNativeSessionPublicFinalizationCandidate>[0]['dependency'];
  const allPaths = [
    ...frameRows.flatMap((row) => [row.screenshotPath, row.hierarchyPath]),
    ...domainPaths,
    'native-auth-identities.private.json',
    'session-sql-before.private.json',
    'session-sql-after-signed-out-relaunch.private.json',
    'transport-observations.private.json',
    postTapFlowPath,
    postTapHierarchyPath,
    postTapScreenshotPath,
  ];
  await chmod(parent, 0o700);
  const evidenceByPath = new Map<string, string | Buffer>([
    [postTapFlowPath, postTapFlowBytes],
    [postTapHierarchyPath, postTapHierarchyBytes],
    [postTapScreenshotPath, postTapScreenshotBytes],
  ]);
  for (const relativePath of allPaths)
    await writeFile(
      path.join(parent, relativePath),
      evidenceByPath.get(relativePath) ?? frameEvidence,
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
  const candidate = await buildNativeSessionPublicFinalizationCandidate({
    selection: current,
    captureRoot: parent,
    capture,
    dependency,
    fixtureRunId: captureRunId,
  });
  assert.equal(candidate.nativePassingCases, nativeSessionAssertionIds.length);
  assert.equal(candidate.publicPromotionEligible, true);
  assert.deepEqual(
    candidate.assertionBindings.map((row) => row.id),
    nativeSessionAssertionIds,
  );
  await assert.rejects(
    buildNativeSessionPublicFinalizationCandidate({
      selection: current,
      captureRoot: parent,
      capture: {
        ...capture,
        sessionViewEvidence: frameRows.filter((row) => row.label !== 'signed-out-relaunch'),
      },
      dependency,
      fixtureRunId: captureRunId,
    }),
  );
  await rm(parent, { recursive: true, force: true });
});

void test('session finalization rechecks original mode and link count after staging', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'session-public-finalization-metadata-')),
  );
  const captureRoot = path.join(parent, 'capture');
  const outputRoot = path.join(parent, id);
  const captureRunId = 'c'.repeat(24);
  const prefix = 'evidence/' + captureRunId + '/session-public';
  await mkdir(captureRoot, { recursive: true, mode: 0o700 });
  await mkdir(path.join(outputRoot, prefix), { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  await chmod(captureRoot, 0o700);
  await chmod(outputRoot, 0o700);
  const evidencePath = 'original.json';
  const bytes = 'abc';
  await writeFile(path.join(captureRoot, evidencePath), bytes, { mode: 0o600 });
  const manifest = {
    kind: 'private-ios-session-public-finalization-copy-not-public-receipt',
    requestedRunId: id,
    captureRunId,
    fixtureRunId: id,
    assertionIds: [...nativeSessionAssertionIds],
    nativePassingCases: nativeSessionAssertionIds.length,
    publicPassingCases: nativeSessionAssertionIds.length,
    publicPromotionEligible: true,
    files: [
      {
        path: evidencePath,
        sha256: sha256(bytes),
        bytes: bytes.length,
        originalMode: 0o600,
        originalUid: process.getuid?.() ?? -1,
        originalNlink: 1,
        originalStat: readNativeEvidenceObservation(captureRoot, evidencePath, true).identity,
      },
    ],
  };
  const manifestPath = prefix + '/copy-manifest.private.json';
  await writeFile(path.join(outputRoot, prefix, evidencePath), bytes, { mode: 0o600 });
  const manifestBytes = JSON.stringify(manifest);
  await writeFile(path.join(outputRoot, manifestPath), manifestBytes, { mode: 0o600 });
  const verify = () =>
    verifyNativeSessionPublicEvidence(
      {
        outputRoot,
        copyManifest: { path: manifestPath, sha256: sha256(manifestBytes) },
        requestedRunId: id,
        captureRunId,
        fixtureRunId: id,
        captureRoot,
      },
      lifecycle(),
    );
  await verify();
  await chmod(path.join(captureRoot, evidencePath), 0o644);
  await assert.rejects(verify());
  await chmod(path.join(captureRoot, evidencePath), 0o600);
  await link(path.join(captureRoot, evidencePath), path.join(captureRoot, 'second-link'));
  await assert.rejects(verify());
  await rm(parent, { recursive: true, force: true });
});

void test('session finalization rechecks an equal-length aggregate byte mutation', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'session-public-finalization-')),
  );
  const outputRoot = path.join(parent, id);
  const captureRunId = 'c'.repeat(24);
  const prefix = 'evidence/' + captureRunId + '/session-public';
  await mkdir(path.join(outputRoot, prefix), { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  await chmod(outputRoot, 0o700);
  const evidencePath = 'original.json';
  const bytes = 'abc';
  await writeFile(path.join(outputRoot, prefix, evidencePath), bytes, { mode: 0o600 });
  const manifest = {
    kind: 'private-ios-session-public-finalization-copy-not-public-receipt',
    requestedRunId: id,
    captureRunId,
    fixtureRunId: id,
    assertionIds: [...nativeSessionAssertionIds],
    nativePassingCases: nativeSessionAssertionIds.length,
    publicPassingCases: nativeSessionAssertionIds.length,
    publicPromotionEligible: true,
    files: [
      {
        path: evidencePath,
        sha256: sha256(bytes),
        bytes: bytes.length,
        originalMode: 0o600,
        originalUid: process.getuid?.() ?? -1,
        originalNlink: 1,
        originalStat: readNativeEvidenceObservation(outputRoot, prefix + '/' + evidencePath, true)
          .identity,
      },
    ],
  };
  const manifestPath = prefix + '/copy-manifest.private.json';
  const manifestBytes = JSON.stringify(manifest);
  await writeFile(path.join(outputRoot, manifestPath), manifestBytes, { mode: 0o600 });
  await verifyNativeSessionPublicEvidence(
    {
      outputRoot,
      copyManifest: { path: manifestPath, sha256: sha256(manifestBytes) },
      requestedRunId: id,
      captureRunId,
      fixtureRunId: id,
    },
    lifecycle(),
  );
  await writeFile(path.join(outputRoot, prefix, evidencePath), 'xbc', { mode: 0o600 });
  await assert.rejects(
    verifyNativeSessionPublicEvidence(
      {
        outputRoot,
        copyManifest: { path: manifestPath, sha256: sha256(manifestBytes) },
        requestedRunId: id,
        captureRunId,
        fixtureRunId: id,
      },
      lifecycle(),
    ),
  );
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink, chmod, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  validateOwnedManifest,
  readOwnedRuntimeDocument,
} from '../../scripts/testing/owned-session';
import { assertPublicReceipt, loadTestingSchema } from '../../scripts/testing/schema-validation';

function receipt() {
  const hash = 'a'.repeat(64);
  return {
    schemaVersion: 1,
    runId: 'schema-run',
    attemptId: 'attempt-1',
    scenarioId: 'TC-OWNED-1',
    phase: 'P3',
    layer: 'postgres-ui',
    engine: 'playwright',
    dataMode: 'postgres',
    platform: 'web',
    locale: 'en-US',
    repositories: [{ name: 'client', sha: 'b'.repeat(40), dirty: true, workingTreeHash: hash }],
    target: {
      deviceId: null,
      osVersion: null,
      appId: null,
      binaryHash: null,
      buildProfile: null,
      apiOrigin: 'http://127.0.0.1:42001',
    },
    inputs: {
      scenarioHash: hash,
      requirementHash: hash,
      fixtureHash: hash,
      flagsHash: hash,
      toolVersions: { playwright: '1.61.1' },
    },
    command: { executable: 'node', argv: ['testing-runner.mjs'] },
    startedAt: '2026-09-28T00:00:00.000Z',
    finishedAt: '2026-09-28T00:00:01.000Z',
    result: 'passed',
    exitCode: 0,
    childExitCode: 0,
    assertions: [
      {
        id: 'durable-1',
        requirementRefs: ['BL-018/T10'],
        outcome: 'passed',
        evidencePaths: ['evidence.json'],
      },
    ],
    timingsMs: { build: 0, install: 0, reset: 0, scenario: 100, verify: 10, cleanup: 10 },
    cleanup: { status: 'cleaned', ownedResourceIds: ['owned-test-run'], recoveryRecordPath: null },
    artifacts: ['evidence.json'],
    blocker: null,
  };
}
void test('all checked-in runner schemas compile and unknown schemas block', () => {
  for (const name of [
    'resource-manifest-v1',
    'api-process-v1',
    'application-fixtures-v1',
    'session-request-v1',
    'domain-snapshot-v1',
    'connection-snapshot-v1',
    'session-event-v1',
    'session-receipt-v1',
    'public-receipt-v1',
    'expo-process-v1',
    'integration-context-v1',
    'integration-assertions-v1',
    'playwright-report-v1',
    'integration-harness-block-v1',
  ])
    assert.ok(loadTestingSchema(name));
  assert.throws(() => loadTestingSchema('../unknown'), /Unknown/);
});

void test('native application failure requires child1, a failed assertion and present owned evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mc-native-failure-receipt-'));
  const base = receipt();
  const failed = {
    ...base,
    phase: 'P4',
    layer: 'native',
    engine: 'maestro',
    platform: 'ios',
    result: 'application-failed',
    exitCode: 1,
    childExitCode: 1,
    inputs: { ...base.inputs, toolVersions: { maestro: '2.6.1' } },
    target: {
      ...base.target,
      deviceId: 'owned',
      osVersion: 'ios-owned',
      appId: 'owned.app',
      binaryHash: 'a'.repeat(64),
      buildProfile: 'owned-debug',
    },
    assertions: [{ ...base.assertions[0], outcome: 'failed' }],
  };
  try {
    await writeFile(path.join(root, 'evidence.json'), '{}');
    assert.doesNotThrow(() => assertPublicReceipt(failed, root));
    for (const value of [
      { ...failed, childExitCode: null },
      { ...failed, childExitCode: 2 },
      { ...failed, assertions: [] },
      { ...failed, assertions: base.assertions },
      { ...failed, target: { ...failed.target, binaryHash: null } },
      { ...failed, inputs: { ...failed.inputs, scenarioHash: null } },
      { ...failed, cleanup: { ...failed.cleanup, status: 'not-acquired' } },
      { ...failed, artifacts: ['absent.json'] },
    ])
      assert.throws(() => assertPublicReceipt(value, root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('public receipt rejects false success, absent fields, unknown fingerprints and private data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mc-receipt-schema-'));
  try {
    await writeFile(path.join(root, 'evidence.json'), '{}');
    assert.doesNotThrow(() => assertPublicReceipt(receipt(), root));
    const invalid = [
      { ...receipt(), exitCode: 1 },
      { ...receipt(), assertions: [] },
      { ...receipt(), assertions: [{ ...receipt().assertions[0], outcome: 'not-executed' }] },
      {
        ...receipt(),
        cleanup: { ...receipt().cleanup, status: 'failed-recovery-ledger-retained' },
      },
      { ...receipt(), inputs: { ...receipt().inputs, scenarioHash: null } },
      { ...receipt(), repositories: [{ ...receipt().repositories[0], workingTreeHash: null }] },
      { ...receipt(), command: { executable: 'node', argv: ['postgres://private-target'] } },
      { ...receipt(), password: 'must-not-appear' },
      { ...receipt(), finishedAt: '2026-09-27T00:00:00.000Z' },
      { ...receipt(), assertions: [...receipt().assertions, ...receipt().assertions] },
      { ...receipt(), artifacts: ['missing.json'] },
    ];
    for (const value of invalid) assert.throws(() => assertPublicReceipt(value, root));
    assert.throws(
      () =>
        assertPublicReceipt(
          { ...receipt(), command: { executable: 'node', argv: ['private-token-123'] } },
          root,
          ['private-token-123'],
        ),
      /private data/,
    );
    const withoutCommand = { ...receipt(), command: undefined };
    assert.throws(() => assertPublicReceipt(withoutCommand, root), /Invalid/);
    const blocked = {
      ...receipt(),
      result: 'harness-blocked',
      exitCode: 2,
      childExitCode: null,
      assertions: [],
      artifacts: [],
      blocker: {
        code: 'missing-device',
        detail: 'Device unavailable',
        owner: 'maintainer',
        nextAction: 'Supply the required device',
      },
    };
    assert.doesNotThrow(() => assertPublicReceipt(blocked, root));
    const unknownRepositories = {
      ...blocked,
      repositories: [],
      repositoryEvidence: {
        status: 'unknown',
        missing: ['client', 'server'],
        reason: 'repository identity was unavailable before the preflight receipt',
      },
    };
    assert.doesNotThrow(() => assertPublicReceipt(unknownRepositories, root));
    assert.throws(() =>
      assertPublicReceipt(
        { ...unknownRepositories, result: 'passed', exitCode: 0, blocker: null },
        root,
      ),
    );
    assert.throws(() =>
      assertPublicReceipt(
        {
          ...unknownRepositories,
          repositories: [
            { name: 'client', sha: 'b'.repeat(40), dirty: false, workingTreeHash: null },
          ],
        },
        root,
      ),
    );
    const partialRepositories = {
      ...blocked,
      repositoryEvidence: {
        status: 'partial',
        missing: ['server'],
        reason: 'server identity was unavailable before the preflight receipt',
      },
    };
    assert.doesNotThrow(() => assertPublicReceipt(partialRepositories, root));
    const observedRepositories = {
      ...blocked,
      repositoryEvidence: { status: 'observed', missing: [], reason: null },
    };
    assert.doesNotThrow(() => assertPublicReceipt(observedRepositories, root));
    assert.throws(() =>
      assertPublicReceipt(
        {
          ...observedRepositories,
          repositories: [],
          repositoryEvidence: { status: 'observed', missing: [], reason: null },
        },
        root,
      ),
    );
    assert.throws(() => assertPublicReceipt({ ...blocked, blocker: null }, root), /Invalid/);
    for (const exitCode of [130, 143])
      assert.doesNotThrow(() =>
        assertPublicReceipt({ ...blocked, result: 'cancelled', exitCode }, root),
      );
    assert.throws(() =>
      assertPublicReceipt({ ...blocked, result: 'cancelled', exitCode: 0 }, root),
    );
    assert.doesNotThrow(() =>
      assertPublicReceipt({ ...receipt(), result: 'application-failed', exitCode: 1 }, root),
    );
    assert.throws(() =>
      assertPublicReceipt(
        {
          ...receipt(),
          result: 'application-failed',
          exitCode: 1,
          cleanup: { ...receipt().cleanup, status: 'failed-recovery-ledger-retained' },
        },
        root,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('public artifact paths reject traversal, external symlinks and broken external symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mc-receipt-path-'));
  const external = await mkdtemp(path.join(os.tmpdir(), 'mc-external-path-'));
  try {
    await writeFile(path.join(root, 'evidence.json'), '{}');
    await writeFile(path.join(external, 'secret.json'), '{}');
    await symlink(path.join(external, 'secret.json'), path.join(root, 'outside.json'));
    await symlink(path.join(external, 'absent.json'), path.join(root, 'broken.json'));
    for (const relative of [
      '../escape.json',
      '/tmp/escape.json',
      'C:/escape.json',
      'outside.json',
      'broken.json',
    ])
      assert.throws(() => assertPublicReceipt({ ...receipt(), artifacts: [relative] }, root));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

function manifest() {
  const runId = 'a'.repeat(24);
  return {
    schemaVersion: 1,
    runId,
    composeProject: `mc_test_${runId}`,
    containerId: 'b'.repeat(64),
    ownerTokenHash: 'c'.repeat(64),
    port: 42002,
    targets: {
      DATABASE_URL: `mc_test_${runId}`,
      FOOD_CATALOG_DATABASE_URL: `mc_test_${runId}_food`,
      EXERCISE_CATALOG_DATABASE_URL: `mc_test_${runId}_exercise`,
    },
    repoRoot: '/owned/server',
    runtimeRoot: '/owned/server/.qa/runtime',
    artifactRoot: `/owned/server/.qa/runtime/${runId}`,
    createdAt: '2026-09-28T00:00:00.000Z',
    repositories: {
      server: { sha: 'd'.repeat(40), dirty: false, workingTreeHash: 'e'.repeat(64) },
      client: { sha: 'f'.repeat(40), dirty: false, workingTreeHash: 'e'.repeat(64) },
    },
    orchestratorPid: 1234,
    testChildPid: null,
    phase: 'tests',
    fixtureScopes: [],
    processes: [
      {
        role: 'orchestrator',
        pid: 1234,
        started: 'owned-start',
        script: '/owned/server/scripts/testing/session.ts',
      },
    ],
  };
}
void test('resource bridge rejects wrong roots, copied run IDs, stale PID/start identity and inconsistent targets', () => {
  const value = manifest();
  const identity = {
    serverRoot: '/owned/server',
    runId: value.runId,
    pid: 1234,
    started: 'owned-start',
  };
  assert.equal(validateOwnedManifest(value, identity).runId, value.runId);
  const bootstrap = { ...value, port: 0, phase: 'bootstrap' };
  assert.throws(() => validateOwnedManifest(bootstrap, identity));
  assert.equal(validateOwnedManifest(bootstrap, { ...identity, acquiring: true }).port, 0);
  for (const invalid of [
    { ...value, repoRoot: '/foreign/server' },
    { ...value, runtimeRoot: '/foreign/runtime' },
    { ...value, runId: 'b'.repeat(24) },
    { ...value, orchestratorPid: 9999 },
    { ...value, processes: [{ ...value.processes[0], started: 'reused-pid' }] },
    { ...value, targets: { ...value.targets, DATABASE_URL: `mc_test_${'b'.repeat(24)}` } },
    { ...value, processes: [...value.processes, ...value.processes] },
    { ...value, port: 15432 },
    { ...value, ownerToken: 'private-token' },
  ])
    assert.throws(() => validateOwnedManifest(invalid, identity));
});

void test('private runtime reader rejects public permissions, alternate paths and symlinks', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-private-reader-')));
  const file = path.join(root, 'api-safe.json');
  const value = {
    schemaVersion: 1,
    runId: 'a'.repeat(24),
    ownerTokenHash: 'b'.repeat(64),
    pid: 1234,
    started: 'owned-start',
    script: '/owned/serve.ts',
    attempt: 'safe',
    origin: 'http://127.0.0.1:42001',
  };
  try {
    await chmod(root, 0o700);
    await writeFile(file, JSON.stringify(value), { mode: 0o600 });
    assert.deepEqual(
      await readOwnedRuntimeDocument(file, root, 'api-safe.json', 'api-process-v1'),
      value,
    );
    await chmod(file, 0o644);
    await assert.rejects(
      readOwnedRuntimeDocument(file, root, 'api-safe.json', 'api-process-v1'),
      /private/,
    );
    await chmod(file, 0o600);
    await symlink(file, path.join(root, 'alias.json'));
    await assert.rejects(
      readOwnedRuntimeDocument(path.join(root, 'alias.json'), root, 'alias.json', 'api-process-v1'),
      /path mismatch/,
    );
    await assert.rejects(
      readOwnedRuntimeDocument(file, root, 'different.json', 'api-process-v1'),
      /path mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

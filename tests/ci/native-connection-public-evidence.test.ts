import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildNativeConnectionAssertionBindings,
  nativeConnectionEvidenceReferences,
  nativeConnectionAssertionEvidenceKind,
  redactedNativeConnectionFrameLabels,
  assertNativeConnectionProofExact,
  assertNativeConnectionObservationRoute,
  assertNativeConnectionBackendProvenance,
  requireNativeConnectionInitialAuthBinding,
  prepareIosConnectionPilotEvidence,
} from '../../scripts/testing/native-connection-public-evidence';
import {
  nativeConnectionAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from '../../scripts/testing/native-pilot-contract';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const repositoryRoot = path.resolve(process.cwd());

async function selectionFor(): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { sources: { paths: string[]; revision: string }[] };
  for (const source of inventory.sources)
    if (source.paths.length === 1)
      source.revision = createHash('sha256')
        .update(await readFile(path.join(repositoryRoot, source.paths[0])))
        .digest('hex');
  return selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-connection-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
}

async function disposableRepository(): Promise<{
  parent: string;
  root: string;
  selection: NativePilotSelection;
}> {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-connection-public-repo-')),
  );
  const root = path.join(parent, 'repo');
  await mkdir(root, { mode: 0o700 });
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as {
    sources: { paths: string[]; revision: string }[];
    views: { ownerPaths?: string[] }[];
    transitions: { ownerPaths?: string[] }[];
    scenarios: {
      ownerPaths?: string[];
      maestroFlow?: string;
      freshnessInputs?: { requirementPaths?: string[] };
    }[];
  };
  const files = new Set<string>();
  for (const source of inventory.sources) for (const file of source.paths) files.add(file);
  for (const view of inventory.views) for (const file of view.ownerPaths ?? []) files.add(file);
  for (const transition of inventory.transitions)
    for (const file of transition.ownerPaths ?? []) files.add(file);
  for (const scenario of inventory.scenarios) {
    for (const file of scenario.ownerPaths ?? []) files.add(file);
    if (scenario.maestroFlow) files.add(scenario.maestroFlow);
    for (const file of scenario.freshnessInputs?.requirementPaths ?? []) files.add(file);
  }
  for (const relative of files) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(path.join(repositoryRoot, relative), destination);
  }
  for (const source of inventory.sources)
    if (source.paths.length === 1)
      source.revision = createHash('sha256')
        .update(await readFile(path.join(root, source.paths[0])))
        .digest('hex');
  const inventoryPath = path.join(root, 'docs/qa/native-pilot/inventory.json');
  await mkdir(path.dirname(inventoryPath), { recursive: true, mode: 0o700 });
  await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n', { mode: 0o600 });
  const selection = await selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-connection-ios', mode: 'integration' },
    inventory,
    root,
  );
  return { parent, root, selection };
}

void test('connection evidence mapper preserves the seven frozen purposes and redacts secret frames', async () => {
  const selection = await selectionFor();
  const rows = requireNativePilotAssertions(selection);
  const attemptId = `${'a'.repeat(24)}:first`;
  const bindings = buildNativeConnectionAssertionBindings(selection, attemptId);
  assert.deepEqual(
    bindings.map((row) => row.id),
    [...nativeConnectionAssertionIds],
  );
  assert.equal(bindings.length, 7);
  for (const [index, row] of rows.entries()) {
    assert.deepEqual(bindings[index].requirementRefs, row.requirementRefs);
    assert.deepEqual(
      bindings[index].evidencePaths,
      row.evidencePathTemplates!.map((template) => template.replace('{attemptId}', attemptId)),
    );
    for (const kind of row.evidenceKinds) {
      const references = nativeConnectionEvidenceReferences(row.id, kind);
      assert(references.length > 0);
      assert(references.every((reference) => !reference.path.includes('..')));
      assert(references.every((reference) => typeof reference.redacted === 'boolean'));
    }
  }
  assert.deepEqual(redactedNativeConnectionFrameLabels, [
    'coach-home',
    'connection-coach-invite',
    'connection-coach-return-home',
    'connection-student-entry',
    'connection-student-pending',
    'connection-submit',
  ]);
  assert.equal(Object.isFrozen(redactedNativeConnectionFrameLabels), true);
  const normalUi = nativeConnectionEvidenceReferences('NAT-connection-normal-entry', 'ui');
  assert.equal(normalUi.filter((reference) => reference.redacted).length, 3 * 2);
  const unrelatedSql = nativeConnectionEvidenceReferences('NAT-connection-unrelated-state', 'sql');
  assert.deepEqual(
    unrelatedSql.map((reference) => reference.path),
    [
      'connection-isolation-before.private.json',
      'connection-isolation-after.private.json',
      'connection-training-before.private.json',
      'connection-training-after.private.json',
      'connection-before.private.json',
      'connection-final.private.json',
    ],
  );
  assert.equal(
    nativeConnectionAssertionEvidenceKind,
    'native-connection-assertion-evidence-preparation',
  );
});

void test('connection preparation rejects an asserted native pass before reading dependent evidence', async () => {
  const disposable = await disposableRepository();
  const selection = disposable.selection;
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-connection-prep-')));
  const captureRoot = path.join(parent, 'b'.repeat(24));
  await mkdir(captureRoot, { mode: 0o700 });
  await chmod(captureRoot, 0o700);
  const capture = {
    kind: 'private-owned-native-connection-execution-not-public-receipt',
    mode: 'integration',
    platform: 'ios',
    charter: 'connection-journey',
    result: 'observed',
    cleanup: 'cleaned',
    nativePassingCases: 1,
    backend: { runId: 'c'.repeat(24) },
  };
  await writeFile(path.join(captureRoot, 'capture.private.json'), JSON.stringify(capture), {
    mode: 0o600,
  });
  try {
    await assert.rejects(
      prepareIosConnectionPilotEvidence({
        repositoryRoot: disposable.root,
        artifactRoot: captureRoot,
        selection,
        requestedRunId: 'a'.repeat(24),
      }),
      /nativePassingCases|!== 0|pass/i,
    );
    assert.deepEqual(await readdir(captureRoot), ['capture.private.json']);
  } finally {
    await Promise.all([
      rm(parent, { recursive: true, force: true }),
      rm(disposable.parent, { recursive: true, force: true }),
    ]);
  }
});

void test('connection binding builder rejects a non-first or noncanonical attempt', async () => {
  const selection = await selectionFor();
  assert.throws(
    () => buildNativeConnectionAssertionBindings(selection, `${'a'.repeat(24)}:second`),
    /first|attempt/i,
  );
  assert.throws(() => buildNativeConnectionAssertionBindings(selection, 'short'), /first|attempt/i);
});

void test('connection proof guard rejects redaction, reference, and contract mutations', () => {
  const expected = {
    schemaVersion: 1 as const,
    kind: nativeConnectionAssertionEvidenceKind,
    purpose: 'runtime' as const,
    assertionId: 'NAT-connection-normal-entry',
    evidenceKind: 'ui' as const,
    requirementRefs: ['SC-211'],
    fixtureRunId: 'c'.repeat(24),
    attemptId: `${'a'.repeat(24)}:first`,
    scenarioHash: '1'.repeat(64),
    requirementHash: '2'.repeat(64),
    references: [{ path: 'coach-home.png', sha256: '3'.repeat(64), redacted: true }],
    nativePassingCases: 0 as const,
    scope:
      'prepared runtime connection proof; public receipt/finalization and engine qualification are separate',
  } as const;
  assertNativeConnectionProofExact(expected, expected);
  for (const mutate of [
    () => ({ ...expected, references: [{ ...expected.references[0], redacted: false }] }),
    () => ({
      ...expected,
      references: [...expected.references, { ...expected.references[0], path: 'extra.png' }],
    }),
    () => ({ ...expected, requirementRefs: ['BR-999'] }),
    () => ({ ...expected, scenarioHash: '4'.repeat(64) }),
    () => ({ ...expected, evidenceKind: 'sql' as const }),
    () => ({ ...expected, references: [] }),
  ])
    assert.throws(() => assertNativeConnectionProofExact(mutate(), expected));
});

void test('initial coach auth binding derives the fixture allowlist and rejects a widened or stale window', () => {
  const origin = 'http://127.0.0.1:40123';
  const requestId = 3;
  const afterRequestId = 5;
  const fixtureAuthUids = ['coach-auth', 'student-auth'];
  const allowlistHash = createHash('sha256').update(JSON.stringify(fixtureAuthUids)).digest('hex');
  const target = {
    fixtureAuthUids,
    professionalAuthUid: 'coach-auth',
    studentAuthUid: 'student-auth',
  };
  const authIdentity = {
    requestId,
    ordinal: 1,
    targetOrigin: origin,
    apiPid: 4321,
    status: 201,
    authUid: 'coach-auth',
    verification: 'verified' as const,
    verificationReason: 'verified' as const,
    fixtureAuthUidAllowlistHash: allowlistHash,
  };
  const signIn = {
    requestId,
    method: 'POST',
    pathHash: createHash('sha256').update('/auth/email/sign-in').digest('hex'),
    requestOrigin: null,
    requestProfile: 'native' as const,
    targetOrigin: origin,
    status: 201,
    outcome: 'forwarded' as const,
    faultAttemptId: null,
    elapsedMs: 1,
  };
  const input = {
    initialAuth: {
      actor: 'coach',
      actorAuthUid: 'coach-auth',
      authRequestId: requestId,
      afterRequestId,
    },
    target,
    authIdentities: [authIdentity],
    transport: [signIn],
    apiOrigin: origin,
  };
  requireNativeConnectionInitialAuthBinding(input);
  assert.throws(() =>
    requireNativeConnectionInitialAuthBinding({
      ...input,
      authIdentities: [{ ...authIdentity, fixtureAuthUidAllowlistHash: 'f'.repeat(64) }],
    }),
  );
  assert.throws(() =>
    requireNativeConnectionInitialAuthBinding({
      ...input,
      initialAuth: { ...input.initialAuth, afterRequestId: requestId },
      authIdentities: [authIdentity, { ...authIdentity, ordinal: 2 }],
    }),
  );
  assert.throws(() =>
    requireNativeConnectionInitialAuthBinding({
      ...input,
      transport: [{ ...signIn, requestId: 4 }, signIn],
    }),
  );
});

void test('connection coach-pending field is bound to its /connections producer route', () => {
  const observation = {
    requestId: 7,
    method: 'GET',
    pathHash: createHash('sha256').update('/connections').digest('hex'),
    requestOrigin: null,
    requestProfile: 'native' as const,
    targetOrigin: 'http://127.0.0.1:40123',
    status: 200,
    outcome: 'forwarded' as const,
    faultAttemptId: null,
    elapsedMs: 1,
  };
  assertNativeConnectionObservationRoute(
    [observation],
    [observation],
    '/connections',
    'GET',
    200,
    false,
  );
  assert.throws(() =>
    assertNativeConnectionObservationRoute(
      [observation],
      [observation],
      '/professional/students',
      'GET',
      200,
      false,
    ),
  );
});

void test('connection backend provenance rejects origin, process-start, and attempt tampering', () => {
  const runId = 'c'.repeat(24);
  const backend = {
    runId,
    backendAttemptId: `${runId}:first`,
    apiOrigin: 'http://127.0.0.1:40123',
    apiProcess: { pid: 4321, started: 'Wed Oct 01 04:00:00 2026', script: '/owned/api' },
    processes: [
      { role: 'api', pid: 4321, started: 'Wed Oct 01 04:00:00 2026', script: '/owned/api' },
    ],
  };
  const apiIdentity = { apiPid: 4321, targetOrigin: backend.apiOrigin };
  assert.deepEqual(
    assertNativeConnectionBackendProvenance(backend, apiIdentity, runId, `${runId}:first`),
    backend.apiProcess,
  );
  assert.throws(() =>
    assertNativeConnectionBackendProvenance(
      { ...backend, apiOrigin: 'http://127.0.0.1:40124' },
      apiIdentity,
      runId,
      `${runId}:first`,
    ),
  );
  assert.throws(() =>
    assertNativeConnectionBackendProvenance(
      { ...backend, apiProcess: { ...backend.apiProcess, started: 'tampered' } },
      apiIdentity,
      runId,
      `${runId}:first`,
    ),
  );
  assert.throws(() =>
    assertNativeConnectionBackendProvenance(
      { ...backend, backendAttemptId: `${runId}:retry` },
      apiIdentity,
      runId,
      `${runId}:first`,
    ),
  );
});

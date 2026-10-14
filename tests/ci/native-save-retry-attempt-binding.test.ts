import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import {
  nativeSaveRetryAssertionIds,
  readNativeSaveRetryAttemptBinding,
  requireNativeSaveRetryAssertionContract,
  requireNativeSaveRetryAttemptBinding,
  saveRetryAttemptBindingPath,
  writeNativeSaveRetryAttemptBinding,
} from '../../scripts/testing/native-save-retry-attempt-binding';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type { NativeSaveRetryAttemptBinding } from '../../scripts/testing/native-save-retry-attempt-binding';

const repositoryRoot = path.resolve(__dirname, '../..');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

const sha256 = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

async function declaredSelection(platform: 'ios' | 'android') {
  const inventory: unknown = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  );
  return selectNativePilotScenario(
    {
      platform,
      engine: 'maestro',
      scenario: `SCN-save-retry-${platform}`,
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
}

function syntheticSelection(base: NativePilotSelection): NativePilotSelection {
  const evidenceKinds = [
    ['ui', 'api'],
    ['ui', 'sql'],
    ['ui', 'api', 'sql'],
    ['ui', 'api', 'sql'],
    ['sql'],
  ] as const;
  const rows = nativeSaveRetryAssertionIds.map((id, index) => {
    const suffix = id.replace('NAT-save-retry-', '');
    return {
      id,
      requirementRefs: ['SC-208', 'TC-303'],
      evidenceKinds: [...evidenceKinds[index]],
      requirementPaths: [...base.scenario.freshnessInputs.requirementPaths],
      startingState: `save-retry ${suffix} starting state`,
      action: `save-retry ${suffix} action`,
      expected: `save-retry ${suffix} expected result`,
      evidencePathTemplates: evidenceKinds[index].map(
        (kind) => `assertions/{attemptId}/${suffix}-${kind}.private.json`,
      ),
    };
  });
  const scenario = {
    ...structuredClone(base.scenario),
    pilotAssertions: rows,
    pilotAssertionContract: {
      dataMode: 'postgres' as const,
      count: rows.length,
      sha256: sha256(rows),
    },
  };
  return {
    ...structuredClone(base),
    scenario,
    scenarioHash: sha256(scenario),
  };
}

function bindingFor(
  selection: NativePilotSelection,
  requestedRunId: string,
  captureRunId: string,
  backendRunId: string,
): NativeSaveRetryAttemptBinding {
  const assertionContract = requireNativeSaveRetryAssertionContract(selection);
  const platform = selection.arguments.platform;
  return {
    schemaVersion: 1,
    kind: 'private-native-save-retry-attempt-binding-not-public-receipt',
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    captureRunId,
    backendRunId,
    backendAttemptId: `${backendRunId}:first`,
    faultAttemptId: `native-save-${backendRunId}`,
    scenarioId: `SCN-save-retry-${platform}`,
    flowId: 'FLW-save-retry',
    selection: {
      scenarioHash: selection.scenarioHash,
      requirementHash: selection.requirementHash,
      arguments: selection.arguments,
    },
    assertionContract,
    fixtureScope: `native-entry-${platform}`,
    nativePassingCases: 0,
    scope:
      'requested-to-capture-to-fixture identity only; execution and public finalization are separate',
  };
}

async function privateArtifactRoot(prefix: string) {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  const artifactRoot = path.join(parent, 'b'.repeat(24));
  await mkdir(artifactRoot, { mode: 0o700 });
  return { parent, artifactRoot };
}

async function disposableRepositoryRoot() {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-save-binding-repo-')));
  const root = path.join(parent, 'repo');
  await mkdir(root, { mode: 0o700 });
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as {
    sources: { paths: string[] }[];
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
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(path.join(repositoryRoot, relative), target);
  }
  const inventoryPath = path.join(root, 'docs/qa/native-pilot/inventory.json');
  await mkdir(path.dirname(inventoryPath), { recursive: true, mode: 0o700 });
  await copyFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), inventoryPath);
  return { parent, root, inventory };
}

for (const platform of ['ios', 'android'] as const)
  void test(`${platform} save/retry binding requires the exact ordered ledger and distinct identities`, async () => {
    const selection = syntheticSelection(await declaredSelection(platform));
    const requestedRunId = 'a'.repeat(24);
    const captureRunId = 'b'.repeat(24);
    const backendRunId = 'c'.repeat(24);
    const binding = bindingFor(selection, requestedRunId, captureRunId, backendRunId);
    assert.deepEqual(
      requireNativeSaveRetryAttemptBinding(binding, {
        requestedRunId,
        captureRunId,
        backendRunId,
        selection,
      }),
      binding,
    );
    assert.equal(binding.requestedAttemptId, `${requestedRunId}:first`);
    assert.equal(binding.backendAttemptId, `${backendRunId}:first`);
    assert.equal(binding.faultAttemptId, `native-save-${backendRunId}`);
    assert.notEqual(binding.faultAttemptId, binding.backendRunId);
    assert.notEqual(binding.faultAttemptId, binding.requestedAttemptId);
    assert.deepEqual(binding.assertionContract.ids, nativeSaveRetryAssertionIds);
    assert.equal(binding.assertionContract.count, 5);
    assert.match(binding.assertionContract.sha256, /^[a-f0-9]{64}$/);
    assert.throws(
      () =>
        requireNativeSaveRetryAttemptBinding(binding, {
          requestedRunId,
          captureRunId,
          backendRunId: requestedRunId,
          selection,
        }),
      /Expected values|identity/,
    );

    const missing = structuredClone(selection);
    delete missing.scenario.pilotAssertions;
    delete missing.scenario.pilotAssertionContract;
    assert.throws(() => requireNativeSaveRetryAssertionContract(missing), /ledger/);

    const stale = structuredClone(selection);
    stale.scenarioHash = '0'.repeat(64);
    assert.throws(
      () =>
        requireNativeSaveRetryAttemptBinding(binding, {
          requestedRunId,
          captureRunId,
          backendRunId,
          selection: stale,
        }),
      /selection changed|contract|ledger/i,
    );

    const changedContract = structuredClone(selection);
    changedContract.scenario.pilotAssertionContract!.sha256 = '0'.repeat(64);
    assert.throws(() => requireNativeSaveRetryAssertionContract(changedContract), /contract/);

    const wrongPlatform = structuredClone(selection);
    wrongPlatform.arguments = {
      ...wrongPlatform.arguments,
      platform: platform === 'ios' ? 'android' : 'ios',
    };
    assert.throws(
      () =>
        requireNativeSaveRetryAttemptBinding(binding, {
          requestedRunId,
          captureRunId,
          backendRunId,
          selection: wrongPlatform,
        }),
      /arguments|scenario|platform/i,
    );

    for (const patch of [
      { requestedRunId: backendRunId },
      { captureRunId: requestedRunId },
      { backendRunId: requestedRunId },
      { requestedAttemptId: binding.backendAttemptId },
      { backendAttemptId: binding.requestedAttemptId },
      { faultAttemptId: binding.backendRunId },
      { scenarioId: `SCN-save-retry-${platform === 'ios' ? 'android' : 'ios'}` },
      { flowId: 'FLW-training' as const },
      { fixtureScope: `native-entry-${platform === 'ios' ? 'android' : 'ios'}` as const },
      { nativePassingCases: 1 as const },
      {
        assertionContract: {
          ...binding.assertionContract,
          ids: [...binding.assertionContract.ids].reverse(),
        },
      },
    ]) {
      assert.throws(() =>
        requireNativeSaveRetryAttemptBinding(
          { ...binding, ...patch },
          { requestedRunId, captureRunId, backendRunId, selection },
        ),
      );
    }
  });

void test('save/retry private binding read rejects noncanonical roots, symlinks and modes', async () => {
  const selection = await declaredSelection('ios');
  const requestedRunId = 'a'.repeat(24);
  const backendRunId = 'c'.repeat(24);
  const { parent, artifactRoot } = await privateArtifactRoot('mc-save-binding-read-');
  const binding = bindingFor(selection, requestedRunId, path.basename(artifactRoot), backendRunId);
  const bindingPath = path.join(artifactRoot, saveRetryAttemptBindingPath);
  const options = {
    repositoryRoot,
    artifactRoot,
    requestedRunId,
    backendRunId,
    selection,
  };
  const outside = path.join(parent, 'outside.private.json');
  try {
    await writeFile(bindingPath, JSON.stringify(binding), { mode: 0o600 });
    assert.deepEqual(await readNativeSaveRetryAttemptBinding(options), binding);

    const originalBytes = await readFile(bindingPath);
    const forgedSelection = structuredClone(selection);
    forgedSelection.requirementHash = '0'.repeat(64);
    const forgedBinding = {
      ...binding,
      selection: { ...binding.selection, requirementHash: forgedSelection.requirementHash },
    };
    await writeFile(bindingPath, JSON.stringify(forgedBinding));
    const forgedBytes = await readFile(bindingPath);
    await assert.rejects(
      readNativeSaveRetryAttemptBinding({ ...options, selection: forgedSelection }),
      /stale or altered|selection|requirement|governing/i,
    );
    assert.deepEqual(await readFile(bindingPath), forgedBytes);
    await writeFile(bindingPath, originalBytes);

    await chmod(artifactRoot, 0o755);
    await assert.rejects(readNativeSaveRetryAttemptBinding(options), /root|canonical|private/i);
    await chmod(artifactRoot, 0o700);
    await chmod(bindingPath, 0o644);
    await assert.rejects(readNativeSaveRetryAttemptBinding(options), /file|immutable|private/i);
    await chmod(bindingPath, 0o600);
    await writeFile(outside, JSON.stringify(binding), { mode: 0o600 });
    await rm(bindingPath);
    await symlink(outside, bindingPath);
    await assert.rejects(readNativeSaveRetryAttemptBinding(options), /symlink|escaped/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('save/retry reader validates declared family before opening private evidence', async () => {
  const inventory: unknown = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  );
  const selection = await selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-training-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
  const { parent, artifactRoot } = await privateArtifactRoot('mc-save-binding-wrong-family-');
  try {
    await assert.rejects(
      readNativeSaveRetryAttemptBinding({
        repositoryRoot,
        artifactRoot,
        requestedRunId: 'a'.repeat(24),
        backendRunId: 'c'.repeat(24),
        selection,
      }),
      /SCN-training-ios[\s\S]*SCN-save-retry-ios/,
    );
    assert.deepEqual(await readdir(artifactRoot), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('save/retry binding reader rejects current-source drift before accepting bytes', async () => {
  const selection = await declaredSelection('android');
  const requestedRunId = 'a'.repeat(24);
  const backendRunId = 'c'.repeat(24);
  const { parent: artifactParent, artifactRoot } = await privateArtifactRoot(
    'mc-save-binding-drift-artifact-',
  );
  const { parent: repositoryParent, root: disposableRoot } = await disposableRepositoryRoot();
  const binding = bindingFor(selection, requestedRunId, path.basename(artifactRoot), backendRunId);
  const bindingPath = path.join(artifactRoot, saveRetryAttemptBindingPath);
  try {
    await writeFile(bindingPath, JSON.stringify(binding), { mode: 0o600 });
    const requirementPath = selection.scenario.freshnessInputs.requirementPaths[0];
    const disposableRequirement = path.join(disposableRoot, requirementPath);
    await writeFile(
      disposableRequirement,
      `${await readFile(disposableRequirement, 'utf8')}\nsource drift fixture\n`,
    );
    const before = await readFile(bindingPath);
    await assert.rejects(
      readNativeSaveRetryAttemptBinding({
        repositoryRoot: disposableRoot,
        artifactRoot,
        requestedRunId,
        backendRunId,
        selection,
      }),
      /stale governing inputs|stale or altered|selection/i,
    );
    assert.deepEqual(await readFile(bindingPath), before);
  } finally {
    await Promise.all([
      rm(artifactParent, { recursive: true, force: true }),
      rm(repositoryParent, { recursive: true, force: true }),
    ]);
  }
});

for (const platform of ['ios', 'android'] as const)
  void test(`${platform} writer binds only the current generated selection and writes exclusively`, async () => {
    const current = await selectNativePilotScenario(
      {
        platform,
        engine: 'maestro',
        scenario: `SCN-save-retry-${platform}`,
        mode: 'integration',
      },
      JSON.parse(
        await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
      ),
      repositoryRoot,
    );
    const { parent, artifactRoot } = await privateArtifactRoot('mc-save-binding-write-');
    const options = {
      repositoryRoot,
      artifactRoot,
      requestedRunId: 'a'.repeat(24),
      backendRunId: 'c'.repeat(24),
      selection: current,
    };
    try {
      assert.equal(current.scenario.pilotAssertions?.length, 5);
      const stale = structuredClone(current);
      stale.requirementHash = '0'.repeat(64);
      const staleRoot = path.join(parent, 'd'.repeat(24));
      await mkdir(staleRoot, { mode: 0o700 });
      await assert.rejects(
        writeNativeSaveRetryAttemptBinding({
          ...options,
          artifactRoot: staleRoot,
          selection: stale,
        }),
        /stale or altered/,
      );
      assert.deepEqual(await readdir(staleRoot), []);

      const written = await writeNativeSaveRetryAttemptBinding(options);
      assert.equal(written.scenarioId, `SCN-save-retry-${platform}`);
      assert.equal(written.flowId, 'FLW-save-retry');
      assert.equal(written.nativePassingCases, 0);
      assert.deepEqual(await readNativeSaveRetryAttemptBinding(options), written);
      const saved = await readFile(path.join(artifactRoot, saveRetryAttemptBindingPath));
      const forgedSelection = structuredClone(current);
      forgedSelection.requirementHash = '0'.repeat(64);
      const forgedBinding = {
        ...written,
        selection: { ...written.selection, requirementHash: forgedSelection.requirementHash },
      };
      const bindingPath = path.join(artifactRoot, saveRetryAttemptBindingPath);
      await writeFile(bindingPath, JSON.stringify(forgedBinding));
      const forgedBytes = await readFile(bindingPath);
      await assert.rejects(
        readNativeSaveRetryAttemptBinding({ ...options, selection: forgedSelection }),
        /reader selection is stale or altered/,
      );
      assert.deepEqual(await readFile(bindingPath), forgedBytes);
      await writeFile(bindingPath, saved);
      await assert.rejects(writeNativeSaveRetryAttemptBinding(options), /EEXIST/);
      assert.deepEqual(await readFile(path.join(artifactRoot, saveRetryAttemptBindingPath)), saved);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

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
import {
  connectionAttemptBindingPath,
  readNativeConnectionAttemptBinding,
  requireNativeConnectionAttemptBinding,
  writeNativeConnectionAttemptBinding,
} from '../../scripts/testing/native-connection-attempt-binding';
import {
  nativeConnectionAssertionSemanticSha256,
  selectNativePilotScenario,
} from '../../scripts/testing/native-pilot-contract';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const repositoryRoot = path.resolve(__dirname, '../..');

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

type Inventory = {
  sources: { paths: string[]; revision: string }[];
  views: { ownerPaths?: string[] }[];
  transitions: { ownerPaths?: string[] }[];
  scenarios: {
    ownerPaths?: string[];
    maestroFlow?: string;
    freshnessInputs?: { requirementPaths?: string[] };
  }[];
};

async function disposableRepositoryRoot(): Promise<{
  parent: string;
  root: string;
}> {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-connection-binding-repo-')),
  );
  const root = path.join(parent, 'repo');
  await mkdir(root, { mode: 0o700 });
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as Inventory;
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
  const copiedInventory = structuredClone(inventory);
  for (const source of copiedInventory.sources)
    source.revision = sha256(await readFile(path.join(root, source.paths[0])));
  const inventoryPath = path.join(root, 'docs/qa/native-pilot/inventory.json');
  await mkdir(path.dirname(inventoryPath), { recursive: true, mode: 0o700 });
  await writeFile(inventoryPath, JSON.stringify(copiedInventory, null, 2) + '\n', { mode: 0o600 });
  return { parent, root };
}

async function selectionFor(
  root: string,
  platform: 'ios' | 'android',
  family: 'connection' | 'training' = 'connection',
): Promise<NativePilotSelection> {
  const inventory: unknown = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  );
  return selectNativePilotScenario(
    {
      platform,
      engine: 'maestro',
      scenario: `SCN-${family}-${platform}`,
      mode: 'integration',
    },
    inventory,
    root,
  );
}

async function privateArtifactRoot(parent: string, name: string): Promise<string> {
  const artifactRoot = path.join(parent, name);
  await mkdir(artifactRoot, { mode: 0o700 });
  return artifactRoot;
}

for (const platform of ['ios', 'android'] as const)
  void test(`${platform} connection binding preserves the first attempt and seven-row ledger`, async () => {
    const { parent: repositoryParent, root: disposableRoot } = await disposableRepositoryRoot();
    const artifactParent = await realpath(
      await mkdtemp(path.join(os.tmpdir(), `mc-connection-binding-${platform}-`)),
    );
    const artifactRoot = await privateArtifactRoot(artifactParent, 'b'.repeat(24));
    const staleRoot = await privateArtifactRoot(artifactParent, 'e'.repeat(24));
    const selection = await selectionFor(disposableRoot, platform);
    const options = {
      repositoryRoot: disposableRoot,
      artifactRoot,
      requestedRunId: 'a'.repeat(24),
      backendRunId: 'c'.repeat(24),
      selection,
    };
    try {
      const stale = structuredClone(selection);
      stale.requirementHash = '0'.repeat(64);
      await assert.rejects(
        writeNativeConnectionAttemptBinding({
          ...options,
          artifactRoot: staleRoot,
          selection: stale,
        }),
        /stale before first native action|stale|altered/i,
      );
      assert.deepEqual(await readdir(staleRoot), []);

      const binding = await writeNativeConnectionAttemptBinding(options);
      assert.equal(binding.requestedAttemptId, `${options.requestedRunId}:first`);
      assert.equal(binding.backendAttemptId, `${options.backendRunId}:first`);
      assert.equal(binding.captureRunId, path.basename(artifactRoot));
      assert.equal(binding.nativePassingCases, 0);
      assert.deepEqual(
        binding.assertionIds,
        selection.scenario.pilotAssertions?.map((row) => row.id),
      );
      assert.equal(binding.assertionSemanticSha256, nativeConnectionAssertionSemanticSha256);
      assert.match(binding.assertionContractSha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(await readNativeConnectionAttemptBinding(options), binding);

      for (const identityPatch of [
        { requestedRunId: binding.captureRunId },
        { captureRunId: binding.backendRunId },
        { backendRunId: binding.requestedRunId },
        { requestedRunId: 'g'.repeat(24) },
        { backendRunId: 'short' },
      ])
        assert.throws(
          () =>
            requireNativeConnectionAttemptBinding(binding, {
              requestedRunId: identityPatch.requestedRunId ?? options.requestedRunId,
              captureRunId: identityPatch.captureRunId ?? binding.captureRunId,
              backendRunId: identityPatch.backendRunId ?? options.backendRunId,
              selection,
            }),
          /identit|hex|24-character/i,
        );

      const saved = await readFile(path.join(artifactRoot, connectionAttemptBindingPath));
      await assert.rejects(writeNativeConnectionAttemptBinding(options), /EEXIST/);
      assert.deepEqual(
        await readFile(path.join(artifactRoot, connectionAttemptBindingPath)),
        saved,
      );

      const staleSelection = structuredClone(selection);
      staleSelection.requirementHash = '1'.repeat(64);
      await assert.rejects(
        readNativeConnectionAttemptBinding({ ...options, selection: staleSelection }),
        /stale or altered|governing/i,
      );

      for (const patch of [
        { requestedAttemptId: binding.backendAttemptId },
        { backendAttemptId: binding.requestedAttemptId },
        { captureRunId: binding.backendRunId },
        { assertionIds: [...binding.assertionIds].reverse() },
        { assertionSemanticSha256: '0'.repeat(64) },
        { assertionContractSha256: '0'.repeat(64) },
        { nativePassingCases: 1 },
        { extraField: 'unknown' },
      ]) {
        await writeFile(
          path.join(artifactRoot, connectionAttemptBindingPath),
          JSON.stringify({ ...binding, ...patch }),
          {
            mode: 0o600,
          },
        );
        await assert.rejects(
          readNativeConnectionAttemptBinding(options),
          /binding|digest|ledger|identity|assertion/i,
        );
        await writeFile(path.join(artifactRoot, connectionAttemptBindingPath), saved, {
          mode: 0o600,
        });
      }
    } finally {
      await Promise.all([
        rm(repositoryParent, { recursive: true, force: true }),
        rm(artifactParent, { recursive: true, force: true }),
      ]);
    }
  });

void test('connection binding reader enforces the private root, file mode, symlink and missing-file guards', async () => {
  const { parent: repositoryParent, root: disposableRoot } = await disposableRepositoryRoot();
  const artifactParent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-connection-binding-file-')),
  );
  const artifactRoot = await privateArtifactRoot(artifactParent, 'b'.repeat(24));
  const selection = await selectionFor(disposableRoot, 'ios');
  const options = {
    repositoryRoot: disposableRoot,
    artifactRoot,
    requestedRunId: 'a'.repeat(24),
    backendRunId: 'c'.repeat(24),
    selection,
  };
  const binding = await writeNativeConnectionAttemptBinding(options);
  const bindingPath = path.join(artifactRoot, connectionAttemptBindingPath);
  const outside = path.join(artifactParent, 'outside.private.json');
  try {
    await chmod(artifactRoot, 0o755);
    await assert.rejects(readNativeConnectionAttemptBinding(options), /root|private|owned/i);
    await chmod(artifactRoot, 0o700);

    await chmod(bindingPath, 0o644);
    await assert.rejects(readNativeConnectionAttemptBinding(options), /file|private|bounded/i);
    await chmod(bindingPath, 0o600);

    await writeFile(outside, JSON.stringify(binding), { mode: 0o600 });
    await rm(bindingPath);
    await symlink(outside, bindingPath);
    await assert.rejects(readNativeConnectionAttemptBinding(options), /symlink|escaped/i);
    await rm(bindingPath);
    await assert.rejects(readNativeConnectionAttemptBinding(options), /ENOENT|no such file/i);
  } finally {
    await Promise.all([
      rm(repositoryParent, { recursive: true, force: true }),
      rm(artifactParent, { recursive: true, force: true }),
    ]);
  }
});

void test('connection binding reader rejects source drift and wrong family before accepting private bytes', async () => {
  const { parent: repositoryParent, root: disposableRoot } = await disposableRepositoryRoot();
  const artifactParent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-connection-binding-drift-')),
  );
  const artifactRoot = await privateArtifactRoot(artifactParent, 'b'.repeat(24));
  const selection = await selectionFor(disposableRoot, 'android');
  const options = {
    repositoryRoot: disposableRoot,
    artifactRoot,
    requestedRunId: 'a'.repeat(24),
    backendRunId: 'c'.repeat(24),
    selection,
  };
  try {
    await writeNativeConnectionAttemptBinding(options);
    const training = await selectionFor(disposableRoot, 'android', 'training');
    const requirementPath = selection.scenario.freshnessInputs.requirementPaths[0];
    const requirementFile = path.join(disposableRoot, requirementPath);
    await writeFile(
      requirementFile,
      `${await readFile(requirementFile, 'utf8')}\nsource drift control\n`,
    );
    await assert.rejects(
      readNativeConnectionAttemptBinding(options),
      /stale or altered|governing/i,
    );

    await assert.rejects(
      readNativeConnectionAttemptBinding({ ...options, selection: training }),
      /FLW-connection|SCN-connection|assertion|scenario/i,
    );
  } finally {
    await Promise.all([
      rm(repositoryParent, { recursive: true, force: true }),
      rm(artifactParent, { recursive: true, force: true }),
    ]);
  }
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import {
  readNativeTrainingAttemptBinding,
  trainingAttemptBindingPath,
  writeNativeTrainingAttemptBinding,
} from '../../scripts/testing/native-training-attempt-binding';

for (const { engine, platform } of [
  { engine: 'maestro', platform: 'ios' },
  { engine: 'maestro', platform: 'android' },
] as const)
  void test(`${platform}/${engine} requested, capture and backend training identities stay distinct and tampering cannot silently rebind`, async () => {
    // Private preparation controls only. No native execution/public pass is implied.
    const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
    const selection = await selectNativePilotScenario(
      { platform, engine, scenario: `SCN-training-${platform}`, mode: 'integration' },
      JSON.parse(
        await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
      ),
      repositoryRoot,
    );
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-attempt-binding-')));
    const artifactRoot = path.join(temporary, 'b'.repeat(24));
    const staleRoot = path.join(temporary, 'e'.repeat(24));
    await mkdir(artifactRoot, { mode: 0o700 });
    await mkdir(staleRoot, { mode: 0o700 });
    const options = {
      repositoryRoot,
      artifactRoot,
      requestedRunId: 'a'.repeat(24),
      backendRunId: 'c'.repeat(24),
      selection,
    };
    try {
      const stale = structuredClone(selection);
      stale.requirementHash = '0'.repeat(64);
      await assert.rejects(
        writeNativeTrainingAttemptBinding({
          ...options,
          artifactRoot: staleRoot,
          selection: stale,
        }),
        /stale or altered/,
      );
      assert.deepEqual(await readdir(staleRoot), []);
      const written = await writeNativeTrainingAttemptBinding(options);
      assert.equal(written.requestedAttemptId, `${options.requestedRunId}:first`);
      assert.equal(written.backendAttemptId, `${options.backendRunId}:first`);
      assert.equal(written.captureRunId, path.basename(artifactRoot));
      assert.equal(written.nativePassingCases, 0);
      assert.equal(written.fixtureScope, `native-entry-${platform}`);
      assert.equal(written.scenarioId, `SCN-training-${platform}`);
      assert.equal(written.selection.arguments.engine, engine);
      assert.deepEqual(readNativeTrainingAttemptBinding(options), written);
      const saved = await readFile(path.join(artifactRoot, trainingAttemptBindingPath));
      await assert.rejects(writeNativeTrainingAttemptBinding(options), /EEXIST/);
      assert.deepEqual(await readFile(path.join(artifactRoot, trainingAttemptBindingPath)), saved);
      for (const changed of [
        { requestedRunId: 'd'.repeat(24) },
        { backendRunId: 'd'.repeat(24) },
        { artifactRoot: staleRoot },
      ])
        assert.throws(() => readNativeTrainingAttemptBinding({ ...options, ...changed }));
      for (const patch of [
        { backendAttemptId: `${'d'.repeat(24)}:first` },
        { requestedAttemptId: written.backendAttemptId },
        { captureRunId: written.backendRunId },
        { scenarioId: `SCN-training-${platform === 'ios' ? 'android' : 'ios'}` },
        { fixtureScope: `native-entry-${platform === 'ios' ? 'android' : 'ios'}` },
        { nativePassingCases: 1 },
        { selection: { ...written.selection, scenarioHash: '0'.repeat(64) } },
      ]) {
        await writeFile(
          path.join(artifactRoot, trainingAttemptBindingPath),
          JSON.stringify({ ...written, ...patch }),
          { mode: 0o600 },
        );
        assert.throws(() => readNativeTrainingAttemptBinding(options), /identity differs/);
      }
      for (const args of [
        {
          ...selection.arguments,
          platform: platform === 'ios' ? ('android' as const) : ('ios' as const),
        },
        { ...selection.arguments, mode: 'fixture' as const },
      ]) {
        const rejected = { ...selection, arguments: args };
        await assert.rejects(
          writeNativeTrainingAttemptBinding({
            ...options,
            artifactRoot: staleRoot,
            selection: rejected,
          }),
        );
        assert.deepEqual(await readdir(staleRoot), []);
      }
      for (const unsupportedEngine of ['webdriver', 'playwright'] as const) {
        const rejected = {
          ...selection,
          arguments: { ...selection.arguments, engine: unsupportedEngine as never },
        };
        await assert.rejects(
          writeNativeTrainingAttemptBinding({
            ...options,
            artifactRoot: staleRoot,
            selection: rejected,
          }),
          /Unsupported native pilot selection/,
        );
        assert.deepEqual(await readdir(staleRoot), []);
      }
      await assert.rejects(
        writeNativeTrainingAttemptBinding({ ...options, requestedRunId: options.backendRunId }),
        /Expected values/,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

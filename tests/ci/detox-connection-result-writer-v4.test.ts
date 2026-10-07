import assert from 'node:assert/strict';
import fsPromises, {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { acquireDetoxConnectionArtifactRoot } from '../../scripts/testing/detox-connection-artifact-root';
import { writeDetoxConnectionResult } from '../../scripts/testing/detox-connection-result-writer';
import type { BigIntStats, PathLike, Stats, StatOptions } from 'node:fs';

const runId = '0123456789abcdef01234567';

async function makeRoot(): Promise<{ parent: string; root: string }> {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-result-writer-v4-')));
  const artifacts = path.join(parent, '.qa', 'artifacts', 'native-pilot-attempts');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const root = path.join(artifacts, runId);
  await mkdir(root, { mode: 0o700 });
  return { parent, root };
}

void test('standalone result writer publishes descriptor-bound private bytes', async () => {
  const { parent, root } = await makeRoot();
  try {
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    const result = await writeDetoxConnectionResult({
      artifactRoot: root,
      expectedRootIdentity: lease.identity,
      result: { status: 'source-only', publicPromotionEligible: false },
      receivedSignals: [],
    });
    assert.equal(result, path.join(root, 'detox-connection-result.private.json'));
    const metadata = await stat(result);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.nlink, 1);
    const body = JSON.parse(await readFile(result, 'utf8')) as Record<string, unknown>;
    assert.equal(body.status, 'source-only');
    assert.equal(body.nativePassingCases, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('standalone result writer rejects a root replacement after driver completion', async () => {
  const { parent, root } = await makeRoot();
  const original = `${root}.original-retained`;
  let replaced = false;
  try {
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    const originalLstat: typeof fsPromises.lstat = fsPromises.lstat;
    function patchedLstat(
      file: PathLike,
      options?: StatOptions & { bigint?: false },
    ): Promise<Stats>;
    function patchedLstat(
      file: PathLike,
      options: StatOptions & { bigint: true },
    ): Promise<BigIntStats>;
    function patchedLstat(file: PathLike, options?: StatOptions): Promise<Stats | BigIntStats>;
    async function patchedLstat(
      file: PathLike,
      options?: StatOptions,
    ): Promise<Stats | BigIntStats> {
      const metadata = await originalLstat(file, options);
      if (!replaced && path.resolve(String(file)) === root) {
        replaced = true;
        await rename(root, original);
        await mkdir(root, { mode: 0o700 });
      }
      return metadata;
    }
    const mutableFsPromises = fsPromises as { lstat: typeof fsPromises.lstat };
    mutableFsPromises.lstat = patchedLstat;
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        writeDetoxConnectionResult({
          artifactRoot: root,
          expectedRootIdentity: lease.identity,
          result: { status: 'source-only' },
          receivedSignals: [],
        }),
      );
    } finally {
      mutableFsPromises.lstat = originalLstat;
      syncBuiltinESMExports();
    }
    assert.equal(replaced, true);
    await assert.rejects(lstat(path.join(root, 'detox-connection-result.private.json')));
    await assert.rejects(lstat(path.join(original, 'detox-connection-result.private.json')));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('standalone result writer rejects an expired caller deadline', async () => {
  const { parent, root } = await makeRoot();
  try {
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    await assert.rejects(
      writeDetoxConnectionResult({
        artifactRoot: root,
        expectedRootIdentity: lease.identity,
        result: { status: 'source-only' },
        receivedSignals: [],
        deadlineAt: performance.now() - 1,
      }),
    );
    await assert.rejects(lstat(path.join(root, 'detox-connection-result.private.json')));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

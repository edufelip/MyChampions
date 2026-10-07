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
  symlink,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { acquireDetoxConnectionArtifactRoot } from '../../scripts/testing/detox-connection-artifact-root';
import { ensureDetoxConnectionArtifactRoot } from '../../scripts/testing/detox-connection-evidence';
import type { BigIntStats, PathLike, Stats, StatOptions } from 'node:fs';

const runId = '0123456789abcdef01234567';

async function makeArtifactParent(): Promise<{
  parent: string;
  artifacts: string;
}> {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-root-preflight-')));
  const artifacts = path.join(parent, '.qa', 'artifacts', 'native-pilot-attempts');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  return { parent, artifacts: await realpath(artifacts) };
}

function rootPath(artifacts: string, suffix = runId): string {
  return path.join(artifacts, suffix);
}

void test('the owning caller precreates a private root before the verification-only writer', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  try {
    const root = rootPath(artifacts);
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    assert.equal(lease.createdByCaller, true);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    await ensureDetoxConnectionArtifactRoot(root);
    await assert.rejects(
      ensureDetoxConnectionArtifactRoot(rootPath(artifacts, 'fedcba987654321001234567')),
      /pre-created|artifact root/i,
    );
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'test preflight completion',
    });
    assert.equal(cleanup.status, 'retained');
    assert.equal(cleanup.ownership, 'caller-bound');
    assert.equal(await realpath(root), root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('an outer-owned precreated root is adopted and never removed by the Detox caller', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  try {
    const root = rootPath(artifacts);
    await mkdir(root, { mode: 0o700 });
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    assert.equal(lease.createdByCaller, false);
    assert.equal(lease.ownership, 'outer-ownership-unknown');
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'outer preflight rejected',
    });
    assert.equal(cleanup.status, 'unknown');
    assert.equal(cleanup.ownership, 'outer-ownership-unknown');
    assert.equal(await realpath(root), root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('an abort before acquisition leaves no newly created artifact root', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  try {
    const controller = new AbortController();
    controller.abort(new Error('test cancellation'));
    await assert.rejects(
      acquireDetoxConnectionArtifactRoot({
        root: rootPath(artifacts),
        signal: controller.signal,
      }),
      /cancel/i,
    );
    await assert.rejects(() => realpath(rootPath(artifacts)), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('an expired acquisition deadline is rejected before creating an artifact root', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  try {
    const root = rootPath(artifacts);
    await assert.rejects(
      acquireDetoxConnectionArtifactRoot({
        root,
        deadlineAt: performance.now() - 1,
      }),
      /deadline/i,
    );
    await assert.rejects(lstat(root), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('failed preflight retains nonempty owned evidence and publishes a bounded recovery record', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  try {
    const root = rootPath(artifacts);
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    await writeFile(path.join(root, 'selection.private.json'), '{}\n', {
      mode: 0o600,
    });
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'build read failed',
    });
    assert.equal(cleanup.status, 'retained');
    const recoveryEvidence = await lease.retainRecoveryEvidence(cleanup, 'build read failed');
    assert(recoveryEvidence);
    const recoveryPath = recoveryEvidence.path;
    assert.equal((await stat(recoveryPath)).mode & 0o777, 0o600);
    assert.match(recoveryEvidence.sha256, /^[a-f0-9]{64}$/);
    assert.equal(recoveryEvidence.writer.reaped, true);
    const recovery = JSON.parse(await readFile(recoveryPath, 'utf8')) as Record<string, unknown>;
    assert.equal(
      recovery.kind,
      'private-detox-connection-artifact-root-preflight-recovery-not-public-receipt',
    );
    assert.equal(recovery.createdByCaller, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('recovery publication rejects a root replacement after the identity precheck', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  const root = rootPath(artifacts);
  const original = `${root}.original-retained`;
  const originalLstat: typeof fsPromises.lstat = fsPromises.lstat;
  let armed = false;
  let replaced = false;
  try {
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'replacement race',
    });
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
      if (armed && !replaced && path.resolve(String(file)) === root) {
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
      armed = true;
      const recovery = await lease.retainRecoveryEvidence(cleanup, 'replacement race');
      assert.equal(recovery, null);
    } finally {
      mutableFsPromises.lstat = originalLstat;
      syncBuiltinESMExports();
    }
    assert.equal(replaced, true);
    await assert.rejects(lstat(path.join(root, 'detox-connection-root-recovery.private.json')));
    await assert.rejects(lstat(path.join(original, 'detox-connection-root-recovery.private.json')));
    assert.equal((await stat(original)).isDirectory(), true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('aborted recovery publication returns unavailable without starting a writer', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  try {
    const root = rootPath(artifacts);
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    const controller = new AbortController();
    controller.abort(new Error('recovery cancellation'));
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'recovery cancellation',
      signal: controller.signal,
    });
    const recovery = await lease.retainRecoveryEvidence(cleanup, 'recovery cancellation', {
      signal: controller.signal,
    });
    assert.equal(recovery, null);
    await assert.rejects(lstat(path.join(root, 'detox-connection-root-recovery.private.json')));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('an expired recovery deadline returns unavailable before writer publication', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  try {
    const root = rootPath(artifacts);
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'recovery deadline',
    });
    const recovery = await lease.retainRecoveryEvidence(cleanup, 'recovery deadline', {
      deadlineAt: performance.now() - 1,
    });
    assert.equal(recovery, null);
    await assert.rejects(lstat(path.join(root, 'detox-connection-root-recovery.private.json')));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('replacement of a caller-owned root is unknown and never deleted', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  try {
    const root = rootPath(artifacts);
    const lease = await acquireDetoxConnectionArtifactRoot({ root });
    const original = `${root}.original-retained`;
    await rename(root, original);
    await mkdir(root, { mode: 0o700 });
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'late cancellation',
    });
    assert.equal(cleanup.status, 'unknown');
    assert.equal(await realpath(root), root);
    assert.equal((await lstat(original)).isDirectory(), true);
    assert.equal(await lease.retainRecovery(cleanup, 'late cancellation'), null);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('descriptor-anchored creation does not write through a parent replaced before mkdirat', async () => {
  const { parent, artifacts } = await makeArtifactParent();
  const movedParent = `${artifacts}.original-retained`;
  const outside = path.join(parent, 'outside-parent-replacement');
  try {
    const root = rootPath(artifacts);
    await mkdir(outside, { mode: 0o700 });
    let beforeCreateResolve: (() => void) | undefined;
    const beforeCreate = new Promise<void>((resolve) => {
      beforeCreateResolve = resolve;
    });
    const acquisition = acquireDetoxConnectionArtifactRoot({
      root,
      testWorkerDelayBeforeCreateMs: 200,
      testBeforeCreate: () => beforeCreateResolve?.(),
    });
    await beforeCreate;
    await rename(artifacts, movedParent);
    await symlink(outside, artifacts, 'dir');
    let failure: unknown;
    try {
      await acquisition;
      assert.fail('descriptor-anchored acquisition unexpectedly succeeded');
    } catch (error) {
      failure = error;
    }
    assert.match(
      String(failure),
      /preflight failed|cleanup is unknown|anchored directory open|not a directory/i,
    );
    assert.match(
      String((failure as Error).cause ?? failure),
      /identity|namespace|directory|not a directory/i,
    );
    await assert.rejects(lstat(path.join(outside, runId)));
    await assert.rejects(lstat(path.join(movedParent, runId)), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('both checked-in callers acquire the root before private build/input reads', async () => {
  const standalone = await readFile('scripts/run-detox-integrated-connection-baseline.ts', 'utf8');
  const publicDispatch = await readFile(
    'scripts/testing/native-detox-connection-public-dispatch.ts',
    'utf8',
  );
  assert(
    standalone.indexOf('acquireDetoxConnectionArtifactRoot') <
      standalone.indexOf('readPrivateJson<NativePilotSelection>'),
  );
  assert(
    publicDispatch.indexOf('acquireDetoxConnectionArtifactRoot') <
      publicDispatch.indexOf('loadIosDetoxQualifiedBuild'),
  );
  assert.match(standalone, /writeDetoxConnectionResult/);
  assert.doesNotMatch(standalone, /\b(?:chmod|writeFile)\s*\(/);
  assert.match(
    publicDispatch,
    /acquireDetoxConnectionArtifactRoot\(\{[\s\S]*deadlineAt: lifecycle\.deadlineAtMonotonicMs/,
  );
  assert(
    standalone.indexOf('signal: signalController.signal') <
      standalone.indexOf('artifactLease.markTransferred()'),
  );
  assert(
    publicDispatch.indexOf('signal: lifecycle.signal') <
      publicDispatch.indexOf('artifactLease.markTransferred()'),
  );
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  __setDetoxConnectionEvidenceSpawnForTests,
  DetoxConnectionEvidenceRecoveryError,
  ensureDetoxConnectionArtifactRoot,
  removeOwnedDetoxConnectionFile,
  writeAtomicDetoxConnectionBytes,
} from '../../scripts/testing/detox-connection-evidence';

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dxa-wire-v8-'));
  const canonicalParent = await realpath(parent);
  const root = path.join(canonicalParent, 'root');
  const outside = path.join(canonicalParent, 'outside');
  await mkdir(root, { mode: 0o700 });
  await mkdir(outside, { mode: 0o700 });
  await chmod(root, 0o700);
  await chmod(outside, 0o700);
  await ensureDetoxConnectionArtifactRoot(root);
  return { parent, root, outside };
}

async function closeFixture(parent: string) {
  await rm(parent, { recursive: true, force: true });
}

function isRecovery(error: unknown): boolean {
  return error instanceof DetoxConnectionEvidenceRecoveryError || error instanceof AggregateError;
}

function writerDetails(error: unknown): Record<string, unknown> {
  assert(error instanceof DetoxConnectionEvidenceRecoveryError);
  return error.details;
}

const bytes = Buffer.from('{"owned":true}\n');

void test('missing nested root under a replaced ancestor fails closed without path mutation', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dxa-wire-v10-root-'));
  const outside = path.join(parent, 'outside');
  const replacedAncestor = path.join(parent, 'artifact-parent');
  const root = path.join(replacedAncestor, 'nested', 'root');
  try {
    await mkdir(outside, { mode: 0o700 });
    await symlink(outside, replacedAncestor);
    await assert.rejects(ensureDetoxConnectionArtifactRoot(root), (error: unknown) => {
      assert(error instanceof DetoxConnectionEvidenceRecoveryError);
      assert.equal(error.details.status, 'root-not-created');
      assert.equal(error.details.recovery, 'creation-disabled-no-path-mutation');
      return true;
    });
    await assert.rejects(
      readFile(path.join(root, 'sentinel.private.json')),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('public writer uses the sidecar path and returns bounded child/source receipts', async () => {
  const { parent, root } = await fixture();
  try {
    const result = await writeAtomicDetoxConnectionBytes(root, 'normal.private.json', bytes, 1024);
    assert.deepEqual(result.bytes, bytes);
    assert.equal(result.metadata.nlink, 1);
    assert(result.writer);
    assert.equal(result.writer.reaped, true);
    assert.equal(result.writer.killed, false);
    assert.equal(result.writer.exitCode, 0);
    assert.equal(result.writer.pgid, result.writer.pid);
    assert.match(result.writer.startIdentity, new RegExp(`^${result.writer.pid}:`));
    assert.match(result.writer.sourcePin.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readdir(root), ['normal.private.json']);
  } finally {
    await closeFixture(parent);
  }
});

void test('final rollback retains the owned inode and never performs a conditional delete', async () => {
  const { parent, root } = await fixture();
  try {
    const publication = await writeAtomicDetoxConnectionBytes(
      root,
      'retained-final.private.json',
      bytes,
      1024,
    );
    assert.equal(
      await removeOwnedDetoxConnectionFile(
        root,
        'retained-final.private.json',
        publication.metadata,
      ),
      'retained',
    );
    assert.deepEqual(await readFile(path.join(root, 'retained-final.private.json')), bytes);

    await rm(path.join(root, 'retained-final.private.json'));
    await writeFile(path.join(root, 'retained-final.private.json'), bytes, { mode: 0o600 });
    await assert.rejects(
      removeOwnedDetoxConnectionFile(root, 'retained-final.private.json', publication.metadata),
      (error: unknown) => {
        assert(error instanceof DetoxConnectionEvidenceRecoveryError);
        assert.equal(error.details.status, 'retained');
        assert.equal(error.details.recovery, 'retention-only-no-conditional-unlink');
        return true;
      },
    );
    assert.deepEqual(await readFile(path.join(root, 'retained-final.private.json')), bytes);
  } finally {
    await closeFixture(parent);
  }
});

void test('spawn ENOENT is reported with a reaped child failure receipt', async () => {
  const { parent, root } = await fixture();
  const restoreSpawn = __setDetoxConnectionEvidenceSpawnForTests(() =>
    spawn('/definitely-missing-dxa-python', []),
  );
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, 'spawn-error.private.json', bytes, 1024),
      (error: unknown) => {
        assert(error instanceof DetoxConnectionEvidenceRecoveryError);
        const writer = error.details.writer as Record<string, unknown>;
        assert.equal(writer.reaped, true);
        assert.match(String(writer.spawnError), /ENOENT|no such file/i);
        return true;
      },
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    restoreSpawn();
    await closeFixture(parent);
  }
});

void test('no-replace publication preserves the competing inode and retains owned recovery', async () => {
  const { parent, root } = await fixture();
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, 'no-replace.private.json', bytes, 1024, {
        beforePublish: async ({ final }) => {
          await writeFile(final, Buffer.from('{"foreign":true}\n'), { flag: 'wx', mode: 0o600 });
        },
      }),
      (error: unknown) => {
        assert(isRecovery(error));
        const protocol = writerDetails(error).protocol as Record<string, unknown>[];
        const errorMessage = protocol.find((row) => row.type === 'error');
        const cleanup = errorMessage?.cleanup as Record<string, unknown>[];
        const temporary = cleanup.find((row) => row.target === 'temporary');
        const result = temporary?.result as Record<string, unknown> | undefined;
        assert.equal(result?.status, 'retained');
        assert.equal(typeof result?.recoveryName, 'string');
        return true;
      },
    );
    assert.equal(
      (await readFile(path.join(root, 'no-replace.private.json'))).toString(),
      '{"foreign":true}\n',
    );
    const names = await readdir(root);
    assert.equal(names.filter((name) => name.includes('.tmp-')).length, 0);
    assert.equal(names.filter((name) => name.startsWith('.recovery-')).length, 1);
  } finally {
    await closeFixture(parent);
  }
});

void test('ancestor replacement fails closed without mutating the outside directory', async () => {
  const { parent, root, outside } = await fixture();
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, 'ancestor-race.private.json', bytes, 1024, {
        afterDirectoryOpen: async () => {
          await rename(root, `${root}.original`);
          await symlink(outside, root);
        },
      }),
      (error: unknown) => {
        assert(isRecovery(error));
        const details = writerDetails(error);
        const writer = details.writer as Record<string, unknown>;
        assert.equal(writer.reaped, true);
        return true;
      },
    );
    assert.deepEqual(await readdir(outside), []);
    assert.equal((await (await import('node:fs/promises')).lstat(root)).isSymbolicLink(), true);
    assert((await readdir(`${root}.original`)).every((name) => name.startsWith('.recovery-')));
  } finally {
    await rm(root, { force: true });
    await rm(`${root}.original`, { recursive: true, force: true });
    await closeFixture(parent);
  }
});

void test('active AbortSignal terminates a sidecar blocked in a caller boundary and records reap facts', async () => {
  const { parent, root } = await fixture();
  const controller = new AbortController();
  try {
    const pending = writeAtomicDetoxConnectionBytes(root, 'abort.private.json', bytes, 1024, {
      afterDirectoryOpen: () => new Promise<void>(() => undefined),
      signal: controller.signal,
      deadlineAt: Number.POSITIVE_INFINITY,
    });
    setTimeout(() => controller.abort(new Error('fixture abort')), 75);
    const started = Date.now();
    await assert.rejects(pending, (error: unknown) => {
      assert(isRecovery(error));
      const details = writerDetails(error);
      const writer = details.writer as Record<string, unknown>;
      assert.equal(writer.killed, true);
      assert.equal(writer.reaped, true);
      assert.equal(writer.timedOut, false);
      assert(Date.now() - started < 3_000);
      return true;
    });
    assert.deepEqual(await readdir(root), []);
  } finally {
    await closeFixture(parent);
  }
});

void test('deadline watchdog terminates a blocked caller boundary and marks timeout', async () => {
  const { parent, root } = await fixture();
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, 'deadline.private.json', bytes, 1024, {
        afterDirectoryOpen: () => new Promise<void>(() => undefined),
        deadlineAt: performance.now() + 75,
      }),
      (error: unknown) => {
        assert(isRecovery(error));
        const writer = writerDetails(error).writer as Record<string, unknown>;
        assert.equal(writer.killed, true);
        assert.equal(writer.timedOut, true);
        assert.equal(writer.reaped, true);
        return true;
      },
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await closeFixture(parent);
  }
});

void test('equal-byte final replacement is rejected by sidecar identity binding', async () => {
  const { parent, root } = await fixture();
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, 'same-byte-replacement.private.json', bytes, 1024, {
        afterPublish: async ({ final }) => {
          await rm(final);
          await writeFile(final, bytes, { flag: 'wx', mode: 0o600 });
        },
      }),
      (error: unknown) => {
        assert(isRecovery(error));
        const protocol = writerDetails(error).protocol as Record<string, unknown>[];
        assert(protocol.some((entry) => entry.type === 'published'));
        return true;
      },
    );
    assert.deepEqual(await readFile(path.join(root, 'same-byte-replacement.private.json')), bytes);
  } finally {
    await closeFixture(parent);
  }
});

void test('hardlink publication window retains both links as actionable ownership recovery', async () => {
  const { parent, root } = await fixture();
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, 'hardlink-window.private.json', bytes, 1024, {
        afterPublish: async ({ final }) => {
          await link(final, `${final}.foreign-link`);
        },
      }),
      isRecovery,
    );
    assert.equal(
      (await readFile(path.join(root, 'hardlink-window.private.json'))).toString(),
      bytes.toString(),
    );
    assert.equal(
      (
        await (
          await import('node:fs/promises')
        ).lstat(`${path.join(root, 'hardlink-window.private.json')}.foreign-link`)
      ).nlink,
      2,
    );
  } finally {
    await closeFixture(parent);
  }
});

void test('replacement after quarantine validation is retained instead of being unlinked', async () => {
  const { parent, root } = await fixture();
  let replaced = false;
  let recoveryPath = '';
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, 'quarantine-race.private.json', bytes, 1024, {
        afterPublish: async () => {
          // Force the sidecar's post-publication root fence to fail while the
          // final inode remains singly linked, so the bounded recovery hook is
          // exercised without making the hook itself race the root path.
          await chmod(root, 0o755);
        },
        beforeRecoveryUnlink: async ({ recovery }) => {
          if (replaced) return;
          replaced = true;
          recoveryPath = recovery;
          await rm(recovery);
          await writeFile(recovery, Buffer.from('foreign-recovery\n'), { flag: 'wx', mode: 0o600 });
        },
      }),
      isRecovery,
    );
    assert.equal((await readFile(recoveryPath)).toString(), 'foreign-recovery\n');
    assert.equal(
      await readFile(path.join(root, 'quarantine-race.private.json')).then(
        () => false,
        () => true,
      ),
      true,
    );
  } finally {
    await chmod(root, 0o700).catch(() => undefined);
    await closeFixture(parent);
  }
});

void test('late outer root replacement triggers bounded sidecar recovery through the original descriptor', async () => {
  const { parent, root, outside } = await fixture();
  let published = false;
  let replaced = false;
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, 'late-root.private.json', bytes, 1024, {
        afterPublish: () => {
          published = true;
        },
        checkLive: async () => {
          if (!published || replaced) return;
          replaced = true;
          await rename(root, `${root}.original`);
          await symlink(outside, root);
        },
      }),
      isRecovery,
    );
    assert.deepEqual(await readdir(outside), []);
    assert((await readdir(`${root}.original`)).every((name) => name.startsWith('.recovery-')));
  } finally {
    await rm(root, { force: true });
    await rm(`${root}.original`, { recursive: true, force: true });
    await closeFixture(parent);
  }
});

void test('payload and protocol bounds accept the existing 16 MiB declaration but cap actual payloads', async () => {
  const { parent, root } = await fixture();
  try {
    const declaredFrameLimit = await writeAtomicDetoxConnectionBytes(
      root,
      'declared-frame-limit.private.json',
      bytes,
      16 * 1024 * 1024,
    );
    assert.deepEqual(declaredFrameLimit.bytes, bytes);
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(
        root,
        'oversize-payload.private.json',
        Buffer.alloc(8 * 1024 * 1024 + 1),
        16 * 1024 * 1024,
      ),
      /empty or exceeds|bound/i,
    );
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(
        root,
        'oversize-declaration.private.json',
        bytes,
        16 * 1024 * 1024 + 1,
      ),
      /empty or exceeds|bound/i,
    );
    assert.deepEqual(await readdir(root), ['declared-frame-limit.private.json']);
  } finally {
    await closeFixture(parent);
  }
});

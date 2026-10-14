import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  repositoryIdentity,
  type RepositoryIdentityReadHooks,
} from '../../scripts/testing/testing-repository-identity';

const execute = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute('git', ['-C', root, ...args], { maxBuffer: 2 * 1024 * 1024 })).stdout;
}

async function commitFixture(root: string): Promise<void> {
  await git(root, 'init', '-q');
  await writeFile(path.join(root, 'tracked.txt'), 'baseline');
  await git(root, 'add', 'tracked.txt');
  await git(
    root,
    '-c',
    'user.name=Testing fixture',
    '-c',
    'user.email=testing@example.invalid',
    'commit',
    '-q',
    '-m',
    'test fixture',
  );
}

async function addIndexEntry(root: string, entry: string): Promise<void> {
  const blob = path.join(root, `${entry.replace(/[^A-Za-z0-9]/g, '-')}.blob`);
  await writeFile(blob, `index:${entry}`);
  const blobSha = (await git(root, 'hash-object', '-w', blob)).trim();
  await git(root, 'update-index', '--add', '--cacheinfo', `100644,${blobSha},${entry}`);
  await unlink(blob);
}

void test('distinguishes a same-status regular file from a symlink with colliding v3 framing and restores the symlink identity', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-repository-identity-kind-collision-')),
  );
  try {
    await chmod(root, 0o700);
    await commitFixture(root);
    const collisionPath = path.join(root, 'collision-entry');
    const linkTarget = 'foreign-target';
    await symlink(linkTarget, collisionPath);
    const symlinkStatus = (await git(root, 'status', '--porcelain')).trimEnd();
    const symlinkIdentity = await repositoryIdentity(root, 'fixture');

    await unlink(collisionPath);
    await writeFile(
      collisionPath,
      Buffer.concat([Buffer.from('entry:symlink\0'), Buffer.from(linkTarget)]),
    );
    const regularStatus = (await git(root, 'status', '--porcelain')).trimEnd();
    const regularIdentity = await repositoryIdentity(root, 'fixture');
    assert.equal(regularStatus, symlinkStatus);
    assert.notEqual(
      regularIdentity.workingTreeHash,
      symlinkIdentity.workingTreeHash,
      'entry kind must remain part of the identity even when legacy raw framing collides',
    );

    await unlink(collisionPath);
    await symlink(linkTarget, collisionPath);
    const restored = await repositoryIdentity(root, 'fixture');
    assert.equal(restored.workingTreeHash, symlinkIdentity.workingTreeHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('frames each regular file independently against same-status delimiter redistribution', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-repository-identity-delimiter-collision-')),
  );
  try {
    await chmod(root, 0o700);
    await commitFixture(root);
    const originalA = Buffer.from('A\0b\0C');
    const originalB = Buffer.from('D');
    await writeFile(path.join(root, 'a'), originalA);
    await writeFile(path.join(root, 'b'), originalB);
    const originalStatus = (await git(root, 'status', '--porcelain')).trimEnd();
    const original = await repositoryIdentity(root, 'fixture');

    await writeFile(path.join(root, 'a'), Buffer.from('A'));
    await writeFile(path.join(root, 'b'), Buffer.from('C\0b\0D'));
    const redistributedStatus = (await git(root, 'status', '--porcelain')).trimEnd();
    const redistributed = await repositoryIdentity(root, 'fixture');
    assert.equal(redistributedStatus, originalStatus);
    assert.notEqual(
      redistributed.workingTreeHash,
      original.workingTreeHash,
      'content must not move across two unchanged path delimiters without changing identity',
    );

    await writeFile(path.join(root, 'a'), originalA);
    await writeFile(path.join(root, 'b'), originalB);
    const restored = await repositoryIdentity(root, 'fixture');
    assert.equal(restored.workingTreeHash, original.workingTreeHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('fingerprints regular, deleted, directory, dangling and external symlink entries without dereferencing', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-repository-identity-')));
  const foreign = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-repository-identity-foreign-')),
  );
  try {
    await chmod(root, 0o700);
    await chmod(foreign, 0o700);
    await commitFixture(root);

    const clean = await repositoryIdentity(root, 'fixture');
    const repeat = await repositoryIdentity(root, 'fixture');
    assert.equal(repeat.workingTreeHash, clean.workingTreeHash);

    await writeFile(path.join(root, 'tracked.txt'), 'changed');
    const changed = await repositoryIdentity(root, 'fixture');
    assert.notEqual(changed.workingTreeHash, clean.workingTreeHash);
    await unlink(path.join(root, 'tracked.txt'));
    const deleted = await repositoryIdentity(root, 'fixture');
    const deletedRepeat = await repositoryIdentity(root, 'fixture');
    assert.notEqual(deleted.workingTreeHash, changed.workingTreeHash);
    assert.equal(deletedRepeat.workingTreeHash, deleted.workingTreeHash);

    const foreignFile = path.join(foreign, 'foreign.txt');
    const foreignFileChanged = path.join(foreign, 'foreign-changed.txt');
    const foreignDirectory = path.join(foreign, 'foreign-directory');
    await writeFile(foreignFile, 'foreign-a');
    await writeFile(foreignFileChanged, 'foreign-b');
    await mkdir(foreignDirectory);
    await symlink(foreignFile, path.join(root, 'external-file-link'));
    await symlink(foreignDirectory, path.join(root, 'external-directory-link'));
    await symlink(path.join(foreign, 'does-not-exist'), path.join(root, 'dangling-link'));
    await git(root, 'add', 'external-file-link', 'external-directory-link', 'dangling-link');

    const linksBefore = await repositoryIdentity(root, 'fixture');
    await writeFile(foreignFile, 'foreign-a-mutated');
    const linksAfterForeignMutation = await repositoryIdentity(root, 'fixture');
    assert.equal(
      linksAfterForeignMutation.workingTreeHash,
      linksBefore.workingTreeHash,
      'foreign target bytes must not be read through a symlink',
    );
    await unlink(path.join(root, 'external-file-link'));
    await symlink(foreignFileChanged, path.join(root, 'external-file-link'));
    await git(root, 'add', 'external-file-link');
    const linksAfterTargetChange = await repositoryIdentity(root, 'fixture');
    assert.notEqual(
      linksAfterTargetChange.workingTreeHash,
      linksAfterForeignMutation.workingTreeHash,
    );

    await mkdir(path.join(root, 'listed-directory'));
    await addIndexEntry(root, 'listed-directory');
    await execute('mkfifo', [path.join(root, 'listed-fifo')]);
    await addIndexEntry(root, 'listed-fifo');
    const special = await repositoryIdentity(root, 'fixture');
    assert.match(special.workingTreeHash, /^[a-f0-9]{64}$/);
    const specialRepeat = await repositoryIdentity(root, 'fixture');
    assert.equal(specialRepeat.workingTreeHash, special.workingTreeHash);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(foreign, { recursive: true, force: true });
  }
});

void test('fails closed on regular-file descriptor and symlink readlink races', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-repository-identity-race-')),
  );
  const foreign = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-repository-identity-race-foreign-')),
  );
  try {
    await chmod(root, 0o700);
    await chmod(foreign, 0o700);
    await commitFixture(root);
    const foreignFile = path.join(foreign, 'foreign.txt');
    const foreignFileChanged = path.join(foreign, 'foreign-changed.txt');
    await writeFile(foreignFile, 'foreign-a');
    await writeFile(foreignFileChanged, 'foreign-b');

    const beforeOpen: RepositoryIdentityReadHooks = {
      beforeOpen: async (file) => {
        if (file !== 'tracked.txt') return;
        await unlink(path.join(root, file));
        await symlink(foreignFile, path.join(root, file));
      },
    };
    await assert.rejects(
      repositoryIdentity(root, 'fixture', beforeOpen),
      /no-follow|ELOOP|changed/i,
    );

    const racyFile = path.join(root, 'racy.txt');
    await writeFile(racyFile, Buffer.alloc(128 * 1024, 0x61));
    await git(root, 'add', 'racy.txt');
    await unlink(path.join(root, 'tracked.txt'));
    await writeFile(path.join(root, 'tracked.txt'), 'baseline');
    const afterFirstRead: RepositoryIdentityReadHooks = {
      afterFirstRead: async (file) => {
        if (file !== 'racy.txt') return;
        await unlink(racyFile);
        await symlink(foreignFile, racyFile);
      },
    };
    await assert.rejects(
      repositoryIdentity(root, 'fixture', afterFirstRead),
      /changed while reading|changed before descriptor/i,
    );

    const racedLink = path.join(root, 'raced-link');
    await symlink(foreignFile, racedLink);
    await git(root, 'add', 'raced-link');
    const afterReadlink: RepositoryIdentityReadHooks = {
      afterReadlink: async (file) => {
        if (file !== 'raced-link') return;
        await unlink(racedLink);
        await symlink(foreignFileChanged, racedLink);
      },
    };
    await assert.rejects(
      repositoryIdentity(root, 'fixture', afterReadlink),
      /symlink changed while reading/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(foreign, { recursive: true, force: true });
  }
});

void test('retains an identity hash for a symlinked directory entry rather than raising EISDIR', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-repository-identity-symlink-dir-')),
  );
  const foreign = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-repository-identity-symlink-dir-foreign-')),
  );
  try {
    await commitFixture(root);
    await mkdir(path.join(foreign, 'nested'));
    await symlink(foreign, path.join(root, 'localization-link'));
    await git(root, 'add', 'localization-link');
    const identity = await repositoryIdentity(root, 'fixture');
    assert.match(identity.workingTreeHash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(foreign, { recursive: true, force: true });
  }
});

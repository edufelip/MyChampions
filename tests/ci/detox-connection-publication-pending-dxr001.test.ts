import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  isDetoxConnectionPublicationPending,
  writeAtomicDetoxConnectionBytes,
} from '../../scripts/testing/detox-connection-evidence';

const name = 'detox-connection-dxr001.private.json';
const payload = Buffer.from('{"kind":"dxr001"}\n');

void test('DXR-001 keeps publication pending through the blocked published hook', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-dxr001-pending-')));
  await chmod(root, 0o700);
  let release: (() => void) | undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opened = false;
  let tempReady = false;
  let entered = false;
  const publication = writeAtomicDetoxConnectionBytes(root, name, payload, 64 * 1024, {
    afterDirectoryOpen: async () => {
      opened = true;
      assert.equal(await isDetoxConnectionPublicationPending(root, name), true);
    },
    beforePublish: async () => {
      tempReady = true;
      assert.equal(await isDetoxConnectionPublicationPending(root, name), true);
    },
    afterPublish: async () => {
      entered = true;
      assert.equal(await isDetoxConnectionPublicationPending(root, name), true);
      await released;
    },
  });
  try {
    for (let attempt = 0; !entered && attempt < 200; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(opened, true);
    assert.equal(tempReady, true);
    assert.equal(entered, true);
    release?.();
    await publication;
    assert.equal(await isDetoxConnectionPublicationPending(root, name), false);
  } finally {
    release?.();
    await Promise.allSettled([publication]);
    await rm(root, { recursive: true, force: true });
  }
});

void test('DXR-001 does not classify an ordinary nlink-one file as pending', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-dxr001-ordinary-')));
  await chmod(root, 0o700);
  try {
    await writeFile(path.join(root, name), payload, { mode: 0o600 });
    assert.equal(await isDetoxConnectionPublicationPending(root, name), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('DXR-001 clears pending state after a published-hook failure', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-dxr001-failure-')));
  await chmod(root, 0o700);
  const publication = writeAtomicDetoxConnectionBytes(root, name, payload, 64 * 1024, {
    afterPublish: async () => {
      assert.equal(await isDetoxConnectionPublicationPending(root, name), true);
      throw new Error('DXR-001 controlled hook failure');
    },
  });
  try {
    await assert.rejects(publication, /publication failed/i);
    assert.equal(await isDetoxConnectionPublicationPending(root, name), false);
  } finally {
    await Promise.allSettled([publication]);
    await rm(root, { recursive: true, force: true });
  }
});

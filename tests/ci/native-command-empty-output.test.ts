import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeOwnedNativeCommand } from '../../scripts/testing/owned-native-command';

const noDiagnosticOutputMarker = 'owned-command: no diagnostic output\n';

async function artifactRoot() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-owned-command-marker-')));
  await chmod(root, 0o700);
  return root;
}

void test('successful zero-output commands publish a truthful owned non-empty marker', async () => {
  const root = await artifactRoot();
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'process.exit(0)'],
      artifactRoot: root,
      label: 'silent-success',
      env: process.env,
      deadlineMs: 5000,
    });
    assert.equal(result.execution, 'completed');
    assert.equal(result.cleanup, 'cleaned');
    assert.equal(await readFile(result.logPath!, 'utf8'), noDiagnosticOutputMarker);
    const metadata = await lstat(result.logPath!);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.nlink, 1);
    assert.equal(metadata.uid, process.getuid?.());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('binary stdout remains empty while the separate diagnostic log gets the marker', async () => {
  const root = await artifactRoot();
  const stdoutPath = path.join(root, 'silent.stdout');
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'process.exit(0)'],
      artifactRoot: root,
      label: 'silent-binary',
      env: process.env,
      stdoutPath,
      deadlineMs: 5000,
    });
    assert.equal(result.execution, 'completed');
    assert.equal(result.cleanup, 'cleaned');
    assert.equal(await readFile(result.logPath!, 'utf8'), noDiagnosticOutputMarker);
    assert.deepEqual(await readFile(stdoutPath), Buffer.alloc(0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('split stdout captures preserve locale bytes while the diagnostic log gets the marker', async () => {
  const root = await artifactRoot();
  const stdoutPath = path.join(root, 'locale.stdout');
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', "process.stdout.write('en_US\\n');process.exit(0)"],
      artifactRoot: root,
      label: 'locale-os-read',
      env: process.env,
      stdoutPath,
      deadlineMs: 5000,
    });
    assert.equal(result.execution, 'completed');
    assert.equal(result.cleanup, 'cleaned');
    assert.deepEqual(await readFile(stdoutPath), Buffer.from('en_US\n'));
    assert.equal(await readFile(result.logPath!, 'utf8'), noDiagnosticOutputMarker);
    const metadata = await lstat(result.logPath!);
    assert.equal(metadata.size, Buffer.byteLength(noDiagnosticOutputMarker));
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.nlink, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('cancelled and deadline commands never receive the success-only marker', async () => {
  const root = await artifactRoot();
  try {
    const deadline = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'setTimeout(() => process.exit(0), 2000)'],
      artifactRoot: root,
      label: 'silent-deadline',
      env: process.env,
      deadlineMs: 100,
    });
    assert.equal(deadline.execution, 'deadline');
    assert.equal(deadline.cleanup, 'cleaned');
    assert.equal(await readFile(deadline.logPath!, 'utf8'), '');

    const cancelled = new AbortController();
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'setTimeout(() => process.exit(0), 2000)'],
      artifactRoot: root,
      label: 'silent-cancelled',
      env: process.env,
      deadlineMs: 5000,
      signal: cancelled.signal,
      onStarted: () => cancelled.abort(),
    });
    assert.equal(result.execution, 'cancelled');
    assert.equal(result.cleanup, 'cleaned');
    assert.equal(await readFile(result.logPath!, 'utf8'), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('output-bearing commands keep exact diagnostics and do not receive the marker', async () => {
  const root = await artifactRoot();
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', "process.stderr.write('real diagnostic\\n');process.exit(0)"],
      artifactRoot: root,
      label: 'diagnostic-success',
      env: process.env,
      deadlineMs: 5000,
    });
    assert.equal(result.execution, 'completed');
    assert.equal(await readFile(result.logPath!, 'utf8'), 'real diagnostic\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('failed zero-output commands retain an empty log and are never promoted by the marker', async () => {
  const root = await artifactRoot();
  try {
    const result = await executeOwnedNativeCommand({
      command: process.execPath,
      argv: ['-e', 'process.exit(7)'],
      artifactRoot: root,
      label: 'silent-failure',
      env: process.env,
      deadlineMs: 5000,
    });
    assert.equal(result.execution, 'child-failed');
    assert.equal(result.cleanup, 'cleaned');
    assert.equal(await readFile(result.logPath!, 'utf8'), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

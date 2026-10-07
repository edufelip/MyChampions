import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  createNativePilotOutputRoot,
  parseNativePilotInvocationArguments,
  writeNativePilotPrivateFile,
} from '../../scripts/testing/native-pilot-invocation';

const selection = [
  '--platform=ios',
  '--engine=detox',
  '--scenario=SCN-camera-denied-ios',
  '--mode=integration',
];
const requestedRunId = 'fedcba9876543210fedcba98';
const requestedAttemptId = `${requestedRunId}:first`;

void test('default Darwin worker rejects same-path replacement after descriptor fsync', async () => {
  if (process.platform !== 'darwin') return;

  const previousNodeHandleOverride = process.env.NATIVE_PILOT_TEST_USE_NODE_FILE_HANDLE;
  delete process.env.NATIVE_PILOT_TEST_USE_NODE_FILE_HANDLE;
  const root = await realpath(await mkdtemp(join(tmpdir(), 'detox-camera-v13-worker-race-')));
  const outputParent = join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  await chmod(outputParent, 0o700);
  const invocation = parseNativePilotInvocationArguments([
    ...selection,
    `--run-id=${requestedRunId}`,
    `--attempt-id=${requestedAttemptId}`,
    `--output-parent=${outputParent}`,
  ]);
  const prepared = await createNativePilotOutputRoot({
    invocation,
    defaultOutputParent: join(root, 'unused-default'),
  });
  const filePath = join(prepared.outputRoot, 'race.private.json');
  const movedPath = join(root, 'original.private.json');
  let replacementInjected = false;
  let replacementError: string | null = null;
  let resolveReplacement!: () => void;
  const replacementObserved = new Promise<void>((resolve) => {
    resolveReplacement = resolve;
  });
  const watcher = watch(prepared.outputRoot, { persistent: false }, (_event, filename) => {
    if (String(filename) !== 'race.private.json' || replacementInjected) return;
    void (async () => {
      try {
        await rename(filePath, movedPath);
        await writeFile(filePath, Buffer.from('REPLACEMENT-BYTES'), { flag: 'wx', mode: 0o600 });
        await chmod(filePath, 0o600);
        replacementInjected = true;
      } catch (error) {
        replacementError = error instanceof Error ? error.message : String(error);
      } finally {
        resolveReplacement();
      }
    })();
  });
  const replacementTimeout = setTimeout(resolveReplacement, 2_000);
  try {
    await assert.rejects(
      writeNativePilotPrivateFile({
        root: prepared.outputRoot,
        relative: 'race.private.json',
        contents: 'ORIGINAL-BYTES',
        namespaceIdentity: prepared.namespaceIdentity,
        deadlineAtMonotonicMs: performance.now() + 5_000,
        testPostSyncDelayMs: 300,
      }),
      /identity|bytes|changed|publication/i,
    );
    await replacementObserved;
    assert.equal(process.env.NATIVE_PILOT_TEST_USE_NODE_FILE_HANDLE, undefined);
    assert.equal(replacementError, null);
    assert.equal(replacementInjected, true);
    assert.equal(await readFile(filePath, 'utf8'), 'REPLACEMENT-BYTES');
    assert.equal(await readFile(movedPath, 'utf8'), 'ORIGINAL-BYTES');
  } finally {
    clearTimeout(replacementTimeout);
    watcher.close();
    await rm(root, { recursive: true, force: true });
    if (previousNodeHandleOverride === undefined)
      delete process.env.NATIVE_PILOT_TEST_USE_NODE_FILE_HANDLE;
    else process.env.NATIVE_PILOT_TEST_USE_NODE_FILE_HANDLE = previousNodeHandleOverride;
  }
});

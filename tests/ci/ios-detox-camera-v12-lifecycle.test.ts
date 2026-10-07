import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
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

async function privateRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  await chmod(root, 0o700);
  return root;
}

async function prepared(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const outputParent = join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  await chmod(outputParent, 0o700);
  return createNativePilotOutputRoot({
    invocation: parseNativePilotInvocationArguments([
      ...selection,
      `--run-id=${requestedRunId}`,
      `--attempt-id=${requestedAttemptId}`,
      `--output-parent=${outputParent}`,
    ]),
    defaultOutputParent: join(root, 'unused-default'),
  });
}

void test('V12 threads the original lifecycle through cleanup and camera staging-link publication', async () => {
  const owner = await readFile(
    join(__dirname, '../../scripts/testing/native-detox-camera-ios-current-owner.ts'),
    'utf8',
  );
  const cleanupStart = owner.indexOf('factories.verifyOwnedIosCleanup({');
  const cleanupEnd = owner.indexOf('});', cleanupStart);
  assert.ok(cleanupStart >= 0);
  assert.ok(cleanupEnd > cleanupStart);
  const cleanupCall = owner.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupCall, /signal:\s*(?:options\.signal|recoverySignal)/);
  assert.match(cleanupCall, /deadlineAtMonotonicMs:\s*options\.deadlineAtMonotonicMs/);

  const runner = await readFile(
    join(__dirname, '../../scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  const stagingStart = runner.indexOf("relative: 'detox-camera-staging-link.private.json'");
  const stagingEnd = runner.indexOf('});', stagingStart);
  assert.ok(stagingStart >= 0);
  assert.ok(stagingEnd > stagingStart);
  const stagingCall = runner.slice(stagingStart, stagingEnd);
  assert.match(stagingCall, /signal:\s*controller\.signal/);
  assert.match(stagingCall, /deadlineAtMonotonicMs:\s*runStarted \+ deadlines\.wholeRunMs/);

  const invocation = await readFile(
    join(__dirname, '../../scripts/testing/native-pilot-invocation.ts'),
    'utf8',
  );
  assert.match(invocation, /deadlineAtMonotonicMs\?: number/);
  assert.match(invocation, /checkLifecycle\(input\.signal, input\.deadlineAtMonotonicMs\)/);
});

void test('camera staging-link writer rejects pre-abort and expired lifecycle before publication', async () => {
  const root = await privateRoot('detox-camera-v12-lifecycle-');
  const preAbortedRoot = await prepared(join(root, 'pre-aborted'));
  const expiredRoot = await prepared(join(root, 'expired'));
  try {
    const preAborted = new AbortController();
    preAborted.abort(new Error('camera staging-link pre-aborted'));
    await assert.rejects(
      writeNativePilotPrivateFile({
        root: preAbortedRoot.outputRoot,
        relative: 'detox-camera-staging-link.private.json',
        contents: '{}',
        namespaceIdentity: preAbortedRoot.namespaceIdentity,
        signal: preAborted.signal,
        deadlineAtMonotonicMs: performance.now() + 5_000,
      }),
      /abort|cancel/i,
    );
    assert.deepEqual(await readdir(preAbortedRoot.outputRoot), []);

    await assert.rejects(
      writeNativePilotPrivateFile({
        root: expiredRoot.outputRoot,
        relative: 'detox-camera-staging-link.private.json',
        contents: '{}',
        namespaceIdentity: expiredRoot.namespaceIdentity,
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() - 1,
      }),
      /deadline/i,
    );
    assert.deepEqual(await readdir(expiredRoot.outputRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('camera staging-link writer fences an abort at the publication boundary', async () => {
  const root = await privateRoot('detox-camera-v12-publication-');
  const preparedRoot = await prepared(join(root, 'publication'));
  const publicationPath = join(preparedRoot.outputRoot, 'detox-camera-staging-link.private.json');
  try {
    const controller = new AbortController();
    const abortTimer = setTimeout(
      () => controller.abort(new Error('camera staging-link abort at publication')),
      10,
    );
    await assert.rejects(
      writeNativePilotPrivateFile({
        root: preparedRoot.outputRoot,
        relative: 'detox-camera-staging-link.private.json',
        contents: '{"publicPromotionEligible":false}\n',
        namespaceIdentity: preparedRoot.namespaceIdentity,
        signal: controller.signal,
        deadlineAtMonotonicMs: performance.now() + 5_000,
        testDelayMs: 100,
      }),
      /abort|cancel|publication/i,
    );
    clearTimeout(abortTimer);
    assert.equal(controller.signal.aborted, true);
    try {
      const entry = await lstat(publicationPath);
      assert.equal(entry.isFile(), true);
      assert.equal((await readFile(publicationPath)).byteLength, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  inspectNativeHostContention,
  nativeHostJobsFromCensus,
  NativeHostContentionError,
  requireNativeHostAvailability,
  requireNativeHostAvailabilityAtStep,
} from '../../scripts/testing/native-host-contention';
import { startOwnedNativeCommand } from '../../scripts/testing/owned-native-command';
import { groupProcesses } from '../../scripts/testing/owned-process-group';

void test('native census identifies known live engines while excluding ancestry, zombies, idle services and command mentions', () => {
  const row = (pid: number, ppid: number, command: string, stat = 'S') =>
    `${pid} ${ppid} 501 ${stat} Tue Sep 29 08:26:23 2026 ${command}`;
  const base = [
    row(10, 1, 'bash /repo/host-lock.sh'),
    row(11, 10, 'node --import tsx /repo/capture-native-testability.ts'),
  ];
  const recognized = [
    'node /repo/node_modules/.bin/detox test --configuration ios.sim.debug --secret PRIVATE-CONTROL',
    'node /repo/node_modules/detox/local-cli/cli.js build',
    'node --import tsx /repo/capture-android-testability.ts --platform=android',
    '/opt/java -classpath /repo/* maestro.cli.AppKt --no-ansi --udid target test /flow.yaml',
    '/opt/maestro --udid target hierarchy',
    '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test-without-building -destination id=target',
    '/opt/java org.gradle.wrapper.GradleWrapperMain :app:assembleDevDebug',
    'bash /repo/gradlew :app:assembleDevDebug',
  ];
  for (const [i, command] of recognized.entries()) {
    const jobs = nativeHostJobsFromCensus([...base, row(20 + i, 1, command)].join('\n'), 11);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].pid, 20 + i);
    assert.match(jobs[0].commandHash, /^[a-f0-9]{64}$/);
    assert(!JSON.stringify(jobs).includes('PRIVATE-CONTROL'));
  }
  const ignored = [
    '/opt/java org.gradle.launcher.daemon.bootstrap.GradleDaemon 9.3.1',
    '/opt/java maestro.cli.AppKt mcp',
    'node -e console.log("detox test")',
    'bash -c echo maestro test',
    'node /repo/native-host-contention.test.ts',
    'xcodebuild -showBuildSettings -scheme app',
  ];
  assert.deepEqual(
    nativeHostJobsFromCensus(
      [
        ...base,
        ...ignored.map((command, i) => row(30 + i, 1, command)),
        row(50, 1, recognized[0], 'Z'),
      ].join('\n'),
      11,
    ),
    [],
  );
  // A real ancestor engine is part of the current caller's invocation, not a competing job.
  assert.deepEqual(
    nativeHostJobsFromCensus([row(10, 1, recognized[0]), base[1]].join('\n'), 11),
    [],
  );
});

void test('native census rejects malformed, missing, duplicate and cyclic ownership metadata', () => {
  for (const census of [
    '',
    'not a census',
    '11 1 501 S xxxxxxxxxxxxxxxxxxxxxxxx node /repo/entry.ts',
    '10 1 501 S Tue Sep 29 08:26:23 2026 node /repo/entry.ts',
    '11 10 501 S Tue Sep 29 08:26:23 2026 node /repo/entry.ts',
    '11 1 501 Z Tue Sep 29 08:26:23 2026 node /repo/entry.ts',
    '11 11 501 S Tue Sep 29 08:26:23 2026 node /repo/entry.ts',
    [
      '11 1 501 S Tue Sep 29 08:26:23 2026 node /repo/entry.ts',
      '11 1 501 S Tue Sep 29 08:26:23 2026 node /repo/duplicate.ts',
    ].join('\n'),
  ])
    assert.throws(() => nativeHostJobsFromCensus(census, 11));
  assert.throws(() => nativeHostJobsFromCensus('', NaN));
});

void test('actual read-only host guard detects a directly owned synthetic native-looking child without signalling it', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-contention-')));
  await chmod(root, 0o700);
  const file = path.join(root, 'node_modules/.bin/detox');
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, 'setInterval(()=>{},1000);', { mode: 0o600 });
  let child: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  try {
    child = await startOwnedNativeCommand({
      command: process.execPath,
      argv: [file, 'test', 'PRIVATE-CONTROL'],
      artifactRoot: root,
      label: 'synthetic-detox',
      env: process.env,
    });
    const before = await inspectNativeHostContention();
    assert(before.knownJobs.some((row) => row.pid === child!.pid && row.kind === 'detox'));
    await assert.rejects(requireNativeHostAvailability(root), NativeHostContentionError);
    const receipt = await readFile(path.join(root, 'native-host-census.private.json'), 'utf8');
    assert(!receipt.includes('PRIVATE-CONTROL'));
    assert(!receipt.includes(file));
    assert.equal(child.outcome().code, null);
    assert.doesNotThrow(() => process.kill(child!.pid, 0));
    await assert.rejects(requireNativeHostAvailability(root), /EEXIST/);
    let nextCommandDispatched = false;
    await assert.rejects(
      async () => {
        await requireNativeHostAvailabilityAtStep(root, 'next-actions');
        nextCommandDispatched = true;
      },
      (error: unknown) =>
        error instanceof NativeHostContentionError && error.stage === 'command-boundary',
    );
    assert.equal(nextCommandDispatched, false);
    const stepPath = path.join(root, 'native-host-step-next-actions.private.json');
    const stepReceipt = await readFile(stepPath, 'utf8');
    const step = JSON.parse(stepReceipt) as { boundaryLabel: string; knownJobs: { pid: number }[] };
    assert.equal(step.boundaryLabel, 'next-actions');
    assert(step.knownJobs.some((row) => row.pid === child!.pid));
    assert(!stepReceipt.includes('PRIVATE-CONTROL'));
    assert(!stepReceipt.includes(file));
    assert.equal((await stat(stepPath)).mode & 0o777, 0o600);
    await assert.rejects(requireNativeHostAvailabilityAtStep(root, 'next-actions'), /EEXIST/);
    assert.equal(await readFile(stepPath, 'utf8'), stepReceipt);
    assert.equal(child.outcome().code, null);
    assert.doesNotThrow(() => process.kill(child!.pid, 0));
    await child.stop();
    assert.deepEqual(await groupProcesses(child.pgid), []);
    const after = await inspectNativeHostContention();
    assert(!after.knownJobs.some((row) => row.pid === child!.pid));
  } finally {
    await child?.stop();
    await rm(root, { recursive: true, force: true });
  }
});

void test('native command boundary rejects unsafe labels before census or receipt writes', async () => {
  for (const label of [
    '',
    '../escape',
    '/absolute',
    'mixed/child',
    'a'.repeat(101),
    'UPPER',
    'unsafe\nline',
  ]) {
    await assert.rejects(
      requireNativeHostAvailabilityAtStep('/nonexistent', label),
      /Unsafe native host boundary label/,
    );
  }
});

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

void test('shared Android lifecycle import and rejected requests cannot acquire native resources or install process handlers', async () => {
  const root = path.resolve(__dirname, '../../.qa/artifacts/native-pilot');
  const artifacts = async () => {
    try {
      return (await readdir(root)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const original = {
    int: process.listeners('SIGINT'),
    term: process.listeners('SIGTERM'),
    exit: process.exitCode,
    artifacts: await artifacts(),
  };
  const { runOwnedAndroidNativeSession: run } =
    await import('../../scripts/testing/capture-android-testability');
  assert.deepEqual(process.listeners('SIGINT'), original.int);
  assert.deepEqual(process.listeners('SIGTERM'), original.term);
  assert.equal(process.exitCode, original.exit);
  for (const options of [
    null,
    [],
    {},
    { charter: 'unknown' },
    { charter: 'entry-and-login', extra: true },
    { charter: 'entry-and-login', signal: {} },
    { charter: 'entry-and-login', executeTraining: async () => {} },
    { charter: 'training-journey' },
    { charter: 'training-journey', executeTraining: true },
    { charter: 'training-journey', executeTraining: 'driver' },
  ])
    await assert.rejects(run(options as never), /Invalid owned Android session options/);
  for (const deadlines of [
    null,
    [],
    { extra: 1000 },
    { buildMs: 900001 },
    { stepMs: 999 },
    { wholeRunMs: 2400001 },
  ])
    await assert.rejects(
      run({ charter: 'entry-and-login', deadlines } as never),
      /Invalid native execution deadlines/,
    );
  for (const reason of ['SIGINT', 'SIGTERM', new Error('Already cancelled'), 'not-a-signal']) {
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(
      run({ charter: 'entry-and-login', signal: controller.signal }),
      (error) => error === reason,
    );
    let invoked = false;
    await assert.rejects(
      run({
        charter: 'training-journey',
        signal: controller.signal,
        executeTraining: () => {
          invoked = true;
          return Promise.resolve();
        },
      }),
      (error) => error === reason,
    );
    assert.equal(invoked, false);
  }
  assert.deepEqual(await artifacts(), original.artifacts);
  assert.deepEqual(process.listeners('SIGINT'), original.int);
  assert.deepEqual(process.listeners('SIGTERM'), original.term);
  assert.equal(process.exitCode, original.exit);
});

void test('Android inventory CLI retains supported charters and rejects empty, duplicate and nonimplemented journeys', async () => {
  const { parseAndroidNativeCaptureArguments: parse, androidInventoryCharters } =
    await import('../../scripts/testing/capture-android-testability');
  const base = ['--platform=android', '--mode=inventory'];
  assert.deepEqual(parse(base), { charter: 'entry-and-login' });
  for (const charter of androidInventoryCharters.filter((value) => value !== 'entry-and-login')) {
    assert.deepEqual(parse([...base, `--charter=${charter}`]), { charter });
    assert.deepEqual(parse([`--charter=${charter}`, ...base.toReversed()]), { charter });
  }
  for (const args of [
    [],
    ['--platform=ios', '--mode=inventory'],
    [...base, '--mode=inventory'],
    [...base, '--charter='],
    [...base, '--charter=unknown'],
    [...base, '--charter=training-journey'],
    [...base, '--charter=entry-and-login'],
    [...base, '--charter=training-load', '--charter=training-draft'],
    [...base, '--executeTraining=driver'],
    [...base, '--deadlines=1000'],
  ])
    assert.throws(() => parse(args), /Invalid Android native capture arguments/);
});

import assert from 'node:assert/strict';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import {
  requireSuccessfulNativeCommandDiagnostics,
  trainingAttemptChildExitCode,
} from '../../scripts/testing/native-training-attempt-outcome';
import { runAndroidTrainingAttempt } from '../../scripts/testing/run-android-training-attempt';

void test('owned Android adapter rejects cancelled, stale, crossed and missing-host requests before acquisition', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  const selection = await selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-training-android',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
  const captureNames = async () =>
    readdir(path.join(repositoryRoot, '.qa/artifacts/native-pilot')).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
      },
    );
  const before = await captureNames();
  const options = {
    repositoryRoot,
    requestedRunId: 'a'.repeat(24),
    selection,
    signal: new AbortController().signal,
  };
  const cancelled = new AbortController();
  cancelled.abort('SIGTERM');
  await assert.rejects(
    runAndroidTrainingAttempt({ ...options, signal: cancelled.signal }),
    (reason) => reason === 'SIGTERM',
  );
  await assert.rejects(runAndroidTrainingAttempt({ ...options, requestedRunId: 'bad' }));
  await assert.rejects(
    runAndroidTrainingAttempt({
      ...options,
      deadlines: { stepMs: 1000, buildMs: 900001, wholeRunMs: 2400000 },
    }),
    /Invalid native execution deadlines/,
  );
  const stale = structuredClone(selection);
  stale.requirementHash = '0'.repeat(64);
  await assert.rejects(
    runAndroidTrainingAttempt({ ...options, selection: stale }),
    /changed before acquisition/,
  );
  const ios = await selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-training-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
  await assert.rejects(runAndroidTrainingAttempt({ ...options, selection: ios }));
  const originalHostRoot = process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
  try {
    delete process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
    await assert.rejects(runAndroidTrainingAttempt(options), /shared native host-lock/);
  } finally {
    if (originalHostRoot === undefined) delete process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
    else process.env.MYCHAMPIONS_NATIVE_STATE_ROOT = originalHostRoot;
  }
  assert.deepEqual(await captureNames(), before);
});

void test('shared child outcome keeps aborted Android parent and engine failure distinct', () => {
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: 0 }], false), null);
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: null }], false), null);
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: 0 }], true), 0);
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: 1 }], false), 1);
  assert.equal(trainingAttemptChildExitCode([{ childExitCode: 7 }], true), 7);
  const censusBlocked: { childExitCode: number | null; censusFailure: unknown }[] = [
    { childExitCode: 0, censusFailure: { kind: 'late-publication-failure' } },
  ];
  assert.equal(trainingAttemptChildExitCode(censusBlocked, false), null);
});

void test('successful native diagnostics require complete clean engine facts and preserve child zero', () => {
  const valid = {
    label: 'android-build',
    phase: 'build',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    censusFailure: null,
    outputFailure: null,
    deadlineMs: 900_000,
  } as const;
  const normalized = requireSuccessfulNativeCommandDiagnostics([valid]);
  assert.deepEqual(normalized, [valid]);
  assert.equal(normalized[0]?.childExitCode, 0);
  assert.equal(
    trainingAttemptChildExitCode([{ childExitCode: 0 }], false),
    null,
    'aggregate callback-incomplete result remains unknown despite an observed child zero',
  );
  assert.throws(() => requireSuccessfulNativeCommandDiagnostics([]), /non-empty/);
  for (const omitted of [
    ['censusFailure'],
    ['outputFailure'],
    ['censusFailure', 'outputFailure'],
  ]) {
    const incomplete = Object.fromEntries(
      Object.entries(valid).filter(([key]) => !omitted.includes(key)),
    );
    assert.throws(
      () => requireSuccessfulNativeCommandDiagnostics([incomplete]),
      /census failure|output failure/,
    );
  }
  assert.throws(
    () =>
      requireSuccessfulNativeCommandDiagnostics([{ ...valid, outputFailure: { reason: 'bad' } }]),
    /output failure/,
  );
  assert.throws(
    () => requireSuccessfulNativeCommandDiagnostics([{ ...valid, childSignal: 123 }]),
    /child signal/,
  );
  const { childSignal, ...missingChildSignal } = valid;
  void childSignal;
  assert.throws(
    () => requireSuccessfulNativeCommandDiagnostics([missingChildSignal]),
    /child signal/,
  );
  assert.throws(
    () => requireSuccessfulNativeCommandDiagnostics([{ ...valid, childExitCode: 7 }]),
    /child exit/,
  );
  assert.throws(
    () =>
      requireSuccessfulNativeCommandDiagnostics([
        { ...valid, censusFailure: { kind: 'original native command census failure' } },
      ]),
    /census failure/,
  );
  assert.throws(
    () => requireSuccessfulNativeCommandDiagnostics([{ ...valid, label: '' }]),
    /metadata/,
  );
  assert.throws(
    () => requireSuccessfulNativeCommandDiagnostics([{ ...valid, phase: 'verify' }]),
    /metadata/,
  );
});

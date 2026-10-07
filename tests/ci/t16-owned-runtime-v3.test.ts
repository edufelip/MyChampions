import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { runOwnedIosNativeSession } from '../../scripts/testing/capture-native-testability';
import { projectIosConnectionT16BTerminal } from '../../scripts/testing/run-ios-connection-attempt';
import { runIosT16BOwnedAttemptForNativePilot } from '../../scripts/testing/run-native-pilot';
import type { T16BOuterCleanupBinding } from '../../scripts/testing/t16b-outer-cleanup-binding';

function outerCleanupBinding(result: 'passed' | 'failed'): T16BOuterCleanupBinding {
  return {
    schemaVersion: 1,
    kind: 'private-t16-b-outer-cleanup-binding-not-public-receipt',
    scope: 'outer-ios-native-session',
    captureRunId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    artifactRoot: '/owned/.qa/artifacts/native-pilot/aaaaaaaaaaaaaaaaaaaaaaaa',
    source: {
      path: 'external-cleanup.private.json',
      bytes: 256,
      sha256: 'b'.repeat(64),
      identity: {
        dev: 1,
        ino: 2,
        uid: 3,
        gid: 4,
        mode: 0o600,
        nlink: 1,
        size: 256,
        mtimeMs: 1,
        ctimeMs: 1,
      },
    },
    facts: {
      kind: 'independent ios native inventory cleanup proof',
      result,
      runId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      captureResult: 'observed',
      captureCleanupClean: result === 'passed',
      pidStartPairs: result === 'passed' ? 1 : null,
      survivors: result === 'passed' ? [] : null,
      unknownProcessQueries: result === 'passed' ? [] : null,
      missingForeignDevices: result === 'passed' ? [] : null,
      ownedDeviceAbsent: result === 'passed' ? true : null,
      cacheAbsent: result === 'passed' ? true : null,
      docker: result === 'passed' ? { container: [], network: [], volume: [] } : null,
      finishedAt: result === 'passed' ? '2026-10-03T00:00:00.000Z' : null,
    },
  };
}

void test('connection locale callback is opt-in and rejected before host acquisition when absent', async () => {
  const controller = new AbortController();
  await assert.rejects(
    runOwnedIosNativeSession({
      charter: 'connection-journey',
      locale: 'en-US',
      signal: controller.signal,
      executeConnection: () => Promise.resolve(),
    }),
    /Invalid owned iOS session options/,
  );
});

void test('connection locale callback is accepted only as an explicit owned continuation', async () => {
  const controller = new AbortController();
  await assert.rejects(
    runOwnedIosNativeSession({
      charter: 'connection-journey',
      locale: 'en-US',
      signal: controller.signal,
      executeConnection: () => Promise.resolve(),
      executeConnectionLocale: ({ run, scenario }) => run(scenario),
    }),
    /existing native host-lock wrapper/,
  );
});

void test('native-pilot T16 dispatch rejects a foreign source root before any acquisition', async () => {
  await assert.rejects(
    runIosT16BOwnedAttemptForNativePilot({ repositoryRoot: '/tmp' } as never),
    /current repository source root/,
  );
});

void test('runner source carries current-root dispatch and post-flow continuation seams', async () => {
  const source = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  assert.match(source, /runIosT16BOwnedAttemptForNativePilot/);
  const connection = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/run-ios-connection-attempt.ts'),
    'utf8',
  );
  assert.match(connection, /executeConnectionAfterFlow/);
  assert.match(connection, /t16-b-terminal\.private\.json/);
  const entrypoint = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/t16b-owned-ios-native-entrypoint.ts'),
    'utf8',
  );
  assert.match(entrypoint, /reuseBuildSourceRoot: input\.reuseBuildSourceRoot/);
});

void test('T16 terminal publication remains blocked when outer cleanup is not proven', () => {
  const terminal = projectIosConnectionT16BTerminal({
    artifactRoot: '/owned/.qa/artifacts/native-pilot/run',
    execution: { status: 'explored' },
    outerCleanup: outerCleanupBinding('failed'),
    parentOwnedInput: null,
    captureCleanup: 'cleaned',
    verificationResult: 'passed',
  });
  assert.equal(terminal.status, 'blocked');
  assert.equal(terminal.publicPublicationEligible, false);
  assert(terminal.blockers.includes('outer-cleanup-failed'));
});

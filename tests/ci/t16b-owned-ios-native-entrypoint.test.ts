import { strict as assert } from 'node:assert';
import { chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  createOwnedSelectionObserver,
  runOwnedT16BFromOwnedIosNativeSession,
} from '../../scripts/testing/t16b-owned-ios-native-entrypoint';
import type { IosConnectionRuntimeContext } from '../../scripts/testing/capture-native-testability';

const candidateRoot = path.resolve(process.cwd());
const apiOrigin = 'http://127.0.0.1:49152';
const apiPid = process.pid;
const captureRunId = 'a'.repeat(24);
const coachAuthUid = 'coach-auth-uid';
const studentAuthUid = 'student-auth-uid';
const binarySha256 = 'b'.repeat(64);

async function makeOwnedContext() {
  const parent = path.join(candidateRoot, '.qa', 'artifacts');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const output = path.join(parent, `t16b-entrypoint-test-${process.pid}-${Date.now()}`);
  await mkdir(output, { mode: 0o700 });
  const rows = [coachAuthUid, studentAuthUid].map((authUid, index) => ({
    requestId: index + 1,
    ordinal: index + 1,
    targetOrigin: apiOrigin,
    apiPid,
    status: 201,
    authUid,
    verification: 'verified' as const,
    verificationReason: 'verified' as const,
    fixtureAuthUidAllowlistHash: 'c'.repeat(64),
  }));
  const observations = [1, 2].map((requestId) => ({
    requestId,
    method: 'POST',
    pathHash: 'd'.repeat(64),
    requestOrigin: null,
    requestProfile: 'native' as const,
    requestCredentialPresent: false,
    targetOrigin: apiOrigin,
    status: 201,
    outcome: 'forwarded' as const,
    faultAttemptId: null,
    elapsedMs: 1,
  }));
  const context = {
    output,
    fixtures: {
      runId: captureRunId,
      scope: 't16-scope',
      accounts: {
        coach: { authUid: coachAuthUid },
        student: { authUid: studentAuthUid },
      },
    },
    proxy: {
      nativeAuthIdentities: rows,
      observations,
    },
    apiIdentity: { apiPid, targetOrigin: apiOrigin },
    report: {
      captureRunId,
      backend: {
        runId: captureRunId,
        processes: [{ pid: apiPid, started: 'owned-start', script: 'owned-api' }],
      },
      build: { binaryHash: binarySha256, bundleId: 'com.example.app' },
      device: { udid: 'simulator-001' },
      toolVersions: { maestro: '2.6.1' },
      observedOsLocale: 'en-US',
      coldResetEvidence: {
        path: '.qa/artifacts/reset.private.json',
        sha256: 'e'.repeat(64),
      },
      fixtureAuthUidAllowlistHash: 'c'.repeat(64),
    },
    connectionSnapshot: () => Promise.resolve({ readOnly: true }),
  } as unknown as IosConnectionRuntimeContext;
  return { context, output };
}

async function cleanup(output: string): Promise<void> {
  await rm(output, { recursive: true, force: true });
}

void test('owned iOS observer binds current session receipts and separates action windows', async () => {
  const { context, output } = await makeOwnedContext();
  try {
    const requestedRunId = 'f'.repeat(24);
    const observer = createOwnedSelectionObserver(context, candidateRoot, requestedRunId);
    const identity = await observer.readSelectionIdentity(new AbortController().signal);
    assert.equal(identity.runId, requestedRunId);
    assert.equal(identity.attemptId, `${requestedRunId}:first`);
    assert.equal(identity.locale, 'en-US');
    const selection = await Promise.all([
      observer.readTarget(new AbortController().signal),
      observer.readBuild(new AbortController().signal),
      observer.readTool(new AbortController().signal),
      observer.readLocale(new AbortController().signal),
      observer.readRoles(new AbortController().signal),
      observer.readFixture(new AbortController().signal),
      observer.readReset(new AbortController().signal),
      observer.readAuthApi(new AbortController().signal),
      observer.readSql(new AbortController().signal),
      observer.readOwnership(new AbortController().signal),
    ]);
    assert.equal(new Set(selection.map((row) => row.path)).size, 10);
    for (const row of selection) {
      const info = await lstat(path.join(output, row.path));
      assert.equal(info.mode & 0o777, 0o600);
      assert.equal(info.nlink, 1);
    }
    const first = await observer.readPostActionEvidence({
      ordinal: 1,
      actionId: 'submit-code',
      requestId: '1',
      signal: new AbortController().signal,
    });
    const second = await observer.readPostActionEvidence({
      ordinal: 2,
      actionId: 'submit-code',
      requestId: '2',
      signal: new AbortController().signal,
    });
    assert.notEqual(first.api.path, second.api.path);
    assert.notEqual(first.sql.path, second.sql.path);
    assert.notEqual(
      (await readFile(path.join(output, first.api.path))).toString('utf8'),
      (await readFile(path.join(output, second.api.path))).toString('utf8'),
    );
  } finally {
    await cleanup(output);
  }
});

void test('owned iOS observer rejects an unobserved locale before writing selection evidence', async () => {
  const { context, output } = await makeOwnedContext();
  try {
    context.report.observedOsLocale = null;
    assert.throws(
      () => createOwnedSelectionObserver(context, candidateRoot),
      /locale was not observed/,
    );
    await assert.rejects(lstat(path.join(output, 't16-selection-target.private.json')));
  } finally {
    await cleanup(output);
  }
});

void test('owned iOS entrypoint rejects a repository root that is not its source checkout before capture', async () => {
  await assert.rejects(
    runOwnedT16BFromOwnedIosNativeSession({
      repositoryRoot: '/tmp',
    } as never),
    /Owned repository root is not canonical|differs from the entrypoint source checkout/,
  );
});

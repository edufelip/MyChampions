import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  androidDriverDiagnosticMaxBytes,
  androidDriverDiagnosticMetadataMaxBytes,
  androidDriverDiagnosticPaths,
  androidDriverDiagnosticReceiptMaxBytes,
  captureAndroidReadonlyDiagnostic,
  classifyAndroidDriverHostSample,
  recordAndroidDriverHostSamples,
  type AndroidDriverDiagnosticTarget,
} from '../../scripts/testing/native-android-driver-diagnostics';

const target: AndroidDriverDiagnosticTarget = {
  captureRunId: 'capture-run',
  ownerRunId: 'owner-run',
  serial: 'emulator-5554',
  adbServerPort: 31001,
};

async function privateRoot() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-android-driver-diagnostic-')),
  );
  await chmod(root, 0o700);
  return root;
}

async function assertPrivateFile(filePath: string) {
  const metadata = await lstat(filePath);
  assert(metadata.isFile());
  assert.equal(metadata.uid, process.getuid?.());
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(await realpath(filePath), filePath);
}

function digest(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

void test('successful Android driver reads preserve bounded stdout bytes and private receipt metadata', async () => {
  const root = await privateRoot();
  try {
    const value = 'instrumentation response ✓';
    const result = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-instrumentation-response',
      timeoutMs: 5000,
      target,
      read: () => Promise.resolve(value),
    });
    const bytes = Buffer.from(value);
    assert.equal(result.receipt.status, 'passed');
    assert.equal(result.receipt.deadlineMs, null);
    assert.equal(result.receipt.cancellation, null);
    assert.equal(result.receipt.originalCause, null);
    assert.equal(result.receipt.stdout?.available, true);
    assert.equal(result.receipt.stdout?.representation, 'utf8-returned-string');
    assert.equal(result.receipt.stdout?.bytes, bytes.byteLength);
    assert.equal(result.receipt.stdout?.sha256, digest(bytes));
    assert.deepEqual(await readFile(result.outputPaths[0]), bytes);
    await assertPrivateFile(result.outputPaths[0]);
    await assertPrivateFile(result.receiptPath);
    assert.deepEqual(JSON.parse(await readFile(result.receiptPath, 'utf8')), result.receipt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('failed reads retain first cause plus available stdout and stderr bytes without inferring a deadline', async () => {
  const root = await privateRoot();
  try {
    const failure = Object.assign(new Error('driver RPC failed'), {
      code: 'EIO',
      signal: 'SIGTERM',
      killed: true,
      stdout: Buffer.from([0x00, 0xff, 0x01]),
      stderr: Buffer.from([0x80, 0x81]),
    });
    const result = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-failed-stderr',
      timeoutMs: 5000,
      target,
      read: () => Promise.reject(failure),
    });
    assert.equal(result.receipt.status, 'failed');
    assert(result.receipt.originalCause);
    assert.equal(result.receipt.originalCause.kind, 'read-failed');
    assert.equal(result.receipt.originalCause.name, 'Error');
    assert.equal(result.receipt.originalCause.message, 'driver RPC failed');
    assert.equal(result.receipt.originalCause.code, 'EIO');
    assert.equal(result.receipt.originalCause.signal, 'SIGTERM');
    assert.equal(result.receipt.originalCause.killed, true);
    assert.equal(result.receipt.originalCause.metadata.message.originalBytes, 17);
    assert.equal(
      result.receipt.originalCause.metadata.message.sha256,
      digest(Buffer.from('driver RPC failed')),
    );
    assert.equal(result.receipt.observedError.name, 'Error');
    assert.equal(result.receipt.observedError.message, 'driver RPC failed');
    assert.equal(result.receipt.observedError.code, 'EIO');
    assert.equal(result.receipt.observedError.signal, 'SIGTERM');
    assert.equal(result.receipt.observedError.killed, true);
    assert.equal(result.receipt.deadlineMs, null);
    assert.equal(result.receipt.stdout?.bytes, 3);
    assert.equal(result.receipt.stderr?.bytes, 2);
    assert.equal(result.receipt.stdout?.representation, 'buffer-exact');
    assert.equal(result.receipt.stderr?.representation, 'buffer-exact');
    assert(result.receipt.stdout);
    assert(result.receipt.stderr);
    assert.deepEqual(await readFile(result.receipt.stdout.path), Buffer.from([0x00, 0xff, 0x01]));
    assert.deepEqual(await readFile(result.receipt.stderr.path), Buffer.from([0x80, 0x81]));
    for (const filePath of result.outputPaths) await assertPrivateFile(filePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('large error metadata is bounded, allowlisted and receipt-size limited', async () => {
  const root = await privateRoot();
  try {
    const message = 'm'.repeat(androidDriverDiagnosticMetadataMaxBytes * 10);
    const failure = Object.assign(new Error(message), {
      code: 'UNSAFE_CODE',
      signal: 'UNSAFE_SIGNAL',
      stderr: Buffer.from([0x00, 0xff, 0x7f]),
    });
    const result = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-target-verification',
      timeoutMs: 5000,
      target,
      read: () => Promise.reject(failure),
    });
    assert.equal(result.receipt.status, 'failed');
    assert.equal(result.receipt.observedError.code, null);
    assert.equal(result.receipt.observedError.signal, null);
    assert.equal(
      result.receipt.observedError.message?.length,
      androidDriverDiagnosticMetadataMaxBytes,
    );
    assert.equal(result.receipt.observedError.metadata.message.originalBytes, message.length);
    assert.equal(
      result.receipt.observedError.metadata.message.sha256,
      digest(Buffer.from(message)),
    );
    assert.equal(result.receipt.observedError.metadata.message.truncated, true);
    assert.equal(result.receipt.stderr?.representation, 'buffer-exact');
    assert(result.receipt.stderr);
    assert.deepEqual(await readFile(result.receipt.stderr.path), Buffer.from([0x00, 0xff, 0x7f]));
    assert((await lstat(result.receiptPath)).size <= androidDriverDiagnosticReceiptMaxBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('numeric child exit codes are preserved only within the bounded allowlist', async () => {
  const root = await privateRoot();
  try {
    const numeric = Object.assign(new Error('child exited'), { code: 1 });
    const numericResult = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-process-state',
      timeoutMs: 5000,
      target,
      read: () => Promise.reject(numeric),
    });
    assert.equal(numericResult.receipt.observedError.code, 1);
    assert.equal(numericResult.receipt.observedError.metadata.code.originalBytes, 1);
    assert.equal(
      numericResult.receipt.observedError.metadata.code.sha256,
      digest(Buffer.from('1')),
    );

    const huge = Object.assign(new Error('child exited'), { code: 256 });
    const hugeResult = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-port-state',
      timeoutMs: 5000,
      target,
      read: () => Promise.reject(huge),
    });
    assert.equal(hugeResult.receipt.observedError.code, null);

    const fractional = Object.assign(new Error('child exited'), { code: 1.5 });
    const fractionalResult = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-package-state',
      timeoutMs: 5000,
      target,
      read: () => Promise.reject(fractional),
    });
    assert.equal(fractionalResult.receipt.observedError.code, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('unknown failed reads remain unknown with null unavailable fields and later diagnostics are still captured', async () => {
  const root = await privateRoot();
  try {
    let calls = 0;
    const unknown = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-failed-stdout',
      timeoutMs: 4000,
      target,
      read: () => {
        calls += 1;
        return Promise.resolve(undefined as unknown as string);
      },
    });
    const later = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-device-logcat',
      timeoutMs: 4000,
      target,
      read: () => {
        calls += 1;
        return Promise.resolve('later query');
      },
    });
    assert.equal(calls, 2);
    assert.equal(unknown.receipt.status, 'unknown');
    assert(unknown.receipt.originalCause);
    assert.equal(unknown.receipt.originalCause.kind, 'unknown');
    assert.equal(unknown.receipt.originalCause.metadata.message.originalBytes, null);
    assert.equal(unknown.receipt.stdout?.available, false);
    assert.equal(unknown.receipt.stdout?.representation, 'unavailable');
    assert.equal(unknown.receipt.stdout?.bytes, null);
    assert.equal(unknown.receipt.observedError.code, null);
    assert.equal(later.receipt.status, 'passed');
    assert.equal(await readFile(later.outputPaths[0], 'utf8'), 'later query');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('over-limit diagnostics are harness-blocked and store at most one MiB of raw output', async () => {
  const root = await privateRoot();
  try {
    const value = 'x'.repeat(androidDriverDiagnosticMaxBytes + 1);
    const result = await captureAndroidReadonlyDiagnostic({
      artifactRoot: root,
      label: 'android-driver-failed-stdout',
      timeoutMs: 5000,
      target,
      read: () => Promise.resolve(value),
    });
    assert.equal(result.receipt.status, 'blocked');
    assert.equal(result.receipt.outputLimitExceeded, true);
    assert.equal(result.receipt.stdout?.bytes, androidDriverDiagnosticMaxBytes + 1);
    assert.equal(result.receipt.stdout?.storedBytes, androidDriverDiagnosticMaxBytes);
    assert(result.receipt.stdout);
    assert.equal((await lstat(result.receipt.stdout.path)).size, androidDriverDiagnosticMaxBytes);
    assert.equal(result.receipt.stdout?.sha256, digest(Buffer.from(value)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('labels, private roots and exclusive artifacts reject unsafe or colliding writes before query execution', async () => {
  const root = await privateRoot();
  try {
    let called = false;
    await assert.rejects(
      captureAndroidReadonlyDiagnostic({
        artifactRoot: root,
        label: '../arbitrary-path' as never,
        timeoutMs: 1000,
        target,
        read: () => {
          called = true;
          return Promise.resolve('must not run');
        },
      }),
      /Unsupported Android driver diagnostic label/,
    );
    assert.equal(called, false);
    await assert.rejects(
      captureAndroidReadonlyDiagnostic({
        artifactRoot: root,
        label: 'android-driver-process-state',
        timeoutMs: 5001,
        target,
        read: () => Promise.resolve('must not run'),
      }),
      /1 to 5000ms/,
    );
    const paths = androidDriverDiagnosticPaths(root, 'android-driver-process-state');
    await writeFile(paths.outputPath, 'existing', { flag: 'wx', mode: 0o600 });
    await assert.rejects(
      captureAndroidReadonlyDiagnostic({
        artifactRoot: root,
        label: 'android-driver-process-state',
        timeoutMs: 1000,
        target,
        read: () => {
          called = true;
          return Promise.resolve('must not run');
        },
      }),
      /already exists/,
    );
    assert.equal(called, false);
    assert.equal(await readFile(paths.outputPath, 'utf8'), 'existing');
    const looseRoot = await privateRoot();
    await chmod(looseRoot, 0o755);
    await assert.rejects(
      captureAndroidReadonlyDiagnostic({
        artifactRoot: looseRoot,
        label: 'android-driver-process-state',
        timeoutMs: 1000,
        target,
        read: () => Promise.resolve('must not run'),
      }),
      /canonical, private and owned/,
    );
    await rm(looseRoot, { recursive: true, force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('host samples retain explicit owned versus unmatched PID/start identities and first failed cause', async () => {
  const root = await privateRoot();
  try {
    const owned = [{ pid: 200, started: 'Wed Sep 30 20:00:00 2026' }];
    const firstCause = {
      kind: 'read-failed' as const,
      name: 'Error',
      message: 'host census unavailable',
      code: 'EIO',
      signal: null,
      killed: null,
      metadata: {
        name: {
          originalBytes: 5,
          sha256: digest(Buffer.from('Error')),
          truncated: false,
        },
        message: {
          originalBytes: Buffer.byteLength('host census unavailable'),
          sha256: digest(Buffer.from('host census unavailable')),
          truncated: false,
        },
        code: { originalBytes: 3, sha256: digest(Buffer.from('EIO')), truncated: false },
        signal: { originalBytes: null, sha256: null, truncated: false },
      },
    };
    const classified = classifyAndroidDriverHostSample({
      sampledAt: '2026-09-30T20:00:00.000Z',
      status: 'passed',
      ownedProcesses: owned,
      observedProcesses: [owned[0], { pid: 201, started: 'Wed Sep 30 20:00:01 2026' }],
    });
    assert.deepEqual(classified.ownedPidStarts, [owned[0]]);
    assert.deepEqual(classified.unmatchedPidStarts, [
      { pid: 201, started: 'Wed Sep 30 20:00:01 2026' },
    ]);
    const result = await recordAndroidDriverHostSamples({
      readinessArtifactRoot: root,
      target,
      samples: [
        {
          sampledAt: '2026-09-30T20:00:00.000Z',
          status: 'failed',
          ownedProcesses: owned,
          observedProcesses: null,
          originalCause: firstCause,
        },
        {
          sampledAt: '2026-09-30T20:00:10.000Z',
          status: 'passed',
          ownedProcesses: owned,
          observedProcesses: [owned[0]],
        },
      ],
    });
    assert.equal(result.receipt.status, 'failed');
    assert.deepEqual(result.receipt.firstCause, firstCause);
    assert.equal(result.receipt.sampleCount, 2);
    assert.equal(result.receipt.maxSamples, 20);
    assert.equal(result.receipt.sampleIntervalMs, 10_000);
    const output = JSON.parse(await readFile(result.outputPath, 'utf8')) as {
      samples: { status: string; observedPidStarts: unknown }[];
      firstCause: unknown;
    };
    assert.equal(output.samples[0].status, 'failed');
    assert.equal(output.samples[0].observedPidStarts, null);
    assert.deepEqual(output.firstCause, firstCause);
    await assertPrivateFile(result.outputPath);
    await assertPrivateFile(result.receiptPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('host sampling records unknown failed queries and enforces the twenty-sample ten-second bound', async () => {
  const root = await privateRoot();
  try {
    const unknown = await recordAndroidDriverHostSamples({
      readinessArtifactRoot: root,
      target,
      samples: [
        {
          sampledAt: '2026-09-30T20:00:00.000Z',
          status: 'unknown',
          ownedProcesses: [],
          observedProcesses: null,
        },
      ],
    });
    assert.equal(unknown.receipt.status, 'unknown');
    assert.equal(unknown.receipt.firstCause?.kind, 'unknown');
    assert.throws(
      () =>
        classifyAndroidDriverHostSample({
          sampledAt: '2026-09-30T20:00:00.000Z',
          status: 'blocked' as never,
          ownedProcesses: [],
          observedProcesses: null,
        }),
      /Invalid Android driver host sample status/,
    );
    await assert.rejects(
      recordAndroidDriverHostSamples({
        readinessArtifactRoot: root,
        target,
        samples: [
          {
            sampledAt: '2026-09-30T20:00:00.000Z',
            status: 'passed',
            ownedProcesses: [],
            observedProcesses: [],
          },
          {
            sampledAt: '2026-09-30T20:00:09.000Z',
            status: 'passed',
            ownedProcesses: [],
            observedProcesses: [],
          },
        ],
      }),
      /at least 10 seconds/,
    );
    await assert.rejects(
      recordAndroidDriverHostSamples({
        readinessArtifactRoot: root,
        target,
        samples: Array.from({ length: 21 }, (_, index) => ({
          sampledAt: new Date(
            Date.parse('2026-09-30T21:00:00.000Z') + index * 10_000,
          ).toISOString(),
          status: 'passed' as const,
          ownedProcesses: [],
          observedProcesses: [],
        })),
      }),
      /sample limit exceeded/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

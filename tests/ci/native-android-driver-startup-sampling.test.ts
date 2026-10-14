import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  androidDriverDiagnosticMetadataMaxBytes,
  androidDriverHostSampleLimit,
  androidDriverHostSampleIntervalMs,
  type AndroidDriverDiagnosticTarget,
} from '../../scripts/testing/native-android-driver-diagnostics';
import { startAndroidDriverStartupSampling } from '../../scripts/testing/native-android-driver-startup-sampling';

const target: AndroidDriverDiagnosticTarget = {
  captureRunId: 'capture-run',
  ownerRunId: 'owner-run',
  serial: 'emulator-5554',
  adbServerPort: 31001,
};

const owned = [{ pid: 200, started: 'Wed Sep 30 20:00:00 2026' }];

async function privateRoot() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-android-startup-sampling-')),
  );
  await chmod(root, 0o700);
  return root;
}

class ManualScheduler {
  pending: { callback: () => void; delayMs: number; cancelled: boolean }[] = [];

  schedule = (callback: () => void, delayMs: number) => {
    const entry = { callback, delayMs, cancelled: false };
    this.pending.push(entry);
    return entry;
  };

  cancel = (handle: unknown) => {
    (handle as { cancelled: boolean }).cancelled = true;
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function host(knownJobs = owned) {
  return {
    status: knownJobs.length ? ('contended' as const) : ('no-known-job' as const),
    knownJobs,
  };
}

void test('samples immediately, schedules at ten-second intervals, and records private owned evidence', async () => {
  const root = await privateRoot();
  const scheduler = new ManualScheduler();
  let clock = Date.parse('2026-09-30T20:00:00.000Z');
  let ownedCalls = 0;
  try {
    const sampler = await startAndroidDriverStartupSampling({
      artifactRoot: root,
      readinessLabel: 'entry-readiness',
      target,
      ownedProcesses: () => {
        ownedCalls++;
        return Promise.resolve(owned);
      },
      inspectHost: () => Promise.resolve(host()),
      now: () => clock,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    assert.equal(ownedCalls, 1);
    assert.equal(scheduler.pending.length, 1);
    assert.equal(scheduler.pending[0].delayMs, androidDriverHostSampleIntervalMs);
    clock += androidDriverHostSampleIntervalMs;
    const next = scheduler.pending.shift()!;
    next.callback();
    await flush();
    assert.equal(ownedCalls, 2);
    const result = await sampler.stop();
    assert.strictEqual(await sampler.stop(), result);
    assert.equal(result.blocked, false);
    assert.equal(result.receipt.status, 'passed');
    assert.equal(result.receipt.sampleCount, 2);
    assert(
      result.outputPath.endsWith(
        'entry-readiness-driver-sampling/android-driver-host-sampling.stdout.private.log',
      ),
    );
    const samplingRoot = path.dirname(result.outputPath);
    const rootMetadata = await lstat(samplingRoot);
    assert.equal(rootMetadata.uid, process.getuid?.());
    assert.equal(rootMetadata.mode & 0o777, 0o700);
    const payload = JSON.parse(await readFile(result.outputPath, 'utf8')) as {
      samples: { ownedPidStarts: unknown[]; unmatchedPidStarts: unknown[] }[];
    };
    assert.deepEqual(payload.samples[0].ownedPidStarts, [owned[0]]);
    assert.deepEqual(payload.samples[0].unmatchedPidStarts, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('does not overlap a pending census and stop drains it before recording', async () => {
  const root = await privateRoot();
  const scheduler = new ManualScheduler();
  let clock = Date.parse('2026-09-30T20:00:00.000Z');
  let resolveOwned: ((value: typeof owned) => void) | undefined;
  let ownedCalls = 0;
  try {
    const sampler = await startAndroidDriverStartupSampling({
      artifactRoot: root,
      readinessLabel: 'coach-home-readiness',
      target,
      ownedProcesses: () => {
        ownedCalls++;
        if (ownedCalls === 1) return Promise.resolve(owned);
        return new Promise((resolve) => {
          resolveOwned = resolve;
        });
      },
      inspectHost: () => Promise.resolve(host()),
      now: () => clock,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    clock += androidDriverHostSampleIntervalMs;
    const next = scheduler.pending.shift()!;
    next.callback();
    next.callback();
    await flush();
    assert.equal(ownedCalls, 2);
    let stopped = false;
    const stopping = sampler.stop().then((value) => {
      stopped = true;
      return value;
    });
    await flush();
    assert.equal(stopped, false);
    resolveOwned!(owned);
    const result = await stopping;
    assert.equal(result.receipt.sampleCount, 2);
    assert.equal(result.blocked, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('stops scheduling after twenty samples and still records all samples', async () => {
  const root = await privateRoot();
  const scheduler = new ManualScheduler();
  let clock = Date.parse('2026-09-30T20:00:00.000Z');
  let ownedCalls = 0;
  try {
    const sampler = await startAndroidDriverStartupSampling({
      artifactRoot: root,
      readinessLabel: 'training-load-readiness',
      target,
      ownedProcesses: () => {
        ownedCalls++;
        return Promise.resolve(owned);
      },
      inspectHost: () => Promise.resolve(host()),
      now: () => clock,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    while (ownedCalls < androidDriverHostSampleLimit) {
      const next = scheduler.pending.shift();
      assert(next);
      clock += next.delayMs;
      next.callback();
      await flush();
    }
    assert.equal(ownedCalls, androidDriverHostSampleLimit);
    assert.equal(scheduler.pending.length, 0);
    const result = await sampler.stop();
    assert.equal(result.receipt.sampleCount, androidDriverHostSampleLimit);
    assert.equal(result.blocked, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('foreign jobs and unavailable census are blocked while preserving the first cause', async () => {
  const foreignRoot = await privateRoot();
  const unavailableRoot = await privateRoot();
  try {
    const foreignSampler = await startAndroidDriverStartupSampling({
      artifactRoot: foreignRoot,
      readinessLabel: 'connection-states-readiness',
      target,
      ownedProcesses: () => Promise.resolve(owned),
      inspectHost: () => Promise.resolve(host([{ pid: 201, started: 'Wed Sep 30 20:00:01 2026' }])),
      now: () => Date.parse('2026-09-30T20:00:00.000Z'),
      schedule: schedulerNever,
      cancel: () => undefined,
    });
    const foreign = await foreignSampler.stop();
    assert.equal(foreign.receipt.status, 'passed');
    assert.equal(foreign.blocked, true);
    const foreignPayload = JSON.parse(await readFile(foreign.outputPath, 'utf8')) as {
      samples: { unmatchedPidStarts: unknown[] }[];
    };
    assert.deepEqual(foreignPayload.samples[0].unmatchedPidStarts, [
      { pid: 201, started: 'Wed Sep 30 20:00:01 2026' },
    ]);

    const unavailableSampler = await startAndroidDriverStartupSampling({
      artifactRoot: unavailableRoot,
      readinessLabel: 'entry-login-readiness',
      target,
      ownedProcesses: () => Promise.resolve(owned),
      inspectHost: () =>
        Promise.reject(new Error('x'.repeat(androidDriverDiagnosticMetadataMaxBytes * 8))),
      now: () => Date.parse('2026-09-30T20:00:00.000Z'),
      schedule: schedulerNever,
      cancel: () => undefined,
    });
    const unavailable = await unavailableSampler.stop();
    assert.equal(unavailable.receipt.status, 'failed');
    assert.equal(unavailable.blocked, true);
    assert.equal(
      Buffer.byteLength(unavailable.receipt.firstCause?.message ?? ''),
      androidDriverDiagnosticMetadataMaxBytes,
    );
    assert.equal(unavailable.receipt.firstCause?.metadata.message.truncated, true);
  } finally {
    await rm(foreignRoot, { recursive: true, force: true });
    await rm(unavailableRoot, { recursive: true, force: true });
  }
});

const schedulerNever = (_callback: () => void, _delayMs: number) => undefined;

void test('rejects non-private roots and colliding readiness sampling directories', async () => {
  const root = await privateRoot();
  const publicationRoot = await privateRoot();
  try {
    await chmod(root, 0o755);
    await assert.rejects(
      startAndroidDriverStartupSampling({
        artifactRoot: root,
        readinessLabel: 'entry-readiness',
        target,
        ownedProcesses: () => Promise.resolve(owned),
        inspectHost: () => Promise.resolve(host()),
      }),
      /canonical, private and owned/,
    );
    await chmod(root, 0o700);
    await assert.rejects(
      startAndroidDriverStartupSampling({
        artifactRoot: root,
        readinessLabel: '../arbitrary-path',
        target,
        ownedProcesses: () => Promise.resolve(owned),
        inspectHost: () => Promise.resolve(host()),
      }),
      /Invalid Android driver readiness label/,
    );
    await mkdir(path.join(root, 'entry-readiness-driver-sampling'), { mode: 0o700 });
    await assert.rejects(
      startAndroidDriverStartupSampling({
        artifactRoot: root,
        readinessLabel: 'entry-readiness',
        target,
        ownedProcesses: () => Promise.resolve(owned),
        inspectHost: () => Promise.resolve(host()),
      }),
      /EEXIST|already exists|file exists/i,
    );
    const sampler = await startAndroidDriverStartupSampling({
      artifactRoot: publicationRoot,
      readinessLabel: 'entry-readiness',
      target,
      ownedProcesses: () => Promise.resolve(owned),
      inspectHost: () => Promise.resolve(host()),
      schedule: schedulerNever,
      cancel: () => undefined,
    });
    await writeFile(
      path.join(
        publicationRoot,
        'entry-readiness-driver-sampling',
        'android-driver-host-sampling.stdout.private.log',
      ),
      'existing',
      { flag: 'wx', mode: 0o600 },
    );
    await assert.rejects(sampler.stop(), /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(publicationRoot, { recursive: true, force: true });
  }
});

void test('an early timer rearms until the strict sample interval and stop cancels it', async () => {
  const root = await privateRoot();
  const scheduler = new ManualScheduler();
  let clock = Date.parse('2026-09-30T20:00:00.000Z');
  let ownedCalls = 0;
  try {
    const sampler = await startAndroidDriverStartupSampling({
      artifactRoot: root,
      readinessLabel: 'camera-student-home-readiness',
      target,
      ownedProcesses: () => {
        ownedCalls++;
        return Promise.resolve(owned);
      },
      inspectHost: () => Promise.resolve(host()),
      now: () => clock,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    clock += androidDriverHostSampleIntervalMs - 1;
    scheduler.pending.shift()!.callback();
    await flush();
    assert.equal(ownedCalls, 1);
    assert.equal(scheduler.pending[0].delayMs, 1);
    clock += 1;
    scheduler.pending.shift()!.callback();
    await flush();
    assert.equal(ownedCalls, 2);
    clock += androidDriverHostSampleIntervalMs - 1;
    scheduler.pending.shift()!.callback();
    await flush();
    assert.equal(ownedCalls, 2);
    const pending = scheduler.pending[0];
    const result = await sampler.stop();
    assert.equal(pending.cancelled, true);
    assert.equal(result.blocked, false);
    assert.equal(result.receipt.sampleCount, 2);
    pending.callback();
    await flush();
    assert.equal(ownedCalls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessHostCapacity,
  countCompetingBuildProcesses,
  loadAverageMultiplier,
  memAvailableFloorBytes,
  parseMemAvailableBytes,
  readCompetingBuildProcessCount,
  readMemAvailableBytes,
  resolveOwnAvdName,
  waitForHostCapacity,
  type HostCapacitySnapshot,
} from '../../scripts/ci/wait-for-host-capacity';

function quietSnapshot(): HostCapacitySnapshot {
  return {
    loadAverage1m: 1,
    cpuCount: 16,
    memAvailableBytes: 8 * 1024 * 1024 * 1024,
    competingBuildProcessCount: 0,
  };
}

test('assessHostCapacity reports a quiet host as uncontended', () => {
  assert.deepEqual(assessHostCapacity(quietSnapshot()), { contended: false, reasons: [] });
});

test('assessHostCapacity flags load average above the CPU-relative ceiling', () => {
  const snapshot = quietSnapshot();
  snapshot.loadAverage1m = snapshot.cpuCount * loadAverageMultiplier + 0.01;
  const assessment = assessHostCapacity(snapshot);
  assert.equal(assessment.contended, true);
  assert.equal(assessment.reasons.length, 1);
  assert.match(assessment.reasons[0], /load average/);
});

test('assessHostCapacity flags available memory under the fixed floor', () => {
  const snapshot = quietSnapshot();
  snapshot.memAvailableBytes = memAvailableFloorBytes - 1;
  const assessment = assessHostCapacity(snapshot);
  assert.equal(assessment.contended, true);
  assert.match(assessment.reasons[0], /available memory/);
});

test('assessHostCapacity flags any competing sibling-runner build/emulator process', () => {
  const snapshot = quietSnapshot();
  snapshot.competingBuildProcessCount = 1;
  const assessment = assessHostCapacity(snapshot);
  assert.equal(assessment.contended, true);
  assert.match(assessment.reasons[0], /competing native build\/emulator process/);
});

test('assessHostCapacity accumulates every contention reason at once', () => {
  const assessment = assessHostCapacity({
    loadAverage1m: 100,
    cpuCount: 16,
    memAvailableBytes: 0,
    competingBuildProcessCount: 3,
  });
  assert.equal(assessment.contended, true);
  assert.equal(assessment.reasons.length, 3);
});

test('parseMemAvailableBytes reads the MemAvailable field from /proc/meminfo text', () => {
  const meminfo = [
    'MemTotal:       32826192 kB',
    'MemFree:         2107392 kB',
    'MemAvailable:   14680064 kB',
    '',
  ].join('\n');
  assert.equal(parseMemAvailableBytes(meminfo), 14680064 * 1024);
});

test('parseMemAvailableBytes returns undefined when the field is absent', () => {
  assert.equal(parseMemAvailableBytes('MemTotal:       32826192 kB\n'), undefined);
});

test('countCompetingBuildProcesses counts a sibling GradleDaemon unconditionally', () => {
  const ps = [
    '  PID CMD',
    '  100 /usr/bin/java -Xmx2g -cp gradle-launcher.jar GradleDaemon 8.14',
    '  101 /bin/bash -c sleep 60',
  ].join('\n');
  assert.equal(countCompetingBuildProcesses(ps, 'Pixel_10'), 1);
});

test("countCompetingBuildProcesses ignores this job's own emulator by AVD name", () => {
  const ps = [
    '  PID CMD',
    '  200 qemu-system-x86_64 -avd Pixel_10 -no-window -gpu swiftshader_indirect',
  ].join('\n');
  assert.equal(countCompetingBuildProcesses(ps, 'Pixel_10'), 0);
});

test("countCompetingBuildProcesses ignores this job's own emulator in real qemu @avd form", () => {
  // The `emulator` launcher re-execs into qemu-system-x86_64 naming the AVD
  // as a bare `@<avd>` argument, not `-avd <avd>`. Confirmed against a live
  // process on the CI host: `qemu-system-x86_64-headless @Pixel_10 -port
  // 5556 -no-audio -no-boot-anim -no-window -no-snapshot -read-only -gpu
  // swiftshader_indirect`.
  const ps = [
    '  PID CMD',
    '  200 /home/eduwaldo/Android/Sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64-headless @Pixel_10 -port 5556 -no-audio -no-boot-anim -no-window -no-snapshot -read-only -gpu swiftshader_indirect',
  ].join('\n');
  assert.equal(countCompetingBuildProcesses(ps, 'Pixel_10'), 0);
});

test('countCompetingBuildProcesses counts a sibling emulator in real qemu @avd form', () => {
  const ps = [
    '  PID CMD',
    '  201 /home/eduwaldo/Android/Sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64-headless @GuiaBrecho_API34 -port 5554 -no-window',
  ].join('\n');
  assert.equal(countCompetingBuildProcesses(ps, 'Pixel_10'), 1);
});

test('countCompetingBuildProcesses counts a sibling emulator running a different AVD', () => {
  const ps = [
    '  PID CMD',
    '  201 qemu-system-x86_64 -avd GuiaBrecho_API34 -no-window -gpu swiftshader_indirect',
  ].join('\n');
  assert.equal(countCompetingBuildProcesses(ps, 'Pixel_10'), 1);
});

test('countCompetingBuildProcesses counts multiple distinct competing processes', () => {
  const ps = [
    '  PID CMD',
    '  100 /usr/bin/java -cp gradle-launcher.jar GradleDaemon 8.14',
    '  201 qemu-system-x86_64 -avd GuiaBrecho_API34 -no-window',
  ].join('\n');
  assert.equal(countCompetingBuildProcesses(ps, 'Pixel_10'), 2);
});

test('waitForHostCapacity returns immediately without sleeping when the host is quiet', async () => {
  let sleepCalls = 0;
  await waitForHostCapacity('Pixel_10', {
    snapshot: quietSnapshot,
    sleep: async () => {
      sleepCalls += 1;
    },
    log: () => {},
  });
  assert.equal(sleepCalls, 0);
});

test('waitForHostCapacity polls with backoff until the host calms down, then proceeds', async () => {
  let call = 0;
  const contendedThenQuiet = () => {
    call += 1;
    return call < 3
      ? { loadAverage1m: 100, cpuCount: 16, memAvailableBytes: 8e9, competingBuildProcessCount: 0 }
      : quietSnapshot();
  };
  let sleepCalls = 0;
  let clock = 0;
  await waitForHostCapacity('Pixel_10', {
    snapshot: contendedThenQuiet,
    now: () => clock,
    sleep: async (ms) => {
      sleepCalls += 1;
      clock += ms;
    },
    maxWaitMs: 60_000,
    pollIntervalMs: 1_000,
    log: () => {},
  });
  assert.equal(sleepCalls, 2);
  assert.equal(call, 3);
});

test('waitForHostCapacity gives up after its bounded wait budget and proceeds anyway', async () => {
  let clock = 0;
  let sleepCalls = 0;
  const messages: string[] = [];
  await waitForHostCapacity('Pixel_10', {
    snapshot: () => ({
      loadAverage1m: 100,
      cpuCount: 16,
      memAvailableBytes: 8e9,
      competingBuildProcessCount: 0,
    }),
    now: () => clock,
    sleep: async (ms) => {
      sleepCalls += 1;
      clock += ms;
    },
    maxWaitMs: 5_000,
    pollIntervalMs: 2_000,
    log: (message) => messages.push(message),
  });
  assert.equal(sleepCalls, 3);
  assert.match(messages[messages.length - 1], /proceeding anyway/);
});

test('resolveOwnAvdName trims and returns a configured MYCHAMPIONS_ANDROID_AVD', () => {
  assert.equal(resolveOwnAvdName({ MYCHAMPIONS_ANDROID_AVD: '  Custom_AVD  ' }), 'Custom_AVD');
});

test('resolveOwnAvdName defaults to Pixel_10 when the env var is unset or blank', () => {
  assert.equal(resolveOwnAvdName({}), 'Pixel_10');
  assert.equal(resolveOwnAvdName({ MYCHAMPIONS_ANDROID_AVD: '   ' }), 'Pixel_10');
});

// These two exercise the real, unmocked OS-facing code paths (actual
// /proc/meminfo and an actual `ps` invocation) that every other test in this
// file bypasses via injected snapshot/sleep/log fakes. They're deliberately
// loose sanity checks — the goal is to catch wiring bugs (wrong `ps` flags,
// a meminfo parse regression, an unhandled throw) rather than to assert a
// specific host state.
test('readMemAvailableBytes reads a real, positive value from this host', () => {
  const bytes = readMemAvailableBytes();
  assert.ok(
    Number.isFinite(bytes) && bytes > 0,
    `expected a positive available-memory byte count, got ${bytes}`,
  );
});

test('readCompetingBuildProcessCount runs the real `ps` command without throwing', () => {
  const count = readCompetingBuildProcessCount('__no-avd-should-ever-be-named-this__');
  assert.ok(
    Number.isInteger(count) && count >= 0,
    `expected a non-negative integer process count, got ${count}`,
  );
});

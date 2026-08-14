import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, loadavg, freemem } from 'node:os';
import { pathToFileURL } from 'node:url';

// Evidence: on 2026-08-14, mychampions's self-hosted "Selected Android Detox
// suites" job (emulator serial emulator-5556) failed with shifting signatures
// (adb command storms, an Espresso IdlingResourceTimeoutException on
// device.launchApp(), a save-button enable timeout) across consecutive runs
// of the same branch with no code changes in between. Cross-referencing CI
// run timestamps against the sibling `meer` self-hosted runner (same
// physical host, 5 independent runners total) showed meer's
// "firebase-distribution" job ran a cold `gradlew clean assembleDevRelease`
// (fresh Gradle Daemon, kotlinc/javac/dexing) from 18:14:38-18:18:50 UTC,
// directly overlapping mychampions's Detox window (18:06:09-18:21:32 UTC),
// with a failure at 18:21:00 shortly after. Host swap was observed at ~91%
// utilized. mychampions's own native build already runs with `--no-daemon`,
// so any live GradleDaemon process on this host is, by construction, a
// sibling repo's build, not mychampions's own.
//
// This module is a bounded, observational preflight: it never blocks CI
// indefinitely and never fails the job on its own account. It only gives a
// contended host a chance to calm down before the RAM/CPU-heavy emulator
// boot and before Detox launches the app under test.

export type HostCapacitySnapshot = {
  loadAverage1m: number;
  cpuCount: number;
  memAvailableBytes: number;
  competingBuildProcessCount: number;
};

export type HostCapacityAssessment = {
  contended: boolean;
  reasons: string[];
};

export const memAvailableFloorBytes = 2 * 1024 * 1024 * 1024; // 2 GiB
export const loadAverageMultiplier = 1.5;

export function assessHostCapacity(snapshot: HostCapacitySnapshot): HostCapacityAssessment {
  const reasons: string[] = [];

  if (snapshot.cpuCount > 0) {
    const loadCeiling = snapshot.cpuCount * loadAverageMultiplier;
    if (snapshot.loadAverage1m > loadCeiling) {
      reasons.push(
        `1-minute load average ${snapshot.loadAverage1m.toFixed(2)} exceeds ${loadCeiling.toFixed(2)} (${
          snapshot.cpuCount
        } CPUs x ${loadAverageMultiplier})`,
      );
    }
  }

  if (snapshot.memAvailableBytes < memAvailableFloorBytes) {
    reasons.push(
      `available memory ${Math.round(snapshot.memAvailableBytes / 1024 / 1024)} MiB is below the ${Math.round(
        memAvailableFloorBytes / 1024 / 1024,
      )} MiB floor`,
    );
  }

  if (snapshot.competingBuildProcessCount > 0) {
    reasons.push(
      `${snapshot.competingBuildProcessCount} competing native build/emulator process(es) detected from sibling CI runners`,
    );
  }

  return { contended: reasons.length > 0, reasons };
}

export function parseMemAvailableBytes(procMeminfo: string): number | undefined {
  const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(procMeminfo);
  return match ? Number(match[1]) * 1024 : undefined;
}

// mychampions runs its native Android build with `--no-daemon` (see
// "Run native checks and build the debug APKs once" in
// trusted-selective-tests.yml), so it never leaves a GradleDaemon process
// behind; any GradleDaemon process observed here belongs to a sibling
// runner. Emulator processes are only "competing" when they name a
// different AVD than this job's own (each repo on this host owns a distinct
// AVD name). The `emulator` launcher re-execs into qemu-system-x86_64 with
// the AVD named as a bare `@<avd>` argument rather than `-avd <avd>`
// (confirmed against a live process: `qemu-system-x86_64-headless @Pixel_10
// -port 5556 ...`). Only that confirmed qemu-system-x86_64/crash-service form
// is currently pattern-matched below; a bare, not-yet-re-exec'd `emulator
// -avd <avd>` wrapper line would not be recognized as an emulator process at
// all (neither counted as competing nor excluded as our own) until it
// re-execs. That window has been observed to be effectively instantaneous in
// practice, so it is left unhandled rather than matched speculatively without
// a confirmed live sample of that exact process line.
export function countCompetingBuildProcesses(psOutput: string, ownAvdName: string): number {
  const ownAvdMarkers = ownAvdName ? [`-avd ${ownAvdName}`, `@${ownAvdName}`] : [];
  let count = 0;
  for (const line of psOutput.split('\n')) {
    if (!line.trim()) continue;
    const isGradleDaemon = /GradleDaemon/.test(line);
    const isEmulator = /qemu-system-x86_64|emulator64-crash-service/.test(line);
    if (!isGradleDaemon && !isEmulator) continue;
    if (isEmulator && ownAvdMarkers.some((marker) => line.includes(marker))) continue;
    count += 1;
  }
  return count;
}

export function readMemAvailableBytes(): number {
  try {
    const parsed = parseMemAvailableBytes(readFileSync('/proc/meminfo', 'utf8'));
    if (parsed !== undefined) return parsed;
    console.error(
      'Android host capacity check: /proc/meminfo has no MemAvailable field; falling back to freemem().',
    );
  } catch (error) {
    // Non-Linux host or /proc unavailable: fall back to a conservative signal.
    console.error(
      'Android host capacity check: could not read /proc/meminfo; falling back to freemem().',
      error,
    );
  }
  return freemem();
}

export function readCompetingBuildProcessCount(ownAvdName: string): number {
  try {
    const output = execFileSync('ps', ['-eo', 'pid,cmd'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return countCompetingBuildProcesses(output, ownAvdName);
  } catch (error) {
    console.error(
      'Android host capacity check: `ps -eo pid,cmd` failed; assuming zero competing processes.',
      error,
    );
    return 0;
  }
}

function snapshotHostCapacity(ownAvdName: string): HostCapacitySnapshot {
  return {
    loadAverage1m: loadavg()[0] ?? 0,
    cpuCount: cpus().length,
    memAvailableBytes: readMemAvailableBytes(),
    competingBuildProcessCount: readCompetingBuildProcessCount(ownAvdName),
  };
}

const defaultPollIntervalMs = 10_000;
const defaultMaxWaitMs = 3 * 60_000; // Bounded: never delays the job by more than 3 minutes.

export async function waitForHostCapacity(
  ownAvdName: string,
  options: {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    snapshot?: () => HostCapacitySnapshot;
    log?: (message: string) => void;
  } = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
  const maxWaitMs = options.maxWaitMs ?? defaultMaxWaitMs;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const snapshot = options.snapshot ?? (() => snapshotHostCapacity(ownAvdName));
  const log = options.log ?? ((message: string) => console.log(message));

  const deadline = now() + maxWaitMs;
  for (;;) {
    const assessment = assessHostCapacity(snapshot());
    if (!assessment.contended) {
      log('Android host capacity check: host looks quiet, proceeding.');
      return;
    }
    if (now() >= deadline) {
      log(
        `Android host capacity check: still contended after a ${Math.round(
          maxWaitMs / 1000,
        )}s wait budget (${assessment.reasons.join('; ')}); proceeding anyway.`,
      );
      return;
    }
    log(
      `Android host capacity check: host is contended (${assessment.reasons.join('; ')}); waiting ${Math.round(
        pollIntervalMs / 1000,
      )}s before rechecking.`,
    );
    await sleep(pollIntervalMs);
  }
}

const defaultOwnAvdName = 'Pixel_10';

// Exported so the fallback-selection logic itself is directly testable
// without exercising the real host (ps/proc) or the network-free but still
// async waitForHostCapacity loop.
export function resolveOwnAvdName(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env.MYCHAMPIONS_ANDROID_AVD?.trim();
  if (!configured) {
    // The workflow always supplies MYCHAMPIONS_ANDROID_AVD from the
    // android-slot step's output, so this should be unreachable in CI; if it
    // ever does fire (local run, misconfiguration), log loudly rather than
    // silently guessing an AVD name that could misclassify this job's own
    // emulator as a sibling's.
    console.error(
      `Android host capacity check: MYCHAMPIONS_ANDROID_AVD is not set; defaulting to "${defaultOwnAvdName}" for own-process exclusion.`,
    );
    return defaultOwnAvdName;
  }
  return configured;
}

async function main(): Promise<void> {
  await waitForHostCapacity(resolveOwnAvdName(process.env));
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    // This is an observational gate only: never fail the job over it.
    console.error('Android host capacity check failed unexpectedly; proceeding anyway.', error);
  });
}

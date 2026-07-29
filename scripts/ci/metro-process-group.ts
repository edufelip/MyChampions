import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

type ProcessSignal = NodeJS.Signals | 0;

export type MetroProcessGroupRuntime = {
  platform: NodeJS.Platform;
  currentPid: number;
  currentUid: number | undefined;
  killProcess: (pid: number, signal: ProcessSignal) => void;
  readProcessTable: () => Promise<string>;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
};

export type StopMetroProcessGroupOptions = {
  exitTimeoutMs?: number;
  pollIntervalMs?: number;
  runtime?: Partial<MetroProcessGroupRuntime>;
};

export type StopRunnerOwnedProcessGroupOptions = StopMetroProcessGroupOptions;

function readProcessTable(): Promise<string> {
  return new Promise((resolveResult, reject) => {
    execFile(
      'ps',
      ['-axo', 'pid=,pgid=,uid='],
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 5_000,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolveResult(stdout);
      }
    );
  });
}

function defaultRuntime(): MetroProcessGroupRuntime {
  return {
    platform: process.platform,
    currentPid: process.pid,
    currentUid: typeof process.getuid === 'function' ? process.getuid() : undefined,
    killProcess: (pid, signal) => {
      process.kill(pid, signal);
    },
    readProcessTable,
    now: () => Date.now(),
    delay: (milliseconds) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  };
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

export function parseOwnedProcessGroupPids(
  processTable: string,
  processGroupId: number,
  ownerUid: number
): number[] {
  const ownedPids = new Set<number>();

  for (const line of processTable.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fields = trimmed.split(/\s+/);
    if (fields.length !== 3) {
      throw new Error(`Cannot parse process table row: ${trimmed}`);
    }

    const [pidValue, processGroupValue, uidValue] = fields.map(Number);
    if (
      !Number.isSafeInteger(pidValue) ||
      !Number.isSafeInteger(processGroupValue) ||
      !Number.isSafeInteger(uidValue)
    ) {
      throw new Error(`Cannot parse process table row: ${trimmed}`);
    }

    if (processGroupValue === processGroupId && uidValue === ownerUid) {
      ownedPids.add(pidValue);
    }
  }

  return [...ownedPids].sort((left, right) => left - right);
}

async function ownedProcessGroupPids(
  processGroupId: number,
  runtime: MetroProcessGroupRuntime,
  label: string
): Promise<number[]> {
  if (runtime.currentUid === undefined) {
    throw new Error(
      `Cannot inspect ${label} ${processGroupId}: current UID is unavailable`
    );
  }

  const ownedPids = parseOwnedProcessGroupPids(
    await runtime.readProcessTable(),
    processGroupId,
    runtime.currentUid
  );
  if (ownedPids.includes(runtime.currentPid)) {
    throw new Error(
      `Refusing to clean ${label} ${processGroupId}: it contains the selective executor`
    );
  }
  return ownedPids;
}

async function metroProcessGroupExists(
  metro: ChildProcess,
  runtime: MetroProcessGroupRuntime,
  label: string
): Promise<boolean> {
  if (runtime.platform === 'win32' || metro.pid === undefined) {
    return metro.exitCode === null && metro.signalCode === null;
  }

  try {
    runtime.killProcess(-metro.pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    if (errorCode(error) === 'EPERM') {
      // Darwin reports EPERM when any group member is not signalable, so
      // inspect the group and retain only processes owned by the runner UID.
      return (await ownedProcessGroupPids(metro.pid, runtime, label)).length > 0;
    }
    throw error;
  }
}

async function signalMetroProcessGroup(
  metro: ChildProcess,
  signal: NodeJS.Signals,
  runtime: MetroProcessGroupRuntime,
  label: string
): Promise<void> {
  if (runtime.platform === 'win32' || metro.pid === undefined) {
    if (metro.exitCode === null && metro.signalCode === null) metro.kill(signal);
    return;
  }

  try {
    runtime.killProcess(-metro.pid, signal);
    return;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return;
    if (errorCode(error) !== 'EPERM') throw error;
  }

  const ownedPids = await ownedProcessGroupPids(metro.pid, runtime, label);
  for (const pid of ownedPids) {
    try {
      runtime.killProcess(pid, signal);
    } catch (error) {
      if (errorCode(error) === 'ESRCH') continue;
      throw new Error(
        `Cannot send ${signal} to ${label} member ${pid}: ${
          errorCode(error) ?? String(error)
        }`
      );
    }
  }
}

async function waitForMetroProcessGroupExit(
  metro: ChildProcess,
  timeoutMs: number,
  pollIntervalMs: number,
  runtime: MetroProcessGroupRuntime,
  label: string
): Promise<boolean> {
  const deadline = runtime.now() + timeoutMs;
  while (runtime.now() < deadline) {
    if (!(await metroProcessGroupExists(metro, runtime, label))) return true;
    await runtime.delay(pollIntervalMs);
  }
  return !(await metroProcessGroupExists(metro, runtime, label));
}

async function stopProcessGroup(
  child: ChildProcess,
  label: string,
  options: StopRunnerOwnedProcessGroupOptions
): Promise<void> {
  const runtime = { ...defaultRuntime(), ...options.runtime };
  const exitTimeoutMs = options.exitTimeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;

  if (!(await metroProcessGroupExists(child, runtime, label))) return;
  await signalMetroProcessGroup(child, 'SIGTERM', runtime, label);
  if (
    await waitForMetroProcessGroupExit(
      child,
      exitTimeoutMs,
      pollIntervalMs,
      runtime,
      label
    )
  ) {
    return;
  }

  await signalMetroProcessGroup(child, 'SIGKILL', runtime, label);
  if (
    !(await waitForMetroProcessGroupExit(
      child,
      exitTimeoutMs,
      pollIntervalMs,
      runtime,
      label
    ))
  ) {
    throw new Error(`${label} did not stop after SIGKILL`);
  }
}

export async function stopRunnerOwnedProcessGroup(
  child: ChildProcess,
  options: StopRunnerOwnedProcessGroupOptions = {}
): Promise<void> {
  return stopProcessGroup(child, 'Runner-owned child process group', options);
}

export async function stopMetroProcessGroup(
  metro: ChildProcess,
  options: StopMetroProcessGroupOptions = {}
): Promise<void> {
  return stopProcessGroup(
    metro,
    'Runner-owned Metro process group',
    options
  );
}

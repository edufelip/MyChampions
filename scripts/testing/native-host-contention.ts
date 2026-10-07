import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type ProcessRow = {
  pid: number;
  ppid: number;
  uid: number;
  stat: string;
  started: string;
  command: string;
};
export type NativeHostJob = {
  pid: number;
  ppid: number;
  uid: number;
  started: string;
  kind: 'detox' | 'maestro' | 'native-capture' | 'xcode' | 'gradle-build';
  commandHash: string;
};
export type NativeHostSnapshot = {
  kind: 'native-host-known-job-census';
  inspectedAt: string;
  callerPid: number;
  status: 'contended' | 'no-known-job';
  knownJobs: NativeHostJob[];
};

function classify(command: string): NativeHostJob['kind'] | undefined {
  const tokens = command.trim().split(/\s+/);
  const executable = path.basename(tokens[0] ?? '');
  if (['node', 'nodejs'].includes(executable)) {
    let i = 1;
    while (tokens[i]?.startsWith('-')) {
      if (['--import', '--require', '-r'].includes(tokens[i])) i += 2;
      else if (tokens[i] === '--no-warnings' || tokens[i].startsWith('--import=')) i++;
      else return undefined;
    }
    const file = tokens[i] ?? '';
    const args = tokens.slice(i + 1);
    if (
      (path.basename(file) === 'detox' || /\/detox\/local-cli\/cli\.js$/.test(file)) &&
      ['test', 'build'].includes(args[0])
    )
      return 'detox';
    if (
      ['capture-native-testability.ts', 'capture-android-testability.ts'].includes(
        path.basename(file),
      )
    )
      return 'native-capture';
  }
  if (
    executable === 'java' &&
    tokens.includes('maestro.cli.AppKt') &&
    tokens.some((value) => ['test', 'hierarchy', 'record', 'tap', 'launchApp'].includes(value))
  )
    return 'maestro';
  if (
    executable === 'maestro' &&
    tokens.some((value) => ['test', 'hierarchy', 'record', 'tap', 'launchApp'].includes(value))
  )
    return 'maestro';
  if (
    executable === 'xcodebuild' &&
    !tokens.some((value) =>
      ['-version', '-list', '-showsdks', '-showBuildSettings'].includes(value),
    )
  )
    return 'xcode';
  if (
    executable === 'java' &&
    tokens.some((value) =>
      ['org.gradle.launcher.GradleMain', 'org.gradle.wrapper.GradleWrapperMain'].includes(value),
    )
  )
    return 'gradle-build';
  if (
    executable === 'gradlew' ||
    (['bash', 'sh'].includes(executable) && path.basename(tokens[1] ?? '') === 'gradlew')
  )
    return 'gradle-build';
  return undefined;
}

/** Strict POSIX census; only known executable shapes count as active native jobs. */
export function nativeHostJobsFromCensus(census: string, callerPid: number): NativeHostJob[] {
  if (!Number.isSafeInteger(callerPid) || callerPid < 2)
    throw new Error('Invalid native census caller');
  const rows: ProcessRow[] = [];
  for (const line of census.split('\n').filter((line) => line.trim())) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/.exec(line);
    if (!match) throw new Error('Native host process census unavailable');
    const [pid, ppid, uid] = match.slice(1, 4).map(Number);
    if (
      [pid, ppid, uid].some((value) => !Number.isSafeInteger(value)) ||
      pid < 1 ||
      ppid < 0 ||
      uid < 0 ||
      rows.some((row) => row.pid === pid) ||
      !Number.isFinite(Date.parse(match[5].trim()))
    )
      throw new Error('Native host process census unavailable');
    rows.push({ pid, ppid, uid, stat: match[4], started: match[5].trim(), command: match[6] });
  }
  const caller = rows.find((row) => row.pid === callerPid);
  if (!caller || caller.stat.startsWith('Z'))
    throw new Error('Native host caller absent from census');
  const ancestors = new Set<number>();
  let cursor: ProcessRow | undefined = caller;
  while (cursor) {
    if (ancestors.has(cursor.pid)) throw new Error('Native host census ancestry cycle');
    ancestors.add(cursor.pid);
    if (cursor.ppid <= 1) break;
    cursor = rows.find((row) => row.pid === cursor!.ppid);
    if (!cursor) throw new Error('Native host census ancestry unavailable');
  }
  return rows.flatMap((row) => {
    if (ancestors.has(row.pid) || row.stat.startsWith('Z')) return [];
    const kind = classify(row.command);
    if (!kind) return [];
    return [
      {
        pid: row.pid,
        ppid: row.ppid,
        uid: row.uid,
        started: row.started,
        kind,
        commandHash: createHash('sha256').update(row.command).digest('hex'),
      },
    ];
  });
}

export async function inspectNativeHostContention(): Promise<NativeHostSnapshot> {
  if (process.platform === 'win32') throw new Error('Native host census requires POSIX');
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,ruid=,stat=,lstart=,command='], {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  const knownJobs = nativeHostJobsFromCensus(stdout, process.pid);
  return {
    kind: 'native-host-known-job-census',
    inspectedAt: new Date().toISOString(),
    callerPid: process.pid,
    status: knownJobs.length ? 'contended' : 'no-known-job',
    knownJobs,
  };
}
export class NativeHostContentionError extends Error {
  constructor(readonly stage: 'preflight' | 'command-boundary' = 'preflight') {
    super(
      stage === 'preflight'
        ? 'Native host has a live competing native job; no resources acquired'
        : 'Native host has a live competing native job; next command not started',
    );
  }
}
/** Advisory read-only guard, supplementary to the existing lock and cleanup checks. */
export async function requireNativeHostAvailability(artifactRoot: string) {
  const snapshot = await inspectNativeHostContention();
  await writeFile(
    path.join(artifactRoot, 'native-host-census.private.json'),
    JSON.stringify(snapshot, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  if (snapshot.status === 'contended') throw new NativeHostContentionError();
  return snapshot;
}

/** Check between owned commands, never while one of this caller's engine children is active. */
export async function requireNativeHostAvailabilityAtStep(artifactRoot: string, label: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(label))
    throw new Error('Unsafe native host boundary label');
  const snapshot = { ...(await inspectNativeHostContention()), boundaryLabel: label };
  await writeFile(
    path.join(artifactRoot, `native-host-step-${label}.private.json`),
    JSON.stringify(snapshot, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  if (snapshot.status === 'contended') throw new NativeHostContentionError('command-boundary');
  return snapshot;
}

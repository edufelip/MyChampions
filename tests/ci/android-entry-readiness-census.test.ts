import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

type InspectedProcess = {
  pid: number;
  pgid: number;
  uid: number;
  started: string;
  command: string;
  commandHash: string;
};
type CommandCensusRequery = {
  unavailable: { pid: number }[];
  current: { pid: number }[];
  result: string;
};
type ObserveOwnedCommandCensus = (options: {
  read: () => Promise<InspectedProcess[]>;
  relevant: (row: InspectedProcess) => boolean;
  onRequery?: (event: CommandCensusRequery) => void;
  requireAvailable?: boolean;
  boundary?: (rows: readonly InspectedProcess[]) => void;
  darwin?: boolean;
  settle?: {
    untilMonotonicMs: number;
    delayMs?: number;
    maxRequeries?: number;
    now?: () => number;
    signal?: AbortSignal;
    sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  };
}) => Promise<InspectedProcess[]>;

const require = createRequire(__filename);

const testRoot = process.env.ANDROID_ENTRY_READINESS_TEST_ROOT ?? path.resolve(__dirname, '../..');
const candidateSource =
  process.env.ANDROID_ENTRY_READINESS_CANDIDATE_SOURCE ??
  path.join(testRoot, 'scripts/testing/capture-android-testability.ts');
const ownedProcessGroup = require(
  path.join(testRoot, 'scripts/testing/owned-process-group.ts'),
) as {
  observeOwnedCommandCensus: ObserveOwnedCommandCensus;
  requireOwnedCensusUserBoundary: (rows: readonly InspectedProcess[]) => void;
};
const { observeOwnedCommandCensus, requireOwnedCensusUserBoundary } = ownedProcessGroup;

const uid = process.getuid!();
const hash = (command: string) => {
  // The production observer compares only the unavailable-command predicate in
  // this control; the hash still remains a deterministic diagnostic field.
  let value = 0;
  for (const character of command) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value.toString(16).padStart(8, '0').repeat(8);
};
const row = (
  input: Partial<InspectedProcess> & Pick<InspectedProcess, 'pid' | 'pgid' | 'started' | 'command'>,
): InspectedProcess => ({
  uid,
  commandHash: hash(input.command),
  ...input,
});
const leader = row({
  pid: 43387,
  pgid: 43387,
  started: 'Sun Oct  4 19:28:09 2026',
  command: '/opt/maestro/bin/maestro test entry-readiness.yaml',
});
const unavailable = (pid: number, started: string) =>
  row({ pid, pgid: leader.pgid, started, command: '(java)' });

void test('V24 replacement turnover settles under the command deadline without adopting Java placeholders', async () => {
  const oldChild = unavailable(44275, 'Sun Oct  4 19:28:19 2026');
  const replacement = unavailable(44319, 'Sun Oct  4 19:28:20 2026');
  const snapshots = [[leader, oldChild], [leader, replacement], [leader]];
  const events: CommandCensusRequery[] = [];
  let reads = 0;
  let now = 0;
  const result = await observeOwnedCommandCensus({
    read: () => Promise.resolve(snapshots[Math.min(reads++, snapshots.length - 1)]),
    relevant: (candidate) => candidate.pgid === leader.pgid,
    onRequery: (event) => events.push(event),
    requireAvailable: true,
    boundary: requireOwnedCensusUserBoundary,
    darwin: true,
    settle: {
      untilMonotonicMs: 180_000,
      delayMs: 50,
      maxRequeries: 8,
      now: () => now,
      sleep: (delayMs) => {
        now += delayMs;
        return Promise.resolve();
      },
    },
  });
  assert.deepEqual(
    result.map(({ pid }) => pid),
    [leader.pid],
  );
  assert.equal(reads, 3);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events[0].unavailable.map(({ pid }) => pid),
    [oldChild.pid],
  );
  assert.deepEqual(
    events[0].current.map(({ pid }) => pid),
    [leader.pid, replacement.pid],
  );
  assert.deepEqual(
    events[1].unavailable.map(({ pid }) => pid),
    [replacement.pid],
  );
  assert.deepEqual(
    events[1].current.map(({ pid }) => pid),
    [leader.pid],
  );
});

void test('V24 unresolved argv stays blocked at the original deadline', async () => {
  const child = unavailable(44275, 'Sun Oct  4 19:28:19 2026');
  const events: CommandCensusRequery[] = [];
  let reads = 0;
  let now = 0;
  await assert.rejects(
    observeOwnedCommandCensus({
      read: () => Promise.resolve([leader, child]),
      relevant: (candidate) => candidate.pgid === leader.pgid,
      onRequery: (event) => events.push(event),
      requireAvailable: true,
      boundary: requireOwnedCensusUserBoundary,
      darwin: true,
      settle: {
        untilMonotonicMs: 120,
        delayMs: 50,
        maxRequeries: 8,
        now: () => now,
        sleep: (delayMs) => {
          reads++;
          now += delayMs;
          return Promise.resolve();
        },
      },
    }),
    /census deadline/,
  );
  assert.equal(reads, 3);
  assert(events.length >= 3);
  assert(events.every((event) => event.result === 'unavailable'));
});

void test('V24 settling still rejects a foreign replacement at the census boundary', async () => {
  const child = unavailable(44275, 'Sun Oct  4 19:28:19 2026');
  const foreign = { ...unavailable(44319, 'Sun Oct  4 19:28:20 2026'), uid: uid + 1 };
  let reads = 0;
  await assert.rejects(
    observeOwnedCommandCensus({
      read: () => Promise.resolve(++reads === 1 ? [leader, child] : [leader, foreign]),
      relevant: (candidate) => candidate.pgid === leader.pgid,
      requireAvailable: true,
      boundary: requireOwnedCensusUserBoundary,
      darwin: true,
      settle: {
        untilMonotonicMs: 10_000,
        delayMs: 50,
        maxRequeries: 8,
        now: () => 0,
        sleep: () => Promise.resolve(),
      },
    }),
    /foreign user or caller/,
  );
  assert.equal(reads, 2);
});

void test('V24 cancellation cannot be converted into a settled ownership result', async () => {
  const controller = new AbortController();
  const child = unavailable(44275, 'Sun Oct  4 19:28:19 2026');
  let sleepCalls = 0;
  await assert.rejects(
    observeOwnedCommandCensus({
      read: () => Promise.resolve([leader, child]),
      relevant: (candidate) => candidate.pgid === leader.pgid,
      requireAvailable: true,
      boundary: requireOwnedCensusUserBoundary,
      darwin: true,
      settle: {
        untilMonotonicMs: 10_000,
        delayMs: 50,
        maxRequeries: 8,
        now: () => 0,
        signal: controller.signal,
        sleep: () => {
          sleepCalls++;
          controller.abort();
          return Promise.resolve();
        },
      },
    }),
    /aborted/i,
  );
  assert.equal(sleepCalls, 1);
});

void test('candidate passes the original command deadline and cancellation to the passive sampler census', async () => {
  const source = await readFile(candidateSource, 'utf8');
  assert.match(
    source,
    /commandDeadlineAtMonotonicMs = Math\.min\([\s\S]*performance\.now\(\) \+ resolvedDeadlineMs,[\s\S]*wholeCaptureDeadlineAtMonotonicMs/,
  );
  assert.match(
    source,
    /child\.capture\(true,\s*\{[\s\S]*untilMonotonicMs: commandDeadlineAtMonotonicMs/,
  );
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /maxRequeries: 8/);
});

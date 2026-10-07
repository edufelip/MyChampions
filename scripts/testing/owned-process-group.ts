import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { constants } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { inspectNativeHostContention } from './native-host-contention';
import type { ChildProcess } from 'node:child_process';

const execute = promisify(execFile);
export type OwnedProcess = {
  pid: number;
  pgid: number;
  started: string;
  commandHash: string;
};

export type OwnedProcessExecution = {
  pid: number;
  pgid: number;
  started: string;
  previousCommandHash: string;
  commandHash: string;
};

export type InspectedProcess = OwnedProcess & { uid: number; command: string };
export type CommandCensusRequery = {
  observedAt: string;
  unavailable: (OwnedProcess & { uid: number })[];
  current: (OwnedProcess & { uid: number })[];
  result: 'available' | 'unavailable';
};

/**
 * Optional settling for a strict census during a known startup phase. Every
 * observation is still boundary-checked and the absolute deadline belongs to
 * the caller; this never creates a new resource or adopts an unavailable argv.
 */
export type OwnedCommandCensusSettleOptions = {
  untilMonotonicMs: number;
  delayMs?: number;
  maxRequeries?: number;
  now?: () => number;
  signal?: AbortSignal;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

export type ProcessCensusQueryFailure = {
  exitCode: number | null;
  errorCode: string | null;
  killed: boolean | null;
  signal: NodeJS.Signals | null;
  timeoutMs: number;
  maxBufferBytes: number;
  stdout: { bytes: number; sha256: string } | null;
  stderr: { bytes: number; sha256: string } | null;
};

const censusTimeoutMs = 5000;
const censusMaxBufferBytes = 8 * 1024 * 1024;
const queryErrorCodes = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ETIMEDOUT',
  'ENOMEM',
  'EMFILE',
  'ENFILE',
  'EINVAL',
  'E2BIG',
  'EIO',
  'EAGAIN',
  'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
]);

/** Never persist arbitrary error messages, argv or census output containing foreign processes. */
export class OwnedProcessCensusQueryError extends Error {
  readonly queryFailure: ProcessCensusQueryFailure;

  constructor(error: unknown) {
    super('Owned worker process census query failed');
    this.name = 'OwnedProcessCensusQueryError';
    const source = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    const output = (value: unknown) => {
      if (typeof value !== 'string' && !Buffer.isBuffer(value)) return null;
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
      return {
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    };
    this.queryFailure = {
      exitCode:
        typeof source.code === 'number' && Number.isSafeInteger(source.code) && source.code >= 0
          ? source.code
          : null,
      errorCode:
        typeof source.code === 'string' && queryErrorCodes.has(source.code) ? source.code : null,
      killed: typeof source.killed === 'boolean' ? source.killed : null,
      signal:
        typeof source.signal === 'string' && Object.hasOwn(constants.signals, source.signal)
          ? (source.signal as NodeJS.Signals)
          : null,
      timeoutMs: censusTimeoutMs,
      maxBufferBytes: censusMaxBufferBytes,
      stdout: output(source.stdout),
      stderr: output(source.stderr),
    };
  }
}

export class OwnedCommandCensusUnavailableError extends Error {
  constructor() {
    super('Owned worker command census unavailable');
    this.name = 'OwnedCommandCensusUnavailableError';
  }
}

/** Darwin ps prints this fallback when it cannot read argv; it is not a verified exec. */
export function darwinPsCommandUnavailable(command: string) {
  return /^\([^\r\n()]+\)$/.test(command);
}

/** Use one fresh census by default; startup callers may opt into bounded settling. */
export function requireAvailableOwnedCommandCensus(
  rows: readonly InspectedProcess[],
  relevant: (row: InspectedProcess) => boolean,
) {
  if (rows.some((row) => relevant(row) && darwinPsCommandUnavailable(row.command)))
    throw new OwnedCommandCensusUnavailableError();
  return [...rows];
}

async function inspectProcesses(
  relevant: (row: InspectedProcess) => boolean,
  onRequery?: (event: CommandCensusRequery) => void,
  requireAvailable = true,
  boundary?: (rows: readonly InspectedProcess[]) => void,
  settle?: OwnedCommandCensusSettleOptions,
): Promise<InspectedProcess[]> {
  const settleNow = settle?.now ?? (() => performance.now());
  const assertSettleActive = () => {
    if (!settle) return;
    settle.signal?.throwIfAborted();
    if (Math.floor(settle.untilMonotonicMs - settleNow()) <= 0)
      throw new Error('Owned worker census deadline');
  };
  const read = async () => {
    assertSettleActive();
    const remainingMs = settle
      ? Math.floor(settle.untilMonotonicMs - settleNow())
      : censusTimeoutMs;
    const result = await execute('ps', ['-axo', 'pid=,pgid=,ruid=,stat=,lstart=,command='], {
      encoding: 'buffer',
      timeout: settle ? Math.min(censusTimeoutMs, remainingMs) : censusTimeoutMs,
      maxBuffer: censusMaxBufferBytes,
      signal: settle?.signal,
      env: { ...process.env, LC_ALL: 'C' },
    }).catch((error: unknown) => {
      settle?.signal?.throwIfAborted();
      throw new OwnedProcessCensusQueryError(error);
    });
    return result.stdout
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim())
      .flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.*)$/.exec(line);
        if (!match) throw new Error('Owned worker census unavailable');
        if (match[4].startsWith('Z')) return [];
        return [
          {
            pid: Number(match[1]),
            pgid: Number(match[2]),
            uid: Number(match[3]),
            started: match[5].trim(),
            command: match[6],
            commandHash: createHash('sha256').update(match[6]).digest('hex'),
          },
        ];
      });
  };
  return observeOwnedCommandCensus({
    read,
    relevant,
    onRequery,
    requireAvailable,
    boundary,
    settle,
  });
}

/** Observations retain unknown argv; only an available strict census grants authority. */
export async function observeOwnedCommandCensus(options: {
  read: () => Promise<InspectedProcess[]>;
  relevant: (row: InspectedProcess) => boolean;
  onRequery?: (event: CommandCensusRequery) => void;
  requireAvailable?: boolean;
  boundary?: (rows: readonly InspectedProcess[]) => void;
  darwin?: boolean;
  settle?: OwnedCommandCensusSettleOptions;
}) {
  const { read, relevant, onRequery, boundary } = options;
  const isDarwin = options.darwin ?? process.platform === 'darwin';
  const settle = options.settle;
  const settleNow = settle?.now ?? (() => performance.now());
  const assertSettleActive = () => {
    if (!settle) return;
    settle.signal?.throwIfAborted();
    if (Math.floor(settle.untilMonotonicMs - settleNow()) <= 0)
      throw new Error('Owned worker census deadline');
  };
  const readFresh = async () => {
    assertSettleActive();
    const rows = await read();
    // A census that completed after the caller's deadline cannot authorize a
    // signal, even when its argv is now readable.
    assertSettleActive();
    return rows;
  };
  if (settle) {
    if (!Number.isFinite(settle.untilMonotonicMs) || settle.untilMonotonicMs <= 0)
      throw new Error('Invalid owned census settling deadline');
    if (
      settle.delayMs !== undefined &&
      (!Number.isSafeInteger(settle.delayMs) || settle.delayMs < 1)
    )
      throw new Error('Invalid owned census settling delay');
    if (
      settle.maxRequeries !== undefined &&
      (!Number.isSafeInteger(settle.maxRequeries) || settle.maxRequeries < 1)
    )
      throw new Error('Invalid owned census settling bound');
  }
  const unavailableRows = (rows: readonly InspectedProcess[]) =>
    isDarwin ? rows.filter((row) => relevant(row) && darwinPsCommandUnavailable(row.command)) : [];
  const diagnostic = (row: InspectedProcess) => ({
    ...ownership(row),
    uid: row.uid,
  });
  let first = await readFresh();
  let unavailable = unavailableRows(first);
  if (unavailable.length === 0) {
    boundary?.(first.filter(relevant));
    return first;
  }

  // Each event is a bounded absence observation. Unknown argv never enters
  // ownership; only a later all-available census can authorize the caller.
  let requeryCount = 0;
  for (;;) {
    const event: CommandCensusRequery = {
      observedAt: new Date().toISOString(),
      unavailable: unavailable.map(diagnostic),
      current: [],
      result: 'unavailable',
    };
    onRequery?.(event);
    boundary?.(first.filter(relevant));
    const current = await readFresh();
    const currentRelevant = current.filter(relevant);
    const currentUnavailable = unavailableRows(current);
    event.current = currentRelevant.map(diagnostic);
    event.result = currentUnavailable.length === 0 ? 'available' : 'unavailable';
    // Validate every fresh boundary, including a settling observation. A
    // foreign user/caller or a changed verified leader is fatal immediately.
    boundary?.(currentRelevant);
    if (currentUnavailable.length === 0) return current;
    if (options.requireAvailable === false) return current;
    if (!settle) return requireAvailableOwnedCommandCensus(current, relevant);

    assertSettleActive();
    requeryCount += 1;
    const maxRequeries = settle.maxRequeries ?? 8;
    if (requeryCount >= maxRequeries) return requireAvailableOwnedCommandCensus(current, relevant);
    const remainingMs = Math.floor(settle.untilMonotonicMs - settleNow());
    if (remainingMs <= 0) throw new Error('Owned worker census deadline');
    const delayMs = Math.min(settle.delayMs ?? 50, remainingMs);
    const sleep =
      settle.sleep ??
      ((value: number, signal?: AbortSignal) => delay(value, undefined, { signal }));
    await sleep(delayMs, settle.signal);
    assertSettleActive();
    first = current;
    unavailable = currentUnavailable;
  }
}

export function requireOwnedCensusUserBoundary(rows: readonly InspectedProcess[]) {
  if (rows.some((row) => row.pid === process.pid || row.uid !== process.getuid?.()))
    throw new Error('Owned worker group includes foreign user or caller');
}

/** Inspection does not establish ownership; callers must compare an acquired record. */
export async function inspectProcessIdentity(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid process identity');
  return (await inspectProcesses((row) => row.pid === pid)).find((row) => row.pid === pid);
}

function ownership(row: InspectedProcess): OwnedProcess {
  return {
    pid: row.pid,
    pgid: row.pgid,
    started: row.started,
    commandHash: row.commandHash,
  };
}

/** A reused PID with a different start is a different process, never an escaped owned child. */
export function escapedOwnedProcesses<T extends OwnedProcess>(
  census: readonly T[],
  pgid: number,
  acquired: ReadonlyMap<number, OwnedProcess>,
) {
  return census.filter(
    (row) => row.pgid !== pgid && acquired.get(row.pid)?.started === row.started,
  );
}

/** A changed group does not confer ownership of its other members. */
export function requireOwnedProcessIdentity(
  expected: OwnedProcess,
  observed: OwnedProcess & { uid: number },
) {
  if (
    observed.pid === process.pid ||
    observed.uid !== process.getuid?.() ||
    observed.pid !== expected.pid ||
    observed.started !== expected.started ||
    observed.commandHash !== expected.commandHash
  )
    throw new Error('Owned worker process identity changed; recovery ledger retained');
}

/** Inspect one detached group, rejecting other users and the calling process. */
export async function groupProcesses(
  pgid: number,
  onRequery?: (event: CommandCensusRequery) => void,
): Promise<OwnedProcess[]> {
  if (!Number.isSafeInteger(pgid) || pgid < 2 || process.platform === 'win32')
    throw new Error('Owned process groups require a valid POSIX identity');
  return (
    await inspectProcesses(
      (row) => row.pgid === pgid,
      onRequery,
      true,
      requireOwnedCensusUserBoundary,
    )
  )
    .filter((row) => row.pgid === pgid)
    .map((row) => {
      requireOwnedProcessIdentity(row, row);
      return ownership(row);
    });
}

/** Absence observation only: retains unknown argv and exposes no signal-authorizing hashes. */
export async function observeGroupProcesses(
  pgid: number,
  onRequery?: (event: CommandCensusRequery) => void,
): Promise<{ pid: number; started: string }[]> {
  if (!Number.isSafeInteger(pgid) || pgid < 2 || process.platform === 'win32')
    throw new Error('Owned process groups require a valid POSIX identity');
  return (
    await inspectProcesses(
      (row) => row.pgid === pgid,
      onRequery,
      false,
      requireOwnedCensusUserBoundary,
    )
  )
    .filter((row) => row.pgid === pgid)
    .map((row) => ({ pid: row.pid, started: row.started }));
}

/** Shared-service release needs exclusive listener ownership and no consumers. */
export function requireOwnedAdbConsumerBoundary(input: {
  pid: number;
  listenerPids: number[];
  devicePayload: string;
  foreignJobCount: number;
}) {
  if (
    !Number.isSafeInteger(input.pid) ||
    input.pid < 2 ||
    input.listenerPids.some((pid) => !Number.isSafeInteger(pid) || pid < 2) ||
    [...new Set(input.listenerPids)].join(',') !== String(input.pid) ||
    input.foreignJobCount !== 0 ||
    input.devicePayload.trim()
  )
    throw new Error('Owned ADB resource has an ambiguous listener or foreign consumer');
}

/** Raw read-only ADB protocol: never launches a replacement server. */
async function requireUnusedAdbServer(row: InspectedProcess, ownedPids: Set<number>) {
  if (
    !/^(?:\S*\/)?adb -L tcp:5037 (?:fork-server server --reply-fd \d+|nodaemon server)$/.test(
      row.command,
    )
  )
    throw new Error('Unrecognized escaped shared ADB resource');
  const listener = await execute('lsof', ['-nP', '-tiTCP:5037', '-sTCP:LISTEN'], { timeout: 2000 });
  const listenerPids = listener.stdout.trim().split(/\s+/).map(Number);
  requireOwnedAdbConsumerBoundary({
    pid: row.pid,
    listenerPids,
    devicePayload: '',
    foreignJobCount: 0,
  });
  const host = await inspectNativeHostContention();
  if (host.knownJobs.some((job) => !ownedPids.has(job.pid)))
    throw new Error('Owned ADB server has a foreign native consumer');
  const payload = await readOnlyAdbDevicePayload();
  requireOwnedAdbConsumerBoundary({
    pid: row.pid,
    listenerPids,
    devicePayload: payload,
    foreignJobCount: (await inspectNativeHostContention()).knownJobs.filter(
      (job) => !ownedPids.has(job.pid),
    ).length,
  });
}

/** Fixed loopback/default port only. Does not execute adb or start a service. */
export async function readOnlyAdbDevicePayload(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: 5037 });
    let bytes = Buffer.alloc(0);
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(2000, () => fail(new Error('Owned ADB device query timed out')));
    socket.once('error', fail);
    socket.once('connect', () => {
      const command = 'host:devices-l';
      socket.write(command.length.toString(16).padStart(4, '0') + command);
    });
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 65536) return fail(new Error('Owned ADB device query too large'));
      if (bytes.length < 8) return;
      if (
        bytes.subarray(0, 4).toString() !== 'OKAY' ||
        !/^[0-9a-fA-F]{4}$/.test(bytes.subarray(4, 8).toString())
      )
        return fail(new Error('Owned ADB device query invalid'));
      const length = parseInt(bytes.subarray(4, 8).toString(), 16);
      if (bytes.length >= 8 + length) {
        socket.destroy();
        resolve(bytes.subarray(8, 8 + length).toString());
      }
    });
    socket.once('end', () => fail(new Error('Owned ADB device query ended prematurely')));
    socket.once('close', () => fail(new Error('Owned ADB device query closed prematurely')));
  });
}

/** Caller must have directly spawned this child with detached:true. */
export async function trackOwnedProcessGroup(
  child: ChildProcess,
  ledgerPath: string,
  cleanupMode: 'step' | 'build' = 'step',
  initialSettle?: OwnedCommandCensusSettleOptions,
) {
  if (!['step', 'build'].includes(cleanupMode)) throw new Error('Invalid owned cleanup mode');
  const naturalExitGraceMs = cleanupMode === 'build' ? 5000 : 1000;
  if (!child.pid) throw new Error('Owned worker failed to start');
  const pgid = child.pid;
  const owned = new Map<number, OwnedProcess>();
  const escapedProcesses: OwnedProcess[] = [];
  const escapedSignals: {
    pid: number;
    started: string;
    commandHash: string;
    signal: string;
    sharedAdbChecked: boolean;
  }[] = [];
  const leaderExecutions: {
    started: string;
    previousCommandHash: string;
    commandHash: string;
  }[] = [];
  const processExecutions: OwnedProcessExecution[] = [];
  const commandCensusRequeries: CommandCensusRequery[] = [];
  let cleanup = 'running';
  let latestCensus:
    | {
        observedAt: string;
        strict: boolean;
        groupMembers: OwnedProcess[];
        escapedCandidates: OwnedProcess[];
      }
    | undefined;
  let stopPromise: Promise<void> | undefined;
  let rejectedCensus: { census: typeof latestCensus; reason: string } | undefined;
  const persist = async () => {
    const temporary = `${ledgerPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify(
          {
            kind: 'private worker process ownership',
            pid: pgid,
            pgid,
            processes: [...owned.values()],
            leaderExecutions,
            processExecutions,
            commandCensusRequeries,
            escapedProcesses,
            escapedSignals,
            cleanupMode,
            naturalExitGraceMs,
            cleanup,
            latestCensus,
            rejectedCensus,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: 'wx' },
      );
      await rename(temporary, ledgerPath);
    } finally {
      await rm(temporary, { force: true });
    }
  };
  const captureOnce = async (
    requireVerified: boolean,
    settle?: OwnedCommandCensusSettleOptions,
  ) => {
    const captureBoundary = (rows: readonly InspectedProcess[]) => {
      requireOwnedCensusUserBoundary(rows);
      if (!requireVerified) return;
      const expected = owned.get(pgid);
      const leader = rows.find((row) => row.pid === pgid);
      if (
        expected &&
        leader &&
        (leader.started !== expected.started || leader.pgid !== expected.pgid)
      )
        throw new Error('Owned worker process identity changed; recovery ledger retained');
    };
    const census = await inspectProcesses(
      (row) => row.pgid === pgid || owned.get(row.pid)?.started === row.started,
      (event) => commandCensusRequeries.push(event),
      requireVerified,
      captureBoundary,
      settle,
    );
    const current = census.filter((row) => row.pgid === pgid);
    const escaped = escapedOwnedProcesses(census, pgid, owned);
    latestCensus = {
      observedAt: new Date().toISOString(),
      strict: requireVerified,
      groupMembers: current.map(ownership),
      escapedCandidates: escaped.map(ownership),
    };
    for (const row of current) {
      if (row.pid === process.pid || row.uid !== process.getuid?.())
        throw new Error('Owned worker group includes foreign user or caller');
    }
    const leader = current.find((row) => row.pid === pgid);
    const expected = owned.get(pgid);
    // POSIX exec replaces the directly spawned launcher's command without
    // changing its PID, start time, user or group. Keep the command transition
    // as evidence; a reused PID or an orphan's unknown descendants are not exec.
    const sameLiveChild =
      leader &&
      expected &&
      !darwinPsCommandUnavailable(leader.command) &&
      leader.started === expected.started &&
      child.exitCode === null &&
      child.signalCode === null;
    if (sameLiveChild && leader.commandHash !== expected.commandHash) {
      leaderExecutions.push({
        started: leader.started,
        previousCommandHash: expected.commandHash,
        commandHash: leader.commandHash,
      });
      owned.set(pgid, ownership(leader));
    }
    if (
      leader &&
      !darwinPsCommandUnavailable(leader.command) &&
      (!expected ||
        (leader.started === expected.started && leader.commandHash === expected.commandHash) ||
        sameLiveChild)
    ) {
      for (const row of current) {
        if (darwinPsCommandUnavailable(row.command)) continue;
        const previous = owned.get(row.pid);
        if (previous && (previous.started !== row.started || previous.pgid !== row.pgid)) {
          if (requireVerified) throw new Error('Owned worker process identity changed');
          continue;
        }
        if (previous && previous.commandHash !== row.commandHash) {
          // A process-group member may exec in place just like the direct
          // leader. It remains signal-authorized only when it is already
          // owned, has the same start/PGID/user identity, exposes an
          // available command, and the directly spawned child is still live.
          // New members, PID reuse, group changes, foreign users and unknown
          // argv never enter this adoption path.
          const sameLiveOwnedProcess =
            row.pid !== pgid &&
            previous.started === row.started &&
            previous.pgid === row.pgid &&
            !darwinPsCommandUnavailable(row.command) &&
            child.exitCode === null &&
            child.signalCode === null;
          if (sameLiveOwnedProcess) {
            processExecutions.push({
              pid: row.pid,
              pgid: row.pgid,
              started: row.started,
              previousCommandHash: previous.commandHash,
              commandHash: row.commandHash,
            });
            owned.set(row.pid, ownership(row));
            continue;
          }
          if (requireVerified) throw new Error('Owned worker process identity changed');
          continue;
        }
        owned.set(row.pid, ownership(row));
      }
    }
    for (const row of current) {
      const previous = owned.get(row.pid);
      if (
        requireVerified &&
        (!previous || previous.started !== row.started || previous.commandHash !== row.commandHash)
      )
        throw new Error('Unverified worker group member; recovery ledger retained');
    }
    for (const row of escaped) {
      if (requireVerified) requireOwnedProcessIdentity(owned.get(row.pid)!, row);
      else if (
        row.uid !== process.getuid?.() ||
        row.started !== owned.get(row.pid)!.started ||
        row.commandHash !== owned.get(row.pid)!.commandHash
      )
        continue;
      if (
        !escapedProcesses.some((previous) => previous.pid === row.pid && previous.pgid === row.pgid)
      )
        escapedProcesses.push(ownership(row));
    }
    // External controllers may observe the live child only through this ledger.
    // Publish the owner's confirmed exec transitions before returning the census.
    await persist();
    return [...current, ...escaped];
  };
  let captureTail: Promise<void> = Promise.resolve();
  const capture = (requireVerified = false, settle?: OwnedCommandCensusSettleOptions) => {
    const next = captureTail.then(async () => {
      try {
        return await captureOnce(requireVerified, settle);
      } catch (error) {
        if (requireVerified && latestCensus?.strict && !rejectedCensus) {
          rejectedCensus = {
            census: structuredClone(latestCensus),
            reason: (error as Error).message,
          };
          await persist();
        }
        if (commandCensusRequeries.length > 0) await persist();
        throw error;
      }
    });
    // A failed query remains a failure for its caller, but does not prevent a
    // later strict cleanup query from independently inspecting current state.
    captureTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const signal = async (value: 'SIGTERM' | 'SIGKILL', settle?: OwnedCommandCensusSettleOptions) => {
    let current = await capture(true, settle);
    const checkedServers = new Set<string>();
    // A daemon may still share the original group. Its consumers must be
    // checked before a group signal too, not only after it detaches.
    for (const row of current.filter(
      (row) =>
        row.pgid === pgid &&
        /(?:^|\/)adb\s.*\b(?:fork-server server|nodaemon server)\b/.test(row.command),
    )) {
      await requireUnusedAdbServer(row, new Set(owned.keys()));
      checkedServers.add(`${row.pid}:${row.started}:${row.commandHash}`);
    }
    // Shared-resource queries may take time. Reverify the whole original
    // group immediately before signalling; a newly arrived server is unknown.
    current = await capture(true, settle);
    for (const row of current.filter(
      (row) =>
        row.pgid === pgid &&
        /(?:^|\/)adb\s.*\b(?:fork-server server|nodaemon server)\b/.test(row.command),
    ))
      if (!checkedServers.has(`${row.pid}:${row.started}:${row.commandHash}`))
        throw new Error('Unchecked shared ADB resource appeared during cleanup');
    if (current.some((row) => row.pgid === pgid)) process.kill(-pgid, value);
    for (const escaped of current.filter((row) => row.pgid !== pgid)) {
      // Reinspect before each exact-PID signal, never signal the escaped group.
      let row = (
        await inspectProcesses(
          (observed) => observed.pid === escaped.pid,
          (event) => commandCensusRequeries.push(event),
          true,
          requireOwnedCensusUserBoundary,
          settle,
        )
      ).find((observed) => observed.pid === escaped.pid);
      if (!row) continue;
      requireOwnedProcessIdentity(owned.get(row.pid)!, row);
      const sharedAdbChecked = /(?:^|\/)adb\s.*\b(?:fork-server server|nodaemon server)\b/.test(
        row.command,
      );
      if (sharedAdbChecked) await requireUnusedAdbServer(row, new Set(owned.keys()));
      row = (
        await inspectProcesses(
          (observed) => observed.pid === escaped.pid,
          (event) => commandCensusRequeries.push(event),
          true,
          requireOwnedCensusUserBoundary,
          settle,
        )
      ).find((observed) => observed.pid === escaped.pid);
      if (!row) continue;
      requireOwnedProcessIdentity(owned.get(row.pid)!, row);
      process.kill(row.pid, value);
      escapedSignals.push({
        pid: row.pid,
        started: row.started,
        commandHash: row.commandHash,
        signal: value,
        sharedAdbChecked,
      });
    }
  };
  const stop = (settle?: OwnedCommandCensusSettleOptions) => {
    stopPromise ??= (async () => {
      try {
        const assertStopActive = () => {
          if (!settle) return;
          settle.signal?.throwIfAborted();
          if (
            !Number.isFinite(settle.untilMonotonicMs) ||
            performance.now() >= settle.untilMonotonicMs
          )
            throw new Error('Owned worker stop deadline');
        };
        // Compiler helpers may exec or detach while a finished build shuts down.
        // Observe bounded natural exit; drift never grants permission to signal.
        const naturalExitDeadline = Math.min(
          performance.now() + naturalExitGraceMs,
          settle?.untilMonotonicMs ?? Number.POSITIVE_INFINITY,
        );
        while (performance.now() < naturalExitDeadline) {
          assertStopActive();
          try {
            const current = await capture(true, settle);
            // A valid census is permission to signal, not proof that a compiler
            // finished shutting down. Give build processes the same bounded
            // natural-exit window even while their identities still match.
            if (cleanupMode === 'step' || current.length === 0) break;
          } catch {
            // Unknown identities may disappear naturally, never be adopted.
          }
          await delay(100);
        }
        assertStopActive();
        await signal('SIGTERM', settle);
        const deadline = Math.min(
          performance.now() + 5000,
          settle?.untilMonotonicMs ?? Number.POSITIVE_INFINITY,
        );
        while ((await capture(false, settle)).length && performance.now() < deadline) {
          assertStopActive();
          await delay(100);
        }
        assertStopActive();
        if ((await capture(false, settle)).length) await signal('SIGKILL', settle);
        const killDeadline = Math.min(
          performance.now() + 3000,
          settle?.untilMonotonicMs ?? Number.POSITIVE_INFINITY,
        );
        while ((await capture(false, settle)).length && performance.now() < killDeadline) {
          assertStopActive();
          await delay(100);
        }
        assertStopActive();
        if ((await capture(false, settle)).length)
          throw new Error('Owned worker group did not stop');
        cleanup = 'cleaned';
      } catch (error) {
        cleanup = 'failed-recovery-ledger-retained';
        throw error;
      } finally {
        await persist();
      }
    })();
    return stopPromise;
  };
  try {
    await capture(false, initialSettle);
    await persist();
  } catch (error) {
    cleanup = 'failed-recovery-ledger-retained';
    await persist();
    throw error;
  }
  return { pgid, capture, stop };
}

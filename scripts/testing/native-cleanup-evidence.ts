import assert from 'node:assert/strict';
export type ProcessIdentity = { pid: number; started: string };
export type SimDeviceList = { devices: Record<string, { udid: string; state: string }[]> };

export function devices(value: SimDeviceList): Map<string, string> {
  assert(value && typeof value === 'object' && value.devices);
  const result = new Map<string, string>();
  for (const rows of Object.values(value.devices)) {
    assert(Array.isArray(rows));
    for (const row of rows) {
      assert(typeof row.udid === 'string' && typeof row.state === 'string');
      assert(!result.has(row.udid), 'Duplicate simulator identity');
      result.set(row.udid, row.state);
    }
  }
  return result;
}

export function processSurvivors(
  ownedProcesses: ProcessIdentity[],
  liveProcesses: ProcessIdentity[],
) {
  for (const row of ownedProcesses) {
    assert(Number.isSafeInteger(row.pid) && row.pid > 1);
    assert(typeof row.started === 'string' && !Number.isNaN(Date.parse(row.started)));
  }
  for (const row of liveProcesses) {
    assert(Number.isSafeInteger(row.pid) && row.pid > 0);
    assert(typeof row.started === 'string' && !Number.isNaN(Date.parse(row.started)));
  }
  const expected = new Map(ownedProcesses.map((row) => [`${row.pid}:${row.started}`, row]));
  const live = new Set(liveProcesses.map((row) => `${row.pid}:${row.started}`));
  return {
    pidStartPairs: expected.size,
    survivors: [...expected.values()]
      .filter((row) => live.has(`${row.pid}:${row.started}`))
      .map((row) => row.pid)
      .sort((a, b) => a - b),
  };
}

export function parseProcesses(stdout: string): ProcessIdentity[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const match = /^\s*(\d+)\s+(.{24})\s*$/.exec(line);
      if (!match) throw new Error('Independent process census unavailable');
      return { pid: Number(match[1]), started: match[2].trim() };
    });
}

export function ownershipProcesses(value: unknown): ProcessIdentity[] {
  assert(value && typeof value === 'object' && 'processes' in value);
  const document = value as Record<string, unknown>;
  const pairs = new Map<string, ProcessIdentity>();
  const collect = (rows: unknown) => {
    assert(Array.isArray(rows));
    for (const row of rows as unknown[]) {
      assert(row && typeof row === 'object' && 'pid' in row && 'started' in row);
      assert(typeof row.pid === 'number' && Number.isSafeInteger(row.pid) && row.pid > 1);
      assert(typeof row.started === 'string' && !Number.isNaN(Date.parse(row.started)));
      pairs.set(`${row.pid}:${row.started}`, { pid: row.pid, started: row.started });
    }
  };
  const census = (value: unknown) => {
    assert(value && typeof value === 'object' && !Array.isArray(value));
    const row = value as Record<string, unknown>;
    collect(row.groupMembers);
    collect(row.escapedCandidates);
  };
  collect(document.processes);
  if ('escapedProcesses' in document) collect(document.escapedProcesses);
  if ('latestCensus' in document) census(document.latestCensus);
  if ('rejectedCensus' in document) {
    assert(document.rejectedCensus && typeof document.rejectedCensus === 'object');
    census((document.rejectedCensus as Record<string, unknown>).census);
  }
  if ('commandCensusRequeries' in document) {
    assert(Array.isArray(document.commandCensusRequeries));
    for (const raw of document.commandCensusRequeries as unknown[]) {
      assert(raw && typeof raw === 'object' && !Array.isArray(raw));
      const event = raw as Record<string, unknown>;
      assert(typeof event.observedAt === 'string' && !Number.isNaN(Date.parse(event.observedAt)));
      assert(event.result === 'available' || event.result === 'unavailable');
      collect(event.unavailable);
      collect(event.current);
    }
  }
  return [...pairs.values()];
}

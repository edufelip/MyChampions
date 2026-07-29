import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import test from 'node:test';
import {
  parseOwnedProcessGroupPids,
  stopMetroProcessGroup,
  type MetroProcessGroupRuntime,
} from '../../scripts/ci/metro-process-group';

function childProcess(pid: number): ChildProcess {
  return {
    pid,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  } as unknown as ChildProcess;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`kill ${code}`), { code });
}

function processTable(
  members: readonly { pid: number; processGroupId: number; uid: number }[]
): string {
  return members
    .map(({ pid, processGroupId, uid }) => `${pid} ${processGroupId} ${uid}`)
    .join('\n');
}

test('owned process-group parsing excludes foreign-UID members', () => {
  assert.deepEqual(
    parseOwnedProcessGroupPids(
      ['4200 4200 501', '4201 4200 501', '9100 4200 0', '9200 9200 501'].join(
        '\n'
      ),
      4200,
      501
    ),
    [4200, 4201]
  );
});

test('Metro cleanup falls back to runner-owned members when group signaling returns EPERM', async () => {
  const processGroupId = 4200;
  let members = [
    { pid: processGroupId, processGroupId, uid: 501 },
    { pid: 4201, processGroupId, uid: 501 },
    { pid: 9100, processGroupId, uid: 0 },
  ];
  const signals: [number, NodeJS.Signals | 0][] = [];
  const runtime: Partial<MetroProcessGroupRuntime> = {
    platform: 'darwin',
    currentPid: 7000,
    currentUid: 501,
    killProcess: (pid, signal) => {
      signals.push([pid, signal]);
      if (pid === -processGroupId) throw errno('EPERM');
      if (signal !== 0) {
        members = members.filter((member) => member.pid !== pid);
      }
    },
    readProcessTable: async () => processTable(members),
  };

  await stopMetroProcessGroup(childProcess(processGroupId), { runtime });

  assert.ok(signals.some(([pid, signal]) => pid === 4200 && signal === 'SIGTERM'));
  assert.ok(signals.some(([pid, signal]) => pid === 4201 && signal === 'SIGTERM'));
  assert.equal(signals.some(([pid]) => pid === 9100), false);
  assert.equal(
    signals.some(([, signal]) => signal === 'SIGKILL'),
    false,
    'graceful runner-owned cleanup should not escalate'
  );
});

test('Metro cleanup ignores an EPERM group after every runner-owned member exited', async () => {
  const processGroupId = 4250;
  const signals: [number, NodeJS.Signals | 0][] = [];
  const runtime: Partial<MetroProcessGroupRuntime> = {
    platform: 'darwin',
    currentPid: 7000,
    currentUid: 501,
    killProcess: (pid, signal) => {
      signals.push([pid, signal]);
      throw errno('EPERM');
    },
    readProcessTable: async () =>
      processTable([{ pid: 9250, processGroupId, uid: 0 }]),
  };

  await stopMetroProcessGroup(childProcess(processGroupId), { runtime });

  assert.deepEqual(signals, [[-processGroupId, 0]]);
});

test('Metro cleanup still fails closed when runner-owned members survive SIGKILL', async () => {
  const processGroupId = 4300;
  const members = [
    { pid: processGroupId, processGroupId, uid: 501 },
    { pid: 4301, processGroupId, uid: 501 },
    { pid: 9300, processGroupId, uid: 0 },
  ];
  const signals: [number, NodeJS.Signals | 0][] = [];
  const runtime: Partial<MetroProcessGroupRuntime> = {
    platform: 'darwin',
    currentPid: 7000,
    currentUid: 501,
    killProcess: (pid, signal) => {
      signals.push([pid, signal]);
      if (pid === -processGroupId) throw errno('EPERM');
    },
    readProcessTable: async () => processTable(members),
    now: () => 0,
    delay: async () => {},
  };

  await assert.rejects(
    stopMetroProcessGroup(childProcess(processGroupId), {
      exitTimeoutMs: 0,
      runtime,
    }),
    /Runner-owned Metro process group did not stop after SIGKILL/
  );
  assert.ok(signals.some(([pid, signal]) => pid === 4300 && signal === 'SIGKILL'));
  assert.ok(signals.some(([pid, signal]) => pid === 4301 && signal === 'SIGKILL'));
  assert.equal(signals.some(([pid]) => pid === 9300), false);
});

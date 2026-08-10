import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import test from 'node:test';
import {
  parseOwnedProcessGroupPids,
  stopMetroProcessGroup,
  stopRunnerOwnedProcessGroup,
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
  members: readonly { pid: number; processGroupId: number; uid: number }[],
): string {
  return members
    .map(({ pid, processGroupId, uid }) => `${pid} ${processGroupId} ${uid}`)
    .join('\n');
}

async function firstOutputLine(child: ChildProcess): Promise<string> {
  return await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for child readiness')),
      3_000,
    );
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline !== -1) {
        clearTimeout(timeout);
        resolve(output.slice(0, newline));
      }
    });
  });
}

async function portIsOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(200);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Process ${pid} survived cleanup`);
}

test('owned process-group parsing excludes foreign-UID members', () => {
  assert.deepEqual(
    parseOwnedProcessGroupPids(
      ['4200 4200 501', '4201 4200 501', '9100 4200 0', '9200 9200 501'].join('\n'),
      4200,
      501,
    ),
    [4200, 4201],
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
  assert.equal(
    signals.some(([pid]) => pid === 9100),
    false,
  );
  assert.equal(
    signals.some(([, signal]) => signal === 'SIGKILL'),
    false,
    'graceful runner-owned cleanup should not escalate',
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
    readProcessTable: async () => processTable([{ pid: 9250, processGroupId, uid: 0 }]),
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
    /Runner-owned Metro process group did not stop after SIGKILL/,
  );
  assert.ok(signals.some(([pid, signal]) => pid === 4300 && signal === 'SIGKILL'));
  assert.ok(signals.some(([pid, signal]) => pid === 4301 && signal === 'SIGKILL'));
  assert.equal(
    signals.some(([pid]) => pid === 9300),
    false,
  );
});

test(
  'owned-group cleanup kills a TERM-ignoring member after its leader exits',
  { timeout: 5_000 },
  async () => {
    const leader = spawn(
      '/usr/bin/python3',
      [
        '-c',
        String.raw`
import signal
import subprocess
import sys
import time

member = subprocess.Popen([
    sys.executable,
    "-c",
    "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)",
])
print(member.pid, flush=True)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
while True:
    time.sleep(1)
`,
      ],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    const memberPid = Number(await firstOutputLine(leader));
    assert.ok(Number.isSafeInteger(memberPid) && memberPid > 1);

    try {
      await stopRunnerOwnedProcessGroup(leader, {
        exitTimeoutMs: 200,
        pollIntervalMs: 20,
      });
      await waitForProcessExit(memberPid);
    } finally {
      if (leader.pid) {
        try {
          process.kill(-leader.pid, 'SIGKILL');
        } catch {
          // The exact fixture group already exited.
        }
      }
    }
  },
);

test(
  'Metro cleanup closes only its detached listener process group',
  { timeout: 5_000 },
  async () => {
    const listenerProgram = String.raw`
const net = require('node:net');
process.on('SIGTERM', () => {});
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify(server.address()));
});
setInterval(() => {}, 1000);
`;
    const owned = spawn(process.execPath, ['-e', listenerProgram], {
      detached: true,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const unrelated = spawn(process.execPath, ['-e', listenerProgram], {
      detached: true,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const ownedAddress = JSON.parse(await firstOutputLine(owned)) as {
      port: number;
    };
    const unrelatedAddress = JSON.parse(await firstOutputLine(unrelated)) as {
      port: number;
    };
    assert.equal(await portIsOpen(ownedAddress.port), true);
    assert.equal(await portIsOpen(unrelatedAddress.port), true);

    try {
      await stopMetroProcessGroup(owned, {
        exitTimeoutMs: 200,
        pollIntervalMs: 20,
      });
      assert.equal(await portIsOpen(ownedAddress.port), false);
      assert.equal(await portIsOpen(unrelatedAddress.port), true);
      assert.ok(unrelated.pid);
      process.kill(unrelated.pid, 0);
    } finally {
      for (const child of [owned, unrelated]) {
        if (!child.pid) continue;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The exact fixture group already exited.
        }
      }
    }
  },
);

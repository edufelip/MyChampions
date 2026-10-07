import { strict as assert } from 'node:assert';
import { spawn, type SpawnOptions } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  MAESTRO_261_INPUT_SCHEMAS,
  MAESTRO_261_TOOL_NAMES,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER,
  OwnedMaestroMcpStdioSession,
  type OwnedProcessController,
} from '../../scripts/testing/owned-maestro-mcp-stdio';
import { createT16CleanupAudit } from '../../scripts/testing/run-t16-owned-exploration';

const monotonicNowMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);

function serverScript(): string {
  const tools = JSON.stringify(
    MAESTRO_261_TOOL_NAMES.map((name) => ({
      name,
      inputSchema: MAESTRO_261_INPUT_SCHEMAS[name],
    })),
  );
  return `
const readline = require('node:readline');
const tools = ${tools};
const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch (_) { return; }
  if (!message || typeof message.id !== 'number') return;
  if (message.method === 'initialize') {
    write({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: ${JSON.stringify(MCP_PROTOCOL_VERSION)},
      capabilities: { tools: {} },
      serverInfo: ${JSON.stringify(MCP_SERVER)},
    }});
    return;
  }
  if (message.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: message.id, result: { tools } });
    return;
  }
  if (message.method === 'tools/call') {
    write({ jsonrpc: '2.0', id: message.id, result: { isError: false, structuredContent: {} } });
    return;
  }
  write({ jsonrpc: '2.0', id: message.id, result: {} });
});
process.stdin.on('end', () => process.exit(0));
`;
}

async function ownedArtifactRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 't16-owned-stdio-'));
  await chmod(root, 0o700);
  return root;
}

function processController(): OwnedProcessController {
  return {
    trackOwnedProcessGroup: (child) => {
      assert(child.pid !== undefined, 'owned test child has no PID');
      const identity = {
        pid: child.pid,
        pgid: child.pid,
        started: 'owned-stdio-test-start',
        commandHash: 'b'.repeat(64),
      };
      return Promise.resolve({
        pgid: child.pid,
        capture: () =>
          Promise.resolve(child.exitCode === null && child.signalCode === null ? [identity] : []),
        stop: async () => {
          if (child.exitCode === null && child.signalCode === null) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          }
        },
      });
    },
  };
}

function session(
  artifactRoot: string,
  options: { readonly now?: () => number; readonly ownerDeadlineAtMonotonicMs?: number } = {},
): Promise<OwnedMaestroMcpStdioSession> {
  return Promise.resolve(
    new OwnedMaestroMcpStdioSession({
      argv: [process.execPath, '-e', serverScript()],
      cwd: process.cwd(),
      artifactRoot,
      processController: processController(),
      socketInspector: () => Promise.resolve([]),
      ...options,
    }),
  );
}

void test('starts, handshakes, calls and closes an actual owned stdio child', async () => {
  const root = await ownedArtifactRoot();
  try {
    const childSession = await session(root);
    await childSession.start({ deadlineMs: 5_000 });
    const call = await childSession.callTool('list_devices', {}, { deadlineMs: 5_000 });
    assert.equal(call.isError, false);
    assert.deepEqual(call.result, { isError: false, structuredContent: {} });
    const deadlineAtMonotonicMs = monotonicNowMs() + 15_000;
    const cleanup = await childSession.close({
      deadlineAtMonotonicMs,
      recoveryDeadlineAtMonotonicMs: deadlineAtMonotonicMs,
    });
    assert.equal(cleanup.status, 'cleaned');
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
    assert.equal(cleanup.socketResourcesAbsent, true);
    assert.equal(cleanup.cleanupError, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('rejects a late pre-spawn completion against the inherited absolute deadline', async () => {
  const root = await ownedArtifactRoot();
  try {
    let clock = 1_000;
    let spawnCalls = 0;
    const childSession = new OwnedMaestroMcpStdioSession({
      argv: [process.execPath, '-e', serverScript()],
      cwd: process.cwd(),
      artifactRoot: root,
      processController: processController(),
      socketInspector: () => Promise.resolve([]),
      now: () => clock,
      ownerDeadlineAtMonotonicMs: 1_050,
      beforeSpawn: () => {
        clock = 1_051;
        return Promise.resolve();
      },
      spawnProcess: (file: string, args: readonly string[], options: SpawnOptions) => {
        spawnCalls += 1;
        return spawn(file, [...args], options);
      },
    });
    await assert.rejects(childSession.start({ deadlineMs: 5_000 }), /deadline|cancelled/i);
    assert.equal(spawnCalls, 0);
    assert.equal(childSession.receipt().cleanup?.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('retains owner cancellation provenance while bounded recovery reaps the child', async () => {
  const root = await ownedArtifactRoot();
  try {
    const childSession = await session(root);
    await childSession.start({ deadlineMs: 5_000 });
    const owner = new AbortController();
    owner.abort(new Error('owner cancelled'));
    const recoverySignal = new AbortController();
    const recoveryDeadlineAtMonotonicMs = monotonicNowMs() + 15_000;
    const cleanup = await childSession.close({
      signal: recoverySignal.signal,
      ownerSignal: owner.signal,
      deadlineAtMonotonicMs: monotonicNowMs() + 15_000,
      recoveryDeadlineAtMonotonicMs,
    });
    assert.equal(cleanup.status, 'failed');
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
    assert.match(cleanup.protocolFailure ?? '', /owner signal aborted/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('cleanup audit reads the connector recovery receipt and leaves outer facts unknown', async () => {
  const root = await mkdtemp(
    path.join(process.cwd(), '.qa', 'artifacts', 't16-owned-cleanup-audit-'),
  );
  try {
    await chmod(root, 0o700);
    const relative = 'mcp-t16b/attempt-001/connector-cleanup-receipt.private.bin';
    const receipt = Buffer.from(
      JSON.stringify({
        status: 'cleaned',
        ownedProcessGroupAbsent: true,
        socketResourcesAbsent: true,
        cleanupError: null,
        protocolFailure: null,
      }),
      'utf8',
    );
    const directory = path.dirname(path.join(root, relative));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(path.join(root, relative), receipt, { mode: 0o600 });
    await chmod(path.join(root, relative), 0o600);
    const audit = createT16CleanupAudit(
      () => ({ output: root }) as never,
      'run-t16b-001',
      'attempt-001',
      'en-US',
    );
    const result = await audit.audit({
      connectorStartAttempted: true,
      signal: new AbortController().signal,
    });
    assert.equal(result.status, 'cleaned');
    assert.equal(result.ownedProcessGroupAbsent, true);
    assert.equal(result.socketResourcesAbsent, true);
    assert.equal(result.backendResourcesAbsent, false);
    assert.equal(result.foreignResourcesPreserved, false);
    assert.equal(result.outerCleanupStatus, 'unproven');
    assert.equal(result.scope, 't16-owned-mcp-namespace-only');
    assert.equal(result.recoverySource, undefined);
    const summary = JSON.parse(
      await readFile(path.join(root, 't16-mcp-cleanup-audit.private.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(summary.backendResourcesAbsent, false);
    assert.equal(summary.foreignResourcesPreserved, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { spawn as spawnChild, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  MAX_JSON_LINE_BYTES,
  MAX_RUNTIME_RAW_ENVELOPE_MEMORY_BYTES,
  MAX_RUNTIME_RAW_ENVELOPE_SPOOL_BYTES,
  MAX_TRANSCRIPT_ENVELOPE_COUNT,
  MAESTRO_261_INPUT_SCHEMAS,
  MAESTRO_261_TOOL_NAMES,
  BoundedRuntimeRawSpoolWriter,
  OwnedMaestroMcpStdioSession,
  OwnedMcpAbortError,
  type LaunchOptions,
  type ProtocolEnvelope,
  type OwnedProcessObservation,
  type RuntimeSpoolWorkerFactory,
  type MonotonicClock,
  type OwnedProcessController,
  type SocketInspector,
  type SourceSchema,
  type RuntimeSpoolWorkerLike,
} from '../../scripts/testing/owned-maestro-mcp-stdio';

const repositoryRoot = path.resolve(process.cwd());

async function privateTempDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `t16-stdio-${label}-`));
  await chmod(directory, 0o700);
  return realpath(directory);
}

function wireShape(schema: SourceSchema): Record<string, unknown> {
  return {
    type: schema.type,
    required: [...schema.required],
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [key, wireShape(child)]),
    ),
    ...(schema.items ? { items: wireShape(schema.items) } : {}),
    ...(schema.additionalProperties
      ? { additionalProperties: wireShape(schema.additionalProperties) }
      : {}),
  };
}

async function actualOwnedController(): Promise<OwnedProcessController> {
  const modulePath = path.join(repositoryRoot, 'scripts/testing/owned-process-group.ts');
  const module = (await import(pathToFileURL(modulePath).href)) as OwnedProcessController;
  return { trackOwnedProcessGroup: module.trackOwnedProcessGroup.bind(module) };
}

function immediateOwnedController(): OwnedProcessController {
  return {
    trackOwnedProcessGroup: (child) => {
      assert(child.pid);
      const identity: OwnedProcessObservation = {
        pid: child.pid,
        pgid: child.pid,
        started: 'fixture-start',
        commandHash: 'fixture-command',
      };
      let stopped = false;
      return Promise.resolve({
        pgid: child.pid,
        capture: (requireVerified = true) =>
          Promise.resolve(requireVerified && !stopped ? [identity] : []),
        stop: () => {
          stopped = true;
          child.kill('SIGTERM');
          return Promise.resolve();
        },
      });
    },
  };
}

async function writeFixture(
  directory: string,
  behavior:
    | 'normal'
    | 'hold-call'
    | 'late-call'
    | 'queued-call'
    | 'malformed'
    | 'malformed-call'
    | 'missing-result'
    | 'oversized'
    | 'partial'
    | 'unexpected-id'
    | 'jsonrpc-error'
    | 'schema-drift',
): Promise<string> {
  const tools = MAESTRO_261_TOOL_NAMES.map((name) => ({
    name,
    inputSchema: wireShape(MAESTRO_261_INPUT_SCHEMAS[name]),
  }));
  if (behavior === 'schema-drift')
    tools.find((tool) => tool.name === 'run')!.inputSchema.required = [];
  const source = `
const behavior = ${JSON.stringify(behavior)};
const tools = ${JSON.stringify(tools)};
let buffer = '';
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\\n')) {
    const index = buffer.indexOf('\\n');
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
      send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'maestro', version: '1.0.0' } } });
    } else if (request.method === 'tools/list') {
      if (behavior === 'malformed') process.stdout.write('not-json\\n');
      else if (behavior === 'missing-result') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id }) + '\\n');
      else if (behavior === 'oversized') process.stdout.write('x'.repeat(${MAX_JSON_LINE_BYTES + 1}));
      else if (behavior === 'partial') { process.stdout.write('{"jsonrpc":"2.0","id":2'); setTimeout(() => undefined, 1_000); }
      else send({ jsonrpc: '2.0', id: behavior === 'unexpected-id' ? request.id + 100 : request.id, result: { tools } });
    } else if (request.method === 'tools/call') {
      if (behavior === 'hold-call') continue;
      if (behavior === 'malformed-call') {
        process.stdout.write('not-json\\n');
        continue;
      }
      if (behavior === 'late-call') {
        send({ jsonrpc: '2.0', method: 'notifications/progress' });
        setTimeout(() => send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, late: true }) }] } }), 500);
        continue;
      }
      if (behavior === 'queued-call') {
        setTimeout(() => send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, queued: true }) }] } }), 20);
        continue;
      }
      if (behavior === 'jsonrpc-error') {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'fixture tool failure' } });
        continue;
      }
      send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, tool: request.params.name }) }] } });
    }
  }
});
`;
  const file = path.join(directory, 'rpc-fixture.mjs');
  await writeFile(file, source, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

function sessionOptions(
  fixture: string,
  directory: string,
  controller: OwnedProcessController,
  deadline = 2_000,
  options: {
    readonly socketInspector?: SocketInspector;
    readonly stallWritesAfter?: number;
    readonly ownerDeadlineMs?: number;
    readonly now?: MonotonicClock;
    readonly runtimeSpoolWorkerFactory?: RuntimeSpoolWorkerFactory;
  } = {},
) {
  let writeCount = 0;
  const spawnProcess = options.stallWritesAfter
    ? (file: string, args: readonly string[], spawnOptions: SpawnOptions) => {
        const child = spawnChild(file, [...args], spawnOptions);
        const stdin = child.stdin;
        assert(stdin);
        const originalWrite = stdin.write.bind(stdin) as (
          chunk: unknown,
          encoding?: BufferEncoding,
        ) => boolean;
        stdin.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
          writeCount += 1;
          const callbackFunction =
            typeof encoding === 'function'
              ? encoding
              : typeof callback === 'function'
                ? callback
                : undefined;
          const encodingValue =
            typeof encoding === 'string' ? (encoding as BufferEncoding) : undefined;
          const result = originalWrite(chunk, encodingValue);
          if (callbackFunction && writeCount < options.stallWritesAfter!)
            queueMicrotask(callbackFunction as () => void);
          return result;
        }) as typeof stdin.write;
        return child;
      }
    : undefined;
  return {
    argv: [process.execPath, fixture],
    cwd: directory,
    artifactRoot: directory,
    repositoryRoot,
    processController: controller,
    ...(spawnProcess ? { spawnProcess } : {}),
    socketInspector: options.socketInspector ?? (() => Promise.resolve([])),
    protocolDeadlineMs: deadline,
    ...(options.ownerDeadlineMs === undefined ? {} : { ownerDeadlineMs: options.ownerDeadlineMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.runtimeSpoolWorkerFactory === undefined
      ? {}
      : { runtimeSpoolWorkerFactory: options.runtimeSpoolWorkerFactory }),
  } as const;
}

const trackedSessions = new Set<OwnedMaestroMcpStdioSession>();

class TrackedOwnedMaestroMcpStdioSession extends OwnedMaestroMcpStdioSession {
  constructor(options: LaunchOptions) {
    super(options);
    trackedSessions.add(this);
  }
}

async function removeDirectory(directory: string): Promise<void> {
  const artifactRoot = path.resolve(directory);
  const sessions = [...trackedSessions].filter((session) => session.artifactRoot === artifactRoot);
  for (const session of sessions) {
    await session.close().catch(() => undefined);
    trackedSessions.delete(session);
  }
  await rm(directory, { recursive: true, force: true });
}

async function waitForEnvelope(
  session: OwnedMaestroMcpStdioSession,
  predicate: (envelope: ProtocolEnvelope) => boolean,
  timeoutMs = 2_000,
): Promise<ProtocolEnvelope> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const envelope = session.receipt().envelopes.find(predicate);
    if (envelope) return envelope;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('MCP expected envelope was not published before the test deadline');
}

async function waitForProtocolFailureEnvelope(
  session: OwnedMaestroMcpStdioSession,
  timeoutMs = 2_000,
): Promise<ProtocolEnvelope> {
  return waitForEnvelope(session, (envelope) => envelope.kind === 'protocol-failure', timeoutMs);
}

class HangingRuntimeSpoolWorker implements RuntimeSpoolWorkerLike {
  terminated = false;

  on(event: 'message', listener: (message: unknown) => void): RuntimeSpoolWorkerLike;
  on(event: 'error', listener: (error: Error) => void): RuntimeSpoolWorkerLike;
  on(event: 'exit', listener: (code: number) => void): RuntimeSpoolWorkerLike;
  on(
    _event: 'message' | 'error' | 'exit',
    _listener: ((message: unknown) => void) | ((error: Error) => void) | ((code: number) => void),
  ): RuntimeSpoolWorkerLike {
    return this;
  }

  postMessage(_message: unknown, _transferList?: readonly ArrayBuffer[]): void {}

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

class ImmediateRuntimeSpoolWorker implements RuntimeSpoolWorkerLike {
  private messageListener: ((message: unknown) => void) | undefined;
  private offset = 0;
  terminated = false;
  appendCount = 0;

  on(event: 'message', listener: (message: unknown) => void): RuntimeSpoolWorkerLike;
  on(event: 'error', listener: (error: Error) => void): RuntimeSpoolWorkerLike;
  on(event: 'exit', listener: (code: number) => void): RuntimeSpoolWorkerLike;
  on(
    event: 'message' | 'error' | 'exit',
    listener: ((message: unknown) => void) | ((error: Error) => void) | ((code: number) => void),
  ): RuntimeSpoolWorkerLike {
    if (event === 'message') this.messageListener = listener as (message: unknown) => void;
    return this;
  }

  postMessage(message: unknown, _transferList?: readonly ArrayBuffer[]): void {
    const request = message as {
      readonly type: string;
      readonly id: number;
      readonly bytes?: Uint8Array;
    };
    if (request.type === 'append') {
      const offset = this.offset;
      const bytes = request.bytes?.byteLength ?? 0;
      this.offset += bytes;
      this.appendCount += 1;
      this.messageListener?.({ type: 'append-complete', id: request.id, offset, bytes });
    } else {
      this.messageListener?.({ type: 'close-complete', id: request.id });
    }
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

class FailingRuntimeSpoolWorker implements RuntimeSpoolWorkerLike {
  private messageListener: ((message: unknown) => void) | undefined;
  terminated = false;

  on(event: 'message', listener: (message: unknown) => void): RuntimeSpoolWorkerLike;
  on(event: 'error', listener: (error: Error) => void): RuntimeSpoolWorkerLike;
  on(event: 'exit', listener: (code: number) => void): RuntimeSpoolWorkerLike;
  on(
    event: 'message' | 'error' | 'exit',
    listener: ((message: unknown) => void) | ((error: Error) => void) | ((code: number) => void),
  ): RuntimeSpoolWorkerLike {
    if (event === 'message') this.messageListener = listener as (message: unknown) => void;
    return this;
  }

  postMessage(message: unknown, _transferList?: readonly ArrayBuffer[]): void {
    const request = message as { readonly id: number };
    queueMicrotask(() =>
      this.messageListener?.({ type: 'error', id: request.id, message: 'injected spool failure' }),
    );
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

void test('direct stdio handshake and call retain exact raw envelopes, IDs, tool args, times, and identity', async () => {
  const directory = await privateTempDirectory('normal');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    const call = await session.callTool('list_devices', {});
    assert.equal(call.isError, false);
    const receipt = session.receipt();
    assert.deepEqual(receipt.toolNames, MAESTRO_261_TOOL_NAMES);
    assert.deepEqual(
      receipt.outputSchemasAdvertised,
      Array(MAESTRO_261_TOOL_NAMES.length).fill(null),
    );
    assert.deepEqual(
      receipt.envelopes.map((envelope) => [envelope.kind, envelope.id, envelope.method]),
      [
        ['request', 1, 'initialize'],
        ['response', 1, 'initialize'],
        ['notification', null, 'notifications/initialized'],
        ['request', 2, 'tools/list'],
        ['response', 2, 'tools/list'],
        ['request', 3, 'tools/call'],
        ['response', 3, 'tools/call'],
      ],
    );
    const request = receipt.envelopes[5];
    const response = receipt.envelopes[6];
    assert.equal(
      Buffer.from(request.rawBytes).toString('utf8'),
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_devices","arguments":{}}}\n',
    );
    assert.equal(response.requestSequence, request.sequence);
    assert.ok(response.receivedAtMonotonicMs !== null && request.sentAtMonotonicMs !== null);
    assert.ok(response.receivedAtMonotonicMs >= request.sentAtMonotonicMs);
    assert.equal(response.sessionId, request.sessionId);
    assert.equal(response.childIdentity.pid, request.childIdentity.pid);
    assert.equal(response.childIdentity.pgid, request.childIdentity.pgid);
    assert.equal(response.childIdentity.started, request.childIdentity.started);
    await assert.rejects(
      () =>
        session.callTool('take_screenshot', {
          device_id: 'owned-device',
          accessToken: 'never-written',
        }),
      /outside the source schema/,
    );
    const transcript = await session.writePrivateTranscript(
      path.join(directory, 'protocol.transcript.jsonl'),
    );
    assert.equal((await readFile(transcript.path, 'utf8')).split('\n').filter(Boolean).length, 7);
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
    assert.equal(cleanup.socketResourcesAbsent, true);
    assert.ok(cleanup.status === 'cleaned' || cleanup.status === 'exited');
  } finally {
    await removeDirectory(directory);
  }
});

void test('socket absence is not claimed when the explicit inspector is unavailable', async () => {
  const directory = await privateTempDirectory('socket-unavailable');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const controller: OwnedProcessController = {
      trackOwnedProcessGroup: (child) => {
        const identity: OwnedProcessObservation = {
          pid: child.pid!,
          pgid: child.pid!,
          started: 'fixture-start',
          commandHash: 'fixture-command',
        };
        return Promise.resolve({
          pgid: child.pid!,
          capture: (requireVerified = true) => Promise.resolve(requireVerified ? [identity] : []),
          stop: () => {
            child.kill('SIGTERM');
            return Promise.resolve();
          },
        });
      },
    };
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, controller, 2_000, {
        socketInspector: () => {
          throw new Error('socket inspector unavailable');
        },
      }),
    );
    await session.start();
    const cleanup = await session.close();
    assert.equal(cleanup.socketResourcesAbsent, false);
    assert.match(cleanup.cleanupError ?? '', /socket inspector unavailable/);
  } finally {
    await removeDirectory(directory);
  }
});

void test('close captures owned PIDs and inspects sockets before a fast clean child exits on stdin EOF', async () => {
  const directory = await privateTempDirectory('socket-fast-clean-exit');
  let session: OwnedMaestroMcpStdioSession | undefined;
  const stdinDestroyedAtInspection: boolean[] = [];
  try {
    const fixture = await writeFixture(directory, 'normal');
    session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 2_000, {
        socketInspector: (pids) => {
          assert.ok(pids.length > 0);
          const child = (session as unknown as { child: { stdin: { destroyed: boolean } } }).child;
          stdinDestroyedAtInspection.push(child.stdin.destroyed);
          return Promise.resolve([]);
        },
      }),
    );
    await session.start();
    const cleanup = await session.close();
    assert.deepEqual(stdinDestroyedAtInspection, [false, true]);
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
    assert.equal(cleanup.socketBefore.length, 0);
    assert.equal(cleanup.socketAfter.length, 0);
    assert.equal(cleanup.socketResourcesAbsent, true);
    assert.equal(cleanup.cleanupError, null);
  } finally {
    await session?.close().catch(() => undefined);
    await removeDirectory(directory);
  }
});

void test('close rejects a replaced or foreign leader before any socket claim', async () => {
  for (const mode of ['replaced-start', 'foreign-leader'] as const) {
    const directory = await privateTempDirectory(`socket-${mode}`);
    let socketCalls = 0;
    let replaced = false;
    try {
      const fixture = await writeFixture(directory, 'normal');
      const controller: OwnedProcessController = {
        trackOwnedProcessGroup: (child) => {
          const identity: OwnedProcessObservation = {
            pid: child.pid!,
            pgid: child.pid!,
            started: 'fixture-start',
            commandHash: 'fixture-command',
          };
          return Promise.resolve({
            pgid: child.pid!,
            capture: (requireVerified = true) => {
              if (!requireVerified) return Promise.resolve([]);
              if (!replaced) return Promise.resolve([identity]);
              return Promise.resolve([
                mode === 'replaced-start'
                  ? { ...identity, started: 'replacement-start' }
                  : { ...identity, pid: identity.pid + 1 },
              ]);
            },
            stop: () => {
              child.kill('SIGTERM');
              return Promise.resolve();
            },
          });
        },
      };
      const session = new TrackedOwnedMaestroMcpStdioSession(
        sessionOptions(fixture, directory, controller, 2_000, {
          socketInspector: () => {
            socketCalls += 1;
            return Promise.resolve([]);
          },
        }),
      );
      await session.start();
      replaced = true;
      const cleanup = await session.close();
      assert.equal(socketCalls, 0);
      assert.equal(cleanup.socketResourcesAbsent, false);
      assert.match(
        cleanup.cleanupError ?? '',
        mode === 'replaced-start' ? /identity changed/ : /absent from the strict process census/,
      );
      assert.equal(cleanup.ownedProcessGroupAbsent, true);
    } finally {
      await removeDirectory(directory);
    }
  }
});

void test('JSON-RPC tool errors remain visible as errors instead of becoming successful null results', async () => {
  const directory = await privateTempDirectory('jsonrpc-error');
  try {
    const fixture = await writeFixture(directory, 'jsonrpc-error');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    const call = await session.callTool('list_devices', {});
    assert.equal(call.isError, true);
    assert.equal(call.result, null);
    assert.deepEqual(call.error, { code: -32001, message: 'fixture tool failure' });
    assert.equal(call.response.value.error && typeof call.response.value.error, 'object');
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
  } finally {
    await removeDirectory(directory);
  }
});

void test('non-finite protocol and startup deadlines are rejected before launch', async () => {
  const directory = await privateTempDirectory('invalid-deadline');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const controller = await actualOwnedController();
    assert.throws(
      () =>
        new TrackedOwnedMaestroMcpStdioSession({
          ...sessionOptions(fixture, directory, controller),
          protocolDeadlineMs: Infinity,
        }),
      /finite safe integer/,
    );
    assert.throws(
      () =>
        new TrackedOwnedMaestroMcpStdioSession({
          ...sessionOptions(fixture, directory, controller),
          ownerDeadlineMs: Infinity,
        }),
      /finite safe integer/,
    );
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, controller),
    );
    await assert.rejects(() => session.start({ deadlineMs: Infinity }), /finite safe integer/);
    assert.equal(session.receipt().state, 'idle');
  } finally {
    await removeDirectory(directory);
  }
});

void test('runtime schema drift is blocked before tools can be called', async () => {
  const directory = await privateTempDirectory('schema-drift');
  try {
    const fixture = await writeFixture(directory, 'schema-drift');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await assert.rejects(() => session.start(), /input schema differs from pinned Maestro source/);
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
    assert.equal(
      session.receipt().envelopes.some((envelope) => envelope.method === 'tools/call'),
      false,
    );
  } finally {
    await removeDirectory(directory);
  }
});

void test('an ID-bearing JSON-RPC message without result or error is retained as protocol failure', async () => {
  const directory = await privateTempDirectory('missing-result');
  try {
    const fixture = await writeFixture(directory, 'missing-result');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await assert.rejects(() => session.start(), /exactly one result or error/);
    const failure = session.receipt().envelopes.at(-1);
    assert.equal(failure?.kind, 'protocol-failure');
    assert.match(Buffer.from(failure?.rawBytes ?? []).toString('utf8'), /"id":2/);
    assert.equal(session.receipt().rejectedRawEvidence.length, 0);
  } finally {
    await removeDirectory(directory);
  }
});

void test('oversized rejected input stays bounded and exposes incomplete raw evidence', async () => {
  const directory = await privateTempDirectory('oversized');
  try {
    const fixture = await writeFixture(directory, 'oversized');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 1_000),
    );
    await assert.rejects(() => session.start(), /stdout line exceeds/);
    const receipt = session.receipt();
    const evidence = receipt.rejectedRawEvidence[0];
    assert.equal(evidence?.reason, 'oversized');
    assert.equal(evidence?.complete, false);
    assert.equal(evidence?.bytesObserved, MAX_JSON_LINE_BYTES + 1);
    assert.equal(evidence?.rawBytes.byteLength, MAX_JSON_LINE_BYTES);
    assert.ok(receipt.rejectedRawDroppedCount >= 1);
  } finally {
    await removeDirectory(directory);
  }
});

void test('EOF-partial JSON-RPC input is retained as complete observed raw evidence', async () => {
  const directory = await privateTempDirectory('partial');
  try {
    const fixture = await writeFixture(directory, 'partial');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 2_000),
    );
    await assert.rejects(
      () => session.start(),
      /cancelled or deadline reached|runtime spool I\/O deadline reached/,
    );
    const partial = await waitForProtocolFailureEnvelope(session);
    assert.equal(Buffer.from(partial?.rawBytes ?? []).toString('utf8'), '{"jsonrpc":"2.0","id":2');
  } finally {
    await removeDirectory(directory);
  }
});

void test('malformed and unexpected JSON-RPC responses retain failure provenance and clean the owned group', async () => {
  for (const behavior of ['malformed', 'unexpected-id'] as const) {
    const directory = await privateTempDirectory(behavior);
    try {
      const fixture = await writeFixture(directory, behavior);
      const session = new TrackedOwnedMaestroMcpStdioSession(
        sessionOptions(fixture, directory, await actualOwnedController()),
      );
      await assert.rejects(
        () => session.start(),
        behavior === 'malformed' ? /Malformed JSON-RPC line/ : /unexpected response id/,
      );
      const cleanup = await session.close();
      assert.equal(cleanup.ownedProcessGroupAbsent, true);
      assert.match(
        session.receipt().protocolFailure ?? '',
        behavior === 'malformed' ? /Malformed JSON-RPC line/ : /unexpected response id/,
      );
      const failureEnvelope = session.receipt().envelopes.at(-1);
      assert.equal(failureEnvelope?.kind, 'protocol-failure');
      assert.equal(failureEnvelope?.id, null);
      assert.equal(failureEnvelope?.method, null);
      const rawFailure = Buffer.from(failureEnvelope?.rawBytes ?? []).toString('utf8');
      if (behavior === 'malformed') assert.equal(rawFailure, 'not-json\n');
      else assert.match(rawFailure, /^\{"jsonrpc":"2\.0","id":102,"result":\{"tools":/);
    } finally {
      await removeDirectory(directory);
    }
  }
});

void test('AbortSignal cancellation does not synthesize a response and verified cleanup remains required', async () => {
  const directory = await privateTempDirectory('abort');
  try {
    const fixture = await writeFixture(directory, 'hold-call');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 5_000),
    );
    await session.start();
    const controller = new AbortController();
    const call = session.callTool('list_devices', {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(call, OwnedMcpAbortError);
    assert.equal(
      session.receipt().envelopes.filter((envelope) => envelope.kind === 'response').length,
      2,
    );
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
    assert.equal(cleanup.socketResourcesAbsent, true);
  } finally {
    await removeDirectory(directory);
  }
});

void test('request cancellation is not blocked by a stalled stdin write callback', async () => {
  const directory = await privateTempDirectory('stalled-write');
  let session: OwnedMaestroMcpStdioSession | undefined;
  try {
    const fixture = await writeFixture(directory, 'hold-call');
    session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 5_000, {
        stallWritesAfter: 4,
      }),
    );
    await session.start();
    const controller = new AbortController();
    const call = session.callTool('list_devices', {}, { signal: controller.signal });
    await waitForEnvelope(
      session,
      (envelope) => envelope.kind === 'request' && envelope.method === 'tools/call',
    );
    const startedAt = performance.now();
    controller.abort();
    await assert.rejects(call, OwnedMcpAbortError);
    assert.ok(performance.now() - startedAt < 500);
    assert.equal(session.receipt().retiredRequestCount, 1);
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
  } finally {
    await session?.close().catch(() => undefined);
    await removeDirectory(directory);
  }
});

void test('startup cancellation reaches the initialized notification write', async () => {
  const directory = await privateTempDirectory('startup-abort-notification');
  let session: OwnedMaestroMcpStdioSession | undefined;
  try {
    const fixture = await writeFixture(directory, 'normal');
    session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 5_000, {
        stallWritesAfter: 2,
      }),
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    const startedAt = performance.now();
    await assert.rejects(() => session!.start({ signal: controller.signal }), OwnedMcpAbortError);
    clearTimeout(timer);
    assert.ok(performance.now() - startedAt < 1_000);
  } finally {
    await session?.close().catch(() => undefined);
    await removeDirectory(directory);
  }
});

void test('abort settlement removes its signal listener exactly once', async () => {
  const directory = await privateTempDirectory('abort-listener');
  try {
    const fixture = await writeFixture(directory, 'hold-call');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    const controller = new AbortController();
    let added = 0;
    let removed = 0;
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((...args: Parameters<typeof signal.addEventListener>) => {
      added += 1;
      return add(...args);
    }) as typeof signal.addEventListener;
    signal.removeEventListener = ((...args: Parameters<typeof signal.removeEventListener>) => {
      removed += 1;
      return remove(...args);
    }) as typeof signal.removeEventListener;
    const call = session.callTool('list_devices', {}, { signal });
    controller.abort();
    await assert.rejects(call, OwnedMcpAbortError);
    assert.equal(added, 1);
    assert.equal(removed, 1);
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
  } finally {
    await removeDirectory(directory);
  }
});

void test('deadline cancellation rejects a held call without declaring execution success', async () => {
  const directory = await privateTempDirectory('deadline');
  try {
    const fixture = await writeFixture(directory, 'hold-call');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 2_000),
    );
    await session.start();
    await assert.rejects(
      () => session.callTool('list_devices', {}),
      /cancelled or deadline reached/,
    );
    const responseCount = session
      .receipt()
      .envelopes.filter((envelope) => envelope.kind === 'response').length;
    assert.equal(responseCount, 2);
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
  } finally {
    await removeDirectory(directory);
  }
});

void test('startup deadline is scoped to handshake while later calls use fresh request deadlines under the owner budget', async () => {
  const directory = await privateTempDirectory('request-deadline-scope');
  let now = 0;
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, immediateOwnedController(), 1_000, {
        ownerDeadlineMs: 5_000,
        now: () => now,
      }),
    );
    await session.start({ deadlineMs: 1_000 });
    now = 1_500;
    const call = await session.callTool('list_devices', {}, { deadlineMs: 100 });
    assert.equal(call.isError, false);
    assert.equal(session.receipt().protocolFailure, null);
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
  } finally {
    await removeDirectory(directory);
  }
});

void test('fatal protocol input closes the callable state and retains the rejected line', async () => {
  const directory = await privateTempDirectory('fatal-protocol');
  try {
    const fixture = await writeFixture(directory, 'malformed-call');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    await assert.rejects(() => session.callTool('list_devices', {}), /Malformed JSON-RPC line/);
    assert.equal(session.receipt().state, 'closing');
    await assert.rejects(
      () => session.callTool('list_devices', {}),
      /MCP tool call before handshake/,
    );
    const failureEnvelope = session.receipt().envelopes.at(-1);
    assert.equal(failureEnvelope?.kind, 'protocol-failure');
    assert.equal(Buffer.from(failureEnvelope?.rawBytes ?? []).toString('utf8'), 'not-json\n');
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
  } finally {
    await removeDirectory(directory);
  }
});

void test('identity refresh is bounded before a hanging controller read can block startup', async () => {
  const directory = await privateTempDirectory('bounded-refresh');
  let stopCalled = false;
  let captureCalls = 0;
  try {
    const fixture = await writeFixture(directory, 'normal');
    const controller: OwnedProcessController = {
      trackOwnedProcessGroup: (child) =>
        Promise.resolve({
          pgid: child.pid ?? 1,
          capture: (requireVerified = true) => {
            captureCalls += 1;
            if (requireVerified && captureCalls === 1) return new Promise<never>(() => undefined);
            return Promise.resolve([]);
          },
          stop: () => {
            stopCalled = true;
            child.kill('SIGTERM');
            return Promise.resolve();
          },
        }),
    };
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, controller, 150),
    );
    await assert.rejects(() => session.start(), /cancelled or deadline reached/);
    assert.equal(stopCalled, true);
    assert.ok(captureCalls >= 2);
    assert.equal(session.receipt().state, 'closed');
  } finally {
    await removeDirectory(directory);
  }
});

void test('late process ownership is fenced and stopped after startup cancellation', async () => {
  const directory = await privateTempDirectory('late-ownership');
  let stopCalled = false;
  try {
    const fixture = await writeFixture(directory, 'normal');
    const controller: OwnedProcessController = {
      trackOwnedProcessGroup: (child) =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                pgid: child.pid!,
                capture: () => Promise.resolve([]),
                stop: () => {
                  stopCalled = true;
                  child.kill('SIGTERM');
                  return Promise.resolve();
                },
              }),
            100,
          );
        }),
    };
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, controller, 50),
    );
    await assert.rejects(() => session.start(), /cancelled or deadline reached/);
    assert.equal(stopCalled, true);
    const receipt = session.receipt();
    assert.equal(receipt.cleanup?.ownedProcessGroupAbsent, true);
  } finally {
    await removeDirectory(directory);
  }
});

void test('socket absence stays unknown when the full owned PID census fails', async () => {
  const directory = await privateTempDirectory('socket-census-failure');
  let failStrict = false;
  let socketCalls = 0;
  try {
    const fixture = await writeFixture(directory, 'normal');
    const controller: OwnedProcessController = {
      trackOwnedProcessGroup: (child) => {
        const identity: OwnedProcessObservation = {
          pid: child.pid!,
          pgid: child.pid!,
          started: 'fixture-start',
          commandHash: 'fixture-command',
        };
        return Promise.resolve({
          pgid: child.pid!,
          capture: (requireVerified = true) => {
            if (failStrict && requireVerified)
              return Promise.reject(new Error('strict census unavailable'));
            return Promise.resolve(requireVerified ? [identity] : []);
          },
          stop: () => {
            child.kill('SIGTERM');
            return Promise.resolve();
          },
        });
      },
    };
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, controller, 2_000, {
        socketInspector: () => {
          socketCalls += 1;
          return Promise.resolve([]);
        },
      }),
    );
    await session.start();
    failStrict = true;
    const cleanup = await session.close();
    assert.equal(socketCalls, 0);
    assert.equal(cleanup.socketResourcesAbsent, false);
    assert.match(cleanup.cleanupError ?? '', /strict census unavailable/);
  } finally {
    await removeDirectory(directory);
  }
});

void test('an empty terminal PID census does not claim socket absence without an owned identity', async () => {
  const directory = await privateTempDirectory('socket-empty-census');
  let emptyCensus = false;
  let socketCalls = 0;
  try {
    const fixture = await writeFixture(directory, 'normal');
    const controller: OwnedProcessController = {
      trackOwnedProcessGroup: (child) => {
        const identity: OwnedProcessObservation = {
          pid: child.pid!,
          pgid: child.pid!,
          started: 'fixture-start',
          commandHash: 'fixture-command',
        };
        return Promise.resolve({
          pgid: child.pid!,
          capture: (requireVerified = true) =>
            Promise.resolve(emptyCensus ? [] : requireVerified ? [identity] : [identity]),
          stop: () => {
            child.kill('SIGTERM');
            return Promise.resolve();
          },
        });
      },
    };
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, controller, 2_000, {
        socketInspector: () => {
          socketCalls += 1;
          return Promise.resolve([]);
        },
      }),
    );
    await session.start();
    emptyCensus = true;
    const cleanup = await session.close();
    assert.equal(socketCalls, 0);
    assert.equal(cleanup.socketResourcesAbsent, false);
    assert.match(cleanup.cleanupError ?? '', /empty before socket inspection/);
  } finally {
    await removeDirectory(directory);
  }
});

void test('close fails closed when cancellation or an expired recovery deadline preempts the census', async () => {
  for (const mode of ['cancelled', 'expired-deadline'] as const) {
    const directory = await privateTempDirectory(`socket-${mode}`);
    let session: OwnedMaestroMcpStdioSession | undefined;
    let socketCalls = 0;
    try {
      const fixture = await writeFixture(directory, 'normal');
      session = new TrackedOwnedMaestroMcpStdioSession(
        sessionOptions(fixture, directory, await actualOwnedController(), 2_000, {
          socketInspector: () => {
            socketCalls += 1;
            return Promise.resolve([]);
          },
        }),
      );
      await session.start();
      const cleanupSignal = new AbortController();
      const ownerSignal = new AbortController();
      if (mode === 'cancelled') cleanupSignal.abort();
      const now = Number(process.hrtime.bigint() / 1_000_000n);
      if (mode === 'expired-deadline') {
        await session.close({
          deadlineAtMonotonicMs: now - 1,
          recoveryDeadlineAtMonotonicMs: now - 1,
          signal: cleanupSignal.signal,
          ownerSignal: ownerSignal.signal,
        });
      } else {
        await session.close({
          deadlineAtMonotonicMs: now + 5_000,
          recoveryDeadlineAtMonotonicMs: now + 5_000,
          signal: cleanupSignal.signal,
          ownerSignal: ownerSignal.signal,
        });
      }
      const cleanup = session.receipt().cleanup;
      assert(cleanup);
      assert.equal(socketCalls, 0);
      assert.equal(cleanup.socketResourcesAbsent, false);
      assert.equal(cleanup.status, 'failed');
      assert.match(cleanup.cleanupError ?? '', /aborted|deadline|cancelled/i);
    } finally {
      await session?.close().catch(() => undefined);
      await removeDirectory(directory);
    }
  }
});

void test('a response that races local cancellation is retained as a late raw envelope', async () => {
  const directory = await privateTempDirectory('late-response');
  let session: OwnedMaestroMcpStdioSession | undefined;
  try {
    const fixture = await writeFixture(directory, 'late-call');
    session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 5_000),
    );
    await session.start();
    const controller = new AbortController();
    const call = session.callTool('list_devices', {}, { signal: controller.signal });
    await waitForEnvelope(
      session,
      (envelope) => envelope.kind === 'request' && envelope.method === 'tools/call',
    );
    await waitForEnvelope(
      session,
      (envelope) =>
        envelope.kind === 'inbound-notification' && envelope.method === 'notifications/progress',
    );
    controller.abort();
    await assert.rejects(call, OwnedMcpAbortError);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const receipt = session.receipt();
    assert.equal(receipt.lateResponseCount, 1);
    const lateResponse = receipt.envelopes.at(-1);
    assert.equal(lateResponse?.lateResponse, true);
    const request = receipt.envelopes.find(
      (envelope) => envelope.sequence === lateResponse?.requestSequence,
    );
    assert.equal(request?.method, 'tools/call');
  } finally {
    await session?.close().catch(() => undefined);
    await removeDirectory(directory);
  }
});

void test('late response identity remains retired when evidence publication fails', async () => {
  const directory = await privateTempDirectory('late-response-evidence-failure');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    type LateInternals = {
      childIdentity: OwnedProcessObservation | null;
      deadlineAtMonotonicMs: number | null;
      runtimeRawSpoolPath: string | null;
      runtimeRawSpoolWriter: BoundedRuntimeRawSpoolWriter | null;
      retired: Map<
        number,
        { readonly method: string; readonly requestSequence: number; readonly reason: 'cancelled' }
      >;
      recordLateResponse(
        message: { readonly jsonrpc: '2.0'; readonly id: number; readonly result: unknown },
        rawBytes: Uint8Array,
        receivedAtMonotonicMs: number,
        retired: {
          readonly method: string;
          readonly requestSequence: number;
          readonly reason: 'cancelled';
        },
      ): Promise<void>;
    };
    const internals = session as unknown as LateInternals;
    internals.childIdentity = {
      pid: process.pid,
      pgid: process.pid,
      started: 'fixture-start',
      commandHash: 'fixture-command',
    };
    internals.deadlineAtMonotonicMs = Number(process.hrtime.bigint() / 1_000_000n) + 5_000;
    internals.runtimeRawSpoolPath = 'spool.private.bin';
    internals.runtimeRawSpoolWriter = new BoundedRuntimeRawSpoolWriter(
      path.join(directory, 'spool.private.bin'),
      { workerFactory: () => new FailingRuntimeSpoolWorker() },
    );
    internals.retired.set(7, { method: 'tools/call', requestSequence: 3, reason: 'cancelled' });
    const retired = internals.retired.get(7)!;
    await assert.rejects(
      () =>
        internals.recordLateResponse(
          { jsonrpc: '2.0', id: 7, result: { late: true } },
          Buffer.from('{"jsonrpc":"2.0","id":7,"result":{"late":true}}\n'),
          4,
          retired,
        ),
      /injected spool failure/,
    );
    assert.equal(session.receipt().retiredRequestCount, 1);
    assert.equal(session.receipt().rejectedRawEvidence.at(-1)?.reason, 'spool-failure');
    await internals.runtimeRawSpoolWriter.close().catch(() => undefined);
  } finally {
    await removeDirectory(directory);
  }
});

void test('identity refresh cancellation race rechecks retirement and retains the response as late', async () => {
  const directory = await privateTempDirectory('late-refresh-race');
  let session: OwnedMaestroMcpStdioSession | undefined;
  let stallCapture = false;
  let groupAlive = true;
  let releaseCapture: (() => void) | undefined;
  try {
    const fixture = await writeFixture(directory, 'late-call');
    const controller: OwnedProcessController = {
      trackOwnedProcessGroup: (child) => {
        const identity: OwnedProcessObservation = {
          pid: child.pid!,
          pgid: child.pid!,
          started: 'fixture-start',
          commandHash: 'fixture-command',
        };
        return Promise.resolve({
          pgid: child.pid!,
          capture: async (requireVerified = true) => {
            if (!groupAlive) return Promise.resolve([]);
            if (requireVerified && stallCapture)
              return new Promise<readonly OwnedProcessObservation[]>((resolve) => {
                releaseCapture = () => resolve([identity]);
              });
            return Promise.resolve([identity]);
          },
          stop: () => {
            groupAlive = false;
            releaseCapture?.();
            child.kill('SIGTERM');
            return Promise.resolve();
          },
        });
      },
    };
    session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, controller, 5_000),
    );
    await session.start();
    const abortController = new AbortController();
    const call = session.callTool('list_devices', {}, { signal: abortController.signal });
    const stallTimer = setTimeout(() => {
      stallCapture = true;
    }, 100);
    const abortTimer = setTimeout(() => abortController.abort(), 550);
    await assert.rejects(call, OwnedMcpAbortError);
    clearTimeout(stallTimer);
    clearTimeout(abortTimer);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(session.receipt().lateResponseCount, 1);
    assert.equal(session.receipt().envelopes.at(-1)?.lateResponse, true);
    stallCapture = false;
    releaseCapture?.();
    const cleanup = await session.close();
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
  } finally {
    releaseCapture?.();
    await session?.close().catch(() => undefined);
    await removeDirectory(directory);
  }
});

void test('close drains a queued response parser before publishing the terminal receipt', async () => {
  const directory = await privateTempDirectory('parser-drain');
  let session: OwnedMaestroMcpStdioSession | undefined;
  try {
    const fixture = await writeFixture(directory, 'queued-call');
    let captureCount = 0;
    let releaseCapture: ((rows: readonly OwnedProcessObservation[]) => void) | undefined;
    const controller: OwnedProcessController = {
      trackOwnedProcessGroup: (child) => {
        const identity: OwnedProcessObservation = {
          pid: child.pid!,
          pgid: child.pid!,
          started: 'fixture-start',
          commandHash: 'fixture-command',
        };
        return Promise.resolve({
          pgid: child.pid!,
          capture: async (requireVerified = true) => {
            captureCount += 1;
            if (requireVerified && captureCount === 8)
              return new Promise<readonly OwnedProcessObservation[]>((resolve) => {
                releaseCapture = resolve;
              });
            return Promise.resolve(requireVerified ? [identity] : []);
          },
          stop: () => {
            releaseCapture?.([identity]);
            child.kill('SIGTERM');
            return Promise.resolve();
          },
        });
      },
    };
    session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, controller, 2_000),
    );
    await session.start();
    const call = session.callTool('list_devices', {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(releaseCapture);
    const callRejected = assert.rejects(call, OwnedMcpAbortError);
    const cleanup = await session.close();
    await callRejected;
    assert.equal(cleanup.ownedProcessGroupAbsent, true);
    const terminal = JSON.stringify(session.receipt());
    assert.equal(session.receipt().envelopes.at(-1)?.method, 'tools/call');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(JSON.stringify(session.receipt()), terminal);
  } finally {
    await session?.close().catch(() => undefined);
    await removeDirectory(directory);
  }
});

void test('stdout chunks may contain multiple bounded protocol lines', async () => {
  const directory = await privateTempDirectory('coalesced-lines');
  let session: OwnedMaestroMcpStdioSession | undefined;
  try {
    const fixture = await writeFixture(directory, 'normal');
    session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    const consumeStdout = (
      session as unknown as { consumeStdout(chunk: Uint8Array): Promise<void> }
    ).consumeStdout.bind(session);
    const chunk = Buffer.from(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/log' })}\n`,
    );
    await consumeStdout(chunk);
    assert.deepEqual(
      session
        .receipt()
        .envelopes.slice(-2)
        .map((envelope) => envelope.method),
      ['notifications/progress', 'notifications/log'],
    );
    await session.close();
  } finally {
    await session?.close().catch(() => undefined);
    await removeDirectory(directory);
  }
});

void test('ID-less JSON-RPC notifications cannot smuggle result or error members', async () => {
  for (const member of ['result', 'error'] as const) {
    const directory = await privateTempDirectory(`notification-${member}`);
    let session: OwnedMaestroMcpStdioSession | undefined;
    try {
      const fixture = await writeFixture(directory, 'normal');
      session = new TrackedOwnedMaestroMcpStdioSession(
        sessionOptions(fixture, directory, await actualOwnedController()),
      );
      await session.start();
      const consumeStdout = (
        session as unknown as { consumeStdout(chunk: Uint8Array): Promise<void> }
      ).consumeStdout.bind(session);
      const line = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        [member]:
          member === 'result' ? { progress: 1 } : { code: -32001, message: 'bad notification' },
      });
      await assert.rejects(
        () => consumeStdout(Buffer.from(`${line}\n`)),
        /notification must not contain response members/,
      );
    } finally {
      await session?.close().catch(() => undefined);
      await removeDirectory(directory);
    }
  }
});

void test('transcript envelope count is bounded before publication', async () => {
  const directory = await privateTempDirectory('transcript-bound');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    const internals = session as unknown as { envelopes: ProtocolEnvelope[] };
    const envelope = session.receipt().envelopes[0];
    assert(envelope);
    internals.envelopes.push(
      ...Array.from({ length: MAX_TRANSCRIPT_ENVELOPE_COUNT + 1 }, () => ({
        ...envelope,
        rawBytes: Uint8Array.from(envelope.rawBytes),
      })),
    );
    await assert.rejects(
      () => session.writePrivateTranscript(path.join(directory, 'too-many.jsonl')),
      /envelope count exceeds/,
    );
    await session.close();
  } finally {
    await removeDirectory(directory);
  }
});

void test('transcript bytes are bounded before any oversized line is written', async () => {
  const directory = await privateTempDirectory('transcript-byte-bound');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    const internals = session as unknown as { envelopes: ProtocolEnvelope[] };
    const envelope = session.receipt().envelopes[0];
    assert(envelope);
    const transcriptRawBytes = new Uint8Array(MAX_JSON_LINE_BYTES);
    const transcriptRawSha256 = createHash('sha256').update(transcriptRawBytes).digest('hex');
    const nextSequence =
      Math.max(...internals.envelopes.map((candidate) => candidate.sequence)) + 1;
    internals.envelopes.push(
      ...[nextSequence, nextSequence + 1].map((sequence) => ({
        ...envelope,
        sequence,
        rawBytes: Uint8Array.from(transcriptRawBytes),
        rawByteLength: MAX_JSON_LINE_BYTES,
        rawSpool: null,
        rawSha256: transcriptRawSha256,
      })),
    );
    const transcriptPath = path.join(directory, 'too-large.jsonl');
    await assert.rejects(
      () => session.writePrivateTranscript(transcriptPath),
      /transcript exceeds the private byte limit/,
    );
    await assert.rejects(() => readFile(transcriptPath), { code: 'ENOENT' });
    await session.close();
  } finally {
    await removeDirectory(directory);
  }
});

void test('a stalled spool worker is quarantined at the I/O deadline without a fake synchronous timeout', async () => {
  const directory = await privateTempDirectory('spool-worker-deadline');
  const worker = new HangingRuntimeSpoolWorker();
  try {
    const writer = new BoundedRuntimeRawSpoolWriter(path.join(directory, 'spool.private.bin'), {
      workerFactory: () => worker,
      now: () => 0,
    });
    await assert.rejects(
      () =>
        writer.append(Buffer.from('bounded raw bytes'), {
          deadlineAtMonotonicMs: 20,
        }),
      /runtime spool I\/O deadline reached/,
    );
    assert.equal(worker.terminated, true);
    await assert.rejects(
      () => writer.append(Buffer.from('late bytes'), { deadlineAtMonotonicMs: 20 }),
      /runtime spool writer is unavailable/,
    );
    await assert.rejects(() => writer.close(), /runtime spool I\/O deadline reached/);
  } finally {
    await removeDirectory(directory);
  }
});

void test('elapsed and invalid spool deadlines are rejected before worker creation or I/O', async () => {
  const directory = await privateTempDirectory('spool-deadline-preflight');
  try {
    for (const [label, deadlineAtMonotonicMs, expected] of [
      ['elapsed', 100, /runtime spool I\/O deadline reached/],
      ['invalid', Number.NaN, /runtime spool I\/O deadline is invalid/],
    ] as const) {
      let factoryCalls = 0;
      const worker = new ImmediateRuntimeSpoolWorker();
      const writer = new BoundedRuntimeRawSpoolWriter(
        path.join(directory, `${label}.private.bin`),
        {
          workerFactory: () => {
            factoryCalls += 1;
            return worker;
          },
          now: () => 100,
        },
      );
      await assert.rejects(
        () => writer.append(Buffer.from('must not reach worker'), { deadlineAtMonotonicMs }),
        expected,
      );
      assert.equal(factoryCalls, 0);
      assert.equal(worker.appendCount, 0);
    }
  } finally {
    await removeDirectory(directory);
  }
});

void test('spool worker cancellation terminates the worker and does not publish a late write', async () => {
  const directory = await privateTempDirectory('spool-worker-cancel');
  const worker = new HangingRuntimeSpoolWorker();
  try {
    const writer = new BoundedRuntimeRawSpoolWriter(path.join(directory, 'spool.private.bin'), {
      workerFactory: () => worker,
    });
    const controller = new AbortController();
    const deadlineAtMonotonicMs = Number(process.hrtime.bigint() / 1_000_000n) + 5_000;
    const append = writer.append(Buffer.from('cancelled raw bytes'), {
      signal: controller.signal,
      deadlineAtMonotonicMs,
    });
    controller.abort();
    await assert.rejects(append, /runtime spool I\/O cancelled/);
    assert.equal(worker.terminated, true);
    await assert.rejects(() => lstat(path.join(directory, 'spool.private.bin')));
  } finally {
    await removeDirectory(directory);
  }
});

void test('default spool worker keeps its CommonJS contract under an actual ESM parent', async () => {
  const directory = await privateTempDirectory('spool-esm-parent');
  try {
    const candidatePath = path.join(repositoryRoot, 'scripts/testing/owned-maestro-mcp-stdio.ts');
    const targetPath = path.join(directory, 'spool.private.bin');
    const script = `
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { BoundedRuntimeRawSpoolWriter } = require(${JSON.stringify(candidatePath)});
const writer = new BoundedRuntimeRawSpoolWriter(${JSON.stringify(targetPath)});
const deadlineAtMonotonicMs = Number(process.hrtime.bigint() / 1_000_000n) + 5_000;
await writer.append(Buffer.from('esm parent raw bytes'), { deadlineAtMonotonicMs });
await writer.close();
process.stdout.write('ok');
`;
    const child = spawnChild(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    assert(child.stdout && child.stderr);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const result = await new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.code, 0, stderr || `child exited by ${result.signal ?? 'unknown signal'}`);
    assert.equal(stdout, 'ok');
  } finally {
    await removeDirectory(directory);
  }
});

void test('spool worker rejects a pre-existing symlink before writing the target', async () => {
  const directory = await privateTempDirectory('spool-worker-symlink');
  try {
    const target = path.join(directory, 'spool.private.bin');
    const victim = path.join(directory, 'victim.private.bin');
    await writeFile(victim, 'unchanged', { mode: 0o600 });
    await symlink(victim, target);
    const writer = new BoundedRuntimeRawSpoolWriter(target);
    const deadlineAtMonotonicMs = Number(process.hrtime.bigint() / 1_000_000n) + 5_000;
    await assert.rejects(
      () => writer.append(Buffer.from('must not follow'), { deadlineAtMonotonicMs }),
      /EEXIST|symlink|runtime spool worker failed|opening|regular-file/,
    );
    assert.equal(await readFile(victim, 'utf8'), 'unchanged');
    await assert.rejects(() => writer.close());
  } finally {
    await removeDirectory(directory);
  }
});

void test('session spool timeout preserves bounded raw failure evidence and blocks publication', async () => {
  const directory = await privateTempDirectory('session-spool-deadline');
  const worker = new HangingRuntimeSpoolWorker();
  let session: OwnedMaestroMcpStdioSession | undefined;
  try {
    const fixture = await writeFixture(directory, 'normal');
    session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 2_000, {
        runtimeSpoolWorkerFactory: () => worker,
      }),
    );
    await assert.rejects(() => session!.start(), /runtime spool I\/O deadline reached/);
    assert.equal(worker.terminated, true);
    const receipt = session.receipt();
    assert.equal(receipt.envelopes.length, 0);
    assert.equal(receipt.rejectedRawEvidence[0]?.reason, 'spool-failure');
    assert.ok((receipt.rejectedRawEvidence[0]?.rawBytes.byteLength ?? 0) > 0);
  } finally {
    await session?.close().catch(() => undefined);
    await removeDirectory(directory);
  }
});

void test('concurrent raw spool appends serialize offsets and commit the exact aggregate bytes', async () => {
  const directory = await privateTempDirectory('runtime-raw-spool-concurrent');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    type SpoolInternals = {
      appendRuntimeRawSpool(
        rawBytes: Uint8Array,
        signal?: AbortSignal,
        deadlineAtMonotonicMs?: number | null,
      ): Promise<{ readonly path: string; readonly offset: number; readonly bytes: number }>;
      runtimeRawSpoolPath: string | null;
      runtimeRawSpoolBytes: number;
      deadlineAtMonotonicMs: number | null;
      runtimeRawSpoolWriter: {
        append(
          rawBytes: Uint8Array,
          options: { readonly signal?: AbortSignal; readonly deadlineAtMonotonicMs: number },
        ): Promise<{ readonly path: string; readonly offset: number; readonly bytes: number }>;
      } | null;
    };
    const internals = session as unknown as SpoolInternals;
    const releases: (() => void)[] = [];
    let offset = 0;
    internals.runtimeRawSpoolPath = 'spool.private.bin';
    internals.deadlineAtMonotonicMs = Number(process.hrtime.bigint() / 1_000_000n) + 5_000;
    internals.runtimeRawSpoolWriter = {
      append: async (rawBytes) => {
        await new Promise<void>((resolve) => releases.push(resolve));
        const reference = { path: 'spool.private.bin', offset, bytes: rawBytes.byteLength };
        offset += rawBytes.byteLength;
        return reference;
      },
    };
    const first = internals.appendRuntimeRawSpool(Buffer.from('a'));
    const second = internals.appendRuntimeRawSpool(Buffer.from('bc'));
    while (releases.length === 0) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases.length, 1);
    releases.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases.length, 1);
    releases.shift()!();
    const references = await Promise.all([first, second]);
    assert.deepEqual(
      references.map((reference) => [reference.offset, reference.bytes]),
      [
        [0, 1],
        [1, 2],
      ],
    );
    assert.equal(session.receipt().runtimeRawSpoolBytes, 3);
  } finally {
    await removeDirectory(directory);
  }
});

void test('concurrent raw spool reservations reject the append that would cross the disk cap', async () => {
  const directory = await privateTempDirectory('runtime-raw-spool-cap-race');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    type SpoolInternals = {
      appendRuntimeRawSpool(
        rawBytes: Uint8Array,
        signal?: AbortSignal,
        deadlineAtMonotonicMs?: number | null,
      ): Promise<{ readonly path: string; readonly offset: number; readonly bytes: number }>;
      runtimeRawSpoolPath: string | null;
      runtimeRawSpoolBytes: number;
      deadlineAtMonotonicMs: number | null;
      runtimeRawSpoolWriter: {
        append(
          rawBytes: Uint8Array,
          options: { readonly signal?: AbortSignal; readonly deadlineAtMonotonicMs: number },
        ): Promise<{ readonly path: string; readonly offset: number; readonly bytes: number }>;
      } | null;
    };
    const internals = session as unknown as SpoolInternals;
    let appendCalls = 0;
    internals.runtimeRawSpoolPath = 'spool.private.bin';
    internals.runtimeRawSpoolBytes = MAX_RUNTIME_RAW_ENVELOPE_SPOOL_BYTES - 1;
    internals.deadlineAtMonotonicMs = Number(process.hrtime.bigint() / 1_000_000n) + 5_000;
    internals.runtimeRawSpoolWriter = {
      append: (rawBytes) => {
        appendCalls += 1;
        return Promise.resolve({
          path: 'spool.private.bin',
          offset: MAX_RUNTIME_RAW_ENVELOPE_SPOOL_BYTES - 1,
          bytes: rawBytes.byteLength,
        });
      },
    };
    const outcomes = await Promise.allSettled([
      internals.appendRuntimeRawSpool(Uint8Array.of(1)),
      internals.appendRuntimeRawSpool(Uint8Array.of(2)),
    ]);
    assert.equal(appendCalls, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
    assert.match(
      String(outcomes.find((outcome) => outcome.status === 'rejected')?.reason),
      /MCP runtime raw spool exceeds the private byte limit/,
    );
    assert.equal(session.receipt().runtimeRawSpoolBytes, MAX_RUNTIME_RAW_ENVELOPE_SPOOL_BYTES);
  } finally {
    await removeDirectory(directory);
  }
});

void test('a queued raw spool append honors cancellation before it reaches worker I/O', async () => {
  const directory = await privateTempDirectory('runtime-raw-spool-queued-cancel');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController(), 2_000, { now: () => 0 }),
    );
    type SpoolInternals = {
      appendRuntimeRawSpool(
        rawBytes: Uint8Array,
        signal?: AbortSignal,
        deadlineAtMonotonicMs?: number | null,
      ): Promise<{ readonly path: string; readonly offset: number; readonly bytes: number }>;
      runtimeRawSpoolPath: string | null;
      deadlineAtMonotonicMs: number | null;
      runtimeRawSpoolWriter: {
        append(
          rawBytes: Uint8Array,
          options: { readonly signal?: AbortSignal; readonly deadlineAtMonotonicMs: number },
        ): Promise<{ readonly path: string; readonly offset: number; readonly bytes: number }>;
      } | null;
    };
    const internals = session as unknown as SpoolInternals;
    const releases: (() => void)[] = [];
    let offset = 0;
    internals.runtimeRawSpoolPath = 'spool.private.bin';
    internals.deadlineAtMonotonicMs = 100;
    internals.runtimeRawSpoolWriter = {
      append: async (rawBytes) => {
        await new Promise<void>((resolve) => releases.push(resolve));
        const reference = { path: 'spool.private.bin', offset, bytes: rawBytes.byteLength };
        offset += rawBytes.byteLength;
        return reference;
      },
    };
    const first = internals.appendRuntimeRawSpool(Buffer.from('first'));
    while (releases.length === 0) await new Promise((resolve) => setImmediate(resolve));
    const controller = new AbortController();
    const second = internals.appendRuntimeRawSpool(Buffer.from('second'), controller.signal, 20);
    controller.abort();
    await assert.rejects(second, /runtime spool I\/O cancelled/);
    assert.equal(releases.length, 1);
    releases.shift()!();
    await first;
  } finally {
    await removeDirectory(directory);
  }
});

void test('runtime raw envelopes stay within memory and preserve complete bytes in a private spool', async () => {
  const directory = await privateTempDirectory('runtime-raw-spool');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    const internals = session as unknown as {
      makeEnvelope(
        kind: 'inbound-notification',
        id: null,
        method: string,
        rawBytes: Uint8Array,
        sentAtMonotonicMs: number | null,
        receivedAtMonotonicMs: number | null,
      ): Promise<ProtocolEnvelope>;
      readOwnedProtocolEnvelopeRawBytes(envelope: ProtocolEnvelope): Buffer;
    };
    const raw = Buffer.alloc(128 * 1024, 0x61);
    for (let index = 0; index < 150; index += 1) {
      await internals.makeEnvelope(
        'inbound-notification',
        null,
        `notifications/test-${index}`,
        raw,
        null,
        index,
      );
    }
    const receipt = session.receipt();
    assert.ok(receipt.runtimeRawEnvelopeBytes <= MAX_RUNTIME_RAW_ENVELOPE_MEMORY_BYTES);
    assert.ok(
      receipt.envelopes.some(
        (envelope) => envelope.rawBytes.byteLength === 0 && envelope.rawSpool !== null,
      ),
    );
    assert.equal(
      receipt.runtimeRawEnvelopeBytes,
      receipt.envelopes.reduce((total, envelope) => total + envelope.rawBytes.byteLength, 0),
    );
    assert.equal(
      receipt.runtimeRawSpoolBytes,
      receipt.envelopes.reduce((total, envelope) => total + envelope.rawByteLength, 0),
    );
    const spooled = receipt.envelopes.find((envelope) => envelope.rawBytes.byteLength === 0);
    assert(spooled);
    assert.deepEqual(internals.readOwnedProtocolEnvelopeRawBytes(spooled), raw);
    assert(receipt.runtimeRawSpoolPath);
    const spoolInfo = await lstat(path.join(directory, receipt.runtimeRawSpoolPath));
    assert.equal(spoolInfo.isFile(), true);
    assert.equal(spoolInfo.mode & 0o777, 0o600);
    const spoolBytes = await readFile(path.join(directory, receipt.runtimeRawSpoolPath));
    assert.equal(
      createHash('sha256').update(spoolBytes).digest('hex'),
      receipt.runtimeRawSpoolSha256,
    );
    assert(spooled.rawSpool);
    await writeFile(
      path.join(directory, receipt.runtimeRawSpoolPath),
      Buffer.alloc(spooled.rawSpool.offset + spooled.rawSpool.bytes - 1),
    );
    assert.throws(
      () => internals.readOwnedProtocolEnvelopeRawBytes(spooled),
      /spool reference is truncated/,
    );
    await session.close();
  } finally {
    await removeDirectory(directory);
  }
});

void test('runtime raw spool close rejects a same-length disk mutation before receipt publication', async () => {
  const directory = await privateTempDirectory('runtime-raw-spool-same-length-mutation');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    const internals = session as unknown as {
      makeEnvelope(
        kind: 'inbound-notification',
        id: null,
        method: string,
        rawBytes: Uint8Array,
        sentAtMonotonicMs: number | null,
        receivedAtMonotonicMs: number | null,
      ): Promise<ProtocolEnvelope>;
    };
    const raw = Buffer.alloc(128 * 1024, 0x61);
    for (let index = 0; index < 70; index += 1) {
      await internals.makeEnvelope(
        'inbound-notification',
        null,
        `notifications/mutation-${index}`,
        raw,
        null,
        index,
      );
    }
    const beforeClose = session.receipt();
    assert(beforeClose.runtimeRawSpoolPath);
    assert(beforeClose.runtimeRawSpoolSha256);
    const spoolPath = path.join(directory, beforeClose.runtimeRawSpoolPath);
    const spoolBytes = await readFile(spoolPath);
    assert(spoolBytes.byteLength > 0);
    const mutated = Buffer.from(spoolBytes);
    mutated[0] = mutated[0] === 0x61 ? 0x62 : 0x61;
    assert.equal(mutated.byteLength, spoolBytes.byteLength);
    assert.notEqual(
      createHash('sha256').update(mutated).digest('hex'),
      beforeClose.runtimeRawSpoolSha256,
    );
    await writeFile(spoolPath, mutated);

    const cleanup = await session.close();
    assert.equal(cleanup.status, 'failed');
    assert.match(cleanup.cleanupError ?? '', /runtime raw spool aggregate hash changed/);
    assert.match(cleanup.cleanupError ?? '', /expected [0-9a-f]{64}, actual [0-9a-f]{64}/);
    assert.equal(session.receipt().cleanup?.cleanupError, cleanup.cleanupError);
  } finally {
    await removeDirectory(directory);
  }
});

void test('oversized outbound JSON-RPC lines are rejected before stdin write', async () => {
  const directory = await privateTempDirectory('outbound-bound');
  try {
    const fixture = await writeFixture(directory, 'normal');
    const session = new TrackedOwnedMaestroMcpStdioSession(
      sessionOptions(fixture, directory, await actualOwnedController()),
    );
    await session.start();
    await assert.rejects(
      () => session.callTool('take_screenshot', { device_id: 'x'.repeat(MAX_JSON_LINE_BYTES) }),
      /outbound JSON-RPC line exceeds/,
    );
    assert.equal(
      session.receipt().envelopes.some((envelope) => envelope.method === 'tools/call'),
      false,
    );
    await session.close();
  } finally {
    await removeDirectory(directory);
  }
});

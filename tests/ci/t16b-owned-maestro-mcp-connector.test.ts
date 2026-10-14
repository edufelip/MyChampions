import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  MAESTRO_261_INPUT_SCHEMAS,
  MAESTRO_261_TOOL_NAMES,
  type CloseReceipt,
  type OwnedProcessIdentity,
  type ProtocolEnvelope,
  type RequestResponse,
  type SessionReceipt,
} from '../../scripts/testing/owned-maestro-mcp-stdio';
import {
  selectionBindingHash,
  type OriginalEvidence,
  type SelectionExpectation,
} from '../../scripts/testing/t16b-owned-exploration-controller';
import {
  OwnedMaestroMcpConnector,
  type OwnedMaestroMcpSession,
  type OwnedMaestroSelectionMetadata,
} from '../../scripts/testing/t16b-owned-maestro-mcp-connector';

type RunMode = 'success' | 'failed' | 'missing-count';

const repositoryRoot = path.resolve(process.cwd());
const fixtureParent = realpathSync(mkdtempSync(path.join(tmpdir(), 't16b-mcp-adapter-parent-')));
chmodSync(fixtureParent, 0o700);
const roots: string[] = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  await rm(fixtureParent, { recursive: true, force: true });
});

const childIdentity: OwnedProcessIdentity = {
  pid: 7001,
  pgid: 7001,
  started: 'fixture-start-1',
  commandHash: 'a'.repeat(64),
};

function bytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value) + '\n', 'utf8');
}

function schemaValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, schemaValue(child)]),
  );
}

function toolListResult(): Record<string, unknown> {
  return {
    tools: MAESTRO_261_TOOL_NAMES.map((name) => ({
      name,
      inputSchema: schemaValue(MAESTRO_261_INPUT_SCHEMAS[name]),
    })),
  };
}

function envelope(input: {
  sequence: number;
  kind: ProtocolEnvelope['kind'];
  id: number | null;
  method: string | null;
  requestSequence: number | null;
  rawBytes: Buffer;
  sentAtMonotonicMs: number | null;
  receivedAtMonotonicMs: number | null;
  sessionId?: string;
  child?: OwnedProcessIdentity;
  rawSha256?: string;
}): ProtocolEnvelope {
  return {
    sessionId: input.sessionId ?? 'fixture-session-001',
    sequence: input.sequence,
    kind: input.kind,
    id: input.id,
    method: input.method,
    requestSequence: input.requestSequence,
    rawBytes: input.rawBytes,
    rawByteLength: input.rawBytes.byteLength,
    rawSpool: null,
    rawSha256: input.rawSha256 ?? createHash('sha256').update(input.rawBytes).digest('hex'),
    sentAtMonotonicMs: input.sentAtMonotonicMs,
    receivedAtMonotonicMs: input.receivedAtMonotonicMs,
    childIdentity: input.child ?? childIdentity,
    lateResponse: false,
  };
}

class FixtureSession implements OwnedMaestroMcpSession {
  readonly artifactRoot: string;
  readonly sessionId = 'fixture-session-001';
  readonly calls: string[] = [];
  readonly selectionMetadata: OwnedMaestroSelectionMetadata;
  readonly #envelopes: ProtocolEnvelope[] = [];
  #nextId = 1;
  #nextSequence = 1;
  #clock = 100;
  #started = false;
  #cleanup: CloseReceipt | null = null;
  readonly #runMode: RunMode;
  readonly #tamperInspect: boolean;
  readonly #envelopeSessionId: string;
  readonly #envelopeChildIdentity: OwnedProcessIdentity;
  readonly #postStartEnvelopeChildIdentity: OwnedProcessIdentity;
  readonly #tamperRawHash: boolean;
  readonly #tamperRequestTool: string | null;
  readonly #tamperStartupRequest: boolean;
  readonly #tamperResponseMethod: boolean;
  readonly #responseErrorTool: string | null;
  readonly #spooledRaw: boolean;
  readonly #tamperSpool: boolean;
  readonly #largePayloadBytes: number;
  readonly #spoolPath: string;
  #spoolBytes = 0;
  #spoolDigest = createHash('sha256');
  #protectedReadCalls = 0;

  constructor(
    options: {
      runMode?: RunMode;
      tamperInspect?: boolean;
      envelopeSessionId?: string;
      envelopeChildPid?: number;
      envelopeChildPgid?: number;
      envelopeChildStartedAfterStart?: string;
      tamperRawHash?: boolean;
      tamperRequestTool?: string;
      tamperStartupRequest?: boolean;
      tamperResponseMethod?: boolean;
      responseErrorTool?: string;
      spooledRaw?: boolean;
      tamperSpool?: boolean;
      largePayloadBytes?: number;
    } = {},
  ) {
    this.#runMode = options.runMode ?? 'success';
    this.#tamperInspect = options.tamperInspect ?? false;
    this.#envelopeSessionId = options.envelopeSessionId ?? this.sessionId;
    this.#envelopeChildIdentity = {
      ...childIdentity,
      ...(options.envelopeChildPid ? { pid: options.envelopeChildPid } : {}),
      ...(options.envelopeChildPgid ? { pgid: options.envelopeChildPgid } : {}),
    };
    this.#postStartEnvelopeChildIdentity = {
      ...this.#envelopeChildIdentity,
      ...(options.envelopeChildStartedAfterStart
        ? { started: options.envelopeChildStartedAfterStart }
        : {}),
    };
    this.#tamperRawHash = options.tamperRawHash ?? false;
    this.artifactRoot = realpathSync(
      mkdtempSync(path.join(fixtureParent, 't16b-mcp-adapter-test-')),
    );
    chmodSync(this.artifactRoot, 0o700);
    this.#tamperRequestTool = options.tamperRequestTool ?? null;
    this.#tamperStartupRequest = options.tamperStartupRequest ?? false;
    this.#tamperResponseMethod = options.tamperResponseMethod ?? false;
    this.#responseErrorTool = options.responseErrorTool ?? null;
    this.#spooledRaw = options.spooledRaw ?? false;
    this.#tamperSpool = options.tamperSpool ?? false;
    this.#largePayloadBytes = options.largePayloadBytes ?? 0;
    assert(Number.isSafeInteger(this.#largePayloadBytes) && this.#largePayloadBytes >= 0);
    this.#spoolPath = path.join(
      this.artifactRoot,
      'mcp-runtime-raw-fixture-session-001.private.bin',
    );
    this.selectionMetadata = createSelectionMetadata(this.artifactRoot);
    roots.push(this.artifactRoot);
  }

  get protectedReadCalls(): number {
    return this.#protectedReadCalls;
  }

  start(input: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<this> {
    input.signal?.throwIfAborted();
    assert.equal(this.#started, false, 'fixture session started twice');
    const id = this.#nextId++;
    const request = bytes({
      jsonrpc: '2.0',
      id,
      method: this.#tamperStartupRequest ? 'tools/call' : 'tools/list',
      params: this.#tamperStartupRequest ? { name: 'list_devices', arguments: {} } : {},
    });
    const requestEnvelope = envelope({
      sequence: this.#nextSequence++,
      kind: 'request',
      id,
      method: 'tools/list',
      requestSequence: null,
      rawBytes: request,
      sentAtMonotonicMs: this.#clock++,
      receivedAtMonotonicMs: null,
      sessionId: this.#envelopeSessionId,
      child: this.#envelopeChildIdentity,
      ...(this.#tamperRawHash ? { rawSha256: 'd'.repeat(64) } : {}),
    });
    this.storeEnvelope(requestEnvelope);
    const value = { jsonrpc: '2.0', id, result: toolListResult() };
    const response = this.#tamperInspect ? bytes(value) : bytes(value);
    this.storeEnvelope(
      envelope({
        sequence: this.#nextSequence++,
        kind: 'response',
        id,
        method: 'tools/list',
        requestSequence: requestEnvelope.sequence,
        rawBytes: response,
        sentAtMonotonicMs: null,
        receivedAtMonotonicMs: this.#clock++,
        sessionId: this.#envelopeSessionId,
        child: this.#envelopeChildIdentity,
        ...(this.#tamperRawHash ? { rawSha256: 'd'.repeat(64) } : {}),
      }),
    );
    this.#started = true;
    return Promise.resolve(this);
  }

  private currentEnvelopeChildIdentity(): OwnedProcessIdentity {
    return this.#started ? this.#postStartEnvelopeChildIdentity : this.#envelopeChildIdentity;
  }

  callTool(
    name: string,
    args: unknown,
    input: { signal?: AbortSignal; deadlineMs?: number } = {},
  ): Promise<{
    response: RequestResponse;
    result: unknown;
    isError: boolean;
    error: Record<string, unknown> | null;
  }> {
    input.signal?.throwIfAborted();
    assert.equal(this.#started, true, 'fixture session was not started');
    this.calls.push(name);
    const id = this.#nextId++;
    const requestName =
      this.#tamperRequestTool === name ? (name === 'run' ? 'inspect_screen' : name) : name;
    const requestArguments =
      this.#tamperRequestTool === name
        ? {
            ...(args as Record<string, unknown>),
            device_id: 'foreign-target',
            ...(name === 'run' ? { yaml: 'forged-yaml' } : {}),
          }
        : args;
    const request = bytes({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: requestName, arguments: requestArguments },
    });
    const requestEnvelope = envelope({
      sequence: this.#nextSequence++,
      kind: 'request',
      id,
      method: 'tools/call',
      requestSequence: null,
      rawBytes: request,
      sentAtMonotonicMs: this.#clock++,
      receivedAtMonotonicMs: null,
      sessionId: this.#envelopeSessionId,
      child: this.currentEnvelopeChildIdentity(),
      ...(this.#tamperRawHash ? { rawSha256: 'd'.repeat(64) } : {}),
    });
    this.storeEnvelope(requestEnvelope);
    let result: Record<string, unknown>;
    if (name === 'list_devices') {
      result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              devices: [
                {
                  device_id: 'android-owned-001',
                  name: 'fixture',
                  platform: 'android',
                  type: 'emulator',
                },
              ],
            }),
          },
        ],
      };
    } else if (name === 'inspect_screen') {
      const text = JSON.stringify({
        ui_schema: { version: 1 },
        elements: [{ rid: 'home.title', txt: 'Home' }],
        ...(this.#largePayloadBytes > 0 ? { padding: 'x'.repeat(this.#largePayloadBytes) } : {}),
      });
      result = { content: [{ type: 'text', text }] };
    } else if (name === 'take_screenshot') {
      const imageBytes =
        this.#largePayloadBytes > 0
          ? Buffer.alloc(this.#largePayloadBytes, 0x61)
          : Buffer.from('fixture-jpeg');
      result = {
        content: [{ type: 'image', data: imageBytes.toString('base64'), mimeType: 'image/jpeg' }],
      };
    } else if (name === 'run') {
      const success = this.#runMode !== 'failed';
      const payload: Record<string, unknown> = {
        success,
        device_id: 'android-owned-001',
        ...(this.#largePayloadBytes > 0 ? { padding: 'x'.repeat(this.#largePayloadBytes) } : {}),
      };
      if (this.#runMode === 'success') payload.commands_executed = 1;
      if (this.#runMode === 'failed') payload.commands_executed = 2;
      result = {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        ...(success ? {} : { isError: true }),
      };
    } else {
      throw new Error(`unexpected fixture tool: ${name}`);
    }
    const protocolError =
      this.#responseErrorTool === name ? { code: -32000, message: 'fixture protocol error' } : null;
    const typedResult = protocolError ? null : result;
    const value: RequestResponse['value'] = protocolError
      ? { jsonrpc: '2.0', id, error: protocolError }
      : { jsonrpc: '2.0', id, result };
    let response = bytes(this.#tamperResponseMethod ? { ...value, method: 'tools/list' } : value);
    if (name === 'inspect_screen' && this.#tamperInspect)
      response = bytes({ ...value, result: { content: [{ type: 'text', text: '{}' }] } });
    const responseEnvelope = envelope({
      sequence: this.#nextSequence++,
      kind: 'response',
      id,
      method: 'tools/call',
      requestSequence: requestEnvelope.sequence,
      rawBytes: response,
      sentAtMonotonicMs: null,
      receivedAtMonotonicMs: this.#clock++,
      sessionId: this.#envelopeSessionId,
      child: this.currentEnvelopeChildIdentity(),
      ...(this.#tamperRawHash ? { rawSha256: 'd'.repeat(64) } : {}),
    });
    this.storeEnvelope(responseEnvelope);
    return Promise.resolve({
      response: { response: responseEnvelope, value },
      result: typedResult,
      isError: protocolError !== null || result.isError === true,
      error: protocolError,
    });
  }

  private storeEnvelope(input: ProtocolEnvelope): ProtocolEnvelope {
    if (!this.#spooledRaw) {
      this.#envelopes.push(input);
      return input;
    }
    const raw = Buffer.from(input.rawBytes);
    const offset = this.#spoolBytes;
    writeFileSync(this.#spoolPath, raw, { flag: 'a', mode: 0o600 });
    chmodSync(this.#spoolPath, 0o600);
    this.#spoolBytes += raw.byteLength;
    this.#spoolDigest.update(raw);
    const stored: ProtocolEnvelope = {
      ...input,
      rawBytes: Buffer.alloc(0),
      rawSpool: { path: path.basename(this.#spoolPath), offset, bytes: raw.byteLength },
    };
    this.#envelopes.push(stored);
    return stored;
  }

  readOwnedProtocolEnvelopeRawBytes(envelope: ProtocolEnvelope): Buffer {
    this.#protectedReadCalls += 1;
    const owned = this.#envelopes.find((candidate) => candidate.sequence === envelope.sequence);
    assert(owned !== undefined);
    assert(owned.sessionId === this.sessionId && envelope.sessionId === this.sessionId);
    if (!this.#spooledRaw) {
      const raw = Buffer.from(owned.rawBytes);
      assert(
        createHash('sha256').update(raw).digest('hex') === owned.rawSha256,
        'raw hash differs',
      );
      return raw;
    }
    assert(owned.rawBytes.byteLength === 0 && owned.rawSpool !== null);
    if (this.#tamperSpool && this.#protectedReadCalls === 1) {
      const fd = openSync(this.#spoolPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
      try {
        const current = readFileSync(this.#spoolPath);
        const byte = Buffer.from([current[0] ^ 0xff]);
        writeSync(fd, byte, 0, 1, 0);
      } finally {
        closeSync(fd);
      }
    }
    const fd = openSync(this.#spoolPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd);
      assert(before.isFile() && before.uid === process.getuid!() && before.nlink === 1);
      assert((before.mode & 0o777) === 0o600);
      assert(owned.rawSpool.offset + owned.rawSpool.bytes <= before.size);
      const raw = Buffer.alloc(owned.rawSpool.bytes);
      let offset = 0;
      while (offset < raw.byteLength) {
        const count: number = readSync(
          fd,
          raw,
          offset,
          raw.byteLength - offset,
          owned.rawSpool.offset + offset,
        );
        assert(count > 0);
        offset += count;
      }
      const after = fstatSync(fd);
      assert(
        after.dev === before.dev &&
          after.ino === before.ino &&
          after.uid === before.uid &&
          after.gid === before.gid &&
          after.mode === before.mode &&
          after.nlink === before.nlink &&
          after.size >= owned.rawSpool.offset + owned.rawSpool.bytes,
      );
      assert(
        createHash('sha256').update(raw).digest('hex') === owned.rawSha256,
        'raw hash differs',
      );
      return raw;
    } finally {
      closeSync(fd);
    }
  }

  close(): Promise<CloseReceipt> {
    this.#cleanup = {
      status: 'cleaned',
      exitCode: 0,
      signal: null,
      ownedProcessGroupAbsent: true,
      ownershipLedgerPath: path.join(this.artifactRoot, 'mcp-process-ownership.json'),
      socketBefore: [],
      socketAfter: [],
      socketResourcesAbsent: true,
      cleanupError: null,
      protocolFailure: null,
    };
    return Promise.resolve(this.#cleanup);
  }

  receipt(): SessionReceipt {
    return {
      schema: 't16-b-owned-direct-stdio-session-v1',
      sessionId: this.sessionId,
      state: this.#started ? 'ready' : 'idle',
      argv: ['fixture', 'mcp'],
      cwd: repositoryRoot,
      pid: childIdentity.pid,
      pgid: childIdentity.pgid,
      startedAtMonotonicMs: 100,
      finishedAtMonotonicMs: this.#cleanup ? this.#clock++ : null,
      toolNames: [...MAESTRO_261_TOOL_NAMES],
      outputSchemasAdvertised: MAESTRO_261_TOOL_NAMES.map(() => null),
      envelopes: this.#envelopes,
      runtimeRawEnvelopeBytes: this.#envelopes.reduce(
        (sum, item) => sum + item.rawBytes.byteLength,
        0,
      ),
      runtimeRawSpoolPath: this.#spooledRaw ? path.basename(this.#spoolPath) : null,
      runtimeRawSpoolBytes: this.#spoolBytes,
      runtimeRawSpoolSha256: this.#spooledRaw ? this.#spoolDigest.copy().digest('hex') : null,
      rejectedRawEvidence: [],
      rejectedRawDroppedCount: 0,
      stderrBytes: 0,
      stderrSha256: null,
      protocolFailure: null,
      retiredRequestCount: 0,
      lateResponseCount: 0,
      cleanup: this.#cleanup,
    };
  }
}

function expectation(root: string): SelectionExpectation {
  return {
    requestedRunId: 'run-mcp-adapter-001',
    requestedAttemptId: 'run-mcp-adapter-001:attempt-001',
    platform: 'android',
    locale: 'en-US',
    targetId: 'android-owned-001',
    selector: 'android-owned-001',
    appIdOrOrigin: 'com.example.mychampions',
    apiOrigin: 'http://127.0.0.1:4000',
    buildId: 'build-mcp-adapter-001',
    binarySha256: 'b'.repeat(64),
    connector: { kind: 'maestro', id: 'maestro-owned-001', name: 'Maestro', version: '2.6.1' },
    roleIds: ['professional'],
    fixtureId: 'fixture-mcp-adapter-001',
    fixtureMode: 'integration',
    fixtureScope: 'scope-mcp-adapter-001',
    resetId: 'reset-mcp-adapter-001',
    artifactRoot: root,
  };
}

function writeSelectionSource(
  root: string,
  sourcePath: string,
  value: Buffer,
): {
  path: string;
  sha256: string;
  bytes: number;
  uid: number;
  mode: '0600';
  nlink: 1;
  regular: true;
  symlink: false;
} {
  const target = path.join(root, sourcePath);
  const parent = path.dirname(target);
  if (parent !== root) mkdirSync(parent, { recursive: true, mode: 0o700 });
  writeFileSync(target, value, { mode: 0o600 });
  chmodSync(target, 0o600);
  return {
    path: sourcePath,
    sha256: createHash('sha256').update(value).digest('hex'),
    bytes: value.byteLength,
    uid: process.getuid!(),
    mode: '0600',
    nlink: 1,
    regular: true,
    symlink: false,
  };
}

function metadataEvidence(
  root: string,
  kind: OriginalEvidence['kind'],
  identity: Record<string, unknown>,
  label: string,
  capturedAtMonotonicMs: number,
  ordinal: number,
  expected: SelectionExpectation,
): OriginalEvidence {
  const sourcePath = 'selection/' + label + '.private.json';
  const value = Buffer.from(JSON.stringify({ kind, identity }) + '\\n', 'utf8');
  return {
    kind,
    runId: 'run-mcp-adapter-001',
    attemptId: 'run-mcp-adapter-001:attempt-001',
    platform: 'android',
    locale: 'en-US',
    path: sourcePath,
    bytes: value,
    capturedAtMonotonicMs,
    identity: {
      ...identity,
      runId: 'run-mcp-adapter-001',
      attemptId: 'run-mcp-adapter-001:attempt-001',
      capturedAtMonotonicMs,
      selectionProvenance: {
        selectionBindingSha256: selectionBindingHash(expected),
        selectionReceiptId: 'selection-receipt-001',
        observerPid: 7001,
        observerUid: process.getuid!(),
        observerStartedAtMonotonicMs: 50,
        selectionOrdinal: ordinal,
      },
    },
    source: {
      artifactRoot: root,
      ...writeSelectionSource(root, sourcePath, value),
    },
  };
}

function createSelectionMetadata(root: string): OwnedMaestroSelectionMetadata {
  const expected = expectation(root);
  return {
    target: metadataEvidence(
      root,
      'target',
      {
        targetId: expected.targetId,
        selector: expected.selector,
        appIdOrOrigin: expected.appIdOrOrigin,
        apiOrigin: expected.apiOrigin,
        ownedTargetProcess: { pid: 7001, startedAtMonotonicMs: 50, startSha256: 'c'.repeat(64) },
      },
      'target',
      1,
      1,
      expected,
    ),
    build: metadataEvidence(
      root,
      'build',
      { buildId: expected.buildId, binarySha256: expected.binarySha256 },
      'build',
      2,
      2,
      expected,
    ),
    tool: metadataEvidence(
      root,
      'tool',
      {
        connectorId: expected.connector.id,
        kind: expected.connector.kind,
        name: expected.connector.name,
        version: expected.connector.version,
        targetSelectionCapability: true,
        sessionId: 'fixture-session-001',
      },
      'tool',
      3,
      3,
      expected,
    ),
    locale: metadataEvidence(
      root,
      'locale',
      {
        requestedLocale: expected.locale,
        effectiveLocale: expected.locale,
        observedLocale: expected.locale,
      },
      'locale',
      4,
      4,
      expected,
    ),
    roles: metadataEvidence(
      root,
      'roles',
      {
        roleIds: expected.roleIds,
        sessionIds: ['session-professional'],
        independentSessions: true,
      },
      'roles',
      5,
      5,
      expected,
    ),
    fixture: metadataEvidence(
      root,
      'fixture',
      { fixtureId: expected.fixtureId, mode: expected.fixtureMode, scope: expected.fixtureScope },
      'fixture',
      6,
      6,
      expected,
    ),
    reset: metadataEvidence(
      root,
      'reset',
      { resetId: expected.resetId, fresh: true, verified: true },
      'reset',
      7,
      7,
      expected,
    ),
    authApi: metadataEvidence(
      root,
      'auth-api',
      {
        apiOrigin: expected.apiOrigin,
        scope: expected.fixtureScope,
        readOnly: true,
        independent: true,
        roleIds: expected.roleIds,
      },
      'auth-api',
      8,
      8,
      expected,
    ),
    sql: metadataEvidence(
      root,
      'sql',
      { scope: expected.fixtureScope, readOnly: true, independent: true },
      'sql',
      9,
      9,
      expected,
    ),
    ownership: metadataEvidence(
      root,
      'ownership',
      {
        artifactRoot: root,
        current: true,
        foreignResourcesPreserved: true,
        ownerUid: process.getuid!(),
        ownedTargetProcess: { pid: 7001, startedAtMonotonicMs: 50, startSha256: 'c'.repeat(64) },
      },
      'ownership',
      10,
      10,
      expected,
    ),
  };
}

function sourceBytes(root: string, sourcePath: string): Promise<Buffer> {
  return readFile(path.join(root, sourcePath));
}

async function startConnector(session: FixtureSession): Promise<OwnedMaestroMcpConnector> {
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
    deadlineMs: 5000,
  });
  const start = await connector.start(new AbortController().signal);
  assert.equal(start.identity.version, '2.6.1');
  assert.equal(start.source.source.mode, '0600');
  assert.equal(start.source.source.nlink, 1);
  return connector;
}

void test('start and target selection bind raw tools/list and list_devices receipts', async () => {
  const session = new FixtureSession();
  const connector = await startConnector(session);
  const selected = await connector.selectTarget({
    targetId: 'android-owned-001',
    selector: 'android-owned-001',
    appIdOrOrigin: 'com.example.mychampions',
    binarySha256: 'b'.repeat(64),
    signal: new AbortController().signal,
  });
  assert.equal(selected.platform, 'android');
  assert.equal(selected.targetId, 'android-owned-001');
  const raw = await sourceBytes(session.artifactRoot, selected.source.source.path);
  assert.equal(raw.byteLength, selected.source.source.bytes);
  assert.equal(session.calls[0], 'list_devices');
  await connector.close(new AbortController().signal);
});

void test('observe preserves compact hierarchy and screenshot response/image protected bindings', async () => {
  const session = new FixtureSession();
  const connector = await startConnector(session);
  const observed = await connector.observe({
    targetId: 'android-owned-001',
    signal: new AbortController().signal,
  });
  assert.equal(observed.kind, 'screen');
  assert.equal(observed.identity.hierarchy instanceof Object, true);
  const screenshot = observed.identity.screenshot as Record<string, unknown>;
  assert.equal(screenshot.mimeType, 'image/jpeg');
  assert.equal(
    (await sourceBytes(session.artifactRoot, String(screenshot.imagePath))).toString(),
    'fixture-jpeg',
  );
  const hierarchyRaw = await sourceBytes(session.artifactRoot, observed.source.path);
  const hierarchyEnvelope = JSON.parse(hierarchyRaw.toString()) as {
    result: { content: { type: string }[] };
  };
  assert.equal(hierarchyEnvelope.result.content[0]?.type, 'text');
  await connector.close(new AbortController().signal);
});

void test('perform emits one selector action and binds request/result bytes and command hash', async () => {
  const session = new FixtureSession();
  const connector = await startConnector(session);
  const result = await connector.perform({
    targetId: 'android-owned-001',
    ordinal: 1,
    action: { id: 'open', command: 'tapOn', selector: { id: 'home.title' } },
    signal: new AbortController().signal,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.appliedUiActionCount, 1);
  const request = JSON.parse(Buffer.from(result.requestBytes).toString()) as {
    params: { arguments: { device_id: string; yaml: string } };
  };
  assert.equal(request.params.arguments.device_id, 'android-owned-001');
  assert.match(request.params.arguments.yaml, /tapOn/);
  assert.equal(
    result.requestSource.sha256,
    createHash('sha256').update(result.requestBytes).digest('hex'),
  );
  await connector.close(new AbortController().signal);
});

void test('failed run retains exact source but does not claim an applied count when output is partial', async () => {
  const session = new FixtureSession({ runMode: 'failed' });
  const connector = await startConnector(session);
  const result = await connector.perform({
    targetId: 'android-owned-001',
    ordinal: 1,
    action: { id: 'back', command: 'back' },
    signal: new AbortController().signal,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.appliedUiActionCount, null);
  assert.equal(result.identity.commandsExecuted, 2);
  assert.equal(
    (await sourceBytes(session.artifactRoot, result.resultSource.path)).byteLength,
    result.resultSource.bytes,
  );
  await connector.close(new AbortController().signal);
});

void test('successful output without commands_executed is blocked instead of metadata-only pass', async () => {
  const session = new FixtureSession({ runMode: 'missing-count' });
  const connector = await startConnector(session);
  const result = await connector.perform({
    targetId: 'android-owned-001',
    ordinal: 1,
    action: { id: 'back', command: 'back' },
    signal: new AbortController().signal,
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.appliedUiActionCount, null);
  assert.equal(result.identity.commandsExecutedProvenance, 'unavailable');
  await connector.close(new AbortController().signal);
});

void test('inputText requires an explicit protected resolver and then uses one resolved value', async () => {
  const noResolver = new FixtureSession();
  const connectorWithoutResolver = await startConnector(noResolver);
  await assert.rejects(
    () =>
      connectorWithoutResolver.perform({
        targetId: 'android-owned-001',
        ordinal: 1,
        action: { id: 'search', command: 'inputText', textRef: 'fixture.searchQuery' },
        signal: new AbortController().signal,
      }),
    /protected text resolver/,
  );
  await connectorWithoutResolver.close(new AbortController().signal);
  const session = new FixtureSession();
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
    resolveTextRef: (ref) => {
      assert.equal(ref, 'fixture.searchQuery');
      return Promise.resolve('bench press');
    },
  });
  await connector.start(new AbortController().signal);
  const result = await connector.perform({
    targetId: 'android-owned-001',
    ordinal: 1,
    action: { id: 'search', command: 'inputText', textRef: 'fixture.searchQuery' },
    signal: new AbortController().signal,
  });
  assert.equal(result.status, 'passed');
  const inputRequest = JSON.parse(Buffer.from(result.requestBytes).toString()) as {
    params: { arguments: { yaml: string } };
  };
  assert.match(inputRequest.params.arguments.yaml, /bench press/);
  await connector.close(new AbortController().signal);
});

void test('abort before a connector operation prevents tool calls while cleanup remains attempted', async () => {
  const session = new FixtureSession();
  const connector = await startConnector(session);
  const controller = new AbortController();
  controller.abort(new Error('test cancellation'));
  await assert.rejects(() =>
    connector.selectTarget({
      targetId: 'android-owned-001',
      selector: 'android-owned-001',
      appIdOrOrigin: 'com.example.mychampions',
      binarySha256: 'b'.repeat(64),
      signal: controller.signal,
    }),
  );
  assert.deepEqual(session.calls, []);
  const shutdown = await connector.close(controller.signal);
  assert.equal(shutdown.status, 'closed');
});

void test('cleanup without socket absence stays unknown', async () => {
  const session = new FixtureSession();
  const connector = await startConnector(session);
  const originalClose = session.close.bind(session);
  session.close = async () => ({ ...(await originalClose()), socketResourcesAbsent: false });
  const shutdown = await connector.close(new AbortController().signal);
  assert.equal(shutdown.status, 'unknown');
  assert.equal(shutdown.errorCode, 'cleanup-unverified');
});

void test('tampered raw inspect response is rejected before hierarchy metadata can qualify', async () => {
  const session = new FixtureSession({ tamperInspect: true });
  const connector = await startConnector(session);
  await assert.rejects(
    () =>
      connector.observe({ targetId: 'android-owned-001', signal: new AbortController().signal }),
    /result differs from raw response/,
  );
  await connector.close(new AbortController().signal);
});

void test('ancestor symlink is rejected without writing outside the owned session root', async () => {
  const session = new FixtureSession();
  const outside = mkdtempSync(path.join(fixtureParent, 't16b-mcp-adapter-outside-'));
  symlinkSync(outside, path.join(session.artifactRoot, 'mcp-t16b'), 'dir');
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
    deadlineMs: 5000,
  });
  await assert.rejects(
    () => connector.start(new AbortController().signal),
    /owned directory|canonical|symlink/,
  );
  await assert.rejects(
    () =>
      readFile(
        path.join(
          outside,
          'run-mcp-adapter-001:attempt-001',
          'start-tools-list-response.private.bin',
        ),
      ),
    /ENOENT/,
  );
});

void test('caller expectation cannot replace actual build metadata receipt', async () => {
  const session = new FixtureSession();
  session.selectionMetadata.build.identity.binarySha256 = 'c'.repeat(64);
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
    deadlineMs: 5000,
  });
  await assert.rejects(
    () => connector.start(new AbortController().signal),
    /build metadata binary differs|build\.binarySha256 differs/,
  );
  assert.deepEqual(session.calls, []);
});

void test('replaced original metadata bytes are rejected by the bounded shared reader', async () => {
  const session = new FixtureSession();
  writeFileSync(
    path.join(session.artifactRoot, session.selectionMetadata.build.source.path),
    Buffer.from('replacement'),
    { mode: 0o600 },
  );
  chmodSync(path.join(session.artifactRoot, session.selectionMetadata.build.source.path), 0o600);
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
    deadlineMs: 5000,
  });
  await assert.rejects(
    () => connector.start(new AbortController().signal),
    /source bytes differ|source hash differs|source size differs/,
  );
  assert.deepEqual(session.calls, []);
});

void test('static nested action shape is rejected before MCP run', async () => {
  const session = new FixtureSession();
  const connector = await startConnector(session);
  await assert.rejects(
    () =>
      connector.perform({
        targetId: 'android-owned-001',
        ordinal: 1,
        action: {
          id: 'open',
          command: 'tapOn',
          selector: { id: 'home.title' },
          yaml: 'tapOn',
        } as never,
        signal: new AbortController().signal,
      }),
    /nested plan/,
  );
  assert.deepEqual(session.calls, []);
  await connector.close(new AbortController().signal);
});

void test('exported low-level constructor rejects fabricated four-row metadata', async () => {
  const session = new FixtureSession();
  const fourRows = {
    target: session.selectionMetadata.target,
    build: session.selectionMetadata.build,
    tool: session.selectionMetadata.tool,
    locale: session.selectionMetadata.locale,
  } as never;
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => fourRows,
  });
  await assert.rejects(
    () => connector.start(new AbortController().signal),
    /roles metadata|roles is malformed|selection bundle|unavailable/,
  );
  assert.deepEqual(session.calls, []);
});

void test('session continuity rejects an envelope child PID that differs from the owned receipt', async () => {
  const session = new FixtureSession({ envelopeChildPid: 7002 });
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
  });
  await assert.rejects(() => connector.start(new AbortController().signal), /child pid differs/);
});

void test('session continuity rejects an envelope child PGID that differs from the owned receipt', async () => {
  const session = new FixtureSession({ envelopeChildPgid: 7002 });
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
  });
  await assert.rejects(() => connector.start(new AbortController().signal), /child pgid differs/);
});

void test('session continuity rejects a child start marker that changes after startup', async () => {
  const session = new FixtureSession({ envelopeChildStartedAfterStart: 'foreign-child-start' });
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
  });
  await connector.start(new AbortController().signal);
  await assert.rejects(
    () =>
      connector.selectTarget({
        targetId: 'android-owned-001',
        selector: 'android-owned-001',
        appIdOrOrigin: 'com.example.mychampions',
        binarySha256: 'b'.repeat(64),
        signal: new AbortController().signal,
      }),
    /child identity differs|child identity changed/,
  );
});

void test('session continuity rejects an envelope session ID mismatch', async () => {
  const session = new FixtureSession({ envelopeSessionId: 'foreign-session-001' });
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
  });
  await assert.rejects(
    () => connector.start(new AbortController().signal),
    /envelope session id differs/,
  );
});

void test('raw envelope hash mismatch is rejected before operation evidence', async () => {
  const session = new FixtureSession({ tamperRawHash: true });
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
  });
  await assert.rejects(() => connector.start(new AbortController().signal), /raw hash differs/);
});

void test('startup rejects a forged raw tools/list request method and arguments', async () => {
  const session = new FixtureSession({ tamperStartupRequest: true });
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
  });
  await assert.rejects(
    () => connector.start(new AbortController().signal),
    /tools\/list raw request method differs|raw request arguments differ/,
  );
});

void test('run rejects raw JSON-RPC operation, target and YAML arguments that differ from the typed call', async () => {
  const session = new FixtureSession({ tamperRequestTool: 'run' });
  const connector = await startConnector(session);
  await assert.rejects(
    () =>
      connector.perform({
        targetId: 'android-owned-001',
        ordinal: 1,
        action: { id: 'open', command: 'tapOn', selector: { id: 'home.title' } },
        signal: new AbortController().signal,
      }),
    /raw request operation or arguments differ/,
  );
  await connector.close(new AbortController().signal);
});

void test('JSON-RPC error responses are rejected even when the typed call marks the error', async () => {
  const session = new FixtureSession({ responseErrorTool: 'list_devices' });
  const connector = await startConnector(session);
  await assert.rejects(
    () =>
      connector.selectTarget({
        targetId: 'android-owned-001',
        selector: 'android-owned-001',
        appIdOrOrigin: 'com.example.mychampions',
        binarySha256: 'b'.repeat(64),
        signal: new AbortController().signal,
      }),
    /JSON-RPC response error/,
  );
  await connector.close(new AbortController().signal);
});

void test('raw response method cannot be rebound to another JSON-RPC operation', async () => {
  const session = new FixtureSession({ tamperResponseMethod: true });
  const connector = await startConnector(session);
  await assert.rejects(
    () =>
      connector.selectTarget({
        targetId: 'android-owned-001',
        selector: 'android-owned-001',
        appIdOrOrigin: 'com.example.mychampions',
        binarySha256: 'b'.repeat(64),
        signal: new AbortController().signal,
      }),
    /raw response method differs/,
  );
  await connector.close(new AbortController().signal);
});

void test('spooled raw envelopes remain readable after the in-memory aggregate budget and retain exact bindings', async () => {
  const session = new FixtureSession({ spooledRaw: true, largePayloadBytes: 5 * 1024 * 1024 });
  const connector = await startConnector(session);
  await connector.selectTarget({
    targetId: 'android-owned-001',
    selector: 'android-owned-001',
    appIdOrOrigin: 'com.example.mychampions',
    binarySha256: 'b'.repeat(64),
    signal: new AbortController().signal,
  });
  await connector.observe({ targetId: 'android-owned-001', signal: new AbortController().signal });
  const result = await connector.perform({
    targetId: 'android-owned-001',
    ordinal: 1,
    action: { id: 'open', command: 'tapOn', selector: { id: 'home.title' } },
    signal: new AbortController().signal,
  });
  const receipt = session.receipt();
  assert.equal(result.status, 'passed');
  assert.equal(receipt.runtimeRawEnvelopeBytes, 0);
  assert(receipt.runtimeRawSpoolBytes > 16 * 1024 * 1024);
  assert(session.protectedReadCalls > 0);
  await connector.close(new AbortController().signal);
});

void test('tampered spooled raw bytes are rejected before any operation evidence qualifies', async () => {
  const session = new FixtureSession({ spooledRaw: true, tamperSpool: true });
  const connector = new OwnedMaestroMcpConnector({
    session,
    expectation: expectation(session.artifactRoot),
    selectionMetadata: () => session.selectionMetadata,
  });
  await assert.rejects(() => connector.start(new AbortController().signal), /raw hash differs/);
});

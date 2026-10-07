import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { chmod, lstat, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { Worker, type WorkerOptions } from 'node:worker_threads';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const MCP_SERVER = Object.freeze({ name: 'maestro', version: '1.0.0' });
export const MAESTRO_261_TOOL_NAMES = Object.freeze([
  'list_devices',
  'take_screenshot',
  'run',
  'inspect_screen',
  'cheat_sheet',
  'open_maestro_viewer',
  'list_cloud_devices',
  'run_on_cloud',
  'get_cloud_run_status',
]);
export const MAX_JSON_LINE_BYTES = 8 * 1024 * 1024;
export const MAX_OUTBOUND_JSON_LINE_BYTES = MAX_JSON_LINE_BYTES;
export const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
export const MAX_TRANSCRIPT_ENVELOPE_COUNT = 4096;
export const MAX_REJECTED_RAW_LINE_BYTES = MAX_JSON_LINE_BYTES;
export const MAX_REJECTED_RAW_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_REJECTED_RAW_RECORDS = 32;
export const MAX_RUNTIME_RAW_ENVELOPE_MEMORY_BYTES = 16 * 1024 * 1024;
export const MAX_RUNTIME_RAW_ENVELOPE_SPOOL_BYTES = 128 * 1024 * 1024;
export const DEFAULT_PROTOCOL_DEADLINE_MS = 30_000;
export const MAX_PROTOCOL_DEADLINE_MS = 60_000;
export const DEFAULT_OWNER_DEADLINE_MS = 30 * 60 * 1000;
export const MAX_OWNER_DEADLINE_MS = 30 * 60 * 1000;

export type JsonObject = Record<string, unknown>;
export type MonotonicClock = () => number;

export type SourceSchema = {
  readonly type: string;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, SourceSchema>>;
  readonly items?: SourceSchema;
  readonly additionalProperties?: SourceSchema;
};

const stringSchema = (): SourceSchema => ({ type: 'string', required: [], properties: {} });
const booleanSchema = (): SourceSchema => ({ type: 'boolean', required: [], properties: {} });
const stringArraySchema = (): SourceSchema => ({
  type: 'array',
  required: [],
  properties: {},
  items: stringSchema(),
});
const stringMapSchema = (): SourceSchema => ({
  type: 'object',
  required: [],
  properties: {},
  additionalProperties: stringSchema(),
});
const objectSchema = (
  required: readonly string[],
  properties: Readonly<Record<string, SourceSchema>>,
): SourceSchema => ({ type: 'object', required, properties });

/** Source-derived input shape from Maestro 2.6.1 tool constructors; runtime tools/list is still required. */
export const MAESTRO_261_INPUT_SCHEMAS: Readonly<Record<string, SourceSchema>> = Object.freeze({
  list_devices: objectSchema([], {}),
  take_screenshot: objectSchema(['device_id'], { device_id: stringSchema() }),
  run: objectSchema(['device_id'], {
    device_id: stringSchema(),
    yaml: stringSchema(),
    files: stringArraySchema(),
    dir: stringSchema(),
    include_tags: stringArraySchema(),
    exclude_tags: stringArraySchema(),
    env: stringMapSchema(),
  }),
  inspect_screen: objectSchema(['device_id'], { device_id: stringSchema() }),
  cheat_sheet: objectSchema([], {}),
  open_maestro_viewer: objectSchema([], {}),
  list_cloud_devices: objectSchema([], {}),
  run_on_cloud: objectSchema(['app_file', 'flows'], {
    app_file: stringSchema(),
    flows: stringSchema(),
    name: stringSchema(),
    project_id: stringSchema(),
    env: stringMapSchema(),
    include_tags: stringArraySchema(),
    exclude_tags: stringArraySchema(),
    device_model: stringSchema(),
    device_os: stringSchema(),
  }),
  get_cloud_run_status: objectSchema(['upload_id', 'project_id'], {
    upload_id: stringSchema(),
    project_id: stringSchema(),
    include_flow_results: booleanSchema(),
  }),
});

export type OwnedProcessIdentity = {
  readonly pid: number;
  readonly pgid: number;
  readonly started: string;
  readonly commandHash: string;
};

export type OwnedProcessObservation = OwnedProcessIdentity & {
  readonly uid?: number;
  readonly command?: string;
};

export type OwnedProcessGroup = {
  readonly pgid: number;
  capture(requireVerified?: boolean): Promise<readonly OwnedProcessObservation[]>;
  stop(): Promise<void>;
};

export type OwnedProcessController = {
  trackOwnedProcessGroup(
    child: ChildProcess,
    ledgerPath: string,
    cleanupMode: 'step' | 'build',
  ): Promise<OwnedProcessGroup>;
};

export type SocketObservation = { readonly pid: number; readonly lineSha256: string };
export type SocketInspector = (pids: readonly number[]) => Promise<readonly SocketObservation[]>;

export type LaunchOptions = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly artifactRoot: string;
  readonly repositoryRoot?: string;
  readonly ledgerPath?: string;
  readonly spawnProcess?: SpawnProcess;
  readonly processController?: OwnedProcessController;
  readonly socketInspector: SocketInspector;
  readonly now?: MonotonicClock;
  readonly protocolDeadlineMs?: number;
  readonly ownerDeadlineMs?: number;
  /** Absolute owner deadline inherited from the parent runner. */
  readonly ownerDeadlineAtMonotonicMs?: number;
  readonly runtimeSpoolWorkerFactory?: RuntimeSpoolWorkerFactory;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Revalidates the executable descriptor immediately before spawn. The
   * caller owns the original path/hash/identity and may reject replacement
   * or growth without widening the generic MCP launch contract.
   */
  readonly beforeSpawn?: (input: {
    readonly signal?: AbortSignal;
    readonly deadlineAtMonotonicMs: number;
  }) => Promise<void>;
};

export type SpawnProcess = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

type McpChild = ChildProcess & {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
};

type ProtocolMessage = JsonObject & {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  result?: unknown;
  error?: unknown;
};
type SourceShape = {
  type: string;
  required: string[];
  properties: Record<string, SourceShape>;
  items?: SourceShape;
  additionalProperties?: SourceShape;
};

type EnvelopeKind =
  'request' | 'notification' | 'response' | 'inbound-notification' | 'protocol-failure';

export type ProtocolEnvelope = {
  readonly sessionId: string;
  readonly sequence: number;
  readonly kind: EnvelopeKind;
  readonly id: number | null;
  readonly method: string | null;
  readonly requestSequence: number | null;
  readonly rawBytes: Uint8Array;
  readonly rawByteLength: number;
  readonly rawSpool: {
    readonly path: string;
    readonly offset: number;
    readonly bytes: number;
  } | null;
  readonly rawSha256: string;
  readonly sentAtMonotonicMs: number | null;
  readonly receivedAtMonotonicMs: number | null;
  readonly childIdentity: OwnedProcessIdentity;
  readonly lateResponse: boolean;
};

export type RequestResponse = {
  readonly response: ProtocolEnvelope;
  readonly value: ProtocolMessage;
};

export type CloseReceipt = {
  readonly status: 'cleaned' | 'failed' | 'exited' | 'already-closed' | 'not-started';
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly ownedProcessGroupAbsent: boolean;
  readonly ownershipLedgerPath: string | null;
  readonly socketBefore: readonly SocketObservation[];
  readonly socketAfter: readonly SocketObservation[];
  readonly socketResourcesAbsent: boolean;
  readonly cleanupError: string | null;
  readonly protocolFailure: string | null;
};

export type OwnedMcpCloseOptions = {
  /** Cleanup operation signal; it is separate from ownerSignal after cancellation. */
  readonly signal?: AbortSignal;
  /** Original qualification deadline; never renewed by cleanup. */
  readonly deadlineAtMonotonicMs?: number;
  /** Explicit bounded recovery deadline after owner cancellation/expiry. */
  readonly recoveryDeadlineAtMonotonicMs?: number;
  /** Original owner signal retained for provenance even when recovery continues. */
  readonly ownerSignal?: AbortSignal;
};

export type SessionReceipt = {
  readonly schema: 't16-b-owned-direct-stdio-session-v1';
  readonly sessionId: string;
  readonly state: SessionState;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly pid: number | null;
  readonly pgid: number | null;
  readonly startedAtMonotonicMs: number | null;
  readonly finishedAtMonotonicMs: number | null;
  readonly toolNames: readonly string[];
  readonly outputSchemasAdvertised: readonly (boolean | null)[];
  readonly envelopes: readonly ProtocolEnvelope[];
  readonly runtimeRawEnvelopeBytes: number;
  readonly runtimeRawSpoolPath: string | null;
  readonly runtimeRawSpoolBytes: number;
  readonly runtimeRawSpoolSha256: string | null;
  readonly rejectedRawEvidence: readonly RejectedRawEvidence[];
  readonly rejectedRawDroppedCount: number;
  readonly stderrBytes: number;
  readonly stderrSha256: string | null;
  readonly protocolFailure: string | null;
  readonly retiredRequestCount: number;
  readonly lateResponseCount: number;
  readonly cleanup: CloseReceipt | null;
};

export type RejectedRawEvidence = {
  readonly reason:
    | 'malformed'
    | 'unexpected-response'
    | 'oversized'
    | 'truncated'
    | 'pre-identity-overflow'
    | 'spool-failure';
  readonly receivedAtMonotonicMs: number | null;
  readonly bytesObserved: number;
  readonly rawBytes: Uint8Array;
  readonly rawSha256: string;
  readonly complete: boolean;
};

type SessionState = 'idle' | 'starting' | 'ready' | 'closing' | 'closed';

type PendingRequest = {
  readonly id: number;
  readonly method: string;
  readonly requestSequence: number;
  readonly signal: AbortSignal | null;
  readonly deadlineAtMonotonicMs: number;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly abort: (() => void) | null;
  resolve: (value: RequestResponse) => void;
  reject: (error: Error) => void;
};

type RetiredRequest = {
  readonly method: string;
  readonly requestSequence: number;
  readonly reason: 'cancelled' | 'deadline' | 'write-failed' | 'closed';
};

export class OwnedMcpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnedMcpProtocolError';
  }
}

export class OwnedMcpAbortError extends OwnedMcpProtocolError {
  constructor(method: string) {
    super(`MCP request cancelled or deadline reached: ${method}`);
    this.name = 'OwnedMcpAbortError';
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new OwnedMcpProtocolError(message);
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function monotonicNowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function cloneIdentity(identity: OwnedProcessIdentity): OwnedProcessIdentity {
  return { ...identity };
}

function sameProcessIdentity(left: OwnedProcessIdentity, right: OwnedProcessIdentity): boolean {
  return (
    left.pid === right.pid &&
    left.pgid === right.pgid &&
    left.started === right.started &&
    left.commandHash === right.commandHash
  );
}

function requireBoundOwnedProcessCensus(
  rows: readonly OwnedProcessObservation[],
  group: OwnedProcessGroup,
  childIdentity: OwnedProcessIdentity | null,
): readonly number[] {
  assert(rows.length > 0, 'Owned MCP process census is empty before socket inspection');
  assert(
    childIdentity !== null,
    'Owned MCP child identity is unavailable before socket inspection',
  );
  const pids = new Set<number>();
  for (const row of rows) {
    assert(Number.isSafeInteger(row.pid) && row.pid > 1, 'Owned MCP census PID is invalid');
    assert(row.pgid === group.pgid, 'Owned MCP census contains a foreign process group');
    assert(
      typeof row.started === 'string' && row.started.length > 0,
      'Owned MCP census start is invalid',
    );
    assert(
      typeof row.commandHash === 'string' && row.commandHash.length > 0,
      'Owned MCP census command identity is invalid',
    );
    assert(!pids.has(row.pid), 'Owned MCP census contains a duplicate PID');
    pids.add(row.pid);
  }
  const leader = rows.find((row) => row.pid === childIdentity.pid);
  assert(leader !== undefined, 'Owned MCP child is absent from the strict process census');
  assert(
    sameProcessIdentity(leader, childIdentity),
    'Owned MCP child process identity changed before socket inspection',
  );
  return [...pids];
}

function cloneEnvelope(envelope: ProtocolEnvelope): ProtocolEnvelope {
  return {
    ...envelope,
    rawBytes: Uint8Array.from(envelope.rawBytes),
    rawSpool: envelope.rawSpool ? { ...envelope.rawSpool } : null,
    childIdentity: cloneIdentity(envelope.childIdentity),
  };
}

function isSafeId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function assertJsonRpcResponseShape(message: JsonObject): void {
  const hasResult = Object.hasOwn(message, 'result');
  const hasError = Object.hasOwn(message, 'error');
  assert(hasResult !== hasError, 'MCP response must contain exactly one result or error member');
  if (hasError) {
    assert(isRecord(message.error), 'MCP JSON-RPC error is malformed');
    assert(Number.isSafeInteger(message.error.code), 'MCP JSON-RPC error code is invalid');
    assert(typeof message.error.message === 'string', 'MCP JSON-RPC error message is invalid');
  }
}

function parseJsonRpcLine(rawBytes: Uint8Array): ProtocolMessage {
  assert(rawBytes.byteLength <= MAX_JSON_LINE_BYTES, 'MCP stdout line exceeds the private limit');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(rawBytes).toString('utf8')) as unknown;
  } catch {
    throw new OwnedMcpProtocolError('Malformed JSON-RPC line');
  }
  assert(isRecord(parsed) && parsed.jsonrpc === '2.0', 'MCP message is not JSON-RPC 2.0');
  if (Object.hasOwn(parsed, 'id')) {
    assert(isSafeId(parsed.id), 'MCP message has an invalid numeric id');
    assertJsonRpcResponseShape(parsed);
  } else {
    assert(typeof parsed.method === 'string', 'MCP notification has no method');
    assert(
      !Object.hasOwn(parsed, 'result') && !Object.hasOwn(parsed, 'error'),
      'MCP notification must not contain response members',
    );
  }
  return parsed as ProtocolMessage;
}

function normalizeSourceShape(value: unknown): SourceShape {
  assert(isRecord(value) && typeof value.type === 'string', 'MCP input schema is missing its type');
  const propertiesValue = value.properties;
  const properties: Record<string, SourceShape> = {};
  if (propertiesValue !== undefined) {
    assert(isRecord(propertiesValue), 'MCP input schema properties are malformed');
    for (const [key, child] of Object.entries(propertiesValue))
      properties[key] = normalizeSourceShape(child);
  }
  const requiredValue = value.required ?? [];
  assert(
    Array.isArray(requiredValue) && requiredValue.every((item) => typeof item === 'string'),
    'MCP input schema required list is malformed',
  );
  const result: SourceShape = {
    type: value.type,
    required: [...requiredValue],
    properties,
  };
  if (value.items !== undefined) result.items = normalizeSourceShape(value.items);
  if (value.additionalProperties !== undefined) {
    assert(
      isRecord(value.additionalProperties),
      'MCP input schema additionalProperties is unsupported',
    );
    result.additionalProperties = normalizeSourceShape(value.additionalProperties);
  }
  return result;
}

function sourceShape(value: SourceSchema): SourceShape {
  const result: SourceShape = { type: value.type, required: [...value.required], properties: {} };
  for (const [key, child] of Object.entries(value.properties))
    result.properties[key] = sourceShape(child);
  if (value.items) result.items = sourceShape(value.items);
  if (value.additionalProperties)
    result.additionalProperties = sourceShape(value.additionalProperties);
  return result;
}

function stableShape(value: SourceShape): string {
  const properties = Object.fromEntries(
    Object.entries(value.properties)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableShapeObject(child)]),
  );
  return JSON.stringify({
    type: value.type,
    required: [...value.required].sort(),
    properties,
    ...(value.items ? { items: stableShapeObject(value.items) } : {}),
    ...(value.additionalProperties
      ? { additionalProperties: stableShapeObject(value.additionalProperties) }
      : {}),
  });
}

function stableShapeObject(value: SourceShape): JsonObject {
  return JSON.parse(stableShape(value)) as JsonObject;
}

function assertSourceToolset(value: unknown): {
  readonly names: readonly string[];
  readonly outputSchemasAdvertised: readonly (boolean | null)[];
} {
  assert(isRecord(value) && Array.isArray(value.tools), 'MCP tools/list result has no tools array');
  const tools = value.tools;
  assert(
    tools.length === MAESTRO_261_TOOL_NAMES.length,
    'MCP tool count differs from the pinned Maestro source contract',
  );
  const names: string[] = [];
  const outputSchemasAdvertised: (boolean | null)[] = [];
  tools.forEach((tool, index) => {
    assert(isRecord(tool) && typeof tool.name === 'string', `MCP tool ${index} has no name`);
    const expectedName = MAESTRO_261_TOOL_NAMES[index];
    assert(
      tool.name === expectedName,
      `MCP tool order/name differs from pinned source contract: ${String(tool.name)}`,
    );
    const expectedSchema = MAESTRO_261_INPUT_SCHEMAS[expectedName];
    assert(expectedSchema !== undefined, `MCP source schema is missing: ${expectedName}`);
    const runtimeShape = normalizeSourceShape(tool.inputSchema);
    assert(
      stableShape(runtimeShape) === stableShape(sourceShape(expectedSchema)),
      `MCP input schema differs from pinned Maestro source: ${expectedName}`,
    );
    names.push(tool.name);
    outputSchemasAdvertised.push(
      Object.hasOwn(tool, 'outputSchema') ? tool.outputSchema !== null : null,
    );
  });
  return { names, outputSchemasAdvertised };
}

function validateArguments(name: string, value: unknown): void {
  const schema = MAESTRO_261_INPUT_SCHEMAS[name];
  assert(schema !== undefined, `MCP tool is not in the pinned source contract: ${name}`);
  assert(isRecord(value), `MCP tool args must be an object: ${name}`);
  const expected = sourceShape(schema);
  for (const key of Object.keys(value))
    assert(
      Object.hasOwn(expected.properties, key),
      `MCP ${name} argument is outside the source schema: ${key}`,
    );
  for (const key of expected.required)
    assert(Object.hasOwn(value, key), `MCP ${name} is missing required argument: ${key}`);
  for (const [key, item] of Object.entries(value))
    validateValue(item, expected.properties[key], `${name}.${key}`);
}

function validateValue(value: unknown, schema: SourceShape | undefined, label: string): void {
  assert(schema !== undefined, `MCP argument schema is missing: ${label}`);
  if (schema.type === 'string')
    assert(typeof value === 'string', `MCP argument must be a string: ${label}`);
  else if (schema.type === 'boolean')
    assert(typeof value === 'boolean', `MCP argument must be boolean: ${label}`);
  else if (schema.type === 'array') {
    assert(Array.isArray(value), `MCP argument must be an array: ${label}`);
    if (schema.items)
      value.forEach((item, index) => validateValue(item, schema.items, `${label}[${index}]`));
  } else if (schema.type === 'object') {
    assert(isRecord(value), `MCP argument must be an object: ${label}`);
    if (schema.additionalProperties)
      for (const [key, item] of Object.entries(value))
        validateValue(item, schema.additionalProperties, `${label}.${key}`);
  }
}

async function requirePrivateArtifactRoot(directory: string): Promise<void> {
  const info = await lstat(directory);
  assert(
    info.isDirectory() && !info.isSymbolicLink(),
    `MCP artifact root is not a regular directory: ${directory}`,
  );
  assert((info.mode & 0o777) === 0o700, `MCP artifact root must be mode 0700: ${directory}`);
  if (typeof process.getuid === 'function')
    assert(info.uid === process.getuid(), `MCP artifact root owner differs: ${directory}`);
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export async function createOwnedMaestroProcessController(
  repositoryRoot: string,
): Promise<OwnedProcessController> {
  const modulePath = path.join(
    path.resolve(repositoryRoot),
    'scripts/testing/owned-process-group.ts',
  );
  const module = (await import(pathToFileURL(modulePath).href)) as Partial<OwnedProcessController>;
  assert(
    typeof module.trackOwnedProcessGroup === 'function',
    'Owned process controller is unavailable',
  );
  return { trackOwnedProcessGroup: module.trackOwnedProcessGroup.bind(module) };
}

function asMcpChild(child: ChildProcess): McpChild {
  assert(
    child.stdin instanceof Writable &&
      child.stdout instanceof Readable &&
      child.stderr instanceof Readable,
    'MCP child did not expose stdio pipes',
  );
  return child as McpChild;
}

function abortError(method: string): OwnedMcpAbortError {
  return new OwnedMcpAbortError(method);
}

function assertFiniteDeadline(value: number, label: string): number {
  assert(
    Number.isSafeInteger(value) && value > 0 && value <= MAX_PROTOCOL_DEADLINE_MS,
    `${label} must be a finite safe integer between 1 and ${MAX_PROTOCOL_DEADLINE_MS}ms`,
  );
  return value;
}

function assertFiniteOwnerDeadline(value: number, label: string): number {
  assert(
    Number.isSafeInteger(value) && value > 0 && value <= MAX_OWNER_DEADLINE_MS,
    `${label} must be a finite safe integer between 1 and ${MAX_OWNER_DEADLINE_MS}ms`,
  );
  return value;
}

function boundedCleanup<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = () => finishReject(abortError(label));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    if (signal?.aborted) {
      finishReject(signal.reason ?? abortError(label));
      operation.catch(() => undefined);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        finishReject(error);
      },
    );
  });
}

export type RuntimeSpoolReference = {
  readonly path: string;
  readonly offset: number;
  readonly bytes: number;
};

export type RuntimeSpoolWorkerLike = {
  on(event: 'message', listener: (message: unknown) => void): RuntimeSpoolWorkerLike;
  on(event: 'error', listener: (error: Error) => void): RuntimeSpoolWorkerLike;
  on(event: 'exit', listener: (code: number) => void): RuntimeSpoolWorkerLike;
  postMessage(message: unknown, transferList?: readonly ArrayBuffer[]): void;
  terminate(): Promise<number>;
};

export type RuntimeSpoolWorkerFactory = (targetPath: string) => RuntimeSpoolWorkerLike;

export type RuntimeSpoolAppendOptions = {
  readonly signal?: AbortSignal;
  readonly deadlineAtMonotonicMs: number;
};

type RuntimeSpoolWorkerReply =
  | {
      readonly type: 'append-complete';
      readonly id: number;
      readonly offset: number;
      readonly bytes: number;
    }
  | { readonly type: 'close-complete'; readonly id: number }
  | { readonly type: 'error'; readonly id: number; readonly message: string };

const RUNTIME_SPOOL_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');

let fd = null;
let offset = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closeFile() {
  if (fd === null) return;
  const current = fd;
  fd = null;
  fs.closeSync(current);
}

function openFile() {
  const noFollow = fs.constants.O_NOFOLLOW;
  assert(typeof noFollow === 'number', 'runtime spool requires O_NOFOLLOW');
  fd = fs.openSync(
    workerData.targetPath,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow,
    0o600,
  );
  try {
    const info = fs.fstatSync(fd);
    const uid = typeof process.getuid === 'function' ? process.getuid() : info.uid;
    assert(info.isFile() && info.uid === uid, 'runtime spool ownership or regular-file check failed');
    assert((info.mode & 0o777) === 0o600, 'runtime spool mode is not 0600');
    fs.fchmodSync(fd, 0o600);
  } catch (error) {
    closeFile();
    throw error;
  }
}

function fail(id, error) {
  try { closeFile(); } catch (_) {}
  parentPort.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
}

parentPort.on('message', (message) => {
  try {
    assert(message && typeof message.id === 'number', 'runtime spool worker request id is invalid');
    if (message.type === 'append') {
      if (fd === null) openFile();
      const bytes = Buffer.from(message.bytes);
      const start = offset;
      let written = 0;
      while (written < bytes.byteLength) {
        const count = fs.writeSync(fd, bytes, written, bytes.byteLength - written, offset + written);
        assert(count > 0, 'runtime spool worker made no write progress');
        written += count;
      }
      offset += bytes.byteLength;
      fs.fsyncSync(fd);
      parentPort.postMessage({ type: 'append-complete', id: message.id, offset: start, bytes: bytes.byteLength });
      return;
    }
    if (message.type === 'close') {
      if (fd !== null) {
        fs.fsyncSync(fd);
        fs.fchmodSync(fd, 0o600);
        closeFile();
      }
      parentPort.postMessage({ type: 'close-complete', id: message.id });
      return;
    }
    throw new Error('runtime spool worker message type is unsupported');
  } catch (error) {
    fail(message && typeof message.id === 'number' ? message.id : -1, error);
  }
});
`;

function createRuntimeSpoolWorker(targetPath: string): RuntimeSpoolWorkerLike {
  // `eval` workers inherit the parent's `execArgv`. Do not inherit any of it:
  // the inline source is self-contained CommonJS and parent-only flags such as
  // `--input-type=module` or runner-injected V8 flags are not worker inputs.
  const workerOptions = {
    eval: true,
    type: 'commonjs' as const,
    execArgv: [],
    workerData: { targetPath },
  } as WorkerOptions & { readonly type: 'commonjs' };
  return new Worker(RUNTIME_SPOOL_WORKER_SOURCE, workerOptions);
}

export class BoundedRuntimeRawSpoolWriter {
  private readonly targetPath: string;
  private readonly workerFactory: RuntimeSpoolWorkerFactory;
  private readonly now: MonotonicClock;
  private worker: RuntimeSpoolWorkerLike | null = null;
  private terminationPromise: Promise<void> | null = null;
  private readonly pending = new Map<
    number,
    {
      readonly resolve: (reply: RuntimeSpoolWorkerReply) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  private nextRequestId = 1;
  private nextOffset = 0;
  private closed = false;
  private quarantined = false;
  private failure: Error | null = null;

  constructor(
    targetPath: string,
    options: {
      readonly workerFactory?: RuntimeSpoolWorkerFactory;
      readonly now?: MonotonicClock;
    } = {},
  ) {
    assert(path.isAbsolute(targetPath), 'runtime spool target must be absolute');
    this.targetPath = targetPath;
    this.workerFactory = options.workerFactory ?? createRuntimeSpoolWorker;
    this.now = options.now ?? monotonicNowMs;
  }

  private ensureWorker(): RuntimeSpoolWorkerLike {
    if (this.worker) return this.worker;
    assert(!this.closed && !this.quarantined, 'runtime spool writer is unavailable');
    const worker = this.workerFactory(this.targetPath);
    this.worker = worker;
    worker.on('message', (message) => this.handleMessage(message));
    worker.on('error', (error) => this.fail(error));
    worker.on('exit', (code) => {
      if (this.closed || this.quarantined) return;
      this.fail(new Error(`runtime spool worker exited before close: ${code}`));
    });
    return worker;
  }

  private handleMessage(message: unknown): void {
    if (
      !isRecord(message) ||
      !Number.isSafeInteger(message.id) ||
      typeof message.type !== 'string'
    ) {
      this.fail(new Error('runtime spool worker reply is malformed'));
      return;
    }
    const id = message.id as number;
    const pending = this.pending.get(id);
    if (!pending) return;
    if (message.type === 'error') {
      this.fail(
        new Error(
          typeof message.message === 'string' ? message.message : 'runtime spool worker failed',
        ),
      );
      return;
    }
    if (message.type === 'append-complete') {
      if (!Number.isSafeInteger(message.offset) || !Number.isSafeInteger(message.bytes)) {
        this.fail(new Error('runtime spool append acknowledgement is malformed'));
        return;
      }
      this.pending.delete(id);
      pending.resolve({
        type: 'append-complete',
        id,
        offset: message.offset as number,
        bytes: message.bytes as number,
      });
      return;
    }
    if (message.type === 'close-complete') {
      this.pending.delete(id);
      pending.resolve({ type: 'close-complete', id });
      return;
    }
    this.fail(new Error('runtime spool worker reply type is unsupported'));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.quarantined = true;
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
    void this.terminateWorker().catch(() => undefined);
  }

  private async terminateWorker(timeoutMs = 10_000): Promise<void> {
    if (this.terminationPromise) return this.terminationPromise;
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    this.terminationPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('runtime spool worker termination timed out'));
      }, timeoutMs);
      void worker.terminate().then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
    return this.terminationPromise;
  }

  private async send(
    message: { readonly type: 'append'; readonly bytes: Uint8Array } | { readonly type: 'close' },
    options: RuntimeSpoolAppendOptions,
  ): Promise<RuntimeSpoolWorkerReply> {
    this.validateBeforeWorkerIo(options);
    const worker = this.ensureWorker();
    const id = this.nextRequestId++;
    const timeoutMs = Math.max(1, Math.ceil(options.deadlineAtMonotonicMs - this.now()));
    return new Promise<RuntimeSpoolWorkerReply>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.pending.delete(id);
        const error = new Error('runtime spool I/O deadline reached');
        this.fail(error);
        reject(error);
      }, timeoutMs);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(id);
        const error = new Error('runtime spool I/O cancelled');
        this.fail(error);
        reject(error);
      };
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        return true;
      };
      this.pending.set(id, {
        resolve: (reply) => {
          if (settle()) resolve(reply);
        },
        reject: (error) => {
          if (settle()) reject(error);
        },
      });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        if (message.type === 'append') {
          const transferable = Uint8Array.from(message.bytes);
          worker.postMessage({ type: 'append', id, bytes: transferable }, [transferable.buffer]);
        } else worker.postMessage({ type: 'close', id });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        const failure = error instanceof Error ? error : new Error(String(error));
        this.fail(failure);
        reject(failure);
      }
    });
  }

  private validateBeforeWorkerIo(options: RuntimeSpoolAppendOptions): void {
    if (options.signal?.aborted) {
      const error = new Error('runtime spool I/O cancelled');
      this.fail(error);
      throw error;
    }
    if (
      !Number.isSafeInteger(options.deadlineAtMonotonicMs) ||
      options.deadlineAtMonotonicMs <= 0
    ) {
      const error = new Error('runtime spool I/O deadline is invalid');
      this.fail(error);
      throw error;
    }
    if (options.deadlineAtMonotonicMs <= this.now()) {
      const error = new Error('runtime spool I/O deadline reached');
      this.fail(error);
      throw error;
    }
  }

  async append(
    rawBytes: Uint8Array,
    options: RuntimeSpoolAppendOptions,
  ): Promise<RuntimeSpoolReference> {
    assert(!this.closed && !this.quarantined, 'runtime spool writer is unavailable');
    this.validateBeforeWorkerIo(options);
    assert(
      Number.isSafeInteger(rawBytes.byteLength) &&
        rawBytes.byteLength <= Number.MAX_SAFE_INTEGER - this.nextOffset,
      'runtime spool append byte count exceeds the safe offset range',
    );
    const reservedOffset = this.nextOffset;
    this.nextOffset += rawBytes.byteLength;
    const reply = await this.send({ type: 'append', bytes: rawBytes }, options);
    assert(reply.type === 'append-complete', 'runtime spool append did not complete');
    assert(reply.offset === reservedOffset, 'runtime spool append offset changed');
    assert(reply.bytes === rawBytes.byteLength, 'runtime spool append byte count changed');
    return { path: path.basename(this.targetPath), offset: reply.offset, bytes: reply.bytes };
  }

  async close(
    options:
      number | { readonly signal?: AbortSignal; readonly deadlineAtMonotonicMs: number } = 10_000,
  ): Promise<void> {
    if (this.closed) return;
    if (this.failure) {
      this.closed = true;
      await this.terminateWorker();
      throw this.failure;
    }
    if (!this.worker) {
      this.closed = true;
      return;
    }
    const closeOptions =
      typeof options === 'number' ? { deadlineAtMonotonicMs: this.now() + options } : options;
    const deadlineAtMonotonicMs = closeOptions.deadlineAtMonotonicMs;
    try {
      const reply = await this.send(
        { type: 'close' },
        { signal: closeOptions.signal, deadlineAtMonotonicMs },
      );
      assert(reply.type === 'close-complete', 'runtime spool close did not complete');
      this.closed = true;
      await this.terminateWorker();
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      this.closed = true;
      await this.terminateWorker().catch(() => undefined);
      throw error;
    }
  }

  get bytes(): number {
    return this.nextOffset;
  }

  get failed(): Error | null {
    return this.failure;
  }
}

export class OwnedMaestroMcpStdioSession {
  readonly sessionId = randomUUID();
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly artifactRoot: string;
  readonly ledgerPath: string;
  private readonly repositoryRoot: string | null;
  private readonly spawnProcess: SpawnProcess;
  private readonly processController?: OwnedProcessController;
  private readonly socketInspector: SocketInspector;
  private readonly now: MonotonicClock;
  private readonly protocolDeadlineMs: number;
  private readonly ownerDeadlineMs: number;
  private readonly ownerDeadlineAtMonotonicMs?: number;
  private readonly runtimeSpoolWorkerFactory?: RuntimeSpoolWorkerFactory;
  private readonly beforeSpawn?: LaunchOptions['beforeSpawn'];
  private readonly env: NodeJS.ProcessEnv;
  private state: SessionState = 'idle';
  private child: McpChild | null = null;
  private ownedGroup: OwnedProcessGroup | null = null;
  private ownershipPromise: Promise<OwnedProcessGroup> | null = null;
  private ownershipAdopted = false;
  private terminalCleanupFinished = false;
  private lateOwnedGroup: OwnedProcessGroup | null = null;
  private lateOwnershipCleanup: Promise<void> | null = null;
  private lateRecoveryDeadlineAtMonotonicMs: number | null = null;
  private childClosePromise: Promise<void> | null = null;
  private nextId = 1;
  private nextSequence = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly retired = new Map<number, RetiredRequest>();
  private readonly envelopes: ProtocolEnvelope[] = [];
  private runtimeRawEnvelopeBytes = 0;
  private runtimeRawSpoolWriter: BoundedRuntimeRawSpoolWriter | null = null;
  private runtimeRawSpoolPath: string | null = null;
  private runtimeRawSpoolBytes = 0;
  private runtimeRawSpoolReservedBytes = 0;
  private runtimeRawSpoolAppendTail = Promise.resolve();
  private readonly runtimeRawSpoolDigest = createHash('sha256');
  private readonly rejectedRawEvidence: RejectedRawEvidence[] = [];
  private rejectedRawBytes = 0;
  private rejectedRawDroppedCount = 0;
  private readonly unboundRejectedLines: {
    rawBytes: Uint8Array;
    receivedAtMonotonicMs: number;
    reason: RejectedRawEvidence['reason'];
    bytesObserved: number;
    complete: boolean;
  }[] = [];
  private unboundRejectedBytes = 0;
  private stdoutBuffer = Buffer.alloc(0);
  private stdoutQueue = Promise.resolve();
  private stderrBuffer = Buffer.alloc(0);
  private protocolFailure: Error | null = null;
  private childIdentity: OwnedProcessIdentity | null = null;
  private deadlineAtMonotonicMs: number | null = null;
  private startupDeadlineAtMonotonicMs: number | null = null;
  private startedAtMonotonicMs: number | null = null;
  private finishedAtMonotonicMs: number | null = null;
  private toolNames: readonly string[] = [];
  private outputSchemasAdvertised: readonly (boolean | null)[] = [];
  private closePromise: Promise<CloseReceipt> | null = null;
  private cleanup: CloseReceipt | null = null;

  constructor(options: LaunchOptions) {
    assert(options.argv.length >= 2, 'MCP launch argv is incomplete');
    assert(path.isAbsolute(options.cwd), 'MCP launch cwd must be absolute');
    assert(path.isAbsolute(options.artifactRoot), 'MCP artifact root must be absolute');
    const protocolDeadlineMs = assertFiniteDeadline(
      options.protocolDeadlineMs ?? DEFAULT_PROTOCOL_DEADLINE_MS,
      'MCP protocol deadline',
    );
    const ownerDeadlineMs = assertFiniteOwnerDeadline(
      options.ownerDeadlineMs ?? DEFAULT_OWNER_DEADLINE_MS,
      'MCP owner deadline',
    );
    if (options.ownerDeadlineAtMonotonicMs !== undefined) {
      assert(
        Number.isSafeInteger(options.ownerDeadlineAtMonotonicMs) &&
          options.ownerDeadlineAtMonotonicMs > 0,
        'MCP absolute owner deadline is invalid',
      );
    }
    this.argv = options.argv.map((value) => String(value));
    this.cwd = options.cwd;
    this.artifactRoot = path.resolve(options.artifactRoot);
    this.ledgerPath = path.resolve(
      options.ledgerPath ?? path.join(this.artifactRoot, 'mcp-process-ownership.json'),
    );
    this.repositoryRoot = options.repositoryRoot ? path.resolve(options.repositoryRoot) : null;
    assert(
      isWithin(this.artifactRoot, this.ledgerPath),
      'MCP ownership ledger must be below the artifact root',
    );
    this.spawnProcess =
      options.spawnProcess ?? ((file, args, spawnOptions) => spawn(file, [...args], spawnOptions));
    this.processController = options.processController;
    assert(typeof options.socketInspector === 'function', 'MCP socket inspector is required');
    this.socketInspector = options.socketInspector;
    this.now = options.now ?? monotonicNowMs;
    this.protocolDeadlineMs = protocolDeadlineMs;
    this.ownerDeadlineMs = ownerDeadlineMs;
    this.ownerDeadlineAtMonotonicMs = options.ownerDeadlineAtMonotonicMs;
    this.runtimeSpoolWorkerFactory = options.runtimeSpoolWorkerFactory;
    this.beforeSpawn = options.beforeSpawn;
    const allowedEnvironment = new Set([
      'PATH',
      'JAVA_HOME',
      'MAESTRO_CLI_NO_ANALYTICS',
      'MAESTRO_DISABLE_UPDATE_CHECK',
    ]);
    for (const [key, value] of Object.entries(options.env ?? {})) {
      assert(allowedEnvironment.has(key), `MCP environment key is not allowed: ${key}`);
      assert(!/[\u0000\r\n]/.test(value), `MCP environment value is unsafe: ${key}`);
    }
    const inheritedEnvironment = process.env as Record<string, string | undefined>;
    const inheritedNodeEnv = inheritedEnvironment.NODE_ENV;
    const nodeEnv =
      inheritedNodeEnv === 'development' ||
      inheritedNodeEnv === 'production' ||
      inheritedNodeEnv === 'test'
        ? inheritedNodeEnv
        : 'test';
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: nodeEnv,
      PATH: inheritedEnvironment.PATH ?? '/usr/bin:/bin',
      MAESTRO_CLI_NO_ANALYTICS: '1',
      MAESTRO_DISABLE_UPDATE_CHECK: 'true',
    };
    for (const [key, value] of Object.entries(options.env ?? {})) environment[key] = value;
    this.env = environment;
  }

  async start(
    options: { readonly signal?: AbortSignal; readonly deadlineMs?: number } = {},
  ): Promise<this> {
    assert(this.state === 'idle', 'MCP session started twice');
    if (options.signal?.aborted) throw abortError('startup');
    const deadlineMs = assertFiniteDeadline(
      options.deadlineMs ?? this.protocolDeadlineMs,
      'MCP startup deadline',
    );
    this.state = 'starting';
    this.startedAtMonotonicMs = this.now();
    this.deadlineAtMonotonicMs =
      this.ownerDeadlineAtMonotonicMs ?? this.startedAtMonotonicMs + this.ownerDeadlineMs;
    this.startupDeadlineAtMonotonicMs = Math.min(
      this.startedAtMonotonicMs + deadlineMs,
      this.deadlineAtMonotonicMs,
    );
    assert(
      Number.isSafeInteger(this.startupDeadlineAtMonotonicMs),
      'MCP startup deadline overflowed the monotonic clock',
    );
    assert(
      Number.isSafeInteger(this.deadlineAtMonotonicMs),
      'MCP owner deadline overflowed the monotonic clock',
    );
    try {
      await this.bounded(
        requirePrivateArtifactRoot(this.artifactRoot),
        'artifact root',
        options.signal,
        this.startupDeadlineAtMonotonicMs,
      );
      const controller =
        this.processController ??
        (this.repositoryRoot
          ? await this.bounded(
              createOwnedMaestroProcessController(this.repositoryRoot),
              'process controller',
              options.signal,
              this.startupDeadlineAtMonotonicMs,
            )
          : null);
      assert(controller !== null, 'Owned process controller is required before MCP startup');
      if (options.signal?.aborted) throw abortError('startup');
      if (this.beforeSpawn) {
        const deadlineAtMonotonicMs = this.startupDeadlineAtMonotonicMs;
        assert(deadlineAtMonotonicMs !== null, 'MCP startup deadline is unavailable');
        await this.bounded(
          this.beforeSpawn({ signal: options.signal, deadlineAtMonotonicMs }),
          'MCP executable verification',
          options.signal,
          deadlineAtMonotonicMs,
        );
      }
      this.child = asMcpChild(
        this.spawnProcess(this.argv[0], this.argv.slice(1), {
          cwd: this.cwd,
          detached: true,
          env: this.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
      this.childClosePromise = new Promise<void>((resolve) => {
        this.child?.once('close', () => resolve());
      });
      this.child.stdout.on('data', (chunk: Buffer | string) => {
        this.stdoutQueue = this.stdoutQueue
          .then(() => this.consumeStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
          .catch((error: unknown) => this.failProtocol(error));
      });
      this.child.stderr.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.stderrBuffer = Buffer.concat([this.stderrBuffer, bytes]).subarray(-100_000);
      });
      this.child.on('error', (error) => this.failProtocol(error));
      const ownershipPromise = controller.trackOwnedProcessGroup(
        this.child,
        this.ledgerPath,
        'step',
      );
      this.ownershipPromise = ownershipPromise;
      this.lateOwnershipCleanup = ownershipPromise.then(
        (group) => {
          if (this.ownershipAdopted) return;
          if (this.terminalCleanupFinished) {
            return this.cleanupLateOwnedGroup(group);
          }
          this.lateOwnedGroup = group;
        },
        (error: unknown) => {
          this.protocolFailure ??= error instanceof Error ? error : new Error(String(error));
        },
      );
      this.ownedGroup = await this.bounded(
        ownershipPromise,
        'process ownership',
        options.signal,
        this.startupDeadlineAtMonotonicMs,
      );
      assert(
        this.ownedGroup.pgid === this.child.pid,
        'Owned MCP process group leader differs from the child PID',
      );
      this.ownershipAdopted = true;
      this.lateOwnedGroup = null;
      await this.refreshIdentity(options.signal, this.startupDeadlineAtMonotonicMs);
      await this.handshake(options.signal, this.startupDeadlineAtMonotonicMs);
      assert(
        this.protocolFailure === null && this.state === 'starting',
        'MCP protocol failed during startup',
      );
      this.state = 'ready';
      return this;
    } catch (error) {
      this.protocolFailure ??= error instanceof Error ? error : new Error(String(error));
      if (
        this.child &&
        !this.ownedGroup &&
        this.child.exitCode === null &&
        this.child.signalCode === null
      ) {
        this.child.kill('SIGTERM');
        if (this.childClosePromise)
          await Promise.race([
            this.childClosePromise,
            new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
          ]);
      }
      const recoveryDeadlineAtMonotonicMs = this.now() + 10_000;
      await this.close({
        signal: options.signal,
        deadlineAtMonotonicMs: this.deadlineAtMonotonicMs ?? recoveryDeadlineAtMonotonicMs,
        recoveryDeadlineAtMonotonicMs,
        ownerSignal: options.signal,
      }).catch(() => undefined);
      throw error;
    }
  }

  private remainingDeadline(deadlineAtMonotonicMs = this.deadlineAtMonotonicMs): number {
    assert(deadlineAtMonotonicMs !== null, 'MCP session deadline is not initialized');
    const remaining = deadlineAtMonotonicMs - this.now();
    if (remaining <= 0) throw abortError('session');
    return Math.max(1, Math.ceil(remaining));
  }

  private async bounded<T>(
    operation: Promise<T>,
    method: string,
    signal?: AbortSignal,
    deadlineAtMonotonicMs = this.deadlineAtMonotonicMs,
  ): Promise<T> {
    let timeoutMs: number;
    try {
      timeoutMs =
        deadlineAtMonotonicMs === null
          ? this.protocolDeadlineMs
          : this.remainingDeadline(deadlineAtMonotonicMs);
      if (signal?.aborted) throw abortError(method);
    } catch (error) {
      void operation.catch(() => undefined);
      throw error;
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finishReject(abortError(method)), timeoutMs);
      const onAbort = () => finishReject(abortError(method));
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const finishResolve = (value: T) => {
        if (settled) return;
        if (deadlineAtMonotonicMs !== null && this.now() > deadlineAtMonotonicMs) {
          finishReject(abortError(method));
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const finishReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      operation.then(finishResolve, finishReject);
    });
  }

  private async cleanupLateOwnedGroup(group: OwnedProcessGroup): Promise<void> {
    let failure: Error | null = null;
    const deadlineAtMonotonicMs =
      this.lateRecoveryDeadlineAtMonotonicMs ?? this.deadlineAtMonotonicMs ?? this.now();
    const boundedLateRecovery = <T>(operation: Promise<T>, label: string): Promise<T> =>
      boundedCleanup(operation, Math.max(1, Math.ceil(deadlineAtMonotonicMs - this.now())), label);
    try {
      await boundedLateRecovery(group.stop(), 'Late MCP process cleanup');
      const remaining = await boundedLateRecovery(group.capture(false), 'Late MCP final census');
      if (remaining.length > 0) failure = new Error('Late MCP process group remains after cleanup');
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    if (failure) {
      this.protocolFailure ??= failure;
      if (this.cleanup) {
        this.cleanup = {
          ...this.cleanup,
          status: 'failed',
          ownedProcessGroupAbsent: false,
          cleanupError: failure.message,
        };
      }
    }
  }

  private adoptLateOwnedGroupIfAvailable(): boolean {
    if (this.ownedGroup || !this.lateOwnedGroup) return this.ownedGroup !== null;
    assert(
      !this.child || this.lateOwnedGroup.pgid === this.child.pid,
      'Late MCP process group leader differs from the child PID',
    );
    this.ownedGroup = this.lateOwnedGroup;
    this.lateOwnedGroup = null;
    this.ownershipAdopted = true;
    return true;
  }

  private async refreshIdentity(
    signal?: AbortSignal,
    deadlineAtMonotonicMs = this.deadlineAtMonotonicMs,
  ): Promise<OwnedProcessIdentity> {
    assert(this.child?.pid && this.ownedGroup, 'MCP process ownership is not established');
    const rows = await this.bounded(
      this.ownedGroup.capture(true),
      'process identity refresh',
      signal,
      deadlineAtMonotonicMs,
    );
    const leader = rows.find((row) => row.pid === this.child?.pid);
    assert(leader !== undefined, 'Owned MCP child is absent from the strict process census');
    assert(leader.pgid === this.ownedGroup.pgid, 'Owned MCP child process group changed');
    if (this.childIdentity) {
      assert(
        leader.started === this.childIdentity.started,
        'Owned MCP child start identity changed',
      );
      assert(leader.pgid === this.childIdentity.pgid, 'Owned MCP child group identity changed');
    }
    this.childIdentity = {
      pid: leader.pid,
      pgid: leader.pgid,
      started: leader.started,
      commandHash: leader.commandHash,
    };
    while (this.unboundRejectedLines.length > 0) {
      const line = this.unboundRejectedLines.shift();
      if (line)
        await this.recordProtocolFailureEnvelope(line.rawBytes, line.receivedAtMonotonicMs, {
          reason: line.reason,
          bytesObserved: line.bytesObserved,
          complete: line.complete,
        });
    }
    this.unboundRejectedBytes = 0;
    return cloneIdentity(this.childIdentity);
  }

  private async makeEnvelope(
    kind: EnvelopeKind,
    id: number | null,
    method: string | null,
    rawBytes: Uint8Array,
    sentAtMonotonicMs: number | null,
    receivedAtMonotonicMs: number | null,
    requestSequence: number | null = null,
    lateResponse = false,
    signal?: AbortSignal,
    deadlineAtMonotonicMs = this.deadlineAtMonotonicMs,
  ): Promise<ProtocolEnvelope> {
    assert(this.childIdentity !== null, 'MCP child identity is unavailable for protocol envelope');
    let rawSpool: ProtocolEnvelope['rawSpool'];
    try {
      rawSpool = await this.appendRuntimeRawSpool(rawBytes, signal, deadlineAtMonotonicMs);
    } catch (error) {
      this.recordRejectedRawEvidence(rawBytes, receivedAtMonotonicMs, {
        reason: 'spool-failure',
        bytesObserved: rawBytes.byteLength,
        complete: false,
      });
      throw error;
    }
    const retainedRawBytes =
      this.runtimeRawEnvelopeBytes + rawBytes.byteLength <= MAX_RUNTIME_RAW_ENVELOPE_MEMORY_BYTES
        ? Uint8Array.from(rawBytes)
        : new Uint8Array(0);
    this.runtimeRawEnvelopeBytes += retainedRawBytes.byteLength;
    const envelope: ProtocolEnvelope = {
      sessionId: this.sessionId,
      sequence: this.nextSequence++,
      kind,
      id,
      method,
      requestSequence,
      rawBytes: retainedRawBytes,
      rawByteLength: rawBytes.byteLength,
      rawSpool,
      rawSha256: sha256(rawBytes),
      sentAtMonotonicMs,
      receivedAtMonotonicMs,
      childIdentity: cloneIdentity(this.childIdentity),
      lateResponse,
    };
    this.envelopes.push(envelope);
    return envelope;
  }

  private async appendRuntimeRawSpool(
    rawBytes: Uint8Array,
    signal?: AbortSignal,
    deadlineAtMonotonicMs = this.deadlineAtMonotonicMs,
  ): Promise<ProtocolEnvelope['rawSpool']> {
    assert(deadlineAtMonotonicMs !== null, 'MCP runtime spool deadline is not initialized');
    this.validateRuntimeRawSpoolAppend(signal, deadlineAtMonotonicMs);
    const nextBytes =
      this.runtimeRawSpoolBytes + this.runtimeRawSpoolReservedBytes + rawBytes.byteLength;
    assert(
      nextBytes <= MAX_RUNTIME_RAW_ENVELOPE_SPOOL_BYTES,
      'MCP runtime raw spool exceeds the private byte limit',
    );
    this.runtimeRawSpoolReservedBytes += rawBytes.byteLength;
    let releaseTurn: (() => void) | undefined;
    const turn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const previousTurn = this.runtimeRawSpoolAppendTail;
    this.runtimeRawSpoolAppendTail = previousTurn.then(
      () => turn,
      () => turn,
    );
    try {
      await this.waitForRuntimeRawSpoolTurn(previousTurn, signal, deadlineAtMonotonicMs);
      if (this.runtimeRawSpoolWriter === null) {
        const noFollow = fsConstants.O_NOFOLLOW;
        assert(typeof noFollow === 'number', 'MCP private spool requires O_NOFOLLOW');
        const relativePath = `mcp-runtime-raw-${this.sessionId}.private.bin`;
        const target = path.resolve(this.artifactRoot, relativePath);
        assert(
          isWithin(this.artifactRoot, target) && path.basename(target) === relativePath,
          'MCP runtime spool escaped the artifact root',
        );
        this.runtimeRawSpoolPath = relativePath;
        this.runtimeRawSpoolWriter = new BoundedRuntimeRawSpoolWriter(target, {
          now: this.now,
          workerFactory: this.runtimeSpoolWorkerFactory,
        });
      }
      const reference = await this.runtimeRawSpoolWriter.append(rawBytes, {
        signal,
        deadlineAtMonotonicMs,
      });
      assert(this.runtimeRawSpoolPath !== null, 'MCP runtime spool path is unavailable');
      assert(reference.offset === this.runtimeRawSpoolBytes, 'MCP runtime spool offset changed');
      this.runtimeRawSpoolBytes += rawBytes.byteLength;
      this.runtimeRawSpoolDigest.update(rawBytes);
      return { path: this.runtimeRawSpoolPath, offset: reference.offset, bytes: reference.bytes };
    } finally {
      this.runtimeRawSpoolReservedBytes -= rawBytes.byteLength;
      assert(releaseTurn !== undefined, 'MCP runtime spool queue turn is unavailable');
      releaseTurn();
    }
  }

  private validateRuntimeRawSpoolAppend(
    signal: AbortSignal | undefined,
    deadlineAtMonotonicMs: number,
  ): void {
    if (signal?.aborted) throw new Error('runtime spool I/O cancelled');
    if (!Number.isSafeInteger(deadlineAtMonotonicMs) || deadlineAtMonotonicMs <= 0)
      throw new Error('runtime spool I/O deadline is invalid');
    if (deadlineAtMonotonicMs <= this.now()) throw new Error('runtime spool I/O deadline reached');
  }

  private async waitForRuntimeRawSpoolTurn(
    previousTurn: Promise<void>,
    signal: AbortSignal | undefined,
    deadlineAtMonotonicMs: number,
  ): Promise<void> {
    const timeoutMs = Math.max(1, Math.ceil(deadlineAtMonotonicMs - this.now()));
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('runtime spool I/O deadline reached'));
      }, timeoutMs);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('runtime spool I/O cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      previousTurn.then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * Read one envelope through the session-owned raw-spool reader. The receipt
   * intentionally exposes empty rawBytes after the 16 MiB in-memory budget;
   * callers must use this bounded descriptor-backed method for those rows.
   */
  readOwnedProtocolEnvelopeRawBytes(envelope: ProtocolEnvelope): Buffer {
    const owned = this.envelopes.find((candidate) => candidate.sequence === envelope.sequence);
    assert(owned !== undefined, 'MCP raw envelope is not owned by this session');
    assert(
      envelope.sessionId === this.sessionId &&
        owned.sessionId === this.sessionId &&
        owned.rawByteLength === envelope.rawByteLength &&
        owned.rawSha256 === envelope.rawSha256 &&
        (owned.rawSpool?.path ?? null) === (envelope.rawSpool?.path ?? null) &&
        (owned.rawSpool?.offset ?? null) === (envelope.rawSpool?.offset ?? null) &&
        (owned.rawSpool?.bytes ?? null) === (envelope.rawSpool?.bytes ?? null),
      'MCP raw envelope identity differs from the owned receipt',
    );
    assert(
      Number.isSafeInteger(envelope.rawByteLength) &&
        envelope.rawByteLength > 0 &&
        envelope.rawByteLength <= MAX_JSON_LINE_BYTES,
      'MCP raw envelope length exceeds the private limit',
    );
    if (envelope.rawBytes.byteLength === envelope.rawByteLength) {
      const rawBytes = Buffer.from(envelope.rawBytes);
      assert(sha256(rawBytes) === envelope.rawSha256, 'MCP in-memory raw envelope hash changed');
      return rawBytes;
    }
    assert(
      envelope.rawBytes.byteLength === 0,
      'MCP runtime raw envelope retained a partial in-memory copy',
    );
    const rawSpool = envelope.rawSpool;
    assert(
      rawSpool !== null &&
        Number.isSafeInteger(rawSpool.offset) &&
        rawSpool.offset >= 0 &&
        Number.isSafeInteger(rawSpool.bytes) &&
        rawSpool.bytes > 0 &&
        rawSpool.bytes <= MAX_JSON_LINE_BYTES &&
        rawSpool.bytes === envelope.rawByteLength &&
        rawSpool.path === this.runtimeRawSpoolPath,
      'MCP runtime raw envelope spool reference is incomplete',
    );
    assert(
      rawSpool.offset <= Number.MAX_SAFE_INTEGER - rawSpool.bytes,
      'MCP runtime raw envelope spool offset exceeds the safe range',
    );
    const target = path.resolve(this.artifactRoot, rawSpool.path);
    assert(
      isWithin(this.artifactRoot, target) && path.basename(target) === rawSpool.path,
      'MCP runtime raw envelope spool path escaped the artifact root',
    );
    const noFollow = fsConstants.O_NOFOLLOW;
    assert(typeof noFollow === 'number', 'MCP private spool requires O_NOFOLLOW');
    const pathBefore = lstatSync(target);
    assert(
      pathBefore.isFile() &&
        pathBefore.uid === (process.getuid?.() ?? pathBefore.uid) &&
        pathBefore.nlink === 1 &&
        (pathBefore.mode & 0o777) === 0o600 &&
        realpathSync(target) === target,
      'MCP runtime spool path changed before read',
    );
    const fd = openSync(target, fsConstants.O_RDONLY | noFollow);
    try {
      const before = fstatSync(fd);
      assert(
        before.isFile() && before.uid === (process.getuid?.() ?? before.uid) && before.nlink === 1,
        'MCP runtime spool ownership changed',
      );
      assert((before.mode & 0o777) === 0o600, 'MCP runtime spool mode changed');
      assert(
        before.dev === pathBefore.dev &&
          before.ino === pathBefore.ino &&
          before.uid === pathBefore.uid &&
          before.gid === pathBefore.gid &&
          before.mode === pathBefore.mode &&
          before.nlink === pathBefore.nlink,
        'MCP runtime spool path changed before descriptor read',
      );
      assert(
        rawSpool.offset + rawSpool.bytes <= before.size,
        'MCP runtime raw envelope spool reference is truncated',
      );
      const rawBytes = Buffer.alloc(rawSpool.bytes);
      let read = 0;
      while (read < rawBytes.byteLength) {
        const count = readSync(
          fd,
          rawBytes,
          read,
          rawBytes.byteLength - read,
          rawSpool.offset + read,
        );
        assert(count > 0, 'MCP runtime raw spool made no read progress');
        read += count;
      }
      const after = fstatSync(fd);
      const pathAfter = lstatSync(target);
      assert(
        after.isFile() &&
          after.dev === before.dev &&
          after.ino === before.ino &&
          after.uid === before.uid &&
          after.gid === before.gid &&
          after.mode === before.mode &&
          after.nlink === before.nlink &&
          after.size >= rawSpool.offset + rawSpool.bytes,
        'MCP runtime spool changed during envelope read',
      );
      assert(
        pathAfter.isFile() &&
          pathAfter.dev === before.dev &&
          pathAfter.ino === before.ino &&
          pathAfter.uid === before.uid &&
          pathAfter.gid === before.gid &&
          pathAfter.mode === before.mode &&
          pathAfter.nlink === before.nlink &&
          pathAfter.size >= rawSpool.offset + rawSpool.bytes &&
          realpathSync(target) === target,
        'MCP runtime spool path changed during envelope read',
      );
      assert(sha256(rawBytes) === envelope.rawSha256, 'MCP spooled raw envelope hash changed');
      return rawBytes;
    } finally {
      closeSync(fd);
    }
  }

  private async closeRuntimeRawSpool(options: {
    readonly signal?: AbortSignal;
    readonly deadlineAtMonotonicMs: number;
  }): Promise<void> {
    if (this.runtimeRawSpoolWriter === null) return;
    const writer = this.runtimeRawSpoolWriter;
    await this.runtimeRawSpoolAppendTail;
    this.runtimeRawSpoolWriter = null;
    await writer.close(options);
    await this.verifyRuntimeRawSpoolDigest(options);
  }

  private async verifyRuntimeRawSpoolDigest(options: {
    readonly signal?: AbortSignal;
    readonly deadlineAtMonotonicMs: number;
  }): Promise<void> {
    if (this.runtimeRawSpoolPath === null) return;
    const target = path.resolve(this.artifactRoot, this.runtimeRawSpoolPath);
    assert(
      isWithin(this.artifactRoot, target) && path.basename(target) === this.runtimeRawSpoolPath,
      'MCP runtime raw spool path escaped the artifact root',
    );
    const noFollow = fsConstants.O_NOFOLLOW;
    assert(typeof noFollow === 'number', 'MCP private spool requires O_NOFOLLOW');
    const file = await open(target, fsConstants.O_RDONLY | noFollow);
    try {
      const before = await file.stat();
      const uid = process.getuid?.() ?? before.uid;
      assert(before.isFile() && before.uid === uid, 'MCP runtime spool ownership changed');
      assert((before.mode & 0o777) === 0o600, 'MCP runtime spool mode changed');
      assert(before.size === this.runtimeRawSpoolBytes, 'MCP runtime raw spool byte count changed');
      const expectedDigest = this.runtimeRawSpoolDigest.copy().digest('hex');
      const digest = createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let offset = 0;
      while (offset < before.size) {
        options.signal?.throwIfAborted();
        assert(
          this.now() < options.deadlineAtMonotonicMs,
          'MCP runtime raw spool aggregate hash timed out',
        );
        const bytesToRead = Math.min(buffer.byteLength, before.size - offset);
        const { bytesRead } = await file.read(buffer, 0, bytesToRead, offset);
        assert(bytesRead > 0, 'MCP runtime raw spool made no read progress');
        digest.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      const after = await file.stat();
      options.signal?.throwIfAborted();
      assert(
        this.now() < options.deadlineAtMonotonicMs,
        'MCP runtime raw spool aggregate hash timed out',
      );
      assert(
        after.isFile() &&
          after.uid === uid &&
          after.mode === before.mode &&
          after.dev === before.dev &&
          after.ino === before.ino &&
          after.size === before.size,
        'MCP runtime raw spool changed during aggregate hash',
      );
      const actualDigest = digest.digest('hex');
      assert(
        actualDigest === expectedDigest,
        `MCP runtime raw spool aggregate hash changed: expected ${expectedDigest}, actual ${actualDigest}`,
      );
    } finally {
      await file.close();
    }
  }

  private async writeLine(rawBytes: Uint8Array): Promise<void> {
    assert(this.child?.stdin && !this.child.stdin.destroyed, 'MCP stdin is closed');
    await new Promise<void>((resolve, reject) => {
      const stdin = this.child?.stdin;
      if (!stdin) {
        reject(new OwnedMcpProtocolError('MCP stdin is unavailable'));
        return;
      }
      let settled = false;
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        stdin.off('error', onError);
        stdin.off('close', onClose);
        reject(error);
      };
      const onClose = () => {
        if (settled) return;
        settled = true;
        stdin.off('error', onError);
        stdin.off('close', onClose);
        reject(new OwnedMcpProtocolError('MCP stdin closed before the line was written'));
      };
      stdin.once('error', onError);
      stdin.once('close', onClose);
      stdin.write(rawBytes, () => {
        if (settled) return;
        settled = true;
        stdin.off('error', onError);
        stdin.off('close', onClose);
        resolve();
      });
    });
  }

  private requestDeadlineAt(deadlineMs?: number): number {
    const requestedMs = assertFiniteDeadline(
      deadlineMs ?? this.protocolDeadlineMs,
      'MCP request deadline',
    );
    assert(this.deadlineAtMonotonicMs !== null, 'MCP owner deadline is not initialized');
    const requestDeadlineAtMonotonicMs = Math.min(
      this.deadlineAtMonotonicMs,
      this.now() + requestedMs,
    );
    if (requestDeadlineAtMonotonicMs <= this.now()) throw abortError('request');
    return requestDeadlineAtMonotonicMs;
  }

  private async request(
    method: string,
    params: JsonObject,
    signal?: AbortSignal,
    deadlineAtMonotonicMs?: number,
  ): Promise<RequestResponse> {
    assert(
      this.state === 'starting' || this.state === 'ready',
      `MCP session is unavailable before ${method}`,
    );
    if (signal?.aborted) throw abortError(method);
    const operationDeadlineAt = deadlineAtMonotonicMs ?? this.requestDeadlineAt();
    this.remainingDeadline(operationDeadlineAt);
    await this.refreshIdentity(signal, operationDeadlineAt);
    if (signal?.aborted) throw abortError(method);
    const id = this.nextId++;
    const rawBytes = Buffer.from(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      'utf8',
    );
    assert(
      rawBytes.byteLength <= MAX_OUTBOUND_JSON_LINE_BYTES,
      'MCP outbound JSON-RPC line exceeds the private limit',
    );
    const sentAtMonotonicMs = this.now();
    const requestEnvelope = await this.makeEnvelope(
      'request',
      id,
      method,
      rawBytes,
      sentAtMonotonicMs,
      null,
      null,
      false,
      signal,
      operationDeadlineAt,
    );
    const timeoutMs = Math.max(1, this.remainingDeadline(operationDeadlineAt));
    const response = new Promise<RequestResponse>((resolve, reject) => {
      const settleRetired = (reason: RetiredRequest['reason'], error: Error) => {
        if (this.pending.get(id) !== pending) return;
        this.pending.delete(id);
        this.retired.set(id, { method, requestSequence: requestEnvelope.sequence, reason });
        pending.reject(error);
      };
      const timer = setTimeout(() => settleRetired('deadline', abortError(method)), timeoutMs);
      const abort = signal ? () => settleRetired('cancelled', abortError(method)) : null;
      const pending: PendingRequest = {
        id,
        method,
        requestSequence: requestEnvelope.sequence,
        signal: signal ?? null,
        deadlineAtMonotonicMs: operationDeadlineAt,
        timer,
        abort,
        resolve: (value) => {
          clearTimeout(timer);
          if (abort) signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          if (abort) signal?.removeEventListener('abort', abort);
          reject(error);
        },
      };
      if (abort) signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, pending);
    });
    void this.bounded(
      this.writeLine(rawBytes),
      `write ${method}`,
      undefined,
      operationDeadlineAt,
    ).catch((error: unknown) => {
      this.failProtocol(error, 'write-failed');
    });
    return response;
  }

  private async sendNotification(
    method: string,
    params: JsonObject,
    signal?: AbortSignal,
    deadlineAtMonotonicMs?: number,
  ): Promise<void> {
    const operationDeadlineAt = deadlineAtMonotonicMs ?? this.requestDeadlineAt();
    this.remainingDeadline(operationDeadlineAt);
    await this.refreshIdentity(signal, operationDeadlineAt);
    const rawBytes = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`, 'utf8');
    assert(
      rawBytes.byteLength <= MAX_OUTBOUND_JSON_LINE_BYTES,
      'MCP outbound JSON-RPC line exceeds the private limit',
    );
    await this.makeEnvelope(
      'notification',
      null,
      method,
      rawBytes,
      this.now(),
      null,
      null,
      false,
      signal,
      operationDeadlineAt,
    );
    await this.bounded(this.writeLine(rawBytes), `write ${method}`, signal, operationDeadlineAt);
  }

  private async handshake(
    signal?: AbortSignal,
    startupDeadlineAtMonotonicMs?: number,
  ): Promise<void> {
    const initialize = await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 't16-b-owned-direct-stdio', version: '1.0.0' },
      },
      signal,
      startupDeadlineAtMonotonicMs,
    );
    assert(!Object.hasOwn(initialize.value, 'error'), 'MCP initialize returned a JSON-RPC error');
    const result = initialize.value.result;
    assert(isRecord(result), 'MCP initialize result is missing');
    assert(
      result.protocolVersion === MCP_PROTOCOL_VERSION,
      'MCP initialize negotiated an unexpected protocol version',
    );
    assert(
      isRecord(result.serverInfo) &&
        result.serverInfo.name === MCP_SERVER.name &&
        result.serverInfo.version === MCP_SERVER.version,
      'MCP server identity differs from the pinned source contract',
    );
    assert(
      isRecord(result.capabilities) && isRecord(result.capabilities.tools),
      'MCP initialize tools capability is missing',
    );
    await this.sendNotification(
      'notifications/initialized',
      {},
      signal,
      startupDeadlineAtMonotonicMs,
    );
    const tools = await this.request('tools/list', {}, signal, startupDeadlineAtMonotonicMs);
    assert(!Object.hasOwn(tools.value, 'error'), 'MCP tools/list returned a JSON-RPC error');
    const validated = assertSourceToolset(tools.value.result);
    this.toolNames = validated.names;
    this.outputSchemasAdvertised = validated.outputSchemasAdvertised;
  }

  private async consumeStdout(chunk: Uint8Array): Promise<void> {
    const incoming = Buffer.from(chunk);
    let offset = 0;
    while (offset < incoming.byteLength) {
      const newline = incoming.indexOf(0x0a, offset);
      if (newline < 0) {
        const tail = incoming.subarray(offset);
        const observedBytes = this.stdoutBuffer.byteLength + tail.byteLength;
        if (observedBytes > MAX_JSON_LINE_BYTES) {
          const retainedLength = Math.min(MAX_REJECTED_RAW_LINE_BYTES, observedBytes);
          const retained = Buffer.alloc(retainedLength);
          const fromBuffer = Math.min(this.stdoutBuffer.byteLength, retainedLength);
          this.stdoutBuffer.copy(retained, 0, 0, fromBuffer);
          if (fromBuffer < retainedLength)
            tail.copy(retained, fromBuffer, 0, retainedLength - fromBuffer);
          this.stdoutBuffer = Buffer.alloc(0);
          await this.recordProtocolFailureEnvelope(retained, this.now(), {
            reason: 'oversized',
            bytesObserved: observedBytes,
            complete: false,
          });
          throw new OwnedMcpProtocolError(
            'MCP stdout line exceeds the private limit before newline',
          );
        }
        this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, tail]);
        break;
      }
      const lineChunk = incoming.subarray(offset, newline + 1);
      const contentBytes = this.stdoutBuffer.byteLength + lineChunk.byteLength - 1;
      if (contentBytes > MAX_JSON_LINE_BYTES) {
        const retainedLength = Math.min(MAX_REJECTED_RAW_LINE_BYTES, contentBytes);
        const retained = Buffer.alloc(retainedLength);
        const fromBuffer = Math.min(this.stdoutBuffer.byteLength, retainedLength);
        this.stdoutBuffer.copy(retained, 0, 0, fromBuffer);
        if (fromBuffer < retainedLength)
          lineChunk
            .subarray(0, lineChunk.byteLength - 1)
            .copy(retained, fromBuffer, 0, retainedLength - fromBuffer);
        this.stdoutBuffer = Buffer.alloc(0);
        await this.recordProtocolFailureEnvelope(retained, this.now(), {
          reason: 'oversized',
          bytesObserved: contentBytes,
          complete: false,
        });
        throw new OwnedMcpProtocolError('MCP stdout line exceeds the private limit');
      }
      const lineBytes = this.stdoutBuffer.byteLength
        ? Buffer.concat([this.stdoutBuffer, lineChunk])
        : Buffer.from(lineChunk);
      this.stdoutBuffer = Buffer.alloc(0);
      const content = lineBytes.subarray(0, lineBytes.length - 1);
      if (content.toString('utf8').trim().length > 0) {
        const receivedAtMonotonicMs = this.now();
        try {
          const message = parseJsonRpcLine(content);
          await this.consumeMessage(message, lineBytes, receivedAtMonotonicMs);
        } catch (error) {
          await this.recordProtocolFailureEnvelope(lineBytes, receivedAtMonotonicMs, {
            reason:
              error instanceof Error && /unexpected response id/.test(error.message)
                ? 'unexpected-response'
                : 'malformed',
            bytesObserved: lineBytes.byteLength,
            complete: true,
          });
          throw error;
        }
      }
      offset = newline + 1;
    }
  }

  private recordRejectedRawEvidence(
    rawBytes: Uint8Array,
    receivedAtMonotonicMs: number | null,
    options: {
      readonly reason: RejectedRawEvidence['reason'];
      readonly bytesObserved: number;
      readonly complete: boolean;
    },
  ): void {
    if (this.rejectedRawEvidence.length >= MAX_REJECTED_RAW_RECORDS) {
      this.rejectedRawDroppedCount += 1;
      return;
    }
    const available = Math.max(0, MAX_REJECTED_RAW_TOTAL_BYTES - this.rejectedRawBytes);
    if (available === 0) {
      this.rejectedRawDroppedCount += 1;
      return;
    }
    const retained = Uint8Array.from(
      rawBytes.subarray(0, Math.min(rawBytes.byteLength, available)),
    );
    const complete = options.complete && retained.byteLength === options.bytesObserved;
    this.rejectedRawEvidence.push({
      reason: options.reason,
      receivedAtMonotonicMs,
      bytesObserved: options.bytesObserved,
      rawBytes: retained,
      rawSha256: sha256(retained),
      complete,
    });
    this.rejectedRawBytes += retained.byteLength;
    if (retained.byteLength < rawBytes.byteLength || !complete) this.rejectedRawDroppedCount += 1;
  }

  private async recordProtocolFailureEnvelope(
    rawBytes: Uint8Array,
    receivedAtMonotonicMs: number,
    options: {
      readonly reason: RejectedRawEvidence['reason'];
      readonly bytesObserved: number;
      readonly complete: boolean;
    },
  ): Promise<void> {
    if (!this.childIdentity) {
      if (
        this.unboundRejectedLines.length < 16 &&
        this.unboundRejectedBytes + rawBytes.byteLength <= MAX_REJECTED_RAW_TOTAL_BYTES
      ) {
        this.unboundRejectedLines.push({
          rawBytes: Uint8Array.from(rawBytes),
          receivedAtMonotonicMs,
          reason: options.reason,
          bytesObserved: options.bytesObserved,
          complete: options.complete,
        });
        this.unboundRejectedBytes += rawBytes.byteLength;
      } else {
        this.recordRejectedRawEvidence(rawBytes, receivedAtMonotonicMs, {
          reason: 'pre-identity-overflow',
          bytesObserved: options.bytesObserved,
          complete: false,
        });
      }
      return;
    }
    const completeWithinBound =
      options.complete &&
      rawBytes.byteLength === options.bytesObserved &&
      rawBytes.byteLength <= MAX_REJECTED_RAW_LINE_BYTES &&
      this.rejectedRawBytes + rawBytes.byteLength <= MAX_REJECTED_RAW_TOTAL_BYTES;
    if (!completeWithinBound) {
      this.recordRejectedRawEvidence(rawBytes, receivedAtMonotonicMs, options);
      return;
    }
    await this.makeEnvelope('protocol-failure', null, null, rawBytes, null, receivedAtMonotonicMs);
    this.rejectedRawBytes += rawBytes.byteLength;
  }

  private async drainStdoutQueue(options?: {
    readonly signal?: AbortSignal;
    readonly deadlineAtMonotonicMs?: number;
  }): Promise<void> {
    let queue = this.stdoutQueue;
    while (true) {
      await boundedCleanup(
        queue,
        Math.max(
          1,
          Math.ceil((options?.deadlineAtMonotonicMs ?? this.now() + 10_000) - this.now()),
        ),
        'Owned MCP stdout parser drain',
        options?.signal,
      );
      if (queue === this.stdoutQueue) break;
      queue = this.stdoutQueue;
    }
    if (this.stdoutBuffer.byteLength > 0) {
      const partial = this.stdoutBuffer;
      this.stdoutBuffer = Buffer.alloc(0);
      if (partial.toString('utf8').trim().length > 0) {
        await this.recordProtocolFailureEnvelope(partial, this.now(), {
          reason: 'truncated',
          bytesObserved: partial.byteLength,
          complete: true,
        });
        this.protocolFailure ??= new OwnedMcpProtocolError(
          'MCP stdout ended with an incomplete JSON-RPC line',
        );
      }
    }
  }

  private flushUnboundRejectedLines(): void {
    for (const line of this.unboundRejectedLines) {
      this.recordRejectedRawEvidence(line.rawBytes, line.receivedAtMonotonicMs, {
        reason: line.reason,
        bytesObserved: line.bytesObserved,
        complete: line.complete,
      });
    }
    this.unboundRejectedLines.length = 0;
    this.unboundRejectedBytes = 0;
  }

  private async recordLateResponse(
    message: ProtocolMessage,
    rawBytes: Uint8Array,
    receivedAtMonotonicMs: number,
    retired: RetiredRequest,
  ): Promise<void> {
    assert(isSafeId(message.id), 'MCP late response id is invalid');
    // Keep the retired request as the identity owner until raw evidence is
    // published. A failed publication is retained as spool-failure evidence,
    // and the retired entry prevents a later response from becoming unknown.
    await this.makeEnvelope(
      'response',
      message.id,
      retired.method,
      rawBytes,
      null,
      receivedAtMonotonicMs,
      retired.requestSequence,
      true,
    );
    this.retired.delete(message.id);
  }

  private async consumeMessage(
    message: ProtocolMessage,
    rawBytes: Uint8Array,
    receivedAtMonotonicMs = this.now(),
  ): Promise<void> {
    if (!Object.hasOwn(message, 'id')) {
      assert(typeof message.method === 'string', 'MCP inbound notification has no method');
      await this.refreshIdentity();
      await this.makeEnvelope(
        'inbound-notification',
        null,
        message.method,
        rawBytes,
        null,
        receivedAtMonotonicMs,
      );
      return;
    }
    assert(isSafeId(message.id), 'MCP response id is invalid');
    const pending = this.pending.get(message.id);
    if (!pending) {
      const retired = this.retired.get(message.id);
      assert(
        retired !== undefined,
        `MCP returned an unexpected response id: ${String(message.id)}`,
      );
      await this.refreshIdentity();
      await this.recordLateResponse(message, rawBytes, receivedAtMonotonicMs, retired);
      return;
    }
    try {
      await this.refreshIdentity(pending.signal ?? undefined, pending.deadlineAtMonotonicMs);
    } catch (error) {
      const retired = this.retired.get(message.id);
      if (this.pending.get(message.id) !== pending && retired !== undefined) {
        await this.recordLateResponse(message, rawBytes, receivedAtMonotonicMs, retired);
        return;
      }
      throw error;
    }
    if (this.pending.get(message.id) !== pending) {
      const retired = this.retired.get(message.id);
      assert(
        retired !== undefined,
        `MCP response request ${String(message.id)} was retired during identity refresh`,
      );
      await this.recordLateResponse(message, rawBytes, receivedAtMonotonicMs, retired);
      return;
    }
    const responseEnvelope = await this.makeEnvelope(
      'response',
      message.id,
      pending.method,
      rawBytes,
      null,
      receivedAtMonotonicMs,
      pending.requestSequence,
      false,
      undefined,
      pending.deadlineAtMonotonicMs,
    );
    if (this.pending.get(message.id) !== pending) {
      (responseEnvelope as { lateResponse: boolean }).lateResponse = true;
      return;
    }
    this.pending.delete(message.id);
    pending.resolve({ response: responseEnvelope, value: message });
  }

  private failProtocol(error: unknown, reason: RetiredRequest['reason'] = 'closed'): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.protocolFailure ??= failure;
    if (this.state !== 'idle' && this.state !== 'closed') this.state = 'closing';
    for (const pending of this.pending.values()) {
      this.retired.set(pending.id, {
        method: pending.method,
        requestSequence: pending.requestSequence,
        reason,
      });
      pending.reject(failure);
    }
    this.pending.clear();
  }

  async callTool(
    name: string,
    args: unknown,
    options: { readonly signal?: AbortSignal; readonly deadlineMs?: number } = {},
  ): Promise<{
    readonly response: RequestResponse;
    readonly result: unknown;
    readonly isError: boolean;
    readonly error: JsonObject | null;
  }> {
    assert(this.state === 'ready', `MCP tool call before handshake: ${name}`);
    assert(this.toolNames.includes(name), `MCP tool is not in the sealed runtime toolset: ${name}`);
    validateArguments(name, args);
    const response = await this.request(
      'tools/call',
      { name, arguments: args },
      options.signal,
      this.requestDeadlineAt(options.deadlineMs),
    );
    const hasError = Object.hasOwn(response.value, 'error');
    const result = hasError ? null : response.value.result;
    return {
      response,
      result: isRecord(result) ? result : null,
      isError: hasError || (isRecord(result) && result.isError === true),
      error: hasError && isRecord(response.value.error) ? response.value.error : null,
    };
  }

  async close(options: OwnedMcpCloseOptions = {}): Promise<CloseReceipt> {
    if (this.closePromise) return this.closePromise;
    if (this.state === 'idle') {
      const receipt: CloseReceipt = {
        status: 'not-started',
        exitCode: null,
        signal: null,
        ownedProcessGroupAbsent: true,
        ownershipLedgerPath: null,
        socketBefore: [],
        socketAfter: [],
        socketResourcesAbsent: false,
        cleanupError: null,
        protocolFailure: this.protocolFailure?.message ?? null,
      };
      this.cleanup = receipt;
      this.state = 'closed';
      return receipt;
    }
    this.state = 'closing';
    this.closePromise = this.closeInternal(options);
    return this.closePromise;
  }

  private async closeInternal(options: OwnedMcpCloseOptions): Promise<CloseReceipt> {
    const recoveryDeadlineAtMonotonicMs =
      options.recoveryDeadlineAtMonotonicMs ??
      options.deadlineAtMonotonicMs ??
      this.deadlineAtMonotonicMs ??
      this.now();
    assert(
      Number.isSafeInteger(recoveryDeadlineAtMonotonicMs) && recoveryDeadlineAtMonotonicMs > 0,
      'MCP cleanup recovery deadline is invalid',
    );
    this.lateRecoveryDeadlineAtMonotonicMs = recoveryDeadlineAtMonotonicMs;
    if (options.ownerSignal?.aborted) {
      this.protocolFailure ??= new OwnedMcpProtocolError(
        'MCP owner signal aborted; cleanup is recovery-only',
      );
    }
    const boundedRecovery = <T>(operation: Promise<T>, label: string): Promise<T> => {
      const remainingMs = recoveryDeadlineAtMonotonicMs - this.now();
      if (remainingMs <= 0) {
        void operation.catch(() => undefined);
        return Promise.reject(abortError(`${label} deadline`));
      }
      return boundedCleanup(operation, Math.max(1, Math.ceil(remainingMs)), label, options.signal);
    };
    const child = this.child;
    let cleanupError: string | null = null;
    if (!this.ownedGroup && this.ownershipPromise) {
      try {
        const group = await boundedRecovery(
          this.ownershipPromise,
          'Owned MCP late process ownership',
        );
        this.ownedGroup ??= group;
        this.ownershipAdopted = true;
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : String(error);
      }
    }
    this.adoptLateOwnedGroupIfAvailable();
    if (!child || !this.ownedGroup) {
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGTERM');
          if (this.childClosePromise)
            await boundedRecovery(this.childClosePromise, 'Owned MCP untracked child close');
        } catch (error) {
          cleanupError ??= error instanceof Error ? error.message : String(error);
        }
      }
      try {
        await this.drainStdoutQueue({
          signal: options.signal,
          deadlineAtMonotonicMs: recoveryDeadlineAtMonotonicMs,
        });
      } catch (error) {
        cleanupError ??= error instanceof Error ? error.message : String(error);
      }
      try {
        await boundedRecovery(
          this.closeRuntimeRawSpool({
            signal: options.signal,
            deadlineAtMonotonicMs: recoveryDeadlineAtMonotonicMs,
          }),
          'Owned MCP runtime raw spool close',
        );
      } catch (error) {
        cleanupError ??= error instanceof Error ? error.message : String(error);
      }
      try {
        this.flushUnboundRejectedLines();
      } catch (error) {
        cleanupError ??= error instanceof Error ? error.message : String(error);
      }
      const receipt: CloseReceipt = {
        status: 'failed',
        exitCode: child?.exitCode ?? null,
        signal: child?.signalCode ?? null,
        ownedProcessGroupAbsent: false,
        ownershipLedgerPath: this.ownedGroup ? this.ledgerPath : null,
        socketBefore: [],
        socketAfter: [],
        socketResourcesAbsent: false,
        cleanupError: cleanupError ?? 'Owned process group was not established',
        protocolFailure: this.protocolFailure?.message ?? null,
      };
      this.cleanup = receipt;
      this.finishedAtMonotonicMs = this.now();
      this.terminalCleanupFinished = true;
      this.state = 'closed';
      return receipt;
    }
    const ownedGroup = this.ownedGroup;
    for (const pending of this.pending.values()) {
      this.retired.set(pending.id, {
        method: pending.method,
        requestSequence: pending.requestSequence,
        reason: 'closed',
      });
      pending.reject(new OwnedMcpAbortError(pending.method));
    }
    this.pending.clear();
    let socketBefore: readonly SocketObservation[] = [];
    let socketAfter: readonly SocketObservation[] = [];
    let socketAfterObserved = false;
    let fullPidCensusAvailable = false;
    let ownedPids: number[] = [];
    try {
      const census = await boundedRecovery(ownedGroup.capture(true), 'Owned MCP process census');
      ownedPids = [...requireBoundOwnedProcessCensus(census, ownedGroup, this.childIdentity)];
      fullPidCensusAvailable = ownedPids.length > 0;
    } catch (error) {
      cleanupError ??= error instanceof Error ? error.message : String(error);
    }
    if (fullPidCensusAvailable) {
      try {
        socketBefore = await boundedRecovery(
          this.socketInspector(ownedPids),
          'Owned MCP pre-cleanup socket inspection',
        );
      } catch (error) {
        cleanupError ??= error instanceof Error ? error.message : String(error);
      }
    }
    // The JVM-backed MCP child may exit immediately after EOF. Capture and
    // inspect its descriptor-bound owned PIDs before ending stdin so a fast
    // clean exit cannot erase the only identity usable for the socket census.
    if (!child.stdin.destroyed) {
      child.stdin.end();
      child.stdin.destroy();
    }
    try {
      await boundedRecovery(ownedGroup.stop(), 'Owned MCP process cleanup');
    } catch (error) {
      cleanupError ??= error instanceof Error ? error.message : String(error);
    }
    if (child.exitCode === null && this.childClosePromise) {
      try {
        await boundedRecovery(this.childClosePromise, 'Owned MCP child close');
      } catch (error) {
        cleanupError ??= error instanceof Error ? error.message : String(error);
      }
    }
    try {
      await this.drainStdoutQueue({
        signal: options.signal,
        deadlineAtMonotonicMs: recoveryDeadlineAtMonotonicMs,
      });
    } catch (error) {
      cleanupError ??= error instanceof Error ? error.message : String(error);
    }
    try {
      await boundedRecovery(
        this.closeRuntimeRawSpool({
          signal: options.signal,
          deadlineAtMonotonicMs: recoveryDeadlineAtMonotonicMs,
        }),
        'Owned MCP runtime raw spool close',
      );
    } catch (error) {
      cleanupError ??= error instanceof Error ? error.message : String(error);
    }
    let ownedProcessGroupAbsent = false;
    try {
      ownedProcessGroupAbsent =
        (await boundedRecovery(ownedGroup.capture(false), 'Owned MCP final census')).length === 0;
    } catch (error) {
      cleanupError ??= error instanceof Error ? error.message : String(error);
    }
    if (!ownedProcessGroupAbsent) cleanupError ??= 'Owned MCP process group remains after cleanup';
    if (fullPidCensusAvailable) {
      try {
        socketAfter = await boundedRecovery(
          this.socketInspector(ownedPids),
          'Owned MCP post-cleanup socket inspection',
        );
        socketAfterObserved = true;
        if (socketAfter.length > 0) cleanupError ??= 'Owned socket resources remain after cleanup';
      } catch (error) {
        cleanupError ??= error instanceof Error ? error.message : String(error);
      }
    }
    const status: CloseReceipt['status'] =
      cleanupError || this.protocolFailure ? 'failed' : child.exitCode === 0 ? 'cleaned' : 'exited';
    const receipt: CloseReceipt = {
      status,
      exitCode: child.exitCode,
      signal: child.signalCode,
      ownedProcessGroupAbsent,
      ownershipLedgerPath: this.ledgerPath,
      socketBefore: [...socketBefore],
      socketAfter: [...socketAfter],
      socketResourcesAbsent: socketAfterObserved && socketAfter.length === 0,
      cleanupError,
      protocolFailure: this.protocolFailure?.message ?? null,
    };
    this.cleanup = receipt;
    this.finishedAtMonotonicMs = this.now();
    this.terminalCleanupFinished = true;
    this.state = 'closed';
    return receipt;
  }

  receipt(): SessionReceipt {
    return {
      schema: 't16-b-owned-direct-stdio-session-v1',
      sessionId: this.sessionId,
      state: this.state,
      argv: [...this.argv],
      cwd: this.cwd,
      pid: this.child?.pid ?? null,
      pgid: this.ownedGroup?.pgid ?? null,
      startedAtMonotonicMs: this.startedAtMonotonicMs,
      finishedAtMonotonicMs: this.finishedAtMonotonicMs,
      toolNames: [...this.toolNames],
      outputSchemasAdvertised: [...this.outputSchemasAdvertised],
      envelopes: this.envelopes.map(cloneEnvelope),
      runtimeRawEnvelopeBytes: this.runtimeRawEnvelopeBytes,
      runtimeRawSpoolPath: this.runtimeRawSpoolPath,
      runtimeRawSpoolBytes: this.runtimeRawSpoolBytes,
      runtimeRawSpoolSha256: this.runtimeRawSpoolPath
        ? this.runtimeRawSpoolDigest.copy().digest('hex')
        : null,
      rejectedRawEvidence: this.rejectedRawEvidence.map((evidence) => ({
        ...evidence,
        rawBytes: Uint8Array.from(evidence.rawBytes),
      })),
      rejectedRawDroppedCount: this.rejectedRawDroppedCount,
      stderrBytes: this.stderrBuffer.byteLength,
      stderrSha256: this.stderrBuffer.byteLength ? sha256(this.stderrBuffer) : null,
      protocolFailure: this.protocolFailure?.message ?? null,
      retiredRequestCount: this.retired.size,
      lateResponseCount: this.envelopes.filter((envelope) => envelope.lateResponse).length,
      cleanup: this.cleanup,
    };
  }

  async writePrivateTranscript(
    filePath: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly path: string; readonly bytes: number; readonly sha256: string }> {
    await this.bounded(
      requirePrivateArtifactRoot(this.artifactRoot),
      'transcript artifact root',
      options.signal,
    );
    const target = path.resolve(filePath);
    assert(isWithin(this.artifactRoot, target), 'MCP transcript must be below the artifact root');
    assert(
      this.envelopes.length <= MAX_TRANSCRIPT_ENVELOPE_COUNT,
      'MCP transcript envelope count exceeds the private limit',
    );
    const file = await this.bounded(open(target, 'wx', 0o600), 'transcript open', options.signal);
    const digest = createHash('sha256');
    let bytes = 0;
    try {
      for (const envelope of this.envelopes) {
        const line = Buffer.from(
          `${JSON.stringify({
            sessionId: envelope.sessionId,
            sequence: envelope.sequence,
            kind: envelope.kind,
            id: envelope.id,
            method: envelope.method,
            requestSequence: envelope.requestSequence,
            rawByteLength: envelope.rawByteLength,
            rawSpool: envelope.rawSpool,
            rawBase64: this.readOwnedProtocolEnvelopeRawBytes(envelope).toString('base64'),
            rawSha256: envelope.rawSha256,
            sentAtMonotonicMs: envelope.sentAtMonotonicMs,
            receivedAtMonotonicMs: envelope.receivedAtMonotonicMs,
            childIdentity: envelope.childIdentity,
            lateResponse: envelope.lateResponse,
          })}\n`,
          'utf8',
        );
        bytes += line.byteLength;
        assert(bytes <= MAX_TRANSCRIPT_BYTES, 'MCP transcript exceeds the private byte limit');
        digest.update(line);
        await this.bounded(file.write(line), 'transcript write', options.signal);
      }
      await this.bounded(file.sync(), 'transcript sync', options.signal);
    } catch (error) {
      await file.close().catch(() => undefined);
      await unlink(target).catch(() => undefined);
      throw error;
    }
    try {
      await file.close();
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    }
    await this.bounded(chmod(target, 0o600), 'transcript chmod', options.signal);
    const info = await this.bounded(lstat(target), 'transcript stat', options.signal);
    assert(
      info.isFile() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o600,
      'MCP transcript is not a private regular file',
    );
    return { path: target, bytes, sha256: digest.digest('hex') };
  }
}

import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import {
  MAESTRO_261_TOOL_NAMES,
  MCP_SERVER,
  type CloseReceipt,
  type OwnedMcpCloseOptions,
  type OwnedProcessIdentity,
  type ProtocolEnvelope,
  type RequestResponse,
  type SessionReceipt,
} from './owned-maestro-mcp-stdio';
import {
  executeOwnedExploration,
  requireSelectionBundle,
  sha256,
  type BoundedAction,
  type ConnectorActionResult,
  type ConnectorIdentity,
  type ConnectorShutdownReceipt,
  type ConnectorStartReceipt,
  type ConnectorTargetSelection,
  type OriginalEvidence,
  type OwnedEvidenceSource,
  type ScreenObservation,
  type SelectionExpectation,
  type SelectionEvidenceBundle,
  type T16BConnector,
  type T16BExecutionInput,
  type T16BExecutionResult,
} from './t16b-owned-exploration-controller';

type JsonObject = Record<string, unknown>;

type SessionCall = {
  readonly response: RequestResponse;
  readonly result: unknown;
  readonly isError: boolean;
  readonly error: JsonObject | null;
};

/**
 * The connector boundary requires the complete ten-row selection receipt. A
 * four-row projection is deliberately not accepted by the exported
 * constructor because it cannot prove roles, fixture, reset, API, SQL or
 * ownership provenance.
 */
export type OwnedMaestroSelectionMetadata = SelectionEvidenceBundle;

type ObservedSelectionBinding = {
  readonly target: {
    readonly evidence: OwnedMaestroSelectionMetadata['target'];
    readonly sourceIdentity: NativeEvidenceIdentity;
  };
  readonly build: {
    readonly evidence: OwnedMaestroSelectionMetadata['build'];
    readonly sourceIdentity: NativeEvidenceIdentity;
  };
  readonly tool: {
    readonly evidence: OwnedMaestroSelectionMetadata['tool'];
    readonly sourceIdentity: NativeEvidenceIdentity;
  };
  readonly locale: {
    readonly evidence: OwnedMaestroSelectionMetadata['locale'];
    readonly sourceIdentity: NativeEvidenceIdentity;
  };
  readonly full: SelectionEvidenceBundle;
};

type BoundMcpSessionIdentity = {
  readonly sessionId: string;
  readonly sessionReceiptSha256: string;
  readonly pid: number;
  readonly pgid: number;
  readonly startedAtMonotonicMs: number;
  readonly processStarted: string;
  readonly commandHash: string;
  readonly argvSha256: string;
  readonly cwdSha256: string;
};

export type OwnedMaestroMcpSession = {
  readonly artifactRoot: string;
  readonly sessionId: string;
  /** Reads one owned envelope, including a bounded raw-spool segment when rawBytes is empty. */
  readOwnedProtocolEnvelopeRawBytes(envelope: ProtocolEnvelope): Buffer;
  start(options?: {
    readonly signal?: AbortSignal;
    readonly deadlineMs?: number;
  }): Promise<unknown>;
  callTool(
    name: string,
    args: unknown,
    options?: { readonly signal?: AbortSignal; readonly deadlineMs?: number },
  ): Promise<{
    readonly response: RequestResponse;
    readonly result: unknown;
    readonly isError: boolean;
    readonly error: JsonObject | null;
  }>;
  close(options?: OwnedMcpCloseOptions): Promise<CloseReceipt>;
  receipt(): SessionReceipt;
};

export type MaestroTextResolver = (textRef: string, signal: AbortSignal) => Promise<string>;

export type OwnedMaestroT16BInput = Omit<T16BExecutionInput, 'connector'> & {
  readonly session: OwnedMaestroMcpSession;
  readonly resolveTextRef?: MaestroTextResolver;
  readonly protocolDeadlineMs?: number;
};

const MAX_PRIVATE_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const FORBIDDEN_VALUE =
  /(password|passcode|access[_-]?token|refresh[_-]?token|authorization|cookie|secret|private[_-]?key|api[_-]?key)/i;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeId(value: unknown, label: string): string {
  assert(typeof value === 'string' && SAFE_ID.test(value), `${label} is not a safe id`);
  return value;
}

function safeSegment(value: string, label: string): string {
  assert(SAFE_SEGMENT.test(value), `${label} is not a safe path segment`);
  return value;
}

function requireBytes(value: Uint8Array, label: string): Buffer {
  assert(value.byteLength > 0 && value.byteLength <= MAX_PRIVATE_BYTES, `${label} is unbounded`);
  return Buffer.from(value);
}

function requireTimestamp(value: number | null, label: string): number {
  assert(value !== null && Number.isSafeInteger(value) && value >= 0, `${label} is invalid`);
  return value;
}

function monotonicNowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

async function requirePrivateRoot(root: string): Promise<void> {
  const info = await lstat(root);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'MCP evidence root is not a directory');
  assert((info.mode & 0o777) === 0o700, 'MCP evidence root must be mode 0700');
  if (typeof process.getuid === 'function')
    assert(info.uid === process.getuid(), 'MCP evidence root owner differs');
  assert((await realpath(root)) === root, 'MCP evidence root is not canonical');
}

function relativeEvidencePath(attemptId: string, label: string): string {
  return path.join('mcp-t16b', safeSegment(attemptId, 'attemptId'), label + '.private.bin');
}

async function requireOwnedDirectory(directory: string, label: string): Promise<void> {
  const info = await lstat(directory);
  assert(info.isDirectory() && !info.isSymbolicLink(), label + ' is not an owned directory');
  assert((info.mode & 0o777) === 0o700, label + ' must be mode 0700');
  if (typeof process.getuid === 'function')
    assert(info.uid === process.getuid(), label + ' owner differs');
  assert((await realpath(directory)) === directory, label + ' is not canonical');
}

async function createOrValidateOwnedDirectory(directory: string, label: string): Promise<void> {
  try {
    await requireOwnedDirectory(directory, label);
    return;
  } catch (error) {
    if (!(error instanceof Error && /ENOENT/.test(error.message))) throw error;
  }
  await mkdir(directory, { mode: 0o700 });
  await requireOwnedDirectory(directory, label);
}

async function prepareEvidenceParent(root: string, relativePath: string): Promise<void> {
  const segments = relativePath.split(path.sep);
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, safeSegment(segment, 'evidence directory'));
    await createOrValidateOwnedDirectory(current, 'MCP evidence directory ' + segment);
  }
}

async function writeProtectedEvidence(
  artifactRoot: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<OwnedEvidenceSource> {
  const captured = requireBytes(bytes, 'MCP protected evidence');
  await requirePrivateRoot(artifactRoot);
  const root = path.resolve(artifactRoot);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  assert(
    relative === relativePath && !path.isAbsolute(relative) && !relative.startsWith('..'),
    'MCP evidence path escaped root',
  );
  await prepareEvidenceParent(root, relativePath);
  const noFollow = fsConstants.O_NOFOLLOW;
  assert(typeof noFollow === 'number', 'MCP evidence requires O_NOFOLLOW');
  const file = await open(
    target,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
    0o600,
  );
  try {
    let offset = 0;
    while (offset < captured.byteLength) {
      const result = await file.write(captured, offset, captured.byteLength - offset, null);
      assert(result.bytesWritten > 0, 'MCP evidence write made no progress');
      offset += result.bytesWritten;
    }
    await file.sync();
    const observation = readNativeEvidenceObservation(root, relativePath, true);
    assert(Buffer.compare(observation.bytes, captured) === 0, 'MCP evidence readback changed');
    assert(observation.identity.nlink === 1, 'MCP evidence link count changed');
    return {
      artifactRoot: root,
      path: relativePath,
      sha256: sha256(observation.bytes),
      bytes: observation.bytes.byteLength,
      uid: observation.identity.uid,
      mode: '0600',
      nlink: 1,
      regular: true,
      symlink: false,
    };
  } finally {
    await file.close();
  }
}

function sameOwnedProcessIdentity(
  left: OwnedProcessIdentity,
  right: OwnedProcessIdentity,
): boolean {
  return (
    left.pid === right.pid &&
    left.pgid === right.pgid &&
    left.started === right.started &&
    left.commandHash === right.commandHash
  );
}

function requireOwnedProcessIdentity(
  value: OwnedProcessIdentity,
  label: string,
): OwnedProcessIdentity {
  assert(Number.isSafeInteger(value.pid) && value.pid > 0, `${label} pid is invalid`);
  assert(Number.isSafeInteger(value.pgid) && value.pgid > 0, `${label} pgid is invalid`);
  assert(
    typeof value.started === 'string' && value.started.length > 0,
    `${label} start is invalid`,
  );
  assert(SHA256.test(value.commandHash), `${label} command identity is invalid`);
  return { ...value };
}

function requirePositiveInteger(value: number | null, label: string): number {
  if (value === null || !Number.isSafeInteger(value) || value <= 0) throw new Error(label);
  return value;
}

function requireNonNegativeInteger(value: number | null, label: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) throw new Error(label);
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  assert(encoded !== undefined, 'MCP protocol value is not JSON serializable');
  return encoded;
}

function parseJsonObject(raw: Buffer, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8').trim());
  } catch {
    throw new Error(`${label} raw bytes are not JSON`);
  }
  assert(isRecord(parsed) && parsed.jsonrpc === '2.0', `${label} raw JSON-RPC envelope is invalid`);
  return parsed;
}

function sessionReceiptIdentityHash(
  receipt: SessionReceipt,
  processIdentity: OwnedProcessIdentity,
): string {
  const firstEnvelope = receipt.envelopes[0];
  return sha256(
    JSON.stringify({
      schema: receipt.schema,
      sessionId: receipt.sessionId,
      pid: receipt.pid,
      pgid: receipt.pgid,
      startedAtMonotonicMs: receipt.startedAtMonotonicMs,
      argv: receipt.argv,
      cwd: receipt.cwd,
      childIdentity: processIdentity,
      firstEnvelope: firstEnvelope
        ? {
            sequence: firstEnvelope.sequence,
            kind: firstEnvelope.kind,
            id: firstEnvelope.id,
            method: firstEnvelope.method,
            requestSequence: firstEnvelope.requestSequence,
            rawByteLength: firstEnvelope.rawByteLength,
            rawSha256: firstEnvelope.rawSha256,
          }
        : null,
    }),
  );
}

function requireSessionReceiptContinuity(
  receipt: SessionReceipt,
  expectedSessionId: string,
  readRaw: (envelope: ProtocolEnvelope, label: string) => Buffer,
  previous: BoundMcpSessionIdentity | null = null,
): BoundMcpSessionIdentity {
  assert(
    receipt.schema === 't16-b-owned-direct-stdio-session-v1',
    'MCP session receipt schema is invalid',
  );
  assert(receipt.sessionId === expectedSessionId, 'MCP session receipt id differs');
  const pid = requirePositiveInteger(receipt.pid, 'MCP session receipt pid is unavailable');
  const pgid = requirePositiveInteger(receipt.pgid, 'MCP session receipt pgid is unavailable');
  const startedAtMonotonicMs = requireNonNegativeInteger(
    receipt.startedAtMonotonicMs,
    'MCP session receipt start time is unavailable',
  );
  assert(
    receipt.argv.length > 0 &&
      receipt.argv.every((value) => typeof value === 'string' && value.length > 0),
    'MCP session receipt argv is unavailable',
  );
  assert(path.isAbsolute(receipt.cwd), 'MCP session receipt cwd is unavailable');
  const firstEnvelope = receipt.envelopes[0];
  assert(firstEnvelope !== undefined, 'MCP session receipt has no envelope identity');
  const processIdentity = requireOwnedProcessIdentity(firstEnvelope.childIdentity, 'MCP child');
  assert(processIdentity.pid === pid, 'MCP child pid differs from session receipt');
  assert(processIdentity.pgid === pgid, 'MCP child pgid differs from session receipt');
  if (previous)
    assert(
      sameOwnedProcessIdentity(processIdentity, {
        pid: previous.pid,
        pgid: previous.pgid,
        started: previous.processStarted,
        commandHash: previous.commandHash,
      }),
      'MCP child identity changed during session',
    );
  const receiptSha256 = sessionReceiptIdentityHash(receipt, processIdentity);
  const binding: BoundMcpSessionIdentity = previous ?? {
    sessionId: expectedSessionId,
    sessionReceiptSha256: receiptSha256,
    pid,
    pgid,
    startedAtMonotonicMs,
    processStarted: processIdentity.started,
    commandHash: processIdentity.commandHash,
    argvSha256: sha256(JSON.stringify(receipt.argv)),
    cwdSha256: sha256(receipt.cwd),
  };
  assert(
    binding.sessionReceiptSha256 === receiptSha256,
    'MCP session receipt identity hash changed',
  );
  assert(
    binding.startedAtMonotonicMs === startedAtMonotonicMs &&
      binding.argvSha256 === sha256(JSON.stringify(receipt.argv)) &&
      binding.cwdSha256 === sha256(receipt.cwd),
    'MCP session receipt identity changed during session',
  );
  const retainedRawBytes = receipt.envelopes.reduce(
    (total, envelope) => total + envelope.rawBytes.byteLength,
    0,
  );
  assert(
    receipt.runtimeRawEnvelopeBytes === retainedRawBytes,
    'MCP retained raw envelope byte ledger differs',
  );
  const spoolReferences = receipt.envelopes
    .map((envelope) => envelope.rawSpool)
    .filter(
      (reference): reference is NonNullable<ProtocolEnvelope['rawSpool']> => reference !== null,
    );
  if (spoolReferences.length > 0) {
    const spoolPath = spoolReferences[0].path;
    assert(SAFE_SEGMENT.test(spoolPath), 'MCP runtime spool path is invalid');
    assert(
      receipt.runtimeRawSpoolPath === spoolPath &&
        receipt.runtimeRawSpoolBytes ===
          spoolReferences.reduce((total, reference) => total + reference.bytes, 0) &&
        receipt.runtimeRawSpoolSha256 !== null &&
        SHA256.test(receipt.runtimeRawSpoolSha256),
      'MCP runtime spool receipt ledger differs',
    );
    assert(
      spoolReferences.every((reference) => reference.path === spoolPath),
      'MCP runtime spool path differs between envelopes',
    );
  } else {
    assert(
      receipt.runtimeRawSpoolPath === null &&
        receipt.runtimeRawSpoolBytes === 0 &&
        receipt.runtimeRawSpoolSha256 === null,
      'MCP runtime spool receipt is present without envelope references',
    );
  }
  for (const envelope of receipt.envelopes) {
    assert(envelope.sessionId === expectedSessionId, 'MCP envelope session id differs');
    assert(
      sameOwnedProcessIdentity(envelope.childIdentity, processIdentity),
      'MCP envelope child identity differs',
    );
    const raw = readRaw(envelope, 'MCP envelope');
    assert(raw.byteLength === envelope.rawByteLength, 'MCP envelope raw length differs');
    assert(envelope.rawSha256 === sha256(raw), 'MCP envelope raw hash differs');
  }
  return binding;
}

function rawEnvelope(
  envelope: ProtocolEnvelope,
  label: string,
  readRaw: (envelope: ProtocolEnvelope, label: string) => Buffer,
  sessionBinding?: BoundMcpSessionIdentity,
): Buffer {
  const raw = readRaw(envelope, label);
  assert(raw.byteLength === envelope.rawByteLength, `${label} raw length differs`);
  const parsed = parseJsonObject(raw, label);
  if (envelope.id !== null) assert(parsed.id === envelope.id, `${label} raw id differs`);
  assert(envelope.rawSha256 === sha256(raw), `${label} raw hash differs`);
  if (sessionBinding) {
    assert(envelope.sessionId === sessionBinding.sessionId, `${label} session id differs`);
    assert(
      sameOwnedProcessIdentity(envelope.childIdentity, {
        pid: sessionBinding.pid,
        pgid: sessionBinding.pgid,
        started: sessionBinding.processStarted,
        commandHash: sessionBinding.commandHash,
      }),
      `${label} child identity differs`,
    );
  }
  return raw;
}

function findRequestEnvelope(
  session: SessionReceipt,
  response: ProtocolEnvelope,
  label: string,
  expectedMethod: string,
): ProtocolEnvelope {
  assert(response.kind === 'response', `${label} response envelope kind is invalid`);
  assert(response.method === expectedMethod, `${label} response method is not ${expectedMethod}`);
  assert(response.requestSequence !== null, `${label} response is not bound to a request`);
  const request = session.envelopes.find(
    (envelope) => envelope.kind === 'request' && envelope.sequence === response.requestSequence,
  );
  assert(request !== undefined, `${label} request envelope is missing`);
  assert(request.kind === 'request', `${label} request envelope kind is invalid`);
  assert(request.method === expectedMethod, `${label} request method is not ${expectedMethod}`);
  assert(request.requestSequence === null, `${label} request is unexpectedly response-bound`);
  assert(response.id === request.id, `${label} response id is not bound to request id`);
  return request;
}

function toolsListRequestAndResponseBytes(
  session: SessionReceipt,
  responseEnvelope: ProtocolEnvelope,
  sessionBinding: BoundMcpSessionIdentity,
  readRaw: (envelope: ProtocolEnvelope, label: string) => Buffer,
): {
  request: Buffer;
  response: Buffer;
  requestEnvelope: ProtocolEnvelope;
  responseEnvelope: ProtocolEnvelope;
} {
  const response = rawEnvelope(
    responseEnvelope,
    'MCP tools/list response',
    readRaw,
    sessionBinding,
  );
  const requestEnvelope = findRequestEnvelope(
    session,
    responseEnvelope,
    'MCP tools/list',
    'tools/list',
  );
  const request = rawEnvelope(requestEnvelope, 'MCP tools/list request', readRaw, sessionBinding);
  const parsedRequest = parseJsonObject(request, 'MCP tools/list request');
  assert(parsedRequest.method === 'tools/list', 'MCP tools/list raw request method differs');
  assert(isRecord(parsedRequest.params), 'MCP tools/list raw request params are unavailable');
  assert(
    stableJson(parsedRequest.params) === stableJson({}),
    'MCP tools/list raw request arguments differ',
  );
  const parsedResponse = parseJsonObject(response, 'MCP tools/list response');
  assert(parsedResponse.id === responseEnvelope.id, 'MCP tools/list response id differs');
  if (Object.hasOwn(parsedResponse, 'method'))
    assert(parsedResponse.method === 'tools/list', 'MCP tools/list raw response method differs');
  const hasResult = Object.hasOwn(parsedResponse, 'result');
  const hasError = Object.hasOwn(parsedResponse, 'error');
  assert(hasResult && !hasError, 'MCP tools/list raw response is not a successful result');
  return { request, response, requestEnvelope, responseEnvelope };
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function mcpContent(result: unknown, label: string): JsonObject {
  assert(isRecord(result), `${label} result is unavailable`);
  assert(
    isUnknownArray(result.content) && result.content.length > 0,
    `${label} content is unavailable`,
  );
  const first: unknown = result.content[0];
  assert(isRecord(first) && typeof first.type === 'string', `${label} content item is malformed`);
  return first;
}

function textContent(result: unknown, label: string): JsonObject {
  const content = mcpContent(result, label);
  assert(
    content.type === 'text' && typeof content.text === 'string',
    `${label} text content is unavailable`,
  );
  try {
    const parsed: unknown = JSON.parse(content.text);
    assert(isRecord(parsed), `${label} text payload is not an object`);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('text payload is not an object'))
      throw error;
    throw new Error(`${label} text payload is not JSON`);
  }
}

function requireCompactHierarchy(result: unknown): JsonObject {
  const payload = textContent(result, 'MCP inspect_screen');
  assert(Object.hasOwn(payload, 'ui_schema'), 'MCP inspect_screen ui_schema is unavailable');
  assert(Object.hasOwn(payload, 'elements'), 'MCP inspect_screen elements are unavailable');
  return payload;
}

function requireImage(result: unknown): { bytes: Buffer; mimeType: string } {
  const content = mcpContent(result, 'MCP take_screenshot');
  assert(content.type === 'image', 'MCP take_screenshot did not return ImageContent');
  assert(
    typeof content.data === 'string' && content.data.length > 0,
    'MCP screenshot data is unavailable',
  );
  assert(
    typeof content.mimeType === 'string' && content.mimeType === 'image/jpeg',
    'MCP screenshot mime type is unsupported',
  );
  const bytes = Buffer.from(content.data, 'base64');
  assert(
    bytes.byteLength > 0 && bytes.toString('base64') === content.data,
    'MCP screenshot base64 is malformed',
  );
  return { bytes, mimeType: content.mimeType };
}

function outputTools(raw: Buffer): readonly string[] {
  const parsed = JSON.parse(raw.toString('utf8').trim()) as JsonObject;
  assert(
    isRecord(parsed.result) && Array.isArray(parsed.result.tools),
    'MCP tools/list raw result is unavailable',
  );
  const names = parsed.result.tools.map((tool: unknown, index: number) => {
    assert(
      isRecord(tool) && typeof tool.name === 'string',
      `MCP tools/list tool ${index} is malformed`,
    );
    return tool.name;
  });
  assert(
    JSON.stringify(names) === JSON.stringify(MAESTRO_261_TOOL_NAMES),
    'MCP runtime tool order differs from pinned 2.6.1 source',
  );
  return names;
}

function assertToolset(receipt: SessionReceipt): void {
  assert(
    JSON.stringify(receipt.toolNames) === JSON.stringify(MAESTRO_261_TOOL_NAMES),
    'MCP receipt toolset differs from pinned source',
  );
  assert(
    receipt.outputSchemasAdvertised.length === MAESTRO_261_TOOL_NAMES.length,
    'MCP output-schema ledger is incomplete',
  );
}

function noSecrets(value: string, label: string): void {
  assert(!FORBIDDEN_VALUE.test(value), `${label} contains a secret-like value`);
}

function selectorFragment(
  selector: { readonly id?: string; readonly text?: string },
  indent = '    ',
): string {
  const keys = Object.keys(selector);
  assert(
    keys.length === 1 && (keys[0] === 'id' || keys[0] === 'text'),
    'Maestro selector must have exactly one stable field',
  );
  const key: 'id' | 'text' = keys[0];
  const value = selector[key];
  assert(
    typeof value === 'string' && value.length > 0 && value.length <= 512,
    'Maestro selector value is invalid',
  );
  noSecrets(value, 'Maestro selector');
  return `${indent}${key}: ${JSON.stringify(value)}\n`;
}

function serializeAction(action: BoundedAction, text: string | undefined): string {
  const actionRecord = action as unknown as JsonObject;
  assert(
    !Object.hasOwn(actionRecord, 'yaml') && !Object.hasOwn(actionRecord, 'actions'),
    'Maestro action cannot be a nested plan',
  );
  const command = action.command;
  if (command === 'tapOn' || command === 'assertVisible' || command === 'assertNotVisible') {
    assert(action.selector !== undefined, `${command} requires a selector`);
    return `- ${command}:\n${selectorFragment(action.selector)}`;
  }
  if (command === 'scrollUntilVisible') {
    assert(
      action.selector !== undefined && action.direction !== undefined,
      'scrollUntilVisible requires selector and direction',
    );
    return `- scrollUntilVisible:\n    element:\n${selectorFragment(action.selector, '      ')}    direction: ${action.direction}\n    timeout: 20000\n    centerElement: true\n`;
  }
  if (command === 'inputText') {
    assert(
      typeof action.textRef === 'string' && text !== undefined,
      'inputText requires a protected text resolver',
    );
    assert(
      text.length > 0 && text.length <= 2048 && !/[\u0000\r\n]/.test(text),
      'Resolved input text is invalid',
    );
    noSecrets(text, 'Resolved input text');
    return `- inputText: ${JSON.stringify(text)}\n`;
  }
  if (command === 'pressKey') {
    assert(typeof action.key === 'string' && action.key.length > 0, 'pressKey requires a key');
    noSecrets(action.key, 'Maestro key');
    return `- pressKey: ${JSON.stringify(action.key)}\n`;
  }
  if (command === 'back') return '- back\n';
  if (command === 'waitForAnimationToEnd') {
    const timeout = Math.max(1, action.waitMs ?? 1000);
    return `- waitForAnimationToEnd:\n    timeout: ${timeout}\n`;
  }
  throw new Error(`Maestro action command is unsupported: ${command}`);
}

function requestAndResponseBytes(
  session: SessionReceipt,
  call: SessionCall,
  label: string,
  sessionBinding: BoundMcpSessionIdentity,
  readRaw: (envelope: ProtocolEnvelope, label: string) => Buffer,
  expectedTool: string,
  expectedArguments: JsonObject,
): {
  request: Buffer;
  response: Buffer;
  requestEnvelope: ProtocolEnvelope;
  responseEnvelope: ProtocolEnvelope;
} {
  const response = call.response;
  const responseBytes = rawEnvelope(
    response.response,
    `${label} response`,
    readRaw,
    sessionBinding,
  );
  const requestEnvelope = findRequestEnvelope(session, response.response, label, 'tools/call');
  const request = rawEnvelope(requestEnvelope, `${label} request`, readRaw, sessionBinding);
  const parsedRequest = parseJsonObject(request, `${label} request`);
  assert(parsedRequest.method === 'tools/call', `${label} raw request method differs`);
  assert(isRecord(parsedRequest.params), `${label} raw request params are unavailable`);
  assert(
    stableJson(parsedRequest.params) ===
      stableJson({ name: expectedTool, arguments: expectedArguments }),
    `${label} raw request operation or arguments differ`,
  );
  const parsedResponse = parseJsonObject(responseBytes, `${label} response`);
  assert(parsedResponse.id === response.response.id, `${label} response id differs`);
  if (Object.hasOwn(parsedResponse, 'method'))
    assert(parsedResponse.method === 'tools/call', `${label} raw response method differs`);
  const hasResult = Object.hasOwn(parsedResponse, 'result');
  const hasError = Object.hasOwn(parsedResponse, 'error');
  assert(hasResult !== hasError, `${label} raw response must contain exactly one result or error`);
  if (hasError) {
    assert(call.error !== null && call.isError, `${label} raw response error is not typed`);
    assert(
      stableJson(parsedResponse.error) === stableJson(call.error),
      `${label} error differs from typed response`,
    );
    throw new Error(`${label} JSON-RPC response error`);
  }
  assert(call.error === null, `${label} typed response error is missing from raw response`);
  assert(
    stableJson(parsedResponse.result) === stableJson(call.result),
    `${label} result differs from raw response`,
  );
  return {
    request,
    response: responseBytes,
    requestEnvelope,
    responseEnvelope: response.response,
  };
}

function operationIdentity(input: {
  runId: string;
  attemptId: string;
  targetId?: string;
  requestId: string;
  capturedAtMonotonicMs: number;
  sessionId: string;
  sessionBinding: BoundMcpSessionIdentity;
}): JsonObject {
  return {
    runId: input.runId,
    attemptId: input.attemptId,
    ...(input.targetId ? { targetId: input.targetId } : {}),
    requestId: input.requestId,
    capturedAtMonotonicMs: input.capturedAtMonotonicMs,
    sessionId: input.sessionId,
    sessionReceiptSha256: input.sessionBinding.sessionReceiptSha256,
    sessionBinding: input.sessionBinding,
    connectorId: 'maestro-mcp-2.6.1',
    protocolServerName: MCP_SERVER.name,
    protocolServerVersion: MCP_SERVER.version,
  };
}

function sourceEvidence(input: {
  kind: OriginalEvidence['kind'];
  runId: string;
  attemptId: string;
  platform: SelectionExpectation['platform'];
  locale: SelectionExpectation['locale'];
  sourcePath: string;
  bytes: Buffer;
  capturedAtMonotonicMs: number;
  identity: JsonObject;
  source: OwnedEvidenceSource;
}): OriginalEvidence {
  return {
    kind: input.kind,
    runId: input.runId,
    attemptId: input.attemptId,
    platform: input.platform,
    locale: input.locale,
    path: input.sourcePath,
    bytes: input.bytes,
    capturedAtMonotonicMs: input.capturedAtMonotonicMs,
    identity: input.identity,
    source: input.source,
  };
}

function requireObservedEvidenceSource(
  evidence: OriginalEvidence,
  expected: SelectionExpectation,
  label: string,
): NativeEvidenceIdentity {
  assert(evidence.runId === expected.requestedRunId, label + ' run id is not bound');
  assert(evidence.attemptId === expected.requestedAttemptId, label + ' attempt id is not bound');
  assert(
    evidence.source.artifactRoot === path.resolve(expected.artifactRoot),
    label + ' source root differs',
  );
  assert(evidence.source.path === evidence.path, label + ' source path differs');
  const observed = readNativeEvidenceObservation(
    evidence.source.artifactRoot,
    evidence.source.path,
    true,
  );
  assert(
    Buffer.compare(observed.bytes, Buffer.from(evidence.bytes)) === 0,
    label + ' source bytes differ',
  );
  assert(evidence.source.sha256 === sha256(observed.bytes), label + ' source hash differs');
  assert(evidence.source.bytes === observed.bytes.byteLength, label + ' source size differs');
  assert(evidence.source.uid === observed.identity.uid, label + ' source owner differs');
  assert(
    evidence.source.nlink === 1 && observed.identity.nlink === 1,
    label + ' source link count differs',
  );
  assert(
    evidence.source.mode === '0600' && (observed.identity.mode & 0o777) === 0o600,
    label + ' source mode differs',
  );
  assert(evidence.platform === expected.platform, label + ' platform observation differs');
  assert(evidence.locale === expected.locale, label + ' locale observation differs');
  assert(
    Number.isSafeInteger(evidence.capturedAtMonotonicMs) && evidence.capturedAtMonotonicMs >= 0,
    label + ' timestamp is invalid',
  );
  return observed.identity;
}

function selectionBindingSnapshot(binding: ObservedSelectionBinding): JsonObject {
  const row = (entry: {
    readonly evidence: OriginalEvidence;
    readonly sourceIdentity: NativeEvidenceIdentity;
  }): JsonObject => ({
    kind: entry.evidence.kind,
    path: entry.evidence.source.path,
    sha256: entry.evidence.source.sha256,
    bytes: entry.evidence.source.bytes,
    capturedAtMonotonicMs: entry.evidence.capturedAtMonotonicMs,
    sourceIdentity: entry.sourceIdentity,
  });
  return {
    target: row(binding.target),
    build: row(binding.build),
    tool: row(binding.tool),
    locale: row(binding.locale),
  };
}

function requireObservedSelectionMetadata(
  metadata: OwnedMaestroSelectionMetadata | null,
  expected: SelectionExpectation,
): ObservedSelectionBinding {
  assert(metadata !== null, 'MCP platform metadata receipts are unavailable');
  requireSelectionBundle(metadata, expected, path.resolve(expected.artifactRoot));
  const fullRows: [keyof SelectionEvidenceBundle, OriginalEvidence['kind'], string][] = [
    ['target', 'target', 'target metadata'],
    ['build', 'build', 'build metadata'],
    ['tool', 'tool', 'tool metadata'],
    ['locale', 'locale', 'locale metadata'],
    ['roles', 'roles', 'roles metadata'],
    ['fixture', 'fixture', 'fixture metadata'],
    ['reset', 'reset', 'reset metadata'],
    ['authApi', 'auth-api', 'auth API metadata'],
    ['sql', 'sql', 'SQL metadata'],
    ['ownership', 'ownership', 'ownership metadata'],
  ];
  const sourcePaths = new Set<string>();
  for (const [key, kind, label] of fullRows) {
    const evidence = metadata[key];
    assert(evidence !== undefined && evidence.kind === kind, `${label} is unavailable`);
    requireObservedEvidenceSource(evidence, expected, label);
    assert(!sourcePaths.has(evidence.path), `${label} reuses another selection source path`);
    sourcePaths.add(evidence.path);
  }
  const targetIdentity = metadata.target.identity;
  const buildIdentity = metadata.build.identity;
  const toolIdentity = metadata.tool.identity;
  const localeIdentity = metadata.locale.identity;
  const targetSourceIdentity = requireObservedEvidenceSource(
    metadata.target,
    expected,
    'target metadata',
  );
  const buildSourceIdentity = requireObservedEvidenceSource(
    metadata.build,
    expected,
    'build metadata',
  );
  const toolSourceIdentity = requireObservedEvidenceSource(
    metadata.tool,
    expected,
    'tool metadata',
  );
  const localeSourceIdentity = requireObservedEvidenceSource(
    metadata.locale,
    expected,
    'locale metadata',
  );
  assert(
    targetIdentity.targetId === expected.targetId,
    'target metadata is not bound to the selected target',
  );
  assert(targetIdentity.selector === expected.selector, 'target metadata selector differs');
  assert(targetIdentity.appIdOrOrigin === expected.appIdOrOrigin, 'target metadata app differs');
  assert(targetIdentity.apiOrigin === expected.apiOrigin, 'target metadata API differs');
  assert(buildIdentity.buildId === expected.buildId, 'build metadata differs');
  assert(buildIdentity.binarySha256 === expected.binarySha256, 'build metadata binary differs');
  assert(toolIdentity.connectorId === expected.connector.id, 'tool metadata connector differs');
  assert(toolIdentity.kind === expected.connector.kind, 'tool metadata kind differs');
  assert(toolIdentity.name === expected.connector.name, 'tool metadata name differs');
  assert(toolIdentity.version === expected.connector.version, 'tool metadata version differs');
  assert(
    localeIdentity.requestedLocale === expected.locale,
    'locale metadata requested value differs',
  );
  assert(
    localeIdentity.effectiveLocale === expected.locale,
    'locale metadata effective value differs',
  );
  assert(
    localeIdentity.observedLocale === expected.locale,
    'locale metadata observed value differs',
  );
  assert(
    JSON.stringify(metadata.roles.identity.roleIds) === JSON.stringify(expected.roleIds) &&
      Array.isArray(metadata.roles.identity.sessionIds) &&
      metadata.roles.identity.independentSessions === true,
    'roles metadata is not a complete independent selection receipt',
  );
  assert(metadata.fixture.identity.fixtureId === expected.fixtureId, 'fixture metadata differs');
  assert(metadata.fixture.identity.mode === expected.fixtureMode, 'fixture metadata mode differs');
  assert(
    metadata.fixture.identity.scope === expected.fixtureScope,
    'fixture metadata scope differs',
  );
  assert(metadata.reset.identity.resetId === expected.resetId, 'reset metadata differs');
  assert(
    metadata.reset.identity.fresh === true && metadata.reset.identity.verified === true,
    'reset metadata is not fresh and verified',
  );
  assert(
    metadata.authApi.identity.apiOrigin === expected.apiOrigin,
    'auth API metadata origin differs',
  );
  assert(
    metadata.authApi.identity.scope === expected.fixtureScope,
    'auth API metadata scope differs',
  );
  assert(
    metadata.authApi.identity.readOnly === true && metadata.authApi.identity.independent === true,
    'auth API metadata is not independent',
  );
  assert(metadata.sql.identity.scope === expected.fixtureScope, 'SQL metadata scope differs');
  assert(
    metadata.sql.identity.readOnly === true && metadata.sql.identity.independent === true,
    'SQL metadata is not independent',
  );
  assert(
    metadata.ownership.identity.artifactRoot === expected.artifactRoot,
    'ownership metadata root differs',
  );
  assert(
    metadata.ownership.identity.current === true &&
      metadata.ownership.identity.foreignResourcesPreserved === true,
    'ownership metadata is not current and isolated',
  );
  return {
    target: { evidence: metadata.target, sourceIdentity: targetSourceIdentity },
    build: { evidence: metadata.build, sourceIdentity: buildSourceIdentity },
    tool: { evidence: metadata.tool, sourceIdentity: toolSourceIdentity },
    locale: { evidence: metadata.locale, sourceIdentity: localeSourceIdentity },
    full: metadata,
  };
}

export class OwnedMaestroMcpConnector implements T16BConnector {
  readonly identity: ConnectorIdentity;
  readonly #session: OwnedMaestroMcpSession;
  readonly #expected: SelectionExpectation;
  readonly #artifactRoot: string;
  readonly #deadlineMs: number;
  readonly #resolveTextRef: MaestroTextResolver | undefined;
  readonly #selectionMetadata: () => OwnedMaestroSelectionMetadata | null;
  #selectionBinding: ObservedSelectionBinding | null = null;
  #sessionBinding: BoundMcpSessionIdentity | null = null;
  #started = false;
  #closed = false;
  #observationOrdinal = 0;

  constructor(input: {
    readonly session: OwnedMaestroMcpSession;
    readonly expectation: SelectionExpectation;
    readonly selectionMetadata: () => OwnedMaestroSelectionMetadata | null;
    readonly resolveTextRef?: MaestroTextResolver;
    readonly deadlineMs?: number;
  }) {
    assert(
      input.expectation.connector.kind === 'maestro',
      'Maestro connector requires a Maestro expectation',
    );
    assert(
      path.resolve(input.session.artifactRoot) === path.resolve(input.expectation.artifactRoot),
      'MCP session artifact root differs from selection identity',
    );
    const deadlineMs = input.deadlineMs ?? 30_000;
    assert(
      Number.isSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 60_000,
      'MCP connector deadline is invalid',
    );
    this.#session = input.session;
    this.#expected = input.expectation;
    this.#artifactRoot = path.resolve(input.expectation.artifactRoot);
    this.#deadlineMs = deadlineMs;
    this.#resolveTextRef = input.resolveTextRef;
    this.#selectionMetadata = input.selectionMetadata;
    this.identity = {
      kind: 'maestro',
      id: input.expectation.connector.id,
      name: input.expectation.connector.name,
      version: input.expectation.connector.version,
      targetSelectionCapability: true,
      sessionId: safeId(input.session.sessionId, 'MCP sessionId'),
    };
  }

  async start(signal: AbortSignal): Promise<ConnectorStartReceipt> {
    assert(!this.#started && !this.#closed, 'MCP connector lifecycle is not fresh');
    signal.throwIfAborted();
    const selection = this.requireSelectionBinding();
    await this.#session.start({ signal, deadlineMs: this.#deadlineMs });
    const receipt = this.#session.receipt();
    const readRaw = (envelope: ProtocolEnvelope, label: string): Buffer =>
      this.readRawEnvelope(envelope, label);
    this.#sessionBinding = requireSessionReceiptContinuity(
      receipt,
      this.#session.sessionId,
      readRaw,
    );
    assertToolset(receipt);
    const toolsEnvelope = receipt.envelopes.find(
      (envelope) => envelope.kind === 'response' && envelope.method === 'tools/list',
    );
    assert(toolsEnvelope !== undefined, 'MCP startup tools/list receipt is missing');
    const captured = toolsListRequestAndResponseBytes(
      receipt,
      toolsEnvelope,
      this.#sessionBinding,
      readRaw,
    );
    const raw = captured.response;
    outputTools(raw);
    const capturedAtMonotonicMs = requireTimestamp(
      toolsEnvelope.receivedAtMonotonicMs,
      'MCP tools/list timestamp',
    );
    const sourcePath = relativeEvidencePath(
      this.#expected.requestedAttemptId,
      'start-tools-list-response',
    );
    const source = await writeProtectedEvidence(this.#artifactRoot, sourcePath, raw);
    this.#started = true;
    return {
      kind: 'connector-start',
      runId: this.#expected.requestedRunId,
      attemptId: this.#expected.requestedAttemptId,
      capturedAtMonotonicMs,
      identity: this.identity,
      source: sourceEvidence({
        kind: 'tool',
        runId: this.#expected.requestedRunId,
        attemptId: this.#expected.requestedAttemptId,
        platform: this.observedPlatform(),
        locale: this.observedLocale(),
        sourcePath,
        bytes: raw,
        capturedAtMonotonicMs,
        identity: {
          ...operationIdentity({
            runId: this.#expected.requestedRunId,
            attemptId: this.#expected.requestedAttemptId,
            requestId: `tools-list-${String(toolsEnvelope.id ?? toolsEnvelope.sequence)}`,
            capturedAtMonotonicMs,
            sessionId: this.#session.sessionId,
            sessionBinding: this.#sessionBinding,
          }),
          toolNames: [...MAESTRO_261_TOOL_NAMES],
          outputSchemasAdvertised: receipt.outputSchemasAdvertised.map((value) =>
            value === null ? 'unavailable' : value ? 'present' : 'empty',
          ),
          requestSequence: toolsEnvelope.requestSequence,
          responseSha256: sha256(raw),
          selectionBindings: selectionBindingSnapshot(selection),
        },
        source,
      }),
    };
  }

  async selectTarget(input: {
    readonly targetId: string;
    readonly selector: string;
    readonly appIdOrOrigin: string;
    readonly binarySha256: string;
    readonly signal: AbortSignal;
  }): Promise<ConnectorTargetSelection> {
    this.requireRunning();
    input.signal.throwIfAborted();
    const selection = this.requireSelectionBinding();
    const targetIdentity = selection.target.evidence.identity;
    const buildIdentity = selection.build.evidence.identity;
    assert(
      input.targetId === targetIdentity.targetId,
      'MCP target id differs from observed target metadata',
    );
    assert(
      input.selector === targetIdentity.selector,
      'MCP selector differs from observed target metadata',
    );
    assert(
      input.appIdOrOrigin === targetIdentity.appIdOrOrigin,
      'MCP app identity differs from observed target metadata',
    );
    assert(
      input.binarySha256 === buildIdentity.binarySha256 && SHA256.test(input.binarySha256),
      'MCP binary identity differs from observed build metadata',
    );
    const call = await this.#session.callTool(
      'list_devices',
      {},
      {
        signal: input.signal,
        deadlineMs: this.#deadlineMs,
      },
    );
    const captured = requestAndResponseBytes(
      this.requireSessionReceipt(),
      call,
      'MCP list_devices',
      this.requireSessionBinding(),
      (envelope, label) => this.readRawEnvelope(envelope, label),
      'list_devices',
      {},
    );
    assert(!call.isError, 'MCP list_devices returned an error');
    const payload = textContent(call.result, 'MCP list_devices');
    assert(isUnknownArray(payload.devices), 'MCP list_devices devices are unavailable');
    const device = payload.devices.find(
      (candidate: unknown) => isRecord(candidate) && candidate.device_id === input.targetId,
    );
    assert(isRecord(device), 'MCP target id is absent from list_devices');
    assert(
      device.platform === selection.target.evidence.platform,
      'MCP device platform differs from observed target metadata',
    );
    const capturedAtMonotonicMs = requireTimestamp(
      captured.responseEnvelope.receivedAtMonotonicMs,
      'MCP list_devices timestamp',
    );
    const requestId = `list-devices-${String(captured.responseEnvelope.id ?? captured.responseEnvelope.sequence)}`;
    const sourcePath = relativeEvidencePath(
      this.#expected.requestedAttemptId,
      'target-selection-list-devices-response',
    );
    const source = await writeProtectedEvidence(this.#artifactRoot, sourcePath, captured.response);
    return {
      kind: 'target-selection',
      runId: this.#expected.requestedRunId,
      attemptId: this.#expected.requestedAttemptId,
      targetId: String(targetIdentity.targetId),
      platform: selection.target.evidence.platform,
      appIdOrOrigin: String(targetIdentity.appIdOrOrigin),
      binarySha256: String(buildIdentity.binarySha256),
      capturedAtMonotonicMs,
      source: sourceEvidence({
        kind: 'target-selection',
        runId: this.#expected.requestedRunId,
        attemptId: this.#expected.requestedAttemptId,
        platform: this.observedPlatform(),
        locale: this.observedLocale(),
        sourcePath,
        bytes: captured.response,
        capturedAtMonotonicMs,
        identity: {
          ...operationIdentity({
            runId: this.#expected.requestedRunId,
            attemptId: this.#expected.requestedAttemptId,
            targetId: input.targetId,
            requestId,
            capturedAtMonotonicMs,
            sessionId: this.#session.sessionId,
            sessionBinding: this.#sessionBinding!,
          }),
          selector: String(targetIdentity.selector),
          appIdOrOrigin: String(targetIdentity.appIdOrOrigin),
          apiOrigin: String(targetIdentity.apiOrigin),
          buildId: String(buildIdentity.buildId),
          binarySha256: String(buildIdentity.binarySha256),
          device: {
            device_id: device.device_id,
            name: typeof device.name === 'string' ? device.name : null,
            platform: device.platform,
            type: typeof device.type === 'string' ? device.type : null,
          },
          requestSha256: sha256(captured.request),
          responseSha256: sha256(captured.response),
          selectionBindings: selectionBindingSnapshot(selection),
        },
        source,
      }),
    };
  }

  async observe(input: {
    readonly targetId: string;
    readonly signal: AbortSignal;
  }): Promise<ScreenObservation> {
    this.requireRunning();
    input.signal.throwIfAborted();
    const selection = this.requireSelectionBinding();
    assert(
      input.targetId === selection.target.evidence.identity.targetId,
      'MCP observation target differs from observed target metadata',
    );
    const inspectCall = await this.#session.callTool(
      'inspect_screen',
      { device_id: input.targetId },
      { signal: input.signal, deadlineMs: this.#deadlineMs },
    );
    const inspectCaptured = requestAndResponseBytes(
      this.requireSessionReceipt(),
      inspectCall,
      'MCP inspect_screen',
      this.requireSessionBinding(),
      (envelope, label) => this.readRawEnvelope(envelope, label),
      'inspect_screen',
      { device_id: input.targetId },
    );
    assert(!inspectCall.isError, 'MCP inspect_screen returned an error');
    const hierarchy = requireCompactHierarchy(inspectCall.result);
    const screenshotCall = await this.#session.callTool(
      'take_screenshot',
      { device_id: input.targetId },
      { signal: input.signal, deadlineMs: this.#deadlineMs },
    );
    const screenshotCaptured = requestAndResponseBytes(
      this.requireSessionReceipt(),
      screenshotCall,
      'MCP take_screenshot',
      this.requireSessionBinding(),
      (envelope, label) => this.readRawEnvelope(envelope, label),
      'take_screenshot',
      { device_id: input.targetId },
    );
    assert(!screenshotCall.isError, 'MCP take_screenshot returned an error');
    const image = requireImage(screenshotCall.result);
    const inspectTimestamp = requireTimestamp(
      inspectCaptured.responseEnvelope.receivedAtMonotonicMs,
      'MCP inspect_screen timestamp',
    );
    const capturedAtMonotonicMs = requireTimestamp(
      screenshotCaptured.responseEnvelope.receivedAtMonotonicMs,
      'MCP screen timestamp',
    );
    assert(capturedAtMonotonicMs >= inspectTimestamp, 'MCP screenshot preceded hierarchy capture');
    const ordinal = ++this.#observationOrdinal;
    const inspectPath = relativeEvidencePath(
      this.#expected.requestedAttemptId,
      `screen-${ordinal}-inspect-response`,
    );
    const imageResponsePath = relativeEvidencePath(
      this.#expected.requestedAttemptId,
      `screen-${ordinal}-screenshot-response`,
    );
    const imagePath = relativeEvidencePath(
      this.#expected.requestedAttemptId,
      `screen-${ordinal}-screenshot-image`,
    );
    const inspectSource = await writeProtectedEvidence(
      this.#artifactRoot,
      inspectPath,
      inspectCaptured.response,
    );
    const screenshotResponseSource = await writeProtectedEvidence(
      this.#artifactRoot,
      imageResponsePath,
      screenshotCaptured.response,
    );
    const screenshotSource = await writeProtectedEvidence(
      this.#artifactRoot,
      imagePath,
      image.bytes,
    );
    const requestId = `inspect-screen-${String(inspectCaptured.responseEnvelope.id ?? inspectCaptured.responseEnvelope.sequence)}`;
    return {
      kind: 'screen',
      runId: this.#expected.requestedRunId,
      attemptId: this.#expected.requestedAttemptId,
      targetId: input.targetId,
      capturedAtMonotonicMs,
      requestId,
      sourcePath: inspectPath,
      rawBytes: inspectCaptured.response,
      source: inspectSource,
      stateSha256: sha256(inspectCaptured.response),
      identity: {
        ...operationIdentity({
          runId: this.#expected.requestedRunId,
          attemptId: this.#expected.requestedAttemptId,
          targetId: input.targetId,
          requestId,
          capturedAtMonotonicMs,
          sessionId: this.#session.sessionId,
          sessionBinding: this.#sessionBinding!,
        }),
        hierarchy: {
          sourcePath: inspectPath,
          sha256: sha256(inspectCaptured.response),
          bytes: inspectCaptured.response.byteLength,
          requestSha256: sha256(inspectCaptured.request),
          responseId: inspectCaptured.responseEnvelope.id,
          topLevelKeys: Object.keys(hierarchy).sort(),
        },
        screenshot: {
          responsePath: imageResponsePath,
          responseSha256: sha256(screenshotCaptured.response),
          responseBytes: screenshotCaptured.response.byteLength,
          imagePath,
          imageSha256: sha256(image.bytes),
          imageBytes: image.bytes.byteLength,
          mimeType: image.mimeType,
          requestSha256: sha256(screenshotCaptured.request),
          responseId: screenshotCaptured.responseEnvelope.id,
        },
        sourceBindings: [inspectSource.path, screenshotResponseSource.path, screenshotSource.path],
        selectionBindings: selectionBindingSnapshot(selection),
      },
    };
  }

  async perform(input: {
    readonly targetId: string;
    readonly action: BoundedAction;
    readonly ordinal: number;
    readonly signal: AbortSignal;
  }): Promise<ConnectorActionResult> {
    this.requireRunning();
    input.signal.throwIfAborted();
    const selection = this.requireSelectionBinding();
    assert(
      input.targetId === selection.target.evidence.identity.targetId,
      'MCP action target differs from observed target metadata',
    );
    assert(
      Number.isSafeInteger(input.ordinal) && input.ordinal > 0,
      'MCP action ordinal is invalid',
    );
    const text =
      input.action.textRef && this.#resolveTextRef
        ? await this.#resolveTextRef(input.action.textRef, input.signal)
        : undefined;
    const yaml = serializeAction(input.action, text);
    const commandSha256 = sha256(Buffer.from(yaml, 'utf8'));
    const call = await this.#session.callTool(
      'run',
      { device_id: input.targetId, yaml },
      { signal: input.signal, deadlineMs: this.#deadlineMs },
    );
    const captured = requestAndResponseBytes(
      this.requireSessionReceipt(),
      call,
      'MCP run',
      this.requireSessionBinding(),
      (envelope, label) => this.readRawEnvelope(envelope, label),
      'run',
      { device_id: input.targetId, yaml },
    );
    const capturedAtMonotonicMs = requireTimestamp(
      captured.responseEnvelope.receivedAtMonotonicMs,
      'MCP run timestamp',
    );
    const requestId = `run-${String(captured.responseEnvelope.id ?? captured.responseEnvelope.sequence)}`;
    const requestPath = relativeEvidencePath(
      this.#expected.requestedAttemptId,
      `action-${input.ordinal}-request`,
    );
    const resultPath = relativeEvidencePath(
      this.#expected.requestedAttemptId,
      `action-${input.ordinal}-result`,
    );
    const requestSource = await writeProtectedEvidence(
      this.#artifactRoot,
      requestPath,
      captured.request,
    );
    const resultSource = await writeProtectedEvidence(
      this.#artifactRoot,
      resultPath,
      captured.response,
    );
    let status: ConnectorActionResult['status'] = 'blocked';
    let appliedUiActionCount: 0 | 1 | null = null;
    let success: boolean | null = null;
    let commandsExecuted: number | null = null;
    let semanticError: string | null = null;
    try {
      const payload = textContent(call.result, 'MCP run');
      assert(typeof payload.success === 'boolean', 'MCP run success is unavailable');
      success = payload.success;
      if (payload.commands_executed !== undefined) {
        const commandCount = payload.commands_executed;
        assert(
          typeof commandCount === 'number' &&
            Number.isSafeInteger(commandCount) &&
            commandCount >= 0,
          'MCP run commands_executed is invalid',
        );
        commandsExecuted = commandCount;
      }
      assert(call.isError === !success, 'MCP run outer isError disagrees with success');
      if (success && commandsExecuted === 1) {
        status = 'passed';
        appliedUiActionCount = 1;
      } else if (success) {
        status = 'blocked';
      } else {
        status = 'failed';
        appliedUiActionCount = commandsExecuted === 0 ? 0 : null;
      }
    } catch (error) {
      semanticError =
        error instanceof Error
          ? error.message.slice(0, 240)
          : 'MCP run semantic output is unavailable';
      status = call.isError ? 'failed' : 'blocked';
    }
    return {
      kind: 'action-result',
      runId: this.#expected.requestedRunId,
      attemptId: this.#expected.requestedAttemptId,
      requestId,
      capturedAtMonotonicMs,
      status,
      requestedUiActionCount: 1,
      appliedUiActionCount,
      requestBytes: captured.request,
      resultBytes: captured.response,
      requestSource,
      resultSource,
      sourcePath: resultPath,
      identity: {
        ...operationIdentity({
          runId: this.#expected.requestedRunId,
          attemptId: this.#expected.requestedAttemptId,
          targetId: input.targetId,
          requestId,
          capturedAtMonotonicMs,
          sessionId: this.#session.sessionId,
          sessionBinding: this.#sessionBinding!,
        }),
        ordinal: input.ordinal,
        tool: 'run',
        command: input.action.command,
        commandSha256,
        yamlBytes: Buffer.byteLength(yaml),
        commandsExecuted,
        commandsExecutedProvenance: commandsExecuted === null ? 'unavailable' : 'mcp-run-payload',
        success,
        mcpIsError: call.isError,
        requestPath,
        resultPath,
        requestSha256: sha256(captured.request),
        resultSha256: sha256(captured.response),
        semanticError,
        selectionBindings: selectionBindingSnapshot(selection),
      },
    };
  }

  async close(
    signal: AbortSignal,
    options?: {
      readonly deadlineAtMonotonicMs: number;
      readonly recoveryDeadlineAtMonotonicMs: number;
      readonly ownerSignal: AbortSignal;
    },
  ): Promise<ConnectorShutdownReceipt> {
    if (this.#closed) {
      return {
        kind: 'connector-shutdown',
        runId: this.#expected.requestedRunId,
        attemptId: this.#expected.requestedAttemptId,
        status: 'unknown',
        capturedAtMonotonicMs: monotonicNowMs(),
        errorCode: 'already-closed',
      };
    }
    this.#closed = true;
    const selection = this.requireSelectionBinding();
    let cleanup: CloseReceipt;
    try {
      cleanup = await this.#session.close({
        signal,
        ...(options
          ? {
              deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
              recoveryDeadlineAtMonotonicMs: options.recoveryDeadlineAtMonotonicMs,
              ownerSignal: options.ownerSignal,
            }
          : {}),
      });
    } catch (error) {
      return {
        kind: 'connector-shutdown',
        runId: this.#expected.requestedRunId,
        attemptId: this.#expected.requestedAttemptId,
        status: 'unknown',
        capturedAtMonotonicMs: monotonicNowMs(),
        errorCode: error instanceof Error ? 'close-error' : 'close-unknown-error',
      };
    }
    const receipt = this.requireSessionReceipt();
    const capturedAtMonotonicMs = receipt.finishedAtMonotonicMs ?? monotonicNowMs();
    const raw = Buffer.from(JSON.stringify(cleanup) + '\n', 'utf8');
    const sourcePath = relativeEvidencePath(
      this.#expected.requestedAttemptId,
      'connector-cleanup-receipt',
    );
    const source = await writeProtectedEvidence(this.#artifactRoot, sourcePath, raw);
    const cleaned =
      cleanup.status === 'cleaned' &&
      cleanup.ownedProcessGroupAbsent &&
      cleanup.socketResourcesAbsent &&
      cleanup.cleanupError === null &&
      cleanup.protocolFailure === null;
    return {
      kind: 'connector-shutdown',
      runId: this.#expected.requestedRunId,
      attemptId: this.#expected.requestedAttemptId,
      status: cleaned ? 'closed' : cleanup.status === 'failed' ? 'failed' : 'unknown',
      capturedAtMonotonicMs,
      source: sourceEvidence({
        kind: 'cleanup',
        runId: this.#expected.requestedRunId,
        attemptId: this.#expected.requestedAttemptId,
        platform: this.observedPlatform(),
        locale: this.observedLocale(),
        sourcePath,
        bytes: raw,
        capturedAtMonotonicMs,
        identity: {
          ...operationIdentity({
            runId: this.#expected.requestedRunId,
            attemptId: this.#expected.requestedAttemptId,
            requestId: `cleanup-${this.#session.sessionId}`,
            capturedAtMonotonicMs,
            sessionId: this.#session.sessionId,
            sessionBinding: this.#sessionBinding!,
          }),
          status: cleanup.status,
          ownedProcessGroupAbsent: cleanup.ownedProcessGroupAbsent,
          socketResourcesAbsent: cleanup.socketResourcesAbsent,
          cleanupErrorPresent: cleanup.cleanupError !== null,
          protocolFailurePresent: cleanup.protocolFailure !== null,
          receiptSha256: sha256(raw),
          selectionBindings: selectionBindingSnapshot(selection),
        },
        source,
      }),
      ...(cleaned
        ? {}
        : { errorCode: cleanup.cleanupError ? 'cleanup-error' : 'cleanup-unverified' }),
    };
  }

  private requireSelectionBinding(): ObservedSelectionBinding {
    if (!this.#selectionBinding)
      this.#selectionBinding = requireObservedSelectionMetadata(
        this.#selectionMetadata(),
        this.#expected,
      );
    return this.#selectionBinding;
  }

  private requireSessionBinding(): BoundMcpSessionIdentity {
    const receipt = this.#session.receipt();
    assert(this.#sessionBinding !== null, 'MCP session has not established a child identity');
    requireSessionReceiptContinuity(
      receipt,
      this.#session.sessionId,
      (envelope, label) => this.readRawEnvelope(envelope, label),
      this.#sessionBinding,
    );
    return this.#sessionBinding;
  }

  private requireSessionReceipt(): SessionReceipt {
    const receipt = this.#session.receipt();
    assert(this.#sessionBinding !== null, 'MCP session has not established a child identity');
    requireSessionReceiptContinuity(
      receipt,
      this.#session.sessionId,
      (envelope, label) => this.readRawEnvelope(envelope, label),
      this.#sessionBinding,
    );
    return receipt;
  }

  private readRawEnvelope(envelope: ProtocolEnvelope, label: string): Buffer {
    try {
      return this.#session.readOwnedProtocolEnvelopeRawBytes(envelope);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} protected raw envelope read failed: ${detail}`);
    }
  }

  private observedPlatform(): SelectionExpectation['platform'] {
    return this.requireSelectionBinding().target.evidence.platform;
  }

  private observedLocale(): SelectionExpectation['locale'] {
    return this.requireSelectionBinding().locale.evidence.locale;
  }

  private requireRunning(): void {
    assert(this.#started && !this.#closed, 'MCP connector is not running');
  }
}

export async function executeOwnedMaestroT16B(
  input: OwnedMaestroT16BInput,
): Promise<T16BExecutionResult> {
  let selectionCache: OwnedMaestroSelectionMetadata | null = null;
  let selectionPromise: Promise<OwnedMaestroSelectionMetadata> | null = null;
  const loadSelection = (signal: AbortSignal): Promise<OwnedMaestroSelectionMetadata> => {
    signal.throwIfAborted();
    if (!selectionPromise) {
      selectionPromise = Promise.all([
        input.selection.readTarget(signal),
        input.selection.readBuild(signal),
        input.selection.readTool(signal),
        input.selection.readLocale(signal),
        input.selection.readRoles(signal),
        input.selection.readFixture(signal),
        input.selection.readReset(signal),
        input.selection.readAuthApi(signal),
        input.selection.readSql(signal),
        input.selection.readOwnership(signal),
      ]).then(([target, build, tool, locale, roles, fixture, reset, authApi, sql, ownership]) => {
        selectionCache = {
          target,
          build,
          tool,
          locale,
          roles,
          fixture,
          reset,
          authApi,
          sql,
          ownership,
        };
        return selectionCache;
      });
    }
    return selectionPromise;
  };
  const selection = {
    ...input.selection,
    readTarget: (signal: AbortSignal) => loadSelection(signal).then((value) => value.target),
    readBuild: (signal: AbortSignal) => loadSelection(signal).then((value) => value.build),
    readTool: (signal: AbortSignal) => loadSelection(signal).then((value) => value.tool),
    readLocale: (signal: AbortSignal) => loadSelection(signal).then((value) => value.locale),
    readRoles: (signal: AbortSignal) => loadSelection(signal).then((value) => value.roles),
    readFixture: (signal: AbortSignal) => loadSelection(signal).then((value) => value.fixture),
    readReset: (signal: AbortSignal) => loadSelection(signal).then((value) => value.reset),
    readAuthApi: (signal: AbortSignal) => loadSelection(signal).then((value) => value.authApi),
    readSql: (signal: AbortSignal) => loadSelection(signal).then((value) => value.sql),
    readOwnership: (signal: AbortSignal) => loadSelection(signal).then((value) => value.ownership),
  };
  const connector = new OwnedMaestroMcpConnector({
    session: input.session,
    expectation: input.expectation,
    selectionMetadata: () => selectionCache,
    resolveTextRef: input.resolveTextRef,
    deadlineMs: input.protocolDeadlineMs,
  });
  return executeOwnedExploration({ ...input, selection, connector });
}

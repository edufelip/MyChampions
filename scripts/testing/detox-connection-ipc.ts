import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  requireDetoxConnectionActionRequest,
  resolveDetoxConnectionAcceptTarget,
  resolveDetoxConnectionEndTarget,
  type DetoxConnectionActionRequest,
} from './detox-connection-actionability';
import {
  ensureDetoxConnectionArtifactRoot,
  isDetoxConnectionPublicationPending,
  readOwnedDetoxConnectionEvidence,
  readOwnedDetoxConnectionFile,
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceLifecycle,
  type DetoxConnectionEvidenceStat,
} from './detox-connection-evidence';
import {
  normalizeDetoxElementAttributes,
  type DetoxElementAttributesResult,
} from './detox-native-hierarchy';
import type { Stats } from 'node:fs';

export type DetoxConnectionPlatform = 'ios' | 'android';
export type DetoxConnectionActor = 'coach' | 'student';
export type DetoxConnectionNavigation = 'none' | 'student-professionals-back';
export type DetoxConnectionSelector = string | string[];

export type DetoxConnectionOwnedProcessIdentity = Readonly<{
  pid: number;
  pgid: number;
  started: string;
}>;

const COMMAND_SCHEMA = 1 as const;
const MAX_COMMAND_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_POLL_MS = 30_000;
const SHA256 = /^[a-f0-9]{64}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:private\.)?(?:json|xml|png)$/;
const PNG_SIGNATURE = Buffer.from('\x89PNG\r\n\x1a\n', 'binary');
const MAX_DETOX_PNG_BYTES = 8 * 1024 * 1024;

export type DetoxConnectionCommand = Readonly<{
  schemaVersion: typeof COMMAND_SCHEMA;
  commandId: number;
  kind: 'bootstrap' | 'observe' | 'switch-account' | 'shutdown';
  platform: DetoxConnectionPlatform;
  actor: DetoxConnectionActor;
  navigation: DetoxConnectionNavigation;
  label: string;
  semanticActions: string;
  viewId: string;
  selectors: DetoxConnectionSelector;
  selectorKind: 'id' | 'text';
  action?: DetoxConnectionActionRequest;
  commandHash: string;
}>;

export type DetoxConnectionSelectorReceipt = Readonly<{
  selector: string;
  kind: 'id' | 'text';
  before: DetoxElementAttributesResult;
  after: DetoxElementAttributesResult;
  frameStable: true;
}>;

export type DetoxConnectionActionReceipt = Readonly<{
  kind: DetoxConnectionActionRequest['kind'];
  selector: string;
  selectorKind: 'id';
  actionXmlFile: string;
  actionAttributesBeforeFile: string;
  actionAttributesAfterFile: string;
  actionXmlSha256: string;
  actionAttributesBeforeSha256: string;
  actionAttributesAfterSha256: string;
  sourceReceipts: Readonly<{
    xml: DetoxConnectionSourceReceipt;
    attributesBefore: DetoxConnectionSourceReceipt;
    attributesAfter: DetoxConnectionSourceReceipt;
  }>;
  resolution: Readonly<{
    kind: DetoxConnectionActionRequest['kind'];
    selector: string;
    path: readonly number[];
  }>;
  publishedFiles: readonly DetoxConnectionActionPublishedFile[];
  tapCompleted: true;
}>;

export type DetoxConnectionActionPublishedFile = Readonly<{
  name: string;
  metadata: DetoxConnectionEvidenceStat;
}>;

export type DetoxConnectionActionCleanupFile = Readonly<{
  name: string;
  metadata: DetoxConnectionEvidenceStat;
  outcome: 'published' | 'removed' | 'absent' | 'blocked' | 'retained';
  error?: string;
  replacement?: Readonly<{
    metadata: DetoxConnectionEvidenceStat;
    bytes: number;
    sha256: string;
  }>;
}>;

export type DetoxConnectionActionCleanup = Readonly<{
  status: 'not-started' | 'published' | 'cleaned' | 'blocked-recovery' | 'unknown-recovery';
  files: readonly DetoxConnectionActionCleanupFile[];
  ledgerPath?: string;
  ledgerSha256?: string;
  recoveryDeadlineAt?: number;
}>;

export type DetoxConnectionObservationReceipt = Readonly<{
  schemaVersion: 1;
  kind: 'private-detox-connection-observation';
  commandId: number;
  commandHash: string;
  label: string;
  actor: DetoxConnectionActor;
  platform: DetoxConnectionPlatform;
  viewId: string;
  xmlFile: string;
  screenshotFile: string;
  attributesBeforeFile: string;
  attributesAfterFile: string;
  xmlSha256: string;
  screenshotSha256: string;
  attributesBeforeSha256: string;
  attributesAfterSha256: string;
  sourceReceipts: Readonly<{
    xml: DetoxConnectionSourceReceipt;
    screenshot: DetoxConnectionSourceReceipt;
    attributesBefore: DetoxConnectionSourceReceipt;
    attributesAfter: DetoxConnectionSourceReceipt;
  }>;
  selectors: readonly DetoxConnectionSelectorReceipt[];
  action?: DetoxConnectionActionReceipt;
  startedMonotonicMs: number;
  finishedMonotonicMs: number;
  actionCompleted: true;
  hierarchyCaptured: true;
  screenshotCaptured: true;
}>;

export type DetoxConnectionSourceReceipt = Readonly<{
  producer:
    | 'detox.device.generateViewHierarchyXml'
    | 'detox.device.takeScreenshot'
    | 'detox.element.getAttributes';
  sourceKind: 'memory' | 'file';
  processPid: number;
  processPgid: number;
  processStarted: string;
  sourceBytes: number;
  sourceSha256: string;
  sourcePath?: string;
  sourceRealpath?: string;
  producerPath?: string;
  producerRealpath?: string;
  sourceMode?: number;
  sourceUid?: number;
  sourceDev?: number;
  sourceIno?: number;
  sourceGid?: number;
  sourceNlink?: number;
  sourceSnapshotPath?: string;
  sourceSnapshotBytes?: number;
  sourceSnapshotSha256?: string;
  sourceCommandId?: number;
  sourceCommandHash?: string;
  sourceLabel?: string;
}>;

export type DetoxConnectionResponse = Readonly<{
  schemaVersion: typeof COMMAND_SCHEMA;
  kind: 'private-detox-connection-response';
  commandId: number;
  commandHash: string;
  commandKind: DetoxConnectionCommand['kind'];
  status: 'completed' | 'failed' | 'cancelled';
  actor: DetoxConnectionActor;
  platform: DetoxConnectionPlatform;
  observations: readonly DetoxConnectionObservationReceipt[];
  actionCleanup?: DetoxConnectionActionCleanup;
  accountSwitch?: Readonly<{
    actor: DetoxConnectionActor;
    navigation: DetoxConnectionNavigation;
  }>;
  error?: Readonly<{ name: string; message: string }>;
  childPid: number;
  childPgid: number;
  childStarted: string;
  startedMonotonicMs: number;
  finishedMonotonicMs: number;
}>;

export type DetoxConnectionObservedEvidence = Readonly<{
  observation: DetoxConnectionObservationReceipt;
  hierarchy: unknown;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Validate the bounded PNG envelope before a public staging projection. */
export function requireDetoxPngBytes(bytes: Buffer, label = 'Detox screenshot'): void {
  assert(
    Buffer.isBuffer(bytes) &&
      bytes.length > PNG_SIGNATURE.length + 12 &&
      bytes.length <= MAX_DETOX_PNG_BYTES,
    `${label} is not a bounded PNG`,
  );
  assert(
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    `${label} has an invalid PNG signature`,
  );
  let offset = PNG_SIGNATURE.length;
  let hasHeader = false;
  let hasEnd = false;
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length, `${label} has a truncated PNG chunk`);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkEnd = offset + 12 + length;
    assert(chunkEnd <= bytes.length, `${label} has a truncated PNG payload`);
    if (type === 'IHDR') {
      assert(!hasHeader && length === 13, `${label} has an invalid PNG header`);
      assert(bytes.readUInt32BE(offset + 8) > 0, `${label} has an invalid PNG width`);
      assert(bytes.readUInt32BE(offset + 12) > 0, `${label} has an invalid PNG height`);
      hasHeader = true;
    } else if (type === 'IEND') {
      assert(length === 0 && hasHeader, `${label} has an invalid PNG end`);
      assert(chunkEnd === bytes.length, `${label} has trailing bytes after PNG end`);
      hasEnd = true;
      break;
    }
    offset = chunkEnd;
  }
  assert(hasHeader && hasEnd, `${label} is not a complete PNG`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertFileName(name: string, label: string): void {
  assert(FILE_NAME.test(name), `${label} has an unsafe private filename`);
}

type PublicationReadError = Error & {
  detoxConnectionObserved?: DetoxConnectionEvidenceStat;
};

function publicationObservation(error: unknown): DetoxConnectionEvidenceStat | undefined {
  return error instanceof Error
    ? (error as PublicationReadError).detoxConnectionObserved
    : undefined;
}

function publicationStat(metadata: Stats): DetoxConnectionEvidenceStat | undefined {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 2 ||
    (metadata.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
  )
    return undefined;
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
    nlink: metadata.nlink,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  };
}

async function assertOwnedFile(
  root: string,
  name: string,
  maxBytes: number,
  lifecycle: DetoxConnectionEvidenceLifecycle = {},
): Promise<Buffer> {
  assertFileName(name, 'Private evidence');
  const resolvedRoot = path.resolve(root);
  const observedPath = path.join(resolvedRoot, name);
  let observedPublication: DetoxConnectionEvidenceStat | undefined;
  if (path.dirname(observedPath) === resolvedRoot) {
    try {
      observedPublication = publicationStat(await lstat(observedPath));
    } catch {
      // The writer may not have published the path yet.
    }
  }
  try {
    return await readOwnedDetoxConnectionFile(root, name, maxBytes, lifecycle);
  } catch (error) {
    if (observedPublication && error instanceof Error)
      Object.defineProperty(error, 'detoxConnectionObserved', {
        configurable: true,
        value: observedPublication,
      });
    throw error;
  }
}

export async function readOwnedDetoxPrivateFile(
  root: string,
  name: string,
  maxBytes: number,
  lifecycle: DetoxConnectionEvidenceLifecycle = {},
): Promise<Buffer> {
  return assertOwnedFile(root, name, maxBytes, lifecycle);
}

async function writeAtomic(
  root: string,
  name: string,
  bytes: Buffer,
  maxBytes = MAX_RESPONSE_BYTES,
  lifecycle: DetoxConnectionEvidenceLifecycle = {},
): Promise<void> {
  assertFileName(name, 'Private command');
  await writeAtomicDetoxConnectionBytes(root, name, bytes, maxBytes, lifecycle);
}

export type DetoxConnectionIpcWrite = (
  root: string,
  name: string,
  bytes: Buffer,
  maxBytes: number,
  lifecycle: DetoxConnectionEvidenceLifecycle,
) => Promise<void>;

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && SHA256.test(value), `${label} must be a SHA-256 hash`);
}

function requireAbsolutePath(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' &&
      value.length > 0 &&
      path.isAbsolute(value) &&
      path.resolve(value) === value,
    `${label} must be an absolute normalized path`,
  );
}

function frameOf(value: DetoxElementAttributesResult, platform: DetoxConnectionPlatform) {
  const attrs = normalizeDetoxElementAttributes(value) as unknown as Record<string, unknown>;
  assert(attrs.enabled === true, `Detox target ${String(attrs.identifier)} is disabled`);
  assert(attrs.visible === true, `Detox target ${String(attrs.identifier)} is not visible`);
  if (platform === 'ios')
    assert(attrs.hittable === true, `Detox iOS target ${String(attrs.identifier)} is not hittable`);
  const frame = record(attrs.frame, 'Detox element frame');
  for (const key of ['x', 'y', 'width', 'height'])
    assert(
      typeof frame[key] === 'number' && Number.isFinite(frame[key]),
      'Detox element frame is invalid',
    );
  return {
    x: frame.x as number,
    y: frame.y as number,
    width: frame.width as number,
    height: frame.height as number,
  };
}

export function requireStableDetoxElementAttributes(input: {
  platform: DetoxConnectionPlatform;
  selector: string;
  kind?: 'id' | 'text';
  before: DetoxElementAttributesResult;
  after: DetoxElementAttributesResult;
}): DetoxConnectionSelectorReceipt {
  assert(input.selector.length > 0, 'Detox selector is empty');
  const before = normalizeDetoxElementAttributes(input.before);
  const after = normalizeDetoxElementAttributes(input.after);
  assert.equal((before as { identifier: string }).identifier, input.selector);
  assert.equal((after as { identifier: string }).identifier, input.selector);
  assert.deepEqual(frameOf(before, input.platform), frameOf(after, input.platform));
  return {
    selector: input.selector,
    kind: input.kind ?? 'id',
    before,
    after,
    frameStable: true,
  };
}

export function requireDetoxConnectionCommand(value: unknown): DetoxConnectionCommand {
  const row = record(value, 'Detox connection command');
  assert.equal(row.schemaVersion, COMMAND_SCHEMA);
  assert(
    Number.isSafeInteger(row.commandId) && Number(row.commandId) > 0,
    'Detox command ID is invalid',
  );
  assert(['bootstrap', 'observe', 'switch-account', 'shutdown'].includes(String(row.kind)));
  assert(row.platform === 'ios' || row.platform === 'android');
  assert(row.actor === 'coach' || row.actor === 'student');
  assert(row.navigation === 'none' || row.navigation === 'student-professionals-back');
  assert(typeof row.label === 'string' && /^[a-z0-9-]{1,120}$/.test(row.label));
  assert(typeof row.semanticActions === 'string' && row.semanticActions.length > 0);
  assert(typeof row.viewId === 'string' && row.viewId.length > 0);
  assert(row.selectorKind === 'id' || row.selectorKind === 'text');
  const selectors = row.selectors;
  assert(
    (typeof selectors === 'string' && selectors.length > 0) ||
      (Array.isArray(selectors) &&
        selectors.length > 0 &&
        selectors.every((item) => typeof item === 'string' && item.length > 0)),
    'Detox command selectors are invalid',
  );
  const selectorValues = typeof selectors === 'string' ? [selectors] : selectors;
  assert.equal(
    new Set(selectorValues).size,
    selectorValues.length,
    'Detox command selectors contain duplicates',
  );
  const action =
    row.action === undefined ? undefined : requireDetoxConnectionActionRequest(row.action);
  requireHash(row.commandHash, 'Detox command hash');
  const withoutHash = { ...row, commandHash: undefined };
  assert.equal(
    hashJson(withoutHash),
    row.commandHash,
    'Detox command hash does not bind its bytes',
  );
  return {
    ...(row as unknown as DetoxConnectionCommand),
    ...(action ? { action } : {}),
  };
}

async function requireDetoxConnectionActionReceipt(
  root: string,
  command: DetoxConnectionCommand,
  value: unknown,
  expectedChild: DetoxConnectionOwnedProcessIdentity,
  terminalCleanup: unknown,
): Promise<void> {
  const action = command.action;
  assert(action, 'Detox action receipt was supplied without an action command');
  const row = record(value, 'Detox action receipt');
  assert.equal(row.kind, action.kind);
  assert.equal(row.selectorKind, 'id');
  assert(typeof row.selector === 'string' && row.selector.length > 0);
  assert.equal(row.tapCompleted, true);
  assert.equal(
    row.resolution && typeof row.resolution === 'object'
      ? (row.resolution as Record<string, unknown>).kind
      : undefined,
    action.kind,
  );
  assert.equal(
    row.resolution && typeof row.resolution === 'object'
      ? (row.resolution as Record<string, unknown>).selector
      : undefined,
    row.selector,
  );
  const resolution = record(row.resolution, 'Detox action resolution');
  assert(
    Array.isArray(resolution.path) &&
      resolution.path.every((item) => Number.isSafeInteger(item) && Number(item) >= 0),
    'Detox action resolution path is invalid',
  );
  const publishedFiles = requireActionPublishedFiles(row.publishedFiles);
  const expectedNames = [
    String(row.actionXmlFile),
    String(row.actionAttributesBeforeFile),
    String(row.actionAttributesAfterFile),
  ];
  assert.deepEqual(
    publishedFiles.map((item) => item.name).sort(),
    expectedNames.sort(),
    'Detox action published file list is incomplete or reordered',
  );
  for (const item of publishedFiles) {
    const maxBytes = item.name.endsWith('.xml') ? 4 * 1024 * 1024 : 512 * 1024;
    const actual = await readOwnedDetoxConnectionEvidence(root, item.name, maxBytes);
    assert.deepEqual(actual.metadata, item.metadata, 'Detox action published inode changed');
  }
  const [xml, beforeBytes, afterBytes] = await Promise.all([
    assertOwnedFile(root, String(row.actionXmlFile), 4 * 1024 * 1024),
    assertOwnedFile(root, String(row.actionAttributesBeforeFile), 512 * 1024),
    assertOwnedFile(root, String(row.actionAttributesAfterFile), 512 * 1024),
  ]);
  const hashes = {
    xml: String(row.actionXmlSha256),
    before: String(row.actionAttributesBeforeSha256),
    after: String(row.actionAttributesAfterSha256),
  };
  requireHash(hashes.xml, 'Detox action hierarchy hash');
  requireHash(hashes.before, 'Detox action before-attributes hash');
  requireHash(hashes.after, 'Detox action after-attributes hash');
  assert.equal(hashBytes(xml), hashes.xml);
  assert.equal(hashBytes(beforeBytes), hashes.before);
  assert.equal(hashBytes(afterBytes), hashes.after);
  let before: DetoxElementAttributesResult;
  let after: DetoxElementAttributesResult;
  try {
    before = JSON.parse(beforeBytes.toString('utf8')) as DetoxElementAttributesResult;
    after = JSON.parse(afterBytes.toString('utf8')) as DetoxElementAttributesResult;
  } catch {
    throw new Error('Detox action attributes are not JSON');
  }
  const selector = String(row.selector);
  const normalizedBefore = normalizeDetoxElementAttributes(before);
  const normalizedAfter = normalizeDetoxElementAttributes(after);
  assert.equal(normalizedBefore.identifier, selector);
  assert.equal(normalizedAfter.identifier, selector);
  assert.deepEqual(normalizedBefore.frame, normalizedAfter.frame);
  const resolved =
    action.kind === 'accept'
      ? resolveDetoxConnectionAcceptTarget({
          xml: xml.toString('utf8'),
          platform: command.platform,
          snapshot: action.snapshot,
          target: action.target,
          elementAttributes: after,
        })
      : resolveDetoxConnectionEndTarget({
          xml: xml.toString('utf8'),
          platform: command.platform,
          snapshot: action.snapshot,
          target: action.target,
          elementAttributes: after,
        });
  assert.equal(resolved.selector, selector);
  const sourceReceipts = record(row.sourceReceipts, 'Detox action source receipts');
  const sourceFor = (
    key: string,
    producer: DetoxConnectionSourceReceipt['producer'],
    bytes: Buffer,
    expectedHash: string,
  ) => {
    const source = record(sourceReceipts[key], `Detox action ${key} source receipt`);
    assert.equal(source.producer, producer);
    assert.equal(source.sourceKind, 'memory');
    assert.equal(source.processPid, expectedChild.pid);
    assert.equal(source.processPgid, expectedChild.pgid);
    assert.equal(source.processStarted, expectedChild.started);
    assert.equal(source.sourceBytes, bytes.byteLength);
    assert.equal(source.sourceSha256, expectedHash);
    assert.equal(source.sourceCommandId, command.commandId);
    assert.equal(source.sourceCommandHash, command.commandHash);
    assert.equal(source.sourceLabel, command.label);
  };
  sourceFor('xml', 'detox.device.generateViewHierarchyXml', xml, hashes.xml);
  sourceFor('attributesBefore', 'detox.element.getAttributes', beforeBytes, hashes.before);
  sourceFor('attributesAfter', 'detox.element.getAttributes', afterBytes, hashes.after);
  const cleanup = requireActionCleanupShape(terminalCleanup, 'completed');
  assert.equal(cleanup.status, 'published');
  assert.deepEqual(
    cleanup.files.map((item) => item.name).sort(),
    publishedFiles.map((item) => item.name).sort(),
    'Detox action terminal cleanup does not bind its published files',
  );
  assert(cleanup.files.every((item) => item.outcome === 'published'));
}

function requireStat(value: unknown, label: string): DetoxConnectionEvidenceStat {
  const row = record(value, label);
  for (const key of ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size'])
    assert(Number.isSafeInteger(row[key]), `${label} ${key} is invalid`);
  for (const key of ['mtimeMs', 'ctimeMs'])
    assert(typeof row[key] === 'number' && Number.isFinite(row[key]), `${label} ${key} is invalid`);
  return row as unknown as DetoxConnectionEvidenceStat;
}

function requireActionPublishedFiles(
  value: unknown,
): readonly DetoxConnectionActionPublishedFile[] {
  assert(Array.isArray(value) && value.length === 3, 'Detox action published file list is invalid');
  const names = new Set<string>();
  return value.map((raw, index) => {
    const row = record(raw, `Detox action published file ${index}`);
    assertFileName(String(row.name), `Detox action published file ${index}`);
    assert(!names.has(String(row.name)), 'Detox action published files contain duplicates');
    names.add(String(row.name));
    return {
      name: String(row.name),
      metadata: requireStat(row.metadata, `Detox action published file ${index} metadata`),
    };
  });
}

function requireActionCleanupShape(
  value: unknown,
  expectedStatus: 'completed' | 'failed' | 'cancelled',
): DetoxConnectionActionCleanup {
  const row = record(value, 'Detox action terminal cleanup');
  const allowed = ['not-started', 'published', 'cleaned', 'blocked-recovery', 'unknown-recovery'];
  assert(allowed.includes(String(row.status)), 'Detox action terminal cleanup status is invalid');
  if (expectedStatus === 'completed') assert.equal(row.status, 'published');
  else assert.notEqual(row.status, 'published');
  assert(Array.isArray(row.files), 'Detox action terminal cleanup files are invalid');
  const names = new Set<string>();
  const files = row.files.map((raw, index) => {
    const file = record(raw, `Detox action cleanup file ${index}`);
    assertFileName(String(file.name), `Detox action cleanup file ${index}`);
    assert(!names.has(String(file.name)), 'Detox action cleanup files contain duplicates');
    names.add(String(file.name));
    assert(
      ['published', 'removed', 'absent', 'blocked', 'retained'].includes(String(file.outcome)),
    );
    const expectedMetadata = requireStat(
      file.metadata,
      `Detox action cleanup file ${index} metadata`,
    );
    if (file.error !== undefined)
      assert(typeof file.error === 'string' && file.error.length > 0 && file.error.length <= 512);
    let replacement: DetoxConnectionActionCleanupFile['replacement'];
    if (file.replacement !== undefined) {
      assert(file.outcome === 'blocked', 'Detox replacement identity must describe a blocked file');
      const observed = record(file.replacement, `Detox action replacement ${index}`);
      const bytes = Number(observed.bytes);
      const maxBytes = String(file.name).endsWith('.xml') ? 4 * 1024 * 1024 : 512 * 1024;
      assert(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= maxBytes);
      requireHash(observed.sha256, `Detox action replacement ${index} hash`);
      replacement = {
        metadata: requireStat(observed.metadata, `Detox action replacement ${index} metadata`),
        bytes,
        sha256: String(observed.sha256),
      };
      assert(
        replacement.metadata.dev !== expectedMetadata.dev ||
          replacement.metadata.ino !== expectedMetadata.ino,
        'Detox replacement identity did not change the owned inode',
      );
    }
    if (file.outcome === 'blocked')
      assert(
        typeof file.error === 'string' && file.error.length > 0,
        'Detox blocked cleanup file error is missing',
      );
    return {
      name: String(file.name),
      metadata: expectedMetadata,
      outcome: file.outcome as DetoxConnectionActionCleanupFile['outcome'],
      ...(file.error === undefined ? {} : { error: String(file.error) }),
      ...(replacement === undefined ? {} : { replacement }),
    };
  });
  if (row.ledgerPath !== undefined) {
    assert(typeof row.ledgerPath === 'string', 'Detox action cleanup ledger path is invalid');
    assertFileName(row.ledgerPath, 'Detox action cleanup ledger');
  }
  if (row.ledgerSha256 !== undefined)
    requireHash(row.ledgerSha256, 'Detox action cleanup ledger hash');
  if (row.ledgerPath !== undefined)
    assert(typeof row.ledgerSha256 === 'string', 'Detox action cleanup ledger hash is missing');
  if (row.recoveryDeadlineAt !== undefined)
    assert(typeof row.recoveryDeadlineAt === 'number' && Number.isFinite(row.recoveryDeadlineAt));
  if (row.status === 'not-started') assert.equal(files.length, 0);
  if (row.status === 'published') {
    assert.equal(files.length, 3);
    assert(files.every((file) => file.outcome === 'published'));
  }
  if (row.status === 'cleaned')
    assert(files.every((file) => file.outcome === 'removed' || file.outcome === 'absent'));
  if (row.status === 'blocked-recovery') {
    assert(typeof row.ledgerPath === 'string', 'Detox blocked recovery ledger is missing');
    assert(
      files.some((file) => file.outcome === 'blocked'),
      'Detox blocked recovery has no blocked file outcome',
    );
    assert(
      files.some((file) => file.replacement !== undefined),
      'Detox blocked recovery has no bounded replacement identity',
    );
  }
  if (row.status === 'unknown-recovery')
    assert(typeof row.ledgerPath === 'string', 'Detox unknown recovery ledger is missing');
  return {
    status: row.status as DetoxConnectionActionCleanup['status'],
    files,
    ...(row.ledgerPath === undefined ? {} : { ledgerPath: row.ledgerPath }),
    ...(row.ledgerSha256 === undefined ? {} : { ledgerSha256: String(row.ledgerSha256) }),
    ...(row.recoveryDeadlineAt === undefined
      ? {}
      : { recoveryDeadlineAt: Number(row.recoveryDeadlineAt) }),
  };
}

export function requireDetoxConnectionActionCleanup(
  value: unknown,
  expectedStatus: 'completed' | 'failed' | 'cancelled',
): DetoxConnectionActionCleanup {
  return requireActionCleanupShape(value, expectedStatus);
}

async function requireActionCleanup(
  root: string,
  command: DetoxConnectionCommand,
  response: DetoxConnectionResponse,
): Promise<void> {
  if (!command.action) {
    assert.equal(
      response.actionCleanup,
      undefined,
      'Detox response contains unexpected action cleanup',
    );
    return;
  }
  const cleanup = requireActionCleanupShape(response.actionCleanup, response.status);
  if (cleanup.ledgerPath) {
    const ledger = await assertOwnedFile(root, cleanup.ledgerPath, 1024 * 1024);
    assert.equal(hashBytes(ledger), cleanup.ledgerSha256);
    const parsed = record(JSON.parse(ledger.toString('utf8')), 'Detox action cleanup ledger');
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.kind, 'private-detox-connection-action-cleanup');
    assert.equal(parsed.status, cleanup.status);
    assert.equal(parsed.commandId, command.commandId);
    assert.equal(parsed.commandHash, command.commandHash);
    assert.deepEqual(parsed.files, cleanup.files);
  }
  if (response.status === 'completed') {
    const observation = record(response.observations[0], 'Detox completed action observation');
    const action = record(observation.action, 'Detox completed action receipt');
    const publishedFiles = requireActionPublishedFiles(action.publishedFiles);
    assert.deepEqual(
      cleanup.files,
      publishedFiles.map((file) => ({ ...file, outcome: 'published' })),
      'Detox completed cleanup does not bind the action receipt',
    );
  }
}

export async function requireDetoxConnectionObservation(
  root: string,
  command: DetoxConnectionCommand,
  value: unknown,
  expectedChild: DetoxConnectionOwnedProcessIdentity,
  terminalCleanup?: unknown,
): Promise<DetoxConnectionObservedEvidence> {
  const row = record(value, 'Detox connection observation');
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.kind, 'private-detox-connection-observation');
  assert(
    Number.isSafeInteger(row.commandId) && row.commandId === command.commandId,
    'Detox observation command ID is invalid',
  );
  assert.equal(row.commandHash, command.commandHash);
  assert.equal(row.label, command.label);
  assert.equal(row.actor, command.actor);
  assert.equal(row.platform, command.platform);
  assert.equal(row.viewId, command.viewId);
  assert(Number.isSafeInteger(expectedChild.pid) && expectedChild.pid > 1);
  assert(Number.isSafeInteger(expectedChild.pgid) && expectedChild.pgid > 1);
  assert(typeof expectedChild.started === 'string' && expectedChild.started.length > 0);
  assert.equal(row.actionCompleted, true);
  assert.equal(row.hierarchyCaptured, true);
  assert.equal(row.screenshotCaptured, true);
  for (const name of [
    'xmlSha256',
    'screenshotSha256',
    'attributesBeforeSha256',
    'attributesAfterSha256',
  ])
    requireHash(row[name], `Detox ${name}`);
  for (const key of ['startedMonotonicMs', 'finishedMonotonicMs'])
    assert(typeof row[key] === 'number' && Number.isFinite(row[key]), `Detox ${key} is invalid`);
  const startedMonotonicMs = row.startedMonotonicMs as number;
  const finishedMonotonicMs = row.finishedMonotonicMs as number;
  assert(finishedMonotonicMs >= startedMonotonicMs, 'Detox observation time reversed');
  const [xml, screenshot, beforeBytes, afterBytes] = await Promise.all([
    assertOwnedFile(root, String(row.xmlFile), 4 * 1024 * 1024),
    assertOwnedFile(root, String(row.screenshotFile), 16 * 1024 * 1024),
    assertOwnedFile(root, String(row.attributesBeforeFile), 512 * 1024),
    assertOwnedFile(root, String(row.attributesAfterFile), 512 * 1024),
  ]);
  requireDetoxPngBytes(screenshot, 'Detox screenshot observation');
  assert.equal(hashBytes(xml), row.xmlSha256);
  assert.equal(hashBytes(screenshot), row.screenshotSha256);
  assert.equal(hashBytes(beforeBytes), row.attributesBeforeSha256);
  assert.equal(hashBytes(afterBytes), row.attributesAfterSha256);
  const sourceReceipts = record(row.sourceReceipts, 'Detox source receipts');
  const sourceFor = (
    key: string,
    producer: DetoxConnectionSourceReceipt['producer'],
    sourceKind: DetoxConnectionSourceReceipt['sourceKind'],
    bytes: Buffer,
    expectedHash: string,
  ) => {
    const source = record(sourceReceipts[key], `Detox ${key} source receipt`);
    assert.equal(source.producer, producer);
    assert.equal(source.sourceKind, sourceKind);
    assert.equal(source.processPid, expectedChild.pid);
    assert.equal(source.processPgid, expectedChild.pgid);
    assert.equal(source.processStarted, expectedChild.started);
    assert(Number.isSafeInteger(source.sourceBytes) && source.sourceBytes === bytes.byteLength);
    requireHash(source.sourceSha256, `Detox ${key} source hash`);
    assert.equal(source.sourceSha256, expectedHash);
    assert.equal(source.sourceCommandId, command.commandId);
    assert.equal(source.sourceCommandHash, command.commandHash);
    assert.equal(source.sourceLabel, command.label);
    return source;
  };
  const xmlSha256 = String(row.xmlSha256);
  const screenshotSha256 = String(row.screenshotSha256);
  const attributesBeforeSha256 = String(row.attributesBeforeSha256);
  const attributesAfterSha256 = String(row.attributesAfterSha256);
  sourceFor('xml', 'detox.device.generateViewHierarchyXml', 'memory', xml, xmlSha256);
  const screenshotSource = sourceFor(
    'screenshot',
    'detox.device.takeScreenshot',
    'file',
    screenshot,
    screenshotSha256,
  );
  sourceFor(
    'attributesBefore',
    'detox.element.getAttributes',
    'memory',
    beforeBytes,
    attributesBeforeSha256,
  );
  sourceFor(
    'attributesAfter',
    'detox.element.getAttributes',
    'memory',
    afterBytes,
    attributesAfterSha256,
  );
  requireAbsolutePath(screenshotSource.sourcePath, 'Detox screenshot producer path');
  requireAbsolutePath(screenshotSource.sourceRealpath, 'Detox screenshot producer realpath');
  assert.equal(screenshotSource.sourcePath, screenshotSource.sourceRealpath);
  requireAbsolutePath(screenshotSource.producerPath, 'Detox screenshot original producer path');
  requireAbsolutePath(
    screenshotSource.producerRealpath,
    'Detox screenshot original producer realpath',
  );
  assert.equal(screenshotSource.sourcePath, screenshotSource.producerPath);
  assert.equal(screenshotSource.sourceRealpath, screenshotSource.producerRealpath);
  for (const key of [
    'sourceMode',
    'sourceUid',
    'sourceDev',
    'sourceIno',
    'sourceGid',
    'sourceNlink',
  ])
    assert(Number.isSafeInteger(screenshotSource[key]), `Detox screenshot ${key} is missing`);
  assert.equal(screenshotSource.sourceNlink, 1);
  assert(
    typeof screenshotSource.sourceSnapshotPath === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.png$/.test(screenshotSource.sourceSnapshotPath),
    'Detox screenshot owned snapshot path is missing',
  );
  assert(Number.isSafeInteger(screenshotSource.sourceSnapshotBytes));
  assert.equal(screenshotSource.sourceSnapshotBytes, screenshotSource.sourceBytes);
  requireHash(screenshotSource.sourceSnapshotSha256, 'Detox screenshot owned snapshot hash');
  const snapshotBytes = await assertOwnedFile(
    root,
    String(screenshotSource.sourceSnapshotPath),
    16 * 1024 * 1024,
  );
  assert.equal(snapshotBytes.byteLength, screenshotSource.sourceSnapshotBytes);
  assert.equal(hashBytes(snapshotBytes), screenshotSource.sourceSnapshotSha256);
  assert.equal(hashBytes(snapshotBytes), screenshotSource.sourceSha256);
  requireDetoxPngBytes(snapshotBytes, 'Detox screenshot owned snapshot');
  let before: unknown;
  let after: unknown;
  try {
    before = JSON.parse(beforeBytes.toString('utf8'));
    after = JSON.parse(afterBytes.toString('utf8'));
  } catch {
    throw new Error('Detox element attribute evidence is not JSON');
  }
  const selectors = Array.isArray(row.selectors) ? row.selectors : [];
  assert(selectors.length > 0, 'Detox observation has no bound selectors');
  const expectedSelectors =
    typeof command.selectors === 'string' ? [command.selectors] : command.selectors;
  assert.deepEqual(
    selectors.map((item) => record(item, 'Detox selector receipt').selector),
    expectedSelectors,
  );
  assert.equal(
    new Set(selectors.map((item) => String(record(item, 'Detox selector receipt').selector))).size,
    selectors.length,
    'Detox observation contains duplicate selector receipts',
  );
  assert(Array.isArray(before) && Array.isArray(after), 'Detox attribute evidence must be arrays');
  assert.equal(
    before.length,
    selectors.length,
    'Detox before-attributes count differs from selectors',
  );
  assert.equal(
    after.length,
    selectors.length,
    'Detox after-attributes count differs from selectors',
  );
  for (const item of selectors) {
    const selector = record(item, 'Detox selector receipt');
    assert.equal(selector.kind, command.selectorKind);
    assert.equal(selector.frameStable, true);
    requireStableDetoxElementAttributes({
      platform: command.platform,
      selector: String(selector.selector),
      kind: command.selectorKind,
      before: selector.before as DetoxElementAttributesResult,
      after: selector.after as DetoxElementAttributesResult,
    });
    const index = selectors.indexOf(item);
    assert.deepEqual(before[index], selector.before, 'Detox before attributes were rewritten');
    assert.deepEqual(after[index], selector.after, 'Detox after attributes were rewritten');
  }
  if (command.action) {
    assert(
      row.action && typeof row.action === 'object',
      'Detox action command omitted its receipt',
    );
    await requireDetoxConnectionActionReceipt(
      root,
      command,
      row.action,
      expectedChild,
      terminalCleanup,
    );
  } else
    assert.equal(row.action, undefined, 'Detox observation contains an unexpected action receipt');
  // XML is returned to the parent for parsing. The parent writes the canonical
  // hierarchy file only after this receipt is revalidated.
  return {
    observation: row as unknown as DetoxConnectionObservationReceipt,
    hierarchy: xml.toString('utf8'),
  };
}

export class DetoxConnectionIpcClient {
  #counter = 0;
  #closed = false;
  readonly #root: string;
  readonly #platform: DetoxConnectionPlatform;
  readonly #signal: AbortSignal;
  readonly #deadlineAt: number;
  readonly #expectedChild: DetoxConnectionOwnedProcessIdentity;
  readonly #writeEvidence: DetoxConnectionIpcWrite;

  constructor(input: {
    artifactRoot: string;
    platform: DetoxConnectionPlatform;
    signal: AbortSignal;
    /** Caller-owned absolute monotonic deadline when available. */
    deadlineAtMonotonicMs?: number;
    /** Backward-compatible current-Q budget input; it is converted once at construction. */
    deadlineMs?: number;
    expectedChild: DetoxConnectionOwnedProcessIdentity;
    writeEvidence?: DetoxConnectionIpcWrite;
  }) {
    this.#root = path.resolve(input.artifactRoot);
    this.#platform = input.platform;
    this.#signal = input.signal;
    const budgetMs = input.deadlineMs;
    const deadlineAt =
      input.deadlineAtMonotonicMs ??
      (typeof budgetMs === 'number' &&
      Number.isSafeInteger(budgetMs) &&
      budgetMs >= 1_000 &&
      budgetMs <= 600_000
        ? performance.now() + budgetMs
        : Number.NaN);
    assert(
      Number.isFinite(deadlineAt) && deadlineAt > performance.now(),
      'Detox IPC absolute deadline is invalid or elapsed',
    );
    assert(Number.isSafeInteger(input.expectedChild.pid) && input.expectedChild.pid > 1);
    assert(Number.isSafeInteger(input.expectedChild.pgid) && input.expectedChild.pgid > 1);
    assert(
      typeof input.expectedChild.started === 'string' && input.expectedChild.started.length > 0,
    );
    this.#deadlineAt = deadlineAt;
    this.#expectedChild = input.expectedChild;
    this.#writeEvidence =
      input.writeEvidence ??
      ((root, name, bytes, maxBytes, lifecycle) =>
        writeAtomic(root, name, bytes, maxBytes, lifecycle));
  }

  async request(
    input: Omit<DetoxConnectionCommand, 'schemaVersion' | 'commandId' | 'platform' | 'commandHash'>,
    options: { signal?: AbortSignal; deadlineAt?: number } = {},
  ) {
    assert(!this.#closed, 'Detox IPC client is closed');
    const signal = options.signal ?? this.#signal;
    const deadlineAt = options.deadlineAt ?? this.#deadlineAt;
    if (!Number.isFinite(deadlineAt) || deadlineAt <= performance.now())
      throw new Error('Detox IPC command deadline elapsed before request');
    if (signal.aborted) throw signal.reason ?? new Error('Detox IPC request cancelled');
    const commandWithoutHash = {
      schemaVersion: COMMAND_SCHEMA,
      commandId: ++this.#counter,
      platform: this.#platform,
      ...input,
      commandHash: undefined,
    };
    const command = requireDetoxConnectionCommand({
      ...commandWithoutHash,
      commandHash: hashJson(commandWithoutHash),
    });
    const commandName = `detox-connection-command-${command.commandId}.private.json`;
    const responseName = `detox-connection-response-${command.commandId}.private.json`;
    const cancelName = `detox-connection-cancel-${command.commandId}.private.json`;
    await this.#writeEvidence(
      this.#root,
      commandName,
      Buffer.from(JSON.stringify(command) + '\n'),
      MAX_COMMAND_BYTES,
      // The command envelope is the request's durable hand-off. Keep its
      // writer alive after a caller abort so an already observed command can
      // still be classified by the child/response identity path. Training's
      // cancellable initial write is handled by its owned child client.
      { deadlineAt },
    );
    let cancellationPublished = false;
    const publishCancellation = async () => {
      if (!cancellationPublished) {
        cancellationPublished = true;
        await this.#writeEvidence(
          this.#root,
          cancelName,
          Buffer.from(
            JSON.stringify({
              schemaVersion: COMMAND_SCHEMA,
              commandId: command.commandId,
              commandHash: command.commandHash,
            }) + '\n',
          ),
          16 * 1024,
          // Cancellation evidence must retain the caller's original
          // deadline, but an already-aborted signal would make this cleanup
          // receipt fail before it becomes durable.
          { deadlineAt },
        );
      }
    };
    const validateResponse = (value: unknown): DetoxConnectionResponse => {
      const row = record(value, 'Detox IPC response');
      assert.equal(row.schemaVersion, COMMAND_SCHEMA);
      assert.equal(row.kind, 'private-detox-connection-response');
      assert.equal(row.commandId, command.commandId);
      assert.equal(row.commandHash, command.commandHash);
      assert.equal(row.commandKind, command.kind);
      assert.equal(row.platform, this.#platform);
      assert.equal(row.actor, command.actor);
      assert(Array.isArray(row.observations), 'Detox IPC response observations are invalid');
      assert.equal(row.childPid, this.#expectedChild.pid, 'Detox child PID identity changed');
      assert.equal(
        Number(row.childPgid),
        this.#expectedChild.pgid,
        'Detox child PGID identity changed',
      );
      assert.equal(
        String(row.childStarted),
        this.#expectedChild.started,
        'Detox child start identity changed',
      );
      const startedMonotonicMs = Number(row.startedMonotonicMs);
      const finishedMonotonicMs = Number(row.finishedMonotonicMs);
      assert(Number.isFinite(startedMonotonicMs) && Number.isFinite(finishedMonotonicMs));
      assert(finishedMonotonicMs >= startedMonotonicMs);
      assert(finishedMonotonicMs <= deadlineAt, 'Detox IPC response finished after deadline');
      assert(
        row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled',
        'Detox IPC response status is invalid',
      );
      if (command.action) requireActionCleanupShape(row.actionCleanup, row.status);
      else
        assert.equal(row.actionCleanup, undefined, 'Detox response has unexpected action cleanup');
      if (row.status === 'completed') {
        if (command.kind === 'shutdown') assert.equal(row.observations.length, 0);
        else assert.equal(row.observations.length, 1);
        if (command.kind === 'switch-account') {
          const accountSwitch = record(row.accountSwitch, 'Detox account switch response');
          assert.equal(accountSwitch.actor, command.actor);
          assert.equal(accountSwitch.navigation, command.navigation);
        } else assert.equal(row.accountSwitch, undefined);
      }
      if (row.status === 'failed') {
        const error = record(row.error, 'Detox child failure');
        assert(
          typeof error.name === 'string' && error.name.length > 0,
          'Detox child failure name is missing',
        );
        assert(
          typeof error.message === 'string' && error.message.length > 0,
          'Detox child failure message is missing',
        );
      }
      return row as unknown as DetoxConnectionResponse;
    };
    for (;;) {
      if (this.#closed) throw new Error('Detox IPC client is closed');
      if (signal.aborted) await publishCancellation();
      if (performance.now() >= deadlineAt)
        throw signal.aborted
          ? (signal.reason ?? new Error('Detox IPC request cancelled before response'))
          : new Error('Detox IPC command deadline elapsed before response');
      try {
        const responseBytes = await assertOwnedFile(this.#root, responseName, MAX_RESPONSE_BYTES, {
          // After cancellation, read only the owned terminal evidence under the
          // original deadline. Completed responses still fail below.
          signal: signal.aborted ? undefined : signal,
          deadlineAt,
        });
        if (performance.now() >= deadlineAt)
          throw new Error('Detox IPC command response arrived after deadline');
        const row = validateResponse(JSON.parse(responseBytes.toString('utf8')) as unknown);
        await requireActionCleanup(this.#root, command, row);
        if (signal.aborted && row.status !== 'cancelled') {
          await publishCancellation();
          throw new Error(`Detox child ${row.status} response arrived after cancellation`);
        }
        return row;
      } catch (error) {
        if (signal.aborted && error === signal.reason) {
          await publishCancellation();
          continue;
        }
        if (
          await isDetoxConnectionPublicationPending(
            this.#root,
            responseName,
            publicationObservation(error),
          )
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          continue;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (signal.aborted) await publishCancellation();
      const remaining = deadlineAt - performance.now();
      if (remaining <= 0)
        throw signal.aborted
          ? (signal.reason ?? new Error('Detox IPC request cancelled before response'))
          : new Error('Detox IPC command deadline elapsed before response');
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
    }
  }

  close(): void {
    this.#closed = true;
  }
}

export async function waitForDetoxConnectionCommand(input: {
  artifactRoot: string;
  platform: DetoxConnectionPlatform;
  afterCommandId: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<DetoxConnectionCommand> {
  const root = path.resolve(input.artifactRoot);
  const deadline = performance.now() + Math.min(input.timeoutMs ?? MAX_POLL_MS, MAX_POLL_MS);
  for (;;) {
    input.signal?.throwIfAborted();
    const names = (await readdir(root)).filter((name) =>
      /^detox-connection-command-\d+\.private\.json$/.test(name),
    );
    const candidates = names
      .map((name) => Number(name.match(/(\d+)/)?.[1]))
      .filter((id) => Number.isSafeInteger(id) && id > input.afterCommandId)
      .sort((a, b) => a - b);
    if (candidates.length > 0) {
      const name = `detox-connection-command-${candidates[0]}.private.json`;
      let bytes: Buffer;
      try {
        bytes = await assertOwnedFile(root, name, MAX_COMMAND_BYTES);
      } catch (error) {
        if (await isDetoxConnectionPublicationPending(root, name, publicationObservation(error))) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          continue;
        }
        throw error;
      }
      input.signal?.throwIfAborted();
      if (performance.now() >= deadline) throw new Error('Detox IPC command wait deadline elapsed');
      const command = requireDetoxConnectionCommand(JSON.parse(bytes.toString('utf8')));
      assert.equal(command.platform, input.platform);
      return command;
    }
    if (performance.now() >= deadline) throw new Error('Detox IPC command wait deadline elapsed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function publishDetoxConnectionResponse(
  root: string,
  response: DetoxConnectionResponse,
): Promise<void> {
  await ensureDetoxConnectionArtifactRoot(root);
  const name = `detox-connection-response-${response.commandId}.private.json`;
  await writeAtomic(root, name, Buffer.from(JSON.stringify(response) + '\n'));
}

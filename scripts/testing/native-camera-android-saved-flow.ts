import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import YAML from 'yaml';
import { ANDROID_CAMERA_APP_ID, ANDROID_CAMERA_SCENARIO } from './native-camera-android-contract';
import type { NativePilotSelection } from './native-pilot-contract';

const FLOW_NAME = 'Android camera denied — SCN-camera-denied-android';
const FLOW_RELATIVE_PATH = '.maestro/flows/camera-denied-android.yaml';
const INVITE_CODE_TOKEN = '${MAESTRO_CAMERA_INVITE_CODE}';
const HASH = /^[a-f0-9]{64}$/u;
const SAFE_CONNECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const MAX_SAVED_FLOW_BYTES = 256 * 1024;
const SAVED_FLOW_READ_CHUNK_BYTES = 64 * 1024;
const PENDING_ID_PATTERN =
  'student\\.professionals\\.connectionPending\\.[A-Za-z0-9][A-Za-z0-9._:-]{0,159}';

/** Inject the live fixture value into the owned child environment exactly once. */
export function setAndroidCameraInviteCode(
  env: Record<string, string | undefined>,
  value: string,
): void {
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value) && !/[\r\n\0]/u.test(value),
    'Android camera invite code is invalid for Maestro environment injection',
  );
  assert(
    env.MAESTRO_CAMERA_INVITE_CODE === undefined,
    'Android camera invite code may be injected only once',
  );
  env.MAESTRO_CAMERA_INVITE_CODE = value;
}

const SYSTEM_PERMISSION_SELECTOR_PATTERN =
  '^com\\.(?:android\\.permissioncontroller|google\\.android\\.permissioncontroller):id/permission_message$';
const SYSTEM_DENY_SELECTOR_PATTERN =
  '^com\\.(?:android\\.permissioncontroller|google\\.android\\.permissioncontroller):id/permission_deny_button$';

export type AndroidCameraSavedFlowBinding = Readonly<{
  path: typeof FLOW_RELATIVE_PATH;
  sha256: string;
  scenarioId: typeof ANDROID_CAMERA_SCENARIO;
  flowId: 'FLW-camera-denied';
  fixtureRef: string;
}>;

type Command = Record<string, unknown> | 'hideKeyboard';

type SavedFlowDocument = {
  commands: readonly Command[];
};

export type AndroidCameraSavedFlow = Readonly<{
  binding: AndroidCameraSavedFlowBinding;
  selectors: Readonly<{
    entryHome: 'student.home.accountButton';
    entryScreen: 'student.professionals.screen';
    entryScan: 'student.professionals.scanQrButton';
    promptMessage: typeof SYSTEM_PERMISSION_SELECTOR_PATTERN;
    promptDeny: typeof SYSTEM_DENY_SELECTOR_PATTERN;
    guidance: 'student.professionals.submitError';
    codeInput: 'student.professionals.codeInput';
    connect: 'student.professionals.connectButton';
    pendingPattern: typeof PENDING_ID_PATTERN;
  }>;
  renderEntry: () => string;
  renderPrompt: () => string;
  renderDenied: (denySelector: string) => string;
  renderManual: () => string;
  renderSubmit: () => string;
  renderPending: (connectionId: string) => string;
}>;

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

type SavedFlowFileIdentity = Readonly<{
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
}>;

function identity(metadata: {
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
}): SavedFlowFileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    nlink: metadata.nlink,
  };
}

function sameIdentity(left: SavedFlowFileIdentity, right: SavedFlowFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  );
}

function requireLifecycle(
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
  label: string,
): void {
  signal?.throwIfAborted();
  assert(
    Number.isFinite(deadlineAtMonotonicMs) && performance.now() < deadlineAtMonotonicMs,
    `${label} deadline expired`,
  );
}

function requireSavedFlowDirectory(
  metadata: {
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    nlink: number;
  },
  label: string,
): SavedFlowFileIdentity {
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), `${label} is not a directory`);
  assert.equal(metadata.uid, process.getuid?.(), `${label} owner changed`);
  assert.equal(metadata.mode & 0o022, 0, `${label} is writable by another principal`);
  return identity({
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    nlink: metadata.nlink,
  });
}

function requireSavedFlowFile(
  metadata: {
    isFile(): boolean;
    isSymbolicLink(): boolean;
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    nlink: number;
  },
  label: string,
): SavedFlowFileIdentity {
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${label} is not a regular file`);
  assert.equal(metadata.nlink, 1, `${label} must have one link`);
  assert.equal(metadata.uid, process.getuid?.(), `${label} owner changed`);
  assert.equal(metadata.mode & 0o022, 0, `${label} is writable by another principal`);
  assert(
    metadata.size > 0 && metadata.size <= MAX_SAVED_FLOW_BYTES,
    `${label} exceeds its bounded size`,
  );
  return identity(metadata);
}

function savedFlowAncestors(root: string, absolute: string): string[] {
  const relative = path.relative(root, absolute);
  const segments = relative.split(path.sep);
  const ancestors = [root];
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    ancestors.push(current);
  }
  return ancestors;
}

async function snapshotSavedFlowAncestors(
  root: string,
  absolute: string,
  label: string,
): Promise<readonly { path: string; identity: SavedFlowFileIdentity }[]> {
  const result: { path: string; identity: SavedFlowFileIdentity }[] = [];
  for (const ancestor of savedFlowAncestors(root, absolute)) {
    assert.equal(await realpath(ancestor), ancestor, `${label} ancestor is not canonical`);
    result.push({
      path: ancestor,
      identity: requireSavedFlowDirectory(await lstat(ancestor), `${label} ancestor`),
    });
  }
  return result;
}

function requireSameAncestors(
  before: readonly { path: string; identity: SavedFlowFileIdentity }[],
  after: readonly { path: string; identity: SavedFlowFileIdentity }[],
  label: string,
): void {
  assert.equal(after.length, before.length, `${label} ancestor count changed`);
  before.forEach((expected, index) => {
    const actual = after[index];
    assert.equal(actual.path, expected.path, `${label} ancestor path changed`);
    assert(
      sameIdentity(actual.identity, expected.identity),
      `${label} ancestor identity changed while reading`,
    );
  });
}

async function readSavedFlowChunk(
  descriptor: Awaited<ReturnType<typeof open>>,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
): Promise<{ bytesRead: number }> {
  requireLifecycle(signal, deadlineAtMonotonicMs, 'Android camera saved flow read');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    onAbort = () => {
      try {
        signal?.throwIfAborted();
        reject(new Error('Android camera saved flow read cancelled'));
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error('Android camera saved flow read cancelled'),
        );
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const remaining = Math.max(1, deadlineAtMonotonicMs - performance.now());
    timer = setTimeout(
      () => reject(new Error('Android camera saved flow read deadline expired')),
      remaining,
    );
  });
  try {
    const result = await Promise.race([
      descriptor.read(buffer, offset, length, position),
      cancellation,
    ]);
    requireLifecycle(signal, deadlineAtMonotonicMs, 'Android camera saved flow read');
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

async function readSavedFlowBytes(options: {
  root: string;
  absolute: string;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<Buffer> {
  const label = 'Android camera saved flow';
  requireLifecycle(options.signal, options.deadlineAtMonotonicMs, label);
  const ancestorsBefore = await snapshotSavedFlowAncestors(options.root, options.absolute, label);
  const pathBefore = requireSavedFlowFile(await lstat(options.absolute), label);
  requireLifecycle(options.signal, options.deadlineAtMonotonicMs, label);
  const descriptor = await open(options.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorBefore = requireSavedFlowFile(await descriptor.stat(), `${label} descriptor`);
    assert(
      sameIdentity(pathBefore, descriptorBefore),
      `${label} descriptor identity changed before read`,
    );
    const targetBytes = Math.min(MAX_SAVED_FLOW_BYTES + 1, descriptorBefore.size + 1);
    const bytes = Buffer.allocUnsafe(targetBytes);
    let offset = 0;
    while (offset < targetBytes) {
      const result = await readSavedFlowChunk(
        descriptor,
        bytes,
        offset,
        Math.min(SAVED_FLOW_READ_CHUNK_BYTES, targetBytes - offset),
        offset,
        options.signal,
        options.deadlineAtMonotonicMs,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    requireLifecycle(options.signal, options.deadlineAtMonotonicMs, label);
    const descriptorAfter = requireSavedFlowFile(await descriptor.stat(), `${label} descriptor`);
    const pathAfter = requireSavedFlowFile(await lstat(options.absolute), label);
    const ancestorsAfter = await snapshotSavedFlowAncestors(options.root, options.absolute, label);
    assert(
      sameIdentity(descriptorBefore, descriptorAfter),
      `${label} descriptor identity changed while reading`,
    );
    assert(
      sameIdentity(descriptorBefore, pathAfter),
      `${label} path identity changed while reading`,
    );
    requireSameAncestors(ancestorsBefore, ancestorsAfter, label);
    assert.equal(
      await realpath(options.absolute),
      options.absolute,
      `${label} path changed while reading`,
    );
    assert.equal(offset, descriptorAfter.size, `${label} byte count changed while reading`);
    assert(offset <= MAX_SAVED_FLOW_BYTES, `${label} exceeds its bounded size`);
    return bytes.subarray(0, offset);
  } finally {
    await descriptor.close();
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  return value as Record<string, unknown>;
}

function oneCommand(value: unknown, index: number): Record<string, unknown> {
  const command = record(value, `Android camera saved flow command ${index}`);
  const keys = Object.keys(command);
  assert.equal(keys.length, 1, `Android camera saved flow command ${index} has multiple kinds`);
  return command;
}

function commandBody(
  commands: readonly Command[],
  index: number,
  kind: string,
): Record<string, unknown> {
  const command = oneCommand(commands[index], index);
  assert.equal(
    Object.keys(command)[0],
    kind,
    `Android camera saved flow command ${index} is not ${kind}`,
  );
  return record(command[kind], `Android camera saved flow command ${index} body`);
}

function visibleId(commands: readonly Command[], index: number, kind: string): string {
  const body = commandBody(commands, index, kind);
  const visible = record(body.visible, `Android camera saved flow command ${index} visible`);
  assert.equal(body.timeout, 90000, `Android camera saved flow command ${index} timeout changed`);
  const id = visible.id;
  assert(typeof id === 'string', `Android camera saved flow command ${index} selector is missing`);
  return id;
}

function assertId(
  commands: readonly Command[],
  index: number,
  kind: string,
  expected: string,
): void {
  const body = commandBody(commands, index, kind);
  assert.equal(body.id, expected, `Android camera saved flow command ${index} selector changed`);
}

function assertNoEscapeCommands(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoEscapeCommands(child, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assert(
      ![
        'runFlow',
        'runScript',
        'point',
        'index',
        'openLink',
        'startRecording',
        'stopRecording',
      ].includes(key),
      `${label} contains unsupported Maestro escape ${key}`,
    );
    assertNoEscapeCommands(child, `${label}.${key}`);
  }
}

function parseSavedFlow(rawBytes: Buffer): SavedFlowDocument {
  const text = rawBytes.toString('utf8');
  const documents = YAML.parseAllDocuments(text);
  assert.equal(documents.length, 2, 'Android camera saved flow must have two YAML documents');
  for (const [index, document] of documents.entries())
    assert.equal(
      document.errors.length,
      0,
      `Android camera saved flow document ${index} is invalid`,
    );
  const header = record(documents[0].toJS(), 'Android camera saved flow header');
  assert.deepEqual(Object.keys(header).sort(), ['appId', 'name']);
  assert.equal(header.appId, ANDROID_CAMERA_APP_ID);
  assert.equal(header.name, FLOW_NAME);
  const parsed: unknown = documents[1].toJS();
  assert(Array.isArray(parsed), 'Android camera saved flow command document is not a list');
  assert.equal(parsed.length, 15, 'Android camera saved flow command count changed');
  for (const [index, command] of parsed.entries()) {
    if (typeof command === 'string') {
      assert.equal(
        command,
        'hideKeyboard',
        `Android camera saved flow scalar ${index} is unsupported`,
      );
      continue;
    }
    oneCommand(command, index);
    assertNoEscapeCommands(command, `Android camera saved flow command ${index}`);
  }
  return { commands: parsed as Command[] };
}

function cloneCommands(commands: readonly Command[], indexes: readonly number[]): Command[] {
  return indexes.map((index) => structuredClone(commands[index]));
}

function render(commands: readonly Command[]): string {
  const result = YAML.stringify(commands);
  assert(result.trim().length > 0, 'Android camera saved flow stage is empty');
  return result.trimEnd();
}

function replaceId(command: Command, id: string): Command {
  const cloned = structuredClone(command);
  const clonedRecord = record(cloned, 'Android camera saved flow command');
  const kind = Object.keys(clonedRecord)[0];
  const body = record(clonedRecord[kind], `Android camera saved flow ${kind} body`);
  if (kind === 'tapOn' || kind === 'assertVisible') {
    body.id = id;
  } else if (kind === 'extendedWaitUntil') {
    const visible = record(body.visible, 'Android camera saved flow wait body');
    visible.id = id;
  } else if (kind === 'scrollUntilVisible') {
    const element = record(body.element, 'Android camera saved flow scroll body');
    element.id = id;
  } else {
    throw new Error(`Android camera saved flow cannot replace selector in ${kind}`);
  }
  return cloned;
}

function requireSelector(value: unknown, expected: string, label: string): asserts value is string {
  assert.equal(value, expected, `${label} is not the canonical saved-flow selector`);
}

function requireExactPromptSelector(value: string, label: string): void {
  assert(
    /^com\.(?:android\.permissioncontroller|google\.android\.permissioncontroller):id\/(?:permission_message|permission_deny_button)$/u.test(
      value,
    ),
    `${label} is not an exact supported PermissionController selector`,
  );
}

function replacePromptSelector(command: Command, selector: string): Command {
  requireExactPromptSelector(selector, 'Android camera prompt selector');
  return replaceId(command, selector);
}

export async function loadAndroidCameraSavedFlow(input: {
  repositoryRoot: string;
  selection: NativePilotSelection;
  deadlineAtMonotonicMs: number;
  signal?: AbortSignal;
}): Promise<AndroidCameraSavedFlow> {
  requireLifecycle(input.signal, input.deadlineAtMonotonicMs, 'Android camera saved flow');
  const root = await realpath(input.repositoryRoot);
  assert.equal(
    root,
    path.resolve(input.repositoryRoot),
    'Android camera saved-flow root is not canonical',
  );
  const scenario = input.selection.scenario;
  assert.equal(scenario.id, ANDROID_CAMERA_SCENARIO);
  assert.equal(scenario.flowId, 'FLW-camera-denied');
  assert.equal(scenario.fixtureRef, `owned-postgres:${ANDROID_CAMERA_SCENARIO}:fresh-attempt`);
  assert.equal(
    scenario.maestroFlow,
    FLOW_RELATIVE_PATH,
    'Android camera saved-flow declaration is missing',
  );
  const absolute = path.resolve(root, FLOW_RELATIVE_PATH);
  assert(
    absolute.startsWith(`${root}${path.sep}`),
    'Android camera saved flow escaped repository root',
  );
  const expectedRouteHash = input.selection.scenario.maestroFlowSha256;
  assert(
    typeof expectedRouteHash === 'string' && HASH.test(expectedRouteHash),
    'Android camera saved-flow declaration is missing its route revision',
  );
  const rawBytes = await readSavedFlowBytes({
    root,
    absolute,
    signal: input.signal,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
  });
  const actualRouteHash = sha256(rawBytes);
  assert.equal(
    actualRouteHash,
    expectedRouteHash,
    'Android camera saved-flow bytes do not match the declared route revision',
  );
  const parsed = parseSavedFlow(rawBytes);
  const commands = parsed.commands;
  assertId(commands, 0, 'tapOn', 'student.home.accountButton');
  requireSelector(
    visibleId(commands, 1, 'extendedWaitUntil'),
    'student.professionals.screen',
    'saved flow entry wait',
  );
  assertId(commands, 2, 'assertVisible', 'student.professionals.scanQrButton');
  assertId(commands, 3, 'tapOn', 'student.professionals.scanQrButton');
  requireSelector(
    visibleId(commands, 4, 'extendedWaitUntil'),
    SYSTEM_PERMISSION_SELECTOR_PATTERN,
    'saved flow prompt wait',
  );
  assertId(commands, 5, 'assertVisible', SYSTEM_DENY_SELECTOR_PATTERN);
  assertId(commands, 6, 'tapOn', SYSTEM_DENY_SELECTOR_PATTERN);
  requireSelector(
    visibleId(commands, 7, 'extendedWaitUntil'),
    'student.professionals.submitError',
    'saved flow denial wait',
  );
  assertId(commands, 8, 'assertVisible', 'student.professionals.codeInput');
  assertId(commands, 9, 'tapOn', 'student.professionals.codeInput');
  const inputCommand = oneCommand(commands[10], 10);
  assert.equal(inputCommand.inputText, INVITE_CODE_TOKEN);
  assertId(commands, 11, 'tapOn', 'student.professionals.connectButton');
  const scrollBody = commandBody(commands, 12, 'scrollUntilVisible');
  const element = record(scrollBody.element, 'saved flow pending element');
  assert.equal(element.id, PENDING_ID_PATTERN);
  assert.equal(scrollBody.direction, 'DOWN');
  assert.equal(scrollBody.timeout, 30000);
  assert.equal(scrollBody.centerElement, true);
  requireSelector(
    visibleId(commands, 13, 'extendedWaitUntil'),
    'student.professionals.screen',
    'saved flow pending wait',
  );
  assertId(commands, 14, 'assertVisible', PENDING_ID_PATTERN);
  requireLifecycle(input.signal, input.deadlineAtMonotonicMs, 'Android camera saved flow');
  const binding: AndroidCameraSavedFlowBinding = Object.freeze({
    path: FLOW_RELATIVE_PATH,
    sha256: actualRouteHash,
    scenarioId: ANDROID_CAMERA_SCENARIO,
    flowId: 'FLW-camera-denied',
    fixtureRef: scenario.fixtureRef,
  });
  assert.match(binding.sha256, HASH);
  const selectors = Object.freeze({
    entryHome: 'student.home.accountButton' as const,
    entryScreen: 'student.professionals.screen' as const,
    entryScan: 'student.professionals.scanQrButton' as const,
    promptMessage: SYSTEM_PERMISSION_SELECTOR_PATTERN,
    promptDeny: SYSTEM_DENY_SELECTOR_PATTERN,
    guidance: 'student.professionals.submitError' as const,
    codeInput: 'student.professionals.codeInput' as const,
    connect: 'student.professionals.connectButton' as const,
    pendingPattern: PENDING_ID_PATTERN,
  });
  return Object.freeze({
    binding,
    selectors,
    renderEntry: () => render(cloneCommands(commands, [0, 1, 2])),
    renderPrompt: () => render(cloneCommands(commands, [3, 4, 5])),
    renderDenied: (denySelector: string) =>
      render([replacePromptSelector(commands[6], denySelector)]),
    renderManual: () => render(cloneCommands(commands, [8, 9, 10])),
    renderSubmit: () => render(cloneCommands(commands, [11])),
    renderPending: (connectionId: string) => {
      assert(
        SAFE_CONNECTION_ID.test(connectionId),
        'Android camera saved-flow connection ID is invalid',
      );
      const exactId = `student.professionals.connectionPending.${connectionId}`;
      return render([
        replaceId(commands[12], exactId),
        cloneCommands(commands, [13])[0],
        replaceId(commands[14], exactId),
      ]);
    },
  });
}

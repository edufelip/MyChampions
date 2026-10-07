import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sha256Bytes } from './native-detox-camera-ios-contract';
import type {
  DetoxCameraActor,
  DetoxCameraFrame,
  DetoxCameraSourceRef,
} from './native-detox-camera-ios-contract';

const MAX_MESSAGE_BYTES = 512 * 1024;
const POLL_MS = 25;

export type DetoxCameraChildIdentity = {
  pid: number;
  pgid: number;
  startedAt: string;
};

export type DetoxCameraCommand =
  | {
      kind: 'bootstrap';
      actor: 'student';
      commandId: string;
      commandHash: string;
      child: DetoxCameraChildIdentity;
    }
  | {
      kind: 'complete-bootstrap';
      promptStatus: 'dismissed' | 'absent';
      bootstrapStageToken: string;
      promptReceiptSha256: string;
      promptCommandReceiptSha256: string;
      commandId: string;
      commandHash: string;
      child: DetoxCameraChildIdentity;
    }
  | {
      kind: 'observe';
      label: string;
      actor: DetoxCameraActor;
      semanticState: DetoxCameraFrame['semanticState'];
      viewId: string;
      commandId: string;
      commandHash: string;
      child: DetoxCameraChildIdentity;
    }
  | {
      kind: 'deny-camera';
      commandId: string;
      commandHash: string;
      child: DetoxCameraChildIdentity;
    }
  | {
      kind: 'switch-account';
      actor: DetoxCameraActor;
      commandId: string;
      commandHash: string;
      child: DetoxCameraChildIdentity;
    }
  | {
      kind: 'submit-manual';
      commandId: string;
      commandHash: string;
      child: DetoxCameraChildIdentity;
    }
  | {
      kind: 'shutdown';
      commandId: string;
      commandHash: string;
      child: DetoxCameraChildIdentity;
    };

export type DetoxCameraCommandInput = DetoxCameraCommand extends infer Command
  ? Command extends DetoxCameraCommand
    ? Omit<Command, 'commandId' | 'commandHash' | 'child'>
    : never
  : never;

export type DetoxCameraResponse = {
  schema: 'detox-ios-camera-response-v1';
  commandId: string;
  commandHash: string;
  child: DetoxCameraChildIdentity;
  ok: boolean;
  readiness?: DetoxCameraBootstrapReadiness;
  frame?: DetoxCameraFrame;
  permission?: 'denied' | 'authorized' | 'unknown';
  transportRequestIds?: number[];
  error?: { code: string; message: string };
};

/** The one child-side launch/sign-in handshake that makes the app container observable. */
export type DetoxCameraBootstrapPendingReadiness = {
  schema: 'detox-ios-camera-bootstrap-pending-v1';
  actor: 'student';
  landingId: 'student.home.screen';
  launch: 'fresh';
  /** The child has observed the signed-in landing screen before helper work. */
  authenticated: true;
  /** Camera commands remain gated while the owner resolves the native prompt. */
  cameraReady: false;
  landingObservation: {
    id: 'student.home.screen';
    source: 'detox-child';
    phase: 'bootstrap-pending';
  };
  passwordSavePrompt: {
    status: 'pending';
    stage: 'owner-remote-service-helper';
    stageToken: string;
  };
};

export type DetoxCameraBootstrapReadyReadiness = {
  schema: 'detox-ios-camera-bootstrap-ready-v1';
  actor: 'student';
  landingId: 'student.home.screen';
  launch: 'fresh';
  authenticated: true;
  cameraReady: true;
  landingObservation: {
    id: 'student.home.screen';
    source: 'detox-child';
    phase: 'bootstrap-complete';
  };
  passwordSavePrompt: {
    status: 'dismissed' | 'absent';
    source: 'owner-remote-service-helper';
    targetBundleIdentifier: 'com.apple.SafariViewService';
    promptLabel: 'Save Password?';
    dismissLabel: 'Not Now';
    stageToken: string;
    receiptSha256: string;
    commandReceiptSha256: string;
  };
};

export type DetoxCameraBootstrapReadiness =
  DetoxCameraBootstrapPendingReadiness | DetoxCameraBootstrapReadyReadiness;

export type DetoxCameraBootstrapReceipt = {
  commandId: string;
  commandHash: string;
  child: DetoxCameraChildIdentity;
  readiness: DetoxCameraBootstrapReadyReadiness;
};

export type DetoxCameraBootstrapPendingReceipt = {
  commandId: string;
  commandHash: string;
  child: DetoxCameraChildIdentity;
  readiness: DetoxCameraBootstrapPendingReadiness;
};

/** Bind producer execution to the actual owned bootstrap response; never synthesize readiness. */
export function requireDetoxCameraBootstrapReceipt(value: unknown): DetoxCameraBootstrapReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Detox camera bootstrap readiness is missing');
  const candidate = value as Partial<DetoxCameraBootstrapReceipt>;
  const commandId = candidate.commandId;
  const commandHash = candidate.commandHash;
  const child = candidate.child;
  const readiness = candidate.readiness;
  if (
    typeof commandId !== 'string' ||
    commandId.length === 0 ||
    typeof commandHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(commandHash) ||
    !child ||
    !Number.isSafeInteger(child.pid) ||
    child.pid <= 1 ||
    !Number.isSafeInteger(child.pgid) ||
    child.pgid <= 1 ||
    typeof child.startedAt !== 'string' ||
    child.startedAt.length === 0 ||
    !readiness ||
    readiness.schema !== 'detox-ios-camera-bootstrap-ready-v1' ||
    readiness.actor !== 'student' ||
    readiness.landingId !== 'student.home.screen' ||
    readiness.launch !== 'fresh' ||
    readiness.authenticated !== true ||
    readiness.cameraReady !== true ||
    readiness.landingObservation?.id !== 'student.home.screen' ||
    readiness.landingObservation.source !== 'detox-child' ||
    readiness.landingObservation.phase !== 'bootstrap-complete' ||
    !readiness.passwordSavePrompt ||
    (readiness.passwordSavePrompt.status !== 'dismissed' &&
      readiness.passwordSavePrompt.status !== 'absent') ||
    readiness.passwordSavePrompt.source !== 'owner-remote-service-helper' ||
    readiness.passwordSavePrompt.targetBundleIdentifier !== 'com.apple.SafariViewService' ||
    readiness.passwordSavePrompt.promptLabel !== 'Save Password?' ||
    readiness.passwordSavePrompt.dismissLabel !== 'Not Now' ||
    typeof readiness.passwordSavePrompt.stageToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(readiness.passwordSavePrompt.stageToken) ||
    typeof readiness.passwordSavePrompt.receiptSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(readiness.passwordSavePrompt.receiptSha256) ||
    typeof readiness.passwordSavePrompt.commandReceiptSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(readiness.passwordSavePrompt.commandReceiptSha256)
  )
    throw new Error('Detox camera bootstrap readiness is invalid');
  return {
    commandId,
    commandHash,
    child: {
      pid: child.pid,
      pgid: child.pgid,
      startedAt: child.startedAt,
    },
    readiness: {
      schema: readiness.schema,
      actor: readiness.actor,
      landingId: readiness.landingId,
      launch: readiness.launch,
      authenticated: readiness.authenticated,
      cameraReady: readiness.cameraReady,
      landingObservation: {
        id: readiness.landingObservation.id,
        source: readiness.landingObservation.source,
        phase: readiness.landingObservation.phase,
      },
      passwordSavePrompt: {
        status: readiness.passwordSavePrompt.status,
        source: readiness.passwordSavePrompt.source,
        targetBundleIdentifier: readiness.passwordSavePrompt.targetBundleIdentifier,
        promptLabel: readiness.passwordSavePrompt.promptLabel,
        dismissLabel: readiness.passwordSavePrompt.dismissLabel,
        stageToken: readiness.passwordSavePrompt.stageToken,
        receiptSha256: readiness.passwordSavePrompt.receiptSha256,
        commandReceiptSha256: readiness.passwordSavePrompt.commandReceiptSha256,
      },
    },
  };
}

export function requireDetoxCameraBootstrapPendingReceipt(
  value: unknown,
): DetoxCameraBootstrapPendingReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Detox camera bootstrap pending readiness is missing');
  const candidate = value as Partial<DetoxCameraBootstrapPendingReceipt>;
  const commandId = candidate.commandId;
  const commandHash = candidate.commandHash;
  const child = candidate.child;
  const readiness = candidate.readiness;
  if (
    typeof commandId !== 'string' ||
    commandId.length === 0 ||
    typeof commandHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(commandHash) ||
    !child ||
    !Number.isSafeInteger(child.pid) ||
    child.pid <= 1 ||
    !Number.isSafeInteger(child.pgid) ||
    child.pgid <= 1 ||
    typeof child.startedAt !== 'string' ||
    child.startedAt.length === 0 ||
    !readiness ||
    readiness.schema !== 'detox-ios-camera-bootstrap-pending-v1' ||
    readiness.actor !== 'student' ||
    readiness.landingId !== 'student.home.screen' ||
    readiness.launch !== 'fresh' ||
    readiness.authenticated !== true ||
    readiness.cameraReady !== false ||
    readiness.landingObservation?.id !== 'student.home.screen' ||
    readiness.landingObservation.source !== 'detox-child' ||
    readiness.landingObservation.phase !== 'bootstrap-pending' ||
    readiness.passwordSavePrompt?.status !== 'pending' ||
    readiness.passwordSavePrompt.stage !== 'owner-remote-service-helper' ||
    typeof readiness.passwordSavePrompt.stageToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(readiness.passwordSavePrompt.stageToken) ||
    readiness.passwordSavePrompt.stageToken !== commandHash
  )
    throw new Error('Detox camera bootstrap pending readiness is invalid');
  return {
    commandId,
    commandHash,
    child: {
      pid: child.pid,
      pgid: child.pgid,
      startedAt: child.startedAt,
    },
    readiness: {
      schema: readiness.schema,
      actor: readiness.actor,
      landingId: readiness.landingId,
      launch: readiness.launch,
      authenticated: readiness.authenticated,
      cameraReady: readiness.cameraReady,
      landingObservation: {
        id: readiness.landingObservation.id,
        source: readiness.landingObservation.source,
        phase: readiness.landingObservation.phase,
      },
      passwordSavePrompt: {
        status: readiness.passwordSavePrompt.status,
        stage: readiness.passwordSavePrompt.stage,
        stageToken: readiness.passwordSavePrompt.stageToken,
      },
    },
  };
}

export function requireDetoxCameraBootstrapPendingResponse(
  response: DetoxCameraResponse,
): DetoxCameraBootstrapPendingReceipt {
  if (!response.ok) throw new Error('Detox camera bootstrap did not publish pending stage');
  return requireDetoxCameraBootstrapPendingReceipt({
    commandId: response.commandId,
    commandHash: response.commandHash,
    child: response.child,
    readiness: response.readiness,
  });
}

export function requireDetoxCameraBootstrapResponse(
  response: DetoxCameraResponse,
): DetoxCameraBootstrapReceipt {
  if (!response.ok) throw new Error('Detox camera bootstrap did not complete');
  return requireDetoxCameraBootstrapReceipt({
    commandId: response.commandId,
    commandHash: response.commandHash,
    child: response.child,
    readiness: response.readiness,
  });
}

export type DetoxCameraIpcOptions = {
  artifactRoot: string;
  expectedChild: DetoxCameraChildIdentity;
  signal?: AbortSignal;
  deadlineAt: number;
};

function assertDeadline(deadlineAt: number, signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Detox camera IPC cancelled');
  if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt)
    throw new Error('Detox camera IPC deadline exceeded');
}

function assertWithinRoot(root: string, path: string): void {
  const relativePath = relative(resolve(root), resolve(path));
  if (relativePath.startsWith('..') || relativePath.includes('/..')) {
    throw new Error(`Detox camera IPC path escapes artifact root: ${path}`);
  }
}

async function assertRegularPrivateFile(
  path: string,
  expectedBytes?: number,
): Promise<{ bytes: number; sha256: string; mode: number }> {
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (before.mode & 0o777) !== 0o600 ||
    before.nlink !== 1
  ) {
    throw new Error(`Detox camera IPC file is not a private single-link regular file: ${path}`);
  }
  if (
    before.size > MAX_MESSAGE_BYTES ||
    (expectedBytes !== undefined && before.size !== expectedBytes)
  ) {
    throw new Error(`Detox camera IPC file exceeds its bound: ${path}`);
  }
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (
      stat.dev !== before.dev ||
      stat.ino !== before.ino ||
      stat.uid !== before.uid ||
      stat.gid !== before.gid ||
      stat.mode !== before.mode ||
      stat.nlink !== before.nlink ||
      stat.size !== before.size
    ) {
      throw new Error(`Detox camera IPC file changed before reading: ${path}`);
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await fd.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) throw new Error(`Detox camera IPC file ended early: ${path}`);
      offset += read.bytesRead;
    }
    const after = await fd.stat();
    if (
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    ) {
      throw new Error(`Detox camera IPC file changed while reading: ${path}`);
    }
    return {
      bytes: stat.size,
      sha256: sha256Bytes(bytes),
      mode: stat.mode & 0o777,
    };
  } finally {
    await fd.close();
  }
}

async function writePrivateJson(
  root: string,
  name: string,
  value: unknown,
): Promise<DetoxCameraSourceRef> {
  const path = join(root, name);
  assertWithinRoot(root, path);
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_MESSAGE_BYTES)
    throw new Error(`Detox camera IPC message too large: ${name}`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, bytes, { mode: 0o600, flag: 'wx' });
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  const metadata = await assertRegularPrivateFile(path, bytes.length);
  return {
    path,
    sha256: metadata.sha256,
    bytes: metadata.bytes,
    mode: metadata.mode,
    sourceKind: 'owned-detox-command',
  };
}

async function readPrivateJson<T>(root: string, path: string): Promise<T> {
  assertWithinRoot(root, path);
  const before = await assertRegularPrivateFile(path);
  const bytes = await readFile(path);
  if (bytes.length !== before.bytes || sha256Bytes(bytes) !== before.sha256) {
    throw new Error(`Detox camera IPC readback changed: ${path}`);
  }
  return JSON.parse(bytes.toString('utf8')) as T;
}

function commandName(commandId: string): string {
  return `detox-camera-command-${commandId}.private.json`;
}

function responseName(commandId: string): string {
  return `detox-camera-response-${commandId}.private.json`;
}

export class DetoxCameraIpcClient {
  readonly #artifactRoot: string;
  readonly #expectedChild: DetoxCameraChildIdentity;
  readonly #signal?: AbortSignal;
  readonly #deadlineAt: number;
  readonly #bootstrapGuard = createDetoxCameraBootstrapGuard();
  #sequence = 0;
  #sealed = false;

  constructor(options: DetoxCameraIpcOptions) {
    this.#artifactRoot = resolve(options.artifactRoot);
    this.#expectedChild = options.expectedChild;
    this.#signal = options.signal;
    this.#deadlineAt = options.deadlineAt;
  }

  async request(command: DetoxCameraCommandInput): Promise<DetoxCameraResponse> {
    if (this.#sealed) throw new Error('Detox camera IPC is sealed');
    if (command.kind === 'bootstrap') this.#bootstrapGuard.claim();
    assertDeadline(this.#deadlineAt, this.#signal);
    const commandId = `${String(this.#sequence++).padStart(4, '0')}-${randomUUID()}`;
    const unsigned = {
      ...command,
      commandId,
      child: this.#expectedChild,
      commandHash: undefined,
    };
    const full = {
      ...unsigned,
      commandHash: sha256Bytes(Buffer.from(JSON.stringify(unsigned))),
    } as DetoxCameraCommand;
    await writePrivateJson(this.#artifactRoot, commandName(commandId), full);
    const responsePath = join(this.#artifactRoot, responseName(commandId));
    while (Date.now() < this.#deadlineAt) {
      assertDeadline(this.#deadlineAt, this.#signal);
      try {
        const response = await readPrivateJson<DetoxCameraResponse>(
          this.#artifactRoot,
          responsePath,
        );
        if (
          response.schema !== 'detox-ios-camera-response-v1' ||
          response.commandId !== commandId ||
          response.commandHash !== full.commandHash
        ) {
          throw new Error('Detox camera IPC response identity mismatch');
        }
        if (
          response.child.pid !== this.#expectedChild.pid ||
          response.child.pgid !== this.#expectedChild.pgid ||
          response.child.startedAt !== this.#expectedChild.startedAt
        ) {
          throw new Error('Detox camera IPC response child identity mismatch');
        }
        if (!response.ok)
          throw new Error(response.error?.message ?? 'Detox camera child rejected command');
        return response;
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('ENOENT') || error.message.includes('no such file'))
        ) {
          await delay(POLL_MS);
          continue;
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await delay(POLL_MS);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Detox camera IPC response deadline exceeded');
  }

  seal(): void {
    this.#sealed = true;
  }
}

/**
 * The owner sends exactly one bootstrap command. Keep this guard separate from
 * the filesystem response protocol so a duplicate attempt is rejected before
 * it can launch another app instance or create another readiness receipt.
 */
export function createDetoxCameraBootstrapGuard(): { claim: () => void } {
  let claimed = false;
  return {
    claim() {
      if (claimed) throw new Error('Detox camera bootstrap was already requested');
      claimed = true;
    },
  };
}

import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  isDetoxConnectionPublicationPending,
  readOwnedDetoxConnectionFile,
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceStat,
} from './detox-connection-evidence';
import {
  assertDetoxSaveRetryCommand,
  assertDetoxSaveRetryResponse,
  type DetoxSaveRetryCommand,
} from './detox-save-retry-child-protocol.mjs';
import type { DetoxSaveRetryChild } from './detox-save-retry-driver';
import type { Stats } from 'node:fs';

const MAX_COMMAND_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SAVE_RETRY_FILE = /^detox-save-retry-(?:command|response|cancel)-[1-9][0-9]*\.private\.json$/;

type ActiveRequest = Readonly<{
  command: DetoxSaveRetryCommand;
  promise: Promise<unknown>;
}>;

export type DetoxSaveRetryDrainResult = Readonly<{
  status: 'verified' | 'not-verified';
  pendingCommandIds: readonly number[];
  terminalCommandIds: readonly number[];
  failures: readonly string[];
}>;

export type DetoxSaveRetryTerminalState = Readonly<{
  commandId: number;
  commandKind: DetoxSaveRetryCommand['commandKind'];
  status: 'completed' | 'cancelled' | 'failed' | 'pending';
  commandHash: string;
  responsePath: string;
  cancelPath: string;
  error?: string;
  evidenceRefs: readonly string[];
}>;

function name(kind: 'command' | 'response' | 'cancel', commandId: number): string {
  const value = `detox-save-retry-${kind}-${commandId}.private.json`;
  assert(SAVE_RETRY_FILE.test(value));
  return value;
}

function errorFor(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint')
    return error.toString();
  if (error === null) return 'null';
  if (error === undefined) return 'undefined';
  return Object.prototype.toString.call(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function observePublication(root: string, fileName: string) {
  try {
    return publicationStat(await lstat(path.join(path.resolve(root), fileName)));
  } catch {
    return undefined;
  }
}

/**
 * File IPC adapter for the already-owned Detox Jest child. It shares the
 * connection child/process/artifact root and never starts a second process.
 * Every request remains tracked until a response or an explicit bounded drain
 * settles it; closing the view before that drain is rejected by the caller.
 */
export class DetoxSaveRetryChildClient implements DetoxSaveRetryChild {
  readonly identity: DetoxSaveRetryChild['identity'];
  readonly #root: string;
  readonly #platform: 'ios' | 'android';
  readonly #signal: AbortSignal;
  readonly #deadlineAt: number;
  #closed = false;
  #draining = false;
  #cancelPublished = new Set<number>();
  #active = new Map<number, ActiveRequest>();
  #terminal = new Map<number, DetoxSaveRetryTerminalState>();

  constructor(input: {
    artifactRoot: string;
    platform: 'ios' | 'android';
    signal: AbortSignal;
    /** Caller-owned absolute monotonic deadline when available. */
    deadlineAt?: number;
    deadlineMs: number;
    expectedChild: DetoxSaveRetryChild['identity'];
  }) {
    this.#root = input.artifactRoot;
    this.#platform = input.platform;
    this.#signal = input.signal;
    this.#deadlineAt = input.deadlineAt ?? performance.now() + input.deadlineMs;
    this.identity = { ...input.expectedChild };
    assert(Number.isSafeInteger(this.identity.pid) && this.identity.pid > 1);
    assert(Number.isSafeInteger(this.identity.pgid) && this.identity.pgid > 1);
    assert(typeof this.identity.started === 'string' && this.identity.started.length > 0);
    assert(Number.isSafeInteger(input.deadlineMs) && input.deadlineMs >= 1_000);
    assert(
      Number.isFinite(this.#deadlineAt) && this.#deadlineAt > performance.now(),
      'Detox save/retry child deadline is invalid or elapsed',
    );
  }

  async #publishCancellation(command: DetoxSaveRetryCommand): Promise<void> {
    if (this.#cancelPublished.has(command.commandId)) return;
    this.#cancelPublished.add(command.commandId);
    await writeAtomicDetoxConnectionBytes(
      this.#root,
      name('cancel', command.commandId),
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'private-detox-save-retry-cancel',
          commandId: command.commandId,
          commandHash: command.commandHash,
        }) + '\n',
      ),
      16 * 1024,
    );
  }

  #setTerminal(
    command: DetoxSaveRetryCommand,
    status: DetoxSaveRetryTerminalState['status'],
    error?: unknown,
    evidenceRefs: readonly string[] = [],
  ): void {
    this.#terminal.set(command.commandId, {
      commandId: command.commandId,
      commandKind: command.commandKind,
      status,
      commandHash: command.commandHash,
      responsePath: path.join(this.#root, name('response', command.commandId)),
      cancelPath: path.join(this.#root, name('cancel', command.commandId)),
      ...(error ? { error: describeError(error) } : {}),
      evidenceRefs: [...evidenceRefs],
    });
  }

  async #runRequest(
    command: DetoxSaveRetryCommand,
    signal: AbortSignal,
    requestedDeadlineAt: number,
  ): Promise<unknown> {
    assert(Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > performance.now());
    let cancellationStarted = false;
    await writeAtomicDetoxConnectionBytes(
      this.#root,
      name('command', command.commandId),
      Buffer.from(JSON.stringify(command) + '\n'),
      MAX_COMMAND_BYTES,
    );
    const responseName = name('response', command.commandId);
    this.#setTerminal(command, 'pending');
    let evidenceRefs: readonly string[] = [];
    try {
      for (;;) {
        if (!cancellationStarted && (signal.aborted || performance.now() >= requestedDeadlineAt)) {
          cancellationStarted = true;
          await this.#publishCancellation(command);
        }
        let observedPublication: DetoxConnectionEvidenceStat | undefined;
        try {
          observedPublication = await observePublication(this.#root, responseName);
          const bytes = await readOwnedDetoxConnectionFile(
            this.#root,
            responseName,
            MAX_RESPONSE_BYTES,
            { deadlineAt: requestedDeadlineAt },
          );
          const response = assertDetoxSaveRetryResponse(
            JSON.parse(bytes.toString('utf8')) as unknown,
            command,
            this.identity,
            requestedDeadlineAt,
          );
          const responseRecord = response;
          const screenshot =
            responseRecord.actionReceipt && typeof responseRecord.actionReceipt === 'object'
              ? (responseRecord.actionReceipt as Record<string, unknown>).screenshot
              : undefined;
          evidenceRefs =
            screenshot &&
            typeof screenshot === 'object' &&
            typeof (screenshot as Record<string, unknown>).path === 'string'
              ? [(screenshot as Record<string, unknown>).path as string]
              : [];
          if (cancellationStarted && response.status !== 'cancelled')
            throw new Error('Detox save/retry child completed after cancellation');
          this.#setTerminal(
            command,
            response.status === 'cancelled' ? 'cancelled' : 'completed',
            undefined,
            evidenceRefs,
          );
          return response;
        } catch (error) {
          if (
            await isDetoxConnectionPublicationPending(this.#root, responseName, observedPublication)
          ) {
            await sleep(1);
            continue;
          }
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }
        if (performance.now() >= requestedDeadlineAt) {
          if (!cancellationStarted) {
            cancellationStarted = true;
            await this.#publishCancellation(command);
            continue;
          }
          throw errorFor(signal, 'Detox save/retry child response deadline elapsed');
        }
        await sleep(Math.min(25, Math.max(1, requestedDeadlineAt - performance.now())));
      }
    } catch (error) {
      this.#setTerminal(command, signal.aborted ? 'cancelled' : 'failed', error, evidenceRefs);
      throw error;
    }
  }

  async request(
    commandValue: DetoxSaveRetryCommand,
    options: { signal?: AbortSignal; deadlineAt?: number } = {},
  ): Promise<unknown> {
    assert(!this.#closed, 'Detox save/retry child client is closed');
    const command = assertDetoxSaveRetryCommand(commandValue);
    assert.equal(command.platform, this.#platform);
    const signal = options.signal ?? this.#signal;
    const requestedDeadlineAt = options.deadlineAt ?? this.#deadlineAt;
    if (!Number.isFinite(requestedDeadlineAt) || requestedDeadlineAt <= performance.now())
      throw new Error('Detox save/retry command deadline elapsed before request');
    if (signal.aborted) throw errorFor(signal, 'Detox save/retry request cancelled before request');
    const promise = this.#runRequest(command, signal, requestedDeadlineAt);
    this.#active.set(command.commandId, { command, promise });
    void promise.finally(() => this.#active.delete(command.commandId)).catch(() => undefined);
    return promise;
  }

  async drain(input: {
    signal?: AbortSignal;
    deadlineAt: number;
  }): Promise<DetoxSaveRetryDrainResult> {
    assert(Number.isFinite(input.deadlineAt) && input.deadlineAt > performance.now());
    this.#draining = true;
    const failures: string[] = [];
    for (const { command } of this.#active.values()) {
      try {
        await this.#publishCancellation(command);
      } catch (error) {
        failures.push(
          `cancel-${command.commandId}:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    while (this.#active.size > 0 && performance.now() < input.deadlineAt) {
      if (input.signal?.aborted && failures.length === 0)
        failures.push('cleanup drain signal aborted before child settlement');
      await sleep(Math.min(10, Math.max(1, input.deadlineAt - performance.now())));
    }
    const pendingCommandIds = [...this.#active.keys()].sort((left, right) => left - right);
    if (pendingCommandIds.length > 0) failures.push('save-retry-child-drain:deadline-exhausted');
    return {
      status: pendingCommandIds.length === 0 && failures.length === 0 ? 'verified' : 'not-verified',
      pendingCommandIds,
      terminalCommandIds: [...this.#terminal.keys()].sort((left, right) => left - right),
      failures,
    };
  }

  terminalState(): readonly DetoxSaveRetryTerminalState[] {
    return [...this.#terminal.values()].sort((left, right) => left.commandId - right.commandId);
  }

  close(): void {
    assert(this.#active.size === 0, 'Detox save/retry child client must drain before close');
    this.#closed = true;
    this.#draining = false;
  }
}

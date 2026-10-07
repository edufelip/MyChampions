import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, openSync } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import {
  isIosCredentialInteractionDiagnosticSelection,
  parseNativePilotArguments,
  type NativePilotArguments,
} from './native-pilot-contract';
import { assertPublicReceipt } from './schema-validation';
import { isRepositoryObservation, type RepositoryObservation } from './testing-repository-identity';
import type { NativeEvidenceIdentity } from './native-view-evidence';

// React Native's ambient timer types use numeric handles; this executable uses
// Node timers and can release their event-loop reference when supported.
function isUnrefTimer(timer: unknown): timer is { unref: () => unknown } {
  return (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  );
}

function unrefTimer(timer: unknown): void {
  if (isUnrefTimer(timer)) timer.unref();
}

/** Native adapters and public evidence currently use 24-character hex IDs. */
export const nativePilotRunIdPattern = /^[a-f0-9]{24}$/;

/**
 * Return the private output namespace used when no caller supplied one.
 *
 * The iOS Detox camera owner is also the cleanup inspector's canonical
 * namespace owner, so its default root must be the exact native-pilot tree.
 * Every other adapter keeps the historical attempts namespace. Explicit
 * caller roots remain caller-owned and are validated by the adapter contract.
 */
export function nativePilotDefaultOutputParent(
  repositoryRoot: string,
  selection: NativePilotArguments | undefined,
): string {
  const cameraNamespace =
    selection !== undefined &&
    selection.platform === 'ios' &&
    selection.engine === 'detox' &&
    selection.scenario === 'SCN-camera-denied-ios' &&
    selection.mode === 'integration';
  return path.join(
    path.resolve(repositoryRoot),
    cameraNamespace ? '.qa/artifacts/native-pilot' : '.qa/artifacts/native-pilot-attempts',
  );
}

export type NativePilotInvocation = {
  selection: NativePilotArguments;
  requestedRunId: string | null;
  requestedAttemptId: string | null;
  outputParent: string | null;
  /** Opt-in pre-auth email tap/input diagnostic; only the iOS Maestro camera cell accepts it. */
  credentialInteractionDiagnostic?: true;
  /** Protected reset input carried across the CLI process boundary. */
  coldResetBinding?: NativePilotColdResetBinding | null;
};

export type NativePilotColdResetBinding = {
  artifactRoot: string;
  receiptPath: string;
  receiptHash: string;
  fixtureResetId: string;
  ownerRunId: string;
  attemptId: string;
  cohortFixtureFingerprint: string;
  appStateFingerprint: string;
  fixtureStateFingerprint: string;
  sourceFingerprint: string;
  helperFingerprint: string;
  cleanupStatus: 'cleaned';
  /** Independently acquired target identity retained across the child boundary. */
  target: Record<string, unknown>;
  /** Independently acquired backend identity retained across the child boundary. */
  backend: Record<string, unknown>;
  /** Protected source receipt identity captured before the child handoff. */
  sourceIdentity: NativeEvidenceIdentity;
};

export type ResolvedNativePilotInvocation = {
  selection: NativePilotArguments;
  requestedRunId: string;
  requestedAttemptId: string;
  outputParent: string;
  outputRoot: string;
  explicitOutputParent: boolean;
  namespaceIdentity: NativePilotNamespaceIdentity;
};

export type NativePilotPathIdentity = {
  path: string;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
};

type NativePilotPathIdentityFields = Omit<NativePilotPathIdentity, 'path'>;

type NativePilotWorkerPrivateFileReceipt = {
  identity: NativePilotPathIdentityFields;
  bytes: number;
  sha256: string;
};

function isPathIdentityFields(
  value: Partial<NativePilotPathIdentityFields> | undefined,
): value is NativePilotPathIdentityFields {
  return (
    value !== undefined &&
    Number.isInteger(value.dev) &&
    Number.isInteger(value.ino) &&
    Number.isInteger(value.uid) &&
    Number.isInteger(value.gid) &&
    Number.isInteger(value.mode)
  );
}

function isWorkerPrivateFileReceipt(value: {
  identity?: Partial<NativePilotPathIdentityFields>;
  bytes?: unknown;
  sha256?: unknown;
}): value is NativePilotWorkerPrivateFileReceipt {
  return (
    isPathIdentityFields(value.identity) &&
    Number.isSafeInteger(value.bytes) &&
    (value.bytes as number) >= 0 &&
    (value.bytes as number) <= 8 * 1024 * 1024 &&
    typeof value.sha256 === 'string' &&
    hash64.test(value.sha256)
  );
}

export type NativePilotDirectoryChainIdentity = {
  path: string;
  entries: NativePilotPathIdentity[];
};

export type NativePilotNamespaceIdentity = {
  parent: NativePilotDirectoryChainIdentity;
  output: NativePilotDirectoryChainIdentity;
};

export type NativePilotPrivateFile = {
  path: string;
  identity: NativePilotPathIdentity;
};

export type NativePilotPartialOutputObservation = {
  path: string;
  status: 'present' | 'absent' | 'unavailable';
  entryType: 'directory' | 'file' | 'symlink' | 'other' | 'missing' | 'unknown';
  identity: NativePilotPathIdentity | null;
  error: { name: string; code: string | null; message: string } | null;
};

export type NativePilotRuntimeArtifactReferenceInput = {
  runtimePresent: boolean;
  runtimeExternalCleanupFailed: boolean;
  runtimeLinkPublished: boolean;
  runtimeFailurePublished: boolean;
};

/**
 * Return only references backed by a successfully published private sidecar.
 * A runtime link that failed to publish must never be implied by a later
 * receipt, while an unknown runtime may retain its separately published
 * failure sidecar. This pure decision point is shared by the runner and its
 * write-failure controls so metadata cannot outrun the durable file.
 */
export function nativePilotRuntimeArtifactReferences(
  input: NativePilotRuntimeArtifactReferenceInput,
): { recoveryRecordPath: string | null; artifacts: string[] } {
  const runtimeLink = input.runtimeLinkPublished ? 'runtime-link.private.json' : null;
  const runtimeFailure = input.runtimeFailurePublished ? 'runtime-failure.private.json' : null;
  return {
    recoveryRecordPath:
      input.runtimePresent && input.runtimeExternalCleanupFailed
        ? runtimeLink
        : !input.runtimePresent
          ? runtimeFailure
          : null,
    artifacts: [
      ...(runtimeLink ? [runtimeLink] : []),
      ...(!input.runtimePresent && runtimeFailure ? [runtimeFailure] : []),
    ],
  };
}

function boundedError(error: unknown): {
  name: string;
  code: string | null;
  message: string;
} {
  const value = error as NodeJS.ErrnoException;
  return {
    name: (error instanceof Error ? error.name : 'UnknownError').slice(0, 96),
    code: typeof value?.code === 'string' ? value.code.slice(0, 64) : null,
    message: (error instanceof Error ? error.message : 'Unknown native pilot error').slice(0, 256),
  };
}

const optionPattern =
  /^--(platform|engine|scenario|mode|run-id|attempt-id|output-parent|cold-reset-binding|credential-interaction-diagnostic)(?:=(.*))?$/;

const credentialInteractionDiagnosticOption = 'credential-interaction-diagnostic';

const coldResetBindingMaxBytes = 16 * 1024;
const hash64 = /^[a-f0-9]{64}$/u;

function requireBoundRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Native pilot cold reset binding ${label} must be an object`);
  if (JSON.stringify(value).length > 8 * 1024)
    throw new Error(`Native pilot cold reset binding ${label} exceeds the bounded size`);
  return value as Record<string, unknown>;
}

function requireSourceIdentity(value: unknown): NativeEvidenceIdentity {
  const row = requireBoundRecord(value, 'sourceIdentity');
  for (const field of [
    'dev',
    'ino',
    'uid',
    'gid',
    'mode',
    'nlink',
    'size',
    'mtimeMs',
    'ctimeMs',
  ] as const) {
    if (typeof row[field] !== 'number' || !Number.isFinite(row[field]))
      throw new Error(`Native pilot cold reset binding sourceIdentity.${field} is invalid`);
  }
  if (
    typeof row.mode !== 'number' ||
    typeof row.size !== 'number' ||
    row.nlink !== 1 ||
    (row.mode & 0o777) !== 0o600 ||
    row.size <= 0
  )
    throw new Error(
      'Native pilot cold reset binding sourceIdentity is not a single owned 0600 file',
    );
  return row as NativeEvidenceIdentity;
}

function requireOptionValue(value: string | undefined): string {
  if (!value || value.startsWith('--') || value.trim() !== value || value.includes('\0'))
    throw new Error('Native pilot argument requires one nonempty value');
  return value;
}

function requireCredentialInteractionDiagnostic(value: string | undefined): true {
  if (value !== 'true')
    throw new Error(
      'Native pilot credential interaction diagnostic must be enabled with a true flag value',
    );
  return true;
}

function requireRunId(value: string): string {
  if (!nativePilotRunIdPattern.test(value)) throw new Error('Native pilot run ID is invalid');
  return value;
}

function requireAttemptId(value: string, runId: string): string {
  if (value !== `${runId}:first`)
    throw new Error('Native pilot attempt ID must be the first attempt of its run');
  return value;
}

function requireColdResetBinding(value: string): NativePilotColdResetBinding {
  let decoded: string;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    throw new Error('Native pilot cold reset binding is not valid base64');
  }
  if (!decoded || Buffer.byteLength(decoded, 'utf8') > coldResetBindingMaxBytes)
    throw new Error('Native pilot cold reset binding exceeds the bounded size');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('Native pilot cold reset binding is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Native pilot cold reset binding must be an object');
  const row = parsed as Record<string, unknown>;
  const stringFields = [
    'artifactRoot',
    'receiptPath',
    'receiptHash',
    'fixtureResetId',
    'ownerRunId',
    'attemptId',
    'cohortFixtureFingerprint',
    'appStateFingerprint',
    'fixtureStateFingerprint',
    'sourceFingerprint',
    'helperFingerprint',
  ] as const;
  for (const field of stringFields) {
    if (typeof row[field] !== 'string' || row[field].length === 0)
      throw new Error(`Native pilot cold reset binding field ${field} is invalid`);
  }
  if (
    !hash64.test(row.receiptHash as string) ||
    !hash64.test(row.cohortFixtureFingerprint as string) ||
    !hash64.test(row.appStateFingerprint as string) ||
    !hash64.test(row.fixtureStateFingerprint as string) ||
    !hash64.test(row.sourceFingerprint as string) ||
    !hash64.test(row.helperFingerprint as string)
  )
    throw new Error('Native pilot cold reset binding contains an invalid fingerprint');
  if (row.cleanupStatus !== 'cleaned')
    throw new Error('Native pilot cold reset binding must report cleaned reset ownership');
  if (!path.isAbsolute(row.artifactRoot as string) || !path.isAbsolute(row.receiptPath as string))
    throw new Error('Native pilot cold reset binding paths must be absolute');
  const target = requireBoundRecord(row.target, 'target');
  const backend = requireBoundRecord(row.backend, 'backend');
  const sourceIdentity = requireSourceIdentity(row.sourceIdentity);
  return Object.freeze({
    artifactRoot: row.artifactRoot as string,
    receiptPath: row.receiptPath as string,
    receiptHash: row.receiptHash as string,
    fixtureResetId: row.fixtureResetId as string,
    ownerRunId: row.ownerRunId as string,
    attemptId: row.attemptId as string,
    cohortFixtureFingerprint: row.cohortFixtureFingerprint as string,
    appStateFingerprint: row.appStateFingerprint as string,
    fixtureStateFingerprint: row.fixtureStateFingerprint as string,
    sourceFingerprint: row.sourceFingerprint as string,
    helperFingerprint: row.helperFingerprint as string,
    cleanupStatus: 'cleaned',
    target: Object.freeze({ ...target }),
    backend: Object.freeze({ ...backend }),
    sourceIdentity: Object.freeze({ ...sourceIdentity }),
  });
}

/** Parse selection and optional caller identity before any output root is created. */
export function parseNativePilotInvocationArguments(
  argv: readonly string[],
): NativePilotInvocation {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === `--${credentialInteractionDiagnosticOption}`) {
      if (values.has(credentialInteractionDiagnosticOption))
        throw new Error('Invalid or duplicate native pilot argument');
      values.set(credentialInteractionDiagnosticOption, 'true');
      continue;
    }
    const match = optionPattern.exec(argv[index]);
    if (!match || values.has(match[1]))
      throw new Error('Invalid or duplicate native pilot argument');
    const value = requireOptionValue(match[2] === undefined ? argv[++index] : match[2]);
    values.set(match[1], value);
  }

  const selection = parseNativePilotArguments([
    '--platform',
    values.get('platform') ?? '',
    '--engine',
    values.get('engine') ?? '',
    '--scenario',
    values.get('scenario') ?? '',
    '--mode',
    values.get('mode') ?? '',
  ]);
  const credentialInteractionDiagnostic =
    values.get(credentialInteractionDiagnosticOption) === undefined
      ? undefined
      : requireCredentialInteractionDiagnostic(values.get(credentialInteractionDiagnosticOption));
  if (
    credentialInteractionDiagnostic === true &&
    !isIosCredentialInteractionDiagnosticSelection(selection)
  )
    throw new Error(
      'Credential interaction diagnostic requires the iOS Maestro SCN-camera-denied-ios integration selection',
    );
  const runIdValue = values.get('run-id');
  const attemptIdValue = values.get('attempt-id');
  if ((runIdValue === undefined) !== (attemptIdValue === undefined))
    throw new Error('Native pilot run and attempt IDs must be supplied together');
  const requestedRunId = runIdValue === undefined ? null : requireRunId(runIdValue);
  const requestedAttemptId =
    attemptIdValue === undefined
      ? null
      : requireAttemptId(attemptIdValue, requestedRunId as string);
  const outputParentValue = values.get('output-parent');
  if (outputParentValue !== undefined && !path.isAbsolute(outputParentValue))
    throw new Error('Native pilot output parent must be absolute');
  const coldResetBindingValue = values.get('cold-reset-binding');
  return {
    selection,
    requestedRunId,
    requestedAttemptId,
    outputParent: outputParentValue ?? null,
    ...(credentialInteractionDiagnostic === true ? { credentialInteractionDiagnostic } : {}),
    coldResetBinding:
      coldResetBindingValue === undefined ? null : requireColdResetBinding(coldResetBindingValue),
  };
}

export function encodeNativePilotColdResetBinding(binding: NativePilotColdResetBinding): string {
  const json = JSON.stringify(binding);
  if (Buffer.byteLength(json, 'utf8') > coldResetBindingMaxBytes)
    throw new Error('Native pilot cold reset binding exceeds the bounded size');
  return Buffer.from(json, 'utf8').toString('base64url');
}

export type NativePilotColdPreflight<TResetHandoff> = {
  prepared: Awaited<ReturnType<typeof createNativePilotOutputRoot>>;
  resetHandoff: TResetHandoff | null;
  nativeAcquisitionStarted: false;
};

/**
 * Prepare the runner-owned namespace before any native adapter can start.
 * The T15-specific reset handoff is injected by the real runner so this
 * generic invocation helper does not duplicate a runner or own T15 policy.
 */
export async function prepareNativePilotColdInvocation<TResetHandoff>(input: {
  invocation: ReturnType<typeof parseNativePilotInvocationArguments>;
  defaultOutputParent: string;
  signal: AbortSignal;
  deadlineAt?: number;
  handoff: (input: {
    binding: NativePilotColdResetBinding;
    prepared: Awaited<ReturnType<typeof createNativePilotOutputRoot>>;
    signal: AbortSignal;
  }) => Promise<TResetHandoff>;
  /** Publish ownership to the real runner before any injected handoff can fail. */
  onPrepared?: (prepared: Awaited<ReturnType<typeof createNativePilotOutputRoot>>) => void;
  /** Retain the child path before a post-create abort can hide it from recovery. */
  onOutputRootCreated?: (
    outputRoot: string,
    namespaceIdentity?: NativePilotNamespaceIdentity,
  ) => void;
  /** Retain the verified namespace identity before the handoff returns. */
  onOutputRootReady?: (prepared: Awaited<ReturnType<typeof createNativePilotOutputRoot>>) => void;
}): Promise<NativePilotColdPreflight<TResetHandoff>> {
  const prepared = await createNativePilotOutputRoot({
    invocation: input.invocation,
    defaultOutputParent: input.defaultOutputParent,
    signal: input.signal,
    deadlineAt: input.deadlineAt,
    onOutputRootCreated: input.onOutputRootCreated,
    onOutputRootReady: input.onOutputRootReady,
  });
  input.onPrepared?.(prepared);
  if (!input.invocation.coldResetBinding)
    return { prepared, resetHandoff: null, nativeAcquisitionStarted: false };
  checkAbort(input.signal);
  const resetHandoff = await input.handoff({
    binding: input.invocation.coldResetBinding,
    prepared,
    signal: input.signal,
  });
  checkAbort(input.signal);
  return { prepared, resetHandoff, nativeAcquisitionStarted: false };
}

export function formatNativePilotInvocationArguments(invocation: NativePilotInvocation): string[] {
  const args = [
    `--platform=${invocation.selection.platform}`,
    `--engine=${invocation.selection.engine}`,
    `--scenario=${invocation.selection.scenario}`,
    `--mode=${invocation.selection.mode}`,
  ];
  if (invocation.requestedRunId !== null) {
    if (invocation.requestedAttemptId === null)
      throw new Error('Native pilot run and attempt IDs must be supplied together');
    args.push(`--run-id=${invocation.requestedRunId}`);
    args.push(`--attempt-id=${invocation.requestedAttemptId}`);
  }
  if (invocation.outputParent !== null) args.push(`--output-parent=${invocation.outputParent}`);
  if (invocation.credentialInteractionDiagnostic === true)
    args.push('--credential-interaction-diagnostic');
  if (invocation.coldResetBinding)
    args.push(
      `--cold-reset-binding=${encodeNativePilotColdResetBinding(invocation.coldResetBinding)}`,
    );
  return args;
}

function privateMode(mode: number): boolean {
  return (mode & 0o777) === 0o700;
}

function ownedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== 'function' || uid === process.getuid();
}

function acceptableAncestorOwner(uid: number): boolean {
  // System-owned non-writable ancestors such as /private and /var are safe
  // traversal roots; the requested private directory and child still require
  // the current user below.
  return ownedByCurrentUser(uid) || uid === 0;
}

function safeAncestorMode(mode: number): boolean {
  // Ancestors may be readable/searchable by the user account, but no other
  // account may be able to replace a child while this invocation is running.
  return (mode & 0o022) === 0;
}

function checkAbort(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function checkDeadline(deadlineAtMonotonicMs?: number): void {
  if (deadlineAtMonotonicMs === undefined) return;
  if (!Number.isFinite(deadlineAtMonotonicMs) || performance.now() >= deadlineAtMonotonicMs)
    throw new Error('Native pilot private publication deadline exceeded');
}

function checkLifecycle(signal?: AbortSignal, deadlineAtMonotonicMs?: number): void {
  checkAbort(signal);
  checkDeadline(deadlineAtMonotonicMs);
}

function pathIdentity(
  pathname: string,
  entry: { dev: number; ino: number; uid: number; gid: number; mode: number },
): NativePilotPathIdentity {
  return {
    path: pathname,
    dev: entry.dev,
    ino: entry.ino,
    uid: entry.uid,
    gid: entry.gid,
    mode: entry.mode,
  };
}

/**
 * Observe a partial output root without following or adopting it. This is
 * recovery metadata only: an unavailable lstat remains unknown and never
 * becomes an absence or cleanup claim.
 */
export async function observeNativePilotPartialOutput(
  pathname: string,
  signal?: AbortSignal,
): Promise<NativePilotPartialOutputObservation> {
  if (!path.isAbsolute(pathname))
    return {
      path: pathname,
      status: 'unavailable',
      entryType: 'unknown',
      identity: null,
      error: {
        name: 'InvalidPathError',
        code: null,
        message: 'Partial output path is not absolute',
      },
    };
  checkAbort(signal);
  try {
    const entry = await lstat(pathname);
    checkAbort(signal);
    const entryType = entry.isDirectory()
      ? 'directory'
      : entry.isFile()
        ? 'file'
        : entry.isSymbolicLink()
          ? 'symlink'
          : 'other';
    return {
      path: pathname,
      status: 'present',
      entryType,
      identity: pathIdentity(pathname, entry),
      error: null,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return {
        path: pathname,
        status: 'absent',
        entryType: 'missing',
        identity: null,
        error: null,
      };
    return {
      path: pathname,
      status: 'unavailable',
      entryType: 'unknown',
      identity: null,
      error: boundedError(error),
    };
  }
}

function samePathIdentity(
  expected: NativePilotPathIdentity,
  actual: NativePilotPathIdentity,
): boolean {
  return (
    expected.path === actual.path &&
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid &&
    expected.mode === actual.mode
  );
}

async function captureDirectoryChain(
  input: string,
  signal?: AbortSignal,
  deadlineAtMonotonicMs?: number,
): Promise<NativePilotDirectoryChainIdentity> {
  checkLifecycle(signal, deadlineAtMonotonicMs);
  if (!path.isAbsolute(input)) throw new Error('Native pilot namespace path must be absolute');
  const resolvedInput = path.resolve(input);
  const root = path.parse(resolvedInput).root;
  const components = resolvedInput.slice(root.length).split(path.sep).filter(Boolean);
  const entries: NativePilotPathIdentity[] = [];
  let current = root;
  for (const component of ['', ...components]) {
    checkLifecycle(signal, deadlineAtMonotonicMs);
    if (component) current = path.join(current, component);
    const entry = await lstat(current);
    checkLifecycle(signal, deadlineAtMonotonicMs);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error('Native pilot namespace must contain only directories');
    entries.push(pathIdentity(current, entry));
  }
  return { path: resolvedInput, entries };
}

async function assertDirectoryChainIdentity(
  expected: NativePilotDirectoryChainIdentity,
  signal?: AbortSignal,
  deadlineAtMonotonicMs?: number,
): Promise<void> {
  const actual = await captureDirectoryChain(expected.path, signal, deadlineAtMonotonicMs);
  if (
    actual.entries.length !== expected.entries.length ||
    actual.entries.some((entry, index) => !samePathIdentity(expected.entries[index], entry))
  )
    throw new Error('Native pilot namespace directory identity changed');
}

async function assertNamespaceIdentity(
  expected: NativePilotNamespaceIdentity,
  signal?: AbortSignal,
  deadlineAtMonotonicMs?: number,
): Promise<void> {
  await assertDirectoryChainIdentity(expected.parent, signal, deadlineAtMonotonicMs);
  await assertDirectoryChainIdentity(expected.output, signal, deadlineAtMonotonicMs);
}

function directChildPath(root: string, relative: string): string {
  if (
    !relative ||
    relative.includes('\0') ||
    path.isAbsolute(relative) ||
    relative.includes('/') ||
    relative.includes('\\')
  )
    throw new Error('Native pilot private file must be a direct child');
  if (relative === '.' || relative === '..')
    throw new Error('Native pilot private file name is invalid');
  const filePath = path.join(root, relative);
  if (path.dirname(filePath) !== root)
    throw new Error('Native pilot private file escaped output root');
  return filePath;
}

type AnchoredPrivateFile = {
  handle: Awaited<ReturnType<typeof open>>;
  identity: NativePilotPathIdentity;
};

function descriptorPath(fd: number): string {
  if (process.platform === 'linux') return `/proc/self/fd/${fd}`;
  if (process.platform === 'darwin' || process.platform === 'freebsd') return `/dev/fd/${fd}`;
  throw new Error('Native pilot private publication lacks a supported descriptor path');
}

/**
 * Node does not expose mkdirat/fchdir. Use one short-lived Python helper with
 * descriptor-relative open/mkdir calls. It opens every component from `/`
 * with O_NOFOLLOW, checks the requested anchor identity, and creates children
 * through the last owned descriptor; it never changes the caller's cwd or
 * resolves a replaceable ancestor again by pathname.
 */
const ANCHORED_DIRECTORY_OPERATION = String.raw`
import errno
import json
import os
import platform
import stat
import sys
import time

input_value = json.loads(sys.argv[1])
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def same(expected, actual):
    return (
        expected["dev"] == actual.st_dev
        and expected["ino"] == actual.st_ino
        and expected["uid"] == actual.st_uid
        and expected["gid"] == actual.st_gid
        and expected["mode"] == actual.st_mode
    )


def fail(message, error_number=None):
    if error_number == errno.EEXIST:
        sys.stderr.write("EEXIST: " + message)
    else:
        sys.stderr.write(message)
    raise SystemExit(1)


def open_child(parent_fd, name):
    try:
        return os.open(name, flags, dir_fd=parent_fd)
    except OSError as error:
        fail("Native pilot anchored directory open failed: " + str(error), error.errno)


anchor = input_value["anchor"]
if not isinstance(anchor, str) or not anchor.startswith("/"):
    fail("Native pilot anchored directory must be absolute")

current_fd = os.open("/", flags)
try:
    for component in anchor.split("/"):
        if not component:
            continue
        next_fd = open_child(current_fd, component)
        os.close(current_fd)
        current_fd = next_fd
    anchor_stat = os.fstat(current_fd)
    if not stat.S_ISDIR(anchor_stat.st_mode) or not same(input_value["expected"], anchor_stat):
        fail("Native pilot anchored directory identity changed before creation")
    for component in input_value["components"]:
        if not isinstance(component, str) or not component or "/" in component or "\0" in component:
            fail("Native pilot anchored child name is invalid")
        try:
            os.mkdir(component, input_value["mode"], dir_fd=current_fd)
        except FileExistsError:
            if not input_value["allowExisting"]:
                fail("Native pilot anchored child already exists", errno.EEXIST)
        except OSError as error:
            fail("Native pilot anchored directory creation failed: " + str(error), error.errno)
        created_stat = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
        sys.stdout.write(json.dumps({
            "event": "created",
            "component": component,
            "identity": {
                "dev": created_stat.st_dev,
                "ino": created_stat.st_ino,
                "uid": created_stat.st_uid,
                "gid": created_stat.st_gid,
                "mode": created_stat.st_mode,
            },
        }) + "\n")
        sys.stdout.flush()
        delay_ms = input_value.get("testDelayMs", 0)
        if isinstance(delay_ms, (int, float)) and delay_ms > 0:
            time.sleep(min(delay_ms, 5000) / 1000)
        next_fd = open_child(current_fd, component)
        child_stat = os.fstat(next_fd)
        if not stat.S_ISDIR(child_stat.st_mode):
            os.close(next_fd)
            fail("Native pilot anchored child is not a directory")
        os.close(current_fd)
        current_fd = next_fd
finally:
    os.close(current_fd)

sys.stdout.write(json.dumps({
    "pythonExecutable": os.path.realpath(sys.executable),
    "pythonVersion": platform.python_version(),
}))
`;

const ANCHORED_PRIVATE_FILE_OPERATION = String.raw`
import base64
import hashlib
import json
import os
import platform
import stat
import sys
import time

input_value = json.loads(sys.argv[1])
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def same(expected, actual):
    return (
        expected["dev"] == actual.st_dev
        and expected["ino"] == actual.st_ino
        and expected["uid"] == actual.st_uid
        and expected["gid"] == actual.st_gid
        and expected["mode"] == actual.st_mode
    )


def fail(message):
    sys.stderr.write(message)
    raise SystemExit(1)


root = input_value["root"]
if not isinstance(root, str) or not root.startswith("/"):
    fail("Native pilot private file root must be absolute")
current_fd = os.open("/", flags)
try:
    for component in root.split("/"):
        if not component:
            continue
        next_fd = os.open(component, flags, dir_fd=current_fd)
        os.close(current_fd)
        current_fd = next_fd
    root_stat = os.fstat(current_fd)
    if not stat.S_ISDIR(root_stat.st_mode) or not same(input_value["expected"], root_stat):
        fail("Native pilot private file root identity changed before publication")
    relative = input_value["relative"]
    if not isinstance(relative, str) or not relative or "/" in relative or "\\" in relative:
        fail("Native pilot private file name is invalid")
    data = base64.b64decode(input_value["contents"], validate=True)
    if len(data) > 8 * 1024 * 1024:
        fail("Native pilot private file exceeds the bounded publication size")
    replace_existing = input_value.get("replaceExisting") is True
    existing_identity = None
    temp_name = None
    temp_fd = None
    if replace_existing:
        try:
            existing_fd = os.open(relative, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=current_fd)
            existing_stat = os.fstat(existing_fd)
            existing_identity = {
                "dev": existing_stat.st_dev,
                "ino": existing_stat.st_ino,
                "uid": existing_stat.st_uid,
                "gid": existing_stat.st_gid,
                "mode": existing_stat.st_mode,
                "nlink": existing_stat.st_nlink,
                "size": existing_stat.st_size,
            }
            os.close(existing_fd)
            if (
                not stat.S_ISREG(existing_stat.st_mode)
                or existing_stat.st_uid not in (0, os.getuid())
                or existing_stat.st_nlink != 1
                or stat.S_IMODE(existing_stat.st_mode) != 0o600
            ):
                fail("Native pilot private replacement target has unsafe ownership or mode")
        except FileNotFoundError:
            fail("Native pilot private replacement target is missing")
        temp_name = f".native-pilot-rewrite-{os.getpid()}-{time.time_ns()}"
        temp_fd = os.open(
            temp_name,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=current_fd,
        )
        child_fd = temp_fd
    else:
        child_fd = os.open(
            relative,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=current_fd,
        )
    try:
        delay_ms = input_value.get("testDelayMs", 0)
        if isinstance(delay_ms, (int, float)) and delay_ms > 0:
            time.sleep(min(delay_ms, 5000) / 1000)
        view = memoryview(data)
        while view:
            written = os.write(child_fd, view)
            if written <= 0:
                fail("Native pilot private file write made no progress")
            view = view[written:]
        os.fsync(child_fd)
        post_sync_delay_ms = input_value.get("testPostSyncDelayMs", 0)
        if isinstance(post_sync_delay_ms, (int, float)) and post_sync_delay_ms > 0:
            time.sleep(min(post_sync_delay_ms, 5000) / 1000)
        child_stat = os.fstat(child_fd)
        if (
            not stat.S_ISREG(child_stat.st_mode)
            or child_stat.st_uid not in (0, os.getuid())
            or child_stat.st_nlink != 1
            or stat.S_IMODE(child_stat.st_mode) != 0o600
        ):
            fail("Native pilot private file has unsafe ownership or mode")
        os.lseek(child_fd, 0, os.SEEK_SET)
        digest = hashlib.sha256()
        read_bytes = 0
        while True:
            chunk = os.read(child_fd, 64 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            read_bytes += len(chunk)
        if read_bytes != len(data):
            fail("Native pilot private file descriptor readback size changed")
        if replace_existing:
            current_target = os.stat(relative, dir_fd=current_fd, follow_symlinks=False)
            if (
                existing_identity is None
                or current_target.st_dev != existing_identity["dev"]
                or current_target.st_ino != existing_identity["ino"]
                or current_target.st_uid != existing_identity["uid"]
                or current_target.st_gid != existing_identity["gid"]
                or current_target.st_mode != existing_identity["mode"]
                or current_target.st_nlink != existing_identity["nlink"]
                or current_target.st_size != existing_identity["size"]
            ):
                fail("Native pilot private replacement target changed before publication")
            os.replace(temp_name, relative, src_dir_fd=current_fd, dst_dir_fd=current_fd)
            temp_name = None
            child_stat = os.stat(relative, dir_fd=current_fd, follow_symlinks=False)
            if (
                not stat.S_ISREG(child_stat.st_mode)
                or child_stat.st_uid not in (0, os.getuid())
                or child_stat.st_nlink != 1
                or stat.S_IMODE(child_stat.st_mode) != 0o600
                or child_stat.st_size != len(data)
            ):
                fail("Native pilot private replacement publication is not an owned regular file")
        sys.stdout.write(json.dumps({
            "event": "private-file-written",
            "identity": {
                "dev": child_stat.st_dev,
                "ino": child_stat.st_ino,
                "uid": child_stat.st_uid,
                "gid": child_stat.st_gid,
                "mode": child_stat.st_mode,
            },
            "bytes": read_bytes,
            "sha256": digest.hexdigest(),
        }) + "\n")
        sys.stdout.flush()
    finally:
        os.close(child_fd)
        if temp_name is not None:
            try:
                os.unlink(temp_name, dir_fd=current_fd)
            except FileNotFoundError:
                pass
finally:
    os.close(current_fd)

sys.stdout.write(json.dumps({
    "pythonExecutable": os.path.realpath(sys.executable),
    "pythonVersion": platform.python_version(),
}))
`;

const ANCHORED_PRIVATE_FILE_READBACK_OPERATION = String.raw`
import hashlib
import json
import os
import platform
import stat
import sys

input_value = json.loads(sys.argv[1])
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def same(expected, actual):
    return (
        expected["dev"] == actual.st_dev
        and expected["ino"] == actual.st_ino
        and expected["uid"] == actual.st_uid
        and expected["gid"] == actual.st_gid
        and expected["mode"] == actual.st_mode
    )


def fail(message):
    sys.stderr.write(message)
    raise SystemExit(1)


root = input_value["root"]
if not isinstance(root, str) or not root.startswith("/"):
    fail("Native pilot private file readback root must be absolute")
current_fd = os.open("/", flags)
try:
    for component in root.split("/"):
        if not component:
            continue
        next_fd = os.open(component, flags, dir_fd=current_fd)
        os.close(current_fd)
        current_fd = next_fd
    root_stat = os.fstat(current_fd)
    if not stat.S_ISDIR(root_stat.st_mode) or not same(input_value["expected"], root_stat):
        fail("Native pilot private file root identity changed before readback")
    relative = input_value["relative"]
    if not isinstance(relative, str) or not relative or "/" in relative or "\\" in relative:
        fail("Native pilot private file readback name is invalid")
    child_fd = os.open(relative, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=current_fd)
    try:
        child_stat = os.fstat(child_fd)
        if (
            not stat.S_ISREG(child_stat.st_mode)
            or child_stat.st_uid not in (0, os.getuid())
            or child_stat.st_nlink != 1
            or stat.S_IMODE(child_stat.st_mode) != 0o600
            or child_stat.st_size > 8 * 1024 * 1024
        ):
            fail("Native pilot private file readback has unsafe ownership or mode")
        digest = hashlib.sha256()
        read_bytes = 0
        while True:
            chunk = os.read(child_fd, 64 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            read_bytes += len(chunk)
        if read_bytes != child_stat.st_size:
            fail("Native pilot private file readback size changed")
        sys.stdout.write(json.dumps({
            "event": "private-file-readback",
            "identity": {
                "dev": child_stat.st_dev,
                "ino": child_stat.st_ino,
                "uid": child_stat.st_uid,
                "gid": child_stat.st_gid,
                "mode": child_stat.st_mode,
            },
            "bytes": read_bytes,
            "sha256": digest.hexdigest(),
        }) + "\n")
        sys.stdout.flush()
    finally:
        os.close(child_fd)
finally:
    os.close(current_fd)

sys.stdout.write(json.dumps({
    "pythonExecutable": os.path.realpath(sys.executable),
    "pythonVersion": platform.python_version(),
}))
`;

type NativePilotDirectoryWorkerPin = {
  requestedPath: string;
  resolvedPath: string;
  sha256: string;
  uid: number;
  mode: number;
};

export type NativePilotDirectoryOperationReceipt = {
  python: NativePilotDirectoryWorkerPin;
  pythonVersion: string;
  runtimeExecutable: NativePilotDirectoryWorkerPin;
  privateFile?: NativePilotWorkerPrivateFileReceipt;
};

let nativePilotDirectoryWorkerPin: Promise<NativePilotDirectoryWorkerPin> | undefined;

async function resolveNativePilotDirectoryWorkerPin(
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<NativePilotDirectoryWorkerPin> {
  const requestedPythonPath: unknown = process.env.NATIVE_PILOT_PYTHON3_PATH;
  const requestedPath =
    process.platform === 'win32' && typeof requestedPythonPath === 'string'
      ? requestedPythonPath
      : process.platform === 'win32'
        ? 'python'
        : '/usr/bin/python3';
  if (!path.isAbsolute(requestedPath)) {
    throw new Error('Native pilot directory worker must use an absolute Python executable');
  }
  if (performance.now() >= deadlineAt)
    throw new Error('Native pilot anchored directory operation exceeded its deadline');
  const resolvedPath = await realpath(requestedPath);
  const entry = await lstat(resolvedPath);
  if (
    !entry.isFile() ||
    (entry.uid !== 0 && !ownedByCurrentUser(entry.uid)) ||
    (entry.mode & 0o022) !== 0
  )
    throw new Error('Native pilot directory worker executable has unsafe ownership or mode');
  const pinController = new AbortController();
  const onAbort = () => pinController.abort(signal?.reason ?? 'worker-pin-cancelled');
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const pinTimeout = setTimeout(
    () => pinController.abort('worker-pin-deadline'),
    Math.max(1, Math.floor(deadlineAt - performance.now())),
  );
  unrefTimer(pinTimeout);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath, { signal: pinController.signal });
  } finally {
    clearTimeout(pinTimeout);
    signal?.removeEventListener('abort', onAbort);
  }
  if (bytes.byteLength > 64 * 1024 * 1024)
    throw new Error('Native pilot directory worker executable exceeds the bounded pin size');
  if (performance.now() >= deadlineAt)
    throw new Error('Native pilot anchored directory operation exceeded its deadline');
  return {
    requestedPath,
    resolvedPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    uid: entry.uid,
    mode: entry.mode,
  };
}

function killAnchoredDirectoryWorker(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall through to the direct child if the process group was not ready.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The close event remains the source of truth for a child that already exited.
  }
}

async function runAnchoredDirectoryOperation(input: {
  anchor: string;
  components: readonly string[];
  expected: NativePilotPathIdentity;
  mode: number;
  allowExisting: boolean;
  signal?: AbortSignal;
  deadlineAt?: number;
  onComponentCreated?: (component: string, identity?: NativePilotPathIdentityFields) => void;
  operationSource?: string;
  operationPayload?: unknown;
  testDelayMs?: number;
}): Promise<NativePilotDirectoryOperationReceipt> {
  checkAbort(input.signal);
  const deadlineAt = input.deadlineAt ?? performance.now() + 30_000;
  if (performance.now() >= deadlineAt)
    throw new Error('Native pilot anchored directory operation exceeded its deadline');
  const requestedPythonPath: unknown = process.env.NATIVE_PILOT_PYTHON3_PATH;
  const python =
    process.platform === 'win32' && typeof requestedPythonPath === 'string'
      ? requestedPythonPath
      : process.platform === 'win32'
        ? 'python'
        : '/usr/bin/python3';
  const workerPin =
    nativePilotDirectoryWorkerPin ??
    (nativePilotDirectoryWorkerPin = resolveNativePilotDirectoryWorkerPin(
      deadlineAt,
      input.signal,
    ));
  let resolvedWorkerPin: NativePilotDirectoryWorkerPin;
  try {
    resolvedWorkerPin = await workerPin;
  } catch (error) {
    if (nativePilotDirectoryWorkerPin === workerPin) nativePilotDirectoryWorkerPin = undefined;
    throw error;
  }
  if (performance.now() >= deadlineAt)
    throw new Error('Native pilot anchored directory operation exceeded its deadline');
  const remaining = Math.max(1, Math.floor(deadlineAt - performance.now()));
  const defaultPayload = {
    anchor: input.anchor,
    components: input.components,
    expected: input.expected,
    mode: input.mode,
    allowExisting: input.allowExisting,
    ...(input.testDelayMs && input.testDelayMs > 0 ? { testDelayMs: input.testDelayMs } : {}),
  };
  const pathEnv = typeof process.env.PATH === 'string' ? process.env.PATH : '';
  const nodePathEnv = typeof process.env.NODE_PATH === 'string' ? process.env.NODE_PATH : '';
  const child = spawn(
    python,
    [
      '-c',
      input.operationSource ?? ANCHORED_DIRECTORY_OPERATION,
      JSON.stringify(input.operationPayload ?? defaultPayload),
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        NODE_ENV: 'test',
        PATH: pathEnv,
        NODE_PATH: nodePathEnv,
      },
    },
  );
  return await new Promise<NativePilotDirectoryOperationReceipt>((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stdoutPending = '';
    let stderr = '';
    let terminationError: Error | null = null;
    let privateFileReceipt: NativePilotWorkerPrivateFileReceipt | undefined;
    const timeoutRef: { current?: ReturnType<typeof setTimeout> } = {};
    const abortListenerRef: { current?: () => void } = {};
    const finish = (error: Error | null, receipt?: NativePilotDirectoryOperationReceipt) => {
      if (settled) return;
      settled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (abortListenerRef.current)
        input.signal?.removeEventListener('abort', abortListenerRef.current);
      if (error) reject(error);
      else resolve(receipt as NativePilotDirectoryOperationReceipt);
    };
    const terminate = (error: Error) => {
      if (terminationError || settled) return;
      terminationError = error;
      killAnchoredDirectoryWorker(child, 'SIGTERM');
      const killTimer = setTimeout(() => killAnchoredDirectoryWorker(child, 'SIGKILL'), 100);
      unrefTimer(killTimer);
      child.once('close', () => clearTimeout(killTimer));
    };
    const append = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      const next = (target === 'stdout' ? stdout : stderr) + chunk.toString('utf8');
      if (next.length > 8192) {
        terminate(new Error('Native pilot anchored directory worker output exceeded its cap'));
        return;
      }
      if (target === 'stdout') stdout = next;
      else stderr = next;
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      append(chunk, 'stdout');
      stdoutPending += chunk.toString('utf8');
      let newline = stdoutPending.indexOf('\n');
      while (newline >= 0) {
        const line = stdoutPending.slice(0, newline).trim();
        stdoutPending = stdoutPending.slice(newline + 1);
        try {
          const event = JSON.parse(line) as {
            event?: unknown;
            component?: unknown;
            identity?: Partial<NativePilotPathIdentityFields>;
            bytes?: unknown;
            sha256?: unknown;
          };
          if (event.event === 'created' && typeof event.component === 'string')
            input.onComponentCreated?.(
              event.component,
              isPathIdentityFields(event.identity) ? event.identity : undefined,
            );
          else if (
            (event.event === 'private-file-written' || event.event === 'private-file-readback') &&
            isWorkerPrivateFileReceipt(event)
          )
            privateFileReceipt = {
              identity: event.identity,
              bytes: event.bytes,
              sha256: event.sha256,
            };
        } catch {
          // The final runtime JSON is parsed at close; malformed progress is
          // rejected there rather than being treated as ownership evidence.
        }
        newline = stdoutPending.indexOf('\n');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => append(chunk, 'stderr'));
    child.once('error', (error) =>
      terminate(error instanceof Error ? error : new Error(String(error))),
    );
    child.once('close', (code, signal) => {
      void (async () => {
        if (settled) return;
        if (terminationError) {
          finish(terminationError);
          return;
        }
        if (code !== 0) {
          const detail = (stderr || stdout).trim().slice(0, 256);
          const failure = new Error(
            detail ||
              `Native pilot anchored directory worker exited ${signal ? `on ${signal}` : `with ${String(code)}`}`,
          );
          if (detail.includes('EEXIST')) (failure as NodeJS.ErrnoException).code = 'EEXIST';
          finish(failure);
          return;
        }
        let workerResult: {
          pythonExecutable?: unknown;
          pythonVersion?: unknown;
        };
        try {
          const finalLine = stdout.trim().split('\n').at(-1) ?? '';
          workerResult = JSON.parse(finalLine) as {
            pythonExecutable?: unknown;
            pythonVersion?: unknown;
          };
        } catch {
          finish(
            new Error('Native pilot anchored directory worker returned invalid runtime evidence'),
          );
          return;
        }
        if (
          typeof workerResult.pythonExecutable !== 'string' ||
          !path.isAbsolute(workerResult.pythonExecutable) ||
          typeof workerResult.pythonVersion !== 'string' ||
          workerResult.pythonVersion.length === 0
        ) {
          finish(new Error('Native pilot anchored directory worker runtime identity changed'));
          return;
        }
        try {
          const runtimePath = await realpath(workerResult.pythonExecutable);
          const runtimeEntry = await lstat(runtimePath);
          if (
            !runtimeEntry.isFile() ||
            (runtimeEntry.uid !== 0 && !ownedByCurrentUser(runtimeEntry.uid)) ||
            (runtimeEntry.mode & 0o022) !== 0
          )
            throw new Error('Native pilot directory worker runtime executable is unsafe');
          const runtimeBytes = await readFile(runtimePath);
          if (runtimeBytes.byteLength > 64 * 1024 * 1024)
            throw new Error('Native pilot directory worker runtime exceeds the bounded pin size');
          if (performance.now() >= deadlineAt)
            throw new Error('Native pilot anchored directory operation exceeded its deadline');
          finish(null, {
            python: resolvedWorkerPin,
            pythonVersion: workerResult.pythonVersion,
            runtimeExecutable: {
              requestedPath: workerResult.pythonExecutable,
              resolvedPath: runtimePath,
              sha256: createHash('sha256').update(runtimeBytes).digest('hex'),
              uid: runtimeEntry.uid,
              mode: runtimeEntry.mode,
            },
            ...(privateFileReceipt ? { privateFile: privateFileReceipt } : {}),
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
    abortListenerRef.current = () =>
      terminate(new Error('Native pilot anchored directory worker was cancelled'));
    if (input.signal?.aborted) abortListenerRef.current();
    else
      input.signal?.addEventListener('abort', abortListenerRef.current, {
        once: true,
      });
    timeoutRef.current = setTimeout(
      () => terminate(new Error('Native pilot anchored directory worker exceeded its deadline')),
      remaining,
    );
    unrefTimer(timeoutRef.current);
  });
}

function sameStatIdentity(
  expected: NativePilotPathIdentity,
  actual: { dev: number; ino: number; uid: number; gid: number; mode: number },
): boolean {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid &&
    expected.mode === actual.mode
  );
}

function samePrivateFileWorkerIdentity(
  expected: NativePilotPathIdentityFields,
  actual: NativePilotPathIdentityFields,
): boolean {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid &&
    expected.mode === actual.mode
  );
}

/**
 * Open a direct child while both the target and the caller cwd are anchored by
 * already-open directory descriptors. Node lacks openat/fchdir; descriptor
 * paths provide the same finite identity boundary on the supported POSIX hosts
 * without ever restoring through a replaceable pathname.
 */
async function openAnchoredPrivateFile(
  root: string,
  relative: string,
  namespaceIdentity: NativePilotNamespaceIdentity,
  signal?: AbortSignal,
  deadlineAtMonotonicMs?: number,
): Promise<AnchoredPrivateFile> {
  checkLifecycle(signal, deadlineAtMonotonicMs);
  if (typeof fsConstants.O_DIRECTORY !== 'number' || typeof fsConstants.O_NOFOLLOW !== 'number')
    throw new Error('Native pilot private publication cannot enforce directory anchoring');
  const resolvedRoot = path.resolve(root);
  const expectedOutput = namespaceIdentity.output.entries.at(-1);
  if (!expectedOutput || expectedOutput.path !== resolvedRoot)
    throw new Error('Native pilot output identity does not match the publication root');
  const directoryFlags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
  const childFlags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW;
  const savedCwd = process.cwd();
  const savedCwdEntry = await lstat(savedCwd);
  if (!savedCwdEntry.isDirectory()) throw new Error('Native pilot caller cwd is not a directory');
  const savedCwdIdentity = pathIdentity(savedCwd, savedCwdEntry);
  let savedCwdFd: number | undefined;
  let directoryFd: number | undefined;
  let childFd: number | undefined;
  let duplicateFd: number | undefined;
  let childDescriptor: string | undefined;
  let childIdentity: NativePilotPathIdentity | undefined;
  try {
    checkLifecycle(signal, deadlineAtMonotonicMs);
    savedCwdFd = openSync(savedCwd, directoryFlags);
    const savedCwdStat = fstatSync(savedCwdFd);
    if (!savedCwdStat.isDirectory() || !sameStatIdentity(savedCwdIdentity, savedCwdStat))
      throw new Error('Native pilot caller cwd identity changed before publication');
    const validatedDirectoryFd = openSync(resolvedRoot, directoryFlags);
    directoryFd = validatedDirectoryFd;
    const directoryStat = fstatSync(validatedDirectoryFd);
    if (!directoryStat.isDirectory() || !sameStatIdentity(expectedOutput, directoryStat))
      throw new Error('Native pilot output directory identity changed before publication');
    checkLifecycle(signal, deadlineAtMonotonicMs);
    process.chdir(descriptorPath(validatedDirectoryFd));
    const openedChildFd = openSync(relative, childFlags, 0o600);
    childFd = openedChildFd;
    const childStat = fstatSync(openedChildFd);
    if (
      !childStat.isFile() ||
      !ownedByCurrentUser(childStat.uid) ||
      childStat.nlink !== 1 ||
      (childStat.mode & 0o777) !== 0o600
    )
      throw new Error('Native pilot private file has unsafe ownership or mode');
    checkLifecycle(signal, deadlineAtMonotonicMs);
    const retainedChildFd = openSync(descriptorPath(openedChildFd), fsConstants.O_WRONLY);
    duplicateFd = retainedChildFd;
    childDescriptor = descriptorPath(retainedChildFd);
    childIdentity = pathIdentity(path.join(resolvedRoot, relative), childStat);
    closeSync(childFd);
    childFd = undefined;
  } finally {
    if (childFd !== undefined) closeSync(childFd);
    if (directoryFd !== undefined) closeSync(directoryFd);
    if (savedCwdFd !== undefined) {
      try {
        process.chdir(descriptorPath(savedCwdFd));
      } finally {
        closeSync(savedCwdFd);
      }
    }
    if (childDescriptor === undefined && duplicateFd !== undefined) closeSync(duplicateFd);
  }
  if (childDescriptor === undefined || duplicateFd === undefined || childIdentity === undefined)
    throw new Error('Native pilot private publication did not retain an opened inode');
  const retainedDuplicateFd = duplicateFd;
  try {
    checkLifecycle(signal, deadlineAtMonotonicMs);
    const handle = await open(childDescriptor, fsConstants.O_WRONLY);
    checkLifecycle(signal, deadlineAtMonotonicMs);
    closeSync(retainedDuplicateFd);
    duplicateFd = undefined;
    return { handle, identity: childIdentity };
  } catch (error) {
    closeSync(retainedDuplicateFd);
    duplicateFd = undefined;
    throw error;
  }
}

async function writeNativePilotPrivateFileWithWorker(input: {
  root: string;
  relative: string;
  bytes: Buffer;
  namespaceIdentity: NativePilotNamespaceIdentity;
  signal?: AbortSignal;
  deadlineAtMonotonicMs?: number;
  replaceExisting?: boolean;
  testDelayMs?: number;
  testPostSyncDelayMs?: number;
}): Promise<NativePilotPrivateFile> {
  const expectedOutput = input.namespaceIdentity.output.entries.at(-1);
  if (!expectedOutput) throw new Error('Native pilot output identity is missing');
  const publication = await runAnchoredDirectoryOperation({
    anchor: input.root,
    components: [],
    expected: expectedOutput,
    mode: 0o700,
    allowExisting: true,
    signal: input.signal,
    deadlineAt: input.deadlineAtMonotonicMs,
    operationSource: ANCHORED_PRIVATE_FILE_OPERATION,
    operationPayload: {
      root: path.resolve(input.root),
      relative: input.relative,
      expected: expectedOutput,
      contents: input.bytes.toString('base64'),
      ...(input.replaceExisting ? { replaceExisting: true } : {}),
      ...(input.testDelayMs && input.testDelayMs > 0 ? { testDelayMs: input.testDelayMs } : {}),
      ...(input.testPostSyncDelayMs && input.testPostSyncDelayMs > 0
        ? { testPostSyncDelayMs: input.testPostSyncDelayMs }
        : {}),
    },
  });
  const written = publication.privateFile;
  if (!written)
    throw new Error('Native pilot private file worker returned no descriptor-bound publication');
  const expectedHash = createHash('sha256').update(input.bytes).digest('hex');
  if (written.bytes !== input.bytes.byteLength || written.sha256 !== expectedHash)
    throw new Error('Native pilot private file worker publication bytes changed');
  checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
  const readback = await runAnchoredDirectoryOperation({
    anchor: input.root,
    components: [],
    expected: expectedOutput,
    mode: 0o700,
    allowExisting: true,
    signal: input.signal,
    deadlineAt: input.deadlineAtMonotonicMs,
    operationSource: ANCHORED_PRIVATE_FILE_READBACK_OPERATION,
    operationPayload: {
      root: path.resolve(input.root),
      relative: input.relative,
      expected: expectedOutput,
    },
  });
  const reread = readback.privateFile;
  if (
    !reread ||
    !samePrivateFileWorkerIdentity(written.identity, reread.identity) ||
    reread.bytes !== written.bytes ||
    reread.sha256 !== written.sha256
  )
    throw new Error('Native pilot private file inode or bytes changed before JS publication');
  checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
  await assertNamespaceIdentity(input.namespaceIdentity, input.signal, input.deadlineAtMonotonicMs);
  const filePath = directChildPath(input.root, input.relative);
  checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
  const final = await lstat(filePath);
  checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
  const identity = pathIdentity(filePath, final);
  if (
    !final.isFile() ||
    !ownedByCurrentUser(final.uid) ||
    final.nlink !== 1 ||
    (final.mode & 0o777) !== 0o600 ||
    !samePrivateFileWorkerIdentity(written.identity, identity)
  )
    throw new Error('Native pilot private file identity changed during publication');
  const finalBytes = await readFile(filePath, { signal: input.signal });
  checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
  if (
    finalBytes.byteLength !== written.bytes ||
    createHash('sha256').update(finalBytes).digest('hex') !== written.sha256
  )
    throw new Error('Native pilot private file bytes changed during publication');
  return { path: filePath, identity };
}

export async function writeNativePilotPrivateFile(input: {
  root: string;
  relative: string;
  contents: string | Uint8Array;
  namespaceIdentity: NativePilotNamespaceIdentity;
  signal?: AbortSignal;
  deadlineAtMonotonicMs?: number;
  /** Replace one already-published private file through an anchored atomic rewrite. */
  replaceExisting?: boolean;
  /** Source-only worker delay seam; production callers leave it unset. */
  testDelayMs?: number;
  /** Source-only post-fsync race seam; production callers leave it unset. */
  testPostSyncDelayMs?: number;
}): Promise<NativePilotPrivateFile> {
  checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
  const filePath = directChildPath(input.root, input.relative);
  const bytes =
    typeof input.contents === 'string' ? Buffer.from(input.contents) : Buffer.from(input.contents);
  if (bytes.byteLength > 8 * 1024 * 1024)
    throw new Error('Native pilot private file exceeds the bounded publication size');
  await assertNamespaceIdentity(input.namespaceIdentity, input.signal, input.deadlineAtMonotonicMs);
  if (
    input.replaceExisting ||
    (process.platform === 'darwin' && process.env.NATIVE_PILOT_TEST_USE_NODE_FILE_HANDLE !== '1')
  )
    return writeNativePilotPrivateFileWithWorker({ ...input, bytes });
  const anchored = await openAnchoredPrivateFile(
    input.root,
    input.relative,
    input.namespaceIdentity,
    input.signal,
    input.deadlineAtMonotonicMs,
  );
  const handle = anchored.handle;
  let openedIdentity: NativePilotPathIdentity | undefined;
  let failure: unknown;
  try {
    checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
    const opened = await handle.stat();
    checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
    if (
      !opened.isFile() ||
      !ownedByCurrentUser(opened.uid) ||
      opened.nlink !== 1 ||
      (opened.mode & 0o777) !== 0o600
    )
      throw new Error('Native pilot private file has unsafe ownership or mode');
    openedIdentity = anchored.identity;
    if (!sameStatIdentity(openedIdentity, opened))
      throw new Error('Native pilot private file inode changed before writing');
    checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
    await handle.writeFile(bytes, { signal: input.signal });
    checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
    await handle.sync();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (closeError) {
      if (!failure) throw closeError;
    }
  }
  checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
  await assertNamespaceIdentity(input.namespaceIdentity, input.signal, input.deadlineAtMonotonicMs);
  const final = await lstat(filePath);
  checkLifecycle(input.signal, input.deadlineAtMonotonicMs);
  if (
    !final.isFile() ||
    !ownedByCurrentUser(final.uid) ||
    final.nlink !== 1 ||
    (final.mode & 0o777) !== 0o600 ||
    !openedIdentity ||
    !samePathIdentity(openedIdentity, pathIdentity(filePath, final))
  )
    throw new Error('Native pilot private file identity changed during publication');
  return { path: filePath, identity: openedIdentity };
}

export type NativePilotTerminalPublication = {
  status: 'published' | 'unverified';
  receiptPath: string;
  recoveryRecordPath: string | null;
  error: { name: string; code: string | null; message: string } | null;
};

export type NativePilotOptionalPrivatePublication = {
  status: 'published' | 'unverified';
  path: string;
  error: { name: string; code: string | null; message: string } | null;
};

type NativePilotPrivateFileWriter = typeof writeNativePilotPrivateFile;

/**
 * Publish one optional private sidecar without letting a stalled filesystem
 * operation outlive the caller's bounded recovery decision. A late write is
 * deliberately ignored after the deadline wins: its bytes are never returned
 * as a verified artifact reference.
 */
export async function writeNativePilotOptionalPrivateFile(input: {
  root: string;
  relative: string;
  contents: string | Uint8Array;
  namespaceIdentity: NativePilotNamespaceIdentity;
  recoveryDeadlineMs: number;
  replaceExisting?: boolean;
  /** A narrow source-level seam for deterministic delayed-publication tests. */
  write?: NativePilotPrivateFileWriter;
}): Promise<NativePilotOptionalPrivatePublication> {
  if (
    !Number.isInteger(input.recoveryDeadlineMs) ||
    input.recoveryDeadlineMs < 1 ||
    input.recoveryDeadlineMs > 60_000
  )
    throw new Error(
      'Native pilot optional publication deadline must be an integer from 1ms through 60000ms',
    );
  const filePath = path.join(input.root, input.relative);
  const publicationController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let deadlineWon = false;
  const writeAttempt: Promise<NativePilotOptionalPrivatePublication> = Promise.resolve()
    .then(() =>
      (input.write ?? writeNativePilotPrivateFile)({
        root: input.root,
        relative: input.relative,
        contents: input.contents,
        namespaceIdentity: input.namespaceIdentity,
        replaceExisting: input.replaceExisting,
        signal: publicationController.signal,
      }),
    )
    .then(
      (): NativePilotOptionalPrivatePublication => ({
        status: 'published',
        path: filePath,
        error: null,
      }),
      (error: unknown): NativePilotOptionalPrivatePublication => ({
        status: 'unverified',
        path: filePath,
        error: boundedError(error),
      }),
    );
  const deadline = new Promise<NativePilotOptionalPrivatePublication>((resolve) => {
    timeout = setTimeout(() => {
      deadlineWon = true;
      publicationController.abort('native-pilot-optional-publication-deadline');
      resolve({
        status: 'unverified',
        path: filePath,
        error: {
          name: 'TimeoutError',
          code: 'ERR_NATIVE_PILOT_PUBLICATION_DEADLINE',
          message: 'Native pilot optional publication did not settle before its bounded deadline',
        },
      });
    }, input.recoveryDeadlineMs);
    unrefTimer(timeout);
  });
  try {
    return await Promise.race([writeAttempt, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    // The writeAttempt has an explicit rejection handler. Keep observing it
    // after a deadline so a late filesystem rejection cannot become unhandled.
    if (deadlineWon)
      void writeAttempt.then(
        () => undefined,
        () => undefined,
      );
  }
}

/**
 * Publish the terminal receipt after the decision has been made. The caller's
 * cancellation/deadline signal is deliberately observed but never controls
 * this bounded publication lane: otherwise a late signal can erase the only
 * durable terminal outcome. A publication or recovery failure remains
 * unverified and can never be reported as a passing receipt.
 */
export async function writeNativePilotTerminalReceipt(input: {
  root: string;
  receipt: unknown;
  namespaceIdentity: NativePilotNamespaceIdentity;
  callerSignal?: AbortSignal;
  recoveryDeadlineMs?: number;
  /** Used only when a protected post-publication reread invalidates the first row. */
  replaceExisting?: boolean;
}): Promise<NativePilotTerminalPublication> {
  const recoveryDeadlineMs = input.recoveryDeadlineMs ?? 30_000;
  if (
    !Number.isInteger(recoveryDeadlineMs) ||
    recoveryDeadlineMs < 1 ||
    recoveryDeadlineMs > 60_000
  )
    throw new Error(
      'Native pilot terminal publication deadline must be an integer from 1ms through 60000ms',
    );
  const receiptPath = path.join(input.root, 'receipt.json');
  const recoveryPath = path.join(input.root, 'terminal-publication-recovery.private.json');
  let publicationError: {
    name: string;
    code: string | null;
    message: string;
  } | null = null;
  const startedAt = performance.now();
  const remainingDeadline = (): number =>
    Math.max(0, recoveryDeadlineMs - (performance.now() - startedAt));
  const contents = JSON.stringify(input.receipt, null, 2) + '\n';
  const receiptPublication = await writeNativePilotOptionalPrivateFile({
    root: input.root,
    relative: 'receipt.json',
    contents,
    namespaceIdentity: input.namespaceIdentity,
    recoveryDeadlineMs,
    replaceExisting: input.replaceExisting,
  });
  if (receiptPublication.status === 'published') {
    return {
      status: 'published',
      receiptPath,
      recoveryRecordPath: null,
      error: null,
    };
  }
  publicationError = receiptPublication.error;
  const recoveryBudgetMs = Math.floor(remainingDeadline());
  if (
    publicationError &&
    publicationError.code !== 'ERR_NATIVE_PILOT_PUBLICATION_DEADLINE' &&
    recoveryBudgetMs >= 1
  ) {
    const recovery = {
      kind: 'private native pilot terminal publication recovery; not a terminal receipt',
      status: 'unverified',
      callerSignalAborted: input.callerSignal?.aborted ?? false,
      receiptPath,
      error: publicationError,
      cleanup: 'unverified',
    };
    const recoveryPublication = await writeNativePilotOptionalPrivateFile({
      root: input.root,
      relative: 'terminal-publication-recovery.private.json',
      contents: JSON.stringify(recovery, null, 2) + '\n',
      namespaceIdentity: input.namespaceIdentity,
      recoveryDeadlineMs: recoveryBudgetMs,
    });
    if (recoveryPublication.status === 'published')
      return {
        status: 'unverified',
        receiptPath,
        recoveryRecordPath: recoveryPath,
        error: publicationError,
      };
  }
  return {
    status: 'unverified',
    receiptPath,
    recoveryRecordPath: null,
    error: publicationError,
  };
}

async function assertDirectoryChain(
  input: string,
  allowCreate: boolean,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<string> {
  checkAbort(signal);
  if (!path.isAbsolute(input)) throw new Error('Native pilot output parent must be absolute');
  const resolvedInput = path.resolve(input);
  const root = path.parse(resolvedInput).root;
  const components = resolvedInput.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  let missingIndex: number | null = null;
  let anchorIdentity: NativePilotPathIdentity | null = null;
  for (let index = -1; index < components.length; index++) {
    checkAbort(signal);
    const component = index < 0 ? '' : components[index];
    if (component) current = path.join(current, component);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if (!allowCreate || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missingIndex = index < 0 ? 0 : index;
      break;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error('Native pilot output parent must not contain a symlink or non-directory');
    if (current !== resolvedInput && !acceptableAncestorOwner(entry.uid))
      throw new Error('Native pilot output parent is owned by another user');
    if (current === resolvedInput && !ownedByCurrentUser(entry.uid))
      throw new Error('Native pilot output parent is owned by another user');
    if (current !== resolvedInput && !safeAncestorMode(entry.mode))
      throw new Error('Native pilot output ancestor is writable by another account');
    if (current === resolvedInput && !privateMode(entry.mode))
      throw new Error('Native pilot output parent must be an owned private directory');
    anchorIdentity = pathIdentity(current, entry);
  }
  if (missingIndex !== null) {
    if (!anchorIdentity)
      throw new Error('Native pilot output parent has no validated creation anchor');
    checkAbort(signal);
    await runAnchoredDirectoryOperation({
      anchor: anchorIdentity.path,
      components: components.slice(missingIndex),
      expected: anchorIdentity,
      mode: 0o700,
      allowExisting: true,
      signal,
      deadlineAt,
    });
    checkAbort(signal);
    return assertDirectoryChain(resolvedInput, false, signal, deadlineAt);
  }
  checkAbort(signal);
  const canonical = await realpath(resolvedInput);
  checkAbort(signal);
  if (canonical !== resolvedInput)
    throw new Error('Native pilot output parent must not contain a symlink');
  // Revalidate the complete chain after creation and before a caller can write
  // the identity sidecar. This catches replacement races without adopting the
  // replacement path or deleting a path we do not own.
  if (allowCreate) return assertDirectoryChain(resolvedInput, false, signal, deadlineAt);
  return canonical;
}

async function requirePrivateDirectory(
  input: string,
  allowCreate: boolean,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<string> {
  return assertDirectoryChain(input, allowCreate, signal, deadlineAt);
}

/**
 * Create the run directory from the validated parent in the owned helper
 * process. Node does not expose mkdirat/fchdir; the helper performs the short
 * synchronous relative mkdir and exits, so this caller never changes or
 * restores a replaceable cwd pathname.
 */
async function createAnchoredPrivateOutputDirectory(
  parent: string,
  childName: string,
  parentNamespace: NativePilotDirectoryChainIdentity,
  signal?: AbortSignal,
  deadlineAt?: number,
  onCreated?: (childName: string, identity?: NativePilotPathIdentityFields) => void,
  testDelayMs?: number,
): Promise<void> {
  if (typeof fsConstants.O_DIRECTORY !== 'number' || typeof fsConstants.O_NOFOLLOW !== 'number')
    throw new Error('Native pilot output root creation cannot enforce directory anchoring');
  const resolvedParent = path.resolve(parent);
  const expectedParent = parentNamespace.entries.at(-1);
  if (
    !expectedParent ||
    parentNamespace.path !== resolvedParent ||
    expectedParent.path !== resolvedParent
  )
    throw new Error('Native pilot output parent identity does not match the creation parent');
  await runAnchoredDirectoryOperation({
    anchor: resolvedParent,
    components: [childName],
    expected: expectedParent,
    mode: 0o700,
    allowExisting: false,
    signal,
    deadlineAt,
    onComponentCreated: onCreated,
    testDelayMs,
  });
}

export class NativePilotOutputRootError extends Error {
  constructor(
    message: string,
    readonly outputRoot: string,
    readonly outputRootCreated: boolean,
  ) {
    super(message);
    this.name = 'NativePilotOutputRootError';
  }
}

function isOutputRootCollision(error: unknown): boolean {
  return (
    error instanceof NativePilotOutputRootError ||
    (error !== null &&
      typeof error === 'object' &&
      (error as NodeJS.ErrnoException).code === 'EEXIST')
  );
}

/** Create a never-before-used child. Existing files, directories and symlinks are rejected. */
export async function createNativePilotOutputRoot(input: {
  invocation: NativePilotInvocation;
  defaultOutputParent: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  /** Source-only fault seam; the production runner leaves this unset. */
  testWorkerDelayMs?: number;
  /** Source-only race seam; the production runner leaves this unset. */
  onOutputRootBeforeCreate?: () => void;
  /** Record the owned child before post-create identity checks can abort. */
  onOutputRootCreated?: (
    outputRoot: string,
    namespaceIdentity?: NativePilotNamespaceIdentity,
  ) => void;
  /** Retain the complete namespace identity before the handoff returns. */
  onOutputRootReady?: (prepared: ResolvedNativePilotInvocation) => void;
}): Promise<ResolvedNativePilotInvocation> {
  checkAbort(input.signal);
  const requestedRunId = input.invocation.requestedRunId ?? cryptoRandomRunId();
  const requestedAttemptId = input.invocation.requestedAttemptId ?? `${requestedRunId}:first`;
  requireRunId(requestedRunId);
  requireAttemptId(requestedAttemptId, requestedRunId);
  const explicitOutputParent = input.invocation.outputParent !== null;
  const outputParent = await requirePrivateDirectory(
    input.invocation.outputParent ?? input.defaultOutputParent,
    !explicitOutputParent,
    input.signal,
    input.deadlineAt,
  );
  const parentNamespace = await captureDirectoryChain(outputParent, input.signal);
  const outputRoot = path.join(outputParent, requestedRunId);
  checkAbort(input.signal);
  input.onOutputRootBeforeCreate?.();
  let outputRootReported = false;
  const reportOutputRoot = (identity?: NativePilotPathIdentityFields) => {
    if (outputRootReported) return;
    outputRootReported = true;
    const outputIdentity = identity ? { path: outputRoot, ...identity } : undefined;
    input.onOutputRootCreated?.(
      outputRoot,
      outputIdentity
        ? {
            parent: parentNamespace,
            output: {
              path: outputRoot,
              entries: [...parentNamespace.entries, outputIdentity],
            },
          }
        : undefined,
    );
  };
  await createAnchoredPrivateOutputDirectory(
    outputParent,
    requestedRunId,
    parentNamespace,
    input.signal,
    input.deadlineAt,
    (childName, identity) => {
      if (childName === requestedRunId) reportOutputRoot(identity);
    },
    input.testWorkerDelayMs,
  );
  reportOutputRoot();
  checkAbort(input.signal);
  try {
    await assertDirectoryChainIdentity(parentNamespace, input.signal);
  } catch (error) {
    throw new NativePilotOutputRootError(
      error instanceof Error ? error.message : 'Native pilot output parent identity changed',
      outputRoot,
      true,
    );
  }
  try {
    await requirePrivateDirectory(outputRoot, false, input.signal);
  } catch (error) {
    throw new NativePilotOutputRootError(
      error instanceof Error
        ? error.message
        : 'Native pilot output root is not a private directory',
      outputRoot,
      true,
    );
  }
  let outputNamespace: NativePilotDirectoryChainIdentity;
  try {
    outputNamespace = await captureDirectoryChain(outputRoot, input.signal);
  } catch (error) {
    throw new NativePilotOutputRootError(
      error instanceof Error ? error.message : 'Native pilot output root identity changed',
      outputRoot,
      true,
    );
  }
  const prepared = {
    selection: input.invocation.selection,
    requestedRunId,
    requestedAttemptId,
    outputParent,
    outputRoot,
    explicitOutputParent,
    namespaceIdentity: { parent: parentNamespace, output: outputNamespace },
  };
  input.onOutputRootReady?.(prepared);
  return prepared;
}

function cryptoRandomRunId(): string {
  // Kept isolated from the parser so default generation remains the existing
  // run-native-pilot random 12-byte hexadecimal identity.
  return randomBytes(12).toString('hex');
}

export type NativePilotBlockedReceipt = {
  outputRoot: string;
  receiptPath: string;
  requestedRunId: string;
  requestedAttemptId: string;
  recoveryRecordPath: string | null;
};

export type NativePilotRepositoryIdentity = {
  name: string;
  sha: string;
  dirty: boolean;
  workingTreeHash: string | null;
};

export type NativePilotRepositoryEvidence = {
  status: 'observed' | 'partial' | 'unknown';
  missing: readonly string[];
  reason: string | null;
};

export type NativePilotPreflightBlockReason =
  | 'invalid-cli-arguments'
  | 'preflight-root-resolution-failed'
  | 'preflight-output-root-failed'
  | 'preflight-identity-publication-failed'
  | 'cancelled-preflight'
  | 'native-whole-run-deadline';

export class NativePilotRecoveryDeadlineError extends Error {
  constructor(
    readonly outputRoot: string | null,
    readonly recoveryDeadlineMs: number,
    readonly unverifiedRecoveryRoot: boolean,
  ) {
    super('Native pilot blocked-receipt recovery publication exceeded its independent bound');
    this.name = 'NativePilotRecoveryDeadlineError';
  }
}

type NativePilotBlockedReceiptInput = {
  defaultOutputParent: string;
  startedAt?: string;
  partialOutputRoot?: string;
  signal?: AbortSignal;
  invocation?: NativePilotInvocation;
  reason?: NativePilotPreflightBlockReason;
  exitCode?: 2 | 130 | 143;
  deadlineAt?: number;
  partialNamespaceIdentity?: NativePilotNamespaceIdentity;
  /** Opaque observation produced by repositoryIdentity; raw rows are rejected. */
  repositoryObservation?: RepositoryObservation;
  repositories?: readonly NativePilotRepositoryIdentity[];
  repositoryEvidence?: NativePilotRepositoryEvidence;
  onPrepared?: (prepared: ResolvedNativePilotInvocation) => void;
  onOutputRootCreated?: (
    outputRoot: string,
    namespaceIdentity?: NativePilotNamespaceIdentity,
  ) => void;
};

export type NativePilotBlockedReceiptOptions = Omit<
  NativePilotBlockedReceiptInput,
  'onPrepared'
> & {
  /**
   * Observe the owned recovery child before post-create checks can abort.
   * The callback may only record identity or abort recovery; it cannot publish
   * a passing result.
   */
  onOutputRootCreated?: (
    outputRoot: string,
    namespaceIdentity?: NativePilotNamespaceIdentity,
  ) => void;
  /** A separate bounded signal used only for interrupted-preflight recovery publication. */
  recoverySignal?: AbortSignal;
  recoveryDeadlineMs?: number;
  partialNamespaceIdentity?: NativePilotNamespaceIdentity;
  repositoryObservation?: RepositoryObservation;
  repositories?: readonly NativePilotRepositoryIdentity[];
  repositoryEvidence?: NativePilotRepositoryEvidence;
};

/**
 * Publish a blocked receipt through a signal that remains available when the
 * original preflight signal has already been aborted. The recovery path never
 * converts an interrupted write into a clean or passing result.
 */
export async function writeNativePilotBlockedReceipt(
  input: NativePilotBlockedReceiptOptions,
): Promise<NativePilotBlockedReceipt> {
  const recoveryDeadlineMs = input.recoveryDeadlineMs ?? 30_000;
  if (
    !Number.isInteger(recoveryDeadlineMs) ||
    recoveryDeadlineMs < 1 ||
    recoveryDeadlineMs > 60_000
  )
    throw new Error('Native pilot recovery deadline must be an integer from 1ms through 60000ms');
  const controller = new AbortController();
  let timedOut = false;
  let recoveryAborted = false;
  let preparedOutputRoot: string | null = null;
  const onRecoveryAbort = () => {
    recoveryAborted = true;
    controller.abort(input.recoverySignal?.reason ?? 'recovery-aborted');
  };
  // Once the caller has reached blocked-receipt recovery, publication is an
  // independent bounded lane. A late caller abort must not erase the only
  // truthful blocked receipt or leave an unreported partial output root.
  if (input.recoverySignal) {
    if (input.recoverySignal.aborted) onRecoveryAbort();
    else
      input.recoverySignal.addEventListener('abort', onRecoveryAbort, {
        once: true,
      });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort('recovery-deadline');
  }, recoveryDeadlineMs);
  unrefTimer(timeout);
  try {
    return await writeNativePilotBlockedReceiptCore({
      ...input,
      signal: controller.signal,
      deadlineAt: performance.now() + recoveryDeadlineMs,
      onPrepared: (prepared) => {
        preparedOutputRoot = prepared.outputRoot;
      },
      onOutputRootCreated: (outputRoot, namespaceIdentity) => {
        preparedOutputRoot = outputRoot;
        input.onOutputRootCreated?.(outputRoot, namespaceIdentity);
      },
    });
  } catch (error) {
    if (timedOut || recoveryAborted) {
      const errorOutputRoot =
        error &&
        typeof error === 'object' &&
        'outputRoot' in error &&
        typeof (error as { outputRoot?: unknown }).outputRoot === 'string'
          ? (error as { outputRoot: string }).outputRoot
          : null;
      const outputRootCreated =
        preparedOutputRoot !== null ||
        (error instanceof NativePilotOutputRootError && error.outputRootCreated);
      throw new NativePilotRecoveryDeadlineError(
        preparedOutputRoot ?? errorOutputRoot,
        recoveryDeadlineMs,
        outputRootCreated,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    input.recoverySignal?.removeEventListener('abort', onRecoveryAbort);
  }
}

/**
 * Publish a bounded preflight receipt using only the fixed, validated default
 * parent. Caller-supplied output paths are never adopted; valid caller IDs are
 * retained only when the parser already accepted them.
 */
async function writeNativePilotBlockedReceiptCore(
  input: NativePilotBlockedReceiptInput,
): Promise<NativePilotBlockedReceipt> {
  const reason = input.reason ?? 'invalid-cli-arguments';
  const isCancelled = reason === 'cancelled-preflight';
  const repositoryObservation = input.repositoryObservation;
  if (repositoryObservation !== undefined && !isRepositoryObservation(repositoryObservation))
    throw new Error('Native pilot blocked receipt requires an opaque repository observation');
  if (
    repositoryObservation === undefined &&
    ((input.repositories?.length ?? 0) > 0 || input.repositoryEvidence !== undefined)
  )
    throw new Error('Native pilot blocked receipt rejects unbound repository rows and evidence');
  const invocation: NativePilotInvocation = input.invocation ?? {
    selection: {
      platform: 'ios',
      engine: 'maestro',
      scenario: 'SCN-invalid-selection',
      mode: 'fixture',
    },
    requestedRunId: null,
    requestedAttemptId: null,
    outputParent: null,
  };
  const fallbackInvocation: NativePilotInvocation = {
    ...invocation,
    outputParent: null,
  };
  const partialOutputObservation = input.partialOutputRoot
    ? await observeNativePilotPartialOutput(input.partialOutputRoot, input.signal)
    : null;
  let prepared: ResolvedNativePilotInvocation;
  if (
    partialOutputObservation?.status === 'present' &&
    input.partialNamespaceIdentity !== undefined
  ) {
    if (partialOutputObservation.entryType !== 'directory') {
      throw new NativePilotOutputRootError(
        'Native pilot partial output root is no longer an owned directory',
        input.partialOutputRoot as string,
        true,
      );
    }
    try {
      const outputRoot = path.resolve(input.partialOutputRoot as string);
      if (
        input.partialNamespaceIdentity &&
        input.partialNamespaceIdentity.output.path !== outputRoot
      )
        throw new Error('Native pilot partial output namespace identity does not match its path');
      const outputName = path.basename(outputRoot);
      const requestedRunId = requireRunId(outputName);
      const outputParent = path.dirname(outputRoot);
      const parentNamespace = await captureDirectoryChain(outputParent, input.signal);
      const outputNamespace = await captureDirectoryChain(outputRoot, input.signal);
      const outputIdentity = outputNamespace.entries.at(-1);
      const originalOutputIdentity = input.partialNamespaceIdentity?.output.entries.at(-1);
      if (
        input.partialNamespaceIdentity &&
        (!originalOutputIdentity ||
          !outputIdentity ||
          !samePathIdentity(originalOutputIdentity, outputIdentity))
      )
        throw new Error('Native pilot partial output namespace identity changed before recovery');
      if (
        !outputIdentity ||
        !partialOutputObservation.identity ||
        !samePathIdentity(partialOutputObservation.identity, outputIdentity)
      )
        throw new Error('Native pilot partial output root identity changed before recovery');
      prepared = {
        selection: invocation.selection,
        requestedRunId,
        requestedAttemptId: `${requestedRunId}:first`,
        outputParent,
        outputRoot,
        explicitOutputParent: false,
        namespaceIdentity: { parent: parentNamespace, output: outputNamespace },
      };
      input.onOutputRootCreated?.(outputRoot, prepared.namespaceIdentity);
    } catch (error) {
      throw new NativePilotOutputRootError(
        error instanceof Error ? error.message : 'Native pilot partial output recovery failed',
        input.partialOutputRoot as string,
        true,
      );
    }
  } else {
    try {
      prepared = await createNativePilotOutputRoot({
        invocation: fallbackInvocation,
        defaultOutputParent: input.defaultOutputParent,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        onOutputRootCreated: input.onOutputRootCreated,
      });
    } catch (error) {
      // A rejected requested ID may already have a partial or stale child at the
      // fixed fallback parent. Allocate a fresh private recovery root only when
      // no partial root from the failed owner exists; the caller's exact root is
      // handled above and is never replaced by an unrelated fallback namespace.
      if (!invocation.requestedRunId || !isOutputRootCollision(error)) throw error;
      prepared = await createNativePilotOutputRoot({
        invocation: {
          ...fallbackInvocation,
          requestedRunId: null,
          requestedAttemptId: null,
        },
        defaultOutputParent: input.defaultOutputParent,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        onOutputRootCreated: input.onOutputRootCreated,
      });
    }
  }
  input.onPrepared?.(prepared);
  const requestedIdentity =
    invocation.requestedRunId && invocation.requestedAttemptId
      ? {
          requestedRunId: invocation.requestedRunId,
          requestedAttemptId: invocation.requestedAttemptId,
        }
      : null;
  checkAbort(input.signal);
  await writeNativePilotPrivateFile({
    root: prepared.outputRoot,
    relative: 'attempt-identity.private.json',
    contents: JSON.stringify({
      kind: 'private blocked native pilot preflight identity; not passing evidence',
      requestedRunId: requestedIdentity?.requestedRunId ?? prepared.requestedRunId,
      requestedAttemptId: requestedIdentity?.requestedAttemptId ?? prepared.requestedAttemptId,
      allocatedRunId: prepared.requestedRunId,
      allocatedAttemptId: prepared.requestedAttemptId,
      outputParent: prepared.outputParent,
      outputRoot: prepared.outputRoot,
      explicitOutputParent: false,
    }),
    namespaceIdentity: prepared.namespaceIdentity,
    signal: input.signal,
  });
  checkAbort(input.signal);
  const recoveryRecordPath = input.partialOutputRoot
    ? path.join(prepared.outputRoot, 'preflight-recovery.private.json')
    : null;
  if (recoveryRecordPath) {
    await writeNativePilotPrivateFile({
      root: prepared.outputRoot,
      relative: 'preflight-recovery.private.json',
      contents: JSON.stringify({
        kind: 'private native pilot partial output recovery record; no cleanup claim',
        partialOutputWasCreated:
          partialOutputObservation?.status === 'present' &&
          input.partialNamespaceIdentity !== undefined,
        partialOutputOwnership:
          partialOutputObservation?.status === 'present'
            ? input.partialNamespaceIdentity !== undefined
              ? 'bound-to-original-namespace'
              : 'unverified-present'
            : 'unknown',
        partialOutputRoot: input.partialOutputRoot,
        partialOutputObservation,
        partialNamespaceIdentity: input.partialNamespaceIdentity ?? null,
        partialNamespaceIdentityVerified: input.partialNamespaceIdentity !== undefined,
        partialOutputPathPublished: false,
        cleanup: 'unverified',
      }),
      namespaceIdentity: prepared.namespaceIdentity,
      signal: input.signal,
    });
    checkAbort(input.signal);
  }
  const startedAt = input.startedAt ?? new Date().toISOString();
  const repositories = [...(repositoryObservation?.repositories ?? [])];
  const repositoryEvidence: NativePilotRepositoryEvidence = repositoryObservation
    ? repositoryObservation.evidence
    : {
        status: 'unknown',
        missing: ['client', 'server'],
        reason: 'repository identity was unavailable before the preflight receipt',
      };
  const receipt = {
    schemaVersion: 1,
    runId: prepared.requestedRunId,
    attemptId: prepared.requestedAttemptId,
    scenarioId: invocation.selection.scenario,
    phase: 'P4',
    layer: 'native',
    engine: invocation.selection.engine,
    dataMode: invocation.selection.mode === 'integration' ? 'postgres' : 'fixture',
    platform: invocation.selection.platform,
    locale: null,
    repositories,
    repositoryEvidence,
    target: {
      deviceId: null,
      osVersion: null,
      appId: null,
      buildProfile: null,
      binaryHash: null,
      apiOrigin: null,
    },
    inputs: {
      scenarioHash: null,
      requirementHash: null,
      fixtureHash: null,
      flagsHash: null,
      toolVersions: { node: process.version },
    },
    command: {
      executable: 'node',
      argv: [
        'scripts/testing/run-native-pilot.ts',
        ...(input.invocation
          ? formatNativePilotInvocationArguments(invocation)
          : ['<invalid-arguments>']),
      ],
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    result: isCancelled ? 'cancelled' : 'harness-blocked',
    exitCode: input.exitCode ?? (isCancelled ? 130 : 2),
    childExitCode: null,
    assertions: [],
    timingsMs: {
      build: 0,
      install: 0,
      reset: 0,
      scenario: 0,
      verify: 0,
      cleanup: 0,
    },
    cleanup: {
      status: input.partialOutputRoot ? 'failed-recovery-ledger-retained' : 'not-acquired',
      ownedResourceIds: [],
      recoveryRecordPath: recoveryRecordPath ? 'preflight-recovery.private.json' : null,
    },
    artifacts: [
      'attempt-identity.private.json',
      ...(recoveryRecordPath ? ['preflight-recovery.private.json'] : []),
    ],
    blocker: {
      code: reason,
      detail:
        reason === 'invalid-cli-arguments'
          ? 'Native pilot CLI arguments were invalid; no native or backend acquisition was attempted.'
          : reason === 'cancelled-preflight'
            ? 'Native pilot preflight was cancelled before native or backend acquisition; any partial output is retained as unverified recovery evidence.'
            : reason === 'native-whole-run-deadline'
              ? 'Native pilot preflight exceeded the whole-run bound before native acquisition; any partial output is retained as unverified recovery evidence.'
              : 'Native pilot preflight failed before native acquisition; the bounded recovery record retains the original failure boundary.',
      owner: 'client/server maintainer',
      nextAction: 'Supply the documented native pilot arguments.',
    },
  };
  assertPublicReceipt(receipt, prepared.outputRoot);
  const receiptPath = path.join(prepared.outputRoot, 'receipt.json');
  checkAbort(input.signal);
  await writeNativePilotPrivateFile({
    root: prepared.outputRoot,
    relative: 'receipt.json',
    contents: JSON.stringify(receipt, null, 2) + '\n',
    namespaceIdentity: prepared.namespaceIdentity,
    signal: input.signal,
  });
  return {
    outputRoot: prepared.outputRoot,
    receiptPath,
    requestedRunId: prepared.requestedRunId,
    requestedAttemptId: prepared.requestedAttemptId,
    recoveryRecordPath,
  };
}

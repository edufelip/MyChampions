import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { SUPPORTED_NATIVE_LOCALES, type SupportedNativeLocale } from './locale-native-observation';
import type { Dirent } from 'node:fs';

const STORAGE_KEY = 'app.language.override';
const STORAGE_DIRECTORY = 'RCTAsyncLocalStorage_V1';
const MANIFEST_NAME = 'manifest.json';
const MAX_FILE_BYTES = 64 * 1024;
const MAX_FILES = 2048;
const MAX_INVENTORY_BYTES = 8 * 1024 * 1024;
const HASH64 = /^[a-f0-9]{64}$/;
const BUNDLE_ID = 'com.edufelip.mychampions.dev';

type StorageOwnershipProfile = 'app-container' | 'qa-artifact-directory' | 'qa-artifact-file';

export type IosOwnedDirectoryReceipt = {
  path: string;
  uid: number;
  mode: number;
  canonical: true;
  symlink: false;
};

export type IosOwnedFileReceipt = {
  path: string;
  uid: number;
  mode: number;
  bytes: number;
  sha256: string;
  canonical: true;
  symlink: false;
};

export type IosLanguageStorageLayoutReceipt = {
  status: 'complete' | 'missing';
  dataRoot: IosOwnedDirectoryReceipt;
  directories: readonly IosOwnedDirectoryReceipt[];
  storageRoot: IosOwnedDirectoryReceipt | null;
};

export type IosLanguageStorageStatus = 'present' | 'absent' | 'invalid' | 'read-error';

export type IosLanguageStorageFile = {
  name: string;
  path: string;
  uid: number;
  mode: number;
  bytes: number;
  sha256: string;
};

export type IosLanguageStorageObservation = {
  status: IosLanguageStorageStatus;
  source: 'language-storage';
  value: SupportedNativeLocale | null;
  manifestHash: string | null;
  manifestFile: IosOwnedFileReceipt | null;
  keyFile: IosLanguageStorageFile | null;
  inventory: readonly IosLanguageStorageFile[];
  inventoryHash: string;
  layout: IosLanguageStorageLayoutReceipt;
  errorCode:
    'manifest-absent' | 'manifest-malformed' | 'key-file-missing' | 'key-file-malformed' | null;
};

export type IosQuiescenceProbeReceipt = {
  status: 'observed';
  captureRunId: string;
  deviceId: string;
  bundleId: typeof BUNDLE_ID;
  command: {
    label: string;
    execution: 'completed';
    cleanup: 'cleaned';
    pid: number;
    pgid: number;
    logPath: string;
    stdoutPath: string;
    stdoutBytes: number;
    stdoutSha256: string;
    bindingCaptureRunId: string;
  };
  processes: readonly { pid: number; command: string }[];
  observedAt: string;
};

export type IosQuiescenceReceipt = {
  status: 'terminated';
  captureRunId: string;
  deviceId: string;
  bundleId: typeof BUNDLE_ID;
  appRunning: false;
  observedAt: string;
  probe: IosQuiescenceProbeReceipt;
};

export type IosSnapshotFingerprint = {
  status: 'observed';
  sha256: string;
};

export type IosLanguageResetSuccessReceipt = {
  status: 'observed';
  changedFiles: readonly string[];
  quiescence: IosQuiescenceReceipt;
  before: IosLanguageStorageObservation;
  after: IosLanguageStorageObservation;
  unrelatedStoragePreserved: true;
  authBefore: IosSnapshotFingerprint;
  authAfter: IosSnapshotFingerprint;
  domainBefore: IosSnapshotFingerprint;
  domainAfter: IosSnapshotFingerprint;
};

export type IosLanguageResetFailureReceipt = {
  status: 'failed-recovery-required';
  changedFiles: readonly string[];
  quiescence: IosQuiescenceReceipt;
  before: IosLanguageStorageObservation;
  after: IosLanguageStorageObservation | null;
  unrelatedStoragePreserved: false;
  authBefore: IosSnapshotFingerprint;
  authAfter: IosSnapshotFingerprint | null;
  domainBefore: IosSnapshotFingerprint;
  domainAfter: IosSnapshotFingerprint | null;
  failure: {
    phase:
      | 'manifest-atomic-write'
      | 'key-file-unlink'
      | 'post-mutation-readback'
      | 'post-mutation-preservation';
    code: 'mutation-failed' | 'recovery-required';
    message: string;
    recoveryRequired: true;
    temporaryManifestPath: string | null;
  };
};

export type IosLanguageResetReceipt =
  IosLanguageResetSuccessReceipt | IosLanguageResetFailureReceipt;

type StorageRoot = {
  dataRoot: string;
  storageRoot: string;
  manifestPath: string;
  layout: IosLanguageStorageLayoutReceipt;
};

type Manifest = Record<string, unknown>;

function invalid(message: string): never {
  throw new Error(`Invalid iOS language storage boundary: ${message}`);
}

function isSupportedLocale(value: unknown): value is SupportedNativeLocale {
  return SUPPORTED_NATIVE_LOCALES.includes(value as SupportedNativeLocale);
}

function isSafeBasename(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    path.basename(value) === value &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    ![...value].some((character) => character < ' ' || character === '\u007f')
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function checkAbort(signal: AbortSignal | undefined, label: string): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  throw reason instanceof Error
    ? reason
    : new Error(`iOS language storage operation aborted: ${label}`);
}

function requireOwnedMode(mode: number, profile: StorageOwnershipProfile, label: string): void {
  const permissions = mode & 0o777;
  const unsafe =
    profile === 'app-container'
      ? (permissions & 0o022) !== 0
      : profile === 'qa-artifact-directory'
        ? permissions !== 0o700
        : permissions !== 0o600;
  if (unsafe) invalid(`${label} has an unsafe ${profile} mode`);
}

function hashInventory(files: readonly IosLanguageStorageFile[]): string {
  const canonical = files
    .slice()
    .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))
    .map(
      (file) =>
        `${file.name.length}:${file.name}:${file.path}:${file.uid}:${file.mode}:${file.bytes}:${file.sha256}`,
    )
    .join('\n');
  return sha256(Buffer.from(canonical, 'utf8'));
}

async function readBoundedFile(file: string, signal: AbortSignal | undefined): Promise<Buffer> {
  checkAbort(signal, `before-read:${path.basename(file)}`);
  const bytes = await readFile(file, { signal });
  checkAbort(signal, `after-read:${path.basename(file)}`);
  if (bytes.byteLength > MAX_FILE_BYTES) invalid('storage file exceeds the bounded read size');
  return bytes;
}

function decodeUtf8(bytes: Buffer, label: string): string {
  const text = bytes.toString('utf8');
  if (text.includes('\uFFFD')) invalid(`${label} is not valid UTF-8`);
  return text;
}

async function inspectOwnedDirectory(
  directory: string,
  label: string,
  profile: StorageOwnershipProfile = 'app-container',
  signal?: AbortSignal,
): Promise<IosOwnedDirectoryReceipt> {
  checkAbort(signal, `before-directory:${label}`);
  let canonical: string;
  try {
    canonical = await realpath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    invalid(`${label} cannot be resolved`);
  }
  checkAbort(signal, `after-directory-realpath:${label}`);
  const metadata = await lstat(canonical);
  checkAbort(signal, `after-directory-stat:${label}`);
  if (
    canonical !== path.resolve(directory) ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.getuid !== undefined && metadata.uid !== process.getuid())
  )
    invalid(`${label} is not a canonical owned directory`);
  requireOwnedMode(metadata.mode, profile, label);
  return {
    path: canonical,
    uid: metadata.uid,
    mode: metadata.mode & 0o777,
    canonical: true,
    symlink: false,
  };
}

/**
 * `realpath` reports ENOENT for a dangling symlink anywhere below the data
 * root. That is different from a genuinely absent layout segment: the former
 * is an unsafe path and must block observation/reset rather than become an
 * absent language override. Walk back with lstat so the distinction survives
 * the failed canonical resolution.
 */
async function assertMissingLayoutIsSafe(
  directory: string,
  dataRoot: string,
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  const root = path.resolve(dataRoot);
  let probe = path.resolve(directory);
  if (probe !== root && !probe.startsWith(`${root}${path.sep}`))
    invalid(`${label} escapes the owned data container`);
  while (probe !== root) {
    checkAbort(signal, `before-missing-layout-probe:${label}`);
    try {
      const metadata = await lstat(probe);
      if (metadata.isSymbolicLink()) invalid(`${label} has a dangling symlink layout segment`);
      if (!metadata.isDirectory()) invalid(`${label} has a non-directory layout segment`);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      probe = path.dirname(probe);
    }
  }
}

async function assertOwnedFile(
  file: string,
  parentUid: number | undefined,
  signal?: AbortSignal,
): Promise<{
  path: string;
  metadata: Awaited<ReturnType<typeof lstat>>;
  receipt: IosOwnedFileReceipt;
}> {
  checkAbort(signal, `before-file:${path.basename(file)}`);
  if (!isSafeBasename(path.basename(file))) invalid('storage file name is unsafe');
  const canonical = await realpath(file);
  checkAbort(signal, `after-file-realpath:${path.basename(file)}`);
  const metadata = await lstat(file);
  checkAbort(signal, `after-file-stat:${path.basename(file)}`);
  if (
    canonical !== path.resolve(file) ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (parentUid !== undefined && metadata.uid !== parentUid) ||
    metadata.size > MAX_FILE_BYTES
  )
    invalid('storage file is not a bounded owned regular file');
  requireOwnedMode(metadata.mode, 'app-container', 'storage file');
  return {
    path: canonical,
    metadata,
    receipt: {
      path: canonical,
      uid: metadata.uid,
      mode: metadata.mode & 0o777,
      bytes: metadata.size,
      sha256: '',
      canonical: true,
      symlink: false,
    },
  };
}

async function resolveStorageRoot(
  dataRoot: string,
  bundleId: string,
  signal?: AbortSignal,
): Promise<StorageRoot> {
  if (bundleId !== BUNDLE_ID) invalid('only the dev app bundle is eligible');
  const rootReceipt = await inspectOwnedDirectory(
    dataRoot,
    'data container',
    'app-container',
    signal,
  );
  const directories = [rootReceipt];
  let current = rootReceipt.path;
  const segments = [
    ['Library', 'Library'],
    ['Application Support', 'Application Support'],
    [bundleId, 'app bundle directory'],
    [STORAGE_DIRECTORY, 'AsyncStorage root'],
  ] as const;
  let storageReceipt: IosOwnedDirectoryReceipt | null = null;
  for (const [segment, label] of segments) {
    checkAbort(signal, `before-layout:${label}`);
    current = path.join(current, segment);
    try {
      const receipt = await inspectOwnedDirectory(current, label, 'app-container', signal);
      directories.push(receipt);
      if (segment === STORAGE_DIRECTORY) storageReceipt = receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Only a genuinely absent segment is a valid absent override. A
      // dangling symlink or non-directory ancestor is unsafe and blocks.
      await assertMissingLayoutIsSafe(current, dataRoot, label, signal);
      break;
    }
  }
  const canonicalStorage = storageReceipt?.path ?? path.resolve(current);
  return {
    dataRoot: rootReceipt.path,
    storageRoot: canonicalStorage,
    manifestPath: path.join(canonicalStorage, MANIFEST_NAME),
    layout: {
      status: storageReceipt ? 'complete' : 'missing',
      dataRoot: rootReceipt,
      directories,
      storageRoot: storageReceipt,
    },
  };
}

async function readManifest(
  root: StorageRoot,
  signal?: AbortSignal,
): Promise<{
  manifest: Manifest | null;
  bytes: Buffer | null;
  file: IosOwnedFileReceipt | null;
  errorCode: IosLanguageStorageObservation['errorCode'];
}> {
  let owned: Awaited<ReturnType<typeof assertOwnedFile>>;
  try {
    owned = await assertOwnedFile(root.manifestPath, process.getuid?.(), signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { manifest: null, bytes: null, file: null, errorCode: 'manifest-absent' };
    throw error;
  }
  const bytes = await readBoundedFile(owned.path, signal);
  const file = { ...owned.receipt, sha256: sha256(bytes), bytes: bytes.byteLength };
  const text = decodeUtf8(bytes, 'language manifest');
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return { manifest: null, bytes, file, errorCode: 'manifest-malformed' };
    return { manifest: value as Manifest, bytes, file, errorCode: null };
  } catch {
    return { manifest: null, bytes, file, errorCode: 'manifest-malformed' };
  }
}

async function inventory(
  root: StorageRoot,
  signal?: AbortSignal,
): Promise<IosLanguageStorageFile[]> {
  checkAbort(signal, 'before-storage-inventory');
  let entries: Dirent[];
  try {
    entries = await readdir(root.storageRoot, { withFileTypes: true, encoding: 'utf8' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  checkAbort(signal, 'after-storage-inventory');
  if (entries.length > MAX_FILES) invalid('AsyncStorage file count exceeds bound');
  const parent = await lstat(root.storageRoot);
  checkAbort(signal, 'after-storage-inventory-parent-stat');
  const files: IosLanguageStorageFile[] = [];
  let aggregateBytes = 0;
  for (const entry of entries) {
    checkAbort(signal, `before-storage-entry:${entry.name}`);
    if (!isSafeBasename(entry.name)) invalid('AsyncStorage entry name is unsafe');
    if (!entry.isFile() || entry.isSymbolicLink())
      invalid('AsyncStorage contains a non-file entry');
    const owned = await assertOwnedFile(
      path.join(root.storageRoot, entry.name),
      parent.uid,
      signal,
    );
    const bytes = await readBoundedFile(owned.path, signal);
    aggregateBytes += bytes.byteLength;
    if (aggregateBytes > MAX_INVENTORY_BYTES)
      invalid('AsyncStorage inventory exceeds the aggregate bounded read size');
    checkAbort(signal, `after-storage-entry:${entry.name}`);
    files.push({
      name: entry.name,
      path: owned.path,
      uid: owned.receipt.uid,
      mode: owned.receipt.mode,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

async function keyFileForManifestValue(
  root: StorageRoot,
  value: unknown,
  signal?: AbortSignal,
): Promise<{
  value: string | null;
  keyFile: IosLanguageStorageFile | null;
  errorCode: IosLanguageStorageObservation['errorCode'];
}> {
  if (value === null) {
    const name = createHash('md5').update(STORAGE_KEY).digest('hex');
    const file = path.join(root.storageRoot, name);
    let owned: Awaited<ReturnType<typeof assertOwnedFile>>;
    try {
      owned = await assertOwnedFile(file, process.getuid?.(), signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { value: null, keyFile: null, errorCode: 'key-file-missing' };
      throw error;
    }
    const bytes = await readBoundedFile(owned.path, signal);
    const keyFile = {
      name,
      path: owned.path,
      uid: owned.receipt.uid,
      mode: owned.receipt.mode,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
    return { value: decodeUtf8(bytes, 'language key file'), keyFile, errorCode: null };
  }
  if (typeof value === 'string') return { value, keyFile: null, errorCode: null };
  return { value: null, keyFile: null, errorCode: 'key-file-malformed' };
}

function projectObservation(input: {
  status: IosLanguageStorageStatus;
  manifestBytes: Buffer | null;
  manifestFile: IosOwnedFileReceipt | null;
  keyFile: IosLanguageStorageFile | null;
  inventory: readonly IosLanguageStorageFile[];
  layout: IosLanguageStorageLayoutReceipt;
  errorCode: IosLanguageStorageObservation['errorCode'];
  value: string | null;
}): IosLanguageStorageObservation {
  const status = input.status;
  const value = isSupportedLocale(input.value) && status === 'present' ? input.value : null;
  return {
    status,
    source: 'language-storage',
    value,
    manifestHash: input.manifestBytes ? sha256(input.manifestBytes) : null,
    manifestFile: input.manifestFile,
    keyFile: input.keyFile,
    inventory: input.inventory,
    inventoryHash: hashInventory(input.inventory),
    layout: input.layout,
    errorCode: input.errorCode,
  };
}

/** Read only the redacted language override from the app-owned iOS container. */
export async function readIosLanguageOverride(
  dataRoot: string,
  bundleId = BUNDLE_ID,
  signal?: AbortSignal,
) {
  checkAbort(signal, 'before-language-override-read');
  const root = await resolveStorageRoot(dataRoot, bundleId, signal);
  const files = await inventory(root, signal);
  const parsed = await readManifest(root, signal);
  if (parsed.manifest === null) {
    return projectObservation({
      status: parsed.errorCode === 'manifest-absent' ? 'absent' : 'read-error',
      manifestBytes: parsed.bytes,
      manifestFile: parsed.file,
      keyFile: null,
      inventory: files,
      layout: root.layout,
      errorCode: parsed.errorCode,
      value: null,
    });
  }
  if (!Object.hasOwn(parsed.manifest, STORAGE_KEY))
    return projectObservation({
      status: 'absent',
      manifestBytes: parsed.bytes,
      manifestFile: parsed.file,
      keyFile: null,
      inventory: files,
      layout: root.layout,
      errorCode: null,
      value: null,
    });
  const key = await keyFileForManifestValue(root, parsed.manifest[STORAGE_KEY], signal);
  if (key.errorCode !== null)
    return projectObservation({
      status: 'read-error',
      manifestBytes: parsed.bytes,
      manifestFile: parsed.file,
      keyFile: key.keyFile,
      inventory: files,
      layout: root.layout,
      errorCode: key.errorCode,
      value: null,
    });
  return projectObservation({
    status: isSupportedLocale(key.value) ? 'present' : 'invalid',
    manifestBytes: parsed.bytes,
    manifestFile: parsed.file,
    keyFile: key.keyFile,
    inventory: files,
    layout: root.layout,
    errorCode: null,
    value: key.value,
  });
}

function assertQuiescence(receipt: IosQuiescenceReceipt, captureRunId: string, deviceId: string) {
  if (
    !receipt ||
    receipt.status !== 'terminated' ||
    receipt.captureRunId !== captureRunId ||
    receipt.deviceId !== deviceId ||
    receipt.bundleId !== BUNDLE_ID ||
    receipt.appRunning !== false ||
    !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(receipt.observedAt) ||
    !receipt.probe ||
    receipt.probe.status !== 'observed' ||
    receipt.probe.captureRunId !== captureRunId ||
    receipt.probe.deviceId !== deviceId ||
    receipt.probe.bundleId !== BUNDLE_ID ||
    receipt.probe.command.execution !== 'completed' ||
    receipt.probe.command.cleanup !== 'cleaned' ||
    typeof receipt.probe.command.logPath !== 'string' ||
    receipt.probe.command.logPath.length === 0 ||
    typeof receipt.probe.command.stdoutPath !== 'string' ||
    receipt.probe.command.stdoutPath.length === 0 ||
    !Number.isSafeInteger(receipt.probe.command.pid) ||
    !Number.isSafeInteger(receipt.probe.command.pgid) ||
    receipt.probe.command.bindingCaptureRunId !== captureRunId ||
    !HASH64.test(receipt.probe.command.stdoutSha256) ||
    !Number.isSafeInteger(receipt.probe.command.stdoutBytes) ||
    receipt.probe.command.stdoutBytes < 0 ||
    receipt.probe.command.stdoutBytes > MAX_FILE_BYTES ||
    receipt.probe.processes.some(
      (processRow) =>
        !Number.isSafeInteger(processRow.pid) ||
        processRow.pid <= 0 ||
        typeof processRow.command !== 'string' ||
        processRow.command.length === 0,
    ) ||
    receipt.probe.processes.length !== 0 ||
    !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(receipt.probe.observedAt)
  )
    invalid('language reset requires an independently probed terminated-app receipt');
}

function fingerprint(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object')
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    return candidate;
  };
  return sha256(Buffer.from(JSON.stringify(normalize(value)), 'utf8'));
}

function requireFingerprint(value: IosSnapshotFingerprint, label: string): IosSnapshotFingerprint {
  if (value?.status !== 'observed' || !HASH64.test(value.sha256)) invalid(`${label} is invalid`);
  return value;
}

function sameFilesExcept(
  before: readonly IosLanguageStorageFile[],
  after: readonly IosLanguageStorageFile[],
  ignored: readonly string[],
): boolean {
  const excluded = new Set(ignored);
  const left = before.filter((file) => !excluded.has(file.name));
  const right = after.filter((file) => !excluded.has(file.name));
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Remove exactly app.language.override while the app is quiescent. The
 * manifest is the canonical small-value store used by RN AsyncStorage; the
 * standard MD5 file is removed only when the manifest points to it.
 */
export async function resetIosLanguageOverride(input: {
  dataRoot: string;
  bundleId?: string;
  quiescence: IosQuiescenceReceipt;
  captureRunId: string;
  deviceId: string;
  authBefore: unknown;
  domainBefore: unknown;
  /** Read after the key-only mutation so the preservation check spans it. */
  readAuthAfter?: (signal?: AbortSignal) => Promise<unknown>;
  readDomainAfter?: (signal?: AbortSignal) => Promise<unknown>;
  /** Private source-test seam for an abort immediately before the second mutation. */
  beforeKeyFileUnlink?: (signal: AbortSignal | undefined) => void | Promise<void>;
  /** Static after values are retained for deterministic source tests only. */
  authAfter?: unknown;
  domainAfter?: unknown;
  signal?: AbortSignal;
}): Promise<IosLanguageResetReceipt> {
  checkAbort(input.signal, 'before-quiescence');
  assertQuiescence(input.quiescence, input.captureRunId, input.deviceId);
  if (
    (input.readAuthAfter === undefined && input.authAfter === undefined) ||
    (input.readDomainAfter === undefined && input.domainAfter === undefined)
  )
    invalid('language reset requires post-mutation auth and domain observations');
  checkAbort(input.signal, 'before-storage-read');
  const before = await readIosLanguageOverride(input.dataRoot, input.bundleId, input.signal);
  checkAbort(input.signal, 'after-storage-read');
  if (before.status === 'read-error')
    invalid(`cannot reset unreadable storage: ${before.errorCode}`);
  const authBefore = { status: 'observed' as const, sha256: fingerprint(input.authBefore) };
  const domainBefore = { status: 'observed' as const, sha256: fingerprint(input.domainBefore) };
  requireFingerprint(authBefore, 'authBefore');
  requireFingerprint(domainBefore, 'domainBefore');
  const readAfter = async () => {
    checkAbort(input.signal, 'before-auth-after-read');
    const authAfterValue = input.readAuthAfter
      ? await input.readAuthAfter(input.signal)
      : input.authAfter;
    checkAbort(input.signal, 'after-auth-after-read');
    checkAbort(input.signal, 'before-domain-after-read');
    const domainAfterValue = input.readDomainAfter
      ? await input.readDomainAfter(input.signal)
      : input.domainAfter;
    checkAbort(input.signal, 'after-domain-after-read');
    const authAfter = { status: 'observed' as const, sha256: fingerprint(authAfterValue) };
    const domainAfter = { status: 'observed' as const, sha256: fingerprint(domainAfterValue) };
    requireFingerprint(authAfter, 'authAfter');
    requireFingerprint(domainAfter, 'domainAfter');
    if (authBefore.sha256 !== authAfter.sha256) invalid('auth snapshot changed during reset');
    if (domainBefore.sha256 !== domainAfter.sha256) invalid('domain snapshot changed during reset');
    return { authAfter, domainAfter };
  };
  if (before.status === 'absent') {
    checkAbort(input.signal, 'before-absent-reset-receipt');
    return {
      status: 'observed',
      changedFiles: [],
      quiescence: input.quiescence,
      before,
      after: before,
      unrelatedStoragePreserved: true,
      authBefore,
      ...(await readAfter()),
      domainBefore,
    };
  }

  checkAbort(input.signal, 'before-manifest-reread');
  const root = await resolveStorageRoot(input.dataRoot, input.bundleId ?? BUNDLE_ID, input.signal);
  checkAbort(input.signal, 'after-storage-root');
  const parsed = await readManifest(root, input.signal);
  checkAbort(input.signal, 'after-manifest-reread');
  if (!parsed.manifest || !parsed.bytes) invalid('manifest changed before exact reset');
  if (!Object.hasOwn(parsed.manifest, STORAGE_KEY))
    invalid('language key disappeared before reset');
  const value = parsed.manifest[STORAGE_KEY];
  const keyFileName = value === null ? createHash('md5').update(STORAGE_KEY).digest('hex') : null;
  const changedFiles = [MANIFEST_NAME, ...(keyFileName ? [keyFileName] : [])];
  const currentManifestHash = sha256(parsed.bytes);
  if (before.manifestHash !== currentManifestHash)
    invalid('language manifest changed before exact reset');
  if (keyFileName) {
    if (!before.keyFile || before.keyFile.name !== keyFileName)
      invalid('language key file identity changed before exact reset');
  }

  const nextManifest = { ...parsed.manifest };
  delete nextManifest[STORAGE_KEY];
  const unrelatedManifestFingerprint = fingerprint(nextManifest);
  const temporaryManifestPath = path.join(
    root.storageRoot,
    `${MANIFEST_NAME}.locale-reset-${input.captureRunId}.tmp`,
  );
  let manifestPublishAttempted = false;
  let manifestPublished = false;
  let temporaryManifestCreated = false;
  let keyUnlinkAttempted = false;
  let keyUnlinked = false;
  let after: IosLanguageStorageObservation | null = null;
  const failureReceipt = (
    phase: IosLanguageResetFailureReceipt['failure']['phase'],
    error: unknown,
  ): IosLanguageResetFailureReceipt => ({
    status: 'failed-recovery-required',
    changedFiles: manifestPublished
      ? keyFileName
        ? [MANIFEST_NAME, ...(keyUnlinked ? [keyFileName] : [])]
        : [MANIFEST_NAME]
      : [],
    quiescence: input.quiescence,
    before,
    after,
    unrelatedStoragePreserved: false,
    authBefore,
    authAfter: null,
    domainBefore,
    domainAfter: null,
    failure: {
      phase,
      code: manifestPublished || manifestPublishAttempted ? 'recovery-required' : 'mutation-failed',
      message: error instanceof Error ? error.message.slice(0, 240) : 'language reset failed',
      recoveryRequired: true,
      temporaryManifestPath: manifestPublished ? null : temporaryManifestPath,
    },
  });
  try {
    checkAbort(input.signal, 'before-manifest-atomic-write');
    const nextBytes = Buffer.from(`${JSON.stringify(nextManifest)}\n`, 'utf8');
    await writeFile(temporaryManifestPath, nextBytes, {
      flag: 'wx',
      mode: parsed.file?.mode ?? 0o600,
    });
    temporaryManifestCreated = true;
    await chmod(temporaryManifestPath, parsed.file?.mode ?? 0o600);
    checkAbort(input.signal, 'after-manifest-temp-write');
    const temporaryOwned = await assertOwnedFile(
      temporaryManifestPath,
      process.getuid?.(),
      input.signal,
    );
    const temporaryBytes = await readBoundedFile(temporaryOwned.path, input.signal);
    if (
      temporaryBytes.byteLength !== nextBytes.byteLength ||
      sha256(temporaryBytes) !== sha256(nextBytes) ||
      fingerprint(JSON.parse(decodeUtf8(temporaryBytes, 'temporary language manifest'))) !==
        fingerprint(nextManifest)
    )
      invalid('temporary language manifest failed the atomic write verification');
    checkAbort(input.signal, 'before-manifest-rename');
    manifestPublishAttempted = true;
    await rename(temporaryManifestPath, root.manifestPath);
    manifestPublished = true;
    checkAbort(input.signal, 'after-manifest-rename');
    if (keyFileName) {
      checkAbort(input.signal, 'before-key-file-reread');
      const keyFile = path.join(root.storageRoot, keyFileName);
      const owned = await assertOwnedFile(keyFile, process.getuid?.(), input.signal);
      checkAbort(input.signal, 'after-key-file-reread');
      const currentKeyBytes = await readBoundedFile(owned.path, input.signal);
      if (
        currentKeyBytes.byteLength !== before.keyFile!.bytes ||
        sha256(currentKeyBytes) !== before.keyFile!.sha256
      )
        invalid('language key file changed before exact unlink');
      checkAbort(input.signal, 'before-key-file-unlink');
      await input.beforeKeyFileUnlink?.(input.signal);
      checkAbort(input.signal, 'after-key-file-unlink-hook');
      keyUnlinkAttempted = true;
      // Node's unlink API has no AbortSignal overload on the pinned type/runtime.
      // Guard immediately before and after the owned mutation instead of widening
      // the call with an unsupported option.
      await unlink(owned.path);
      keyUnlinked = true;
      checkAbort(input.signal, 'after-key-file-unlink');
    }
    checkAbort(input.signal, 'before-reset-after-read');
    after = await readIosLanguageOverride(input.dataRoot, input.bundleId, input.signal);
    checkAbort(input.signal, 'after-reset-after-read');
    if (after.status !== 'absent') invalid('exact language reset did not produce absent status');
    checkAbort(input.signal, 'before-unrelated-manifest-read');
    const afterManifest = await readManifest(root, input.signal);
    checkAbort(input.signal, 'after-unrelated-manifest-read');
    if (
      !afterManifest.manifest ||
      fingerprint(afterManifest.manifest) !== unrelatedManifestFingerprint
    )
      invalid('exact language reset changed an unrelated manifest entry');
    if (!sameFilesExcept(before.inventory, after.inventory, changedFiles))
      invalid('exact language reset changed unrelated app storage');
    const snapshotsAfter = await readAfter();
    checkAbort(input.signal, 'before-reset-receipt');
    return {
      status: 'observed',
      changedFiles,
      quiescence: input.quiescence,
      before,
      after,
      unrelatedStoragePreserved: true,
      authBefore,
      ...snapshotsAfter,
      domainBefore,
    };
  } catch (error) {
    if (temporaryManifestCreated && !manifestPublishAttempted) {
      try {
        await unlink(temporaryManifestPath);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
          return failureReceipt('manifest-atomic-write', cleanupError);
        }
      }
    }
    if (!manifestPublishAttempted && !manifestPublished && !keyUnlinkAttempted) throw error;
    const stage = !manifestPublished
      ? 'manifest-atomic-write'
      : keyFileName && !keyUnlinkAttempted
        ? 'key-file-unlink'
        : after === null
          ? 'post-mutation-readback'
          : 'post-mutation-preservation';
    return failureReceipt(stage, error);
  }
}

export const IOS_LANGUAGE_STORAGE_CONTRACT = {
  key: STORAGE_KEY,
  directory: STORAGE_DIRECTORY,
  manifest: MANIFEST_NAME,
  bundleId: BUNDLE_ID,
} as const;

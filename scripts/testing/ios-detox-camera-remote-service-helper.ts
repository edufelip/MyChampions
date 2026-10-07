import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, open, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

type PlistApi = {
  parse: (xml: string) => unknown;
  build: (value: unknown) => string;
};

const plist = createRequire(import.meta.url)('plist') as PlistApi;

export const remoteServiceHelperTargetBundles = Object.freeze([
  {
    role: 'safari-view-service',
    bundleIdentifier: 'com.apple.SafariViewService',
  },
] as const);

/** The bundle produced by the reviewed XCTest target. */
export const remoteServiceHelperBundleIdentifier = 'com.edufelip.mychampions.remote.service.helper';

/** The generated xctestrun file is the only supported environment transport. */
export const remoteServiceHelperEnvironmentTransport =
  'xctestrun.TestingEnvironmentVariables' as const;

export const remoteServiceHelperSourceClosurePaths = Object.freeze([
  'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.swift',
  'ios/RemoteServicePromptHelper/Info.plist',
  'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.xcodeproj/project.pbxproj',
  'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.xcodeproj/xcshareddata/xcschemes/RemoteServicePromptHelper.xcscheme',
  'scripts/testing/ios-detox-camera-remote-service-helper.ts',
] as const);

export const remoteServiceHelperProjectClosurePaths = Object.freeze([
  'ios/RemoteServicePromptHelper/Info.plist',
  'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.xcodeproj/project.pbxproj',
  'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.xcodeproj/xcshareddata/xcschemes/RemoteServicePromptHelper.xcscheme',
] as const);

export const remoteServiceHelperTestIdentifier =
  'RemoteServicePromptHelper/RemoteServicePromptHelperTests/testObserveAndDismissSavePasswordPrompt';

export const remoteServiceHelperTestEnvironmentKeys = Object.freeze([
  'SIMULATOR_UDID',
  'REMOTE_SERVICE_HELPER_EXPECTED_UDID',
  'REMOTE_SERVICE_HELPER_DEADLINE_AT_MS',
  'REMOTE_SERVICE_HELPER_ARTIFACT_ROOT',
  'REMOTE_SERVICE_HELPER_RECEIPT_PATH',
  'REMOTE_SERVICE_HELPER_CANCEL_PATH',
  'REMOTE_SERVICE_HELPER_RUN_ID',
  'REMOTE_SERVICE_HELPER_BUDGET_REMAINING_MS',
  'REMOTE_SERVICE_HELPER_SOURCE_CLOSURE_SHA256',
  'REMOTE_SERVICE_HELPER_PROJECT_CLOSURE_SHA256',
  'REMOTE_SERVICE_HELPER_BINARY_SHA256',
  'REMOTE_SERVICE_HELPER_BINARY_PATH',
  'REMOTE_SERVICE_HELPER_EXPECTED_BUNDLE_ID',
] as const);

export type RemoteServiceHelperExecution = {
  phase: 'step';
  execution: 'completed' | 'child-failed' | 'deadline' | 'cancelled' | 'harness-blocked';
  cleanup: 'not-acquired' | 'cleaned' | 'failed-recovery-ledger-retained' | 'unknown';
  childExitCode: number | null;
  childSignal: string | null;
  pid: number | null;
  pgid: number | null;
  logPath: string | null;
  stdoutPath: string | null;
  ownershipPath: string | null;
  elapsedMs: number;
  cleanupMs: number;
  censusFailure?: unknown;
  outputFailure?: unknown;
};

/** Identity of the already-running Detox child that delivered bootstrap. */
export type RemoteServiceBootstrapChild = Readonly<{
  pid: number;
  pgid: number;
  startedAt: string;
}>;

export type RemoteServiceNativeExecutor = (options: {
  command: string;
  argv: string[];
  artifactRoot: string;
  label: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  phase: 'step';
  deadlineMs: number;
  deadlineAtMonotonicMs: number;
  signal?: AbortSignal;
  stdoutPath?: string;
}) => Promise<RemoteServiceHelperExecution>;

type ClosureEntry = {
  path: string;
  sizeBytes: number;
  sha256: string;
};

type JsonRecord = Record<string, unknown>;

type ReadBudget = {
  deadlineAtMonotonicMs: number;
  signal?: AbortSignal;
  consumedBytes: number;
  maxAggregateBytes: number;
};

const MAX_AGGREGATE_READ_BYTES = 512 * 1024 * 1024;

type RemoteServiceHelperReceipt = JsonRecord & {
  status: 'dismissed' | 'absent' | 'failed' | 'deadline' | 'cancelled';
};

type RemoteServiceCommandReceipt = {
  schema: 'ios-detox-camera-remote-service-command-receipt-v1';
  status: 'dismissed' | 'absent';
  runId: string;
  command: 'xcodebuild';
  argv: string[];
  cwd: string;
  projectPath: string;
  scheme: string;
  destinationUdid: string;
  bootstrapChild: RemoteServiceBootstrapChild;
  bootstrapCommandHash: string;
  sourceClosureSha256: string;
  projectClosureSha256: string;
  sourceClosure: ClosureEntry[];
  projectClosure: ClosureEntry[];
  xctestrunPath: string;
  xctestrunSha256: string;
  helperBinaryPath: string;
  helperBinarySha256: string;
  buildReceiptPath: string;
  buildReceiptSha256: string;
  buildReceiptMode: number;
  environmentTransport: typeof remoteServiceHelperEnvironmentTransport;
  testEnvironmentKeys: readonly string[];
  xctestrunOnlyTestIdentifiers: readonly string[];
  xctestrunTestHostBundleIdentifier: string;
  xctestrunProductModuleName: string;
  helperBundleIdentifier: string;
  helperReceiptPath: string;
  helperReceiptSha256: string;
  helperReceiptMode: number;
  helperReceiptError: string | null;
  qualifiedXctestrunPath: string;
  qualifiedXctestrunSha256: string;
  materializedTestingEnvironmentSha256: string;
  materializedTestingEnvironmentKeys: readonly string[];
  execution: RemoteServiceHelperExecution;
  startedAtMs: number;
  endedAtMs: number;
  originalDeadlineAtMs: number;
  cleanup: {
    nativeCommand: RemoteServiceHelperExecution['cleanup'];
    cancelMarker: 'not-requested' | 'removed' | 'absent' | 'remove-failed';
  };
};

export type RemoteServiceHelperOptions = {
  sourceRoot: string;
  /** The reviewed source root; dynamic self-selection is rejected. */
  reviewedSourceRoot: string;
  artifactRoot: string;
  deviceUdid: string;
  /** The child/IPC identity that completed authenticated bootstrap. */
  bootstrapChild: RemoteServiceBootstrapChild;
  /** Hash of the pending bootstrap command that published the prompt stage. */
  bootstrapCommandHash: string;
  /** Original owner deadline; this is never re-anchored after preparation. */
  deadlineAtMonotonicMs: number;
  deadlineAtEpochMs: number;
  projectPath: string;
  scheme?: string;
  xctestrunPath: string;
  helperBinaryPath: string;
  buildReceiptPath: string;
  receiptPath: string;
  commandReceiptPath: string;
  cancelPath: string;
  commandCwd?: string;
  signal?: AbortSignal;
  execute: RemoteServiceNativeExecutor;
  environment?: NodeJS.ProcessEnv;
};

export type RemoteServiceHelperResult = {
  status: 'dismissed' | 'absent';
  receipt: RemoteServiceHelperReceipt;
  receiptSha256: string;
  commandReceipt: RemoteServiceCommandReceipt;
  commandReceiptSha256: string;
  execution: RemoteServiceHelperExecution;
};

export class RemoteServiceHelperError extends Error {
  constructor(
    readonly reason:
      | 'invalid-input'
      | 'native-failed'
      | 'native-timeout'
      | 'native-cancelled'
      | 'native-cleanup-unknown'
      | 'receipt-invalid',
    message: string,
    options?: { cause?: unknown; execution?: RemoteServiceHelperExecution },
  ) {
    super(message, options);
    this.name = 'RemoteServiceHelperError';
  }
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const udidPattern = /^[a-f0-9-]{36}$/i;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error) ?? 'unknown-error';
  } catch {
    return 'unknown-error';
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new RemoteServiceHelperError('receipt-invalid', `${label} is missing`);
  return value;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RemoteServiceHelperError('receipt-invalid', `${label} is not an object`);
  return value as JsonRecord;
}

function requireHash(value: unknown, label: string): string {
  const hash = requireString(value, label).toLowerCase();
  if (!hashPattern.test(hash))
    throw new RemoteServiceHelperError('receipt-invalid', `${label} is not SHA-256`);
  return hash;
}

function requireUdid(value: string, label: string): string {
  if (!udidPattern.test(value))
    throw new RemoteServiceHelperError('invalid-input', `${label} is not a simulator UDID`);
  return value;
}

function requireBootstrapChild(value: unknown): RemoteServiceBootstrapChild {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RemoteServiceHelperError('invalid-input', 'bootstrap child identity is missing');
  const candidate = value as Partial<RemoteServiceBootstrapChild>;
  const pid = candidate.pid;
  const pgid = candidate.pgid;
  if (
    typeof pid !== 'number' ||
    !Number.isSafeInteger(pid) ||
    pid <= 1 ||
    typeof pgid !== 'number' ||
    !Number.isSafeInteger(pgid) ||
    pgid <= 1 ||
    typeof candidate.startedAt !== 'string' ||
    candidate.startedAt.length === 0
  )
    throw new RemoteServiceHelperError('invalid-input', 'bootstrap child identity is invalid');
  return {
    pid,
    pgid,
    startedAt: candidate.startedAt,
  };
}

async function canonicalRegularFile(filePath: string, label: string): Promise<string> {
  const absolute = path.resolve(filePath);
  const canonical = await realpath(absolute);
  if (canonical !== absolute)
    throw new RemoteServiceHelperError('invalid-input', `${label} is not canonical`);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new RemoteServiceHelperError('invalid-input', `${label} is not a regular file`);
  return absolute;
}

function assertReadBudget(budget: ReadBudget, label: string): void {
  if (budget.signal?.aborted)
    throw new RemoteServiceHelperError('native-cancelled', `${label} cancelled`);
  if (performance.now() >= budget.deadlineAtMonotonicMs)
    throw new RemoteServiceHelperError('native-timeout', `${label} exceeded original deadline`);
}

function assertStableIdentity(
  expected: {
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    nlink: number;
  },
  actual: {
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    nlink: number;
  },
  label: string,
): void {
  if (
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.size !== actual.size ||
    expected.mtimeMs !== actual.mtimeMs ||
    expected.nlink !== actual.nlink
  )
    throw new RemoteServiceHelperError('invalid-input', `${label} changed during bounded read`);
  if (actual.nlink !== 1)
    throw new RemoteServiceHelperError('invalid-input', `${label} is hard-linked`);
}

async function readBoundedRegularFile(
  filePath: string,
  label: string,
  budget: ReadBudget,
  maxBytes = 256 * 1024 * 1024,
): Promise<Buffer> {
  assertReadBudget(budget, label);
  const absolute = await canonicalRegularFile(filePath, label);
  const before = await lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink())
    throw new RemoteServiceHelperError('invalid-input', `${label} is not a regular file`);
  if (before.nlink !== 1)
    throw new RemoteServiceHelperError('invalid-input', `${label} is hard-linked`);
  if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxBytes)
    throw new RemoteServiceHelperError('invalid-input', `${label} exceeds bounded read size`);
  if (budget.consumedBytes > budget.maxAggregateBytes - before.size)
    throw new RemoteServiceHelperError('invalid-input', `${label} exceeds aggregate read budget`);
  // Reserve before allocating. A failed read keeps the reservation, which is
  // conservative and prevents retries from defeating the aggregate cap.
  budget.consumedBytes += before.size;
  assertReadBudget(budget, label);
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    assertStableIdentity(before, opened, label);
    assertReadBudget(budget, label);
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      assertReadBudget(budget, label);
      const remaining = bytes.length - offset;
      const { bytesRead } = await file.read(bytes, offset, remaining, offset);
      if (bytesRead <= 0)
        throw new RemoteServiceHelperError('invalid-input', `${label} ended during bounded read`);
      offset += bytesRead;
    }
    const after = await file.stat();
    assertStableIdentity(opened, after, label);
    assertReadBudget(budget, label);
    return bytes;
  } finally {
    await file.close();
  }
}

async function canonicalDirectory(directoryPath: string, label: string): Promise<string> {
  const absolute = path.resolve(directoryPath);
  const canonical = await realpath(absolute);
  if (canonical !== absolute)
    throw new RemoteServiceHelperError('invalid-input', `${label} is not canonical`);
  const metadata = await lstat(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new RemoteServiceHelperError('invalid-input', `${label} is not a directory`);
  return absolute;
}

async function requirePrivateArtifactRoot(directoryPath: string): Promise<string> {
  const root = await canonicalDirectory(directoryPath, 'artifact root');
  const metadata = await lstat(root);
  const permissions = metadata.mode & 0o777;
  if (permissions !== 0o700)
    throw new RemoteServiceHelperError('invalid-input', 'artifact root must be mode 0700');
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    throw new RemoteServiceHelperError('invalid-input', 'artifact root is not caller-owned');
  return root;
}

function requireDirectChild(filePath: string, root: string, label: string): string {
  const absolute = path.resolve(filePath);
  if (path.dirname(absolute) !== root)
    throw new RemoteServiceHelperError('invalid-input', `${label} must be a direct artifact child`);
  return absolute;
}

async function writePrivateBytes(
  filePath: string,
  root: string,
  bytes: Buffer,
  budget: ReadBudget,
  label: string,
): Promise<{ bytes: number; sha256: string; mode: number }> {
  const absolute = requireDirectChild(filePath, root, label);
  if (bytes.length > 8 * 1024 * 1024)
    throw new RemoteServiceHelperError('invalid-input', `${label} exceeds bounded write size`);
  assertReadBudget(budget, label);
  try {
    await lstat(absolute);
    throw new RemoteServiceHelperError('invalid-input', `${label} path already exists`);
  } catch (error) {
    if (error instanceof RemoteServiceHelperError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFile(absolute, bytes, { flag: 'wx', mode: 0o600 });
  await chmod(absolute, 0o600);
  const metadata = await lstat(absolute);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size !== bytes.length
  )
    throw new RemoteServiceHelperError('invalid-input', `${label} identity changed after write`);
  assertReadBudget(budget, label);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    mode: metadata.mode & 0o777,
  };
}

async function readClosure(
  root: string,
  relativePaths: readonly string[],
  budget: ReadBudget,
): Promise<ClosureEntry[]> {
  const entries: ClosureEntry[] = [];
  // Sequential reads make the aggregate cap meaningful and avoid allocating
  // the duplicated project subset concurrently with the source closure.
  for (const relativePath of relativePaths) {
    if (path.isAbsolute(relativePath) || relativePath.includes('..'))
      throw new RemoteServiceHelperError(
        'invalid-input',
        `closure path escapes root: ${relativePath}`,
      );
    const absolute = await canonicalRegularFile(
      path.join(root, relativePath),
      `closure ${relativePath}`,
    );
    const bytes = await readBoundedRegularFile(absolute, `closure ${relativePath}`, budget);
    entries.push({
      path: relativePath,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return entries;
}

function closureHash(entries: readonly ClosureEntry[]): string {
  const manifest = entries
    .map((entry) => `${entry.path}\0${entry.sizeBytes}\0${entry.sha256}\n`)
    .join('');
  return sha256(Buffer.from(manifest, 'utf8'));
}

async function readPrivateJson(
  filePath: string,
  root: string,
  budget: ReadBudget,
  label: string,
  maxBytes = 4 * 1024 * 1024,
): Promise<{
  bytes: Buffer;
  mode: number;
  parsed: JsonRecord;
}> {
  requireDirectChild(filePath, root, label);
  const absolute = await canonicalRegularFile(filePath, label);
  const metadata = await lstat(absolute);
  const mode = metadata.mode & 0o777;
  if (mode !== 0o600)
    throw new RemoteServiceHelperError('receipt-invalid', `${label} must be mode 0600`);
  const bytes = await readBoundedRegularFile(absolute, label, budget, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new RemoteServiceHelperError('receipt-invalid', `${label} is not JSON`, {
      cause: error,
    });
  }
  return {
    bytes,
    mode,
    parsed: requireRecord(parsed, label),
  };
}

async function readPrivateReceipt(
  filePath: string,
  root: string,
  budget: ReadBudget,
): Promise<{
  bytes: Buffer;
  mode: number;
  parsed: RemoteServiceHelperReceipt;
}> {
  const receipt = await readPrivateJson(filePath, root, budget, 'helper receipt');
  return {
    ...receipt,
    parsed: receipt.parsed as RemoteServiceHelperReceipt,
  };
}

function closureEntries(value: unknown, label: string): ClosureEntry[] {
  if (!Array.isArray(value))
    throw new RemoteServiceHelperError('receipt-invalid', `${label} is not an array`);
  return value.map((entry, index) => {
    const row = requireRecord(entry, `${label}[${index}]`);
    const sizeBytes = Number(row.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
      throw new RemoteServiceHelperError(
        'receipt-invalid',
        `${label}[${index}] size is not a safe integer`,
      );
    return {
      path: requireString(row.path, `${label}[${index}] path`),
      sizeBytes,
      sha256: requireHash(row.sha256, `${label}[${index}] hash`),
    };
  });
}

function assertClosureMatches(
  actual: ClosureEntry[],
  expected: readonly ClosureEntry[],
  label: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some(
      (entry, index) =>
        entry.path !== expected[index]?.path ||
        entry.sizeBytes !== expected[index]?.sizeBytes ||
        entry.sha256 !== expected[index]?.sha256,
    )
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      `${label} does not match reviewed closure`,
    );
}

function validateBuildReceipt(
  receipt: JsonRecord,
  options: {
    sourceRoot: string;
    reviewedSourceRoot: string;
    projectPath: string;
    scheme: string;
    commandCwd: string;
    source: readonly ClosureEntry[];
    project: readonly ClosureEntry[];
    sourceClosureSha256: string;
    projectClosureSha256: string;
    xctestrunPath: string;
    xctestrunSha256: string;
    helperBinaryPath: string;
    helperBinarySha256: string;
    xctestrunBytes: Buffer;
  },
): void {
  if (receipt.schema !== 'ios-detox-camera-remote-service-build-receipt-v1')
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt schema mismatch');
  if (requireString(receipt.sourceRoot, 'build receipt source root') !== options.sourceRoot)
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt source root mismatch');
  if (options.sourceRoot !== options.reviewedSourceRoot)
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'helper source root is not the reviewed source root',
    );
  if (requireString(receipt.projectPath, 'build receipt project path') !== options.projectPath)
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt project path mismatch');
  if (requireString(receipt.scheme, 'build receipt scheme') !== options.scheme)
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt scheme mismatch');
  if (requireString(receipt.commandCwd, 'build receipt command cwd') !== options.commandCwd)
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt command cwd mismatch');
  if (
    JSON.stringify(receipt.testEnvironmentKeys) !==
    JSON.stringify(remoteServiceHelperTestEnvironmentKeys)
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'build receipt test environment keys mismatch',
    );
  if (receipt.environmentTransport !== remoteServiceHelperEnvironmentTransport)
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'build receipt environment transport is not xctestrun TestingEnvironmentVariables',
    );
  if (
    JSON.stringify(receipt.xctestrunOnlyTestIdentifiers) !==
    JSON.stringify([remoteServiceHelperTestIdentifier])
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'build receipt xctestrun test selection mismatch',
    );
  if (JSON.stringify(receipt.xctestrunSkipTestIdentifiers ?? []) !== JSON.stringify([]))
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'build receipt xctestrun skip selection is not empty',
    );
  if (
    receipt.xctestrunTestHostBundleIdentifier !==
    'com.edufelip.mychampions.remote.service.helper.xctrunner'
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt test host mismatch');
  if (receipt.xctestrunProductModuleName !== 'RemoteServicePromptHelper')
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt product module mismatch');
  if (receipt.helperBundleIdentifier !== remoteServiceHelperBundleIdentifier)
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt helper bundle mismatch');
  if (
    requireHash(receipt.sourceClosureSha256, 'build receipt source closure') !==
    options.sourceClosureSha256
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt source closure mismatch');
  if (
    requireHash(receipt.projectClosureSha256, 'build receipt project closure') !==
    options.projectClosureSha256
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt project closure mismatch');
  assertClosureMatches(
    closureEntries(receipt.sourceClosure, 'build receipt source closure entries'),
    options.source,
    'build receipt source closure entries',
  );
  assertClosureMatches(
    closureEntries(receipt.projectClosure, 'build receipt project closure entries'),
    options.project,
    'build receipt project closure entries',
  );
  if (
    requireString(receipt.xctestrunPath, 'build receipt xctestrun path') !== options.xctestrunPath
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt xctestrun path mismatch');
  if (
    requireHash(receipt.xctestrunSha256, 'build receipt xctestrun hash') !== options.xctestrunSha256
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'build receipt xctestrun hash mismatch');
  if (
    requireString(receipt.helperBinaryPath, 'build receipt helper binary path') !==
    options.helperBinaryPath
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'build receipt helper binary path mismatch',
    );
  if (
    requireHash(receipt.helperBinarySha256, 'build receipt helper binary hash') !==
    options.helperBinarySha256
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'build receipt helper binary hash mismatch',
    );
  validateXctestrunDescriptor(options.xctestrunBytes);
}

type XctestrunDescriptor = {
  value: JsonRecord;
  targetKey: string;
  target: JsonRecord;
  testingEnvironmentVariables: JsonRecord;
};

function recordKeys(value: JsonRecord): string[] {
  return Object.keys(value).sort();
}

function parseXctestrunDescriptor(bytes: Buffer): XctestrunDescriptor {
  let parsed: unknown;
  try {
    parsed = plist.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new RemoteServiceHelperError('receipt-invalid', 'xctestrun is not a valid XML plist', {
      cause: error,
    });
  }
  const value = requireRecord(parsed, 'xctestrun plist');
  const targets = Object.entries(value).filter(([, candidate]) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const target = candidate as JsonRecord;
    return (
      target.ProductModuleName === 'RemoteServicePromptHelper' &&
      target.TestHostBundleIdentifier ===
        'com.edufelip.mychampions.remote.service.helper.xctrunner' &&
      typeof target.TestBundlePath === 'string'
    );
  });
  if (targets.length !== 1)
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'xctestrun must contain exactly one reviewed helper target',
    );
  const [targetKey, targetValue] = targets[0];
  const target = targetValue as JsonRecord;
  const environment = target.TestingEnvironmentVariables;
  const testingEnvironmentVariables = requireRecord(
    environment,
    'xctestrun TestingEnvironmentVariables',
  );
  if (
    JSON.stringify(recordKeys(testingEnvironmentVariables)) !==
    JSON.stringify([...remoteServiceHelperTestEnvironmentKeys].sort())
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'xctestrun TestingEnvironmentVariables keys are not exact',
    );
  for (const key of remoteServiceHelperTestEnvironmentKeys) {
    if (typeof testingEnvironmentVariables[key] !== 'string')
      throw new RemoteServiceHelperError(
        'receipt-invalid',
        `xctestrun TestingEnvironmentVariables value is not a string: ${key}`,
      );
  }
  if (typeof target.TestHostPath !== 'string' || target.TestHostPath.length === 0)
    throw new RemoteServiceHelperError('receipt-invalid', 'xctestrun TestHostPath is missing');
  if (
    target.TestBundlePath !== '__TESTHOST__/PlugIns/RemoteServicePromptHelper.xctest' &&
    (typeof target.TestBundlePath !== 'string' ||
      !path.isAbsolute(target.TestBundlePath) ||
      !target.TestBundlePath.endsWith('/PlugIns/RemoteServicePromptHelper.xctest'))
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'xctestrun target bundle path mismatch');
  if (typeof target.TestHostBundleIdentifier !== 'string')
    throw new RemoteServiceHelperError('receipt-invalid', 'xctestrun test host is missing');
  return { value, targetKey, target, testingEnvironmentVariables };
}

function expandXctestrunPath(
  value: string,
  baseRoot: string,
  hostPath: string | null,
  label: string,
): string {
  let expanded = value.replaceAll('__TESTROOT__', baseRoot);
  if (hostPath) expanded = expanded.replaceAll('__TESTHOST__', hostPath);
  if (hostPath) expanded = expanded.replaceAll('__TESTPRODUCT__', path.dirname(hostPath));
  if (expanded.includes('__TESTROOT__') || expanded.includes('__TESTHOST__'))
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      `${label} has an unresolved xctestrun path`,
    );
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(baseRoot, expanded);
  if (!path.isAbsolute(absolute))
    throw new RemoteServiceHelperError('receipt-invalid', `${label} is not absolute`);
  return absolute;
}

function materializeXctestrunValue(value: unknown, baseRoot: string, hostPath: string): unknown {
  if (typeof value === 'string') {
    if (
      value.includes('__TESTROOT__') ||
      value.includes('__TESTHOST__') ||
      value.includes('__TESTPRODUCT__')
    )
      return expandXctestrunPath(value, baseRoot, hostPath, 'xctestrun path');
    return value;
  }
  if (Array.isArray(value))
    return value.map((entry) => materializeXctestrunValue(entry, baseRoot, hostPath));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        materializeXctestrunValue(entry, baseRoot, hostPath),
      ]),
    );
  }
  return value;
}

function validateXctestrunDescriptor(bytes: Buffer): XctestrunDescriptor {
  const descriptor = parseXctestrunDescriptor(bytes);
  const hostPath = expandXctestrunPath(
    descriptor.target.TestHostPath as string,
    path.dirname('/qualified/RemoteServicePromptHelper.xctestrun'),
    null,
    'xctestrun TestHostPath',
  );
  if (hostPath.includes('__TESTHOST__'))
    throw new RemoteServiceHelperError('receipt-invalid', 'xctestrun TestHostPath is malformed');
  if (String(descriptor.target.TestBundlePath).includes('__TESTROOT__'))
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'xctestrun TestBundlePath must use the reviewed __TESTHOST__ binding',
    );
  return descriptor;
}

function materializeXctestrun(
  bytes: Buffer,
  basePath: string,
  environment: JsonRecord,
): { bytes: Buffer; testingEnvironmentSha256: string } {
  const descriptor = parseXctestrunDescriptor(bytes);
  const baseRoot = path.dirname(basePath);
  const hostPath = expandXctestrunPath(
    descriptor.target.TestHostPath as string,
    baseRoot,
    null,
    'xctestrun TestHostPath',
  );
  if (!path.isAbsolute(hostPath) || hostPath.includes('__TESTHOST__'))
    throw new RemoteServiceHelperError('receipt-invalid', 'xctestrun TestHostPath is not absolute');
  const materialized = materializeXctestrunValue(
    descriptor.value,
    baseRoot,
    hostPath,
  ) as JsonRecord;
  const materializedTarget = materialized[descriptor.targetKey];
  const target = requireRecord(materializedTarget, 'materialized xctestrun target');
  const materializedHostPath = target.TestHostPath;
  const materializedBundlePath = target.TestBundlePath;
  if (
    typeof materializedHostPath !== 'string' ||
    !path.isAbsolute(materializedHostPath) ||
    typeof materializedBundlePath !== 'string' ||
    !path.isAbsolute(materializedBundlePath)
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'materialized xctestrun TestHostPath/TestBundlePath must be absolute',
    );
  if (
    materializedHostPath !== hostPath ||
    materializedBundlePath !== `${hostPath}/PlugIns/RemoteServicePromptHelper.xctest`
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'materialized xctestrun target paths are not bound to the reviewed host',
    );
  target.TestingEnvironmentVariables = { ...environment };
  const output = Buffer.from(plist.build(materialized), 'utf8');
  const reparsed = parseXctestrunDescriptor(output);
  if (
    JSON.stringify(recordKeys(reparsed.testingEnvironmentVariables)) !==
      JSON.stringify([...remoteServiceHelperTestEnvironmentKeys].sort()) ||
    reparsed.testingEnvironmentVariables.SIMULATOR_UDID !== environment.SIMULATOR_UDID ||
    reparsed.testingEnvironmentVariables.REMOTE_SERVICE_HELPER_RUN_ID !==
      environment.REMOTE_SERVICE_HELPER_RUN_ID ||
    typeof reparsed.target.TestHostPath !== 'string' ||
    !path.isAbsolute(reparsed.target.TestHostPath) ||
    typeof reparsed.target.TestBundlePath !== 'string' ||
    !path.isAbsolute(reparsed.target.TestBundlePath)
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'materialized xctestrun semantic binding did not round-trip',
    );
  return {
    bytes: output,
    testingEnvironmentSha256: sha256(
      Buffer.from(
        Object.keys(environment)
          .sort()
          .map((key) => `${key}\u0000${String(environment[key])}\n`)
          .join(''),
        'utf8',
      ),
    ),
  };
}

async function writePrivateJson(
  filePath: string,
  root: string,
  value: unknown,
): Promise<{ bytes: number; sha256: string }> {
  const absolute = requireDirectChild(filePath, root, 'command receipt');
  try {
    await lstat(absolute);
    throw new RemoteServiceHelperError('invalid-input', 'command receipt path already exists');
  } catch (error) {
    if (error instanceof RemoteServiceHelperError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  await writeFile(absolute, bytes, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(absolute, 0o600);
  const metadata = await lstat(absolute);
  if ((metadata.mode & 0o777) !== 0o600)
    throw new RemoteServiceHelperError('invalid-input', 'command receipt is not mode 0600');
  if (metadata.size !== bytes.length)
    throw new RemoteServiceHelperError('invalid-input', 'command receipt size changed after write');
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

function receiptStatus(value: unknown): RemoteServiceHelperReceipt['status'] {
  if (value === 'dismissed' || value === 'absent') return value;
  if (value === 'failed' || value === 'deadline' || value === 'cancelled') return value;
  throw new RemoteServiceHelperError(
    'receipt-invalid',
    `unsupported helper receipt status: ${String(value)}`,
  );
}

function validateHelperReceipt(
  receipt: RemoteServiceHelperReceipt,
  options: {
    deviceUdid: string;
    runId: string;
    deadlineAtEpochMs: number;
    sourceClosureSha256: string;
    projectClosureSha256: string;
    helperBinaryPath: string;
    helperBinarySha256: string;
  },
): 'dismissed' | 'absent' {
  if (receipt.schema !== 'ios-detox-camera-remote-service-helper-receipt-v1')
    throw new RemoteServiceHelperError('receipt-invalid', 'helper receipt schema mismatch');
  const status = receiptStatus(receipt.status);
  if (status !== 'dismissed' && status !== 'absent')
    throw new RemoteServiceHelperError('receipt-invalid', `helper ended with ${status}`);
  if (receipt.action !== 'dismiss-save-password')
    throw new RemoteServiceHelperError('receipt-invalid', 'helper action mismatch');
  if (receipt.runId !== options.runId)
    throw new RemoteServiceHelperError('receipt-invalid', 'helper run identity mismatch');
  if (
    receipt.expectedDeviceUdid !== options.deviceUdid ||
    receipt.observedDeviceUdid !== options.deviceUdid
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'helper destination UDID mismatch');
  if (receipt.promptLabel !== 'Save Password?' || receipt.dismissLabel !== 'Not Now')
    throw new RemoteServiceHelperError('receipt-invalid', 'helper semantic labels mismatch');
  const helper = requireRecord(receipt.helper, 'helper provenance');
  if (
    requireString(helper.bundleIdentifier, 'observed helper bundle identifier') !==
    remoteServiceHelperBundleIdentifier
  )
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'observed helper bundle identifier mismatch',
    );
  const bundlePath = requireString(helper.bundlePath, 'observed helper bundle path');
  const executablePath = requireString(helper.executablePath, 'observed helper executable path');
  if (!executablePath.startsWith(`${bundlePath}/`))
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'helper executable is outside observed bundle',
    );
  if (
    requireString(helper.expectedBinaryPath, 'expected helper binary path') !==
    options.helperBinaryPath
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'expected helper binary path mismatch');
  if (requireHash(helper.binarySha256, 'helper binary hash') !== options.helperBinarySha256)
    throw new RemoteServiceHelperError('receipt-invalid', 'helper binary hash mismatch');
  if (
    requireHash(helper.sourceClosureSha256, 'helper source closure') !== options.sourceClosureSha256
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'helper source closure mismatch');
  if (
    requireHash(helper.projectClosureSha256, 'helper project closure') !==
    options.projectClosureSha256
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'helper project closure mismatch');
  const timing = requireRecord(receipt.timing, 'helper timing');
  if (Number(timing.originalDeadlineAtMs) !== options.deadlineAtEpochMs)
    throw new RemoteServiceHelperError('receipt-invalid', 'helper deadline was renewed or changed');
  const startedAtMs = Number(timing.startedAtMs);
  const endedAtMs = Number(timing.endedAtMs);
  if (
    !Number.isSafeInteger(startedAtMs) ||
    !Number.isSafeInteger(endedAtMs) ||
    endedAtMs < startedAtMs
  )
    throw new RemoteServiceHelperError('receipt-invalid', 'helper timing is invalid');
  const targets = receipt.targetBundleIdentifiers;
  if (!Array.isArray(targets) || targets.length !== remoteServiceHelperTargetBundles.length)
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'helper target bundle inventory mismatch',
    );
  for (const target of remoteServiceHelperTargetBundles) {
    if (
      !targets.some(
        (row) =>
          requireString(requireRecord(row, 'target').bundleIdentifier, 'target bundle') ===
          target.bundleIdentifier,
      )
    )
      throw new RemoteServiceHelperError(
        'receipt-invalid',
        `missing reviewed target ${target.bundleIdentifier}`,
      );
  }
  const attempts = receipt.attempts;
  if (!Array.isArray(attempts) || attempts.length === 0)
    throw new RemoteServiceHelperError('receipt-invalid', 'helper did not retain target attempts');
  const reachedTargetCount = Number(receipt.reachedTargetCount);
  if (!Number.isSafeInteger(reachedTargetCount) || reachedTargetCount < 1)
    throw new RemoteServiceHelperError(
      'receipt-invalid',
      'helper did not prove a reachable target',
    );
  if (status === 'dismissed') {
    if (endedAtMs > options.deadlineAtEpochMs)
      throw new RemoteServiceHelperError('receipt-invalid', 'dismissal completed after deadline');
    if (
      !remoteServiceHelperTargetBundles.some(
        (target) => receipt.targetBundleIdentifier === target.bundleIdentifier,
      )
    )
      throw new RemoteServiceHelperError('receipt-invalid', 'dismissal target is not reviewed');
    if (receipt.tapSent !== true || Number(receipt.stableActionableSamplesBeforeTap) < 2)
      throw new RemoteServiceHelperError(
        'receipt-invalid',
        'dismissal lacks stable actionable witness',
      );
    const actionable = attempts.some(
      (attempt) => requireRecord(attempt, 'attempt').outcome === 'unique-actionable',
    );
    if (!actionable)
      throw new RemoteServiceHelperError(
        'receipt-invalid',
        'dismissal lacks unique actionable attempt',
      );
    if (receipt.reason !== 'unique-witness-and-actionable-dismiss-control')
      throw new RemoteServiceHelperError('receipt-invalid', 'dismissal reason is not strict');
  } else {
    if (receipt.tapSent !== false || receipt.targetBundleIdentifier !== null)
      throw new RemoteServiceHelperError('receipt-invalid', 'absent result contains a tap');
    if (receipt.reason !== 'no-unique-actionable-prompt-before-deadline')
      throw new RemoteServiceHelperError('receipt-invalid', 'absent result reason is not bounded');
  }
  return status;
}

function nativeFailureReason(
  execution: RemoteServiceHelperExecution,
): RemoteServiceHelperError['reason'] {
  if (execution.execution === 'deadline') return 'native-timeout';
  if (execution.execution === 'cancelled') return 'native-cancelled';
  if (execution.cleanup === 'unknown' || execution.cleanup === 'failed-recovery-ledger-retained')
    return 'native-cleanup-unknown';
  return 'native-failed';
}

export async function readRemoteServiceHelperSourceClosure(
  sourceRoot: string,
  budget: ReadBudget,
): Promise<{
  source: ClosureEntry[];
  project: ClosureEntry[];
  sourceClosureSha256: string;
  projectClosureSha256: string;
}> {
  assertReadBudget(budget, 'helper source closure');
  const root = await canonicalDirectory(sourceRoot, 'helper source root');
  const source = await readClosure(root, remoteServiceHelperSourceClosurePaths, budget);
  const project = await readClosure(root, remoteServiceHelperProjectClosurePaths, budget);
  return {
    source,
    project,
    sourceClosureSha256: closureHash(source),
    projectClosureSha256: closureHash(project),
  };
}

export async function runRemoteServicePromptHelper(
  options: RemoteServiceHelperOptions,
): Promise<RemoteServiceHelperResult> {
  const startedAtMs = Date.now();
  const deadlineAtMonotonicMs = options.deadlineAtMonotonicMs;
  if (!Number.isFinite(deadlineAtMonotonicMs) || performance.now() >= deadlineAtMonotonicMs)
    throw new RemoteServiceHelperError('native-timeout', 'helper deadline is already expired');
  const readBudget: ReadBudget = {
    deadlineAtMonotonicMs,
    signal: options.signal,
    consumedBytes: 0,
    maxAggregateBytes: MAX_AGGREGATE_READ_BYTES,
  };
  assertReadBudget(readBudget, 'remote-service helper preparation');
  const root = await requirePrivateArtifactRoot(options.artifactRoot);
  const sourceRoot = await canonicalDirectory(options.sourceRoot, 'helper source root');
  const reviewedSourceRoot = await canonicalDirectory(
    options.reviewedSourceRoot,
    'reviewed helper source root',
  );
  if (sourceRoot !== reviewedSourceRoot)
    throw new RemoteServiceHelperError(
      'invalid-input',
      'helper source root does not match the reviewed source root',
    );
  const deviceUdid = requireUdid(options.deviceUdid, 'destination UDID');
  const bootstrapChild = requireBootstrapChild(options.bootstrapChild);
  const bootstrapCommandHash = requireHash(options.bootstrapCommandHash, 'bootstrap command hash');
  const scheme = options.scheme ?? 'RemoteServicePromptHelper';
  if (scheme !== 'RemoteServicePromptHelper')
    throw new RemoteServiceHelperError('invalid-input', 'helper scheme is not reviewed');
  if (!Number.isSafeInteger(options.deadlineAtEpochMs) || options.deadlineAtEpochMs <= startedAtMs)
    throw new RemoteServiceHelperError('invalid-input', 'helper deadline is missing or expired');
  const initialRemainingMs = deadlineAtMonotonicMs - performance.now();
  if (initialRemainingMs < 100)
    throw new RemoteServiceHelperError('invalid-input', 'helper deadline leaves no command budget');
  const project = await canonicalDirectory(options.projectPath, 'helper project');
  if (path.basename(project) !== 'RemoteServicePromptHelper.xcodeproj')
    throw new RemoteServiceHelperError('invalid-input', 'helper project name is not reviewed');
  const qualifiedXctestrunPath = await canonicalRegularFile(
    options.xctestrunPath,
    'helper qualified xctestrun',
  );
  const helperBinaryPath = await canonicalRegularFile(options.helperBinaryPath, 'helper binary');
  const commandCwd = await canonicalDirectory(
    options.commandCwd ?? sourceRoot,
    'helper command cwd',
  );
  const buildReceiptPath = requireDirectChild(
    path.resolve(options.buildReceiptPath),
    root,
    'build receipt',
  );
  const artifactReceiptPath = requireDirectChild(
    path.resolve(options.receiptPath),
    root,
    'helper receipt',
  );
  const commandReceiptPath = requireDirectChild(
    path.resolve(options.commandReceiptPath),
    root,
    'command receipt',
  );
  const cancelPath = requireDirectChild(path.resolve(options.cancelPath), root, 'cancel marker');
  if (new Set([buildReceiptPath, artifactReceiptPath, commandReceiptPath, cancelPath]).size !== 4)
    throw new RemoteServiceHelperError('invalid-input', 'private artifact paths must be distinct');
  for (const filePath of [artifactReceiptPath, commandReceiptPath, cancelPath]) {
    try {
      await lstat(filePath);
      throw new RemoteServiceHelperError(
        'invalid-input',
        `private artifact already exists: ${filePath}`,
      );
    } catch (error) {
      if (error instanceof RemoteServiceHelperError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  const closure = await readRemoteServiceHelperSourceClosure(sourceRoot, readBudget);
  const helperBinaryBytes = await readBoundedRegularFile(
    helperBinaryPath,
    'helper binary',
    readBudget,
  );
  const helperBinarySha256 = sha256(helperBinaryBytes);
  const xctestrunBytes = await readBoundedRegularFile(
    qualifiedXctestrunPath,
    'helper xctestrun',
    readBudget,
  );
  const qualifiedXctestrunSha256 = sha256(xctestrunBytes);
  const buildReceipt = await readPrivateJson(buildReceiptPath, root, readBudget, 'build receipt');
  validateBuildReceipt(buildReceipt.parsed, {
    sourceRoot,
    reviewedSourceRoot,
    projectPath: project,
    scheme,
    commandCwd,
    source: closure.source,
    project: closure.project,
    sourceClosureSha256: closure.sourceClosureSha256,
    projectClosureSha256: closure.projectClosureSha256,
    xctestrunPath: qualifiedXctestrunPath,
    xctestrunSha256: qualifiedXctestrunSha256,
    helperBinaryPath,
    helperBinarySha256,
    xctestrunBytes,
  });
  const runId = randomUUID();
  const remainingBudgetMs = Math.floor(deadlineAtMonotonicMs - performance.now());
  if (remainingBudgetMs < 100)
    throw new RemoteServiceHelperError(
      'native-timeout',
      'helper deadline leaves no command budget after preparation',
    );
  const environment: NodeJS.ProcessEnv = {
    ...(options.environment ?? process.env),
    SIMULATOR_UDID: deviceUdid,
    REMOTE_SERVICE_HELPER_EXPECTED_UDID: deviceUdid,
    REMOTE_SERVICE_HELPER_DEADLINE_AT_MS: String(options.deadlineAtEpochMs),
    REMOTE_SERVICE_HELPER_ARTIFACT_ROOT: root,
    REMOTE_SERVICE_HELPER_RECEIPT_PATH: artifactReceiptPath,
    REMOTE_SERVICE_HELPER_CANCEL_PATH: cancelPath,
    REMOTE_SERVICE_HELPER_RUN_ID: runId,
    REMOTE_SERVICE_HELPER_BUDGET_REMAINING_MS: String(remainingBudgetMs),
    REMOTE_SERVICE_HELPER_SOURCE_CLOSURE_SHA256: closure.sourceClosureSha256,
    REMOTE_SERVICE_HELPER_PROJECT_CLOSURE_SHA256: closure.projectClosureSha256,
    REMOTE_SERVICE_HELPER_BINARY_SHA256: helperBinarySha256,
    REMOTE_SERVICE_HELPER_BINARY_PATH: helperBinaryPath,
    REMOTE_SERVICE_HELPER_EXPECTED_BUNDLE_ID: remoteServiceHelperBundleIdentifier,
  };
  for (const key of remoteServiceHelperTestEnvironmentKeys) {
    const value = environment[key];
    if (typeof value !== 'string' || value.length === 0)
      throw new RemoteServiceHelperError('invalid-input', `missing test environment value ${key}`);
  }
  const materializedEnvironment = Object.fromEntries(
    remoteServiceHelperTestEnvironmentKeys.map((key) => [key, environment[key] as string]),
  ) as JsonRecord;
  assertReadBudget(readBudget, 'xctestrun materialization');
  const materializedXctestrun = materializeXctestrun(
    xctestrunBytes,
    qualifiedXctestrunPath,
    materializedEnvironment,
  );
  assertReadBudget(readBudget, 'xctestrun materialization');
  const materializedXctestrunPath = requireDirectChild(
    path.join(root, `ios-remote-service-${runId}.xctestrun.private`),
    root,
    'materialized xctestrun',
  );
  const materializedXctestrunWrite = await writePrivateBytes(
    materializedXctestrunPath,
    root,
    materializedXctestrun.bytes,
    readBudget,
    'materialized xctestrun',
  );
  const xctestrunPath = materializedXctestrunPath;
  const xctestrunSha256 = materializedXctestrunWrite.sha256;
  const argv = [
    'test-without-building',
    '-xctestrun',
    xctestrunPath,
    '-destination',
    `platform=iOS Simulator,id=${deviceUdid}`,
    `-only-testing:${remoteServiceHelperTestIdentifier}`,
  ];
  let cancelMarker: RemoteServiceCommandReceipt['cleanup']['cancelMarker'] = 'not-requested';
  let cancelRequested = false;
  let cancelWrite: Promise<void> | undefined;
  const onAbort = () => {
    cancelRequested = true;
    cancelWrite = writeFile(cancelPath, 'cancelled\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    }).catch(() => undefined);
  };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });

  let execution: RemoteServiceHelperExecution;
  try {
    if (options.signal?.aborted) {
      // Preparation cancellation is terminal before the owned executor. The
      // cancellation marker is retained only long enough for the command
      // receipt to explain why no native process was spawned.
      await cancelWrite;
      execution = {
        phase: 'step',
        execution: 'cancelled',
        cleanup: 'not-acquired',
        childExitCode: null,
        childSignal: null,
        pid: null,
        pgid: null,
        logPath: null,
        stdoutPath: null,
        ownershipPath: null,
        elapsedMs: 0,
        cleanupMs: 0,
      };
    } else {
      execution = await options.execute({
        command: 'xcodebuild',
        argv,
        artifactRoot: root,
        label: 'ios-remote-service-helper',
        env: environment,
        cwd: commandCwd,
        phase: 'step',
        deadlineMs: Math.max(100, Math.floor(deadlineAtMonotonicMs - performance.now())),
        deadlineAtMonotonicMs,
        signal: options.signal,
      });
    }
  } finally {
    await cancelWrite;
    if (cancelRequested) {
      try {
        await lstat(cancelPath);
        await rm(cancelPath);
        cancelMarker = 'removed';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') cancelMarker = 'absent';
        else cancelMarker = 'remove-failed';
      }
    }
    options.signal?.removeEventListener('abort', onAbort);
  }

  let materializedXctestrunError: unknown;
  try {
    const materializedReadback = await readBoundedRegularFile(
      materializedXctestrunPath,
      'materialized xctestrun readback',
      readBudget,
    );
    if (sha256(materializedReadback) !== xctestrunSha256)
      throw new RemoteServiceHelperError(
        'receipt-invalid',
        'materialized xctestrun changed after protected write',
      );
  } catch (error) {
    materializedXctestrunError =
      error instanceof RemoteServiceHelperError
        ? error
        : new RemoteServiceHelperError(
            'receipt-invalid',
            'materialized xctestrun readback failed',
            {
              cause: error,
            },
          );
  }

  let helperReceipt: Awaited<ReturnType<typeof readPrivateReceipt>> | undefined;
  let helperReceiptError: unknown = materializedXctestrunError;
  try {
    helperReceipt = await readPrivateReceipt(artifactReceiptPath, root, readBudget);
  } catch (error) {
    helperReceiptError ??= error;
  }
  let status: 'dismissed' | 'absent' | null = null;
  if (execution.execution === 'completed' && helperReceipt) {
    try {
      status = validateHelperReceipt(helperReceipt.parsed, {
        deviceUdid,
        runId,
        deadlineAtEpochMs: options.deadlineAtEpochMs,
        sourceClosureSha256: closure.sourceClosureSha256,
        projectClosureSha256: closure.projectClosureSha256,
        helperBinaryPath,
        helperBinarySha256,
      });
    } catch (error) {
      helperReceiptError ??= error;
    }
  }
  const endedAtMs = Date.now();
  const helperReceiptSha256 = helperReceipt ? sha256(helperReceipt.bytes) : sha256(Buffer.alloc(0));
  const commandReceipt: RemoteServiceCommandReceipt = {
    schema: 'ios-detox-camera-remote-service-command-receipt-v1',
    status: status ?? 'absent',
    runId,
    command: 'xcodebuild',
    argv,
    cwd: commandCwd,
    projectPath: project,
    scheme,
    destinationUdid: deviceUdid,
    bootstrapChild,
    bootstrapCommandHash,
    sourceClosureSha256: closure.sourceClosureSha256,
    projectClosureSha256: closure.projectClosureSha256,
    sourceClosure: closure.source,
    projectClosure: closure.project,
    xctestrunPath,
    xctestrunSha256,
    helperBinaryPath,
    helperBinarySha256,
    buildReceiptPath,
    buildReceiptSha256: sha256(buildReceipt.bytes),
    buildReceiptMode: buildReceipt.mode,
    environmentTransport: remoteServiceHelperEnvironmentTransport,
    testEnvironmentKeys: remoteServiceHelperTestEnvironmentKeys,
    xctestrunOnlyTestIdentifiers: [remoteServiceHelperTestIdentifier],
    xctestrunTestHostBundleIdentifier: 'com.edufelip.mychampions.remote.service.helper.xctrunner',
    xctestrunProductModuleName: 'RemoteServicePromptHelper',
    helperBundleIdentifier: remoteServiceHelperBundleIdentifier,
    helperReceiptPath: artifactReceiptPath,
    helperReceiptSha256,
    helperReceiptMode: helperReceipt?.mode ?? 0,
    helperReceiptError: helperReceiptError ? describeError(helperReceiptError) : null,
    qualifiedXctestrunPath,
    qualifiedXctestrunSha256,
    materializedTestingEnvironmentSha256: materializedXctestrun.testingEnvironmentSha256,
    materializedTestingEnvironmentKeys: remoteServiceHelperTestEnvironmentKeys,
    execution,
    startedAtMs,
    endedAtMs,
    originalDeadlineAtMs: options.deadlineAtEpochMs,
    cleanup: {
      nativeCommand: execution.cleanup,
      cancelMarker,
    },
  };
  const commandReceiptWrite = await writePrivateJson(commandReceiptPath, root, commandReceipt);
  if (helperReceiptError) {
    if (execution.execution === 'completed') {
      throw new RemoteServiceHelperError(
        'receipt-invalid',
        `remote-service helper receipt was unusable: ${describeError(helperReceiptError)}`,
        { cause: helperReceiptError, execution },
      );
    }
    throw new RemoteServiceHelperError(
      nativeFailureReason(execution),
      `remote-service helper did not produce a usable receipt (${execution.execution}/${execution.cleanup})`,
      { cause: helperReceiptError, execution },
    );
  }
  if (!helperReceipt || !status) {
    throw new RemoteServiceHelperError(
      nativeFailureReason(execution),
      `remote-service helper did not produce a usable receipt (${execution.execution}/${execution.cleanup})`,
      { execution },
    );
  }
  if (execution.cleanup !== 'cleaned') {
    throw new RemoteServiceHelperError(
      'native-cleanup-unknown',
      `remote-service helper cleanup is ${execution.cleanup}`,
      { execution },
    );
  }
  return {
    status,
    receipt: helperReceipt.parsed,
    receiptSha256: helperReceiptSha256,
    commandReceipt,
    commandReceiptSha256: commandReceiptWrite.sha256,
    execution,
  };
}

export const __private = Object.freeze({
  closureHash,
  requireDirectChild,
  validateHelperReceipt,
});

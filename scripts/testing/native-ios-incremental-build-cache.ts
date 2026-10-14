import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { NativeSourceIdentity } from './native-build-identity';
import type { NativeCommandExecution } from './owned-native-command';

const execute = promisify(execFile);

/**
 * Xcode's DerivedData contains products, receipts, logs and compiler state in
 * one tree. Only these compiler state directories are eligible for a failed
 * build handoff. Products and logs are deliberately excluded so a second
 * xcodebuild must produce a new app and a new terminal command record.
 */
export const IOS_INCREMENTAL_COMPILATION_DIRECTORIES = [
  'Build/Intermediates.noindex',
  'CompilationCache.noindex',
  'ModuleCache.noindex',
  'SDKStatCaches.noindex',
] as const;

export const IOS_INCREMENTAL_BUILD_CACHE_SCHEMA = 'ios-incremental-build-cache-handoff-v1' as const;
export const IOS_INCREMENTAL_BUILD_CACHE_RECEIPT = 'incremental-build-cache.private.json' as const;
export const IOS_INCREMENTAL_BUILD_CACHE_HANDOFF_RECEIPT =
  'incremental-build-cache-handoff.private.json' as const;
export const IOS_INCREMENTAL_BUILD_CACHE_RESULT_RECEIPT =
  'incremental-build-cache-result.private.json' as const;
const IOS_BUILD_DEADLINE_MS = 900_000;
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const RUN_ID = /^[a-f0-9]{24}$/;

type FsRecord = Awaited<ReturnType<typeof lstat>>;

export type IosIncrementalBuildToolchain = Readonly<{
  xcodebuildVersion: string;
  developerDir: string;
  developerDirCanonical: string;
  sdkPath: string;
  sdkPathCanonical: string;
  sdkVersion: string;
  architecture: string;
}>;

export type IosIncrementalBuildBinding = Readonly<{
  schemaVersion: 1;
  source: NativeSourceIdentity;
  toolchain: IosIncrementalBuildToolchain;
  build: Readonly<{
    workspace: 'ios/mychampions.xcworkspace';
    scheme: 'mychampions';
    configuration: 'Debug';
    sdk: 'iphonesimulator';
    destinationPlatform: 'iOS Simulator';
    architecture: string;
    metroPort: number;
    entitlementsSha256: string;
    settings: Readonly<{
      codeSigningAllowed: 'YES';
      codeSigningRequired: 'NO';
      codeSignIdentity: '-';
      disableAutomaticPackageResolution: true;
    }>;
  }>;
  buildDeadlineMs: 900_000;
  bindingSha256: string;
}>;

export type IosIncrementalBuildCachePredecessor = Readonly<{
  sourceRoot: string;
  captureRunId: string;
  cacheRoot: string;
  metroPort: number;
  binding: IosIncrementalBuildBinding;
  cacheTreeSha256: string;
  cacheEntries: readonly Readonly<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }>[];
  command: NativeCommandExecution & {
    label: string;
    command: string;
    argv: string[];
    deadlineMs: number;
  };
}>;

export type IosIncrementalBuildCachePreparation = Readonly<{
  schema: typeof IOS_INCREMENTAL_BUILD_CACHE_SCHEMA;
  sourceRunId: string;
  sourceRoot: string;
  sourceCacheRoot: string;
  destinationCacheRoot: string;
  sourceCacheTreeSha256: string;
  destinationCacheTreeSha256: string;
  cacheEntries: readonly Readonly<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }>[];
  binding: IosIncrementalBuildBinding;
  appProductsCopied: false;
  terminalReceiptCopied: false;
  freshXcodebuildRequired: true;
  originalBuildDeadlineMs: 900_000;
}>;

type CaptureReport = Readonly<{
  captureRunId?: unknown;
  captureRoot?: unknown;
  platform?: unknown;
  cleanup?: unknown;
  source?: unknown;
  sourceAfter?: unknown;
  reservedPorts?: unknown;
  commandExecutions?: unknown;
  incrementalBuildCacheReceipt?: unknown;
}>;

type IncrementalCacheReceipt = Readonly<{
  schema: typeof IOS_INCREMENTAL_BUILD_CACHE_SCHEMA;
  captureRunId: string;
  sourceRoot: string;
  cacheRoot: string;
  cacheTreeSha256: string;
  cacheEntries: readonly Readonly<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }>[];
  source: NativeSourceIdentity;
  sourceAfter: NativeSourceIdentity;
  binding: IosIncrementalBuildBinding;
  command: NativeCommandExecution & {
    label: string;
    command: string;
    argv: string[];
    deadlineMs: number;
  };
  captureCleanup: 'cleaned';
  appProductsIncluded: false;
  terminalReceiptsIncluded: false;
}>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function metadata(value: FsRecord) {
  return {
    dev: Number(value.dev),
    ino: Number(value.ino),
    mode: Number(value.mode),
    uid: Number(value.uid),
    gid: Number(value.gid),
    nlink: Number(value.nlink),
    size: Number(value.size),
    mtimeMs: Number(value.mtimeMs),
    ctimeMs: Number(value.ctimeMs),
  };
}

function requireOwner(value: FsRecord, label: string, directory: boolean): void {
  if (
    (directory ? !value.isDirectory() : !value.isFile()) ||
    value.isSymbolicLink() ||
    (process.getuid && value.uid !== process.getuid()) ||
    (Number(value.mode) & 0o022) !== 0 ||
    (!directory && value.nlink !== 1)
  )
    throw new Error(
      `${label} is not a canonical private owned ${directory ? 'directory' : 'file'}`,
    );
}

async function requireCanonicalDirectory(directory: string, label: string): Promise<FsRecord> {
  if (!path.isAbsolute(directory) || directory.includes('\0'))
    throw new Error(`${label} must be an absolute path`);
  const resolved = path.resolve(directory);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) throw new Error(`${label} must be canonical`);
  const value = await lstat(resolved);
  requireOwner(value, label, true);
  if ((value.mode & 0o777) !== 0o700) throw new Error(`${label} must have mode 0700`);
  return value;
}

async function requireCanonicalOwnedDirectory(directory: string, label: string): Promise<FsRecord> {
  if (!path.isAbsolute(directory) || directory.includes('\0'))
    throw new Error(`${label} must be an absolute path`);
  const resolved = path.resolve(directory);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) throw new Error(`${label} must be canonical`);
  const value = await lstat(resolved);
  requireOwner(value, label, true);
  return value;
}

async function readPrivateJson(file: string, label: string): Promise<unknown> {
  const value = await lstat(file);
  requireOwner(value, label, false);
  if ((value.mode & 0o777) !== 0o600 || (await realpath(file)) !== file)
    throw new Error(`${label} must be a canonical private 0600 file`);
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

async function requirePrivateFile(file: string, label: string): Promise<void> {
  const value = await lstat(file);
  requireOwner(value, label, false);
  if ((value.mode & 0o777) !== 0o600 || (await realpath(file)) !== file)
    throw new Error(`${label} must be a canonical private 0600 file`);
}

type TreeScan = Readonly<{
  sha256: string;
  bytes: number;
  entries: readonly Readonly<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }>[];
}>;

async function scanOwnedTree(root: string, label: string): Promise<TreeScan> {
  await requireCanonicalDirectory(root, label);
  const digest = createHash('sha256');
  const entries: {
    relativePath: string;
    bytes: number;
    sha256: string;
  }[] = [];
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const directoryStat = await lstat(directory);
    requireOwner(directoryStat, directory, true);
    const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) {
      const file = path.join(directory, child.name);
      const relativePath = path.relative(root, file);
      if (child.isDirectory()) {
        requireOwner(await lstat(file), file, true);
        digest.update(`D:${relativePath}\0`);
        await visit(file);
      } else {
        if (!child.isFile()) throw new Error(`${label} contains a symlink or unsupported entry`);
        const before = await lstat(file);
        requireOwner(before, file, false);
        const identity = metadata(before);
        const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const fileHash = createHash('sha256');
        let copied = 0;
        try {
          const buffer = Buffer.alloc(128 * 1024);
          for (;;) {
            const read = await handle.read(buffer, 0, buffer.length, null);
            if (read.bytesRead === 0) break;
            fileHash.update(buffer.subarray(0, read.bytesRead));
            copied += read.bytesRead;
          }
          const opened = await handle.stat();
          if (JSON.stringify(metadata(opened)) !== JSON.stringify(identity))
            throw new Error(`${label} changed while it was read: ${file}`);
        } finally {
          await handle.close();
        }
        const after = await lstat(file);
        if (JSON.stringify(metadata(after)) !== JSON.stringify(identity))
          throw new Error(`${label} changed after it was read: ${file}`);
        const sha256 = fileHash.digest('hex');
        digest.update(`F:${relativePath}:${sha256}\0`);
        entries.push({ relativePath, bytes: copied, sha256 });
        bytes += copied;
      }
    }
  };
  await visit(root);
  return { sha256: digest.digest('hex'), bytes, entries };
}

async function copyOwnedTree(
  source: string,
  destination: string,
  label: string,
): Promise<TreeScan> {
  await requireCanonicalOwnedDirectory(source, `${label} source`);
  const destinationParent = path.dirname(destination);
  try {
    await requireCanonicalOwnedDirectory(destinationParent, `${label} destination parent`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(destinationParent, { recursive: true, mode: 0o700 });
    await requireCanonicalOwnedDirectory(destinationParent, `${label} destination parent`);
  }
  try {
    await lstat(destination);
    throw new Error(`${label} destination already exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const sourceScan = await scanOwnedTree(source, `${label} source`);
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const copyDirectory = async (from: string, to: string): Promise<void> => {
    const fromStat = await lstat(from);
    requireOwner(fromStat, from, true);
    try {
      await requireCanonicalOwnedDirectory(to, `${label} destination directory`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(to, { recursive: false, mode: 0o700 });
    }
    for (const child of (await readdir(from, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const input = path.join(from, child.name);
      const output = path.join(to, child.name);
      if (child.isDirectory()) {
        await copyDirectory(input, output);
        continue;
      }
      if (!child.isFile()) throw new Error(`${label} contains a symlink or unsupported entry`);
      const inputStat = await lstat(input);
      requireOwner(inputStat, input, false);
      const inputHandle = await open(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const outputHandle = await open(
        output,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        const buffer = Buffer.alloc(128 * 1024);
        let offset = 0;
        for (;;) {
          const read = await inputHandle.read(buffer, 0, buffer.length, null);
          if (read.bytesRead === 0) break;
          await outputHandle.write(buffer, 0, read.bytesRead, offset);
          offset += read.bytesRead;
        }
      } finally {
        await inputHandle.close();
        await outputHandle.close();
      }
    }
  };
  try {
    await copyDirectory(source, destination);
  } catch (error) {
    // The new artifact root is disposable and never contains an app product;
    // leave it for the owning cleanup ledger rather than touching the source.
    throw error;
  }
  const destinationScan = await scanOwnedTree(destination, `${label} destination`);
  if (
    destinationScan.sha256 !== sourceScan.sha256 ||
    !sameJson(destinationScan.entries, sourceScan.entries)
  )
    throw new Error(`${label} changed while it was copied`);
  return destinationScan;
}

function requireSourceIdentity(value: unknown, label: string): NativeSourceIdentity {
  const row = object(value, label);
  if (
    typeof row.sha !== 'string' ||
    !SHA.test(row.sha) ||
    typeof row.dirty !== 'boolean' ||
    typeof row.sourceTreeHash !== 'string' ||
    !HASH.test(row.sourceTreeHash)
  )
    throw new Error(`${label} is malformed`);
  return {
    sha: row.sha,
    dirty: row.dirty,
    sourceTreeHash: row.sourceTreeHash,
  };
}

function requireBinding(value: unknown, label: string): IosIncrementalBuildBinding {
  const row = object(value, label);
  const source = requireSourceIdentity(row.source, `${label}.source`);
  const toolchain = object(row.toolchain, `${label}.toolchain`);
  const build = object(row.build, `${label}.build`);
  const settings = object(build.settings, `${label}.build.settings`);
  if (
    row.schemaVersion !== 1 ||
    typeof toolchain.xcodebuildVersion !== 'string' ||
    toolchain.xcodebuildVersion.length === 0 ||
    typeof toolchain.developerDir !== 'string' ||
    typeof toolchain.developerDirCanonical !== 'string' ||
    typeof toolchain.sdkPath !== 'string' ||
    typeof toolchain.sdkPathCanonical !== 'string' ||
    typeof toolchain.sdkVersion !== 'string' ||
    typeof toolchain.architecture !== 'string' ||
    build.workspace !== 'ios/mychampions.xcworkspace' ||
    build.scheme !== 'mychampions' ||
    build.configuration !== 'Debug' ||
    build.sdk !== 'iphonesimulator' ||
    build.destinationPlatform !== 'iOS Simulator' ||
    typeof build.architecture !== 'string' ||
    build.architecture !== toolchain.architecture ||
    typeof build.metroPort !== 'number' ||
    !Number.isSafeInteger(build.metroPort) ||
    build.metroPort < 1024 ||
    build.metroPort > 65535 ||
    typeof build.entitlementsSha256 !== 'string' ||
    !HASH.test(build.entitlementsSha256) ||
    settings.codeSigningAllowed !== 'YES' ||
    settings.codeSigningRequired !== 'NO' ||
    settings.codeSignIdentity !== '-' ||
    settings.disableAutomaticPackageResolution !== true ||
    row.buildDeadlineMs !== IOS_BUILD_DEADLINE_MS ||
    typeof row.bindingSha256 !== 'string' ||
    !HASH.test(row.bindingSha256)
  )
    throw new Error(`${label} is malformed`);
  const architecture = build.architecture;
  const metroPort = build.metroPort;
  const entitlementsSha256 = build.entitlementsSha256;
  const bindingSha256 = row.bindingSha256;
  const binding = {
    schemaVersion: 1 as const,
    source,
    toolchain: {
      xcodebuildVersion: toolchain.xcodebuildVersion,
      developerDir: toolchain.developerDir,
      developerDirCanonical: toolchain.developerDirCanonical,
      sdkPath: toolchain.sdkPath,
      sdkPathCanonical: toolchain.sdkPathCanonical,
      sdkVersion: toolchain.sdkVersion,
      architecture: toolchain.architecture,
    },
    build: {
      workspace: 'ios/mychampions.xcworkspace' as const,
      scheme: 'mychampions' as const,
      configuration: 'Debug' as const,
      sdk: 'iphonesimulator' as const,
      destinationPlatform: 'iOS Simulator' as const,
      architecture,
      metroPort,
      entitlementsSha256,
      settings: {
        codeSigningAllowed: 'YES' as const,
        codeSigningRequired: 'NO' as const,
        codeSignIdentity: '-' as const,
        disableAutomaticPackageResolution: true as const,
      },
    },
    buildDeadlineMs: 900_000 as const,
    bindingSha256,
  } satisfies IosIncrementalBuildBinding;
  const expectedHash = hashJson({ ...binding, bindingSha256: undefined });
  if (expectedHash !== binding.bindingSha256)
    throw new Error(`${label} binding hash does not match its fields`);
  return binding;
}

function requireCommand(
  value: unknown,
  label: string,
): NativeCommandExecution & {
  label: string;
  command: string;
  argv: string[];
  deadlineMs: number;
} {
  const row = object(value, label) as Record<string, unknown> & {
    label?: unknown;
    command?: unknown;
    argv?: unknown;
    deadlineMs?: unknown;
  };
  const pid = typeof row.pid === 'number' ? row.pid : Number.NaN;
  const pgid = typeof row.pgid === 'number' ? row.pgid : Number.NaN;
  if (
    row.label !== 'build' ||
    row.command !== 'xcodebuild' ||
    !Array.isArray(row.argv) ||
    row.argv.some((entry) => typeof entry !== 'string') ||
    row.deadlineMs !== IOS_BUILD_DEADLINE_MS ||
    row.phase !== 'build' ||
    !['child-failed', 'deadline'].includes(String(row.execution)) ||
    row.cleanup !== 'cleaned' ||
    ((!Number.isSafeInteger(row.childExitCode) || row.childExitCode === 0) &&
      typeof row.childSignal !== 'string') ||
    !Number.isSafeInteger(pid) ||
    !Number.isSafeInteger(pgid) ||
    pid <= 0 ||
    pgid <= 0 ||
    typeof row.logPath !== 'string' ||
    typeof row.ownershipPath !== 'string'
  )
    throw new Error(`${label} is not a terminal cleaned failed xcodebuild command`);
  return row as unknown as NativeCommandExecution & {
    label: string;
    command: string;
    argv: string[];
    deadlineMs: number;
  };
}

function commandHasExpectedBuildInputs(
  command: { argv: string[] },
  binding: IosIncrementalBuildBinding,
  expectedDerivedDataPath?: string,
) {
  const argv = command.argv;
  const requires = (flag: string, value: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] === value;
  };
  const derivedDataIndex = argv.indexOf('-derivedDataPath');
  const entitlements = argv.find((value) => value.startsWith('CODE_SIGN_ENTITLEMENTS='));
  const metroPort = argv.find((value) => value.startsWith('RCT_METRO_PORT='));
  return (
    requires('-workspace', binding.build.workspace) &&
    requires('-scheme', binding.build.scheme) &&
    requires('-configuration', binding.build.configuration) &&
    requires('-sdk', binding.build.sdk) &&
    (expectedDerivedDataPath === undefined ||
      (derivedDataIndex >= 0 && argv[derivedDataIndex + 1] === expectedDerivedDataPath)) &&
    argv.includes('-disableAutomaticPackageResolution') &&
    argv.includes('CODE_SIGNING_ALLOWED=YES') &&
    argv.includes('CODE_SIGNING_REQUIRED=NO') &&
    argv.includes('CODE_SIGN_IDENTITY=-') &&
    metroPort === `RCT_METRO_PORT=${binding.build.metroPort}` &&
    typeof entitlements === 'string'
  );
}

async function requireBoundEntitlements(
  command: { argv: string[] },
  artifactRoot: string,
  expectedSha256: string,
): Promise<void> {
  const value = command.argv.find((entry) => entry.startsWith('CODE_SIGN_ENTITLEMENTS='));
  if (!value) throw new Error('iOS xcodebuild entitlements input is missing');
  const file = value.slice('CODE_SIGN_ENTITLEMENTS='.length);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${artifactRoot}${path.sep}`))
    throw new Error('iOS xcodebuild entitlements input escapes its artifact root');
  if ((await hashOwnedFile(resolved)) !== expectedSha256)
    throw new Error('iOS xcodebuild entitlements input changed');
}

async function requireArtifactRoot(root: string, label: string): Promise<{ uid: number }> {
  const metadata = await requireCanonicalDirectory(root, label);
  if ((Number(metadata.mode) & 0o777) !== 0o700) throw new Error(`${label} must have mode 0700`);
  return { uid: Number(metadata.uid) };
}

async function requireReceiptHash(report: CaptureReport, sourceRoot: string, receipt: unknown) {
  const record = object(report.incrementalBuildCacheReceipt, 'capture incremental cache receipt');
  const pathValue = record.path;
  const hash = record.sha256;
  if (
    pathValue !== IOS_INCREMENTAL_BUILD_CACHE_RECEIPT ||
    typeof hash !== 'string' ||
    !HASH.test(hash)
  )
    throw new Error('capture incremental cache receipt binding is missing');
  const bytes = await readFile(path.join(sourceRoot, IOS_INCREMENTAL_BUILD_CACHE_RECEIPT));
  if (createHash('sha256').update(bytes).digest('hex') !== hash)
    throw new Error('capture incremental cache receipt bytes changed');
  if (JSON.stringify(JSON.parse(bytes.toString('utf8'))) !== JSON.stringify(receipt))
    throw new Error('capture incremental cache receipt differs from the report binding');
}

function requireReservedMetroPort(value: unknown): number {
  if (!Array.isArray(value) || value.length < 1 || !Number.isSafeInteger(value[0]))
    throw new Error('predecessor reserved Metro port is missing');
  const port = value[0] as number;
  if (port < 1024 || port > 65535) throw new Error('predecessor reserved Metro port is invalid');
  return port;
}

/** Reads only a producer-owned, cleaned failed build; caller paths are never treated as cache roots. */
export async function loadIosIncrementalBuildCachePredecessor(
  sourceRoot: string,
  currentSource: NativeSourceIdentity,
): Promise<IosIncrementalBuildCachePredecessor> {
  await requireArtifactRoot(sourceRoot, 'incremental cache predecessor root');
  const normalizedRoot = path.normalize(sourceRoot);
  const parent = path.dirname(normalizedRoot);
  const isNativePilotArtifact =
    path.basename(parent) === 'native-pilot' &&
    path.basename(path.dirname(parent)) === 'artifacts' &&
    path.basename(path.dirname(path.dirname(parent))) === '.qa';
  const isNativeRecoveryArtifact = path.basename(parent) === 'mychampions-native-recovery';
  if (!isNativePilotArtifact && !isNativeRecoveryArtifact)
    throw new Error(
      'incremental cache predecessor must be inside the owned native pilot or native recovery root',
    );
  const captureRunId = path.basename(sourceRoot);
  if (!RUN_ID.test(captureRunId))
    throw new Error('incremental cache predecessor run ID is invalid');
  const report = (await readPrivateJson(
    path.join(sourceRoot, 'capture.private.json'),
    'incremental cache predecessor capture report',
  )) as CaptureReport;
  if (
    report.captureRunId !== captureRunId ||
    report.captureRoot !== sourceRoot ||
    report.platform !== 'ios' ||
    report.cleanup !== 'cleaned'
  )
    throw new Error('incremental cache predecessor is not the producer-owned cleaned iOS capture');
  const source = requireSourceIdentity(report.source, 'incremental cache predecessor source');
  const sourceAfter = requireSourceIdentity(
    report.sourceAfter,
    'incremental cache predecessor sourceAfter',
  );
  if (!sameJson(source, currentSource) || !sameJson(sourceAfter, currentSource))
    throw new Error('incremental cache predecessor source identity is stale');
  const receipt = await readPrivateJson(
    path.join(sourceRoot, IOS_INCREMENTAL_BUILD_CACHE_RECEIPT),
    'incremental cache predecessor receipt',
  );
  await requireReceiptHash(report, sourceRoot, receipt);
  const receiptRow = object(receipt, 'incremental cache predecessor receipt');
  if (receiptRow.schema !== IOS_INCREMENTAL_BUILD_CACHE_SCHEMA)
    throw new Error('incremental cache predecessor receipt schema is invalid');
  const binding = requireBinding(receiptRow.binding, 'incremental cache predecessor binding');
  if (!sameJson(binding.source, currentSource))
    throw new Error('incremental cache predecessor build binding source is stale');
  if (receiptRow.captureRunId !== captureRunId || receiptRow.sourceRoot !== sourceRoot)
    throw new Error('incremental cache predecessor receipt root binding is stale');
  if (receiptRow.captureCleanup !== 'cleaned')
    throw new Error('incremental cache predecessor receipt cleanup is not proven');
  if (receiptRow.appProductsIncluded !== false || receiptRow.terminalReceiptsIncluded !== false)
    throw new Error('incremental cache predecessor receipt includes forbidden app bytes');
  const command = requireCommand(receiptRow.command, 'incremental cache predecessor command');
  if (!Array.isArray(report.commandExecutions))
    throw new Error('incremental cache predecessor command ledger is missing');
  const reportBuildCommands = report.commandExecutions.filter(
    (value) =>
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).label === 'build',
  );
  if (reportBuildCommands.length !== 1 || !sameJson(reportBuildCommands[0], command))
    throw new Error('incremental cache predecessor command receipt is not bound to capture');
  if (!commandHasExpectedBuildInputs(command, binding, path.join(sourceRoot, 'ios-build')))
    throw new Error('incremental cache predecessor xcodebuild inputs differ');
  if (command.logPath === null || command.ownershipPath === null)
    throw new Error('incremental cache predecessor command paths are missing');
  const commandPaths = [command.logPath, command.ownershipPath];
  for (const [index, file] of commandPaths.entries()) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(`${sourceRoot}${path.sep}`) || (await realpath(resolved)) !== resolved)
      throw new Error('incremental cache predecessor command receipt escapes its artifact root');
    if (index === 0) {
      await requirePrivateFile(resolved, 'incremental cache predecessor build log');
      if ((await lstat(resolved)).size === 0)
        throw new Error('incremental cache predecessor build log is empty');
    } else {
      const ownership = object(
        await readPrivateJson(resolved, 'incremental cache predecessor ownership receipt'),
        'incremental cache predecessor ownership receipt',
      );
      if (
        !Array.isArray(ownership.processes) ||
        !ownership.processes.some((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          const process = value as Record<string, unknown>;
          return (
            process.pid === command.pid &&
            process.pgid === command.pgid &&
            typeof process.started === 'string' &&
            process.started.length > 0 &&
            typeof process.commandHash === 'string' &&
            HASH.test(process.commandHash)
          );
        })
      )
        throw new Error('incremental cache predecessor ownership receipt lacks the build leader');
    }
  }
  await requireBoundEntitlements(command, sourceRoot, binding.build.entitlementsSha256);
  const cacheRoot = path.join(sourceRoot, 'ios-build');
  if (receiptRow.cacheRoot !== cacheRoot)
    throw new Error('incremental cache predecessor cache root binding is stale');
  await requireCanonicalDirectory(cacheRoot, 'incremental cache predecessor DerivedData root');
  const cacheEntries = object(receiptRow, 'incremental cache predecessor receipt').cacheEntries;
  if (!Array.isArray(cacheEntries) || cacheEntries.length === 0)
    throw new Error('incremental cache predecessor has no compiler cache entries');
  const scan = await scanOwnedTree(cacheRoot, 'incremental cache predecessor DerivedData root');
  const allowed = new Set(IOS_INCREMENTAL_COMPILATION_DIRECTORIES);
  const includedEntries = scan.entries.filter((entry) =>
    [...allowed].some(
      (prefix) => entry.relativePath === prefix || entry.relativePath.startsWith(`${prefix}/`),
    ),
  );
  if (includedEntries.length === 0)
    throw new Error('incremental cache predecessor has no allowlisted compiler cache');
  const receiptEntries = cacheEntries as Record<string, unknown>[];
  if (
    !sameJson(receiptEntries, includedEntries) ||
    typeof receiptRow.cacheTreeSha256 !== 'string' ||
    !HASH.test(receiptRow.cacheTreeSha256) ||
    receiptRow.cacheTreeSha256 !== hashJson(includedEntries)
  )
    throw new Error('incremental cache predecessor compiler cache bytes changed');
  return {
    sourceRoot,
    captureRunId,
    cacheRoot,
    metroPort: requireReservedMetroPort(report.reservedPorts),
    binding,
    cacheTreeSha256: receiptRow.cacheTreeSha256,
    cacheEntries: includedEntries,
    command,
  };
}

/**
 * Resolve the host/toolchain identity used by xcodebuild. The command runner
 * is injectable for source controls; production uses real host commands.
 */
export async function resolveIosIncrementalBuildToolchain(
  run: (command: string, argv: string[]) => Promise<{ stdout: string }> = async (command, argv) =>
    execute(command, argv, { timeout: 5_000, maxBuffer: 2 * 1024 * 1024 }),
): Promise<IosIncrementalBuildToolchain> {
  const [xcode, developer, sdkPath, sdkVersion, architecture] = await Promise.all([
    run('xcodebuild', ['-version']),
    run('xcode-select', ['-p']),
    run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']),
    run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']),
    run('uname', ['-m']),
  ]);
  const developerDir = developer.stdout.trim();
  const sdk = sdkPath.stdout.trim();
  const developerDirCanonical = await realpath(developerDir);
  const sdkPathCanonical = await realpath(sdk);
  if (
    !developerDir ||
    !sdk ||
    !developerDirCanonical ||
    !sdkPathCanonical ||
    !sdkVersion.stdout.trim() ||
    !architecture.stdout.trim()
  )
    throw new Error('iOS incremental build toolchain identity is incomplete');
  return {
    xcodebuildVersion: xcode.stdout.trim(),
    developerDir,
    developerDirCanonical,
    sdkPath: sdk,
    sdkPathCanonical,
    sdkVersion: sdkVersion.stdout.trim(),
    architecture: architecture.stdout.trim(),
  };
}

export async function hashOwnedFile(file: string): Promise<string> {
  const metadata = await lstat(file);
  requireOwner(metadata, file, false);
  if ((await realpath(file)) !== file) throw new Error('iOS build input file must be canonical');
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

export function buildIosIncrementalBuildBinding(input: {
  source: NativeSourceIdentity;
  toolchain: IosIncrementalBuildToolchain;
  metroPort: number;
  entitlementsSha256: string;
}): IosIncrementalBuildBinding {
  if (
    !SHA.test(input.source.sha) ||
    !HASH.test(input.source.sourceTreeHash) ||
    !Number.isSafeInteger(input.metroPort) ||
    input.metroPort < 1024 ||
    input.metroPort > 65535 ||
    !HASH.test(input.entitlementsSha256)
  )
    throw new Error('iOS incremental build binding inputs are invalid');
  const withoutHash = {
    schemaVersion: 1 as const,
    source: input.source,
    toolchain: input.toolchain,
    build: {
      workspace: 'ios/mychampions.xcworkspace' as const,
      scheme: 'mychampions' as const,
      configuration: 'Debug' as const,
      sdk: 'iphonesimulator' as const,
      destinationPlatform: 'iOS Simulator' as const,
      architecture: input.toolchain.architecture,
      metroPort: input.metroPort,
      entitlementsSha256: input.entitlementsSha256,
      settings: {
        codeSigningAllowed: 'YES' as const,
        codeSigningRequired: 'NO' as const,
        codeSignIdentity: '-' as const,
        disableAutomaticPackageResolution: true as const,
      },
    },
    buildDeadlineMs: 900_000 as const,
  };
  return {
    ...withoutHash,
    bindingSha256: hashJson({ ...withoutHash, bindingSha256: undefined }),
  };
}

export function buildIosXcodebuildArguments(input: {
  derivedDataPath: string;
  deviceUdid: string;
  entitlementsPath: string;
  metroPort: number;
}): string[] {
  if (
    !path.isAbsolute(input.derivedDataPath) ||
    !path.isAbsolute(input.entitlementsPath) ||
    !/^[A-Fa-f0-9-]{8,64}$/.test(input.deviceUdid) ||
    !Number.isSafeInteger(input.metroPort) ||
    input.metroPort < 1024 ||
    input.metroPort > 65535
  )
    throw new Error('Invalid iOS xcodebuild arguments');
  return [
    '-workspace',
    'ios/mychampions.xcworkspace',
    '-scheme',
    'mychampions',
    '-configuration',
    'Debug',
    '-sdk',
    'iphonesimulator',
    '-destination',
    `id=${input.deviceUdid}`,
    '-derivedDataPath',
    input.derivedDataPath,
    '-disableAutomaticPackageResolution',
    'CODE_SIGNING_ALLOWED=YES',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=-',
    `CODE_SIGN_ENTITLEMENTS=${input.entitlementsPath}`,
    `RCT_METRO_PORT=${input.metroPort}`,
  ];
}

export async function prepareIosIncrementalBuildCache(input: {
  predecessor: IosIncrementalBuildCachePredecessor;
  destinationRoot: string;
  currentBinding: IosIncrementalBuildBinding;
  deadlineMs: number;
  artifactRoot: string;
}): Promise<IosIncrementalBuildCachePreparation> {
  if (input.deadlineMs !== IOS_BUILD_DEADLINE_MS)
    throw new Error('iOS incremental cache handoff requires the original 900000ms build deadline');
  await requireArtifactRoot(input.artifactRoot, 'incremental cache destination artifact root');
  await requireCanonicalDirectory(input.destinationRoot, 'incremental cache destination parent');
  if (!sameJson(input.currentBinding.source, input.predecessor.binding.source))
    throw new Error('iOS incremental cache source binding differs from predecessor');
  if (
    !sameJson(input.currentBinding.toolchain, input.predecessor.binding.toolchain) ||
    !sameJson(input.currentBinding.build, input.predecessor.binding.build)
  )
    throw new Error('iOS incremental cache toolchain, SDK, architecture or configuration differs');
  if (input.currentBinding.buildDeadlineMs !== input.predecessor.binding.buildDeadlineMs)
    throw new Error('iOS incremental cache deadline binding differs from predecessor');
  const destinationDerivedData = path.join(input.destinationRoot, 'ios-build');
  try {
    await lstat(destinationDerivedData);
    throw new Error('incremental cache destination DerivedData already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const copied: Readonly<{ relativePath: string; bytes: number; sha256: string }>[] = [];
  for (const relative of IOS_INCREMENTAL_COMPILATION_DIRECTORIES) {
    const source = path.join(input.predecessor.cacheRoot, relative);
    try {
      const value = await lstat(source);
      if (!value.isDirectory() || value.isSymbolicLink())
        throw new Error(`incremental cache source ${relative} is not an owned directory`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const destination = path.join(destinationDerivedData, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const scan = await copyOwnedTree(source, destination, `incremental compiler cache ${relative}`);
    for (const entry of scan.entries)
      copied.push({
        relativePath: path.posix.join(relative, entry.relativePath),
        bytes: entry.bytes,
        sha256: entry.sha256,
      });
  }
  if (copied.length === 0)
    throw new Error('incremental cache handoff copied no compiler artifacts');
  const destinationScan = await scanOwnedTree(
    destinationDerivedData,
    'incremental destination DerivedData',
  );
  const destinationEntries = destinationScan.entries.filter((entry) =>
    IOS_INCREMENTAL_COMPILATION_DIRECTORIES.some(
      (prefix) => entry.relativePath === prefix || entry.relativePath.startsWith(`${prefix}/`),
    ),
  );
  if (!sameJson(copied, destinationEntries))
    throw new Error('incremental destination compiler artifacts changed after copy');
  const receipt: IosIncrementalBuildCachePreparation = {
    schema: IOS_INCREMENTAL_BUILD_CACHE_SCHEMA,
    sourceRunId: input.predecessor.captureRunId,
    sourceRoot: input.predecessor.sourceRoot,
    sourceCacheRoot: input.predecessor.cacheRoot,
    destinationCacheRoot: destinationDerivedData,
    sourceCacheTreeSha256: input.predecessor.cacheTreeSha256,
    destinationCacheTreeSha256: hashJson(destinationEntries),
    cacheEntries: destinationEntries,
    binding: input.currentBinding,
    appProductsCopied: false,
    terminalReceiptCopied: false,
    freshXcodebuildRequired: true,
    originalBuildDeadlineMs: IOS_BUILD_DEADLINE_MS,
  };
  await writeFile(
    path.join(input.artifactRoot, IOS_INCREMENTAL_BUILD_CACHE_HANDOFF_RECEIPT),
    JSON.stringify(receipt, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  return receipt;
}

export async function writeIosIncrementalBuildCacheReceipt(input: {
  artifactRoot: string;
  captureRunId: string;
  source: NativeSourceIdentity;
  sourceAfter: NativeSourceIdentity | null;
  binding: IosIncrementalBuildBinding;
  command: NativeCommandExecution & {
    label: string;
    command: string;
    argv: string[];
    deadlineMs: number;
  };
  captureCleanup: string;
}): Promise<{
  path: typeof IOS_INCREMENTAL_BUILD_CACHE_RECEIPT;
  sha256: string;
  bytes: number;
  receipt: IncrementalCacheReceipt;
}> {
  await requireArtifactRoot(input.artifactRoot, 'incremental cache receipt artifact root');
  if (!RUN_ID.test(input.captureRunId))
    throw new Error('incremental cache receipt capture ID is invalid');
  if (!input.sourceAfter) throw new Error('incremental cache receipt requires sourceAfter');
  const command = requireCommand(input.command, 'incremental cache receipt command');
  const cacheRoot = path.join(input.artifactRoot, 'ios-build');
  if (!commandHasExpectedBuildInputs(command, input.binding, cacheRoot))
    throw new Error('incremental cache receipt command inputs do not match binding');
  await requireBoundEntitlements(
    command,
    input.artifactRoot,
    input.binding.build.entitlementsSha256,
  );
  if (input.captureCleanup !== 'cleaned')
    throw new Error('incremental cache receipt requires cleaned capture cleanup');
  await requireCanonicalDirectory(cacheRoot, 'incremental cache receipt DerivedData root');
  const scan = await scanOwnedTree(cacheRoot, 'incremental cache receipt DerivedData root');
  const allowed = new Set(IOS_INCREMENTAL_COMPILATION_DIRECTORIES);
  const cacheEntries = scan.entries.filter((entry) =>
    [...allowed].some(
      (prefix) => entry.relativePath === prefix || entry.relativePath.startsWith(`${prefix}/`),
    ),
  );
  if (!cacheEntries.length)
    throw new Error('incremental cache receipt has no compiler cache entries');
  const receipt: IncrementalCacheReceipt = {
    schema: IOS_INCREMENTAL_BUILD_CACHE_SCHEMA,
    captureRunId: input.captureRunId,
    sourceRoot: input.artifactRoot,
    cacheRoot,
    cacheTreeSha256: hashJson(cacheEntries),
    cacheEntries,
    source: input.source,
    sourceAfter: input.sourceAfter,
    binding: input.binding,
    command,
    captureCleanup: 'cleaned',
    appProductsIncluded: false,
    terminalReceiptsIncluded: false,
  };
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2));
  await writeFile(path.join(input.artifactRoot, IOS_INCREMENTAL_BUILD_CACHE_RECEIPT), bytes, {
    flag: 'wx',
    mode: 0o600,
  });
  return {
    path: IOS_INCREMENTAL_BUILD_CACHE_RECEIPT,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    receipt,
  };
}

export async function writeIosIncrementalBuildCacheResultReceipt(input: {
  artifactRoot: string;
  preparation: IosIncrementalBuildCachePreparation;
  command:
    | (NativeCommandExecution & {
        label: string;
        command: string;
        argv: string[];
        deadlineMs: number;
      })
    | null;
  captureCleanup: string;
}): Promise<{
  path: typeof IOS_INCREMENTAL_BUILD_CACHE_RESULT_RECEIPT;
  sha256: string;
  bytes: number;
}> {
  await requireArtifactRoot(input.artifactRoot, 'incremental cache result artifact root');
  const bytes = Buffer.from(
    JSON.stringify(
      {
        schema: IOS_INCREMENTAL_BUILD_CACHE_SCHEMA,
        preparation: input.preparation,
        freshBuild: {
          command: input.command,
          captureCleanup: input.captureCleanup,
          appProductsReused: false,
          terminalReceiptReused: false,
          promotion: 'never-from-cache',
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(input.artifactRoot, IOS_INCREMENTAL_BUILD_CACHE_RESULT_RECEIPT),
    bytes,
    { flag: 'wx', mode: 0o600 },
  );
  return {
    path: IOS_INCREMENTAL_BUILD_CACHE_RESULT_RECEIPT,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
}

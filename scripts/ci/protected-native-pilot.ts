import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, lstatSync } from 'node:fs';
import { cp, lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PROTECTED_MANUAL_SELECTION = Object.freeze({
  platform: 'ios',
  engine: 'maestro',
  scenario: 'SCN-training-ios',
  mode: 'integration',
});

export const PROTECTED_MANUAL_ASSERTIONS = Object.freeze([
  'NAT-training-normal-entry',
  'NAT-training-local-draft',
  'NAT-training-first-save',
  'NAT-training-edit-draft',
  'NAT-training-edited-save',
  'NAT-training-relaunch-read',
  'NAT-training-unrelated-state',
]);

const CLIENT_REPOSITORY = 'edufelip/MyChampions';
const SERVER_REPOSITORY = 'edufelip/mychampions-api';
const SHA40 = /^[a-f0-9]{40}$/u;
const RUN_ID = /^[a-f0-9]{24}$/u;
const NODE_VERSION = /^v24\./u;
const YARN_VERSION = /^1\.22\./u;
const MAESTRO_VERSION = /(?:^|\s)v?2\.6\.1(?:\s|$)/u;
const XCODE_VERSION = /Xcode\s+26(?:\.\d+)?/u;
const SDK_VERSION = /^26(?:\.\d+)?$/u;
const JAVA_VERSION = /version\s+"17(?:[.\d]*)/u;
export const PROTECTED_BUILD_SOURCE = 'private-restoration' as const;

export type ProtectedManualPilotSelection = typeof PROTECTED_MANUAL_SELECTION;

export type GitCheckoutObservation = {
  name: 'client' | 'server';
  repository: string;
  root: string;
  sha: string;
  dirty: boolean;
  remote: string;
};

export type ProtectedManualToolIdentity = {
  node: string;
  yarn: string;
  maestro: string;
  xcodebuild: string;
  simulatorSdk: string;
  java: string;
};

export type ProtectedManualPilotEnvironment = {
  eventName: string;
  repository: string;
  refProtected: string;
  clientSha: string;
  serverSha: string;
  buildRunId: string;
  nativeHostLockHeld: string;
  nativeStateRoot: string;
  receiptRoot: string;
  outputParent: string;
  requestedRunId: string;
  workspaceRoot: string;
  clientRoot: string;
  serverRoot: string;
  buildCacheRoot: string;
  buildSource: string;
};

export type ProtectedManualPilotContext = {
  environment: ProtectedManualPilotEnvironment;
  client: GitCheckoutObservation;
  server: GitCheckoutObservation;
  tools: ProtectedManualToolIdentity;
};

export type ProtectedManualPilotNativeReceipt = {
  runId?: unknown;
  attemptId?: unknown;
  scenarioId?: unknown;
  layer?: unknown;
  engine?: unknown;
  dataMode?: unknown;
  platform?: unknown;
  repositories?: unknown;
  inputs?: unknown;
  command?: unknown;
  result?: unknown;
  exitCode?: unknown;
  childExitCode?: unknown;
  childSignal?: unknown;
  assertions?: unknown;
  target?: unknown;
  cleanup?: unknown;
  artifacts?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
};

export type ProtectedManualCompactReceipt = {
  schemaVersion: 1;
  kind: 'protected-manual-native-pilot-receipt';
  status: 'passed' | 'failed';
  hostedPromotion: false;
  successArtifactUpload: false;
  selected: ProtectedManualPilotSelection;
  client: { sha: string; dirty: boolean; repository: string };
  server: { sha: string; dirty: boolean; repository: string };
  buildRunId: string;
  qualifiedBuildSource: typeof PROTECTED_BUILD_SOURCE | 'unverified';
  requestedRunId: string;
  attemptId: string;
  toolVersions: ProtectedManualToolIdentity;
  nativeResult: 'passed' | 'failed' | 'harness-blocked' | 'unknown';
  nativeExitCode: number | null;
  assertionIds: string[];
  cleanupStatus: string | null;
  recoveryRecordPath: string | null;
  nativeReceiptSha256: string | null;
  buildRelocation: ProtectedReusableBuildRelocation | null;
  failureReason: string | null;
  policy: 'private-compact-success-or-failure-only-diagnostics-one-day';
  contextValidation: {
    status: 'trusted' | 'untrusted';
    phase: 'none' | 'context' | 'preflight' | 'native' | 'finalization';
    detail: string | null;
  };
  observedEnvironment: {
    eventName: string | null;
    repository: string | null;
    refProtected: string | null;
    clientSha: string | null;
    serverSha: string | null;
    buildRunId: string | null;
    requestedRunId: string | null;
    buildSource: string | null;
  };
};

type GitRunner = (root: string, args: readonly string[]) => string;
type ToolRunner = (command: string, args: readonly string[]) => string;

function bounded(value: unknown, limit = 240): string {
  return (typeof value === 'string' ? value : String(value)).slice(0, limit);
}

function fail(message: string): never {
  throw new Error(`Protected manual native pilot: ${message}`);
}

function requireSha(value: string, label: string): string {
  if (!SHA40.test(value)) fail(`${label} must be a lowercase 40-character commit SHA`);
  return value;
}

function requireRunId(value: string, label: string): string {
  if (!RUN_ID.test(value)) fail(`${label} must be a lowercase 24-character run ID`);
  return value;
}

function requireAbsolute(value: string, label: string): string {
  if (!path.isAbsolute(value) || value.includes('\0')) fail(`${label} must be an absolute path`);
  return value;
}

function normalizeRemote(value: string): string {
  return value
    .trim()
    .replace(/^git@github\.com:/u, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//u, 'https://github.com/')
    .replace(/\.git$/u, '');
}

function defaultGitRunner(root: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024,
    }).trim();
  } catch (error) {
    fail(
      `git ${args[0] ?? 'command'} failed: ${bounded(error instanceof Error ? error.message : error)}`,
    );
  }
}

export function readGitCheckoutObservation(
  root: string,
  name: GitCheckoutObservation['name'],
  runGit: GitRunner = defaultGitRunner,
): GitCheckoutObservation {
  const resolved = path.resolve(root);
  const expectedRepository = name === 'client' ? CLIENT_REPOSITORY : SERVER_REPOSITORY;
  const sha = requireSha(runGit(resolved, ['rev-parse', 'HEAD']), `${name} HEAD`);
  const status = runGit(resolved, ['status', '--porcelain', '--untracked-files=no']);
  const remote = normalizeRemote(runGit(resolved, ['remote', 'get-url', 'origin']));
  return {
    name,
    repository: expectedRepository,
    root: resolved,
    sha,
    dirty: status.length > 0,
    remote,
  };
}

function requirePrivateDirectory(root: string, label: string): void {
  requireAbsolute(root, label);
  const metadata = lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700)
    fail(`${label} must be an existing non-symlink 0700 directory`);
}

function requireToolVersions(tools: ProtectedManualToolIdentity): void {
  if (!NODE_VERSION.test(tools.node)) fail(`Node 24 is required; observed ${bounded(tools.node)}`);
  if (!YARN_VERSION.test(tools.yarn))
    fail(`Yarn 1.22 is required; observed ${bounded(tools.yarn)}`);
  if (!MAESTRO_VERSION.test(tools.maestro))
    fail(`Maestro 2.6.1 is required; observed ${bounded(tools.maestro)}`);
  if (!XCODE_VERSION.test(tools.xcodebuild))
    fail(`Xcode 26.x is required; observed ${bounded(tools.xcodebuild)}`);
  if (!SDK_VERSION.test(tools.simulatorSdk.trim()))
    fail(`iOS simulator SDK 26.x is required; observed ${bounded(tools.simulatorSdk)}`);
  if (!JAVA_VERSION.test(tools.java))
    fail(`Java 17 is required for the pinned Maestro; observed ${bounded(tools.java)}`);
}

export function validateProtectedManualPilotContext(input: ProtectedManualPilotContext): void {
  const { environment: env, client, server, tools } = input;
  if (env.eventName !== 'workflow_dispatch') fail('only workflow_dispatch may invoke this lane');
  if (env.repository !== CLIENT_REPOSITORY)
    fail(`workflow repository must be ${CLIENT_REPOSITORY}`);
  if (env.refProtected !== 'true') fail('the selected branch must be protected');
  requireSha(env.clientSha, 'GITHUB_SHA');
  requireSha(env.serverSha, 'server SHA input');
  requireRunId(env.buildRunId, 'qualified Debug build run ID');
  if (env.buildSource !== PROTECTED_BUILD_SOURCE)
    fail(
      `qualified Debug build must be available through the supported ${PROTECTED_BUILD_SOURCE} path`,
    );
  requireRunId(env.requestedRunId, 'requested pilot run ID');
  if (env.nativeHostLockHeld !== '1') fail('the existing native host lock is not held');
  requirePrivateDirectory(env.nativeStateRoot, 'native state root');
  requireAbsolute(env.outputParent, 'native output parent');
  requireAbsolute(env.receiptRoot, 'private receipt root');
  requireAbsolute(env.workspaceRoot, 'GitHub workspace root');
  requireAbsolute(env.clientRoot, 'client checkout root');
  requireAbsolute(env.serverRoot, 'server checkout root');
  requireAbsolute(env.buildCacheRoot, 'qualified build cache root');
  if (
    client.root !== path.resolve(env.workspaceRoot, 'client') ||
    server.root !== path.resolve(env.workspaceRoot, 'server') ||
    env.clientRoot !== client.root ||
    env.serverRoot !== server.root
  )
    fail('client and server checkouts must be client/server directories inside GITHUB_WORKSPACE');
  const cacheRelative = path.relative(env.workspaceRoot, env.buildCacheRoot);
  if (
    cacheRelative === '' ||
    (!cacheRelative.startsWith(`..${path.sep}`) &&
      cacheRelative !== '..' &&
      !path.isAbsolute(cacheRelative))
  )
    fail('qualified build cache must be outside GITHUB_WORKSPACE');
  if (
    client.repository !== CLIENT_REPOSITORY ||
    client.remote !== `https://github.com/${CLIENT_REPOSITORY}`
  )
    fail('client checkout remote is not the trusted repository');
  if (
    server.repository !== SERVER_REPOSITORY ||
    server.remote !== `https://github.com/${SERVER_REPOSITORY}`
  )
    fail('server checkout remote is not the trusted repository');
  if (client.sha !== env.clientSha) fail('client checkout is not at github.sha');
  if (server.sha !== env.serverSha) fail('server checkout is not at the coordinated SHA');
  if (client.dirty || server.dirty)
    fail('client and server checkouts must be clean before acquisition');
  const expectedServerRoot = path.resolve(env.workspaceRoot, 'server');
  if (server.root !== expectedServerRoot)
    fail('server checkout must be the trusted workspace sibling server');
  requireToolVersions(tools);
}

function defaultToolRunner(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(
      `${command} is unavailable or failed its version check: ${bounded(
        result.error?.message ?? result.stderr ?? `exit ${result.status ?? 'unknown'}`,
      )}`,
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

export function readProtectedManualToolIdentity(
  runTool: ToolRunner = defaultToolRunner,
): ProtectedManualToolIdentity {
  const node = process.version;
  const yarn = runTool('yarn', ['--version']);
  const maestro = runTool('maestro', ['--version']);
  const xcodebuild = runTool('xcodebuild', ['-version']);
  const simulatorSdk = runTool('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']);
  const java = runTool('java', ['-version']);
  const tools = { node, yarn, maestro, xcodebuild, simulatorSdk, java };
  requireToolVersions(tools);
  return tools;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  const value: string | undefined = (env as Record<string, string | undefined>)[name];
  if (!value) fail(`${name} is required`);
  return value;
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export async function validateProtectedBuildCacheRoot(
  cacheRoot: string,
  workspaceRoot: string,
): Promise<string> {
  const resolved = requireAbsolute(cacheRoot, 'qualified build cache root');
  const workspace = requireAbsolute(workspaceRoot, 'GitHub workspace root');
  const workspaceCanonical = await realpath(workspace);
  const metadata = await lstat(resolved);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    metadata.uid !== process.getuid?.()
  )
    fail('qualified build cache must be an existing owned non-symlink 0700 directory');
  const canonical = await realpath(resolved);
  if (pathWithin(workspaceCanonical, canonical))
    fail('qualified build cache must be outside GITHUB_WORKSPACE');
  return canonical;
}

type ProtectedSourceIdentity = {
  sha: string;
  dirty: boolean;
  sourceTreeHash: string;
};

type ReusableBuildModule = {
  resolveReusableIosEntryEvidencePaths(
    capture: unknown,
    evidence: unknown,
  ): { screenshotPath: string; hierarchyPath: string };
  loadReusableIosBuild(
    root: string,
    runId: string,
    current: ProtectedSourceIdentity,
    options?: { sourceRoot?: string },
  ): Promise<unknown>;
  validateReusableIosBuild(
    capture: unknown,
    qualification: unknown,
    current: ProtectedSourceIdentity,
  ): unknown;
};

type SourceIdentityModule = {
  sourceIdentity(root: string): Promise<ProtectedSourceIdentity>;
  treeHash(root: string): Promise<string>;
};

type IntegrationPreflightModule = {
  assertResolvedIntegratedExpoConfig(extra: Record<string, unknown>, apiOrigin: string): void;
};

type RuntimePreflightModule = {
  assertNativeBootstrapHealthy(diagnostics: string): void;
};

async function loadReusableBuildModules(clientRoot: string): Promise<{
  reuse: ReusableBuildModule;
  source: SourceIdentityModule;
  integration: IntegrationPreflightModule;
  runtime: RuntimePreflightModule;
}> {
  const reusePath = path.join(clientRoot, 'scripts/testing/native-build-reuse.ts');
  const identityPath = path.join(clientRoot, 'scripts/testing/native-build-identity.ts');
  const integrationPath = path.join(clientRoot, 'scripts/testing/integration-preflight.ts');
  const runtimePath = path.join(clientRoot, 'scripts/testing/native-runtime-preflight.ts');
  const reuse = (await import(reusePath)) as ReusableBuildModule;
  const source = (await import(identityPath)) as SourceIdentityModule;
  const integration = (await import(integrationPath)) as IntegrationPreflightModule;
  const runtime = (await import(runtimePath)) as RuntimePreflightModule;
  if (
    typeof reuse.resolveReusableIosEntryEvidencePaths !== 'function' ||
    typeof reuse.loadReusableIosBuild !== 'function' ||
    typeof reuse.validateReusableIosBuild !== 'function' ||
    typeof source.treeHash !== 'function' ||
    typeof integration.assertResolvedIntegratedExpoConfig !== 'function' ||
    typeof runtime.assertNativeBootstrapHealthy !== 'function'
  )
    fail('qualified build modules do not expose the relocation validation contract');
  return { reuse, source, integration, runtime };
}

type PrivateBuildRecord = {
  value: Record<string, unknown>;
  bytes: Buffer;
  sha256: string;
};

type BuildArtifactEvidence = {
  binaryHash: string;
  config: Buffer;
  bootstrap: Buffer;
  entryScreenshot?: Buffer;
  entryHierarchy?: Buffer;
};

export type ProtectedReusableBuildRelocation = {
  readonly schemaVersion: 1;
  readonly sourceRunId: string;
  readonly sourceRunDirectory: string;
  readonly destinationRunDirectory: string;
  readonly sourceCaptureSha256: string;
  readonly destinationCaptureSha256: string;
  readonly sourceQualificationSha256: string;
  readonly destinationQualificationSha256: string;
  readonly sourceBinaryPath: string;
  readonly destinationBinaryPath: string;
  readonly binaryHash: string;
  readonly sourceConfigSha256: string;
  readonly destinationConfigSha256: string;
  readonly sourceBootstrapSha256: string;
  readonly destinationBootstrapSha256: string;
  readonly sourceEntryScreenshotSha256: string | null;
  readonly destinationEntryScreenshotSha256: string | null;
  readonly sourceEntryHierarchySha256: string | null;
  readonly destinationEntryHierarchySha256: string | null;
};

const REUSABLE_BINARY_RELATIVE = 'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app';
const REUSABLE_CONFIG_RELATIVE =
  'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app/EXConstants.bundle/app.config';
const REUSABLE_BOOTSTRAP_NAME = 'bootstrap.private.log';

// Relocation metadata is only publishable when it came from the validated
// producer in this module. The frozen value prevents post-validation mutation;
// a caller cannot manufacture WeakSet membership with a copied object.
const validatedRelocations = new WeakSet<object>();

function requireRecordString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0'))
    fail(`${label} must be a non-empty string`);
  return value;
}

function requireSha256(value: unknown, label: string): string {
  const result = requireRecordString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) fail(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function sameBytes(left: Buffer, right: Buffer, label: string): void {
  if (!left.equals(right)) fail(`${label} bytes changed during relocation`);
}

/**
 * A build ID is only a lookup key. This boundary requires the relocation
 * receipt produced after the exact client checkout was validated, and binds
 * both source and destination paths to the protected run.
 */
function assertProtectedBuildAvailability(
  context: ProtectedManualPilotContext,
  relocation: ProtectedReusableBuildRelocation,
): void {
  if (!validatedRelocations.has(relocation as object))
    fail('qualified Debug build relocation was not produced by the protected validator');
  if (context.environment.buildSource !== PROTECTED_BUILD_SOURCE)
    fail('qualified Debug build source is not the supported private restoration path');
  if (relocation.schemaVersion !== 1 || relocation.sourceRunId !== context.environment.buildRunId)
    fail('qualified Debug build relocation is not bound to the requested restored run');
  const sourceDirectory = path.resolve(relocation.sourceRunDirectory);
  const destinationDirectory = path.resolve(relocation.destinationRunDirectory);
  const workspaceRoot = path.resolve(context.environment.workspaceRoot);
  const expectedDestination = path.resolve(
    context.client.root,
    '.qa/artifacts/native-pilot',
    context.environment.buildRunId,
  );
  if (!path.isAbsolute(relocation.sourceRunDirectory) || pathWithin(workspaceRoot, sourceDirectory))
    fail('qualified Debug build source must be an external private restoration directory');
  if (destinationDirectory !== expectedDestination)
    fail('qualified Debug build destination is not bound to the exact client checkout');
  if (
    relocation.sourceBinaryPath !== path.join(sourceDirectory, REUSABLE_BINARY_RELATIVE) ||
    relocation.destinationBinaryPath !== path.join(destinationDirectory, REUSABLE_BINARY_RELATIVE)
  )
    fail('qualified Debug build binary path is not bound to the relocation directories');
  for (const [label, value] of [
    ['source capture', relocation.sourceCaptureSha256],
    ['destination capture', relocation.destinationCaptureSha256],
    ['source qualification', relocation.sourceQualificationSha256],
    ['destination qualification', relocation.destinationQualificationSha256],
    ['binary', relocation.binaryHash],
    ['source config', relocation.sourceConfigSha256],
    ['destination config', relocation.destinationConfigSha256],
    ['source bootstrap', relocation.sourceBootstrapSha256],
    ['destination bootstrap', relocation.destinationBootstrapSha256],
  ] as const)
    requireSha256(value, `qualified Debug build ${label} hash`);
  if (
    relocation.sourceCaptureSha256 !== relocation.destinationCaptureSha256 ||
    relocation.sourceQualificationSha256 !== relocation.destinationQualificationSha256 ||
    relocation.sourceConfigSha256 !== relocation.destinationConfigSha256 ||
    relocation.sourceBootstrapSha256 !== relocation.destinationBootstrapSha256
  )
    fail('qualified Debug build restoration changed protected receipt or bootstrap bytes');
  for (const [label, value] of [
    ['source entry screenshot', relocation.sourceEntryScreenshotSha256],
    ['destination entry screenshot', relocation.destinationEntryScreenshotSha256],
    ['source entry hierarchy', relocation.sourceEntryHierarchySha256],
    ['destination entry hierarchy', relocation.destinationEntryHierarchySha256],
  ] as const) {
    if (value !== null) requireSha256(value, `qualified Debug build ${label} hash`);
  }
  if (
    relocation.sourceEntryScreenshotSha256 !== relocation.destinationEntryScreenshotSha256 ||
    relocation.sourceEntryHierarchySha256 !== relocation.destinationEntryHierarchySha256
  )
    fail('qualified Debug build restoration changed protected entry evidence bytes');
}

function sha256Bytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableFileIdentity(value: {
  dev: number;
  ino: number;
  uid: number;
  mode: number;
  nlink: number;
  size: number;
}): string {
  return JSON.stringify({
    dev: value.dev,
    ino: value.ino,
    uid: value.uid,
    mode: value.mode & 0o777,
    nlink: value.nlink,
    size: value.size,
  });
}

async function readBoundedOwnedFile(
  filePath: string,
  ownerUid: number,
  label: string,
  maxBytes: number,
): Promise<Buffer> {
  const resolved = requireAbsolute(filePath, label);
  const parent = path.dirname(resolved);
  const parentBefore = await lstat(parent);
  if (
    !parentBefore.isDirectory() ||
    parentBefore.isSymbolicLink() ||
    (await realpath(parent)) !== parent
  )
    fail(`${label} parent is not a canonical directory`);
  const before = await lstat(resolved);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.uid !== ownerUid ||
    before.size > maxBytes ||
    (await realpath(resolved)) !== resolved
  )
    fail(`${label} is not a bounded owned regular file`);
  const noFollow = fsConstants.O_NOFOLLOW;
  if (typeof noFollow !== 'number') fail('the host does not provide O_NOFOLLOW');
  const handle = await open(resolved, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    const expectedIdentity = stableFileIdentity(before);
    if (
      !opened.isFile() ||
      opened.uid !== ownerUid ||
      opened.nlink !== 1 ||
      stableFileIdentity(opened) !== expectedIdentity
    )
      fail(`${label} identity changed before descriptor read`);
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== before.size) fail(`${label} changed during bounded descriptor read`);
    const after = await handle.stat();
    const pathAfter = await lstat(resolved);
    const parentAfter = await lstat(parent);
    if (
      !after.isFile() ||
      stableFileIdentity(after) !== expectedIdentity ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      stableFileIdentity(pathAfter) !== expectedIdentity ||
      !parentAfter.isDirectory() ||
      parentAfter.isSymbolicLink() ||
      parentAfter.dev !== parentBefore.dev ||
      parentAfter.ino !== parentBefore.ino ||
      (await realpath(parent)) !== parent ||
      (await realpath(resolved)) !== resolved
    )
      fail(`${label} identity changed during bounded descriptor read`);
    return buffer.subarray(0, before.size);
  } finally {
    await handle.close();
  }
}

async function readPrivateBuildRecord(
  directory: string,
  name: string,
): Promise<PrivateBuildRecord> {
  const file = path.join(directory, name);
  const metadata = await lstat(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.uid !== process.getuid?.() ||
    (await realpath(file)) !== file
  )
    fail(
      `native build record ${name} is not a private owned regular file (file ${metadata.isFile()}, symlink ${metadata.isSymbolicLink()}, mode ${(metadata.mode & 0o777).toString(8)}, uid ${metadata.uid}/${process.getuid?.()}, nlink ${metadata.nlink}, realpath ${await realpath(file)} / ${file})`,
    );
  const read = await readProtectedNativeReceipt(file);
  if (read.bytes.length > 256 * 1024) fail(`native build record ${name} is too large`);
  return {
    value: recordMap(read.value, `native build ${name}`),
    bytes: read.bytes,
    sha256: read.sha256,
  };
}

async function readBuildEntryEvidence(
  directory: string,
  capture: unknown,
  qualification: Record<string, unknown>,
  ownerUid: number,
  resolveEntryEvidencePaths: ReusableBuildModule['resolveReusableIosEntryEvidencePaths'],
): Promise<{ screenshot: Buffer; hierarchy: Buffer }> {
  const raw = qualification.entryEvidence;
  const evidence = recordMap(raw, 'native build entry evidence');
  const screenshotHash = requireSha256(evidence.screenshotHash, 'entry screenshot hash');
  const hierarchyHash = requireSha256(evidence.hierarchyHash, 'entry hierarchy hash');
  const resolved = resolveEntryEvidencePaths(capture, evidence);
  if (
    resolved.screenshotPath !== 'entry.png' ||
    !['entry-hierarchy.json', 'entry-hierarchy.private.log'].includes(resolved.hierarchyPath)
  )
    fail('native build entry evidence resolver returned an unsupported path');
  const screenshot = await readBoundedOwnedFile(
    path.join(directory, resolved.screenshotPath),
    ownerUid,
    'native build entry screenshot',
    8 * 1024 * 1024,
  );
  const hierarchy = await readBoundedOwnedFile(
    path.join(directory, resolved.hierarchyPath),
    ownerUid,
    'native build entry hierarchy',
    8 * 1024 * 1024,
  );
  if (createHash('sha256').update(screenshot).digest('hex') !== screenshotHash)
    fail('native build entry screenshot hash differs from its qualification record');
  if (createHash('sha256').update(hierarchy).digest('hex') !== hierarchyHash)
    fail('native build entry hierarchy hash differs from its qualification record');
  if (screenshot.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    fail('native build entry screenshot is not PNG');
  if (
    !['auth.signIn.emailInput', 'auth.signIn.passwordInput', 'auth.signIn.submitButton'].every(
      (id) => hierarchy.includes(id),
    )
  )
    fail('native build entry hierarchy lacks required sign-in selectors');
  return { screenshot, hierarchy };
}

async function collectBuildArtifactEvidence(
  directory: string,
  build: Record<string, unknown>,
  capture: unknown,
  qualification: Record<string, unknown>,
  ownerUid: number,
  support: {
    source: SourceIdentityModule;
    integration: IntegrationPreflightModule;
    runtime: RuntimePreflightModule;
    resolveEntryEvidencePaths: ReusableBuildModule['resolveReusableIosEntryEvidencePaths'];
  },
): Promise<BuildArtifactEvidence> {
  const binaryHash = requireSha256(build.binaryHash, 'native build binary hash');
  const binaryPath = requireRecordString(build.binaryPath, 'native build binary path');
  const expectedBinary = path.join(directory, REUSABLE_BINARY_RELATIVE);
  if (binaryPath !== expectedBinary || (await realpath(expectedBinary)) !== expectedBinary)
    fail('native build binary path is not bound to the expected private run directory');
  const binaryBefore = await lstat(expectedBinary);
  if (
    binaryBefore.isSymbolicLink() ||
    (!binaryBefore.isDirectory() && !binaryBefore.isFile()) ||
    binaryBefore.uid !== ownerUid
  )
    fail('native build binary is not an owned canonical bundle');
  const binaryIdentity = stableFileIdentity(binaryBefore);
  if ((await support.source.treeHash(expectedBinary)) !== binaryHash)
    fail('native build binary bytes differ from the qualified binary hash');
  const binaryAfter = await lstat(expectedBinary);
  if (
    binaryAfter.isSymbolicLink() ||
    stableFileIdentity(binaryAfter) !== binaryIdentity ||
    (await realpath(expectedBinary)) !== expectedBinary
  )
    fail('native build binary identity changed during relocation validation');

  const config = await readBoundedOwnedFile(
    path.join(directory, REUSABLE_CONFIG_RELATIVE),
    ownerUid,
    'native build resolved Expo config',
    256 * 1024,
  );
  const parsedConfig = recordMap(
    JSON.parse(config.toString('utf8')),
    'native build resolved config',
  );
  const extra = recordMap(parsedConfig.extra, 'native build resolved config extra');
  support.integration.assertResolvedIntegratedExpoConfig(
    extra,
    requireRecordString(build.apiOrigin, 'native build API origin'),
  );
  const bootstrap = await readBoundedOwnedFile(
    path.join(directory, REUSABLE_BOOTSTRAP_NAME),
    ownerUid,
    'native build bootstrap log',
    1024 * 1024,
  );
  support.runtime.assertNativeBootstrapHealthy(bootstrap.toString('utf8'));

  let entryScreenshot: Buffer | undefined;
  let entryHierarchy: Buffer | undefined;
  if (qualification.entryEvidence !== undefined) {
    const entry = await readBuildEntryEvidence(
      directory,
      capture,
      qualification,
      ownerUid,
      support.resolveEntryEvidencePaths,
    );
    entryScreenshot = entry.screenshot;
    entryHierarchy = entry.hierarchy;
  }
  return { binaryHash, config, bootstrap, entryScreenshot, entryHierarchy };
}

async function validateRelocatedReusableBuild(input: {
  sourceDirectory: string;
  destinationDirectory: string;
  sourceRecords: {
    capture: PrivateBuildRecord;
    qualification: PrivateBuildRecord;
  };
  current: ProtectedSourceIdentity;
  reuse: ReusableBuildModule;
  source: SourceIdentityModule;
  integration: IntegrationPreflightModule;
  runtime: RuntimePreflightModule;
}): Promise<{
  build: Record<string, unknown>;
  relocation: ProtectedReusableBuildRelocation;
}> {
  const sourceCapture = await readPrivateBuildRecord(input.sourceDirectory, 'capture.private.json');
  const sourceQualification = await readPrivateBuildRecord(
    input.sourceDirectory,
    'entry-qualification.private.json',
  );
  sameBytes(sourceCapture.bytes, input.sourceRecords.capture.bytes, 'source capture receipt');
  sameBytes(
    sourceQualification.bytes,
    input.sourceRecords.qualification.bytes,
    'source qualification receipt',
  );
  const destinationCapture = await readPrivateBuildRecord(
    input.destinationDirectory,
    'capture.private.json',
  );
  const destinationQualification = await readPrivateBuildRecord(
    input.destinationDirectory,
    'entry-qualification.private.json',
  );
  sameBytes(destinationCapture.bytes, sourceCapture.bytes, 'relocated capture receipt');
  sameBytes(
    destinationQualification.bytes,
    sourceQualification.bytes,
    'relocated qualification receipt',
  );

  const sourceBuild = recordMap(sourceCapture.value.build, 'source native build');
  const sourceBinaryPath = requireRecordString(sourceBuild.binaryPath, 'source native build path');
  const expectedSourceBinary = path.join(input.sourceDirectory, REUSABLE_BINARY_RELATIVE);
  if (sourceBinaryPath !== expectedSourceBinary)
    fail('source capture receipt is not bound to the qualified cache run directory');
  const destinationBuildPath = path.join(input.destinationDirectory, REUSABLE_BINARY_RELATIVE);
  const reboundCapture = structuredClone(sourceCapture.value);
  reboundCapture.build = { ...sourceBuild, binaryPath: destinationBuildPath };
  const reboundBuild = recordMap(
    input.reuse.validateReusableIosBuild(
      reboundCapture,
      destinationQualification.value,
      input.current,
    ),
    'relocated native build',
  );
  if (
    reboundBuild.binaryPath !== destinationBuildPath ||
    reboundBuild.binaryHash !== sourceBuild.binaryHash
  )
    fail('relocated native build validator changed the qualified build identity');

  const resolveEntryEvidencePaths: ReusableBuildModule['resolveReusableIosEntryEvidencePaths'] = (
    capture,
    evidence,
  ) => input.reuse.resolveReusableIosEntryEvidencePaths(capture, evidence);

  const sourceEvidence = await collectBuildArtifactEvidence(
    input.sourceDirectory,
    sourceBuild,
    sourceCapture.value,
    sourceQualification.value,
    process.getuid?.() ?? -1,
    {
      ...input,
      resolveEntryEvidencePaths,
    },
  );
  const destinationEvidence = await collectBuildArtifactEvidence(
    input.destinationDirectory,
    reboundBuild,
    destinationCapture.value,
    destinationQualification.value,
    process.getuid?.() ?? -1,
    {
      ...input,
      resolveEntryEvidencePaths,
    },
  );
  sameBytes(sourceEvidence.config, destinationEvidence.config, 'resolved Expo config');
  sameBytes(sourceEvidence.bootstrap, destinationEvidence.bootstrap, 'bootstrap log');
  if (sourceEvidence.entryScreenshot && destinationEvidence.entryScreenshot)
    sameBytes(
      sourceEvidence.entryScreenshot,
      destinationEvidence.entryScreenshot,
      'entry screenshot',
    );
  if (sourceEvidence.entryHierarchy && destinationEvidence.entryHierarchy)
    sameBytes(sourceEvidence.entryHierarchy, destinationEvidence.entryHierarchy, 'entry hierarchy');
  if (Boolean(sourceEvidence.entryScreenshot) !== Boolean(destinationEvidence.entryScreenshot))
    fail('relocated entry evidence presence changed');
  const hashBytes = (value: Buffer | undefined): string | null =>
    value ? sha256Bytes(value) : null;
  const relocation: ProtectedReusableBuildRelocation = Object.freeze({
    schemaVersion: 1,
    sourceRunId: path.basename(input.sourceDirectory),
    sourceRunDirectory: input.sourceDirectory,
    destinationRunDirectory: input.destinationDirectory,
    sourceCaptureSha256: input.sourceRecords.capture.sha256,
    destinationCaptureSha256: destinationCapture.sha256,
    sourceQualificationSha256: input.sourceRecords.qualification.sha256,
    destinationQualificationSha256: destinationQualification.sha256,
    sourceBinaryPath,
    destinationBinaryPath: destinationBuildPath,
    binaryHash: sourceEvidence.binaryHash,
    sourceConfigSha256: sha256Bytes(sourceEvidence.config),
    destinationConfigSha256: sha256Bytes(destinationEvidence.config),
    sourceBootstrapSha256: sha256Bytes(sourceEvidence.bootstrap),
    destinationBootstrapSha256: sha256Bytes(destinationEvidence.bootstrap),
    sourceEntryScreenshotSha256: hashBytes(sourceEvidence.entryScreenshot),
    destinationEntryScreenshotSha256: hashBytes(destinationEvidence.entryScreenshot),
    sourceEntryHierarchySha256: hashBytes(sourceEvidence.entryHierarchy),
    destinationEntryHierarchySha256: hashBytes(destinationEvidence.entryHierarchy),
  });
  validatedRelocations.add(relocation);
  return { build: reboundBuild, relocation };
}

export async function restoreProtectedReusableBuild(
  context: ProtectedManualPilotContext,
): Promise<ProtectedReusableBuildRelocation> {
  const cacheRoot = await validateProtectedBuildCacheRoot(
    context.environment.buildCacheRoot,
    context.environment.workspaceRoot,
  );
  const { reuse, source, integration, runtime } = await loadReusableBuildModules(
    context.client.root,
  );
  const current = await source.sourceIdentity(context.client.root);
  const sourceDirectory = path.join(
    cacheRoot,
    '.qa/artifacts/native-pilot',
    context.environment.buildRunId,
  );
  const sourceRecords = {
    capture: await readPrivateBuildRecord(sourceDirectory, 'capture.private.json'),
    qualification: await readPrivateBuildRecord(
      sourceDirectory,
      'entry-qualification.private.json',
    ),
  };
  await reuse.loadReusableIosBuild(cacheRoot, context.environment.buildRunId, current);
  const sourceMetadata = await lstat(sourceDirectory);
  if (
    !sourceMetadata.isDirectory() ||
    sourceMetadata.isSymbolicLink() ||
    (sourceMetadata.mode & 0o777) !== 0o700 ||
    sourceMetadata.uid !== process.getuid?.() ||
    (await realpath(sourceDirectory)) !== sourceDirectory
  )
    fail('qualified build cache run directory is not a private owned directory');
  const destinationParent = path.join(context.client.root, '.qa/artifacts/native-pilot');
  let currentPath = context.client.root;
  for (const segment of ['.qa', 'artifacts', 'native-pilot']) {
    currentPath = path.join(currentPath, segment);
    try {
      const metadata = await lstat(currentPath);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        (metadata.mode & 0o777) !== 0o700 ||
        metadata.uid !== process.getuid?.()
      )
        fail('client build destination contains a non-directory path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(currentPath, { mode: 0o700 });
    }
  }
  const destination = path.join(destinationParent, context.environment.buildRunId);
  try {
    await lstat(destination);
    fail('client build destination already exists; refusing to overwrite it');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await cp(sourceDirectory, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  const relocatedBuild = await reuse.loadReusableIosBuild(
    context.client.root,
    context.environment.buildRunId,
    current,
    { sourceRoot: cacheRoot },
  );
  const relocatedBinaryPath = recordMap(relocatedBuild, 'relocated production build').binaryPath;
  if (relocatedBinaryPath !== path.join(destination, REUSABLE_BINARY_RELATIVE))
    fail('production reuse loader did not return the restored destination binary');
  const validation = await validateRelocatedReusableBuild({
    sourceDirectory,
    destinationDirectory: destination,
    sourceRecords,
    current,
    reuse,
    source,
    integration,
    runtime,
  });
  assertProtectedBuildAvailability(context, validation.relocation);
  return validation.relocation;
}

export async function validateInstalledProtectedReusableBuild(
  context: ProtectedManualPilotContext,
): Promise<ProtectedReusableBuildRelocation> {
  const { reuse, source, integration, runtime } = await loadReusableBuildModules(
    context.client.root,
  );
  const current = await source.sourceIdentity(context.client.root);
  const sourceRoot = await validateProtectedBuildCacheRoot(
    context.environment.buildCacheRoot,
    context.environment.workspaceRoot,
  );
  const sourceDirectory = path.join(
    sourceRoot,
    '.qa/artifacts/native-pilot',
    context.environment.buildRunId,
  );
  const destinationDirectory = path.join(
    context.client.root,
    '.qa/artifacts/native-pilot',
    context.environment.buildRunId,
  );
  const sourceRecords = {
    capture: await readPrivateBuildRecord(sourceDirectory, 'capture.private.json'),
    qualification: await readPrivateBuildRecord(
      sourceDirectory,
      'entry-qualification.private.json',
    ),
  };
  await reuse.loadReusableIosBuild(sourceRoot, context.environment.buildRunId, current);
  const relocatedBuild = await reuse.loadReusableIosBuild(
    context.client.root,
    context.environment.buildRunId,
    current,
    { sourceRoot },
  );
  if (
    recordMap(relocatedBuild, 'installed relocated production build').binaryPath !==
    path.join(destinationDirectory, REUSABLE_BINARY_RELATIVE)
  )
    fail('production reuse loader did not return the installed destination binary');
  const validation = await validateRelocatedReusableBuild({
    sourceDirectory,
    destinationDirectory,
    sourceRecords,
    current,
    reuse,
    source,
    integration,
    runtime,
  });
  assertProtectedBuildAvailability(context, validation.relocation);
  return validation.relocation;
}

export function protectedManualEnvironmentFromProcess(
  env: NodeJS.ProcessEnv = process.env,
): ProtectedManualPilotEnvironment {
  const values = env as Record<string, string | undefined>;
  const workspaceRoot = values.GITHUB_WORKSPACE ?? '';
  return {
    eventName: values.GITHUB_EVENT_NAME ?? '',
    repository: values.GITHUB_REPOSITORY ?? '',
    refProtected: values.GITHUB_REF_PROTECTED ?? '',
    clientSha: values.GITHUB_SHA ?? '',
    serverSha: values.MYCHAMPIONS_SERVER_SHA ?? '',
    buildRunId: values.MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID ?? '',
    nativeHostLockHeld: values.MYCHAMPIONS_NATIVE_HOST_LOCK_HELD ?? '',
    nativeStateRoot: values.MYCHAMPIONS_NATIVE_STATE_ROOT ?? '',
    receiptRoot: values.MYCHAMPIONS_PRIVATE_RECEIPT_ROOT ?? '',
    outputParent: values.MYCHAMPIONS_NATIVE_OUTPUT_PARENT ?? '',
    requestedRunId: values.MYCHAMPIONS_NATIVE_REQUESTED_RUN_ID ?? '',
    workspaceRoot,
    clientRoot: values.MYCHAMPIONS_CLIENT_ROOT ?? path.join(workspaceRoot, 'client'),
    serverRoot: values.MYCHAMPIONS_SERVER_ROOT ?? path.join(workspaceRoot, 'server'),
    buildCacheRoot: values.MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT ?? '',
    buildSource: values.MYCHAMPIONS_NATIVE_BUILD_SOURCE ?? '',
  };
}

export async function preparePrivateReceiptRoot(root: string): Promise<string> {
  const resolved = requireAbsolute(root, 'private receipt root');
  const parent = path.dirname(resolved);
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink())
    fail('private receipt root parent must be an existing non-symlink directory');
  try {
    await mkdir(resolved, { mode: 0o700 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;
  }
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700)
    fail('private receipt root is not a private directory');
  return resolved;
}

export async function readProtectedNativeReceipt(receiptPath: string): Promise<{
  value: ProtectedManualPilotNativeReceipt;
  bytes: Buffer;
  sha256: string;
}> {
  const resolved = requireAbsolute(receiptPath, 'native receipt path');
  const parent = path.dirname(resolved);
  const parentMetadata = await lstat(parent);
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    (parentMetadata.mode & 0o777) !== 0o700 ||
    (await realpath(parent)) !== parent
  )
    fail('native receipt parent must be an existing private directory');
  const metadata = await lstat(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (await realpath(resolved)) !== resolved
  )
    fail('native receipt must be a single regular file');
  if (metadata.size > 256 * 1024) fail('native receipt exceeds the compact bounded read limit');
  const noFollow = fsConstants.O_NOFOLLOW;
  if (typeof noFollow !== 'number')
    fail('the host does not provide O_NOFOLLOW for native receipt reads');
  const handle = await open(resolved, fsConstants.O_RDONLY | noFollow);
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.uid !== metadata.uid ||
      (opened.mode & 0o777) !== (metadata.mode & 0o777) ||
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.size !== metadata.size
    )
      fail('native receipt identity changed before descriptor read');
    const buffer = Buffer.alloc(metadata.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== metadata.size) fail('native receipt changed during bounded descriptor read');
    bytes = buffer.subarray(0, metadata.size);
    const after = await handle.stat();
    const pathAfter = await lstat(resolved);
    const parentAfter = await lstat(parent);
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.uid !== metadata.uid ||
      (after.mode & 0o777) !== (metadata.mode & 0o777) ||
      after.dev !== metadata.dev ||
      after.ino !== metadata.ino ||
      after.size !== metadata.size ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1 ||
      pathAfter.uid !== metadata.uid ||
      (pathAfter.mode & 0o777) !== (metadata.mode & 0o777) ||
      pathAfter.dev !== metadata.dev ||
      pathAfter.ino !== metadata.ino ||
      pathAfter.size !== metadata.size ||
      !parentAfter.isDirectory() ||
      parentAfter.isSymbolicLink() ||
      parentAfter.uid !== parentMetadata.uid ||
      (parentAfter.mode & 0o777) !== (parentMetadata.mode & 0o777) ||
      parentAfter.dev !== parentMetadata.dev ||
      parentAfter.ino !== parentMetadata.ino ||
      (await realpath(parent)) !== parent ||
      (await realpath(resolved)) !== resolved
    )
      fail('native receipt identity changed during descriptor read');
  } finally {
    await handle.close();
  }
  return {
    value: JSON.parse(bytes.toString('utf8')) as ProtectedManualPilotNativeReceipt,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function recordMap(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is malformed`);
  return value as Record<string, unknown>;
}

function requireRepositoryRows(value: unknown, clientSha: string, serverSha: string): void {
  if (!Array.isArray(value) || value.length !== 2)
    fail('native receipt repository rows are incomplete');
  const rows = value.map((row) => recordMap(row, 'repository row'));
  const client = rows.find((row) => row.name === 'client');
  const server = rows.find((row) => row.name === 'server');
  if (!client || !server) fail('native receipt must contain client and server rows');
  if (client.sha !== clientSha || server.sha !== serverSha)
    fail('native receipt repository SHA differs from the checked out pair');
  if (client.dirty !== false || server.dirty !== false)
    fail('native receipt repository rows must be clean');
}

function requirePassedNativeReceipt(
  receipt: ProtectedManualPilotNativeReceipt,
  context: ProtectedManualPilotContext,
): string[] {
  if (receipt.result !== 'passed' || receipt.exitCode !== 0) fail('native receipt did not pass');
  if (
    receipt.scenarioId !== PROTECTED_MANUAL_SELECTION.scenario ||
    receipt.platform !== PROTECTED_MANUAL_SELECTION.platform ||
    receipt.engine !== PROTECTED_MANUAL_SELECTION.engine ||
    receipt.layer !== 'native' ||
    receipt.dataMode !== 'postgres'
  )
    fail('native receipt selection is not the protected iOS Maestro training cell');
  if (receipt.attemptId !== `${context.environment.requestedRunId}:first`)
    fail('native receipt is not the requested first attempt');
  if (receipt.runId !== context.environment.requestedRunId)
    fail('native receipt run identity differs from the requested run');
  requireRepositoryRows(
    receipt.repositories,
    context.environment.clientSha,
    context.environment.serverSha,
  );
  const inputs = recordMap(receipt.inputs, 'native receipt inputs');
  const tools = recordMap(inputs.toolVersions, 'native receipt tool versions');
  if (
    tools.maestro !== context.tools.maestro ||
    tools.maestro !== '2.6.1' ||
    tools.node !== context.tools.node
  )
    fail('native receipt does not retain the actual Maestro/Node versions');
  const target = recordMap(receipt.target, 'native receipt target');
  if (
    typeof target.buildProfile !== 'string' ||
    !/debug/i.test(target.buildProfile) ||
    /^\s*release\b/i.test(target.buildProfile) ||
    /\brelease\s+(?:build|mode|configuration)\b/i.test(target.buildProfile)
  )
    fail('native receipt is not a Metro-attached Debug snapshot');
  if (receipt.childExitCode !== 0 || receipt.childSignal !== null)
    fail('native child did not complete without a signal');
  const cleanup = recordMap(receipt.cleanup, 'native receipt cleanup');
  if (cleanup.status !== 'cleaned' || cleanup.recoveryRecordPath !== null)
    fail('native cleanup was not independently clean with no recovery record');
  if (!Array.isArray(receipt.assertions) || receipt.assertions.length !== 7)
    fail('native receipt does not contain all seven training assertions');
  const rows = receipt.assertions.map((row) => recordMap(row, 'native assertion'));
  const ids = rows.map((row) => row.id);
  if (
    new Set(ids).size !== ids.length ||
    [...PROTECTED_MANUAL_ASSERTIONS].some((id) => !ids.includes(id)) ||
    rows.some((row) => row.outcome !== 'passed')
  )
    fail('native receipt assertion ledger is incomplete or failed');
  return ids.map(String);
}

export function validateProtectedNativeReceipt(
  receipt: ProtectedManualPilotNativeReceipt,
  context: ProtectedManualPilotContext,
): string[] {
  return requirePassedNativeReceipt(receipt, context);
}

function makeCompactProtectedReceipt(input: {
  context: ProtectedManualPilotContext;
  nativeReceipt: ProtectedManualPilotNativeReceipt | null;
  nativeReceiptSha256: string | null;
  buildRelocation?: ProtectedReusableBuildRelocation | null;
  commandExitCode: number;
  failureReason: string | null;
  contextValidation?: ProtectedManualCompactReceipt['contextValidation'];
  observedEnvironment?: ProtectedManualCompactReceipt['observedEnvironment'];
}): ProtectedManualCompactReceipt {
  if (input.context.environment.buildSource !== PROTECTED_BUILD_SOURCE)
    fail('cannot publish a compact receipt without verified private build restoration');
  const successful = input.failureReason === null;
  const requestedBuildRelocation = input.buildRelocation ?? null;
  let validatedAssertionIds: string[] = [];
  if (input.failureReason === null) {
    if (input.nativeReceipt === null || input.nativeReceiptSha256 === null)
      fail('cannot promote a successful native receipt without protected native evidence');
    if (input.commandExitCode !== 0)
      fail('cannot promote a successful native receipt after a nonzero native command');
    if (requestedBuildRelocation === null)
      fail('cannot promote a successful native receipt without qualified Debug build availability');
    requireSha256(input.nativeReceiptSha256, 'protected native receipt hash');
    validatedAssertionIds = validateProtectedNativeReceipt(input.nativeReceipt, input.context);
    assertProtectedBuildAvailability(input.context, requestedBuildRelocation);
  }
  const receipt = successful ? input.nativeReceipt : null;
  const buildRelocation = successful ? requestedBuildRelocation : null;
  const cleanup =
    receipt &&
    receipt.cleanup &&
    typeof receipt.cleanup === 'object' &&
    !Array.isArray(receipt.cleanup)
      ? (receipt.cleanup as { status?: unknown; recoveryRecordPath?: unknown })
      : undefined;
  return {
    schemaVersion: 1,
    kind: 'protected-manual-native-pilot-receipt',
    status: input.failureReason === null ? 'passed' : 'failed',
    hostedPromotion: false,
    successArtifactUpload: false,
    selected: PROTECTED_MANUAL_SELECTION,
    client: {
      sha: input.context.client.sha,
      dirty: input.context.client.dirty,
      repository: input.context.client.repository,
    },
    server: {
      sha: input.context.server.sha,
      dirty: input.context.server.dirty,
      repository: input.context.server.repository,
    },
    buildRunId: input.context.environment.buildRunId,
    qualifiedBuildSource: PROTECTED_BUILD_SOURCE,
    requestedRunId: input.context.environment.requestedRunId,
    attemptId: `${input.context.environment.requestedRunId}:first`,
    toolVersions: input.context.tools,
    nativeResult:
      receipt && typeof receipt.result === 'string'
        ? (receipt.result as ProtectedManualCompactReceipt['nativeResult'])
        : 'unknown',
    nativeExitCode: successful && typeof receipt?.exitCode === 'number' ? receipt.exitCode : null,
    assertionIds: validatedAssertionIds,
    cleanupStatus: typeof cleanup?.status === 'string' ? cleanup.status : null,
    recoveryRecordPath:
      typeof cleanup?.recoveryRecordPath === 'string' ? cleanup.recoveryRecordPath : null,
    nativeReceiptSha256: successful ? input.nativeReceiptSha256 : null,
    buildRelocation,
    failureReason: input.failureReason,
    policy: 'private-compact-success-or-failure-only-diagnostics-one-day',
    contextValidation: input.contextValidation ?? {
      status: 'trusted',
      phase: input.failureReason === null ? 'none' : 'finalization',
      detail: input.failureReason,
    },
    observedEnvironment: input.observedEnvironment ?? {
      eventName: input.context.environment.eventName,
      repository: input.context.environment.repository,
      refProtected: input.context.environment.refProtected,
      clientSha: input.context.environment.clientSha,
      serverSha: input.context.environment.serverSha,
      buildRunId: input.context.environment.buildRunId,
      requestedRunId: input.context.environment.requestedRunId,
      buildSource: input.context.environment.buildSource,
    },
  };
}

function unknownToolIdentity(): ProtectedManualToolIdentity {
  return {
    node: process.version,
    yarn: 'unknown',
    maestro: 'unknown',
    xcodebuild: 'unknown',
    simulatorSdk: 'unknown',
    java: 'unknown',
  };
}

function observedEnvironmentFromProcess(
  environment: ProtectedManualPilotEnvironment,
): ProtectedManualCompactReceipt['observedEnvironment'] {
  // These values are diagnostic observations only. They are never copied into
  // the authoritative identity slots of an untrusted receipt.
  return {
    eventName: environment.eventName || null,
    repository: environment.repository || null,
    refProtected: environment.refProtected || null,
    clientSha: environment.clientSha || null,
    serverSha: environment.serverSha || null,
    buildRunId: environment.buildRunId || null,
    requestedRunId: environment.requestedRunId || null,
    buildSource: environment.buildSource || null,
  };
}

/**
 * Build an explicit blocked receipt when trusted checkout context could not
 * be collected. Every identity is marked unknown/unverified so raw process
 * environment values cannot be mistaken for qualified native evidence.
 */
export function makeProtectedPreflightFailureReceipt(input: {
  environment: ProtectedManualPilotEnvironment;
  commandExitCode: number;
  failureReason: string;
  phase: 'context' | 'preflight' | 'finalization';
}): ProtectedManualCompactReceipt {
  return {
    schemaVersion: 1,
    kind: 'protected-manual-native-pilot-receipt',
    status: 'failed',
    hostedPromotion: false,
    successArtifactUpload: false,
    selected: PROTECTED_MANUAL_SELECTION,
    client: {
      sha: 'unknown',
      dirty: true,
      repository: 'unverified',
    },
    server: {
      sha: 'unknown',
      dirty: true,
      repository: 'unverified',
    },
    buildRunId: 'unknown',
    qualifiedBuildSource: 'unverified',
    requestedRunId: 'unknown',
    attemptId: 'unknown',
    toolVersions: unknownToolIdentity(),
    nativeResult: 'unknown',
    nativeExitCode: null,
    assertionIds: [],
    cleanupStatus: null,
    recoveryRecordPath: null,
    nativeReceiptSha256: null,
    buildRelocation: null,
    failureReason: bounded(input.failureReason),
    policy: 'private-compact-success-or-failure-only-diagnostics-one-day',
    contextValidation: {
      status: 'untrusted',
      phase: input.phase,
      detail: bounded(input.failureReason),
    },
    observedEnvironment: observedEnvironmentFromProcess(input.environment),
  };
}

async function writePrivateJson(file: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
}

async function requirePrivateFailurePath(file: string): Promise<string> {
  const resolved = requireAbsolute(file, 'private failure receipt path');
  const parent = path.dirname(resolved);
  const metadata = await lstat(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700)
    fail('private failure receipt parent must be an existing non-symlink 0700 directory');
  return resolved;
}

function cliOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(3).find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function repositoryRootFromProcess(): string {
  const values = process.env as Record<string, string | undefined>;
  return path.resolve(
    values.MYCHAMPIONS_CLIENT_ROOT ?? path.join(values.GITHUB_WORKSPACE ?? process.cwd(), 'client'),
  );
}

export async function collectProtectedManualPilotContext(
  repositoryRoot = repositoryRootFromProcess(),
  env: NodeJS.ProcessEnv = process.env,
  runGit: GitRunner = defaultGitRunner,
  runTool: ToolRunner = defaultToolRunner,
): Promise<ProtectedManualPilotContext> {
  const environment = protectedManualEnvironmentFromProcess(env);
  const clientMetadata = await lstat(repositoryRoot);
  if (!clientMetadata.isDirectory() || clientMetadata.isSymbolicLink())
    fail('client checkout must be a real workspace directory');
  if ((await realpath(repositoryRoot)) !== path.resolve(repositoryRoot))
    fail('client checkout must not resolve through a symlink');
  const client = readGitCheckoutObservation(repositoryRoot, 'client', runGit);
  const serverPath = path.resolve(
    environment.serverRoot || path.join(environment.workspaceRoot, 'server'),
  );
  const serverMetadata = await lstat(serverPath);
  if (!serverMetadata.isDirectory() || serverMetadata.isSymbolicLink())
    fail('native bootstrap workspace sibling server must be a real directory');
  if ((await realpath(serverPath)) !== serverPath)
    fail('native bootstrap workspace sibling server must not resolve through a symlink');
  const server = readGitCheckoutObservation(serverPath, 'server', runGit);
  const tools = readProtectedManualToolIdentity(runTool);
  const context = { environment, client, server, tools };
  validateProtectedManualPilotContext(context);
  return context;
}

export async function runProtectedManualPreflight(): Promise<void> {
  const context = await collectProtectedManualPilotContext();
  const buildRelocation = await restoreProtectedReusableBuild(context);
  const receiptRoot = await preparePrivateReceiptRoot(context.environment.receiptRoot);
  await writePrivateJson(path.join(receiptRoot, 'preflight.private.json'), {
    schemaVersion: 1,
    kind: 'protected-manual-native-pilot-preflight',
    hostedPromotion: false,
    selected: PROTECTED_MANUAL_SELECTION,
    clientSha: context.client.sha,
    serverSha: context.server.sha,
    buildRunId: context.environment.buildRunId,
    qualifiedBuildSource: context.environment.buildSource,
    requestedRunId: context.environment.requestedRunId,
    tools: context.tools,
    outputParent: context.environment.outputParent,
    serverRoot: context.server.root,
    buildRelocation,
  });
}

async function publishProtectedPreflightFailure(
  environment: ProtectedManualPilotEnvironment,
  commandExitCode: number,
  failureReason: string,
  phase: 'context' | 'preflight' | 'finalization',
): Promise<boolean> {
  const compact = makeProtectedPreflightFailureReceipt({
    environment,
    commandExitCode,
    failureReason,
    phase,
  });
  const receiptRoot = await preparePrivateReceiptRoot(environment.receiptRoot);
  await writePrivateJson(path.join(receiptRoot, 'failure-receipt.private.json'), compact);
  const failurePath = envValue(process.env, 'MYCHAMPIONS_FAILURE_RECEIPT_PATH');
  await writePrivateJson(await requirePrivateFailurePath(failurePath), compact);
  return false;
}

export async function runProtectedManualFinalize(
  commandExitCode: number,
  preflightFailure: string | null = null,
): Promise<boolean> {
  const environment = protectedManualEnvironmentFromProcess();
  let context: ProtectedManualPilotContext;
  try {
    context = await collectProtectedManualPilotContext();
  } catch (error) {
    const detail = [
      preflightFailure,
      `protected context collection failed: ${bounded(error instanceof Error ? error.message : error)}`,
    ]
      .filter(Boolean)
      .join('; ');
    return publishProtectedPreflightFailure(environment, commandExitCode, detail, 'context');
  }
  const receiptRoot = await preparePrivateReceiptRoot(context.environment.receiptRoot);
  const nativeReceiptPath = path.join(
    context.environment.outputParent,
    context.environment.requestedRunId,
    'receipt.json',
  );
  let receipt: ProtectedManualPilotNativeReceipt | null = null;
  let receiptSha: string | null = null;
  let buildRelocation: ProtectedReusableBuildRelocation | null = null;
  let reason: string | null = preflightFailure;
  let phase: ProtectedManualCompactReceipt['contextValidation']['phase'] =
    preflightFailure === null ? 'preflight' : 'preflight';
  try {
    if (reason === null) {
      buildRelocation = await validateInstalledProtectedReusableBuild(context);
      phase = 'native';
      if (commandExitCode !== 0) fail(`native runner exited with ${commandExitCode}`);
      const read = await readProtectedNativeReceipt(nativeReceiptPath);
      validateProtectedNativeReceipt(read.value, context);
      receipt = read.value;
      receiptSha = read.sha256;
    }
  } catch (error) {
    reason = bounded(error instanceof Error ? error.message : error);
  }
  const compact = makeCompactProtectedReceipt({
    context,
    nativeReceipt: receipt,
    nativeReceiptSha256: receiptSha,
    buildRelocation,
    commandExitCode,
    failureReason: reason,
    contextValidation: {
      status: 'trusted',
      phase: reason === null ? 'none' : phase,
      detail: reason,
    },
  });
  const compactPath = path.join(
    receiptRoot,
    reason === null ? 'success-receipt.private.json' : 'failure-receipt.private.json',
  );
  await writePrivateJson(compactPath, compact);
  if (reason !== null) {
    const failurePath = envValue(process.env, 'MYCHAMPIONS_FAILURE_RECEIPT_PATH');
    await writePrivateJson(await requirePrivateFailurePath(failurePath), compact);
    return false;
  }
  process.stdout.write(`Protected manual native pilot private receipt: ${compactPath}\n`);
  return true;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'preflight') {
    await runProtectedManualPreflight();
    return;
  }
  if (mode === 'finalize') {
    const raw = cliOption('exit-code');
    if (!raw || !/^\d+$/u.test(raw)) fail('finalize requires --exit-code=<integer>');
    const published = await runProtectedManualFinalize(
      Number(raw),
      cliOption('preflight-failure') ?? null,
    );
    if (!published) process.exitCode = 2;
    return;
  }
  fail('usage is preflight or finalize --exit-code=<integer>');
}

if (process.argv[1] && process.argv[1].endsWith('protected-native-pilot.ts')) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : bounded(error)}\n`);
    process.exitCode = 2;
  });
}

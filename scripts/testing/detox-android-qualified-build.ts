import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
  link,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ANDROID_PILOT_APP_ID,
  androidSourceIdentity,
  inspectOwnedAndroidApk,
  resolveAndroidPilotToolchain,
} from './android-build-identity';
import {
  detoxAndroidBuildInputClosure,
  detoxAndroidBuildInputsDigest,
  requireDetoxBuildInstrumentation,
  type DetoxBaselineBuildInstrumentation,
  type DetoxQualifiedAndroidBuildReuse,
} from './detox-integrated-session-baseline';
import { readActualDetoxRuntimeMetadata } from './detox-runtime-build-metadata';
import {
  createIntegratedAppEnvironment,
  requireIntegratedLoopbackOrigin,
} from './integration-preflight';
import { executeOwnedNativeCommand, type NativeCommandExecution } from './owned-native-command';
import type { ReusableIosBuildIdentity } from './native-build-reuse';
import type { Stats } from 'node:fs';

const execute = promisify(execFile);
const RUN_ID = /^[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_DESCRIPTOR_BYTES = 256 * 1024;
const MAX_APK_BYTES = 256 * 1024 * 1024;
const CONFIGURATION = 'android.emu.debug' as const;
const DESCRIPTOR_KIND = 'private-qualified-android-detox-build-not-public-receipt' as const;
const DESCRIPTOR_NAME = 'android-detox-build.private.json';
const RECEIPT_NAME = 'android-detox-build.execution.private.json';

export const ANDROID_DETOX_BUILD_DESCRIPTOR_KIND = DESCRIPTOR_KIND;
export const ANDROID_DETOX_BUILD_DESCRIPTOR_NAME = DESCRIPTOR_NAME;
export const ANDROID_DETOX_BUILD_RECEIPT_NAME = RECEIPT_NAME;

type Identity = ReusableIosBuildIdentity;

export type AndroidDetoxBuildFileIdentity = Identity;

export type AndroidDetoxBuildExecutionReceipt = Readonly<{
  kind: 'private-android-detox-build-execution-not-public-receipt';
  buildRunId: string;
  command: string;
  argv: readonly string[];
  cwd: string;
  artifactRoot: string;
  execution: NativeCommandExecution['execution'];
  cleanup: NativeCommandExecution['cleanup'];
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  pid: number | null;
  pgid: number | null;
  logPath: string | null;
  stdoutPath: string | null;
  outputFailure: unknown;
  censusFailure: unknown;
}>;

export type AndroidDetoxBuildDescriptor = Readonly<{
  kind: typeof DESCRIPTOR_KIND;
  buildRunId: string;
  producerReceiptPath: string;
  producerReceiptHash: string;
  build: DetoxBaselineBuildInstrumentation;
}>;

type ProtectedRead = Readonly<{ bytes: Buffer; identity: Identity }>;

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function identityOf(stat: Stats): Identity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function assertPrivateDirectory(root: string): void {
  assert(path.isAbsolute(root) && path.normalize(root) === root);
}

function assertRunId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} must be a 24-character run ID`);
}

function assertHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} must be a SHA-256 hash`);
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function requireOwnedPrivateFile(filePath: string, maxBytes: number): Promise<ProtectedRead> {
  const absolute = path.resolve(filePath);
  const beforePath = await lstat(absolute);
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.uid !== process.getuid?.() ||
    beforePath.nlink !== 1 ||
    (beforePath.mode & 0o022) !== 0 ||
    (await realpath(absolute)) !== absolute
  )
    throw new Error(`Android Detox artifact is not a canonical owned private file: ${absolute}`);
  if (beforePath.size > maxBytes)
    throw new Error(`Android Detox artifact exceeds ${maxBytes} bytes`);
  const handle = await open(absolute, 'r');
  try {
    const descriptorBefore = await handle.stat();
    assert(descriptorBefore.isFile(), 'Android Detox descriptor target is not a regular file');
    assert(descriptorBefore.nlink === 1, 'Android Detox artifact has multiple links');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total));
      const result = await handle.read(chunk, 0, chunk.byteLength, null);
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
      if (total > maxBytes) throw new Error('Android Detox artifact grew beyond its read cap');
      chunks.push(chunk.subarray(0, result.bytesRead));
    }
    const descriptorAfter = await handle.stat();
    const afterPath = await lstat(absolute);
    if (!sameIdentity(identityOf(descriptorBefore), identityOf(descriptorAfter)))
      throw new Error('Android Detox artifact changed during descriptor read');
    if (!sameIdentity(identityOf(descriptorBefore), identityOf(afterPath)))
      throw new Error('Android Detox artifact path identity changed during descriptor read');
    return { bytes: Buffer.concat(chunks, total), identity: identityOf(descriptorAfter) };
  } finally {
    await handle.close();
  }
}

export async function inspectAndroidDetoxBuildArtifacts(input: {
  repositoryRoot: string;
  build: DetoxBaselineBuildInstrumentation;
}): Promise<DetoxBaselineBuildInstrumentation> {
  assert.equal(input.build.platform, 'android');
  assert(input.build.binaryReuse?.kind === 'qualified-android-build-reuse');
  const reuse = input.build.binaryReuse;
  const app = await requireOwnedPrivateFile(reuse.binaryPath, MAX_APK_BYTES);
  const test = await requireOwnedPrivateFile(reuse.testBinaryPath, MAX_APK_BYTES);
  assert.equal(hashBytes(app.bytes), reuse.binaryHash, 'Android Detox app APK bytes changed');
  assert.equal(hashBytes(test.bytes), reuse.testBinaryHash, 'Android Detox test APK bytes changed');
  assert(
    sameIdentity(app.identity, reuse.binaryIdentity),
    'Android Detox app APK identity changed',
  );
  assert(
    sameIdentity(test.identity, reuse.testBinaryIdentity),
    'Android Detox test APK identity changed',
  );
  const receipt = await requireOwnedPrivateFile(reuse.commandReceiptPath, MAX_DESCRIPTOR_BYTES);
  assert.equal(
    hashBytes(receipt.bytes),
    reuse.commandReceiptHash,
    'Android Detox build receipt changed',
  );
  const helperContents = await Promise.all(
    reuse.androidBuildInputPaths.map((relative) =>
      readFile(path.join(path.resolve(input.repositoryRoot), relative)),
    ),
  );
  assert.equal(
    detoxAndroidBuildInputsDigest(reuse.androidBuildInputPaths, helperContents),
    reuse.androidBuildInputsHash,
    'Android Detox build input closure changed',
  );
  const source = await androidSourceIdentity(path.resolve(input.repositoryRoot));
  assert.deepEqual(source, input.build.source, 'Android Detox source identity changed');
  const config = await requireOwnedPrivateFile(input.build.detoxConfigPath, MAX_DESCRIPTOR_BYTES);
  assert.equal(
    hashBytes(config.bytes),
    input.build.detoxConfigHash,
    'Android Detox config changed',
  );
  const runtimeConfig = await requireOwnedPrivateFile(
    input.build.embeddedRuntime.configSourcePath,
    MAX_DESCRIPTOR_BYTES,
  );
  assert.equal(
    hashBytes(runtimeConfig.bytes),
    input.build.embeddedRuntime.configSourceHash,
    'Android Detox runtime config changed',
  );
  return input.build;
}

function descriptorRunRoot(repositoryRoot: string, buildRunId: string): string {
  return path.join(path.resolve(repositoryRoot), '.qa/artifacts/native-pilot', buildRunId);
}

function descriptorPath(repositoryRoot: string, buildRunId: string): string {
  return path.join(descriptorRunRoot(repositoryRoot, buildRunId), DESCRIPTOR_NAME);
}

function receiptPath(repositoryRoot: string, buildRunId: string): string {
  return path.join(descriptorRunRoot(repositoryRoot, buildRunId), RECEIPT_NAME);
}

function gradleUserHome(repositoryRoot: string): string {
  return path.join(
    path.resolve(repositoryRoot),
    '.qa/artifacts/native-pilot/android-detox-gradle-user-home',
  );
}

async function ensurePrivateGradleUserHome(repositoryRoot: string): Promise<string> {
  const home = gradleUserHome(repositoryRoot);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const metadata = await lstat(home);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0 ||
    (await realpath(home)) !== home
  )
    throw new Error('Android Detox Gradle user home is not a canonical private directory');
  return home;
}

async function writeExclusiveJson(target: string, value: unknown): Promise<void> {
  const parent = path.dirname(target);
  const temp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await link(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  await chmod(target, 0o600);
  assert.equal(path.dirname(target), parent);
}

function requireBuildReceipt(
  value: unknown,
  buildRunId: string,
): AndroidDetoxBuildExecutionReceipt {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Android Detox build receipt is malformed',
  );
  const row = value as Record<string, unknown>;
  assert.equal(row.kind, 'private-android-detox-build-execution-not-public-receipt');
  assertRunId(row.buildRunId, 'Android Detox build receipt run ID');
  assert.equal(row.buildRunId, buildRunId);
  assert.equal(row.execution, 'completed', 'Android Detox build did not complete');
  assert.equal(row.cleanup, 'cleaned', 'Android Detox build cleanup did not complete');
  assert.equal(row.childExitCode, 0, 'Android Detox build exited unsuccessfully');
  assert.equal(row.childSignal, null, 'Android Detox build received a signal');
  assert.equal(row.outputFailure, null, 'Android Detox build output capture failed');
  assert.equal(row.censusFailure, null, 'Android Detox build process census failed');
  return row as AndroidDetoxBuildExecutionReceipt;
}

async function inspectAndroidTestApk(input: {
  binaryPath: string;
  artifactRoot: string;
  sdkRoot: string;
}): Promise<{ binaryHash: string; identity: Identity }> {
  const observed = await requireOwnedPrivateFile(input.binaryPath, MAX_APK_BYTES);
  const tools = path.join(input.sdkRoot, 'build-tools/36.0.0');
  const badging = await execute(path.join(tools, 'aapt2'), ['dump', 'badging', input.binaryPath], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  const signing = await execute(
    path.join(tools, 'apksigner'),
    ['verify', '--verbose', '--print-certs', input.binaryPath],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  assert.match(badging.stdout, /^package: name='com\.edufelip\.mychampions\.dev\.test' /m);
  assert.match(signing.stdout, /^Verifies\s*$/m);
  assert.match(signing.stdout, /^Number of signers: 1\s*$/m);
  const after = await requireOwnedPrivateFile(input.binaryPath, MAX_APK_BYTES);
  assert(
    sameIdentity(observed.identity, after.identity),
    'Android Detox test APK changed after tooling',
  );
  assert.equal(hashBytes(observed.bytes), hashBytes(after.bytes));
  return { binaryHash: hashBytes(after.bytes), identity: after.identity };
}

export async function prepareAndroidDetoxQualifiedBuild(input: {
  repositoryRoot: string;
  artifactRoot: string;
  buildRunId: string;
  apiOrigin: string;
  metroPort: number;
  signal: AbortSignal;
  deadlineMs: number;
  resolveToolchain?: typeof resolveAndroidPilotToolchain;
  runCommand?: typeof executeOwnedNativeCommand;
}): Promise<AndroidDetoxBuildDescriptor> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const artifactRoot = path.resolve(input.artifactRoot);
  assertRunId(input.buildRunId, 'Android Detox build run ID');
  requireIntegratedLoopbackOrigin(input.apiOrigin);
  assert(
    Number.isSafeInteger(input.metroPort) && input.metroPort >= 1024 && input.metroPort <= 49151,
  );
  assert(
    Number.isSafeInteger(input.deadlineMs) &&
      input.deadlineMs >= 100 &&
      input.deadlineMs <= 900_000,
  );
  assertPrivateDirectory(artifactRoot);
  assert.equal(
    artifactRoot,
    descriptorRunRoot(repositoryRoot, input.buildRunId),
    'Android Detox build output must be bound to the requested run',
  );
  input.signal.throwIfAborted();
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  await chmod(artifactRoot, 0o700);
  const androidBuildRoot = path.join(artifactRoot, 'android-build');
  const apkRoot = path.join(androidBuildRoot, 'outputs/apk');
  await mkdir(path.join(apkRoot, 'dev/debug'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(apkRoot, 'androidTest/dev/debug'), { recursive: true, mode: 0o700 });
  await chmod(androidBuildRoot, 0o700).catch(() => undefined);
  // Native host serialization makes this dependency/transform cache exclusive
  // to one qualified build at a time. Keep APK outputs inside the requested
  // run; a fresh cache per run needlessly recompiles the full dependency graph
  // and can exhaust the fixed qualification deadline without changing an APK.
  const sharedGradleUserHome = await ensurePrivateGradleUserHome(repositoryRoot);
  const toolchain = await (input.resolveToolchain ?? resolveAndroidPilotToolchain)();
  const initFile = path.join(artifactRoot, 'android-detox-build.init.gradle');
  await writeFile(
    initFile,
    `gradle.beforeProject { p ->\n  if (p.path == ':app') {\n    p.layout.buildDirectory.set(new File(System.getProperty('mychampions.android.output')))\n  }\n}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  const command = path.join(repositoryRoot, 'android/gradlew');
  const argv = [
    '-Dmychampions.android.project=' + path.join(repositoryRoot, 'android'),
    '-Dmychampions.android.output=' + androidBuildRoot,
    '-DtestBuildType=debug',
    '-PdetoxMetroPort=' + String(input.metroPort),
    '-I',
    initFile,
    'app:assembleDevDebug',
    'app:assembleDevDebugAndroidTest',
  ];
  const runCommand = input.runCommand ?? executeOwnedNativeCommand;
  const execution = await runCommand({
    command,
    argv,
    cwd: path.join(repositoryRoot, 'android'),
    env: {
      ...createIntegratedAppEnvironment(process.env, {
        apiOrigin: input.apiOrigin,
        appOrigin: `http://127.0.0.1:${input.metroPort}`,
      }),
      ANDROID_SDK_ROOT: toolchain.sdkRoot,
      JAVA_HOME: toolchain.javaHome,
      GRADLE_USER_HOME: sharedGradleUserHome,
    },
    artifactRoot,
    label: 'android-detox-build',
    phase: 'build',
    deadlineMs: input.deadlineMs,
    signal: input.signal,
    stdoutPath: path.join(artifactRoot, 'android-detox-build.stdout.private.log'),
  });
  const receipt: AndroidDetoxBuildExecutionReceipt = {
    kind: 'private-android-detox-build-execution-not-public-receipt',
    buildRunId: input.buildRunId,
    command,
    argv,
    cwd: path.join(repositoryRoot, 'android'),
    artifactRoot,
    ...execution,
    outputFailure: execution.outputFailure ?? null,
    censusFailure: execution.censusFailure ?? null,
  };
  await writeExclusiveJson(receiptPath(repositoryRoot, input.buildRunId), receipt);
  requireBuildReceipt(receipt, input.buildRunId);
  input.signal.throwIfAborted();
  const appBinaryPath = path.join(apkRoot, 'dev/debug/app-dev-debug.apk');
  const testBinaryPath = path.join(apkRoot, 'androidTest/dev/debug/app-dev-debug-androidTest.apk');
  const appIdentity = await inspectOwnedAndroidApk({
    binaryPath: appBinaryPath,
    artifactRoot: androidBuildRoot,
    sdkRoot: toolchain.sdkRoot,
    apiOrigin: input.apiOrigin,
    writeReceipt: false,
  });
  const appEvidence = await requireOwnedPrivateFile(appBinaryPath, MAX_APK_BYTES);
  assert.equal(hashBytes(appEvidence.bytes), appIdentity.binaryHash);
  const testIdentity = await inspectAndroidTestApk({
    binaryPath: testBinaryPath,
    artifactRoot: androidBuildRoot,
    sdkRoot: toolchain.sdkRoot,
  });
  const helperContents = await Promise.all(
    detoxAndroidBuildInputClosure.map((relative) => readFile(path.join(repositoryRoot, relative))),
  );
  const androidBuildInputsHash = detoxAndroidBuildInputsDigest(
    detoxAndroidBuildInputClosure,
    helperContents,
  );
  const source = await androidSourceIdentity(repositoryRoot);
  const detoxConfigPath = path.join(repositoryRoot, '.detoxrc.js');
  const configSourcePath = path.join(repositoryRoot, 'app.config.ts');
  const commandReceipt = await requireOwnedPrivateFile(
    receiptPath(repositoryRoot, input.buildRunId),
    MAX_DESCRIPTOR_BYTES,
  );
  const reuse: DetoxQualifiedAndroidBuildReuse = {
    kind: 'qualified-android-build-reuse',
    runId: input.buildRunId,
    binaryPath: appBinaryPath,
    binaryHash: appIdentity.binaryHash,
    binaryIdentity: appEvidence.identity,
    testBinaryPath,
    testBinaryHash: testIdentity.binaryHash,
    testBinaryIdentity: testIdentity.identity,
    checkedInBinaryPath: path.join(
      repositoryRoot,
      'android/app/build/outputs/apk/dev/debug/app-dev-debug.apk',
    ),
    checkedInTestBinaryPath: path.join(
      repositoryRoot,
      'android/app/build/outputs/apk/androidTest/dev/debug/app-dev-debug-androidTest.apk',
    ),
    androidBuildInputPaths: [...detoxAndroidBuildInputClosure],
    androidBuildInputsHash,
    commandReceiptPath: receiptPath(repositoryRoot, input.buildRunId),
    commandReceiptHash: hashBytes(commandReceipt.bytes),
  };
  // Public receipts bind flagsHash/toolVersions to the build; record the APK's
  // embedded config hash and the Node/Detox versions that produced it.
  const runtimeMetadata = await readActualDetoxRuntimeMetadata(
    repositoryRoot,
    appIdentity.environmentHash,
  );
  const build: DetoxBaselineBuildInstrumentation = {
    platform: 'android',
    configuration: CONFIGURATION,
    binaryPath: appBinaryPath,
    binaryHash: appIdentity.binaryHash,
    testBinaryPath,
    testBinaryHash: testIdentity.binaryHash,
    source,
    helperInputPaths: [...detoxAndroidBuildInputClosure],
    helperInputsHash: androidBuildInputsHash,
    detoxConfigPath,
    detoxConfigHash: hashBytes(await readFile(detoxConfigPath)),
    metroPort: input.metroPort,
    appIdentifier: ANDROID_PILOT_APP_ID,
    embeddedRuntime: {
      variant: 'dev',
      appIdentifier: ANDROID_PILOT_APP_ID,
      apiOrigin: input.apiOrigin,
      configSourcePath,
      configSourceHash: hashBytes(await readFile(configSourcePath)),
    },
    binaryReuse: reuse,
    environmentHash: runtimeMetadata.environmentHash,
    toolVersions: runtimeMetadata.toolVersions,
    toolVersionEvidence: runtimeMetadata.toolVersionEvidence,
  };
  requireDetoxBuildInstrumentation(build, repositoryRoot);
  await writeExclusiveJson(descriptorPath(repositoryRoot, input.buildRunId), {
    kind: DESCRIPTOR_KIND,
    buildRunId: input.buildRunId,
    producerReceiptPath: receiptPath(repositoryRoot, input.buildRunId),
    producerReceiptHash: reuse.commandReceiptHash,
    build,
  } satisfies AndroidDetoxBuildDescriptor);
  return requireAndroidDetoxBuildDescriptor(
    JSON.parse(
      (
        await requireOwnedPrivateFile(
          descriptorPath(repositoryRoot, input.buildRunId),
          MAX_DESCRIPTOR_BYTES,
        )
      ).bytes.toString('utf8'),
    ),
    repositoryRoot,
  );
}

export function requireAndroidDetoxBuildDescriptor(
  value: unknown,
  repositoryRoot: string,
): AndroidDetoxBuildDescriptor {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Android Detox build descriptor is malformed',
  );
  const row = value as Record<string, unknown>;
  assert.equal(row.kind, DESCRIPTOR_KIND);
  assertRunId(row.buildRunId, 'Android Detox build descriptor run ID');
  const runRoot = descriptorRunRoot(repositoryRoot, row.buildRunId);
  assert(typeof row.producerReceiptPath === 'string');
  assert(path.resolve(row.producerReceiptPath) === receiptPath(repositoryRoot, row.buildRunId));
  assertHash(row.producerReceiptHash, 'Android Detox build descriptor receipt hash');
  assert(row.build && typeof row.build === 'object');
  const build = row.build as DetoxBaselineBuildInstrumentation;
  requireDetoxBuildInstrumentation(build, repositoryRoot);
  assert(build.binaryReuse?.kind === 'qualified-android-build-reuse');
  assert(build.binaryReuse.runId === row.buildRunId);
  assert(build.binaryReuse.commandReceiptPath === row.producerReceiptPath);
  assert(build.binaryReuse.commandReceiptHash === row.producerReceiptHash);
  assert(
    path.dirname(runRoot) === path.join(path.resolve(repositoryRoot), '.qa/artifacts/native-pilot'),
  );
  return Object.freeze({
    kind: DESCRIPTOR_KIND,
    buildRunId: row.buildRunId,
    producerReceiptPath: row.producerReceiptPath,
    producerReceiptHash: row.producerReceiptHash,
    build,
  });
}

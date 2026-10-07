import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

/**
 * The camera route has one deliberately small runner closure.  These paths
 * are part of the camera contract: accepting a caller-selected config or test
 * file would let a qualified build run a different test than the one that was
 * reviewed.
 */
export const IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS = {
  /** Imported by detox.camera.private.config.js; this is part of the launch closure. */
  detoxBaseConfigPath: '.detoxrc.js',
  detoxConfigPath: 'detox.camera.private.config.js',
  jestConfigPath: 'jest.detox-camera.private.config.js',
  cameraTestPath: 'e2e/detox-ios-camera-route.e2e.test.js',
  childSourcePath: 'e2e/detox-ios-camera-route.e2e.test.js',
  /** Owner-side IPC contract imported by the current camera owner. */
  ipcSourcePath: 'scripts/testing/native-detox-camera-ios-ipc.ts',
} as const;

export type IosDetoxCameraRunnerInputKey =
  keyof typeof IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS;

export type IosDetoxCameraRunnerInputPaths = Readonly<Record<IosDetoxCameraRunnerInputKey, string>>;

export type IosDetoxCameraRunnerInputFileIdentity = Readonly<{
  key: IosDetoxCameraRunnerInputKey;
  path: string;
  relativePath: string;
  sha256: string;
  bytes: number;
  mode: number;
  uid: number;
  gid: number;
  dev: number;
  ino: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}>;

export type IosDetoxCameraRunnerInputIdentity = Readonly<{
  root: string;
  files: Readonly<Record<IosDetoxCameraRunnerInputKey, IosDetoxCameraRunnerInputFileIdentity>>;
  sha256: string;
}>;

const MAX_RUNNER_INPUT_BYTES = 1024 * 1024;
const RUNNER_INPUT_KEYS = Object.keys(
  IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS,
) as IosDetoxCameraRunnerInputKey[];

type RunnerFileRead = Readonly<{
  identity: IosDetoxCameraRunnerInputFileIdentity;
  bytes: Buffer;
}>;

export type IosDetoxCameraRunnerInputStage = Readonly<{
  original: IosDetoxCameraRunnerInputIdentity;
  staged: IosDetoxCameraRunnerInputIdentity;
  paths: IosDetoxCameraRunnerInputPaths;
}>;

function checkLive(signal: AbortSignal | undefined, deadlineAtMonotonicMs: number): void {
  signal?.throwIfAborted();
  if (!Number.isFinite(deadlineAtMonotonicMs))
    throw new Error('Detox camera runner input deadline is invalid');
  if (performance.now() >= deadlineAtMonotonicMs)
    throw new Error('Detox camera runner input deadline exceeded');
}

function metadata(value: Awaited<ReturnType<typeof lstat>>) {
  return {
    mode: Number(value.mode) & 0o777,
    uid: Number(value.uid),
    gid: Number(value.gid),
    dev: Number(value.dev),
    ino: Number(value.ino),
    nlink: Number(value.nlink),
    size: Number(value.size),
    mtimeMs: Number(value.mtimeMs),
    ctimeMs: Number(value.ctimeMs),
  };
}

function sameMetadata(
  left: ReturnType<typeof metadata>,
  right: ReturnType<typeof metadata>,
): boolean {
  return (
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireOwnedRunnerFile(
  filePath: string,
  expectedPath: string,
  root: string,
  key: IosDetoxCameraRunnerInputKey,
): void {
  if (
    !isAbsolute(filePath) ||
    filePath.includes('\0') ||
    resolve(filePath) !== expectedPath ||
    relative(root, filePath).startsWith('../')
  )
    throw new Error(`Detox camera ${key} is outside the canonical repository root`);
}

async function readRunnerFile(
  root: string,
  key: IosDetoxCameraRunnerInputKey,
  filePath: string,
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
): Promise<RunnerFileRead> {
  checkLive(signal, deadlineAtMonotonicMs);
  const relativePath = IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS[key];
  const expectedPath = join(root, relativePath);
  requireOwnedRunnerFile(filePath, expectedPath, root, key);
  if ((await realpath(filePath)) !== filePath)
    throw new Error(`Detox camera ${key} is not a canonical regular file`);
  const before = await lstat(filePath);
  const beforeMetadata = metadata(before);
  const uid = process.getuid?.();
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (uid !== undefined && before.uid !== uid) ||
    before.nlink !== 1 ||
    (before.mode & 0o022) !== 0 ||
    before.size > MAX_RUNNER_INPUT_BYTES
  )
    throw new Error(`Detox camera ${key} is not an owned stable private file`);
  const bytes = await readFile(filePath, { signal });
  checkLive(signal, deadlineAtMonotonicMs);
  const after = await lstat(filePath);
  const afterMetadata = metadata(after);
  if (!sameMetadata(beforeMetadata, afterMetadata) || bytes.length !== after.size)
    throw new Error(`Detox camera ${key} changed while it was being read`);
  return {
    identity: {
      key,
      path: filePath,
      relativePath,
      sha256: hashBytes(bytes),
      bytes: bytes.length,
      ...afterMetadata,
    },
    bytes,
  };
}

function identityHash(
  root: string,
  files: Readonly<Record<IosDetoxCameraRunnerInputKey, IosDetoxCameraRunnerInputFileIdentity>>,
): string {
  return hashBytes(
    Buffer.from(
      JSON.stringify({
        root,
        files: RUNNER_INPUT_KEYS.map((key) => files[key]),
      }),
    ),
  );
}

function requirePrivateDirectory(value: Awaited<ReturnType<typeof lstat>>, label: string): void {
  const uid = process.getuid?.();
  if (
    !value.isDirectory() ||
    value.isSymbolicLink() ||
    (uid !== undefined && value.uid !== uid) ||
    (Number(value.mode) & 0o022) !== 0
  )
    throw new Error(`${label} is not an owned private directory`);
}

/**
 * Create only the reviewed directory ancestors needed by the runner closure.
 * The staged IPC source lives below scripts/testing, so creating e2e alone is
 * insufficient and would make the child execute a different, incomplete
 * closure. Every ancestor is re-lstat'd before it is used and is kept private
 * until the complete tree is verified.
 */
async function createPrivateStageAncestors(
  stagedRoot: string,
  relativePaths: readonly string[],
): Promise<string[]> {
  const directories = new Set<string>();
  for (const relativePath of relativePaths) {
    const parts = relativePath.split('/');
    parts.pop();
    for (let index = 1; index <= parts.length; index += 1)
      directories.add(join(stagedRoot, ...parts.slice(0, index)));
  }
  const ordered = [...directories].sort((left, right) => left.length - right.length);
  for (const directory of ordered) {
    await mkdir(directory, { mode: 0o700 });
    const metadata = await lstat(directory);
    requirePrivateDirectory(metadata, `Detox camera staged ancestor ${directory}`);
    if ((await realpath(directory)) !== directory)
      throw new Error(`Detox camera staged ancestor is not canonical: ${directory}`);
    await chmod(directory, 0o700);
  }
  return ordered;
}

function reviewedStageRelativePath(
  root: string,
  filePath: string,
  key: IosDetoxCameraRunnerInputKey,
): string {
  const relativePath = relative(root, filePath);
  if (
    relativePath !== IOS_DETOX_CAMERA_RUNNER_INPUT_RELATIVE_PATHS[key] ||
    relativePath.startsWith('../') ||
    isAbsolute(relativePath) ||
    relativePath.includes('\0')
  )
    throw new Error(`Detox camera staged ${key} path is outside the reviewed closure`);
  return relativePath;
}

function sameRunnerFileIdentity(
  left: IosDetoxCameraRunnerInputFileIdentity,
  right: IosDetoxCameraRunnerInputFileIdentity,
): boolean {
  return (
    left.key === right.key &&
    left.path === right.path &&
    left.relativePath === right.relativePath &&
    left.sha256 === right.sha256 &&
    left.bytes === right.bytes &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function readRunnerInputsWithBytes(input: {
  repositoryRoot: string;
  paths: IosDetoxCameraRunnerInputPaths;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<{
  identity: IosDetoxCameraRunnerInputIdentity;
  files: Readonly<Record<IosDetoxCameraRunnerInputKey, RunnerFileRead>>;
}> {
  checkLive(input.signal, input.deadlineAtMonotonicMs);
  const root = await realpath(input.repositoryRoot);
  if (root !== resolve(input.repositoryRoot))
    throw new Error('Detox camera repository root is not canonical');
  const rootMetadata = await lstat(root);
  requirePrivateDirectory(rootMetadata, 'Detox camera repository root');
  if (resolve(input.paths.cameraTestPath) !== resolve(input.paths.childSourcePath))
    throw new Error('Detox camera child source and camera test path differ');
  const files = {} as Record<IosDetoxCameraRunnerInputKey, RunnerFileRead>;
  for (const key of RUNNER_INPUT_KEYS)
    files[key] = await readRunnerFile(
      root,
      key,
      input.paths[key],
      input.signal,
      input.deadlineAtMonotonicMs,
    );
  const identities = {} as Record<
    IosDetoxCameraRunnerInputKey,
    IosDetoxCameraRunnerInputFileIdentity
  >;
  for (const key of RUNNER_INPUT_KEYS) identities[key] = files[key].identity;
  return {
    identity: {
      root,
      files: identities,
      sha256: identityHash(root, identities),
    },
    files,
  };
}

/** Read and bind the exact camera runner closure before any resource action. */
export async function readOwnedIosDetoxCameraRunnerInputs(input: {
  repositoryRoot: string;
  paths: IosDetoxCameraRunnerInputPaths;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<IosDetoxCameraRunnerInputIdentity> {
  return (
    await readRunnerInputsWithBytes({
      repositoryRoot: input.repositoryRoot,
      paths: input.paths,
      signal: input.signal,
      deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    })
  ).identity;
}

/** Re-read the owned closure and reject any path, metadata, or content drift. */
export async function rereadOwnedIosDetoxCameraRunnerInputs(input: {
  repositoryRoot: string;
  paths: IosDetoxCameraRunnerInputPaths;
  expected: IosDetoxCameraRunnerInputIdentity;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<IosDetoxCameraRunnerInputIdentity> {
  const actual = await readOwnedIosDetoxCameraRunnerInputs(input);
  if (actual.sha256 !== input.expected.sha256)
    throw new Error('Detox camera runner inputs changed after ownership qualification');
  return actual;
}

/**
 * Copy the reviewed runner closure into a new private, content-addressed root.
 * Detox/Jest are pointed at this immutable copy so a later source mutation
 * cannot execute between the owner's reread and the child's module loading.
 */
export async function stageOwnedIosDetoxCameraRunnerInputs(input: {
  repositoryRoot: string;
  stageRoot: string;
  paths: IosDetoxCameraRunnerInputPaths;
  expected: IosDetoxCameraRunnerInputIdentity;
  signal?: AbortSignal;
  deadlineAtMonotonicMs: number;
}): Promise<IosDetoxCameraRunnerInputStage> {
  const originalRead = await readRunnerInputsWithBytes({
    repositoryRoot: input.repositoryRoot,
    paths: input.paths,
    signal: input.signal,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
  });
  if (
    originalRead.identity.root !== input.expected.root ||
    originalRead.identity.sha256 !== input.expected.sha256 ||
    RUNNER_INPUT_KEYS.some(
      (key) => !sameRunnerFileIdentity(originalRead.identity.files[key], input.expected.files[key]),
    )
  )
    throw new Error('Detox camera runner inputs changed before immutable staging');

  checkLive(input.signal, input.deadlineAtMonotonicMs);
  const stageRoot = await realpath(input.stageRoot);
  if (stageRoot !== resolve(input.stageRoot) || stageRoot === originalRead.identity.root)
    throw new Error('Detox camera runner stage root is not a distinct canonical directory');
  const stageRootMetadata = await lstat(stageRoot);
  requirePrivateDirectory(stageRootMetadata, 'Detox camera runner stage root');
  const uid = process.getuid?.();
  if (uid !== undefined && stageRootMetadata.uid !== uid)
    throw new Error('Detox camera runner stage root is not owned by the current user');

  const stagedRoot = join(stageRoot, `detox-camera-runner-inputs-${input.expected.sha256}`);
  const stagedRelativePaths = RUNNER_INPUT_KEYS.map((key) =>
    reviewedStageRelativePath(originalRead.identity.root, input.paths[key], key),
  );
  try {
    // Build the private tree while its owner-only write bit is available, then
    // seal both directories before the child can load any module.
    await mkdir(stagedRoot, { mode: 0o700 });
    const stagedAncestors = await createPrivateStageAncestors(stagedRoot, stagedRelativePaths);
    const stagedPaths = Object.fromEntries(
      RUNNER_INPUT_KEYS.map((key, index) => [key, join(stagedRoot, stagedRelativePaths[index])]),
    ) as IosDetoxCameraRunnerInputPaths;
    const writtenDestinations = new Set<string>();
    for (const key of RUNNER_INPUT_KEYS) {
      checkLive(input.signal, input.deadlineAtMonotonicMs);
      const destination = stagedPaths[key];
      if (!writtenDestinations.has(destination)) {
        await writeFile(destination, originalRead.files[key].bytes, {
          flag: 'wx',
          mode: 0o400,
        });
        await chmod(destination, 0o400);
        writtenDestinations.add(destination);
      }
    }
    for (const directory of stagedAncestors) await chmod(directory, 0o500);
    await chmod(stagedRoot, 0o500);
    const stagedRead = await readRunnerInputsWithBytes({
      repositoryRoot: stagedRoot,
      paths: stagedPaths,
      signal: input.signal,
      deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    });
    for (const key of RUNNER_INPUT_KEYS) {
      if (
        !stagedRead.files[key].bytes.equals(originalRead.files[key].bytes) ||
        (stagedRead.identity.files[key].mode & 0o777) !== 0o400
      )
        throw new Error(`Detox camera staged runner input failed immutable verification: ${key}`);
    }
    return {
      original: originalRead.identity,
      staged: stagedRead.identity,
      paths: stagedPaths,
    };
  } catch (error) {
    await chmod(stagedRoot, 0o700).catch(() => undefined);
    for (const relativePath of stagedRelativePaths) {
      const parts = relativePath.split('/');
      parts.pop();
      for (let index = 1; index <= parts.length; index += 1)
        await chmod(join(stagedRoot, ...parts.slice(0, index)), 0o700).catch(() => undefined);
    }
    await rm(stagedRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export const iosDetoxCameraRunnerInputMaxBytes = MAX_RUNNER_INPUT_BYTES;

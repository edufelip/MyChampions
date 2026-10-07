import assert from 'node:assert/strict';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  acquireDetoxConnectionArtifactRoot,
  type DetoxConnectionArtifactRootLease,
} from './testing/detox-connection-artifact-root';
import { createDetoxConnectionSignalController } from './testing/detox-connection-lifecycle';
import { writeDetoxConnectionResult } from './testing/detox-connection-result-writer';
import { runOwnedDetoxConnectionAttempt } from './testing/detox-integrated-connection-driver';
import type { DetoxBaselineBuildInstrumentation } from './testing/detox-integrated-session-baseline';
import type { NativePilotSelection } from './testing/native-pilot-contract';

async function readPrivateJson<T>(file: string, root: string): Promise<T> {
  const resolved = path.resolve(file);
  assert(
    path.dirname(resolved) === path.resolve(root),
    'Detox input must be a direct artifact child',
  );
  assert((await realpath(resolved)) === resolved, 'Detox input is not canonical');
  const metadata = await lstat(resolved);
  assert(
    metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.() &&
      (metadata.mode & 0o777) === 0o600,
    'Detox input is not an owned private file',
  );
  return JSON.parse(await readFile(resolved, 'utf8')) as T;
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim() !== value) throw new Error(`${name} is required`);
  return value;
}

const DETOX_CONNECTION_DEFAULT_DEADLINE_MS = 600_000;
const DETOX_CONNECTION_MIN_DEADLINE_MS = 30_000;
const DETOX_CONNECTION_MAX_DEADLINE_MS = 600_000;

export function requireDetoxConnectionDeadlineMs(value: string | undefined): number {
  if (value === undefined || value === '') return DETOX_CONNECTION_DEFAULT_DEADLINE_MS;
  const isDecimalInteger = /^[0-9]+$/.test(value);
  const parsed = isDecimalInteger ? Number(value) : Number.NaN;
  assert(
    isDecimalInteger &&
      Number.isSafeInteger(parsed) &&
      parsed >= DETOX_CONNECTION_MIN_DEADLINE_MS &&
      parsed <= DETOX_CONNECTION_MAX_DEADLINE_MS,
    `Detox connection deadline must be an integer between ${DETOX_CONNECTION_MIN_DEADLINE_MS} and ${DETOX_CONNECTION_MAX_DEADLINE_MS} milliseconds`,
  );
  return parsed;
}

type DetoxSignalController = ReturnType<typeof createDetoxConnectionSignalController>;

async function cleanupDetoxArtifactRootBeforeDriver(
  lease: DetoxConnectionArtifactRootLease,
  cause: unknown,
  signal: AbortSignal,
  deadlineAt?: number,
): Promise<Error | null> {
  try {
    const cleanup = await lease.cleanupBeforeDriver({
      reason: 'Detox standalone preflight failed',
      signal,
      deadlineAt,
    });
    const recovery = await lease.retainRecoveryEvidence(
      cleanup,
      'Detox standalone preflight failed',
      { signal, deadlineAt },
    );
    return new Error(
      `Detox artifact-root preflight cleanup is ${cleanup.status}${
        recovery
          ? `; recovery retained at ${recovery.path} (${recovery.sha256})`
          : '; recovery publication unavailable'
      }`,
      { cause },
    );
  } catch (error) {
    return new Error('Detox artifact-root preflight cleanup could not be classified', {
      cause: error,
    });
  }
}

async function runMain(signalController: DetoxSignalController): Promise<void> {
  const repositoryRoot = path.resolve(
    required(process.env.MYCHAMPIONS_REPOSITORY_ROOT, 'MYCHAMPIONS_REPOSITORY_ROOT'),
  );
  const serverRoot = path.resolve(
    required(process.env.MYCHAMPIONS_SERVER_ROOT, 'MYCHAMPIONS_SERVER_ROOT'),
  );
  const artifactRoot = path.resolve(
    required(process.env.DETOX_CONNECTION_ARTIFACT_ROOT, 'DETOX_CONNECTION_ARTIFACT_ROOT'),
  );
  const configuredDeadlineMs = requireDetoxConnectionDeadlineMs(
    process.env.DETOX_CONNECTION_DEADLINE_MS,
  );
  const deadlineAt = performance.now() + configuredDeadlineMs;
  const artifactLease = await acquireDetoxConnectionArtifactRoot({
    root: artifactRoot,
    signal: signalController.signal,
    deadlineAt,
  });
  let transferred = false;
  try {
    const selection = await readPrivateJson<NativePilotSelection>(
      required(process.env.DETOX_CONNECTION_SELECTION_FILE, 'DETOX_CONNECTION_SELECTION_FILE'),
      artifactRoot,
    );
    const saveRetrySelection = process.env.DETOX_SAVE_RETRY_SELECTION_FILE
      ? await readPrivateJson<NativePilotSelection>(
          process.env.DETOX_SAVE_RETRY_SELECTION_FILE,
          artifactRoot,
        )
      : undefined;
    const build = await readPrivateJson<DetoxBaselineBuildInstrumentation>(
      required(process.env.DETOX_CONNECTION_BUILD_FILE, 'DETOX_CONNECTION_BUILD_FILE'),
      artifactRoot,
    );
    artifactLease.markTransferred();
    transferred = true;
    const result = await runOwnedDetoxConnectionAttempt({
      repositoryRoot,
      serverRoot,
      artifactRoot,
      selection,
      build,
      configuration: build.configuration,
      runnerPaths: {
        jestConfigPath: path.resolve(
          required(process.env.DETOX_CONNECTION_JEST_CONFIG, 'DETOX_CONNECTION_JEST_CONFIG'),
        ),
        testPath: path.resolve(
          required(process.env.DETOX_CONNECTION_TEST_PATH, 'DETOX_CONNECTION_TEST_PATH'),
        ),
        ...(process.env.DETOX_SAVE_RETRY_ACTIONS_PATH
          ? { saveRetryActionsPath: path.resolve(process.env.DETOX_SAVE_RETRY_ACTIONS_PATH) }
          : {}),
      },
      signal: signalController.signal,
      saveRetrySelection,
      deadlineMs: configuredDeadlineMs,
    });
    await writeDetoxConnectionResult({
      artifactRoot,
      expectedRootIdentity: artifactLease.identity,
      result,
      receivedSignals: signalController.receivedSignals,
      signal: signalController.signal,
      deadlineAt,
    });
    if (result.status !== 'source-only' || signalController.receivedSignals.length > 0)
      process.exitCode = 2;
  } catch (error) {
    if (transferred) throw error;
    const cleanupError = await cleanupDetoxArtifactRootBeforeDriver(
      artifactLease,
      error,
      signalController.signal,
      deadlineAt,
    );
    throw cleanupError ?? error;
  } finally {
    signalController.dispose();
  }
}

async function main(): Promise<void> {
  const signalController = createDetoxConnectionSignalController();
  try {
    await runMain(signalController);
  } finally {
    signalController.dispose();
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error: unknown) => {
    process.exitCode = 2;
    console.error(error instanceof Error ? error.message : String(error));
  });
}

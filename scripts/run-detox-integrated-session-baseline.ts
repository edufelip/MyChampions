import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  runDetoxIntegratedSessionBaseline,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselinePlatform,
  type DetoxBaselineRole,
} from './testing/detox-integrated-session-baseline';

function required(name: string): string {
  const value =
    name === 'DETOX_BASELINE_REPOSITORY_ROOT'
      ? process.env.DETOX_BASELINE_REPOSITORY_ROOT
      : name === 'DETOX_BASELINE_BUILD_JSON'
        ? process.env.DETOX_BASELINE_BUILD_JSON
        : name === 'DETOX_BASELINE_ARTIFACT_ROOT'
          ? process.env.DETOX_BASELINE_ARTIFACT_ROOT
          : name === 'DETOX_BASELINE_PLATFORM'
            ? process.env.DETOX_BASELINE_PLATFORM
            : name === 'DETOX_BASELINE_ROLE'
              ? process.env.DETOX_BASELINE_ROLE
              : name === 'DETOX_BASELINE_SERVER_ROOT'
                ? process.env.DETOX_BASELINE_SERVER_ROOT
                : name === 'DETOX_BASELINE_JEST_CONFIG'
                  ? process.env.DETOX_BASELINE_JEST_CONFIG
                  : name === 'DETOX_BASELINE_TEST_PATH'
                    ? process.env.DETOX_BASELINE_TEST_PATH
                    : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const repositoryRoot = path.resolve(required('DETOX_BASELINE_REPOSITORY_ROOT'));
const buildPath = path.resolve(required('DETOX_BASELINE_BUILD_JSON'));
const artifactRoot = path.resolve(required('DETOX_BASELINE_ARTIFACT_ROOT'));
const platform = required('DETOX_BASELINE_PLATFORM') as DetoxBaselinePlatform;
const role = required('DETOX_BASELINE_ROLE') as DetoxBaselineRole;
const configuration = platform === 'ios' ? 'ios.sim.debug' : 'android.emu.debug';
const build = JSON.parse(await readFile(buildPath, 'utf8')) as DetoxBaselineBuildInstrumentation;
const runnerPaths = {
  entryPath: path.resolve(new URL(import.meta.url).pathname),
  jestConfigPath: path.resolve(required('DETOX_BASELINE_JEST_CONFIG')),
  testPath: path.resolve(required('DETOX_BASELINE_TEST_PATH')),
} as const;
const maybeUnrefTimer = (timer: unknown): void => {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof (timer as { unref?: unknown }).unref === 'function'
  )
    (timer as { unref: () => void }).unref();
};

const controller = new AbortController();
const deadlineMs = Number(process.env.DETOX_BASELINE_DEADLINE_MS ?? 600_000);
const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
  if (!controller.signal.aborted) controller.abort(signal);
};
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);
const deadlineTimer = setTimeout(() => {
  if (!controller.signal.aborted) controller.abort('deadline');
}, deadlineMs);
maybeUnrefTimer(deadlineTimer);

try {
  const result = await runDetoxIntegratedSessionBaseline({
    repositoryRoot,
    serverRoot: path.resolve(required('DETOX_BASELINE_SERVER_ROOT')),
    artifactRoot,
    platform,
    configuration,
    role,
    build,
    runnerPaths,
    signal: controller.signal,
    deadlineMs,
  });
  process.stdout.write(`${result.reportPath}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.name : 'UnknownError'}\n`);
  process.exitCode = 2;
} finally {
  clearTimeout(deadlineTimer);
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
}

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadManifest } from './test-impact';
import {
  createSelectiveExecutionPlan,
  parseNativeMetroPort,
  parseSelectiveInvocationTimeoutMs,
  parseSelectedSuitesJson,
  type CommandInvocation,
  type SelectivePlatform,
} from './selective-execution';
import { prewarmMetroBundle } from './metro-bundle-prewarm';
import { stopMetroProcessGroup, stopRunnerOwnedProcessGroup } from './metro-process-group';

type TrackedProcessKind = 'invocation' | 'metro';

const activeProcessGroups = new Map<ChildProcess, TrackedProcessKind>();
const cancellationStops = new Map<ChildProcess, Promise<void>>();
let cancellationSignal: NodeJS.Signals | undefined;

function cancellationExitCode(signal: NodeJS.Signals): number {
  return signal === 'SIGINT' ? 130 : 143;
}

function throwIfCancellationRequested(): void {
  if (cancellationSignal) {
    throw new Error(`Selective execution cancelled by ${cancellationSignal}`);
  }
}

function stopForCancellation(child: ChildProcess, kind: TrackedProcessKind): Promise<void> {
  const existing = cancellationStops.get(child);
  if (existing) return existing;

  const options = { exitTimeoutMs: 500, pollIntervalMs: 50 };
  const stop =
    kind === 'metro'
      ? stopMetroProcessGroup(child, options)
      : stopRunnerOwnedProcessGroup(child, options);
  cancellationStops.set(child, stop);
  void stop.catch(() => {
    // The top-level cancellation path reports the retained rejection.
  });
  return stop;
}

function trackProcessGroup(child: ChildProcess, kind: TrackedProcessKind): void {
  activeProcessGroups.set(child, kind);
  if (cancellationSignal) void stopForCancellation(child, kind);
}

function requestCancellation(signal: NodeJS.Signals): void {
  if (cancellationSignal) return;
  cancellationSignal = signal;
  for (const [child, kind] of activeProcessGroups) {
    void stopForCancellation(child, kind);
  }
}

function installCancellationHandlers(): void {
  process.on('SIGINT', () => requestCancellation('SIGINT'));
  process.on('SIGTERM', () => requestCancellation('SIGTERM'));
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parsePlatform(value: string | undefined): SelectivePlatform {
  if (value === 'web' || value === 'ios' || value === 'android') return value;
  throw new Error('--platform must be web, ios, or android');
}

function isTrue(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

export function buildChildEnvironment(invocation: CommandInvocation): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...invocation.env,
  };

  for (const [key, value] of Object.entries(invocation.env)) {
    if (value === '') delete environment[key];
  }

  return environment;
}

function assertRequiredEnvironment(invocation: CommandInvocation): void {
  for (const key of invocation.requiredEnv ?? []) {
    const value = invocation.env[key] ?? process.env[key];
    if (!value?.trim()) {
      throw new Error(`${invocation.id} requires environment variable ${key}`);
    }
  }
}

export async function runChild(
  invocationId: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number | undefined,
): Promise<void> {
  throwIfCancellationRequested();
  console.log(`$ ${JSON.stringify([command, ...args])}`);
  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== 'win32',
    env,
    shell: false,
    stdio: 'inherit',
  });
  trackProcessGroup(child, 'invocation');
  let timedOut = false;
  const timeout =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          void stopForCancellation(child, 'invocation');
        }, timeoutMs);
  let result: { code: number | null; signal: NodeJS.Signals | null };
  try {
    result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolveResult, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveResult({ code, signal }));
    });
    const cancellationStop = cancellationStops.get(child);
    if (cancellationStop) {
      try {
        await cancellationStop;
      } catch (error) {
        if (timedOut) {
          throw new Error(
            `Invocation ${invocationId} timed out after ${timeoutMs} ms; process-group cleanup failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        throw error;
      }
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    activeProcessGroups.delete(child);
  }
  if (timedOut) {
    throw new Error(`Invocation ${invocationId} timed out after ${timeoutMs} ms`);
  }
  throwIfCancellationRequested();
  if (result.code !== 0) {
    throw new Error(
      `${command} failed with ${result.code === null ? `signal ${result.signal}` : `exit code ${result.code}`}`,
    );
  }
}

async function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolveResult(open);
    };
    socket.setTimeout(300);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForMetro(port: number, metro: ChildProcess): Promise<void> {
  const statusUrl = `http://127.0.0.1:${port}/status`;
  let spawnError: Error | null = null;
  const captureSpawnError = (error: Error) => {
    spawnError = error;
  };
  metro.once('error', captureSpawnError);

  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (spawnError) throw spawnError;
      if (metro.exitCode !== null || metro.signalCode !== null) {
        throw new Error(
          `Metro exited with ${
            metro.exitCode === null ? `signal ${metro.signalCode}` : `code ${metro.exitCode}`
          } before becoming ready`,
        );
      }
      try {
        const response = await fetch(statusUrl);
        if (response.ok && (await response.text()).trim() === 'packager-status:running') return;
      } catch {
        // Metro is still starting.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  } finally {
    metro.off('error', captureSpawnError);
  }
  throw new Error(`Metro did not become ready at ${statusUrl}`);
}

async function waitForPortToClose(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portIsOpen(port))) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return !(await portIsOpen(port));
}

async function runWithFreshMetro(
  invocation: CommandInvocation,
  cwd: string,
  timeoutMs: number | undefined,
): Promise<void> {
  throwIfCancellationRequested();
  const port = invocation.metro!.port;
  if (await portIsOpen(port)) {
    throw new Error(
      `${invocation.id} refuses to reuse occupied Metro port ${port}; selective fixture state must be isolated`,
    );
  }

  const env = buildChildEnvironment(invocation);
  const metro = spawn(
    'yarn',
    ['expo', 'start', '--dev-client', '--localhost', '--port', String(port), '--clear'],
    {
      cwd,
      detached: process.platform !== 'win32',
      env,
      shell: false,
      stdio: 'inherit',
    },
  );
  trackProcessGroup(metro, 'metro');

  try {
    await waitForMetro(port, metro);
    throwIfCancellationRequested();
    const bundleByteLength = await prewarmMetroBundle(invocation.metro!);
    throwIfCancellationRequested();
    if (metro.exitCode !== null || metro.signalCode !== null) {
      throw new Error(
        `Metro exited with ${
          metro.exitCode === null ? `signal ${metro.signalCode}` : `code ${metro.exitCode}`
        } after prewarming the ${invocation.metro!.platform} bundle`,
      );
    }
    console.log(`Prewarmed ${invocation.metro!.platform} Metro bundle (${bundleByteLength} bytes)`);
    await runChild(invocation.id, invocation.command, invocation.args, cwd, env, timeoutMs);
  } finally {
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      const cancellationStop = cancellationStops.get(metro);
      if (cancellationStop) {
        await cancellationStop;
      } else {
        await stopMetroProcessGroup(metro);
      }
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    } finally {
      activeProcessGroups.delete(metro);
    }

    if (!(await waitForPortToClose(port, 5_000))) {
      const cleanupContext = cleanupFailed
        ? `; process cleanup also failed: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`
        : '';
      throw new Error(
        `Metro port ${port} remained occupied after process-group cleanup${cleanupContext}`,
      );
    }
    if (cleanupFailed) throw cleanupError;
  }
}

async function runInvocation(
  invocation: CommandInvocation,
  cwd: string,
  timeoutMs: number | undefined,
): Promise<void> {
  throwIfCancellationRequested();
  assertRequiredEnvironment(invocation);
  if (invocation.metro) {
    await runWithFreshMetro(invocation, cwd, timeoutMs);
    return;
  }
  await runChild(
    invocation.id,
    invocation.command,
    invocation.args,
    cwd,
    buildChildEnvironment(invocation),
    timeoutMs,
  );
}

async function main(): Promise<void> {
  throwIfCancellationRequested();
  const root = resolve(process.cwd());
  const platform = parsePlatform(valueAfter('--platform'));
  const suitesJson = valueAfter('--suites-json') ?? process.env.SELECTED_SUITES_JSON;
  const selectedSuites = parseSelectedSuitesJson(suitesJson);
  const invocationTimeoutMs = parseSelectiveInvocationTimeoutMs(
    process.env.SELECTIVE_INVOCATION_TIMEOUT_MS,
  );
  const metroPort =
    platform === 'ios' || platform === 'android'
      ? parseNativeMetroPort(platform, process.env.DETOX_METRO_PORT)
      : undefined;
  const plan = createSelectiveExecutionPlan(loadManifest(root), platform, selectedSuites, {
    skipNativeBuild: isTrue(process.env.DETOX_SKIP_BUILD),
    diagnosticsRoot: process.env.SELECTIVE_TEST_DIAGNOSTICS_ROOT ?? '.artifacts/ci-diagnostics',
    metroPort,
  });

  if (process.argv.includes('--plan') || process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (plan.nativeBuild?.owner === 'executor') {
    await runInvocation(plan.nativeBuild.command, root, invocationTimeoutMs);
  } else if (plan.nativeBuild) {
    console.log(
      `Using workflow-owned ${plan.nativeBuild.configuration} build; executor will not rebuild per suite.`,
    );
  }

  for (const invocation of plan.invocations) {
    await runInvocation(invocation, root, invocationTimeoutMs);
  }
  throwIfCancellationRequested();
}

async function reportFailure(error: unknown): Promise<void> {
  const cleanupResults = await Promise.allSettled(cancellationStops.values());
  for (const result of cleanupResults) {
    if (result.status === 'rejected') {
      console.error(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = cancellationSignal ? cancellationExitCode(cancellationSignal) : 1;
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  installCancellationHandlers();
  void main().catch(reportFailure);
}

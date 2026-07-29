import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { loadManifest } from './test-impact';
import {
  createSelectiveExecutionPlan,
  parseSelectedSuitesJson,
  type CommandInvocation,
  type SelectivePlatform,
} from './selective-execution';
import { stopMetroProcessGroup } from './metro-process-group';

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

function childEnvironment(invocation: CommandInvocation): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...invocation.env,
  };
}

function assertRequiredEnvironment(invocation: CommandInvocation): void {
  for (const key of invocation.requiredEnv ?? []) {
    const value = invocation.env[key] ?? process.env[key];
    if (!value?.trim()) {
      throw new Error(`${invocation.id} requires environment variable ${key}`);
    }
  }
}

async function runChild(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  console.log(`$ ${JSON.stringify([command, ...args])}`);
  const child = spawn(command, args, {
    cwd,
    env,
    shell: false,
    stdio: 'inherit',
  });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveResult, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveResult({ code, signal }));
    }
  );
  if (result.code !== 0) {
    throw new Error(
      `${command} failed with ${result.code === null ? `signal ${result.signal}` : `exit code ${result.code}`}`
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
          } before becoming ready`
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
  cwd: string
): Promise<void> {
  const port = invocation.metro!.port;
  if (await portIsOpen(port)) {
    throw new Error(
      `${invocation.id} refuses to reuse occupied Metro port ${port}; selective fixture state must be isolated`
    );
  }

  const env = childEnvironment(invocation);
  const metro = spawn(
    'yarn',
    ['expo', 'start', '--dev-client', '--localhost', '--port', String(port), '--clear'],
    {
      cwd,
      detached: process.platform !== 'win32',
      env,
      shell: false,
      stdio: 'inherit',
    }
  );

  try {
    await waitForMetro(port, metro);
    await runChild(invocation.command, invocation.args, cwd, env);
  } finally {
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      await stopMetroProcessGroup(metro);
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    }

    if (!(await waitForPortToClose(port, 5_000))) {
      const cleanupContext = cleanupFailed
        ? `; process cleanup also failed: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`
        : '';
      throw new Error(
        `Metro port ${port} remained occupied after process-group cleanup${cleanupContext}`
      );
    }
    if (cleanupFailed) throw cleanupError;
  }
}

async function runInvocation(invocation: CommandInvocation, cwd: string): Promise<void> {
  assertRequiredEnvironment(invocation);
  if (invocation.metro) {
    await runWithFreshMetro(invocation, cwd);
    return;
  }
  await runChild(
    invocation.command,
    invocation.args,
    cwd,
    childEnvironment(invocation)
  );
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const platform = parsePlatform(valueAfter('--platform'));
  const suitesJson = valueAfter('--suites-json') ?? process.env.SELECTED_SUITES_JSON;
  const selectedSuites = parseSelectedSuitesJson(suitesJson);
  const plan = createSelectiveExecutionPlan(
    loadManifest(root),
    platform,
    selectedSuites,
    {
      skipNativeBuild: isTrue(process.env.DETOX_SKIP_BUILD),
      diagnosticsRoot:
        process.env.SELECTIVE_TEST_DIAGNOSTICS_ROOT ?? '.artifacts/ci-diagnostics',
    }
  );

  if (process.argv.includes('--plan') || process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (plan.nativeBuild?.owner === 'executor') {
    await runInvocation(plan.nativeBuild.command, root);
  } else if (plan.nativeBuild) {
    console.log(
      `Using workflow-owned ${plan.nativeBuild.configuration} build; executor will not rebuild per suite.`
    );
  }

  for (const invocation of plan.invocations) {
    await runInvocation(invocation, root);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

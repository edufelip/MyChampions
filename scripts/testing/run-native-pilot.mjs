import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const shellRunner = path.join(repositoryRoot, 'scripts', 'testing', 'run-native-pilot.sh');

function signalExitCode(signal) {
  const number = signal && osConstants.signals[signal];
  return typeof number === 'number' ? 128 + number : 2;
}

function runShellRunner() {
  const child = spawn('bash', [shellRunner, ...process.argv.slice(2)], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  const forwardSignal = (signal) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  const onInterrupt = () => forwardSignal('SIGINT');
  const onTerminate = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  const completion = new Promise((resolve) => {
    let spawnError;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (code, signal) => resolve({ code, signal, spawnError }));
  });

  return completion.finally(() => {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  });
}

try {
  const result = await runShellRunner();
  if (result.spawnError) {
    process.stderr.write(
      `Native pilot entry blocked: could not start shell runner (${result.spawnError.message})\n`,
    );
    process.exitCode = 2;
  } else {
    process.exitCode = result.code ?? signalExitCode(result.signal);
  }
} catch (error) {
  process.stderr.write(
    `Native pilot entry blocked: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}

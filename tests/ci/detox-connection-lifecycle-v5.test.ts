import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  createDetoxConnectionSignalController,
  runDetoxCleanupAggregate,
} from '../../scripts/testing/detox-connection-lifecycle';

void test('Detox cleanup aggregate stops after a non-cooperative release and stays unverified', async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: string[] = [];
  try {
    const result = await runDetoxCleanupAggregate({
      deadlineMs: 20,
      steps: [
        {
          label: 'proxy',
          operation: async () => {
            started.push('proxy');
            await pending;
          },
        },
        {
          label: 'backend',
          operation: () => {
            started.push('backend');
            return Promise.resolve();
          },
        },
      ],
    });
    assert.deepEqual(started, ['proxy']);
    assert.equal(result.status, 'failed');
    assert.equal(result.recoveryStatus, 'not-verified');
    assert.deepEqual(result.timedOutLabels, ['proxy']);
    assert.deepEqual(result.skippedLabels, ['backend']);
    assert.deepEqual(
      result.stepResults.map((step) => ({ label: step.label, status: step.status })),
      [
        { label: 'proxy', status: 'not-verified' },
        { label: 'backend', status: 'skipped' },
      ],
    );
    assert.match(result.failures.join('\n'), /not-attempted-after-recovery-timeout/);
  } finally {
    release?.();
    await pending;
  }
});

void test('Detox cleanup aggregate keeps settled release failures explicit and continues bounded releases', async () => {
  const started: string[] = [];
  const result = await runDetoxCleanupAggregate({
    deadlineMs: 100,
    steps: [
      {
        label: 'proxy',
        operation: () => {
          started.push('proxy');
          return Promise.reject(new Error('proxy refused stop'));
        },
      },
      {
        label: 'backend',
        operation: () => {
          started.push('backend');
          return Promise.resolve();
        },
      },
      {
        label: 'target',
        operation: () => {
          started.push('target');
          return Promise.resolve();
        },
      },
      {
        label: 'app-port',
        operation: () => {
          started.push('app-port');
          return Promise.resolve();
        },
      },
    ],
  });
  assert.deepEqual(started, ['proxy', 'backend', 'target', 'app-port']);
  assert.equal(result.status, 'failed');
  assert.equal(result.recoveryStatus, 'verified');
  assert.match(result.failures[0] ?? '', /proxy refused stop/);
  assert.deepEqual(
    result.stepResults.map((step) => ({ label: step.label, status: step.status })),
    [
      { label: 'proxy', status: 'failed' },
      { label: 'backend', status: 'settled' },
      { label: 'target', status: 'settled' },
      { label: 'app-port', status: 'settled' },
    ],
  );
});

void test('Detox signal controller aborts and removes both signal listeners', () => {
  const emitter = new EventEmitter();
  const controller = createDetoxConnectionSignalController(emitter as never);
  emitter.emit('SIGINT');
  emitter.emit('SIGTERM');
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(controller.receivedSignals, ['SIGINT', 'SIGTERM']);
  assert.equal((controller.signal.reason as Error).name, 'DetoxConnectionSignalError');
  controller.dispose();
  controller.dispose();
  assert.equal(emitter.listenerCount('SIGINT'), 0);
  assert.equal(emitter.listenerCount('SIGTERM'), 0);
});

async function runSignalChild(signal: 'SIGINT' | 'SIGTERM'): Promise<string> {
  const modulePath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../scripts/testing/detox-connection-lifecycle.ts',
  );
  const moduleUrl = pathToFileURL(modulePath).href;
  const source = `
    import * as lifecycleNamespace from ${JSON.stringify(moduleUrl)};
    const lifecycleModule = lifecycleNamespace.default ?? lifecycleNamespace['module.exports'] ?? lifecycleNamespace;
    const createDetoxConnectionSignalController = lifecycleModule.createDetoxConnectionSignalController;
    if (typeof createDetoxConnectionSignalController !== 'function') throw new Error('Detox signal controller export is unavailable');
    const controller = createDetoxConnectionSignalController();
    process.stdout.write('ready\\n');
    controller.signal.addEventListener('abort', () => {
      process.stdout.write(JSON.stringify({ signal: controller.signal.reason.signal, aborted: controller.signal.aborted }) + '\\n');
      controller.dispose();
      setTimeout(() => process.exit(0), 10);
    }, { once: true });
    setTimeout(() => process.exit(3), 5000);
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: path.resolve(path.dirname(modulePath), '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    output += chunk;
  });
  await new Promise<void>((resolve, reject) => {
    if (output.includes('ready\n')) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`signal child did not become ready: ${output}`));
    }, 5_000);
    const onData = () => {
      if (!output.includes('ready\n')) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve();
    };
    child.stdout.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  child.kill(signal);
  const exitResult = (await once(child, 'exit')) as unknown[];
  const result = exitResult[0];
  assert.equal(result, 0);
  return output;
}

void test('standalone Detox entry receives SIGINT and SIGTERM and preserves cancellation semantics', async () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const output = await runSignalChild(signal);
    assert.match(output, new RegExp(`"signal":"${signal}"`));
    assert.match(output, /"aborted":true/);
  }
});

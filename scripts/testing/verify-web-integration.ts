import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { assertNoIntegratedBypasses } from './integration-preflight';
import { INTEGRATION_PROJECTS } from './integration-registry';
import { assertPublicReceipt } from './schema-validation';

const execute = promisify(execFile);
let verifierOutput: string | undefined;
type Summary = {
  counts: {
    requested: number | null;
    started: number;
    passed: number;
    blocked: number;
    cancelled: number;
  };
  exitCode: number;
  cleanupFailed: boolean;
};
async function main() {
  process.umask(0o077);
  assertNoIntegratedBypasses(process.env);
  const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const batches = path.join(root, '.qa/artifacts/web-integration');
  await mkdir(batches, { recursive: true, mode: 0o700 });
  const output = path.join(
    root,
    '.qa/artifacts/testing-modernization/2026-09-28-p3',
    `integration-verifier-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  verifierOutput = output;
  const results: { probe: string; artifactRoot: string; exitCode: number; receiptCount: number }[] =
    [];
  const focused = ['--scenario=auth-session', '--project=chromium'];
  const run = async (
    name: string,
    args: string[],
    env: Record<string, string> = {},
    signal?: 'SIGINT' | 'SIGTERM',
    cancellationStage: 'worker' | 'acquisition' = 'worker',
  ) => {
    const before = new Set(await readdir(batches));
    const child = spawn(
      process.execPath,
      [path.join(root, 'scripts/run-web-e2e-batch.mjs'), 'integration', ...args],
      {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let log = '';
    let closed = false;
    const completed = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, cause) => {
        closed = true;
        resolve(code ?? (cause === 'SIGINT' ? 130 : cause === 'SIGTERM' ? 143 : 2));
      });
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (bytes: Buffer) => {
        log = (log + bytes.toString()).slice(-2_097_152);
      });
    try {
      if (signal) {
        const deadline = performance.now() + 100_000;
        let observed = false;
        while (!closed && performance.now() < deadline && !observed) {
          for (const id of (await readdir(batches)).filter((id) => !before.has(id))) {
            const directory = path.join(batches, id);
            try {
              if (cancellationStage === 'acquisition') {
                const acquired = JSON.parse(
                  await readFile(path.join(directory, 'backend-acquired.private.json'), 'utf8'),
                ) as {
                  parentPid: number;
                  orchestratorPid: number;
                  started: string;
                };
                const parent = (
                  await execute('ps', ['-p', String(acquired.parentPid), '-o', 'ppid='], {
                    timeout: 5000,
                  })
                ).stdout.trim();
                const started = (
                  await execute('ps', ['-p', String(acquired.orchestratorPid), '-o', 'lstart='], {
                    timeout: 5000,
                  })
                ).stdout.trim();
                if (Number(parent) !== child.pid || started !== acquired.started) continue;
                child.kill(signal);
                observed = true;
                continue;
              }
              const context = JSON.parse(
                await readFile(path.join(directory, 'integration-context.private.json'), 'utf8'),
              ) as { parentPid: number; parentStarted: string };
              const parent = (
                await execute('ps', ['-p', String(context.parentPid), '-o', 'ppid='], {
                  timeout: 5000,
                })
              ).stdout.trim();
              if (Number(parent) !== child.pid) continue;
              const ledger = JSON.parse(
                await readFile(
                  path.join(directory, 'playwright.private.log.ownership.json'),
                  'utf8',
                ),
              ) as {
                pid: number;
                pgid: number;
                cleanup: string;
                processes: { pid: number; started: string }[];
              };
              const leader = ledger.processes.find((row) => row.pid === ledger.pid);
              if (ledger.cleanup !== 'running' || ledger.pid !== ledger.pgid || !leader) continue;
              const started = (
                await execute('ps', ['-p', String(ledger.pid), '-o', 'lstart='], { timeout: 5000 })
              ).stdout.trim();
              if (started !== leader.started) continue;
              // Signal the directly spawned wrapper, never a PID discovered by a port search.
              child.kill(signal);
              observed = true;
            } catch {
              /* A file not yet written or an exited child is not a live ownership claim. */
            }
          }
          if (!observed) await delay(100);
        }
        assert(observed, `Did not observe the owned live ${cancellationStage} before cancellation`);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let code: number;
      try {
        code = await Promise.race([
          completed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Wrapper did not finish within its verified lifecycle bound')),
              110_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      await writeFile(path.join(output, `${name}.private.log`), log, { mode: 0o600 });
      const location = /^Integrated browser artifacts: (.+)$/m.exec(log)?.[1];
      assert(location && location.startsWith(batches + path.sep), 'Missing owned artifact output');
      const summary = JSON.parse(
        await readFile(path.join(location, 'batch-summary.json'), 'utf8'),
      ) as Summary;
      assert.equal(summary.exitCode, code);
      assert.equal(summary.cleanupFailed, false);
      assert.equal(summary.counts.passed, 0);
      const receipts = (await readdir(location)).filter((file) => file.endsWith('.receipt.json'));
      assert.equal(
        receipts.length,
        name === 'full-bypass' ? 45 : signal && cancellationStage === 'worker' ? 9 : 1,
      );
      for (const file of receipts) {
        const value: unknown = JSON.parse(await readFile(path.join(location, file), 'utf8'));
        assertPublicReceipt(value, location);
        const receipt = value as {
          result: string;
          exitCode: number;
          cleanup: { status: string; ownedResourceIds: string[] };
        };
        assert.equal(receipt.result, signal ? 'cancelled' : 'harness-blocked');
        assert.equal(receipt.exitCode, signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 2);
        if (!signal && name !== 'deadline') {
          assert.equal(receipt.cleanup.status, 'not-acquired');
          assert.deepEqual(receipt.cleanup.ownedResourceIds, []);
          assert.equal(summary.counts.started, 0);
        } else {
          assert.equal(receipt.cleanup.status, 'cleaned');
          if (cancellationStage === 'acquisition') assert.equal(summary.counts.started, 0);
        }
      }
      results.push({
        probe: name,
        artifactRoot: location,
        exitCode: code,
        receiptCount: receipts.length,
      });
      await writeFile(
        path.join(output, 'completed-probes.json'),
        JSON.stringify(results, null, 2),
        { mode: 0o600 },
      );
    } finally {
      if (!closed) {
        child.kill('SIGTERM');
        // No unsafe escalation: retained ledgers identify any cleanup still needing recovery.
      }
    }
  };
  // All five cases are implemented. Prove a full requested selection rejects
  // an inherited fixture before acquisition; do not rely on a placeholder.
  await run('full-bypass', [], { EXPO_PUBLIC_E2E_AUTH_SESSION: 'true' });
  await run('unknown-project', ['--scenario=auth-session', '--project=unknown']);
  await run('duplicate-scenario', ['--scenario=auth-session,auth-session', '--project=chromium']);
  await run('bypass', focused, { EXPO_PUBLIC_E2E_AUTH_SESSION: 'true' });
  await run('wrong-origin', focused, {
    EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL: 'https://example.invalid',
  });
  await run('wrong-variant', focused, { APP_VARIANT: 'prod' });
  const matrix = [
    '--scenario=auth-session',
    `--project=${Object.keys(INTEGRATION_PROJECTS).join(',')}`,
  ];
  await run('cancel-int', matrix, {}, 'SIGINT');
  await run('cancel-term', matrix, {}, 'SIGTERM');
  await run('cancel-acquisition-int', focused, {}, 'SIGINT', 'acquisition');
  await run('cancel-acquisition-term', focused, {}, 'SIGTERM', 'acquisition');
  await run('deadline', [...focused, '--deadline-ms=3000']);
  await writeFile(
    path.join(output, 'receipt.json'),
    JSON.stringify(
      {
        result: 'passed',
        scope:
          'integration rejection, live worker/acquisition cancellation and whole-run deadline; no five-journey completion claim',
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Integration runner verification: ${path.join(output, 'receipt.json')}`);
}
void main().catch(async (error: unknown) => {
  if (verifierOutput)
    await writeFile(
      path.join(verifierOutput, 'failure.private.log'),
      error instanceof Error ? (error.stack ?? error.message) : 'Verifier failed',
      { mode: 0o600 },
    );
  console.error(
    'Integration runner verification failed; private attempts and owner ledgers retained.',
  );
  process.exitCode = 2;
});

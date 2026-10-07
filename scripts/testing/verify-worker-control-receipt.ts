import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { loadIntegrationContext } from './integration-context';
import { assertNoIntegratedBypasses } from './integration-preflight';
import { assertPublicReceipt, assertTestingDocument } from './schema-validation';
import type { IntegrationContext } from './integration-context';

const execute = promisify(execFile);
let output: string | undefined;
async function main() {
  process.umask(0o077);
  assertNoIntegratedBypasses(process.env);
  const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const batches = path.join(root, '.qa/artifacts/web-integration');
  await mkdir(batches, { recursive: true, mode: 0o700 });
  const before = new Set(await readdir(batches));
  output = path.join(
    root,
    '.qa/artifacts/testing-modernization/2026-09-28-p3',
    `worker-control-receipt-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'scripts/run-web-e2e-batch.mjs'),
      'integration',
      '--scenario=training-durable',
      '--project=chromium',
    ],
    { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let closed = false;
  let log = '';
  const completed = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      closed = true;
      resolve(code ?? 2);
    });
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (bytes: Buffer) => {
      log = (log + bytes.toString()).slice(-2_097_152);
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = () =>
    Promise.race([
      completed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned wrapper deadline exceeded')), 110_000);
      }),
    ]).finally(() => clearTimeout(timer));
  let selected: IntegrationContext | undefined;
  try {
    const deadline = performance.now() + 100_000;
    while (!closed && performance.now() < deadline && !selected) {
      for (const id of (await readdir(batches)).filter((id) => !before.has(id))) {
        const directory = path.join(batches, id);
        const file = path.join(directory, 'integration-context.private.json');
        let context: IntegrationContext;
        let ledger: {
          pid: number;
          pgid: number;
          cleanup: string;
          processes: { pid: number; started: string }[];
        };
        try {
          context = JSON.parse(await readFile(file, 'utf8')) as IntegrationContext;
          ledger = JSON.parse(
            await readFile(path.join(directory, 'discovery.private.log.ownership.json'), 'utf8'),
          ) as typeof ledger;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        const leader = ledger.processes.find((row) => row.pid === ledger.pid);
        if (ledger.cleanup !== 'running' || ledger.pid !== ledger.pgid || !leader) continue;
        const query = async (pid: number, column: string) =>
          (await execute('ps', ['-p', String(pid), '-o', column], { timeout: 5000 })).stdout.trim();
        let parent: string;
        let workerParent: string;
        let workerStarted: string;
        try {
          parent = await query(context.parentPid, 'ppid=');
          workerParent = await query(ledger.pid, 'ppid=');
          workerStarted = await query(ledger.pid, 'lstart=');
        } catch (error) {
          // An exited discovery child does not authorize changing this run.
          if ((error as { code?: unknown }).code === 1) continue;
          throw error;
        }
        if (
          Number(parent) !== child.pid ||
          Number(workerParent) !== context.parentPid ||
          workerStarted !== leader.started
        )
          continue;
        context = loadIntegrationContext(file);
        assert.equal(context.cases.length, 1);
        assert.equal(context.cases[0].attemptId, 'training-durable--chromium');
        assert.equal(context.artifactRoot, await realpath(directory));
        assert(context.control);
        // The parent retains its original in-memory capability. Only this owned
        // worker input changes, after the parent's last discovery-time rewrite.
        context.cases[0].controlToken = randomBytes(32).toString('hex');
        assertTestingDocument('integration-context-v1', context);
        const temporary = path.join(directory, 'invalid-capability.private.json');
        await writeFile(temporary, JSON.stringify(context), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
        selected = context;
        break;
      }
      if (!selected) await delay(25);
    }
    assert(selected, 'No directly owned live discovery child observed; no capability changed');
    const code = await bounded();
    await writeFile(path.join(output, 'wrapper.private.log'), log, { mode: 0o600 });
    assert.equal(code, 2);
    const location = /^Integrated browser artifacts: (.+)$/m.exec(log)?.[1];
    assert.equal(location, selected.artifactRoot);
    const summary = JSON.parse(
      await readFile(path.join(selected.artifactRoot, 'batch-summary.json'), 'utf8'),
    ) as { counts: object; exitCode: number; childExitCode: number; cleanupFailed: boolean };
    assert.deepEqual(summary.counts, {
      requested: 1,
      started: 1,
      passed: 0,
      applicationFailed: 0,
      blocked: 1,
      cancelled: 0,
    });
    assert.equal(summary.exitCode, 2);
    assert.equal(summary.childExitCode, 1);
    assert.equal(summary.cleanupFailed, false);
    const receipt: unknown = JSON.parse(
      await readFile(
        path.join(selected.artifactRoot, 'training-durable--chromium.receipt.json'),
        'utf8',
      ),
    );
    assertPublicReceipt(receipt, selected.artifactRoot);
    assert.equal((receipt as { result: string }).result, 'harness-blocked');
    assert.equal((receipt as { cleanup: { status: string } }).cleanup.status, 'cleaned');
    assert.equal((receipt as { blocker: { code: string } }).blocker.code, 'WORKER_CONTROL');
    const control = JSON.parse(
      await readFile(path.join(selected.artifactRoot, 'worker-control.json'), 'utf8'),
    ) as { observations: unknown[] };
    assert.deepEqual(control.observations, []);
    await assert.rejects(access(selected.control!.root), { code: 'ENOENT' });
    await writeFile(
      path.join(output, 'receipt.json'),
      JSON.stringify({ result: 'passed', artifactRoot: selected.artifactRoot, summary }, null, 2),
      { mode: 0o600 },
    );
    console.log(`Worker control receipt verification: ${path.join(output, 'receipt.json')}`);
  } finally {
    clearTimeout(timer);
    if (!closed) {
      child.kill('SIGTERM');
      await bounded();
    }
  }
}
void main().catch(async (error: unknown) => {
  if (output)
    await writeFile(
      path.join(output, 'failure.private.log'),
      error instanceof Error ? (error.stack ?? error.message) : 'Verifier failed',
      { mode: 0o600 },
    );
  console.error('Worker control receipt verification failed; private owner evidence retained.');
  process.exitCode = 2;
});

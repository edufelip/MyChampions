import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import {
  startOwnedSession,
  OwnedSessionAcquisitionError,
  readOwnedRuntimeDocument,
} from './owned-session';

const execute = promisify(execFile);
let output: string | undefined;
async function main() {
  process.umask(0o077);
  const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const serverRoot = path.resolve(root, '../server');
  output = path.join(
    root,
    '.qa/artifacts/testing-modernization/2026-09-28-p3',
    `acquisition-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const results: object[] = [];
  const rejected = async (
    label: string,
    options: Parameters<typeof startOwnedSession>[0],
    cleanup: OwnedSessionAcquisitionError['cleanup'],
  ) => {
    let failure: OwnedSessionAcquisitionError | undefined;
    let unexpected: Awaited<ReturnType<typeof startOwnedSession>> | undefined;
    try {
      unexpected = await startOwnedSession(options);
    } catch (error) {
      assert(error instanceof OwnedSessionAcquisitionError);
      failure = error;
    } finally {
      await unexpected?.stop();
    }
    assert(failure, `${label} unexpectedly reached API readiness`);
    assert.equal(failure.cleanup, cleanup);
    if (cleanup === 'not-acquired') {
      assert.equal(failure.manifest, undefined);
      assert.equal(failure.pid, undefined);
      assert.equal(failure.childExitCode, null);
    } else {
      assert(failure.manifest && failure.closed && failure.pid);
      assert.equal(failure.closed.exitCode, failure.childExitCode);
      const manifest = failure.manifest;
      const receipt = (await readOwnedRuntimeDocument(
        failure.closed.receiptPath,
        manifest.artifactRoot,
        'session-receipt.json',
        'session-receipt-v1',
      )) as { runId: string; exitCode: number; cleanup: string };
      assert.equal(receipt.runId, manifest.runId);
      assert.equal(receipt.cleanup, 'cleaned');
      for (const args of [
        ['ps', '-aq'],
        ['network', 'ls', '-q'],
      ])
        assert.equal(
          (
            await execute(
              'docker',
              [...args, '--filter', `label=com.docker.compose.project=${manifest.composeProject}`],
              { timeout: 15_000 },
            )
          ).stdout.trim(),
          '',
        );
      await assert.rejects(access(path.join(manifest.artifactRoot, 'private.json')), {
        code: 'ENOENT',
      });
      await assert.rejects(access(path.join(manifest.artifactRoot, 'compose.env')), {
        code: 'ENOENT',
      });
      try {
        const status = (
          await execute('ps', ['-p', String(failure.pid), '-o', 'stat='], { timeout: 5000 })
        ).stdout.trim();
        assert(!status || status.startsWith('Z'));
      } catch (error) {
        if ((error as { code?: number }).code !== 1) throw error;
      }
    }
    results.push({
      label,
      cleanup,
      childExitCode: failure.childExitCode,
      runId: failure.manifest?.runId ?? null,
      closeReceipt: failure.closed?.receiptPath ?? null,
    });
    await writeFile(path.join(output!, 'completed-probes.json'), JSON.stringify(results, null, 2), {
      mode: 0o600,
    });
    await writeFile(path.join(output!, `${label}.private.log`), failure.diagnostics, {
      mode: 0o600,
    });
  };
  const appOrigin = 'http://127.0.0.1:42111';
  const aborted = new AbortController();
  aborted.abort();
  await rejected(
    'already-aborted',
    { serverRoot, appOrigin, signal: aborted.signal },
    'not-acquired',
  );
  await rejected(
    'wrong-bun-preflight',
    { serverRoot, appOrigin, bunExecutable: '/usr/bin/true' },
    'not-acquired',
  );
  const cancel = new AbortController();
  let acquired = false;
  await rejected(
    'abort-after-owned-ledger',
    {
      serverRoot,
      appOrigin,
      signal: cancel.signal,
      onAcquired(manifest) {
        assert(manifest.orchestratorPid > 1);
        acquired = true;
        cancel.abort();
      },
    },
    'cleaned',
  );
  assert(acquired);
  await rejected(
    'backend-deadline-before-ready',
    { serverRoot, appOrigin, deadlineMs: 1000 },
    'cleaned',
  );
  const session = await startOwnedSession({ serverRoot, appOrigin });
  const closed = await session.stop();
  assert.equal(closed.cleanup, 'cleaned');
  results.push({
    label: 'ready-normal-stop',
    runId: session.manifest.runId,
    cleanup: closed.cleanup,
    childExitCode: closed.exitCode,
  });
  await writeFile(
    path.join(output, 'receipt.json'),
    JSON.stringify(
      {
        result: 'passed',
        scope: 'private session acquisition/preflight/closed-before-ready; not browser journeys',
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Session acquisition verification: ${path.join(output, 'receipt.json')}`);
}
void main().catch(async (error: unknown) => {
  if (output)
    await writeFile(
      path.join(output, 'failure.private.log'),
      error instanceof Error ? (error.stack ?? error.message) : 'Acquisition verifier failed',
      { mode: 0o600 },
    );
  console.error('Session acquisition verification failed; private ownership evidence retained.');
  process.exitCode = 2;
});

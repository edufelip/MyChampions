import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { startOwnedSession, readOwnedRuntimeDocument } from './owned-session';

const execute = promisify(execFile);
let output: string | undefined;
async function main() {
  process.umask(0o077);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  output = path.join(
    root,
    '.qa/artifacts/testing-modernization/2026-09-28-p3',
    `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const results: object[] = [];
  const clean = async (session: Awaited<ReturnType<typeof startOwnedSession>>) => {
    for (const args of [
      ['ps', '-aq'],
      ['network', 'ls', '-q'],
    ])
      assert.equal(
        (
          await execute(
            'docker',
            [
              ...args,
              '--filter',
              `label=com.docker.compose.project=${session.manifest.composeProject}`,
            ],
            { timeout: 15000 },
          )
        ).stdout.trim(),
        '',
      );
    assert(
      !(await readdir(session.manifest.artifactRoot)).some((file) =>
        /^(fixtures|snapshot)-.*\.private\.json$/.test(file),
      ),
    );
    await assert.rejects(access(path.join(session.manifest.artifactRoot, 'private.json')), {
      code: 'ENOENT',
    });
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const session = await startOwnedSession({
      serverRoot: path.resolve(root, '../server'),
      appOrigin: 'http://127.0.0.1:42401',
    });
    try {
      const scope = `snapshot-${attempt}`;
      const fixture = await session.fixtures(scope);
      const other = await session.fixtures(`other-snapshot-${attempt}`);
      const before = await session.snapshot(scope);
      assert.equal(before.readOnly, true);
      assert.equal(before.trainingPlans.length, 1);
      assert.equal(before.trainingPlans[0].id, fixture.savedPlanId);
      assert.equal(before.trainingPlans[0].name, fixture.draft.name);
      assert.deepEqual(before.trainingPlans[0].sessions, fixture.draft.sessions);
      assert.equal(before.connections.length, 2);
      assert(
        before.connections.some(
          (row) => row.id === fixture.activeConnectionId && row.status === 'active',
        ),
      );
      assert(
        before.connections.some(
          (row) => row.id === fixture.pendingConnectionId && row.status === 'pending_confirmation',
        ),
      );
      assert(!JSON.stringify(before).includes(other.accounts.coach.authUid));
      assert(!before.trainingPlans.some((row) => row.id === other.savedPlanId));
      const login = await fetch(`${session.apiOrigin}/auth/email/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: fixture.accounts.coach.email,
          password: fixture.accounts.coach.password,
          sessionMode: 'cookie',
        }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(login.status, 201);
      const token = ((await login.json()) as { accessToken: string }).accessToken;
      const nextName = `${fixture.draft.name} Updated`;
      const sessions = structuredClone(fixture.draft.sessions);
      sessions[0].items[0].quantity = '3x12';
      const changed = await fetch(`${session.apiOrigin}/plans/training/${fixture.savedPlanId}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: nextName, sessions }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(changed.status, 200);
      const after = await session.snapshot(scope);
      assert.equal(after.trainingPlans.length, 1);
      assert.equal(after.trainingPlans[0].name, nextName);
      assert.deepEqual(after.trainingPlans[0].sessions, sessions);
      assert.deepEqual(after.connections, before.connections);
      const pid = session.apiPid;
      await session.restart();
      assert.notEqual(session.apiPid, pid);
      assert.deepEqual(await session.snapshot(scope), after);
      const closed = await session.stop();
      assert.equal(closed.cleanup, 'cleaned');
      await clean(session);
      results.push({
        label: `fresh-${attempt}`,
        runId: session.manifest.runId,
        readOnly: true,
        trainingPlans: 1,
        connections: 2,
        scopedIsolation: true,
        mutationObserved: true,
        survivedRestart: true,
        cleanup: closed.cleanup,
      });
    } finally {
      await session.stop().catch(() => session.cancel('SIGTERM').catch(() => {}));
    }
  }
  const denied = await startOwnedSession({
    serverRoot: path.resolve(root, '../server'),
    appOrigin: 'http://127.0.0.1:42401',
  });
  try {
    await assert.rejects(denied.snapshot('unseeded'), /closed with an outstanding request/);
    const receipt = (await readOwnedRuntimeDocument(
      path.join(denied.manifest.artifactRoot, 'session-receipt.json'),
      denied.manifest.artifactRoot,
      'session-receipt.json',
      'session-receipt-v1',
    )) as { exitCode: number; cleanup: string };
    assert.equal(receipt.exitCode, 2);
    assert.equal(receipt.cleanup, 'cleaned');
    await clean(denied);
    results.push({
      label: 'unseeded-scope',
      runId: denied.manifest.runId,
      exitCode: receipt.exitCode,
      cleanup: receipt.cleanup,
    });
  } finally {
    await denied.stop().catch(() => denied.cancel('SIGTERM').catch(() => {}));
  }
  await writeFile(
    path.join(output, 'receipt.json'),
    JSON.stringify(
      {
        result: 'passed',
        scope: 'private fixed read-only domain snapshots; not browser journey completion',
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Domain snapshot receipt: ${path.join(output, 'receipt.json')}`);
}
void main().catch(async (error: unknown) => {
  if (output)
    await writeFile(
      path.join(output, 'failure.private.log'),
      error instanceof Error ? (error.stack ?? error.message) : 'Snapshot verifier failed',
      { mode: 0o600 },
    );
  console.error('Domain snapshot verification failed; private evidence retained.');
  process.exitCode = 2;
});

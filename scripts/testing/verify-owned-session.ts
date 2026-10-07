import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { startOwnedSession, readOwnedRuntimeDocument } from './owned-session';

async function main() {
  // Explicit local-Docker execution, never imported by the unit suite.
  const execute = promisify(execFile);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const serverRoot = path.resolve(root, '../server');
  const artifactRoot = path.join(
    root,
    '.qa/artifacts/testing-modernization/2026-09-28-p3',
    `bridge-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const sessions: Awaited<ReturnType<typeof startOwnedSession>>[] = [];
  const results: unknown[] = [];
  async function cleaned(session: Awaited<ReturnType<typeof startOwnedSession>>) {
    for (const args of [
      ['ps', '-aq'],
      ['network', 'ls', '-q'],
      ['volume', 'ls', '-q'],
    ]) {
      const probe = await execute(
        'docker',
        [
          ...args,
          '--filter',
          `label=com.docker.compose.project=${session.manifest.composeProject}`,
        ],
        { timeout: 15_000 },
      );
      assert.equal(probe.stdout.trim(), '');
    }
    await assert.rejects(access(path.join(session.manifest.artifactRoot, 'private.json')), {
      code: 'ENOENT',
    });
    assert.equal(session.manifest.phase, 'cleanup');
    const probe = await execute('ps', ['-axo', 'pid=,lstart='], {
      timeout: 5000,
      env: { ...process.env, LC_ALL: 'C' },
    });
    const live = new Map<number, string>();
    for (const line of probe.stdout.split('\n').filter((row) => row.trim())) {
      const match = /^\s*(\d+)\s+(.{24})\s*$/.exec(line);
      assert(match, 'Independent terminal process census unavailable');
      live.set(Number(match[1]), match[2].trim());
    }
    assert(live.has(process.pid));
    for (const identity of session.manifest.processes)
      assert.notEqual(
        live.get(identity.pid),
        identity.started,
        'Owned historical process survived',
      );
  }
  try {
    const opening = await Promise.allSettled([
      startOwnedSession({ serverRoot, appOrigin: 'http://127.0.0.1:42101' }),
      startOwnedSession({ serverRoot, appOrigin: 'http://127.0.0.1:42102' }),
    ]);
    const parallel = opening.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    sessions.push(...parallel);
    assert.equal(parallel.length, 2, 'Both owned sessions must start');
    assert.notEqual(parallel[0].manifest.port, parallel[1].manifest.port);
    assert.notEqual(parallel[0].apiOrigin, parallel[1].apiOrigin);
    const [first, second] = await Promise.all(
      parallel.map((session) => session.fixtures('bridge-first')),
    );
    assert.notEqual(first.accounts.coach.authUid, second.accounts.coach.authUid);
    assert(parallel.every((session) => session.manifest.fixtureScopes.includes('bridge-first')));
    const account = first.accounts.coach;
    const login = await fetch(`${parallel[0].apiOrigin}/auth/email/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        sessionMode: 'bearer',
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(login.status, 201);
    const auth = (await login.json()) as { accessToken: string; profile: { authUid: string } };
    assert.equal(auth.profile.authUid, account.authUid);
    const route = `/plans/training/${first.savedPlanId}`;
    const saved = await fetch(`${parallel[0].apiOrigin}${route}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${auth.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'QA Node Bridge Durable Plan' }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(saved.status, 200);
    const previousPid = parallel[0].apiPid;
    await parallel[0].restart();
    assert.notEqual(parallel[0].apiPid, previousPid);
    const restartedPid = parallel[0].apiPid;
    assert(
      parallel[0].manifest.processes.some(
        (record) => record.role === 'api' && record.pid === parallel[0].apiPid,
      ),
    );
    const restored = await fetch(`${parallel[0].apiOrigin}${route}`, {
      headers: { authorization: `Bearer ${auth.accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(restored.status, 200);
    assert.equal(
      ((await restored.json()) as { plan: { name: string } }).plan.name,
      'QA Node Bridge Durable Plan',
    );
    for (const [index, session] of parallel.entries()) {
      const stopped = session.stop();
      assert.equal(session.stop(), stopped);
      const closed = await stopped;
      const expectedApis = index === 0 ? [previousPid, restartedPid] : [session.apiPid];
      for (const pid of expectedApis)
        assert(
          session.manifest.processes.some((row) => row.role === 'api' && row.pid === pid),
          'Terminal manifest omitted an acquired API identity',
        );
      await cleaned(session);
      await writeFile(path.join(artifactRoot, `parallel-${index}.log`), session.diagnostics, {
        mode: 0o600,
      });
      results.push({
        label: `parallel-${index}`,
        runId: session.manifest.runId,
        databasePort: session.manifest.port,
        receiptPath: closed.receiptPath,
        cleanup: closed.cleanup,
        terminalProcessIdentities: session.manifest.processes.length,
        terminalApiHistory: expectedApis.length,
      });
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const session = await startOwnedSession({ serverRoot, appOrigin: 'http://127.0.0.1:42103' });
      sessions.push(session);
      const result = await session.cancel(signal);
      assert.equal(result.exitCode, signal === 'SIGINT' ? 130 : 143);
      assert.equal(result.closed?.cleanup, 'cleaned');
      await cleaned(session);
      results.push({ label: signal, runId: session.manifest.runId, ...result });
    }
    const invalid = await startOwnedSession({ serverRoot, appOrigin: 'http://127.0.0.1:42104' });
    sessions.push(invalid);
    await invalid.fixtures('used-once');
    await assert.rejects(invalid.fixtures('used-once'), /closed with an outstanding request/);
    await cleaned(invalid);
    const blocked = (await readOwnedRuntimeDocument(
      path.join(invalid.manifest.artifactRoot, 'session-receipt.json'),
      invalid.manifest.artifactRoot,
      'session-receipt.json',
      'session-receipt-v1',
    )) as { exitCode: number; cleanup: string };
    assert.equal(blocked.exitCode, 2);
    assert.equal(blocked.cleanup, 'cleaned');
    results.push({
      label: 'duplicate-fixture-scope',
      runId: invalid.manifest.runId,
      exitCode: blocked.exitCode,
      cleanup: blocked.cleanup,
    });
    const report = {
      result: 'passed',
      checks: [
        'strict schema/ownership/protected file handoff',
        'concurrent Node clients',
        'distinct DB/API ports and accounts',
        'fixture scope manifest sync',
        'real API write/read after restart with retained auth',
        'idempotent stop',
        'terminal history retains both API identities and every PID/start pair is absent',
        'SIGINT/SIGTERM',
        'duplicate fixture scope blocks with cleanup',
      ],
      results,
    };
    const receiptPath = path.join(artifactRoot, 'receipt.json');
    await writeFile(receiptPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(`Client bridge receipt: ${receiptPath}`);
  } finally {
    await Promise.all(
      sessions.map(async (session) => {
        await session.stop().catch(() => session.cancel('SIGTERM').catch(() => {}));
      }),
    );
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 2;
});

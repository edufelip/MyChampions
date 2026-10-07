import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { startOwnedApiProxy } from './owned-api-proxy';
import { startOwnedSession } from './owned-session';

// Explicit disposable-Postgres API binding verification. This drives no native UI.
const execute = promisify(execFile);
let output: string | undefined;
async function main() {
  process.umask(0o077);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  output = path.join(
    root,
    '.qa/artifacts/testing-modernization',
    `native-training-read-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const artifact = (name: string, value: unknown) =>
    writeFile(path.join(output!, name), JSON.stringify(value, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
  const results: unknown[] = [];
  for (const platform of ['ios', 'android'] as const) {
    const appOrigin = 'http://127.0.0.1:42901';
    const session = await startOwnedSession({
      serverRoot: path.resolve(root, '../server'),
      appOrigin,
    });
    const processes = [...session.manifest.processes];
    const remember = () => {
      for (const row of session.manifest.processes)
        if (!processes.some((old) => old.pid === row.pid && old.started === row.started))
          processes.push(row);
    };
    const proxies: Awaited<ReturnType<typeof startOwnedApiProxy>>[] = [];
    try {
      const fixtureScope = `native-entry-${platform}` as const;
      const fixtures = await session.fixtures(fixtureScope);
      const foreignScope = platform === 'ios' ? 'native-entry-android' : 'native-entry-ios';
      const foreign = await session.fixtures(foreignScope);
      const native = await startOwnedApiProxy({ session, appOrigin, requestProfile: 'native' });
      proxies.push(native);
      const browser = await startOwnedApiProxy({ session, appOrigin });
      proxies.push(browser);
      const input = {
        fixtureScope,
        accountUid: fixtures.accounts.coach.authUid,
        planId: fixtures.savedPlanId,
      };
      const rejected: string[] = [];
      const reject = async (label: string, action: () => Promise<unknown>, pattern: RegExp) => {
        await assert.rejects(action, pattern);
        rejected.push(label);
      };
      const signIn = await fetch(`${native.origin}/auth/email/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: fixtures.accounts.coach.email,
          password: fixtures.accounts.coach.password,
          sessionMode: 'bearer',
        }),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      assert.equal(signIn.status, 201);
      const credential = (await signIn.json()) as {
        accessToken: string;
        profile: { authUid: string };
      };
      assert.equal(credential.profile.authUid, input.accountUid);
      const catalog = async (
        route = '/plans/predefined',
        origin?: string,
        token = credential.accessToken,
        status = 200,
      ) => {
        const response = await fetch(`${native.origin}${route}`, {
          headers: { authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        });
        assert.equal(response.status, status);
        await response.arrayBuffer();
      };
      const read = () => native.readObservedNativeTrainingPlan(input);
      await reject(
        'browser-profile',
        () => browser.readObservedNativeTrainingPlan(input),
        /native request profile/,
      );
      await reject('no-catalog', read, /catalog observation/);
      await catalog('/plans/predefined', appOrigin);
      await reject('browser-origin-catalog', read, /catalog observation/);
      await catalog('/plans/predefined?probe=1');
      await reject('query-catalog', read, /catalog observation/);
      await catalog('/plans/predefined', undefined, 'invalid', 401);
      await reject('failed-catalog', read, /catalog observation/);
      await catalog();
      const baseline = await session.snapshot(fixtureScope);
      const otherBaseline = await session.snapshot(foreignScope);
      for (const [label, changes, pattern] of [
        ['unseeded-scope', { fixtureScope: 'unseeded' }, /exact seeded/],
        ['malformed-plan', { planId: `${input.planId}?probe=1` }, /exact seeded/],
        [
          'unknown-plan',
          { planId: 'training_plan_00000000-0000-4000-8000-ffffffffffff' },
          /scoped SQL/,
        ],
        ['cross-scope-plan', { planId: foreign.savedPlanId }, /scoped SQL/],
        [
          'foreign-owner',
          { accountUid: fixtures.accounts['unrelated-coach'].authUid },
          /scoped SQL/,
        ],
        [
          'observed-account-mismatch',
          {
            fixtureScope: foreignScope,
            accountUid: foreign.accounts.coach.authUid,
            planId: foreign.savedPlanId,
          },
          /identity mismatch/,
        ],
      ] as const)
        await reject(
          label,
          () => native.readObservedNativeTrainingPlan({ ...input, ...changes } as typeof input),
          pattern,
        );
      const observationsBefore = native.observations.length;
      const firstRead = read();
      await reject('concurrent-read', read, /not idle/);
      await reject('restart-during-read', () => native.restartApi(), /not idle/);
      await reject(
        'fault-during-read',
        () =>
          native.armObservedNativeSaveFault({
            attemptId: `${session.manifest.runId}:busy`,
            accountUid: input.accountUid,
            method: 'PATCH',
            path: `/plans/training/${input.planId}`,
          }),
        /not idle/,
      );
      const first = await firstRead;
      assert.equal(first.status, 200);
      assert.deepEqual(
        (first.plan as { sessions: unknown }).sessions,
        baseline.trainingPlans.find((row) => row.id === input.planId)!.sessions,
      );
      assert.equal(first.verification.apiPid, session.apiPid);
      assert.equal(
        native.observations.length,
        observationsBefore,
        'Independent read became a native UI observation',
      );
      const fault = {
        attemptId: `${session.manifest.runId}:read-block`,
        accountUid: input.accountUid,
        method: 'PATCH' as const,
        path: `/plans/training/${input.planId}`,
      };
      await native.armObservedNativeSaveFault(fault);
      await reject('active-fault', read, /not idle/);
      assert.equal(native.clearFault(fault.attemptId).injectedCount, 0);
      await native.restartApi();
      remember();
      await reject('restart-clears-observation', read, /catalog observation/);
      await catalog();
      const durable = await read();
      assert.notEqual(durable.verification.apiPid, first.verification.apiPid);
      assert.deepEqual(durable.plan, first.plan);
      const afterRestart = await session.snapshot(fixtureScope);
      const otherAfterRestart = await session.snapshot(foreignScope);
      assert.deepEqual(afterRestart, baseline);
      assert.deepEqual(otherAfterRestart, otherBaseline);
      await session.restart();
      remember();
      await reject('external-restart-invalidates-observation', read, /catalog observation/);
      await native.restartApi();
      remember();
      await catalog();
      const final = await read();
      assert.deepEqual(final.plan, first.plan);
      const cancelledRead = read();
      const cancelled = assert.rejects(cancelledRead);
      await native.stop();
      await cancelled;
      rejected.push('stop-cancels-in-flight-read');
      await reject('stop-invalidates-observation', read, /catalog observation/);
      await browser.stop();
      remember();
      const manifest = { ...session.manifest, processes };
      await artifact(`${platform}.ownership.private.json`, manifest);
      const closed = await session.stop();
      assert.equal(closed.cleanup, 'cleaned');
      // Independent census checks PID plus start time, never signals a process.
      for (const row of processes) {
        const probe = await execute('ps', ['-p', String(row.pid), '-o', 'lstart='], {
          timeout: 5000,
        }).catch((error: unknown) => {
          if ((error as { code?: number }).code === 1) return { stdout: '' };
          throw error;
        });
        assert.notEqual(probe.stdout.trim(), row.started, `Owned process remains: ${row.role}`);
      }
      for (const args of [
        ['ps', '-aq'],
        ['network', 'ls', '-q'],
      ]) {
        const probe = await execute(
          'docker',
          [...args, '--filter', `label=com.docker.compose.project=${manifest.composeProject}`],
          { timeout: 15000 },
        );
        assert.equal(probe.stdout.trim(), '');
      }
      await artifact(`${platform}.reads.private.json`, { first, durable, final });
      await artifact(`${platform}.sql.private.json`, {
        baseline,
        afterRestart,
        otherAfterRestart,
        otherBaseline,
      });
      // API/SQL after restart were compared before teardown, not reconstructed as new reads.
      results.push({
        platform,
        runId: manifest.runId,
        rejected,
        independentReadCount: 3,
        nativeUiBehaviorPasses: 0,
        sqlUnchanged: true,
        ownedProcessesGone: processes.length,
        cleanup: closed.cleanup,
      });
    } finally {
      for (const proxy of proxies) await proxy.stop();
      await session.stop().catch(() => session.cancel('SIGTERM'));
    }
  }
  const hashes: Record<string, string> = {};
  for (const file of [
    'scripts/testing/owned-api-proxy.ts',
    'scripts/testing/verify-native-training-read.ts',
  ])
    hashes[file] = createHash('sha256')
      .update(await readFile(path.join(root, file)))
      .digest('hex');
  await artifact('receipt.private.json', {
    scope:
      'real disposable Postgres and observed no-Origin HTTP credential binding; no native UI/engine proof',
    result: 'passed',
    hashes,
    results,
  });
  console.log(`Native training read receipt: ${output}/receipt.private.json`);
}
void main().catch(async (error: unknown) => {
  if (output)
    await writeFile(
      path.join(output, 'failure.private.json'),
      JSON.stringify({
        result: 'failed',
        detail:
          error instanceof Error ? (error.stack ?? error.message) : 'Scoped API verifier failed',
      }),
      { flag: 'wx', mode: 0o600 },
    );
  console.error('Native training read verification failed; private evidence retained.');
  process.exitCode = 2;
});

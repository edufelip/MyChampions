import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { startOwnedApiProxy } from './owned-api-proxy';
import { startOwnedSession } from './owned-session';

// Explicit local Docker verification, never imported by Node unit discovery.
async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = path.join(
    root,
    '.qa/artifacts/testing-modernization/2026-09-28-p3',
    `proxy-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const appOrigin = 'http://127.0.0.1:42201';
  const results: unknown[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const session = await startOwnedSession({
      serverRoot: path.resolve(root, '../server'),
      appOrigin,
    });
    const apiPids = [session.apiPid];
    let proxy: Awaited<ReturnType<typeof startOwnedApiProxy>> | undefined;
    try {
      proxy = await startOwnedApiProxy({ session, appOrigin });
      const target = proxy;
      const fixtures = await session.fixtures(`proxy-${attempt}`);
      const request = (route: string, token?: string, method = 'GET', body?: unknown) =>
        fetch(`${target.origin}${route}`, {
          method,
          headers: {
            origin: appOrigin,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        });
      const signIn = async (account: typeof fixtures.accounts.coach) => {
        const result = await request('/auth/email/sign-in', undefined, 'POST', {
          email: account.email,
          password: account.password,
          sessionMode: 'cookie',
        });
        assert.equal(result.status, 201);
        const cookies = result.headers.getSetCookie();
        assert(
          cookies.some(
            (cookie) =>
              cookie.includes('mychampions_refresh_token=') && cookie.includes('HttpOnly'),
          ),
        );
        assert.equal(result.headers.get('access-control-allow-origin'), appOrigin);
        const payload = (await result.json()) as {
          accessToken: string;
          profile: { authUid: string };
        };
        assert.equal(payload.profile.authUid, account.authUid);
        return payload.accessToken;
      };
      const token = await signIn(fixtures.accounts.coach);
      const otherToken = await signIn(fixtures.accounts['unrelated-coach']);
      assert.equal(
        (await fetch(`${target.origin}/me`, { headers: { authorization: `Bearer ${token}` } }))
          .status,
        403,
      );
      const native = await startOwnedApiProxy({ session, appOrigin, requestProfile: 'native' });
      try {
        const response = await fetch(`${native.origin}/auth/email/sign-in`, {
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
        assert.equal(response.status, 201);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        const nativeSession = (await response.json()) as {
          accessToken: string;
          refreshToken: string;
          profile: { authUid: string };
        };
        assert.equal(nativeSession.profile.authUid, fixtures.accounts.coach.authUid);
        assert(nativeSession.accessToken && nativeSession.refreshToken);
        const nativeFault = {
          attemptId: `native-save-${attempt}`,
          method: 'PATCH' as const,
          path: `/plans/training/${fixtures.savedPlanId}`,
          accountUid: fixtures.accounts.coach.authUid,
        };
        const nativeRequest = (
          route: string,
          method = 'GET',
          body?: unknown,
          accessToken = nativeSession.accessToken,
          requestOrigin?: string,
        ) =>
          fetch(`${native.origin}${route}`, {
            method,
            headers: {
              authorization: `Bearer ${accessToken}`,
              ...(requestOrigin ? { origin: requestOrigin } : {}),
              ...(body ? { 'content-type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
          });
        await assert.rejects(
          target.armObservedNativeSaveFault(nativeFault),
          /native request profile/,
        );
        await assert.rejects(native.armObservedNativeSaveFault(nativeFault), /catalog observation/);
        // Browser-origin and query variants must not establish a native credential.
        for (const [route, origin] of [
          ['/plans/predefined', appOrigin],
          ['/plans/predefined?probe=1', undefined],
        ] as const) {
          const catalog = await nativeRequest(
            route,
            'GET',
            undefined,
            nativeSession.accessToken,
            origin,
          );
          assert.equal(catalog.status, 200);
          await catalog.arrayBuffer();
          await assert.rejects(
            native.armObservedNativeSaveFault(nativeFault),
            /catalog observation/,
          );
        }
        const invalidCatalog = await nativeRequest(
          '/plans/predefined',
          'GET',
          undefined,
          'invalid',
        );
        assert.equal(invalidCatalog.status, 401);
        await invalidCatalog.arrayBuffer();
        await assert.rejects(native.armObservedNativeSaveFault(nativeFault), /catalog observation/);
        const catalog = await nativeRequest('/plans/predefined');
        assert.equal(catalog.status, 200);
        await catalog.arrayBuffer();
        await assert.rejects(
          native.armObservedNativeSaveFault({
            ...nativeFault,
            attemptId: `native-foreign-${attempt}`,
            accountUid: fixtures.accounts['unrelated-coach'].authUid,
          }),
          /identity mismatch/,
        );
        await assert.rejects(
          native.armObservedNativeSaveFault({
            ...nativeFault,
            path: '/auth/email/sign-in',
          }),
          /exact declared/,
        );
        const beforeNativeFault = await session.snapshot(`proxy-${attempt}`);
        await native.armObservedNativeSaveFault(nativeFault);
        const unrelated = await nativeRequest(
          nativeFault.path,
          'PATCH',
          { name: 'Foreign must stay denied' },
          otherToken,
        );
        assert.equal(unrelated.status, 404);
        await unrelated.arrayBuffer();
        assert.equal(native.faultState?.injectedCount, 0);
        const failedSave = await nativeRequest(nativeFault.path, 'PATCH', {
          name: 'Native proxy retry',
        });
        assert.equal(failedSave.status, 503);
        await failedSave.arrayBuffer();
        assert.equal(native.faultState?.injectedCount, 1);
        assert.deepEqual(await session.snapshot(`proxy-${attempt}`), beforeNativeFault);
        await writeFile(
          path.join(output, `attempt-${attempt}.native-sql-before.private.json`),
          JSON.stringify(beforeNativeFault, null, 2),
          { mode: 0o600, flag: 'wx' },
        );
        await writeFile(
          path.join(output, `attempt-${attempt}.native-sql-after-failure.private.json`),
          JSON.stringify(await session.snapshot(`proxy-${attempt}`), null, 2),
          { mode: 0o600, flag: 'wx' },
        );
        const realRetry = await nativeRequest(nativeFault.path, 'PATCH', {
          name: 'Native proxy retry',
        });
        assert.equal(realRetry.status, 200);
        await realRetry.arrayBuffer();
        assert.equal(native.faultState?.injectedCount, 1);
        const savedRead = await nativeRequest(nativeFault.path);
        assert.equal(savedRead.status, 200);
        assert.equal(
          ((await savedRead.json()) as { plan: { name: string } }).plan.name,
          'Native proxy retry',
        );
        const afterNativeRetry = await session.snapshot(`proxy-${attempt}`);
        await writeFile(
          path.join(output, `attempt-${attempt}.native-sql-after-retry.private.json`),
          JSON.stringify(afterNativeRetry, null, 2),
          { mode: 0o600, flag: 'wx' },
        );
        assert.equal(afterNativeRetry.trainingPlans.length, beforeNativeFault.trainingPlans.length);
        assert.equal(
          afterNativeRetry.trainingPlans.find((row) => row.id === fixtures.savedPlanId)?.name,
          'Native proxy retry',
        );
        assert.deepEqual(native.clearFault(nativeFault.attemptId), {
          attemptId: nativeFault.attemptId,
          injectedCount: 1,
        });
        await assert.rejects(native.armObservedNativeSaveFault(nativeFault), /duplicate/);
        const loadFault = {
          attemptId: `native-load-${attempt}`,
          path: nativeFault.path,
          accountUid: fixtures.accounts.coach.authUid,
          fixtureScope: `proxy-${attempt}`,
        };
        await assert.rejects(
          target.armObservedNativeLoadFault(loadFault),
          /native request profile/,
        );
        await assert.rejects(
          native.armObservedNativeSaveFault({ ...nativeFault, method: 'GET' as 'PATCH' }),
          /duplicate/,
        );
        await assert.rejects(
          native.armObservedNativeSaveFault({
            ...nativeFault,
            attemptId: `save-reject-get-${attempt}`,
            method: 'GET' as 'PATCH',
          }),
          /exact declared/,
        );
        for (const invalid of [
          { path: `${nativeFault.path}?probe=1` },
          { path: '/auth/email/sign-in' },
          { path: '/plans/training/training_plan_00000000-0000-4000-8000-ffffffffffff' },
          { accountUid: fixtures.accounts['unrelated-coach'].authUid },
          { fixtureScope: 'unseeded-load-scope' },
        ]) {
          await assert.rejects(native.armObservedNativeLoadFault({ ...loadFault, ...invalid }));
          assert.equal(native.faultState, null);
        }
        const beforeLoad = await session.snapshot(`proxy-${attempt}`);
        await native.armObservedNativeLoadFault(loadFault);
        const deniedLoad = await nativeRequest(loadFault.path, 'GET', undefined, otherToken);
        assert.equal(deniedLoad.status, 404);
        await deniedLoad.arrayBuffer();
        assert.equal(native.faultState?.injectedCount, 0);
        const queryRead = await nativeRequest(`${loadFault.path}?probe=1`);
        assert.equal(queryRead.status, 200);
        await queryRead.arrayBuffer();
        assert.equal(native.faultState?.injectedCount, 0);
        const unavailableLoad = await nativeRequest(loadFault.path);
        assert.equal(unavailableLoad.status, 503);
        assert.equal(
          ((await unavailableLoad.json()) as { error: { code: string } }).error.code,
          'integration_load_unavailable',
        );
        assert.equal(native.faultState?.injectedCount, 1);
        assert.deepEqual(await session.snapshot(`proxy-${attempt}`), beforeLoad);
        const loadRetry = await nativeRequest(loadFault.path);
        assert.equal(loadRetry.status, 200);
        assert.equal(
          ((await loadRetry.json()) as { plan: { name: string } }).plan.name,
          'Native proxy retry',
        );
        assert.equal(native.faultState?.injectedCount, 1);
        const afterLoad = await session.snapshot(`proxy-${attempt}`);
        assert.deepEqual(afterLoad, beforeLoad);
        for (const [label, snapshot] of [
          ['before', beforeLoad],
          ['after', afterLoad],
        ] as const)
          await writeFile(
            path.join(output, `attempt-${attempt}.native-load-sql-${label}.private.json`),
            JSON.stringify(snapshot, null, 2),
            { mode: 0o600, flag: 'wx' },
          );
        assert.deepEqual(native.clearFault(loadFault.attemptId), {
          attemptId: loadFault.attemptId,
          injectedCount: 1,
        });
        await assert.rejects(native.armObservedNativeLoadFault(loadFault), /duplicate/);
        await native.restartApi();
        apiPids.push(session.apiPid);
        await assert.rejects(
          native.armObservedNativeLoadFault({ ...loadFault, attemptId: `load-stale-${attempt}` }),
          /catalog observation/,
        );
        await assert.rejects(
          native.armObservedNativeSaveFault({
            ...nativeFault,
            attemptId: `native-after-restart-${attempt}`,
          }),
          /catalog observation/,
        );
        const refreshedCatalog = await nativeRequest('/plans/predefined');
        assert.equal(refreshedCatalog.status, 200);
        await refreshedCatalog.arrayBuffer();
        const refreshedAttempt = `native-refreshed-${attempt}`;
        await native.armObservedNativeSaveFault({ ...nativeFault, attemptId: refreshedAttempt });
        assert.deepEqual(native.clearFault(refreshedAttempt), {
          attemptId: refreshedAttempt,
          injectedCount: 0,
        });
        // An API restart outside this adapter invalidates the process binding.
        await session.restart();
        apiPids.push(session.apiPid);
        await assert.rejects(
          native.armObservedNativeSaveFault({
            ...nativeFault,
            attemptId: `native-stale-${attempt}`,
          }),
          /catalog observation/,
        );
        const staleCatalog = await nativeRequest('/plans/predefined');
        assert.equal(staleCatalog.status, 403);
        await staleCatalog.arrayBuffer();
        await native.restartApi();
        apiPids.push(session.apiPid);
        await assert.rejects(
          native.armObservedNativeSaveFault({
            ...nativeFault,
            attemptId: `native-empty-${attempt}`,
          }),
          /catalog observation/,
        );
        const me = await fetch(`${native.origin}/me`, {
          headers: { authorization: `Bearer ${nativeSession.accessToken}` },
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(me.status, 200);
        assert.equal(
          (
            await fetch(`${native.origin}/me`, {
              headers: {
                origin: 'https://foreign.test',
                authorization: `Bearer ${nativeSession.accessToken}`,
              },
              signal: AbortSignal.timeout(5000),
            })
          ).status,
          403,
        );
        const invalid = await fetch(`${native.origin}/me`, { signal: AbortSignal.timeout(5000) });
        assert.equal(invalid.status, 401);
        assert(
          native.observations.some(
            (row) =>
              row.requestProfile === 'native' &&
              row.requestOrigin === null &&
              row.outcome === 'forwarded' &&
              row.status === 200,
          ),
        );
        for (const value of [
          nativeSession.accessToken,
          nativeSession.refreshToken,
          fixtures.accounts.coach.password,
        ])
          assert(!JSON.stringify(native.observations).includes(value));
        await writeFile(
          path.join(output, `attempt-${attempt}.native-observations.json`),
          JSON.stringify(native.observations, null, 2),
          { mode: 0o600 },
        );
      } finally {
        await native.stop();
        await assert.rejects(
          native.armObservedNativeSaveFault({
            attemptId: `native-stopped-${attempt}`,
            method: 'POST',
            path: '/plans/training',
            accountUid: fixtures.accounts.coach.authUid,
          }),
          /catalog observation/,
        );
        await assert.rejects(fetch(`${native.origin}/me`, { signal: AbortSignal.timeout(1000) }));
      }
      // Rebind the browser proxy after the native adapter restart control.
      await target.restartApi();
      apiPids.push(session.apiPid);
      const route = `/plans/training/${fixtures.savedPlanId}`;
      const readName = async () => {
        const result = await request(route, token);
        assert.equal(result.status, 200);
        return ((await result.json()) as { plan: { name: string } }).plan.name;
      };
      const initial = await readName();
      const fault = {
        attemptId: `save-${attempt}`,
        method: 'PATCH' as const,
        path: route,
        accountUid: fixtures.accounts.coach.authUid,
        accessToken: token,
      };
      await assert.rejects(
        target.armFault({ ...fault, path: 'https://example.test/write' }),
        /exact declared/,
      );
      await assert.rejects(
        target.armFault({
          ...fault,
          attemptId: `foreign-${attempt}`,
          accountUid: fixtures.accounts['unrelated-coach'].authUid,
        }),
        /identity mismatch/,
      );
      await target.armFault(fault);
      await assert.rejects(target.armFault({ ...fault, attemptId: 'another' }), /not idle/);
      const options = await request(route, undefined, 'OPTIONS');
      assert(options.ok);
      assert.equal(target.faultState?.injectedCount, 0);
      assert.equal(await readName(), initial);
      assert.equal(target.faultState?.injectedCount, 0);
      const foreign = await request(route, otherToken, 'PATCH', { name: 'Must remain denied' });
      assert.equal(foreign.status, 404);
      assert.equal(target.faultState?.injectedCount, 0);
      const sibling = await request(route, token, 'PATCH', { name: 'Separate query write' });
      // This is the designated write, so fail before forwarding it.
      assert.equal(sibling.status, 503);
      assert.equal(sibling.headers.get('access-control-allow-origin'), appOrigin);
      assert.equal(
        ((await sibling.json()) as { error: { code: string } }).error.code,
        'integration_save_unavailable',
      );
      assert.equal(await readName(), initial);
      assert.equal(target.faultState?.injectedCount, 1);
      assert.deepEqual(target.clearFault(fault.attemptId), {
        attemptId: fault.attemptId,
        injectedCount: 1,
      });
      const retry = await request(route, token, 'PATCH', { name: 'Proxy durable retry' });
      assert.equal(retry.status, 200);
      assert.equal(await readName(), 'Proxy durable retry');
      await assert.rejects(target.armFault(fault), /duplicate/);
      await assert.rejects(
        target.armFault({ ...fault, attemptId: 'read-fault', method: 'GET' as 'PATCH' }),
        /exact declared/,
      );
      const previousPid = session.apiPid;
      const previousOrigin = target.origin;
      await target.restartApi();
      apiPids.push(session.apiPid);
      assert.notEqual(session.apiPid, previousPid);
      assert.equal(target.origin, previousOrigin);
      assert.equal(await readName(), 'Proxy durable retry');
      // A restart outside the proxy must never forward to its stale former port.
      const countBeforeStale = target.observations.filter(
        (row) => row.outcome === 'forwarded',
      ).length;
      await session.restart();
      apiPids.push(session.apiPid);
      assert.equal((await request(route, token)).status, 403);
      assert.equal(
        target.observations.filter((row) => row.outcome === 'forwarded').length,
        countBeforeStale,
      );
      await target.restartApi();
      apiPids.push(session.apiPid);
      assert.equal(await readName(), 'Proxy durable retry');
      const bounded = await startOwnedApiProxy({ session, appOrigin, requestDeadlineMs: 100 });
      try {
        const timeoutStatus = await new Promise<number>((resolve, reject) => {
          const child = httpRequest(
            `${bounded.origin}${route}`,
            {
              method: 'PATCH',
              headers: {
                origin: appOrigin,
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
              },
            },
            (response) => {
              response.resume();
              response.once('end', () => {
                child.destroy();
                resolve(response.statusCode!);
              });
            },
          );
          child.on('error', reject);
          child.setTimeout(2000, () => child.destroy(new Error('Stalled-write probe deadline')));
          child.write('{"name":');
          // The body stays incomplete; the proxy must bound the upstream request.
        });
        assert.equal(timeoutStatus, 504);
        assert(bounded.observations.some((row) => row.outcome === 'upstream-failed'));
      } finally {
        await bounded.stop();
      }
      assert.equal(await readName(), 'Proxy durable retry');
      const forbidden = await fetch(`${target.origin}/me`, {
        headers: { origin: 'https://foreign.test', authorization: `Bearer ${token}` },
      });
      assert.equal(forbidden.status, 403);
      const absoluteStatus = await new Promise<number>((resolve, reject) => {
        const child = httpRequest(
          target.origin,
          { path: `${session.apiOrigin}/me`, headers: { origin: appOrigin } },
          (response) => {
            response.resume();
            resolve(response.statusCode!);
          },
        );
        child.on('error', reject);
        child.setTimeout(5000, () => child.destroy(new Error('Absolute-target probe deadline')));
        child.end();
      });
      assert.equal(absoluteStatus, 403);
      assert.equal(target.observations.filter((row) => row.outcome === 'injected').length, 1);
      const serialized = JSON.stringify(target.observations);
      for (const secret of [
        token,
        otherToken,
        fixtures.accounts.coach.password,
        fixtures.accounts.coach.email,
      ])
        assert(!serialized.includes(secret));
      assert(
        target.observations.some(
          (row) =>
            row.requestOrigin === appOrigin &&
            row.targetOrigin === session.apiOrigin &&
            row.status === 200,
        ),
      );
      const observations = target.observations;
      const closed = await session.stop();
      assert.equal((await request('/me', token)).status, 503);
      const stopping = target.stop();
      assert.equal(target.stop(), stopping);
      await stopping;
      await assert.rejects(fetch(`${target.origin}/health`, { signal: AbortSignal.timeout(1000) }));
      const execute = promisify(execFile);
      for (const args of [
        ['ps', '-aq'],
        ['network', 'ls', '-q'],
      ]) {
        const probe = await execute(
          'docker',
          [
            ...args,
            '--filter',
            `label=com.docker.compose.project=${session.manifest.composeProject}`,
          ],
          { timeout: 15000 },
        );
        assert.equal(probe.stdout.trim(), '');
      }
      for (const pid of apiPids) {
        try {
          const result = await execute('ps', ['-p', String(pid), '-o', 'stat='], { timeout: 5000 });
          assert(!result.stdout.trim() || result.stdout.trim().startsWith('Z'));
        } catch (error) {
          if ((error as { code?: number }).code !== 1) throw error;
        }
      }
      await writeFile(
        path.join(output, `attempt-${attempt}.observations.json`),
        JSON.stringify(observations, null, 2),
        { mode: 0o600 },
      );
      await writeFile(path.join(output, `attempt-${attempt}.log`), session.diagnostics, {
        mode: 0o600,
      });
      results.push({
        attempt,
        runId: session.manifest.runId,
        result: 'passed',
        observations: observations.length,
        nativeProfile: {
          scope:
            'no-Origin bearer transport and observed-credential one-save/one-load faults; not native device behavior',
          result: 'passed',
          observedRequests: native.observations.length,
          injectedSaves: native.observations.filter(
            (row) => row.outcome === 'injected' && row.method !== 'GET',
          ).length,
          injectedLoads: native.observations.filter(
            (row) => row.outcome === 'injected' && row.method === 'GET',
          ).length,
          scopedLoadFailureAndRetrySqlUnchanged: true,
          unchangedSqlOnFailure: true,
          durableRetry: true,
          restartAndStopInvalidateCredential: true,
          snapshots: [
            `attempt-${attempt}.native-sql-before.private.json`,
            `attempt-${attempt}.native-sql-after-failure.private.json`,
            `attempt-${attempt}.native-sql-after-retry.private.json`,
            `attempt-${attempt}.native-load-sql-before.private.json`,
            `attempt-${attempt}.native-load-sql-after.private.json`,
          ],
        },
        injectedWrites: 1,
        stableProxyOrigin: previousOrigin,
        apiRestarted: true,
        observedApiPidsGone: apiPids,
        cleanup: closed.cleanup,
      });
    } catch (error) {
      await writeFile(
        path.join(output, `attempt-${attempt}.failure.log`),
        error instanceof Error ? (error.stack ?? error.message) : 'Proxy verification failed',
        { mode: 0o600 },
      );
      throw error;
    } finally {
      await proxy?.stop();
      await session.stop().catch(() => session.cancel('SIGTERM'));
    }
  }
  const receiptPath = path.join(output, 'receipt.json');
  await writeFile(
    receiptPath,
    JSON.stringify(
      {
        result: 'passed',
        scope: 'proxy/backend transport, not browser evidence or public attempt receipt',
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Owned API proxy receipt: ${receiptPath}`);
}
void main().catch(() => {
  console.error('Owned API proxy verification failed; private diagnostics retained.');
  process.exitCode = 2;
});

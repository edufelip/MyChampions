import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { startOwnedApiProxy } from './owned-api-proxy';
import { startOwnedSession } from './owned-session';
import { startWorkerControl, invokeWorkerControl } from './worker-control';
import type { IntegrationContext } from './integration-context';
import type { OwnedDomainSnapshot, OwnedFixtures } from './owned-session';

const execute = promisify(execFile);
let output: string | undefined;
async function main() {
  process.umask(0o077);
  const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  output = path.join(
    root,
    '.qa/artifacts/testing-modernization/2026-09-28-p3',
    `worker-control-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const session = await startOwnedSession({
    serverRoot: path.resolve(root, '../server'),
    appOrigin: 'http://127.0.0.1:42601',
  });
  let proxy: Awaited<ReturnType<typeof startOwnedApiProxy>> | undefined;
  let control: Awaited<ReturnType<typeof startWorkerControl>> | undefined;
  const results: object[] = [];
  let creatorRecoveredControl = false;
  try {
    const target = await startOwnedApiProxy({ session, appOrigin: 'http://127.0.0.1:42601' });
    proxy = target;
    const context: IntegrationContext = {
      schemaVersion: 1,
      runId: session.manifest.runId,
      clientRoot: root,
      serverRoot: path.resolve(root, '../server'),
      artifactRoot: output,
      parentPid: process.pid,
      parentStarted: (
        await execute('ps', ['-p', String(process.pid), '-o', 'lstart='], { timeout: 5000 })
      ).stdout.trim(),
      appOrigin: 'http://127.0.0.1:42601',
      apiOrigin: target.origin,
      flagsHash: 'a'.repeat(64),
      control: null,
      cases: [],
    };
    const fixtures = new Map<string, OwnedFixtures>();
    for (const scenarioId of ['training-durable', 'save-retry']) {
      const fixtureScope = `${scenarioId}-chromium`;
      const fixture = await session.fixtures(fixtureScope);
      const attemptId = `${scenarioId}--chromium`;
      fixtures.set(attemptId, fixture);
      context.cases.push({
        scenarioId,
        project: 'chromium',
        attemptId,
        fixtureScope,
        fixtureRef: path.join(
          session.manifest.artifactRoot,
          `fixtures-${fixtureScope}.private.json`,
        ),
        fixtureHash: 'a'.repeat(64),
        requirementHash: 'a'.repeat(64),
        scenarioHash: 'a'.repeat(64),
        controlToken: randomBytes(32).toString('hex'),
      });
    }
    control = await startWorkerControl({
      context,
      fixtures,
      session,
      proxy: target,
      signal: new AbortController().signal,
    });
    context.control = control.endpoint;
    const selected = context.cases[0];
    const initial = (await invokeWorkerControl(context, selected, {
      kind: 'snapshot',
    })) as OwnedDomainSnapshot;
    assert.equal(initial.readOnly, true);
    assert.equal(initial.trainingPlans.length, 1);
    await assert.rejects(
      invokeWorkerControl(
        context,
        { ...selected, controlToken: '0'.repeat(64) },
        { kind: 'snapshot' },
      ),
      /rejected/,
    );
    await assert.rejects(
      invokeWorkerControl(
        context,
        { ...selected, attemptId: 'unknown--chromium' },
        { kind: 'snapshot' },
      ),
      /rejected/,
    );
    const raw = {
      schemaVersion: 1,
      id: randomBytes(12).toString('hex'),
      attemptId: selected.attemptId,
      capability: selected.controlToken,
      operation: { kind: 'snapshot' },
    };
    const request = () =>
      new Promise<{ ok: boolean }>((resolve, reject) => {
        const socket = createConnection(control!.endpoint.socket);
        let text = '';
        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error('Raw worker probe timed out'));
        }, 5000);
        socket.once('connect', () => socket.write(JSON.stringify(raw) + '\n'));
        socket.on('data', (bytes) => {
          text += bytes.toString();
        });
        socket.once('error', reject);
        socket.once('close', () => {
          clearTimeout(timeout);
          try {
            const value: unknown = JSON.parse(text);
            if (
              !value ||
              typeof value !== 'object' ||
              typeof (value as { ok?: unknown }).ok !== 'boolean'
            )
              throw new Error('Invalid raw worker response');
            resolve(value as { ok: boolean });
          } catch {
            reject(new Error('Raw worker probe rejected'));
          }
        });
      });
    assert.equal((await request()).ok, true);
    assert.equal((await request()).ok, false);
    results.push({
      label: 'snapshot-capability-and-replay',
      readOnly: true,
      invalidCapabilityRejected: true,
      unknownAttemptRejected: true,
      replayRejected: true,
    });
    const oldPid = session.apiPid;
    await invokeWorkerControl(context, selected, { kind: 'restart' });
    assert.notEqual(session.apiPid, oldPid);
    assert.equal(context.apiOrigin, target.origin);
    assert.deepEqual(await invokeWorkerControl(context, selected, { kind: 'snapshot' }), initial);
    results.push({
      label: 'owned-restart-stable-proxy',
      previousPid: oldPid,
      apiPid: session.apiPid,
    });
    const save = context.cases[1];
    const fixture = fixtures.get(save.attemptId)!;
    const requestApi = (route: string, token?: string, method = 'GET', body?: unknown) =>
      fetch(`${target.origin}${route}`, {
        method,
        headers: {
          origin: context.appOrigin,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(5000),
      });
    const login = await requestApi('/auth/email/sign-in', undefined, 'POST', {
      email: fixture.accounts.coach.email,
      password: fixture.accounts.coach.password,
      sessionMode: 'cookie',
    });
    assert.equal(login.status, 201);
    const token = ((await login.json()) as { accessToken: string }).accessToken;
    const before = await invokeWorkerControl(context, save, { kind: 'snapshot' });
    await assert.rejects(
      invokeWorkerControl(context, selected, {
        kind: 'arm-save-fault',
        method: 'POST',
        path: '/plans/training',
        accessToken: token,
      }),
      /rejected/,
    );
    await invokeWorkerControl(context, save, {
      kind: 'arm-save-fault',
      method: 'POST',
      path: '/plans/training',
      accessToken: token,
    });
    const body = { name: 'QA worker retry', mode: 'professional_library' };
    const blocked = await requestApi('/plans/training', token, 'POST', body);
    assert.equal(blocked.status, 503);
    await blocked.text();
    assert.deepEqual(await invokeWorkerControl(context, save, { kind: 'snapshot' }), before);
    assert.deepEqual(await invokeWorkerControl(context, save, { kind: 'clear-save-fault' }), {
      attemptId: save.attemptId,
      injectedCount: 1,
    });
    const changed = await requestApi('/plans/training', token, 'POST', body);
    assert.equal(changed.status, 201);
    const id = ((await changed.json()) as { plan: { id: string } }).plan.id;
    const after = (await invokeWorkerControl(context, save, {
      kind: 'snapshot',
    })) as OwnedDomainSnapshot;
    assert.equal(after.trainingPlans.length, 2);
    assert.equal(after.trainingPlans.filter((row) => row.id === id).length, 1);
    results.push({
      label: 'one-preforward-fault-and-durable-retry',
      injected: 1,
      noMutationAfterFault: true,
      finalAdditionalRecords: 1,
    });
    const ownerFile = path.join(control.endpoint.root, 'owner.private.json');
    const owner = await readFile(ownerFile, 'utf8');
    const ownedRoot = await lstat(control.endpoint.root);
    await writeFile(ownerFile, '{}', { mode: 0o600 });
    await assert.rejects(control.stop(), /owner changed/);
    await access(control.endpoint.root);
    await assert.rejects(access(control.endpoint.socket), { code: 'ENOENT' });
    assert.equal((await lstat(control.endpoint.root)).ino, ownedRoot.ino);
    assert.equal(await realpath(control.endpoint.root), control.endpoint.root);
    await writeFile(ownerFile, owner, { mode: 0o600 });
    assert.equal(await readFile(ownerFile, 'utf8'), owner);
    await rm(control.endpoint.root, { recursive: true });
    creatorRecoveredControl = true;
    results.push({
      label: 'changed-owner-retains-root-and-stops-listener',
      recoveryRetained: true,
      creatorControlCleanup: true,
    });
    await writeFile(
      path.join(output, 'control-observations.json'),
      JSON.stringify(control.observations, null, 2),
      { mode: 0o600 },
    );
  } finally {
    let cleanupError: unknown;
    try {
      await control?.stop();
    } catch (error) {
      if (!creatorRecoveredControl) cleanupError = error;
    }
    try {
      await proxy?.stop();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await session.stop();
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError)
      throw cleanupError instanceof Error
        ? cleanupError
        : new Error('Worker verifier cleanup failed');
  }
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
  await writeFile(
    path.join(output, 'receipt.json'),
    JSON.stringify(
      {
        result: 'passed',
        runId: session.manifest.runId,
        scope: 'private IPC, real owned API/fault/snapshot/recovery; not UI journeys',
        cleanup: 'cleaned',
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Worker control receipt: ${path.join(output, 'receipt.json')}`);
}
void main().catch(async (error: unknown) => {
  if (output)
    await writeFile(
      path.join(output, 'failure.private.log'),
      error instanceof Error ? (error.stack ?? error.message) : 'Worker control verifier failed',
      { mode: 0o600 },
    );
  console.error('Worker control verifier failed; private evidence retained.');
  process.exitCode = 2;
});

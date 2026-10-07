import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';
import { startOwnedApiProxy } from './owned-api-proxy';
import { reserveOwnedAppPort, startOwnedExpo } from './owned-expo';
import { startOwnedSession } from './owned-session';

async function main() {
  const clientRoot = fileURLToPath(new URL('../../', import.meta.url));
  const output = path.join(
    clientRoot,
    '.qa/artifacts/testing-modernization/2026-09-28-p3',
    `expo-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const reservation = await reserveOwnedAppPort();
  let session: Awaited<ReturnType<typeof startOwnedSession>> | undefined;
  let proxy: Awaited<ReturnType<typeof startOwnedApiProxy>> | undefined;
  let app: Awaited<ReturnType<typeof startOwnedExpo>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    session = await startOwnedSession({
      serverRoot: path.resolve(clientRoot, '../server'),
      appOrigin: reservation.origin,
    });
    proxy = await startOwnedApiProxy({ session, appOrigin: reservation.origin });
    const fixture = await session.fixtures('expo-login');
    app = await startOwnedExpo({
      clientRoot,
      artifactRoot: output,
      reservation,
      apiOrigin: proxy.origin,
    });
    browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-US' });
    const apiOrigins = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        /^\/(auth|me|plans|connections)(\/|$)/.test(url.pathname) &&
        url.origin !== reservation.origin
      )
        apiOrigins.add(url.origin);
    });
    await page.goto(`${app.origin}/auth/sign-in`, { timeout: 90_000 });
    await page.getByTestId('auth.signIn.emailInput').fill(fixture.accounts.student.email);
    await page.getByTestId('auth.signIn.passwordInput').fill(fixture.accounts.student.password);
    const response = page.waitForResponse(
      (response) => response.url() === `${proxy!.origin}/auth/email/sign-in`,
      { timeout: 30_000 },
    );
    await page.getByTestId('auth.signIn.submitButton').click();
    assert.equal((await response).status(), 201);
    await page
      .getByTestId('student.home.screen')
      .last()
      .waitFor({ state: 'visible', timeout: 30_000 });
    assert.deepEqual([...apiOrigins], [proxy.origin]);
    assert(
      proxy.observations.some(
        (row) =>
          row.method === 'POST' &&
          row.status === 201 &&
          row.requestOrigin === app!.origin &&
          row.targetOrigin === session!.apiOrigin,
      ),
    );
    const cookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'mychampions_refresh_token',
    );
    assert(cookie?.httpOnly);
    const temporaryRoot = app.environment.TMPDIR;
    assert(temporaryRoot && temporaryRoot.startsWith(output + path.sep));
    await access(path.join(temporaryRoot, 'metro-cache'));
    await page.screenshot({ path: path.join(output, 'student-home.png') });
    await browser.close();
    browser = undefined;
    const stopped = app.stop();
    assert.equal(app.stop(), stopped);
    await stopped;
    await assert.rejects(access(temporaryRoot), { code: 'ENOENT' });
    await assert.rejects(fetch(app.origin, { signal: AbortSignal.timeout(1000) }));
    const blockedPort = await reserveOwnedAppPort();
    const foreign = createServer((_request, response) =>
      response.end('<html>Foreign server</html>'),
    );
    await blockedPort.release();
    await new Promise<void>((resolve, reject) => {
      foreign.once('error', reject);
      foreign.listen(blockedPort.port, '127.0.0.1', resolve);
    });
    try {
      await assert.rejects(
        startOwnedExpo({
          clientRoot,
          artifactRoot: path.join(output, 'occupied-port'),
          reservation: blockedPort,
          apiOrigin: proxy.origin,
          deadlineMs: 15_000,
        }),
        /exited before readiness|acquisition deadline/,
      );
      assert.equal(await (await fetch(blockedPort.origin)).text(), '<html>Foreign server</html>');
      const cacheOwner = JSON.parse(
        await readFile(path.join(output, 'occupied-port/expo-cache-owner.private.json'), 'utf8'),
      ) as { temporaryRoot: string };
      await assert.rejects(access(cacheOwner.temporaryRoot), { code: 'ENOENT' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        foreign.close((error) => (error ? reject(error) : resolve())),
      );
      await blockedPort.release();
    }
    const cancelledPort = await reserveOwnedAppPort();
    const controller = new AbortController();
    const cancellationRoot = path.join(output, 'cancelled-startup');
    let unexpectedReady: Awaited<ReturnType<typeof startOwnedExpo>> | undefined;
    const cancelled = startOwnedExpo({
      clientRoot,
      artifactRoot: cancellationRoot,
      reservation: cancelledPort,
      apiOrigin: proxy.origin,
      signal: controller.signal,
    }).then((value) => {
      unexpectedReady = value;
      return value;
    });
    void cancelled.catch(() => {});
    try {
      const limit = performance.now() + 30_000;
      while (true) {
        if (performance.now() > limit)
          throw new Error('Cancellation ownership acquisition deadline');
        const started = await access(path.join(cancellationRoot, 'expo-ownership.json'))
          .then(() => true)
          .catch(() => false);
        if (started) break;
        await delay(10);
      }
      controller.abort();
      await assert.rejects(cancelled, /abort/i);
      const ledger = JSON.parse(
        await readFile(path.join(cancellationRoot, 'expo-ownership.json'), 'utf8'),
      ) as { cleanup: string };
      assert.equal(ledger.cleanup, 'cleaned');
      const cacheOwner = JSON.parse(
        await readFile(path.join(cancellationRoot, 'expo-cache-owner.private.json'), 'utf8'),
      ) as { temporaryRoot: string };
      await assert.rejects(access(cacheOwner.temporaryRoot), { code: 'ENOENT' });
      await assert.rejects(fetch(cancelledPort.origin, { signal: AbortSignal.timeout(1000) }));
    } finally {
      controller.abort();
      await cancelled.catch(() => {});
      await unexpectedReady?.stop();
      await cancelledPort.release();
    }
    await proxy.stop();
    await session.stop();
    await writeFile(
      path.join(output, 'receipt.json'),
      JSON.stringify(
        {
          result: 'passed',
          scope:
            'owned Expo startup and observed real HTTP login smoke; not the full T11 auth scenario or public attempt receipt',
          runId: session.manifest.runId,
          appOrigin: app.origin,
          proxyOrigin: proxy.origin,
          resolvedApiOrigin: (app.configExtra.server as { baseUrl: string }).baseUrl,
          observedApiOrigins: [...apiOrigins],
          observedProcesses: app.observedProcesses,
          cleanup: 'cleaned',
          occupiedForeignServerPreserved: true,
          cancellationAfterOwnedSpawnCleaned: true,
          isolatedMetroCacheCreatedAndRemoved: true,
          artifacts: ['student-home.png', 'expo-ownership.json', 'expo.log'],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(`Owned Expo verification: ${path.join(output, 'receipt.json')}`);
  } catch (error) {
    await writeFile(
      path.join(output, 'failure.log'),
      error instanceof Error ? (error.stack ?? error.message) : 'Expo verifier failed',
      { mode: 0o600 },
    );
    throw error;
  } finally {
    await browser?.close();
    try {
      await app?.stop();
    } finally {
      try {
        await proxy?.stop();
      } finally {
        await session?.stop().catch(() => session!.cancel('SIGTERM'));
        await reservation.release();
      }
    }
  }
}
void main().catch(() => {
  console.error('Owned Expo verification failed; private diagnostics retained.');
  process.exitCode = 2;
});

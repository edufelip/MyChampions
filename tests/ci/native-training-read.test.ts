import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { startOwnedApiProxy } from '../../scripts/testing/owned-api-proxy';
import type { startOwnedSession } from '../../scripts/testing/owned-session';

type Session = Awaited<ReturnType<typeof startOwnedSession>>;
const planId = 'training_plan_00000000-0000-4000-8000-000000000001';
const input = { fixtureScope: 'native-entry-ios' as const, accountUid: 'coach', planId };
// Synthetic ownership/snapshot boundary, real HTTP transport. No DB/native passing claim.
for (const mode of ['oversized', 'invalid-json', 'wrong-plan', 'denied', 'slow-body'] as const) {
  void test(`observed native read rejects ${mode} and remains stoppable`, async () => {
    const upstream = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/plans/predefined') response.end('{}');
      else if (request.url === '/me')
        response.end(JSON.stringify({ profile: { authUid: 'coach' } }));
      else if (mode === 'oversized')
        response.end(JSON.stringify({ plan: { id: planId, padding: 'x'.repeat(1_048_577) } }));
      else if (mode === 'invalid-json') response.end('invalid JSON');
      else if (mode === 'wrong-plan') response.end(JSON.stringify({ plan: { id: 'foreign' } }));
      else if (mode === 'denied') {
        response.statusCode = 404;
        response.end('{}');
      } else {
        response.writeHead(200);
        response.write('{');
      }
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    assert(address && typeof address !== 'string');
    const apiOrigin = `http://127.0.0.1:${address.port}`;
    const session = {
      apiOrigin,
      apiPid: 1,
      manifest: {
        runId: 'a'.repeat(24),
        port: 1024,
        fixtureScopes: [input.fixtureScope],
        processes: [{ role: 'api', pid: 1 }],
      },
      assertApiOwnership: () => Promise.resolve(apiOrigin),
      snapshot: () =>
        Promise.resolve({
          runId: 'a'.repeat(24),
          scope: input.fixtureScope,
          readOnly: true,
          trainingPlans: [{ id: planId, ownerProfessionalUid: 'coach' }],
        }),
    } as unknown as Session;
    const proxy = await startOwnedApiProxy({
      session,
      appOrigin: 'http://127.0.0.1:42902',
      requestProfile: 'native',
      requestDeadlineMs: mode === 'slow-body' ? 100 : 5000,
    });
    try {
      const catalog = await fetch(`${proxy.origin}/plans/predefined`, {
        headers: { authorization: 'Bearer synthetic-test-only' },
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(catalog.status, 200);
      await catalog.arrayBuffer();
      const start = performance.now();
      await assert.rejects(
        proxy.readObservedNativeTrainingPlan(input),
        mode === 'oversized'
          ? /exceeds limit/
          : mode === 'invalid-json'
            ? /invalid JSON/
            : mode === 'slow-body'
              ? /abort|timeout/i
              : /exact authenticated plan/,
      );
      if (mode === 'slow-body')
        assert(performance.now() - start < 2000, 'Body read exceeded bounded deadline');
      assert.equal(proxy.faultState, null);
    } finally {
      await proxy.stop();
      upstream.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}

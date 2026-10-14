import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { startOwnedApiProxy } from '../../scripts/testing/owned-api-proxy';

async function listenLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function closeLoopback(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

void test('native auth identity capture rejects when enabled after the first native sign-in', async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ profile: { authUid: 'coach' } }));
  });
  const apiOrigin = await listenLoopback(upstream);
  const apiPid = process.pid;
  const session = {
    apiOrigin,
    apiPid,
    manifest: {
      port: 1,
      runId: 'camera-auth-order-unit',
      fixtureScopes: [],
      processes: [{ role: 'api', pid: apiPid }],
    },
    assertApiOwnership: () => Promise.resolve(apiOrigin),
  } as unknown as Parameters<typeof startOwnedApiProxy>[0]['session'];
  const proxy = await startOwnedApiProxy({
    session,
    appOrigin: 'http://127.0.0.1:42001',
    requestProfile: 'native',
  });
  try {
    const response = await fetch(`${proxy.origin}/auth/email/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 201);
    await response.arrayBuffer();
    assert.equal(proxy.observations.length, 1);
    assert.throws(
      () => proxy.enableNativeAuthIdentityCapture(['coach', 'student']),
      /must precede native authentication/,
    );
    assert.deepEqual(proxy.nativeAuthIdentities, []);
  } finally {
    await proxy.stop();
    await closeLoopback(upstream);
  }
});

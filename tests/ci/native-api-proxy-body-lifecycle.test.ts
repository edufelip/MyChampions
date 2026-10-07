import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  startOwnedApiProxy,
  type NativeRequestBodyCaptureReceipt,
} from '../../scripts/testing/owned-api-proxy';

type ProxySession = Parameters<typeof startOwnedApiProxy>[0]['session'];
const appOrigin = 'http://127.0.0.1:42001';
const runId = 'a'.repeat(24);
const inviteRoute = '/connections/invite-submissions';
const code = 'unit-code';
const body = Buffer.from(JSON.stringify({ code }) + '\n', 'utf8');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function listen(server: Server): Promise<string> {
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

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function session(apiOrigin: string, assertApiOwnership: () => Promise<string>): ProxySession {
  return {
    apiOrigin,
    apiPid: process.pid,
    manifest: {
      port: 1,
      runId,
      fixtureScopes: [],
      processes: [{ role: 'api', pid: process.pid }],
    },
    assertApiOwnership,
  } as unknown as ProxySession;
}

function enableBodyCapture(
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>,
  artifactRoot: string,
  apiOrigin: string,
) {
  proxy.enableNativeRequestBodyCapture({
    artifactRoot,
    captureRunId: runId,
    sessionRunId: runId,
    backendAttemptId: `${runId}:first`,
    actorAuthUidSha256: hash('student-fixture'),
    targetOrigin: apiOrigin,
    apiPid: process.pid,
    manualCodeSha256: hash(code),
    actionSha256: hash('android-camera-submit'),
  });
}

async function receivedBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function sendNativePost(
  origin: string,
  requestBody = body,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(inviteRoute, origin);
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': requestBody.byteLength,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | Uint8Array) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.once('error', reject);
    request.end(requestBody);
  });
}

void test(
  'native body capture holds a delayed owned POST, forwards it once, and seals exact bytes',
  { concurrency: false },
  async () => {
    let releaseOwnership!: () => void;
    let markOwnershipStarted!: () => void;
    const ownershipStarted = new Promise<void>((resolve) => {
      markOwnershipStarted = resolve;
    });
    const ownershipRelease = new Promise<string>((resolve) => {
      releaseOwnership = () => resolve('release');
    });
    let upstreamRequests = 0;
    let upstreamBodyHex = '';
    const upstream = createServer((request, response) => {
      upstreamRequests++;
      void receivedBody(request)
        .then((received) => {
          upstreamBodyHex = received.toString('hex');
          response.writeHead(201, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: true }));
        })
        .catch(() => response.destroy());
    });
    const apiOrigin = await listen(upstream);
    const artifactRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'proxy-body-')));
    const ownedSession = session(apiOrigin, async () => {
      markOwnershipStarted();
      await ownershipRelease;
      return apiOrigin;
    });
    const proxy = await startOwnedApiProxy({
      session: ownedSession,
      appOrigin,
      requestProfile: 'native',
    });
    try {
      enableBodyCapture(proxy, artifactRoot, apiOrigin);
      const pending = sendNativePost(proxy.origin);
      await ownershipStarted;
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(upstreamRequests, 0, 'body must remain behind the ownership fence');
      assert.equal(proxy.nativeRequestBodyCapture, null);
      releaseOwnership();
      const result = await pending;
      assert.equal(result.status, 201);
      await proxy.waitForQuiescence();
      assert.equal(upstreamRequests, 1);
      assert.equal(upstreamBodyHex, body.toString('hex'));
      const receipt = proxy.nativeRequestBodyCapture as NativeRequestBodyCaptureReceipt | null;
      assert(receipt);
      assert.equal(receipt.status, 201);
      assert.equal(receipt.outcome, 'forwarded');
      assert.equal(receipt.bodySizeBytes, body.byteLength);
      assert.equal(receipt.bodySha256, hash(body));
      assert.deepEqual(await readFile(path.join(artifactRoot, receipt.bodyPath)), body);
      assert.equal(proxy.observations.length, 1);
      assert.deepEqual(proxy.observations[0], {
        ...proxy.observations[0],
        status: 201,
        outcome: 'forwarded',
      });
    } finally {
      releaseOwnership();
      await proxy.stop();
      await close(upstream);
      await rm(artifactRoot, { recursive: true, force: true });
    }
  },
);

void test(
  'native body capture fails closed when ownership changes before the delayed POST is forwarded',
  { concurrency: false },
  async () => {
    let upstreamRequests = 0;
    const upstream = createServer((_request, response) => {
      upstreamRequests++;
      response.writeHead(201);
      response.end();
    });
    const apiOrigin = await listen(upstream);
    const artifactRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'proxy-foreign-')));
    const foreignOrigin = 'http://127.0.0.1:9';
    const proxy = await startOwnedApiProxy({
      session: session(apiOrigin, () => Promise.resolve(foreignOrigin)),
      appOrigin,
      requestProfile: 'native',
    });
    try {
      enableBodyCapture(proxy, artifactRoot, apiOrigin);
      const result = await sendNativePost(proxy.origin);
      assert.equal(result.status, 503);
      assert.match(result.text, /integration_proxy_ownership_failed/u);
      await proxy.waitForQuiescence();
      assert.equal(upstreamRequests, 0);
      assert.equal(proxy.nativeRequestBodyCapture, null);
      assert.equal(proxy.observations.length, 1);
      assert.equal(proxy.observations[0]?.outcome, 'upstream-failed');
      await assert.rejects(stat(path.join(artifactRoot, 'camera-manual-submit-body.private.bin')));
      await assert.rejects(
        stat(path.join(artifactRoot, 'camera-manual-submit-receipt.private.json')),
      );
    } finally {
      await proxy.stop();
      await close(upstream);
      await rm(artifactRoot, { recursive: true, force: true });
    }
  },
);

void test(
  'native body capture fails closed for an aborted incomplete POST',
  { concurrency: false },
  async () => {
    let upstreamRequests = 0;
    let upstreamBytes = 0;
    const upstream = createServer((request, response) => {
      upstreamRequests++;
      request.on('data', (chunk: Buffer | Uint8Array) => {
        upstreamBytes += Buffer.isBuffer(chunk) ? chunk.byteLength : chunk.byteLength;
      });
      request.resume();
      response.writeHead(201);
      response.end();
    });
    const apiOrigin = await listen(upstream);
    const artifactRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'proxy-aborted-')));
    const proxy = await startOwnedApiProxy({
      session: session(apiOrigin, () => Promise.resolve(apiOrigin)),
      appOrigin,
      requestProfile: 'native',
    });
    try {
      enableBodyCapture(proxy, artifactRoot, apiOrigin);
      await new Promise<void>((resolve) => {
        const target = new URL(inviteRoute, proxy.origin);
        const request = httpRequest({
          hostname: target.hostname,
          port: Number(target.port),
          path: target.pathname,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': body.byteLength + 10,
          },
        });
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        request.once('error', finish);
        request.once('close', finish);
        request.write(body.subarray(0, 5));
        setTimeout(() => request.destroy(), 10);
      });
      await proxy.waitForQuiescence().catch(() => undefined);
      assert.equal(proxy.nativeRequestBodyCapture, null);
      assert.equal(upstreamRequests, 1);
      assert(
        upstreamBytes < body.byteLength,
        'an incomplete client body must never reach the upstream intact',
      );
      await assert.rejects(stat(path.join(artifactRoot, 'camera-manual-submit-body.private.bin')));
      await assert.rejects(
        stat(path.join(artifactRoot, 'camera-manual-submit-receipt.private.json')),
      );
    } finally {
      await proxy.stop();
      await close(upstream);
      await rm(artifactRoot, { recursive: true, force: true });
    }
  },
);

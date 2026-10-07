import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { requireAndroidCameraTransport } from '../../scripts/testing/native-camera-android-observation';

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const apiOrigin = 'http://127.0.0.1:4123';
const proxyOrigin = 'http://127.0.0.1:4124';
const runId = 'aaaaaaaaaaaaaaaaaaaaaaaa';

type Fixture = {
  root: string;
  observations: Record<string, unknown>[];
  request: Record<string, unknown>;
  identity: Record<string, unknown>;
};

function observation(
  requestId: number,
  route: string,
  status: number,
  method: 'GET' | 'POST',
): Record<string, unknown> {
  return {
    requestId,
    method,
    pathHash: hash(route),
    requestOrigin: null,
    requestProfile: 'native',
    targetOrigin: apiOrigin,
    status,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 1,
  };
}

async function fixture(): Promise<Fixture> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'android-camera-v26-')));
  const body = Buffer.from('{"code":"unit-code"}\n', 'utf8');
  const bodyPath = 'camera-manual-submit-body.private.bin';
  const descriptorPath = 'camera-manual-submit-receipt.private.json';
  await writeFile(path.join(root, bodyPath), body, { mode: 0o600, flag: 'wx' });
  const bodyHash = hash(body);
  const descriptor = {
    kind: 'owned-native-request-body-receipt-v1',
    producer: 'owned-api-proxy-native-request-body-v1',
    bodyPath,
    bodySha256: bodyHash,
    bodySizeBytes: body.byteLength,
    requestId: 3,
    method: 'POST',
    route: '/connections/invite-submissions',
    status: 201,
    requestProfile: 'native',
    requestOrigin: null,
    targetOrigin: apiOrigin,
    backendAttemptId: `${runId}:first`,
    apiPid: 42,
    captureRunId: runId,
    actorAuthUidHash: hash('student-fixture'),
    sessionRunId: runId,
    manualCodeSha256: hash('unit-code'),
    actionSha256: hash('submit-action'),
  };
  await writeFile(path.join(root, descriptorPath), JSON.stringify(descriptor), {
    mode: 0o600,
    flag: 'wx',
  });
  return {
    root,
    observations: [
      observation(1, '/connections', 200, 'GET'),
      observation(2, '/analytics/events', 202, 'POST'),
      observation(3, '/connections/invite-submissions', 201, 'POST'),
      observation(4, '/analytics/events', 202, 'POST'),
      observation(5, '/connections', 200, 'GET'),
    ],
    request: {
      requestId: 3,
      bodyHash,
      recorderBodyHash: bodyHash,
      manualCodeSha256: hash('unit-code'),
      actionSha256: hash('submit-action'),
      sourcePath: bodyPath,
      sourceSha256: bodyHash,
      descriptorPath,
      backendAttemptId: `${runId}:first`,
      apiPid: 42,
      apiOrigin,
    },
    identity: {
      runId,
      attemptId: `${runId}:first`,
      apiOrigin,
      apiPid: 42,
      apiStarted: 'owned-start',
      apiScript: 'server/src/index.ts',
      backendAttemptId: `${runId}:first`,
    },
  };
}

async function verify(f: Fixture, observations = f.observations, targetOrigin = apiOrigin) {
  return requireAndroidCameraTransport({
    artifactRoot: f.root,
    observations: observations as never,
    beforeRequestId: 0,
    throughRequestId: 5,
    allowedRoutes: ['/connections', '/connections/invite-submissions', '/analytics/events'],
    targetOrigin,
    identity: f.identity as never,
    request: f.request as never,
  });
}

void test('V38 transport keeps raw upstream binding separate from the app-facing proxy origin', async () => {
  const f = await fixture();
  try {
    const appFacingProxy = { apiOrigin: proxyOrigin };
    assert.notEqual(appFacingProxy.apiOrigin, f.identity.apiOrigin);
    const result = await verify(f, f.observations, apiOrigin);
    assert.equal(result.requestId, 3);
    assert.equal(result.postRows.length, 5);

    const forgedProxyRow = f.observations.map((row, index) =>
      index === 2 ? { ...row, targetOrigin: proxyOrigin } : row,
    );
    await assert.rejects(
      verify(f, forgedProxyRow, apiOrigin),
      /Expected values to be strictly equal/,
    );

    await assert.rejects(
      requireAndroidCameraTransport({
        artifactRoot: f.root,
        observations: f.observations as never,
        beforeRequestId: 0,
        throughRequestId: 5,
        allowedRoutes: ['/connections', '/connections/invite-submissions', '/analytics/events'],
        targetOrigin: apiOrigin,
        identity: f.identity as never,
        request: { ...f.request, apiOrigin: proxyOrigin } as never,
      }),
      /Expected values to be strictly equal/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('V26 retained transport accepts the two real analytics events around one invite POST', async () => {
  const f = await fixture();
  try {
    const result = await verify(f);
    assert.equal(result.requestId, 3);
    assert.equal(result.postRows.length, 5);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('V26 transport rejects an analytics event with a non-202 response', async () => {
  const f = await fixture();
  try {
    const rows = f.observations.map((row, index) => (index === 1 ? { ...row, status: 200 } : row));
    await assert.rejects(verify(f, rows), /analytics event must be accepted with HTTP 202/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('V26 transport rejects an analytics event sent with a non-POST method', async () => {
  const f = await fixture();
  try {
    const rows = f.observations.map((row, index) =>
      index === 1 ? { ...row, method: 'GET' } : row,
    );
    await assert.rejects(verify(f, rows), /Expected values to be strictly equal/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('V26 transport rejects an undeclared route instead of widening the route window', async () => {
  const f = await fixture();
  try {
    const rows = f.observations.map((row, index) =>
      index === 1 ? observation(2, '/subscription/entitlements/snapshot', 202, 'POST') : row,
    );
    await assert.rejects(verify(f, rows), /post-fence history contains an undeclared route/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('V26 transport rejects a normal route with an analytics-only 202 response', async () => {
  const f = await fixture();
  try {
    const rows = f.observations.map((row, index) => (index === 0 ? { ...row, status: 202 } : row));
    await assert.rejects(verify(f, rows), /Android camera history contains a failed response/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('V26 transport still rejects duplicate invite submissions with analytics allowed', async () => {
  const f = await fixture();
  try {
    const rows = [
      ...f.observations,
      observation(6, '/connections/invite-submissions', 201, 'POST'),
    ];
    await assert.rejects(
      requireAndroidCameraTransport({
        artifactRoot: f.root,
        observations: rows as never,
        beforeRequestId: 0,
        throughRequestId: 6,
        allowedRoutes: ['/connections', '/connections/invite-submissions', '/analytics/events'],
        targetOrigin: apiOrigin,
        identity: f.identity as never,
        request: f.request as never,
      }),
      /exactly one POST 201/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

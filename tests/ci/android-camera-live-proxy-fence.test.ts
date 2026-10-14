import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { requireAndroidCameraTransport } from '../../scripts/testing/native-camera-android-observation';

const RUN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const API_ORIGIN = 'http://127.0.0.1:4123';
const API_PID = 42;
const INVITE_ROUTE = '/connections/invite-submissions';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

type Row = {
  requestId: number;
  method: 'GET' | 'POST';
  pathHash: string;
  requestOrigin: null;
  requestProfile: 'native';
  targetOrigin: string;
  status: number;
  outcome: 'forwarded';
  faultAttemptId: null;
  elapsedMs: number;
};

type State = { fence: number; rows: Row[] };

function row(requestId: number, route: string, status = 200, method: 'GET' | 'POST' = 'GET'): Row {
  return {
    requestId,
    method,
    pathHash: hash(route),
    requestOrigin: null,
    requestProfile: 'native',
    targetOrigin: API_ORIGIN,
    status,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 1,
  };
}

function liveProxy(state: State) {
  return {
    get requestIdFence() {
      return state.fence;
    },
    get observations() {
      return state.rows.map((value) => ({ ...value }));
    },
  };
}

function identity() {
  return {
    runId: RUN_ID,
    attemptId: `${RUN_ID}:first`,
    apiOrigin: API_ORIGIN,
    apiPid: API_PID,
    apiStarted: 'owned-start',
    apiScript: 'server/src/testing/serve.ts',
    backendAttemptId: `${RUN_ID}:first`,
  };
}

function makeArtifact() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'android-camera-live-fence-')));
  chmodSync(root, 0o700);
  const body = Buffer.from('{"code":"unit-code"}\n', 'utf8');
  const bodyPath = 'camera-manual-submit-body.private.bin';
  const descriptorPath = 'camera-manual-submit-receipt.private.json';
  writeFileSync(path.join(root, bodyPath), body, { flag: 'wx', mode: 0o600 });
  writeFileSync(
    path.join(root, descriptorPath),
    JSON.stringify({
      kind: 'owned-native-request-body-receipt-v1',
      producer: 'owned-api-proxy-native-request-body-v1',
      bodyPath,
      bodySha256: hash(body.toString('utf8')),
      bodySizeBytes: body.byteLength,
      requestId: 3,
      method: 'POST',
      route: INVITE_ROUTE,
      status: 201,
      requestProfile: 'native',
      requestOrigin: null,
      targetOrigin: API_ORIGIN,
      backendAttemptId: `${RUN_ID}:first`,
      apiPid: API_PID,
      captureRunId: RUN_ID,
      actorAuthUidHash: hash('student-fixture'),
      sessionRunId: RUN_ID,
      manualCodeSha256: hash('unit-code'),
      actionSha256: hash('submit-action'),
    }),
    { flag: 'wx', mode: 0o600 },
  );
  return {
    root,
    body,
    bodyPath,
    descriptorPath,
    request: {
      requestId: 3,
      bodyHash: hash(body.toString('utf8')),
      recorderBodyHash: hash(body.toString('utf8')),
      manualCodeSha256: hash('unit-code'),
      actionSha256: hash('submit-action'),
      sourcePath: bodyPath,
      sourceSha256: hash(body.toString('utf8')),
      descriptorPath,
      backendAttemptId: `${RUN_ID}:first`,
      apiPid: API_PID,
      apiOrigin: API_ORIGIN,
    },
  };
}

function input(
  artifactRoot: string,
  observations: readonly Row[],
  beforeRequestId: number,
  throughRequestId: number,
  request: Record<string, unknown>,
) {
  return {
    artifactRoot,
    observations,
    beforeRequestId,
    throughRequestId,
    allowedRoutes: ['/connections', INVITE_ROUTE],
    targetOrigin: API_ORIGIN,
    identity: identity(),
    request,
  } as never;
}

void test('pre-fix static camera boundary reproduces the unlabeled fence assertion', async () => {
  const state: State = {
    fence: 2,
    rows: [row(1, '/connections'), row(2, '/connections')],
  };
  const staticBoundary = {
    observations: state.rows.map((value) => ({ ...value })),
    requestIdFence: state.fence,
  };
  const beforeRequestId = staticBoundary.requestIdFence;
  state.rows.push(row(3, INVITE_ROUTE, 201, 'POST'));
  state.fence = 3;

  await assert.rejects(
    requireAndroidCameraTransport(
      input(
        '/tmp/unused',
        staticBoundary.observations,
        beforeRequestId,
        staticBoundary.requestIdFence,
        {},
      ),
    ),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.includes('The expression evaluated to a falsy value'),
  );
});

void test('live camera boundary advances through the producer submit and passes the real transport verifier', async () => {
  const state: State = {
    fence: 2,
    rows: [row(1, '/connections'), row(2, '/connections')],
  };
  const boundary = liveProxy(state);
  const beforeRequestId = boundary.requestIdFence;
  state.rows.push(row(3, INVITE_ROUTE, 201, 'POST'));
  state.fence = 3;
  const throughRequestId = boundary.requestIdFence;
  const artifact = makeArtifact();
  try {
    const result = await requireAndroidCameraTransport(
      input(
        artifact.root,
        boundary.observations,
        beforeRequestId,
        throughRequestId,
        artifact.request,
      ),
    );
    assert.equal(result.requestId, 3);
    assert.equal(result.postRows.length, 1);
  } finally {
    rmSync(artifact.root, { recursive: true, force: true });
  }
});

void test('candidate source exposes both live boundary getters at the production wiring site', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../../scripts/testing/capture-android-testability.ts'),
    'utf8',
  );
  assert.match(source, /get observations\(\) \{\s*return proxy!\.observations;/u);
  assert.match(source, /get requestIdFence\(\) \{\s*return proxy!\.requestIdFence;/u);
  assert.doesNotMatch(
    source,
    /observations: proxy\.observations,\s*requestIdFence: proxy\.requestIdFence/u,
  );
});

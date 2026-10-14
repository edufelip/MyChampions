import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readAndroidCameraManualRequestBinding,
  type AndroidCameraManualRequestBinding,
} from '../../scripts/testing/native-camera-android-observation';
import type { NativeRequestBodyCaptureReceipt } from '../../scripts/testing/owned-api-proxy';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const runId = 'a'.repeat(24);
const origin = 'http://127.0.0.1:4310';
const bodyPath = 'camera-manual-submit-body.private.bin';
const descriptorPath = 'camera-manual-submit-receipt.private.json';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'android-camera-receipts-'));
  const canonicalRoot = await realpath(root);
  const body = Buffer.from('{"code":"unit-code"}\n', 'utf8');
  const sourceSha256 = hash(body);
  const capture: NativeRequestBodyCaptureReceipt = {
    kind: 'owned-native-request-body-receipt-v1',
    producer: 'owned-api-proxy-native-request-body-v1',
    requestId: 2,
    method: 'POST',
    pathHash: hash('/connections/invite-submissions'),
    status: 201,
    outcome: 'forwarded',
    targetOrigin: origin,
    apiPid: 4311,
    backendAttemptId: `${runId}:first`,
    actorAuthUidSha256: hash('student-fixture'),
    manualCodeSha256: hash('unit-code'),
    actionSha256: hash('submit-action'),
    bodyPath,
    bodySha256: sourceSha256,
    bodySizeBytes: body.byteLength,
    route: '/connections/invite-submissions',
    requestProfile: 'native',
    requestOrigin: null,
    captureRunId: runId,
    sessionRunId: runId,
    actorAuthUidHash: hash('student-fixture'),
    sourcePath: bodyPath,
    sourceSha256,
    sizeBytes: body.byteLength,
    descriptorPath,
    schema: 'json-code',
    source: 'owned-api-proxy-native-request-body',
  };
  await writeFile(path.join(canonicalRoot, bodyPath), body, { mode: 0o600 });
  await writeFile(
    path.join(canonicalRoot, descriptorPath),
    JSON.stringify({
      ...capture,
      bodyPath,
      bodySha256: sourceSha256,
      bodySizeBytes: body.byteLength,
    }),
    { mode: 0o600 },
  );
  return { root: canonicalRoot, body, capture };
}

void test('manual submission binding reads the protected body and descriptor before transport validation', async () => {
  const input = await fixture();
  try {
    const binding: AndroidCameraManualRequestBinding = await readAndroidCameraManualRequestBinding({
      artifactRoot: input.root,
      capture: input.capture,
      targetOrigin: origin,
      apiPid: 4311,
      sessionRunId: runId,
      backendAttemptId: `${runId}:first`,
    });
    assert.equal(binding.requestId, 2);
    assert.equal(binding.bodyHash, hash(input.body));
    assert.equal(binding.recorderBodyHash, hash(input.body));
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('manual submission binding rejects changed body bytes even when getter metadata is unchanged', async () => {
  const input = await fixture();
  try {
    await writeFile(path.join(input.root, bodyPath), Buffer.from('{"code":"forged"}\n'), {
      mode: 0o600,
    });
    await assert.rejects(
      readAndroidCameraManualRequestBinding({
        artifactRoot: input.root,
        capture: input.capture,
        targetOrigin: origin,
        apiPid: 4311,
        sessionRunId: runId,
        backendAttemptId: `${runId}:first`,
      }),
      /Expected values|size|hash|code/i,
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('manual submission binding rejects a descriptor from another owned session run', async () => {
  const input = await fixture();
  try {
    await assert.rejects(
      readAndroidCameraManualRequestBinding({
        artifactRoot: input.root,
        capture: input.capture,
        targetOrigin: origin,
        apiPid: 4311,
        sessionRunId: 'b'.repeat(24),
        backendAttemptId: `${runId}:first`,
      }),
      /sessionRunId|Expected values/i,
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

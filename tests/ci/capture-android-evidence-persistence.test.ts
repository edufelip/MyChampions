import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildAndroidConnectionEvidenceAvailability,
  persistAndroidConnectionEvidence,
  type AndroidConnectionEvidenceReceipts,
} from '../../scripts/testing/capture-android-testability';
import {
  readOwnedAndroidStableFile,
  writeOwnedAndroidPrivateFile,
} from '../../scripts/testing/native-android-session-adapter';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../scripts/testing/owned-api-proxy';

const targetOrigin = 'http://127.0.0.1:43123';
const allowlistHash = 'a'.repeat(64);

function observation(requestId: number): ProxyObservation {
  return {
    requestId,
    method: 'GET',
    pathHash: 'b'.repeat(64),
    requestOrigin: targetOrigin,
    requestProfile: 'native',
    requestCredentialPresent: false,
    requestCredentialClassification: {
      authorization: 'absent',
      cookie: 'absent',
      knownAccessCookie: 'absent',
      knownRefreshCookie: 'absent',
      otherCookiePresent: false,
      malformedCookiePresent: false,
    },
    targetOrigin,
    status: 200,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 1,
  };
}

function identity(requestId: number): NativeAuthIdentityObservation {
  return {
    requestId,
    ordinal: requestId,
    targetOrigin,
    apiPid: 4321,
    status: 201,
    authUid: 'coach-auth-uid',
    verification: 'verified',
    verificationReason: 'verified',
    fixtureAuthUidAllowlistHash: allowlistHash,
  };
}

function evidence() {
  return {
    observations: [observation(1)],
    nativeAuthIdentities: [identity(1)],
  } as const;
}

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mychampions-android-evidence-v3-'));
  await chmod(root, 0o700);
  return realpath(root);
}

async function readReceiptPair(root: string, receipts: AndroidConnectionEvidenceReceipts) {
  const transport = await readOwnedAndroidStableFile({
    artifactRoot: root,
    filePath: path.join(root, receipts.transportReceipt.path),
    kind: 'transport',
    maxBytes: 1 * 1024 * 1024,
  });
  const auth = await readOwnedAndroidStableFile({
    artifactRoot: root,
    filePath: path.join(root, receipts.nativeAuthIdentitiesReceipt.path),
    kind: 'auth',
    maxBytes: 1 * 1024 * 1024,
  });
  assert.deepEqual(JSON.parse(transport.bytes.toString('utf8')), evidence().observations);
  assert.deepEqual(JSON.parse(auth.bytes.toString('utf8')), evidence().nativeAuthIdentities);
  assert.deepEqual(transport.receipt, receipts.transportReceipt);
  assert.deepEqual(auth.receipt, receipts.nativeAuthIdentitiesReceipt);
  return { transport, auth };
}

void test('producer persists real owned files and returns matching receipts after the evidence getters drain', async () => {
  const root = await privateRoot();
  let drained = false;
  const source = {
    get observations() {
      assert.equal(drained, true, 'transport getter ran before proxy drain');
      return evidence().observations;
    },
    get nativeAuthIdentities() {
      assert.equal(drained, true, 'auth getter ran before proxy drain');
      return evidence().nativeAuthIdentities;
    },
  };
  try {
    drained = true;
    const receipts = await persistAndroidConnectionEvidence(root, source);
    await readReceiptPair(root, receipts);
    assert.equal(receipts.transportReceipt.verification, 'owned-stable-reader-v6');
    assert.equal(receipts.nativeAuthIdentitiesReceipt.verification, 'owned-stable-reader-v6');
    assert.equal(receipts.transportReceipt.kind, 'transport');
    assert.equal(receipts.nativeAuthIdentitiesReceipt.kind, 'auth');
    assert.equal((await stat(path.join(root, receipts.transportReceipt.path))).mode & 0o777, 0o600);
    assert.equal(
      (await stat(path.join(root, receipts.nativeAuthIdentitiesReceipt.path))).mode & 0o777,
      0o600,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('producer callback boundary records both owned writes and cannot invent a missing receipt', async () => {
  const root = await privateRoot();
  const calls: string[] = [];
  const receipts: AndroidConnectionEvidenceReceipts = await persistAndroidConnectionEvidence(
    root,
    evidence(),
    {
      writeOwnedFile: async (input) => {
        calls.push(input.relativePath);
        return writeOwnedAndroidPrivateFile(input);
      },
    },
  );
  try {
    assert.deepEqual(calls, [
      'transport-observations.private.json',
      'native-auth-identities.private.json',
    ]);
    await readReceiptPair(root, receipts);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('producer preserves the first actual receipt when the second owned write fails', async () => {
  const root = await privateRoot();
  let calls = 0;
  try {
    await assert.rejects(
      persistAndroidConnectionEvidence(root, evidence(), {
        writeOwnedFile: async (input) => {
          calls += 1;
          if (calls === 2) throw new Error('simulated auth receipt write failure');
          return writeOwnedAndroidPrivateFile(input);
        },
      }),
      /simulated auth receipt write failure/,
    );
    assert.equal(calls, 2);
    assert.deepEqual(await readdir(root), ['transport-observations.private.json']);
    const bytes = await readFile(path.join(root, 'transport-observations.private.json'));
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), evidence().observations);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('producer cancellation is fail-closed before either receipt write', async () => {
  const root = await privateRoot();
  const controller = new AbortController();
  controller.abort(new Error('cancelled before final evidence persistence'));
  let calls = 0;
  try {
    await assert.rejects(
      persistAndroidConnectionEvidence(root, evidence(), {
        signal: controller.signal,
        writeOwnedFile: async (input) => {
          calls += 1;
          return writeOwnedAndroidPrivateFile(input);
        },
      }),
      /aborted|cancel/i,
    );
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('consumer-visible tamper is detected against the returned producer receipt', async () => {
  const root = await privateRoot();
  try {
    const receipts = await persistAndroidConnectionEvidence(root, evidence());
    const file = path.join(root, receipts.transportReceipt.path);
    await readFile(file);
    const changed = JSON.stringify([{ ...observation(2) }], null, 2);
    await writeFile(file, changed, { flag: 'w', mode: 0o600 });
    await assert.rejects(async () => {
      const actual = await readOwnedAndroidStableFile({
        artifactRoot: root,
        filePath: file,
        kind: 'query',
        maxBytes: 256 * 1024,
      });
      assert.equal(actual.receipt.sha256, receipts.transportReceipt.sha256);
    }, /Expected values to be strictly equal/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('final cleanup failure is represented as unavailable before producer persistence is considered qualified', () => {
  assert.deepEqual(buildAndroidConnectionEvidenceAvailability(true), { status: 'available' });
  assert.deepEqual(buildAndroidConnectionEvidenceAvailability(false), {
    status: 'unavailable',
    reason: 'proxy-shutdown-failed',
  });
});

void test('transport and auth writers reject over-limit bytes before creating files', async () => {
  const root = await privateRoot();
  try {
    for (const kind of ['transport', 'auth'] as const) {
      await assert.rejects(
        writeOwnedAndroidPrivateFile({
          artifactRoot: root,
          relativePath: `${kind}-too-large.private.json`,
          bytes: Buffer.alloc(1 * 1024 * 1024 + 1),
          kind,
        }),
        /bounded write size/,
      );
    }
    assert.deepEqual(await readdir(root), []);
    const exact = await writeOwnedAndroidPrivateFile({
      artifactRoot: root,
      relativePath: 'transport-at-limit.private.json',
      bytes: Buffer.alloc(1 * 1024 * 1024, 0x61),
      kind: 'transport',
    });
    assert.equal(exact.kind, 'transport');
    assert.equal(exact.sizeBytes, 1 * 1024 * 1024);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

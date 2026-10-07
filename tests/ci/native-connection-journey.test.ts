import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildNativeConnectionSnapshotReference,
  NATIVE_CONNECTION_SNAPSHOT_KEYS,
  nativeConnectionSnapshotPath,
  requireNativeConnectionInviteCode,
  requireNativeConnectionTransport,
  sealNativeConnectionSnapshotReferences,
} from '../../scripts/testing/native-connection-journey';
import type {
  NativeConnectionArtifactLabel,
  NativeConnectionSnapshotReferences,
} from '../../scripts/testing/native-connection-journey';
import type { ProxyObservation } from '../../scripts/testing/owned-api-proxy';

const invite = (text: string) => ({
  attributes: { 'resource-id': 'pro.home.inviteCodeValue', accessibilityText: text },
  children: [],
});
void test('native invite comes only from the unique exact control with current server format', () => {
  assert.equal(
    requireNativeConnectionInviteCode({ children: [invite('Invite code: AB12CD34')] }),
    'AB12CD34',
  );
  assert.equal(requireNativeConnectionInviteCode(invite('AB12CD34')), 'AB12CD34');
  assert.throws(() =>
    requireNativeConnectionInviteCode({
      children: [{ attributes: { accessibilityText: 'Invite code: AB12CD34' } }],
    }),
  );
  assert.throws(() =>
    requireNativeConnectionInviteCode({ children: [invite('AB12CD34'), invite('AB12CD34')] }),
  );
  for (const text of [
    'ab12cd34',
    'AB12CD34 trailing',
    'Invite code: AB12CD34\n',
    '1234567',
    'Code: AAAAAAAAA',
    'Code: token AB12CD34',
  ])
    assert.throws(() => requireNativeConnectionInviteCode(invite(text)));
});
void test('native invite hierarchy rejects malformed and unbounded evidence', () => {
  assert.throws(() => requireNativeConnectionInviteCode({ children: 'not-an-array' }));
  const cyclic: { children: unknown[] } = { children: [] };
  cyclic.children.push(cyclic);
  assert.throws(() => requireNativeConnectionInviteCode(cyclic));
  assert.throws(() =>
    requireNativeConnectionInviteCode({ children: Array.from({ length: 5001 }, () => ({})) }),
  );
});

const row = (requestId: number, patch: Partial<ProxyObservation> = {}): ProxyObservation => ({
  requestId,
  method: 'POST',
  pathHash: createHash('sha256').update('/connections/invite-submissions').digest('hex'),
  requestOrigin: null,
  requestProfile: 'native',
  targetOrigin: 'http://127.0.0.1:45001',
  status: 201,
  outcome: 'forwarded',
  faultAttemptId: null,
  elapsedMs: 10,
  ...patch,
});
const requireSubmission = (
  observations: ProxyObservation[],
  patch: Partial<Parameters<typeof requireNativeConnectionTransport>[0]> = {},
) =>
  requireNativeConnectionTransport({
    observations,
    method: 'POST',
    route: '/connections/invite-submissions',
    status: 201,
    targetOrigin: 'http://127.0.0.1:45001',
    afterRequestId: 3,
    throughRequestId: 7,
    unique: true,
    ...patch,
  });
void test('native mutation is bound to the exact owned route and request window without completion-order assumptions', () => {
  assert.equal(
    requireSubmission([row(7, { method: 'GET' }), row(5), row(4, { method: 'GET' })])[0].requestId,
    5,
  );
  assert.throws(() => requireSubmission([row(3)]));
  assert.throws(() => requireSubmission([row(8)]));
  assert.throws(() =>
    requireSubmission([
      row(5, {
        pathHash: createHash('sha256')
          .update('/connections/invite-submissions-extra')
          .digest('hex'),
      }),
    ]),
  );
  assert.throws(() => requireSubmission([row(5)], { afterRequestId: 7 }));
});
void test('native mutation rejects duplicate submissions and any unqualified matching transport', () => {
  assert.throws(() => requireSubmission([row(5), row(6)]));
  assert.throws(() => requireSubmission([row(5), row(5, { method: 'GET' })]));
  for (const patch of [
    { status: 500 },
    { requestOrigin: 'http://127.0.0.1:48001' },
    { outcome: 'injected' as const },
    { requestProfile: 'browser' as const },
    { targetOrigin: 'http://127.0.0.1:45002' },
    { faultAttemptId: 'unexpected:first' },
  ])
    assert.throws(() => requireSubmission([row(5, patch)]));
  assert.throws(() =>
    requireSubmission([row(5), row(6, { outcome: 'upstream-failed' })], { unique: false }),
  );
});

void test('connection journey snapshot references preserve semantic keys and canonical filenames', () => {
  const semanticKeys = NATIVE_CONNECTION_SNAPSHOT_KEYS;
  const reportSnapshots = Object.fromEntries(
    semanticKeys.map((key) => [key, buildNativeConnectionSnapshotReference(key, key)]),
  ) as NativeConnectionSnapshotReferences;
  const sealedSnapshots = sealNativeConnectionSnapshotReferences(reportSnapshots);

  assert.deepEqual(Object.keys(sealedSnapshots), semanticKeys);
  assert.equal(
    sealedSnapshots.normalCoachBefore.path,
    'connection-normal-coach-before.private.json',
  );
  assert.equal(
    sealedSnapshots.pendingAfterCoachAuth.path,
    'connection-pending-after-coach-auth.private.json',
  );
  assert.equal(
    sealedSnapshots.activeAfterStudentAuth.path,
    'connection-active-after-student-auth.private.json',
  );
  assert.equal(sealedSnapshots.isolationBefore.path, 'connection-isolation-before.private.json');
  assert.equal(sealedSnapshots.trainingAfter.path, 'connection-training-after.private.json');
  assert.equal(
    sealedSnapshots.normalCoachBefore.sha256,
    createHash('sha256').update('normalCoachBefore').digest('hex'),
  );
  assert.equal(
    nativeConnectionSnapshotPath('normalCoachBefore'),
    sealedSnapshots.normalCoachBefore.path,
  );

  const missingCamelKey = { ...reportSnapshots };
  delete missingCamelKey.normalCoachBefore;
  assert.throws(() => sealNativeConnectionSnapshotReferences(missingCamelKey));

  const legacyReferenceMap = {
    ...reportSnapshots,
    'normal-coach-before': reportSnapshots.normalCoachBefore,
  } as unknown as NativeConnectionSnapshotReferences;
  delete legacyReferenceMap.normalCoachBefore;
  assert.throws(() => sealNativeConnectionSnapshotReferences(legacyReferenceMap));

  assert.throws(() =>
    nativeConnectionSnapshotPath('NormalCoachBefore' as unknown as NativeConnectionArtifactLabel),
  );
});

void test('normal list reads allow multiple successful owned forwards while preserving raw observations', () => {
  const rows = [row(7, { method: 'GET', status: 200 }), row(5, { method: 'GET', status: 200 })];
  const original = structuredClone(rows);
  const matching = requireSubmission(rows, { method: 'GET', status: 200, unique: false });
  assert.deepEqual(rows, original);
  assert.deepEqual(matching, rows);
  matching[0].status = 500;
  assert.deepEqual(rows, original);
});

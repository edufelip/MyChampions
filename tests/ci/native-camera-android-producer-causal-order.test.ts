import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANDROID_CAMERA_PENDING_CARD_ID_PATTERN,
  ANDROID_CAMERA_UI,
  buildAndroidCameraPendingActions,
  buildAndroidCameraSubmitActions,
  submitAndroidCameraPending,
} from '../../scripts/testing/native-camera-android-producer';
import type {
  AndroidCameraFrameCapture,
  AndroidCameraSnapshotSource,
} from '../../scripts/testing/native-camera-android-producer';
import type { OwnedConnectionSnapshot } from '../../scripts/testing/native-connection-snapshot';
import type { OwnedSnapshotEvidence } from '../../scripts/testing/owned-session';

const target = {
  professionalAuthUid: 'coach-primary',
  studentAuthUid: 'student-primary',
  specialty: 'fitness_coach' as const,
};

function snapshot(connections: unknown[] = []): OwnedConnectionSnapshot {
  return { target, rows: { connections } } as unknown as OwnedConnectionSnapshot;
}

function evidence(value: OwnedConnectionSnapshot): OwnedSnapshotEvidence<OwnedConnectionSnapshot> {
  return { value, receipt: {} as OwnedSnapshotEvidence<OwnedConnectionSnapshot>['receipt'] };
}

function connection(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    professionalAuthUid: target.professionalAuthUid,
    studentAuthUid: target.studentAuthUid,
    specialty: target.specialty,
    status: 'pending_confirmation',
    ...overrides,
  };
}

function runPendingSubmission(after: OwnedConnectionSnapshot, before = snapshot()) {
  const events: string[] = [];
  let uiConnectPresses = 0;
  let snapshotReads = 0;
  const input: {
    signal: AbortSignal;
    capture: Pick<AndroidCameraFrameCapture, 'execute'>;
    snapshots: Pick<AndroidCameraSnapshotSource, 'readEvidence'>;
  } = {
    signal: new AbortController().signal,
    capture: {
      execute: (label: string, actions: string, viewId: string, selectors: string | string[]) => {
        events.push('owned-ui-submit');
        assert.equal(label, 'pending-submit');
        assert.equal(viewId, 'SCR-student-professionals');
        assert.deepEqual(selectors, [ANDROID_CAMERA_UI.professionalsScreen]);
        assert.equal(actions, buildAndroidCameraSubmitActions());
        uiConnectPresses += 1;
        return Promise.resolve();
      },
    },
    snapshots: {
      readEvidence: () => {
        snapshotReads += 1;
        events.push(snapshotReads === 1 ? 'snapshot:pre-submit' : 'snapshot:post-submit');
        return Promise.resolve(evidence(snapshotReads === 1 ? before : after));
      },
    },
  };
  return submitAndroidCameraPending(input, buildAndroidCameraSubmitActions()).then((result) => ({
    result,
    events,
    uiConnectPresses,
    snapshotReads,
  }));
}

void test('Android camera pending submission proves zero before and reads the target only after one owned UI submit', async () => {
  const result = await runPendingSubmission(snapshot([connection('connection-camera-1')]));
  assert.deepEqual(result.events, [
    'snapshot:pre-submit',
    'owned-ui-submit',
    'snapshot:post-submit',
  ]);
  assert.equal(result.snapshotReads, 2);
  assert.equal(result.uiConnectPresses, 1);
  assert.equal(result.result.pendingConnectionId, 'connection-camera-1');
  assert.equal(result.result.preSubmitEvidence.value.rows.connections.length, 0);
  assert.equal(result.result.pendingSnapshotEvidence.value.rows.connections.length, 1);
});

void test('Android camera submit flow scrolls a bounded pending prefix after one tap before the exact post-submit scroll', () => {
  const submit = buildAndroidCameraSubmitActions();
  const tapIndex = submit.indexOf(`id: ${JSON.stringify(ANDROID_CAMERA_UI.connectButton)}`);
  const prefixScrollIndex = submit.indexOf('- scrollUntilVisible:');
  const keyboardDismissIndex = submit.indexOf('- hideKeyboard');
  assert(keyboardDismissIndex >= 0 && keyboardDismissIndex < tapIndex);
  assert.equal((submit.match(/- hideKeyboard/gu) ?? []).length, 1);
  assert(tapIndex >= 0);
  assert(prefixScrollIndex > tapIndex);
  assert.equal((submit.match(/- tapOn:/gu) ?? []).length, 1);
  assert.equal((submit.match(/- scrollUntilVisible:/gu) ?? []).length, 1);
  assert.doesNotMatch(submit, /- extendedWaitUntil:/u);
  assert(submit.includes(`id: ${JSON.stringify(ANDROID_CAMERA_PENDING_CARD_ID_PATTERN)}`));
  assert.match(
    buildAndroidCameraPendingActions('connection-camera-1'),
    /student\.professionals\.connectionPending\.connection-camera-1/u,
  );
});

void test('Android camera pending submission rejects an existing pre-submit target before any UI action', async () => {
  await assert.rejects(
    runPendingSubmission(
      snapshot([connection('post-submit')]),
      snapshot([connection('preexisting')]),
    ),
    /pre-submit target connection must be absent/u,
  );
});

void test('Android camera pending submission rejects zero, duplicate, or foreign post-submit targets', async () => {
  for (const after of [
    snapshot(),
    snapshot([connection('first'), connection('second')]),
    snapshot([connection('foreign', { studentAuthUid: 'foreign-student' })]),
  ])
    await assert.rejects(runPendingSubmission(after), /pending target connection is not unique/u);
});

void test('Android camera pending submission keeps a failed owned UI action from producing a post-state pass', async () => {
  const input: {
    signal: AbortSignal;
    capture: Pick<AndroidCameraFrameCapture, 'execute'>;
    snapshots: Pick<AndroidCameraSnapshotSource, 'readEvidence'>;
  } = {
    signal: new AbortController().signal,
    capture: {
      execute: () => Promise.reject(new Error('owned Connect action failed')),
    },
    snapshots: {
      readEvidence: () => Promise.resolve(evidence(snapshot())),
    },
  };
  await assert.rejects(
    submitAndroidCameraPending(input, buildAndroidCameraSubmitActions()),
    /owned Connect action failed/u,
  );
});

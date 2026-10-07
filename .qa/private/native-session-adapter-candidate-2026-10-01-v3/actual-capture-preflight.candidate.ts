import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type Capture = {
  charter?: string;
  result?: string;
  cleanup?: string;
  nativePassingCases?: number;
  observations?: { hierarchyPath?: string }[];
  [key: string]: unknown;
};

const root = path.resolve(__dirname, '../../..');
const captureId = '50ddeb1f3d43a32fd441b065';
const capturePath = path.join(
  root,
  '.qa/artifacts/native-pilot',
  captureId,
  'capture.private.json',
);

async function main() {
  const capture = JSON.parse(await readFile(capturePath, 'utf8')) as Capture;
  // This is a read-only migration preflight. Preserve the legacy diagnostic and
  // report why it cannot be treated as the new explicit session charter.
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  assert.equal(capture.charter, 'auth-account');

  const requiredSessionFields = [
    'sessionAssertionSequence',
    'sessionUiObservationOrder',
    'sessionInitialAuth',
    'nativeAuthIdentityEvidence',
    'sessionSqlBefore',
    'sessionSqlAfterSignedoutRelaunch',
    'relaunchTransportRange',
    'signedOutRelaunchTransport',
    'signedOutRelaunchTransportRange',
    'sessionViewEvidence',
  ] as const;
  const missingSessionFields = requiredSessionFields.filter(
    (field) => !Object.hasOwn(capture, field),
  );
  assert.deepEqual(missingSessionFields, [...requiredSessionFields]);

  console.log(
    JSON.stringify(
      {
        kind: 'private-native-session-v3-preflight-not-behavior-pass',
        captureId,
        capturePath,
        original: {
          charter: capture.charter,
          result: capture.result,
          cleanup: capture.cleanup,
          nativePassingCases: capture.nativePassingCases,
        },
        candidateCharter: {
          expected: 'session',
          outcome: 'rejected-legacy-charter',
          missingSessionFields,
        },
        legacyEvidencePreserved: true,
        observedOrder: (capture.observations ?? []).map((row) => row.hierarchyPath ?? '<missing>'),
        note: 'The v3 session charter must be run separately; this sealed auth-account diagnostic is not relabeled.',
      },
      null,
      2,
    ),
  );
}

void main();

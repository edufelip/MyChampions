import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type Capture = {
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

  // Keep the original observation result intact. This is a seam preflight, not a
  // replacement receipt and not a relabeling of the sealed diagnostic.
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);

  const sqlProvenanceFields = ['sessionSqlBefore', 'sessionSqlAfterSignedoutRelaunch'] as const;
  const missingSqlFields = sqlProvenanceFields.filter((field) => !Object.hasOwn(capture, field));
  assert.deepEqual(missingSqlFields, [...sqlProvenanceFields]);

  const expectedOrder = [
    'entry-hierarchy.json',
    'restored-home-hierarchy.json',
    'account-hierarchy.json',
    'signout-confirm-hierarchy.json',
    'cancel-signout-hierarchy.json',
    'signed-out-hierarchy.json',
    'signed-out-relaunch-hierarchy.json',
  ];
  const observedOrder = (capture.observations ?? []).map((row) => row.hierarchyPath ?? '<missing>');
  let previous = -1;
  const orderMatches = expectedOrder.every((required) => {
    const index = observedOrder.indexOf(required);
    const matches = index > previous;
    previous = index;
    return matches;
  });

  console.log(
    JSON.stringify(
      {
        kind: 'private-native-session-capture-preflight-not-behavior-pass',
        captureId,
        capturePath,
        original: {
          result: capture.result,
          cleanup: capture.cleanup,
          nativePassingCases: capture.nativePassingCases,
        },
        candidateSeam: {
          outcome: 'rejected',
          rejection: 'missing-exactly-two-session-sql-provenance-fields',
          missingSqlFields,
        },
        transportSlice: {
          fieldPresent: Object.hasOwn(capture, 'signedOutRelaunchTransport'),
          status: 'pending-capture-seam',
        },
        orderedSessionContract: {
          status: orderMatches ? 'unverified' : 'pending-source-order',
          expectedOrder,
          observedOrder,
        },
      },
      null,
      2,
    ),
  );
}

void main();

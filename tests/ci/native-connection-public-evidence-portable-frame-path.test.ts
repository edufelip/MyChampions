import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  nativeConnectionEvidenceReferences,
  nativeConnectionFrameLabelFromReference,
} from '../../scripts/testing/native-connection-public-evidence-core';
import { readNativeEvidence } from '../../scripts/testing/native-view-evidence';

type Platform = 'ios' | 'android';
type EvidenceReference = { path: string; redacted: boolean };
type ProducerFrame = {
  viewId: string;
  screenshotPath: string;
  hierarchyPath: string;
};

const assertionIds = [
  'NAT-connection-normal-entry',
  'NAT-connection-submit-pending',
  'NAT-connection-pending-state',
  'NAT-connection-confirm-active',
  'NAT-connection-active-student',
  'NAT-connection-active-roster',
  'NAT-connection-unrelated-state',
] as const;

// These are the producer names and view-shape fields retained by the v12 controller.
// Contents are deliberately redacted synthetic bytes for this source-only contract test.
const producerFrames: readonly ProducerFrame[] = [
  {
    viewId: 'SCR-pro-home',
    screenshotPath: 'coach-home.png',
    hierarchyPath: 'coach-home-hierarchy.json',
  },
  {
    viewId: 'SCR-pro-home',
    screenshotPath: 'connection-coach-invite.png',
    hierarchyPath: 'connection-coach-invite-hierarchy.json',
  },
  {
    viewId: 'SCR-pro-pending',
    screenshotPath: 'connection-normal-coach-pending.png',
    hierarchyPath: 'connection-normal-coach-pending-hierarchy.json',
  },
  {
    viewId: 'SCR-pro-roster',
    screenshotPath: 'connection-normal-coach-roster.png',
    hierarchyPath: 'connection-normal-coach-roster-hierarchy.json',
  },
  {
    viewId: 'SCR-student-professionals',
    screenshotPath: 'connection-student-entry.png',
    hierarchyPath: 'connection-student-entry-hierarchy.json',
  },
  {
    viewId: 'STATE-connection-pending',
    screenshotPath: 'connection-submit.png',
    hierarchyPath: 'connection-submit-hierarchy.json',
  },
  {
    viewId: 'STATE-connection-pending',
    screenshotPath: 'connection-student-pending.png',
    hierarchyPath: 'connection-student-pending-hierarchy.json',
  },
  {
    viewId: 'SCR-pro-roster',
    screenshotPath: 'connection-coach-pending-roster.png',
    hierarchyPath: 'connection-coach-pending-roster-hierarchy.json',
  },
  {
    viewId: 'SCR-pro-roster',
    screenshotPath: 'connection-coach-no-active-roster.png',
    hierarchyPath: 'connection-coach-no-active-roster-hierarchy.json',
  },
  {
    viewId: 'SCR-pro-pending',
    screenshotPath: 'connection-coach-pending.png',
    hierarchyPath: 'connection-coach-pending-hierarchy.json',
  },
  {
    viewId: 'SCR-pro-pending',
    screenshotPath: 'connection-confirm.png',
    hierarchyPath: 'connection-confirm-hierarchy.json',
  },
  {
    viewId: 'SCR-student-professionals',
    screenshotPath: 'connection-student-active.png',
    hierarchyPath: 'connection-student-active-hierarchy.json',
  },
  {
    viewId: 'SCR-pro-roster',
    screenshotPath: 'connection-coach-roster.png',
    hierarchyPath: 'connection-coach-roster-hierarchy.json',
  },
];

const producerPaths = new Set(
  producerFrames.flatMap((frame) => [frame.screenshotPath, frame.hierarchyPath]),
);

async function makeOwnedFrameRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-connection-frame-contract-')),
  );
  await chmod(root, 0o700);
  const redactedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const redactedHierarchy = Buffer.from('{"attributes":{},"children":[]}\n');
  for (const relative of producerPaths) {
    const bytes = relative.endsWith('.png') ? redactedPng : redactedHierarchy;
    await writeFile(path.join(root, relative), bytes, { mode: 0o600 });
    await chmod(path.join(root, relative), 0o600);
  }
  return root;
}

function projectedReferences(platform: Platform): EvidenceReference[] {
  return assertionIds.flatMap((assertionId) =>
    nativeConnectionEvidenceReferences(assertionId, 'ui', platform),
  );
}

function assertProducerPair(label: string): void {
  assert(producerPaths.has(`${label}.png`));
  assert(producerPaths.has(`${label}-hierarchy.json`));
}

void test('all seven connection assertion sets use owned producer names on both platforms', async () => {
  const root = await makeOwnedFrameRoot();
  try {
    const ios = projectedReferences('ios');
    const android = projectedReferences('android');
    assert.deepEqual(android, ios);
    assert.equal(ios.length, 26);
    assert.equal(new Set(ios.map((reference) => reference.path)).size, 26);
    const labels = [] as string[];
    for (const reference of ios) {
      const bytes = readNativeEvidence(
        root,
        reference.path,
        reference.path.endsWith('-hierarchy.json'),
      );
      assert(bytes.length > 0);
      assert(!reference.path.endsWith('-png'), 'legacy <label>-png projection must stay rejected');
      const label = nativeConnectionFrameLabelFromReference(reference.path);
      assertProducerPair(label);
      labels.push(label);
    }
    assert.equal(new Set(labels).size, 13);
    assert.equal(ios.filter((reference) => reference.path.endsWith('.png')).length, 13);
    assert.equal(ios.filter((reference) => reference.path.endsWith('-hierarchy.json')).length, 13);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { androidSessionPublicAssertions } from '../../scripts/testing/native-android-session-public-receipt';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';

const repositoryRoot = path.resolve(__dirname, '../..');
const captureRunId = 'a'.repeat(24);
const labels = [
  'entry',
  'coach-home',
  'auth-restored-home',
  'auth-account',
  'auth-account-identity',
  'auth-signout-open',
  'auth-signout-cancelled',
  'auth-signout-reopen',
  'auth-signed-out',
  'auth-signed-out-relaunch',
];

async function stagedFixture() {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'android-session-receipt-'));
  const staged = path.join(outputRoot, 'evidence', captureRunId);
  await mkdir(path.join(staged, 'android-session-checkpoints', 'before-login'), {
    recursive: true,
  });
  for (const label of labels) {
    await writeFile(path.join(staged, `${label}.png`), 'png');
    await writeFile(path.join(staged, `${label}-hierarchy.json`), '{}');
  }
  await writeFile(path.join(staged, 'transport-observations.private.json'), '[]');
  await writeFile(path.join(staged, 'native-auth-identities.private.json'), '[]');
  await writeFile(
    path.join(staged, 'android-session-checkpoints', 'before-login', 'domain.json'),
    '{}',
  );
  return { outputRoot, staged };
}

async function selection() {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
  return selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-session-android',
      mode: 'integration',
    },
    inventory,
    repositoryRoot,
  );
}

void test('Android session receipt binds every declared assertion to staged evidence', async () => {
  const { outputRoot } = await stagedFixture();
  try {
    const rows = await androidSessionPublicAssertions({
      outputRoot,
      captureRunId,
      selection: await selection(),
    });
    assert.deepEqual(
      rows.map((row) => row.id),
      [
        'NAT-session-login',
        'NAT-session-restore',
        'NAT-session-account',
        'NAT-session-signout',
        'NAT-session-signed-out-relaunch',
        'NAT-session-unrelated-state',
      ],
    );
    for (const row of rows) {
      assert.equal(row.outcome, 'passed');
      assert(row.requirementRefs.length > 0);
      assert(row.evidencePaths.every((p) => p.startsWith(`evidence/${captureRunId}/`)));
    }
    assert.deepEqual(rows.at(-1)!.evidencePaths, [
      `evidence/${captureRunId}/android-session-checkpoints/before-login/domain.json`,
    ]);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

void test('Android session receipt refuses an assertion whose staged evidence is missing', async () => {
  const { outputRoot, staged } = await stagedFixture();
  try {
    await rm(path.join(staged, 'auth-signed-out-relaunch.png'));
    await assert.rejects(
      androidSessionPublicAssertions({ outputRoot, captureRunId, selection: await selection() }),
      /ENOENT/,
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

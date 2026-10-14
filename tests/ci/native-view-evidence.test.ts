import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, linkSync, renameSync, truncateSync } from 'node:fs';
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  validateNativeViewFiles,
  validateNativeRuntimeFrameFiles,
  readNativeEvidence,
  readNativeEvidenceObservation,
  readNativeEvidenceForTest,
  nativeViewFingerprint,
  validateNativeViewReceipt,
  validateNativeTrainingPreparation,
} from '../../scripts/testing/native-view-evidence';
import type { ViewEvidence, NativeViewReceipt } from '../../scripts/testing/native-view-evidence';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

void test('view evidence binds reviewed PNG and exact actual-tree attributes, with no behavioral claim', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-evidence-')));
  const other = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-outside-')));
  try {
    await chmod(root, 0o700);
    // Synthetic fixture proves file/selector validation only, never device execution.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD3sAAAAASUVORK5CYII=',
      'base64',
    );
    const tree = JSON.stringify({
      attributes: {},
      children: [{ attributes: { 'resource-id': 'auth.signIn.emailInput' }, children: [] }],
    });
    await writeFile(path.join(root, 'entry.png'), png, { mode: 0o644 });
    await writeFile(path.join(root, 'tree.json'), tree, { mode: 0o600 });
    const view: ViewEvidence = {
      viewId: 'SCR-sign-in',
      screenshotPath: 'entry.png',
      screenshotHash: hash(png),
      hierarchyPath: 'tree.json',
      hierarchyHash: hash(tree),
      reviewed: true,
    };
    assert.deepEqual(validateNativeViewFiles(root, [view], ['SCR-sign-in']), ['SCR-sign-in']);
    assert.throws(
      () => validateNativeViewFiles(root, [{ ...view, reviewed: false }], ['SCR-sign-in']),
      /review/,
    );
    const runtime = { ...view, reviewed: false };
    assert.deepEqual(validateNativeRuntimeFrameFiles(root, [runtime], ['SCR-sign-in']), [
      'SCR-sign-in',
    ]);
    assert.throws(
      () => validateNativeRuntimeFrameFiles(root, [view], ['SCR-sign-in']),
      /must not claim/,
    );
    assert.throws(
      () => validateNativeRuntimeFrameFiles(root, [runtime, runtime], ['SCR-sign-in']),
      /duplicate/,
    );
    assert.throws(
      () =>
        validateNativeRuntimeFrameFiles(
          root,
          [{ ...runtime, screenshotHash: '0'.repeat(64) }],
          ['SCR-sign-in'],
        ),
      /bytes changed/,
    );
    assert.throws(
      () => validateNativeViewFiles(root, [{ ...view, viewId: 'SCR-account' }], ['SCR-sign-in']),
      /unmapped/,
    );
    assert.throws(() => validateNativeViewFiles(root, [view, view], ['SCR-sign-in']), /duplicate/);
    assert.throws(
      () =>
        validateNativeViewFiles(
          root,
          [{ ...view, screenshotHash: '0'.repeat(64) }],
          ['SCR-sign-in'],
        ),
      /bytes changed/,
    );
    const wrongTree = JSON.stringify({
      attributes: { text: 'auth.signIn.emailInput' },
      children: [],
    });
    await writeFile(path.join(root, 'tree.json'), wrongTree);
    assert.throws(
      () =>
        validateNativeViewFiles(
          root,
          [{ ...view, hierarchyHash: hash(wrongTree) }],
          ['SCR-sign-in'],
        ),
      /exact actual-tree/,
    );
    await writeFile(path.join(other, 'foreign.json'), tree, { mode: 0o600 });
    await symlink(path.join(other, 'foreign.json'), path.join(root, 'linked.json'));
    assert.throws(() => readNativeEvidence(root, 'linked.json', true), /symlink/);
    assert.throws(() => readNativeEvidence(root, '../foreign.json'), /escaped/);
    assert.throws(() => readNativeEvidence(root, path.join(root, 'tree.json')), /relative/);
    assert.throws(() => readNativeEvidence(root, 'missing.json'), /ENOENT/);
    await chmod(root, 0o755);
    assert.throws(() => readNativeEvidence(root, 'tree.json'), /private/);
  } finally {
    await rm(root, { recursive: true });
    await rm(other, { recursive: true });
  }
});

void test('bounded descriptor reader rejects growth, rename, hardlink and mode drift around actual reads', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-evidence-reader-')));
  await chmod(root, 0o700);
  const bytes = Buffer.from('owned bounded evidence');
  try {
    const oversized = path.join(root, 'oversized.private.json');
    await writeFile(oversized, '', { mode: 0o600 });
    truncateSync(oversized, 8 * 1024 * 1024 + 1);
    assert.throws(() => readNativeEvidence(root, 'oversized.private.json', true), /bounded/);

    const grown = path.join(root, 'grown.private.json');
    await writeFile(grown, bytes, { mode: 0o600 });
    let afterRead = false;
    assert.throws(
      () =>
        readNativeEvidenceForTest(root, 'grown.private.json', true, {
          afterRead: () => {
            afterRead = true;
            appendFileSync(grown, Buffer.from('late growth'));
          },
        }),
      /changed during read/,
    );
    assert.equal(afterRead, true);

    const renamed = path.join(root, 'renamed.private.json');
    const moved = path.join(root, 'renamed.moved.private.json');
    await writeFile(renamed, bytes, { mode: 0o600 });
    assert.throws(
      () =>
        readNativeEvidenceForTest(root, 'renamed.private.json', true, {
          beforeRead: () => renameSync(renamed, moved),
        }),
      /changed during read|ENOENT/,
    );

    const linked = path.join(root, 'linked.private.json');
    const alias = path.join(root, 'linked.alias.private.json');
    await writeFile(linked, bytes, { mode: 0o600 });
    assert.throws(
      () =>
        readNativeEvidenceForTest(root, 'linked.private.json', true, {
          afterRead: () => linkSync(linked, alias),
        }),
      /changed during read/,
    );

    const modeDrift = path.join(root, 'mode-drift.private.json');
    await writeFile(modeDrift, bytes, { mode: 0o600 });
    assert.throws(
      () =>
        readNativeEvidenceForTest(root, 'mode-drift.private.json', true, {
          afterRead: () => chmodSync(modeDrift, 0o644),
        }),
      /changed during read/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('verified observation exposes the descriptor identity used by the bounded read', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-native-evidence-observation-')),
  );
  await chmod(root, 0o700);
  const relative = 'observation.private.json';
  try {
    await writeFile(path.join(root, relative), Buffer.from('{"ok":true}\n'), { mode: 0o600 });
    const observed = readNativeEvidenceObservation(root, relative, true);
    assert.equal(observed.bytes.toString(), '{"ok":true}\n');
    assert.equal(observed.identity.uid, process.getuid?.());
    assert.equal(observed.identity.nlink, 1);
    assert.equal(observed.identity.mode & 0o777, 0o600);
    assert.equal(observed.identity.size, observed.bytes.length);
    assert.ok(Number.isSafeInteger(observed.identity.dev));
    assert.ok(Number.isSafeInteger(observed.identity.ino));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const platform of ['android', 'ios'] as const) {
  void test(`${platform} training observation requires owned unchanged SQL, exact quantity and both normal catalog reads`, async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-training-evidence-')));
    await chmod(root, 0o700);
    const runId = 'a'.repeat(24);
    const exerciseId = '00000000-0000-4000-8000-000000000001';
    const preparation = {
      requirementRefs: ['SC-208', 'TC-303', 'BR-293', 'BR-294', 'UC-002.7'],
      catalogExerciseId: exerciseId,
      quantityObserved: true,
      ownedSqlBeforeAfterUnchanged: true,
      snapshotPaths: ['draft-before.private.json', 'draft-after.private.json'],
    };
    const snapshot = {
      schemaVersion: 1,
      runId,
      scope: `native-entry-${platform}`,
      readOnly: true,
      trainingPlans: [
        {
          id: 'seeded-plan',
          studentAuthUid: 'coach',
          ownerProfessionalUid: 'coach',
          sourceKind: 'predefined',
          name: 'Seeded plan',
          isArchived: false,
          isDraft: false,
          lifecycleConnectionId: null,
          createdAt: '2026-09-29T00:00:00Z',
          updatedAt: '2026-09-29T00:00:00Z',
          sessions: [],
        },
      ],
      connections: [],
    };
    const quantity = {
      attributes: {
        'resource-id': 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
        [platform === 'ios' ? 'accessibilityText' : 'text']: '3x8',
      },
      children: [],
    };
    const transport = [
      {
        method: 'POST',
        pathHash: hash('/integrations/exercise/search'),
        status: 200,
        outcome: 'forwarded',
        requestProfile: 'native',
      },
      {
        method: 'GET',
        pathHash: hash(`/integrations/exercise/exercises/${exerciseId}`),
        status: 200,
        outcome: 'forwarded',
        requestProfile: 'native',
      },
    ];
    const put = async (name: string, value: unknown) =>
      writeFile(path.join(root, name), JSON.stringify(value), { mode: 0o600 });
    const check = () =>
      validateNativeTrainingPreparation(root, platform, runId, preparation, transport);
    try {
      await put('draft-before.private.json', snapshot);
      await put('draft-after.private.json', snapshot);
      await put('draft-preview-hierarchy.json', quantity);
      check(); // Synthetic boundary test, not a device or persistence execution receipt.
      for (const invalid of [
        { ...snapshot, runId: 'b'.repeat(24) },
        { ...snapshot, scope: 'other' },
        { ...snapshot, trainingPlans: [] },
        { ...snapshot, readOnly: false },
        { ...snapshot, trainingPlans: [{ ...snapshot.trainingPlans[0], name: 'Premature write' }] },
      ]) {
        await put('draft-after.private.json', invalid);
        assert.throws(check, /snapshot|SQL/);
      }
      await put('draft-after.private.json', snapshot);
      for (const attributes of [
        {
          'resource-id': 'unrelated.quantity',
          [platform === 'ios' ? 'accessibilityText' : 'text']: '3x8',
        },
        {
          'resource-id': quantity.attributes['resource-id'],
          [platform === 'ios' ? 'accessibilityText' : 'text']: '3x9',
        },
        {
          'resource-id': quantity.attributes['resource-id'],
          [platform === 'ios' ? 'text' : 'accessibilityText']: '3x8',
        },
        { 'resource-id': quantity.attributes['resource-id'], label: '3x8' },
      ]) {
        await put('draft-preview-hierarchy.json', { attributes });
        assert.throws(check, /exact item/);
      }
      await put('draft-preview-hierarchy.json', quantity);
      await put('draft-preview-hierarchy.json', {
        attributes: { 'resource-id': quantity.attributes['resource-id'] },
        children: [{ attributes: { [platform === 'ios' ? 'accessibilityText' : 'text']: '3x8' } }],
      });
      assert.throws(check, /exact item/);
      await put('draft-preview-hierarchy.json', quantity);
      const foreignScope = {
        ...snapshot,
        scope: `native-entry-${platform === 'ios' ? 'android' : 'ios'}`,
      };
      await put('draft-before.private.json', foreignScope);
      await put('draft-after.private.json', foreignScope);
      assert.throws(check, /seeded owned scope/);
      await put('draft-before.private.json', snapshot);
      await put('draft-after.private.json', snapshot);
      for (const invalid of [
        transport.slice(0, 1),
        transport.slice(1),
        transport.map((row) => ({ ...row, requestProfile: 'browser' })),
        transport.map((row) => ({ ...row, outcome: 'fault-injected' })),
        transport.map((row) => ({ ...row, status: 503 })),
      ])
        assert.throws(
          () => validateNativeTrainingPreparation(root, platform, runId, preparation, invalid),
          /catalog transport/,
        );
      for (const invalid of [
        { ...preparation, catalogExerciseId: 'other' },
        { ...preparation, quantityObserved: false },
        { ...preparation, requirementRefs: [] },
        { ...preparation, snapshotPaths: ['../foreign.json'] },
      ])
        assert.throws(
          () => validateNativeTrainingPreparation(root, platform, runId, invalid, transport),
          /scope/,
        );
      check();
    } finally {
      await rm(root, { recursive: true });
    }
  });
}

void test('observation fingerprint changes with fixture, build, reviewed evidence or governing source', async () => {
  const receipt: NativeViewReceipt = {
    id: 'REC-unit',
    timestamp: '2026-09-29T00:00:00Z',
    commit: 'a'.repeat(40),
    result: 'observed',
    platform: 'ios',
    build: 'b'.repeat(64),
    device: 'test-device',
    fixtureRef: 'fixture',
    artifactRoot: '.qa/artifacts/native-pilot/' + 'c'.repeat(24),
    evidencePaths: [],
    inputFingerprint: 'd'.repeat(64),
    captureHash: 'e'.repeat(64),
    cleanupHash: 'f'.repeat(64),
    viewEvidence: [
      {
        viewId: 'SCR-sign-in',
        screenshotPath: 'entry.png',
        screenshotHash: '1'.repeat(64),
        hierarchyPath: 'tree.json',
        hierarchyHash: '2'.repeat(64),
        reviewed: true,
      },
    ],
  };
  const declaration = {
    views: [{ id: 'SCR-sign-in', sourceRefs: ['SRC-auth'] }],
    sources: [{ id: 'SRC-auth', paths: ['app/auth/sign-in.tsx'], revision: '3'.repeat(64) }],
  };
  const before = nativeViewFingerprint(receipt, declaration);
  for (const changed of [
    { ...receipt, fixtureRef: 'other' },
    { ...receipt, build: '4'.repeat(64) },
    { ...receipt, viewEvidence: [{ ...receipt.viewEvidence[0], hierarchyHash: '5'.repeat(64) }] },
    { ...receipt, auxiliaryEvidence: [{ path: 'bootstrap.private.log', sha256: '7'.repeat(64) }] },
  ])
    assert.notEqual(nativeViewFingerprint(changed, declaration), before);
  assert.notEqual(
    nativeViewFingerprint(receipt, {
      ...declaration,
      sources: [{ ...declaration.sources[0], revision: '6'.repeat(64) }],
    }),
    before,
  );
  const widerDeclaration = {
    ...declaration,
    views: [...declaration.views, { id: 'SCR-account', sourceRefs: ['SRC-account'] }],
    sources: [
      ...declaration.sources,
      { id: 'SRC-account', paths: ['app/settings/account.tsx'], revision: '7'.repeat(64) },
    ],
  };
  const widerFingerprint = nativeViewFingerprint(receipt, widerDeclaration);
  assert.notEqual(
    nativeViewFingerprint(receipt, {
      ...widerDeclaration,
      sources: [
        widerDeclaration.sources[0],
        { ...widerDeclaration.sources[1], revision: '8'.repeat(64) },
      ],
    }),
    widerFingerprint,
    'A checked source must invalidate the receipt even when its view was not captured',
  );
  assert.notEqual(
    nativeViewFingerprint(receipt, {
      ...widerDeclaration,
      views: [
        { ...widerDeclaration.views[0], sourceRefs: ['SRC-account'] },
        widerDeclaration.views[1],
      ],
    }),
    widerFingerprint,
    'Changed view/source traceability must receive a distinct immutable output name',
  );
  await assert.rejects(
    validateNativeViewReceipt({ ...receipt, platform: 'web' }, process.cwd(), declaration),
    /exact target/,
  );
  await assert.rejects(
    validateNativeViewReceipt({ ...receipt, result: 'passed' }, process.cwd(), declaration),
    /exact target/,
  );
  await assert.rejects(
    validateNativeViewReceipt(
      { ...receipt, artifactRoot: '../server' },
      process.cwd(),
      declaration,
    ),
    /exact target/,
  );
});

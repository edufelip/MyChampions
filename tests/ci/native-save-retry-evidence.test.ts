import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  nativeSaveRetryAuxiliaryFrames,
  nativeSaveRetryRuntimeFrames,
  nativeSaveRetryReviewedFramesPath,
  nativeSaveRetryRuntimeFramesPath,
  nativeSaveRetrySnapshotPaths,
  validateIosSaveRetryPreparation,
} from '../../scripts/testing/native-view-evidence';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

void test('native save/retry qualification rejects altered SQL, lost drafts, blocked navigation, unreviewed frames and false transport', async () => {
  // Synthetic guard proof only; no device, transition or behavior result.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'native-retry-evidence-')));
  await chmod(root, 0o700);
  const runId = 'a'.repeat(24);
  const createdId = 'training_plan_11111111-1111-4111-8111-111111111111';
  const oldId = 'training_plan_22222222-2222-4222-8222-222222222222';
  const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
  const row = {
    requirementRefs: ['SC-208', 'TC-278', 'BR-293', 'BR-294', 'UC-002.7', 'BL-018/P4-save-retry'],
    createdId,
    accountUid: 'coach',
    attemptId: `native-save-${runId}`,
    injectedCount: 1,
    snapshotPaths: nativeSaveRetrySnapshotPaths,
    scope: 'raw-native-save-error-retained-draft-and-retry-observation; no qualified behavior pass',
  };
  const before: OwnedDomainSnapshot = {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    connections: [],
    trainingPlans: [
      {
        id: oldId,
        studentAuthUid: 'coach',
        ownerProfessionalUid: 'coach',
        sourceKind: 'predefined',
        name: 'Seeded',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        createdAt: '2026-09-29T00:00:00Z',
        updatedAt: '2026-09-29T00:00:00Z',
        sessions: [],
      },
    ],
  };
  const after: OwnedDomainSnapshot = {
    ...before,
    trainingPlans: [
      ...before.trainingPlans,
      {
        ...before.trainingPlans[0],
        id: createdId,
        name: 'Native QA Draft',
        sessions: [
          {
            name: 'Strength',
            items: [
              {
                name: 'en QA Exercise 1',
                exerciseId: '00000000-0000-4000-8000-000000000001',
                quantity: '3x8',
              },
            ],
          },
        ],
      },
    ],
  };
  const node = (attributes: Record<string, string>, children: unknown[] = []) => ({
    attributes,
    children,
  });
  const name = {
    'resource-id': 'pro.training_plan.name',
    value: 'Native QA Draft',
    enabled: 'true',
  };
  const quantity = {
    'resource-id': 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
    accessibilityText: '3x8',
  };
  const save = { 'resource-id': 'pro.training_plan.saveButton', enabled: 'true' };
  const draft = (saveEnabled: boolean) =>
    node({ 'resource-id': 'pro.training_plan.screen' }, [
      node(name),
      node({ ...save, enabled: String(saveEnabled) }),
      node({ 'resource-id': 'pro.training_plan.sessionRow.Strength' }, [node(quantity)]),
    ]);
  const trees: Record<string, unknown> = {
    'save-error': node({ accessibilityText: enUS['pro.plan.error.save'] }, [
      node({ accessibilityText: 'OK', enabled: 'true' }),
    ]),
    'save-retained': draft(true),
    'save-retry-reopened': draft(false),
    'save-retry-library': node({}, [
      node({ 'resource-id': 'pro.library.training.create' }),
      node({ 'resource-id': `pro.library.training.row.${createdId}` }),
    ]),
  };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3/8AAAAASUVORK5CYII=',
    'base64',
  );
  const routes = [
    ['POST', '/auth/email/sign-in', 201],
    ['GET', '/plans/predefined', 200],
    ['POST', '/integrations/exercise/search', 200],
    ['GET', '/integrations/exercise/exercises/00000000-0000-4000-8000-000000000001', 200],
    ['POST', '/plans/training', 503],
    ['POST', '/plans/training', 201],
    ['PATCH', `/plans/training/${createdId}`, 200],
    ['GET', `/plans/training/${createdId}`, 200],
  ] as const;
  const transport = routes.map(([method, route, status], index) => ({
    requestId: index + 1,
    method,
    pathHash: hash(route),
    status,
    outcome: status === 503 ? 'injected' : 'forwarded',
    requestProfile: 'native',
    requestOrigin: null,
    faultAttemptId: status === 503 ? row.attemptId : null,
    targetOrigin: 'http://127.0.0.1:45000',
  }));
  const put = (file: string, value: unknown) =>
    writeFile(path.join(root, file), JSON.stringify(value), { mode: 0o600 });
  const reviews = () =>
    nativeSaveRetryAuxiliaryFrames.map(([label, viewId]) => ({
      viewId,
      reviewed: true,
      screenshotPath: `${label}.png`,
      screenshotHash: hash(png),
      hierarchyPath: `${label}-hierarchy.json`,
      hierarchyHash: hash(JSON.stringify(trees[label])),
    }));
  const runtimeReviews = () =>
    nativeSaveRetryRuntimeFrames.map(([label, viewId]) => ({
      viewId,
      reviewed: false,
      screenshotPath: `${label}.png`,
      screenshotHash: hash(png),
      hierarchyPath: `${label}-hierarchy.json`,
      hierarchyHash: hash(JSON.stringify(trees[label])),
    }));
  const check = (
    metadata: unknown = row,
    records: unknown = transport,
    frameMode: 'reviewed-inventory' | 'runtime-captured' = 'reviewed-inventory',
  ) => validateIosSaveRetryPreparation(root, runId, metadata, records, frameMode);
  const rejectTree = async (label: string, value: unknown) => {
    const old = trees[label];
    trees[label] = value;
    await put(`${label}-hierarchy.json`, value);
    await put(nativeSaveRetryReviewedFramesPath, reviews());
    assert.throws(() => check());
    trees[label] = old;
    await put(`${label}-hierarchy.json`, old);
    await put(nativeSaveRetryReviewedFramesPath, reviews());
    check();
  };
  const rejectSnapshot = async (index: number, change: (value: OwnedDomainSnapshot) => void) => {
    const original = index < 2 ? before : after;
    const bad = structuredClone(original);
    change(bad);
    await put(nativeSaveRetrySnapshotPaths[index], bad);
    assert.throws(() => check());
    await put(nativeSaveRetrySnapshotPaths[index], original);
    check();
  };
  try {
    for (const [index, file] of nativeSaveRetrySnapshotPaths.entries())
      await put(file, index < 2 ? before : after);
    for (const [label, value] of Object.entries(trees)) {
      await put(`${label}-hierarchy.json`, value);
      await writeFile(path.join(root, `${label}.png`), png, { mode: 0o600 });
    }
    await put(nativeSaveRetryReviewedFramesPath, reviews());
    check();
    await put(nativeSaveRetryRuntimeFramesPath, runtimeReviews());
    check(row, transport, 'runtime-captured');
    await put(
      nativeSaveRetryRuntimeFramesPath,
      runtimeReviews().map((review) => ({ ...review, reviewed: true })),
    );
    assert.throws(() => check(row, transport, 'runtime-captured'), /must not claim/);
    await put(nativeSaveRetryRuntimeFramesPath, runtimeReviews());
    await put(
      nativeSaveRetryRuntimeFramesPath,
      runtimeReviews().map((review, index) =>
        index === 0 ? { ...review, screenshotHash: 'f'.repeat(64) } : review,
      ),
    );
    assert.throws(() => check(row, transport, 'runtime-captured'), /bytes changed/);
    await put(nativeSaveRetryRuntimeFramesPath, runtimeReviews());
    await put(nativeSaveRetryRuntimeFramesPath, runtimeReviews().slice(1));
    assert.throws(() => check(row, transport, 'runtime-captured'), /exact auxiliary frame reviews/);
    await put(nativeSaveRetryRuntimeFramesPath, runtimeReviews());
    await writeFile(path.join(root, 'save-retained.png'), Buffer.from('corrupt'), { mode: 0o600 });
    assert.throws(() => check(row, transport, 'runtime-captured'), /bytes changed/);
    await writeFile(path.join(root, 'save-retained.png'), png, { mode: 0o600 });
    await rm(path.join(root, nativeSaveRetryRuntimeFramesPath));
    assert.throws(() => check(row, transport, 'runtime-captured'), /ENOENT/);
    await put(nativeSaveRetryRuntimeFramesPath, runtimeReviews());
    assert.throws(
      () =>
        validateIosSaveRetryPreparation(
          path.join(root, 'missing-root'),
          runId,
          row,
          transport,
          'unsupported' as never,
        ),
      /Unsupported native save\/retry frame evidence mode/,
    );
    assert.throws(
      () =>
        check(
          row,
          transport.map((record) =>
            record.method === 'PATCH' ? { ...record, status: 500 } : record,
          ),
          'runtime-captured',
        ),
      /exact normal session PATCH/,
    );
    check(row, transport, 'runtime-captured');
    for (const metadata of [
      null,
      {},
      { ...row, requirementRefs: [] },
      { ...row, createdId: oldId },
      { ...row, accountUid: 'foreign' },
      { ...row, attemptId: 'foreign' },
      { ...row, injectedCount: 0 },
      { ...row, snapshotPaths: [] },
      { ...row, scope: 'behavior-passed' },
    ])
      assert.throws(() => check(metadata));
    await rejectSnapshot(0, (v) => {
      v.runId = 'b'.repeat(24);
    });
    await rejectSnapshot(1, (v) => {
      v.trainingPlans[0].name = 'Mutated during failure';
    });
    await rejectSnapshot(2, (v) => {
      v.trainingPlans[0].name = 'Mutated prior plan';
    });
    await rejectSnapshot(2, (v) => {
      v.trainingPlans.push(structuredClone(v.trainingPlans[1]));
    });
    await rejectSnapshot(2, (v) => {
      v.trainingPlans[1].ownerProfessionalUid = 'foreign';
    });
    await rejectSnapshot(2, (v) => {
      v.scope = 'foreign';
    });
    await rejectSnapshot(3, (v) => {
      v.trainingPlans[1].name = 'Changed on reopen';
    });
    await rejectTree(
      'save-error',
      node({}, [
        node({ accessibilityText: enUS['pro.plan.error.save'] }),
        node({ accessibilityText: 'OK', enabled: 'true' }),
      ]),
    );
    await rejectTree(
      'save-error',
      node({ accessibilityText: enUS['pro.plan.error.save'] }, [
        node({ accessibilityText: 'OK', enabled: 'false' }),
      ]),
    );
    await rejectTree(
      'save-retained',
      node({ 'resource-id': 'pro.training_plan.screen' }, [
        node({ ...name, value: 'Lost' }),
        node(save),
      ]),
    );
    await rejectTree('save-retained', draft(false));
    await rejectTree(
      'save-retained',
      node({ accessibilityText: enUS['pro.plan.discard.title'] }, [draft(true)]),
    );
    await rejectTree('save-retry-reopened', draft(true));
    await rejectTree(
      'save-retry-library',
      node({}, [
        node({ 'resource-id': 'pro.library.training.create' }),
        node({ 'resource-id': `pro.library.training.row.${oldId}` }),
      ]),
    );
    await rejectTree(
      'save-retry-library',
      node({ accessibilityText: enUS['pro.plan.discard.title'] }, [trees['save-retry-library']]),
    );
    for (const bad of [
      [],
      reviews().reverse(),
      reviews().map((r) => ({ ...r, reviewed: false })),
      reviews().map((r) => ({ ...r, screenshotHash: 'f'.repeat(64) })),
    ]) {
      await put(nativeSaveRetryReviewedFramesPath, bad);
      assert.throws(() => check());
    }
    await put(nativeSaveRetryReviewedFramesPath, reviews());
    check();
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
      assert.throws(() =>
        check(
          row,
          transport.filter((_, i) => i !== index),
        ),
      );
      for (const change of [
        { requestProfile: 'browser' },
        { requestOrigin: 'http://127.0.0.1:45001' },
        { targetOrigin: 'http://127.0.0.1:45002' },
        { outcome: 'upstream-failed' },
        { status: 500 },
      ]) {
        const bad = transport.map((r, i) => (i === index ? { ...r, ...change } : r));
        assert.throws(() => check(row, bad));
      }
    }
    for (const records of [
      null,
      [...transport, { ...transport[5], requestId: 9 }],
      [...transport, { ...transport[6], requestId: 9 }],
      transport.map((r) => (r.method === 'PATCH' ? { ...r, method: 'DELETE' } : r)),
      transport.map((r) => (r.method === 'PATCH' ? { ...r, requestId: 9 } : r)),
      transport.map((r) => (r.method === 'PATCH' ? { ...r, requestId: 0 } : r)),
      transport.map((r) => ({ ...r, requestId: Infinity })),
      transport.map((r) => ({ ...r, requestId: 1 })),
      transport.map((r) => (r.status === 503 ? { ...r, faultAttemptId: 'foreign' } : r)),
      transport.map((r) => (r.status === 503 ? { ...r, outcome: 'forwarded' } : r)),
      transport.map((r) => (r.requestId === 7 ? { ...r, requestId: 0 } : r)),
      [
        ...transport,
        {
          ...transport[5],
          requestId: 8,
          method: 'PATCH',
          pathHash: hash(`/plans/training/${oldId}`),
        },
      ],
    ])
      assert.throws(() => check(row, records));
    check();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

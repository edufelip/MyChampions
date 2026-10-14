import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  nativeDiscardAuxiliaryFrames,
  validateIosTrainingDiscardPreparation,
} from '../../scripts/testing/native-view-evidence';

void test('iOS discard inventory rejects draft loss, hidden choices, stale fresh builders, unreviewed auxiliary frames and writes', async () => {
  // Synthetic evidence boundary, never an actual native test result.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-discard-evidence-')));
  await chmod(root, 0o700);
  const runId = 'a'.repeat(24);
  const planId = 'training_plan_11111111-1111-4111-8111-111111111111';
  const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
  const row = {
    requirementRefs: ['SC-208', 'TC-304', 'UC-002.7'],
    savedPlanId: planId,
    draftName: 'Native QA Draft',
    sessionName: 'Strength',
    exerciseId: '00000000-0000-4000-8000-000000000001',
    exerciseName: 'en QA Exercise 1',
    quantity: '3x8',
    snapshotPaths: ['discard-before.private.json', 'discard-after.private.json'],
    ownedSqlBeforeAfterUnchanged: true,
    scope: 'native-discard-dialog-and-local-draft-views-only; no saved-plan behavior pass',
  };
  const snapshot = {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    connections: [],
    trainingPlans: [
      {
        id: planId,
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
  };
  const node = (attributes: Record<string, string>, children: unknown[] = []) => ({
    attributes,
    children,
  });
  const title = enUS['pro.plan.discard.title'];
  const prompt = node(
    { accessibilityText: title },
    [enUS['pro.plan.discard.body'], enUS['pro.plan.discard.no'], enUS['pro.plan.discard.yes']].map(
      (accessibilityText) => node({ accessibilityText, enabled: 'true' }),
    ),
  );
  const name = {
    'resource-id': 'pro.training_plan.name',
    text: row.draftName,
    value: row.draftName,
    enabled: 'true',
  };
  const quantity = {
    'resource-id': 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
    accessibilityText: row.quantity,
  };
  const session = { 'resource-id': 'pro.training_plan.sessionRow.Strength' };
  const save = { 'resource-id': 'pro.training_plan.saveButton', enabled: 'true' };
  const preparedSession = (item = quantity) => node(session, [node(item)]);
  const kept = node({ 'resource-id': 'pro.training_plan.screen' }, [
    node(name),
    preparedSession(),
    node(save),
  ]);
  const library = node({}, [
    node({ 'resource-id': 'pro.library.training.create' }),
    node({ 'resource-id': `pro.library.training.row.${planId}` }),
  ]);
  const fresh = node({ 'resource-id': 'pro.training_plan.screen' }, [
    node({ ...name, text: '', value: '' }),
    node({ ...save, enabled: 'false' }),
  ]);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3/8AAAAASUVORK5CYII=',
    'base64',
  );
  const trees: Record<string, unknown> = {
    'discard-prompt': prompt,
    'discard-kept': kept,
    'discard-reopened': prompt,
    'discard-library': library,
    'discard-fresh-builder': fresh,
  };
  const transport = [
    ['POST', '/auth/email/sign-in', 201],
    ['GET', '/plans/predefined', 200],
  ].map(([method, route, status]) => ({
    method,
    pathHash: hash(String(route)),
    status,
    outcome: 'forwarded',
    requestProfile: 'native',
  }));
  const put = (file: string, value: unknown) =>
    writeFile(path.join(root, file), JSON.stringify(value), { mode: 0o600 });
  const reviews = () =>
    nativeDiscardAuxiliaryFrames.map(([label, viewId]) => ({
      viewId,
      reviewed: true,
      screenshotPath: `${label}.png`,
      screenshotHash: hash(png),
      hierarchyPath: `${label}-hierarchy.json`,
      hierarchyHash: hash(JSON.stringify(trees[label])),
    }));
  const check = (preparation: unknown = row, records: unknown = transport) =>
    validateIosTrainingDiscardPreparation(root, runId, preparation, records);
  const rejectTree = async (label: string, bad: unknown) => {
    const previous = trees[label];
    trees[label] = bad;
    await put(`${label}-hierarchy.json`, bad);
    await put('discard-reviewed-frames.private.json', reviews());
    assert.throws(() => check());
    trees[label] = previous;
    await put(`${label}-hierarchy.json`, previous);
    await put('discard-reviewed-frames.private.json', reviews());
    check();
  };
  const rejectSnapshot = async (file: string, bad: unknown) => {
    await put(file, bad);
    assert.throws(() => check());
    await put(file, snapshot);
    check();
  };
  try {
    for (const file of row.snapshotPaths) await put(file, snapshot);
    for (const [label, tree] of Object.entries(trees)) {
      await put(`${label}-hierarchy.json`, tree);
      await writeFile(path.join(root, `${label}.png`), png, { mode: 0o600 });
    }
    await put('discard-reviewed-frames.private.json', reviews());
    check();
    for (const bad of [
      null,
      {},
      { ...row, requirementRefs: [] },
      { ...row, scope: 'passed' },
      { ...row, savedPlanId: 'foreign' },
      { ...row, quantity: '9x9' },
      { ...row, ownedSqlBeforeAfterUnchanged: false },
    ])
      assert.throws(() => check(bad));
    for (const file of row.snapshotPaths) {
      await rejectSnapshot(file, { ...snapshot, runId: 'foreign' });
      await rejectSnapshot(file, { ...snapshot, scope: 'native-entry-android' });
      await rejectSnapshot(file, { ...snapshot, readOnly: false });
    }
    await rejectSnapshot(row.snapshotPaths[1], {
      ...snapshot,
      trainingPlans: [{ ...snapshot.trainingPlans[0], name: 'Changed' }],
    });
    for (const label of ['discard-prompt', 'discard-reopened']) {
      await rejectTree(label, node({ accessibilityText: title }, prompt.children.slice(0, 2)));
      await rejectTree(label, node({}, [node({ accessibilityText: title }), ...prompt.children]));
    }
    await rejectTree(
      'discard-kept',
      node(kept.attributes, [node({ ...name, text: 'Lost' }), preparedSession(), node(save)]),
    );
    await rejectTree(
      'discard-kept',
      node(kept.attributes, [node({ ...name, enabled: 'false' }), preparedSession(), node(save)]),
    );
    await rejectTree(
      'discard-kept',
      node(kept.attributes, [
        node(name),
        preparedSession({ ...quantity, accessibilityText: '9x9' }),
        node(save),
      ]),
    );
    await rejectTree(
      'discard-kept',
      node(kept.attributes, [node(name), node(quantity), node(save)]),
    );
    await rejectTree(
      'discard-kept',
      node(kept.attributes, [node(name), node(session), node(quantity), node(save)]),
    );
    await rejectTree(
      'discard-kept',
      node(kept.attributes, [node(name), preparedSession(), node({ ...save, enabled: 'false' })]),
    );
    await rejectTree(
      'discard-library',
      node({}, [node({ 'resource-id': 'pro.library.training.create' })]),
    );
    await rejectTree(
      'discard-fresh-builder',
      node(fresh.attributes, [node(name), node({ ...save, enabled: 'false' })]),
    );
    await rejectTree(
      'discard-fresh-builder',
      node(fresh.attributes, [...fresh.children, node(session)]),
    );
    await rejectTree(
      'discard-fresh-builder',
      node(fresh.attributes, [node({ ...name, text: '', value: '' }), node(save)]),
    );
    for (const bad of [
      reviews().slice(1),
      reviews().map((r) => ({ ...r, reviewed: false })),
      [...reviews()].reverse(),
      reviews().map((r) => ({ ...r, screenshotHash: '0'.repeat(64) })),
    ]) {
      await put('discard-reviewed-frames.private.json', bad);
      assert.throws(() => check());
      await put('discard-reviewed-frames.private.json', reviews());
      check();
    }
    for (const bad of [
      [],
      transport.slice(1),
      transport.slice(0, 1),
      transport.map((r) => ({ ...r, requestProfile: 'browser' })),
      transport.map((r) => ({ ...r, outcome: 'injected' })),
      ...['POST', 'PATCH', 'DELETE'].map((method) => [
        ...transport,
        {
          method,
          pathHash: hash(method === 'POST' ? '/plans/training' : `/plans/training/${planId}`),
          status: 503,
          outcome: 'injected',
          requestProfile: 'native',
        },
      ]),
    ])
      assert.throws(() => check(row, bad));
    check();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

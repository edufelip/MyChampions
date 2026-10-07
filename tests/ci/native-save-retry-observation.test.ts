import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  nativeSaveRetryFaultTarget,
  observeAndroidSaveRetry,
  observeIosSaveRetry,
  requireNativeRetryDraft,
  requireIosRetryDraft,
  validateNativeRetrySnapshots,
} from '../../scripts/testing/native-save-retry-observation';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

void test('native save/retry rejects lost or disabled draft fields and quantity outside its session', () => {
  const node = (attributes: Record<string, string>, children: unknown[] = []) => ({
    attributes,
    children,
  });
  const name = {
    'resource-id': 'pro.training_plan.name',
    value: 'Native QA Draft',
    enabled: 'true',
  };
  const save = { 'resource-id': 'pro.training_plan.saveButton', enabled: 'true' };
  const quantity = {
    'resource-id': 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
    accessibilityText: '3x8',
  };
  const session = { 'resource-id': 'pro.training_plan.sessionRow.Strength' };
  const tree = node({}, [node(name), node(save), node(session, [node(quantity)])]);
  requireIosRetryDraft(tree, true);
  for (const bad of [
    node({}, [node({ ...name, value: 'Lost' }), node(save), node(session, [node(quantity)])]),
    node({}, [node({ ...name, enabled: 'false' }), node(save), node(session, [node(quantity)])]),
    node({}, [node(name), node({ ...save, enabled: 'false' }), node(session, [node(quantity)])]),
    node({}, [node(name), node(save), node(session), node(quantity)]),
    node({}, [
      node(name),
      node(save),
      node(session, [node({ ...quantity, accessibilityText: '4x8' })]),
    ]),
  ])
    assert.throws(() => requireIosRetryDraft(bad, true));
  requireIosRetryDraft(
    node({}, [node(name), node({ ...save, enabled: 'false' }), node(session, [node(quantity)])]),
    false,
  );
});

void test('native save/retry retained-draft validation is platform-specific and package-bound', () => {
  const node = (attributes: Record<string, string>, children: unknown[] = []) => ({
    attributes,
    children,
  });
  const id = (
    platform: 'ios' | 'android',
    value: string,
    packageName = 'com.edufelip.mychampions.dev',
  ) => (platform === 'android' ? `${packageName}:id/${value}` : value);
  const tree = (
    platform: 'ios' | 'android',
    saveEnabled: boolean,
    sessionName = 'Strength',
    quantity = '3x8',
    packageName = 'com.edufelip.mychampions.dev',
    fieldAttribute: 'value' | 'text' = platform === 'ios' ? 'value' : 'text',
    quantityAttribute: 'accessibilityText' | 'text' = platform === 'ios'
      ? 'accessibilityText'
      : 'text',
  ) =>
    node({}, [
      node({
        'resource-id': id(platform, 'pro.training_plan.name', packageName),
        [fieldAttribute]: 'Native QA Draft',
        enabled: 'true',
      }),
      node({
        'resource-id': id(platform, 'pro.training_plan.saveButton', packageName),
        enabled: String(saveEnabled),
      }),
      node(
        { 'resource-id': id(platform, `pro.training_plan.sessionRow.${sessionName}`, packageName) },
        [
          node({
            'resource-id': id(
              platform,
              'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
              packageName,
            ),
            [quantityAttribute]: quantity,
          }),
        ],
      ),
    ]);

  const android = tree('android', true);
  requireNativeRetryDraft('android', android, true);
  requireNativeRetryDraft('android', tree('android', false), false);
  requireIosRetryDraft(tree('ios', true), true);
  assert(Object.isFrozen(nativeSaveRetryFaultTarget));
  assert.equal(Reflect.set(nativeSaveRetryFaultTarget as object, 'path', '/foreign'), false);
  assert.equal(nativeSaveRetryFaultTarget.path, '/plans/training');

  for (const invalid of [
    () => requireNativeRetryDraft('ios', android, true),
    () => requireNativeRetryDraft('android', tree('ios', true), true),
    () => requireNativeRetryDraft('android', tree('android', true, 'Upper'), true),
    () => requireNativeRetryDraft('android', tree('android', true, 'Strength', '4x8'), true),
    () =>
      requireNativeRetryDraft(
        'android',
        tree('android', true, 'Strength', '3x8', 'com.example.foreign'),
        true,
      ),
    () =>
      requireNativeRetryDraft(
        'android',
        tree('android', true, 'Strength', '3x8', 'com.edufelip.mychampions.dev', 'value', 'text'),
        true,
      ),
    () =>
      requireNativeRetryDraft(
        'android',
        tree(
          'android',
          true,
          'Strength',
          '3x8',
          'com.edufelip.mychampions.dev',
          'text',
          'accessibilityText',
        ),
        true,
      ),
  ])
    assert.throws(invalid);
});

void test('native retry SQL rejects failed-write mutation, duplicates, foreign scopes and wrong saved contents', () => {
  const before: OwnedDomainSnapshot = {
    schemaVersion: 1,
    runId: 'a'.repeat(24),
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
  const after: OwnedDomainSnapshot = {
    ...before,
    trainingPlans: [
      {
        id: 'training_plan_11111111-1111-4111-8111-111111111111',
        studentAuthUid: 'coach',
        ownerProfessionalUid: 'coach',
        sourceKind: 'predefined',
        name: 'Native QA Draft',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        createdAt: '2026-09-29T00:00:00Z',
        updatedAt: '2026-09-29T00:00:00Z',
        sessions: [
          {
            name: 'Strength',
            items: [
              {
                name: 'en QA Exercise 1',
                quantity: '3x8',
                exerciseId: '00000000-0000-4000-8000-000000000001',
              },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(
    validateNativeRetrySnapshots(before, structuredClone(before), after, 'coach'),
    after.trainingPlans[0].id,
  );
  assert.throws(() => validateNativeRetrySnapshots(before, after, after, 'coach'));
  for (const mutate of [
    (s: OwnedDomainSnapshot) => {
      s.runId = 'b'.repeat(24);
    },
    (s: OwnedDomainSnapshot) => {
      s.scope = 'foreign';
    },
    (s: OwnedDomainSnapshot) => {
      s.trainingPlans.push(structuredClone(s.trainingPlans[0]));
    },
    (s: OwnedDomainSnapshot) => {
      s.trainingPlans[0].ownerProfessionalUid = 'foreign';
    },
    (s: OwnedDomainSnapshot) => {
      s.trainingPlans[0].name = 'Lost';
    },
    (s: OwnedDomainSnapshot) => {
      s.trainingPlans[0].isDraft = true;
    },
    (s: OwnedDomainSnapshot) => {
      s.trainingPlans[0].sessions[0].name = 'Wrong';
    },
    (s: OwnedDomainSnapshot) => {
      (s.trainingPlans[0].sessions[0].items as Record<string, unknown>[])[0].quantity = '9x9';
    },
  ]) {
    const bad = structuredClone(after);
    mutate(bad);
    assert.throws(() => validateNativeRetrySnapshots(before, before, bad, 'coach'));
  }
  const seeded = structuredClone(after);
  const changedPrior = {
    ...seeded,
    trainingPlans: [
      { ...seeded.trainingPlans[0], name: 'Changed old plan' },
      { ...after.trainingPlans[0], id: 'training_plan_22222222-2222-4222-8222-222222222222' },
    ],
  };
  assert.throws(() => validateNativeRetrySnapshots(seeded, seeded, changedPrior, 'coach'));
});

void test('native retry SQL binds the declared Android snapshot scope', () => {
  const before: OwnedDomainSnapshot = {
    schemaVersion: 1,
    runId: 'a'.repeat(24),
    scope: 'native-entry-android',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
  const after: OwnedDomainSnapshot = {
    ...before,
    trainingPlans: [
      {
        id: 'training_plan_33333333-3333-4333-8333-333333333333',
        studentAuthUid: 'coach',
        ownerProfessionalUid: 'coach',
        sourceKind: 'predefined',
        name: 'Native QA Draft',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        createdAt: '2026-09-29T00:00:00Z',
        updatedAt: '2026-09-29T00:00:00Z',
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
  assert.equal(
    validateNativeRetrySnapshots(before, structuredClone(before), after, 'coach', 'android'),
    after.trainingPlans[0].id,
  );
  assert.throws(() =>
    validateNativeRetrySnapshots(before, structuredClone(before), after, 'coach', 'ios'),
  );
});

void test('failed native observation retains bounded SQL when available and never replaces the original error', async () => {
  for (const unavailable of [false, true]) {
    const output = await mkdtemp(path.join(os.tmpdir(), 'native-retry-boundary-'));
    await chmod(output, 0o700);
    try {
      const before: OwnedDomainSnapshot = {
        schemaVersion: 1,
        runId: 'a'.repeat(24),
        scope: 'native-entry-ios',
        readOnly: true,
        trainingPlans: [],
        connections: [],
      };
      let snapshotCalls = 0;
      let cleared = false;
      const report: Record<string, unknown> = {};
      const original = new Error('Original UI failure');
      const proxy = {
        armObservedNativeSaveFault: async () => {},
        faultState: { attemptId: `native-save-${before.runId}`, injectedCount: 0 },
        clearFault: () => {
          cleared = true;
        },
      } as unknown as Parameters<typeof observeIosSaveRetry>[0]['proxy'];
      await assert.rejects(
        observeIosSaveRetry({
          output,
          accountUid: 'coach',
          report,
          proxy,
          snapshot: () => {
            if (++snapshotCalls > 1 && unavailable)
              return Promise.reject(new Error('Snapshot unavailable'));
            return Promise.resolve(before);
          },
          observe: () => Promise.reject(original),
        }),
        (error) => error === original,
      );
      assert(cleared);
      if (unavailable) assert.equal(report.saveRetryFailureSnapshotUnavailable, true);
      else {
        assert.equal(report.saveRetryFailureSnapshot, 'save-retry-on-failure.private.json');
        assert.deepEqual(
          JSON.parse(
            await readFile(path.join(output, 'save-retry-on-failure.private.json'), 'utf8'),
          ),
          before,
        );
      }
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }
});

void test('native save/retry rejects a wrong-platform baseline before fault or UI acquisition', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'native-retry-baseline-'));
  await chmod(output, 0o700);
  const before: OwnedDomainSnapshot = {
    schemaVersion: 1,
    runId: 'c'.repeat(24),
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
  let snapshotCalls = 0;
  let armCalls = 0;
  let observeCalls = 0;
  let clearCalls = 0;
  let faultState: { attemptId: string; injectedCount: number } | null = null;
  const proxy = {
    get faultState() {
      return faultState;
    },
    armObservedNativeSaveFault: () => {
      armCalls++;
      faultState = { attemptId: 'unexpected', injectedCount: 1 };
    },
    clearFault: () => {
      clearCalls++;
      faultState = null;
    },
  } as unknown as Parameters<typeof observeAndroidSaveRetry>[0]['proxy'];
  try {
    await assert.rejects(
      observeAndroidSaveRetry({
        output,
        accountUid: 'coach',
        report: {},
        proxy,
        snapshot: () => {
          snapshotCalls++;
          return Promise.resolve(structuredClone(before));
        },
        observe: () => {
          observeCalls++;
          return Promise.resolve();
        },
      }),
    );
    assert.equal(snapshotCalls, 1);
    assert.equal(armCalls, 0);
    assert.equal(observeCalls, 0);
    assert.equal(clearCalls, 0);
    assert.equal(faultState, null);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

void test('Android save/retry keeps the four snapshots, one fault and one retry in order', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'native-retry-android-'));
  await chmod(output, 0o700);
  const runId = 'b'.repeat(24);
  const createdId = 'training_plan_44444444-4444-4444-8444-444444444444';
  const before: OwnedDomainSnapshot = {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-android',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
  const after: OwnedDomainSnapshot = {
    ...before,
    trainingPlans: [
      {
        id: createdId,
        studentAuthUid: 'coach',
        ownerProfessionalUid: 'coach',
        sourceKind: 'predefined',
        name: 'Native QA Draft',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        createdAt: '2026-09-29T00:00:00Z',
        updatedAt: '2026-09-29T00:00:00Z',
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
  const androidId = (value: string) => `com.edufelip.mychampions.dev:id/${value}`;
  const draftTree = (saveEnabled: boolean) =>
    node({}, [
      node({
        'resource-id': androidId('pro.training_plan.name'),
        text: 'Native QA Draft',
        enabled: 'true',
      }),
      node({
        'resource-id': androidId('pro.training_plan.saveButton'),
        enabled: String(saveEnabled),
      }),
      node({ 'resource-id': androidId('pro.training_plan.sessionRow.Strength') }, [
        node({
          'resource-id': androidId('pro.training_plan.itemRow.en_QA_Exercise_1.quantity'),
          text: '3x8',
        }),
      ]),
    ]);
  const trees: Record<string, unknown> = {
    'save-error': node({ text: enUS['pro.plan.error.save'] }, [
      node({ text: 'OK', enabled: 'true' }),
    ]),
    'save-retained': draftTree(true),
    'save-retry-library': node({}, [
      node({ 'resource-id': androidId('pro.library.training.create') }),
      node({ 'resource-id': androidId(`pro.library.training.row.${createdId}`) }),
    ]),
    'save-retry-reopened': draftTree(false),
  };
  const routeHash = (route: string) => createHash('sha256').update(route).digest('hex');
  const observations = [
    {
      method: 'POST',
      pathHash: routeHash('/plans/training'),
      status: 503,
      outcome: 'injected',
      requestProfile: 'native',
    },
    {
      method: 'POST',
      pathHash: routeHash('/plans/training'),
      status: 201,
      outcome: 'forwarded',
      requestProfile: 'native',
    },
    {
      method: 'GET',
      pathHash: routeHash(`/plans/training/${createdId}`),
      status: 200,
      outcome: 'forwarded',
      requestProfile: 'native',
    },
  ];
  let snapshotCalls = 0;
  let faultState: { attemptId: string; injectedCount: number } | null = null;
  let armArgs: unknown;
  const events: string[] = [];
  const report: Record<string, unknown> = {};
  const proxy = {
    observations,
    get faultState() {
      return faultState;
    },
    armObservedNativeSaveFault: (value: unknown) => {
      events.push('arm');
      armArgs = value;
      const row = value as { attemptId: string };
      faultState = { attemptId: row.attemptId, injectedCount: 1 };
    },
    clearFault: (attemptId: string) => {
      events.push('clear');
      faultState = null;
      return { attemptId, injectedCount: 1 };
    },
  } as unknown as Parameters<typeof observeAndroidSaveRetry>[0]['proxy'];
  try {
    await observeAndroidSaveRetry({
      output,
      accountUid: 'coach',
      report,
      snapshot: () => {
        snapshotCalls++;
        return Promise.resolve(structuredClone(snapshotCalls < 3 ? before : after));
      },
      proxy,
      snapshotScope: 'native-entry-android',
      observe: async (label) => {
        events.push(`observe:${label}`);
        await writeFile(
          path.join(output, `${label}-hierarchy.json`),
          JSON.stringify(trees[label]),
          {
            mode: 0o600,
            flag: 'wx',
          },
        );
      },
    });
    assert.deepEqual(events, [
      'arm',
      'observe:save-error',
      'observe:save-retained',
      'clear',
      'observe:save-retry-library',
      'observe:save-retry-reopened',
    ]);
    assert.equal(snapshotCalls, 4);
    assert.deepEqual(armArgs, {
      attemptId: `native-save-${runId}`,
      ...nativeSaveRetryFaultTarget,
      accountUid: 'coach',
    });
    assert.deepEqual(report.saveRetryPreparation, {
      platform: 'android',
      snapshotScope: 'native-entry-android',
      faultTarget: nativeSaveRetryFaultTarget,
      requirementRefs: ['SC-208', 'TC-278', 'BR-293', 'BR-294', 'UC-002.7', 'BL-018/P4-save-retry'],
      createdId,
      accountUid: 'coach',
      faultAttemptId: `native-save-${runId}`,
      attemptId: `native-save-${runId}`,
      injectedCount: 1,
      snapshotPaths: [
        'save-retry-before.private.json',
        'save-retry-after-failure.private.json',
        'save-retry-after-success.private.json',
        'save-retry-after-reopen.private.json',
      ],
      scope:
        'raw-native-save-error-retained-draft-and-retry-observation; no qualified behavior pass',
    });
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

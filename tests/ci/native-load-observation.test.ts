import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  requireIosLoadObservation,
  requireNativeLoadObservation,
  requireNativeRecoveredQuantityFrame,
} from '../../scripts/testing/native-training-load-observation';

for (const platform of ['ios', 'android'] as const) {
  void test(`${platform} load evidence rejects mounted form, disabled retry, wrong restored content, SQL mutations and false transport`, () => {
    // Synthetic evidence boundary; no actual device or journey pass.
    const textAttribute = platform === 'ios' ? 'accessibilityText' : 'text';
    const nameAttribute = platform === 'ios' ? 'value' : 'text';
    const backendRunId = 'a'.repeat(24);
    const savedPlanId = 'training_plan_11111111-1111-4111-8111-111111111111';
    const accountUid = 'coach';
    const attemptId = `native-load-${backendRunId}`;
    const node = (
      id: string,
      attributes: Record<string, string> = {},
      children: unknown[] = [],
    ) => ({
      attributes: { 'resource-id': id, ...attributes },
      children,
    });
    const errorTree = node('error-root', {}, [
      node('pro.training_plan.error', { [textAttribute]: enUS['pro.plan.error.load'] }),
      node('pro.training_plan.error.retry', { enabled: 'true' }),
      node('pro.training_plan.error.backToLibrary', { enabled: 'true' }),
    ]);
    const quantity = node('pro.training_plan.itemRow.QA_Exercise.quantity', {
      [textAttribute]: '3x8',
    });
    const recoveredTree = node('pro.training_plan.screen', {}, [
      node('pro.training_plan.name', { [nameAttribute]: `QA native-entry-${platform} Training` }),
      node('pro.training_plan.sessionRow.Upper', {}, [quantity]),
    ]);
    const snapshot = {
      schemaVersion: 1 as const,
      runId: backendRunId,
      scope: `native-entry-${platform}`,
      readOnly: true as const,
      connections: [],
      trainingPlans: [
        {
          id: savedPlanId,
          studentAuthUid: accountUid,
          ownerProfessionalUid: accountUid,
          sourceKind: 'predefined' as const,
          name: `QA native-entry-${platform} Training`,
          isArchived: false,
          isDraft: false,
          lifecycleConnectionId: null,
          createdAt: '2026-09-29T00:00:00Z',
          updatedAt: '2026-09-29T00:00:00Z',
          sessions: [
            {
              id: 'qa-session',
              name: 'Upper',
              notes: 'Controlled',
              items: [
                {
                  id: 'qa-item',
                  name: 'QA Exercise',
                  quantity: '3x8',
                  notes: 'RPE 7',
                  exerciseId: '00000000-0000-4000-8000-000000000001',
                },
              ],
            },
          ],
        },
      ],
    };
    const hash = (route: string) => createHash('sha256').update(route).digest('hex');
    const transport = [
      '/plans/training',
      '/plans/predefined',
      `/plans/training/${savedPlanId}`,
      `/plans/training/${savedPlanId}`,
    ].map((route, index) => ({
      requestId: index + 1,
      method: 'GET',
      pathHash: hash(route),
      requestOrigin: null,
      requestProfile: 'native' as const,
      targetOrigin: 'http://127.0.0.1:40000',
      status: index === 2 ? 503 : 200,
      outcome: index === 2 ? ('injected' as const) : ('forwarded' as const),
      faultAttemptId: index === 2 ? attemptId : null,
      elapsedMs: 1,
    }));
    const good = {
      platform,
      backendRunId,
      savedPlanId,
      accountUid,
      attemptId,
      snapshots: [snapshot, structuredClone(snapshot), structuredClone(snapshot)],
      errorTree,
      recoveredTree,
      transport,
    };
    requireNativeLoadObservation(good);
    if (platform === 'ios') requireIosLoadObservation(good);
    assert.throws(() => requireNativeLoadObservation({ ...good, platform: 'web' as never }));
    if (platform === 'android') {
      const prefixed = structuredClone(good);
      const prefixIds = (tree: typeof errorTree): void => {
        tree.attributes['resource-id'] =
          `com.edufelip.mychampions.dev:id/${tree.attributes['resource-id']}`;
        for (const child of tree.children) prefixIds(child as typeof errorTree);
      };
      prefixIds(prefixed.errorTree);
      prefixIds(prefixed.recoveredTree);
      requireNativeLoadObservation(prefixed);
    }
    const controls: ((value: typeof good) => void)[] = [
      (x) => {
        x.attemptId = 'foreign';
      },
      (x) => {
        x.accountUid = 'foreign';
      },
      (x) => {
        x.savedPlanId += 'foreign';
      },
      (x) => {
        x.snapshots.pop();
      },
      (x) => {
        x.snapshots[1].trainingPlans[0].name = 'Changed';
      },
      (x) => {
        x.snapshots[2].scope = 'foreign';
      },
      (x) => {
        x.errorTree.children.push(node('pro.training_plan.name'));
      },
      (x) => {
        x.errorTree.children[0] = node('pro.training_plan.error', { [textAttribute]: 'Wrong' });
      },
      (x) => {
        x.errorTree.children[1] = node('pro.training_plan.error.retry', { enabled: 'false' });
      },
      (x) => {
        x.errorTree.children.pop();
      },
      (x) => {
        x.recoveredTree.children[0] = node('pro.training_plan.name', { [nameAttribute]: 'Lost' });
      },
      (x) => {
        x.recoveredTree.children[1] = node('pro.training_plan.sessionRow.Upper');
        x.recoveredTree.children.push(quantity);
      },
      (x) => {
        x.recoveredTree.children.push(node('pro.training_plan.error'));
      },
      (x) => {
        x.transport[2].status = 200;
      },
      (x) => {
        x.transport[2].faultAttemptId = 'foreign';
      },
      (x) => {
        x.transport[3].requestId = 0;
      },
      (x) => {
        x.transport[3].status = 503;
      },
      (x) => {
        x.transport[3].targetOrigin = 'http://127.0.0.1:40001';
      },
      (x) => {
        x.transport.push({ ...x.transport[3] });
      },
      (x) => {
        x.transport.push({ ...x.transport[3], pathHash: hash('/plans/training'), method: 'POST' });
      },
      (x) => {
        x.transport.splice(1, 1);
      },
      (x) => {
        for (const snapshot of x.snapshots)
          snapshot.scope = platform === 'ios' ? 'native-entry-android' : 'native-entry-ios';
      },
      (x) => {
        x.recoveredTree.children[0] = node('pro.training_plan.name', {
          [platform === 'ios' ? 'text' : 'value']: `QA native-entry-${platform} Training`,
        });
      },
      (x) => {
        x.errorTree.children[0] = node('pro.training_plan.error', {
          [platform === 'ios' ? 'text' : 'accessibilityText']: enUS['pro.plan.error.load'],
        });
      },
      (x) => {
        x.errorTree.children[0] = node('foreign.app:id/pro.training_plan.error', {
          [textAttribute]: enUS['pro.plan.error.load'],
        });
      },
      (x) => {
        x.recoveredTree.children[1] = node('pro.training_plan.sessionRow.Upper', {}, [
          node('pro.training_plan.itemRow.QA_Exercise.quantity', { [textAttribute]: '4x10' }),
        ]);
      },
    ];
    for (const [index, mutate] of controls.entries()) {
      const bad = structuredClone(good);
      mutate(bad);
      assert.throws(() => requireNativeLoadObservation(bad), `negative control ${index} accepted`);
    }
    requireNativeLoadObservation(good);
    if (platform === 'ios') requireIosLoadObservation(good);
  });
}

void test('scrolled quantity proof rejects ambiguity, detachment, wrong value, disabled content and retained error', () => {
  const quantity = {
    attributes: {
      'resource-id': 'pro.training_plan.itemRow.QA_Exercise.quantity',
      text: '3x8',
      enabled: 'true',
    },
  };
  const session = {
    attributes: { 'resource-id': 'pro.training_plan.sessionRow.Upper' },
    children: [quantity],
  };
  const good = { children: [session] };
  requireNativeRecoveredQuantityFrame('android', good);
  const withoutName = structuredClone(good);
  requireNativeRecoveredQuantityFrame('android', withoutName); // Full name remains in the independent original recovery contract.
  for (const tree of [
    {},
    { children: [session, session] },
    { children: [session, quantity] },
    { children: [{ attributes: session.attributes, children: [] }, quantity] },
    {
      children: [
        { ...session, children: [{ attributes: { ...quantity.attributes, text: '4x10' } }] },
      ],
    },
    {
      children: [
        { ...session, children: [{ attributes: { ...quantity.attributes, enabled: 'false' } }] },
      ],
    },
    { children: [session, { attributes: { 'resource-id': 'pro.training_plan.error' } }] },
  ])
    assert.throws(() => requireNativeRecoveredQuantityFrame('android', tree));
  assert.throws(() => requireNativeRecoveredQuantityFrame('web' as never, good));
});

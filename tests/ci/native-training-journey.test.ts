import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireNativeTrainingJourneyState,
  runNativeTrainingJourney,
} from '../../scripts/testing/native-training-journey';
import type {
  NativeTrainingJourneyInput,
  NativeTrainingJourneyState,
  NativeTrainingJourneyDriver,
} from '../../scripts/testing/native-training-journey';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

function fixture(platform: 'ios' | 'android') {
  const input: NativeTrainingJourneyInput = {
    runId: 'a'.repeat(24),
    attemptId: `${'a'.repeat(24)}:first`,
    platform,
    accountUid: 'coach',
    exerciseId: 'catalog-exercise-1',
    exerciseName: 'en QA Exercise 1',
  };
  const baseline: OwnedDomainSnapshot = {
    schemaVersion: 1,
    runId: input.runId,
    scope: `native-entry-${platform}`,
    readOnly: true,
    connections: [],
    trainingPlans: [
      {
        id: 'seeded-unrelated-plan',
        studentAuthUid: 'seeded-owner',
        ownerProfessionalUid: 'seeded-owner',
        sourceKind: 'predefined',
        name: 'Seeded',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        sessions: [],
        createdAt: '2026-09-29T00:00:00Z',
        updatedAt: '2026-09-29T00:00:00Z',
      },
    ],
  };
  const created = structuredClone(baseline);
  created.trainingPlans.push({
    ...structuredClone(baseline.trainingPlans[0]),
    id: 'training_plan_11111111-1111-4111-8111-111111111111',
    studentAuthUid: input.accountUid,
    ownerProfessionalUid: input.accountUid,
    name: `QA training ${input.attemptId}`,
    sessions: [
      {
        id: 'session-1',
        name: 'Strength',
        notes: '',
        items: [
          {
            id: 'item-1',
            name: input.exerciseName,
            exerciseId: input.exerciseId,
            quantity: '3x8',
            notes: '',
          },
        ],
      },
    ],
  });
  const edited = structuredClone(created);
  edited.trainingPlans[1].name += ' updated';
  edited.trainingPlans[1].sessions = [
    {
      id: 'session-1',
      name: 'Strength',
      notes: '',
      items: [
        {
          id: 'item-readded',
          name: input.exerciseName,
          exerciseId: input.exerciseId,
          quantity: '4x10',
          notes: '',
        },
      ],
    },
  ];
  edited.trainingPlans[1].updatedAt = '2026-09-29T00:00:01Z';
  const api = (snapshot: OwnedDomainSnapshot) => ({
    status: 200,
    plan: structuredClone(snapshot.trainingPlans[1]),
  });
  const state: NativeTrainingJourneyState = {
    baseline,
    draft: structuredClone(baseline),
    created,
    editedDraft: structuredClone(created),
    edited,
    durable: structuredClone(edited),
    apiReads: { created: api(created), edited: api(edited), durable: api(edited) },
  };
  return { input, state };
}
for (const platform of ['ios', 'android'] as const) {
  void test(`${platform} native training state boundary rejects early writes, wrong identity/content, API disagreement and lost restart`, () => {
    // Synthetic state/API controls only; no native or durable-runtime execution claim.
    const { input, state } = fixture(platform);
    assert.equal(
      requireNativeTrainingJourneyState(input, state).planId,
      state.created.trainingPlans[1].id,
    );
    const controls: ((x: NativeTrainingJourneyState) => void)[] = [
      (x) => {
        x.draft = structuredClone(x.created);
      },
      (x) => {
        x.editedDraft = structuredClone(x.edited);
      },
      (x) => {
        x.created.runId = 'b'.repeat(24);
      },
      (x) => {
        x.created.scope = 'foreign';
      },
      (x) => {
        x.created.trainingPlans[1].ownerProfessionalUid = 'foreign';
      },
      (x) => {
        x.created.trainingPlans[1].studentAuthUid = 'foreign';
      },
      (x) => {
        x.created.trainingPlans.push(structuredClone(x.created.trainingPlans[1]));
      },
      (x) => {
        x.created.trainingPlans[0].name = 'Mutated unrelated row';
      },
      (x) => {
        x.created.trainingPlans[1].name = 'Wrong title';
      },
      (x) => {
        x.created.trainingPlans[1].isDraft = true;
      },
      (x) => {
        x.created.trainingPlans[1].sourceKind = 'assigned';
      },
      (x) => {
        x.created.trainingPlans[1].sessions = [];
      },
      (x) => {
        x.edited.trainingPlans[1].id = 'training_plan_22222222-2222-4222-8222-222222222222';
      },
      (x) => {
        x.edited.trainingPlans[1].sessions = x.created.trainingPlans[1].sessions;
      },
      (x) => {
        x.apiReads.created.status = 500;
      },
      (x) => {
        x.apiReads.created.plan = x.apiReads.edited.plan;
      },
      (x) => {
        x.apiReads.edited.plan = {
          id: x.edited.trainingPlans[1].id,
          name: x.edited.trainingPlans[1].name,
          sessions: [],
        };
      },
      (x) => {
        x.durable = structuredClone(x.created);
      },
      (x) => {
        x.durable.trainingPlans[1].updatedAt = 'Changed after restart';
      },
    ];
    for (const [index, mutate] of controls.entries()) {
      const bad = structuredClone(state);
      mutate(bad);
      assert.throws(
        () => requireNativeTrainingJourneyState(input, bad),
        `accepted control ${index}`,
      );
    }
    assert.throws(() =>
      requireNativeTrainingJourneyState({ ...input, exerciseId: 'foreign' }, state),
    );
    assert.throws(() =>
      requireNativeTrainingJourneyState({ ...input, attemptId: 'foreign' }, state),
    );
    requireNativeTrainingJourneyState(input, state);
  });
}
function driverFor(
  state: NativeTrainingJourneyState,
  actions: string[],
): NativeTrainingJourneyDriver {
  let phase: 'baseline' | 'draft' | 'created' | 'editedDraft' | 'edited' | 'durable' = 'baseline';
  let saves = 0;
  return {
    normalEntry() {
      actions.push('entry');
      return Promise.resolve();
    },
    createDraft(values) {
      assert.equal(values.quantity, '3x8');
      actions.push('draft');
      phase = 'draft';
      return Promise.resolve();
    },
    saveAndReopen(planId) {
      actions.push('save');
      phase = ++saves === 1 ? 'created' : 'edited';
      assert.equal(planId, saves === 1 ? undefined : state.created.trainingPlans[1].id);
      return Promise.resolve();
    },
    editDraft(values) {
      assert.equal(values.method, 'remove-confirm-readd');
      assert.equal(values.quantity, '4x10');
      actions.push('edit');
      phase = 'editedDraft';
      return Promise.resolve();
    },
    restartAndReopen(planId) {
      assert.equal(planId, state.created.trainingPlans[1].id);
      actions.push('restart');
      phase = 'durable';
      return Promise.resolve();
    },
    snapshot() {
      return Promise.resolve(structuredClone(state[phase]));
    },
    readPlan(planId) {
      assert.equal(planId, state.created.trainingPlans[1].id);
      assert(['created', 'edited', 'durable'].includes(phase));
      return Promise.resolve(structuredClone(state.apiReads[phase as keyof typeof state.apiReads]));
    },
  };
}
void test('ordered native controller stops before later actions on invalid checkpoints; synthetic driver only', async () => {
  const { input, state } = fixture('ios');
  const actions: string[] = [];
  await assert.rejects(() =>
    runNativeTrainingJourney({ ...input, attemptId: 'foreign' }, driverFor(state, actions)),
  );
  assert.deepEqual(actions, []);
  const result = await runNativeTrainingJourney(input, driverFor(state, actions));
  assert.deepEqual(actions, ['entry', 'draft', 'save', 'edit', 'save', 'restart']);
  assert.match(result.scope, /no native behavior pass/);
  const early = structuredClone(state);
  early.draft = structuredClone(early.created);
  const stopped: string[] = [];
  await assert.rejects(
    () => runNativeTrainingJourney(input, driverFor(early, stopped)),
    /before Save/,
  );
  assert.deepEqual(stopped, ['entry', 'draft']);
  const badCreate = structuredClone(state);
  badCreate.created.trainingPlans[1].ownerProfessionalUid = 'foreign';
  const later: string[] = [];
  await assert.rejects(() => runNativeTrainingJourney(input, driverFor(badCreate, later)));
  assert.deepEqual(later, ['entry', 'draft', 'save']);
  const badEdit = structuredClone(state);
  badEdit.editedDraft = structuredClone(badEdit.edited);
  const editActions: string[] = [];
  await assert.rejects(
    () => runNativeTrainingJourney(input, driverFor(badEdit, editActions)),
    /second Save/,
  );
  assert.deepEqual(editActions, ['entry', 'draft', 'save', 'edit']);
  const badSecondSave = structuredClone(state);
  badSecondSave.edited.trainingPlans[1].sessions = structuredClone(
    badSecondSave.created.trainingPlans[1].sessions,
  );
  const noRestart: string[] = [];
  await assert.rejects(() => runNativeTrainingJourney(input, driverFor(badSecondSave, noRestart)));
  assert.deepEqual(noRestart, ['entry', 'draft', 'save', 'edit', 'save']);
});

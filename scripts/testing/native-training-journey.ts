import assert from 'node:assert/strict';
import { assertTestingDocument } from './schema-validation';
import type { OwnedDomainSnapshot } from './owned-session';

type Plan = OwnedDomainSnapshot['trainingPlans'][number];
export type NativeTrainingJourneyInput = {
  runId: string;
  attemptId: string;
  platform: 'ios' | 'android';
  accountUid: string;
  exerciseId: string;
  exerciseName: string;
};
export type NativeTrainingApiRead = { status: number; plan: unknown };
export type NativeTrainingJourneyState = {
  baseline: OwnedDomainSnapshot;
  draft: OwnedDomainSnapshot;
  created: OwnedDomainSnapshot;
  editedDraft: OwnedDomainSnapshot;
  edited: OwnedDomainSnapshot;
  durable: OwnedDomainSnapshot;
  apiReads: {
    created: NativeTrainingApiRead;
    edited: NativeTrainingApiRead;
    durable: NativeTrainingApiRead;
  };
};
function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function requireInput(input: NativeTrainingJourneyInput) {
  assert.match(input.runId, /^[a-f0-9]{24}$/);
  assert.equal(input.attemptId, `${input.runId}:first`);
  assert(['ios', 'android'].includes(input.platform));
  assert(input.accountUid && input.exerciseId && input.exerciseName);
  assert.equal(input.exerciseName, input.exerciseName.trim());
  assert(!/[\r\n]/.test(input.exerciseName));
}
function requireSnapshot(value: OwnedDomainSnapshot, input: NativeTrainingJourneyInput) {
  requireInput(input);
  assertTestingDocument('domain-snapshot-v1', value);
  assert.equal(value.runId, input.runId);
  assert.equal(value.scope, `native-entry-${input.platform}`);
  assert.equal(new Set(value.trainingPlans.map((row) => row.id)).size, value.trainingPlans.length);
}
function createdPlan(baseline: OwnedDomainSnapshot, current: OwnedDomainSnapshot): Plan {
  const added = current.trainingPlans.filter(
    (row) => !baseline.trainingPlans.some((old) => old.id === row.id),
  );
  assert.equal(added.length, 1, 'Training journey must create exactly one plan');
  return added[0];
}
function requirePlan(plan: Plan, input: NativeTrainingJourneyInput, edited: boolean) {
  assert.match(plan.id, /^training_plan_[a-f0-9-]{36}$/);
  assert.equal(plan.ownerProfessionalUid, input.accountUid);
  assert.equal(plan.studentAuthUid, input.accountUid);
  assert.equal(plan.sourceKind, 'predefined');
  assert.equal(plan.isArchived, false);
  assert.equal(plan.isDraft, false);
  assert.equal(plan.lifecycleConnectionId, null);
  assert.equal(plan.name, `QA training ${input.attemptId}${edited ? ' updated' : ''}`);
  assert.equal(plan.sessions.length, 1);
  const session = record(plan.sessions[0]);
  assert.equal(session.name, 'Strength');
  assert.equal(session.notes, '');
  assert.equal(typeof session.id, 'string');
  assert((session.id as string).length);
  assert(Array.isArray(session.items));
  assert.equal(session.items.length, 1);
  const item = record(session.items[0]);
  assert.equal(typeof item.id, 'string');
  assert((item.id as string).length);
  assert.equal(item.exerciseId, input.exerciseId);
  assert.equal(item.name, input.exerciseName);
  assert.equal(item.quantity, edited ? '4x10' : '3x8');
  assert.equal(item.notes, '');
}
function requireWrite(
  baseline: OwnedDomainSnapshot,
  current: OwnedDomainSnapshot,
  api: NativeTrainingApiRead,
  input: NativeTrainingJourneyInput,
  edited: boolean,
  planId?: string,
) {
  requireSnapshot(current, input);
  const plan = createdPlan(baseline, current);
  if (planId) assert.equal(plan.id, planId, 'Edit created a different plan identity');
  requirePlan(plan, input, edited);
  assert.deepEqual(current.connections, baseline.connections);
  assert.deepEqual(
    current.trainingPlans.filter((row) => row.id !== plan.id),
    baseline.trainingPlans,
    'Training journey mutated unrelated scoped plans',
  );
  assert.equal(api.status, 200);
  const body = record(api.plan);
  assert.equal(body.id, plan.id);
  assert.equal(body.name, plan.name);
  assert.deepEqual(body.sessions, plan.sessions, 'Authenticated API and independent SQL disagree');
  return plan.id;
}
/** State/API verifier only. Native UI, transport, artifact and cleanup proof belong to the owned runtime adapter. */
export function requireNativeTrainingJourneyState(
  input: NativeTrainingJourneyInput,
  state: NativeTrainingJourneyState,
) {
  for (const snapshot of [
    state.baseline,
    state.draft,
    state.created,
    state.editedDraft,
    state.edited,
    state.durable,
  ])
    requireSnapshot(snapshot, input);
  assert.deepEqual(state.draft, state.baseline, 'New draft persisted before Save');
  const planId = requireWrite(state.baseline, state.created, state.apiReads.created, input, false);
  assert.deepEqual(state.editedDraft, state.created, 'Edited draft persisted before second Save');
  requireWrite(state.baseline, state.edited, state.apiReads.edited, input, true, planId);
  const firstPlan = state.created.trainingPlans.find((row) => row.id === planId)!;
  const editedPlan = state.edited.trainingPlans.find((row) => row.id === planId)!;
  assert.equal(editedPlan.createdAt, firstPlan.createdAt, 'Edit reset the plan creation identity');
  assert.equal(
    record(editedPlan.sessions[0]).id,
    record(firstPlan.sessions[0]).id,
    'Quantity edit replaced the session identity',
  );
  requireWrite(state.baseline, state.durable, state.apiReads.durable, input, true, planId);
  assert.deepEqual(state.durable, state.edited, 'Restart lost or mutated the saved training plan');
  return { planId, scope: 'owned state/API checkpoint verification only; no native behavior pass' };
}
export type NativeTrainingJourneyDriver = {
  normalEntry(): Promise<void>;
  createDraft(values: {
    title: string;
    sessionName: string;
    exerciseId: string;
    exerciseName: string;
    quantity: string;
  }): Promise<void>;
  saveAndReopen(planId?: string): Promise<void>;
  editDraft(values: {
    planId: string;
    title: string;
    exerciseId: string;
    exerciseName: string;
    quantity: string;
    method: 'remove-confirm-readd';
  }): Promise<void>;
  restartAndReopen(planId: string): Promise<void>;
  snapshot(): Promise<OwnedDomainSnapshot>;
  readPlan(planId: string): Promise<NativeTrainingApiRead>;
};
/** Ordered controller. Callbacks require qualified engine/platform bindings; this function alone supplies no UI or lifecycle evidence. */
export async function runNativeTrainingJourney(
  input: NativeTrainingJourneyInput,
  driver: NativeTrainingJourneyDriver,
) {
  requireInput(input);
  const title = `QA training ${input.attemptId}`;
  await driver.normalEntry();
  const baseline = await driver.snapshot();
  requireSnapshot(baseline, input);
  await driver.createDraft({
    title,
    sessionName: 'Strength',
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    quantity: '3x8',
  });
  const draft = await driver.snapshot();
  requireSnapshot(draft, input);
  assert.deepEqual(draft, baseline, 'New draft persisted before Save');
  await driver.saveAndReopen();
  const created = await driver.snapshot();
  requireSnapshot(created, input);
  const planId = createdPlan(baseline, created).id;
  const createdRead = await driver.readPlan(planId);
  requireWrite(baseline, created, createdRead, input, false);
  await driver.editDraft({
    planId,
    title: `${title} updated`,
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    quantity: '4x10',
    method: 'remove-confirm-readd',
  });
  const editedDraft = await driver.snapshot();
  requireSnapshot(editedDraft, input);
  assert.deepEqual(editedDraft, created, 'Edited draft persisted before second Save');
  await driver.saveAndReopen(planId);
  const edited = await driver.snapshot();
  requireSnapshot(edited, input);
  const editedRead = await driver.readPlan(planId);
  requireWrite(baseline, edited, editedRead, input, true, planId);
  const createdPlanRow = created.trainingPlans.find((row) => row.id === planId)!;
  const editedPlanRow = edited.trainingPlans.find((row) => row.id === planId)!;
  assert.equal(editedPlanRow.createdAt, createdPlanRow.createdAt);
  assert.equal(record(editedPlanRow.sessions[0]).id, record(createdPlanRow.sessions[0]).id);
  await driver.restartAndReopen(planId);
  const durable = await driver.snapshot();
  requireSnapshot(durable, input);
  const durableRead = await driver.readPlan(planId);
  const state: NativeTrainingJourneyState = {
    baseline,
    draft,
    created,
    editedDraft,
    edited,
    durable,
    apiReads: { created: createdRead, edited: editedRead, durable: durableRead },
  };
  return { ...requireNativeTrainingJourneyState(input, state), state };
}

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeHierarchyHasAttribute } from './native-hierarchy';
import { enUS } from '../../localization/en-US';
import type { startOwnedApiProxy } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures } from './owned-session';

const exact = (text: string) =>
  JSON.stringify('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
function nodes(tree: unknown): Record<string, unknown>[] {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return [];
  const node = tree as { attributes?: Record<string, unknown>; children?: unknown[] };
  return [...(node.attributes ? [node.attributes] : []), ...(node.children ?? []).flatMap(nodes)];
}
function bounds(value: unknown) {
  assert.equal(typeof value, 'string');
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value as string);
  assert(match, 'Native confirmation has no usable relational bounds');
  return match.slice(1).map(Number);
}
/** Observe before binding the relational Delete selector. Never uses point/index fallback. */
export function requireIosItemRemovalPrompt(tree: unknown) {
  const body = enUS['pro.plan.delete.body'];
  const all = nodes(tree);
  const anchors = all.filter((row) => row.accessibilityText === body);
  assert.equal(anchors.length, 1, 'Removal body anchor is ambiguous');
  const anchorBottom = bounds(anchors[0].bounds)[3];
  for (const text of [enUS['common.cta.cancel'], enUS['common.cta.delete']]) {
    const targets = all.filter(
      (row) =>
        row.accessibilityText === text &&
        row.enabled === 'true' &&
        bounds(row.bounds)[1] >= anchorBottom,
    );
    assert.equal(
      targets.length,
      1,
      'Enabled removal action below the body is ambiguous or missing',
    );
  }
  return body;
}
/** Scoped inventory/action qualification only; not a public native behavior receipt. */
export async function observeIosTrainingLocalEdit(input: {
  output: string;
  fixtures: OwnedFixtures;
  report: Record<string, unknown>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  observe: (
    label: string,
    actions: string,
    viewId: string,
    selectors: string | string[],
    kind?: 'id' | 'text',
  ) => Promise<void>;
}) {
  const { output, fixtures, report, snapshot, proxy, observe } = input;
  assert.equal(fixtures.scope, 'native-entry-ios');
  const before = await snapshot();
  assert.equal(before.runId, fixtures.runId);
  const seeded = before.trainingPlans.find((row) => row.id === fixtures.savedPlanId);
  assert(seeded);
  const seededSession = seeded.sessions[0] as {
    name: string;
    items: { name: string; exerciseId: string; quantity: string }[];
  };
  assert.equal(seededSession.name, 'Upper');
  assert.equal(seededSession.items.length, 1);
  const item = seededSession.items[0];
  assert.equal(item.name, 'QA Exercise');
  assert.equal(item.quantity, '3x8');
  assert.equal(item.exerciseId, fixtures.draft.sessions[0].items[0].exerciseId);
  const tap = (id: string) => `- tapOn:\n    id: ${JSON.stringify(id)}\n`;
  const scroll = (id: string) =>
    `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(id)}\n    direction: DOWN\n    timeout: 20000\n    centerElement: true\n`;
  const persist = (label: string, value: unknown) =>
    writeFile(path.join(output, `${label}.private.json`), JSON.stringify(value), {
      mode: 0o600,
      flag: 'wx',
    });
  await persist('local-edit-before', before);
  await observe(
    'training-library',
    scroll('pro.home.trainingCta') + tap('pro.home.trainingCta'),
    'SCR-training-library',
    ['pro.library.training.create', `pro.library.training.row.${fixtures.savedPlanId}`],
  );
  await observe(
    'local-edit-original',
    tap(`pro.library.training.row.${fixtures.savedPlanId}`) +
      scroll('pro.training_plan.itemRow.QA_Exercise.quantity'),
    'SCR-training-builder',
    ['pro.training_plan.sessionRow.Upper', 'pro.training_plan.itemRow.QA_Exercise.quantity'],
  );
  await observe(
    'item-removal-prompt',
    scroll('pro.training_plan.itemRow.QA_Exercise.remove') +
      tap('pro.training_plan.itemRow.QA_Exercise.remove'),
    'STATE-item-removal-confirm',
    enUS['pro.plan.delete.body'],
    'text',
  );
  const prompt = JSON.parse(
    await readFile(path.join(output, 'item-removal-prompt-hierarchy.json'), 'utf8'),
  ) as unknown;
  const body = requireIosItemRemovalPrompt(prompt);
  await observe(
    'local-edit-removed',
    `- tapOn:\n    text: ${exact(enUS['common.cta.delete'])}\n    below:\n      text: ${exact(body)}\n    enabled: true\n- assertNotVisible:\n    id: pro.training_plan.itemRow.QA_Exercise\n`,
    'SCR-training-builder',
    ['pro.training_plan.sessionRow.Upper.addItem'],
  );
  const removed = await snapshot();
  assert.deepEqual(removed, before, 'Local removal persisted before Save');
  await persist('local-edit-removed-sql', removed);
  await observe(
    'local-edit-search',
    tap('pro.training_plan.sessionRow.Upper.addItem') +
      tap('exerciseSearch.input') +
      '- inputText: "QA Exercise"\n- pressKey: enter\n' +
      `- extendedWaitUntil:\n    visible:\n      id: exerciseSearch.result.${item.exerciseId}\n    timeout: 30000\n`,
    'STATE-exercise-search',
    [`exerciseSearch.result.${item.exerciseId}`],
  );
  await observe(
    'local-edit-detail',
    tap(`exerciseSearch.result.${item.exerciseId}`),
    'STATE-exercise-detail',
    ['exerciseSearch.detail'],
  );
  await observe(
    'local-edit-readded',
    scroll('exerciseSearch.quantity') +
      tap('exerciseSearch.quantity') +
      '- inputText: "4x10"\n- pressKey: enter\n' +
      scroll('exerciseSearch.confirm') +
      tap('exerciseSearch.confirm') +
      '- extendedWaitUntil:\n    notVisible:\n      id: exerciseSearch.modal\n    timeout: 30000\n' +
      scroll('pro.training_plan.itemRow.en_QA_Exercise_1.quantity'),
    'SCR-training-builder',
    ['pro.training_plan.sessionRow.Upper', 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity'],
  );
  const tree = JSON.parse(
    await readFile(path.join(output, 'local-edit-readded-hierarchy.json'), 'utf8'),
  ) as unknown;
  const quantities = nodes(tree).filter(
    (row) => row['resource-id'] === 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
  );
  assert.equal(quantities.length, 1, 'Canonical re-added quantity identity is ambiguous');
  assert.equal(quantities[0].accessibilityText, '4x10', 'Re-added exercise quantity missing');
  assert(
    !nativeHierarchyHasAttribute(tree, 'resource-id', 'pro.training_plan.itemRow.QA_Exercise'),
    'Old seeded item still present',
  );
  const after = await snapshot();
  assert.deepEqual(after, before, 'Local re-add persisted before Save');
  await persist('local-edit-after', after);
  const api = await proxy.readObservedNativeTrainingPlan({
    fixtureScope: 'native-entry-ios',
    accountUid: fixtures.accounts.coach.authUid,
    planId: fixtures.savedPlanId,
  });
  assert.deepEqual((api.plan as { sessions: unknown }).sessions, seeded.sessions);
  await persist('local-edit-api', api);
  report.localEditPreparation = {
    fixtureRunId: before.runId,
    savedPlanId: fixtures.savedPlanId,
    exerciseId: item.exerciseId,
    quantity: '4x10',
    sqlUnchanged: true,
    originalApiUnchanged: true,
    removalSelector: 'Delete enabled below observed body',
    copyLimitation: 'Existing generic plan-delete body appears for item removal',
    scope: 'native local removal/re-add action qualification only; zero public behavior passes',
  };
}

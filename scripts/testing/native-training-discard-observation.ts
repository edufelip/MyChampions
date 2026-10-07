import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { enUS } from '../../localization/en-US';
import type { ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

/** Inventory preparation only. No plan write or behavioral qualification. */
export async function observeIosTrainingDiscard({
  output,
  savedPlanId,
  report,
  snapshot,
  observations,
  observe,
}: {
  output: string;
  savedPlanId: string;
  report: Record<string, unknown>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  observations: () => readonly ProxyObservation[];
  observe: (
    label: string,
    actions: string,
    viewId: string,
    selectors: string | string[],
    kind?: 'id' | 'text',
  ) => Promise<void>;
}) {
  const before = await snapshot();
  await writeFile(path.join(output, 'discard-before.private.json'), JSON.stringify(before), {
    flag: 'wx',
    mode: 0o600,
  });
  const back =
    '- scrollUntilVisible:\n    element:\n      id: pro.training_plan.backButton\n    direction: UP\n    timeout: 20000\n- tapOn:\n    id: pro.training_plan.backButton';
  const exact = (text: string) =>
    JSON.stringify('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  await observe(
    'discard-prompt',
    back,
    'STATE-discard-confirm',
    enUS['pro.plan.discard.title'],
    'text',
  );
  await observe(
    'discard-kept',
    `- tapOn: ${exact(enUS['pro.plan.discard.no'])}`,
    'SCR-training-builder',
    ['pro.training_plan.screen', 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity'],
  );
  await observe(
    'discard-reopened',
    back,
    'STATE-discard-confirm',
    enUS['pro.plan.discard.title'],
    'text',
  );
  await observe(
    'discard-library',
    `- tapOn: ${exact(enUS['pro.plan.discard.yes'])}`,
    'SCR-training-library',
    ['pro.library.training.create', `pro.library.training.row.${savedPlanId}`],
  );
  await observe(
    'discard-fresh-builder',
    '- tapOn:\n    id: pro.library.training.create\n- assertNotVisible:\n    id: pro.training_plan.sessionRow.Strength\n- assertNotVisible:\n    id: pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
    'SCR-training-builder',
    ['pro.training_plan.screen', 'pro.training_plan.name'],
  );
  const after = await snapshot();
  await writeFile(path.join(output, 'discard-after.private.json'), JSON.stringify(after), {
    flag: 'wx',
    mode: 0o600,
  });
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Native discard inventory changed persisted domain state');
  const route = createHash('sha256').update('/plans/training').digest('hex');
  if (observations().some((row) => row.method === 'POST' && row.pathHash === route))
    throw new Error('Native discard inventory submitted a plan write');
  report.discardPreparation = {
    requirementRefs: ['SC-208', 'TC-304', 'UC-002.7'],
    savedPlanId,
    draftName: 'Native QA Draft',
    sessionName: 'Strength',
    exerciseId: '00000000-0000-4000-8000-000000000001',
    exerciseName: 'en QA Exercise 1',
    quantity: '3x8',
    snapshotPaths: ['discard-before.private.json', 'discard-after.private.json'],
    ownedSqlBeforeAfterUnchanged: true,
    scope: 'native-discard-dialog-and-local-draft-views-only; no saved-plan behavior pass',
  };
}

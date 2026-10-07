import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeHierarchyHasAttribute } from './native-hierarchy';
import type { ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

/** Shared draft observations; ownership and platform actions stay in their existing captures. */
export async function observeNativeTrainingDraft({
  platform,
  output,
  savedPlanId,
  report,
  snapshot,
  observations,
  observe,
}: {
  platform: 'ios' | 'android';
  output: string;
  savedPlanId: string;
  report: Record<string, unknown>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  observations: () => readonly ProxyObservation[];
  observe: (label: string, actions: string, viewId: string, selectors: string[]) => Promise<void>;
}) {
  const snapshotBefore = await snapshot();
  await writeFile(path.join(output, 'draft-before.private.json'), JSON.stringify(snapshotBefore), {
    flag: 'wx',
    mode: 0o600,
  });
  const tap = (id: string) => `- tapOn:\n    id: ${id}\n`;
  const enter = (value: string) => `- inputText: ${JSON.stringify(value)}\n`;
  // These inputs already dismiss on submit. Avoid iOS hideKeyboard swipes over results.
  const submitAndDismiss = platform === 'ios' ? '- pressKey: enter\n' : '- hideKeyboard\n';
  const scroll = (id: string) =>
    `- scrollUntilVisible:\n    element:\n      id: ${id}\n    direction: DOWN\n    timeout: 20000\n    centerElement: true\n`;
  await observe(
    'training-library',
    scroll('pro.home.trainingCta') +
      tap('pro.home.trainingCta') +
      scroll('pro.library.training.create'),
    'SCR-training-library',
    ['pro.library.training.create', `pro.library.training.row.${savedPlanId}`],
  );
  report.trainingEntry = {
    selector: 'pro.home.trainingCta',
    destination: '/professional/training',
    sourcePath: 'app/professional/home.tsx',
    ...(platform === 'android'
      ? { unresolvedAlternative: 'tabs.training', retainedAttempt: '01f9ecf458b96db24cfd9dbf' }
      : {}),
  };
  await observe('training-builder', tap('pro.library.training.create'), 'SCR-training-builder', [
    'pro.training_plan.name',
  ]);
  await observe(
    'session-editor',
    tap('pro.training_plan.name') +
      enter('Native QA Draft') +
      '- hideKeyboard\n' +
      scroll('pro.training_plan.addSession') +
      tap('pro.training_plan.addSession') +
      '- hideKeyboard\n',
    'STATE-session-editor',
    ['pro.training_plan.addSession.name'],
  );
  await observe(
    'exercise-search',
    tap('pro.training_plan.addSession.name') +
      enter('Strength') +
      '- hideKeyboard\n' +
      scroll('pro.training_plan.addSession.confirm') +
      '- assertVisible:\n    id: pro.training_plan.addSession.confirm\n' +
      tap('pro.training_plan.addSession.confirm') +
      scroll('pro.training_plan.sessionRow.Strength.addItem') +
      tap('pro.training_plan.sessionRow.Strength.addItem') +
      '- extendedWaitUntil:\n    visible:\n      id: exerciseSearch.input\n    timeout: 30000\n' +
      tap('exerciseSearch.input') +
      '- hideKeyboard\n',
    'STATE-exercise-search',
    ['exerciseSearch.input', 'exerciseSearch.initialState'],
  );
  const exerciseId = '00000000-0000-4000-8000-000000000001';
  await observe(
    'exercise-detail',
    tap('exerciseSearch.input') +
      enter('QA Exercise') +
      submitAndDismiss +
      '- extendedWaitUntil:\n    visible:\n' +
      `      id: exerciseSearch.result.${exerciseId}\n    timeout: 30000\n` +
      tap(`exerciseSearch.result.${exerciseId}`),
    'STATE-exercise-detail',
    ['exerciseSearch.detail'],
  );
  await observe(
    'draft-preview',
    scroll('exerciseSearch.quantity') +
      tap('exerciseSearch.quantity') +
      enter('3x8') +
      submitAndDismiss +
      scroll('exerciseSearch.confirm') +
      tap('exerciseSearch.confirm') +
      '- extendedWaitUntil:\n    notVisible:\n      id: exerciseSearch.modal\n    timeout: 30000\n' +
      scroll('pro.training_plan.itemRow.en_QA_Exercise_1.quantity'),
    'SCR-training-builder',
    ['pro.training_plan.itemRow.en_QA_Exercise_1.quantity'],
  );
  const draftTree = JSON.parse(
    await readFile(path.join(output, 'draft-preview-hierarchy.json'), 'utf8'),
  ) as unknown;
  if (
    !nativeHierarchyHasAttribute(
      draftTree,
      platform === 'android' ? 'text' : 'accessibilityText',
      '3x8',
    )
  )
    throw new Error('Actual native draft does not show the entered quantity');
  for (const [method, route] of [
    ['POST', '/integrations/exercise/search'],
    ['GET', `/integrations/exercise/exercises/${exerciseId}`],
  ]) {
    const routeHash = createHash('sha256').update(route).digest('hex');
    if (
      !observations().some(
        (row) =>
          row.method === method &&
          row.pathHash === routeHash &&
          row.status === 200 &&
          row.outcome === 'forwarded' &&
          row.requestProfile === 'native',
      )
    )
      throw new Error('Native exercise catalog preparation lacks the owned normal API read');
  }
  const snapshotAfter = await snapshot();
  await writeFile(path.join(output, 'draft-after.private.json'), JSON.stringify(snapshotAfter), {
    flag: 'wx',
    mode: 0o600,
  });
  if (JSON.stringify(snapshotBefore) !== JSON.stringify(snapshotAfter))
    throw new Error(
      'Training draft preparation changed persisted plan/connection state before Save',
    );
  report.draftPreparation = {
    requirementRefs: ['SC-208', 'TC-303', 'BR-293', 'BR-294', 'UC-002.7'],
    catalogExerciseId: exerciseId,
    quantityObserved: true,
    ownedSqlBeforeAfterUnchanged: true,
    snapshotPaths: ['draft-before.private.json', 'draft-after.private.json'],
  };
}

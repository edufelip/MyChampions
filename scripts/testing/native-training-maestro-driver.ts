import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireAndroidNativeInputValue } from './android-native-input-reader';
import {
  nativeItemRemovalBody,
  requireIosItemRemovalPrompt,
} from './native-training-edit-observation';
import { runNativeTrainingJourney } from './native-training-journey';
import {
  nativeTrainingQuantityContract,
  nativeTrainingQuantityYaml,
} from './native-training-quantity-contract';
import { enUS } from '../../localization/en-US';
import type { AndroidNativeInputObservation } from './android-native-input-reader';
import type {
  NativeTrainingJourneyDriver,
  NativeTrainingJourneyInput,
} from './native-training-journey';
import type { startOwnedApiProxy } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures } from './owned-session';

export type NativeTrainingObserve = (
  label: string,
  actions: string,
  viewId: string,
  selectors: string | string[],
  kind?: 'id' | 'text',
) => Promise<void>;
type Observe = NativeTrainingObserve;
const exact = (text: string) =>
  JSON.stringify('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
const segment = (name: string) => name.trim().replace(/[^A-Za-z0-9_-]+/g, '_');
const tap = (id: string) => `- tapOn:\n    id: ${JSON.stringify(id)}\n`;
const scroll = (id: string, direction = 'DOWN') =>
  `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(id)}\n    direction: ${direction}\n    timeout: 20000\n    centerElement: true\n`;
const enter = (value: string) => `- inputText: ${JSON.stringify(value)}\n`;
function trees(tree: unknown): { attributes?: Record<string, unknown>; children?: unknown[] }[] {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return [];
  const node = tree as { attributes?: Record<string, unknown>; children?: unknown[] };
  return [node, ...(node.children ?? []).flatMap(trees)];
}
function allNodes(tree: unknown) {
  return trees(tree).flatMap((node) => (node.attributes ? [node.attributes] : []));
}
/** Exact captured field assertions, independent of Maestro's selector success. */
export function requireNativeTrainingPreview(
  platform: 'ios' | 'android',
  tree: unknown,
  title: string,
  exerciseName: string,
  quantity: string,
) {
  assert(['ios', 'android'].includes(platform));
  const matches = (row: Record<string, unknown>, id: string) =>
    row['resource-id'] === id ||
    (platform === 'android' && row['resource-id'] === `com.edufelip.mychampions.dev:id/${id}`);
  const nodes = allNodes(tree);
  const names = nodes.filter((row) => matches(row, 'pro.training_plan.name'));
  assert.equal(names.length, 1, 'Native title field is missing or ambiguous');
  assert.equal(names[0][platform === 'ios' ? 'value' : 'text'], title, 'Native title differs');
  const sessions = trees(tree).filter(
    (row) => row.attributes && matches(row.attributes, 'pro.training_plan.sessionRow.Strength'),
  );
  assert.equal(sessions.length, 1, 'Native session is missing or ambiguous');
  const sessionNodes = allNodes(sessions[0]);
  const itemId = `pro.training_plan.itemRow.${segment(exerciseName)}`;
  assert.equal(
    sessionNodes.filter((row) => matches(row, itemId)).length,
    1,
    'Canonical item is not inside the expected session',
  );
  const quantities = sessionNodes.filter((row) => matches(row, `${itemId}.quantity`));
  assert.equal(
    quantities.length,
    1,
    'Canonical quantity is missing or ambiguous inside the session',
  );
  assert.equal(
    quantities[0][platform === 'ios' ? 'accessibilityText' : 'text'],
    quantity,
    'Native quantity differs',
  );
}
export function requireIosTrainingPreview(
  tree: unknown,
  title: string,
  exerciseName: string,
  quantity: string,
) {
  requireNativeTrainingPreview('ios', tree, title, exerciseName, quantity);
}

export function requireAndroidTrainingTitle(tree: unknown, title: string) {
  const fields = allNodes(tree).filter((row) =>
    ['pro.training_plan.name', 'com.edufelip.mychampions.dev:id/pro.training_plan.name'].includes(
      String(row['resource-id']),
    ),
  );
  assert.equal(fields.length, 1, 'Android title field is missing or ambiguous');
  assert.equal(fields[0].enabled, 'true', 'Android title is disabled');
  assert.equal(fields[0].text, title, 'Android title differs or was not completely cleared');
}
export function requireAndroidClearedTrainingTitle(
  tree: unknown,
  observation: AndroidNativeInputObservation,
  captureRunId: string,
) {
  assert.equal(
    observation.captureRunId,
    captureRunId,
    'Raw Android title belongs to another capture',
  );
  assert.equal(
    observation.label,
    'journey-edit-title-cleared',
    'Raw Android title belongs to another step',
  );
  requireAndroidNativeInputValue(observation, '', enUS['pro.plan.field.name.placeholder']);
  const fields = allNodes(tree).filter((row) =>
    ['pro.training_plan.name', 'com.edufelip.mychampions.dev:id/pro.training_plan.name'].includes(
      String(row['resource-id']),
    ),
  );
  assert.equal(fields.length, 1, 'Cleared Android title field is missing or ambiguous');
  assert.equal(fields[0].enabled, 'true');
  assert.equal(fields[0].class, 'android.widget.EditText');
  assert.equal(fields[0].text, observation.nativeText, 'Android hierarchy and raw title differ');
  assert.equal(fields[0].hintText, observation.hintText, 'Android hierarchy and raw hint differ');
}
/** The fresh builder's observed guidance is outside the input that intercepted default scrolling. */
export function requireAndroidTrainingGuidanceAnchor(tree: unknown) {
  requireAndroidGuidanceAnchor(tree, 'pro.training_plan.name');
}
/**
 * The add-session form opens scrolled into view above the keyboard: the form, its name
 * field and both actions are on screen, so no swipe is needed to reach Add session.
 */
export function requireAndroidSessionEditorVisible(tree: unknown) {
  const nodes = allNodes(tree);
  const byId = (id: string) =>
    nodes.filter((row) =>
      [id, `com.edufelip.mychampions.dev:id/${id}`].includes(String(row['resource-id'])),
    );
  const box = (row: Record<string, unknown>, label: string) => {
    const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(String(row.bounds));
    assert(match, `${label} bounds missing`);
    const [left, top, right, bottom] = match.slice(1).map(Number);
    assert(right > left && bottom > top, `${label} bounds invalid`);
    return { left, top, right, bottom };
  };
  const unique = (id: string, label: string) => {
    const rows = byId(id);
    assert.equal(rows.length, 1, `${label} is missing or ambiguous`);
    assert.equal(rows[0].enabled, 'true', `${label} is disabled`);
    return rows[0];
  };
  const screen = box(unique('pro.training_plan.screen', 'Training builder'), 'Training builder');
  const form = box(unique('pro.training_plan.addSession.form', 'Session form'), 'Session form');
  const inside = (inner: ReturnType<typeof box>, outer: ReturnType<typeof box>) =>
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom;
  assert(inside(form, screen), 'Session form is not fully on screen');
  const nameRow = unique('pro.training_plan.addSession.name', 'Session name field');
  assert.equal(nameRow.class, 'android.widget.EditText', 'Session name is not a text field');
  const name = box(nameRow, 'Session name field');
  assert(inside(name, form), 'Session name field is outside the form');
  for (const [id, label] of [
    ['pro.training_plan.addSession.confirm', 'Add session action'],
    ['pro.training_plan.addSession.cancel', 'Cancel action'],
  ] as const) {
    const action = box(unique(id, label), label);
    assert(inside(action, form) && action.top >= name.bottom, `${label} is not below the name`);
  }
}
function requireAndroidGuidanceAnchor(
  tree: unknown,
  fieldId: 'pro.training_plan.name' | 'pro.training_plan.addSession.name',
) {
  const nodes = allNodes(tree);
  const description = enUS['pro.plan.builder.guidance.training.body'];
  const anchors = nodes.filter((row) => row.text === description);
  const fields = nodes.filter((row) =>
    [fieldId, `com.edufelip.mychampions.dev:id/${fieldId}`].includes(String(row['resource-id'])),
  );
  assert.equal(anchors.length, 1, 'Android guidance anchor missing or ambiguous');
  assert.equal(fields.length, 1, 'Android guidance input anchor missing or ambiguous');
  if (fieldId === 'pro.training_plan.addSession.name') {
    assert.equal(fields[0].enabled, 'true');
    assert.equal(fields[0].class, 'android.widget.EditText');
  }
  assert.equal(anchors[0].enabled, 'true');
  assert.equal(anchors[0].class, 'android.widget.TextView');
  const bounds = (row: Record<string, unknown>) =>
    /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(String(row.bounds));
  const anchor = bounds(anchors[0]),
    field = bounds(fields[0]);
  assert(
    anchor &&
      field &&
      Number(anchor[3]) > Number(anchor[1]) &&
      Number(anchor[4]) > Number(anchor[2]) &&
      Number(field[3]) > Number(field[1]) &&
      Number(field[4]) > Number(field[2]) &&
      Number(anchor[4]) <= Number(field[2]),
    'Android guidance anchor overlaps the input or has invalid bounds',
  );
}
export function requireAndroidSelectAllMenu(tree: unknown) {
  const actions = allNodes(tree).filter((row) => row.text === 'Select all');
  assert.equal(actions.length, 1, 'Android Select all action is missing or ambiguous');
  assert.equal(actions[0].enabled, 'true', 'Android Select all action is disabled');
}
export function requireAndroidItemRemovalPrompt(tree: unknown, exerciseName: string) {
  const nodes = allNodes(tree),
    body = nativeItemRemovalBody(exerciseName);
  const messages = nodes.filter((row) => row['resource-id'] === 'android:id/message');
  assert.equal(messages.length, 1, 'Android removal body anchor is missing or ambiguous');
  assert.equal(messages[0].text, body, 'Android removal body differs');
  const bottom = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(String(messages[0].bounds));
  assert(bottom, 'Android removal body bounds missing');
  assert(
    Number(bottom[3]) > Number(bottom[1]) && Number(bottom[4]) > Number(bottom[2]),
    'Android removal body bounds invalid',
  );
  for (const [id, caption] of [
    ['android:id/button1', enUS['common.cta.delete']],
    ['android:id/button2', enUS['common.cta.cancel']],
  ]) {
    const buttons = nodes.filter((row) => row['resource-id'] === id);
    assert.equal(buttons.length, 1, 'Android removal action missing or ambiguous');
    assert.equal(buttons[0].enabled, 'true', 'Android removal action disabled');
    assert(
      typeof buttons[0].text === 'string' &&
        buttons[0].text.toLowerCase() === caption.toLowerCase(),
      'Android removal caption differs',
    );
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(String(buttons[0].bounds));
    assert(
      bounds &&
        Number(bounds[2]) >= Number(bottom[4]) &&
        Number(bounds[3]) > Number(bounds[1]) &&
        Number(bounds[4]) > Number(bounds[2]),
      'Android removal action is outside the observed dialog',
    );
  }
  return body;
}
/** Native text editing must establish selection/clearing instead of backspacing at an unknown cursor. */
export function requireIosTrainingTitleKeyboard(tree: unknown, title: string) {
  const nodes = allNodes(tree);
  const fields = nodes.filter((row) => row['resource-id'] === 'pro.training_plan.name');
  assert.equal(fields.length, 1, 'Native title field is missing or ambiguous');
  assert.equal(fields[0].enabled, 'true', 'Native title is disabled');
  assert.equal(fields[0].value, title, 'Native title changed during focus');
  for (const id of ['inputView', 'delete']) {
    assert.equal(
      nodes.filter((row) => row['resource-id'] === id && row.enabled === 'true').length,
      1,
      `Native keyboard ${id} is missing or ambiguous`,
    );
  }
}
export function requireIosSelectAllMenu(tree: unknown) {
  assert.equal(
    allNodes(tree).filter((row) => row.accessibilityText === 'Select All' && row.enabled === 'true')
      .length,
    1,
    'Native Select All action is missing or ambiguous',
  );
}
export function requireIosClearedTrainingTitle(tree: unknown) {
  const fields = allNodes(tree).filter((row) => row['resource-id'] === 'pro.training_plan.name');
  assert.equal(fields.length, 1, 'Native title field is missing or ambiguous');
  assert.equal(fields[0].value, '', 'Native title was not completely cleared');
}
/** Small UI diagnostic only: qualify selection/clear before repeating a saved journey. */
export async function observeIosTrainingTitleSelection(options: {
  method?: 'menu' | 'paragraph-gesture';
  output: string;
  fixtures: OwnedFixtures;
  report: Record<string, unknown>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  observe: Observe;
}) {
  const { output, fixtures, observe, snapshot, report } = options;
  const method = options.method ?? 'menu';
  assert(['menu', 'paragraph-gesture'].includes(method));
  assert.equal(fixtures.scope, 'native-entry-ios');
  const before = await snapshot();
  const title = `QA training ${fixtures.runId}:first`;
  const persist = (label: string, value: unknown) =>
    writeFile(path.join(output, `${label}.private.json`), JSON.stringify(value), {
      flag: 'wx',
      mode: 0o600,
    });
  const hierarchy = async (label: string) =>
    JSON.parse(await readFile(path.join(output, `${label}-hierarchy.json`), 'utf8')) as unknown;
  await persist('title-selection-before', before);
  await observe(
    'title-library',
    scroll('pro.home.trainingCta') + tap('pro.home.trainingCta'),
    'SCR-training-library',
    ['pro.library.training.create'],
  );
  await observe(
    'title-keyboard',
    tap('pro.library.training.create') + tap('pro.training_plan.name') + enter(title),
    'SCR-training-builder',
    ['pro.training_plan.name', 'inputView'],
  );
  requireIosTrainingTitleKeyboard(await hierarchy('title-keyboard'), title);
  if (method === 'menu') {
    await observe(
      'title-partial-selection',
      '- longPressOn:\n    id: pro.training_plan.name\n',
      'SCR-training-builder',
      ['pro.training_plan.name', 'inputView'],
    );
    requireIosTrainingTitleKeyboard(await hierarchy('title-partial-selection'), title);
    await observe(
      'title-selection-menu',
      tap('pro.training_plan.name'),
      'STATE-native-text-edit-menu',
      'Select All',
      'text',
    );
    requireIosSelectAllMenu(await hierarchy('title-selection-menu'));
  } else {
    await observe(
      'title-paragraph-selection',
      '- tapOn:\n    id: pro.training_plan.name\n    repeat: 3\n    delay: 100\n',
      'SCR-training-builder',
      ['pro.training_plan.name', 'inputView'],
    );
    requireIosTrainingTitleKeyboard(await hierarchy('title-paragraph-selection'), title);
  }
  await observe(
    'title-cleared',
    (method === 'menu' ? '- tapOn: "^Select All$"\n' : '') + '- eraseText: 1\n',
    'SCR-training-builder',
    ['pro.training_plan.name'],
  );
  requireIosClearedTrainingTitle(await hierarchy('title-cleared'));
  await observe(
    'title-replaced',
    tap('pro.training_plan.name') + enter(`${title} updated`),
    'SCR-training-builder',
    ['pro.training_plan.name', 'inputView'],
  );
  requireIosTrainingTitleKeyboard(await hierarchy('title-replaced'), `${title} updated`);
  const after = await snapshot();
  assert.deepEqual(after, before, 'Title-only diagnostic persisted an unsaved draft');
  await persist('title-selection-after', after);
  report.titleSelectionPreparation = {
    method,
    fixtureRunId: fixtures.runId,
    originalTitle: title,
    updatedTitle: `${title} updated`,
    sqlUnchanged: true,
    scope: 'title editing diagnostic only; zero public native passing cases',
  };
}
/** Real Maestro actions are supplied through the existing owned capture executor. */
export type NativeTrainingMaestroDriverOptions = {
  input: NativeTrainingJourneyInput;
  output: string;
  observe: Observe;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  restartRuntime: () => Promise<void>;
  readAndroidTitle?: (label: string) => Promise<AndroidNativeInputObservation>;
};
const androidNewSessionReveal = () =>
  `- swipe:\n    from:\n      text: ${exact(enUS['pro.plan.builder.guidance.training.body'])}\n    direction: UP\n`;
async function clearAndroidTrainingTitle(
  options: Pick<NativeTrainingMaestroDriverOptions, 'output' | 'observe'> & {
    readAndroidTitle: NonNullable<NativeTrainingMaestroDriverOptions['readAndroidTitle']>;
    previousTitle: string;
  },
) {
  const { observe, output, previousTitle } = options;
  const hierarchy = async (label: string) =>
    JSON.parse(await readFile(path.join(output, `${label}-hierarchy.json`), 'utf8')) as unknown;
  await observe(
    'journey-edit-title-keyboard',
    scroll('pro.training_plan.name', 'UP') + tap('pro.training_plan.name'),
    'SCR-training-builder',
    ['pro.training_plan.name'],
  );
  requireAndroidTrainingTitle(await hierarchy('journey-edit-title-keyboard'), previousTitle);
  await observe(
    'journey-edit-title-selection-menu',
    '- longPressOn:\n    id: pro.training_plan.name\n' +
      `- runFlow:\n    when:\n      notVisible:\n        text: ${exact('Select all')}\n      visible:\n        id: ${exact('android:id/overflow')}\n    commands:\n      - tapOn:\n          id: ${exact('android:id/overflow')}\n`,
    'STATE-native-text-edit-menu',
    'Select all',
    'text',
  );
  requireAndroidSelectAllMenu(await hierarchy('journey-edit-title-selection-menu'));
  await observe(
    'journey-edit-title-cleared',
    `- tapOn:\n    text: ${exact('Select all')}\n- eraseText: 1\n`,
    'SCR-training-builder',
    ['pro.training_plan.name'],
  );
  const raw = await options.readAndroidTitle('journey-edit-title-cleared');
  requireAndroidClearedTrainingTitle(
    await hierarchy('journey-edit-title-cleared'),
    raw,
    path.basename(output),
  );
  return raw;
}

/** Small control qualification only. It never creates a session, presses Save or emits native scenario assertions. */
export async function observeAndroidTrainingInputControls(
  options: SavedNativeTrainingJourneyOptions,
) {
  assert.equal(options.fixtures.scope, 'native-entry-android');
  assert.equal(typeof options.readAndroidTitle, 'function');
  const input: NativeTrainingJourneyInput = {
    runId: options.fixtures.runId,
    attemptId: `${options.fixtures.runId}:first`,
    platform: 'android',
    accountUid: options.fixtures.accounts.coach.authUid,
    exerciseId: options.fixtures.draft.sessions[0].items[0].exerciseId,
    exerciseName: 'en QA Exercise 1',
  };
  const before = await options.snapshot();
  assert.equal(before.runId, input.runId);
  assert.equal(before.scope, options.fixtures.scope);
  const persist = (name: string, value: unknown) =>
    writeFile(path.join(options.output, `${name}.private.json`), JSON.stringify(value), {
      flag: 'wx',
      mode: 0o600,
    });
  await persist('android-input-controls-before', before);
  await createAndroidTrainingMaestroDriver({ ...options, input }).normalEntry();
  const initial = await options.readAndroidTitle!('journey-new-empty-title');
  requireAndroidNativeInputValue(initial, '', enUS['pro.plan.field.name.placeholder']);
  const title = `QA training ${input.attemptId}`;
  await options.observe(
    'journey-diagnostic-add-session-visible',
    tap('pro.training_plan.name') +
      enter(title) +
      '- hideKeyboard\n' +
      androidNewSessionReveal() +
      scroll('pro.training_plan.addSession'),
    'SCR-training-builder',
    ['pro.training_plan.addSession'],
  );
  const cleared = await clearAndroidTrainingTitle({
    ...options,
    readAndroidTitle: options.readAndroidTitle!,
    previousTitle: title,
  });
  const updated = `${title} updated`;
  await options.observe(
    'journey-diagnostic-replaced',
    tap('pro.training_plan.name') + enter(updated),
    'SCR-training-builder',
    ['pro.training_plan.name'],
  );
  requireAndroidTrainingTitle(
    JSON.parse(
      await readFile(
        path.join(options.output, 'journey-diagnostic-replaced-hierarchy.json'),
        'utf8',
      ),
    ),
    updated,
  );
  requireAndroidNativeInputValue(
    await options.readAndroidTitle!('journey-diagnostic-replaced'),
    updated,
    enUS['pro.plan.field.name.placeholder'],
  );
  const after = await options.snapshot();
  assert.deepEqual(after, before, 'Android input-only diagnostic persisted a draft');
  await persist('android-input-controls-after', after);
  options.report.inputControlsPreparation = {
    input,
    captureRunId: path.basename(options.output),
    initialShowingHintFlag: initial.isShowingHintText,
    clearedShowingHintFlag: cleared.isShowingHintText,
    originalTitle: title,
    updatedTitle: updated,
    addSessionVisible: true,
    sqlUnchanged: true,
    publicNativePassingCases: 0,
    scope:
      'private native input/reveal controls only; no session creation, Save, full training/public/comparison pass',
  };
}
export function createIosTrainingMaestroDriver(options: NativeTrainingMaestroDriverOptions) {
  assert.equal(options.input.platform, 'ios');
  return createNativeTrainingMaestroDriver(options);
}
export function createAndroidTrainingMaestroDriver(options: NativeTrainingMaestroDriverOptions) {
  assert.equal(options.input.platform, 'android');
  return createNativeTrainingMaestroDriver(options);
}
function createNativeTrainingMaestroDriver(
  options: NativeTrainingMaestroDriverOptions,
): NativeTrainingJourneyDriver {
  const { input, output, observe, proxy } = options;
  if (input.platform === 'android')
    assert.equal(
      typeof options.readAndroidTitle,
      'function',
      'Android journey requires independent native input observation',
    );
  const dismissKeyboard = input.platform === 'ios' ? '- pressKey: enter\n' : '- hideKeyboard\n';
  const revealSession =
    input.platform === 'android'
      ? '- swipe:\n    from:\n      id: pro.training_plan.sessionRow.Strength\n    direction: UP\n'
      : '';
  const revealNewSession = input.platform === 'android' ? androidNewSessionReveal() : '';
  let title = '';
  let quantity = '';
  let saves = 0;
  let snapshots = 0;
  let reads = 0;
  const phases = ['baseline', 'draft', 'created', 'edited-draft', 'edited', 'durable'];
  const persist = (label: string, value: unknown) =>
    writeFile(path.join(output, `training-journey-${label}.private.json`), JSON.stringify(value), {
      flag: 'wx',
      mode: 0o600,
    });
  const hierarchy = async (label: string) =>
    JSON.parse(await readFile(path.join(output, `${label}-hierarchy.json`), 'utf8')) as unknown;
  const preview = async (label: string, actions: string) => {
    const contract = nativeTrainingQuantityContract(label, input.exerciseName);
    assert.equal(quantity, contract.expected);
    await persist(`quantity-${label}`, {
      schemaVersion: 1,
      kind: 'required native training quantity assertion',
      captureRunId: path.basename(output),
      input,
      title,
      ...contract,
    });
    await observe(
      label,
      actions +
        revealSession +
        scroll(contract.selectorId) +
        nativeTrainingQuantityYaml(label, input.exerciseName),
      'SCR-training-builder',
      [`pro.training_plan.itemRow.${segment(input.exerciseName)}.quantity`],
    );
    requireNativeTrainingPreview(
      input.platform,
      await hierarchy(label),
      title,
      input.exerciseName,
      quantity,
    );
  };
  const addExercise = async (prefix: string) => {
    await observe(
      `${prefix}-search`,
      revealSession +
        scroll('pro.training_plan.sessionRow.Strength.addItem') +
        tap('pro.training_plan.sessionRow.Strength.addItem') +
        tap('exerciseSearch.input') +
        enter('QA Exercise') +
        dismissKeyboard +
        `- extendedWaitUntil:\n    visible:\n      id: exerciseSearch.result.${input.exerciseId}\n    timeout: 30000\n`,
      'STATE-exercise-search',
      [`exerciseSearch.result.${input.exerciseId}`],
    );
    await observe(
      `${prefix}-detail`,
      tap(`exerciseSearch.result.${input.exerciseId}`),
      'STATE-exercise-detail',
      ['exerciseSearch.detail'],
    );
    await preview(
      `${prefix}-preview`,
      scroll('exerciseSearch.quantity') +
        tap('exerciseSearch.quantity') +
        enter(quantity) +
        dismissKeyboard +
        scroll('exerciseSearch.confirm') +
        tap('exerciseSearch.confirm') +
        '- extendedWaitUntil:\n    notVisible:\n      id: exerciseSearch.modal\n    timeout: 30000\n',
    );
  };
  return {
    normalEntry: async () => {
      await observe(
        'journey-library',
        scroll('pro.home.trainingCta') + tap('pro.home.trainingCta'),
        'SCR-training-library',
        ['pro.library.training.create'],
      );
      await observe('journey-new', tap('pro.library.training.create'), 'SCR-training-builder', [
        'pro.training_plan.name',
      ]);
      if (input.platform === 'android') {
        await observe(
          'journey-new-guidance',
          '',
          'SCR-training-builder',
          enUS['pro.plan.builder.guidance.training.body'],
          'text',
        );
        requireAndroidTrainingGuidanceAnchor(await hierarchy('journey-new-guidance'));
      }
    },
    createDraft: async (values) => {
      assert.equal(values.exerciseId, input.exerciseId);
      assert.equal(values.exerciseName, input.exerciseName);
      assert.equal(values.sessionName, 'Strength');
      title = values.title;
      quantity = values.quantity;
      await observe(
        'journey-session-editor',
        tap('pro.training_plan.name') +
          enter(title) +
          '- hideKeyboard\n' +
          revealNewSession +
          scroll('pro.training_plan.addSession') +
          tap('pro.training_plan.addSession') +
          '- hideKeyboard\n',
        'STATE-session-editor',
        ['pro.training_plan.addSession.name'],
      );
      if (input.platform === 'android')
        requireAndroidSessionEditorVisible(await hierarchy('journey-session-editor'));
      await observe(
        'journey-session',
        tap('pro.training_plan.addSession.name') +
          enter(values.sessionName) +
          '- hideKeyboard\n' +
          scroll('pro.training_plan.addSession.confirm') +
          tap('pro.training_plan.addSession.confirm') +
          revealSession,
        'SCR-training-builder',
        ['pro.training_plan.sessionRow.Strength.addItem'],
      );
      await addExercise('journey-draft');
    },
    saveAndReopen: async (expectedPlanId) => {
      const label = ++saves === 1 ? 'journey-first-save' : 'journey-edited-save';
      await observe(
        `${label}-library`,
        scroll('pro.training_plan.saveButton') + tap('pro.training_plan.saveButton'),
        'SCR-training-library',
        ['pro.library.training.create'],
      );
      const state = await options.snapshot();
      const plans = state.trainingPlans.filter(
        (row) => row.name === title && row.ownerProfessionalUid === input.accountUid,
      );
      assert.equal(plans.length, 1, 'Saved native journey plan is missing or duplicated');
      if (expectedPlanId) assert.equal(plans[0].id, expectedPlanId);
      await preview(
        `${label}-reopened`,
        scroll(`pro.library.training.row.${plans[0].id}`) +
          tap(`pro.library.training.row.${plans[0].id}`),
      );
    },
    editDraft: async (values) => {
      assert.equal(values.method, 'remove-confirm-readd');
      assert.equal(values.exerciseId, input.exerciseId);
      assert.equal(values.exerciseName, input.exerciseName);
      const previousTitle = title;
      title = values.title;
      quantity = values.quantity;
      if (input.platform === 'ios') {
        await observe(
          'journey-edit-title-keyboard',
          scroll('pro.training_plan.name', 'UP') + tap('pro.training_plan.name'),
          'SCR-training-builder',
          ['pro.training_plan.name', 'inputView'],
        );
        requireIosTrainingTitleKeyboard(
          await hierarchy('journey-edit-title-keyboard'),
          previousTitle,
        );
        await observe(
          'journey-edit-title-paragraph-selection',
          '- tapOn:\n    id: pro.training_plan.name\n    repeat: 3\n    delay: 100\n',
          'SCR-training-builder',
          ['pro.training_plan.name', 'inputView'],
        );
        requireIosTrainingTitleKeyboard(
          await hierarchy('journey-edit-title-paragraph-selection'),
          previousTitle,
        );
        await observe('journey-edit-title-cleared', '- eraseText: 1\n', 'SCR-training-builder', [
          'pro.training_plan.name',
        ]);
        requireIosClearedTrainingTitle(await hierarchy('journey-edit-title-cleared'));
      } else {
        await clearAndroidTrainingTitle({
          output,
          observe,
          previousTitle,
          readAndroidTitle: options.readAndroidTitle!,
        });
      }
      await observe(
        'journey-edit-title',
        tap('pro.training_plan.name') +
          enter(title) +
          '- hideKeyboard\n' +
          revealSession +
          scroll(`pro.training_plan.itemRow.${segment(input.exerciseName)}.remove`) +
          tap(`pro.training_plan.itemRow.${segment(input.exerciseName)}.remove`),
        'STATE-item-removal-confirm',
        nativeItemRemovalBody(input.exerciseName),
        'text',
      );
      const prompt = await hierarchy('journey-edit-title');
      const body =
        input.platform === 'ios'
          ? requireIosItemRemovalPrompt(prompt, input.exerciseName)
          : requireAndroidItemRemovalPrompt(prompt, input.exerciseName);
      const confirmRemoval =
        input.platform === 'ios'
          ? `- tapOn:\n    text: ${exact(enUS['common.cta.delete'])}\n    below:\n      text: ${exact(body)}\n    enabled: true\n`
          : tap('android:id/button1');
      await observe(
        'journey-edit-removed',
        confirmRemoval +
          `- assertNotVisible:\n    id: pro.training_plan.itemRow.${segment(input.exerciseName)}\n`,
        'SCR-training-builder',
        ['pro.training_plan.sessionRow.Strength.addItem'],
      );
      await addExercise('journey-edit');
    },
    restartAndReopen: async (planId) => {
      await options.restartRuntime();
      await observe('journey-restored-home', '', 'SCR-pro-home', ['pro.home.screen']);
      await observe(
        'journey-restored-library',
        scroll('pro.home.trainingCta') + tap('pro.home.trainingCta'),
        'SCR-training-library',
        ['pro.library.training.create', `pro.library.training.row.${planId}`],
      );
      await preview(
        'journey-durable-reopened',
        scroll(`pro.library.training.row.${planId}`) + tap(`pro.library.training.row.${planId}`),
      );
    },
    snapshot: async () => {
      const label = phases[snapshots++];
      assert(label, 'Unexpected native controller snapshot');
      const state = await options.snapshot();
      await persist(label, state);
      return state;
    },
    readPlan: async (planId) => {
      const labels = ['created-api', 'edited-api', 'durable-api'];
      const label = labels[reads++];
      assert(label, 'Unexpected native controller API read');
      const result = await proxy.readObservedNativeTrainingPlan({
        fixtureScope: `native-entry-${input.platform}`,
        accountUid: input.accountUid,
        planId,
      });
      await persist(label, result);
      return result;
    },
  };
}
/** Explicit scoped debug execution. Public wrapper/equivalence qualification remains separate. */
export async function observeIosSavedTrainingJourney(options: SavedNativeTrainingJourneyOptions) {
  assert.equal(options.fixtures.scope, 'native-entry-ios');
  return observeSavedNativeTrainingJourney('ios', options);
}
type SavedNativeTrainingJourneyOptions = Omit<NativeTrainingMaestroDriverOptions, 'input'> & {
  fixtures: OwnedFixtures;
  report: Record<string, unknown>;
};
export async function observeAndroidSavedTrainingJourney(
  options: SavedNativeTrainingJourneyOptions,
) {
  assert.equal(options.fixtures.scope, 'native-entry-android');
  return observeSavedNativeTrainingJourney('android', options);
}
async function observeSavedNativeTrainingJourney(
  platform: 'ios' | 'android',
  options: SavedNativeTrainingJourneyOptions,
) {
  const input: NativeTrainingJourneyInput = {
    runId: options.fixtures.runId,
    attemptId: `${options.fixtures.runId}:first`,
    platform,
    accountUid: options.fixtures.accounts.coach.authUid,
    exerciseId: options.fixtures.draft.sessions[0].items[0].exerciseId,
    exerciseName: 'en QA Exercise 1',
  };
  const result = await runNativeTrainingJourney(
    input,
    createNativeTrainingMaestroDriver({ ...options, input }),
  );
  await writeFile(
    path.join(options.output, 'training-journey-state.private.json'),
    JSON.stringify(result.state),
    { flag: 'wx', mode: 0o600 },
  );
  const hash = (route: string) => createHash('sha256').update(route).digest('hex');
  const traffic = options.proxy.observations;
  const planRoute = hash(`/plans/training/${result.planId}`);
  const rootRoute = hash('/plans/training');
  const planTraffic = traffic.filter((row) => [planRoute, rootRoute].includes(row.pathHash));
  assert(
    planTraffic.every(
      (row) =>
        row.outcome === 'forwarded' &&
        row.requestProfile === 'native' &&
        row.requestOrigin === null,
    ),
    'Training app traffic did not use the owned normal native API',
  );
  assert.equal(
    planTraffic.filter(
      (row) => row.method === 'POST' && row.pathHash === rootRoute && row.status === 201,
    ).length,
    1,
    'Native UI did not create exactly one plan',
  );
  assert(
    planTraffic.some(
      (row) => row.method === 'PATCH' && row.pathHash === planRoute && row.status === 200,
    ),
    'Native UI edit did not reach the normal saved plan route',
  );
  const reads = planTraffic.filter(
    (row) => row.method === 'GET' && row.pathHash === planRoute && row.status === 200,
  );
  assert(reads.length >= 3, 'Native UI reopen phases lack normal plan reads');
  const durableApi = JSON.parse(
    await readFile(path.join(options.output, 'training-journey-durable-api.private.json'), 'utf8'),
  ) as { verification: { apiOrigin: string } };
  assert.equal(
    reads.at(-1)?.targetOrigin,
    durableApi.verification.apiOrigin,
    'Relaunched UI read uses a stale upstream',
  );
  for (const [method, route] of [
    ['GET', '/plans/predefined'],
    ['POST', '/integrations/exercise/search'],
    ['GET', `/integrations/exercise/exercises/${input.exerciseId}`],
  ]) {
    assert(
      traffic.some(
        (row) =>
          row.method === method &&
          row.pathHash === hash(route) &&
          row.status === 200 &&
          row.outcome === 'forwarded' &&
          row.requestProfile === 'native',
      ),
      'Native catalog operation is absent from owned transport',
    );
  }
  options.report.trainingJourney = {
    input,
    planId: result.planId,
    scope: `actual scoped ${platform} Maestro debug UI/API/SQL journey; not public runner/comparison qualification`,
    sixSqlCheckpoints: true,
    threeAuthenticatedApiReads: true,
    savedPlanDurableAfterRestart: true,
    publicNativePassingCases: 0,
  };
}

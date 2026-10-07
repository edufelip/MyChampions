import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  createAndroidTrainingMaestroDriver,
  createIosTrainingMaestroDriver,
  observeAndroidSavedTrainingJourney,
  observeIosTrainingTitleSelection,
  requireAndroidItemRemovalPrompt,
  requireAndroidSelectAllMenu,
  requireAndroidSessionEditorGuidanceAnchor,
  requireAndroidTrainingTitle,
  requireAndroidTrainingGuidanceAnchor,
  requireIosClearedTrainingTitle,
  requireIosSelectAllMenu,
  requireIosTrainingTitleKeyboard,
  requireIosTrainingPreview,
  requireNativeTrainingPreview,
} from '../../scripts/testing/native-training-maestro-driver';
import type { OwnedDomainSnapshot, OwnedFixtures } from '../../scripts/testing/owned-session';

void test('paragraph diagnostic never replaces a partially cleared title or silently selects another method', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mc-title-diagnostic-'));
  const fixtures = { runId: 'f'.repeat(24), scope: 'native-entry-ios' } as OwnedFixtures;
  const state: OwnedDomainSnapshot = {
    schemaVersion: 1,
    readOnly: true,
    runId: fixtures.runId,
    scope: fixtures.scope,
    trainingPlans: [],
    connections: [],
  };
  const labels: string[] = [];
  let snapshots = 0;
  const options = {
    output: root,
    fixtures,
    report: {},
    snapshot: () => {
      snapshots++;
      return Promise.resolve(state);
    },
    observe: async (label: string) => {
      labels.push(label);
      const value = label === 'title-cleared' ? ':first' : `QA training ${fixtures.runId}:first`;
      await writeFile(
        path.join(root, `${label}-hierarchy.json`),
        JSON.stringify({
          children: [
            { attributes: { 'resource-id': 'pro.training_plan.name', enabled: 'true', value } },
            ...['inputView', 'delete'].map((id) => ({
              attributes: { 'resource-id': id, enabled: 'true' },
            })),
          ],
        }),
      );
    },
  };
  try {
    await assert.rejects(
      observeIosTrainingTitleSelection({ ...options, method: 'auto-fallback' as 'menu' }),
    );
    assert.equal(snapshots, 0);
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(
      observeIosTrainingTitleSelection({ ...options, method: 'paragraph-gesture' }),
      /not completely cleared/,
    );
    assert(labels.includes('title-paragraph-selection'));
    assert(!labels.includes('title-selection-menu'));
    assert(!labels.includes('title-replaced'));
    assert.equal(snapshots, 1);
    assert(!(await readdir(root)).includes('title-selection-after.private.json'));
    assert.deepEqual(options.report, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('native journey preview requires exact title and canonical quantity inside the exact session', () => {
  const title = 'QA training attempt';
  const name = 'en QA Exercise 1';
  const quantity = {
    attributes: {
      'resource-id': 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity',
      accessibilityText: '4x10',
    },
  };
  const session = {
    attributes: { 'resource-id': 'pro.training_plan.sessionRow.Strength' },
    children: [
      { attributes: { 'resource-id': 'pro.training_plan.itemRow.en_QA_Exercise_1' } },
      quantity,
    ],
  };
  const input = {
    children: [{ attributes: { 'resource-id': 'pro.training_plan.name', value: title } }, session],
  };
  const verify = (tree: unknown) => requireIosTrainingPreview(tree, title, name, '4x10');
  verify(input);
  const changed = [
    { children: [session] },
    {
      children: [
        { attributes: { 'resource-id': 'pro.training_plan.name', value: 'foreign' } },
        session,
      ],
    },
    { children: [...input.children, input.children[0]] },
    {
      children: [
        input.children[0],
        { ...session, attributes: { 'resource-id': 'pro.training_plan.sessionRow.Other' } },
      ],
    },
    { children: [...input.children, session] },
    { children: [input.children[0], { ...session, children: [session.children[0]] }, quantity] },
    { children: [input.children[0], { ...session, children: [quantity] }] },
    {
      children: [
        input.children[0],
        {
          ...session,
          children: [
            session.children[0],
            { attributes: { ...quantity.attributes, accessibilityText: '3x8' } },
          ],
        },
      ],
    },
    { children: [input.children[0], { ...session, children: [...session.children, quantity] }] },
    {
      children: [
        input.children[0],
        { ...session, children: [...session.children, session.children[0]] },
      ],
    },
  ];
  for (const tree of changed) assert.throws(() => verify(tree));
});

void test('native title focus requires unchanged enabled field and actual unique keyboard nodes', () => {
  const field = {
    attributes: { 'resource-id': 'pro.training_plan.name', value: 'original', enabled: 'true' },
  };
  const keyboard = ['inputView', 'delete'].map((id) => ({
    attributes: { 'resource-id': id, enabled: 'true' },
  }));
  const tree = { children: [field, ...keyboard] };
  requireIosTrainingTitleKeyboard(tree, 'original');
  const invalid = [
    { children: keyboard },
    { children: [field, field, ...keyboard] },
    { children: [{ attributes: { ...field.attributes, value: 'changed' } }, ...keyboard] },
    { children: [{ attributes: { ...field.attributes, enabled: 'false' } }, ...keyboard] },
    { children: [field, keyboard[0]] },
    { children: [field, keyboard[1]] },
    { children: [field, ...keyboard, keyboard[0]] },
    { children: [field, ...keyboard, keyboard[1]] },
    {
      children: [
        field,
        keyboard[0],
        { attributes: { ...keyboard[1].attributes, enabled: 'false' } },
      ],
    },
  ];
  for (const changed of invalid)
    assert.throws(() => requireIosTrainingTitleKeyboard(changed, 'original'));
});

void test('native title replacement requires observed Select All and a completely empty field', () => {
  const menu = { children: [{ attributes: { accessibilityText: 'Select All', enabled: 'true' } }] };
  requireIosSelectAllMenu(menu);
  assert.throws(() => requireIosSelectAllMenu({}));
  assert.throws(() => requireIosSelectAllMenu({ children: [...menu.children, ...menu.children] }));
  assert.throws(() =>
    requireIosSelectAllMenu({
      children: [{ attributes: { accessibilityText: 'Select All', enabled: 'false' } }],
    }),
  );
  const empty = { attributes: { 'resource-id': 'pro.training_plan.name', value: '' } };
  requireIosClearedTrainingTitle(empty);
  assert.throws(() =>
    requireIosClearedTrainingTitle({ attributes: { ...empty.attributes, value: ':first' } }),
  );
  assert.throws(() => requireIosClearedTrainingTitle({}));
  assert.throws(() => requireIosClearedTrainingTitle({ children: [empty, empty] }));
});

void test('Android preview reads exact native text and rejects foreign ids, value-only fields and misplaced quantities', () => {
  const prefix = 'com.edufelip.mychampions.dev:id/';
  const node = (id: string, text = '') => ({ attributes: { 'resource-id': prefix + id, text } });
  const title = node('pro.training_plan.name', 'QA Android');
  const item = node('pro.training_plan.itemRow.en_QA_Exercise_1');
  const quantity = node('pro.training_plan.itemRow.en_QA_Exercise_1.quantity', '3x8');
  const session = { ...node('pro.training_plan.sessionRow.Strength'), children: [item, quantity] };
  const tree = { children: [title, session] };
  const verify = (value: unknown) =>
    requireNativeTrainingPreview('android', value, 'QA Android', 'en QA Exercise 1', '3x8');
  verify(tree);
  const invalid = [
    { children: [session] },
    { children: [title, title, session] },
    { children: [{ attributes: { ...title.attributes, text: '', value: 'QA Android' } }, session] },
    {
      children: [
        { attributes: { ...title.attributes, 'resource-id': 'foreign:id/pro.training_plan.name' } },
        session,
      ],
    },
    { children: [title, session, session] },
    { children: [title, { ...session, children: [item] }, quantity] },
    { children: [title, { ...session, children: [quantity] }] },
    { children: [title, { ...session, children: [item, quantity, quantity] }] },
    { children: [title, { ...session, children: [item, item, quantity] }] },
    {
      children: [
        title,
        { ...session, children: [item, { attributes: { ...quantity.attributes, text: '4x10' } }] },
      ],
    },
    {
      children: [
        title,
        {
          ...session,
          children: [
            item,
            { attributes: { ...quantity.attributes, text: '', accessibilityText: '3x8' } },
          ],
        },
      ],
    },
  ];
  for (const changed of invalid) assert.throws(() => verify(changed));
  assert.throws(() =>
    requireNativeTrainingPreview('web' as 'android', tree, 'QA Android', 'en QA Exercise 1', '3x8'),
  );
});

void test('Android title clearing requires a unique enabled field with exact empty text', () => {
  const field = {
    attributes: { 'resource-id': 'pro.training_plan.name', enabled: 'true', text: '' },
  };
  requireAndroidTrainingTitle(field, '');
  for (const tree of [
    {},
    { children: [field, field] },
    { attributes: { ...field.attributes, text: ':first' } },
    { attributes: { ...field.attributes, text: undefined, value: '' } },
    { attributes: { ...field.attributes, enabled: 'false' } },
    { attributes: { ...field.attributes, 'resource-id': 'foreign:id/pro.training_plan.name' } },
  ])
    assert.throws(() => requireAndroidTrainingTitle(tree, ''));
});

void test('Android native Select all must be the unique exact enabled OS action', () => {
  const action = { attributes: { text: 'Select all', enabled: 'true' } };
  requireAndroidSelectAllMenu(action);
  for (const tree of [
    {},
    { children: [action, action] },
    { attributes: { text: 'Select All', enabled: 'true' } },
    { attributes: { accessibilityText: 'Select all', enabled: 'true' } },
    { attributes: { text: 'Select all', enabled: 'false' } },
    { children: [action, { attributes: { text: 'Select all', enabled: 'false' } }] },
  ])
    assert.throws(() => requireAndroidSelectAllMenu(tree));
});

void test('Android removal requires actual native dialog ids, exact copy and both enabled actions below its body', () => {
  const message = {
    attributes: {
      'resource-id': 'android:id/message',
      text: enUS['pro.plan.delete.body'],
      bounds: '[20,100][300,150]',
    },
  };
  const yes = {
    attributes: {
      'resource-id': 'android:id/button1',
      text: enUS['common.cta.delete'].toUpperCase(),
      enabled: 'true',
      bounds: '[160,180][240,220]',
    },
  };
  const no = {
    attributes: {
      'resource-id': 'android:id/button2',
      text: enUS['common.cta.cancel'],
      enabled: 'true',
      bounds: '[60,180][140,220]',
    },
  };
  const tree = { children: [message, yes, no] };
  assert.equal(requireAndroidItemRemovalPrompt(tree), enUS['pro.plan.delete.body']);
  const modify = (index: number, attributes: Record<string, unknown>) => ({
    children: tree.children.map((node, i) =>
      i === index ? { attributes: { ...node.attributes, ...attributes } } : node,
    ),
  });
  for (const invalid of [
    {},
    { children: [message, yes] },
    { children: [yes, no] },
    { children: [...tree.children, yes] },
    { children: [...tree.children, message] },
    modify(0, { text: 'Foreign confirmation' }),
    modify(0, { bounds: '[20,150][300,100]' }),
    modify(0, { bounds: 'unknown' }),
    modify(1, { enabled: 'false' }),
    modify(1, { text: 'Save' }),
    modify(1, { 'resource-id': 'foreign:id/button1' }),
    modify(1, { bounds: '[160,80][240,120]' }),
    modify(2, { bounds: '[60,220][140,180]' }),
    modify(2, { text: 'Continue' }),
  ])
    assert.throws(() => requireAndroidItemRemovalPrompt(invalid));
});

void test('platform entry points reject mismatched requests before actions, SQL or files', async () => {
  const options = { input: { platform: 'ios' } } as Parameters<
    typeof createAndroidTrainingMaestroDriver
  >[0];
  assert.throws(() => createAndroidTrainingMaestroDriver(options));
  assert.throws(
    () =>
      createAndroidTrainingMaestroDriver({
        ...options,
        input: { ...options.input, platform: 'android' },
      }),
    /requires independent native input observation/,
  );
  assert.throws(() =>
    createIosTrainingMaestroDriver({
      ...options,
      input: { ...options.input, platform: 'android' },
    }),
  );
  await assert.rejects(
    observeAndroidSavedTrainingJourney({ fixtures: { scope: 'native-entry-ios' } } as Parameters<
      typeof observeAndroidSavedTrainingJourney
    >[0]),
  );
});

void test('Android new-session swipe requires exact observed guidance outside the title input', () => {
  const anchor = {
    attributes: {
      text: enUS['pro.plan.builder.guidance.training.body'],
      enabled: 'true',
      class: 'android.widget.TextView',
      bounds: '[32,142][288,214]',
    },
  };
  const field = {
    attributes: { 'resource-id': 'pro.training_plan.name', bounds: '[32,288][288,330]' },
  };
  requireAndroidTrainingGuidanceAnchor({ children: [anchor, field] });
  for (const tree of [
    {},
    { children: [anchor] },
    { children: [field] },
    { children: [anchor, anchor, field] },
    { children: [anchor, field, field] },
    { children: [{ attributes: { ...anchor.attributes, text: 'foreign guidance' } }, field] },
    { children: [{ attributes: { ...anchor.attributes, enabled: 'false' } }, field] },
    {
      children: [{ attributes: { ...anchor.attributes, class: 'android.widget.EditText' } }, field],
    },
    { children: [{ attributes: { ...anchor.attributes, bounds: '[32,142][288,320]' } }, field] },
    { children: [{ attributes: { ...anchor.attributes, bounds: '[32,214][288,142]' } }, field] },
    { children: [anchor, { attributes: { ...field.attributes, bounds: 'unknown' } }] },
  ])
    assert.throws(() => requireAndroidTrainingGuidanceAnchor(tree));
});

void test('Android session-confirm swipe rejects an ambiguous, foreign, disabled or overlapping input anchor', () => {
  const anchor = {
    attributes: {
      text: enUS['pro.plan.builder.guidance.training.body'],
      enabled: 'true',
      class: 'android.widget.TextView',
      bounds: '[32,142][288,214]',
    },
  };
  const field = {
    attributes: {
      'resource-id': 'pro.training_plan.addSession.name',
      enabled: 'true',
      class: 'android.widget.EditText',
      bounds: '[32,531][288,563]',
    },
  };
  requireAndroidSessionEditorGuidanceAnchor({ children: [anchor, field] });
  for (const tree of [
    { children: [anchor] },
    { children: [field] },
    { children: [anchor, anchor, field] },
    { children: [anchor, field, field] },
    {
      children: [
        anchor,
        { attributes: { ...field.attributes, 'resource-id': 'pro.training_plan.name' } },
      ],
    },
    {
      children: [
        anchor,
        {
          attributes: {
            ...field.attributes,
            'resource-id': 'foreign:id/pro.training_plan.addSession.name',
          },
        },
      ],
    },
    { children: [anchor, { attributes: { ...field.attributes, enabled: 'false' } }] },
    {
      children: [anchor, { attributes: { ...field.attributes, class: 'android.widget.TextView' } }],
    },
    { children: [{ attributes: { ...anchor.attributes, bounds: '[32,142][288,550]' } }, field] },
  ])
    assert.throws(() => requireAndroidSessionEditorGuidanceAnchor(tree));
});

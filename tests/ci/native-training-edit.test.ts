import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  nativeItemRemovalBody,
  requireIosItemRemovalPrompt,
} from '../../scripts/testing/native-training-edit-observation';

void test('iOS removal action binding requires unique enabled buttons below the observed body', () => {
  const node = (text: string, box: string, enabled = 'true') => ({
    attributes: { accessibilityText: text, bounds: box, enabled },
  });
  const tree = {
    children: [
      node('Delete', '[10,10][210,210]'),
      node('Remove QA Exercise from this session?', '[20,50][200,110]'),
      node('Cancel', '[20,120][100,170]'),
      node('Delete', '[110,120][200,170]'),
    ],
  };
  assert.equal(nativeItemRemovalBody('QA Exercise'), 'Remove QA Exercise from this session?');
  assert.equal(
    requireIosItemRemovalPrompt(tree, 'QA Exercise'),
    'Remove QA Exercise from this session?',
  );
  // Another exercise's prompt or the whole-plan delete copy is not this removal.
  assert.throws(() => requireIosItemRemovalPrompt(tree, 'Other Exercise'));
  assert.throws(() =>
    requireIosItemRemovalPrompt(
      {
        children: tree.children.map((row, index) =>
          index === 1 ? node(enUS['pro.plan.delete.body'], '[20,50][200,110]') : row,
        ),
      },
      'QA Exercise',
    ),
  );
  const invalid = [
    { children: tree.children.filter((_, index) => index !== 1) },
    { children: [...tree.children, tree.children[1]] },
    {
      children: tree.children.map((row, index) =>
        index === 3 ? node('Delete', '[110,120][200,170]', 'false') : row,
      ),
    },
    {
      children: tree.children.map((row, index) =>
        index === 2 ? node('Cancel', '[20,20][100,40]') : row,
      ),
    },
    { children: [...tree.children, tree.children[3]] },
    {
      children: tree.children.map((row, index) =>
        index === 3 ? node('Delete', 'malformed') : row,
      ),
    },
  ];
  for (const changed of invalid)
    assert.throws(() => requireIosItemRemovalPrompt(changed, 'QA Exercise'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nativeHierarchyHasAttribute,
  parseNativeHierarchy,
} from '../../scripts/testing/native-hierarchy';

void test('hierarchy parsing preserves braces in labels and ignores a trailing CLI notification', () => {
  const tree = {
    attributes: {},
    children: [
      {
        attributes: {
          'resource-id': 'auth.signIn.emailInput',
          text: 'literal { brace } and "quote"',
        },
        children: [],
      },
    ],
  };
  const parsed = parseNativeHierarchy(JSON.stringify(tree) + '\nCLI notice { not a tree }');
  assert.deepEqual(parsed, tree);
  assert.equal(nativeHierarchyHasAttribute(parsed, 'resource-id', 'auth.signIn.emailInput'), true);
  assert.equal(nativeHierarchyHasAttribute(parsed, 'resource-id', 'auth.signIn.email'), false);
  assert.equal(
    nativeHierarchyHasAttribute(
      { attributes: { text: 'auth.signIn.emailInput' } },
      'resource-id',
      'auth.signIn.emailInput',
    ),
    false,
  );
});
void test('hierarchy parsing rejects missing, incomplete or invalid JSON', () => {
  for (const log of ['empty log', '{"children": [', '{bad-json}\nnotice'])
    assert.throws(() => parseNativeHierarchy(log));
});

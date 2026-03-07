import assert from 'node:assert/strict';
import test from 'node:test';

// Logic for reordering can be tested here if we extract the pure array reordering
function reorderArray<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...array];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

test('reorderArray moves item up correctly', () => {
  const input = ['a', 'b', 'c'];
  const result = reorderArray(input, 1, 0);
  assert.deepEqual(result, ['b', 'a', 'c']);
});

test('reorderArray moves item down correctly', () => {
  const input = ['a', 'b', 'c'];
  const result = reorderArray(input, 1, 2);
  assert.deepEqual(result, ['a', 'c', 'b']);
});

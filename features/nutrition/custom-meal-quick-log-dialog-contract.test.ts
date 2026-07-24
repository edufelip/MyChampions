import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('custom meal quick log uses the shared web modal focus and Escape contract', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'app',
      '(tabs)',
      'nutrition',
      'custom-meals',
      'index.tsx'
    ),
    'utf8'
  );

  const panelStart = source.indexOf('function QuickLogPanel');
  const panelSource = source.slice(panelStart);
  assert.notEqual(panelStart, -1);
  assert.match(panelSource, /useWebDialogAccessibility\(\{/);
  assert.match(panelSource, /isVisible: true/);
  assert.match(panelSource, /onClose: onCancel/);
  assert.match(panelSource, /testID: 'meal\.library\.quickLog\.panel'/);
});

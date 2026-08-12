import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

test('E2E network storage listeners require callable browser event APIs', () => {
  const source = readFileSync(join(root, 'features', 'offline', 'use-network-status.ts'), 'utf8');

  assert.match(source, /typeof window\.addEventListener === 'function'/);
  assert.match(source, /typeof window\.removeEventListener === 'function'/);
  assert.match(source, /e2eNetworkStatusEventTarget\.addEventListener\('storage'/);
  assert.match(source, /e2eNetworkStatusEventTarget\.removeEventListener\('storage'/);
});

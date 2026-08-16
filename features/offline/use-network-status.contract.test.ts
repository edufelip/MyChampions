import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

test('E2E network storage listeners require callable browser event APIs', () => {
  const source = readFileSync(join(root, 'features', 'offline', 'use-network-status.ts'), 'utf8');

  // Callable-window narrowing lives in resolveE2ENetworkStatusEventTarget (covered by
  // network-status-override.logic.test.ts); this hook must route through it rather than
  // re-checking `typeof window.addEventListener === 'function'` inline.
  assert.match(source, /resolveE2ENetworkStatusEventTarget\(/);
  assert.match(source, /e2eEventTarget\.addEventListener\('storage'/);
  assert.match(source, /e2eEventTarget\.removeEventListener\('storage'/);
  assert.match(source, /e2eEventTarget\.addEventListener\(\s*'mychampions\.e2e\.network-status-change'/);
  assert.match(source, /e2eEventTarget\.removeEventListener\(\s*'mychampions\.e2e\.network-status-change'/);
});

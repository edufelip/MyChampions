import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('the E2E network-status bridge only subscribes on browser-capable runtimes', () => {
  const source = readFileSync(
    join(process.cwd(), 'features/offline/use-network-status.ts'),
    'utf8',
  );

  assert.match(source, /const e2eEventTarget =/);
  assert.match(source, /typeof window\.addEventListener === 'function'/);
  assert.match(source, /typeof window\.removeEventListener === 'function'/);
  assert.match(source, /if \(e2eEventTarget\) \{/);
});

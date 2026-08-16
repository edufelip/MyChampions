import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

test('bulk pending denial suppresses per-item reloads and performs one final refresh', () => {
  const hookSource = readFileSync(join(root, 'features', 'connections', 'use-connections.ts'), 'utf8');
  const pendingSource = readFileSync(join(root, 'app', 'professional', 'pending.tsx'), 'utf8');

  assert.match(hookSource, /options\?\.reload !== false/);
  assert.match(pendingSource, /unbindConnection\(id, \{ reload: false \}\)/);
  assert.match(pendingSource, /setIsBulkDenying\(false\);[\s\S]*?reload\(\);/);
});

test('professional pending fixture is scoped to the persisted professional web role', () => {
  const source = readFileSync(join(root, 'features', 'connections', 'connection-source.ts'), 'utf8');

  assert.match(source, /isProfessionalE2EFixtureSession\(\)/);
  assert.match(source, /sessionStorage\.getItem\('mychampions\.e2e\.locked-role'\) === 'professional'/);
});

test('product web Playwright starts a fresh fixture server for every run', () => {
  const config = readFileSync(join(root, 'playwright.config.ts'), 'utf8');

  assert.match(config, /reuseExistingServer: false/);
});

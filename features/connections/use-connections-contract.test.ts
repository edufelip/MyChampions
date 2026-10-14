import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createWebTestConfig } from '../../e2e/web/support/create-web-test-config';

const root = join(__dirname, '..', '..');

void test('bulk pending denial suppresses per-item reloads and performs one final refresh', () => {
  const hookSource = readFileSync(
    join(root, 'features', 'connections', 'use-connections.ts'),
    'utf8',
  );
  const pendingSource = readFileSync(join(root, 'app', 'professional', 'pending.tsx'), 'utf8');

  assert.match(hookSource, /options\?\.reload !== false/);
  assert.match(pendingSource, /unbindConnection\(id, \{ reload: false \}\)/);
  assert.match(pendingSource, /setIsBulkDenying\(false\);[\s\S]*?reload\(\);/);
});

void test('professional pending fixture is scoped to the persisted professional web role', () => {
  const source = readFileSync(
    join(root, 'features', 'connections', 'connection-source.ts'),
    'utf8',
  );

  assert.match(source, /isProfessionalE2EFixtureSession\(\)/);
  assert.match(
    source,
    /sessionStorage\.getItem\('mychampions\.e2e\.locked-role'\) === 'professional'/,
  );
});

void test('product web Playwright starts a fresh fixture server for every run', () => {
  const server = createWebTestConfig('default').webServer;
  assert.ok(server && !Array.isArray(server));
  assert.equal(server.reuseExistingServer, false);
});

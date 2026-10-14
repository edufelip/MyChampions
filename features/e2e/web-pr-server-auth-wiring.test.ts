import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createWebTestConfig } from '../../e2e/web/support/create-web-test-config';

const root = join(__dirname, '..', '..');

void test('web PR workflow runs the real cookie-session browser contract against its coordinated backend', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'web-pr.yml'), 'utf8');
  const servers = createWebTestConfig('server').webServer;
  assert.ok(Array.isArray(servers));
  assert.equal(servers.length, 2);
  const [api, web] = servers;
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s{2}pull_request:/m);
  assert.match(workflow, /repository: edufelip\/mychampions-api/);
  assert.match(workflow, /path: node_modules\/\.ci-my-champions-api/);
  assert.match(
    workflow,
    /uses: oven-sh\/setup-bun@[0-9a-f]{40} # v2\.2\.0[\s\S]*?bun-version: 1\.3\.10/,
  );
  assert.match(
    workflow,
    /name: Install coordinated backend dependencies[\s\S]*?working-directory: node_modules\/\.ci-my-champions-api[\s\S]*?run: bun install --frozen-lockfile/,
  );
  assert.match(
    workflow,
    /name: Run server-backed browser session E2E[\s\S]*?timeout-minutes: 15[\s\S]*?MYCHAMPIONS_SERVER_ROOT: \$\{\{ github\.workspace \}\}\/node_modules\/\.ci-my-champions-api[\s\S]*?run: yarn test:e2e:web:server/,
  );
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /https:\/\/api\.mychampions\.eduwaldo\.com/);

  assert.equal(
    packageJson.scripts?.['test:e2e:web:server'],
    'node scripts/run-web-e2e-batch.mjs server',
  );
  assert.equal(api.cwd, resolve(process.env.MYCHAMPIONS_SERVER_ROOT ?? '../server'));
  assert.match(
    api.command,
    /PORT=3401 WEB_E2E_ORIGIN=http:\/\/127\.0\.0\.1:8082 bun run dev:web-e2e/,
  );
  assert.match(
    web.command,
    /EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http:\/\/127\.0\.0\.1:3401 yarn web:dev --port 8082 --clear/,
  );
  assert.equal(
    servers.every((server) => server.reuseExistingServer === false),
    true,
    'Playwright must own and terminate both server processes for this isolated lane',
  );
});

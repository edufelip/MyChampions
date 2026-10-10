import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const generator = path.resolve(__dirname, '../../scripts/testing/inventory-tests.mjs');

type InventoryRow = {
  repo: string;
  path: string;
  command: string;
  ownerPaths: string[];
  requirementReferences: string[];
  layers: string[];
  dataMode: string;
  platforms: string[];
  selectors: string[];
  hazards: { sleeps: number; coordinates: number; synchronizationBypasses: number };
  assertionPurposes: { purpose: string; line: number }[];
  assertions: { line: number; expression: string }[];
};

function writeFiles(repoRoot: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    writeFileSync(path.join(repoRoot, file), content);
  }
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
}

// A client checkout with Maestro suite flows, shared subflows, a live RevenueCat folder and a
// Playwright spec, plus a server checkout that MYCHAMPIONS_SERVER_ROOT points at.
function createWorkspace(): { workspace: string; client: string; server: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), 'test-inventory-'));
  const client = path.join(workspace, 'client');
  const server = path.join(workspace, 'api');
  writeFiles(client, {
    'config/test-impact.json': JSON.stringify({
      suites: {
        'maestro:auth': {
          runner: 'maestro',
          platforms: ['ios', 'android'],
          specs: ['.maestro/suite/auth-sign-in'],
          ci: true,
        },
        'maestro:ios-only': {
          runner: 'maestro',
          platforms: ['ios'],
          specs: ['.maestro/suite/ios-only'],
          ci: true,
        },
        'maestro:revenuecat-live': {
          runner: 'maestro',
          platforms: ['ios', 'android'],
          specs: ['.maestro/suite/revenuecat-test-store'],
          ci: false,
        },
      },
    }),
    'docs/qa/.keep': '',
    '.maestro/suite/common/launch-fresh.yaml': 'appId: app\n---\n- launchApp\n',
    '.maestro/suite/common/fill-field.yaml': 'appId: app\n---\n- inputText: ${VALUE}\n',
    '.maestro/suite/auth-sign-in/sign-in-01-launch.yaml': [
      'appId: app',
      'name: Auth sign-in - shows the sign-in screen',
      'tags: [auth-entry]',
      '---',
      '# TC-514',
      '- runFlow: ../common/launch-fresh.yaml',
      '- extendedWaitUntil:',
      '    visible: __settle_wait__',
      '    timeout: 3000',
      '    optional: true',
      '- assertVisible:',
      '    id: auth.signIn.screen',
      '- tapOn:',
      '    id: "auth.signIn.submitButton"',
      '    waitToSettleTimeoutMs: 0',
      '- tapOn:',
      '    point: "2%,30%"',
      '- runFlow: { file: ../common/fill-field.yaml, env: { VALUE: "E2E" } }',
      '',
    ].join('\n'),
    '.maestro/suite/ios-only/01-two-tags.yaml':
      'appId: app\nname: iOS only\ntags: [actions-network, actions-store_problem]\n---\n- launchApp\n',
    '.maestro/suite/revenuecat-test-store/config.yaml': 'executionOrder:\n  flowsOrder: []\n',
    '.maestro/suite/revenuecat-test-store/steps/pro-status.yaml': 'appId: app\n---\n- launchApp\n',
    '.maestro/suite/revenuecat-test-store/01-pro.yaml': [
      'appId: app',
      'name: RevenueCat live - keeps a dismissed purchase inactive',
      'tags: [professional-regression]',
      '---',
      '- runFlow:',
      '    file: steps/pro-status.yaml',
      '    env:',
      '      RETURN_ID: pro.subscription.screen',
      '',
    ].join('\n'),
    'e2e/web/home.spec.ts': [
      "import { expect, test } from '@playwright/test';",
      "test('shows home', async ({ page }) => {",
      "  await page.getByTestId('home.screen').click();",
      "  // by.id('legacy.id')",
      '  expect(1).toBe(1);',
      '});',
      '',
    ].join('\n'),
  });
  writeFiles(server, {
    'tests/health.test.ts':
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('is healthy', () => assert.ok(true));\n",
  });
  return { workspace, client, server };
}

function runGenerator(client: string, server: string, args: string[] = []) {
  return spawnSync(process.execPath, [generator, ...args], {
    cwd: client,
    encoding: 'utf8',
    env: { ...process.env, MYCHAMPIONS_SERVER_ROOT: server },
  });
}

void test('inventory lists Maestro suite flows as native rows and skips subflows and config', () => {
  const { workspace, client, server } = createWorkspace();
  try {
    const run = runGenerator(client, server);
    assert.equal(run.status, 0, run.stderr);
    const inventory = JSON.parse(
      readFileSync(path.join(client, 'docs/qa/test-inventory-v1.json'), 'utf8'),
    ) as { tests: InventoryRow[] };
    const rows = new Map(inventory.tests.map((row) => [`${row.repo}:${row.path}`, row]));

    assert.deepEqual([...rows.keys()].sort(), [
      'client:.maestro/suite/auth-sign-in/sign-in-01-launch.yaml',
      'client:.maestro/suite/ios-only/01-two-tags.yaml',
      'client:.maestro/suite/revenuecat-test-store/01-pro.yaml',
      'client:e2e/web/home.spec.ts',
      'server:tests/health.test.ts',
    ]);

    const signIn = rows.get('client:.maestro/suite/auth-sign-in/sign-in-01-launch.yaml');
    assert.ok(signIn);
    assert.equal(signIn.command, 'yarn test:e2e:ios / yarn test:e2e:android (tags: auth-entry)');
    assert.deepEqual(signIn.layers, ['native']);
    assert.equal(signIn.dataMode, 'fixture');
    assert.deepEqual(signIn.platforms, ['ios', 'android']);
    assert.deepEqual(signIn.ownerPaths, [
      '.maestro/suite/common/fill-field.yaml',
      '.maestro/suite/common/launch-fresh.yaml',
    ]);
    assert.deepEqual(signIn.requirementReferences, ['TC-514']);
    assert.deepEqual(signIn.assertionPurposes, [
      { purpose: 'Auth sign-in - shows the sign-in screen', line: 2 },
    ]);
    assert.deepEqual(signIn.assertions, [
      { line: 11, expression: '- assertVisible: id: auth.signIn.screen' },
    ]);
    assert.deepEqual(signIn.selectors, ['auth.signIn.screen', 'auth.signIn.submitButton']);
    assert.deepEqual(signIn.hazards, { sleeps: 1, coordinates: 1, synchronizationBypasses: 1 });

    const iosOnly = rows.get('client:.maestro/suite/ios-only/01-two-tags.yaml');
    assert.ok(iosOnly);
    assert.deepEqual(iosOnly.platforms, ['ios']);
    assert.equal(
      iosOnly.command,
      'yarn test:e2e:ios (tags: actions-network, actions-store_problem)',
    );

    const live = rows.get('client:.maestro/suite/revenuecat-test-store/01-pro.yaml');
    assert.ok(live);
    assert.equal(live.command, 'yarn test:e2e:ios:revenuecat-live (tags: professional-regression)');
    assert.deepEqual(live.layers, ['provider']);
    assert.deepEqual(live.platforms, ['ios']);
    assert.deepEqual(live.ownerPaths, [
      '.maestro/suite/revenuecat-test-store/steps/pro-status.yaml',
    ]);
    assert.deepEqual(live.selectors, []);

    const web = rows.get('client:e2e/web/home.spec.ts');
    assert.ok(web);
    assert.deepEqual(web.layers, ['fixture-ui']);
    assert.deepEqual(web.platforms, ['web']);
    assert.deepEqual(web.selectors, ['home.screen']);
    assert.deepEqual(web.assertionPurposes, [{ purpose: 'shows home', line: 2 }]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('inventory --check fails when a Maestro flow changes after generation', () => {
  const { workspace, client, server } = createWorkspace();
  try {
    assert.equal(runGenerator(client, server).status, 0);
    assert.equal(runGenerator(client, server, ['--check']).status, 0);

    const flow = path.join(client, '.maestro/suite/ios-only/01-two-tags.yaml');
    writeFileSync(flow, `${readFileSync(flow, 'utf8')}- assertVisible: Home\n`);
    const stale = runGenerator(client, server, ['--check']);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /Test inventory is stale/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

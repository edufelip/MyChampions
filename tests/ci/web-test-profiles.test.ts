import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWebTestConfig } from '../../e2e/web/support/create-web-test-config';
import { WEB_TEST_PROFILE_NAMES, subscriptionLockPorts } from '../../e2e/web/support/test-profiles';

void test('unknown browser profiles fail instead of inheriting a positive fixture profile', () => {
  for (const name of ['missing', 'constructor', '__proto__', '']) {
    assert.throws(
      () => Reflect.apply(createWebTestConfig, undefined, [name]),
      /Unknown browser test profile/,
    );
  }
  assert.equal(new Set(WEB_TEST_PROFILE_NAMES).size, 17);
});

void test('negative profiles omit only their positive fixtures while retaining isolated transport targets', () => {
  for (const [name, forbidden, origin] of [
    ['custom-meal-error', 'EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE', 'http://127.0.0.1:3410'],
    ['professional-roster-error', 'EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE', 'http://127.0.0.1:3409'],
  ] as const) {
    const server = createWebTestConfig(name).webServer;
    assert.ok(server && !Array.isArray(server));
    assert.ok(!server.command.includes(forbidden));
    assert.ok(server.command.includes('EXPO_PUBLIC_E2E_AUTH_SESSION=true'));
    assert.ok(server.command.includes(`EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=${origin}`));
  }
});

void test('professional home retains all three mobile locales and default retains all browser engines', () => {
  const mobile = createWebTestConfig('professional-home').projects;
  assert.deepEqual(
    mobile?.map((project) => project.use?.locale),
    ['en-US', 'pt-BR', 'es-ES'],
  );
  assert.ok(mobile?.every((project) => project.use?.hasTouch === true));
  assert.deepEqual(
    createWebTestConfig('default').projects?.map((project) => project.name),
    ['chromium', 'firefox', 'webkit'],
  );
});

void test('subscription capability variants retain separate servers and exported port identities', () => {
  const servers = createWebTestConfig('subscription-lock').webServer;
  assert.ok(Array.isArray(servers));
  assert.deepEqual(
    servers.map((server) => server.url),
    [
      `http://127.0.0.1:${subscriptionLockPorts.UNAVAILABLE_PORT}`,
      `http://127.0.0.1:${subscriptionLockPorts.HANDOFF_PORT}`,
    ],
  );
  assert.ok(!servers[0].command.includes('EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL'));
  assert.ok(
    servers[1].command.includes(
      'EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL=https://handoff.example.com/subscribe',
    ),
  );
});

void test('artifact overrides preserve auth/app report isolation', () => {
  const old = process.env.WEB_E2E_ARTIFACT_ROOT;
  process.env.WEB_E2E_ARTIFACT_ROOT = '/tmp/mychampions-profile-reports';
  try {
    const auth = createWebTestConfig('flows-auth');
    const app = createWebTestConfig('flows');
    assert.notEqual(auth.outputDir, app.outputDir);
    assert.equal(auth.outputDir, '/tmp/mychampions-profile-reports/test-results-auth');
    assert.equal(app.outputDir, '/tmp/mychampions-profile-reports/test-results-app');
    assert.notDeepEqual(auth.reporter, app.reporter);
  } finally {
    if (old === undefined) delete process.env.WEB_E2E_ARTIFACT_ROOT;
    else process.env.WEB_E2E_ARTIFACT_ROOT = old;
  }
});

type ImpactDocument = {
  suites: Record<string, { projects?: string[]; specs?: string[]; ci?: boolean }>;
};

void test('flow-atlas auth impact and observation workflow match the resolved profile', () => {
  const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const impact = JSON.parse(
    fs.readFileSync(path.join(candidateRoot, 'config/test-impact.json'), 'utf8'),
  ) as ImpactDocument;
  const authSuite = impact.suites['web:flow-atlas-auth'];
  assert.ok(authSuite);
  assert.equal(authSuite.ci, false);
  assert.deepEqual(authSuite.specs, ['e2e/web-flows-auth/authentication-flow-atlas.spec.ts']);
  const declaredProjects = authSuite.projects;
  const actualProjects = (createWebTestConfig('flows-auth').projects ?? []).map(
    (project) => project.name,
  );
  assert.deepEqual(declaredProjects, actualProjects);

  const workflow = fs.readFileSync(
    path.join(candidateRoot, '.github/workflows/web-evidence-observation.yml'),
    'utf8',
  );
  const authStart = workflow.indexOf('      - name: web:flow-atlas-auth (');
  const nextSuiteStart = workflow.indexOf('      - name: web:flow-atlas-complete', authStart);
  assert.ok(authStart >= 0 && nextSuiteStart > authStart);
  const authSection = workflow.slice(authStart, nextSuiteStart);
  const workflowProjects = [...authSection.matchAll(/--project=([a-z0-9-]+)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(workflowProjects, actualProjects);
  assert.equal(
    (authSection.match(/^        continue-on-error: true$/gm) ?? []).length,
    actualProjects.length,
  );
});

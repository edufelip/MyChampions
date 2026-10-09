import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildChildEnvironment,
  executeSelectivePlan,
} from '../../scripts/ci/execute-selected-tests';
import {
  createSelectiveExecutionPlan,
  parseNativeMetroPort,
  parseSelectiveInvocationTimeoutMs,
  parseSelectedSuitesJson,
  validateSelectiveExecutionManifest,
} from '../../scripts/ci/selective-execution';
import { loadManifest } from '../../scripts/ci/test-impact';
import { resolveIntegrationServerRoot } from '../../scripts/testing/run-web-integration';

const root = process.cwd();
const manifest = loadManifest(root);

void test('checked-in suites have complete typed execution contracts', () => {
  assert.deepEqual(validateSelectiveExecutionManifest(manifest), []);
});

void test('live provider registration cannot enter selective execution or preview', () => {
  const suiteId = 'maestro:revenuecat-live';
  assert.deepEqual(validateSelectiveExecutionManifest(manifest), []);
  assert.equal(manifest.suites[suiteId].ci, false);
  for (const platform of ['ios', 'android'] as const) {
    for (const planOnly of [false, true]) {
      assert.throws(
        () => createSelectiveExecutionPlan(manifest, platform, [suiteId], { planOnly }),
        /not eligible for selective CI/,
      );
    }
  }
  const unsafeActivation = structuredClone(manifest);
  unsafeActivation.suites[suiteId].ci = true;
  assert.ok(
    validateSelectiveExecutionManifest(unsafeActivation).includes(
      `CI native suite ${suiteId} uses non-selective profile provider-live`,
    ),
  );
  assert.throws(
    () => createSelectiveExecutionPlan(unsafeActivation, 'ios', [suiteId]),
    /non-selective profile provider-live/,
  );
});

void test('web suites are grouped by runner and project with argv-safe filters', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'web', ['web:shell', 'web:auth']);

  assert.equal(plan.nativeBuild, undefined);
  assert.equal(plan.invocations.length, 1);
  const invocation = plan.invocations[0];
  assert.equal(invocation.command, 'yarn');
  assert.equal(invocation.args[0], 'playwright');
  assert.ok(invocation.args.includes('--config=playwright.config.ts'));
  assert.ok(invocation.args.includes('--project=chromium'));
  assert.equal(
    invocation.args.filter((value) => value === 'e2e/web/responsive-shell.spec.ts').length,
    1,
  );
  const grepIndex = invocation.args.indexOf('--grep');
  assert.ok(grepIndex >= 0);
  assert.match(invocation.args[grepIndex + 1], /@feature:auth/);
  assert.match(invocation.args[grepIndex + 1], /@feature:shell/);
});

void test('web suites can select an explicit Playwright config per project', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'web', ['web:professional-home']);

  assert.deepEqual(
    plan.invocations.map((invocation) =>
      invocation.args.filter((value) => value.startsWith('--project=')),
    ),
    [
      ['--project=mobile-professional'],
      ['--project=mobile-professional-es'],
      ['--project=mobile-professional-pt'],
    ],
  );
  for (const invocation of plan.invocations) {
    assert.ok(invocation.args.includes('--config=playwright.professional-home.config.ts'));
    assert.ok(invocation.args.includes('e2e/web/professional-home-responsive.spec.ts'));
  }
});

void test('server Playwright suites declare their coordinated backend requirement', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'web', ['web:server-auth']);

  assert.equal(plan.invocations.length, 3);
  for (const invocation of plan.invocations) {
    assert.ok(invocation.args.includes('--config=playwright.server.config.ts'));
    assert.deepEqual(invocation.requiredEnv, ['MYCHAMPIONS_SERVER_ROOT']);
  }
});

void test('inactive integration suites are explicitly selectable through the owned runner', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'web', ['web:integration-training'], {
    planOnly: true,
  });

  assert.equal(plan.execution, 'preview-only');
  assert.equal(plan.invocations.length, 1);
  const invocation = plan.invocations[0];
  assert.equal(invocation.command, 'yarn');
  assert.deepEqual(invocation.args, [
    'test:e2e:web:integration',
    '--scenario=training-durable',
    '--project=chromium,firefox,mobile-en,mobile-es,mobile-pt,tablet-en,tablet-es,tablet-pt,webkit',
  ]);
  assert.deepEqual(invocation.requiredEnv, ['MYCHAMPIONS_SERVER_ROOT']);
  assert.match(invocation.env.WEB_INTEGRATION_ARTIFACT_ROOT, /web\/playwright-integration-/);
  assert.equal(manifest.suites['web:integration-training'].ci, false);
});

void test('inactive integration suites remain rejected by the executable selective path', () => {
  assert.throws(
    () => createSelectiveExecutionPlan(manifest, 'web', ['web:integration-training']),
    /selected suite web:integration-training is not eligible for selective CI/,
  );
});

void test('preview-only integration plans cannot reach the executor', async () => {
  const plan = createSelectiveExecutionPlan(manifest, 'web', ['web:integration-training'], {
    planOnly: true,
  });

  await assert.rejects(
    executeSelectivePlan(plan, root, undefined),
    /preview-only selective plan cannot be executed/,
  );
});

void test('integration scenario and project selections preserve exact pairs', () => {
  const scopedManifest = structuredClone(manifest);
  scopedManifest.suites['web:integration-save-retry'].projects = ['chromium'];
  const plan = createSelectiveExecutionPlan(
    scopedManifest,
    'web',
    ['web:integration-auth', 'web:integration-save-retry'],
    { planOnly: true },
  );

  assert.equal(plan.execution, 'preview-only');
  assert.equal(plan.invocations.length, 2);
  assert.deepEqual(
    plan.invocations.map((invocation) => [invocation.args[1], invocation.args[2]]),
    [
      [
        '--scenario=auth-session',
        '--project=chromium,firefox,mobile-en,mobile-es,mobile-pt,tablet-en,tablet-es,tablet-pt,webkit',
      ],
      ['--scenario=save-retry', '--project=chromium'],
    ],
  );
  assert.deepEqual(
    plan.invocations.flatMap((invocation) => {
      const scenarios = invocation.args[1].slice('--scenario='.length).split(',');
      const projects = invocation.args[2].slice('--project='.length).split(',');
      return scenarios.flatMap((scenario) => projects.map((project) => `${scenario}:${project}`));
    }),
    [
      'auth-session:chromium',
      'auth-session:firefox',
      'auth-session:mobile-en',
      'auth-session:mobile-es',
      'auth-session:mobile-pt',
      'auth-session:tablet-en',
      'auth-session:tablet-es',
      'auth-session:tablet-pt',
      'auth-session:webkit',
      'save-retry:chromium',
    ],
  );
  for (const invocation of plan.invocations)
    assert.equal(invocation.args[0], 'test:e2e:web:integration');
});

void test('integration suites with matching scenario sets may share their project union', () => {
  const scopedManifest = structuredClone(manifest);
  scopedManifest.suites['web:integration-save-retry'].integrationScenarios = ['training-durable'];
  scopedManifest.suites['web:integration-save-retry'].projects = ['chromium'];
  const plan = createSelectiveExecutionPlan(
    scopedManifest,
    'web',
    ['web:integration-training', 'web:integration-save-retry'],
    { planOnly: true },
  );

  assert.equal(plan.invocations.length, 1);
  assert.deepEqual(plan.invocations[0].args.slice(1), [
    '--scenario=training-durable',
    '--project=chromium,firefox,mobile-en,mobile-es,mobile-pt,tablet-en,tablet-es,tablet-pt,webkit',
  ]);
});

void test('integration suite metadata requires a declared scenario', () => {
  const invalid = structuredClone(manifest);
  delete invalid.suites['web:integration-auth'].integrationScenarios;

  assert.match(
    validateSelectiveExecutionManifest(invalid).join('\n'),
    /integration suite web:integration-auth has no integrationScenarios/,
  );
});

void test('integration runner rejects missing, relative and non-server roots before acquisition', async () => {
  await assert.rejects(
    resolveIntegrationServerRoot(root, undefined),
    /MYCHAMPIONS_SERVER_ROOT is required/,
  );
  await assert.rejects(
    resolveIntegrationServerRoot(root, '../server'),
    /must be an absolute owning checkout path/,
  );

  const fakeRoot = mkdtempSync(join(tmpdir(), 'mychampions-selective-server-'));
  try {
    mkdirSync(join(fakeRoot, 'scripts', 'testing'), { recursive: true });
    writeFileSync(join(fakeRoot, 'package.json'), JSON.stringify({ name: 'wrong-owner' }));
    await assert.rejects(
      resolveIntegrationServerRoot(root, fakeRoot),
      /not the MyChampions server checkout/,
    );
  } finally {
    rmSync(fakeRoot, { recursive: true, force: true });
  }
});

void test('exercise-search Playwright suite uses an isolated fixture configuration', () => {
  // web:exercise-search (not web:training) owns exercise-search-modal.spec.ts
  // and its own playwright.training.config.ts fixture profile. web:training
  // stays on the default config for the shared responsive-shell.spec.ts, so
  // that spec's other feature-tagged tests (auth, student, professional,
  // connections, nutrition — all tagged at the describe-block level
  // alongside @feature:training) keep running with the fixture environment
  // they actually need instead of this narrower one.
  const plan = createSelectiveExecutionPlan(manifest, 'web', ['web:exercise-search']);

  assert.equal(plan.invocations.length, 1);
  const invocation = plan.invocations[0];
  assert.ok(invocation.args.includes('--config=playwright.training.config.ts'));
  assert.ok(invocation.args.includes('e2e/web/exercise-search-modal.spec.ts'));
});

void test('negative web fixture suites use isolated Playwright configurations', () => {
  const cases = [
    {
      suite: 'web:custom-meal-error',
      config: 'playwright.custom-meal-error.config.ts',
      spec: 'e2e/web/custom-meal-library-error-recovery.spec.ts',
    },
    {
      suite: 'web:professional-roster-error',
      config: 'playwright.professional-roster-error.config.ts',
      spec: 'e2e/web/professional-roster-error.spec.ts',
    },
  ] as const;

  for (const testCase of cases) {
    const plan = createSelectiveExecutionPlan(manifest, 'web', [testCase.suite]);
    assert.equal(plan.invocations.length, 1);
    const invocation = plan.invocations[0];
    assert.ok(invocation.args.includes(`--config=${testCase.config}`));
    assert.ok(invocation.args.includes(testCase.spec));
  }

  assert.ok(!manifest.suites['web:nutrition'].specs.includes(cases[0].spec));
  assert.ok(!manifest.suites['web:professional'].specs.includes(cases[1].spec));
  assert.doesNotMatch(
    readFileSync(`${root}/${cases[0].config}`, 'utf8'),
    /EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE/,
  );
  assert.doesNotMatch(
    readFileSync(`${root}/${cases[1].config}`, 'utf8'),
    /EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE/,
  );
});

void test('training Playwright suite stays on the default fixture configuration', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'web', ['web:training']);

  assert.equal(plan.invocations.length, 1);
  const invocation = plan.invocations[0];
  assert.ok(invocation.args.includes('--config=playwright.config.ts'));
  assert.ok(invocation.args.includes('e2e/web/responsive-shell.spec.ts'));
  assert.ok(!invocation.args.includes('e2e/web/exercise-search-modal.spec.ts'));
});

void test('unknown and wrong-platform suite IDs fail before command construction', () => {
  assert.throws(
    () => createSelectiveExecutionPlan(manifest, 'web', ['web:auth; touch /tmp/should-not-exist']),
    /unknown selected suite/,
  );
  assert.throws(
    () => createSelectiveExecutionPlan(manifest, 'ios', ['web:shell']),
    /cannot run on ios/,
  );
  assert.throws(() => createSelectiveExecutionPlan(manifest, 'web', []), /no suites selected/);
});

void test('provider-live suites are refused by selective CI', () => {
  assert.throws(
    () => createSelectiveExecutionPlan(manifest, 'ios', ['maestro:revenuecat-live']),
    /not eligible for selective CI/,
  );
});

type NativePlan = ReturnType<typeof createSelectiveExecutionPlan>;
type NativeInvocation = NativePlan['invocations'][number];

/** Fixture-phase invocations (each runs against its own fresh Metro). */
function flowRuns(plan: NativePlan): NativeInvocation[] {
  return plan.invocations.filter((invocation) => invocation.metro);
}

function tagOf(invocation: NativeInvocation): string {
  return invocation.args[invocation.args.indexOf('--tag') + 1];
}

function runsFor(plan: NativePlan, flowDir: string): NativeInvocation[] {
  return flowRuns(plan).filter((invocation) => invocation.args.at(-1) === flowDir);
}

void test('Android uses one dev-debug build and never rebuilds per suite', () => {
  const plan = createSelectiveExecutionPlan(
    manifest,
    'android',
    ['maestro:support', 'maestro:student'],
    { diagnosticsRoot: '.artifacts/test-contract' },
  );

  assert.equal(plan.nativeBuild?.configuration, 'android-dev-debug');
  assert.equal(plan.nativeBuild?.owner, 'executor');
  assert.deepEqual(plan.nativeBuild?.command.args, [
    '-c',
    'cd android && ./gradlew app:assembleDevDebug -PreactNativeDevServerPort=8081',
  ]);
  assert.equal(plan.nativeBuild?.command.env.EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX, '');
  // The device is prepared once, before the first fixture phase.
  assert.deepEqual(plan.invocations[0].args, [
    'scripts/testing/maestro-device.sh',
    '--platform',
    'android',
  ]);
  assert.equal(plan.invocations[0].metro, undefined);
  assert.equal(flowRuns(plan).length, 2);
  for (const invocation of flowRuns(plan)) {
    assert.deepEqual(invocation.args.slice(0, 3), [
      'scripts/testing/run-maestro-flows.sh',
      '--platform',
      'android',
    ]);
    assert.equal(
      invocation.args.some((arg) => arg.includes('gradlew')),
      false,
    );
    assert.equal(
      invocation.args[invocation.args.indexOf('--output') + 1].startsWith(
        '.artifacts/test-contract/android/',
      ),
      true,
    );
    assert.equal(invocation.env.APP_VARIANT, 'dev');
    assert.equal(invocation.env.EXPO_PUBLIC_ENV, 'dev');
    assert.equal(invocation.env.CI_REQUIRE_E2E_EXECUTION, 'true');
    assert.equal(invocation.env.EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX, 'true');
    assert.deepEqual(invocation.metro, {
      port: 8081,
      platform: 'android',
      appId: 'com.edufelip.mychampions.dev',
    });
  }
  assert.deepEqual(flowRuns(plan).map(tagOf), ['student-empty-state', 'support']);
});

void test('native E2E LogBox suppression is explicit and dev-only', () => {
  const rootLayout = readFileSync(`${root}/app/_layout.tsx`, 'utf8');

  assert.match(
    rootLayout,
    /if \(__DEV__ && process\.env\.EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX === 'true'\)/,
  );
  assert.match(rootLayout, /LogBox\.ignoreAllLogs\(\)/);
});

void test('NATIVE_SKIP_BUILD transfers the single native build to the workflow', () => {
  const plan = createSelectiveExecutionPlan(
    manifest,
    'ios',
    ['maestro:support', 'maestro:student'],
    {
      skipNativeBuild: true,
    },
  );

  assert.equal(plan.nativeBuild?.configuration, 'ios-debug');
  assert.equal(plan.nativeBuild?.owner, 'workflow');
  assert.equal(plan.nativeBuild?.command.command, 'xcodebuild');
  assert.ok(plan.nativeBuild?.command.args.includes('RCT_METRO_PORT=8081'));
  assert.equal(
    plan.invocations.some((invocation) => invocation.command === 'xcodebuild'),
    false,
  );
  // The workflow owns the build, but the device is still prepared by the plan.
  assert.equal(plan.invocations[0].id, 'prepare-ios-device');
  assert.ok(
    flowRuns(plan).every(
      (invocation) =>
        invocation.metro?.port === 8081 &&
        invocation.metro.platform === 'ios' &&
        invocation.metro.appId === 'com.edufelip.mychampions.dev',
    ),
  );
});

void test('iOS accepts a validated run-isolated Metro port and builds it into the app', () => {
  const metroPort = parseNativeMetroPort('ios', '27828');
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['maestro:support'], {
    metroPort,
  });

  assert.ok(plan.nativeBuild?.command.args.includes('RCT_METRO_PORT=27828'));
  assert.ok(flowRuns(plan).every((invocation) => invocation.metro?.port === 27828));
});

void test('native Metro port overrides fail closed outside the supported port contract', () => {
  assert.equal(parseNativeMetroPort('ios', undefined), 8081);
  assert.equal(parseNativeMetroPort('android', '27828'), 27828);
  assert.throws(() => parseNativeMetroPort('ios', '8081x'), /must contain only decimal digits/);
  assert.throws(
    () => parseNativeMetroPort('ios', '65535'),
    /must be an integer from 1024 to 49151/,
  );
  assert.throws(
    () => parseNativeMetroPort('android', '65535'),
    /native Metro port must be an integer/,
  );
});

void test('Android accepts a run-isolated Metro port and builds it into the app', () => {
  const metroPort = parseNativeMetroPort('android', '27828');
  const plan = createSelectiveExecutionPlan(manifest, 'android', ['maestro:support'], {
    metroPort,
  });

  assert.match(plan.nativeBuild?.command.args[1] ?? '', /-PreactNativeDevServerPort=27828$/);
  assert.ok(flowRuns(plan).every((invocation) => invocation.metro?.port === 27828));
});

void test('auth profile isolates entry, authenticated, and outdated-terms phases', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['maestro:auth'], {
    skipNativeBuild: true,
  });

  assert.equal(flowRuns(plan).length, 7);
  const [signIn] = runsFor(plan, '.maestro/suite/auth-sign-in');
  const [terms] = runsFor(plan, '.maestro/suite/auth-terms');
  const [role] = runsFor(plan, '.maestro/suite/auth-role-selection');

  assert.equal(tagOf(signIn), 'auth-entry');
  assert.equal(tagOf(terms), 'terms-outdated');
  assert.equal(tagOf(role), 'authenticated');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_AUTH_SESSION, '');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION, '');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_CREATE_ACCOUNT, 'true');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN, 'true');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_SOCIAL_AUTH, 'true');
  assert.equal(terms.env.EXPO_PUBLIC_E2E_AUTH_SESSION, 'true');
  assert.equal(terms.env.EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION, 'outdated-e2e-version');
  assert.equal(terms.env.EXPO_PUBLIC_E2E_CREATE_ACCOUNT, '');
  assert.equal(terms.env.EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN, '');
  assert.equal(terms.env.EXPO_PUBLIC_E2E_SOCIAL_AUTH, '');
  assert.equal(role.env.EXPO_PUBLIC_E2E_AUTH_SESSION, 'true');
  assert.equal(role.env.EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION, '');
  assert.equal(role.env.EXPO_PUBLIC_E2E_CREATE_ACCOUNT, '');
  assert.equal(role.env.EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN, '');
  assert.equal(role.env.EXPO_PUBLIC_E2E_SOCIAL_AUTH, '');
});

void test('cleared fixture variables are absent from each child process', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'android', ['maestro:auth'], {
    skipNativeBuild: true,
  });
  const [authenticatedRole] = runsFor(plan, '.maestro/suite/auth-role-selection');
  const previous = process.env.EXPO_PUBLIC_E2E_ROLE_PERSISTENCE;

  try {
    process.env.EXPO_PUBLIC_E2E_ROLE_PERSISTENCE = 'true';
    const environment = buildChildEnvironment(authenticatedRole);

    assert.equal(environment.EXPO_PUBLIC_E2E_ROLE_PERSISTENCE, undefined);
    assert.equal(environment.EXPO_PUBLIC_E2E_AUTH_SESSION, 'true');
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_E2E_ROLE_PERSISTENCE;
    else process.env.EXPO_PUBLIC_E2E_ROLE_PERSISTENCE = previous;
  }
});

void test('role persistence runs only its relaunch flow against a persisting bundle', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['maestro:auth-role-persistence'], {
    skipNativeBuild: true,
  });

  assert.deepEqual(flowRuns(plan).map(tagOf), ['role-persistence']);
  assert.equal(flowRuns(plan)[0].env.EXPO_PUBLIC_E2E_ROLE_PERSISTENCE, 'true');
});

void test('student empty-state profile actively clears incompatible assigned fixtures', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['maestro:student'], {
    skipNativeBuild: true,
  });
  const [invocation] = flowRuns(plan);

  assert.equal(invocation.env.EXPO_PUBLIC_E2E_AUTH_SESSION, 'true');
  assert.equal(invocation.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE, '');
  assert.equal(invocation.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE, '');
});

void test('self-managed plan building is isolated from assigned-plan fixtures', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['maestro:plans'], {
    skipNativeBuild: true,
  });
  const [selfManaged] = runsFor(plan, '.maestro/suite/student-self-managed-builder');
  const [bulkAssign] = runsFor(plan, '.maestro/suite/professional-bulk-assign');

  assert.equal(flowRuns(plan).length, 2);
  assert.equal(selfManaged.env.EXPO_PUBLIC_E2E_AUTH_SESSION, 'true');
  assert.equal(selfManaged.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE, 'basic');
  assert.equal(selfManaged.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE, '');
  assert.equal(selfManaged.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE, '');
  assert.equal(bulkAssign.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE, 'assigned');
  assert.equal(bulkAssign.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE, 'assigned');
});

void test('nutrition profile isolates scenario-specific native fixtures', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['maestro:nutrition'], {
    skipNativeBuild: true,
  });
  const aiAnalysis = runsFor(plan, '.maestro/suite/custom-meal-ai-analysis');
  const imageUpload = runsFor(plan, '.maestro/suite/custom-meal-image-upload');
  const regular = flowRuns(plan).filter(
    (invocation) => !aiAnalysis.includes(invocation) && !imageUpload.includes(invocation),
  );

  assert.equal(flowRuns(plan).length, 10);
  assert.deepEqual(imageUpload.map(tagOf), [
    'image-upload-sheet',
    'image-upload-success',
    'image-upload-permission-denied',
  ]);
  assert.equal(imageUpload[0].env.EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE, '');
  assert.equal(imageUpload[1].env.EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE, 'success');
  assert.equal(imageUpload[2].env.EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE, 'permission-denied');
  assert.deepEqual(aiAnalysis.map(tagOf), ['meal-analysis-paywall', 'meal-analysis-success']);
  assert.equal(aiAnalysis[0].env.EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS, 'lapsed');
  assert.equal(aiAnalysis[0].env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS, 'lapsed');
  assert.equal(aiAnalysis[1].env.EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS, 'active');
  assert.equal(aiAnalysis[1].env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS, 'active');
  assert.ok(regular.every((invocation) => tagOf(invocation) === 'nutrition'));
  assert.ok(
    regular.every((invocation) => invocation.env.EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE === ''),
  );
});

void test('subscription profile expands the existing seven deterministic scenarios', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['maestro:subscription'], {
    skipNativeBuild: true,
  });

  assert.deepEqual(flowRuns(plan).map(tagOf), [
    'actions-success',
    'actions-cancelled',
    'actions-network',
    'actions-store_problem',
    'cap-warning',
    'cap-locked',
    'cap-unknown',
  ]);
  assert.equal(runsFor(plan, '.maestro/suite/professional-subscription-actions').length, 4);
  assert.equal(runsFor(plan, '.maestro/suite/professional-subscription-cap').length, 3);
});

void test('every CI fixture phase has at least one tagged flow in each suite folder it runs', () => {
  const tagged = (flowDir: string, tag: string) =>
    readdirSync(join(root, flowDir))
      .filter((name) => name.endsWith('.yaml') && name !== 'config.yaml')
      .some((name) =>
        new RegExp(`^tags: \\[(.*, )?${tag}(, .*)?\\]$`, 'm').test(
          readFileSync(join(root, flowDir, name), 'utf8'),
        ),
      );
  const ciSuites = Object.entries(manifest.suites)
    .filter(([, suite]) => suite.runner === 'maestro' && suite.ci)
    .map(([suiteId]) => suiteId);
  for (const platform of ['ios', 'android'] as const) {
    const plan = createSelectiveExecutionPlan(manifest, platform, ciSuites, {
      skipNativeBuild: true,
    });
    for (const invocation of flowRuns(plan)) {
      const flowDir = invocation.args.at(-1)!;
      assert.ok(
        tagged(flowDir, tagOf(invocation)),
        `${flowDir} has no flow tagged ${tagOf(invocation)}`,
      );
    }
  }
});

void test('suite JSON parsing is strict', () => {
  assert.deepEqual(parseSelectedSuitesJson('["web:auth"]'), ['web:auth']);
  assert.throws(() => parseSelectedSuitesJson(undefined), /is required/);
  assert.throws(() => parseSelectedSuitesJson('{'), /must be valid JSON/);
  assert.throws(() => parseSelectedSuitesJson('["web:auth", 1]'), /JSON array of suite IDs/);
});

void test('selective invocation timeout is optional locally and strict when configured', () => {
  assert.equal(parseSelectiveInvocationTimeoutMs(undefined), undefined);
  assert.equal(parseSelectiveInvocationTimeoutMs('600000'), 600_000);
  for (const invalid of ['', '0', '-1', '1.5', ' 600000', '2147483648']) {
    assert.throws(
      () => parseSelectiveInvocationTimeoutMs(invalid),
      /SELECTIVE_INVOCATION_TIMEOUT_MS/,
    );
  }
});

void test('Maestro runner refuses an empty CI run for a tag with no flows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'maestro-empty-'));
  try {
    mkdirSync(join(directory, 'suite'));
    writeFileSync(
      join(directory, 'suite', 'flow.yaml'),
      'appId: com.edufelip.mychampions.dev\ntags: [present]\n---\n- launchApp\n',
    );
    const run = (env: Record<string, string>) =>
      spawnSync(
        'bash',
        [
          'scripts/testing/run-maestro-flows.sh',
          '--platform',
          'ios',
          '--tag',
          'absent',
          join(directory, 'suite'),
        ],
        { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' },
      );
    const required = run({ CI_REQUIRE_E2E_EXECUTION: 'true' });
    assert.equal(required.status, 1);
    assert.match(required.stderr, /refusing an empty native run/);
    const optional = run({ CI_REQUIRE_E2E_EXECUTION: '' });
    assert.equal(optional.status, 0);
    assert.match(optional.stdout, /nothing to run/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

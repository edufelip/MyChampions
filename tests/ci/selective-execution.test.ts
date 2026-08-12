import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildChildEnvironment } from '../../scripts/ci/execute-selected-tests';
import {
  createSelectiveExecutionPlan,
  parseNativeMetroPort,
  parseSelectiveInvocationTimeoutMs,
  parseSelectedSuitesJson,
  validateSelectiveExecutionManifest,
} from '../../scripts/ci/selective-execution';
import { loadManifest } from '../../scripts/ci/test-impact';

const root = process.cwd();
const manifest = loadManifest(root);

test('checked-in suites have complete typed execution contracts', () => {
  assert.deepEqual(validateSelectiveExecutionManifest(manifest), []);
});

test('web suites are grouped by runner and project with argv-safe filters', () => {
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

test('web suites can select an explicit Playwright config per project', () => {
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

test('server Playwright suites declare their coordinated backend requirement', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'web', ['web:server-auth']);

  assert.equal(plan.invocations.length, 3);
  for (const invocation of plan.invocations) {
    assert.ok(invocation.args.includes('--config=playwright.server.config.ts'));
    assert.deepEqual(invocation.requiredEnv, ['MYCHAMPIONS_SERVER_ROOT']);
  }
});

test('unknown and wrong-platform suite IDs fail before command construction', () => {
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

test('provider-live suites are refused by selective CI', () => {
  assert.throws(
    () => createSelectiveExecutionPlan(manifest, 'ios', ['detox:revenuecat-live']),
    /not eligible for selective CI/,
  );
});

test('Android uses one dev-debug build and never rebuilds per suite', () => {
  const plan = createSelectiveExecutionPlan(
    manifest,
    'android',
    ['detox:support', 'detox:student'],
    { diagnosticsRoot: '.artifacts/test-contract' },
  );

  assert.equal(plan.nativeBuild?.configuration, 'android.emu.debug');
  assert.equal(plan.nativeBuild?.owner, 'executor');
  assert.deepEqual(plan.nativeBuild?.command.args, ['detox', 'build', '-c', 'android.emu.debug']);
  assert.equal(plan.nativeBuild?.command.env.EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX, '');
  assert.equal(plan.invocations.length, 2);
  for (const invocation of plan.invocations) {
    assert.deepEqual(invocation.args.slice(0, 4), ['detox', 'test', '-c', 'android.emu.debug']);
    assert.equal(invocation.args.includes('build'), false);
    // Bounded retry: native hardware invocations get exactly one Detox retry,
    // and Detox logs retried files so a flaky pass stays visible.
    const retriesIndex = invocation.args.indexOf('--retries');
    assert.notEqual(retriesIndex, -1);
    assert.equal(invocation.args[retriesIndex + 1], '1');
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
});

test('native E2E LogBox suppression is explicit and dev-only', () => {
  const rootLayout = readFileSync(`${root}/app/_layout.tsx`, 'utf8');

  assert.match(
    rootLayout,
    /if \(__DEV__ && process\.env\.EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX === 'true'\)/,
  );
  assert.match(rootLayout, /LogBox\.ignoreAllLogs\(\)/);
});

test('DETOX_SKIP_BUILD transfers the single native build to the workflow', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['detox:support', 'detox:student'], {
    skipNativeBuild: true,
  });

  assert.equal(plan.nativeBuild?.configuration, 'ios.sim.debug');
  assert.equal(plan.nativeBuild?.owner, 'workflow');
  assert.deepEqual(plan.nativeBuild?.command.args, ['detox', 'build', '-c', 'ios.sim.debug']);
  assert.equal(
    plan.invocations.some((invocation) => invocation.args.includes('build')),
    false,
  );
  assert.ok(
    plan.invocations.every(
      (invocation) =>
        invocation.metro?.port === 8081 &&
        invocation.metro.platform === 'ios' &&
        invocation.metro.appId === 'com.edufelip.mychampions.dev',
    ),
  );
});

test('iOS accepts a validated run-isolated Metro port and propagates it to every command', () => {
  const metroPort = parseNativeMetroPort('ios', '27828');
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['detox:support'], {
    metroPort,
  });

  assert.equal(plan.nativeBuild?.command.env.DETOX_METRO_PORT, '27828');
  assert.ok(
    plan.invocations.every(
      (invocation) =>
        invocation.metro?.port === 27828 && invocation.env.DETOX_METRO_PORT === '27828',
    ),
  );
});

test('native Metro port overrides fail closed outside the supported port contract', () => {
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

test('Android accepts a run-isolated Metro port and propagates it to every command', () => {
  const metroPort = parseNativeMetroPort('android', '27828');
  const plan = createSelectiveExecutionPlan(manifest, 'android', ['detox:support'], {
    metroPort,
  });

  assert.equal(plan.nativeBuild?.command.env.DETOX_METRO_PORT, '27828');
  assert.ok(
    plan.invocations.every(
      (invocation) =>
        invocation.metro?.port === 27828 && invocation.env.DETOX_METRO_PORT === '27828',
    ),
  );
});

test('auth profile isolates entry, authenticated, and outdated-terms phases', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['detox:auth'], {
    skipNativeBuild: true,
  });

  assert.equal(plan.invocations.length, 7);
  const signIn = plan.invocations.find((invocation) =>
    invocation.args.includes('e2e/auth-sign-in.e2e.test.js'),
  )!;
  const terms = plan.invocations.find((invocation) =>
    invocation.args.includes('e2e/auth-terms.e2e.test.js'),
  )!;
  const role = plan.invocations.find((invocation) =>
    invocation.args.includes('e2e/auth-role-selection.e2e.test.js'),
  )!;

  assert.equal(signIn.env.EXPO_PUBLIC_E2E_AUTH_SESSION, '');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION, '');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_CREATE_ACCOUNT, 'true');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN, 'true');
  assert.equal(signIn.env.EXPO_PUBLIC_E2E_SOCIAL_AUTH, 'true');
  assert.equal(signIn.env.E2E_AUTH_SIGN_IN, 'true');
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

test('cleared fixture variables are absent from each child process', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'android', ['detox:auth'], {
    skipNativeBuild: true,
  });
  const authenticatedRole = plan.invocations.find((invocation) =>
    invocation.args.includes('e2e/auth-role-selection.e2e.test.js'),
  )!;
  const previous = process.env.E2E_ROLE_PERSISTENCE_SCENARIO;

  try {
    process.env.E2E_ROLE_PERSISTENCE_SCENARIO = 'relaunch';
    const environment = buildChildEnvironment(authenticatedRole);

    assert.equal(environment.E2E_ROLE_PERSISTENCE_SCENARIO, undefined);
    assert.equal(environment.E2E_AUTH_SESSION, 'true');
  } finally {
    if (previous === undefined) delete process.env.E2E_ROLE_PERSISTENCE_SCENARIO;
    else process.env.E2E_ROLE_PERSISTENCE_SCENARIO = previous;
  }
});

test('student empty-state profile actively clears incompatible assigned fixtures', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['detox:student'], {
    skipNativeBuild: true,
  });
  const invocation = plan.invocations[0];

  assert.equal(invocation.env.EXPO_PUBLIC_E2E_AUTH_SESSION, 'true');
  assert.equal(invocation.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE, '');
  assert.equal(invocation.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE, '');
});

test('self-managed plan building is isolated from assigned-plan fixtures', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['detox:plans'], {
    skipNativeBuild: true,
  });
  const selfManaged = plan.invocations.find((invocation) =>
    invocation.args.includes('e2e/student-self-managed-builder.e2e.test.js'),
  )!;
  const bulkAssign = plan.invocations.find((invocation) =>
    invocation.args.includes('e2e/professional-bulk-assign.e2e.test.js'),
  )!;

  assert.equal(plan.invocations.length, 2);
  assert.equal(selfManaged.env.EXPO_PUBLIC_E2E_AUTH_SESSION, 'true');
  assert.equal(selfManaged.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE, 'basic');
  assert.equal(selfManaged.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE, '');
  assert.equal(selfManaged.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE, '');
  assert.equal(bulkAssign.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE, 'assigned');
  assert.equal(bulkAssign.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE, 'assigned');
});

test('nutrition profile isolates scenario-specific native fixtures', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['detox:nutrition'], {
    skipNativeBuild: true,
  });
  const aiAnalysisInvocations = plan.invocations.filter((invocation) =>
    invocation.args.includes('e2e/custom-meal-ai-analysis.e2e.test.js'),
  );
  const imageUploadInvocations = plan.invocations.filter((invocation) =>
    invocation.args.includes('e2e/custom-meal-image-upload.e2e.test.js'),
  );
  const unrelatedNutritionInvocations = plan.invocations.filter(
    (invocation) =>
      !invocation.args.includes('e2e/custom-meal-ai-analysis.e2e.test.js') &&
      !invocation.args.includes('e2e/custom-meal-image-upload.e2e.test.js'),
  );
  const regularNutritionInvocations = plan.invocations.filter(
    (invocation) => !invocation.args.includes('e2e/custom-meal-ai-analysis.e2e.test.js'),
  );

  assert.equal(plan.invocations.length, 10);
  assert.equal(aiAnalysisInvocations.length, 2);
  assert.equal(imageUploadInvocations.length, 3);
  assert.deepEqual(
    imageUploadInvocations.map((invocation) => invocation.env.E2E_IMAGE_UPLOAD_SCENARIO),
    ['sheet', 'success', 'permission-denied'],
  );
  assert.equal(imageUploadInvocations[0].env.EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE, '');
  assert.equal(imageUploadInvocations[1].env.EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE, 'success');
  assert.equal(
    imageUploadInvocations[2].env.EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE,
    'permission-denied',
  );
  assert.ok(
    unrelatedNutritionInvocations.every(
      (invocation) => invocation.env.E2E_IMAGE_UPLOAD_SCENARIO === '',
    ),
  );
  assert.deepEqual(
    aiAnalysisInvocations.map((invocation) => invocation.env.E2E_MEAL_ANALYSIS_SCENARIO),
    ['paywall', 'success'],
  );
  assert.equal(aiAnalysisInvocations[0].env.EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS, 'lapsed');
  assert.equal(aiAnalysisInvocations[0].env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS, 'lapsed');
  assert.equal(aiAnalysisInvocations[1].env.EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS, 'active');
  assert.equal(aiAnalysisInvocations[1].env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS, 'active');
  assert.ok(
    regularNutritionInvocations.every(
      (invocation) => invocation.env.E2E_MEAL_ANALYSIS_SCENARIO === '',
    ),
  );
});

test('subscription profile expands the existing seven deterministic scenarios', () => {
  const plan = createSelectiveExecutionPlan(manifest, 'ios', ['detox:subscription'], {
    skipNativeBuild: true,
  });

  assert.equal(plan.invocations.length, 7);
  assert.deepEqual(
    plan.invocations.map((invocation) => invocation.env.E2E_SUBSCRIPTION_SCENARIO),
    ['actions', 'actions', 'actions', 'actions', 'warning', 'locked', 'unknown'],
  );
  assert.equal(
    plan.invocations.filter((invocation) =>
      invocation.args.includes('e2e/professional-subscription-actions.e2e.test.js'),
    ).length,
    4,
  );
  assert.equal(
    plan.invocations.filter((invocation) =>
      invocation.args.includes('e2e/professional-subscription-cap.e2e.test.js'),
    ).length,
    3,
  );
});

test('suite JSON parsing is strict', () => {
  assert.deepEqual(parseSelectedSuitesJson('["web:auth"]'), ['web:auth']);
  assert.throws(() => parseSelectedSuitesJson(undefined), /is required/);
  assert.throws(() => parseSelectedSuitesJson('{'), /must be valid JSON/);
  assert.throws(() => parseSelectedSuitesJson('["web:auth", 1]'), /JSON array of suite IDs/);
});

test('selective invocation timeout is optional locally and strict when configured', () => {
  assert.equal(parseSelectiveInvocationTimeoutMs(undefined), undefined);
  assert.equal(parseSelectiveInvocationTimeoutMs('600000'), 600_000);
  for (const invalid of ['', '0', '-1', '1.5', ' 600000', '2147483648']) {
    assert.throws(
      () => parseSelectiveInvocationTimeoutMs(invalid),
      /SELECTIVE_INVOCATION_TIMEOUT_MS/,
    );
  }
});

test('CI reporter fails an all-skipped Detox invocation', () => {
  type Reporter = {
    onRunComplete: (
      contexts: unknown,
      results: { numPassedTests: number; numFailedTests: number },
    ) => void;
    getLastError: () => Error | null;
  };
  const require = createRequire(import.meta.url);
  const ReporterConstructor = require('../../e2e/ci-execution-reporter.js') as new () => Reporter;
  const previous = process.env.CI_REQUIRE_E2E_EXECUTION;

  try {
    process.env.CI_REQUIRE_E2E_EXECUTION = 'true';
    const skipped = new ReporterConstructor();
    skipped.onRunComplete(new Set(), { numPassedTests: 0, numFailedTests: 0 });
    assert.match(skipped.getLastError()?.message ?? '', /executed no tests/);

    const executed = new ReporterConstructor();
    executed.onRunComplete(new Set(), { numPassedTests: 1, numFailedTests: 0 });
    assert.equal(executed.getLastError(), null);
  } finally {
    if (previous === undefined) delete process.env.CI_REQUIRE_E2E_EXECUTION;
    else process.env.CI_REQUIRE_E2E_EXECUTION = previous;
  }
});

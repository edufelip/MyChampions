import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import appConfig from '../../app.config';
import {
  assertNoIntegratedBypasses,
  assertResolvedIntegratedExpoConfig,
  createIntegratedAppEnvironment,
  requireIntegratedLoopbackOrigin,
} from '../../scripts/testing/integration-preflight';

const target = { appOrigin: 'http://127.0.0.1:42001', apiOrigin: 'http://127.0.0.1:42002' };

void test('inherited fixtures, auth, terms and unknown bypasses fail before sanitizing environment', () => {
  for (const [key, value] of [
    ['EXPO_PUBLIC_E2E_AUTH_SESSION', 'true'],
    ['EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS', 'active'],
    ['EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE', 'basic'],
    ['EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION', 'false'],
    ['EXPO_PUBLIC_E2E_UNKNOWN_BYPASS', 'false'],
  ])
    assert.throws(() => createIntegratedAppEnvironment({ [key]: value }, target), /forbids bypass/);
  assert.doesNotThrow(() =>
    assertNoIntegratedBypasses({
      EXPO_PUBLIC_E2E_AUTH_SESSION: 'false',
      EXPO_PUBLIC_E2E_CREATE_ACCOUNT: ' FALSE ',
      EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE: '',
    }),
  );
});

void test('integration origins are exact, separate and loopback-only', () => {
  for (const origin of [
    'https://127.0.0.1:42001',
    'http://localhost:42001',
    'http://example.com:42001',
    `${target.apiOrigin}/path`,
    'http://user:pass@127.0.0.1:42001',
    'http://127.0.0.1:80',
  ])
    assert.throws(() => requireIntegratedLoopbackOrigin(origin), /loopback/);
  assert.throws(
    () => createIntegratedAppEnvironment({}, { ...target, apiOrigin: target.appOrigin }),
    /distinct from Expo/,
  );
  assert.throws(
    () =>
      createIntegratedAppEnvironment(
        { EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL: 'http://127.0.0.1:3400' },
        target,
      ),
    /differs/,
  );
  assert.throws(() => createIntegratedAppEnvironment({ APP_VARIANT: 'prod' }, target), /dev app/);
});

void test('minimal Expo environment disables dotenv and excludes inherited providers and data credentials', () => {
  const env = createIntegratedAppEnvironment(
    {
      PATH: '/usr/bin',
      DATABASE_URL: 'foreign-database',
      EXPO_NO_DOTENV: '0',
      GOOGLE_WEB_CLIENT_ID: 'foreign-social',
      EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV: 'foreign-provider',
    },
    target,
  );
  assert.equal(env.EXPO_NO_DOTENV, '1');
  assert.equal(env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL, target.apiOrigin);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.GOOGLE_WEB_CLIENT_ID, undefined);
  assert.equal(env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV, undefined);
});

void test('real resolved app config retains the owned origin and has no auth/domain fixtures or providers', () => {
  const env = createIntegratedAppEnvironment(
    { PATH: process.env.PATH, HOME: process.env.HOME },
    target,
  );
  const previous = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    const resolved = appConfig({
      config: { name: 'test', slug: 'test' },
      projectRoot: process.cwd(),
      staticConfigPath: null,
      packageJsonPath: null,
    });
    const extra = resolved.extra;
    assert.ok(extra);
    assertResolvedIntegratedExpoConfig(extra, target.apiOrigin);
    assert.throws(
      () =>
        assertResolvedIntegratedExpoConfig(
          { ...extra, server: { baseUrl: target.appOrigin } },
          target.apiOrigin,
        ),
      /does not match/,
    );
    assert.throws(
      () =>
        assertResolvedIntegratedExpoConfig(
          { ...extra, e2e: { ...extra.e2e, acceptedTermsVersion: 'v1' } },
          target.apiOrigin,
        ),
      /enables/,
    );
    assert.throws(
      () =>
        assertResolvedIntegratedExpoConfig(
          { ...extra, revenueCatApiKeyIos: 'foreign' },
          target.apiOrigin,
        ),
      /outside/,
    );
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

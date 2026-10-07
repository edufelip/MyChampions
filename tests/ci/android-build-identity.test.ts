import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANDROID_PILOT_APP_ID,
  androidMetroPreference,
  assertAndroidPilotApkMetadata,
  assertAndroidReverseMappings,
} from '../../scripts/testing/android-build-identity';

function metadata() {
  return {
    badging: `package: name='${ANDROID_PILOT_APP_ID}' versionCode='1'\napplication-debuggable\nlaunchable-activity: name='com.edufelip.mychampions.MainActivity' label='Dev'\n`,
    signing: `Verifies\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: ${'a'.repeat(64)}\n`,
    config: {
      slug: 'my-champions',
      android: { package: ANDROID_PILOT_APP_ID },
      extra: {
        appVariant: 'dev',
        server: { baseUrl: 'http://127.0.0.1:32123' },
        e2e: {
          acceptedTermsVersion: '',
          authSession: '',
          createAccount: '',
          emailPasswordSignIn: '',
          socialAuth: '',
        },
        revenueCatApiKeyIos: '',
        revenueCatApiKeyAndroid: '',
        revenueCatTestStoreEnabled: false,
      },
    },
  };
}
void test('APK guard rejects production, non-debug, wrong launcher or unverified signing', () => {
  const input = metadata();
  assert.equal(
    assertAndroidPilotApkMetadata(input, 'http://127.0.0.1:32123').appId,
    ANDROID_PILOT_APP_ID,
  );
  for (const badging of [
    input.badging.replace('.dev', ''),
    input.badging.replace('application-debuggable\n', ''),
    input.badging.replace('com.edufelip.mychampions.MainActivity', 'com.foreign.MainActivity'),
  ])
    assert.throws(
      () => assertAndroidPilotApkMetadata({ ...input, badging }, 'http://127.0.0.1:32123'),
      /dev\/debug/,
    );
  assert.throws(
    () =>
      assertAndroidPilotApkMetadata(
        { ...input, signing: input.signing.replace('Verifies', 'DOES NOT VERIFY') },
        'http://127.0.0.1:32123',
      ),
    /dev\/debug/,
  );
});
void test('APK guard rejects inherited fixture/provider config and a compiled foreign API', () => {
  for (const mutate of [
    (input: ReturnType<typeof metadata>) => {
      input.config.extra.server.baseUrl = 'https://production.example';
    },
    (input: ReturnType<typeof metadata>) => {
      input.config.extra.e2e.authSession = 'true';
    },
    (input: ReturnType<typeof metadata>) => {
      input.config.extra.revenueCatApiKeyAndroid = 'provider-key';
    },
  ]) {
    const input = metadata();
    mutate(input);
    assert.throws(() => assertAndroidPilotApkMetadata(input, 'http://127.0.0.1:32123'));
  }
});
void test('Metro setup is dev-only and reverse mappings require exact target and endpoint', () => {
  assert.match(
    androidMetroPreference(ANDROID_PILOT_APP_ID, 31333).xml,
    /debug_http_host">localhost:31333/,
  );
  assert.throws(() => androidMetroPreference('com.edufelip.mychampions', 31333), /dev app/);
  assert.throws(() => androidMetroPreference(ANDROID_PILOT_APP_ID, 808), /owned port/);
  assert.doesNotThrow(() =>
    assertAndroidReverseMappings(
      'emulator-5554 tcp:31333 tcp:31333\nemulator-5554 tcp:32123 tcp:32123',
      'emulator-5554',
      [31333, 32123],
    ),
  );
  assert.doesNotThrow(() =>
    assertAndroidReverseMappings(
      'host-19 tcp:31333 tcp:31333\nhost-19 tcp:32123 tcp:32123',
      'emulator-5554',
      [31333, 32123],
    ),
  );
  for (const output of [
    'foreign tcp:31333 tcp:31333',
    'host-19 tcp:31333 tcp:31333\nhost-19 tcp:31333 tcp:31333',
    'host-19 tcp:31333 tcp:31333\nhost-20 tcp:32123 tcp:32123',
  ])
    assert.throws(
      () => assertAndroidReverseMappings(output, 'emulator-5554', [31333, 32123]),
      /unexpected endpoint/,
    );
  assert.throws(
    () =>
      assertAndroidReverseMappings('emulator-5554 tcp:31333 tcp:8081', 'emulator-5554', [31333]),
    /unexpected endpoint/,
  );
  assert.throws(
    () =>
      assertAndroidReverseMappings('emulator-5556 tcp:31333 tcp:31333', 'emulator-5554', [31333]),
    /unexpected endpoint/,
  );
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');
const requireFromTest = createRequire(import.meta.url);

test('iOS PR workflow runs split-mode Detox smoke coverage for migrated auth/server flows', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const detoxConfig = readFileSync(join(root, '.detoxrc.js'), 'utf8');
  const smokeRunner = readFileSync(join(root, 'scripts/run-detox-ios-debug-smoke.sh'), 'utf8');
  const authEntryConfig = readFileSync(join(root, 'e2e/jest.auth-entry.config.js'), 'utf8');
  const authenticatedConfig = readFileSync(join(root, 'e2e/jest.authenticated.config.js'), 'utf8');
  const workflow = readFileSync(join(root, '.github/workflows/ios-pr.yml'), 'utf8');

  assert.match(detoxConfig, /DETOX_JEST_CONFIG/, 'Detox config should allow focused Jest configs');
  assert.equal(
    packageJson.scripts?.['test:e2e:ios:debug:smoke'],
    'bash scripts/run-detox-ios-debug-smoke.sh',
    'mobile package should expose the split-mode iOS debug Detox smoke script',
  );
  assert.match(
    workflow,
    /test:e2e:ios:debug:smoke/,
    'iOS PR workflow should run focused Detox smoke',
  );
  assert.doesNotMatch(
    workflow,
    /EXPO_PUBLIC_E2E_AUTH_SESSION/,
    'fixture state should stay inside the smoke runner',
  );
  assert.match(
    smokeRunner,
    /yarn test:e2e:build:ios:debug/,
    'each fixture mode should rebuild the Debug app',
  );
  assert.match(smokeRunner, /e2e\/jest\.auth-entry\.config\.js/);
  assert.match(smokeRunner, /e2e\/jest\.authenticated\.config\.js/);
  assert.match(authEntryConfig, /auth-sign-in\.e2e\.test\.js/);
  assert.match(authenticatedConfig, /auth-role-selection\.e2e\.test\.js/);
  assert.match(authenticatedConfig, /student-professionals\.e2e\.test\.js/);
});

test('Android Detox targets the committed dev and production flavors on an available AVD', () => {
  const detoxConfig = readFileSync(join(root, '.detoxrc.js'), 'utf8');
  const detoxConfiguration = requireFromTest(join(root, '.detoxrc.js')) as {
    apps: Record<string, { reversePorts?: number[] }>;
  };
  const instrumentation = readFileSync(
    join(
      root,
      'android',
      'app',
      'src',
      'androidTest',
      'java',
      'com',
      'eduardo880',
      'mychampions',
      'DetoxTest.java',
    ),
    'utf8',
  );
  const androidSettings = readFileSync(join(root, 'android', 'settings.gradle'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.match(detoxConfig, /android\/app\/build\/outputs\/apk\/dev\/debug\/app-dev-debug\.apk/);
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/androidTest\/dev\/debug\/app-dev-debug-androidTest\.apk/,
  );
  assert.match(detoxConfig, /app:assembleDevDebug app:assembleDevDebugAndroidTest/);
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/production\/release\/app-production-release\.apk/,
  );
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/androidTest\/production\/release\/app-production-release-androidTest\.apk/,
  );
  assert.match(
    detoxConfig,
    /-PCI_VERSION_CODE="\\?\$\{CI_VERSION_CODE:\?CI_VERSION_CODE_required\}"/,
    'signed Android Detox builds must require and forward the release version code',
  );
  assert.match(
    detoxConfig,
    /app:assembleProductionRelease app:assembleProductionReleaseAndroidTest/,
  );
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/production\/debug\/app-production-debug\.apk/,
  );
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/androidTest\/production\/debug\/app-production-debug-androidTest\.apk/,
  );
  assert.match(detoxConfig, /app:assembleProductionDebug app:assembleProductionDebugAndroidTest/);
  assert.match(detoxConfig, /'android\.emu\.prodDebug'/);
  assert.equal(
    packageJson.scripts?.['test:e2e:build:android'],
    'detox build -c android.emu.prodDebug',
    'default Android Detox builds must use the secret-free productionDebug variant',
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:android'],
    'detox test -c android.emu.prodDebug',
    'default Android Detox tests must use the matching productionDebug variant',
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:build:android:prod-debug'],
    'detox build -c android.emu.prodDebug',
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:android:prod-debug'],
    'detox test -c android.emu.prodDebug',
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:build:android:release'],
    'detox build -c android.emu.release',
    'signed productionRelease builds must remain an explicit opt-in command',
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:android:release'],
    'detox test -c android.emu.release',
    'signed productionRelease tests must remain an explicit opt-in command',
  );
  assert.match(detoxConfig, /DETOX_ANDROID_AVD \|\| 'Pixel_10'/);
  assert.match(detoxConfig, /const rawMetroPort = process\.env\.DETOX_METRO_PORT \|\| '8081'/);
  assert.doesNotMatch(detoxConfig, /outputs\/apk\/debug\/app-debug\.apk/);
  assert.doesNotMatch(detoxConfig, /\bassembleDebug\b/);
  assert.doesNotMatch(detoxConfig, /Pixel_9/);
  const expectedMetroPort = Number(process.env.DETOX_METRO_PORT || '8081');
  assert.deepEqual(detoxConfiguration.apps['android.debug']?.reversePorts, [expectedMetroPort]);
  assert.match(instrumentation, /REACT_NATIVE_DEBUG_SERVER_HOST = "debug_http_host"/);
  assert.match(instrumentation, /DETOX_METRO_HOST = BuildConfig\.DETOX_METRO_HOST/);
  assert.match(instrumentation, /\.putString\(REACT_NATIVE_DEBUG_SERVER_HOST, DETOX_METRO_HOST\)/);
  assert.match(instrumentation, /\.commit\(\)/);
  const metroRouteIndex = instrumentation.indexOf('routeMetroThroughAdbReverse();');
  const detoxRunIndex = instrumentation.indexOf('Detox.runTests(activityRule);');
  assert.notEqual(metroRouteIndex, -1, 'instrumentation must call the Metro route helper');
  assert.notEqual(detoxRunIndex, -1, 'instrumentation must call Detox.runTests');
  assert.ok(
    metroRouteIndex < detoxRunIndex,
    'instrumentation must configure the localhost Metro route before React Native launches',
  );
  assert.match(androidSettings, /require\.resolve\('detox\/package\.json'\)/);
  assert.match(androidSettings, /new File\(detoxPackageDir, 'android\/detox'\)/);
  assert.doesNotMatch(androidSettings, /\.\.\/node_modules\/detox/);
});

test('selective native execution fully prewarms Metro before Detox launches', () => {
  const executor = readFileSync(join(root, 'scripts', 'ci', 'execute-selected-tests.ts'), 'utf8');
  const readinessIndex = executor.indexOf('await waitForMetro(port, metro);');
  const prewarmIndex = executor.indexOf('await prewarmMetroBundle(invocation.metro!)');
  const detoxIndex = executor.indexOf(
    'await runChild(invocation.id, invocation.command, invocation.args',
  );

  assert.notEqual(readinessIndex, -1, 'executor must wait for Metro readiness');
  assert.notEqual(prewarmIndex, -1, 'executor must fully prewarm the native bundle');
  assert.notEqual(detoxIndex, -1, 'executor must launch the selected Detox command');
  assert.ok(
    readinessIndex < prewarmIndex && prewarmIndex < detoxIndex,
    'executor must finish Metro bundle prewarming before Detox launches',
  );
  assert.match(executor, /process\.on\('SIGINT', \(\) => requestCancellation\('SIGINT'\)\)/);
  assert.match(executor, /process\.on\('SIGTERM', \(\) => requestCancellation\('SIGTERM'\)\)/);
  assert.match(
    executor,
    /detached: process\.platform !== 'win32'[\s\S]*?trackProcessGroup\(child, 'invocation'\)/,
  );
  assert.match(executor, /trackProcessGroup\(metro, 'metro'\)/);
  assert.match(executor, /stopRunnerOwnedProcessGroup\(child, options\)/);
  assert.match(executor, /exitTimeoutMs: 500, pollIntervalMs: 50/);
  assert.match(executor, /Invocation \$\{invocationId\} timed out after \$\{timeoutMs\} ms/);
});

test('iOS selective CI reserves a dedicated Metro port and routes every app launch to it', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'trusted-selective-tests.yml'),
    'utf8',
  );
  const detoxConfig = readFileSync(join(root, '.detoxrc.js'), 'utf8');

  assert.match(workflow, /DETOX_METRO_PORT: '18081'/);
  assert.match(workflow, /lsof -nP -iTCP:"\$DETOX_METRO_PORT" -sTCP:LISTEN/);
  assert.match(detoxConfig, /RCT_jsLocation: `localhost:\$\{iosMetroPort\}`/);
  assert.match(
    detoxConfig,
    /-derivedDataPath ios\/build RCT_METRO_PORT="\$\{DETOX_METRO_PORT:-8081\}"/,
  );
});

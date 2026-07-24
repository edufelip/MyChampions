import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

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
    'mobile package should expose the split-mode iOS debug Detox smoke script'
  );
  assert.match(workflow, /test:e2e:ios:debug:smoke/, 'iOS PR workflow should run focused Detox smoke');
  assert.doesNotMatch(workflow, /EXPO_PUBLIC_E2E_AUTH_SESSION/, 'fixture state should stay inside the smoke runner');
  assert.match(smokeRunner, /yarn test:e2e:build:ios:debug/, 'each fixture mode should rebuild the Debug app');
  assert.match(smokeRunner, /e2e\/jest\.auth-entry\.config\.js/);
  assert.match(smokeRunner, /e2e\/jest\.authenticated\.config\.js/);
  assert.match(authEntryConfig, /auth-sign-in\.e2e\.test\.js/);
  assert.match(authenticatedConfig, /auth-role-selection\.e2e\.test\.js/);
  assert.match(authenticatedConfig, /student-professionals\.e2e\.test\.js/);
});

test('Android Detox targets the committed dev and production flavors on an available AVD', () => {
  const detoxConfig = readFileSync(join(root, '.detoxrc.js'), 'utf8');
  const androidSettings = readFileSync(join(root, 'android', 'settings.gradle'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.match(detoxConfig, /android\/app\/build\/outputs\/apk\/dev\/debug\/app-dev-debug\.apk/);
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/androidTest\/dev\/debug\/app-dev-debug-androidTest\.apk/
  );
  assert.match(detoxConfig, /app:assembleDevDebug app:assembleDevDebugAndroidTest/);
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/production\/release\/app-production-release\.apk/
  );
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/androidTest\/production\/release\/app-production-release-androidTest\.apk/
  );
  assert.match(detoxConfig, /app:assembleProductionRelease app:assembleProductionReleaseAndroidTest/);
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/production\/debug\/app-production-debug\.apk/
  );
  assert.match(
    detoxConfig,
    /android\/app\/build\/outputs\/apk\/androidTest\/production\/debug\/app-production-debug-androidTest\.apk/
  );
  assert.match(detoxConfig, /app:assembleProductionDebug app:assembleProductionDebugAndroidTest/);
  assert.match(detoxConfig, /'android\.emu\.prodDebug'/);
  assert.equal(
    packageJson.scripts?.['test:e2e:build:android'],
    'detox build -c android.emu.prodDebug',
    'default Android Detox builds must use the secret-free productionDebug variant'
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:android'],
    'detox test -c android.emu.prodDebug',
    'default Android Detox tests must use the matching productionDebug variant'
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:build:android:prod-debug'],
    'detox build -c android.emu.prodDebug'
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:android:prod-debug'],
    'detox test -c android.emu.prodDebug'
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:build:android:release'],
    'detox build -c android.emu.release',
    'signed productionRelease builds must remain an explicit opt-in command'
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:android:release'],
    'detox test -c android.emu.release',
    'signed productionRelease tests must remain an explicit opt-in command'
  );
  assert.match(detoxConfig, /DETOX_ANDROID_AVD \|\| 'Pixel_10'/);
  assert.doesNotMatch(detoxConfig, /outputs\/apk\/debug\/app-debug\.apk/);
  assert.doesNotMatch(detoxConfig, /\bassembleDebug\b/);
  assert.doesNotMatch(detoxConfig, /Pixel_9/);
  assert.match(androidSettings, /require\.resolve\('detox\/package\.json'\)/);
  assert.match(androidSettings, /new File\(detoxPackageDir, 'android\/detox'\)/);
  assert.doesNotMatch(androidSettings, /\.\.\/node_modules\/detox/);
});

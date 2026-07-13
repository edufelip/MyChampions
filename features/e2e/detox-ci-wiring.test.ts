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

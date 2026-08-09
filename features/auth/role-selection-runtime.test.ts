import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const roleSelectionSource = readFileSync(
  join(process.cwd(), 'app/auth/role-selection.tsx'),
  'utf8',
);
const pillButtonSource = readFileSync(
  join(process.cwd(), 'components/ds/primitives/DsPillButton.tsx'),
  'utf8',
);
const roleSelectionE2ESource = readFileSync(
  join(process.cwd(), 'e2e/auth-role-selection.e2e.test.js'),
  'utf8',
);

function componentOpeningTag(source: string, component: string, testId: string): string {
  const testIdIndex = source.indexOf(`testID="${testId}"`);
  assert.notEqual(testIdIndex, -1);
  const componentIndex = source.lastIndexOf(`<${component}`, testIdIndex);
  assert.notEqual(componentIndex, -1);
  return source.slice(componentIndex, testIdIndex);
}

test('role selection binds the preselection guard to the Continue control', () => {
  assert.match(
    roleSelectionSource,
    /const isContinueDisabled = isSubmitting \|\| !isHydrated \|\| !currentUser \|\| !selectedRole;/,
  );
  assert.match(
    componentOpeningTag(roleSelectionSource, 'DsPillButton', 'auth.roleSelection.continueButton'),
    /disabled=\{isContinueDisabled\}/,
  );
});

test('the shared pill button exposes and enforces its disabled accessibility state', () => {
  assert.match(
    pillButtonSource,
    /accessibilityState=\{\{ busy: loading, disabled: disabled \|\| loading \}\}/,
  );
  assert.match(pillButtonSource, /disabled=\{disabled \|\| loading\}/);
});

test('role-selection E2E disables synchronization before app startup work', () => {
  assert.match(
    roleSelectionE2ESource,
    /beforeEach\(async \(\) => \{[\s\S]*?await device\.launchApp\(\{[\s\S]*?newInstance: true,[\s\S]*?launchArgs: \{ detoxEnableSynchronization: 0 \},[\s\S]*?\}\);[\s\S]*?\}\);/,
  );
  assert.doesNotMatch(roleSelectionE2ESource, /disableSynchronization/);
  assert.match(roleSelectionE2ESource, /itWithRolePersistenceScenario/);
  assert.equal(roleSelectionE2ESource.match(/device\.launchApp/g)?.length, 2);
});

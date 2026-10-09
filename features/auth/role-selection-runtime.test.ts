import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
const roleSelectionFlowDirectory = join(process.cwd(), '.maestro/suite/auth-role-selection');
const roleSelectionFlows = readdirSync(roleSelectionFlowDirectory)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => ({
    name,
    source: readFileSync(join(roleSelectionFlowDirectory, name), 'utf8'),
  }));

function componentOpeningTag(source: string, component: string, testId: string): string {
  const testIdIndex = source.indexOf(`testID="${testId}"`);
  assert.notEqual(testIdIndex, -1);
  const componentIndex = source.lastIndexOf(`<${component}`, testIdIndex);
  assert.notEqual(componentIndex, -1);
  return source.slice(componentIndex, testIdIndex);
}

test('the shared pill button exposes and enforces its disabled accessibility state', () => {
  assert.match(
    pillButtonSource,
    /accessibilityState=\{\{ busy: loading, disabled: disabled \|\| loading \}\}/,
  );
  assert.match(pillButtonSource, /disabled=\{disabled \|\| loading\}/);
});

test('role-selection E2E starts each case fresh and only the persistence case relaunches', () => {
  assert.ok(roleSelectionFlows.length > 0);
  for (const { name, source } of roleSelectionFlows) {
    assert.match(source, /^- runFlow: \.\.\/common\/launch-fresh\.yaml$/m, name);
    const persistence = /^tags: \[role-persistence\]$/m.test(source);
    assert.equal(/relaunch\.yaml/.test(source), persistence, name);
  }
  assert.equal(
    roleSelectionFlows.filter(({ source }) => /^tags: \[role-persistence\]$/m.test(source)).length,
    1,
  );
});

test('role-selection preserves its explicit destination while the role guard updates', () => {
  assert.match(roleSelectionSource, /beginRoleSelectionNavigation\(role\);/);
  assert.match(
    roleSelectionSource,
    /router\.replace\(\(returnTo \?\? resolvePostRoleRoute\(role\)\) as never\);/,
  );
  assert.match(roleSelectionSource, /completeRoleSelectionNavigation\(\);/);
});

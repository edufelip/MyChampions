import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

test('iOS build settings resolve React Native from repository-local node_modules', () => {
  const project = readFileSync(
    join(root, 'ios', 'mychampions.xcodeproj', 'project.pbxproj'),
    'utf8'
  );
  const expected = 'REACT_NATIVE_PATH = "${PODS_ROOT}/../../node_modules/react-native";';

  assert.equal(project.split(expected).length - 1, 2);
  assert.doesNotMatch(project, /REACT_NATIVE_PATH = "\$\{PODS_ROOT\}\/\.\.\/\.\.\/\.\.\//);
});

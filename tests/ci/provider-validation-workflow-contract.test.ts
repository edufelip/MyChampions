import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/provider-validation.yml', 'utf8');
const metroRunner = readFileSync('scripts/run-detox-ios-debug.sh', 'utf8');

test('provider validation is protected, exact-head, and isolated from native Detox', () => {
  assert.match(
    workflow,
    /if: github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/heads\/release\/'\)/,
  );
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /EXPECTED_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /actual_sha=.*git rev-parse HEAD/);
  assert.match(workflow, /group: mychampions-protected-ios-detox/);
  assert.match(workflow, /run-with-native-host-lock\.sh/);
  assert.match(workflow, /DETOX_METRO_PORT: '18081'/);
});

test('provider Metro cleanup uses a process group or recursive process-tree fallback', () => {
  assert.match(metroRunner, /DETOX_METRO_PROCESS_GROUP/);
  assert.match(metroRunner, /kill -TERM "-\$metro_pid"/);
  assert.match(metroRunner, /terminate_process_tree/);
  assert.match(metroRunner, /Metro port \$\{metro_port\} remained occupied after cleanup/);
});

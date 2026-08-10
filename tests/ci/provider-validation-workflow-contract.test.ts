import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/provider-validation.yml', 'utf8');
const metroRunner = readFileSync('scripts/run-detox-ios-debug.sh', 'utf8');
const lockRunnerPath = 'scripts/ci/run-with-native-host-lock.sh';
const lockRunner = readFileSync(lockRunnerPath, 'utf8');

test('provider validation is protected, exact-head, and isolated from native Detox', () => {
  assert.match(workflow, /resolve-ios-tests:/);
  assert.match(workflow, /IOS_TESTS_VALUE: \$\{\{ vars\.MYCHAMPIONS_ENABLE_IOS_TESTS \}\}/);
  assert.match(workflow, /os\.environ\.get\("IOS_TESTS_VALUE", ""\) != "false"/);
  assert.match(workflow, /needs: resolve-ios-tests/);
  assert.match(workflow, /needs\.resolve-ios-tests\.outputs\.enabled == 'true'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /startsWith\(github\.ref, 'refs\/heads\/release\/'\)/);
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

test('native host lock releases after successful and failed commands', () => {
  const stateRoot = mkdtempSync(join(tmpdir(), 'mychampions-native-host-lock-'));
  chmodSync(stateRoot, 0o700);
  const env = { ...process.env, MYCHAMPIONS_NATIVE_STATE_ROOT: stateRoot, RUNNER_TEMP: stateRoot };
  const run = (status: number) =>
    spawnSync('bash', [lockRunnerPath, 'bash', '-c', `exit ${status}`], {
      env,
      encoding: 'utf8',
    });
  const assertLockIsReleasable = () => {
    const probe = spawnSync('/usr/bin/python3', [
      '-c',
      `import fcntl\nhandle = open(${JSON.stringify(join(stateRoot, 'mychampions-native-host.lock'))}, 'a+')\nfcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)`,
    ]);
    assert.equal(probe.status, 0, probe.stderr?.toString());
  };

  assert.equal(run(0).status, 0);
  assertLockIsReleasable();
  assert.equal(run(7).status, 7);
  assertLockIsReleasable();
  assert.equal(statSync(join(stateRoot, 'mychampions-native-host.lock')).mode & 0o777, 0o600);
  assert.deepEqual(
    readdirSync(stateRoot).filter((entry) => entry.endsWith('.ready')),
    [],
  );
  assert.doesNotMatch(lockRunner, /exec "\$@"/);
  assert.match(lockRunner, /trap 'forward_signal INT' INT/);
  assert.match(lockRunner, /trap 'forward_signal TERM' TERM/);
});

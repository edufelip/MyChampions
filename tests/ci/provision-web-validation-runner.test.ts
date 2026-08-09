import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = readFileSync('scripts/ci/provision-web-validation-runner.sh', 'utf8');
const workflow = readFileSync('.github/workflows/provision-web-validation-runner.yml', 'utf8');

test('web runner bootstrap is isolated, verified, and retryable', () => {
  assert.match(script, /actions-runner-mychampions-web-ci/);
  assert.match(script, /mychampions-web-ci-ubuntu/);
  assert.match(script, /mychampions-ci,mychampions-web-only/);
  assert.match(script, /_work-web/);
  assert.match(script, /createHash\("sha256"\)/);
  assert.match(script, /SHA-256 digest mismatch/);
  assert.match(script, /mktemp -d "\$\{runner_root\}\.bootstrap\.XXXXXX"/);
  assert.ok(script.indexOf('cd "$staging_root"') < script.indexOf('mv -t "$runner_root"'));
  assert.match(script, /nohup env \\\n\s+-u RUNNER_TRACKING_ID[\s\S]*?setsid \.\/run\.sh/);
});

test('web-only service deliberately excludes native shared-host hooks', () => {
  for (const variable of [
    'ACTIONS_RUNNER_HOOK_JOB_STARTED',
    'ACTIONS_RUNNER_HOOK_JOB_COMPLETED',
    'MYCHAMPIONS_NATIVE_STATE_ROOT',
  ]) {
    assert.match(script, new RegExp(`runner_exec=.*-u ${variable}`));
    assert.match(script, new RegExp(`-u ${variable} \\\\`));
  }
  assert.match(script, /ExecStart=\$runner_exec/);
  assert.match(script, /systemctl enable --now "\$runner_service"/);
});

test('bootstrap workflow uses the Android host and a temporary secret', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:\n    branches:\n      - main/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /ref: main/);
  assert.match(
    workflow,
    /runs-on: \[self-hosted, Linux, X64, mychampions-ci, mychampions-android\]/,
  );
  assert.match(workflow, /MYCHAMPIONS_WEB_RUNNER_REGISTRATION_TOKEN/);
  assert.doesNotMatch(workflow, /cache:/);
});

function exerciseFirstRegistration(options: {
  publishedDigest?: string;
  configExitStatus?: number;
}) {
  const temp = mkdtempSync(join(tmpdir(), 'mychampions-web-runner-'));
  try {
    const fixture = join(temp, 'fixture');
    const bin = join(temp, 'bin');
    const archive = join(temp, 'runner.tar.gz');
    const runnerRoot = join(temp, 'runner');
    mkdirSync(fixture);
    mkdirSync(bin);
    writeFileSync(
      join(fixture, 'config.sh'),
      `#!/usr/bin/env bash\nexit ${options.configExitStatus ?? 0}\n`,
    );
    chmodSync(join(fixture, 'config.sh'), 0o755);
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', fixture, 'config.sh']).status, 0);

    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    const release = JSON.stringify({
      tag_name: 'v9.9.9',
      assets: [
        {
          name: 'actions-runner-linux-x64-9.9.9.tar.gz',
          browser_download_url: 'https://example.test/runner.tar.gz',
          digest: `sha256:${options.publishedDigest ?? digest}`,
        },
      ],
    });
    const curl = join(bin, 'curl');
    writeFileSync(
      curl,
      '#!/usr/bin/env bash\nfor argument in "$@"; do url="$argument"; done\n' +
        'if [[ "$url" == *releases/latest ]]; then printf \'%s\' "$MOCK_RELEASE_JSON"; ' +
        'else /bin/cat "$MOCK_RUNNER_ARCHIVE"; fi\n',
    );
    chmodSync(curl, 0o755);
    const result = spawnSync('bash', ['scripts/ci/provision-web-validation-runner.sh'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: temp,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'example/repository',
        ACTIONS_RUNNER_REGISTRATION_TOKEN: 'temporary-token',
        MYCHAMPIONS_WEB_RUNNER_ROOT: runnerRoot,
        MOCK_RELEASE_JSON: release,
        MOCK_RUNNER_ARCHIVE: archive,
      },
    });

    return {
      result,
      runnerEntries: readdirSync(runnerRoot),
      stagingEntries: readdirSync(temp).filter((entry) => entry.startsWith('runner.bootstrap.')),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('failed first registration leaves an empty retryable runner root', () => {
  const outcome = exerciseFirstRegistration({ configExitStatus: 23 });
  assert.equal(outcome.result.status, 23, outcome.result.stderr);
  assert.deepEqual(outcome.runnerEntries, []);
  assert.deepEqual(outcome.stagingEntries, []);
});

test('runner archive digest mismatch fails before registration', () => {
  const outcome = exerciseFirstRegistration({ publishedDigest: '0'.repeat(64) });
  assert.notEqual(outcome.result.status, 0);
  assert.deepEqual(outcome.runnerEntries, []);
  assert.deepEqual(outcome.stagingEntries, []);
});

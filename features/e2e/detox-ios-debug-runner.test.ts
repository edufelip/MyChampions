import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runnerPath = join(repositoryRoot, 'scripts', 'run-detox-ios-debug.sh');
const smokeRunnerPath = join(repositoryRoot, 'scripts', 'run-detox-ios-debug-smoke.sh');
const revenueCatLiveRunnerPath = join(
  repositoryRoot,
  'scripts',
  'run-detox-revenuecat-test-store.sh',
);
const revenueCatStudentMatrixRunnerPath = join(
  repositoryRoot,
  'scripts',
  'run-detox-revenuecat-student-matrix.sh',
);

async function writeExecutable(path: string, contents: string) {
  await writeFile(path, contents, { mode: 0o755 });
}

async function runRunner({
  clearCache = false,
  metroAlreadyRunning,
  requireFreshMetro = false,
}: {
  clearCache?: boolean;
  metroAlreadyRunning: boolean;
  requireFreshMetro?: boolean;
}) {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'mychampions-detox-runner-'));
  const binDirectory = join(tempDirectory, 'bin');
  const runnerScriptsDirectory = join(tempDirectory, 'scripts');
  const runnerCopyPath = join(runnerScriptsDirectory, 'run-detox-ios-debug.sh');
  const expoBinDirectory = join(tempDirectory, 'node_modules', '.bin');
  const logPath = join(tempDirectory, 'runner.log');
  const metroStartedPath = join(tempDirectory, 'metro-started');

  await mkdir(binDirectory);
  await mkdir(runnerScriptsDirectory);
  await mkdir(expoBinDirectory, { recursive: true });
  await writeFile(runnerCopyPath, await readFile(runnerPath), { mode: 0o755 });
  await writeExecutable(
    join(binDirectory, 'yarn'),
    `#!/bin/bash
set -euo pipefail
printf 'yarn:%s\\n' "$*" >> "$DETOX_RUNNER_LOG"

if [[ "$1" == 'detox' ]]; then
  exit 0
fi

exit 1
`,
  );
  await writeExecutable(
    join(expoBinDirectory, 'expo'),
    `#!/bin/bash
set -euo pipefail
printf 'expo:%s\\n' "$*" >> "$DETOX_RUNNER_LOG"

touch "$DETOX_METRO_STARTED"
trap 'printf "%s\\n" metro-stopped >> "$DETOX_RUNNER_LOG"; exit 0' TERM INT
while true; do sleep 1; done
`,
  );
  await writeExecutable(
    join(binDirectory, 'lsof'),
    `#!/bin/bash
if [[ "\${DETOX_TEST_METRO_ALREADY_RUNNING:-}" == 'true' ]]; then
  exit 0
fi
exit 1
`,
  );
  await writeExecutable(
    join(binDirectory, 'curl'),
    `#!/bin/bash
if [[ "\${DETOX_TEST_METRO_ALREADY_RUNNING:-}" != 'true' && ! -f "$DETOX_METRO_STARTED" ]]; then
  exit 7
fi
printf '%s\\n' 'packager-status:running'
`,
  );

  try {
    await execFile('bash', [runnerCopyPath, '--headless'], {
      cwd: tempDirectory,
      env: {
        ...process.env,
        DETOX_METRO_STARTED: metroStartedPath,
        DETOX_METRO_CLEAR_CACHE: String(clearCache),
        DETOX_REQUIRE_FRESH_METRO: String(requireFreshMetro),
        DETOX_RUNNER_LOG: logPath,
        DETOX_TEST_METRO_ALREADY_RUNNING: String(metroAlreadyRunning),
        PATH: `${binDirectory}:${process.env.PATH}`,
      },
      timeout: 10_000,
    });

    return await readFile(logPath, 'utf8');
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function runRevenueCatStudentMatrixRunner(explicitCustomerIds?: string) {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'mychampions-revenuecat-student-matrix-'));
  const mobileRoot = join(tempDirectory, 'mychampions');
  const binDirectory = join(tempDirectory, 'bin');
  const runnerScriptsDirectory = join(mobileRoot, 'scripts');
  const runnerCopyPath = join(runnerScriptsDirectory, 'run-detox-revenuecat-student-matrix.sh');
  const logPath = join(tempDirectory, 'runner.log');

  await mkdir(binDirectory);
  await mkdir(runnerScriptsDirectory, { recursive: true });
  await writeFile(runnerCopyPath, await readFile(revenueCatStudentMatrixRunnerPath), {
    mode: 0o755,
  });
  await writeExecutable(
    join(binDirectory, 'bash'),
    `#!/bin/bash
set -euo pipefail
printf 'scenario=%s|uid=%s|alternate=%s|skipBuild=%s|args=%s\\n' "\${REVENUECAT_LIVE_SCENARIO:-}" "\${REVENUECAT_TEST_APP_USER_ID:-}" "\${REVENUECAT_TEST_ALT_APP_USER_ID:-}" "\${DETOX_SKIP_BUILD:-}" "$*" >> "$DETOX_RUNNER_LOG"
`,
  );

  try {
    const { stdout } = await execFile('/bin/bash', [runnerCopyPath], {
      cwd: mobileRoot,
      env: {
        ...process.env,
        DETOX_RUNNER_LOG: logPath,
        DETOX_SKIP_BUILD: 'true',
        PATH: `${binDirectory}:${process.env.PATH}`,
        REVENUECAT_LIVE_E2E: 'true',
        ...(explicitCustomerIds === undefined
          ? {}
          : { REVENUECAT_STUDENT_MATRIX_CUSTOMER_IDS: explicitCustomerIds }),
      },
      timeout: 10_000,
    });

    return {
      log: await readFile(logPath, 'utf8'),
      stdout,
    };
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function runSmokeRunner() {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'mychampions-detox-smoke-runner-'));
  const binDirectory = join(tempDirectory, 'bin');
  const runnerScriptsDirectory = join(tempDirectory, 'scripts');
  const smokeRunnerCopyPath = join(runnerScriptsDirectory, 'run-detox-ios-debug-smoke.sh');
  const logPath = join(tempDirectory, 'runner.log');

  await mkdir(binDirectory);
  await mkdir(runnerScriptsDirectory);
  await writeFile(smokeRunnerCopyPath, await readFile(smokeRunnerPath), { mode: 0o755 });
  await writeExecutable(
    join(binDirectory, 'yarn'),
    `#!/bin/bash
set -euo pipefail
printf 'yarn:%s|authSession=%s|signIn=%s|create=%s|social=%s|invite=%s|nutrition=%s|qr=%s\\n' "$*" "\${EXPO_PUBLIC_E2E_AUTH_SESSION:-}" "\${EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN:-}" "\${EXPO_PUBLIC_E2E_CREATE_ACCOUNT:-}" "\${EXPO_PUBLIC_E2E_SOCIAL_AUTH:-}" "\${EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE:-}" "\${EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE:-}" "\${EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD:-}" >> "$DETOX_RUNNER_LOG"
`,
  );
  await writeExecutable(
    join(binDirectory, 'bash'),
    `#!/bin/bash
set -euo pipefail
printf 'bash:%s|authSession=%s|signIn=%s|create=%s|social=%s|invite=%s|nutrition=%s|qr=%s|runnerSession=%s|config=%s\\n' "$*" "\${EXPO_PUBLIC_E2E_AUTH_SESSION:-}" "\${EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN:-}" "\${EXPO_PUBLIC_E2E_CREATE_ACCOUNT:-}" "\${EXPO_PUBLIC_E2E_SOCIAL_AUTH:-}" "\${EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE:-}" "\${EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE:-}" "\${EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD:-}" "\${E2E_AUTH_SESSION:-}" "\${DETOX_JEST_CONFIG:-}" >> "$DETOX_RUNNER_LOG"
`,
  );

  try {
    await execFile('/bin/bash', [smokeRunnerCopyPath], {
      cwd: tempDirectory,
      env: {
        ...process.env,
        DETOX_RUNNER_LOG: logPath,
        PATH: `${binDirectory}:${process.env.PATH}`,
      },
      timeout: 10_000,
    });

    return await readFile(logPath, 'utf8');
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function runRevenueCatLiveRunner() {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'mychampions-revenuecat-live-runner-'));
  const workspaceDirectory = join(tempDirectory, 'workspace');
  const mobileRoot = join(workspaceDirectory, 'mychampions');
  const binDirectory = join(tempDirectory, 'bin');
  const runnerScriptsDirectory = join(mobileRoot, 'scripts');
  const runnerCopyPath = join(runnerScriptsDirectory, 'run-detox-revenuecat-test-store.sh');
  const serverEvidenceDirectory = join(workspaceDirectory, 'server', 'infra', 'scripts');
  const serverEvidencePath = join(serverEvidenceDirectory, 'verify-revenuecat-live-evidence.sh');
  const logPath = join(tempDirectory, 'runner.log');

  await mkdir(binDirectory);
  await mkdir(runnerScriptsDirectory, { recursive: true });
  await mkdir(serverEvidenceDirectory, { recursive: true });
  await writeFile(runnerCopyPath, await readFile(revenueCatLiveRunnerPath), { mode: 0o755 });
  await writeFile(serverEvidencePath, '#!/bin/bash\n', { mode: 0o755 });
  await writeExecutable(
    join(binDirectory, 'yarn'),
    `#!/bin/bash
set -euo pipefail
printf 'yarn:%s|variant=%s|testStore=%s|uid=%s|proStatus=%s|aiStatus=%s|outcome=%s\\n' "$*" "\${APP_VARIANT:-}" "\${EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED:-}" "\${EXPO_PUBLIC_E2E_AUTH_UID:-}" "\${EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS:-}" "\${EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS:-}" "\${EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME:-}" >> "$DETOX_RUNNER_LOG"
`,
  );
  await writeExecutable(
    join(binDirectory, 'bash'),
    `#!/bin/bash
set -euo pipefail
printf 'bash:%s|session=%s|live=%s|monitor=%s|config=%s|uid=%s|proStatus=%s|aiStatus=%s|outcome=%s\\n' "$*" "\${E2E_AUTH_SESSION:-}" "\${REVENUECAT_LIVE_E2E:-}" "\${REVENUECAT_LIVE_MONITOR_EXPIRATION:-}" "\${DETOX_JEST_CONFIG:-}" "\${EXPO_PUBLIC_E2E_AUTH_UID:-}" "\${EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS:-}" "\${EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS:-}" "\${EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME:-}" >> "$DETOX_RUNNER_LOG"
if [[ "\${1:-}" == */verify-revenuecat-live-evidence.sh ]]; then
  printf 'evidence:uid=%s|professional=%s|ai=%s|args=%s\\n' "\${REVENUECAT_TEST_APP_USER_ID:-}" "\${EXPECTED_PROFESSIONAL_STATUS:-}" "\${EXPECTED_AI_STATUS:-}" "$*" >> "$DETOX_RUNNER_LOG"
fi
`,
  );

  try {
    const { stdout } = await execFile('/bin/bash', [runnerCopyPath], {
      cwd: mobileRoot,
      env: {
        ...process.env,
        DETOX_RUNNER_LOG: logPath,
        EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS: 'active',
        EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME: 'success',
        EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS: 'active',
        EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE: 'test_public-sdk-key',
        PATH: `${binDirectory}:${process.env.PATH}`,
        REVENUECAT_LIVE_E2E: 'true',
        REVENUECAT_LIVE_MONITOR_EXPIRATION: 'true',
        REVENUECAT_TEST_APP_USER_ID: 'rc-live-runner-test',
        REVENUECAT_VERIFY_SERVER_EVIDENCE: 'true',
      },
      timeout: 10_000,
    });

    return {
      log: await readFile(logPath, 'utf8'),
      stdout,
    };
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

test('starts and stops the Metro process it owns before running Detox', async () => {
  const log = await runRunner({ metroAlreadyRunning: false });

  assert.match(log, /^expo:start --dev-client --localhost --port 8081$/m);
  assert.match(log, /^yarn:detox test -c ios\.sim\.debug --headless$/m);
  assert.match(log, /^metro-stopped$/m);
});

test('reuses an existing Metro process without stopping it', async () => {
  const log = await runRunner({ metroAlreadyRunning: true });

  assert.doesNotMatch(log, /^expo:start /m);
  assert.match(log, /^yarn:detox test -c ios\.sim\.debug --headless$/m);
  assert.doesNotMatch(log, /^metro-stopped$/m);
});

test('fails closed instead of reusing Metro when the caller requires fresh ownership', async () => {
  await assert.rejects(
    runRunner({ metroAlreadyRunning: true, requireFreshMetro: true }),
    /requires a freshly owned Metro process/,
  );
});

test('clears Metro transforms when a scenario changes compile-time Expo environment values', async () => {
  const log = await runRunner({ clearCache: true, metroAlreadyRunning: false });

  assert.match(log, /^expo:start --dev-client --localhost --port 8081 --clear$/m);
  assert.match(log, /^yarn:detox test -c ios\.sim\.debug --headless$/m);
});

test('routes public iOS debug Detox commands through the Metro runner', async () => {
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts['test:e2e:ios:debug'], 'bash scripts/run-detox-ios-debug.sh');
  assert.equal(
    packageJson.scripts['test:e2e:ios:debug:smoke'],
    'bash scripts/run-detox-ios-debug-smoke.sh',
  );
  assert.equal(
    packageJson.scripts['test:e2e:ios:debug:revenuecat-live'],
    'bash scripts/run-detox-revenuecat-test-store.sh',
  );
});

test('requires explicit live opt-in before RevenueCat Test Store execution', async () => {
  await assert.rejects(
    execFile('/bin/bash', [revenueCatLiveRunnerPath], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        REVENUECAT_LIVE_E2E: 'false',
      },
      timeout: 10_000,
    }),
    /REVENUECAT_LIVE_E2E=true/,
  );
});

test('rejects non-Test-Store RevenueCat SDK keys before build or provider access', async () => {
  await assert.rejects(
    execFile('/bin/bash', [revenueCatLiveRunnerPath], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE: 'appl_not-a-test-key',
        REVENUECAT_LIVE_E2E: 'true',
      },
      timeout: 10_000,
    }),
    /must contain a RevenueCat test_\* SDK key/,
  );
});

test('rejects a live RevenueCat alternate identity that matches the primary customer', async () => {
  await assert.rejects(
    execFile('/bin/bash', [revenueCatLiveRunnerPath], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE: 'test_public-sdk-key',
        REVENUECAT_LIVE_E2E: 'true',
        REVENUECAT_TEST_ALT_APP_USER_ID: 'same-live-customer',
        REVENUECAT_TEST_APP_USER_ID: 'same-live-customer',
      },
      timeout: 10_000,
    }),
    /must differ from REVENUECAT_TEST_APP_USER_ID/,
  );
});

test('keeps live RevenueCat runs dev-only, identity-isolated, and free of entitlement fixtures', async () => {
  const runner = await readFile(revenueCatLiveRunnerPath, 'utf8');
  const liveConfig = await readFile(
    join(repositoryRoot, 'e2e', 'jest.revenuecat-live.config.js'),
    'utf8',
  );
  const liveSpec = await readFile(
    join(repositoryRoot, 'e2e', 'revenuecat-test-store.e2e.test.js'),
    'utf8',
  );

  assert.match(runner, /export APP_VARIANT=dev/);
  assert.match(runner, /export EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED=true/);
  assert.match(runner, /export EXPO_PUBLIC_E2E_AUTH_UID="\$run_uid"/);
  assert.match(runner, /export DETOX_REQUIRE_FRESH_METRO=true/);
  assert.match(runner, /unset EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS/);
  assert.match(runner, /unset EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS/);
  assert.match(runner, /unset EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME/);
  assert.match(runner, /DETOX_JEST_CONFIG=e2e\/jest\.revenuecat-live\.config\.js/);
  assert.match(runner, /REVENUECAT_VERIFY_SERVER_EVIDENCE/);
  assert.match(runner, /verify-revenuecat-live-evidence\.sh/);
  assert.match(runner, /REVENUECAT_TEST_APP_USER_ID="\$\{run_uid\}-created"/);
  assert.match(liveConfig, /revenuecat-test-store\.e2e\.test\.js/);
  assert.match(liveSpec, /Test valid purchase/);
  assert.match(liveSpec, /Test failed purchase/);
  assert.match(liveSpec, /does not leak professional privileges across account switches/);
  assert.match(liveSpec, /does not let the student privilege unlock professional capabilities/);
});

test('derives a fresh isolated customer set for each default live student matrix run', async () => {
  const { log, stdout } = await runRevenueCatStudentMatrixRunner();
  const secondRun = await runRevenueCatStudentMatrixRunner();
  const runLines = log.trim().split('\n');
  const customerIds = runLines.map((line) => line.match(/\|uid=([^|]+)\|/)?.[1] ?? '');
  const alternateIds = runLines.map((line) => line.match(/\|alternate=([^|]+)\|/)?.[1] ?? '');
  const secondRunCustomerIds = secondRun.log
    .trim()
    .split('\n')
    .map((line) => line.match(/\|uid=([^|]+)\|/)?.[1] ?? '');

  assert.equal(runLines.length, 9);
  assert.equal(new Set(customerIds).size, 9);
  assert.equal(new Set([...customerIds, ...alternateIds]).size, 18);
  assert.equal(new Set([...customerIds, ...secondRunCustomerIds]).size, 18);
  assert.equal(
    customerIds.every((customerId) =>
      /^rc-student-v1-\d{14}-\d+-\d+-(dismiss|cancel|fail|duplicate|monthly|annual|restore|switch|pro-route)$/.test(
        customerId,
      ),
    ),
    true,
  );
  assert.equal(
    customerIds.some((customerId) => customerId === 'rc-student-v1-monthly'),
    false,
  );
  assert.doesNotMatch(stdout, /REVENUECAT_STUDENT_MATRIX_CUSTOMER_IDS/);
});

test('accepts an explicit strictly validated isolated customer set for the live student matrix', async () => {
  const customerIds = Array.from(
    { length: 9 },
    (_, index) => `review-isolated-20260724-${index + 1}`,
  );
  const { log } = await runRevenueCatStudentMatrixRunner(customerIds.join(','));

  for (const customerId of customerIds) {
    assert.match(log, new RegExp(`\\|uid=${customerId}\\|`));
  }
});

test('rejects duplicate or malformed explicit student matrix customer IDs', async () => {
  await assert.rejects(
    runRevenueCatStudentMatrixRunner('isolated-1,isolated-2'),
    /must contain exactly 9 comma-separated customer IDs/,
  );

  const duplicateIds = Array.from(
    { length: 9 },
    (_, index) => `review-isolated-20260724-${Math.max(index, 1)}`,
  );
  await assert.rejects(
    runRevenueCatStudentMatrixRunner(duplicateIds.join(',')),
    /must contain distinct customer IDs/,
  );

  const malformedIds = Array.from({ length: 9 }, (_, index) =>
    index === 4 ? 'invalid customer' : `review-isolated-20260724-${index + 1}`,
  );
  await assert.rejects(
    runRevenueCatStudentMatrixRunner(malformedIds.join(',')),
    /must contain 1-88 safe RevenueCat ID characters/,
  );
});

test('executes the live RevenueCat runner with a fixed isolated identity and no fixture privileges', async () => {
  const { log, stdout } = await runRevenueCatLiveRunner();

  assert.match(stdout, /RevenueCat Test Store App User ID: rc-live-runner-test/);
  assert.doesNotMatch(stdout, /test_public-sdk-key/);
  assert.match(
    log,
    /^yarn:test:e2e:build:ios:debug\|variant=dev\|testStore=true\|uid=rc-live-runner-test\|proStatus=\|aiStatus=\|outcome=$/m,
  );
  assert.match(
    log,
    /^bash:scripts\/run-detox-ios-debug\.sh --headless e2e\/revenuecat-test-store\.e2e\.test\.js\|session=true\|live=true\|monitor=true\|config=e2e\/jest\.revenuecat-live\.config\.js\|uid=rc-live-runner-test\|proStatus=\|aiStatus=\|outcome=$/m,
  );
  assert.match(
    log,
    /^evidence:uid=rc-live-runner-test\|professional=lapsed\|ai=lapsed\|args=.*verify-revenuecat-live-evidence\.sh --verify$/m,
  );
  assert.match(
    log,
    /^evidence:uid=rc-live-runner-test-created\|professional=lapsed\|ai=lapsed\|args=.*verify-revenuecat-live-evidence\.sh --verify$/m,
  );
});

test('runs auth-entry and authenticated smoke modes with incompatible E2E state isolated', async () => {
  const log = await runSmokeRunner();

  assert.match(
    log,
    /^yarn:test:e2e:build:ios:debug\|authSession=\|signIn=true\|create=true\|social=true\|invite=\|nutrition=\|qr=$/m,
  );
  assert.match(
    log,
    /^bash:scripts\/run-detox-ios-debug\.sh --headless\|authSession=\|signIn=true\|create=true\|social=true\|invite=\|nutrition=\|qr=\|runnerSession=\|config=e2e\/jest\.auth-entry\.config\.js$/m,
  );
  assert.match(
    log,
    /^yarn:test:e2e:build:ios:debug\|authSession=true\|signIn=\|create=\|social=\|invite=success\|nutrition=assigned\|qr=NUT123$/m,
  );
  assert.match(
    log,
    /^bash:scripts\/run-detox-ios-debug\.sh --headless\|authSession=true\|signIn=\|create=\|social=\|invite=success\|nutrition=assigned\|qr=NUT123\|runnerSession=true\|config=e2e\/jest\.authenticated\.config\.js$/m,
  );
});

test('keeps auth-entry and authenticated smoke specs separate', async () => {
  const authEntryConfig = await readFile(
    join(repositoryRoot, 'e2e', 'jest.auth-entry.config.js'),
    'utf8',
  );
  const authenticatedConfig = await readFile(
    join(repositoryRoot, 'e2e', 'jest.authenticated.config.js'),
    'utf8',
  );

  assert.match(authEntryConfig, /auth-sign-in\.e2e\.test\.js/);
  assert.doesNotMatch(authEntryConfig, /auth-role-selection\.e2e\.test\.js/);
  assert.match(authenticatedConfig, /auth-role-selection\.e2e\.test\.js/);
  assert.match(authenticatedConfig, /student-professionals\.e2e\.test\.js/);
  assert.doesNotMatch(authenticatedConfig, /auth-sign-in\.e2e\.test\.js/);
});

test('delegates CI smoke fixture setup to the split-mode orchestrator', async () => {
  const workflow = await readFile(
    join(repositoryRoot, '.github', 'workflows', 'ios-pr.yml'),
    'utf8',
  );

  assert.match(workflow, /run: yarn test:e2e:ios:debug:smoke/);
  assert.doesNotMatch(workflow, /EXPO_PUBLIC_E2E_AUTH_SESSION/);
});

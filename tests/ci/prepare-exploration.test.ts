import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EXPLORATION_LOCALES,
  EXPLORATION_MAX_DURATION_MINUTES,
  EXPLORATION_MAX_UI_ACTIONS,
  EXPLORATION_UNCHANGED_FAILURE_LIMIT,
  loadExplorationCharters,
  parsePrepareExplorationArguments,
  prepareExploration,
  type ExplorationCharter,
  type ExplorationContext,
} from '../../scripts/testing/prepare-exploration';

const repositoryRoot = path.resolve(__dirname, '../..');

function privateEvidencePath(root: string, name = 'context.private.json'): string {
  return path.relative(repositoryRoot, path.join(root, 'evidence', name));
}

async function temporaryRoot(): Promise<string> {
  return mkdtemp(path.join(repositoryRoot, '.qa/artifacts/prepare-exploration-test-'));
}

function contextFor(
  charter: ExplorationCharter,
  platform: 'ios' | 'android' | 'web',
  locale: (typeof EXPLORATION_LOCALES)[number],
  evidencePath: string,
): ExplorationContext {
  const connector = charter.connectorsByPlatform[platform];
  assert(connector);
  const evidencePaths = [evidencePath];
  return {
    schemaVersion: 1,
    platform,
    locale,
    target: {
      status: 'available',
      id: `${platform}-owned-target`,
      evidencePaths,
      platform,
      selector: `${platform}-owned-target`,
      appIdOrOrigin: platform === 'web' ? 'http://127.0.0.1:43100' : 'com.edufelip.mychampions.dev',
      apiOrigin: 'http://127.0.0.1:43101',
    },
    build: {
      status: 'available',
      id: 'owned-build-1',
      evidencePaths,
      binarySha256: 'a'.repeat(64),
    },
    connector: {
      status: 'available',
      id: 'owned-connector-1',
      evidencePaths,
      name: connector,
      version: connector === 'maestro' ? '2.6.1' : '1.61.1',
    },
    roles: charter.roles.map((id) => ({ status: 'available', id, evidencePaths })),
    fixture: {
      status: 'available',
      id: charter.fixture.id,
      evidencePaths,
      mode: charter.dataMode,
    },
    reset: {
      status: 'available',
      strategy: charter.fixture.resetStrategy,
      verified: true,
      evidencePaths,
    },
  };
}

async function writeContext(root: string, context: ExplorationContext): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const evidencePaths = new Set(
    [
      context.target,
      context.build,
      context.connector,
      ...context.roles,
      context.fixture,
      context.reset,
    ].flatMap((resource) => (resource.status === 'available' ? resource.evidencePaths : [])),
  );
  for (const evidencePath of evidencePaths) {
    const evidenceFile = path.resolve(repositoryRoot, evidencePath);
    assert.ok(evidenceFile.startsWith(`${path.resolve(root)}${path.sep}`));
    await mkdir(path.dirname(evidenceFile), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(evidenceFile), 0o700);
    await writeFile(evidenceFile, '{"kind":"private-test-evidence"}\n', { mode: 0o600 });
    await chmod(evidenceFile, 0o600);
  }
  const file = path.join(root, 'context.json');
  await writeFile(file, JSON.stringify(context, null, 2) + '\n', { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

void test('charter registry contains the five bounded exploration definitions with all locale paths', async () => {
  const charters = await loadExplorationCharters(repositoryRoot);
  assert.equal(charters.length, 5);
  assert.deepEqual(
    charters.map((charter) => charter.id).sort(),
    [
      'EXP-COMPACT-KEYBOARD-SCROLL',
      'EXP-INTERRUPTED-DRAFT-RELAUNCH',
      'EXP-PERMISSION-FALLBACK',
      'EXP-TWO-ROLE-CONSISTENCY',
      'EXP-VALIDATION-SAVE-RECOVERY',
    ].sort(),
  );
  for (const charter of charters) {
    assert.deepEqual(charter.locales, [...EXPLORATION_LOCALES]);
    assert.equal(charter.budget.maxDurationMinutes, EXPLORATION_MAX_DURATION_MINUTES);
    assert.equal(charter.budget.maxUiActions, EXPLORATION_MAX_UI_ACTIONS);
    assert.equal(charter.budget.unchangedFailureLimit, EXPLORATION_UNCHANGED_FAILURE_LIMIT);
    assert.ok(charter.allowedActions.length >= 4);
    assert.ok(charter.excludedExternalEffects.length >= 3);
    assert.equal(charter.artifactPolicy.directoryMode, '0700');
    assert.equal(charter.artifactPolicy.fileMode, '0600');
    assert.equal(charter.artifactPolicy.rawEvidence, 'private-only');
    assert.equal(charter.artifactPolicy.publicSummary, 'redacted-status-only');
    assert.ok(charter.requirementPaths.length > 0);
    assert.ok(charter.scenario.sourceRefs.every((ref) => charter.requirementRefs.includes(ref)));
  }
});

void test('preparation argument parsing requires explicit platform, locale and charter and rejects arbitrary runner options', () => {
  assert.deepEqual(
    parsePrepareExplorationArguments([
      '--locale=en-US',
      '--platform',
      'ios',
      '--charter',
      'EXP-COMPACT-KEYBOARD-SCROLL',
    ]),
    { charter: 'EXP-COMPACT-KEYBOARD-SCROLL', platform: 'ios', locale: 'en-US' },
  );
  assert.deepEqual(
    parsePrepareExplorationArguments([
      '--charter=EXP-PERMISSION-FALLBACK',
      '--platform=web',
      '--locale=pt-BR',
      '--context=ctx.json',
      '--artifact-root=.qa/artifacts/run',
    ]),
    {
      charter: 'EXP-PERMISSION-FALLBACK',
      platform: 'web',
      locale: 'pt-BR',
      contextPath: 'ctx.json',
      artifactRoot: '.qa/artifacts/run',
    },
  );
  for (const argv of [
    [],
    ['--charter=EXP-COMPACT-KEYBOARD-SCROLL', '--platform=ios'],
    ['--charter=EXP-COMPACT-KEYBOARD-SCROLL', '--platform=ios', '--locale=fr-FR'],
    ['--charter=EXP-COMPACT-KEYBOARD-SCROLL', '--platform=ios', '--locale=en-US', '--unknown=x'],
    [
      '--charter=EXP-COMPACT-KEYBOARD-SCROLL',
      '--platform=ios',
      '--locale=en-US',
      '--platform=android',
    ],
    ['--charter=../secret', '--platform=ios', '--locale=en-US'],
    ['--charter=EXP-COMPACT-KEYBOARD-SCROLL', '--platform=ios', '--locale=en-US', '--context'],
  ])
    assert.throws(() => parsePrepareExplorationArguments(argv));
});

void test('missing target/build/connector context produces a private blocked preparation with no observations or fake pass', async () => {
  const root = await temporaryRoot();
  try {
    const artifactRoot = path.join(root, 'missing-context-run');
    const result = await prepareExploration(
      {
        charter: 'EXP-COMPACT-KEYBOARD-SCROLL',
        platform: 'ios',
        locale: 'en-US',
        artifactRoot,
      },
      { repositoryRoot, now: new Date('2026-09-30T19:00:00.000Z') },
    );
    assert.equal(result.status, 'blocked');
    assert.equal(result.explorationStatus, 'not-run');
    assert(result.blockedReasons.some((reason) => reason.startsWith('PREREQUISITE_UNKNOWN')));
    const coverage = JSON.parse(
      await readFile(path.join(artifactRoot, 'coverage.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(coverage.gitSha, null);
    assert.deepEqual(coverage.attempts, []);
    assert.deepEqual(coverage.observations, []);
    assert.deepEqual(coverage.evidencePaths, []);
    const scenario = (coverage.scenarios as Record<string, unknown>[])[0];
    assert.equal(scenario.status, 'blocked');
    assert.equal(scenario.blocker, 'PREPARATION_ONLY');
    const preparation = JSON.parse(
      await readFile(path.join(artifactRoot, 'preparation.private.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(preparation.explorationStatus, 'not-run');
    assert.equal(JSON.stringify(preparation).includes('do-not-store'), false);
    assert.deepEqual(preparation.observations, []);
    assert.deepEqual(preparation.attempts, []);
    assert.match(
      await readFile(path.join(artifactRoot, 'exploration.md'), 'utf8'),
      /PREPARATION_ONLY/,
    );
    const rootMode = (await stat(artifactRoot)).mode & 0o777;
    const fileMode = (await stat(path.join(artifactRoot, 'coverage.json'))).mode & 0o777;
    assert.equal(rootMode, 0o700);
    assert.equal(fileMode, 0o600);
    assert.deepEqual((await readdir(path.join(artifactRoot, 'evidence'))).sort(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('an independently supplied available context prepares only a redacted, not-run artifact', async () => {
  const root = await temporaryRoot();
  try {
    const charters = await loadExplorationCharters(repositoryRoot);
    const charter = charters.find((row) => row.id === 'EXP-TWO-ROLE-CONSISTENCY');
    assert(charter);
    const contextRoot = path.join(root, 'context-input');
    await mkdir(contextRoot, { recursive: true, mode: 0o700 });
    const context = contextFor(
      charter,
      'web',
      'pt-BR',
      privateEvidencePath(contextRoot, 'available.private.json'),
    );
    const contextPath = await writeContext(contextRoot, context);
    const artifactRoot = path.join(root, 'available-context-run');
    const result = await prepareExploration(
      {
        charter: charter.id,
        platform: 'web',
        locale: 'pt-BR',
        contextPath,
        artifactRoot,
      },
      { repositoryRoot, now: new Date('2026-09-30T19:01:00.000Z') },
    );
    assert.equal(result.status, 'prepared');
    assert.deepEqual(result.runtimeRequalificationRequired, [
      'target',
      'build',
      'tool',
      'locale',
      'roles',
      'fixture',
      'reset',
    ]);
    assert.deepEqual(result.blockedReasons, [
      'PREPARATION_ONLY: no native, browser, backend or connector action was executed',
    ]);
    const coverage = JSON.parse(
      await readFile(path.join(artifactRoot, 'coverage.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(coverage.target, {
      schemaVersion: 1,
      platform: 'web',
      locale: 'pt-BR',
      targetStatus: 'available',
      buildStatus: 'available',
      connectorStatus: 'available',
      roleStatuses: ['available', 'available'],
      fixtureStatus: 'available',
      resetStatus: 'available',
      resetVerified: true,
    });
    assert.deepEqual(coverage.attempts, []);
    assert.equal(
      coverage.budgetEnforcement,
      'declaration-only: T16-B must enforce wall-clock and actual UI-action counters',
    );
    assert.deepEqual(coverage.runtimeRequalification, {
      status: 'pending-independent-requalification',
      resources: ['target', 'build', 'tool', 'locale', 'roles', 'fixture', 'reset'],
    });
    assert.match(String(coverage.roleSessionProof), /pending/);
    assert.equal((coverage.scenarios as Record<string, unknown>[])[0].status, 'blocked');
    const privatePreparation = await readFile(
      path.join(artifactRoot, 'preparation.private.json'),
      'utf8',
    );
    assert(privatePreparation.includes('owned-connector-1'));
    assert(privatePreparation.includes('127.0.0.1:43101'));
    assert.equal(privatePreparation.includes('do-not-store'), false);
    assert(privatePreparation.includes('declaration-only'));
    assert(privatePreparation.includes('authenticated role identity'));
    assert.equal(
      (await stat(path.join(artifactRoot, 'preparation.private.json'))).mode & 0o777,
      0o600,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('explicitly unavailable prerequisites remain blocked and never become an exploration result', async () => {
  const root = await temporaryRoot();
  try {
    const charters = await loadExplorationCharters(repositoryRoot);
    const charter = charters.find((row) => row.id === 'EXP-PERMISSION-FALLBACK');
    assert(charter);
    const contextRoot = path.join(root, 'context-input');
    await mkdir(contextRoot, { recursive: true, mode: 0o700 });
    const context = contextFor(
      charter,
      'android',
      'en-US',
      privateEvidencePath(contextRoot, 'unavailable.private.json'),
    );
    context.target.status = 'unavailable';
    context.target.id = null;
    context.target.evidencePaths = [];
    context.target.selector = null;
    context.target.appIdOrOrigin = null;
    context.target.apiOrigin = null;
    context.build.status = 'unavailable';
    context.build.id = null;
    context.build.evidencePaths = [];
    context.build.binarySha256 = null;
    context.connector.status = 'unavailable';
    context.connector.id = null;
    context.connector.evidencePaths = [];
    context.connector.version = null;
    for (const role of context.roles) {
      role.status = 'unavailable';
      role.evidencePaths = [];
    }
    context.fixture.status = 'unavailable';
    context.fixture.id = null;
    context.fixture.evidencePaths = [];
    context.reset.status = 'unavailable';
    context.reset.verified = false;
    context.reset.evidencePaths = [];
    const contextPath = await writeContext(contextRoot, context);
    const result = await prepareExploration(
      {
        charter: charter.id,
        platform: 'android',
        locale: 'en-US',
        contextPath,
        artifactRoot: path.join(root, 'unavailable-run'),
      },
      { repositoryRoot },
    );
    assert.equal(result.status, 'blocked');
    assert(result.blockedReasons.some((reason) => reason.startsWith('PREREQUISITE_UNAVAILABLE')));
    assert.equal(result.explorationStatus, 'not-run');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('supplied context and evidence require private ownership and integration origins stay loopback-only', async () => {
  const root = await temporaryRoot();
  try {
    const charters = await loadExplorationCharters(repositoryRoot);
    const charter = charters.find((row) => row.id === 'EXP-COMPACT-KEYBOARD-SCROLL');
    assert(charter);
    const contextRoot = path.join(root, 'context-input');
    const evidencePath = privateEvidencePath(contextRoot, 'privacy.private.json');
    const context = contextFor(charter, 'android', 'en-US', evidencePath);
    const contextPath = await writeContext(contextRoot, context);
    const evidenceFile = path.resolve(repositoryRoot, evidencePath);
    const artifactRoot = path.join(root, 'privacy-run');

    await chmod(contextPath, 0o644);
    await assert.rejects(
      prepareExploration(
        {
          charter: charter.id,
          platform: 'android',
          locale: 'en-US',
          contextPath,
          artifactRoot,
        },
        { repositoryRoot },
      ),
      /Exploration context must have mode 0600/,
    );
    await chmod(contextPath, 0o600);

    await chmod(evidenceFile, 0o644);
    await assert.rejects(
      prepareExploration(
        {
          charter: charter.id,
          platform: 'android',
          locale: 'en-US',
          contextPath,
          artifactRoot,
        },
        { repositoryRoot },
      ),
      /Context evidence must have mode 0600/,
    );
    await chmod(evidenceFile, 0o600);

    await chmod(path.dirname(evidenceFile), 0o755);
    await assert.rejects(
      prepareExploration(
        {
          charter: charter.id,
          platform: 'android',
          locale: 'en-US',
          contextPath,
          artifactRoot,
        },
        { repositoryRoot },
      ),
      /Context evidence immediate parent must be an owned private directory with mode 0700/,
    );
    await chmod(path.dirname(evidenceFile), 0o700);

    context.target.apiOrigin = 'https://production.example';
    await writeContext(contextRoot, context);
    await assert.rejects(
      prepareExploration(
        {
          charter: charter.id,
          platform: 'android',
          locale: 'en-US',
          contextPath,
          artifactRoot,
        },
        { repositoryRoot },
      ),
      /target\.apiOrigin must use a loopback origin for local integration preparation/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('context secrets, wrong connector, and unsafe artifact roots fail before an artifact can claim readiness', async () => {
  const root = await temporaryRoot();
  try {
    const charters = await loadExplorationCharters(repositoryRoot);
    const charter = charters.find((row) => row.id === 'EXP-COMPACT-KEYBOARD-SCROLL');
    assert(charter);
    const contextRoot = path.join(root, 'context-input');
    await mkdir(contextRoot, { recursive: true, mode: 0o700 });
    const badSecretPath = path.join(contextRoot, 'secret.json');
    await writeFile(badSecretPath, JSON.stringify({ schemaVersion: 1, password: 'do-not-store' }), {
      mode: 0o600,
    });
    await assert.rejects(
      prepareExploration(
        {
          charter: charter.id,
          platform: 'ios',
          locale: 'es-ES',
          contextPath: badSecretPath,
          artifactRoot: path.join(root, 'secret-run'),
        },
        { repositoryRoot },
      ),
      /unknown field password/,
    );
    const wrongConnector = contextFor(
      charter,
      'ios',
      'es-ES',
      privateEvidencePath(contextRoot, 'wrong-connector.private.json'),
    );
    wrongConnector.connector.name = 'playwright';
    const wrongConnectorPath = await writeContext(contextRoot, wrongConnector);
    await assert.rejects(
      prepareExploration(
        {
          charter: charter.id,
          platform: 'ios',
          locale: 'es-ES',
          contextPath: wrongConnectorPath,
          artifactRoot: path.join(root, 'wrong-connector-run'),
        },
        { repositoryRoot },
      ),
      /connector does not match/,
    );
    await assert.rejects(
      prepareExploration(
        { charter: charter.id, platform: 'ios', locale: 'es-ES', artifactRoot: os.tmpdir() },
        { repositoryRoot },
      ),
      /must remain within \.qa\/artifacts/,
    );
  } finally {
    await chmod(root, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

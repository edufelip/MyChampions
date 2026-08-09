import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');
const artifactBase = join(root, '.artifacts', 'web-e2e', 'complete-flow-atlas-verified');
const helperUrl = new URL('../../scripts/flow-atlas-artifacts.mjs', import.meta.url).href;

function prepareWithNode(artifactRoot: string) {
  const source = [
    `import { prepareFlowAtlasArtifactRoot, resolveFlowAtlasArtifactRoot } from ${JSON.stringify(helperUrl)};`,
    'const artifactRoot = resolveFlowAtlasArtifactRoot();',
    'await prepareFlowAtlasArtifactRoot(artifactRoot);',
  ].join('\n');

  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root,
    env: { ...process.env, WEB_E2E_ARTIFACT_ROOT: artifactRoot },
    encoding: 'utf8',
  });
}

test('flow-atlas preparation removes stale evidence only from the exact per-run root', () => {
  const contractRoot = join(artifactBase, `contract-${process.pid}`);
  const runRoot = join(contractRoot, 'current-run');
  const siblingRoot = join(contractRoot, 'previous-run');
  const staleScreenshot = join(runRoot, 'screenshots', 'stale.png');
  const previousEvidence = join(siblingRoot, 'screenshots', 'keep.png');

  rmSync(contractRoot, { recursive: true, force: true });
  mkdirSync(join(runRoot, 'screenshots'), { recursive: true });
  mkdirSync(join(siblingRoot, 'screenshots'), { recursive: true });
  writeFileSync(staleScreenshot, 'stale');
  writeFileSync(previousEvidence, 'previous');

  try {
    const result = prepareWithNode(runRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(runRoot), true);
    assert.equal(existsSync(staleScreenshot), false);
    assert.equal(readFileSync(previousEvidence, 'utf8'), 'previous');
  } finally {
    rmSync(contractRoot, { recursive: true, force: true });
  }
});

test('flow-atlas preparation rejects broad or out-of-scope cleanup targets', () => {
  const sentinel = join(root, `.flow-atlas-cleanup-sentinel-${process.pid}`);
  writeFileSync(sentinel, 'preserve');

  try {
    for (const unsafeRoot of [root, artifactBase, join(root, '.artifacts', 'other-suite')]) {
      const result = prepareWithNode(unsafeRoot);
      assert.notEqual(result.status, 0, `unsafe root was accepted: ${unsafeRoot}`);
      assert.match(result.stderr, /must be a per-run directory/);
      assert.equal(readFileSync(sentinel, 'utf8'), 'preserve');
    }
  } finally {
    rmSync(sentinel, { force: true });
  }
});

test('standalone verifier rejects an ambiguous artifact root', () => {
  const env = { ...process.env };
  delete env.WEB_E2E_ARTIFACT_ROOT;

  const result = spawnSync(process.execPath, ['scripts/verify-flow-atlas.mjs'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WEB_E2E_ARTIFACT_ROOT is required/);
});

test('package flow-atlas command uses the fail-closed isolated runner', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const runner = readFileSync(join(root, 'scripts', 'run-flow-atlas.mjs'), 'utf8');
  const verifier = readFileSync(join(root, 'scripts', 'verify-flow-atlas.mjs'), 'utf8');

  assert.equal(packageJson.scripts?.['test:e2e:web:flow-atlas'], 'node scripts/run-flow-atlas.mjs');
  assert.match(runner, /await prepareFlowAtlasArtifactRoot\(artifactRoot\);/);
  assert.ok(
    runner.indexOf('await prepareFlowAtlasArtifactRoot(artifactRoot);') <
      runner.indexOf('playwright.flows-auth.config.ts'),
  );
  assert.ok(
    runner.indexOf('playwright.flows-auth.config.ts') <
      runner.indexOf('playwright.flows.config.ts'),
  );
  assert.ok(runner.indexOf('playwright.flows.config.ts') < runner.indexOf('verify-flow-atlas.mjs'));
  assert.doesNotMatch(runner, /shell:\s*true/);
  assert.match(verifier, /if \(!process\.env\.WEB_E2E_ARTIFACT_ROOT\)/);
  assert.match(verifier, /const artifactRoot = resolveFlowAtlasArtifactRoot\(\);/);
});

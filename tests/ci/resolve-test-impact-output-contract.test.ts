import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TestImpactManifest } from '../../scripts/ci/test-impact';

function findRepoRoot(startDirectory: string): string {
  let current = resolve(startDirectory);
  while (true) {
    if (
      existsSync(join(current, 'scripts', 'ci', 'resolve-test-impact.ts')) &&
      existsSync(join(current, 'config', 'test-impact.json'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`repository root not found from ${startDirectory}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(repoRoot, 'config', 'test-impact.json');
const baselineResolver =
  process.env.T18_BASELINE_RESOLVER ?? join(repoRoot, 'scripts', 'ci', 'resolve-test-impact.ts');
const defaultCandidateResolver = join(
  repoRoot,
  'candidate',
  'scripts',
  'ci',
  'resolve-test-impact.ts',
);
const candidateResolver =
  process.env.T18_CANDIDATE_RESOLVER ??
  (existsSync(defaultCandidateResolver) ? defaultCandidateResolver : baselineResolver);
const sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as TestImpactManifest;
const integrationSuites = Object.values(sourceManifest.suites).filter(
  (suite) => suite.runner === 'playwright-integration',
);
assert.equal(integrationSuites.length, 5);
assert.ok(integrationSuites.every((suite) => suite.ci === false));
const runBeforeAfter =
  process.env.T18_BASELINE_RESOLVER !== undefined &&
  process.env.T18_CANDIDATE_RESOLVER !== undefined;
const tsxLoader = createRequire(import.meta.url).resolve('tsx');

function readGithubOutput(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').trimEnd().split('\n')) {
    const separator = line.indexOf('=');
    assert.ok(separator > 0, `malformed GITHUB_OUTPUT line: ${line}`);
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function runOutputContract(
  resolverPath: string,
  suiteIds: string[],
  extraArguments: string[] = [],
): Record<string, string> {
  const tempRoot = mkdtempSync(join(repoRoot, '.tmp-t18-impact-output-'));
  const outputPath = join(tempRoot, 'github-output.txt');
  try {
    const tempScripts = join(tempRoot, 'scripts', 'ci');
    mkdirSync(tempScripts, { recursive: true });
    mkdirSync(join(tempRoot, 'config'), { recursive: true });
    copyFileSync(resolverPath, join(tempScripts, 'resolve-test-impact.ts'));
    copyFileSync(
      join(dirname(resolverPath), 'test-impact.ts'),
      join(tempScripts, 'test-impact.ts'),
    );

    const fixture = JSON.parse(JSON.stringify(sourceManifest)) as TestImpactManifest;
    fixture.criticalSuites = [];
    fixture.documentationPaths = [];
    fixture.runtimePaths = [];
    fixture.fullFallbackPaths = [];
    fixture.sharedRules = [];
    fixture.features = {};
    fixture.allowedDependencyCycles = [];
    fixture.maxChangedFiles = 100;
    fixture.suites = Object.fromEntries(
      suiteIds.map((suiteId) => {
        const suite = sourceManifest.suites[suiteId];
        assert.ok(suite, `fixture suite must exist in the actual manifest: ${suiteId}`);
        return [suiteId, { ...suite, ci: true }];
      }),
    );
    writeFileSync(join(tempRoot, 'config', 'test-impact.json'), `${JSON.stringify(fixture)}\n`);

    const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: outputPath };
    delete env.GITHUB_STEP_SUMMARY;
    execFileSync(
      process.execPath,
      [
        '--import',
        tsxLoader,
        join(tempScripts, 'resolve-test-impact.ts'),
        '--all',
        ...extraArguments,
      ],
      { cwd: tempRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return readGithubOutput(outputPath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertWebOutput(
  output: Record<string, string>,
  expectedHasWebServer: boolean,
  expectedSuites: string[],
): void {
  assert.equal(output.has_web, expectedSuites.length > 0 ? 'true' : 'false');
  assert.equal(output.has_web_server, String(expectedHasWebServer));
  assert.deepEqual(JSON.parse(output.web_suites), expectedSuites);
  assert.deepEqual(JSON.parse(output.web_matrix), {
    include: expectedSuites.map((suite) => ({ suite })),
  });
}

const cases = [
  { name: 'server', suites: ['web:server-auth'], before: true, after: true },
  { name: 'integration', suites: ['web:integration-auth'], before: false, after: true },
  { name: 'browser-only', suites: ['web:auth'], before: false, after: false },
  { name: 'native-only', suites: ['detox:auth'], before: false, after: false },
  {
    name: 'browser-and-integration',
    suites: ['web:auth', 'web:integration-auth'],
    before: false,
    after: true,
  },
] as const;

for (const testCase of cases) {
  void test(`emits the backend gate for ${testCase.name}`, () => {
    const after = runOutputContract(candidateResolver, [...testCase.suites]);
    assertWebOutput(
      after,
      testCase.after,
      [...testCase.suites].filter((suite) => suite.startsWith('web:')),
    );

    if (runBeforeAfter) {
      const before = runOutputContract(baselineResolver, [...testCase.suites]);
      assertWebOutput(
        before,
        testCase.before,
        [...testCase.suites].filter((suite) => suite.startsWith('web:')),
      );
    }
  });
}

void test('preserves the accepted web-only platform scope argument', () => {
  const output = runOutputContract(
    candidateResolver,
    ['web:server-auth'],
    ['--platform-scope', 'web-only'],
  );
  assertWebOutput(output, true, ['web:server-auth']);
});

void test('rejects an invalid platform scope argument', () => {
  assert.throws(
    () => runOutputContract(candidateResolver, ['web:auth'], ['--platform-scope', 'bogus']),
    /must be "all" or "web-only"/,
  );
});

assert.equal(basename(candidateResolver), 'resolve-test-impact.ts');

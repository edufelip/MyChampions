import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  changedFilesFromGit,
  buildWorkingTreeGraph,
  discoverRegisteredTestFiles,
  globToRegExp,
  loadManifest,
  parseNameStatus,
  resolveImpact,
  type ImportGraph,
  type TestImpactManifest,
  validateFeatureBoundaries,
  validateManifest,
} from '../../scripts/ci/test-impact';

const root = process.cwd();

function syntheticManifest(): TestImpactManifest {
  return {
    schemaVersion: 1,
    maxChangedFiles: 500,
    criticalSuites: ['detox:a'],
    documentationPaths: ['docs/**', '*.md'],
    runtimePaths: ['features/**', 'components/**', 'app/**', '**/*.ts'],
    fullFallbackPaths: ['config/test-impact.json', 'scripts/ci/**'],
    sharedRules: [
      { id: 'navigation', paths: ['app/_layout.tsx'], impact: 'all' },
      {
        id: 'localization',
        paths: ['docs/screens/v2/localized-copy-table-v2.md'],
        impact: 'all',
      },
      {
        id: 'design-system',
        paths: ['components/ds/**', 'components/ui/**'],
        impact: 'reverse-importers',
      },
    ],
    features: {
      a: {
        sourcePaths: ['features/a/**'],
        dependsOn: [],
        unitTests: ['features/a/**/*.test.ts'],
        webSuites: ['web:a'],
        detoxSuites: ['detox:a'],
        owners: ['@owner'],
      },
      b: {
        sourcePaths: ['features/b/**'],
        dependsOn: [],
        unitTests: ['features/b/**/*.test.ts'],
        webSuites: ['web:b'],
        detoxSuites: ['detox:b'],
        owners: ['@owner'],
      },
      c: {
        sourcePaths: ['features/c/**'],
        dependsOn: ['a'],
        unitTests: ['features/c/**/*.test.ts'],
        webSuites: ['web:c'],
        detoxSuites: ['detox:c'],
        owners: ['@owner'],
      },
    },
    allowedDependencyCycles: [],
    suites: {
      'web:a': {
        runner: 'playwright',
        specs: ['e2e/web/a.spec.ts'],
        tier: 'feature',
        ci: true,
      },
      'web:b': {
        runner: 'playwright',
        specs: ['e2e/web/b.spec.ts'],
        tier: 'feature',
        ci: true,
      },
      'web:c': {
        runner: 'playwright',
        specs: ['e2e/web/c.spec.ts'],
        tier: 'feature',
        ci: true,
      },
      'detox:a': {
        runner: 'detox',
        platforms: ['ios', 'android'],
        specs: ['e2e/a.e2e.test.js'],
        tier: 'feature',
        ci: true,
      },
      'detox:b': {
        runner: 'detox',
        platforms: ['ios', 'android'],
        specs: ['e2e/b.e2e.test.js'],
        tier: 'feature',
        ci: true,
      },
      'detox:c': {
        runner: 'detox',
        platforms: ['ios', 'android'],
        specs: ['e2e/c.e2e.test.js'],
        tier: 'feature',
        ci: true,
      },
    },
  };
}

function syntheticManifestWithUnownedSuites(): TestImpactManifest {
  const manifest = syntheticManifest();
  manifest.suites['web:unowned-ci'] = {
    runner: 'playwright',
    specs: ['e2e/web/unowned-ci.spec.ts'],
    tier: 'feature',
    ci: true,
  };
  manifest.suites['detox:unowned-ios-ci'] = {
    runner: 'detox',
    platforms: ['ios'],
    specs: ['e2e/unowned-ios-ci.e2e.test.js'],
    tier: 'feature',
    ci: true,
  };
  manifest.suites['detox:provider-live'] = {
    runner: 'detox',
    platforms: ['ios', 'android'],
    specs: ['e2e/provider-live.e2e.test.js'],
    fixtureProfile: 'provider-live',
    tier: 'release',
    ci: false,
  };
  manifest.suites['web:evidence'] = {
    runner: 'playwright-evidence',
    specs: ['e2e/web/evidence.spec.ts'],
    tier: 'evidence',
    ci: false,
  };
  return manifest;
}

test('checked-in impact manifest is internally valid', () => {
  const manifest = loadManifest(root);
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(validateFeatureBoundaries(root, manifest), []);
});

test('glob matching supports root files, nested directories, and literal route punctuation', () => {
  assert.equal(globToRegExp('features/a/**').test('features/a/source.ts'), true);
  assert.equal(globToRegExp('features/a/**/*.test.ts').test('features/a/source.test.ts'), true);
  assert.equal(globToRegExp('app/(tabs)/**').test('app/(tabs)/nutrition/index.tsx'), true);
  assert.equal(globToRegExp('*.md').test('README.md'), true);
});

test('a feature-only change selects A and its declared reverse dependent, not unrelated B', () => {
  const result = resolveImpact(syntheticManifest(), [
    { status: 'M', path: 'features/a/source.ts' },
  ]);

  assert.equal(result.mode, 'selective');
  assert.deepEqual(result.directFeatures, ['a']);
  assert.deepEqual(result.affectedFeatures, ['a', 'c']);
  assert.deepEqual(result.webSuites, ['web:a', 'web:c']);
  assert.deepEqual(result.detoxIosSuites, ['detox:a', 'detox:c']);
  assert.deepEqual(result.detoxAndroidSuites, ['detox:a', 'detox:c']);
  assert.equal(result.selectedSuites.includes('web:b'), false);
  assert.equal(result.selectedSuites.includes('detox:b'), false);
});

test('reverse import consumers widen a design-system change only to actual consumers', () => {
  const reverseGraph: ImportGraph = new Map([
    ['components/ds/Button.tsx', new Set(['features/a/screen.tsx'])],
  ]);
  const result = resolveImpact(
    syntheticManifest(),
    [{ status: 'M', path: 'components/ds/Button.tsx' }],
    [reverseGraph]
  );

  assert.deepEqual(result.directFeatures, []);
  assert.deepEqual(result.affectedFeatures, ['a', 'c']);
  assert.match(result.reasons.join(' '), /reverse import consumers: a/);
});

test('reverse import graph includes platform-specific module variants', () => {
  const repository = mkdtempSync(join(tmpdir(), 'mychampions-platform-import-'));

  try {
    mkdirSync(join(repository, 'components', 'ui'), { recursive: true });
    mkdirSync(join(repository, 'features', 'a'), { recursive: true });
    writeFileSync(join(repository, 'components', 'ui', 'icon-symbol.tsx'), 'export const Icon = 1;\n');
    writeFileSync(
      join(repository, 'components', 'ui', 'icon-symbol.ios.tsx'),
      'export const Icon = 2;\n'
    );
    writeFileSync(
      join(repository, 'features', 'a', 'screen.tsx'),
      "import { Icon } from '@/components/ui/icon-symbol';\nexport const Screen = Icon;\n"
    );

    const graph = buildWorkingTreeGraph(repository);
    assert.deepEqual(
      [...(graph.get('components/ui/icon-symbol.ios.tsx') ?? [])],
      ['features/a/screen.tsx']
    );

    const result = resolveImpact(
      syntheticManifest(),
      [{ status: 'M', path: 'components/ui/icon-symbol.ios.tsx' }],
      [graph]
    );
    assert.deepEqual(result.affectedFeatures, ['a', 'c']);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('navigation changes select the complete registered CI matrix', () => {
  const result = resolveImpact(syntheticManifest(), [
    { status: 'M', path: 'app/_layout.tsx' },
  ]);

  assert.deepEqual(result.affectedFeatures, ['a', 'b', 'c']);
  assert.deepEqual(result.webSuites, ['web:a', 'web:b', 'web:c']);
  assert.deepEqual(result.detoxIosSuites, ['detox:a', 'detox:b', 'detox:c']);
  assert.deepEqual(result.detoxAndroidSuites, ['detox:a', 'detox:b', 'detox:c']);
});

for (const scenario of [
  {
    name: 'an explicit full fallback',
    changedFiles: [{ status: 'M' as const, path: 'features/a/source.ts' }],
    options: { forceFull: true },
    expectedMode: 'full-fallback',
  },
  {
    name: 'a matched shared impact-all rule',
    changedFiles: [{ status: 'M' as const, path: 'app/_layout.tsx' }],
    options: {},
    expectedMode: 'selective',
  },
]) {
  test(`${scenario.name} includes every registered CI suite even when no feature owns it`, () => {
    const result = resolveImpact(
      syntheticManifestWithUnownedSuites(),
      scenario.changedFiles,
      [],
      scenario.options
    );

    assert.equal(result.mode, scenario.expectedMode);
    assert.deepEqual(result.webSuites, ['web:a', 'web:b', 'web:c', 'web:unowned-ci']);
    assert.deepEqual(result.detoxIosSuites, [
      'detox:a',
      'detox:b',
      'detox:c',
      'detox:unowned-ios-ci',
    ]);
    assert.deepEqual(result.detoxAndroidSuites, ['detox:a', 'detox:b', 'detox:c']);
    assert.equal(result.selectedSuites.includes('detox:provider-live'), false);
    assert.equal(result.selectedSuites.includes('web:evidence'), false);
  });
}

for (const scenario of [
  {
    name: 'an unowned CI web spec',
    path: 'e2e/web/unowned-ci.spec.ts',
    expectedSelectedSuites: ['web:unowned-ci'],
    expectedWebSuites: ['web:unowned-ci'],
    expectedIosSuites: [],
    expectedAndroidSuites: [],
  },
  {
    name: 'an unowned iOS-only CI Detox spec',
    path: 'e2e/unowned-ios-ci.e2e.test.js',
    expectedSelectedSuites: ['detox:a', 'detox:unowned-ios-ci'],
    expectedWebSuites: [],
    expectedIosSuites: ['detox:a', 'detox:unowned-ios-ci'],
    expectedAndroidSuites: ['detox:a'],
  },
  {
    name: 'a non-CI provider-live spec',
    path: 'e2e/provider-live.e2e.test.js',
    expectedSelectedSuites: [],
    expectedWebSuites: [],
    expectedIosSuites: [],
    expectedAndroidSuites: [],
  },
  {
    name: 'a non-CI evidence spec',
    path: 'e2e/web/evidence.spec.ts',
    expectedSelectedSuites: [],
    expectedWebSuites: [],
    expectedIosSuites: [],
    expectedAndroidSuites: [],
  },
]) {
  test(`a direct change to ${scenario.name} respects its CI eligibility`, () => {
    const result = resolveImpact(syntheticManifestWithUnownedSuites(), [
      { status: 'M', path: scenario.path },
    ]);

    assert.equal(result.mode, 'selective');
    assert.deepEqual(result.directFeatures, []);
    assert.deepEqual(result.affectedFeatures, []);
    assert.deepEqual(result.selectedSuites, scenario.expectedSelectedSuites);
    assert.deepEqual(result.webSuites, scenario.expectedWebSuites);
    assert.deepEqual(result.detoxIosSuites, scenario.expectedIosSuites);
    assert.deepEqual(result.detoxAndroidSuites, scenario.expectedAndroidSuites);
    assert.deepEqual(result.unmappedRuntimePaths, []);
  });
}

test('renames and copies preserve old and new paths', () => {
  assert.deepEqual(parseNameStatus('R100\tfeatures/a/old.ts\tfeatures/b/new.ts\n'), [
    {
      status: 'R',
      previousPath: 'features/a/old.ts',
      path: 'features/b/new.ts',
    },
  ]);
  assert.deepEqual(parseNameStatus('C075\tfeatures/a/source.ts\tfeatures/b/copy.ts\n'), [
    {
      status: 'C',
      previousPath: 'features/a/source.ts',
      path: 'features/b/copy.ts',
    },
  ]);
});

test('a rename from A to B affects both ownership domains', () => {
  const result = resolveImpact(syntheticManifest(), [
    {
      status: 'R',
      previousPath: 'features/a/old.ts',
      path: 'features/b/new.ts',
    },
  ]);

  assert.deepEqual(result.directFeatures, ['a', 'b']);
  assert.deepEqual(result.affectedFeatures, ['a', 'b', 'c']);
});

test('a deleted feature file retains ownership from its previous path', () => {
  const result = resolveImpact(syntheticManifest(), [
    { status: 'D', path: 'features/a/deleted.ts' },
  ]);

  assert.deepEqual(result.directFeatures, ['a']);
  assert.deepEqual(result.affectedFeatures, ['a', 'c']);
});

test('unmapped runtime changes fail closed to the full matrix', () => {
  const result = resolveImpact(syntheticManifest(), [
    { status: 'A', path: 'features/unknown/new-source.ts' },
  ]);

  assert.equal(result.mode, 'full-fallback');
  assert.deepEqual(result.affectedFeatures, ['a', 'b', 'c']);
  assert.deepEqual(result.unmappedRuntimePaths, ['features/unknown/new-source.ts']);
  assert.deepEqual(result.webSuites, ['web:a', 'web:b', 'web:c']);
  assert.deepEqual(result.detoxIosSuites, ['detox:a', 'detox:b', 'detox:c']);
  assert.deepEqual(result.detoxAndroidSuites, ['detox:a', 'detox:b', 'detox:c']);
});

test('source files in unknown nested directories fail closed to the full matrix', () => {
  const result = resolveImpact(syntheticManifest(), [
    { status: 'A', path: 'utils/nested/new-helper.ts' },
  ]);

  assert.equal(result.mode, 'full-fallback');
  assert.deepEqual(result.unmappedRuntimePaths, ['utils/nested/new-helper.ts']);
});

test('documentation-only changes skip expensive suites', () => {
  const result = resolveImpact(syntheticManifest(), [
    { status: 'M', path: 'docs/architecture/selective-tests.md' },
  ]);

  assert.equal(result.mode, 'documentation-only');
  assert.deepEqual(result.selectedSuites, []);
});

test('documentation paths owned by a global rule still select the complete matrix', () => {
  const result = resolveImpact(syntheticManifest(), [
    { status: 'M', path: 'docs/screens/v2/localized-copy-table-v2.md' },
  ]);

  assert.equal(result.mode, 'selective');
  assert.deepEqual(result.affectedFeatures, ['a', 'b', 'c']);
  assert.deepEqual(result.detoxAndroidSuites, ['detox:a', 'detox:b', 'detox:c']);
});

test('impact infrastructure changes fail closed even when they are otherwise unmapped', () => {
  const result = resolveImpact(syntheticManifest(), [
    { status: 'M', path: 'config/test-impact.json' },
  ]);

  assert.equal(result.mode, 'full-fallback');
  assert.match(result.fallbackReasons.join(' '), /tooling file changed/);
});

test('CLI emits compact suite arrays and web-server workflow outputs', () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'mychampions-test-impact-output-'));
  const githubOutput = join(outputDirectory, 'github-output.txt');
  const impactOutput = join(outputDirectory, 'impact.json');
  const markdownOutput = join(outputDirectory, 'summary.md');

  try {
    execFileSync(
      join(root, 'node_modules', '.bin', 'tsx'),
      [
        'scripts/ci/resolve-test-impact.ts',
        '--all',
        '--output',
        impactOutput,
        '--markdown',
        markdownOutput,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_OUTPUT: githubOutput,
          GITHUB_STEP_SUMMARY: '',
        },
        encoding: 'utf8',
      }
    );

    const outputs = Object.fromEntries(
      readFileSync(githubOutput, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        })
    );
    const result = JSON.parse(readFileSync(impactOutput, 'utf8'));
    const manifest = loadManifest(root);

    assert.match(outputs.has_web_server, /^(true|false)$/);
    assert.equal(
      outputs.has_web_server,
      String(
        result.webSuites.some(
          (suite: string) => manifest.suites[suite]?.runner === 'playwright-server'
        )
      )
    );

    for (const [outputName, resultKey] of [
      ['web_suites', 'webSuites'],
      ['detox_ios_suites', 'detoxIosSuites'],
      ['detox_android_suites', 'detoxAndroidSuites'],
    ] as const) {
      assert.deepEqual(JSON.parse(outputs[outputName]), result[resultKey]);
      assert.equal(outputs[outputName], JSON.stringify(result[resultKey]));
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test('undeclared dependency cycles fail manifest validation', () => {
  const manifest = syntheticManifest();
  manifest.features.a.dependsOn = ['c'];
  assert.match(validateManifest(manifest).join('\n'), /undeclared dependency cycle/);
});

test('merge-base change detection ignores base-only commits merged into a feature branch', () => {
  const repository = mkdtempSync(join(tmpdir(), 'mychampions-test-impact-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' });

  try {
    git('init', '-b', 'develop');
    git('config', 'user.name', 'Test Impact');
    git('config', 'user.email', 'test-impact@example.invalid');
    mkdirSync(join(repository, 'features', 'a'), { recursive: true });
    writeFileSync(join(repository, 'README.md'), 'base\n');
    git('add', '.');
    git('commit', '-m', 'base');

    git('checkout', '-b', 'feature/a');
    writeFileSync(join(repository, 'features', 'a', 'source.ts'), 'export const value = 1;\n');
    git('add', '.');
    git('commit', '-m', 'feature change');

    git('checkout', 'develop');
    writeFileSync(join(repository, 'README.md'), 'base updated\n');
    git('add', '.');
    git('commit', '-m', 'develop change');

    git('checkout', 'feature/a');
    git('merge', 'develop', '--no-edit');

    assert.deepEqual(changedFilesFromGit(repository, 'develop', 'feature/a'), [
      { status: 'A', path: 'features/a/source.ts' },
    ]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('Git change detection preserves the source path for copies of unchanged files', () => {
  const repository = mkdtempSync(join(tmpdir(), 'mychampions-test-impact-copy-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
  const source = 'export const copiedValue = "stable source content";\n';

  try {
    git('init', '-b', 'develop');
    git('config', 'user.name', 'Test Impact');
    git('config', 'user.email', 'test-impact@example.invalid');
    mkdirSync(join(repository, 'features', 'a'), { recursive: true });
    writeFileSync(join(repository, 'features', 'a', 'source.ts'), source);
    git('add', '.');
    git('commit', '-m', 'base');

    git('checkout', '-b', 'feature/copy');
    mkdirSync(join(repository, 'features', 'b'), { recursive: true });
    writeFileSync(join(repository, 'features', 'b', 'copy.ts'), source);
    git('add', '.');
    git('commit', '-m', 'copy unchanged feature source');

    assert.deepEqual(changedFilesFromGit(repository, 'develop', 'feature/copy'), [
      {
        status: 'C',
        previousPath: 'features/a/source.ts',
        path: 'features/b/copy.ts',
      },
    ]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('registered UI spec discovery recurses through nested E2E directories', () => {
  const repository = mkdtempSync(join(tmpdir(), 'mychampions-test-impact-specs-'));

  try {
    mkdirSync(join(repository, 'e2e', 'web', 'auth'), { recursive: true });
    mkdirSync(join(repository, 'e2e', 'native', 'student'), { recursive: true });
    writeFileSync(join(repository, 'e2e', 'web', 'auth', 'login.spec.ts'), 'test("login", () => {});\n');
    writeFileSync(
      join(repository, 'e2e', 'native', 'student', 'home.e2e.test.js'),
      'describe("home", () => {});\n'
    );

    assert.deepEqual(discoverRegisteredTestFiles(repository), [
      'e2e/native/student/home.e2e.test.js',
      'e2e/web/auth/login.spec.ts',
    ]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const candidateRoot = path.resolve(process.cwd());
const generatorPath = path.join(candidateRoot, 'scripts/testing/generate-native-declaration.py');

const sourceRoots = [
  'scripts/testing/t16b-owned-ios-native-entrypoint.ts',
  'scripts/testing/run-ios-connection-attempt.ts',
  'scripts/testing/t16b-owned-maestro-bootstrap.ts',
  'scripts/testing/t16b-owned-maestro-runtime.ts',
  'scripts/testing/t16b-owned-exploration-controller.ts',
  'scripts/testing/t16b-owned-maestro-mcp-connector.ts',
  'scripts/testing/run-t16-owned-exploration.ts',
  'scripts/testing/owned-maestro-mcp-stdio.ts',
];

function localImports(source: string): string[] {
  return [...source.matchAll(/(?:from|import\s*\()\s*["'](\.\.?\/[^"']+)["']/g)].map(
    ([, value]) => value,
  );
}

function importCandidates(relative: string): string[] {
  if (/\.(?:ts|tsx|mjs|mts|js|d\.mts)$/.test(relative)) return [relative];
  return [
    `${relative}.ts`,
    `${relative}.tsx`,
    `${relative}.mjs`,
    `${relative}.mts`,
    `${relative}.js`,
    `${relative}.d.mts`,
    `${relative}/index.ts`,
    `${relative}/index.mjs`,
    `${relative}/index.js`,
  ];
}

void test('declares the complete owned T16-B bootstrap import closure', async () => {
  const generator = await readFile(generatorPath, 'utf8');
  const pending = [...sourceRoots];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const relative = pending.pop();
    assert(relative);
    if (visited.has(relative)) continue;
    visited.add(relative);
    const sourcePath = path.join(candidateRoot, relative);
    const stat = await lstat(sourcePath);
    assert.equal(stat.isSymbolicLink(), false, `${relative} must be regular`);
    assert.equal(stat.isFile(), true, `${relative} must be a file`);
    const source = await readFile(sourcePath, 'utf8');
    for (const imported of localImports(source)) {
      const candidates = importCandidates(path.join(path.dirname(relative), imported));
      const importedRelative = candidates.find((candidate) =>
        existsSync(path.join(candidateRoot, candidate)),
      );
      assert(importedRelative, `${relative} imports missing ${imported}`);
      assert(
        importedRelative.startsWith('scripts/testing/') ||
          importedRelative.startsWith('scripts/ci/') ||
          importedRelative.startsWith('localization/'),
        `${relative} imports outside the owned source tree`,
      );
      pending.push(importedRelative);
    }
    const declaration = `: \"${relative}\"`;
    assert(generator.includes(declaration), `generator does not declare ${relative}`);
  }
  assert(visited.has('scripts/testing/t16b-owned-maestro-bootstrap.ts'));
  assert(visited.has('scripts/testing/t16b-owned-maestro-runtime.ts'));
  assert(visited.has('scripts/testing/native-view-evidence.ts'));
  assert(generator.includes(': "package.json"'));
});

void test('rejects a missing bootstrap owner declaration before inventory generation', async () => {
  const generator = await readFile(generatorPath, 'utf8');
  const removed = generator.replace(
    '    "t16-owned-runtime-source": "scripts/testing/t16b-owned-maestro-runtime.ts",\n',
    '',
  );
  assert.notEqual(removed, generator);
  assert.doesNotMatch(removed, /: \"scripts\/testing\/t16b-owned-maestro-runtime\.ts\"/);
});

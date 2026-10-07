import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repositoryRoot = process.cwd();

const runtimeSourcePaths = [
  'scripts/testing/detox-runtime-build-metadata.ts',
  'scripts/testing/native-detox-connection-runtime-dispatch.ts',
  'scripts/testing/native-detox-connection-runtime-producer.ts',
  'scripts/testing/native-detox-connection-runtime-verification.ts',
] as const;

function read(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function dispatchClosure(): string[] {
  const source = read('scripts/testing/native-detox-connection-public-dispatch.ts');
  const match = source.match(/export const detoxDispatchRuntimeClosure = \[([\s\S]*?)\] as const;/);
  assert(match, 'the Detox dispatch must declare an explicit runtime closure');
  const paths = [...match[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
  assert(paths.length > 0, 'the Detox dispatch runtime closure must not be empty');
  assert.equal(
    new Set(paths).size,
    paths.length,
    'the Detox dispatch runtime closure must not contain duplicate paths',
  );
  return paths;
}

function sourcePathRows(): Map<string, string> {
  const source = read('scripts/testing/generate-native-declaration.py');
  const match = source.match(
    /SOURCE_PATHS = \{([\s\S]*?)\n\}\n\n# These are static inputs of the public Detox dispatcher/,
  );
  assert(match, 'the declaration generator must expose its SOURCE_PATHS table');
  const rows = [...match[1].matchAll(/^\s*"([^"]+)": "([^"]+)",?$/gm)].map(
    ([, key, value]) => [key, value] as const,
  );
  assert(rows.length > 0, 'the declaration generator SOURCE_PATHS table must not be empty');
  return new Map(rows);
}

void test('Detox runtime helpers are explicit declaration inputs and iOS owners', () => {
  const closure = dispatchClosure();
  const rows = sourcePathRows();

  for (const relativePath of runtimeSourcePaths) {
    assert(closure.includes(relativePath), `${relativePath} must be in the runtime closure`);
    const matchingRows = [...rows.entries()].filter(([, value]) => value === relativePath);
    assert.equal(
      matchingRows.length,
      1,
      `${relativePath} must have exactly one declaration source row`,
    );
  }

  const ownerSource = read('scripts/testing/generate-native-declaration.py');
  assert.match(
    ownerSource,
    /key for key, relative in SOURCE_PATHS\.items\(\) if relative in dispatch_paths/,
    'SCN-connection-ios owners must bind declaration rows to the actual dispatch closure',
  );
  assert.match(
    ownerSource,
    /if family == "connection":\n\s+scenario_owners \+= .*ios-detox-connection-public-dispatch-source/s,
    'the iOS connection scenario must include the public dispatch owner path',
  );

  for (const relativePath of runtimeSourcePaths) {
    assert.equal(
      rows.get([...rows.entries()].find(([, value]) => value === relativePath)?.[0] ?? ''),
      relativePath,
    );
  }
});

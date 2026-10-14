import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type Platform = 'ios' | 'android';
type Flow = 'connection' | 'training' | 'session' | 'save-retry' | 'camera-denied';

type Closure = {
  scriptPaths: string[];
  supplementalPaths: string[];
  ignoredLocalImports: string[];
};

type InventoryScenario = {
  id: string;
  platform: Platform;
  flowId: string;
  ownerPaths: string[];
  freshnessInputs: {
    ownerPaths: string[];
    sourceIds: string[];
  };
};

type NativeInventory = {
  scenarios: InventoryScenario[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const readerSupplementalPaths = [
  'scripts/testing/android-input-reader/AndroidManifest.xml',
  'scripts/testing/android-input-reader/InputReader.java',
];
const entryPoints: Record<Platform, Record<Flow, string[]>> = {
  ios: {
    'save-retry': [
      'scripts/testing/capture-native-testability.ts',
      'scripts/testing/run-ios-save-retry-attempt.ts',
    ],
    'camera-denied': [
      'scripts/testing/capture-native-testability.ts',
      'scripts/testing/run-ios-camera-attempt.ts',
    ],
    // The source-only public adapter and its owned capture are both freshness inputs.
    session: [
      'scripts/testing/capture-native-testability.ts',
      'scripts/testing/run-ios-session-attempt.ts',
    ],
    connection: [
      'scripts/testing/capture-native-testability.ts',
      'scripts/testing/run-ios-connection-attempt.ts',
      'scripts/testing/native-connection-journey.ts',
    ],
    training: [
      'scripts/testing/capture-native-testability.ts',
      'scripts/testing/run-ios-training-attempt.ts',
      'scripts/testing/native-training-journey.ts',
    ],
  },
  android: {
    'save-retry': ['scripts/testing/capture-android-testability.ts'],
    'camera-denied': ['scripts/testing/capture-android-testability.ts'],
    session: [
      'scripts/testing/capture-android-testability.ts',
      'scripts/testing/run-android-session-attempt.ts',
    ],
    connection: [
      'scripts/testing/capture-android-testability.ts',
      'scripts/testing/run-android-connection-attempt.ts',
      'scripts/testing/native-connection-journey.ts',
    ],
    training: [
      'scripts/testing/capture-android-testability.ts',
      'scripts/testing/run-android-training-attempt.ts',
      'scripts/testing/native-training-journey.ts',
    ],
  },
};
const capturePaths: Record<Platform, string> = {
  ios: 'scripts/testing/capture-native-testability.ts',
  android: 'scripts/testing/capture-android-testability.ts',
};

function findRepositoryRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (
      existsSync(path.join(current, 'package.json')) &&
      existsSync(path.join(current, 'scripts/testing/capture-native-testability.ts'))
    )
      return current;
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(`Could not locate canonical repository root from ${start}`);
    current = parent;
  }
}

const repositoryRoot = findRepositoryRoot(here);

function relativePath(value: string): string {
  return value.split(path.sep).join('/');
}

async function readCanonical(relative: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relative), 'utf8');
}

async function canonicalPathExists(relative: string): Promise<boolean> {
  try {
    await readFile(path.join(repositoryRoot, relative));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function localImportSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
    ),
  ].map((match) => match[1]);
}

async function resolveLocalImport(
  importerRelative: string,
  specifier: string,
): Promise<string | null> {
  const absolute = path.resolve(repositoryRoot, path.dirname(importerRelative), specifier);
  const fromRoot = path.relative(repositoryRoot, absolute);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return null;
  const candidates = [fromRoot];
  if (!path.extname(fromRoot)) {
    for (const extension of ['.ts', '.tsx', '.js', '.mjs', '.json'])
      candidates.push(`${fromRoot}${extension}`);
    for (const extension of ['.ts', '.tsx', '.js', '.mjs', '.json'])
      candidates.push(path.join(fromRoot, `index${extension}`));
  }
  for (const candidate of candidates) {
    if (await canonicalPathExists(candidate)) return relativePath(candidate);
  }
  throw new Error(`Unresolved local import ${importerRelative} -> ${specifier}`);
}

async function captureScriptClosure(entries: string[]): Promise<Closure> {
  const queue = [...entries];
  const scripts = new Set<string>();
  const ignoredLocalImports = new Set<string>();
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (scripts.has(current)) continue;
    assert.equal(
      await canonicalPathExists(current),
      true,
      `Missing canonical closure entry or dependency: ${current}`,
    );
    scripts.add(current);
    const source = await readCanonical(current);
    for (const specifier of localImportSpecifiers(source)) {
      const target = await resolveLocalImport(current, specifier);
      if (!target) continue;
      if (target.startsWith('scripts/')) queue.push(target);
      else ignoredLocalImports.add(target);
    }
  }
  const supplementalPaths = scripts.has('scripts/testing/android-native-input-reader.ts')
    ? [...readerSupplementalPaths]
    : [];
  for (const supplemental of supplementalPaths)
    assert.equal(
      await canonicalPathExists(supplemental),
      true,
      `Missing canonical Android reader dependency: ${supplemental}`,
    );
  return {
    scriptPaths: [...scripts].sort(),
    supplementalPaths: supplementalPaths.sort(),
    ignoredLocalImports: [...ignoredLocalImports].sort(),
  };
}

function canonicalHelperPath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.startsWith('scripts/') ||
    normalized.startsWith('.maestro/') ||
    normalized === 'package.json'
  )
    return normalized;
  if (normalized.startsWith('../') || normalized.startsWith('./'))
    throw new Error(`Capture helper path is not repository-relative: ${value}`);
  return path.posix.join('scripts/testing', normalized);
}

async function parseImportedSessionHelperLedger(source: string): Promise<string[]> {
  assert.match(
    source,
    /import\s+\{\s*readNativeSessionHelperInputs\s*\}\s+from\s+['"]\.\/native-session-helper-ledger['"];?/,
    'iOS capture must import the canonical helper ledger',
  );
  assert.match(
    source,
    /const helperIdentity = async \(\) => readNativeSessionHelperInputs\(root\);/,
    'iOS capture must call the imported helper producer',
  );
  const ledgerSource = await readCanonical('scripts/testing/native-session-helper-ledger.ts');
  const startMarker = 'export const nativeSessionHelperInputPaths = Object.freeze([';
  const endMarker = '] as const);';
  const ledgerStart = ledgerSource.indexOf(startMarker);
  assert.notEqual(ledgerStart, -1, 'Imported iOS helper ledger array start is missing');
  const ledgerEnd = ledgerSource.indexOf(endMarker, ledgerStart + startMarker.length);
  assert.notEqual(ledgerEnd, -1, 'Imported iOS helper ledger array end is missing');
  const paths = [
    ...ledgerSource
      .slice(ledgerStart + startMarker.length, ledgerEnd)
      .matchAll(/["']([^"']+)["']/g),
  ].map((match) => match[1]);
  assert.ok(paths.length > 0, 'Imported iOS helper ledger is empty');
  return paths;
}

async function parseCaptureHelperArray(source: string, platform: Platform): Promise<string[]> {
  if (platform === 'ios') return parseImportedSessionHelperLedger(source);
  const startMarker = 'const helperPaths = [';
  const endMarker = '\n  ];\n  const helperIdentity';
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${platform} capture helper array start is missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${platform} capture helper array end is missing`);
  return [...source.slice(start + startMarker.length, end).matchAll(/["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

function requireUniqueHelperPaths(paths: string[], label: string): Set<string> {
  const normalized = paths.map(canonicalHelperPath);
  assert.equal(
    new Set(normalized).size,
    normalized.length,
    `${label} contains duplicate canonical helper paths`,
  );
  return new Set(normalized);
}

function requireClosureCovered(actualHelpers: string[], closure: Closure, label: string): void {
  const actual = new Set(actualHelpers.map(canonicalHelperPath));
  for (const dependency of [...closure.scriptPaths, ...closure.supplementalPaths])
    assert.equal(actual.has(dependency), true, `${label} omitted actual local input ${dependency}`);
}

function requireScenario(
  inventory: NativeInventory,
  flow: Flow,
  platform: Platform,
): InventoryScenario {
  const id = `SCN-${flow}-${platform}`;
  const scenario = inventory.scenarios.find((candidate) => candidate.id === id);
  assert(scenario, `Canonical native inventory is missing ${id}`);
  assert.equal(scenario.platform, platform, `${id} platform changed`);
  assert.equal(scenario.flowId, `FLW-${flow}`, `${id} flow changed`);
  assert(Array.isArray(scenario.ownerPaths), `${id} ownerPaths are missing`);
  assert(
    Array.isArray(scenario.freshnessInputs?.ownerPaths),
    `${id} freshness ownerPaths are missing`,
  );
  return scenario;
}

function requireInventoryCoverage(scenario: InventoryScenario, closure: Closure): void {
  const ownerPaths = scenario.ownerPaths;
  const freshnessPaths = scenario.freshnessInputs.ownerPaths;
  assert.equal(
    new Set(ownerPaths).size,
    ownerPaths.length,
    `${scenario.id} ownerPaths contain duplicates`,
  );
  assert.equal(
    new Set(freshnessPaths).size,
    freshnessPaths.length,
    `${scenario.id} freshness ownerPaths contain duplicates`,
  );
  assert.deepEqual(
    [...new Set(freshnessPaths)].sort(),
    [...new Set(ownerPaths)].sort(),
    `${scenario.id} freshness ownerPaths diverge from generated ownerPaths`,
  );
  const ownerSet = new Set(ownerPaths);
  const freshnessSet = new Set(freshnessPaths);
  for (const input of [...closure.scriptPaths, ...closure.supplementalPaths]) {
    assert.equal(
      ownerSet.has(input),
      true,
      `${scenario.id} generated ownerPaths omit actual input ${input}`,
    );
    assert.equal(
      freshnessSet.has(input),
      true,
      `${scenario.id} freshness ownerPaths omit actual input ${input}`,
    );
  }
}

async function loadInventory(): Promise<NativeInventory> {
  const inventory = JSON.parse(
    await readCanonical('docs/qa/native-pilot/inventory.json'),
  ) as unknown;
  assert(inventory && typeof inventory === 'object' && !Array.isArray(inventory));
  assert(Array.isArray((inventory as { scenarios?: unknown }).scenarios));
  return inventory as NativeInventory;
}

void test('canonical capture helper arrays cover all five actual pilot family import closures', async () => {
  for (const platform of ['ios', 'android'] as const) {
    const captureSource = await readCanonical(capturePaths[platform]);
    const helperPaths = await parseCaptureHelperArray(captureSource, platform);
    const helperSet = requireUniqueHelperPaths(helperPaths, `${platform} capture`);
    for (const helper of helperSet)
      assert.equal(
        await canonicalPathExists(helper),
        true,
        `${platform} capture references missing helper ${helper}`,
      );

    for (const flow of [
      'session',
      'connection',
      'training',
      'save-retry',
      'camera-denied',
    ] as const) {
      const closure = await captureScriptClosure(entryPoints[platform][flow]);
      requireClosureCovered(helperPaths, closure, `${platform} ${flow} capture`);
      if (platform === 'android' && flow === 'camera-denied') {
        assert.equal(
          helperSet.has('scripts/testing/native-camera-android-saved-flow.ts'),
          true,
          'Android camera helper omitted the saved-flow source module',
        );
        assert.equal(
          helperSet.has('.maestro/flows/camera-denied-android.yaml'),
          true,
          'Android camera helper omitted the checked-in saved-flow route',
        );
      }
      assert.ok(
        closure.scriptPaths.length > 0,
        `${platform} ${flow} closure unexpectedly has no TypeScript inputs`,
      );
    }

    const connectionClosure = await captureScriptClosure(entryPoints[platform].connection);
    const firstDependency = connectionClosure.scriptPaths[0];
    const withoutFirst = helperPaths.filter(
      (helper) => canonicalHelperPath(helper) !== firstDependency,
    );
    assert.throws(
      () =>
        requireClosureCovered(
          withoutFirst,
          { ...connectionClosure, scriptPaths: [firstDependency] },
          `${platform} omission control`,
        ),
      /omitted actual local input/,
      `${platform} omission control did not fail closed`,
    );
    assert.throws(
      () => requireUniqueHelperPaths([...helperPaths, helperPaths[0]], `${platform} capture`),
      /duplicate canonical helper paths/,
      `${platform} duplicate-helper control did not fail closed`,
    );
  }
});

void test('session declaration retains the real capture entrypoint and shared evidence owners', async () => {
  for (const platform of ['ios', 'android'] as const) {
    assert.deepEqual(
      entryPoints[platform].session,
      platform === 'ios'
        ? [capturePaths[platform], 'scripts/testing/run-ios-session-attempt.ts']
        : [capturePaths[platform], 'scripts/testing/run-android-session-attempt.ts'],
      `${platform} session closure must use only its real current entrypoints`,
    );
    const captureSource = await readCanonical(capturePaths[platform]);
    const helperSet = requireUniqueHelperPaths(
      await parseCaptureHelperArray(captureSource, platform),
      `${platform} capture`,
    );
    for (const required of [
      'scripts/testing/native-view-evidence.ts',
      'scripts/testing/native-auth-observation.ts',
      'scripts/testing/owned-session.ts',
    ])
      assert.equal(
        helperSet.has(required),
        true,
        `${platform} capture helper owner omitted required session evidence input ${required}`,
      );

    const closure = await captureScriptClosure(entryPoints[platform].session);
    assert.equal(
      closure.scriptPaths.includes(capturePaths[platform]),
      true,
      `${platform} session closure did not retain its real capture entrypoint`,
    );
    assert.equal(
      closure.scriptPaths.includes('scripts/testing/native-view-evidence.ts'),
      true,
      `${platform} session closure did not reach native-view-evidence.ts`,
    );
    if (platform === 'ios') {
      for (const importedSessionHelper of [
        'scripts/testing/native-session-profile-checkpoints.ts',
        'scripts/testing/native-auth-observation.ts',
        'scripts/testing/detox-connection-actionability.ts',
        'scripts/testing/detox-native-hierarchy.ts',
      ])
        assert.equal(
          closure.scriptPaths.includes(importedSessionHelper),
          true,
          `${platform} session closure omitted imported helper ${importedSessionHelper}`,
        );
    }
    const firstSessionDependency = closure.scriptPaths[0];
    assert.ok(firstSessionDependency, `${platform} session closure unexpectedly has no inputs`);
    assert.throws(
      () =>
        requireClosureCovered(
          [...helperSet]
            .map((helper) => canonicalHelperPath(helper))
            .filter((helper) => helper !== firstSessionDependency),
          { ...closure, scriptPaths: [firstSessionDependency] },
          `${platform} session omission control`,
        ),
      /omitted actual local input/,
      `${platform} session omission control did not fail closed`,
    );
    if (platform === 'android') {
      for (const required of [
        'scripts/testing/run-android-session-attempt.ts',
        'scripts/testing/native-android-session-public-dependency.ts',
        'scripts/testing/native-android-session-public-staging.ts',
      ])
        assert.equal(
          closure.scriptPaths.includes(required),
          true,
          `Android session closure omitted ${required}`,
        );
    }
    if (platform === 'android') {
      const iosLedger = requireUniqueHelperPaths(
        await parseImportedSessionHelperLedger(await readCanonical(capturePaths.ios)),
        'iOS imported helper ledger',
      );
      for (const required of iosLedger)
        assert.equal(
          helperSet.has(required),
          true,
          `Android capture helper omitted shared iOS ledger input ${required}`,
        );
    }
    if (platform === 'ios') {
      assert.equal(await canonicalPathExists('scripts/testing/run-ios-session-attempt.ts'), true);
      for (const required of [
        'scripts/testing/run-ios-session-attempt.ts',
        'scripts/testing/native-session-public-dependency.ts',
        'scripts/testing/native-session-public-staging.ts',
      ])
        assert.equal(
          closure.scriptPaths.includes(required),
          true,
          `iOS public session closure omitted its real input ${required}`,
        );
    }
    assert.equal(
      await canonicalPathExists('scripts/testing/run-android-session-attempt.ts'),
      true,
      'The actual Android session runner must remain a declaration entrypoint',
    );
  }
});

void test('regenerated connection inventory freshness owners include every actual platform input', async () => {
  const inventory = await loadInventory();
  for (const platform of ['ios', 'android'] as const) {
    const closure = await captureScriptClosure(entryPoints[platform].connection);
    requireInventoryCoverage(requireScenario(inventory, 'connection', platform), closure);
  }
});

void test('regenerated training inventory freshness owners include every actual platform input', async () => {
  const inventory = await loadInventory();
  for (const platform of ['ios', 'android'] as const) {
    const closure = await captureScriptClosure(entryPoints[platform].training);
    requireInventoryCoverage(requireScenario(inventory, 'training', platform), closure);
  }
});

void test('regenerated session inventory freshness owners include every actual platform input and shared owners', async () => {
  const inventory = await loadInventory();
  for (const platform of ['ios', 'android'] as const) {
    const closure = await captureScriptClosure(entryPoints[platform].session);
    const scenario = requireScenario(inventory, 'session', platform);
    requireInventoryCoverage(scenario, closure);
    for (const required of [
      'scripts/testing/native-session-profile-checkpoints.ts',
      'scripts/testing/native-view-evidence.ts',
    ]) {
      assert.equal(
        scenario.ownerPaths.includes(required),
        true,
        `${scenario.id} generated ownerPaths omit shared session owner ${required}`,
      );
      assert.equal(
        scenario.freshnessInputs.ownerPaths.includes(required),
        true,
        `${scenario.id} freshness ownerPaths omit shared session owner ${required}`,
      );
    }
  }
});

void test('regenerated save-retry inventory binds every actual platform input', async () => {
  const inventory = await loadInventory();
  for (const platform of ['ios', 'android'] as const) {
    const closure = await captureScriptClosure(entryPoints[platform]['save-retry']);
    requireInventoryCoverage(requireScenario(inventory, 'save-retry', platform), closure);
  }
});

void test('regenerated camera-denied inventory binds every actual platform input', async () => {
  const inventory = await loadInventory();
  for (const platform of ['ios', 'android'] as const) {
    const closure = await captureScriptClosure(entryPoints[platform]['camera-denied']);
    requireInventoryCoverage(requireScenario(inventory, 'camera-denied', platform), closure);
  }
});

void test('all ten declaration rows bind the producer hashed by both capture ledgers', async () => {
  const producer = 'scripts/testing/native-android-session-checkpoint-copy.ts';
  for (const platform of ['ios', 'android'] as const) {
    const helpers = await parseCaptureHelperArray(
      await readCanonical(capturePaths[platform]),
      platform,
    );
    assert.equal(helpers.filter((entry) => canonicalHelperPath(entry) === producer).length, 1);
  }
  const inventory = await loadInventory();
  assert.equal(inventory.scenarios.length, 10);
  for (const scenario of inventory.scenarios) {
    assert.equal(
      scenario.freshnessInputs.sourceIds.filter(
        (entry) => entry === 'SRC-android-session-checkpoint-copy-source',
      ).length,
      1,
      scenario.id,
    );
    assert.equal(scenario.ownerPaths.filter((entry) => entry === producer).length, 1, scenario.id);
    assert.equal(
      scenario.freshnessInputs.ownerPaths.filter((entry) => entry === producer).length,
      1,
      scenario.id,
    );
  }
});

void test('inventory coverage rejects an omitted operational input', async () => {
  const original = requireScenario(await loadInventory(), 'connection', 'ios');
  const removed = 'scripts/testing/native-view-evidence.ts';
  const scenario = {
    ...original,
    ownerPaths: original.ownerPaths.filter((value) => value !== removed),
    freshnessInputs: {
      ...original.freshnessInputs,
      ownerPaths: original.freshnessInputs.ownerPaths.filter((value) => value !== removed),
    },
  };
  assert.throws(
    () =>
      requireInventoryCoverage(scenario, {
        scriptPaths: [removed],
        supplementalPaths: [],
        ignoredLocalImports: [],
      }),
    /omit actual input/,
  );
});

void test('generated inventory never carries a recursive source revision', async () => {
  const inventory = await loadInventory();
  const scenario = requireScenario(inventory, 'connection', 'ios');
  const generated = 'docs/qa/native-pilot/inventory.json';
  assert.deepEqual(
    scenario.ownerPaths.includes(generated),
    scenario.freshnessInputs.ownerPaths.includes(generated),
  );
  const sources = (inventory as NativeInventory & { sources: { paths: string[] }[] }).sources;
  assert(Array.isArray(sources));
  assert.equal(
    sources.some((source) => source.paths.includes(generated)),
    false,
  );
});

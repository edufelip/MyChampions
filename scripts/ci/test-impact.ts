import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, posix, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

export type ChangeStatus = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B';

export type ChangedFile = {
  status: ChangeStatus;
  path: string;
  previousPath?: string;
};

export type FeatureConfig = {
  sourcePaths: string[];
  dependsOn: string[];
  unitTests: string[];
  webSuites: string[];
  detoxSuites: string[];
  owners: string[];
};

export type SuiteConfig = {
  runner: string;
  specs: string[];
  tier: string;
  ci: boolean;
  platforms?: string[];
  projects?: string[];
  fixtureProfile?: string;
  grep?: string;
};

export type SharedRule = {
  id: string;
  paths: string[];
  impact: 'all' | 'reverse-importers';
  platforms?: string[];
};

export type TestImpactManifest = {
  schemaVersion: number;
  maxChangedFiles: number;
  criticalSuites: string[];
  documentationPaths: string[];
  runtimePaths: string[];
  fullFallbackPaths: string[];
  sharedRules: SharedRule[];
  features: Record<string, FeatureConfig>;
  allowedDependencyCycles: string[][];
  suites: Record<string, SuiteConfig>;
};

export type ImportGraph = Map<string, Set<string>>;

export type ImpactResult = {
  schemaVersion: 1;
  mode: 'selective' | 'full-fallback' | 'documentation-only';
  confidence: 'high' | 'fallback';
  changedFiles: ChangedFile[];
  directFeatures: string[];
  affectedFeatures: string[];
  selectedSuites: string[];
  webSuites: string[];
  detoxIosSuites: string[];
  detoxAndroidSuites: string[];
  unitTestPatterns: string[];
  sharedRules: string[];
  platforms: string[];
  reasons: string[];
  fallbackReasons: string[];
  unmappedRuntimePaths: string[];
};

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let expression = '^';

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];

    if (character === '*' && next === '*') {
      const after = normalized[index + 2];
      expression += after === '/' ? '(?:.*/)?' : '.*';
      index += after === '/' ? 2 : 1;
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }

  return new RegExp(`${expression}$`);
}

export function matchesAny(path: string, patterns: string[]): boolean {
  const normalized = normalizePath(path);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function loadManifest(root: string): TestImpactManifest {
  return JSON.parse(
    readFileSync(join(root, 'config', 'test-impact.json'), 'utf8'),
  ) as TestImpactManifest;
}

function canonicalCycle(cycle: string[]): string {
  const values = [...new Set(cycle)];
  const rotations = values.map((_, index) =>
    [...values.slice(index), ...values.slice(0, index)].join('>'),
  );
  return rotations.sort()[0] ?? '';
}

export function validateManifest(manifest: TestImpactManifest): string[] {
  const errors: string[] = [];
  const featureIds = new Set(Object.keys(manifest.features));
  const suiteIds = new Set(Object.keys(manifest.suites));

  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Number.isInteger(manifest.maxChangedFiles) || manifest.maxChangedFiles < 1) {
    errors.push('maxChangedFiles must be a positive integer');
  }

  for (const [featureId, feature] of Object.entries(manifest.features)) {
    if (feature.sourcePaths.length === 0) errors.push(`feature ${featureId} has no sourcePaths`);
    if (feature.owners.length === 0) errors.push(`feature ${featureId} has no owners`);
    for (const dependency of feature.dependsOn) {
      if (!featureIds.has(dependency))
        errors.push(`feature ${featureId} depends on unknown feature ${dependency}`);
    }
    for (const suiteId of [...feature.webSuites, ...feature.detoxSuites]) {
      if (!suiteIds.has(suiteId))
        errors.push(`feature ${featureId} references unknown suite ${suiteId}`);
    }
  }

  for (const [suiteId, suite] of Object.entries(manifest.suites)) {
    if (suite.specs.length === 0) errors.push(`suite ${suiteId} has no specs`);
    if (
      !['detox', 'playwright', 'playwright-server', 'playwright-evidence'].includes(suite.runner)
    ) {
      errors.push(`suite ${suiteId} uses unsupported runner ${suite.runner}`);
    }
  }
  for (const suiteId of manifest.criticalSuites) {
    if (!suiteIds.has(suiteId)) errors.push(`unknown critical suite ${suiteId}`);
    else if (!manifest.suites[suiteId]?.ci)
      errors.push(`critical suite ${suiteId} is not CI eligible`);
  }

  const allowedCycles = new Set(manifest.allowedDependencyCycles.map(canonicalCycle));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (featureId: string): void => {
    if (visited.has(featureId)) return;
    if (visiting.has(featureId)) {
      const start = stack.indexOf(featureId);
      const cycle = [...stack.slice(start), featureId];
      if (!allowedCycles.has(canonicalCycle(cycle))) {
        errors.push(`undeclared dependency cycle: ${cycle.join(' -> ')}`);
      }
      return;
    }

    visiting.add(featureId);
    stack.push(featureId);
    for (const dependency of manifest.features[featureId]?.dependsOn ?? []) visit(dependency);
    stack.pop();
    visiting.delete(featureId);
    visited.add(featureId);
  };

  for (const featureId of featureIds) visit(featureId);
  return [...new Set(errors)].sort();
}

export function parseNameStatus(output: string): ChangedFile[] {
  const changes: ChangedFile[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    const rawStatus = fields[0] ?? '';
    const status = rawStatus[0] as ChangeStatus;
    if ((status === 'R' || status === 'C') && fields.length >= 3) {
      changes.push({
        status,
        previousPath: normalizePath(fields[1]),
        path: normalizePath(fields[2]),
      });
    } else if (fields[1]) {
      changes.push({ status, path: normalizePath(fields[1]) });
    }
  }
  return changes;
}

export function mergeBaseFromGit(root: string, base: string, head: string): string {
  return execFileSync('git', ['merge-base', base, head], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

export function changedFilesFromGit(root: string, base: string, head: string): ChangedFile[] {
  const mergeBase = mergeBaseFromGit(root, base, head);
  const output = execFileSync(
    'git',
    ['diff', '--name-status', '-M', '-C', '--find-copies-harder', mergeBase, head],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  return parseNameStatus(output);
}

function listWorkingTreeSourceFiles(root: string): string[] {
  const ignored = new Set(['.git', '.expo', '.artifacts', 'node_modules', 'Pods', 'build', 'dist']);
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (ignored.has(entry)) continue;
      const absolute = join(directory, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) walk(absolute);
      else if (sourceExtensions.includes(extname(entry)))
        files.push(normalizePath(relative(root, absolute)));
    }
  };
  walk(root);
  return files.sort();
}

function resolveImportPaths(
  fromPath: string,
  specifier: string,
  knownFiles: Set<string>,
): string[] {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return [];
  const base = specifier.startsWith('@/')
    ? specifier.slice(2)
    : posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  const platformSuffixes = ['.ios', '.android', '.web', '.native'];
  const candidates = [
    base,
    ...platformSuffixes.flatMap((suffix) =>
      sourceExtensions.map((extension) => `${base}${suffix}${extension}`),
    ),
    ...sourceExtensions.map((extension) => `${base}${extension}`),
    ...platformSuffixes.flatMap((suffix) =>
      sourceExtensions.map((extension) => `${base}/index${suffix}${extension}`),
    ),
    ...sourceExtensions.map((extension) => `${base}/index${extension}`),
  ].map(normalizePath);
  return [...new Set(candidates.filter((candidate) => knownFiles.has(candidate)))];
}

function resolveImportPath(
  fromPath: string,
  specifier: string,
  knownFiles: Set<string>,
): string | null {
  return resolveImportPaths(fromPath, specifier, knownFiles)[0] ?? null;
}

function createReverseGraph(files: Map<string, string>): ImportGraph {
  const knownFiles = new Set(files.keys());
  const reverseGraph: ImportGraph = new Map();

  for (const [path, content] of files) {
    const imports = ts.preProcessFile(content, true, true).importedFiles;
    for (const imported of imports) {
      for (const resolvedImport of resolveImportPaths(path, imported.fileName, knownFiles)) {
        const consumers = reverseGraph.get(resolvedImport) ?? new Set<string>();
        consumers.add(path);
        reverseGraph.set(resolvedImport, consumers);
      }
    }
  }
  return reverseGraph;
}

export function buildWorkingTreeGraph(root: string): ImportGraph {
  const files = new Map<string, string>();
  for (const path of listWorkingTreeSourceFiles(root)) {
    files.set(path, readFileSync(join(root, path), 'utf8'));
  }
  return createReverseGraph(files);
}

export function validateFeatureBoundaries(root: string, manifest: TestImpactManifest): string[] {
  const sourceFiles = listWorkingTreeSourceFiles(root).filter(
    (path) => path.startsWith('features/') && !/\.(test|spec)\.[jt]sx?$/.test(path),
  );
  const knownFiles = new Set(listWorkingTreeSourceFiles(root));
  const allowedLegacyPairs = new Set(
    manifest.allowedDependencyCycles.map((pair) => [...pair].sort().join('>')),
  );
  const errors: string[] = [];

  for (const path of sourceFiles) {
    const fromOwners = featureOwnersForPath(manifest, path);
    if (fromOwners.length !== 1) continue;
    const fromFeature = fromOwners[0];
    const content = readFileSync(join(root, path), 'utf8');
    const imports = ts.preProcessFile(content, true, true).importedFiles;

    for (const imported of imports) {
      const resolvedImport = resolveImportPath(path, imported.fileName, knownFiles);
      if (!resolvedImport) continue;
      const toOwners = featureOwnersForPath(manifest, resolvedImport);
      if (toOwners.length !== 1 || toOwners[0] === fromFeature) continue;
      const toFeature = toOwners[0];
      const declared = manifest.features[fromFeature]?.dependsOn.includes(toFeature);
      const legacyException = allowedLegacyPairs.has([fromFeature, toFeature].sort().join('>'));
      if (!declared && !legacyException) {
        errors.push(
          `${path} imports ${resolvedImport}, but ${fromFeature} does not declare dependency ${toFeature}`,
        );
      }
    }
  }

  return [...new Set(errors)].sort();
}

export function buildGitRefGraph(root: string, ref: string): ImportGraph {
  const output = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const paths = output
    .split('\n')
    .filter((path) => path && sourceExtensions.includes(extname(path)));
  const files = new Map<string, string>();

  for (const path of paths) {
    try {
      files.set(
        normalizePath(path),
        execFileSync('git', ['show', `${ref}:${path}`], {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 5 * 1024 * 1024,
        }),
      );
    } catch {
      // A single unreadable historical source is handled conservatively by path ownership.
    }
  }
  return createReverseGraph(files);
}

function featureOwnersForPath(manifest: TestImpactManifest, path: string): string[] {
  return Object.entries(manifest.features)
    .filter(([, feature]) => matchesAny(path, feature.sourcePaths))
    .map(([featureId]) => featureId);
}

function reverseImportFeatures(
  manifest: TestImpactManifest,
  paths: string[],
  graphs: ImportGraph[],
): Set<string> {
  const affected = new Set<string>();
  const queue = [...paths];
  const visited = new Set(queue);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const graph of graphs) {
      for (const consumer of graph.get(current) ?? []) {
        for (const owner of featureOwnersForPath(manifest, consumer)) affected.add(owner);
        if (!visited.has(consumer)) {
          visited.add(consumer);
          queue.push(consumer);
        }
      }
    }
  }
  return affected;
}

function addReverseFeatureDependencies(
  manifest: TestImpactManifest,
  affectedFeatures: Set<string>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [featureId, feature] of Object.entries(manifest.features)) {
      if (affectedFeatures.has(featureId)) continue;
      if (feature.dependsOn.some((dependency) => affectedFeatures.has(dependency))) {
        affectedFeatures.add(featureId);
        changed = true;
      }
    }
  }
}

export function resolveImpact(
  manifest: TestImpactManifest,
  changedFiles: ChangedFile[],
  graphs: ImportGraph[] = [],
  options: { forceFull?: boolean; validationErrors?: string[] } = {},
): ImpactResult {
  const allPaths = changedFiles.flatMap((change) =>
    change.previousPath ? [change.previousPath, change.path] : [change.path],
  );
  const validationErrors = options.validationErrors ?? validateManifest(manifest);
  const fallbackReasons: string[] = [];
  const reasons: string[] = [];
  const sharedRuleIds = new Set<string>();
  const platforms = new Set<string>();
  const directFeatures = new Set<string>();
  const affectedFeatures = new Set<string>();
  const directlyMatchedSuites = new Set<string>();
  let matchedCompleteMatrixRule = false;

  if (options.forceFull) fallbackReasons.push('full execution was explicitly requested');
  if (validationErrors.length > 0) {
    fallbackReasons.push(`manifest validation failed: ${validationErrors.join('; ')}`);
  }
  if (changedFiles.length > manifest.maxChangedFiles) {
    fallbackReasons.push(
      `change count ${changedFiles.length} exceeds limit ${manifest.maxChangedFiles}`,
    );
  }
  if (allPaths.some((path) => matchesAny(path, manifest.fullFallbackPaths))) {
    fallbackReasons.push(
      'a test-impact, workflow, lockfile, native configuration, or tooling file changed',
    );
  }

  const documentationOnly =
    allPaths.length > 0 && allPaths.every((path) => matchesAny(path, manifest.documentationPaths));

  for (const path of allPaths) {
    for (const featureId of featureOwnersForPath(manifest, path)) {
      directFeatures.add(featureId);
      affectedFeatures.add(featureId);
    }
    for (const [suiteId, suite] of Object.entries(manifest.suites)) {
      if (!suite.specs.includes(path)) continue;
      if (suite.ci) directlyMatchedSuites.add(suiteId);
      for (const [featureId, feature] of Object.entries(manifest.features)) {
        if ([...feature.webSuites, ...feature.detoxSuites].includes(suiteId)) {
          directFeatures.add(featureId);
          affectedFeatures.add(featureId);
        }
      }
    }
    for (const rule of manifest.sharedRules) {
      if (!matchesAny(path, rule.paths)) continue;
      sharedRuleIds.add(rule.id);
      for (const platform of rule.platforms ?? []) platforms.add(platform);
      if (rule.impact === 'all') {
        matchedCompleteMatrixRule = true;
        for (const featureId of Object.keys(manifest.features)) affectedFeatures.add(featureId);
        reasons.push(`${path} matched global shared rule ${rule.id}`);
      }
    }
  }

  const reverseFeatures = reverseImportFeatures(manifest, allPaths, graphs);
  for (const featureId of reverseFeatures) affectedFeatures.add(featureId);
  if (reverseFeatures.size > 0) {
    reasons.push(`reverse import consumers: ${[...reverseFeatures].sort().join(', ')}`);
  }
  addReverseFeatureDependencies(manifest, affectedFeatures);

  const unmappedRuntimePaths = allPaths.filter(
    (path) =>
      matchesAny(path, manifest.runtimePaths) &&
      !matchesAny(path, manifest.documentationPaths) &&
      featureOwnersForPath(manifest, path).length === 0 &&
      !manifest.sharedRules.some((rule) => matchesAny(path, rule.paths)) &&
      !matchesAny(path, manifest.fullFallbackPaths) &&
      !Object.values(manifest.suites).some((suite) => suite.specs.includes(path)),
  );
  if (unmappedRuntimePaths.length > 0) {
    fallbackReasons.push(`unmapped runtime paths: ${unmappedRuntimePaths.join(', ')}`);
  }

  if (
    documentationOnly &&
    fallbackReasons.length === 0 &&
    directFeatures.size === 0 &&
    directlyMatchedSuites.size === 0 &&
    sharedRuleIds.size === 0
  ) {
    return {
      schemaVersion: 1,
      mode: 'documentation-only',
      confidence: 'high',
      changedFiles,
      directFeatures: [],
      affectedFeatures: [],
      selectedSuites: [],
      webSuites: [],
      detoxIosSuites: [],
      detoxAndroidSuites: [],
      unitTestPatterns: [],
      sharedRules: [...sharedRuleIds].sort(),
      platforms: [...platforms].sort(),
      reasons: ['all changed paths are documentation-only'],
      fallbackReasons: [],
      unmappedRuntimePaths: [],
    };
  }

  if (fallbackReasons.length > 0) {
    for (const featureId of Object.keys(manifest.features)) affectedFeatures.add(featureId);
  }

  const selectedSuites = new Set<string>();
  const unitTestPatterns = new Set<string>();
  const completeMatrixRequired = fallbackReasons.length > 0 || matchedCompleteMatrixRule;
  if (completeMatrixRequired) {
    for (const [suiteId, suite] of Object.entries(manifest.suites)) {
      if (suite.ci) selectedSuites.add(suiteId);
    }
  }
  for (const suiteId of directlyMatchedSuites) selectedSuites.add(suiteId);
  for (const featureId of affectedFeatures) {
    const feature = manifest.features[featureId];
    if (!feature) continue;
    for (const pattern of feature.unitTests) unitTestPatterns.add(pattern);
    for (const suiteId of [...feature.webSuites, ...feature.detoxSuites]) {
      if (manifest.suites[suiteId]?.ci) selectedSuites.add(suiteId);
    }
  }

  const hasSelectedWeb = [...selectedSuites].some((suiteId) =>
    manifest.suites[suiteId]?.runner.startsWith('playwright'),
  );
  const hasSelectedDetox = [...selectedSuites].some(
    (suiteId) => manifest.suites[suiteId]?.runner === 'detox',
  );
  for (const suiteId of manifest.criticalSuites) {
    const suite = manifest.suites[suiteId];
    if (!suite?.ci) continue;
    if (suite.runner === 'detox' && hasSelectedDetox) selectedSuites.add(suiteId);
    if (suite.runner.startsWith('playwright') && hasSelectedWeb) selectedSuites.add(suiteId);
  }

  const webSuites = [...selectedSuites].filter((suiteId) =>
    manifest.suites[suiteId]?.runner.startsWith('playwright'),
  );
  const detoxIosSuites = [...selectedSuites].filter(
    (suiteId) =>
      manifest.suites[suiteId]?.runner === 'detox' &&
      manifest.suites[suiteId]?.platforms?.includes('ios'),
  );
  const detoxAndroidSuites = [...selectedSuites].filter(
    (suiteId) =>
      manifest.suites[suiteId]?.runner === 'detox' &&
      manifest.suites[suiteId]?.platforms?.includes('android'),
  );

  return {
    schemaVersion: 1,
    mode: fallbackReasons.length > 0 ? 'full-fallback' : 'selective',
    confidence: fallbackReasons.length > 0 ? 'fallback' : 'high',
    changedFiles,
    directFeatures: [...directFeatures].sort(),
    affectedFeatures: [...affectedFeatures].sort(),
    selectedSuites: [...selectedSuites].sort(),
    webSuites: webSuites.sort(),
    detoxIosSuites: detoxIosSuites.sort(),
    detoxAndroidSuites: detoxAndroidSuites.sort(),
    unitTestPatterns: [...unitTestPatterns].sort(),
    sharedRules: [...sharedRuleIds].sort(),
    platforms: [...platforms].sort(),
    reasons,
    fallbackReasons,
    unmappedRuntimePaths,
  };
}

export function discoverRegisteredTestFiles(root: string): string[] {
  const directory = 'e2e';
  const files = new Set<string>();
  const absolute = resolve(root, directory);
  if (!existsSync(absolute)) return [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const entryPath = join(current, entry);
      if (statSync(entryPath).isDirectory()) {
        walk(entryPath);
        continue;
      }
      const path = normalizePath(relative(root, entryPath));
      if (/\.(e2e\.test\.js|spec\.ts)$/.test(path)) {
        files.add(path);
      }
    }
  };
  walk(absolute);
  return [...files].sort();
}

export function formatImpactMarkdown(result: ImpactResult): string {
  const list = (values: string[]) =>
    values.length > 0 ? values.map((v) => `\`${v}\``).join(', ') : 'None';
  return [
    '# Selective test impact',
    '',
    `- Mode: **${result.mode}**`,
    `- Confidence: **${result.confidence}**`,
    `- Direct features: ${list(result.directFeatures)}`,
    `- Affected features: ${list(result.affectedFeatures)}`,
    `- Web suites: ${list(result.webSuites)}`,
    `- Detox iOS suites: ${list(result.detoxIosSuites)}`,
    `- Detox Android suites: ${list(result.detoxAndroidSuites)}`,
    `- Shared rules: ${list(result.sharedRules)}`,
    `- Fallback reasons: ${result.fallbackReasons.length ? result.fallbackReasons.join('; ') : 'None'}`,
    `- Unmapped runtime paths: ${list(result.unmappedRuntimePaths)}`,
    '',
  ].join('\n');
}

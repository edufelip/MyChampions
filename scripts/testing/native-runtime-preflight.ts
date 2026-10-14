import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

function insideMetroRoot(serverRoot: string, target: string) {
  const relative = path.relative(serverRoot, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function inspectNativeAndroidAutolinking(repositoryRoot: string, serverRoot: string) {
  const root = realpathSync(repositoryRoot);
  const metroRoot = realpathSync(serverRoot);
  const file = path.join(root, 'android/build/generated/autolinking/autolinking.json');
  if (!existsSync(file)) {
    try {
      lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { status: 'absent' as const, path: file };
      throw error;
    }
    throw new Error('Native Android cached autolinking is a dangling link');
  }
  if (!lstatSync(file).isFile() || realpathSync(file) !== file)
    throw new Error('Native Android cached autolinking must be a project-local regular file');
  const bytes = readFileSync(file);
  const value = JSON.parse(bytes.toString('utf8')) as {
    root: string;
    reactNativePath: string;
    dependencies: Record<string, { root: string }>;
  };
  if (
    !value ||
    typeof value !== 'object' ||
    !value.dependencies ||
    typeof value.dependencies !== 'object' ||
    Array.isArray(value.dependencies) ||
    !path.isAbsolute(value.root) ||
    realpathSync(value.root) !== root
  )
    throw new Error('Native Android cached autolinking has invalid project identity');
  const roots = [value.reactNativePath, ...Object.values(value.dependencies).map((d) => d.root)];
  for (const dependency of roots) {
    if (
      typeof dependency !== 'string' ||
      !path.isAbsolute(dependency) ||
      !insideMetroRoot(metroRoot, realpathSync(dependency)) ||
      !statSync(dependency).isDirectory()
    )
      throw new Error('Native Android cached autolinking dependency escapes its Metro server root');
  }
  return {
    status: 'contained' as const,
    path: file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    dependencyCount: roots.length,
  };
}

export function requireNativeMetroEntryPaths(input: {
  repositoryRoot: string;
  serverRoot: string;
  entry: string;
}) {
  for (const value of Object.values(input))
    if (!path.isAbsolute(value)) throw new Error('Native Metro entry path must be absolute');
  const repositoryRoot = realpathSync(input.repositoryRoot);
  const serverRoot = realpathSync(input.serverRoot);
  const entry = realpathSync(input.entry);
  if (!statSync(repositoryRoot).isDirectory() || !statSync(serverRoot).isDirectory())
    throw new Error('Native Metro project/server root must be directories');
  if (
    !insideMetroRoot(serverRoot, repositoryRoot) ||
    !insideMetroRoot(serverRoot, entry) ||
    !statSync(entry).isFile()
  )
    throw new Error('Native Metro entry escapes its server root or is not a regular file');
  return {
    repositoryRoot,
    serverRoot,
    entry,
    entryHash: createHash('sha256').update(readFileSync(entry)).digest('hex'),
  };
}

export function inspectNativeMetroEntry(repositoryRoot: string, platform: 'ios' | 'android') {
  if (platform !== 'ios' && platform !== 'android')
    throw new Error('Invalid native Metro entry platform');
  const root = realpathSync(repositoryRoot);
  const requireProject = createRequire(path.join(root, 'package.json'));
  const paths = requireProject('@expo/config/paths') as {
    getMetroServerRoot(root: string): string;
    resolveEntryPoint(root: string, options: { platform: string }): string;
  };
  const entry = requireNativeMetroEntryPaths({
    repositoryRoot: root,
    serverRoot: paths.getMetroServerRoot(root),
    entry: paths.resolveEntryPoint(root, { platform }),
  });
  return {
    platform,
    ...entry,
    ...(platform === 'android'
      ? { androidAutolinking: inspectNativeAndroidAutolinking(root, entry.serverRoot) }
      : {}),
  };
}

export type AppleNativeModule = {
  packageName: string;
  pods: { podName: string }[];
  modules: string[];
};

export type NativeExecutionDeadlines = { buildMs: number; stepMs: number; wholeRunMs: number };
const executionCaps: NativeExecutionDeadlines = {
  buildMs: 900_000,
  stepMs: 600_000,
  wholeRunMs: 2_400_000,
};

/** Public overrides may shorten the existing protocol bounds, never extend them. */
export function nativeExecutionDeadlines(input: Partial<NativeExecutionDeadlines> = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(executionCaps, key))
  )
    throw new Error('Invalid native execution deadlines');
  const result = { ...executionCaps, ...input };
  for (const key of Object.keys(executionCaps) as (keyof NativeExecutionDeadlines)[])
    if (
      !Number.isSafeInteger(result[key]) ||
      result[key] < 1000 ||
      result[key] > executionCaps[key]
    )
      throw new Error('Invalid native execution deadlines');
  return result;
}

export function parseNativeExecutionDeadlines(env: Record<string, string | undefined>) {
  const fields = {
    buildMs: 'MYCHAMPIONS_NATIVE_BUILD_DEADLINE_MS',
    stepMs: 'MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS',
    wholeRunMs: 'MYCHAMPIONS_NATIVE_WHOLE_DEADLINE_MS',
  } as const;
  const result: Partial<NativeExecutionDeadlines> = {};
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const value = env[fields[key]];
    if (value !== undefined) {
      if (!/^[1-9][0-9]{3,6}$/.test(value)) throw new Error('Invalid native execution deadlines');
      result[key] = Number(value);
    }
  }
  return nativeExecutionDeadlines(result);
}

export function nativeCommandDeadline(
  declaredMs: number,
  phase: 'build' | 'step',
  deadlines: NativeExecutionDeadlines,
) {
  const resolved = nativeExecutionDeadlines(deadlines);
  if (
    !['build', 'step'].includes(phase) ||
    !Number.isSafeInteger(declaredMs) ||
    declaredMs < 100 ||
    declaredMs > executionCaps[phase === 'build' ? 'buildMs' : 'stepMs']
  )
    throw new Error('Invalid native command deadline');
  return Math.min(declaredMs, resolved[phase === 'build' ? 'buildMs' : 'stepMs']);
}

export class NativeExecutionDeadlineError extends Error {
  constructor(
    readonly step: string,
    readonly deadlineMs: number,
  ) {
    super('Native execution deadline exceeded');
    this.name = 'NativeExecutionDeadlineError';
  }
}

/** Owned backend must outlive the declared build/UI steps, within its protocol cap. */
export function nativeObservationBudget(
  input = {
    buildMs: 900_000,
    observationMs: 900_000,
    cleanupMs: 300_000,
  },
) {
  const values = [input.buildMs, input.observationMs, input.cleanupMs];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1000))
    throw new Error('Invalid native observation step budget');
  const totalMs = values.reduce((sum, value) => sum + value, 0);
  if (totalMs > 3_600_000)
    throw new Error('Native observation budget exceeds session protocol cap');
  return { ...input, totalMs };
}

/** Packaging check, not session behavior: resolve JS modules before building. */
export function assertIosNativeModuleRegistration(input: {
  resolved: { modules: AppleNativeModule[] };
  lock: string;
  installed: string;
  provider: string;
}) {
  if (input.lock !== input.installed)
    throw new Error('Installed Pods do not match Podfile.lock; run the normal pod install');
  if (!Array.isArray(input.resolved.modules) || !input.resolved.modules.length)
    throw new Error('Native Expo module resolution unavailable');
  const linked = new Set(
    [
      ...input.lock.split('\nDEPENDENCIES:')[0].matchAll(/^  - ([A-Za-z0-9_-]+)(?:\/[^ ]+)? \(/gm),
    ].map((match) => match[1]),
  );
  for (const module of input.resolved.modules) {
    if (!module.packageName || !Array.isArray(module.pods) || !Array.isArray(module.modules))
      throw new Error('Invalid native Expo module descriptor');
    for (const pod of module.pods)
      if (!linked.has(pod.podName))
        throw new Error(`Native pod ${pod.podName} for ${module.packageName} is not installed`);
    for (const name of module.modules) {
      if (!/^[A-Za-z0-9_.]+$/.test(name)) throw new Error('Invalid native module class');
      const escaped = name.replaceAll('.', '\\.');
      if (!new RegExp(`\\b${escaped}\\.self\\b`).test(input.provider))
        throw new Error(`Native class ${name} is not registered in ExpoModulesProvider`);
    }
  }
}

/** Fatal bootstrap diagnostics cannot be waived by selectors behind LogBox. */
export function assertNativeBootstrapHealthy(diagnostics: string) {
  const clean = diagnostics.replace(/\u001b\[[0-9;]*m/g, '');
  if (
    /Cannot find native module|Unable to resolve module|Invariant Violation|requireNativeComponent:.*not found/i.test(
      clean,
    )
  )
    throw new Error('Native bootstrap dependency/runtime error; retain private diagnostics');
}

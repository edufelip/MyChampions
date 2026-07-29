import { basename, join } from 'node:path';
import {
  DETOX_FIXTURE_PROFILES,
  clearedSelectiveFixtureEnvironment,
  isDetoxFixtureProfileId,
  validateDetoxFixtureProfile,
  type Environment,
} from './detox-fixture-profiles';
import type { SuiteConfig, TestImpactManifest } from './test-impact';

export type SelectivePlatform = 'web' | 'ios' | 'android';

export type CommandInvocation = {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  requiredEnv?: string[];
  metro?: {
    port: number;
  };
};

export type NativeBuildDescriptor = {
  configuration: 'ios.sim.debug' | 'android.emu.debug';
  owner: 'executor' | 'workflow';
  command: CommandInvocation;
};

export type SelectiveExecutionPlan = {
  schemaVersion: 1;
  platform: SelectivePlatform;
  selectedSuites: string[];
  nativeBuild?: NativeBuildDescriptor;
  invocations: CommandInvocation[];
};

export type SelectiveExecutionOptions = {
  skipNativeBuild?: boolean;
  diagnosticsRoot?: string;
};

const supportedWebRunners = new Set(['playwright', 'playwright-server']);

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function baseExecutionEnvironment(): Record<string, string> {
  return {
    ...clearedSelectiveFixtureEnvironment(),
    APP_VARIANT: 'dev',
    CI: '1',
    EXPO_PUBLIC_ENV: 'dev',
  };
}

function mergeEnvironment(...values: Array<Environment | undefined>): Record<string, string> {
  return Object.assign({}, ...values.filter(Boolean));
}

function validateSelectedSuite(
  manifest: TestImpactManifest,
  suiteId: string,
  platform: SelectivePlatform
): string[] {
  const suite = manifest.suites[suiteId];
  if (!suite) return [`unknown selected suite ${suiteId}`];

  const errors: string[] = [];
  if (!suite.ci) errors.push(`selected suite ${suiteId} is not eligible for selective CI`);

  if (platform === 'web') {
    if (!supportedWebRunners.has(suite.runner)) {
      errors.push(`selected suite ${suiteId} cannot run on web runner ${suite.runner}`);
    }
    if (!suite.grep) errors.push(`selected web suite ${suiteId} has no grep`);
    if (!suite.projects?.length) errors.push(`selected web suite ${suiteId} has no projects`);
    return errors;
  }

  if (suite.runner !== 'detox') {
    errors.push(`selected suite ${suiteId} cannot run on ${platform} runner ${suite.runner}`);
    return errors;
  }
  if (!suite.platforms?.includes(platform)) {
    errors.push(`selected suite ${suiteId} does not support ${platform}`);
  }
  errors.push(...validateDetoxFixtureProfile(suiteId, suite));
  return errors;
}

export function validateSelectiveExecutionManifest(manifest: TestImpactManifest): string[] {
  const errors: string[] = [];
  const referencedProfiles = new Set<string>();

  for (const [suiteId, suite] of Object.entries(manifest.suites)) {
    if (suite.runner === 'detox') {
      if (suite.fixtureProfile) referencedProfiles.add(suite.fixtureProfile);
      errors.push(...validateDetoxFixtureProfile(suiteId, suite));
      if (suite.ci && !suite.platforms?.length) {
        errors.push(`CI Detox suite ${suiteId} has no platforms`);
      }
      continue;
    }

    if (suite.ci && supportedWebRunners.has(suite.runner)) {
      if (!suite.grep) errors.push(`CI web suite ${suiteId} has no grep`);
      if (!suite.projects?.length) errors.push(`CI web suite ${suiteId} has no projects`);
    }
  }

  for (const profileId of Object.keys(DETOX_FIXTURE_PROFILES)) {
    if (!referencedProfiles.has(profileId)) {
      errors.push(`Detox fixture profile ${profileId} is not referenced by a suite`);
    }
  }
  return uniqueSorted(errors);
}

function validateSelection(
  manifest: TestImpactManifest,
  platform: SelectivePlatform,
  selectedSuites: string[]
): void {
  const errors = validateSelectiveExecutionManifest(manifest);
  if (selectedSuites.length === 0) errors.push(`no suites selected for ${platform}`);
  for (const duplicate of duplicateValues(selectedSuites)) {
    errors.push(`selected suite ${duplicate} appears more than once`);
  }
  for (const suiteId of selectedSuites) {
    errors.push(...validateSelectedSuite(manifest, suiteId, platform));
  }
  if (errors.length > 0) {
    throw new Error(`selective execution validation failed:\n${uniqueSorted(errors).join('\n')}`);
  }
}

type WebGroup = {
  runner: 'playwright' | 'playwright-server';
  project: string;
  specs: Set<string>;
  greps: Set<string>;
  suites: Set<string>;
};

function createWebPlan(
  manifest: TestImpactManifest,
  selectedSuites: string[],
  diagnosticsRoot: string
): SelectiveExecutionPlan {
  const groups = new Map<string, WebGroup>();

  for (const suiteId of selectedSuites) {
    const suite = manifest.suites[suiteId]!;
    const runner = suite.runner as WebGroup['runner'];
    for (const project of suite.projects ?? []) {
      const key = `${runner}:${project}`;
      const group =
        groups.get(key) ??
        {
          runner,
          project,
          specs: new Set<string>(),
          greps: new Set<string>(),
          suites: new Set<string>(),
        };
      for (const spec of suite.specs) group.specs.add(spec);
      if (suite.grep) group.greps.add(suite.grep);
      group.suites.add(suiteId);
      groups.set(key, group);
    }
  }

  const invocations = [...groups.values()]
    .sort((left, right) =>
      `${left.runner}:${left.project}`.localeCompare(`${right.runner}:${right.project}`)
    )
    .map((group): CommandInvocation => {
      const id = `${group.runner}-${group.project}`;
      const config =
        group.runner === 'playwright-server'
          ? 'playwright.server.config.ts'
          : 'playwright.config.ts';
      const grep = [...group.greps]
        .sort()
        .map((value) => `(?:${value})`)
        .join('|');
      return {
        id,
        command: 'yarn',
        args: [
          'playwright',
          'test',
          `--config=${config}`,
          ...uniqueSorted(group.specs),
          '--grep',
          grep,
          `--project=${group.project}`,
        ],
        env: {
          ...baseExecutionEnvironment(),
          WEB_E2E_ARTIFACT_ROOT: join(diagnosticsRoot, 'web', safeSegment(id)),
        },
        requiredEnv:
          group.runner === 'playwright-server' ? ['MYCHAMPIONS_SERVER_ROOT'] : undefined,
      };
    });

  return {
    schemaVersion: 1,
    platform: 'web',
    selectedSuites: [...selectedSuites].sort(),
    invocations,
  };
}

function expandPhaseSpecs(suite: SuiteConfig, specs: '*' | readonly string[]): string[] {
  return specs === '*' ? [...suite.specs] : [...specs];
}

function createNativePlan(
  manifest: TestImpactManifest,
  platform: 'ios' | 'android',
  selectedSuites: string[],
  options: SelectiveExecutionOptions,
  diagnosticsRoot: string
): SelectiveExecutionPlan {
  const configuration = platform === 'ios' ? 'ios.sim.debug' : 'android.emu.debug';
  const buildCommand: CommandInvocation = {
    id: `build-${platform}-debug`,
    command: 'yarn',
    args: ['detox', 'build', '-c', configuration],
    env: baseExecutionEnvironment(),
  };
  const invocations: CommandInvocation[] = [];

  for (const suiteId of [...selectedSuites].sort()) {
    const suite = manifest.suites[suiteId]!;
    const profileId = suite.fixtureProfile!;
    if (!isDetoxFixtureProfileId(profileId)) {
      throw new Error(`unknown fixture profile ${profileId}`);
    }
    const profile = DETOX_FIXTURE_PROFILES[profileId];
    if (!profile.selectiveCi) {
      throw new Error(`fixture profile ${profileId} is not eligible for selective CI`);
    }

    for (const phase of profile.phases) {
      for (const spec of expandPhaseSpecs(suite, phase.specs)) {
        const specId = basename(spec).replace(/\.e2e\.test\.js$/, '');
        const id = `${safeSegment(suiteId)}-${safeSegment(phase.id)}-${safeSegment(specId)}`;
        invocations.push({
          id,
          command: 'yarn',
          args: [
            'detox',
            'test',
            '-c',
            configuration,
            '--headless',
            '--artifacts-location',
            join(diagnosticsRoot, platform, id),
            '--record-logs',
            'failing',
            '--take-screenshots',
            'failing',
            spec,
          ],
          env: {
            ...baseExecutionEnvironment(),
            ...mergeEnvironment(phase.appEnv, phase.runnerEnv),
            CI_REQUIRE_E2E_EXECUTION: 'true',
            DETOX_JEST_CONFIG: 'e2e/jest.config.js',
            DETOX_METRO_CLEAR_CACHE: 'true',
            DETOX_REQUIRE_FRESH_METRO: 'true',
            EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX: 'true',
          },
          metro: {
            port: 8081,
          },
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    platform,
    selectedSuites: [...selectedSuites].sort(),
    nativeBuild: {
      configuration,
      owner: options.skipNativeBuild ? 'workflow' : 'executor',
      command: buildCommand,
    },
    invocations,
  };
}

export function createSelectiveExecutionPlan(
  manifest: TestImpactManifest,
  platform: SelectivePlatform,
  selectedSuites: string[],
  options: SelectiveExecutionOptions = {}
): SelectiveExecutionPlan {
  validateSelection(manifest, platform, selectedSuites);
  const diagnosticsRoot = options.diagnosticsRoot ?? '.artifacts/ci-diagnostics';

  if (platform === 'web') {
    return createWebPlan(manifest, selectedSuites, diagnosticsRoot);
  }
  return createNativePlan(manifest, platform, selectedSuites, options, diagnosticsRoot);
}

export function parseSelectedSuitesJson(value: string | undefined): string[] {
  if (!value) throw new Error('SELECTED_SUITES_JSON is required');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `SELECTED_SUITES_JSON must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('SELECTED_SUITES_JSON must be a JSON array of suite IDs');
  }
  return parsed;
}

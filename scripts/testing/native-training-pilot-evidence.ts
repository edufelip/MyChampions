import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  androidSourceIdentity,
  inspectOwnedAndroidApk,
  resolveAndroidPilotToolchain,
} from './android-build-identity';
import { sourceIdentity, treeHash } from './native-build-identity';
import { nativeHierarchyHasAttribute } from './native-hierarchy';
import {
  canonicalNativeRepoRelativePath,
  nativeTrainingHelperPathsFromSource,
  requireNativePilotAssertions,
  requireNativeTrainingHelperDeclaration,
  selectNativePilotScenario,
} from './native-pilot-contract';
import { readNativeTrainingAttemptBinding } from './native-training-attempt-binding';
import {
  readNativeEvidence,
  nativeSavedTrainingFrameCheckpoints,
  validateAndroidTrainingRuntimeFrameFiles,
  validateAndroidSavedTrainingJourneyPreparation,
  validateAndroidSavedTrainingTitleEvidence,
  validateIosSavedTrainingJourneyPreparation,
  validateNativeRuntimeFrameFiles,
} from './native-view-evidence';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeTrainingJourneyInput } from './native-training-journey';
import type { ViewEvidence } from './native-view-evidence';
import type { ProxyObservation } from './owned-api-proxy';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export type NativeTrainingHelperInput = { path: string; sha256: string };

function canonicalRelativePath(value: unknown, label: string): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    `${label} is invalid`,
  );
  assert(!value.includes('\\') && !value.includes('\0'), `${label} is not canonical`);
  assert(!path.isAbsolute(value) && !/^[A-Za-z]:\//.test(value), `${label} is absolute`);
  assert(
    !value.split('/').some((segment) => segment === '.' || segment === '..'),
    `${label} escapes its root`,
  );
  assert(path.posix.normalize(value) === value, `${label} is not normalized`);
  return value;
}

function canonicalHelperPath(value: unknown): string {
  const relative = canonicalNativeRepoRelativePath(value, 'Runtime helper path');
  assert(
    relative === 'package.json' ||
      relative.startsWith('scripts/testing/') ||
      relative.startsWith('scripts/ci/') ||
      relative === '.maestro/flows/camera-denied-android.yaml',
    `Runtime helper path is outside the owned script roots: ${relative}`,
  );
  return relative;
}

function unique(paths: readonly string[], label: string): string[] {
  const normalized = paths.map((value) => canonicalRelativePath(value, label));
  assert.equal(new Set(normalized).size, normalized.length, `${label} contains duplicates`);
  return normalized;
}

/** Bind runtime helper rows to the source-generated declaration and producer ledger. */
export async function requireNativeTrainingHelperInputs(options: {
  repositoryRoot: string;
  platform: 'ios' | 'android';
  helpers: readonly NativeTrainingHelperInput[];
  ownerPaths: readonly string[] | undefined;
}): Promise<void> {
  const expectedHelpers = requireNativeTrainingHelperDeclaration(
    options.repositoryRoot,
    options.platform,
    options.ownerPaths,
  );
  const declaredHelpers = nativeTrainingHelperPathsFromSource(
    options.repositoryRoot,
    options.platform,
  );
  assert.deepEqual(declaredHelpers, expectedHelpers);
  assert.deepEqual(
    options.helpers.map((helper) => canonicalHelperPath(helper.path)),
    expectedHelpers,
    'Runtime helper list differs from the producer declaration',
  );
  const owners = new Set(unique(options.ownerPaths ?? [], 'Scenario owner paths'));
  for (const helper of options.helpers) {
    const relative = canonicalHelperPath(helper.path);
    assert(
      owners.has(relative),
      `Runtime helper is absent from generated owner paths: ${relative}`,
    );
    assert.match(helper.sha256, /^[a-f0-9]{64}$/, `Runtime helper hash is invalid: ${relative}`);
    const file = assertArtifactPath(options.repositoryRoot, relative);
    assert.equal(await realpath(file), file, `Runtime helper is not canonical: ${relative}`);
    assert.equal(hash(await readFile(file)), helper.sha256, `Runtime helper changed: ${relative}`);
  }
}
const recipes: Record<string, Partial<Record<'ui' | 'api' | 'sql', string[]>>> = {
  'NAT-training-normal-entry': {
    ui: ['coach-home', 'journey-library', 'journey-new'],
    api: ['transport-observations.private.json'],
  },
  'NAT-training-local-draft': { ui: ['journey-draft-preview'], sql: ['baseline', 'draft'] },
  'NAT-training-first-save': {
    ui: ['journey-first-save-reopened'],
    api: ['created-api', 'transport-observations.private.json'],
    sql: ['baseline', 'created'],
  },
  'NAT-training-edit-draft': {
    ui: [
      'journey-edit-title-keyboard',
      'journey-edit-title-paragraph-selection',
      'journey-edit-title-cleared',
      'journey-edit-title',
      'journey-edit-preview',
    ],
    sql: ['created', 'edited-draft'],
  },
  'NAT-training-edited-save': {
    ui: ['journey-edited-save-reopened'],
    api: ['edited-api', 'transport-observations.private.json'],
    sql: ['created', 'edited'],
  },
  'NAT-training-relaunch-read': {
    ui: ['journey-durable-reopened'],
    api: ['durable-api', 'transport-observations.private.json'],
    sql: ['edited', 'durable'],
  },
  'NAT-training-unrelated-state': { sql: ['baseline', 'created', 'edited', 'durable'] },
};
type Metadata = {
  input: NativeTrainingJourneyInput;
  requestedAttemptId?: string;
  selection?: {
    scenarioHash: string;
    requirementHash: string;
    arguments: NativePilotSelection['arguments'];
  };
};
type NativeTrainingScenarioDeclaration = NativePilotSelection['scenario'] & {
  ownerPaths?: string[];
};
type Capture = {
  kind: string;
  mode: string;
  platform: string;
  charter: string;
  result: string;
  cleanup: unknown;
  nativePassingCases: number;
  backend: { runId: string };
  source: Awaited<ReturnType<typeof sourceIdentity>>;
  sourceAfter: unknown;
  helperInputsBefore: { path: string; sha256: string }[];
  helperInputsAfter: unknown;
  build: { binaryPath: string; binaryHash: string };
  androidToolchain?: { sdkRoot: string; javaHome: string };
  commandExecutions: {
    label: string;
    execution: string;
    cleanup: string;
    childExitCode: number | null;
  }[];
  observations: { viewId: string; screenshotPath: string; hierarchyPath: string }[];
  trainingJourney: Metadata;
};
const json = (root: string, relative: string): unknown =>
  JSON.parse(readNativeEvidence(root, relative, true).toString());

/** A partial acquisition census cannot qualify a completed saved Android journey. */
export function requireFullAndroidTrainingCleanupEvidence(artifactRoot: string, value: unknown) {
  requireFullAndroidTrainingCleanup(artifactRoot, value, 'observed');
}
/** Full teardown of an assertion-failed attempt grants no successful journey evidence. */
export function requireFullAndroidTrainingFailureCleanupEvidence(
  artifactRoot: string,
  value: unknown,
) {
  requireFullAndroidTrainingCleanup(artifactRoot, value, 'harness-blocked');
}
function requireFullAndroidTrainingCleanup(
  artifactRoot: string,
  value: unknown,
  captureResult: 'observed' | 'harness-blocked',
) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const cleanup = value as Record<string, unknown>;
  assert.equal(cleanup.kind, 'independent android native cleanup proof');
  assert.equal(cleanup.runId, path.basename(artifactRoot));
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.captureResult, captureResult);
  assert.equal(cleanup.captureCleanupClean, true);
  assert.equal(cleanup.nativePassingCases, 0);
  assert.deepEqual(cleanup.acquisitions, ['adb', 'emulator', 'backend', 'proxy', 'expo']);
  assert(Number.isSafeInteger(cleanup.pidStartPairs) && Number(cleanup.pidStartPairs) > 0);
  for (const name of [
    'survivors',
    'unknownProcessQueries',
    'missingForeignDevices',
    'unavailablePorts',
  ])
    assert.deepEqual(cleanup[name], [], `Full Android cleanup lacks ${name} absence proof`);
  for (const name of [
    'ownedDeviceAbsent',
    'cacheAbsent',
    'defaultAdbPreserved',
    'foreignAvdsPreserved',
  ])
    assert.equal(cleanup[name], true, `Full Android cleanup lacks ${name} proof`);
  assert.equal(cleanup.deletedOwnedDirectories, 6);
  assert(cleanup.docker && typeof cleanup.docker === 'object' && !Array.isArray(cleanup.docker));
  assert.deepEqual(cleanup.docker, { container: [], network: [], volume: [] });
}

/** Re-read the exact existing compiler/source inputs, not arbitrary paths from a recorded identity. */
export async function requireAndroidTrainingReaderFreshness(options: {
  repositoryRoot: string;
  artifactRoot: string;
  sdkRoot: string;
  javaHome: string;
}) {
  const { repositoryRoot, artifactRoot, sdkRoot, javaHome } = options;
  const identity = json(artifactRoot, 'android-input-reader-identity.private.json') as {
    sources: { path: string; sha256: string }[];
  };
  const expected = [
    path.join(repositoryRoot, 'scripts/testing/android-input-reader/InputReader.java'),
    path.join(repositoryRoot, 'scripts/testing/android-input-reader/AndroidManifest.xml'),
    path.join(sdkRoot, 'platforms/android-36/android.jar'),
    ...['aapt2', 'd8', 'zipalign', 'apksigner'].map((name) =>
      path.join(sdkRoot, 'build-tools/36.0.0', name),
    ),
    ...['javac', 'jar', 'keytool'].map((name) => path.join(javaHome, 'bin', name)),
  ];
  for (const root of [repositoryRoot, sdkRoot, javaHome]) {
    assert.equal(await realpath(root), path.resolve(root));
    assert.equal(root, path.resolve(root));
    assert((await lstat(root)).isDirectory());
  }
  assert(Array.isArray(identity.sources));
  assert.deepEqual(
    identity.sources.map((row) => row.path),
    expected,
    'Reader source/tool paths differ',
  );
  for (const row of identity.sources) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await realpath(row.path), row.path);
    const info = await lstat(row.path);
    assert(info.isFile() && !info.isSymbolicLink());
    assert.equal(hash(await readFile(row.path)), row.sha256, 'Runtime reader source/tool changed');
  }
}

/** Exact captured bytes only. These rows deliberately do not claim visual review. */
export async function writeIosTrainingRuntimeFrames(artifactRoot: string) {
  return writeTrainingRuntimeFrames('ios', artifactRoot);
}
export async function writeAndroidTrainingRuntimeFrames(artifactRoot: string) {
  return writeTrainingRuntimeFrames('android', artifactRoot);
}
async function writeTrainingRuntimeFrames(platform: 'ios' | 'android', artifactRoot: string) {
  const capture = json(artifactRoot, 'capture.private.json') as Capture;
  assert.equal(capture.kind, 'private-owned-native-training-execution-not-public-receipt');
  assert.equal(capture.mode, 'integration');
  assert.equal(capture.platform, platform);
  assert.equal(capture.charter, 'training-journey');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  const rows: ViewEvidence[] = [];
  for (const { label, viewId } of nativeSavedTrainingFrameCheckpoints(platform)) {
    const screenshotPath = `${label}.png`;
    const hierarchyPath = `${label}-hierarchy.json`;
    assert.equal(
      capture.observations.filter(
        (row) =>
          row.viewId === viewId &&
          row.screenshotPath === screenshotPath &&
          row.hierarchyPath === hierarchyPath,
      ).length,
      1,
      'Runtime checkpoint was not captured exactly once',
    );
    const row: ViewEvidence = {
      viewId,
      screenshotPath,
      hierarchyPath,
      screenshotHash: hash(readNativeEvidence(artifactRoot, screenshotPath)),
      hierarchyHash: hash(readNativeEvidence(artifactRoot, hierarchyPath, true)),
      reviewed: false,
    };
    (platform === 'ios'
      ? validateNativeRuntimeFrameFiles
      : validateAndroidTrainingRuntimeFrameFiles)(artifactRoot, [row], [viewId]);
    rows.push(row);
  }
  await writeFile(
    assertArtifactPath(artifactRoot, 'training-journey-runtime-frames.private.json'),
    JSON.stringify(rows, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  return rows;
}

/** Emits verified data bindings only. It cannot create a public pass or qualify an engine/platform. */
export async function prepareIosTrainingPilotEvidence(options: {
  repositoryRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  purpose: 'diagnostic' | 'runtime';
  requestedRunId?: string;
}) {
  assert.equal(options.selection.arguments.platform, 'ios');
  return prepareTrainingPilotEvidence('ios', options);
}

/** Android runtime proof only: historical inventory cannot acquire a retroactive requested binding. */
export async function prepareAndroidTrainingPilotEvidence(options: {
  repositoryRoot: string;
  artifactRoot: string;
  selection: NativePilotSelection;
  purpose: 'runtime';
  requestedRunId: string;
}) {
  assert.equal(options.selection.arguments.platform, 'android');
  assert.equal(options.purpose, 'runtime');
  return prepareTrainingPilotEvidence('android', options);
}

async function prepareTrainingPilotEvidence(
  platform: 'ios' | 'android',
  options: {
    repositoryRoot: string;
    artifactRoot: string;
    selection: NativePilotSelection;
    purpose: 'diagnostic' | 'runtime';
    requestedRunId?: string;
  },
) {
  assert(options.purpose === 'diagnostic' || options.purpose === 'runtime');
  const { artifactRoot, selection, purpose } = options;
  const repositoryRoot = await realpath(options.repositoryRoot);
  const args = selection.arguments;
  assert(args.platform === platform && args.engine === 'maestro' && args.mode === 'integration');
  assert(platform === 'ios' || purpose === 'runtime');
  const platformRecipes = structuredClone(recipes);
  if (platform === 'android')
    platformRecipes['NAT-training-edit-draft'].ui![1] = 'journey-edit-title-selection-menu';
  assert.equal(selection.scenario.flowId, 'FLW-training');
  const current = await selectNativePilotScenario(
    args,
    JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ),
    repositoryRoot,
  );
  assert.deepEqual(selection, current, 'Training selection is stale or altered');
  const ledger = requireNativePilotAssertions(selection);
  assert.equal(ledger.length, Object.keys(recipes).length);
  for (const row of ledger) {
    assert(recipes[row.id], 'Training assertion has no execution evidence recipe');
    assert.deepEqual([...row.evidenceKinds].sort(), Object.keys(recipes[row.id]).sort());
  }
  const capture = json(artifactRoot, 'capture.private.json') as Capture;
  assert.equal(capture.platform, platform);
  assert.equal(capture.charter, 'training-journey');
  assert.equal(capture.result, 'observed');
  assert.equal(capture.cleanup, 'cleaned');
  assert.equal(capture.nativePassingCases, 0);
  assert.deepEqual(capture.sourceAfter, capture.source);
  assert.deepEqual(capture.helperInputsAfter, capture.helperInputsBefore);
  const cleanup = json(artifactRoot, 'external-cleanup.private.json') as {
    result: string;
    runId: string;
    pidStartPairs: number;
    survivors: unknown[];
    unknownProcessQueries: unknown[];
    missingForeignDevices: unknown[];
    ownedDeviceAbsent: boolean;
    cacheAbsent: boolean;
    docker: Record<string, unknown[]>;
  };
  if (platform === 'android') requireFullAndroidTrainingCleanupEvidence(artifactRoot, cleanup);
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.runId, path.basename(artifactRoot));
  assert(cleanup.pidStartPairs > 0);
  assert.deepEqual(cleanup.survivors, []);
  assert.deepEqual(cleanup.unknownProcessQueries, []);
  assert.deepEqual(cleanup.missingForeignDevices, []);
  assert.equal(cleanup.ownedDeviceAbsent, true);
  assert.equal(cleanup.cacheAbsent, true);
  for (const kind of ['container', 'network', 'volume']) assert.deepEqual(cleanup.docker[kind], []);
  let metadata: Metadata;
  if (purpose === 'runtime') {
    assert.match(options.requestedRunId ?? '', /^[a-f0-9]{24}$/, 'Runtime requested run is absent');
    assert.equal(capture.kind, 'private-owned-native-training-execution-not-public-receipt');
    assert.equal(capture.mode, 'integration');
    metadata = json(artifactRoot, 'training-runtime-metadata.private.json') as Metadata;
    const binding = readNativeTrainingAttemptBinding({
      artifactRoot,
      requestedRunId: options.requestedRunId!,
      backendRunId: capture.backend.runId,
      selection,
    });
    assert.equal(metadata.requestedAttemptId, binding.requestedAttemptId);
    assert.equal(metadata.input.runId, binding.backendRunId);
    assert.equal(metadata.input.attemptId, binding.backendAttemptId);
    assert.deepEqual(
      metadata.selection,
      {
        scenarioHash: selection.scenarioHash,
        requirementHash: selection.requirementHash,
        arguments: args,
      },
      'Runtime execution lacks exact selection binding',
    );
    assert(capture.commandExecutions.length > 0);
    assert.equal(
      new Set(capture.commandExecutions.map((row) => row.label)).size,
      capture.commandExecutions.length,
    );
    for (const row of capture.commandExecutions) {
      assert.equal(row.execution, 'completed');
      assert.equal(row.cleanup, 'cleaned');
      assert.equal(row.childExitCode, 0);
    }
    assert.deepEqual(
      await (platform === 'ios' ? sourceIdentity : androidSourceIdentity)(repositoryRoot),
      capture.source,
      'Runtime source is stale',
    );
    if (platform === 'ios') {
      assert.equal(
        await treeHash(capture.build.binaryPath),
        capture.build.binaryHash,
        'Runtime binary changed',
      );
    } else {
      const toolchain = await resolveAndroidPilotToolchain();
      assert.deepEqual(capture.androidToolchain, toolchain, 'Runtime Android toolchain changed');
      const build = await inspectOwnedAndroidApk({
        binaryPath: capture.build.binaryPath,
        artifactRoot,
        sdkRoot: toolchain.sdkRoot,
        apiOrigin: (capture.build as { apiOrigin?: string }).apiOrigin!,
        writeReceipt: false,
      });
      assert.equal(build.binaryHash, capture.build.binaryHash, 'Runtime binary changed');
      await requireAndroidTrainingReaderFreshness({ repositoryRoot, artifactRoot, ...toolchain });
    }
    assert(capture.helperInputsBefore.length > 0);
    assert.equal(
      new Set(capture.helperInputsBefore.map((helper) => helper.path)).size,
      capture.helperInputsBefore.length,
      'Runtime helper inputs are duplicated',
    );
    if (platform === 'android')
      for (const relative of [
        'run-android-training-attempt.ts',
        'native-training-attempt-outcome.ts',
        'native-training-public-evidence.ts',
        'verify-owned-android-cleanup.ts',
        'android-native-input-reader.ts',
        'android-input-reader/InputReader.java',
        'android-input-reader/AndroidManifest.xml',
      ])
        assert(
          capture.helperInputsBefore.some(
            (helper) => helper.path === `scripts/testing/${relative}`,
          ),
          'Android runtime helper identity is absent',
        );
    assert(
      capture.helperInputsBefore.some(
        (helper) => helper.path === 'scripts/testing/native-training-pilot-evidence.ts',
      ),
      'Runtime capture does not bind the assertion mapper',
    );
    assert(
      capture.helperInputsBefore.some(
        (helper) => helper.path === 'scripts/testing/native-training-attempt-binding.ts',
      ),
      'Runtime capture does not bind the attempt identity verifier',
    );
    const declaredScenario = selection.scenario as NativeTrainingScenarioDeclaration;
    await requireNativeTrainingHelperInputs({
      repositoryRoot,
      platform,
      helpers: capture.helperInputsBefore,
      ownerPaths: declaredScenario.ownerPaths,
    });
  } else {
    assert.equal(capture.kind, 'private-native-inventory-observation-not-behavior-attempt');
    assert.equal(capture.mode, 'inventory');
    metadata = capture.trainingJourney;
  }
  const transport = json(artifactRoot, 'transport-observations.private.json') as ProxyObservation[];
  if (platform === 'ios')
    validateIosSavedTrainingJourneyPreparation(
      artifactRoot,
      capture.backend.runId,
      metadata,
      capture.observations,
      transport,
      purpose === 'runtime' ? 'runtime-captured' : 'reviewed-inventory',
    );
  else
    validateAndroidSavedTrainingJourneyPreparation(
      artifactRoot,
      capture.backend.runId,
      metadata,
      capture.observations,
      transport,
    );
  const androidReaderReferences =
    platform === 'android'
      ? validateAndroidSavedTrainingTitleEvidence(
          artifactRoot,
          json(artifactRoot, 'journey-edit-title-cleared-hierarchy.json'),
        )
      : [];
  const normalSelectors = {
    'coach-home': 'pro.home.screen',
    'journey-library': 'pro.library.training.create',
    'journey-new': 'pro.training_plan.name',
  };
  for (const [label, id] of Object.entries(normalSelectors))
    assert(
      nativeHierarchyHasAttribute(
        json(artifactRoot, `${label}-hierarchy.json`),
        'resource-id',
        id,
      ) ||
        (platform === 'android' &&
          nativeHierarchyHasAttribute(
            json(artifactRoot, `${label}-hierarchy.json`),
            'resource-id',
            `com.edufelip.mychampions.dev:id/${id}`,
          )),
      'Normal native entry is not observed',
    );
  const sources = new Map<string, { path: string; sha256: string }>();
  for (const relative of androidReaderReferences)
    sources.set(relative, {
      path: relative,
      sha256: hash(readNativeEvidence(artifactRoot, relative, true)),
    });
  for (const recipe of Object.values(platformRecipes))
    for (const [kind, values] of Object.entries(recipe))
      for (const value of values) {
        const paths =
          kind === 'ui'
            ? [`${value}.png`, `${value}-hierarchy.json`]
            : [value.endsWith('.json') ? value : `training-journey-${value}.private.json`];
        for (const relative of paths) {
          const bytes = readNativeEvidence(artifactRoot, relative, !relative.endsWith('.png'));
          if (kind === 'ui') {
            const label = value;
            assert(
              capture.observations.some(
                (row) =>
                  row.screenshotPath === `${label}.png` &&
                  row.hierarchyPath === `${label}-hierarchy.json`,
              ),
              'UI evidence was not captured',
            );
            if (relative.endsWith('.png'))
              assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          }
          sources.set(relative, { path: relative, sha256: hash(bytes) });
        }
      }
  // All semantic/identity/cleanup checks precede output. A duplicate attempt cannot overwrite proof.
  const parent = assertArtifactPath(artifactRoot, 'assertions');
  await mkdir(parent, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  const parentInfo = await lstat(parent);
  assert.equal(await realpath(parent), parent);
  assert(parentInfo.isDirectory());
  assert.equal(parentInfo.mode & 0o777, 0o700);
  assert.equal(parentInfo.uid, process.getuid?.());
  const directory = assertArtifactPath(artifactRoot, `assertions/${metadata.input.attemptId}`);
  await mkdir(directory, { mode: 0o700 });
  const bindings = [];
  for (const row of ledger) {
    const evidencePaths = [];
    for (const [index, kind] of row.evidenceKinds.entries()) {
      const relative = row.evidencePathTemplates![index].replace(
        '{attemptId}',
        metadata.input.attemptId,
      );
      const references = platformRecipes[row.id]
        [kind]!.flatMap((value) =>
          kind === 'ui'
            ? [`${value}.png`, `${value}-hierarchy.json`]
            : [value.endsWith('.json') ? value : `training-journey-${value}.private.json`],
        )
        .map((value) => sources.get(value)!);
      if (row.id === 'NAT-training-edit-draft' && kind === 'ui')
        references.push(...androidReaderReferences.map((relative) => sources.get(relative)!));
      await writeFile(
        assertArtifactPath(artifactRoot, relative),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: 'native-training-assertion-evidence-preparation',
            purpose,
            assertionId: row.id,
            evidenceKind: kind,
            requirementRefs: row.requirementRefs,
            fixtureRunId: metadata.input.runId,
            attemptId: metadata.input.attemptId,
            scenarioHash: selection.scenarioHash,
            requirementHash: selection.requirementHash,
            references,
            nativePassingCases: 0,
            scope:
              'verified data binding only; public runtime receipt/finalization and engine qualification are separate',
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
      evidencePaths.push(relative);
    }
    bindings.push({ id: row.id, requirementRefs: row.requirementRefs, evidencePaths });
  }
  return {
    purpose,
    fixtureRunId: metadata.input.runId,
    attemptId: metadata.input.attemptId,
    bindings,
    nativePassingCases: 0,
    scope: 'prepared assertion evidence; no public outcome',
  };
}

export {
  canonicalNativeRepoRelativePath,
  nativeTrainingHelperPathsFromSource,
  requireNativeTrainingHelperDeclaration,
} from './native-pilot-contract';

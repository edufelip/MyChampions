import assert from 'node:assert/strict';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireNativePilotAssertions, selectNativePilotScenario } from './native-pilot-contract';
import { readNativeEvidence } from './native-view-evidence';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';

const runId = /^[a-f0-9]{24}$/;
export const trainingAttemptBindingPath = 'training-attempt-binding.private.json';
export type NativeTrainingAttemptBinding = {
  schemaVersion: 1;
  kind: 'private-native-training-attempt-binding-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string;
  backendAttemptId: string;
  scenarioId: string;
  selection: {
    scenarioHash: string;
    requirementHash: string;
    arguments: NativePilotSelection['arguments'];
  };
  fixtureScope: 'native-entry-ios' | 'native-entry-android';
  nativePassingCases: 0;
  scope: 'requested-to-capture-to-fixture identity only; execution and public finalization are separate';
};

export function requireNativeTrainingAttemptBinding(
  value: unknown,
  expected: {
    requestedRunId: string;
    captureRunId: string;
    backendRunId: string;
    selection: NativePilotSelection;
  },
): NativeTrainingAttemptBinding {
  const { requestedRunId, captureRunId, backendRunId, selection } = expected;
  for (const id of [requestedRunId, captureRunId, backendRunId]) assert.match(id, runId);
  assert.equal(new Set([requestedRunId, captureRunId, backendRunId]).size, 3);
  const platform = selection.arguments.platform;
  const engine = selection.arguments.engine;
  assert(platform === 'ios' || platform === 'android', 'Unsupported training binding platform');
  assert(engine === 'maestro' || engine === 'detox', 'Unsupported training binding engine');
  assert.deepEqual(selection.arguments, {
    platform,
    engine,
    scenario: `SCN-training-${platform}`,
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, `SCN-training-${platform}`);
  assert.equal(selection.scenario.platform, platform);
  assert.equal(selection.scenario.flowId, 'FLW-training');
  assert.equal(requireNativePilotAssertions(selection).length, 7);
  const record: NativeTrainingAttemptBinding = {
    schemaVersion: 1,
    kind: 'private-native-training-attempt-binding-not-public-receipt',
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    captureRunId,
    backendRunId,
    backendAttemptId: `${backendRunId}:first`,
    scenarioId: selection.scenario.id,
    selection: {
      scenarioHash: selection.scenarioHash,
      requirementHash: selection.requirementHash,
      arguments: selection.arguments,
    },
    fixtureScope: `native-entry-${platform}`,
    nativePassingCases: 0,
    scope:
      'requested-to-capture-to-fixture identity only; execution and public finalization are separate',
  };
  assert.deepEqual(value, record, 'Native requested/capture/fixture identity differs');
  return structuredClone(record);
}

export async function writeNativeTrainingAttemptBinding(options: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  backendRunId: string;
  selection: NativePilotSelection;
}): Promise<NativeTrainingAttemptBinding> {
  const repositoryRoot = await realpath(options.repositoryRoot);
  const artifactRoot = await realpath(options.artifactRoot);
  const stat = await lstat(artifactRoot);
  assert.equal(artifactRoot, path.resolve(options.artifactRoot));
  assert(stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o700);
  const current = await selectNativePilotScenario(
    options.selection.arguments,
    JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ),
    repositoryRoot,
  );
  assert.deepEqual(options.selection, current, 'Native binding selection is stale or altered');
  const expected = {
    requestedRunId: options.requestedRunId,
    captureRunId: path.basename(artifactRoot),
    backendRunId: options.backendRunId,
    selection: current,
  };
  const provisional = {
    schemaVersion: 1,
    kind: 'private-native-training-attempt-binding-not-public-receipt',
    requestedRunId: expected.requestedRunId,
    requestedAttemptId: `${expected.requestedRunId}:first`,
    captureRunId: expected.captureRunId,
    backendRunId: expected.backendRunId,
    backendAttemptId: `${expected.backendRunId}:first`,
    scenarioId: current.scenario.id,
    selection: {
      scenarioHash: current.scenarioHash,
      requirementHash: current.requirementHash,
      arguments: current.arguments,
    },
    fixtureScope: `native-entry-${current.arguments.platform}`,
    nativePassingCases: 0,
    scope:
      'requested-to-capture-to-fixture identity only; execution and public finalization are separate',
  } satisfies NativeTrainingAttemptBinding;
  const binding = requireNativeTrainingAttemptBinding(provisional, expected);
  await writeFile(
    assertArtifactPath(artifactRoot, trainingAttemptBindingPath),
    JSON.stringify(binding, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  return binding;
}

export function readNativeTrainingAttemptBinding(options: {
  artifactRoot: string;
  requestedRunId: string;
  backendRunId: string;
  selection: NativePilotSelection;
}): NativeTrainingAttemptBinding {
  const captureRunId = path.basename(options.artifactRoot);
  const value: unknown = JSON.parse(
    readNativeEvidence(options.artifactRoot, trainingAttemptBindingPath, true).toString(),
  );
  return requireNativeTrainingAttemptBinding(value, {
    requestedRunId: options.requestedRunId,
    captureRunId,
    backendRunId: options.backendRunId,
    selection: options.selection,
  });
}

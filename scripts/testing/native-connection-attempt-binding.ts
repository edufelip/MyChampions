import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  nativeConnectionAssertionIds,
  nativeConnectionAssertionSemanticSha256,
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from './native-pilot-contract';
import { readNativeEvidence } from './native-view-evidence';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';

const runIdPattern = /^[a-f0-9]{24}$/;
export const connectionAttemptBindingPath = 'connection-attempt-binding.private.json';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

export type NativeConnectionAttemptBinding = {
  schemaVersion: 1;
  kind: 'private-native-connection-attempt-binding-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string;
  backendAttemptId: string;
  fixtureScope: 'native-entry-ios' | 'native-entry-android';
  scenarioId: string;
  selection: {
    arguments: NativePilotSelection['arguments'];
    scenarioHash: string;
    requirementHash: string;
  };
  assertionIds: string[];
  assertionSemanticSha256: string;
  assertionContractSha256: string;
  nativePassingCases: 0;
};

type BindingIdentity = {
  requestedRunId: string;
  captureRunId: string;
  backendRunId: string;
  selection: NativePilotSelection;
};

function buildNativeConnectionAttemptBinding({
  requestedRunId,
  captureRunId,
  backendRunId,
  selection,
}: BindingIdentity): NativeConnectionAttemptBinding {
  for (const id of [requestedRunId, captureRunId, backendRunId])
    assert.match(id, runIdPattern, 'Connection binding identity must be a 24-character hex run ID');
  assert.equal(
    new Set([requestedRunId, captureRunId, backendRunId]).size,
    3,
    'Connection binding run identities must be distinct',
  );

  const platform = selection.arguments.platform;
  assert(platform === 'ios' || platform === 'android', 'Unsupported connection binding platform');
  assert.deepEqual(selection.arguments, {
    platform,
    engine: 'maestro',
    scenario: `SCN-connection-${platform}`,
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, selection.arguments.scenario);
  assert.equal(selection.scenario.platform, platform);
  assert.equal(selection.scenario.flowId, 'FLW-connection');
  assert.match(selection.scenarioHash, /^[a-f0-9]{64}$/);
  assert.equal(
    hash(selection.scenario),
    selection.scenarioHash,
    'Connection selection changed after fingerprinting',
  );
  assert.match(selection.requirementHash, /^[a-f0-9]{64}$/);

  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    [...nativeConnectionAssertionIds],
  );
  assert.equal(
    selection.scenario.pilotAssertionContract?.semanticSha256,
    nativeConnectionAssertionSemanticSha256,
    'Connection assertion semantic digest differs from the frozen contract',
  );

  return {
    schemaVersion: 1,
    kind: 'private-native-connection-attempt-binding-not-public-receipt',
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    captureRunId,
    backendRunId,
    backendAttemptId: `${backendRunId}:first`,
    fixtureScope: `native-entry-${platform}`,
    scenarioId: selection.scenario.id,
    selection: {
      arguments: selection.arguments,
      scenarioHash: selection.scenarioHash,
      requirementHash: selection.requirementHash,
    },
    assertionIds: [...nativeConnectionAssertionIds],
    assertionSemanticSha256: nativeConnectionAssertionSemanticSha256,
    assertionContractSha256: hash(rows),
    nativePassingCases: 0,
  };
}

export function requireNativeConnectionAttemptBinding(
  value: unknown,
  expected: BindingIdentity,
): NativeConnectionAttemptBinding {
  const binding = buildNativeConnectionAttemptBinding(expected);
  assert.deepEqual(value, binding, 'Connection requested/capture/backend/ledger binding differs');
  return structuredClone(binding);
}

export async function writeNativeConnectionAttemptBinding(options: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  backendRunId: string;
  selection: NativePilotSelection;
}): Promise<NativeConnectionAttemptBinding> {
  const repositoryRoot = await realpath(options.repositoryRoot);
  const artifactRoot = await realpath(options.artifactRoot);
  const details = await lstat(artifactRoot);
  assert.equal(artifactRoot, path.resolve(options.artifactRoot));
  assert(
    details.isDirectory() && details.uid === process.getuid?.() && (details.mode & 0o777) === 0o700,
    'Connection binding artifact root is not canonical, private and owned',
  );
  const current = await selectNativePilotScenario(
    options.selection.arguments,
    JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ),
    repositoryRoot,
  );
  assert.deepEqual(
    options.selection,
    current,
    'Connection selection is stale before first native action',
  );
  const expected = {
    requestedRunId: options.requestedRunId,
    captureRunId: path.basename(artifactRoot),
    backendRunId: options.backendRunId,
    selection: current,
  };
  const binding = requireNativeConnectionAttemptBinding(
    buildNativeConnectionAttemptBinding(expected),
    expected,
  );
  await writeFile(
    assertArtifactPath(artifactRoot, connectionAttemptBindingPath),
    JSON.stringify(binding, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return binding;
}

/**
 * Re-select the current declaration before opening the private binding file.
 * Stored bytes and caller-provided selections are untrusted evidence.
 */
export async function readNativeConnectionAttemptBinding(options: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  backendRunId: string;
  selection: NativePilotSelection;
}): Promise<NativeConnectionAttemptBinding> {
  const repositoryRoot = await realpath(options.repositoryRoot);
  const current = await selectNativePilotScenario(
    options.selection.arguments,
    JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ),
    repositoryRoot,
  );
  assert.deepEqual(options.selection, current, 'Connection reader selection is stale or altered');
  const expected = {
    requestedRunId: options.requestedRunId,
    captureRunId: path.basename(options.artifactRoot),
    backendRunId: options.backendRunId,
    selection: current,
  };
  buildNativeConnectionAttemptBinding(expected);
  const value: unknown = JSON.parse(
    readNativeEvidence(options.artifactRoot, connectionAttemptBindingPath, true).toString(),
  );
  return requireNativeConnectionAttemptBinding(value, expected);
}

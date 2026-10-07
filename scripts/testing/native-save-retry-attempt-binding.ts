import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  nativeSaveRetryAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from './native-pilot-contract';
import { readNativeEvidence } from './native-view-evidence';
import { assertArtifactPath } from './schema-validation';
import type { NativePilotSelection } from './native-pilot-contract';

const runId = /^[a-f0-9]{24}$/;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export const saveRetryAttemptBindingPath = 'save-retry-attempt-binding.private.json';
export { nativeSaveRetryAssertionIds } from './native-pilot-contract';

export type NativeSaveRetryAssertionId = (typeof nativeSaveRetryAssertionIds)[number];
export type NativeSaveRetryAssertionContract = {
  dataMode: 'postgres';
  count: 5;
  sha256: string;
  ids: NativeSaveRetryAssertionId[];
};
export type NativeSaveRetryAttemptBinding = {
  schemaVersion: 1;
  kind: 'private-native-save-retry-attempt-binding-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string;
  backendAttemptId: string;
  faultAttemptId: string;
  scenarioId: string;
  flowId: 'FLW-save-retry';
  selection: {
    scenarioHash: string;
    requirementHash: string;
    arguments: NativePilotSelection['arguments'];
  };
  assertionContract: NativeSaveRetryAssertionContract;
  fixtureScope: 'native-entry-ios' | 'native-entry-android';
  nativePassingCases: 0;
  scope: 'requested-to-capture-to-fixture identity only; execution and public finalization are separate';
};

/** Require the generated five-row save/retry ledger, including its full hash. */
export function requireNativeSaveRetryAssertionContract(
  selection: NativePilotSelection,
): NativeSaveRetryAssertionContract {
  const rows = requireNativePilotAssertions(selection);
  assert.equal(selection.arguments.mode, 'integration');
  assert.deepEqual(
    rows.map((row) => row.id),
    nativeSaveRetryAssertionIds,
    'Native save/retry assertion IDs differ from the canonical ordered ledger',
  );
  const declared = selection.scenario.pilotAssertionContract;
  assert(declared, 'Native save/retry assertion ledger lacks its generated contract');
  assert.equal(declared.dataMode, 'postgres');
  assert.equal(declared.count, nativeSaveRetryAssertionIds.length);
  const generatedHash = hash(canonical(rows));
  assert.equal(
    declared.sha256,
    generatedHash,
    'Native save/retry assertion ledger differs from its generated contract hash',
  );
  return {
    dataMode: 'postgres',
    count: nativeSaveRetryAssertionIds.length,
    sha256: generatedHash,
    ids: [...nativeSaveRetryAssertionIds],
  };
}

function buildNativeSaveRetryAttemptBinding(expected: {
  requestedRunId: string;
  captureRunId: string;
  backendRunId: string;
  selection: NativePilotSelection;
}): NativeSaveRetryAttemptBinding {
  const { requestedRunId, captureRunId, backendRunId, selection } = expected;
  for (const id of [requestedRunId, captureRunId, backendRunId]) assert.match(id, runId);
  assert.equal(new Set([requestedRunId, captureRunId, backendRunId]).size, 3);
  const platform = selection.arguments.platform;
  assert(platform === 'ios' || platform === 'android', 'Unsupported save/retry binding platform');
  assert.deepEqual(selection.arguments, {
    platform,
    engine: 'maestro',
    scenario: `SCN-save-retry-${platform}`,
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, `SCN-save-retry-${platform}`);
  assert.equal(selection.scenario.platform, platform);
  assert.equal(selection.scenario.flowId, 'FLW-save-retry');
  assert.match(selection.scenarioHash, /^[a-f0-9]{64}$/);
  assert.equal(
    hash(canonical(selection.scenario)),
    selection.scenarioHash,
    'Native save/retry selection changed after its fingerprint was established',
  );
  assert.match(selection.requirementHash, /^[a-f0-9]{64}$/);
  const assertionContract = requireNativeSaveRetryAssertionContract(selection);
  const faultAttemptId = `native-save-${backendRunId}`;
  assert(![requestedRunId, captureRunId, backendRunId].includes(faultAttemptId));
  return {
    schemaVersion: 1,
    kind: 'private-native-save-retry-attempt-binding-not-public-receipt',
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    captureRunId,
    backendRunId,
    backendAttemptId: `${backendRunId}:first`,
    faultAttemptId,
    scenarioId: selection.scenario.id,
    flowId: 'FLW-save-retry',
    selection: {
      scenarioHash: selection.scenarioHash,
      requirementHash: selection.requirementHash,
      arguments: selection.arguments,
    },
    assertionContract,
    fixtureScope: `native-entry-${platform}`,
    nativePassingCases: 0,
    scope:
      'requested-to-capture-to-fixture identity only; execution and public finalization are separate',
  };
}

export function requireNativeSaveRetryAttemptBinding(
  value: unknown,
  expected: {
    requestedRunId: string;
    captureRunId: string;
    backendRunId: string;
    selection: NativePilotSelection;
  },
): NativeSaveRetryAttemptBinding {
  const record = buildNativeSaveRetryAttemptBinding(expected);
  assert.deepEqual(value, record, 'Native save/retry requested/capture/backend identity differs');
  return structuredClone(record);
}

export async function writeNativeSaveRetryAttemptBinding(options: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  backendRunId: string;
  selection: NativePilotSelection;
}): Promise<NativeSaveRetryAttemptBinding> {
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
  assert.deepEqual(
    options.selection,
    current,
    'Native save/retry binding selection is stale or altered',
  );
  const binding = requireNativeSaveRetryAttemptBinding(
    buildNativeSaveRetryAttemptBinding({
      requestedRunId: options.requestedRunId,
      captureRunId: path.basename(artifactRoot),
      backendRunId: options.backendRunId,
      selection: current,
    }),
    {
      requestedRunId: options.requestedRunId,
      captureRunId: path.basename(artifactRoot),
      backendRunId: options.backendRunId,
      selection: current,
    },
  );
  await writeFile(
    assertArtifactPath(artifactRoot, saveRetryAttemptBindingPath),
    JSON.stringify(binding, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  return binding;
}

/**
 * Read a private binding only after independently resolving its current source
 * selection.  The stored selection and a caller-provided selection are both
 * untrusted bytes; the repository declaration and requirement files are the
 * authority for the selection accepted here.
 */
export async function readNativeSaveRetryAttemptBinding(options: {
  repositoryRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  backendRunId: string;
  selection: NativePilotSelection;
}): Promise<NativeSaveRetryAttemptBinding> {
  const repositoryRoot = await realpath(options.repositoryRoot);
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
    'Native save/retry reader selection is stale or altered',
  );
  const captureRunId = path.basename(options.artifactRoot);
  const expected = {
    requestedRunId: options.requestedRunId,
    captureRunId,
    backendRunId: options.backendRunId,
    selection: current,
  };
  // Establish the complete save-retry scope/ledger/identity before opening evidence.
  buildNativeSaveRetryAttemptBinding(expected);
  const value: unknown = JSON.parse(
    readNativeEvidence(options.artifactRoot, saveRetryAttemptBindingPath, true).toString(),
  );
  return requireNativeSaveRetryAttemptBinding(value, expected);
}

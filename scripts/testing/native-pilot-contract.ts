import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { assertArtifactPath, assertPublicReceipt } from './schema-validation';

export type NativePilotArguments = {
  platform: 'ios' | 'android';
  engine: 'maestro';
  scenario: string;
  mode: 'fixture' | 'integration';
};

/** The only public selection that may opt into the pre-auth credential diagnostic. */
export function isIosCredentialInteractionDiagnosticSelection(args: NativePilotArguments): boolean {
  return (
    args.platform === 'ios' &&
    args.engine === 'maestro' &&
    args.scenario === 'SCN-camera-denied-ios' &&
    args.mode === 'integration'
  );
}

export type NativePilotTarget = {
  deviceId: string | null;
  osVersion: string | null;
  appId: string | null;
  buildProfile: string | null;
  binaryHash: string | null;
  apiOrigin: string | null;
};

/** Project captured metadata only; execution, build and cleanup still need verification. */
export function nativePilotTargetFromCapture(
  platform: NativePilotArguments['platform'],
  capture?: unknown,
): NativePilotTarget {
  if (platform !== 'ios' && platform !== 'android')
    throw new Error('Invalid native target platform');
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Native target metadata must be an object');
    return value as Record<string, unknown>;
  };
  const input = capture === undefined ? undefined : record(capture);
  if (input && input.platform !== platform)
    throw new Error('Native target capture platform differs');
  const device = input?.device == null ? {} : record(input.device);
  const build = input?.build == null ? {} : record(input.build);
  const field = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string' || !value || value.trim() !== value)
      throw new Error('Native target metadata field is invalid');
    return value;
  };
  const binaryHash = field(build.binaryHash);
  if (binaryHash !== null && !/^[a-f0-9]{64}$/.test(binaryHash))
    throw new Error('Native target binary hash is invalid');
  return {
    deviceId: field(platform === 'android' ? device.serial : device.udid),
    osVersion: field(platform === 'android' ? device.osVersion : device.runtime),
    appId: field(platform === 'android' ? build.appId : build.bundleId),
    buildProfile: field(build.profile),
    binaryHash,
    apiOrigin: field(build.apiOrigin),
  };
}
type PilotAssertion = {
  id: string;
  requirementRefs: string[];
  evidenceKinds: ('ui' | 'api' | 'sql')[];
  requirementPaths?: string[];
  startingState?: string;
  action?: string;
  expected?: string;
  evidencePathTemplates?: string[];
};
export type NativePilotSelection = {
  arguments: NativePilotArguments;
  scenarioHash: string;
  requirementHash: string;
  scenario: {
    id: string;
    platform: string;
    engine?: string;
    flowId: string;
    transitionIds: string[];
    requirementRefs: string[];
    dataMode: string;
    fixtureRef: string;
    /** Checked-in Maestro route source, when this scenario has a saved flow. */
    maestroFlow?: string;
    /** SHA-256 of the checked-in Maestro route selected by this scenario. */
    maestroFlowSha256?: string;
    ownerPaths?: string[];
    freshnessInputs: {
      requirementPaths: string[];
      sourceIds?: string[];
      ownerPaths?: string[];
    };
    pilotAssertions?: PilotAssertion[];
    pilotAssertionContract?: {
      count: number;
      sha256: string;
      dataMode: 'postgres';
      semanticSha256?: string;
    };
  };
};
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
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

export function canonicalNativeRepoRelativePath(value: unknown, label: string): string {
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

/** Parse the exact producer-owned helper list before any lock/device/child acquisition. */
export function nativeTrainingHelperPathsFromSource(
  repositoryRoot: string,
  platform: NativePilotArguments['platform'],
): string[] {
  const root = realpathSync(repositoryRoot);
  const relative =
    platform === 'ios'
      ? 'scripts/testing/native-session-helper-ledger.ts'
      : 'scripts/testing/capture-android-testability.ts';
  const source = readFileSync(path.join(root, relative), 'utf8');
  const startMarker =
    platform === 'ios'
      ? 'export const nativeSessionHelperInputPaths = Object.freeze(['
      : '  const helperPaths = [';
  const endMarker = platform === 'ios' ? '] as const);' : '\n  ];\n  const helperIdentity';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end >= 0, `Missing ${platform} producer helper declaration`);
  const values = [
    ...source.slice(start + startMarker.length, end).matchAll(/["']([^"']+)["']/g),
  ].map((match) =>
    platform === 'ios' ||
    match[1] === 'package.json' ||
    match[1].startsWith('scripts/') ||
    match[1].startsWith('.maestro/')
      ? match[1]
      : `scripts/testing/${match[1]}`,
  );
  assert(values.length > 0, `${platform} producer helper declaration is empty`);
  assert.equal(
    new Set(values).size,
    values.length,
    `${platform} producer helper declaration duplicates paths`,
  );
  for (const value of values) {
    canonicalNativeRepoRelativePath(value, `${platform} producer helper path`);
    assert(
      value === 'package.json' ||
        value.startsWith('.maestro/') ||
        value.startsWith('scripts/testing/') ||
        value.startsWith('scripts/ci/'),
      `${platform} producer helper path is outside the owned script roots`,
    );
    const file = path.resolve(root, value);
    assert(
      file.startsWith(`${root}${path.sep}`) &&
        realpathSync(file) === file &&
        lstatSync(file).isFile(),
    );
  }
  return values;
}

/** Validate declaration ownership before the native runner can acquire anything. */
export function requireNativeTrainingHelperDeclaration(
  repositoryRoot: string,
  platform: NativePilotArguments['platform'],
  ownerPaths: readonly string[] | undefined,
): string[] {
  assert(
    Array.isArray(ownerPaths) && ownerPaths.length > 0,
    'Native helper owner paths are absent',
  );
  const normalizedOwners = ownerPaths.map((value) =>
    canonicalNativeRepoRelativePath(value, 'Native owner path'),
  );
  assert.equal(
    new Set(normalizedOwners).size,
    normalizedOwners.length,
    'Native owner paths contain duplicates',
  );
  const expected = nativeTrainingHelperPathsFromSource(repositoryRoot, platform);
  const owners = new Set(normalizedOwners);
  for (const helper of expected)
    assert(owners.has(helper), `Native declaration omits producer helper ${helper}`);
  return expected;
}

function requireScenarioOwnerFreshness(
  repositoryRoot: string,
  scenario: NativePilotSelection['scenario'],
  sources: readonly { id: string; paths: string[] }[],
  sourceIds: readonly string[],
): void {
  const ownerPaths = scenario.ownerPaths;
  const freshnessOwnerPaths = scenario.freshnessInputs.ownerPaths;
  assert(Array.isArray(ownerPaths), 'Native scenario owner paths are absent');
  assert(Array.isArray(freshnessOwnerPaths), 'Native scenario freshness owner paths are absent');
  assert.equal(
    new Set(ownerPaths).size,
    ownerPaths.length,
    'Native scenario owner paths duplicate entries',
  );
  assert.deepEqual(
    freshnessOwnerPaths,
    ownerPaths,
    'Native scenario freshness owner paths do not bind the selected owner set',
  );
  const sourcePaths = new Set(sources.flatMap((source) => source.paths));
  for (const relative of ownerPaths) {
    // The generated inventory is written after declaration generation, so its
    // own bytes cannot be a SOURCE_PATHS revision without recursion. It remains
    // in both owner arrays and is bound by the dispatcher after generation.
    if (relative !== 'docs/qa/native-pilot/inventory.json')
      assert(
        sourcePaths.has(relative),
        `Native scenario owner path lacks a source revision: ${relative}`,
      );
  }
}

/** Validate before locks, devices, backend sessions or child acquisition. */
export function parseNativePilotArguments(argv: readonly string[]): NativePilotArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const match = /^--(platform|engine|scenario|mode)(?:=(.*))?$/.exec(argv[index]);
    if (!match || values.has(match[1]))
      throw new Error('Invalid or duplicate native pilot argument');
    const value = match[2] === undefined ? argv[++index] : match[2];
    if (!value || value.startsWith('--') || value.trim() !== value)
      throw new Error('Native pilot argument requires one nonempty value');
    values.set(match[1], value);
  }
  if (values.size !== 4)
    throw new Error('Native pilot requires platform, engine, scenario and mode');
  const platform = values.get('platform');
  const engine = values.get('engine');
  const mode = values.get('mode');
  const scenario = values.get('scenario')!;
  if (
    (platform !== 'ios' && platform !== 'android') ||
    engine !== 'maestro' ||
    (mode !== 'fixture' && mode !== 'integration') ||
    !/^SCN-[A-Za-z0-9._-]+$/.test(scenario) ||
    !identifier.test(scenario)
  )
    throw new Error('Unsupported native pilot selection');
  return { platform, engine, scenario, mode };
}

/** Uses the portable canonical inventory, never a second hardcoded scenario list. */
export async function selectNativePilotScenario(
  args: NativePilotArguments,
  inventory: unknown,
  repositoryRoot: string,
): Promise<NativePilotSelection> {
  // Programmatic callers receive the same strict enum/argument validation.
  parseNativePilotArguments(Object.entries(args).map(([key, value]) => `--${key}=${value}`));
  const { validateNativeInventory } = await import('./validate-native-inventory.mjs');
  await validateNativeInventory(inventory, repositoryRoot);
  const declaration = inventory as {
    scenarios: NativePilotSelection['scenario'][];
    flows: { id: string; transitionIds: string[] }[];
    sources: { id: string; paths: string[]; revision: string }[];
  };
  const scenario = declaration.scenarios.find((row) => row.id === args.scenario);
  const flow = declaration.flows.find((row) => row.id === scenario?.flowId);
  if (
    !scenario ||
    scenario.platform !== args.platform ||
    !flow ||
    JSON.stringify(scenario.transitionIds) !== JSON.stringify(flow.transitionIds)
  )
    throw new Error('Requested native scenario/platform or complete flow is absent');
  const root = realpathSync(repositoryRoot);
  requireNativeTrainingHelperDeclaration(root, args.platform, scenario.ownerPaths);
  const ownedSource = (relative: string) => {
    const file = path.resolve(root, relative);
    if (
      !file.startsWith(root + path.sep) ||
      realpathSync(file) !== file ||
      !lstatSync(file).isFile()
    )
      throw new Error('Native scenario source is missing or noncanonical');
    return readFileSync(file);
  };
  for (const source of declaration.sources)
    if (
      source.paths.length !== 1 ||
      !source.id ||
      hash(ownedSource(source.paths[0])) !== source.revision
    )
      throw new Error('Native scenario declaration has stale governing inputs');
  requireScenarioOwnerFreshness(
    root,
    scenario,
    declaration.sources,
    scenario.freshnessInputs.sourceIds ?? [],
  );
  const requirements = scenario.freshnessInputs.requirementPaths.map((relative) => ({
    path: relative,
    sha256: hash(ownedSource(relative)),
  }));
  if (!requirements.length) throw new Error('Native scenario governing requirements are absent');
  return {
    arguments: { ...args },
    scenario: structuredClone(scenario),
    scenarioHash: hash(canonical(scenario)),
    requirementHash: hash(canonical(requirements)),
  };
}

export const nativeSaveRetryAssertionIds = Object.freeze([
  'NAT-save-retry-error',
  'NAT-save-retry-retained-draft',
  'NAT-save-retry-final-save',
  'NAT-save-retry-reopen',
  'NAT-save-retry-unrelated-state',
] as const);

export const nativeSessionAssertionIds = Object.freeze([
  'NAT-session-login',
  'NAT-session-restore',
  'NAT-session-account',
  'NAT-session-signout',
  'NAT-session-signed-out-relaunch',
  'NAT-session-unrelated-state',
] as const);

export const nativeCameraDeniedAssertionIds = Object.freeze([
  'NAT-camera-normal-entry',
  'NAT-camera-denial-guidance',
  'NAT-camera-manual-submit',
  'NAT-camera-unrelated-state',
] as const);

export const nativeConnectionAssertionIds = Object.freeze([
  'NAT-connection-normal-entry',
  'NAT-connection-submit-pending',
  'NAT-connection-pending-state',
  'NAT-connection-confirm-active',
  'NAT-connection-active-student',
  'NAT-connection-active-roster',
  'NAT-connection-unrelated-state',
] as const);

export const nativeConnectionAssertionSemanticSha256 =
  '83b7121c9fd74fea4f022b9a01da751aada9de5ef6678b87075105ce55b3a87d';

/** T14 fills this metadata in the canonical generator, shared by both engines. */
export function requireNativePilotAssertions(selection: NativePilotSelection): PilotAssertion[] {
  const expectedScenarioId = `SCN-${selection.scenario.flowId.replace(/^FLW-/, '')}-${selection.arguments.platform}`;
  if (
    selection.scenario.platform !== selection.arguments.platform ||
    selection.scenario.id !== expectedScenarioId ||
    (selection.scenario.engine !== undefined &&
      selection.scenario.engine !== selection.arguments.engine)
  )
    throw new Error('Native pilot scenario platform or engine does not match selection');
  if (
    ['FLW-session', 'FLW-connection', 'FLW-camera-denied'].includes(selection.scenario.flowId) &&
    (selection.scenario.dataMode !== 'postgres' ||
      selection.scenario.fixtureRef !== `owned-postgres:${selection.scenario.id}:fresh-attempt`)
  )
    throw new Error(
      'Native integrated scenario must use the canonical integrated Postgres fresh-attempt fixture',
    );
  const rows = selection.scenario.pilotAssertions;
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    new Set(rows.map((row) => row?.id)).size !== rows.length ||
    rows.some(
      (row) =>
        !row ||
        !identifier.test(row.id) ||
        !Array.isArray(row.requirementRefs) ||
        row.requirementRefs.length === 0 ||
        new Set(row.requirementRefs).size !== row.requirementRefs.length ||
        row.requirementRefs.some(
          (ref) => typeof ref !== 'string' || !ref.trim() || ref.trim() !== ref,
        ) ||
        row.requirementRefs.some((ref) => !selection.scenario.requirementRefs.includes(ref)) ||
        !Array.isArray(row.evidenceKinds) ||
        row.evidenceKinds.length === 0 ||
        new Set(row.evidenceKinds).size !== row.evidenceKinds.length ||
        row.evidenceKinds.some((kind) => !['ui', 'api', 'sql'].includes(kind)),
    )
  )
    throw new Error('Native pilot core assertion ledger is missing or invalid');
  const kinds = new Set(rows.flatMap((row) => row.evidenceKinds));
  const contract = selection.scenario.pilotAssertionContract;
  if (
    [
      'FLW-session',
      'FLW-training',
      'FLW-save-retry',
      'FLW-connection',
      'FLW-camera-denied',
    ].includes(selection.scenario.flowId) &&
    !contract
  )
    throw new Error('Native pilot assertion ledger lacks its complete declared contract');
  if (contract && (contract.dataMode !== 'postgres' || selection.arguments.mode !== 'integration'))
    throw new Error('Native assertion contract is declared for integrated Postgres only');
  if (
    contract &&
    (!Number.isSafeInteger(contract.count) ||
      contract.count < 1 ||
      rows.length !== contract.count ||
      !/^[a-f0-9]{64}$/.test(contract.sha256) ||
      hash(canonical(rows)) !== contract.sha256)
  )
    throw new Error('Native pilot assertion ledger differs from its complete declared contract');
  if (
    selection.scenario.flowId === 'FLW-save-retry' &&
    (rows.length !== nativeSaveRetryAssertionIds.length ||
      rows.some((row, index) => row.id !== nativeSaveRetryAssertionIds[index]))
  )
    throw new Error('Native save-retry ledger must retain its five ordered canonical assertions');
  if (
    selection.scenario.flowId === 'FLW-connection' &&
    (rows.length !== nativeConnectionAssertionIds.length ||
      rows.some((row, index) => row.id !== nativeConnectionAssertionIds[index]))
  )
    throw new Error('Native connection ledger must retain its seven ordered canonical assertions');
  if (
    selection.scenario.flowId === 'FLW-session' &&
    (rows.length !== nativeSessionAssertionIds.length ||
      rows.some((row, index) => row.id !== nativeSessionAssertionIds[index]))
  )
    throw new Error('Native session ledger must retain its six ordered canonical assertions');
  if (
    selection.scenario.flowId === 'FLW-camera-denied' &&
    (rows.length !== nativeCameraDeniedAssertionIds.length ||
      rows.some((row, index) => row.id !== nativeCameraDeniedAssertionIds[index]))
  )
    throw new Error(
      'Native camera-denied ledger must retain its four ordered canonical assertions',
    );
  if (selection.scenario.flowId === 'FLW-session') {
    for (const [id, evidenceKinds] of [
      ['NAT-session-login', ['ui', 'api']],
      ['NAT-session-restore', ['ui', 'api']],
      ['NAT-session-account', ['ui']],
      ['NAT-session-signout', ['ui', 'api']],
      ['NAT-session-signed-out-relaunch', ['ui', 'api']],
      ['NAT-session-unrelated-state', ['sql']],
    ] as const) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || JSON.stringify(row.evidenceKinds) !== JSON.stringify(evidenceKinds))
        throw new Error(`Native session assertion ${id} has an unexpected evidence contract`);
    }
  }
  if (selection.scenario.flowId === 'FLW-camera-denied') {
    for (const [id, evidenceKinds] of [
      ['NAT-camera-normal-entry', ['ui', 'api', 'sql']],
      ['NAT-camera-denial-guidance', ['ui']],
      ['NAT-camera-manual-submit', ['ui', 'api', 'sql']],
      ['NAT-camera-unrelated-state', ['sql']],
    ] as const) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || JSON.stringify(row.evidenceKinds) !== JSON.stringify(evidenceKinds))
        throw new Error(`Native camera-denied assertion ${id} has an unexpected evidence contract`);
    }
  }
  if (
    contract &&
    rows.some(
      (row) =>
        ![row.startingState, row.action, row.expected].every(
          (value) => typeof value === 'string' && value.trim().length > 0,
        ) ||
        !row.requirementPaths?.length ||
        row.requirementPaths.some(
          (file) => !selection.scenario.freshnessInputs.requirementPaths.includes(file),
        ) ||
        row.evidencePathTemplates?.length !== row.evidenceKinds.length ||
        row.evidencePathTemplates.some(
          (file) =>
            typeof file !== 'string' ||
            !/^assertions\/\{attemptId\}\/[A-Za-z0-9_-]+\.private\.json$/.test(file),
        ),
    )
  )
    throw new Error('Native assertion contract lacks its action, expectation or evidence recipe');
  if (
    !kinds.has('ui') ||
    (selection.arguments.mode === 'integration' && (!kinds.has('api') || !kinds.has('sql')))
  )
    throw new Error('Native pilot ledger lacks required UI/API/SQL proof');
  if (selection.scenario.flowId === 'FLW-connection') {
    const semanticRows = rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')),
    );
    if (
      contract?.semanticSha256 !== nativeConnectionAssertionSemanticSha256 ||
      hash(canonical(semanticRows)) !== nativeConnectionAssertionSemanticSha256
    )
      throw new Error('Native connection ledger semantic digest differs from frozen contract');
  }
  return structuredClone(rows);
}

export type NativePilotAttemptIdentity = {
  runId: string;
  attemptId: string;
  target: Record<string, unknown>;
  inputs: Record<string, unknown>;
};

/** Completeness/identity boundary only. Actual action, SQL and cleanup truth need runtime verifiers. */
export function assertNativePilotCompletion(
  receipt: unknown,
  selection: NativePilotSelection,
  expected: NativePilotAttemptIdentity,
  executedAttemptIds: readonly string[],
  artifactRoot: string,
  privateValues: readonly string[] = [],
) {
  const ledger = requireNativePilotAssertions(selection);
  if (hash(canonical(selection.scenario)) !== selection.scenarioHash)
    throw new Error('Native selection changed after its fingerprint was established');
  assertPublicReceipt(receipt, artifactRoot, privateValues);
  const row = receipt as {
    runId: string;
    attemptId: string;
    scenarioId: string;
    phase: string;
    layer: string;
    platform: string;
    engine: string;
    dataMode: string;
    result: string;
    exitCode: number;
    childExitCode: number | null;
    target: Record<string, unknown>;
    inputs: Record<string, unknown>;
    cleanup: { status: string };
    assertions: {
      id: string;
      outcome: string;
      requirementRefs: string[];
      evidencePaths: string[];
    }[];
  };
  if (
    !identifier.test(expected.runId) ||
    !identifier.test(expected.attemptId) ||
    expected.attemptId !== `${expected.runId}:first` ||
    executedAttemptIds.length !== 1 ||
    executedAttemptIds[0] !== expected.attemptId ||
    row.runId !== expected.runId ||
    row.attemptId !== expected.attemptId ||
    row.scenarioId !== selection.scenario.id ||
    row.platform !== selection.arguments.platform ||
    row.engine !== selection.arguments.engine ||
    row.phase !== 'P4' ||
    row.layer !== 'native' ||
    row.dataMode !== (selection.arguments.mode === 'integration' ? 'postgres' : 'fixture')
  )
    throw new Error('Requested/executed native attempt identity mismatch');
  if (
    row.result !== 'passed' ||
    row.exitCode !== 0 ||
    row.childExitCode !== 0 ||
    row.cleanup.status !== 'cleaned'
  )
    throw new Error('Native child, assertions or owned cleanup did not pass');
  if (
    expected.inputs.scenarioHash !== selection.scenarioHash ||
    expected.inputs.requirementHash !== selection.requirementHash ||
    canonical(row.target) !== canonical(expected.target) ||
    canonical(row.inputs) !== canonical(expected.inputs)
  )
    throw new Error('Native runtime fingerprints or owned target mismatch');
  const versions = row.inputs.toolVersions as Record<string, string>;
  if (
    !versions[selection.arguments.engine] ||
    (selection.arguments.mode === 'integration' && !row.target.apiOrigin)
  )
    throw new Error('Native engine version or integrated API origin is absent');
  if (
    row.assertions.length !== ledger.length ||
    ledger.some((required) => {
      const proof = row.assertions.find((assertion) => assertion.id === required.id);
      return (
        !proof ||
        proof.outcome !== 'passed' ||
        JSON.stringify(proof.requirementRefs) !== JSON.stringify(required.requirementRefs) ||
        proof.evidencePaths.length < required.evidenceKinds.length
      );
    })
  )
    throw new Error('Native core assertions are missing, skipped or not proven');
  for (const assertion of row.assertions)
    for (const relative of assertion.evidencePaths) {
      const file = assertArtifactPath(artifactRoot, relative);
      const meta = lstatSync(file);
      if (!meta.isFile() || meta.size === 0 || realpathSync(file) !== file)
        throw new Error('Native assertion artifact is empty or noncanonical');
    }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireNativePilotAssertions } from './native-pilot-contract';
import { assertNativeBootstrapHealthy } from './native-runtime-preflight';
import { readNativeTrainingAttemptBinding } from './native-training-attempt-binding';
import { normalizeNativeCommandDiagnostic } from './native-training-attempt-outcome';
import { requireNativeTrainingPreview } from './native-training-maestro-driver';
import { requireFullAndroidTrainingFailureCleanupEvidence } from './native-training-pilot-evidence';
import {
  nativeTrainingQuantityContract,
  nativeTrainingQuantityYaml,
} from './native-training-quantity-contract';
import { readNativeEvidence } from './native-view-evidence';
import type { NativePilotSelection } from './native-pilot-contract';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const failurePath = 'native-application-failure.private.json';

type NativeCommandDiagnostic = ReturnType<typeof normalizeNativeCommandDiagnostic>;

function requireNoNativeCensusFailure(root: string) {
  assert(
    !readdirSync(root).some((name) => name.endsWith('.census-failure.private.json')),
    'Native census failure diagnostic prevents failure qualification',
  );
}

function requireQualifiedNativeQuantityCommandHistory(
  value: unknown,
  platform: 'ios' | 'android',
  label: string,
) {
  assert(Array.isArray(value) && value.length > 0, 'Native command history is missing');
  const rawRows = value.map(object);
  const commands: NativeCommandDiagnostic[] = rawRows.map((raw) => {
    const row = normalizeNativeCommandDiagnostic(raw);
    assert(
      typeof raw.label === 'string' && raw.label.trim() && row.label === raw.label,
      'Native command label is missing or malformed',
    );
    assert(
      (raw.phase === 'build' || raw.phase === 'step') && row.phase === raw.phase,
      'Native command phase is missing or unrecognized',
    );
    assert(
      row.execution !== null && row.execution === raw.execution,
      'Native command execution is missing or unrecognized',
    );
    assert.equal(raw.cleanup, 'cleaned', 'Native command cleanup is not clean');
    assert(
      Object.hasOwn(raw, 'childExitCode') &&
        typeof raw.childExitCode === 'number' &&
        Number.isSafeInteger(raw.childExitCode) &&
        row.childExitCode === raw.childExitCode,
      'Native command child exit is missing or malformed',
    );
    assert(
      Object.hasOwn(raw, 'childSignal') && raw.childSignal === null && row.childSignal === null,
      'Native command child signal must be explicitly null',
    );
    assert(
      typeof raw.deadlineMs === 'number' &&
        Number.isSafeInteger(raw.deadlineMs) &&
        raw.deadlineMs > 0,
      'Native command deadline is missing or malformed',
    );
    assert(
      !Object.hasOwn(raw, 'censusFailure') || raw.censusFailure === null,
      'Native command census failure prevents failure qualification',
    );
    assert(
      !Object.hasOwn(raw, 'outputFailure') || raw.outputFailure === null,
      'Native command output failure prevents failure qualification',
    );
    return row;
  });
  const qualifyingFailures = commands.filter(
    (row) => row.execution === 'child-failed' && row.childExitCode === 1,
  );
  assert.equal(qualifyingFailures.length, 1, 'Native failure history must contain one child-1 row');
  const stepLabel = platform === 'android' ? `${label}-readiness` : label;
  const stepRows = commands.filter((row) => row.label === stepLabel);
  assert.equal(stepRows.length, 1, 'Native failure history lacks one original failed step');
  const step = stepRows[0];
  assert.equal(step.phase, 'step', 'Native product failure must come from a step command');
  assert.equal(step.execution, 'child-failed');
  assert.equal(step.childExitCode, 1);
  assert.equal(step, qualifyingFailures[0]);
  assert(
    commands.every(
      (row) =>
        row === step ||
        (row.execution === 'completed' && row.cleanup === 'cleaned' && row.childExitCode === 0),
    ),
    'Native failure history contains a second failed or non-clean command',
  );
  const censusFailures = commands
    .map((row) => row.censusFailure)
    .filter((failure): failure is unknown => failure !== null);
  assert.equal(censusFailures.length, 0, 'Native census failure prevents failure qualification');
  assert(
    commands.every((row) => row.outputFailure === null),
    'Native output failure prevents failure qualification',
  );
  return { commands, censusFailures };
}

function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function json(root: string, relative: string) {
  return object(JSON.parse(readNativeEvidence(root, relative, true).toString()) as unknown);
}
export function readNativeQuantityContract(root: string, label: string) {
  const relative = `training-journey-quantity-${label}.private.json`;
  const record = json(root, relative);
  const input = object(record.input);
  assert.deepEqual(Object.keys(input).sort(), [
    'accountUid',
    'attemptId',
    'exerciseId',
    'exerciseName',
    'platform',
    'runId',
  ]);
  assert(input.platform === 'ios' || input.platform === 'android');
  assert.match(String(input.runId), /^[a-f0-9]{24}$/);
  assert.equal(input.attemptId, `${String(input.runId)}:first`);
  assert(typeof input.exerciseName === 'string' && typeof input.accountUid === 'string');
  assert(typeof input.exerciseId === 'string' && input.exerciseId.length > 0);
  const contract = nativeTrainingQuantityContract(label, input.exerciseName);
  assert(input.accountUid.length > 0);
  const title = `QA training ${String(input.attemptId)}${contract.expected === '4x10' ? ' updated' : ''}`;
  assert.deepEqual(record, {
    schemaVersion: 1,
    kind: 'required native training quantity assertion',
    captureRunId: path.basename(root),
    input,
    title,
    ...contract,
  });
  return { ...contract, title, input, relative };
}
/** Pinned 2.6.1 straight-line command format. Unknown errors are never application failures. */
export function requireMaestroQuantityAssertionFailure(
  value: unknown,
  contract: ReturnType<typeof nativeTrainingQuantityContract>,
) {
  assert(Array.isArray(value) && value.length > 1);
  const rows = (value as unknown[]).map(object);
  const metadata = rows.map((row) => object(row.metadata));
  const sequences = metadata.map((row) => row.sequenceNumber);
  assert(sequences.every((x) => Number.isSafeInteger(x) && Number(x) >= 0));
  assert.equal(new Set(sequences).size, rows.length);
  const failed = rows.filter((row) => object(row.metadata).status === 'FAILED');
  assert.equal(failed.length, 1);
  const row = failed[0];
  const meta = object(row.metadata);
  const command = object(row.command);
  assert.deepEqual(Object.keys(command), ['assertConditionCommand']);
  const condition = object(command.assertConditionCommand);
  assert.equal(condition.optional, false);
  assert.deepEqual(condition.condition, {
    visible: { idRegex: contract.idRegex, textRegex: contract.textRegex, optional: false },
  });
  assert.deepEqual(meta.evaluatedCommand, command);
  const error = object(meta.error);
  assert(typeof error.message === 'string' && error.message.startsWith('Assertion is false: '));
  assert(Array.isArray(error.stackTrace) && error.stackTrace.length > 0);
  const frame = object(error.stackTrace[0]);
  assert(
    (frame.className === 'maestro.orchestra.Orchestra' &&
      frame.methodName === 'assertConditionCommand') ||
      (frame.className === 'maestro.orchestra.Orchestra$assertConditionCommand$1' &&
        frame.methodName === 'invokeSuspend'),
  );
  assert(Number.isSafeInteger(meta.timestamp) && Number(meta.timestamp) > 0);
  for (const other of metadata)
    if (other !== meta) {
      assert(Number(other.sequenceNumber) < Number(meta.sequenceNumber));
      assert.equal(other.status, 'COMPLETED');
    }
  return { sequenceNumber: Number(meta.sequenceNumber), timestamp: Number(meta.timestamp) };
}
export async function findMaestroQuantityFailureCommands(root: string, label: string) {
  const contract = readNativeQuantityContract(root, label);
  const base = `${label}-artifacts`;
  const entries = await readdir(path.join(root, base), { withFileTypes: true });
  assert(entries.length === 1 && entries[0].isDirectory());
  assert.match(entries[0].name, /^\d{4}-\d{2}-\d{2}_\d{6}$/);
  const relative = `${base}/${entries[0].name}/commands-(${label}.yaml).json`;
  requireMaestroQuantityAssertionFailure(
    JSON.parse(readNativeEvidence(root, relative, true).toString()) as unknown,
    contract,
  );
  return relative;
}
function requireWrongQuantity(
  tree: unknown,
  contract: ReturnType<typeof readNativeQuantityContract>,
) {
  const quantities: Record<string, unknown>[] = [];
  let nodes = 0;
  const walk = (value: unknown) => {
    assert(++nodes < 100_000);
    const row = object(value);
    if (row.attributes) {
      const attrs = object(row.attributes);
      if (
        attrs['resource-id'] === contract.selectorId ||
        (contract.input.platform === 'android' &&
          attrs['resource-id'] === `com.edufelip.mychampions.dev:id/${contract.selectorId}`)
      )
        quantities.push(attrs);
    }
    if (row.children) {
      assert(Array.isArray(row.children));
      for (const child of row.children as unknown[]) walk(child);
    }
  };
  walk(tree);
  assert.equal(quantities.length, 1);
  const actual =
    quantities[0][contract.input.platform === 'android' ? 'text' : 'accessibilityText'];
  assert(typeof actual === 'string' && actual.trim().length > 0);
  assert.notEqual(actual, contract.expected);
  requireNativeTrainingPreview(
    contract.input.platform as 'ios' | 'android',
    tree,
    contract.title,
    String(contract.input.exerciseName),
    actual,
  );
  return actual;
}
function androidFailureDevicePaths(label: string) {
  return [
    `${label}-failure-device-health.private.json`,
    ...(['before', 'after'] as const).flatMap((phase) =>
      ['boot', 'state'].map((kind) => `${label}-failure-device-${phase}-${kind}.private.log`),
    ),
  ];
}
function failureDevicePaths(contract: ReturnType<typeof readNativeQuantityContract>) {
  return contract.input.platform === 'android' ? androidFailureDevicePaths(contract.label) : [];
}
function requireAndroidFailureDeviceHealth(
  root: string,
  label: string,
  device: Record<string, unknown>,
  health: Record<string, unknown>,
) {
  assert.match(String(device.serial), /^emulator-[0-9]+$/);
  assert.match(String(device.runId), /^[a-f0-9]{24}$/);
  assert(typeof device.avd === 'string' && device.avd.length > 0);
  const record = json(root, `${label}-failure-device-health.private.json`);
  const expected = {
    serial: device.serial,
    avd: device.avd,
    ownerRunId: device.runId,
    bootCompleted: '1',
    state: 'device',
  };
  assert.deepEqual(record, {
    kind: 'owned Android failure diagnostic device health',
    captureRunId: path.basename(root),
    before: expected,
    after: expected,
  });
  assert.deepEqual(health, expected);
  for (const phase of ['before', 'after'])
    for (const [kind, value] of [
      ['boot', '1'],
      ['state', 'device'],
    ])
      assert.equal(
        readNativeEvidence(root, `${label}-failure-device-${phase}-${kind}.private.log`, true)
          .toString()
          .trim(),
        value,
      );
}
/** Candidate only. Public classification requires stable input, healthy runtime and full cleanup. */
export async function recordNativeQuantityFailure(options: {
  root: string;
  label: string;
  commandsPath: string;
  hierarchyPath: string;
  screenshotPath: string;
}) {
  const { root, label } = options;
  const contract = readNativeQuantityContract(root, label);
  const observed = requireMaestroQuantityAssertionFailure(
    JSON.parse(readNativeEvidence(root, options.commandsPath, true).toString()) as unknown,
    contract,
  );
  const actual = requireWrongQuantity(json(root, options.hierarchyPath), contract);
  const screenshot = readNativeEvidence(root, options.screenshotPath);
  assert(screenshot.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  const paths = [
    contract.relative,
    `${label}.yaml`,
    options.commandsPath,
    options.hierarchyPath,
    options.screenshotPath,
    `${label}-failure-health.private.json`,
    ...failureDevicePaths(contract),
  ];
  const record = {
    schemaVersion: 1,
    kind: 'candidate-required-native-quantity-assertion-failure-not-public-result',
    captureRunId: path.basename(root),
    label,
    assertionId: contract.assertionId,
    commandsPath: options.commandsPath,
    hierarchyPath: options.hierarchyPath,
    screenshotPath: options.screenshotPath,
    expected: contract.expected,
    actual,
    ...observed,
    files: paths.map((relative) => ({
      path: relative,
      sha256: digest(readNativeEvidence(root, relative, !relative.endsWith('.png'))),
    })),
    nativePassingCases: 0,
  };
  await writeFile(path.join(root, failurePath), JSON.stringify(record, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
}
export function readQualifiedNativeQuantityFailure(options: {
  captureRoot: string;
  requestedRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
}) {
  const root = options.captureRoot;
  const binding = readNativeTrainingAttemptBinding({
    artifactRoot: root,
    requestedRunId: options.requestedRunId,
    backendRunId: options.fixtureRunId,
    selection: options.selection,
  });
  requireNoNativeCensusFailure(root);
  const failure = json(root, failurePath);
  assert.equal(failure.schemaVersion, 1);
  assert.equal(
    failure.kind,
    'candidate-required-native-quantity-assertion-failure-not-public-result',
  );
  assert.equal(failure.captureRunId, binding.captureRunId);
  assert.equal(failure.nativePassingCases, 0);
  assert(typeof failure.label === 'string');
  const contract = readNativeQuantityContract(root, failure.label);
  const flow = readNativeEvidence(root, `${failure.label}.yaml`, true).toString();
  const semanticAssertion = nativeTrainingQuantityYaml(
    failure.label,
    String(contract.input.exerciseName),
  );
  assert.equal(flow.split(semanticAssertion).length, 2);
  assert.equal(contract.input.runId, binding.backendRunId);
  assert.equal(failure.assertionId, contract.assertionId);
  assert.equal(failure.expected, contract.expected);
  assert(
    typeof failure.commandsPath === 'string' &&
      typeof failure.hierarchyPath === 'string' &&
      typeof failure.screenshotPath === 'string',
  );
  assert.equal(failure.hierarchyPath, `${failure.label}-failure-hierarchy.json`);
  assert.equal(failure.screenshotPath, `${failure.label}-failure.png`);
  assert.match(
    failure.commandsPath,
    new RegExp(
      `^${failure.label}-artifacts/\\d{4}-\\d{2}-\\d{2}_\\d{6}/commands-\\(${failure.label}\\.yaml\\)\\.json$`,
    ),
  );
  const observed = requireMaestroQuantityAssertionFailure(
    JSON.parse(readNativeEvidence(root, failure.commandsPath, true).toString()) as unknown,
    contract,
  );
  assert.equal(failure.sequenceNumber, observed.sequenceNumber);
  assert.equal(failure.timestamp, observed.timestamp);
  assert.equal(failure.actual, requireWrongQuantity(json(root, failure.hierarchyPath), contract));
  const expectedPaths = [
    contract.relative,
    `${failure.label}.yaml`,
    failure.commandsPath,
    failure.hierarchyPath,
    failure.screenshotPath,
    `${failure.label}-failure-health.private.json`,
    ...failureDevicePaths(contract),
  ];
  assert(Array.isArray(failure.files));
  assert.deepEqual(
    failure.files,
    expectedPaths.map((relative) => ({
      path: relative,
      sha256: digest(readNativeEvidence(root, relative, !relative.endsWith('.png'))),
    })),
  );
  const platform = options.selection.arguments.platform;
  assert.equal(
    contract.input.platform,
    platform,
    'Failure quantity platform differs from selection',
  );
  const capture = json(root, 'capture.private.json');
  assert.equal(capture.kind, 'private-owned-native-training-execution-not-public-receipt');
  assert.equal(capture.mode, 'integration');
  assert.equal(capture.platform, platform);
  assert.equal(capture.charter, 'training-journey');
  assert.equal(capture.nativePassingCases, 0);
  assert.equal(object(capture.backend).runId, binding.backendRunId);
  assert.match(String(capture.fixtureHash), /^[a-f0-9]{64}$/);
  assert.equal(capture.result, 'harness-blocked');
  assert.equal(capture.cleanup, 'cleaned');
  assert.deepEqual(capture.source, capture.sourceAfter);
  assert.deepEqual(capture.helperInputsBefore, capture.helperInputsAfter);
  assert(capture.source && capture.helperInputsBefore);
  const source = object(capture.source);
  assert.match(String(source.sha), /^[a-f0-9]{40}$/);
  assert.match(String(source.sourceTreeHash), /^[a-f0-9]{64}$/);
  assert(Array.isArray(capture.helperInputsBefore) && capture.helperInputsBefore.length > 0);
  assert.equal(object(capture.toolVersions).maestro, '2.6.1');
  assert.deepEqual(capture.acquisitionIntents, [
    'adb',
    platform === 'android' ? 'emulator' : 'simulator',
    'backend',
    'proxy',
    'expo',
  ]);
  assert(!capture.deadline && !capture.budgetTimeout && !capture.runtimeQualificationRejected);
  const device = object(capture.device);
  const api = json(root, `${failure.label}-failure-health.private.json`);
  assert.deepEqual(api, {
    kind: 'owned native failure diagnostic API health',
    captureRunId: binding.captureRunId,
    apiOrigin: object(capture.build).apiOrigin,
    status: 200,
  });
  const health = object(capture.deviceHealthOnFailure);
  if (platform === 'android')
    requireAndroidFailureDeviceHealth(root, failure.label, device, health);
  else {
    assert.equal(health.udid, device.udid);
    assert.equal(health.state, 'Booted');
    assert.equal(health.isAvailable, true);
  }
  assert(Array.isArray(capture.commandExecutions));
  const commands = (capture.commandExecutions as unknown[]).map(object);
  requireQualifiedNativeQuantityCommandHistory(commands, platform, String(failure.label));
  const step = commands.filter(
    (x) =>
      x.label === (platform === 'android' ? `${String(failure.label)}-readiness` : failure.label),
  );
  assert.equal(step.length, 1);
  assert.equal(step[0].execution, 'child-failed');
  assert.equal(step[0].cleanup, 'cleaned');
  assert.equal(step[0].childExitCode, 1);
  assert.equal(step[0].childSignal, null);
  assert(commands.every((x) => x.cleanup === 'cleaned'));
  assert(
    commands.every((x) => x === step[0] || (x.execution === 'completed' && x.childExitCode === 0)),
  );
  const diagnostic = commands.filter(
    (x) => x.label === `${String(failure.label)}-failure-hierarchy`,
  );
  assert.equal(diagnostic.length, 1);
  if (platform === 'android')
    for (const phase of ['before', 'after'])
      for (const kind of ['boot', 'state']) {
        const reads = commands.filter(
          (x) => x.label === `${String(failure.label)}-failure-device-${phase}-${kind}`,
        );
        assert.equal(reads.length, 1, 'Missing original owned Android device health command');
        assert.equal(reads[0].execution, 'completed');
        assert.equal(reads[0].childExitCode, 0);
        assert.equal(reads[0].childSignal, null);
        assert.equal(
          reads[0].logPath,
          path.join(root, `${String(failure.label)}-failure-device-${phase}-${kind}.private.log`),
        );
      }
  assertNativeBootstrapHealthy(readNativeEvidence(root, 'bootstrap.private.log', true).toString());
  const cleanup = json(root, 'external-cleanup.private.json');
  if (platform === 'android') requireFullAndroidTrainingFailureCleanupEvidence(root, cleanup);
  else assert.equal(cleanup.kind, 'independent ios native inventory cleanup proof');
  assert.equal(cleanup.result, 'passed');
  assert.equal(cleanup.runId, binding.captureRunId);
  assert.equal(cleanup.captureResult, capture.result);
  assert.equal(cleanup.captureCleanupClean, true);
  assert(Number.isSafeInteger(cleanup.pidStartPairs) && Number(cleanup.pidStartPairs) > 0);
  for (const key of ['survivors', 'unknownProcessQueries', 'missingForeignDevices'])
    assert.deepEqual(cleanup[key], []);
  assert.equal(cleanup.ownedDeviceAbsent, true);
  assert.equal(cleanup.cacheAbsent, true);
  assert.deepEqual(cleanup.docker, { container: [], network: [], volume: [] });
  const ledger = requireNativePilotAssertions(options.selection).find(
    (row) => row.id === contract.assertionId,
  );
  assert(ledger);
  return {
    assertionId: ledger.id,
    requirementRefs: ledger.requirementRefs,
    label: failure.label,
    candidateHash: digest(readNativeEvidence(root, failurePath, true)),
    paths: [
      failurePath,
      ...expectedPaths,
      'training-attempt-binding.private.json',
      'capture.private.json',
      'external-cleanup.private.json',
      'bootstrap.private.log',
    ],
  };
}

/** Exclusively copy only qualified failure bytes. This never emits a public pass. */
export async function stageNativeQuantityFailure(
  options: Parameters<typeof readQualifiedNativeQuantityFailure>[0] & { outputRoot: string },
) {
  assert.equal(await realpath(options.outputRoot), path.resolve(options.outputRoot));
  const output = await lstat(options.outputRoot);
  assert(output.isDirectory() && output.uid === process.getuid?.());
  assert.equal(output.mode & 0o777, 0o700);
  assert.equal(path.basename(options.outputRoot), options.requestedRunId);
  requireNoNativeCensusFailure(options.outputRoot);
  const proof = readQualifiedNativeQuantityFailure(options);
  const adapter = json(options.captureRoot, 'runtime-adapter.private.json');
  const platform = options.selection.arguments.platform;
  assert.equal(adapter.kind, `private-owned-${platform}-training-attempt-not-public-receipt`);
  assert.equal(adapter.fixtureRunId, options.fixtureRunId);
  assert.equal(adapter.requestedRunId, options.requestedRunId);
  assert.equal(adapter.requestedAttemptId, `${options.requestedRunId}:first`);
  assert.equal(adapter.captureRunId, path.basename(options.captureRoot));
  assert.equal(adapter.captureExitCode, 2);
  assert.equal(adapter.captureResult, 'harness-blocked');
  assert.equal(adapter.callbackInvocations, 1);
  assert.equal(adapter.callbackCompleted, false);
  assert.equal(adapter.childExitCode, 1);
  assert(Object.hasOwn(adapter, 'childSignal') && adapter.childSignal === null);
  assert.equal(adapter.externalCleanupResult, 'passed');
  assert.equal(adapter.verificationResult, 'application-failed');
  assert.deepEqual(adapter.assertionBindings, []);
  assert.deepEqual(adapter.applicationFailure, {
    assertionId: proof.assertionId,
    label: proof.label,
    candidateHash: proof.candidateHash,
  });
  const capture = json(options.captureRoot, 'capture.private.json');
  if (platform === 'ios') assert.equal(adapter.captureCleanup, capture.cleanup);
  const rawHistory = requireQualifiedNativeQuantityCommandHistory(
    capture.commandExecutions,
    platform,
    proof.label,
  );
  const adapterHistory = requireQualifiedNativeQuantityCommandHistory(
    adapter.commandDiagnostics,
    platform,
    proof.label,
  );
  assert.deepEqual(
    adapterHistory.commands,
    rawHistory.commands,
    'Adapter command diagnostics differ from original capture',
  );
  assert(Array.isArray(adapter.censusFailures));
  assert.deepEqual(
    adapter.censusFailures,
    rawHistory.censusFailures,
    'Adapter census failures differ from original capture',
  );
  const rows: { path: string; sha256: string }[] = [];
  for (const relative of [...proof.paths, 'runtime-adapter.private.json']) {
    const bytes = readNativeEvidence(options.captureRoot, relative, !relative.endsWith('.png'));
    const target = `application-failure/${relative}`;
    await mkdir(path.dirname(path.join(options.outputRoot, target)), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(path.join(options.outputRoot, target), bytes, { flag: 'wx', mode: 0o600 });
    rows.push({ path: target, sha256: digest(bytes) });
  }
  const manifest = {
    kind: 'exclusive native failure byte manifest',
    requestedRunId: options.requestedRunId,
    captureRunId: path.basename(options.captureRoot),
    fixtureRunId: options.fixtureRunId,
    scenarioHash: options.selection.scenarioHash,
    requirementHash: options.selection.requirementHash,
    files: rows,
  };
  const manifestPath = 'application-failure/manifest.private.json';
  await writeFile(path.join(options.outputRoot, manifestPath), JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  const manifestHash = digest(readNativeEvidence(options.outputRoot, manifestPath, true));
  await verifyStagedNativeQuantityFailure(options.outputRoot, manifestHash);
  return {
    manifestHash,
    artifacts: [manifestPath, ...rows.map((row) => row.path)],
    assertion: {
      id: proof.assertionId,
      requirementRefs: proof.requirementRefs,
      outcome: 'failed' as const,
      evidencePaths: rows.map((row) => row.path),
    },
  };
}
export async function verifyStagedNativeQuantityFailure(
  root: string,
  expectedManifestHash: string,
) {
  assert.equal(await realpath(root), path.resolve(root));
  requireNoNativeCensusFailure(root);
  const bytes = readNativeEvidence(root, 'application-failure/manifest.private.json', true);
  assert.equal(digest(bytes), expectedManifestHash);
  const manifest = object(JSON.parse(bytes.toString()) as unknown);
  assert.equal(manifest.requestedRunId, path.basename(root));
  assert(Array.isArray(manifest.files));
  for (const entry of manifest.files as unknown[]) {
    const row = object(entry);
    assert(typeof row.path === 'string' && row.path.startsWith('application-failure/'));
    assert.equal(digest(readNativeEvidence(root, row.path, true)), row.sha256);
  }
}

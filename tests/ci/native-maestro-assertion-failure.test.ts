import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  findMaestroQuantityFailureCommands,
  readQualifiedNativeQuantityFailure,
  recordNativeQuantityFailure,
  requireMaestroQuantityAssertionFailure,
  stageNativeQuantityFailure,
  verifyStagedNativeQuantityFailure,
} from '../../scripts/testing/native-maestro-assertion-failure';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import { writeNativeTrainingAttemptBinding } from '../../scripts/testing/native-training-attempt-binding';
import {
  nativeTrainingQuantityContract,
  nativeTrainingQuantityYaml,
} from '../../scripts/testing/native-training-quantity-contract';

const label = 'journey-first-save-reopened';
const exerciseName = 'en QA Exercise 1';
const contract = nativeTrainingQuantityContract(label, exerciseName);
function commands() {
  const command = {
    assertConditionCommand: {
      condition: {
        visible: { idRegex: contract.idRegex, textRegex: contract.textRegex, optional: false },
      },
      optional: false,
      timeout: '7000',
    },
  };
  const setup = {
    command: { applyConfigurationCommand: {} },
    metadata: { status: 'COMPLETED', sequenceNumber: 0 },
  };
  const failure = {
    command,
    metadata: {
      status: 'FAILED',
      sequenceNumber: 1,
      timestamp: 1_790_000_000_000,
      evaluatedCommand: command,
      error: {
        message: 'Assertion is false: required quantity',
        stackTrace: [
          { className: 'maestro.orchestra.Orchestra', methodName: 'assertConditionCommand' },
        ],
      },
    },
  };
  return [setup, failure] as [typeof setup, typeof failure];
}
void test('required quantity contracts use exact native selectors and fixed documented values', () => {
  assert.equal(contract.assertionId, 'NAT-training-first-save');
  assert.equal(contract.expected, '3x8');
  assert.equal(
    nativeTrainingQuantityContract('journey-edit-preview', exerciseName).expected,
    '4x10',
  );
  assert(nativeTrainingQuantityYaml(label, exerciseName).includes('text: "^3x8$"'));
  assert.throws(() => nativeTrainingQuantityContract('password-save-prompt', exerciseName));
});
void test('only one required failed quantity command with completed predecessors qualifies; synthetic parser control', () => {
  assert.equal(requireMaestroQuantityAssertionFailure(commands(), contract).sequenceNumber, 1);
  const bad: unknown[] = [null, [], commands().slice(1), [...commands(), commands()[1]]];
  for (const change of [
    'optional',
    'selector',
    'text',
    'error',
    'stack',
    'prior-failed',
    'evaluated',
    'duplicate-sequence',
    'later-completed',
  ]) {
    const rows = commands();
    const row = rows[1];
    if (change === 'optional') row.command.assertConditionCommand.optional = true;
    if (change === 'selector')
      row.command.assertConditionCommand.condition.visible.idRegex = '^other$';
    if (change === 'text')
      row.command.assertConditionCommand.condition.visible.textRegex = '^4x10$';
    if (change === 'error') row.metadata.error.message = 'Driver RPC unavailable';
    if (change === 'stack') row.metadata.error.stackTrace[0].className = 'maestro.IOSDriver';
    if (change === 'prior-failed') rows[0].metadata.status = 'FAILED';
    if (change === 'evaluated')
      row.metadata.evaluatedCommand = {
        assertConditionCommand: { ...row.command.assertConditionCommand, timeout: '90000' },
      };
    if (change === 'duplicate-sequence') row.metadata.sequenceNumber = 0;
    if (change === 'later-completed') rows[0].metadata.sequenceNumber = 2;
    bad.push(rows);
  }
  for (const value of bad)
    assert.throws(() => requireMaestroQuantityAssertionFailure(value, contract));
});
for (const platform of ['ios', 'android'] as const)
  void test(`${platform} failure bytes are bound, qualified and copied exclusively; synthetic boundary proof is not a native result`, async () => {
    const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
    const selection = await selectNativePilotScenario(
      { platform, engine: 'maestro', scenario: `SCN-training-${platform}`, mode: 'integration' },
      JSON.parse(
        await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
      ),
      repositoryRoot,
    );
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-failure-')));
    const captureRoot = path.join(temporary, 'a'.repeat(24));
    const outputRoot = path.join(temporary, 'b'.repeat(24));
    const fixtureRunId = 'c'.repeat(24);
    await mkdir(captureRoot, { mode: 0o700 });
    await mkdir(outputRoot, { mode: 0o700 });
    const write = async (relative: string, value: unknown) => {
      await mkdir(path.dirname(path.join(captureRoot, relative)), { recursive: true, mode: 0o700 });
      await writeFile(path.join(captureRoot, relative), JSON.stringify(value), { mode: 0o600 });
    };
    const input = {
      platform,
      runId: fixtureRunId,
      attemptId: `${fixtureRunId}:first`,
      accountUid: 'coach',
      exerciseId: 'exercise',
      exerciseName,
    };
    const title = `QA training ${input.attemptId}`;
    const commandsPath = `${label}-artifacts/2026-09-29_180000/commands-(${label}.yaml).json`;
    const hierarchyPath = `${label}-failure-hierarchy.json`;
    const screenshotPath = `${label}-failure.png`;
    const hierarchy = {
      children: [
        {
          attributes: {
            'resource-id': 'pro.training_plan.name',
            ...(platform === 'android' ? { text: title } : { value: title }),
          },
        },
        {
          attributes: { 'resource-id': 'pro.training_plan.sessionRow.Strength' },
          children: [
            { attributes: { 'resource-id': contract.selectorId.replace(/\.quantity$/, '') } },
            {
              attributes: {
                'resource-id': contract.selectorId,
                ...(platform === 'android' ? { text: '4x10' } : { accessibilityText: '4x10' }),
              },
            },
          ],
        },
      ],
    };
    const capture = {
      kind: 'private-owned-native-training-execution-not-public-receipt',
      mode: 'integration',
      platform,
      charter: 'training-journey',
      nativePassingCases: 0,
      backend: { runId: fixtureRunId },
      fixtureHash: 'f'.repeat(64),
      result: 'harness-blocked',
      cleanup: 'cleaned',
      source: { sha: 'd'.repeat(40), dirty: true, sourceTreeHash: 'e'.repeat(64) },
      sourceAfter: { sha: 'd'.repeat(40), dirty: true, sourceTreeHash: 'e'.repeat(64) },
      helperInputsBefore: [{ path: 'source.ts', sha256: 'f'.repeat(64) }],
      helperInputsAfter: [{ path: 'source.ts', sha256: 'f'.repeat(64) }],
      device:
        platform === 'ios'
          ? { udid: 'owned' }
          : { serial: 'emulator-5554', avd: 'owned-avd', runId: 'd'.repeat(24) },
      build: { apiOrigin: 'http://127.0.0.1:12345' },
      deviceHealthOnFailure:
        platform === 'ios'
          ? { udid: 'owned', state: 'Booted', isAvailable: true }
          : {
              serial: 'emulator-5554',
              avd: 'owned-avd',
              ownerRunId: 'd'.repeat(24),
              bootCompleted: '1',
              state: 'device',
            },
      acquisitionIntents: [
        'adb',
        platform === 'ios' ? 'simulator' : 'emulator',
        'backend',
        'proxy',
        'expo',
      ],
      toolVersions: { maestro: '2.6.1' },
      commandExecutions: [
        {
          label: platform === 'ios' ? label : `${label}-readiness`,
          phase: 'step',
          execution: 'child-failed',
          cleanup: 'cleaned',
          childExitCode: 1,
          childSignal: null,
          deadlineMs: 120_000,
        },
        {
          label: `${label}-failure-hierarchy`,
          phase: 'step',
          execution: 'completed',
          cleanup: 'cleaned',
          childExitCode: 0,
          childSignal: null,
          deadlineMs: 120_000,
        },
      ],
    };
    const options = {
      captureRoot,
      requestedRunId: path.basename(outputRoot),
      fixtureRunId,
      selection,
    };
    try {
      await writeNativeTrainingAttemptBinding({
        repositoryRoot,
        artifactRoot: captureRoot,
        requestedRunId: options.requestedRunId,
        backendRunId: fixtureRunId,
        selection,
      });
      await write(`training-journey-quantity-${label}.private.json`, {
        schemaVersion: 1,
        kind: 'required native training quantity assertion',
        captureRunId: path.basename(captureRoot),
        input,
        title,
        ...contract,
      });
      await writeFile(
        path.join(captureRoot, `${label}.yaml`),
        'appId: owned\n---\n' + nativeTrainingQuantityYaml(label, exerciseName),
        { mode: 0o600 },
      );
      await write(commandsPath, commands());
      await write(hierarchyPath, hierarchy);
      await write(`${label}-failure-health.private.json`, {
        kind: 'owned native failure diagnostic API health',
        captureRunId: path.basename(captureRoot),
        apiOrigin: capture.build.apiOrigin,
        status: 200,
      });
      await writeFile(
        path.join(captureRoot, screenshotPath),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        { mode: 0o600 },
      );
      if (platform === 'android') {
        for (const phase of ['before', 'after'])
          for (const [kind, value] of [
            ['boot', '1'],
            ['state', 'device'],
          ]) {
            const commandLabel = `${label}-failure-device-${phase}-${kind}`;
            const logPath = path.join(captureRoot, `${commandLabel}.private.log`);
            await writeFile(logPath, value + '\n', { mode: 0o600 });
            capture.commandExecutions.push({
              label: commandLabel,
              phase: 'step',
              execution: 'completed',
              cleanup: 'cleaned',
              childExitCode: 0,
              childSignal: null,
              deadlineMs: 60_000,
              logPath,
            } as (typeof capture.commandExecutions)[number]);
          }
        await write(`${label}-failure-device-health.private.json`, {
          kind: 'owned Android failure diagnostic device health',
          captureRunId: path.basename(captureRoot),
          before: capture.deviceHealthOnFailure,
          after: capture.deviceHealthOnFailure,
        });
      }
      // A real wrong value in the exact title/session is required, even when raw
      // command metadata says the assertion failed. These reject before a candidate exists.
      for (const fault of [
        'correct-value',
        'wrong-title',
        'missing-session',
        'duplicate-quantity',
        'wrong-platform-attribute',
      ]) {
        const bad = structuredClone(hierarchy);
        if (fault === 'wrong-title')
          Object.assign(
            bad.children[0].attributes,
            platform === 'android' ? { text: 'foreign' } : { value: 'foreign' },
          );
        if (fault === 'missing-session')
          bad.children[1].attributes['resource-id'] = 'foreign-session';
        const quantity = bad.children[1].children![1];
        if (fault === 'correct-value')
          Object.assign(
            quantity.attributes,
            platform === 'android' ? { text: '3x8' } : { accessibilityText: '3x8' },
          );
        if (fault === 'duplicate-quantity')
          bad.children[1].children!.push(structuredClone(quantity));
        if (fault === 'wrong-platform-attribute') {
          delete (quantity.attributes as Record<string, unknown>)[
            platform === 'android' ? 'text' : 'accessibilityText'
          ];
          Object.assign(
            quantity.attributes,
            platform === 'android' ? { accessibilityText: '4x10' } : { text: '4x10' },
          );
        }
        await write(hierarchyPath, bad);
        await assert.rejects(
          recordNativeQuantityFailure({
            root: captureRoot,
            label,
            commandsPath,
            hierarchyPath,
            screenshotPath,
          }),
        );
        assert(!(await readdir(captureRoot)).includes('native-application-failure.private.json'));
      }
      await write(hierarchyPath, hierarchy);
      assert.equal(await findMaestroQuantityFailureCommands(captureRoot, label), commandsPath);
      await recordNativeQuantityFailure({
        root: captureRoot,
        label,
        commandsPath,
        hierarchyPath,
        screenshotPath,
      });
      await assert.rejects(
        recordNativeQuantityFailure({
          root: captureRoot,
          label,
          commandsPath,
          hierarchyPath,
          screenshotPath,
        }),
        { code: 'EEXIST' },
      );
      await write('capture.private.json', capture);
      const cleanup = {
        kind:
          platform === 'ios'
            ? 'independent ios native inventory cleanup proof'
            : 'independent android native cleanup proof',
        result: 'passed',
        runId: path.basename(captureRoot),
        captureResult: capture.result,
        captureCleanupClean: true,
        pidStartPairs: 10,
        nativePassingCases: 0,
        acquisitions: ['adb', 'emulator', 'backend', 'proxy', 'expo'],
        unavailablePorts: [],
        defaultAdbPreserved: true,
        foreignAvdsPreserved: true,
        deletedOwnedDirectories: 6,
        survivors: [],
        unknownProcessQueries: [],
        missingForeignDevices: [],
        ownedDeviceAbsent: true,
        cacheAbsent: true,
        docker: { container: [], network: [], volume: [] },
      };
      await write('external-cleanup.private.json', cleanup);
      await writeFile(
        path.join(captureRoot, 'bootstrap.private.log'),
        'synthetic healthy bootstrap',
        { mode: 0o600 },
      );
      const proof = readQualifiedNativeQuantityFailure(options);
      assert.equal(proof.assertionId, 'NAT-training-first-save');
      for (const change of [
        'cleanup',
        'device',
        'source',
        'deadline',
        'child',
        'cancelled',
        'bootstrap',
        'wrong-request',
        'platform',
        'backend',
        'fixture',
        'passes',
        ...(platform === 'android'
          ? [
              'missing-boot-command',
              'foreign-boot-log',
              'bad-health-command-child',
              'crossed-device-owner',
              'unbooted-device',
            ]
          : []),
      ]) {
        const value = structuredClone(capture);
        if (change === 'cleanup') value.cleanup = 'failed';
        if (change === 'platform') value.platform = platform === 'ios' ? 'android' : 'ios';
        if (change === 'backend') value.backend.runId = '0'.repeat(24);
        if (change === 'fixture') value.fixtureHash = 'invalid';
        if (change === 'passes') value.nativePassingCases = 1;
        if (change === 'missing-boot-command') value.commandExecutions.splice(2, 1);
        if (change === 'foreign-boot-log')
          Object.assign(value.commandExecutions[2], {
            logPath: '/private/unowned/boot.private.log',
          });
        if (change === 'bad-health-command-child') value.commandExecutions[2].childExitCode = 7;
        if (change === 'crossed-device-owner')
          Object.assign(value.device, { runId: '0'.repeat(24) });
        if (change === 'unbooted-device')
          Object.assign(value.deviceHealthOnFailure, { bootCompleted: '0' });
        if (change === 'device') value.deviceHealthOnFailure.state = 'Shutdown';
        if (change === 'source') value.sourceAfter.sourceTreeHash = '0'.repeat(64);
        if (change === 'child') value.commandExecutions[0].childExitCode = 2;
        if (change === 'cancelled') value.result = 'cancelled';
        await write(
          'capture.private.json',
          change === 'deadline' ? { ...value, deadline: { step: label } } : value,
        );
        if (change === 'bootstrap')
          await writeFile(
            path.join(captureRoot, 'bootstrap.private.log'),
            'Cannot find native module',
            { mode: 0o600 },
          );
        assert.throws(() =>
          readQualifiedNativeQuantityFailure(
            change === 'wrong-request' ? { ...options, requestedRunId: '0'.repeat(24) } : options,
          ),
        );
        await writeFile(
          path.join(captureRoot, 'bootstrap.private.log'),
          'synthetic healthy bootstrap',
          { mode: 0o600 },
        );
      }
      await write('capture.private.json', capture);
      for (const altered of [
        { ...cleanup, runId: '0'.repeat(24) },
        { ...cleanup, pidStartPairs: 0 },
        { ...cleanup, survivors: [{ pid: 123 }] },
        { ...cleanup, unknownProcessQueries: [123] },
        { ...cleanup, missingForeignDevices: ['changed'] },
        { ...cleanup, ownedDeviceAbsent: false },
        { ...cleanup, cacheAbsent: false },
        { ...cleanup, docker: { ...cleanup.docker, volume: ['leak'] } },
        ...(platform === 'android'
          ? [
              { ...cleanup, kind: 'independent ios native inventory cleanup proof' },
              { ...cleanup, acquisitions: ['adb', 'emulator'] },
              { ...cleanup, unavailablePorts: [1234] },
              { ...cleanup, defaultAdbPreserved: false },
              { ...cleanup, foreignAvdsPreserved: false },
              { ...cleanup, deletedOwnedDirectories: 5 },
            ]
          : []),
      ]) {
        await write('external-cleanup.private.json', altered);
        assert.throws(() => readQualifiedNativeQuantityFailure(options));
      }
      await write('external-cleanup.private.json', cleanup);
      for (const relative of [
        commandsPath,
        hierarchyPath,
        screenshotPath,
        `${label}.yaml`,
        `${label}-failure-health.private.json`,
        ...(platform === 'android'
          ? [
              `${label}-failure-device-health.private.json`,
              ...['before', 'after'].flatMap((phase) =>
                ['boot', 'state'].map(
                  (kind) => `${label}-failure-device-${phase}-${kind}.private.log`,
                ),
              ),
            ]
          : []),
      ]) {
        const bytes = await readFile(path.join(captureRoot, relative));
        await writeFile(path.join(captureRoot, relative), 'corrupted original evidence', {
          mode: 0o600,
        });
        assert.throws(() => readQualifiedNativeQuantityFailure(options));
        await writeFile(path.join(captureRoot, relative), bytes, { mode: 0o600 });
      }
      assert.equal(readQualifiedNativeQuantityFailure(options).candidateHash, proof.candidateHash);
      const extra = path.join(captureRoot, `${label}-artifacts`, '2026-09-29_180001');
      await mkdir(extra, { mode: 0o700 });
      await assert.rejects(findMaestroQuantityFailureCommands(captureRoot, label));
      await rm(extra, { recursive: true });
      const adapter = {
        kind:
          platform === 'android'
            ? 'private-owned-android-training-attempt-not-public-receipt'
            : 'private-owned-ios-training-attempt-not-public-receipt',
        fixtureRunId,
        captureExitCode: 2,
        captureCleanup: 'cleaned',
        captureResult: 'harness-blocked',
        assertionBindings: [],
        requestedRunId: options.requestedRunId,
        requestedAttemptId: `${options.requestedRunId}:first`,
        captureRunId: path.basename(captureRoot),
        callbackInvocations: 1,
        callbackCompleted: false,
        childExitCode: 1,
        childSignal: null,
        externalCleanupResult: 'passed',
        verificationResult: 'application-failed',
        commandDiagnostics: capture.commandExecutions,
        censusFailures: [],
        applicationFailure: {
          assertionId: proof.assertionId,
          label: proof.label,
          candidateHash: proof.candidateHash,
        },
      };
      await write('runtime-adapter.private.json', adapter);
      const sidecarPath = 'unattached-controller.census-failure.private.json';
      await writeFile(path.join(captureRoot, sidecarPath), 'unattached', {
        flag: 'wx',
        mode: 0o600,
      });
      assert.throws(() => readQualifiedNativeQuantityFailure(options), /census failure/);
      await rm(path.join(captureRoot, sidecarPath));
      await writeFile(path.join(outputRoot, sidecarPath), 'unattached', {
        flag: 'wx',
        mode: 0o600,
      });
      await assert.rejects(
        stageNativeQuantityFailure({ ...options, outputRoot }),
        /census failure/,
      );
      await rm(path.join(outputRoot, sidecarPath));
      const missingSignal = structuredClone(capture);
      delete (missingSignal.commandExecutions[1] as Record<string, unknown>).childSignal;
      await write('capture.private.json', missingSignal);
      await write('runtime-adapter.private.json', {
        ...adapter,
        commandDiagnostics: missingSignal.commandExecutions,
      });
      await assert.rejects(stageNativeQuantityFailure({ ...options, outputRoot }));
      const mixedHistory = structuredClone(capture);
      Object.assign(mixedHistory.commandExecutions[1], {
        execution: 'deadline',
        childExitCode: null,
      });
      await write('capture.private.json', mixedHistory);
      await write('runtime-adapter.private.json', {
        ...adapter,
        commandDiagnostics: mixedHistory.commandExecutions,
      });
      await assert.rejects(stageNativeQuantityFailure({ ...options, outputRoot }));
      await write('capture.private.json', capture);
      const mismatchedDiagnostics = structuredClone(capture.commandExecutions);
      mismatchedDiagnostics[1].label = 'tampered-completed-step';
      await write('runtime-adapter.private.json', {
        ...adapter,
        commandDiagnostics: mismatchedDiagnostics,
      });
      await assert.rejects(stageNativeQuantityFailure({ ...options, outputRoot }));
      await write('runtime-adapter.private.json', {
        ...adapter,
        censusFailures: [{ publication: 'unexpected' }],
      });
      await assert.rejects(stageNativeQuantityFailure({ ...options, outputRoot }));
      for (const patch of [
        {
          kind:
            platform === 'ios'
              ? 'private-owned-android-training-attempt-not-public-receipt'
              : 'private-owned-ios-training-attempt-not-public-receipt',
        },
        { captureExitCode: 0 },
        ...(platform === 'ios' ? [{ captureCleanup: 'not-acquired' }] : []),
        { captureResult: 'observed' },
        { requestedAttemptId: `${options.requestedRunId}:retry` },
      ]) {
        await write('runtime-adapter.private.json', { ...adapter, ...patch });
        await assert.rejects(stageNativeQuantityFailure({ ...options, outputRoot }));
      }
      await write('runtime-adapter.private.json', adapter);
      if (platform === 'android') {
        for (const patch of [
          { assertionBindings: [{ id: 'NAT-training-local-draft' }] },
          { fixtureRunId: '0'.repeat(24) },
        ]) {
          await write('runtime-adapter.private.json', { ...adapter, ...patch });
          await assert.rejects(stageNativeQuantityFailure({ ...options, outputRoot }));
          assert.deepEqual(await readdir(outputRoot), []);
        }
        await write('runtime-adapter.private.json', adapter);
      }
      const staged = await stageNativeQuantityFailure({ ...options, outputRoot });
      assert.equal(staged.assertion.outcome, 'failed');
      assert.equal(staged.assertion.id, 'NAT-training-first-save');
      await assert.rejects(stageNativeQuantityFailure({ ...options, outputRoot }), {
        code: 'EEXIST',
      });
      const copied = path.join(outputRoot, 'application-failure', commandsPath);
      await writeFile(copied, 'changed bytes', { mode: 0o600 });
      await assert.rejects(verifyStagedNativeQuantityFailure(outputRoot, staged.manifestHash));
      await rm(copied);
      await symlink(path.join(captureRoot, commandsPath), copied);
      await assert.rejects(verifyStagedNativeQuantityFailure(outputRoot, staged.manifestHash));
      assert((await readdir(outputRoot)).every((name) => name !== 'receipt.json'));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

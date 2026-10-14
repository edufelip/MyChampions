import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  lstat,
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
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from '../../scripts/testing/native-pilot-contract';
import {
  requireNativeTrainingAttemptBinding,
  writeNativeTrainingAttemptBinding,
} from '../../scripts/testing/native-training-attempt-binding';
import {
  NativeTrainingPublicEvidenceStageError,
  stageNativeTrainingPublicEvidence,
  verifyStagedNativeTrainingEvidence,
} from '../../scripts/testing/native-training-public-evidence';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type { NativeTrainingPublicEvidenceLifecycle } from '../../scripts/testing/native-training-public-evidence';

for (const platform of ['ios', 'android'] as const) {
  void test(`${platform} native staging verifies identity and original references before exclusive private copying; synthetic boundary only`, async () => {
    const repositoryRoot = await realpath(
      process.env.MYCHAMPIONS_REVIEW_REPOSITORY_ROOT ?? path.resolve(__dirname, '../..'),
    );
    const inventory = JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ) as { scenarios: NativePilotSelection['scenario'][] };
    const syntheticSelection = process.env.MYCHAMPIONS_REVIEW_SYNTHETIC_SELECTION === '1';
    const selection: NativePilotSelection = syntheticSelection
      ? (() => {
          const scenario = inventory.scenarios.find(
            (candidate: { id?: string }) => candidate.id === `SCN-training-${platform}`,
          );
          assert(scenario, `Missing synthetic training scenario: ${platform}`);
          return {
            arguments: {
              platform,
              engine: 'maestro',
              scenario: `SCN-training-${platform}`,
              mode: 'integration',
            },
            scenario: structuredClone(scenario),
            scenarioHash: 'a'.repeat(64),
            requirementHash: 'b'.repeat(64),
          };
        })()
      : await selectNativePilotScenario(
          {
            platform,
            engine: 'maestro',
            scenario: `SCN-training-${platform}`,
            mode: 'integration',
          },
          inventory,
          repositoryRoot,
        );
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-stage-')));
    const captureRoot = path.join(temporary, 'a'.repeat(24));
    const outputRoot = path.join(temporary, 'b'.repeat(24));
    const fixtureRunId = 'c'.repeat(24);
    await mkdir(captureRoot, { mode: 0o700 });
    await mkdir(outputRoot, { mode: 0o700 });
    const write = async (relative: string, value: unknown) => {
      const file = path.join(captureRoot, relative);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, JSON.stringify(value), { mode: 0o600 });
    };
    try {
      const requestedRunId = path.basename(outputRoot);
      const attemptBinding = syntheticSelection
        ? requireNativeTrainingAttemptBinding(
            {
              schemaVersion: 1,
              kind: 'private-native-training-attempt-binding-not-public-receipt',
              requestedRunId,
              requestedAttemptId: `${requestedRunId}:first`,
              captureRunId: path.basename(captureRoot),
              backendRunId: fixtureRunId,
              backendAttemptId: `${fixtureRunId}:first`,
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
            },
            {
              requestedRunId,
              captureRunId: path.basename(captureRoot),
              backendRunId: fixtureRunId,
              selection,
            },
          )
        : await writeNativeTrainingAttemptBinding({
            repositoryRoot,
            artifactRoot: captureRoot,
            requestedRunId,
            backendRunId: fixtureRunId,
            selection,
          });
      if (syntheticSelection)
        await writeFile(
          path.join(captureRoot, 'training-attempt-binding.private.json'),
          JSON.stringify(attemptBinding, null, 2),
          { flag: 'wx', mode: 0o600 },
        );
      const sourceBytes = Buffer.from('synthetic controlled bytes, not native proof');
      await writeFile(path.join(captureRoot, 'checkpoint.private.json'), sourceBytes, {
        mode: 0o600,
      });
      const sha256 = createHash('sha256').update(sourceBytes).digest('hex');
      const readerPaths =
        platform === 'android'
          ? [
              'android-input-reader-identity.private.json',
              'android-input-reader/input-reader.apk',
              'journey-edit-title-cleared-native-input.private.json',
              'android-input-reader-journey-edit-title-cleared-read.private.log',
            ]
          : [];
      for (const relative of readerPaths) {
        await mkdir(path.dirname(path.join(captureRoot, relative)), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(path.join(captureRoot, relative), sourceBytes, { mode: 0o600 });
      }
      const ledger = requireNativePilotAssertions(selection);
      const bindings = ledger.map((row) => ({
        id: row.id,
        requirementRefs: row.requirementRefs,
        evidencePaths: row.evidencePathTemplates!.map((p) =>
          p.replace('{attemptId}', fixtureRunId + ':first'),
        ),
      }));
      for (const [index, row] of ledger.entries()) {
        for (const [kindIndex, evidenceKind] of row.evidenceKinds.entries()) {
          await write(bindings[index].evidencePaths[kindIndex], {
            schemaVersion: 1,
            kind: 'native-training-assertion-evidence-preparation',
            purpose: 'runtime',
            assertionId: row.id,
            evidenceKind,
            requirementRefs: row.requirementRefs,
            fixtureRunId,
            attemptId: fixtureRunId + ':first',
            scenarioHash: selection.scenarioHash,
            requirementHash: selection.requirementHash,
            nativePassingCases: 0,
            references: [
              { path: 'checkpoint.private.json', sha256 },
              ...(row.id === 'NAT-training-edit-draft' && evidenceKind === 'ui'
                ? readerPaths.map((path) => ({ path, sha256 }))
                : []),
            ],
          });
        }
      }
      const command = {
        label: 'journey-library-readiness',
        phase: 'step',
        execution: 'completed',
        cleanup: 'cleaned',
        childExitCode: 0,
        childSignal: null,
        deadlineMs: 180_000,
        censusFailure: null,
        outputFailure: null,
      };
      const adapter = {
        kind: `private-owned-${platform}-training-attempt-not-public-receipt`,
        requestedRunId: path.basename(outputRoot),
        requestedAttemptId: path.basename(outputRoot) + ':first',
        captureRunId: path.basename(captureRoot),
        captureExitCode: 0,
        captureCleanup: 'cleaned',
        childExitCode: 0,
        callbackInvocations: 1,
        callbackCompleted: true,
        externalCleanupResult: 'passed',
        verificationResult: 'passed',
        assertionBindings: bindings,
        commandDiagnostics: [command],
        censusFailures: [],
        outputFailures: [],
      };
      const cleanup = {
        result: 'passed',
        runId: path.basename(captureRoot),
        ...(platform === 'android'
          ? {
              kind: 'independent android native cleanup proof',
              captureResult: 'observed',
              captureCleanupClean: true,
              nativePassingCases: 0,
              acquisitions: ['adb', 'emulator', 'backend', 'proxy', 'expo'],
              pidStartPairs: 2,
              survivors: [],
              unknownProcessQueries: [],
              missingForeignDevices: [],
              unavailablePorts: [],
              ownedDeviceAbsent: true,
              cacheAbsent: true,
              defaultAdbPreserved: true,
              foreignAvdsPreserved: true,
              deletedOwnedDirectories: 6,
              docker: { container: [], network: [], volume: [] },
            }
          : {}),
      };
      const metadata = {
        requestedAttemptId: attemptBinding.requestedAttemptId,
        selection: attemptBinding.selection,
        input: { runId: fixtureRunId, attemptId: fixtureRunId + ':first', platform },
        sixSqlCheckpoints: true,
        threeAuthenticatedApiReads: true,
        savedPlanDurableAfterRestart: true,
        publicNativePassingCases: 0,
      };
      await write('training-runtime-metadata.private.json', metadata);
      await write('runtime-adapter.private.json', adapter);
      const capture = {
        kind: 'private-owned-native-training-execution-not-public-receipt',
        result: 'observed',
        platform,
        cleanup: 'cleaned',
        backend: { runId: fixtureRunId },
        commandExecutions: [command],
      };
      await write('capture.private.json', capture);
      await write('external-cleanup.private.json', cleanup);
      await write('training-journey-runtime-frames.private.json', [{ reviewed: false }]);
      const options = {
        captureRoot,
        outputRoot,
        requestedRunId: path.basename(outputRoot),
        fixtureRunId,
        selection,
        bindings,
      };
      for (const patch of [
        { captureExitCode: 2 },
        ...(platform === 'ios' ? [{ captureCleanup: 'not-acquired' }] : []),
        { childExitCode: null },
        { callbackInvocations: 0 },
        { callbackInvocations: 2 },
        {
          kind: `private-owned-${platform === 'ios' ? 'android' : 'ios'}-training-attempt-not-public-receipt`,
        },
        { callbackCompleted: false },
        { externalCleanupResult: 'failed' },
        { verificationResult: 'not-executed' },
        { requestedRunId: 'f'.repeat(24) },
        { commandDiagnostics: undefined },
        { commandDiagnostics: [] },
        { commandDiagnostics: [{ ...command, childExitCode: 1 }] },
        { commandDiagnostics: [{ ...command, childSignal: 'SIGTERM' }] },
        { commandDiagnostics: [{ ...command, childSignal: undefined }] },
        { commandDiagnostics: [{ ...command, phase: 'bogus' }] },
        { commandDiagnostics: [{ ...command, label: 'unrelated-readiness' }] },
        { censusFailures: [{ publication: 'failed' }] },
      ]) {
        await write('runtime-adapter.private.json', { ...adapter, ...patch });
        await assert.rejects(stageNativeTrainingPublicEvidence(options));
        assert.deepEqual(await readdir(outputRoot), []);
      }
      await write('runtime-adapter.private.json', adapter);
      for (const omitted of [
        ['censusFailure'],
        ['outputFailure'],
        ['censusFailure', 'outputFailure'],
      ]) {
        const incomplete = Object.fromEntries(
          Object.entries(command).filter(([key]) => !omitted.includes(key)),
        );
        await write('runtime-adapter.private.json', {
          ...adapter,
          commandDiagnostics: [incomplete],
        });
        await assert.rejects(
          stageNativeTrainingPublicEvidence(options),
          /census failure|output failure/,
        );
        assert.deepEqual(await readdir(outputRoot), []);
      }
      await write('runtime-adapter.private.json', adapter);
      const { outputFailures: _missingOutputFailures, ...adapterWithoutOutputFailures } = adapter;
      await write('runtime-adapter.private.json', adapterWithoutOutputFailures);
      await assert.rejects(
        stageNativeTrainingPublicEvidence(options),
        /Adapter output failure projection is missing/,
      );
      assert.deepEqual(await readdir(outputRoot), []);
      await write('runtime-adapter.private.json', {
        ...adapter,
        outputFailures: [{ reason: 'io', stream: 'stderr', bytes: 3, message: 'foreign' }],
      });
      await assert.rejects(
        stageNativeTrainingPublicEvidence(options),
        /differs from original capture/,
      );
      assert.deepEqual(await readdir(outputRoot), []);
      await write('runtime-adapter.private.json', adapter);
      // Missing sidecars do not erase diagnostics retained by the command owner.
      const failedPublication = {
        errorClass: 'OwnedProcessCensusQueryError',
        publication: 'failed',
      };
      for (const patch of [
        { censusFailure: failedPublication },
        {
          outputFailure: {
            reason: 'io',
            stream: 'stdout',
            bytes: 0,
            message: 'Synthetic controlled output failure',
          },
        },
        { execution: 'harness-blocked' },
        { cleanup: 'failed-recovery-ledger-retained' },
      ]) {
        const originalCommands = [{ ...command, ...patch }];
        await write('capture.private.json', { ...capture, commandExecutions: originalCommands });
        await write('runtime-adapter.private.json', {
          ...adapter,
          commandDiagnostics: originalCommands,
          censusFailures: 'censusFailure' in patch ? [failedPublication] : [],
          outputFailures: 'outputFailure' in patch ? [patch.outputFailure] : [],
        });
        await assert.rejects(stageNativeTrainingPublicEvidence(options));
        assert.deepEqual(await readdir(outputRoot), []);
        const retained = JSON.parse(
          await readFile(path.join(captureRoot, 'capture.private.json'), 'utf8'),
        ) as {
          commandExecutions: typeof originalCommands;
        };
        assert.equal(retained.commandExecutions[0].childExitCode, 0);
        assert.deepEqual(retained.commandExecutions, originalCommands);
        assert(
          !(await readdir(captureRoot)).some((name) =>
            name.endsWith('.census-failure.private.json'),
          ),
        );
      }
      // A stale adapter cannot conceal a failure present only in the raw capture.
      await write('runtime-adapter.private.json', adapter);
      await write('capture.private.json', {
        ...capture,
        commandExecutions: [{ ...command, censusFailure: failedPublication }],
      });
      await assert.rejects(stageNativeTrainingPublicEvidence(options));
      assert.deepEqual(await readdir(outputRoot), []);
      for (const commandExecutions of [
        undefined,
        [],
        [null],
        [{ ...command, phase: 'bogus' }],
        [Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'childSignal'))],
      ]) {
        await write('capture.private.json', { ...capture, commandExecutions });
        await assert.rejects(stageNativeTrainingPublicEvidence(options));
        assert.deepEqual(await readdir(outputRoot), []);
      }
      await write('capture.private.json', capture);
      for (const patch of [
        { requestedAttemptId: 'd'.repeat(24) + ':first' },
        { input: { ...metadata.input, platform: platform === 'ios' ? 'android' : 'ios' } },
        { selection: { ...metadata.selection, requirementHash: '0'.repeat(64) } },
        { sixSqlCheckpoints: false },
        { publicNativePassingCases: 1 },
      ]) {
        await write('training-runtime-metadata.private.json', { ...metadata, ...patch });
        await assert.rejects(stageNativeTrainingPublicEvidence(options));
        assert.deepEqual(await readdir(outputRoot), []);
      }
      await write('training-runtime-metadata.private.json', metadata);
      for (const patch of [
        { result: 'failed' },
        { runId: 'd'.repeat(24) },
        ...(platform === 'android'
          ? [
              { acquisitions: ['adb', 'emulator'] },
              { cacheAbsent: null },
              { defaultAdbPreserved: false },
            ]
          : []),
      ]) {
        await write('external-cleanup.private.json', { ...cleanup, ...patch });
        await assert.rejects(stageNativeTrainingPublicEvidence(options));
        assert.deepEqual(await readdir(outputRoot), []);
      }
      await write('external-cleanup.private.json', cleanup);
      await writeFile(path.join(captureRoot, 'checkpoint.private.json'), 'changed');
      await assert.rejects(stageNativeTrainingPublicEvidence(options), /evidence changed/);
      assert.deepEqual(await readdir(outputRoot), []);
      await writeFile(path.join(captureRoot, 'checkpoint.private.json'), sourceBytes);
      await assert.rejects(
        stageNativeTrainingPublicEvidence({ ...options, bindings: bindings.slice(1) }),
      );
      await assert.rejects(
        stageNativeTrainingPublicEvidence({ ...options, fixtureRunId: 'd'.repeat(24) }),
      );
      await assert.rejects(
        stageNativeTrainingPublicEvidence({
          ...options,
          bindings: [...bindings.slice(1), bindings[1]],
        }),
      );
      await rm(path.join(captureRoot, 'checkpoint.private.json'));
      await symlink(
        path.join(captureRoot, 'external-cleanup.private.json'),
        path.join(captureRoot, 'checkpoint.private.json'),
      );
      await assert.rejects(stageNativeTrainingPublicEvidence(options), /symlink/);
      assert.deepEqual(await readdir(outputRoot), []);
      await rm(path.join(captureRoot, 'checkpoint.private.json'));
      await writeFile(path.join(captureRoot, 'checkpoint.private.json'), sourceBytes, {
        mode: 0o600,
      });

      // A successful child and clean release cannot erase an unattached original census failure.
      for (const namespace of [captureRoot, outputRoot]) {
        const failure = path.join(namespace, 'outer-controller.census-failure.private.json');
        const diagnostic = JSON.stringify({
          childExitCode: 0,
          cleanup: 'cleaned',
          execution: 'harness-blocked',
        });
        await writeFile(failure, diagnostic, { flag: 'wx', mode: 0o600 });
        await assert.rejects(
          stageNativeTrainingPublicEvidence(options),
          /Native census failure diagnostic/,
        );
        assert.equal(await readFile(failure, 'utf8'), diagnostic);
        assert(!(await readdir(outputRoot)).includes('evidence'));
        await rm(failure);
      }

      let staged = await stageNativeTrainingPublicEvidence({
        ...options,
        lifecycle: {
          signal: new AbortController().signal,
          deadlineAtMs: performance.now() + 30_000,
        },
      });
      assert.equal(staged.assertions.length, 7);
      assert(
        staged.assertions.every((row) =>
          row.evidencePaths.every((p) =>
            p.startsWith('evidence/' + path.basename(captureRoot) + '/'),
          ),
        ),
      );
      const directory = path.join(outputRoot, 'evidence', path.basename(captureRoot));
      assert.equal((await lstat(directory)).mode & 0o777, 0o700);
      assert.deepEqual(
        await readFile(path.join(directory, 'checkpoint.private.json')),
        sourceBytes,
      );
      const manifest = JSON.parse(
        await readFile(path.join(outputRoot, staged.artifacts[0]), 'utf8'),
      ) as {
        files: { path: string; sha256: string }[];
      };
      for (const file of manifest.files) {
        const copied = path.join(directory, file.path);
        assert.equal((await lstat(copied)).mode & 0o777, 0o600);
        assert.equal(
          createHash('sha256')
            .update(await readFile(copied))
            .digest('hex'),
          file.sha256,
        );
      }
      let original = await readFile(path.join(outputRoot, staged.artifacts[0]));
      const verify = () =>
        verifyStagedNativeTrainingEvidence({
          outputRoot,
          copyManifest: staged.copyManifest,
          requestedRunId: options.requestedRunId,
          captureRunId: path.basename(captureRoot),
          fixtureRunId,
          captureRoot,
        });
      await verify();

      const listStageFiles = (root: string): string[] => {
        const files: string[] = [];
        const visit = (directoryPath: string) => {
          let entries;
          try {
            entries = readdirSync(directoryPath, { withFileTypes: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
          }
          for (const entry of entries) {
            const child = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) visit(child);
            else files.push(child);
          }
        };
        visit(root);
        return files;
      };
      const resetStagedOutput = async () => {
        await rm(path.join(outputRoot, 'evidence'), { recursive: true, force: true });
        await rm(path.join(outputRoot, 'training-staging-recovery.private.json'), {
          force: true,
        });
      };
      const abortAfterCopyFence = (
        trigger: (controller: AbortController) => boolean,
      ): AbortSignal => {
        const controller = new AbortController();
        let triggered = false;
        return new Proxy(controller.signal, {
          get(target, property, receiver) {
            if (property === 'throwIfAborted')
              return () => {
                if (!triggered) {
                  triggered = trigger(controller);
                }
                target.throwIfAborted();
              };
            return Reflect.get(target, property, receiver) as unknown;
          },
        });
      };
      const stageLifecycle = (signal: AbortSignal) => ({
        signal,
        deadlineAtMs: performance.now() + 30_000,
      });
      const expectStageBlocked = async (
        lifecycle: NativeTrainingPublicEvidenceLifecycle,
        expectedStatus: 'cleaned' | 'failed-recovery-ledger-retained',
      ) => {
        let error: unknown;
        try {
          await stageNativeTrainingPublicEvidence({ ...options, lifecycle });
          assert.fail('staging unexpectedly completed');
        } catch (caught) {
          error = caught;
        }
        assert(error instanceof NativeTrainingPublicEvidenceStageError);
        assert.equal(error.recoveryStatus, expectedStatus);
        return error;
      };

      // Expiry before the first write leaves the caller-owned output namespace untouched.
      await resetStagedOutput();
      await expectStageBlocked(
        { signal: new AbortController().signal, deadlineAtMs: performance.now() - 1 },
        'cleaned',
      );
      assert.deepEqual(await readdir(outputRoot), []);

      // Cancellation after the first copied file rolls back all entries owned by this call.
      await resetStagedOutput();
      const duringCopySignal = abortAfterCopyFence((controller) => {
        if (listStageFiles(path.join(outputRoot, 'evidence')).length > 0) {
          controller.abort(new DOMException('copy cancelled', 'AbortError'));
          return true;
        }
        return false;
      });
      const duringCopyError = await expectStageBlocked(
        stageLifecycle(duringCopySignal),
        'failed-recovery-ledger-retained',
      );
      assert.equal(duringCopyError.recoveryRecordPath, 'training-staging-recovery.private.json');
      assert((await readdir(outputRoot)).includes('training-staging-recovery.private.json'));

      // Cancellation after the last source file but before the manifest is also rolled back.
      await resetStagedOutput();
      const sourceFileCount = manifest.files.length;
      const postCopySignal = abortAfterCopyFence((controller) => {
        if (listStageFiles(path.join(outputRoot, 'evidence')).length >= sourceFileCount) {
          controller.abort(new DOMException('post-copy cancelled', 'AbortError'));
          return true;
        }
        return false;
      });
      const postCopyError = await expectStageBlocked(
        stageLifecycle(postCopySignal),
        'failed-recovery-ledger-retained',
      );
      assert.equal(postCopyError.recoveryRecordPath, 'training-staging-recovery.private.json');
      assert((await readdir(outputRoot)).includes('training-staging-recovery.private.json'));

      // An inode replacement is never removed via a pathname and leaves a bounded recovery record.
      await resetStagedOutput();
      let foreignPath: string | undefined;
      const foreignSignal = abortAfterCopyFence((controller) => {
        const files = listStageFiles(path.join(outputRoot, 'evidence'));
        if (files.length > 0 && foreignPath === undefined) {
          foreignPath = files[0];
          rmSync(foreignPath);
          writeFileSync(foreignPath, 'foreign replacement', { flag: 'wx', mode: 0o600 });
          controller.abort(new DOMException('foreign replacement', 'AbortError'));
          return true;
        }
        return false;
      });
      const foreignError = await expectStageBlocked(
        stageLifecycle(foreignSignal),
        'failed-recovery-ledger-retained',
      );
      assert.equal(foreignError.recoveryRecordPath, 'training-staging-recovery.private.json');
      assert(foreignPath);
      assert.equal(await readFile(foreignPath, 'utf8'), 'foreign replacement');
      assert(
        (await readdir(outputRoot)).includes('training-staging-recovery.private.json'),
        'foreign replacement retains a recovery ledger',
      );
      await rm(foreignPath);
      await resetStagedOutput();

      // Replacing the caller-owned output root immediately before the first
      // mutation must fail before mkdir follows the replacement.  The moved
      // original and replacement remain empty; no proof is written outside
      // the identity-bound root.
      await resetStagedOutput();
      const movedOutputRoot = `${outputRoot}-moved`;
      const ancestorSwapLifecycle = {
        signal: new AbortController().signal,
        deadlineAtMs: performance.now() + 30_000,
        onMutationBoundary: (label: string) => {
          if (
            label === 'create directory evidence' &&
            !readdirSync(outputRoot).includes('evidence')
          ) {
            renameSync(outputRoot, movedOutputRoot);
            mkdirSync(outputRoot, { mode: 0o700 });
          }
        },
      };
      await expectStageBlocked(ancestorSwapLifecycle, 'cleaned');
      assert.deepEqual(await readdir(outputRoot), []);
      assert.deepEqual(await readdir(movedOutputRoot), []);
      await rm(outputRoot, { recursive: true, force: true });
      await rm(movedOutputRoot, { recursive: true, force: true });
      await mkdir(outputRoot, { mode: 0o700 });

      // A write-boundary ancestor replacement must fail before the open follows
      // the replacement. The moved original remains outside the caller root and
      // is cleaned by this test, never by the staging rollback.
      await resetStagedOutput();
      const movedWriteRoot = `${outputRoot}-write-moved`;
      let writeBoundarySwapped = false;
      const writeBoundaryError = await expectStageBlocked(
        {
          signal: new AbortController().signal,
          deadlineAtMs: performance.now() + 30_000,
          onMutationBoundary: (label: string) => {
            if (!writeBoundarySwapped && label.startsWith('write evidence/')) {
              writeBoundarySwapped = true;
              renameSync(outputRoot, movedWriteRoot);
              mkdirSync(outputRoot, { mode: 0o700 });
            }
          },
        },
        'failed-recovery-ledger-retained',
      );
      assert(writeBoundarySwapped);
      assert.equal(writeBoundaryError.recoveryRecordPath, null);
      assert.deepEqual(await readdir(outputRoot), []);
      assert(
        !listStageFiles(movedWriteRoot).some((file) => file.includes('checkpoint.private.json')),
      );
      await rm(outputRoot, { recursive: true, force: true });
      await rm(movedWriteRoot, { recursive: true, force: true });
      await mkdir(outputRoot, { mode: 0o700 });

      // Restoring through the saved cwd pathname is unsafe when that pathname
      // is replaced during the anchored mutation. The helper must restore the
      // original directory inode (the moved sibling), never the replacement.
      if (platform === 'ios') {
        const testProcessCwd = process.cwd();
        const savedCwd = path.join(temporary, 'saved-cwd');
        const movedSavedCwd = `${savedCwd}-moved`;
        await mkdir(savedCwd, { mode: 0o700 });
        process.chdir(savedCwd);
        let savedCwdSwapped = false;
        try {
          await stageNativeTrainingPublicEvidence({
            ...options,
            lifecycle: {
              signal: new AbortController().signal,
              deadlineAtMs: performance.now() + 30_000,
              onMutationBoundary: (label: string) => {
                if (!savedCwdSwapped && label === 'create directory evidence') {
                  savedCwdSwapped = true;
                  renameSync(savedCwd, movedSavedCwd);
                  mkdirSync(savedCwd, { mode: 0o700 });
                }
              },
            },
          });
          assert(savedCwdSwapped);
          assert.equal(realpathSync(process.cwd()), movedSavedCwd);
          const restoredStat = lstatSync(process.cwd());
          const movedStat = lstatSync(movedSavedCwd);
          assert.equal(restoredStat.dev, movedStat.dev);
          assert.equal(restoredStat.ino, movedStat.ino);
          assert.deepEqual(await readdir(savedCwd), []);
        } finally {
          process.chdir(testProcessCwd);
          await rm(savedCwd, { recursive: true, force: true });
          await rm(movedSavedCwd, { recursive: true, force: true });
          await resetStagedOutput();
        }
      }

      // A writer failure after O_EXCL has created the destination must remain
      // tracked. The zero-byte owned inode is retained with a recovery ledger
      // because its bytes do not satisfy the original evidence hash.
      await resetStagedOutput();
      let openedFailure = false;
      const writeFailureError = await expectStageBlocked(
        {
          signal: new AbortController().signal,
          deadlineAtMs: performance.now() + 30_000,
          afterFileOpened: (relative) => {
            if (!openedFailure && relative.endsWith('/checkpoint.private.json')) {
              openedFailure = true;
              throw new Error('injected post-open writer failure');
            }
          },
        },
        'failed-recovery-ledger-retained',
      );
      assert(openedFailure);
      assert.equal(writeFailureError.recoveryRecordPath, 'training-staging-recovery.private.json');
      assert((await readdir(outputRoot)).includes('training-staging-recovery.private.json'));
      assert(
        listStageFiles(path.join(outputRoot, 'evidence')).some((file) => {
          try {
            return readFileSync(file).byteLength === 0;
          } catch {
            return false;
          }
        }),
      );

      // Same-byte replacement still changes the inode. Rollback must retain
      // that foreign file instead of unlinking it by pathname.
      await resetStagedOutput();
      let sameByteReplacement: Buffer | undefined;
      const sameByteSignal = abortAfterCopyFence((controller) => {
        if (listStageFiles(path.join(outputRoot, 'evidence')).length > 0) {
          controller.abort(new DOMException('same-byte rollback replacement', 'AbortError'));
          return true;
        }
        return false;
      });
      const sameByteError = await expectStageBlocked(
        {
          ...stageLifecycle(sameByteSignal),
          onRollbackBoundary: (_label, file) => {
            if (sameByteReplacement === undefined) {
              sameByteReplacement = readFileSync(file);
              rmSync(file);
              writeFileSync(file, sameByteReplacement, { flag: 'wx', mode: 0o600 });
            }
          },
        },
        'failed-recovery-ledger-retained',
      );
      assert(sameByteReplacement);
      assert.equal(sameByteError.recoveryRecordPath, 'training-staging-recovery.private.json');
      assert((await readdir(outputRoot)).includes('training-staging-recovery.private.json'));
      assert(
        listStageFiles(path.join(outputRoot, 'evidence')).some((file) =>
          readFileSync(file).equals(sameByteReplacement!),
        ),
      );

      // Replacing a file after the first final identity check must be caught by
      // the second descriptor/path check before unlink. This models the exact
      // rollback deletion boundary rather than an earlier event-loop fence.
      await resetStagedOutput();
      let finalCheckReplacement: Buffer | undefined;
      const finalCheckSignal = abortAfterCopyFence((controller) => {
        if (listStageFiles(path.join(outputRoot, 'evidence')).length > 0) {
          controller.abort(new DOMException('final rollback check replacement', 'AbortError'));
          return true;
        }
        return false;
      });
      const finalCheckError = await expectStageBlocked(
        {
          ...stageLifecycle(finalCheckSignal),
          beforeRollbackUnlink: (file) => {
            if (finalCheckReplacement === undefined) {
              finalCheckReplacement = readFileSync(file);
              rmSync(file);
              writeFileSync(file, finalCheckReplacement, { flag: 'wx', mode: 0o600 });
            }
          },
        },
        'failed-recovery-ledger-retained',
      );
      assert(finalCheckReplacement);
      assert.equal(finalCheckError.recoveryRecordPath, 'training-staging-recovery.private.json');
      assert(
        listStageFiles(path.join(outputRoot, 'evidence')).some((file) =>
          readFileSync(file).equals(finalCheckReplacement!),
        ),
      );

      // A same-byte replacement after the last identity check must be moved
      // into private quarantine and retained. The rollback must never unlink
      // that foreign inode merely because it now occupies the owned basename.
      await resetStagedOutput();
      let renameRaceReplacement: Buffer | undefined;
      const renameRaceSignal = abortAfterCopyFence((controller) => {
        if (listStageFiles(path.join(outputRoot, 'evidence')).length > 0) {
          controller.abort(new DOMException('same-byte rename race', 'AbortError'));
          return true;
        }
        return false;
      });
      const renameRaceError = await expectStageBlocked(
        {
          ...stageLifecycle(renameRaceSignal),
          beforeRollbackRename: (file) => {
            if (renameRaceReplacement === undefined) {
              renameRaceReplacement = readFileSync(file);
              rmSync(file);
              writeFileSync(file, renameRaceReplacement, { flag: 'wx', mode: 0o600 });
            }
          },
        },
        'failed-recovery-ledger-retained',
      );
      assert(renameRaceReplacement);
      assert.equal(renameRaceError.recoveryRecordPath, 'training-staging-recovery.private.json');
      const quarantinedReplacement = listStageFiles(path.join(outputRoot, 'evidence')).find(
        (file) => {
          try {
            return readFileSync(file).equals(renameRaceReplacement!);
          } catch {
            return false;
          }
        },
      );
      assert(quarantinedReplacement);
      assert(quarantinedReplacement.includes('.native-training-rollback-'));

      // Node exposes no inode-conditional unlink primitive. The production
      // fallback retains the verified private quarantine instead of invoking
      // a path-based final removal. The seam confirms the final boundary was
      // reached; the direct primitive control below verifies no unlink occurs.
      await resetStagedOutput();
      let quarantineFileRemovalAttempted = false;
      const quarantineFileSignal = abortAfterCopyFence((controller) => {
        if (listStageFiles(path.join(outputRoot, 'evidence')).length > 0) {
          controller.abort(new DOMException('quarantine file replacement', 'AbortError'));
          return true;
        }
        return false;
      });
      const quarantineFileError = await expectStageBlocked(
        {
          ...stageLifecycle(quarantineFileSignal),
          beforeRollbackQuarantineUnlink: () => {
            quarantineFileRemovalAttempted = true;
          },
        },
        'failed-recovery-ledger-retained',
      );
      assert.equal(quarantineFileRemovalAttempted, true);
      assert.equal(
        quarantineFileError.recoveryRecordPath,
        'training-staging-recovery.private.json',
      );
      assert((await readdir(outputRoot)).includes('training-staging-recovery.private.json'));

      // The directory fallback follows the same rule: no rmdir is attempted
      // after the last identity check because Node has no inode-conditional
      // directory removal primitive.
      await resetStagedOutput();
      let quarantineDirectoryRemovalAttempted = false;
      const quarantineDirectorySignal = abortAfterCopyFence((controller) => {
        if (listStageFiles(path.join(outputRoot, 'evidence')).length > 0) {
          controller.abort(new DOMException('quarantine directory replacement', 'AbortError'));
          return true;
        }
        return false;
      });
      const quarantineDirectoryError = await expectStageBlocked(
        {
          ...stageLifecycle(quarantineDirectorySignal),
          beforeRollbackQuarantineRmdir: () => {
            quarantineDirectoryRemovalAttempted = true;
          },
        },
        'failed-recovery-ledger-retained',
      );
      // The retained file keeps its parent non-empty, so the directory never
      // reaches the rmdir seam and is itself retained without probing a
      // path-based removal.
      assert.equal(quarantineDirectoryRemovalAttempted, false);
      assert.equal(
        quarantineDirectoryError.recoveryRecordPath,
        'training-staging-recovery.private.json',
      );
      assert((await readdir(outputRoot)).includes('training-staging-recovery.private.json'));

      // Rollback must remain anchored if the containing directory is replaced
      // after the rollback lock is acquired. The old directory is never treated
      // as the replacement and the replacement remains empty for recovery.
      await resetStagedOutput();
      let rollbackParentMoved: string | undefined;
      let rollbackParentReplacement: string | undefined;
      const rollbackBoundarySignal = abortAfterCopyFence((controller) => {
        if (listStageFiles(path.join(outputRoot, 'evidence')).length > 0) {
          controller.abort(new DOMException('rollback parent replacement', 'AbortError'));
          return true;
        }
        return false;
      });
      const rollbackBoundaryError = await expectStageBlocked(
        {
          ...stageLifecycle(rollbackBoundarySignal),
          onRollbackBoundary: (_label, file) => {
            if (rollbackParentMoved === undefined) {
              const parent = path.dirname(file);
              rollbackParentMoved = `${parent}-moved`;
              rollbackParentReplacement = parent;
              renameSync(parent, rollbackParentMoved);
              mkdirSync(parent, { mode: 0o700 });
            }
          },
        },
        'failed-recovery-ledger-retained',
      );
      assert(rollbackParentMoved);
      assert(rollbackParentReplacement);
      assert.equal(
        rollbackBoundaryError.recoveryRecordPath,
        'training-staging-recovery.private.json',
      );
      assert.deepEqual(await readdir(rollbackParentReplacement), []);
      assert(
        (await readdir(rollbackParentMoved)).some((entry) =>
          entry.startsWith('.native-training-rollback-'),
        ),
        'owned quarantine remains under the moved original parent for recovery',
      );
      await rm(outputRoot, { recursive: true, force: true });
      await rm(rollbackParentMoved, { recursive: true, force: true });
      await mkdir(outputRoot, { mode: 0o700 });

      // A second call that is cancelled while waiting for the first mutation
      // lock must fail after lock acquisition and perform no mutation.
      await resetStagedOutput();
      let releaseFirstMutation!: () => void;
      let firstMutationEntered!: () => void;
      const firstMutationReady = new Promise<void>((resolve) => {
        firstMutationEntered = resolve;
      });
      const firstMutationRelease = new Promise<void>((resolve) => {
        releaseFirstMutation = resolve;
      });
      let firstHeld = false;
      const firstStage = stageNativeTrainingPublicEvidence({
        ...options,
        lifecycle: {
          signal: new AbortController().signal,
          deadlineAtMs: performance.now() + 30_000,
          beforeMutationBoundary: async (label) => {
            if (label === 'create directory evidence' && !firstHeld) {
              firstHeld = true;
              firstMutationEntered();
              await firstMutationRelease;
            }
          },
        },
      });
      await firstMutationReady;
      const waitingController = new AbortController();
      let secondMutationQueued!: () => void;
      const secondQueued = new Promise<void>((resolve) => {
        secondMutationQueued = resolve;
      });
      const secondStage = stageNativeTrainingPublicEvidence({
        ...options,
        lifecycle: {
          signal: waitingController.signal,
          deadlineAtMs: performance.now() + 30_000,
          onMutationQueued: (label) => {
            if (label === 'create directory evidence') secondMutationQueued();
          },
        },
      }).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await secondQueued;
      waitingController.abort(
        new DOMException('cancelled while waiting for stage lock', 'AbortError'),
      );
      releaseFirstMutation();
      await firstStage;
      const firstRootEntries = await readdir(outputRoot);
      const secondOutcome = await secondStage;
      assert.equal(secondOutcome.ok, false);
      const secondError = secondOutcome.error;
      assert(secondError instanceof NativeTrainingPublicEvidenceStageError);
      assert.equal(secondError.recoveryStatus, 'cleaned');
      assert.deepEqual(await readdir(outputRoot), firstRootEntries);
      assert(firstRootEntries.includes('evidence'));

      // Restore a clean positive stage before the existing manifest/readback controls.
      await resetStagedOutput();
      staged = await stageNativeTrainingPublicEvidence({
        ...options,
        lifecycle: {
          signal: new AbortController().signal,
          deadlineAtMs: performance.now() + 30_000,
        },
      });
      original = await readFile(path.join(outputRoot, staged.artifacts[0]));
      await verify();
      for (const namespace of [captureRoot, outputRoot, directory]) {
        const failure = path.join(namespace, 'outer-controller.census-failure.private.json');
        await writeFile(failure, 'unavailable original census details', {
          flag: 'wx',
          mode: 0o600,
        });
        await assert.rejects(verify(), /Native census failure diagnostic/);
        assert.equal(
          await readFile(path.join(outputRoot, staged.artifacts[0]), 'utf8'),
          original.toString(),
        );
        await rm(failure);
        await verify();
      }
      await writeFile(path.join(directory, 'checkpoint.private.json'), 'changed staged proof');
      await assert.rejects(verify(), /Staged native evidence changed/);
      await writeFile(path.join(directory, 'checkpoint.private.json'), sourceBytes);
      await verify();
      await writeFile(path.join(outputRoot, staged.artifacts[0]), '{}');
      await assert.rejects(verify(), /Staged native manifest changed/);
      await writeFile(path.join(outputRoot, staged.artifacts[0]), original);
      await assert.rejects(stageNativeTrainingPublicEvidence(options), /EEXIST/);
      assert.deepEqual(await readFile(path.join(outputRoot, staged.artifacts[0])), original);
      assert(
        !(await readdir(outputRoot)).includes('receipt.json'),
        'staging never emits a public pass',
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

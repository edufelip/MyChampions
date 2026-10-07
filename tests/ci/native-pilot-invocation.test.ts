import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  createNativePilotOutputRoot,
  formatNativePilotInvocationArguments,
  NativePilotRecoveryDeadlineError,
  nativePilotRunIdPattern,
  nativePilotRuntimeArtifactReferences,
  writeNativePilotOptionalPrivateFile,
  writeNativePilotTerminalReceipt,
  observeNativePilotPartialOutput,
  parseNativePilotInvocationArguments,
  writeNativePilotPrivateFile,
  writeNativePilotBlockedReceipt,
} from '../../scripts/testing/native-pilot-invocation';
import { installNativePilotPreflightLifecycle } from '../../scripts/testing/native-pilot-preflight';
import { NativeExecutionDeadlineError } from '../../scripts/testing/native-runtime-preflight';
import { assertPublicReceipt } from '../../scripts/testing/schema-validation';
import {
  createRepositoryObservation,
  repositoryIdentity,
} from '../../scripts/testing/testing-repository-identity';

const qualifiedRoot = path.resolve(__dirname, '../..');
const selection = [
  '--platform=ios',
  '--engine=maestro',
  '--scenario=SCN-training-ios',
  '--mode=integration',
];
const requestedRunId = '0123456789abcdef01234567';
const requestedAttemptId = `${requestedRunId}:first`;

void test('runtime artifact references require a published sidecar after a write failure', () => {
  assert.deepEqual(
    nativePilotRuntimeArtifactReferences({
      runtimePresent: true,
      runtimeExternalCleanupFailed: true,
      runtimeLinkPublished: false,
      runtimeFailurePublished: false,
    }),
    { recoveryRecordPath: null, artifacts: [] },
  );
  assert.deepEqual(
    nativePilotRuntimeArtifactReferences({
      runtimePresent: true,
      runtimeExternalCleanupFailed: true,
      runtimeLinkPublished: true,
      runtimeFailurePublished: false,
    }),
    {
      recoveryRecordPath: 'runtime-link.private.json',
      artifacts: ['runtime-link.private.json'],
    },
  );
  assert.deepEqual(
    nativePilotRuntimeArtifactReferences({
      runtimePresent: false,
      runtimeExternalCleanupFailed: false,
      runtimeLinkPublished: false,
      runtimeFailurePublished: true,
    }),
    {
      recoveryRecordPath: 'runtime-failure.private.json',
      artifacts: ['runtime-failure.private.json'],
    },
  );
});

async function privateRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  await chmod(root, 0o700);
  return root;
}

void test('identity parser accepts the real four selection args plus a bound first attempt', () => {
  const invocation = parseNativePilotInvocationArguments([
    ...selection,
    `--run-id=${requestedRunId}`,
    `--attempt-id=${requestedAttemptId}`,
    '--output-parent=/private/tmp/native-pilot-owned',
  ]);
  assert.deepEqual(invocation.selection, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-training-ios',
    mode: 'integration',
  });
  assert.equal(invocation.requestedRunId, requestedRunId);
  assert.equal(invocation.requestedAttemptId, requestedAttemptId);
  assert.equal(invocation.outputParent, '/private/tmp/native-pilot-owned');
  assert.deepEqual(formatNativePilotInvocationArguments(invocation), [
    ...selection,
    `--run-id=${requestedRunId}`,
    `--attempt-id=${requestedAttemptId}`,
    '--output-parent=/private/tmp/native-pilot-owned',
  ]);
});

void test('default invocation retains random-run/default-parent behavior without identity flags', () => {
  const invocation = parseNativePilotInvocationArguments(selection);
  assert.equal(invocation.requestedRunId, null);
  assert.equal(invocation.requestedAttemptId, null);
  assert.equal(invocation.outputParent, null);
  assert.deepEqual(formatNativePilotInvocationArguments(invocation), selection);
});

void test('credential interaction diagnostic is a strict iOS Maestro camera opt-in', () => {
  const cameraSelection = [
    '--platform=ios',
    '--engine=maestro',
    '--scenario=SCN-camera-denied-ios',
    '--mode=integration',
  ];
  const invocation = parseNativePilotInvocationArguments([
    ...cameraSelection,
    '--credential-interaction-diagnostic',
  ]);
  assert.equal(invocation.credentialInteractionDiagnostic, true);
  assert.deepEqual(formatNativePilotInvocationArguments(invocation), [
    ...cameraSelection,
    '--credential-interaction-diagnostic',
  ]);
  for (const unsupported of [
    [
      '--platform=android',
      '--engine=maestro',
      '--scenario=SCN-camera-denied-android',
      '--mode=integration',
    ],
    ['--platform=ios', '--engine=detox', '--scenario=SCN-camera-denied-ios', '--mode=integration'],
    ['--platform=ios', '--engine=maestro', '--scenario=SCN-session-ios', '--mode=integration'],
    ['--platform=ios', '--engine=maestro', '--scenario=SCN-camera-denied-ios', '--mode=fixture'],
  ])
    assert.throws(
      () =>
        parseNativePilotInvocationArguments([
          ...unsupported,
          '--credential-interaction-diagnostic',
        ]),
      /requires the iOS Maestro SCN-camera-denied-ios integration selection/,
    );
  assert.throws(
    () =>
      parseNativePilotInvocationArguments([
        ...cameraSelection,
        '--credential-interaction-diagnostic=false',
      ]),
    /must be enabled with a true flag value/,
  );
});

void test('parser rejects foreign, incomplete and path-shaped identity values before output creation', () => {
  for (const bad of [
    [...selection, '--run-id=foreign/run', `--attempt-id=${requestedAttemptId}`],
    [...selection, `--run-id=${requestedRunId}`],
    [...selection, `--attempt-id=${requestedAttemptId}`],
    [...selection, `--run-id=${requestedRunId}`, '--attempt-id=0123456789abcdef01234567:second'],
    [...selection, '--output-parent=relative/path'],
    [...selection, '--run-id=0123456789ABCDEF01234567', `--attempt-id=${requestedAttemptId}`],
    [
      ...selection,
      '--run-id=0123456789abcdef01234567',
      `--attempt-id=${requestedAttemptId}`,
      '--run-id=0123456789abcdef01234567',
    ],
    [...selection, '--unknown=value'],
  ])
    assert.throws(() => parseNativePilotInvocationArguments(bad));
});

void test('output parent is owned/private and child creation is exclusive and identity-bound', async () => {
  const root = await privateRoot('mc-public-runner-identity-');
  const outputParent = path.join(root, 'attempts');
  await (await import('node:fs/promises')).mkdir(outputParent, { mode: 0o700 });
  const invocation = parseNativePilotInvocationArguments([
    ...selection,
    `--run-id=${requestedRunId}`,
    `--attempt-id=${requestedAttemptId}`,
    `--output-parent=${outputParent}`,
  ]);
  try {
    const prepared = await createNativePilotOutputRoot({
      invocation,
      defaultOutputParent: path.join(root, 'unused-default'),
    });
    assert.equal(prepared.outputParent, outputParent);
    assert.equal(prepared.outputRoot, path.join(outputParent, requestedRunId));
    const child = await lstat(prepared.outputRoot);
    assert.equal(child.isDirectory(), true);
    assert.equal(child.mode & 0o777, 0o700);
    await assert.rejects(
      createNativePilotOutputRoot({
        invocation,
        defaultOutputParent: path.join(root, 'unused-default'),
      }),
      /EEXIST|output root/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('output parent symlink and non-private mode cannot be adopted', async () => {
  const root = await privateRoot('mc-public-runner-identity-safety-');
  const owned = path.join(root, 'owned');
  const link = path.join(root, 'link');
  const open = path.join(root, 'open');
  await (await import('node:fs/promises')).mkdir(owned, { mode: 0o700 });
  await symlink(owned, link);
  await (await import('node:fs/promises')).mkdir(open, { mode: 0o755 });
  await chmod(open, 0o755);
  const make = (parent: string) =>
    parseNativePilotInvocationArguments([
      ...selection,
      `--run-id=${requestedRunId}`,
      `--attempt-id=${requestedAttemptId}`,
      `--output-parent=${parent}`,
    ]);
  try {
    await assert.rejects(
      createNativePilotOutputRoot({
        invocation: make(link),
        defaultOutputParent: owned,
      }),
      /private directory|symlink/i,
    );
    await assert.rejects(
      createNativePilotOutputRoot({
        invocation: make(open),
        defaultOutputParent: owned,
      }),
      /private directory/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('default parent creation rejects a symlink ancestor before writing outside it', async () => {
  const root = await privateRoot('mc-public-runner-identity-ancestor-');
  const outside = await privateRoot('mc-public-runner-identity-outside-');
  const safe = path.join(root, 'safe');
  const link = path.join(safe, 'link');
  await mkdir(safe, { mode: 0o700 });
  await symlink(outside, link);
  try {
    await assert.rejects(
      createNativePilotOutputRoot({
        invocation: parseNativePilotInvocationArguments(selection),
        defaultOutputParent: path.join(link, 'attempts'),
      }),
      /symlink|private directory/i,
    );
    await assert.rejects(lstat(path.join(outside, 'attempts')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

void test('private publication rejects an output-root replacement before writing through it', async () => {
  const root = await privateRoot('mc-public-runner-identity-file-race-');
  const outside = await privateRoot('mc-public-runner-identity-file-race-outside-');
  const outputParent = path.join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  const invocation = parseNativePilotInvocationArguments([
    ...selection,
    `--run-id=${requestedRunId}`,
    `--attempt-id=${requestedAttemptId}`,
    `--output-parent=${outputParent}`,
  ]);
  try {
    const prepared = await createNativePilotOutputRoot({
      invocation,
      defaultOutputParent: path.join(root, 'unused-default'),
    });
    const moved = path.join(root, 'moved-output');
    await rename(prepared.outputRoot, moved);
    await symlink(outside, prepared.outputRoot);
    await assert.rejects(
      writeNativePilotPrivateFile({
        root: prepared.outputRoot,
        relative: 'race.private.json',
        contents: '{}',
        namespaceIdentity: prepared.namespaceIdentity,
      }),
      /symlink|namespace|identity/i,
    );
    await assert.rejects(lstat(path.join(outside, 'race.private.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

void test('private publication rejects a replaced output parent before outside bytes are created', async () => {
  const root = await privateRoot('mc-public-runner-identity-parent-race-');
  const outside = await privateRoot('mc-public-runner-identity-parent-race-outside-');
  const outputParent = path.join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  const invocation = parseNativePilotInvocationArguments([
    ...selection,
    `--run-id=${requestedRunId}`,
    `--attempt-id=${requestedAttemptId}`,
    `--output-parent=${outputParent}`,
  ]);
  try {
    const prepared = await createNativePilotOutputRoot({
      invocation,
      defaultOutputParent: path.join(root, 'unused-default'),
    });
    const moved = path.join(root, 'moved-parent');
    await rename(outputParent, moved);
    await symlink(outside, outputParent);
    await assert.rejects(
      writeNativePilotPrivateFile({
        root: prepared.outputRoot,
        relative: 'parent-race.private.json',
        contents: '{}',
        namespaceIdentity: prepared.namespaceIdentity,
      }),
      /symlink|namespace|identity|ENOENT/i,
    );
    await assert.rejects(lstat(path.join(outside, requestedRunId, 'parent-race.private.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

void test('owned directory creation does not share a replaceable cwd with the caller', () => {
  const helperPath = path.resolve(__dirname, '../../scripts/testing/native-pilot-invocation.ts');
  const loaderIndex = process.execArgv.indexOf('--import');
  assert.ok(loaderIndex >= 0, 'the source-only race control requires the active TS loader');
  const loaderArgs = process.execArgv.slice(loaderIndex, loaderIndex + 2);
  const childSource = `
    (async () => {
      const fs = await import('node:fs');
      const fsp = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');
      const importedHelper = await import(${JSON.stringify(pathToFileURL(helperPath).href)});
      const helper = importedHelper.default ?? importedHelper;
      const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-public-runner-identity-child-race-')));
      const outer = path.join(root, 'outer');
      const outputParent = path.join(outer, 'attempts');
      const outside = path.join(root, 'outside');
      const movedOuter = path.join(root, 'moved-outer');
      const runId = ${JSON.stringify(requestedRunId)};
      const attemptId = ${JSON.stringify(requestedAttemptId)};
      await fsp.mkdir(outputParent, { mode: 0o700, recursive: true });
      await fsp.mkdir(outside, { mode: 0o700 });
      const invocation = helper.parseNativePilotInvocationArguments([
        '--platform=ios', '--engine=maestro', '--scenario=SCN-training-ios', '--mode=integration',
        '--run-id=' + runId, '--attempt-id=' + attemptId, '--output-parent=' + outputParent,
      ]);
      const originalChdir = process.chdir;
      let switched = false;
      process.chdir = (directory) => {
        originalChdir(directory);
        if (!switched && directory === outputParent) {
          switched = true;
          fs.renameSync(outer, movedOuter);
          fs.symlinkSync(outside, outer);
        }
      };
      let error = null;
      try {
        await helper.createNativePilotOutputRoot({
          invocation,
          defaultOutputParent: path.join(root, 'unused-default'),
        });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      } finally {
        process.chdir = originalChdir;
      }
      const movedExists = fs.existsSync(path.join(movedOuter, 'attempts', runId));
      const outsideExists = fs.existsSync(path.join(outside, 'attempts', runId));
      await fsp.rm(root, { recursive: true, force: true });
      const result = { switched, movedExists, outsideExists, error };
      process.stdout.write(JSON.stringify(result));
      process.exitCode = !switched && !movedExists && !outsideExists && !error ? 0 : 1;
    })().catch((caught) => {
      console.error(caught);
      process.exitCode = 1;
    });
  `;
  const child = spawnSync(process.execPath, [...loaderArgs, '-e', childSource], {
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const result = JSON.parse(child.stdout) as {
    switched: boolean;
    movedExists: boolean;
    outsideExists: boolean;
    error: string | null;
  };
  assert.equal(result.switched, false);
  assert.equal(result.movedExists, false);
  assert.equal(result.outsideExists, false);
  assert.equal(result.error, null);
});

void test('private publication never changes or restores the caller cwd pathname', () => {
  const helperPath = path.resolve(__dirname, '../../scripts/testing/native-pilot-invocation.ts');
  const loaderIndex = process.execArgv.indexOf('--import');
  assert.ok(loaderIndex >= 0, 'the source-only cwd race control requires the active TS loader');
  const loaderArgs = process.execArgv.slice(loaderIndex, loaderIndex + 2);
  const childSource = `
    (async () => {
      const fs = await import('node:fs');
      const fsp = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');
      const importedHelper = await import(${JSON.stringify(pathToFileURL(helperPath).href)});
      const helper = importedHelper.default ?? importedHelper;
      const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-public-runner-identity-cwd-race-')));
      const outside = path.join(root, 'outside');
      const outputParent = path.join(root, 'attempts');
      const runId = ${JSON.stringify(requestedRunId)};
      const attemptId = ${JSON.stringify(requestedAttemptId)};
      await fsp.mkdir(outside, { mode: 0o700 });
      await fsp.mkdir(outputParent, { mode: 0o700 });
      const invocation = helper.parseNativePilotInvocationArguments([
        '--platform=ios', '--engine=maestro', '--scenario=SCN-training-ios', '--mode=integration',
        '--run-id=' + runId, '--attempt-id=' + attemptId, '--output-parent=' + outputParent,
      ]);
      const prepared = await helper.createNativePilotOutputRoot({
        invocation,
        defaultOutputParent: path.join(root, 'unused-default'),
      });
      const originalChdir = process.chdir;
      const chdirTargets = [];
      process.chdir = (directory) => {
        chdirTargets.push(directory);
        originalChdir(directory);
      };
      let error = null;
      try {
        await helper.writeNativePilotPrivateFile({
          root: prepared.outputRoot,
          relative: 'cwd-race.private.json',
          contents: '{}',
          namespaceIdentity: prepared.namespaceIdentity,
        });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      } finally {
        process.chdir = originalChdir;
        originalChdir('/');
      }
      const childExists = fs.existsSync(path.join(prepared.outputRoot, 'cwd-race.private.json'));
      const outsideExists = fs.existsSync(path.join(outside, 'attempts', runId));
      await fsp.rm(root, { recursive: true, force: true });
      const result = { chdirTargets, childExists, outsideExists, error };
      process.stdout.write(JSON.stringify(result));
      process.exitCode =
        (chdirTargets.length === 0 ||
          (chdirTargets.length === 2 &&
            chdirTargets.every((target) => /(?:dev\\/fd|proc\\/self\\/fd)\\/\\d+$/.test(target)))) &&
        childExists &&
        !outsideExists &&
        !error
          ? 0
          : 1;
    })().catch((caught) => {
      console.error(caught);
      process.exitCode = 1;
    });
  `;
  const child = spawnSync(process.execPath, [...loaderArgs, '-e', childSource], {
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const result = JSON.parse(child.stdout) as {
    chdirTargets: string[];
    childExists: boolean;
    outsideExists: boolean;
    error: string | null;
  };
  assert.ok(
    result.chdirTargets.length === 0 ||
      (result.chdirTargets.length === 2 &&
        result.chdirTargets.every((target) => /(?:dev\/fd|proc\/self\/fd)\/\d+$/.test(target))),
  );
  assert.equal(result.childExists, true);
  assert.equal(result.outsideExists, false);
  assert.equal(result.error, null);
});

void test('an already cancelled preflight cannot create an output parent or child', async () => {
  const root = await privateRoot('mc-public-runner-identity-cancelled-');
  const controller = new AbortController();
  controller.abort('SIGTERM');
  try {
    await assert.rejects(
      createNativePilotOutputRoot({
        invocation: parseNativePilotInvocationArguments(selection),
        defaultOutputParent: path.join(root, 'attempts'),
        signal: controller.signal,
      }),
      /aborted|SIGTERM/i,
    );
    await assert.rejects(lstat(path.join(root, 'attempts')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('interrupted preflight recovery uses an independent bounded publication signal', async () => {
  const root = await privateRoot('mc-public-runner-identity-recovery-bound-');
  const preflight = new AbortController();
  const recovery = new AbortController();
  preflight.abort('SIGTERM');
  recovery.abort('recovery-test');
  try {
    await assert.rejects(
      writeNativePilotBlockedReceipt({
        defaultOutputParent: path.join(root, 'attempts'),
        signal: preflight.signal,
        recoverySignal: recovery.signal,
        recoveryDeadlineMs: 100,
        reason: 'cancelled-preflight',
      }),
      (error: unknown) =>
        error instanceof NativePilotRecoveryDeadlineError &&
        error.recoveryDeadlineMs === 100 &&
        error.outputRoot === null &&
        !error.unverifiedRecoveryRoot,
    );
    await assert.rejects(lstat(path.join(root, 'attempts')));
    await assert.rejects(
      writeNativePilotBlockedReceipt({
        defaultOutputParent: path.join(root, 'invalid-bound'),
        recoveryDeadlineMs: 60_001,
      }),
      /recovery deadline/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('cancellation after child creation retains the owned recovery root identity', async () => {
  const root = await privateRoot('mc-public-runner-identity-after-create-cancel-');
  const outputParent = path.join(root, 'attempts');
  const recovery = new AbortController();
  let createdOutputRoot: string | null = null;
  let createdNamespaceIdentity:
    Awaited<ReturnType<typeof createNativePilotOutputRoot>>['namespaceIdentity'] | undefined;
  try {
    await assert.rejects(
      writeNativePilotBlockedReceipt({
        defaultOutputParent: outputParent,
        invocation: parseNativePilotInvocationArguments([
          ...selection,
          `--run-id=${requestedRunId}`,
          `--attempt-id=${requestedAttemptId}`,
        ]),
        recoverySignal: recovery.signal,
        recoveryDeadlineMs: 1_000,
        reason: 'cancelled-preflight',
        onOutputRootCreated: (outputRoot, namespaceIdentity) => {
          createdOutputRoot = outputRoot;
          createdNamespaceIdentity = namespaceIdentity;
          recovery.abort('after-output-root-created');
        },
      }),
      (error: unknown) =>
        error instanceof NativePilotRecoveryDeadlineError &&
        error.outputRoot === path.join(outputParent, requestedRunId) &&
        error.unverifiedRecoveryRoot,
    );
    assert.equal(createdOutputRoot, path.join(outputParent, requestedRunId));
    const createdEntry = await lstat(path.join(outputParent, requestedRunId));
    assert.equal(createdEntry.mode & 0o777, 0o700);
    const reportedEntry = createdNamespaceIdentity?.output.entries.at(-1);
    assert.ok(reportedEntry);
    assert.equal(reportedEntry.path, path.join(outputParent, requestedRunId));
    assert.equal(reportedEntry.dev, createdEntry.dev);
    assert.equal(reportedEntry.ino, createdEntry.ino);
    assert.equal(reportedEntry.uid, createdEntry.uid);
    assert.equal(reportedEntry.gid, createdEntry.gid);
    assert.equal(reportedEntry.mode, createdEntry.mode);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('partial recovery records the original output path and lstat identity', async () => {
  const root = await privateRoot('mc-public-runner-identity-partial-observation-');
  const outputParent = path.join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  const partialOwner = await createNativePilotOutputRoot({
    invocation: parseNativePilotInvocationArguments([
      ...selection,
      `--run-id=${requestedRunId}`,
      `--attempt-id=${requestedAttemptId}`,
      `--output-parent=${outputParent}`,
    ]),
    defaultOutputParent: path.join(root, 'unused-default'),
  });
  const partialOutputRoot = partialOwner.outputRoot;
  const before = await lstat(partialOutputRoot);
  const preflight = new AbortController();
  preflight.abort('SIGTERM');
  try {
    const observation = await observeNativePilotPartialOutput(partialOutputRoot);
    assert.equal(observation.status, 'present');
    assert.equal(observation.entryType, 'directory');
    assert.deepEqual(observation.identity, {
      path: partialOutputRoot,
      dev: before.dev,
      ino: before.ino,
      uid: before.uid,
      gid: before.gid,
      mode: before.mode,
    });
    const blocked = await writeNativePilotBlockedReceipt({
      defaultOutputParent: outputParent,
      partialOutputRoot,
      partialNamespaceIdentity: partialOwner.namespaceIdentity,
      signal: preflight.signal,
      reason: 'cancelled-preflight',
    });
    const recovery = JSON.parse(
      await readFile(path.join(blocked.outputRoot, 'preflight-recovery.private.json'), 'utf8'),
    ) as {
      partialOutputRoot: string;
      partialOutputWasCreated: boolean;
      partialOutputOwnership: string;
      partialOutputObservation: typeof observation;
      cleanup: string;
    };
    assert.equal(recovery.partialOutputRoot, partialOutputRoot);
    assert.equal(recovery.partialOutputWasCreated, true);
    assert.equal(recovery.partialOutputOwnership, 'bound-to-original-namespace');
    assert.deepEqual(recovery.partialOutputObservation.identity, observation.identity);
    assert.equal(recovery.partialOutputObservation.status, 'present');
    assert.equal(recovery.cleanup, 'unverified');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('present but unbound partial output is retained and never adopted as owned', async () => {
  const root = await privateRoot('mc-public-runner-identity-unbound-partial-');
  const outputParent = path.join(root, 'attempts');
  const partialOutputRoot = path.join(outputParent, requestedRunId);
  await mkdir(partialOutputRoot, { recursive: true, mode: 0o700 });
  const before = await lstat(partialOutputRoot);
  const preflight = new AbortController();
  preflight.abort('SIGTERM');
  try {
    const blocked = await writeNativePilotBlockedReceipt({
      defaultOutputParent: outputParent,
      invocation: parseNativePilotInvocationArguments([
        ...selection,
        `--run-id=${requestedRunId}`,
        `--attempt-id=${requestedAttemptId}`,
      ]),
      partialOutputRoot,
      signal: preflight.signal,
      reason: 'cancelled-preflight',
    });
    assert.notEqual(blocked.outputRoot, partialOutputRoot);
    const retained = await lstat(partialOutputRoot);
    assert.equal(retained.dev, before.dev);
    assert.equal(retained.ino, before.ino);
    const recovery = JSON.parse(
      await readFile(path.join(blocked.outputRoot, 'preflight-recovery.private.json'), 'utf8'),
    ) as {
      partialOutputWasCreated: boolean;
      partialOutputOwnership: string;
      partialNamespaceIdentityVerified: boolean;
    };
    assert.equal(recovery.partialOutputWasCreated, false);
    assert.equal(recovery.partialOutputOwnership, 'unverified-present');
    assert.equal(recovery.partialNamespaceIdentityVerified, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('terminal publication remains durable after a late caller abort', async () => {
  const root = await privateRoot('mc-public-runner-identity-terminal-publication-');
  await mkdir(path.join(root, 'attempts'), { mode: 0o700 });
  const invocation = parseNativePilotInvocationArguments([
    ...selection,
    `--run-id=${requestedRunId}`,
    `--attempt-id=${requestedAttemptId}`,
    `--output-parent=${path.join(root, 'attempts')}`,
  ]);
  try {
    const prepared = await createNativePilotOutputRoot({
      invocation,
      defaultOutputParent: path.join(root, 'unused-default'),
    });
    const caller = new AbortController();
    const publication = writeNativePilotTerminalReceipt({
      root: prepared.outputRoot,
      namespaceIdentity: prepared.namespaceIdentity,
      callerSignal: caller.signal,
      receipt: {
        result: 'harness-blocked',
        runId: requestedRunId,
        attemptId: requestedAttemptId,
      },
      recoveryDeadlineMs: 2_000,
    });
    caller.abort('late-deadline-after-terminal-decision');
    const result = await publication;
    assert.equal(result.status, 'published');
    assert.equal(result.recoveryRecordPath, null);
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8')) as {
      result: string;
      runId: string;
      attemptId: string;
    };
    assert.equal(receipt.result, 'harness-blocked');
    assert.equal(receipt.runId, requestedRunId);
    assert.equal(receipt.attemptId, requestedAttemptId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('terminal publication replacement is unverified and cannot write outside the output root', async () => {
  const root = await privateRoot('mc-public-runner-identity-terminal-race-');
  const outside = await privateRoot('mc-public-runner-identity-terminal-race-outside-');
  const outputParent = path.join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  const prepared = await createNativePilotOutputRoot({
    invocation: parseNativePilotInvocationArguments([
      ...selection,
      `--run-id=${requestedRunId}`,
      `--attempt-id=${requestedAttemptId}`,
      `--output-parent=${outputParent}`,
    ]),
    defaultOutputParent: path.join(root, 'unused-default'),
  });
  try {
    const moved = path.join(root, 'moved-output');
    await rename(prepared.outputRoot, moved);
    await symlink(outside, prepared.outputRoot);
    const result = await writeNativePilotTerminalReceipt({
      root: prepared.outputRoot,
      namespaceIdentity: prepared.namespaceIdentity,
      receipt: {
        result: 'passed',
        runId: requestedRunId,
        attemptId: requestedAttemptId,
      },
      recoveryDeadlineMs: 2_000,
    });
    assert.equal(result.status, 'unverified');
    assert.equal(result.recoveryRecordPath, null);
    await assert.rejects(lstat(path.join(outside, 'receipt.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

void test('optional publication returns unverified at a writer-level deadline and never returns a late path as verified', async () => {
  const root = await privateRoot('mc-public-runner-identity-optional-deadline-');
  const outputParent = path.join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  const prepared = await createNativePilotOutputRoot({
    invocation: parseNativePilotInvocationArguments([
      ...selection,
      `--run-id=${requestedRunId}`,
      `--attempt-id=${requestedAttemptId}`,
      `--output-parent=${outputParent}`,
    ]),
    defaultOutputParent: path.join(root, 'unused-default'),
  });
  try {
    const started = performance.now();
    const publication = await writeNativePilotOptionalPrivateFile({
      root: prepared.outputRoot,
      relative: 'late-sidecar.private.json',
      contents: '{}',
      namespaceIdentity: prepared.namespaceIdentity,
      recoveryDeadlineMs: 10,
      write: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        // Deliberately ignore the independent signal in this injected writer
        // to model an already-started non-cooperative filesystem operation.
        return writeNativePilotPrivateFile({ ...input, signal: undefined });
      },
    });
    assert.equal(publication.status, 'unverified');
    assert.equal(publication.error?.code, 'ERR_NATIVE_PILOT_PUBLICATION_DEADLINE');
    assert.ok(performance.now() - started < 500);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await readFile(publication.path, 'utf8'), '{}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('the runner unknown-runtime finalization branch survives sidecar failure without inventing an artifact reference', async () => {
  const runner = await readFile(
    path.join(__dirname, '../../scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  const branchStart = runner.indexOf('const unknownRuntime = !runtime && stage.startsWith(');
  const branchEnd = runner.indexOf('const detail =', branchStart);
  assert.ok(branchStart >= 0);
  assert.ok(branchEnd > branchStart);
  assert.match(runner.slice(branchStart, branchEnd), /writeNativePilotOptionalPrivateFile/);
  assert.match(runner.slice(branchStart, branchEnd), /runtimeFailurePublished/);
  assert.doesNotMatch(runner.slice(branchStart, branchEnd), /signal:\s*controller\.signal/);

  const root = await privateRoot('mc-public-runner-identity-runtime-branch-');
  const outside = await privateRoot('mc-public-runner-identity-runtime-branch-outside-');
  const outputParent = path.join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  const prepared = await createNativePilotOutputRoot({
    invocation: parseNativePilotInvocationArguments([
      ...selection,
      `--run-id=${requestedRunId}`,
      `--attempt-id=${requestedAttemptId}`,
      `--output-parent=${outputParent}`,
    ]),
    defaultOutputParent: path.join(root, 'unused-default'),
  });
  try {
    const moved = path.join(root, 'moved-output');
    await rename(prepared.outputRoot, moved);
    await symlink(outside, prepared.outputRoot);
    const branch = runner.slice(branchStart, branchEnd);
    const asyncFunctionPrototype = Object.getPrototypeOf(async function () {}) as {
      constructor: new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
    };
    const execute = new asyncFunctionPrototype.constructor(
      'output',
      'runId',
      'attemptId',
      'stage',
      'runtime',
      'preparedInvocation',
      'runtimeLinkPublished',
      'writeNativePilotOptionalPrivateFile',
      'nativePilotRuntimeArtifactReferences',
      `${branch}; return { unknownRuntime, runtimeFailurePublished };`,
    );
    const result = (await execute(
      prepared.outputRoot,
      requestedRunId,
      requestedAttemptId,
      'runtime-execution-failed',
      null,
      prepared,
      false,
      writeNativePilotOptionalPrivateFile,
      nativePilotRuntimeArtifactReferences,
    )) as { unknownRuntime: boolean; runtimeFailurePublished: boolean };
    assert.equal(result.unknownRuntime, true);
    assert.equal(result.runtimeFailurePublished, false);
    await assert.rejects(lstat(path.join(outside, 'runtime-failure.private.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

void test('invalid CLI input receives a generated blocked receipt in the fixed safe parent', async () => {
  const root = await privateRoot('mc-public-runner-identity-blocked-');
  const repositoryRoot = path.join(root, 'repository');
  await mkdir(repositoryRoot, { mode: 0o700 });
  await writeFile(path.join(repositoryRoot, 'tracked.txt'), 'fixture');
  for (const args of [
    ['init', '-q', repositoryRoot],
    ['-C', repositoryRoot, 'add', 'tracked.txt'],
    [
      '-C',
      repositoryRoot,
      '-c',
      'user.name=Native pilot test',
      '-c',
      'user.email=native-pilot@example.invalid',
      'commit',
      '-q',
      '-m',
      'fixture',
    ],
  ]) {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const clientIdentity = await repositoryIdentity(repositoryRoot, 'client');
  try {
    const blocked = await writeNativePilotBlockedReceipt({
      defaultOutputParent: path.join(root, 'attempts'),
      startedAt: '2026-10-02T00:00:00.000Z',
    });
    const receipt = JSON.parse(await readFile(blocked.receiptPath, 'utf8')) as {
      result: string;
      exitCode: number;
      runId: string;
      attemptId: string;
      blocker: { code: string };
      cleanup: { status: string };
      command: { argv: string[] };
      repositories: unknown[];
      repositoryEvidence: {
        status: string;
        missing: readonly string[];
        reason: string | null;
      };
    };
    assertPublicReceipt(receipt, blocked.outputRoot);
    assert.equal(receipt.result, 'harness-blocked');
    assert.equal(receipt.exitCode, 2);
    assert.match(receipt.runId, nativePilotRunIdPattern);
    assert.equal(receipt.attemptId, `${receipt.runId}:first`);
    assert.equal(receipt.blocker.code, 'invalid-cli-arguments');
    assert.equal(receipt.cleanup.status, 'not-acquired');
    assert.deepEqual(receipt.repositories, []);
    assert.deepEqual(receipt.repositoryEvidence, {
      status: 'unknown',
      missing: ['client', 'server'],
      reason: 'repository identity was unavailable before the preflight receipt',
    });
    for (const [label, reason, exitCode] of [
      ['root-failure', 'preflight-root-resolution-failed', 2],
      ['cancelled', 'cancelled-preflight', 130],
    ] as const) {
      const blockedVariant = await writeNativePilotBlockedReceipt({
        defaultOutputParent: path.join(root, `attempts-${label}`),
        reason,
        exitCode,
      });
      const blockedVariantReceipt = JSON.parse(
        await readFile(blockedVariant.receiptPath, 'utf8'),
      ) as {
        result: string;
        exitCode: number;
        repositories: unknown[];
        repositoryEvidence: { status: string; missing: readonly string[]; reason: string | null };
      };
      assertPublicReceipt(blockedVariantReceipt, blockedVariant.outputRoot);
      assert.equal(
        blockedVariantReceipt.result,
        label === 'cancelled' ? 'cancelled' : 'harness-blocked',
      );
      assert.equal(blockedVariantReceipt.exitCode, exitCode);
      assert.deepEqual(blockedVariantReceipt.repositories, []);
      assert.equal(blockedVariantReceipt.repositoryEvidence.status, 'unknown');
    }
    assert.deepEqual(receipt.command.argv, [
      'scripts/testing/run-native-pilot.ts',
      '<invalid-arguments>',
    ]);
    assert.equal((await lstat(blocked.receiptPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(blocked.outputRoot)).mode & 0o777, 0o700);
    await assert.rejects(
      writeNativePilotBlockedReceipt({
        defaultOutputParent: path.join(root, 'attempts-unbound'),
        repositories: [
          {
            name: 'client',
            sha: 'a'.repeat(40),
            dirty: false,
            workingTreeHash: null,
          },
        ],
        repositoryEvidence: { status: 'observed', missing: [], reason: null },
      }),
      /unbound repository rows and evidence/,
    );
    await assert.rejects(lstat(path.join(root, 'attempts-unbound')), {
      code: 'ENOENT',
    });
    const observed = await writeNativePilotBlockedReceipt({
      defaultOutputParent: path.join(root, 'attempts-observed'),
      repositoryObservation: createRepositoryObservation([clientIdentity], [], {
        client: repositoryRoot,
      }),
    });
    const observedReceipt = JSON.parse(await readFile(observed.receiptPath, 'utf8')) as {
      repositories: unknown[];
      repositoryEvidence: { status: string; missing: readonly string[]; reason: string | null };
    };
    assertPublicReceipt(observedReceipt, observed.outputRoot);
    assert.equal(observedReceipt.repositories.length, 1);
    assert.deepEqual(observedReceipt.repositoryEvidence, {
      status: 'observed',
      missing: [],
      reason: null,
    });
    const partial = await writeNativePilotBlockedReceipt({
      defaultOutputParent: path.join(root, 'attempts-partial'),
      repositoryObservation: createRepositoryObservation([clientIdentity], ['server'], {
        client: repositoryRoot,
      }),
    });
    const partialReceipt = JSON.parse(await readFile(partial.receiptPath, 'utf8')) as {
      repositories: unknown[];
      repositoryEvidence: { status: string; missing: readonly string[]; reason: string | null };
    };
    assertPublicReceipt(partialReceipt, partial.outputRoot);
    assert.deepEqual(partialReceipt.repositoryEvidence, {
      status: 'partial',
      missing: ['server'],
      reason: 'repository identity was only partially available before the preflight receipt',
    });
    const immutableObservation = createRepositoryObservation([clientIdentity], ['server'], {
      client: repositoryRoot,
    });
    assert.equal(Object.isFrozen(immutableObservation.evidence.missing), true);
    assert.throws(
      () => (immutableObservation.evidence.missing as string[]).push('unexpected'),
      TypeError,
    );
    assert.throws(
      () =>
        createRepositoryObservation([clientIdentity], [], {
          client: path.join(repositoryRoot, 'different-root'),
        }),
      /unbound client root/,
    );
    assert.throws(
      () =>
        createRepositoryObservation([clientIdentity], [], {
          client: repositoryRoot,
          server: repositoryRoot,
        }),
      /unreported expected root/,
    );
    assert.throws(
      () => createRepositoryObservation([clientIdentity], ['bogus'], { client: repositoryRoot }),
      /invalid missing names/,
    );
    const recovered = await writeNativePilotBlockedReceipt({
      defaultOutputParent: path.join(root, 'attempts-recovery'),
      partialOutputRoot: '/private/tmp/untrusted-partial-root',
    });
    const recoveredReceipt = JSON.parse(await readFile(recovered.receiptPath, 'utf8')) as {
      cleanup: { recoveryRecordPath: string | null };
      artifacts: string[];
    };
    assert.equal(recoveredReceipt.cleanup.recoveryRecordPath, 'preflight-recovery.private.json');
    assert.ok(recoveredReceipt.artifacts.includes('preflight-recovery.private.json'));
    assert.equal((await lstat(recovered.recoveryRecordPath!)).mode & 0o777, 0o600);
    const outputFailure = await writeNativePilotBlockedReceipt({
      defaultOutputParent: path.join(root, 'attempts-output-failure'),
      invocation: parseNativePilotInvocationArguments([
        ...selection,
        `--run-id=${requestedRunId}`,
        `--attempt-id=${requestedAttemptId}`,
      ]),
      partialOutputRoot: '/private/tmp/partial-output-root',
      reason: 'preflight-output-root-failed',
    });
    const outputFailureReceipt = JSON.parse(await readFile(outputFailure.receiptPath, 'utf8')) as {
      runId: string;
      attemptId: string;
      result: string;
      blocker: { code: string };
      cleanup: { status: string };
    };
    assert.equal(outputFailureReceipt.runId, requestedRunId);
    assert.equal(outputFailureReceipt.attemptId, requestedAttemptId);
    assert.equal(outputFailureReceipt.result, 'harness-blocked');
    assert.equal(outputFailureReceipt.blocker.code, 'preflight-output-root-failed');
    assert.equal(outputFailureReceipt.cleanup.status, 'failed-recovery-ledger-retained');

    const collisionParent = path.join(root, 'attempts-collision');
    await mkdir(collisionParent, { mode: 0o700 });
    await mkdir(path.join(collisionParent, requestedRunId), { mode: 0o700 });
    const collision = await writeNativePilotBlockedReceipt({
      defaultOutputParent: collisionParent,
      invocation: parseNativePilotInvocationArguments([
        ...selection,
        `--run-id=${requestedRunId}`,
        `--attempt-id=${requestedAttemptId}`,
      ]),
      reason: 'preflight-output-root-failed',
    });
    const collisionReceipt = JSON.parse(await readFile(collision.receiptPath, 'utf8')) as {
      runId: string;
      attemptId: string;
    };
    const collisionIdentity = JSON.parse(
      await readFile(path.join(collision.outputRoot, 'attempt-identity.private.json'), 'utf8'),
    ) as {
      requestedRunId: string;
      requestedAttemptId: string;
      allocatedRunId: string;
      allocatedAttemptId: string;
    };
    assert.notEqual(collisionReceipt.runId, requestedRunId);
    assert.equal(collisionReceipt.attemptId, `${collisionReceipt.runId}:first`);
    assert.equal(collisionIdentity.requestedRunId, requestedRunId);
    assert.equal(collisionIdentity.requestedAttemptId, requestedAttemptId);
    assert.equal(collisionIdentity.allocatedRunId, collisionReceipt.runId);
    assert.equal(collisionIdentity.allocatedAttemptId, collisionReceipt.attemptId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('actual MJS and shell wrappers retain arbitrary identity/output argv for the TS parser', async () => {
  const mjs = await readFile(
    path.join(qualifiedRoot, 'scripts/testing/run-native-pilot.mjs'),
    'utf8',
  );
  const shell = await readFile(
    path.join(qualifiedRoot, 'scripts/testing/run-native-pilot.sh'),
    'utf8',
  );
  const candidateRunner = await readFile(
    path.join(__dirname, '../../scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  assert.match(mjs, /process\.argv\.slice\(2\)/);
  assert.match(shell, /run-native-pilot\.ts \"\$@\"/);
  assert.doesNotMatch(mjs, /run-id|attempt-id|output-parent/);
  assert.doesNotMatch(shell, /run-id|attempt-id|output-parent/);
  assert.match(candidateRunner, /parseNativePilotInvocationArguments/);
  assert.match(candidateRunner, /attempt-identity\.private\.json/);
  assert.match(candidateRunner, /runtime\.requestedRunId(?:\s*[,)]|\s*===)/);
  assert.match(candidateRunner, /runtime\.requestedAttemptId(?:\s*[,)]|\s*===)/);
  assert.match(candidateRunner, /formatNativePilotInvocationArguments\(invocation\)/);
  assert.match(candidateRunner, /writeNativePilotTerminalReceipt/);
  assert.doesNotMatch(candidateRunner, /writeFile\(path\.join\(output, ['"]receipt\.json/);
});

void test('runner installs lifecycle guards before the first awaited output preparation', async () => {
  const runner = await readFile(
    path.join(__dirname, '../../scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  const lifecycleOffset = runner.indexOf('installNativePilotPreflightLifecycle');
  const firstFilesystemAwait = runner.indexOf('await realpath(path.resolve(__dirname,');
  assert.ok(lifecycleOffset >= 0);
  assert.ok(firstFilesystemAwait > lifecycleOffset);
  assert.match(runner, /writeNativePilotBlockedReceipt/);
  assert.match(runner, /preflight\.dispose\(\)/);
  const invocation = await readFile(
    path.join(__dirname, '../../scripts/testing/native-pilot-invocation.ts'),
    'utf8',
  );
  assert.doesNotMatch(invocation, /mkdir\([^)]*recursive\s*:\s*true/);
  assert.match(invocation, /Revalidate the complete chain after creation/);
});

void test('preflight deadline aborts the same controller used by the runner', async () => {
  const lifecycle = installNativePilotPreflightLifecycle({
    startedAtMs: performance.now() - 2_000,
    deadlines: { buildMs: 1_000, stepMs: 1_000, wholeRunMs: 1_000 },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(lifecycle.deadlineExpired, true);
    assert.equal(lifecycle.controller.signal.aborted, true);
    assert.ok(lifecycle.controller.signal.reason instanceof NativeExecutionDeadlineError);
  } finally {
    lifecycle.dispose();
  }
});

void test('anchored directory worker is killed at the caller deadline after reporting its owned root', async () => {
  const root = await privateRoot('mc-public-runner-identity-worker-deadline-');
  const outputParent = path.join(root, 'attempts');
  await mkdir(outputParent, { mode: 0o700 });
  let reportedRoot: string | null = null;
  const started = performance.now();
  try {
    await assert.rejects(
      createNativePilotOutputRoot({
        invocation: parseNativePilotInvocationArguments([
          ...selection,
          `--run-id=${requestedRunId}`,
          `--attempt-id=${requestedAttemptId}`,
          `--output-parent=${outputParent}`,
        ]),
        defaultOutputParent: path.join(root, 'unused-default'),
        deadlineAt: started + 1_000,
        testWorkerDelayMs: 2_000,
        onOutputRootCreated: (outputRoot) => {
          reportedRoot = outputRoot;
        },
      }),
      /deadline|worker|signal/i,
    );
    assert.ok(performance.now() - started < 2_000);
    assert.equal(reportedRoot, path.join(outputParent, requestedRunId));
    assert.equal((await lstat(reportedRoot)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

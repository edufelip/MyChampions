import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  readRemoteServiceHelperSourceClosure,
  remoteServiceHelperTestEnvironmentKeys,
  remoteServiceHelperTargetBundles,
  runRemoteServicePromptHelper,
  type RemoteServiceHelperExecution,
} from '../../scripts/testing/ios-detox-camera-remote-service-helper';

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const plist = createRequire(import.meta.url)('plist') as {
  parse: (xml: string) => Record<string, unknown>;
};
const projectPath = path.join(
  candidateRoot,
  'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.xcodeproj',
);
const helperUdid = '01234567-89AB-CDEF-0123-456789ABCDEF';

function xctestrunFixture(environmentKeys: readonly string[]): string {
  const entries = environmentKeys
    .map((key) => `\t\t\t<key>${key}</key>\n\t\t\t<string>fixture-${key}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
\t<key>RemoteServicePromptHelper</key>
\t<dict>
\t\t<key>ProductModuleName</key>
\t\t<string>RemoteServicePromptHelper</string>
\t\t<key>TestHostPath</key>
\t\t<string>__TESTROOT__/Products/RemoteServicePromptHelper.xctrunner</string>
\t\t<key>TestBundlePath</key>
\t\t<string>__TESTHOST__/PlugIns/RemoteServicePromptHelper.xctest</string>
\t\t<key>TestHostBundleIdentifier</key>
\t\t<string>com.edufelip.mychampions.remote.service.helper.xctrunner</string>
\t\t<key>TestingEnvironmentVariables</key>
\t\t<dict>
${entries}
\t\t</dict>
\t</dict>
</dict></plist>
`;
}

function readBudget() {
  return {
    deadlineAtMonotonicMs: performance.now() + 30_000,
    consumedBytes: 0,
    maxAggregateBytes: 512 * 1024 * 1024,
  };
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function execution(
  overrides: Partial<RemoteServiceHelperExecution> = {},
): RemoteServiceHelperExecution {
  return {
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    pid: 1234,
    pgid: 1234,
    logPath: '/private/log.private.log',
    stdoutPath: '/private/stdout.private.log',
    ownershipPath: '/private/ownership.private.json',
    elapsedMs: 20,
    cleanupMs: 2,
    ...overrides,
  };
}

async function fixture(
  status: 'dismissed' | 'absent' = 'dismissed',
  nativeExecution: RemoteServiceHelperExecution = execution(),
  receiptMutation?: (receipt: Record<string, unknown>) => void,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ios-remote-service-helper-v19-'));
  const artifactRoot = path.join(root, 'artifacts');
  await writeFile(path.join(root, 'placeholder'), 'fixture');
  await mkdir(artifactRoot, { mode: 0o700 });
  await chmod(artifactRoot, 0o700);
  const canonicalArtifactRoot = await realpath(artifactRoot);
  const helperBinaryPath = path.join(root, 'RemoteServicePromptHelper');
  const xctestrunPath = path.join(root, 'RemoteServicePromptHelper.xctestrun');
  await writeFile(helperBinaryPath, Buffer.from('compiled-helper-fixture'));
  await writeFile(
    xctestrunPath,
    Buffer.from(xctestrunFixture(remoteServiceHelperTestEnvironmentKeys)),
  );
  const canonicalHelperBinaryPath = await realpath(helperBinaryPath);
  const canonicalXctestrunPath = await realpath(xctestrunPath);
  const canonicalProjectPath = await realpath(projectPath);
  const closure = await readRemoteServiceHelperSourceClosure(candidateRoot, {
    ...readBudget(),
  });
  const helperBinarySha256 = sha256(await readFile(canonicalHelperBinaryPath));
  const xctestrunSha256 = sha256(await readFile(canonicalXctestrunPath));
  const buildReceiptPath = path.join(canonicalArtifactRoot, 'build.private.json');
  await writeFile(
    buildReceiptPath,
    JSON.stringify(
      {
        schema: 'ios-detox-camera-remote-service-build-receipt-v1',
        sourceRoot: candidateRoot,
        projectPath: canonicalProjectPath,
        scheme: 'RemoteServicePromptHelper',
        commandCwd: candidateRoot,
        testEnvironmentKeys: remoteServiceHelperTestEnvironmentKeys,
        environmentTransport: 'xctestrun.TestingEnvironmentVariables',
        xctestrunOnlyTestIdentifiers: [
          'RemoteServicePromptHelper/RemoteServicePromptHelperTests/testObserveAndDismissSavePasswordPrompt',
        ],
        xctestrunSkipTestIdentifiers: [],
        xctestrunTestHostBundleIdentifier:
          'com.edufelip.mychampions.remote.service.helper.xctrunner',
        xctestrunProductModuleName: 'RemoteServicePromptHelper',
        helperBundleIdentifier: 'com.edufelip.mychampions.remote.service.helper',
        sourceClosureSha256: closure.sourceClosureSha256,
        projectClosureSha256: closure.projectClosureSha256,
        sourceClosure: closure.source,
        projectClosure: closure.project,
        xctestrunPath: canonicalXctestrunPath,
        xctestrunSha256,
        helperBinaryPath: canonicalHelperBinaryPath,
        helperBinarySha256,
      },
      null,
      2,
    ),
    { encoding: 'utf8', mode: 0o600, flag: 'wx' },
  );
  await chmod(buildReceiptPath, 0o600);
  const receiptPath = path.join(canonicalArtifactRoot, 'helper.private.json');
  const commandReceiptPath = path.join(canonicalArtifactRoot, 'command.private.json');
  const cancelPath = path.join(canonicalArtifactRoot, 'cancel.private');
  const deadlineAtEpochMs = Date.now() + 30_000;
  let captured:
    | Parameters<NonNullable<Parameters<typeof runRemoteServicePromptHelper>[0]['execute']>>[0]
    | undefined;
  const execute = async (
    input: Parameters<
      NonNullable<Parameters<typeof runRemoteServicePromptHelper>[0]['execute']>
    >[0],
  ) => {
    captured = input;
    const closure = await readRemoteServiceHelperSourceClosure(candidateRoot, {
      ...readBudget(),
    });
    const helperBinarySha256 = sha256(await readFile(canonicalHelperBinaryPath));
    if (nativeExecution.execution === 'completed') {
      const receipt: Record<string, unknown> = {
        schema: 'ios-detox-camera-remote-service-helper-receipt-v1',
        status,
        action: 'dismiss-save-password',
        expectedDeviceUdid: helperUdid,
        observedDeviceUdid: helperUdid,
        runId: input.env.REMOTE_SERVICE_HELPER_RUN_ID,
        promptLabel: 'Save Password?',
        dismissLabel: 'Not Now',
        targetBundleIdentifiers: remoteServiceHelperTargetBundles,
        targetBundleIdentifier:
          status === 'dismissed' ? remoteServiceHelperTargetBundles[0].bundleIdentifier : null,
        reason:
          status === 'dismissed'
            ? 'unique-witness-and-actionable-dismiss-control'
            : 'no-unique-actionable-prompt-before-deadline',
        reachedTargetCount: 1,
        stableActionableSamplesBeforeTap: status === 'dismissed' ? 2 : 0,
        tapSent: status === 'dismissed',
        attempts: [
          {
            role: remoteServiceHelperTargetBundles[0].role,
            bundleIdentifier: remoteServiceHelperTargetBundles[0].bundleIdentifier,
            applicationExists: true,
            prompt: {
              count: status === 'dismissed' ? 1 : 0,
              exists: status === 'dismissed',
              enabled: status === 'dismissed',
              visible: status === 'dismissed',
              hittable: status === 'dismissed',
            },
            dismiss: {
              count: status === 'dismissed' ? 1 : 0,
              exists: status === 'dismissed',
              enabled: status === 'dismissed',
              visible: status === 'dismissed',
              hittable: status === 'dismissed',
            },
            outcome: status === 'dismissed' ? 'unique-actionable' : 'no-unique-match',
            observedAtMs: Date.now(),
          },
        ],
        helper: {
          bundleIdentifier: 'com.edufelip.mychampions.remote.service.helper',
          bundlePath: path.dirname(canonicalHelperBinaryPath),
          executablePath: canonicalHelperBinaryPath,
          expectedBinaryPath: canonicalHelperBinaryPath,
          binarySha256: helperBinarySha256,
          sourceClosureSha256: closure.sourceClosureSha256,
          projectClosureSha256: closure.projectClosureSha256,
        },
        timing: {
          startedAtMs: Date.now() - 10,
          endedAtMs: Date.now(),
          originalDeadlineAtMs: Number(input.env.REMOTE_SERVICE_HELPER_DEADLINE_AT_MS),
        },
        error: null,
      };
      receiptMutation?.(receipt);
      await writeFile(
        input.env.REMOTE_SERVICE_HELPER_RECEIPT_PATH as string,
        JSON.stringify(receipt),
        {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        },
      );
      await chmod(input.env.REMOTE_SERVICE_HELPER_RECEIPT_PATH as string, 0o600);
    }
    return nativeExecution;
  };
  return {
    root,
    artifactRoot: canonicalArtifactRoot,
    helperBinaryPath: canonicalHelperBinaryPath,
    buildReceiptPath,
    xctestrunPath: canonicalXctestrunPath,
    receiptPath,
    commandReceiptPath,
    cancelPath,
    deadlineAtEpochMs,
    deadlineAtMonotonicMs: performance.now() + 30_000,
    execute,
    get captured() {
      return captured;
    },
  };
}

async function runFixture(item: Awaited<ReturnType<typeof fixture>>, signal?: AbortSignal) {
  return runRemoteServicePromptHelper({
    sourceRoot: candidateRoot,
    reviewedSourceRoot: candidateRoot,
    artifactRoot: item.artifactRoot,
    deviceUdid: helperUdid,
    bootstrapChild: { pid: 1234, pgid: 1234, startedAt: 'fixture-child-start' },
    bootstrapCommandHash: 'a'.repeat(64),
    deadlineAtMonotonicMs: item.deadlineAtMonotonicMs,
    deadlineAtEpochMs: item.deadlineAtEpochMs,
    projectPath,
    xctestrunPath: item.xctestrunPath,
    helperBinaryPath: item.helperBinaryPath,
    buildReceiptPath: item.buildReceiptPath,
    receiptPath: item.receiptPath,
    commandReceiptPath: item.commandReceiptPath,
    cancelPath: item.cancelPath,
    signal,
    execute: item.execute,
  });
}

async function mutateJsonFile(
  filePath: string,
  mutate: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  mutate(value);
  await writeFile(filePath, JSON.stringify(value), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'w',
  });
  await chmod(filePath, 0o600);
}

void test('source-executed helper binds exact UDID, test-without-building, receipt provenance and cleanup', async () => {
  const item = await fixture('dismissed');
  try {
    const result = await runFixture(item);
    assert.equal(result.status, 'dismissed');
    assert.equal(item.captured?.command, 'xcodebuild');
    assert.equal(item.captured?.argv[0], 'test-without-building');
    assert.equal(item.captured?.argv.includes('-project'), false);
    assert.equal(item.captured?.argv.includes(projectPath), false);
    assert.equal(item.captured?.argv.includes(`platform=iOS Simulator,id=${helperUdid}`), true);
    assert.equal(
      item.captured?.argv.some((arg) => /simctl|launch/i.test(arg)),
      false,
    );
    assert.equal(item.captured?.env.REMOTE_SERVICE_HELPER_EXPECTED_UDID, helperUdid);
    assert.equal(item.captured?.env.SIMULATOR_UDID, helperUdid);
    assert.equal(item.captured?.env.REMOTE_SERVICE_HELPER_BINARY_PATH, item.helperBinaryPath);
    assert.equal(
      item.captured?.argv.filter((arg) => arg === '-test-environment-variable').length,
      0,
    );
    assert.equal(item.captured?.env.REMOTE_SERVICE_HELPER_BUDGET_REMAINING_MS !== undefined, true);
    assert.equal(result.commandReceipt.projectPath, projectPath);
    assert.deepEqual(result.commandReceipt.bootstrapChild, {
      pid: 1234,
      pgid: 1234,
      startedAt: 'fixture-child-start',
    });
    assert.equal(result.commandReceipt.bootstrapCommandHash, 'a'.repeat(64));
    assert.equal(result.commandReceipt.scheme, 'RemoteServicePromptHelper');
    assert.equal(result.commandReceipt.buildReceiptPath, item.buildReceiptPath);
    assert.notEqual(result.commandReceipt.xctestrunPath, item.xctestrunPath);
    assert.equal(item.captured?.argv[2], result.commandReceipt.xctestrunPath);
    const materialized = plist.parse(
      await readFile(result.commandReceipt.xctestrunPath, 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    const target = materialized.RemoteServicePromptHelper;
    assert.equal(typeof target.TestHostPath, 'string');
    assert.equal(path.isAbsolute(target.TestHostPath as string), true);
    assert.equal(typeof target.TestBundlePath, 'string');
    assert.equal(path.isAbsolute(target.TestBundlePath as string), true);
    assert.deepEqual(
      Object.keys(target.TestingEnvironmentVariables as Record<string, unknown>).sort(),
      [...remoteServiceHelperTestEnvironmentKeys].sort(),
    );
    assert.equal(
      (target.TestingEnvironmentVariables as Record<string, unknown>).SIMULATOR_UDID,
      helperUdid,
    );
    assert.equal(result.commandReceipt.qualifiedXctestrunPath, item.xctestrunPath);
    assert.equal(
      result.commandReceipt.materializedTestingEnvironmentSha256,
      sha256(
        Buffer.from(
          Object.keys(target.TestingEnvironmentVariables as Record<string, string>)
            .sort()
            .map(
              (key) =>
                `${key}\u0000${(target.TestingEnvironmentVariables as Record<string, string>)[key]}\n`,
            )
            .join(''),
          'utf8',
        ),
      ),
    );
    assert.equal(result.commandReceipt.buildReceiptMode, 0o600);
    assert.equal(result.commandReceipt.cleanup.nativeCommand, 'cleaned');
    assert.equal(result.commandReceipt.helperReceiptMode, 0o600);
    assert.equal(result.commandReceipt.helperReceiptError, null);
    assert.equal(result.receiptSha256, sha256(await readFile(item.receiptPath)));
    assert.equal(result.commandReceiptSha256, sha256(await readFile(item.commandReceiptPath)));
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper accepts only a bounded reachable-target absence without tapping', async () => {
  const item = await fixture('absent');
  try {
    const result = await runFixture(item);
    assert.equal(result.status, 'absent');
    assert.equal(result.receipt.tapSent, false);
    assert.equal(result.receipt.reason, 'no-unique-actionable-prompt-before-deadline');
    assert.equal(result.commandReceipt.destinationUdid, helperUdid);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper rejects a materialized plist whose protected value changes after launch', async () => {
  const item = await fixture('dismissed');
  const originalExecute = item.execute;
  item.execute = async (input) => {
    const result = await originalExecute(input);
    const materializedPath = input.argv[input.argv.indexOf('-xctestrun') + 1];
    assert.equal(typeof materializedPath, 'string');
    const bytes = await readFile(materializedPath, 'utf8');
    await writeFile(
      materializedPath,
      bytes.replace(helperUdid, 'FEDCBA98-7654-3210-FEDC-BA9876543210'),
      { encoding: 'utf8', mode: 0o600, flag: 'w' },
    );
    await chmod(materializedPath, 0o600);
    return result;
  };
  try {
    await assert.rejects(
      () => runFixture(item),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        error.message.includes('materialized xctestrun changed'),
    );
    const commandReceipt = JSON.parse(await readFile(item.commandReceiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.match(String(commandReceipt.helperReceiptError), /materialized xctestrun changed/);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper rejects nested environment values and unreviewed bundle paths', async () => {
  for (const mutation of ['nested-value', 'wrong-path'] as const) {
    const item = await fixture('dismissed');
    try {
      const original = await readFile(item.xctestrunPath, 'utf8');
      const mutated =
        mutation === 'nested-value'
          ? original.replace(
              `<string>fixture-SIMULATOR_UDID</string>`,
              '<dict><key>nested</key><string>wrong</string></dict>',
            )
          : original.replace(
              '__TESTHOST__/PlugIns/RemoteServicePromptHelper.xctest',
              '__TESTROOT__/Unreviewed/RemoteServicePromptHelper.xctest',
            );
      await writeFile(item.xctestrunPath, mutated, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'w',
      });
      await chmod(item.xctestrunPath, 0o600);
      const newHash = sha256(Buffer.from(mutated));
      await mutateJsonFile(item.buildReceiptPath, (receipt) => {
        receipt.xctestrunSha256 = newHash;
      });
      await assert.rejects(
        () => runFixture(item),
        (error: unknown) =>
          error instanceof Error &&
          error.name === 'RemoteServiceHelperError' &&
          /TestingEnvironmentVariables value|target bundle path mismatch/.test(error.message),
      );
      assert.equal(item.captured, undefined);
    } finally {
      await rm(item.root, { recursive: true, force: true });
    }
  }
});

void test('source-executed helper retains native failure and cleanup state instead of converting it to absence', async () => {
  const item = await fixture('absent', execution({ execution: 'child-failed', childExitCode: 65 }));
  try {
    await assert.rejects(
      () => runFixture(item),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        error.message.includes('did not produce a usable receipt'),
    );
    const commandReceipt = JSON.parse(await readFile(item.commandReceiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.equal((commandReceipt.execution as Record<string, unknown>).execution, 'child-failed');
    assert.equal((commandReceipt.execution as Record<string, unknown>).childExitCode, 65);
    assert.equal((commandReceipt.cleanup as Record<string, unknown>).nativeCommand, 'cleaned');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper records cancellation marker cleanup and preserves cancellation', async () => {
  const controller = new AbortController();
  const item = await fixture('absent', execution({ execution: 'cancelled', childExitCode: null }));
  const execute = item.execute;
  item.execute = async (input) => {
    controller.abort();
    return execute(input);
  };
  try {
    await assert.rejects(
      () => runFixture(item, controller.signal),
      (error: unknown) => error instanceof Error && error.name === 'RemoteServiceHelperError',
    );
    const commandReceipt = JSON.parse(await readFile(item.commandReceiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.equal((commandReceipt.execution as Record<string, unknown>).execution, 'cancelled');
    assert.match(
      String((commandReceipt.cleanup as Record<string, unknown>).cancelMarker),
      /removed|absent/,
    );
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper fails before native launch when cancellation is already requested', async () => {
  const controller = new AbortController();
  const item = await fixture('dismissed');
  controller.abort();
  try {
    await assert.rejects(
      () => runFixture(item, controller.signal),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        error.message.includes('cancelled'),
    );
    assert.equal(item.captured, undefined);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper rejects duplicate or non-actionable dismissal evidence', async () => {
  const item = await fixture('dismissed', execution(), (receipt) => {
    const attempts = receipt.attempts as Record<string, unknown>[];
    attempts[0].outcome = 'ambiguous';
  });
  try {
    await assert.rejects(
      () => runFixture(item),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        error.message.includes('unique actionable'),
    );
    const commandReceipt = JSON.parse(await readFile(item.commandReceiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.match(String(commandReceipt.helperReceiptError), /unique actionable/);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper rejects a dismissal receipt that completed after the original deadline', async () => {
  const item = await fixture('dismissed', execution(), (receipt) => {
    const timing = receipt.timing as Record<string, unknown>;
    timing.endedAtMs = Number(timing.originalDeadlineAtMs) + 1;
  });
  try {
    await assert.rejects(
      () => runFixture(item),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        error.message.includes('completed after deadline'),
    );
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper rejects build manifests that do not bind the compiled binary', async () => {
  const item = await fixture('dismissed');
  try {
    await mutateJsonFile(item.buildReceiptPath, (receipt) => {
      receipt.helperBinarySha256 = '0'.repeat(64);
    });
    await assert.rejects(
      () => runFixture(item),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        error.message.includes('build receipt helper binary hash mismatch'),
    );
    assert.equal(item.captured, undefined);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper rejects symlinked binary input before native execution', async () => {
  const item = await fixture('dismissed');
  const symlinkPath = path.join(item.root, 'RemoteServicePromptHelper.symlink');
  const { symlink } = await import('node:fs/promises');
  await symlink(item.helperBinaryPath, symlinkPath);
  try {
    await assert.rejects(
      () =>
        runRemoteServicePromptHelper({
          sourceRoot: candidateRoot,
          reviewedSourceRoot: candidateRoot,
          artifactRoot: item.artifactRoot,
          deviceUdid: helperUdid,
          bootstrapChild: {
            pid: 1234,
            pgid: 1234,
            startedAt: 'fixture-child-start',
          },
          bootstrapCommandHash: 'a'.repeat(64),
          deadlineAtMonotonicMs: item.deadlineAtMonotonicMs,
          deadlineAtEpochMs: item.deadlineAtEpochMs,
          projectPath,
          xctestrunPath: item.xctestrunPath,
          helperBinaryPath: symlinkPath,
          buildReceiptPath: item.buildReceiptPath,
          receiptPath: item.receiptPath,
          commandReceiptPath: item.commandReceiptPath,
          cancelPath: item.cancelPath,
          execute: item.execute,
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        error.message.includes('not canonical'),
    );
    assert.equal(item.captured, undefined);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper retains unknown cleanup instead of reporting a camera outcome', async () => {
  const item = await fixture(
    'absent',
    execution({ execution: 'child-failed', cleanup: 'unknown' }),
  );
  try {
    await assert.rejects(
      () => runFixture(item),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        error.message.includes('did not produce a usable receipt'),
    );
    const commandReceipt = JSON.parse(await readFile(item.commandReceiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.equal((commandReceipt.execution as Record<string, unknown>).cleanup, 'unknown');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('source-executed helper rejects hard-linked helper input before native execution', async () => {
  const item = await fixture('dismissed');
  const hardLinkPath = path.join(item.root, 'RemoteServicePromptHelper.hardlink');
  await link(item.helperBinaryPath, hardLinkPath);
  try {
    await assert.rejects(
      () => runFixture(item),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RemoteServiceHelperError' &&
        /hard-linked|unlinked regular file/.test(error.message),
    );
    assert.equal(item.captured, undefined);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('helper source and project are native semantic remote-service controls without relaunch or coordinates', async () => {
  const swift = await readFile(
    path.join(candidateRoot, 'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.swift'),
    'utf8',
  );
  const project = await readFile(
    path.join(
      candidateRoot,
      'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.xcodeproj/project.pbxproj',
    ),
    'utf8',
  );
  const scheme = await readFile(
    path.join(
      candidateRoot,
      'ios/RemoteServicePromptHelper/RemoteServicePromptHelper.xcodeproj/xcshareddata/xcschemes/RemoteServicePromptHelper.xcscheme',
    ),
    'utf8',
  );
  const adapter = await readFile(
    path.join(candidateRoot, 'scripts/testing/ios-detox-camera-remote-service-helper.ts'),
    'utf8',
  );
  assert.match(swift, /XCUIApplication\(bundleIdentifier: target\.bundleIdentifier\)/);
  assert.match(swift, /Save Password\?/);
  assert.match(swift, /Not Now/);
  assert.match(swift, /stableSamples >= 2/);
  assert.match(swift, /SIMULATOR_UDID/);
  assert.match(swift, /systemUptime/);
  assert.doesNotMatch(swift, /Data\(contentsOf:/);
  assert.match(swift, /REMOTE_SERVICE_HELPER_CANCEL_PATH/);
  assert.doesNotMatch(swift, /\.launch\s*\(|\.activate\s*\(|coordinate\s*\(/);
  assert.match(adapter, /readBoundedRegularFile/);
  assert.match(adapter, /O_NOFOLLOW/);
  assert.match(adapter, /parseXctestrunDescriptor/);
  assert.match(adapter, /materializeXctestrun/);
  assert.match(adapter, /materializedTestingEnvironmentSha256/);
  assert.doesNotMatch(adapter, /countExactKey|requiredFragments/);
  assert.doesNotMatch(adapter, /-test-environment-variable/);
  assert.match(adapter, /TestingEnvironmentVariables/);
  assert.doesNotMatch(adapter, /from 'node:fs\/promises';[\s\S]*readFile/);
  assert.match(project, /com\.apple\.product-type\.bundle\.ui-testing/);
  assert.match(project, /XCTest\.framework/);
  assert.match(scheme, /test-without-building|RemoteServicePromptHelper/);
  assert.deepEqual(
    remoteServiceHelperTargetBundles.map((target) => target.bundleIdentifier),
    ['com.apple.SafariViewService'],
  );
});

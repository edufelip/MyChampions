import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildT15IdentityMap,
  buildNativePilotInvocation,
  createT15ColdResetProducer,
  createT15PublicAttemptProducer,
  ensureT15IdentityMap,
  mapT15SpecToNative,
  readT15ProtectedTerminalReceipt,
  type T15OwnershipSidecar,
} from '../../scripts/testing/t15-cold-production-runner';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonSpec,
} from '../../scripts/testing/compare-native-pilot';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type {
  ColdComparisonAttemptInvocation,
  FreshColdReset,
  QualifiedBuildReuse,
} from '../../scripts/testing/t15-cold-dispatcher';

const HASH = 'a'.repeat(64);
const RUN_ID = '0123456789abcdef01234567';
const FOREIGN_RUN_ID = 'abcdef0123456789abcdef01';

function expected(runId = RUN_ID): NativeComparisonAttemptExpectation {
  return {
    runId,
    trialOrdinal: 1,
    attemptId: `${runId}:first`,
    locale: 'en-US',
    cohortId: 't15-cohort',
    fixtureResetId: `${runId}:reset`,
    repositories: [],
    target: {
      deviceId: 'owned-device',
      osVersion: '17.5',
      appId: 'com.example.ios',
      buildProfile: 'release',
      binaryHash: HASH,
      apiOrigin: 'http://127.0.0.1:43123',
    },
    inputs: {
      scenarioHash: HASH,
      requirementHash: HASH,
      fixtureHash: HASH,
      flagsHash: HASH,
      toolVersions: { detox: '20.47.0' },
    },
    coldAttemptIdentity: {
      ownerRunId: runId,
      processPid: null,
      processStartIdentity: null,
      ownedPorts: [],
      ownershipWindows: [],
      originalReceiptBinding: {
        status: 'pending',
        receiptPath: null,
        artifactRoot: null,
        receiptHash: null,
      },
    },
  };
}

function selection(): NativePilotSelection {
  return {
    arguments: {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-training-ios',
      mode: 'integration',
    },
    scenarioHash: HASH,
    requirementHash: HASH,
    scenario: {
      id: 'SCN-training-ios',
      platform: 'ios',
      flowId: 'FLW-training',
      transitionIds: [],
      requirementRefs: [],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:SCN-training-ios:fresh-attempt',
      freshnessInputs: { requirementPaths: [] },
      pilotAssertions: [],
    },
  };
}

function identity() {
  return {
    dev: 1,
    ino: 2,
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    gid: typeof process.getgid === 'function' ? process.getgid() : 0,
    mode: 0o100600,
    nlink: 1,
    size: 32,
    mtimeMs: 1,
    ctimeMs: 1,
  };
}

function validReset(input: NativeComparisonAttemptExpectation): FreshColdReset {
  return {
    fixtureResetId: input.fixtureResetId,
    ownerRunId: input.runId,
    cohortFixtureFingerprint: HASH,
    status: 'fresh',
    startedAt: '2026-10-03T10:00:00.000Z',
    finishedAt: '2026-10-03T10:00:01.000Z',
    appStateFingerprint: HASH,
    fixtureStateFingerprint: HASH,
    sourceFingerprint: HASH,
    helperFingerprint: HASH,
    originalResetBinding: {
      status: 'verified',
      receiptPath: '/private/tmp/t15-reset.json',
      artifactRoot: '/private/tmp/t15-reset-root',
      receiptHash: HASH,
      identity: identity(),
    },
    target: { deviceId: input.target.deviceId, platform: 'ios' },
    backend: { origin: input.target.apiOrigin, runId: input.runId },
    cleanupStatus: 'cleaned',
    blocker: null,
  };
}

function build(): QualifiedBuildReuse {
  return {
    platform: 'ios',
    buildId: 'b'.repeat(24),
    buildProfile: 'release',
    sourceFingerprint: HASH,
    helperFingerprint: HASH,
    flagsFingerprint: HASH,
    binaryHash: HASH,
    current: true,
  };
}

function input(runId = RUN_ID): ColdComparisonAttemptInvocation {
  const item = expected(runId);
  return {
    spec: {} as never,
    expected: item,
    selection: selection(),
    signal: new AbortController().signal,
    reusableBuild: build(),
    reset: validReset(item),
    terminalize: () => undefined,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function identityMapSpec(): NativeComparisonSpec {
  const ledgerEntry = {
    id: 'assertion-one',
    requirementRefs: ['TC-001'],
    requirementPaths: ['docs/test-cases/TC-001.md'],
    evidenceKinds: ['ui' as const],
    startingState: 'fresh',
    action: 'perform the reviewed action',
    expected: 'the reviewed state is visible',
    evidencePathTemplates: ['assertions/{attemptId}/assertion-one.private.json'],
  };
  const { id: _ledgerId, ...semanticLedgerEntry } = ledgerEntry;
  const ledger = {
    sourcePath: 'docs/qa/native-pilot/inventory.json' as const,
    sourceHash: HASH,
    dataMode: 'integration' as const,
    contractHash: createHash('sha256')
      .update(canonical([ledgerEntry]))
      .digest('hex'),
    semanticHash: createHash('sha256')
      .update(canonical([semanticLedgerEntry]))
      .digest('hex'),
    entries: [ledgerEntry],
  };
  const makeCell = (engine: 'maestro' | 'detox') => {
    const first = expected(`run-training-ios-${engine}-1`);
    const second = expected(`run-training-ios-${engine}-2`);
    return {
      scenarioId: 'SCN-training-ios',
      platform: 'ios' as const,
      engine,
      mode: 'integration' as const,
      locale: 'en-US' as const,
      requiredAssertionIds: ['assertion-one'],
      assertionLedger: ledger,
      expectedAttempts: [
        {
          ...first,
          trialOrdinal: 1,
          cohortId: 't15-map-cohort',
          fixtureResetId: `reset-${engine}-1`,
          repositories: [
            {
              name: 'client',
              sha: 'b'.repeat(40),
              dirty: false,
              workingTreeHash: null,
            },
          ],
        },
        {
          ...second,
          trialOrdinal: 2,
          cohortId: 't15-map-cohort',
          fixtureResetId: `reset-${engine}-2`,
          repositories: [
            {
              name: 'client',
              sha: 'b'.repeat(40),
              dirty: false,
              workingTreeHash: null,
            },
          ],
        },
      ],
    };
  };
  const maestro = makeCell('maestro');
  const detox = makeCell('detox');
  return {
    schemaVersion: 1,
    cohort: {
      id: 't15-map-cohort',
      sourceFingerprint: HASH,
      fixtureResetFingerprint: HASH,
      flagsFingerprint: HASH,
      instrumentationOnlyDifferences: [],
    },
    scope: 'partial',
    attemptsPerCell: 2,
    minimumFirstAttemptPasses: 2,
    cells: [maestro, detox],
    executionOrder: [
      {
        pairId: 'pair-training-ios',
        scenarioId: 'SCN-training-ios',
        platform: 'ios',
        mode: 'integration',
        locale: 'en-US',
        firstEngine: 'maestro',
        trials: [
          {
            trialOrdinal: 1,
            firstAttemptId: maestro.expectedAttempts[0].attemptId,
            secondAttemptId: detox.expectedAttempts[0].attemptId,
          },
          {
            trialOrdinal: 2,
            firstAttemptId: detox.expectedAttempts[1].attemptId,
            secondAttemptId: maestro.expectedAttempts[1].attemptId,
          },
        ],
      },
    ],
  };
}

function digest(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sidecar(
  current: ColdComparisonAttemptInvocation,
  root: string,
  captureRunId: string,
  cleanupPath: string,
  cleanupHash: string,
): T15OwnershipSidecar {
  const ownershipPath = path.join(root, 'native-pilot.ownership.json');
  return {
    schemaVersion: 1,
    kind: 'private t15 original ownership sidecar',
    ownerRunId: current.expected.runId,
    attemptId: current.expected.attemptId,
    captureRunId,
    runner: {
      pid: 123,
      startIdentity: 'start-123',
      ownershipPath,
      ownershipHash: digest('{"processes":[{"pid":123,"started":"start-123"}]}\n'),
    },
    process: {
      pid: 123,
      startIdentity: 'start-123',
      acquiredAt: '2026-10-03T10:00:00.000Z',
      releasedAt: '2026-10-03T10:00:01.000Z',
    },
    ports: [
      {
        port: 43123,
        acquiredAt: '2026-10-03T10:00:00.000Z',
        releasedAt: '2026-10-03T10:00:01.000Z',
      },
    ],
    cleanup: {
      status: 'cleaned',
      receiptPath: cleanupPath,
      receiptHash: cleanupHash,
    },
  };
}

async function writeMockTerminal(
  options: { artifactRoot: string; stdoutPath: string; argv: string[] },
  current: ColdComparisonAttemptInvocation,
  result: 'passed' | 'application-failed' | 'harness-blocked',
  runtimeRunId = current.expected.runId,
  runtimeAttemptId = current.expected.attemptId,
): Promise<void> {
  const outputParent = options.argv
    .find((value) => value.startsWith('--output-parent='))!
    .slice('--output-parent='.length);
  const runId = options.argv
    .find((value) => value.startsWith('--run-id='))!
    .slice('--run-id='.length);
  const outputRoot = path.join(outputParent, runId);
  await mkdir(outputRoot, { mode: 0o700, recursive: true });
  const cleanupPath = path.join(outputRoot, 'cleanup.private.json');
  const cleanupBytes = '{"status":"cleaned"}\n';
  await writeFile(cleanupPath, cleanupBytes, { mode: 0o600, flag: 'wx' });
  const cleanupHash = digest(cleanupBytes);
  const ledger = '{"processes":[{"pid":123,"started":"start-123"}]}\n';
  await writeFile(path.join(options.artifactRoot, 'native-pilot.ownership.json'), ledger, {
    mode: 0o600,
    flag: 'wx',
  });
  const captureRunId = 'capture-123';
  await writeFile(
    path.join(outputRoot, 'runtime-link.private.json'),
    JSON.stringify({
      requestedRunId: runtimeRunId,
      requestedAttemptId: runtimeAttemptId,
      captureRunId,
      callbackInvocations: 1,
      callbackCompleted: true,
    }) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(
    path.join(outputRoot, 'original-ownership.private.json'),
    JSON.stringify(sidecar(current, options.artifactRoot, captureRunId, cleanupPath, cleanupHash)) +
      '\n',
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(
    path.join(outputRoot, 'receipt.json'),
    JSON.stringify({
      schemaVersion: 1,
      runId,
      attemptId: current.expected.attemptId,
      result,
    }) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(options.stdoutPath, 'diagnostic output only\n', {
    mode: 0o600,
    flag: 'wx',
  });
}

function completedExecution(root: string, exitCode = 0, signal: NodeJS.Signals | null = null) {
  return {
    phase: 'step' as const,
    execution:
      exitCode === 0 && signal === null ? ('completed' as const) : ('child-failed' as const),
    cleanup: 'cleaned' as const,
    childExitCode: exitCode,
    childSignal: signal,
    pid: 123,
    pgid: 123,
    logPath: path.join(root, 'native-pilot.private.log'),
    stdoutPath: path.join(root, 'runner.stdout.private.log'),
    ownershipPath: path.join(root, 'native-pilot.ownership.json'),
    elapsedMs: 1,
    cleanupMs: 1,
  };
}

async function privateRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 't15-cold-v6-')));
  await chmod(root, 0o700);
  return root;
}

void test('builds an exact native invocation with the reset binding and 24-hex identity', () => {
  const current = input();
  const invocation = buildNativePilotInvocation({
    repositoryRoot: '/repo',
    selection: current.selection,
    expected: current.expected,
    reset: current.reset,
    outputParent: '/private/tmp/t15-runner',
  });
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.cwd, '/repo');
  assert.equal(invocation.argv[0], '/repo/scripts/testing/run-native-pilot.mjs');
  assert.ok(invocation.argv.some((value) => value === `--run-id=${RUN_ID}`));
  assert.ok(invocation.argv.some((value) => value === `--attempt-id=${RUN_ID}:first`));
  assert.ok(invocation.argv.some((value) => value.startsWith('--cold-reset-binding=')));
  assert.throws(
    () =>
      buildNativePilotInvocation({
        repositoryRoot: '/repo',
        selection: current.selection,
        expected: expected('run-training-ios-detox-1'),
        reset: validReset(expected('run-training-ios-detox-1')),
        outputParent: '/private/tmp/t15-runner',
      }),
    /identity remapping is permitted/,
  );
});

void test('persists logical T15 attempts while mapping every child to a native 24-hex identity', () => {
  const spec = identityMapSpec();
  const document = buildT15IdentityMap(spec);
  assert.equal(document.entries.length, 4);
  assert.equal(new Set(document.entries.map((entry) => entry.nativeRunId)).size, 4);
  assert.ok(document.entries.every((entry) => /^[a-f0-9]{24}$/u.test(entry.nativeRunId)));
  assert.ok(
    document.entries.every((entry) => entry.nativeAttemptId === `${entry.nativeRunId}:first`),
  );
  assert.ok(document.entries.some((entry) => entry.logicalRunId === 'run-training-ios-maestro-1'));
  const mapped = mapT15SpecToNative(spec, document);
  const mappedAttempts = mapped.cells.flatMap((cell) => cell.expectedAttempts);
  assert.deepEqual(
    mappedAttempts.map((attempt) => attempt.attemptId),
    document.entries.map((entry) => entry.nativeAttemptId),
  );
  assert.ok(mappedAttempts.every((attempt) => /^[a-f0-9]{24}$/u.test(attempt.runId)));
  assert.ok(
    mapped.executionOrder.every((pair) =>
      pair.trials.every(
        (trial) =>
          /^[a-f0-9]{24}:first$/u.test(trial.firstAttemptId) &&
          /^[a-f0-9]{24}:first$/u.test(trial.secondAttemptId),
      ),
    ),
  );
});

void test('persists and reuses the exact identity map, then rejects a tampered map', async () => {
  const root = await privateRoot();
  try {
    const spec = identityMapSpec();
    const first = await ensureT15IdentityMap(root, spec);
    const mapPath = first.path;
    const before = await readFile(mapPath);
    const stat = await lstat(mapPath);
    assert.equal(stat.nlink, 1);
    assert.equal(stat.mode & 0o777, 0o600);
    const second = await ensureT15IdentityMap(root, spec);
    assert.deepEqual(second.document, first.document);
    assert.deepEqual(await readFile(mapPath), before);
    await rm(mapPath);
    await writeFile(
      mapPath,
      JSON.stringify({ ...first.document, mappingHash: 'b'.repeat(64) }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await assert.rejects(
      () => ensureT15IdentityMap(root, spec),
      /does not match the reviewed spec/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('runs the actual runner seam and accepts only protected terminal/runtime ownership evidence', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const producer = createT15PublicAttemptProducer({
      repositoryRoot: '/repo',
      outputRoot: root,
      execute: async (options) => {
        await writeMockTerminal(options, current, 'passed');
        return completedExecution(options.artifactRoot);
      },
    });
    const result = await producer(current);
    assert.equal(result.status, 'received');
    assert.equal(result.issue, null);
    assert.equal(result.runtime.captureRunId, 'capture-123');
    assert.equal(result.coldAttemptIdentity.processPid, 123);
    assert.ok(result.evidencePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('late abort after child close is retained as cancelled and never promoted', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const controller = new AbortController();
    let executed = false;
    const producer = createT15PublicAttemptProducer({
      repositoryRoot: '/repo',
      outputRoot: root,
      execute: async (options) => {
        await writeMockTerminal(options, current, 'passed');
        controller.abort('late abort');
        executed = true;
        return completedExecution(options.artifactRoot);
      },
    });
    current.signal = controller.signal;
    const result = await producer(current);
    assert.equal(executed, true);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.issue, 'cancelled-during-runner');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('foreign runtime identity remains blocked even when its receipt says passed', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const producer = createT15PublicAttemptProducer({
      repositoryRoot: '/repo',
      outputRoot: root,
      execute: async (options) => {
        await writeMockTerminal(
          options,
          current,
          'passed',
          FOREIGN_RUN_ID,
          current.expected.attemptId,
        );
        return completedExecution(options.artifactRoot);
      },
    });
    const result = await producer(current);
    assert.equal(result.status, 'harness-blocked');
    assert.equal(result.issue, 'runner-receipt-unbound');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('a nonzero or signaled child cannot promote a passed terminal receipt', async () => {
  for (const [exitCode, signal] of [
    [1, null],
    [null, 'SIGTERM'],
  ] as const) {
    const root = await privateRoot();
    try {
      const current = input();
      const producer = createT15PublicAttemptProducer({
        repositoryRoot: '/repo',
        outputRoot: root,
        execute: async (options) => {
          await writeMockTerminal(options, current, 'passed');
          return completedExecution(options.artifactRoot, exitCode ?? 0, signal);
        },
      });
      const result = await producer(current);
      assert.equal(result.status, 'harness-blocked');
      assert.equal(result.issue, 'runner-failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

void test('application failure is accepted only with the native failure exit and clean ownership', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const producer = createT15PublicAttemptProducer({
      repositoryRoot: '/repo',
      outputRoot: root,
      execute: async (options) => {
        await writeMockTerminal(options, current, 'application-failed');
        return completedExecution(options.artifactRoot, 1);
      },
    });
    const accepted = await producer(current);
    assert.equal(accepted.status, 'application-failed');
    assert.equal(accepted.issue, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const blockedRoot = await privateRoot();
  try {
    const current = input();
    const producer = createT15PublicAttemptProducer({
      repositoryRoot: '/repo',
      outputRoot: blockedRoot,
      execute: async (options) => {
        await writeMockTerminal(options, current, 'application-failed');
        return completedExecution(options.artifactRoot, 2);
      },
    });
    const blocked = await producer(current);
    assert.equal(blocked.status, 'harness-blocked');
    assert.equal(blocked.issue, 'runner-failed');
  } finally {
    await rm(blockedRoot, { recursive: true, force: true });
  }
});

void test('pre-abort prevents child acquisition and a deadline outcome cannot promote a receipt', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const controller = new AbortController();
    controller.abort('pre-aborted');
    current.signal = controller.signal;
    let executions = 0;
    const producer = createT15PublicAttemptProducer({
      repositoryRoot: '/repo',
      outputRoot: root,
      execute: () => {
        executions += 1;
        return Promise.reject(new Error('must not acquire'));
      },
    });
    const before = await producer(current);
    assert.equal(before.status, 'cancelled');
    assert.equal(before.issue, 'cancelled-before-acquisition');
    assert.equal(executions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const deadlineRoot = await privateRoot();
  try {
    const current = input();
    const producer = createT15PublicAttemptProducer({
      repositoryRoot: '/repo',
      outputRoot: deadlineRoot,
      execute: async (options) => {
        await writeMockTerminal(options, current, 'passed');
        return {
          ...completedExecution(options.artifactRoot),
          execution: 'deadline' as const,
          childExitCode: null,
        };
      },
    });
    const deadline = await producer(current);
    assert.equal(deadline.status, 'harness-blocked');
    assert.equal(deadline.issue, 'runner-failed');
  } finally {
    await rm(deadlineRoot, { recursive: true, force: true });
  }
});

void test('a missing or foreign protected receipt is never discovered from stdout', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const producer = createT15PublicAttemptProducer({
      repositoryRoot: '/repo',
      outputRoot: root,
      execute: async (options) => {
        await mkdir(path.join(root, 'diagnostic-only'), { mode: 0o700 });
        await writeFile(options.stdoutPath, 'receipt: /foreign/receipt.json\n', {
          mode: 0o600,
          flag: 'wx',
        });
        return completedExecution(options.artifactRoot);
      },
    });
    const result = await producer(current);
    assert.equal(result.status, 'harness-blocked');
    assert.equal(result.issue, 'runner-receipt-unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('reset production remains blocked when no owned reset driver is wired', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const driver = createT15ColdResetProducer({
      repositoryRoot: '/repo',
      outputRoot: root,
    });
    const row = await driver({
      spec: current.spec,
      expected: current.expected,
      selection: selection(),
      signal: current.signal,
      reusableBuild: current.reusableBuild,
      outputRoot: root,
    });
    assert.equal(row.status, 'blocked');
    assert.equal(row.blocker, 'cold-reset-driver-unwired');
    assert.equal(row.originalResetBinding.status, 'pending');
    assert.equal(row.cleanupStatus, 'not-acquired');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('manifest reset producer returns only a same-attempt verified reset', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const manifestPath = path.join(root, 'reset-manifest.private.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'private t15 reset manifest',
        attempts: {
          [current.expected.attemptId]: validReset(current.expected),
        },
      }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    const driver = createT15ColdResetProducer({
      repositoryRoot: '/repo',
      outputRoot: root,
      manifestPath,
    });
    const row = await driver({
      spec: current.spec,
      expected: current.expected,
      selection: selection(),
      signal: current.signal,
      reusableBuild: current.reusableBuild,
      outputRoot: root,
    });
    assert.equal(row.status, 'fresh');
    assert.equal(row.ownerRunId, current.expected.runId);
    const foreign = await driver({
      spec: current.spec,
      expected: expected(FOREIGN_RUN_ID),
      selection: selection(),
      signal: current.signal,
      reusableBuild: current.reusableBuild,
      outputRoot: root,
    });
    assert.equal(foreign.status, 'blocked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('protected terminal reader rejects a receipt whose path is not the requested attempt', async () => {
  const root = await privateRoot();
  try {
    const current = input();
    const outputParent = path.join(root, 'runner-output');
    await mkdir(path.join(outputParent, current.expected.runId), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(
      path.join(outputParent, current.expected.runId, 'receipt.json'),
      JSON.stringify({
        runId: FOREIGN_RUN_ID,
        attemptId: `${FOREIGN_RUN_ID}:first`,
        result: 'passed',
      }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    const terminal = await readT15ProtectedTerminalReceipt({
      outputParent,
      expected: current.expected,
    });
    assert.equal(terminal.status, 'harness-blocked');
    assert.equal(terminal.issue, 'terminal-receipt-mismatch');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

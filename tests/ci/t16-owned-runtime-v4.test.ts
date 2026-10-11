import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { readNativeEvidenceObservation } from '../../scripts/testing/native-view-evidence';
import {
  createT16Chooser,
  createT16OperationScope,
  parseT16OwnedExplorationArguments,
  readOwnedMcpCommandObservation,
  runT16OwnedExploration,
  validateT16ColdResetBindingOnDisk,
  verifyOwnedMcpCommand,
} from '../../scripts/testing/run-t16-owned-exploration';
import type { NativePilotColdResetBinding } from '../../scripts/testing/native-pilot-invocation';
import type {
  PreparedExplorationCharter,
  ScreenObservation,
} from '../../scripts/testing/t16b-owned-exploration-controller';

const repositoryRoot = path.resolve(process.cwd());
const runId = 'a'.repeat(24);
const fingerprint = 'b'.repeat(64);

function validArguments(): string[] {
  return [
    `--charter=EXP-TWO-ROLE-CONSISTENCY`,
    '--locale=en-US',
    `--run-id=${runId}`,
    `--attempt-id=${runId}:first`,
    '--cold-reset-binding=encoded-binding',
    '--maestro-command=/usr/local/bin/maestro',
    '--maestro-arg',
    'mcp',
    '--maestro-arg=server',
  ];
}

void test('qa:explore parser requires the checked-in charter, first attempt, and MCP command', () => {
  const parsed = parseT16OwnedExplorationArguments(validArguments());
  assert.equal(parsed.charterId, 'EXP-TWO-ROLE-CONSISTENCY');
  assert.equal(parsed.attemptId, `${runId}:first`);
  assert.deepEqual(parsed.maestroArgs, ['mcp', 'server']);

  assert.throws(
    () =>
      parseT16OwnedExplorationArguments(
        validArguments().map((value) => (value === 'mcp' ? 'stdio' : value)),
      ),
    /MCP argv must include the mcp subcommand/,
  );
  assert.throws(
    () =>
      parseT16OwnedExplorationArguments(
        validArguments().map((value) =>
          value.startsWith('--attempt-id=') ? `--attempt-id=${runId}:second` : value,
        ),
      ),
    /attempt must be the first attempt/,
  );
});

void test('qa:explore chooser only returns a declared reversible assertion', async () => {
  const chooser = createT16Chooser();
  const charter = {
    id: 'EXP-TWO-ROLE-CONSISTENCY',
    allowedActions: ['Check the final relationship from the professional home'],
  } as PreparedExplorationCharter;
  const observation = {
    kind: 'screen',
    runId,
    attemptId: `${runId}:first`,
    targetId: 'owned-target',
    capturedAtMonotonicMs: 1,
    requestId: 'screen-1',
    sourcePath: 'screen.private.bin',
    rawBytes: Buffer.from('pro.home.screen', 'utf8'),
    source: {} as ScreenObservation['source'],
    stateSha256: fingerprint,
    identity: {},
  } satisfies ScreenObservation;
  const action = await chooser({
    observation,
    charter,
    history: [],
    signal: new AbortController().signal,
  });
  assert.deepEqual(action, {
    id: 'Check the final relationship from the professional home',
    command: 'assertVisible',
    selector: { id: 'pro.home.screen' },
  });
  const noMatch = await chooser({
    observation: { ...observation, rawBytes: Buffer.from('other-screen', 'utf8') },
    charter,
    history: [],
    signal: new AbortController().signal,
  });
  assert.equal(noMatch, null);
});

void test('cold-reset validation binds the original receipt bytes and rejects later mutation', async () => {
  const parent = path.join(repositoryRoot, '.qa', 'artifacts');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const artifactRoot = await mkdtemp(path.join(parent, 't16-v4-reset-'));
  await chmod(artifactRoot, 0o700);
  const target = { udid: 'owned-target', platform: 'ios' };
  const backend = { apiOrigin: 'http://127.0.0.1:49152', apiPid: 1234 };
  const receipt = {
    kind: 'private-t15-cold-reset-original-from-owned-ios-session',
    status: 'fresh',
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    ownerRunId: runId,
    fixtureResetId: 'fixture-reset',
    cohortFixtureFingerprint: fingerprint,
    appStateFingerprint: fingerprint,
    fixtureStateFingerprint: fingerprint,
    sourceFingerprint: fingerprint,
    helperFingerprint: fingerprint,
    cleanupStatus: 'cleaned',
    blocker: null,
    target,
    backend,
  };
  const receiptPath = path.join(artifactRoot, 'reset-original.private.json');
  const receiptBytes = Buffer.from(JSON.stringify(receipt), 'utf8');
  await writeFile(receiptPath, receiptBytes, { mode: 0o600, flag: 'wx' });
  const observed = readNativeEvidenceObservation(artifactRoot, 'reset-original.private.json', true);
  const binding: NativePilotColdResetBinding = {
    artifactRoot,
    receiptPath,
    receiptHash: createHash('sha256').update(observed.bytes).digest('hex'),
    fixtureResetId: 'fixture-reset',
    ownerRunId: runId,
    attemptId: `${runId}:first`,
    cohortFixtureFingerprint: fingerprint,
    appStateFingerprint: fingerprint,
    fixtureStateFingerprint: fingerprint,
    sourceFingerprint: fingerprint,
    helperFingerprint: fingerprint,
    cleanupStatus: 'cleaned',
    target,
    backend,
    sourceIdentity: observed.identity,
  };
  try {
    const prepared = await validateT16ColdResetBindingOnDisk(binding, repositoryRoot);
    assert.equal(prepared.expectation.fixtureResetId, 'fixture-reset');
    await writeFile(receiptPath, Buffer.from(JSON.stringify({ ...receipt, blocker: 'changed' })), {
      mode: 0o600,
    });
    await assert.rejects(
      validateT16ColdResetBindingOnDisk(binding, repositoryRoot),
      /hash differs|identity changed|blocker/,
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('qa:explore route fails before native acquisition for a foreign source root', async () => {
  await assert.rejects(
    import('../../scripts/testing/run-t16-owned-exploration').then(({ runT16OwnedExploration }) =>
      runT16OwnedExploration({
        repositoryRoot: '/tmp',
        args: parseT16OwnedExplorationArguments(validArguments()),
      }),
    ),
    /repository root is not canonical|not a directory|does not exist|ENOENT/,
  );
});

void test('qa:explore rejects an expired absolute owner deadline before preparation', async () => {
  await assert.rejects(
    runT16OwnedExploration({
      repositoryRoot,
      args: parseT16OwnedExplorationArguments(validArguments()),
      deadlineAtMonotonicMs: Number(process.hrtime.bigint() / 1_000_000n) - 1,
    }),
    /deadline reached before preparation/,
  );
});

void test('qa:explore package route points at the owned production entrypoint', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ) as {
    scripts?: Record<string, unknown>;
  };
  assert.equal(
    packageJson.scripts?.['qa:explore'],
    'tsx scripts/testing/run-t16-owned-exploration.ts',
  );
});

void test('MCP command verification rejects replacement and symlink substitution', async () => {
  const root = await realpath(await mkdtemp('/tmp/t16-mcp-command-'));
  const commandPath = path.join(root, 'maestro');
  const replacementPath = path.join(root, 'replacement');
  const linkPath = path.join(root, 'link');
  try {
    await writeFile(commandPath, '#!/bin/sh\n', { mode: 0o700, flag: 'wx' });
    await chmod(commandPath, 0o700);
    const original = await readOwnedMcpCommandObservation(commandPath);
    const command = {
      path: commandPath,
      argv: [commandPath, 'mcp'],
      commandSha256: createHash('sha256').update(original.bytes).digest('hex'),
      commandBytes: original.bytes.byteLength,
      sourceIdentity: original.identity,
    };
    await verifyOwnedMcpCommand(command);
    const preAborted = new AbortController();
    preAborted.abort(new Error('command read cancelled before preparation'));
    await assert.rejects(
      readOwnedMcpCommandObservation(commandPath, { signal: preAborted.signal }),
      /command read cancelled before preparation/,
    );
    await assert.rejects(
      readOwnedMcpCommandObservation(commandPath, {
        deadlineAtMonotonicMs: Number(process.hrtime.bigint() / 1_000_000n) - 1,
      }),
      /descriptor read deadline reached/,
    );
    await writeFile(replacementPath, '#!/bin/sh\necho replaced\n', { mode: 0o700, flag: 'wx' });
    await chmod(replacementPath, 0o700);
    await rename(replacementPath, commandPath);
    await assert.rejects(
      verifyOwnedMcpCommand(command),
      /size changed|hash changed|identity changed/,
    );
    await symlink(commandPath, linkPath);
    await assert.rejects(readOwnedMcpCommandObservation(linkPath), /regular non-symlink|canonical/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('T16 operation scope rejects pre-abort and late completion before publication', async () => {
  const aborted = new AbortController();
  aborted.abort(new Error('cancelled before preparation'));
  const preAbortedScope = createT16OperationScope(aborted.signal);
  try {
    assert.throws(() => preAbortedScope.check('preparation'), /cancelled before preparation/);
  } finally {
    preAbortedScope.dispose();
  }

  const scope = createT16OperationScope(
    undefined,
    Number(process.hrtime.bigint() / 1_000_000n) + 5,
  );
  let completed = false;
  try {
    await assert.rejects(
      scope.wait('late operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        completed = true;
        return 'late';
      }),
      /deadline reached/,
    );
    assert.equal(completed, true);
  } finally {
    scope.dispose();
  }
});

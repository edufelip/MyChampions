import { strict as assert } from 'node:assert';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { projectIosConnectionT16BTerminal } from '../../scripts/testing/run-ios-connection-attempt';
import {
  buildT16BParentOwnedInputBinding,
  readT16BOuterCleanupBinding,
  requirePassedOuterCleanupFacts,
  requireT16BParentOwnedInputBinding,
  type T16BOuterCleanupBinding,
  type T16BOuterCleanupFacts,
} from '../../scripts/testing/t16b-outer-cleanup-binding';
import type { NativeConnectionAttemptBinding } from '../../scripts/testing/native-connection-attempt-binding';

const runId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const backendRunId = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function cleanupReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'independent ios native inventory cleanup proof',
    result: 'passed',
    runId,
    captureResult: 'observed',
    captureCleanupClean: true,
    pidStartPairs: 1,
    survivors: [],
    unknownProcessQueries: [],
    missingForeignDevices: [],
    ownedDeviceAbsent: true,
    cacheAbsent: true,
    docker: { container: [], network: [], volume: [] },
    finishedAt: '2026-10-03T00:00:00.000Z',
    ...overrides,
  };
}

async function artifactRoot(): Promise<string> {
  const parent = path.join(process.cwd(), '.qa', 'artifacts');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(parent, 't16b-outer-binding-'));
  await chmod(root, 0o700);
  return root;
}

async function writeCleanup(root: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(root, 'external-cleanup.private.json'), JSON.stringify(value), {
    mode: 0o600,
  });
}

function selectionEvidence() {
  return Object.fromEntries(
    [
      'target',
      'build',
      'tool',
      'locale',
      'roles',
      'fixture',
      'reset',
      'authApi',
      'sql',
      'ownership',
    ].map((kind) => [
      kind,
      {
        path: `selection-${kind}.private.json`,
        sha256: 'c'.repeat(64),
        bytes: 32,
        kind,
      },
    ]),
  );
}

function connectionBinding(): NativeConnectionAttemptBinding {
  return {
    schemaVersion: 1,
    kind: 'private-native-connection-attempt-binding-not-public-receipt',
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    captureRunId: 'cccccccccccccccccccccccc',
    backendRunId,
    backendAttemptId: `${backendRunId}:first`,
    fixtureScope: 'native-entry-ios',
    scenarioId: 'SCN-connection-ios',
    selection: {
      arguments: {
        platform: 'ios',
        engine: 'maestro',
        scenario: 'SCN-connection-ios',
        mode: 'integration',
      },
      scenarioHash: 'd'.repeat(64),
      requirementHash: 'e'.repeat(64),
    },
    assertionIds: ['assertion-one'],
    assertionSemanticSha256: 'f'.repeat(64),
    assertionContractSha256: '1'.repeat(64),
    nativePassingCases: 0,
  };
}

void test('binds passed outer cleanup to the exact protected receipt and preserves facts', async () => {
  const root = await artifactRoot();
  try {
    await writeCleanup(root, cleanupReceipt());
    const binding = readT16BOuterCleanupBinding({
      artifactRoot: root,
      expectedCaptureRunId: runId,
    });
    assert.equal(binding.scope, 'outer-ios-native-session');
    assert.equal(binding.facts.result, 'passed');
    assert.equal(binding.facts.ownedDeviceAbsent, true);
    assert.equal(binding.facts.cacheAbsent, true);
    assert.equal(binding.source.path, 'external-cleanup.private.json');
    assert.equal(binding.source.sha256.length, 64);
    requirePassedOuterCleanupFacts(binding.facts);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('retains failed outer cleanup as failure with unknown facts, never false defaults', async () => {
  const root = await artifactRoot();
  try {
    await writeCleanup(
      root,
      cleanupReceipt({
        result: 'failed',
        captureCleanupClean: undefined,
        pidStartPairs: undefined,
        survivors: undefined,
        unknownProcessQueries: undefined,
        missingForeignDevices: undefined,
        ownedDeviceAbsent: undefined,
        cacheAbsent: undefined,
        docker: undefined,
      }),
    );
    const binding = readT16BOuterCleanupBinding({
      artifactRoot: root,
      expectedCaptureRunId: runId,
    });
    assert.equal(binding.facts.result, 'failed');
    assert.equal(binding.facts.ownedDeviceAbsent, null);
    assert.equal(binding.facts.cacheAbsent, null);
    assert.throws(
      () => requirePassedOuterCleanupFacts(binding.facts),
      /outer cleanup did not pass/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('rejects a passed receipt that omits independent outer census facts', async () => {
  const root = await artifactRoot();
  try {
    await writeCleanup(root, cleanupReceipt({ survivors: undefined }));
    assert.throws(
      () =>
        readT16BOuterCleanupBinding({
          artifactRoot: root,
          expectedCaptureRunId: runId,
        }),
      /retained owned survivors|outer cleanup/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('rejects a passed receipt with an incomplete backend resource projection', async () => {
  const root = await artifactRoot();
  try {
    await writeCleanup(root, cleanupReceipt({ docker: { container: [], network: [] } }));
    assert.throws(
      () =>
        readT16BOuterCleanupBinding({
          artifactRoot: root,
          expectedCaptureRunId: runId,
        }),
      /cleanup docker\.volume is missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('terminal projection rejects a forged passed outer binding before publication', () => {
  const forged = {
    result: 'passed',
    captureCleanupClean: true,
    pidStartPairs: 1,
    survivors: [],
    unknownProcessQueries: [],
    missingForeignDevices: [],
    ownedDeviceAbsent: true,
    cacheAbsent: true,
    docker: { container: [], network: [] },
    finishedAt: '2026-10-03T00:00:00.000Z',
  } as never;
  assert.throws(
    () =>
      projectIosConnectionT16BTerminal({
        artifactRoot: '/owned/.qa/artifacts/native-pilot/run',
        execution: { status: 'explored' },
        outerCleanup: { facts: forged } as never,
        parentOwnedInput: null,
        captureCleanup: 'cleaned',
        verificationResult: 'passed',
      }),
    /backend resources/,
  );
});

function validOuterBinding(artifactRoot: string): T16BOuterCleanupBinding {
  return {
    schemaVersion: 1 as const,
    kind: 'private-t16-b-outer-cleanup-binding-not-public-receipt' as const,
    scope: 'outer-ios-native-session' as const,
    captureRunId: runId,
    artifactRoot,
    source: {
      path: 'external-cleanup.private.json' as const,
      bytes: 64,
      sha256: 'a'.repeat(64),
      identity: {} as never,
    },
    facts: cleanupReceipt() as T16BOuterCleanupFacts,
  };
}

void test('keeps a clean MCP controller result blocked when outer cleanup is absent', () => {
  const artifactRoot = '/owned/.qa/artifacts/native-pilot/' + runId;
  const parentOwnedInput = buildT16BParentOwnedInputBinding({
    connectionBinding: { ...connectionBinding(), captureRunId: runId },
    selectionEvidence: selectionEvidence(),
  });
  const terminal = projectIosConnectionT16BTerminal({
    artifactRoot,
    execution: { status: 'explored', cleanup: { status: 'cleaned' } },
    outerCleanup: null,
    parentOwnedInput,
    captureCleanup: 'cleaned',
    verificationResult: 'passed',
  });
  assert.equal(terminal.status, 'blocked');
  assert(terminal.blockers.includes('outer-cleanup-evidence-unavailable'));
});

void test('keeps a shape-valid but unread parent binding blocked until protected reread', () => {
  const artifactRoot = '/owned/.qa/artifacts/native-pilot/' + runId;
  const parentOwnedInput = buildT16BParentOwnedInputBinding({
    connectionBinding: { ...connectionBinding(), captureRunId: runId },
    selectionEvidence: selectionEvidence(),
  });
  const terminal = projectIosConnectionT16BTerminal({
    artifactRoot,
    execution: { status: 'explored', cleanup: { status: 'cleaned' } },
    outerCleanup: validOuterBinding(artifactRoot),
    parentOwnedInput,
    captureCleanup: 'cleaned',
    verificationResult: 'passed',
  });
  assert.equal(terminal.status, 'blocked');
  assert(terminal.blockers.includes('parent-owned-input-binding-unavailable'));
});

void test('keeps a leaked MCP controller result blocked despite a passed-looking outer object', () => {
  const artifactRoot = '/owned/.qa/artifacts/native-pilot/' + runId;
  const parentOwnedInput = buildT16BParentOwnedInputBinding({
    connectionBinding: { ...connectionBinding(), captureRunId: runId },
    selectionEvidence: selectionEvidence(),
  });
  const terminal = projectIosConnectionT16BTerminal({
    artifactRoot,
    execution: {
      status: 'blocked',
      cleanup: { status: 'failed-recovery-retained', ownedProcessGroupAbsent: false },
    },
    outerCleanup: validOuterBinding(artifactRoot),
    parentOwnedInput,
    captureCleanup: 'cleaned',
    verificationResult: 'passed',
  });
  assert.equal(terminal.status, 'blocked');
  assert(terminal.blockers.includes('t16-execution-not-observed'));
});

void test('rejects a symlinked external cleanup receipt before parsing', async () => {
  const root = await artifactRoot();
  const foreign = await artifactRoot();
  try {
    await writeCleanup(foreign, cleanupReceipt());
    await symlink(
      path.join(foreign, 'external-cleanup.private.json'),
      path.join(root, 'external-cleanup.private.json'),
    );
    assert.throws(
      () =>
        readT16BOuterCleanupBinding({
          artifactRoot: root,
          expectedCaptureRunId: runId,
        }),
      /escaped|symlink|owned bounded immutable input/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(foreign, { recursive: true, force: true });
  }
});

void test('binds reset, target, build, backend and SQL evidence through one parent selection bundle', () => {
  const binding = buildT16BParentOwnedInputBinding({
    connectionBinding: connectionBinding(),
    selectionEvidence: selectionEvidence(),
  });
  assert.equal(binding.requestedAttemptId, `${runId}:first`);
  assert.equal(binding.backendAttemptId, `${backendRunId}:first`);
  assert.deepEqual(Object.keys(binding.selectionEvidence).sort(), [
    'authApi',
    'build',
    'fixture',
    'locale',
    'ownership',
    'reset',
    'roles',
    'sql',
    'target',
    'tool',
  ]);
  requireT16BParentOwnedInputBinding(binding);
});

void test('rejects parent selection when reset evidence or attempt identity is missing', () => {
  const missingReset = selectionEvidence() as Record<string, unknown>;
  delete missingReset.reset;
  assert.throws(
    () =>
      buildT16BParentOwnedInputBinding({
        connectionBinding: connectionBinding(),
        selectionEvidence: missingReset,
      }),
    /selectionEvidence\.reset/,
  );
  const forged = {
    ...connectionBinding(),
    requestedAttemptId: `${runId}:second`,
  };
  assert.throws(
    () =>
      buildT16BParentOwnedInputBinding({
        connectionBinding: forged,
        selectionEvidence: selectionEvidence(),
      }),
    /parent binding attempt differs/,
  );
});

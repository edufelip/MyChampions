import { strict as assert } from 'node:assert';
import fs, { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createT16BPrivateEvidenceWriter,
  executeOwnedExploration,
  requireBoundedAction,
  requirePreparedCharter,
  requireSelectionBundle,
  selectionBindingHash,
  sha256,
  type BoundedAction,
  type ConnectorActionResult,
  type ConnectorIdentity,
  type OriginalEvidence,
  type OwnedEvidenceSource,
  type PrivateEvidenceWriter,
  type PreparedExplorationCharter,
  type SelectionEvidenceBundle,
  type SelectionExpectation,
  type T16BConnector,
  type T16BSelectionReaders,
} from '../../scripts/testing/t16b-owned-exploration-controller';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureParent = path.join(repositoryRoot, '.qa', 'artifacts');
mkdirSync(fixtureParent, { recursive: true, mode: 0o700 });
const runtimeArtifactRoot = mkdtempSync(path.join(fixtureParent, 't16b-controller-tests-'));
after(() => rm(runtimeArtifactRoot, { recursive: true, force: true }));
const artifactRoot = path.relative(repositoryRoot, runtimeArtifactRoot);

const ids = {
  run: 'run-t16b-001',
  attempt: 'run-t16b-001:attempt-001',
  target: 'ios-sim-001',
  app: 'com.example.champions',
  api: 'http://127.0.0.1:4010',
  fixture: 'fixture-t16b-001',
  scope: 'scope-t16b-001',
  reset: 'reset-t16b-001',
  build: 'build-t16b-001',
  connector: 'maestro-t16b-001',
};

const binarySha256 = 'a'.repeat(64);
const roleIds = ['coach', 'student'];
let clock = 0;

function bytes(text: string): Uint8Array {
  return Buffer.from(text, 'utf8');
}

function writeSource(relativePath: string, value: Uint8Array): OwnedEvidenceSource {
  mkdirSync(runtimeArtifactRoot, { recursive: true, mode: 0o700 });
  chmodSync(runtimeArtifactRoot, 0o700);
  const file = path.join(runtimeArtifactRoot, relativePath);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(file), 0o700);
  writeFileSync(file, value, { mode: 0o600 });
  chmodSync(file, 0o600);
  return {
    artifactRoot: runtimeArtifactRoot,
    path: relativePath,
    sha256: sha256(value),
    bytes: value.byteLength,
    uid: process.getuid!(),
    mode: '0600',
    nlink: 1,
    regular: true,
    symlink: false,
  };
}

function expectation(): SelectionExpectation {
  return {
    requestedRunId: ids.run,
    requestedAttemptId: ids.attempt,
    platform: 'ios',
    locale: 'en-US',
    targetId: ids.target,
    selector: 'ios-sim-001',
    appIdOrOrigin: ids.app,
    apiOrigin: ids.api,
    buildId: ids.build,
    binarySha256,
    connector: { kind: 'maestro', id: ids.connector, name: 'maestro', version: '2.6.1' },
    roleIds,
    fixtureId: ids.fixture,
    fixtureMode: 'fixture',
    fixtureScope: ids.scope,
    resetId: ids.reset,
    artifactRoot,
  };
}

function evidence(
  kind: OriginalEvidence['kind'],
  identity: Record<string, unknown>,
  label = kind as string,
): OriginalEvidence {
  clock += 1;
  const value = bytes(label + '-original-bytes');
  const sourcePath = 'source/' + label + '.json';
  return {
    kind,
    runId: ids.run,
    attemptId: ids.attempt,
    platform: 'ios',
    locale: 'en-US',
    path: sourcePath,
    bytes: value,
    capturedAtMonotonicMs: clock,
    identity: {
      ...identity,
      runId: ids.run,
      attemptId: ids.attempt,
      capturedAtMonotonicMs: clock,
    },
    source: writeSource(sourcePath, value),
  };
}

function selectionEvidence(
  kind: OriginalEvidence['kind'],
  identity: Record<string, unknown>,
  ordinal: number,
  label = kind as string,
): OriginalEvidence {
  const result = evidence(kind, identity, label);
  result.identity.selectionProvenance = {
    selectionBindingSha256: selectionBindingHash(expectation()),
    selectionReceiptId: 'selection-receipt-t16b-001',
    observerPid: process.pid,
    observerUid: process.getuid!(),
    observerStartedAtMonotonicMs: 0,
    selectionOrdinal: ordinal,
  };
  return result;
}

function eventEvidence(
  kind: OriginalEvidence['kind'],
  identity: Record<string, unknown>,
  capturedAtMonotonicMs: number,
  label = kind as string,
): OriginalEvidence {
  const result = evidence(kind, identity, label);
  result.capturedAtMonotonicMs = capturedAtMonotonicMs;
  result.identity.capturedAtMonotonicMs = capturedAtMonotonicMs;
  return result;
}

function selectionBundle(): SelectionEvidenceBundle {
  return {
    target: selectionEvidence(
      'target',
      {
        targetId: ids.target,
        selector: 'ios-sim-001',
        appIdOrOrigin: ids.app,
        apiOrigin: ids.api,
        ownedTargetProcess: {
          pid: process.pid,
          startedAtMonotonicMs: 0,
          startSha256: 'b'.repeat(64),
        },
      },
      1,
    ),
    build: selectionEvidence('build', { buildId: ids.build, binarySha256 }, 2),
    tool: selectionEvidence(
      'tool',
      {
        connectorId: ids.connector,
        kind: 'maestro',
        name: 'maestro',
        version: '2.6.1',
        targetSelectionCapability: true,
        sessionId: 'session-t16b-001',
      },
      3,
    ),
    locale: selectionEvidence(
      'locale',
      {
        requestedLocale: 'en-US',
        effectiveLocale: 'en-US',
        observedLocale: 'en-US',
      },
      4,
    ),
    roles: selectionEvidence(
      'roles',
      {
        roleIds,
        sessionIds: ['coach-session', 'student-session'],
        independentSessions: true,
      },
      5,
    ),
    fixture: selectionEvidence(
      'fixture',
      { fixtureId: ids.fixture, mode: 'fixture', scope: ids.scope },
      6,
    ),
    reset: selectionEvidence('reset', { resetId: ids.reset, fresh: true, verified: true }, 7),
    authApi: selectionEvidence(
      'auth-api',
      {
        apiOrigin: ids.api,
        scope: ids.scope,
        readOnly: true,
        independent: true,
        roleIds,
      },
      8,
    ),
    sql: selectionEvidence('sql', { scope: ids.scope, readOnly: true, independent: true }, 9),
    ownership: selectionEvidence(
      'ownership',
      {
        artifactRoot,
        current: true,
        foreignResourcesPreserved: true,
        ownerUid: process.getuid!(),
        ownedTargetProcess: {
          pid: process.pid,
          startedAtMonotonicMs: 0,
          startSha256: 'b'.repeat(64),
        },
      },
      10,
    ),
  };
}

function charter(): PreparedExplorationCharter {
  return requirePreparedCharter({
    schemaVersion: 1,
    id: 'EXP-T16B-OWNED',
    title: 'Owned exploration controller fixture',
    summary: 'Resource-free controller contract fixture.',
    platforms: ['ios', 'android', 'web'],
    connectorsByPlatform: { ios: 'maestro', android: 'maestro', web: 'playwright' },
    locales: ['en-US', 'pt-BR', 'es-ES'],
    roles: ['coach', 'student'],
    dataMode: 'fixture',
    fixture: { id: ids.fixture, resetStrategy: 'reset fixture before run' },
    allowedActions: ['qualify navigation', 'inspect dashboard'],
    excludedExternalEffects: ['no publish', 'no message send'],
    budget: {
      maxDurationMinutes: 30,
      maxUiActions: 100,
      stopWhen: 'first-limit-reached',
      unchangedFailureLimit: 2,
    },
    artifactPolicy: {
      directoryMode: '0700',
      fileMode: '0600',
      rawEvidence: 'private-only',
      publicSummary: 'redacted-status-only',
      forbiddenFields: ['credentials'],
    },
    requirementRefs: ['T16-B'],
    requirementPaths: ['docs/qa/agent-exploration-playbook-v1.md'],
    scenario: {
      id: 'SCN-t16b-owned',
      title: 'Bounded owned exploration',
      sourceRefs: ['docs/qa/agent-exploration-playbook-v1.md#t16-b'],
      preconditions: ['A reset fixture exists'],
      actions: ['Qualify navigation', 'Inspect dashboard'],
      expectedObservations: ['A bounded screen observation is retained'],
      risk: 'medium',
    },
  });
}

function action(id: string, command: 'tapOn' | 'assertVisible' = 'tapOn'): BoundedAction {
  return { id, command, selector: { id: 'dashboard-button' } };
}

function actionResult(
  ordinal: number,
  status: ConnectorActionResult['status'] = 'passed',
  appliedUiActionCount: ConnectorActionResult['appliedUiActionCount'] = 1,
): ConnectorActionResult {
  const request = bytes('request-' + ordinal);
  const result = bytes('result-' + ordinal);
  const capturedAtMonotonicMs = ++clock;
  const requestId = 'request-' + ordinal;
  return {
    kind: 'action-result',
    runId: ids.run,
    attemptId: ids.attempt,
    requestId,
    capturedAtMonotonicMs,
    status,
    requestedUiActionCount: 1,
    appliedUiActionCount,
    requestBytes: request,
    resultBytes: result,
    requestSource: writeSource('actions/' + ordinal + '-request.json', request),
    resultSource: writeSource('actions/' + ordinal + '-result.json', result),
    sourcePath: 'actions/' + ordinal + '.json',
    identity: {
      ordinal,
      targetId: ids.target,
      runId: ids.run,
      attemptId: ids.attempt,
      requestId,
      capturedAtMonotonicMs,
    },
  };
}

function connector(overrides: Partial<T16BConnector> = {}): T16BConnector {
  const identity: ConnectorIdentity = {
    kind: 'maestro',
    id: ids.connector,
    name: 'maestro',
    version: '2.6.1',
    targetSelectionCapability: true,
    sessionId: 'session-t16b-001',
  };
  const screen = (requestId: string): ReturnType<T16BConnector['observe']> =>
    Promise.resolve(
      (() => {
        const rawBytes = bytes('screen-' + requestId);
        const sourcePath = 'screens/' + requestId + '.png';
        const capturedAtMonotonicMs = ++clock;
        return {
          kind: 'screen' as const,
          runId: ids.run,
          attemptId: ids.attempt,
          targetId: ids.target,
          capturedAtMonotonicMs,
          requestId,
          sourcePath,
          rawBytes,
          source: writeSource(sourcePath, rawBytes),
          stateSha256: sha256(rawBytes),
          identity: {
            screen: requestId,
            runId: ids.run,
            attemptId: ids.attempt,
            targetId: ids.target,
            requestId,
            capturedAtMonotonicMs,
          },
        };
      })(),
    );
  return {
    identity,
    start: () => {
      const capturedAtMonotonicMs = ++clock;
      return Promise.resolve({
        kind: 'connector-start' as const,
        runId: ids.run,
        attemptId: ids.attempt,
        capturedAtMonotonicMs,
        identity: {
          ...identity,
          runId: ids.run,
          attemptId: ids.attempt,
          capturedAtMonotonicMs,
        },
        source: eventEvidence(
          'tool',
          {
            connectorId: ids.connector,
            kind: 'maestro',
            name: 'maestro',
            version: '2.6.1',
            targetSelectionCapability: true,
            sessionId: identity.sessionId,
          },
          capturedAtMonotonicMs,
          'connector-start',
        ),
      });
    },
    selectTarget: () => {
      const capturedAtMonotonicMs = ++clock;
      return Promise.resolve({
        kind: 'target-selection' as const,
        runId: ids.run,
        attemptId: ids.attempt,
        targetId: ids.target,
        platform: 'ios' as const,
        appIdOrOrigin: ids.app,
        binarySha256,
        capturedAtMonotonicMs,
        source: eventEvidence(
          'target-selection',
          { targetId: ids.target },
          capturedAtMonotonicMs,
          'target-selection',
        ),
      });
    },
    observe: ({ targetId: _targetId }) => screen('observe-' + ++clock),
    perform: ({ ordinal }) => Promise.resolve(actionResult(ordinal)),
    close: () => {
      const capturedAtMonotonicMs = ++clock;
      return Promise.resolve({
        kind: 'connector-shutdown' as const,
        runId: ids.run,
        attemptId: ids.attempt,
        status: 'closed' as const,
        capturedAtMonotonicMs,
        source: eventEvidence('cleanup', { status: 'closed' }, capturedAtMonotonicMs, 'shutdown'),
      });
    },
    ...overrides,
  };
}

function readers(): T16BSelectionReaders {
  let bundle: SelectionEvidenceBundle | undefined;
  const ensureBundle = () => (bundle ??= selectionBundle());
  return {
    readTarget: () => Promise.resolve(ensureBundle().target),
    readBuild: () => Promise.resolve(ensureBundle().build),
    readTool: () => Promise.resolve(ensureBundle().tool),
    readLocale: () => Promise.resolve(ensureBundle().locale),
    readRoles: () => Promise.resolve(ensureBundle().roles),
    readFixture: () => Promise.resolve(ensureBundle().fixture),
    readReset: () => Promise.resolve(ensureBundle().reset),
    readAuthApi: () => Promise.resolve(ensureBundle().authApi),
    readSql: () => Promise.resolve(ensureBundle().sql),
    readOwnership: () => Promise.resolve(ensureBundle().ownership),
    readPostActionEvidence: ({ ordinal, requestId }) =>
      Promise.resolve({
        api: evidence('action-api', { actionOrdinal: ordinal, requestId }, ordinal + '-api'),
        sql: evidence('action-sql', { actionOrdinal: ordinal, requestId }, ordinal + '-sql'),
      }),
  };
}

async function writer(attempt = ids.attempt) {
  mkdirSync(runtimeArtifactRoot, { recursive: true, mode: 0o700 });
  chmodSync(runtimeArtifactRoot, 0o700);
  return createT16BPrivateEvidenceWriter({
    repositoryRoot,
    artifactRoot,
    requestedAttemptId: attempt,
  });
}

function cleanupAudit(status: 'cleaned' | 'failed-recovery-retained' = 'cleaned') {
  return {
    audit: ({ connectorStartAttempted }: { connectorStartAttempted: boolean }) => {
      const effectiveStatus: 'cleaned' | 'failed-recovery-retained' | 'not-acquired' =
        !connectorStartAttempted && status === 'cleaned' ? 'not-acquired' : status;
      const capturedAtMonotonicMs = ++clock;
      return Promise.resolve({
        kind: 'owned-exploration-cleanup' as const,
        scope: 't16-owned-mcp-namespace-only' as const,
        runId: ids.run,
        attemptId: ids.attempt,
        status: effectiveStatus,
        capturedAtMonotonicMs,
        ownedProcessGroupAbsent: effectiveStatus === 'cleaned',
        socketResourcesAbsent: effectiveStatus === 'cleaned',
        outerCleanupStatus: 'unproven' as const,
        backendResourcesAbsent: false,
        foreignResourcesPreserved: false,
        source: eventEvidence(
          'cleanup',
          { status: effectiveStatus },
          capturedAtMonotonicMs,
          'cleanup',
        ),
        ...(effectiveStatus === 'failed-recovery-retained'
          ? {
              recoverySource: evidence('cleanup', { status: 'recovery' }, 'cleanup-recovery'),
            }
          : {}),
      });
    },
  };
}

let executionNumber = 0;

async function execute(overrides: Partial<Parameters<typeof executeOwnedExploration>[0]> = {}) {
  const w = overrides.writer || (await writer(ids.attempt + '-' + ++executionNumber));
  const result = await executeOwnedExploration({
    repositoryRoot,
    charter: charter(),
    expectation: expectation(),
    selection: readers(),
    connector: connector(),
    chooser: () => Promise.resolve(null),
    qualificationAction: action('qualify navigation'),
    writer: w,
    cleanup: cleanupAudit(),
    now: () => ++clock,
    maxDurationMs: 60_000,
    cleanupTimeoutMs: 100,
    ...overrides,
  });
  return { result, root: w.executionRoot, writer: w };
}

void test('accepts free-text charter actions while retaining every required locale', () => {
  const value = charter();
  assert.deepEqual(value.allowedActions, ['qualify navigation', 'inspect dashboard']);
  assert.deepEqual(value.locales, ['en-US', 'pt-BR', 'es-ES']);
});

void test('rejects a static or connector-mismatched action', () => {
  assert.throws(() =>
    requireBoundedAction(
      { id: 'qualify navigation', command: 'runFlow', actions: [] },
      'maestro',
      charter().allowedActions,
    ),
  );
  assert.throws(() =>
    requireBoundedAction(
      { id: 'qualify navigation', command: 'click', selector: { id: 'dashboard-button' } },
      'maestro',
      charter().allowedActions,
    ),
  );
  assert.throws(() =>
    requireBoundedAction(
      {
        id: 'inspect dashboard',
        command: 'inputText',
        text: 'password=secret',
      },
      'maestro',
      charter().allowedActions,
    ),
  );
  assert.deepEqual(
    requireBoundedAction(
      { id: 'inspect dashboard', command: 'inputText', textRef: 'fixture.email' },
      'maestro',
      charter().allowedActions,
    ).textRef,
    'fixture.email',
  );
});

void test('rejects selection evidence whose role sessions are not independent', () => {
  const bundle = selectionBundle();
  bundle.roles.identity.sessionIds = ['same-session', 'same-session'];
  assert.throws(
    () => requireSelectionBundle(bundle, expectation(), runtimeArtifactRoot),
    /independently authenticated/,
  );
});

void test('rejects selection evidence with a forged shared binding or target process', () => {
  const forgedBinding = selectionBundle();
  forgedBinding.build.identity.selectionProvenance = {
    ...(forgedBinding.build.identity.selectionProvenance as Record<string, unknown>),
    selectionBindingSha256: 'c'.repeat(64),
  };
  assert.throws(
    () => requireSelectionBundle(forgedBinding, expectation(), runtimeArtifactRoot),
    /selectionProvenance binding differs|not shared/,
  );
  const forgedProcess = selectionBundle();
  forgedProcess.ownership.identity.ownedTargetProcess = {
    pid: process.pid + 1,
    startedAtMonotonicMs: 0,
    startSha256: 'b'.repeat(64),
  };
  assert.throws(
    () => requireSelectionBundle(forgedProcess, expectation(), runtimeArtifactRoot),
    /process identities differ/,
  );
});

void test('runs a source-only explored attempt with private ledger and pending qualification', async () => {
  const { result, root } = await execute();
  assert.equal(result.status, 'explored');
  assert.equal(result.explorationStatus, 'observed');
  assert.equal(result.cleanup?.status, 'cleaned');
  assert.equal(result.cleanup?.outerCleanupStatus, 'unproven');
  assert.equal(result.cleanup?.backendResourcesAbsent, false);
  assert.equal(result.cleanup?.foreignResourcesPreserved, false);
  assert.equal(result.qualification, 'pending');
  assert.equal(result.runtimePassingCases, 0);
  assert.equal(result.actionAttempts.length, 1);
  assert.deepEqual(
    result.actionAttempts.map((row) => row.result.status),
    ['passed'],
  );
  const ledger = await readFile(path.join(root, 'action-attempt-ledger.private.jsonl'), 'utf8');
  assert.equal(ledger.trim().split('\n').length, 1);
  assert(result.finalEvidence);
  const receipt = await readFile(
    path.join(runtimeArtifactRoot, result.finalEvidence.receipt.path),
    'utf8',
  );
  assert.doesNotMatch(receipt, /rawBytes|requestBytes|resultBytes|original-bytes/);
  assert.match(receipt, /"publicationEligible": false/);
  await readFile(path.join(runtimeArtifactRoot, result.finalEvidence.marker.path), 'utf8');
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('does not call the chooser when qualification fails or applies zero actions', async () => {
  let chooserCalls = 0;
  const failedQualification = connector({
    perform: ({ ordinal }) => Promise.resolve(actionResult(ordinal, 'failed', 0)),
  });
  const { result } = await execute({
    connector: failedQualification,
    chooser: () => {
      chooserCalls += 1;
      return Promise.resolve(action('inspect dashboard'));
    },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.explorationStatus, 'not-run');
  assert.equal(chooserCalls, 0);
  assert.deepEqual(
    result.actionAttempts.map((row) => row.result.status),
    ['failed'],
  );
  assert.equal(result.actionAttempts[0]?.result.appliedUiActionCount, 0);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('continues a failed action within the budget and records the attempt', async () => {
  let chooserCalls = 0;
  const failed = connector({
    perform: ({ ordinal }) =>
      Promise.resolve(ordinal === 1 ? actionResult(ordinal) : actionResult(ordinal, 'failed', 0)),
  });
  const { result } = await execute({
    connector: failed,
    chooser: () => {
      chooserCalls += 1;
      return Promise.resolve(chooserCalls === 1 ? action('inspect dashboard') : null);
    },
  });
  assert.equal(result.status, 'explored');
  assert.equal(chooserCalls, 2);
  assert.equal(result.actionAttempts.length, 2);
  assert.equal(result.actionAttempts[1]?.result.status, 'failed');
  assert.equal(result.explorationStatus, 'observed');
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('continues until the second unchanged failure and records both attempts', async () => {
  const fixedObserve: T16BConnector['observe'] = () => {
    const rawBytes = bytes('fixed-screen');
    const sourcePath = 'screens/fixed.png';
    const capturedAtMonotonicMs = ++clock;
    const requestId = 'fixed-' + clock;
    return Promise.resolve({
      kind: 'screen',
      runId: ids.run,
      attemptId: ids.attempt,
      targetId: ids.target,
      capturedAtMonotonicMs,
      requestId,
      sourcePath,
      rawBytes,
      source: writeSource(sourcePath, rawBytes),
      stateSha256: sha256(rawBytes),
      identity: {
        screen: 'fixed',
        runId: ids.run,
        attemptId: ids.attempt,
        targetId: ids.target,
        requestId,
        capturedAtMonotonicMs,
      },
    });
  };
  const failed = connector({
    observe: fixedObserve,
    perform: ({ ordinal }) =>
      Promise.resolve(ordinal === 1 ? actionResult(ordinal) : actionResult(ordinal, 'failed', 0)),
  });
  const { result } = await execute({
    connector: failed,
    chooser: () => Promise.resolve(action('qualify navigation', 'tapOn')),
  });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason || '', /unchanged-failure-limit/);
  assert.deepEqual(
    result.actionAttempts.map((row) => row.result.status),
    ['passed', 'failed', 'failed'],
  );
  assert.equal(result.attemptCounts.applicationFailed, 2);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('retains the before-screen evidence when an action is cancelled', async () => {
  const cancelled = connector({
    perform: ({ ordinal }) => Promise.resolve(actionResult(ordinal, 'cancelled', null)),
  });
  const { result } = await execute({ connector: cancelled });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.actionAttempts[0]?.evidence.before?.kind, 'screen');
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('rejects source mutation before publication and keeps qualification pending', async () => {
  const base = readers();
  const mutated = {
    ...base,
    readBuild: async () => {
      const build = await base.readBuild(new AbortController().signal);
      writeFileSync(path.join(runtimeArtifactRoot, build.source.path), bytes('tampered'), {
        mode: 0o600,
      });
      chmodSync(path.join(runtimeArtifactRoot, build.source.path), 0o600);
      return build;
    },
  } satisfies T16BSelectionReaders;
  const { result } = await execute({ selection: mutated });
  assert.equal(result.status, 'blocked');
  assert.equal(result.publicationEligible, false);
  assert.match(result.reason || '', /source hash|source changed|source bytes|ownership|size/i);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('retains recovery-not-verified when owned cleanup never settles', async () => {
  const { result } = await execute({
    cleanup: { audit: () => new Promise<never>(() => undefined) },
    cleanupTimeoutMs: 20,
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.recoveryNotVerified, true);
  assert.equal(result.publicationEligible, false);
  assert(result.inFlightOperations > 0);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('fences a noncooperative evidence write before final publication', async () => {
  const baseWriter = await writer(ids.attempt + '-' + ++executionNumber);
  const stalledWriter: PrivateEvidenceWriter = {
    ...baseWriter,
    writeEvidence: () => new Promise<never>(() => undefined),
  };
  const { result } = await execute({ writer: stalledWriter, cleanupTimeoutMs: 20 });
  assert.equal(result.status, 'blocked');
  assert.equal(result.recoveryNotVerified, true);
  assert.equal(result.finalEvidence, null);
  assert(result.inFlightOperations > 0);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('retains requested rows when the ledger append fails', async () => {
  const baseWriter = await writer(ids.attempt + '-' + ++executionNumber);
  const failingWriter: PrivateEvidenceWriter = {
    ...baseWriter,
    appendAttempt: () => Promise.reject(new Error('append refused by test writer')),
  };
  const { result, root } = await execute({ writer: failingWriter });
  assert.equal(result.status, 'blocked');
  assert.equal(result.recoveryNotVerified, true);
  assert.equal(result.actionAttempts.length, 1);
  assert.match(result.reason || '', /ledger/);
  await assert.rejects(
    readFile(path.join(root, 'publication', 'publication-complete.private.json')),
    /ENOENT/,
  );
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('accounts for a private writer close failure after publication', async () => {
  const baseWriter = await writer(ids.attempt + '-' + ++executionNumber);
  const failingWriter: PrivateEvidenceWriter = {
    ...baseWriter,
    close: () =>
      baseWriter.close().then(() => {
        throw new Error('close refused by test writer');
      }),
  };
  const { result } = await execute({ writer: failingWriter });
  assert.equal(result.status, 'blocked');
  assert.equal(result.recoveryNotVerified, true);
  assert.match(result.reason || '', /writer close/);
  assert.equal(result.publicationEligible, false);
  assert.equal(result.finalEvidence, null);
  await assert.rejects(
    readFile(
      path.join(
        runtimeArtifactRoot,
        'execution',
        ids.attempt + '-' + executionNumber,
        'publication',
        'publication-complete.private.json',
      ),
    ),
    /ENOENT/,
  );
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('rejects secret-like final text before writing the publication marker', async () => {
  const privateWriter = await writer(ids.attempt + '-' + ++executionNumber);
  await assert.rejects(
    privateWriter.finalize({
      receipt: { schema: 'test' },
      coverage: { schema: 'test' },
      exploration: 'password=must-not-be-persisted',
      bugs: 'none',
      docChanges: 'none',
    }),
    /secret-like value/,
  );
  await privateWriter.close();
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('latches settled cleanup failure and suppresses the completion marker', async () => {
  const { result, root } = await execute({ cleanup: cleanupAudit('failed-recovery-retained') });
  assert.equal(result.status, 'blocked');
  assert.equal(result.cleanup?.status, 'failed-recovery-retained');
  assert.equal(result.recoveryNotVerified, true);
  assert.equal(result.finalEvidence, null);
  assert.match(result.reason || '', /cleanup failed-recovery-retained/);
  await assert.rejects(
    readFile(path.join(root, 'publication', 'publication-complete.private.json')),
    /ENOENT/,
  );
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('latches an immediately rejected cleanup and suppresses the completion marker', async () => {
  const { result, root } = await execute({
    cleanup: { audit: () => Promise.reject(new Error('cleanup rejected immediately')) },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.cleanup, null);
  assert.equal(result.recoveryNotVerified, true);
  assert.equal(result.finalEvidence, null);
  assert.match(result.reason || '', /cleanup rejected immediately/);
  await assert.rejects(
    readFile(path.join(root, 'publication', 'publication-complete.private.json')),
    /ENOENT/,
  );
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('rejects cleanup flags that are truthy but not booleans', async () => {
  const malformedCleanup = cleanupAudit();
  const originalAudit = malformedCleanup.audit;
  malformedCleanup.audit = async (input) => {
    const audit = await originalAudit(input);
    return { ...audit, ownedProcessGroupAbsent: 'true' as unknown as boolean };
  };
  const { result, root } = await execute({ cleanup: malformedCleanup });
  assert.equal(result.status, 'blocked');
  assert.equal(result.recoveryNotVerified, true);
  assert.equal(result.finalEvidence, null);
  assert.match(result.reason || '', /must be boolean/);
  await assert.rejects(
    readFile(path.join(root, 'publication', 'publication-complete.private.json')),
    /ENOENT/,
  );
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('blocks a connector shutdown failure instead of publishing explored', async () => {
  const failedShutdown = connector({
    close: () =>
      Promise.resolve({
        kind: 'connector-shutdown',
        runId: ids.run,
        attemptId: ids.attempt,
        status: 'failed',
        capturedAtMonotonicMs: ++clock,
        errorCode: 'close-failed',
        source: evidence('cleanup', { status: 'failed' }, 'shutdown-failed'),
      }),
  });
  const { result } = await execute({ connector: failedShutdown });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason || '', /connector shutdown failed/);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('rejects a connector receipt from a different requested attempt', async () => {
  const base = connector();
  const foreign = connector({
    start: (signal) =>
      base.start(signal).then((started) => ({ ...started, attemptId: 'foreign-attempt' })),
  });
  const { result } = await execute({ connector: foreign });
  assert.equal(result.status, 'blocked');
  assert.equal(result.connector, null);
  assert.match(result.reason || '', /connector start run identity differs/);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('rejects an action result whose request identity is not envelope-bound', async () => {
  const mismatched = connector({
    perform: ({ ordinal }) => {
      const result = actionResult(ordinal);
      result.identity.requestId = 'foreign-request';
      return Promise.resolve(result);
    },
  });
  const { result } = await execute({ connector: mismatched });
  assert.equal(result.status, 'blocked');
  assert.match(result.actionAttempts[0]?.result.error || '', /requestId differs/);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('bounds a noncooperative cleanup audit and retains blocked status', async () => {
  const startedAt = Date.now();
  const { result } = await execute({
    cleanup: {
      audit: () => new Promise<never>(() => undefined),
    },
    cleanupTimeoutMs: 20,
  });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason || '', /independent cleanup audit timed out/);
  assert(Date.now() - startedAt < 500, 'cleanup timeout was not bounded');
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('latches a cleanup timeout after the late audit settles', async () => {
  let settled = false;
  const delayedCleanup = {
    audit: async ({ connectorStartAttempted }: { connectorStartAttempted: boolean }) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      settled = true;
      return cleanupAudit().audit({ connectorStartAttempted });
    },
  };
  const {
    result,
    root,
    writer: delayedWriter,
  } = await execute({
    cleanup: delayedCleanup,
    cleanupTimeoutMs: 20,
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.recoveryNotVerified, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(settled, true);
  await assert.rejects(
    readFile(path.join(root, 'publication', 'publication-complete.private.json')),
    /ENOENT/,
  );
  await delayedWriter.close();
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('rejects a cleanup source identity outside its event envelope', async () => {
  const malformedCleanup = cleanupAudit();
  const originalAudit = malformedCleanup.audit;
  malformedCleanup.audit = async (input) => {
    const audit = await originalAudit(input);
    return {
      ...audit,
      source: {
        ...audit.source,
        identity: { ...audit.source.identity, attemptId: 'foreign-cleanup-attempt' },
      },
    };
  };
  const { result } = await execute({ cleanup: malformedCleanup });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason || '', /cleanup source\.attemptId differs/);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('rejects a recovery source identity outside its cleanup envelope', async () => {
  const malformedCleanup = cleanupAudit('failed-recovery-retained');
  const originalAudit = malformedCleanup.audit;
  malformedCleanup.audit = async (input) => {
    const audit = await originalAudit(input);
    assert(audit.recoverySource);
    return {
      ...audit,
      recoverySource: {
        ...audit.recoverySource,
        identity: { ...audit.recoverySource.identity, runId: 'foreign-recovery-run' },
      },
    };
  };
  const { result } = await execute({ cleanup: malformedCleanup });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason || '', /cleanup recovery source\.runId differs/);
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('cancellation before acquisition remains cancelled and bounded', async () => {
  const signal = new AbortController();
  signal.abort(new Error('test cancellation'));
  let started = false;
  const {
    result,
    root,
    writer: cancelledWriter,
  } = await execute({
    signal: signal.signal,
    connector: connector({
      start: () => {
        started = true;
        return Promise.reject(new Error('must not start'));
      },
    }),
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(started, false);
  assert.equal(result.cleanup?.status, 'not-acquired');
  assert.equal(result.recoveryNotVerified, true);
  await assert.rejects(
    readFile(path.join(root, 'publication', 'publication-complete.private.json')),
    /ENOENT/,
  );
  await cancelledWriter.close();
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('fences delayed terminal publication at the execution deadline before marker commit', async () => {
  const baseWriter = await writer(ids.attempt + '-' + ++executionNumber);
  const delayedWriter: PrivateEvidenceWriter = {
    ...baseWriter,
    completePublication: async (signal) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (signal?.aborted)
        throw signal.reason instanceof Error ? signal.reason : new Error('deadline aborted');
      return baseWriter.completePublication(signal);
    },
  };
  const { result, root } = await execute({
    writer: delayedWriter,
    maxDurationMs: 250,
    cleanupTimeoutMs: 500,
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.recoveryNotVerified, true);
  assert.equal(result.finalEvidence, null);
  assert.equal(result.publicationEligible, false);
  await assert.rejects(
    readFile(path.join(root, 'publication', 'publication-complete.private.json')),
    /ENOENT/,
  );
  await delayedWriter.close();
  await rm(runtimeArtifactRoot, { recursive: true, force: true });
});

void test('fences delayed terminal publication after parent cancellation before marker commit', async () => {
  const baseWriter = await writer(ids.attempt + '-' + ++executionNumber);
  const parent = new AbortController();
  const delayedWriter: PrivateEvidenceWriter = {
    ...baseWriter,
    completePublication: async (signal) => {
      // The abort must happen after the controller has reached terminal
      // completion, otherwise scheduler contention can cancel acquisition and
      // legitimately produce the separate `cancelled` result.
      parent.abort(new Error('parent cancellation at publication entry'));
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (signal?.aborted)
        throw signal.reason instanceof Error ? signal.reason : new Error('parent aborted');
      return baseWriter.completePublication(signal);
    },
  };
  try {
    const { result, root } = await execute({
      writer: delayedWriter,
      signal: parent.signal,
      cleanupTimeoutMs: 500,
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.recoveryNotVerified, true);
    assert.equal(result.finalEvidence, null);
    assert.equal(result.publicationEligible, false);
    await assert.rejects(
      readFile(path.join(root, 'publication', 'publication-complete.private.json')),
      /ENOENT/,
    );
  } finally {
    await delayedWriter.close();
    await rm(runtimeArtifactRoot, { recursive: true, force: true });
  }
});

void test('makes an abort raised inside the synchronous terminal commit authoritative', async () => {
  const originalRenameSync = fs.renameSync;
  const parent = new AbortController();
  let commitEntered = false;
  fs.renameSync = (source, destination) => {
    commitEntered = true;
    parent.abort(new Error('abort raised during terminal commit'));
    return originalRenameSync(source, destination);
  };
  syncBuiltinESMExports();
  try {
    const { result, root } = await execute({
      signal: parent.signal,
      cleanupTimeoutMs: 500,
    });
    assert.equal(commitEntered, true);
    assert.equal(result.status, 'explored');
    assert.equal(result.publicationEligible, false);
    assert(result.finalEvidence);
    await readFile(path.join(root, 'publication', 'publication-complete.private.json'));
  } finally {
    fs.renameSync = originalRenameSync;
    syncBuiltinESMExports();
    await rm(runtimeArtifactRoot, { recursive: true, force: true });
  }
});

void test('retains blocked failure and removes the pending marker after terminal commit failure', async () => {
  const originalRenameSync = fs.renameSync;
  let commitAttempts = 0;
  fs.renameSync = () => {
    commitAttempts += 1;
    const error = new Error('synthetic terminal rename failure') as NodeJS.ErrnoException;
    error.code = 'EIO';
    throw error;
  };
  syncBuiltinESMExports();
  try {
    const { result, root } = await execute({ cleanupTimeoutMs: 500 });
    assert.equal(commitAttempts, 1);
    assert.equal(result.status, 'blocked');
    assert.equal(result.recoveryNotVerified, true);
    assert.equal(result.finalEvidence, null);
    assert.match(result.reason || '', /publication completion|EIO|terminal rename/i);
    await assert.rejects(
      readFile(path.join(root, 'publication', 'publication-complete.private.json')),
      /ENOENT/,
    );
    await assert.rejects(
      readFile(path.join(root, 'publication', 'publication-complete.private.json.pending')),
      /ENOENT/,
    );
  } finally {
    fs.renameSync = originalRenameSync;
    syncBuiltinESMExports();
    await rm(runtimeArtifactRoot, { recursive: true, force: true });
  }
});

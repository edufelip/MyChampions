import { strict as assert } from 'node:assert';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { loadExplorationCharters } from '../../scripts/testing/prepare-exploration';
import {
  deriveT16BOwnedTargetBinding,
  deriveT16BSelectionExpectation,
  runOwnedT16BFromFreshMaestroObservations,
  type T16BSelectionIdentityObservation,
  type T16BFreshSelectionObserver,
  type T16BOwnedRuntimeBootstrapInput,
} from '../../scripts/testing/t16b-owned-maestro-bootstrap';
import type {
  BoundedAction,
  T16BSelectionReaders,
} from '../../scripts/testing/t16b-owned-exploration-controller';

const repositoryRoot = path.resolve(process.cwd());

function identity(): T16BSelectionIdentityObservation {
  return {
    runId: 't16-bootstrap-run-001',
    attemptId: 't16-bootstrap-run-001:attempt-001',
    platform: 'android',
    locale: 'en-US',
    deviceId: 'owned-current-target-001',
    targetId: 'owned-current-target-001',
    selector: 'owned-current-target-001',
    appIdOrOrigin: 'com.edufelip.mychampions.dev',
    apiOrigin: 'http://127.0.0.1:4010',
    buildId: 'owned-current-build-001',
    binarySha256: 'a'.repeat(64),
    connector: {
      kind: 'maestro',
      id: 'maestro-owned-001',
      name: 'maestro',
      version: '2.6.1',
    },
    roleIds: ['professional', 'student'],
    fixtureId: 'owned-postgres-exploration-two-role-consistency',
    fixtureMode: 'integration',
    fixtureScope: 't16-bootstrap-scope-001',
    resetId: 't16-bootstrap-reset-001',
    artifactRoot: '.qa/artifacts/t16-bootstrap-run-001',
    observerPid: process.pid,
    observerUid: process.getuid!(),
    observerStartedAtMonotonicMs: 0,
    selectionReceiptId: 'selection-receipt-001',
  };
}

function unavailableEvidence(): T16BSelectionReaders {
  const unavailable = (): Promise<never> =>
    Promise.reject(new Error('selection evidence is not reached by this pre-acquisition control'));
  return {
    readTarget: unavailable,
    readBuild: unavailable,
    readTool: unavailable,
    readLocale: unavailable,
    readRoles: unavailable,
    readFixture: unavailable,
    readReset: unavailable,
    readAuthApi: unavailable,
    readSql: unavailable,
    readOwnership: unavailable,
    readPostActionEvidence: unavailable,
  };
}

function observer(readIdentity: T16BSelectionIdentityObservation): T16BFreshSelectionObserver {
  const evidence = unavailableEvidence();
  return {
    readSelectionIdentity: () => Promise.resolve(readIdentity),
    ...evidence,
  };
}

function action(): BoundedAction {
  return {
    id: 'observe-reversible-route',
    command: 'assertVisible',
    selector: { id: 'pro.home.screen' },
  };
}

async function bootstrapInput(
  currentObserver: T16BFreshSelectionObserver,
): Promise<T16BOwnedRuntimeBootstrapInput> {
  const root = await realpath(repositoryRoot);
  const charter = (await loadExplorationCharters(root)).find(
    (item) => item.id === 'EXP-TWO-ROLE-CONSISTENCY',
  );
  assert(charter, 'the declared two-role charter is missing');
  return {
    repositoryRoot: root,
    charter,
    observer: currentObserver,
    launch: {
      argv: ['/usr/bin/node', 'owned-maestro-mcp'],
      cwd: root,
      socketInspector: () => Promise.resolve([]),
    },
    chooser: () => Promise.resolve(null),
    qualificationAction: action(),
    cleanup: {
      audit: () =>
        Promise.reject(new Error('cleanup is not reached by this pre-acquisition control')),
    },
  };
}

void test('derives the expectation and target only from observed selection identity', () => {
  const expected = deriveT16BSelectionExpectation(identity());
  const target = deriveT16BOwnedTargetBinding(expected);
  assert.equal(expected.fixtureId, 'owned-postgres-exploration-two-role-consistency');
  assert.equal(expected.artifactRoot, '.qa/artifacts/t16-bootstrap-run-001');
  assert.deepEqual(target, {
    deviceId: expected.targetId,
    targetId: expected.targetId,
    platform: expected.platform,
    selector: expected.selector,
    appIdOrOrigin: expected.appIdOrOrigin,
    apiOrigin: expected.apiOrigin,
    buildId: expected.buildId,
    binarySha256: expected.binarySha256,
  });
});

void test('rejects forged identity metadata before constructing the owned session', async () => {
  let identityCalls = 0;
  const currentObserver = observer({
    ...identity(),
    fixtureScope: 'foreign-scope',
  });
  const original = currentObserver.readSelectionIdentity;
  const instrumented: T16BFreshSelectionObserver = {
    ...currentObserver,
    readSelectionIdentity: (signal) => {
      identityCalls += 1;
      signal.throwIfAborted();
      return original(signal);
    },
  };
  const input = await bootstrapInput(instrumented);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runOwnedT16BFromFreshMaestroObservations({
      ...input,
      signal: controller.signal,
    }),
  );
  assert.equal(identityCalls, 0);
});

void test('rejects malformed observed identity metadata without fabricating ten selection rows', () => {
  const malformed = { ...identity(), binarySha256: 'not-a-hash' };
  assert.throws(() => deriveT16BSelectionExpectation(malformed), /binarySha256 is invalid/);
});

void test('rejects a selected device that is not the current owned target', () => {
  assert.throws(
    () =>
      deriveT16BSelectionExpectation({
        ...identity(),
        deviceId: 'foreign-device-001',
      }),
    /selection device and target identities differ/,
  );
});

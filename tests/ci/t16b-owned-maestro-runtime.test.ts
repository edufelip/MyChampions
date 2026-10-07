import { strict as assert } from 'node:assert';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { loadExplorationCharters } from '../../scripts/testing/prepare-exploration';
import {
  requirePreparedCharter,
  type BoundedAction,
  type PreparedExplorationCharter,
  type SelectionExpectation,
  type T16BSelectionReaders,
} from '../../scripts/testing/t16b-owned-exploration-controller';
import {
  T16B_RUNTIME_MAX_DURATION_MS,
  T16B_RUNTIME_MAX_PROTOCOL_DEADLINE_MS,
  validateT16BOwnedRuntimeInput,
  type T16BOwnedMcpLaunch,
  type T16BOwnedRuntimeInput,
  type T16BOwnedTargetBinding,
} from '../../scripts/testing/t16b-owned-maestro-runtime';

const repositoryRoot = path.resolve(process.cwd());
const binarySha256 = 'a'.repeat(64);

function expectation(): SelectionExpectation {
  return {
    requestedRunId: 't16-runtime-seam-001',
    requestedAttemptId: 't16-runtime-seam-001:attempt-001',
    platform: 'android',
    locale: 'en-US',
    targetId: 'owned-current-target-001',
    selector: 'owned-current-target-001',
    appIdOrOrigin: 'com.edufelip.mychampions.dev',
    apiOrigin: 'http://127.0.0.1:4010',
    buildId: 'owned-current-build-001',
    binarySha256,
    connector: {
      kind: 'maestro',
      id: 'maestro-owned-001',
      name: 'maestro',
      version: '2.6.1',
    },
    roleIds: ['professional', 'student'],
    fixtureId: 'owned-postgres:exploration:two-role-consistency',
    fixtureMode: 'integration',
    fixtureScope: 't16-runtime-scope-001',
    resetId: 't16-runtime-reset-001',
    artifactRoot: '.qa/artifacts/t16-runtime-seam-001',
  };
}

function target(expected: SelectionExpectation): T16BOwnedTargetBinding {
  return {
    deviceId: expected.targetId,
    targetId: expected.targetId,
    platform: expected.platform,
    selector: expected.selector,
    appIdOrOrigin: expected.appIdOrOrigin,
    apiOrigin: expected.apiOrigin,
    buildId: expected.buildId,
    binarySha256: expected.binarySha256,
  };
}

function readers(): T16BSelectionReaders {
  const unavailable = (): Promise<never> =>
    Promise.reject(
      new Error('selection readers are not executed by this source-only preflight test'),
    );
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

function launch(root: string): T16BOwnedMcpLaunch {
  return {
    argv: ['/usr/bin/node', 'owned-maestro-mcp'],
    cwd: root,
    socketInspector: () => Promise.resolve([]),
  };
}

function cleanup(): T16BOwnedRuntimeInput['cleanup'] {
  return {
    audit: () => Promise.reject(new Error('cleanup is not reached by source-only preflight tests')),
  };
}

function qualificationAction(): BoundedAction {
  return {
    id: 'observe-reversible-route',
    command: 'assertVisible',
    selector: { id: 'pro.home.screen' },
  };
}

async function baseInput(): Promise<T16BOwnedRuntimeInput> {
  const root = await realpath(repositoryRoot);
  const declaredCharter = (await loadExplorationCharters(root)).find(
    (item) => item.id === 'EXP-TWO-ROLE-CONSISTENCY',
  );
  assert(declaredCharter, 'the declared two-role charter is missing');
  const charter: PreparedExplorationCharter = declaredCharter;
  const expected = expectation();
  return {
    repositoryRoot: root,
    charter: charter,
    expectation: expected,
    target: target(expected),
    selection: readers(),
    launch: launch(root),
    chooser: () => Promise.resolve(null),
    qualificationAction: qualificationAction(),
    cleanup: cleanup(),
  };
}

void test('accepts the complete source-only T16-B caller contract without acquiring resources', async () => {
  const input = await baseInput();
  const checked = await validateT16BOwnedRuntimeInput(input);
  assert.equal(checked.repositoryRoot, repositoryRoot);
  assert.equal(checked.cwd, repositoryRoot);
  assert.equal(checked.maxDurationMs, T16B_RUNTIME_MAX_DURATION_MS);
  assert.equal(checked.protocolDeadlineMs, T16B_RUNTIME_MAX_PROTOCOL_DEADLINE_MS);
});

void test('accepts checked-in charter policy labels at the metadata boundary', async () => {
  const root = await realpath(repositoryRoot);
  const declaredCharter = (await loadExplorationCharters(root)).find(
    (item) => item.id === 'EXP-TWO-ROLE-CONSISTENCY',
  );
  assert(declaredCharter, 'the declared two-role charter is missing');
  const prepared = requirePreparedCharter(declaredCharter);
  assert.deepEqual(prepared.artifactPolicy.forbiddenFields, [
    'password',
    'accessToken',
    'refreshToken',
    'cookie',
    'authorization',
    'secret',
  ]);
});

void test('rejects a secret value outside the declared metadata boundary', async () => {
  const root = await realpath(repositoryRoot);
  const declaredCharter = (await loadExplorationCharters(root)).find(
    (item) => item.id === 'EXP-TWO-ROLE-CONSISTENCY',
  );
  assert(declaredCharter, 'the declared two-role charter is missing');
  assert.throws(
    () =>
      requirePreparedCharter({
        ...declaredCharter,
        summary: 'password: leaked-value',
      }),
    /summary contains a secret-like value/,
  );
});

void test('rejects a missing post-action API/SQL reader before MCP or target acquisition', async () => {
  const input = await baseInput();
  let socketCalls = 0;
  const selection = {
    ...input.selection,
    readPostActionEvidence: undefined,
  } as unknown as T16BSelectionReaders;
  await assert.rejects(
    validateT16BOwnedRuntimeInput({
      ...input,
      selection,
      launch: {
        ...input.launch,
        socketInspector: () => {
          socketCalls += 1;
          return Promise.resolve([]);
        },
      },
    }),
    /selection reader is missing: readPostActionEvidence/,
  );
  assert.equal(socketCalls, 0);
});

void test('rejects a target/device binding that differs from the fresh selection expectation', async () => {
  const input = await baseInput();
  await assert.rejects(
    validateT16BOwnedRuntimeInput({
      ...input,
      target: { ...input.target, deviceId: 'historical-or-foreign-target' },
    }),
    /deviceId must be the selected target identity/,
  );
});

void test('rejects an already-cancelled caller before any owned session can start', async () => {
  const input = await baseInput();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(validateT16BOwnedRuntimeInput({ ...input, signal: controller.signal }));
});

void test('rejects a caller deadline outside the documented T16-B budget', async () => {
  const input = await baseInput();
  await assert.rejects(
    validateT16BOwnedRuntimeInput({
      ...input,
      maxDurationMs: T16B_RUNTIME_MAX_DURATION_MS + 1,
    }),
    /T16-B owner deadline is invalid/,
  );
  await assert.rejects(
    validateT16BOwnedRuntimeInput({
      ...input,
      protocolDeadlineMs: T16B_RUNTIME_MAX_PROTOCOL_DEADLINE_MS + 1,
    }),
    /MCP protocol deadline is invalid/,
  );
});

void test('rejects a non-Maestro charter before constructing the owned stdio session', async () => {
  const input = await baseInput();
  await assert.rejects(
    validateT16BOwnedRuntimeInput({
      ...input,
      expectation: {
        ...input.expectation,
        connector: { ...input.expectation.connector, kind: 'playwright' },
      },
    }),
    /Maestro T16-B caller requires a Maestro selection/,
  );
});

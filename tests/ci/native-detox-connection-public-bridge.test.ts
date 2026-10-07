import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { detoxSessionHelperClosure } from '../../scripts/testing/detox-integrated-session-baseline';
import {
  delegateIosDetoxConnectionAsSingleOwner,
  DETOX_IOS_CONNECTION_PUBLIC_OWNER,
  type DetoxIosConnectionPublicBridgeInput,
} from '../../scripts/testing/native-detox-connection-public-bridge';
import type { DetoxConnectionAttemptResult } from '../../scripts/testing/detox-integrated-connection-baseline';

const repositoryRoot = '/qualified/mychampions';
const serverRoot = '/qualified/mychampions-server';
const requestedRunId = '0123456789abcdef01234567';
const artifactRoot = path.join(
  repositoryRoot,
  '.qa/artifacts/native-pilot-attempts',
  requestedRunId,
);
function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const apiPid = 43123;
const proxyOrigin = 'http://127.0.0.1:8082';
const backendOrigin = 'http://127.0.0.1:8083';
const backendRunId = 'fedcba987654321001234567';
const childIdentity = { pid: 43124, pgid: 43124, started: 'child-start-token' } as const;
const transportSource = [
  {
    requestId: 1,
    method: 'GET',
    pathHash: '1'.repeat(64),
    requestProfile: 'native',
    targetOrigin: backendOrigin,
    status: 200,
    outcome: 'forwarded',
    requestOrigin: null,
    faultAttemptId: null,
    elapsedMs: 1,
  },
];
const transportSourceHash = hashJson(transportSource);
const transportSourceReceipt = {
  path: 'detox-connection-transport-source.private.json',
  sourceBytes: Buffer.byteLength(JSON.stringify(transportSource)),
  sourceSha256: transportSourceHash,
};

const build = {
  platform: 'ios',
  configuration: 'ios.sim.debug',
  binaryPath: path.join(
    repositoryRoot,
    'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app',
  ),
  binaryHash: 'a'.repeat(64),
  testBinaryPath: null,
  testBinaryHash: null,
  source: { sha: 'b'.repeat(40), dirty: false, sourceTreeHash: 'c'.repeat(64) },
  helperInputPaths: [...detoxSessionHelperClosure],
  helperInputsHash: 'd'.repeat(64),
  detoxConfigPath: path.join(repositoryRoot, '.detoxrc.js'),
  detoxConfigHash: 'e'.repeat(64),
  metroPort: 8081,
  appIdentifier: 'com.edufelip.mychampions.dev',
  embeddedRuntime: {
    variant: 'dev',
    appIdentifier: 'com.edufelip.mychampions.dev',
    apiOrigin: proxyOrigin,
    configSourcePath: path.join(repositoryRoot, 'app.config.ts'),
    configSourceHash: 'f'.repeat(64),
  },
} as const;

function selectionFromInventory(): DetoxIosConnectionPublicBridgeInput['selection'] {
  const inventory = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { scenarios: Record<string, unknown>[] };
  const scenario = structuredClone(
    inventory.scenarios.find((row) => row.id === 'SCN-connection-ios'),
  );
  assert(scenario, 'SCN-connection-ios fixture is missing');
  return {
    arguments: {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-connection-ios',
      mode: 'integration',
    },
    scenario: scenario as DetoxIosConnectionPublicBridgeInput['selection']['scenario'],
    scenarioHash: '1'.repeat(64),
    requirementHash: '2'.repeat(64),
  };
}

const selection = selectionFromInventory();

function resultFor(input: DetoxIosConnectionPublicBridgeInput): DetoxConnectionAttemptResult {
  return {
    kind: 'private-detox-connection-attempt-not-public-receipt',
    status: 'source-only',
    selectionValid: true,
    acquired: true,
    cleanup: 'cleaned',
    report: {
      output: artifactRoot,
      selection: input.selection,
      connectionApiIdentity: {
        targetOrigin: backendOrigin,
        apiPid,
      },
      backend: {
        apiOrigin: backendOrigin,
        apiPid,
        runId: backendRunId,
        manifestArtifactRoot: artifactRoot,
      },
      detoxChildIdentity: childIdentity,
      detoxProducerReceipt: {
        kind: 'private-detox-connection-producer-receipt',
        captureRunId: requestedRunId,
        platform: 'ios',
        childIdentity,
        sourceTreeHash: input.build.source.sourceTreeHash,
        helperInputsHash: input.build.helperInputsHash,
      },
      detoxTransportSource: transportSource,
      detoxTransportSourceHash: transportSourceHash,
      detoxTransportSourceReceipt: transportSourceReceipt,
    },
    ledger: [],
    failures: [],
    recoveryStatus: 'verified',
    deadlineAccounting: null,
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
}

function input(
  overrides: Partial<DetoxIosConnectionPublicBridgeInput> = {},
): DetoxIosConnectionPublicBridgeInput {
  return {
    owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
    repositoryRoot,
    serverRoot,
    artifactRoot,
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    selection,
    build,
    runnerPaths: {
      jestConfigPath: path.join(
        repositoryRoot,
        'e2e/jest.detox-integrated-connection-baseline.config.js',
      ),
      testPath: path.join(repositoryRoot, 'e2e/detox-integrated-connection-baseline.e2e.test.js'),
    },
    signal: new AbortController().signal,
    deadlineMs: 60_000,
    delegate: (options) => {
      assert.equal(options.repositoryRoot, repositoryRoot);
      assert.equal(options.serverRoot, serverRoot);
      assert.equal(options.artifactRoot, artifactRoot);
      assert.equal(options.configuration, 'ios.sim.debug');
      assert.equal(options.selection, selection);
      assert.equal(options.runnerPaths.testPath, input().runnerPaths.testPath);
      assert.equal('factories' in options, false);
      return Promise.resolve(resultFor(input()));
    },
    ...overrides,
  };
}

void test('Detox bridge delegates to one owner and preserves private result identity', async () => {
  const result = await delegateIosDetoxConnectionAsSingleOwner(input());
  assert.equal(result.owner, DETOX_IOS_CONNECTION_PUBLIC_OWNER);
  assert.equal(result.engine, 'detox');
  assert.equal(result.platform, 'ios');
  assert.equal(result.requestedAttemptId, `${requestedRunId}:first`);
  assert.equal(result.attempt.publicPromotionEligible, false);
  assert.equal(result.nativePassingCases, 0);
});

void test('Detox bridge rejects Maestro-shaped, wrong-platform and wrong-mode selections before delegation', async () => {
  let calls = 0;
  const delegate = () => {
    calls++;
    return Promise.resolve(resultFor(input()));
  };
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        selection: { ...selection, arguments: { ...selection.arguments, engine: 'maestro' } },
        delegate,
      }),
    ),
    /selection|engine/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        selection: {
          ...selection,
          arguments: { ...selection.arguments, platform: 'android' },
          scenario: { ...selection.scenario, id: 'SCN-connection-android', platform: 'android' },
        },
        delegate,
      }),
    ),
    /selection|platform/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        selection: { ...selection, arguments: { ...selection.arguments, mode: 'fixture' } },
        delegate,
      }),
    ),
    /selection|integration|contract/i,
  );
  assert.equal(calls, 0);
});

void test('Detox bridge rejects wrong owner, attempt identity, artifact root and build identity before delegation', async () => {
  const delegate = () => Promise.reject(new Error('delegate must not run'));
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(input({ owner: 'public-runner' as never, delegate })),
    /owner/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({ requestedAttemptId: `${requestedRunId}:retry`, delegate }),
    ),
    /first attempt/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        artifactRoot: path.join(repositoryRoot, '.qa/artifacts/other', requestedRunId),
        delegate,
      }),
    ),
    /artifact root/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        build: { ...build, helperInputsHash: '0'.repeat(63) },
        delegate,
      }),
    ),
    /hash|input/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () =>
          Promise.resolve(
            resultFor(
              input({
                build: { ...build, source: { ...build.source, sourceTreeHash: '9'.repeat(64) } },
              }),
            ),
          ),
      }),
    ),
    /source tree hash|qualified build/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () =>
          Promise.resolve(
            resultFor(input({ build: { ...build, helperInputsHash: '8'.repeat(64) } })),
          ),
      }),
    ),
    /helper hash|qualified build/i,
  );
});

void test('Detox bridge rejects collapsed proxy/backend origins and foreign API identity', async () => {
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () => {
          const result = resultFor(input());
          assert(result.report);
          return Promise.resolve({
            ...result,
            report: {
              ...result.report,
              connectionApiIdentity: { targetOrigin: proxyOrigin, apiPid },
              backend: {
                ...(result.report.backend as Record<string, unknown>),
                apiOrigin: proxyOrigin,
              },
            },
          });
        },
      }),
    ),
    /distinct|proxy|origin/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () => {
          const result = resultFor(input());
          assert(result.report);
          return Promise.resolve({
            ...result,
            report: {
              ...result.report,
              connectionApiIdentity: { targetOrigin: 'http://evil.example:8083', apiPid },
              backend: {
                ...(result.report.backend as Record<string, unknown>),
                apiOrigin: 'http://evil.example:8083',
              },
            },
          });
        },
      }),
    ),
    /loopback|origin/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () => {
          const result = resultFor(input());
          assert(result.report);
          return Promise.resolve({
            ...result,
            report: {
              ...result.report,
              connectionApiIdentity: { targetOrigin: 'http://127.0.0.1:9', apiPid },
            },
          });
        },
      }),
    ),
    /identity|origin/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () => {
          const result = resultFor(input());
          assert(result.report);
          return Promise.resolve({
            ...result,
            report: {
              ...result.report,
              connectionApiIdentity: { targetOrigin: backendOrigin, apiPid: apiPid + 1 },
            },
          });
        },
      }),
    ),
    /PID/i,
  );
});

void test('Detox bridge preserves acquired partial reports for blocked, cancelled and deadline outcomes', async () => {
  const partial = (status: 'blocked' | 'cancelled' | 'deadline') => ({
    ...resultFor(input()),
    status,
    acquired: true,
    cleanup: 'failed' as const,
    report: { output: artifactRoot, selection },
    failures: [{ phase: 'acquisition' as const, name: 'Error', message: `${status} before child` }],
    recoveryStatus: 'not-verified' as const,
  });
  for (const status of ['blocked', 'deadline'] as const) {
    const result = await delegateIosDetoxConnectionAsSingleOwner(
      input({ delegate: () => Promise.resolve(partial(status)) }),
    );
    assert.equal(result.attempt.status, status);
    assert.equal(result.attempt.acquired, true);
    assert.equal(result.attempt.report?.output, artifactRoot);
  }
  const controller = new AbortController();
  const cancelled = await delegateIosDetoxConnectionAsSingleOwner(
    input({
      signal: controller.signal,
      delegate: () => {
        controller.abort('SIGTERM');
        return Promise.resolve(partial('cancelled'));
      },
    }),
  );
  assert.equal(cancelled.attempt.status, 'cancelled');
  assert.equal(cancelled.attempt.report?.output, artifactRoot);
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () =>
          Promise.resolve({
            ...partial('blocked'),
            status: 'source-only',
            cleanup: 'cleaned',
            recoveryStatus: 'verified',
          }),
      }),
    ),
    /eligible|report|producer|identity/i,
  );
});

void test('Detox bridge rejects cancellation before delegation and a late non-cancelled result', async () => {
  const controller = new AbortController();
  controller.abort('SIGINT');
  let calls = 0;
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        signal: controller.signal,
        delegate: () => {
          calls++;
          return Promise.resolve(resultFor(input()));
        },
      }),
    ),
    /aborted|SIGINT|cancel/i,
  );
  assert.equal(calls, 0);

  const late = new AbortController();
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        signal: late.signal,
        delegate: () => {
          late.abort('SIGTERM');
          return Promise.resolve(resultFor(input()));
        },
      }),
    ),
    /cancel|deadline/i,
  );
});

void test('Detox bridge rejects cleanup, public-promotion and Maestro-result inconsistencies', async () => {
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () =>
          Promise.resolve({ ...resultFor(input()), cleanup: 'not-acquired' } as never),
      }),
    ),
    /not-acquired|cleanup/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () =>
          Promise.resolve({ ...resultFor(input()), publicPromotionEligible: true } as never),
      }),
    ),
    /promotion|false/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () =>
          Promise.resolve({
            ...resultFor(input()),
            kind: 'private-owned-ios-connection-attempt-not-public-receipt',
          } as never),
      }),
    ),
    /Detox|result|Maestro/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () => {
          const attempt = resultFor(input());
          assert(attempt.report);
          return Promise.resolve({
            ...attempt,
            report: {
              ...attempt.report,
              detoxProducerReceipt: {
                ...(attempt.report.detoxProducerReceipt as Record<string, unknown>),
                kind: 'unowned-receipt',
              },
            },
          } as never);
        },
      }),
    ),
    /producer receipt kind|owned/i,
  );
  await assert.rejects(
    delegateIosDetoxConnectionAsSingleOwner(
      input({
        delegate: () => Promise.resolve({ ...resultFor(input()), selectionValid: false }),
      }),
    ),
    /selection|valid/i,
  );
});

void test('Detox bridge accepts a blocked private attempt only when cleanup truth is consistent', async () => {
  const result = await delegateIosDetoxConnectionAsSingleOwner(
    input({
      delegate: () =>
        Promise.resolve({
          ...resultFor(input()),
          status: 'blocked',
          acquired: false,
          cleanup: 'not-acquired',
          report: null,
          recoveryStatus: 'not-applicable',
        }),
    }),
  );
  assert.equal(result.attempt.status, 'blocked');
  assert.equal(result.attempt.acquired, false);
  assert.equal(result.attempt.cleanup, 'not-acquired');
});

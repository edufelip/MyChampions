import assert from 'node:assert/strict';
import test from 'node:test';
import { iosCredentialEntryDiagnosticSelectors as selectors } from '../../scripts/testing/ios-credential-entry-diagnostic';
import {
  buildIosCredentialEntryInvalidatedSidecar,
  bindIosCredentialEntryOwnedLedger,
  collectIosCredentialEntryOwnedDiagnostic,
  deriveIosCredentialEntryExactValueBound,
  invalidateIosCredentialEntryOwnedEvidence,
  invalidateIosCredentialEntryOwnedSidecar,
  requireIosCredentialEntryFreshness,
  requireIosCredentialInteractionDiagnosticBudget,
  requireIosCredentialInteractionDiagnosticPreflight,
  runIosCredentialEntryOwnedBranch,
  runIosCredentialEntryOwnedWiring,
  type IosCredentialEntryOwnedBinding,
  type IosCredentialEntryOwnedStageInput,
  type OwnedIosCredentialCommandExecution,
} from '../../scripts/testing/ios-credential-entry-owned-seam';

const digest = (character: string): string => character.repeat(64);
const deviceId = 'owned-device-0001';
const expectedEmail = 'coach@example.invalid';

const binding: IosCredentialEntryOwnedBinding = {
  captureRunId: '0123456789abcdef01234567',
  fixtureRunId: 'fedcba9876543210fedcba98',
  fixtureScope: 'native-entry-ios',
  backendRunId: 'fedcba9876543210fedcba98',
  backendAttemptId: 'fedcba9876543210fedcba98:first',
  scope: 'native-entry-ios',
  semanticSelector: selectors.email,
  deviceId,
  runtime: 'iOS 26.5',
  bundleId: 'com.edufelip.mychampions.dev',
  binaryHash: digest('a'),
  sourceTreeHash: digest('b'),
  sourceTreeHashAfter: digest('b'),
  helperInputsHash: digest('c'),
  helperInputsAfterHash: digest('c'),
  apiOrigin: 'http://127.0.0.1:40123',
  apiPid: 9001,
};

function tree(email: string, focused = false, passwordText = ''): Record<string, unknown> {
  return {
    attributes: { 'resource-id': 'auth.signIn.screen' },
    children: [
      {
        attributes: { 'resource-id': selectors.email, text: email, focused },
        children: [],
      },
      {
        attributes: { 'resource-id': selectors.password, text: passwordText },
        children: [],
      },
      { attributes: { 'resource-id': selectors.submit }, children: [] },
    ],
  };
}

function execution(
  label: string,
  command: 'maestro' | 'xcrun',
  argv: string[],
  executionState: OwnedIosCredentialCommandExecution['execution'] = 'completed',
  flowSha256: string | undefined = undefined,
): OwnedIosCredentialCommandExecution {
  return {
    label,
    command,
    argv,
    phase: 'step',
    execution: executionState,
    cleanup: 'cleaned',
    childExitCode: executionState === 'completed' ? 0 : 1,
    childSignal: null,
    pid: 901,
    pgid: 901,
    logPath: `/private/owned/${label}.private.log`,
    stdoutPath: `/private/owned/${label}.stdout`,
    ownershipPath: `/private/owned/${label}.ownership.json`,
    elapsedMs: 5,
    cleanupMs: 2,
    deadlineMs: 30_000,
    flowSha256,
    ownershipReceiptSha256: digest('d'),
    startIdentity: {
      pid: 901,
      pgid: 901,
      started: 'Thu Oct  2 12:00:00 2026',
      commandHash: digest('e'),
    },
  };
}

function stage(
  stageName: IosCredentialEntryOwnedStageInput['stage'],
  sequence: number,
  executions: readonly OwnedIosCredentialCommandExecution[],
  hierarchy: unknown,
  hierarchyBytes: Buffer | null,
  screenshotBytes: Buffer | null,
  actionStatus: IosCredentialEntryOwnedStageInput['actionStatus'] = 'completed',
): IosCredentialEntryOwnedStageInput {
  const actionKind =
    stageName === 'entry'
      ? 'observation'
      : stageName === 'email-after-tap'
        ? 'tap-email'
        : 'input-email';
  const flowSha256 = stageName === 'entry' ? null : digest('f');
  const assertionExecution =
    stageName === 'email-after-input'
      ? (executions.find((row) => row.label === 'credential-email-after-input-assertion') ?? null)
      : null;
  return {
    stage: stageName,
    sequence,
    actionKind,
    selector: stageName === 'entry' ? null : selectors.email,
    actionStatus,
    actionLabel: stageName === 'entry' ? null : `credential-${stageName}-action`,
    hierarchyLabel: `credential-${stageName}-hierarchy`,
    screenshotLabel: `credential-${stageName}-screenshot`,
    actionExecution:
      stageName === 'entry'
        ? null
        : (executions.find((row) => row.label === `credential-${stageName}-action`) ?? null),
    actionFlowSha256: flowSha256,
    assertionExecution,
    assertionLabel:
      stageName === 'email-after-input' ? 'credential-email-after-input-assertion' : null,
    assertionFlowSha256: stageName === 'email-after-input' ? digest('f') : null,
    hierarchyExecution:
      executions.find((row) => row.label === `credential-${stageName}-hierarchy`) ?? null,
    screenshotExecution:
      executions.find((row) => row.label === `credential-${stageName}-screenshot`) ?? null,
    commandExecutions: executions,
    hierarchy,
    hierarchyBytes,
    screenshotBytes,
    hierarchyPath: hierarchyBytes ? `${stageName}.hierarchy.json` : null,
    screenshotPath: screenshotBytes ? `${stageName}.png` : null,
    postAssertionHierarchy: null,
    postAssertionHierarchyBytes: null,
    postAssertionHierarchyPath: null,
    postAssertionScreenshotBytes: null,
    postAssertionScreenshotPath: null,
    keyboard: stageName === 'entry' ? 'hidden' : 'visible',
    postAssertionHierarchyExecution: null,
    postAssertionScreenshotExecution: null,
    postAssertionHierarchyLabel: null,
    postAssertionScreenshotLabel: null,
    appBoundary: 'unknown',
    expectedEmail,
  };
}

function successfulInput(): {
  binding: IosCredentialEntryOwnedBinding;
  stages: IosCredentialEntryOwnedStageInput[];
} {
  const all = [
    execution('credential-entry-hierarchy', 'maestro', [
      '--no-ansi',
      '--udid',
      deviceId,
      'hierarchy',
    ]),
    execution('credential-entry-screenshot', 'xcrun', [
      'simctl',
      'io',
      deviceId,
      'screenshot',
      '/private/owned/entry.png',
    ]),
    execution(
      'credential-email-after-tap-action',
      'maestro',
      ['--no-ansi', '--udid', deviceId, 'test', '/private/owned/tap.yaml'],
      'completed',
      digest('f'),
    ),
    execution('credential-email-after-tap-hierarchy', 'maestro', [
      '--no-ansi',
      '--udid',
      deviceId,
      'hierarchy',
    ]),
    execution('credential-email-after-tap-screenshot', 'xcrun', [
      'simctl',
      'io',
      deviceId,
      'screenshot',
      '/private/owned/tap.png',
    ]),
    execution(
      'credential-email-after-input-action',
      'maestro',
      ['--no-ansi', '--udid', deviceId, 'test', '/private/owned/input.yaml'],
      'completed',
      digest('f'),
    ),
    execution(
      'credential-email-after-input-assertion',
      'maestro',
      ['--no-ansi', '--udid', deviceId, 'test', '/private/owned/input-assertion.yaml'],
      'completed',
      digest('f'),
    ),
    execution('credential-email-after-input-hierarchy', 'maestro', [
      '--no-ansi',
      '--udid',
      deviceId,
      'hierarchy',
    ]),
    execution('credential-email-after-input-screenshot', 'xcrun', [
      'simctl',
      'io',
      deviceId,
      'screenshot',
      '/private/owned/input.png',
    ]),
  ];
  return {
    binding,
    stages: [
      stage('entry', 0, all, tree(''), Buffer.from('entry-tree'), Buffer.from('entry-png')),
      stage(
        'email-after-tap',
        1,
        all,
        tree('', true),
        Buffer.from('tap-tree'),
        Buffer.from('tap-png'),
      ),
      stage(
        'email-after-input',
        2,
        all,
        tree(expectedEmail, true, 'password-value-never-persisted'),
        Buffer.from('input-tree'),
        Buffer.from('input-png'),
      ),
    ],
  };
}

void test('owned three-stage seam binds actual command records and derives exact value internally', () => {
  const sample = successfulInput();
  const diagnostic = collectIosCredentialEntryOwnedDiagnostic(sample.binding, sample.stages);
  assert.equal(diagnostic.result.status, 'observed');
  assert.equal(diagnostic.result.nativeQualification, 'Pending');
  assert.equal(diagnostic.result.publicPromotionEligible, false);
  assert.equal(diagnostic.receipts.length, 3);
  assert.equal(diagnostic.receipts[2].exactValueBound, true);
  assert.equal(diagnostic.receipts[1].actionExecution?.elapsedMs, 5);
  assert.equal(diagnostic.receipts[1].actionExecution?.cleanupMs, 2);
  assert.equal(deriveIosCredentialEntryExactValueBound(tree(expectedEmail), expectedEmail), true);
  assert.equal(
    deriveIosCredentialEntryExactValueBound(tree('forged@example.invalid'), expectedEmail),
    false,
  );
});

void test('a structurally valid forged command receipt is rejected by identity, not accepted by its hash', () => {
  const sample = successfulInput();
  const forged = {
    ...sample.stages[1],
    actionExecution: { ...sample.stages[1].actionExecution! },
  };
  assert.throws(
    () =>
      collectIosCredentialEntryOwnedDiagnostic(sample.binding, [
        sample.stages[0],
        forged,
        sample.stages[2],
      ]),
    /not an owned command record/,
  );
});

void test('caller cannot force exactValueBound with a forged hierarchy or boolean', () => {
  const sample = successfulInput();
  const wrong = {
    ...sample.stages[2],
    hierarchy: tree('other@example.invalid', true),
  };
  const diagnostic = collectIosCredentialEntryOwnedDiagnostic(sample.binding, [
    sample.stages[0],
    sample.stages[1],
    wrong,
  ]);
  assert.equal(diagnostic.result.status, 'blocked');
  assert.deepEqual(diagnostic.result.failure, {
    stage: 'email-after-input',
    reason: 'exact-same-field-assertion-not-recorded',
  });
  assert.equal(diagnostic.receipts[2].exactValueBound, false);
});

void test('missing exact assertion stays a blocked projection instead of becoming observed', () => {
  const sample = successfulInput();
  const missingAssertion = {
    ...sample.stages[2],
    assertionExecution: null,
    assertionLabel: null,
    assertionFlowSha256: null,
  };
  const diagnostic = collectIosCredentialEntryOwnedDiagnostic(sample.binding, [
    sample.stages[0],
    sample.stages[1],
    missingAssertion,
  ]);
  assert.equal(diagnostic.result.status, 'blocked');
  assert.deepEqual(diagnostic.result.failure, {
    stage: 'email-after-input',
    reason: 'exact-same-field-assertion-not-recorded',
  });
});

void test('redacted result omits password, input value and private paths while receipts retain only private sidecar data', () => {
  const sample = successfulInput();
  const diagnostic = collectIosCredentialEntryOwnedDiagnostic(sample.binding, sample.stages);
  const serializedResult = JSON.stringify(diagnostic.result);
  assert.equal(serializedResult.includes(expectedEmail), false);
  assert.equal(serializedResult.includes('password-value-never-persisted'), false);
  assert.equal(serializedResult.includes('/private/owned'), false);
  assert.equal(diagnostic.receipts[2].screenshotPath, 'email-after-input.png');
});

void test('failed action preserves a truthful failed stage and never fabricates frame bytes', () => {
  const sample = successfulInput();
  const failedAction = execution(
    'credential-email-after-tap-action',
    'maestro',
    ['--no-ansi', '--udid', deviceId, 'test', '/private/owned/tap.yaml'],
    'child-failed',
    digest('f'),
  );
  const executions = [...sample.stages[0].commandExecutions, failedAction];
  const failedTap = stage('email-after-tap', 1, executions, null, null, null, 'failed');
  const diagnostic = collectIosCredentialEntryOwnedDiagnostic(sample.binding, [
    sample.stages[0],
    failedTap,
  ]);
  assert.equal(diagnostic.result.status, 'failed');
  assert.deepEqual(diagnostic.result.failure, {
    stage: 'email-after-tap',
    reason: 'action-failed',
  });
  assert.equal(diagnostic.result.observedStages[1].email.presence, 'unknown');
});

void test('scope, backend, source and helper bindings fail closed before projection', () => {
  const sample = successfulInput();
  assert.throws(
    () =>
      collectIosCredentialEntryOwnedDiagnostic(
        { ...sample.binding, sourceTreeHash: 'bad' },
        sample.stages,
      ),
    /source hash must be a lowercase SHA-256 digest/,
  );
  assert.throws(
    () =>
      collectIosCredentialEntryOwnedDiagnostic(
        {
          ...sample.binding,
          backendAttemptId: `${sample.binding.backendRunId}:second`,
        },
        sample.stages,
      ),
    /backend attempt is not the owned first attempt/,
  );
});

void test('cleanup failure is not treated as an owned completed receipt', () => {
  const sample = successfulInput();
  sample.stages[0].commandExecutions[0].cleanup = 'failed-recovery-ledger-retained';
  assert.throws(
    () => collectIosCredentialEntryOwnedDiagnostic(sample.binding, sample.stages),
    /execution cleanup is not proven/,
  );
});

void test('owned ledger bytes bind the real process start identity and reject a tampered member', () => {
  const command = execution(
    'credential-email-after-tap-action',
    'maestro',
    ['--no-ansi', '--udid', deviceId, 'test', '/private/owned/tap.yaml'],
    'completed',
    digest('f'),
  );
  if (command.pid === null || command.pgid === null) throw new Error('fixture PID missing');
  const pid = command.pid;
  const pgid = command.pgid;
  const ledger = Buffer.from(
    JSON.stringify({
      processes: [
        {
          pid,
          pgid,
          started: command.startIdentity!.started,
          commandHash: command.startIdentity!.commandHash,
        },
      ],
    }),
  );
  const bound = bindIosCredentialEntryOwnedLedger(ledger, command);
  assert.equal(bound.ownershipReceiptSha256.length, 64);
  assert.deepEqual(bound.startIdentity, command.startIdentity);
  assert.throws(
    () =>
      bindIosCredentialEntryOwnedLedger(
        Buffer.from(
          JSON.stringify({
            processes: [
              {
                pid: pid + 1,
                pgid,
                started: command.startIdentity!.started,
                commandHash: command.startIdentity!.commandHash,
              },
            ],
          }),
        ),
        command,
      ),
    /start identity is not owned/,
  );
  assert.throws(
    () =>
      bindIosCredentialEntryOwnedLedger(
        Buffer.from(
          JSON.stringify({
            processes: [
              {
                pid,
                pgid,
                started: `${command.startIdentity!.started}-tampered`,
                commandHash: command.startIdentity!.commandHash,
              },
            ],
          }),
        ),
        command,
      ),
    /start identity differs from the ledger/,
  );
  assert.throws(
    () =>
      bindIosCredentialEntryOwnedLedger(
        Buffer.from(
          JSON.stringify({
            processes: [
              {
                pid,
                pgid,
                started: command.startIdentity!.started,
                commandHash: digest('a'),
              },
            ],
          }),
        ),
        command,
      ),
    /start identity differs from the ledger/,
  );
  assert.throws(
    () =>
      bindIosCredentialEntryOwnedLedger(
        Buffer.from(
          JSON.stringify({
            processes: [
              {
                pid,
                pgid,
                started: command.startIdentity!.started,
                commandHash: command.startIdentity!.commandHash,
              },
              {
                pid,
                pgid,
                started: command.startIdentity!.started,
                commandHash: command.startIdentity!.commandHash,
              },
            ],
          }),
        ),
        command,
      ),
    /start identity is ambiguous/,
  );
  assert.throws(
    () =>
      bindIosCredentialEntryOwnedLedger(
        Buffer.from(JSON.stringify({ processes: 'not-an-array' })),
        command,
      ),
    /ownership members are missing/,
  );
});

void test('retained hierarchy evidence requires a completed owned observation command', () => {
  const sample = successfulInput();
  for (const executionState of ['child-failed', 'deadline', 'cancelled'] as const) {
    const failedHierarchy = execution(
      'credential-entry-hierarchy',
      'maestro',
      ['--no-ansi', '--udid', deviceId, 'hierarchy'],
      executionState,
    );
    const executions = [
      ...sample.stages[0].commandExecutions.filter(
        (candidate) => candidate !== sample.stages[0].hierarchyExecution,
      ),
      failedHierarchy,
    ];
    const invalid = stage(
      'entry',
      0,
      executions,
      tree(''),
      Buffer.from('entry-tree'),
      Buffer.from('entry-png'),
    );
    assert.throws(
      () => collectIosCredentialEntryOwnedDiagnostic(sample.binding, [invalid]),
      /execution must be completed for retained evidence/,
    );
  }
});

void test('failed exact assertion retains the owned frame and reports a failed stage', () => {
  const sample = successfulInput();
  const failedAssertion = execution(
    'credential-email-after-input-assertion',
    'maestro',
    ['--no-ansi', '--udid', deviceId, 'test', '/private/owned/input-assertion.yaml'],
    'child-failed',
    digest('f'),
  );
  const postHierarchy = execution(
    'credential-email-after-input-post-assertion-hierarchy',
    'maestro',
    ['--no-ansi', '--udid', deviceId, 'hierarchy'],
  );
  const postScreenshot = execution(
    'credential-email-after-input-post-assertion-screenshot',
    'xcrun',
    ['simctl', 'io', deviceId, 'screenshot', '/private/owned/post.png'],
  );
  const executions = [
    ...sample.stages[0].commandExecutions,
    failedAssertion,
    postHierarchy,
    postScreenshot,
  ];
  const failed = {
    ...sample.stages[2],
    actionStatus: 'failed' as const,
    assertionExecution: failedAssertion,
    assertionFlowSha256: digest('f'),
    postAssertionHierarchyExecution: postHierarchy,
    postAssertionScreenshotExecution: postScreenshot,
    postAssertionHierarchyLabel: postHierarchy.label,
    postAssertionScreenshotLabel: postScreenshot.label,
    postAssertionHierarchy: tree(expectedEmail, true),
    postAssertionHierarchyBytes: Buffer.from('post-tree'),
    postAssertionScreenshotBytes: Buffer.from('post-png'),
    postAssertionHierarchyPath: 'post.hierarchy.json',
    postAssertionScreenshotPath: 'post.png',
    commandExecutions: executions,
  };
  const diagnostic = collectIosCredentialEntryOwnedDiagnostic(sample.binding, [
    sample.stages[0],
    sample.stages[1],
    failed,
  ]);
  assert.equal(diagnostic.result.status, 'failed');
  assert.deepEqual(diagnostic.result.failure, {
    stage: 'email-after-input',
    reason: 'exact-same-field-assertion-failed',
  });
  assert.equal(diagnostic.receipts[2].hierarchySha256 !== null, true);
  assert.equal(diagnostic.receipts[2].postAssertionHierarchySha256 !== null, true);
  assert.notEqual(
    diagnostic.receipts[2].hierarchySha256,
    diagnostic.receipts[2].postAssertionHierarchySha256,
  );
  assert.match(diagnostic.receipts[2].hierarchyPath ?? '', /email-after-input\.hierarchy/);
  assert.equal(diagnostic.receipts[2].postAssertionHierarchyPath, 'post.hierarchy.json');
  assert.equal(diagnostic.receipts[2].assertionExecution?.childExitCode, 1);
  assert.equal(diagnostic.receipts[2].exactValueBound, true);
});

void test('post-assertion bytes cannot bypass a missing or non-completed owned hierarchy command', () => {
  const sample = successfulInput();
  const failedAssertion = execution(
    'credential-email-after-input-assertion',
    'maestro',
    ['--no-ansi', '--udid', deviceId, 'test', '/private/owned/input-assertion.yaml'],
    'child-failed',
    digest('f'),
  );
  const postScreenshot = execution(
    'credential-email-after-input-post-assertion-screenshot',
    'xcrun',
    ['simctl', 'io', deviceId, 'screenshot', '/private/owned/post.png'],
  );
  const postHierarchy = execution(
    'credential-email-after-input-post-assertion-hierarchy',
    'maestro',
    ['--no-ansi', '--udid', deviceId, 'hierarchy'],
  );
  const base = {
    ...sample.stages[2],
    actionStatus: 'failed' as const,
    assertionExecution: failedAssertion,
    assertionFlowSha256: digest('f'),
    postAssertionScreenshotExecution: postScreenshot,
    postAssertionScreenshotLabel: postScreenshot.label,
    postAssertionScreenshotBytes: Buffer.from('post-png'),
    postAssertionScreenshotPath: 'post.png',
    postAssertionHierarchyLabel: postHierarchy.label,
    postAssertionHierarchy: tree(expectedEmail, true),
    postAssertionHierarchyBytes: Buffer.from('post-tree'),
    postAssertionHierarchyPath: 'post.hierarchy.json',
  };
  assert.throws(
    () =>
      collectIosCredentialEntryOwnedDiagnostic(sample.binding, [
        sample.stages[0],
        sample.stages[1],
        { ...base, postAssertionHierarchy: null },
      ]),
    /post-assertion hierarchy is missing/,
  );
  assert.throws(
    () =>
      collectIosCredentialEntryOwnedDiagnostic(sample.binding, [
        sample.stages[0],
        sample.stages[1],
        {
          ...base,
          postAssertionHierarchyExecution: null,
          commandExecutions: [
            ...sample.stages[0].commandExecutions,
            failedAssertion,
            postScreenshot,
          ],
        },
      ]),
    /post-assertion-hierarchy execution is missing/,
  );
  const failedPostHierarchy = execution(
    postHierarchy.label,
    'maestro',
    ['--no-ansi', '--udid', deviceId, 'hierarchy'],
    'child-failed',
  );
  assert.throws(
    () =>
      collectIosCredentialEntryOwnedDiagnostic(sample.binding, [
        sample.stages[0],
        sample.stages[1],
        {
          ...base,
          postAssertionHierarchyExecution: failedPostHierarchy,
          commandExecutions: [
            ...sample.stages[0].commandExecutions,
            failedAssertion,
            failedPostHierarchy,
            postScreenshot,
          ],
        },
      ]),
    /post-assertion-hierarchy execution must be completed for retained evidence/,
  );
});

void test('freshness is checked after the final frame and rejects a changed source or helper', () => {
  assert.doesNotThrow(() =>
    requireIosCredentialEntryFreshness({
      sourceTreeHashBefore: digest('a'),
      sourceTreeHashAfter: digest('a'),
      helperInputsHashBefore: digest('b'),
      helperInputsHashAfter: digest('b'),
    }),
  );
  assert.throws(
    () =>
      requireIosCredentialEntryFreshness({
        sourceTreeHashBefore: digest('a'),
        sourceTreeHashAfter: digest('c'),
        helperInputsHashBefore: digest('b'),
        helperInputsHashAfter: digest('b'),
      }),
    /source changed after the final frame/,
  );
  assert.throws(
    () =>
      requireIosCredentialEntryFreshness({
        sourceTreeHashBefore: digest('a'),
        sourceTreeHashAfter: digest('a'),
        helperInputsHashBefore: digest('b'),
        helperInputsHashAfter: digest('c'),
      }),
    /helper inputs changed after the final frame/,
  );
});

void test('credential interaction preflight rejects no-owner and expired-budget paths', () => {
  assert.throws(
    () =>
      requireIosCredentialInteractionDiagnosticPreflight({
        ownedSession: false,
        ownedTarget: true,
        deadlineAtMs: 10_000,
        nowMs: 1,
      }),
    /owned session is unavailable/,
  );
  assert.throws(
    () =>
      requireIosCredentialInteractionDiagnosticPreflight({
        ownedSession: true,
        ownedTarget: true,
        deadlineAtMs: 10,
        nowMs: 10,
      }),
    /budget expired/,
  );
  const controller = new AbortController();
  controller.abort(new Error('prelude cancelled'));
  assert.throws(
    () =>
      requireIosCredentialInteractionDiagnosticBudget({
        deadlineAtMs: 10_000,
        nowMs: 1,
        signal: controller.signal,
      }),
    /prelude cancelled/,
  );
  assert.doesNotThrow(() =>
    requireIosCredentialInteractionDiagnosticPreflight({
      ownedSession: true,
      ownedTarget: true,
      deadlineAtMs: 10_000,
      nowMs: 1,
    }),
  );
});

void test('owned branch blocks normal continuation after failed or blocked diagnostic', async () => {
  let continuationCalls = 0;
  let outerFailures = 0;
  const observedStatuses: string[] = [];
  await assert.rejects(
    runIosCredentialEntryOwnedBranch({
      captureDiagnostic: () =>
        Promise.resolve({
          result: { status: 'failed' } as ReturnType<
            typeof collectIosCredentialEntryOwnedDiagnostic
          >['result'],
          receipts: [],
        }),
      continueAfterDiagnostic: () => {
        continuationCalls += 1;
        return Promise.resolve('continued');
      },
      onDiagnostic: (diagnostic) => {
        observedStatuses.push(diagnostic.result.status);
      },
      onOuterFailure: () => {
        outerFailures += 1;
      },
    }),
    /did not observe all stages: failed/,
  );
  await assert.rejects(
    runIosCredentialEntryOwnedBranch({
      captureDiagnostic: () =>
        Promise.resolve({
          result: { status: 'blocked' } as ReturnType<
            typeof collectIosCredentialEntryOwnedDiagnostic
          >['result'],
          receipts: [],
        }),
      continueAfterDiagnostic: () => {
        continuationCalls += 1;
        return Promise.resolve('continued');
      },
      onDiagnostic: (diagnostic) => {
        observedStatuses.push(diagnostic.result.status);
      },
      onOuterFailure: () => {
        outerFailures += 1;
      },
    }),
    /did not observe all stages: blocked/,
  );
  assert.equal(continuationCalls, 0);
  assert.deepEqual(observedStatuses, ['failed', 'blocked']);
  assert.equal(outerFailures, 2);
  const result = await runIosCredentialEntryOwnedBranch({
    captureDiagnostic: () =>
      Promise.resolve({
        result: { status: 'observed' } as ReturnType<
          typeof collectIosCredentialEntryOwnedDiagnostic
        >['result'],
        receipts: [],
      }),
    continueAfterDiagnostic: () => {
      continuationCalls += 1;
      return Promise.resolve('continued');
    },
    onDiagnostic: (diagnostic) => {
      observedStatuses.push(diagnostic.result.status);
    },
  });
  assert.equal(result, 'continued');
  assert.equal(continuationCalls, 1);
  assert.deepEqual(observedStatuses, ['failed', 'blocked', 'observed']);
});

void test('capture-used wiring transfers the same diagnostic and preserves callback order', async () => {
  const diagnostic = {
    result: { status: 'observed' } as ReturnType<
      typeof collectIosCredentialEntryOwnedDiagnostic
    >['result'],
    receipts: [],
  };
  const events: string[] = [];
  const result = await runIosCredentialEntryOwnedWiring({
    captureDiagnostic: () => {
      events.push('capture');
      return Promise.resolve(diagnostic);
    },
    onDiagnostic: (received) => {
      events.push('diagnostic');
      assert.equal(received, diagnostic);
    },
    continueAfterDiagnostic: (received) => {
      events.push('continue');
      assert.equal(received, diagnostic);
      return Promise.resolve(received.result.status);
    },
    onOuterFailure: () => {
      events.push('outer-failure');
    },
  });
  assert.equal(result, 'observed');
  assert.deepEqual(events, ['capture', 'diagnostic', 'continue']);
});

void test('late source/helper drift invalidates the report projection while retaining the private sidecar reference', () => {
  const report: Parameters<typeof invalidateIosCredentialEntryOwnedSidecar>[0]['report'] = {
    credentialEntryDiagnostic: { status: 'observed' } as ReturnType<
      typeof collectIosCredentialEntryOwnedDiagnostic
    >['result'],
    credentialEntryDiagnosticEvidence: {
      path: 'credential-entry-diagnostic.private.json',
      evidenceState: 'valid',
      valid: true,
      sha256: digest('a'),
    },
    credentialEntryDiagnosticInvalidated: false,
  };
  invalidateIosCredentialEntryOwnedEvidence(
    report,
    'source and helper inputs changed after the diagnostic sidecar was written',
  );
  assert.equal(report.credentialEntryDiagnostic, null);
  assert.equal(report.credentialEntryDiagnosticInvalidated, true);
  assert.deepEqual(report.credentialEntryDiagnosticEvidence, {
    path: 'credential-entry-diagnostic.private.json',
    evidenceState: 'invalidated',
    valid: false,
    sha256: digest('a'),
    invalidationReason: 'source and helper inputs changed after the diagnostic sidecar was written',
  });
});

void test('sidecar invalidation retains raw private stages while sealing the prior projection', () => {
  const original = Buffer.from(
    JSON.stringify({
      schemaVersion: 4,
      evidenceState: 'valid',
      valid: true,
      binding: { sourceTreeHash: digest('a') },
      stages: [{ hierarchySha256: digest('b') }],
      result: { status: 'observed' },
    }),
  );
  const invalidated = buildIosCredentialEntryInvalidatedSidecar({
    originalBytes: original,
    reason: 'late helper drift',
    invalidatedAt: '2026-10-02T00:00:00.000Z',
  });
  const parsed = JSON.parse(invalidated.bytes.toString('utf8')) as Record<string, unknown>;
  assert.equal(parsed.evidenceState, 'invalidated');
  assert.equal(parsed.valid, false);
  assert.deepEqual(parsed.stages, [{ hierarchySha256: digest('b') }]);
  assert.deepEqual(parsed.invalidation, {
    reason: 'late helper drift',
    invalidatedAt: '2026-10-02T00:00:00.000Z',
    originalSha256: invalidated.originalSha256,
  });
  assert.equal(invalidated.invalidatedSha256.length, 64);
});

void test('sidecar publication failure invalidates the projection before writes and retains failure evidence', async () => {
  const original = Buffer.from(
    JSON.stringify({
      schemaVersion: 4,
      evidenceState: 'valid',
      valid: true,
      stages: [],
    }),
  );
  const report: Parameters<typeof invalidateIosCredentialEntryOwnedSidecar>[0]['report'] = {
    credentialEntryDiagnostic: { status: 'observed' } as ReturnType<
      typeof collectIosCredentialEntryOwnedDiagnostic
    >['result'],
    credentialEntryDiagnosticEvidence: {
      path: 'credential-entry-diagnostic.private.json',
      evidenceState: 'valid',
      valid: true,
    },
    credentialEntryDiagnosticInvalidated: false,
  };
  const writes: { path: string; bytes: Buffer }[] = [];
  let invalidBeforeFirstWrite = false;
  const status = await invalidateIosCredentialEntryOwnedSidecar({
    report,
    reason: 'late helper drift',
    sidecarIoPath: '/private/qa/sidecar.json',
    sidecarReportPath: 'credential-entry-diagnostic.private.json',
    originalIoPath: '/private/qa/sidecar.original.private.json',
    invalidationIoPath: '/private/qa/invalidation.private.json',
    invalidationReportPath: 'invalidation.private.json',
    failureIoPath: '/private/qa/invalidation-failure.private.json',
    failureReportPath: 'invalidation-failure.private.json',
    io: {
      read: () => Promise.resolve(original),
      write: (filePath, bytes) => {
        invalidBeforeFirstWrite ||= report.credentialEntryDiagnostic === null;
        writes.push({ path: filePath, bytes });
        if (filePath.endsWith('/sidecar.json'))
          return Promise.reject(new Error('deterministic sidecar write failure'));
        return Promise.resolve();
      },
      now: () => '2026-10-02T00:00:00.000Z',
    },
  });
  assert.equal(status, 'publication-failed');
  assert.equal(invalidBeforeFirstWrite, true);
  assert.equal(report.credentialEntryDiagnostic, null);
  assert.equal(report.credentialEntryDiagnosticInvalidated, true);
  assert.equal(report.credentialEntryDiagnosticEvidence?.['valid'], false);
  assert.equal(report.credentialEntryDiagnosticEvidence?.['invalidationPublication'], 'failed');
  assert.equal(report.credentialEntryDiagnosticEvidence?.['originalSidecarRetained'], true);
  const failure = writes.find((row) => row.path.endsWith('invalidation-failure.private.json'));
  assert.ok(failure);
  assert.equal(
    (JSON.parse(failure.bytes.toString('utf8')) as Record<string, unknown>).originalSidecarRetained,
    true,
  );
});

void test('completed email actions reject failed, deadline and cancelled owned commands', () => {
  for (const index of [1, 2]) {
    for (const executionState of ['child-failed', 'deadline', 'cancelled'] as const) {
      const sample = successfulInput();
      const original = sample.stages[index].actionExecution!;
      const failed = {
        ...original,
        execution: executionState,
        childExitCode: 1,
      };
      const invalid = {
        ...sample.stages[index],
        actionExecution: failed,
        commandExecutions: sample.stages[index].commandExecutions.map((value) =>
          value === original ? failed : value,
        ),
      };
      sample.stages[index] = invalid;
      assert.throws(
        () => collectIosCredentialEntryOwnedDiagnostic(sample.binding, sample.stages),
        /action execution must be completed for retained evidence/,
      );
    }
  }
});

void test('passed exact-email assertion rejects failed, deadline and cancelled owned commands', () => {
  for (const executionState of ['child-failed', 'deadline', 'cancelled'] as const) {
    const sample = successfulInput();
    const original = sample.stages[2].assertionExecution!;
    const failed = { ...original, execution: executionState, childExitCode: 1 };
    sample.stages[2] = {
      ...sample.stages[2],
      assertionExecution: failed,
      commandExecutions: sample.stages[2].commandExecutions.map((value) =>
        value === original ? failed : value,
      ),
    };
    assert.throws(
      () => collectIosCredentialEntryOwnedDiagnostic(sample.binding, sample.stages),
      /assertion execution must be completed for retained evidence/,
    );
  }
});

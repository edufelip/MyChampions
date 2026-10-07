import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

void test('shared iOS lifecycle import is inert; invalid or already-cancelled requests acquire no resources', async () => {
  const root = path.resolve(__dirname, '../../.qa/artifacts/native-pilot');
  const listArtifacts = async () => {
    try {
      return (await readdir(root)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const filesBefore = await listArtifacts();
  const before = {
    int: process.listeners('SIGINT'),
    term: process.listeners('SIGTERM'),
    exit: process.exitCode,
  };
  const { runOwnedIosNativeSession } =
    await import('../../scripts/testing/capture-native-testability');
  assert.deepEqual(process.listeners('SIGINT'), before.int);
  assert.deepEqual(process.listeners('SIGTERM'), before.term);
  assert.equal(process.exitCode, before.exit);
  for (const options of [
    null,
    [],
    {},
    { charter: 'unknown' },
    { charter: 'entry', reuseBuildRunId: '../escape' },
    { charter: 'entry', reuseBuildRunId: 42 },
    { charter: 'entry', extra: true },
    { charter: 'entry', signal: {} },
    { charter: 'entry', executeTraining: async () => {} },
    { charter: 'training-journey', executeTraining: true },
    { charter: 'entry', executeSaveRetry: async () => {} },
    { charter: 'training-journey', executeSaveRetry: async () => {} },
    { charter: 'save-retry', executeSaveRetry: true },
    { charter: 'connection-journey' },
    { charter: 'entry', credentialInteractionDiagnostic: true },
    { charter: 'camera-denied', credentialInteractionDiagnostic: true },
    {
      charter: 'camera-denied',
      credentialInteractionDiagnostic: 'yes',
      executeCamera: async () => {},
    },
    { charter: 'entry', executeConnection: async () => {} },
    { charter: 'training-journey', executeConnection: async () => {} },
    { charter: 'connection-journey', executeConnection: true },
    {
      charter: 'training-journey',
      executeTraining: async () => {},
      executeSaveRetry: async () => {},
    },
    {
      charter: 'connection-journey',
      executeConnection: async () => {},
      executeTraining: async () => {},
    },
    {
      charter: 'connection-journey',
      executeConnection: async () => {},
      executeSaveRetry: async () => {},
    },
  ])
    await assert.rejects(
      runOwnedIosNativeSession(options as never),
      /Invalid owned iOS session options/,
    );
  for (const reason of ['SIGINT', 'SIGTERM', new Error('cancelled before native acquisition')]) {
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(
      runOwnedIosNativeSession({
        charter: 'training-journey',
        signal: controller.signal,
      }),
      (error) => error === reason,
    );
  }
  for (const bootstatusDeadlineMs of [null, '1000', 999, 180001, NaN])
    await assert.rejects(
      runOwnedIosNativeSession({
        charter: 'entry',
        bootstatusDeadlineMs,
      } as never),
      /Invalid simulator bootstatus deadline/,
    );
  for (const deadlines of [null, [], { extra: 1000 }, { buildMs: 900001 }, { wholeRunMs: 999 }])
    await assert.rejects(
      runOwnedIosNativeSession({ charter: 'entry', deadlines } as never),
      /Invalid native execution deadlines/,
    );
  assert.deepEqual(await listArtifacts(), filesBefore);
  assert.deepEqual(process.listeners('SIGINT'), before.int);
  assert.deepEqual(process.listeners('SIGTERM'), before.term);
  assert.equal(process.exitCode, before.exit);
});

void test('iOS backend acquisition failure retains safe recovery facts and blocks cleaned status', async () => {
  const { projectIosCaptureCleanup, projectIosOwnedSessionAcquisitionFailure } =
    await import('../../scripts/testing/capture-native-testability');
  const { OwnedSessionAcquisitionError } = await import('../../scripts/testing/owned-session');
  const failure = new OwnedSessionAcquisitionError({
    cleanup: 'failed-recovery-ledger-retained',
    childExitCode: 2,
    pid: 4123,
    diagnostics: 'backend stderr '.repeat(10_000),
    manifest: {
      phase: 'cleanup',
      runId: 'a'.repeat(24),
      repoRoot: '/private/server',
      runtimeRoot: '/private/server/.qa/runtime/a'.repeat(1),
      artifactRoot: '/private/server/.qa/runtime/a',
      ownerTokenHash: 'secret-owner-token-hash',
      orchestratorPid: 4123,
      composeProject: 'mychampions-owned-a',
      port: 49123,
      targets: { api: '127.0.0.1' },
      fixtureScopes: ['native-entry-ios'],
      processes: [
        {
          role: 'api',
          pid: 4124,
          started: '2026-10-01T12:00:00.000Z',
          script: 'serve.ts',
        },
      ],
      repositories: {
        server: {
          sha: 'b'.repeat(40),
          dirty: false,
          workingTreeHash: 'c'.repeat(64),
        },
      },
    },
    closed: {
      event: 'closed',
      receiptPath: '/private/server/.qa/runtime/a/session-receipt.json',
      cleanup: 'failed-recovery-ledger-retained',
      exitCode: 2,
      receipt: {
        schemaVersion: 1,
        runId: 'a'.repeat(24),
        repositories: {
          server: {
            sha: 'b'.repeat(40),
            dirty: false,
            workingTreeHash: 'c'.repeat(64),
          },
          client: {
            sha: 'f'.repeat(40),
            dirty: false,
            workingTreeHash: '1'.repeat(64),
          },
        },
        startedAt: '2026-10-01T12:00:00.000Z',
        finishedAt: '2026-10-01T12:00:01.000Z',
        requests: [],
        result: 'harness-blocked',
        reason: null,
        cleanup: 'failed-recovery-ledger-retained',
        error: 'backend acquisition failed',
        exitCode: 2,
      },
      receiptDocument: {
        path: 'session-receipt.json',
        schema: 'session-receipt-v1',
        sizeBytes: 512,
        sha256: 'd'.repeat(64),
        ownerUid: 501,
        mode: 0o600,
        verification: 'owned-runtime-document-v6',
      },
    },
  });
  const projected = projectIosOwnedSessionAcquisitionFailure(failure);
  assert.equal(projected.cleanup, 'failed-recovery-ledger-retained');
  assert.equal(projected.childExitCode, 2);
  assert.equal(projected.pid, 4123);
  assert.equal(projected.manifest?.runId, 'a'.repeat(24));
  assert.equal(projected.manifest?.processes[0]?.role, 'api');
  assert.equal(projected.closed?.cleanup, 'failed-recovery-ledger-retained');
  assert.equal(projected.diagnosticsBytes, 65_536);
  assert.equal(projected.diagnosticsTruncated, true);
  assert.equal(Object.hasOwn(projected.manifest ?? {}, 'ownerTokenHash'), false);
  assert.equal(Object.hasOwn(projected, 'diagnostics'), false);
  assert.deepEqual(projectIosCaptureCleanup([], projected.cleanup), {
    status: 'failed-recovery-retained',
    resources: ['backend-acquisition'],
  });
  assert.deepEqual(projectIosCaptureCleanup(['simulator'], 'cleaned'), {
    status: 'failed-recovery-retained',
    resources: ['simulator'],
  });
  assert.equal(projectIosCaptureCleanup([], 'not-acquired'), 'cleaned');
});

void test('capture CLI selection retains exact supported charter and qualified reuse syntax', async () => {
  const { parseIosNativeCaptureArguments: parse, iosNativeCharters } =
    await import('../../scripts/testing/capture-native-testability');
  const base = ['--platform=ios', '--mode=inventory'];
  assert.deepEqual(parse(base), { charter: 'entry' });
  for (const charter of iosNativeCharters) {
    const localeArgs = charter.startsWith('locale-') ? ['--locale=en-US'] : [];
    assert.deepEqual(
      parse([...base, `--charter=${charter}`, '--reuse-build=' + 'a'.repeat(24), ...localeArgs]),
      {
        charter,
        reuseBuildRunId: 'a'.repeat(24),
        ...(localeArgs.length ? { locale: 'en-US' } : {}),
      },
    );
  }
  for (const argv of [
    [],
    ['--platform=android', '--mode=inventory'],
    [...base, '--mode=inventory'],
    [...base, '--charter='],
    [...base, '--charter=unknown'],
    [...base, '--reuse-build='],
    [...base, '--reuse-build=../escape'],
    [...base, '--charter=entry', '--charter=training-journey'],
    [...base, '--reuse-build=' + 'a'.repeat(24), '--reuse-build=' + 'b'.repeat(24)],
    [...base, '--executeTraining=anything'],
    [...base, '--executeSaveRetry=anything'],
  ])
    assert.throws(() => parse(argv), /Invalid iOS native capture arguments/);
});

void test('camera diagnostic continuation preserves the original email assertion', async () => {
  const {
    buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions: build,
    resolveIosCredentialDiagnosticPostLogin,
  } = await import('../../scripts/testing/capture-native-testability');
  const lines = build('private-password', 'qa+camera@example.com').split('\n');
  const passwordInput = lines.indexOf('- inputText: "private-password"');
  const emailAssertion = lines.findIndex(
    (line, index) => index > passwordInput && line.startsWith('    text: '),
  );
  assert.ok(passwordInput >= 0);
  assert.equal(lines[emailAssertion - 2], '- assertVisible:');
  assert.equal(lines[emailAssertion - 1], '    id: auth.signIn.emailInput');
  assert.equal(lines[emailAssertion], '    text: "^qa\\\\+camera@example\\\\.com$"');
  assert.equal(lines.filter((line) => line === '- inputText: "private-password"').length, 1);
  assert.equal(lines.includes('    retryTapIfNoChange: true'), false);
  assert.deepEqual(resolveIosCredentialDiagnosticPostLogin({ cameraIntegration: true }), {
    actor: 'student',
    screenshot: 'SCR-student-home',
    selector: 'student.home.screen',
  });
  assert.deepEqual(resolveIosCredentialDiagnosticPostLogin({ cameraIntegration: false }), {
    actor: 'coach',
    screenshot: 'SCR-pro-home',
    selector: 'pro.home.screen',
  });
  assert.throws(
    () => resolveIosCredentialDiagnosticPostLogin({ cameraIntegration: 'true' as never }),
    /integration state is invalid/,
  );
});

void test('iOS credential actions gate exact email value before password and submit', async () => {
  const { buildIosCredentialEntryActions: build } =
    await import('../../scripts/testing/capture-native-testability');
  const email = 'qa+ios[regex].test@example.com';
  const password = 'private-test-password';
  const lines = build(email, password).split('\n');
  const firstTap = lines.indexOf('- tapOn:');
  const emailInput = lines.indexOf(`- inputText: ${JSON.stringify(email)}`);
  const firstEmailValue = lines.findIndex(
    (line, index) => index > emailInput && line.startsWith('    text: '),
  );
  const passwordTap = lines.findIndex(
    (line, index) => line === '- tapOn:' && index > firstEmailValue,
  );
  const passwordInput = lines.indexOf(`- inputText: ${JSON.stringify(password)}`);
  const secondEmailValue = lines.findIndex(
    (line, index) => index > passwordInput && line.startsWith('    text: '),
  );
  const hideKeyboard = lines.indexOf('- hideKeyboard');
  const submitVisible = lines.indexOf('- assertVisible:', hideKeyboard);
  const submitTap = lines.lastIndexOf('- tapOn:');
  assert.equal(lines[firstTap + 1], '    id: auth.signIn.emailInput');
  assert.equal(lines[firstTap + 2], '    retryTapIfNoChange: true');
  assert.ok(firstTap < emailInput && emailInput < firstEmailValue);
  assert.equal(lines[firstEmailValue - 2], '- assertVisible:');
  assert.equal(lines[firstEmailValue - 1], '    id: auth.signIn.emailInput');
  assert.equal(lines[passwordTap + 1], '    id: auth.signIn.passwordInput');
  assert.equal(lines[passwordTap + 2], '    retryTapIfNoChange: true');
  assert.ok(passwordTap < passwordInput);
  assert.equal(secondEmailValue, passwordInput + 3);
  assert.equal(lines[secondEmailValue - 2], '- assertVisible:');
  assert.equal(lines[secondEmailValue - 1], '    id: auth.signIn.emailInput');
  assert.equal(lines.includes('    focused: true'), false);
  assert.equal(lines.includes('    isRegex: true'), false);
  const emailValueIndexes = [firstEmailValue, secondEmailValue];
  const generatedEmailPatterns = emailValueIndexes.map(
    (index) => JSON.parse(lines[index].slice('    text: '.length)) as string,
  );
  assert.equal(
    lines[firstEmailValue],
    `    text: ${JSON.stringify('^qa\\+ios\\[regex\\]\\.test@example\\.com$')}`,
  );
  assert.equal(lines[secondEmailValue], lines[firstEmailValue]);
  for (const generatedEmailPattern of generatedEmailPatterns) {
    const exactEmailPattern = new RegExp(generatedEmailPattern);
    assert.equal(exactEmailPattern.test(email), true);
    assert.equal(exactEmailPattern.test('qa+ios[regex].testX@example.com'), false);
    assert.equal(exactEmailPattern.test('qaXios[regex].test@example.com'), false);
  }
  assert.ok(
    secondEmailValue < hideKeyboard && hideKeyboard < submitVisible && submitVisible < submitTap,
  );
  assert.equal(lines.filter((line) => line === '- tapOn:').length, 3);
  assert.equal(lines[submitTap + 1], '    id: auth.signIn.submitButton');
  assert.equal(lines[submitTap + 2], undefined);
  assert.equal(
    lines.slice(passwordInput, hideKeyboard).some((line) => line.startsWith('    value: ')),
    false,
  );
  assert.equal(lines.includes('    retryTapIfNoChange: true', submitTap), false);
  assert.equal(build(email, password).includes('eraseText'), false);
});

void test('iOS connection account navigation keeps the switch on normal UI boundaries', async () => {
  const { buildIosConnectionAccountSwitchActions: build } =
    await import('../../scripts/testing/capture-native-testability');
  const actions = build('- tapOn:\n    id: student.professionals.backButton');
  assert.match(actions, /student\.professionals\.backButton/);
  assert.match(actions, /tabs\.account/);
  assert.ok(actions.indexOf('student.professionals.backButton') < actions.indexOf('tabs.account'));
  for (const bypass of ['launchApp', 'runScript', 'openLink', 'clearState'])
    assert.throws(
      () => build(`- ${bypass}: anything`),
      /Invalid iOS connection account back actions/,
    );
  assert.throws(() => build(null as never), /Invalid iOS connection account back actions/);
});

void test('iOS connection sign-in evidence is unique and belongs to the current switch', async () => {
  const { requireIosConnectionSignInBoundary: requireBoundary } =
    await import('../../scripts/testing/capture-native-testability');
  const pathHash = (route: string) => createHash('sha256').update(route).digest('hex');
  const row = (requestId: number, status = 201) => ({
    requestId,
    method: 'POST',
    pathHash: pathHash('/auth/email/sign-in'),
    requestOrigin: null,
    requestProfile: 'native' as const,
    targetOrigin: 'http://127.0.0.1:1',
    status,
    outcome: 'forwarded' as const,
    faultAttemptId: null,
    elapsedMs: 1,
  });
  const result = requireBoundary([row(2, 201), row(5, 400)], 1);
  assert.deepEqual(result, { beforeRequestId: 1, authRequestId: 2, afterRequestId: 5 });
  assert.throws(() => requireBoundary([row(2, 201), row(3, 201)], 1), /one new native sign-in/);
  assert.throws(() => requireBoundary([row(1, 201)], 1), /one new native sign-in/);
  assert.throws(() => requireBoundary([row(0, 201)], -1), /Invalid iOS connection sign-in/);
});

void test('iOS connection actor identity binds the new sign-in to the owned API', async () => {
  const { requireIosConnectionActorIdentity: requireIdentity } =
    await import('../../scripts/testing/capture-native-testability');
  const expected = {
    actorAuthUid: 'coach-auth-uid',
    authRequestId: 7,
    apiIdentity: { apiPid: 42, targetOrigin: 'http://127.0.0.1:43123' },
    fixtureAuthUids: ['coach-auth-uid', 'student-auth-uid'],
  };
  const fixtureAuthUidAllowlistHash = createHash('sha256')
    .update(JSON.stringify([...expected.fixtureAuthUids].sort()))
    .digest('hex');
  const identity = {
    requestId: 7,
    ordinal: 1,
    authUid: 'coach-auth-uid',
    status: 201,
    verification: 'verified' as const,
    verificationReason: 'verified' as const,
    fixtureAuthUidAllowlistHash,
    apiPid: 42,
    targetOrigin: 'http://127.0.0.1:43123',
  };
  assert.equal(requireIdentity([identity], expected), 'coach-auth-uid');
  for (const changed of [
    { ...identity, requestId: 6 },
    { ...identity, authUid: 'student-auth-uid' },
    { ...identity, status: 200 },
    { ...identity, verification: 'unverified' as const },
    { ...identity, verificationReason: 'status-not-201' as const },
    { ...identity, fixtureAuthUidAllowlistHash: '1'.repeat(64) },
    { ...identity, apiPid: 43 },
    { ...identity, targetOrigin: 'http://127.0.0.1:43124' },
  ])
    assert.throws(
      () => requireIdentity([changed], expected),
      /one verified owned actor identity|request identity|malformed/,
    );
  assert.throws(
    () => requireIdentity([identity, identity], expected),
    /not unique|malformed|one verified owned actor identity/,
  );
  assert.throws(
    () =>
      requireIdentity(
        [
          { ...identity, ordinal: 2 },
          { ...identity, requestId: 8, ordinal: 2 },
        ],
        expected,
      ),
    /malformed/,
  );
});

void test('iOS connection backend provenance binds the API origin, process row, and first attempt', async () => {
  const { buildIosConnectionBackendProvenance: build } =
    await import('../../scripts/testing/capture-native-testability');
  const input = {
    runId: 'a'.repeat(24),
    apiOrigin: 'http://127.0.0.1:43123',
    apiPid: 42,
    processes: [
      {
        role: 'orchestrator',
        pid: 41,
        started: 'Wed Oct 01 12:00:00 2026',
        script: '/server/scripts/testing/run-session.ts',
      },
      {
        role: 'api',
        pid: 42,
        started: 'Wed Oct 01 12:00:01 2026',
        script: '/server/scripts/testing/serve.ts',
      },
    ],
  } as const;
  assert.deepEqual(build(input), {
    backendAttemptId: `${input.runId}:first`,
    apiOrigin: input.apiOrigin,
    apiProcess: {
      pid: 42,
      started: 'Wed Oct 01 12:00:01 2026',
      script: '/server/scripts/testing/serve.ts',
    },
  });
  assert.deepEqual(input.processes[1], {
    role: 'api',
    pid: 42,
    started: 'Wed Oct 01 12:00:01 2026',
    script: '/server/scripts/testing/serve.ts',
  });
  for (const changed of [
    { ...input, runId: 'short' },
    { ...input, apiOrigin: '' },
    { ...input, apiPid: 43 },
    {
      ...input,
      processes: input.processes.filter((row) => row.role !== 'api'),
    },
    {
      ...input,
      processes: [...input.processes, { ...input.processes[1], pid: 43 }],
    },
    {
      ...input,
      processes: input.processes.map((row) => (row.role === 'api' ? { ...row, started: '' } : row)),
    },
    {
      ...input,
      processes: input.processes.map((row) => (row.role === 'api' ? { ...row, script: '' } : row)),
    },
  ])
    assert.throws(() => build(changed), /Connection backend/);
});

void test('iOS credential action builder rejects generic invalid inputs without exposing values', async () => {
  const { buildIosCredentialEntryActions: build } =
    await import('../../scripts/testing/capture-native-testability');
  for (const [email, password] of [
    [undefined, 'private-test-password'],
    ['', 'private-test-password'],
    ['   ', 'private-test-password'],
    ['qa@example.com', undefined],
    ['qa@example.com', ''],
    ['qa@example.com', '   '],
  ]) {
    assert.throws(
      () => build(email, password),
      (error: unknown) => error instanceof Error && error.message === 'Invalid credential input',
    );
  }
});

void test('iOS password offer dismissal requires exact visibility and removal before the home marker', async () => {
  const { buildIosPasswordOfferDismissalActions: build } =
    await import('../../scripts/testing/capture-native-testability');
  const lines = build().split('\n');
  const textSelectors = lines
    .filter((line) => line.trimStart().startsWith('text: '))
    .map((line) => JSON.parse(line.trimStart().slice('text: '.length)) as string);
  assert.deepEqual(textSelectors, ['^Save Password\\?$', '^Not Now$', '^Save Password\\?$']);
  const promptPattern = new RegExp(textSelectors[0]);
  const dismissPattern = new RegExp(textSelectors[1]);
  assert.equal(promptPattern.test('Save Password?'), true);
  assert.equal(promptPattern.test(' Save Password?'), false);
  assert.equal(promptPattern.test('Save Password'), false);
  assert.equal(promptPattern.test('Save Password??'), false);
  assert.equal(dismissPattern.test('Not Now'), true);
  assert.equal(dismissPattern.test('Not Now!'), false);
  assert.deepEqual(lines, [
    '- extendedWaitUntil:',
    '    visible:',
    '      text: "^Save Password\\\\?$"',
    '    timeout: 30000',
    '- waitForAnimationToEnd:',
    '    timeout: 5000',
    '- tapOn:',
    '    text: "^Not Now$"',
    '    retryTapIfNoChange: true',
    '    waitToSettleTimeoutMs: 5000',
    '- extendedWaitUntil:',
    '    notVisible:',
    '      text: "^Save Password\\\\?$"',
    '    timeout: 30000',
  ]);
  assert.equal(lines.filter((line) => line === '- tapOn:').length, 1);
  assert.equal(
    lines.some((line) => line.includes('inputText')),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes('password')),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes('eraseText')),
    false,
  );
  assert.ok(lines.indexOf('    visible:') < lines.indexOf('- tapOn:'));
  assert.ok(lines.indexOf('- tapOn:') < lines.indexOf('    notVisible:'));
});

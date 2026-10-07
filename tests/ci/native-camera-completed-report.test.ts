import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  cp,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import * as vm from 'node:vm';
import * as TypeScript from 'typescript';
import {
  buildCallerOutputRootBindingReceipt,
  buildCallerOutputRootBindingSidecar,
  requireIosConnectionSignInBoundary,
  type IosCameraRuntimeContext,
  type OwnedIosNativeSessionOptions,
} from '../../scripts/testing/capture-native-testability';
import {
  captureIosCameraPreludeBoundary,
  observeIosCameraDeniedManualSubmit,
  observeIosCameraDenial,
} from '../../scripts/testing/native-camera-observation';
import { validateIosCameraSubmissionPreparation } from '../../scripts/testing/native-camera-submission-evidence';
import {
  fixtureDocument,
  fixtureRoot,
  isolationFixtureDocument,
  domainSnapshot,
  pendingSnapshot,
  snapshot,
} from '../../scripts/testing/native-camera-submission-evidence.test';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';
import {
  runIosCameraAttemptForPublicDispatch,
  stageCameraPublicEvidence,
} from '../../scripts/testing/run-native-pilot';
import type { ProxyObservation } from '../../scripts/testing/owned-api-proxy';

const configuredRepository: unknown = (process.env as Record<string, unknown>)
  .MYCHAMPIONS_QUALIFIED_ROOT;
const repository = typeof configuredRepository === 'string' ? configuredRepository : process.cwd();
const captureSourcePath = path.resolve(
  __dirname,
  '../../scripts/testing/capture-native-testability.ts',
);
const targetOrigin = 'http://127.0.0.1:19001';
const backendRunId = 'a'.repeat(24);
const captureRunId = 'b'.repeat(24);
const requestedRunId = 'c'.repeat(24);

function sha(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceObjectExpression(
  predicate: (node: TypeScript.Node, sourceFile: TypeScript.SourceFile) => boolean,
): string {
  const source = readFileSync(captureSourcePath, 'utf8');
  const sourceFile = TypeScript.createSourceFile(
    captureSourcePath,
    source,
    TypeScript.ScriptTarget.Latest,
    true,
  );
  let found: string | undefined;
  const visit = (node: TypeScript.Node) => {
    if (predicate(node, sourceFile)) {
      const candidate = TypeScript.isObjectLiteralExpression(node)
        ? node
        : TypeScript.isBinaryExpression(node) && TypeScript.isObjectLiteralExpression(node.right)
          ? node.right
          : TypeScript.isCallExpression(node) &&
              TypeScript.isObjectLiteralExpression(node.arguments[0])
            ? node.arguments[0]
            : undefined;
      assert(candidate, 'production expression predicate did not select an object literal');
      found = candidate.getText(sourceFile);
    }
    TypeScript.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert(found, 'actual camera production object expression was not found');
  return found;
}

function sourceAssignmentRhs(leftName: string): string {
  const source = readFileSync(captureSourcePath, 'utf8');
  const sourceFile = TypeScript.createSourceFile(
    captureSourcePath,
    source,
    TypeScript.ScriptTarget.Latest,
    true,
  );
  let found: string | undefined;
  const visit = (node: TypeScript.Node) => {
    if (
      TypeScript.isBinaryExpression(node) &&
      node.operatorToken.kind === TypeScript.SyntaxKind.EqualsToken &&
      node.left.getText(sourceFile) === leftName
    )
      found = node.right.getText(sourceFile);
    TypeScript.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert(found, `actual camera assignment ${leftName} was not found`);
  return found;
}

function evalExpression(expression: string, values: Record<string, unknown>): unknown {
  const output = TypeScript.transpileModule(`(${expression})`, {
    compilerOptions: {
      target: TypeScript.ScriptTarget.ES2022,
      module: TypeScript.ModuleKind.None,
    },
  }).outputText;
  return vm.runInNewContext(output, { ...values, JSON, Buffer }, { timeout: 2_000 });
}

async function removeExisting(root: string, names: readonly string[]): Promise<void> {
  await Promise.all(names.map((name) => rm(path.join(root, name), { force: true })));
}

async function writeJson(root: string, relative: string, value: unknown): Promise<void> {
  await writeFile(path.join(root, relative), JSON.stringify(value), { mode: 0o600 });
}

function observation(
  requestId: number,
  method: string,
  route: string,
  status: number,
): ProxyObservation {
  return {
    requestId,
    method,
    pathHash: sha(route),
    requestOrigin: null,
    requestProfile: 'native',
    targetOrigin,
    status,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 5,
  } as ProxyObservation;
}

async function completedReportGate(
  options: {
    injectLateMutation?: boolean;
    onFixtureParent?: (parent: string) => void;
  } = {},
): Promise<{
  parent: string;
  captureRoot: string;
  outputRoot: string;
  selection: NativePilotSelection;
}> {
  const inventory = JSON.parse(
    await readFile(path.join(repository, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as {
    scenarios: NativePilotSelection['scenario'][];
    sources: { paths: string[]; revision: string }[];
  };
  for (const source of inventory.sources)
    if (source.paths.length === 1)
      source.revision = sha(await readFile(path.join(repository, source.paths[0])));
  const selection = await selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-camera-denied-ios', mode: 'integration' },
    inventory,
    repository,
  );
  const fixture = await fixtureRoot();
  options.onFixtureParent?.(fixture.parent);
  const outputRoot = path.join(fixture.parent, requestedRunId);
  await mkdir(outputRoot, { mode: 0o700 });
  await chmod(outputRoot, 0o700);
  const templatePng = await readFile(path.join(fixture.root, 'camera-prompt.png'));
  const templateFiles = new Map<string, Buffer>();
  for (const name of [
    'camera-prompt-hierarchy.json',
    'camera-guidance-hierarchy.json',
    'camera-manual-hierarchy.json',
    'camera-pending-hierarchy.json',
    'camera-coach-invite-hierarchy.json',
    'camera-live-manual-submit.yaml',
    'camera-prompt.png',
    'camera-guidance.png',
    'camera-manual.png',
    'camera-pending.png',
    'camera-coach-invite.png',
  ])
    templateFiles.set(name, await readFile(path.join(fixture.root, name)));
  await removeExisting(fixture.root, [
    'camera-runtime-metadata.private.json',
    'camera-runtime-adapter.private.json',
    'camera-before.private.json',
    'camera-after.private.json',
    'camera-permission-before.private.json',
    'camera-permission-after.private.json',
    'camera-prompt-hierarchy.json',
    'camera-prompt.png',
    'camera-guidance-hierarchy.json',
    'camera-guidance.png',
    'camera-manual-hierarchy.json',
    'camera-manual.png',
    'camera-connection-before.private.json',
    'camera-connection-pending.private.json',
    'camera-pending-card.private.json',
    'camera-isolation-before.private.json',
    'camera-isolation-after.private.json',
    'camera-training-before.private.json',
    'camera-training-after.private.json',
    'camera-live-manual-submit.yaml',
    'camera-pending-hierarchy.json',
    'camera-pending.png',
    'camera-coach-invite-hierarchy.json',
    'camera-coach-invite.png',
    'camera-coach-invite-code.private.json',
  ]);
  const deadlineAt = performance.now() + 120_000;
  const controller = new AbortController();
  const observations: ProxyObservation[] = [
    observation(2, 'POST', '/analytics/events', 202),
    observation(1, 'POST', '/analytics/events', 202),
  ];
  let proxyFence = 2;
  let lateMutationInjected = false;
  const appendObservation = (row: ProxyObservation): void => {
    observations.push(row);
    proxyFence = Math.max(proxyFence, row.requestId);
  };
  const proxy = {
    get observations() {
      return observations;
    },
    get requestIdFence() {
      return proxyFence;
    },
    waitForQuiescence: async () => {
      if (options.injectLateMutation && !lateMutationInjected) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        appendObservation(observation(5, 'POST', '/analytics/events', 202));
        lateMutationInjected = true;
      }
    },
  };

  // Execute the exact production fence assignment and auth report object.
  const beforeFence = evalExpression(sourceAssignmentRhs('cameraInitialAuthBeforeRequestId'), {
    proxy,
  }) as number;
  assert.equal(beforeFence, 2);
  appendObservation(observation(3, 'POST', '/auth/email/sign-in', 201));
  const studentBoundary = requireIosConnectionSignInBoundary(observations, beforeFence);
  const initialAuthExpression = sourceObjectExpression(
    (node, sourceFile) =>
      TypeScript.isBinaryExpression(node) &&
      node.left.getText(sourceFile) === 'report.cameraInitialAuth' &&
      TypeScript.isObjectLiteralExpression(node.right),
  );
  const reportPath = path.join(fixture.root, 'capture.private.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
  const outputStats = await stat(outputRoot);
  const binding = {
    path: path.resolve(outputRoot),
    identity: {
      dev: outputStats.dev,
      ino: outputStats.ino,
      mode: outputStats.mode & 0o777,
      uid: outputStats.uid,
      nlink: outputStats.nlink,
    },
  };
  Object.assign(
    report,
    buildCallerOutputRootBindingReceipt({
      requestedRunId,
      captureRunId,
      binding,
      deadlineAtMonotonicMs: deadlineAt,
    }),
  );
  report.requestedRunId = requestedRunId;
  report.captureRunId = captureRunId;
  report.captureRoot = fixture.root;
  report.result = 'observed';
  report.cleanup = 'cleaned';
  report.nativePassingCases = 0;
  report.build = {
    apiOrigin: 'http://127.0.0.1:19000',
    metroOrigin: 'http://127.0.0.1:19002',
    environmentHash: 'e'.repeat(64),
  };
  report.backend = {
    runId: backendRunId,
    backendAttemptId: `${backendRunId}:first`,
    apiOrigin: targetOrigin,
    apiProcess: { pid: 1234, started: 'owned-api-start', script: 'server-api' },
    processes: [{ role: 'api', pid: 1234, started: 'owned-api-start', script: 'server-api' }],
  };
  report.connectionApiIdentity = { apiPid: 1234, targetOrigin };
  report.budget = { callerDeadlineAtMonotonicMs: deadlineAt, callerOutputRootBinding: binding };
  report.timingsMs = { build: 0, install: 0, reset: 0, scenario: 0, verify: 0, cleanup: 0 };
  report.commandExecutions = (
    Array.isArray(report.commandExecutions) ? report.commandExecutions : []
  ).map((value) => ({
    ...(value as Record<string, unknown>),
    censusFailure: null,
    outputFailure: null,
  }));
  assert((report.commandExecutions as unknown[]).length > 0);
  report.cameraInitialAuth = evalExpression(initialAuthExpression, {
    studentAuthUid: 'auth-student',
    studentBoundary,
  });
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeJson(
    fixture.root,
    'caller-output-root-binding.private.json',
    buildCallerOutputRootBindingSidecar({
      requestedRunId,
      captureRunId,
      binding,
      deadlineAtMonotonicMs: deadlineAt,
    }),
  );

  const marker = captureIosCameraPreludeBoundary(observations, proxy.requestIdFence);
  const observerExpression = sourceObjectExpression(
    (node, sourceFile) =>
      TypeScript.isCallExpression(node) &&
      node.expression.getText(sourceFile) === 'observeIosCameraDenial' &&
      node.arguments.length === 1 &&
      TypeScript.isObjectLiteralExpression(node.arguments[0]),
  );
  const observe = async (label: string): Promise<void> => {
    if (label === 'camera-relationships')
      appendObservation(observation(4, 'GET', '/connections', 200));
    const hierarchy = templateFiles.get(`${label}-hierarchy.json`) ?? Buffer.from('{}');
    await writeFile(path.join(fixture.root, `${label}-hierarchy.json`), hierarchy, { mode: 0o600 });
    await writeFile(path.join(fixture.root, `${label}.png`), templatePng, { mode: 0o600 });
  };
  const denialArgs = evalExpression(observerExpression, {
    output: fixture.root,
    report,
    studentAuthUid: 'auth-student',
    displayName: 'MyChampions',
    device: { udid: 'ios-owned-device' },
    bundleId: 'com.edufelip.mychampions.dev',
    session: { snapshot: () => Promise.resolve(domainSnapshot()) },
    activeProxy: proxy,
    controller,
    cameraObserver: observe,
    credentials: { authUid: 'auth-student' },
    cameraInitialAuthAfterRequestId: (report.cameraInitialAuth as Record<string, number>)
      .afterRequestId,
    cameraPrelude: marker,
  }) as Record<string, unknown>;
  denialArgs.permission = () => {
    const permissionReads = ((denialArgs.__permissionReads as number | undefined | null) ?? 0) + 1;
    denialArgs.__permissionReads = permissionReads;
    return Promise.resolve({
      source: 'owned-simulator-tcc-read-only',
      deviceUdid: 'ios-owned-device',
      bundleId: 'com.edufelip.mychampions.dev',
      rows:
        permissionReads === 1
          ? []
          : [
              {
                service: 'kTCCServiceCamera',
                client: 'com.edufelip.mychampions.dev',
                client_type: 0,
                auth_value: 0,
                auth_reason: 1,
              },
            ],
    });
  };
  denialArgs.snapshot = () => Promise.resolve(domainSnapshot());
  denialArgs.observations = () => observations;
  denialArgs.observe = observe;
  denialArgs.waitForQuiescence = proxy.waitForQuiescence;
  denialArgs.requestIdFence = () => proxy.requestIdFence;
  denialArgs.signal = controller.signal;
  delete denialArgs.__permissionReads;
  await observeIosCameraDenial(denialArgs as never);
  if (!options.injectLateMutation)
    assert.deepEqual(
      (report.cameraPreparation as Record<string, unknown>).transportRequestIds,
      [4],
    );
  assert.equal(
    (report.cameraPreparation as Record<string, unknown>).transportEndObservationCount,
    options.injectLateMutation ? 5 : 4,
  );
  assert.equal(
    (report.cameraPreparation as Record<string, unknown>).transportPreludeObservationCount,
    3,
  );
  assert.equal(observations.length, options.injectLateMutation ? 5 : 4);

  const beforeDomain = domainSnapshot();
  const afterDomain = {
    ...beforeDomain,
    connections: [
      beforeDomain.connections[0],
      {
        id: 'connection-1',
        professionalAuthUid: 'auth-coach',
        studentAuthUid: 'auth-student',
        status: 'pending_confirmation',
        specialty: 'fitness_coach',
        canceledReason: null,
        sourceInviteCodeId: 'invite-fitness',
        sourceInviteCodeValue: 'AB12CD34',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        endedAt: null,
      },
      beforeDomain.connections[1],
    ],
  };
  const templateYaml = templateFiles.get('camera-live-manual-submit.yaml');
  assert(templateYaml);
  let connectionCalls = 0;
  let trainingCalls = 0;
  let switches = 0;
  const manualObserve = async (label: string): Promise<void> => {
    if (label === 'camera-coach-invite' || label === 'camera-pending') {
      const hierarchy = templateFiles.get(`${label}-hierarchy.json`);
      assert(hierarchy);
      await writeFile(path.join(fixture.root, `${label}-hierarchy.json`), hierarchy, {
        mode: 0o600,
      });
      await writeFile(path.join(fixture.root, `${label}.png`), templatePng, { mode: 0o600 });
    }
    if (label === 'camera-live-manual-submit') {
      appendObservation(observation(12, 'POST', '/connections/invite-submissions', 201));
      await writeFile(path.join(fixture.root, 'camera-live-manual-submit.yaml'), templateYaml, {
        mode: 0o600,
      });
    }
  };
  const switchAccount = (actor: 'coach' | 'student') => {
    switches += 1;
    const requestId = actor === 'coach' ? 6 : 9;
    const before = actor === 'coach' ? 4 : 6;
    appendObservation(observation(requestId, 'POST', '/auth/email/sign-in', 201));
    const boundary = requireIosConnectionSignInBoundary(observations, before);
    return Promise.resolve({
      actor,
      actorAuthUid: actor === 'coach' ? 'auth-coach' : 'auth-student',
      ...boundary,
    });
  };
  const context = {
    output: fixture.root,
    fixtures: fixtureDocument(),
    connectionIsolationFixtures: isolationFixtureDocument(),
    commandExecutions: (report.commandExecutions ?? []) as never,
    proxy,
    apiIdentity: { apiPid: 1234, targetOrigin },
    observe: manualObserve,
    snapshot: () => {
      trainingCalls += 1;
      return Promise.resolve((trainingCalls >= 2 ? afterDomain : beforeDomain) as never);
    },
    connectionSnapshot: () => {
      connectionCalls += 1;
      return Promise.resolve((connectionCalls >= 3 ? pendingSnapshot() : snapshot()) as never);
    },
    isolationSnapshot: () => Promise.resolve(snapshot('native-connection-isolation-ios')),
    report,
    switchAccount,
    displayName: 'MyChampions',
    signal: controller.signal,
    permission: () =>
      Promise.resolve({
        source: 'owned-simulator-tcc-read-only',
        deviceUdid: 'ios-owned-device',
        bundleId: 'com.edufelip.mychampions.dev',
        rows: [],
      }),
  } as unknown as IosCameraRuntimeContext;
  const runOwned = async (options: OwnedIosNativeSessionOptions) => {
    assert.equal(options.requestedRunId, requestedRunId);
    assert.equal(options.callerOutputRoot, outputRoot);
    assert.equal(options.deadlineAtMonotonicMs, deadlineAt);
    assert.equal(options.credentialInteractionDiagnostic, true);
    assert(options.executeCamera);
    await options.executeCamera(context);
    assert.equal(switches, 2);
    const transportBytes = Buffer.from(JSON.stringify(observations));
    const authRows = [3, 6, 9].map((requestId, index) => ({
      requestId,
      ordinal: index + 1,
      targetOrigin,
      apiPid: 1234,
      status: 201,
      authUid: ['auth-student', 'auth-coach', 'auth-student'][index],
      verification: 'verified',
      verificationReason: 'verified',
      fixtureAuthUidAllowlistHash: sha(
        JSON.stringify(
          [
            'auth-coach',
            'auth-new',
            'auth-pending',
            'auth-active',
            'auth-student',
            'auth-unrelated-coach',
            'auth-unrelated-student',
          ].sort(),
        ),
      ),
    }));
    await writeJson(fixture.root, 'transport-observations.private.json', observations);
    await writeJson(fixture.root, 'native-auth-identities.private.json', authRows);
    const finalReport = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    finalReport.cameraInitialAuth = report.cameraInitialAuth;
    finalReport.cameraPreparation = report.cameraPreparation;
    finalReport.cameraSubmissionPreparation = report.cameraSubmissionPreparation;
    finalReport.transportEvidence = {
      path: 'transport-observations.private.json',
      bytes: transportBytes.length,
      sha256: sha(transportBytes),
      source: 'owned-api-proxy.observations',
      runId: backendRunId,
      scope: 'native-entry-ios',
    };
    const authBytes = Buffer.from(JSON.stringify(authRows));
    finalReport.nativeAuthIdentityEvidence = {
      path: 'native-auth-identities.private.json',
      bytes: authBytes.length,
      sha256: sha(authBytes),
      source: 'owned-api-proxy.nativeAuthIdentities',
      runId: backendRunId,
      scope: 'native-entry-ios',
    };
    await writeFile(reportPath, JSON.stringify(finalReport, null, 2), { mode: 0o600 });
    return { artifactRoot: fixture.root, exitCode: 0, report: finalReport };
  };
  const attempt = await runIosCameraAttemptForPublicDispatch({
    repositoryRoot: repository,
    requestedRunId,
    selection,
    signal: controller.signal,
    outputRoot,
    deadlineAt,
    credentialInteractionDiagnostic: true,
    dependencies: {
      // The selection above is validated against a private inventory whose source
      // revisions are rebound to this candidate overlay. Reuse that exact
      // selected object for the production runner seam; otherwise the runner
      // re-reads Q's intentionally stale inventory and rejects before acquisition.
      selectNativePilotScenario: (...args: Parameters<typeof selectNativePilotScenario>) => {
        assert.equal(args[2], repository);
        return Promise.resolve(selection);
      },
      runOwnedIosNativeSession: runOwned as never,
      observeIosCameraDeniedManualSubmit,
      validateIosCameraSubmissionPreparation,
      verifyOwnedIosCleanup: () => Promise.resolve({ result: 'passed' }) as never,
    },
  });
  if (options.injectLateMutation) {
    assert.equal(attempt.verificationResult, 'failed');
    throw new Error('undeclared mutation observed inside the drained denial window');
  }
  assert.equal(attempt.verificationResult, 'passed');
  assert.equal(attempt.stagedManifestPath, null);
  const staged = await stageCameraPublicEvidence({
    captureRoot: fixture.root,
    outputRoot,
    requestedRunId,
    captureRunId,
    fixtureRunId: backendRunId,
    selection,
  });
  assert.equal(staged.assertions.length, 4);
  await assert.rejects(
    () =>
      stageCameraPublicEvidence({
        captureRoot: fixture.root,
        outputRoot,
        requestedRunId,
        captureRunId,
        fixtureRunId: backendRunId,
        selection,
      }),
    /destination|exists|exclusive|already/i,
  );
  return { parent: fixture.parent, captureRoot: fixture.root, outputRoot, selection };
}

async function expectSerializedRejected(
  captureRoot: string,
  mutate: (report: Record<string, unknown>, rows: ProxyObservation[]) => void,
  expected: RegExp,
): Promise<void> {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-camera-completed-negative-')),
  );
  const root = path.join(parent, captureRunId);
  await cp(captureRoot, root, { recursive: true });
  const reportPath = path.join(root, 'capture.private.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
  const rows = JSON.parse(
    await readFile(path.join(root, 'transport-observations.private.json'), 'utf8'),
  ) as ProxyObservation[];
  mutate(report, rows);
  report.captureRoot = root;
  if (Array.isArray(report.commandExecutions))
    report.commandExecutions = (report.commandExecutions as Record<string, unknown>[]).map(
      (entry) => {
        const argv = entry.argv;
        if (!Array.isArray(argv)) return { ...entry, argv };
        const argvValues = argv as unknown[];
        return {
          ...entry,
          argv: [
            ...argvValues.slice(0, -1),
            path.join(root, path.basename(String(argvValues.at(-1)))),
          ],
        };
      },
    );
  const bytes = Buffer.from(JSON.stringify(rows));
  const evidence = report.transportEvidence as Record<string, unknown>;
  report.transportEvidence = { ...evidence, bytes: bytes.length, sha256: sha(bytes) };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeFile(path.join(root, 'transport-observations.private.json'), bytes, { mode: 0o600 });
  try {
    assert.throws(
      () =>
        validateIosCameraSubmissionPreparation({
          root,
          backendRunId,
          targetOrigin,
          preparation: report.cameraSubmissionPreparation as never,
          transport: rows,
          captureKind: 'private-owned-native-camera-execution-not-public-receipt',
          captureMode: 'integration',
        }),
      expected,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

void test('camera completed report runs production capture statements, terminal publication, and protected staging once', async () => {
  const result = await completedReportGate();
  const capture = result.captureRoot;
  await expectSerializedRejected(
    capture,
    (report) => {
      delete (report.cameraPreparation as Record<string, unknown>).transportPreludeMarkerSource;
    },
    /boundary metadata|complete raw prefix|marker/i,
  );
  await expectSerializedRejected(
    capture,
    (report) => {
      (
        report.cameraPreparation as Record<string, unknown>
      ).transportPreludeObservationPrefixSha256 = sha('forged-prefix');
    },
    /complete raw prefix|marker/i,
  );
  await expectSerializedRejected(
    capture,
    (_report, rows) => {
      rows.pop();
    },
    /complete raw prefix|marker|transport|stale|source/i,
  );
  await expectSerializedRejected(
    capture,
    (report, rows) => {
      rows.splice(4, 0, observation(5, 'POST', '/analytics/events', 202));
      const prep = report.cameraPreparation as Record<string, unknown>;
      prep.transportEndRequestId = 5;
      prep.transportEndObservationCount = 5;
      prep.transportEndObservationPrefixSha256 = sha(
        JSON.stringify(rows.filter((row) => row.requestId <= 5)),
      );
      prep.transportRequestIds = [4, 5];
    },
    /undeclared mutation|boundary/i,
  );
  await expectSerializedRejected(
    capture,
    (report) => {
      (report.cameraInitialAuth as Record<string, unknown>).afterRequestId = 99;
    },
    /authenticated student|initial auth|boundary/i,
  );
  await rm(result.parent, { recursive: true, force: true });
});

void test('camera denial observer drains late transport before publishing the end fence', async () => {
  let parent: string | undefined;
  await assert.rejects(
    () =>
      completedReportGate({
        injectLateMutation: true,
        onFixtureParent: (value) => {
          parent = value;
        },
      }),
    /undeclared mutation|complete quiesced raw snapshot|transport boundary/i,
  );
  assert(parent, 'late-mutation control did not expose its owned fixture parent');
  await rm(parent, { recursive: true, force: true });
});

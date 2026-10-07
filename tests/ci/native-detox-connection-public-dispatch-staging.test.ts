import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { readOwnedDetoxPrivateFile } from '../../scripts/testing/detox-connection-ipc';
import {
  buildDetoxConnectionLedgerFromActualReport,
  createDetoxConnectionProducerReport,
} from '../../scripts/testing/detox-integrated-connection-driver';
import { detoxSessionHelperClosure } from '../../scripts/testing/detox-integrated-session-baseline';
import {
  applyDetoxElementAttributeEvidence,
  parseDetoxViewHierarchyXml,
} from '../../scripts/testing/detox-native-hierarchy';
import {
  DETOX_IOS_CONNECTION_PUBLIC_OWNER,
  type DetoxIosConnectionPublicBridgeResult,
} from '../../scripts/testing/native-detox-connection-public-bridge';
import {
  iosDetoxConnectionExecutionAdapter,
  requireIosDetoxConnectionPublicSelection,
  retainIosDetoxConnectionPartialAttempt,
  runIosDetoxConnectionPublicAttempt,
} from '../../scripts/testing/native-detox-connection-public-dispatch';
import {
  stageIosDetoxConnectionPublicEvidence,
  verifyStagedIosDetoxConnectionPublicEvidence,
  type DetoxIosConnectionPublicStagingLifecycle,
} from '../../scripts/testing/native-detox-connection-public-staging';
import { nativeConnectionAssertionIds } from '../../scripts/testing/native-pilot-contract';
import type { DetoxConnectionAttemptResult } from '../../scripts/testing/detox-integrated-connection-baseline';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const hashBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const hashJson = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
          .join(',')}}`
      : JSON.stringify(value);

const fixtureChild = {
  pid: process.pid,
  pgid: process.pid,
  started: 'fixture-child-start',
} as const;
const apiPid = process.pid;
const backendRunId = 'fedcba987654321001234567';
const proxyOrigin = 'http://127.0.0.1:8082';
const backendOrigin = 'http://127.0.0.1:8083';

function lifecycle(
  controller = new AbortController(),
  extraMs = 60_000,
): DetoxIosConnectionPublicStagingLifecycle {
  return { signal: controller.signal, deadlineAtMonotonicMs: performance.now() + extraMs };
}

type MutableScreenshotObservation = {
  label: string;
  screenshotFile: string;
  screenshotSha256: string;
  sourceReceipts: {
    screenshot: {
      sourceBytes: number;
      sourceSha256: string;
      sourcePath: string;
      sourceRealpath: string;
      capturedCopyFile: string;
      capturedCopyBytes: number;
      capturedCopySha256: string;
    };
  };
};

type MutableScreenshotReport = {
  detoxConnectionObservations: MutableScreenshotObservation[];
};

function loadSelection(): NativePilotSelection {
  const inventory = readFileSync(
    path.resolve(process.cwd(), 'docs/qa/native-pilot/inventory.json'),
    'utf8',
  );
  const parsed = JSON.parse(inventory) as { scenarios: Record<string, unknown>[] };
  const scenario = structuredClone(parsed.scenarios.find((row) => row.id === 'SCN-connection-ios'));
  assert(scenario);
  return {
    arguments: {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-connection-ios',
      mode: 'integration',
    },
    scenario: scenario as NativePilotSelection['scenario'],
    scenarioHash: '1'.repeat(64),
    requirementHash: '2'.repeat(64),
  };
}

const selection = loadSelection();
const build = (repositoryRoot: string) => ({
  platform: 'ios' as const,
  configuration: 'ios.sim.debug' as const,
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
    variant: 'dev' as const,
    appIdentifier: 'com.edufelip.mychampions.dev',
    apiOrigin: proxyOrigin,
    configSourcePath: path.join(repositoryRoot, 'app.config.ts'),
    configSourceHash: 'f'.repeat(64),
  },
});

function attributes(identifier: string) {
  return {
    identifier,
    enabled: true,
    visible: true,
    hittable: true,
    frame: { x: 0, y: 0, width: 100, height: 40 },
  } as never;
}

async function writeFile0600(file: string, bytes: Buffer | string): Promise<void> {
  await writeFile(file, bytes, { mode: 0o600 });
  await chmod(file, 0o600);
}

async function makeCompleteCapture(parent: string): Promise<{
  captureRoot: string;
  outputRoot: string;
  bridgeResult: DetoxIosConnectionPublicBridgeResult;
  build: ReturnType<typeof build>;
}> {
  const requestedRunId = '0123456789abcdef01234567';
  const captureRoot = path.join(parent, requestedRunId);
  const outputRoot = path.join(parent, 'staged');
  await mkdir(captureRoot, { recursive: true, mode: 0o700 });
  await chmod(captureRoot, 0o700);
  await mkdir(path.join(captureRoot, 'detox-artifacts'), { mode: 0o700 });
  const child = fixtureChild;
  const labels = [
    'connection-coach-invite',
    'connection-normal-coach-pending',
    'connection-normal-coach-roster',
    'connection-student-entry',
    'connection-submit',
    'connection-student-pending',
    'connection-coach-pending-roster',
    'connection-coach-no-active-roster',
    'connection-coach-return-home',
    'connection-coach-pending',
    'connection-confirm',
    'connection-student-active',
    'connection-coach-roster',
  ];
  const commands: Record<string, unknown>[] = [];
  const observations: Record<string, unknown>[] = [];
  for (const [index, label] of labels.entries()) {
    const commandBase = {
      schemaVersion: 1 as const,
      commandId: index + 1,
      kind: 'observe' as const,
      platform: 'ios' as const,
      actor: 'coach' as const,
      navigation: 'none' as const,
      label,
      semanticActions: `writer-backed Detox action ${label}`,
      viewId: 'SCR-pro-home',
      selectors: 'pro.home.screen',
      selectorKind: 'id' as const,
    };
    const command = {
      ...commandBase,
      commandHash: createHash('sha256')
        .update(canonical({ ...commandBase, commandHash: undefined }))
        .digest('hex'),
    };
    const xml = Buffer.from(
      '<ViewHierarchy><View class="View" width="100" height="40" visibility="visible" alpha="1" focused="false" x="0" y="0" id="pro.home.screen" label="owned" /></ViewHierarchy>',
    );
    const screenshot = Buffer.from(validPng);
    const attrs = [attributes('pro.home.screen')];
    const beforeBytes = Buffer.from(JSON.stringify(attrs) + '\n');
    const afterBytes = Buffer.from(JSON.stringify(attrs) + '\n');
    const files = {
      xmlFile: `${label}.private.xml`,
      screenshotFile: `${label}.private.png`,
      attributesBeforeFile: `${label}-attributes-before.private.json`,
      attributesAfterFile: `${label}-attributes-after.private.json`,
    };
    await writeFile0600(path.join(captureRoot, files.xmlFile), xml);
    await writeFile0600(path.join(captureRoot, files.screenshotFile), screenshot);
    await writeFile0600(path.join(captureRoot, files.attributesBeforeFile), beforeBytes);
    await writeFile0600(path.join(captureRoot, files.attributesAfterFile), afterBytes);
    const capturedCopyFile = `${label}-detox-source.private.png`;
    const capturedCopyPath = path.join(captureRoot, capturedCopyFile);
    await writeFile0600(capturedCopyPath, screenshot);
    const capturedCopyMetadata = await lstat(capturedCopyPath);
    const temporaryProducerPath = path.join(
      captureRoot,
      'detox-artifacts',
      `detox-${child.pid}-${String(index).padStart(6, '0')}.detox.png`,
    );
    await writeFile0600(temporaryProducerPath, screenshot);
    const temporaryProducerRealpath = await realpath(temporaryProducerPath);
    const temporaryProducerMetadata = await lstat(temporaryProducerRealpath);
    assert(temporaryProducerMetadata.isFile());
    assert.equal(temporaryProducerMetadata.nlink, 1);
    const sourceReceipt = {
      producer: 'detox.device.takeScreenshot' as const,
      sourceKind: 'file' as const,
      processPid: child.pid,
      processPgid: child.pgid,
      processStarted: child.started,
      sourceBytes: screenshot.byteLength,
      sourceSha256: hashBytes(screenshot),
      sourcePath: temporaryProducerRealpath,
      sourceRealpath: temporaryProducerRealpath,
      producerPath: temporaryProducerRealpath,
      producerRealpath: temporaryProducerRealpath,
      sourceMode: temporaryProducerMetadata.mode & 0o777,
      sourceUid: temporaryProducerMetadata.uid,
      sourceDev: temporaryProducerMetadata.dev,
      sourceIno: temporaryProducerMetadata.ino,
      sourceGid: temporaryProducerMetadata.gid,
      sourceNlink: temporaryProducerMetadata.nlink,
      sourceSnapshotPath: capturedCopyFile,
      sourceSnapshotBytes: capturedCopyMetadata.size,
      sourceSnapshotSha256: hashBytes(screenshot),
      sourceCommandId: command.commandId,
      sourceCommandHash: command.commandHash,
      sourceLabel: command.label,
      capturedCopyFile,
      capturedCopyPath,
      capturedCopyRealpath: capturedCopyPath,
      capturedCopyBytes: capturedCopyMetadata.size,
      capturedCopySha256: hashBytes(screenshot),
      capturedCopyMode: capturedCopyMetadata.mode & 0o777,
      capturedCopyUid: capturedCopyMetadata.uid,
      capturedCopyNlink: capturedCopyMetadata.nlink,
    };
    const observation = {
      schemaVersion: 1 as const,
      kind: 'private-detox-connection-observation' as const,
      commandId: command.commandId,
      commandHash: command.commandHash,
      label,
      actor: 'coach' as const,
      platform: 'ios' as const,
      viewId: command.viewId,
      ...files,
      xmlSha256: hashBytes(xml),
      screenshotSha256: hashBytes(screenshot),
      attributesBeforeSha256: hashBytes(beforeBytes),
      attributesAfterSha256: hashBytes(afterBytes),
      sourceReceipts: {
        xml: {
          producer: 'detox.device.generateViewHierarchyXml' as const,
          sourceKind: 'memory' as const,
          processPid: child.pid,
          processPgid: child.pgid,
          processStarted: child.started,
          sourceBytes: xml.byteLength,
          sourceSha256: hashBytes(xml),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
        screenshot: sourceReceipt,
        attributesBefore: {
          producer: 'detox.element.getAttributes' as const,
          sourceKind: 'memory' as const,
          processPid: child.pid,
          processPgid: child.pgid,
          processStarted: child.started,
          sourceBytes: beforeBytes.byteLength,
          sourceSha256: hashBytes(beforeBytes),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
        attributesAfter: {
          producer: 'detox.element.getAttributes' as const,
          sourceKind: 'memory' as const,
          processPid: child.pid,
          processPgid: child.pgid,
          processStarted: child.started,
          sourceBytes: afterBytes.byteLength,
          sourceSha256: hashBytes(afterBytes),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
      },
      selectors: [
        {
          selector: 'pro.home.screen',
          kind: 'id' as const,
          before: attrs[0],
          after: attrs[0],
          frameStable: true as const,
        },
      ],
      startedMonotonicMs: index + 1,
      finishedMonotonicMs: index + 2,
      actionCompleted: true as const,
      hierarchyCaptured: true as const,
      screenshotCaptured: true as const,
    };
    const tree = parseDetoxViewHierarchyXml(xml.toString('utf8'), 'ios');
    applyDetoxElementAttributeEvidence(tree, attrs);
    await writeFile0600(path.join(captureRoot, `${label}-hierarchy.json`), JSON.stringify(tree));
    await writeFile0600(path.join(captureRoot, `${label}.png`), screenshot);
    commands.push(command);
    observations.push(observation);
    await writeFile0600(
      path.join(captureRoot, `detox-connection-command-${command.commandId}.private.json`),
      `${JSON.stringify(command)}\n`,
    );
    await writeFile0600(
      path.join(captureRoot, `detox-connection-response-${command.commandId}.private.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'private-detox-connection-response',
        commandId: command.commandId,
        commandHash: command.commandHash,
        commandKind: command.kind,
        status: 'completed',
        actor: command.actor,
        platform: command.platform,
        observations: [observation],
        childPid: child.pid,
        childPgid: child.pgid,
        childStarted: child.started,
        startedMonotonicMs: index + 1,
        finishedMonotonicMs: index + 2,
      })}\n`,
    );
  }
  const connectionId = '11111111-1111-1111-1111-111111111111';
  const sourceRows = Array.from({ length: 9 }, (_, index) => ({
    requestId: index + 1,
    method: index === 2 || index === 7 ? 'POST' : 'GET',
    pathHash: hashBytes(
      Buffer.from(
        index === 2
          ? '/connections/invite-submissions'
          : index === 7
            ? `/connections/${connectionId}/confirm`
            : index === 4 || index === 6
              ? '/professional/students'
              : '/connections',
      ),
    ),
    requestOrigin: null,
    requestProfile: 'native' as const,
    targetOrigin: backendOrigin,
    status: index === 2 ? 201 : 200,
    outcome: 'forwarded' as const,
    faultAttemptId: null,
    elapsedMs: 1,
  }));
  const transportFile = 'detox-connection-transport-source.private.json';
  const transportBytes = Buffer.from(JSON.stringify(sourceRows));
  await writeFile0600(path.join(captureRoot, transportFile), transportBytes);
  const snapshots: Record<string, { path: string; sha256: string }> = {};
  const timestamp = '2026-10-02T00:00:00.000Z';
  const validSnapshot = (index: number) => {
    const fixtureAuthUids = ['auth-coach', 'auth-student'].sort();
    const rows = {
      userProfiles: fixtureAuthUids.map((authUid) => ({
        authUid,
        lockedRole: authUid === 'auth-coach' ? 'professional' : 'student',
        acceptedTermsVersion: 'v1',
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      professionalSpecialties: [
        {
          id: 'coach-fitness',
          professionalAuthUid: 'auth-coach',
          specialty: 'fitness_coach',
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      inviteCodes: [
        {
          id: 'invite-fitness',
          professionalAuthUid: 'auth-coach',
          specialty: 'fitness_coach',
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
          rotatedAt: null,
        },
      ],
      connections: [],
      connectionInviteGuards: [],
      pendingStudents: [],
      pendingStudentSlots: [
        {
          id: 'coach_slot-1',
          professionalAuthUid: 'auth-coach',
          slotId: 'slot-1',
          studentAuthUid: null,
          updatedAt: timestamp,
        },
      ],
      trackingAccess: [],
      activeSpecialties: [],
    };
    return {
      schemaVersion: 1,
      kind: 'connection-snapshot-v1',
      runId: backendRunId,
      scope: index === 10 ? 'native-connection-isolation-ios' : 'native-entry-ios',
      readOnly: true,
      fixtureAuthUids,
      target: {
        professionalAuthUid: 'auth-coach',
        studentAuthUid: 'auth-student',
        specialty: 'fitness_coach',
      },
      rowCounts: Object.fromEntries(
        Object.entries(rows).map(([name, values]) => [name, values.length]),
      ),
      rows,
    };
  };
  for (let index = 0; index < 12; index += 1) {
    const bytes = Buffer.from(JSON.stringify(validSnapshot(index)));
    const name = `snapshot-${index}.private.json`;
    await writeFile0600(path.join(captureRoot, name), bytes);
    snapshots[`snapshot-${index}`] = { path: name, sha256: hashBytes(bytes) };
  }
  const windows = [
    ['GET', '/professional/invite-codes/fitness_coach', 200, 0, 1, false],
    ['GET', '/connections', 200, 1, 2, false],
    ['POST', '/connections/invite-submissions', 201, 2, 3, true],
    ['GET', '/connections', 200, 3, 4, false],
    ['GET', '/professional/students', 200, 4, 5, false],
    ['GET', '/connections', 200, 5, 6, false],
    ['GET', '/professional/students', 200, 6, 7, false],
    ['POST', `/connections/${connectionId}/confirm`, 200, 7, 8, true],
    ['GET', '/connections', 200, 8, 9, false],
  ].map(([method, route, status, afterRequestId, throughRequestId, unique]) => ({
    method,
    route,
    status,
    afterRequestId,
    throughRequestId,
    unique,
  }));
  const repositoryRoot = '/qualified/mychampions';
  const selectedBuild = build(repositoryRoot);
  const report = createDetoxConnectionProducerReport({
    platform: 'ios',
    artifactRoot: captureRoot,
    childIdentity: child,
    sourceTreeHash: selectedBuild.source.sourceTreeHash,
    helperInputsHash: selectedBuild.helperInputsHash,
    transportSource: sourceRows,
  });
  report.detoxTransportSourceReceipt = {
    path: transportFile,
    sourceBytes: transportBytes.byteLength,
    sourceSha256: hashBytes(transportBytes),
  };
  report.selection = selection;
  report.backend = {
    runId: backendRunId,
    apiOrigin: backendOrigin,
    apiPid,
    manifestArtifactRoot: captureRoot,
  };
  report.connectionApiIdentity = { targetOrigin: backendOrigin, apiPid };
  report.build = {
    platform: selectedBuild.platform,
    configuration: selectedBuild.configuration,
    binaryHash: selectedBuild.binaryHash,
    helperInputsHash: selectedBuild.helperInputsHash,
    detoxConfigHash: selectedBuild.detoxConfigHash,
  };
  report.detoxConnectionCommands = commands as never;
  report.detoxConnectionObservations = observations as never;
  report.connectionJourneyPreparation = {
    kind: 'private-native-connection-journey-not-public-receipt',
    binding: {
      selection: {
        arguments: selection.arguments,
        scenarioHash: selection.scenarioHash,
        requirementHash: selection.requirementHash,
      },
      assertionIds: [...nativeConnectionAssertionIds],
    },
    nativePassingCases: 0,
    connectionId,
    transportSourceHash: hashJson(sourceRows),
    snapshots,
    transportWindows: windows,
    isolationUnchanged: true,
    trainingPlansUnchanged: true,
  };
  const ledger = await buildDetoxConnectionLedgerFromActualReport(report, 'ios');
  report.detoxConnectionLedger = ledger;
  const ledgerWithLabels = ledger.map((row) => row);
  report.detoxConnectionLedger = ledgerWithLabels;
  await writeFile0600(
    path.join(captureRoot, 'detox-connection-child-identity.private.json'),
    `${JSON.stringify({ kind: 'private-detox-connection-child-identity', ...child })}\n`,
  );
  await writeFile0600(
    path.join(captureRoot, 'detox-connection-cleanup.private.json'),
    `${JSON.stringify({
      kind: 'private-detox-connection-cleanup',
      reason: 'completed',
      captureRunId: requestedRunId,
      backendRunId,
      status: 'cleaned',
      recoveryStatus: 'verified',
      cleanupDeadlineAt: 20,
      elapsedMs: 1,
      timedOutLabels: [],
      failures: [],
      child: {
        pid: child.pid,
        pgid: child.pgid,
        outcome: { code: 0, signal: null },
        censusFailure: null,
        outputFailure: null,
      },
      finishedAt: '2026-10-02T00:00:00.000Z',
    })}\n`,
  );
  const attempt: DetoxConnectionAttemptResult = {
    kind: 'private-detox-connection-attempt-not-public-receipt',
    status: 'source-only',
    selectionValid: true,
    acquired: true,
    cleanup: 'cleaned',
    report,
    ledger: ledger as never,
    failures: [],
    recoveryStatus: 'verified',
    deadlineAccounting: null,
    nativePassingCases: 0,
    publicPromotionEligible: false,
  };
  const bridgeResult = {
    kind: 'private-detox-ios-connection-public-bridge-result-not-public-receipt',
    owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
    engine: 'detox' as const,
    platform: 'ios' as const,
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    selection: {
      arguments: selection.arguments,
      scenarioId: selection.scenario.id,
      scenarioHash: selection.scenarioHash,
      requirementHash: selection.requirementHash,
      assertionIds: [...nativeConnectionAssertionIds],
    },
    declaredBuildIdentity: {
      sourceTreeHash: selectedBuild.source.sourceTreeHash,
      helperInputsHash: selectedBuild.helperInputsHash,
      binaryHash: selectedBuild.binaryHash,
      detoxConfigHash: selectedBuild.detoxConfigHash,
    },
    attempt,
    nativePassingCases: 0 as const,
    publicPromotionEligible: false as const,
  } satisfies DetoxIosConnectionPublicBridgeResult;
  return { captureRoot, outputRoot, bridgeResult, build: selectedBuild };
}

void test('iOS Detox dispatch is exact and never routes Maestro or Android into the bridge', async () => {
  const repositoryRoot = '/qualified/mychampions';
  const artifactRoot = path.join(
    repositoryRoot,
    '.qa/artifacts/native-pilot-attempts/0123456789abcdef01234567',
  );
  const baseInput = {
    owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
    repositoryRoot,
    serverRoot: '/qualified/mychampions-server',
    artifactRoot,
    requestedRunId: '0123456789abcdef01234567',
    requestedAttemptId: '0123456789abcdef01234567:first',
    selection,
    build: build(repositoryRoot),
    runnerPaths: {
      jestConfigPath: path.join(
        repositoryRoot,
        'e2e/jest.detox-integrated-connection-baseline.config.js',
      ),
      testPath: path.join(repositoryRoot, 'e2e/detox-integrated-connection-baseline.e2e.test.js'),
    },
    signal: new AbortController().signal,
    deadlineMs: 60_000,
    validateBuild: () => undefined,
    delegate: (options: { artifactRoot: string; selection: NativePilotSelection }) =>
      Promise.resolve({
        kind: 'private-detox-connection-attempt-not-public-receipt' as const,
        status: 'blocked' as const,
        selectionValid: true,
        acquired: false,
        cleanup: 'not-acquired' as const,
        report: { output: options.artifactRoot, selection: options.selection },
        ledger: [],
        failures: [{ phase: 'acquisition' as const, name: 'Blocked', message: 'fixture' }],
        recoveryStatus: 'not-applicable' as const,
        deadlineAccounting: null,
        nativePassingCases: 0 as const,
        publicPromotionEligible: false as const,
      }),
  };
  assert.equal(iosDetoxConnectionExecutionAdapter(selection), 'ios-detox-connection');
  assert.equal(
    iosDetoxConnectionExecutionAdapter({
      ...selection,
      arguments: { ...selection.arguments, engine: 'maestro' },
    }),
    null,
  );
  assert.equal(
    iosDetoxConnectionExecutionAdapter({
      ...selection,
      arguments: { ...selection.arguments, platform: 'android' },
    }),
    null,
  );
  const result = await runIosDetoxConnectionPublicAttempt(baseInput);
  assert.equal(result.attempt.status, 'blocked');
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicPromotionEligible, false);
  await assert.rejects(
    () =>
      runIosDetoxConnectionPublicAttempt({
        ...baseInput,
        requestedAttemptId: '0123456789abcdef01234567:retry',
      }),
    /first attempt/i,
  );
});

void test('partial Detox attempts are retained privately and never staged as public outcomes', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-partial-')));
  try {
    const result = {
      kind: 'private-detox-ios-connection-public-bridge-result-not-public-receipt' as const,
      owner: DETOX_IOS_CONNECTION_PUBLIC_OWNER,
      engine: 'detox' as const,
      platform: 'ios' as const,
      requestedRunId: '0123456789abcdef01234567',
      requestedAttemptId: '0123456789abcdef01234567:first',
      selection: {
        arguments: selection.arguments,
        scenarioId: selection.scenario.id,
        scenarioHash: selection.scenarioHash,
        requirementHash: selection.requirementHash,
        assertionIds: [...nativeConnectionAssertionIds],
      },
      declaredBuildIdentity: {
        sourceTreeHash: 'a'.repeat(64),
        helperInputsHash: 'b'.repeat(64),
        binaryHash: 'c'.repeat(64),
        detoxConfigHash: 'd'.repeat(64),
      },
      attempt: {
        kind: 'private-detox-connection-attempt-not-public-receipt' as const,
        status: 'blocked' as const,
        selectionValid: true,
        acquired: true,
        cleanup: 'failed' as const,
        report: null,
        ledger: [],
        failures: [
          { phase: 'cleanup' as const, name: 'CleanupError', message: 'fixture cleanup failed' },
        ],
        recoveryStatus: 'not-verified' as const,
        deadlineAccounting: null,
        nativePassingCases: 0 as const,
        publicPromotionEligible: false as const,
      },
      nativePassingCases: 0 as const,
      publicPromotionEligible: false as const,
    } satisfies DetoxIosConnectionPublicBridgeResult;
    const file = await retainIosDetoxConnectionPartialAttempt({ outputRoot: parent, result });
    const record = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(record.kind, 'private-detox-connection-partial-attempt-not-public-receipt');
    assert.equal(record.nativePassingCases, 0);
    assert.equal(record.publicPromotionEligible, false);
    assert.equal(record.receipt, undefined);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging re-reads the complete Detox producer evidence and round-trips a private copy', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-stage-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const input = {
      repositoryRoot: '/qualified/mychampions',
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      requestedRunId: '0123456789abcdef01234567',
      requestedAttemptId: '0123456789abcdef01234567:first',
      selection,
      bridgeResult: fixture.bridgeResult,
      build: fixture.build,
      lifecycle: lifecycle(),
      validateBuild: () => undefined,
    };
    const staged = await stageIosDetoxConnectionPublicEvidence(input);
    assert.equal(staged.manifest.nativePassingCases, 0);
    assert.equal(staged.manifest.publicPromotionEligible, false);
    await verifyStagedIosDetoxConnectionPublicEvidence({ ...input, copyManifest: staged.manifest });
    const tampered = path.join(staged.outputRoot, staged.manifest.files[0].name);
    await writeFile(tampered, Buffer.from('tampered'), { mode: 0o600 });
    await assert.rejects(
      () =>
        verifyStagedIosDetoxConnectionPublicEvidence({ ...input, copyManifest: staged.manifest }),
      /changed|hash|evidence|expected/i,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging rejects a cleanup failure and leaves no partial output copy', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-stage-fail-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    await rm(path.join(fixture.captureRoot, 'detox-connection-cleanup.private.json'));
    const outputRoot = path.join(parent, 'failed-output');
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(),
          validateBuild: () => undefined,
        }),
      /cleanup|ENOENT|private/i,
    );
    await assert.rejects(() => realpath(outputRoot), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging cancels after the copy phase and rolls back only its owned namespace', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-abort-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const controller = new AbortController();
    let buildCalls = 0;
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(controller),
          validateBuild: () => {
            buildCalls += 1;
            if (buildCalls === 2) controller.abort(new Error('fixture cancellation'));
          },
        }),
      /aborted|cancel/i,
    );
    assert.equal(buildCalls, 2);
    await assert.rejects(() => realpath(fixture.outputRoot), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging cancels during a protected copy and rolls back the partial namespace', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-mid-copy-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const controller = new AbortController();
    let triggered = false;
    const signal = {
      get aborted(): boolean {
        if (!triggered) {
          try {
            if (readdirSync(fixture.outputRoot).length >= 2) {
              triggered = true;
              controller.abort(new Error('fixture mid-copy cancellation'));
            }
          } catch {
            // The output root is not present until staging has passed its preflight.
          }
        }
        return controller.signal.aborted;
      },
      get reason(): unknown {
        const reason: unknown = controller.signal.reason;
        return reason;
      },
    } as unknown as AbortSignal;
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: { signal, deadlineAtMonotonicMs: performance.now() + 60_000 },
          validateBuild: () => undefined,
        }),
      /aborted|cancel/i,
    );
    assert.equal(triggered, true);
    await assert.rejects(() => realpath(fixture.outputRoot), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging reports unknown recovery when an empty-root cleanup race blocks ledger publication', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-public-unknown-recovery-')),
  );
  try {
    const fixture = await makeCompleteCapture(parent);
    let swapped = false;
    const signal = {
      get aborted(): boolean {
        if (!swapped) {
          try {
            if (readdirSync(fixture.outputRoot).length === 0) {
              swapped = true;
              rmSync(fixture.outputRoot, { recursive: true, force: true });
              mkdirSync(fixture.outputRoot, { mode: 0o700 });
              writeFileSync(
                path.join(fixture.outputRoot, 'detox-connection-staging-recovery.private.json'),
                'foreign recovery marker\n',
                { mode: 0o600 },
              );
            }
          } catch {
            // The output root is absent until staging has passed its preflight.
          }
        }
        return false;
      },
      get reason(): unknown {
        return undefined;
      },
    } as unknown as AbortSignal;
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: { signal, deadlineAtMonotonicMs: performance.now() + 60_000 },
          validateBuild: () => undefined,
        }),
      /recovery status is unknown.*no recovery ledger was published/i,
    );
    assert.equal(swapped, true);
    assert.equal(
      readdirSync(fixture.outputRoot).includes('detox-connection-staging-recovery.private.json'),
      true,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging rejects an expired whole-run deadline before touching output', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-deadline-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(new AbortController(), -1),
          validateBuild: () => undefined,
        }),
      /deadline/i,
    );
    await assert.rejects(() => realpath(fixture.outputRoot), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging rolls back after a late manifest readback failure', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-late-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    let buildCalls = 0;
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(),
          validateBuild: async () => {
            buildCalls += 1;
            if (buildCalls === 2) {
              await writeFile(
                path.join(fixture.outputRoot, 'detox-connection-evidence-copy.private.json'),
                'broken',
                {
                  mode: 0o600,
                },
              );
            }
          },
        }),
      /JSON|manifest|private|evidence/i,
    );
    assert.equal(buildCalls, 3);
    await assert.rejects(() => realpath(fixture.outputRoot), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging preserves a blocked recovery ledger when a copied path loses ownership', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-recovery-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const foreign = path.join(parent, 'foreign.private.json');
    await writeFile0600(foreign, Buffer.from('foreign\n'));
    let buildCalls = 0;
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(),
          validateBuild: async () => {
            buildCalls += 1;
            if (buildCalls === 2) {
              const copied = path.join(
                fixture.outputRoot,
                'detox-connection-child-identity.private.json',
              );
              await rm(copied);
              await symlink(foreign, copied);
            }
          },
        }),
      /blocked recovery|symlink|ownership|evidence/i,
    );
    const recoveryPath = path.join(
      fixture.outputRoot,
      'detox-connection-staging-recovery.private.json',
    );
    const recovery = JSON.parse(await readFile(recoveryPath, 'utf8')) as Record<string, unknown>;
    assert.equal(recovery.status, 'blocked-recovery');
    assert(
      (await readdir(fixture.outputRoot)).includes(
        'detox-connection-staging-recovery.private.json',
      ),
    );
    assert(
      (
        await lstat(path.join(fixture.outputRoot, 'detox-connection-child-identity.private.json'))
      ).isSymbolicLink(),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('selection validator rejects a Maestro-shaped staging request before reading evidence', () => {
  assert.throws(
    () =>
      requireIosDetoxConnectionPublicSelection({
        ...selection,
        arguments: { ...selection.arguments, engine: 'maestro' },
      }),
    /engine|Detox/i,
  );
});

void test('staging rejects a changed declared build identity before creating an output copy', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-build-drift-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const drifted = {
      ...fixture.bridgeResult,
      declaredBuildIdentity: {
        ...fixture.bridgeResult.declaredBuildIdentity,
        helperInputsHash: '0'.repeat(64),
      },
    } satisfies DetoxIosConnectionPublicBridgeResult;
    const outputRoot = path.join(parent, 'drifted-output');
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: drifted,
          build: fixture.build,
          lifecycle: lifecycle(),
          validateBuild: () => undefined,
        }),
      /build|helper|identity/i,
    );
    await assert.rejects(() => realpath(outputRoot), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging rejects a producer screenshot that is not a complete PNG', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-png-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const report = fixture.bridgeResult.attempt.report as unknown as MutableScreenshotReport;
    const observation = report.detoxConnectionObservations[0];
    const fake = Buffer.from('not-a-png');
    await writeFile(path.join(fixture.captureRoot, observation.screenshotFile), fake, {
      mode: 0o600,
    });
    await writeFile(path.join(fixture.captureRoot, `${observation.label}.png`), fake, {
      mode: 0o600,
    });
    await writeFile(
      path.join(fixture.captureRoot, observation.sourceReceipts.screenshot.capturedCopyFile),
      fake,
      { mode: 0o600 },
    );
    observation.screenshotSha256 = hashBytes(fake);
    observation.sourceReceipts.screenshot.sourceBytes = fake.byteLength;
    observation.sourceReceipts.screenshot.sourceSha256 = hashBytes(fake);
    observation.sourceReceipts.screenshot.capturedCopyBytes = fake.byteLength;
    observation.sourceReceipts.screenshot.capturedCopySha256 = hashBytes(fake);
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(),
          validateBuild: () => undefined,
        }),
      /PNG/i,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging binds the screenshot receipt to the exact original producer path', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-source-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const report = fixture.bridgeResult.attempt.report as unknown as MutableScreenshotReport;
    const observation = report.detoxConnectionObservations[0];
    const foreignPath = '/tmp/detox-999-foreign.detox.png';
    observation.sourceReceipts.screenshot.sourcePath = foreignPath;
    observation.sourceReceipts.screenshot.sourceRealpath = foreignPath;
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot: fixture.outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(),
          validateBuild: () => undefined,
        }),
      /producer output|original screenshot|source/i,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('shared legacy Detox reader rejects hardlinks and symlinked private evidence', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-reader-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const source = path.join(fixture.captureRoot, 'detox-connection-child-identity.private.json');
    const hardlink = path.join(fixture.captureRoot, 'hardlink.private.json');
    await link(source, hardlink);
    await assert.rejects(
      () =>
        readOwnedDetoxPrivateFile(
          fixture.captureRoot,
          'detox-connection-child-identity.private.json',
          64 * 1024,
        ),
      /owned|immutable|nlink|Native evidence/i,
    );
    await rm(hardlink);
    const symlinkPath = path.join(fixture.captureRoot, 'symlink.private.json');
    await symlink(source, symlinkPath);
    await assert.rejects(
      () => readOwnedDetoxPrivateFile(fixture.captureRoot, 'symlink.private.json', 64 * 1024),
      /canonical|symlink|owned|Native evidence/i,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging refuses an unknown output ancestor without creating or chmodding it', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-output-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const unknownParent = path.join(parent, 'unknown-output-parent');
    const outputRoot = path.join(unknownParent, 'staged');
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(),
          validateBuild: () => undefined,
        }),
      /ENOENT|parent|output/i,
    );
    await assert.rejects(() => realpath(unknownParent), /ENOENT|no such file/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('staging rejects a symlink output root before copying or changing its target', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-public-output-link-')));
  try {
    const fixture = await makeCompleteCapture(parent);
    const target = path.join(parent, 'owned-output-target');
    const outputRoot = path.join(parent, 'symlink-output');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, outputRoot);
    await assert.rejects(
      () =>
        stageIosDetoxConnectionPublicEvidence({
          repositoryRoot: '/qualified/mychampions',
          captureRoot: fixture.captureRoot,
          outputRoot,
          requestedRunId: '0123456789abcdef01234567',
          requestedAttemptId: '0123456789abcdef01234567:first',
          selection,
          bridgeResult: fixture.bridgeResult,
          build: fixture.build,
          lifecycle: lifecycle(),
          validateBuild: () => undefined,
        }),
      /canonical|symlink|output/i,
    );
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

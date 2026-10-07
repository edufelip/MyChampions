import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, cp, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  buildDetoxConnectionLedgerFromActualReport,
  createDetoxConnectionProducerReport,
} from '../../scripts/testing/detox-integrated-connection-driver';
import {
  detoxSessionHelperClosure,
  type DetoxBaselineBuildInstrumentation,
} from '../../scripts/testing/detox-integrated-session-baseline';
import {
  applyDetoxElementAttributeEvidence,
  parseDetoxViewHierarchyXml,
} from '../../scripts/testing/detox-native-hierarchy';
import {
  readActualDetoxRuntimeMetadata,
  requireDetoxRuntimeBuildMetadata,
} from '../../scripts/testing/detox-runtime-build-metadata';
import { sourceIdentity, treeHash } from '../../scripts/testing/native-build-identity';
import { CONNECTION_SNAPSHOT_KEYS } from '../../scripts/testing/native-connection-platform-contract';
import {
  DETOX_IOS_CONNECTION_PUBLIC_OWNER,
  type DetoxIosConnectionPublicBridgeResult,
} from '../../scripts/testing/native-detox-connection-public-bridge';
import {
  type DetoxIosConnectionRuntimeFacts,
  type DetoxRuntimeProtectedReceipt,
} from '../../scripts/testing/native-detox-connection-runtime-verification';
import { nativeConnectionAssertionIds } from '../../scripts/testing/native-pilot-contract';
import type { DetoxConnectionAttemptResult } from '../../scripts/testing/detox-integrated-connection-baseline';
import type { DetoxNativePilotAttemptResult } from '../../scripts/testing/native-detox-connection-public-dispatch';
import type { DetoxIosConnectionPublicStagingLifecycle } from '../../scripts/testing/native-detox-connection-public-staging';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const hashBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const hashJson = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function helperInputsDigest(paths: readonly string[], contents: readonly Buffer[]): string {
  assert.equal(paths.length, contents.length);
  const digest = createHash('sha256').update('detox-integrated-helper-inputs-v2\0');
  for (const pair of paths
    .map((relative, index) => ({ relative, content: contents[index] }))
    .sort((left, right) => left.relative.localeCompare(right.relative))) {
    digest.update(pair.relative).update('\0').update(pair.content);
  }
  return digest.digest('hex');
}
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
  return {
    signal: controller.signal,
    deadlineAtMonotonicMs: performance.now() + extraMs,
  };
}

function loadSelection(): NativePilotSelection {
  const inventory = readFileSync(
    path.resolve(process.cwd(), 'docs/qa/native-pilot/inventory.json'),
    'utf8',
  );
  const parsed = JSON.parse(inventory) as {
    scenarios: Record<string, unknown>[];
  };
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
    scenarioHash: hashBytes(Buffer.from(canonical(scenario))),
    requirementHash: '2'.repeat(64),
  };
}

const selection = loadSelection();
const build = (repositoryRoot: string): DetoxBaselineBuildInstrumentation => ({
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

/**
 * Create a small regular-file checkout for the production qualified-build
 * inspector.  The fixture never uses the canonical Q checkout as a writable
 * build root and never treats the placeholder app bundle as native evidence.
 */
export async function makeQualifiedBuildRepository(parent: string): Promise<{
  repositoryRoot: string;
  build: ReturnType<typeof build>;
}> {
  const repositoryRoot = path.join(parent, 'qualified-repository');
  await mkdir(repositoryRoot, { recursive: true, mode: 0o700 });
  const sourceRoot = process.cwd();
  const sourceDirectories = [
    'app',
    'components',
    'features',
    'constants',
    'localization',
    'assets',
    'ios/mychampions',
    'ios/mychampions.xcodeproj',
  ];
  for (const relative of sourceDirectories)
    await mkdir(path.join(repositoryRoot, relative), {
      recursive: true,
      mode: 0o700,
    });

  for (const relative of detoxSessionHelperClosure) {
    const destination = path.join(repositoryRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await cp(path.join(sourceRoot, relative), destination, {
      dereference: true,
    });
    await chmod(destination, 0o600);
  }
  for (const relative of ['package.json', 'yarn.lock', 'ios/Podfile', 'ios/Podfile.lock']) {
    const destination = path.join(repositoryRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await cp(path.join(sourceRoot, relative), destination, {
      dereference: true,
    });
    await chmod(destination, 0o600);
  }
  const detoxPackagePath = path.join(repositoryRoot, 'node_modules/detox/package.json');
  await mkdir(path.dirname(detoxPackagePath), { recursive: true, mode: 0o700 });
  await cp(path.join(sourceRoot, 'node_modules/detox/package.json'), detoxPackagePath, {
    dereference: true,
  });
  await chmod(detoxPackagePath, 0o600);

  const binaryPath = path.join(
    repositoryRoot,
    'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app',
  );
  await mkdir(binaryPath, { recursive: true, mode: 0o700 });
  await writeFile0600(path.join(binaryPath, 'Info.plist'), 'private-qualified-fixture-bundle\n');

  // sourceIdentity intentionally binds the qualified checkout to a real Git
  // head.  The temporary repository is disposable and is never used as a
  // substitute for a native build or device result.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execute = promisify(execFile);
  await execute('git', ['init', '-q'], { cwd: repositoryRoot });
  await execute('git', ['config', 'user.email', 'fixture@example.invalid'], {
    cwd: repositoryRoot,
  });
  await execute('git', ['config', 'user.name', 'fixture'], {
    cwd: repositoryRoot,
  });
  await execute('git', ['add', '-A'], { cwd: repositoryRoot });
  await execute('git', ['commit', '-qm', 'qualified fixture'], {
    cwd: repositoryRoot,
  });

  const source = await sourceIdentity(repositoryRoot);
  const helperContents = await Promise.all(
    detoxSessionHelperClosure.map((relative) => readFile(path.join(repositoryRoot, relative))),
  );
  const detoxConfigBytes = await readFile(path.join(repositoryRoot, '.detoxrc.js'));
  const configSourceBytes = await readFile(path.join(repositoryRoot, 'app.config.ts'));
  const selected = build(repositoryRoot);
  const runtimeMetadata = await readActualDetoxRuntimeMetadata(
    repositoryRoot,
    hashBytes(configSourceBytes),
  );
  return {
    repositoryRoot,
    build: {
      ...selected,
      binaryHash: await treeHash(binaryPath),
      source,
      helperInputsHash: helperInputsDigest(detoxSessionHelperClosure, helperContents),
      detoxConfigHash: hashBytes(detoxConfigBytes),
      embeddedRuntime: {
        ...selected.embeddedRuntime,
        configSourceHash: hashBytes(configSourceBytes),
      },
      ...runtimeMetadata,
    },
  };
}

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

async function evidenceBinding(root: string, name: string): Promise<Record<string, unknown>> {
  const file = path.join(root, name);
  const bytes = await readFile(file);
  const metadata = await lstat(file);
  return {
    name,
    bytes: bytes.byteLength,
    sha256: hashBytes(bytes),
    metadata: {
      dev: metadata.dev,
      ino: metadata.ino,
      uid: metadata.uid,
      gid: metadata.gid,
      mode: metadata.mode,
      nlink: metadata.nlink,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs,
    },
  };
}

async function makeCompleteCapture(
  parent: string,
  qualified?: Awaited<ReturnType<typeof makeQualifiedBuildRepository>>,
  selectionOverride?: NativePilotSelection,
  dispatchRuntimeInputsHashOverride?: string,
): Promise<{
  captureRoot: string;
  outputRoot: string;
  bridgeResult: DetoxIosConnectionPublicBridgeResult;
  build: ReturnType<typeof build> & { dispatchRuntimeInputsHash: string };
}> {
  const requestedRunId = '0123456789abcdef01234567';
  const captureSelection = selectionOverride ?? selection;
  const dispatchRuntimeInputsHash = dispatchRuntimeInputsHashOverride ?? '9'.repeat(64);
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
        index === 0
          ? '/professional/invite-codes/fitness_coach'
          : index === 2
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
  for (let index = 0; index < CONNECTION_SNAPSHOT_KEYS.length; index += 1) {
    const bytes = Buffer.from(JSON.stringify(validSnapshot(index)));
    const name = `snapshot-${index}.private.json`;
    await writeFile0600(path.join(captureRoot, name), bytes);
    snapshots[CONNECTION_SNAPSHOT_KEYS[index]] = {
      path: name,
      sha256: hashBytes(bytes),
    };
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
  // Keep the qualified build under the actual disposable checkout used by the
  // test.  The production staging guard rejects a build whose binary/config
  // paths are outside the requested repository; a fixture-only path would
  // exercise an unreviewed bypass instead of the real guard.
  const repositoryRoot = qualified?.repositoryRoot ?? process.cwd();
  const baseBuild = qualified?.build ?? build(repositoryRoot);
  const selectedBuild = {
    ...baseBuild,
    ...(baseBuild.environmentHash && baseBuild.toolVersions && baseBuild.toolVersionEvidence
      ? {
          environmentHash: baseBuild.environmentHash,
          toolVersions: baseBuild.toolVersions,
          toolVersionEvidence: baseBuild.toolVersionEvidence,
        }
      : await readActualDetoxRuntimeMetadata(
          repositoryRoot,
          baseBuild.embeddedRuntime.configSourceHash,
        )),
  };
  const report = createDetoxConnectionProducerReport({
    platform: 'ios',
    artifactRoot: captureRoot,
    childIdentity: child,
    sourceTreeHash: selectedBuild.source.sourceTreeHash,
    helperInputsHash: selectedBuild.helperInputsHash,
    transportSource: sourceRows,
  });
  report.detoxChild = {
    pid: child.pid,
    pgid: child.pgid,
    command: 'fixture-detox-child',
    cwd: repositoryRoot,
    ownership: 'owned-process-group',
  };
  report.detoxTransportSourceReceipt = {
    path: transportFile,
    sourceBytes: transportBytes.byteLength,
    sourceSha256: hashBytes(transportBytes),
  };
  report.selection = captureSelection;
  report.backend = {
    runId: backendRunId,
    apiOrigin: backendOrigin,
    apiPid,
    manifestArtifactRoot: captureRoot,
  };
  report.connectionApiIdentity = { targetOrigin: backendOrigin, apiPid };
  const originalSourceName = 'detox-source-original.private.json';
  const originalBuildName = 'detox-build-original.private.json';
  const originalTargetName = 'detox-target-original.private.json';
  const originalResetName = 'detox-reset-original.private.json';
  const originalTransportReceiptName = 'detox-transport-original.private.json';
  const originalApiName = 'detox-api-original.private.json';
  const originalSqlName = 'detox-sql-original.private.json';
  const originalUiName = 'detox-ui-original.private.json';
  const originalHeader = {
    owner: 'detox-driver',
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    captureRunId: requestedRunId,
    childIdentity: child,
    commandIds: commands.map((command) => command.commandId),
    commandHashes: commands.map((command) => command.commandHash),
  };
  const ownerPath = 'simulator-owner.private.json';
  const ownerBytes = Buffer.from(
    `${JSON.stringify({
      state: 'owned',
      identity: { udid: 'fixture-ios-device', runtime: 'iOS fixture' },
    })}\n`,
  );
  await writeFile0600(path.join(captureRoot, ownerPath), ownerBytes);
  const resetOriginal = {
    kind: 'private-detox-fresh-owned-target-reset-original',
    platform: 'ios',
    targetDeviceId: 'fixture-ios-device',
    status: 'verified',
    permissionState: 'not-applicable',
    freshOwnedTarget: true,
    resetMethod: 'new-owned-simulator',
    ownerPath,
    ownerSha256: hashBytes(ownerBytes),
    ownerBytes: ownerBytes.byteLength,
    osVersion: 'iOS fixture',
  };
  const resetOriginalBytes = Buffer.from(`${JSON.stringify(resetOriginal)}\n`);
  const resetFingerprint = hashBytes(resetOriginalBytes);
  await writeFile0600(path.join(captureRoot, originalResetName), resetOriginalBytes);
  const ownerEvidence = await evidenceBinding(captureRoot, ownerPath);
  const resetEvidence = await evidenceBinding(captureRoot, originalResetName);
  const transportSourceEvidence = await evidenceBinding(captureRoot, transportFile);
  const snapshotEvidence = await Promise.all(
    Object.values(snapshots).map((row) => evidenceBinding(captureRoot, row.path)),
  );
  const uiEvidence = await Promise.all(
    labels.flatMap((label) => [
      evidenceBinding(captureRoot, `${label}.png`),
      evidenceBinding(captureRoot, `${label}-hierarchy.json`),
    ]),
  );
  await writeFile0600(
    path.join(captureRoot, originalSourceName),
    `${JSON.stringify({
      kind: 'private-detox-qualified-source-original',
      ...originalHeader,
      sourceTreeHash: selectedBuild.source.sourceTreeHash,
      helperInputsHash: selectedBuild.helperInputsHash,
      detoxConfigHash: selectedBuild.detoxConfigHash,
      dispatchRuntimeInputsHash,
    })}\n`,
  );
  await writeFile0600(
    path.join(captureRoot, originalBuildName),
    `${JSON.stringify({
      kind: 'private-detox-qualified-build-original',
      ...originalHeader,
      configuration: selectedBuild.configuration,
      sourceTreeHash: selectedBuild.source.sourceTreeHash,
      helperInputsHash: selectedBuild.helperInputsHash,
      binaryHash: selectedBuild.binaryHash,
      detoxConfigHash: selectedBuild.detoxConfigHash,
      environmentHash: selectedBuild.environmentHash,
      toolVersions: selectedBuild.toolVersions,
      toolVersionEvidence: selectedBuild.toolVersionEvidence,
    })}\n`,
  );
  await writeFile0600(
    path.join(captureRoot, originalTargetName),
    `${JSON.stringify({
      kind: 'private-detox-owned-target-original',
      ...originalHeader,
      platform: 'ios',
      deviceId: 'fixture-ios-device',
      osVersion: 'iOS fixture',
      appId: selectedBuild.appIdentifier,
      ownership: 'owned',
      apiOrigin: backendOrigin,
      evidence: { owner: ownerEvidence, reset: resetEvidence },
    })}\n`,
  );
  await writeFile0600(
    path.join(captureRoot, originalTransportReceiptName),
    `${JSON.stringify({
      kind: 'private-detox-transport-original',
      ...originalHeader,
      sourceName: transportFile,
      sourceEvidence: transportSourceEvidence,
      windows,
    })}\n`,
  );
  await writeFile0600(
    path.join(captureRoot, originalApiName),
    `${JSON.stringify({
      kind: 'private-detox-api-original',
      ...originalHeader,
      apiPid,
      targetOrigin: backendOrigin,
      requestIds: sourceRows.map((row) => row.requestId),
      transportSourceEvidence,
    })}\n`,
  );
  await writeFile0600(
    path.join(captureRoot, originalSqlName),
    `${JSON.stringify({
      kind: 'private-detox-sql-original',
      ...originalHeader,
      snapshotNames: Object.values(snapshots).map((row) => row.path),
      snapshotEvidence,
      isolationUnchanged: true,
      trainingPlansUnchanged: true,
    })}\n`,
  );
  await writeFile0600(
    path.join(captureRoot, originalUiName),
    `${JSON.stringify({
      kind: 'private-detox-ui-original',
      ...originalHeader,
      assertionIds: [...nativeConnectionAssertionIds],
      evidence: uiEvidence,
    })}\n`,
  );
  report.target = {
    platform: 'ios',
    deviceId: 'fixture-ios-device',
    osVersion: 'iOS fixture',
    appId: selectedBuild.appIdentifier,
    ownership: 'owned',
    apiOrigin: backendOrigin,
    reset: {
      name: originalResetName,
      targetDeviceId: 'fixture-ios-device',
      status: 'verified',
      permissionState: 'not-applicable',
      resetFingerprint,
    },
  };
  report.build = {
    platform: selectedBuild.platform,
    configuration: selectedBuild.configuration,
    binaryHash: selectedBuild.binaryHash,
    source: selectedBuild.source,
    helperInputsHash: selectedBuild.helperInputsHash,
    detoxConfigHash: selectedBuild.detoxConfigHash,
    dispatchRuntimeInputsHash,
    environmentHash: selectedBuild.environmentHash,
    toolVersions: selectedBuild.toolVersions,
    toolVersionEvidence: selectedBuild.toolVersionEvidence,
  };
  report.detoxConnectionCommands = commands as never;
  report.detoxConnectionObservations = observations as never;
  report.observations = observations.map((row) => ({
    label: row.label,
    screenshotPath: `${String(row.label)}.png`,
    hierarchyPath: `${String(row.label)}-hierarchy.json`,
  }));
  report.connectionJourneyPreparation = {
    kind: 'private-native-connection-journey-not-public-receipt',
    binding: {
      selection: {
        arguments: captureSelection.arguments,
        scenarioHash: captureSelection.scenarioHash,
        requirementHash: captureSelection.requirementHash,
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
  report.detoxRuntimeTimingsMs = {
    build: 1,
    install: 1,
    reset: 1,
    scenario: 1,
    verify: 1,
    cleanup: 1,
  };
  report.detoxRuntimeOriginalReceiptSet = {
    source: {
      name: originalSourceName,
      sourceTreeHash: selectedBuild.source.sourceTreeHash,
      helperInputsHash: selectedBuild.helperInputsHash,
      detoxConfigHash: selectedBuild.detoxConfigHash,
      dispatchRuntimeInputsHash,
    },
    build: {
      name: originalBuildName,
      configuration: selectedBuild.configuration,
      sourceTreeHash: selectedBuild.source.sourceTreeHash,
      helperInputsHash: selectedBuild.helperInputsHash,
      binaryHash: selectedBuild.binaryHash,
      detoxConfigHash: selectedBuild.detoxConfigHash,
      environmentHash: selectedBuild.environmentHash,
      toolVersions: selectedBuild.toolVersions,
      toolVersionEvidence: selectedBuild.toolVersionEvidence,
    },
    target: {
      name: originalTargetName,
      platform: 'ios',
      deviceId: 'fixture-ios-device',
      osVersion: 'iOS fixture',
      appId: selectedBuild.appIdentifier,
      ownership: 'owned',
      apiOrigin: backendOrigin,
    },
    reset: {
      name: originalResetName,
      status: 'verified',
      targetDeviceId: 'fixture-ios-device',
      permissionState: 'not-applicable',
      resetFingerprint,
    },
    transport: {
      receiptName: originalTransportReceiptName,
      sourceName: transportFile,
      windows: windows as never,
    },
    api: {
      receiptName: originalApiName,
      apiPid,
      targetOrigin: backendOrigin,
      requestIds: sourceRows.map((row) => row.requestId),
    },
    sql: {
      receiptName: originalSqlName,
      snapshots: Object.entries(snapshots).map(([label, row]) => ({
        label,
        name: row.path,
      })),
      isolationUnchanged: true,
      trainingPlansUnchanged: true,
    },
    ui: {
      receiptName: originalUiName,
      assertions: ledger.map((row) => {
        const observationLabels = Array.isArray(row.observationLabels)
          ? row.observationLabels.map((label) => String(label))
          : [];
        return {
          id: row.id,
          actor: row.actor,
          observationLabels,
          evidenceNames: observationLabels.flatMap((label) => [
            `${String(label)}.png`,
            `${String(label)}-hierarchy.json`,
          ]),
        };
      }),
    },
    cleanup: {
      name: 'detox-connection-cleanup.private.json',
      status: 'cleaned',
      recoveryStatus: 'verified',
    },
  };
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
      arguments: captureSelection.arguments,
      scenarioId: captureSelection.scenario.id,
      scenarioHash: captureSelection.scenarioHash,
      requirementHash: captureSelection.requirementHash,
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
  return {
    captureRoot,
    outputRoot,
    bridgeResult,
    build: { ...selectedBuild, dispatchRuntimeInputsHash },
  };
}

async function protectedReceipt(
  root: string,
  name: string,
  contents?: string,
): Promise<DetoxRuntimeProtectedReceipt> {
  if (contents !== undefined) await writeFile0600(path.join(root, name), contents);
  const bytes = await readFile(path.join(root, name));
  const metadata = await lstat(path.join(root, name));
  return {
    name,
    bytes: bytes.byteLength,
    sha256: hashBytes(bytes),
    metadata: {
      dev: metadata.dev,
      ino: metadata.ino,
      uid: metadata.uid,
      gid: metadata.gid,
      mode: metadata.mode,
      nlink: metadata.nlink,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs,
    },
  };
}

export function makeRunnerAttempt(
  fixture: Awaited<ReturnType<typeof makeCompleteCapture>>,
  overrides: Partial<DetoxNativePilotAttemptResult> = {},
): DetoxNativePilotAttemptResult {
  const runId = '0123456789abcdef01234567';
  const qualifiedBuild = {
    ...fixture.build,
    dispatchRuntimeInputPaths: [
      'scripts/testing/native-detox-connection-public-dispatch.ts',
      'scripts/testing/native-detox-connection-runtime-dispatch.ts',
      'scripts/testing/native-detox-connection-runtime-producer.ts',
      'scripts/testing/native-detox-connection-runtime-verification.ts',
    ],
    dispatchRuntimeInputIdentities: [],
    dispatchRuntimeInputsHash: fixture.build.dispatchRuntimeInputsHash,
  };
  return {
    kind: 'private-owned-ios-detox-connection-attempt-not-public-receipt',
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    captureRunId: runId,
    backendRunId: backendRunId,
    backendAttemptId: null,
    captureExitCode: 0,
    childExitCode: 0,
    childSignal: null,
    childClassification: 'completed',
    captureResult: 'observed',
    captureCleanup: 'cleaned',
    captureTimeout: null,
    cancellation: null,
    callbackInvocations: 1,
    callbackCompleted: true,
    externalCleanupResult: 'passed',
    verificationResult: 'passed',
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure: null,
    postCaptureFailure: null,
    deadline: null,
    commandDiagnostics: [],
    censusFailures: [],
    outputFailures: [],
    assertionBindings: [],
    fixtureRunId: backendRunId,
    fixtureHash: 'f'.repeat(64),
    flagsHash: qualifiedBuild.environmentHash ?? 'f'.repeat(64),
    toolVersions: qualifiedBuild.toolVersions ?? { detox: '20.47.0' },
    timingsMs: {
      build: 1,
      install: 1,
      reset: 1,
      scenario: 1,
      verify: 1,
      cleanup: 1,
    },
    nativePassingCases: 0,
    artifactRoot: fixture.captureRoot,
    publicFinalization: null,
    publicFinalizationInput: null,
    publicDependency: null,
    captureInvocation: { count: 1, returned: true },
    captureCompleted: true,
    censusFailureCount: 0,
    staged: null,
    faultAttemptId: null,
    detoxBridgeResult: fixture.bridgeResult,
    dispatchRuntimeInputPaths: qualifiedBuild.dispatchRuntimeInputPaths,
    dispatchRuntimeInputsHash: qualifiedBuild.dispatchRuntimeInputsHash,
    detoxBuild: qualifiedBuild,
    detoxRuntimeFacts: null,
    ...overrides,
  };
}

function receiptJson(kind: string, runId: string, fields: Record<string, unknown>): string {
  return `${JSON.stringify(
    {
      kind,
      requestedRunId: runId,
      requestedAttemptId: `${runId}:first`,
      captureRunId: runId,
      ...fields,
    },
    null,
    2,
  )}\n`;
}

async function runtimeFactsForFixture(
  fixture: Awaited<ReturnType<typeof makeCompleteCapture>>,
  parent: string,
): Promise<DetoxIosConnectionRuntimeFacts> {
  assert(fixture.build.configuration === 'ios.sim.debug');
  requireDetoxRuntimeBuildMetadata(fixture.build, 'Detox fixture runtime metadata');
  const runId = '0123456789abcdef01234567';
  const report = fixture.bridgeResult.attempt.report as Record<string, unknown>;
  report.target = {
    platform: 'ios',
    deviceId: 'fixture-ios-device',
    ownership: 'owned',
  };
  const preparation = report.connectionJourneyPreparation as Record<string, unknown>;
  const sourceRows = report.detoxTransportSource as Record<string, unknown>[];
  const snapshots = preparation.snapshots as Record<string, { path: string; sha256: string }>;
  const ledger = report.detoxConnectionLedger as Record<string, unknown>[];
  const labels = ledger.flatMap((row) => row.observationLabels as string[]);
  const windows =
    preparation.transportWindows as DetoxIosConnectionRuntimeFacts['transport']['windows'];
  const source = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-source.private.json',
    receiptJson('private-detox-connection-source-runtime-receipt', runId, {
      sourceTreeHash: fixture.build.source.sourceTreeHash,
      helperInputsHash: fixture.build.helperInputsHash,
      detoxConfigHash: fixture.build.detoxConfigHash,
      dispatchRuntimeInputsHash: '9'.repeat(64),
    }),
  );
  const buildReceipt = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-build.private.json',
    receiptJson('private-detox-connection-build-runtime-receipt', runId, {
      configuration: fixture.build.configuration,
      sourceTreeHash: fixture.build.source.sourceTreeHash,
      helperInputsHash: fixture.build.helperInputsHash,
      binaryHash: fixture.build.binaryHash,
      detoxConfigHash: fixture.build.detoxConfigHash,
      environmentHash: fixture.build.environmentHash,
      toolVersions: fixture.build.toolVersions,
      toolVersionEvidence: fixture.build.toolVersionEvidence,
    }),
  );
  const target = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-target.private.json',
    receiptJson('private-detox-connection-target-runtime-receipt', runId, {
      platform: 'ios',
      deviceId: 'fixture-ios-device',
      osVersion: 'iOS fixture',
      appId: fixture.build.appIdentifier,
      ownership: 'owned',
      apiOrigin: backendOrigin,
    }),
  );
  const resetFingerprint = 'a'.repeat(64);
  const reset = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-reset.private.json',
    receiptJson('private-detox-connection-reset-runtime-receipt', runId, {
      status: 'verified',
      targetDeviceId: 'fixture-ios-device',
      permissionState: 'not-applicable',
      resetFingerprint,
    }),
  );
  const transportSource = await protectedReceipt(
    fixture.captureRoot,
    'detox-connection-transport-source.private.json',
  );
  const transportReceipt = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-transport.private.json',
    receiptJson('private-detox-connection-transport-runtime-receipt', runId, {
      sourceName: transportSource.name,
      windows,
    }),
  );
  const requestIds = sourceRows.map((row) => Number(row.requestId));
  const api = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-api.private.json',
    receiptJson('private-detox-connection-api-runtime-receipt', runId, {
      apiPid,
      targetOrigin: backendOrigin,
      requestIds,
    }),
  );
  const sqlSnapshots = await Promise.all(
    Object.entries(snapshots).map(async ([label, row]) => ({
      label,
      receipt: await protectedReceipt(fixture.captureRoot, row.path),
    })),
  );
  const sql = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-sql.private.json',
    receiptJson('private-detox-connection-sql-runtime-receipt', runId, {
      snapshotNames: sqlSnapshots.map((row) => row.receipt.name),
      isolationUnchanged: true,
      trainingPlansUnchanged: true,
    }),
  );
  const uiAssertions = await Promise.all(
    ledger.map(async (row) => {
      const id = String(row.id) as DetoxIosConnectionRuntimeFacts['ui']['assertions'][number]['id'];
      const observationLabels = row.observationLabels as string[];
      const evidence = await Promise.all(
        observationLabels.map(async (label) => [
          await protectedReceipt(fixture.captureRoot, `${label}.png`),
          await protectedReceipt(fixture.captureRoot, `${label}-hierarchy.json`),
        ]),
      );
      return {
        id,
        actor: row.actor as 'coach' | 'student',
        observationLabels,
        evidence: evidence.flat(),
      };
    }),
  );
  const ui = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-ui.private.json',
    receiptJson('private-detox-connection-ui-runtime-receipt', runId, {
      assertionIds: [...nativeConnectionAssertionIds],
      observationLabels: labels,
    }),
  );
  const cleanupBytes = JSON.parse(
    (
      await readFile(path.join(fixture.captureRoot, 'detox-connection-cleanup.private.json'))
    ).toString(),
  ) as Record<string, unknown>;
  cleanupBytes.requestedRunId = runId;
  cleanupBytes.requestedAttemptId = `${runId}:first`;
  cleanupBytes.captureRunId = runId;
  await writeFile0600(
    path.join(fixture.captureRoot, 'detox-connection-cleanup.private.json'),
    `${JSON.stringify(cleanupBytes)}\n`,
  );
  const cleanupOriginal = await protectedReceipt(
    fixture.captureRoot,
    'detox-connection-cleanup.private.json',
  );
  const cleanup = await protectedReceipt(
    fixture.captureRoot,
    'detox-runtime-cleanup.private.json',
    receiptJson('private-detox-connection-cleanup', runId, {
      status: 'cleaned',
      recoveryStatus: 'verified',
      failures: [],
      survivors: [],
      unknownProcesses: [],
      originalName: cleanupOriginal.name,
      originalBytes: cleanupOriginal.bytes,
      originalSha256: cleanupOriginal.sha256,
      originalMetadata: cleanupOriginal.metadata,
    }),
  );
  return {
    kind: 'private-detox-ios-connection-runtime-facts',
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    captureRunId: runId,
    captureResult: 'observed',
    captureExitCode: 0,
    childExitCode: 0,
    childSignal: null,
    childClassification: 'completed',
    captureCleanup: 'cleaned',
    externalCleanupResult: 'passed',
    verificationResult: 'passed',
    callbackInvocations: 1,
    callbackCompleted: true,
    captureTimeout: null,
    cancellation: null,
    postCaptureFailure: null,
    censusFailures: [],
    outputFailures: [],
    timingsMs: {
      build: 1,
      install: 1,
      reset: 1,
      scenario: 1,
      verify: 1,
      cleanup: 1,
    },
    source: {
      receipt: source,
      sourceTreeHash: fixture.build.source.sourceTreeHash,
      helperInputsHash: fixture.build.helperInputsHash,
      detoxConfigHash: fixture.build.detoxConfigHash,
      dispatchRuntimeInputsHash: '9'.repeat(64),
    },
    build: {
      receipt: buildReceipt,
      configuration: fixture.build.configuration,
      sourceTreeHash: fixture.build.source.sourceTreeHash,
      helperInputsHash: fixture.build.helperInputsHash,
      binaryHash: fixture.build.binaryHash,
      detoxConfigHash: fixture.build.detoxConfigHash,
      environmentHash: fixture.build.environmentHash,
      toolVersions: fixture.build.toolVersions,
      toolVersionEvidence: fixture.build.toolVersionEvidence,
    },
    target: {
      receipt: target,
      platform: 'ios',
      deviceId: 'fixture-ios-device',
      osVersion: 'iOS fixture',
      appId: fixture.build.appIdentifier,
      ownership: 'owned',
      apiOrigin: backendOrigin,
    },
    reset: {
      receipt: reset,
      status: 'verified',
      targetDeviceId: 'fixture-ios-device',
      permissionState: 'not-applicable',
      resetFingerprint,
    },
    transport: { receipt: transportReceipt, source: transportSource, windows },
    api: { receipt: api, apiPid, targetOrigin: backendOrigin, requestIds },
    sql: {
      receipt: sql,
      snapshots: sqlSnapshots,
      isolationUnchanged: true,
      trainingPlansUnchanged: true,
    },
    ui: { receipt: ui, assertions: uiAssertions },
    cleanup: {
      receipt: cleanup,
      status: 'cleaned',
      recoveryStatus: 'verified',
      failures: [],
      survivors: [],
      unknownProcesses: [],
    },
  };
}

export { selection, build, lifecycle, makeCompleteCapture, runtimeFactsForFixture };

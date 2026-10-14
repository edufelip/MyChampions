import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { treeHash } from './native-build-identity';
import {
  assertCameraDomainConnectionBindings,
  assertCameraNonConnectionStateUnchanged,
  normalizeCoachInviteHierarchy,
} from './native-camera-submission-evidence';
import { verifyConnectionSubmissionSnapshotTransition } from './native-connection-checkpoints';
import { resolvePendingStudentConnectionCard } from './native-connection-hierarchy';
import {
  buildNativeConnectionSubmissionActions,
  requireNativeConnectionTransport,
} from './native-connection-journey-core';
import { IOS_CONNECTION_PLATFORM } from './native-connection-platform-contract';
import { verifyConnectionSnapshotCheckpoint } from './native-connection-snapshot';
import { nativeHierarchyHasAttribute } from './native-hierarchy';
import { readNativeEvidence } from './native-view-evidence';
import { enUS } from '../../localization/en-US';
import type { NativeConnectionTargetScope } from './native-connection-hierarchy';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';
import type { ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures } from './owned-session';

const execute = promisify(execFile);
export type IosCameraPermissionObservation = {
  source: 'owned-simulator-tcc-read-only';
  deviceUdid: string;
  bundleId: string;
  rows: {
    service: string;
    client: string;
    client_type: number;
    auth_value: number;
    auth_reason: number;
  }[];
};

/**
 * Proof that the app which has just been launched is the qualified build on
 * the owned simulator. This is deliberately separate from the build-path
 * check: a qualified .app on disk does not prove that the runner installed that
 * same bundle on this target.
 */
export type IosInstalledAppObservation = Readonly<{
  source: 'owned-simulator-installed-app';
  deviceUdid: string;
  bundleId: string;
  appContainerPath: string;
  binaryHash: string;
}>;

type InstalledPathMetadata = Readonly<{
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}>;

function installedPathMetadata(value: Awaited<ReturnType<typeof lstat>>): InstalledPathMetadata {
  return {
    dev: Number(value.dev),
    ino: Number(value.ino),
    uid: Number(value.uid),
    gid: Number(value.gid),
    mode: Number(value.mode),
    nlink: Number(value.nlink),
    size: Number(value.size),
    mtimeMs: Number(value.mtimeMs),
    ctimeMs: Number(value.ctimeMs),
  };
}

function sameInstalledPathMetadata(
  left: InstalledPathMetadata,
  right: InstalledPathMetadata,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

const IOS_BINARY_HASH = /^[a-f0-9]{64}$/;

export function requireOwnedIosInstalledAppBinding(
  value: unknown,
  expected: Readonly<{ deviceUdid: string; bundleId: string; binaryHash: string }>,
): IosInstalledAppObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Installed iOS app proof is not an object');
  const row = value as Record<string, unknown>;
  if (row.source !== 'owned-simulator-installed-app')
    throw new Error('Installed iOS app proof source is invalid');
  if (row.deviceUdid !== expected.deviceUdid)
    throw new Error('Installed iOS app proof belongs to a different simulator');
  if (row.bundleId !== expected.bundleId)
    throw new Error('Installed iOS app proof belongs to a different bundle');
  if (
    typeof row.appContainerPath !== 'string' ||
    !path.isAbsolute(row.appContainerPath) ||
    row.appContainerPath !== path.normalize(row.appContainerPath) ||
    row.appContainerPath.includes('\n') ||
    !row.appContainerPath.includes(`/Devices/${expected.deviceUdid}/`) ||
    !path.basename(row.appContainerPath).endsWith('.app')
  )
    throw new Error('Installed iOS app proof path is invalid');
  if (row.binaryHash !== expected.binaryHash || !IOS_BINARY_HASH.test(String(row.binaryHash)))
    throw new Error('Installed iOS app proof build hash differs from the qualified build');
  return {
    source: 'owned-simulator-installed-app',
    deviceUdid: row.deviceUdid,
    bundleId: row.bundleId,
    appContainerPath: row.appContainerPath,
    binaryHash: row.binaryHash,
  };
}

function installedAppCommandTimeout(deadlineAtMonotonicMs: number): number {
  if (!Number.isFinite(deadlineAtMonotonicMs))
    throw new Error('Installed iOS app proof deadline is invalid');
  const remaining = Math.floor(deadlineAtMonotonicMs - performance.now());
  if (remaining < 1) throw new Error('Installed iOS app proof deadline exceeded');
  return Math.min(15_000, remaining);
}

/**
 * Read-only post-bootstrap verification. It never installs or launches an
 * app. The simulator target is re-verified before and after each identity
 * read, while simctl, Info.plist, and the installed bundle tree bind the
 * result to the requested UDID, bundle identifier, and qualified build hash.
 */
export async function verifyOwnedIosInstalledApp(
  device: Readonly<{ udid: string; verify: (signal?: AbortSignal) => Promise<void> }>,
  bundleId: string,
  expectedBinaryHash: string,
  signal: AbortSignal | undefined,
  deadlineAtMonotonicMs: number,
): Promise<IosInstalledAppObservation> {
  if (!IOS_BINARY_HASH.test(expectedBinaryHash))
    throw new Error('Installed iOS app proof expected build hash is invalid');
  if (bundleId !== 'com.edufelip.mychampions.dev')
    throw new Error('Installed iOS app proof requires the existing dev app');
  const check = () => {
    signal?.throwIfAborted();
    installedAppCommandTimeout(deadlineAtMonotonicMs);
  };
  check();
  await device.verify(signal);
  check();
  const appContainerPath = (
    await execute('xcrun', ['simctl', 'get_app_container', device.udid, bundleId, 'app'], {
      timeout: installedAppCommandTimeout(deadlineAtMonotonicMs),
      signal,
    })
  ).stdout.trim();
  check();
  const marker = `/Devices/${device.udid}/`;
  if (
    !appContainerPath ||
    !path.isAbsolute(appContainerPath) ||
    appContainerPath.indexOf(marker) < 0 ||
    appContainerPath.includes('\n') ||
    !path.basename(appContainerPath).endsWith('.app') ||
    (await realpath(appContainerPath)) !== appContainerPath
  )
    throw new Error('Installed iOS app container does not belong to the owned device');
  const appMetadata = await lstat(appContainerPath);
  const appIdentityBeforeHash = installedPathMetadata(appMetadata);
  if (
    !appMetadata.isDirectory() ||
    appMetadata.isSymbolicLink() ||
    appMetadata.uid !== process.getuid?.()
  )
    throw new Error('Installed iOS app container identity is invalid');
  const infoPlist = path.join(appContainerPath, 'Info.plist');
  const plistMetadata = await lstat(infoPlist);
  const plistIdentityBeforeHash = installedPathMetadata(plistMetadata);
  if (!plistMetadata.isFile() || plistMetadata.isSymbolicLink())
    throw new Error('Installed iOS app Info.plist identity is invalid');
  const installedBundleId = (
    await execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', infoPlist], {
      timeout: installedAppCommandTimeout(deadlineAtMonotonicMs),
      signal,
    })
  ).stdout.trim();
  check();
  if (installedBundleId !== bundleId)
    throw new Error('Installed iOS app bundle identifier differs from the requested bundle');
  const installedBinaryHash = await treeHash(appContainerPath, {
    signal,
    deadlineAtMonotonicMs,
    verifyStableIdentity: true,
  });
  check();
  const appIdentityAfterHash = installedPathMetadata(await lstat(appContainerPath));
  const plistIdentityAfterHash = installedPathMetadata(await lstat(infoPlist));
  if (
    !sameInstalledPathMetadata(appIdentityBeforeHash, appIdentityAfterHash) ||
    !sameInstalledPathMetadata(plistIdentityBeforeHash, plistIdentityAfterHash) ||
    (await realpath(appContainerPath)) !== appContainerPath ||
    (await realpath(infoPlist)) !== infoPlist
  )
    throw new Error('Installed iOS app identity changed while its bytes were being hashed');
  if (installedBinaryHash !== expectedBinaryHash)
    throw new Error('Installed iOS app bytes differ from the qualified build');
  await device.verify(signal);
  check();
  return requireOwnedIosInstalledAppBinding(
    {
      source: 'owned-simulator-installed-app',
      deviceUdid: device.udid,
      bundleId,
      appContainerPath,
      binaryHash: installedBinaryHash,
    },
    { deviceUdid: device.udid, bundleId, binaryHash: expectedBinaryHash },
  );
}

/** Bounded capture-owned command facts used to bind visibility evidence. */
export type IosCameraCommandExecution = Readonly<{
  label: string;
  command: string;
  argv: readonly string[];
  phase: string;
  execution: string;
  cleanup: string;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  deadlineMs: number;
  logPath: string | null;
  ownershipPath: string | null;
}>;

export const iosCameraPreludeMarkerSource = 'owned-api-proxy.requestIdFence+observations' as const;
export const iosCameraEndMarkerSource =
  'owned-api-proxy.waitForQuiescence+requestIdFence+observations' as const;

export type IosCameraPreludeBoundary = Readonly<{
  requestIdFence: number;
  observationCount: number;
  observationPrefixSha256: string;
  source: typeof iosCameraPreludeMarkerSource;
}>;

/**
 * Capture the authenticated prelude marker from the same proxy instance that
 * will produce the camera transport sidecar. The prefix digest makes the
 * numeric fence meaningful when the report is later read independently.
 */
export function captureIosCameraPreludeBoundary(
  observations: readonly ProxyObservation[],
  requestIdFence: number,
): IosCameraPreludeBoundary {
  if (!Number.isSafeInteger(requestIdFence) || requestIdFence < 0)
    throw new Error('Camera prelude request fence is invalid');
  const prefix = observations.filter((row) => row.requestId <= requestIdFence);
  if (
    prefix.some(
      (row) =>
        !Number.isSafeInteger(row.requestId) || row.requestId < 1 || row.requestId > requestIdFence,
    ) ||
    new Set(prefix.map((row) => row.requestId)).size !== prefix.length ||
    prefix.length !== requestIdFence ||
    [...prefix]
      .map((row) => row.requestId)
      .sort((left, right) => left - right)
      .some((requestId, index) => requestId !== index + 1)
  )
    throw new Error('Camera prelude observations are not a complete owned prefix');
  return {
    requestIdFence,
    observationCount: prefix.length,
    observationPrefixSha256: createHash('sha256').update(JSON.stringify(prefix)).digest('hex'),
    source: iosCameraPreludeMarkerSource,
  };
}

/** Reads only this freshly owned target's camera decision; never changes TCC. */
export async function readOwnedIosCameraPermission(
  device: { udid: string; verify: (signal?: AbortSignal) => Promise<void> },
  bundleId: string,
  signal?: AbortSignal,
): Promise<IosCameraPermissionObservation> {
  if (bundleId !== 'com.edufelip.mychampions.dev')
    throw new Error('Camera observation requires the existing dev app');
  signal?.throwIfAborted();
  await device.verify(signal);
  signal?.throwIfAborted();
  const container = (
    await execute('xcrun', ['simctl', 'get_app_container', device.udid, bundleId, 'data'], {
      timeout: 15_000,
      signal,
    })
  ).stdout.trim();
  signal?.throwIfAborted();
  const marker = `/Devices/${device.udid}/data/`;
  const index = container.indexOf(marker);
  if (
    index < 0 ||
    container.indexOf(marker, index + 1) !== -1 ||
    !container.slice(index + marker.length).startsWith('Containers/Data/Application/') ||
    (await realpath(container)) !== container
  )
    throw new Error('Camera permission container does not belong to the owned device');
  const database = path.join(container.slice(0, index + marker.length), 'Library/TCC/TCC.db');
  const metadata = await lstat(database);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (await realpath(database)) !== database
  )
    throw new Error('Owned camera permission database identity is invalid');
  const query =
    "SELECT service,client,client_type,auth_value,auth_reason FROM access WHERE service='kTCCServiceCamera' AND client='com.edufelip.mychampions.dev'";
  const { stdout } = await execute('/usr/bin/sqlite3', ['-readonly', '-json', database, query], {
    timeout: 15_000,
    maxBuffer: 16 * 1024,
    signal,
  });
  signal?.throwIfAborted();
  await device.verify(signal);
  signal?.throwIfAborted();
  const rows: unknown = stdout.trim() ? JSON.parse(stdout) : [];
  if (!Array.isArray(rows) || rows.length > 1)
    throw new Error('Owned camera permission query returned ambiguous records');
  return {
    source: 'owned-simulator-tcc-read-only',
    deviceUdid: device.udid,
    bundleId,
    rows: rows as IosCameraPermissionObservation['rows'],
  };
}

export async function observeIosCameraDenial({
  output,
  report,
  studentAuthUid,
  displayName,
  permission,
  snapshot,
  observations,
  waitForQuiescence,
  requestIdFence,
  preludeRequestIdFence,
  preludeObservationCount,
  preludeObservationPrefixSha256,
  cameraInitialAuthAfterRequestId,
  observe,
  signal,
}: {
  output: string;
  report: Record<string, unknown>;
  studentAuthUid: string;
  displayName: string;
  permission: () => Promise<IosCameraPermissionObservation>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  observations: () => readonly ProxyObservation[];
  waitForQuiescence: (deadlineMs: number, signal?: AbortSignal) => Promise<unknown>;
  requestIdFence: () => number;
  preludeRequestIdFence: number;
  preludeObservationCount: number;
  preludeObservationPrefixSha256: string;
  cameraInitialAuthAfterRequestId: number;
  observe: (
    label: string,
    actions: string,
    viewId: string,
    selectors: string | string[],
    selectorKind?: 'id' | 'text',
  ) => Promise<void>;
  signal?: AbortSignal;
}) {
  const check = () => signal?.throwIfAborted();
  if (
    !Number.isSafeInteger(preludeRequestIdFence) ||
    preludeRequestIdFence < 0 ||
    !Number.isSafeInteger(preludeObservationCount) ||
    preludeObservationCount < 0 ||
    !/^[a-f0-9]{64}$/.test(preludeObservationPrefixSha256) ||
    !Number.isSafeInteger(cameraInitialAuthAfterRequestId) ||
    cameraInitialAuthAfterRequestId < 0 ||
    preludeRequestIdFence < cameraInitialAuthAfterRequestId
  )
    throw new Error('Camera prelude boundary is not bound to the authenticated student');
  const put = (name: string, value: unknown) =>
    (async () => {
      check();
      const bytes = Buffer.from(JSON.stringify(value));
      await writeFile(path.join(output, name), JSON.stringify(value), {
        flag: 'wx',
        mode: 0o600,
      });
      check();
      return {
        path: name,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    })();
  check();
  const before = await snapshot();
  const beforeReference = {
    ...(await put('camera-before.private.json', before)),
    source: 'owned-session.snapshot',
    runId: before.runId,
    scope: before.scope,
  };
  if (before.connections.some((row) => row.studentAuthUid === studentAuthUid))
    throw new Error('Camera charter requires an unlinked fixture student');
  const initialPermission = await permission();
  check();
  await put('camera-permission-before.private.json', initialPermission);
  if (initialPermission.rows.length !== 0)
    throw new Error('New simulator already has a camera permission decision');
  await observe(
    'camera-relationships',
    '- tapOn:\n    id: student.home.accountButton',
    'SCR-student-professionals',
    ['student.professionals.screen', 'student.professionals.codeInput'],
  );
  await observe(
    'camera-prompt',
    '- tapOn:\n    id: student.professionals.scanQrButton',
    'STATE-camera-prompt',
    'Allow',
    'text',
  );
  const prompt: unknown = JSON.parse(
    readNativeEvidence(output, 'camera-prompt-hierarchy.json', true).toString('utf8'),
  );
  const deny = ["Don't Allow", 'Don’t Allow'].find((label) =>
    nativeHierarchyHasAttribute(prompt, 'accessibilityText', label),
  );
  const promptTitle = [
    `“${displayName}” would like to access the Camera.`,
    `"${displayName}" would like to access the Camera.`,
  ].find((title) => nativeHierarchyHasAttribute(prompt, 'accessibilityText', title));
  if (!deny || !promptTitle)
    throw new Error('Observed system dialog is not the target app camera request');
  await observe(
    'camera-guidance',
    `- tapOn: ${JSON.stringify('^' + deny + '$')}`,
    'STATE-camera-guidance',
    ['student.professionals.submitError', 'student.professionals.codeInput'],
  );
  const guidance: unknown = JSON.parse(
    readNativeEvidence(output, 'camera-guidance-hierarchy.json', true).toString('utf8'),
  );
  if (
    !nativeHierarchyHasAttribute(
      guidance,
      'accessibilityText',
      enUS['relationship.qr.permission_denied'],
    )
  )
    throw new Error('Camera denial did not show the documented manual-entry guidance');
  const finalPermission = await permission();
  check();
  await put('camera-permission-after.private.json', finalPermission);
  if (
    finalPermission.rows.length !== 1 ||
    finalPermission.rows[0].service !== 'kTCCServiceCamera' ||
    finalPermission.rows[0].client !== finalPermission.bundleId ||
    finalPermission.rows[0].client_type !== 0 ||
    finalPermission.rows[0].auth_value !== 0
  )
    throw new Error('Owned simulator does not record actual camera denial');
  const manualCode = 'QA-MANUAL-ONLY';
  await observe(
    'camera-manual',
    `- tapOn:\n    id: student.professionals.codeInput\n- inputText: ${JSON.stringify(manualCode)}`,
    'SCR-student-professionals',
    ['student.professionals.codeInput', 'student.professionals.connectButton'],
  );
  const manual: unknown = JSON.parse(
    readNativeEvidence(output, 'camera-manual-hierarchy.json', true).toString('utf8'),
  );
  if (!nativeHierarchyHasAttribute(manual, 'text', manualCode))
    throw new Error('Native manual-entry input does not contain the typed code');
  // The final denial observation must close over all request starts and wait
  // for every owned proxy operation to settle before publishing its end
  // fence. Otherwise a request that was issued during the denial journey can
  // complete after this function returns and disappear from the bounded
  // window while still being present in the later transport sidecar.
  await waitForQuiescence(5_000, signal);
  check();
  const denialEndRequestId = requestIdFence();
  const endTransport = observations();
  const endPrefix = endTransport.filter((row) => row.requestId <= denialEndRequestId);
  if (
    endTransport.some((row) => row.requestId > denialEndRequestId) ||
    endPrefix.length !== denialEndRequestId ||
    new Set(endPrefix.map((row) => row.requestId)).size !== endPrefix.length ||
    [...endPrefix]
      .map((row) => row.requestId)
      .sort((left, right) => left - right)
      .some((requestId, index) => requestId !== index + 1)
  )
    throw new Error('Camera denial end marker is not a complete quiesced raw snapshot');
  const denialTransport = endPrefix.filter((row) => row.requestId > preludeRequestIdFence);
  if (denialTransport.length === 0)
    throw new Error('Camera denial observation produced no post-prelude transport');
  const denialRequestIds = denialTransport.map((row) => row.requestId);
  const after = await snapshot();
  check();
  const afterReference = {
    ...(await put('camera-after.private.json', after)),
    source: 'owned-session.snapshot',
    runId: after.runId,
    scope: after.scope,
  };
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Camera inventory observation changed owned domain SQL');
  const transport = endTransport;
  if (
    !transport.some(
      (row) =>
        row.method === 'GET' &&
        row.pathHash === createHash('sha256').update('/connections').digest('hex') &&
        row.status === 200 &&
        row.outcome === 'forwarded' &&
        row.requestProfile === 'native',
    )
  )
    throw new Error('Camera inventory lacks a normal native relationship read');
  const denialFrames = (['camera-prompt', 'camera-guidance', 'camera-manual'] as const).map(
    (label) => {
      const hierarchyPath = `${label}-hierarchy.json`;
      const screenshotPath = `${label}.png`;
      const hierarchy = readNativeEvidence(output, hierarchyPath, true);
      const screenshot = readNativeEvidence(output, screenshotPath, false);
      return {
        label,
        viewId:
          label === 'camera-prompt'
            ? 'STATE-camera-prompt'
            : label === 'camera-guidance'
              ? 'STATE-camera-guidance'
              : 'SCR-student-professionals',
        hierarchyPath,
        screenshotPath,
        hierarchyBytes: hierarchy.length,
        hierarchySha256: createHash('sha256').update(hierarchy).digest('hex'),
        screenshotBytes: screenshot.length,
        screenshotSha256: createHash('sha256').update(screenshot).digest('hex'),
      };
    },
  );
  const prelude = transport.filter((row) => row.requestId <= preludeRequestIdFence);
  if (
    prelude.length !== preludeObservationCount ||
    createHash('sha256').update(JSON.stringify(prelude)).digest('hex') !==
      preludeObservationPrefixSha256
  )
    throw new Error('Camera prelude marker does not match the owned proxy observations');
  report.cameraPreparation = {
    requirementRefs: ['SC-211', 'UC-002.9', 'AC-249', 'BL-018/P4-camera-denied'],
    studentAuthUid,
    displayName,
    promptTitle,
    denialControl: deny,
    manualCode,
    snapshotPaths: ['camera-before.private.json', 'camera-after.private.json'],
    permissionPaths: [
      'camera-permission-before.private.json',
      'camera-permission-after.private.json',
    ],
    denialFrames,
    snapshotReferences: [beforeReference, afterReference],
    transportPreludeRequestIdFence: preludeRequestIdFence,
    transportPreludeObservationCount: preludeObservationCount,
    transportPreludeObservationPrefixSha256: preludeObservationPrefixSha256,
    transportPreludeMarkerSource: iosCameraPreludeMarkerSource,
    transportEndObservationCount: endPrefix.length,
    transportEndObservationPrefixSha256: createHash('sha256')
      .update(JSON.stringify(endPrefix))
      .digest('hex'),
    transportEndMarkerSource: iosCameraEndMarkerSource,
    transportStartRequestId: preludeRequestIdFence + 1,
    transportEndRequestId: denialEndRequestId,
    transportRequestIds: denialRequestIds,
    ownedSqlBeforeAfterUnchanged: true,
    scope: 'os-denial-and-manual-entry-views-only; no invite submission pass',
  };
}

/**
 * Continue the real camera-denial observation with the integrated manual
 * submission. This is private preparation evidence; the existing observer
 * remains the no-submit inventory path.
 */
export async function observeIosCameraDeniedManualSubmit({
  output,
  report,
  fixtures,
  proxy,
  apiIdentity,
  snapshot,
  connectionSnapshot,
  isolationSnapshot,
  connectionIsolationFixtures,
  commandExecutions,
  observe,
  switchAccount,
  signal,
}: {
  output: string;
  report: Record<string, unknown>;
  fixtures: OwnedFixtures;
  proxy: { observations: readonly ProxyObservation[] };
  apiIdentity: { apiPid: number; targetOrigin: string };
  snapshot: () => Promise<OwnedDomainSnapshot>;
  connectionSnapshot: () => Promise<OwnedConnectionSnapshot>;
  isolationSnapshot: () => Promise<OwnedConnectionSnapshot>;
  connectionIsolationFixtures: OwnedFixtures;
  commandExecutions: readonly IosCameraCommandExecution[];
  observe: (
    label: string,
    actions: string,
    viewId: string,
    selectors: string | string[],
    selectorKind?: 'id' | 'text',
  ) => Promise<void>;
  switchAccount: (
    actor: 'coach' | 'student',
    backActions?: string,
  ) => Promise<{
    actor: 'coach' | 'student';
    actorAuthUid: string;
    beforeRequestId: number;
    authRequestId: number;
    afterRequestId: number;
  }>;
  signal: AbortSignal;
}): Promise<void> {
  const check = () => signal.throwIfAborted();
  const target: NativeConnectionTargetScope = {
    runId: fixtures.runId,
    scope: IOS_CONNECTION_PLATFORM.fixtureScope,
    fixtureAuthUids: Object.values(fixtures.accounts)
      .map((account) => account.authUid)
      .sort(),
    professionalAuthUid: fixtures.accounts.coach.authUid,
    studentAuthUid: fixtures.accounts.student.authUid,
  };
  const expected = {
    ...target,
    target: {
      professionalAuthUid: target.professionalAuthUid,
      studentAuthUid: target.studentAuthUid,
      specialty: 'fitness_coach' as const,
    },
  };
  const isolationFixtureAuthUids = Object.values(connectionIsolationFixtures.accounts)
    .map((account) => account.authUid)
    .sort();
  const primaryFixtureAuthUids = target.fixtureAuthUids;
  if (isolationFixtureAuthUids.some((authUid) => primaryFixtureAuthUids.includes(authUid)))
    throw new Error('Camera connection isolation fixture overlaps the primary fixture identities');
  if (
    connectionIsolationFixtures.scope !== IOS_CONNECTION_PLATFORM.isolationScope ||
    connectionIsolationFixtures.runId !== fixtures.runId ||
    new Set(isolationFixtureAuthUids).size !== isolationFixtureAuthUids.length
  )
    throw new Error('Camera connection isolation fixture identity is not bound to the capture run');
  const isolationTarget = {
    professionalAuthUid: connectionIsolationFixtures.accounts.coach.authUid,
    studentAuthUid: connectionIsolationFixtures.accounts.student.authUid,
    specialty: 'fitness_coach' as const,
  };
  const isolationFixtureEvidence = report.connectionIsolationFixtureEvidence;
  if (
    !isolationFixtureEvidence ||
    typeof isolationFixtureEvidence !== 'object' ||
    Array.isArray(isolationFixtureEvidence) ||
    (isolationFixtureEvidence as Record<string, unknown>).path !==
      'fixtures-native-connection-isolation-ios.private.json' ||
    (isolationFixtureEvidence as Record<string, unknown>).source !== 'owned-session.fixtures' ||
    (isolationFixtureEvidence as Record<string, unknown>).runId !==
      connectionIsolationFixtures.runId ||
    (isolationFixtureEvidence as Record<string, unknown>).scope !==
      connectionIsolationFixtures.scope ||
    !/^[a-f0-9]{64}$/.test(String((isolationFixtureEvidence as Record<string, unknown>).sha256))
  )
    throw new Error('Camera isolation fixture evidence receipt is missing or stale');
  const put = async (name: string, value: unknown) => {
    check();
    const bytes = Buffer.from(JSON.stringify(value));
    await writeFile(path.join(output, name), JSON.stringify(value), {
      flag: 'wx',
      mode: 0o600,
    });
    check();
    return {
      path: name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  const readHierarchy = (name: string): unknown => {
    check();
    const bytes = readNativeEvidence(output, name, true);
    check();
    return JSON.parse(bytes.toString('utf8'));
  };
  const ordinal = () =>
    proxy.observations.reduce((maximum, row) => Math.max(maximum, row.requestId), 0);

  // The camera observer has already proved a fresh unlinked target and actual
  // denial. Keep account switching outside the mutation baseline because auth
  // sign-in advances the actor profile updatedAt timestamp.
  const initialBefore = await connectionSnapshot();
  check();
  verifyConnectionSnapshotCheckpoint({
    snapshot: initialBefore,
    checkpoint: 'unlinked',
    expected,
  });

  const coachSwitch = await switchAccount('coach', 'student-professionals-back');
  check();
  await observe(
    'camera-coach-invite',
    '- scrollUntilVisible:\n    element:\n      id: pro.home.inviteCodeValue\n    direction: DOWN\n    timeout: 30000\n    centerElement: true',
    'SCR-pro-home',
    [
      IOS_CONNECTION_PLATFORM.selectors.coachInviteCode,
      IOS_CONNECTION_PLATFORM.selectors.coachHome,
    ],
  );
  const coachInviteCommands = commandExecutions.filter(
    (execution) => execution.label === 'camera-coach-invite',
  );
  if (coachInviteCommands.length !== 1)
    throw new Error('Camera coach invite visibility command is not uniquely recorded');
  const coachInviteCommand = coachInviteCommands[0];
  const coachInviteFlowPath = path.join(output, 'camera-coach-invite.yaml');
  if (
    coachInviteCommand.command !== 'maestro' ||
    coachInviteCommand.phase !== 'step' ||
    coachInviteCommand.execution !== 'completed' ||
    coachInviteCommand.cleanup !== 'cleaned' ||
    coachInviteCommand.childExitCode !== 0 ||
    coachInviteCommand.childSignal !== null ||
    !Number.isSafeInteger(coachInviteCommand.deadlineMs) ||
    coachInviteCommand.deadlineMs <= 0 ||
    typeof coachInviteCommand.logPath !== 'string' ||
    typeof coachInviteCommand.ownershipPath !== 'string' ||
    coachInviteCommand.argv.at(-1) !== coachInviteFlowPath
  )
    throw new Error('Camera coach invite visibility command is not an owned completed flow');
  const coachInviteActionExecution = {
    label: coachInviteCommand.label,
    command: coachInviteCommand.command,
    argv: [...coachInviteCommand.argv],
    phase: coachInviteCommand.phase,
    execution: coachInviteCommand.execution,
    cleanup: coachInviteCommand.cleanup,
    childExitCode: coachInviteCommand.childExitCode,
    childSignal: coachInviteCommand.childSignal,
    deadlineMs: coachInviteCommand.deadlineMs,
    logPath: coachInviteCommand.logPath,
    ownershipPath: coachInviteCommand.ownershipPath,
  };
  const normalizedCoachInvite = normalizeCoachInviteHierarchy(
    readHierarchy('camera-coach-invite-hierarchy.json'),
    true,
  );
  const inviteCode = normalizedCoachInvite.inviteCode;
  const coachInviteHierarchy = readNativeEvidence(
    output,
    'camera-coach-invite-hierarchy.json',
    true,
  );
  const coachInviteScreenshot = readNativeEvidence(output, 'camera-coach-invite.png', false);
  const coachInviteFrame = {
    actor: 'coach' as const,
    actorAuthUid: fixtures.accounts.coach.authUid,
    authRequestId: coachSwitch.authRequestId,
    viewId: 'SCR-pro-home',
    hierarchyPath: 'camera-coach-invite-hierarchy.json',
    screenshotPath: 'camera-coach-invite.png',
    hierarchyBytes: coachInviteHierarchy.length,
    hierarchySha256: createHash('sha256').update(coachInviteHierarchy).digest('hex'),
    screenshotBytes: coachInviteScreenshot.length,
    screenshotSha256: createHash('sha256').update(coachInviteScreenshot).digest('hex'),
    inviteCodeSha256: createHash('sha256').update(inviteCode).digest('hex'),
    inviteCodeBytes: Buffer.byteLength(inviteCode),
    screenNodePath: normalizedCoachInvite.screenPath,
    inviteNodePath: normalizedCoachInvite.invitePath,
    actionExecution: coachInviteActionExecution,
  };
  await switchAccount('student');
  check();
  await observe(
    'camera-student-entry',
    '- tapOn:\n    id: student.home.accountButton',
    'SCR-student-professionals',
    [
      IOS_CONNECTION_PLATFORM.selectors.studentProfessionalsScreen,
      IOS_CONNECTION_PLATFORM.selectors.studentCodeInput,
    ],
  );

  // Fresh baseline after both authenticated switches. The strict submission
  // validator must see unchanged profiles across only the submit mutation.
  const before = await connectionSnapshot();
  check();
  verifyConnectionSnapshotCheckpoint({
    snapshot: before,
    checkpoint: 'unlinked',
    expected,
  });
  const isolationBefore = await isolationSnapshot();
  const trainingBefore = await snapshot();
  check();
  const connectionBeforeReference = {
    ...(await put('camera-connection-before.private.json', before)),
    source: 'owned-session.snapshot',
    runId: before.runId,
    scope: before.scope,
  };
  const isolationBeforeReference = {
    ...(await put('camera-isolation-before.private.json', isolationBefore)),
    source: 'owned-session.snapshot',
    runId: isolationBefore.runId,
    scope: isolationBefore.scope,
  };
  const trainingBeforeReference = {
    ...(await put('camera-training-before.private.json', trainingBefore)),
    source: 'owned-session.snapshot',
    runId: trainingBefore.runId,
    scope: trainingBefore.scope,
  };

  const submissionActions = buildNativeConnectionSubmissionActions(
    IOS_CONNECTION_PLATFORM,
    inviteCode,
  );
  const submissionStart = ordinal();
  await observe(
    'camera-live-manual-submit',
    submissionActions,
    'STATE-connection-pending',
    IOS_CONNECTION_PLATFORM.selectors.studentProfessionalsScreen,
  );
  check();
  const submissionThrough = ordinal();
  const submission = requireNativeConnectionTransport({
    observations: proxy.observations,
    method: 'POST',
    route: '/connections/invite-submissions',
    status: 201,
    targetOrigin: apiIdentity.targetOrigin,
    afterRequestId: submissionStart,
    throughRequestId: submissionThrough,
    unique: true,
  });
  const submissionFlowBytes = readNativeEvidence(output, 'camera-live-manual-submit.yaml', true);
  const submissionFlowReference = {
    path: 'camera-live-manual-submit.yaml',
    bytes: submissionFlowBytes.length,
    sha256: createHash('sha256').update(submissionFlowBytes).digest('hex'),
    source: 'owned-maestro-flow',
    runId: fixtures.runId,
    scope: IOS_CONNECTION_PLATFORM.fixtureScope,
    sourcePath: 'scripts/testing/native-connection-journey-core.ts',
    sourceSha256: createHash('sha256')
      .update(
        await readFile(
          path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            'native-connection-journey-core.ts',
          ),
        ),
      )
      .digest('hex'),
    actionSha256: createHash('sha256').update(submissionActions).digest('hex'),
  };
  const pending = await connectionSnapshot();
  check();
  verifyConnectionSubmissionSnapshotTransition({ before, pending, fixtures });
  const targetConnections = pending.rows.connections.filter(
    (row) =>
      row.professionalAuthUid === target.professionalAuthUid &&
      row.studentAuthUid === target.studentAuthUid &&
      row.specialty === 'fitness_coach',
  );
  assert.equal(targetConnections.length, 1, 'pending target connection is not unique');
  const connectionId = targetConnections[0].id;
  const pendingSelector = `${IOS_CONNECTION_PLATFORM.selectors.pendingStudentCardPrefix}${connectionId}`;
  await observe(
    'camera-pending',
    `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(pendingSelector)}\n    direction: DOWN\n    timeout: 30000\n    centerElement: true`,
    'STATE-connection-pending',
    [IOS_CONNECTION_PLATFORM.selectors.studentProfessionalsScreen, pendingSelector],
  );
  const pendingStudentMatch = resolvePendingStudentConnectionCard({
    tree: readHierarchy('camera-pending-hierarchy.json'),
    snapshot: pending,
    target,
    expectedPendingGuidance: enUS['relationship.pending.helper'],
  });
  const pendingHierarchyBytes = readNativeEvidence(output, 'camera-pending-hierarchy.json', true);
  const pendingScreenshotBytes = readNativeEvidence(output, 'camera-pending.png', false);
  const pendingFrame = {
    viewId: 'STATE-connection-pending',
    hierarchyPath: 'camera-pending-hierarchy.json',
    screenshotPath: 'camera-pending.png',
    hierarchyBytes: pendingHierarchyBytes.length,
    hierarchySha256: createHash('sha256').update(pendingHierarchyBytes).digest('hex'),
    screenshotBytes: pendingScreenshotBytes.length,
    screenshotSha256: createHash('sha256').update(pendingScreenshotBytes).digest('hex'),
  };
  const pendingReference = {
    ...(await put('camera-connection-pending.private.json', pending)),
    source: 'owned-session.snapshot',
    runId: pending.runId,
    scope: pending.scope,
  };
  await put('camera-pending-card.private.json', {
    ...pendingStudentMatch,
    hierarchyPath: 'camera-pending-hierarchy.json',
    hierarchySha256: createHash('sha256').update(pendingHierarchyBytes).digest('hex'),
  });

  const isolationAfter = await isolationSnapshot();
  const trainingAfter = await snapshot();
  check();
  // Persist both complete raw snapshots before semantic comparison so a
  // failed comparison retains the producer's diagnostic bytes and identity.
  const isolationAfterReference = {
    ...(await put('camera-isolation-after.private.json', isolationAfter)),
    source: 'owned-session.snapshot',
    runId: isolationAfter.runId,
    scope: isolationAfter.scope,
  };
  const trainingAfterReference = {
    ...(await put('camera-training-after.private.json', trainingAfter)),
    source: 'owned-session.snapshot',
    runId: trainingAfter.runId,
    scope: trainingAfter.scope,
  };
  check();
  assert.deepEqual(
    isolationAfter,
    isolationBefore,
    'camera submit changed unrelated connection state',
  );
  assertCameraDomainConnectionBindings({
    beforeDomain: trainingBefore,
    afterDomain: trainingAfter,
    beforeConnection: before,
    afterConnection: pending,
    target: {
      professionalAuthUid: target.professionalAuthUid,
      studentAuthUid: target.studentAuthUid,
      specialty: 'fitness_coach',
    },
    inviteCode,
  });
  assertCameraNonConnectionStateUnchanged(
    trainingBefore,
    trainingAfter,
    'camera submit changed unrelated training state',
  );
  const submissionRequestIds = submission.map((row) => row.requestId);
  assert.equal(submission.length, 1);
  const submissionRequest = submission[0];
  const coachInviteEvidence = {
    schemaVersion: 1,
    source: 'authenticated-coach-home-ui',
    ...coachInviteFrame,
    submissionRequestIds,
  };
  await put('camera-coach-invite-code.private.json', coachInviteEvidence);
  report.cameraSubmissionPreparation = {
    requirementRefs: ['SC-211', 'UC-002.9', 'AC-249', 'BL-018/P4-camera-denied'],
    fixtureScope: fixtures.scope,
    target: {
      professionalAuthUid: target.professionalAuthUid,
      studentAuthUid: target.studentAuthUid,
      specialty: expected.target.specialty,
    },
    coachCodeSource: 'authenticated-coach-home-ui',
    submissionRoute: '/connections/invite-submissions',
    submissionStatus: 201,
    submissionRequestIds,
    snapshotPaths: [
      'camera-connection-before.private.json',
      'camera-connection-pending.private.json',
      'camera-pending-card.private.json',
      'camera-isolation-before.private.json',
      'camera-isolation-after.private.json',
      'camera-training-before.private.json',
      'camera-training-after.private.json',
    ],
    unrelatedConnectionStateUnchanged: true,
    unrelatedTrainingStateUnchanged: true,
    fixtureEvidencePath: 'fixtures.private.json',
    fixtureHash: report.fixtureHash,
    isolationFixtureEvidencePath: 'fixtures-native-connection-isolation-ios.private.json',
    isolationFixtureHash: (
      report.connectionIsolationFixtureEvidence as { sha256?: unknown } | undefined
    )?.sha256,
    isolationTarget,
    submissionFlowReference,
    submissionRequestBinding: {
      requestId: submissionRequest.requestId,
      method: submissionRequest.method,
      pathHash: submissionRequest.pathHash,
      requestOrigin: submissionRequest.requestOrigin,
      requestProfile: submissionRequest.requestProfile,
      targetOrigin: submissionRequest.targetOrigin,
      status: submissionRequest.status,
      outcome: submissionRequest.outcome,
      faultAttemptId: submissionRequest.faultAttemptId,
    },
    domainSnapshotReferences: [
      connectionBeforeReference,
      pendingReference,
      isolationBeforeReference,
      isolationAfterReference,
    ],
    trainingSnapshotReferences: [trainingBeforeReference, trainingAfterReference],
    pendingFrame,
    coachInviteEvidencePath: 'camera-coach-invite-code.private.json',
    coachInviteFrame: { ...coachInviteFrame, submissionRequestIds },
    nativePassingCases: 0,
    scope: 'actual-camera-denial-plus-live-manual-submit-pending-ui-api-sql; no confirmation pass',
  };
}

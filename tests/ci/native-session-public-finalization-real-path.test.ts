import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { promisify } from 'node:util';
import { sourceIdentity } from '../../scripts/testing/native-build-identity';
import {
  nativeSessionAssertionIds,
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';
import {
  nativeSessionHelperInputPaths,
  readNativeSessionHelperInputs,
} from '../../scripts/testing/native-session-helper-ledger';
import { nativeSessionProfileCheckpointIds } from '../../scripts/testing/native-session-profile-checkpoints';
import {
  loadNativeSessionPublicDependency,
  type SessionCaptureCandidate,
  type SessionEvidenceReceiptCandidate,
} from '../../scripts/testing/native-session-public-dependency';
import {
  buildNativeSessionPublicFinalizationCandidate,
  removeNativeSessionPublicEvidenceStage,
  stageNativeSessionPublicEvidence,
  validateNativeSessionPublicFinalizationControls,
  verifyNativeSessionPublicEvidence,
  type NativeSessionPublicFinalizationInput,
} from '../../scripts/testing/native-session-public-finalization';
import { nativeObservedSelectors } from '../../scripts/testing/native-view-evidence';
import type { OwnedConnectionSnapshot } from '../../scripts/testing/native-connection-snapshot';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

const execute = promisify(execFile);
const candidateRoot = path.resolve(
  process.env.MYCHAMPIONS_SOURCE_ROOT ?? path.resolve(__dirname, '../..'),
);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const pngBytes = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex');
const postTapFlowPath = 'session-signout-post-tap.yaml';
const postTapHierarchyPath = 'session-signout-post-tap-hierarchy.json';
const postTapScreenshotPath = 'session-signout-post-tap.png';
const postTapFlowBytes = Buffer.from(
  'appId: com.example.mychampions\nname: Native inventory session-signout-post-tap\n---\n' +
    '- scrollUntilVisible:\n' +
    '    element:\n' +
    '      id: settings.account.signOutCta\n' +
    '    direction: DOWN\n' +
    '    timeout: 30000\n' +
    '- tapOn:\n' +
    '    id: settings.account.signOutCta\n',
);
const postTapHierarchyBytes = Buffer.from(
  JSON.stringify({
    attributes: { 'resource-id': 'settings.account.screen' },
    children: [
      { attributes: { 'resource-id': 'settings.account.signOutCta' }, children: [] },
      { attributes: { 'resource-id': 'settings.account.signOutConfirm' }, children: [] },
      { attributes: { 'resource-id': 'settings.account.signOutConfirmCta' }, children: [] },
    ],
  }),
);
const postTapScreenshotBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const postTapDiagnostic = {
  label: 'session-signout-post-tap',
  flowPath: postTapFlowPath,
  flowBytes: postTapFlowBytes.length,
  flowHash: sha256(postTapFlowBytes),
  hierarchyPath: postTapHierarchyPath,
  hierarchyBytes: postTapHierarchyBytes.length,
  hierarchyHash: sha256(postTapHierarchyBytes),
  screenshotPath: postTapScreenshotPath,
  screenshotBytes: postTapScreenshotBytes.length,
  screenshotHash: sha256(postTapScreenshotBytes),
  selectorPresence: {
    accountScreen: true,
    signOutCta: true,
    signOutConfirm: true,
    signOutConfirmCta: true,
  },
};
const captureRunId = 'c'.repeat(24);
const fixtureRunId = 'b'.repeat(24);
const requestedRunId = 'a'.repeat(24);
const apiPid = process.pid;
const targetOrigin = 'http://127.0.0.1:43123';
const coachAuthUid = 'coach-uid';
const studentAuthUid = 'student-uid';
const fixtureAuthUids = [
  coachAuthUid,
  studentAuthUid,
  'unrelated-coach',
  'unrelated-student',
].sort();
const allowlistHash = sha256(JSON.stringify(fixtureAuthUids));
const timestamp = '2026-10-02T00:00:00.000Z';

type RealFixture = {
  parent: string;
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  selection: NativePilotSelection;
  input: NativeSessionPublicFinalizationInput;
  sourceFixture: SourceOnlyFixture;
};

type SourceOnlyFixture = {
  copiedRelativePaths: string[];
  excludedPrefixes: readonly string[];
  sourceIdentityDirectories: readonly string[];
  sourceIdentityFiles: readonly string[];
  inventoryOwnedPaths: string[];
  helperPaths: readonly string[];
};

type CreateFixtureOptions = {
  failAfterSourceCopy?: boolean;
  onParentCreated?: (parent: string) => void;
  removeParent?: (parent: string) => Promise<void>;
};

const sourceIdentityDirectories = [
  'app',
  'components',
  'features',
  'constants',
  'localization',
  'assets',
  'ios/mychampions',
  'ios/mychampions.xcodeproj',
] as const;
const sourceIdentityFiles = [
  'package.json',
  'yarn.lock',
  'app.config.ts',
  'ios/Podfile',
  'ios/Podfile.lock',
] as const;
const inventoryPath = 'docs/qa/native-pilot/inventory.json';
const validatorVendorRoot = 'scripts/testing/vendor/app-flow-maestro';
const excludedPrefixes = [
  '.qa',
  '.git',
  'node_modules',
  '.expo',
  'ios/build',
  'ios/Pods',
  'ios/DerivedData',
  'android/.gradle',
  'android/build',
  'android/app/build',
] as const;

function isExcludedRelativePath(relativePath: string): boolean {
  return excludedPrefixes.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  );
}

function assertSafeSourcePath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split('/').includes('..'))
    throw new Error(`source-only fixture path is not relative: ${relativePath}`);
  if (isExcludedRelativePath(relativePath))
    throw new Error(`source-only fixture path is excluded: ${relativePath}`);
}

async function copySourceFile(
  sourceRoot: string,
  destinationRoot: string,
  relativePath: string,
  copiedRelativePaths: Set<string>,
): Promise<void> {
  assertSafeSourcePath(relativePath);
  if (copiedRelativePaths.has(relativePath)) return;
  const sourcePath = path.join(sourceRoot, relativePath);
  const sourceMetadata = await lstat(sourcePath);
  if (!sourceMetadata.isFile())
    throw new Error(`source-only fixture requires a regular file: ${relativePath}`);
  if ((await realpath(sourcePath)) !== sourcePath)
    throw new Error(`source-only fixture rejects a symlink source: ${relativePath}`);
  const destinationPath = path.join(destinationRoot, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  await writeFile(destinationPath, await readFile(sourcePath), { flag: 'wx', mode: 0o600 });
  copiedRelativePaths.add(relativePath);
}

async function copySourceDirectory(
  sourceRoot: string,
  destinationRoot: string,
  relativeDirectory: string,
  copiedRelativePaths: Set<string>,
): Promise<void> {
  assertSafeSourcePath(relativeDirectory);
  const sourceDirectory = path.join(sourceRoot, relativeDirectory);
  const metadata = await lstat(sourceDirectory);
  if (!metadata.isDirectory())
    throw new Error(`source-only fixture requires a directory: ${relativeDirectory}`);
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    assertSafeSourcePath(relativePath);
    if (entry.isDirectory())
      await copySourceDirectory(sourceRoot, destinationRoot, relativePath, copiedRelativePaths);
    else if (entry.isFile())
      await copySourceFile(sourceRoot, destinationRoot, relativePath, copiedRelativePaths);
    else throw new Error(`source-only fixture rejects a non-regular source: ${relativePath}`);
  }
}

function inventoryOwnedPaths(inventory: unknown): string[] {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory))
    throw new Error('source-only fixture inventory is malformed');
  const value = inventory as Record<string, unknown>;
  const paths = new Set<string>([inventoryPath]);
  const rows = (key: string): Record<string, unknown>[] => {
    const entries = value[key];
    if (!Array.isArray(entries)) throw new Error(`source-only fixture inventory lacks ${key}`);
    return entries.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    );
  };
  for (const source of rows('sources'))
    for (const relative of Array.isArray(source.paths) ? source.paths : [])
      if (typeof relative === 'string') paths.add(relative);
  for (const view of rows('views'))
    for (const relative of Array.isArray(view.ownerPaths) ? view.ownerPaths : [])
      if (typeof relative === 'string') paths.add(relative);
  for (const scenario of rows('scenarios')) {
    for (const relative of Array.isArray(scenario.ownerPaths) ? scenario.ownerPaths : [])
      if (typeof relative === 'string') paths.add(relative);
    const freshness = scenario.freshnessInputs;
    if (freshness && typeof freshness === 'object' && !Array.isArray(freshness)) {
      const requirements = (freshness as Record<string, unknown>).requirementPaths;
      for (const relative of Array.isArray(requirements) ? requirements : [])
        if (typeof relative === 'string') paths.add(relative);
    }
    if (typeof scenario.maestroFlow === 'string') paths.add(scenario.maestroFlow);
  }
  return [...paths].sort();
}

async function copySourceOnlyRepository(
  sourceRoot: string,
  repositoryRoot: string,
): Promise<SourceOnlyFixture> {
  const copiedRelativePaths = new Set<string>();
  await mkdir(repositoryRoot, { recursive: true, mode: 0o700 });
  for (const relativeDirectory of sourceIdentityDirectories)
    await copySourceDirectory(sourceRoot, repositoryRoot, relativeDirectory, copiedRelativePaths);
  for (const relativePath of sourceIdentityFiles)
    await copySourceFile(sourceRoot, repositoryRoot, relativePath, copiedRelativePaths);
  const inventory = JSON.parse(
    await readFile(path.join(sourceRoot, inventoryPath), 'utf8'),
  ) as unknown;
  const ownedPaths = inventoryOwnedPaths(inventory);
  for (const relativePath of ownedPaths)
    await copySourceFile(sourceRoot, repositoryRoot, relativePath, copiedRelativePaths);
  for (const relativePath of nativeSessionHelperInputPaths)
    await copySourceFile(sourceRoot, repositoryRoot, relativePath, copiedRelativePaths);
  await copySourceDirectory(sourceRoot, repositoryRoot, validatorVendorRoot, copiedRelativePaths);
  for (const excludedPrefix of excludedPrefixes) {
    const destination = path.join(repositoryRoot, excludedPrefix);
    try {
      await lstat(destination);
      throw new Error(`source-only fixture copied excluded path: ${excludedPrefix}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {
    copiedRelativePaths: [...copiedRelativePaths].sort(),
    excludedPrefixes,
    sourceIdentityDirectories,
    sourceIdentityFiles,
    inventoryOwnedPaths: ownedPaths,
    helperPaths: nativeSessionHelperInputPaths,
  };
}

async function writeBytes(root: string, relativePath: string, bytes: Buffer): Promise<Buffer> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  return bytes;
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<Buffer> {
  return writeBytes(root, relativePath, Buffer.from(JSON.stringify(value)));
}

function snapshotRows() {
  return {
    userProfiles: fixtureAuthUids.map((authUid) => ({
      authUid,
      lockedRole: authUid === coachAuthUid ? ('professional' as const) : ('student' as const),
      acceptedTermsVersion: 'v1',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    professionalSpecialties: [],
    inviteCodes: [],
    connections: [],
    connectionInviteGuards: [],
    pendingStudents: [],
    pendingStudentSlots: [],
    trackingAccess: [],
    activeSpecialties: [],
  };
}

function profileSnapshot(runId: string): OwnedConnectionSnapshot {
  const rows = snapshotRows();
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    fixtureAuthUids: [...fixtureAuthUids],
    target: {
      professionalAuthUid: coachAuthUid,
      studentAuthUid,
      specialty: 'fitness_coach',
    },
    rowCounts: {
      userProfiles: rows.userProfiles.length,
      professionalSpecialties: 0,
      inviteCodes: 0,
      connections: 0,
      connectionInviteGuards: 0,
      pendingStudents: 0,
      pendingStudentSlots: 0,
      trackingAccess: 0,
      activeSpecialties: 0,
    },
    rows,
  };
}

function domainSnapshot(runId: string): OwnedDomainSnapshot {
  return {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
}

function receipt(
  relativePath: string,
  bytes: Buffer,
  artifactRoot: string,
): SessionEvidenceReceiptCandidate {
  return {
    path: relativePath,
    bytes: bytes.length,
    sha256: sha256(bytes),
    runId: fixtureRunId,
    scope: 'native-entry-ios',
    ownedRunId: fixtureRunId,
    fixtureScope: 'native-entry-ios',
    artifactRoot,
    apiPid,
    targetOrigin,
    fixtureAuthUidAllowlistHash: allowlistHash,
  };
}

function observation(requestId: number, route: string, status: number): ProxyObservation {
  return {
    requestId,
    method: 'POST',
    pathHash: sha256(route),
    requestOrigin: null,
    requestProfile: 'native',
    requestCredentialPresent: false,
    requestCredentialClassification: {
      authorization: 'absent',
      cookie: 'absent',
      knownAccessCookie: 'absent',
      knownRefreshCookie: 'absent',
      otherCookiePresent: false,
      malformedCookiePresent: false,
    },
    targetOrigin,
    status,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 1,
  };
}

function frameRows() {
  const rows = [
    ['entry', 'SCR-sign-in'],
    ['password-save-prompt', 'STATE-password-save'],
    ['coach-home', 'SCR-pro-home'],
    ['restored-home', 'SCR-pro-home'],
    ['account', 'SCR-account'],
    ['restored-identity', 'SCR-account'],
    ['signout-confirm', 'STATE-signout-confirm'],
    ['cancel-signout', 'SCR-account'],
    ['signout-reopen', 'STATE-signout-confirm'],
    ['signout-confirmed', 'SCR-sign-in'],
    ['signed-out-relaunch', 'SCR-sign-in'],
  ] as const;
  return rows.map(([label, viewId]) => {
    const selector = nativeObservedSelectors[viewId];
    const hierarchy = {
      attributes: { [selector.attribute]: selector.value },
      children: [],
    };
    const hierarchyBytes = Buffer.from(JSON.stringify(hierarchy));
    return {
      label,
      viewId,
      screenshotPath: `${label}.png`,
      screenshotHash: sha256(pngBytes),
      hierarchyPath: `${label}-hierarchy.json`,
      hierarchyHash: sha256(hierarchyBytes),
      reviewed: false,
      ...(label === 'cancel-signout'
        ? { notVisibleSelectors: ['settings.account.signOutConfirm'] }
        : {}),
      hierarchyBytes,
    };
  });
}

async function createFixture(options: CreateFixtureOptions = {}): Promise<RealFixture> {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'native-session-finalizer-v3-')),
  );
  try {
    options.onParentCreated?.(parent);
    await chmod(parent, 0o700);
    const repositoryRoot = path.join(parent, 'repository');
    const sourceFixture = await copySourceOnlyRepository(
      await realpath(candidateRoot),
      repositoryRoot,
    );
    if (options.failAfterSourceCopy) throw new Error('intentional source fixture creation failure');
    await chmod(repositoryRoot, 0o700);
    await execute('git', ['init', '--quiet'], { cwd: repositoryRoot });
    await execute('git', ['config', 'user.email', 'qa@example.invalid'], { cwd: repositoryRoot });
    await execute('git', ['config', 'user.name', 'QA'], { cwd: repositoryRoot });
    await execute('git', ['add', '-A'], { cwd: repositoryRoot });
    await execute('git', ['commit', '--quiet', '-m', 'disposable source fixture'], {
      cwd: repositoryRoot,
    });

    const sourceBefore = await sourceIdentity(await realpath(candidateRoot));
    const source = await sourceIdentity(repositoryRoot);
    assert.equal(source.sourceTreeHash, sourceBefore.sourceTreeHash);
    assert.equal(source.dirty, true);

    const captureRoot = path.join(parent, captureRunId);
    const outputRoot = path.join(parent, requestedRunId);
    await mkdir(captureRoot, { recursive: true, mode: 0o700 });
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    const backendArtifactRoot = path.join(parent, 'backend-artifacts');
    await mkdir(backendArtifactRoot, { recursive: true, mode: 0o700 });
    const selection = await selectNativePilotScenario(
      { platform: 'ios', engine: 'maestro', scenario: 'SCN-session-ios', mode: 'integration' },
      JSON.parse(
        await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
      ) as unknown,
      repositoryRoot,
    );
    const helpers: { path: string; sha256: string }[] =
      await readNativeSessionHelperInputs(repositoryRoot);
    const rows = frameRows();
    for (const row of rows) {
      await writeBytes(captureRoot, row.screenshotPath, pngBytes);
      await writeBytes(captureRoot, row.hierarchyPath, row.hierarchyBytes);
    }
    await writeBytes(captureRoot, 'launched.png', pngBytes);
    await writeBytes(captureRoot, postTapFlowPath, postTapFlowBytes);
    await writeBytes(captureRoot, postTapHierarchyPath, postTapHierarchyBytes);
    await writeBytes(captureRoot, postTapScreenshotPath, postTapScreenshotBytes);

    const profiles = Object.fromEntries(
      nativeSessionProfileCheckpointIds.map((checkpoint) => [
        checkpoint,
        profileSnapshot(fixtureRunId),
      ]),
    ) as Record<(typeof nativeSessionProfileCheckpointIds)[number], OwnedConnectionSnapshot>;
    const domains = Object.fromEntries(
      nativeSessionProfileCheckpointIds.map((checkpoint) => [
        checkpoint,
        domainSnapshot(fixtureRunId),
      ]),
    ) as Record<(typeof nativeSessionProfileCheckpointIds)[number], OwnedDomainSnapshot>;
    const transport = [
      observation(1, '/auth/email/sign-in', 201),
      observation(2, '/me/hydrate', 200),
      { ...observation(3, '/analytics/events', 202), method: 'POST' },
    ];
    const transportBytes = Buffer.from(JSON.stringify(transport));
    const authIdentity: NativeAuthIdentityObservation = {
      requestId: 1,
      ordinal: 1,
      targetOrigin,
      apiPid,
      status: 201,
      authUid: coachAuthUid,
      verification: 'verified',
      verificationReason: 'verified',
      fixtureAuthUidAllowlistHash: allowlistHash,
    };
    const authBytes = Buffer.from(JSON.stringify([authIdentity]));
    const profileReceipts = {} as Record<string, SessionEvidenceReceiptCandidate>;
    const domainReceipts = {} as Record<string, SessionEvidenceReceiptCandidate>;
    for (const checkpoint of nativeSessionProfileCheckpointIds) {
      const profilePath = `profile-${checkpoint}.private.json`;
      const profileBytes = Buffer.from(JSON.stringify(profiles[checkpoint]));
      await writeBytes(captureRoot, profilePath, profileBytes);
      profileReceipts[checkpoint] = receipt(profilePath, profileBytes, backendArtifactRoot);
      const domainPath = `domain-${checkpoint}.private.json`;
      const domainBytes = Buffer.from(JSON.stringify(domains[checkpoint]));
      await writeBytes(captureRoot, domainPath, domainBytes);
      domainReceipts[checkpoint] = receipt(domainPath, domainBytes, backendArtifactRoot);
    }
    const authPath = 'native-auth-identities.private.json';
    const transportPath = 'transport-observations.private.json';
    const terminalAuthPath = 'native-auth-terminal.private.json';
    const terminalTransportPath = 'transport-terminal.private.json';
    await writeBytes(captureRoot, authPath, authBytes);
    await writeBytes(captureRoot, transportPath, transportBytes);
    await writeBytes(captureRoot, terminalAuthPath, authBytes);
    await writeBytes(captureRoot, terminalTransportPath, transportBytes);
    const sqlBeforePath = 'session-sql-before.private.json';
    const sqlAfterPath = 'session-sql-after-signed-out-relaunch.private.json';
    const sqlBytes = Buffer.from(JSON.stringify(domains.beforeLogin));
    await writeBytes(captureRoot, sqlBeforePath, sqlBytes);
    await writeBytes(captureRoot, sqlAfterPath, sqlBytes);
    const authReceipt = receipt(authPath, authBytes, backendArtifactRoot);
    const transportReceipt = receipt(transportPath, transportBytes, backendArtifactRoot);
    const sqlBeforeReceipt = receipt(sqlBeforePath, sqlBytes, backendArtifactRoot);
    const sqlAfterReceipt = receipt(sqlAfterPath, sqlBytes, backendArtifactRoot);
    const cleanup = {
      kind: 'private-owned-session-cleanup',
      result: 'passed',
      runId: captureRunId,
      captureResult: 'observed',
      captureCleanupClean: true,
      survivors: [],
      unknownProcessQueries: [],
      missingForeignDevices: [],
      ownedDeviceAbsent: true,
      cacheAbsent: true,
    } as const;
    await writeJson(captureRoot, 'external-cleanup.private.json', cleanup);
    const capture: SessionCaptureCandidate & Record<string, unknown> = {
      kind: 'private-native-inventory-observation-not-behavior-attempt',
      mode: 'inventory',
      platform: 'ios',
      charter: 'session',
      result: 'observed',
      cleanup: 'cleaned',
      nativePassingCases: 0,
      captureRunId,
      source,
      sourceAfter: source,
      helperInputsBefore: helpers,
      helperInputsAfter: helpers,
      build: {
        bundleId: 'com.example.mychampions',
        profile: 'development',
        binaryHash: 'd'.repeat(64),
        apiOrigin: targetOrigin,
      },
      device: { udid: 'ios-disposable', runtime: 'iOS 18.0' },
      observations: rows,
      sessionViewEvidence: rows,
      sessionUiObservationOrder: rows.map((row) => row.label),
      sessionAssertionSequence: [...nativeSessionAssertionIds],
      sessionSignOutPostTapDiagnostic: postTapDiagnostic,
      sessionInitialAuth: {
        actor: 'coach',
        actorAuthUid: coachAuthUid,
        apiPid,
        targetOrigin,
        authRequestId: 1,
        afterRequestId: 1,
      },
      nativeAuthIdentityEvidence: authReceipt,
      sessionProfileSnapshots: profileReceipts,
      sessionDomainSnapshots: domainReceipts,
      sessionProfileLoginWindow: { afterRequestId: 0, throughRequestId: 1 },
      sessionProfileRestorationWindow: { afterRequestId: 1, throughRequestId: 2 },
      persistedCoachIdentity: {
        afterLoginAuthUidHash: sha256(coachAuthUid),
        afterRestorationAuthUidHash: sha256(coachAuthUid),
      },
      relaunchTransport: [transport[1]],
      relaunchTransportRange: {
        startOrdinal: 1,
        endOrdinalExclusive: 2,
        firstRequestId: 2,
        lastRequestId: 2,
      },
      signOutTransport: [],
      signOutTransportRange: { afterRequestId: 2, throughRequestId: 2 },
      signedOutRelaunchTransport: [transport[2]],
      signedOutRelaunchTransportRange: { afterRequestId: 2, throughRequestId: 3 },
      transportEvidence: transportReceipt,
      sessionTerminalTransportDiagnostics: {
        [terminalTransportPath]: {
          path: terminalTransportPath,
          bytes: transportBytes.length,
          sha256: sha256(transportBytes),
        },
        [terminalAuthPath]: {
          path: terminalAuthPath,
          bytes: authBytes.length,
          sha256: sha256(authBytes),
        },
      },
      sessionSqlBefore: sqlBeforeReceipt,
      sessionSqlAfterSignedoutRelaunch: sqlAfterReceipt,
      sessionSqlBeforeAfterUnchanged: true,
      sessionEvidencePublication: 'complete',
      authMetadataBeforeRelaunch: {
        sessionPresent: true,
        status: 'session-present',
        profilePresent: true,
        expiryPresent: true,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
        profileAuthUidHash: sha256(coachAuthUid),
      },
      authMetadataAfterRelaunch: {
        sessionPresent: true,
        status: 'session-present',
        profilePresent: true,
        expiryPresent: true,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
        profileAuthUidHash: sha256(coachAuthUid),
      },
      authMetadataAfterCancel: {
        sessionPresent: true,
        status: 'session-present',
        profilePresent: true,
        expiryPresent: true,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
        profileAuthUidHash: sha256(coachAuthUid),
      },
      authMetadataAfterSignout: {
        sessionPresent: false,
        status: 'session-absent',
        profilePresent: false,
        expiryPresent: false,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
      },
      authMetadataAfterSignedoutRelaunch: {
        sessionPresent: false,
        status: 'session-absent',
        profilePresent: false,
        expiryPresent: false,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
      },
      cancelSignoutCheckpoint: {
        observationLabel: 'cancel-signout',
        hierarchyPath: 'cancel-signout-hierarchy.json',
        sessionPresent: true,
      },
      nativeLogoutContract: {
        requirementRefs: ['FR-270', 'BR-342'],
        scope: 'local-native-session-clear',
        serverRevocationQualified: false,
      },
      fixtureHash: sha256('fixture'),
      flagsHash: sha256('flags'),
      backend: {
        runId: fixtureRunId,
        artifactRoot: backendArtifactRoot,
        processes: [{ role: 'api', pid: apiPid }],
      },
    };
    await writeJson(captureRoot, 'capture.private.json', capture);

    const loaded = await loadNativeSessionPublicDependency({
      repositoryRoot,
      captureRoot,
      cleanupRoot: captureRoot,
      cleanupPath: 'external-cleanup.private.json',
      deadlineMs: 120_000,
    });
    assert.equal(loaded.status, 'validated-source-only', JSON.stringify(loaded));
    assert.equal(loaded.nativePassingCases, 0);
    assert.equal(loaded.publicPassingCases, 0);
    assert.equal(loaded.publicPromotionEligible, false);
    assert.deepEqual(loaded.assertionIds, nativeSessionAssertionIds);
    const dependency = loaded;
    const candidate = await buildNativeSessionPublicFinalizationCandidate({
      selection,
      captureRoot,
      capture,
      dependency,
      fixtureRunId,
    });
    const sourceAfter = await sourceIdentity(repositoryRoot);
    const input: NativeSessionPublicFinalizationInput = {
      repositoryRoot,
      captureRoot,
      outputRoot,
      requestedRunId,
      requestedAttemptId: `${requestedRunId}:first`,
      captureRunId,
      fixtureRunId,
      fixtureHash: sha256('fixture'),
      flagsHash: sha256('flags'),
      selection,
      target: {
        deviceId: 'ios-disposable',
        osVersion: 'iOS 18.0',
        appId: 'com.example.mychampions',
        buildProfile: 'development',
        binaryHash: 'd'.repeat(64),
        apiOrigin: targetOrigin,
      },
      sourceBefore: source,
      sourceAfter,
      dependency,
      runtime: {
        captureRunId,
        captureExitCode: 0,
        childExitCode: 0,
        childSignal: null,
        captureResult: 'observed',
        captureCleanup: 'cleaned',
        captureCompleted: true,
        externalCleanupResult: 'passed',
        captureTimeout: null,
        cancellation: null,
        postCaptureFailure: null,
        censusFailures: [],
        outputFailures: [],
        fixtureRunId,
        fixtureHash: sha256('fixture'),
        flagsHash: sha256('flags'),
        timingsMs: { build: 1, install: 1, reset: 1, scenario: 1, verify: 1, cleanup: 1 },
      },
      candidate,
    };
    input.protectedControls = await validateNativeSessionPublicFinalizationControls(input);
    return { parent, repositoryRoot, captureRoot, outputRoot, selection, input, sourceFixture };
  } catch (error) {
    try {
      await (options.removeParent ?? ((target) => rm(target, { recursive: true, force: true })))(
        parent,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'source-only fixture creation and cleanup both failed',
      );
    }
    throw error;
  }
}

void test('real disposable producer path loads, finalizes, stages and verifies six source-bound assertions', async () => {
  const fixture = await createFixture();
  try {
    const controls = await validateNativeSessionPublicFinalizationControls(fixture.input);
    assert.equal(controls.status, 'candidate-ready');
    assert.equal(controls.nativePassingCases, 0);
    assert.equal(controls.publicPassingCases, 0);
    assert.equal(controls.publicPromotionEligible, false);
    assert.ok(controls.originalFiles.length > 0);
    assert.ok(controls.helperFiles.some((row) => row.path.endsWith('AndroidManifest.xml')));
    const lifecycle = {
      signal: new AbortController().signal,
      deadlineAtMs: performance.now() + 120_000,
    };
    const staged = await stageNativeSessionPublicEvidence(fixture.input, lifecycle);
    assert.equal(staged.assertions.length, nativeSessionAssertionIds.length);
    assert.equal(
      staged.artifacts.some((value) => value.endsWith('copy-manifest.private.json')),
      true,
    );
    await verifyNativeSessionPublicEvidence(
      {
        outputRoot: fixture.outputRoot,
        copyManifest: staged.copyManifest,
        requestedRunId,
        captureRunId,
        fixtureRunId,
        captureRoot: fixture.captureRoot,
        repositoryRoot: fixture.repositoryRoot,
      },
      { signal: new AbortController().signal, deadlineAtMs: performance.now() + 120_000 },
    );
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

void test('real stage orchestration removes an eligible prefix when the owner aborts during I/O', async () => {
  const fixture = await createFixture();
  try {
    const controller = new AbortController();
    const stagePromise = stageNativeSessionPublicEvidence(fixture.input, {
      signal: controller.signal,
      deadlineAtMs: performance.now() + 120_000,
    });
    setImmediate(() => controller.abort('test-abort'));
    await assert.rejects(stagePromise);
    await assert.rejects(
      readFile(
        path.join(
          fixture.outputRoot,
          'evidence',
          captureRunId,
          'session-public',
          'copy-manifest.private.json',
        ),
      ),
    );
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

void test('real stage rejects an equal-byte inode replacement after protected validation', async () => {
  const fixture = await createFixture();
  try {
    const sidecar = path.join(fixture.captureRoot, 'capture.private.json');
    const bytes = await readFile(sidecar);
    const replacement = sidecar + '.replacement';
    await writeFile(replacement, bytes, { mode: 0o600, flag: 'wx' });
    await rename(replacement, sidecar);
    await assert.rejects(
      stageNativeSessionPublicEvidence(fixture.input, {
        signal: new AbortController().signal,
        deadlineAtMs: performance.now() + 120_000,
      }),
      /identity changed|descriptor\/path/,
    );
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

void test('real stage rejects growth of a protected cleanup sidecar', async () => {
  const fixture = await createFixture();
  try {
    const sidecar = path.join(fixture.captureRoot, 'external-cleanup.private.json');
    const bytes = await readFile(sidecar);
    await writeFile(sidecar, Buffer.concat([bytes, Buffer.from('\nlate-growth')]), {
      mode: 0o600,
    });
    await assert.rejects(
      stageNativeSessionPublicEvidence(fixture.input, {
        signal: new AbortController().signal,
        deadlineAtMs: performance.now() + 120_000,
      }),
      /hash changed|byte count changed|changed during read|size changed/,
    );
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

void test('real final verification rejects a late equal-byte cleanup-sidecar replacement', async () => {
  const fixture = await createFixture();
  try {
    const staged = await stageNativeSessionPublicEvidence(fixture.input, {
      signal: new AbortController().signal,
      deadlineAtMs: performance.now() + 120_000,
    });
    const sidecar = path.join(fixture.captureRoot, 'external-cleanup.private.json');
    const bytes = await readFile(sidecar);
    const replacement = sidecar + '.late-replacement';
    await writeFile(replacement, bytes, { mode: 0o600, flag: 'wx' });
    await rename(replacement, sidecar);
    await assert.rejects(
      verifyNativeSessionPublicEvidence(
        {
          outputRoot: fixture.outputRoot,
          copyManifest: staged.copyManifest,
          requestedRunId,
          captureRunId,
          fixtureRunId,
          captureRoot: fixture.captureRoot,
          repositoryRoot: fixture.repositoryRoot,
        },
        { signal: new AbortController().signal, deadlineAtMs: performance.now() + 120_000 },
      ),
      /descriptor\/path identity changed|changed after staging|hash changed/,
    );
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

void test('real stage orchestration rejects an expired deadline before publishing a manifest', async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      stageNativeSessionPublicEvidence(fixture.input, {
        signal: new AbortController().signal,
        deadlineAtMs: performance.now() - 1,
      }),
    );
    await removeNativeSessionPublicEvidenceStage({
      outputRoot: fixture.outputRoot,
      captureRunId,
    });
    await assert.rejects(
      readFile(
        path.join(
          fixture.outputRoot,
          'evidence',
          captureRunId,
          'session-public',
          'copy-manifest.private.json',
        ),
      ),
    );
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

void test('source-only fixture includes identity, inventory and helper bytes without heavy roots', async () => {
  const fixture = await createFixture();
  try {
    const copied = new Set(fixture.sourceFixture.copiedRelativePaths);
    assert.equal(copied.has('docs/qa/native-pilot/inventory.json'), true);
    for (const relativePath of fixture.sourceFixture.sourceIdentityFiles)
      assert.equal(copied.has(relativePath), true);
    for (const relativePath of fixture.sourceFixture.inventoryOwnedPaths)
      assert.equal(copied.has(relativePath), true);
    for (const relativePath of fixture.sourceFixture.helperPaths)
      assert.equal(copied.has(relativePath), true);
    for (const excludedPrefix of fixture.sourceFixture.excludedPrefixes)
      assert.equal(
        fixture.sourceFixture.copiedRelativePaths.some(
          (relativePath) =>
            relativePath === excludedPrefix || relativePath.startsWith(`${excludedPrefix}/`),
        ),
        false,
      );
    assert.equal(copied.has('.git'), false);
    assert.equal(copied.has('.qa'), false);
    assert.equal(copied.has('node_modules'), false);
    assert.equal((await stat(path.join(fixture.repositoryRoot, 'app'))).isDirectory(), true);
    assert.equal(
      (await stat(path.join(fixture.repositoryRoot, 'app/auth/sign-in.tsx'))).isFile(),
      true,
    );
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

void test('source-only fixture rejects .git file pointers and symlinks before reading them', async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'native-session-source-probe-')),
  );
  try {
    const sourceRoot = path.join(parent, 'source');
    const destinationRoot = path.join(parent, 'destination');
    await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
    await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
    await writeFile(path.join(sourceRoot, '.git'), 'gitdir: /outside/private/worktree', {
      mode: 0o600,
      flag: 'wx',
    });
    await assert.rejects(
      copySourceFile(sourceRoot, destinationRoot, '.git', new Set()),
      /source-only fixture path is excluded/,
    );
    await rm(path.join(sourceRoot, '.git'));
    await writeFile(path.join(sourceRoot, 'git-pointer-target'), 'private target', {
      mode: 0o600,
      flag: 'wx',
    });
    await symlink('git-pointer-target', path.join(sourceRoot, '.git'));
    await assert.rejects(
      copySourceFile(sourceRoot, destinationRoot, '.git', new Set()),
      /source-only fixture path is excluded/,
    );
    await assert.rejects(stat(path.join(destinationRoot, '.git')));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('source-only fixture removes its parent when creation fails after source copy', async () => {
  let parent: string | null = null;
  await assert.rejects(
    createFixture({
      failAfterSourceCopy: true,
      onParentCreated: (created) => {
        parent = created;
      },
    }),
    /intentional source fixture creation failure/,
  );
  assert.ok(parent);
  await assert.rejects(stat(parent));
});

void test('source-only fixture removes its parent when the creation hook throws', async () => {
  let parent: string | null = null;
  await assert.rejects(
    createFixture({
      onParentCreated: (created) => {
        parent = created;
        throw new Error('intentional parent hook failure');
      },
    }),
    /intentional parent hook failure/,
  );
  assert.ok(parent);
  await assert.rejects(stat(parent));
});

void test('source-only fixture retains both creation and cleanup failures', async () => {
  let parent: string | null = null;
  const cleanupError = new Error('intentional cleanup failure');
  try {
    await assert.rejects(
      createFixture({
        onParentCreated: (created) => {
          parent = created;
          throw new Error('intentional parent hook failure');
        },
        removeParent: () => {
          throw cleanupError;
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.message, 'source-only fixture creation and cleanup both failed');
        assert.equal(error.errors.length, 2);
        assert.match(String(error.errors[0]), /intentional parent hook failure/);
        assert.equal(error.errors[1], cleanupError);
        return true;
      },
    );
  } finally {
    if (parent) await rm(parent, { recursive: true, force: true });
  }
});

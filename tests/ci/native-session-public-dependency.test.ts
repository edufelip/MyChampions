import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { sourceIdentity } from '../../scripts/testing/native-build-identity';
import {
  nativeSessionAssertionIds,
  selectNativePilotScenario,
} from '../../scripts/testing/native-pilot-contract';
import { nativeSessionHelperInputPaths } from '../../scripts/testing/native-session-helper-ledger';
import {
  loadNativeSessionPublicDependency,
  validateNativeSessionPublicDependency,
  verifyNativeSessionPublicDependencySourceIdentity,
  type NativeSessionPublicDependencyInput,
  type SessionCleanupCandidate,
  type SessionCaptureCandidate,
  type SessionEvidenceReceiptCandidate,
  type SessionFrameCandidate,
} from '../../scripts/testing/native-session-public-dependency';
import type { OwnedConnectionSnapshot } from '../../scripts/testing/native-connection-snapshot';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

const execute = promisify(execFile);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const checkpoints = [
  'beforeLogin',
  'afterLogin',
  'afterRestoration',
  'afterSignedOutRelaunch',
] as const;
type Checkpoint = (typeof checkpoints)[number];
const requiredUiLabels = [
  'entry',
  'password-save-prompt',
  'coach-home',
  'restored-home',
  'account',
  'restored-identity',
  'signout-confirm',
  'cancel-signout',
  'signout-reopen',
  'signout-confirmed',
  'signed-out-relaunch',
] as const;
const requiredUiPaths = requiredUiLabels.map((label) => `${label}-hierarchy.json`);
const requiredUiViews = [
  'SCR-sign-in',
  'STATE-password-save',
  'SCR-pro-home',
  'SCR-pro-home',
  'SCR-account',
  'SCR-account',
  'STATE-signout-confirm',
  'SCR-account',
  'STATE-signout-confirm',
  'SCR-sign-in',
  'SCR-sign-in',
] as const;
const requiredHelperPaths = [...nativeSessionHelperInputPaths];

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type FixtureFailureOptions = {
  failAfterRepositoryCreation?: Error;
  failAfterEvidenceRootCreation?: Error;
  cleanupFailure?: Error;
  ownedRoots?: string[];
};

function rememberOwnedRoot(roots: string[], value: string): void {
  if (!roots.includes(value)) roots.push(value);
}

function flattenErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? Array.from(error.errors as Iterable<unknown>) : [error];
}

async function removeOwnedRoots(roots: readonly string[], injectedFailure?: Error): Promise<void> {
  const errors: unknown[] = [];
  for (const root of [...new Set(roots)].reverse()) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (injectedFailure) errors.push(injectedFailure);
  if (errors.length > 0) throw new AggregateError(errors, 'Fixture cleanup failed');
}

async function throwSetupWithCleanup(
  setupError: unknown,
  roots: readonly string[],
  injectedFailure?: Error,
): Promise<never> {
  try {
    await removeOwnedRoots(roots, injectedFailure);
  } catch (cleanupError) {
    throw new AggregateError(
      [setupError, ...flattenErrors(cleanupError)],
      'Fixture setup and cleanup failed',
    );
  }
  throw setupError;
}

async function assertAbsent(root: string): Promise<void> {
  await assert.rejects(
    lstat(root),
    (error: unknown) =>
      error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

function aggregateContains(error: unknown, message: string): boolean {
  return (
    error instanceof AggregateError &&
    error.errors.some((entry) => entry instanceof Error && entry.message === message)
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

async function writePrivate(root: string, file: string, value: unknown): Promise<Buffer> {
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  await writeFile(path.join(root, file), bytes, { mode: 0o600 });
  return bytes;
}

async function writePrivateBytes(root: string, file: string, bytes: Buffer): Promise<Buffer> {
  await writeFile(path.join(root, file), bytes, { mode: 0o600 });
  return bytes;
}

function sessionAssertions() {
  const rows = [
    [
      'NAT-session-login',
      ['ui', 'api'],
      'Fresh synthetic sign-in fixture',
      'Submit the coach email/password body once',
      'The coach enters the native session and the API accepts the request.',
    ],
    [
      'NAT-session-restore',
      ['ui', 'api'],
      'Persisted coach session after sign-in',
      'Relaunch and hydrate the persisted native session',
      'The same coach session restores through one bounded hydrate request.',
    ],
    [
      'NAT-session-account',
      ['ui'],
      'Restored coach home',
      'Open the account screen',
      'The account screen is visible for the authenticated coach.',
    ],
    [
      'NAT-session-signout',
      ['ui', 'api'],
      'Authenticated account screen',
      'Open and cancel then confirm local sign-out',
      'The local session is cleared only after the confirmed sign-out action.',
    ],
    [
      'NAT-session-signed-out-relaunch',
      ['ui', 'api'],
      'Signed-out app state',
      'Relaunch after sign-out',
      'The signed-out relaunch has no credential-bearing auth request.',
    ],
    [
      'NAT-session-unrelated-state',
      ['sql'],
      'Synthetic domain baseline',
      'Compare the four profile/domain checkpoints',
      'Only the bounded coach updatedAt exception is allowed; domain rows stay unchanged.',
    ],
  ] as const;
  return rows.map(([id, evidenceKinds, startingState, action, expected]) => ({
    id,
    requirementRefs: ['REQ-synthetic-session'],
    requirementPaths: ['fixture-source.txt'],
    evidenceKinds,
    startingState,
    action,
    expected,
    evidencePathTemplates: evidenceKinds.map(
      (kind) => `assertions/{attemptId}/${id.replace('NAT-session-', '')}-${kind}.private.json`,
    ),
  }));
}

function syntheticInventory(sourceRevision: string, helpers: { path: string; sha256: string }[]) {
  const source = {
    id: 'SRC-synthetic',
    kind: 'source',
    ref: 'fixture-source.txt',
    paths: ['fixture-source.txt'],
    revision: sourceRevision,
  };
  const families = ['session', 'training', 'connection', 'camera-denied', 'save-retry'] as const;
  const views = families.map((family) => ({
    id: `SCR-synthetic-${family}`,
    name: family,
    kind: 'screen',
    captureStatus: 'source-discovered',
    sourceRefs: ['SRC-synthetic'],
  }));
  const transitions = families.map((family) => ({
    id: `TRN-synthetic-${family}`,
    fromViewId: `SCR-synthetic-${family}`,
    toViewId: `SCR-synthetic-${family}`,
    action: `synthetic ${family}`,
    kind: 'normal',
    status: 'discovered',
    sourceRefs: ['SRC-synthetic'],
  }));
  const flows = families.map((family) => ({
    id: `FLW-${family}`,
    name: family,
    entryViewId: `SCR-synthetic-${family}`,
    transitionIds: [`TRN-synthetic-${family}`],
    sourceRefs: ['SRC-synthetic'],
  }));
  const scenarios = families.flatMap((family) =>
    (['ios', 'android'] as const).map((platform) => {
      const scenario: Record<string, unknown> = {
        id: `SCN-${family}-${platform}`,
        flowId: `FLW-${family}`,
        transitionIds: [`TRN-synthetic-${family}`],
        platform,
        roles: ['coach'],
        dataMode: 'postgres',
        fixtureRef: `owned-postgres:SCN-${family}-${platform}:fresh-attempt`,
        behaviorStatus: 'untested',
        freshness: 'unknown',
        readiness: 'remediation',
        requirementRefs: ['REQ-synthetic-session'],
        ownerPaths: [...requiredHelperPaths],
        freshnessInputs: {
          sourceIds: ['SRC-synthetic', ...helpers.map((_, index) => `SRC-helper-${index}`)],
          requirementPaths: ['fixture-source.txt'],
          ownerPaths: [...requiredHelperPaths],
        },
        receiptIds: [],
        tags: ['synthetic', family, platform],
      };
      if (family === 'session') {
        const rows = sessionAssertions();
        scenario.pilotAssertions = rows;
        scenario.pilotAssertionContract = {
          dataMode: 'postgres',
          count: rows.length,
          sha256: hash(canonical(rows)),
        };
      }
      return scenario;
    }),
  );
  return {
    schemaVersion: '1.0',
    run: {
      id: 'synthetic-loader-fixture',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      commit: 'synthetic',
      target: 'synthetic-source-only',
    },
    boundary: {
      surfaces: ['native'],
      platforms: ['ios', 'android'],
      roles: ['coach', 'student'],
      flags: ['synthetic'],
      locales: ['en-US'],
      exclusions: ['runtime'],
    },
    sources: [
      source,
      ...helpers.map((helper, index) => ({
        id: `SRC-helper-${index}`,
        kind: 'source',
        ref: helper.path,
        paths: [helper.path],
        revision: helper.sha256,
      })),
    ],
    views,
    transitions,
    flows,
    scenarios,
    receipts: [],
    blockers: ['synthetic source-only fixture'],
  };
}

async function makeDisposableRepository(options: FixtureFailureOptions = {}) {
  const ownedRoots = options.ownedRoots ?? [];
  let parent: string | undefined;
  try {
    parent = await mkdtemp(path.join(os.tmpdir(), 'ios-session-public-dependency-repo-'));
    rememberOwnedRoot(ownedRoots, parent);
    const root = await realpath(parent);
    await chmod(root, 0o700);
    if (options.failAfterRepositoryCreation) throw options.failAfterRepositoryCreation;
    for (const directory of [
      'app',
      'components',
      'features',
      'constants',
      'localization',
      'assets',
      'ios/mychampions',
      'ios/mychampions.xcodeproj',
      'docs/qa/native-pilot',
      'scripts/testing',
      'scripts/testing/schemas',
    ])
      await mkdir(path.join(root, directory), { recursive: true, mode: 0o700 });
    for (const directory of [
      'app',
      'components',
      'features',
      'constants',
      'localization',
      'assets',
      'ios/mychampions',
      'ios/mychampions.xcodeproj',
    ])
      await writeFile(
        path.join(root, directory, 'fixture.txt'),
        Buffer.from(`synthetic-${directory}\n`),
        { mode: 0o600 },
      );
    for (const file of [
      'package.json',
      'yarn.lock',
      'app.config.ts',
      'ios/Podfile',
      'ios/Podfile.lock',
    ])
      await writeFile(path.join(root, file), Buffer.from(`synthetic ${file}\n`), { mode: 0o600 });
    await writeFile(
      path.join(root, 'fixture-source.txt'),
      Buffer.from('synthetic governing source\n'),
      { mode: 0o600 },
    );
    const helpers: { path: string; sha256: string }[] = [];
    for (const relative of requiredHelperPaths) {
      const bytes = Buffer.from(
        relative === 'scripts/testing/native-session-helper-ledger.ts'
          ? `export const nativeSessionHelperInputPaths = Object.freeze([\n${requiredHelperPaths.map((helper) => JSON.stringify(helper)).join(',\n')}\n] as const);\n`
          : `synthetic helper ${relative}\n`,
      );
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { mode: 0o600 });
      helpers.push({ path: relative, sha256: hash(bytes) });
    }
    const sourceRevision = hash(await readFile(path.join(root, 'fixture-source.txt')));
    await writePrivate(
      root,
      'docs/qa/native-pilot/inventory.json',
      syntheticInventory(sourceRevision, helpers),
    );
    await execute('git', ['init', '-q'], { cwd: root });
    await execute('git', ['add', '.'], { cwd: root });
    await execute(
      'git',
      [
        '-c',
        'user.name=synthetic-loader',
        '-c',
        'user.email=synthetic-loader@example.invalid',
        'commit',
        '-q',
        '-m',
        'synthetic fixture',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
        },
      },
    );
    const source = await sourceIdentity(root);
    return { root, parent, source, helpers };
  } catch (error) {
    return throwSetupWithCleanup(error, ownedRoots, options.cleanupFailure);
  }
}

function connectionSnapshot(
  runId: string,
  coachAuthUid: string,
  studentAuthUid: string,
  coachUpdatedAt: string,
): OwnedConnectionSnapshot {
  const fixtureAuthUids = [coachAuthUid, studentAuthUid].sort();
  const rows = {
    userProfiles: [
      {
        authUid: coachAuthUid,
        lockedRole: 'professional' as const,
        acceptedTermsVersion: 'v1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: coachUpdatedAt,
      },
      {
        authUid: studentAuthUid,
        lockedRole: 'student' as const,
        acceptedTermsVersion: 'v1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    professionalSpecialties: [
      {
        id: 'specialty-coach',
        professionalAuthUid: coachAuthUid,
        specialty: 'fitness_coach' as const,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    inviteCodes: [
      {
        id: 'invite-coach',
        professionalAuthUid: coachAuthUid,
        specialty: 'fitness_coach' as const,
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        rotatedAt: null,
      },
    ],
    connections: [],
    connectionInviteGuards: [],
    pendingStudents: [],
    pendingStudentSlots: [],
    trackingAccess: [],
    activeSpecialties: [],
  };
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    fixtureAuthUids,
    target: {
      professionalAuthUid: coachAuthUid,
      studentAuthUid,
      specialty: 'fitness_coach',
    },
    rowCounts: Object.fromEntries(
      Object.entries(rows).map(([name, values]) => [name, values.length]),
    ) as OwnedConnectionSnapshot['rowCounts'],
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

function proxyRow(
  requestId: number,
  pathName: '/auth/email/sign-in' | '/me/hydrate' | '/analytics/events',
  status: number,
  requestCredentialPresent: boolean,
  targetOrigin: string,
): ProxyObservation {
  return {
    requestId,
    method: 'POST',
    pathHash: hash(pathName),
    requestOrigin: null,
    requestProfile: 'native',
    requestCredentialPresent,
    targetOrigin,
    status,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 1,
  };
}

function metadata(present: boolean, authUidHash?: string): Record<string, unknown> {
  return present
    ? {
        status: 'session-present',
        sessionPresent: true,
        profilePresent: true,
        expiryPresent: true,
        plaintextAccessTokenPresent: false,
        plaintextRefreshTokenPresent: false,
        profileAuthUidHash: authUidHash,
      }
    : { status: 'session-absent', sessionPresent: false };
}

function hierarchy(viewId: string): unknown {
  const selectors: Record<string, Record<string, string>> = {
    'SCR-sign-in': { 'resource-id': 'auth.signIn.emailInput' },
    'STATE-password-save': { accessibilityText: 'Save Password?' },
    'SCR-pro-home': { 'resource-id': 'pro.home.screen' },
    'SCR-account': { 'resource-id': 'settings.account.screen' },
    'STATE-signout-confirm': { 'resource-id': 'settings.account.signOutConfirm' },
  };
  return { attributes: selectors[viewId] };
}

async function makeSyntheticInput(options: FixtureFailureOptions = {}) {
  const ownedRoots = options.ownedRoots ?? [];
  try {
    const repository = await makeDisposableRepository({
      failAfterRepositoryCreation: options.failAfterRepositoryCreation,
      ownedRoots,
    });
    const workspaceParent = await mkdtemp(
      path.join(os.tmpdir(), 'ios-session-public-dependency-evidence-'),
    );
    rememberOwnedRoot(ownedRoots, workspaceParent);
    const workspace = await realpath(workspaceParent);
    await chmod(workspace, 0o700);
    const runId = '111111111111111111111111';
    const backendRunId = '222222222222222222222222';
    const captureRoot = path.join(workspace, runId);
    const cleanupRoot = path.join(workspace, 'cleanup');
    await mkdir(captureRoot, { mode: 0o700 });
    await mkdir(cleanupRoot, { mode: 0o700 });
    if (options.failAfterEvidenceRootCreation) throw options.failAfterEvidenceRootCreation;
    const coachAuthUid = 'auth-coach';
    const studentAuthUid = 'auth-student';
    const fixtureAuthUids = [coachAuthUid, studentAuthUid];
    const allowlistHash = hash(JSON.stringify([...fixtureAuthUids].sort()));
    const apiPid = 39001;
    const targetOrigin = 'http://127.0.0.1:50378';
    const backendArtifactRoot = '/synthetic/backend-artifacts';
    const source = repository.source;
    const helpers = repository.helpers;
    const before = connectionSnapshot(
      backendRunId,
      coachAuthUid,
      studentAuthUid,
      '2026-01-01T00:00:00.000Z',
    );
    const afterLogin = connectionSnapshot(
      backendRunId,
      coachAuthUid,
      studentAuthUid,
      '2026-01-01T00:00:01.000Z',
    );
    const afterRestoration = connectionSnapshot(
      backendRunId,
      coachAuthUid,
      studentAuthUid,
      '2026-01-01T00:00:02.000Z',
    );
    const afterSignedOutRelaunch = afterRestoration;
    const profiles: Record<Checkpoint, OwnedConnectionSnapshot> = {
      beforeLogin: before,
      afterLogin,
      afterRestoration,
      afterSignedOutRelaunch,
    };
    const domains: Record<Checkpoint, OwnedDomainSnapshot> = {
      beforeLogin: domainSnapshot(backendRunId),
      afterLogin: domainSnapshot(backendRunId),
      afterRestoration: domainSnapshot(backendRunId),
      afterSignedOutRelaunch: domainSnapshot(backendRunId),
    };
    const profileReceipts = {} as Record<Checkpoint, SessionEvidenceReceiptCandidate>;
    const domainReceipts = {} as Record<Checkpoint, SessionEvidenceReceiptCandidate>;
    for (const checkpoint of checkpoints) {
      const profileFile = `profile-${checkpoint}.private.json`;
      const domainFile = `domain-${checkpoint}.private.json`;
      const profileBytes = await writePrivate(captureRoot, profileFile, profiles[checkpoint]);
      const domainBytes = await writePrivate(captureRoot, domainFile, domains[checkpoint]);
      const receipt = (file: string, bytes: Buffer): SessionEvidenceReceiptCandidate => ({
        path: file,
        sha256: hash(bytes),
        bytes: bytes.length,
        runId: backendRunId,
        scope: 'native-entry-ios',
        ownedRunId: backendRunId,
        fixtureScope: 'native-entry-ios',
        artifactRoot: backendArtifactRoot,
        apiPid,
        targetOrigin,
        fixtureAuthUidAllowlistHash: allowlistHash,
      });
      profileReceipts[checkpoint] = receipt(profileFile, profileBytes);
      domainReceipts[checkpoint] = receipt(domainFile, domainBytes);
    }
    const sqlBeforeBytes = await writePrivate(
      captureRoot,
      'session-sql-before.private.json',
      domains.beforeLogin,
    );
    const sqlAfterBytes = await writePrivate(
      captureRoot,
      'session-sql-after-signed-out-relaunch.private.json',
      domains.afterSignedOutRelaunch,
    );
    const signIn = proxyRow(1, '/auth/email/sign-in', 201, false, targetOrigin);
    const hydrate = proxyRow(2, '/me/hydrate', 200, true, targetOrigin);
    // Sign-out analytics: sent after the session ends, before the relaunch.
    const signOutAnalytics = proxyRow(3, '/analytics/events', 202, false, targetOrigin);
    const transport = [signIn, hydrate, signOutAnalytics];
    assert.equal(
      signIn.requestCredentialPresent,
      false,
      'Synthetic body-credential sign-in must have no auth header',
    );
    const transportBytes = await writePrivate(
      captureRoot,
      'transport-observations.private.json',
      transport,
    );
    const terminalTransportBytes = await writePrivate(
      captureRoot,
      'transport-terminal.private.json',
      transport,
    );
    const identity: NativeAuthIdentityObservation = {
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
    const identities = [identity];
    const identityBytes = await writePrivate(
      captureRoot,
      'native-auth-identities.private.json',
      identities,
    );
    const terminalIdentityBytes = await writePrivate(
      captureRoot,
      'native-auth-terminal.private.json',
      identities,
    );
    const frameRows: SessionFrameCandidate[] = [];
    for (const [index, file] of requiredUiPaths.entries()) {
      const viewId = requiredUiViews[index];
      const hierarchyBytes = await writePrivate(captureRoot, file, hierarchy(viewId));
      const screenshotPath = file.replace('-hierarchy.json', '.png');
      const screenshot = await writePrivateBytes(captureRoot, screenshotPath, pngBytes);
      frameRows.push({
        viewId,
        screenshotPath,
        screenshotHash: hash(screenshot),
        hierarchyPath: file,
        hierarchyHash: hash(hierarchyBytes),
        reviewed: false,
        ...(file === 'cancel-signout-hierarchy.json'
          ? { notVisibleSelectors: ['settings.account.signOutConfirm'] }
          : {}),
      });
    }
    await writePrivateBytes(captureRoot, 'launched.png', pngBytes);
    const receipt = (file: string, bytes: Buffer): SessionEvidenceReceiptCandidate => ({
      path: file,
      sha256: hash(bytes),
      bytes: bytes.length,
      runId: backendRunId,
      scope: 'native-entry-ios',
      ownedRunId: backendRunId,
      fixtureScope: 'native-entry-ios',
      artifactRoot: backendArtifactRoot,
      apiPid,
      targetOrigin,
      fixtureAuthUidAllowlistHash: allowlistHash,
    });
    const capture = {
      kind: 'private-native-inventory-observation-not-behavior-attempt',
      mode: 'inventory',
      platform: 'ios',
      charter: 'session',
      result: 'observed',
      cleanup: 'cleaned',
      nativePassingCases: 0,
      captureRunId: runId,
      source,
      sourceAfter: source,
      helperInputsBefore: helpers,
      helperInputsAfter: helpers,
      build: {
        binaryHash: hash('synthetic-build'),
        bundleId: 'com.example.mychampions.synthetic',
        apiOrigin: targetOrigin,
      },
      device: { udid: 'synthetic-ios-device', runtime: 'iOS-synthetic' },
      backend: {
        runId: backendRunId,
        artifactRoot: backendArtifactRoot,
        apiOrigin: targetOrigin,
        apiProcess: { pid: apiPid },
        processes: [{ role: 'api', pid: apiPid }],
      },
      observations: frameRows,
      sessionViewEvidence: frameRows,
      sessionUiObservationOrder: [...requiredUiLabels],
      sessionAssertionSequence: [...nativeSessionAssertionIds],
      sessionInitialAuth: {
        actor: 'coach',
        actorAuthUid: coachAuthUid,
        apiPid,
        targetOrigin,
        authRequestId: 1,
        afterRequestId: 1,
      },
      nativeAuthIdentityEvidence: receipt('native-auth-identities.private.json', identityBytes),
      sessionProfileSnapshots: profileReceipts,
      sessionDomainSnapshots: domainReceipts,
      sessionProfileLoginWindow: { afterRequestId: 0, throughRequestId: 1 },
      sessionProfileRestorationWindow: { afterRequestId: 1, throughRequestId: 2 },
      persistedCoachIdentity: {
        afterLoginAuthUidHash: hash(coachAuthUid),
        afterRestorationAuthUidHash: hash(coachAuthUid),
      },
      relaunchTransport: [hydrate],
      relaunchTransportRange: {
        startOrdinal: 1,
        endOrdinalExclusive: 2,
        firstRequestId: 2,
        lastRequestId: 2,
      },
      signOutTransport: [signOutAnalytics],
      signOutTransportRange: { afterRequestId: 2, throughRequestId: 3 },
      signedOutRelaunchTransport: [],
      signedOutRelaunchTransportRange: { afterRequestId: 3, throughRequestId: 3 },
      transportEvidence: receipt('transport-observations.private.json', transportBytes),
      sessionTerminalTransportDiagnostics: {
        'transport-terminal.private.json': {
          path: 'transport-terminal.private.json',
          bytes: terminalTransportBytes.length,
          sha256: hash(terminalTransportBytes),
        },
        'native-auth-terminal.private.json': {
          path: 'native-auth-terminal.private.json',
          bytes: terminalIdentityBytes.length,
          sha256: hash(terminalIdentityBytes),
        },
      },
      sessionSqlBefore: receipt('session-sql-before.private.json', sqlBeforeBytes),
      sessionSqlAfterSignedoutRelaunch: receipt(
        'session-sql-after-signed-out-relaunch.private.json',
        sqlAfterBytes,
      ),
      sessionSqlBeforeAfterUnchanged: true,
      sessionEvidencePublication: 'complete',
      authMetadataBeforeRelaunch: metadata(true, hash(coachAuthUid)),
      authMetadataAfterRelaunch: metadata(true, hash(coachAuthUid)),
      authMetadataAfterCancel: metadata(true, hash(coachAuthUid)),
      authMetadataAfterSignout: metadata(false),
      authMetadataAfterSignedoutRelaunch: metadata(false),
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
    } as unknown as SessionCaptureCandidate;
    const cleanup: SessionCleanupCandidate = {
      kind: 'synthetic source-only cleanup fixture',
      result: 'passed',
      runId,
      captureResult: 'observed',
      captureCleanupClean: true,
      survivors: [],
      unknownProcessQueries: [],
      missingForeignDevices: [],
      ownedDeviceAbsent: true,
      cacheAbsent: true,
    };
    await writePrivate(captureRoot, 'capture.private.json', capture);
    await writePrivate(cleanupRoot, 'cleanup.private.json', cleanup);
    const inventory = JSON.parse(
      await readFile(path.join(repository.root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ) as unknown;
    const selection = await selectNativePilotScenario(
      { platform: 'ios', engine: 'maestro', scenario: 'SCN-session-ios', mode: 'integration' },
      inventory,
      repository.root,
    );
    const input: NativeSessionPublicDependencyInput = {
      selection,
      capture,
      evidenceRoot: captureRoot,
      cleanup,
      fixtureAuthUids,
      coachAuthUid,
      studentAuthUid,
      backendRunId,
      backendArtifactRoot,
      apiIdentity: { apiPid, targetOrigin },
      profiles,
      domain: domains,
      sessionSqlBefore: domains.beforeLogin,
      sessionSqlAfterSignedoutRelaunch: domains.afterSignedOutRelaunch,
      transportObservations: transport,
      terminalTransportBytes,
      nativeAuthIdentities: identities,
      nativeAuthTerminalBytes: terminalIdentityBytes,
    };
    return {
      input,
      repositoryRoot: repository.root,
      captureRoot,
      cleanupRoot,
      workspaceParent,
      repositoryParent: repository.parent,
    };
  } catch (error) {
    return throwSetupWithCleanup(error, ownedRoots, options.cleanupFailure);
  }
}

async function cleanupFixture(fixture: { workspaceParent: string; repositoryParent: string }) {
  await rm(fixture.workspaceParent, { recursive: true, force: true });
  await rm(fixture.repositoryParent, { recursive: true, force: true });
}

void test('source-only validator accepts a complete portable synthetic ledger with four checkpoint receipts', async () => {
  const fixture = await makeSyntheticInput();
  try {
    assert.equal(fixture.input.transportObservations[0].requestCredentialPresent, false);
    const result = validateNativeSessionPublicDependency(fixture.input);
    assert.equal(result.status, 'validated-source-only');
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.deepEqual(result.assertionIds, [...nativeSessionAssertionIds]);
    assert.equal(result.files.profilePaths.length, 4);
    assert.equal(result.files.domainPaths.length, 4);
    assert.equal(result.verification.signedOutRequestCount, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

void test('source-only validator rejects a tampered non-coach initial auth actor', async () => {
  const fixture = await makeSyntheticInput();
  try {
    const tampered = {
      ...fixture.input,
      capture: {
        ...fixture.input.capture,
        sessionInitialAuth: {
          ...fixture.input.capture.sessionInitialAuth,
          actor: 'student' as 'coach',
        },
      },
    };
    assert.throws(() => validateNativeSessionPublicDependency(tampered), /actor|coach/);
  } finally {
    await cleanupFixture(fixture);
  }
});

void test('source-only validator rejects terminal transport mutation, incomplete publication and dirty cleanup', async () => {
  const fixture = await makeSyntheticInput();
  try {
    const tampered = {
      ...fixture.input,
      terminalTransportBytes: Buffer.from(`${fixture.input.terminalTransportBytes.toString()}\n`),
    };
    assert.throws(
      () => validateNativeSessionPublicDependency(tampered),
      /Expected values|byte length|hash|changed/,
    );
    const incomplete = structuredClone(fixture.input);
    Object.assign(incomplete.capture, {
      sessionEvidencePublication: 'rejected-terminal-validation',
    });
    assert.throws(() => validateNativeSessionPublicDependency(incomplete), /publication|complete/);
    const dirtyCleanup = structuredClone(fixture.input);
    Object.assign(dirtyCleanup.cleanup, { survivors: ['owned-process'] });
    assert.throws(
      () => validateNativeSessionPublicDependency(dirtyCleanup),
      /Expected values|survivors/,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

void test('source-only validator checks every request sent between sign-out and relaunch', async () => {
  const fixture = await makeSyntheticInput();
  // structuredClone turns Buffers into plain Uint8Arrays; keep the real bytes.
  const cloneInput = () => ({
    ...structuredClone(fixture.input),
    terminalTransportBytes: fixture.input.terminalTransportBytes,
    nativeAuthTerminalBytes: fixture.input.nativeAuthTerminalBytes,
  });
  try {
    // The sign-out analytics post still carries the old access cookie, and the
    // stopped stream, its receipts and the recorded window all say so.
    const leaked = cloneInput();
    const observations = leaked.transportObservations as ProxyObservation[];
    Object.assign(observations[2], {
      requestCredentialPresent: true,
      requestCredentialClassification: {
        authorization: 'absent',
        cookie: 'present',
        knownAccessCookie: 'nonempty',
        knownRefreshCookie: 'absent',
        otherCookiePresent: false,
        malformedCookiePresent: false,
      },
    });
    const leakedBytes = Buffer.from(JSON.stringify(observations));
    leaked.terminalTransportBytes = leakedBytes;
    const leakedReceipt = { bytes: leakedBytes.length, sha256: hash(leakedBytes) };
    Object.assign(
      leaked.capture.sessionTerminalTransportDiagnostics['transport-terminal.private.json'],
      leakedReceipt,
    );
    Object.assign(leaked.capture.transportEvidence, leakedReceipt);
    leaked.capture.signOutTransport = [observations[2]];
    assert.throws(
      () => validateNativeSessionPublicDependency(leaked),
      /Request 3 sent during sign-out carried credentials/,
    );

    const withWindow = (signOutTransportRange: {
      afterRequestId: number;
      throughRequestId: number;
    }) => {
      const value = cloneInput();
      value.capture.signOutTransportRange = signOutTransportRange;
      return value;
    };
    assert.throws(
      () =>
        validateNativeSessionPublicDependency(
          withWindow({ afterRequestId: 1, throughRequestId: 3 }),
        ),
      /sign-out window starts before restoration ended/,
    );
    assert.throws(
      () =>
        validateNativeSessionPublicDependency(
          withWindow({ afterRequestId: 2, throughRequestId: 2 }),
        ),
      /sign-out window does not end at the signed-out relaunch/,
    );
    const unlinked = cloneInput();
    unlinked.capture.signOutTransport = [];
    assert.throws(
      () => validateNativeSessionPublicDependency(unlinked),
      /sign-out transport range is not linked to stopped stream/,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

void test('an aborted iOS session capture drops every recorded transport window', async () => {
  const source = await readFile(
    path.join(__dirname, '../../scripts/testing/capture-native-testability.ts'),
    'utf8',
  );
  const start = source.indexOf("if (charter === 'session' && controller.signal.aborted) {");
  const end = source.indexOf('delete report[key];', start);
  assert.ok(start >= 0 && end > start, 'aborted session evidence scrub is missing');
  const scrubbed = source.slice(start, end);
  for (const key of [
    'relaunchTransport',
    'relaunchTransportRange',
    'signOutTransport',
    'signOutTransportRange',
    'signedOutRelaunchTransport',
    'signedOutRelaunchTransportRange',
  ])
    assert.match(scrubbed, new RegExp(`'${key}',`), `aborted capture keeps ${key}`);
});

void test('source/helper identity is recomputed from the complete producer ledger and rejects forged capture identity', async () => {
  const fixture = await makeSyntheticInput();
  try {
    const fixtureHelpers = fixture.input.capture.helperInputsBefore as {
      path: string;
      sha256: string;
    }[];
    assert.equal(fixtureHelpers.length, nativeSessionHelperInputPaths.length);
    assert.ok(
      fixtureHelpers.some(
        (helper) => helper.path === 'scripts/testing/ios-credential-entry-diagnostic.ts',
      ),
    );
    await verifyNativeSessionPublicDependencySourceIdentity(
      fixture.repositoryRoot,
      fixture.input.capture,
    );
    const forgedHelper = structuredClone(fixture.input.capture);
    const forgedHelperInputs = forgedHelper.helperInputsBefore as {
      path: string;
      sha256: string;
    }[];
    forgedHelperInputs[0].sha256 = hash('forged-helper');
    await assert.rejects(
      verifyNativeSessionPublicDependencySourceIdentity(fixture.repositoryRoot, forgedHelper),
      /stale|identity|hash/i,
    );
    const forgedSource = structuredClone(fixture.input.capture);
    forgedSource.sourceAfter.sourceTreeHash = hash('changed-source');
    await assert.rejects(
      verifyNativeSessionPublicDependencySourceIdentity(fixture.repositoryRoot, forgedSource),
      /Source identity changed|stale/i,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

void test('portable loader accepts synthetic capture while remaining source-only', async () => {
  const fixture = await makeSyntheticInput();
  try {
    const result = await loadNativeSessionPublicDependency({
      repositoryRoot: fixture.repositoryRoot,
      captureRoot: fixture.captureRoot,
      cleanupRoot: fixture.cleanupRoot,
      cleanupPath: 'cleanup.private.json',
    });
    assert.equal(result.status, 'validated-source-only');
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPassingCases, 0);
    assert.equal(result.publicPromotionEligible, false);
    assert.equal(result.files.profilePaths.length, 4);
    assert.equal(result.files.domainPaths.length, 4);
    assert.equal(result.verification.signInRequestId, 1);
    assert.equal(result.verification.restorationHydrateRequestId, 2);
  } finally {
    await cleanupFixture(fixture);
  }
});

void test('portable loader abort and invalid finite deadline remain blocked', async () => {
  const fixture = await makeSyntheticInput();
  try {
    const controller = new AbortController();
    controller.abort();
    const aborted = await loadNativeSessionPublicDependency({
      repositoryRoot: fixture.repositoryRoot,
      captureRoot: fixture.captureRoot,
      cleanupRoot: fixture.cleanupRoot,
      cleanupPath: 'cleanup.private.json',
      signal: controller.signal,
    });
    assert.equal(aborted.status, 'blocked');
    assert.equal(aborted.publicPromotionEligible, false);
    assert.equal(aborted.nativePassingCases, 0);
    assert.ok(aborted.missing.some((item) => /aborted/i.test(item)));

    const invalidDeadline = await loadNativeSessionPublicDependency({
      repositoryRoot: fixture.repositoryRoot,
      captureRoot: fixture.captureRoot,
      cleanupRoot: fixture.cleanupRoot,
      cleanupPath: 'cleanup.private.json',
      deadlineMs: 0,
    });
    assert.equal(invalidDeadline.status, 'blocked');
    assert.equal(invalidDeadline.publicPromotionEligible, false);
    assert.ok(invalidDeadline.missing.some((item) => /deadline/i.test(item)));
  } finally {
    await cleanupFixture(fixture);
  }
});

void test('repository fixture removes its root when setup fails after creation', async () => {
  const ownedRoots: string[] = [];
  const setupError = new Error('repository setup injected');
  let caught: unknown;
  try {
    await makeDisposableRepository({
      failAfterRepositoryCreation: setupError,
      ownedRoots,
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, setupError);
  assert.equal(ownedRoots.length, 1);
  await assertAbsent(ownedRoots[0]);
});

void test('repository fixture retains setup and cleanup failures while removing its root', async () => {
  const ownedRoots: string[] = [];
  const setupError = new Error('repository setup injected');
  const cleanupError = new Error('repository cleanup injected');
  let caught: unknown;
  try {
    await makeDisposableRepository({
      failAfterRepositoryCreation: setupError,
      cleanupFailure: cleanupError,
      ownedRoots,
    });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof AggregateError);
  assert.ok(aggregateContains(caught, setupError.message));
  assert.ok(aggregateContains(caught, cleanupError.message));
  assert.equal(ownedRoots.length, 1);
  await assertAbsent(ownedRoots[0]);
});

void test('evidence fixture removes repository and workspace roots when evidence setup fails', async () => {
  const ownedRoots: string[] = [];
  const setupError = new Error('evidence-root setup injected');
  let caught: unknown;
  try {
    await makeSyntheticInput({
      failAfterEvidenceRootCreation: setupError,
      ownedRoots,
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, setupError);
  assert.ok(ownedRoots.length >= 2);
  await Promise.all(ownedRoots.map((root) => assertAbsent(root)));
});

void test('evidence fixture retains setup and cleanup failures while removing all owned roots', async () => {
  const ownedRoots: string[] = [];
  const setupError = new Error('evidence-root setup injected');
  const cleanupError = new Error('evidence-root cleanup injected');
  let caught: unknown;
  try {
    await makeSyntheticInput({
      failAfterEvidenceRootCreation: setupError,
      cleanupFailure: cleanupError,
      ownedRoots,
    });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof AggregateError);
  assert.ok(aggregateContains(caught, setupError.message));
  assert.ok(aggregateContains(caught, cleanupError.message));
  assert.ok(ownedRoots.length >= 2);
  await Promise.all(ownedRoots.map((root) => assertAbsent(root)));
});

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  readActualDetoxRuntimeMetadata,
  requireDetoxRuntimeBuildMetadata,
  type DetoxRuntimeBuildMetadata,
} from '../../scripts/testing/detox-runtime-build-metadata';
import {
  runIosDetoxSessionAttemptForNativePilot,
  requireIosDetoxSessionNativePilotRouteSelection,
  type IosDetoxSessionNativePilotAttempt,
} from '../../scripts/testing/native-detox-session-native-pilot-route';
import {
  requireDetoxSessionRuntimeMetadataMatch,
  type IosDetoxSessionPublicAdapterOptions,
  type IosDetoxSessionPublicAdapterResult,
} from '../../scripts/testing/native-detox-session-public-adapter';
import {
  stageDetoxSessionPublicEvidence,
  verifyStagedDetoxSessionEvidence,
} from '../../scripts/testing/native-detox-session-public-staging';
import { nativeSessionAssertionIds } from '../../scripts/testing/native-pilot-contract';
import type { DetoxBaselineReport } from '../../scripts/testing/detox-integrated-session-baseline';
import type { DetoxDispatchQualifiedBuild } from '../../scripts/testing/native-detox-connection-public-dispatch';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const repositoryRoot = process.cwd();
const serverRoot = path.resolve(repositoryRoot, '../server');

function runId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 24);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function selection(): NativePilotSelection {
  return {
    arguments: {
      platform: 'ios',
      engine: 'detox',
      scenario: 'SCN-session-ios',
      mode: 'integration',
    },
    scenario: {
      id: 'SCN-session-ios',
      platform: 'ios',
      engine: 'detox',
      flowId: 'FLW-session',
      transitionIds: ['TRN-login', 'TRN-restore', 'TRN-account', 'TRN-signout-open', 'TRN-signout'],
      requirementRefs: ['SC-217', 'SC-213', 'TC-296', 'BL-018/P4-session'],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:SCN-session-ios:fresh-attempt',
      freshnessInputs: {
        requirementPaths: [
          'docs/screens/v2/SC-217-auth-sign-in.md',
          'docs/screens/v2/SC-213-account-privacy-settings.md',
          'docs/test-cases/TC-002-role-and-assignment-controls.md',
          'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
        ],
      },
      pilotAssertions: [
        {
          id: 'NAT-session-login',
          requirementRefs: ['SC-217', 'TC-296'],
          evidenceKinds: ['ui', 'api'],
          requirementPaths: [
            'docs/screens/v2/SC-217-auth-sign-in.md',
            'docs/screens/v2/SC-213-account-privacy-settings.md',
            'docs/test-cases/TC-002-role-and-assignment-controls.md',
            'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
          ],
          startingState:
            'Fresh owned Postgres fixture with a signed-out coach and completed onboarding',
          action: 'Sign in once with the seeded coach credentials through the rendered native UI',
          expected:
            'The locked coach role/home is visible, exactly one native sign-in succeeds through the owned API, and the authenticated identity is bound to the same fixture coach',
          evidencePathTemplates: [
            'assertions/{attemptId}/login-ui.private.json',
            'assertions/{attemptId}/login-api.private.json',
          ],
        },
        {
          id: 'NAT-session-restore',
          requirementRefs: ['SC-217', 'TC-296'],
          evidenceKinds: ['ui', 'api'],
          requirementPaths: [
            'docs/screens/v2/SC-217-auth-sign-in.md',
            'docs/screens/v2/SC-213-account-privacy-settings.md',
            'docs/test-cases/TC-002-role-and-assignment-controls.md',
            'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
          ],
          startingState: 'Successful native coach sign-in with the local bearer session persisted',
          action:
            'Terminate and relaunch the app without entering credentials; hydrate the profile through the normal authenticated route',
          expected:
            'The same coach role/home is restored, the owned API observes the authenticated hydrate, and no second sign-in is sent',
          evidencePathTemplates: [
            'assertions/{attemptId}/restore-ui.private.json',
            'assertions/{attemptId}/restore-api.private.json',
          ],
        },
        {
          id: 'NAT-session-account',
          requirementRefs: ['SC-213'],
          evidenceKinds: ['ui'],
          requirementPaths: [
            'docs/screens/v2/SC-217-auth-sign-in.md',
            'docs/screens/v2/SC-213-account-privacy-settings.md',
            'docs/test-cases/TC-002-role-and-assignment-controls.md',
            'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
          ],
          startingState: 'Restored coach home with an active local native session',
          action: 'Open Account, open the sign-out confirmation, then cancel it',
          expected:
            'The account screen and exact confirmation/cancel controls are visible and cancel leaves the session active',
          evidencePathTemplates: ['assertions/{attemptId}/account-ui.private.json'],
        },
        {
          id: 'NAT-session-signout',
          requirementRefs: ['SC-213', 'BL-018/P4-session'],
          evidenceKinds: ['ui', 'api'],
          requirementPaths: [
            'docs/screens/v2/SC-217-auth-sign-in.md',
            'docs/screens/v2/SC-213-account-privacy-settings.md',
            'docs/test-cases/TC-002-role-and-assignment-controls.md',
            'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
          ],
          startingState:
            'Active restored coach session with the sign-out confirmation closed after cancellation',
          action:
            'Reopen the sign-out confirmation and confirm sign-out through the normal native UI once',
          expected:
            'Sign-in is visible, local native session metadata is absent, authenticated native identity is cleared, and this native row does not claim server revocation',
          evidencePathTemplates: [
            'assertions/{attemptId}/signout-ui.private.json',
            'assertions/{attemptId}/signout-api.private.json',
          ],
        },
        {
          id: 'NAT-session-signed-out-relaunch',
          requirementRefs: ['SC-213', 'TC-296'],
          evidenceKinds: ['ui', 'api'],
          requirementPaths: [
            'docs/screens/v2/SC-217-auth-sign-in.md',
            'docs/screens/v2/SC-213-account-privacy-settings.md',
            'docs/test-cases/TC-002-role-and-assignment-controls.md',
            'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
          ],
          startingState: 'Confirmed local native sign-out with persisted session metadata absent',
          action: 'Terminate and relaunch the app without credentials',
          expected:
            'Sign-in remains visible, no role/session is restored, and no authenticated hydrate follows the signed-out relaunch',
          evidencePathTemplates: [
            'assertions/{attemptId}/signed-out-relaunch-ui.private.json',
            'assertions/{attemptId}/signed-out-relaunch-api.private.json',
          ],
        },
        {
          id: 'NAT-session-unrelated-state',
          requirementRefs: ['TC-296'],
          evidenceKinds: ['sql'],
          requirementPaths: [
            'docs/screens/v2/SC-217-auth-sign-in.md',
            'docs/screens/v2/SC-213-account-privacy-settings.md',
            'docs/test-cases/TC-002-role-and-assignment-controls.md',
            'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
          ],
          startingState: 'Scoped domain SQL baseline captured before the session journey',
          action:
            'Compare the declared domain snapshots before and after login, restoration and local sign-out',
          expected:
            'Complete owned profile and domain rows remain identical except the verified fixture coach updatedAt may advance only across separately bound sign-in POST 201 and restore hydrate POST 200 spans; after restoration all fields are strictly unchanged through logout/relaunch; auth-session records remain outside the declared domain-mutation scope',
          evidencePathTemplates: ['assertions/{attemptId}/unrelated-state-sql.private.json'],
        },
      ],
      pilotAssertionContract: {
        count: 6,
        sha256: 'f4eafe101ffd272095aad844a80ca6e99388b0cb84ca4f0ab670a56d4f1c671b',
        dataMode: 'postgres',
      },
    },
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
    assertionContractHash: 'c'.repeat(64),
    assertions: [
      { id: 'NAT-session-login', requirementRefs: ['SC-213'] },
      { id: 'NAT-session-restore', requirementRefs: ['SC-213'] },
      { id: 'NAT-session-account', requirementRefs: ['SC-217'] },
      { id: 'NAT-session-signout', requirementRefs: ['SC-213'] },
      { id: 'NAT-session-signed-out-relaunch', requirementRefs: ['SC-213'] },
      { id: 'NAT-session-unrelated-state', requirementRefs: ['SC-217'] },
    ],
  } as unknown as NativePilotSelection;
}

const environmentHash = '2'.repeat(64);

function runtimeMetadata(): DetoxRuntimeBuildMetadata {
  return {
    environmentHash,
    toolVersions: { node: process.version, detox: '20.47.0' },
    toolVersionEvidence: {
      path: 'node_modules/detox/package.json',
      realpath: path.join(repositoryRoot, 'node_modules/detox/package.json'),
      bytes: 1,
      sha256: '0'.repeat(64),
      packageName: 'detox',
      packageVersion: '20.47.0',
      identity: {
        dev: 1,
        ino: 1,
        uid: typeof process.getuid === 'function' ? process.getuid() : 0,
        gid: typeof process.getgid === 'function' ? process.getgid() : 0,
        mode: 0o600,
        nlink: 1,
        size: 1,
        mtimeMs: 1,
        ctimeMs: 1,
      },
    },
  };
}

function build(): DetoxDispatchQualifiedBuild & DetoxRuntimeBuildMetadata {
  return {
    platform: 'ios',
    configuration: 'ios.sim.debug',
    binaryPath: path.join(repositoryRoot, 'ios/build/Products/test.app'),
    binaryHash: 'd'.repeat(64),
    testBinaryPath: null,
    testBinaryHash: null,
    source: { sha: 'e'.repeat(40), dirty: false, sourceTreeHash: 'f'.repeat(64) },
    helperInputPaths: [],
    helperInputsHash: '1'.repeat(64),
    detoxConfigPath: path.join(repositoryRoot, '.detoxrc.js'),
    detoxConfigHash: '2'.repeat(64),
    metroPort: 41003,
    appIdentifier: 'com.edufelip.mychampions.dev',
    embeddedRuntime: {
      variant: 'dev',
      appIdentifier: 'com.edufelip.mychampions.dev',
      apiOrigin: 'http://127.0.0.1:41001',
      configSourcePath: path.join(repositoryRoot, 'app.config.ts'),
      configSourceHash: '3'.repeat(64),
    },
    dispatchRuntimeInputPaths: [],
    dispatchRuntimeInputIdentities: [],
    dispatchRuntimeInputsHash: '4'.repeat(64),
    ...runtimeMetadata(),
  };
}

function report(requestedRunId: string, result: 'passed' | 'harness-blocked'): DetoxBaselineReport {
  const evidenceFiles = [
    'detox-session-result.private.json',
    'detox-session-progress.private.json',
    'detox-auth-metadata.private.json',
    'detox-session-cache-observations.private.json',
    'detox-phase-checkpoints.private.json',
    'capture-final.private.json',
    'cleanup-final.private.json',
  ].map((name) => ({ name, bytes: 1, sha256: '0'.repeat(64) }));
  return {
    schemaVersion: 5,
    kind: 'private-detox-integrated-session-baseline-not-public-receipt',
    result,
    publicNativePassingCases: 0,
    platform: 'ios',
    configuration: 'ios.sim.debug',
    role: 'professional',
    captureRunId: requestedRunId,
    backendRunId: 'backend-run',
    backendAttemptId: 'backend-run:first',
    appOrigin: 'http://127.0.0.1:41002',
    apiOrigin: 'http://127.0.0.1:41001',
    apiPid: 1234,
    target: { platform: 'ios', deviceId: 'SIMULATOR' },
    fixture:
      result === 'passed'
        ? {
            runId: 'fixture-run',
            scope: 'native-entry-ios',
            fixtureHash: '1'.repeat(64),
            actorRole: 'professional',
            actorAuthUid: 'coach-uid',
            fixtureAuthUids: ['coach-uid', 'student-uid'],
          }
        : null,
    transport: { requestId: 1 },
    sessionCache: null,
    finalTransport: null,
    snapshots: null,
    build: build(),
    runnerPaths: {
      entryPath: path.join(repositoryRoot, 'scripts/run-detox-integrated-session-baseline.ts'),
      jestConfigPath: path.join(
        repositoryRoot,
        'e2e/jest.detox-integrated-session-baseline.config.js',
      ),
      testPath: path.join(repositoryRoot, 'e2e/detox-integrated-session-baseline.e2e.test.js'),
    },
    childExecution: null,
    cancellation: null,
    phaseCheckpoints: [],
    authMetadata: null,
    evidenceFiles,
    ui:
      result === 'passed'
        ? {
            launchCount: 3,
            synchronizationDisabled: true,
            signInMarker: 'auth.signIn.title',
            landingMarker: 'professional.home.title',
            assertionIds: [
              'NAT-session-login',
              'NAT-session-restore',
              'NAT-session-account',
              'NAT-session-signout',
              'NAT-session-signed-out-relaunch',
              'NAT-session-unrelated-state',
            ],
          }
        : null,
    cleanup: { attempted: ['backend'], cleaned: ['backend'], failures: [], independent: 'passed' },
    failure: null,
  } as unknown as DetoxBaselineReport;
}

async function privateWrite(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
}

async function makeArtifactRoot(requestedRunId: string): Promise<string> {
  const parent = path.join(repositoryRoot, '.qa/artifacts/native-pilot');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = path.join(parent, requestedRunId);
  await mkdir(root, { recursive: false, mode: 0o700 });
  return root;
}

function adapterResult(
  requestedRunId: string,
  artifactRoot: string,
  terminal: 'private-verified' | 'blocked',
  reportSha256: string,
): IosDetoxSessionPublicAdapterResult {
  const evidenceFiles = [
    'detox-session-result.private.json',
    'detox-session-progress.private.json',
    'detox-auth-metadata.private.json',
    'detox-session-cache-observations.private.json',
    'detox-phase-checkpoints.private.json',
    'capture-final.private.json',
    'cleanup-final.private.json',
  ].map((name) => ({ name, bytes: 1, sha256: '0'.repeat(64) }));
  return {
    schemaVersion: 1,
    kind: 'private-ios-detox-session-public-adapter-not-public-receipt',
    requestedRunId,
    requestedAttemptId: `${requestedRunId}:first`,
    captureRunId: requestedRunId,
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-session-ios',
    mode: 'integration',
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
    baselineResult: terminal === 'private-verified' ? 'passed' : 'harness-blocked',
    baselineError: terminal === 'private-verified' ? null : { name: 'Blocked', message: 'blocked' },
    terminal,
    terminalReceiptBound: terminal === 'private-verified',
    verificationResult: terminal === 'private-verified' ? 'passed' : 'blocked',
    localClear: terminal === 'private-verified' ? 'observed' : 'not-observed',
    localClearAfterSignout: terminal === 'private-verified' ? 'absent' : 'unknown',
    localClearAfterSignedOutRelaunch: terminal === 'private-verified' ? 'absent' : 'unknown',
    serverRevocation: 'decision-needed',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    publicPassingCases: 0,
    reportPath: path.join(artifactRoot, 'detox-integrated-session-baseline.private.json'),
    reportSha256,
    receiptPath: path.join(artifactRoot, 'detox-session-public-adapter.private.json'),
    assertionBindings:
      terminal === 'private-verified'
        ? [
            'NAT-session-login',
            'NAT-session-restore',
            'NAT-session-account',
            'NAT-session-signout',
            'NAT-session-signed-out-relaunch',
            'NAT-session-unrelated-state',
          ].map((id) => ({
            id,
            requirementRefs: ['SC-213'],
            evidencePaths: ['capture-final.private.json'],
          }))
        : [],
    evidenceFiles: terminal === 'private-verified' ? evidenceFiles : [],
    buildFingerprint:
      terminal === 'private-verified'
        ? {
            binaryHash: 'd'.repeat(64),
            sourceTreeHash: 'f'.repeat(64),
            helperInputsHash: '1'.repeat(64),
            detoxConfigHash: '2'.repeat(64),
            embeddedRuntimeConfigHash: '3'.repeat(64),
          }
        : null,
    fixtureHash: terminal === 'private-verified' ? '1'.repeat(64) : null,
    flagsHash: terminal === 'private-verified' ? environmentHash : null,
    toolVersions:
      terminal === 'private-verified' ? { node: process.version, detox: '20.47.0' } : {},
    runtimeBuildMetadata: terminal === 'private-verified' ? runtimeMetadata() : null,
    timingsMs:
      terminal === 'private-verified'
        ? {
            build: 1,
            install: 1,
            reset: 1,
            scenario: 1,
            verify: 1,
            cleanup: 1,
          }
        : { build: 0, install: 0, reset: 0, scenario: 0, verify: 0, cleanup: 0 },
  };
}

type FakeRouteControls = Readonly<{
  controller?: AbortController;
  deadlineAtMonotonicMs?: number;
  reuseBuildSourceRoot?: string;
  onLoad?: (input: { deadlineAtMonotonicMs?: number; reuseBuildSourceRoot?: string }) => void;
  onAdapterOptions?: (options: IosDetoxSessionPublicAdapterOptions) => void;
  onAdapter?: () => void;
}>;

async function runWithFakeFiles(
  requestedRunId: string,
  terminal: 'private-verified' | 'blocked',
  reportHashOverride?: string,
  controls: FakeRouteControls = {},
): Promise<{ result: IosDetoxSessionNativePilotAttempt; artifactRoot: string }> {
  const artifactRoot = await makeArtifactRoot(requestedRunId);
  const fakeAdapter = async (
    options: IosDetoxSessionPublicAdapterOptions,
  ): Promise<IosDetoxSessionPublicAdapterResult> => {
    controls.onAdapterOptions?.(options);
    const current = report(
      requestedRunId,
      terminal === 'private-verified' ? 'passed' : 'harness-blocked',
    ) as unknown as Record<string, unknown>;
    if (terminal === 'blocked') {
      current.target = null;
      current.apiOrigin = null;
      current.apiPid = null;
    }
    await privateWrite(
      path.join(artifactRoot, 'detox-integrated-session-baseline.private.json'),
      current,
    );
    const reportBytes = await readFile(
      path.join(artifactRoot, 'detox-integrated-session-baseline.private.json'),
    );
    const reportSha256 = sha256(reportBytes);
    const claimedReportSha256 = reportHashOverride ?? reportSha256;
    await privateWrite(path.join(artifactRoot, 'detox-session-public-adapter.private.json'), {
      kind: 'private-ios-detox-session-public-adapter-not-public-receipt',
      requestedRunId,
      requestedAttemptId: `${requestedRunId}:first`,
      reportSha256: claimedReportSha256,
      terminal,
      terminalReceiptBound: terminal === 'private-verified',
    });
    if (terminal === 'private-verified') {
      await privateWrite(path.join(artifactRoot, 'capture-final.private.json'), {
        kind: 'private Detox owned-session capture ledger; not a public receipt',
        fileName: 'capture-final.private.json',
        phase: 'final',
        finalized: true,
        result: 'passed',
        cleanup: 'cleaned',
        independentCleanup: 'passed',
        cleanupFinalLedger: 'cleanup-final.private.json',
        command: {
          execution: 'completed',
          cleanup: 'cleaned',
          childExitCode: 0,
          childSignal: null,
          censusFailure: null,
          outputFailure: null,
        },
      });
      await privateWrite(path.join(artifactRoot, 'cleanup-final.private.json'), {
        kind: 'private Detox cleanup ledger after stopped-resource drain',
        finalized: true,
        independent: 'passed',
        failures: [],
      });
    }
    controls.onAdapter?.();
    return adapterResult(requestedRunId, artifactRoot, terminal, claimedReportSha256);
  };
  const controller = controls.controller ?? new AbortController();
  const result = await runIosDetoxSessionAttemptForNativePilot(
    {
      repositoryRoot,
      serverRoot,
      artifactRoot,
      requestedRunId,
      requestedAttemptId: `${requestedRunId}:first`,
      selection: selection(),
      signal: controller.signal,
      deadlineMs: 30_000,
      deadlineAtMonotonicMs: controls.deadlineAtMonotonicMs,
      buildRunId: 'e'.repeat(24),
      reuseBuildSourceRoot: controls.reuseBuildSourceRoot,
    },
    {
      loadBuild: (input) => {
        controls.onLoad?.(input);
        return Promise.resolve(build());
      },
      runAdapter: fakeAdapter,
    },
  );
  return { result, artifactRoot };
}

void test('requires the exact iOS Detox session route selection', () => {
  assert.doesNotThrow(() => requireIosDetoxSessionNativePilotRouteSelection(selection()));
  assert.throws(() =>
    requireIosDetoxSessionNativePilotRouteSelection({
      ...selection(),
      arguments: { ...selection().arguments, engine: 'maestro' },
    }),
  );
});

void test('requires sealed environment and descriptor-backed Detox metadata before acquisition', async () => {
  const metadataRoot = await mkdtemp(path.join(os.tmpdir(), 'detox-session-runtime-metadata-'));
  try {
    const packagePath = path.join(metadataRoot, 'node_modules/detox/package.json');
    await mkdir(path.dirname(packagePath), { recursive: true, mode: 0o700 });
    await writeFile(packagePath, '{"name":"detox","version":"20.47.0"}\n', {
      mode: 0o600,
    });
    const metadata = await readActualDetoxRuntimeMetadata(metadataRoot, environmentHash);
    requireDetoxRuntimeBuildMetadata(metadata);
    assert.equal(metadata.environmentHash, environmentHash);
    assert.equal(metadata.toolVersionEvidence.packageName, 'detox');
    assert.equal(metadata.toolVersionEvidence.packageVersion, '20.47.0');
    assert.equal(metadata.toolVersions.node, process.version);

    const missingMetadataBuild = { ...build() } as unknown as DetoxDispatchQualifiedBuild;
    delete (missingMetadataBuild as unknown as Record<string, unknown>).environmentHash;
    assert.throws(
      () =>
        requireDetoxRuntimeBuildMetadata(
          missingMetadataBuild,
          'missing qualified Detox runtime metadata',
        ),
      /environmentHash/,
    );
  } finally {
    await rm(metadataRoot, { recursive: true, force: true });
  }
});

void test('rejects a forged environment profile or changed original Detox package evidence', () => {
  const qualified = runtimeMetadata();
  assert.deepEqual(requireDetoxSessionRuntimeMetadataMatch(qualified, qualified), qualified);
  assert.throws(
    () =>
      requireDetoxSessionRuntimeMetadataMatch(qualified, {
        ...qualified,
        environmentHash: '3'.repeat(64),
      }),
    /flags profile differs/,
  );
  assert.throws(
    () =>
      requireDetoxSessionRuntimeMetadataMatch(qualified, {
        ...qualified,
        toolVersionEvidence: {
          ...qualified.toolVersionEvidence,
          sha256: '4'.repeat(64),
        },
      }),
    /tool evidence differs/,
  );
});

void test('bridges the retained baseline through the outer terminal candidate without public promotion', async () => {
  const requestedRunId = runId();
  const { result, artifactRoot } = await runWithFakeFiles(requestedRunId, 'private-verified');
  try {
    assert.equal(result.kind, 'private-owned-ios-detox-session-attempt-not-public-receipt');
    assert.equal(result.verificationResult, 'passed');
    assert.equal(result.captureInvocation.count, 1);
    assert.equal(result.externalCleanupResult, 'passed');
    assert.equal(result.target.deviceId, 'SIMULATOR');
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicPassingCases, 0);
    assert.equal(result.flagsHash, '2'.repeat(64));
    assert.equal(result.toolVersions.detox, '20.47.0');
    assert.deepEqual(
      result.assertionBindings.map((row) => row.id),
      [...nativeSessionAssertionIds],
    );
    assert(Object.values(result.timingsMs).every((value) => value > 0));
    const receipt = JSON.parse(await readFile(result.adapterReceiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.equal(receipt.terminal, 'private-verified');
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('retains a blocked baseline when terminal ledgers are absent', async () => {
  const requestedRunId = runId();
  const { result, artifactRoot } = await runWithFakeFiles(requestedRunId, 'blocked');
  try {
    assert.equal(result.verificationResult, 'blocked');
    assert.equal(result.captureResult, 'harness-blocked');
    assert.equal(result.externalCleanupResult, 'failed');
    assert.equal(result.captureCompleted, false);
    assert.equal(result.nativePassingCases, 0);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('rejects a report whose persisted bytes do not match the adapter identity', async () => {
  const requestedRunId = runId();
  const artifactRoot = path.join(repositoryRoot, '.qa/artifacts/native-pilot', requestedRunId);
  try {
    await assert.rejects(
      runWithFakeFiles(requestedRunId, 'private-verified', '0'.repeat(64)),
      /report hash differs/,
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('rejects a symlinked persisted report before parsing it', async () => {
  const requestedRunId = runId();
  const artifactRoot = await makeArtifactRoot(requestedRunId);
  try {
    await assert.rejects(
      runIosDetoxSessionAttemptForNativePilot(
        {
          repositoryRoot,
          serverRoot,
          artifactRoot,
          requestedRunId,
          requestedAttemptId: `${requestedRunId}:first`,
          selection: selection(),
          signal: new AbortController().signal,
          deadlineMs: 30_000,
          buildRunId: 'e'.repeat(24),
        },
        {
          loadBuild: () => Promise.resolve(build()),
          runAdapter: async () => {
            const current = report(requestedRunId, 'harness-blocked');
            const reportPath = path.join(
              artifactRoot,
              'detox-integrated-session-baseline.private.json',
            );
            await privateWrite(reportPath, current);
            const targetPath = path.join(artifactRoot, 'report-target.private.json');
            await rename(reportPath, targetPath);
            await symlink(targetPath, reportPath);
            const reportSha256 = sha256(await readFile(targetPath));
            await privateWrite(
              path.join(artifactRoot, 'detox-session-public-adapter.private.json'),
              {
                kind: 'private-ios-detox-session-public-adapter-not-public-receipt',
                requestedRunId,
                requestedAttemptId: `${requestedRunId}:first`,
                reportSha256,
                terminal: 'blocked',
                terminalReceiptBound: false,
              },
            );
            return adapterResult(requestedRunId, artifactRoot, 'blocked', reportSha256);
          },
        },
      ),
      /escaped or contains a symlink/,
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

void test('rejects cancellation before qualified-build loading', async () => {
  const controller = new AbortController();
  controller.abort();
  let loaded = false;
  await assert.rejects(
    runIosDetoxSessionAttemptForNativePilot(
      {
        repositoryRoot,
        serverRoot,
        artifactRoot: path.join(repositoryRoot, '.qa/artifacts/native-pilot', 'f'.repeat(24)),
        requestedRunId: 'f'.repeat(24),
        requestedAttemptId: `${'f'.repeat(24)}:first`,
        selection: selection(),
        signal: controller.signal,
        deadlineMs: 30_000,
        buildRunId: 'e'.repeat(24),
      },
      {
        loadBuild: () => {
          loaded = true;
          return Promise.resolve(build());
        },
      },
    ),
  );
  assert.equal(loaded, false);
});

void test('carries the caller deadline and relocated build root through every session layer', async () => {
  const requestedRunId = runId();
  const deadlineAtMonotonicMs = performance.now() + 30_000;
  const reuseBuildSourceRoot = path.join(os.tmpdir(), 'detox-qualified-build-source');
  let loaded: { deadlineAtMonotonicMs?: number; reuseBuildSourceRoot?: string } | undefined;
  let adapted: IosDetoxSessionPublicAdapterOptions | undefined;
  try {
    const { result, artifactRoot } = await runWithFakeFiles(
      requestedRunId,
      'private-verified',
      undefined,
      {
        deadlineAtMonotonicMs,
        reuseBuildSourceRoot,
        onLoad: (input) => {
          loaded = input;
        },
        onAdapterOptions: (options) => {
          adapted = options;
        },
      },
    );
    assert.equal(result.verificationResult, 'passed');
    assert.equal(loaded?.deadlineAtMonotonicMs, deadlineAtMonotonicMs);
    assert.equal(loaded?.reuseBuildSourceRoot, reuseBuildSourceRoot);
    assert.equal(adapted?.deadlineAtMonotonicMs, deadlineAtMonotonicMs);
    assert.equal(adapted?.reuseBuildSourceRoot, reuseBuildSourceRoot);
    await rm(artifactRoot, { recursive: true, force: true });
  } finally {
    await rm(path.join(repositoryRoot, '.qa/artifacts/native-pilot', requestedRunId), {
      recursive: true,
      force: true,
    });
  }
});

void test('rejects cancellation after adapter completion before terminal rereads', async () => {
  const requestedRunId = runId();
  const controller = new AbortController();
  try {
    await assert.rejects(
      runWithFakeFiles(requestedRunId, 'private-verified', undefined, {
        controller,
        onAdapter: () => controller.abort(new Error('late adapter cancellation')),
      }),
      /late adapter cancellation/,
    );
  } finally {
    await rm(path.join(repositoryRoot, '.qa/artifacts/native-pilot', requestedRunId), {
      recursive: true,
      force: true,
    });
  }
});

void test('stages only hash-bound original session evidence and rejects staged tampering', async () => {
  const requestedRunId = runId();
  // This source-only control carries the exact six-row contract from the
  // current SCN-session-ios inventory. Runtime selection is revalidated by
  // the canonical runner after inventory regeneration and owner-path checks.
  const selected = selection();
  const captureRoot = await makeArtifactRoot(requestedRunId);
  const outputRoot = `${captureRoot}-staged`;
  await mkdir(outputRoot, { recursive: false, mode: 0o700 });
  const outputRootMetadata = await lstat(outputRoot);
  try {
    const sourceNames = [
      'detox-session-result.private.json',
      'detox-session-progress.private.json',
      'detox-auth-metadata.private.json',
      'detox-session-cache-observations.private.json',
      'detox-phase-checkpoints.private.json',
      'capture-final.private.json',
      'cleanup-final.private.json',
    ];
    const sourceBytes = new Map<string, Buffer>();
    for (const name of sourceNames) {
      const bytes = Buffer.from(JSON.stringify({ name, retained: true }) + '\n');
      sourceBytes.set(name, bytes);
      await writeFile(path.join(captureRoot, name), bytes, { flag: 'wx', mode: 0o600 });
    }
    const current = report(requestedRunId, 'passed') as unknown as Record<string, unknown>;
    current.evidenceFiles = sourceNames.map((name) => ({
      name,
      bytes: sourceBytes.get(name)!.byteLength,
      sha256: sha256(sourceBytes.get(name)!),
    }));
    const reportBytes = Buffer.from(JSON.stringify(current) + '\n');
    await writeFile(
      path.join(captureRoot, 'detox-integrated-session-baseline.private.json'),
      reportBytes,
      { flag: 'wx', mode: 0o600 },
    );
    const adapter = {
      ...adapterResult(requestedRunId, captureRoot, 'private-verified', sha256(reportBytes)),
      evidenceFiles: current.evidenceFiles,
    } as IosDetoxSessionPublicAdapterResult;
    await writeFile(
      path.join(captureRoot, 'detox-session-public-adapter.private.json'),
      JSON.stringify(adapter) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    const expectedOutputRootIdentity = {
      dev: outputRootMetadata.dev,
      ino: outputRootMetadata.ino,
      uid: outputRootMetadata.uid,
      gid: outputRootMetadata.gid,
      mode: outputRootMetadata.mode,
    };
    const stageInput = {
      captureRoot,
      outputRoot,
      requestedRunId,
      requestedAttemptId: `${requestedRunId}:first`,
      selection: selected,
      report: current as unknown as DetoxBaselineReport,
      adapter,
      expectedOutputRootIdentity,
      lifecycle: {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() + 30_000,
      },
    };
    await assert.rejects(
      stageDetoxSessionPublicEvidence({
        ...stageInput,
        expectedOutputRootIdentity: {
          ...expectedOutputRootIdentity,
          ino: expectedOutputRootIdentity.ino + 1,
        },
      }),
      /identity/,
    );
    const staged = await stageDetoxSessionPublicEvidence(stageInput);
    await verifyStagedDetoxSessionEvidence({
      outputRoot,
      copyManifest: staged.copyManifest,
      requestedRunId,
      requestedAttemptId: `${requestedRunId}:first`,
      selection: selected,
      expectedOutputRootIdentity,
      lifecycle: {
        signal: new AbortController().signal,
        deadlineAtMonotonicMs: performance.now() + 30_000,
      },
    });
    const tampered = path.join(outputRoot, staged.manifest.files[0].stagedPath);
    await writeFile(tampered, Buffer.alloc(staged.manifest.files[0].bytes, 0x78));
    await assert.rejects(
      verifyStagedDetoxSessionEvidence({
        outputRoot,
        copyManifest: staged.copyManifest,
        requestedRunId,
        requestedAttemptId: `${requestedRunId}:first`,
        selection: selected,
        expectedOutputRootIdentity,
        lifecycle: {
          signal: new AbortController().signal,
          deadlineAtMonotonicMs: performance.now() + 30_000,
        },
      }),
      /hash changed/,
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
    await rm(captureRoot, { recursive: true, force: true });
  }
});

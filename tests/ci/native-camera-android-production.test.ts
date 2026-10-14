import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseAndroidNativeCaptureArguments,
  requireAndroidCameraPromptHierarchy,
  verifyAndroidCameraCleanupBeforeCapturePublication,
} from '../../scripts/testing/capture-android-testability';
import { buildNativeLocaleContextCandidate } from '../../scripts/testing/locale-context-validator';
import {
  buildAndroidCameraLocaleObserver,
  deriveAndroidCameraPromptSpec,
} from '../../scripts/testing/native-camera-android-capture-adapter';
import {
  buildAndroidCameraPermissionCommands,
  parseAndroidCameraPermissionFlags,
  parseAndroidCameraPermissionStatus,
  requireAndroidCameraPermissionEvidence,
  type AndroidCameraCommandReceipt,
  type AndroidCameraFrameSource,
  type AndroidCameraRuntimeIdentity,
} from '../../scripts/testing/native-camera-android-contract';
import {
  requireAndroidCameraSqlSourceProjections,
  requireAndroidCameraTransport,
} from '../../scripts/testing/native-camera-android-observation';
import {
  buildAndroidCameraManualEntryActions,
  buildAndroidCameraPromptActions,
  requireAndroidCameraIsolationFixtureBinding,
} from '../../scripts/testing/native-camera-android-producer';
import { readQualifiedAndroidCameraLocaleEvidence } from '../../scripts/testing/native-camera-android-runtime-locale';
import { writeAndroidCameraSqlSourceReceipts } from '../../scripts/testing/native-camera-android-sql-source';
import {
  inspectOwnedAndroidCleanup,
  verifyOwnedAndroidCleanupBeforeCapturePublication,
  type AndroidCleanupOptions,
} from '../../scripts/testing/verify-owned-android-cleanup';
import type { NativeLocaleBinding } from '../../scripts/testing/locale-native-observation';
import type { OwnedApiLifetimeProbe } from '../../scripts/testing/owned-session';

const HASH = (value: string): string => createHash('sha256').update(value).digest('hex');
const RUN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const API_ORIGIN = 'http://127.0.0.1:4123';
const API_PID = 42;
const API_SCRIPT = path.join(process.cwd(), 'scripts/testing/owned-session.ts');
const API_STARTED = '2026-10-02T00:00:00.000Z';

function privateRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'android-camera-v7-'));
  chmodSync(root, 0o700);
  return realpathSync(root);
}

void test(
  'camera cleanup uses the default census before capture publication',
  { concurrency: false },
  async () => {
    const root = privateRoot();
    const artifactRoot = path.join(root, '.qa/artifacts/native-pilot', RUN_ID);
    const sdkRoot = path.join(root, 'fake-sdk');
    const fakeBin = path.join(root, 'fake-bin');
    const originalPath = process.env.PATH;
    const originalPid = process.env.MC_ANDROID_CLEANUP_PID;
    try {
      mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
      mkdirSync(path.join(sdkRoot, 'emulator'), {
        recursive: true,
        mode: 0o700,
      });
      mkdirSync(fakeBin, { recursive: true, mode: 0o700 });
      const canonicalSdkRoot = realpathSync(sdkRoot);
      writeFileSync(
        path.join(sdkRoot, 'emulator/emulator'),
        '#!/bin/sh\n[ "$1" = "-list-avds" ] && exit 0\nexit 64\n',
        { mode: 0o700 },
      );
      writeFileSync(path.join(fakeBin, 'xcrun'), "#!/bin/sh\nprintf '%s\\n' '{\"devices\":{}}'\n", {
        mode: 0o700,
      });
      writeFileSync(
        path.join(fakeBin, 'ps'),
        '#!/bin/sh\nprintf \'%s Tue Sep 29 15:00:00 2026\\n\' "$MC_ANDROID_CLEANUP_PID"\n',
        { mode: 0o700 },
      );
      process.env.PATH = `${fakeBin}:${originalPath ?? ''}`;
      process.env.MC_ANDROID_CLEANUP_PID = String(process.pid);
      for (const name of ['previous-ios-devices.private.json', 'after-ios-devices.private.json'])
        writeFileSync(path.join(artifactRoot, name), JSON.stringify({ devices: {} }), {
          mode: 0o600,
        });
      const report = {
        platform: 'android',
        captureRunId: RUN_ID,
        result: 'harness-blocked',
        cleanup: 'pending',
        cleanupFailures: [],
        acquisitionIntents: [],
        commandExecutions: [],
        source: { treeHash: HASH('source') },
        sourceAfter: { treeHash: HASH('source') },
        helperInputsBefore: [{ path: 'fixture', sha256: HASH('helper') }],
        helperInputsAfter: [{ path: 'fixture', sha256: HASH('helper') }],
        originalAvds: [],
        avdsAfter: [],
        workspaceApkBefore: null,
        workspaceApkAfter: null,
      };
      const provisionalDocument = {
        ...report,
        cleanup: 'cleaned',
        cleanupFailures: [],
      };
      const result = await verifyOwnedAndroidCleanupBeforeCapturePublication({
        repositoryRoot: root,
        artifactRoot,
        androidRuntimeParent: root,
        sdkRoot: canonicalSdkRoot,
        capture: {
          document: provisionalDocument,
          publication: 'provisional-before-capture-publication',
        },
      });
      assert.equal(result.capturePublication, 'provisional-before-capture-publication');
      assert.equal(result.result, 'passed');
      assert.equal(result.censusStatus, 'available');
      assert(result.androidCleanupReceipt);
      assert.equal(report.cleanup, 'pending');
      assert.deepEqual(report.cleanupFailures, []);
      assert.throws(() => statSync(path.join(artifactRoot, 'capture.private.json')), /ENOENT/u);

      const forgedRunId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
      const forgedArtifactRoot = path.join(root, '.qa/artifacts/native-pilot', forgedRunId);
      mkdirSync(forgedArtifactRoot, { recursive: true, mode: 0o700 });
      let forgedVerifierCalled = false;
      const forgedVerifierOptions = {
        report: { ...report, captureRunId: forgedRunId },
        cleanupFailures: [],
        plannedCleanup: 'cleaned',
        captureRunId: forgedRunId,
        publication: 'provisional-before-capture-publication' as const,
        repositoryRoot: root,
        artifactRoot: forgedArtifactRoot,
        androidRuntimeParent: root,
        sdkRoot: canonicalSdkRoot,
        verify: () => {
          forgedVerifierCalled = true;
          throw new Error('forged verifier must not be called');
        },
      } as Parameters<typeof verifyAndroidCameraCleanupBeforeCapturePublication>[0];
      const defaultFailure =
        await verifyAndroidCameraCleanupBeforeCapturePublication(forgedVerifierOptions);
      assert.equal(forgedVerifierCalled, false);
      assert.equal(defaultFailure.result, 'failed');
      assert.equal(defaultFailure.censusStatus, 'unavailable');
      assert.throws(
        () => statSync(path.join(forgedArtifactRoot, 'capture.private.json')),
        /ENOENT/u,
      );

      await assert.rejects(
        verifyOwnedAndroidCleanupBeforeCapturePublication({
          repositoryRoot: root,
          artifactRoot,
          androidRuntimeParent: root,
          sdkRoot: canonicalSdkRoot,
          capture: {
            document: provisionalDocument,
            publication: 'published-capture-file',
          },
        }),
        /publication must be provisional/u,
      );
      await assert.rejects(
        verifyAndroidCameraCleanupBeforeCapturePublication({
          report,
          cleanupFailures: [],
          plannedCleanup: 'cleaned',
          captureRunId: RUN_ID,
          publication: 'published-capture-file',
          repositoryRoot: root,
          artifactRoot,
          androidRuntimeParent: root,
          sdkRoot: canonicalSdkRoot,
        }),
        /publication must be provisional/u,
      );
      await assert.rejects(
        verifyOwnedAndroidCleanupBeforeCapturePublication({
          repositoryRoot: root,
          artifactRoot,
          androidRuntimeParent: root,
          sdkRoot: canonicalSdkRoot,
          capture: {
            document: {
              ...provisionalDocument,
              captureRunId: `${RUN_ID.slice(0, -1)}b`,
            },
            publication: 'provisional-before-capture-publication',
          },
        }),
        /does not belong to the inspected attempt/u,
      );
      await assert.rejects(
        verifyAndroidCameraCleanupBeforeCapturePublication({
          report: { ...report, captureRunId: `${RUN_ID.slice(0, -1)}b` },
          cleanupFailures: [],
          plannedCleanup: 'cleaned',
          captureRunId: `${RUN_ID.slice(0, -1)}b`,
          publication: 'provisional-before-capture-publication',
          repositoryRoot: root,
          artifactRoot,
          androidRuntimeParent: root,
          sdkRoot: canonicalSdkRoot,
        }),
        /does not belong to the requested attempt/u,
      );

      const historicalRoot = privateRoot();
      try {
        const historicalArtifactRoot = path.join(
          historicalRoot,
          '.qa/artifacts/native-pilot',
          RUN_ID,
        );
        mkdirSync(historicalArtifactRoot, { recursive: true, mode: 0o700 });
        const historicalCaptureBytes = Buffer.from(
          JSON.stringify({
            ...report,
            cleanup: 'failed-recovery-retained',
            cleanupFailures: ['original cleanup failure'],
          }),
        );
        const historicalCapturePath = path.join(historicalArtifactRoot, 'capture.private.json');
        writeFileSync(historicalCapturePath, historicalCaptureBytes, {
          mode: 0o600,
        });
        const historicalOptions = {
          repositoryRoot: historicalRoot,
          artifactRoot: historicalArtifactRoot,
          androidRuntimeParent: historicalRoot,
          sdkRoot: canonicalSdkRoot,
        };
        await assert.rejects(
          verifyOwnedAndroidCleanupBeforeCapturePublication({
            ...historicalOptions,
            capture: {
              document: provisionalDocument,
              publication: 'provisional-before-capture-publication',
            },
          }),
          /unpublished capture/u,
        );
        await assert.rejects(
          verifyAndroidCameraCleanupBeforeCapturePublication({
            report,
            cleanupFailures: [],
            plannedCleanup: 'cleaned',
            captureRunId: RUN_ID,
            publication: 'provisional-before-capture-publication',
            ...historicalOptions,
          }),
          /unpublished capture/u,
        );
        assert.deepEqual(readFileSync(historicalCapturePath), historicalCaptureBytes);
        for (const name of [
          'external-cleanup.private.json',
          'external-cleanup-receipt.private.json',
        ])
          assert.throws(() => statSync(path.join(historicalArtifactRoot, name)), /ENOENT/u);
      } finally {
        rmSync(historicalRoot, { recursive: true, force: true });
      }
    } finally {
      process.env.PATH = originalPath;
      if (originalPid === undefined) delete process.env.MC_ANDROID_CLEANUP_PID;
      else process.env.MC_ANDROID_CLEANUP_PID = originalPid;
      rmSync(root, { recursive: true, force: true });
    }
  },
);

void test('public cleanup inspection cannot bypass the published capture receipt', async () => {
  const root = privateRoot();
  try {
    const artifactRoot = path.join(root, '.qa/artifacts/native-pilot', RUN_ID);
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    chmodSync(artifactRoot, 0o700);
    const injected = {
      ...({
        repositoryRoot: root,
        artifactRoot,
        androidRuntimeParent: root,
        sdkRoot: root,
      } satisfies AndroidCleanupOptions),
      capture: {
        document: { platform: 'android', captureRunId: RUN_ID },
        publication: 'provisional-before-capture-publication' as const,
      },
    } as AndroidCleanupOptions;
    await assert.rejects(
      inspectOwnedAndroidCleanup(injected),
      /capture\.private\.json|ENOENT/u,
      'public inspection accepted an injected provisional document',
    );
    writeFileSync(
      path.join(artifactRoot, 'capture.private.json'),
      JSON.stringify({
        platform: 'android',
        captureRunId: `${RUN_ID}-foreign`,
        result: 'harness-blocked',
        cleanup: 'cleaned',
        cleanupFailures: [],
      }),
      { flag: 'wx', mode: 0o600 },
    );
    await assert.rejects(
      inspectOwnedAndroidCleanup({
        repositoryRoot: root,
        artifactRoot,
        androidRuntimeParent: root,
        sdkRoot: root,
      }),
      /does not belong to the inspected attempt/u,
      'public inspection accepted a published receipt from another capture attempt',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

type ParentContext = {
  captureRoot: string;
  parentRoot: string;
  manifestSha256: string;
  manifestRetainedPath: string;
  ledgerSha256: string;
  ledgerRetainedPath: string;
  manifestSizeBytes: number;
  ledgerSizeBytes: number;
};

function parentContext(root: string): ParentContext {
  const parentRoot = path.join(root, 'owned-server-runtime');
  mkdirSync(parentRoot, { recursive: true, mode: 0o700 });
  const manifest = {
    schemaVersion: 1,
    phase: 'tests' as const,
    runId: RUN_ID,
    composeProject: `mc_test_${RUN_ID}`,
    containerId: 'a'.repeat(64),
    ownerTokenHash: 'b'.repeat(64),
    port: 4123,
    targets: {
      DATABASE_URL: `mc_test_${RUN_ID}`,
      FOOD_CATALOG_DATABASE_URL: `mc_test_${RUN_ID}_food`,
      EXERCISE_CATALOG_DATABASE_URL: `mc_test_${RUN_ID}_exercise`,
    },
    repoRoot: path.resolve(root, 'server'),
    runtimeRoot: parentRoot,
    artifactRoot: parentRoot,
    createdAt: API_STARTED,
    repositories: {
      server: {
        sha: 'c'.repeat(40),
        dirty: false,
        workingTreeHash: 'd'.repeat(64),
      },
      client: {
        sha: 'e'.repeat(40),
        dirty: false,
        workingTreeHash: 'f'.repeat(64),
      },
    },
    orchestratorPid: process.pid,
    testChildPid: null,
    fixtureScopes: [
      'native-entry-android',
      'native-conn-isolation-android',
      'native-training-android',
    ],
    processes: [{ role: 'api', pid: API_PID, started: API_STARTED, script: API_SCRIPT }],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n');
  const ledgerBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      runId: RUN_ID,
      ownerTokenHash: manifest.ownerTokenHash,
      pid: API_PID,
      started: API_STARTED,
      script: API_SCRIPT,
      attempt: 'session-start',
      origin: API_ORIGIN,
    }) + '\n',
  );
  writeFileSync(path.join(parentRoot, 'manifest.json'), manifestBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  writeFileSync(path.join(parentRoot, 'api-session-start.json'), ledgerBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  const retainedManifest = `camera-sql-manifest-${HASH(
    `${parentRoot}\0manifest.json\0${HASH(manifestBytes.toString('utf8'))}`,
  )}.private.json`;
  const retainedLedger = `camera-sql-api-ledger-${HASH(
    `${parentRoot}\0api-session-start.json\0${HASH(ledgerBytes.toString('utf8'))}`,
  )}.private.json`;
  return {
    captureRoot: root,
    parentRoot,
    manifestSha256: HASH(manifestBytes.toString('utf8')),
    manifestRetainedPath: retainedManifest,
    ledgerSha256: HASH(ledgerBytes.toString('utf8')),
    ledgerRetainedPath: retainedLedger,
    manifestSizeBytes: manifestBytes.byteLength,
    ledgerSizeBytes: ledgerBytes.byteLength,
  };
}

function parentReceipt(
  context: ParentContext,
  pathName: string,
  schema: 'connection-snapshot-v1' | 'domain-snapshot-v1',
  bytes: Buffer,
) {
  return {
    path: pathName,
    parentRoot: context.parentRoot,
    schema,
    runId: RUN_ID,
    scope: pathName.includes('isolation')
      ? 'native-conn-isolation-android'
      : pathName.includes('training')
        ? 'native-training-android'
        : 'native-entry-android',
    snapshotId: `snapshot-${pathName.replace(/[^a-z0-9]+/gu, '-')}`,
    sizeBytes: bytes.byteLength,
    sha256: HASH(bytes.toString('utf8')),
    ownerUid: process.getuid?.() ?? 0,
    mode: 0o600,
    verification: 'owned-runtime-document-v6' as const,
    kind: schema === 'connection-snapshot-v1' ? ('connection' as const) : ('domain' as const),
    apiOrigin: API_ORIGIN,
    apiPid: API_PID,
    apiStarted: API_STARTED,
    apiScript: API_SCRIPT,
    backendAttemptId: `${RUN_ID}:first`,
    parentSnapshotRetainedPath: `camera-sql-parent-${HASH(`${context.parentRoot}\0${pathName}\0${HASH(bytes.toString('utf8'))}`)}.private.json`,
    parentSnapshotRetainedKind: 'sidecar' as const,
    parentSnapshotRetainedSha256: HASH(bytes.toString('utf8')),
    parentSnapshotRetainedSizeBytes: bytes.byteLength,
    parentSnapshotRetainedOwnerUid: process.getuid?.() ?? 0,
    parentSnapshotRetainedMode: 0o600,
    parentSnapshotRetainedVerification: 'owned-stable-reader-v6' as const,
    parentManifestPath: 'manifest.json',
    parentManifestRetainedPath: context.manifestRetainedPath,
    parentManifestRetainedKind: 'sidecar' as const,
    parentManifestRetainedSha256: context.manifestSha256,
    parentManifestRetainedSizeBytes: context.manifestSizeBytes,
    parentManifestRetainedOwnerUid: process.getuid?.() ?? 0,
    parentManifestRetainedMode: 0o600,
    parentManifestRetainedVerification: 'owned-stable-reader-v6' as const,
    parentManifestSizeBytes: context.manifestSizeBytes,
    parentApiLedgerPath: 'api-session-start.json',
    parentApiLedgerRetainedPath: context.ledgerRetainedPath,
    parentApiLedgerRetainedKind: 'sidecar' as const,
    parentApiLedgerRetainedSha256: context.ledgerSha256,
    parentApiLedgerRetainedSizeBytes: context.ledgerSizeBytes,
    parentApiLedgerRetainedOwnerUid: process.getuid?.() ?? 0,
    parentApiLedgerRetainedMode: 0o600,
    parentApiLedgerRetainedVerification: 'owned-stable-reader-v6' as const,
    parentApiLedgerSizeBytes: context.ledgerSizeBytes,
    manifestSha256: context.manifestSha256,
    apiAttempt: 'session-start',
    apiLedgerSha256: context.ledgerSha256,
    fixtureAuthUidAllowlistHash: HASH('fixtures'),
  };
}

function writeParent<T>(
  context: ParentContext,
  label: string,
  schema: 'connection-snapshot-v1' | 'domain-snapshot-v1',
  value: T,
) {
  const pathName = `${label}.private.json`;
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  writeFileSync(path.join(context.parentRoot, pathName), bytes, {
    flag: 'wx',
    mode: 0o600,
  });
  return {
    value,
    receipt: parentReceipt(context, pathName, schema, bytes),
  };
}

function connectionEvidence(
  context: ParentContext,
  scope: string,
  label: string,
  identities: {
    fixtureAuthUids?: readonly string[];
    professionalAuthUid?: string;
    studentAuthUid?: string;
  } = {},
) {
  const professionalAuthUid = identities.professionalAuthUid ?? 'coach-fixture';
  const studentAuthUid = identities.studentAuthUid ?? 'student-fixture';
  const value = {
    kind: 'connection-snapshot-v1' as const,
    schemaVersion: 1,
    runId: RUN_ID,
    scope,
    readOnly: true,
    fixtureAuthUids: [...(identities.fixtureAuthUids ?? [professionalAuthUid, studentAuthUid])],
    target: {
      professionalAuthUid,
      studentAuthUid,
      specialty: 'fitness_coach' as const,
    },
    rows: {
      userProfiles: [],
      professionalSpecialties: [],
      inviteCodes: [],
      connections: [],
      connectionInviteGuards: [],
      pendingStudents: [],
      pendingStudentSlots: [],
      trackingAccess: [],
      activeSpecialties: [],
    },
    rowCounts: {
      userProfiles: 0,
      professionalSpecialties: 0,
      inviteCodes: 0,
      connections: 0,
      connectionInviteGuards: 0,
      pendingStudents: 0,
      pendingStudentSlots: 0,
      trackingAccess: 0,
      activeSpecialties: 0,
    },
  };
  return writeParent(context, label, 'connection-snapshot-v1', value) as Parameters<
    typeof writeAndroidCameraSqlSourceReceipts
  >[0]['before'];
}

function domainEvidence(context: ParentContext, scope: string, label: string) {
  const value = {
    schemaVersion: 1,
    runId: RUN_ID,
    scope,
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
  return writeParent(context, label, 'domain-snapshot-v1', value) as Parameters<
    typeof writeAndroidCameraSqlSourceReceipts
  >[0]['isolationBefore'];
}

function localeBinding(): NativeLocaleBinding {
  return {
    captureRunId: RUN_ID,
    sourceTreeHash: HASH('source-tree'),
    helperInputsHash: HASH('helper-inputs'),
    target: {
      platform: 'android',
      deviceId: 'emulator-5554',
      osVersion: '35',
      appId: 'com.edufelip.mychampions.dev',
      binaryHash: HASH('binary'),
      apiOrigin: API_ORIGIN,
    },
  };
}

function localeProperties(stdoutText: string) {
  const selected = {
    execution: 'completed' as const,
    cleanup: 'cleaned' as const,
    attempted: true,
    stdoutText,
    status: 'completed' as const,
    value: stdoutText.trim() || null,
    pid: 77,
    pgid: 77,
  };
  return {
    persisted: selected,
    productDefault: null,
    selected,
    selectedProperty: 'persist.sys.locale' as const,
  };
}

function localeTree(input: {
  hydration: 'hydrated' | 'pending';
  locale?: 'en-US' | 'pt-BR' | 'es-ES';
  override?: 'absent' | 'present' | 'unobserved';
}) {
  const children: { attributes: Record<string, string>; children: [] }[] = [
    {
      attributes: { testID: `testing.locale.hydration.${input.hydration}` },
      children: [],
    },
  ];
  if (input.hydration === 'hydrated') {
    children.push({
      attributes: {
        testID: `testing.locale.effective.${input.locale ?? 'en-US'}`,
      },
      children: [],
    });
  }
  children.push({
    attributes: {
      testID: `testing.locale.override.${input.override ?? 'absent'}`,
    },
    children: [],
  });
  if (input.override === 'present')
    children.push({
      attributes: {
        testID: `testing.locale.overrideValue.${input.locale ?? 'en-US'}`,
      },
      children: [],
    });
  return {
    attributes: { testID: 'testing.locale.diagnostic' },
    children,
  };
}

function writeLocaleTree(root: string, tree: unknown): void {
  writeFileSync(path.join(root, 'entry-hierarchy.json'), JSON.stringify(tree), {
    flag: 'wx',
    mode: 0o600,
  });
}

void test('Android camera locale bridge qualifies actual command plus hierarchy evidence while preparation stays blocked', async () => {
  const root = privateRoot();
  try {
    const binding = localeBinding();
    writeLocaleTree(
      root,
      localeTree({
        hydration: 'hydrated',
        locale: 'en-US',
        override: 'absent',
      }),
    );
    const properties = localeProperties('en-US\n');
    const evidence = readQualifiedAndroidCameraLocaleEvidence({
      artifactRoot: realpathSync(root),
      hierarchyPath: 'entry-hierarchy.json',
      properties,
      expectedLocale: 'en-US',
      expectedBinding: binding,
    });
    assert.equal(evidence.effectiveAppLocale.value, 'en-US');
    const observer = buildAndroidCameraLocaleObserver({
      artifactRoot: realpathSync(root),
      hierarchyPath: 'entry-hierarchy.json',
      properties,
      expectedLocale: 'en-US',
      expectedBinding: binding,
    });
    const observed = await observer.readEvidence({
      properties,
      signal: new AbortController().signal,
    });
    assert(observed && typeof observed === 'object' && 'requestedLocale' in observed);
    assert.equal((observed as { requestedLocale: string }).requestedLocale, 'en-US');

    const candidate = buildNativeLocaleContextCandidate({
      hierarchy: localeTree({
        hydration: 'hydrated',
        locale: 'en-US',
        override: 'absent',
      }),
      hierarchyPath: 'entry-hierarchy.json',
      hierarchyHash: HASH('hierarchy'),
      binding,
      expectedBinding: binding,
      observedOsLocale: evidence.observedOsLocale,
    });
    assert.equal(candidate.runtimeQualification, 'pending');
    assert(candidate.blockers.includes('runtime-proof-pending'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('Android camera locale bridge rejects absent OS output and pending app hydration', () => {
  const cases = [
    {
      stdoutText: '',
      tree: localeTree({
        hydration: 'hydrated',
        locale: 'en-US',
        override: 'absent',
      }),
    },
    {
      stdoutText: 'en-US\n',
      tree: localeTree({ hydration: 'pending', override: 'unobserved' }),
    },
  ] as const;
  for (const [index, current] of cases.entries()) {
    const root = privateRoot();
    try {
      writeLocaleTree(root, current.tree);
      assert.throws(
        () =>
          readQualifiedAndroidCameraLocaleEvidence({
            artifactRoot: realpathSync(root),
            hierarchyPath: 'entry-hierarchy.json',
            properties: localeProperties(current.stdoutText),
            expectedLocale: 'en-US',
            expectedBinding: localeBinding(),
          }),
        index === 0 ? /os-locale-unavailable|unavailable/ : /app-locale-not-hydrated|not qualified/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

void test('camera prompt producer requires an actionable permission-controller tree', () => {
  const tree = JSON.parse(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../fixtures/native-camera-android-prompt-v18.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
  const promptCommand: AndroidCameraCommandReceipt = {
    label: 'prompt',
    captureRunId: RUN_ID,
    ownerRunId: RUN_ID,
    serial: 'emulator-5554',
    appId: 'com.edufelip.mychampions.dev',
    attemptId: `${RUN_ID}:first`,
    argv: [],
    execution: {
      phase: 'step',
      execution: 'completed',
      cleanup: 'cleaned',
      childExitCode: 0,
      childSignal: null,
      pid: 1,
      pgid: 1,
      logPath: null,
      stdoutPath: null,
      ownershipPath: null,
      elapsedMs: 1,
      cleanupMs: 1,
      censusFailure: null,
      outputFailure: null,
    },
    stdout: null,
  };
  const source: AndroidCameraFrameSource = {
    label: 'prompt',
    captureRunId: RUN_ID,
    ownerRunId: RUN_ID,
    serial: 'emulator-5554',
    appId: 'com.edufelip.mychampions.dev',
    attemptId: `${RUN_ID}:first`,
    command: promptCommand,
    receipt: {
      path: 'prompt-hierarchy.json',
      sizeBytes: 1,
      sha256: HASH('prompt-hierarchy'),
      ownerUid: process.getuid?.() ?? -1,
      mode: 0o600,
      contentKind: 'hierarchy-json',
      verification: 'owned-stable-reader-v6',
    },
    action: {
      invocationId: `${RUN_ID}:prompt`,
      ordinal: 0,
      label: 'prompt',
      actionsSha256: HASH('prompt-actions'),
      viewId: 'prompt',
      selectorKind: 'id',
      selectors: ['student.camera.prompt'],
      commandLabel: 'prompt',
      commandOrdinal: 0,
    },
  };
  const spec = deriveAndroidCameraPromptSpec({
    source,
    tree,
    serial: 'emulator-5554',
    apiLevel: 35,
    locale: 'en-US',
    expectedAppLabel: 'MyChampions Dev',
  });
  assert.equal(spec.appLabel, 'MyChampions Dev');
  assert.equal(spec.systemPackage, 'com.android.permissioncontroller');
  assert.equal(spec.title.attribute, 'resource-id');
  assert.equal(spec.title.value, 'com.android.permissioncontroller:id/permission_message');
  assert.equal(spec.deny.attribute, 'resource-id');
  assert.equal(spec.deny.value, 'com.android.permissioncontroller:id/permission_deny_button');
  assert.match(buildAndroidCameraPromptActions(), /scanQrButton/);
  assert.match(
    buildAndroidCameraManualEntryActions('unit-code'),
    /student\.professionals\.codeInput/,
  );
  const readiness = [
    '^com\\.(?:android\\.permissioncontroller|google\\.android\\.permissioncontroller):id/permission_message$',
    '^com\\.(?:android\\.permissioncontroller|google\\.android\\.permissioncontroller):id/permission_deny_button$',
  ];
  const resolved = requireAndroidCameraPromptHierarchy({
    tree,
    requiredSelectors: readiness,
    kind: 'id',
    serial: 'emulator-5554',
    apiLevel: 35,
    locale: 'en-US',
    expectedAppLabel: 'MyChampions Dev',
  });
  assert.deepEqual(resolved.selectors, [
    'com.android.permissioncontroller:id/permission_message',
    'com.android.permissioncontroller:id/permission_deny_button',
  ]);
  assert.throws(
    () =>
      requireAndroidCameraPromptHierarchy({
        tree,
        requiredSelectors: ['com.android.permissioncontroller:id/permission_message'],
        kind: 'id',
        serial: 'emulator-5554',
        apiLevel: 35,
        locale: 'en-US',
        expectedAppLabel: 'MyChampions Dev',
      }),
    /bounded contract/,
  );
  assert.throws(
    () => buildAndroidCameraManualEntryActions('unsafe\ncode'),
    /manual invite code is invalid/,
  );
});

void test('permission command parser remains closed and rejects ambiguous output', () => {
  const appId = 'com.edufelip.mychampions.dev';
  const dumpsys = (
    granted: boolean,
    flags = 'USER_SENSITIVE_WHEN_GRANTED',
  ) => `Package [${appId}] (deadbeef):
  User 0:
    runtime permissions:
      android.permission.CAMERA: granted=${granted}, flags=[ ${flags} ]
`;
  assert.throws(
    () =>
      parseAndroidCameraPermissionStatus(
        `Package [${appId}] (deadbeef):\nOther service:\nUser 0:\n  runtime permissions:\n    android.permission.CAMERA: granted=false, flags=[]\n`,
        appId,
      ),
    /User 0 permission section is missing or ambiguous/,
  );
  assert.throws(
    () => parseAndroidCameraPermissionFlags(dumpsys(false, 'USER_SET,USER_FIXED'), appId),
    /flags are malformed/,
  );
  assert.throws(
    () => parseAndroidCameraPermissionFlags(dumpsys(false, 'USER_SETUSER_FIXED'), appId),
    /flags are malformed/,
  );
  const commands = buildAndroidCameraPermissionCommands(appId);
  assert.deepEqual(commands.clearUserDecision, [
    'shell',
    'pm',
    'clear-permission-flags',
    '--user',
    '0',
    appId,
    'android.permission.CAMERA',
    'user-set',
    'user-fixed',
  ]);
  assert.deepEqual(commands.revoke, [
    'shell',
    'pm',
    'revoke',
    '--user',
    '0',
    appId,
    'android.permission.CAMERA',
  ]);
  assert.deepEqual(commands.check, ['shell', 'dumpsys', 'package', appId]);
  assert.deepEqual(commands.checkFlags, commands.check);
  assert.equal(parseAndroidCameraPermissionStatus(dumpsys(false), appId), 'denied');
  assert.deepEqual(parseAndroidCameraPermissionFlags(dumpsys(false), appId), [
    'USER_SENSITIVE_WHEN_GRANTED',
  ]);
  assert.equal(
    parseAndroidCameraPermissionStatus(
      dumpsys(true, 'USER_SET|USER_SENSITIVE_WHEN_GRANTED'),
      appId,
    ),
    'granted',
  );
  assert.deepEqual(
    parseAndroidCameraPermissionFlags(dumpsys(false, 'USER_SET|USER_FIXED'), appId),
    ['USER_SET', 'USER_FIXED'],
  );
  assert.throws(
    () => parseAndroidCameraPermissionStatus('denied\n', appId),
    /legacy Android scalar permission output/,
  );
  assert.throws(
    () => parseAndroidCameraPermissionStatus('denied\ngranted', appId),
    /package dump header/,
  );
  assert.throws(
    () =>
      parseAndroidCameraPermissionStatus(
        dumpsys(false).replace('Package [', 'Package [foreign.'),
        appId,
      ),
    /crossed package identity/,
  );
  assert.throws(
    () => parseAndroidCameraPermissionStatus(dumpsys(false).replace(appId, 'com.other.app'), appId),
    /crossed package identity/,
  );
  assert.throws(
    () => parseAndroidCameraPermissionStatus(`${dumpsys(false)}${dumpsys(false)}`, appId),
    /package dump header is missing or ambiguous/,
  );
  assert.throws(
    () =>
      parseAndroidCameraPermissionStatus(
        dumpsys(false).replace('    runtime permissions:', ''),
        appId,
      ),
    /runtime permission section is missing or ambiguous/,
  );
  assert.throws(
    () => parseAndroidCameraPermissionStatus(dumpsys(false).replace('User 0:', 'User 10:'), appId),
    /User 0 permission section is missing or ambiguous/,
  );
  assert.throws(
    () =>
      parseAndroidCameraPermissionStatus(
        dumpsys(false).replace('runtime permissions:', 'requested permissions:'),
        appId,
      ),
    /User 0 runtime permission section is missing or ambiguous/,
  );
  assert.throws(
    () =>
      parseAndroidCameraPermissionStatus(
        dumpsys(false).replace('granted=false', 'granted=unknown'),
        appId,
      ),
    /camera permission row is missing or ambiguous/,
  );
  assert.throws(
    () =>
      parseAndroidCameraPermissionStatus(
        dumpsys(false).replace(
          '      android.permission.CAMERA: granted=false, flags=[ USER_SENSITIVE_WHEN_GRANTED ]',
          '',
        ),
        appId,
      ),
    /camera permission row is missing or ambiguous/,
  );
  assert.throws(
    () =>
      parseAndroidCameraPermissionFlags(
        `${dumpsys(false)}      android.permission.CAMERA: granted=false, flags=[ USER_SET ]\n`,
        appId,
      ),
    /missing or ambiguous/,
  );
});

void test('permission evidence binds all four protected stdout receipts to their commands', async () => {
  const root = privateRoot();
  const appId = 'com.edufelip.mychampions.dev';
  const commands = buildAndroidCameraPermissionCommands(appId);
  const dumpsys = (granted: boolean, flags: string) => `Package [${appId}] (deadbeef):
  User 0:
    runtime permissions:
      android.permission.CAMERA: granted=${granted}, flags=[ ${flags} ]
`;
  const writeStdout = (relativePath: string, text: string) => {
    const bytes = Buffer.from(text, 'utf8');
    writeFileSync(path.join(root, relativePath), bytes, { mode: 0o600 });
    return {
      path: relativePath,
      kind: 'sidecar' as const,
      sizeBytes: bytes.byteLength,
      sha256: HASH(text),
      ownerUid: process.getuid?.() ?? -1,
      mode: 0o600,
      verification: 'owned-stable-reader-v6' as const,
    };
  };
  const execution = (pid: number, stdoutPath: string | null) => ({
    phase: 'step' as const,
    execution: 'completed' as const,
    cleanup: 'cleaned' as const,
    childExitCode: 0,
    childSignal: null,
    pid,
    pgid: pid,
    logPath: path.join(root, `command-${pid}.private.log`),
    stdoutPath: stdoutPath ? path.join(root, stdoutPath) : null,
    ownershipPath: path.join(root, `command-${pid}.ownership.json`),
    elapsedMs: 1,
    cleanupMs: 1,
    censusFailure: null,
    outputFailure: null,
  });
  const command = (
    label: string,
    argv: readonly string[],
    pid: number,
    stdoutPath: string | null,
    stdout: ReturnType<typeof writeStdout> | null,
  ) => ({
    label,
    captureRunId: RUN_ID,
    ownerRunId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    serial: 'emulator-5554',
    appId,
    attemptId: 'cccccccccccccccccccccccc:first',
    argv,
    execution: execution(pid, stdoutPath),
    stdout,
  });
  const identity: AndroidCameraRuntimeIdentity = {
    captureRunId: RUN_ID,
    ownerRunId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    backendRunId: 'cccccccccccccccccccccccc',
    backendAttemptId: 'cccccccccccccccccccccccc:first',
    serial: 'emulator-5554',
    appId,
    apiOrigin: API_ORIGIN,
    apiPid: API_PID,
    apiStarted: '2026-10-04T00:00:00.000Z',
    apiScript: 'fixture-api',
    target: {
      deviceId: 'emulator-5554',
      osVersion: '17',
      appId,
      buildProfile: 'dev',
      binaryHash: 'a'.repeat(64),
      apiOrigin: API_ORIGIN,
    },
    locale: {
      schemaVersion: 1,
      requestedLocale: 'en-US',
      observedOsLocale: {
        status: 'observed',
        source: 'android-getprop',
        raw: 'en-US',
        resolved: 'en-US',
        normalization: 'exact',
      },
      effectiveAppLocale: {
        hydration: 'hydrated',
        source: 'LocaleContext',
        value: 'en-US',
      },
      override: { status: 'absent', source: 'language-storage', value: null },
      binding: localeBinding(),
    },
  };
  try {
    const beforeText = dumpsys(false, 'USER_SENSITIVE_WHEN_GRANTED');
    const afterText = dumpsys(false, 'USER_SET');
    const before = writeStdout('before.stdout', beforeText);
    const after = writeStdout('after.stdout', afterText);
    const beforeFlags = writeStdout('before-flags.stdout', beforeText);
    const afterFlags = writeStdout('after-flags.stdout', afterText);
    const clear = command('clear', commands.clearUserDecision, 101, null, null);
    const revoke = command('revoke', commands.revoke, 102, null, null);
    const beforeCheck = {
      ...command('before-check', commands.check, 103, 'before.stdout', before),
      state: {
        status: 'denied' as const,
        decisionFlags: ['USER_SENSITIVE_WHEN_GRANTED'],
      },
      flagsCommand: command(
        'before-check-flags',
        commands.checkFlags,
        104,
        'before-flags.stdout',
        beforeFlags,
      ),
    };
    const afterCheck = {
      ...command('after-check', commands.check, 105, 'after.stdout', after),
      state: { status: 'denied' as const, decisionFlags: ['USER_SET'] },
      flagsCommand: command(
        'after-check-flags',
        commands.checkFlags,
        106,
        'after-flags.stdout',
        afterFlags,
      ),
    };
    const result = await requireAndroidCameraPermissionEvidence({
      artifactRoot: root,
      identity,
      clearUserDecision: clear,
      revoke,
      beforeCheck,
      afterCheck,
    });
    assert.equal(result.status, 'denied');
    assert.deepEqual(result.after.decisionFlags, ['USER_SET']);

    for (const field of ['censusFailure', 'outputFailure'] as const) {
      await assert.rejects(
        requireAndroidCameraPermissionEvidence({
          artifactRoot: root,
          identity,
          clearUserDecision: {
            ...clear,
            execution: Object.assign({}, clear.execution, {
              [field]: { failure: 'observed' },
            }),
          },
          revoke,
          beforeCheck,
          afterCheck,
        }),
      );
    }

    await assert.rejects(
      requireAndroidCameraPermissionEvidence({
        artifactRoot: root,
        identity,
        clearUserDecision: clear,
        revoke,
        beforeCheck: {
          ...beforeCheck,
          stdout: { ...before, path: 'after.stdout' },
        },
        afterCheck,
      }),
      /not bound to its command output/,
    );

    const combinedAfterText = dumpsys(false, 'USER_SET|USER_FIXED');
    const combinedAfterFlags = writeStdout('after-flags-combined.stdout', combinedAfterText);
    await assert.rejects(
      requireAndroidCameraPermissionEvidence({
        artifactRoot: root,
        identity,
        clearUserDecision: clear,
        revoke,
        beforeCheck,
        afterCheck: {
          ...afterCheck,
          state: {
            status: 'denied' as const,
            decisionFlags: ['USER_SET', 'USER_FIXED'],
          },
          flagsCommand: {
            ...afterCheck.flagsCommand,
            execution: {
              ...afterCheck.flagsCommand.execution,
              stdoutPath: path.join(root, 'after-flags-combined.stdout'),
            },
            stdout: combinedAfterFlags,
          },
        },
      }),
      /one-time denial/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('camera CLI branch requires the exact declared Android charter and locale', () => {
  const args = [
    '--platform=android',
    '--engine=maestro',
    '--scenario=SCN-camera-denied-android',
    '--mode=integration',
    '--charter=camera-denied',
    '--locale=pt-BR',
  ];
  assert.deepEqual(parseAndroidNativeCaptureArguments(args), {
    charter: 'camera-denied',
    expectedLocale: 'pt-BR',
  });
  assert.throws(
    () => parseAndroidNativeCaptureArguments(args.filter((value) => value !== '--locale=pt-BR')),
    /Invalid Android camera native capture arguments/,
  );
  assert.throws(
    () => parseAndroidNativeCaptureArguments([...args, '--locale=en-US']),
    /Invalid Android camera native capture arguments/,
  );
});

function isolationFixtureDocument() {
  const exerciseId = '01234567-89ab-cdef-0123-456789abcdef';
  const account = (authUid: string, role: string | null) => ({
    email: `${authUid}@example.test`,
    password: 'isolation-password',
    authUid,
    role,
  });
  return {
    schemaVersion: 1 as const,
    runId: RUN_ID,
    scope: 'native-conn-isolation-android',
    accounts: {
      new: account('isolation-new', null),
      student: account('isolation-student', 'student'),
      coach: account('isolation-coach', 'professional'),
      'unrelated-student': account('isolation-unrelated-student', 'student'),
      'unrelated-coach': account('isolation-unrelated-coach', 'professional'),
      'pending-student': account('isolation-pending-student', 'student'),
      'active-student': account('isolation-active-student', 'student'),
    },
    pendingConnectionId: '01234567-89ab-cdef-0123-456789abcdef',
    activeConnectionId: '11234567-89ab-cdef-0123-456789abcdef',
    savedPlanId: 'training_plan_01234567-89ab-cdef-0123-456789abcdef',
    draft: {
      name: 'Isolation plan',
      sessions: [
        {
          id: 'isolation-session',
          name: 'Isolation session',
          notes: '',
          items: [
            {
              id: 'isolation-item',
              name: 'Isolation exercise',
              quantity: '1',
              notes: '',
              exerciseId,
            },
          ],
        },
      ],
    },
  };
}

function writeIsolationFixtureProof(root: string) {
  const relativePath = 'fixtures-native-connection-isolation-android.private.json';
  const bytes = Buffer.from(JSON.stringify(isolationFixtureDocument()) + '\n');
  writeFileSync(path.join(root, relativePath), bytes, {
    flag: 'wx',
    mode: 0o600,
  });
  const fixtureAuthUids = [
    'isolation-active-student',
    'isolation-coach',
    'isolation-new',
    'isolation-pending-student',
    'isolation-student',
    'isolation-unrelated-coach',
    'isolation-unrelated-student',
  ];
  const target = {
    professionalAuthUid: 'isolation-coach',
    studentAuthUid: 'isolation-student',
    specialty: 'fitness_coach' as const,
  };
  const binding = {
    path: relativePath,
    kind: 'sidecar' as const,
    sizeBytes: bytes.byteLength,
    sha256: HASH(bytes.toString('utf8')),
    ownerUid: process.getuid?.() ?? -1,
    mode: 0o600,
    verification: 'owned-stable-reader-v6' as const,
    source: 'owned-session.fixtures' as const,
    runId: RUN_ID,
    scope: 'native-conn-isolation-android',
    fixtureAuthUids,
    target,
  };
  const expected = {
    runId: RUN_ID,
    scope: 'native-conn-isolation-android',
    fixtureAuthUids,
    target,
  };
  return { binding, expected, fixtureAuthUids, relativePath, bytes };
}

void test(
  'Android camera default capture binds a distinct protected isolation fixture and rejects crossed or stale proof',
  { concurrency: false },
  async () => {
    const source = readFileSync(
      path.join(process.cwd(), 'scripts/testing/capture-android-testability.ts'),
      'utf8',
    );
    assert.match(source, /connectionIsolationFixtures\s*=\s*await\s+sessionDirectIo/u);
    assert.match(source, /fixtures-native-connection-isolation-android\.private\.json/u);
    assert.match(source, /isolationExpected/u);
    assert.match(source, /isolationFixture:\s*connectionIsolationFixtureBinding/u);

    const root = privateRoot();
    try {
      const proof = writeIsolationFixtureProof(root);
      const checked = await requireAndroidCameraIsolationFixtureBinding(proof.binding, {
        artifactRoot: realpathSync(root),
        backendRunId: RUN_ID,
        primaryFixtureAuthUids: ['primary-coach', 'primary-student'],
        isolationExpected: proof.expected,
        signal: new AbortController().signal,
      });
      assert.deepEqual(checked, proof.binding);
      assert.notDeepEqual(checked.fixtureAuthUids, ['primary-coach', 'primary-student']);

      const crossedFixtureAuthUids = proof.fixtureAuthUids.map((uid) =>
        uid === 'isolation-new' ? 'primary-coach' : uid,
      );
      await assert.rejects(
        requireAndroidCameraIsolationFixtureBinding(
          { ...proof.binding, fixtureAuthUids: crossedFixtureAuthUids },
          {
            artifactRoot: realpathSync(root),
            backendRunId: RUN_ID,
            primaryFixtureAuthUids: ['primary-coach', 'primary-student'],
            isolationExpected: {
              ...proof.expected,
              fixtureAuthUids: crossedFixtureAuthUids,
            },
            signal: new AbortController().signal,
          },
        ),
        /overlaps the primary fixture identities/u,
      );

      unlinkSync(path.join(root, proof.relativePath));
      await assert.rejects(
        requireAndroidCameraIsolationFixtureBinding(proof.binding, {
          artifactRoot: realpathSync(root),
          backendRunId: RUN_ID,
          primaryFixtureAuthUids: ['primary-coach', 'primary-student'],
          isolationExpected: proof.expected,
          signal: new AbortController().signal,
        }),
        /ENOENT/u,
      );

      writeFileSync(path.join(root, proof.relativePath), proof.bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      writeFileSync(path.join(root, proof.relativePath), Buffer.from('tampered\n'), {
        flag: 'w',
        mode: 0o600,
      });
      await assert.rejects(
        requireAndroidCameraIsolationFixtureBinding(proof.binding, {
          artifactRoot: realpathSync(root),
          backendRunId: RUN_ID,
          primaryFixtureAuthUids: ['primary-coach', 'primary-student'],
          isolationExpected: proof.expected,
          signal: new AbortController().signal,
        }),
        /receipt|hash|size|changed/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

function sqlInputs(root: string) {
  const context = parentContext(root);
  const probeApiLifetime = (): Promise<OwnedApiLifetimeProbe> =>
    Promise.resolve({
      runId: RUN_ID,
      apiOrigin: API_ORIGIN,
      apiPid: API_PID,
      apiStarted: API_STARTED,
      apiScript: API_SCRIPT,
      backendAttemptId: `${RUN_ID}:first`,
      manifestSha256: context.manifestSha256,
      apiAttempt: 'session-start',
      apiLedgerSha256: context.ledgerSha256,
    });
  const before = connectionEvidence(context, 'native-entry-android', 'before');
  const pending = connectionEvidence(context, 'native-entry-android', 'pending');
  const isolationIdentity = {
    fixtureAuthUids: ['isolation-coach', 'isolation-student'],
    professionalAuthUid: 'isolation-coach',
    studentAuthUid: 'isolation-student',
  };
  const isolationBefore = connectionEvidence(
    context,
    'native-conn-isolation-android',
    'isolation-before',
    isolationIdentity,
  );
  const isolationAfter = connectionEvidence(
    context,
    'native-conn-isolation-android',
    'isolation-after',
    isolationIdentity,
  );
  const trainingBefore = domainEvidence(context, 'native-training-android', 'training-before');
  const trainingAfter = domainEvidence(context, 'native-training-android', 'training-after');
  return {
    context,
    parentRoot: context.parentRoot,
    probeApiLifetime,
    before,
    pending,
    expected: {
      runId: RUN_ID,
      scope: 'native-entry-android',
      fixtureAuthUids: ['coach-fixture', 'student-fixture'],
      target: {
        professionalAuthUid: 'coach-fixture',
        studentAuthUid: 'student-fixture',
        specialty: 'fitness_coach' as const,
      },
    },
    isolationBefore,
    isolationAfter,
    trainingBefore,
    trainingAfter,
    isolationExpected: {
      runId: RUN_ID,
      scope: 'native-conn-isolation-android',
      fixtureAuthUids: [...isolationIdentity.fixtureAuthUids],
      target: {
        professionalAuthUid: 'isolation-coach',
        studentAuthUid: 'isolation-student',
        specialty: 'fitness_coach' as const,
      },
    },
    parentEvidence: {
      before,
      pending,
      'isolation-before': isolationBefore,
      'isolation-after': isolationAfter,
      'training-before': trainingBefore,
      'training-after': trainingAfter,
    },
  };
}

function currentQualifiedQConnectionSqlInputs(root: string) {
  const base = sqlInputs(root);
  const isolationBefore = connectionEvidence(
    base.context,
    'native-conn-isolation-android',
    'isolation-before-connection',
    {
      fixtureAuthUids: ['isolation-coach', 'isolation-student'],
      professionalAuthUid: 'isolation-coach',
      studentAuthUid: 'isolation-student',
    },
  );
  const isolationAfter = connectionEvidence(
    base.context,
    'native-conn-isolation-android',
    'isolation-after-connection',
    {
      fixtureAuthUids: ['isolation-coach', 'isolation-student'],
      professionalAuthUid: 'isolation-coach',
      studentAuthUid: 'isolation-student',
    },
  );
  const trainingBefore = connectionEvidence(
    base.context,
    'native-training-android',
    'training-before-connection',
  );
  const trainingAfter = connectionEvidence(
    base.context,
    'native-training-android',
    'training-after-connection',
  );
  return {
    ...base,
    isolationBefore,
    isolationAfter,
    trainingBefore,
    trainingAfter,
    isolationExpected: {
      runId: RUN_ID,
      scope: 'native-conn-isolation-android',
      fixtureAuthUids: ['isolation-coach', 'isolation-student'],
      target: {
        professionalAuthUid: 'isolation-coach',
        studentAuthUid: 'isolation-student',
        specialty: 'fitness_coach' as const,
      },
    },
    parentEvidence: {
      ...base.parentEvidence,
      'isolation-before': isolationBefore,
      'isolation-after': isolationAfter,
      'training-before': trainingBefore,
      'training-after': trainingAfter,
    },
  };
}

void test('SQL producer emits protected parent-bound projections and the reader rechecks every byte', async () => {
  const root = privateRoot();
  try {
    const inputs = sqlInputs(root);
    const receipts = await writeAndroidCameraSqlSourceReceipts({
      artifactRoot: realpathSync(root),
      ...inputs,
    });
    assert.equal(receipts.length, 38);
    assert.equal(receipts.filter((row) => row.table === 'domain').length, 2);
    assert.equal(receipts.filter((row) => row.table !== 'domain').length, 36);
    assert.equal(new Set(receipts.map((row) => row.path)).size, 38);
    for (const receipt of receipts) {
      assert.equal(statSync(path.join(root, receipt.path)).mode & 0o777, 0o600);
      assert.equal(
        receipt.parentSnapshotSha256,
        HASH(readFileSync(path.join(inputs.parentRoot, receipt.parentSnapshotPath), 'utf8')),
      );
      assert.equal(
        receipt.parentSnapshotSizeBytes,
        statSync(path.join(inputs.parentRoot, receipt.parentSnapshotPath)).size,
      );
      assert.equal(receipt.parentSnapshotOwnerUid, process.getuid?.());
      assert.equal(receipt.parentSnapshotMode, 0o600);
      assert.equal(
        statSync(path.join(root, receipt.parentSnapshotRetainedPath)).mode & 0o777,
        0o600,
      );
      assert.equal(
        statSync(path.join(root, receipt.parentManifestRetainedPath)).mode & 0o777,
        0o600,
      );
      assert.equal(
        statSync(path.join(root, receipt.parentApiLedgerRetainedPath)).mode & 0o777,
        0o600,
      );
      const bytes = readFileSync(path.join(root, receipt.path));
      assert.equal(HASH(bytes.toString('utf8')), receipt.sha256);
    }
    rmSync(inputs.parentRoot, { recursive: true, force: true });
    await requireAndroidCameraSqlSourceProjections({
      artifactRoot: realpathSync(root),
      connectionScope: 'native-entry-android',
      expected: inputs.expected,
      isolationScope: 'native-conn-isolation-android',
      isolationExpected: inputs.isolationExpected,
      trainingScope: 'native-training-android',
      sourceReceipts: receipts,
      parentEvidence: inputs.parentEvidence,
    });
    assert.equal(readdirSync(root).length, 46);
    const first = receipts[0];
    assert(first);
    const manifestPath = path.join(root, first.parentManifestRetainedPath);
    const ledgerPath = path.join(root, first.parentApiLedgerRetainedPath);
    const manifestBytes = readFileSync(manifestPath);
    const ledgerBytes = readFileSync(ledgerPath);
    writeFileSync(manifestPath, Buffer.concat([manifestBytes, Buffer.from(' ')]), {
      mode: 0o600,
    });
    await assert.rejects(
      requireAndroidCameraSqlSourceProjections({
        artifactRoot: realpathSync(root),
        connectionScope: 'native-entry-android',
        expected: inputs.expected,
        isolationScope: 'native-conn-isolation-android',
        isolationExpected: inputs.isolationExpected,
        trainingScope: 'native-training-android',
        sourceReceipts: receipts,
        parentEvidence: inputs.parentEvidence,
      }),
      /manifest|hash|size|SQL/u,
    );
    writeFileSync(manifestPath, manifestBytes, { mode: 0o600 });
    writeFileSync(ledgerPath, Buffer.concat([ledgerBytes, Buffer.from(' ')]), {
      mode: 0o600,
    });
    await assert.rejects(
      requireAndroidCameraSqlSourceProjections({
        artifactRoot: realpathSync(root),
        connectionScope: 'native-entry-android',
        expected: inputs.expected,
        isolationScope: 'native-conn-isolation-android',
        isolationExpected: inputs.isolationExpected,
        trainingScope: 'native-training-android',
        sourceReceipts: receipts,
        parentEvidence: inputs.parentEvidence,
      }),
      /ledger|hash|size|SQL/u,
    );
    writeFileSync(ledgerPath, ledgerBytes, { mode: 0o600 });
    const foreign = path.join(root, 'foreign-parent.json');
    writeFileSync(foreign, readFileSync(path.join(root, first.parentSnapshotRetainedPath)), {
      mode: 0o600,
    });
    unlinkSync(path.join(root, first.parentSnapshotRetainedPath));
    symlinkSync(foreign, path.join(root, first.parentSnapshotRetainedPath));
    await assert.rejects(
      requireAndroidCameraSqlSourceProjections({
        artifactRoot: realpathSync(root),
        connectionScope: 'native-entry-android',
        expected: inputs.expected,
        isolationScope: 'native-conn-isolation-android',
        isolationExpected: inputs.isolationExpected,
        trainingScope: 'native-training-android',
        sourceReceipts: receipts,
        parentEvidence: inputs.parentEvidence,
      }),
      /canonical|symbolic|link|SQL/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('SQL source accepts current-Q connection snapshots for isolation and training', async () => {
  const root = privateRoot();
  try {
    const inputs = currentQualifiedQConnectionSqlInputs(root);
    const receipts = await writeAndroidCameraSqlSourceReceipts({
      artifactRoot: realpathSync(root),
      ...inputs,
    });
    assert.equal(receipts.length, 54);
    assert.equal(receipts.filter((row) => row.table === 'domain').length, 0);
    for (const phase of [
      'isolation-before',
      'isolation-after',
      'training-before',
      'training-after',
    ] as const) {
      assert.equal(receipts.filter((row) => row.phase === phase).length, 9);
    }
    rmSync(inputs.parentRoot, { recursive: true, force: true });
    await requireAndroidCameraSqlSourceProjections({
      artifactRoot: realpathSync(root),
      connectionScope: 'native-entry-android',
      expected: inputs.expected,
      isolationScope: 'native-conn-isolation-android',
      isolationExpected: inputs.isolationExpected,
      trainingScope: 'native-training-android',
      sourceReceipts: receipts,
      parentEvidence: inputs.parentEvidence,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('SQL producer drains started groups before reporting a collision', async () => {
  const root = privateRoot();
  try {
    const inputs = sqlInputs(root);
    const collisionPath = path.join(root, 'camera-sql-before-userProfiles.private.json');
    const foreignBytes = Buffer.from('{"foreign":"pre-existing"}\n', 'utf8');
    writeFileSync(collisionPath, foreignBytes, { flag: 'wx', mode: 0o600 });
    const snapshot = (): ReadonlyMap<string, string> =>
      new Map(
        readdirSync(root)
          .filter((name) => statSync(path.join(root, name)).isFile())
          .sort()
          .map((name) => [
            name,
            createHash('sha256')
              .update(readFileSync(path.join(root, name)))
              .digest('hex'),
          ]),
      );
    const before = snapshot();
    await assert.rejects(
      writeAndroidCameraSqlSourceReceipts({
        artifactRoot: realpathSync(root),
        ...inputs,
      }),
      /EEXIST|already exists|file exists/i,
    );
    const afterFailure = snapshot();
    assert.deepEqual(readFileSync(collisionPath), foreignBytes);
    assert(afterFailure.size > before.size);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(snapshot(), afterFailure);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('SQL producer preserves an owned cancellation reason before projection writes', async () => {
  const root = privateRoot();
  try {
    const inputs = sqlInputs(root);
    const controller = new AbortController();
    controller.abort(new Error('camera SQL cancellation'));
    await assert.rejects(
      writeAndroidCameraSqlSourceReceipts({
        artifactRoot: realpathSync(root),
        ...inputs,
        signal: controller.signal,
      }),
      /camera SQL cancellation/,
    );
    assert.equal(
      readdirSync(root).filter((name) =>
        /^camera-sql-(?:before|pending|isolation|training)-/u.test(name),
      ).length,
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('SQL producer and reader reject missing, tampered and dishonest parent evidence', async () => {
  const cases: readonly [
    string,
    (root: string, inputs: ReturnType<typeof sqlInputs>) => Promise<void>,
  ][] = [
    [
      'missing parent',
      async (root, inputs) => {
        unlinkSync(path.join(inputs.parentRoot, inputs.before.receipt.path));
        await assert.rejects(
          writeAndroidCameraSqlSourceReceipts({
            artifactRoot: realpathSync(root),
            ...inputs,
          }),
          /ENOENT|original SQL parent snapshot/,
        );
      },
    ],
    [
      'tampered parent',
      async (root, inputs) => {
        writeFileSync(
          path.join(inputs.parentRoot, inputs.pending.receipt.path),
          JSON.stringify({ ...inputs.pending.value, scope: 'tampered-scope' }),
          { mode: 0o600 },
        );
        await assert.rejects(
          writeAndroidCameraSqlSourceReceipts({
            artifactRoot: realpathSync(root),
            ...inputs,
          }),
          /parent snapshot hash|Expected values/,
        );
      },
    ],
    [
      'dishonest supplied value',
      async (root, inputs) => {
        const dishonest = {
          ...inputs,
          before: {
            ...inputs.before,
            value: {
              ...inputs.before.value,
              rowCounts: { ...inputs.before.value.rowCounts, userProfiles: 1 },
            },
          },
        } as typeof inputs;
        await assert.rejects(
          writeAndroidCameraSqlSourceReceipts({
            artifactRoot: realpathSync(root),
            ...dishonest,
          }),
          /supplied SQL parent value differs from its file/,
        );
      },
    ],
    [
      'tampered child projection',
      async (root, inputs) => {
        const receipts = await writeAndroidCameraSqlSourceReceipts({
          artifactRoot: realpathSync(root),
          ...inputs,
        });
        writeFileSync(path.join(root, receipts[0].path), '[{"forged":true}]', {
          mode: 0o600,
        });
        await assert.rejects(
          requireAndroidCameraSqlSourceProjections({
            artifactRoot: realpathSync(root),
            connectionScope: 'native-entry-android',
            expected: inputs.expected,
            isolationScope: 'native-conn-isolation-android',
            isolationExpected: inputs.isolationExpected,
            trainingScope: 'native-training-android',
            sourceReceipts: receipts,
            parentEvidence: inputs.parentEvidence,
          }),
          /child bytes do not equal the protected parent projection|Expected values/,
        );
      },
    ],
  ];
  for (const [label, run] of cases) {
    const root = privateRoot();
    try {
      await run(root, sqlInputs(root));
    } catch (error) {
      throw new Error(`SQL parent control failed: ${label}`, { cause: error });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

void test('Android SQL rejects stable wrong starting apiAttempt', async () => {
  const root = privateRoot();
  try {
    const base = sqlInputs(root);
    const inputs = {
      ...base,
      probeApiLifetime: async (): Promise<OwnedApiLifetimeProbe> => ({
        ...(await base.probeApiLifetime()),
        apiAttempt: 'restart-1',
      }),
    };
    await assert.rejects(
      writeAndroidCameraSqlSourceReceipts({
        artifactRoot: realpathSync(root),
        ...inputs,
      }),
      /API attempt changed/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('Android SQL rejects stable wrong starting apiLedgerSha256', async () => {
  const root = privateRoot();
  try {
    const base = sqlInputs(root);
    const inputs = {
      ...base,
      probeApiLifetime: async (): Promise<OwnedApiLifetimeProbe> => ({
        ...(await base.probeApiLifetime()),
        apiLedgerSha256: 'f'.repeat(64),
      }),
    };
    await assert.rejects(
      writeAndroidCameraSqlSourceReceipts({
        artifactRoot: realpathSync(root),
        ...inputs,
      }),
      /API ledger hash changed/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('manual transport reader binds the descriptor body to one fenced POST 201', async () => {
  const root = privateRoot();
  try {
    const body = Buffer.from('{"code":"unit-code"}\n', 'utf8');
    const bodyPath = 'camera-manual-submit-body.private.bin';
    const descriptorPath = 'camera-manual-submit-receipt.private.json';
    writeFileSync(path.join(root, bodyPath), body, { flag: 'wx', mode: 0o600 });
    writeFileSync(
      path.join(root, descriptorPath),
      JSON.stringify({
        kind: 'owned-native-request-body-receipt-v1',
        producer: 'owned-api-proxy-native-request-body-v1',
        bodyPath,
        bodySha256: HASH(body.toString('utf8')),
        bodySizeBytes: body.byteLength,
        requestId: 2,
        method: 'POST',
        route: '/connections/invite-submissions',
        status: 201,
        requestProfile: 'native',
        requestOrigin: null,
        targetOrigin: API_ORIGIN,
        backendAttemptId: `${RUN_ID}:first`,
        apiPid: API_PID,
        captureRunId: RUN_ID,
        actorAuthUidHash: HASH('student-fixture'),
        sessionRunId: RUN_ID,
        manualCodeSha256: HASH('unit-code'),
        actionSha256: HASH('submit-action'),
      }),
      { flag: 'wx', mode: 0o600 },
    );
    const observation = (
      requestId: number,
      route: string,
      status: number,
      method: 'GET' | 'POST' = requestId === 2 ? 'POST' : 'GET',
    ) => ({
      requestId,
      method,
      pathHash: HASH(route),
      requestOrigin: null,
      requestProfile: 'native' as const,
      targetOrigin: API_ORIGIN,
      status,
      outcome: 'forwarded' as const,
      faultAttemptId: null,
      elapsedMs: 1,
    });
    const artifactRoot = realpathSync(root);
    const identity = {
      runId: RUN_ID,
      attemptId: `${RUN_ID}:first`,
      apiOrigin: API_ORIGIN,
      apiPid: API_PID,
      apiStarted: 'owned-start',
      apiScript: 'server/src/index.ts',
      backendAttemptId: `${RUN_ID}:first`,
    };
    const request = {
      requestId: 2,
      bodyHash: HASH(body.toString('utf8')),
      recorderBodyHash: HASH(body.toString('utf8')),
      manualCodeSha256: HASH('unit-code'),
      actionSha256: HASH('submit-action'),
      sourcePath: bodyPath,
      sourceSha256: HASH(body.toString('utf8')),
      descriptorPath,
      backendAttemptId: `${RUN_ID}:first`,
      apiPid: API_PID,
      apiOrigin: API_ORIGIN,
    };
    const result = await requireAndroidCameraTransport({
      artifactRoot,
      observations: [
        observation(1, '/connections', 200),
        observation(2, '/connections/invite-submissions', 201),
      ],
      beforeRequestId: 0,
      throughRequestId: 2,
      allowedRoutes: ['/connections', '/connections/invite-submissions'],
      targetOrigin: API_ORIGIN,
      identity,
      request,
    });
    assert.equal(result.requestId, 2);
    const descriptorValue = JSON.parse(
      readFileSync(path.join(root, descriptorPath), 'utf8'),
    ) as Record<string, unknown>;
    writeFileSync(
      path.join(root, descriptorPath),
      JSON.stringify({ ...descriptorValue, bodySha256: HASH('tampered-body') }),
      { mode: 0o600 },
    );
    await assert.rejects(
      requireAndroidCameraTransport({
        artifactRoot,
        observations: [
          observation(1, '/connections', 200),
          observation(2, '/connections/invite-submissions', 201),
        ],
        beforeRequestId: 0,
        throughRequestId: 2,
        allowedRoutes: ['/connections', '/connections/invite-submissions'],
        targetOrigin: API_ORIGIN,
        identity,
        request,
      }),
      /descriptor body hash mismatch/,
    );
    writeFileSync(path.join(root, descriptorPath), JSON.stringify(descriptorValue), {
      mode: 0o600,
    });
    await assert.rejects(
      requireAndroidCameraTransport({
        artifactRoot,
        observations: [
          observation(1, '/connections', 200),
          observation(2, '/connections/invite-submissions', 201),
          observation(3, '/connections/invite-submissions', 201, 'POST'),
        ],
        beforeRequestId: 0,
        throughRequestId: 3,
        allowedRoutes: ['/connections', '/connections/invite-submissions'],
        targetOrigin: API_ORIGIN,
        identity,
        request,
      }),
      /exactly one POST 201/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

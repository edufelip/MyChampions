import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nativeSessionAssertionIds } from '../../scripts/testing/native-pilot-contract';
import {
  stageNativeSessionPublicDependency,
  verifyStagedNativeSessionDependency,
} from '../../scripts/testing/native-session-public-staging';
import { sessionAttemptMustRemainBlocked } from '../../scripts/testing/run-ios-session-attempt';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';
import type { NativeSessionPublicDependencyResult } from '../../scripts/testing/native-session-public-dependency';

const captureId = 'a'.repeat(24);
const requestedId = 'b'.repeat(24);
const framePaths = [
  'entry-hierarchy.json',
  'password-save-prompt-hierarchy.json',
  'coach-home-hierarchy.json',
  'restored-home-hierarchy.json',
  'account-hierarchy.json',
  'restored-identity-hierarchy.json',
  'signout-confirm-hierarchy.json',
  'cancel-signout-hierarchy.json',
  'signout-reopen-hierarchy.json',
  'signout-confirmed-hierarchy.json',
  'signed-out-relaunch-hierarchy.json',
];
const profilePaths = ['profile-before.private.json', 'profile-after.private.json'];
const domainPaths = ['domain-before.private.json', 'domain-after.private.json'];
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
  flowHash: createHash('sha256').update(postTapFlowBytes).digest('hex'),
  hierarchyPath: postTapHierarchyPath,
  hierarchyBytes: postTapHierarchyBytes.length,
  hierarchyHash: createHash('sha256').update(postTapHierarchyBytes).digest('hex'),
  screenshotPath: postTapScreenshotPath,
  screenshotBytes: postTapScreenshotBytes.length,
  screenshotHash: createHash('sha256').update(postTapScreenshotBytes).digest('hex'),
  selectorPresence: {
    accountScreen: true,
    signOutCta: true,
    signOutConfirm: true,
    signOutConfirmCta: true,
  },
};
const sourcePaths = [
  ...framePaths,
  'launched.png',
  ...profilePaths,
  ...domainPaths,
  'transport.private.json',
  'transport-terminal.private.json',
  'capture.private.json',
  'external-cleanup.private.json',
  postTapFlowPath,
  postTapHierarchyPath,
  postTapScreenshotPath,
];

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'session-stage-source-')));
  const captureRoot = path.join(root, captureId);
  const outputRoot = path.join(root, requestedId);
  await Promise.all(
    [captureRoot, outputRoot].map(async (value) => {
      await mkdir(value, { mode: 0o700 });
      await chmod(value, 0o700);
    }),
  );
  for (const relative of sourcePaths)
    await writeFile(
      path.join(captureRoot, relative),
      relative === postTapFlowPath
        ? postTapFlowBytes
        : relative === postTapHierarchyPath
          ? postTapHierarchyBytes
          : relative === postTapScreenshotPath
            ? postTapScreenshotBytes
            : relative.endsWith('.png')
              ? Buffer.from('png')
              : '{}\n',
      { mode: 0o600 },
    );
  const repositoryRoot = path.resolve(__dirname, '../..');
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as { scenarios: NativePilotSelection['scenario'][] };
  const scenario = inventory.scenarios.find((row) => row.id === 'SCN-session-ios');
  assert.ok(scenario, 'canonical session scenario is present');
  const evidenceKinds = [
    ['NAT-session-login', ['ui', 'api']],
    ['NAT-session-restore', ['ui', 'api']],
    ['NAT-session-account', ['ui']],
    ['NAT-session-signout', ['ui', 'api']],
    ['NAT-session-signed-out-relaunch', ['ui', 'api']],
    ['NAT-session-unrelated-state', ['sql']],
  ] as const;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object')
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
        .join(',')}}`;
    return JSON.stringify(value);
  };
  const pilotAssertions = evidenceKinds.map(([id, kinds]) => ({
    id,
    requirementRefs: ['SC-217'],
    evidenceKinds: [...kinds],
    requirementPaths: ['docs/screens/v2/SC-217-auth-sign-in.md'],
    startingState: 'authenticated coach session',
    action: `execute ${id}`,
    expected: `${id} evidence is retained`,
    evidencePathTemplates: kinds.map(
      (_, index) => `assertions/{attemptId}/evidence-${index}.private.json`,
    ),
  }));
  const scenarioWithContract = {
    ...scenario,
    pilotAssertions,
    pilotAssertionContract: {
      count: pilotAssertions.length,
      sha256: createHash('sha256').update(canonical(pilotAssertions)).digest('hex'),
      dataMode: 'postgres' as const,
    },
  };
  const selection: NativePilotSelection = {
    arguments: {
      platform: 'ios',
      engine: 'maestro',
      scenario: 'SCN-session-ios',
      mode: 'integration',
    },
    scenario: scenarioWithContract,
    scenarioHash: 'd'.repeat(64),
    requirementHash: 'e'.repeat(64),
  };
  const dependency: NativeSessionPublicDependencyResult = {
    kind: 'private-ios-session-public-dependency-not-public-receipt',
    status: 'validated-source-only',
    charter: 'session',
    assertionIds: [...nativeSessionAssertionIds],
    captureRunId: captureId,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    serverRevocationQualified: false,
    cleanup: 'cleaned',
    files: {
      framePaths,
      startupDiagnosticFramePath: 'launched.png',
      profilePaths,
      domainPaths,
      transportPath: 'transport.private.json',
      terminalTransportPath: 'transport-terminal.private.json',
      postTapDiagnosticPaths: [postTapFlowPath, postTapHierarchyPath, postTapScreenshotPath],
    },
    verification: {
      profileCheckpointStatus: 'verified',
      signInRequestId: 1,
      restorationHydrateRequestId: 2,
      signedOutRequestCount: 0,
      coachAuthUidHash: 'c'.repeat(64),
    },
  };
  return { root, captureRoot, outputRoot, selection, dependency, postTapDiagnostic };
}

void test('session source-only staging copies and re-verifies all selected evidence without a public pass', async () => {
  const input = await fixture();
  try {
    const staged = await stageNativeSessionPublicDependency({
      dependency: input.dependency,
      captureRoot: input.captureRoot,
      outputRoot: input.outputRoot,
      requestedRunId: requestedId,
      selection: input.selection,
    });
    assert.equal(staged.nativePassingCases, 0);
    assert.equal(staged.publicPassingCases, 0);
    assert.equal(staged.publicPromotionEligible, false);
    assert.deepEqual(staged.assertionIds, nativeSessionAssertionIds);
    await verifyStagedNativeSessionDependency({
      outputRoot: input.outputRoot,
      copyManifest: staged.copyManifest,
      requestedRunId: requestedId,
      captureRunId: captureId,
    });
    await assert.rejects(readFile(path.join(input.outputRoot, 'receipt.json')), { code: 'ENOENT' });
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('session staging fails closed after a copied byte is tampered', async () => {
  const input = await fixture();
  try {
    const staged = await stageNativeSessionPublicDependency({
      dependency: input.dependency,
      captureRoot: input.captureRoot,
      outputRoot: input.outputRoot,
      requestedRunId: requestedId,
      selection: input.selection,
    });
    await writeFile(
      path.join(input.outputRoot, `evidence/${captureId}/${framePaths[0]}`),
      'tampered',
      { mode: 0o600 },
    );
    await assert.rejects(
      verifyStagedNativeSessionDependency({
        outputRoot: input.outputRoot,
        copyManifest: staged.copyManifest,
        requestedRunId: requestedId,
        captureRunId: captureId,
      }),
      /hash changed|byte count changed/i,
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('source-only session terminal state remains blocked even after dependency validation', () => {
  const result = {
    verificationResult: 'source-only' as const,
    publicPromotionEligible: false as const,
  };
  assert.equal(sessionAttemptMustRemainBlocked(result), true);
  assert.equal(result.publicPromotionEligible, false);
  assert.equal(result.verificationResult, 'source-only');
});

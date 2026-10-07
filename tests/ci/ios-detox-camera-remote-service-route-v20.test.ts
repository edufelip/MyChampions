import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  requireDetoxCameraBootstrapPendingResponse,
  requireDetoxCameraBootstrapResponse,
} from '../../scripts/testing/native-detox-camera-ios-ipc';
import {
  __private,
  requireDetoxCameraRemoteServiceOwnerConfig,
  runOwnedDetoxCameraRemoteServicePrompt,
} from '../../scripts/testing/native-detox-camera-ios-remote-service-route';

const ownerSource = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../scripts/testing/native-detox-camera-ios-current-owner.ts',
);
const routeSource = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../scripts/testing/native-detox-camera-ios-remote-service-route.ts',
);
const runnerSource = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../scripts/testing/run-ios-detox-camera-attempt.ts',
);
const childSource = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../e2e/detox-ios-camera-route.e2e.test.js',
);
const contractSource = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../scripts/testing/native-detox-camera-ios-contract.ts',
);
const producerSource = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../scripts/testing/native-detox-camera-ios-producer.ts',
);
const stageSource = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../scripts/testing/native-detox-camera-ios-stage.ts',
);
const verifierSource = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../scripts/testing/native-detox-camera-ios-verifier.ts',
);

void test('route config requires the complete qualified helper path set', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ios-camera-route-v20-'));
  try {
    await mkdir(path.join(root, 'artifacts'));
    const environment = {
      MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_SOURCE_ROOT: path.join(root, 'source'),
      MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_PROJECT_PATH: path.join(
        root,
        'source',
        'Helper.xcodeproj',
      ),
      MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_XCTESTRUN_PATH: path.join(root, 'Helper.xctestrun'),
      MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_BINARY_PATH: path.join(root, 'Helper.xctest'),
      MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_COMMAND_CWD: path.join(root, 'source'),
    };
    const config = requireDetoxCameraRemoteServiceOwnerConfig({
      environment,
      artifactRoot: path.join(root, 'artifacts'),
      reviewedSourceRoot: path.join(root, 'source'),
    });
    assert.equal(config.sourceRoot, environment.MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_SOURCE_ROOT);
    assert.equal(
      config.buildReceiptPath,
      path.join(root, 'artifacts', 'ios-remote-service-build.private.json'),
    );
    assert.throws(
      () =>
        requireDetoxCameraRemoteServiceOwnerConfig({
          environment: {
            ...environment,
            MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_BINARY_PATH: undefined,
          },
          artifactRoot: path.join(root, 'artifacts'),
          reviewedSourceRoot: path.join(root, 'source'),
        }),
      /incomplete.*helperBinaryPath/,
    );
    assert.throws(
      () =>
        requireDetoxCameraRemoteServiceOwnerConfig({
          environment,
          artifactRoot: path.join(root, 'artifacts'),
          reviewedSourceRoot: path.join(root, 'different-source'),
        }),
      /reviewed repository root/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('route rejects entry before the existing camera bootstrap without invoking native work', () => {
  assert.throws(
    () => __private.assertRouteEntry({ bootstrapStagePublished: false as true }),
    /before pending bootstrap stage/,
  );
});

void test('route rejects an already expired owner deadline before helper preparation', async () => {
  await assert.rejects(
    () =>
      runOwnedDetoxCameraRemoteServicePrompt({
        sourceRoot: '/private/source',
        reviewedSourceRoot: '/private/source',
        artifactRoot: '/private/artifacts',
        deviceUdid: '01234567-89AB-CDEF-0123-456789ABCDEF',
        bootstrapChild: {
          pid: 1234,
          pgid: 1234,
          startedAt: 'fixture-child-start',
        },
        bootstrapCommandHash: 'a'.repeat(64),
        deadlineAtEpochMs: Date.now() + 30_000,
        deadlineAtMonotonicMs: 0,
        projectPath: '/private/source/RemoteServicePromptHelper.xcodeproj',
        xctestrunPath: '/private/source/RemoteServicePromptHelper.xctestrun',
        helperBinaryPath: '/private/source/RemoteServicePromptHelper.xctest',
        buildReceiptPath: '/private/artifacts/build.private.json',
        receiptPath: '/private/artifacts/helper.private.json',
        commandReceiptPath: '/private/artifacts/command.private.json',
        cancelPath: '/private/artifacts/cancel.private',
        bootstrapStagePublished: true,
        execute: () => Promise.reject(new Error('executor must not be reached')),
      }),
    /deadline exceeded/,
  );
});

void test('source-executed IPC contract rejects authenticated readiness before prompt completion', () => {
  const child = { pid: 1234, pgid: 1234, startedAt: 'fixture-child-start' };
  const pending = {
    schema: 'detox-ios-camera-response-v1',
    commandId: '0000-bootstrap',
    commandHash: 'a'.repeat(64),
    child,
    ok: true,
    readiness: {
      schema: 'detox-ios-camera-bootstrap-pending-v1',
      actor: 'student',
      landingId: 'student.home.screen',
      launch: 'fresh',
      authenticated: true,
      cameraReady: false,
      landingObservation: {
        id: 'student.home.screen',
        source: 'detox-child',
        phase: 'bootstrap-pending',
      },
      passwordSavePrompt: {
        status: 'pending',
        stage: 'owner-remote-service-helper',
        stageToken: 'a'.repeat(64),
      },
    },
  } as const;
  const pendingReceipt = requireDetoxCameraBootstrapPendingResponse(pending);
  assert.equal(pendingReceipt.readiness.authenticated, true);
  assert.equal(pendingReceipt.readiness.cameraReady, false);
  assert.throws(() => requireDetoxCameraBootstrapResponse(pending), /readiness is invalid/);

  const completed = {
    ...pending,
    commandId: '0001-complete-bootstrap',
    readiness: {
      schema: 'detox-ios-camera-bootstrap-ready-v1',
      actor: 'student',
      landingId: 'student.home.screen',
      launch: 'fresh',
      authenticated: true,
      cameraReady: true,
      landingObservation: {
        id: 'student.home.screen',
        source: 'detox-child',
        phase: 'bootstrap-complete',
      },
      passwordSavePrompt: {
        status: 'dismissed',
        source: 'owner-remote-service-helper',
        targetBundleIdentifier: 'com.apple.SafariViewService',
        promptLabel: 'Save Password?',
        dismissLabel: 'Not Now',
        stageToken: 'a'.repeat(64),
        receiptSha256: 'c'.repeat(64),
        commandReceiptSha256: 'b'.repeat(64),
      },
    },
  } as const;
  const finalReceipt = requireDetoxCameraBootstrapResponse(completed);
  assert.equal(finalReceipt.readiness.authenticated, true);
  assert.equal(finalReceipt.readiness.passwordSavePrompt.status, 'dismissed');
  assert.equal(
    finalReceipt.readiness.passwordSavePrompt.targetBundleIdentifier,
    'com.apple.SafariViewService',
  );
  assert.equal(finalReceipt.readiness.passwordSavePrompt.receiptSha256, 'c'.repeat(64));
});

void test('current owner calls the helper after bootstrap and keeps the production owned executor binding', async () => {
  const [owner, route, runner] = await Promise.all([
    readFile(ownerSource, 'utf8'),
    readFile(routeSource, 'utf8'),
    readFile(runnerSource, 'utf8'),
  ]);
  const bootstrap = owner.indexOf('const bootstrapPending =');
  const helper = owner.indexOf('runOwnedDetoxCameraRemoteServicePrompt', bootstrap);
  const installedBeforeHelper = owner.indexOf('const installedAppBeforeHelper', bootstrap);
  const installedAfterHelper = owner.indexOf('const installedAppAfterHelper', helper);
  const completion = owner.indexOf("kind: 'complete-bootstrap'", helper);
  const finalReceipt = owner.lastIndexOf('requireDetoxCameraBootstrapResponse');
  const producer = owner.indexOf('const producer =');
  assert(
    bootstrap >= 0 &&
      installedBeforeHelper > bootstrap &&
      installedBeforeHelper < helper &&
      helper > bootstrap &&
      installedAfterHelper > helper &&
      completion > helper &&
      finalReceipt > completion &&
      producer > finalReceipt,
  );
  assert.match(route, /executeOwnedNativeCommand/);
  assert.match(route, /executeOwnedNativeCommand\(command\)/);
  assert.match(owner, /ipcSourcePath/);
  assert.match(owner, /installedAppBeforeHelper/);
  assert.match(owner, /installedAppAfterHelper/);
  assert.match(runner, /ipcSourcePath/);
  assert.equal((owner.match(/runOwnedDetoxCameraRemoteServicePrompt\(/g) ?? []).length, 1);
});

void test('bootstrap evidence remains in the protected report, stage, and terminal validators', async () => {
  const [contract, producer, stage, verifier] = await Promise.all([
    readFile(contractSource, 'utf8'),
    readFile(producerSource, 'utf8'),
    readFile(stageSource, 'utf8'),
    readFile(verifierSource, 'utf8'),
  ]);
  assert.match(contract, /bootstrapEvidence: DetoxCameraBootstrapEvidence/);
  assert.match(contract, /requireDetoxCameraBootstrapEvidence/);
  assert.match(producer, /bootstrapEvidence/);
  assert.match(stage, /requireDetoxCameraBootstrapEvidence/);
  assert.match(stage, /bootstrapEvidence,/);
  assert.match(verifier, /requireDetoxCameraBootstrapEvidence/);
  assert.match(verifier, /terminal\.bootstrapEvidence/);
  assert.match(verifier, /stage\.bootstrapEvidence/);
});

void test('bootstrap publishes pending password stage, then owner completes it before camera IPC', async () => {
  const [child, owner] = await Promise.all([
    readFile(childSource, 'utf8'),
    readFile(ownerSource, 'utf8'),
  ]);
  const bootstrap = child.indexOf("if (command.kind === 'bootstrap')");
  const completion = child.indexOf("if (command.kind === 'complete-bootstrap')", bootstrap);
  const pending = child.indexOf("schema: 'detox-ios-camera-bootstrap-pending-v1'", bootstrap);
  const final = child.indexOf("schema: 'detox-ios-camera-bootstrap-ready-v1'", completion);
  assert(bootstrap >= 0 && completion > bootstrap && pending > bootstrap && final > completion);
  assert.match(child, /authenticated: true/);
  assert.match(child, /cameraReady: false/);
  assert.match(child, /stage: 'owner-remote-service-helper'/);
  assert.match(child, /stageToken: command\.commandHash/);
  assert.match(child, /targetBundleIdentifier: 'com\.apple\.SafariViewService'/);
  assert.match(child, /promptLabel: 'Save Password\?'/);
  assert.match(child, /cameraReady: true/);
  assert.match(child, /student\.home\.screen/);
  assert.match(child, /promptCommandReceiptSha256/);
  assert.match(child, /promptReceiptSha256/);
  assert.match(child, /final signed-in landing assertion/);
  assert.match(child, /cameraReady: true/);
  assert.doesNotMatch(child, /dismissOptionalPasswordSavePrompt/);
  assert.doesNotMatch(child.slice(bootstrap, completion), /cameraReady: true/);
  const firstRequest = owner.indexOf("ipc.request({ kind: 'bootstrap', actor: 'student' })");
  const helperCall = owner.indexOf('runOwnedDetoxCameraRemoteServicePrompt', firstRequest);
  const completionRequest = owner.indexOf("kind: 'complete-bootstrap'", helperCall);
  const finalReceipt = owner.indexOf('requireDetoxCameraBootstrapResponse', completionRequest);
  assert(firstRequest >= 0 && helperCall > firstRequest && completionRequest > helperCall);
  assert(finalReceipt > completionRequest);
  assert.match(owner, /bootstrapChild: bootstrapPending\.child/);
  assert.match(owner, /bootstrapCommandHash: bootstrapPending\.commandHash/);
  assert.match(owner, /bootstrapStagePublished: true/);
  assert.match(owner, /promptReceiptSha256: remoteServicePrompt\.receiptSha256/);
  assert.match(owner, /promptCommandReceiptSha256: remoteServicePrompt\.commandReceiptSha256/);
  assert.match(owner, /bootstrapStageToken: bootstrapPending\.commandHash/);
  assert.match(owner, /remote-service helper entry/);
  assert.match(owner, /remote-service helper completion/);
  assert.match(owner, /promptCommandReceiptSha256/);
});

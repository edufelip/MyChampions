import { performance } from 'node:perf_hooks';
import {
  requireOwnedIosInstalledAppBinding,
  type IosInstalledAppObservation,
} from './native-camera-observation';
import {
  DETOX_CAMERA_CONTRACT_VERSION,
  DETOX_CAMERA_SELECTION,
  createDetoxCameraAuthObservationReceipt,
  requireDetoxCameraBootstrapEvidence,
  requireDetoxCameraFrames,
  requireDetoxCameraSelection,
  requireDetoxCameraSqlIsolation,
  requireDetoxCameraTransport,
} from './native-detox-camera-ios-contract';
import {
  requireDetoxCameraBootstrapReceipt,
  type DetoxCameraBootstrapReceipt,
  type DetoxCameraCommandInput,
  type DetoxCameraResponse,
} from './native-detox-camera-ios-ipc';
import type {
  DetoxCameraAttemptReport,
  DetoxCameraAuthObservation,
  DetoxCameraBootstrapEvidence,
  DetoxCameraFrame,
  DetoxCameraOwnerIdentity,
  DetoxCameraSqlProjection,
  DetoxCameraSubmission,
  DetoxCameraTransportObservation,
} from './native-detox-camera-ios-contract';

export type DetoxCameraProducerContext = {
  owner: DetoxCameraOwnerIdentity;
  ipc: {
    request: (command: DetoxCameraCommandInput) => Promise<DetoxCameraResponse>;
    seal: () => void;
  };
  /** The owner’s one real launch/sign-in response; producer must not bootstrap again. */
  bootstrapReceipt: DetoxCameraBootstrapReceipt;
  /** Read-only post-bootstrap proof bound to this owner target and qualified build. */
  installedApp: IosInstalledAppObservation;
  /** Pending and final protected IPC/helper proof retained in the report. */
  bootstrapEvidence: DetoxCameraBootstrapEvidence;
  source: DetoxCameraAttemptReport['source'];
  permissionBefore: DetoxCameraAttemptReport['permission']['before'];
  /** Return the fresh, proxy-backed observation for this exact actor transition. */
  verifyAuthActor: (actor: 'student' | 'coach') => Promise<DetoxCameraAuthObservation>;
  readCameraPermission: () => Promise<DetoxCameraAttemptReport['permission']['after']>;
  snapshot: (phase: 'before' | 'after') => Promise<DetoxCameraSqlProjection>;
  isolationSnapshot: (phase: 'before' | 'after') => Promise<DetoxCameraSqlProjection>;
  verifyIsolationUnchanged: (
    before: DetoxCameraSqlProjection,
    after: DetoxCameraSqlProjection,
  ) => boolean;
  readSubmission: (requestId: number) => Promise<DetoxCameraSubmission>;
  armSubmissionCapture: (inviteCodeSha256: string) => Promise<void>;
  transportObservations: () => DetoxCameraTransportObservation[];
  waitForSubmitTransport: () => Promise<DetoxCameraTransportObservation[]>;
  shutdown: () => Promise<void>;
  signal?: AbortSignal;
  /** Original aggregate deadline in the monotonic clock domain. */
  deadlineAtMonotonicMs: number;
  /** Epoch deadline retained for legacy child IPC. */
  deadlineAt: number;
};

function assertLive(context: DetoxCameraProducerContext): void {
  if (context.signal?.aborted) throw new Error('Detox camera producer cancelled');
  if (
    !Number.isFinite(context.deadlineAtMonotonicMs) ||
    performance.now() >= context.deadlineAtMonotonicMs
  )
    throw new Error('Detox camera producer monotonic deadline exceeded');
  if (Date.now() >= context.deadlineAt) throw new Error('Detox camera producer deadline exceeded');
}

function frame(
  response: DetoxCameraResponse,
  semanticState: DetoxCameraFrame['semanticState'],
): DetoxCameraFrame {
  if (!response.frame || response.frame.semanticState !== semanticState) {
    throw new Error(`Detox camera child returned an unexpected ${semanticState} frame`);
  }
  return response.frame;
}

function requireOk(response: DetoxCameraResponse, label: string): DetoxCameraResponse {
  if (!response.ok)
    throw new Error(
      `Detox camera child failed ${label}: ${response.error?.message ?? 'unknown error'}`,
    );
  return response;
}

export async function runDetoxIosCameraProducer(
  context: DetoxCameraProducerContext,
): Promise<DetoxCameraAttemptReport> {
  requireDetoxCameraSelection(DETOX_CAMERA_SELECTION);
  assertLive(context);
  requireOwnedIosInstalledAppBinding(context.installedApp, {
    deviceUdid: context.owner.target.deviceId,
    bundleId: context.owner.build.appIdentifier,
    binaryHash: context.owner.build.binarySha256,
  });
  const bootstrapEvidence = requireDetoxCameraBootstrapEvidence(
    context.bootstrapEvidence,
    context.owner,
  );
  const before = await context.snapshot('before');
  const isolationBefore = await context.isolationSnapshot('before');
  const frames: DetoxCameraFrame[] = [];
  const authObservations: DetoxCameraAuthObservation[] = [];
  requireDetoxCameraBootstrapReceipt(context.bootstrapReceipt);
  authObservations.push(await context.verifyAuthActor('student'));
  frames.push(
    frame(
      await context.ipc.request({
        kind: 'observe',
        label: 'detox-camera-entry',
        actor: 'student',
        semanticState: 'camera-entry',
        viewId: 'student.professionals.screen',
      }),
      'camera-entry',
    ),
  );
  frames.push(
    frame(
      await context.ipc.request({
        kind: 'observe',
        label: 'detox-camera-prompt',
        actor: 'student',
        semanticState: 'camera-prompt',
        viewId: 'student.professionals.qrModal',
      }),
      'camera-prompt',
    ),
  );
  const denied = requireOk(await context.ipc.request({ kind: 'deny-camera' }), 'deny-camera');
  if (denied.permission !== 'denied')
    throw new Error('Detox camera denial did not report denied permission');
  const permissionAfter = await context.readCameraPermission();
  if (permissionAfter !== 'denied')
    throw new Error('Detox camera permission readback did not prove denied');
  frames.push(
    frame(
      await context.ipc.request({
        kind: 'observe',
        label: 'detox-camera-guidance',
        actor: 'student',
        semanticState: 'camera-guidance',
        viewId: 'student.professionals.screen',
      }),
      'camera-guidance',
    ),
  );
  requireOk(
    await context.ipc.request({ kind: 'switch-account', actor: 'coach' }),
    'switch-account coach',
  );
  authObservations.push(await context.verifyAuthActor('coach'));
  frames.push(
    frame(
      await context.ipc.request({
        kind: 'observe',
        label: 'detox-camera-coach-invite',
        actor: 'coach',
        semanticState: 'coach-invite',
        viewId: 'coach.home.screen',
      }),
      'coach-invite',
    ),
  );
  const coachInvite = frames[frames.length - 1];
  if (!coachInvite.inviteCodeSha256)
    throw new Error('Detox camera coach frame did not bind an invite-code hash');
  await context.armSubmissionCapture(coachInvite.inviteCodeSha256);
  requireOk(
    await context.ipc.request({ kind: 'switch-account', actor: 'student' }),
    'switch-account student',
  );
  authObservations.push(await context.verifyAuthActor('student'));
  frames.push(
    frame(
      await context.ipc.request({
        kind: 'observe',
        label: 'detox-camera-student-entry',
        actor: 'student',
        semanticState: 'student-entry',
        viewId: 'student.professionals.codeInput',
      }),
      'student-entry',
    ),
  );
  requireOk(await context.ipc.request({ kind: 'submit-manual' }), 'submit-manual');
  frames.push(
    frame(
      await context.ipc.request({
        kind: 'observe',
        label: 'detox-camera-pending',
        actor: 'student',
        semanticState: 'pending',
        viewId: 'student.professionals.screen',
      }),
      'pending',
    ),
  );
  requireDetoxCameraFrames(frames);
  assertLive(context);
  const after = await context.snapshot('after');
  const isolationAfter = await context.isolationSnapshot('after');
  requireDetoxCameraSqlIsolation(before, after, context.owner);
  requireDetoxCameraSqlIsolation(isolationBefore, isolationAfter, context.owner);
  if (!context.verifyIsolationUnchanged(isolationBefore, isolationAfter))
    throw new Error('Detox camera unrelated SQL scope changed');
  const transport = await context.waitForSubmitTransport();
  const submitRows = transport.filter(
    (row) =>
      row.method === 'POST' &&
      row.status === 201 &&
      row.responsePrincipalUid === context.owner.fixture.studentAuthUid,
  );
  if (submitRows.length !== 1)
    throw new Error('Detox camera manual-submit did not yield exactly one bound POST 201');
  const submitRequestId = submitRows[0].requestId;
  const submission = await context.readSubmission(submitRequestId);
  if (submission.requestId !== submitRequestId || submission.status !== 201) {
    throw new Error('Detox camera submission readback is not bound to the observed request');
  }
  if (
    submission.studentAuthUid !== context.owner.fixture.studentAuthUid ||
    submission.coachAuthUid !== context.owner.fixture.coachAuthUid
  ) {
    throw new Error('Detox camera submission readback is bound to the wrong fixture actors');
  }
  requireDetoxCameraTransport(transport, context.owner, submission);
  if (!submission.unchangedOtherScope)
    throw new Error('Detox camera submission readback did not retain the unrelated-scope proof');
  const authObservationReceipt = createDetoxCameraAuthObservationReceipt(
    context.owner,
    authObservations,
  );
  const report: DetoxCameraAttemptReport = {
    contractVersion: DETOX_CAMERA_CONTRACT_VERSION,
    selection: DETOX_CAMERA_SELECTION,
    owner: context.owner,
    bootstrapEvidence,
    authObservationReceipt,
    source: context.source,
    frames,
    permission: {
      before: context.permissionBefore,
      after: permissionAfter,
      readbackSource: 'owned-detox-tcc-readback',
    },
    transport,
    sql: { before, after, isolationBefore, isolationAfter },
    submission,
    cleanup: {
      captureCleanup: 'not-acquired',
      independentCleanup: 'not-acquired',
      ownedProcessPairs: [],
      foreignResourcesPreserved: false,
      terminal: 'blocked',
      error: null,
    },
    publicPromotionEligible: false,
  };
  await context.shutdown();
  context.ipc.seal();
  return report;
}

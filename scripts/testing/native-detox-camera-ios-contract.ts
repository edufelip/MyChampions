import { createHash } from 'node:crypto';

export const DETOX_CAMERA_CONTRACT_VERSION = 'detox-ios-camera-v1';
export const DETOX_CAMERA_SELECTION = {
  platform: 'ios',
  engine: 'detox',
  scenario: 'SCN-camera-denied-ios',
  mode: 'integration',
} as const;

export type DetoxCameraSelection = typeof DETOX_CAMERA_SELECTION;

export const DETOX_CAMERA_ASSERTIONS = [
  'NAT-camera-normal-entry',
  'NAT-camera-denial-guidance',
  'NAT-camera-manual-submit',
  'NAT-camera-unrelated-state',
] as const;

export type DetoxCameraAssertionId = (typeof DETOX_CAMERA_ASSERTIONS)[number];
export type DetoxCameraActor = 'student' | 'coach';

export type DetoxCameraOwnerIdentity = {
  runId: string;
  attemptId: string;
  target: {
    platform: 'ios';
    deviceId: string;
    osVersion?: string;
    processId?: number;
    startedAt: string;
  };
  build: {
    appIdentifier: string;
    binaryPath: string;
    binarySha256: string;
    configuration: string;
    toolchain: Record<string, string>;
  };
  backend: {
    /** Actual run identity read from the owned session/fixture receipt. */
    runId: string;
    apiOrigin: string;
    apiPid: number;
    apiStartedAt: string;
    /** Actual first-attempt identity read from the original API receipt. */
    apiAttemptId: string;
    manifestSha256: string;
  };
  fixture: {
    /** Actual fixture run identity returned by the owned session. */
    runId: string;
    studentAuthUid: string;
    coachAuthUid: string;
    fixtureHash: string;
  };
};

export const DETOX_CAMERA_AUTH_OBSERVATION_PHASES = [
  'bootstrap-student',
  'coach-transition',
  'student-transition',
] as const;

export type DetoxCameraAuthObservationPhase = (typeof DETOX_CAMERA_AUTH_OBSERVATION_PHASES)[number];

export type DetoxCameraAuthObservation = {
  phase: DetoxCameraAuthObservationPhase;
  actor: DetoxCameraActor;
  ordinal: number;
  requestId: number;
  targetOrigin: string;
  apiPid: number;
  status: 201;
  /** Hash only; the raw auth UID never crosses the protected report boundary. */
  authUidSha256: string;
  verification: 'verified';
  verificationReason: 'verified';
  fixtureAuthUidAllowlistHash: string;
};

export type DetoxCameraAuthObservationReceipt = {
  schema: 'detox-ios-camera-auth-observation-receipt-v1';
  source: 'owned-api-proxy.nativeAuthIdentities';
  ownerBinding: {
    runId: string;
    attemptId: string;
    fixtureRunId: string;
    backendRunId: string;
    backendAttemptId: string;
    apiOrigin: string;
    apiPid: number;
    apiStartedAt: string;
    manifestSha256: string;
    fixtureHash: string;
    studentAuthUidSha256: string;
    coachAuthUidSha256: string;
  };
  observations: readonly [
    DetoxCameraAuthObservation & {
      phase: 'bootstrap-student';
      actor: 'student';
    },
    DetoxCameraAuthObservation & {
      phase: 'coach-transition';
      actor: 'coach';
    },
    DetoxCameraAuthObservation & {
      phase: 'student-transition';
      actor: 'student';
    },
  ];
  observationsSha256: string;
  publicPromotionEligible: false;
};

export type DetoxCameraBootstrapChildIdentity = {
  pid: number;
  pgid: number;
  startedAt: string;
};

export type DetoxCameraBootstrapEvidence = {
  schema: 'detox-ios-camera-bootstrap-evidence-v1';
  ownerBinding: {
    deviceUdid: string;
    appBundleIdentifier: string;
    binarySha256: string;
    child: DetoxCameraBootstrapChildIdentity;
  };
  pending: {
    commandId: string;
    commandHash: string;
    child: DetoxCameraBootstrapChildIdentity;
    readiness: {
      schema: 'detox-ios-camera-bootstrap-pending-v1';
      actor: 'student';
      landingId: 'student.home.screen';
      launch: 'fresh';
      authenticated: true;
      cameraReady: false;
      landingObservation: {
        id: 'student.home.screen';
        source: 'detox-child';
        phase: 'bootstrap-pending';
      };
      passwordSavePrompt: {
        status: 'pending';
        stage: 'owner-remote-service-helper';
        stageToken: string;
      };
    };
  };
  final: {
    commandId: string;
    commandHash: string;
    child: DetoxCameraBootstrapChildIdentity;
    readiness: {
      schema: 'detox-ios-camera-bootstrap-ready-v1';
      actor: 'student';
      landingId: 'student.home.screen';
      launch: 'fresh';
      authenticated: true;
      cameraReady: true;
      landingObservation: {
        id: 'student.home.screen';
        source: 'detox-child';
        phase: 'bootstrap-complete';
      };
      passwordSavePrompt: {
        status: 'dismissed' | 'absent';
        source: 'owner-remote-service-helper';
        targetBundleIdentifier: 'com.apple.SafariViewService';
        promptLabel: 'Save Password?';
        dismissLabel: 'Not Now';
        stageToken: string;
        receiptSha256: string;
        commandReceiptSha256: string;
      };
    };
  };
};

export type DetoxCameraSourceRef = {
  path: string;
  sha256: string;
  bytes: number;
  mode: number;
  sourceKind:
    | 'owned-detox-flow'
    | 'owned-detox-hierarchy'
    | 'owned-detox-screenshot'
    | 'owned-detox-command'
    | 'owned-detox-snapshot';
};

export type DetoxCameraFrame = {
  label: string;
  actor: DetoxCameraActor;
  viewId: string;
  hierarchy: DetoxCameraSourceRef;
  screenshot: DetoxCameraSourceRef;
  command: DetoxCameraSourceRef;
  systemPrompt?: {
    visible: boolean;
    action: 'request-camera' | 'deny-camera';
    controlLabel?: string;
  };
  semanticState:
    | 'camera-entry'
    | 'camera-prompt'
    | 'camera-guidance'
    | 'coach-invite'
    | 'student-entry'
    | 'pending';
  /** Hash only; the invite code never crosses the child IPC boundary. */
  inviteCodeSha256?: string;
};

export type DetoxCameraTransportObservation = {
  requestId: number;
  method: string;
  route: string;
  status: number;
  responsePrincipalUid?: string;
  requestCredentialPresent: false;
  afterRequestId: number;
  source: 'owned-detox-api-proxy';
};

export type DetoxCameraSqlProjection = {
  phase: 'before' | 'after';
  scope: string;
  apiOrigin: string;
  runId: string;
  snapshotPath: string;
  snapshotSha256: string;
  snapshotSource: DetoxCameraSourceRef;
  tableRows: Record<string, { rowCount: number; rowsSha256: string }>;
};

export type DetoxCameraCleanup = {
  captureCleanup: 'cleaned' | 'failed' | 'not-acquired';
  independentCleanup: 'cleaned' | 'failed' | 'not-acquired';
  ownedProcessPairs: { pid: number; startedAt: string }[];
  foreignResourcesPreserved: boolean;
  terminal: 'complete' | 'aborted' | 'blocked';
  error: string | null;
};

export type DetoxCameraSubmission = {
  connectionId: string;
  specialty: 'fitness';
  sourceInviteCodeId: string;
  requestId: number;
  status: 201;
  studentAuthUid: string;
  coachAuthUid: string;
  unchangedOtherScope: boolean;
};

export type DetoxCameraAttemptReport = {
  contractVersion: typeof DETOX_CAMERA_CONTRACT_VERSION;
  selection: typeof DETOX_CAMERA_SELECTION;
  owner: DetoxCameraOwnerIdentity;
  /** Protected pending/final bootstrap receipts retained through producer output. */
  bootstrapEvidence: DetoxCameraBootstrapEvidence;
  /** Protected, ordered native auth observations from the owned API proxy. */
  authObservationReceipt: DetoxCameraAuthObservationReceipt;
  source: {
    repositoryRoot: string;
    sourceRevision: string;
    helperInputsHash: string;
    childSourceHash: string;
    declarationHash: string;
    publicBindingsHash: string;
  };
  frames: DetoxCameraFrame[];
  permission: {
    before: 'not-determined' | 'denied' | 'authorized' | 'unknown';
    after: 'denied' | 'authorized' | 'unknown';
    readbackSource: string;
  };
  transport: DetoxCameraTransportObservation[];
  sql: {
    before: DetoxCameraSqlProjection;
    after: DetoxCameraSqlProjection;
    isolationBefore: DetoxCameraSqlProjection;
    isolationAfter: DetoxCameraSqlProjection;
  };
  submission: DetoxCameraSubmission;
  cleanup: DetoxCameraCleanup;
  publicPromotionEligible: false;
};

function requireBootstrapChildIdentity(
  value: unknown,
  label: string,
): DetoxCameraBootstrapChildIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} is missing`);
  const candidate = value as Partial<DetoxCameraBootstrapChildIdentity>;
  const pid = candidate.pid;
  const pgid = candidate.pgid;
  if (
    typeof pid !== 'number' ||
    !Number.isSafeInteger(pid) ||
    pid <= 1 ||
    typeof pgid !== 'number' ||
    !Number.isSafeInteger(pgid) ||
    pgid <= 1 ||
    typeof candidate.startedAt !== 'string' ||
    candidate.startedAt.length === 0
  )
    throw new Error(`${label} is invalid`);
  return {
    pid,
    pgid,
    startedAt: candidate.startedAt,
  };
}

function requireBootstrapHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} is invalid`);
  return value;
}

function requireBootstrapCommandId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200)
    throw new Error(`${label} is invalid`);
  return value;
}

/**
 * Validate the protected bootstrap evidence after the producer has finished.
 * The helper receipt is only useful when it remains bound to the same child,
 * simulator UDID, qualified app bundle and binary that produced the camera
 * report. A report cannot manufacture authenticated or camera-ready state by
 * copying only the final prompt hashes.
 */
export function requireDetoxCameraBootstrapEvidence(
  value: unknown,
  owner: DetoxCameraOwnerIdentity,
): DetoxCameraBootstrapEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Detox camera bootstrap evidence is missing');
  const candidate = value as Partial<DetoxCameraBootstrapEvidence>;
  if (candidate.schema !== 'detox-ios-camera-bootstrap-evidence-v1')
    throw new Error('Detox camera bootstrap evidence schema is invalid');
  const ownerBinding = candidate.ownerBinding;
  if (
    !ownerBinding ||
    typeof ownerBinding.deviceUdid !== 'string' ||
    ownerBinding.deviceUdid !== owner.target.deviceId ||
    typeof ownerBinding.appBundleIdentifier !== 'string' ||
    ownerBinding.appBundleIdentifier !== owner.build.appIdentifier ||
    typeof ownerBinding.binarySha256 !== 'string' ||
    ownerBinding.binarySha256 !== owner.build.binarySha256
  )
    throw new Error('Detox camera bootstrap evidence owner binding is invalid');
  const ownerChild = requireBootstrapChildIdentity(ownerBinding.child, 'bootstrap owner child');
  const pending = candidate.pending;
  const final = candidate.final;
  if (!pending || !final) throw new Error('Detox camera bootstrap evidence phases are missing');
  const pendingChild = requireBootstrapChildIdentity(pending.child, 'bootstrap pending child');
  const finalChild = requireBootstrapChildIdentity(final.child, 'bootstrap final child');
  const sameChild = (
    left: DetoxCameraBootstrapChildIdentity,
    right: DetoxCameraBootstrapChildIdentity,
  ) => left.pid === right.pid && left.pgid === right.pgid && left.startedAt === right.startedAt;
  if (!sameChild(ownerChild, pendingChild) || !sameChild(ownerChild, finalChild))
    throw new Error('Detox camera bootstrap evidence child identity crossed phases');
  const pendingCommandId = requireBootstrapCommandId(
    pending.commandId,
    'bootstrap pending command id',
  );
  const pendingCommandHash = requireBootstrapHash(
    pending.commandHash,
    'bootstrap pending command hash',
  );
  const finalCommandId = requireBootstrapCommandId(final.commandId, 'bootstrap final command id');
  const finalCommandHash = requireBootstrapHash(final.commandHash, 'bootstrap final command hash');
  if (pendingCommandId === finalCommandId || pendingCommandHash === finalCommandHash)
    throw new Error('Detox camera bootstrap evidence did not preserve two distinct IPC commands');
  const pendingReadiness = pending.readiness;
  if (
    !pendingReadiness ||
    pendingReadiness.schema !== 'detox-ios-camera-bootstrap-pending-v1' ||
    pendingReadiness.actor !== 'student' ||
    pendingReadiness.landingId !== 'student.home.screen' ||
    pendingReadiness.launch !== 'fresh' ||
    pendingReadiness.authenticated !== true ||
    pendingReadiness.cameraReady !== false ||
    pendingReadiness.landingObservation?.id !== 'student.home.screen' ||
    pendingReadiness.landingObservation.source !== 'detox-child' ||
    pendingReadiness.landingObservation.phase !== 'bootstrap-pending' ||
    pendingReadiness.passwordSavePrompt?.status !== 'pending' ||
    pendingReadiness.passwordSavePrompt.stage !== 'owner-remote-service-helper'
  )
    throw new Error('Detox camera bootstrap pending evidence is invalid');
  const stageToken = requireBootstrapHash(
    pendingReadiness.passwordSavePrompt.stageToken,
    'bootstrap pending stage token',
  );
  if (stageToken !== pendingCommandHash)
    throw new Error('Detox camera bootstrap pending stage token is not command-bound');
  const finalReadiness = final.readiness;
  if (
    !finalReadiness ||
    finalReadiness.schema !== 'detox-ios-camera-bootstrap-ready-v1' ||
    finalReadiness.actor !== 'student' ||
    finalReadiness.landingId !== 'student.home.screen' ||
    finalReadiness.launch !== 'fresh' ||
    finalReadiness.authenticated !== true ||
    finalReadiness.cameraReady !== true ||
    finalReadiness.landingObservation?.id !== 'student.home.screen' ||
    finalReadiness.landingObservation.source !== 'detox-child' ||
    finalReadiness.landingObservation.phase !== 'bootstrap-complete' ||
    (finalReadiness.passwordSavePrompt?.status !== 'dismissed' &&
      finalReadiness.passwordSavePrompt?.status !== 'absent') ||
    finalReadiness.passwordSavePrompt.source !== 'owner-remote-service-helper' ||
    finalReadiness.passwordSavePrompt.targetBundleIdentifier !== 'com.apple.SafariViewService' ||
    finalReadiness.passwordSavePrompt.promptLabel !== 'Save Password?' ||
    finalReadiness.passwordSavePrompt.dismissLabel !== 'Not Now'
  )
    throw new Error('Detox camera bootstrap final evidence is invalid');
  if (
    requireBootstrapHash(
      finalReadiness.passwordSavePrompt.stageToken,
      'bootstrap final stage token',
    ) !== stageToken
  )
    throw new Error('Detox camera bootstrap final stage token crossed phases');
  requireBootstrapHash(
    finalReadiness.passwordSavePrompt.receiptSha256,
    'bootstrap helper receipt hash',
  );
  requireBootstrapHash(
    finalReadiness.passwordSavePrompt.commandReceiptSha256,
    'bootstrap helper command receipt hash',
  );
  return {
    schema: candidate.schema,
    ownerBinding: {
      deviceUdid: ownerBinding.deviceUdid,
      appBundleIdentifier: ownerBinding.appBundleIdentifier,
      binarySha256: ownerBinding.binarySha256,
      child: ownerChild,
    },
    pending: {
      commandId: pendingCommandId,
      commandHash: pendingCommandHash,
      child: pendingChild,
      readiness: pendingReadiness,
    },
    final: {
      commandId: finalCommandId,
      commandHash: finalCommandHash,
      child: finalChild,
      readiness: finalReadiness,
    },
  };
}

const DETOX_CAMERA_AUTH_PHASE_ACTORS: Readonly<
  Record<DetoxCameraAuthObservationPhase, DetoxCameraActor>
> = Object.freeze({
  'bootstrap-student': 'student',
  'coach-transition': 'coach',
  'student-transition': 'student',
});

function authUidSha256(authUid: string): string {
  return sha256Bytes(Buffer.from(authUid));
}

function authFixtureAllowlistHash(owner: DetoxCameraOwnerIdentity): string {
  return sha256Bytes(
    Buffer.from(JSON.stringify([owner.fixture.studentAuthUid, owner.fixture.coachAuthUid].sort())),
  );
}

function authObservationOwnerBinding(owner: DetoxCameraOwnerIdentity) {
  requireDetoxCameraOwnerIdentity(owner);
  return {
    runId: owner.runId,
    attemptId: owner.attemptId,
    fixtureRunId: owner.fixture.runId,
    backendRunId: owner.backend.runId,
    backendAttemptId: owner.backend.apiAttemptId,
    apiOrigin: owner.backend.apiOrigin,
    apiPid: owner.backend.apiPid,
    apiStartedAt: owner.backend.apiStartedAt,
    manifestSha256: owner.backend.manifestSha256,
    fixtureHash: owner.fixture.fixtureHash,
    studentAuthUidSha256: authUidSha256(owner.fixture.studentAuthUid),
    coachAuthUidSha256: authUidSha256(owner.fixture.coachAuthUid),
  } as const;
}

function normalizeAuthObservation(
  value: unknown,
  phase: DetoxCameraAuthObservationPhase,
  owner: DetoxCameraOwnerIdentity,
  previous: DetoxCameraAuthObservation | undefined,
): DetoxCameraAuthObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Detox camera auth observation is missing for ${phase}`);
  const candidate = value as Partial<DetoxCameraAuthObservation>;
  const actor = DETOX_CAMERA_AUTH_PHASE_ACTORS[phase];
  const ordinal = candidate.ordinal;
  const requestId = candidate.requestId;
  const expectedAuthUidSha256 = authUidSha256(
    actor === 'student' ? owner.fixture.studentAuthUid : owner.fixture.coachAuthUid,
  );
  const expectedFixtureAuthUidAllowlistHash = authFixtureAllowlistHash(owner);
  if (
    candidate.phase !== phase ||
    candidate.actor !== actor ||
    typeof ordinal !== 'number' ||
    !Number.isSafeInteger(ordinal) ||
    ordinal <= 0 ||
    typeof requestId !== 'number' ||
    !Number.isSafeInteger(requestId) ||
    requestId <= 0 ||
    (previous && ordinal <= previous.ordinal) ||
    (previous && requestId <= previous.requestId) ||
    candidate.targetOrigin !== owner.backend.apiOrigin ||
    candidate.apiPid !== owner.backend.apiPid ||
    candidate.status !== 201 ||
    candidate.authUidSha256 !== expectedAuthUidSha256 ||
    candidate.verification !== 'verified' ||
    candidate.verificationReason !== 'verified' ||
    typeof candidate.fixtureAuthUidAllowlistHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(candidate.fixtureAuthUidAllowlistHash) ||
    candidate.fixtureAuthUidAllowlistHash !== expectedFixtureAuthUidAllowlistHash
  )
    throw new Error(`Detox camera auth observation is not bound to ${phase}`);
  return {
    phase,
    actor,
    ordinal,
    requestId,
    targetOrigin: candidate.targetOrigin,
    apiPid: candidate.apiPid,
    status: 201,
    authUidSha256: candidate.authUidSha256,
    verification: 'verified',
    verificationReason: 'verified',
    fixtureAuthUidAllowlistHash: candidate.fixtureAuthUidAllowlistHash,
  };
}

function authObservationPayload(
  ownerBinding: DetoxCameraAuthObservationReceipt['ownerBinding'],
  observations: DetoxCameraAuthObservationReceipt['observations'],
) {
  return {
    schema: 'detox-ios-camera-auth-observation-receipt-v1' as const,
    source: 'owned-api-proxy.nativeAuthIdentities' as const,
    ownerBinding,
    observations,
  };
}

export function createDetoxCameraAuthObservationReceipt(
  owner: DetoxCameraOwnerIdentity,
  observations: readonly DetoxCameraAuthObservation[],
): DetoxCameraAuthObservationReceipt {
  if (observations.length !== DETOX_CAMERA_AUTH_OBSERVATION_PHASES.length)
    throw new Error('Detox camera auth observation sequence must contain three phases');
  const ownerBinding = authObservationOwnerBinding(owner);
  let previous: DetoxCameraAuthObservation | undefined;
  const normalized = DETOX_CAMERA_AUTH_OBSERVATION_PHASES.map((phase, index) => {
    const observation = normalizeAuthObservation(observations[index], phase, owner, previous);
    previous = observation;
    return observation;
  }) as unknown as DetoxCameraAuthObservationReceipt['observations'];
  if (new Set(normalized.map((observation) => observation.fixtureAuthUidAllowlistHash)).size !== 1)
    throw new Error('Detox camera auth observations crossed proxy fixture allowlists');
  const payload = authObservationPayload(ownerBinding, normalized);
  return {
    ...payload,
    observationsSha256: sha256Json(payload),
    publicPromotionEligible: false,
  };
}

export function requireDetoxCameraAuthObservationReceipt(
  value: unknown,
  owner: DetoxCameraOwnerIdentity,
): DetoxCameraAuthObservationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Detox camera auth observation receipt is missing');
  const candidate = value as Partial<DetoxCameraAuthObservationReceipt>;
  if (
    candidate.schema !== 'detox-ios-camera-auth-observation-receipt-v1' ||
    candidate.source !== 'owned-api-proxy.nativeAuthIdentities' ||
    candidate.publicPromotionEligible !== false ||
    !Array.isArray(candidate.observations) ||
    typeof candidate.observationsSha256 !== 'string'
  )
    throw new Error('Detox camera auth observation receipt schema is invalid');
  const expectedOwnerBinding = authObservationOwnerBinding(owner);
  const actualOwnerBinding = candidate.ownerBinding;
  if (
    !actualOwnerBinding ||
    JSON.stringify(actualOwnerBinding) !== JSON.stringify(expectedOwnerBinding)
  )
    throw new Error('Detox camera auth observation owner binding is invalid');
  let previous: DetoxCameraAuthObservation | undefined;
  const normalized = DETOX_CAMERA_AUTH_OBSERVATION_PHASES.map((phase, index) => {
    const observation = normalizeAuthObservation(
      candidate.observations?.[index],
      phase,
      owner,
      previous,
    );
    previous = observation;
    return observation;
  }) as unknown as DetoxCameraAuthObservationReceipt['observations'];
  if (candidate.observations.length !== normalized.length)
    throw new Error('Detox camera auth observation receipt contains extra or missing phases');
  if (new Set(normalized.map((observation) => observation.fixtureAuthUidAllowlistHash)).size !== 1)
    throw new Error('Detox camera auth observations crossed proxy fixture allowlists');
  const payload = authObservationPayload(expectedOwnerBinding, normalized);
  if (candidate.observationsSha256 !== sha256Json(payload))
    throw new Error('Detox camera auth observation receipt hash is invalid');
  return {
    ...payload,
    observationsSha256: candidate.observationsSha256,
    publicPromotionEligible: false,
  };
}

export type DetoxCameraTerminal = {
  kind: 'detox-ios-camera-terminal';
  contractVersion: typeof DETOX_CAMERA_CONTRACT_VERSION;
  runId: string;
  attemptId: string;
  result: 'verified-private' | 'blocked' | 'aborted';
  assertionIds: Readonly<typeof DETOX_CAMERA_ASSERTIONS>;
  reportPath: string;
  reportSha256: string;
  bootstrapEvidence: DetoxCameraBootstrapEvidence;
  authObservationReceipt: DetoxCameraAuthObservationReceipt;
  stagePath: string | null;
  cleanup: DetoxCameraCleanup;
  publicPromotionEligible: false;
};

export function requireDetoxCameraSelection(value: unknown): typeof DETOX_CAMERA_SELECTION {
  if (!value || typeof value !== 'object') {
    throw new Error('Detox camera selection must be an object');
  }
  const candidate = value as Record<string, unknown>;
  for (const key of ['platform', 'engine', 'scenario', 'mode'] as const) {
    if (candidate[key] !== DETOX_CAMERA_SELECTION[key]) {
      throw new Error(`Unsupported Detox camera selection field ${key}`);
    }
  }
  return DETOX_CAMERA_SELECTION;
}

export function requireDetoxCameraFrames(frames: DetoxCameraFrame[]): DetoxCameraFrame[] {
  const required = [
    'camera-entry',
    'camera-prompt',
    'camera-guidance',
    'coach-invite',
    'student-entry',
    'pending',
  ];
  const labels = frames.map((frame) => frame.semanticState);
  for (const semanticState of required) {
    if (labels.filter((label) => label === semanticState).length !== 1) {
      throw new Error(`Detox camera frame set must contain one ${semanticState} frame`);
    }
  }
  if (frames.some((frame) => frame.actor !== 'student' && frame.actor !== 'coach')) {
    throw new Error('Detox camera frames contain an unknown actor');
  }
  const prompt = frames.find((frame) => frame.semanticState === 'camera-prompt');
  if (!prompt?.systemPrompt?.visible || prompt.systemPrompt.action !== 'request-camera') {
    throw new Error('Detox camera prompt frame does not prove a visible iOS camera request');
  }
  for (const studentState of [
    'camera-entry',
    'camera-prompt',
    'camera-guidance',
    'student-entry',
    'pending',
  ] as const) {
    if (frames.find((frame) => frame.semanticState === studentState)?.actor !== 'student')
      throw new Error(`Detox camera ${studentState} frame is bound to the wrong actor`);
  }
  if (frames.find((frame) => frame.semanticState === 'coach-invite')?.actor !== 'coach')
    throw new Error('Detox camera coach invite frame is bound to the wrong actor');
  return frames;
}

export function requireDetoxCameraTransport(
  rows: DetoxCameraTransportObservation[],
  owner: DetoxCameraOwnerIdentity,
  submission: DetoxCameraSubmission,
): DetoxCameraTransportObservation[] {
  const submitRows = rows.filter(
    (row) =>
      row.method === 'POST' &&
      row.status === 201 &&
      row.responsePrincipalUid === owner.fixture.studentAuthUid,
  );
  if (submitRows.length !== 1 || submitRows[0]?.requestId !== submission.requestId) {
    throw new Error('Detox camera transport must contain exactly one bound POST 201 submission');
  }
  if (rows.some((row) => row.requestCredentialPresent !== false)) {
    throw new Error('Detox camera transport contains credential-bearing request metadata');
  }
  for (const row of rows) {
    if (!Number.isSafeInteger(row.requestId) || row.afterRequestId < row.requestId) {
      throw new Error('Detox camera transport request fence is invalid');
    }
  }
  return rows;
}

function requireDetoxCameraOwnerIdentity(owner: DetoxCameraOwnerIdentity): void {
  if (
    owner.runId !== owner.backend.runId ||
    owner.runId !== owner.fixture.runId ||
    owner.backend.apiAttemptId === owner.backend.runId ||
    !/^[a-f0-9]{64}$/.test(owner.backend.manifestSha256)
  ) {
    throw new Error(
      'Detox camera owner run, fixture, attempt and original receipt identities are inconsistent',
    );
  }
}

export function requireDetoxCameraSqlIsolation(
  before: DetoxCameraSqlProjection,
  after: DetoxCameraSqlProjection,
  owner: DetoxCameraOwnerIdentity,
): void {
  requireDetoxCameraOwnerIdentity(owner);
  if (before.apiOrigin !== owner.backend.apiOrigin || after.apiOrigin !== owner.backend.apiOrigin) {
    throw new Error('Detox camera SQL snapshots are bound to the wrong API origin');
  }
  if (before.runId !== owner.runId || after.runId !== owner.runId) {
    throw new Error('Detox camera SQL snapshots are bound to the wrong run');
  }
  if (
    before.scope !== after.scope ||
    Object.keys(before.tableRows).sort().join('|') !== Object.keys(after.tableRows).sort().join('|')
  ) {
    throw new Error('Detox camera SQL snapshots do not project the same scope');
  }
  if (Object.keys(after.tableRows).some((name) => !after.tableRows[name])) {
    throw new Error('Detox camera SQL snapshot has an invalid table projection');
  }
}

export function requireDetoxCameraCleanup(cleanup: DetoxCameraCleanup): void {
  if (cleanup.captureCleanup !== 'cleaned' || cleanup.independentCleanup !== 'cleaned') {
    throw new Error('Detox camera terminal requires clean capture and independent cleanup');
  }
  if (!cleanup.foreignResourcesPreserved || cleanup.error !== null) {
    throw new Error('Detox camera cleanup does not prove foreign-resource preservation');
  }
  if (cleanup.terminal !== 'complete') {
    throw new Error('Detox camera cleanup is not complete');
  }
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Json(value: unknown): string {
  return sha256Bytes(Buffer.from(JSON.stringify(value)));
}

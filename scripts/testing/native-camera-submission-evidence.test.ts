import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';
import { captureIosCameraPreludeBoundary } from './native-camera-observation';
import {
  assertCameraDomainConnectionBindings,
  assertCameraNonConnectionStateUnchanged,
  captureCameraSourceIdentities,
  nativeCameraSubmissionEvidencePaths,
  normalizeCoachInviteHierarchy,
  stageIosCameraSubmissionEvidence,
  validateIosCameraSubmissionPreparation,
  verifyCameraSourceIdentities,
} from './native-camera-submission-evidence';
import { buildNativeConnectionSubmissionActions } from './native-connection-journey-core';
import { IOS_CONNECTION_PLATFORM } from './native-connection-platform-contract';
import { nativeCameraEvidencePaths } from './native-view-evidence';
import type { ConnectionSnapshotRows, OwnedConnectionSnapshot } from './native-connection-snapshot';
import type { ProxyObservation } from './owned-api-proxy';

const runId = 'a'.repeat(24);
const captureRunId = 'b'.repeat(24);
const requestedRunId = 'c'.repeat(24);
const coach = 'auth-coach';
const student = 'auth-student';
const fixtureAuthUids = [
  coach,
  student,
  'auth-new',
  'auth-pending',
  'auth-active',
  'auth-unrelated-coach',
  'auth-unrelated-student',
].sort();
const isolationAuthUidMap = new Map([
  [coach, 'auth-isolation-coach'],
  [student, 'auth-isolation-student'],
  ['auth-new', 'auth-isolation-new'],
  ['auth-pending', 'auth-isolation-pending'],
  ['auth-active', 'auth-isolation-active'],
  ['auth-unrelated-coach', 'auth-isolation-unrelated-coach'],
  ['auth-unrelated-student', 'auth-isolation-unrelated-student'],
]);
const isolationFixtureAuthUids = [...isolationAuthUidMap.values()].sort();
const timestamp = '2026-10-01T00:00:00.000Z';
const targetOrigin = 'http://127.0.0.1:19001';
const basePngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngWithAncillaryChunk(value: Buffer): Buffer {
  const type = Buffer.from('tEXt');
  const data = Buffer.concat([
    Buffer.from('source'),
    Buffer.from([0]),
    Buffer.from('owned-camera-capture'),
  ]);
  const body = Buffer.concat([type, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 8 + data.length);
  const iendOffset = value.lastIndexOf(Buffer.from('IEND')) - 4;
  assert.ok(iendOffset > 8);
  return Buffer.concat([value.subarray(0, iendOffset), chunk, value.subarray(iendOffset)]);
}

function pngWithoutImageData(): Buffer {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const value = Buffer.alloc(body.length + 8);
    value.writeUInt32BE(data.length, 0);
    body.copy(value, 4);
    value.writeUInt32BE(crc32(body), body.length + 4);
    return value;
  };
  return Buffer.concat([signature, chunk('IHDR', ihdrData), chunk('IEND', Buffer.alloc(0))]);
}

const pngBytes = pngWithAncillaryChunk(basePngBytes);

const submissionActions = buildNativeConnectionSubmissionActions(
  IOS_CONNECTION_PLATFORM,
  'AB12CD34',
);
const submissionFlowBytes = Buffer.from(
  `appId: com.edufelip.mychampions.dev\nname: Native inventory camera-live-manual-submit\n---\n${submissionActions}\n- extendedWaitUntil:\n    visible:\n      id: ${JSON.stringify(IOS_CONNECTION_PLATFORM.selectors.studentProfessionalsScreen)}\n    timeout: 90000\n`,
);
const actionSourceSha256 = hashBytes(
  readFileSync(new URL('./native-connection-journey-core.ts', import.meta.url)),
);

function hash(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function hashBytes(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureDocument() {
  const account = (authUid: string, role: string | null, index: number) => ({
    email: `${authUid.replace(/[^a-z0-9-]/g, '-')}-${index}@example.test`,
    password: `password-${authUid}-long`,
    authUid,
    role,
  });
  return {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-ios',
    accounts: {
      new: account('auth-new', null, 0),
      student: account(student, 'student', 1),
      coach: account(coach, 'professional', 2),
      'unrelated-student': account('auth-unrelated-student', 'student', 3),
      'unrelated-coach': account('auth-unrelated-coach', 'professional', 4),
      'pending-student': account('auth-pending', 'student', 5),
      'active-student': account('auth-active', 'student', 6),
    },
    pendingConnectionId: '11111111-1111-4111-8111-111111111111',
    activeConnectionId: '22222222-2222-4222-8222-222222222222',
    savedPlanId: 'training_plan_33333333-3333-4333-8333-333333333333',
    draft: {
      name: 'Fixture draft',
      sessions: [
        {
          id: 'session-1',
          name: 'Session',
          notes: '',
          items: [
            {
              id: 'item-1',
              name: 'Exercise',
              quantity: '1',
              notes: '',
              exerciseId: '44444444-4444-4444-8444-444444444444',
            },
          ],
        },
      ],
    },
  };
}

function isolationFixtureDocument() {
  const primary = fixtureDocument();
  return {
    ...primary,
    scope: 'native-connection-isolation-ios',
    accounts: Object.fromEntries(
      Object.entries(primary.accounts).map(([name, account]) => [
        name,
        {
          ...account,
          email: `isolation-${account.email}`,
          authUid: isolationAuthUidMap.get(account.authUid) ?? `isolation-${account.authUid}`,
        },
      ]),
    ),
  };
}

function remapIsolationAuthUids(value: unknown): unknown {
  if (typeof value === 'string') return isolationAuthUidMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map(remapIsolationAuthUids);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      remapIsolationAuthUids(nested),
    ]),
  );
}

function rows(): ConnectionSnapshotRows {
  return {
    userProfiles: fixtureAuthUids.map((authUid) => ({
      authUid,
      lockedRole: authUid === coach ? ('professional' as const) : ('student' as const),
      acceptedTermsVersion: 'v1',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    professionalSpecialties: [
      {
        id: 'coach-fitness',
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    inviteCodes: [
      {
        id: 'invite-fitness',
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        rotatedAt: null,
      },
    ],
    connections: [...existingConnections],
    connectionInviteGuards: [existingGuard],
    pendingStudents: [...existingPendingStudents],
    pendingStudentSlots: [{ ...pendingSlot, studentAuthUid: null }, existingPendingSlot],
    trackingAccess: [],
    activeSpecialties: [],
  };
}

function snapshot(
  scope = 'native-entry-ios',
  next: Partial<ConnectionSnapshotRows> = {},
): OwnedConnectionSnapshot {
  const isolation = scope === 'native-connection-isolation-ios';
  const baseRows = (isolation ? remapIsolationAuthUids(rows()) : rows()) as ConnectionSnapshotRows;
  const value = {
    ...baseRows,
    ...next,
  } as ConnectionSnapshotRows;
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope,
    readOnly: true,
    fixtureAuthUids: [...(isolation ? isolationFixtureAuthUids : fixtureAuthUids)],
    target: {
      professionalAuthUid: isolation ? isolationAuthUidMap.get(coach)! : coach,
      studentAuthUid: isolation ? isolationAuthUidMap.get(student)! : student,
      specialty: 'fitness_coach',
    },
    rowCounts: Object.fromEntries(
      (Object.entries(value) as [string, readonly unknown[]][]).map(([name, values]) => [
        name,
        values.length,
      ]),
    ) as OwnedConnectionSnapshot['rowCounts'],
    rows: value,
  };
}

const connection = {
  id: 'connection-1',
  professionalAuthUid: coach,
  studentAuthUid: student,
  status: 'pending_confirmation' as const,
  specialty: 'fitness_coach' as const,
  canceledReason: null,
  sourceInviteCodeId: 'invite-fitness',
  createdAt: timestamp,
  updatedAt: timestamp,
  endedAt: null,
};
const existingConnections = [
  {
    id: 'connection-0',
    professionalAuthUid: coach,
    studentAuthUid: 'auth-pending',
    status: 'active' as const,
    specialty: 'fitness_coach' as const,
    canceledReason: null,
    sourceInviteCodeId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: null,
  },
  {
    id: 'connection-2',
    professionalAuthUid: 'auth-unrelated-coach',
    studentAuthUid: 'auth-unrelated-student',
    status: 'active' as const,
    specialty: 'nutritionist' as const,
    canceledReason: null,
    sourceInviteCodeId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: null,
  },
] as const;
const existingGuard = {
  id: 'guard-0',
  connectionId: existingConnections[0].id,
  professionalAuthUid: existingConnections[0].professionalAuthUid,
  studentAuthUid: existingConnections[0].studentAuthUid,
  specialty: existingConnections[0].specialty,
  status: 'pending_confirmation' as const,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const guard = {
  id: 'guard-1',
  connectionId: connection.id,
  professionalAuthUid: coach,
  studentAuthUid: student,
  specialty: 'fitness_coach' as const,
  status: 'pending_confirmation' as const,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const pendingStudent = {
  id: 'pending-1',
  professionalAuthUid: coach,
  studentAuthUid: student,
  slotId: 'slot-1',
  nutritionistConnectionId: null,
  fitnessCoachConnectionId: connection.id,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const existingPendingStudents = [
  {
    id: 'pending-0',
    professionalAuthUid: 'auth-unrelated-coach',
    studentAuthUid: 'auth-unrelated-student',
    slotId: 'unrelated-slot-1',
    nutritionistConnectionId: null,
    fitnessCoachConnectionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'pending-2',
    professionalAuthUid: coach,
    studentAuthUid: 'auth-pending',
    slotId: 'slot-2',
    nutritionistConnectionId: null,
    fitnessCoachConnectionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
] as const;
const pendingSlot = {
  id: 'coach-slot-1',
  professionalAuthUid: coach,
  slotId: 'slot-1',
  studentAuthUid: student,
  updatedAt: timestamp,
};
const existingPendingSlot = {
  id: 'coach-slot-2',
  professionalAuthUid: coach,
  slotId: 'slot-2',
  studentAuthUid: 'auth-pending',
  updatedAt: timestamp,
};
const domainConnectionsBefore = existingConnections.map((row) => ({
  ...row,
  sourceInviteCodeValue: null,
}));
const domainConnectionAfter = {
  ...connection,
  sourceInviteCodeValue: 'AB12CD34',
};
const domainConnectionsAfter = [
  domainConnectionsBefore[0],
  domainConnectionAfter,
  domainConnectionsBefore[1],
];

function pendingSnapshot() {
  return snapshot('native-entry-ios', {
    connections: [...domainConnectionsAfter].map(
      ({ sourceInviteCodeValue: _ignored, ...row }) => row,
    ),
    connectionInviteGuards: [existingGuard, guard],
    pendingStudents: [existingPendingStudents[0], pendingStudent, existingPendingStudents[1]],
    pendingStudentSlots: [pendingSlot, existingPendingSlot],
  });
}

function preparation() {
  const promptBytes = Buffer.from(JSON.stringify(promptHierarchy()));
  const guidanceBytes = Buffer.from(JSON.stringify(guidanceHierarchy()));
  const manualBytes = Buffer.from(JSON.stringify(manualHierarchy()));
  const isolationFixtures = isolationFixtureDocument();
  const isolationFixtureBytes = Buffer.from(JSON.stringify(isolationFixtures));
  const before = domainSnapshot();
  const after = domainSnapshot(domainConnectionsAfter);
  const pendingBytes = Buffer.from(JSON.stringify(pendingHierarchy()));
  const coachBytes = Buffer.from(JSON.stringify(coachHierarchy()));
  const coachFrame = {
    actor: 'coach',
    actorAuthUid: coach,
    authRequestId: 6,
    viewId: 'SCR-pro-home',
    hierarchyPath: 'camera-coach-invite-hierarchy.json',
    screenshotPath: 'camera-coach-invite.png',
    screenNodePath: [0],
    inviteNodePath: [0, 0],
    hierarchyBytes: coachBytes.length,
    hierarchySha256: hashBytes(coachBytes),
    screenshotBytes: pngBytes.length,
    screenshotSha256: hashBytes(pngBytes),
    inviteCodeSha256: hash('AB12CD34'),
    inviteCodeBytes: Buffer.byteLength('AB12CD34'),
    submissionRequestIds: [12],
  };
  return {
    requirementRefs: ['SC-211', 'UC-002.9', 'AC-249', 'BL-018/P4-camera-denied'],
    captureIdentity: {
      requestedRunId,
      captureRunId,
      backendRunId: runId,
    },
    fixtureScope: 'native-entry-ios',
    target: {
      professionalAuthUid: coach,
      studentAuthUid: student,
      specialty: 'fitness_coach',
    },
    coachCodeSource: 'authenticated-coach-home-ui',
    submissionRoute: '/connections/invite-submissions',
    submissionStatus: 201,
    submissionRequestIds: [12],
    snapshotPaths: [...nativeCameraSubmissionEvidencePaths],
    transportPreludeRequestIdFence: 3,
    transportPreludeObservationCount: 3,
    transportPreludeObservationPrefixSha256: hash(
      JSON.stringify(transport().filter((row) => row.requestId <= 3)),
    ),
    transportPreludeMarkerSource: 'owned-api-proxy.requestIdFence+observations',
    transportEndObservationCount: 4,
    transportEndObservationPrefixSha256: hash(
      JSON.stringify(transport().filter((row) => row.requestId <= 4)),
    ),
    transportEndMarkerSource: 'owned-api-proxy.waitForQuiescence+requestIdFence+observations',
    transportStartRequestId: 4,
    transportEndRequestId: 4,
    transportRequestIds: [4],
    denialFrames: [
      {
        label: 'camera-prompt',
        viewId: 'STATE-camera-prompt',
        hierarchyPath: 'camera-prompt-hierarchy.json',
        screenshotPath: 'camera-prompt.png',
        hierarchyBytes: promptBytes.length,
        hierarchySha256: hash(promptBytes),
        screenshotBytes: pngBytes.length,
        screenshotSha256: hashBytes(pngBytes),
      },
      {
        label: 'camera-guidance',
        viewId: 'STATE-camera-guidance',
        hierarchyPath: 'camera-guidance-hierarchy.json',
        screenshotPath: 'camera-guidance.png',
        hierarchyBytes: guidanceBytes.length,
        hierarchySha256: hash(guidanceBytes),
        screenshotBytes: pngBytes.length,
        screenshotSha256: hashBytes(pngBytes),
      },
      {
        label: 'camera-manual',
        viewId: 'SCR-student-professionals',
        hierarchyPath: 'camera-manual-hierarchy.json',
        screenshotPath: 'camera-manual.png',
        hierarchyBytes: manualBytes.length,
        hierarchySha256: hash(manualBytes),
        screenshotBytes: pngBytes.length,
        screenshotSha256: hashBytes(pngBytes),
      },
    ],
    fixtureEvidencePath: 'fixtures.private.json',
    fixtureHash: hash(JSON.stringify(fixtureDocument())),
    isolationFixtureEvidencePath: 'fixtures-native-connection-isolation-ios.private.json',
    isolationFixtureHash: hashBytes(isolationFixtureBytes),
    isolationTarget: {
      professionalAuthUid: isolationAuthUidMap.get(coach)!,
      studentAuthUid: isolationAuthUidMap.get(student)!,
      specialty: 'fitness_coach',
    },
    domainSnapshotReferences: [
      evidenceReference('camera-connection-before.private.json', snapshot()),
      evidenceReference('camera-connection-pending.private.json', pendingSnapshot()),
      evidenceReference(
        'camera-isolation-before.private.json',
        snapshot('native-connection-isolation-ios'),
        'owned-session.snapshot',
        'native-connection-isolation-ios',
      ),
      evidenceReference(
        'camera-isolation-after.private.json',
        snapshot('native-connection-isolation-ios'),
        'owned-session.snapshot',
        'native-connection-isolation-ios',
      ),
    ],
    trainingSnapshotReferences: [
      evidenceReference('camera-training-before.private.json', before),
      evidenceReference('camera-training-after.private.json', after),
    ],
    pendingFrame: {
      viewId: 'STATE-connection-pending',
      hierarchyPath: 'camera-pending-hierarchy.json',
      screenshotPath: 'camera-pending.png',
      hierarchyBytes: pendingBytes.length,
      hierarchySha256: hash(pendingBytes),
      screenshotBytes: pngBytes.length,
      screenshotSha256: hashBytes(pngBytes),
    },
    coachInviteEvidencePath: 'camera-coach-invite-code.private.json',
    coachInviteFrame: coachFrame,
    submissionFlowReference: {
      path: 'camera-live-manual-submit.yaml',
      bytes: submissionFlowBytes.length,
      sha256: hashBytes(submissionFlowBytes),
      source: 'owned-maestro-flow',
      runId,
      scope: 'native-entry-ios',
      sourcePath: 'scripts/testing/native-connection-journey-core.ts',
      sourceSha256: actionSourceSha256,
      actionSha256: hash(submissionActions),
    },
    submissionRequestBinding: {
      requestId: 12,
      method: 'POST',
      pathHash: hash('/connections/invite-submissions'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin,
      status: 201,
      outcome: 'forwarded',
      faultAttemptId: null,
    },
    unrelatedConnectionStateUnchanged: true,
    unrelatedTrainingStateUnchanged: true,
    nativePassingCases: 0,
    scope: 'actual-camera-denial-plus-live-manual-submit-pending-ui-api-sql; no confirmation pass',
  };
}

function cameraPreparation() {
  const metadata = preparation();
  return {
    requirementRefs: metadata.requirementRefs,
    studentAuthUid: student,
    displayName: 'MyChampions',
    promptTitle: '"MyChampions" would like to access the Camera.',
    denialControl: "Don't Allow",
    manualCode: 'QA-MANUAL-ONLY',
    snapshotPaths: [nativeCameraEvidencePaths[0], nativeCameraEvidencePaths[1]],
    permissionPaths: [nativeCameraEvidencePaths[2], nativeCameraEvidencePaths[3]],
    ownedSqlBeforeAfterUnchanged: true,
    scope: 'os-denial-and-manual-entry-views-only; no invite submission pass',
    denialFrames: metadata.denialFrames,
    snapshotReferences: [
      evidenceReference('camera-before.private.json', domainSnapshot()),
      evidenceReference('camera-after.private.json', domainSnapshot()),
    ],
    transportPreludeRequestIdFence: metadata.transportPreludeRequestIdFence,
    transportPreludeObservationCount: metadata.transportPreludeObservationCount,
    transportPreludeObservationPrefixSha256: metadata.transportPreludeObservationPrefixSha256,
    transportPreludeMarkerSource: metadata.transportPreludeMarkerSource,
    transportEndObservationCount: metadata.transportEndObservationCount,
    transportEndObservationPrefixSha256: metadata.transportEndObservationPrefixSha256,
    transportEndMarkerSource: metadata.transportEndMarkerSource,
    transportStartRequestId: metadata.transportStartRequestId,
    transportEndRequestId: metadata.transportEndRequestId,
    transportRequestIds: metadata.transportRequestIds,
  };
}

function pendingCard() {
  return {
    cardIndex: 0,
    cardSelector: 'student.professionals.connectionCard.0',
    pendingMarkerSelector: `student.professionals.connectionPending.${connection.id}`,
    pendingMarkerPath: [0, 0],
    cardPath: [0],
    pendingText: {
      selector: `student.professionals.connectionPending.${connection.id}`,
      attribute: 'accessibilityText',
      sha256: hash('Waiting for professional confirmation to activate this connection.'),
      path: [0, 0],
    },
    hierarchyPath: 'camera-pending-hierarchy.json',
    hierarchySha256: hash(JSON.stringify(pendingHierarchy())),
    provenance: {
      checkpoint: 'pending',
      runId,
      scope: 'native-entry-ios',
      fixtureAuthUids,
      target: {
        professionalAuthUid: coach,
        studentAuthUid: student,
        specialty: 'fitness_coach',
      },
    },
  };
}

function pendingHierarchy() {
  return {
    attributes: { 'resource-id': 'student.professionals.screen' },
    children: [
      {
        attributes: { 'resource-id': 'student.professionals.connectionCard.0' },
        children: [
          {
            attributes: {
              'resource-id': `student.professionals.connectionPending.${connection.id}`,
              accessibilityText:
                'Waiting for professional confirmation to activate this connection.',
            },
          },
        ],
      },
    ],
  };
}

function domainSnapshot(connections: readonly Record<string, unknown>[] = domainConnectionsBefore) {
  return {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [
      {
        id: 'training-plan-1',
        studentAuthUid: student,
        ownerProfessionalUid: null,
        sourceKind: 'self_managed' as const,
        name: 'Fixture training',
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        sessions: [{ id: 'session-1', items: [] }],
      },
    ],
    connections,
  };
}

function evidenceReference(
  path: string,
  value: unknown,
  source = 'owned-session.snapshot',
  scope = 'native-entry-ios',
) {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    path,
    bytes: bytes.length,
    sha256: hashBytes(bytes),
    source,
    runId,
    scope,
  };
}

function frameFlowBytes(label: string): Buffer {
  const commands =
    label === 'camera-coach-invite'
      ? `- scrollUntilVisible:\n    element:\n      id: pro.home.inviteCodeValue\n    direction: DOWN\n    timeout: 30000\n    centerElement: true\n- extendedWaitUntil:\n    visible:\n      id: pro.home.screen\n    timeout: 90000\n`
      : `- assertVisible:\n    id: ${JSON.stringify(label)}\n`;
  return Buffer.from(
    `appId: com.edufelip.mychampions.dev\nname: Native inventory ${label}\n---\n${commands}`,
  );
}

function frameSourceReferences(
  label: string,
  hierarchyPath: string,
  screenshotPath: string,
  root: string,
) {
  const flow = frameFlowBytes(label);
  const hierarchy = Buffer.from(
    JSON.stringify(
      label === 'camera-prompt'
        ? promptHierarchy()
        : label === 'camera-guidance'
          ? guidanceHierarchy()
          : label === 'camera-manual'
            ? manualHierarchy()
            : label === 'camera-coach-invite'
              ? coachHierarchy()
              : pendingHierarchy(),
    ),
  );
  const actor = label === 'camera-coach-invite' ? 'coach' : 'student';
  const authRequestId = label === 'camera-coach-invite' ? 6 : label === 'camera-pending' ? 9 : 3;
  const actorAuthUid = actor === 'coach' ? coach : student;
  const commandExecution = {
    label: `${label}-screenshot`,
    command: 'xcrun',
    argv: ['simctl', 'io', 'ios-owned-device', 'screenshot', path.join(root, screenshotPath)],
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    deadlineMs: 30_000,
    logPath: `${label}.log`,
    ownershipPath: `${label}.ownership.json`,
  };
  return {
    actor,
    actorAuthUid,
    authRequestId,
    ...(label === 'camera-coach-invite' ? { screenNodePath: [0], inviteNodePath: [0, 0] } : {}),
    flowReference: {
      path: `${label}.yaml`,
      bytes: flow.length,
      sha256: hashBytes(flow),
      source: 'owned-maestro-flow',
      runId,
      scope: 'native-entry-ios',
    },
    hierarchyReference: {
      path: hierarchyPath,
      bytes: hierarchy.length,
      sha256: hashBytes(hierarchy),
      source: 'owned-maestro-hierarchy',
      runId,
      scope: 'native-entry-ios',
    },
    screenshotReference: {
      path: screenshotPath,
      bytes: pngBytes.length,
      sha256: hashBytes(pngBytes),
      source: 'owned-xcrun-simctl-screenshot',
      runId,
      scope: 'native-entry-ios',
      deviceUdid: 'ios-owned-device',
      commandLabel: `${label}-screenshot`,
      commandExecution,
    },
    commandExecution,
  };
}

function coachHierarchy() {
  return {
    attributes: { enabled: false, bounds: '[0,0][0,0]' },
    children: [
      {
        attributes: {
          'resource-id': 'pro.home.screen',
          enabled: true,
          bounds: '[0,0][402,791]',
        },
        children: [
          {
            attributes: {
              'resource-id': 'pro.home.inviteCodeValue',
              accessibilityText: 'AB12CD34',
              enabled: true,
              bounds: '[36,541][366,575]',
            },
          },
        ],
      },
    ],
  };
}

function coachHierarchyWithExplicitVisibility() {
  const hierarchy = coachHierarchy() as unknown as {
    children: {
      attributes: Record<string, unknown>;
      children: { attributes: Record<string, unknown> }[];
    }[];
  };
  hierarchy.children[0].attributes.visible = true;
  hierarchy.children[0].children[0].attributes.visible = true;
  return hierarchy;
}

void test('camera invite normalization keeps missing visibility unknown until an owned witness', () => {
  const hierarchy = coachHierarchy();
  assert.throws(() => normalizeCoachInviteHierarchy(hierarchy, false), /owned command witness/);
  const normalized = normalizeCoachInviteHierarchy(hierarchy, true);
  assert.deepEqual(normalized.screenPath, [0]);
  assert.deepEqual(normalized.invitePath, [0, 0]);
  assert.equal(normalized.inviteCode, 'AB12CD34');
  const explicit = coachHierarchyWithExplicitVisibility();
  assert.equal(normalizeCoachInviteHierarchy(explicit, false).inviteCode, 'AB12CD34');
});

function promptHierarchy() {
  return {
    attributes: {},
    children: [
      {
        attributes: {
          accessibilityText: '"MyChampions" would like to access the Camera.',
        },
      },
      { attributes: { accessibilityText: 'Allow' } },
      { attributes: { accessibilityText: "Don't Allow" } },
    ],
  };
}

function guidanceHierarchy() {
  return {
    attributes: {},
    children: [
      {
        attributes: {
          'resource-id': 'student.professionals.submitError',
          accessibilityText:
            'Camera access is required to scan a QR code. Grant permission in your device settings, or type the code manually.',
        },
      },
      { attributes: { 'resource-id': 'student.professionals.codeInput' } },
    ],
  };
}

function manualHierarchy() {
  return {
    attributes: {},
    children: [
      {
        attributes: {
          'resource-id': 'student.professionals.codeInput',
          text: 'QA-MANUAL-ONLY',
          enabled: 'true',
        },
      },
      {
        attributes: {
          'resource-id': 'student.professionals.connectButton',
          enabled: 'true',
        },
      },
    ],
  };
}

function authTransport(requestId: number): ProxyObservation {
  return {
    requestId,
    method: 'POST',
    pathHash: hash('/auth/email/sign-in'),
    requestOrigin: null,
    requestProfile: 'native',
    targetOrigin,
    status: 201,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 5,
  } as ProxyObservation;
}

function analyticsTransport(requestId: number): ProxyObservation {
  return {
    requestId,
    method: 'POST',
    pathHash: hash('/analytics/events'),
    requestOrigin: null,
    requestProfile: 'native',
    targetOrigin,
    status: 202,
    outcome: 'forwarded',
    faultAttemptId: null,
    elapsedMs: 5,
  } as ProxyObservation;
}

async function fixtureRoot() {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-camera-v3-')));
  const root = path.join(parent, captureRunId);
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  const isolation = snapshot('native-connection-isolation-ios');
  const isolationFixtures = isolationFixtureDocument();
  const isolationFixtureBytes = Buffer.from(JSON.stringify(isolationFixtures));
  const transportRows = transport();
  const nativeAuthIdentityRows = [student, coach, student].map((authUid, index) => ({
    requestId: [3, 6, 9][index],
    ordinal: index + 1,
    targetOrigin,
    apiPid: 1234,
    status: 201,
    authUid,
    verification: 'verified',
    verificationReason: 'verified',
    fixtureAuthUidAllowlistHash: hash(JSON.stringify(fixtureAuthUids)),
  }));
  const cameraSubmissionPreparation = preparation();
  const coachInviteActionExecution = {
    label: 'camera-coach-invite',
    command: 'maestro',
    argv: [
      '--no-ansi',
      '--udid',
      'ios-owned-device',
      'test',
      '--debug-output',
      path.join(root, 'camera-coach-invite-debug'),
      '--test-output-dir',
      path.join(root, 'camera-coach-invite-artifacts'),
      path.join(root, 'camera-coach-invite.yaml'),
    ],
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    deadlineMs: 30_000,
    logPath: path.join(root, 'camera-coach-invite.log'),
    ownershipPath: path.join(root, 'camera-coach-invite.owner.json'),
  };
  const transportBytes = Buffer.from(JSON.stringify(transportRows));
  const nativeAuthIdentityBytes = Buffer.from(JSON.stringify(nativeAuthIdentityRows));
  const files: Record<string, unknown> = {
    'capture.private.json': {
      kind: 'private-owned-native-camera-execution-not-public-receipt',
      mode: 'integration',
      platform: 'ios',
      charter: 'camera-denied',
      captureRunId,
      captureRoot: root,
      build: {
        apiOrigin: 'http://127.0.0.1:19000',
        metroOrigin: 'http://127.0.0.1:19002',
      },
      result: 'observed',
      cleanup: 'cleaned',
      nativePassingCases: 0,
      fixtureHash: hash(JSON.stringify(fixtureDocument())),
      fixtureEvidence: {
        path: 'fixtures.private.json',
        bytes: Buffer.byteLength(JSON.stringify(fixtureDocument())),
        sha256: hash(JSON.stringify(fixtureDocument())),
        source: 'owned-session.fixtures',
        runId,
        scope: 'native-entry-ios',
      },
      connectionIsolationFixtureEvidence: {
        path: 'fixtures-native-connection-isolation-ios.private.json',
        bytes: isolationFixtureBytes.length,
        sha256: hashBytes(isolationFixtureBytes),
        source: 'owned-session.fixtures',
        runId,
        scope: 'native-connection-isolation-ios',
      },
      cameraPreparation: cameraPreparation(),
      cameraSubmissionPreparation,
      transportEvidence: {
        path: 'transport-observations.private.json',
        bytes: transportBytes.length,
        sha256: hashBytes(transportBytes),
        source: 'owned-api-proxy.observations',
        runId,
        scope: 'native-entry-ios',
      },
      nativeAuthIdentityEvidence: {
        path: 'native-auth-identities.private.json',
        bytes: nativeAuthIdentityBytes.length,
        sha256: hashBytes(nativeAuthIdentityBytes),
        source: 'owned-api-proxy.nativeAuthIdentities',
        runId,
        scope: 'native-entry-ios',
      },
      device: { udid: 'ios-owned-device' },
      backend: {
        runId,
        backendAttemptId: `${runId}:first`,
        apiOrigin: targetOrigin,
        apiProcess: { pid: 1234, started: 'api-start', script: 'server-api' },
        processes: [
          {
            role: 'api',
            pid: 1234,
            started: 'api-start',
            script: 'server-api',
          },
        ],
      },
      connectionApiIdentity: { apiPid: 1234, targetOrigin },
      cameraInitialAuth: {
        actor: 'student',
        actorAuthUid: student,
        beforeRequestId: 0,
        authRequestId: 3,
        afterRequestId: 3,
      },
      connectionAccountSwitches: [
        {
          actor: 'coach',
          actorAuthUid: coach,
          beforeRequestId: 3,
          authRequestId: 6,
          afterRequestId: 6,
        },
        {
          actor: 'student',
          actorAuthUid: student,
          beforeRequestId: 6,
          authRequestId: 9,
          afterRequestId: 9,
        },
      ],
      observations: [
        {
          label: 'camera-prompt',
          viewId: 'STATE-camera-prompt',
          hierarchyPath: 'camera-prompt-hierarchy.json',
          screenshotPath: 'camera-prompt.png',
          ...frameSourceReferences(
            'camera-prompt',
            'camera-prompt-hierarchy.json',
            'camera-prompt.png',
            root,
          ),
        },
        {
          label: 'camera-guidance',
          viewId: 'STATE-camera-guidance',
          hierarchyPath: 'camera-guidance-hierarchy.json',
          screenshotPath: 'camera-guidance.png',
          ...frameSourceReferences(
            'camera-guidance',
            'camera-guidance-hierarchy.json',
            'camera-guidance.png',
            root,
          ),
        },
        {
          label: 'camera-manual',
          viewId: 'SCR-student-professionals',
          hierarchyPath: 'camera-manual-hierarchy.json',
          screenshotPath: 'camera-manual.png',
          ...frameSourceReferences(
            'camera-manual',
            'camera-manual-hierarchy.json',
            'camera-manual.png',
            root,
          ),
        },
        {
          label: 'camera-coach-invite',
          viewId: 'SCR-pro-home',
          hierarchyPath: 'camera-coach-invite-hierarchy.json',
          screenshotPath: 'camera-coach-invite.png',
          ...frameSourceReferences(
            'camera-coach-invite',
            'camera-coach-invite-hierarchy.json',
            'camera-coach-invite.png',
            root,
          ),
        },
        {
          label: 'camera-pending',
          viewId: 'STATE-connection-pending',
          hierarchyPath: 'camera-pending-hierarchy.json',
          screenshotPath: 'camera-pending.png',
          ...frameSourceReferences(
            'camera-pending',
            'camera-pending-hierarchy.json',
            'camera-pending.png',
            root,
          ),
        },
      ],
      commandExecutions: [
        'camera-prompt',
        'camera-guidance',
        'camera-manual',
        'camera-coach-invite',
        'camera-pending',
      ]
        .map((label) => ({
          ...frameSourceReferences(label, `${label}-hierarchy.json`, `${label}.png`, root)
            .screenshotReference.commandExecution,
        }))
        .concat(coachInviteActionExecution),
    },
    'transport-observations.private.json': transportRows,
    'fixtures.private.json': fixtureDocument(),
    'fixtures-native-connection-isolation-ios.private.json': isolationFixtures,
    'native-auth-identities.private.json': nativeAuthIdentityRows,
    'camera-runtime-metadata.private.json': {
      schemaVersion: 1,
      kind: 'private-ios-camera-runtime-metadata-not-public-receipt',
      requestedRunId,
      captureRunId,
      backendRunId: runId,
      selection: {
        arguments: {
          platform: 'ios',
          engine: 'maestro',
          scenario: 'SCN-camera-denied-ios',
          mode: 'integration',
        },
        scenarioHash: 'a'.repeat(64),
        requirementHash: 'b'.repeat(64),
      },
      assertionIds: [
        'NAT-camera-normal-entry',
        'NAT-camera-denial-guidance',
        'NAT-camera-manual-submit',
        'NAT-camera-unrelated-state',
      ],
      assertionContractSha256: 'c'.repeat(64),
      preparation: cameraSubmissionPreparation,
      publicNativePassingCases: 0,
    },
    'camera-runtime-adapter.private.json': {
      kind: 'private-owned-ios-camera-attempt-not-public-receipt',
      requestedRunId,
      requestedAttemptId: `${requestedRunId}:first`,
      captureRunId,
      backendRunId: runId,
      fixtureRunId: runId,
      captureExitCode: 0,
      childExitCode: 0,
      childSignal: null,
      childClassification: 'completed',
      captureResult: 'observed',
      captureCleanup: 'cleaned',
      callbackInvocations: 1,
      callbackCompleted: true,
      externalCleanupResult: 'passed',
      verificationResult: 'passed',
      verificationFailure: null,
      postCaptureFailure: null,
      assertionIds: [
        'NAT-camera-normal-entry',
        'NAT-camera-denial-guidance',
        'NAT-camera-manual-submit',
        'NAT-camera-unrelated-state',
      ],
      nativePassingCases: 0,
    },
    'external-cleanup.private.json': {
      kind: 'independent ios native inventory cleanup proof',
      result: 'passed',
      runId: captureRunId,
      captureResult: 'observed',
      captureCleanupClean: true,
      pidStartPairs: 1,
      survivors: [],
      unknownProcessQueries: [],
      missingForeignDevices: [],
      ownedDeviceAbsent: true,
      cacheAbsent: true,
      docker: { container: [], network: [], volume: [] },
    },
    [nativeCameraEvidencePaths[0]]: domainSnapshot(),
    [nativeCameraEvidencePaths[1]]: domainSnapshot(),
    [nativeCameraEvidencePaths[2]]: {
      source: 'owned-simulator-tcc-read-only',
      deviceUdid: 'ios-owned-device',
      bundleId: 'com.edufelip.mychampions.dev',
      rows: [],
    },
    [nativeCameraEvidencePaths[3]]: {
      source: 'owned-simulator-tcc-read-only',
      deviceUdid: 'ios-owned-device',
      bundleId: 'com.edufelip.mychampions.dev',
      rows: [
        {
          service: 'kTCCServiceCamera',
          client: 'com.edufelip.mychampions.dev',
          client_type: 0,
          auth_value: 0,
          auth_reason: 1,
        },
      ],
    },
    [nativeCameraSubmissionEvidencePaths[0]]: snapshot(),
    [nativeCameraSubmissionEvidencePaths[1]]: pendingSnapshot(),
    [nativeCameraSubmissionEvidencePaths[2]]: pendingCard(),
    'camera-pending-hierarchy.json': pendingHierarchy(),
    [nativeCameraSubmissionEvidencePaths[3]]: isolation,
    [nativeCameraSubmissionEvidencePaths[4]]: isolation,
    [nativeCameraSubmissionEvidencePaths[5]]: domainSnapshot(),
    [nativeCameraSubmissionEvidencePaths[6]]: domainSnapshot(domainConnectionsAfter),
    'camera-prompt-hierarchy.json': promptHierarchy(),
    'camera-guidance-hierarchy.json': guidanceHierarchy(),
    'camera-manual-hierarchy.json': manualHierarchy(),
    'camera-coach-invite-hierarchy.json': coachHierarchy(),
    'camera-coach-invite-code.private.json': {
      schemaVersion: 1,
      source: 'authenticated-coach-home-ui',
      actor: 'coach',
      actorAuthUid: coach,
      authRequestId: 6,
      inviteCodeSha256: hash('AB12CD34'),
      inviteCodeBytes: Buffer.byteLength('AB12CD34'),
      submissionRequestIds: [12],
      actionExecution: coachInviteActionExecution,
    },
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(path.join(root, name), JSON.stringify(value), {
      mode: 0o600,
    });
  for (const label of [
    'camera-prompt',
    'camera-guidance',
    'camera-manual',
    'camera-coach-invite',
    'camera-pending',
  ])
    await writeFile(path.join(root, `${label}.yaml`), frameFlowBytes(label), {
      mode: 0o600,
    });
  await writeFile(path.join(root, 'camera-live-manual-submit.yaml'), submissionFlowBytes, {
    mode: 0o600,
  });
  await writeFile(path.join(root, 'camera-prompt.png'), pngBytes, {
    mode: 0o644,
  });
  await writeFile(path.join(root, 'camera-guidance.png'), pngBytes, {
    mode: 0o644,
  });
  await writeFile(path.join(root, 'camera-manual.png'), pngBytes, {
    mode: 0o644,
  });
  await writeFile(path.join(root, 'camera-pending.png'), pngBytes, {
    mode: 0o600,
  });
  await writeFile(path.join(root, 'camera-coach-invite.png'), pngBytes, {
    mode: 0o644,
  });
  return { root, parent };
}

function transport(): readonly ProxyObservation[] {
  return [
    analyticsTransport(1),
    analyticsTransport(2),
    authTransport(3),
    {
      requestId: 4,
      method: 'GET',
      pathHash: hash('/connections'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin,
      status: 200,
      outcome: 'forwarded',
      faultAttemptId: null,
      elapsedMs: 5,
    },
    {
      requestId: 6,
      method: 'POST',
      pathHash: hash('/auth/email/sign-in'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin,
      status: 201,
      outcome: 'forwarded',
      faultAttemptId: null,
      elapsedMs: 5,
    },
    {
      requestId: 9,
      method: 'POST',
      pathHash: hash('/auth/email/sign-in'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin,
      status: 201,
      outcome: 'forwarded',
      faultAttemptId: null,
      elapsedMs: 5,
    },
    {
      requestId: 12,
      method: 'POST',
      pathHash: hash('/connections/invite-submissions'),
      requestOrigin: null,
      requestProfile: 'native',
      targetOrigin,
      status: 201,
      outcome: 'forwarded',
      faultAttemptId: null,
      elapsedMs: 5,
    },
  ];
}

void test('camera prelude marker requires the complete owned proxy prefix', () => {
  const rows = transport();
  const marker = captureIosCameraPreludeBoundary(rows.slice(0, 3), 3);
  assert.deepEqual(marker, {
    requestIdFence: 3,
    observationCount: 3,
    observationPrefixSha256: hash(JSON.stringify(rows.slice(0, 3))),
    source: 'owned-api-proxy.requestIdFence+observations',
  });
  assert.throws(
    () => captureIosCameraPreludeBoundary(rows.slice(0, 2), 3),
    /complete owned prefix/,
  );
  const completionOrderRows = [rows[2], rows[0], rows[1]];
  const completionOrderMarker = captureIosCameraPreludeBoundary(completionOrderRows, 3);
  assert.notEqual(completionOrderMarker.observationPrefixSha256, marker.observationPrefixSha256);
  assert.equal(
    completionOrderMarker.observationPrefixSha256,
    hash(JSON.stringify(completionOrderRows)),
  );
});

void test('camera submission validator rejects a self-consistent sparse prelude prefix', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const sparseTransport = transport().filter((row) => row.requestId !== 2);
    const sparseBytes = Buffer.from(JSON.stringify(sparseTransport));
    await writeFile(path.join(root, 'transport-observations.private.json'), sparseBytes, {
      mode: 0o600,
    });
    const capturePath = path.join(root, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      transportEvidence: Record<string, unknown>;
      cameraPreparation: Record<string, unknown>;
      cameraSubmissionPreparation: Record<string, unknown>;
    };
    const sparsePrefix = sparseTransport.filter((row) => row.requestId <= 3);
    const marker = hash(JSON.stringify(sparsePrefix));
    const update = (value: Record<string, unknown>) => ({
      ...value,
      transportPreludeObservationCount: sparsePrefix.length,
      transportPreludeObservationPrefixSha256: marker,
    });
    capture.transportEvidence = {
      ...capture.transportEvidence,
      bytes: sparseBytes.length,
      sha256: hashBytes(sparseBytes),
    };
    capture.cameraPreparation = update(capture.cameraPreparation);
    capture.cameraSubmissionPreparation = update(capture.cameraSubmissionPreparation);
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    assert.throws(
      () =>
        validateIosCameraSubmissionPreparation({
          root,
          backendRunId: runId,
          targetOrigin,
          preparation: {
            ...preparation(),
            transportPreludeObservationCount: sparsePrefix.length,
            transportPreludeObservationPrefixSha256: marker,
          },
          transport: sparseTransport,
          captureKind: 'private-owned-native-camera-execution-not-public-receipt',
          captureMode: 'integration',
        }),
      /complete raw prefix/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('camera submission validator rejects a self-consistent missing-tail prelude prefix', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const sparseTransport = transport().filter((row) => row.requestId !== 3);
    const sparseBytes = Buffer.from(JSON.stringify(sparseTransport));
    await writeFile(path.join(root, 'transport-observations.private.json'), sparseBytes, {
      mode: 0o600,
    });
    const capturePath = path.join(root, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      transportEvidence: Record<string, unknown>;
      cameraPreparation: Record<string, unknown>;
      cameraSubmissionPreparation: Record<string, unknown>;
    };
    const sparsePrefix = sparseTransport.filter((row) => row.requestId <= 3);
    const marker = hash(JSON.stringify(sparsePrefix));
    const update = (value: Record<string, unknown>) => ({
      ...value,
      transportPreludeObservationCount: sparsePrefix.length,
      transportPreludeObservationPrefixSha256: marker,
    });
    capture.transportEvidence = {
      ...capture.transportEvidence,
      bytes: sparseBytes.length,
      sha256: hashBytes(sparseBytes),
    };
    capture.cameraPreparation = update(capture.cameraPreparation);
    capture.cameraSubmissionPreparation = update(capture.cameraSubmissionPreparation);
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    assert.throws(
      () =>
        validateIosCameraSubmissionPreparation({
          root,
          backendRunId: runId,
          targetOrigin,
          preparation: {
            ...preparation(),
            transportPreludeObservationCount: sparsePrefix.length,
            transportPreludeObservationPrefixSha256: marker,
          },
          transport: sparseTransport,
          captureKind: 'private-owned-native-camera-execution-not-public-receipt',
          captureMode: 'integration',
        }),
      /complete raw prefix/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

// The completed-report integration control reuses the same owned fixture
// constructors as the focused validator controls. They remain private test
// helpers; exporting them avoids a second fixture implementation drifting from
// the source-bound evidence contract.
export {
  coach,
  domainSnapshot,
  fixtureDocument,
  fixtureRoot,
  isolationFixtureDocument,
  pendingSnapshot,
  preparation,
  snapshot,
  transport,
};

async function expectInvalidCameraEvidence(mutate: (root: string) => Promise<void>): Promise<void> {
  const { root, parent } = await fixtureRoot();
  try {
    await mutate(root);
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: preparation(),
        transport: transport(),
        captureKind: 'private-owned-native-camera-execution-not-public-receipt',
        captureMode: 'integration',
      }),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

void test('camera integrated validator accepts one bounded pending submission and stages no pass', async () => {
  const { root, parent } = await fixtureRoot();
  const outputParent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-camera-v3-stage-')));
  const output = path.join(outputParent, requestedRunId);
  await mkdir(output, { mode: 0o700 });
  await chmod(output, 0o700);
  try {
    const metadata = preparation();
    validateIosCameraSubmissionPreparation({
      root,
      backendRunId: runId,
      targetOrigin,
      preparation: metadata,
      transport: transport(),
      captureKind: 'private-owned-native-camera-execution-not-public-receipt',
      captureMode: 'integration',
    });
    const staged = await stageIosCameraSubmissionEvidence({
      captureRoot: root,
      outputRoot: output,
      captureRunId,
      requestedRunId,
      fixtureRunId: runId,
      targetOrigin,
      preparation: metadata,
      transport: transport(),
    });
    assert.equal(staged.nativePassingCases, 0);
    assert.match(staged.manifestPath, /copy-manifest\.private\.json$/);
    const stagedManifest = JSON.parse(
      await readFile(path.join(output, staged.manifestPath), 'utf8'),
    ) as { files?: { path: string }[] };
    const stagedPaths = new Set(stagedManifest.files?.map((file) => file.path));
    for (const required of [
      'camera-before.private.json',
      'camera-permission-after.private.json',
      'camera-prompt.png',
      'camera-guidance-hierarchy.json',
      'native-auth-identities.private.json',
      'camera-pending.png',
      'fixtures.private.json',
      'camera-coach-invite.png',
      'camera-coach-invite-code.private.json',
      'camera-training-before.private.json',
      'camera-training-after.private.json',
      'camera-runtime-metadata.private.json',
      'camera-runtime-adapter.private.json',
      'external-cleanup.private.json',
    ])
      assert.equal(stagedPaths.has(required), true, `missing staged camera evidence: ${required}`);
  } finally {
    await Promise.all([
      rm(parent, { recursive: true, force: true }),
      rm(outputParent, { recursive: true, force: true }),
    ]);
  }
});

void test('camera permission controls accept only exact apostrophe variants and require both buttons', async () => {
  const cases = [
    { allow: true, deny: "Don't Allow", accepted: true },
    { allow: true, deny: 'Don’t Allow', accepted: true },
    { allow: false, deny: 'Don’t Allow', accepted: false },
    { allow: true, deny: null, accepted: false },
    { allow: true, deny: 'Do not Allow', accepted: false },
  ];
  for (const scenario of cases) {
    const { root, parent } = await fixtureRoot();
    try {
      const tree = promptHierarchy();
      tree.children = tree.children.filter(
        (node) =>
          node.attributes.accessibilityText !== 'Allow' &&
          node.attributes.accessibilityText !== "Don't Allow",
      );
      if (scenario.allow) tree.children.push({ attributes: { accessibilityText: 'Allow' } });
      if (scenario.deny) tree.children.push({ attributes: { accessibilityText: scenario.deny } });
      const bytes = Buffer.from(JSON.stringify(tree));
      await writeFile(path.join(root, 'camera-prompt-hierarchy.json'), bytes, { mode: 0o600 });
      const capturePath = path.join(root, 'capture.private.json');
      const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
        cameraPreparation: ReturnType<typeof cameraPreparation>;
        cameraSubmissionPreparation: ReturnType<typeof preparation>;
        observations: { label: string; hierarchyReference: { bytes: number; sha256: string } }[];
      };
      const metadata = preparation();
      if (scenario.deny) capture.cameraPreparation.denialControl = scenario.deny;
      for (const frames of [
        metadata.denialFrames,
        capture.cameraPreparation.denialFrames,
        capture.cameraSubmissionPreparation.denialFrames,
      ]) {
        const prompt = frames.find((frame) => frame.label === 'camera-prompt');
        assert(prompt);
        prompt.hierarchyBytes = bytes.length;
        prompt.hierarchySha256 = hashBytes(bytes);
      }
      const observation = capture.observations.find((row) => row.label === 'camera-prompt');
      assert(observation);
      observation.hierarchyReference.bytes = bytes.length;
      observation.hierarchyReference.sha256 = hashBytes(bytes);
      await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
      const validate = () =>
        validateIosCameraSubmissionPreparation({
          root,
          backendRunId: runId,
          targetOrigin,
          preparation: metadata,
          transport: transport(),
          captureKind: 'private-owned-native-camera-execution-not-public-receipt',
          captureMode: 'integration',
        });
      if (scenario.accepted) assert.doesNotThrow(validate);
      else assert.throws(validate, /permission controls|bounded denial preparation/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
});

void test('camera denial marker rejects forged prefixes and post-marker mutations', async () => {
  const forgedFixture = await fixtureRoot();
  try {
    const forgedMarker = hash('forged-prelude-prefix');
    const forgedPreparation = {
      ...preparation(),
      transportPreludeObservationPrefixSha256: forgedMarker,
    };
    const capturePath = path.join(forgedFixture.root, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      cameraPreparation: Record<string, unknown>;
      cameraSubmissionPreparation: Record<string, unknown>;
    };
    capture.cameraPreparation = {
      ...capture.cameraPreparation,
      transportPreludeObservationPrefixSha256: forgedMarker,
    };
    capture.cameraSubmissionPreparation = {
      ...capture.cameraSubmissionPreparation,
      transportPreludeObservationPrefixSha256: forgedMarker,
    };
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    assert.throws(
      () =>
        validateIosCameraSubmissionPreparation({
          root: forgedFixture.root,
          backendRunId: runId,
          targetOrigin,
          preparation: forgedPreparation,
          transport: transport(),
          captureKind: 'private-owned-native-camera-execution-not-public-receipt',
          captureMode: 'integration',
        }),
      /prelude marker is not bound to the complete raw prefix/,
    );
  } finally {
    await rm(forgedFixture.parent, { recursive: true, force: true });
  }

  const mutationFixture = await fixtureRoot();
  try {
    const postMarkerMutation: ProxyObservation = {
      ...analyticsTransport(5),
    };
    const mutatedTransport = [
      ...transport().slice(0, 4),
      postMarkerMutation,
      ...transport().slice(4),
    ];
    const transportBytes = Buffer.from(JSON.stringify(mutatedTransport));
    await writeFile(
      path.join(mutationFixture.root, 'transport-observations.private.json'),
      transportBytes,
      { mode: 0o600 },
    );
    const capturePath = path.join(mutationFixture.root, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      transportEvidence: Record<string, unknown>;
      cameraPreparation: Record<string, unknown>;
    };
    capture.transportEvidence = {
      ...capture.transportEvidence,
      bytes: transportBytes.length,
      sha256: hashBytes(transportBytes),
    };
    capture.cameraPreparation = {
      ...capture.cameraPreparation,
      transportStartRequestId: 4,
      transportEndRequestId: 5,
      transportEndObservationCount: 5,
      transportEndObservationPrefixSha256: hash(
        JSON.stringify(mutatedTransport.filter((row) => row.requestId <= 5)),
      ),
      transportRequestIds: [4, 5],
    };
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    assert.throws(
      () =>
        validateIosCameraSubmissionPreparation({
          root: mutationFixture.root,
          backendRunId: runId,
          targetOrigin,
          preparation: preparation(),
          transport: mutatedTransport,
          captureKind: 'private-owned-native-camera-execution-not-public-receipt',
          captureMode: 'integration',
        }),
      /transport window contains an undeclared mutation/,
    );
  } finally {
    await rm(mutationFixture.parent, { recursive: true, force: true });
  }

  const authFenceFixture = await fixtureRoot();
  try {
    const prefixRows = transport().filter((row) => row.requestId <= 2);
    const capturePath = path.join(authFenceFixture.root, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      cameraPreparation: Record<string, unknown>;
    };
    capture.cameraPreparation = {
      ...capture.cameraPreparation,
      transportPreludeRequestIdFence: 2,
      transportPreludeObservationCount: prefixRows.length,
      transportPreludeObservationPrefixSha256: hash(JSON.stringify(prefixRows)),
      transportStartRequestId: 3,
      transportEndRequestId: 3,
      transportRequestIds: [3],
    };
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    assert.throws(
      () =>
        validateIosCameraSubmissionPreparation({
          root: authFenceFixture.root,
          backendRunId: runId,
          targetOrigin,
          preparation: preparation(),
          transport: transport(),
          captureKind: 'private-owned-native-camera-execution-not-public-receipt',
          captureMode: 'integration',
        }),
      /not bound to the authenticated student/,
    );
  } finally {
    await rm(authFenceFixture.parent, { recursive: true, force: true });
  }
});

void test('camera domain oracle accepts only the expected connection delta', () => {
  const beforeDomain = domainSnapshot();
  const afterDomain = domainSnapshot(domainConnectionsAfter);
  const beforeConnection = snapshot();
  const afterConnection = pendingSnapshot();
  const target = {
    professionalAuthUid: coach,
    studentAuthUid: student,
    specialty: 'fitness_coach' as const,
  };
  assert.doesNotThrow(() =>
    assertCameraDomainConnectionBindings({
      beforeDomain,
      afterDomain,
      beforeConnection,
      afterConnection,
      target,
      inviteCode: 'AB12CD34',
    }),
  );
  assert.doesNotThrow(() =>
    assertCameraNonConnectionStateUnchanged(beforeDomain, afterDomain, 'expected connection delta'),
  );
  assert.deepEqual(beforeDomain.connections, domainConnectionsBefore);
  assert.deepEqual(afterDomain.connections, domainConnectionsAfter);

  type DomainRecord = Record<string, unknown> & { connections: unknown };
  const mutate = (change: (value: DomainRecord) => void): DomainRecord => {
    const value = structuredClone(afterDomain) as unknown as DomainRecord;
    change(value);
    return value;
  };
  const rejectDomain = (value: DomainRecord, message: RegExp) => {
    assert.throws(
      () =>
        assertCameraDomainConnectionBindings({
          beforeDomain,
          afterDomain: value,
          beforeConnection,
          afterConnection,
          target,
          inviteCode: 'AB12CD34',
        }),
      message,
    );
  };
  const rejectTraining = (value: DomainRecord) =>
    assert.throws(
      () =>
        assertCameraNonConnectionStateUnchanged(
          beforeDomain,
          value,
          'camera submit changed unrelated training state',
        ),
      /camera submit changed unrelated training state/,
    );

  rejectTraining(
    mutate((value) => {
      const plans = value.trainingPlans as Record<string, unknown>[];
      plans[0].name = 'mutated plan';
    }),
  );
  rejectTraining(
    mutate((value) => {
      const plans = value.trainingPlans as Record<string, unknown>[];
      const sessions = plans[0].sessions as Record<string, unknown>[];
      sessions[0].items = [{ id: 'mutated-item' }];
    }),
  );
  rejectTraining(
    mutate((value) => {
      const plans = value.trainingPlans as Record<string, unknown>[];
      plans[0].ownerProfessionalUid = coach;
    }),
  );
  rejectDomain(
    mutate((value) => {
      const connections = value.connections as Record<string, unknown>[];
      connections.pop();
    }),
    /not bound to the pending SQL snapshot/,
  );
  rejectDomain(
    mutate((value) => {
      const connections = value.connections as Record<string, unknown>[];
      connections[1].status = 'active';
    }),
    /not bound to the pending SQL snapshot/,
  );
  rejectDomain(
    mutate((value) => {
      const connections = value.connections as Record<string, unknown>[];
      connections[1].id = 'foreign-connection';
    }),
    /not bound to the pending SQL snapshot/,
  );
  rejectDomain(
    mutate((value) => {
      const connections = value.connections as Record<string, unknown>[];
      connections[1].sourceInviteCodeValue = 'WRONGCODE';
    }),
    /source invite value is not bound/,
  );
  rejectDomain(
    mutate((value) => {
      const connections = value.connections as Record<string, unknown>[];
      connections[0].sourceInviteCodeValue = 'PREEXISTING-MUTATION';
    }),
    /preexisting connection source invite value/,
  );
});

void test('camera integrated validator rejects route ambiguity, stale provenance and preserved-state changes', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const metadata = preparation();
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: metadata,
        transport: [...transport(), { ...transport()[0] }],
      }),
    );
    const ambiguousTransport = [...transport(), { ...transport()[4], requestId: 99 }];
    const ambiguousTransportBytes = Buffer.from(JSON.stringify(ambiguousTransport));
    await writeFile(
      path.join(root, 'transport-observations.private.json'),
      ambiguousTransportBytes,
      { mode: 0o600 },
    );
    const capturePath = path.join(root, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      transportEvidence: Record<string, unknown>;
    };
    capture.transportEvidence = {
      ...capture.transportEvidence,
      bytes: ambiguousTransportBytes.length,
      sha256: hashBytes(ambiguousTransportBytes),
    };
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    assert.throws(
      () =>
        validateIosCameraSubmissionPreparation({
          root,
          backendRunId: runId,
          targetOrigin,
          preparation: metadata,
          transport: ambiguousTransport,
        }),
      /extra or unbound sign-in|exactly one native invite POST|full stream/,
    );
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: { ...metadata, submissionRoute: '/connections' },
        transport: transport(),
      }),
    );
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: { ...metadata, fixtureScope: 'wrong-scope' },
        transport: transport(),
      }),
    );
    await writeFile(
      path.join(root, nativeCameraSubmissionEvidencePaths[4]),
      JSON.stringify({
        ...snapshot('native-connection-isolation-ios'),
        rows: { ...rows(), inviteCodes: [] },
      }),
      { mode: 0o600 },
    );
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: metadata,
        transport: transport(),
      }),
    );
    await rm(path.join(root, 'native-auth-identities.private.json'));
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: metadata,
        transport: transport(),
      }),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('camera staging rejects origin collision and missing runtime cleanup sidecars', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const capturePath = path.join(root, 'capture.private.json');
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      build: { apiOrigin: string; metroOrigin: string };
    };
    capture.build.apiOrigin = targetOrigin;
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    assert.throws(
      () =>
        validateIosCameraSubmissionPreparation({
          root,
          backendRunId: runId,
          targetOrigin,
          preparation: preparation(),
          transport: transport(),
        }),
      /distinct from app and Metro origins/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }

  const missingSidecar = await fixtureRoot();
  const outputParent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-camera-v3-sidecar-')),
  );
  const output = path.join(outputParent, requestedRunId);
  await mkdir(output, { mode: 0o700 });
  await chmod(output, 0o700);
  try {
    await rm(path.join(missingSidecar.root, 'external-cleanup.private.json'));
    await assert.rejects(
      stageIosCameraSubmissionEvidence({
        captureRoot: missingSidecar.root,
        outputRoot: output,
        captureRunId,
        requestedRunId,
        fixtureRunId: runId,
        targetOrigin,
        preparation: preparation(),
        transport: transport(),
      }),
      /external-cleanup\.private\.json/,
    );
  } finally {
    await Promise.all([
      rm(missingSidecar.parent, { recursive: true, force: true }),
      rm(outputParent, { recursive: true, force: true }),
    ]);
  }
});

void test('camera composite validator rejects foreign denial bytes, hash drift and unlinked auth', async () => {
  await expectInvalidCameraEvidence(async (root) => {
    await writeFile(
      path.join(root, nativeCameraEvidencePaths[2]),
      JSON.stringify({
        source: 'owned-simulator-tcc-read-only',
        deviceUdid: 'foreign-device',
        bundleId: 'com.edufelip.mychampions.dev',
        rows: [],
      }),
      { mode: 0o600 },
    );
  });
  await expectInvalidCameraEvidence(async (root) => {
    await writeFile(path.join(root, 'camera-manual.png'), Buffer.from('tampered-png'), {
      mode: 0o600,
    });
  });
  await expectInvalidCameraEvidence(async (root) => {
    await writeFile(path.join(root, 'camera-pending-hierarchy.json'), JSON.stringify({}), {
      mode: 0o600,
    });
  });
  await expectInvalidCameraEvidence(async (root) => {
    await rm(path.join(root, 'camera-prompt.png'));
  });
  await expectInvalidCameraEvidence(async (root) => {
    await rm(path.join(root, 'camera-prompt.yaml'));
  });
  await expectInvalidCameraEvidence(async (root) => {
    const identities = [student, coach, student].map((authUid, index) => ({
      requestId: index + 1,
      ordinal: index + 1,
      targetOrigin,
      apiPid: 1234,
      status: 201,
      authUid,
      verification: 'verified',
      verificationReason: 'verified',
      fixtureAuthUidAllowlistHash: hash(JSON.stringify(fixtureAuthUids)),
    }));
    identities[0].authUid = coach;
    await writeFile(
      path.join(root, 'native-auth-identities.private.json'),
      JSON.stringify(identities),
      { mode: 0o600 },
    );
  });
  await expectInvalidCameraEvidence(async (root) => {
    const capture = JSON.parse(await readFile(path.join(root, 'capture.private.json'), 'utf8')) as {
      cameraPreparation: { studentAuthUid: string };
    };
    capture.cameraPreparation.studentAuthUid = 'auth-unrelated-student';
    await writeFile(path.join(root, 'capture.private.json'), JSON.stringify(capture), {
      mode: 0o600,
    });
  });
  await expectInvalidCameraEvidence(async (root) => {
    const digest = JSON.parse(
      await readFile(path.join(root, 'camera-coach-invite-code.private.json'), 'utf8'),
    ) as { inviteCodeSha256: string };
    digest.inviteCodeSha256 = hash('00000000');
    await writeFile(
      path.join(root, 'camera-coach-invite-code.private.json'),
      JSON.stringify(digest),
      { mode: 0o600 },
    );
  });
  await expectInvalidCameraEvidence(async (root) => {
    const capture = JSON.parse(await readFile(path.join(root, 'capture.private.json'), 'utf8')) as {
      fixtureHash: string;
      fixtureEvidence: { sha256: string };
    };
    capture.fixtureHash = hash('wrong-fixture');
    capture.fixtureEvidence.sha256 = capture.fixtureHash;
    await writeFile(path.join(root, 'capture.private.json'), JSON.stringify(capture), {
      mode: 0o600,
    });
  });
  await expectInvalidCameraEvidence(async (root) => {
    const capture = JSON.parse(await readFile(path.join(root, 'capture.private.json'), 'utf8')) as {
      commandExecutions: { argv: string[] }[];
    };
    capture.commandExecutions[0].argv[4] = path.join(root, 'forged-camera.png');
    await writeFile(path.join(root, 'capture.private.json'), JSON.stringify(capture), {
      mode: 0o600,
    });
  });
  await expectInvalidCameraEvidence(async (root) => {
    const capture = JSON.parse(await readFile(path.join(root, 'capture.private.json'), 'utf8')) as {
      observations: { actor: string; actorAuthUid: string }[];
    };
    capture.observations[0].actor = 'coach';
    capture.observations[0].actorAuthUid = coach;
    await writeFile(path.join(root, 'capture.private.json'), JSON.stringify(capture), {
      mode: 0o600,
    });
  });
});

void test('camera validator rejects a self-hashed PNG structure without image data', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const fake = pngWithoutImageData();
    const capture = JSON.parse(await readFile(path.join(root, 'capture.private.json'), 'utf8')) as {
      cameraPreparation: { denialFrames: Record<string, unknown>[] };
    };
    capture.cameraPreparation.denialFrames[0].screenshotBytes = fake.length;
    capture.cameraPreparation.denialFrames[0].screenshotSha256 = hashBytes(fake);
    await writeFile(path.join(root, 'camera-prompt.png'), fake, {
      mode: 0o600,
    });
    await writeFile(path.join(root, 'capture.private.json'), JSON.stringify(capture), {
      mode: 0o600,
    });
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: preparation(),
        transport: transport(),
      }),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('camera validator rejects a coach invite hierarchy without an enabled visible coach root', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const metadata = preparation() as Record<string, unknown>;
    const capture = JSON.parse(await readFile(path.join(root, 'capture.private.json'), 'utf8')) as {
      cameraSubmissionPreparation: Record<string, unknown>;
    };
    const tree = {
      attributes: { 'resource-id': 'student.professionals.screen' },
      children: [
        {
          attributes: {
            'resource-id': 'pro.home.inviteCodeValue',
            accessibilityText: 'AB12CD34',
            enabled: false,
            visible: true,
          },
        },
      ],
    };
    const bytes = Buffer.from(JSON.stringify(tree));
    const frame = metadata.coachInviteFrame as Record<string, unknown>;
    frame.hierarchyBytes = bytes.length;
    frame.hierarchySha256 = hashBytes(bytes);
    capture.cameraSubmissionPreparation.coachInviteFrame = frame;
    await writeFile(path.join(root, 'camera-coach-invite-hierarchy.json'), bytes, {
      mode: 0o600,
    });
    await writeFile(
      path.join(root, 'capture.private.json'),
      JSON.stringify({
        ...capture,
        cameraSubmissionPreparation: metadata,
      }),
      { mode: 0o600 },
    );
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: metadata,
        transport: transport(),
      }),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('camera staging rejects an existing destination component', async () => {
  const { root, parent } = await fixtureRoot();
  const outputParent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-camera-v5-stage-')));
  const output = path.join(outputParent, requestedRunId);
  await mkdir(output, { mode: 0o700 });
  await chmod(output, 0o700);
  await mkdir(path.join(output, 'evidence'), { mode: 0o700 });
  try {
    await assert.rejects(
      stageIosCameraSubmissionEvidence({
        captureRoot: root,
        outputRoot: output,
        captureRunId,
        requestedRunId,
        fixtureRunId: runId,
        targetOrigin,
        preparation: preparation(),
        transport: transport(),
      }),
    );
  } finally {
    await Promise.all([
      rm(parent, { recursive: true, force: true }),
      rm(outputParent, { recursive: true, force: true }),
    ]);
  }
});

void test('camera validator rejects overlapping primary and isolation fixture identities', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const isolationPath = path.join(root, 'fixtures-native-connection-isolation-ios.private.json');
    const isolation = JSON.parse(await readFile(isolationPath, 'utf8')) as {
      accounts: { coach: { authUid: string } };
    };
    isolation.accounts.coach.authUid = coach;
    await writeFile(isolationPath, JSON.stringify(isolation), { mode: 0o600 });
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: preparation(),
        transport: transport(),
      }),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('camera validator rejects missing independent isolation fixture proof', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    await rm(path.join(root, 'fixtures-native-connection-isolation-ios.private.json'));
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: preparation(),
        transport: transport(),
      }),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('camera validator rejects a missing submission preparation proof', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const capture = JSON.parse(await readFile(path.join(root, 'capture.private.json'), 'utf8')) as {
      cameraSubmissionPreparation?: unknown;
    };
    delete capture.cameraSubmissionPreparation;
    await writeFile(path.join(root, 'capture.private.json'), JSON.stringify(capture), {
      mode: 0o600,
    });
    assert.throws(() =>
      validateIosCameraSubmissionPreparation({
        root,
        backendRunId: runId,
        targetOrigin,
        preparation: preparation(),
        transport: transport(),
      }),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('camera source identity guard rejects byte replacement before staging', async () => {
  const { root, parent } = await fixtureRoot();
  try {
    const expected = await captureCameraSourceIdentities(root);
    await writeFile(path.join(root, 'camera-manual.png'), Buffer.from('replacement'), {
      mode: 0o600,
    });
    await assert.rejects(verifyCameraSourceIdentities(root, expected));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('camera staging rejects a symlinked destination component', async () => {
  const { root, parent } = await fixtureRoot();
  const outputParent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'mc-camera-v5-symlink-')),
  );
  const output = path.join(outputParent, requestedRunId);
  await mkdir(output, { mode: 0o700 });
  await chmod(output, 0o700);
  const foreign = path.join(outputParent, 'foreign');
  await mkdir(foreign, { mode: 0o700 });
  await chmod(foreign, 0o700);
  await symlink(foreign, path.join(output, 'evidence'));
  try {
    await assert.rejects(
      stageIosCameraSubmissionEvidence({
        captureRoot: root,
        outputRoot: output,
        captureRunId,
        requestedRunId,
        fixtureRunId: runId,
        targetOrigin,
        preparation: preparation(),
        transport: transport(),
      }),
    );
  } finally {
    await Promise.all([
      rm(parent, { recursive: true, force: true }),
      rm(outputParent, { recursive: true, force: true }),
    ]);
  }
});

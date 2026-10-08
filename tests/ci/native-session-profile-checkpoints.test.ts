import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  verifyNativeSessionProfileCheckpoints,
  requireSignedOutSessionTransport,
  requireFinalSessionTransport,
  publishNativeSessionLedger,
  type NativeSessionProfileCheckpointInput,
} from '../../scripts/testing/native-session-profile-checkpoints';
import type {
  ConnectionSnapshotRows,
  OwnedConnectionSnapshot,
} from '../../scripts/testing/native-connection-snapshot';
import type { ProxyObservation } from '../../scripts/testing/owned-api-proxy';

const coach = 'fixture-coach';
const student = 'fixture-student';
const unrelated = 'fixture-unrelated';
const fixtureAuthUids = [coach, student, unrelated].sort();
const runId = 'a'.repeat(24);
const api = { apiPid: 1234, targetOrigin: 'http://127.0.0.1:19001' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const beforeAt = '2026-10-01T00:00:00.000Z';
const loginAt = '2026-10-01T00:00:01.000Z';
const restoreAt = '2026-10-01T00:00:02.000Z';

function profileSnapshot(platform: 'ios' | 'android', coachTime: string): OwnedConnectionSnapshot {
  const rows: ConnectionSnapshotRows = {
    userProfiles: fixtureAuthUids.map((authUid) => ({
      authUid,
      lockedRole: authUid === coach ? 'professional' : 'student',
      acceptedTermsVersion: 'v1',
      createdAt: beforeAt,
      updatedAt: authUid === coach ? coachTime : beforeAt,
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
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope: `native-entry-${platform}`,
    readOnly: true,
    fixtureAuthUids: [...fixtureAuthUids],
    target: { professionalAuthUid: coach, studentAuthUid: student, specialty: 'fitness_coach' },
    rowCounts: Object.fromEntries(
      Object.entries(rows).map(([name, values]) => [name, values.length]),
    ) as OwnedConnectionSnapshot['rowCounts'],
    rows,
  };
}

function input(platform: 'ios' | 'android' = 'ios'): NativeSessionProfileCheckpointInput {
  const observation = (requestId: number, route: string, status: number): ProxyObservation => ({
    requestId,
    method: 'POST',
    pathHash: hash(route),
    status,
    outcome: 'forwarded',
    requestProfile: 'native',
    requestOrigin: null,
    targetOrigin: api.targetOrigin,
    faultAttemptId: null,
    elapsedMs: 10,
  });
  const domain = {
    schemaVersion: 1 as const,
    runId,
    scope: `native-entry-${platform}`,
    readOnly: true as const,
    trainingPlans: [],
    connections: [],
  };
  return {
    platform,
    backendRunId: runId,
    fixtureAuthUids: [...fixtureAuthUids],
    coachAuthUid: coach,
    studentAuthUid: student,
    expectedApiIdentity: { ...api },
    profiles: {
      beforeLogin: profileSnapshot(platform, beforeAt),
      afterLogin: profileSnapshot(platform, loginAt),
      afterRestoration: profileSnapshot(platform, restoreAt),
      afterSignedOutRelaunch: profileSnapshot(platform, restoreAt),
    },
    domain: {
      beforeLogin: structuredClone(domain),
      afterLogin: structuredClone(domain),
      afterRestoration: structuredClone(domain),
      afterSignedOutRelaunch: structuredClone(domain),
    },
    observations: [observation(1, '/auth/email/sign-in', 201), observation(2, '/me/hydrate', 200)],
    authIdentities: [
      {
        requestId: 1,
        ordinal: 1,
        targetOrigin: api.targetOrigin,
        apiPid: api.apiPid,
        status: 201,
        authUid: coach,
        verification: 'verified',
        verificationReason: 'verified',
        fixtureAuthUidAllowlistHash: hash(JSON.stringify(fixtureAuthUids)),
      },
    ],
    loginWindow: { afterRequestId: 0, throughRequestId: 1 },
    restorationWindow: { afterRequestId: 1, throughRequestId: 2 },
    persistedCoachIdentity: {
      afterLoginAuthUidHash: hash(coach),
      afterRestorationAuthUidHash: hash(coach),
    },
  };
}

for (const platform of ['ios', 'android'] as const) {
  void test(`${platform} permits only the bound coach timestamps at the two auth checkpoints`, () => {
    const result = verifyNativeSessionProfileCheckpoints(input(platform));
    assert.equal(result.status, 'verified');
    assert.equal(result.nativePassingCases, 0);
    assert.deepEqual(result.checkpointIds, [
      'beforeLogin',
      'afterLogin',
      'afterRestoration',
      'afterSignedOutRelaunch',
    ]);
    assert.equal(result.signInRequestId, 1);
    assert.equal(result.restorationHydrateRequestId, 2);
  });
}

void test('an unchanged coach timestamp is permitted', () => {
  const value = input();
  for (const snapshot of Object.values(value.profiles))
    snapshot.rows.userProfiles.find((row) => row.authUid === coach)!.updatedAt = beforeAt;
  assert.equal(verifyNativeSessionProfileCheckpoints(value).status, 'verified');
});

const cases: [string, (value: NativeSessionProfileCheckpointInput) => void][] = [
  [
    'plans/connections-only profile observation',
    (v) => {
      delete (v.profiles as Partial<typeof v.profiles>).afterLogin;
    },
  ],
  [
    'missing fixture profile',
    (v) => {
      v.profiles.afterLogin.rows.userProfiles.pop();
      v.profiles.afterLogin.rowCounts.userProfiles--;
    },
  ],
  [
    'coach createdAt mutation during sign-in',
    (v) => {
      v.profiles.afterLogin.rows.userProfiles.find((r) => r.authUid === coach)!.createdAt = loginAt;
    },
  ],
  [
    'other actor updatedAt mutation during sign-in',
    (v) => {
      v.profiles.afterLogin.rows.userProfiles.find((r) => r.authUid === unrelated)!.updatedAt =
        loginAt;
    },
  ],
  [
    'coach role mutation during restoration',
    (v) => {
      v.profiles.afterRestoration.rows.userProfiles.find((r) => r.authUid === coach)!.lockedRole =
        'student';
    },
  ],
  [
    'coach timestamp regression',
    (v) => {
      v.profiles.afterRestoration.rows.userProfiles.find((r) => r.authUid === coach)!.updatedAt =
        beforeAt;
    },
  ],
  [
    'equal timestamp with changed encoding',
    (v) => {
      v.profiles.afterLogin.rows.userProfiles.find((r) => r.authUid === coach)!.updatedAt =
        '2026-10-01T00:00:00Z';
    },
  ],
  [
    'coach updatedAt mutation after restoration',
    (v) => {
      v.profiles.afterSignedOutRelaunch.rows.userProfiles.find(
        (r) => r.authUid === coach,
      )!.updatedAt = '2026-10-01T00:00:03.000Z';
    },
  ],
  [
    'foreign run snapshot',
    (v) => {
      v.profiles.afterLogin.runId = 'b'.repeat(24);
    },
  ],
  [
    'wrong platform snapshot scope',
    (v) => {
      v.domain.afterRestoration.scope = 'native-entry-android';
    },
  ],
  [
    'unrelated projected table mutation',
    (v) => {
      v.profiles.afterLogin.rows.inviteCodes.push({
        id: 'new-invite',
        professionalAuthUid: coach,
        specialty: 'fitness_coach',
        status: 'active',
        createdAt: loginAt,
        updatedAt: loginAt,
        rotatedAt: null,
      });
      v.profiles.afterLogin.rowCounts.inviteCodes++;
    },
  ],
  [
    'domain connection mutation',
    (v) => {
      v.domain.afterLogin.connections.push({
        id: 'new-connection',
        professionalAuthUid: coach,
        studentAuthUid: student,
        status: 'pending_confirmation',
        specialty: 'fitness_coach',
        canceledReason: null,
        sourceInviteCodeId: null,
        sourceInviteCodeValue: null,
        createdAt: loginAt,
        updatedAt: loginAt,
        endedAt: null,
      });
    },
  ],
  [
    'failed restoration hydrate',
    (v) => {
      v.observations[1].status = 401;
    },
  ],
  [
    'GET instead of actual POST hydrate',
    (v) => {
      v.observations[1].method = 'GET';
    },
  ],
  [
    'foreign API identity',
    (v) => {
      v.authIdentities[0].apiPid++;
    },
  ],
  [
    'wrong authenticated coach',
    (v) => {
      v.authIdentities[0].authUid = student;
    },
  ],
  [
    'wrong persisted restored identity',
    (v) => {
      v.persistedCoachIdentity.afterRestorationAuthUidHash = hash(student);
    },
  ],
  [
    'fault-injected session request',
    (v) => {
      v.observations[1].faultAttemptId = 'fault-attempt';
    },
  ],
  [
    'duplicate transport identity',
    (v) => {
      v.observations[1].requestId = 1;
    },
  ],
  [
    'overlapping phase windows',
    (v) => {
      v.restorationWindow.afterRequestId = 0;
    },
  ],
  [
    'restoration outside declared window',
    (v) => {
      v.restorationWindow = { afterRequestId: 2, throughRequestId: 3 };
    },
  ],
  [
    'second sign-in',
    (v) => {
      v.observations = [...v.observations, { ...v.observations[0], requestId: 3 }];
    },
  ],
  [
    'authenticated hydrate after declared restoration',
    (v) => {
      v.observations = [...v.observations, { ...v.observations[1], requestId: 3 }];
    },
  ],
  [
    'declared relaunch without its hydrate',
    (v) => {
      v.observations = [
        ...v.observations,
        { ...v.observations[0], requestId: 3, pathHash: hash('/me') },
      ];
      v.relaunchWindows = [{ afterRequestId: 2, throughRequestId: 3 }];
    },
  ],
  [
    'declared relaunch overlapping restoration',
    (v) => {
      v.observations = [...v.observations, { ...v.observations[1], requestId: 3 }];
      v.relaunchWindows = [{ afterRequestId: 1, throughRequestId: 3 }];
    },
  ],
  [
    'declared relaunch with two hydrates',
    (v) => {
      v.observations = [
        ...v.observations,
        { ...v.observations[1], requestId: 3 },
        { ...v.observations[1], requestId: 4 },
      ];
      v.relaunchWindows = [{ afterRequestId: 2, throughRequestId: 4 }];
    },
  ],
];

void test('a hydrate inside a declared signed-in relaunch window is permitted', () => {
  const value = input('android');
  value.observations = [...value.observations, { ...value.observations[1], requestId: 3 }];
  value.relaunchWindows = [{ afterRequestId: 2, throughRequestId: 3 }];
  assert.equal(verifyNativeSessionProfileCheckpoints(value).status, 'verified');

  // The relaunch hydrate may advance only the coach's updatedAt.
  const later = structuredClone(value);
  const coachRow = later.profiles.afterSignedOutRelaunch.rows.userProfiles.find(
    (row) => row.authUid === coach,
  )!;
  coachRow.updatedAt = '2999-01-01T00:00:00.000Z';
  assert.equal(verifyNativeSessionProfileCheckpoints(later).status, 'verified');
  coachRow.lockedRole = 'student';
  assert.throws(() => verifyNativeSessionProfileCheckpoints(later));
});
for (const [name, mutate] of cases) {
  void test(`session rejects ${name}`, () => {
    const value = input();
    mutate(value);
    assert.throws(() => verifyNativeSessionProfileCheckpoints(value));
  });
}

void test('closed signed-out window uses started request IDs despite out-of-order completion', () => {
  const base = input().observations[0];
  const rows: ProxyObservation[] = [
    {
      ...base,
      requestId: 2,
      method: 'GET',
      pathHash: hash('/health'),
      requestCredentialPresent: false,
    },
    { ...base, requestId: 1 },
  ];
  assert.deepEqual(
    requireSignedOutSessionTransport({
      observations: rows,
      window: { afterRequestId: 1, throughRequestId: 2 },
      expectedTargetOrigin: api.targetOrigin,
    }),
    [rows[0]],
  );
  assert.deepEqual(
    requireSignedOutSessionTransport({
      observations: [],
      window: { afterRequestId: 0, throughRequestId: 0 },
      expectedTargetOrigin: api.targetOrigin,
    }),
    [],
  );
});

void test('signed-out window rejects missing completions, repeated IDs and actual credential/auth leaks', () => {
  const base = {
    ...input().observations[0],
    method: 'GET',
    pathHash: hash('/health'),
    requestCredentialPresent: false,
  };
  const verify = (rows: ProxyObservation[], throughRequestId = 1) =>
    requireSignedOutSessionTransport({
      observations: rows,
      window: { afterRequestId: 0, throughRequestId },
      expectedTargetOrigin: api.targetOrigin,
    });
  for (const patch of [
    { requestCredentialPresent: true },
    { requestCredentialPresent: undefined },
    { pathHash: hash('/auth/email/sign-in') },
    { pathHash: hash('/me/hydrate') },
    { outcome: 'upstream-failed' as const },
    { faultAttemptId: 'unexpected' },
    { targetOrigin: 'http://127.0.0.1:19002' },
    { requestOrigin: 'http://127.0.0.1:19002' },
  ])
    assert.throws(() => verify([{ ...base, ...patch }]));
  assert.throws(() => verify([], 1));
  assert.throws(() => verify([base, base], 2));
  assert.throws(() => verify([{ ...base, requestId: 2 }], 1));
});

void test('final transport binds saved bytes to the stopped stream and rejects late mutation', () => {
  const rows = input().observations;
  const bytes = Buffer.from(JSON.stringify(rows, null, 2));
  const receipt = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.doesNotThrow(() => requireFinalSessionTransport(bytes, receipt, rows));
  assert.throws(() =>
    requireFinalSessionTransport(bytes, receipt, [...rows, { ...rows[0], requestId: 3 }]),
  );
  assert.throws(() =>
    requireFinalSessionTransport(Buffer.concat([bytes, Buffer.from(' ')]), receipt, rows),
  );
  const changed = Buffer.from(bytes);
  changed[0] = 123;
  assert.throws(() => requireFinalSessionTransport(changed, receipt, rows));
});

void test('session ledger refuses cancellation before or during publication and rolls back partial writes', () => {
  const controller = new AbortController();
  const report: Record<string, unknown> = {
    observations: 'previous-diagnostic',
    independent: 'retained',
  };
  const ledger = {
    observations: ['candidate'],
    get sessionViewEvidence() {
      controller.abort(new Error('cancel during publication'));
      return ['candidate'];
    },
  };
  assert.throws(
    () => publishNativeSessionLedger(report, ledger, controller.signal),
    /cancel during/,
  );
  assert.equal(report.observations, 'previous-diagnostic');
  assert.equal(report.independent, 'retained');
  assert.equal(Object.hasOwn(report, 'sessionViewEvidence'), false);
  assert.equal(report.sessionEvidencePublication, 'aborted-before-complete');
  assert.throws(() =>
    publishNativeSessionLedger(report, { observations: ['new'] }, controller.signal),
  );
  assert.equal(report.observations, 'previous-diagnostic');
  const active = new AbortController();
  publishNativeSessionLedger(report, { observations: ['complete'] }, active.signal);
  assert.equal(report.sessionEvidencePublication, 'complete');
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateNativeConnectionStatePreparation } from '../../scripts/testing/native-view-evidence';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

for (const platform of ['ios', 'android'] as const) {
  void test(`${platform} connection inventory rejects mixed identities, premature activation, SQL changes and missing native reads`, async () => {
    // These synthetic records exercise the evidence boundary, never device acceptance.
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-connection-evidence-')));
    await chmod(root, 0o700);
    const runId = 'a'.repeat(24);
    const attribute = platform === 'ios' ? 'accessibilityText' : 'text';
    const states = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        studentAuthUid: 'student-pending',
        status: 'pending_confirmation',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        studentAuthUid: 'student-active',
        status: 'active',
      },
    ];
    const preparation = {
      requirementRefs: ['SC-211', 'UC-002.3', 'AC-214', 'BR-213', 'TC-213', 'TC-214'],
      coachAuthUid: 'coach',
      seededStates: states,
      ownedSqlBeforeAfterUnchanged: true,
      snapshotPaths: ['connection-before.private.json', 'connection-after.private.json'],
      scope: 'separate-seeded-state-views-only; no invite submission or approval pass',
    };
    const snapshot = {
      schemaVersion: 1,
      runId,
      scope: `native-entry-${platform}`,
      readOnly: true,
      trainingPlans: [],
      connections: states.map((state) => ({
        ...state,
        professionalAuthUid: 'coach',
        specialty: 'fitness_coach',
        createdAt: '2026-09-29T00:00:00Z',
        updatedAt: '2026-09-29T00:00:00Z',
        endedAt: null,
        canceledReason: null,
        sourceInviteCodeId: null,
        sourceInviteCodeValue: null,
      })),
    };
    const node = (attributes: Record<string, string>, children: unknown[] = []) => ({
      attributes,
      children,
    });
    const pendingId = `student.professionals.connectionPending.${states[0].id}`;
    const guidance = 'Waiting for professional confirmation to activate this connection.';
    const pending = node({ 'resource-id': pendingId, [attribute]: guidance });
    const active = node({
      'resource-id': 'student.professionals.unbindButton.0',
      [attribute]: 'End connection',
    });
    const trees = {
      'coach-pending': node({ [attribute]: states[0].id }),
      'coach-roster': node(
        {},
        states.map((state) => node({ 'resource-id': `pro.students.row.${state.studentAuthUid}` })),
      ),
      'student-pending': pending,
      'student-active': active,
    };
    const transport = [
      ...Array.from({ length: 3 }, () => ({
        method: 'POST',
        route: '/auth/email/sign-in',
        status: 201,
      })),
      ...Array.from({ length: 3 }, () => ({ method: 'GET', route: '/connections', status: 200 })),
      { method: 'GET', route: '/professional/students', status: 200 },
    ].map(({ route, ...row }) => ({
      ...row,
      pathHash: hash(route),
      outcome: 'forwarded',
      requestProfile: 'native',
    }));
    const put = (name: string, value: unknown) =>
      writeFile(path.join(root, name), JSON.stringify(value), { mode: 0o600 });
    const check = () =>
      validateNativeConnectionStatePreparation(root, platform, runId, preparation, transport);
    try {
      await put('connection-before.private.json', snapshot);
      await put('connection-after.private.json', snapshot);
      for (const [label, tree] of Object.entries(trees)) await put(`${label}-hierarchy.json`, tree);
      check();

      for (const invalid of [
        null,
        { ...preparation, coachAuthUid: 'student-pending' },
        { ...preparation, coachAuthUid: 42 },
        { ...preparation, scope: 'invite-approval-pass' },
        { ...preparation, ownedSqlBeforeAfterUnchanged: false },
        { ...preparation, requirementRefs: [] },
        { ...preparation, snapshotPaths: ['../outside.json'] },
        { ...preparation, seededStates: [null, states[1]] },
        { ...preparation, seededStates: [states[0], states[0]] },
        { ...preparation, seededStates: [states[1], states[0]] },
        { ...preparation, seededStates: [{ ...states[0], id: 'a'.repeat(36) }, states[1]] },
        {
          ...preparation,
          seededStates: [states[0], { ...states[1], studentAuthUid: states[0].studentAuthUid }],
        },
      ])
        assert.throws(
          () => validateNativeConnectionStatePreparation(root, platform, runId, invalid, transport),
          /separate seeded state scope/,
        );

      for (const invalid of [
        { ...snapshot, runId: 'b'.repeat(24) },
        { ...snapshot, scope: `native-entry-${platform === 'ios' ? 'android' : 'ios'}` },
        { ...snapshot, readOnly: false },
        { ...snapshot, connections: snapshot.connections.slice(1) },
        ...['status', 'studentAuthUid', 'professionalAuthUid', 'specialty'].map((field) => ({
          ...snapshot,
          connections: [
            {
              ...snapshot.connections[0],
              [field]: {
                status: 'active',
                studentAuthUid: 'foreign',
                professionalAuthUid: 'foreign',
                specialty: 'nutritionist',
              }[field],
            },
            snapshot.connections[1],
          ],
        })),
        {
          ...snapshot,
          connections: [
            { ...snapshot.connections[0], updatedAt: '2026-09-29T00:00:01Z' },
            snapshot.connections[1],
          ],
        },
      ]) {
        await put('connection-after.private.json', invalid);
        assert.throws(check, /snapshot|SQL/);
      }
      await put('connection-after.private.json', snapshot);
      // Matching before/after is insufficient when both belong to another run.
      await put('connection-before.private.json', { ...snapshot, runId: 'b'.repeat(24) });
      await put('connection-after.private.json', { ...snapshot, runId: 'b'.repeat(24) });
      assert.throws(check, /owned seeded identities/);
      await put('connection-before.private.json', snapshot);
      await put('connection-after.private.json', snapshot);

      const mutations: [keyof typeof trees, unknown][] = [
        ['coach-pending', node({ [attribute]: states[1].id })],
        [
          'coach-roster',
          node({}, [node({ 'resource-id': `pro.students.row.${states[1].studentAuthUid}` })]),
        ],
        ['student-pending', node({ 'resource-id': pendingId, [attribute]: 'Active' })],
        ['student-pending', node({ 'resource-id': pendingId }, [node({ [attribute]: guidance })])],
        [
          'student-pending',
          node({
            'resource-id': pendingId,
            [platform === 'ios' ? 'text' : 'accessibilityText']: guidance,
          }),
        ],
        ['student-pending', node({ 'resource-id': pendingId, [attribute]: guidance }, [active])],
        [
          'student-active',
          node({ 'resource-id': 'unrelated.button', [attribute]: 'End connection' }),
        ],
        [
          'student-active',
          node({ 'resource-id': 'student.professionals.unbindButton.0' }, [
            node({ [attribute]: 'End connection' }),
          ]),
        ],
        [
          'student-active',
          node(active.attributes, [
            node({ 'resource-id': 'student.professionals.connectionPending.foreign' }),
          ]),
        ],
        ['student-active', pending],
      ];
      for (const [label, invalid] of mutations) {
        await put(`${label}-hierarchy.json`, invalid);
        assert.throws(check, /actual hierarchy/);
        await put(`${label}-hierarchy.json`, trees[label]);
      }
      for (const invalid of [
        null,
        transport.slice(1), // Only two normal logins remain.
        transport.filter((row) => row.pathHash !== hash('/connections')),
        transport.filter((row) => row.pathHash !== hash('/professional/students')),
        transport.map((row) => ({ ...row, requestProfile: 'browser' })),
        transport.map((row) => ({ ...row, outcome: 'injected' })),
        transport.map((row) => ({ ...row, status: 503 })),
        [null],
      ])
        assert.throws(
          () =>
            validateNativeConnectionStatePreparation(root, platform, runId, preparation, invalid),
          /normal owned multi-account transport/,
        );
      check();
    } finally {
      await rm(root, { recursive: true });
    }
  });
}

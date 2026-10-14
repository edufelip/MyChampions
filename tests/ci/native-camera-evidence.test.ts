import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import { validateIosCameraPreparation } from '../../scripts/testing/native-view-evidence';

void test('iOS camera inventory rejects substituted denial, foreign permission records and unusable manual fallback', async () => {
  // Synthetic boundary controls are never native acceptance evidence.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-camera-evidence-')));
  await chmod(root, 0o700);
  const runId = 'a'.repeat(24);
  const deviceUdid = '11111111-1111-4111-8111-111111111111';
  const bundleId = 'com.edufelip.mychampions.dev';
  const preparation = {
    requirementRefs: ['SC-211', 'UC-002.9', 'AC-249', 'BL-018/P4-camera-denied'],
    studentAuthUid: 'unlinked-student',
    displayName: 'MyChampions Dev',
    promptTitle: '“MyChampions Dev” would like to access the Camera.',
    denialControl: 'Don’t Allow',
    manualCode: 'QA-MANUAL-ONLY',
    snapshotPaths: ['camera-before.private.json', 'camera-after.private.json'],
    permissionPaths: [
      'camera-permission-before.private.json',
      'camera-permission-after.private.json',
    ],
    ownedSqlBeforeAfterUnchanged: true,
    scope: 'os-denial-and-manual-entry-views-only; no invite submission pass',
  };
  const snapshot = {
    schemaVersion: 1,
    runId,
    scope: 'native-entry-ios',
    readOnly: true,
    trainingPlans: [],
    connections: [],
  };
  const denied = {
    service: 'kTCCServiceCamera',
    client: bundleId,
    client_type: 0,
    auth_value: 0,
    auth_reason: 2,
  };
  const permission = {
    source: 'owned-simulator-tcc-read-only',
    deviceUdid,
    bundleId,
    rows: [] as unknown[],
  };
  const node = (attributes: Record<string, string>, children: unknown[] = []) => ({
    attributes,
    children,
  });
  const prompt = node(
    {},
    [preparation.promptTitle, preparation.denialControl, 'Allow'].map((accessibilityText) =>
      node({ accessibilityText }),
    ),
  );
  const error = {
    'resource-id': 'student.professionals.submitError',
    accessibilityText: enUS['relationship.qr.permission_denied'],
  };
  const input = {
    'resource-id': 'student.professionals.codeInput',
    text: preparation.manualCode,
    enabled: 'true',
  };
  const button = { 'resource-id': 'student.professionals.connectButton', enabled: 'true' };
  const guidance = node({}, [node(error), node({ 'resource-id': input['resource-id'] })]);
  const manual = node({}, [node(input), node(button)]);
  const hash = (route: string) => createHash('sha256').update(route).digest('hex');
  const transport = [
    ['POST', '/auth/email/sign-in', 201],
    ['GET', '/connections', 200],
  ].map(([method, route, status]) => ({
    method,
    pathHash: hash(String(route)),
    status,
    outcome: 'forwarded',
    requestProfile: 'native',
  }));
  const valid = {
    'camera-before.private.json': snapshot,
    'camera-after.private.json': snapshot,
    'camera-permission-before.private.json': permission,
    'camera-permission-after.private.json': { ...permission, rows: [denied] },
    'camera-prompt-hierarchy.json': prompt,
    'camera-guidance-hierarchy.json': guidance,
    'camera-manual-hierarchy.json': manual,
  };
  const put = (file: string, value: unknown) =>
    writeFile(path.join(root, file), JSON.stringify(value), { mode: 0o600 });
  const check = (row: unknown = preparation, records: unknown = transport) =>
    validateIosCameraPreparation(root, runId, deviceUdid, row, records);
  const rejectFile = async (file: keyof typeof valid, value: unknown) => {
    await put(file, value);
    assert.throws(() => check());
    await put(file, valid[file]);
    check();
  };
  try {
    for (const [file, value] of Object.entries(valid)) await put(file, value);
    check();
    for (const row of [
      null,
      {},
      { ...preparation, scope: 'passed' },
      { ...preparation, requirementRefs: [] },
      { ...preparation, promptTitle: 'Different App Camera' },
      { ...preparation, manualCode: '' },
      { ...preparation, ownedSqlBeforeAfterUnchanged: false },
    ])
      assert.throws(() => check(row));
    for (const field of ['runId', 'scope']) {
      await rejectFile('camera-before.private.json', { ...snapshot, [field]: 'foreign' });
      await rejectFile('camera-after.private.json', { ...snapshot, [field]: 'foreign' });
    }
    await rejectFile('camera-after.private.json', { ...snapshot, readOnly: false });
    const connection = {
      id: '22222222-2222-4222-8222-222222222222',
      professionalAuthUid: 'coach',
      studentAuthUid: 'other-student',
      specialty: 'fitness_coach',
      status: 'pending_confirmation',
      createdAt: '2026-09-29T00:00:00Z',
      updatedAt: '2026-09-29T00:00:00Z',
      endedAt: null,
      canceledReason: null,
      sourceInviteCodeId: null,
      sourceInviteCodeValue: null,
    };
    await rejectFile('camera-after.private.json', { ...snapshot, connections: [connection] });
    for (const file of ['camera-before.private.json', 'camera-after.private.json'] as const)
      await rejectFile(file, {
        ...snapshot,
        connections: [{ ...connection, studentAuthUid: preparation.studentAuthUid }],
      });
    for (const replacement of [
      { ...permission, deviceUdid: 'foreign' },
      { ...permission, bundleId: 'foreign.app' },
      { ...permission, source: 'mock' },
      { ...permission, rows: [denied] },
    ])
      await rejectFile('camera-permission-before.private.json', replacement);
    for (const rows of [
      [],
      [denied, denied],
      [{ ...denied, auth_value: 2 }],
      [{ ...denied, client: 'foreign.app' }],
      [{ ...denied, service: 'kTCCServiceMicrophone' }],
      [{ ...denied, client_type: 1 }],
      [{ ...denied, auth_reason: '2' }],
    ])
      await rejectFile('camera-permission-after.private.json', { ...permission, rows });
    await rejectFile(
      'camera-prompt-hierarchy.json',
      node({}, [
        node({ accessibilityText: 'Allow' }),
        node({ accessibilityText: preparation.denialControl }),
      ]),
    );
    await rejectFile(
      'camera-guidance-hierarchy.json',
      node({}, [
        node({ ...error, accessibilityText: enUS['relationship.qr.camera_unavailable'] }),
        node({ 'resource-id': input['resource-id'] }),
      ]),
    );
    await rejectFile(
      'camera-guidance-hierarchy.json',
      node({}, [
        node({ 'resource-id': error['resource-id'] }, [
          node({ accessibilityText: error.accessibilityText }),
        ]),
        node({ 'resource-id': input['resource-id'] }),
      ]),
    );
    for (const badInput of [
      { ...input, text: 'OTHER' },
      { ...input, enabled: 'false' },
      { ...input, 'resource-id': 'foreign-input' },
    ])
      await rejectFile('camera-manual-hierarchy.json', node({}, [node(badInput), node(button)]));
    await rejectFile(
      'camera-manual-hierarchy.json',
      node({}, [node(input), node({ ...button, enabled: 'false' })]),
    );
    await rejectFile(
      'camera-manual-hierarchy.json',
      node({}, [
        node(input),
        node(button),
        node({ 'resource-id': 'student.professionals.qrModal' }),
      ]),
    );
    for (const records of [
      [],
      transport.slice(1),
      transport.slice(0, 1),
      transport.map((row) => ({ ...row, requestProfile: 'browser' })),
      transport.map((row) => ({ ...row, outcome: 'injected' })),
      [...transport, { ...transport[0], pathHash: hash('/connections/invite-submissions') }],
    ])
      assert.throws(() => check(preparation, records));
    check();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

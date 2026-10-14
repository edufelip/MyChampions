import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeHierarchyHasAttribute } from './native-hierarchy';
import type { ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures } from './owned-session';

/** Seeded state observations only; the two-person mutation journey belongs to T14. */
export async function observeNativeConnectionStates({
  platform,
  output,
  fixtures,
  report,
  snapshot,
  observations,
  observe,
  switchAccount,
}: {
  platform: 'ios' | 'android';
  output: string;
  fixtures: OwnedFixtures;
  report: Record<string, unknown>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  observations: () => readonly ProxyObservation[];
  observe: (label: string, actions: string, viewId: string, selectors: string[]) => Promise<void>;
  switchAccount: (account: 'pending-student' | 'active-student') => Promise<void>;
}) {
  const before = await snapshot();
  const expected = [
    {
      id: fixtures.pendingConnectionId,
      studentAuthUid: fixtures.accounts['pending-student'].authUid,
      status: 'pending_confirmation',
    },
    {
      id: fixtures.activeConnectionId,
      studentAuthUid: fixtures.accounts['active-student'].authUid,
      status: 'active',
    },
  ];
  if (
    !expected.every((row) =>
      before.connections.some(
        (value) =>
          value.id === row.id &&
          value.studentAuthUid === row.studentAuthUid &&
          value.status === row.status &&
          value.professionalAuthUid === fixtures.accounts.coach.authUid,
      ),
    )
  )
    throw new Error('Native connection observation lacks its separate seeded states');
  await writeFile(path.join(output, 'connection-before.private.json'), JSON.stringify(before), {
    flag: 'wx',
    mode: 0o600,
  });
  const tap = (id: string) => `- tapOn:\n    id: ${JSON.stringify(id)}\n`;
  const scroll = (id: string) =>
    `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(id)}\n    direction: DOWN\n    timeout: 20000\n    centerElement: true\n`;
  await observe(
    'coach-pending',
    tap('pro.home.pendingConnections') +
      (platform === 'android'
        ? `- scrollUntilVisible:\n    element:\n      text: ${JSON.stringify('^' + fixtures.pendingConnectionId + '$')}\n    direction: DOWN\n    timeout: 20000\n    centerElement: true\n`
        : ''),
    'SCR-pro-pending',
    ['pro.pending.screen'],
  );
  const pendingTree = JSON.parse(
    await readFile(path.join(output, 'coach-pending-hierarchy.json'), 'utf8'),
  ) as unknown;
  if (
    !nativeHierarchyHasAttribute(
      pendingTree,
      platform === 'ios' ? 'accessibilityText' : 'text',
      fixtures.pendingConnectionId,
    )
  )
    throw new Error('Native pending queue lacks the exact seeded connection');
  await observe(
    'coach-roster',
    (platform === 'android'
      ? '- scrollUntilVisible:\n    element:\n      id: pro.pending.backButton\n    direction: UP\n    timeout: 20000\n    centerElement: true\n'
      : '') +
      tap('pro.pending.backButton') +
      scroll('pro.home.rosterCta') +
      tap('pro.home.rosterCta') +
      (platform === 'android' ? scroll(`pro.students.row.${expected[0].studentAuthUid}`) : ''),
    'SCR-pro-roster',
    ['pro.students.screen', ...expected.map((row) => `pro.students.row.${row.studentAuthUid}`)],
  );
  for (const account of ['pending-student', 'active-student'] as const) {
    await switchAccount(account);
    const pending = account === 'pending-student';
    await observe(
      `relationships-${account}`,
      tap('student.home.accountButton'),
      'SCR-student-professionals',
      ['student.professionals.screen', 'student.professionals.codeInput'],
    );
    await observe(
      pending ? 'student-pending' : 'student-active',
      pending
        ? scroll(`student.professionals.connectionPending.${fixtures.pendingConnectionId}`)
        : '- scrollUntilVisible:\n    element:\n      text: "^End connection$"\n    direction: DOWN\n    timeout: 20000\n    centerElement: true\n',
      pending ? 'STATE-connection-pending' : 'STATE-connection-active',
      pending
        ? [`student.professionals.connectionPending.${fixtures.pendingConnectionId}`]
        : ['student.professionals.screen'],
    );
    const tree = JSON.parse(
      await readFile(
        path.join(
          output,
          pending ? 'student-pending-hierarchy.json' : 'student-active-hierarchy.json',
        ),
        'utf8',
      ),
    ) as unknown;
    if (
      !pending &&
      !nativeHierarchyHasAttribute(
        tree,
        platform === 'ios' ? 'accessibilityText' : 'text',
        'End connection',
      )
    )
      throw new Error('Native active relationship lacks its documented end action');
  }
  const after = await snapshot();
  await writeFile(path.join(output, 'connection-after.private.json'), JSON.stringify(after), {
    flag: 'wx',
    mode: 0o600,
  });
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Seeded connection observations changed owned SQL');
  for (const route of ['/connections', '/professional/students']) {
    const pathHash = createHash('sha256').update(route).digest('hex');
    if (
      !observations().some(
        (row) =>
          row.method === 'GET' &&
          row.pathHash === pathHash &&
          row.status === 200 &&
          row.outcome === 'forwarded' &&
          row.requestProfile === 'native',
      )
    )
      throw new Error('Native connection observations lack normal owned reads');
  }
  report.connectionStatePreparation = {
    requirementRefs: ['SC-211', 'UC-002.3', 'AC-214', 'BR-213', 'TC-213', 'TC-214'],
    coachAuthUid: fixtures.accounts.coach.authUid,
    seededStates: expected,
    ownedSqlBeforeAfterUnchanged: true,
    snapshotPaths: ['connection-before.private.json', 'connection-after.private.json'],
    scope: 'separate-seeded-state-views-only; no invite submission or approval pass',
  };
}

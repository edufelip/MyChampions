import { URL } from 'node:url';
import { devices, expect, test } from '@playwright/test';
import { integrationCase } from './support';
import { t } from '../../localization/core';
import { INTEGRATION_PROJECTS } from '../../scripts/testing/integration-registry';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';
import type { BrowserContext, Page } from '@playwright/test';

type Connection = {
  id: string;
  status: string;
  specialty: string;
  professionalAuthUid: string;
};
test('@integration:connection-approval independent student requests and coach confirms', async ({
  page,
  context,
  browser,
}, info) => {
  const attempt = await integrationCase('connection-approval', info, browser);
  const { appOrigin, apiOrigin } = attempt.context;
  const profile = INTEGRATION_PROJECTS[attempt.selected.project];
  const studentContext = await browser.newContext({
    ...devices[profile.device],
    locale: profile.locale,
    baseURL: appOrigin,
  });
  const studentPage = await studentContext.newPage();
  const coach = attempt.fixtures.accounts.coach;
  const student = attempt.fixtures.accounts.student;
  const origins = [new Set<string>(), new Set<string>()];
  const tokens = ['', ''];
  for (const [index, observed] of [page, studentPage].entries())
    observed.on('request', (request) => {
      const url = new URL(request.url());
      if (
        /^\/(auth|me|connections|professional)(\/|$)/.test(url.pathname) &&
        url.origin !== appOrigin
      ) {
        origins[index].add(url.origin);
        const header = request.headers().authorization;
        if (header?.startsWith('Bearer ')) tokens[index] = header.slice(7);
      }
    });
  let initial!: OwnedDomainSnapshot;
  let code = '';
  let connectionId = '';
  const login = async (target: Page, account: typeof coach, home: string) => {
    await target.goto('/auth/sign-in');
    await target.getByTestId('auth.signIn.emailInput').fill(account.email);
    await target.getByTestId('auth.signIn.passwordInput').fill(account.password);
    await target.getByTestId('auth.signIn.submitButton').click();
    await expect(target.getByTestId(home).last()).toBeVisible({ timeout: 30_000 });
  };
  const readConnections = async (client: BrowserContext, index: number) => {
    expect(tokens[index]).toBeTruthy();
    const response = await client.request.get(`${apiOrigin}/connections`, {
      headers: { origin: appOrigin, authorization: `Bearer ${tokens[index]}` },
    });
    expect(response.status()).toBe(200);
    const rows = ((await response.json()) as { connections: Connection[] }).connections;
    await attempt.recordEvidence(index ? 'student-connections-api' : 'coach-connections-api', rows);
    return rows;
  };
  const checkRoster = async (status: 'pending' | 'active') => {
    const response = await context.request.get(`${apiOrigin}/professional/students`, {
      headers: { origin: appOrigin, authorization: `Bearer ${tokens[0]}` },
    });
    expect(response.status()).toBe(200);
    const rows = (
      (await response.json()) as {
        students: { studentAuthUid: string; assignmentStatus: string }[];
      }
    ).students;
    await attempt.recordEvidence('roster-api', rows);
    expect(rows.filter((row) => row.studentAuthUid === student.authUid)).toEqual([
      expect.objectContaining({ assignmentStatus: status }),
    ]);
    await expect(page.getByTestId(`pro.students.row.${student.authUid}`)).toContainText(
      t(
        profile.locale,
        status === 'active'
          ? 'pro.student_profile.assignment.active'
          : 'pro.student_profile.assignment.pending',
      ),
    );
  };
  const expectPersisted = async (status: string) => {
    for (const [index, client] of [context, studentContext].entries()) {
      const rows = await readConnections(client, index);
      expect(rows.filter((row) => row.id === connectionId)).toEqual([
        expect.objectContaining({
          id: connectionId,
          status,
          specialty: 'fitness_coach',
          professionalAuthUid: coach.authUid,
        }),
      ]);
    }
    const snapshot = await attempt.snapshot();
    expect(snapshot.connections).toHaveLength(initial.connections.length + 1);
    expect(snapshot.connections.filter((row) => row.id === connectionId)).toEqual([
      expect.objectContaining({
        studentAuthUid: student.authUid,
        professionalAuthUid: coach.authUid,
        specialty: 'fitness_coach',
        status,
        sourceInviteCodeValue: code,
      }),
    ]);
  };
  try {
    await attempt.assert('independent-ui-logins', async () => {
      await login(page, coach, 'pro.home.screen');
      await login(studentPage, student, 'student.home.screen');
      const coachCookie = (await context.cookies()).find(
        (row) => row.name === 'mychampions_refresh_token',
      );
      const studentCookie = (await studentContext.cookies()).find(
        (row) => row.name === 'mychampions_refresh_token',
      );
      expect(coachCookie?.httpOnly).toBe(true);
      expect(studentCookie?.httpOnly).toBe(true);
      expect(studentCookie?.value).not.toBe(coachCookie?.value);
      initial = await attempt.snapshot();
      expect(
        initial.connections.filter((row) => row.studentAuthUid === student.authUid),
      ).toHaveLength(0);
    });
    await attempt.assert('professional-ui-invite-code', async () => {
      const visible = page
        .getByTestId('pro.home.screen')
        .last()
        .getByTestId('pro.home.inviteCodeValue');
      await expect(visible).toBeVisible();
      code = (await visible.innerText()).trim();
      expect(code).toMatch(/^[A-Z0-9]+$/);
      expect(code.length).toBeGreaterThan(3);
    });
    await attempt.assert('student-ui-pending-request', async () => {
      await studentPage.goto('/student/professionals');
      await studentPage.getByTestId('student.professionals.codeInput').fill(code);
      const submitted = studentPage.waitForResponse(
        (response) =>
          response.url() === `${apiOrigin}/connections/invite-submissions` &&
          response.request().method() === 'POST',
      );
      await studentPage.getByTestId('student.professionals.connectButton').click();
      const response = await submitted;
      expect(response.status()).toBe(201);
      const result = (await response.json()) as { connectionId: string; status: string };
      expect(result.status).toBe('pending_confirmation');
      connectionId = result.connectionId;
      expect(connectionId).toBeTruthy();
      await expect(
        studentPage.getByTestId(`student.professionals.connectionPending.${connectionId}`),
      ).toBeVisible();
      await expect(studentPage.getByTestId('student.professionals.unbindButton.0')).toHaveCount(0);
    });
    await attempt.assert('pending-api-sql-both-contexts', async () => {
      await expectPersisted('pending_confirmation');
      await page.goto('/professional/students');
      await checkRoster('pending');
      await page.goto('/professional/pending');
      await expect(
        page.getByTestId(/^pro\.pending\.row\./).filter({ hasText: connectionId }),
      ).toBeVisible();
    });
    await attempt.assert('professional-ui-confirmation', async () => {
      const row = page.getByTestId(/^pro\.pending\.row\./).filter({ hasText: connectionId });
      const confirmed = page.waitForResponse(
        (response) =>
          response.url() === `${apiOrigin}/connections/${connectionId}/confirm` &&
          response.request().method() === 'POST',
      );
      await row.getByTestId(/^pro\.pending\.acceptButton\.\d+$/).click();
      const response = await confirmed;
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ connectionId, status: 'active' });
      await expect(row).toHaveCount(0);
    });
    await attempt.assert('active-ui-api-sql-both-contexts', async () => {
      await expectPersisted('active');
      await studentPage.reload();
      await expect(
        studentPage.getByTestId(`student.professionals.connectionPending.${connectionId}`),
      ).toHaveCount(0);
      await expect(studentPage.getByTestId('student.professionals.unbindButton.0')).toBeVisible();
      await page.goto('/professional/students');
      await checkRoster('active');
    });
    await attempt.assert('seeded-domain-unchanged', async () => {
      const snapshot = await attempt.snapshot();
      expect(snapshot.trainingPlans).toEqual(initial.trainingPlans);
      expect(snapshot.connections.filter((row) => row.id !== connectionId)).toEqual(
        initial.connections,
      );
    });
    await attempt.assert('owned-two-context-origins', () => {
      for (const observed of origins) expect([...observed]).toEqual([apiOrigin]);
      expect(tokens[0]).toBeTruthy();
      expect(tokens[1]).toBeTruthy();
      expect(tokens[0]).not.toBe(tokens[1]);
    });
  } finally {
    await studentContext.close();
  }
});

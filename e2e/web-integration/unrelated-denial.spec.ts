import { URL } from 'node:url';
import { devices, expect, test } from '@playwright/test';
import { integrationCase } from './support';
import { t } from '../../localization/core';
import { INTEGRATION_PROJECTS } from '../../scripts/testing/integration-registry';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';
import type { BrowserContext, Page, APIResponse, Response } from '@playwright/test';

test('@integration:unrelated-denial another professional cannot disclose or mutate an owned plan', async ({
  page,
  context,
  browser,
}, info) => {
  const attempt = await integrationCase('unrelated-denial', info, browser);
  const { appOrigin, apiOrigin } = attempt.context;
  const profile = INTEGRATION_PROJECTS[attempt.selected.project];
  const otherContext = await browser.newContext({
    ...devices[profile.device],
    locale: profile.locale,
    baseURL: appOrigin,
  });
  const otherPage = await otherContext.newPage();
  const owner = attempt.fixtures.accounts.coach;
  const other = attempt.fixtures.accounts['unrelated-coach'];
  const planId = attempt.fixtures.savedPlanId;
  const endpoint = `${apiOrigin}/plans/training/${planId}`;
  const origins = [new Set<string>(), new Set<string>()];
  const tokens = ['', ''];
  let initial!: OwnedDomainSnapshot;
  let ownerPlan!: Record<string, unknown>;
  for (const [index, target] of [page, otherPage].entries()) {
    target.on('request', (request) => {
      const url = new URL(request.url());
      if (/^\/(auth|me|plans|professional)(\/|$)/.test(url.pathname) && url.origin !== appOrigin) {
        origins[index].add(url.origin);
        const header = request.headers().authorization;
        if (header?.startsWith('Bearer ')) tokens[index] = header.slice(7);
      }
    });
  }
  const headers = (index: number) => {
    expect(tokens[index]).toBeTruthy();
    return { origin: appOrigin, authorization: `Bearer ${tokens[index]}` };
  };
  const login = async (target: Page, account: typeof owner, index: number) => {
    await target.goto('/auth/sign-in');
    await target.getByTestId('auth.signIn.emailInput').fill(account.email);
    await target.getByTestId('auth.signIn.passwordInput').fill(account.password);
    const [response] = await Promise.all([
      target.waitForResponse(
        (response) =>
          response.url() === `${apiOrigin}/auth/email/sign-in` &&
          response.request().method() === 'POST',
      ),
      target.getByTestId('auth.signIn.submitButton').click(),
    ]);
    expect(response.status()).toBe(201);
    tokens[index] = ((await response.json()) as { accessToken: string }).accessToken;
    await expect(target.getByTestId('pro.home.screen').last()).toBeVisible({ timeout: 30_000 });
  };
  const ownerRead = async () => {
    const response = await context.request.get(endpoint, { headers: headers(0) });
    expect(response.status()).toBe(200);
    const value = ((await response.json()) as { plan: Record<string, unknown> }).plan;
    await attempt.recordEvidence('owner-plan-api', value);
    return value;
  };
  const denied = async (response: Response | APIResponse, label: string) => {
    expect(response.status()).toBe(404);
    const value: unknown = await response.json();
    await attempt.recordEvidence(label, value);
    expect(value).toEqual({ error: { code: 'not_found', message: 'Training plan not found.' } });
    expect(await attempt.snapshot()).toEqual(initial);
    expect(await ownerRead()).toEqual(ownerPlan);
  };
  const errorState = async () => {
    await expect(otherPage.getByTestId('pro.training_plan.error')).toHaveText(
      t(profile.locale, 'pro.plan.error.load'),
    );
    await expect(otherPage.getByTestId('pro.training_plan.name')).toHaveCount(0);
    await expect(otherPage.getByTestId('pro.training_plan.saveButton')).toHaveCount(0);
    await expect(otherPage.getByText(attempt.fixtures.draft.name, { exact: true })).toHaveCount(0);
    await expect(otherPage.getByTestId('pro.training_plan.error.retry')).toBeVisible();
  };
  try {
    await attempt.assert('independent-ui-identities', async () => {
      await login(page, owner, 0);
      await login(otherPage, other, 1);
      expect(tokens[0]).not.toBe(tokens[1]);
      const cookies = await Promise.all([context.cookies(), otherContext.cookies()]);
      const sessions = cookies.map((rows) =>
        rows.find((row) => row.name === 'mychampions_refresh_token'),
      );
      expect(sessions[0]?.httpOnly).toBe(true);
      expect(sessions[1]?.httpOnly).toBe(true);
      expect(sessions[0]?.value).not.toBe(sessions[1]?.value);
      for (const [index, client] of [context, otherContext].entries()) {
        const response = await client.request.get(`${apiOrigin}/me`, { headers: headers(index) });
        expect(response.status()).toBe(200);
        const value = (await response.json()) as {
          profile: { authUid: string; lockedRole: string };
        };
        expect(value.profile).toMatchObject({
          authUid: index ? other.authUid : owner.authUid,
          lockedRole: 'professional',
        });
        await attempt.recordEvidence(index ? 'other-profile-api' : 'owner-profile-api', value);
      }
    });
    await attempt.assert('existing-owner-api-sql-baseline', async () => {
      initial = await attempt.snapshot();
      ownerPlan = await ownerRead();
      expect(ownerPlan).toMatchObject({
        id: planId,
        name: attempt.fixtures.draft.name,
        ownerProfessionalUid: owner.authUid,
        sessions: attempt.fixtures.draft.sessions,
      });
      expect(initial.trainingPlans).toHaveLength(1);
      expect(initial.trainingPlans[0]).toMatchObject({
        id: planId,
        ownerProfessionalUid: owner.authUid,
        sessions: ownerPlan.sessions,
      });
      expect(initial.connections.some((row) => row.professionalAuthUid === other.authUid)).toBe(
        false,
      );
      await otherPage.goto('/training');
      await expect(otherPage.getByTestId(`pro.library.training.row.${planId}`)).toHaveCount(0);
      await otherPage.waitForLoadState('networkidle');
    });
    await attempt.assert('unrelated-ui-read-denied', async () => {
      const response = otherPage.waitForResponse(
        (response) => response.url() === endpoint && response.request().method() === 'GET',
      );
      await otherPage.goto(`/professional/training/plans/${planId}`);
      await denied(await response, 'ui-read-denial');
      await errorState();
    });
    await attempt.assert('unrelated-ui-retry-denied', async () => {
      const response = otherPage.waitForResponse(
        (response) => response.url() === endpoint && response.request().method() === 'GET',
      );
      await otherPage.getByTestId('pro.training_plan.error.retry').click();
      await denied(await response, 'ui-retry-denial');
      await errorState();
    });
    await attempt.assert('unrelated-update-denied', async () => {
      // Valid normal endpoint payload; bypassing a hidden client control is the
      // authorization probe, not an application auth or test-fixture bypass.
      await denied(
        await otherContext.request.patch(endpoint, {
          headers: headers(1),
          data: { name: 'Unauthorized overwrite', sessions: [] },
        }),
        'patch-denial',
      );
    });
    await attempt.assert('unrelated-delete-denied', async () => {
      await denied(
        await otherContext.request.delete(endpoint, { headers: headers(1) }),
        'delete-denial',
      );
    });
    await attempt.assert('restart-owner-state-unchanged', async () => {
      await Promise.all([
        page.waitForLoadState('networkidle'),
        otherPage.waitForLoadState('networkidle'),
      ]);
      await attempt.restart();
      expect(await ownerRead()).toEqual(ownerPlan);
      expect(await attempt.snapshot()).toEqual(initial);
      const response = otherPage.waitForResponse(
        (response) => response.url() === endpoint && response.request().method() === 'GET',
      );
      await otherPage.reload();
      await denied(await response, 'reload-denial');
      await errorState();
    });
    await attempt.assert('owned-denial-origin', async () => {
      expect([...origins[0]]).toEqual([apiOrigin]);
      expect([...origins[1]]).toEqual([apiOrigin]);
    });
  } finally {
    await otherContext.close();
  }
});

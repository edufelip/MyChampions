import { URL } from 'node:url';
import { expect, test } from '@playwright/test';
import { integrationCase } from './support';
import { t } from '../../localization/core';
import { INTEGRATION_PROJECTS } from '../../scripts/testing/integration-registry';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

type Plan = { id: string; name: string; sessions: Record<string, unknown>[] };
test('@integration:save-retry one pre-forward failure preserves draft and real retry persists once', async ({
  page,
  context,
  browser,
}, info) => {
  const attempt = await integrationCase('save-retry', info, browser);
  const { appOrigin, apiOrigin } = attempt.context;
  const coach = attempt.fixtures.accounts.coach;
  const locale = INTEGRATION_PROJECTS[attempt.selected.project].locale;
  const title = `QA retry ${info.project.name}`;
  const exerciseName = `${locale.slice(0, 2)} QA Exercise 1`;
  const exerciseId = '00000000-0000-4000-8000-000000000001';
  const quantity = '5x7';
  const notes = 'Retry keeps these notes';
  const origins = new Set<string>();
  let token = '';
  let initial!: OwnedDomainSnapshot;
  let finalState!: OwnedDomainSnapshot;
  let savedPlan!: Plan;
  let createdId = '';
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      /^\/(auth|me|plans|integrations|professional)(\/|$)/.test(url.pathname) &&
      url.origin !== appOrigin
    ) {
      origins.add(url.origin);
      const header = request.headers().authorization;
      if (header?.startsWith('Bearer ')) token = header.slice(7);
    }
  });
  const itemRow = () =>
    page.getByTestId(`pro.training_plan.itemRow.${exerciseName.replace(/[^A-Za-z0-9]/g, '_')}`);
  const errorBanner = () =>
    page.getByRole('alert').filter({ hasText: t(locale, 'common.error.generic') });
  const readPlan = async (id: string) => {
    const response = await context.request.get(`${apiOrigin}/plans/training/${id}`, {
      headers: { origin: appOrigin, authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const plan = ((await response.json()) as { plan: Plan }).plan;
    await attempt.recordEvidence('plan-api', plan);
    return plan;
  };
  const expectDraft = async () => {
    await expect(page.getByTestId('pro.training_plan.name')).toHaveValue(title);
    await expect(page.getByTestId('pro.training_plan.sessionRow.Strength')).toBeVisible();
    await expect(itemRow()).toContainText(quantity);
    await expect(itemRow()).toContainText(notes);
  };
  await attempt.assert('normal-login-baseline', async () => {
    await page.goto('/auth/sign-in');
    await page.getByTestId('auth.signIn.emailInput').fill(coach.email);
    await page.getByTestId('auth.signIn.passwordInput').fill(coach.password);
    const [signedIn] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === `${apiOrigin}/auth/email/sign-in` &&
          response.request().method() === 'POST',
      ),
      page.getByTestId('auth.signIn.submitButton').click(),
    ]);
    expect(signedIn.status()).toBe(201);
    token = ((await signedIn.json()) as { accessToken: string }).accessToken;
    expect(token).toBeTruthy();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible({ timeout: 30_000 });
    initial = await attempt.snapshot();
    expect(initial.trainingPlans).toHaveLength(1);
    expect((await readPlan(attempt.fixtures.savedPlanId)).name).toBe(initial.trainingPlans[0].name);
  });
  await attempt.assert('ui-local-draft-no-write', async () => {
    await page.goto('/professional/training/plans/new');
    await page.getByTestId('pro.training_plan.name').fill(title);
    await page.getByTestId('pro.training_plan.addSession').click();
    await page.getByTestId('pro.training_plan.addSession.name').fill('Strength');
    await page.getByTestId('pro.training_plan.addSession.confirm').click();
    await page.getByTestId('pro.training_plan.sessionRow.Strength.addItem').click();
    await page.getByTestId('exerciseSearch.input').fill('QA Exercise');
    const result = page.getByTestId(`exerciseSearch.result.${exerciseId}`);
    await expect(result).toContainText(exerciseName);
    await result.click();
    await page.getByTestId('exerciseSearch.quantity').fill(quantity);
    await page.getByTestId('exerciseSearch.notes').fill(notes);
    await page.getByTestId('exerciseSearch.confirm').click();
    await expect(page.getByTestId('exerciseSearch.modal')).not.toBeVisible();
    await expectDraft();
    expect(await attempt.snapshot()).toEqual(initial);
  });
  await attempt.assert('private-once-fault-armed', async () => {
    // The control requires an idle proxy; complete the catalog/thumbnail reads
    // before arming the account-scoped write failure.
    await page.waitForLoadState('networkidle');
    expect(token).toBeTruthy();
    expect(
      await attempt.armSaveFault({ method: 'POST', path: '/plans/training', accessToken: token }),
    ).toEqual({
      attemptId: attempt.selected.attemptId,
      injectedCount: 0,
    });
  });
  await attempt.assert('failed-save-retains-draft-error-no-write', async () => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === `${apiOrigin}/plans/training` &&
          response.request().method() === 'POST',
      ),
      page.getByTestId('pro.training_plan.saveButton').click(),
    ]);
    expect(response.status()).toBe(503);
    expect((await response.json()) as unknown).toEqual({
      error: {
        code: 'integration_save_unavailable',
        message: 'Owned integration proxy request failed.',
      },
    });
    await expect(errorBanner()).toBeVisible();
    await attempt.recordEvidence('failed-save-error-ui', {
      locale,
      text: await errorBanner().innerText(),
    });
    await expectDraft();
    await expect(page.getByTestId('pro.training_plan.saveButton')).toBeEnabled();
    expect(await attempt.snapshot()).toEqual(initial);
    expect((await readPlan(attempt.fixtures.savedPlanId)).sessions).toEqual(
      initial.trainingPlans[0].sessions,
    );
  });
  await attempt.assert('cleared-fault-ui-retry-success', async () => {
    expect(await attempt.clearSaveFault()).toEqual({
      attemptId: attempt.selected.attemptId,
      injectedCount: 1,
    });
    const [created, updated] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === `${apiOrigin}/plans/training` &&
          response.request().method() === 'POST',
      ),
      page.waitForResponse(
        (response) =>
          response.url().startsWith(`${apiOrigin}/plans/training/training_plan_`) &&
          response.request().method() === 'PATCH',
      ),
      page.getByTestId('pro.training_plan.saveButton').click(),
    ]);
    expect(created.status()).toBe(201);
    createdId = ((await created.json()) as { plan: Plan }).plan.id;
    expect(createdId).toMatch(/^training_plan_[a-f0-9-]{36}$/);
    expect(updated.url()).toBe(`${apiOrigin}/plans/training/${createdId}`);
    expect(updated.status()).toBe(200);
    await expect(errorBanner()).toHaveCount(0);
  });
  await attempt.assert('exact-one-durable-change', async () => {
    savedPlan = await readPlan(createdId);
    expect(savedPlan.name).toBe(title);
    expect(savedPlan.sessions).toHaveLength(1);
    expect(savedPlan.sessions[0]).toMatchObject({
      name: 'Strength',
      items: [expect.objectContaining({ name: exerciseName, exerciseId, quantity, notes })],
    });
    finalState = await attempt.snapshot();
    expect(finalState.trainingPlans).toHaveLength(initial.trainingPlans.length + 1);
    expect(finalState.trainingPlans.filter((row) => row.id !== createdId)).toEqual(
      initial.trainingPlans,
    );
    expect(finalState.connections).toEqual(initial.connections);
    expect(finalState.trainingPlans.find((row) => row.id === createdId)).toMatchObject({
      ownerProfessionalUid: coach.authUid,
      name: title,
      sourceKind: 'predefined',
      sessions: savedPlan.sessions,
    });
  });
  await attempt.assert('restart-reload-no-duplicate', async () => {
    await page.goto('/training');
    const row = page.getByTestId(`pro.library.training.row.${createdId}`);
    await expect(row).toContainText(title);
    await page.waitForLoadState('networkidle');
    await attempt.restart();
    await page.reload();
    await expect(row).toContainText(title);
    await row.click();
    await expectDraft();
    expect((await readPlan(createdId)).sessions).toEqual(savedPlan.sessions);
    expect(await attempt.snapshot()).toEqual(finalState);
  });
  await attempt.assert('owned-save-catalog-origin', () => {
    expect([...origins]).toEqual([apiOrigin]);
  });
});

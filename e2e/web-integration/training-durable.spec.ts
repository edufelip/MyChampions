import { URL } from 'node:url';
import { expect, test } from '@playwright/test';
import { integrationCase } from './support';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

type Session = {
  id: string;
  name: string;
  notes: string;
  items: { id: string; name: string; quantity: string; notes: string; exerciseId: string }[];
};
test('@integration:training-durable coach creates, edits and reloads a durable catalog plan', async ({
  page,
  context,
  browser,
}, info) => {
  const attempt = await integrationCase('training-durable', info, browser);
  const { appOrigin, apiOrigin } = attempt.context;
  const coach = attempt.fixtures.accounts.coach;
  const locale = info.project.use.locale?.slice(0, 2) ?? 'en';
  const title = `QA durable ${info.project.name}`;
  const finalTitle = `${title} updated`;
  const sessionName = 'Strength';
  const exerciseName = `${locale} QA Exercise 1`;
  const secondName = `${locale} QA Exercise 2`;
  const origins = new Set<string>();
  const catalogIds = new Set<string>();
  let token = '';
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^\/(auth|me|plans|integrations)(\/|$)/.test(url.pathname) && url.origin !== appOrigin) {
      origins.add(url.origin);
      const header = request.headers().authorization;
      if (header?.startsWith('Bearer ')) token = header.slice(7);
      if (url.pathname.startsWith('/integrations/exercise/exercises/'))
        catalogIds.add(url.pathname.split('/').at(-1)!);
    }
  });
  let initial!: OwnedDomainSnapshot;
  let createdId = '';
  let finalState!: OwnedDomainSnapshot;
  let finalSessions!: Session[];
  const createItem = async (name: string, id: string, quantity: string) => {
    await page.getByTestId('pro.training_plan.sessionRow.Strength.addItem').click();
    await expect(page.getByTestId('exerciseSearch.modal')).toBeVisible();
    await page.getByTestId('exerciseSearch.input').fill('QA Exercise');
    const result = page.getByTestId(`exerciseSearch.result.${id}`);
    await expect(result).toBeVisible();
    await expect(result).toContainText(name);
    await result.click();
    await expect(page.getByTestId('exerciseSearch.detail')).toBeVisible();
    await page.getByTestId('exerciseSearch.quantity').fill(quantity);
    await page.getByTestId('exerciseSearch.notes').fill('Controlled motion');
    await page.getByTestId('exerciseSearch.confirm').click();
    await expect(page.getByTestId('exerciseSearch.modal')).not.toBeVisible();
    const row = page.getByTestId(`pro.training_plan.itemRow.${name.replace(/[^a-zA-Z0-9]/g, '_')}`);
    await expect(row).toContainText(quantity);
  };
  const readApi = async () => {
    expect(token).toBeTruthy();
    const response = await context.request.get(`${apiOrigin}/plans/training/${createdId}`, {
      headers: { origin: appOrigin, authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const plan = (
      (await response.json()) as { plan: { id: string; name: string; sessions: Session[] } }
    ).plan;
    await attempt.recordEvidence('plan-api', plan);
    return plan;
  };
  const checkItems = (
    sessions: Session[],
    expected: { exerciseId: string; quantity: string }[],
  ) => {
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe(sessionName);
    expect(sessions[0].items).toHaveLength(expected.length);
    expect(
      sessions[0].items.map((item) => ({ exerciseId: item.exerciseId, quantity: item.quantity })),
    ).toEqual(expected);
  };
  await attempt.assert('normal-coach-login', async () => {
    await page.goto('/auth/sign-in');
    await page.getByTestId('auth.signIn.emailInput').fill(coach.email);
    await page.getByTestId('auth.signIn.passwordInput').fill(coach.password);
    await page.getByTestId('auth.signIn.submitButton').click();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('auth.terms.screen')).toHaveCount(0);
    initial = await attempt.snapshot();
    expect(initial.trainingPlans).toHaveLength(1);
  });
  await attempt.assert('local-draft-no-mutation', async () => {
    await page.goto('/professional/training/plans/new');
    await expect(page.getByTestId('pro.training_plan.name')).toBeVisible();
    await page.getByTestId('pro.training_plan.name').fill(title);
    await page.getByTestId('pro.training_plan.addSession').click();
    await page.getByTestId('pro.training_plan.addSession.name').fill(sessionName);
    await page.getByTestId('pro.training_plan.addSession.confirm').click();
    await createItem(exerciseName, '00000000-0000-4000-8000-000000000001', '3x8');
    expect(await attempt.snapshot()).toEqual(initial);
  });
  await attempt.assert('ui-create-exercise', async () => {
    const saved = page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/plans/training` && response.request().method() === 'POST',
    );
    const fullSave = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${apiOrigin}/plans/training/training_plan_`) &&
        response.request().method() === 'PATCH',
    );
    await page.getByTestId('pro.training_plan.saveButton').click();
    const response = await saved;
    expect(response.status()).toBe(201);
    createdId = ((await response.json()) as { plan: { id: string } }).plan.id;
    expect(createdId).toMatch(/^training_plan_[a-f0-9-]{36}$/);
    expect((await fullSave).status()).toBe(200);
    await expect(page.getByTestId('pro.training_plan.name')).toHaveValue(title);
    await expect(page.getByTestId('pro.training_plan.sessionRow.Strength')).toContainText('3x8');
  });
  await attempt.assert('create-api-sql-match', async () => {
    const expected = [{ exerciseId: '00000000-0000-4000-8000-000000000001', quantity: '3x8' }];
    await expect.poll(async () => (await readApi()).sessions.length).toBe(1);
    const api = await readApi();
    expect(api.name).toBe(title);
    checkItems(api.sessions, expected);
    const snapshot = await attempt.snapshot();
    expect(snapshot.trainingPlans).toHaveLength(2);
    const row = snapshot.trainingPlans.find((row) => row.id === createdId)!;
    expect(row.ownerProfessionalUid).toBe(coach.authUid);
    expect(row.sourceKind).toBe('predefined');
    expect(row.name).toBe(title);
    expect(row.sessions).toEqual(api.sessions);
  });
  await attempt.assert('ui-edit-api-sql-match', async () => {
    await page.goto(`/professional/training/plans/${createdId}`);
    await expect(page.getByTestId('pro.training_plan.name')).toHaveValue(title);
    await page.getByTestId('pro.training_plan.name').fill(finalTitle);
    await createItem(secondName, '00000000-0000-4000-8000-000000000002', '4x6');
    const saved = page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/plans/training/${createdId}` &&
        response.request().method() === 'PATCH',
    );
    await page.getByTestId('pro.training_plan.saveButton').click();
    expect((await saved).status()).toBe(200);
    const api = await readApi();
    expect(api.name).toBe(finalTitle);
    checkItems(api.sessions, [
      { exerciseId: '00000000-0000-4000-8000-000000000001', quantity: '3x8' },
      { exerciseId: '00000000-0000-4000-8000-000000000002', quantity: '4x6' },
    ]);
    finalSessions = api.sessions;
    finalState = await attempt.snapshot();
    expect(finalState.trainingPlans.find((row) => row.id === createdId)).toMatchObject({
      name: finalTitle,
      sessions: finalSessions,
    });
  });
  await attempt.assert('restart-reload-durable', async () => {
    await page.goto('/training');
    const savedRow = page.getByTestId(`pro.library.training.row.${createdId}`);
    await expect(savedRow).toContainText(finalTitle);
    // Save invalidates other mounted screens. Finish their reads before stopping
    // the owned API; the proxy deliberately rejects restarts during live traffic.
    await page.waitForLoadState('networkidle');
    const restart = await attempt.restart();
    expect(restart.apiPid).toBeGreaterThan(1);
    await page.reload();
    await expect(savedRow).toContainText(finalTitle);
    await savedRow.click();
    await expect(page.getByTestId('pro.training_plan.name')).toHaveValue(finalTitle);
    await expect(page.getByTestId('pro.training_plan.sessionRow.Strength')).toContainText('3x8');
    await expect(page.getByTestId('pro.training_plan.sessionRow.Strength')).toContainText('4x6');
    expect((await readApi()).sessions).toEqual(finalSessions);
    expect(await attempt.snapshot()).toEqual(finalState);
  });
  await attempt.assert('fixture-template-unchanged', async () => {
    const snapshot = await attempt.snapshot();
    expect(snapshot.trainingPlans.find((row) => row.id === attempt.fixtures.savedPlanId)).toEqual(
      initial.trainingPlans[0],
    );
    expect(snapshot.connections).toEqual(initial.connections);
    expect(snapshot.trainingPlans).toHaveLength(2);
  });
  await attempt.assert('owned-client-catalog-origin', () => {
    expect([...origins]).toEqual([apiOrigin]);
    expect([...catalogIds].sort()).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
  });
});

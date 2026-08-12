import { expect, test, type Page } from '@playwright/test';

async function chooseProfessional(page: Page) {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await page.getByTestId('pro.specialty.add.nutritionist').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.add.fitness_coach').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.cta_continue').click();
  await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
}

test('@functional @feature:training new training plans expose session controls before save', async ({
  page,
}, testInfo) => {
  await chooseProfessional(page);
  await page.getByTestId('tabs.training').last().click();
  await page.getByTestId('pro.library.training.create').click();

  await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();
  await expect(page.getByTestId('pro.training_plan.addSession')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('training-create-controls.png'),
    fullPage: true,
  });
});

test('@functional @feature:nutrition new nutrition plans expose meal controls before save', async ({
  page,
}, testInfo) => {
  await chooseProfessional(page);
  await page.getByTestId('tabs.nutrition').last().click();
  await page.getByTestId('pro.library.nutrition.create').click();

  await expect(page.getByTestId('pro.nutrition_plan.screen')).toBeVisible();
  await expect(page.getByTestId('pro.nutrition_plan.addMeal')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('nutrition-create-controls.png'),
    fullPage: true,
  });
});

test('@functional @feature:training empty session submission reports inline validation', async ({
  page,
}, testInfo) => {
  await chooseProfessional(page);
  await page.getByTestId('tabs.training').last().click();
  await page.getByTestId('pro.library.training.create').click();
  await page.getByTestId('pro.training_plan.addSession').click();
  await page.getByTestId('pro.training_plan.addSession.confirm').click();

  await expect(page.getByTestId('pro.training_plan.addSession.name')).toBeVisible();
  await expect(page.getByText('Session name is required.', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('empty-session-validation.png'),
    fullPage: true,
  });
});

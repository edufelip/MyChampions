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

test('@functional @feature:training saved training sessions survive a mobile browser reload', async ({
  page,
}, testInfo) => {
  await chooseProfessional(page);
  await page.getByTestId('tabs.training').last().click();
  await page.getByTestId('pro.library.training.create').click();
  await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();

  await page.getByTestId('pro.training_plan.name').fill('Reload-safe training');
  await page.getByTestId('pro.training_plan.addSession').click();
  await page.getByTestId('pro.training_plan.addSession.name').fill('Upper Body');
  await page.getByTestId('pro.training_plan.addSession.confirm').click();
  await expect(page.getByTestId('pro.training_plan.sessionRow.Upper_Body')).toBeVisible();

  await page.getByTestId('pro.training_plan.saveButton').click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByRole('button', { name: /Reload-safe training/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /Reload-safe training/ })).toBeVisible();
  await page.getByRole('button', { name: /Reload-safe training/ }).click();
  await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();
  await expect(page.getByTestId('pro.training_plan.sessionRow.Upper_Body')).toBeVisible();
  await expect(page.getByText(/Background update failed/)).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('training-persistence-after-reload.png'),
    fullPage: true,
  });
});

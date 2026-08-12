import { expect, test } from '@playwright/test';

test('@functional @feature:training dirty training builder requires explicit discard confirmation', async ({
  page,
}) => {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await page.getByTestId('pro.specialty.cta_skip').click();
  await page.getByTestId('tabs.training').last().click();
  await page.getByTestId('pro.library.training.create').click();
  await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();

  await page.getByTestId('pro.training_plan.name').fill('Unsaved web draft');
  await page.getByTestId('pro.training_plan.backButton').click();

  const dialog = page.getByTestId('pro.training_plan.discard.dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await dialog.getByTestId('pro.training_plan.discard.dialog.cancel').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('pro.training_plan.name')).toHaveValue('Unsaved web draft');

  await page.getByTestId('pro.training_plan.backButton').click();
  await dialog.getByTestId('pro.training_plan.discard.dialog.confirm').click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByTestId('pro.library.training.create')).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';

async function chooseStudent(page: Page) {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.studentCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('student.home.ready').last()).toBeVisible();
}

test.describe('@functional @feature:nutrition @feature:training plan builder recovery', () => {
  test('missing student nutrition plan fails closed and exposes retry', async ({ page }) => {
    await chooseStudent(page);
    await page.goto('/student/nutrition/plans/missing-plan');

    await expect(page.getByTestId('pro.nutrition_plan.errorState')).toBeVisible();
    await expect(page.getByText('Could not load your plan. Try again.')).toBeVisible();
    await expect(page.getByTestId('pro.plan.metadata.name')).toHaveCount(0);
    await expect(page.getByTestId('pro.nutrition_plan.retryButton')).toBeVisible();

    await page.getByTestId('pro.nutrition_plan.retryButton').click();
    await expect(page.getByTestId('pro.nutrition_plan.errorState')).toBeVisible();
  });

  test('missing student training plan fails closed and exposes retry', async ({ page }) => {
    await chooseStudent(page);
    await page.goto('/student/training/plans/missing-plan');

    await expect(page.getByTestId('pro.training_plan.errorState')).toBeVisible();
    await expect(page.getByText('Could not load your plan. Try again.')).toBeVisible();
    await expect(page.getByTestId('pro.training_plan.name')).toHaveCount(0);
    await expect(page.getByTestId('pro.training_plan.retryButton')).toBeVisible();

    await page.getByTestId('pro.training_plan.retryButton').click();
    await expect(page.getByTestId('pro.training_plan.errorState')).toBeVisible();
  });
});

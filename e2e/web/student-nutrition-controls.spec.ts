import { expect, test } from '@playwright/test';

test('@functional @feature:nutrition assigned meal controls are independent web buttons', async ({
  page,
}) => {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.studentCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('student.home.ready').last()).toBeVisible();
  await page.goto('/student/nutrition');
  await expect(page.getByTestId('student.nutrition.screen')).toBeVisible();

  expect(await page.locator('button button').count()).toBe(0);

  const mealId = 'e2e-assigned-meal';
  await expect(page.getByTestId(`student.nutrition.mealDetails.${mealId}`)).toBeHidden();
  await page.getByTestId(`student.nutrition.logMealButton.${mealId}`).click();
  await expect(page.getByTestId(`student.nutrition.loggedMealBadge.${mealId}`)).toBeVisible();
  await expect(page.getByTestId(`student.nutrition.mealDetails.${mealId}`)).toBeHidden();

  await page.getByTestId(`student.nutrition.expandMealButton.${mealId}`).click();
  await expect(page.getByTestId(`student.nutrition.mealDetails.${mealId}`)).toBeVisible();
});

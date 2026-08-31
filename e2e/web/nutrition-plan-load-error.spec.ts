import { expect, test, type Page } from '@playwright/test';

/**
 * ET-102 / TC-207 / SC-207 — a settled nutrition-plan load failure (missing,
 * stale, or unauthorized planId) must render an explicit, actionable error
 * state (Retry + Back to library) and must not leave the editable metadata
 * form or meal-section shell mounted around the error message.
 *
 * The default web Playwright server (playwright.config.ts) does not set
 * EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL, so the first plan read deterministically
 * fails — this is the "provider-free fixture" precondition from the ticket's
 * reproducible steps, independent of whether the requested planId is real.
 */

async function reachNutritionPlanBuilderWithLoadError(page: Page): Promise<void> {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.studentCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('student.home.ready').last()).toBeVisible();

  await page.goto('/student/nutrition/plans/not-a-real-plan');
  await expect(page.getByTestId('pro.nutrition_plan.error')).toBeVisible();
}

test.describe('@functional @feature:nutrition ET-102 nutrition plan load error', () => {
  test('renders Retry/Back and hides the editable metadata form and meals shell', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reachNutritionPlanBuilderWithLoadError(page);

    const errorText = page.getByTestId('pro.nutrition_plan.error');
    await expect(errorText).toHaveText('Could not load your plan. Try again.');

    await expect(page.getByTestId('pro.nutrition_plan.error.retry')).toBeVisible();
    await expect(page.getByTestId('pro.nutrition_plan.error.backToLibrary')).toBeVisible();

    // Editable/write controls must not be mounted while the error is
    // showing, so they cannot accept input — a stricter guarantee than
    // merely being visually hidden.
    await expect(page.getByTestId('pro.plan.metadata.name')).toHaveCount(0);
    await expect(page.getByTestId('pro.nutrition_plan.addMeal')).toHaveCount(0);
  });

  test('retry re-invokes the load and consistently settles back into the same actionable error state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reachNutritionPlanBuilderWithLoadError(page);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByTestId('pro.nutrition_plan.error.retry').click();
      await expect(page.getByTestId('pro.nutrition_plan.error')).toBeVisible();
      await expect(page.getByTestId('pro.nutrition_plan.error')).toHaveText(
        'Could not load your plan. Try again.',
      );
      await expect(page.getByTestId('pro.plan.metadata.name')).toHaveCount(0);
    }
  });

  test('Back to library returns from the load error to the nutrition library', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reachNutritionPlanBuilderWithLoadError(page);

    await page.getByTestId('pro.nutrition_plan.error.backToLibrary').click();

    await expect(page).toHaveURL(/\/student\/nutrition$/);
  });
});

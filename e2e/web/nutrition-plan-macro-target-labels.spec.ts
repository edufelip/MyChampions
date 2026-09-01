import { expect, test, type Page } from '@playwright/test';

/**
 * ET-170 / SC-207 — at narrow (320px "Small phone") widths the macro-target
 * summary row (Carbs/Proteins/Fats) must not truncate its labels into
 * ambiguous ellipsis text ("CARBS TARG…", "PROTEINS TA…", "FATS TARGET…").
 * The builder route is shared with the read-only student assigned-plan view
 * (`/student/nutrition/plans/:planId` re-exports the same builder engine),
 * so this also guards that surface.
 */

async function reachNewNutritionPlanBuilder(page: Page): Promise<void> {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
  await page.getByTestId('pro.specialty.add.nutritionist').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.cta_continue').click();
  await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();

  await page.getByTestId('tabs.nutrition').last().click();
  await expect(page.getByTestId('pro.library.nutrition.create')).toBeVisible();
  await page.getByTestId('pro.library.nutrition.create').click();
  await expect(page.getByTestId('pro.nutrition_plan.screen').last()).toBeVisible();
}

const macroLabelTestIds = [
  'pro.plan.metadata.macroTarget.carbs.label',
  'pro.plan.metadata.macroTarget.proteins.label',
  'pro.plan.metadata.macroTarget.fats.label',
];

test.describe('@functional @feature:nutrition ET-170 macro-target label truncation', () => {
  test('carbs/proteins/fats labels render without ellipsis truncation at 320px width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await reachNewNutritionPlanBuilder(page);

    for (const testId of macroLabelTestIds) {
      const label = page.getByTestId(testId);
      await expect(label).toBeVisible();

      // A label whose rendered content is wider than its box is visually
      // ellipsis-truncated (React Native Web keeps the full string as
      // textContent while clipping it with CSS, so this overflow check is
      // the only reliable ellipsis signal — asserting textContent alone
      // would pass even on the truncated pre-fix copy).
      const overflow = await label.evaluate(
        (el) => el.scrollWidth - el.getBoundingClientRect().width,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });

  test('carbs/proteins/fats labels also fit without truncation at 390px width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reachNewNutritionPlanBuilder(page);

    for (const testId of macroLabelTestIds) {
      const label = page.getByTestId(testId);
      const overflow = await label.evaluate(
        (el) => el.scrollWidth - el.getBoundingClientRect().width,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });
});

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureEvidence } from './support/evidence';

async function chooseStudent(page: Page) {
  await page.goto('/auth/role-selection');
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId('auth.roleSelection.studentCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('student.home.ready').last()).toBeVisible();
}

async function elementBox(page: Page, testId: string) {
  const el = page.getByTestId(testId).last();
  await expect(el).toBeVisible();
  const box = await el.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test.describe('@feature:assigned-plan-detail assigned plan name heading wraps at small-phone width', () => {
  test('nutrition plan name wraps instead of clipping mid-word at 320px', async ({
    page,
  }, testInfo: TestInfo) => {
    // Regression guard for ET-165: at 320px CSS width the shared
    // PlanMetadataForm name field rendered as a single-line <TextInput>, so a
    // long assigned plan name ("Assigned Nutrition Plan") overflowed the
    // card's right edge and was hard-clipped by the browser instead of
    // wrapping to a second line.
    await chooseStudent(page);
    await page.goto('/student/nutrition/plans/e2e-assigned-nutrition-plan');
    await expect(page.getByTestId('student.nutrition_plan.readOnlyNotice')).toBeVisible();

    const nameBox = await elementBox(page, 'pro.plan.metadata.name');
    // A single line of the ...DsTypography.title font (28px/34 line-height)
    // plus its 2x4px vertical padding renders at ~42px tall. Wrapping onto a
    // second line pushes that comfortably past 55px; a still-clipped single
    // line would stay at/under the single-line height.
    expect(nameBox.height).toBeGreaterThan(55);

    await captureEvidence(page, testInfo, 'assigned-nutrition-plan-320-heading-wraps');
  });

  test('training plan name wraps instead of clipping mid-word at 320px', async ({
    page,
  }, testInfo: TestInfo) => {
    await chooseStudent(page);
    await page.goto('/student/training/plans/e2e-assigned-training-plan');
    await expect(page.getByTestId('student.training_plan.readOnlyNotice')).toBeVisible();

    const nameBox = await elementBox(page, 'pro.training_plan.name');
    expect(nameBox.height).toBeGreaterThan(55);

    await captureEvidence(page, testInfo, 'assigned-training-plan-320-heading-wraps');
  });
});

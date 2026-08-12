import { devices, expect, test, type Page } from '@playwright/test';

test.use({ ...devices['Pixel 5'] });

async function chooseProfessional(page: Page) {
  await page.goto('/auth/role-selection');
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
  await page.getByTestId('pro.specialty.cta_skip').click();
}

async function expectInsideViewport(page: Page, testId: string) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;

  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('@functional @feature:training exercise search opens within the Pixel 5 viewport', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await chooseProfessional(page);
  await page.goto('/professional/training/plans/e2e-assigned-training-plan');
  await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();

  await page.getByTestId('pro.training_plan.sessionRow.Assigned_Strength_Session.addItem').click();

  const dialog = page.getByTestId('exerciseSearch.modal');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expectInsideViewport(page, 'exerciseSearch.modal');
  await expectInsideViewport(page, 'exerciseSearch.input');
  await expect(page.getByTestId('exerciseSearch.input')).toBeFocused();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await testInfo.attach('exercise-search-initial', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });

  await page.getByTestId('exerciseSearch.input').fill('push');
  await page.getByTestId('exerciseSearch.input').press('Enter');
  await expect(page.getByTestId('exerciseSearch.result.e2e-exercise-push-up')).toBeVisible();
  await expectInsideViewport(page, 'exerciseSearch.result.e2e-exercise-push-up');

  await testInfo.attach('exercise-search-results', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });

  await dialog.getByText('Back', { exact: true }).click();
  await expect(dialog).toBeHidden();
});

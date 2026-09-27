import { expect, test } from '@playwright/test';

test.describe('opt-in exercise semantic suggestions', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('@feature:training keeps the opt-in action bounded and stale-safe', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto('/auth/role-selection');
    await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
    await page.getByTestId('auth.roleSelection.professionalCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
    await page.getByTestId('pro.specialty.cta_skip').click();
    await page.goto('/professional/training/plans/e2e-assigned-training-plan');
    await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();
    await page
      .getByTestId('pro.training_plan.sessionRow.Assigned_Strength_Session.addItem')
      .click();

    const dialog = page.getByRole('dialog');
    const input = page.getByTestId('exerciseSearch.input');
    const cta = page.getByTestId('exerciseSearch.semantic.cta');
    await expect(dialog).toBeVisible();

    // The action is available immediately after typing; it does not wait for
    // the ordinary 400 ms search debounce.
    await input.fill('push');
    await expect(cta).toBeVisible();
    await expect(page.getByTestId('exerciseSearch.semantic.disclosure')).toBeVisible();
    await cta.click();
    await expect(page.getByTestId('exerciseSearch.semantic.loading')).toBeVisible();
    await expect(page.getByTestId('exerciseSearch.loadingState')).toBeHidden();

    // Editing the query while the provider-shaped fixture is pending must
    // invalidate the old request before it can paint a result or badge.
    await input.fill('other');
    await page.waitForTimeout(250);
    await expect(page.getByTestId('exerciseSearch.semantic.loading')).toBeHidden();
    await expect(page.getByTestId('exerciseSearch.result.e2e-exercise-push-up')).toBeHidden();
    await expect(
      page.getByTestId('exerciseSearch.semantic.badge.e2e-exercise-push-up'),
    ).toBeHidden();

    // A completed suggestion leaves the ordinary spinner settled and marks
    // the selected catalog result accessibly.
    await input.fill('push');
    await cta.click();
    await expect(
      page.getByTestId('exerciseSearch.semantic.badge.e2e-exercise-push-up'),
    ).toBeVisible();
    await expect(page.getByTestId('exerciseSearch.semantic.loading')).toBeHidden();
    await expect(page.getByTestId('exerciseSearch.loadingState')).toBeHidden();
    await expect(page.getByTestId('exerciseSearch.result.e2e-exercise-push-up')).toHaveAttribute(
      'aria-label',
      /Suggested match/,
    );
    await testInfo.attach('exercise-search-semantic-suggested', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });

    await page.getByTestId('exerciseSearch.close').click();
    await expect(dialog).toBeHidden();
    await page
      .getByTestId('pro.training_plan.sessionRow.Assigned_Strength_Session.addItem')
      .click();
    await expect(page.getByTestId('exerciseSearch.initialState')).toBeVisible();
    await expect(
      page.getByTestId('exerciseSearch.semantic.badge.e2e-exercise-push-up'),
    ).toBeHidden();
  });
});

import { expect, test } from '@playwright/test';

test.describe('@functional platform fallbacks', () => {
  test('manual invite entry remains available when browser camera permission is denied', async ({
    browser,
  }) => {
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('student.home.accountButton').last().click();
    await expect(page.getByTestId('student.professionals.codeInput')).toBeVisible();
    await context.close();
  });

  test('web subscription surface fails closed when handoff is not configured', async ({ page }) => {
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.professionalCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('pro.specialty.cta_skip').click();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
    await page.getByTestId('pro.home.subscriptionCta').last().click();
    await expect(page.getByTestId('pro.subscription.purchaseCta')).toHaveCount(0);
    await expect(page.getByTestId('pro.subscription.capabilityUnavailable')).toBeVisible();
    await expect(
      page.getByText(
        'Subscription changes are not available in this browser right now. You can still refresh your status.'
      )
    ).toBeVisible();
    await expect(page.getByTestId('pro.subscription.restoreCta')).toHaveCount(0);
    await expect(page.getByTestId('pro.subscription.refreshCta')).toBeEnabled();
  });

  test('changing language updates the browser document language', async ({ page }) => {
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('tabs.account').last().click();
    await page.getByTestId('settings.account.languageRow').click();
    await page.getByTestId('settings.languageSelect.option.pt-BR').click();
    await page.getByTestId('settings.languageSelect.saveButton').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  });
});

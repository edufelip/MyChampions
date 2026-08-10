import { expect, test } from '@playwright/test';

const responsiveViewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1000 },
] as const;

test.describe('@critical @feature:auth @feature:connections @feature:subscription critical product paths', () => {
  for (const viewport of responsiveViewports) {
    test(`${viewport.name} student entry reaches manual connection fallback`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'Responsive critical proof is Chromium-only');
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');

      const continueButton = page.getByTestId('auth.roleSelection.continueButton');
      await expect(continueButton).toBeDisabled();
      await page.getByTestId('auth.roleSelection.studentCard').click();
      await expect(continueButton).toBeEnabled();
      await continueButton.click();
      await expect(page.getByTestId('student.home.ready').last()).toBeVisible();

      await page.getByTestId('student.home.accountButton').last().click();
      await expect(page.getByTestId('student.professionals.screen')).toBeVisible();
      await page.getByTestId('student.professionals.scanQrButton').click();
      await expect(page.getByTestId('student.professionals.submitError')).toBeVisible();
      await expect(page.getByTestId('student.professionals.codeInput')).toBeVisible();

      const inputBox = await page.getByTestId('student.professionals.codeInput').boundingBox();
      expect(inputBox).not.toBeNull();
      if (inputBox) {
        expect(inputBox.x).toBeGreaterThanOrEqual(0);
        expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1);
    });
  }

  test('professional subscription boundary remains fail-closed across browser engines', async ({
    page,
  }) => {
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.professionalCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('pro.specialty.cta_skip').click();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();

    await page.getByTestId('pro.home.subscriptionCta').last().click();
    await expect(page.getByTestId('pro.subscription.capabilityUnavailable')).toBeVisible();
    await expect(page.getByTestId('pro.subscription.purchaseCta')).toHaveCount(0);
    await expect(page.getByTestId('pro.subscription.restoreCta')).toHaveCount(0);
    await expect(page.getByTestId('pro.subscription.refreshCta')).toBeEnabled();
  });
});

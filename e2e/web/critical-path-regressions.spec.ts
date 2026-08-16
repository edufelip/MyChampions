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

  const documentedTodayRoutes = [
    { path: '/student/nutrition/today', screenTestId: 'student.nutrition.screen' },
    { path: '/student/training/today', screenTestId: 'student.training.screen' },
  ] as const;

  for (const viewport of responsiveViewports) {
    for (const { path, screenTestId } of documentedTodayRoutes) {
      test(`${viewport.name} documented deep link ${path} reaches the Student tracking screen, not Unmatched Route`, async ({
        page,
      }, testInfo) => {
        test.skip(
          testInfo.project.name !== 'chromium',
          'Responsive critical proof is Chromium-only',
        );
        await page.setViewportSize(viewport);
        await page.goto('/auth/role-selection');
        await page.getByTestId('auth.roleSelection.studentCard').click();
        await page.getByTestId('auth.roleSelection.continueButton').click();
        await expect(page.getByTestId('student.home.ready').last()).toBeVisible();

        // ET-109: documented screen-spec routes (SC-209/SC-210, TC-209/TC-210) must resolve
        // to the same Student tracking surfaces as their canonical /nutrition, /training
        // tab aliases instead of rendering Expo Router's Unmatched Route page.
        await page.goto(path);
        await expect(page.getByTestId('expo-router-unmatched')).toHaveCount(0);
        await expect(page.getByTestId(screenTestId)).toBeVisible();
        expect(page.url()).toContain(path);

        // Reloading the documented route must remain on the same screen.
        await page.reload();
        await expect(page.getByTestId('expo-router-unmatched')).toHaveCount(0);
        await expect(page.getByTestId(screenTestId)).toBeVisible();
        expect(page.url()).toContain(path);
      });
    }
  }

  test('professional session accessing a documented student /today deep link fails closed to the professional shell', async ({
    page,
  }) => {
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.professionalCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('pro.specialty.cta_skip').click();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();

    for (const { path } of documentedTodayRoutes) {
      await page.goto(path);
      await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
      await expect(page.getByTestId('expo-router-unmatched')).toHaveCount(0);
    }
  });
});

import { expect, test } from '@playwright/test';

async function chooseProfessional(page: import('@playwright/test').Page) {
  await page.goto('/auth/role-selection');
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
  await page.getByTestId('pro.specialty.add.nutritionist').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.add.fitness_coach').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.cta_continue').click();
  await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
}

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

const compactMobileViewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 720 },
] as const;

test.describe('@critical @feature:connections browser bulk deny confirmation', () => {
  for (const viewport of compactMobileViewports) {
    test(`${viewport.name} pending bulk deny confirms, cancels, and reports the result`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(120_000);
      test.skip(testInfo.project.name !== 'chromium', 'Mobile browser proof is Chromium-only');

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();

      try {
        await chooseProfessional(page);
        await page.goto('/professional/pending');
        await expect(page.getByTestId('pro.pending.screen')).toBeVisible();
        await expect(page.getByTestId('pro.pending.hero')).toContainText('1 pending');

        await page.getByTestId('pro.pending.row.0').click({ position: { x: 20, y: 20 } });
        await expect(page.getByTestId('pro.pending.bulkDenyButton')).toBeVisible();
        await page.getByTestId('pro.pending.bulkDenyButton').click();

        const dialog = page.getByTestId('pro.pending.bulkDenyConfirm');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('role', 'dialog');
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);
        await expect(dialog).toContainText('1 selected');
        await expect
          .poll(() =>
            page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid),
          )
          .toBe('pro.pending.bulkDenyConfirm.cancel');
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(`bulk-deny-confirmation-${viewport.name}.png`),
        });

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(page.getByText('1 selected')).toBeVisible();

        await page.getByTestId('pro.pending.bulkDenyButton').click();
        await expect(dialog).toBeVisible();
        await page.getByTestId('pro.pending.bulkDenyConfirm.cancel').click();
        await expect(dialog).toBeHidden();
        await expect(page.getByText('1 selected')).toBeVisible();

        await page.getByTestId('pro.pending.bulkDenyButton').click();
        await page.getByTestId('pro.pending.bulkDenyConfirm.confirm').click();
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId('pro.pending.bulkDenyResult')).toContainText(
          'Requests denied successfully.',
        );
        await expect(page.getByTestId('pro.pending.hero')).toContainText('0 pending');
        await expect(page.getByTestId('pro.pending.row.0')).toHaveCount(0);
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(`bulk-deny-success-${viewport.name}.png`),
        });
      } finally {
        await context.close();
      }
    });
  }
});

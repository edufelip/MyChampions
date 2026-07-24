import { expect, test, type Page } from '@playwright/test';

import { captureEvidence } from './support/evidence';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1000 },
  { name: 'desktop', width: 1440, height: 1000 },
];

async function openProfessionalSubscription(page: Page) {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await page.getByTestId('pro.specialty.cta_skip').click();
  await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
  await page.getByTestId('pro.home.subscriptionCta').last().click();
  await expect(page.getByTestId('pro.subscription.capabilityUnavailable')).toBeVisible();
  await expect(page.getByTestId('pro.subscription.purchaseCta')).toHaveCount(0);
  await expect(page.getByTestId('pro.subscription.restoreCta')).toHaveCount(0);
  await expect(page.getByTestId('pro.subscription.loading')).not.toBeVisible();
  await expect(page.getByTestId('pro.subscription.statusValue')).toContainText('Active');
  await expect(page.getByTestId('pro.subscription.capUsage')).toContainText('2 / 10');
  await expect(page.getByTestId('pro.subscription.warning')).toHaveCount(0);
}

test.describe('@evidence visual checkpoints', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} student onboarding and account shell`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');
      await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
      await captureEvidence(page, testInfo, `${viewport.name}-role-selection`);

      await page.getByTestId('auth.roleSelection.studentCard').click();
      await page.getByTestId('auth.roleSelection.continueButton').click();
      await expect(page.getByTestId('student.home.ready').last()).toBeVisible();
      await captureEvidence(page, testInfo, `${viewport.name}-student-home`);
      await page.getByTestId('tabs.account').last().click();
      await expect(page.getByTestId('settings.account.screen')).toBeVisible();
      await captureEvidence(page, testInfo, `${viewport.name}-student-account-shell`);
    });

    test(`${viewport.name} professional task dashboard`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');
      await page.getByTestId('auth.roleSelection.professionalCard').click();
      await page.getByTestId('auth.roleSelection.continueButton').click();
      await page.getByTestId('pro.specialty.cta_skip').click();
      const dashboard = page.getByTestId('pro.home.screen').last();
      await expect(dashboard).toBeVisible();
      await expect(dashboard.getByTestId('pro.home.planChangeNotification')).toBeVisible();
      await expect(dashboard.getByTestId('pro.home.attentionLoading')).toHaveCount(0);
      await expect(dashboard.getByTestId('pro.home.inviteSpecialtyRequired')).toBeVisible();
      await captureEvidence(page, testInfo, `${viewport.name}-professional-task-dashboard`);
    });
  }

  test('desktop professional subscription handoff unavailable', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openProfessionalSubscription(page);
    await page.goBack();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
    await captureEvidence(page, testInfo, 'desktop-professional-home');
    await page.getByTestId('pro.home.subscriptionCta').last().click();
    await expect(page.getByTestId('pro.subscription.capabilityUnavailable')).toBeVisible();
    await captureEvidence(page, testInfo, 'desktop-subscription-unavailable');
  });

  test('mobile professional subscription handoff unavailable', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openProfessionalSubscription(page);
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ).toBeLessThanOrEqual(1);
    await captureEvidence(page, testInfo, 'mobile-subscription-unavailable');
  });

  test('mobile manual invite fallback', async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      permissions: [],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('student.home.accountButton').last().click();
    await expect(page.getByTestId('student.professionals.codeInput')).toBeVisible();
    await captureEvidence(page, testInfo, 'mobile-manual-invite-fallback');
    await context.close();
  });
});

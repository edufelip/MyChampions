import { devices, expect, test, type Page } from '@playwright/test';

test.use({ ...devices['Pixel 5'] });

async function setUpProfessionalHome(page: Page) {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
  await page.getByTestId('pro.specialty.add.nutritionist').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await expect(page.getByTestId('pro.specialty.row.nutritionist')).toBeVisible();
  await page.getByTestId('pro.specialty.cta_continue').click();
  await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
  await expect(page.getByTestId('pro.home.inviteCodeValue')).toBeVisible();
}

test.describe('@critical @feature:professional invite-code rotation', () => {
  test('confirms, cancels, rotates exactly once, and reports redacted lifecycle events', async ({
    page,
  }, testInfo) => {
    const analyticsEvents: { name?: string; properties?: Record<string, unknown> }[] = [];
    await page.route('**/analytics/events', async (route) => {
      analyticsEvents.push(route.request().postDataJSON() as (typeof analyticsEvents)[number]);
      await route.fulfill({ status: 202, body: JSON.stringify({ accepted: true }) });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await setUpProfessionalHome(page);
    const code = page.getByTestId('pro.home.inviteCodeValue');
    const oldCode = await code.textContent();
    expect(oldCode).toBeTruthy();

    await page.getByTestId('pro.home.rotateCodeCta').click();
    const modal = page.getByTestId('pro.home.rotateCodeModal');
    await expect(modal).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Regenerate invite code?' })).toBeVisible();
    await expect(modal).toContainText('Your current code will be invalidated');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement?.closest('[data-testid="pro.home.rotateCodeModal"]') !== null,
        ),
      )
      .toBe(true);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('invite-code-rotation-confirmation-mobile-390.png'),
    });

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(code).toHaveText(oldCode as string);

    await page.setViewportSize({ width: 412, height: 915 });
    await page.getByTestId('pro.home.rotateCodeCta').click();
    await expect(modal).toBeVisible();
    await page.getByTestId('pro.home.rotateCodeConfirmCta').click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('pro.home.rotateCodeSuccess')).toBeVisible();
    await expect(code).toHaveText(/E2E-[A-Z0-9]+/);
    await expect(code).not.toHaveText(oldCode as string);
    await expect(page.getByRole('button', { name: '0 Connection requests' })).toBeVisible();
    await expect(
      page.locator('[data-testid="pro.home.connectionRequestTask"]:visible'),
    ).toHaveCount(0);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('invite-code-rotation-success-mobile-412.png'),
    });

    await expect
      .poll(() => analyticsEvents.map((event) => event.name))
      .toEqual(
        expect.arrayContaining([
          'invite.rotation.requested',
          'invite.rotation.canceled',
          'invite.rotation.succeeded',
        ]),
      );
    expect(JSON.stringify(analyticsEvents)).not.toContain(oldCode as string);
    const rotationRequests = analyticsEvents.filter(
      (event) => event.name === 'invite.rotation.requested',
    );
    const rotationSuccesses = analyticsEvents.filter(
      (event) => event.name === 'invite.rotation.succeeded',
    );
    expect(rotationRequests).toHaveLength(2);
    expect(rotationSuccesses).toHaveLength(1);
  });

  test('blocks invite-code rotation while offline with explicit write-lock feedback', async ({
    page,
  }, testInfo) => {
    const analyticsEvents: { name?: string; properties?: Record<string, unknown> }[] = [];
    await page.route('**/analytics/events', async (route) => {
      analyticsEvents.push(route.request().postDataJSON() as (typeof analyticsEvents)[number]);
      await route.fulfill({ status: 202, body: JSON.stringify({ accepted: true }) });
    });

    await setUpProfessionalHome(page);
    await page.evaluate(() => {
      sessionStorage.setItem('mychampions.e2e.network-status', 'offline');
      window.dispatchEvent(new Event('mychampions.e2e.network-status-change'));
    });

    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
    await expect(page.locator('[data-testid="pro.home.offlineBanner"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="pro.home.rotateCodeOfflineLock"]:visible')).toHaveText(
      'Connect to the internet to save changes.',
    );
    const rotate = page.locator('[data-testid="pro.home.rotateCodeCta"]:visible');
    await expect(rotate).toBeDisabled();
    await expect(page.getByTestId('pro.home.rotateCodeModal')).toHaveCount(0);
    expect(analyticsEvents.some((event) => event.name === 'invite.rotation.requested')).toBe(false);

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('invite-code-rotation-offline-lock-mobile-390.png'),
    });
  });

  test('going offline while the rotation modal is open disables confirm with feedback, not a silent no-op', async ({
    page,
  }, testInfo) => {
    const analyticsEvents: { name?: string; properties?: Record<string, unknown> }[] = [];
    await page.route('**/analytics/events', async (route) => {
      analyticsEvents.push(route.request().postDataJSON() as (typeof analyticsEvents)[number]);
      await route.fulfill({ status: 202, body: JSON.stringify({ accepted: true }) });
    });

    await setUpProfessionalHome(page);
    const code = page.getByTestId('pro.home.inviteCodeValue');
    const oldCode = await code.textContent();

    await page.getByTestId('pro.home.rotateCodeCta').click();
    const modal = page.getByTestId('pro.home.rotateCodeModal');
    await expect(modal).toBeVisible();

    await page.evaluate(() => {
      sessionStorage.setItem('mychampions.e2e.network-status', 'offline');
      window.dispatchEvent(new Event('mychampions.e2e.network-status-change'));
    });

    await expect(page.getByTestId('pro.home.rotateCodeModal.offlineLock')).toHaveText(
      'Connect to the internet to save changes.',
    );
    await expect(page.getByTestId('pro.home.rotateCodeConfirmCta')).toBeDisabled();
    await expect(page.getByTestId('pro.home.rotateCodeCancelCta')).toBeEnabled();

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('invite-code-rotation-offline-mid-flow-mobile-390.png'),
    });

    await page.getByTestId('pro.home.rotateCodeCancelCta').click();
    await expect(modal).toBeHidden();
    await expect(code).toHaveText(oldCode as string);
    expect(analyticsEvents.some((event) => event.name === 'invite.rotation.succeeded')).toBe(false);
  });
});

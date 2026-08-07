import { expect, test, type Page } from '@playwright/test';

import { captureEvidence } from '../web/support/evidence';

async function expectReadyStudentHome(page: Page) {
  const home = page.getByTestId('student.home.screen').last();
  await expect(home).toBeVisible();
  await expect(home.getByTestId('student.home.ready')).toBeVisible();
  await expect(home.getByTestId('student.home.error')).toHaveCount(0);
  await expect(home.getByTestId('student.home.dashboardTitle')).toHaveText('Your day');
  await expect(home.getByTestId('student.home.accountButton')).toBeVisible();
}

test.describe('@server-auth @critical @feature:auth browser cookie session', () => {
  test('creates an account, restores rotated cookie auth, signs in again, and logs out', async ({
    context,
    page,
  }, testInfo) => {
    const email = `web-${testInfo.project.name}@example.test`;
    const password = 'StrongPassword1!';

    await page.goto('/auth/create-account');
    await page.getByTestId('auth.createAccount.nameInput').fill(`Web ${testInfo.project.name}`);
    await page.getByTestId('auth.createAccount.emailInput').fill(email);
    await page.getByTestId('auth.createAccount.passwordInput').fill(password);
    await page.getByTestId('auth.createAccount.passwordConfirmationInput').fill(password);
    await page.getByTestId('auth.createAccount.submitButton').click();

    await expect(page.getByTestId('auth.terms.screen')).toBeVisible();
    await page.getByTestId('auth.terms.checkbox').click();
    await page.getByTestId('auth.terms.acceptButton').click();
    await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await expectReadyStudentHome(page);

    const initialCookie = (await context.cookies()).find(
      (cookie) => cookie.name === 'mychampions_refresh_token'
    );
    expect(initialCookie).toMatchObject({
      httpOnly: true,
      path: '/auth/session',
      sameSite: 'Lax',
      secure: false,
    });
    const browserStorage = await page.evaluate(() => ({
      localStorage: Object.values(localStorage),
      sessionStorage: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(browserStorage)).not.toContain('refreshToken');
    expect(JSON.stringify(browserStorage)).not.toContain(initialCookie?.value ?? '__missing__');

    await page.reload();
    await expectReadyStudentHome(page);
    const rotatedCookie = (await context.cookies()).find(
      (cookie) => cookie.name === 'mychampions_refresh_token'
    );
    expect(rotatedCookie?.value).toBeTruthy();
    expect(rotatedCookie?.value).not.toBe(initialCookie?.value);
    await captureEvidence(page, testInfo, 'server-auth-restored-student-home');

    await page.getByTestId('tabs.account').last().click();
    await page.getByTestId('settings.account.signOutCta').click();
    await page.getByTestId('settings.account.signOutConfirmCta').click();
    await expect(page.getByTestId('auth.signIn.title')).toBeVisible();
    expect(
      (await context.cookies()).some((cookie) => cookie.name === 'mychampions_refresh_token')
    ).toBe(false);

    await page.getByTestId('auth.signIn.emailInput').fill(email);
    await page.getByTestId('auth.signIn.passwordInput').fill(password);
    await page.getByTestId('auth.signIn.submitButton').click();
    await expectReadyStudentHome(page);
    await page.reload();
    await expectReadyStudentHome(page);

    await page.getByTestId('tabs.account').last().click();
    await page.getByTestId('settings.account.signOutCta').click();
    await page.getByTestId('settings.account.signOutConfirmCta').click();
    await expect(page.getByTestId('auth.signIn.title')).toBeVisible();
  });
});

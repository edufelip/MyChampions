import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureFlowEvidence } from '../web/support/evidence';

async function capture(page: Page, testInfo: TestInfo, checkpoint: string, testId: string) {
  await expect(page.getByTestId(testId).last()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await captureFlowEvidence(page, testInfo, '00-authentication-and-terms', checkpoint);
}

test.describe('@flow-atlas @feature:auth authentication and terms', () => {
  test('email sign-in validation and terms continuation', async ({ page }, testInfo) => {
    await page.goto('/auth/sign-in');
    await capture(page, testInfo, '01-sign-in', 'auth.signIn.title');
    await page.getByTestId('auth.signIn.submitButton').click();
    await capture(page, testInfo, '02-sign-in-validation', 'auth.signIn.error.emailRequired');

    await page.getByTestId('auth.signIn.emailInput').fill('e2e-auth-session@example.test');
    await page.getByTestId('auth.signIn.passwordInput').fill('E2E-password-123!');
    await page.getByTestId('auth.signIn.submitButton').click();
    const termsRadii = await page.evaluate(() => {
      const readRadius = (testId: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        return element ? Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) : null;
      };
      return {
        card: readRadius('auth.terms.card'),
        link: readRadius('auth.terms.openLinkButton'),
        checkbox: readRadius('auth.terms.checkbox.control'),
      };
    });
    expect(termsRadii).toEqual({ card: 16, link: 12, checkbox: 6 });
    await capture(page, testInfo, '03-required-terms', 'auth.terms.screen');
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('checkbox')).toHaveAccessibleName(
      'I have read and agree with the terms and privacy policy.',
    );
    await page.getByTestId('auth.terms.openLinkButton').click();
    await expect(page.getByTestId('shared.webview.screen')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('auth.terms.screen')).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('checkbox').focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('auth.terms.checkbox').dispatchEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
      repeat: true,
    });
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('auth.terms.checkbox').click();
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await capture(page, testInfo, '04-terms-ready-to-accept', 'auth.terms.acceptButton');
  });

  test('create-account validation and social provider entry', async ({ page }, testInfo) => {
    await page.goto('/auth/create-account');
    await expect(page.getByTestId('auth.createAccount.backButton')).toBeInViewport();
    await expect(page.getByTestId('auth.createAccount.backToSignInButton')).toBeVisible();
    await capture(page, testInfo, '05-create-account', 'auth.createAccount.screen');
    await page.getByTestId('auth.createAccount.submitButton').click();
    await capture(
      page,
      testInfo,
      '06-create-account-validation',
      'auth.createAccount.error.nameRequired',
    );
    await capture(page, testInfo, '07-google-and-apple-entry', 'auth.createAccount.googleButton');
    await page.getByTestId('auth.createAccount.backToSignInButton').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('auth.createAccount.backToSignInButton')).toBeInViewport();
    await page.getByTestId('auth.createAccount.backToSignInButton').click();
    await expect(page.getByTestId('auth.signIn.title')).toBeVisible();
  });

  test('Google social authentication reaches terms', async ({ page }, testInfo) => {
    await page.goto('/auth/sign-in');
    await page.getByTestId('auth.signIn.googleButton').click();
    await capture(page, testInfo, '08-google-authentication-terms', 'auth.terms.screen');
  });

  test('Apple social authentication reaches terms', async ({ page }, testInfo) => {
    await page.goto('/auth/sign-in');
    await page.getByTestId('auth.signIn.appleButton').click();
    await capture(page, testInfo, '09-apple-authentication-terms', 'auth.terms.screen');
  });

  test('valid account creation reaches terms', async ({ page }, testInfo) => {
    await page.goto('/auth/create-account');
    await page.getByTestId('auth.createAccount.nameInput').fill('Flow Atlas User');
    await page
      .getByTestId('auth.createAccount.emailInput')
      .fill('e2e-created-account@example.test');
    await page.getByTestId('auth.createAccount.passwordInput').fill('E2E-create-123!');
    await page.getByTestId('auth.createAccount.passwordConfirmationInput').fill('E2E-create-123!');
    await page.getByTestId('auth.createAccount.submitButton').click();
    await capture(page, testInfo, '10-create-account-terms', 'auth.terms.screen');
  });

  test('auth entry screens fit a narrow mobile viewport', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'The narrow viewport check is mobile-only.');
    for (const viewport of [
      { width: 320, height: 720, suffix: 'narrow' },
      { width: 390, height: 844, suffix: '390' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto('/auth/sign-in');
      await capture(page, testInfo, `11-${viewport.suffix}-sign-in`, 'auth.signIn.title');
      await expect(page.getByTestId('auth.signIn.title')).toBeVisible();
      const signInPasswordToggle = page.getByTestId('auth.signIn.passwordToggle');
      await expect(signInPasswordToggle).toHaveAccessibleName('Show password');
      await expect
        .poll(() =>
          signInPasswordToggle.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { height: rect.height, width: rect.width };
          }),
        )
        .toEqual({ height: 44, width: 44 });
      await signInPasswordToggle.click();
      await expect(signInPasswordToggle).toHaveAccessibleName('Hide password');
      await expect(page.getByTestId('auth.signIn.passwordInput')).toHaveJSProperty('type', 'text');

      await page.goto('/auth/create-account');
      await capture(
        page,
        testInfo,
        `12-${viewport.suffix}-create-account`,
        'auth.createAccount.title',
      );
      await expect(page.getByTestId('auth.createAccount.title')).toBeVisible();
      await expect(page.getByTestId('auth.createAccount.backButton')).toBeInViewport();
      for (const [testId, inputTestId] of [
        ['auth.createAccount.passwordToggle', 'auth.createAccount.passwordInput'],
        [
          'auth.createAccount.passwordConfirmationToggle',
          'auth.createAccount.passwordConfirmationInput',
        ],
      ] as const) {
        const passwordToggle = page.getByTestId(testId);
        await expect(passwordToggle).toHaveAccessibleName('Show password');
        await expect
          .poll(() =>
            passwordToggle.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { height: rect.height, width: rect.width };
            }),
          )
          .toEqual({ height: 44, width: 44 });
        await passwordToggle.click();
        await expect(passwordToggle).toHaveAccessibleName('Hide password');
        await expect(page.getByTestId(inputTestId)).toHaveJSProperty('type', 'text');
      }
      if (viewport.width === 390) {
        await expect(page.getByTestId('auth.createAccount.backToSignInButton')).toBeInViewport();
      }
    }
  });
});

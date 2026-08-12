import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { enUS } from '../../localization/en-US';
import { esES } from '../../localization/es-ES';
import { ptBR } from '../../localization/pt-BR';
import { captureFlowEvidence } from '../web/support/evidence';

function authAccessibleCopy(testInfo: TestInfo) {
  const bundle =
    testInfo.project.use.locale === 'pt-BR'
      ? ptBR
      : testInfo.project.use.locale === 'es-ES'
        ? esES
        : enUS;

  return {
    back: bundle['auth.role.cta_back'],
    termsCheckbox: bundle['auth.terms.checkbox'],
    showPassword: bundle['auth.password.toggle_show'],
    hidePassword: bundle['auth.password.toggle_hide'],
  };
}

async function capture(page: Page, testInfo: TestInfo, checkpoint: string, testId: string) {
  await expect(page.getByTestId(testId).last()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await captureFlowEvidence(page, testInfo, '00-authentication-and-terms', checkpoint);
}

test.describe('@flow-atlas @feature:auth authentication and terms', () => {
  test('email sign-in validation and terms continuation', async ({ page }, testInfo) => {
    const copy = authAccessibleCopy(testInfo);
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
    await expect(page.getByRole('checkbox')).toHaveAccessibleName(copy.termsCheckbox);
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
    test.skip(
      !testInfo.project.name.startsWith('mobile-auth'),
      'The narrow viewport check is mobile-only.',
    );
    const copy = authAccessibleCopy(testInfo);
    for (const viewport of [
      { width: 320, height: 720, suffix: 'narrow' },
      { width: 390, height: 844, suffix: '390' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto('/auth/sign-in');
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      await capture(page, testInfo, `11-${viewport.suffix}-sign-in`, 'auth.signIn.title');
      await expect(page.getByTestId('auth.signIn.title')).toBeVisible();
      for (const testId of [
        'auth.signIn.submitButton',
        'auth.signIn.googleButton',
        'auth.signIn.appleButton',
      ]) {
        await expect
          .poll(() =>
            page.getByTestId(testId).evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0;
            }),
          )
          .toBe(true);
      }
      const signInEmail = page.getByTestId('auth.signIn.emailInput');
      const restingEmailBorder = await signInEmail.evaluate(
        (element) => getComputedStyle(element).borderTopColor,
      );
      await signInEmail.focus();
      await expect
        .poll(() => signInEmail.evaluate((element) => getComputedStyle(element).borderTopColor))
        .not.toBe(restingEmailBorder);
      await page.getByTestId('auth.signIn.submitButton').click();
      await expect(page.getByTestId('auth.signIn.error.emailRequired')).toBeVisible();
      const signInPasswordToggle = page.getByTestId('auth.signIn.passwordToggle');
      await expect(signInPasswordToggle).toHaveAccessibleName(copy.showPassword);
      await expect
        .poll(() =>
          signInPasswordToggle.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { height: rect.height, width: rect.width };
          }),
        )
        .toEqual({ height: 44, width: 44 });
      await signInPasswordToggle.click();
      await expect(signInPasswordToggle).toHaveAccessibleName(copy.hidePassword);
      await expect(page.getByTestId('auth.signIn.passwordInput')).toHaveJSProperty('type', 'text');

      await page.goto('/auth/create-account');
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      await capture(
        page,
        testInfo,
        `12-${viewport.suffix}-create-account`,
        'auth.createAccount.title',
      );
      await expect(page.getByTestId('auth.createAccount.title')).toBeVisible();
      await expect(page.getByTestId('auth.createAccount.backButton')).toHaveAccessibleName(
        copy.back,
      );
      for (const testId of [
        'auth.createAccount.backButton',
        'auth.createAccount.submitButton',
        'auth.createAccount.googleButton',
        'auth.createAccount.appleButton',
      ]) {
        await expect
          .poll(() =>
            page.getByTestId(testId).evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0;
            }),
          )
          .toBe(true);
      }
      const createAccountName = page.getByTestId('auth.createAccount.nameInput');
      const restingNameBorder = await createAccountName.evaluate(
        (element) => getComputedStyle(element).borderTopColor,
      );
      await createAccountName.focus();
      await expect
        .poll(() =>
          createAccountName.evaluate((element) => getComputedStyle(element).borderTopColor),
        )
        .not.toBe(restingNameBorder);
      await page.getByTestId('auth.createAccount.submitButton').click();
      await expect(page.getByTestId('auth.createAccount.error.nameRequired')).toBeVisible();
      for (const [testId, inputTestId] of [
        ['auth.createAccount.passwordToggle', 'auth.createAccount.passwordInput'],
        [
          'auth.createAccount.passwordConfirmationToggle',
          'auth.createAccount.passwordConfirmationInput',
        ],
      ] as const) {
        const passwordToggle = page.getByTestId(testId);
        await expect(passwordToggle).toHaveAccessibleName(copy.showPassword);
        await expect
          .poll(() =>
            passwordToggle.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { height: rect.height, width: rect.width };
            }),
          )
          .toEqual({ height: 44, width: 44 });
        await passwordToggle.click();
        await expect(passwordToggle).toHaveAccessibleName(copy.hidePassword);
        await expect(page.getByTestId(inputTestId)).toHaveJSProperty('type', 'text');
      }
      if (viewport.width === 390) {
        await expect(page.getByTestId('auth.createAccount.backToSignInButton')).toBeInViewport();
      }
    }
  });
});

import { expect, test } from '@playwright/test';

// ET-162: a rapid triple-click on the sign-in "Sign In" button must not fire more than
// one POST /auth/email/sign-in request. The DOM `disabled` attribute on the submit
// button only reflects the async React "submitting" state, so it can still read
// `false` in the instant right after the clicks land (see the ticket's evidence) —
// what actually has to hold the line is the synchronous client-side submission gate
// (features/auth/auth-submission-gate.ts) that `onEmailPasswordSignIn` acquires before
// making the network call. This spec proves the request count, not the DOM attribute.
test.describe('@server-auth @critical @feature:auth sign-in double-submit guard', () => {
  test('rapid triple-click on Sign In fires exactly one sign-in request', async ({
    page,
  }, testInfo) => {
    const email = `et162-double-submit-${testInfo.project.name}@example.test`;
    const password = 'StrongPassword1!';

    await page.goto('/auth/create-account');
    await page.getByTestId('auth.createAccount.nameInput').fill('ET162 Double Submit');
    await page.getByTestId('auth.createAccount.emailInput').fill(email);
    await page.getByTestId('auth.createAccount.passwordInput').fill(password);
    await page.getByTestId('auth.createAccount.passwordConfirmationInput').fill(password);
    await page.getByTestId('auth.createAccount.submitButton').click();
    await expect(page.getByTestId('auth.terms.screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('auth.terms.checkbox').click();
    await page.getByTestId('auth.terms.acceptButton').click();
    await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await expect(page.getByTestId('student.home.screen').last()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('tabs.account').last().click();
    await page.getByTestId('settings.account.signOutCta').click();
    await page.getByTestId('settings.account.signOutConfirmCta').click();
    await expect(page.getByTestId('auth.signIn.title')).toBeVisible();

    const signInRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/auth/email/sign-in') && req.method() === 'POST') {
        signInRequests.push(req.url());
      }
    });

    await page.getByTestId('auth.signIn.emailInput').fill(email);
    await page.getByTestId('auth.signIn.passwordInput').fill(password);

    // Fire three back-to-back clicks synchronously in the page, mirroring the ticket's
    // repro (no delay between clicks, disabled-state race included).
    await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(
        '[data-testid="auth.signIn.submitButton"]',
      );
      button?.click();
      button?.click();
      button?.click();
    });

    await expect(page.getByTestId('student.home.screen').last()).toBeVisible({ timeout: 15_000 });
    expect(signInRequests.length).toBe(1);
  });
});

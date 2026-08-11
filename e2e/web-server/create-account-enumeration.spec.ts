import { expect, test, type Page } from '@playwright/test';
import { captureEvidence } from '../web/support/evidence';

async function expectReadyStudentHome(page: Page) {
  const home = page.getByTestId('student.home.screen').last();
  await expect(home).toBeVisible();
  await expect(home.getByTestId('student.home.ready')).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByTestId('tabs.account').last().click();
  await page.getByTestId('settings.account.signOutCta').click();
  await page.getByTestId('settings.account.signOutConfirmCta').click();
  await expect(page.getByTestId('auth.signIn.title')).toBeVisible();
}

test.describe('@server-auth @critical @feature:auth create-account enumeration (ET-75)', () => {
  test('signup responds the same way for a new email and a duplicate one, and never logs an impostor in', async ({
    page,
  }, testInfo) => {
    const email = `enum-${testInfo.project.name}-${Date.now()}@example.test`;
    const realPassword = 'RealPassword1!';
    const guessedPassword = 'GuessedPassword2!';

    const createAccountResponses: { url: string; status: number; body: unknown }[] = [];
    page.on('response', (response) => {
      if (response.url().endsWith('/auth/email/create-account')) {
        void response
          .json()
          .catch(() => null)
          .then((body) => {
            createAccountResponses.push({ url: response.url(), status: response.status(), body });
          });
      }
    });

    // Step 1: a genuine new signup. It should still feel exactly like an
    // immediate login to the user — create-account chains into a real sign-in
    // with the credentials just submitted (ET-75 fix), so this should sail
    // through to terms/role-selection precisely as it did before the fix.
    await page.goto('/auth/create-account');
    await page.getByTestId('auth.createAccount.nameInput').fill(`Enum ${testInfo.project.name}`);
    await page.getByTestId('auth.createAccount.emailInput').fill(email);
    await page.getByTestId('auth.createAccount.passwordInput').fill(realPassword);
    await page.getByTestId('auth.createAccount.passwordConfirmationInput').fill(realPassword);
    await captureEvidence(page, testInfo, 'et75-01-new-signup-filled');
    await page.getByTestId('auth.createAccount.submitButton').click();

    await expect(page.getByTestId('auth.terms.screen')).toBeVisible();
    await captureEvidence(page, testInfo, 'et75-02-new-signup-success-reaches-terms');
    await page.getByTestId('auth.terms.checkbox').click();
    await page.getByTestId('auth.terms.acceptButton').click();
    await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await expectReadyStudentHome(page);
    await signOut(page);

    // Step 2: an attacker (or just a confused returning user) tries to "sign
    // up" again with the same email and a different, guessed password. Before
    // the fix this returned 409 duplicate_email and a distinct error message.
    // After the fix it must look identical over the wire to a fresh signup,
    // and the UI must show a generic message that does not confirm the email
    // was already registered.
    await page.goto('/auth/create-account');
    await page
      .getByTestId('auth.createAccount.nameInput')
      .fill(`Impostor ${testInfo.project.name}`);
    await page.getByTestId('auth.createAccount.emailInput').fill(email);
    await page.getByTestId('auth.createAccount.passwordInput').fill(guessedPassword);
    await page.getByTestId('auth.createAccount.passwordConfirmationInput').fill(guessedPassword);
    await captureEvidence(page, testInfo, 'et75-03-duplicate-signup-filled');
    await page.getByTestId('auth.createAccount.submitButton').click();

    const submitError = page.getByTestId('auth.createAccount.error.submit');
    await expect(submitError).toBeVisible();
    const errorText = (await submitError.textContent())?.toLowerCase() ?? '';
    expect(errorText).toContain('sign-in screen');
    expect(errorText).not.toContain('already registered');
    expect(errorText).not.toContain('already in use');
    expect(errorText).not.toContain('duplicate');
    // Still on create-account: the guessed password must not have signed
    // anyone in or reached terms/role-selection.
    await expect(page.getByTestId('auth.createAccount.screen')).toBeVisible();
    await expect(page.getByTestId('auth.terms.screen')).toHaveCount(0);
    await captureEvidence(page, testInfo, 'et75-04-duplicate-signup-generic-message');

    // Network-level proof: both create-account calls returned the identical
    // status/body pair, regardless of which one was the "real" new signup.
    expect(createAccountResponses).toHaveLength(2);
    expect(createAccountResponses[0]?.status).toBe(202);
    expect(createAccountResponses[1]?.status).toBe(202);
    expect(createAccountResponses[0]?.status).toBe(createAccountResponses[1]?.status);
    expect(createAccountResponses[0]?.body).toEqual({ status: 'accepted' });
    expect(createAccountResponses[1]?.body).toEqual(createAccountResponses[0]?.body);

    // Step 3: the original account is untouched — it still signs in with its
    // real password, proving the duplicate attempt did not overwrite it.
    await page.getByTestId('auth.createAccount.backToSignInButton').click();
    await expect(page.getByTestId('auth.signIn.title')).toBeVisible();
    await page.getByTestId('auth.signIn.emailInput').fill(email);
    await page.getByTestId('auth.signIn.passwordInput').fill(realPassword);
    await page.getByTestId('auth.signIn.submitButton').click();
    await expectReadyStudentHome(page);
    await captureEvidence(page, testInfo, 'et75-05-original-account-still-signs-in');

    // And the guessed password from the duplicate attempt must not work either.
    await signOut(page);
    await page.getByTestId('auth.signIn.emailInput').fill(email);
    await page.getByTestId('auth.signIn.passwordInput').fill(guessedPassword);
    await page.getByTestId('auth.signIn.submitButton').click();
    await expect(page.getByTestId('auth.signIn.error.submit')).toBeVisible();
  });
});

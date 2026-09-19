import { expect, test, type Page } from '@playwright/test';
import { captureEvidence } from '../web/support/evidence';

async function signInAsNewStudent(page: Page, email: string) {
  await page.goto('/auth/create-account');
  await page.getByTestId('auth.createAccount.nameInput').fill('Support Rate Limit');
  await page.getByTestId('auth.createAccount.emailInput').fill(email);
  await page.getByTestId('auth.createAccount.passwordInput').fill('StrongPassword1!');
  await page.getByTestId('auth.createAccount.passwordConfirmationInput').fill('StrongPassword1!');
  await page.getByTestId('auth.createAccount.submitButton').click();
  await expect(page.getByTestId('auth.terms.screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('auth.terms.checkbox').click();
  await page.getByTestId('auth.terms.acceptButton').click();
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId('auth.roleSelection.studentCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('student.home.screen').last()).toBeVisible();
}

async function submitSupportMessage(page: Page, sequence: number) {
  await page.getByTestId('settings.account.supportQuickCta').click();
  await page.getByTestId('settings.account.support.subjectInput').fill(`Login issue ${sequence}`);
  await page
    .getByTestId('settings.account.support.bodyInput')
    .fill(`Server-backed support message ${sequence}.`);
  await page.getByTestId('settings.account.support.submitCta').click();
}

test.describe('@server-auth @critical @feature:support server-backed rate limiting', () => {
  test('preserves the fourth draft and starts a visible cooldown after three accepted submissions', async ({
    page,
  }, testInfo) => {
    await signInAsNewStudent(page, `support-rate-limit-${testInfo.project.name}@example.test`);
    await page.getByTestId('tabs.account').last().click();

    for (const sequence of [1, 2, 3]) {
      await submitSupportMessage(page, sequence);
      await expect(page.getByTestId('settings.account.support.success')).toBeVisible();
      await page.getByTestId('settings.account.support.closeButton').click();
      await expect(page.getByTestId('settings.account.support.modal')).toHaveCount(0);
    }

    await page.getByTestId('settings.account.supportQuickCta').click();
    const subject = page.getByTestId('settings.account.support.subjectInput');
    const body = page.getByTestId('settings.account.support.bodyInput');
    await subject.fill('Fourth message remains drafted');
    await body.fill('The server must retain this draft while the cooldown is active.');
    await page.getByTestId('settings.account.support.submitCta').click();

    const cooldown = page.getByTestId('settings.account.support.cooldownBanner');
    await expect(cooldown).toBeVisible();
    await expect(cooldown).toContainText(/Please wait (8\d{2}|900) seconds/);
    await expect(subject).toHaveValue('Fourth message remains drafted');
    await expect(body).toHaveValue(
      'The server must retain this draft while the cooldown is active.',
    );
    await expect(page.getByTestId('settings.account.support.submitCta')).toBeDisabled();

    await page.getByTestId('settings.account.support.closeButton').click();
    await expect(page.getByTestId('settings.account.support.modal')).toHaveCount(0);
    await page.getByTestId('settings.account.supportQuickCta').click();
    await expect(cooldown).toBeVisible();
    await expect(subject).toHaveValue('Fourth message remains drafted');
    await expect(body).toHaveValue(
      'The server must retain this draft while the cooldown is active.',
    );
    await expect(page.getByTestId('settings.account.support.submitCta')).toBeDisabled();
    await captureEvidence(page, testInfo, 'support-rate-limit-cooldown');
  });
});

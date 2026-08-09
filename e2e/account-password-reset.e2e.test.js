const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

async function openAccountTab() {
  await element(by.id('tabs.account')).tap();
  await waitFor(element(by.id('settings.account.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

describeWithE2EAuthSession('Account Password Reset', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('confirms and completes password reset for an email/password user', async () => {
    await selectStudentRole();
    await openAccountTab();

    await element(by.id('settings.account.changePasswordRow')).tap();
    await waitFor(element(by.id('settings.account.passwordConfirm')))
      .toBeVisible()
      .withTimeout(5000);
    await expect(element(by.text('Reset password?'))).toBeVisible();
    await expect(
      element(
        by.text(
          "We'll send a password reset link to e2e-auth-session@example.test. Check your inbox after confirming.",
        ),
      ),
    ).toBeVisible();

    await element(by.id('settings.account.passwordConfirmCta')).tap();
    await waitFor(element(by.id('settings.account.passwordSuccess')))
      .toBeVisible()
      .withTimeout(5000);
    await expect(element(by.text('Password reset email sent. Check your inbox.'))).toBeVisible();
  });
});

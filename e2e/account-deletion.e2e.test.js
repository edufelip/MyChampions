const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
}

async function openAccountTab() {
  await element(by.id('tabs.account')).tap();
  await waitFor(element(by.id('settings.account.screen'))).toBeVisible().withTimeout(10000);
}

async function scrollToDeleteCta() {
  await element(by.id('settings.account.signOutCta')).swipe('up', 'fast', 0.9);
  await waitFor(element(by.id('settings.account.termsRow'))).toBeVisible().withTimeout(5000);
  await element(by.id('settings.account.termsRow')).swipe('up', 'fast', 0.9);
  await waitFor(element(by.id('settings.account.deleteCta'))).toBeVisible().withTimeout(5000);
}

describeWithE2EAuthSession('Account Deletion', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('requires confirmation and signs out after account deletion', async () => {
    await selectStudentRole();
    await openAccountTab();
    await scrollToDeleteCta();
    await new Promise((resolve) => setTimeout(resolve, 750));

    await element(by.id('settings.account.deleteCta')).tapAtPoint({ x: 180, y: 24 });
    await waitFor(element(by.id('settings.account.deleteConfirm'))).toBeVisible().withTimeout(5000);
    await expect(element(by.text('Delete your account?'))).toBeVisible();
    await expect(element(by.text('This action is irreversible. Your personal information will be removed. Anonymized history may be retained for legal, billing, and continuity requirements.'))).toBeVisible();

    await element(by.id('settings.account.deleteCancelCta')).tap();
    await waitFor(element(by.id('settings.account.deleteConfirm'))).not.toBeVisible().withTimeout(5000);

    await element(by.id('settings.account.deleteCta')).tapAtPoint({ x: 180, y: 24 });
    await waitFor(element(by.id('settings.account.deleteConfirm'))).toBeVisible().withTimeout(5000);
    await element(by.id('settings.account.deleteConfirmCta')).tap();
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(10000);
  });
});

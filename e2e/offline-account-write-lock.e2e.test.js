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

describeWithE2EAuthSession('Offline Account Write Lock', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true, delete: true });
    await device.disableSynchronization();
  });

  it('shows the offline banner and blocks account deletion confirmation', async () => {
    await selectStudentRole();
    await openAccountTab();

    await waitFor(element(by.id('settings.account.offlineBanner'))).toBeVisible().withTimeout(5000);

    await scrollToDeleteCta();
    await element(by.id('settings.account.deleteCta')).tapAtPoint({ x: 180, y: 24 });
    await expect(element(by.id('settings.account.deleteConfirm'))).not.toBeVisible();
  });
});

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

describeWithE2EAuthSession('Support Request', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true, delete: true });
    await device.disableSynchronization();
  });

  it('validates and submits an in-app support request', async () => {
    await selectStudentRole();
    await openAccountTab();

    await element(by.id('settings.account.supportQuickCta')).tap();
    await waitFor(element(by.id('settings.account.support.modal'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('settings.account.support.subjectInput'))).toBeVisible();
    await expect(element(by.id('settings.account.support.bodyInput'))).toBeVisible();
    await waitFor(element(by.id('settings.account.support.submitCta'))).toBeVisible().withTimeout(5000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    await element(by.id('settings.account.support.submitCta')).tap();
    await waitFor(element(by.id('settings.account.support.subjectError'))).toBeVisible().withTimeout(5000);

    await element(by.id('settings.account.support.subjectInput')).replaceText('E2E support issue');
    await element(by.id('settings.account.support.bodyInput')).replaceText('The support request flow should submit safely.');
    await element(by.id('settings.account.support.submitCta')).tap();

    await waitFor(element(by.id('settings.account.support.success'))).toBeVisible().withTimeout(10000);
  });
});

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

async function reopenAccountRoute() {
  await device.openURL({ url: 'mychampions://settings/account' });
  await waitFor(element(by.id('settings.account.screen'))).toBeVisible().withTimeout(10000);
}

describeWithE2EAuthSession('Shared WebView', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true, delete: true });
    await device.disableSynchronization();
  });

  it('opens privacy and terms links inside the controlled app webview', async () => {
    await selectStudentRole();
    await openAccountTab();

    await element(by.id('settings.account.privacyPolicyRow')).tap();
    await waitFor(element(by.id('shared.webview.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('shared.webview.webview'))).toBeVisible().withTimeout(10000);

    await reopenAccountRoute();

    await element(by.id('settings.account.termsRow')).tap();
    await waitFor(element(by.id('shared.webview.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('shared.webview.webview'))).toBeVisible().withTimeout(10000);
  });
});

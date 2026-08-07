const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const {
  scrollToAccountFooter,
  scrollToDeleteCta,
  scrollToLegalRows,
  scrollToSignOutConfirmation,
  scrollToSupportQuickAction,
} = require('./account-settings-actions');

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

describeWithE2EAuthSession('Account Settings', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('shows profile/legal/support controls and signs out after confirmation', async () => {
    await selectStudentRole();
    await openAccountTab();

    await expect(element(by.id('settings.account.profileCard'))).toBeVisible();
    await expect(element(by.id('settings.account.supportQuickCta'))).toBeVisible();
    await expect(element(by.id('settings.account.emailRow'))).toBeVisible();
    await expect(element(by.id('settings.account.languageRow'))).toBeVisible();
    await expect(element(by.id('settings.account.signOutCta'))).toBeVisible();
    await scrollToLegalRows();
    await expect(element(by.id('settings.account.privacyPolicyRow'))).toBeVisible();
    await expect(element(by.id('settings.account.termsRow'))).toBeVisible();

    await element(by.id('settings.account.privacyPolicyRow')).tap();
    await waitFor(element(by.id('shared.webview.webview'))).toBeVisible().withTimeout(10000);

    await reopenAccountRoute();
    await scrollToLegalRows();
    await element(by.id('settings.account.termsRow')).tap();
    await waitFor(element(by.id('shared.webview.webview'))).toBeVisible().withTimeout(10000);

    await reopenAccountRoute();
    await scrollToSupportQuickAction();
    await element(by.id('settings.account.supportQuickCta')).tap();
    await waitFor(element(by.id('settings.account.support.subjectInput')))
      .toBeVisible()
      .withTimeout(5000);
    await expect(element(by.id('settings.account.support.bodyInput'))).toBeVisible();
    await expect(element(by.id('settings.account.support.submitCta'))).toBeVisible();
    await expect(element(by.id('settings.account.support.cancelCta'))).toBeVisible();

    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await selectStudentRole();
    await openAccountTab();

    await scrollToDeleteCta();
    await scrollToAccountFooter();
    await expect(element(by.id('settings.account.version'))).toBeVisible();

    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await selectStudentRole();
    await openAccountTab();
    await waitFor(element(by.id('settings.account.signOutCta'))).toBeVisible().withTimeout(5000);

    await element(by.id('settings.account.signOutCta')).tap();
    await scrollToSignOutConfirmation();
    await expect(element(by.text('Sign out?'))).toBeVisible();
    await element(by.id('settings.account.signOutConfirmCta')).tap();
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(10000);
  });
});

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

async function openLanguageSelect() {
  await element(by.id('settings.account.languageRow')).tap();
  await waitFor(element(by.id('settings.languageSelect.screen'))).toBeVisible().withTimeout(5000);
}

describeWithE2EAuthSession('Language Select', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true, delete: true });
    await device.disableSynchronization();
  });

  it('saves language changes immediately and discards unsaved selections on back', async () => {
    await selectStudentRole();
    await openAccountTab();
    await openLanguageSelect();

    await expect(element(by.id('settings.languageSelect.option.en-US'))).toBeVisible();
    await expect(element(by.id('settings.languageSelect.option.pt-BR'))).toBeVisible();
    await expect(element(by.id('settings.languageSelect.option.es-ES'))).toBeVisible();

    await element(by.id('settings.languageSelect.option.pt-BR')).tap();
    await waitFor(element(by.id('settings.languageSelect.option.pt-BR.checkmark'))).toBeVisible().withTimeout(5000);
    await element(by.id('settings.languageSelect.saveButton')).tap();
    await waitFor(element(by.id('settings.account.screen'))).toBeVisible().withTimeout(5000);
    await expect(element(by.text('Idioma'))).toBeVisible();
    await expect(element(by.text('Português'))).toBeVisible();

    await openLanguageSelect();
    await expect(element(by.id('settings.languageSelect.option.pt-BR.checkmark'))).toBeVisible();
    await element(by.id('settings.languageSelect.option.es-ES')).tap();
    await waitFor(element(by.id('settings.languageSelect.option.es-ES.checkmark'))).toBeVisible().withTimeout(5000);
    await element(by.id('settings.languageSelect.backButton')).tap();
    await waitFor(element(by.id('settings.account.screen'))).toBeVisible().withTimeout(5000);

    await openLanguageSelect();
    await expect(element(by.id('settings.languageSelect.option.pt-BR.checkmark'))).toBeVisible();

    await element(by.id('settings.languageSelect.option.en-US')).tap();
    await waitFor(element(by.id('settings.languageSelect.option.en-US.checkmark'))).toBeVisible().withTimeout(5000);
    await element(by.id('settings.languageSelect.saveButton')).tap();
    await waitFor(element(by.id('settings.account.screen'))).toBeVisible().withTimeout(5000);
  });
});

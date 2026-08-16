const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const { submitFocusedEditor } = require('./native-editor-actions');

async function selectProfessionalRole() {
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(15000);
  await element(by.id('auth.roleSelection.professionalCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('pro.specialty.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

async function scrollToCredentialSave() {
  await waitFor(element(by.id('pro.specialty.credential.save')))
    .toBeVisible()
    .whileElement(by.id('pro.specialty.screen'))
    .scroll(260, 'down', 0.5, 0.35);
}

async function scrollToCredentialSkip() {
  await waitFor(element(by.id('pro.specialty.credential.skip')))
    .toBeVisible()
    .whileElement(by.id('pro.specialty.screen'))
    .scroll(260, 'down', 0.5, 0.35);
}

describeWithE2EAuthSession('Professional Specialty Setup', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('opens add-specialty credential setup and blocks partial credential saves', async () => {
    await selectProfessionalRole();

    await expect(element(by.id('pro.specialty.pageTitle'))).toBeVisible();
    await expect(element(by.id('pro.specialty.error'))).not.toBeVisible();
    await waitFor(element(by.id('pro.specialty.empty')))
      .toBeVisible()
      .withTimeout(5000);
    await waitFor(element(by.id('pro.specialty.add.nutritionist')))
      .toBeVisible()
      .withTimeout(5000);

    await element(by.id('pro.specialty.add.nutritionist')).tap();

    await waitFor(element(by.id('pro.specialty.credentialForm')))
      .toExist()
      .withTimeout(5000);
    await expect(element(by.id('pro.specialty.credential.registryId'))).toBeVisible();
    await expect(element(by.id('pro.specialty.credential.authority'))).toExist();
    await expect(element(by.id('pro.specialty.credential.country'))).toExist();

    await element(by.id('pro.specialty.credential.registryId')).replaceText('CRN-12345');
    if (device.getPlatform() === 'ios') {
      await submitFocusedEditor('pro.specialty.credential.registryId');
    }
    await scrollToCredentialSave();
    await element(by.id('pro.specialty.credential.save')).tap();

    await waitFor(element(by.id('pro.specialty.credential.error')))
      .toBeVisible()
      .withTimeout(5000);
    await scrollToCredentialSkip();
    await element(by.id('pro.specialty.credential.skip')).tap();

    await waitFor(element(by.id('pro.specialty.row.nutritionist')))
      .toBeVisible()
      .withTimeout(5000);
    await expect(element(by.id('pro.specialty.cta_continue'))).toBeVisible();
  });
});

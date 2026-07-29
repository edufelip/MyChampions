const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const { scrollToInviteCodeControls } = require('./professional-home-actions');
const { tapCredentialSkip } = require('./professional-specialty-actions');

async function selectProfessionalRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.professionalCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('pro.specialty.screen'))).toBeVisible().withTimeout(10000);
}

async function addNutritionistWithoutCredential() {
  await waitFor(element(by.id('pro.specialty.empty'))).toBeVisible().withTimeout(5000);
  await waitFor(element(by.id('pro.specialty.add.nutritionist'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.add.nutritionist')).tap();
  await waitFor(element(by.id('pro.specialty.credentialForm'))).toExist().withTimeout(5000);
  await tapCredentialSkip();
  await waitFor(element(by.id('pro.specialty.row.nutritionist'))).toBeVisible().withTimeout(5000);
}

describeWithE2EAuthSession('Professional Home Invite Code', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('shows an active invite code and regenerates it after confirmation', async () => {
    await selectProfessionalRole();
    await addNutritionistWithoutCredential();

    await element(by.id('pro.specialty.cta_continue')).tap();

    await waitFor(element(by.id('pro.home.screen'))).toBeVisible().withTimeout(10000);
    await scrollToInviteCodeControls();

    await element(by.id('pro.home.rotateCodeCta')).tap();
    await waitFor(element(by.text('Regenerate'))).toBeVisible().withTimeout(5000);
    await element(by.text('Regenerate')).tap();

    await scrollToInviteCodeControls();
  });
});

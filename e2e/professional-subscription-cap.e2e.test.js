const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const scenario = process.env.E2E_SUBSCRIPTION_SCENARIO ?? 'warning';

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
  await waitFor(element(by.id('pro.specialty.credentialForm'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.credential.skip')).tap();
  await waitFor(element(by.id('pro.specialty.row.nutritionist'))).toBeVisible().withTimeout(5000);
}

describeWithE2EAuthSession('Professional Subscription Cap', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('renders the configured cap warning or lock state', async () => {
    await selectProfessionalRole();
    await addNutritionistWithoutCredential();
    await element(by.id('pro.specialty.cta_continue')).tap();

    await waitFor(element(by.id('pro.home.screen'))).toBeVisible().withTimeout(10000);

    if (scenario === 'locked') {
      await waitFor(element(by.id('pro.home.entitlementLock'))).toBeVisible().withTimeout(10000);
      await waitFor(element(by.text('11'))).toBeVisible().withTimeout(5000);
      await element(by.id('pro.home.subscriptionCta')).tap();
      await waitFor(element(by.id('pro.subscription.screen'))).toBeVisible().withTimeout(10000);
      await expect(element(by.id('pro.subscription.locked'))).toBeVisible();
      await expect(element(by.id('pro.subscription.capUsage'))).toHaveText('11 / 10 active students');
      return;
    }

    await waitFor(element(by.id('pro.home.subscriptionWarning'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.text('10'))).toBeVisible().withTimeout(5000);
    await element(by.id('pro.home.subscriptionRenewCta')).tap();
    await waitFor(element(by.id('pro.subscription.screen'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.subscription.warning'))).toBeVisible();
    await expect(element(by.id('pro.subscription.capUsage'))).toHaveText('10 / 10 active students');
  });
});

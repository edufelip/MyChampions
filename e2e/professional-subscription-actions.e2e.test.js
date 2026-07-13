const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

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

async function openSubscriptionScreen() {
  await selectProfessionalRole();
  await addNutritionistWithoutCredential();
  await element(by.id('pro.specialty.cta_continue')).tap();
  await waitFor(element(by.id('pro.home.screen'))).toBeVisible().withTimeout(10000);
  await element(by.id('pro.home.subscriptionCta')).tap();
  await waitFor(element(by.id('pro.subscription.screen'))).toBeVisible().withTimeout(10000);
}

describeWithE2EAuthSession('Professional Subscription Actions', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('shows inactive state, refreshes, and opens the professional purchase fixture safely', async () => {
    await openSubscriptionScreen();

    await expect(element(by.id('pro.subscription.statusValue'))).toHaveText('Inactive');
    await expect(element(by.id('pro.subscription.capUsage'))).toHaveText('3 / 10 active students');
    await expect(element(by.id('pro.subscription.purchaseCta'))).toBeVisible();
    await expect(element(by.id('pro.subscription.restoreCta'))).toBeVisible();
    await expect(element(by.id('pro.subscription.refreshCta'))).toBeVisible();

    await element(by.id('pro.subscription.refreshCta')).tap();
    await expect(element(by.id('pro.subscription.statusValue'))).toHaveText('Inactive');

    await element(by.id('pro.subscription.purchaseCta')).tap();
    await waitFor(element(by.id('pro.subscription.statusValue'))).toHaveText('Active').withTimeout(5000);
  });

  it('restores the professional entitlement fixture safely', async () => {
    await openSubscriptionScreen();

    await expect(element(by.id('pro.subscription.statusValue'))).toHaveText('Inactive');
    await element(by.id('pro.subscription.restoreCta')).tap();
    await waitFor(element(by.id('pro.subscription.statusValue'))).toHaveText('Active').withTimeout(5000);
  });
});

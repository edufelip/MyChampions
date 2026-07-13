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

describeWithE2EAuthSession('Professional Specialty Removal Assist', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('blocks removing the last specialty and keeps the add action on the setup screen', async () => {
    await selectProfessionalRole();
    await addNutritionistWithoutCredential();

    await element(by.id('pro.specialty.remove.nutritionist')).tap();

    await waitFor(element(by.id('pro.specialty.removalAssist'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('pro.specialty.removalAssist.add_specialty'))).toBeVisible();

    await element(by.id('pro.specialty.removalAssist.add_specialty')).tap();

    await waitFor(element(by.id('pro.specialty.screen'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id('pro.specialty.add.fitness_coach'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('pro.specialty.row.nutritionist'))).toBeVisible();
  });
});

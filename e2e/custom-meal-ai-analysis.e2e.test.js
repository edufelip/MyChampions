const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
}

async function openCreateMealScreen() {
  await device.openURL({ url: 'mychampions://nutrition/custom-meals/new' });
  await waitFor(element(by.id('meal.builder.screen'))).toBeVisible().withTimeout(10000);
}

describeWithE2EAuthSession('Custom Meal AI Analysis', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('shows the premium AI analysis gate before capture is available', async () => {
    await selectStudentRole();
    await openCreateMealScreen();

    await expect(element(by.id('meal.photoAnalysis.section'))).toBeVisible();
    await waitFor(element(by.id('meal.photoAnalysis.paywall')))
      .toBeVisible()
      .withTimeout(15000);
    await expect(element(by.id('meal.photoAnalysis.paywall.cta'))).toBeVisible();
    await expect(element(by.id('meal.photoAnalysis.cta'))).not.toBeVisible();
  });

  it('analyzes a selected meal photo through the dev fixture and pre-fills macros', async () => {
    await selectStudentRole();
    await openCreateMealScreen();

    await waitFor(element(by.id('meal.photoAnalysis.cta')))
      .toBeVisible()
      .withTimeout(15000);
    await element(by.id('meal.photoAnalysis.cta')).tap();

    await waitFor(element(by.id('meal.photoAnalysis.disclaimer')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('meal.photoAnalysis.attachToggle'))).toBeVisible();
    await expect(element(by.id('meal.builder.field.grams.input'))).toHaveText('350');
    await expect(element(by.id('meal.builder.field.calories.input'))).toHaveText('520');
    await expect(element(by.id('meal.builder.field.carbs.input'))).toHaveText('45');
  });
});

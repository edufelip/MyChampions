const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

describeWithE2EAuthSession('Student Home Dashboard', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxEnableSynchronization: 0 },
    });
  });

  it('shows dashboard summary cards after student role selection', async () => {
    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);

    await element(by.id('auth.roleSelection.studentCard')).tap();
    await element(by.id('auth.roleSelection.continueButton')).tap();

    await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('student.home.hydrationCard'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('student.home.training.emptyCta'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id('student.home.nutrition.emptyCta'))).toBeVisible().withTimeout(5000);
  });
});

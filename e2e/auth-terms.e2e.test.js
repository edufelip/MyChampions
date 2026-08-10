const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

describeWithE2EAuthSession('Auth Terms Acceptance', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxEnableSynchronization: 0 },
    });
  });

  it('requires the checkbox before accepting terms', async () => {
    await waitFor(element(by.id('auth.terms.title')))
      .toBeVisible()
      .withTimeout(15000);

    await expect(element(by.id('auth.terms.acceptButton.disabled'))).toBeVisible();
    await expect(element(by.id('auth.terms.checkbox'))).toBeVisible();
  });

  it('accepts required terms and continues to role selection', async () => {
    await waitFor(element(by.id('auth.terms.title')))
      .toBeVisible()
      .withTimeout(15000);

    await element(by.id('auth.terms.checkbox')).tap();
    await waitFor(element(by.id('auth.terms.acceptButton')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('auth.terms.acceptButton')).tap();

    await waitFor(element(by.id('auth.roleSelection.title')))
      .toBeVisible()
      .withTimeout(10000);
  });
});

describe('Auth Sign-In', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('shows required-field errors when submitting empty form', async () => {
    await expect(element(by.id('auth.signIn.title'))).toBeVisible();
    await element(by.id('auth.signIn.submitButton')).tap();
    await expect(element(by.id('auth.signIn.error.emailRequired'))).toBeVisible();
    await expect(element(by.id('auth.signIn.error.passwordRequired'))).toBeVisible();
  });

  it('navigates to role-selection after successful sign-in', async () => {
    await element(by.id('auth.signIn.emailInput')).replaceText('user@example.com');
    await element(by.id('auth.signIn.passwordInput')).replaceText('Pass@123');
    await element(by.id('auth.signIn.submitButton')).tap();

    await expect(element(by.id('auth.roleSelection.title'))).toBeVisible();
  });
});

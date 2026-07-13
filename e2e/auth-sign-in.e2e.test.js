describe('Auth Sign-In', () => {
  const e2eAuthEmail = process.env.E2E_AUTH_EMAIL?.trim();
  const e2eAuthPassword = process.env.E2E_AUTH_PASSWORD;
  const itWithE2EAuthCredentials = e2eAuthEmail && e2eAuthPassword ? it : it.skip;
  const itWithE2EAuthSignIn = process.env.E2E_AUTH_SIGN_IN === 'true' ? it : itWithE2EAuthCredentials;
  const itWithE2ECreateAccount = process.env.E2E_AUTH_CREATE_ACCOUNT === 'true' ? it : it.skip;
  const itWithE2ESocialAuth = process.env.E2E_AUTH_SOCIAL === 'true' ? it : it.skip;
  const successEmail = process.env.E2E_AUTH_SIGN_IN === 'true' ? 'e2e-auth-session@example.test' : e2eAuthEmail;
  const successPassword = process.env.E2E_AUTH_SIGN_IN === 'true' ? 'E2E-password-123!' : e2eAuthPassword;
  const createAccountEmail = 'e2e-created-account@example.test';
  const createAccountPassword = 'E2E-create-123!';

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('redirects unauthenticated app launch to sign-in', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
  });

  it('shows required-field errors when submitting empty form', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await element(by.id('auth.signIn.submitButton')).tap();
    await waitFor(element(by.id('auth.signIn.error.emailRequired'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id('auth.signIn.error.passwordRequired'))).toBeVisible().withTimeout(5000);
  });

  it('shows social sign-in entry points', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await expect(element(by.id('auth.signIn.googleButton'))).toBeVisible();
    await expect(element(by.id('auth.signIn.appleButton'))).toBeVisible();
  });

  itWithE2EAuthSignIn('navigates to role-selection after successful sign-in', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await element(by.id('auth.signIn.emailInput')).replaceText(successEmail);
    await element(by.id('auth.signIn.passwordInput')).replaceText(successPassword);
    await element(by.id('auth.signIn.submitButton')).tap();

    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(10000);
  });

  itWithE2ESocialAuth('navigates to role-selection after successful Google sign-in', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await waitFor(element(by.id('auth.signIn.googleButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.signIn.googleButton')).tap();

    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(10000);
  });

  itWithE2ESocialAuth('navigates to role-selection after successful Apple sign-in', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await waitFor(element(by.id('auth.signIn.appleButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.signIn.appleButton')).tap();

    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(10000);
  });

  it('shows required-field errors when submitting empty create-account form', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await waitFor(element(by.id('auth.signIn.createAccountButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.signIn.createAccountButton')).tap();
    await waitFor(element(by.id('auth.createAccount.title'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.scrollView')).scrollTo('bottom', NaN, 0.2);
    await waitFor(element(by.id('auth.createAccount.submitButton'))).toBeVisible().withTimeout(5000);

    await element(by.id('auth.createAccount.submitButton')).tap();

    await waitFor(element(by.id('auth.createAccount.error.passwordConfirmation')))
      .toBeVisible()
      .whileElement(by.id('auth.createAccount.scrollView'))
      .scroll(120, 'down');
    await expect(element(by.id('auth.createAccount.error.password'))).toBeVisible();
    await expect(element(by.id('auth.createAccount.error.passwordConfirmation'))).toBeVisible();
    await waitFor(element(by.id('auth.createAccount.error.nameRequired')))
      .toBeVisible()
      .whileElement(by.id('auth.createAccount.scrollView'))
      .scroll(360, 'up');
    await expect(element(by.id('auth.createAccount.error.emailRequired'))).toBeVisible();
  });

  it('returns from create account to sign-in', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await waitFor(element(by.id('auth.signIn.createAccountButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.signIn.createAccountButton')).tap();
    await waitFor(element(by.id('auth.createAccount.title'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.scrollView')).scrollTo('bottom', NaN, 0.2);
    await waitFor(element(by.id('auth.createAccount.backToSignInButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.backToSignInButton')).tap();
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(5000);
  });

  itWithE2ECreateAccount('navigates to role-selection after successful create account', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await waitFor(element(by.id('auth.signIn.createAccountButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.signIn.createAccountButton')).tap();
    await waitFor(element(by.id('auth.createAccount.title'))).toBeVisible().withTimeout(5000);

    await element(by.id('auth.createAccount.nameInput')).replaceText('New E2E User');
    await element(by.id('auth.createAccount.emailInput')).replaceText(createAccountEmail);
    await element(by.id('auth.createAccount.scrollView')).scrollTo('bottom', NaN, 0.2);
    await waitFor(element(by.id('auth.createAccount.passwordInput'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.passwordInput')).replaceText(createAccountPassword);
    await element(by.id('auth.createAccount.passwordInput')).tapReturnKey();
    await waitFor(element(by.id('auth.createAccount.passwordConfirmationInput'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.passwordConfirmationInput')).replaceText(createAccountPassword);
    await element(by.id('auth.createAccount.passwordConfirmationInput')).tapReturnKey();

    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(10000);
  });

  itWithE2ESocialAuth('navigates to role-selection after successful Google create account', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await waitFor(element(by.id('auth.signIn.createAccountButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.signIn.createAccountButton')).tap();
    await waitFor(element(by.id('auth.createAccount.title'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.scrollView')).scrollTo('bottom', NaN, 0.2);
    await waitFor(element(by.id('auth.createAccount.googleButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.googleButton')).tap();

    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(10000);
  });

  itWithE2ESocialAuth('navigates to role-selection after successful Apple create account', async () => {
    await waitFor(element(by.id('auth.signIn.title'))).toBeVisible().withTimeout(15000);
    await waitFor(element(by.id('auth.signIn.createAccountButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.signIn.createAccountButton')).tap();
    await waitFor(element(by.id('auth.createAccount.title'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.scrollView')).scrollTo('bottom', NaN, 0.2);
    await waitFor(element(by.id('auth.createAccount.appleButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('auth.createAccount.appleButton')).tap();

    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(10000);
  });
});

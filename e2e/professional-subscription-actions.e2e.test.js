const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const actionOutcome = process.env.E2E_SUBSCRIPTION_ACTION_OUTCOME ?? 'success';
const itWithSuccessfulAction = actionOutcome === 'success' ? it : it.skip;

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

async function openSubscriptionScreen() {
  await selectProfessionalRole();
  await waitFor(element(by.id('pro.specialty.cta_skip')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('pro.specialty.cta_skip')).tap();
  await waitFor(element(by.id('pro.home.screen')))
    .toBeVisible()
    .withTimeout(10000);
  await waitFor(element(by.id('pro.home.subscriptionCta')))
    .toBeVisible()
    .whileElement(by.id('pro.home.screen'))
    .scroll(300, 'down', 0.5, 0.5);
  await element(by.id('pro.home.subscriptionCta')).tap();
  await waitFor(element(by.id('pro.subscription.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

describeWithE2EAuthSession('Professional Subscription Actions', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true, delete: true });
    await device.disableSynchronization();
  });

  it('keeps cancellation non-fatal and surfaces provider failures without granting access', async () => {
    await openSubscriptionScreen();

    await expect(element(by.id('pro.subscription.statusValue'))).toHaveLabel(
      'Subscription: Inactive',
    );
    await expect(element(by.id('pro.subscription.capUsage'))).toHaveText('3 / 10 active students');
    await expect(element(by.id('pro.subscription.purchaseCta'))).toBeVisible();
    await expect(element(by.id('pro.subscription.restoreCta'))).toBeVisible();
    await expect(element(by.id('pro.subscription.refreshCta'))).toBeVisible();

    await element(by.id('pro.subscription.refreshCta')).tap();
    await expect(element(by.id('pro.subscription.statusValue'))).toHaveLabel(
      'Subscription: Inactive',
    );

    await element(by.id('pro.subscription.purchaseCta')).tap();

    if (actionOutcome === 'cancelled') {
      await expect(element(by.id('pro.subscription.statusValue'))).toHaveLabel(
        'Subscription: Inactive',
      );
      return;
    }
    if (actionOutcome === 'network' || actionOutcome === 'store_problem') {
      await waitFor(element(by.id('pro.subscription.statusValue')))
        .toHaveLabel('Subscription: Status unavailable')
        .withTimeout(5000);
      await element(by.id('pro.subscription.refreshCta')).tap();
      await waitFor(element(by.id('pro.subscription.statusValue')))
        .toHaveLabel('Subscription: Inactive')
        .withTimeout(5000);
      return;
    }

    await waitFor(element(by.id('pro.subscription.statusValue')))
      .toHaveLabel('Subscription: Active')
      .withTimeout(5000);
    await expect(element(by.id('pro.subscription.warning'))).not.toBeVisible();
  });

  itWithSuccessfulAction('restores the professional entitlement fixture safely', async () => {
    await openSubscriptionScreen();

    await expect(element(by.id('pro.subscription.statusValue'))).toHaveLabel(
      'Subscription: Inactive',
    );
    await element(by.id('pro.subscription.restoreCta')).tap();
    await waitFor(element(by.id('pro.subscription.statusValue')))
      .toHaveLabel('Subscription: Active')
      .withTimeout(5000);
  });
});

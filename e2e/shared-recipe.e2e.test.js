const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

describeWithE2EAuthSession('Shared Recipe', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true, delete: true });
    await device.disableSynchronization();
  });

  it('previews and saves a shared recipe link inside the app shell', async () => {
    await selectStudentRole();

    await device.openURL({ url: 'mychampions://shared/recipes/e2e-shared-recipe' });

    await waitFor(element(by.id('shared_recipe.preview')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('shared_recipe.preview.name'))).toBeVisible();
    await expect(element(by.text('E2E Shared Recovery Bowl'))).toBeVisible();
    await expect(element(by.id('shared_recipe.preview.nutrition'))).toBeVisible();
    await expect(element(by.id('shared_recipe.cta.save'))).toBeVisible();
    await expect(element(by.id('shared_recipe.cta.cancel'))).toBeVisible();

    await element(by.id('shared_recipe.cta.save')).tap();

    await waitFor(element(by.id('shared_recipe.saved')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.text('Recipe saved to your account.'))).toBeVisible();
    await expect(element(by.text('E2E Shared Recovery Bowl'))).toBeVisible();
  });
});

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

async function dismissUploadSheet() {
  try {
    await element(by.text('Cancel')).tap();
  } catch (_error) {
    await system.element(by.system.label('Cancel')).tap();
  }
}

describeWithE2EAuthSession('Custom Meal Image Upload', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('opens the upload source sheet from the custom meal builder', async () => {
    await selectStudentRole();
    await openCreateMealScreen();

    await expect(element(by.id('meal.builder.imageUpload.section'))).toBeVisible();
    await expect(element(by.id('meal.builder.imageUpload'))).toBeVisible();
    await element(by.id('meal.builder.imageUpload')).tap();

    await waitFor(element(by.text('Upload Image'))).toBeVisible().withTimeout(5000);
    await expect(element(by.text('Choose a photo source'))).toBeVisible();
    await dismissUploadSheet();

    await waitFor(element(by.id('meal.builder.imageUpload'))).toBeVisible().withTimeout(5000);
  });

  it('uploads a selected image through the dev fixture and shows the preview', async () => {
    await selectStudentRole();
    await openCreateMealScreen();

    await element(by.id('meal.builder.imageUpload')).tap();

    await waitFor(element(by.id('meal.builder.imageUpload.preview'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('meal.builder.imageUpload.progress'))).not.toBeVisible();
    await expect(element(by.id('meal.builder.imageUpload.error'))).not.toBeVisible();
  });
});

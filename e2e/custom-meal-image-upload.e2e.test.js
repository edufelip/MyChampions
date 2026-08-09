const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const imageUploadScenario = process.env.E2E_IMAGE_UPLOAD_SCENARIO;

if (
  process.env.E2E_AUTH_SESSION === 'true' &&
  imageUploadScenario !== 'sheet' &&
  imageUploadScenario !== 'success' &&
  imageUploadScenario !== 'permission-denied'
) {
  throw new Error(
    'Custom Meal Image Upload requires E2E_IMAGE_UPLOAD_SCENARIO=sheet|success|permission-denied for authenticated runs',
  );
}

const itWithSheetScenario = imageUploadScenario === 'sheet' ? it : it.skip;
const itWithSuccessScenario = imageUploadScenario === 'success' ? it : it.skip;
const itWithPermissionDeniedScenario = imageUploadScenario === 'permission-denied' ? it : it.skip;
const imageUploadPermissions =
  imageUploadScenario === 'permission-denied' ? { camera: 'NO' } : { camera: 'YES' };

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

async function openCreateMealScreen() {
  await device.openURL({ url: 'mychampions://nutrition/custom-meals/new' });
  await waitFor(element(by.id('meal.builder.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

async function dismissUploadSheet() {
  try {
    await element(by.text('Cancel')).tap();
  } catch (_error) {
    await element(by.system.label('Cancel')).tap();
  }
}

describeWithE2EAuthSession('Custom Meal Image Upload', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true, permissions: imageUploadPermissions });
    await device.disableSynchronization();
  });

  itWithSheetScenario('opens the upload source sheet from the custom meal builder', async () => {
    await selectStudentRole();
    await openCreateMealScreen();

    await expect(element(by.id('meal.builder.imageUpload.section'))).toBeVisible();
    await expect(element(by.id('meal.builder.imageUpload'))).toBeVisible();
    await element(by.id('meal.builder.imageUpload')).tap();

    await waitFor(element(by.text('Upload image')))
      .toBeVisible()
      .withTimeout(5000);
    await expect(element(by.text('Choose a photo source'))).toBeVisible();
    await dismissUploadSheet();

    await waitFor(element(by.id('meal.builder.imageUpload')))
      .toBeVisible()
      .withTimeout(5000);
  });

  itWithSuccessScenario(
    'uploads a selected image through the dev fixture and shows the preview',
    async () => {
      await selectStudentRole();
      await openCreateMealScreen();

      await element(by.id('meal.builder.imageUpload')).tap();

      await waitFor(element(by.id('meal.builder.imageUpload.preview')))
        .toBeVisible()
        .withTimeout(10000);
      await expect(element(by.id('meal.builder.imageUpload.progress'))).not.toBeVisible();
      await expect(element(by.id('meal.builder.imageUpload.error'))).not.toBeVisible();
    },
  );

  itWithPermissionDeniedScenario(
    'shows a permission error when camera access is denied',
    async () => {
      await selectStudentRole();
      await openCreateMealScreen();

      await element(by.id('meal.builder.imageUpload')).tap();
      await waitFor(element(by.text('Take photo')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Take photo')).tap();

      await waitFor(element(by.id('meal.builder.imageUpload.error')))
        .toBeVisible()
        .withTimeout(10000);
      await expect(element(by.id('meal.builder.imageUpload.preview'))).not.toBeVisible();
    },
  );
});

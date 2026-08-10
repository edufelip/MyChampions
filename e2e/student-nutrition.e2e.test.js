const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const assignedNutritionMealId = process.env.E2E_ASSIGNED_NUTRITION_MEAL_ID || 'e2e-assigned-meal';
const hydrationLogAmountMl = process.env.E2E_HYDRATION_LOG_AMOUNT_ML || '250';
const expectedHydrationAfterLogMl =
  process.env.E2E_HYDRATION_EXPECTED_AFTER_LOG_ML || hydrationLogAmountMl;
const nutritionPlanChangeRequestText =
  process.env.E2E_NUTRITION_PLAN_CHANGE_REQUEST_TEXT ||
  'Please add more breakfast variety this week.';

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

async function openNutritionScreen() {
  await device.openURL({ url: 'mychampions://student/nutrition' });
  await waitFor(element(by.id('student.nutrition.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

async function dismissWaterKeyboardIfVisible() {
  try {
    await element(by.id('student.nutrition.waterWidget.intakeInput')).tapReturnKey();
  } catch (_error) {
    // Keyboard is already dismissed or the current keyboard has no return key.
  }
}

async function dismissPlanChangeKeyboardIfVisible() {
  try {
    await element(by.id('student.nutrition.planChangeForm.input')).tapReturnKey();
  } catch (_error) {
    // Keyboard is already dismissed or the current keyboard has no return key.
  }
}

async function expectAssignedNutritionContent() {
  await waitFor(element(by.id('student.nutrition.macroCard')))
    .toBeVisible()
    .withTimeout(10000);
  await waitFor(element(by.id(`student.nutrition.mealCard.${assignedNutritionMealId}`)))
    .toBeVisible()
    .whileElement(by.id('student.nutrition.screen'))
    .scroll(220, 'down', 0.5, 0.35);
}

async function expectHydrationWidget() {
  await waitFor(element(by.id('student.nutrition.waterWidget.intakeInput')))
    .toBeVisible()
    .whileElement(by.id('student.nutrition.screen'))
    .scroll(420, 'down', 0.5, 0.35);
  await waitFor(element(by.id('student.nutrition.waterWidget.logButton')))
    .toBeVisible()
    .withTimeout(5000);
}

async function expectPlanChangeForm() {
  await waitFor(element(by.id('student.nutrition.planChangeForm.input')))
    .toBeVisible()
    .whileElement(by.id('student.nutrition.screen'))
    .scroll(420, 'down', 0.5, 0.35);
  await waitFor(element(by.id('student.nutrition.planChangeForm.submitButton')))
    .toBeVisible()
    .whileElement(by.id('student.nutrition.screen'))
    .scroll(260, 'down', 0.5, 0.35);
}

describeWithE2EAuthSession('Student Assigned Nutrition', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('shows assigned macro targets and meal cards for the current student', async () => {
    await selectStudentRole();
    await openNutritionScreen();

    await expectAssignedNutritionContent();
  });

  it('logs an assigned meal for today and shows it as logged', async () => {
    await selectStudentRole();
    await openNutritionScreen();
    await expectAssignedNutritionContent();

    await waitFor(element(by.id(`student.nutrition.logMealButton.${assignedNutritionMealId}`)))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id(`student.nutrition.logMealButton.${assignedNutritionMealId}`)).tap();
    await waitFor(element(by.id(`student.nutrition.loggedMealBadge.${assignedNutritionMealId}`)))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('validates and logs hydration intake against the effective goal', async () => {
    await selectStudentRole();
    await openNutritionScreen();
    await expectHydrationWidget();

    await element(by.id('student.nutrition.waterWidget.logButton')).tap();
    await waitFor(element(by.id('student.nutrition.waterWidget.intakeError')))
      .toBeVisible()
      .withTimeout(5000);

    await element(by.id('student.nutrition.waterWidget.intakeInput')).replaceText(
      hydrationLogAmountMl,
    );
    await dismissWaterKeyboardIfVisible();
    await waitFor(element(by.id('student.nutrition.waterWidget.logButton')))
      .toBeVisible()
      .whileElement(by.id('student.nutrition.screen'))
      .scroll(120, 'down', 0.5, 0.35);
    await element(by.id('student.nutrition.waterWidget.logButton')).tap();
    await waitFor(element(by.id('student.nutrition.waterWidget.consumedValue')))
      .toHaveText(expectedHydrationAfterLogMl)
      .withTimeout(10000);
  });

  it('validates and submits an assigned nutrition plan change request', async () => {
    await selectStudentRole();
    await openNutritionScreen();
    await expectPlanChangeForm();

    await element(by.id('student.nutrition.planChangeForm.submitButton')).tap();
    await waitFor(element(by.id('student.nutrition.planChangeForm.error')))
      .toBeVisible()
      .withTimeout(5000);

    await element(by.id('student.nutrition.planChangeForm.input')).replaceText(
      nutritionPlanChangeRequestText,
    );
    await dismissPlanChangeKeyboardIfVisible();
    await waitFor(element(by.id('student.nutrition.planChangeForm.submitButton')))
      .toBeVisible()
      .whileElement(by.id('student.nutrition.screen'))
      .scroll(180, 'down', 0.5, 0.25);
    await element(by.id('student.nutrition.planChangeForm.submitButton')).tap();
    await waitFor(element(by.id('student.nutrition.planChangeForm.success')))
      .toBeVisible()
      .withTimeout(10000);
  });
});

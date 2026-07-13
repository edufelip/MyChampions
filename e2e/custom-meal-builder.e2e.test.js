const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

const mealInput = {
  name: process.env.E2E_CUSTOM_MEAL_NAME || 'E2E Recovery Bowl',
  grams: process.env.E2E_CUSTOM_MEAL_GRAMS || '300',
  calories: process.env.E2E_CUSTOM_MEAL_CALORIES || '480',
  carbs: process.env.E2E_CUSTOM_MEAL_CARBS || '55',
  proteins: process.env.E2E_CUSTOM_MEAL_PROTEINS || '35',
  fats: process.env.E2E_CUSTOM_MEAL_FATS || '14',
};

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
}

async function openCreateMealScreen() {
  await device.openURL({ url: 'mychampions://nutrition/custom-meals/new' });
  await waitFor(element(by.id('meal.builder.screen'))).toBeVisible().withTimeout(10000);
  await dismissKeyboardIfVisible();
  await scrollToTop();
}

async function scrollTo(testID, pixels = 260) {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .whileElement(by.id('meal.builder.screen'))
    .scroll(pixels, 'down', 0.5, 0.35);
}

async function scrollToTop() {
  await element(by.id('meal.builder.screen')).scrollTo('top', NaN, 0.85);
}

async function scrollToBottom() {
  await element(by.id('meal.builder.screen')).scrollTo('bottom', NaN, 0.2);
}

async function scrollToSaveButton() {
  await waitFor(element(by.id('meal.builder.cta.save')))
    .toBeVisible()
    .whileElement(by.id('meal.builder.screen'))
    .scroll(320, 'down', 0.5, 0.75);
}

async function dismissKeyboardIfVisible() {
  try {
    await waitFor(element(by.text('Done'))).toBeVisible().withTimeout(3000);
    await element(by.text('Done')).tap();
    return true;
  } catch (_error) {
    try {
      await waitFor(element(by.id('meal.builder.keyboard.done'))).toBeVisible().withTimeout(1000);
      await element(by.id('meal.builder.keyboard.done')).tap();
      return true;
    } catch (_fallbackError) {
      // Keyboard is already dismissed.
      return false;
    }
  }
}

async function fillField(testID, value) {
  await waitFor(element(by.id(`${testID}.input`)))
    .toBeVisible()
    .whileElement(by.id('meal.builder.screen'))
    .scroll(180, 'down', 0.5, 0.35);
  await element(by.id(`${testID}.input`)).replaceText(value);
  await dismissKeyboardIfVisible();
}

describeWithE2EAuthSession('Custom Meal Builder', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('validates required custom meal fields before saving', async () => {
    await selectStudentRole();
    await openCreateMealScreen();

    await scrollToBottom();
    const didDismissKeyboard = await dismissKeyboardIfVisible();
    if (!didDismissKeyboard) {
      await device.tap({ x: 352, y: 500 });
    }
    await scrollToSaveButton();
    await element(by.id('meal.builder.cta.save')).tap();

    await scrollToTop();
    await waitFor(element(by.id('meal.builder.field.name.error')))
      .toBeVisible()
      .withTimeout(5000);
    await expect(element(by.id('meal.builder.field.grams.error'))).toBeVisible();
    await waitFor(element(by.id('meal.builder.field.calories.error')))
      .toBeVisible()
      .whileElement(by.id('meal.builder.screen'))
      .scroll(180, 'down', 0.5, 0.65);
  });

  it('creates a custom meal and returns to the library', async () => {
    await selectStudentRole();
    await openCreateMealScreen();

    await fillField('meal.builder.field.name', mealInput.name);
    await fillField('meal.builder.field.grams', mealInput.grams);
    await fillField('meal.builder.field.calories', mealInput.calories);
    await fillField('meal.builder.field.carbs', mealInput.carbs);
    await fillField('meal.builder.field.proteins', mealInput.proteins);
    await fillField('meal.builder.field.fats', mealInput.fats);

    const didDismissKeyboard = await dismissKeyboardIfVisible();
    if (!didDismissKeyboard) {
      await device.tap({ x: 352, y: 500 });
    }
    await scrollToBottom();
    await element(by.id('meal.builder.cta.save')).tap();

    await waitFor(element(by.id('meal.library.screen'))).toBeVisible().withTimeout(10000);
  });
});

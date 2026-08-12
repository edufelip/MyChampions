const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const { waitForElementAbsent, waitForElementActionable } = require('./native-editor-actions');

const mealInput = {
  name: process.env.E2E_CUSTOM_MEAL_NAME || 'E2E Recovery Bowl',
  grams: process.env.E2E_CUSTOM_MEAL_GRAMS || '300',
  calories: process.env.E2E_CUSTOM_MEAL_CALORIES || '480',
  carbs: process.env.E2E_CUSTOM_MEAL_CARBS || '55',
  proteins: process.env.E2E_CUSTOM_MEAL_PROTEINS || '35',
  fats: process.env.E2E_CUSTOM_MEAL_FATS || '14',
};

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
  // The Done button lives in an iOS InputAccessoryView docked to the keyboard,
  // so it exists only while the keyboard is presented — and it animates with
  // the keyboard's spring. Synchronization is disabled in this suite, so a
  // bare tap can race that animation and land on the moving keyboard host.
  // waitForElementActionable requires hittability plus two stable frames,
  // which rides the animation out. On Android the accessory never exists
  // (Espresso replaceText does not focus, so no keyboard comes up).
  try {
    await waitForElementActionable('meal.builder.keyboard.done', 3000);
  } catch (_error) {
    // No actionable accessory within the window: the keyboard is not up.
    return false;
  }
  await element(by.id('meal.builder.keyboard.done')).tap();
  await waitForElementAbsent('meal.builder.keyboard.done', 5000);
  return true;
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
    await dismissKeyboardIfVisible();
    await waitForElementAbsent('meal.builder.keyboard.done', 5000);
    await scrollToSaveButton();
    // The save tap follows a scroll gesture; with synchronization disabled a
    // tap injected into scroll momentum lets the ScrollView steal the
    // responder, cancelling the press without any Detox error. The stable-
    // frame gate guarantees the scroll has settled before the tap.
    await waitForElementActionable('meal.builder.cta.save');
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

    await dismissKeyboardIfVisible();
    await waitForElementAbsent('meal.builder.keyboard.done', 5000);
    await scrollToBottom();
    // Same settled-scroll gate as the validation test: a tap injected into
    // scroll momentum is silently cancelled by the responder system.
    await waitForElementActionable('meal.builder.cta.save');
    await element(by.id('meal.builder.cta.save')).tap();

    await waitFor(element(by.id('meal.library.screen')))
      .toBeVisible()
      .withTimeout(10000);
  });
});

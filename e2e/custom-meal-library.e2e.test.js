const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const customMealId = process.env.E2E_CUSTOM_MEAL_ID || 'e2e-custom-meal';
const customMealLogGrams = process.env.E2E_CUSTOM_MEAL_LOG_GRAMS || '150';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
}

async function openCustomMealsScreen() {
  await device.openURL({ url: 'mychampions://nutrition/custom-meals' });
  await waitFor(element(by.id('meal.library.screen'))).toBeVisible().withTimeout(10000);
}

async function dismissQuickLogKeyboardIfVisible() {
  try {
    await waitFor(element(by.id('meal.library.quickLog.keyboard.done'))).toBeVisible().withTimeout(3000);
    await element(by.id('meal.library.quickLog.keyboard.done')).tap();
    await sleep(750);
  } catch (_error) {
    // Keyboard is already dismissed or the accessory is unavailable on this platform.
  }
}

async function tapQuickLogConfirm() {
  try {
    await element(by.id('meal.library.quickLog.cta.confirm')).tap();
  } catch (_error) {
    await device.tap({ x: 168, y: 631 });
  }
}

async function openQuickLogPanel() {
  const logButton = element(by.id(`meal.library.row.${customMealId}.log`));
  await waitFor(logButton).toBeVisible().withTimeout(10000);
  await sleep(500);
  await logButton.tap();
  try {
    await waitFor(element(by.id('meal.library.quickLog.panel'))).toBeVisible().withTimeout(5000);
  } catch (_error) {
    await sleep(500);
    await logButton.tap();
    await waitFor(element(by.id('meal.library.quickLog.panel'))).toBeVisible().withTimeout(5000);
  }
}

describeWithE2EAuthSession('Custom Meal Library', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('shows saved custom meals and library actions for the current user', async () => {
    await selectStudentRole();
    await openCustomMealsScreen();

    await waitFor(element(by.id(`meal.library.row.${customMealId}`))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id(`meal.library.row.${customMealId}.log`))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id(`meal.library.row.${customMealId}.edit`))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id(`meal.library.row.${customMealId}.share`))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id(`meal.library.row.${customMealId}.delete`))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id('meal.library.cta.create'))).toBeVisible().withTimeout(5000);
  });

  it('validates and logs a custom meal portion from the quick log panel', async () => {
    await selectStudentRole();
    await openCustomMealsScreen();

    await openQuickLogPanel();

    await tapQuickLogConfirm();
    await waitFor(element(by.id('meal.library.quickLog.error'))).toBeVisible().withTimeout(5000);

    await element(by.id('meal.library.quickLog.input')).tap();
    await element(by.id('meal.library.quickLog.input')).typeText(customMealLogGrams);
    await dismissQuickLogKeyboardIfVisible();
    await tapQuickLogConfirm();
    await waitFor(element(by.id('meal.library.quickLog.panel'))).not.toBeVisible().withTimeout(10000);
  });
});

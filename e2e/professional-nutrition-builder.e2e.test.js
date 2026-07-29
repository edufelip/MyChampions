const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const { tapCredentialSkip } = require('./professional-specialty-actions');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function selectProfessionalRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.professionalCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('pro.specialty.screen'))).toBeVisible().withTimeout(10000);
}

async function addNutritionistSpecialty() {
  await waitFor(element(by.id('pro.specialty.add.nutritionist'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.add.nutritionist')).tap();
  await waitFor(element(by.id('pro.specialty.credentialForm'))).toExist().withTimeout(5000);
  await tapCredentialSkip();
  await waitFor(element(by.id('pro.specialty.row.nutritionist'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.cta_continue')).tap();
  await waitFor(element(by.id('pro.home.screen'))).toBeVisible().withTimeout(10000);
}

describeWithE2EAuthSession('Professional Nutrition Builder', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('creates a professional nutrition plan, adds a searched food, recalculates totals, and removes it', async () => {
    await selectProfessionalRole();
    await addNutritionistSpecialty();

    await element(by.id('tabs.nutrition')).tap();
    await waitFor(element(by.id('pro.library.nutrition.create'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.library.nutrition.create')).tap();

    await waitFor(element(by.id('pro.nutrition_plan.screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.plan.metadata.name')).replaceText('E2E Builder Nutrition Plan');
    await device.tap({ x: 350, y: 420 });
    await element(by.id('pro.plan.metadata.hydrationGoalMl')).replaceText('2200');
    await device.tap({ x: 350, y: 420 });
    await element(by.id('pro.nutrition_plan.saveButton')).tap();

    await waitFor(element(by.id('pro.library.nutrition.row.e2e-nutrition-builder-plan-1')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('pro.library.nutrition.row.e2e-nutrition-builder-plan-1')).tap();
    await waitFor(element(by.id('pro.nutrition_plan.screen'))).toBeVisible().withTimeout(10000);

    await waitFor(element(by.id('pro.nutrition_plan.addMeal'))).toBeVisible().withTimeout(5000);
    await element(by.id('pro.nutrition_plan.addMeal')).tap();
    await waitFor(element(by.id('pro.nutrition_plan.addMeal.input'))).toBeVisible().withTimeout(5000);
    await element(by.id('pro.nutrition_plan.addMeal.input')).replaceText('Breakfast');
    await element(by.id('pro.nutrition_plan.addMeal.input')).tapReturnKey();
    await element(by.id('pro.nutrition_plan.addMeal.confirm')).tap();

    await waitFor(element(by.id('pro.nutrition_plan.mealRow.Breakfast'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.nutrition_plan.mealRow.Breakfast')).tap();

    await waitFor(element(by.id('pro.nutrition_meal.screen'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.nutrition_meal.total.calories'))).toHaveText('0 kcal');
    await element(by.id('pro.nutrition_meal.addFood')).tap();

    await waitFor(element(by.id('pro.nutrition_item.form'))).toBeVisible().withTimeout(5000);
    await element(by.id('pro.nutrition_item.searchInput')).replaceText('rice');
    await element(by.id('pro.nutrition_item.searchButton')).tap();
    await waitFor(element(by.id('pro.nutrition_item.searchResult.e2e-food-rice'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.nutrition_item.searchResult.e2e-food-rice')).tap();

    await waitFor(element(by.id('pro.nutrition_item.selectedFood'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('pro.nutrition_item.quantity'))).toHaveText('100');
    await element(by.id('pro.nutrition_item.add')).tap();

    await waitFor(element(by.id('pro.nutrition_meal.foodRow.E2E_Brown_Rice'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.nutrition_meal.total.calories'))).toHaveText('111 kcal');

    await element(by.id('pro.nutrition_meal.foodRow.E2E_Brown_Rice.remove')).tap();
    await sleep(750);
    await device.tap({ x: 276, y: 520 });

    await waitFor(element(by.id('pro.nutrition_meal.foodRow.E2E_Brown_Rice'))).not.toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.nutrition_meal.total.calories'))).toHaveText('0 kcal');
  });
});

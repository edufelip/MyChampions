const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const { submitFocusedEditor } = require('./native-editor-actions');
const { scrollToTrainingPlanSave } = require('./training-plan-actions');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForElementEnabled(testId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastAttributes;

  do {
    lastAttributes = await element(by.id(testId)).getAttributes();
    const candidates = Array.isArray(lastAttributes.elements)
      ? lastAttributes.elements
      : [lastAttributes];
    if (candidates.some((attributes) => attributes.enabled)) {
      return;
    }
    await sleep(100);
  } while (Date.now() < deadline);

  throw new Error(
    `Timed out waiting for ${testId} to become enabled: ${JSON.stringify(lastAttributes)}`
  );
}

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
}

describeWithE2EAuthSession('Student Self-Managed Builder', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('creates a self-managed nutrition plan and returns to the student nutrition context', async () => {
    await selectStudentRole();

    await device.openURL({ url: 'mychampions://student/nutrition/plans/new' });
    await waitFor(element(by.id('pro.nutrition_plan.screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.plan.metadata.name')).replaceText('E2E Student Nutrition Plan');
    await submitFocusedEditor('pro.plan.metadata.name');
    await waitFor(element(by.id('pro.plan.metadata.hydrationGoalMl')))
      .toBeFocused()
      .withTimeout(2000);
    await element(by.id('pro.plan.metadata.hydrationGoalMl')).replaceText('2100');
    await expect(element(by.id('pro.plan.metadata.hydrationGoalMl'))).toHaveText('2100');
    await submitFocusedEditor('pro.plan.metadata.hydrationGoalMl');
    await waitForElementEnabled('pro.nutrition_plan.saveButton');
    await element(by.id('pro.nutrition_plan.saveButton')).tap();

    await waitFor(element(by.id('student.nutrition.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('student.nutrition.selfManagedPlanCard'))).toBeVisible().withTimeout(10000);
  });

  it('creates a self-managed training plan and returns to the student training context', async () => {
    await selectStudentRole();

    await device.openURL({ url: 'mychampions://student/training/plans/new' });
    await waitFor(element(by.id('pro.training_plan.screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.training_plan.name')).replaceText('E2E Student Training Plan');
    await device.tap({ x: 350, y: 420 });
    await scrollToTrainingPlanSave();
    await element(by.id('pro.training_plan.saveButton')).tap();

    await waitFor(element(by.id('student.training.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('student.training.selfManagedPlanCard'))).toBeVisible().withTimeout(10000);
  });
});

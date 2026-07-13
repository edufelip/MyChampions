const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

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
    await device.tap({ x: 350, y: 420 });
    await element(by.id('pro.plan.metadata.hydrationGoalMl')).replaceText('2100');
    await device.tap({ x: 350, y: 420 });
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
    await element(by.id('pro.training_plan.saveButton')).tap();

    await waitFor(element(by.id('student.training.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('student.training.selfManagedPlanCard'))).toBeVisible().withTimeout(10000);
  });
});

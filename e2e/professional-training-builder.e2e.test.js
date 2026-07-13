const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function selectProfessionalRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.professionalCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('pro.specialty.screen'))).toBeVisible().withTimeout(10000);
}

async function addFitnessCoachSpecialty() {
  await waitFor(element(by.id('pro.specialty.add.fitness_coach'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.add.fitness_coach')).tap();
  await waitFor(element(by.id('pro.specialty.credentialForm'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.credential.skip')).tap();
  await waitFor(element(by.id('pro.specialty.row.fitness_coach'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.cta_continue')).tap();
  await waitFor(element(by.id('pro.home.screen'))).toBeVisible().withTimeout(10000);
}

describeWithE2EAuthSession('Professional Training Builder', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('creates a professional training plan, adds a searched exercise, saves it, and removes it', async () => {
    await selectProfessionalRole();
    await addFitnessCoachSpecialty();

    await element(by.id('tabs.training')).tap();
    await waitFor(element(by.id('pro.library.training.create'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.library.training.create')).tap();

    await waitFor(element(by.id('pro.training_plan.screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.training_plan.name')).replaceText('E2E Builder Training Plan');
    await device.tap({ x: 350, y: 420 });
    await element(by.id('pro.training_plan.saveButton')).tap();

    await waitFor(element(by.id('pro.library.training.row.e2e-training-builder-plan-1')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('pro.library.training.row.e2e-training-builder-plan-1')).tap();
    await waitFor(element(by.id('pro.training_plan.screen'))).toBeVisible().withTimeout(10000);

    await waitFor(element(by.id('pro.training_plan.addSession'))).toBeVisible().withTimeout(5000);
    await element(by.id('pro.training_plan.addSession')).tap();
    await waitFor(element(by.id('pro.training_plan.addSession.name'))).toBeVisible().withTimeout(5000);
    await element(by.id('pro.training_plan.addSession.name')).replaceText('Push Day');
    await element(by.id('pro.training_plan.addSession.name')).tapReturnKey();
    await element(by.id('pro.training_plan.addSession.notes')).replaceText('Upper body focus');
    await device.tap({ x: 350, y: 420 });
    await element(by.id('pro.training_plan.addSession.confirm')).tap();

    await waitFor(element(by.id('pro.training_plan.sessionRow.Push_Day'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.training_plan.sessionRow.Push_Day.addItem')).tap();

    await waitFor(element(by.id('exerciseSearch.modal'))).toBeVisible().withTimeout(5000);
    await element(by.id('exerciseSearch.input')).replaceText('push');
    await waitFor(element(by.id('exerciseSearch.result.e2e-exercise-push-up'))).toBeVisible().withTimeout(10000);
    await element(by.id('exerciseSearch.input')).tapReturnKey();
    await sleep(500);
    await element(by.id('exerciseSearch.result.e2e-exercise-push-up')).tap();

    await waitFor(element(by.id('exerciseSearch.detail'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id('exerciseSearch.quantity')))
      .toBeVisible()
      .whileElement(by.id('exerciseSearch.detailScroll'))
      .scroll(240, 'down', 0.5, 0.75);
    await element(by.id('exerciseSearch.quantity')).replaceText('3 x 10');
    await element(by.id('exerciseSearch.quantity')).tapReturnKey();
    await sleep(500);
    await waitFor(element(by.id('exerciseSearch.confirm')))
      .toBeVisible()
      .whileElement(by.id('exerciseSearch.detailScroll'))
      .scroll(220, 'down', 0.5, 0.75);
    await element(by.id('exerciseSearch.confirm')).tap();

    await waitFor(element(by.id('pro.training_plan.itemRow.E2E_Push-Up'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.training_plan.itemRow.E2E_Push-Up.quantity'))).toHaveText('3 x 10');

    await element(by.id('pro.training_plan.saveButton')).tap();
    await waitFor(element(by.id('pro.library.training.row.e2e-training-builder-plan-1')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('pro.library.training.row.e2e-training-builder-plan-1')).tap();
    await waitFor(element(by.id('pro.training_plan.itemRow.E2E_Push-Up'))).toBeVisible().withTimeout(10000);

    await element(by.id('pro.training_plan.itemRow.E2E_Push-Up.remove')).tap();
    await sleep(750);
    await device.tap({ x: 276, y: 520 });

    await waitFor(element(by.id('pro.training_plan.itemRow.E2E_Push-Up'))).not.toBeVisible().withTimeout(10000);
  });
});

const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const assignedTrainingSessionId = process.env.E2E_ASSIGNED_TRAINING_SESSION_ID || 'e2e-assigned-session';
const expectedLoggedLabel = process.env.E2E_ASSIGNED_TRAINING_LOGGED_LABEL || 'Completed';
const trainingPlanChangeRequestText =
  process.env.E2E_TRAINING_PLAN_CHANGE_REQUEST_TEXT || 'Please adjust leg day volume this week.';

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
}

async function openTrainingScreen() {
  await device.openURL({ url: 'mychampions://student/training' });
  await waitFor(element(by.id('student.training.screen'))).toBeVisible().withTimeout(10000);
}

async function dismissPlanChangeKeyboardIfVisible() {
  try {
    await element(by.id('student.training.planChangeForm.input')).tapReturnKey();
  } catch (_error) {
    // Keyboard is already dismissed or the current keyboard has no return key.
  }
}

async function expectAssignedTrainingContent() {
  await waitFor(element(by.id('student.training.weekStrip'))).toBeVisible().withTimeout(10000);
  await waitFor(element(by.id(`student.training.sessionCard-${assignedTrainingSessionId}`)))
    .toBeVisible()
    .whileElement(by.id('student.training.screen'))
    .scroll(220, 'down', 0.5, 0.35);
}

async function expectPlanChangeForm() {
  await waitFor(element(by.id('student.training.planChangeForm.input')))
    .toBeVisible()
    .whileElement(by.id('student.training.screen'))
    .scroll(420, 'down', 0.5, 0.35);
  await waitFor(element(by.id('student.training.planChangeForm.submitButton')))
    .toBeVisible()
    .whileElement(by.id('student.training.screen'))
    .scroll(260, 'down', 0.5, 0.35);
}

describeWithE2EAuthSession('Student Assigned Training', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('shows assigned training calendar and workout sessions for the current student', async () => {
    await selectStudentRole();
    await openTrainingScreen();

    await expectAssignedTrainingContent();
  });

  it('logs an assigned workout session for today and shows it as logged', async () => {
    await selectStudentRole();
    await openTrainingScreen();

    await waitFor(element(by.id(`student.training.logBtn-${assignedTrainingSessionId}`)))
      .toBeVisible()
      .whileElement(by.id('student.training.screen'))
      .scroll(220, 'down', 0.5, 0.35);
    await element(by.id(`student.training.logBtn-${assignedTrainingSessionId}`)).tap();
    await waitFor(element(by.id(`student.training.logBtn-${assignedTrainingSessionId}.label`)))
      .toHaveText(expectedLoggedLabel)
      .withTimeout(10000);
  });

  it('validates and submits an assigned training plan change request', async () => {
    await selectStudentRole();
    await openTrainingScreen();

    await expectPlanChangeForm();

    await element(by.id('student.training.planChangeForm.submitButton')).tap();
    await waitFor(element(by.id('student.training.planChangeForm.error')))
      .toBeVisible()
      .withTimeout(5000);

    await element(by.id('student.training.planChangeForm.input')).replaceText(trainingPlanChangeRequestText);
    await dismissPlanChangeKeyboardIfVisible();
    await waitFor(element(by.id('student.training.planChangeForm.submitButton')))
      .toBeVisible()
      .whileElement(by.id('student.training.screen'))
      .scroll(120, 'down', 0.5, 0.35);
    await element(by.id('student.training.planChangeForm.submitButton')).tap();
    await waitFor(element(by.id('student.training.planChangeForm.success')))
      .toBeVisible()
      .withTimeout(10000);
  });
});

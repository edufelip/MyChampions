const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

async function selectProfessionalRole() {
  await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);
  await element(by.id('auth.roleSelection.professionalCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('pro.specialty.screen'))).toBeVisible().withTimeout(10000);
}

async function openStudentsTab() {
  await element(by.id('pro.specialty.cta_skip')).tap();
  await waitFor(element(by.id('pro.home.screen'))).toBeVisible().withTimeout(10000);
  await element(by.id('tabs.students')).tap();
  await waitFor(element(by.id('pro.students.search'))).toBeVisible().withTimeout(10000);
}

async function addNutritionSpecialtyAndOpenStudentsTab() {
  await waitFor(element(by.id('pro.specialty.add.nutritionist'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.add.nutritionist')).tap();
  await waitFor(element(by.id('pro.specialty.credentialForm'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.credential.skip')).tap();
  await waitFor(element(by.id('pro.specialty.row.nutritionist'))).toBeVisible().withTimeout(5000);
  await element(by.id('pro.specialty.cta_continue')).tap();
  await waitFor(element(by.id('pro.home.screen'))).toBeVisible().withTimeout(10000);
  await element(by.id('tabs.students')).tap();
  await waitFor(element(by.id('pro.students.search'))).toBeVisible().withTimeout(10000);
}

describeWithE2EAuthSession('Professional Student Profile', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('shows per-student nutrition and training assignment state', async () => {
    await selectProfessionalRole();
    await openStudentsTab();

    await waitFor(element(by.id('pro.students.row.e2e-dual-student'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.students.row.e2e-dual-student')).tap();

    await waitFor(element(by.id('pro.student_profile.screen'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.student_profile.nutrition.assignmentCard'))).toBeVisible();
    await expect(element(by.id('pro.student_profile.training.assignmentCard'))).toBeVisible();
    await expect(element(by.id('pro.student_profile.nutrition.title'))).toBeVisible();
    await expect(element(by.id('pro.student_profile.training.title'))).toBeVisible();
    await expect(element(by.text('Active, awaiting plan')).atIndex(0)).toBeVisible();
    await expect(element(by.text('Active, awaiting plan')).atIndex(1)).toBeVisible();
    await waitFor(element(by.id('pro.student_profile.unbindCta')))
      .toBeVisible()
      .whileElement(by.id('pro.student_profile.screen'))
      .scroll(520, 'down', 0.5, 0.8);
    await expect(element(by.id('pro.student_profile.error'))).not.toBeVisible();
  });

  it('assigns a predefined nutrition plan as a draft and can discard it', async () => {
    await selectProfessionalRole();
    await addNutritionSpecialtyAndOpenStudentsTab();

    await waitFor(element(by.id('pro.students.row.e2e-dual-student'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.students.row.e2e-dual-student')).tap();

    await waitFor(element(by.id('pro.student_profile.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('pro.student_profile.nutrition.cta_assign'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.student_profile.nutrition.cta_assign')).tap();

    await waitFor(element(by.id('planPicker.modal'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('planPicker.row.e2e-nutrition-predefined-plan'))).toBeVisible();
    await expect(element(by.id('planPicker.row.e2e-training-predefined-plan'))).not.toBeVisible();
    await device.tap({ x: 336, y: 520 });

    await waitFor(element(by.text('Plan assigned successfully.'))).toBeVisible().withTimeout(5000);
    await element(by.text('OK')).tap();
    await waitFor(element(by.id('pro.nutrition_plan.screen'))).toBeVisible().withTimeout(10000);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await device.tap({ x: 34, y: 82 });
    await waitFor(element(by.id('pro.student_profile.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.text('Draft pending send'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.student_profile.nutrition.cta_resume_draft'))).toBeVisible();
    await expect(element(by.id('pro.student_profile.nutrition.cta_discard'))).toBeVisible();

    await element(by.id('pro.student_profile.nutrition.cta_discard')).tap();
    await waitFor(element(by.text('Discard'))).toBeVisible().withTimeout(5000);
    await element(by.text('Discard')).atIndex(1).tap();
    await waitFor(element(by.text('Draft discarded successfully.'))).toBeVisible().withTimeout(5000);
    await element(by.text('OK')).tap();

    await waitFor(element(by.text('Active, awaiting plan')).atIndex(0)).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.student_profile.nutrition.cta_assign'))).toBeVisible();
    await expect(element(by.id('pro.student_profile.nutrition.cta_resume_draft'))).not.toBeVisible();
  });

  it('shows student tracking review and can mark a plan change request reviewed', async () => {
    await selectProfessionalRole();
    await openStudentsTab();

    await waitFor(element(by.id('pro.students.row.e2e-dual-student'))).toBeVisible().withTimeout(10000);
    await element(by.id('pro.students.row.e2e-dual-student')).tap();

    await waitFor(element(by.id('pro.student_profile.screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('pro.student_profile.trackingReview'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('pro.student_profile.trackingReview.waterValue'))).toBeVisible().withTimeout(10000);

    await waitFor(element(by.id('pro.student_profile.planChangeRequest.e2e-plan-change-request-nutrition')))
      .toBeVisible()
      .whileElement(by.id('pro.student_profile.screen'))
      .scroll(520, 'down', 0.5, 0.8);
    await expect(element(by.text('Please add one more high-protein breakfast option.'))).toBeVisible();

    await element(by.id('pro.student_profile.planChangeRequest.e2e-plan-change-request-nutrition.review')).tap();
    await waitFor(element(by.text('No pending change requests.'))).toBeVisible().withTimeout(5000);
  });
});

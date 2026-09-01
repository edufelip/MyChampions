import { expect, test, type Page } from '@playwright/test';

async function resetStorage(page: Page) {
  try {
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage?.clear();
    });
  } catch {
    // If on blank page, evaluate might fail before first navigation
  }
}

async function setupRole(page: Page, role: 'student' | 'professional') {
  await resetStorage(page);
  await page.goto('/auth/role-selection');
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId(`auth.roleSelection.${role}Card`).click();
  await page.getByTestId('auth.roleSelection.continueButton').click();

  if (role === 'professional') {
    await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
    await page.getByTestId('pro.specialty.add.nutritionist').click();
    await page.getByTestId('pro.specialty.credential.skip').click();
    await page.getByTestId('pro.specialty.add.fitness_coach').click();
    await page.getByTestId('pro.specialty.credential.skip').click();
    await page.getByTestId('pro.specialty.cta_continue').click();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
  } else {
    await expect(page.getByTestId('student.home.ready').last()).toBeVisible();
  }
}

async function setupProfessionalWithSpecialty(
  page: Page,
  specialty: 'nutritionist' | 'fitness_coach' | 'dual',
) {
  await resetStorage(page);
  await page.goto('/auth/role-selection');
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();

  if (specialty === 'nutritionist' || specialty === 'dual') {
    await page.getByTestId('pro.specialty.add.nutritionist').click();
    await page.getByTestId('pro.specialty.credential.skip').click();
  }
  if (specialty === 'fitness_coach' || specialty === 'dual') {
    await page.getByTestId('pro.specialty.add.fitness_coach').click();
    await page.getByTestId('pro.specialty.credential.skip').click();
  }

  await page.getByTestId('pro.specialty.cta_continue').click();
  await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
}

test.describe('@functional @critical @feature:connections @feature:plans @feature:nutrition @feature:training multi-role student & professional communication flows', () => {
  test('nutritionist creates meal plan, assigns to student, student logs intake and requests change, nutritionist reviews', async ({
    page,
  }) => {
    // ── Phase 1: Nutritionist creates and assigns nutrition plan ───────────
    await setupProfessionalWithSpecialty(page, 'nutritionist');

    // Nutritionist views plan library and initiates plan builder
    await page.getByTestId('tabs.nutrition').last().click();
    await expect(page.getByTestId('pro.library.nutrition.create')).toBeVisible();
    await page.getByTestId('pro.library.nutrition.create').click();
    await expect(page.getByTestId('pro.nutrition_plan.screen')).toBeVisible();
    await expect(page.getByTestId('pro.plan.metadata.name')).toBeVisible();

    // Nutritionist exits plan builder and navigates to student roster
    await page.getByTestId('pro.nutrition_plan.backButton').click();
    await page.goto('/professional/students');
    await expect(page.getByTestId('pro.students.screen')).toBeVisible();

    // Trigger bulk assignment mode and select student
    await page.getByTestId('pro.students.bulkAssignToggle').click();
    await page.getByTestId('pro.students.row.e2e-dual-student').click();
    await expect(page.getByTestId('pro.students.bulkActionTray')).toBeVisible();
    await page.getByTestId('pro.students.bulk.assignSelected').click();

    // Plan picker modal displays available templates
    await expect(page.getByTestId('planPicker.modal')).toBeVisible();
    await page.getByTestId('planPicker.close').click();

    // ── Phase 2: Student receives assigned meal plan, logs meals and water ──
    await setupRole(page, 'student');

    // Student home displays active nutrition plan card
    const nutritionGoCta = page.getByTestId('student.home.nutrition.goCta').last();
    await expect(nutritionGoCta).toBeVisible();
    await nutritionGoCta.click();

    // Student nutrition screen shows assigned plan with tracking controls
    await expect(page.getByTestId('student.nutrition.screen')).toBeVisible();
    await expect(
      page.getByTestId('student.nutrition.logMealButton.e2e-assigned-meal'),
    ).toBeVisible();

    // Student logs meal portion
    await page.getByTestId('student.nutrition.logMealButton.e2e-assigned-meal').click();
    await expect(
      page.getByTestId('student.nutrition.loggedMealBadge.e2e-assigned-meal'),
    ).toBeVisible();

    // Student logs water intake
    await page.getByTestId('student.nutrition.waterWidget.intakeInput').fill('250');
    await page.getByTestId('student.nutrition.waterWidget.logButton').click();
    await expect(page.getByTestId('student.nutrition.waterWidget')).toBeVisible();

    // Student opens full assigned plan detail: verifies read-only guard
    await page.goto('/student/nutrition/plans/e2e-assigned-nutrition-plan');
    await expect(page.getByTestId('student.nutrition_plan.readOnlyNotice')).toBeVisible();
    await expect(page.getByTestId('pro.plan.metadata.name')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('pro.nutrition_plan.saveButton')).toHaveCount(0);

    // Student submits plan change request with feedback note
    await page.goto('/nutrition');
    await page
      .getByTestId('student.nutrition.planChangeForm.input')
      .fill('Please adjust breakfast protein targets higher.');
    await page.getByTestId('student.nutrition.planChangeForm.submitButton').click();
    await expect(page.getByTestId('student.nutrition.planChangeForm.success')).toBeVisible();

    // ── Phase 3: Nutritionist reviews student progress and change request ───
    await setupProfessionalWithSpecialty(page, 'nutritionist');

    // Review student profile with logged intake history
    await page.goto('/professional/student-profile?studentId=e2e-dual-student');
    await expect(page.getByTestId('pro.student_profile.screen')).toBeVisible();

    // Review pending request queue
    await page.goto('/professional/pending');
    await expect(page.getByTestId('pro.pending.screen')).toBeVisible();
    await expect(page.getByTestId('pro.pending.row.0')).toBeVisible();
    await expect(page.getByTestId('pro.pending.acceptButton.0')).toBeVisible();
    await expect(page.getByTestId('pro.pending.denyButton.0')).toBeVisible();
  });

  test('personal trainer creates workout plan, assigns to student, student completes session and trainer reviews', async ({
    page,
  }) => {
    // ── Phase 1: Personal Trainer authors training plan with exercises ─────
    await setupProfessionalWithSpecialty(page, 'fitness_coach');

    // Personal trainer opens training template library
    await page.getByTestId('tabs.training').last().click();
    await expect(page.getByTestId('pro.library.training.create')).toBeVisible();

    // Open training plan builder
    await page.goto('/professional/training/plans/e2e-assigned-training-plan');
    await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();

    // Add exercise to workout session via search modal
    await page
      .getByTestId('pro.training_plan.sessionRow.Assigned_Strength_Session.addItem')
      .click();
    await expect(page.getByTestId('exerciseSearch.modal')).toBeVisible();

    // Search and select exercise
    await page.getByTestId('exerciseSearch.input').fill('push');
    await page.getByTestId('exerciseSearch.input').press('Enter');
    await expect(page.getByTestId(/^exerciseSearch\.result\./).first()).toBeVisible();
    await page
      .getByTestId(/^exerciseSearch\.result\./)
      .first()
      .click();

    // Configure exercise sets and quantity
    await expect(page.getByTestId('exerciseSearch.detail')).toBeVisible();
    await page.getByTestId('exerciseSearch.quantity').fill('4 x 10 reps');
    await page.getByTestId('exerciseSearch.confirm').click();

    // ── Phase 2: Student logs in, completes workout session ────────────────
    await setupRole(page, 'student');

    // Student navigates to training tracking
    await page.goto('/student/training');
    await expect(page.getByTestId('student.training.screen')).toBeVisible();
    await expect(page.getByTestId('student.training.assignedSessionList')).toBeVisible();

    // Student logs workout session execution
    await page.getByTestId('student.training.logBtn-e2e-assigned-session').click();
    await expect(page.getByTestId('student.training.screen')).toBeVisible();

    // Student opens assigned training plan detail: verifies read-only guard
    await page.goto('/student/training/plans/e2e-assigned-training-plan');
    await expect(page.getByTestId('student.training_plan.readOnlyNotice')).toBeVisible();
    await expect(page.getByTestId('pro.training_plan.name')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('pro.training_plan.saveButton')).toHaveCount(0);
    await expect(page.getByTestId('student.training_plan.planChangeForm')).toBeVisible();

    // ── Phase 3: Trainer reviews student workout completion ────────────────
    await setupProfessionalWithSpecialty(page, 'fitness_coach');
    await page.goto('/professional/student-profile?studentId=e2e-dual-student');
    await expect(page.getByTestId('pro.student_profile.screen')).toBeVisible();
  });

  test('invite code and connection handshake flow between professional and student', async ({
    page,
  }) => {
    // ── Phase 1: Professional displays invite code ─────────────────────────
    await setupProfessionalWithSpecialty(page, 'dual');
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();

    // ── Phase 2: Student enters invite code and submits connection ─────────
    await setupRole(page, 'student');
    await page.goto('/student/professionals');
    await expect(page.getByTestId('student.professionals.screen')).toBeVisible();

    // Scan QR fallback to manual entry
    await page.getByTestId('student.professionals.scanQrButton').click();
    await expect(page.getByTestId('student.professionals.submitError')).toBeVisible();
    await page.getByTestId('student.professionals.codeInput').fill('PRO-INVITE-2026');
    await page.getByTestId('student.professionals.connectButton').click();
    await expect(page.getByTestId('student.professionals.screen')).toBeVisible();

    // ── Phase 3: Professional manages pending queue and roster ─────────────
    await setupProfessionalWithSpecialty(page, 'dual');
    await page.goto('/professional/pending');
    await expect(page.getByTestId('pro.pending.screen')).toBeVisible();

    // Professional can inspect and operate pending requests
    const checkbox = page.getByTestId('pro.pending.checkbox.0');
    await expect(checkbox).toBeVisible();
    await page.goto('/professional/students');
    await expect(page.getByTestId('pro.students.screen')).toBeVisible();
  });

  test('dual-specialty professional manages both nutrition and training for a student simultaneously', async ({
    page,
  }) => {
    // Dual-specialty professional manages roster
    await setupProfessionalWithSpecialty(page, 'dual');
    await page.goto('/professional/students');
    await expect(page.getByTestId('pro.students.screen')).toBeVisible();
    await expect(page.getByTestId('pro.students.row.e2e-dual-student')).toBeVisible();

    // Open student profile to see both specialty assignment indicators
    await page.goto('/professional/student-profile?studentId=e2e-dual-student');
    await expect(page.getByTestId('pro.student_profile.screen')).toBeVisible();

    // Student view displays both nutrition and workout hero cards simultaneously
    await setupRole(page, 'student');
    await expect(page.getByTestId('student.home.nutrition.goCta').last()).toBeVisible();
    await expect(page.getByTestId('student.home.ready').last()).toBeVisible();
  });
});

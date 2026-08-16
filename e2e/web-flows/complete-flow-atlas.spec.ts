import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureFlowEvidence } from '../web/support/evidence';

async function chooseRole(page: Page, role: 'student' | 'professional') {
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

async function countNestedButtons(page: Page, cardTestId: string): Promise<number> {
  return page.evaluate((testId) => {
    const card = document.querySelector(`[data-testid="${testId}"]`);
    if (!card) return -1;
    let nested = 0;
    card.querySelectorAll('button').forEach((outerButton) => {
      nested += outerButton.querySelectorAll('button').length;
    });
    return nested;
  }, cardTestId);
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  flow: string,
  checkpoint: string,
  visibleTestId: string,
) {
  await expect(page.getByTestId(visibleTestId).last()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await captureFlowEvidence(page, testInfo, flow, checkpoint);
}

test.describe('@flow-atlas @feature:shell complete product flow atlas', () => {
  test('role onboarding and quick student start', async ({ page }, testInfo) => {
    await page.goto('/auth/role-selection');
    await capture(
      page,
      testInfo,
      '01-role-onboarding',
      '01-role-selection',
      'auth.roleSelection.screen',
    );
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await capture(
      page,
      testInfo,
      '01-role-onboarding',
      '02-student-first-value-home',
      'student.home.ready',
    );
  });

  test('professional onboarding and specialty verification', async ({ page }, testInfo) => {
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.professionalCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await capture(
      page,
      testInfo,
      '02-professional-onboarding',
      '01-specialty-selection',
      'pro.specialty.screen',
    );
    await page.getByTestId('pro.specialty.add.nutritionist').click();
    await capture(
      page,
      testInfo,
      '02-professional-onboarding',
      '02-optional-credential-verification',
      'pro.specialty.credentialForm',
    );
    await page.getByTestId('pro.specialty.credential.skip').click();
    await capture(
      page,
      testInfo,
      '02-professional-onboarding',
      '03-active-specialty',
      'pro.specialty.row.nutritionist',
    );
    await page.getByTestId('pro.specialty.cta_continue').click();
    await capture(
      page,
      testInfo,
      '02-professional-onboarding',
      '04-professional-dashboard',
      'pro.home.screen',
    );
  });

  test('student daily care and assigned plan tracking', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await chooseRole(page, 'student');
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '01-home-with-assigned-plans',
      'student.home.ready',
    );

    await page.goto('/student/nutrition');
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '02-nutrition-tracking',
      'student.nutrition.screen',
    );

    // ET-99 regression guard: the assigned meal card must not nest interactive
    // controls (outer expand toggle wrapping the inner Log Meal button), which
    // previously produced invalid <button> nesting and a React hydration error
    // on every load of this screen.
    const nestedButtonCount = await countNestedButtons(
      page,
      'student.nutrition.mealCard.e2e-assigned-meal',
    );
    expect(nestedButtonCount).toBe(0);
    expect(
      consoleErrors.filter((text) => /descendant of|nested <button>|hydration error/i.test(text)),
    ).toEqual([]);

    const expandButton = page.getByTestId('student.nutrition.expandBtn.e2e-assigned-meal');
    await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    await expandButton.click();
    await expect(page.getByTestId('student.nutrition.mealDetails.e2e-assigned-meal')).toBeVisible();
    await expect(expandButton).toHaveAttribute('aria-expanded', 'true');
    await expandButton.click();
    await expect(page.getByTestId('student.nutrition.mealDetails.e2e-assigned-meal')).toBeHidden();

    // ET-99 follow-up: the meal name/summary block is its own sibling toggle
    // (mirrors the training-session card's larger tap target) and must drive
    // the exact same expand/collapse state as the chevron button above,
    // without reintroducing nested-button DOM (re-checked below).
    const headerToggle = page.getByTestId('student.nutrition.mealHeaderToggle.e2e-assigned-meal');
    await expect(headerToggle).toHaveAttribute('aria-expanded', 'false');
    await headerToggle.click();
    await expect(page.getByTestId('student.nutrition.mealDetails.e2e-assigned-meal')).toBeVisible();
    await expect(headerToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(expandButton).toHaveAttribute('aria-expanded', 'true');
    await headerToggle.click();
    await expect(page.getByTestId('student.nutrition.mealDetails.e2e-assigned-meal')).toBeHidden();
    await expect(expandButton).toHaveAttribute('aria-expanded', 'false');

    const nestedButtonCountAfterToggle = await countNestedButtons(
      page,
      'student.nutrition.mealCard.e2e-assigned-meal',
    );
    expect(nestedButtonCountAfterToggle).toBe(0);

    await page.getByTestId('student.nutrition.logMealButton.e2e-assigned-meal').click();
    await expect(
      page.getByTestId('student.nutrition.loggedMealBadge.e2e-assigned-meal'),
    ).toBeVisible();

    await page.getByTestId('student.nutrition.waterWidget.intakeInput').fill('250');
    await page.getByTestId('student.nutrition.waterWidget.logButton').click();
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '03-water-intake-logged',
      'student.nutrition.waterWidget',
    );

    await page
      .getByTestId('student.nutrition.planChangeForm.input')
      .fill('Please add another high-protein breakfast option.');
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '04-plan-change-request-ready',
      'student.nutrition.planChangeForm',
    );
    await page.getByTestId('student.nutrition.planChangeForm.submitButton').click();
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '05-plan-change-request-submitted',
      'student.nutrition.planChangeForm.success',
    );

    // ET-107 (D-006): a Student opening a professionally assigned plan must see a
    // read-only detail — never the editable professional builder surface.
    await page.goto('/student/nutrition/plans/e2e-assigned-nutrition-plan');
    await expect(page.getByTestId('student.nutrition_plan.readOnlyNotice')).toBeVisible();
    await expect(page.getByTestId('pro.plan.metadata.name')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('pro.nutrition_plan.saveButton')).toHaveCount(0);
    await expect(page.getByTestId('pro.nutrition_plan.addMeal')).toHaveCount(0);
    await expect(page.getByTestId('student.nutrition_plan.planChangeForm')).toBeVisible();
    const assignedNutritionNameBox = await page.getByTestId('pro.plan.metadata.name').boundingBox();
    expect(assignedNutritionNameBox).not.toBeNull();
    expect(assignedNutritionNameBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(880);
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '06-assigned-nutrition-plan',
      'pro.nutrition_plan.screen',
    );

    await page.goto('/student/nutrition/plans/e2e-assigned-nutrition-plan/meals/e2e-assigned-meal');
    await expect(page.getByTestId('student.nutrition_meal.readOnlyNotice')).toBeVisible();
    await expect(page.getByTestId('pro.nutrition_meal.addFood')).toHaveCount(0);
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '07-assigned-meal-detail',
      'pro.nutrition_meal.screen',
    );

    await page.goto('/student/training');
    await expect(page.getByTestId('student.training.assignedSessionList')).toBeVisible();
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '08-training-tracking',
      'student.training.screen',
    );
    await page.getByTestId('student.training.logBtn-e2e-assigned-session').click();
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '09-workout-session-logged',
      'student.training.screen',
    );

    // ET-107 (D-006): same read-only contract applies to the training plan route.
    await page.goto('/student/training/plans/e2e-assigned-training-plan');
    await expect(page.getByTestId('student.training_plan.readOnlyNotice')).toBeVisible();
    await expect(page.getByTestId('pro.training_plan.name')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('pro.training_plan.saveButton')).toHaveCount(0);
    await expect(page.getByTestId('pro.training_plan.addSession')).toHaveCount(0);
    await expect(page.getByTestId('student.training_plan.planChangeForm')).toBeVisible();
    await capture(
      page,
      testInfo,
      '03-student-daily-care',
      '10-assigned-training-plan',
      'pro.training_plan.screen',
    );
  });

  test('student professional connection and QR fallback', async ({ page, context }, testInfo) => {
    await context.clearPermissions();
    await chooseRole(page, 'student');
    await page.goto('/student/professionals');
    await capture(
      page,
      testInfo,
      '04-student-connections',
      '01-active-professionals',
      'student.professionals.screen',
    );
    await page.getByTestId('student.professionals.unbindButton.0').click();
    await capture(
      page,
      testInfo,
      '04-student-connections',
      '02-end-relationship-confirmation',
      'student.professionals.unbindConfirm',
    );
    await page.getByTestId('student.professionals.unbindConfirm.cancel').click();
    await page.getByTestId('student.professionals.scanQrButton').click();
    await capture(
      page,
      testInfo,
      '04-student-connections',
      '03-camera-unavailable-manual-fallback',
      'student.professionals.submitError',
    );
    await page.getByTestId('student.professionals.codeInput').fill('NUT-FLOW-001');
    await page.getByTestId('student.professionals.connectButton').click();
    await capture(
      page,
      testInfo,
      '04-student-connections',
      '04-invite-pending-confirmation',
      'student.professionals.screen',
    );
  });

  test('custom meal create edit quick log share and AI analysis', async ({ page }, testInfo) => {
    await chooseRole(page, 'student');
    await page.goto('/nutrition/custom-meals');
    await capture(
      page,
      testInfo,
      '05-custom-meals',
      '01-saved-meal-library',
      'meal.library.screen',
    );

    await page.getByTestId('meal.library.row.e2e-custom-meal.log').click();
    const quickLogBox = await page.getByTestId('meal.library.quickLog.panel').boundingBox();
    expect(quickLogBox).not.toBeNull();
    expect(quickLogBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(560);
    await capture(
      page,
      testInfo,
      '05-custom-meals',
      '02-quick-log-portion',
      'meal.library.quickLog.panel',
    );
    await page.getByTestId('meal.library.quickLog.analysis.cta').click();
    await expect(page.getByTestId('meal.library.quickLog.analysis.done')).toBeVisible();
    await capture(
      page,
      testInfo,
      '05-custom-meals',
      '03-ai-photo-analysis-result',
      'meal.library.quickLog.analysis.done',
    );

    await page.goto('/nutrition/custom-meals/e2e-custom-meal');
    await expect(page.getByTestId('meal.builder.field.name.input')).toHaveValue(
      'E2E Recovery Bowl',
    );
    await capture(page, testInfo, '05-custom-meals', '04-edit-custom-meal', 'meal.builder.screen');
    await page.getByTestId('meal.builder.imageUpload').click();
    await capture(
      page,
      testInfo,
      '05-custom-meals',
      '05-image-upload-complete',
      'meal.builder.imageUpload.preview',
    );

    await page.goto('/nutrition/custom-meals/new');
    await capture(
      page,
      testInfo,
      '05-custom-meals',
      '06-create-custom-meal',
      'meal.builder.screen',
    );
  });

  test('shared recipe preview and idempotent save', async ({ page }, testInfo) => {
    await chooseRole(page, 'student');
    await page.goto('/shared/recipes/e2e-shared-recipe');
    await capture(
      page,
      testInfo,
      '06-shared-recipes',
      '01-shared-recipe-preview',
      'shared_recipe.preview',
    );
    await page.getByTestId('shared_recipe.cta.save').click();
    await capture(
      page,
      testInfo,
      '06-shared-recipes',
      '02-recipient-owned-copy-saved',
      'shared_recipe.saved',
    );
  });

  test('professional workbench roster queue and student review', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await chooseRole(page, 'professional');
    await capture(
      page,
      testInfo,
      '07-professional-care-management',
      '01-task-workbench',
      'pro.home.screen',
    );

    await page.getByTestId('tabs.students').last().click();
    await capture(
      page,
      testInfo,
      '07-professional-care-management',
      '02-student-roster-and-bulk-assignment',
      'pro.students.screen',
    );
    await page.getByTestId('pro.students.bulkAssignToggle').click();
    await page.getByTestId('pro.students.row.e2e-dual-student').click();
    const bulkTrayBox = await page.getByTestId('pro.students.bulkActionTray').boundingBox();
    expect(bulkTrayBox).not.toBeNull();
    if (bulkTrayBox) {
      const viewportWidth = page.viewportSize()?.width ?? 0;
      expect(bulkTrayBox.x).toBeGreaterThanOrEqual(24);
      expect(viewportWidth - bulkTrayBox.x - bulkTrayBox.width).toBeGreaterThanOrEqual(24);
    }
    await capture(
      page,
      testInfo,
      '07-professional-care-management',
      '03-bulk-assignment-selection',
      'pro.students.bulk.assignSelected',
    );
    await page.getByTestId('pro.students.bulk.assignSelected').click();
    await capture(
      page,
      testInfo,
      '07-professional-care-management',
      '04-bulk-plan-picker',
      'planPicker.modal',
    );

    await page.goto('/professional/student-profile?studentId=e2e-dual-student');
    await capture(
      page,
      testInfo,
      '07-professional-care-management',
      '05-student-profile-and-tracking-review',
      'pro.student_profile.screen',
    );

    await page.goto('/professional/pending');
    await capture(
      page,
      testInfo,
      '07-professional-care-management',
      '06-pending-request-queue',
      'pro.pending.screen',
    );

    // ET-106 regression guard: the pending row must not nest interactive
    // controls (a row-level button wrapping the checkbox, Accept, and Deny),
    // which previously produced invalid <button> nesting and a React
    // hydration error on every load of this screen.
    const nestedButtonCount = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="pro.pending.row.0"]');
      if (!row) return -1;
      let nested = 0;
      row.querySelectorAll('button').forEach((outerButton) => {
        nested += outerButton.querySelectorAll('button').length;
      });
      return nested;
    });
    expect(nestedButtonCount).toBe(0);
    expect(
      consoleErrors.filter((text) => /descendant of|nested <button>|hydration error/i.test(text)),
    ).toEqual([]);

    // Row selection, Accept, and Deny are independent, ordered focus stops —
    // no control is nested inside another, and keyboard Tab order matches the
    // visual left-to-right layout (checkbox, then Accept, then Deny).
    const checkbox = page.getByTestId('pro.pending.checkbox.0');
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await checkbox.focus();
    await expect(checkbox).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('pro.pending.acceptButton.0')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('pro.pending.denyButton.0')).toBeFocused();

    // Row selection remains independently operable via the checkbox, exposes
    // checked state, and does not trigger Accept/Deny.
    await page.getByTestId('pro.pending.row.0').click({ position: { x: 20, y: 20 } });
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    await capture(
      page,
      testInfo,
      '07-professional-care-management',
      '07-pending-bulk-deny-selection',
      'pro.pending.bulkDenyButton',
    );
  });

  test('professional nutrition and training authoring', async ({ page }, testInfo) => {
    await chooseRole(page, 'professional');

    await page.getByTestId('tabs.nutrition').last().click();
    await expect(page.getByTestId('pro.library.nutrition.create')).toBeVisible();
    await captureFlowEvidence(
      page,
      testInfo,
      '08-professional-plan-authoring',
      '01-nutrition-template-library',
    );
    await page.getByTestId('pro.library.nutrition.create').click();
    await capture(
      page,
      testInfo,
      '08-professional-plan-authoring',
      '02-new-nutrition-plan-builder',
      'pro.nutrition_plan.screen',
    );

    await page.getByTestId('pro.nutrition_plan.backButton').click();
    await page.getByTestId('tabs.training').last().click();
    await expect(page.getByTestId('pro.library.training.create')).toBeVisible();
    await captureFlowEvidence(
      page,
      testInfo,
      '08-professional-plan-authoring',
      '03-training-template-library',
    );
    await page.getByTestId('pro.library.training.create').click();
    await capture(
      page,
      testInfo,
      '08-professional-plan-authoring',
      '04-new-training-plan-builder',
      'pro.training_plan.screen',
    );
    await page.goto('/professional/training/plans/e2e-assigned-training-plan');
    await page
      .getByTestId('pro.training_plan.sessionRow.Assigned_Strength_Session.addItem')
      .click();
    await capture(
      page,
      testInfo,
      '08-professional-plan-authoring',
      '05-exercise-search',
      'exerciseSearch.modal',
    );
    await page.getByTestId('exerciseSearch.input').fill('push');
    await page.getByTestId('exerciseSearch.input').press('Enter');
    await expect(page.getByTestId(/^exerciseSearch\.result\./).first()).toBeVisible();
    await page
      .getByTestId(/^exerciseSearch\.result\./)
      .first()
      .click();
    await capture(
      page,
      testInfo,
      '08-professional-plan-authoring',
      '06-exercise-search-detail',
      'exerciseSearch.detail',
    );
  });

  test('professional subscription and specialty management', async ({ page }, testInfo) => {
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.professionalCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('pro.specialty.add.nutritionist').click();
    await page.getByTestId('pro.specialty.credential.skip').click();
    await page.getByTestId('pro.specialty.add.fitness_coach').click();
    await page.getByTestId('pro.specialty.credential.skip').click();
    await capture(
      page,
      testInfo,
      '09-professional-account-controls',
      '01-specialty-management',
      'pro.specialty.screen',
    );
    await page.getByTestId('pro.specialty.remove.nutritionist').click();
    await capture(
      page,
      testInfo,
      '09-professional-account-controls',
      '02-specialty-removal-assist',
      'pro.specialty.removalAssist',
    );
    await page.getByTestId('pro.specialty.removalAssist.dismiss').click();
    await page.getByTestId('pro.specialty.cta_continue').click();
    await page.getByTestId('pro.home.subscriptionCta').last().click();
    await capture(
      page,
      testInfo,
      '09-professional-account-controls',
      '03-subscription-entitlement',
      'pro.subscription.screen',
    );
  });

  test('account privacy language support and logout confirmation', async ({ page }, testInfo) => {
    await chooseRole(page, 'student');
    await page.goto('/settings/account');
    await capture(
      page,
      testInfo,
      '10-account-and-compliance',
      '01-account-privacy-settings',
      'settings.account.screen',
    );

    await page.getByTestId('settings.account.languageRow').click();
    await capture(
      page,
      testInfo,
      '10-account-and-compliance',
      '02-language-selection',
      'settings.languageSelect.screen',
    );
    await page.getByTestId('settings.languageSelect.option.pt-BR').click();
    await page.getByTestId('settings.languageSelect.saveButton').click();
    await capture(
      page,
      testInfo,
      '10-account-and-compliance',
      '03-portuguese-account-localization',
      'settings.account.screen',
    );

    await page.getByTestId('settings.account.contactRow').click();
    await capture(
      page,
      testInfo,
      '10-account-and-compliance',
      '04-support-message-dialog',
      'settings.account.support.modal',
    );
    await page.getByTestId('settings.account.support.subjectInput').fill('Flow atlas support');
    await page
      .getByTestId('settings.account.support.bodyInput')
      .fill('Deterministic support flow evidence.');
    await page.getByTestId('settings.account.support.submitCta').click();
    await capture(
      page,
      testInfo,
      '10-account-and-compliance',
      '05-support-message-sent',
      'settings.account.support.success',
    );
    await page.getByTestId('settings.account.support.closeButton').click();

    await page.getByTestId('settings.account.deleteCta').click();
    await capture(
      page,
      testInfo,
      '10-account-and-compliance',
      '06-delete-account-confirmation',
      'settings.account.deleteConfirm',
    );
    await page.getByTestId('settings.account.deleteCancelCta').click();

    await page.getByTestId('settings.account.signOutCta').click();
    await capture(
      page,
      testInfo,
      '10-account-and-compliance',
      '07-sign-out-confirmation',
      'settings.account.signOutConfirm',
    );
  });

  test('offline read-only recovery surfaces', async ({ page }, testInfo) => {
    await chooseRole(page, 'student');
    await page.evaluate(() => sessionStorage.setItem('mychampions.e2e.network-status', 'offline'));
    await page.reload();
    await capture(
      page,
      testInfo,
      '11-offline-read-only',
      '01-student-home-offline',
      'student.home.offlineBanner',
    );
    await page.getByTestId('tabs.nutrition').last().click();
    await capture(
      page,
      testInfo,
      '11-offline-read-only',
      '02-nutrition-write-lock',
      'student.nutrition.offlineBanner',
    );
    await page.evaluate(() => sessionStorage.removeItem('mychampions.e2e.network-status'));
  });

  test('app modal opens and returns to the role home', async ({ page }, testInfo) => {
    await chooseRole(page, 'student');
    await page.goto('/modal');
    await capture(page, testInfo, '12-app-shell-modal', '01-modal-open', 'shell.modal.home');
    await page.getByTestId('shell.modal.home').click();
    await capture(
      page,
      testInfo,
      '12-app-shell-modal',
      '02-return-to-student-home',
      'student.home.ready',
    );
  });
});

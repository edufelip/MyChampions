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

describeWithE2EAuthSession('Professional Bulk Assign', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('selects eligible roster rows, chooses a predefined plan, and resets after assignment', async () => {
    await selectProfessionalRole();
    await openStudentsTab();

    await waitFor(element(by.id('pro.students.row.e2e-active-student'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.students.row.e2e-dual-student'))).toBeVisible();
    await expect(element(by.id('pro.students.row.e2e-pending-student'))).toBeVisible();

    await element(by.id('pro.students.bulkAssignToggle')).tap();
    await waitFor(element(by.id('pro.students.bulk.planType.nutrition'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('pro.students.row.e2e-pending-student'))).not.toBeVisible();

    await element(by.id('pro.students.row.e2e-active-student')).tap();
    await element(by.id('pro.students.row.e2e-dual-student')).tap();
    await waitFor(element(by.id('pro.students.bulk.assignSelected'))).toBeVisible().withTimeout(5000);
    await element(by.id('pro.students.bulk.assignSelected')).tap();

    await waitFor(element(by.id('planPicker.modal'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('planPicker.row.e2e-nutrition-predefined-plan'))).toBeVisible();
    await expect(element(by.id('planPicker.row.e2e-training-predefined-plan'))).not.toBeVisible();

    await device.tap({ x: 336, y: 520 });
    await waitFor(element(by.text('Plan assigned successfully.'))).toBeVisible().withTimeout(5000);
    await element(by.text('OK')).tap();

    await waitFor(element(by.id('pro.students.bulkAssignToggle'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('pro.students.search'))).toBeVisible();
  });
});

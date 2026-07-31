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
  await waitFor(element(by.id('pro.students.screen'))).toBeVisible().withTimeout(10000);
}

describeWithE2EAuthSession('Professional Student Roster', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('loads roster rows, filters them, searches by name, and opens a profile', async () => {
    await selectProfessionalRole();
    await openStudentsTab();

    await waitFor(element(by.id('pro.students.row.e2e-active-student'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.students.row.e2e-dual-student'))).toBeVisible();
    await expect(element(by.id('pro.students.row.e2e-pending-student'))).toBeVisible();

    await element(by.id('pro.students.filter.active')).tap();
    await waitFor(element(by.id('pro.students.row.e2e-pending-student')))
      .not.toExist()
      .withTimeout(5000);
    await expect(element(by.id('pro.students.row.e2e-active-student'))).toBeVisible();
    await expect(element(by.id('pro.students.row.e2e-dual-student'))).toBeVisible();

    await element(by.id('pro.students.search')).replaceText('Drew');
    await waitFor(element(by.id('pro.students.row.e2e-active-student')))
      .not.toExist()
      .withTimeout(5000);
    await expect(element(by.id('pro.students.row.e2e-dual-student'))).toBeVisible();

    await element(by.id('pro.students.search')).replaceText('');
    await element(by.id('pro.students.filter.pending')).tap();
    await waitFor(element(by.id('pro.students.row.e2e-pending-student'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id('pro.students.row.e2e-active-student')))
      .not.toExist()
      .withTimeout(5000);

    await element(by.id('pro.students.row.e2e-pending-student')).tap();
    await waitFor(element(by.id('pro.student_profile.screen'))).toBeVisible().withTimeout(10000);
  });
});

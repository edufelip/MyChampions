const describeWithE2EAuthSession = process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;

describeWithE2EAuthSession('Auth Role Selection', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  it('requires a role before continuing', async () => {
    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);

    await element(by.id('auth.roleSelection.continueButton')).tap();

    await waitFor(element(by.id('auth.roleSelection.error.roleRequired'))).toBeVisible().withTimeout(5000);
  });

  it('routes students to student home after role selection', async () => {
    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);

    await element(by.id('auth.roleSelection.studentCard')).tap();
    await element(by.id('auth.roleSelection.continueButton')).tap();

    await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
  });

  it('routes professionals to specialty setup after role selection', async () => {
    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);

    await element(by.id('auth.roleSelection.professionalCard')).tap();
    await element(by.id('auth.roleSelection.continueButton')).tap();

    await waitFor(element(by.id('pro.specialty.screen'))).toBeVisible().withTimeout(10000);
  });

  it('redirects students away from professional routes', async () => {
    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);

    await element(by.id('auth.roleSelection.studentCard')).tap();
    await element(by.id('auth.roleSelection.continueButton')).tap();
    await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);

    await device.openURL({ url: 'mychampions://professional/students' });

    await waitFor(element(by.id('student.home.screen'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('pro.students.screen'))).not.toBeVisible();
  });

  it('redirects professionals away from student routes', async () => {
    await waitFor(element(by.id('auth.roleSelection.title'))).toBeVisible().withTimeout(15000);

    await element(by.id('auth.roleSelection.professionalCard')).tap();
    await element(by.id('auth.roleSelection.continueButton')).tap();
    await waitFor(element(by.id('pro.specialty.screen'))).toBeVisible().withTimeout(10000);

    await device.openURL({ url: 'mychampions://student/professionals' });

    await waitFor(element(by.id('pro.home.screen'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('student.professionals.screen'))).not.toBeVisible();
  });
});

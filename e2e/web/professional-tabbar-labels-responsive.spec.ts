import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureEvidence } from './support/evidence';

async function chooseProfessional(page: Page) {
  await page.goto('/auth/role-selection');
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
  await page.getByTestId('pro.specialty.add.nutritionist').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.add.fitness_coach').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.cta_continue').click();
  await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
}

// Finds the single leaf text node rendered under a tab bar button (the
// label), and reports whether the browser is clipping it with an ellipsis.
async function readTabLabel(page: Page, tabTestId: string) {
  return page.evaluate((testId) => {
    const buttons = document.querySelectorAll(`[data-testid="${testId}"]`);
    const button = buttons[buttons.length - 1];
    if (!button) return null;
    const textNodes = Array.from(button.querySelectorAll('*')).filter(
      (node) => node.children.length === 0 && (node.textContent ?? '').trim().length > 0,
    );
    const labelNode = textNodes[textNodes.length - 1];
    if (!labelNode) return null;
    return {
      text: labelNode.textContent ?? '',
      // scrollWidth > clientWidth means the full text does not fit and the
      // browser is clipping/ellipsizing it — that's the truncation bug.
      isClipped: labelNode.scrollWidth > labelNode.clientWidth + 1,
    };
  }, tabTestId);
}

test.describe('@feature:professional bottom tab bar labels', () => {
  test('keeps Students and Training tab labels legible and untruncated at 320px width (ET-168)', async ({
    page,
  }, testInfo: TestInfo) => {
    // Regression guard for ET-168: app/professional/students.tsx and
    // app/professional/training.tsx each set their own (longer) web
    // document title via <Stack.Screen options={{ title }}>. Because the
    // parent Tabs.Screen entries for "students"/"training" in
    // app/(tabs)/_layout.tsx did not set an explicit tabBarLabel, that
    // nested document title bubbled up and replaced the tab's own short
    // label ("Students" -> "My students", "Training" -> "Training Plans"),
    // which truncated mid-word with an ellipsis in the narrow 64px tab
    // column at 320px CSS width.
    await page.setViewportSize({ width: 320, height: 568 });
    await chooseProfessional(page);

    await page.getByTestId('tabs.students').last().click();
    await expect(page.getByTestId('pro.students.hero.title').last()).toBeVisible();
    const studentsLabel = await readTabLabel(page, 'tabs.students');
    expect(studentsLabel).not.toBeNull();
    expect(studentsLabel?.text).toBe('Students');
    expect(studentsLabel?.isClipped).toBe(false);

    await captureEvidence(page, testInfo, 'professional-tabbar-students-320');

    await page.getByTestId('tabs.training').last().click();
    await expect(page.getByText('Training Plans').last()).toBeVisible();
    const trainingLabel = await readTabLabel(page, 'tabs.training');
    expect(trainingLabel).not.toBeNull();
    expect(trainingLabel?.text).toBe('Training');
    expect(trainingLabel?.isClipped).toBe(false);

    await captureEvidence(page, testInfo, 'professional-tabbar-training-320');
  });
});

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { enUS } from '@/localization/en-US';
import { esES } from '@/localization/es-ES';
import { ptBR } from '@/localization/pt-BR';
import { captureEvidence } from './support/evidence';

function getDashboardCopy(testInfo: TestInfo) {
  if (testInfo.project.use.locale === 'pt-BR') {
    return ptBR;
  }

  if (testInfo.project.use.locale === 'es-ES') {
    return esES;
  }

  return enUS;
}

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
  await expect(page.getByTestId('pro.home.connectionRequestTask').last()).toBeVisible();
}

async function assertNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
}

test.describe('@feature:professional compact professional dashboard', () => {
  test('stacks compact dashboard work cards without splitting labels mid-word', async ({
    page,
  }, testInfo: TestInfo) => {
    const copy = getDashboardCopy(testInfo);

    await page.setViewportSize({ width: 390, height: 844 });
    await chooseProfessional(page);
    await assertNoHorizontalOverflow(page);

    const dashboard = page.getByTestId('pro.home.screen').last();
    const activeStudents = dashboard.getByTestId('pro.home.activeStudents').last();
    const pendingConnections = dashboard.getByTestId('pro.home.pendingConnections').last();
    const connectionTask = dashboard.getByTestId('pro.home.connectionRequestTask').last();
    const taskTitle = connectionTask.getByText(copy['pro.home.connection_requests'], {
      exact: true,
    });
    const taskCta = connectionTask.getByText(copy['pro.home.cta_pending'], { exact: true });

    const [activeBox, pendingBox, taskBox, titleBox, ctaBox] = await Promise.all([
      activeStudents.boundingBox(),
      pendingConnections.boundingBox(),
      connectionTask.boundingBox(),
      taskTitle.boundingBox(),
      taskCta.boundingBox(),
    ]);
    expect(activeBox).not.toBeNull();
    expect(pendingBox).not.toBeNull();
    expect(taskBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(ctaBox).not.toBeNull();
    if (activeBox && pendingBox && taskBox && titleBox && ctaBox) {
      expect(activeBox.width).toBeGreaterThan(300);
      expect(pendingBox.width).toBeGreaterThan(300);
      expect(pendingBox.y).toBeGreaterThan(activeBox.y + activeBox.height);
      expect(taskBox.height).toBeGreaterThan(100);
      expect(titleBox.width).toBeGreaterThan(250);
      expect(ctaBox.y).toBeGreaterThan(titleBox.y + titleBox.height);
    }

    await captureEvidence(page, testInfo, 'professional-home-390-stacked');

    await page.setViewportSize({ width: 412, height: 915 });
    await page.reload();
    await expect(dashboard).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const [wideActiveBox, widePendingBox] = await Promise.all([
      activeStudents.boundingBox(),
      pendingConnections.boundingBox(),
    ]);
    expect(wideActiveBox).not.toBeNull();
    expect(widePendingBox).not.toBeNull();
    if (wideActiveBox && widePendingBox) {
      expect(Math.abs(wideActiveBox.y - widePendingBox.y)).toBeLessThanOrEqual(1);
      expect(widePendingBox.x).toBeGreaterThan(wideActiveBox.x + wideActiveBox.width);
    }

    await captureEvidence(page, testInfo, 'professional-home-412-two-column');
  });
});

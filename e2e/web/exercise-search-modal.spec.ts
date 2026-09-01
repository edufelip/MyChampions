import { devices, expect, test, type Page, type TestInfo } from '@playwright/test';
import { enUS } from '../../localization/en-US';

test.use({ ...devices['Pixel 5'] });

const dialogTitle = enUS['pro.plan.item.search.dialog_title'];

async function chooseProfessional(page: Page) {
  await page.goto('/auth/role-selection');
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
  await page.getByTestId('pro.specialty.cta_skip').click();
}

async function openExerciseSearch(page: Page) {
  await chooseProfessional(page);
  await page.goto('/professional/training/plans/e2e-assigned-training-plan');
  await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();
  await page.getByTestId('pro.training_plan.sessionRow.Assigned_Strength_Session.addItem').click();
}

async function expectInsideViewport(page: Page, testId: string) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;

  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectNoBrowserErrors(pageErrors: string[]) {
  expect(pageErrors).toEqual([]);
}

// ET-172: on desktop/Web-width viewports the dialog must render as a centered
// modal, not a mobile bottom sheet anchored to the viewport's bottom edge
// (ET-114 explicitly kept the bottom-sheet treatment for mobile/compact
// widths only). A sheet anchored to the bottom edge has near-zero top margin
// and its horizontal margins are unequal (flush left/right); a centered
// dialog has a real top margin and equal left/right margins.
async function expectCenteredDesktopDialog(page: Page, testId: string) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;

  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const leftMargin = box.x;
  const rightMargin = viewport.width - box.x - box.width;
  const topMargin = box.y;
  const bottomMargin = viewport.height - box.y - box.height;

  expect(topMargin).toBeGreaterThan(20);
  expect(bottomMargin).toBeGreaterThan(20);
  expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(2);
  expect(Math.abs(topMargin - bottomMargin)).toBeLessThanOrEqual(2);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
}

test('@feature:training exercise search opens with a useful initial state', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openExerciseSearch(page);

  const dialog = page.getByRole('dialog', { name: dialogTitle });
  const input = page.getByTestId('exerciseSearch.input');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(page.getByTestId('exerciseSearch.initialState')).toBeVisible();
  await expectInsideViewport(page, 'exerciseSearch.modal');
  await expectInsideViewport(page, 'exerciseSearch.input');
  await expect(input).toBeFocused();
  await capture(page, testInfo, 'exercise-search-initial');

  await input.fill('squat');
  await input.press('Enter');
  const loading = page.getByTestId('exerciseSearch.loadingState');
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute('aria-label', enUS['pro.plan.item.search.loading']);
  await expect(page.getByTestId('exerciseSearch.emptyState')).toBeVisible();

  await input.fill('error');
  await input.press('Enter');
  const errorState = page.getByTestId('exerciseSearch.errorState');
  await expect(errorState).toBeVisible();
  await expect(errorState).toHaveAttribute('role', 'alert');
  await expect(errorState).toHaveAttribute('aria-live', 'assertive');
  await expect(page.getByTestId('exerciseSearch.retry')).toBeVisible();
  await capture(page, testInfo, 'exercise-search-error');
  await page.getByTestId('exerciseSearch.retry').click();
  await expect(page.getByTestId('exerciseSearch.errorState')).toBeVisible();
  expect(
    consoleErrors.some((message) => message.includes('[useExerciseSearch] Search failed:')),
  ).toBe(true);
  expect(pageErrors).toEqual([]);

  await input.fill('push');
  await input.press('Enter');
  await expect(page.getByTestId('exerciseSearch.result.e2e-exercise-push-up')).toBeVisible();
  await expectInsideViewport(page, 'exerciseSearch.result.e2e-exercise-push-up');
  await capture(page, testInfo, 'exercise-search-results');

  await dialog.getByRole('button', { name: enUS['auth.role.cta_back'], exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectNoBrowserErrors(pageErrors);
});

test.describe('exercise search on a compact keyboard-safe viewport', () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test('@feature:training keeps the focused dialog usable when the viewport shrinks', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await openExerciseSearch(page);
    const dialog = page.getByRole('dialog', { name: dialogTitle });
    const input = page.getByTestId('exerciseSearch.input');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('exerciseSearch.initialState')).toBeVisible();
    await expect(input).toBeFocused();

    // A reduced viewport models the visible area after a mobile keyboard opens.
    await page.setViewportSize({ width: 320, height: 520 });
    await input.focus();
    await expectInsideViewport(page, 'exerciseSearch.modal');
    await expectInsideViewport(page, 'exerciseSearch.input');

    await input.fill('push');
    await input.press('Enter');
    await expect(page.getByTestId('exerciseSearch.result.e2e-exercise-push-up')).toBeVisible();
    await expectInsideViewport(page, 'exerciseSearch.result.e2e-exercise-push-up');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
    await capture(page, testInfo, 'exercise-search-compact-results');
    await dialog.getByRole('button', { name: enUS['auth.role.cta_back'], exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(consoleErrors).toEqual([]);
    await expectNoBrowserErrors(pageErrors);
  });
});

test.describe('exercise search on a desktop/Web-width viewport', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('@feature:training @feature:shell ET-172 renders as a centered dialog, not a bottom sheet', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await openExerciseSearch(page);
    const dialog = page.getByRole('dialog', { name: dialogTitle });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('exerciseSearch.initialState')).toBeVisible();
    await expectCenteredDesktopDialog(page, 'exerciseSearch.modal');

    await page.getByTestId('exerciseSearch.input').fill('push');
    await page.getByTestId('exerciseSearch.input').press('Enter');
    await expect(page.getByTestId('exerciseSearch.result.e2e-exercise-push-up')).toBeVisible();
    await page.getByTestId('exerciseSearch.result.e2e-exercise-push-up').click();
    await expect(page.getByTestId('exerciseSearch.detail')).toBeVisible();
    await expectCenteredDesktopDialog(page, 'exerciseSearch.modal');
  });
});

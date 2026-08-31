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

async function assertNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
}

test.describe('@feature:professional student roster hero heading', () => {
  test('gives the "My students" heading room to wrap between whole words at small-phone width', async ({
    page,
  }, testInfo: TestInfo) => {
    // Regression guard for ET-159: at 320px CSS width the hero row used to
    // cram the icon, the "My students" title, and the "Bulk assign plan"
    // pill into a single row, squeezing the title column so narrow that
    // "students" broke mid-word ("stude" / "nts") instead of wrapping
    // between whole words.
    await page.setViewportSize({ width: 320, height: 568 });
    await chooseProfessional(page);
    await page.getByTestId('tabs.students').last().click();

    const heroCopy = page.getByTestId('pro.students.hero.copy').last();
    const title = page.getByTestId('pro.students.hero.title').last();
    const cta = page.getByTestId('pro.students.bulkAssignToggle').last();
    await expect(heroCopy).toBeVisible();
    await expect(title).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const [copyBox, titleBox, ctaBox] = await Promise.all([
      heroCopy.boundingBox(),
      title.boundingBox(),
      cta.boundingBox(),
    ]);
    expect(copyBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(ctaBox).not.toBeNull();
    if (copyBox && titleBox && ctaBox) {
      // Squeezed alongside the icon and the CTA pill in one row, the title
      // column measured well under 100px wide (too narrow for "students" at
      // 24px to wrap on a whole word); with the CTA moved below, the title
      // column gets the card's near-full width instead.
      expect(copyBox.width).toBeGreaterThan(150);
      // The CTA no longer shares the title's row at this width — it sits on
      // its own row underneath, which is what frees up the title column.
      expect(ctaBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    }

    await captureEvidence(page, testInfo, 'professional-students-roster-320-heading');

    // At 390px (the existing, already-clean layout) the CTA stays on the
    // same row as the title — this test must not change that behavior.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(heroCopy).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const [wideTitleBox, wideCtaBox] = await Promise.all([title.boundingBox(), cta.boundingBox()]);
    expect(wideTitleBox).not.toBeNull();
    expect(wideCtaBox).not.toBeNull();
    if (wideTitleBox && wideCtaBox) {
      expect(Math.abs(wideTitleBox.y - wideCtaBox.y)).toBeLessThanOrEqual(wideTitleBox.height);
    }

    await captureEvidence(page, testInfo, 'professional-students-roster-390-heading');
  });
});

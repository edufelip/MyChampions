import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureEvidence } from './support/evidence';

async function assertNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
}

test.describe('@feature:auth password-reset toggle responsive', () => {
  test('keeps the new-password Show/Hide toggle fully on-screen at small-phone width', async ({
    page,
  }, testInfo: TestInfo) => {
    // Regression guard for ET-164: the "Set a new password" screen rendered the
    // Show/Hide toggle as a text-label pill with a fixed minWidth of 68px. At
    // 320px CSS width the row (20px screen padding on each side + a 10px gap +
    // that 68px pill) left the input too little room to shrink into, and the
    // toggle's right edge landed past the viewport's right edge — only a
    // sliver of the "Show" label stayed visible, exactly like the bug ET-164
    // reported (the ticket named the create-account screen, but that screen
    // already uses the icon-only toggle below and never reproduced the clip;
    // this screen is the one that actually did).
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/auth/password-reset');
    await expect(page.getByTestId('auth.resetPassword.screen')).toBeVisible();

    const newPasswordToggle = page.getByTestId('auth.resetPassword.newPasswordToggle').last();
    const confirmToggle = page
      .getByTestId('auth.resetPassword.newPasswordConfirmationToggle')
      .last();
    await expect(newPasswordToggle).toBeVisible();
    await expect(confirmToggle).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const [newBox, confirmBox] = await Promise.all([
      newPasswordToggle.boundingBox(),
      confirmToggle.boundingBox(),
    ]);
    expect(newBox).not.toBeNull();
    expect(confirmBox).not.toBeNull();
    if (newBox && confirmBox) {
      // Both toggles' right edges must stay within the 320px viewport.
      expect(newBox.x + newBox.width).toBeLessThanOrEqual(320);
      expect(confirmBox.x + confirmBox.width).toBeLessThanOrEqual(320);
    }

    await captureEvidence(page, testInfo, 'password-reset-320-toggle');

    // The already-clean 390px layout must keep working the same way.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(newPasswordToggle).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const wideBox = await newPasswordToggle.boundingBox();
    expect(wideBox).not.toBeNull();
    if (wideBox) {
      expect(wideBox.x + wideBox.width).toBeLessThanOrEqual(390);
    }

    await captureEvidence(page, testInfo, 'password-reset-390-toggle');
  });
});

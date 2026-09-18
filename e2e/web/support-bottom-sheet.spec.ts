import { expect, test, type Page } from '@playwright/test';

async function openSupportSheet(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.studentCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('student.home.ready').last()).toBeVisible();
  await page.getByTestId('tabs.account').last().click();
  await page.getByTestId('settings.account.supportQuickCta').click();
  await expect(page.getByTestId('settings.account.support.modal')).toBeVisible();
  await page.waitForTimeout(300);
}

test.describe('@critical @feature:account support bottom sheet', () => {
  test('uses a neutral backdrop, restrained CTA, and downward drag dismissal on compact web', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Compact pointer-gesture proof is Chromium-only',
    );
    await openSupportSheet(page);

    const overlay = page.getByTestId('settings.account.support.overlay');
    await expect(overlay).toHaveCSS('background-color', 'rgba(38, 36, 29, 0.32)');
    await expect(page.getByTestId('settings.account.support.submitCta')).toHaveCSS(
      'box-shadow',
      'rgba(0, 0, 0, 0) 0px 0px 0px 0px',
    );
    const screenshotPath = testInfo.outputPath('support-bottom-sheet-mobile.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('support-bottom-sheet-mobile', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    const handle = page.getByTestId('settings.account.support.dragHandle');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) return;

    const drag = async (distance: number) =>
      handle.evaluate(
        (element, input: { startY: number; distance: number }) => {
          const emit = (type: 'touchstart' | 'touchmove' | 'touchend', clientY: number) => {
            const touch = new Touch({
              identifier: 1,
              target: element,
              clientX: window.innerWidth / 2,
              clientY,
            });
            element.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                changedTouches: [touch],
                touches: type === 'touchend' ? [] : [touch],
                targetTouches: type === 'touchend' ? [] : [touch],
              }),
            );
          };

          emit('touchstart', input.startY);
          emit('touchmove', input.startY + input.distance);
          emit('touchend', input.startY + input.distance);
        },
        { startY: handleBox.y + handleBox.height / 2, distance },
      );

    await page.getByTestId('settings.account.support.subjectInput').fill('Login issue');
    await page.getByTestId('settings.account.support.bodyInput').fill('Draft stays here');
    await drag(40);
    await expect(page.getByTestId('settings.account.support.modal')).toBeVisible();
    await expect(page.getByTestId('settings.account.support.subjectInput')).toHaveValue(
      'Login issue',
    );
    await expect(page.getByTestId('settings.account.support.bodyInput')).toHaveValue(
      'Draft stays here',
    );

    await drag(180);

    await expect(page.getByTestId('settings.account.support.modal')).toBeHidden();
  });
});

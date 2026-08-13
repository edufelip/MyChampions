import { expect, test } from '@playwright/test';

test.describe('@manual-runtime @feature:auth shared WebView recovery', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('mychampions.e2e.locked-role', 'professional');
    });
  });

  test('duplicate URL query renders recovery action and returns to the app shell', async ({
    page,
  }, testInfo) => {
    await page.goto(
      '/shared/webview?intent=account&url=https%3A%2F%2Feduwaldo.com%2Fterms&url=javascript%3Aalert(1)',
    );

    await expect(page.getByTestId('shared.webview.screen')).toBeVisible();
    await expect(
      page.getByText('This link is unavailable because its address is missing or unsafe.'),
    ).toBeVisible();
    await expect(page.getByTestId('shared.webview.openExternal')).toHaveCount(0);

    const backButton = page.getByTestId('shared.webview.invalidLink.backButton');
    await expect(backButton).toBeVisible();
    await expect(backButton).toBeInViewport();

    const screenshotPath = testInfo.outputPath('duplicate-url-invalid-link-mobile.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('duplicate-url-invalid-link-mobile', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    await backButton.click();
    await expect(page).not.toHaveURL(/\/shared\/webview/);
    await expect(page.getByTestId('settings.account.screen')).toBeVisible();
  });

  test('opens the exact configured legal URL on a custom trusted host', async ({
    page,
  }, testInfo) => {
    await page.goto('/shared/webview?intent=account&url=https%3A%2F%2Flegal.example.test%2Fterms');

    await expect(page.getByTestId('shared.webview.screen')).toBeVisible();
    await expect(page.getByTestId('shared.webview.openExternal')).toBeVisible();
    await expect(page.getByTestId('shared.webview.invalidLink.backButton')).toHaveCount(0);

    const screenshotPath = testInfo.outputPath('configured-custom-legal-host-mobile.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('configured-custom-legal-host-mobile', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test('describes a valid legal link as a browser handoff, not an offline problem, and returns to account (ET-112)', async ({
    page,
  }, testInfo) => {
    await page.goto(
      '/shared/webview?intent=account&url=https%3A%2F%2Flegal.example.test%2Fterms&title=Terms%20of%20Service',
    );

    await expect(page.getByTestId('shared.webview.screen')).toBeVisible();

    // The screen must not claim the user is offline for a URL it already
    // validated and is happy to hand off to the browser.
    await expect(page.getByText(/internet access/i)).toHaveCount(0);
    await expect(page.getByText('This legal page opens in a new browser tab.')).toBeVisible();

    // The CTA names the actual destination instead of a generic combined
    // "terms and privacy policy" label.
    const openCta = page.getByTestId('shared.webview.openExternal');
    await expect(openCta).toBeVisible();
    await expect(openCta).toHaveAccessibleName('Open Terms of Service');

    const screenshotPath = testInfo.outputPath('valid-legal-link-browser-handoff-mobile.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('valid-legal-link-browser-handoff-mobile', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // A visible way back to Account that does not depend on the user
    // discovering the browser's own back control.
    const backButton = page.getByTestId('shared.webview.backButton');
    await expect(backButton).toBeVisible();
    await expect(backButton).toBeInViewport();
    await backButton.click();
    await expect(page).not.toHaveURL(/\/shared\/webview/);
    await expect(page.getByTestId('settings.account.screen')).toBeVisible();
  });
});

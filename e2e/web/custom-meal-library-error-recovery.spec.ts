import { expect, test } from '@playwright/test';

/**
 * ET-103 / TC-401 / SC-215 — Custom-meal library load error has no retry or
 * recovery action.
 *
 * The web-e2e lane (yarn test:e2e:web) runs Metro without a live backend, so
 * an authenticated student who opens the recipes tab (which mounts the
 * custom-meal library screen) deterministically hits the library's read-error
 * branch (`meal.library.error`) — this is the same fixture shape the ticket's
 * repro describes ("local auth-session fixture and no custom-meal provider
 * fixture"). That makes this a reliable negative-path assertion without a
 * mocked route.
 */

const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
] as const;

test.describe('@feature:nutrition custom-meal library load error recovery', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} recoverable library error exposes retry and a safe fallback`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');
      await page.getByTestId('auth.roleSelection.studentCard').click();
      await page.getByTestId('auth.roleSelection.continueButton').click();
      await page.getByTestId('tabs.recipes').last().click();

      const errorRegion = page.getByTestId('meal.library.error');
      await expect(errorRegion).toBeVisible();
      await expect(errorRegion).toContainText('Try again');

      const retryButton = page.getByTestId('meal.library.error.retry');
      const createFallback = page.getByTestId('meal.library.error.cta.create');
      await expect(retryButton).toBeVisible();
      await expect(createFallback).toBeVisible();

      // Bottom navigation must remain reachable from the error state.
      await expect(page.getByTestId('tabs.recipes').last()).toBeVisible();

      // No stale meal rows should be interactive behind the error state.
      await expect(page.locator('[data-testid^="meal.library.row."]')).toHaveCount(0);

      // Retry must actually re-run the load, not just leave the error card
      // in place. There is no live backend in this lane, so the loading
      // window is a single, sub-millisecond render pass — too short for a
      // post-click assertion to reliably observe — so watch for it with a
      // MutationObserver armed before the click (mirrors the manual
      // transition-timing proof from the PR's live verification). Without
      // this, a regression that silently drops the `reload()` wiring would
      // pass every other assertion in this test, since the error card looks
      // identical whether or not the click did anything.
      await page.evaluate(() => {
        (window as unknown as { __sawLibraryLoading?: boolean }).__sawLibraryLoading = false;
        const observer = new MutationObserver(() => {
          if (document.querySelector('[data-testid="meal.library.loading"]')) {
            (window as unknown as { __sawLibraryLoading?: boolean }).__sawLibraryLoading = true;
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      });
      await retryButton.click();
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { __sawLibraryLoading?: boolean }).__sawLibraryLoading,
          ),
        )
        .toBe(true);
      await expect(errorRegion).toBeVisible();
      await expect(page.getByTestId('meal.library.loading')).toHaveCount(0);
      await expect(retryButton).toBeVisible();

      // The safe fallback actually leaves the dead end and reaches a usable
      // create flow instead of just decorating the error card.
      await createFallback.click();
      await expect(page.getByTestId('meal.builder.screen')).toBeVisible();
    });
  }
});

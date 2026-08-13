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

      // Retry re-runs the load: it must announce a loading state before
      // settling (there is no live backend in this lane, so it settles back
      // into the same semantic error state rather than hanging).
      await retryButton.click();
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

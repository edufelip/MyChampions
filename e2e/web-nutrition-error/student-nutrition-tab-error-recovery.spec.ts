import { expect, test } from '@playwright/test';

/**
 * ET-163 — Nutrition tab error state ("Something went wrong. Try again.")
 * has no functioning retry control.
 *
 * The web-e2e lane (yarn test:e2e:web) runs Metro without a live backend, so
 * an authenticated student who opens the Nutrition tab deterministically hits
 * the top-level plans-load error branch (`student.nutrition.loadError`) —
 * the same fixture shape the ticket's repro describes (all `:3400` requests
 * failing, approximating an expired session). That makes this a reliable
 * negative-path assertion without a mocked route.
 */

const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
] as const;

test.describe('@feature:nutrition ET-163 nutrition tab load error recovery', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} settled nutrition tab error exposes a functioning retry control`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');
      await page.getByTestId('auth.roleSelection.studentCard').click();
      await page.getByTestId('auth.roleSelection.continueButton').click();
      await page.getByTestId('tabs.nutrition').last().click();

      const errorRegion = page.getByTestId('student.nutrition.loadError');
      await expect(errorRegion).toBeVisible();
      await expect(errorRegion).toContainText('Something went wrong. Try again.');

      const retryButton = page.getByTestId('student.nutrition.loadError.retry');
      await expect(retryButton).toBeVisible();

      // The reported bug: the "Try again." copy was static text with no
      // clickable control at all. Confirm a real button/role="button"
      // element resolves to it, not just visible text.
      const retryRole = await retryButton.evaluate((el) => el.getAttribute('role'));
      expect(retryRole).toBe('button');

      // Retry must actually re-invoke the failed load, not just leave the
      // error card in place. There is no live backend in this lane, so the
      // loading window is a single, sub-millisecond render pass — arm a
      // MutationObserver before the click to catch it regardless of timing.
      // This assumes React 18 batches the reload handler's synchronous
      // setState calls into one render that mounts the loading testID before
      // both plans and connections settle back to 'error'; if the reload
      // internals ever short-circuit that render, this assertion needs
      // revisiting rather than a longer timeout.
      await page.evaluate(() => {
        (window as unknown as { __sawNutritionLoading?: boolean }).__sawNutritionLoading = false;
        const observer = new MutationObserver(() => {
          if (document.querySelector('[data-testid="student.nutrition.plansLoading"]')) {
            (window as unknown as { __sawNutritionLoading?: boolean }).__sawNutritionLoading = true;
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      });
      await retryButton.click();
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { __sawNutritionLoading?: boolean }).__sawNutritionLoading,
          ),
        )
        .toBe(true);

      // Settles back into the same actionable error state — not a stuck
      // spinner, not a blank screen — every time, since this lane's failure
      // is deterministic.
      await expect(errorRegion).toBeVisible();
      await expect(page.getByTestId('student.nutrition.plansLoading')).toHaveCount(0);
      await expect(retryButton).toBeVisible();
    });
  }
});

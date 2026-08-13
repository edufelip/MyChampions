import { expect, test, type Page } from '@playwright/test';
import { enUS } from '../../localization/en-US';

// ET-105 / TC-310 / SC-212 regression coverage.
//
// Bug: the lapsed-over-cap locked card on /professional/subscription always
// used the exact `pro.subscription.locked` copy ("Restore or purchase a
// subscription to continue.") even when the browser purchaseCapability is
// `unavailable` (no purchase/restore/handoff control renders at all) or
// `mobile_handoff` (only a single "Continue on mobile" CTA renders — never a
// bare "restore" or "purchase" imperative). Asserting the exact copy per
// capability, rather than a loose substring ban, is what actually pins the
// bug: "restore" and "purchase" legitimately appear together in both the
// native and the fixed handoff/unavailable copy — the difference this ticket
// cares about is which control the sentence claims exists.
const nativeLockedCopy = enUS['pro.subscription.locked'];
const handoffLockedCopy = enUS['pro.subscription.locked_handoff'];
const unavailableLockedCopy = enUS['pro.subscription.locked_unavailable'];
//
// Fixture: EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=lapsed,
// EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=lapsed,
// EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=11 (see playwright.subscription-lock.config.ts),
// matching this ticket's reported preconditions exactly.
const UNAVAILABLE_BASE_URL = 'http://127.0.0.1:8291';
const HANDOFF_BASE_URL = 'http://127.0.0.1:8292';

const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
];

async function openLockedProfessionalSubscription(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/auth/role-selection`);
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await page.getByTestId('pro.specialty.cta_skip').click();
  await page.getByTestId('pro.home.screen').last().waitFor({ state: 'visible' });
  await page.getByTestId('pro.home.subscriptionCta').last().click();
  await page.getByTestId('pro.subscription.screen').last().waitFor({ state: 'visible' });
  await expect(page.getByTestId('pro.subscription.loading')).toHaveCount(0);
  await expect(page.getByTestId('pro.subscription.locked').last()).toBeVisible();
  await expect(page.getByTestId('pro.subscription.capUsage').last()).toContainText('11 / 10');
}

test.describe('@functional @feature:subscription lapsed-over-cap locked recovery copy', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} unavailable capability: locked card never references purchase/restore/handoff`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openLockedProfessionalSubscription(page, UNAVAILABLE_BASE_URL);

      const lockedText = await page.getByTestId('pro.subscription.locked').last().innerText();
      expect(lockedText).toBe(unavailableLockedCopy);
      expect(lockedText).not.toBe(nativeLockedCopy);
      expect(lockedText).not.toBe(handoffLockedCopy);

      await expect(page.getByTestId('pro.subscription.capabilityUnavailable').last()).toBeVisible();
      await expect(page.getByTestId('pro.subscription.purchaseCta')).toHaveCount(0);
      await expect(page.getByTestId('pro.subscription.restoreCta')).toHaveCount(0);
      await expect(page.getByTestId('pro.subscription.refreshCta').last()).toBeEnabled();
    });

    test(`${viewport.name} mobile_handoff capability: locked card names the mounted "Continue on mobile" CTA only`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openLockedProfessionalSubscription(page, HANDOFF_BASE_URL);

      const lockedText = await page.getByTestId('pro.subscription.locked').last().innerText();
      expect(lockedText).toBe(handoffLockedCopy);
      expect(lockedText).not.toBe(nativeLockedCopy);
      expect(lockedText).not.toBe(unavailableLockedCopy);

      await expect(page.getByTestId('pro.subscription.capabilityUnavailable')).toHaveCount(0);
      await expect(page.getByTestId('pro.subscription.purchaseCta').last()).toBeVisible();
      await expect(page.getByTestId('pro.subscription.purchaseCta').last()).toHaveText(
        /continue on mobile/i,
      );
      await expect(page.getByTestId('pro.subscription.restoreCta')).toHaveCount(0);
      await expect(page.getByTestId('pro.subscription.refreshCta').last()).toBeEnabled();
    });
  }
});

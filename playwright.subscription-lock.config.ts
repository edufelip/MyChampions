import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// ET-105 / TC-310 / SC-212 regression coverage: the lapsed-over-cap locked
// card must never tell the user to tap a purchase/restore/handoff control
// that isn't mounted for the current browser purchaseCapability.
//
// Two independent dev servers are booted because EXPO_PUBLIC_* fixture flags
// are baked in at server start, so exercising both the "unavailable" and
// "mobile_handoff" capability variants requires two distinct processes on
// two distinct ports rather than per-test overrides.
const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/subscription-lock-current',
);

const UNAVAILABLE_PORT = 8291;
const HANDOFF_PORT = 8292;

export default defineConfig({
  testDir: './e2e/web-subscription-lock',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifactRoot, 'html-report'), open: 'never' }],
    ['json', { outputFile: path.join(artifactRoot, 'results.json') }],
    ['junit', { outputFile: path.join(artifactRoot, 'results.xml') }],
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
  webServer: [
    {
      command: `CI=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=lapsed EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=lapsed EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=11 yarn web:dev --port ${UNAVAILABLE_PORT} --clear`,
      url: `http://127.0.0.1:${UNAVAILABLE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `CI=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=lapsed EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=lapsed EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=11 EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL=https://handoff.example.com/subscribe yarn web:dev --port ${HANDOFF_PORT} --clear`,
      url: `http://127.0.0.1:${HANDOFF_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

export const subscriptionLockPorts = { UNAVAILABLE_PORT, HANDOFF_PORT };

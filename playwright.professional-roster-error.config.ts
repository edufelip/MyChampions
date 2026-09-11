import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The roster-error spec must run without the positive roster fixture. Expo
// public environment values are baked into the web bundle at server startup,
// so this negative-path suite owns a separate server profile and port.
const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/professional-roster-error',
);
const webPort = Number.parseInt(process.env.PLAYWRIGHT_ROSTER_ERROR_WEB_PORT ?? '8094', 10);

export default defineConfig({
  testDir: './e2e/web',
  fullyParallel: false,
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
    baseURL: `http://127.0.0.1:${webPort}`,
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
  webServer: {
    command: `CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://127.0.0.1:3409 yarn web:dev --port ${webPort} --clear`,
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

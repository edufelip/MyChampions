import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/current',
);

export default defineConfig({
  testDir: './e2e/web',
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
    baseURL: 'http://127.0.0.1:8081',
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
  webServer: {
    command:
      'CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 yarn web:dev --port 8081 --clear',
    url: 'http://127.0.0.1:8081',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

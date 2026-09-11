import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { parseWebPort } from './scripts/ci/parse-web-port';

const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/training',
);
const webPort = parseWebPort(
  'PLAYWRIGHT_TRAINING_WEB_PORT',
  process.env.PLAYWRIGHT_TRAINING_WEB_PORT,
  8081,
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
    baseURL: `http://127.0.0.1:${webPort}`,
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
  webServer: {
    command: `CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE=basic EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE=assigned EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://127.0.0.1:${webPort} yarn web:dev --port ${webPort} --clear`,
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

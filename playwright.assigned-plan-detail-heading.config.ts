import path from 'node:path';
import { defineConfig } from '@playwright/test';

const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/assigned-plan-detail-heading',
);

export default defineConfig({
  testDir: './e2e/web',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifactRoot, 'html-report'), open: 'never' }],
    ['json', { outputFile: path.join(artifactRoot, 'results.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:8091',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE=assigned EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE=assigned yarn web:dev --port 8091 --clear',
    url: 'http://127.0.0.1:8091',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'small-phone',
      use: { browserName: 'chromium', viewport: { width: 320, height: 568 }, hasTouch: true },
    },
  ],
});

import { defineConfig } from '@playwright/test';
import path from 'node:path';

const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/flow-atlas',
);

export default defineConfig({
  testDir: './e2e/web-flows',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(artifactRoot, 'test-results-app'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifactRoot, 'html-report-app'), open: 'never' }],
    ['json', { outputFile: path.join(artifactRoot, 'results-app.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:8081',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: [
      'CI=1',
      'APP_VARIANT=dev',
      'EXPO_PUBLIC_E2E_AUTH_SESSION=true',
      'EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active',
      'EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=active',
      'EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2',
      'EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE=assigned',
      'EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE=assigned',
      'EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE=basic',
      'EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic',
      'EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic',
      'EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE=basic',
      'EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE=success',
      'EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE=basic',
      'EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE=basic',
      'EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE=success',
      'EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE=success',
      'yarn web:dev --port 8081 --clear',
    ].join(' '),
    url: 'http://127.0.0.1:8081',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 820, height: 1000 } } },
    { name: 'web', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
  ],
});

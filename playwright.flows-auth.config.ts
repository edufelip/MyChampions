import { defineConfig } from '@playwright/test';
import path from 'node:path';

const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/flow-atlas',
);

export default defineConfig({
  testDir: './e2e/web-flows-auth',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(artifactRoot, 'test-results-auth'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifactRoot, 'html-report-auth'), open: 'never' }],
    ['json', { outputFile: path.join(artifactRoot, 'results-auth.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:8084',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: [
      'CI=1',
      'APP_VARIANT=dev',
      'EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN=true',
      'EXPO_PUBLIC_E2E_CREATE_ACCOUNT=true',
      'EXPO_PUBLIC_E2E_SOCIAL_AUTH=true',
      'EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION=outdated-e2e-version',
      'yarn web:dev --port 8084 --clear',
    ].join(' '),
    url: 'http://127.0.0.1:8084',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 820, height: 1000 } } },
    { name: 'web', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
  ],
});

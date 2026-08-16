import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/professional-home',
);

export default defineConfig({
  testDir: './e2e/web',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifactRoot, 'html-report'), open: 'never' }],
    ['json', { outputFile: path.join(artifactRoot, 'results.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:8086',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE=basic yarn web:dev --port 8086 --clear',
    url: 'http://127.0.0.1:8086',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'mobile-professional', use: { ...devices['Pixel 5'], locale: 'en-US' } },
    { name: 'mobile-professional-pt', use: { ...devices['Pixel 5'], locale: 'pt-BR' } },
    { name: 'mobile-professional-es', use: { ...devices['Pixel 5'], locale: 'es-ES' } },
  ],
});

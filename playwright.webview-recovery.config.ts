import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const runId =
  process.env.WEB_E2E_RUN_ID ??
  `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`;
const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? `.artifacts/web-e2e/manual-webview-recovery/${runId}`,
);

export default defineConfig({
  testDir: './e2e/web-flows-auth',
  testMatch: '**/shared-webview-recovery.spec.ts',
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
    baseURL: 'http://127.0.0.1:8106',
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: [
      'CI=1',
      'EXPO_OFFLINE=1',
      'APP_VARIANT=dev',
      'EXPO_PUBLIC_E2E_AUTH_SESSION=true',
      'EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION=v1',
      'EXPO_PUBLIC_TERMS_URL=https://legal.example.test/terms',
      'yarn web:dev --port 8106 --clear',
    ].join(' '),
    url: 'http://127.0.0.1:8106',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 5'], locale: 'en-US' } }],
});

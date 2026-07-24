import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/server-current'
);

export default defineConfig({
  testDir: './e2e/web-server',
  fullyParallel: true,
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifactRoot, 'html-report'), open: 'never' }],
    ['json', { outputFile: path.join(artifactRoot, 'results.json') }],
    ['junit', { outputFile: path.join(artifactRoot, 'results.xml') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:8082',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'PORT=3401 WEB_E2E_ORIGIN=http://127.0.0.1:8082 bun run dev:web-e2e',
      cwd: '../server',
      url: 'http://127.0.0.1:3401/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command:
        'CI=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=false EXPO_PUBLIC_E2E_CREATE_ACCOUNT=false EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN=false EXPO_PUBLIC_E2E_SOCIAL_AUTH=false EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://127.0.0.1:3401 yarn web:dev --port 8082 --clear',
      url: 'http://127.0.0.1:8082',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

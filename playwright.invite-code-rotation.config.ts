import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

process.env.ET97_EXPECT_ANALYTICS = '1';

const artifactRoot = path.resolve('.artifacts/qa-invite-code-rotation');

export default defineConfig({
  testDir: './e2e/web',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8102',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'CI=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://127.0.0.1:8101 yarn web:dev --port 8102 --clear',
    url: 'http://127.0.0.1:8102',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 5'] } }],
});

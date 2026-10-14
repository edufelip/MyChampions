import path from 'node:path';
import { devices, type PlaywrightTestConfig } from '@playwright/test';
import { parseWebPort } from '../../../scripts/ci/parse-web-port';

export const WEB_TEST_PROFILE_NAMES = [
  'assigned-plan-detail-heading',
  'default',
  'custom-meal-error',
  'flows-auth',
  'flows',
  'invite-code-rotation',
  'password-reset-toggle',
  'professional-home',
  'professional-roster-error',
  'professional-students-roster',
  'professional-tabbar-labels',
  'server',
  'specialty-removal-assist',
  'student-nutrition-error',
  'subscription-lock',
  'training',
  'webview-recovery',
] as const;
export type WebTestProfileName = (typeof WEB_TEST_PROFILE_NAMES)[number];
export const subscriptionLockPorts = { UNAVAILABLE_PORT: 8291, HANDOFF_PORT: 8292 };
export interface WebTestProfile {
  artifactRoot: string;
  reportFiles: {
    outputDirName: string;
    reporters: ('list' | 'html' | 'json' | 'junit')[];
    htmlDirName?: string;
    jsonFileName?: string;
    junitFileName?: string;
  };
  config: Omit<PlaywrightTestConfig, 'outputDir' | 'reporter'>;
}

const profileFactories: Record<WebTestProfileName, () => WebTestProfile> = {
  'assigned-plan-detail-heading': () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/assigned-plan-detail-heading',
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        workers: 1,
        retries: 0,
        timeout: 60_000,
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
      },
    };
  },
  default: () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/current',
    );

    const webPort = parseWebPort('PLAYWRIGHT_WEB_PORT', process.env.PLAYWRIGHT_WEB_PORT, 8081);
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json', 'junit'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
        junitFileName: 'results.xml',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: true,
        forbidOnly: Boolean(process.env.CI),
        retries: process.env.CI ? 2 : 0,
        use: {
          baseURL: `http://127.0.0.1:${webPort}`,
          screenshot: 'only-on-failure',
          trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
        },
        webServer: {
          command: `CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE=assigned EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE=assigned EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE=basic EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE=success EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE=basic EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE=basic EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE=success EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE=success EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://127.0.0.1:${webPort} yarn web:dev --port ${webPort} --clear`,
          url: `http://127.0.0.1:${webPort}`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        projects: [
          { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ],
      },
    };
  },
  'custom-meal-error': () => {
    // The custom-meal error spec must run without the positive custom-meals
    // fixture. Expo public environment values are baked into the web bundle at
    // server startup, so this negative-path suite owns a separate server profile
    // and port.
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/custom-meal-error',
    );

    const webPort = parseWebPort(
      'PLAYWRIGHT_CUSTOM_MEAL_ERROR_WEB_PORT',
      process.env.PLAYWRIGHT_CUSTOM_MEAL_ERROR_WEB_PORT,
      8095,
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json', 'junit'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
        junitFileName: 'results.xml',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        forbidOnly: Boolean(process.env.CI),
        retries: process.env.CI ? 2 : 0,
        use: {
          baseURL: `http://127.0.0.1:${webPort}`,
          screenshot: 'only-on-failure',
          trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
        },
        webServer: {
          command: `CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://127.0.0.1:3410 yarn web:dev --port ${webPort} --clear`,
          url: `http://127.0.0.1:${webPort}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
      },
    };
  },
  'flows-auth': () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/flow-atlas',
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results-auth',
        reporters: ['list', 'html', 'json'],
        htmlDirName: 'html-report-auth',
        jsonFileName: 'results-auth.json',
      },
      config: {
        testDir: './e2e/web-flows-auth',
        testMatch: '**/authentication-flow-atlas.spec.ts',
        fullyParallel: false,
        workers: 1,
        retries: 0,
        use: {
          baseURL: 'http://127.0.0.1:8084',
          locale: 'en-US',
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
          { name: 'mobile', use: { ...devices['Pixel 5'], locale: 'en-US' } },
          {
            name: 'tablet',
            use: { browserName: 'chromium', viewport: { width: 820, height: 1000 } },
          },
          {
            name: 'web',
            use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } },
          },
        ],
      },
    };
  },
  flows: () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/flow-atlas',
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results-app',
        reporters: ['list', 'html', 'json'],
        htmlDirName: 'html-report-app',
        jsonFileName: 'results-app.json',
      },
      config: {
        testDir: './e2e/web-flows',
        fullyParallel: false,
        workers: 1,
        retries: 0,
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
          {
            name: 'mobile',
            use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
          },
          {
            name: 'tablet',
            use: { browserName: 'chromium', viewport: { width: 820, height: 1000 } },
          },
          {
            name: 'web',
            use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } },
          },
        ],
      },
    };
  },
  'invite-code-rotation': () => {
    const artifactRoot = path.resolve('.artifacts/qa-invite-code-rotation');
    return {
      artifactRoot,
      reportFiles: { outputDirName: 'test-results', reporters: ['list'] },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        workers: 1,
        retries: 0,
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
      },
    };
  },
  'password-reset-toggle': () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/password-reset-toggle',
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        workers: 1,
        retries: 0,
        use: {
          baseURL: 'http://127.0.0.1:8107',
          screenshot: 'only-on-failure',
          trace: 'retain-on-failure',
        },
        webServer: {
          command:
            'CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=false yarn web:dev --port 8107 --clear',
          url: 'http://127.0.0.1:8107',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        projects: [{ name: 'mobile-auth', use: { ...devices['Pixel 5'], locale: 'en-US' } }],
      },
    };
  },
  'professional-home': () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/professional-home',
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        workers: 1,
        retries: 0,
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
      },
    };
  },
  'professional-roster-error': () => {
    // The roster-error spec must run without the positive roster fixture. Expo
    // public environment values are baked into the web bundle at server startup,
    // so this negative-path suite owns a separate server profile and port.
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/professional-roster-error',
    );

    const webPort = parseWebPort(
      'PLAYWRIGHT_ROSTER_ERROR_WEB_PORT',
      process.env.PLAYWRIGHT_ROSTER_ERROR_WEB_PORT,
      8094,
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json', 'junit'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
        junitFileName: 'results.xml',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        forbidOnly: Boolean(process.env.CI),
        retries: process.env.CI ? 2 : 0,
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
      },
    };
  },
  'professional-students-roster': () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/professional-students-roster',
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        workers: 1,
        retries: 0,
        use: {
          baseURL: 'http://127.0.0.1:8089',
          screenshot: 'only-on-failure',
          trace: 'retain-on-failure',
        },
        webServer: {
          command:
            'CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE=basic yarn web:dev --port 8089 --clear',
          url: 'http://127.0.0.1:8089',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        projects: [
          { name: 'mobile-professional', use: { ...devices['Pixel 5'], locale: 'en-US' } },
        ],
      },
    };
  },
  'professional-tabbar-labels': () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/professional-tabbar-labels',
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        workers: 1,
        retries: 0,
        use: {
          baseURL: 'http://127.0.0.1:8168',
          screenshot: 'only-on-failure',
          trace: 'retain-on-failure',
        },
        webServer: {
          command:
            'CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE=basic yarn web:dev --port 8168 --clear',
          url: 'http://127.0.0.1:8168',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        projects: [
          { name: 'mobile-professional', use: { ...devices['Pixel 5'], locale: 'en-US' } },
        ],
      },
    };
  },
  server: () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/server-current',
    );

    const serverRoot = path.resolve(process.env.MYCHAMPIONS_SERVER_ROOT ?? '../server');
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json', 'junit'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
        junitFileName: 'results.xml',
      },
      config: {
        testDir: './e2e/web-server',
        fullyParallel: true,
        timeout: 90_000,
        forbidOnly: Boolean(process.env.CI),
        retries: 0,
        use: {
          baseURL: 'http://127.0.0.1:8082',
          screenshot: 'only-on-failure',
          trace: 'retain-on-failure',
        },
        webServer: [
          {
            command: 'PORT=3401 WEB_E2E_ORIGIN=http://127.0.0.1:8082 bun run dev:web-e2e',
            cwd: serverRoot,
            url: 'http://127.0.0.1:3401/health',
            reuseExistingServer: false,
            timeout: 60_000,
          },
          {
            command:
              'CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=false EXPO_PUBLIC_E2E_CREATE_ACCOUNT=false EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN=false EXPO_PUBLIC_E2E_SOCIAL_AUTH=false EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://127.0.0.1:3401 yarn web:dev --port 8082 --clear',
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
      },
    };
  },
  'specialty-removal-assist': () => {
    const artifactRoot = path.resolve('.artifacts/qa-specialty-removal-assist');
    return {
      artifactRoot,
      reportFiles: { outputDirName: 'test-results', reporters: ['list'] },
      config: {
        testDir: './e2e/web',
        fullyParallel: false,
        workers: 1,
        retries: 0,
        use: {
          baseURL: 'http://127.0.0.1:8100',
          screenshot: 'only-on-failure',
          trace: 'retain-on-failure',
        },
        webServer: {
          command:
            'CI=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=active EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic yarn web:dev --port 8100 --clear',
          url: 'http://127.0.0.1:8100',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        projects: [{ name: 'chromium', use: { ...devices['Pixel 5'] } }],
      },
    };
  },
  'student-nutrition-error': () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/student-nutrition-error',
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
      },
      config: {
        testDir: './e2e/web-nutrition-error',
        fullyParallel: false,
        workers: 1,
        retries: 0,
        use: {
          baseURL: 'http://127.0.0.1:8103',
          screenshot: 'only-on-failure',
          trace: 'retain-on-failure',
        },
        webServer: {
          command:
            'CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE=error yarn web:dev --port 8103 --clear',
          url: 'http://127.0.0.1:8103',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
      },
    };
  },
  'subscription-lock': () => {
    // ET-105 / TC-310 / SC-212 regression coverage: the lapsed-over-cap locked
    // card must never tell the user to tap a purchase/restore/handoff control
    // that isn't mounted for the current browser purchaseCapability.
    //
    // Two independent dev servers are booted because EXPO_PUBLIC_* fixture flags
    // are baked in at server start, so exercising both the "unavailable" and
    // "mobile_handoff" capability variants requires two distinct processes on
    // two distinct ports rather than per-test overrides.
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/subscription-lock-current',
    );

    const { UNAVAILABLE_PORT, HANDOFF_PORT } = subscriptionLockPorts;
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json', 'junit'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
        junitFileName: 'results.xml',
      },
      config: {
        testDir: './e2e/web-subscription-lock',
        fullyParallel: true,
        forbidOnly: Boolean(process.env.CI),
        retries: process.env.CI ? 2 : 0,
        use: {
          screenshot: 'only-on-failure',
          trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
        },
        webServer: [
          {
            command: `CI=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=lapsed EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=lapsed EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=11 yarn web:dev --port ${UNAVAILABLE_PORT} --clear`,
            url: `http://127.0.0.1:${UNAVAILABLE_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
          {
            command: `CI=1 APP_VARIANT=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=lapsed EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=lapsed EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=11 EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL=https://handoff.example.com/subscribe yarn web:dev --port ${HANDOFF_PORT} --clear`,
            url: `http://127.0.0.1:${HANDOFF_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ],
        projects: [
          {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
          },
        ],
      },
    };
  },
  training: () => {
    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/training',
    );

    const webPort = parseWebPort(
      'PLAYWRIGHT_TRAINING_WEB_PORT',
      process.env.PLAYWRIGHT_TRAINING_WEB_PORT,
      8081,
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json', 'junit'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
        junitFileName: 'results.xml',
      },
      config: {
        testDir: './e2e/web',
        fullyParallel: true,
        forbidOnly: Boolean(process.env.CI),
        retries: process.env.CI ? 2 : 0,
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
      },
    };
  },
  'webview-recovery': () => {
    const runId =
      process.env.WEB_E2E_RUN_ID ??
      `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`;

    const artifactRoot = path.resolve(
      process.env.WEB_E2E_ARTIFACT_ROOT ?? `.artifacts/web-e2e/manual-webview-recovery/${runId}`,
    );
    return {
      artifactRoot,
      reportFiles: {
        outputDirName: 'test-results',
        reporters: ['list', 'html', 'json', 'junit'],
        htmlDirName: 'html-report',
        jsonFileName: 'results.json',
        junitFileName: 'results.xml',
      },
      config: {
        testDir: './e2e/web-flows-auth',
        testMatch: '**/shared-webview-recovery.spec.ts',
        fullyParallel: false,
        workers: 1,
        retries: 0,
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
      },
    };
  },
};

export function getWebTestProfile(name: WebTestProfileName): WebTestProfile {
  if (!Object.hasOwn(profileFactories, name))
    throw new RangeError('Unknown browser test profile: ' + name);
  return profileFactories[name]();
}

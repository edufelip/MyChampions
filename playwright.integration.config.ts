import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { loadIntegrationContext } from './scripts/testing/integration-context';
import {
  INTEGRATION_PROJECTS,
  INTEGRATION_SCENARIOS,
} from './scripts/testing/integration-registry';

const context = loadIntegrationContext();
const projects = [...new Set(context.cases.map((row) => row.project))];
const scenarios = [...new Set(context.cases.map((row) => row.scenarioId))];
export default defineConfig({
  testDir: './e2e/web-integration',
  testMatch: scenarios.map((id) => INTEGRATION_SCENARIOS.find((row) => row.id === id)!.spec),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(context.artifactRoot, 'playwright-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(context.artifactRoot, 'playwright-results.private.json') }],
  ],
  use: {
    baseURL: context.appOrigin,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
  },
  projects: projects.map((name) => ({
    name,
    use: {
      ...devices[INTEGRATION_PROJECTS[name].device],
      browserName: INTEGRATION_PROJECTS[name].browser,
      locale: INTEGRATION_PROJECTS[name].locale,
    },
  })),
});

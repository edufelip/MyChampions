import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

type ManifestSuite = {
  runner: string;
  ci: boolean;
  platforms?: string[];
  specs: string[];
};

type TestImpactManifest = {
  suites: Record<string, ManifestSuite>;
};

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, 'config/test-impact.json'), 'utf8')
) as TestImpactManifest;
const androidCiDetoxSpecs = [
  ...new Set(
    Object.values(manifest.suites)
      .filter(
        (suite) =>
          suite.runner === 'detox' &&
          suite.ci &&
          suite.platforms?.includes('android')
      )
      .flatMap((suite) => suite.specs)
  ),
];

test('Android CI Detox specs never reload React Native across the idling registry', () => {
  const offenders = androidCiDetoxSpecs.filter((spec) =>
    readFileSync(join(root, spec), 'utf8').includes('reloadReactNative')
  );

  assert.deepEqual(offenders, []);
});

test('student dashboard stories launch a fresh unsynchronized app per case', () => {
  const professionalsSource = readFileSync(
    join(root, 'e2e/student-professionals.e2e.test.js'),
    'utf8'
  );
  const homeSource = readFileSync(
    join(root, 'e2e/student-home.e2e.test.js'),
    'utf8'
  );

  assert.match(
    professionalsSource,
    /beforeEach\(async \(\) => \{\s+await device\.launchApp\(\{\s+newInstance: true,\s+permissions: \{ camera: 'YES' \},\s+launchArgs: \{ detoxEnableSynchronization: 0 \},\s+\}\);\s+\}\);/
  );
  assert.match(
    homeSource,
    /beforeEach\(async \(\) => \{\s+await device\.launchApp\(\{\s+newInstance: true,\s+launchArgs: \{ detoxEnableSynchronization: 0 \},\s+\}\);\s+\}\);/
  );
  assert.doesNotMatch(professionalsSource, /disableSynchronization/);
  assert.doesNotMatch(homeSource, /disableSynchronization/);
  assert.equal(professionalsSource.match(/device\.launchApp/g)?.length, 1);
  assert.equal(homeSource.match(/device\.launchApp/g)?.length, 1);
});

test('AI meal analysis executes only the fixture phase matching its scenario', () => {
  const source = readFileSync(
    join(root, 'e2e/custom-meal-ai-analysis.e2e.test.js'),
    'utf8'
  );

  assert.match(
    source,
    /mealAnalysisScenario === 'paywall' \? it : it\.skip/
  );
  assert.match(
    source,
    /mealAnalysisScenario === 'success' \? it : it\.skip/
  );
  assert.match(
    source,
    /itWithPaywallScenario\('shows the premium AI analysis gate/
  );
  assert.match(
    source,
    /itWithSuccessScenario\('analyzes a selected meal photo/
  );
});

test('authenticated AI meal analysis fails closed without a valid scenario', () => {
  const source = readFileSync(
    join(root, 'e2e/custom-meal-ai-analysis.e2e.test.js'),
    'utf8'
  );
  const noop = () => {};
  const selectable = Object.assign(noop, { skip: noop });
  const evaluate = (env: Record<string, string>) =>
    runInNewContext(source, {
      describe: selectable,
      it: selectable,
      process: { env },
    });

  assert.throws(
    () => evaluate({ E2E_AUTH_SESSION: 'true' }),
    /requires E2E_MEAL_ANALYSIS_SCENARIO=paywall\|success/
  );
  assert.throws(
    () =>
      evaluate({
        E2E_AUTH_SESSION: 'true',
        E2E_MEAL_ANALYSIS_SCENARIO: 'typo',
      }),
    /requires E2E_MEAL_ANALYSIS_SCENARIO=paywall\|success/
  );
  assert.doesNotThrow(() =>
    evaluate({
      E2E_AUTH_SESSION: 'true',
      E2E_MEAL_ANALYSIS_SCENARIO: 'paywall',
    })
  );
  assert.doesNotThrow(() =>
    evaluate({
      E2E_AUTH_SESSION: 'true',
      E2E_MEAL_ANALYSIS_SCENARIO: 'success',
    })
  );
  assert.doesNotThrow(() => evaluate({}));
});

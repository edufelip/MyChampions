import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { enUS } from '@/localization/en-US';

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
  readFileSync(join(root, 'config/test-impact.json'), 'utf8'),
) as TestImpactManifest;
const androidCiDetoxSpecs = [
  ...new Set(
    Object.values(manifest.suites)
      .filter(
        (suite) => suite.runner === 'detox' && suite.ci && suite.platforms?.includes('android'),
      )
      .flatMap((suite) => suite.specs),
  ),
];

test('Android CI Detox specs never reload React Native across the idling registry', () => {
  const offenders = androidCiDetoxSpecs.filter((spec) =>
    readFileSync(join(root, spec), 'utf8').includes('reloadReactNative'),
  );

  assert.deepEqual(offenders, []);
});

test('student dashboard stories launch a fresh unsynchronized app per case', () => {
  const professionalsSource = readFileSync(
    join(root, 'e2e/student-professionals.e2e.test.js'),
    'utf8',
  );
  const homeSource = readFileSync(join(root, 'e2e/student-home.e2e.test.js'), 'utf8');

  assert.match(
    professionalsSource,
    /beforeEach\(async \(\) => \{\s+await device\.launchApp\(\{\s+newInstance: true,\s+permissions: \{ camera: 'YES' \},\s+launchArgs: \{ detoxEnableSynchronization: 0 \},\s+\}\);\s+\}\);/,
  );
  assert.match(
    homeSource,
    /beforeEach\(async \(\) => \{\s+await device\.launchApp\(\{\s+newInstance: true,\s+launchArgs: \{ detoxEnableSynchronization: 0 \},\s+\}\);\s+\}\);/,
  );
  assert.doesNotMatch(professionalsSource, /disableSynchronization/);
  assert.doesNotMatch(homeSource, /disableSynchronization/);
  assert.equal(professionalsSource.match(/device\.launchApp/g)?.length, 1);
  assert.equal(homeSource.match(/device\.launchApp/g)?.length, 1);
});

test('AI meal analysis executes only the fixture phase matching its scenario', () => {
  const source = readFileSync(join(root, 'e2e/custom-meal-ai-analysis.e2e.test.js'), 'utf8');

  assert.match(source, /mealAnalysisScenario === 'paywall' \? it : it\.skip/);
  assert.match(source, /mealAnalysisScenario === 'success' \? it : it\.skip/);
  assert.match(source, /itWithPaywallScenario\([\s\S]*'shows the premium AI analysis gate/);
  assert.match(source, /itWithSuccessScenario\([\s\S]*'analyzes a selected meal photo/);
});

test('authenticated AI meal analysis fails closed without a valid scenario', () => {
  const source = readFileSync(join(root, 'e2e/custom-meal-ai-analysis.e2e.test.js'), 'utf8');
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
    /requires E2E_MEAL_ANALYSIS_SCENARIO=paywall\|success/,
  );
  assert.throws(
    () =>
      evaluate({
        E2E_AUTH_SESSION: 'true',
        E2E_MEAL_ANALYSIS_SCENARIO: 'typo',
      }),
    /requires E2E_MEAL_ANALYSIS_SCENARIO=paywall\|success/,
  );
  assert.doesNotThrow(() =>
    evaluate({
      E2E_AUTH_SESSION: 'true',
      E2E_MEAL_ANALYSIS_SCENARIO: 'paywall',
    }),
  );
  assert.doesNotThrow(() =>
    evaluate({
      E2E_AUTH_SESSION: 'true',
      E2E_MEAL_ANALYSIS_SCENARIO: 'success',
    }),
  );
  assert.doesNotThrow(() => evaluate({}));
});

test('custom meal image upload executes only the fixture phase matching its scenario', () => {
  const source = readFileSync(join(root, 'e2e/custom-meal-image-upload.e2e.test.js'), 'utf8');

  assert.match(source, /imageUploadScenario === 'sheet' \? it : it\.skip/);
  assert.match(source, /imageUploadScenario === 'success' \? it : it\.skip/);
  assert.match(source, /imageUploadScenario === 'permission-denied' \? it : it\.skip/);
  assert.match(source, /itWithSheetScenario\([\s\S]*'opens the upload source sheet/);
  assert.match(source, /itWithSuccessScenario\([\s\S]*'uploads a selected image/);
  assert.match(source, /itWithPermissionDeniedScenario\([\s\S]*'shows a permission error/);
  assert.match(
    source,
    /if \(device\.getPlatform\(\) !== 'android'\) \{[\s\S]*?by\.text\('Take photo'\)/,
  );
  assert.doesNotMatch(source, /dismissAndroidCameraPermissionPrompt/);
  const imageUploadHookSource = readFileSync(
    join(root, 'features/nutrition/use-image-upload.ts'),
    'utf8',
  );
  assert.match(
    imageUploadHookSource,
    /fixture === 'permission-denied' && Platform\.OS === 'android'/,
  );
  assert.equal(enUS['photo_picker.title'], 'Upload image');
  assert.match(source, /by\.text\('Upload image'\)/);
});

test('authenticated custom meal image upload fails closed without a valid scenario', () => {
  const source = readFileSync(join(root, 'e2e/custom-meal-image-upload.e2e.test.js'), 'utf8');
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
    /requires E2E_IMAGE_UPLOAD_SCENARIO=sheet\|success\|permission-denied/,
  );
  assert.throws(
    () =>
      evaluate({
        E2E_AUTH_SESSION: 'true',
        E2E_IMAGE_UPLOAD_SCENARIO: 'typo',
      }),
    /requires E2E_IMAGE_UPLOAD_SCENARIO=sheet\|success\|permission-denied/,
  );
  assert.doesNotThrow(() =>
    evaluate({
      E2E_AUTH_SESSION: 'true',
      E2E_IMAGE_UPLOAD_SCENARIO: 'sheet',
    }),
  );
  assert.doesNotThrow(() =>
    evaluate({
      E2E_AUTH_SESSION: 'true',
      E2E_IMAGE_UPLOAD_SCENARIO: 'success',
    }),
  );
  assert.doesNotThrow(() =>
    evaluate({
      E2E_AUTH_SESSION: 'true',
      E2E_IMAGE_UPLOAD_SCENARIO: 'permission-denied',
    }),
  );
  assert.doesNotThrow(() => evaluate({}));
});

test('native gap phases remain scenario-isolated', () => {
  const roleSource = readFileSync(join(root, 'e2e/auth-role-selection.e2e.test.js'), 'utf8');
  const connectionSource = readFileSync(
    join(root, 'e2e/student-professionals.e2e.test.js'),
    'utf8',
  );
  const fixtureSource = readFileSync(join(root, 'scripts/ci/detox-fixture-profiles.ts'), 'utf8');

  assert.match(roleSource, /rolePersistenceScenario === 'relaunch' \? it : it\.skip/);
  assert.match(
    readFileSync(join(root, 'features/auth/e2e-auth-session.ts'), 'utf8'),
    /EXPO_PUBLIC_E2E_ROLE_PERSISTENCE/,
  );
  assert.match(connectionSource, /qrInviteScenario === 'invalid_payload' \? it : it\.skip/);
  assert.match(connectionSource, /qrInviteScenario === 'valid_payload' \? it : it\.skip/);
  assert.match(connectionSource, /student\.professionals\.qrScanError/);
  assert.match(fixtureSource, /auth-role-persistence/);
  assert.match(fixtureSource, /image-upload-permission-denied/);
  assert.match(fixtureSource, /E2E_QR_INVITE_SCENARIO: 'valid_payload'/);
  assert.match(fixtureSource, /qr-invalid-payload/);
});

test('custom meal quick logging preserves grams and dismisses each native keyboard explicitly', () => {
  const source = readFileSync(join(root, 'e2e/custom-meal-library.e2e.test.js'), 'utf8');

  assert.match(
    source,
    /await gramsInput\.tap\(\);\s+await gramsInput\.replaceText\(customMealLogGrams\);\s+await expect\(gramsInput\)\.toHaveText\(customMealLogGrams\);\s+await dismissQuickLogKeyboard\(\);/,
  );
  assert.match(
    source,
    /if \(device\.getPlatform\(\) === 'android'\) \{\s+await device\.pressBack\(\);\s+return;\s+\}/,
  );
  assert.match(
    source,
    /waitFor\(doneButton\)\.toBeVisible\(\)\.withTimeout\(3000\);\s+await sleep\(750\);\s+await expect\(doneButton\)\.toBeVisible\(\);\s+await doneButton\.tap\(\);/,
  );
  assert.match(
    source,
    /waitFor\(confirmButton\)\.toBeVisible\(\)\.withTimeout\(5000\);\s+await confirmButton\.tap\(\);/,
  );
  assert.match(
    source,
    /waitFor\(element\(by\.id\('meal\.library\.quickLog\.panel'\)\)[\s\S]*?not\.toExist\(\)[\s\S]*?withTimeout\(10000\);/,
  );
  assert.doesNotMatch(source, /typeText\(customMealLogGrams\)/);
  assert.doesNotMatch(source, /device\.tap\(\{/);
});

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const readSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const suite = (path: string) => readSource(`.maestro/suite/${path}`);

const professionalNutritionPlanScreenSource = readSource(
  'app/professional/nutrition/plans/[planId].tsx',
);
const professionalNutritionMealScreenSource = readSource(
  'app/professional/nutrition/plans/[planId]/meals/[mealId].tsx',
);
const accountScreenSource = readSource('app/settings/account.tsx');
const planMetadataFormSource = readSource('features/plans/components/PlanMetadataForm.tsx');
const planPickerModalSource = readSource('components/ds/patterns/PlanPickerModal.tsx');

/** Every flow file below .maestro/suite (subflows included). */
function allSuiteFlows(): { path: string; source: string }[] {
  const root = join(process.cwd(), '.maestro/suite');
  const walk = (relative: string): { path: string; source: string }[] =>
    readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) => {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walk(child);
      return entry.name.endsWith('.yaml') ? [{ path: child, source: suite(child) }] : [];
    });
  return walk('');
}

/** `- scrollUntilVisible` to `id` immediately followed by a tap on the same id. */
function scrollsThenTaps(source: string, id: string): boolean {
  const escaped = id.replace(/\./g, '\\.');
  return new RegExp(
    `- scrollUntilVisible:\\n    element:\\n      id: ${escaped}\\n    direction: DOWN\\n(- waitForAnimationToEnd:\\n    timeout: \\d+\\n)?- tapOn:\\n    id: ${escaped}\\n`,
  ).test(source);
}

test('deterministic native flows never tap raw screen coordinates', () => {
  // Only the live RevenueCat paywall, whose close control is unlabelled, and the
  // shared hide-keyboard subflow's documented iOS margin tap may.
  const hideKeyboardMarginTap =
    /- runFlow:\n {10}when:\n {12}true: \$\{\(IOS_KEYBOARD \|\| 'margin'\) == 'margin'\}\n {10}commands:\n {12}- tapOn:\n {16}point: "2%,30%"\n/;
  const offenders = allSuiteFlows()
    .filter(({ path }) => !path.startsWith('revenuecat-test-store/'))
    .filter(({ path, source }) =>
      /point:/.test(
        path === 'common/hide-keyboard.yaml' ? source.replace(hideKeyboardMarginTap, '') : source,
      ),
    )
    .map(({ path }) => path);
  assert.deepEqual(offenders, []);
  assert.match(suite('common/hide-keyboard.yaml'), hideKeyboardMarginTap);
});

test('professional specialty stories scroll the credential action into view', () => {
  assert.ok(
    scrollsThenTaps(
      suite('common/pro-add-nutritionist-skip-credential.yaml'),
      'pro.specialty.credential.skip',
    ),
  );
  for (const path of [
    'professional-specialty/01-credential-partial-save-blocked.yaml',
    'professional-student-profile/02-assign-draft-and-discard.yaml',
    'professional-training-builder/01-create-add-exercise-remove.yaml',
  ]) {
    assert.ok(scrollsThenTaps(suite(path), 'pro.specialty.credential.skip'), path);
  }
  for (const path of [
    'professional-home-invite-code/01-regenerate-code.yaml',
    'professional-nutrition-builder/01-create-add-food-remove.yaml',
    'professional-specialty-removal/01-last-specialty-guarded.yaml',
  ]) {
    assert.match(
      suite(path),
      /runFlow: \.\.\/common\/pro-add-nutritionist-skip-credential\.yaml/,
      path,
    );
  }
});

test('professional invite-code story scrolls compact dashboard controls into view', () => {
  const controls = suite('common/pro-home-invite-controls.yaml');
  assert.match(controls, /- scrollUntilVisible:\n    element:\n      id: pro\.home\.rotateCodeCta/);
  assert.match(controls, /id: pro\.home\.inviteCodeValue\n    timeout: 10000/);
  assert.match(controls, /- assertVisible:\n    id: pro\.home\.shareCodeCta/);
  assert.equal(
    suite('professional-home-invite-code/01-regenerate-code.yaml').match(
      /runFlow: \.\.\/common\/pro-home-invite-controls\.yaml/g,
    )?.length,
    2,
  );
});

test('training builders scroll the save action into view before saving', () => {
  const builder = suite('professional-training-builder/01-create-add-exercise-remove.yaml');
  assert.equal(
    builder.match(
      /- scrollUntilVisible:\n    element:\n      id: pro\.training_plan\.saveButton\n    direction: DOWN\n- tapOn:\n    id: pro\.training_plan\.saveButton/g,
    )?.length,
    2,
  );
  assert.ok(scrollsThenTaps(builder, 'pro.training_plan.addSession'));
  assert.ok(scrollsThenTaps(builder, 'exerciseSearch.confirm'));
  assert.match(builder, /notVisible:\n      id: exerciseSearch\.modal\n    timeout: 5000/);
  assert.match(builder, /id: pro\.training_plan\.itemRow\.E2E_Push-Up\.quantity\n    text: 3 x 10/);
  assert.ok(
    scrollsThenTaps(
      suite('student-self-managed-builder/02-training-plan.yaml'),
      'pro.training_plan.saveButton',
    ),
  );
});

test('professional plan pickers use semantic assignment controls across native viewports', () => {
  assert.match(planPickerModalSource, /testID=\{`planPicker\.assign\.\$\{plan\.id\}`\}/);
  assert.match(planPickerModalSource, /onShow=\{\(\) => setIsPresented\(true\)\}/);
  assert.match(planPickerModalSource, /if \(!isVisible\) \{\s+setIsPresented\(false\);\s+\}/);
  assert.match(
    planPickerModalSource,
    /testID=\{isVisible && isPresented \? 'planPicker\.ready' : undefined\}/,
  );
  for (const path of [
    'professional-bulk-assign/01-bulk-assign-resets.yaml',
    'professional-student-profile/02-assign-draft-and-discard.yaml',
  ]) {
    assert.match(
      suite(path),
      /id: planPicker\.ready\n    timeout: 5000\n[\s\S]*- tapOn:\n    id: planPicker\.assign\.e2e-nutrition-predefined-plan/,
      path,
    );
  }
});

test('professional student profile returns through the semantic back control', () => {
  assert.match(professionalNutritionPlanScreenSource, /testID="pro\.nutrition_plan\.backButton"/);
  assert.match(
    suite('professional-student-profile/02-assign-draft-and-discard.yaml'),
    /- tapOn:\n    id: pro\.nutrition_plan\.backButton\n/,
  );
});

test('account settings scrolls to legal and destructive controls before interaction', () => {
  for (const path of [
    'account-settings/01-controls-and-sign-out.yaml',
    'shared-webview/01-legal-links-in-webview.yaml',
  ]) {
    assert.match(
      suite(path),
      /- scrollUntilVisible:\n    element:\n      id: settings\.account\.termsRow\n    direction: DOWN\n/,
      path,
    );
  }
  for (const path of [
    'account-deletion/01-confirm-and-sign-out.yaml',
    'offline-account-write-lock/01-offline-blocks-deletion.yaml',
  ]) {
    assert.match(
      suite(path),
      /- scrollUntilVisible:\n    element:\n      id: settings\.account\.version\n    direction: DOWN\n/,
      path,
    );
  }
  assert.match(
    suite('offline-account-write-lock/01-offline-blocks-deletion.yaml'),
    /- tapOn:\n    id: settings\.account\.deleteCta\n- assertNotVisible:\n    id: settings\.account\.deleteConfirm\n/,
  );
  assert.match(
    accountScreenSource,
    /onPress=\{handleRequestDeletion\}\s+disabled=\{isDeleteLocked\}[\s\S]*testID="settings\.account\.deleteCta"/,
  );
});

test('nutrition builders type into each native editor before saving', () => {
  assert.match(
    planMetadataFormSource,
    /returnKeyType="next"\s+onSubmitEditing=\{\(\) => hydrationInputRef\.current\?\.focus\(\)\}/,
  );
  const builder = suite('professional-nutrition-builder/01-create-add-food-remove.yaml');
  assert.match(
    builder,
    /- tapOn:\n    id: pro\.nutrition_item\.searchInput\n- inputText: rice\n- assertVisible:\n    id: pro\.nutrition_item\.searchInput\n    text: rice\n- pressKey: Enter\n/,
  );
  assert.match(
    professionalNutritionMealScreenSource,
    /style=\{\{ position: 'relative', top: 0, left: 0, right: 0, marginTop: 16 \}\}/,
  );
  assert.doesNotMatch(
    professionalNutritionMealScreenSource,
    /style=\{\{ top: '100%', left: 0, right: 0, marginTop: 16 \}\}/,
  );
});

/** Steps from `from` up to (not including) the first later line matching `to`. */
function stepsBetween(source: string, from: RegExp, to: RegExp): string {
  const start = source.search(from);
  assert.ok(start >= 0, `missing ${from}`);
  const rest = source.slice(start);
  const end = rest.slice(1).search(to);
  assert.ok(end >= 0, `missing ${to} after ${from}`);
  return rest.slice(0, end + 1);
}

void test('keyboard-heavy forms are used with the keyboard open, with no workaround', () => {
  // Fixed product findings (SC-207, SC-208, SC-213, SC-215): forms and sheets
  // stay above the keyboard, so flows tap their fields and buttons directly.
  assert.deepEqual(
    allSuiteFlows()
      .filter(({ source }) => /recorded product finding/.test(source))
      .map(({ path }) => path),
    [],
  );

  const nutrition = suite('professional-nutrition-builder/01-create-add-food-remove.yaml');
  const addMeal = stepsBetween(
    nutrition,
    /- tapOn:\n    id: pro\.nutrition_plan\.addMeal\n/,
    /id: pro\.nutrition_plan\.mealRow\.Breakfast\n/,
  );
  assert.match(
    addMeal,
    /- tapOn:\n    id: pro\.nutrition_plan\.addMeal\.input\n- inputText: Breakfast\n- assertVisible:\n    id: pro\.nutrition_plan\.addMeal\.input\n    text: Breakfast\n- assertVisible:\n    id: pro\.nutrition_plan\.addMeal\.cancel\n- takeScreenshot: add-meal-keyboard-open\n- tapOn:\n    id: pro\.nutrition_plan\.addMeal\.confirm\n/,
  );
  assert.doesNotMatch(addMeal, /hide-keyboard|pressKey|scrollUntilVisible/);

  const training = suite('professional-training-builder/01-create-add-exercise-remove.yaml');
  const addSession = stepsBetween(
    training,
    /- tapOn:\n    id: pro\.training_plan\.addSession\n/,
    /id: pro\.training_plan\.sessionRow\.Push_Day\n/,
  );
  assert.match(
    addSession,
    /- tapOn:\n    id: pro\.training_plan\.addSession\.name\n- inputText: Push Day\n- tapOn:\n    id: pro\.training_plan\.addSession\.notes\n- inputText: Upper body focus\n/,
  );
  assert.match(
    addSession,
    /- takeScreenshot: add-session-keyboard-open\n- tapOn:\n    id: pro\.training_plan\.addSession\.confirm\n/,
  );
  assert.doesNotMatch(addSession, /hide-keyboard|pressKey/);

  const exerciseSearch = stepsBetween(
    training,
    /id: exerciseSearch\.modal\n    timeout: 5000\n/,
    /id: exerciseSearch\.detail\n/,
  );
  assert.match(exerciseSearch, /\n- tapOn:\n    id: exerciseSearch\.input\n- inputText: push\n/);
  assert.match(exerciseSearch, /- assertVisible:\n    id: exerciseSearch\.title\n/);
  assert.match(exerciseSearch, /- assertVisible:\n    id: exerciseSearch\.input\n    text: push\n/);
  assert.doesNotMatch(exerciseSearch, /hide-keyboard|platform: Android/);
  // Removing one exercise confirms that exercise, not the whole-plan delete copy.
  assert.match(training, /MESSAGE: "Remove E2E Push-Up from this session\\\\\?"/);
  assert.doesNotMatch(training, /This action cannot be undone/);

  const support = suite('support-request/01-validate-and-submit.yaml');
  assert.match(
    support,
    /- inputText: E2E support issue\n(#.*\n)*- tapOn:\n    id: settings\.account\.support\.bodyInput\n- inputText: The support request flow should submit safely\.\n- assertVisible:\n    id: settings\.account\.support\.bodyInput\n    text: The support request flow should submit safely\.\n- assertVisible:\n    id: settings\.account\.support\.dialog\.title\n/,
  );
});

void test('plan builders opt into keyboard avoidance and register their inline forms', () => {
  const training = readSource('app/professional/training/plans/[planId].tsx');
  for (const [source, form] of [
    [professionalNutritionPlanScreenSource, 'pro.nutrition_plan.addMeal.form'],
    [training, 'pro.training_plan.addSession.form'],
  ] as const) {
    assert.match(source, /<DsScreen[^>]*\n\s+keyboardAware\n/);
    assert.match(source, /useDsKeyboardTarget\(\)/);
    assert.match(source, new RegExp(`ref=\\{\\w+KeyboardTarget\\}[\\s\\S]{0,200}testID="${form}"`));
  }
  assert.match(professionalNutritionMealScreenSource, /\n\s+keyboardAware\n/);
  assert.match(training, /t\('pro\.plan\.session_item\.delete\.body', \{ name: itemName \}\)/);
  assert.match(training, /t\('pro\.plan\.session\.delete\.body', \{ name: sessionName \}\)/);
  assert.match(
    professionalNutritionPlanScreenSource,
    /t\('pro\.plan\.meal\.delete\.body', \{ name: mealName \}\)/,
  );
  assert.doesNotMatch(training, /t\('pro\.plan\.delete\.body'\)\.replace/);
  assert.doesNotMatch(
    professionalNutritionPlanScreenSource,
    /t\('pro\.plan\.delete\.body'\)\.replace/,
  );
});

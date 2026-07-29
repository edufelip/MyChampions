import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const readSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const specialtyHelperSource = readSource('e2e/professional-specialty-actions.js');
const professionalHomeHelperSource = readSource('e2e/professional-home-actions.js');
const professionalHomeInviteCodeSource = readSource('e2e/professional-home-invite-code.e2e.test.js');
const trainingPlanHelperSource = readSource('e2e/training-plan-actions.js');
const professionalNutritionBuilderSource = readSource('e2e/professional-nutrition-builder.e2e.test.js');
const professionalNutritionPlanScreenSource = readSource(
  'app/professional/nutrition/plans/[planId].tsx'
);
const professionalNutritionMealScreenSource = readSource(
  'app/professional/nutrition/plans/[planId]/meals/[mealId].tsx'
);
const professionalTrainingBuilderSource = readSource('e2e/professional-training-builder.e2e.test.js');
const studentSelfManagedBuilderSource = readSource('e2e/student-self-managed-builder.e2e.test.js');
const accountSettingsHelperSource = readSource('e2e/account-settings-actions.js');
const accountSettingsSource = readSource('e2e/account-settings.e2e.test.js');
const accountDeletionSource = readSource('e2e/account-deletion.e2e.test.js');
const offlineAccountWriteLockSource = readSource(
  'e2e/offline-account-write-lock.e2e.test.js'
);
const accountScreenSource = readSource('app/settings/account.tsx');
const nativeEditorHelperSource = readSource('e2e/native-editor-actions.js');
const planMetadataFormSource = readSource(
  'features/plans/components/PlanMetadataForm.tsx'
);
const planPickerModalSource = readSource('components/ds/patterns/PlanPickerModal.tsx');
const professionalBulkAssignSource = readSource(
  'e2e/professional-bulk-assign.e2e.test.js'
);
const professionalStudentProfileSource = readSource(
  'e2e/professional-student-profile.e2e.test.js'
);
const sharedWebViewSource = readSource('e2e/shared-webview.e2e.test.js');
const standaloneSpecialtySource = readSource('e2e/professional-specialty.e2e.test.js');
const specialtyConsumerPaths = [
  'e2e/professional-home-invite-code.e2e.test.js',
  'e2e/professional-nutrition-builder.e2e.test.js',
  'e2e/professional-specialty-removal.e2e.test.js',
  'e2e/professional-student-profile.e2e.test.js',
  'e2e/professional-training-builder.e2e.test.js',
];
const credentialFormConsumerPaths = [
  ...specialtyConsumerPaths,
  'e2e/professional-specialty.e2e.test.js',
];

test('professional specialty stories scroll the credential action into view', () => {
  assert.match(
    specialtyHelperSource,
    /waitFor\(element\(by\.id\('pro\.specialty\.credential\.skip'\)\)\)\s+\.toBeVisible\(\)\s+\.whileElement\(by\.id\('pro\.specialty\.screen'\)\)\s+\.scroll\(260, 'down', 0\.5, 0\.35\);/
  );

  for (const path of specialtyConsumerPaths) {
    const source = readSource(path);
    assert.match(
      source,
      /const \{ tapCredentialSkip \} = require\('\.\/professional-specialty-actions'\);/
    );
    assert.match(source, /await tapCredentialSkip\(\);/);
    assert.doesNotMatch(
      source,
      /element\(by\.id\('pro\.specialty\.credential\.skip'\)\)\.tap\(\)/
    );
  }

  for (const path of credentialFormConsumerPaths) {
    const source = readSource(path);
    assert.match(
      source,
      /waitFor\(element\(by\.id\('pro\.specialty\.credentialForm'\)\)\)\.toExist\(\)\.withTimeout\(5000\);/
    );
    assert.doesNotMatch(
      source,
      /waitFor\(element\(by\.id\('pro\.specialty\.credentialForm'\)\)\)\.toBeVisible\(\)/
    );
  }
});

test('professional invite-code story scrolls compact dashboard controls into view', () => {
  assert.match(
    professionalHomeHelperSource,
    /waitFor\(element\(by\.id\('pro\.home\.rotateCodeCta'\)\)\)\s+\.toBeVisible\(\)\s+\.whileElement\(by\.id\('pro\.home\.screen'\)\)\s+\.scroll\(300, 'down', 0\.5, 0\.5\);/
  );
  assert.match(
    professionalHomeHelperSource,
    /waitFor\(element\(by\.id\('pro\.home\.inviteCodeValue'\)\)\)\.toBeVisible\(\)\.withTimeout\(10000\);/
  );
  assert.match(
    professionalHomeHelperSource,
    /expect\(element\(by\.id\('pro\.home\.shareCodeCta'\)\)\)\.toBeVisible\(\);/
  );
  assert.match(
    professionalHomeInviteCodeSource,
    /const \{ scrollToInviteCodeControls \} = require\('\.\/professional-home-actions'\);/
  );
  assert.equal(
    professionalHomeInviteCodeSource.match(/await scrollToInviteCodeControls\(\);/g)?.length,
    2
  );
});

test('training builders scroll the save action above compact native chrome', () => {
  assert.match(
    trainingPlanHelperSource,
    /async function scrollTrainingPlanControlIntoView\(testId\) \{[\s\S]*waitFor\(element\(by\.id\(testId\)\)\)\s+\.toBeVisible\(\)\s+\.whileElement\(by\.id\('pro\.training_plan\.screen'\)\)\s+\.scroll\(260, 'down', 0\.5, 0\.35\);[\s\S]*\}/
  );
  assert.match(
    trainingPlanHelperSource,
    /async function scrollToTrainingPlanSave\(\) \{\s+await scrollTrainingPlanControlIntoView\('pro\.training_plan\.saveButton'\);\s+\}/
  );
  assert.match(
    trainingPlanHelperSource,
    /async function scrollToTrainingPlanSaveAboveNavigation\(\) \{[\s\S]*await scrollToTrainingPlanSave\(\);[\s\S]*element\(by\.id\('pro\.training_plan\.screen'\)\)\.scroll\(120, 'down', 0\.5, 0\.5\);[\s\S]*waitFor\(element\(by\.id\('pro\.training_plan\.saveButton'\)\)\)\.toBeVisible\(\)\.withTimeout\(5000\);[\s\S]*\}/
  );
  for (const source of [professionalTrainingBuilderSource, studentSelfManagedBuilderSource]) {
    assert.match(source, /require\('\.\/training-plan-actions'\);/);
    assert.doesNotMatch(
      source,
      /device\.tap\(\{ x: 350, y: 420 \}\);\s+await element\(by\.id\('pro\.training_plan\.saveButton'\)\)\.tap\(\);/
    );
  }
  assert.match(
    professionalTrainingBuilderSource,
    /replaceText\('E2E Builder Training Plan'\);[\s\S]*device\.tap\(\{ x: 350, y: 420 \}\);\s+await scrollToTrainingPlanSave\(\);\s+await element\(by\.id\('pro\.training_plan\.saveButton'\)\)\.tap\(\);/
  );
  assert.match(
    professionalTrainingBuilderSource,
    /await scrollTrainingPlanControlIntoView\('pro\.training_plan\.addSession'\);\s+await element\(by\.id\('pro\.training_plan\.addSession'\)\)\.tap\(\);/
  );
  assert.match(
    professionalTrainingBuilderSource,
    /element\(by\.id\('exerciseSearch\.confirm'\)\)\.tap\(\);\s+await waitFor\(element\(by\.id\('exerciseSearch\.modal'\)\)\)\.not\.toExist\(\)\.withTimeout\(5000\);\s+await waitFor\(element\(by\.id\('pro\.training_plan\.itemRow\.E2E_Push-Up'\)\)\)\.toBeVisible\(\)\.withTimeout\(10000\);[\s\S]*expect\(element\(by\.id\('pro\.training_plan\.itemRow\.E2E_Push-Up\.quantity'\)\)\)\.toHaveText\('3 x 10'\);\s+await scrollToTrainingPlanSaveAboveNavigation\(\);\s+await element\(by\.id\('pro\.training_plan\.saveButton'\)\)\.tap\(\);/
  );
  assert.equal(
    professionalTrainingBuilderSource.match(/await scrollToTrainingPlanSave\(\);/g)?.length,
    1
  );
  assert.equal(
    professionalTrainingBuilderSource.match(/await scrollToTrainingPlanSaveAboveNavigation\(\);/g)
      ?.length,
    1
  );
  assert.equal(
    studentSelfManagedBuilderSource.match(/await scrollToTrainingPlanSave\(\);/g)?.length,
    1
  );
});

test('professional plan pickers use semantic assignment controls across native viewports', () => {
  assert.match(
    planPickerModalSource,
    /testID=\{`planPicker\.assign\.\$\{plan\.id\}`\}/
  );
  assert.match(planPickerModalSource, /onShow=\{\(\) => setIsPresented\(true\)\}/);
  assert.match(
    planPickerModalSource,
    /if \(!isVisible\) \{\s+setIsPresented\(false\);\s+\}/
  );
  assert.match(
    planPickerModalSource,
    /testID=\{isVisible && isPresented \? 'planPicker\.ready' : undefined\}/
  );

  for (const source of [
    professionalBulkAssignSource,
    professionalStudentProfileSource,
  ]) {
    assert.match(
      source,
      /waitFor\(element\(by\.id\('planPicker\.ready'\)\)\)\.toBeVisible\(\)\.withTimeout\(5000\);[\s\S]*element\(by\.id\('planPicker\.assign\.e2e-nutrition-predefined-plan'\)\)\.tap\(\)/
    );
    assert.doesNotMatch(source, /device\.tap\(\{ x: 336, y: 520 \}\)/);
  }
});

test('professional student profile scrolls stacked states and returns through semantic controls', () => {
  assert.match(
    professionalStudentProfileSource,
    /expect\(element\(by\.id\('pro\.student_profile\.nutrition\.status'\)\)\)\.toHaveText\('Active, awaiting plan'\);[\s\S]*waitFor\(element\(by\.id\('pro\.student_profile\.training\.assignmentCard'\)\)\)\s+\.toBeVisible\(\)\s+\.whileElement\(by\.id\('pro\.student_profile\.screen'\)\)\s+\.scroll\(260, 'down', 0\.5, 0\.8\);[\s\S]*expect\(element\(by\.id\('pro\.student_profile\.training\.status'\)\)\)\.toHaveText\('Active, awaiting plan'\);/
  );
  assert.match(
    professionalNutritionPlanScreenSource,
    /testID="pro\.nutrition_plan\.backButton"/
  );
  assert.match(
    professionalStudentProfileSource,
    /waitFor\(element\(by\.text\('Draft Assignment: Customize this nutrition plan for the student before sending\.'\)\)\)\s+\.toBeVisible\(\)\s+\.withTimeout\(10000\);\s+await expect\(element\(by\.id\('pro\.plan\.metadata\.name'\)\)\)\.toHaveText\('Balanced Nutrition Template'\);\s+await expect\(element\(by\.text\('Could not load plan\. Try again\.'\)\)\)\.not\.toExist\(\);[\s\S]*waitFor\(element\(by\.id\('pro\.nutrition_plan\.backButton'\)\)\)\.toBeVisible\(\)\.withTimeout\(5000\);\s+await element\(by\.id\('pro\.nutrition_plan\.backButton'\)\)\.tap\(\);\s+await waitFor\(element\(by\.id\('pro\.student_profile\.screen'\)\)\)\.toBeVisible\(\)\.withTimeout\(10000\);/
  );
  assert.match(
    professionalStudentProfileSource,
    /waitFor\(element\(by\.id\('pro\.student_profile\.nutrition\.status'\)\)\)\s+\.toHaveText\('Draft pending send'\)\s+\.withTimeout\(10000\);[\s\S]*waitFor\(element\(by\.id\('pro\.student_profile\.nutrition\.status'\)\)\)\s+\.toHaveText\('Active, awaiting plan'\)\s+\.withTimeout\(10000\);/
  );
  assert.match(
    professionalStudentProfileSource,
    /const discardConfirmation = element\(by\.text\('Discard'\)\);\s+if \(device\.getPlatform\(\) === 'ios'\) \{\s+await discardConfirmation\.atIndex\(1\)\.tap\(\);\s+\} else \{\s+await discardConfirmation\.tap\(\);\s+\}/
  );
  assert.doesNotMatch(professionalStudentProfileSource, /device\.tap\(/);
  assert.doesNotMatch(
    professionalStudentProfileSource,
    /element\(by\.text\('(Draft pending send|Active, awaiting plan)'\)\)\.atIndex/
  );
});

test('account settings scrolls compact legal and support controls before interaction', () => {
  assert.match(
    accountSettingsHelperSource,
    /async function scrollAccountRowIntoView\(testId:?\s*\)? \{[\s\S]*waitFor\(element\(by\.id\(testId\)\)\)[\s\S]*\.toBeVisible\(\)[\s\S]*\.whileElement\(by\.id\('settings\.account\.screen'\)\)[\s\S]*\.scroll\(260, 'down', 0\.5, 0\.35\);[\s\S]*\}/
  );
  assert.match(
    accountSettingsHelperSource,
    /async function scrollToLegalRows\(\) \{[\s\S]*scrollAccountRowIntoView\('settings\.account\.privacyPolicyRow'\);[\s\S]*scrollAccountRowIntoView\('settings\.account\.termsRow'\);[\s\S]*\}/
  );
  assert.match(
    accountSettingsHelperSource,
    /async function scrollToSupportQuickAction\(\) \{[\s\S]*waitFor\(element\(by\.id\('settings\.account\.supportQuickCta'\)\)\)[\s\S]*\.toBeVisible\(\)[\s\S]*\.whileElement\(by\.id\('settings\.account\.screen'\)\)[\s\S]*\.scroll\(300, 'up', 0\.5, 0\.5\);[\s\S]*\}/
  );
  assert.match(
    accountSettingsHelperSource,
    /async function scrollToSignOutConfirmation\(\) \{[\s\S]*waitFor\(element\(by\.id\('settings\.account\.signOutConfirmCta'\)\)\)[\s\S]*\.toBeVisible\(\)[\s\S]*\.whileElement\(by\.id\('settings\.account\.screen'\)\)[\s\S]*\.scroll\(240, 'down', 0\.5, 0\.5\);[\s\S]*\}/
  );
  assert.match(
    accountSettingsHelperSource,
    /async function scrollToDeleteCta\(\) \{\s+await scrollAccountRowIntoView\('settings\.account\.version'\);\s+await expect\(element\(by\.id\('settings\.account\.deleteCta'\)\)\)\.toBeVisible\(\);\s+\}/
  );
  assert.doesNotMatch(
    accountSettingsHelperSource,
    /async function scrollToDeleteCta\(\) \{\s+await scrollAccountRowIntoView\('settings\.account\.deleteCta'\);/
  );
  assert.match(
    accountSettingsHelperSource,
    /async function scrollToAccountFooter\(\) \{\s+await scrollAccountRowIntoView\('settings\.account\.version'\);\s+\}/
  );
  assert.match(
    accountSettingsSource,
    /require\('\.\/account-settings-actions'\)/
  );
  assert.equal(accountSettingsSource.match(/await scrollToLegalRows\(\);/g)?.length, 2);
  assert.equal(accountSettingsSource.match(/await scrollToSupportQuickAction\(\);/g)?.length, 1);
  assert.equal(accountSettingsSource.match(/await scrollToDeleteCta\(\);/g)?.length, 1);
  assert.equal(accountSettingsSource.match(/await scrollToAccountFooter\(\);/g)?.length, 1);
  assert.match(
    accountSettingsSource,
    /await scrollToSupportQuickAction\(\);\s+await element\(by\.id\('settings\.account\.supportQuickCta'\)\)\.tap\(\);/
  );
  assert.match(
    accountSettingsSource,
    /await element\(by\.id\('settings\.account\.supportQuickCta'\)\)\.tap\(\);\s+await waitFor\(element\(by\.id\('settings\.account\.support\.subjectInput'\)\)\)\s+\.toBeVisible\(\)\s+\.withTimeout\(5000\);/
  );
  assert.doesNotMatch(
    accountSettingsSource,
    /waitFor\(element\(by\.id\('settings\.account\.support\.modal'\)\)\)\.toBeVisible\(\)/
  );
  assert.match(
    accountSettingsSource,
    /waitFor\(element\(by\.id\('settings\.account\.signOutCta'\)\)\)\.toBeVisible\(\)\.withTimeout\(5000\);\s+await element\(by\.id\('settings\.account\.signOutCta'\)\)\.tap\(\);\s+await scrollToSignOutConfirmation\(\);\s+await expect\(element\(by\.text\('Sign out\?'\)\)\)\.toBeVisible\(\);\s+await element\(by\.id\('settings\.account\.signOutConfirmCta'\)\)\.tap\(\);/
  );
  for (const source of [accountDeletionSource, offlineAccountWriteLockSource]) {
    assert.match(
      source,
      /const \{[\s\S]*scrollToDeleteCta[\s\S]*\} = require\('\.\/account-settings-actions'\);/
    );
    assert.match(source, /await scrollToDeleteCta\(\);/);
    assert.doesNotMatch(source, /settings\.account\.signOutCta'\)\)\.swipe/);
    assert.doesNotMatch(source, /tapAtPoint\(\{ x: 180, y: 24 \}\)/);
  }
  assert.match(
    offlineAccountWriteLockSource,
    /await element\(by\.id\('settings\.account\.deleteCta'\)\)\.tap\(\);\s+await expect\(element\(by\.id\('settings\.account\.deleteConfirm'\)\)\)\.not\.toExist\(\);/
  );
  assert.match(
    accountScreenSource,
    /onPress=\{handleRequestDeletion\}\s+disabled=\{isDeleteLocked\}[\s\S]*testID="settings\.account\.deleteCta"/
  );
  assert.match(
    sharedWebViewSource,
    /const \{ scrollToLegalRows \} = require\('\.\/account-settings-actions'\);/
  );
  assert.equal(sharedWebViewSource.match(/await scrollToLegalRows\(\);/g)?.length, 2);
});

test('standalone specialty story distinguishes mounted fields from visible controls', () => {
  assert.match(
    standaloneSpecialtySource,
    /const \{ submitFocusedEditor \} = require\('\.\/native-editor-actions'\);/
  );
  assert.match(
    standaloneSpecialtySource,
    /expect\(element\(by\.id\('pro\.specialty\.credential\.registryId'\)\)\)\.toBeVisible\(\);/
  );
  for (const testId of [
    'pro.specialty.credential.authority',
    'pro.specialty.credential.country',
  ]) {
    const escapedTestId = testId.replaceAll('.', '\\.');
    assert.match(
      standaloneSpecialtySource,
      new RegExp(`expect\\(element\\(by\\.id\\('${escapedTestId}'\\)\\)\\)\\.toExist\\(\\);`)
    );
  }
  assert.match(
    standaloneSpecialtySource,
    /element\(by\.id\('pro\.specialty\.credential\.registryId'\)\)\.replaceText\('CRN-12345'\);\s+if \(device\.getPlatform\(\) === 'ios'\) \{\s+await submitFocusedEditor\('pro\.specialty\.credential\.registryId'\);\s+\}\s+await scrollToCredentialSave\(\);/
  );
  assert.doesNotMatch(standaloneSpecialtySource, /pro\.specialty\.keyboard\.done/);
});

test('nutrition builders submit native editors before saving', () => {
  assert.match(
    nativeEditorHelperSource,
    /async function submitFocusedEditor\(testId\) \{\s+await waitFor\(element\(by\.id\(testId\)\)\)\.toBeFocused\(\)\.withTimeout\(2000\);\s+if \(device\.getPlatform\(\) === 'android'\) \{\s+await device\.getUiDevice\(\)\.pressEnter\(\);\s+\} else \{\s+await element\(by\.id\(testId\)\)\.tapReturnKey\(\);\s+await waitFor\(element\(by\.id\(testId\)\)\)\.not\.toBeFocused\(\)\.withTimeout\(2000\);\s+\}\s+\}/
  );
  assert.doesNotMatch(
    nativeEditorHelperSource,
    /async function submitFocusedEditor\(testId\) \{[\s\S]*element\(by\.id\(testId\)\)\.tap\(\);[\s\S]*\}/
  );
  assert.match(
    nativeEditorHelperSource,
    /async function dismissFocusedEditor\(testId\) \{\s+await waitFor\(element\(by\.id\(testId\)\)\)\.toBeFocused\(\)\.withTimeout\(2000\);\s+if \(device\.getPlatform\(\) === 'android'\) \{\s+await device\.pressBack\(\);\s+\} else \{\s+await element\(by\.id\(testId\)\)\.tapReturnKey\(\);\s+await waitFor\(element\(by\.id\(testId\)\)\)\.not\.toBeFocused\(\)\.withTimeout\(2000\);\s+\}\s+\}/
  );
  assert.match(
    nativeEditorHelperSource,
    /async function advanceFocusedEditor\(currentTestId, nextTestId\) \{[\s\S]*await waitFor\(currentEditor\)\.toBeFocused\(\)\.withTimeout\(2000\);[\s\S]*await waitFor\(nextEditor\)\.toBeVisible\(\)\.withTimeout\(5000\);[\s\S]*if \(device\.getPlatform\(\) === 'android'\) \{\s+await device\.pressBack\(\);\s+await nextEditor\.tap\(\);\s+\} else \{\s+await currentEditor\.tapReturnKey\(\);\s+\}[\s\S]*await waitFor\(nextEditor\)\.toBeFocused\(\)\.withTimeout\(2000\);[\s\S]*\}/
  );
  assert.match(
    planMetadataFormSource,
    /returnKeyType="next"\s+onSubmitEditing=\{\(\) => hydrationInputRef\.current\?\.focus\(\)\}/
  );
  assert.match(
    nativeEditorHelperSource,
    /async function waitForElementEnabled\(testId, timeoutMs = 5000\) \{\s+await waitForElementAttributes\(\s+testId,\s+\(attributes\) => attributes\?\.enabled === true,\s+timeoutMs,\s+'to become enabled'\s+\);\s+\}/
  );

  for (const {
    source,
    planName,
    hydrationGoalMl,
  } of [
    {
      source: professionalNutritionBuilderSource,
      planName: 'E2E Builder Nutrition Plan',
      hydrationGoalMl: '2200',
    },
    {
      source: studentSelfManagedBuilderSource,
      planName: 'E2E Student Nutrition Plan',
      hydrationGoalMl: '2100',
    },
  ]) {
    assert.match(
      source,
      /const \{[\s\S]*?advanceFocusedEditor,[\s\S]*?dismissFocusedEditor,[\s\S]*?waitForElementEnabled,[\s\S]*?\} = require\('\.\/native-editor-actions'\);/
    );
    assert.match(
      source,
      new RegExp(
        `replaceText\\('${planName}'\\);\\s+` +
          `await expect\\(element\\(by\\.id\\('pro\\.plan\\.metadata\\.name'\\)\\)\\)\\.toHaveText\\('${planName}'\\);?\\s+` +
          `await advanceFocusedEditor\\(\\s+` +
          `'pro\\.plan\\.metadata\\.name',\\s+` +
          `'pro\\.plan\\.metadata\\.hydrationGoalMl'\\s+` +
          `\\);\\s+` +
          `const hydrationInput = element\\(by\\.id\\('pro\\.plan\\.metadata\\.hydrationGoalMl'\\)\\);\\s+` +
          `await hydrationInput\\.replaceText\\('${hydrationGoalMl}'\\);\\s+` +
          `await expect\\(hydrationInput\\)\\.toHaveText\\('${hydrationGoalMl}'\\);\\s+` +
          `await dismissFocusedEditor\\('pro\\.plan\\.metadata\\.hydrationGoalMl'\\);\\s+` +
          `await waitForElementEnabled\\('pro\\.nutrition_plan\\.saveButton'\\);\\s+` +
          `await element\\(by\\.id\\('pro\\.nutrition_plan\\.saveButton'\\)\\)\\.tap\\(\\);`
      )
    );
    assert.doesNotMatch(source, /hydrationInput\.tap\(\)/);
  }

  assert.doesNotMatch(
    professionalNutritionBuilderSource,
    /device\.tap\(\{ x: 350, y: 420 \}\);/
  );
  assert.match(
    professionalNutritionBuilderSource,
    /waitFor\(element\(by\.id\('tabs\.nutrition'\)\)\)\.toBeVisible\(\)\.withTimeout\(10000\);\s+await element\(by\.id\('tabs\.nutrition'\)\)\.tap\(\);/
  );
  assert.match(
    professionalNutritionBuilderSource,
    /const mealNameInput = element\(by\.id\('pro\.nutrition_plan\.addMeal\.input'\)\);\s+await mealNameInput\.replaceText\('Breakfast'\);\s+await expect\(mealNameInput\)\.toHaveText\('Breakfast'\);\s+await dismissFocusedEditor\('pro\.nutrition_plan\.addMeal\.input'\);\s+await waitFor\(element\(by\.id\('pro\.nutrition_plan\.addMeal\.confirm'\)\)\)\s+\.toBeVisible\(\)\s+\.whileElement\(by\.id\('pro\.nutrition_plan\.screen'\)\)\s+\.scroll\(180, 'down', 0\.5, 0\.75\);\s+await element\(by\.id\('pro\.nutrition_plan\.addMeal\.confirm'\)\)\.tap\(\);/
  );
  assert.match(
    professionalNutritionBuilderSource,
    /waitFor\(element\(by\.id\('pro\.nutrition_item\.form'\)\)\)\.toExist\(\)\.withTimeout\(5000\);\s+await waitFor\(element\(by\.id\('pro\.nutrition_item\.searchInput'\)\)\)\s+\.toBeVisible\(\)\s+\.whileElement\(by\.id\('pro\.nutrition_meal\.screen'\)\)\s+\.scroll\(240, 'down', 0\.5, 0\.75\);/
  );
  assert.match(
    professionalNutritionMealScreenSource,
    /style=\{\{ position: 'relative', top: 0, left: 0, right: 0, marginTop: 16 \}\}/
  );
  assert.doesNotMatch(
    professionalNutritionMealScreenSource,
    /style=\{\{ top: '100%', left: 0, right: 0, marginTop: 16 \}\}/
  );
  assert.match(
    professionalNutritionBuilderSource,
    /const searchInput = element\(by\.id\('pro\.nutrition_item\.searchInput'\)\);\s+await searchInput\.tap\(\);\s+await searchInput\.replaceText\('rice'\);\s+await expect\(searchInput\)\.toHaveText\('rice'\);\s+await submitFocusedEditor\('pro\.nutrition_item\.searchInput'\);\s+const searchResult = element\(by\.id\('pro\.nutrition_item\.searchResult\.e2e-food-rice'\)\);\s+await waitFor\(searchResult\)\s+\.toBeVisible\(\)\s+\.whileElement\(by\.id\('pro\.nutrition_meal\.screen'\)\)\s+\.scroll\(180, 'down', 0\.5, 0\.75\);/
  );
  assert.match(
    professionalNutritionBuilderSource,
    /pro\.nutrition_item\.quantity[\s\S]*?\.scroll\(180, 'down', 0\.5, 0\.75\);[\s\S]*?pro\.nutrition_item\.add[\s\S]*?\.scroll\(360, 'down', 0\.5, 0\.75\);/
  );
  assert.doesNotMatch(
    professionalNutritionBuilderSource,
    /waitFor\(element\(by\.id\('pro\.nutrition_item\.form'\)\)\)\.toBeVisible\(\)/
  );
  assert.match(
    professionalNutritionBuilderSource,
    /element\(by\.id\('pro\.nutrition_item\.add'\)\)\.tap\(\);\s+await waitFor\(element\(by\.id\('pro\.nutrition_item\.form'\)\)\)\.not\.toBeVisible\(\)\.withTimeout\(10000\);[\s\S]*?const removeButton = element\(by\.id\('pro\.nutrition_meal\.foodRow\.E2E_Brown_Rice\.remove'\)\);\s+await waitFor\(removeButton\)\.toBeVisible\(\)\.withTimeout\(5000\);\s+await removeButton\.tap\(\);/
  );
  assert.match(
    professionalNutritionBuilderSource,
    /const deleteAction = element\(by\.text\('Delete'\)\)\.atIndex\(1\);[\s\S]*?await deleteAction\.tap\(\);/
  );
  assert.doesNotMatch(
    professionalNutritionBuilderSource,
    /device\.tap\(\{ x: 276, y: 520 \}\);/
  );
  assert.equal(
    studentSelfManagedBuilderSource.match(/device\.tap\(\{ x: 350, y: 420 \}\);/g)?.length,
    1
  );
});

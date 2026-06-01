import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const trainingPlansRules = rules.slice(
  rules.indexOf('match /trainingPlans/{planId}'),
  rules.indexOf('match /planChangeRequests/{requestId}')
);
const professionalLibraryCreateRules = rules.match(
  /function canCreateProfessionalLibraryTrainingPlan\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const trainingPlansDeleteRules = trainingPlansRules.match(
  /allow delete: if signedIn\(\) && \([\s\S]*?\n      \);/
)?.[0] ?? '';
const endedFitnessCoachConnectionHelper = rules.match(
  /function hasEndedFitnessCoachConnectionForPlan\(studentUid\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const selfManagedTrainingUpdateHelper = rules.match(
  /function canUpdateSelfManagedTrainingPlan\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const selfManagedTrainingCreateHelper = rules.match(
  /function canCreateSelfManagedTrainingPlan\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const activeFitnessCoachSpecialtyHelper = rules.match(
  /function hasActiveFitnessCoachSpecialtyForStudent\(studentUid\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const activeNutritionistSpecialtyHelper = rules.match(
  /function hasActiveNutritionistSpecialtyForStudent\(studentUid\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const activeSpecialtiesRules = rules.slice(
  rules.indexOf('match /trackingAccess/{studentUid}/activeSpecialties/{specialtyId}'),
  rules.indexOf('match /waterLogs/{logId}')
);
const activeSpecialtyUpdateHelper = rules.match(
  /function validActiveSpecialtyUpdate\(studentUid, specialtyId\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const professionalLibraryTrainingUpdateHelper = rules.match(
  /function canUpdateProfessionalLibraryTrainingPlan\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const assignedTrainingUpdateHelper = rules.match(
  /function canUpdateAssignedTrainingPlan\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const activatedFitnessCoachConnectionHelper = rules.match(
  /function hasActivatedFitnessCoachConnectionForPlan\(studentUid\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const nutritionPlansRules = rules.slice(
  rules.indexOf('match /nutritionPlans/{planId}'),
  rules.indexOf('function trainingIdentityUnchanged()')
);
const professionalNutritionUpdateHelper = rules.match(
  /function canUpdateProfessionalOwnedNutritionPlan\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const assignedNutritionArchiveHelper = rules.match(
  /function canArchiveAssignedNutritionPlanOnConnectionEnd\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const selfManagedNutritionActivationArchiveHelper = rules.match(
  /function canArchiveSelfManagedNutritionPlanOnConnectionActivation\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const selfManagedNutritionRestoreHelper = rules.match(
  /function canRestoreSelfManagedNutritionPlanOnConnectionEnd\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const assignedTrainingArchiveHelper = rules.match(
  /function canArchiveAssignedTrainingPlanOnConnectionEnd\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const selfManagedTrainingActivationArchiveHelper = rules.match(
  /function canArchiveSelfManagedTrainingPlanOnConnectionActivation\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';
const selfManagedTrainingRestoreHelper = rules.match(
  /function canRestoreSelfManagedTrainingPlanOnConnectionEnd\(\) \{[\s\S]*?\n    \}/
)?.[0] ?? '';

test('trainingPlans rules hide draft assigned plans from students', () => {
  assert.match(rules, /function isPublishedForStudentRead\(\)/);
  assert.match(rules, /resource\.data\.isDraft != true/);
});

test('trainingPlans rules keep assigned plans read-only for students', () => {
  assert.match(rules, /function canUpdateAssignedTrainingPlan\(\)/);
  assert.match(rules, /resource\.data\.ownerProfessionalUid == request\.auth\.uid/);
  assert.doesNotMatch(
    trainingPlansRules,
    /allow update, delete: if signedIn\(\) && \(\s*resource\.data\.studentAuthUid == request\.auth\.uid/
  );
});

test('trainingPlans rules require active fitness coach access for assigned writes', () => {
  assert.match(rules, /hasActiveFitnessCoachTrackingAccess\(request\.resource\.data\.studentAuthUid\)/);
  assert.match(rules, /hasActiveFitnessCoachTrackingAccess\(resource\.data\.studentAuthUid\)/);
});

test('trainingPlans rules allow connection-end archive and self-managed restore writes', () => {
  assert.match(rules, /function hasEndedFitnessCoachConnectionForPlan\(studentUid\)/);
  assert.match(rules, /function planLifecycleStateOnlyChanged\(\)/);
  assert.match(rules, /lifecycleConnectionId/);
  assert.match(rules, /function canArchiveAssignedTrainingPlanOnConnectionEnd\(\)/);
  assert.match(rules, /function canRestoreSelfManagedTrainingPlanOnConnectionEnd\(\)/);
  assert.match(rules, /request\.resource\.data\.isArchived == true/);
  assert.match(rules, /request\.resource\.data\.isArchived == false/);
  assert.match(rules, /hasEndedFitnessCoachConnectionForPlan\(resource\.data\.studentAuthUid\)/);
});

test('trainingPlans normal self-managed updates preserve lifecycle archive state', () => {
  assert.match(rules, /function planLifecycleMarkerUnchanged\(\)/);
  assert.match(
    rules,
    /request\.resource\.data\.get\('lifecycleConnectionId', null\) == resource\.data\.get\('lifecycleConnectionId', null\)/
  );
  assert.match(rules, /function planArchiveMetadataUnchanged\(\)/);
  assert.match(
    selfManagedTrainingUpdateHelper,
    /planArchiveMetadataUnchanged\(\)/
  );
});

test('trainingPlans self-managed creates and normal updates require no active fitness coach specialty sentinel', () => {
  assert.match(rules, /function hasActiveFitnessCoachSpecialtyForStudent\(studentUid\)/);
  assert.match(
    activeFitnessCoachSpecialtyHelper,
    /trackingAccess\/\$\(studentUid\)\/activeSpecialties\/fitness_coach/
  );
  assert.match(activeFitnessCoachSpecialtyHelper, /\.data\.status == 'active'/);
  assert.match(selfManagedTrainingCreateHelper, /!hasActiveFitnessCoachSpecialtyForStudent\(request\.auth\.uid\)/);
  assert.match(selfManagedTrainingUpdateHelper, /!hasActiveFitnessCoachSpecialtyForStudent\(resource\.data\.studentAuthUid\)/);
  assert.match(selfManagedTrainingUpdateHelper, /resource\.data\.isArchived == false/);
});

test('trackingAccess active specialty sentinel rules mirror referenced connection after-state', () => {
  assert.match(rules, /function hasActiveNutritionistSpecialtyForStudent\(studentUid\)/);
  assert.match(
    activeNutritionistSpecialtyHelper,
    /trackingAccess\/\$\(studentUid\)\/activeSpecialties\/nutritionist/
  );
  assert.match(rules, /function validActiveSpecialtyWriteFieldsAndConnection\(studentUid, specialtyId\)/);
  assert.match(activeSpecialtiesRules, /allow read: if signedIn\(\) && \(request\.auth\.uid == studentUid \|\| request\.auth\.uid == resource\.data\.professionalAuthUid\)/);
  assert.match(activeSpecialtiesRules, /allow create: if validActiveSpecialtyCreate\(studentUid, specialtyId\)/);
  assert.match(activeSpecialtiesRules, /allow update: if validActiveSpecialtyUpdate\(studentUid, specialtyId\)/);
  assert.match(activeSpecialtiesRules, /allow delete: if false/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/connections\/\$\(request\.resource\.data\.connectionId\)\)\.data\.status == request\.resource\.data\.status/);
  assert.match(rules, /request\.resource\.data\.specialty == specialtyId/);
});

test('trackingAccess active specialty sentinel update preserves existing connection ownership', () => {
  assert.match(rules, /function validActiveSpecialtyCreate\(studentUid, specialtyId\)/);
  assert.match(rules, /function validActiveSpecialtyUpdate\(studentUid, specialtyId\)/);
  assert.match(activeSpecialtyUpdateHelper, /resource\.data\.connectionId == request\.resource\.data\.connectionId/);
  assert.match(
    activeSpecialtyUpdateHelper,
    /request\.resource\.data\.status == 'ended'[\s\S]*resource\.data\.connectionId == request\.resource\.data\.connectionId/
  );
  assert.match(
    activeSpecialtyUpdateHelper,
    /request\.resource\.data\.status == 'active'[\s\S]*\(resource\.data\.status != 'active' \|\| resource\.data\.connectionId == request\.resource\.data\.connectionId\)/
  );
});

test('trainingPlans normal professional updates preserve lifecycle archive state', () => {
  assert.match(professionalLibraryTrainingUpdateHelper, /planArchiveMetadataUnchanged\(\)/);
  assert.match(assignedTrainingUpdateHelper, /planArchiveMetadataUnchanged\(\)/);
});

test('nutritionPlans professional updates preserve lifecycle archive state', () => {
  assert.match(rules, /function canUpdateProfessionalOwnedNutritionPlan\(\)/);
  assert.doesNotMatch(
    nutritionPlansRules,
    /resource\.data\.ownerProfessionalUid == request\.auth\.uid\s*\|\|/
  );
  assert.match(
    professionalNutritionUpdateHelper,
    /planArchiveMetadataUnchanged\(\)/
  );
});

test('trainingPlans connection activation archive rules require pending before-state and active after-state', () => {
  assert.match(rules, /function canArchiveSelfManagedTrainingPlanOnConnectionActivation\(\)/);
  assert.match(
    activatedFitnessCoachConnectionHelper,
    /get\(\/databases\/\$\(database\)\/documents\/connections\/\$\(request\.resource\.data\.lifecycleConnectionId\)\)\.data\.status == 'pending_confirmation'/
  );
  assert.match(
    activatedFitnessCoachConnectionHelper,
    /getAfter\(\/databases\/\$\(database\)\/documents\/connections\/\$\(request\.resource\.data\.lifecycleConnectionId\)\)\.data\.status == 'active'/
  );
});

test('trainingPlans connection-end rules require active before-state and ended after-state', () => {
  assert.match(
    endedFitnessCoachConnectionHelper,
    /get\(\/databases\/\$\(database\)\/documents\/connections\/\$\(request\.resource\.data\.lifecycleConnectionId\)\)\.data\.status == 'active'/
  );
  assert.match(
    endedFitnessCoachConnectionHelper,
    /getAfter\(\/databases\/\$\(database\)\/documents\/connections\/\$\(request\.resource\.data\.lifecycleConnectionId\)\)\.data\.status == 'ended'/
  );
  assert.match(
    endedFitnessCoachConnectionHelper,
    /request\.auth\.uid == get\(\/databases\/\$\(database\)\/documents\/connections\/\$\(request\.resource\.data\.lifecycleConnectionId\)\)\.data\.studentAuthUid \|\|\s*request\.auth\.uid == get\(\/databases\/\$\(database\)\/documents\/connections\/\$\(request\.resource\.data\.lifecycleConnectionId\)\)\.data\.professionalAuthUid/
  );
});

test('plan lifecycle archive helpers require unarchived source plans', () => {
  assert.match(assignedNutritionArchiveHelper, /resource\.data\.isArchived == false/);
  assert.match(selfManagedNutritionActivationArchiveHelper, /resource\.data\.isArchived == false/);
  assert.match(assignedTrainingArchiveHelper, /resource\.data\.isArchived == false/);
  assert.match(selfManagedTrainingActivationArchiveHelper, /resource\.data\.isArchived == false/);
});

test('plan lifecycle restore helpers require archived source with matching marker', () => {
  assert.match(selfManagedNutritionRestoreHelper, /resource\.data\.isArchived == true/);
  assert.match(
    selfManagedNutritionRestoreHelper,
    /resource\.data\.get\('lifecycleConnectionId', null\) == request\.resource\.data\.lifecycleConnectionId/
  );
  assert.match(selfManagedTrainingRestoreHelper, /resource\.data\.isArchived == true/);
  assert.match(
    selfManagedTrainingRestoreHelper,
    /resource\.data\.get\('lifecycleConnectionId', null\) == request\.resource\.data\.lifecycleConnectionId/
  );
});

test('trainingPlans rules distinguish self-managed and professional library creates', () => {
  assert.match(rules, /function canCreateSelfManagedTrainingPlan\(\)/);
  assert.match(rules, /request\.resource\.data\.sourceKind == 'self_managed'/);
  assert.match(rules, /function canCreateProfessionalLibraryTrainingPlan\(\)/);
  assert.match(rules, /request\.resource\.data\.sourceKind == 'predefined'/);
});

test('trainingPlans professional library create allows saved and draft predefined plans', () => {
  assert.match(
    professionalLibraryCreateRules,
    /\(request\.resource\.data\.isDraft == false \|\|\s*request\.resource\.data\.isDraft == true\)/
  );
});

test('trainingPlans delete uses delete-specific helpers', () => {
  assert.match(rules, /function canDeleteSelfManagedTrainingPlan\(\)/);
  assert.match(rules, /function canDeleteProfessionalLibraryTrainingPlan\(\)/);
  assert.match(rules, /function canDeleteAssignedTrainingPlan\(\)/);
  assert.match(trainingPlansDeleteRules, /canDeleteSelfManagedTrainingPlan\(\)/);
  assert.match(trainingPlansDeleteRules, /canDeleteProfessionalLibraryTrainingPlan\(\)/);
  assert.match(trainingPlansDeleteRules, /canDeleteAssignedTrainingPlan\(\)/);
});

test('trainingPlans delete does not call update helpers that read request.resource', () => {
  assert.doesNotMatch(trainingPlansDeleteRules, /canUpdateSelfManagedTrainingPlan\(\)/);
  assert.doesNotMatch(trainingPlansDeleteRules, /canUpdateProfessionalLibraryTrainingPlan\(\)/);
  assert.doesNotMatch(trainingPlansDeleteRules, /canUpdateAssignedTrainingPlan\(\)/);
});

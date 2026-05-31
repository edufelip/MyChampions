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
  /function hasEndedFitnessCoachConnectionForPlan\(studentUid, professionalUid\) \{[\s\S]*?\n    \}/
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
  assert.match(rules, /function hasEndedFitnessCoachConnectionForPlan\(studentUid, professionalUid\)/);
  assert.match(rules, /function planArchiveStateOnlyChanged\(\)/);
  assert.match(rules, /function canArchiveAssignedTrainingPlanOnConnectionEnd\(\)/);
  assert.match(rules, /function canRestoreSelfManagedTrainingPlanOnConnectionEnd\(\)/);
  assert.match(rules, /request\.resource\.data\.isArchived == true/);
  assert.match(rules, /request\.resource\.data\.isArchived == false/);
  assert.match(rules, /hasEndedFitnessCoachConnectionForPlan\(resource\.data\.studentAuthUid, resource\.data\.ownerProfessionalUid\)/);
  assert.match(rules, /hasEndedFitnessCoachConnectionForPlan\(resource\.data\.studentAuthUid, request\.auth\.uid\)/);
});

test('trainingPlans connection-end rules require active before-state and ended after-state', () => {
  assert.match(
    endedFitnessCoachConnectionHelper,
    /get\(\/databases\/\$\(database\)\/documents\/trackingAccess\/\$\(studentUid\)\/fitnessCoaches\/\$\(professionalUid\)\)\.data\.status == 'active'/
  );
  assert.match(
    endedFitnessCoachConnectionHelper,
    /get\(\/databases\/\$\(database\)\/documents\/connections\/\$\(get\(\/databases\/\$\(database\)\/documents\/trackingAccess\/\$\(studentUid\)\/fitnessCoaches\/\$\(professionalUid\)\)\.data\.connectionId\)\)\.data\.status == 'active'/
  );
  assert.match(
    endedFitnessCoachConnectionHelper,
    /getAfter\(\/databases\/\$\(database\)\/documents\/trackingAccess\/\$\(studentUid\)\/fitnessCoaches\/\$\(professionalUid\)\)\.data\.status == 'ended'/
  );
  assert.match(
    endedFitnessCoachConnectionHelper,
    /getAfter\(\/databases\/\$\(database\)\/documents\/connections\/\$\(getAfter\(\/databases\/\$\(database\)\/documents\/trackingAccess\/\$\(studentUid\)\/fitnessCoaches\/\$\(professionalUid\)\)\.data\.connectionId\)\)\.data\.status == 'ended'/
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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const trainingPlansRules = rules.slice(
  rules.indexOf('match /trainingPlans/{planId}'),
  rules.indexOf('match /planChangeRequests/{requestId}')
);

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

test('trainingPlans rules distinguish self-managed and professional library creates', () => {
  assert.match(rules, /function canCreateSelfManagedTrainingPlan\(\)/);
  assert.match(rules, /request\.resource\.data\.sourceKind == 'self_managed'/);
  assert.match(rules, /function canCreateProfessionalLibraryTrainingPlan\(\)/);
  assert.match(rules, /request\.resource\.data\.sourceKind == 'predefined'/);
});

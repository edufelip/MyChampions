import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('professional home renders server-backed plan change notifications', () => {
  const source = readFileSync(join(root, 'app/professional/home.tsx'), 'utf8');

  assert.equal(source.includes('getProfessionalPlanChangeRequests'), true);
  assert.equal(source.includes('buildProfessionalPlanChangeNotificationSummary'), true);
  assert.equal(source.includes('pro.home.planChangeNotification'), true);
  assert.equal(source.includes('/professional/student-profile?studentId='), true);
  assert.equal(source.includes('pro.home.pendingRequests'), true);
});

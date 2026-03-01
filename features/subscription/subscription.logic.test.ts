import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FREE_STUDENT_CAP,
  checkStudentCapEnforcement,
  resolveSubscriptionState,
  normalizeEntitlementStatus,
  isPlanUpdateLocked,
} from './subscription.logic';

// --- checkStudentCapEnforcement ---

test('checkStudentCapEnforcement allows below free cap regardless of entitlement', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: 0, entitlementStatus: 'lapsed' }),
    { allowed: true }
  );
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP - 1, entitlementStatus: 'lapsed' }),
    { allowed: true }
  );
});

test('checkStudentCapEnforcement allows at cap with active entitlement (D-010)', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP, entitlementStatus: 'active' }),
    { allowed: true }
  );
});

test('checkStudentCapEnforcement blocks at cap when lapsed (D-043)', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP, entitlementStatus: 'lapsed' }),
    { allowed: false, reason: 'lapsed_above_cap' }
  );
});

test('checkStudentCapEnforcement allows when entitlement is unknown (optimistic)', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP + 5, entitlementStatus: 'unknown' }),
    { allowed: true }
  );
});

test('checkStudentCapEnforcement blocks above cap when lapsed', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP + 1, entitlementStatus: 'lapsed' }),
    { allowed: false, reason: 'lapsed_above_cap' }
  );
});

// --- resolveSubscriptionState ---

test('resolveSubscriptionState returns correct state for lapsed above cap', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 1,
    entitlementStatus: 'lapsed',
  });
  assert.equal(state.isAboveCapLocked, true);
  assert.equal(state.isPreLapseWarningVisible, false);
});

test('resolveSubscriptionState shows pre-lapse warning when active at threshold', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP,
    entitlementStatus: 'active',
  });
  assert.equal(state.isPreLapseWarningVisible, true);
  assert.equal(state.isAboveCapLocked, false);
});

test('resolveSubscriptionState uses custom preLapseThreshold', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: 7,
    entitlementStatus: 'active',
    preLapseThreshold: 7,
  });
  assert.equal(state.isPreLapseWarningVisible, true);
});

test('resolveSubscriptionState no warning below threshold', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP - 1,
    entitlementStatus: 'active',
  });
  assert.equal(state.isPreLapseWarningVisible, false);
});

test('resolveSubscriptionState not locked when not lapsed even above cap', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 5,
    entitlementStatus: 'active',
  });
  assert.equal(state.isAboveCapLocked, false);
});

// --- normalizeEntitlementStatus ---

test('normalizeEntitlementStatus accepts valid statuses', () => {
  assert.equal(normalizeEntitlementStatus('active'), 'active');
  assert.equal(normalizeEntitlementStatus('lapsed'), 'lapsed');
});

test('normalizeEntitlementStatus returns unknown for unrecognized', () => {
  assert.equal(normalizeEntitlementStatus(null), 'unknown');
  assert.equal(normalizeEntitlementStatus('expired'), 'unknown');
  assert.equal(normalizeEntitlementStatus(undefined), 'unknown');
});

// --- isPlanUpdateLocked ---

test('isPlanUpdateLocked returns true when lapsed above cap', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 1,
    entitlementStatus: 'lapsed',
  });
  assert.equal(isPlanUpdateLocked(state), true);
});

test('isPlanUpdateLocked returns false when active', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 1,
    entitlementStatus: 'active',
  });
  assert.equal(isPlanUpdateLocked(state), false);
});

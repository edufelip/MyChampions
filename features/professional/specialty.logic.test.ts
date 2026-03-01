import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSpecialty,
  checkSpecialtyRemoval,
  validateCredentialInput,
  normalizeSpecialtyActionError,
} from './specialty.logic';

// --- normalizeSpecialty ---

test('normalizeSpecialty accepts valid specialties', () => {
  assert.equal(normalizeSpecialty('nutritionist'), 'nutritionist');
  assert.equal(normalizeSpecialty('fitness_coach'), 'fitness_coach');
});

test('normalizeSpecialty returns null for unknown values', () => {
  assert.equal(normalizeSpecialty(null), null);
  assert.equal(normalizeSpecialty(undefined), null);
  assert.equal(normalizeSpecialty(''), null);
  assert.equal(normalizeSpecialty('NUTRITIONIST'), null);
  assert.equal(normalizeSpecialty('doctor'), null);
});

// --- checkSpecialtyRemoval ---

test('checkSpecialtyRemoval allows removal when conditions are clear', () => {
  const result = checkSpecialtyRemoval({
    specialtyToRemove: 'nutritionist',
    activeStudentCountForSpecialty: 0,
    pendingStudentCountForSpecialty: 0,
    totalActiveSpecialtyCount: 2,
  });
  assert.deepEqual(result, { allowed: true });
});

test('checkSpecialtyRemoval blocks when it is the last specialty', () => {
  const result = checkSpecialtyRemoval({
    specialtyToRemove: 'nutritionist',
    activeStudentCountForSpecialty: 0,
    pendingStudentCountForSpecialty: 0,
    totalActiveSpecialtyCount: 1,
  });
  assert.deepEqual(result, { allowed: false, reason: 'last_specialty' });
});

test('checkSpecialtyRemoval blocks when active students exist', () => {
  const result = checkSpecialtyRemoval({
    specialtyToRemove: 'fitness_coach',
    activeStudentCountForSpecialty: 3,
    pendingStudentCountForSpecialty: 0,
    totalActiveSpecialtyCount: 2,
  });
  assert.deepEqual(result, { allowed: false, reason: 'has_active_students' });
});

test('checkSpecialtyRemoval blocks when pending students exist', () => {
  const result = checkSpecialtyRemoval({
    specialtyToRemove: 'nutritionist',
    activeStudentCountForSpecialty: 0,
    pendingStudentCountForSpecialty: 2,
    totalActiveSpecialtyCount: 2,
  });
  assert.deepEqual(result, { allowed: false, reason: 'has_pending_students' });
});

test('checkSpecialtyRemoval: last_specialty takes priority over active students', () => {
  const result = checkSpecialtyRemoval({
    specialtyToRemove: 'nutritionist',
    activeStudentCountForSpecialty: 5,
    pendingStudentCountForSpecialty: 2,
    totalActiveSpecialtyCount: 1,
  });
  assert.deepEqual(result, { allowed: false, reason: 'last_specialty' });
});

// --- validateCredentialInput ---

test('validateCredentialInput returns no errors for valid input', () => {
  const errors = validateCredentialInput({
    registryId: 'REG-001',
    authority: 'CFN',
    country: 'BR',
  });
  assert.deepEqual(errors, {});
});

test('validateCredentialInput reports required for empty fields', () => {
  const errors = validateCredentialInput({
    registryId: '',
    authority: '  ',
    country: '',
  });
  assert.equal(errors.registryId, 'required');
  assert.equal(errors.authority, 'required');
  assert.equal(errors.country, 'required');
});

test('validateCredentialInput reports individual missing fields', () => {
  assert.equal(
    validateCredentialInput({ registryId: '', authority: 'CFN', country: 'BR' }).registryId,
    'required'
  );
  assert.equal(
    validateCredentialInput({ registryId: 'R', authority: '', country: 'BR' }).authority,
    'required'
  );
  assert.equal(
    validateCredentialInput({ registryId: 'R', authority: 'A', country: '' }).country,
    'required'
  );
});

// --- normalizeSpecialtyActionError ---

test('normalizeSpecialtyActionError maps ALREADY_EXISTS code', () => {
  assert.equal(normalizeSpecialtyActionError({ code: 'ALREADY_EXISTS' }), 'already_exists');
});

test('normalizeSpecialtyActionError maps already exists message', () => {
  assert.equal(normalizeSpecialtyActionError({ message: 'specialty already exists' }), 'already_exists');
});

test('normalizeSpecialtyActionError maps REMOVAL_BLOCKED code', () => {
  assert.equal(normalizeSpecialtyActionError({ code: 'REMOVAL_BLOCKED' }), 'removal_blocked');
});

test('normalizeSpecialtyActionError maps removal blocked message', () => {
  assert.equal(normalizeSpecialtyActionError({ message: 'removal blocked by constraints' }), 'removal_blocked');
});

test('normalizeSpecialtyActionError maps LAST_SPECIALTY code', () => {
  assert.equal(normalizeSpecialtyActionError({ code: 'LAST_SPECIALTY' }), 'last_specialty');
});

test('normalizeSpecialtyActionError maps last specialty message', () => {
  assert.equal(normalizeSpecialtyActionError({ message: 'cannot remove last specialty' }), 'last_specialty');
});

test('normalizeSpecialtyActionError maps network error', () => {
  assert.equal(normalizeSpecialtyActionError({ code: 'NETWORK_ERROR' }), 'network');
  assert.equal(normalizeSpecialtyActionError({ message: 'network timeout' }), 'network');
});

test('normalizeSpecialtyActionError maps configuration error', () => {
  assert.equal(normalizeSpecialtyActionError({ message: 'endpoint not configured' }), 'configuration');
});

test('normalizeSpecialtyActionError returns unknown for unrecognized input', () => {
  assert.equal(normalizeSpecialtyActionError(null), 'unknown');
  assert.equal(normalizeSpecialtyActionError({ message: 'something weird' }), 'unknown');
});

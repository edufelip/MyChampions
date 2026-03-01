import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAuthEntryViewed,
  buildSignInSubmitted,
  buildSignInFailed,
  buildSignUpSubmitted,
  buildSignUpFailed,
  buildRoleSelected,
  buildSelfGuidedStartClicked,
  buildInviteSubmitRequested,
  buildInviteSubmitFailed,
  buildInvitePendingCreated,
  buildInvitePendingCanceled,
  redactEventProperties,
} from './analytics.logic';

// --- Event builders ---

test('buildAuthEntryViewed produces correct event', () => {
  const event = buildAuthEntryViewed('auth_sign_in');
  assert.equal(event.name, 'auth.entry.viewed');
  assert.equal(event.properties.surface, 'auth_sign_in');
  assert.equal(event.properties.result, 'success');
  assert.equal(event.properties.step, 'view');
});

test('buildSignInSubmitted produces correct event with channel', () => {
  const event = buildSignInSubmitted('google');
  assert.equal(event.name, 'auth.sign_in.submitted');
  assert.equal(event.properties.channel, 'google');
  assert.equal(event.properties.result, 'success');
});

test('buildSignInFailed produces correct event with reason_code', () => {
  const event = buildSignInFailed('email_password', 'invalid_password');
  assert.equal(event.name, 'auth.sign_in.failed');
  assert.equal(event.properties.result, 'failure');
  assert.equal(event.properties.reason_code, 'invalid_password');
  assert.equal(event.properties.channel, 'email_password');
});

test('buildSignUpSubmitted produces correct event', () => {
  const event = buildSignUpSubmitted('apple');
  assert.equal(event.name, 'auth.sign_up.submitted');
  assert.equal(event.properties.result, 'success');
  assert.equal(event.properties.channel, 'apple');
});

test('buildSignUpFailed produces correct event with reason_code', () => {
  const event = buildSignUpFailed('email_password', 'email_exists');
  assert.equal(event.name, 'auth.sign_up.failed');
  assert.equal(event.properties.result, 'failure');
  assert.equal(event.properties.reason_code, 'email_exists');
});

test('buildRoleSelected produces event with role_context', () => {
  const studentEvent = buildRoleSelected('student');
  assert.equal(studentEvent.name, 'onboarding.role.selected');
  assert.equal(studentEvent.properties.role_context, 'student');
  assert.equal(studentEvent.properties.result, 'success');

  const proEvent = buildRoleSelected('professional');
  assert.equal(proEvent.properties.role_context, 'professional');
});

test('buildSelfGuidedStartClicked produces correct event', () => {
  const event = buildSelfGuidedStartClicked();
  assert.equal(event.name, 'onboarding.self_guided_start.clicked');
  assert.equal(event.properties.role_context, 'student');
  assert.equal(event.properties.result, 'success');
});

test('buildSelfGuidedStartClicked event includes role_context as student', () => {
  const event = buildSelfGuidedStartClicked();
  assert.ok(event.properties.role_context === 'student', 'role_context must be student');
});

test('buildSelfGuidedStartClicked event result is always success', () => {
  const event = buildSelfGuidedStartClicked();
  assert.ok(event.properties.result === 'success', 'self-guided start result should always be success');
});

test('buildSelfGuidedStartClicked has expected property keys', () => {
  const event = buildSelfGuidedStartClicked();
  const keys = Object.keys(event.properties);
  assert.ok(keys.includes('role_context'), 'properties should include role_context');
  assert.ok(keys.includes('result'), 'properties should include result');
  assert.ok(keys.includes('step'), 'properties should include step');
});

test('buildInviteSubmitRequested produces correct event', () => {
  const event = buildInviteSubmitRequested('manual');
  assert.equal(event.name, 'invite.submit.requested');
  assert.equal(event.properties.channel, 'manual');
});

test('buildInviteSubmitFailed produces correct event', () => {
  const event = buildInviteSubmitFailed('qr', 'code_expired');
  assert.equal(event.name, 'invite.submit.failed');
  assert.equal(event.properties.result, 'failure');
  assert.equal(event.properties.reason_code, 'code_expired');
});

test('buildInvitePendingCreated produces correct event', () => {
  const event = buildInvitePendingCreated('manual');
  assert.equal(event.name, 'invite.pending.created');
  assert.equal(event.properties.result, 'success');
});

test('buildInvitePendingCanceled produces correct event with reason_code', () => {
  const event = buildInvitePendingCanceled();
  assert.equal(event.name, 'invite.pending.canceled');
  assert.equal(event.properties.reason_code, 'code_rotated_canceled');
});

// --- redactEventProperties ---

test('redactEventProperties strips sensitive keys (FR-208, BR-266)', () => {
  const redacted = redactEventProperties({
    surface: 'auth_sign_in',
    step: 'submit',
    result: 'success',
    password: 'secret123',
    token: 'abc.def.ghi',
    id_token: 'token-value',
    email: 'user@example.com',
    invite_code: 'CODE123',
    code: 'CODE',
  });

  assert.equal('password' in redacted, false);
  assert.equal('token' in redacted, false);
  assert.equal('id_token' in redacted, false);
  assert.equal('email' in redacted, false);
  assert.equal('invite_code' in redacted, false);
  assert.equal('code' in redacted, false);
});

test('redactEventProperties preserves non-sensitive fields', () => {
  const redacted = redactEventProperties({
    surface: 'auth_sign_in',
    step: 'submit',
    result: 'success',
    channel: 'google',
  });

  assert.equal(redacted.surface, 'auth_sign_in');
  assert.equal(redacted.step, 'submit');
  assert.equal(redacted.result, 'success');
  assert.equal(redacted.channel, 'google');
});

test('redactEventProperties strips keys case-insensitively', () => {
  const redacted = redactEventProperties({
    PASSWORD: 'secret',
    Token: 'abc',
    safe_field: 'value',
  });
  // Note: key lookup is lowercase — 'PASSWORD'.toLowerCase() = 'password'
  assert.equal('password' in redacted || 'PASSWORD' in redacted, false);
  assert.equal(redacted.safe_field, 'value');
});

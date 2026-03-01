/**
 * Milestone A analytics event taxonomy logic.
 * Pure functions, no Firebase/external SDK dependencies.
 * All sensitive fields are redacted before event emission.
 * Refs: D-068, FR-206–FR-208, BR-265, BR-266, AC-251, AC-252, TC-254, TC-255
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type AnalyticsResult = 'success' | 'failure';

export type AnalyticsChannel =
  | 'email_password'
  | 'google'
  | 'apple'
  | 'manual'
  | 'qr';

export type AnalyticsSurface =
  | 'auth_sign_in'
  | 'auth_create_account'
  | 'role_selection'
  | 'relationship_management';

export type AnalyticsEventName =
  | 'auth.entry.viewed'
  | 'auth.sign_in.submitted'
  | 'auth.sign_in.failed'
  | 'auth.sign_up.submitted'
  | 'auth.sign_up.failed'
  | 'onboarding.role.selected'
  | 'onboarding.self_guided_start.clicked'
  | 'invite.submit.requested'
  | 'invite.submit.failed'
  | 'invite.pending.created'
  | 'invite.pending.canceled';

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  properties: AnalyticsEventProperties;
};

export type AnalyticsEventProperties = {
  surface: AnalyticsSurface;
  step: string;
  result: AnalyticsResult;
  reason_code?: string;
  channel?: AnalyticsChannel;
  role_context?: 'student' | 'professional';
};

// ─── Event builders ───────────────────────────────────────────────────────────

export function buildAuthEntryViewed(surface: AnalyticsSurface): AnalyticsEvent {
  return {
    name: 'auth.entry.viewed',
    properties: { surface, step: 'view', result: 'success' },
  };
}

export function buildSignInSubmitted(channel: AnalyticsChannel): AnalyticsEvent {
  return {
    name: 'auth.sign_in.submitted',
    properties: { surface: 'auth_sign_in', step: 'submit', channel, result: 'success' },
  };
}

export function buildSignInFailed(channel: AnalyticsChannel, reasonCode: string): AnalyticsEvent {
  return {
    name: 'auth.sign_in.failed',
    properties: { surface: 'auth_sign_in', step: 'submit', channel, result: 'failure', reason_code: reasonCode },
  };
}

export function buildSignUpSubmitted(channel: AnalyticsChannel): AnalyticsEvent {
  return {
    name: 'auth.sign_up.submitted',
    properties: { surface: 'auth_create_account', step: 'submit', channel, result: 'success' },
  };
}

export function buildSignUpFailed(channel: AnalyticsChannel, reasonCode: string): AnalyticsEvent {
  return {
    name: 'auth.sign_up.failed',
    properties: { surface: 'auth_create_account', step: 'submit', channel, result: 'failure', reason_code: reasonCode },
  };
}

export function buildRoleSelected(role: 'student' | 'professional'): AnalyticsEvent {
  return {
    name: 'onboarding.role.selected',
    properties: { surface: 'role_selection', step: 'select', result: 'success', role_context: role },
  };
}

export function buildSelfGuidedStartClicked(): AnalyticsEvent {
  return {
    name: 'onboarding.self_guided_start.clicked',
    properties: { surface: 'role_selection', step: 'shortcut', result: 'success', role_context: 'student' },
  };
}

export function buildInviteSubmitRequested(channel: AnalyticsChannel): AnalyticsEvent {
  return {
    name: 'invite.submit.requested',
    properties: { surface: 'relationship_management', step: 'submit', channel, result: 'success' },
  };
}

export function buildInviteSubmitFailed(channel: AnalyticsChannel, reasonCode: string): AnalyticsEvent {
  return {
    name: 'invite.submit.failed',
    properties: { surface: 'relationship_management', step: 'submit', channel, result: 'failure', reason_code: reasonCode },
  };
}

export function buildInvitePendingCreated(channel: AnalyticsChannel): AnalyticsEvent {
  return {
    name: 'invite.pending.created',
    properties: { surface: 'relationship_management', step: 'pending', channel, result: 'success' },
  };
}

export function buildInvitePendingCanceled(): AnalyticsEvent {
  return {
    name: 'invite.pending.canceled',
    properties: { surface: 'relationship_management', step: 'canceled', result: 'success', reason_code: 'code_rotated_canceled' },
  };
}

// ─── Redaction ────────────────────────────────────────────────────────────────

/**
 * Strips any key that would expose sensitive data before emission.
 * Never log: passwords, auth tokens, full email, full invite codes.
 * Refs: FR-208, BR-266
 */
export function redactEventProperties(
  props: AnalyticsEventProperties | Record<string, unknown>
): Record<string, unknown> {
  const FORBIDDEN_KEYS = new Set([
    'password', 'token', 'id_token', 'access_token', 'refresh_token',
    'invite_code', 'code', 'email', 'secret',
  ]);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result;
}

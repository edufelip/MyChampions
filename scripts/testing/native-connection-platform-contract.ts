import assert from 'node:assert/strict';
import {
  nativeConnectionAssertionIds,
  nativeConnectionAssertionSemanticSha256,
  requireNativePilotAssertions,
} from './native-pilot-contract';
import type { NativePilotSelection } from './native-pilot-contract';

/**
 * Private source candidate for the shared connection journey boundary.
 *
 * This module describes the platform contract only. It deliberately does not
 * acquire an emulator, start an API, drive Maestro, or stage public evidence.
 * The shared controller core is the implementation for both thin platform
 * wrappers in this candidate; the iOS wrapper preserves its existing helper
 * behavior while Android runtime qualification remains pending.
 */

export type ConnectionPlatform = 'ios' | 'android';
export type ConnectionActor = 'coach' | 'student';
export type ConnectionNavigation = 'none' | 'student-professionals-back';
export type ConnectionFrameTextAttribute = 'accessibilityText' | 'text';

export type ConnectionSelectorSet = Readonly<{
  accountTab: string;
  signOut: string;
  signOutConfirm: string;
  signInEmail: string;
  signInPassword: string;
  signInSubmit: string;
  coachHome: string;
  studentHome: string;
  studentProfessionalsEntry: string;
  studentProfessionalsScreen: string;
  studentProfessionalsBack: string;
  studentCodeInput: string;
  studentConnect: string;
  pendingStudentCardPrefix: string;
  activeStudentCardPrefix: string;
  coachInviteCode: string;
  coachPendingConnections: string;
  coachRoster: string;
  coachPendingScreen: string;
  coachPendingBack: string;
  coachPendingFilter: string;
  coachActiveFilter: string;
  coachRosterScreen: string;
}>;

export type ConnectionPlatformProfile = Readonly<{
  platform: ConnectionPlatform;
  scenarioId: `SCN-connection-${ConnectionPlatform}`;
  fixtureScope: `native-entry-${ConnectionPlatform}`;
  isolationScope: 'native-connection-isolation-ios' | 'native-conn-isolation-android';
  expectedLocale: 'en-US';
  frameTextAttribute: ConnectionFrameTextAttribute;
  actors: readonly ConnectionActor[];
  navigation: readonly ConnectionNavigation[];
  selectors: ConnectionSelectorSet;
  credentialPrompt: 'ios-password-save' | 'none';
  keyboardDismissal: 'hideKeyboard' | 'native-back';
  hierarchyDifference: string;
}>;

export type ConnectionPurposeId = (typeof nativeConnectionAssertionIds)[number];

export type ConnectionPurposePlan = Readonly<{
  id: ConnectionPurposeId;
  actor: ConnectionActor;
  navigation: ConnectionNavigation;
  requiredSnapshot: string;
  requiredEvidence: readonly ('ui' | 'api' | 'sql')[];
}>;

export const CONNECTION_SNAPSHOT_KEYS = Object.freeze([
  'normalCoachBefore',
  'normalCoachAfter',
  'before',
  'pending',
  'pendingAfterCoachAuth',
  'active',
  'activeAfterStudentAuth',
  'final',
  'isolationBefore',
  'isolationAfter',
  'trainingBefore',
  'trainingAfter',
] as const);

const commonSelectors: ConnectionSelectorSet = Object.freeze({
  accountTab: 'tabs.account',
  signOut: 'settings.account.signOutCta',
  signOutConfirm: 'settings.account.signOutConfirmCta',
  signInEmail: 'auth.signIn.emailInput',
  signInPassword: 'auth.signIn.passwordInput',
  signInSubmit: 'auth.signIn.submitButton',
  coachHome: 'pro.home.screen',
  studentHome: 'student.home.screen',
  studentProfessionalsEntry: 'student.home.accountButton',
  studentProfessionalsScreen: 'student.professionals.screen',
  studentProfessionalsBack: 'student.professionals.backButton',
  studentCodeInput: 'student.professionals.codeInput',
  studentConnect: 'student.professionals.connectButton',
  pendingStudentCardPrefix: 'student.professionals.connectionPending.',
  activeStudentCardPrefix: 'student.professionals.activeConnection.',
  coachInviteCode: 'pro.home.inviteCodeValue',
  coachPendingConnections: 'pro.home.pendingConnections',
  coachRoster: 'pro.home.rosterCta',
  coachPendingScreen: 'pro.pending.screen',
  coachPendingBack: 'pro.pending.backButton',
  coachPendingFilter: 'pro.students.filter.pending',
  coachActiveFilter: 'pro.students.filter.active',
  coachRosterScreen: 'pro.students.screen',
});

export const ANDROID_CONNECTION_PLATFORM: ConnectionPlatformProfile = Object.freeze({
  platform: 'android',
  scenarioId: 'SCN-connection-android',
  fixtureScope: 'native-entry-android',
  isolationScope: 'native-conn-isolation-android',
  expectedLocale: 'en-US',
  frameTextAttribute: 'accessibilityText',
  actors: Object.freeze(['coach', 'student'] as const),
  navigation: Object.freeze(['none', 'student-professionals-back'] as const),
  selectors: commonSelectors,
  credentialPrompt: 'none',
  keyboardDismissal: 'hideKeyboard',
  hierarchyDifference:
    "Android connection roster and pending-card evidence uses resource-id plus accessibilityText because retained normalized trees leave text empty. Credential and submit flows retain the capture producer's Maestro hideKeyboard action; student-professionals-back remains the only semantic account-navigation action. Maestro startup warnings, compact queue/roster layout and Account-tab reachability remain runtime prerequisites.",
});

export const IOS_CONNECTION_PLATFORM: ConnectionPlatformProfile = Object.freeze({
  platform: 'ios',
  scenarioId: 'SCN-connection-ios',
  fixtureScope: 'native-entry-ios',
  isolationScope: 'native-connection-isolation-ios',
  expectedLocale: 'en-US',
  frameTextAttribute: 'accessibilityText',
  actors: Object.freeze(['coach', 'student'] as const),
  navigation: Object.freeze(['none', 'student-professionals-back'] as const),
  selectors: commonSelectors,
  credentialPrompt: 'ios-password-save',
  keyboardDismissal: 'hideKeyboard',
  hierarchyDifference:
    'iOS hierarchy evidence uses accessibilityText and its sign-in flow includes the password-save prompt; the existing iOS adapter still accepts a legacy semantic back-action string.',
});

export const CONNECTION_PURPOSE_PLANS: readonly ConnectionPurposePlan[] = Object.freeze([
  {
    id: 'NAT-connection-normal-entry',
    actor: 'coach',
    navigation: 'none',
    requiredSnapshot: 'normalCoachBefore/normalCoachAfter',
    requiredEvidence: Object.freeze(['ui', 'api', 'sql'] as const),
  },
  {
    id: 'NAT-connection-submit-pending',
    actor: 'student',
    navigation: 'none',
    requiredSnapshot: 'before/pending',
    requiredEvidence: Object.freeze(['ui', 'api', 'sql'] as const),
  },
  {
    id: 'NAT-connection-pending-state',
    actor: 'coach',
    navigation: 'student-professionals-back',
    requiredSnapshot: 'pending/pendingAfterCoachAuth',
    requiredEvidence: Object.freeze(['ui', 'api', 'sql'] as const),
  },
  {
    id: 'NAT-connection-confirm-active',
    actor: 'coach',
    navigation: 'none',
    requiredSnapshot: 'pendingAfterCoachAuth/active',
    requiredEvidence: Object.freeze(['ui', 'api', 'sql'] as const),
  },
  {
    id: 'NAT-connection-active-student',
    actor: 'student',
    navigation: 'none',
    requiredSnapshot: 'active/activeAfterStudentAuth/final',
    requiredEvidence: Object.freeze(['ui', 'api', 'sql'] as const),
  },
  {
    id: 'NAT-connection-active-roster',
    actor: 'coach',
    navigation: 'none',
    requiredSnapshot: 'active/activeAfterStudentAuth',
    requiredEvidence: Object.freeze(['ui', 'api', 'sql'] as const),
  },
  {
    id: 'NAT-connection-unrelated-state',
    actor: 'student',
    navigation: 'none',
    requiredSnapshot: 'isolationBefore/isolationAfter/trainingBefore/trainingAfter',
    requiredEvidence: Object.freeze(['sql'] as const),
  },
]);

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireHash(value: unknown, label: string): string {
  assert(
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    `${label} must be a SHA-256 hash`,
  );
  return value;
}

function requireSelectorSet(value: unknown): ConnectionSelectorSet {
  const row = requireRecord(value, 'Connection selector set');
  const keys = Object.keys(commonSelectors).sort();
  assert.deepEqual(Object.keys(row).sort(), keys, 'Connection selector set changed shape');
  for (const key of keys) {
    const selector = row[key];
    assert(
      typeof selector === 'string' && selector.length > 0 && !/[()\[\]{}]/.test(selector),
      `Connection selector is invalid: ${key}`,
    );
    assert(
      !/runFlow|runScript|launchApp|openLink|clearState|coordinate|index/i.test(selector),
      `Connection selector uses an unsafe action or index: ${key}`,
    );
  }
  return row as unknown as ConnectionSelectorSet;
}

export function requireConnectionPlatformProfile(value: unknown): ConnectionPlatformProfile {
  const row = requireRecord(value, 'Connection platform profile');
  assert(row.platform === 'ios' || row.platform === 'android', 'Connection platform is invalid');
  const platform = row.platform;
  assert(row.scenarioId === `SCN-connection-${platform}`, 'Connection scenario ID is invalid');
  assert(row.fixtureScope === `native-entry-${platform}`, 'Connection fixture scope is invalid');
  assert(
    row.isolationScope ===
      (platform === 'android'
        ? 'native-conn-isolation-android'
        : 'native-connection-isolation-ios'),
    'Connection isolation scope is invalid',
  );
  assert.equal(row.expectedLocale, 'en-US', 'Connection locale must be explicitly en-US');
  assert(
    row.frameTextAttribute === 'text' || row.frameTextAttribute === 'accessibilityText',
    'Connection hierarchy text attribute is invalid',
  );
  assert.deepEqual(row.actors, ['coach', 'student'], 'Connection actor scope changed');
  assert(Array.isArray(row.navigation), 'Connection navigation scope is invalid');
  assert(
    row.navigation.length > 0 &&
      row.navigation.every((item) => item === 'none' || item === 'student-professionals-back') &&
      new Set(row.navigation).size === row.navigation.length,
    'Connection navigation scope contains an unsupported action',
  );
  assert(row.credentialPrompt === 'ios-password-save' || row.credentialPrompt === 'none');
  assert(row.keyboardDismissal === 'hideKeyboard' || row.keyboardDismissal === 'native-back');
  assert(
    typeof row.hierarchyDifference === 'string' && row.hierarchyDifference.length > 0,
    'Connection hierarchy difference is missing',
  );
  requireSelectorSet(row.selectors);
  return row as unknown as ConnectionPlatformProfile;
}

export function requireConnectionPurposePlan(value: unknown): readonly ConnectionPurposePlan[] {
  assert(Array.isArray(value), 'Connection purpose plan must be an array');
  assert.equal(value.length, nativeConnectionAssertionIds.length);
  assert.deepEqual(
    value.map((row) => requireRecord(row, 'Connection purpose').id),
    nativeConnectionAssertionIds,
    'Connection purpose order changed',
  );
  for (const raw of value) {
    const row = requireRecord(raw, 'Connection purpose');
    assert(row.actor === 'coach' || row.actor === 'student');
    assert(row.navigation === 'none' || row.navigation === 'student-professionals-back');
    assert(typeof row.requiredSnapshot === 'string' && row.requiredSnapshot.length > 0);
    assert.deepEqual(
      row.requiredEvidence,
      row.id === 'NAT-connection-unrelated-state' ? ['sql'] : ['ui', 'api', 'sql'],
    );
  }
  return value as readonly ConnectionPurposePlan[];
}

export function buildConnectionPlatformSelectionContract(
  selection: NativePilotSelection,
  profile: ConnectionPlatformProfile,
) {
  const checkedProfile = requireConnectionPlatformProfile(profile);
  assert.deepEqual(
    selection.arguments,
    {
      platform: checkedProfile.platform,
      engine: 'maestro',
      scenario: checkedProfile.scenarioId,
      mode: 'integration',
    },
    'Connection selection does not match the platform profile',
  );
  assert.equal(selection.scenario.id, checkedProfile.scenarioId);
  assert.equal(selection.scenario.platform, checkedProfile.platform);
  assert.equal(selection.scenario.flowId, 'FLW-connection');
  assert.equal(selection.scenario.dataMode, 'postgres');
  assert.equal(
    selection.scenario.fixtureRef,
    `owned-postgres:${checkedProfile.scenarioId}:fresh-attempt`,
  );
  const scenarioWithRoles = selection.scenario as typeof selection.scenario & {
    roles?: unknown;
  };
  assert(
    Array.isArray(scenarioWithRoles.roles) &&
      scenarioWithRoles.roles.length === 2 &&
      scenarioWithRoles.roles.every((role) => role === 'coach' || role === 'student'),
    'Connection scenario actor roles are incomplete',
  );
  const roles = scenarioWithRoles.roles as string[];
  assert.deepEqual([...roles].sort(), ['coach', 'student']);
  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    nativeConnectionAssertionIds,
    'Connection assertion purpose order changed',
  );
  assert.equal(
    selection.scenario.pilotAssertionContract?.semanticSha256,
    nativeConnectionAssertionSemanticSha256,
  );
  requireHash(selection.scenarioHash, 'Connection scenario hash');
  requireHash(selection.requirementHash, 'Connection requirement hash');
  return Object.freeze({
    platform: checkedProfile.platform,
    scenarioId: checkedProfile.scenarioId,
    fixtureScope: checkedProfile.fixtureScope,
    isolationScope: checkedProfile.isolationScope,
    assertionIds: Object.freeze([...nativeConnectionAssertionIds]),
    semanticSha256: nativeConnectionAssertionSemanticSha256,
    nativePassingCases: 0 as const,
  });
}

export function buildConnectionJourneyActionPlan(
  profile: ConnectionPlatformProfile,
): readonly ConnectionPurposePlan[] {
  const checkedProfile = requireConnectionPlatformProfile(profile);
  const plan = requireConnectionPurposePlan(CONNECTION_PURPOSE_PLANS);
  for (const purpose of plan)
    assert(
      checkedProfile.actors.includes(purpose.actor) &&
        checkedProfile.navigation.includes(purpose.navigation),
      `Connection purpose is outside the ${checkedProfile.platform} actor/navigation scope`,
    );
  return plan;
}

export function buildConnectionJourneyArtifactContract(profile: ConnectionPlatformProfile) {
  const checkedProfile = requireConnectionPlatformProfile(profile);
  const purposePlan = buildConnectionJourneyActionPlan(checkedProfile);
  return Object.freeze({
    status: 'candidate-only' as const,
    platform: checkedProfile.platform,
    scenarioId: checkedProfile.scenarioId,
    fixtureScope: checkedProfile.fixtureScope,
    isolationScope: checkedProfile.isolationScope,
    purposeIds: Object.freeze(purposePlan.map((purpose) => purpose.id)),
    snapshotKeys: Object.freeze([...CONNECTION_SNAPSHOT_KEYS]),
    nativePassingCases: 0 as const,
    runtimeExecution: 'pending' as const,
    publicStaging: 'pending' as const,
  });
}

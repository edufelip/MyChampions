import type { SuiteConfig } from './test-impact';

export type Environment = Readonly<Record<string, string>>;

/**
 * One Metro bundle configuration. `appEnv` is baked into the bundle when Metro
 * starts; `id` is also the Maestro tag that selects the flows run against it.
 */
export type NativeFixturePhase = {
  id: string;
  specs: '*' | readonly string[];
  appEnv?: Environment;
};

export type NativeFixtureProfile = {
  selectiveCi: boolean;
  allowRepeatedSpecs?: boolean;
  phases: readonly NativeFixturePhase[];
};

const authenticatedAppEnv = {
  EXPO_PUBLIC_E2E_AUTH_SESSION: 'true',
} as const;

const activeProfessionalAppEnv = {
  ...authenticatedAppEnv,
  EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS: 'active',
  EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT: '2',
  EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS: 'active',
} as const;

/**
 * These are the complete fixture variables that a selective run is allowed to
 * control. Every phase clears the complete set before applying its own values,
 * so a persistent self-hosted runner cannot leak fixture state between suites.
 */
export const SELECTIVE_FIXTURE_ENV_KEYS = [
  'EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION',
  'EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS',
  'EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID',
  'EXPO_PUBLIC_E2E_AUTH_SESSION',
  'EXPO_PUBLIC_E2E_AUTH_UID',
  'EXPO_PUBLIC_E2E_CREATE_ACCOUNT',
  'EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE',
  'EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN',
  'EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE',
  'EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE',
  'EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE',
  'EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE',
  'EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE',
  'EXPO_PUBLIC_E2E_NETWORK_STATUS',
  'EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME',
  'EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT',
  'EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK',
  'EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS',
  'EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE',
  'EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE',
  'EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE',
  'EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD',
  'EXPO_PUBLIC_E2E_ROLE_PERSISTENCE',
  'EXPO_PUBLIC_E2E_SOCIAL_AUTH',
  'EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX',
  'EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE',
  'EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE',
] as const;

const actionScenario = (
  id: 'success' | 'cancelled' | 'network' | 'store_problem',
): NativeFixturePhase => ({
  id: `actions-${id}`,
  specs: ['.maestro/suite/professional-subscription-actions'],
  appEnv: {
    ...authenticatedAppEnv,
    EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS: 'unknown',
    EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME: id,
    EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT: '3',
    EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK: 'false',
    EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS: 'lapsed',
  },
});

const capScenario = (
  id: 'warning' | 'locked' | 'unknown',
  entitlementStatus: 'active' | 'lapsed' | 'unknown',
  activeStudentCount: string,
  renewalRisk: 'true' | 'false',
): NativeFixturePhase => ({
  id: `cap-${id}`,
  specs: ['.maestro/suite/professional-subscription-cap'],
  appEnv: {
    ...authenticatedAppEnv,
    EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS: 'unknown',
    EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME: 'success',
    EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT: activeStudentCount,
    EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK: renewalRisk,
    EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS: entitlementStatus,
  },
});

export const NATIVE_FIXTURE_PROFILES = {
  'auth-entry-and-authenticated': {
    selectiveCi: true,
    phases: [
      {
        id: 'auth-entry',
        specs: ['.maestro/suite/auth-sign-in'],
        appEnv: {
          EXPO_PUBLIC_E2E_CREATE_ACCOUNT: 'true',
          EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN: 'true',
          EXPO_PUBLIC_E2E_SOCIAL_AUTH: 'true',
        },
      },
      {
        id: 'terms-outdated',
        specs: ['.maestro/suite/auth-terms'],
        appEnv: {
          ...authenticatedAppEnv,
          EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION: 'outdated-e2e-version',
        },
      },
      {
        id: 'authenticated',
        specs: [
          '.maestro/suite/auth-role-selection',
          '.maestro/suite/account-password-reset',
          '.maestro/suite/account-deletion',
          '.maestro/suite/account-settings',
          '.maestro/suite/language-select',
        ],
        appEnv: authenticatedAppEnv,
      },
    ],
  },
  'auth-role-persistence': {
    selectiveCi: true,
    phases: [
      {
        id: 'role-persistence',
        specs: ['.maestro/suite/auth-role-selection'],
        appEnv: {
          ...authenticatedAppEnv,
          EXPO_PUBLIC_E2E_ROLE_PERSISTENCE: 'true',
        },
      },
    ],
  },
  'authenticated-connections': {
    selectiveCi: true,
    allowRepeatedSpecs: true,
    phases: [
      {
        id: 'connections',
        specs: ['.maestro/suite/professional-home-invite-code'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
      {
        id: 'qr-valid',
        specs: ['.maestro/suite/student-professionals'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD: 'NUT123',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
      {
        id: 'qr-invalid-payload',
        specs: ['.maestro/suite/student-professionals'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD: 'not-a-valid-invite-payload',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
    ],
  },
  'authenticated-nutrition': {
    selectiveCi: true,
    allowRepeatedSpecs: true,
    phases: [
      {
        id: 'nutrition',
        specs: [
          '.maestro/suite/student-nutrition',
          '.maestro/suite/custom-meal-builder',
          '.maestro/suite/custom-meal-library',
          '.maestro/suite/professional-nutrition-builder',
          '.maestro/suite/shared-recipe',
        ],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
      {
        id: 'image-upload-sheet',
        specs: ['.maestro/suite/custom-meal-image-upload'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
      {
        id: 'image-upload-success',
        specs: ['.maestro/suite/custom-meal-image-upload'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
      {
        id: 'image-upload-permission-denied',
        specs: ['.maestro/suite/custom-meal-image-upload'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE: 'permission-denied',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
      {
        id: 'meal-analysis-paywall',
        specs: ['.maestro/suite/custom-meal-ai-analysis'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS: 'lapsed',
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS: 'lapsed',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
      {
        id: 'meal-analysis-success',
        specs: ['.maestro/suite/custom-meal-ai-analysis'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
      },
    ],
  },
  'authenticated-training': {
    selectiveCi: true,
    phases: [
      {
        id: 'training',
        specs: '*',
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE: 'assigned',
        },
      },
    ],
  },
  'authenticated-plans': {
    selectiveCi: true,
    phases: [
      {
        id: 'professional-bulk-assign',
        specs: ['.maestro/suite/professional-bulk-assign'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
          EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE: 'assigned',
        },
      },
      {
        id: 'student-self-managed-builder',
        specs: ['.maestro/suite/student-self-managed-builder'],
        appEnv: {
          ...authenticatedAppEnv,
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
        },
      },
    ],
  },
  'authenticated-professional': {
    selectiveCi: true,
    phases: [
      {
        id: 'professional',
        specs: '*',
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
          EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE: 'assigned',
        },
      },
    ],
  },
  'authenticated-subscription': {
    selectiveCi: true,
    allowRepeatedSpecs: true,
    phases: [
      actionScenario('success'),
      actionScenario('cancelled'),
      actionScenario('network'),
      actionScenario('store_problem'),
      capScenario('warning', 'active', '10', 'true'),
      capScenario('locked', 'lapsed', '11', 'false'),
      capScenario('unknown', 'unknown', '11', 'false'),
    ],
  },
  'provider-live': {
    selectiveCi: false,
    phases: [],
  },
  'authenticated-support': {
    selectiveCi: true,
    phases: [
      {
        id: 'support',
        specs: '*',
        appEnv: authenticatedAppEnv,
      },
    ],
  },
  'authenticated-student': {
    selectiveCi: true,
    phases: [
      {
        id: 'student-empty-state',
        specs: '*',
        appEnv: authenticatedAppEnv,
      },
    ],
  },
  'authenticated-offline': {
    selectiveCi: true,
    phases: [
      {
        id: 'offline',
        specs: '*',
        appEnv: {
          ...authenticatedAppEnv,
          EXPO_PUBLIC_E2E_NETWORK_STATUS: 'offline',
        },
      },
    ],
  },
  'authenticated-platform': {
    selectiveCi: true,
    phases: [
      {
        id: 'platform',
        specs: '*',
        appEnv: authenticatedAppEnv,
      },
    ],
  },
} as const satisfies Record<string, NativeFixtureProfile>;

export type NativeFixtureProfileId = keyof typeof NATIVE_FIXTURE_PROFILES;

export function isNativeFixtureProfileId(value: string): value is NativeFixtureProfileId {
  return Object.hasOwn(NATIVE_FIXTURE_PROFILES, value);
}

export function clearedSelectiveFixtureEnvironment(): Record<string, string> {
  return Object.fromEntries(SELECTIVE_FIXTURE_ENV_KEYS.map((key) => [key, '']));
}

export function validateNativeFixtureProfile(suiteId: string, suite: SuiteConfig): string[] {
  const errors: string[] = [];
  const profileId = suite.fixtureProfile;
  if (!profileId) return [`Native suite ${suiteId} has no fixtureProfile`];
  if (!isNativeFixtureProfileId(profileId)) {
    return [`Native suite ${suiteId} references unknown fixtureProfile ${profileId}`];
  }

  const profile: NativeFixtureProfile = NATIVE_FIXTURE_PROFILES[profileId];
  if (suite.ci && !profile.selectiveCi) {
    errors.push(`CI native suite ${suiteId} uses non-selective profile ${profileId}`);
  }
  if (!suite.ci) return errors;

  const assigned = new Map<string, number>();
  for (const phase of profile.phases) {
    const specs = phase.specs === '*' ? suite.specs : phase.specs;
    if (specs.length === 0) errors.push(`fixture phase ${profileId}/${phase.id} has no specs`);
    for (const spec of specs) {
      if (!suite.specs.includes(spec)) {
        errors.push(`fixture phase ${profileId}/${phase.id} references foreign spec ${spec}`);
        continue;
      }
      assigned.set(spec, (assigned.get(spec) ?? 0) + 1);
    }
  }

  for (const spec of suite.specs) {
    const count = assigned.get(spec) ?? 0;
    if (count === 0) errors.push(`fixture profile ${profileId} does not execute ${spec}`);
    if (count > 1 && !profile.allowRepeatedSpecs) {
      errors.push(`fixture profile ${profileId} executes ${spec} more than once`);
    }
  }

  return errors;
}

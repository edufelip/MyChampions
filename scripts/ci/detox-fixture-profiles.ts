import type { SuiteConfig } from './test-impact';

export type Environment = Readonly<Record<string, string>>;

export type DetoxFixturePhase = {
  id: string;
  specs: '*' | readonly string[];
  appEnv?: Environment;
  runnerEnv?: Environment;
};

export type DetoxFixtureProfile = {
  selectiveCi: boolean;
  allowRepeatedSpecs?: boolean;
  phases: readonly DetoxFixturePhase[];
};

const authenticatedAppEnv = {
  EXPO_PUBLIC_E2E_AUTH_SESSION: 'true',
} as const;

const authenticatedRunnerEnv = {
  E2E_AUTH_SESSION: 'true',
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
  'E2E_AUTH_CREATE_ACCOUNT',
  'E2E_AUTH_SESSION',
  'E2E_AUTH_SIGN_IN',
  'E2E_AUTH_SOCIAL',
  'E2E_IMAGE_UPLOAD_SCENARIO',
  'E2E_MEAL_ANALYSIS_SCENARIO',
  'E2E_QR_INVITE_SCENARIO',
  'E2E_SUBSCRIPTION_ACTION_OUTCOME',
  'E2E_SUBSCRIPTION_SCENARIO',
  'E2E_ROLE_PERSISTENCE_SCENARIO',
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
): DetoxFixturePhase => ({
  id: `actions-${id}`,
  specs: ['e2e/professional-subscription-actions.e2e.test.js'],
  appEnv: {
    ...authenticatedAppEnv,
    EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS: 'unknown',
    EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME: id,
    EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT: '3',
    EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK: 'false',
    EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS: 'lapsed',
  },
  runnerEnv: {
    ...authenticatedRunnerEnv,
    E2E_SUBSCRIPTION_ACTION_OUTCOME: id,
    E2E_SUBSCRIPTION_SCENARIO: 'actions',
  },
});

const capScenario = (
  id: 'warning' | 'locked' | 'unknown',
  entitlementStatus: 'active' | 'lapsed' | 'unknown',
  activeStudentCount: string,
  renewalRisk: 'true' | 'false',
): DetoxFixturePhase => ({
  id: `cap-${id}`,
  specs: ['e2e/professional-subscription-cap.e2e.test.js'],
  appEnv: {
    ...authenticatedAppEnv,
    EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS: 'unknown',
    EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME: 'success',
    EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT: activeStudentCount,
    EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK: renewalRisk,
    EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS: entitlementStatus,
  },
  runnerEnv: {
    ...authenticatedRunnerEnv,
    E2E_SUBSCRIPTION_ACTION_OUTCOME: 'success',
    E2E_SUBSCRIPTION_SCENARIO: id,
  },
});

export const DETOX_FIXTURE_PROFILES = {
  'auth-entry-and-authenticated': {
    selectiveCi: true,
    phases: [
      {
        id: 'auth-entry',
        specs: ['e2e/auth-sign-in.e2e.test.js'],
        appEnv: {
          EXPO_PUBLIC_E2E_CREATE_ACCOUNT: 'true',
          EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN: 'true',
          EXPO_PUBLIC_E2E_SOCIAL_AUTH: 'true',
        },
        runnerEnv: {
          E2E_AUTH_CREATE_ACCOUNT: 'true',
          E2E_AUTH_SIGN_IN: 'true',
          E2E_AUTH_SOCIAL: 'true',
        },
      },
      {
        id: 'terms-outdated',
        specs: ['e2e/auth-terms.e2e.test.js'],
        appEnv: {
          ...authenticatedAppEnv,
          EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION: 'outdated-e2e-version',
        },
        runnerEnv: authenticatedRunnerEnv,
      },
      {
        id: 'authenticated',
        specs: [
          'e2e/auth-role-selection.e2e.test.js',
          'e2e/account-password-reset.e2e.test.js',
          'e2e/account-deletion.e2e.test.js',
          'e2e/account-settings.e2e.test.js',
          'e2e/language-select.e2e.test.js',
        ],
        appEnv: authenticatedAppEnv,
        runnerEnv: authenticatedRunnerEnv,
      },
    ],
  },
  'auth-role-persistence': {
    selectiveCi: true,
    phases: [
      {
        id: 'role-persistence',
        specs: ['e2e/auth-role-selection.e2e.test.js'],
        appEnv: {
          ...authenticatedAppEnv,
          EXPO_PUBLIC_E2E_ROLE_PERSISTENCE: 'true',
        },
        runnerEnv: {
          ...authenticatedRunnerEnv,
          E2E_ROLE_PERSISTENCE_SCENARIO: 'relaunch',
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
        specs: ['e2e/professional-home-invite-code.e2e.test.js'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
        runnerEnv: authenticatedRunnerEnv,
      },
      {
        id: 'qr-valid',
        specs: ['e2e/student-professionals.e2e.test.js'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD: 'NUT123',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
        runnerEnv: {
          ...authenticatedRunnerEnv,
          E2E_QR_INVITE_SCENARIO: 'valid_payload',
        },
      },
      {
        id: 'qr-invalid-payload',
        specs: ['e2e/student-professionals.e2e.test.js'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD: 'not-a-valid-invite-payload',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
        runnerEnv: {
          ...authenticatedRunnerEnv,
          E2E_QR_INVITE_SCENARIO: 'invalid_payload',
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
          'e2e/student-nutrition.e2e.test.js',
          'e2e/custom-meal-builder.e2e.test.js',
          'e2e/custom-meal-library.e2e.test.js',
          'e2e/professional-nutrition-builder.e2e.test.js',
          'e2e/shared-recipe.e2e.test.js',
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
        runnerEnv: authenticatedRunnerEnv,
      },
      {
        id: 'image-upload-sheet',
        specs: ['e2e/custom-meal-image-upload.e2e.test.js'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
        runnerEnv: {
          ...authenticatedRunnerEnv,
          E2E_IMAGE_UPLOAD_SCENARIO: 'sheet',
        },
      },
      {
        id: 'image-upload-success',
        specs: ['e2e/custom-meal-image-upload.e2e.test.js'],
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
        runnerEnv: {
          ...authenticatedRunnerEnv,
          E2E_IMAGE_UPLOAD_SCENARIO: 'success',
        },
      },
      {
        id: 'image-upload-permission-denied',
        specs: ['e2e/custom-meal-image-upload.e2e.test.js'],
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
        runnerEnv: {
          ...authenticatedRunnerEnv,
          E2E_IMAGE_UPLOAD_SCENARIO: 'permission-denied',
        },
      },
      {
        id: 'meal-analysis-paywall',
        specs: ['e2e/custom-meal-ai-analysis.e2e.test.js'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS: 'lapsed',
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS: 'lapsed',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
        runnerEnv: {
          ...authenticatedRunnerEnv,
          E2E_MEAL_ANALYSIS_SCENARIO: 'paywall',
        },
      },
      {
        id: 'meal-analysis-success',
        specs: ['e2e/custom-meal-ai-analysis.e2e.test.js'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_MEAL_ANALYSIS_FIXTURE: 'success',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
        },
        runnerEnv: {
          ...authenticatedRunnerEnv,
          E2E_MEAL_ANALYSIS_SCENARIO: 'success',
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
        runnerEnv: authenticatedRunnerEnv,
      },
    ],
  },
  'authenticated-plans': {
    selectiveCi: true,
    phases: [
      {
        id: 'professional-bulk-assign',
        specs: ['e2e/professional-bulk-assign.e2e.test.js'],
        appEnv: {
          ...activeProfessionalAppEnv,
          EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE: 'basic',
          EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE: 'assigned',
          EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE: 'assigned',
        },
        runnerEnv: authenticatedRunnerEnv,
      },
      {
        id: 'student-self-managed-builder',
        specs: ['e2e/student-self-managed-builder.e2e.test.js'],
        appEnv: {
          ...authenticatedAppEnv,
          EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE: 'basic',
        },
        runnerEnv: authenticatedRunnerEnv,
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
        runnerEnv: authenticatedRunnerEnv,
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
        runnerEnv: authenticatedRunnerEnv,
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
        runnerEnv: authenticatedRunnerEnv,
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
        runnerEnv: authenticatedRunnerEnv,
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
        runnerEnv: authenticatedRunnerEnv,
      },
    ],
  },
} as const satisfies Record<string, DetoxFixtureProfile>;

export type DetoxFixtureProfileId = keyof typeof DETOX_FIXTURE_PROFILES;

export function isDetoxFixtureProfileId(value: string): value is DetoxFixtureProfileId {
  return Object.hasOwn(DETOX_FIXTURE_PROFILES, value);
}

export function clearedSelectiveFixtureEnvironment(): Record<string, string> {
  return Object.fromEntries(SELECTIVE_FIXTURE_ENV_KEYS.map((key) => [key, '']));
}

export function validateDetoxFixtureProfile(suiteId: string, suite: SuiteConfig): string[] {
  const errors: string[] = [];
  const profileId = suite.fixtureProfile;
  if (!profileId) return [`Detox suite ${suiteId} has no fixtureProfile`];
  if (!isDetoxFixtureProfileId(profileId)) {
    return [`Detox suite ${suiteId} references unknown fixtureProfile ${profileId}`];
  }

  const profile: DetoxFixtureProfile = DETOX_FIXTURE_PROFILES[profileId];
  if (suite.ci && !profile.selectiveCi) {
    errors.push(`CI Detox suite ${suiteId} uses non-selective profile ${profileId}`);
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

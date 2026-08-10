import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  E2E_AUTH_SESSION_PASSWORD,
  resolveE2EAuthSessionOverride,
  resolveE2EAuthSessionSourceOverride,
  resolveE2EEmailPasswordCreateAccountOverride,
  resolveE2EEmailPasswordSignInOverride,
  resolveE2EPhaseConfigValue,
  resolveE2ESocialAuthOverride,
  resolveE2ESubscriptionOverride,
} from './e2e-auth-session';

test('runtime E2E phase config overrides and clears the embedded native config', () => {
  assert.equal(resolveE2EPhaseConfigValue('true', ''), 'true');
  assert.equal(resolveE2EPhaseConfigValue('', 'true'), '');
  assert.equal(resolveE2EPhaseConfigValue('outdated-v1', 'current-v2'), 'outdated-v1');
  assert.equal(resolveE2EPhaseConfigValue(undefined, 'embedded'), 'embedded');
  assert.equal(resolveE2EPhaseConfigValue(undefined, undefined), undefined);
});

test('resolveE2EAuthSessionOverride enables an unlocked dev auth session for E2E', () => {
  const session = resolveE2EAuthSessionOverride({
    appVariant: 'dev',
    enabledFlag: 'true',
    isDev: true,
    requiredTermsVersion: 'v3',
  });

  assert.deepEqual(session, {
    acceptedTermsVersion: 'v3',
    displayName: 'E2E Test User',
    email: 'e2e-auth-session@example.test',
    lockedRole: null,
    uid: 'e2e-auth-session-user',
  });
});

test('dev E2E auth derives isolated customer identities from an explicit run UID', () => {
  const previousUid = process.env.EXPO_PUBLIC_E2E_AUTH_UID;
  process.env.EXPO_PUBLIC_E2E_AUTH_UID = 'rc-live-20260723-001';

  try {
    const input = {
      appVariant: 'dev',
      enabledFlag: 'true',
      isDev: true,
      requiredTermsVersion: 'v3',
    } as const;

    assert.equal(resolveE2EAuthSessionOverride(input)?.uid, 'rc-live-20260723-001');
    assert.equal(resolveE2EAuthSessionSourceOverride(input)?.uid, 'rc-live-20260723-001');
    assert.equal(
      resolveE2EEmailPasswordSignInOverride({
        ...input,
        email: 'e2e-auth-session@example.test',
        password: E2E_AUTH_SESSION_PASSWORD,
      })?.uid,
      'rc-live-20260723-001',
    );
    assert.equal(
      resolveE2EEmailPasswordCreateAccountOverride({
        ...input,
        email: 'e2e-created-account@example.test',
        name: 'RevenueCat Student',
        password: 'E2E-create-123!',
      })?.uid,
      'rc-live-20260723-001-created',
    );
    assert.equal(
      resolveE2EEmailPasswordSignInOverride({
        ...input,
        email: 'e2e-created-account@example.test',
        password: 'E2E-create-123!',
      })?.uid,
      'rc-live-20260723-001-created',
    );
    assert.equal(
      resolveE2ESocialAuthOverride({
        ...input,
        provider: 'google',
      })?.uid,
      'rc-live-20260723-001-google',
    );
  } finally {
    if (previousUid === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_UID;
    else process.env.EXPO_PUBLIC_E2E_AUTH_UID = previousUid;
  }
});

test('dev E2E auth accepts an explicit allowlisted Google switch identity', () => {
  const previousUid = process.env.EXPO_PUBLIC_E2E_AUTH_UID;
  const previousGoogleUid = process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID;
  process.env.EXPO_PUBLIC_E2E_AUTH_UID = 'rc-student-v1-switch';
  process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID = 'rc-student-v1-switch-alt';

  try {
    assert.equal(
      resolveE2ESocialAuthOverride({
        appVariant: 'dev',
        enabledFlag: 'true',
        isDev: true,
        provider: 'google',
        requiredTermsVersion: 'v3',
      })?.uid,
      'rc-student-v1-switch-alt',
    );
  } finally {
    if (previousUid === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_UID;
    else process.env.EXPO_PUBLIC_E2E_AUTH_UID = previousUid;
    if (previousGoogleUid === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID;
    else process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID = previousGoogleUid;
  }
});

test('invalid explicit Google switch identity fails closed', () => {
  const previousGoogleUid = process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID;
  process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID = 'invalid customer id';

  try {
    assert.equal(
      resolveE2ESocialAuthOverride({
        appVariant: 'dev',
        enabledFlag: 'true',
        isDev: true,
        provider: 'google',
        requiredTermsVersion: 'v3',
      }),
      null,
    );
  } finally {
    if (previousGoogleUid === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID;
    else process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID = previousGoogleUid;
  }
});

test('invalid explicit E2E customer identities fail closed instead of sharing a fallback customer', () => {
  const previousUid = process.env.EXPO_PUBLIC_E2E_AUTH_UID;
  process.env.EXPO_PUBLIC_E2E_AUTH_UID = 'invalid customer id';

  try {
    assert.equal(
      resolveE2EAuthSessionOverride({
        appVariant: 'dev',
        enabledFlag: 'true',
        isDev: true,
        requiredTermsVersion: 'v3',
      }),
      null,
    );
    assert.equal(
      resolveE2EAuthSessionSourceOverride({
        appVariant: 'dev',
        enabledFlag: 'true',
        isDev: true,
      }),
      null,
    );
  } finally {
    if (previousUid === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_UID;
    else process.env.EXPO_PUBLIC_E2E_AUTH_UID = previousUid;
  }
});

test('resolveE2EEmailPasswordSignInOverride accepts only the deterministic dev credentials', () => {
  const session = resolveE2EEmailPasswordSignInOverride({
    appVariant: 'dev',
    email: ' E2E-AUTH-SESSION@EXAMPLE.TEST ',
    enabledFlag: 'true',
    isDev: true,
    password: E2E_AUTH_SESSION_PASSWORD,
    requiredTermsVersion: 'v3',
  });

  assert.deepEqual(session, {
    acceptedTermsVersion: 'v3',
    displayName: 'E2E Test User',
    email: 'e2e-auth-session@example.test',
    lockedRole: null,
    uid: 'e2e-auth-session-user',
  });

  assert.deepEqual(
    resolveE2EEmailPasswordSignInOverride({
      appVariant: 'dev',
      email: 'E2E-CREATED-ACCOUNT@EXAMPLE.TEST',
      enabledFlag: 'true',
      isDev: true,
      password: 'E2E-create-123!',
      requiredTermsVersion: 'v3',
    }),
    {
      acceptedTermsVersion: 'v3',
      displayName: 'New E2E User',
      email: 'e2e-created-account@example.test',
      lockedRole: null,
      uid: 'e2e-created-account-user',
    },
  );

  assert.equal(
    resolveE2EEmailPasswordSignInOverride({
      appVariant: 'dev',
      email: 'e2e-auth-session@example.test',
      enabledFlag: 'true',
      isDev: true,
      password: 'mismatched-password',
      requiredTermsVersion: 'v3',
    }),
    null,
  );
});

test('resolveE2EEmailPasswordCreateAccountOverride accepts only the deterministic dev create-account credentials', () => {
  const session = resolveE2EEmailPasswordCreateAccountOverride({
    appVariant: 'dev',
    email: ' E2E-CREATED-ACCOUNT@EXAMPLE.TEST ',
    enabledFlag: 'true',
    isDev: true,
    name: '  New E2E User  ',
    password: 'E2E-create-123!',
    requiredTermsVersion: 'v3',
  });

  assert.deepEqual(session, {
    acceptedTermsVersion: 'v3',
    displayName: 'New E2E User',
    email: 'e2e-created-account@example.test',
    lockedRole: null,
    uid: 'e2e-created-account-user',
  });

  assert.equal(
    resolveE2EEmailPasswordCreateAccountOverride({
      appVariant: 'dev',
      email: 'e2e-created-account@example.test',
      enabledFlag: 'true',
      isDev: true,
      name: 'New E2E User',
      password: 'mismatched-password',
      requiredTermsVersion: 'v3',
    }),
    null,
  );
});

test('resolveE2ESocialAuthOverride creates deterministic dev social auth sessions', () => {
  const googleSession = resolveE2ESocialAuthOverride({
    acceptedTermsVersion: 'v2',
    appVariant: 'dev',
    enabledFlag: 'true',
    isDev: true,
    provider: 'google',
    requiredTermsVersion: 'v3',
  });

  assert.deepEqual(googleSession, {
    acceptedTermsVersion: 'v2',
    displayName: 'E2E Google User',
    email: 'e2e-google-auth@example.test',
    lockedRole: null,
    authProviderId: 'google',
    uid: 'e2e-google-auth-user',
  });

  const appleSession = resolveE2ESocialAuthOverride({
    appVariant: 'dev',
    enabledFlag: 'true',
    isDev: true,
    provider: 'apple',
    requiredTermsVersion: 'v3',
  });

  assert.deepEqual(appleSession, {
    acceptedTermsVersion: 'v3',
    displayName: 'E2E Apple User',
    email: 'e2e-apple-auth@example.test',
    lockedRole: null,
    authProviderId: 'apple',
    uid: 'e2e-apple-auth-user',
  });
});

test('resolveE2ESocialAuthOverride stays disabled outside explicit dev social auth', () => {
  assert.equal(
    resolveE2ESocialAuthOverride({
      appVariant: 'dev',
      enabledFlag: 'false',
      isDev: true,
      provider: 'google',
      requiredTermsVersion: 'v1',
    }),
    null,
  );

  assert.equal(
    resolveE2ESocialAuthOverride({
      appVariant: 'prod',
      enabledFlag: 'true',
      isDev: true,
      provider: 'apple',
      requiredTermsVersion: 'v1',
    }),
    null,
  );

  assert.equal(
    resolveE2ESocialAuthOverride({
      appVariant: 'dev',
      enabledFlag: 'true',
      isDev: false,
      provider: 'google',
      requiredTermsVersion: 'v1',
    }),
    null,
  );
});

test('resolveE2EAuthSessionOverride stays disabled outside dev E2E', () => {
  assert.equal(
    resolveE2EAuthSessionOverride({
      appVariant: 'dev',
      enabledFlag: 'false',
      isDev: true,
      requiredTermsVersion: 'v1',
    }),
    null,
  );

  assert.equal(
    resolveE2EAuthSessionOverride({
      appVariant: 'prod',
      enabledFlag: 'true',
      isDev: true,
      requiredTermsVersion: 'v1',
    }),
    null,
  );

  assert.equal(
    resolveE2EAuthSessionOverride({
      appVariant: 'dev',
      enabledFlag: 'true',
      isDev: false,
      requiredTermsVersion: 'v1',
    }),
    null,
  );
});

test('resolveE2EAuthSessionOverride allows missing app variant only for dev E2E bundles', () => {
  const session = resolveE2EAuthSessionOverride({
    appVariant: undefined,
    enabledFlag: 'true',
    isDev: true,
    requiredTermsVersion: 'v1',
  });

  assert.equal(session?.uid, 'e2e-auth-session-user');
});

test('resolveE2EAuthSessionOverride can start with an older accepted terms version', () => {
  const session = resolveE2EAuthSessionOverride({
    acceptedTermsVersion: 'v0',
    appVariant: 'dev',
    enabledFlag: 'true',
    isDev: true,
    requiredTermsVersion: 'v2',
  });

  assert.equal(session?.acceptedTermsVersion, 'v0');
});

test('resolveE2EAuthSessionSourceOverride exposes dev-only identity for source modules', () => {
  const sourceOverride = resolveE2EAuthSessionSourceOverride({
    appVariant: 'dev',
    enabledFlag: 'true',
    isDev: true,
  });

  assert.deepEqual(sourceOverride, {
    idToken: 'e2e-auth-session-token',
    uid: 'e2e-auth-session-user',
  });
});

test('resolveE2EAuthSessionSourceOverride stays disabled outside dev E2E', () => {
  assert.equal(
    resolveE2EAuthSessionSourceOverride({
      appVariant: 'prod',
      enabledFlag: 'true',
      isDev: true,
    }),
    null,
  );
});

test('resolveE2ESubscriptionOverride exposes dev-only entitlement and count fixtures', () => {
  const subscription = resolveE2ESubscriptionOverride({
    activeStudentCount: '11',
    aiEntitlementStatus: 'unknown',
    appVariant: 'dev',
    enabledFlag: 'true',
    entitlementStatus: 'lapsed',
    isDev: true,
    professionalEntitlementRenewalRisk: 'true',
  });

  assert.deepEqual(subscription, {
    activeStudentCount: 11,
    aiEntitlementStatus: 'unknown',
    entitlementStatus: 'lapsed',
    professionalEntitlementRenewalRisk: true,
  });
});

test('resolveE2ESubscriptionOverride stays disabled outside dev E2E and ignores invalid values', () => {
  assert.equal(
    resolveE2ESubscriptionOverride({
      activeStudentCount: '11',
      appVariant: 'prod',
      enabledFlag: 'true',
      entitlementStatus: 'lapsed',
      isDev: true,
    }),
    null,
  );

  assert.equal(
    resolveE2ESubscriptionOverride({
      activeStudentCount: '-1',
      appVariant: 'dev',
      enabledFlag: 'true',
      entitlementStatus: 'expired',
      isDev: true,
    }),
    null,
  );
});

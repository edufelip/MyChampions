import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRevenueCatConfig } from '../../app.config';

const REVENUECAT_ENV_KEYS = [
  'EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV',
  'EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_DEV',
  'EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_PROD',
  'EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_PROD',
  'EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE',
  'EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED',
  'EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID',
  'EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID',
] as const;

function withRevenueCatEnv(run: () => void): void {
  const previous = Object.fromEntries(
    REVENUECAT_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof REVENUECAT_ENV_KEYS)[number], string | undefined>;

  try {
    for (const key of REVENUECAT_ENV_KEYS) delete process.env[key];
    run();
  } finally {
    for (const key of REVENUECAT_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('app config selects one Test Store key for both platforms only in dev', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE = 'test_sandbox_key';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV = 'appl_dev_key';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_DEV = 'goog_dev_key';

    assert.deepEqual(resolveRevenueCatConfig('dev'), {
      revenueCatApiKeyIos: 'test_sandbox_key',
      revenueCatApiKeyAndroid: 'test_sandbox_key',
      revenueCatTestStoreEnabled: true,
      revenueCatStudentOfferingId: 'default_student',
      revenueCatProfessionalOfferingId: 'default_professional',
    });
  });
});

test('app config ignores the Test Store gate for production builds', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE = 'test_sandbox_key';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_PROD = 'appl_prod_key';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_PROD = 'goog_prod_key';

    assert.deepEqual(resolveRevenueCatConfig('prod'), {
      revenueCatApiKeyIos: 'appl_prod_key',
      revenueCatApiKeyAndroid: 'goog_prod_key',
      revenueCatTestStoreEnabled: false,
      revenueCatStudentOfferingId: 'default_student',
      revenueCatProfessionalOfferingId: 'default_professional',
    });
  });
});

test('app config accepts test_student only for an explicit dev Test Store build', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE = 'test_sandbox_key';
    process.env.EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID = 'test_student';

    assert.deepEqual(resolveRevenueCatConfig('dev'), {
      revenueCatApiKeyIos: 'test_sandbox_key',
      revenueCatApiKeyAndroid: 'test_sandbox_key',
      revenueCatTestStoreEnabled: true,
      revenueCatStudentOfferingId: 'test_student',
      revenueCatProfessionalOfferingId: 'default_professional',
    });
  });
});

test('app config keeps default_student for normal development', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV = 'appl_dev_key';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_DEV = 'goog_dev_key';

    assert.equal(
      resolveRevenueCatConfig('dev').revenueCatStudentOfferingId,
      'default_student'
    );
  });
});

test('app config accepts test_professional only for an explicit dev Test Store build', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE = 'test_sandbox_key';
    process.env.EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID = 'test_professional';

    assert.deepEqual(resolveRevenueCatConfig('dev'), {
      revenueCatApiKeyIos: 'test_sandbox_key',
      revenueCatApiKeyAndroid: 'test_sandbox_key',
      revenueCatTestStoreEnabled: true,
      revenueCatStudentOfferingId: 'default_student',
      revenueCatProfessionalOfferingId: 'test_professional',
    });
  });
});

test('app config rejects a production test_student override', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID = 'test_student';

    assert.throws(
      () => resolveRevenueCatConfig('prod'),
      /allowed only in an explicit development Test Store build/
    );
  });
});

test('app config rejects a production test_professional override', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID = 'test_professional';

    assert.throws(
      () => resolveRevenueCatConfig('prod'),
      /allowed only in an explicit development Test Store build/
    );
  });
});

test('app config rejects test_student when the development Test Store guard is off', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID = 'test_student';

    assert.throws(
      () => resolveRevenueCatConfig('dev'),
      /allowed only in an explicit development Test Store build/
    );
  });
});

test('app config rejects test_professional when the development Test Store guard is off', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID = 'test_professional';

    assert.throws(
      () => resolveRevenueCatConfig('dev'),
      /allowed only in an explicit development Test Store build/
    );
  });
});

test('app config rejects a malformed student offering override', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID = 'student_preview';

    assert.throws(
      () => resolveRevenueCatConfig('dev'),
      /must be default_student or test_student/
    );
  });
});

test('app config rejects a malformed professional offering override', () => {
  withRevenueCatEnv(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID = 'professional_preview';

    assert.throws(
      () => resolveRevenueCatConfig('dev'),
      /must be default_professional or test_professional/
    );
  });
});

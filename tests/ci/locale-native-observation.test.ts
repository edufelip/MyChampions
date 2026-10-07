import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseNativeLocaleEvidence,
  projectNativeReceiptLocale,
  qualifyNativeLocaleEvidence,
  type NativeLocaleBinding,
  type NativeLocaleEvidence,
} from '../../scripts/testing/locale-native-observation';

const binding: NativeLocaleBinding = {
  captureRunId: 'a'.repeat(24),
  sourceTreeHash: '1'.repeat(64),
  helperInputsHash: '2'.repeat(64),
  target: {
    platform: 'ios',
    deviceId: 'owned-target',
    osVersion: 'iOS-26-5',
    appId: 'com.edufelip.mychampions.dev',
    binaryHash: '3'.repeat(64),
    apiOrigin: 'http://127.0.0.1:61251',
  },
};

const androidBinding: NativeLocaleBinding = {
  ...binding,
  target: { ...binding.target, platform: 'android' },
};

function evidence(overrides: Partial<NativeLocaleEvidence> = {}): NativeLocaleEvidence {
  return {
    schemaVersion: 1,
    requestedLocale: 'en-US',
    observedOsLocale: {
      status: 'observed',
      source: 'ios-simctl-defaults',
      raw: 'en_US',
      resolved: 'en-US',
      normalization: 'platform-canonical',
    },
    effectiveAppLocale: {
      hydration: 'hydrated',
      source: 'LocaleContext',
      value: 'en-US',
    },
    override: {
      status: 'absent',
      source: 'language-storage',
      value: null,
    },
    binding,
    ...overrides,
  };
}

function blockedReason(result: ReturnType<typeof qualifyNativeLocaleEvidence>): string {
  assert.equal(result.eligible, false);
  if (result.eligible) throw new Error('Expected locale evidence to be blocked');
  return result.reason;
}

void test('qualifies exact hydrated app locale with known absent override and matching OS', () => {
  const value = evidence();
  const result = qualifyNativeLocaleEvidence(value, 'en-US', binding);
  assert.equal(result.eligible, true);
  assert.equal(result.locale, 'en-US');
  assert.equal(projectNativeReceiptLocale(value, 'en-US', binding), 'en-US');
});

void test('qualifies an explicit app override even when OS locale differs', () => {
  const value = evidence({
    requestedLocale: 'pt-BR',
    observedOsLocale: {
      status: 'observed',
      source: 'android-getprop',
      raw: 'en-US',
      resolved: 'en-US',
      normalization: 'exact',
    },
    effectiveAppLocale: { hydration: 'hydrated', source: 'LocaleContext', value: 'pt-BR' },
    override: { status: 'present', source: 'language-storage', value: 'pt-BR' },
    binding: androidBinding,
  });
  const result = qualifyNativeLocaleEvidence(value, 'pt-BR', androidBinding);
  assert.equal(result.eligible, true);
  assert.equal(result.locale, 'pt-BR');
});

void test('request-only and OS-only evidence never projects a public locale', () => {
  const requestOnly = evidence({
    effectiveAppLocale: { hydration: 'unobserved', source: 'unobserved', value: null },
    override: { status: 'unobserved', source: 'unobserved', value: null },
  });
  const osOnly = evidence({
    requestedLocale: null,
    effectiveAppLocale: { hydration: 'unobserved', source: 'unobserved', value: null },
    override: { status: 'unobserved', source: 'unobserved', value: null },
  });
  assert.equal(projectNativeReceiptLocale(requestOnly, 'en-US', binding), null);
  assert.equal(projectNativeReceiptLocale(osOnly, 'en-US', binding), null);
  assert.equal(qualifyNativeLocaleEvidence(requestOnly, 'en-US', binding).eligible, false);
});

void test('pending, read-error, and invalid override evidence are blocked', () => {
  const pending = evidence({
    effectiveAppLocale: { hydration: 'pending', source: 'unobserved', value: null },
  });
  const readError = evidence({
    effectiveAppLocale: { hydration: 'read-error', source: 'unobserved', value: null },
    override: { status: 'read-error', source: 'language-storage', value: null },
  });
  const invalidOverride = evidence({
    override: { status: 'invalid', source: 'language-storage', value: null },
  });
  assert.equal(
    blockedReason(qualifyNativeLocaleEvidence(pending, 'en-US', binding)),
    'app-locale-not-hydrated',
  );
  assert.equal(
    blockedReason(qualifyNativeLocaleEvidence(readError, 'en-US', binding)),
    'app-locale-not-hydrated',
  );
  assert.equal(
    blockedReason(qualifyNativeLocaleEvidence(invalidOverride, 'en-US', binding)),
    'invalid-override',
  );
  assert.equal(projectNativeReceiptLocale(invalidOverride, 'en-US', binding), null);
});

void test('requested/effective mismatch and language-only OS values are blocked', () => {
  const mismatch = evidence({
    requestedLocale: 'es-ES',
    effectiveAppLocale: { hydration: 'hydrated', source: 'LocaleContext', value: 'en-US' },
  });
  const languageOnly = evidence({
    observedOsLocale: {
      status: 'observed',
      source: 'ios-simctl-defaults',
      raw: 'en',
      resolved: null,
      normalization: 'language-only',
    },
  });
  assert.equal(
    blockedReason(qualifyNativeLocaleEvidence(mismatch, 'es-ES', binding)),
    'effective-locale-mismatch',
  );
  assert.equal(
    blockedReason(qualifyNativeLocaleEvidence(languageOnly, 'en-US', binding)),
    'os-locale-language-only',
  );
  assert.equal(projectNativeReceiptLocale(mismatch, 'es-ES', binding), null);
});

void test('without an override, OS locale must match the requested locale', () => {
  const mismatch = evidence({
    observedOsLocale: {
      status: 'observed',
      source: 'ios-simctl-defaults',
      raw: 'pt-BR',
      resolved: 'pt-BR',
      normalization: 'exact',
    },
  });
  assert.equal(
    blockedReason(qualifyNativeLocaleEvidence(mismatch, 'en-US', binding)),
    'os-request-mismatch',
  );
});

void test('override provenance and normalized OS fields cannot be forged', () => {
  const mismatchedOverride = evidence({
    override: { status: 'present', source: 'language-storage', value: 'pt-BR' },
  });
  assert.equal(
    blockedReason(qualifyNativeLocaleEvidence(mismatchedOverride, 'en-US', binding)),
    'override-effective-mismatch',
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({ override: { status: 'absent', source: 'unobserved', value: null } }),
      ),
    /known override status requires language-storage/,
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({
          observedOsLocale: {
            status: 'observed',
            source: 'ios-simctl-defaults',
            raw: 'pt_BR',
            resolved: 'en-US',
            normalization: 'exact',
          },
        }),
      ),
    /normalization does not match/,
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({
          observedOsLocale: {
            status: 'observed',
            source: 'android-getprop',
            raw: 'en-US',
            resolved: 'en-US',
            normalization: 'exact',
          },
        }),
      ),
    /source does not match the bound target platform/,
  );
});

void test('target/build/source binding mismatch blocks an otherwise valid app locale', () => {
  const changed = { ...binding, sourceTreeHash: '4'.repeat(64) };
  const result = qualifyNativeLocaleEvidence(evidence(), 'en-US', changed);
  assert.equal(result.eligible, false);
  assert.equal(blockedReason(result), 'binding-mismatch');
  assert.equal(projectNativeReceiptLocale(evidence(), 'en-US', changed), null);
});

void test('malformed evidence is rejected before any field can project', () => {
  assert.throws(
    () => parseNativeLocaleEvidence({ schemaVersion: 1, requestedLocale: null }),
    /binding|observedOsLocale/,
  );
  assert.equal(projectNativeReceiptLocale({ requestedLocale: 'en-US' }, 'en-US', binding), null);
  assert.equal(
    blockedReason(qualifyNativeLocaleEvidence(evidence(), 'fr-FR', binding)),
    'expected-locale-invalid',
  );
});

void test('hostile origins and unbounded target or OS strings are rejected', () => {
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({
          binding: {
            ...binding,
            target: { ...binding.target, apiOrigin: 'http://user:secret@127.0.0.1:61251' },
          },
        }),
      ),
    /HTTP origin|credentials/,
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({
          binding: {
            ...binding,
            target: { ...binding.target, apiOrigin: 'http://127.0.0.1:61251/private' },
          },
        }),
      ),
    /HTTP origin|path/,
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({
          binding: {
            ...binding,
            target: { ...binding.target, apiOrigin: 'http://127.0.0.1:61251?token=secret' },
          },
        }),
      ),
    /HTTP origin|path/,
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({
          binding: {
            ...binding,
            target: { ...binding.target, apiOrigin: 'http://127.0.0.1:61251#secret' },
          },
        }),
      ),
    /HTTP origin|path/,
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({
          binding: {
            ...binding,
            target: { ...binding.target, apiOrigin: 'http://127.0.0.1:70000' },
          },
        }),
      ),
    /HTTP origin|port/,
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({ observedOsLocale: { ...evidence().observedOsLocale, raw: 'x'.repeat(129) } }),
      ),
    /bounded length/,
  );
  assert.throws(
    () =>
      parseNativeLocaleEvidence(
        evidence({
          binding: { ...binding, target: { ...binding.target, deviceId: 'd'.repeat(257) } },
        }),
      ),
    /bounded length/,
  );
});

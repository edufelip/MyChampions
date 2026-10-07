/**
 * Canonical-ready T15 locale observation validator.
 *
 * This module is deliberately independent from the production runner, app
 * context, schemas, and native resources. It only validates a bounded,
 * redacted evidence object and projects the effective hydrated app locale when
 * every provenance boundary is present. This module has no app or private
 * artifact imports and is safe to transfer into the canonical testing layer.
 */

export const SUPPORTED_NATIVE_LOCALES = ['en-US', 'pt-BR', 'es-ES'] as const;
export type SupportedNativeLocale = (typeof SUPPORTED_NATIVE_LOCALES)[number];

const HASH64 = /^[a-f0-9]{64}$/;
const CAPTURE_ID = /^[a-f0-9]{24}$/;
const MAX_OS_RAW = 128;
const MAX_DEVICE_ID = 256;
const MAX_OS_VERSION = 128;
const MAX_APP_ID = 256;
const MAX_API_ORIGIN = 256;

type OsEvidenceStatus = 'observed' | 'absent' | 'invalid' | 'read-error';
type OsEvidenceSource = 'ios-simctl-defaults' | 'android-getprop';
export type NativeLocalePlatform = 'ios' | 'android';
type OsNormalization = 'exact' | 'platform-canonical' | 'language-only' | 'none';
type AppHydration = 'pending' | 'hydrated' | 'read-error' | 'unobserved';
type OverrideStatus = 'present' | 'absent' | 'invalid' | 'read-error' | 'unobserved';

export type NativeLocaleBinding = {
  captureRunId: string;
  sourceTreeHash: string;
  helperInputsHash: string;
  target: {
    platform: NativeLocalePlatform;
    deviceId: string;
    osVersion: string;
    appId: string;
    binaryHash: string;
    apiOrigin: string;
  };
};

export type NativeLocaleEvidence = {
  schemaVersion: 1;
  requestedLocale: SupportedNativeLocale | null;
  observedOsLocale: {
    status: OsEvidenceStatus;
    source: OsEvidenceSource;
    raw: string | null;
    resolved: SupportedNativeLocale | null;
    normalization: OsNormalization;
  };
  effectiveAppLocale: {
    hydration: AppHydration;
    source: 'LocaleContext' | 'unobserved';
    value: SupportedNativeLocale | null;
  };
  override: {
    status: OverrideStatus;
    source: 'language-storage' | 'unobserved';
    value: SupportedNativeLocale | null;
  };
  binding: NativeLocaleBinding;
};

export type NativeLocaleBlockReason =
  | 'malformed-evidence'
  | 'expected-locale-invalid'
  | 'requested-locale-missing'
  | 'requested-locale-mismatch'
  | 'os-locale-unavailable'
  | 'os-locale-language-only'
  | 'os-request-mismatch'
  | 'app-locale-not-hydrated'
  | 'override-provenance-unavailable'
  | 'invalid-override'
  | 'override-effective-mismatch'
  | 'effective-locale-mismatch'
  | 'binding-mismatch';

export type NativeLocaleQualification =
  | {
      eligible: true;
      locale: SupportedNativeLocale;
      evidence: NativeLocaleEvidence;
    }
  | {
      eligible: false;
      locale: null;
      reason: NativeLocaleBlockReason;
      detail: string;
    };

function invalid(message: string): never {
  throw new Error(`Invalid native locale evidence: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value)
    invalid(`${label} must be a nonempty string`);
  return value;
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  const candidate = nonemptyString(value, label);
  if (candidate.length > maxLength) invalid(`${label} exceeds the bounded length`);
  if ([...candidate].some((character) => character < ' ' || character === '\u007f'))
    invalid(`${label} contains a control character`);
  return candidate;
}

function nullableBoundedString(value: unknown, label: string, maxLength: number): string | null {
  if (value === null) return null;
  return boundedString(value, label, maxLength);
}

function locale(value: unknown, label: string): SupportedNativeLocale {
  if (
    typeof value !== 'string' ||
    !SUPPORTED_NATIVE_LOCALES.includes(value as SupportedNativeLocale)
  )
    invalid(`${label} is unsupported`);
  return value as SupportedNativeLocale;
}

function nullableLocale(value: unknown, label: string): SupportedNativeLocale | null {
  if (value === null) return null;
  return locale(value, label);
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH64.test(value)) invalid(`${label} must be a SHA-256 hash`);
  return value;
}

function captureId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CAPTURE_ID.test(value)) invalid(`${label} is invalid`);
  return value;
}

function origin(value: unknown, label: string): string {
  const candidate = boundedString(value, label, MAX_API_ORIGIN);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    invalid(`${label} must be a valid HTTP origin`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  )
    invalid(`${label} must be an HTTP origin without credentials or a path`);
  if (parsed.port !== '') {
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      invalid(`${label} must use a valid port`);
  }
  return candidate;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(`${label} is invalid`);
  return value as T;
}

function normalizedOsLocale(
  raw: string,
  source: OsEvidenceSource,
): { resolved: SupportedNativeLocale | null; normalization: OsNormalization } | null {
  if (SUPPORTED_NATIVE_LOCALES.includes(raw as SupportedNativeLocale))
    return { resolved: raw as SupportedNativeLocale, normalization: 'exact' };
  if (['en', 'pt', 'es'].includes(raw)) return { resolved: null, normalization: 'language-only' };
  if (source === 'ios-simctl-defaults') {
    const platformCanonical = { en_US: 'en-US', pt_BR: 'pt-BR', es_ES: 'es-ES' } as const;
    const resolved = platformCanonical[raw as keyof typeof platformCanonical];
    if (resolved) return { resolved, normalization: 'platform-canonical' };
  }
  return null;
}

function parseBinding(value: unknown, label: string): NativeLocaleBinding {
  const row = record(value, label);
  const target = record(row.target, `${label}.target`);
  return {
    captureRunId: captureId(row.captureRunId, `${label}.captureRunId`),
    sourceTreeHash: hash(row.sourceTreeHash, `${label}.sourceTreeHash`),
    helperInputsHash: hash(row.helperInputsHash, `${label}.helperInputsHash`),
    target: {
      platform: oneOf(target.platform, ['ios', 'android'] as const, `${label}.target.platform`),
      deviceId: boundedString(target.deviceId, `${label}.target.deviceId`, MAX_DEVICE_ID),
      osVersion: boundedString(target.osVersion, `${label}.target.osVersion`, MAX_OS_VERSION),
      appId: boundedString(target.appId, `${label}.target.appId`, MAX_APP_ID),
      binaryHash: hash(target.binaryHash, `${label}.target.binaryHash`),
      apiOrigin: origin(target.apiOrigin, `${label}.target.apiOrigin`),
    },
  };
}

function sameBinding(left: NativeLocaleBinding, right: NativeLocaleBinding): boolean {
  return (
    left.captureRunId === right.captureRunId &&
    left.sourceTreeHash === right.sourceTreeHash &&
    left.helperInputsHash === right.helperInputsHash &&
    left.target.platform === right.target.platform &&
    left.target.deviceId === right.target.deviceId &&
    left.target.osVersion === right.target.osVersion &&
    left.target.appId === right.target.appId &&
    left.target.binaryHash === right.target.binaryHash &&
    left.target.apiOrigin === right.target.apiOrigin
  );
}

/** Validate a binding independently before a collector compares freshness. */
export function parseNativeLocaleBinding(value: unknown): NativeLocaleBinding {
  return parseBinding(value, 'binding');
}

/** Compare every capture, source, helper, target, build and API identity field. */
export function sameNativeLocaleBinding(
  left: NativeLocaleBinding,
  right: NativeLocaleBinding,
): boolean {
  return sameBinding(left, right);
}

/** Parse and validate shape only. No field is treated as qualification evidence yet. */
export function parseNativeLocaleEvidence(value: unknown): NativeLocaleEvidence {
  const row = record(value, 'evidence');
  if (row.schemaVersion !== 1) invalid('schemaVersion must be 1');
  const binding = parseBinding(row.binding, 'binding');

  const requestedLocale =
    row.requestedLocale === null ? null : locale(row.requestedLocale, 'requestedLocale');

  const os = record(row.observedOsLocale, 'observedOsLocale');
  const osStatus = oneOf(
    os.status,
    ['observed', 'absent', 'invalid', 'read-error'] as const,
    'observedOsLocale.status',
  );
  const osSource = oneOf(
    os.source,
    ['ios-simctl-defaults', 'android-getprop'] as const,
    'observedOsLocale.source',
  );
  const expectedOsSource: OsEvidenceSource =
    binding.target.platform === 'ios' ? 'ios-simctl-defaults' : 'android-getprop';
  if (osSource !== expectedOsSource)
    invalid('observed OS locale source does not match the bound target platform');
  const osRaw = nullableBoundedString(os.raw, 'observedOsLocale.raw', MAX_OS_RAW);
  const osResolved = nullableLocale(os.resolved, 'observedOsLocale.resolved');
  const osNormalization = oneOf(
    os.normalization,
    ['exact', 'platform-canonical', 'language-only', 'none'] as const,
    'observedOsLocale.normalization',
  );
  if (osStatus === 'observed') {
    if (osRaw === null) invalid('observed OS locale requires a raw value');
    const normalized = normalizedOsLocale(osRaw, osSource);
    if (normalized === null) invalid('observed OS locale is not a supported closed value');
    if (normalized.resolved !== osResolved || normalized.normalization !== osNormalization)
      invalid('observed OS locale normalization does not match its raw value');
  } else {
    if (osResolved !== null) invalid('non-observed OS locale cannot have a resolved value');
    if (osStatus === 'invalid' && osRaw === null)
      invalid('invalid OS locale requires the bounded raw value');
    if (osStatus !== 'invalid' && osRaw !== null)
      invalid('absent/read-error OS locale cannot have a raw value');
    if (osNormalization !== 'none') invalid('non-observed OS locale requires normalization=none');
  }

  const app = record(row.effectiveAppLocale, 'effectiveAppLocale');
  const hydration = oneOf(
    app.hydration,
    ['pending', 'hydrated', 'read-error', 'unobserved'] as const,
    'effectiveAppLocale.hydration',
  );
  const appSource = oneOf(
    app.source,
    ['LocaleContext', 'unobserved'] as const,
    'effectiveAppLocale.source',
  );
  const appValue = nullableLocale(app.value, 'effectiveAppLocale.value');
  if (hydration === 'hydrated') {
    if (appSource !== 'LocaleContext' || appValue === null)
      invalid('hydrated app locale requires LocaleContext and a supported value');
  } else if (appSource !== 'unobserved' || appValue !== null) {
    invalid('unhydrated app locale must be unavailable');
  }

  const override = record(row.override, 'override');
  const overrideStatus = oneOf(
    override.status,
    ['present', 'absent', 'invalid', 'read-error', 'unobserved'] as const,
    'override.status',
  );
  const overrideSource = oneOf(
    override.source,
    ['language-storage', 'unobserved'] as const,
    'override.source',
  );
  const overrideValue = nullableLocale(override.value, 'override.value');
  if (overrideStatus === 'present') {
    if (overrideSource !== 'language-storage' || overrideValue === null)
      invalid('present override requires language-storage and a supported value');
  } else if (overrideStatus === 'unobserved') {
    if (overrideSource !== 'unobserved' || overrideValue !== null)
      invalid('unobserved override requires source=unobserved and no value');
  } else {
    if (overrideSource !== 'language-storage')
      invalid('known override status requires language-storage');
    if (overrideValue !== null) invalid('non-present override cannot have a value');
  }

  return {
    schemaVersion: 1,
    requestedLocale,
    observedOsLocale: {
      status: osStatus,
      source: osSource,
      raw: osRaw,
      resolved: osResolved,
      normalization: osNormalization,
    },
    effectiveAppLocale: { hydration, source: appSource, value: appValue },
    override: { status: overrideStatus, source: overrideSource, value: overrideValue },
    binding,
  };
}

/**
 * Qualify only a complete evidence object. The caller must retain a blocked
 * reason and must not substitute the returned null locale with the request or
 * OS value.
 */
export function qualifyNativeLocaleEvidence(
  value: unknown,
  expectedLocale: unknown,
  expectedBinding: NativeLocaleBinding,
): NativeLocaleQualification {
  let evidence: NativeLocaleEvidence;
  try {
    evidence = parseNativeLocaleEvidence(value);
  } catch (error) {
    return {
      eligible: false,
      locale: null,
      reason: 'malformed-evidence',
      detail: error instanceof Error ? error.message : 'Evidence shape is invalid',
    };
  }

  if (!SUPPORTED_NATIVE_LOCALES.includes(expectedLocale as SupportedNativeLocale))
    return {
      eligible: false,
      locale: null,
      reason: 'expected-locale-invalid',
      detail: 'The reviewed expected locale is unsupported.',
    };
  const expected = expectedLocale as SupportedNativeLocale;
  let binding: NativeLocaleBinding;
  try {
    binding = parseBinding(expectedBinding, 'expectedBinding');
  } catch (error) {
    return {
      eligible: false,
      locale: null,
      reason: 'binding-mismatch',
      detail: error instanceof Error ? error.message : 'Expected binding is invalid.',
    };
  }
  if (!sameBinding(evidence.binding, binding))
    return {
      eligible: false,
      locale: null,
      reason: 'binding-mismatch',
      detail:
        'Locale evidence is bound to a different capture, source, helper set, target, or build.',
    };
  if (evidence.requestedLocale === null)
    return {
      eligible: false,
      locale: null,
      reason: 'requested-locale-missing',
      detail: 'The attempt has no explicit reviewed locale request.',
    };
  if (evidence.requestedLocale !== expected)
    return {
      eligible: false,
      locale: null,
      reason: 'requested-locale-mismatch',
      detail: 'The runtime request differs from the reviewed locale cell.',
    };
  if (evidence.observedOsLocale.status !== 'observed')
    return {
      eligible: false,
      locale: null,
      reason: 'os-locale-unavailable',
      detail: 'OS locale was absent, invalid, or unreadable.',
    };
  if (evidence.observedOsLocale.normalization === 'language-only')
    return {
      eligible: false,
      locale: null,
      reason: 'os-locale-language-only',
      detail: 'A language-only OS value cannot establish the requested region.',
    };
  if (evidence.effectiveAppLocale.hydration !== 'hydrated')
    return {
      eligible: false,
      locale: null,
      reason: 'app-locale-not-hydrated',
      detail: 'LocaleContext did not report a completed hydration with a supported value.',
    };
  if (evidence.override.status === 'invalid')
    return {
      eligible: false,
      locale: null,
      reason: 'invalid-override',
      detail: 'The persisted language override was invalid and cannot be treated as absent.',
    };
  if (!['present', 'absent'].includes(evidence.override.status))
    return {
      eligible: false,
      locale: null,
      reason: 'override-provenance-unavailable',
      detail: 'Override provenance is missing or unreadable.',
    };
  if (
    evidence.override.status === 'present' &&
    evidence.override.value !== evidence.effectiveAppLocale.value
  )
    return {
      eligible: false,
      locale: null,
      reason: 'override-effective-mismatch',
      detail: 'The persisted override does not match the hydrated app locale.',
    };
  if (evidence.effectiveAppLocale.value !== expected)
    return {
      eligible: false,
      locale: null,
      reason: 'effective-locale-mismatch',
      detail: 'The hydrated app locale differs from the reviewed locale cell.',
    };
  if (evidence.override.status === 'absent' && evidence.observedOsLocale.resolved !== expected)
    return {
      eligible: false,
      locale: null,
      reason: 'os-request-mismatch',
      detail: 'Without an app override, the observed OS locale does not match the request.',
    };

  return { eligible: true, locale: expected, evidence };
}

/** Public projection seam; blocked evidence always projects to null. */
export function projectNativeReceiptLocale(
  value: unknown,
  expectedLocale: unknown,
  expectedBinding: NativeLocaleBinding,
): SupportedNativeLocale | null {
  const result = qualifyNativeLocaleEvidence(value, expectedLocale, expectedBinding);
  return result.eligible ? result.locale : null;
}

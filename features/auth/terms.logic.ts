export type TermsConfig = {
  requiredVersion: string;
  termsUrl: string;
  privacyPolicyUrl: string;
};

export type TermsStateInput = {
  requiredVersion: string;
  acceptedVersion: string | null;
};

export const DEFAULT_TERMS_URL =
  'https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use';
export const DEFAULT_PRIVACY_POLICY_URL =
  'https://portfolio.eduwaldo.com/projects/my-champions/privacy_policy';

export function normalizeTermsVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

export function resolveRequiredTermsVersion(
  value: string | null | undefined,
  fallback = 'v1',
): string {
  return normalizeTermsVersion(value) ?? fallback;
}

export function resolveTermsUrl(
  value: string | null | undefined,
  fallback = DEFAULT_TERMS_URL,
): string {
  if (!value) return fallback;
  const next = value.trim();
  return next.length > 0 ? next : fallback;
}

export function resolvePrivacyPolicyUrl(
  value: string | null | undefined,
  fallback = DEFAULT_PRIVACY_POLICY_URL,
): string {
  if (!value) return fallback;
  const next = value.trim();
  return next.length > 0 ? next : fallback;
}

export function needsTermsAcceptance(input: TermsStateInput): boolean {
  const required = normalizeTermsVersion(input.requiredVersion);
  const accepted = normalizeTermsVersion(input.acceptedVersion);

  if (!required) return false;
  return accepted !== required;
}
